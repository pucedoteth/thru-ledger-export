/**
 * Perp trades: fills, collateral deposits and withdrawals, and liquidations
 * from Thru's Perp Program, seen from the exported address.
 *
 * Events are decoded with the program's published ABI like any other; this
 * module only recognises the decoded shapes (by event name and fields), so it
 * works wherever the Perp Program is deployed. Units follow Thru's own client
 * (web/packages/programs/src/perp in Unto-Labs/thru): prices are quote atoms
 * per base atom, quantities are base atoms, positions are in lots, side 0 is
 * buy and 1 is sell, and realised profit and loss settles into the seat's
 * quote balance on every fill.
 */
import type { DecodedEvent } from './types.js';

export interface TradeRow {
  timestampUtc: string;
  date: string;
  signature: string;
  market: string;
  /** The market's quote token, when its creation is in the fetched history. */
  quoteMint: string;
  kind: 'fill' | 'deposit' | 'withdraw' | 'liquidation';
  /** fills: taker or maker; liquidations: liquidator or liquidated. */
  role: 'taker' | 'maker' | 'liquidator' | 'liquidated' | '';
  side: 'buy' | 'sell' | '';
  /** Quote atoms per base atom (fills), or the mark price (liquidations). */
  price: string;
  /** Base atoms (fills), or lots (liquidations). */
  qty: string;
  /** price × qty, in quote atoms. */
  notionalQuoteRaw: string;
  /** Collateral moved in or out (deposits and withdrawals), in quote atoms. */
  amountQuoteRaw: string;
  /** Liquidation fee, in quote atoms. */
  feeQuoteRaw: string;
  /** The exported address's position in this market right after, in lots. */
  longLotsAfter: string;
  shortLotsAfter: string;
  netLotsAfter: string;
  /** The seat's quote (collateral) balance right after, when the event reports it. */
  collateralQuoteAfterRaw: string;
  counterparty: string;
  explorerUrl: string;
}

export interface MarketInfo {
  quoteMint: string;
  lotSize: string;
}

type Fields = Record<string, unknown>;

const str = (value: unknown): string => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '');
const has = (f: Fields, ...keys: string[]) => keys.every((key) => f[key] !== undefined);
const sideOf = (value: unknown): TradeRow['side'] => (Number(value) === 0 ? 'buy' : Number(value) === 1 ? 'sell' : '');
const opposite = (side: TradeRow['side']): TradeRow['side'] => (side === 'buy' ? 'sell' : side === 'sell' ? 'buy' : '');
const times = (a: string, b: string): string => (/^\d+$/.test(a) && /^\d+$/.test(b) ? (BigInt(a) * BigInt(b)).toString() : '');
const net = (long: string, short: string): string =>
  /^\d+$/.test(long) && /^\d+$/.test(short) ? (BigInt(long) - BigInt(short)).toString() : '';

/** Markets created in the fetched history: their quote token and lot size. */
export function collectMarkets(events: DecodedEvent[]): Map<string, MarketInfo> {
  const markets = new Map<string, MarketInfo>();
  for (const event of events) {
    const f = event.fields;
    if (!event.decoded || !f || event.type !== 'market_created' || !has(f, 'market', 'quote_mint', 'lot_size')) continue;
    markets.set(str(f.market), { quoteMint: str(f.quote_mint), lotSize: str(f.lot_size) });
  }
  return markets;
}

export interface TradeContext {
  timestampUtc: string;
  date: string;
  signature: string;
  explorerUrl: string;
}

const EMPTY: Omit<TradeRow, keyof TradeContext | 'market' | 'quoteMint' | 'kind'> = {
  role: '', side: '', price: '', qty: '', notionalQuoteRaw: '', amountQuoteRaw: '', feeQuoteRaw: '',
  longLotsAfter: '', shortLotsAfter: '', netLotsAfter: '', collateralQuoteAfterRaw: '', counterparty: '',
};

/** The Perp rows of one transaction that involve the exported address. */
export function tradeRowsFor(
  events: DecodedEvent[], address: string, tx: TradeContext, markets: Map<string, MarketInfo> = new Map(),
): TradeRow[] {
  const rows: TradeRow[] = [];
  for (const event of events) {
    const f = event.fields;
    if (!event.decoded || !f) continue;
    const market = str(f.market);
    const base = { ...tx, ...EMPTY, market, quoteMint: markets.get(market)?.quoteMint ?? '' };

    if (event.type === 'order_filled' &&
        has(f, 'taker_seat_authority', 'maker_seat_authority', 'taker_side', 'price', 'qty', 'taker_long_lots', 'maker_long_lots')) {
      const takerSide = sideOf(f.taker_side);
      const notional = times(str(f.price), str(f.qty));
      for (const role of ['taker', 'maker'] as const) {
        if (str(f[`${role}_seat_authority`]) !== address) continue;
        const long = str(f[`${role}_long_lots`]);
        const short = str(f[`${role}_short_lots`]);
        rows.push({
          ...base, kind: 'fill', role,
          side: role === 'taker' ? takerSide : opposite(takerSide),
          price: str(f.price), qty: str(f.qty), notionalQuoteRaw: notional,
          longLotsAfter: long, shortLotsAfter: short, netLotsAfter: net(long, short),
          counterparty: str(f[`${role === 'taker' ? 'maker' : 'taker'}_seat_authority`]),
        });
      }
    } else if ((event.type === 'token_deposit' || event.type === 'token_withdraw') &&
               has(f, 'seat_authority', 'amount', 'quantity_quote', 'long_lots', 'short_lots')) {
      if (str(f.seat_authority) !== address) continue;
      const long = str(f.long_lots);
      const short = str(f.short_lots);
      rows.push({
        ...base, kind: event.type === 'token_deposit' ? 'deposit' : 'withdraw',
        amountQuoteRaw: str(f.amount), collateralQuoteAfterRaw: str(f.quantity_quote),
        longLotsAfter: long, shortLotsAfter: short, netLotsAfter: net(long, short),
        counterparty: str(f.vault),
      });
    } else if (event.type === 'liquidation' &&
               has(f, 'liquidator', 'target', 'lots', 'mark_price', 'fee', 'target_quote_after', 'liquidator_quote_after')) {
      for (const role of ['liquidator', 'liquidated'] as const) {
        const who = role === 'liquidator' ? f.liquidator : f.target;
        if (str(who) !== address) continue;
        rows.push({
          ...base, kind: 'liquidation', role,
          price: str(f.mark_price), qty: str(f.lots),
          notionalQuoteRaw: times(str(f.mark_price), str(f.lots)),
          feeQuoteRaw: str(f.fee),
          collateralQuoteAfterRaw: str(role === 'liquidator' ? f.liquidator_quote_after : f.target_quote_after),
          counterparty: str(role === 'liquidator' ? f.target : f.liquidator),
        });
      }
    }
  }
  return rows;
}

/** Per-market totals over the trade rows (oldest first). */
export interface TradeTotal {
  market: string;
  quoteMint: string;
  fills: number;
  boughtQty: string;
  soldQty: string;
  boughtNotionalQuoteRaw: string;
  soldNotionalQuoteRaw: string;
  depositedQuoteRaw: string;
  withdrawnQuoteRaw: string;
  liquidationFeesQuoteRaw: string;
  /** Position after the last row that reported one, in lots. */
  closingLongLots: string;
  closingShortLots: string;
}

export function summarizeTrades(rows: TradeRow[]): TradeTotal[] {
  const totals = new Map<string, {
    quoteMint: string; fills: number; bq: bigint; sq: bigint; bn: bigint; sn: bigint; dep: bigint; wd: bigint; fee: bigint;
    long: string; short: string;
  }>();
  const big = (value: string) => (/^\d+$/.test(value) ? BigInt(value) : 0n);
  for (const row of rows) {
    const t = totals.get(row.market) ?? { quoteMint: row.quoteMint, fills: 0, bq: 0n, sq: 0n, bn: 0n, sn: 0n, dep: 0n, wd: 0n, fee: 0n, long: '', short: '' };
    if (row.kind === 'fill') {
      t.fills++;
      if (row.side === 'buy') { t.bq += big(row.qty); t.bn += big(row.notionalQuoteRaw); }
      if (row.side === 'sell') { t.sq += big(row.qty); t.sn += big(row.notionalQuoteRaw); }
    }
    if (row.kind === 'deposit') t.dep += big(row.amountQuoteRaw);
    if (row.kind === 'withdraw') t.wd += big(row.amountQuoteRaw);
    if (row.kind === 'liquidation' && row.role === 'liquidated') t.fee += big(row.feeQuoteRaw);
    if (row.longLotsAfter) { t.long = row.longLotsAfter; t.short = row.shortLotsAfter; }
    t.quoteMint ||= row.quoteMint;
    totals.set(row.market, t);
  }
  return [...totals].map(([market, t]) => ({
    market, quoteMint: t.quoteMint, fills: t.fills,
    boughtQty: t.bq.toString(), soldQty: t.sq.toString(),
    boughtNotionalQuoteRaw: t.bn.toString(), soldNotionalQuoteRaw: t.sn.toString(),
    depositedQuoteRaw: t.dep.toString(), withdrawnQuoteRaw: t.wd.toString(), liquidationFeesQuoteRaw: t.fee.toString(),
    closingLongLots: t.long, closingShortLots: t.short,
  }));
}
