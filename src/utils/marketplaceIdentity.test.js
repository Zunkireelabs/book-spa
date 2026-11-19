import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchMarketplaceIdentity } from './marketplaceIdentity';

// No jsdom in this project's vitest config (node environment) -- stub `window` directly
// rather than pull in a DOM, since the module only ever reads window.location.search.
function stubWindowSearch(search = '') {
  vi.stubGlobal('window', { location: { search } });
}

describe('fetchMarketplaceIdentity', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('never fetches on a plain visit (no base path, no source=zennly, no window at all)', async () => {
    vi.stubEnv('VITE_BASE_PATH', '/');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    // Deliberately no window stub: a plain visit should short-circuit on the
    // try/catch before ever needing window to exist.

    const result = await fetchMarketplaceIdentity();

    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fetches and returns the identity when served under a base path', async () => {
    vi.stubEnv('VITE_BASE_PATH', '/book/');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, data: { id: 'u1', email: 'a@b.com', name: 'Ana Smith' } }),
    }));

    const result = await fetchMarketplaceIdentity();

    expect(result).toEqual({
      name: 'Ana Smith', email: 'a@b.com',
      firstName: '', lastName: '', phone: '', gender: '', country: '',
    });
  });

  it('fetches when ?source=zennly is present even with no base path', async () => {
    vi.stubEnv('VITE_BASE_PATH', '/');
    stubWindowSearch('?source=zennly&handoff_id=abc');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, data: { id: 'u1', email: 'a@b.com', name: 'Ana Smith' } }),
    }));

    const result = await fetchMarketplaceIdentity();

    expect(result).toEqual({
      name: 'Ana Smith', email: 'a@b.com',
      firstName: '', lastName: '', phone: '', gender: '', country: '',
    });
  });

  it('does not fetch when some other source param is present', async () => {
    vi.stubEnv('VITE_BASE_PATH', '/');
    stubWindowSearch('?source=google-ads');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    expect(await fetchMarketplaceIdentity()).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('resolves to null on a logged-out marketplace session (data: null)', async () => {
    vi.stubEnv('VITE_BASE_PATH', '/book/');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, data: null }),
    }));

    expect(await fetchMarketplaceIdentity()).toBeNull();
  });

  it('resolves to null, never throws, on a non-200 response', async () => {
    vi.stubEnv('VITE_BASE_PATH', '/book/');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));

    expect(await fetchMarketplaceIdentity()).toBeNull();
  });

  it('resolves to null, never throws, on malformed JSON', async () => {
    vi.stubEnv('VITE_BASE_PATH', '/book/');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => { throw new SyntaxError('bad json'); },
    }));

    expect(await fetchMarketplaceIdentity()).toBeNull();
  });

  it('resolves to null, never throws, on a network error', async () => {
    vi.stubEnv('VITE_BASE_PATH', '/book/');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    expect(await fetchMarketplaceIdentity()).toBeNull();
  });

  it('falls back to an empty email when the marketplace has no email on file', async () => {
    vi.stubEnv('VITE_BASE_PATH', '/book/');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, data: { id: 'u1', email: null, name: 'Ana Smith' } }),
    }));

    expect(await fetchMarketplaceIdentity()).toEqual({
      name: 'Ana Smith', email: '',
      firstName: '', lastName: '', phone: '', gender: '', country: '',
    });
  });

  it('passes through firstName/lastName/phone/gender/country when the marketplace sends them', async () => {
    vi.stubEnv('VITE_BASE_PATH', '/book/');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        data: {
          id: 'u1', email: 'a@b.com', name: 'Ana Smith',
          firstName: 'Ana', lastName: 'Smith', phone: '9841234567', gender: 'female', country: 'NP',
        },
      }),
    }));

    expect(await fetchMarketplaceIdentity()).toEqual({
      name: 'Ana Smith', email: 'a@b.com',
      firstName: 'Ana', lastName: 'Smith', phone: '9841234567', gender: 'female', country: 'NP',
    });
  });

  it('stays backward-compatible when the marketplace has not shipped the new fields yet', async () => {
    vi.stubEnv('VITE_BASE_PATH', '/book/');
    // Old-shape response: no firstName/lastName/phone/gender/country keys at all.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, data: { id: 'u1', email: 'a@b.com', name: 'Ana Smith' } }),
    }));

    expect(await fetchMarketplaceIdentity()).toEqual({
      name: 'Ana Smith', email: 'a@b.com',
      firstName: '', lastName: '', phone: '', gender: '', country: '',
    });
  });
});
