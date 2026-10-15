import React, { useEffect } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../../../contexts/AuthContext';
import CustomersList from './CustomersList';
import DuplicateCustomersPanel from './DuplicateCustomersPanel';
import ManualMergeCustomersPanel from './ManualMergeCustomersPanel';

// Customers: the list (V11), plus "possible duplicates" / "manual merge" reached from the list's duplicates link
// (`?view=customers&segment=duplicates[&dup=manual]`).
const CustomersPanel = ({ branchId, readOnly = false }) => {
  const navigate = useNavigate();
  const { orgSlug } = useParams();
  const { profile } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  // `?view=customers&customer=<id>` (from the command palette) opens that customer's detail page.
  const customerParam = searchParams.get('customer');
  useEffect(() => {
    if (customerParam) navigate(`/${orgSlug}/customers/${customerParam}`, { replace: true });
  }, [customerParam, orgSlug, navigate]);

  const showDuplicates = searchParams.get('segment') === 'duplicates';
  const dup = searchParams.get('dup') === 'manual' ? 'manual' : 'candidates';
  const setView = (patch) => { const next = new URLSearchParams(searchParams); Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k))); setSearchParams(next); };

  if (showDuplicates) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-1 border-b border-border">
          <button onClick={() => setView({ segment: '', dup: '' })} className="px-3 py-2 font-body font-body-medium text-sm text-text-secondary hover:text-text-primary border-b-2 border-transparent -mb-px">← Customers</button>
          {[{ key: 'candidates', label: 'Potential Duplicates' }, { key: 'manual', label: 'Manual Merge' }].map((t) => (
            <button
              key={t.key}
              onClick={() => setView({ dup: t.key === 'manual' ? 'manual' : '' })}
              className={`px-3 py-2 font-body font-body-medium text-sm spa-transition-fast border-b-2 -mb-px ${dup === t.key ? 'border-primary text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {dup === 'manual'
          ? <ManualMergeCustomersPanel branchId={profile?.branch_id || branchId} isOverall={readOnly} />
          : <DuplicateCustomersPanel orgId={profile?.org_id} role={profile?.role} branchId={profile?.branch_id} />}
      </div>
    );
  }

  return <CustomersList branchId={branchId} readOnly={readOnly} onShowDuplicates={() => setView({ segment: 'duplicates', page: '' })} />;
};

export default CustomersPanel;
