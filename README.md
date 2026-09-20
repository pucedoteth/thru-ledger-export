# thru-ledger-export

Export a [Thru](https://thru.org) account's transaction history to CSV or JSON, for bookkeeping, audit trails and analysis.

Thru's explorer shows transactions one page at a time in a browser. If you need the whole history of an account in a spreadsheet — to reconcile activity, review fees, or hand an auditor a file they can read — this CLI fetches every page for you and writes one row per transaction.

No API key. No account. No runtime dependencies.

## Install

```bash
npm install -g thru-ledger-export
```

Or run it without installing:

```bash
npx thru-ledger-export <address> -o ledger.csv
```

Requires Node.js 20 or newer.

## Usage

```bash
# Whole history to a CSV file
thru-ledger-export taNXLcTwQfg0fR-ZDKOeJLFnBIoWlLdM8ZvB6e58dn9rcC -o ledger.csv

# One quarter only
thru-ledger-export <address> --from 2026-01-01 --to 2026-03-31 -o q1.csv

# The 50 most recent transactions, successful ones only
thru-ledger-export <address> --limit 50 --success-only -o recent.csv

# JSON instead, including the account balance and total fees
thru-ledger-export <address> -f json -o ledger.json
```

| Option | Meaning |
| --- | --- |
| `-o, --out <file>` | Write to a file instead of standard output |
| `-f, --format <fmt>` | `csv` (default) or `json` |
| `--from <YYYY-MM-DD>` | Keep transactions on or after this UTC date |
| `--to <YYYY-MM-DD>` | Keep transactions on or before this UTC date |
| `--limit <n>` | Stop after n transactions, newest first |
| `--success-only` | Drop transactions that failed consensus or execution |
| `--base-url <url>` | Explorer base URL (default `https://scan.thru.org`) |
| `--concurrency <n>` | Parallel detail requests (default 4) |
| `-q, --quiet` | No progress output |

## Output columns

One row per transaction, oldest first.

| Column | Meaning |
| --- | --- |
| `timestampUtc`, `date` | Block time in UTC, from `blockTimestampNs` |
| `slot` | Block slot number |
| `signature` | Transaction signature |
| `program` | Program the transaction invoked |
| `feePayer` | Account that paid the fee |
| `role` | `fee-payer` if the exported account paid, otherwise `account-referenced` |
| `consensus`, `execution`, `succeeded` | Consensus label, VM result label, and a single true/false |
| `feeRaw`, `feeThru` | Fee in raw units and in THRU (1 THRU = 1,000,000,000 raw) |
| `computeUnitsConsumed`, `stateUnitsConsumed`, `memoryUnitsConsumed` | Resources consumed |
| `transactionSizeBytes` | Size of the transaction |
| `readWriteAccounts`, `readOnlyAccounts` | Accounts touched, space separated |
| `eventsCount` | Number of events emitted |
| `explorerUrl` | Link back to the transaction in the explorer |

Amounts are written as exact decimal strings using big integers, so no value is rounded. Fields beginning with `=`, `+`, `-` or `@` are prefixed with an apostrophe so Excel and Sheets treat them as text rather than formulas, and the file carries a UTF-8 byte-order mark so Excel opens it with the right encoding.

## Use as a library

```ts
import { exportAccount, toCsv } from 'thru-ledger-export';

const result = await exportAccount('taNXLcTw...dn9rcC', { limit: 100 });
console.log(result.totalFeesThru, 'THRU in fees');
console.log(toCsv(result.rows));
```

`ThruExplorerClient` is exported too, if you want the raw explorer responses: `getAccount`, `getTransaction`, `listAllTransactions` and `getTransactions`.

## What this does not do

Being clear about the limits matters more than a longer feature list:

- **No token or balance amounts per transaction.** The explorer API returns event payloads as raw hex, which need the program's ABI to decode. This tool reports fees, resource usage and which accounts were touched — not "sent 5 THRU to X". Decoding events through `/api/abi/{program}` is the obvious next step.
- **No running balance column**, for the same reason. The JSON output does include the account's current balance.
- **Timestamps come from the block**, which is when the network recorded the transaction.
- **Data comes from the public explorer** at `scan.thru.org`, which serves Thru's alphanet. This is a read-only tool: it never asks for a key, a seed phrase or a signature.
- **No rate limits are published** for the explorer API. The default of 4 parallel requests is deliberately gentle; raise `--concurrency` at your own risk.

## Development

```bash
npm install
npm test          # vitest, runs against recorded API fixtures
npm run typecheck
npm run build
```

Tests use responses captured from `scan.thru.org` on 2026-09-20, so they run offline and don't depend on chain state.

## License

MIT — see [LICENSE](LICENSE).

Not affiliated with Unto Labs. Thru and the Thru Explorer are their work; this is an independent tool built on their public API.
