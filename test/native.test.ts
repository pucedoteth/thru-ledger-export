import { describe, expect, it } from 'vitest';
import { decodeNativeTransfer, transactionAccounts } from '../src/native.js';
import { exportAccount } from '../src/export.js';
import { toCsv } from '../src/csv.js';
import type { TransactionDetail } from '../src/types.js';
import { EOA_RECIPIENT, EOA_SENDER, EOA_TX, FAUCET_TX, NOOP_TX } from './native-fixtures.js';
import {
  BURN_TX, INIT_ACCOUNT_TX, INIT_MINT_TX, MINT, MINT_BIG_TX, MINT_SMALL_TX, TOKEN_ABI_YAML, TOKEN_PROGRAM,
  TRANSFER_IN_TX, TRANSFER_OUT_TX, WALLET,
} from './token-fixtures.js';

describe('decodeNativeTransfer', () => {
  it('orders accounts as fee payer, program, read-write, read-only', () => {
    expect(transactionAccounts(EOA_TX)).toEqual([EOA_SENDER, EOA_TX.program, EOA_RECIPIENT]);
  });

  it('decodes a real EOA transfer', () => {
    expect(decodeNativeTransfer(EOA_TX)).toEqual({ kind: 'thru_transfer', from: EOA_SENDER, to: EOA_RECIPIENT, amountRaw: '1' });
  });

  it('decodes a real faucet withdrawal into the wallet', () => {
    expect(decodeNativeTransfer(FAUCET_TX)).toEqual({
      kind: 'faucet_withdraw', from: 'taxoImN8fTEOxXYnvgC6JZ0lN0n0qvZERwz_vlOjX3MkIn', to: WALLET, amountRaw: '10000',
    });
  });

  it('decodes a faucet deposit (layout from Thru\'s transaction builder)', () => {
    // discriminant 0, faucet idx 2, depositor idx 0, eoa idx 3, amount 500
    const deposit = { ...FAUCET_TX, instructions: { ...FAUCET_TX.instructions, instruction: '00000000' + '0200' + '0000' + '0300' + 'f401000000000000' } };
    expect(decodeNativeTransfer(deposit)).toMatchObject({ kind: 'faucet_deposit', from: WALLET, amountRaw: '500' });
  });

  it('ignores other programs, other instructions and malformed bytes', () => {
    expect(decodeNativeTransfer(NOOP_TX)).toBeUndefined();
    expect(decodeNativeTransfer(BURN_TX)).toBeUndefined();
    const bad = (instruction: string) => ({ ...EOA_TX, instructions: { ...EOA_TX.instructions, instruction } });
    expect(decodeNativeTransfer(bad('02000000010000000000000000000200'))).toBeUndefined(); // delete, not transfer
    expect(decodeNativeTransfer(bad('0100000001000000'))).toBeUndefined(); // too short
    expect(decodeNativeTransfer(bad('01000000010000000000000000000900'))).toBeUndefined(); // index out of range
    expect(decodeNativeTransfer(bad('zz'))).toBeUndefined();
  });
});

const DAY_NS = 86_400_000_000_000n;
/** Move a transaction a number of days later, to build a history that spans periods. */
const later = (tx: TransactionDetail, days: number): TransactionDetail =>
  ({ ...tx, blockTimestampNs: (BigInt(tx.blockTimestampNs!) + BigInt(days) * DAY_NS).toString() });

/** The wallet's real history, plus the two constructed transfers moved to October. */
const FULL_HISTORY = [
  NOOP_TX, FAUCET_TX, INIT_MINT_TX, INIT_ACCOUNT_TX, MINT_BIG_TX, MINT_SMALL_TX, BURN_TX,
  later(TRANSFER_OUT_TX, 11), later(TRANSFER_IN_TX, 12),
];

function historyFetch(history: TransactionDetail[], balanceRaw: string) {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const impl = async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    if (url.includes('/api/abi/')) {
      const program = decodeURIComponent(url.split('/api/abi/')[1]!);
      if (program !== TOKEN_PROGRAM) return json({ error: 'NOT_FOUND' }, 404);
      return json({ data: { programAddress: TOKEN_PROGRAM, programName: 'Token Program', abi: TOKEN_ABI_YAML } });
    }
    if (url.includes('/api/tx/')) {
      const signature = decodeURIComponent(url.split('/api/tx/')[1]!);
      return json({ data: history.find((tx) => tx.signature === signature) });
    }
    if (url.includes('/transactions')) {
      const transactions = [...history].reverse().map((tx) => ({ signature: tx.signature, slot: tx.slot }));
      return json({ data: { address: WALLET, transactions, pagination: { pageSize: 100 } } });
    }
    return json({ data: { address: WALLET, balance: '', balanceRaw } });
  };
  return impl as unknown as typeof fetch;
}

describe('native THRU in the export', () => {
  it('shows the faucet withdrawal as THRU coming in', async () => {
    const result = await exportAccount(WALLET, { fetchImpl: historyFetch(FULL_HISTORY, '10000') });
    const faucet = result.rows.find((row) => row.signature === FAUCET_TX.signature)!;
    expect(faucet).toMatchObject({
      action: 'faucet_withdraw', tokenMint: 'THRU', tokenSymbol: 'THRU', amountRaw: '10000', amount: '0.000010000',
      direction: 'in', counterparty: 'taxoImN8fTEOxXYnvgC6JZ0lN0n0qvZERwz_vlOjX3MkIn',
    });
  });

  it('works back THRU balances from today\'s balance, and the full history lands on zero', async () => {
    const result = await exportAccount(WALLET, { fetchImpl: historyFetch(FULL_HISTORY, '10000') });
    const balances = result.rows.map((row) => row.thruBalanceAfterRaw);
    expect(balances).toEqual(['0', '10000', '10000', '10000', '10000', '10000', '10000', '10000', '10000']);
    expect(result.thruCheck).toEqual({ historyComplete: true, derivedStartingBalanceRaw: '0', ok: true });
  });

  it('flags THRU that moved in a way the tool did not decode', async () => {
    const result = await exportAccount(WALLET, { fetchImpl: historyFetch(FULL_HISTORY, '25000') });
    expect(result.thruCheck).toEqual({ historyComplete: true, derivedStartingBalanceRaw: '15000', ok: false });
  });

  it('counts fees against the fee payer\'s THRU balance', async () => {
    const result = await exportAccount(EOA_SENDER, { fetchImpl: historyFetch([EOA_TX], '98') });
    expect(result.rows[0]).toMatchObject({ action: 'thru_transfer', direction: 'out', counterparty: EOA_RECIPIENT, amountRaw: '1', thruBalanceAfterRaw: '98' });
    // 98 now = 100 before - 1 sent - 1 fee
    expect(result.thruCheck?.derivedStartingBalanceRaw).toBe('100');
    const thru = result.tokenTotals.find((t) => t.tokenMint === 'THRU')!;
    expect(thru).toMatchObject({ openingBalanceRaw: '100', outRaw: '1', feesRaw: '1', closingBalanceRaw: '98', reconciles: true });
  });

  it('does not count a failed transfer', async () => {
    const failed = { ...EOA_TX, executionError: { vmErrorStatus: { label: 'Failed', kind: 'error' }, vmError: -1 } };
    const result = await exportAccount(EOA_SENDER, { fetchImpl: historyFetch([failed], '99') });
    expect(result.rows[0]).toMatchObject({ action: '', amountRaw: '' });
    expect(result.thruCheck?.derivedStartingBalanceRaw).toBe('100'); // the fee is still paid
  });

  it('adds the THRU balance columns to the CSV', async () => {
    const result = await exportAccount(WALLET, { fetchImpl: historyFetch(FULL_HISTORY, '10000') });
    const header = toCsv(result.rows, { bom: false }).split('\r\n')[0]!;
    expect(header).toContain('eventsDecoded,thruBalanceAfterRaw,thruBalanceAfter,explorerUrl');
  });
});

describe('period opening and closing balances', () => {
  it('reconciles opening + in - out = closing for a later period', async () => {
    const result = await exportAccount(WALLET, { fetchImpl: historyFetch(FULL_HISTORY, '10000'), from: '2026-10-01' });
    expect(result.rows.map((row) => row.action)).toEqual(['transfer', 'transfer']);
    const mft = result.tokenTotals.find((t) => t.tokenMint === MINT)!;
    expect(mft).toMatchObject({
      openingBalanceRaw: '1000000006567', inRaw: '1000000', outRaw: '2500000',
      closingBalanceRaw: '999998506567', closingBalance: '999998.506567', reconciles: true,
    });
    const thru = result.tokenTotals.find((t) => t.tokenMint === 'THRU')!;
    expect(thru).toMatchObject({ openingBalanceRaw: '10000', closingBalanceRaw: '10000', inRaw: '0', reconciles: true });
  });

  it('starts every token at zero when the whole history is exported', async () => {
    const result = await exportAccount(WALLET, { fetchImpl: historyFetch(FULL_HISTORY, '10000'), to: '2026-09-30' });
    const mft = result.tokenTotals.find((t) => t.tokenMint === MINT)!;
    expect(mft).toMatchObject({ openingBalanceRaw: '0', inRaw: '1000000006589', outRaw: '22', closingBalanceRaw: '1000000006567', reconciles: true });
    const thru = result.tokenTotals.find((t) => t.tokenMint === 'THRU')!;
    expect(thru).toMatchObject({ openingBalanceRaw: '0', inRaw: '10000', closingBalanceRaw: '10000', reconciles: true });
  });

  it('leaves openings unknown, not zero, when --limit cuts the history short', async () => {
    const result = await exportAccount(WALLET, { fetchImpl: historyFetch(FULL_HISTORY, '10000'), limit: 2 });
    expect(result.historyComplete).toBe(false);
    expect(result.thruCheck?.ok).toBeNull();
    const mft = result.tokenTotals.find((t) => t.tokenMint === MINT);
    // Ownership of the token account comes from its creation, which --limit cut off.
    expect(mft).toBeUndefined();
    const told = await exportAccount(WALLET, {
      fetchImpl: historyFetch(FULL_HISTORY, '10000'), limit: 2, tokenAccounts: ['ta65HhDjlQbCqtHqxF613QF4u7vpTM8IUwIW9piuq4CR_L'],
    });
    expect(told.tokenTotals.find((t) => t.tokenMint === '')).toBeUndefined();
    const rows = told.rows.filter((row) => row.action === 'transfer');
    expect(rows.map((row) => row.direction)).toEqual(['out', 'in']);
  });
});
