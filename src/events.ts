/**
 * Turn raw transaction events into decoded events, and decoded token events
 * into ledger columns (what moved, which way, and the balance afterwards).
 */
import { AbiDecoder, AbiDecodeError, EnumValue, type DecodedValue, type ProgramAbi } from './abi.js';
import { hexToBytes } from './address.js';
import type { DecodedEvent, TransactionDetail } from './types.js';
import { NATIVE_DECIMALS, NATIVE_SYMBOL, type NativeTransfer } from './native.js';

/** Returns the ABI for a program, or undefined when none is published. */
export type AbiLookup = (program: string) => ProgramAbi | undefined;

/** Decode every event of a transaction. Events without a usable ABI are reported, not dropped. */
export function decodeEvents(detail: TransactionDetail, lookup: AbiLookup): DecodedEvent[] {
  const events = detail.events?.events ?? [];
  return events.map((event, index): DecodedEvent => {
    const program = event.programAddress ?? '';
    const abi = program ? lookup(program) : undefined;
    const base = { index, program, programName: abi?.programName };
    if (!abi?.eventsRoot) return { ...base, type: '', decoded: false, error: abi ? 'ABI declares no events' : 'No ABI published' };
    try {
      const value = new AbiDecoder(abi).decode(abi.eventsRoot, hexToBytes(event.payloadHex ?? ''));
      const { type, fields } = flattenEvent(value);
      return { ...base, type, decoded: true, fields };
    } catch (error) {
      const message = error instanceof AbiDecodeError ? error.message : String(error);
      return { ...base, type: '', decoded: false, error: message };
    }
  });
}

/** An event root is usually { event_type, payload: <enum> }; surface the variant as the type. */
function flattenEvent(value: DecodedValue): { type: string; fields: Record<string, DecodedValue> } {
  if (value instanceof EnumValue) return { type: value.variant, fields: asRecord(value.value) };
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const field of Object.values(value)) {
      if (field instanceof EnumValue) return { type: field.variant, fields: asRecord(field.value) };
    }
    return { type: 'event', fields: value as Record<string, DecodedValue> };
  }
  return { type: 'event', fields: { value } };
}

function asRecord(value: DecodedValue): Record<string, DecodedValue> {
  return value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof EnumValue)
    ? (value as Record<string, DecodedValue>)
    : { value };
}

const str = (value: unknown): string => (typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value));

export interface MintInfo {
  decimals?: number;
  ticker?: string;
}

/**
 * What the export has learned about token accounts and mints from the whole
 * history: which token accounts belong to the exported address, which mint
 * each token account holds, and each mint's decimals and ticker.
 */
export interface TokenContext {
  owned: Set<string>;
  accountMint: Map<string, string>;
  mints: Map<string, MintInfo>;
}

export function buildTokenContext(address: string, events: DecodedEvent[], extraOwned: string[] = []): TokenContext {
  const context: TokenContext = { owned: new Set([address, ...extraOwned]), accountMint: new Map(), mints: new Map() };
  for (const event of events) {
    if (!event.decoded || !event.fields) continue;
    const f = event.fields;
    if (event.type === 'initialize_account') {
      if (str(f.account) && str(f.mint)) context.accountMint.set(str(f.account), str(f.mint));
      if (str(f.owner) === address && str(f.account)) context.owned.add(str(f.account));
    }
    if (event.type === 'initialize_mint' && str(f.mint)) {
      context.mints.set(str(f.mint), {
        decimals: typeof f.decimals === 'number' ? f.decimals : undefined,
        ticker: str(f.ticker) || undefined,
      });
    }
  }
  return context;
}

export interface Movement {
  action: string;
  tokenMint: string;
  tokenSymbol: string;
  amountRaw: string;
  amount: string;
  direction: 'in' | 'out' | 'self' | '';
  counterparty: string;
  tokenBalanceAfterRaw: string;
  tokenBalanceAfter: string;
}

const EMPTY: Movement = {
  action: '', tokenMint: '', tokenSymbol: '', amountRaw: '', amount: '',
  direction: '', counterparty: '', tokenBalanceAfterRaw: '', tokenBalanceAfter: '',
};

/** Format an integer string with a number of decimals, exactly. Empty if decimals are unknown. */
export function formatUnits(raw: string, decimals: number | undefined): string {
  if (decimals === undefined || !/^\d+$/.test(raw)) return '';
  if (decimals === 0) return BigInt(raw).toString();
  const value = BigInt(raw);
  const scale = 10n ** BigInt(decimals);
  return `${value / scale}.${(value % scale).toString().padStart(decimals, '0')}`;
}

/** Describe one decoded token event from the exported account's point of view. */
export function describeTokenEvent(event: DecodedEvent, context: TokenContext): Movement | undefined {
  if (!event.decoded || !event.fields) return undefined;
  const f = event.fields;
  const mine = (key: string) => context.owned.has(str(f[key]));
  const has = (...keys: string[]) => keys.every((key) => f[key] !== undefined);
  let movement: Omit<Movement, 'tokenSymbol' | 'amount' | 'tokenBalanceAfter'> | undefined;

  switch (event.type) {
    case 'transfer': {
      if (!has('source', 'dest', 'amount')) return undefined;
      const out = mine('source');
      const into = mine('dest');
      const mint = context.accountMint.get(str(f.source)) ?? context.accountMint.get(str(f.dest)) ?? '';
      movement = {
        action: 'transfer',
        tokenMint: mint,
        amountRaw: str(f.amount),
        direction: out && into ? 'self' : out ? 'out' : into ? 'in' : '',
        counterparty: out && !into ? str(f.dest) : into && !out ? str(f.source) : '',
        tokenBalanceAfterRaw: out ? str(f.source_post_balance) : into ? str(f.dest_post_balance) : '',
      };
      break;
    }
    case 'mint_to':
      if (!has('mint', 'dest', 'amount')) return undefined;
      movement = {
        action: 'mint_to',
        tokenMint: str(f.mint),
        amountRaw: str(f.amount),
        direction: mine('dest') ? 'in' : '',
        counterparty: mine('dest') ? '' : str(f.dest),
        tokenBalanceAfterRaw: mine('dest') ? str(f.dest_post_balance) : '',
      };
      break;
    case 'burn':
      if (!has('mint', 'account', 'amount')) return undefined;
      movement = {
        action: 'burn',
        tokenMint: str(f.mint),
        amountRaw: str(f.amount),
        direction: mine('account') ? 'out' : '',
        counterparty: mine('account') ? '' : str(f.account),
        tokenBalanceAfterRaw: mine('account') ? str(f.account_post_balance) : '',
      };
      break;
    case 'initialize_mint':
      movement = { ...EMPTY, action: 'initialize_mint', tokenMint: str(f.mint), amountRaw: str(f.supply) };
      break;
    case 'initialize_account':
    case 'close_account':
    case 'freeze_account':
    case 'thaw_account':
      movement = { ...EMPTY, action: event.type, tokenMint: str(f.mint) || context.accountMint.get(str(f.account)) || '' };
      break;
    default:
      return undefined;
  }

  const info = context.mints.get(movement.tokenMint);
  return {
    ...movement,
    tokenSymbol: info?.ticker ?? '',
    amount: formatUnits(movement.amountRaw, info?.decimals),
    tokenBalanceAfter: formatUnits(movement.tokenBalanceAfterRaw, info?.decimals),
  };
}

/** Does this event involve an account the exported address owns? */
function touchesOwned(event: DecodedEvent, context: TokenContext): boolean {
  if (!event.fields) return false;
  return Object.values(event.fields).some((value) => typeof value === 'string' && context.owned.has(value));
}

/**
 * Pick the movement to show on a transaction's single row: the first token
 * movement (transfer, mint, burn) that touches the exported account, then any
 * other event that touches it, then the first decodable token event.
 */
export function primaryMovement(events: DecodedEvent[], context: TokenContext): Movement {
  const described = events
    .map((event) => ({ event, movement: describeTokenEvent(event, context) }))
    .filter((entry): entry is { event: DecodedEvent; movement: Movement } => entry.movement !== undefined);
  const pick =
    described.find((d) => d.movement.direction !== '') ??
    described.find((d) => touchesOwned(d.event, context)) ??
    described[0];
  if (pick) return pick.movement;
  const firstDecoded = events.find((event) => event.decoded);
  return { ...EMPTY, action: firstDecoded?.type ?? '' };
}

/** Describe a native THRU movement from the exported address's point of view. */
export function describeNativeTransfer(transfer: NativeTransfer, address: string): Movement {
  const out = transfer.from === address;
  const into = transfer.to === address;
  return {
    ...EMPTY,
    action: transfer.kind,
    tokenMint: NATIVE_SYMBOL,
    tokenSymbol: NATIVE_SYMBOL,
    amountRaw: transfer.amountRaw,
    amount: formatUnits(transfer.amountRaw, NATIVE_DECIMALS),
    direction: out && into ? 'self' : out ? 'out' : into ? 'in' : '',
    counterparty: out && !into ? transfer.to : into && !out ? transfer.from : '',
  };
}

/** The THRU effect of a movement on the exported address: +in, -out, 0 otherwise. */
export function nativeDelta(transfer: NativeTransfer | undefined, address: string): bigint {
  if (!transfer) return 0n;
  const amount = BigInt(transfer.amountRaw);
  let delta = 0n;
  if (transfer.to === address) delta += amount;
  if (transfer.from === address) delta -= amount;
  return delta;
}
