import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../../../contexts/AuthContext';
import { useBranch } from '../../../../contexts/BranchContext';
import { fetchMemberships, fetchMembershipTiers } from '../../../../services/api';
import { leadParts } from '../../../../services/membershipsView';
import { nepalNow } from '../../../../utils/customerDirectory';
import { friendlyError } from '../../../../utils/friendlyError';
import { useAutoRefresh } from '../../../../hooks/useAutoRefresh';
import { ListPageShell, useToast, useExportSlot, ExportButton, PrimaryButton, leadNodes } from '../Area/listKit';
import MembershipsPanel from './MembershipsPanel';
import MembershipCollectionPanel from './MembershipCollectionPanel';
import WalletUsagePanel from './WalletUsagePanel';
import MembershipDetailPanel from './MembershipDetailPanel';
import EnrollMemberPanel from './EnrollMemberPanel';

// Memberships (V21): one header (title, lead sentence, Export + Enroll member) over three tabs: Members, Tiers, Wallet activity.
// Members and Tiers share one load (every membership + every tier, hidden ones included). Memberships belong to the org, so every
// branch sees all of them. The member panel opens from any tab through `?open=<id>` (`&mv=topup` lands on a sub-view).
const MembershipsPage = ({ view, branchId, readOnly = false }) => {
  const { profile } = useAuth();
  const { isOverall } = useBranch();
  const role = profile?.role;
  const canExport = role === 'manager' || role === 'admin';
  const [sp, setSp] = useSearchParams();

  const [members, setMembers] = useState(null);
  const [tiers, setTiers] = useState(null);
  const [error, setError] = useState(null);
  const [today, setToday] = useState(() => nepalNow().today);
  const [enroll, setEnroll] = useState(null); // { tierId? } while the Enroll member panel is open
  const [activityLead, setActivityLead] = useState(' ');
  const { notify, toastNode } = useToast();
  const { registerExport, runExport, exportReady } = useExportSlot();

  // Refreshes swap data in silently (no skeleton), so an open panel and the scroll position stay put.
  const load = useCallback(async () => {
    setError(null);
    const [mRes, tRes] = await Promise.all([fetchMemberships(), fetchMembershipTiers(profile?.org_id, { includeInactive: true })]);
    setToday(nepalNow().today);
    if (mRes.error || tRes.error) { setError(friendlyError(mRes.error || tRes.error, 'Failed to load memberships.')); return; }
    setMembers(mRes.data || []);
    setTiers(tRes.data || []);
  }, [profile?.org_id]);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load, { intervalMs: 90000, enabled: view === 'memberships' });

  const openId = sp.get('open') || null;
  const openView = sp.get('mv') || null;
  const openMember = useCallback((id, subView = null) => {
    const next = new URLSearchParams(sp);
    if (id) next.set('open', id); else next.delete('open');
    if (subView) next.set('mv', subView); else next.delete('mv');
    setSp(next, { replace: true });
  }, [sp, setSp]);

  const lead = view === 'memberships' ? (members ? leadNodes(leadParts(members)) : ' ')
    : view === 'membership-collection' ? 'What members pay up front, and the discounts they get for it.'
      : activityLead;

  return (
    <ListPageShell
      view={view}
      title="Memberships"
      lead={lead}
      counts={{ memberships: members?.length, 'membership-collection': tiers?.length }}
      actions={(
        <>
          {canExport && <ExportButton onClick={runExport} disabled={!exportReady} />}
          {!readOnly && <PrimaryButton onClick={() => setEnroll({})}>Enroll member</PrimaryButton>}
        </>
      )}
    >
      {(stickyTop) => {
        const childProps = { members, tiers, today, error, onRetry: load, onChanged: load, readOnly, isOverall, branchId, role, stickyTop, notify, registerExport, onOpen: openMember, openId };
        return (
          <>
            {view === 'memberships' && <MembershipsPanel {...childProps} />}
            {view === 'membership-collection' && <MembershipCollectionPanel {...childProps} onEnroll={(tierId) => setEnroll({ tierId })} />}
            {view === 'wallet-usage' && <WalletUsagePanel {...childProps} onLead={setActivityLead} />}
            {openId && (
              <MembershipDetailPanel
                key={`${openId}:${openView || ''}`}
                membershipId={openId}
                initialView={openView}
                width="460px"
                isAdmin={role === 'admin'}
                readOnly={readOnly}
                branchId={branchId}
                onClose={() => openMember(null)}
                onChanged={load}
              />
            )}
            {!readOnly && enroll && (
              <EnrollMemberPanel
                initialTierId={enroll.tierId || null}
                onClose={() => setEnroll(null)}
                onEnrolled={(newId) => { setEnroll(null); notify('Member enrolled'); load(); if (newId) openMember(newId); }}
                onRenewExisting={(membershipId) => { setEnroll(null); openMember(membershipId); }}
              />
            )}
            {toastNode}
          </>
        );
      }}
    </ListPageShell>
  );
};

export default MembershipsPage;
