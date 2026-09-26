import posthog from 'posthog-js';

let _initialized = false;

export function init() {
  const key = import.meta.env.VITE_POSTHOG_KEY;
  if (!key || _initialized) return;

  posthog.init(key, {
    api_host: import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com',
    // Explicit capture only — no auto-click/DOM scraping (safer for PII)
    autocapture: false,
    // Mask all form inputs in session recordings
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: '[data-ph-mask]',
    },
    // Honour browser Do-Not-Track
    respect_dnt: true,
    // Capture page-views ourselves where needed
    capture_pageview: false,
    persistence: 'localStorage',
  });

  _initialized = true;
}

export function identify(userId, properties = {}) {
  if (!_initialized) return;
  posthog.identify(userId, properties);
}

export function reset() {
  if (!_initialized) return;
  posthog.reset();
}

export function capture(event, properties = {}) {
  if (!_initialized) return;
  posthog.capture(event, properties);
}

// Emitted from the Supabase fetch wrapper (see lib/supabaseRetry.js), which is the
// single choke point every request in the app passes through.
//
// `table` is a bare table name, never a URL — PostgREST encodes filters into the
// query string (?customer_phone=eq.977...), so forwarding a URL would leak customer
// PII into PostHog.
//
// `recovered: true` means the retry worked and the user saw nothing. That is the
// early-warning signal: it says the problem is happening while it is still
// invisible. `recovered: false` means the user saw an error.
export function captureApiError(payload = {}) {
  if (!_initialized) return;
  const { code, status, table, method, attempts, recovered } = payload;
  posthog.capture('api_error', { code, status, table, method, attempts, recovered });
}

export function setGroup(groupType, groupKey, groupProperties = {}) {
  if (!_initialized) return;
  posthog.group(groupType, groupKey, groupProperties);
}

export function isFeatureEnabled(flag) {
  if (!_initialized) return false;
  return posthog.isFeatureEnabled(flag);
}
