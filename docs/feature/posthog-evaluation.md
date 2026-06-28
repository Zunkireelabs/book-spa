# PostHog Evaluation for Zenly

## Why we're considering it

Zenly currently has **zero analytics** — every product decision is made blind. The membership system, split-payment system, and 6-step customer booking flow are all live without any visibility into adoption, drop-off, or usage.

PostHog is a product-analytics platform (open-source alternative to Mixpanel/Amplitude) offering event tracking, session recordings, feature flags, A/B testing, funnels, and retention analysis from a single SDK.

---

## Benefits

### Customer-side (anonymous booking flow at `/:orgSlug/book`)

| # | Benefit | Why it matters |
|---|---------|----------------|
| 1 | **Booking funnel drop-off** | The flow is 6 steps (Branch → Service → Date/Time → Details → Confirm → Success). We can't tell if customers abandon at step 2 (no service interest) or step 4 (form friction) or step 5 (price shock). PostHog Funnels visualizes the cliff. |
| 2 | **Service popularity vs conversion** | Which services get viewed often but rarely booked — signals UX confusion or pricing issues. |
| 3 | **Session recordings** | Free tier includes 5k recordings/month. Watch real customers struggle through the flow on real devices. Highest-bandwidth UX feedback available. |
| 4 | **Device segmentation** | Mobile vs desktop drop-off split. Most spa customers book on mobile — if mobile conversion is half of desktop, that's actionable. |
| 5 | **Time-to-book** | Median time from landing to confirmation. Sets a regression baseline for future UX changes. |
| 6 | **Repeat-customer cohorts** | Phone number is a stable identifier — build "first-time vs returning" cohorts and measure repeat rate per branch. |

### Staff-side (authenticated dashboard at `/:orgSlug/dashboard`)

| # | Benefit | Why it matters |
|---|---------|----------------|
| 7 | **Membership adoption** | How many enrollments per branch, top-up frequency, which tiers get picked, which payment modes. The membership feature just shipped — this tells us if the salon floor is actually using it. |
| 8 | **Feature-usage heatmap** | Which dashboard panels (calendar, payroll, transfer report, memberships, CRM) get opened. Dead features get cut; popular ones get polish budget. |
| 9 | **Discount workflow visibility** | How often staff request discounts, manager approval rate, average requested-vs-approved % — surfaces training gaps and policy issues. |
| 10 | **Per-staff activity** | Which staff lean on which tools — identifies power users (to copy patterns) and stragglers (to train). |

### Operational

| # | Benefit | Why it matters |
|---|---------|----------------|
| 11 | **Feature flags** | Built-in. Gradual rollout for new features, kill-switches, A/B testing of booking-flow copy. |
| 12 | **Multi-tenant slicing** | Every event tagged with `org_slug` + `branch_id` via PostHog groups — when the next tenant goes live, we compare them side-by-side without extra instrumentation. |
| 13 | **Cost-of-entry** | Free tier: 1M events + 5k recordings + 1M feature-flag requests per month. Sufficient for current single-tenant scale. |

---

## Drawbacks & Risks

| # | Risk | Severity | Mitigation |
|---|------|----------|-----------|
| 1 | **Customer PII leaks into session recordings.** Step 4 of the booking flow captures `customer_name`, `customer_email`, `customer_phone`, `customer_gender`, `special_requests`. | **High** | Configure SDK with `session_recording.maskAllInputs: true`. Add `data-ph-mask` attribute to PII-bearing inputs and confirm screen fields. Set `autocapture: false`. |
| 2 | **Data residency** — PostHog Cloud (US) stores events outside Nepal. | Low (today) | No Nepal legal blocker. Re-evaluate if/when an EU tenant onboards. |
| 3 | **Bundle size** — `posthog-js` adds ~50KB gzipped to the customer booking flow (mobile-heavy in Nepal). | Low | Lazy-init via dynamic `import()` after first user interaction. Doesn't block first paint. |
| 4 | **Free-tier ceiling** — 1M events / 5k recordings per month. | Medium at scale | Track only decision-driving events, not every click. Use 10% session recording sampling once volume grows. PostHog overage is ~$0.00031/event at scale. |
| 5 | **Vendor lock-in** — `posthog-js` API is bespoke. | Low | Wrap all calls in `src/lib/analytics.js`. Swapping vendors is a one-file change. |
| 6 | **GDPR consent** for occasional EU visitors (tourists at the spa). | Low | Nepal has no equivalent regulation. `respect_dnt: true` covers Do-Not-Track headers. Defer consent UI unless an EU tenant onboards. |
| 7 | **Over-instrumentation** — easy to add `track()` calls everywhere without discipline. | Medium | Maintain an explicit event taxonomy. Keep it to events that drive real product decisions. |
| 8 | **Per-tenant data deletion** requests. | Low | PostHog groups (group key = `org_id`) support group-level deletion. Tenant offboarding cleanly removes their data. |

---

## Cost Forecast

| Stage | Events/month | Recordings/month | Monthly cost |
|-------|-------------|------------------|--------------|
| Today (1 tenant, ~50 bookings/day) | ~30k | ~500 | **$0** (free tier) |
| 1 year (3 tenants, ~150 bookings/day) | ~250k | ~3k | **$0** (still free tier) |
| 3 years (10 tenants, scaled) | ~2M | ~10k | **~$80/month** |

---

## Recommendation

**Adopt PostHog Cloud (US region)** covering both the customer booking funnel and staff feature adoption.

The benefit list is tied directly to features we already shipped (membership, split payments, customer booking flow). The drawbacks are real but each has a known mitigation that fits in the initial setup PR. Free-tier comfortably covers the foreseeable future, and wrapping all SDK calls in a single file keeps the exit cost low if we change our minds.

---

*Evaluated: 2026-06-15 | Decision: Adopt | Hosting: PostHog Cloud US | Scope: Customer funnel + Staff adoption*
