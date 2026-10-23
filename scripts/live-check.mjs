#!/usr/bin/env node
/**
 * Live check against the real Thru network, run weekly by .github/workflows/live-check.yml.
 *
 * 1. If THRU_DEVELOPERS_API_KEY is set, ask the dev.thru.org faucet for a small
 *    amount of test THRUSD for the check's own token account, so there is a fresh
 *    transaction to find.
 * 2. Export the wallet with the built library (dist/) and check that:
 *    the new deposit is there as THRUSD in, THRUSD's details were read from the
 *    chain, and every token reconciles.
 *
 * Any failure exits non-zero, so GitHub emails the repository owner. That is
 * the point: when Thru changes something (as the September 2026 program-address
 * move did), this notices within a week instead of a user noticing first.
 *
 * Settings, all optional:
 *   THRU_DEVELOPERS_API_KEY  faucet key from dev.thru.org → Account (a repository secret)
 *   LIVE_CHECK_WALLET        wallet to export
 *   LIVE_CHECK_TOKEN_ACCOUNT its THRUSD token account, funded by the faucet
 *   LIVE_CHECK_NETWORK       alphanet (default) or betanet
 *   LIVE_CHECK_AMOUNT        THRUSD per run, default 1
 */
import { exportAccount } from '../dist/index.js';

const WALLET = process.env.LIVE_CHECK_WALLET || 'tawGA6fGKHhQxwr8GPgA_GM1rKNW4i9t3i8KANQsj5zpTn';
const TOKEN_ACCOUNT = process.env.LIVE_CHECK_TOKEN_ACCOUNT || 'taF1pr85gBJRrkKru7rB9wqZcET6iTaADV-EBYVbYFNwxU';
const NETWORK = process.env.LIVE_CHECK_NETWORK || 'alphanet';
const AMOUNT = process.env.LIVE_CHECK_AMOUNT || '1';
const KEY = process.env.THRU_DEVELOPERS_API_KEY || '';
const FAUCET = 'https://dev.thru.org/api/faucet/fund';

const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${message}`);
  if (!ok) failures.push(message);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Request THRUSD from the faucet. Returns { signature? } when funded, or undefined. */
async function fund() {
  if (!KEY) {
    console.log('skip  No THRU_DEVELOPERS_API_KEY secret, so no new deposit this run; checking the existing history only.');
    return undefined;
  }
  const response = await fetch(FAUCET, {
    method: 'POST',
    headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ network: NETWORK, tokenAddress: TOKEN_ACCOUNT, amount: AMOUNT }),
    redirect: 'manual',
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  if (response.status === 429) {
    console.log(`skip  Faucet rate limit reached (Retry-After: ${response.headers.get('retry-after') ?? '?'}); checking the existing history only.`);
    return undefined;
  }
  if (response.status === 401 || response.status === 403) {
    check(false, `Faucet refused the API key (HTTP ${response.status}). Create a new key on dev.thru.org → Account and update the repository secret.`);
    return undefined;
  }
  check(response.ok, `Faucet funded ${AMOUNT} THRUSD on ${NETWORK} (HTTP ${response.status})`);
  if (!response.ok) {
    // Thru's error codes are short and contain no secrets; the key is never echoed.
    console.log(`      ${text.slice(0, 300)}`);
    return undefined;
  }
  // The reply format isn't documented; use the signature if it carries one.
  return { signature: /ts[A-Za-z0-9_-]{88}/.exec(text)?.[0] };
}

const thrusdClosingRaw = (exported) =>
  BigInt(exported.tokenTotals.find((total) => total.tokenSymbol === 'THRUSD')?.closingBalanceRaw || '0');

const before = await exportAccount(WALLET, { network: NETWORK });
const funded = await fund();
const signature = funded?.signature;
const expectedRaw = thrusdClosingRaw(before) + BigInt(Math.round(Number(AMOUNT) * 1e6));

// The explorer indexes new transactions within seconds; give it up to two minutes.
let result = before;
if (funded) {
  for (let attempt = 1; attempt <= 8; attempt++) {
    await sleep(15_000);
    result = await exportAccount(WALLET, { network: NETWORK });
    if (thrusdClosingRaw(result) >= expectedRaw) break;
  }
  check(thrusdClosingRaw(result) === expectedRaw,
    `THRUSD balance went up by ${AMOUNT} (${thrusdClosingRaw(before)} → ${thrusdClosingRaw(result)} raw)`);
}

console.log(`      ${result.rows.length} transactions, ${result.tokenAccountsFollowed.length} token account(s) followed`);
check(result.rows.length > 0, 'Export returned transactions');
check(result.tokenAccountsFollowed.includes(TOKEN_ACCOUNT), 'The wallet’s THRUSD token account was followed');

if (signature) {
  const row = result.rows.find((r) => r.signature === signature);
  check(Boolean(row), 'The new faucet deposit appears in the wallet export');
  if (row) {
    check(row.direction === 'in' && row.tokenSymbol === 'THRUSD', `Deposit reads as THRUSD in (${row.action}, ${row.direction}, ${row.tokenSymbol || 'no symbol'})`);
    const expected = Number(AMOUNT).toFixed(6);
    check(row.amount === expected, `Deposit amount is ${expected} (got ${row.amount || row.amountRaw + ' raw'})`);
  }
}

const thrusd = result.mintDetails.find((mint) => mint.tokenSymbol === 'THRUSD');
check(thrusd?.decimals === 6, 'THRUSD has 6 decimals');
check(thrusd?.source === 'chain', `THRUSD details were read from the chain (source: ${thrusd?.source ?? 'missing'})`);

for (const total of result.tokenTotals) {
  check(total.reconciles === true,
    `${total.tokenSymbol || total.tokenMint} reconciles: ${total.openingBalance} + ${total.in} - ${total.out}` +
    `${total.fees !== undefined ? ` - ${total.fees}` : ''} = ${total.closingBalance}`);
}
if (result.thruCheck) check(result.thruCheck.ok !== false, 'THRU balance works back to zero');

if (failures.length > 0) {
  console.log(`\n${failures.length} check(s) failed. Thru may have changed something the tool depends on.`);
  process.exit(1);
}
console.log('\nAll live checks passed.');
