import type {
  AccountResponse,
  AddressTransactionsResponse,
  TransactionDetail,
  TransactionDetailResponse,
  TransactionSummary,
} from './types.js';

export const DEFAULT_BASE_URL = 'https://scan.thru.org';
export const MAX_PAGE_SIZE = 100;

export interface ClientOptions {
  baseUrl?: string;
  /** Requests in flight when fetching transaction details. Default 4. */
  concurrency?: number;
  /** Attempts per request, including the first. Default 3. */
  retries?: number;
  /** Per-request timeout in milliseconds. Default 30000. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  onProgress?: (info: { fetched: number; total?: number; phase: 'list' | 'detail' }) => void;
}

export class ThruExplorerError extends Error {
  readonly status?: number;
  readonly url?: string;

  constructor(message: string, status?: number, url?: string) {
    super(message);
    this.name = 'ThruExplorerError';
    this.status = status;
    this.url = url;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class ThruExplorerClient {
  private readonly baseUrl: string;
  private readonly concurrency: number;
  private readonly retries: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly onProgress: ClientOptions['onProgress'];

  constructor(options: ClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.concurrency = Math.max(1, options.concurrency ?? 4);
    this.retries = Math.max(1, options.retries ?? 3);
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.onProgress = options.onProgress;
    if (typeof this.fetchImpl !== 'function') {
      throw new ThruExplorerError('No fetch implementation available (Node 20+ required).');
    }
  }

  private async getJson<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.retries; attempt++) {
      try {
        const response = await this.fetchImpl(url, {
          headers: { accept: 'application/json', 'user-agent': 'thru-ledger-export' },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (response.status === 429 || response.status >= 500) {
          throw new ThruExplorerError(`HTTP ${response.status}`, response.status, url);
        }
        if (!response.ok) {
          throw new ThruExplorerError(`HTTP ${response.status} for ${path}`, response.status, url);
        }
        return (await response.json()) as T;
      } catch (error) {
        lastError = error;
        const status = error instanceof ThruExplorerError ? error.status : undefined;
        const retryable = status === undefined || status === 429 || status >= 500;
        if (!retryable || attempt === this.retries) break;
        await sleep(500 * 2 ** (attempt - 1));
      }
    }
    if (lastError instanceof Error) throw lastError;
    throw new ThruExplorerError(`Request failed: ${path}`);
  }

  getAccount(address: string): Promise<AccountResponse> {
    return this.getJson<AccountResponse>(`/api/address/${encodeURIComponent(address)}`);
  }

  getTransaction(signature: string): Promise<TransactionDetailResponse> {
    return this.getJson<TransactionDetailResponse>(`/api/tx/${encodeURIComponent(signature)}`);
  }

  /** Walk every page of an account's transaction list, newest first. */
  async listAllTransactions(address: string, limit?: number): Promise<TransactionSummary[]> {
    const collected: TransactionSummary[] = [];
    let pageToken: string | undefined;

    do {
      const query = new URLSearchParams({ pageSize: String(MAX_PAGE_SIZE) });
      if (pageToken) query.set('pageToken', pageToken);
      const path = `/api/address/${encodeURIComponent(address)}/transactions?${query}`;
      const page = await this.getJson<AddressTransactionsResponse>(path);
      const batch = page.data?.transactions ?? [];
      collected.push(...batch);
      this.onProgress?.({ fetched: collected.length, phase: 'list' });
      pageToken = page.data?.pagination?.nextPageToken;
      if (batch.length === 0) break;
      if (limit !== undefined && collected.length >= limit) break;
    } while (pageToken);

    return limit === undefined ? collected : collected.slice(0, limit);
  }

  /** Fetch full details for many signatures, a few at a time, preserving input order. */
  async getTransactions(signatures: string[]): Promise<TransactionDetail[]> {
    const results = new Array<TransactionDetail | undefined>(signatures.length);
    let cursor = 0;
    let done = 0;

    const worker = async (): Promise<void> => {
      while (cursor < signatures.length) {
        const index = cursor++;
        const signature = signatures[index];
        if (signature === undefined) continue;
        const response = await this.getTransaction(signature);
        results[index] = response.data;
        done++;
        this.onProgress?.({ fetched: done, total: signatures.length, phase: 'detail' });
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(this.concurrency, signatures.length) }, () => worker()),
    );
    return results.filter((value): value is TransactionDetail => value !== undefined);
  }
}
