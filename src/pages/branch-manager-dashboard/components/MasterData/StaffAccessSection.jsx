import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../../../contexts/AuthContext';
import { useIndustry } from '../../../../hooks/useIndustry';
import { fetchTherapistAccess, fetchAllBranches, updateStaffAccess } from '../../../../services/api';
import { friendlyError } from '../../../../utils/friendlyError';
import {
  ROLE_LABELS, CALENDAR_LABELS, canViewAccess, canEditAccess, loginIsOn, branchSummary,
} from '../../../../services/staffAccessRules';
import AccessEditPanel from './AccessEditPanel';

const SECTION = 'text-[11.5px] font-medium uppercase tracking-[.05em] text-[#8A8A90]';
const ROW = 'flex items-center justify-between gap-3 px-3.5 py-2.5 text-[13px] text-[#515152] border-b border-[#F1F1EF] last:border-b-0';
const BTN = 'h-9 px-3.5 rounded-md border border-border bg-white text-[13px] font-medium inline-flex items-center gap-2 hover:bg-[#FAFAF9] disabled:opacity-60';

// The Access section of the team member panel (board B1.1 / B1.4): one person's login in a few rows, plus Edit access / Give login access.
// Managers and admins edit; an admin viewer reads. Replaces the old "Login" field and Settings -> Staff access.
const StaffAccessSection = ({ therapistId, personName, onEditingChange }) => {
  const { profile, user } = useAuth();
  const { staffLabel, sessionLabelPlural } = useIndustry();
  const first = (personName || '').split(' ')[0] || personName;
  const [state, setState] = useState({ status: 'loading', access: null, branches: [] });
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: 'loading' }));
    const [a, b] = await Promise.all([fetchTherapistAccess(therapistId), fetchAllBranches()]);
    if (a.error || b.error) setState({ status: 'error', access: null, branches: [] });
    else setState({ status: 'ready', access: a.data, branches: b.data || [] });
  }, [therapistId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { onEditingChange?.(editing); }, [editing, onEditingChange]);

  const viewerRole = profile?.role;
  const access = state.access;
  const editable = useMemo(() => canEditAccess({
    viewerRole, viewerUserId: user?.id || profile?.id, target: access?.user ? { role: access.user.role, userId: access.userId } : null,
  }), [viewerRole, user?.id, profile?.id, access]);
  if (!canViewAccess(viewerRole)) return null;

  const turnOn = async () => {
    setBusy(true); setActionError(null);
    const res = await updateStaffAccess({ userId: access.userId, loginAccess: 'email' });
    setBusy(false);
    if (res.error) { setActionError(friendlyError(res.error, 'Couldn\'t turn on login.')); return; }
    load();
  };

  const head = (right) => (
    <div className="flex items-baseline justify-between mb-2">
      <h3 className={SECTION}>Access</h3>
      {right}
    </div>
  );
  const readOnlyTag = <span className="text-[12px] text-[#8A8A90]">{editable ? 'Managers and admins' : 'Read-only'}</span>;

  if (state.status === 'loading') {
    return (
      <section data-peek-access="loading" aria-busy="true">
        {head(null)}
        <div className="border border-border rounded-lg p-4 space-y-2.5 animate-pulse">
          <div className="h-3.5 rounded bg-[#EFEFEC] w-3/5" /><div className="h-3.5 rounded bg-[#EFEFEC] w-[85%]" /><div className="h-3.5 rounded bg-[#EFEFEC] w-[45%]" />
        </div>
      </section>
    );
  }
  if (state.status === 'error') {
    return (
      <section data-peek-access="error">
        {head(null)}
        <p className="text-[13px] text-error">Couldn't load access. <button type="button" onClick={load} className="underline font-medium">Retry</button></p>
      </section>
    );
  }

  const u = access.user;
  const homeBranchId = access.homeBranchId;
  const panel = editing && (
    <AccessEditPanel therapistId={therapistId} personName={personName} homeBranchId={homeBranchId} branches={state.branches} access={access}
      onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); }} />
  );

  // No login yet (B1.3 entry point).
  if (!u) {
    return (
      <section data-peek-access="none">
        {head(readOnlyTag)}
        <div className="border border-border rounded-lg px-3.5 py-3 space-y-2.5">
          <p className="text-[13px] text-[#515152] leading-relaxed">{first} has no login yet. They are on the calendar, but cannot sign in.</p>
          {editable && <div><button type="button" className={BTN} onClick={() => setEditing(true)} data-access-give>Give login access</button></div>}
        </div>
        {panel}
      </section>
    );
  }

  // Login off (B1.4 #1).
  if (!loginIsOn(u)) {
    return (
      <section data-peek-access="off">
        <div className="flex items-baseline justify-between mb-2">
          <h3 className={SECTION}>Access</h3>
          <span className="h-[22px] px-2 rounded-full bg-[#F1F1EF] text-[11.5px] font-medium text-[#5F5F64] inline-flex items-center">Login off</span>
        </div>
        <div className="border border-border rounded-lg px-3.5 py-3 space-y-2.5">
          <p className="text-[13px] text-[#515152] leading-relaxed">{first} cannot sign in, by password or PIN. They are still bookable on the calendar. Their email, role and settings are kept.</p>
          {editable && (
            <div className="flex gap-2 flex-wrap">
              <button type="button" className={BTN} onClick={turnOn} disabled={busy} data-access-turn-on>Turn on login</button>
              <button type="button" className={BTN} onClick={() => setEditing(true)} data-access-edit>Edit access</button>
            </div>
          )}
          {actionError && <p className="text-[12px] text-error">{actionError}</p>}
        </div>
        {panel}
      </section>
    );
  }

  return (
    <section data-peek-access="on">
      {head(readOnlyTag)}
      <div className="border border-border rounded-lg">
        <div className={ROW}><span>Login</span><b className="font-semibold text-text-primary inline-flex items-center gap-1.5"><span aria-hidden="true" className="w-2 h-2 rounded-full bg-[#10B981]" />On</b></div>
        <div className={ROW}><span>Signs in with</span><b className="font-semibold text-text-primary text-right break-all">{u.email}</b></div>
        <div className={ROW}><span>PIN</span><b className={`font-semibold ${access.hasPin === false ? 'text-[#8A4B06]' : 'text-text-primary'}`}>{access.hasPin == null ? '—' : access.hasPin ? 'Set' : 'Not set'}</b></div>
        <div className={ROW}><span>Role</span><b className="font-semibold text-text-primary">{ROLE_LABELS[u.role] || u.role}</b></div>
        <div className={ROW}><span>Calendar</span><b className="font-semibold text-text-primary">{CALENDAR_LABELS[u.calendar_visibility] || '—'}</b></div>
        <div className={ROW}><span>Client details</span><b className="font-semibold text-text-primary">{u.can_view_customer_details === false ? 'Hidden' : 'Shown'}</b></div>
        <div className={ROW}><span>Prices</span><b className="font-semibold text-text-primary">{u.can_view_prices === false ? 'Hidden' : 'Shown'}</b></div>
        <div className={ROW}><span>Branches</span><b className="font-semibold text-text-primary text-right">{branchSummary({ branches: state.branches, grantedIds: access.branchIds, homeBranchId })}</b></div>
      </div>
      <p className="text-xs text-[#8A8A90] mt-2" data-access-hint>Sees their own {sessionLabelPlural.toLowerCase()}, day and tips when signed in.</p>
      {editable && <div className="mt-2.5"><button type="button" className={BTN} onClick={() => setEditing(true)} data-access-edit>Edit access</button></div>}
      {panel}
    </section>
  );
};

export default StaffAccessSection;
