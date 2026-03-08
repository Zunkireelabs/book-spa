---
name: review-code
description: Code reviewer for BookSpa. Reviews code for project conventions, security issues, Supabase best practices, and common mistakes.
disable-model-invocation: true
context: fork
agent: Explore
allowed-tools: Read, Grep, Glob
argument-hint: "[file-path or feature-name]"
---

# BookSpa Code Review

Review the code specified by `$ARGUMENTS`. If no argument provided, review all recently modified files.

## Review Checklist

### 1. Project Conventions
- [ ] Components use functional style with hooks (no class components)
- [ ] Files are PascalCase for components, camelCase for utilities
- [ ] Page modules follow `pages/<feature>/index.jsx` + `components/` pattern
- [ ] Imports use path aliases (`components/`, `contexts/`, `lib/`, `services/`) — no `../../` for cross-directory imports
- [ ] Icons use `<Icon name="..." />` wrapper — never direct Lucide imports
- [ ] Forms use React Hook Form — no uncontrolled vanilla forms
- [ ] Buttons use `<Button>` component — no raw `<button>` elements
- [ ] Inputs use `<Input>` component — no raw `<input>` elements

### 2. Tailwind & Styling
- [ ] Uses project color tokens (`bg-primary`, `text-text-primary`) — no raw hex colors
- [ ] Uses project font classes (`font-heading`, `font-body`) — no raw font-family
- [ ] Uses project shadow tokens (`shadow-spa-resting`, etc.) — no custom box-shadow
- [ ] Uses project border radius (`rounded-spa`, `rounded-spa-lg`) — or standard Tailwind
- [ ] Touch targets are minimum 44px (`h-touch`) for interactive elements
- [ ] Responsive design present (mobile-first with `sm:`, `lg:` breakpoints)

### 3. Supabase & API Layer
- [ ] All database queries are in `src/services/` — not in components
- [ ] Supabase client is only imported in services and AuthContext
- [ ] Errors from Supabase are caught and handled (try/catch with user-facing messages)
- [ ] Trigger-computed fields are NOT set in INSERT/UPDATE calls (booking_number, end_time, start_datetime, end_datetime, final_amount, updated_at)
- [ ] Financial amounts use the service price as `base_amount` (snapshotted at booking time)
- [ ] Payment status is `'paid'`/`'unpaid'` — not boolean
- [ ] Booking status values are exact: `'Pending'`, `'Confirmed'`, `'In-Progress'`, `'Completed'`, `'Cancelled'`

### 4. Security
- [ ] No secrets in code (API keys, passwords) — must use env vars (`import.meta.env.VITE_*`)
- [ ] No `console.log` with sensitive data (user tokens, passwords)
- [ ] No `dangerouslySetInnerHTML` without sanitization
- [ ] No user input directly interpolated into Supabase queries (use parameterized filters)
- [ ] Protected routes use `<ProtectedRoute allowedRoles={[...]}>`
- [ ] Discount approval checks role (only manager/admin)

### 5. Auth & Authorization
- [ ] Auth state accessed via `useAuth()` hook — never direct supabase.auth calls in components
- [ ] Role-based access uses `profile.role` from useAuth — not hardcoded
- [ ] Sign out clears all state properly
- [ ] Loading states shown while auth initializes

### 6. Data Integrity
- [ ] Mock data has been replaced (no `mockBookings`, `mockTherapists` remaining)
- [ ] Date handling uses `date-fns` — no raw Date manipulation
- [ ] Timezone: all datetime operations account for Asia/Kathmandu
- [ ] Currency formatted as "NPR X,XXX" — no decimals in display

### 7. Performance
- [ ] No unnecessary re-renders (useCallback for handlers in lists, useMemo for expensive computations)
- [ ] API calls have loading states
- [ ] Lists have proper `key` props (using `id`, not array index)
- [ ] Real-time subscriptions are cleaned up in useEffect return

### 8. Error Handling
- [ ] All async operations have try/catch
- [ ] User-facing error messages (not raw error.message from Supabase)
- [ ] GIST constraint violations show friendly overlap messages
- [ ] Network errors handled gracefully
- [ ] ErrorBoundary wraps the app

## Output Format

For each file reviewed, provide:

```
### filename.jsx

**Status:** PASS / WARN / FAIL

**Issues Found:**
1. [SEVERITY] Description of issue (line X)
   Fix: How to fix it

**Good Practices Noticed:**
- What's done well
```

Severity levels: CRITICAL (security/data loss), ERROR (broken functionality), WARN (conventions), INFO (suggestions)

Summarize at the end with total counts by severity.
