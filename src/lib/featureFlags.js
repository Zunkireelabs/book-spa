// Build-time feature flags, baked in via Vite's `import.meta.env.VITE_*` at
// Docker build time (see docker-compose.yml / docker-compose.dev.yml build
// args) — same mechanism as VITE_POSTHOG_KEY in lib/analytics.js.

// Membership (prepaid wallet + tiers) is intentionally OFF in production: the
// DB migrations that create the memberships/membership_tiers/
// membership_transactions tables are deliberately not applied there. ON in
// staging. Every membership entry point in the UI must check this before
// rendering or querying.
export const MEMBERSHIP_ENABLED = import.meta.env.VITE_ENABLE_MEMBERSHIP === 'true';
