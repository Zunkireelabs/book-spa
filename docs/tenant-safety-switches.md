# Per-tenant switches that can remove a protection (ZNLY-354)

Checked against prod copy + migrations 318-416. "Core rule" = still enforced when the switch is off.

| Switch | Guards | Core rule when off? | Onboarding default | Recommendation |
|---|---|---|---|---|
| organizations.enforce_staff_availability (default **false**) | staff leave / off-day / outside hours / other-branch checks (check_therapist_booking_guards, public availability RPCs) | Double-booking: **yes**, unconditional since 414. Leave/off-day/hours/other-branch: **no** | **true** | Column default should become true for new orgs (needs a migration; ask). All 3 prod orgs are currently false: decide per tenant. |
| branches.online_booking_capacity (NULL) | max simultaneous online bookings | No cap when NULL (online path only; staff path unaffected) | NULL | No change; owner sets it per branch. |
| branches.advance_booking_days (NULL) | how far ahead online bookings open | Unlimited when NULL (online path only) | 90 | No change (script sets 90). |
| branches.excluded_service_categories / branch_service_links | which services a branch offers | Scoping, not safety | empty | No change. |
| branches.expect_check_in, late_grace_minutes, open_checkout_hours | attendance gap reporting | Reporting only; THERAPIST_ABSENT / CHECKED_OUT guards are unconditional | defaults | No change. |
| organizations.marketplace_* (3 flags, default false) | exposure to the marketplace | Off = nothing exposed (safe) | false | No change; go-live refuses while blockers exist (413). |
| organizations.is_active, services.is_active / bookable_online | visibility | Off = not bookable (safe) | true | No change. |
| organizations.settings (billing_*, paymentMethods, show_staff_selection) | invoicing / UI | Not a booking safety rule | {} | No change. |

Other protections (room capacity, therapist overlap 414, inactive branch, phone required, discount limits) have no per-org switch.
