import type { TransactionDetail, AddressTransactionsResponse } from '../src/types.js';

/**
 * Captured from https://scan.thru.org on 2026-09-20 (Thru alphanet).
 * Event payloads are truncated; nothing else is altered.
 */
export const ACCOUNT = 'ta7nShvt3yYCDIOWg8cbEqH_zbm80GzcB0fngKMHyfhTJo';

export const ORACLE_TX: TransactionDetail = {
  slot: 13132384,
  signature: 'tsZ9KeARYIciz8SCCfjVl1hAVNAQBkGaAmpInlFVxyi4wcGQeJui4akH89b1sK17ZfqTFiZ1dQjJC0cUL4ggysBBju',
  consensusStatus: { label: 'Included', kind: 'success' },
  executionError: { vmErrorStatus: { label: 'Success', kind: 'success' }, vmError: 0, userErrorCode: '0' },
  executionResultValue: '0',
  fee: '0',
  computeUnits: { requested: '4000000', consumed: '24985' },
  stateUnits: { requested: '3', consumed: '0' },
  memoryUnits: { requested: '10000', consumed: '5' },
  blockTimestampNs: '1789921727334450933',
  nonce: '1744993',
  feePayer: ACCOUNT,
  program: 'tatPH9XJbriBMntQG_GU6r4YWZCcco1wEGgPw2gY3iFaj8',
  transactionSize: 338,
  accounts: {
    readWriteAccounts: [
      'taJi72Lum0eQiygRNGG28Z55KL0dkMVHM-FMQLqTEujC4p',
      'taweFvU5TFza3TWNtrTHQsj4DHh5FSzv7CllJhkMB1lenu',
    ],
    readOnlyAccounts: ['taQlmNDxbXJUeInC24XEAhKw66BpqtcAraLMeA4PgBwPTq'],
    feePayer: ACCOUNT,
    program: 'tatPH9XJbriBMntQG_GU6r4YWZCcco1wEGgPw2gY3iFaj8',
  },
  events: {
    events: [
      { programAddress: 'taQlmNDxbXJUeInC24XEAhKw66BpqtcAraLMeA4PgBwPTq', payloadHex: '014254432d5553443a74' },
      { programAddress: 'taQlmNDxbXJUeInC24XEAhKw66BpqtcAraLMeA4PgBwPTq', payloadHex: '014554482d5553443a74' },
    ],
    eventsCount: 2,
    eventsSize: 242,
  },
};

/** A transfer paid for by a different account, with a non-zero fee. */
export const SYSTEM_TX: TransactionDetail = {
  slot: 13131568,
  signature: 'tsFnsD3rWKDovmSfnzmDiuzDXNuUwgV7hoi_uO9wS8iTEd_CXAVVL1w5JhncSK2jiEAUsodIKRrcOmkw0JnYw1Bh_B',
  consensusStatus: { label: 'Included', kind: 'success' },
  executionError: { vmErrorStatus: { label: 'Success', kind: 'success' }, vmError: 0, userErrorCode: '0' },
  fee: '1',
  computeUnits: { requested: '10000', consumed: '5629' },
  blockTimestampNs: '1789921568367326535',
  feePayer: 'taeB_kOGywmb9rANrnMzMPaZbdV81_e79b7kRBIOdEzE60',
  program: 'taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  transactionSize: 210,
  accounts: { readWriteAccounts: [ACCOUNT], readOnlyAccounts: [] },
};

export const LIST_PAGE: AddressTransactionsResponse = {
  data: {
    address: ACCOUNT,
    transactions: [
      { signature: ORACLE_TX.signature, program: ORACLE_TX.program, feePayer: ACCOUNT, fee: '0', status: 'SUCCESS', slot: 13132384 },
      { signature: SYSTEM_TX.signature, program: SYSTEM_TX.program, feePayer: SYSTEM_TX.feePayer, fee: '1', status: 'SUCCESS', slot: 13131568 },
    ],
    pagination: { pageSize: 100, nextPageToken: '12150508:168' },
  },
};
