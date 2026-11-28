import React, { useCallback, useEffect, useRef, useState } from 'react';
import { friendlyError } from '../../../../utils/friendlyError';
import { BILL_PLACEHOLDERS } from '../../../../utils/billMessage';
import { fetchBillMessages, saveBillMessage } from '../../../../services/api';

const FIELD = 'w-full px-3 py-2 text-sm border border-border rounded-spa bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary';

// One channel's wording: a box plus chips that drop {placeholder} at the cursor. Saved on its own.
function ChannelEditor({ channel, title, initial, note, onSaved }) {
  const [subject, setSubject] = useState(initial.subject || '');
  const [body, setBody] = useState(initial.body || '');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null); // { ok, text }
  const bodyRef = useRef(null);
  const dirty = body !== (initial.body || '') || (channel === 'email' && subject !== (initial.subject || ''));

  const insert = (key) => {
    const el = bodyRef.current;
    const at = el ? [el.selectionStart, el.selectionEnd] : [body.length, body.length];
    const token = `{${key}}`;
    setBody(body.slice(0, at[0]) + token + body.slice(at[1]));
    setMsg(null);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at[0] + token.length, at[0] + token.length); });
  };

  const save = async () => {
    setSaving(true); setMsg(null);
    const { error } = await saveBillMessage(channel, { subject, body });
    setSaving(false);
    if (error) { setMsg({ ok: false, text: error.code === 'VALIDATION' ? error.message : friendlyError(error, 'Could not save the message.') }); return; }
    setMsg({ ok: true, text: 'Saved.' });
    onSaved();
  };

  return (
    <div className="rounded-spa border border-border p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="font-body font-body-medium text-sm text-text-primary">{title}</span>
        {note}
      </div>
      {channel === 'email' && (
        <>
          <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Subject</label>
          <input value={subject} onChange={(e) => { setSubject(e.target.value); setMsg(null); }} className={`${FIELD} h-10 mb-3`} />
        </>
      )}
      <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Message</label>
      <textarea ref={bodyRef} rows={4} value={body} onChange={(e) => { setBody(e.target.value); setMsg(null); }} className={FIELD} />
      <div className="mt-2 flex flex-wrap items-center gap-1.5 font-caption text-xs text-text-secondary">
        <span>Insert:</span>
        {BILL_PLACEHOLDERS.map((p) => (
          <button key={p.key} type="button" onClick={() => insert(p.key)} className="h-7 px-2 rounded-spa border border-border bg-surface hover:bg-background spa-transition-fast">{p.label}</button>
        ))}
      </div>
      <p className="font-caption text-xs text-text-tertiary mt-1.5">The <b>View bill</b> button is always added. No amounts are ever put in the message.</p>
      {msg && <p className={`font-body text-xs mt-2 ${msg.ok ? 'text-success' : 'text-error'}`}>{msg.text}</p>}
      <div className="mt-3 flex justify-end">
        <button type="button" onClick={save} disabled={saving || !dirty} className="inline-flex items-center px-3 py-1.5 rounded-spa bg-primary text-white text-xs font-body font-body-medium hover:bg-primary/90 disabled:opacity-50 spa-transition-fast">
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

// The "Bill" card in Outreach → Rules (mockup scene 10). Admin/manager edit; the wording is used by Send to ▾ on a bill.
const BillMessageCard = () => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [version, setVersion] = useState(0);

  const load = useCallback(async () => {
    const res = await fetchBillMessages();
    if (res.error) { setError(friendlyError(res.error, 'Could not load the bill message.')); return; }
    setError(null); setData(res.data); setVersion((v) => v + 1);
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="bg-surface rounded-spa-lg border border-border p-4">
      <h4 className="font-body font-body-semibold text-sm text-text-primary">Bill</h4>
      <p className="font-caption text-xs text-text-tertiary mt-0.5 mb-3">The message that goes with a bill when staff press Send to.</p>
      {error && <p className="font-body text-xs text-error">{error} <button type="button" onClick={load} className="underline">Retry</button></p>}
      {!data && !error && <div className="h-24 bg-background rounded animate-pulse" />}
      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3" key={version}>
          <ChannelEditor channel="email" title="Email" initial={data.email} onSaved={load}
            note={<span className="font-caption text-xs text-text-tertiary">Applies at once</span>} />
          <ChannelEditor channel="whatsapp" title="WhatsApp" initial={data.whatsapp} onSaved={load}
            note={<span className="font-caption text-xs text-text-tertiary">● Not sent to Meta yet</span>} />
        </div>
      )}
      <div className="mt-3 pt-3 border-t border-border flex items-center justify-between gap-2 font-caption text-xs text-text-tertiary">
        <span>Send automatically when a visit is fully paid</span>
        <span className="px-2 py-0.5 rounded-full bg-background border border-border">Later</span>
      </div>
    </div>
  );
};

export default BillMessageCard;
