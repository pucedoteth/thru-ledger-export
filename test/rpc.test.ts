import { describe, expect, it } from 'vitest';
import { bytesToHex, hexToBytes } from '../src/address.js';
import {
  decodeRawAccount, encodeGetRawAccountRequest, fetchMints, grpcWebFrame, MINT_ACCOUNT_SIZE, parseMintAccount,
  readGrpcWebResponse, TOKEN_PROGRAMS,
} from '../src/rpc.js';
import { exportAccount } from '../src/export.js';
import { THRUSD_MINT_RESPONSE_HEX, TSOL_MINT, TSOL_MINT_RESPONSE_HEX } from './rpc-fixtures.js';
import { fakeExplorer, THRUSD_MINT, THRUSD_TOKEN_ACCOUNT, THRUSD_WALLET } from './thrusd-fixtures.js';

const TOKEN_PROGRAM = 'taTOKENKRgcl3vO0yVhftATDbXuhgWcfaaxv9xpEEdMdUE';

describe('GetRawAccount request', () => {
  it('is GetRawAccountRequest { address: Pubkey { value } } in a gRPC-Web frame', () => {
    const frame = grpcWebFrame(encodeGetRawAccountRequest(THRUSD_MINT));
    // The exact bytes sent to rpc.alphanet.thru.org when the fixture was captured (HTTP 200).
    expect(bytesToHex(frame)).toBe('0000000024' + '0a22' + '0a20' + '45f5a3af2a96491469e9953f6a10875ca844034a1154a599944e14b3ceaf9ce3');
  });
});

describe('captured RPC replies', () => {
  it('decode THRUSD on Alphanet: Token Program owner, 6 decimals, ticker THRUSD', () => {
    const account = decodeRawAccount(readGrpcWebResponse(hexToBytes(THRUSD_MINT_RESPONSE_HEX)));
    expect(account.address).toBe(THRUSD_MINT);
    expect(account.owner).toBe(TOKEN_PROGRAM);
    expect(account.data).toHaveLength(MINT_ACCOUNT_SIZE);
    expect(parseMintAccount(account.data)).toEqual({ decimals: 6, ticker: 'THRUSD', supplyRaw: '805000000' });
  });

  it('decode tSOL on Betanet: 9 decimals, ticker tSOL', () => {
    const account = decodeRawAccount(readGrpcWebResponse(hexToBytes(TSOL_MINT_RESPONSE_HEX)));
    expect(account.address).toBe(TSOL_MINT);
    expect(TOKEN_PROGRAMS.has(account.owner)).toBe(true);
    // The explorer showed the same: decimals 9, supply 154038429130851, ticker "tSOL".
    expect(parseMintAccount(account.data)).toEqual({ decimals: 9, ticker: 'tSOL', supplyRaw: '154038429130851' });
  });

  it('surfaces a non-zero grpc-status from the trailer', () => {
    const trailer = new TextEncoder().encode('grpc-status:5\r\ngrpc-message:account%20not%20found\r\n');
    const frame = new Uint8Array(5 + trailer.length);
    frame[0] = 0x80;
    new DataView(frame.buffer).setUint32(1, trailer.length);
    frame.set(trailer, 5);
    expect(() => readGrpcWebResponse(frame)).toThrow(/gRPC status 5: account not found/);
  });

  it('rejects data that is not a mint account', () => {
    expect(() => parseMintAccount(new Uint8Array(73))).toThrow(/Not a mint account/);
  });
});

describe('fetchMints', () => {
  it('reads mints from the node and skips ones it cannot read', async () => {
    const { impl } = fakeExplorer({ rpc: { [THRUSD_MINT]: THRUSD_MINT_RESPONSE_HEX } });
    const found = await fetchMints([THRUSD_MINT, TSOL_MINT], { rpcUrl: 'https://rpc.alphanet.thru.org', fetchImpl: impl });
    expect([...found.keys()]).toEqual([THRUSD_MINT]);
    expect(found.get(THRUSD_MINT)).toMatchObject({ decimals: 6, ticker: 'THRUSD' });
  });

  it('ignores an account the Token Program does not own', async () => {
    // Same reply with the owner's first byte changed: it can no longer be trusted as a mint.
    const bytes = hexToBytes(THRUSD_MINT_RESPONSE_HEX);
    const ownerAt = bytesToHex(bytes).indexOf('4ce28434') / 2;
    bytes[ownerAt] = 0x00;
    const { impl } = fakeExplorer({ rpc: { [THRUSD_MINT]: bytesToHex(bytes) } });
    const found = await fetchMints([THRUSD_MINT], { rpcUrl: 'https://rpc.alphanet.thru.org', fetchImpl: impl });
    expect(found.size).toBe(0);
  });

  it('returns nothing, without throwing, when the node is down', async () => {
    const { impl } = fakeExplorer({ rpc: 'down' });
    const found = await fetchMints([THRUSD_MINT], { rpcUrl: 'https://rpc.alphanet.thru.org', fetchImpl: impl });
    expect(found.size).toBe(0);
  });
});

describe('export with on-chain mint details', () => {
  it('reads THRUSD from the chain and reports the source', async () => {
    const { impl, calls } = fakeExplorer({ rpc: { [THRUSD_MINT]: THRUSD_MINT_RESPONSE_HEX } });
    const result = await exportAccount(THRUSD_WALLET, { fetchImpl: impl });

    expect(result.mintDetails).toEqual([{ tokenMint: THRUSD_MINT, tokenSymbol: 'THRUSD', decimals: 6, source: 'chain' }]);
    expect(result.rows.at(-1)).toMatchObject({ tokenSymbol: 'THRUSD', amount: '100.000000' });
    expect(calls.filter((url) => url.startsWith('https://rpc.alphanet.thru.org/'))).toHaveLength(1);
  });

  it('asks the node for the right network', async () => {
    const { impl, calls } = fakeExplorer({ rpc: { [THRUSD_MINT]: THRUSD_MINT_RESPONSE_HEX } });
    await exportAccount(THRUSD_WALLET, { fetchImpl: impl, network: 'betanet' });
    expect(calls.some((url) => url.startsWith('https://rpc.betanet.thru.org/'))).toBe(true);
    expect(calls.some((url) => url.startsWith('https://rpc.alphanet.thru.org/'))).toBe(false);
  });

  it('uses --rpc-url when given', async () => {
    const { impl, calls } = fakeExplorer({ rpc: { [THRUSD_MINT]: THRUSD_MINT_RESPONSE_HEX } });
    await exportAccount(THRUSD_WALLET, { fetchImpl: impl, rpcUrl: 'https://rpc.custom.example' });
    expect(calls.some((url) => url.startsWith('https://rpc.custom.example/'))).toBe(true);
  });

  it('falls back to the built-in table when the node is down', async () => {
    const { impl } = fakeExplorer({ rpc: 'down' });
    const result = await exportAccount(THRUSD_WALLET, { fetchImpl: impl });
    expect(result.mintDetails[0]).toMatchObject({ tokenSymbol: 'THRUSD', decimals: 6, source: 'table' });
    expect(result.rows.at(-1)!.amount).toBe('100.000000');
  });

  it('makes no RPC calls with mintLookup: false', async () => {
    const { impl, calls } = fakeExplorer({ rpc: { [THRUSD_MINT]: THRUSD_MINT_RESPONSE_HEX } });
    const result = await exportAccount(THRUSD_WALLET, { fetchImpl: impl, mintLookup: false });
    expect(calls.some((url) => url.startsWith('https://rpc.'))).toBe(false);
    expect(result.mintDetails[0]!.source).toBe('table');
  });

  it('reports a mint nobody can describe as unknown, with raw amounts only', async () => {
    const { impl } = fakeExplorer({ rpc: 'down' });
    const result = await exportAccount(THRUSD_TOKEN_ACCOUNT, { fetchImpl: impl, network: 'betanet' });
    // Betanet has no THRUSD at this address, so neither the node nor the table knows it.
    expect(result.mintDetails).toEqual([{ tokenMint: THRUSD_MINT, tokenSymbol: '', decimals: undefined, source: 'unknown' }]);
    expect(result.rows.at(-1)).toMatchObject({ amountRaw: '100000000', amount: '' });
  });

  it('makes no RPC calls with --no-decode', async () => {
    const { impl, calls } = fakeExplorer({ rpc: { [THRUSD_MINT]: THRUSD_MINT_RESPONSE_HEX } });
    const result = await exportAccount(THRUSD_WALLET, { fetchImpl: impl, decode: false });
    expect(calls.some((url) => url.startsWith('https://rpc.'))).toBe(false);
    expect(result.mintDetails).toEqual([]);
  });
});
