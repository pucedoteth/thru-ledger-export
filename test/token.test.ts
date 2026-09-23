import { describe, expect, it } from 'vitest';
import { parseAbi } from '../src/abi.js';
import { buildTokenContext, decodeEvents, formatUnits, primaryMovement } from '../src/events.js';
import { exportAccount } from '../src/export.js';
import { toCsv } from '../src/csv.js';
import { ORACLE_TX } from './fixtures.js';
import {
  BURN_TX, INIT_ACCOUNT_TX, MINT, MINT_BIG_TX, OTHER_ACCOUNT, TOKEN_ABI_YAML, TOKEN_ACCOUNT, TOKEN_HISTORY,
  TOKEN_PROGRAM, TRANSFER_IN_TX, TRANSFER_OUT_TX, WALLET,
} from './token-fixtures.js';

const tokenAbi = parseAbi(TOKEN_ABI_YAML, 'Token Program');
const lookup = (program: string) => (program === TOKEN_PROGRAM ? tokenAbi : undefined);
const allEvents = TOKEN_HISTORY.flatMap((tx) => decodeEvents(tx, lookup));

describe('formatUnits', () => {
  it('formats exactly with the given decimals', () => {
    expect(formatUnits('1000000006567', 6)).toBe('1000000.006567');
    expect(formatUnits('22', 6)).toBe('0.000022');
    expect(formatUnits('5', 0)).toBe('5');
  });

  it('is empty when decimals are unknown', () => {
    expect(formatUnits('22', undefined)).toBe('');
  });
});

describe('decodeEvents', () => {
  it('reports events without a published ABI instead of dropping them', () => {
    const events = decodeEvents(ORACLE_TX, lookup);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ decoded: false, error: 'No ABI published' });
  });

  it('reports payloads that do not fit the ABI', () => {
    const broken = { ...BURN_TX, events: { events: [{ programAddress: TOKEN_PROGRAM, payloadHex: '04beef' }] } };
    expect(decodeEvents(broken, lookup)[0]).toMatchObject({ decoded: false, type: '' });
  });
});

describe('buildTokenContext', () => {
  it('learns the wallet owns its token account, and the mint ticker and decimals', () => {
    const context = buildTokenContext(WALLET, allEvents);
    expect(context.owned.has(TOKEN_ACCOUNT)).toBe(true);
    expect(context.accountMint.get(TOKEN_ACCOUNT)).toBe(MINT);
    expect(context.mints.get(MINT)).toEqual({ decimals: 6, ticker: 'MFT' });
  });
});

describe('primaryMovement', () => {
  const context = buildTokenContext(WALLET, allEvents);
  const movementOf = (tx: typeof BURN_TX) => primaryMovement(decodeEvents(tx, lookup), context);

  it('describes a mint into the wallet as money in, with the on-chain balance after', () => {
    expect(movementOf(MINT_BIG_TX)).toEqual({
      action: 'mint_to', tokenMint: MINT, tokenSymbol: 'MFT',
      amountRaw: '1000000000000', amount: '1000000.000000', direction: 'in', counterparty: '',
      tokenBalanceAfterRaw: '1000000000000', tokenBalanceAfter: '1000000.000000',
    });
  });

  it('describes a burn as money out', () => {
    expect(movementOf(BURN_TX)).toMatchObject({
      action: 'burn', amountRaw: '22', amount: '0.000022', direction: 'out', tokenBalanceAfterRaw: '1000000006567',
    });
  });

  it('describes transfers both ways, with the counterparty and the mint from the token account', () => {
    expect(movementOf(TRANSFER_OUT_TX)).toMatchObject({
      action: 'transfer', tokenMint: MINT, amount: '2.500000', direction: 'out', counterparty: OTHER_ACCOUNT,
      tokenBalanceAfter: '999997.506567',
    });
    expect(movementOf(TRANSFER_IN_TX)).toMatchObject({
      direction: 'in', counterparty: OTHER_ACCOUNT, amountRaw: '1000000', tokenBalanceAfterRaw: '999998506567',
    });
  });

  it('labels account setup without inventing an amount', () => {
    expect(movementOf(INIT_ACCOUNT_TX)).toMatchObject({ action: 'initialize_account', tokenMint: MINT, amountRaw: '', direction: '' });
  });

  it('without ownership information, shows the movement but no direction', () => {
    const blind = buildTokenContext(WALLET, []);
    expect(primaryMovement(decodeEvents(TRANSFER_OUT_TX, lookup), blind)).toMatchObject({
      action: 'transfer', direction: '', amountRaw: '2500000', tokenBalanceAfterRaw: '',
    });
    const told = buildTokenContext(WALLET, [], [TOKEN_ACCOUNT]);
    expect(primaryMovement(decodeEvents(TRANSFER_OUT_TX, lookup), told)).toMatchObject({ direction: 'out' });
  });
});

/** Serves TOKEN_HISTORY (newest first, as the explorer does) and the Token Program ABI. */
function tokenFetch() {
  const calls: string[] = [];
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const impl = async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    calls.push(url);
    if (url.includes('/api/abi/')) {
      const program = decodeURIComponent(url.split('/api/abi/')[1]!);
      if (program !== TOKEN_PROGRAM) return json({ error: 'NOT_FOUND' }, 404);
      return json({ data: { programAddress: TOKEN_PROGRAM, programName: 'Token Program', abi: TOKEN_ABI_YAML } });
    }
    if (url.includes('/api/tx/')) {
      const signature = decodeURIComponent(url.split('/api/tx/')[1]!);
      return json({ data: TOKEN_HISTORY.find((tx) => tx.signature === signature) });
    }
    if (url.includes('/transactions')) {
      const transactions = [...TOKEN_HISTORY].reverse().map((tx) => ({ signature: tx.signature, slot: tx.slot }));
      return json({ data: { address: WALLET, transactions, pagination: { pageSize: 100 } } });
    }
    return json({ data: { address: WALLET, balance: '0.00001 THRU', balanceRaw: '10000' } });
  };
  return { impl: impl as unknown as typeof fetch, calls };
}

describe('exportAccount with decoding', () => {
  it('fills the amount columns and fetches each ABI only once', async () => {
    const { impl, calls } = tokenFetch();
    const result = await exportAccount(WALLET, { fetchImpl: impl });

    expect(calls.filter((url) => url.includes('/api/abi/'))).toHaveLength(1);
    expect(result.rows.map((row) => row.action)).toEqual([
      'initialize_mint', 'initialize_account', 'mint_to', 'mint_to', 'burn', 'transfer', 'transfer',
    ]);
    expect(result.rows.map((row) => row.direction)).toEqual(['', '', 'in', 'in', 'out', 'out', 'in']);
    expect(result.rows.every((row) => row.eventsDecoded === 1)).toBe(true);
  });

  it('totals each token, and the totals reconcile to the closing balance', async () => {
    const { impl } = tokenFetch();
    const result = await exportAccount(WALLET, { fetchImpl: impl });
    expect(result.tokenTotals).toEqual([{
      tokenMint: MINT, tokenSymbol: 'MFT', decimals: 6,
      inRaw: '1000001006589', outRaw: '2500022', netRaw: '999998506567',
      in: '1000001.006589', out: '2.500022', net: '999998.506567',
      closingBalanceRaw: '999998506567', closingBalance: '999998.506567',
    }]);
  });

  it('learns ownership from the full history even when a date filter hides the setup rows', async () => {
    const { impl } = tokenFetch();
    const result = await exportAccount(WALLET, { fetchImpl: impl, from: '2026-09-20' });
    const burn = result.rows.find((row) => row.action === 'burn');
    expect(burn?.direction).toBe('out');
  });

  it('adds the new columns to the CSV and keeps full events for JSON only', async () => {
    const { impl } = tokenFetch();
    const result = await exportAccount(WALLET, { fetchImpl: impl });
    const [header, , , firstMint] = toCsv(result.rows, { bom: false }).split('\r\n');
    expect(header).toContain('action,tokenMint,tokenSymbol,amountRaw,amount,direction,counterparty,tokenBalanceAfterRaw,tokenBalanceAfter,eventsDecoded');
    expect(header).not.toContain('events,');
    expect(firstMint).toContain(',mint_to,' + MINT + ',MFT,1000000000000,1000000.000000,in,,');
    expect(result.rows[0]!.events?.[0]).toMatchObject({ type: 'initialize_mint', decoded: true });
  });

  it('skips ABI requests entirely with decode: false', async () => {
    const { impl, calls } = tokenFetch();
    const result = await exportAccount(WALLET, { fetchImpl: impl, decode: false });
    expect(calls.some((url) => url.includes('/api/abi/'))).toBe(false);
    expect(result.rows.every((row) => row.action === '' && row.events === undefined)).toBe(true);
    expect(result.tokenTotals).toEqual([]);
  });
});
