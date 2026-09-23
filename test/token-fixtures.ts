import { readFileSync } from 'node:fs';
import { decodeAddress, bytesToHex } from '../src/address.js';
import type { TransactionDetail } from '../src/types.js';

/**
 * The Token Program's ABI exactly as served by
 * https://scan.thru.org/api/abi/taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKqq on 2026-09-23.
 * It is byte-for-byte the same as rpc/abi/type-library/tn_token_program.abi.yaml
 * in github.com/Unto-Labs/thru (Apache-2.0).
 */
export const TOKEN_ABI_YAML = readFileSync(new URL('./fixtures/token-program.abi.yaml', import.meta.url), 'utf8');

export const TOKEN_PROGRAM = 'taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKqq';
/** The wallet whose history these transactions come from. */
export const WALLET = 'taNXLcTwQfg0fR-ZDKOeJLFnBIoWlLdM8ZvB6e58dn9rcC';
/** A mint the wallet created: ticker MFT, 6 decimals. */
export const MINT = 'taTPC-jUSGS2oCxhB23YWqzP8mEr-J2Hy5DuORftiL5aam';
/** The wallet's token account for MINT. */
export const TOKEN_ACCOUNT = 'ta65HhDjlQbCqtHqxF613QF4u7vpTM8IUwIW9piuq4CR_L';

const WALLET_HEX = '3572dc4f041f8347d1f990ca39e24b167048a1694b74cf19bc1e9ee7c767f6b7';
const MINT_HEX = '4cf0be8d44864b6a02c61076dd85aaccff2612bf89d87cb90ee3917ed88be5a6';
const ACCOUNT_HEX = 'eb91e10e39506c2aad1eac45eb5dd0178bbbbe94ccf08530216f698aeab8091f';

function tokenTx(
  slot: number, signature: string, blockTimestampNs: string, payloadHex: string,
  readWriteAccounts: string[], readOnlyAccounts: string[] = [],
): TransactionDetail {
  return {
    slot,
    signature,
    consensusStatus: { label: 'Included', kind: 'success' },
    executionError: { vmErrorStatus: { label: 'Success', kind: 'success' }, vmError: 0, userErrorCode: '0' },
    fee: '0',
    blockTimestampNs,
    feePayer: WALLET,
    program: TOKEN_PROGRAM,
    accounts: { readWriteAccounts, readOnlyAccounts, feePayer: WALLET, program: TOKEN_PROGRAM },
    events: { events: [{ programAddress: TOKEN_PROGRAM, payloadHex }], eventsCount: 1, eventsSize: payloadHex.length / 2 },
  };
}

/** Real transactions of WALLET, captured from scan.thru.org (alphanet) on 2026-09-23, oldest first. */
export const INIT_MINT_TX = tokenTx(
  13131600,
  'tsXLB9z-WO-DjIyzK07syYmfTwrNpfCdtCq4TTmHDesD7HpnotNqUvPOPNgGmzg_UTDgUAxrLc2j4O7ggzO_czDiJ-',
  '1789921566096469703',
  '00' + MINT_HEX + WALLET_HEX + '0'.repeat(64) + '0000000000000000' + '06' + '00' + '03' + '4d46540000000000',
  [MINT],
);

export const INIT_ACCOUNT_TX = tokenTx(
  13131613,
  'tsLZQ7JCiq05i5nV_QU5N1IP9p2GjV87Izyk3NxXBs4u1oWcW9AMvreQMFi5mSnaP1FAwzj6JHaXE-oP7PjgHtASE4',
  '1789921568367326535',
  '01' + ACCOUNT_HEX + WALLET_HEX + MINT_HEX,
  [TOKEN_ACCOUNT],
  [MINT],
);

export const MINT_BIG_TX = tokenTx(
  13131626,
  'tsPrgDIgVAd9JAQmpttAvaf5XbZfQIVBo8WlBOgzD_raXt4vcm7VfXhH2aalEGZHZR2vMsHwMHWgyByIVfDQPjBxvO',
  '1789921570442658276',
  '03' + MINT_HEX + ACCOUNT_HEX + WALLET_HEX + '0010a5d4e8000000' + '0010a5d4e8000000' + '0010a5d4e8000000',
  [MINT, TOKEN_ACCOUNT],
);

export const MINT_SMALL_TX = tokenTx(
  13131640,
  'tsktkws_-FZp0vJhzzGvsADNQkxIp3tNlrVzz_V6Vba4igFbcFCUAvq5PPHkNyD3DkONsUhLUWkhE7HsKajK2BAhyh',
  '1789921574722516649',
  '03' + MINT_HEX + ACCOUNT_HEX + WALLET_HEX + 'bd19000000000000' + 'bd29a5d4e8000000' + 'bd29a5d4e8000000',
  [MINT, TOKEN_ACCOUNT],
);

export const BURN_TX = tokenTx(
  13131652,
  'tsgk-HjHKCX323e23ym9sLBwZfpSLbpsGWGBYzfI-mVXT2Yj1U30yH79y5x743Ir7ANVgTimrBErBB6jG4Sj_wBB7P',
  '1789921577481228675',
  '04' + MINT_HEX + ACCOUNT_HEX + WALLET_HEX + '1600000000000000' + 'a729a5d4e8000000' + 'a729a5d4e8000000',
  [MINT, TOKEN_ACCOUNT],
);

/** The exact event payload of BURN_TX as the explorer returned it. */
export const BURN_PAYLOAD_LIVE =
  '044cf0be8d44864b6a02c61076dd85aaccff2612bf89d87cb90ee3917ed88be5a6eb91e10e39506c2aad1eac45eb5dd0178bbbbe94ccf08530216f698aeab8091f3572dc4f041f8347d1f990ca39e24b167048a1694b74cf19bc1e9ee7c767f6b71600000000000000a729a5d4e8000000a729a5d4e8000000';

const u64le = (value: bigint) => {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return bytesToHex(bytes);
};

/**
 * CONSTRUCTED, not captured: no transfer event turned up in the recent
 * alphanet history we sampled, so this one is built by hand from the ABI's
 * TransferEventData layout (tag 2, source, dest, amount, both post balances).
 */
export function transferPayload(source: string, dest: string, amount: bigint, sourcePost: bigint, destPost: bigint): string {
  return '02' + bytesToHex(decodeAddress(source)) + bytesToHex(decodeAddress(dest)) + u64le(amount) + u64le(sourcePost) + u64le(destPost);
}

/** Another real alphanet account, used as the counterparty of the constructed transfers. */
export const OTHER_ACCOUNT = 'ta7nShvt3yYCDIOWg8cbEqH_zbm80GzcB0fngKMHyfhTJo';

/** Constructed: the wallet sends 2.5 MFT (2,500,000 raw) to OTHER_ACCOUNT after the burn. */
export const TRANSFER_OUT_TX = tokenTx(
  13131700,
  'tsConstructedTransferOutExampleOnlyNotOnChain0000000000000000000000000000000000000000000',
  '1789921600000000000',
  transferPayload(TOKEN_ACCOUNT, OTHER_ACCOUNT, 2_500_000n, 1_000_000_006_567n - 2_500_000n, 2_500_000n),
  [TOKEN_ACCOUNT, OTHER_ACCOUNT],
);

/** Constructed: OTHER_ACCOUNT sends 1 MFT back. */
export const TRANSFER_IN_TX = tokenTx(
  13131710,
  'tsConstructedTransferInExampleOnlyNotOnChain00000000000000000000000000000000000000000000',
  '1789921605000000000',
  transferPayload(OTHER_ACCOUNT, TOKEN_ACCOUNT, 1_000_000n, 1_500_000n, 1_000_000_006_567n - 1_500_000n),
  [OTHER_ACCOUNT, TOKEN_ACCOUNT],
);

export const TOKEN_HISTORY = [INIT_MINT_TX, INIT_ACCOUNT_TX, MINT_BIG_TX, MINT_SMALL_TX, BURN_TX, TRANSFER_OUT_TX, TRANSFER_IN_TX];
