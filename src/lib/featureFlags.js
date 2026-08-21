// Build-time feature flags, baked in via Vite's `import.meta.env.VITE_*` at
// Docker build time (see docker-compose.yml / docker-compose.dev.yml build
// args) — same mechanism as VITE_POSTHOG_KEY in lib/analytics.js.

// Membership (prepaid wallet + tiers) is intentionally OFF in production: the
// DB migrations that create the memberships/membership_tiers/
// membership_transactions tables are deliberately not applied there. ON in
// staging. Every membership entry point in the UI must check this before
// rendering or querying.
export const MEMBERSHIP_ENABLED = import.meta.env.VITE_ENABLE_MEMBERSHIP === 'true';

// Customer-to-customer referral rewards (migration-078). Independent of
// MEMBERSHIP_ENABLED — the referral credit ledger has no dependency on the
// membership tables, so it can ship to production on its own timeline.
export const CUSTOMER_REFERRALS_ENABLED = import.meta.env.VITE_ENABLE_CUSTOMER_REFERRALS === 'true';

// Voucher issue/redeem/balance tracking (migration-071), replacing the manual
// Excel workbook. Independent of the other flags. Gate on this before every
// voucher entry point until the migration has been promoted to production.
export const VOUCHER_ENABLED = import.meta.env.VITE_ENABLE_VOUCHERS === 'true';

// Automated customer outreach (win-back / review-request / etc, migrations
// 102-110) — rules, templates, review queue, message log, provider config.
// Not yet launched anywhere; gate every outreach entry point behind this
// until the schema has been promoted to production.
export const OUTREACH_ENABLED = import.meta.env.VITE_ENABLE_OUTREACH === 'true';
