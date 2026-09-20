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
  explorerUrl: string;
}
