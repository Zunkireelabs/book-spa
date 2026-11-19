import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../../../contexts/AuthContext';
import { useBranch } from '../../../../contexts/BranchContext';
import { useIndustry } from '../../../../hooks/useIndustry';
import { useAutoRefresh } from '../../../../hooks/useAutoRefresh';
import { fetchTherapistsOverview, fetchAllBranches, fetchStaffTransfers } from '../../../../services/api';
import { nepalNow } from '../../../../utils/customerDirectory';
import { friendlyError } from '../../../../utils/friendlyError';
import { ListPageShell, useToast, useExportSlot, ExportButton, PrimaryButton, leadNodes } from '../Area/listKit';
import TherapistManagementPanel from './TherapistManagementPanel';
import LinkConflictsNotice from './LinkConflictsNotice';
import TherapistPositionsPanel from './TherapistPositionsPanel';
import TherapistTransferLogPanel from './TherapistTransferLogPanel';
import RosterPanel from './RosterPanel';
import { wordBranch, wordBranches } from '../../../../utils/industryTerms';

const positionParts = (p) => (p ? p.split('/').map((x) => x.trim()).filter(Boolean) : []);
const LIST_VIEWS = ['therapists', 'therapists-inactive'];

// Therapists (V28): one header (title, lead sentence, Export, Add) over Active · Inactive · Positions · Transfer log · Roster. One batched
// load (fetchTherapistsOverview) feeds the lists, the Today strip and the peek; Positions, Transfer log and Roster are the existing panels,
// now shown as tabs. A person opens in the right-hand peek through `?open=<id>`.
const TherapistsPage = ({ view }) => {
  const { profile } = useAuth();
  const { branchId, branchName, isOverall } = useBranch();
  const { staffLabel, staffLabelPlural } = useIndustry();
  const navigate = useNavigate();
  const { orgSlug } = useParams();
  const [sp, setSp] = useSearchParams();
  const role = profile?.role;
  const canManage = role === 'manager' || role === 'admin';
  const canSeeRates = role === 'admin' || role === 'admin_viewer'; // pay follows Payroll: admin + admin_viewer only
  const [ov, setOv] = useState(null);
  const [error, setError] = useState(null);
  const [now, setNow] = useState(() => nepalNow());
  const [branches, setBranches] = useState([]);
  const [customPositions, setCustomPositions] = useState([]);
  const [transfers, setTransfers] = useState(null); // null while loading
  const { notify, toastNode } = useToast();
  const { registerExport, runExport, exportReady } = useExportSlot();
  const isList = LIST_VIEWS.includes(view);

  const load = useCallback(async () => {
    const t = nepalNow();
    const { data, error: err } = await fetchTherapistsOverview(branchId, t.today);
    setNow(t);
    if (err) { setError(friendlyError(err, `Could not load ${staffLabelPlural.toLowerCase()}.`)); return; }
    setError(null);
    setOv(data);
  }, [branchId, staffLabelPlural]);
  useEffect(() => { setOv(null); load(); }, [load]);
  useAutoRefresh(load, { intervalMs: 60000, enabled: isList });
  useEffect(() => { fetchAllBranches().then(({ data }) => setBranches(data || [])); }, []);
  useEffect(() => {
    if (view !== 'therapists-transfers') return;
    setTransfers(null);
    fetchStaffTransfers().then(({ data }) => setTransfers(data || []));
  }, [view]);

  const branchNameById = useMemo(() => Object.fromEntries(branches.map((b) => [b.id, b.name])), [branches]);
  const openId = sp.get('open') || null;
  const setOpen = useCallback((id) => {
    const next = new URLSearchParams(sp);
    if (id) next.set('open', id); else next.delete('open');
    setSp(next, { replace: true });
  }, [sp, setSp]);

  const all = ov?.therapists || [];
  const activeList = all.filter((t) => t.isActive);
  const inactiveCount = all.length - activeList.length;
  const positionCount = useMemo(() => new Set(all.flatMap((t) => positionParts(t.position)).concat(customPositions)).size, [all, customPositions]);

  const lead = useMemo(() => {
    if (!ov) return ' ';
    const service = activeList.filter((t) => t.isServiceStaff);
    const working = service.filter((t) => ['checked-in', 'not-checked-in', 'upcoming'].includes(t.status.key));
    const checkedIn = service.filter((t) => t.status.key === 'checked-in').length;
    const where = isOverall ? `across ${branches.length} ${branches.length === 1 ? wordBranch() : wordBranches()}` : `at ${branchName || `this ${wordBranch()}`}`;
    const parts = [{ strong: String(activeList.length) }, { text: ` ${(activeList.length === 1 ? staffLabel : staffLabelPlural).toLowerCase()} ${where}` }];
    const visiting = (ov.visitors || []).length;
    if (visiting > 0 && !isOverall) parts.push({ text: ' · ' }, { strong: String(visiting) }, { text: ' visiting' });
    if (working.length > 0 || checkedIn > 0) parts.push({ text: ' · ' }, { strong: String(working.length) }, { text: ' working today, ' }, { strong: String(checkedIn) }, { text: ' checked in' });
    parts.push({ text: ' · ' }, { strong: String(ov.bookingsToday) }, { text: ` booking${ov.bookingsToday === 1 ? '' : 's'} on the calendar` });
    return leadNodes(parts);
  }, [ov, activeList, isOverall, branches.length, branchName, staffLabel, staffLabelPlural]);

  const header = (
    <>
      {isList && <ExportButton onClick={runExport} disabled={!exportReady} />}
      {canManage && <PrimaryButton onClick={() => navigate(`/${orgSlug}/staff/new`)} data-add-therapist>{`Add ${staffLabel.toLowerCase()}`}</PrimaryButton>}
    </>
  );

  return (
    <ListPageShell view={view} title={staffLabelPlural} lead={lead} actions={header}
      counts={{ therapists: ov ? activeList.length : undefined, 'therapists-inactive': ov ? inactiveCount : undefined, 'therapists-positions': ov ? positionCount : undefined }}>
      {(stickyTop) => (
        <>
          {isList && <LinkConflictsNotice />}
          {isList && (
            <TherapistManagementPanel key={view} tab={view === 'therapists' ? 'active' : 'inactive'} ov={ov} error={error} onRetry={load} canManage={canManage} canSeeRates={canSeeRates}
              isOverall={isOverall} branchName={branchName} branchNameById={branchNameById} today={now.today} nowTime={now.hm} stickyTop={stickyTop} registerExport={registerExport}
              onChanged={load} notify={notify} openId={openId} onOpen={setOpen} onCloseOpen={() => setOpen(null)} customPositions={customPositions} />
          )}
          {view === 'therapists-positions' && (ov
            ? <TherapistPositionsPanel inline therapists={all} customPositions={customPositions} onCustomChange={setCustomPositions} onReload={load} staffLabel={staffLabel} staffLabelPlural={staffLabelPlural} />
            : <div className="h-40 mt-4 rounded bg-[#F1F1EF] animate-pulse" />)}
          {view === 'therapists-transfers' && <TherapistTransferLogPanel inline log={transfers} staffLabel={staffLabel} />}
          {view === 'roster' && <RosterPanel branchId={branchId} />}
          {toastNode}
        </>
      )}
    </ListPageShell>
  );
};

export default TherapistsPage;
