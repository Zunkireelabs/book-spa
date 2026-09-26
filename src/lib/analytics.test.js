import { describe, it, expect } from 'vitest';
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
