# 02 — Authentication & Access Control

> **Module:** Role & Permission Control (H)
> **Primary Screen:** `/staff-login-authentication`
> **Roles:** Staff, Manager, Admin

---

## US-AUTH-001: Staff Login

**As a** staff member (staff/manager/admin),
**I want to** log in with my email and password,
**so that** I can access the branch operations system.

**Screen:** `/staff-login-authentication`

**Acceptance Criteria:**
- [ ] Email and password fields with validation
- [ ] Authenticates against Supabase Auth
- [ ] On success: redirects to role-appropriate dashboard
  - Staff → `/branch-staff-dashboard`
  - Manager/Admin → `/branch-manager-dashboard`
- [ ] On failure: displays error message (invalid credentials, account inactive)
- [ ] Loading state during authentication
- [ ] User profile (name, role, branch) fetched and stored in context

**Priority:** P0
**Phase:** 2 (Auth Context)
**Status:** Implemented

---

## US-AUTH-002: Session Persistence

**As a** logged-in user,
**I want to** stay logged in when I refresh the page,
**so that** I don't have to re-authenticate constantly.

**Screen:** All protected routes

**Acceptance Criteria:**
- [ ] Page refresh does not log the user out
- [ ] Auth state restored from Supabase session on mount
- [ ] Profile data re-fetched on session restore
- [ ] Loading spinner shown during session check

**Priority:** P0
**Phase:** 2
**Status:** Implemented

---

## US-AUTH-003: Protected Route Access

**As the** system,
**I want to** restrict dashboard access based on user role,
**so that** unauthorized users cannot access sensitive operations.

**Screen:** All protected routes

**Acceptance Criteria:**
- [ ] Unauthenticated users redirected to `/staff-login-authentication`
- [ ] Staff cannot access `/branch-manager-dashboard`
- [ ] Manager and Admin can access all staff routes
- [ ] Admin can access all routes
- [ ] Role check happens on every protected route mount

**Priority:** P0
**Phase:** 2
**Status:** Implemented

---

## US-AUTH-004: Staff Logout

**As a** logged-in user,
**I want to** log out of the system,
**so that** my session is ended and the terminal is secured.

**Screen:** Sidebar navigation (all protected pages)

**Acceptance Criteria:**
- [ ] Logout button visible in sidebar/header
- [ ] Clicking logout clears the session
- [ ] Redirects to `/staff-login-authentication`
- [ ] Subsequent navigation to protected routes requires re-login

**Priority:** P0
**Phase:** 2
**Status:** Implemented

---

## US-AUTH-005: Role Display in UI

**As a** logged-in user,
**I want to** see my name, role, and branch displayed in the interface,
**so that** I know which account and branch I'm operating under.

**Screen:** `/branch-staff-dashboard`, `/branch-manager-dashboard` — Header/Sidebar

**Acceptance Criteria:**
- [ ] User full name displayed
- [ ] Role badge (Staff / Manager / Admin)
- [ ] Branch name shown
- [ ] Profile data sourced from `users` table joined with `branches`

**Priority:** P1
**Phase:** 2
**Status:** Implemented
