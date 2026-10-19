import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../../../contexts/AuthContext';
import { useBranch } from '../../../../contexts/BranchContext';
import { fetchPackages, fetchPackageTypes } from '../../../../services/api';
import { leadParts } from '../../../../services/packagesView';
import { nepalNow } from '../../../../utils/customerDirectory';
import { friendlyError } from '../../../../utils/friendlyError';
import { ListPageShell, useToast, useExportSlot, ExportButton, PrimaryButton, leadNodes } from '../Area/listKit';
import PackageListPanel from './PackageListPanel';
import PackageOverviewPanel from './PackageOverviewPanel';
import NewPackagePanel from './NewPackagePanel';

// Packages (V20): one header (title, lead sentence, Export + Sell package) over two counted tabs, Guest packages and Package types.
// Both tabs share one load (packages + every package type, hidden ones included) so the tab counts and the types tab's
// "N active / M sold" agree with the list. Everything is scoped to the selected branch; "All branches" shows them all.
const PackagesPage = ({ view, branchId, readOnly = false }) => {
  const { profile } = useAuth();
  const { isOverall } = useBranch();
  const role = profile?.role;
  const canExport = role === 'manager' || role === 'admin';

  const [packages, setPackages] = useState(null);
  const [types, setTypes] = useState(null);
  const [error, setError] = useState(null);
  const [today, setToday] = useState(() => nepalNow().today);
  const [sell, setSell] = useState(null); // { customer?, typeId? } while the Sell package panel is open
  const { notify, toastNode } = useToast();
  const { registerExport, runExport, exportReady } = useExportSlot();

  const load = useCallback(async () => {
    setError(null);
    const [pk, ty] = await Promise.all([fetchPackages(), fetchPackageTypes({ includeInactive: true })]);
    setToday(nepalNow().today);
    if (pk.error || ty.error) { setError(friendlyError(pk.error || ty.error, 'Failed to load packages.')); return; }
    setPackages(pk.data || []);
    setTypes(ty.data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const scoped = useMemo(() => (packages ? (isOverall ? packages : packages.filter((p) => p.branchId === branchId)) : null), [packages, isOverall, branchId]);
  const lead = view === 'packages'
    ? (scoped ? leadNodes(leadParts(scoped, today)) : ' ')
    : 'The packages you offer. Guests buy them up front and use the sessions over time.';
  const openSell = useCallback((prefill = {}) => setSell(prefill), []);

  return (
    <ListPageShell
      view={view}
      title="Packages"
      lead={lead}
      counts={{ packages: scoped?.length, 'package-overview': types?.length }}
      actions={(
        <>
          {canExport && <ExportButton onClick={runExport} disabled={!exportReady} />}
          {!readOnly && <PrimaryButton onClick={() => openSell()}>Sell package</PrimaryButton>}
        </>
      )}
    >
      {(stickyTop) => {
        const childProps = { packages: scoped, types, today, error, onRetry: load, onChanged: load, readOnly, isOverall, branchId, role, stickyTop, onSell: openSell, notify, registerExport };
        return (
          <>
            {view === 'packages' ? <PackageListPanel {...childProps} /> : <PackageOverviewPanel {...childProps} />}
            {!readOnly && sell && (
              <NewPackagePanel
                userRole={role}
                initialCustomer={sell.customer || null}
                initialPackageTypeId={sell.typeId || null}
                onClose={() => setSell(null)}
                onIssued={(issued) => { setSell(null); if (issued) notify('Package sold'); load(); }}
              />
            )}
            {toastNode}
          </>
        );
      }}
    </ListPageShell>
  );
};

export default PackagesPage;
