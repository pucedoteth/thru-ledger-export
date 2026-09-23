import { ThruExplorerClient, type ClientOptions } from './client.js';
import { toLedgerRow, totalFeesPaidRaw, formatThru } from './normalize.js';
import { parseAbi, type ProgramAbi } from './abi.js';
import { buildTokenContext, decodeEvents, formatUnits, primaryMovement } from './events.js';
import type { DecodedEvent, LedgerRow, TransactionDetail } from './types.js';

export interface ExportOptions extends ClientOptions {
  /** Stop after this many transactions (newest first). */
  limit?: number;
  /** Keep only transactions on or after this UTC date (YYYY-MM-DD). */
  from?: string;
  /** Keep only transactions on or before this UTC date (YYYY-MM-DD). */
  to?: string;
  /** Drop transactions that failed consensus or execution. */
  successOnly?: boolean;
  /** Decode events with each program's published ABI. Default true. */
  decode?: boolean;
  /**
   * Token accounts that belong to the exported address. Accounts created in
   * the exported history are found automatically; list older ones here.
   */
  tokenAccounts?: string[];
}

/** Per-token totals for the exported account, over the rows in the result. */
export interface TokenTotal {
  tokenMint: string;
  tokenSymbol: string;
  decimals?: number;
  inRaw: string;
  outRaw: string;
  netRaw: string;
  in: string;
  out: string;
  net: string;
  /** Balance after the last row that reported one. */
  closingBalanceRaw: string;
  closingBalance: string;
}

export interface ExportResult {
  account: string;
  balance?: string;
  balanceRaw?: string;
  rows: LedgerRow[];
  totalFeesRaw: string;
  totalFeesThru: string;
  tokenTotals: TokenTotal[];
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

/** Fetch each distinct event program's ABI once. Programs without one map to undefined. */
export async function loadAbis(client: ThruExplorerClient, details: TransactionDetail[]): Promise<Map<string, ProgramAbi | undefined>> {
  const programs = new Set<string>();
  for (const detail of details) {
    for (const event of detail.events?.events ?? []) if (event.programAddress) programs.add(event.programAddress);
  }
  const abis = new Map<string, ProgramAbi | undefined>();
  for (const program of programs) {
    const response = await client.getAbi(program);
    let abi: ProgramAbi | undefined;
    if (response?.data?.abi) {
      try {
        abi = parseAbi(response.data.abi, response.data.programName);
      } catch {
        abi = undefined; // An ABI we cannot read leaves that program's events undecoded.
      }
    }
    abis.set(program, abi);
  }
  return abis;
}

/** Sum each token's in/out amounts for the exported account (rows must be oldest first). */
export function summarizeTokens(rows: LedgerRow[], decimals: Map<string, number | undefined> = new Map()): TokenTotal[] {
  const totals = new Map<string, { symbol: string; inRaw: bigint; outRaw: bigint; closing: string }>();
  for (const row of rows) {
    if (!row.tokenMint || !/^\d+$/.test(row.amountRaw)) continue;
    if (row.direction !== 'in' && row.direction !== 'out' && !row.tokenBalanceAfterRaw) continue;
    const total = totals.get(row.tokenMint) ?? { symbol: row.tokenSymbol, inRaw: 0n, outRaw: 0n, closing: '' };
    if (row.direction === 'in') total.inRaw += BigInt(row.amountRaw);
    if (row.direction === 'out') total.outRaw += BigInt(row.amountRaw);
    if (row.tokenBalanceAfterRaw) total.closing = row.tokenBalanceAfterRaw;
    total.symbol ||= row.tokenSymbol;
    totals.set(row.tokenMint, total);
  }
  return [...totals].map(([tokenMint, total]) => {
    const places = decimals.get(tokenMint);
    const net = total.inRaw - total.outRaw;
    const fmt = (value: bigint) =>
      value < 0n ? `-${formatUnits((-value).toString(), places)}` : formatUnits(value.toString(), places);
    return {
      tokenMint,
      tokenSymbol: total.symbol,
      decimals: places,
      inRaw: total.inRaw.toString(),
      outRaw: total.outRaw.toString(),
      netRaw: net.toString(),
      in: fmt(total.inRaw),
      out: fmt(total.outRaw),
      net: places === undefined ? '' : fmt(net),
      closingBalanceRaw: total.closing,
      closingBalance: total.closing ? formatUnits(total.closing, places) : '',
    };
  });
}

/** Fetch an account's history and return rows ready for CSV or JSON. */
export async function exportAccount(address: string, options: ExportOptions = {}): Promise<ExportResult> {
  const client = new ThruExplorerClient(options);
  const account = await client.getAccount(address).catch(() => undefined);
  const summaries = await client.listAllTransactions(address, options.limit);
  const details = await client.getTransactions(summaries.map((tx) => tx.signature));

  const decode = options.decode !== false;
  const abis = decode ? await loadAbis(client, details) : new Map<string, ProgramAbi | undefined>();
  const decodedByTx = new Map<string, DecodedEvent[]>();
  if (decode) {
    for (const detail of details) decodedByTx.set(detail.signature, decodeEvents(detail, (program) => abis.get(program)));
  }
  // Ownership and token metadata come from the whole fetched history, before date filters.
  const context = buildTokenContext(address, [...decodedByTx.values()].flat(), options.tokenAccounts);

  let rows = details.map((detail) => {
    if (!decode) return toLedgerRow(detail, address);
    const events = decodedByTx.get(detail.signature) ?? [];
    return toLedgerRow(detail, address, { events, movement: primaryMovement(events, context) });
  });
  rows = filterByDate(rows, options.from, options.to);
  if (options.successOnly) rows = rows.filter((row) => row.succeeded);
  rows.sort((a, b) => (a.timestampUtc < b.timestampUtc ? -1 : a.timestampUtc > b.timestampUtc ? 1 : 0));

  const decimals = new Map([...context.mints].map(([mint, info]) => [mint, info.decimals]));
  const totalFeesRaw = totalFeesPaidRaw(rows, address);
  return {
    account: address,
    balance: account?.data?.balance,
    balanceRaw: account?.data?.balanceRaw,
    rows,
    totalFeesRaw,
    totalFeesThru: formatThru(totalFeesRaw),
    tokenTotals: summarizeTokens(rows, decimals),
    generatedAt: new Date().toISOString(),
  };
}
