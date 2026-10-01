import { describe, expect, it } from 'vitest';
import { exportAccount } from '../src/export.js';
import { EOA_PROGRAM, isAccountCreation, NOOP_PROGRAM } from '../src/native.js';
import type { TransactionDetail } from '../src/types.js';

/**
 * Real Betanet transactions, captured from scan.thru.org?network=betanet on 2026-10-01.
 * `thru account create` sends a NOOP transaction with a fee-payer state proof (flags bit 0).
 */
const included = { label: 'Included', kind: 'success' } as const;
const success = { vmErrorStatus: { label: 'Success', kind: 'success' }, vmError: 0, userErrorCode: '0' } as const;

const NEW_ACCOUNT = 'talZRRupSjcXDQg8uVCjoLAHS-alRHZgJ3NgzlKJ-p3aV9';
const CREATE_TX: TransactionDetail = {
  slot: 33555,
  signature: 'ts2qju6IzAFegfRk4gd8QtnWCUU4Ai5GiF1r9xPFuasZw_6XMXTq7wIfcWfO-OsM3AqF5Fr-OnSaD4WxdrRMuWCSGp',
  consensusStatus: included,
  executionError: success,
  fee: '0',
  computeUnits: { requested: '10000', consumed: '4763' },
  blockTimestampNs: '1790834752053997861',
  flags: 1,
  feePayer: NEW_ACCOUNT,
  program: NOOP_PROGRAM,
  transactionSize: 280,
  accounts: { readWriteAccounts: [], readOnlyAccounts: [] },
  instructions: { instructionDataSize: 0, programAddress: NOOP_PROGRAM },
};

/** A plain NOOP call from an existing account: no proof, so nothing is created. */
const PINGER = 'ta1BMfx99tyS09YPc-49hdm6rsHV7FeHhELFM3r39GvPd7';
const NOOP_TX: TransactionDetail = {
  slot: 68192,
  signature: 'tsSR-oEXncllINiIqU27Cjv5C4lfYNxckxevAwaZSo0dqOYQApHhWqEAcN5rz_8TfZhAnfqfuTsbwPDN8y_nQcBiAS',
  consensusStatus: included,
  executionError: success,
  fee: '0',
  computeUnits: { requested: '300000000', consumed: '4763' },
  blockTimestampNs: '1790864216145344356',
  flags: 0,
  feePayer: PINGER,
  program: NOOP_PROGRAM,
  transactionSize: 177,
  accounts: { readWriteAccounts: [], readOnlyAccounts: [] },
  instructions: { instructionDataSize: 1, programAddress: NOOP_PROGRAM },
};

function fakeExplorer(history: TransactionDetail[], address: string, balanceRaw: string) {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  return (async (input: string | URL | Request): Promise<Response> => {
    const path = String(input).split('?')[0]!;
    if (path.includes('/api/abi/')) return json({ error: 'NOT_FOUND' }, 404);
    if (path.includes('/api/tx/')) {
      const signature = decodeURIComponent(path.split('/api/tx/')[1]!);
      return json({ data: history.find((tx) => tx.signature === signature) });
    }
    if (path.endsWith('/transactions')) {
      const transactions = [...history].reverse().map((tx) => ({ signature: tx.signature, slot: tx.slot }));
      return json({ data: { address, transactions, pagination: { pageSize: 100 } } });
    }
    return json({ data: { address, balanceRaw } });
  }) as unknown as typeof fetch;
}

describe('account creation', () => {
  it('recognises a real account creation, for the new account only', () => {
    expect(isAccountCreation(CREATE_TX, NEW_ACCOUNT)).toBe(true);
    expect(isAccountCreation(CREATE_TX, PINGER)).toBe(false);
  });

  it('does not treat a plain NOOP call, or a proof sent to another program, as a creation', () => {
    expect(isAccountCreation(NOOP_TX, PINGER)).toBe(false);
    // Constructed: the same proof-carrying transaction, sent to the EOA program instead.
    const elsewhere = { ...CREATE_TX, program: EOA_PROGRAM, accounts: {}, instructions: { programAddress: EOA_PROGRAM } };
    expect(isAccountCreation(elsewhere, NEW_ACCOUNT)).toBe(false);
  });

  it('labels the first row account_create, and the THRU balance still works back to zero', async () => {
    const result = await exportAccount(NEW_ACCOUNT, { fetchImpl: fakeExplorer([CREATE_TX], NEW_ACCOUNT, '0'), network: 'betanet' });
    expect(result.rows[0]).toMatchObject({ action: 'account_create', direction: '', amountRaw: '', succeeded: true });
    expect(result.thruCheck).toEqual({ historyComplete: true, derivedStartingBalanceRaw: '0', ok: true });
  });

  it('leaves a plain NOOP call and a reverted creation unlabelled', async () => {
    const noop = await exportAccount(PINGER, { fetchImpl: fakeExplorer([NOOP_TX], PINGER, '0') });
    expect(noop.rows[0]!.action).toBe('');

    // Constructed: the same creation, reverted.
    const failed: TransactionDetail = {
      ...CREATE_TX,
      signature: 'tsConstructedRevertedCreation',
      executionError: { vmErrorStatus: { label: 'Vm Revert', kind: 'failed' }, vmError: -765, userErrorCode: '0' },
    };
    const reverted = await exportAccount(NEW_ACCOUNT, { fetchImpl: fakeExplorer([failed], NEW_ACCOUNT, '0') });
    expect(reverted.rows[0]).toMatchObject({ action: '', succeeded: false });
  });
});
