import { describe, expect, it } from 'vitest';
import { exportAccount } from '../src/export.js';
import { applyKnownMints } from '../src/mints.js';
import { buildTokenContext } from '../src/events.js';
import { parseArgs } from '../src/args.js';
import { TOKEN_ABI_YAML } from './token-fixtures.js';
import {
  THRUSD_FAUCET_MINT_TX, THRUSD_INIT_ACCOUNT_TX, THRUSD_LISTINGS, THRUSD_MINT, THRUSD_TOKEN_ACCOUNT,
  THRUSD_WALLET, TOKEN_PROGRAM_V2, WALLET_CREATED_TX,
} from './thrusd-fixtures.js';

const ALL = [WALLET_CREATED_TX, THRUSD_INIT_ACCOUNT_TX, THRUSD_FAUCET_MINT_TX];

/**
 * Serves the captured alphanet data. The Token Program's live ABI is
 * byte-for-byte the fixture ABI (same 14,556 bytes and SHA-256, checked
 * 2026-10-23); the Wallet Program's ABI is not served, so its events stay
 * undecoded, as they would if the explorer had none.
 */
function fakeExplorer() {
  const calls: string[] = [];
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  const impl = async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    calls.push(url);
    const path = decodeURIComponent(url.replace('https://scan.thru.org', '').split('?')[0]!);
    if (path.startsWith('/api/abi/')) {
      return path.endsWith(TOKEN_PROGRAM_V2)
        ? json({ data: { programAddress: TOKEN_PROGRAM_V2, programName: 'Token Program', abi: TOKEN_ABI_YAML } })
        : new Response('no abi', { status: 404 });
    }
    if (path.startsWith('/api/tx/')) {
      const signature = path.slice('/api/tx/'.length);
      return json({ data: ALL.find((tx) => tx.signature === signature) });
    }
    const list = path.match(/^\/api\/address\/([^/]+)\/transactions$/);
    if (list) {
      const transactions = (THRUSD_LISTINGS[list[1]!] ?? []).map((tx) => ({ signature: tx.signature, slot: tx.slot }));
      return json({ data: { address: list[1], transactions, pagination: { pageSize: 100 } } });
    }
    const address = path.slice('/api/address/'.length);
    return json({ data: { address, balance: '0 THRU', balanceRaw: '0' } });
  };
  return { impl: impl as unknown as typeof fetch, calls };
}

describe('wallet export with a THRUSD token account', () => {
  it('includes tokens received into the wallet’s token account, in readable amounts', async () => {
    const { impl } = fakeExplorer();
    const result = await exportAccount(THRUSD_WALLET, { fetchImpl: impl });

    expect(result.tokenAccountsFollowed).toEqual([THRUSD_TOKEN_ACCOUNT]);
    expect(result.rows.map((row) => row.signature)).toEqual(ALL.map((tx) => tx.signature));

    const mint = result.rows[2]!;
    expect(mint).toMatchObject({
      action: 'mint_to',
      tokenMint: THRUSD_MINT,
      tokenSymbol: 'THRUSD',
      amountRaw: '100000000',
      amount: '100.000000',
      direction: 'in',
      tokenBalanceAfterRaw: '100000000',
      tokenBalanceAfter: '100.000000',
      feeRaw: '0',
    });
    expect(result.rows[1]).toMatchObject({ action: 'initialize_account', tokenMint: THRUSD_MINT, tokenSymbol: 'THRUSD' });
  });

  it('reconciles THRUSD from zero to the 100 the faucet sent', async () => {
    const { impl } = fakeExplorer();
    const result = await exportAccount(THRUSD_WALLET, { fetchImpl: impl });
    const thrusd = result.tokenTotals.find((total) => total.tokenMint === THRUSD_MINT);

    expect(thrusd).toMatchObject({
      tokenSymbol: 'THRUSD', decimals: 6,
      openingBalance: '0.000000', in: '100.000000', out: '0.000000', closingBalance: '100.000000',
      reconciles: true,
    });
    expect(result.thruCheck?.ok).toBe(true);
  });

  it('fetches the shared initialize_account transaction only once', async () => {
    const { impl, calls } = fakeExplorer();
    await exportAccount(THRUSD_WALLET, { fetchImpl: impl });
    const fetchedInit = calls.filter((url) => url.includes(encodeURIComponent(THRUSD_INIT_ACCOUNT_TX.signature)));
    expect(fetchedInit).toHaveLength(1);
    expect(calls.filter((url) => url.includes('/api/abi/' + TOKEN_PROGRAM_V2))).toHaveLength(1);
  });

  it('keeps the v0.4 behaviour with followTokenAccounts: false', async () => {
    const { impl, calls } = fakeExplorer();
    const result = await exportAccount(THRUSD_WALLET, { fetchImpl: impl, followTokenAccounts: false });
    expect(result.rows).toHaveLength(2);
    expect(result.tokenAccountsFollowed).toEqual([]);
    expect(calls.some((url) => url.includes(encodeURIComponent(THRUSD_TOKEN_ACCOUNT) + '/transactions'))).toBe(false);
  });

  it('does not follow anything with --no-decode', async () => {
    const { impl } = fakeExplorer();
    const result = await exportAccount(THRUSD_WALLET, { fetchImpl: impl, decode: false });
    expect(result.rows).toHaveLength(2);
    expect(result.tokenAccountsFollowed).toEqual([]);
  });
});

describe('token account export', () => {
  it('labels THRUSD and applies its 6 decimals', async () => {
    const { impl } = fakeExplorer();
    const result = await exportAccount(THRUSD_TOKEN_ACCOUNT, { fetchImpl: impl });
    expect(result.rows.at(-1)).toMatchObject({ tokenSymbol: 'THRUSD', amount: '100.000000', direction: 'in' });
    expect(result.tokenAccountsFollowed).toEqual([]);
  });
});

describe('applyKnownMints', () => {
  it('fills THRUSD on alphanet but leaves other networks alone', () => {
    const alpha = applyKnownMints(buildTokenContext(THRUSD_WALLET, []), 'alphanet');
    expect(alpha.mints.get(THRUSD_MINT)).toEqual({ ticker: 'THRUSD', decimals: 6 });
    const beta = applyKnownMints(buildTokenContext(THRUSD_WALLET, []), 'betanet');
    expect(beta.mints.has(THRUSD_MINT)).toBe(false);
  });

  it('lets what the history says win over the table', () => {
    const context = buildTokenContext(THRUSD_WALLET, []);
    context.mints.set(THRUSD_MINT, { ticker: 'TUSD', decimals: 2 });
    expect(applyKnownMints(context, 'alphanet').mints.get(THRUSD_MINT)).toEqual({ ticker: 'TUSD', decimals: 2 });
  });
});

describe('--no-token-accounts', () => {
  it('turns following off', () => {
    expect(parseArgs(['ta']).followTokenAccounts).toBe(true);
    expect(parseArgs(['ta', '--no-token-accounts']).followTokenAccounts).toBe(false);
  });
});
