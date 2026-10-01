import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AbiDecoder, parseAbi } from '../src/abi.js';
import { bytesToHex, decodeAddress, hexToBytes } from '../src/address.js';
import { decodeEvents } from '../src/events.js';
import { exportAccount } from '../src/export.js';
import { tradesToCsv } from '../src/csv.js';
import { parseArgs } from '../src/args.js';
import { collectMarkets, summarizeTrades, tradeRowsFor } from '../src/perp.js';
import type { TransactionDetail } from '../src/types.js';

/** PerpEvent and the types it uses, from the live Betanet ABI (see the file header). */
const PERP_ABI_YAML = readFileSync(new URL('./fixtures/perp-events.abi.yaml', import.meta.url), 'utf8');
const PERP_PROGRAM = 'tayM9Pm_Zpu30DUvzYpBUFsG2riV3tdhWg9yPgN3gV_zO1';
const perpAbi = parseAbi(PERP_ABI_YAML, 'Perp Program');
const lookup = (program: string) => (program === PERP_PROGRAM ? perpAbi : undefined);

const MARKET = 'taJU3IuyXuPJr0HCCLnHRBNowYnNjF-u3ksLABZnTLfbH8';
const TAKER = 'taH0xYR19SHp5UNlR5M6c0nsKxgKLmMLvx1Dk4f-UxP0s1';
const MAKER = 'taqVscHs2INdqx6387pQN3uofbt4JfrgkCcEXhOJACmuFf';
const QUOTE_MINT = 'ta4QGs4GabQdnh6eCyOdKckduarh6B-wUNwKgYaZJ7WUB7';

/** A real Betanet fill, captured from scan.thru.org?network=betanet on 2026-10-01: TAKER buys 13 at 83,460,000 from MAKER. */
const FILL_PAYLOAD =
  '0400000000000000e2030000e703000000000000a07ff904000000000d0000000000000022fd00000000000000000000000000000000000000000000dc0100000000000000000000000000000000000000000000988f000000000000254dc8bb25ee3c9af41c208b9c7441368c189cd8c5faede4b0b0016674cb7db11f4c58475f521e9e5436547933a7349ec2b180a2e630bbf1d439387fe5313f4ba95b1c1ecd8835dab1eb7f3ba50377ba87dbb7825fae09027045e13890029ae1';
const FILL_TX: TransactionDetail = {
  slot: 23471,
  signature: 'ts4B5l3-KWejH0HHmiHmosz0s1mQGSbcxkNCL_f86U72RIyqEzVzv9LqonhSKOxbQw09YUf13GeWcVCdGl5XMkAh6I',
  consensusStatus: { label: 'Included', kind: 'success' },
  executionError: { vmErrorStatus: { label: 'Success', kind: 'success' }, vmError: 0, userErrorCode: '0' },
  fee: '0',
  computeUnits: { requested: '300000000', consumed: '75472' },
  blockTimestampNs: '1790825462606945574',
  feePayer: TAKER,
  program: PERP_PROGRAM,
  transactionSize: 432,
  accounts: {
    readWriteAccounts: [
      MARKET,
      'taal5jxR6dcwjh7lMJWF62tQ14K63PZr2QoQ3BKpHK6Ed0',
      'taohK3y_Lg6ftdh9JMwWfNox3AN3PljXt9XjV1_Xp0oe_6',
      'tapu7BmqsAd44W2b3rXaSWiDQwJ0y2CPTVMZIEqCQJIUKy',
    ],
    readOnlyAccounts: ['taLUbAHB9yOBfhxZxQuFJySuPkbdbvzB6i8AGEM0cBId36', 'tamYub1CZljzLykNFWd3P0iw0kq6uzbPY7hz-gh3eSj-Iv'],
  },
  events: { events: [{ programAddress: PERP_PROGRAM, payloadHex: FILL_PAYLOAD }], eventsCount: 1 },
};

/* CONSTRUCTED events, encoded from the ABI's layouts (no deposits, withdrawals,
   liquidations or market creations were in the live window we sampled). */
const u32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return bytesToHex(b); };
const u64 = (n: bigint) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, n, true); return bytesToHex(b); };
const key = (address: string) => bytesToHex(decodeAddress(address));
const VAULT = 'taSibzVil3ORCwT39q-_iq10_RatM0dcrdSeSxx0Ldov0O';

/** The market's creation, with the quote token and lot size live Betanet reports for its markets. */
const marketCreated = u64(3n) + u64(1n) + u64(1000n) + u64(200000000n) + u64(1000000n) +
  key(QUOTE_MINT) + key('taeO593-qbpUo0oPUaU7rPhPekrgyWKrborkpYryBidV1_') + key(MARKET) +
  key('taZ11JAnmJVtVnzJFCcZRtROPub0hqgzEHT1PSYdFMTioP') + key('taKfZDcRbWlUOEw9oiGF3DN4kV-nDWpMTuYaddv_0HG4pK') +
  key('ta1YpPK7I0h0O5kpnEreTq0gEj-R2GRTVbffiwcHc4aGIh') + key(VAULT);
/** TAKER deposits 5,000,000 quote atoms (balance after 5,000,000, flat). */
const deposit = u64(8n) + u32(994) + '00000000' + u64(5_000_000n) + u64(5_000_000n) + u64(0n) + u64(0n) +
  key(MARKET) + key(TAKER) + key('taal5jxR6dcwjh7lMJWF62tQ14K63PZr2QoQ3BKpHK6Ed0') + key(VAULT);
/** TAKER withdraws 1,000,000 while holding 476 long lots. */
const withdraw = u64(9n) + u32(994) + '00000000' + u64(1_000_000n) + u64(3_915_020_000n) + u64(476n) + u64(0n) +
  key(MARKET) + key(TAKER) + key('taal5jxR6dcwjh7lMJWF62tQ14K63PZr2QoQ3BKpHK6Ed0') + key(VAULT);
/** MAKER liquidates TAKER: 476 lots at mark 80,000,000, fee 1,234. */
const liquidation = u64(15n) + key(MARKET) + key(MAKER) + key(TAKER) + u32(999) + u32(994) + u64(476n) + u64(80_000_000n) +
  u64(1234n) + u64(0n) + u64(10_000n) + u64(2_000_000n) + '01' + '00000000000000';

const tx = (signature: string, ts: string, payloads: string[], feePayer = TAKER): TransactionDetail => ({
  ...FILL_TX, signature, blockTimestampNs: ts, feePayer,
  events: { events: payloads.map((payloadHex) => ({ programAddress: PERP_PROGRAM, payloadHex })), eventsCount: payloads.length },
});
const CREATE_TX = tx('tsConstructedMarketCreated', '1790800000000000000', [marketCreated], MAKER);
const DEPOSIT_TX = tx('tsConstructedDeposit', '1790810000000000000', [deposit]);
const WITHDRAW_TX = tx('tsConstructedWithdraw', '1790830000000000000', [withdraw]);
const LIQUIDATION_TX = tx('tsConstructedLiquidation', '1790840000000000000', [liquidation], MAKER);

const ctx = (detail: TransactionDetail) => ({
  timestampUtc: 'T', date: 'D', signature: detail.signature, explorerUrl: 'U',
});

describe('Perp event decoding', () => {
  it('decodes the real Betanet fill with the live ABI types', () => {
    const value = JSON.parse(JSON.stringify(new AbiDecoder(perpAbi).decode('PerpEvent', hexToBytes(FILL_PAYLOAD))));
    expect(value.payload.variant).toBe('order_filled');
    expect(value.payload.value).toMatchObject({
      taker_side: 0, price: '83460000', qty: '13', taker_long_lots: '476', taker_short_lots: '0',
      maker_long_lots: '0', maker_short_lots: '36760', market: MARKET,
      taker_seat_authority: TAKER, maker_seat_authority: MAKER,
    });
  });

  it('decodes every constructed event byte for byte', () => {
    for (const payload of [marketCreated, deposit, withdraw, liquidation]) {
      expect(() => new AbiDecoder(perpAbi).decode('PerpEvent', hexToBytes(payload))).not.toThrow();
    }
  });
});

describe('tradeRowsFor', () => {
  const fillEvents = decodeEvents(FILL_TX, lookup);

  it('shows the taker buying, with the trade value and the position after', () => {
    expect(tradeRowsFor(fillEvents, TAKER, ctx(FILL_TX))).toEqual([{
      timestampUtc: 'T', date: 'D', signature: FILL_TX.signature, explorerUrl: 'U',
      market: MARKET, quoteMint: '', kind: 'fill', role: 'taker', side: 'buy',
      price: '83460000', qty: '13', notionalQuoteRaw: '1084980000', amountQuoteRaw: '', feeQuoteRaw: '',
      longLotsAfter: '476', shortLotsAfter: '0', netLotsAfter: '476', collateralQuoteAfterRaw: '',
      counterparty: MAKER,
    }]);
  });

  it('shows the maker selling the other side', () => {
    expect(tradeRowsFor(fillEvents, MAKER, ctx(FILL_TX))).toMatchObject([{
      role: 'maker', side: 'sell', qty: '13', shortLotsAfter: '36760', netLotsAfter: '-36760', counterparty: TAKER,
    }]);
  });

  it('ignores trades the address is not part of', () => {
    expect(tradeRowsFor(fillEvents, QUOTE_MINT, ctx(FILL_TX))).toEqual([]);
    expect(tradeRowsFor(decodeEvents(DEPOSIT_TX, lookup), MAKER, ctx(DEPOSIT_TX))).toEqual([]);
  });

  it('names the quote token when the market was created in the history', () => {
    const markets = collectMarkets(decodeEvents(CREATE_TX, lookup));
    expect(markets.get(MARKET)).toEqual({ quoteMint: QUOTE_MINT, lotSize: '1' });
    expect(tradeRowsFor(fillEvents, TAKER, ctx(FILL_TX), markets)[0]!.quoteMint).toBe(QUOTE_MINT);
  });

  it('records collateral deposits and withdrawals with the balance after', () => {
    expect(tradeRowsFor(decodeEvents(DEPOSIT_TX, lookup), TAKER, ctx(DEPOSIT_TX))).toMatchObject([{
      kind: 'deposit', amountQuoteRaw: '5000000', collateralQuoteAfterRaw: '5000000', netLotsAfter: '0', counterparty: VAULT,
    }]);
    expect(tradeRowsFor(decodeEvents(WITHDRAW_TX, lookup), TAKER, ctx(WITHDRAW_TX))).toMatchObject([{
      kind: 'withdraw', amountQuoteRaw: '1000000', collateralQuoteAfterRaw: '3915020000', longLotsAfter: '476',
    }]);
  });

  it('records both sides of a liquidation, with the fee', () => {
    const events = decodeEvents(LIQUIDATION_TX, lookup);
    expect(tradeRowsFor(events, TAKER, ctx(LIQUIDATION_TX))).toMatchObject([{
      kind: 'liquidation', role: 'liquidated', qty: '476', price: '80000000', notionalQuoteRaw: '38080000000',
      feeQuoteRaw: '1234', collateralQuoteAfterRaw: '10000', counterparty: MAKER,
    }]);
    expect(tradeRowsFor(events, MAKER, ctx(LIQUIDATION_TX))).toMatchObject([{
      role: 'liquidator', collateralQuoteAfterRaw: '2000000', counterparty: TAKER,
    }]);
  });
});

describe('summarizeTrades', () => {
  it('totals each market', () => {
    const events = [DEPOSIT_TX, FILL_TX, WITHDRAW_TX, LIQUIDATION_TX].map((detail) => ({ detail, events: decodeEvents(detail, lookup) }));
    const rows = events.flatMap(({ detail, events: e }) => tradeRowsFor(e, TAKER, ctx(detail)));
    expect(summarizeTrades(rows)).toEqual([{
      market: MARKET, quoteMint: '', fills: 1, boughtQty: '13', soldQty: '0',
      boughtNotionalQuoteRaw: '1084980000', soldNotionalQuoteRaw: '0',
      depositedQuoteRaw: '5000000', withdrawnQuoteRaw: '1000000', liquidationFeesQuoteRaw: '1234',
      closingLongLots: '476', closingShortLots: '0',
    }]);
  });
});

function fakeExplorer(history: TransactionDetail[]) {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const impl = async (input: string | URL | Request): Promise<Response> => {
    const path = String(input).split('?')[0]!;
    if (path.includes('/api/abi/')) {
      const program = decodeURIComponent(path.split('/api/abi/')[1]!);
      if (program !== PERP_PROGRAM) return json({ error: 'NOT_FOUND' }, 404);
      return json({ data: { programAddress: PERP_PROGRAM, programName: 'Perp Program', abi: PERP_ABI_YAML } });
    }
    if (path.includes('/api/tx/')) {
      const signature = decodeURIComponent(path.split('/api/tx/')[1]!);
      return json({ data: history.find((t) => t.signature === signature) });
    }
    if (path.endsWith('/transactions')) {
      const transactions = [...history].reverse().map((t) => ({ signature: t.signature, slot: t.slot }));
      return json({ data: { address: TAKER, transactions, pagination: { pageSize: 100 } } });
    }
    return json({ data: { address: TAKER, balanceRaw: '0' } });
  };
  return impl as unknown as typeof fetch;
}

describe('exportAccount with Perp trades', () => {
  const history = [CREATE_TX, DEPOSIT_TX, FILL_TX, WITHDRAW_TX];

  it('returns trades and per-market totals, and labels the ledger rows', async () => {
    const result = await exportAccount(TAKER, { fetchImpl: fakeExplorer(history), network: 'betanet' });
    expect(result.trades.map((t) => t.kind)).toEqual(['deposit', 'fill', 'withdraw']);
    expect(result.trades[1]).toMatchObject({ quoteMint: QUOTE_MINT, side: 'buy', notionalQuoteRaw: '1084980000' });
    expect(result.trades[1]!.explorerUrl).toBe(`https://scan.thru.org/tx/${FILL_TX.signature}?network=betanet`);
    expect(result.tradeTotals).toHaveLength(1);
    expect(result.rows.find((r) => r.signature === FILL_TX.signature)?.action).toBe('perp_fill');
  });

  it('keeps only trades inside the date period', async () => {
    const result = await exportAccount(TAKER, { fetchImpl: fakeExplorer(history), from: '2026-10-01' });
    expect(result.trades.map((t) => t.kind)).toEqual(['fill', 'withdraw']);
  });

  it('writes the trades CSV', async () => {
    const result = await exportAccount(TAKER, { fetchImpl: fakeExplorer(history) });
    const [header, , fill] = tradesToCsv(result.trades, { bom: false }).split('\r\n');
    expect(header).toBe('timestampUtc,date,signature,market,quoteMint,kind,role,side,price,qty,notionalQuoteRaw,amountQuoteRaw,feeQuoteRaw,longLotsAfter,shortLotsAfter,netLotsAfter,collateralQuoteAfterRaw,counterparty,explorerUrl');
    expect(fill).toContain(`,${MARKET},${QUOTE_MINT},fill,taker,buy,83460000,13,1084980000,,,476,0,476,,${MAKER},`);
  });

  it('parses --trades', () => {
    expect(parseArgs(['x', '--trades', 'perp.csv']).trades).toBe('perp.csv');
  });
});
