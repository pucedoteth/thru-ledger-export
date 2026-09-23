import type { TransactionDetail } from '../src/types.js';
import { WALLET } from './token-fixtures.js';

/** Real transactions captured from scan.thru.org (alphanet) on 2026-09-23. */

const ok = {
  consensusStatus: { label: 'Included', kind: 'success' },
  executionError: { vmErrorStatus: { label: 'Success', kind: 'success' }, vmError: 0, userErrorCode: '0' },
} as const;

/** WALLET takes 10,000 raw THRU (0.00001) from the faucet: its whole THRU balance. */
export const FAUCET_TX: TransactionDetail = {
  ...ok,
  slot: 13131575,
  signature: 'ts2RLXvJoWyrBoN6FJsKQjQVAyyZRCCGL6ViFya9T7Gw1Epsmdk_-xTf_9knqeHn84Y43ICfGDX95AW0QXtJ7sBx_B',
  blockTimestampNs: '1789921560345143812',
  fee: '0',
  feePayer: WALLET,
  program: 'taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPr6',
  transactionSize: 224,
  accounts: { readWriteAccounts: ['taxoImN8fTEOxXYnvgC6JZ0lN0n0qvZERwz_vlOjX3MkIn'], readOnlyAccounts: [] },
  instructions: { instruction: '01000000020000001027000000000000', programAddress: 'taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPr6' },
};

/** WALLET's first transaction: a no-op, which moves nothing. */
export const NOOP_TX: TransactionDetail = {
  ...ok,
  slot: 13131561,
  signature: 'ts8Cswzq8sYnrBY4AHBKcoKCnYFhf5vMNrCue0sAb4B9GjxoSJEcmI0LxH_ic9vDz-dX2qOuRm_LcljHrEg2MtCx-V',
  blockTimestampNs: '1789921557445833609',
  fee: '0',
  feePayer: WALLET,
  program: 'taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMD',
  accounts: { readWriteAccounts: [], readOnlyAccounts: [] },
};

export const EOA_SENDER = 'taeB_kOGywmb9rANrnMzMPaZbdV81_e79b7kRBIOdEzE60';
export const EOA_RECIPIENT = 'ta28ry8zTv37XAWBy6lbrTrXQugTdVkH6OySW0QBHfewGX';

/** A plain THRU transfer of 1 raw unit through the EOA program, fee 1. */
export const EOA_TX: TransactionDetail = {
  ...ok,
  slot: 13131568,
  signature: 'tsFnsD3rWKDovmSfnzmDiuzDXNuUwgV7hoi_uO9wS8iTEd_CXAVVL1w5JhncSK2jiEAUsodIKRrcOmkw0JnYw1Bh_B',
  blockTimestampNs: '1789921559095752726',
  fee: '1',
  feePayer: EOA_SENDER,
  program: 'taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  transactionSize: 224,
  accounts: { readWriteAccounts: [EOA_RECIPIENT], readOnlyAccounts: [] },
  instructions: { instruction: '01000000010000000000000000000200', programAddress: 'taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
};
