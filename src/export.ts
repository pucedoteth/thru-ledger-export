import { ThruExplorerClient, type ClientOptions } from './client.js';
import { toLedgerRow, totalFeesPaidRaw, formatThru } from './normalize.js';
import type { LedgerRow } from './types.js';

export interface ExportOptions extends ClientOptions {
  /** Stop after this many transactions (newest first). */
  limit?: number;
  /** Keep only transactions on or after this UTC date (YYYY-MM-DD). */
  from?: string;
  /** Keep only transactions on or before this UTC date (YYYY-MM-DD). */
  to?: string;
  /** Drop transactions that failed consensus or execution. */
  successOnly?: boolean;
}

export interface ExportResult {
  account: string;
  balance?: string;
  balanceRaw?: string;
  rows: LedgerRow[];
  totalFeesRaw: string;
  totalFeesThru: string;
  generatedAt: string;
}

/** Keep rows inside an inclusive UTC date range; rows without a date are kept. */
export function filterByDate(rows: LedgerRow[], from?: string, to?: string): LedgerRow[] {
  if (!from && !to) return rows;
  return rows.filter((row) => {
    if (!row.date) return true;
    if (from && row.date < from) return false;
    if (to && row.date > to) return false;
    return true;
  });
}

/** Fetch an account's history and return rows ready for CSV or JSON. */
export async function exportAccount(address: string, options: ExportOptions = {}): Promise<ExportResult> {
  const client = new ThruExplorerClient(options);
  const account = await client.getAccount(address).catch(() => undefined);
  const summaries = await client.listAllTransactions(address, options.limit);
  const details = await client.getTransactions(summaries.map((tx) => tx.signature));

  let rows = details.map((detail) => toLedgerRow(detail, address));
  rows = filterByDate(rows, options.from, options.to);
  if (options.successOnly) rows = rows.filter((row) => row.succeeded);
  rows.sort((a, b) => (a.timestampUtc < b.timestampUtc ? -1 : a.timestampUtc > b.timestampUtc ? 1 : 0));

  const totalFeesRaw = totalFeesPaidRaw(rows, address);
  return {
    account: address,
    balance: account?.data?.balance,
    balanceRaw: account?.data?.balanceRaw,
    rows,
    totalFeesRaw,
    totalFeesThru: formatThru(totalFeesRaw),
    generatedAt: new Date().toISOString(),
  };
}
