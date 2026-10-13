import { describe, it, expect, vi, afterEach } from 'vitest';
import { IN_CHUNK, inChunks, failOpenAfter } from './queryHelpers';

describe('inChunks', () => {
  it('splits ids into chunks of IN_CHUNK and concatenates the rows', async () => {
    const ids = Array.from({ length: IN_CHUNK * 2 + 5 }, (_, i) => i);
    const run = vi.fn(async (chunk) => ({ data: chunk.map((id) => ({ id })), error: null }));
    const rows = await inChunks(ids, run);
    expect(run).toHaveBeenCalledTimes(3);
    expect(run.mock.calls.map(([c]) => c.length)).toEqual([IN_CHUNK, IN_CHUNK, 5]);
    expect(rows).toHaveLength(ids.length);
  });

  it('does nothing for an empty id list', async () => {
    const run = vi.fn();
    expect(await inChunks([], run)).toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });

  it('tolerates null data and throws the first error', async () => {
    expect(await inChunks(['a'], async () => ({ data: null, error: null }))).toEqual([]);
    const boom = new Error('boom');
    await expect(inChunks(['a'], async () => ({ data: null, error: boom }))).rejects.toBe(boom);
  });
});

describe('failOpenAfter', () => {
  afterEach(() => vi.useRealTimers());

  it('resolves with the promise value when it settles in time', async () => {
    await expect(failOpenAfter(Promise.resolve('ok'), 50, 'fallback')).resolves.toBe('ok');
  });

  it('resolves with the fallback when the promise is too slow', async () => {
    vi.useFakeTimers();
    const slow = new Promise((resolve) => setTimeout(() => resolve('late'), 1000));
    const result = failOpenAfter(slow, 100, 'fallback');
    await vi.advanceTimersByTimeAsync(100);
    await expect(result).resolves.toBe('fallback');
  });

  it('clears its timer once the promise settles', async () => {
    vi.useFakeTimers();
    await failOpenAfter(Promise.resolve(1), 5000, null);
    expect(vi.getTimerCount()).toBe(0);
  });
});
