/**
 * Tickers and decimals for well-known mints.
 *
 * The export learns a mint's ticker and decimals from its initialize_mint
 * event, but that event is only in the history of whoever created the mint.
 * A user who received THRUSD never sees it, and the explorer's account
 * endpoint doesn't decode mint data, so amounts stayed raw (100000000 instead
 * of 100.000000). This table fills the gap for mints people commonly hold.
 * Anything learned from the history itself still takes priority.
 */
import type { MintInfo, TokenContext } from './events.js';

export const KNOWN_MINTS: Record<string, Record<string, Required<MintInfo>>> = {
  alphanet: {
    // Test THRUSD, Thru's test dollar, as handed out by https://dev.thru.org/faucet.
    // Ticker and decimals as shown by Thru Wallet (wallet.tid.sh), checked 2026-10-23.
    taRfWjryqWSRRp6ZU_ahCHXKhEA0oRVKWZlE4Us86vnOOt: { ticker: 'THRUSD', decimals: 6 },
  },
  // betanet: add THRUSD here once its mint address is confirmed.
};

/** Fill in ticker and decimals for known mints the history didn't describe. */
export function applyKnownMints(context: TokenContext, network: string): TokenContext {
  for (const [mint, info] of Object.entries(KNOWN_MINTS[network] ?? {})) {
    const learned = context.mints.get(mint);
    context.mints.set(mint, {
      decimals: learned?.decimals ?? info.decimals,
      ticker: learned?.ticker ?? info.ticker,
    });
  }
  return context;
}
