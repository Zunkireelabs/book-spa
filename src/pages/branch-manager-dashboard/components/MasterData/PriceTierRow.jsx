import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../../../contexts/AuthContext';
import CustomSelect from '../../../../components/ui/CustomSelect';
import { fetchPriceTiers, fetchTherapistsForTierAssignment, assignTherapistTier } from '../../../../services/api';
import { friendlyError } from '../../../../utils/friendlyError';

// B2.2 #7: the "Price tier" row on the team member panel. Admins and managers only; the same single value as Settings -> Price Tiers
// (the team member's tier), written by the existing assignTherapistTier. Hidden while the business has no tiers: there is nothing to pick.
const NONE = '__none__';

const PriceTierRow = ({ therapistId }) => {
  const { profile } = useAuth();
  const canEdit = ['manager', 'admin'].includes(profile?.role);
  const [state, setState] = useState({ status: 'loading', tiers: [], tierId: null });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const [tiers, staff] = await Promise.all([fetchPriceTiers(), fetchTherapistsForTierAssignment()]);
    if (tiers.error || staff.error) { setState({ status: 'error', tiers: [], tierId: null }); return; }
    const me = (staff.data || []).find((x) => x.id === therapistId);
    setState({ status: 'ready', tiers: tiers.data || [], tierId: me?.price_tier_id || null });
  }, [therapistId]);
  useEffect(() => { setState({ status: 'loading', tiers: [], tierId: null }); setError(null); load(); }, [load]);

  if (!canEdit || state.status !== 'ready' || state.tiers.length === 0) return null;

  const change = async (value) => {
    const next = value === NONE ? null : value;
    if (next === state.tierId) return;
    setSaving(true); setError(null);
    const res = await assignTherapistTier({ therapistId, tierId: next });
    setSaving(false);
    if (res.error) { setError(friendlyError(res.error, "Couldn't change the price tier. Nothing was changed.")); return; }
    setState((s) => ({ ...s, tierId: next }));
  };

  return (
    <section data-price-tier-row>
      <div className="flex items-center gap-3 text-[13px] text-[#515152]">
        <span className="flex-1">Price tier</span>
        <div className="w-[170px]">
          <CustomSelect
            value={state.tierId || NONE}
            onChange={change}
            disabled={saving}
            size="sm"
            options={[{ value: NONE, label: 'No tier' }, ...state.tiers.map((t) => ({ value: t.id, label: t.name }))]}
          />
        </div>
      </div>
      {error && <p role="alert" className="mt-1.5 text-[12px] text-error">{error}</p>}
      <p className="mt-1 text-[12px] text-[#8A8A90]">Sets what a service with tier prices costs when this person does it. Appointments already booked keep their price.</p>
    </section>
  );
};

export default PriceTierRow;
