import { describe, expect, it } from 'vitest';
import { exportAccount, filterByDate } from '../src/export.js';
import { toLedgerRow } from '../src/normalize.js';
import { ACCOUNT, ORACLE_TX, SYSTEM_TX, LIST_PAGE } from './fixtures.js';

/** A fetch stand-in that serves the captured fixtures and paginates once. */
function fakeFetch(options: { pages?: number; failures?: number } = {}) {
  const pages = options.pages ?? 1;
  let failuresLeft = options.failures ?? 0;
  const calls: string[] = [];

  const impl = async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    calls.push(url);
    if (failuresLeft > 0) {
      failuresLeft--;
      return new Response('busy', { status: 503 });
    }
    const json = (body: unknown) => new Response(JSON.stringify(body), {
      status: 200, headers: { 'content-type': 'application/json' },
    });

    if (url.includes('/api/tx/')) {
      const signature = decodeURIComponent(url.split('/api/tx/')[1]!);
      const detail = signature === ORACLE_TX.signature ? ORACLE_TX : SYSTEM_TX;
      return json({ data: detail });
    }
    if (url.includes('/transactions')) {
      const isLastPage = pages === 1 || url.includes('pageToken');
      return json({
        data: {
          ...LIST_PAGE.data,
          pagination: isLastPage ? { pageSize: 100 } : LIST_PAGE.data.pagination,
        },
      });
    }
    return json({ data: { address: ACCOUNT, balance: '0.00001 THRU', balanceRaw: '10000' } });
  };

  return { impl: impl as unknown as typeof fetch, calls };
}

describe('exportAccount', () => {
  it('returns rows sorted oldest first, with the account balance', async () => {
    const { impl } = fakeFetch();
    const result = await exportAccount(ACCOUNT, { fetchImpl: impl });

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]!.slot).toBe(13131568);
    expect(result.rows[1]!.slot).toBe(13132384);
    expect(result.balance).toBe('0.00001 THRU');
    expect(result.totalFeesThru).toBe('0.000000000');
  });

  it('follows pagination until the last page', async () => {
    const { impl, calls } = fakeFetch({ pages: 2 });
    const result = await exportAccount(ACCOUNT, { fetchImpl: impl });

    expect(calls.filter((url) => url.includes('/transactions'))).toHaveLength(2);
    expect(calls.some((url) => url.includes('pageToken=12150508%3A168'))).toBe(true);
    expect(result.rows).toHaveLength(4);
  });

  it('honours --limit without fetching extra details', async () => {
    const { impl, calls } = fakeFetch();
    const result = await exportAccount(ACCOUNT, { fetchImpl: impl, limit: 1 });

    expect(result.rows).toHaveLength(1);
    expect(calls.filter((url) => url.includes('/api/tx/'))).toHaveLength(1);
  });

  it('retries a 503 instead of failing the export', async () => {
    const { impl } = fakeFetch({ failures: 1 });
    const result = await exportAccount(ACCOUNT, { fetchImpl: impl, retries: 3 });
    expect(result.rows).toHaveLength(2);
  });

  it('surfaces a 404 for an unknown account', async () => {
    const notFound = (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch;
    await expect(exportAccount('taBogus', { fetchImpl: notFound })).rejects.toThrow(/404/);
  });
});

describe('filterByDate', () => {
  const rows = [toLedgerRow(SYSTEM_TX, ACCOUNT), toLedgerRow(ORACLE_TX, ACCOUNT)];

  it('keeps rows inside an inclusive range', () => {
    expect(filterByDate(rows, '2026-09-20', '2026-09-20')).toHaveLength(2);
    expect(filterByDate(rows, '2026-09-21')).toHaveLength(0);
    expect(filterByDate(rows, undefined, '2026-09-19')).toHaveLength(0);
  });

  it('is a no-op when no range is given', () => {
    expect(filterByDate(rows)).toBe(rows);
  });
});

describe('ThruExplorerClient default fetch', () => {
  it('calls the global fetch with globalThis as its receiver, as browsers require', async () => {
    const original = globalThis.fetch;
    let receiver: unknown;
    globalThis.fetch = function (this: unknown) {
      receiver = this;
      return Promise.resolve(new Response(JSON.stringify({ data: { address: ACCOUNT } }), { status: 200 }));
    } as typeof fetch;
    try {
      const { ThruExplorerClient } = await import('../src/client.js');
      await new ThruExplorerClient().getAccount(ACCOUNT);
      expect(receiver).toBe(globalThis);
    } finally {
      globalThis.fetch = original;
    }
  });
});
