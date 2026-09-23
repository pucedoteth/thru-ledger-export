import { ThruExplorerClient, type ClientOptions } from './client.js';
import { toLedgerRow, totalFeesPaidRaw, formatThru, isSuccess } from './normalize.js';
import { parseAbi, type ProgramAbi } from './abi.js';
import {
  buildTokenContext, decodeEvents, describeNativeTransfer, formatUnits, nativeDelta, primaryMovement,
} from './events.js';
import { decodeNativeTransfer, NATIVE_DECIMALS, NATIVE_SYMBOL, type NativeTransfer } from './native.js';
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
  /** Decode events and native THRU instructions. Default true. */
  decode?: boolean;
  /**
   * Token accounts that belong to the exported address. Accounts created in
   * the exported history are found automatically; list older ones here.
   */
  tokenAccounts?: string[];
}

/**
 * Per-token figures for the exported account over the exported period:
 * opening balance + in - out (- fees, for THRU) should equal the closing balance.
 */
export interface TokenTotal {
  tokenMint: string;
  tokenSymbol: string;
  decimals?: number;
  /** on-chain: balances reported by the token events. derived: THRU, worked back from the current balance. */
  balanceSource: 'on-chain' | 'derived';
  /** Balance just before the period. Empty when it can't be known (history cut short by --limit). */
  openingBalanceRaw: string;
  openingBalance: string;
  inRaw: string;
  outRaw: string;
  netRaw: string;
  in: string;
  out: string;
  net: string;
  /** THRU only: fees paid by the exported account in the period. */
  feesRaw?: string;
  fees?: string;
  /** Balance at the end of the period. */
  closingBalanceRaw: string;
  closingBalance: string;
  /** opening + in - out (- fees) = closing. null when a balance is unknown. */
  reconciles: boolean | null;
}

/**
 * A consistency check on the derived THRU balances. Every account starts at
 * zero, so when the whole history was exported, working back from today's
 * balance through every decoded transfer and fee must land on exactly zero.
 * If it doesn't, THRU moved in some way this tool doesn't decode.
 */
export interface ThruCheck {
  historyComplete: boolean;
  derivedStartingBalanceRaw: string;
  /** true or false when the whole history was exported, otherwise null. */
  ok: boolean | null;
}

export interface ExportResult {
  account: string;
  balance?: string;
  balanceRaw?: string;
  period: { from?: string; to?: string };
  /** false when --limit cut the history short, so opening balances may be unknown. */
  historyComplete: boolean;
  rows: LedgerRow[];
  totalFeesRaw: string;
  totalFeesThru: string;
  tokenTotals: TokenTotal[];
  thruCheck?: ThruCheck;
  generatedAt: string;
}

/** Keep rows inside an inclusive UTC date range; rows without a date are kept. */
export function filterByDate(rows: LedgerRow[], from?: string, to?: string): LedgerRow[] {
  if (!from && !to) return rows;
  return rows.filter((row) => inPeriod(row, from, to));
}

function inPeriod(row: LedgerRow, from?: string, to?: string): boolean {
  if (!row.date) return true;
  if (from && row.date < from) return false;
  if (to && row.date > to) return false;
  return true;
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

const byTime = (a: LedgerRow, b: LedgerRow): number =>
  a.timestampUtc < b.timestampUtc ? -1 : a.timestampUtc > b.timestampUtc ? 1 : Number(a.slot || 0) - Number(b.slot || 0);

function fmt(value: bigint, decimals: number | undefined): string {
  return value < 0n ? `-${formatUnits((-value).toString(), decimals)}` : formatUnits(value.toString(), decimals);
}

function feePaid(row: LedgerRow, address: string): bigint {
  return row.feePayer === address && /^\d+$/.test(row.feeRaw) ? BigInt(row.feeRaw) : 0n;
}

/**
 * Fill thruBalanceAfter on every row (oldest first) by walking back from the
 * current balance, and return the balance before the first row.
 */
export function deriveThruBalances(
  rows: LedgerRow[], transfers: (NativeTransfer | undefined)[], address: string, currentRaw: string,
): bigint {
  let balance = BigInt(currentRaw);
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i]!;
    row.thruBalanceAfterRaw = balance.toString();
    row.thruBalanceAfter = fmt(balance, NATIVE_DECIMALS);
    balance -= nativeDelta(transfers[i], address) - feePaid(row, address);
  }
  return balance;
}

export interface PeriodContext {
  address: string;
  /** Rows before the period, oldest first. */
  priorRows: LedgerRow[];
  historyComplete: boolean;
  decimals?: Map<string, number | undefined>;
  /** THRU balance before the first exported row, when known. */
  thruStartRaw?: string;
}

/** Opening, in, out, closing and a reconciliation flag per token, over the period's rows (oldest first). */
export function summarizeTokens(rows: LedgerRow[], period: Partial<PeriodContext> = {}): TokenTotal[] {
  const { address = '', priorRows = [], historyComplete = false, decimals = new Map(), thruStartRaw } = period;
  const mints: string[] = [];
  const symbols = new Map<string, string>();
  const note = (row: LedgerRow) => {
    if (!row.tokenMint || row.tokenMint === NATIVE_SYMBOL) return;
    if (row.direction !== 'in' && row.direction !== 'out' && !row.tokenBalanceAfterRaw) return;
    if (!mints.includes(row.tokenMint)) mints.push(row.tokenMint);
    if (row.tokenSymbol) symbols.set(row.tokenMint, row.tokenSymbol);
  };
  rows.forEach(note);

  const totals: TokenTotal[] = [];
  for (const mint of mints) {
    const places = decimals.get(mint);
    const lastBalance = (list: LedgerRow[]) =>
      [...list].reverse().find((row) => row.tokenMint === mint && row.tokenBalanceAfterRaw)?.tokenBalanceAfterRaw;
    const opening = lastBalance(priorRows) ?? (historyComplete ? '0' : '');
    let inRaw = 0n;
    let outRaw = 0n;
    for (const row of rows) {
      if (row.tokenMint !== mint || !/^\d+$/.test(row.amountRaw)) continue;
      if (row.direction === 'in') inRaw += BigInt(row.amountRaw);
      if (row.direction === 'out') outRaw += BigInt(row.amountRaw);
    }
    const closing = lastBalance(rows) ?? opening;
    totals.push(total(mint, symbols.get(mint) ?? '', places, 'on-chain', opening, inRaw, outRaw, undefined, closing));
  }

  const thruRows = rows.filter((row) => row.thruBalanceAfterRaw);
  const nativeRows = rows.filter((row) => row.tokenMint === NATIVE_SYMBOL && (row.direction === 'in' || row.direction === 'out'));
  if (thruRows.length > 0 || nativeRows.length > 0) {
    let inRaw = 0n;
    let outRaw = 0n;
    for (const row of nativeRows) {
      if (row.direction === 'in') inRaw += BigInt(row.amountRaw);
      if (row.direction === 'out') outRaw += BigInt(row.amountRaw);
    }
    const fees = rows.reduce((sum, row) => sum + feePaid(row, address), 0n);
    const lastPrior = [...priorRows].reverse().find((row) => row.thruBalanceAfterRaw)?.thruBalanceAfterRaw;
    const opening = lastPrior ?? thruStartRaw ?? '';
    const closing = thruRows.at(-1)?.thruBalanceAfterRaw ?? opening;
    totals.push(total(NATIVE_SYMBOL, NATIVE_SYMBOL, NATIVE_DECIMALS, 'derived', opening, inRaw, outRaw, fees, closing));
  }
  return totals;
}

function total(
  mint: string, symbol: string, places: number | undefined, source: TokenTotal['balanceSource'],
  opening: string, inRaw: bigint, outRaw: bigint, fees: bigint | undefined, closing: string,
): TokenTotal {
  const net = inRaw - outRaw;
  const known = /^-?\d+$/.test(opening) && /^-?\d+$/.test(closing);
  const shown = (raw: string) => (/^-?\d+$/.test(raw) ? fmt(BigInt(raw), places) : '');
  return {
    tokenMint: mint,
    tokenSymbol: symbol,
    decimals: places,
    balanceSource: source,
    openingBalanceRaw: opening,
    openingBalance: shown(opening),
    inRaw: inRaw.toString(),
    outRaw: outRaw.toString(),
    netRaw: net.toString(),
    in: places === undefined ? '' : fmt(inRaw, places),
    out: places === undefined ? '' : fmt(outRaw, places),
    net: places === undefined ? '' : fmt(net, places),
    ...(fees === undefined ? {} : { feesRaw: fees.toString(), fees: fmt(fees, places) }),
    closingBalanceRaw: closing,
    closingBalance: shown(closing),
    reconciles: known ? BigInt(opening) + net - (fees ?? 0n) === BigInt(closing) : null,
  };
}

/** Fetch an account's history and return rows ready for CSV or JSON. */
export async function exportAccount(address: string, options: ExportOptions = {}): Promise<ExportResult> {
  const client = new ThruExplorerClient(options);
  const account = await client.getAccount(address).catch(() => undefined);
  const summaries = await client.listAllTransactions(address, options.limit);
  const details = await client.getTransactions(summaries.map((tx) => tx.signature));
  const historyComplete = options.limit === undefined || summaries.length < options.limit;

  const decode = options.decode !== false;
  const abis = decode ? await loadAbis(client, details) : new Map<string, ProgramAbi | undefined>();
  const decodedByTx = new Map<string, DecodedEvent[]>();
  if (decode) {
    for (const detail of details) decodedByTx.set(detail.signature, decodeEvents(detail, (program) => abis.get(program)));
  }
  // Ownership and token metadata come from the whole fetched history, before date filters.
  const context = buildTokenContext(address, [...decodedByTx.values()].flat(), options.tokenAccounts);

  const entries = details.map((detail) => {
    if (!decode) return { row: toLedgerRow(detail, address), transfer: undefined };
    const events = decodedByTx.get(detail.signature) ?? [];
    // A failed transaction moves nothing, so only successful ones count as native movements.
    const transfer = isSuccess(detail) ? decodeNativeTransfer(detail) : undefined;
    const tokenMovement = primaryMovement(events, context);
    const native = transfer ? describeNativeTransfer(transfer, address) : undefined;
    const movement = native && (native.direction !== '' || tokenMovement.action === '') ? native : tokenMovement;
    return { row: toLedgerRow(detail, address, { events, movement }), transfer };
  });
  entries.sort((a, b) => byTime(a.row, b.row));

  const allRows = entries.map((entry) => entry.row);
  let thruStartRaw: string | undefined;
  let thruCheck: ThruCheck | undefined;
  if (decode && account?.data?.balanceRaw && /^\d+$/.test(account.data.balanceRaw)) {
    const start = deriveThruBalances(allRows, entries.map((entry) => entry.transfer), address, account.data.balanceRaw);
    thruStartRaw = start.toString();
    thruCheck = { historyComplete, derivedStartingBalanceRaw: thruStartRaw, ok: historyComplete ? start === 0n : null };
  }

  let rows = allRows.filter((row) => inPeriod(row, options.from, options.to));
  if (options.successOnly) rows = rows.filter((row) => row.succeeded);
  const priorRows = options.from ? allRows.filter((row) => row.date !== '' && row.date < options.from!) : [];

  const decimals = new Map([...context.mints].map(([mint, info]) => [mint, info.decimals]));
  const totalFeesRaw = totalFeesPaidRaw(rows, address);
  return {
    account: address,
    balance: account?.data?.balance,
    balanceRaw: account?.data?.balanceRaw,
    period: { from: options.from, to: options.to },
    historyComplete,
    rows,
    totalFeesRaw,
    totalFeesThru: formatThru(totalFeesRaw),
    tokenTotals: summarizeTokens(rows, { address, priorRows, historyComplete, decimals, thruStartRaw }),
    ...(thruCheck ? { thruCheck } : {}),
    generatedAt: new Date().toISOString(),
  };
}
