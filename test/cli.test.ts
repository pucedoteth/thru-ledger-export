import { describe, expect, it } from 'vitest';
import { parseArgs } from '../src/args.js';

describe('parseArgs', () => {
  it('reads the address and common options', () => {
    const args = parseArgs(['taABC', '-o', 'out.csv', '--from', '2026-01-01', '--success-only']);
    expect(args.address).toBe('taABC');
    expect(args.out).toBe('out.csv');
    expect(args.from).toBe('2026-01-01');
    expect(args.successOnly).toBe(true);
    expect(args.format).toBe('csv');
  });

  it('rejects bad input clearly', () => {
    expect(() => parseArgs(['taABC', '--from', '20260101'])).toThrow(/YYYY-MM-DD/);
    expect(() => parseArgs(['taABC', '--limit', '0'])).toThrow(/positive whole number/);
    expect(() => parseArgs(['taABC', '-f', 'pdf'])).toThrow(/Unknown format/);
    expect(() => parseArgs(['taABC', '--nope'])).toThrow(/Unknown option/);
    expect(() => parseArgs(['taABC', '-o'])).toThrow(/Missing value/);
  });
});

describe('decoding options', () => {
  it('decodes by default and accepts --no-decode', () => {
    expect(parseArgs(['taNXLcTwQfg0fR-ZDKOeJLFnBIoWlLdM8ZvB6e58dn9rcC']).decode).toBe(true);
    expect(parseArgs(['taNXLcTwQfg0fR-ZDKOeJLFnBIoWlLdM8ZvB6e58dn9rcC', '--no-decode']).decode).toBe(false);
  });

  it('collects repeated --token-account values and rejects non-addresses', () => {
    const a = 'ta65HhDjlQbCqtHqxF613QF4u7vpTM8IUwIW9piuq4CR_L';
    const b = 'taTPC-jUSGS2oCxhB23YWqzP8mEr-J2Hy5DuORftiL5aam';
    expect(parseArgs(['x', '--token-account', a, '--token-account', b]).tokenAccounts).toEqual([a, b]);
    expect(() => parseArgs(['x', '--token-account', 'nope'])).toThrow(/Thru address/);
  });
});
