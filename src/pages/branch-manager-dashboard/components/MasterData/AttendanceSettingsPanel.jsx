import React, { useEffect, useState } from 'react';
import { fetchAttendanceSettings, setAttendanceSettings } from '../../../../services/api';

// Settings → Attendance (per branch): the two numbers the Attendance page and payroll guard read. Defaults work with no setup.
const AttendanceSettingsPanel = ({ branchId }) => {
  const [grace, setGrace] = useState('10');
  const [hours, setHours] = useState('4');
  const [expect, setExpect] = useState(false);
  const [saved, setSaved] = useState({ lateGraceMinutes: 10, openCheckoutHours: 4, expectCheckIn: false });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    if (!branchId) return;
    let cancelled = false;
    fetchAttendanceSettings(branchId).then(({ data }) => {
      if (cancelled || !data) return;
      setSaved(data); setGrace(String(data.lateGraceMinutes)); setHours(String(data.openCheckoutHours)); setExpect(!!data.expectCheckIn); setLoading(false);
    });
    return () => { cancelled = true; };
  }, [branchId]);

  const g = Number(grace); const h = Number(hours);
  const valid = Number.isInteger(g) && g >= 0 && g <= 120 && Number.isInteger(h) && h >= 1 && h <= 24;
  const dirty = g !== saved.lateGraceMinutes || h !== saved.openCheckoutHours || expect !== !!saved.expectCheckIn;

  const save = async () => {
    setSaving(true); setMsg(null);
    const { error } = await setAttendanceSettings({ branchId, lateGraceMinutes: g, openCheckoutHours: h, expectCheckIn: expect });
    setSaving(false);
    if (error) { setMsg({ type: 'error', text: error.message || 'Could not save.' }); return; }
    setSaved({ lateGraceMinutes: g, openCheckoutHours: h, expectCheckIn: expect });
    setMsg({ type: 'ok', text: 'Saved.' });
  };

  const box = 'w-[88px] h-9 px-3 border border-border rounded-spa text-[13px] font-data text-right bg-surface focus:outline-none focus:ring-2 focus:ring-primary/30';
  return (
    <div className="max-w-xl" data-testid="attendance-settings">
      <div className="border border-border rounded-spa-lg divide-y divide-border bg-surface">
        <div className="flex items-center gap-4 p-4">
          <div className="flex-1"><span id="att-expect-label" className="text-[13px] font-medium text-text-primary">Expect a check-in from everyone</span>
            <p className="text-[12px] text-text-secondary mt-0.5">Turn on when staff check in daily or a fingerprint machine is connected. Off: scheduled people count as present unless marked otherwise.</p>
            <p className="text-[12px] text-text-secondary mt-1">With the switch on, no check-in after the grace period shows as No show. No one is marked absent automatically.</p></div>
          <button type="button" role="switch" aria-checked={expect} aria-labelledby="att-expect-label" disabled={loading} onClick={() => setExpect((v) => !v)}
            className={`relative inline-flex w-[38px] h-[22px] rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-60 ${expect ? 'bg-primary' : 'bg-[#D6D3D1]'}`}>
            <span className={`absolute top-[3px] w-[16px] h-[16px] rounded-full bg-white shadow-sm transition-all ${expect ? 'left-[19px]' : 'left-[3px]'}`} />
          </button>
        </div>
        <div className="flex items-center gap-4 p-4">
          <div className="flex-1"><label htmlFor="att-grace" className="text-[13px] font-medium text-text-primary">Grace before "late"</label>
            <p className="text-[12px] text-text-secondary mt-0.5">A check-in after the shift start is "late" only after this many minutes.</p></div>
          <div className="flex items-center gap-2"><input id="att-grace" type="number" min={0} max={120} value={grace} disabled={loading} onChange={(e) => setGrace(e.target.value)} className={box} /><span className="text-[13px] text-text-secondary">min</span></div>
        </div>
        <div className="flex items-center gap-4 p-4">
          <div className="flex-1"><label htmlFor="att-open" className="text-[13px] font-medium text-text-primary">Open check-out flagged after shift end +</label>
            <p className="text-[12px] text-text-secondary mt-0.5">A check-in with no check-out becomes "No check-out" (Needs attention) this many hours after the shift ends.</p></div>
          <div className="flex items-center gap-2"><input id="att-open" type="number" min={1} max={24} value={hours} disabled={loading} onChange={(e) => setHours(e.target.value)} className={box} /><span className="text-[13px] text-text-secondary">h</span></div>
        </div>
      </div>
      <div className="flex items-center gap-3 mt-4">
        <button type="button" onClick={save} disabled={!valid || !dirty || saving || loading} className="h-9 px-5 rounded-spa bg-primary text-white text-[13px] font-medium disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
        {!valid && <span className="text-[12px] text-error">Grace is 0–120 minutes; hours are 1–24.</span>}
        {msg && <span className={`text-[12px] ${msg.type === 'error' ? 'text-error' : 'text-text-secondary'}`}>{msg.text}</span>}
      </div>
      <p className="text-[12px] text-text-tertiary mt-3">Defaults: 10 minutes and 4 hours. Defaults work with no setup.</p>
    </div>
  );
};
export default AttendanceSettingsPanel;
