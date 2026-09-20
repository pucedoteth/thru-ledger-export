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
