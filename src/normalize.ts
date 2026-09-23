import type { DecodedEvent, LedgerRow, TransactionDetail } from './types.js';
import type { Movement } from './events.js';

/** Raw units in one THRU. Confirmed against the explorer: 10000 raw = 0.00001 THRU. */
export const RAW_UNITS_PER_THRU = 1_000_000_000n;
export const THRU_DECIMALS = 9;

const EXPLORER_TX_BASE = 'https://scan.thru.org/tx/';

/**
 * Format a raw integer amount as a decimal THRU string, without floating point.
 * Keeps all 9 decimals so values stay exact and sortable in a spreadsheet.
 */
export function formatThru(raw: string | undefined | null): string {
  if (raw === undefined || raw === null || raw === '') return '';
  let negative = false;
  let digits = raw.trim();
  if (digits.startsWith('-')) {
    negative = true;
    digits = digits.slice(1);
  }
  if (!/^\d+$/.test(digits)) return '';
  const value = BigInt(digits);
  const whole = value / RAW_UNITS_PER_THRU;
  const fraction = (value % RAW_UNITS_PER_THRU).toString().padStart(THRU_DECIMALS, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/**
 * Convert nanosecond epoch timestamps (the explorer's blockTimestampNs) to ISO 8601 UTC.
 * Returns an empty string when the field is missing or unparseable.
 */
export function nsToIso(ns: string | undefined | null): string {
  if (!ns || !/^\d+$/.test(ns.trim())) return '';
  const nanos = BigInt(ns.trim());
  const millis = Number(nanos / 1_000_000n);
  if (!Number.isFinite(millis)) return '';
  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString();
}

/** Did this transaction both reach consensus and execute without error? */
export function isSuccess(detail: TransactionDetail): boolean {
  const consensus = detail.consensusStatus?.kind?.toLowerCase();
  const execution = detail.executionError?.vmErrorStatus?.kind?.toLowerCase();
  const consensusOk = consensus === undefined || consensus === 'success';
  const executionOk = execution === undefined || execution === 'success';
  const vmErrorOk = detail.executionError?.vmError === undefined || detail.executionError.vmError === 0;
  return consensusOk && executionOk && vmErrorOk;
}

/**
 * Flatten one transaction detail into a spreadsheet row.
 *
 * `account` is the address the export was requested for; it decides the `role`
 * column, which tells you whether that account paid the fee or was merely
 * referenced by the transaction.
 */
export function toLedgerRow(
  detail: TransactionDetail,
  account: string,
  decoded?: { movement: Movement; events: DecodedEvent[] },
): LedgerRow {
  const timestampUtc = nsToIso(detail.blockTimestampNs);
  const readWrite = detail.accounts?.readWriteAccounts ?? [];
  const readOnly = detail.accounts?.readOnlyAccounts ?? [];
  const feePayer = detail.feePayer ?? detail.accounts?.feePayer ?? '';

  return {
    timestampUtc,
    date: timestampUtc ? timestampUtc.slice(0, 10) : '',
    slot: detail.slot ?? '',
    signature: detail.signature,
    program: detail.program ?? detail.accounts?.program ?? '',
    feePayer,
    role: feePayer === account ? 'fee-payer' : 'account-referenced',
    consensus: detail.consensusStatus?.label ?? '',
    execution: detail.executionError?.vmErrorStatus?.label ?? '',
    succeeded: isSuccess(detail),
    feeRaw: detail.fee ?? '',
    feeThru: formatThru(detail.fee),
    computeUnitsConsumed: detail.computeUnits?.consumed ?? '',
    stateUnitsConsumed: detail.stateUnits?.consumed ?? '',
    memoryUnitsConsumed: detail.memoryUnits?.consumed ?? '',
    transactionSizeBytes: detail.transactionSize ?? '',
    readWriteAccounts: readWrite.join(' '),
    readOnlyAccounts: readOnly.join(' '),
    eventsCount: detail.events?.eventsCount ?? detail.events?.events?.length ?? 0,
    action: decoded?.movement.action ?? '',
    tokenMint: decoded?.movement.tokenMint ?? '',
    tokenSymbol: decoded?.movement.tokenSymbol ?? '',
    amountRaw: decoded?.movement.amountRaw ?? '',
    amount: decoded?.movement.amount ?? '',
    direction: decoded?.movement.direction ?? '',
    counterparty: decoded?.movement.counterparty ?? '',
    tokenBalanceAfterRaw: decoded?.movement.tokenBalanceAfterRaw ?? '',
    tokenBalanceAfter: decoded?.movement.tokenBalanceAfter ?? '',
    eventsDecoded: decoded?.events.filter((event) => event.decoded).length ?? 0,
    explorerUrl: EXPLORER_TX_BASE + detail.signature,
    ...(decoded ? { events: decoded.events } : {}),
  };
}

/** Total fees paid, in raw units, by rows where the account was the fee payer. */
export function totalFeesPaidRaw(rows: LedgerRow[], account: string): string {
  let total = 0n;
  for (const row of rows) {
    if (row.feePayer !== account) continue;
    if (!/^\d+$/.test(row.feeRaw)) continue;
    total += BigInt(row.feeRaw);
  }
  return total.toString();
}
