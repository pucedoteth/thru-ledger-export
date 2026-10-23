import type { TransactionDetail } from '../src/types.js';

/**
 * A real Thru Wallet (wallet.tid.sh) account and its test THRUSD, captured
 * from scan.thru.org (alphanet) on 2026-10-23:
 *   12:05:44 local  the wallet is created (Multicall, Wallet Program)
 *   12:05:47        the wallet's THRUSD token account is created
 *   12:13:52        the dev.thru.org faucet mints 100 THRUSD into it
 * The mint only touches the token account, never the wallet address, which is
 * why v0.4.0 left it out of a wallet export.
 */
export const THRUSD_WALLET = 'tawGA6fGKHhQxwr8GPgA_GM1rKNW4i9t3i8KANQsj5zpTn';
export const THRUSD_TOKEN_ACCOUNT = 'taF1pr85gBJRrkKru7rB9wqZcET6iTaADV-EBYVbYFNwxU';
export const THRUSD_MINT = 'taRfWjryqWSRRp6ZU_ahCHXKhEA0oRVKWZlE4Us86vnOOt';
export const TOKEN_PROGRAM_V2 = 'taTOKENKRgcl3vO0yVhftATDbXuhgWcfaaxv9xpEEdMdUE';
export const WALLET_PROGRAM = 'taPASSIvjIgz2kZ1CIIhvbT00XV9Ve5kZ2I9uDLanzIgbA';
const MULTICALL = 'taMULTIrOL8WpIFr16C1ECsO60qAsuwmwJephZHDOTvSeP';
const WALLET_SPONSOR = 'taQyXrbLbUSQ2mZAzULJqrX5J2uWOaLY9KdHvgW5Rqq15O';
const FAUCET = 'taDOTQyYDVPvYqIFKNBFbOIstmBXeY7Ne06JnUAjmHa4VI';

const ok = {
  consensusStatus: { label: 'Included', kind: 'success' },
  executionError: { vmErrorStatus: { label: 'Success', kind: 'success' }, vmError: 0, userErrorCode: '0' },
  executionResultValue: '0',
  fee: '0',
};

export const WALLET_CREATED_TX: TransactionDetail = {
  ...ok,
  slot: 1842709,
  signature: 'tsSoup03pvKGHpkOQjqsykavDT_TJcOzfWii5TPl2EsKL5pwJLXtZAkmbr3WpLRczGnmSNMiLAJRll-LOfNW9UCCAW',
  blockTimestampNs: '1792749944566296440',
  feePayer: WALLET_SPONSOR,
  program: MULTICALL,
  transactionSize: 1671,
  nonce: '1',
  computeUnits: { requested: '300000000', consumed: '82735' },
  stateUnits: { requested: '2', consumed: '2' },
  memoryUnits: { requested: '10000', consumed: '8' },
  accounts: {
    readWriteAccounts: ['taf3T5vjRTtDX3KAlql9pj52fp2xxiQKFINS0zHLnWHooh', THRUSD_WALLET],
    readOnlyAccounts: [WALLET_PROGRAM],
    feePayer: WALLET_SPONSOR,
    program: MULTICALL,
  },
  events: {
    eventsCount: 2,
    eventsSize: 163,
    events: [
      { programAddress: WALLET_PROGRAM, payloadHex: '00c0603a7c6287850c70afc18f800fc6335aca356e22f6dde2f0a00d42c8f9ce940156087aabd27565a57ef033556d95d3226f2d537433a91f34a5884fba27f991647e61e64b0814e4444ad2ffbc1d74b4ceb0693559084a36bdfe82f31efc6366ea' },
      { programAddress: WALLET_PROGRAM, payloadHex: '03c0603a7c6287850c70afc18f800fc6335aca356e22f6dde2f0a00d42c8f9ce947f74f9be3453b435f728096a97da63e767e9db1c6240a148352d331cb9d61e8a' },
    ],
  },
};

export const THRUSD_INIT_ACCOUNT_TX: TransactionDetail = {
  ...ok,
  slot: 1842713,
  signature: 'tsPZ7uDYRkQkP8-gbvCL7AE4144-0epK-EpdWc1R_mBbwxufviagbwNgvqYioTNrqvCTEVr_E3JZc1YoXIDxcHAx3I',
  blockTimestampNs: '1792749947634887708',
  feePayer: WALLET_SPONSOR,
  program: TOKEN_PROGRAM_V2,
  transactionSize: 895,
  nonce: '2',
  computeUnits: { requested: '300000000', consumed: '50446' },
  stateUnits: { requested: '1', consumed: '1' },
  memoryUnits: { requested: '10000', consumed: '4' },
  accounts: {
    readWriteAccounts: [THRUSD_TOKEN_ACCOUNT],
    readOnlyAccounts: [THRUSD_MINT, THRUSD_WALLET],
    feePayer: WALLET_SPONSOR,
    program: TOKEN_PROGRAM_V2,
  },
  events: {
    eventsCount: 1,
    eventsSize: 97,
    events: [{
      programAddress: TOKEN_PROGRAM_V2,
      payloadHex: '01175a6bf39801251ae42abbbbac1f70a997044fa8936800d5f8405855b605370cc0603a7c6287850c70afc18f800fc6335aca356e22f6dde2f0a00d42c8f9ce9445f5a3af2a96491469e9953f6a10875ca844034a1154a599944e14b3ceaf9ce3',
    }],
  },
};

export const THRUSD_FAUCET_MINT_TX: TransactionDetail = {
  ...ok,
  slot: 1844491,
  signature: 'tsATTotmT8AnhSgMvkp6RtbKM2cgoAhy7RRmXIdKHTuNlAvA9Qt3ihZIiRN7WCli-ocqinXIyTnBqxbESBdkrEBx77',
  blockTimestampNs: '1792750432492384155',
  feePayer: FAUCET,
  program: TOKEN_PROGRAM_V2,
  transactionSize: 255,
  nonce: '185',
  computeUnits: { requested: '300000000', consumed: '21792' },
  stateUnits: { requested: '0', consumed: '0' },
  memoryUnits: { requested: '10000', consumed: '5' },
  accounts: {
    readWriteAccounts: [THRUSD_TOKEN_ACCOUNT, THRUSD_MINT],
    readOnlyAccounts: [],
    feePayer: FAUCET,
    program: TOKEN_PROGRAM_V2,
  },
  events: {
    eventsCount: 1,
    eventsSize: 121,
    events: [{
      programAddress: TOKEN_PROGRAM_V2,
      payloadHex: '0345f5a3af2a96491469e9953f6a10875ca844034a1154a599944e14b3ceaf9ce3175a6bf39801251ae42abbbbac1f70a997044fa8936800d5f8405855b605370c0ce4d0c980d53ef62a20528d0456ce22cb66057798ecd7b4e899d40239876b8500e1f5050000000000e1f505000000004053fb2f00000000',
    }],
  },
};

/** Which signatures each address's /transactions listing returned, newest first. */
export const THRUSD_LISTINGS: Record<string, TransactionDetail[]> = {
  [THRUSD_WALLET]: [THRUSD_INIT_ACCOUNT_TX, WALLET_CREATED_TX],
  [THRUSD_TOKEN_ACCOUNT]: [THRUSD_FAUCET_MINT_TX, THRUSD_INIT_ACCOUNT_TX],
};
