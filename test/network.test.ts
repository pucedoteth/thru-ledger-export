import { describe, expect, it } from 'vitest';
import { ThruExplorerClient } from '../src/client.js';
import { exportAccount } from '../src/export.js';
import { parseArgs } from '../src/args.js';
import { decodeNativeTransfer, EOA_PROGRAM, FAUCET_PROGRAM } from '../src/native.js';
import type { TransactionDetail } from '../src/types.js';

/**
 * Real transactions from Alphanet after its reset onto the Thru v0.4.0
 * program addresses, captured from scan.thru.org?network=alphanet on 2026-09-28.
 */
const included = { label: 'Included', kind: 'success' } as const;
const success = { vmErrorStatus: { label: 'Success', kind: 'success' }, vmError: 0, userErrorCode: '0' } as const;

const RECIPIENT = 'taUd0q73G-3e4xUqXHNYJ2DERyr1ynw184iuzSlUlLMrWD';
const FAUCET_VAULT = 'taTigKYAf5mNxUNUVXeXq1HQodKc07DBzF4Pl7tCi1iXxt';

/** Someone else pays the fee; 10,000 raw THRU goes from the faucet vault (index 2) to RECIPIENT (index 3). */
const FAUCET_TX: TransactionDetail = {
  slot: 116597,
  signature: 'tstEBjL5tTMJkTdMdlt29nKiQOkAwnL0SUzt2ceEWCYBNva0-bd8VThS-35_uCTMpZe8WxD98PHgQoZ4zViTWwARuc',
  consensusStatus: included,
  executionError: success,
  fee: '0',
  computeUnits: { requested: '300000', consumed: '32527' },
  blockTimestampNs: '1790608371501663028',
  feePayer: 'taRvGXFYU22SQfIXDHniizxP8LTfrNTs4RN9jeYjaIebzc',
  program: FAUCET_PROGRAM,
  transactionSize: 256,
  accounts: { readWriteAccounts: [FAUCET_VAULT, RECIPIENT], readOnlyAccounts: [] },
  instructions: { instruction: '01000000020003001027000000000000', programAddress: FAUCET_PROGRAM },
};

const SENDER = 'taMAqUpVqQP-urTLyn1bWz1KZ6K_Vh6aoqOzs1nAFv7Skd';
const PAYEE = 'taTP_D39wKyxBZwaPhPJ_uhqC6R_83zwnVODm3a_Wl-A5S';

/** A successful 7-raw THRU transfer through the new EOA program address. */
const EOA_TX: TransactionDetail = {
  slot: 116955,
  signature: 'tswp94OF9KCIK0dR24UlPQedLAW9xonUIk0mei2h3JQg8rX7SHob3IHlG2zptFI-nQkp23xuk0lWS28yy1YSRBAR_9',
  consensusStatus: included,
  executionError: success,
  fee: '1',
  computeUnits: { requested: '10000', consumed: '5629' },
  blockTimestampNs: '1790608390640878814',
  feePayer: SENDER,
  program: EOA_PROGRAM,
  transactionSize: 224,
  accounts: { readWriteAccounts: [PAYEE], readOnlyAccounts: [] },
  instructions: { instruction: '01000000070000000000000000000200', programAddress: EOA_PROGRAM },
};

/** The same kind of transfer (2 raw) that reverted: it must not count, though its fee does. */
const EOA_REVERTED_TX: TransactionDetail = {
  slot: 116615,
  signature: 'tsQ3qHrcb49sjpzdvCf77K-hOpRVNjbIOfxMtXM11olyGyapzN-7kd3bLhkWQk4yRA1DqBk3DsybbBZ7HyigOZASSx',
  consensusStatus: included,
  executionError: { vmErrorStatus: { label: 'Vm Revert', kind: 'failed' }, vmError: -765, userErrorCode: '18446744073709551607' },
  fee: '1',
  computeUnits: { requested: '10000', consumed: '5631' },
  blockTimestampNs: '1790608372458952893',
  feePayer: 'taMzhzBQFn9QLRCSQoIf_jSK-8q5hTCm4fsl34w-RogoRn',
  program: EOA_PROGRAM,
  transactionSize: 224,
  accounts: { readWriteAccounts: ['taWUc8qScG4clVDagCc1fUTcBx27eGzbyFCK-R4MQzyWf5'], readOnlyAccounts: [] },
  instructions: { instruction: '01000000020000000000000000000200', programAddress: EOA_PROGRAM },
};

function fakeExplorer(history: TransactionDetail[], address: string, balanceRaw: string) {
  const calls: string[] = [];
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const impl = async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    calls.push(url);
    const path = url.split('?')[0]!;
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
  };
  return { impl: impl as unknown as typeof fetch, calls };
}

describe('choosing a network', () => {
  it('names the network on every request, alphanet by default', async () => {
    const { impl, calls } = fakeExplorer([EOA_TX], PAYEE, '7');
    await exportAccount(PAYEE, { fetchImpl: impl });
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((url) => new URL(url).searchParams.get('network') === 'alphanet')).toBe(true);
  });

  it('sends network=betanet when asked, next to other query parameters', async () => {
    const { impl, calls } = fakeExplorer([EOA_TX], PAYEE, '7');
    const result = await exportAccount(PAYEE, { fetchImpl: impl, network: 'betanet' });
    expect(result.network).toBe('betanet');
    const list = calls.find((url) => url.includes('/transactions?'))!;
    expect(new URL(list).searchParams.get('pageSize')).toBe('100');
    expect(new URL(list).searchParams.getAll('network')).toEqual(['betanet']);
    expect(result.rows[0]!.explorerUrl).toBe(`https://scan.thru.org/tx/${EOA_TX.signature}?network=betanet`);
  });

  it('exposes the network on the client', () => {
    expect(new ThruExplorerClient({ fetchImpl: fetch }).network).toBe('alphanet');
    expect(new ThruExplorerClient({ fetchImpl: fetch, network: 'betanet' }).network).toBe('betanet');
  });

  it('parses --network and -n, and rejects names that are not slugs', () => {
    expect(parseArgs(['x', '--network', 'betanet']).network).toBe('betanet');
    expect(parseArgs(['x', '-n', 'alphanet']).network).toBe('alphanet');
    expect(parseArgs(['x']).network).toBeUndefined();
    expect(() => parseArgs(['x', '--network', 'Beta Net'])).toThrow(/network name/);
  });
});

describe('native THRU on the new program addresses', () => {
  it('decodes a real faucet withdrawal paid for by someone else', () => {
    expect(decodeNativeTransfer(FAUCET_TX)).toEqual({ kind: 'faucet_withdraw', from: FAUCET_VAULT, to: RECIPIENT, amountRaw: '10000' });
  });

  it('decodes a real EOA transfer', () => {
    expect(decodeNativeTransfer(EOA_TX)).toEqual({ kind: 'thru_transfer', from: SENDER, to: PAYEE, amountRaw: '7' });
  });

  it('shows both sides of a transfer, and works each balance back to zero', async () => {
    const payee = await exportAccount(PAYEE, { fetchImpl: fakeExplorer([EOA_TX], PAYEE, '7').impl });
    expect(payee.rows[0]).toMatchObject({ action: 'thru_transfer', direction: 'in', counterparty: SENDER, amount: '0.000000007' });
    expect(payee.thruCheck).toEqual({ historyComplete: true, derivedStartingBalanceRaw: '0', ok: true });

    const recipient = await exportAccount(RECIPIENT, { fetchImpl: fakeExplorer([FAUCET_TX], RECIPIENT, '10000').impl });
    expect(recipient.rows[0]).toMatchObject({ action: 'faucet_withdraw', direction: 'in', role: 'account-referenced' });
    expect(recipient.thruCheck?.ok).toBe(true);
  });

  it('does not count a real reverted transfer, but still counts its fee', async () => {
    const payer = EOA_REVERTED_TX.feePayer!;
    const result = await exportAccount(payer, { fetchImpl: fakeExplorer([EOA_REVERTED_TX], payer, '99').impl });
    expect(result.rows[0]).toMatchObject({ succeeded: false, action: '', amountRaw: '' });
    expect(result.thruCheck?.derivedStartingBalanceRaw).toBe('100');
  });
});
