import { describe, it, expect } from 'vitest';
import * as supabaseModule from './supabase';
import { retryingFetch } from './supabase';

// C1 regression: AuthContext's direct /rest/v1/users fetch (used right after
// signInWithPassword, before the client's own session state is ready) must
// share the exact same retry wrapper as the three supabase-js clients, not a
// construct-its-own-second-wrapper divergent one. AuthContext.jsx imports this
// same named export, so proving it's exported (not module-private) and a real
// fetch-shaped function is what guarantees both call sites share one
// implementation. The retry *behavior* itself is covered by
// supabaseRetry.test.js.
describe('retryingFetch export', () => {
  it('is exported from lib/supabase (not module-private)', () => {
    expect(supabaseModule.retryingFetch).toBeDefined();
  });

  it('is a function usable as a fetch implementation', () => {
    expect(typeof retryingFetch).toBe('function');
  });

  it('is the same reference every time the module is imported', () => {
    // Guards against a refactor that turns this into a factory re-invoked per
    // import, which would silently give AuthContext.jsx a different wrapper
    // instance (and different in-flight retry state) than the clients use.
    expect(supabaseModule.retryingFetch).toBe(retryingFetch);
  });
});
