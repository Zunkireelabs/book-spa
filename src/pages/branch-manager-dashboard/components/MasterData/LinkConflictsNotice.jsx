import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../../../contexts/AuthContext';
import { useIndustry } from '../../../../hooks/useIndustry';
import { fetchLinkConflicts, resolveLinkConflict } from '../../../../services/api';
import { friendlyError } from '../../../../utils/friendlyError';
import { conflictSentence, canLinkNow } from '../../../../services/staffAccessRules';

// "Link needs review" (board B1.4 #3): admins only, shown at the top of the team member list while migration 377 left logins it could not
// link on its own. One plain sentence per row; "Link to <name>" does what the row suggested, "Keep as is" settles it without changing anything.
const LinkConflictsNotice = () => {
  const { profile } = useAuth();
  const { staffLabel } = useIndustry();
  const isAdmin = profile?.role === 'admin';
  const [rows, setRows] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [errors, setErrors] = useState({});

  const load = useCallback(async () => {
    const { data } = await fetchLinkConflicts();
    setRows(data || []);
  }, []);
  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  if (!isAdmin || rows.length === 0) return null;

  const settle = async (row, action) => {
    setBusyId(row.id);
    setErrors((e) => ({ ...e, [row.id]: null }));
    const res = await resolveLinkConflict({ id: row.id, action });
    setBusyId(null);
    if (res.error) { setErrors((e) => ({ ...e, [row.id]: friendlyError(res.error, 'Couldn\'t save. Try again.') })); return; }
    load();
  };

  const btn = 'h-[34px] px-3 rounded-md border border-[#E6C766] bg-white text-[13px] font-medium text-[#6B3A04] hover:bg-[#FFFBEB] disabled:opacity-60';
  return (
    <div className="mb-4 space-y-2.5" data-link-conflicts>
      {rows.map((r) => (
        <section key={r.id} className="bg-[#FEF3C7] border border-[#F3D78A] rounded-xl p-3.5 space-y-2" data-link-conflict={r.reason}>
          <b className="block text-[13px] text-[#6B3A04]">This login could not be linked automatically</b>
          <p className="text-[12.5px] text-[#6B3A04] leading-relaxed">{conflictSentence(r, staffLabel)}</p>
          <div className="flex gap-2 flex-wrap">
            {canLinkNow(r) && <button type="button" className={btn} disabled={busyId === r.id} onClick={() => settle(r, 'link')}>Link to {r.therapistName}</button>}
            <button type="button" className={btn} disabled={busyId === r.id} onClick={() => settle(r, 'keep')}>Keep as is</button>
          </div>
          {errors[r.id] && <p className="text-[12px] text-error">{errors[r.id]}</p>}
        </section>
      ))}
    </div>
  );
};

export default LinkConflictsNotice;
