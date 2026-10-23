/**
 * Read mint accounts straight from a Thru RPC node, so every token gets its
 * real ticker and decimals, not just the ones whose initialize_mint event
 * happens to be in the exported history.
 *
 * Thru's RPC speaks gRPC. Its gRPC-Web form works over a plain HTTPS POST
 * from Node and from browsers alike, so it is used here with a few lines of
 * hand-written protobuf instead of a dependency. Only one call is needed:
 *
 *   thru.services.v1.QueryService/GetRawAccount
 *     GetRawAccountRequest { Pubkey address = 1 }          Pubkey { bytes value = 1 }
 *     RawAccount { Pubkey address = 1; bytes raw_meta = 2; bytes raw_data = 3; ... }
 *
 * (Field numbers from Thru's API reference, https://thru.org/docs.)
 */
import { decodeAddress, encodeAddress } from './address.js';

/** Public RPC endpoints, by explorer network name. */
export const RPC_URLS: Record<string, string> = {
  alphanet: 'https://rpc.alphanet.thru.org',
  betanet: 'https://rpc.betanet.thru.org',
};

/** Programs that own mint accounts: the current Token Program, and the one before the v0.4.0 reset. */
export const TOKEN_PROGRAMS = new Set([
  'taTOKENKRgcl3vO0yVhftATDbXuhgWcfaaxv9xpEEdMdUE',
  'taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKqq',
]);

const GET_RAW_ACCOUNT = '/thru.services.v1.QueryService/GetRawAccount';

// ---- protobuf, just enough for these messages -------------------------------

function varint(value: number): number[] {
  const out: number[] = [];
  while (value > 0x7f) {
    out.push((value & 0x7f) | 0x80);
    value = Math.floor(value / 128);
  }
  out.push(value);
  return out;
}

/** A length-delimited protobuf field: (field << 3 | 2), length, bytes. */
function lengthDelimited(field: number, bytes: Uint8Array): Uint8Array {
  const head = [...varint((field << 3) | 2), ...varint(bytes.length)];
  const out = new Uint8Array(head.length + bytes.length);
  out.set(head, 0);
  out.set(bytes, head.length);
  return out;
}

/** Split a protobuf message into its length-delimited fields. Other wire types are skipped. */
export function readFields(message: Uint8Array): Map<number, Uint8Array> {
  const fields = new Map<number, Uint8Array>();
  let pos = 0;
  const readVarint = (): number => {
    let result = 0;
    let scale = 1;
    for (;;) {
      if (pos >= message.length) throw new Error('Truncated protobuf varint');
      const byte = message[pos++]!;
      result += (byte & 0x7f) * scale;
      if ((byte & 0x80) === 0) return result;
      scale *= 128;
      if (scale > 2 ** 56) throw new Error('Protobuf varint too long');
    }
  };
  while (pos < message.length) {
    const key = readVarint();
    const field = Math.floor(key / 8);
    switch (key & 7) {
      case 0: readVarint(); break;
      case 1: pos += 8; break;
      case 5: pos += 4; break;
      case 2: {
        const length = readVarint();
        if (pos + length > message.length) throw new Error('Truncated protobuf field');
        fields.set(field, message.subarray(pos, pos + length));
        pos += length;
        break;
      }
      default: throw new Error(`Unsupported protobuf wire type ${key & 7}`);
    }
  }
  return fields;
}

// ---- gRPC-Web framing ------------------------------------------------------

/** Wrap a message in a gRPC-Web data frame: flag 0, 4-byte big-endian length, message. */
export function grpcWebFrame(message: Uint8Array): Uint8Array {
  const out = new Uint8Array(5 + message.length);
  new DataView(out.buffer).setUint32(1, message.length);
  out.set(message, 5);
  return out;
}

/** The first data frame of a gRPC-Web response, after checking the trailer's grpc-status. */
export function readGrpcWebResponse(body: Uint8Array): Uint8Array {
  let pos = 0;
  let data: Uint8Array | undefined;
  while (pos + 5 <= body.length) {
    const flag = body[pos]!;
    const length = new DataView(body.buffer, body.byteOffset + pos + 1, 4).getUint32(0);
    const payload = body.subarray(pos + 5, pos + 5 + length);
    if (payload.length !== length) throw new Error('Truncated gRPC-Web frame');
    if (flag & 0x80) {
      const trailer = new TextDecoder().decode(payload);
      const status = /grpc-status:\s*(\d+)/i.exec(trailer)?.[1];
      if (status !== undefined && status !== '0') {
        const message = /grpc-message:\s*([^\r\n]*)/i.exec(trailer)?.[1] ?? '';
        throw new Error(`gRPC status ${status}${message ? `: ${decodeURIComponent(message)}` : ''}`);
      }
    } else if (data === undefined) {
      data = payload;
    }
    pos += 5 + length;
  }
  if (data === undefined) throw new Error('gRPC-Web response had no message');
  return data;
}

// ---- accounts and mints ------------------------------------------------------

export interface RawAccount {
  address: string;
  /** The program that owns the account. */
  owner: string;
  data: Uint8Array;
}

/** raw_meta: the owning program's 32-byte key sits at bytes 16..48. */
const META_OWNER_OFFSET = 16;

export function encodeGetRawAccountRequest(address: string): Uint8Array {
  return lengthDelimited(1, lengthDelimited(1, decodeAddress(address)));
}

export function decodeRawAccount(message: Uint8Array): RawAccount {
  const fields = readFields(message);
  const pubkey = fields.get(1) ? readFields(fields.get(1)!).get(1) : undefined;
  const meta = fields.get(2);
  if (!pubkey || pubkey.length !== 32) throw new Error('RawAccount has no address');
  if (!meta || meta.length < META_OWNER_OFFSET + 32) throw new Error('RawAccount has no metadata');
  return {
    address: encodeAddress(pubkey),
    owner: encodeAddress(meta.subarray(META_OWNER_OFFSET, META_OWNER_OFFSET + 32)),
    data: fields.get(3) ?? new Uint8Array(),
  };
}

export interface OnChainMint {
  decimals: number;
  ticker: string;
  supplyRaw: string;
}

/** TokenMintAccount, packed: decimals u8, supply u64, creator, mint_authority, freeze_authority, has_freeze u8, ticker { len u8, bytes[8] }. */
export const MINT_ACCOUNT_SIZE = 1 + 8 + 32 * 3 + 1 + 1 + 8;

export function parseMintAccount(data: Uint8Array): OnChainMint {
  if (data.length !== MINT_ACCOUNT_SIZE) throw new Error(`Not a mint account: ${data.length} bytes`);
  const view = new DataView(data.buffer, data.byteOffset, data.length);
  const tickerLength = data[106]!;
  if (tickerLength > 8) throw new Error(`Bad ticker length ${tickerLength}`);
  const ticker = new TextDecoder().decode(data.subarray(107, 107 + tickerLength));
  return { decimals: data[0]!, ticker, supplyRaw: view.getBigUint64(1, true).toString() };
}

export interface RpcOptions {
  /** RPC base URL, e.g. https://rpc.alphanet.thru.org. */
  rpcUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export async function getRawAccount(address: string, options: RpcOptions): Promise<RawAccount> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const response = await fetchImpl(options.rpcUrl.replace(/\/+$/, '') + GET_RAW_ACCOUNT, {
    method: 'POST',
    headers: { 'content-type': 'application/grpc-web+proto', 'x-grpc-web': '1' },
    body: grpcWebFrame(encodeGetRawAccountRequest(address)),
    signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
  });
  if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
  return decodeRawAccount(readGrpcWebResponse(new Uint8Array(await response.arrayBuffer())));
}

/**
 * Ticker and decimals for each mint, read from the chain. A mint that can't
 * be read, isn't owned by the Token Program, or doesn't parse is left out,
 * so the export carries on with whatever else it knows.
 */
export async function fetchMints(mints: string[], options: RpcOptions): Promise<Map<string, OnChainMint>> {
  const found = new Map<string, OnChainMint>();
  for (const mint of mints) {
    try {
      const account = await getRawAccount(mint, options);
      if (account.address !== mint || !TOKEN_PROGRAMS.has(account.owner)) continue;
      found.set(mint, parseMintAccount(account.data));
    } catch {
      // Unreachable node, unknown account or unexpected layout: fall back quietly.
    }
  }
  return found;
}
