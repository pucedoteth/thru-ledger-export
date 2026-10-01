# thru-ledger-export

Export a [Thru](https://thru.org) account's transaction history to CSV or JSON, for bookkeeping, audit trails and analysis.

Thru's explorer shows transactions one page at a time in a browser. If you need the whole history of an account in a spreadsheet — to reconcile activity, review fees, or hand an auditor a file they can read — this CLI fetches every page for you and writes one row per transaction.

No API key. No account. No runtime dependencies.

## Install

Run it straight from GitHub, without installing anything first:

```bash
npx github:pucedoteth/thru-ledger-export <address> -o ledger.csv
```

Or install it once and use the short name afterwards:

```bash
npm install -g github:pucedoteth/thru-ledger-export
thru-ledger-export <address> -o ledger.csv
```

The first run downloads and builds the tool, so it takes a minute; later runs are fast.
To pin a version, add a release tag, e.g. `github:pucedoteth/thru-ledger-export#v0.2.0`.

Requires Node.js 20 or newer. (The package is not on the npm registry yet, so
`npm install thru-ledger-export` without `github:` won't find it.)

## Usage

```bash
# Whole history to a CSV file (Alphanet)
thru-ledger-export <address> -o ledger.csv

# The same on Betanet
thru-ledger-export <address> --network betanet -o ledger.csv

# One quarter only
thru-ledger-export <address> --from 2026-01-01 --to 2026-03-31 -o q1.csv

# The 50 most recent transactions, successful ones only
thru-ledger-export <address> --limit 50 --success-only -o recent.csv

# JSON instead, including the account balance, total fees and per-token totals
thru-ledger-export <address> -f json -o ledger.json

# Perp trades as a second CSV, next to the ledger (Betanet)
thru-ledger-export <address> --network betanet -o ledger.csv --trades trades.csv

# A token account this address owned before the exported period
thru-ledger-export <address> --from 2026-07-01 --token-account <token-account> -o h2.csv
```

| Option | Meaning |
| --- | --- |
| `-o, --out <file>` | Write to a file instead of standard output |
| `-f, --format <fmt>` | `csv` (default) or `json` |
| `--from <YYYY-MM-DD>` | Keep transactions on or after this UTC date |
| `--to <YYYY-MM-DD>` | Keep transactions on or before this UTC date |
| `--limit <n>` | Stop after n transactions, newest first |
| `--success-only` | Drop transactions that failed consensus or execution |
| `--no-decode` | Don't decode events: no amount columns, and no ABI requests |
| `--token-account <address>` | A token account owned by the exported address (repeatable; see below) |
| `--trades <file>` | Also write the address's Perp trades to this CSV; see [Perp trades](#perp-trades) |
| `-n, --network <name>` | `alphanet` (default) or `betanet`; see [Networks](#networks) |
| `--base-url <url>` | Explorer base URL (default `https://scan.thru.org`) |
| `--concurrency <n>` | Parallel detail requests (default 4) |
| `-q, --quiet` | No progress output |

## Networks

The explorer at `scan.thru.org` serves more than one Thru network, chosen with
`?network=`. When a request doesn't name one, it gets "the first configured
network", which can change without notice, so this tool names the network on
every request. The default is `alphanet`; add `--network betanet` for Betanet.
The `explorerUrl` column links to the same network.

Thru v0.4.0 (September 2026) moved every built-in program to a new address
(the EOA program to `taEOAD2u…`, the faucet to `taFCTx…`, the Token Program to
`taTOKEN…`), and Alphanet was reset onto them; Betanet uses them too. Histories
from before that reset are no longer on the explorer. The tool recognises both
the new addresses and the old ones, so data captured before the reset still
decodes.

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
| `action` | What the transaction did, from its decoded events: `transfer`, `mint_to`, `burn`, `initialize_mint`, `initialize_account`… |
| `tokenMint`, `tokenSymbol` | The token involved, and its ticker when known |
| `amountRaw`, `amount` | Amount moved, in the token's smallest unit and in whole tokens |
| `direction` | `in` or `out` for the exported account, `self` between its own accounts |
| `counterparty` | The other account in a transfer |
| `tokenBalanceAfterRaw`, `tokenBalanceAfter` | The exported account's token balance right after the transaction, as reported on chain |
| `eventsDecoded` | How many of the transaction's events could be decoded |
| `thruBalanceAfterRaw`, `thruBalanceAfter` | The exported account's THRU balance right after the transaction (see below) |
| `explorerUrl` | Link back to the transaction in the explorer |

Amounts are written as exact decimal strings using big integers, so no value is rounded. Fields beginning with `=`, `+`, `-` or `@` are prefixed with an apostrophe so Excel and Sheets treat them as text rather than formulas, and the file carries a UTF-8 byte-order mark so Excel opens it with the right encoding.

## Token amounts

Thru's explorer returns each event as raw hex. For every program that emits
events, the tool fetches that program's published ABI once, from
`/api/abi/{program}`, and decodes the events with it. For the Token Program that
gives transfers, mints and burns with their amounts, and the balance after each
one, straight from the chain, so the balance column needs no arithmetic and can
be checked against the explorer.

A few things to know:

- **Ownership.** A token balance lives in a *token account* owned by your
  address, not in the address itself. The tool learns which token accounts are
  yours from the account-creation events in the fetched history. If a token
  account was created before the history you export (for example with
  `--limit`), pass it with `--token-account` so its movements get a direction
  and a balance. Date filters (`--from`, `--to`) don't hide ownership: they are
  applied after the whole history is read.
- **Decimals and tickers** come from the mint's creation event. When that isn't
  in the history, `amount` and `tokenBalanceAfter` stay empty and the `…Raw`
  columns still carry the exact values.
- **One row per transaction.** When a transaction moves several tokens, the row
  shows the first movement that involves your account. The JSON output has
  every decoded event under `rows[].events`, plus `tokenTotals` with each
  token's total in, total out, net and closing balance.
- **No guessing.** A payload that doesn't match the ABI byte for byte is left
  undecoded (`decoded: false` with the reason in the JSON), never partly read.

## Native THRU

Plain THRU never appears as an event: it moves through the EOA program and the
faucet, so the tool reads those programs' instruction bytes instead (layouts
from Thru's own transaction builders). Those rows get `action` `thru_transfer`,
`faucet_withdraw` or `faucet_deposit`, with `tokenMint` and `tokenSymbol` set to
`THRU` and amounts to 9 decimals. Failed transactions move nothing and are not
counted, though their fee still is.

The explorer only gives today's THRU balance, so `thruBalanceAfter` is worked
back from it through every decoded transfer and every fee the account paid.
Every account starts at zero, which gives a check: when the whole history is
exported, working back must end at exactly 0. The JSON output reports this as
`thruCheck`, and the command warns if it doesn't hold. That means THRU moved in
a way the tool doesn't decode yet (another program, for example), so treat the
THRU balance column with care for that account.

## Opening, movements and closing

For each token, and for THRU, the summary (printed after a file export, and as
`tokenTotals` in JSON) gives the period's figures:

```
MFT: opening 1000000.006567 + in 1.000000 - out 2.500000 = closing 999998.506567 (reconciles)
THRU: opening 0.000010000 + in 0.000000000 - out 0.000000000 - fees 0.000000000 = closing 0.000010000 (reconciles)
```

The period is whatever `--from` and `--to` select. Openings come from the
history before the period, which is always fetched in full; with `--limit` the
start of the history may be cut off, so an opening balance can show as unknown
rather than a guessed zero. Token balances come straight from on-chain events;
THRU balances are derived as described above.

## Perp trades

Thru's Perp Program (live on Betanet) emits an event for every fill, collateral
deposit and withdrawal, and liquidation. When the exported address takes part,
`--trades <file>` writes one row per event to a separate CSV, and JSON output
gains `trades` and per-market `tradeTotals`. In the ledger itself these
transactions get the action `perp_fill`, `perp_deposit`, `perp_withdraw` or
`perp_liquidation`.

| Column | Meaning |
| --- | --- |
| `kind` | `fill`, `deposit`, `withdraw` or `liquidation` |
| `role` | `taker` or `maker` for fills; `liquidator` or `liquidated` |
| `side` | `buy` or `sell`, from the address's side of the fill (the maker's side is the opposite of the taker's) |
| `price` | Quote atoms per base atom (the mark price, for liquidations) |
| `qty` | Base atoms (lots, for liquidations) |
| `notionalQuoteRaw` | `price × qty`, in quote atoms |
| `amountQuoteRaw` | Collateral moved, for deposits and withdrawals |
| `feeQuoteRaw` | Liquidation fee |
| `longLotsAfter`, `shortLotsAfter`, `netLotsAfter` | The address's position in that market right after |
| `collateralQuoteAfterRaw` | The seat's quote balance right after, when the event reports it |
| `counterparty` | The other seat of a fill or liquidation, or the vault for deposits and withdrawals |

Amounts stay raw: the explorer doesn't return account data, so the quote token
(`quoteMint`) is known only when the market's creation is in the fetched
history, and decimals aren't applied. The units follow Thru's own Perp client.
On both live Betanet markets the lot size is 1, and across consecutive fills the
position changed by exactly `qty` lots; on a market with another lot size, check
`qty` against the lot columns before relying on the notional. Profit and loss
settles into the seat's quote balance on every fill, so the trades CSV records
trades and positions, not realised gains.

## Use as a library

```ts
import { exportAccount, toCsv } from 'thru-ledger-export';

const result = await exportAccount('<address>', { network: 'betanet', limit: 100 });
console.log(result.totalFeesThru, 'THRU in fees');
console.log(toCsv(result.rows));
console.log(result.tokenTotals); // per token: in, out, net, closing balance
console.log(result.tradeTotals); // per Perp market: fills, bought, sold, closing position
```

`ThruExplorerClient` is exported too, if you want the raw explorer responses: `getAccount`, `getTransaction`, `getAbi`, `listAllTransactions` and `getTransactions`.

The decoder works on its own as well:

```ts
import { parseAbi, AbiDecoder, hexToBytes } from 'thru-ledger-export';

const abi = parseAbi(abiYamlText);
const event = new AbiDecoder(abi).decode(abi.eventsRoot!, hexToBytes(payloadHex));
```

## What this does not do

Being clear about the limits matters more than a longer feature list:

- **THRU moved by other programs isn't decoded.** Native THRU is read from EOA and faucet instructions only. If another program moves THRU for an account, `thruCheck` will flag it.
- **Multicall transactions aren't unpacked.** Calls bundled through the Multicall program show their events, but not their inner instructions.
- **Only programs with a published ABI are decoded.** Events from other programs are counted in `eventsCount` but not in `eventsDecoded`.
- **Timestamps come from the block**, which is when the network recorded the transaction.
- **Data comes from the public explorer** at `scan.thru.org`, for the network you choose. This is a read-only tool: it never asks for a key, a seed phrase or a signature.
- **No rate limits are published** for the explorer API. The default of 4 parallel requests is deliberately gentle; raise `--concurrency` at your own risk.

## Development

```bash
npm install
npm test          # vitest, runs against recorded API fixtures
npm run typecheck
npm run build
```

Tests use responses captured from `scan.thru.org` on 2026-09-20, 2026-09-23 and (after the reset, from Alphanet on the new addresses) 2026-09-28, so they run offline and don't depend on chain state. The Token Program ABI in `test/fixtures/` is the explorer's copy, byte for byte the same as the one in [Unto-Labs/thru](https://github.com/Unto-Labs/thru) (Apache-2.0). The two transfer events in the token tests are built by hand from that ABI, because none turned up in the history sampled; they are marked as such.

## License

MIT — see [LICENSE](LICENSE).

Not affiliated with Unto Labs. Thru and the Thru Explorer are their work; this is an independent tool built on their public API.
