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

export function setGroup(groupType, groupKey, groupProperties = {}) {
  if (!_initialized) return;
  posthog.group(groupType, groupKey, groupProperties);
}

export function isFeatureEnabled(flag) {
  if (!_initialized) return false;
  return posthog.isFeatureEnabled(flag);
}
