import type { LedgerRow } from './types.js';

export const CSV_COLUMNS: (keyof LedgerRow)[] = [
  'timestampUtc',
  'date',
  'slot',
  'signature',
  'program',
  'feePayer',
  'role',
  'consensus',
  'execution',
  'succeeded',
  'feeRaw',
  'feeThru',
  'computeUnitsConsumed',
  'stateUnitsConsumed',
  'memoryUnitsConsumed',
  'transactionSizeBytes',
  'readWriteAccounts',
  'readOnlyAccounts',
  'eventsCount',
  'action',
  'tokenMint',
  'tokenSymbol',
  'amountRaw',
  'amount',
  'direction',
  'counterparty',
  'tokenBalanceAfterRaw',
  'tokenBalanceAfter',
  'eventsDecoded',
  'thruBalanceAfterRaw',
  'thruBalanceAfter',
  'explorerUrl',
];

/**
 * Quote a single CSV field (RFC 4180).
 *
 * Values starting with =, +, - or @ are prefixed with a single quote so that
 * Excel and Sheets treat them as text instead of formulas.
 */
export function escapeCsvField(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** Render rows as CSV text. Excel reads the UTF-8 BOM, so accents survive. */
export function toCsv(rows: LedgerRow[], options: { bom?: boolean } = {}): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const row of rows) {
    lines.push(CSV_COLUMNS.map((column) => escapeCsvField(row[column])).join(','));
  }
  const text = lines.join('\r\n') + '\r\n';
  return options.bom === false ? text : '﻿' + text;
}
