/**
 * Native THRU movements. These never show up as events: plain THRU moves
 * through the EOA program and the faucet, whose instruction bytes carry the
 * amount and account indices. Layouts follow Thru's own transaction builders
 * (rpc/thru-base/src/txn_tools.rs in Unto-Labs/thru).
 */
import { hexToBytes } from './address.js';
import type { TransactionDetail } from './types.js';

/**
 * The EOA program moves THRU between accounts. Thru v0.4.0 (September 2026)
 * gave every bootstrap program a new address, and Alphanet was reset onto
 * them; Betanet uses them too (rpc/thru-base/src/bootstrap_addresses.rs).
 */
export const EOA_PROGRAM = 'taEOAD2uLK1SLzPgtabFLUAx22yDlBs9DE9nZFTOESIGRr';
export const FAUCET_PROGRAM = 'taFCTxR0y2eabGGaEdtTwC9pHz7ZY4CYD7FOiBFUJeAW16';
/** Does nothing on its own; an account is created by a NOOP transaction carrying a proof that its fee payer is new. */
export const NOOP_PROGRAM = 'taNOOPV4A7S3WTsirr149To2GoGZ9q8zllQaBrbekHfkJT';
/** Addresses before the v0.4.0 reset: the all-zero key, and the key ending 0xFA. Kept so older data still decodes. */
export const LEGACY_EOA_PROGRAM = 'taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
export const LEGACY_FAUCET_PROGRAM = 'taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPr6';
const EOA_PROGRAMS = new Set([EOA_PROGRAM, LEGACY_EOA_PROGRAM]);
const FAUCET_PROGRAMS = new Set([FAUCET_PROGRAM, LEGACY_FAUCET_PROGRAM]);
/** Used in the tokenMint and tokenSymbol columns for native THRU. */
export const NATIVE_SYMBOL = 'THRU';
export const NATIVE_DECIMALS = 9;

export interface NativeTransfer {
  kind: 'thru_transfer' | 'faucet_withdraw' | 'faucet_deposit';
  from: string;
  to: string;
  amountRaw: string;
}

/**
 * The account list that instruction indices point into:
 * 0 = fee payer, 1 = program, then read-write accounts, then read-only accounts.
 */
export function transactionAccounts(detail: TransactionDetail): string[] {
  return [
    detail.feePayer ?? detail.accounts?.feePayer ?? '',
    detail.program ?? detail.accounts?.program ?? '',
    ...(detail.accounts?.readWriteAccounts ?? []),
    ...(detail.accounts?.readOnlyAccounts ?? []),
  ];
}

/** Decode a native THRU movement from the transaction's instruction, if it has one. */
export function decodeNativeTransfer(detail: TransactionDetail): NativeTransfer | undefined {
  const program = detail.instructions?.programAddress ?? detail.program ?? '';
  const hex = detail.instructions?.instruction;
  const isEoa = EOA_PROGRAMS.has(program);
  if (!hex || (!isEoa && !FAUCET_PROGRAMS.has(program))) return undefined;

  let bytes: Uint8Array;
  try {
    bytes = hexToBytes(hex);
  } catch {
    return undefined;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 4) return undefined;
  const discriminant = view.getUint32(0, true);
  const accounts = transactionAccounts(detail);
  const account = (index: number) => accounts[index];

  const result = (kind: NativeTransfer['kind'], fromIdx: number, toIdx: number, amount: bigint): NativeTransfer | undefined => {
    const from = account(fromIdx);
    const to = account(toIdx);
    if (!from || !to) return undefined;
    return { kind, from, to, amountRaw: amount.toString() };
  };

  if (isEoa) {
    // TRANSFER (1): u32 discriminant, u64 amount, u16 from, u16 to — 16 bytes.
    if (discriminant !== 1 || bytes.length !== 16) return undefined;
    return result('thru_transfer', view.getUint16(12, true), view.getUint16(14, true), view.getBigUint64(4, true));
  }
  // Faucet WITHDRAW (1): u32, u16 faucet, u16 recipient, u64 amount — 16 bytes.
  if (discriminant === 1 && bytes.length === 16) {
    return result('faucet_withdraw', view.getUint16(4, true), view.getUint16(6, true), view.getBigUint64(8, true));
  }
  // Faucet DEPOSIT (0): u32, u16 faucet, u16 depositor, u16 eoa program, u64 amount — 18 bytes.
  if (discriminant === 0 && bytes.length === 18) {
    return result('faucet_deposit', view.getUint16(6, true), view.getUint16(4, true), view.getBigUint64(10, true));
  }
  return undefined;
}

/** TN_TXN_FLAG_HAS_FEE_PAYER_PROOF is bit 0 of the transaction flags (rpc/thru-base/src/tn_txn.rs). */
const HAS_FEE_PAYER_PROOF = 1;

/**
 * Whether this transaction created the address's account: what `thru account create`
 * sends (TransactionBuilder::build_create_with_fee_payer_proof), a transaction to the
 * NOOP program, paid for by the new account, with a fee-payer state proof.
 */
export function isAccountCreation(detail: TransactionDetail, address: string): boolean {
  const program = detail.program ?? detail.accounts?.program ?? detail.instructions?.programAddress;
  const feePayer = detail.feePayer ?? detail.accounts?.feePayer;
  return program === NOOP_PROGRAM && feePayer === address && ((Number(detail.flags) || 0) & HAS_FEE_PAYER_PROOF) !== 0;
}
