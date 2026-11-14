import { describe, it, expect } from 'vitest';
import { fetchAllPages } from './api';

// Regression coverage for the silent PostgREST 1000-row truncation bug: any read
// that can exceed 1000 rows must page via .range(), or PostgREST returns a
// truncated result with no error. The boundary that matters is exactly 1000 rows
// (must trigger a second fetch) vs. anything short of it (must stop immediately).

function makeRows(n, startId = 0) {
  return Array.from({ length: n }, (_, i) => ({ id: startId + i }));
}

describe('fetchAllPages — sequential fallback (no count requested)', () => {
  it('stops after a short first page without a second request', async () => {
    const calls = [];
    const buildQuery = () => ({
      range: async (from, to) => {
        calls.push([from, to]);
        return { data: makeRows(37), error: null }; // short of 1000
      },
    });
    const rows = await fetchAllPages(buildQuery);
    expect(rows).toHaveLength(37);
    expect(calls).toHaveLength(1);
  });

  it('a page of exactly 1000 rows triggers a second fetch', async () => {
    const calls = [];
    const buildQuery = () => ({
      range: async (from, to) => {
        calls.push([from, to]);
        if (calls.length === 1) return { data: makeRows(1000, 0), error: null };
        return { data: makeRows(243, 1000), error: null }; // second, short page stops the loop
      },
    });
    const rows = await fetchAllPages(buildQuery);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual([0, 999]);
    expect(calls[1]).toEqual([1000, 1999]);
    expect(rows).toHaveLength(1243);
  });

  it('two full 1000-row pages followed by a short page makes three requests', async () => {
    const calls = [];
    const buildQuery = () => ({
      range: async (from, to) => {
        calls.push([from, to]);
        if (calls.length <= 2) return { data: makeRows(1000, (calls.length - 1) * 1000), error: null };
        return { data: makeRows(5, 2000), error: null };
      },
    });
    const rows = await fetchAllPages(buildQuery);
    expect(calls).toHaveLength(3);
    expect(rows).toHaveLength(2005);
  });

  it('propagates an error from any page instead of swallowing it', async () => {
    const buildQuery = () => ({
      range: async () => ({ data: null, error: { message: 'boom' } }),
    });
    await expect(fetchAllPages(buildQuery)).rejects.toMatchObject({ message: 'boom' });
  });
});

describe('fetchAllPages — concurrent path (count: "exact" available)', () => {
  it('fetches the remaining pages in parallel using the known total', async () => {
    const calls = [];
    const buildQuery = () => ({
      range: async (from, to) => {
        calls.push([from, to]);
        const size = to - from + 1;
        return { data: makeRows(Math.min(size, 2798 - from)), error: null, count: 2798 };
      },
    });
    const rows = await fetchAllPages(buildQuery);
    // 2798 rows over PAGE_SIZE 1000 = pages [0,999] [1000,1999] [2000,2797] = 3 requests total,
    // issued as 1 (to learn the count) + 2 in parallel — never one-at-a-time for N pages.
    expect(calls).toHaveLength(3);
    expect(rows).toHaveLength(2798);
  });

  it('does not over-fetch when the count exactly matches the first page', async () => {
    const calls = [];
    const buildQuery = () => ({
      range: async (from, to) => {
        calls.push([from, to]);
        return { data: makeRows(1000), error: null, count: 1000 };
      },
    });
    const rows = await fetchAllPages(buildQuery);
    expect(calls).toHaveLength(1);
    expect(rows).toHaveLength(1000);
  });

  it('short first page with a count still stops at one request', async () => {
    const calls = [];
    const buildQuery = () => ({
      range: async (from, to) => {
        calls.push([from, to]);
        return { data: makeRows(37), error: null, count: 37 };
      },
    });
    const rows = await fetchAllPages(buildQuery);
    expect(calls).toHaveLength(1);
    expect(rows).toHaveLength(37);
  });

  it('propagates an error from a parallel page', async () => {
    const buildQuery = () => ({
      range: async (from) => {
        if (from === 0) return { data: makeRows(1000), error: null, count: 2500 };
        return { data: null, error: { message: 'parallel page failed' } };
      },
    });
    await expect(fetchAllPages(buildQuery)).rejects.toMatchObject({ message: 'parallel page failed' });
  });
});
