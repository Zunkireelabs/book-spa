// Pure rules for the Access section (ZNLY-198 step 4b / ZNLY-205 UI half). No React, no Supabase: unit-tested in staffAccessRules.test.js.
import { wordBranches } from '../utils/industryTerms';
// The roles a viewer may hand out is NOT redefined here: it is api.js grantableRolesFor (the same list assertCanGrantRole enforces).

export const ROLE_LABELS = { staff: 'Staff', manager: 'Manager', admin: 'Admin', admin_viewer: 'Admin viewer' };
export const CALENDAR_LABELS = { own: 'Own calendar', own_view: 'Own calendar (view only)', all: 'All calendars', all_view: 'All calendars (view only)' };
// ZNLY-284: the two view-only values are not enforced yet (ZNLY-283), so the picker no longer OFFERS them. CALENDAR_LABELS keeps all four so a
// login that already has one is still named truthfully. A login whose current value is a *_view keeps it selected (no rewrite); choosing Own / All
// replaces it, and from then on it is gone from the list.
export const CALENDAR_OPTIONS = ['own', 'all'].map((value) => ({ value, label: CALENDAR_LABELS[value] }));
export const isViewOnlyCalendar = (value) => value === 'own_view' || value === 'all_view';
export const calendarOptionsFor = (current) => (isViewOnlyCalendar(current) ? [...CALENDAR_OPTIONS, { value: current, label: CALENDAR_LABELS[current] }] : CALENDAR_OPTIONS);
export const VIEW_ONLY_NOTE = "View only isn't enforced yet. This login can still make changes.";

// An own-only calendar login: 'own' and 'own_view' (view only). The one definition viewerAccess (dataMasking) and resolveVisibility (api) share.
export const isOwnCalendar = (visibility) => ['own', 'own_view'].includes(visibility);

// Who sees the Access section at all: managers and admins edit, an admin viewer reads.
export const canViewAccess = (viewerRole) => ['manager', 'admin', 'admin_viewer'].includes(viewerRole);

// Edit rights, mirroring what the code and RLS really allow today (migration-321 "Managers and admins can update org users"):
//  - only manager and admin write; nobody edits their own row (no self-promotion);
//  - ZNLY-215: a manager edits only Staff-role people whose home branch is one they manage (migration-386 enforces the same in the database);
//    Manager, Admin and Admin viewer accounts, and people at other branches, are admin only. A person with no login yet is open to a manager
//    when their home branch is one the manager manages.
export function canEditAccess({ viewerRole, viewerUserId, target, viewerBranchIds = [], targetBranchId = null }) {
  if (!['manager', 'admin'].includes(viewerRole)) return false;
  if (target?.userId && target.userId === viewerUserId) return false;
  if (viewerRole === 'admin') return true;
  if (target && target.role !== 'staff') return false;
  return !!targetBranchId && viewerBranchIds.includes(targetBranchId);
}

export const loginIsOn = (user) => !!user && user.login_access !== 'none';

// "Panipokhari (home)" / "Panipokhari (home), Jhamsikhel" / "All branches".
export function branchSummary({ branches, grantedIds, homeBranchId }) {
  const all = (branches || []).map((b) => b.id);
  const granted = new Set([...(grantedIds || []), homeBranchId].filter(Boolean));
  if (all.length > 1 && all.every((id) => granted.has(id))) return `All ${wordBranches()}`;
  const names = (branches || []).filter((b) => granted.has(b.id)).sort((a, b) => (b.id === homeBranchId) - (a.id === homeBranchId))
    .map((b) => (b.id === homeBranchId ? `${b.name} (home)` : b.name));
  return names.join(', ') || '—';
}

// Edit form <-> what updateStaffAccess / grantStaffAccess take.
export function initialAccessForm({ user, branches, grantedIds, homeBranchId }) {
  const all = (branches || []).map((b) => b.id);
  const granted = new Set([...(grantedIds || []), homeBranchId].filter(Boolean));
  return {
    loginOn: user ? loginIsOn(user) : true,
    email: user?.email || '',
    password: '',
    pin: '',
    role: user?.role || 'staff',
    calendar: user?.calendar_visibility || 'own',
    hideClientDetails: user ? user.can_view_customer_details === false : false,
    hidePrices: user ? user.can_view_prices === false : false,
    branchMode: all.length > 1 && all.every((id) => granted.has(id)) ? 'all' : 'selected',
    branchIds: [...granted],
  };
}

export const branchIdsToSave = ({ form, branches, homeBranchId }) => (form.branchMode === 'all'
  ? (branches || []).map((b) => b.id)
  : [...new Set([...(form.branchIds || []), homeBranchId].filter(Boolean))]);

// The two "hide" boxes only mean something for the Staff role: the API ignores them for others, so the form hides them and sends nothing.
export const showsHideOptions = (role) => role === 'staff';

export function validateAccessForm({ form, isNewLogin }) {
  if (form.pin && !/^\d{4}$/.test(form.pin)) return 'The PIN must be exactly 4 digits.';
  if (isNewLogin && !form.email.trim()) return 'Enter the email this person signs in with.';
  if (isNewLogin && form.email.trim() && !/^\S+@\S+\.\S+$/.test(form.email.trim())) return 'That email does not look right.';
  // A new login needs at least one way to sign in. (Turned off, nobody signs in, so there is nothing to require.)
  if (isNewLogin && form.loginOn && !form.password && !form.pin) return 'Give them a password or a PIN so they can sign in.';
  return null;
}

// Save error copy (B1.4). ACCOUNT_ALREADY_LINKED comes from grantStaffAccess.
export function saveErrorCopy(error, staffLabel = 'team member') {
  if (error?.code === 'ACCOUNT_ALREADY_LINKED') return `That email already has a login for another ${staffLabel.toLowerCase()}. Open that profile or use a different email.`;
  return null;
}

// ── Link needs review (znly205_link_conflicts) ──
export const HIDDEN_CONFLICT_REASON = 'login_access_backfilled_to_email';
// Only these two can ever be linked (the row names a person who exists in this org); the other two can only be kept as they are.
export const LINKABLE_REASONS = ['therapist_already_linked_to_another_login', 'login_already_linked_to_another_therapist'];

export function conflictSentence(c, staffLabel = 'team member') {
  const who = c.userEmail || 'a login';
  const person = c.therapistName || `a ${staffLabel.toLowerCase()}`;
  switch (c.reason) {
    case 'therapist_already_linked_to_another_login':
      // therapistUserId is the live link (null = free now); the saved row only describes the moment of the update.
      if (c.therapistUserId === null) return `The login ${who} pointed at ${person}. ${person} has no login now; you can link it.`;
      return `The login ${who} pointed at ${person}, but ${person} already signs in with ${c.currentEmail || 'another login'}. Nothing was changed.`;
    case 'login_already_linked_to_another_therapist':
      return `The login ${who} pointed at ${person}, but it is already linked to another ${staffLabel.toLowerCase()}. Nothing was changed.`;
    case 'therapist_row_missing':
      return `The login ${who} pointed at a ${staffLabel.toLowerCase()} that no longer exists. Nothing was changed.`;
    case 'org_mismatch':
      return `The login ${who} pointed at a ${staffLabel.toLowerCase()} in a different business, so it was not linked. Nothing was changed.`;
    default:
      return `The login ${who} could not be linked automatically. Nothing was changed.`;
  }
}

// Can the suggested link work right now? (The RPC re-checks; this only avoids offering a button that must fail.)
export function canLinkNow(c) {
  if (!LINKABLE_REASONS.includes(c.reason) || !c.therapistName) return false;
  const personFree = !c.therapistUserId || c.therapistUserId === c.userId;
  const loginFree = !c.loginLinkedElsewhere;
  return personFree && loginFree;
}
