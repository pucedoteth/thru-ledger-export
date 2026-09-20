import { describe, expect, it } from 'vitest';
import { toCsv, escapeCsvField, CSV_COLUMNS } from '../src/csv.js';
import { toLedgerRow } from '../src/normalize.js';
import { ACCOUNT, ORACLE_TX } from './fixtures.js';

describe('escapeCsvField', () => {
  it('quotes commas, quotes and newlines', () => {
    expect(escapeCsvField('a,b')).toBe('"a,b"');
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"');
  });

  it('neutralises spreadsheet formula injection', () => {
    expect(escapeCsvField('=1+1')).toBe("'=1+1");
    expect(escapeCsvField('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  it('renders empty values as empty fields', () => {
    expect(escapeCsvField(undefined)).toBe('');
    expect(escapeCsvField(null)).toBe('');
  });
});

describe('toCsv', () => {
  const csv = toCsv([toLedgerRow(ORACLE_TX, ACCOUNT)]);

  it('starts with a UTF-8 BOM so Excel reads it correctly', () => {
    expect(csv.startsWith('﻿')).toBe(true);
    expect(toCsv([], { bom: false }).startsWith('﻿')).toBe(false);
  });

  it('writes one header row plus one row per transaction', () => {
    const lines = csv.replace(/^﻿/, '').trimEnd().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(CSV_COLUMNS.join(','));
    expect(lines[1]!.split(',')[1]).toBe('2026-09-20');
  });
});
