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

// ── Added after adversarial review of PR #457 ────────────────────────────────
// The original suite asserted page *counts* but never row *identity*, so a
// helper that fetched the same range twice would have passed. These check the
// assembled set, the options contract, concurrency bounding, and the
// short-page guard.

describe('fetchAllPages — assembled set is exactly the source rows', () => {
  // A fake table of `total` rows; .range() serves the real slice, so any
  // duplicated or skipped range shows up as a wrong id sequence.
  function fakeTable(total) {
    const all = Array.from({ length: total }, (_, i) => ({ id: i }));
    const seen = [];
    const buildQuery = (opts) => ({
      range: async (from, to) => {
        seen.push({ from, to, opts });
        return {
          data: all.slice(from, to + 1),
          error: null,
          count: opts && opts.count === 'exact' ? total : undefined,
        };
      },
    });
    return { buildQuery, seen };
  }

  it.each([0, 1, 999, 1000, 1001, 2000, 2001, 2798, 5000])(
    'returns every row exactly once for total=%i',
    async (total) => {
      const { buildQuery } = fakeTable(total);
      const rows = await fetchAllPages(buildQuery);
      expect(rows.map((r) => r.id)).toEqual(
        Array.from({ length: total }, (_, i) => i)
      );
    }
  );

  it('asks for the count once and never again', async () => {
    const { buildQuery, seen } = fakeTable(4200);
    await fetchAllPages(buildQuery);
    const counted = seen.filter((c) => c.opts && c.opts.count === 'exact');
    expect(counted).toHaveLength(1);
    expect(seen[0].from).toBe(0); // and it's the first request
  });

  it('never has more than 5 requests in flight at once', async () => {
    const total = 12000; // 12 pages
    const all = Array.from({ length: total }, (_, i) => ({ id: i }));
    let inFlight = 0;
    let peak = 0;
    const buildQuery = (opts) => ({
      range: async (from, to) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight -= 1;
        return {
          data: all.slice(from, to + 1),
          error: null,
          count: opts && opts.count === 'exact' ? total : undefined,
        };
      },
    });
    const rows = await fetchAllPages(buildQuery);
    expect(rows).toHaveLength(total);
    expect(peak).toBeLessThanOrEqual(5);
    expect(peak).toBeGreaterThan(1); // still parallel, not sequential
  });

  it('throws rather than silently truncating when a middle page is short', async () => {
    // Simulates db-max-rows lowered below PAGE_SIZE: every page returns 500.
    // Offsets then misalign and rows are skipped — the exact silent failure
    // this helper exists to prevent.
    const buildQuery = (opts) => ({
      range: async (from, to) => ({
        data: Array.from({ length: Math.min(500, to - from + 1) }, (_, i) => ({ id: from + i })),
        error: null,
        count: opts && opts.count === 'exact' ? 3000 : undefined,
      }),
    });
    await expect(fetchAllPages(buildQuery)).rejects.toThrow(/capping pages below PAGE_SIZE/);
  });

  it('tolerates a short FINAL page (a row deleted mid-read is benign)', async () => {
    const total = 2500;
    const buildQuery = (opts) => ({
      range: async (from, to) => {
        const size = to - from + 1;
        // final page returns one fewer than asked, as a concurrent delete would
        const n = from >= 2000 ? size - 1 : size;
        return {
          data: Array.from({ length: n }, (_, i) => ({ id: from + i })),
          error: null,
          count: opts && opts.count === 'exact' ? total : undefined,
        };
      },
    });
    const rows = await fetchAllPages(buildQuery);
    expect(rows).toHaveLength(total - 1); // no throw
  });

  it('surfaces an error from a parallel page instead of returning partial data', async () => {
    const buildQuery = (opts) => ({
      range: async (from, to) => {
        if (from === 2000) return { data: null, error: { message: 'boom' } };
        return {
          data: Array.from({ length: to - from + 1 }, (_, i) => ({ id: from + i })),
          error: null,
          count: opts && opts.count === 'exact' ? 4000 : undefined,
        };
      },
    });
    await expect(fetchAllPages(buildQuery)).rejects.toMatchObject({ message: 'boom' });
  });

  it('returns [] when count is present but data is null', async () => {
    const buildQuery = (opts) => ({
      range: async () => ({
        data: null,
        error: null,
        count: opts && opts.count === 'exact' ? 0 : undefined,
      }),
    });
    await expect(fetchAllPages(buildQuery)).resolves.toEqual([]);
  });
});
