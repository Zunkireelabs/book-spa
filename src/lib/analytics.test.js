import { describe, it, expect, afterEach, vi } from 'vitest';
import { captureApiError } from './analytics';

// Staging intentionally ships without VITE_POSTHOG_KEY, so init() never runs and
// _initialized stays false. captureApiError sits on the request path, so a throw
// here would turn a silent recovery into a broken page — on staging only, which
// is exactly where it would go unnoticed.
describe('captureApiError', () => {
  it('no-ops without throwing when PostHog was never initialized', () => {
    expect(() =>
      captureApiError({
        code: '25P02',
        status: 500,
        table: 'bookings',
        method: 'GET',
        attempts: 2,
        recovered: true,
      })
    ).not.toThrow();
  });

  it('tolerates a completely empty payload', () => {
    expect(() => captureApiError({})).not.toThrow();
    expect(() => captureApiError()).not.toThrow();
  });
});

// These tests need `_initialized` to actually be true so the call reaches
// `posthog.capture(...)` — the line the two tests above never execute. They load a
// fresh copy of the module (via resetModules + dynamic import) so this initialized
// instance is isolated from the module instance the tests above rely on staying
// uninitialized.
describe('captureApiError, once initialized', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock('posthog-js');
    vi.resetModules();
  });

  it('forwards the exact destructured payload shape to posthog.capture', async () => {
    vi.resetModules();
    vi.doMock('posthog-js', () => ({
      default: { init: vi.fn(), capture: vi.fn() },
    }));
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test');

    const posthog = (await import('posthog-js')).default;
    const mod = await import('./analytics');
    mod.init();

    const payload = {
      code: '25P02',
      status: 500,
      table: 'bookings',
      method: 'GET',
      attempts: 2,
      recovered: true,
    };
    mod.captureApiError(payload);

    expect(posthog.capture).toHaveBeenCalledWith('api_error', payload);
  });

  it('still captures a 5xx with a null code (non-JSON proxy error body)', async () => {
    vi.resetModules();
    vi.doMock('posthog-js', () => ({
      default: { init: vi.fn(), capture: vi.fn() },
    }));
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test');

    const posthog = (await import('posthog-js')).default;
    const mod = await import('./analytics');
    mod.init();

    const payload = {
      code: null,
      status: 502,
      table: 'bookings',
      method: 'GET',
      attempts: 3,
      recovered: false,
    };
    mod.captureApiError(payload);

    expect(posthog.capture).toHaveBeenCalledWith('api_error', payload);
  });
});
