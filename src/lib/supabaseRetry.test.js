import { describe, it, expect, vi } from 'vitest';
import {
  RETRYABLE_PG_CODES,
  isReplayableBody,
  extractTable,
  readPgCode,
  createRetryingFetch,
} from './supabaseRetry';

const jsonResponse = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const noSleep = () => Promise.resolve();

describe('RETRYABLE_PG_CODES', () => {
  it('contains exactly the three rolled-back-transaction codes', () => {
    expect([...RETRYABLE_PG_CODES].sort()).toEqual(['25P02', '40001', '40P01']);
  });
});

describe('isReplayableBody', () => {
  it('accepts undefined, null and string bodies', () => {
    expect(isReplayableBody(undefined)).toBe(true);
    expect(isReplayableBody(null)).toBe(true);
    expect(isReplayableBody('{"a":1}')).toBe(true);
  });

  it('rejects FormData and Blob bodies', () => {
    expect(isReplayableBody(new FormData())).toBe(false);
    expect(isReplayableBody(new Blob(['x']))).toBe(false);
  });
});

describe('extractTable', () => {
  it('returns the table name from a PostgREST URL', () => {
    expect(extractTable('https://x.supabase.co/rest/v1/bookings')).toBe('bookings');
  });

  // Review Focus 4: PII must never leave the browser.
  it('never includes the query string, which can carry customer PII', () => {
    const url = 'https://x.supabase.co/rest/v1/bookings?customer_phone=eq.9779800000000';
    const result = extractTable(url);
    expect(result).toBe('bookings');
    expect(result).not.toContain('9779800000000');
    expect(result).not.toContain('customer_phone');
  });

  it('accepts a Request object', () => {
    expect(extractTable(new Request('https://x.supabase.co/rest/v1/payments'))).toBe('payments');
  });

  it('returns "unknown" for an unparseable input rather than throwing', () => {
    expect(extractTable('not a url')).toBe('unknown');
  });
});

describe('readPgCode', () => {
  it('reads the code field from a PostgREST error body', async () => {
    await expect(readPgCode(jsonResponse(500, { code: '25P02' }))).resolves.toBe('25P02');
  });

  // Review Focus 1: a proxy HTML error page must not blow up the request path.
  it('returns null for a non-JSON body instead of throwing', async () => {
    const html = new Response('<html>502 Bad Gateway</html>', { status: 502 });
    await expect(readPgCode(html)).resolves.toBeNull();
  });

  // Review Focus 3: bodies read once — inspection must use a clone.
  it('leaves the original response body readable by the caller', async () => {
    const response = jsonResponse(500, { code: '25P02', message: 'aborted' });
    await readPgCode(response);
    await expect(response.json()).resolves.toEqual({ code: '25P02', message: 'aborted' });
  });
});

describe('createRetryingFetch', () => {
  it('retries a 25P02 and returns the eventual success', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(500, { code: '25P02' }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const wrapped = createRetryingFetch({ fetchImpl, sleep: noSleep });

    const res = await wrapped('https://x.supabase.co/rest/v1/bookings', {});

    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('gives up after 3 total attempts and returns the final error response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, { code: '25P02' }));
    const wrapped = createRetryingFetch({ fetchImpl, sleep: noSleep });

    const res = await wrapped('https://x.supabase.co/rest/v1/bookings', {});

    expect(res.status).toBe(500);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    await expect(res.json()).resolves.toEqual({ code: '25P02' });
  });

  it('does not retry a non-retryable Postgres code', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(409, { code: '23505' }));
    const wrapped = createRetryingFetch({ fetchImpl, sleep: noSleep });

    await wrapped('https://x.supabase.co/rest/v1/bookings', {});

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not retry a 4xx with no code', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(400, { message: 'bad' }));
    const wrapped = createRetryingFetch({ fetchImpl, sleep: noSleep });

    await wrapped('https://x.supabase.co/rest/v1/bookings', {});

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not retry a successful response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, [{ id: 1 }]));
    const wrapped = createRetryingFetch({ fetchImpl, sleep: noSleep });

    await wrapped('https://x.supabase.co/rest/v1/bookings', {});

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  // Review Focus 5: replaying a stream body could double-apply a write.
  it('does not retry when the request body is not replayable', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, { code: '25P02' }));
    const wrapped = createRetryingFetch({ fetchImpl, sleep: noSleep });

    await wrapped('https://x.supabase.co/rest/v1/bookings', {
      method: 'POST',
      body: new FormData(),
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries a POST with a string body, since 25P02 guarantees nothing committed', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(500, { code: '25P02' }))
      .mockResolvedValueOnce(jsonResponse(201, { id: 'b1' }));
    const wrapped = createRetryingFetch({ fetchImpl, sleep: noSleep });

    const res = await wrapped('https://x.supabase.co/rest/v1/bookings', {
      method: 'POST',
      body: '{"customer_name":"A"}',
    });

    expect(res.status).toBe(201);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('propagates a network-level throw without retrying', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const wrapped = createRetryingFetch({ fetchImpl, sleep: noSleep });

    await expect(wrapped('https://x.supabase.co/rest/v1/bookings', {})).rejects.toThrow('Failed to fetch');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('reports a silent recovery with recovered=true and the attempt count', async () => {
    const onError = vi.fn();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(500, { code: '25P02' }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const wrapped = createRetryingFetch({ fetchImpl, sleep: noSleep, onError });

    await wrapped('https://x.supabase.co/rest/v1/bookings', { method: 'GET' });

    expect(onError).toHaveBeenCalledWith({
      code: '25P02',
      status: 500,
      table: 'bookings',
      method: 'GET',
      attempts: 2,
      recovered: true,
    });
  });

  it('reports an unrecovered failure with recovered=false', async () => {
    const onError = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, { code: '25P02' }));
    const wrapped = createRetryingFetch({ fetchImpl, sleep: noSleep, onError });

    await wrapped('https://x.supabase.co/rest/v1/bookings', { method: 'GET' });

    expect(onError).toHaveBeenLastCalledWith(
      expect.objectContaining({ recovered: false, attempts: 3 })
    );
  });

  // Fail-open: analytics must never break a request.
  it('still returns the response when onError throws', async () => {
    const onError = vi.fn(() => { throw new Error('posthog exploded'); });
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, { code: '25P02' }));
    const wrapped = createRetryingFetch({ fetchImpl, sleep: noSleep, onError });

    const res = await wrapped('https://x.supabase.co/rest/v1/bookings', {});

    expect(res.status).toBe(500);
  });

  it('defaults to 3 total attempts without an explicit maxRetries', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, { code: '40001' }));
    const wrapped = createRetryingFetch({ fetchImpl, sleep: noSleep });

    await wrapped('https://x.supabase.co/rest/v1/bookings', {});

    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('backs off with increasing delays between attempts', async () => {
    const delays = [];
    const sleep = ms => { delays.push(ms); return Promise.resolve(); };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, { code: '25P02' }));
    const wrapped = createRetryingFetch({ fetchImpl, sleep, random: () => 0 });

    await wrapped('https://x.supabase.co/rest/v1/bookings', {});

    expect(delays).toEqual([150, 300]);
  });
});
