import { describe, expect, it } from 'vitest';
import { formatThru, nsToIso, isSuccess, toLedgerRow, totalFeesPaidRaw } from '../src/normalize.js';
import { ACCOUNT, ORACLE_TX, SYSTEM_TX } from './fixtures.js';

describe('formatThru', () => {
  it('matches the explorer: 10000 raw = 0.00001 THRU', () => {
    expect(formatThru('10000')).toBe('0.000010000');
    expect(formatThru('10175')).toBe('0.000010175');
  });

  it('handles zero, whole units and very large amounts without precision loss', () => {
    expect(formatThru('0')).toBe('0.000000000');
    expect(formatThru('1000000000')).toBe('1.000000000');
    expect(formatThru('123456789012345678901')).toBe('123456789012.345678901');
  });

  it('returns an empty string for missing or malformed input', () => {
    expect(formatThru(undefined)).toBe('');
    expect(formatThru('')).toBe('');
    expect(formatThru('12.5')).toBe('');
    expect(formatThru('abc')).toBe('');
  });
});

describe('nsToIso', () => {
  it('converts nanosecond timestamps to ISO 8601 UTC', () => {
    expect(nsToIso(ORACLE_TX.blockTimestampNs)).toBe('2026-09-20T16:28:47.334Z');
  });

  it('is empty for missing or malformed values', () => {
    expect(nsToIso(undefined)).toBe('');
    expect(nsToIso('not-a-number')).toBe('');
  });
});

describe('isSuccess', () => {
  it('accepts a transaction that reached consensus and executed cleanly', () => {
    expect(isSuccess(ORACLE_TX)).toBe(true);
  });

  it('rejects a VM error even when consensus succeeded', () => {
    expect(isSuccess({
      ...ORACLE_TX,
      executionError: { vmErrorStatus: { label: 'OutOfCompute', kind: 'error' }, vmError: 7 },
    })).toBe(false);
  });

  it('rejects a transaction that failed consensus', () => {
    expect(isSuccess({ ...ORACLE_TX, consensusStatus: { label: 'Dropped', kind: 'error' } })).toBe(false);
  });
});

describe('toLedgerRow', () => {
  const row = toLedgerRow(ORACLE_TX, ACCOUNT);

  it('carries the accounting fields a bookkeeper needs', () => {
    expect(row.date).toBe('2026-09-20');
    expect(row.slot).toBe(13132384);
    expect(row.feeThru).toBe('0.000000000');
    expect(row.computeUnitsConsumed).toBe('24985');
    expect(row.succeeded).toBe(true);
    expect(row.eventsCount).toBe(2);
    expect(row.explorerUrl).toBe(`https://scan.thru.org/tx/${ORACLE_TX.signature}`);
  });

  it('labels the role relative to the exported account', () => {
    expect(toLedgerRow(ORACLE_TX, ACCOUNT).role).toBe('fee-payer');
    expect(toLedgerRow(SYSTEM_TX, ACCOUNT).role).toBe('account-referenced');
  });

  it('space-separates related accounts so a cell stays parseable', () => {
    expect(row.readWriteAccounts.split(' ')).toHaveLength(2);
    expect(row.readOnlyAccounts).toBe('taQlmNDxbXJUeInC24XEAhKw66BpqtcAraLMeA4PgBwPTq');
  });

  it('tolerates a sparse transaction', () => {
    const sparse = toLedgerRow({ signature: 'tsX' }, ACCOUNT);
    expect(sparse.timestampUtc).toBe('');
    expect(sparse.slot).toBe('');
    expect(sparse.eventsCount).toBe(0);
  });
});

describe('totalFeesPaidRaw', () => {
  it('counts only fees this account actually paid', () => {
    const rows = [toLedgerRow(ORACLE_TX, ACCOUNT), toLedgerRow(SYSTEM_TX, ACCOUNT)];
    expect(totalFeesPaidRaw(rows, ACCOUNT)).toBe('0');
    expect(totalFeesPaidRaw(rows, SYSTEM_TX.feePayer!)).toBe('1');
  });

  it('sums beyond Number.MAX_SAFE_INTEGER exactly', () => {
    const big = { ...ORACLE_TX, fee: '9007199254740993' };
    const rows = [toLedgerRow(big, ACCOUNT), toLedgerRow(big, ACCOUNT)];
    expect(totalFeesPaidRaw(rows, ACCOUNT)).toBe('18014398509481986');
  });
});
