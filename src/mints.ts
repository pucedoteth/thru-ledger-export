/**
 * Tickers and decimals for well-known mints: the offline fallback.
 *
 * Since v0.7.0 a mint's ticker and decimals are read from its mint account
 * on chain (see rpc.ts) when its initialize_mint event isn't in the history.
 * This table is only used when the RPC node can't be reached or lookups are
 * turned off (--no-mint-lookup), so common tokens still read correctly.
 */
import type { MintInfo, TokenContext } from './events.js';

export const KNOWN_MINTS: Record<string, Record<string, Required<MintInfo>>> = {
  alphanet: {
    // Test THRUSD, Thru's test dollar, as handed out by https://dev.thru.org/faucet.
    // Ticker and decimals as shown by Thru Wallet (wallet.tid.sh), checked 2026-10-23.
    taRfWjryqWSRRp6ZU_ahCHXKhEA0oRVKWZlE4Us86vnOOt: { ticker: 'THRUSD', decimals: 6 },
  },
  betanet: {
    // Test SOL, the collateral token of Betanet's Perp exchange. Read from its mint account, 2026-10-23.
    taRJgwVQFuIARwRgJksZ45bmHRN_XXlqWtCZwlG8bmicYD: { ticker: 'tSOL', decimals: 9 },
  },
};

/** Fill in ticker and decimals for known mints the history didn't describe (all of them, or just `only`). */
export function applyKnownMints(context: TokenContext, network: string, only?: string[]): TokenContext {
  for (const [mint, info] of Object.entries(KNOWN_MINTS[network] ?? {})) {
    if (only && !only.includes(mint)) continue;
    const learned = context.mints.get(mint);
    context.mints.set(mint, {
      decimals: learned?.decimals ?? info.decimals,
      ticker: learned?.ticker ?? info.ticker,
    });
  }
  return context;
}
