/** Shapes returned by the Thru Explorer Agent API (https://scan.thru.org/api). */

export interface StatusLabel {
  label: string;
  kind: string;
}

export interface UnitCounter {
  requested?: string;
  consumed?: string;
}

export interface ExecutionError {
  vmErrorStatus?: StatusLabel;
  vmError?: number;
  userErrorCode?: string;
}

export interface TransactionAccounts {
  readWriteAccounts?: string[];
  readOnlyAccounts?: string[];
  feePayer?: string;
  program?: string;
}

export interface TransactionEvent {
  programAddress?: string;
  payloadHex?: string;
}

export interface TransactionEvents {
  events?: TransactionEvent[];
  eventsCount?: number;
  eventsSize?: number;
}

/** One entry of /api/address/{address}/transactions. */
export interface TransactionSummary {
  signature: string;
  truncatedSignature?: string;
  program?: string;
  feePayer?: string;
  fee?: string;
  status?: string;
  slot?: number;
}

export interface Pagination {
  pageSize?: number;
  nextPageToken?: string;
}

export interface AddressTransactionsResponse {
  data: {
    address: string;
    transactions?: TransactionSummary[];
    pagination?: Pagination;
  };
}

/** /api/tx/{signature} */
export interface TransactionDetail {
  slot?: number;
  signature: string;
  consensusStatus?: StatusLabel;
  executionError?: ExecutionError;
  executionResultValue?: string;
  fee?: string;
  computeUnits?: UnitCounter;
  stateUnits?: UnitCounter;
  memoryUnits?: UnitCounter;
  blockTimestampNs?: string;
  nonce?: string;
  feePayer?: string;
  program?: string;
  transactionSize?: number;
  accounts?: TransactionAccounts;
  events?: TransactionEvents;
}

export interface TransactionDetailResponse {
  data: TransactionDetail;
}

export interface AccountResponse {
  data: {
    address: string;
    owner?: string;
    balance?: string;
    balanceRaw?: string;
    slot?: string;
    blockTimestampNs?: string;
  };
}

/** /api/abi/{program} */
export interface AbiResponse {
  data: {
    programAddress: string;
    programName?: string;
    /** The ABI document, as YAML text. */
    abi: string;
  };
}

/** One event of a transaction, decoded with its program's ABI when possible. */
export interface DecodedEvent {
  index: number;
  program: string;
  programName?: string;
  /** Event variant, e.g. transfer, mint_to, burn. Empty when not decoded. */
  type: string;
  decoded: boolean;
  /** Decoded fields: u64 values as decimal strings, addresses as ta… strings. */
  fields?: Record<string, unknown>;
  /** Why the event could not be decoded. */
  error?: string;
}

/** One output row: a single transaction, flattened for a spreadsheet. */
export interface LedgerRow {
  timestampUtc: string;
  date: string;
  slot: number | '';
  signature: string;
  program: string;
  feePayer: string;
  role: 'fee-payer' | 'account-referenced';
  consensus: string;
  execution: string;
  succeeded: boolean;
  feeRaw: string;
  feeThru: string;
  computeUnitsConsumed: string;
  stateUnitsConsumed: string;
  memoryUnitsConsumed: string;
  transactionSizeBytes: number | '';
  readWriteAccounts: string;
  readOnlyAccounts: string;
  eventsCount: number;
  /** What the transaction did, from its decoded events (e.g. transfer, mint_to, burn). */
  action: string;
  /** Token mint the movement is in, and its ticker when known. */
  tokenMint: string;
  tokenSymbol: string;
  /** Amount moved in the token's smallest unit, and in whole tokens when decimals are known. */
  amountRaw: string;
  amount: string;
  /** in / out for the exported account, self for a move between its own accounts. */
  direction: 'in' | 'out' | 'self' | '';
  counterparty: string;
  /** The exported account's token balance right after this transaction, as reported on chain. */
  tokenBalanceAfterRaw: string;
  tokenBalanceAfter: string;
  /** Events decoded / events present. */
  eventsDecoded: number;
  explorerUrl: string;
  /** Every event, decoded where possible. JSON output only. */
  events?: DecodedEvent[];
}
