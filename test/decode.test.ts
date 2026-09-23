import { describe, expect, it } from 'vitest';
import { parseYaml } from '../src/yaml.js';
import { decodeAddress, encodeAddress, hexToBytes } from '../src/address.js';
import { AbiDecoder, AbiDecodeError, parseAbi } from '../src/abi.js';
import { BURN_PAYLOAD_LIVE, MINT, TOKEN_ABI_YAML, TOKEN_ACCOUNT, WALLET } from './token-fixtures.js';

describe('parseYaml', () => {
  it('reads mappings, sequences at the key indent, and "- key:" items', () => {
    expect(parseYaml('a: 1\nlist:\n- name: x\n  n: 2\n- plain\n')).toEqual({ a: 1, list: [{ name: 'x', n: 2 }, 'plain'] });
  });

  it('reads quoted strings, flow sequences, comments and folded plain scalars', () => {
    const doc = parseYaml('# c\nname: "Token # 1"\npath: ["a", b]\ndesc: first\n  second # trailing\n');
    expect(doc).toEqual({ name: 'Token # 1', path: ['a', 'b'], desc: 'first second' });
  });

  it('reads folded and literal block scalars', () => {
    expect(parseYaml('a: >-\n  one\n  two\nb: |\n  x\n  y\n')).toEqual({ a: 'one two', b: 'x\ny\n' });
  });

  it('rejects syntax it does not support instead of misreading it', () => {
    expect(() => parseYaml('a: &anchor 1')).toThrow();
    expect(() => parseYaml('a: {b: 1}')).toThrow();
  });
});

describe('Thru addresses', () => {
  it('round-trips real addresses through their 32-byte keys', () => {
    for (const address of [WALLET, MINT, TOKEN_ACCOUNT, 'taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA']) {
      expect(encodeAddress(decodeAddress(address))).toBe(address);
    }
  });

  it('matches the explorer for a known key', () => {
    const key = hexToBytes('3572dc4f041f8347d1f990ca39e24b167048a1694b74cf19bc1e9ee7c767f6b7');
    expect(encodeAddress(key)).toBe(WALLET);
  });

  it('rejects a bad checksum', () => {
    const tampered = WALLET.slice(0, -1) + (WALLET.endsWith('C') ? 'D' : 'C');
    expect(() => decodeAddress(tampered)).toThrow(/checksum|Not a Thru/);
  });
});

describe('AbiDecoder with the live Token Program ABI', () => {
  const abi = parseAbi(TOKEN_ABI_YAML);

  it('finds the events root type', () => {
    expect(abi.programName).toBe('Token Program');
    expect(abi.eventsRoot).toBe('TokenEvent');
  });

  it('decodes a real burn event exactly as it appeared on chain', () => {
    const value = new AbiDecoder(abi).decode('TokenEvent', hexToBytes(BURN_PAYLOAD_LIVE));
    expect(JSON.parse(JSON.stringify(value))).toEqual({
      event_type: 4,
      payload: {
        variant: 'burn',
        value: {
          mint: MINT,
          account: TOKEN_ACCOUNT,
          authority: WALLET,
          amount: '22',
          account_post_balance: '1000000006567',
          mint_supply: '1000000006567',
        },
      },
    });
  });

  it('reads length-prefixed text (the mint ticker)', () => {
    const hex = '00' + '4cf0be8d44864b6a02c61076dd85aaccff2612bf89d87cb90ee3917ed88be5a6'
      + '3572dc4f041f8347d1f990ca39e24b167048a1694b74cf19bc1e9ee7c767f6b7' + '0'.repeat(64)
      + '0000000000000000' + '06' + '00' + '03' + '4d46540000000000';
    const value = JSON.parse(JSON.stringify(new AbiDecoder(abi).decode('TokenEvent', hexToBytes(hex))));
    expect(value.payload.value).toMatchObject({ decimals: 6, ticker: 'MFT', supply: '0' });
  });

  it('refuses short, overlong or unknown payloads rather than guessing', () => {
    const decoder = new AbiDecoder(abi);
    expect(() => decoder.decode('TokenEvent', hexToBytes(BURN_PAYLOAD_LIVE.slice(0, -2)))).toThrow(AbiDecodeError);
    expect(() => decoder.decode('TokenEvent', hexToBytes(BURN_PAYLOAD_LIVE + '00'))).toThrow(AbiDecodeError);
    expect(() => decoder.decode('TokenEvent', hexToBytes('09'))).toThrow(/No enum variant/);
  });

  it('keeps u64 values exact above 2^53', () => {
    const doc = 'abi:\n  package: t\ntypes:\n- name: V\n  kind:\n    struct:\n      packed: true\n      fields:\n      - name: v\n        field-type:\n          primitive: u64\n';
    const value = new AbiDecoder(parseAbi(doc)).decode('V', hexToBytes('ffffffffffffffff'));
    expect(value).toEqual({ v: '18446744073709551615' });
  });

  it('evaluates computed array lengths', () => {
    const doc = [
      'abi:', '  package: t', 'types:', '- name: V', '  kind:', '    struct:', '      packed: true', '      fields:',
      '      - name: n', '        field-type:', '          primitive: u8',
      '      - name: items', '        field-type:', '          array:', '            size:', '              mul:',
      '                left:', '                  field-ref:', '                    path: [n]',
      '                right:', '                  literal:', '                    u64: 2',
      '            element-type:', '              primitive: u16',
    ].join('\n');
    const value = new AbiDecoder(parseAbi(doc)).decode('V', hexToBytes('02' + '0100' + '0200' + '0300' + '0400'));
    expect(value).toEqual({ n: 2, items: [1, 2, 3, 4] });
  });
});
