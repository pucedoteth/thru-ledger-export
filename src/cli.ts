#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { toCsv } from './csv.js';
import { exportAccount } from './export.js';
import { parseArgs, type ParsedArgs } from './args.js';

const USAGE = `thru-ledger-export — export a Thru account's transaction history

Usage:
  thru-ledger-export <address> [options]

Options:
  -o, --out <file>       Write to a file (default: stdout)
  -f, --format <fmt>     csv | json            (default: csv)
      --from <date>      Only on/after this UTC date (YYYY-MM-DD)
      --to <date>        Only on/before this UTC date (YYYY-MM-DD)
      --limit <n>        Stop after n transactions (newest first)
      --success-only     Skip failed transactions
      --base-url <url>   Explorer base URL (default: https://scan.thru.org)
      --concurrency <n>  Parallel detail requests (default: 4)
  -q, --quiet            No progress output
  -h, --help             Show this help

Examples:
  thru-ledger-export taNXLcTw...dn9rcC -o ledger.csv
  thru-ledger-export taNXLcTw...dn9rcC --from 2026-01-01 --to 2026-03-31 -o q1.csv
  thru-ledger-export taNXLcTw...dn9rcC -f json | jq '.rows[0]'
`;

async function main(): Promise<void> {
  let args: ParsedArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n\n${USAGE}`);
    process.exit(2);
  }

  if (args.help || !args.address) {
    process.stdout.write(USAGE);
    process.exit(args.help ? 0 : 2);
  }

  const log = (message: string) => { if (!args.quiet) process.stderr.write(message + '\n'); };

  const result = await exportAccount(args.address, {
    limit: args.limit,
    from: args.from,
    to: args.to,
    successOnly: args.successOnly,
    baseUrl: args.baseUrl,
    concurrency: args.concurrency,
    onProgress: ({ fetched, total, phase }) => {
      if (args.quiet) return;
      const suffix = total ? `/${total}` : '';
      process.stderr.write(`\r${phase === 'list' ? 'listing' : 'fetching details'} ${fetched}${suffix}   `);
    },
  });
  if (!args.quiet) process.stderr.write('\r');

  const output = args.format === 'json'
    ? JSON.stringify(result, null, 2) + '\n'
    : toCsv(result.rows);

  if (args.out) {
    await writeFile(args.out, output, 'utf8');
    log(`Wrote ${result.rows.length} transactions to ${args.out}`);
    log(`Fees paid by this account: ${result.totalFeesThru} THRU`);
  } else {
    process.stdout.write(output);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
