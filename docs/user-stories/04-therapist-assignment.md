# 04 — Therapist Assignment

> **Module:** Therapist Assignment Engine (D)
> **Primary Screen:** `/booking-details-assignment-modal` — Assignment tab
> **Roles:** Staff, Manager, Admin

---

## US-THA-001: Assign Therapist to Booking

**As a** staff member,
**I want to** assign an available therapist to a booking,
**so that** the customer receives their service.

**Screen:** `/booking-details-assignment-modal` — Assignment tab

**Acceptance Criteria:**
- [ ] List of active therapists for the branch shown
- [ ] Each therapist shows: name, gender, specialties, availability status
- [ ] Therapists with time conflicts marked as unavailable with reason
- [ ] Select therapist via radio button
- [ ] Optional assignment notes field
- [ ] On confirm: `therapist_id` updated on booking in database
- [ ] GIST exclusion constraint prevents double-booking at DB level
- [ ] If double-booking attempted: structured error returned
- [ ] Therapist is optional at booking creation — can be assigned later

**Priority:** P0
**Phase:** 3
**Status:** Partial — UI built with mock data and match scoring, DB update not wired

---

## US-THA-002: View Therapist Match Score

**As a** staff member,
**I want to** see a match score for each therapist against the booking,
**so that** I can make the best assignment decision.

**Screen:** `/booking-details-assignment-modal` — Assignment tab

**Acceptance Criteria:**
- [ ] Match score calculated based on:
  - Gender match with customer preference (30% weight)
  - Specialty match with service type (40% weight)
  - Experience level (20% weight)
  - Customer rating (10% weight)
- [ ] Score displayed as percentage badge
- [ ] Therapists sorted by match score (best first)

**Priority:** P2
**Phase:** 3
**Status:** Partial — scoring algorithm exists in UI, not using live preference data

---

## US-THA-003: Reassign Therapist

**As a** staff member,
**I want to** change the assigned therapist for a booking,
**so that** I can handle schedule changes.

**Screen:** `/booking-details-assignment-modal` — Assignment tab

**Acceptance Criteria:**
- [ ] Current assignment displayed with therapist name and timestamp
- [ ] "Reassign" button available when therapist already assigned
- [ ] New therapist selection follows same availability check
- [ ] Previous therapist freed from the time slot
- [ ] Only allowed for bookings NOT in Completed or Cancelled status

**Priority:** P1
**Phase:** 3
**Status:** Not Started — UI exists but handler is mock

---

## US-THA-004: Unassign Therapist

**As a** staff member,
**I want to** remove a therapist from a booking,
**so that** the therapist is freed for other bookings.

**Screen:** `/booking-details-assignment-modal` — Assignment tab

**Acceptance Criteria:**
- [ ] "Unassign" button shown when therapist is assigned
- [ ] Sets `therapist_id = null` on the booking
- [ ] Therapist becomes available for the time slot
- [ ] Only allowed for bookings NOT in Completed or Cancelled status

**Priority:** P1
**Phase:** 3
**Status:** Not Started — UI exists but handler is mock
