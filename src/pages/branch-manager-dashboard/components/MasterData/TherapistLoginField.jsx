import React, { useCallback, useEffect, useState } from 'react';
import CustomSelect from '../../../../components/ui/CustomSelect';
import { fetchOrgLogins, setUserTherapist } from '../../../../services/api';
import { friendlyError } from '../../../../utils/friendlyError';

const SECTION = 'text-[11.5px] font-medium uppercase tracking-[.05em] text-[#8A8A90]';

// Which login is this person (ZNLY-150)? Their "My day" and tips follow the link. One login per person, so changing it
// unlinks the old login first (set_user_therapist enforces manager/admin and same org on the server).
const TherapistLoginField = ({ therapistId, personName }) => {
  const [logins, setLogins] = useState(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const load = useCallback(async () => {
    const { data, error } = await fetchOrgLogins();
    setFailed(!!error);
    if (!error) setLogins(data);
  }, []);
  useEffect(() => { load(); }, [load, therapistId]);

  const linked = (logins || []).find((l) => l.therapist_id === therapistId) || null;
  const options = [
    { value: '', label: 'None' },
    ...(logins || []).filter((l) => !l.therapist_id || l.id === linked?.id).map((l) => ({ value: l.id, label: `${l.full_name || l.email}${l.full_name ? ` · ${l.email}` : ''}` })),
  ];

  const change = async (userId) => {
    if ((linked?.id || '') === userId) return;
    setBusy(true);
    setMessage(null);
    let res = { error: null };
    if (linked) res = await setUserTherapist({ userId: linked.id, therapistId: null });
    if (!res.error && userId) res = await setUserTherapist({ userId, therapistId });
    setBusy(false);
    if (res.error) setMessage(friendlyError(res.error, 'Could not change the login.'));
    await load();
  };

  return (
    <section data-peek-login>
      <h3 className={`${SECTION} mb-2`}>Login</h3>
      {failed && !logins ? (
        <p className="text-[13px] text-error">Couldn't load logins. <button type="button" onClick={load} className="underline font-medium">Retry</button></p>
      ) : (
        <>
          <CustomSelect value={linked?.id || ''} onChange={change} options={options} disabled={!logins || busy} searchable placeholder="Loading…" />
          <p className="text-[12px] text-[#8A8A90] mt-1.5">
            {linked ? `${personName} sees their own day and tips when ${linked.full_name || linked.email} signs in.` : 'Link the sign-in this person uses so they see their own day and tips.'}
          </p>
          {message && <p className="text-[12px] text-error mt-1">{message}</p>}
        </>
      )}
    </section>
  );
};

export default TherapistLoginField;
