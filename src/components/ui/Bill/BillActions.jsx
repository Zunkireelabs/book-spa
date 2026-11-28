// ZNLY-410 step 1: the ONE bill control — View · Print ▾ (A4 page / Receipt printer (80 mm)) — used on the checkout success screen, the booking
// panel and the profile Bills list, so the words are the same everywhere. Step 2: Send to ▾ (email only; WhatsApp joins in step 3).
import React, { useEffect, useRef, useState } from 'react';
import Icon from '../../AppIcon';
import SidePanel from '../SidePanel';
import InvoicePrintModal from '../InvoicePrintModal';
import { useBillOrg } from './useBillOrg';
import { useParams } from 'react-router-dom';
import { createPortal } from 'react-dom';
import ModalShell from '../ModalShell';
import Button from '../Button';
import { fetchBillUnit, fixBillNumber, fetchBillLink, turnOffBillLink, shareBill, fetchBillMessage, fetchBillSendInfo, sendCustomerMessage, updateCustomerContact } from '../../../services/api';
import { fillBillMessage } from '../../../utils/billMessage';
import { useOrg } from '../../../contexts/OrgContext';
import { useToast } from '../../../pages/branch-manager-dashboard/components/Area/listKit';
import { buildBill, billSource } from '../../../utils/buildBill';
import { Bill, BILL_CSS, printBill } from './Bill';
import { useMenuNav } from '../useMenuNav';

export const PRINT_CHOICES = [['a4', 'A4 page'], ['thermal', 'Receipt printer (80 mm)']];

const PrintMenu = ({ onPick, busy, up, className = '' }) => {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);
  const triggerRef = useRef(null);
  useMenuNav({ open, onClose: () => setOpen(false), menuRef, triggerRef });
  return (
    <span className="relative inline-block">
      <button ref={triggerRef} type="button" onClick={() => setOpen((o) => !o)} disabled={busy} aria-haspopup="menu" aria-expanded={open}
        className={`inline-flex items-center gap-1 h-8 px-2.5 rounded-spa border border-border text-xs font-medium text-text-primary hover:bg-background disabled:opacity-50 ${className}`}>
        <Icon name="Printer" size={13} />{busy ? 'Printing…' : 'Print'}<Icon name="ChevronDown" size={11} />
      </button>
      {open && (
        <div ref={menuRef} role="menu" aria-label="Print" className={`absolute right-0 z-dropdown min-w-[200px] bg-surface border border-border rounded-spa spa-shadow-modal py-1 ${up ? 'bottom-full mb-1' : 'top-full mt-1'}`}>
          {PRINT_CHOICES.map(([v, label]) => (
            <button key={v} type="button" role="menuitem" onClick={() => { setOpen(false); onPick(v); }} className="w-full text-left px-3 py-2 text-[13px] text-text-primary hover:bg-background focus:bg-background outline-none">{label}</button>
          ))}
        </div>
      )}
    </span>
  );
};

// ⋯ in the bill panel: only when a customer link exists (it is made the first time the bill is sent).
const LinkMenu = ({ token, onOff }) => {
  const { orgSlug } = useParams();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [sure, setSure] = useState(false);
  const menuRef = useRef(null);
  const triggerRef = useRef(null);
  useMenuNav({ open, onClose: () => setOpen(false), menuRef, triggerRef });
  const copy = async () => {
    setOpen(false);
    const url = `${window.location.origin}/${orgSlug}/bill/${token}`;
    try { await navigator.clipboard.writeText(url); setNote('Link copied'); setTimeout(() => setNote(''), 2500); } catch { setNote(url); } // no clipboard access: show the link to copy by hand
  };
  if (sure) {
    return (
      <span className="flex items-center gap-2 text-xs text-text-secondary mr-auto" data-link-off-confirm>
        Turn off the customer&apos;s link? It stops working.
        <button type="button" onClick={onOff} className="h-8 px-2.5 rounded-spa bg-error text-white font-medium">Turn off</button>
        <button type="button" onClick={() => setSure(false)} className="h-8 px-2.5 rounded-spa border border-border font-medium text-text-primary">Back</button>
      </span>
    );
  }
  return (
    <span className="relative mr-auto flex items-center gap-2">
      <button ref={triggerRef} type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label="More" className="h-8 w-8 inline-flex items-center justify-center rounded-spa border border-border hover:bg-background"><Icon name="MoreHorizontal" size={15} /></button>
      {note && <span className="text-xs text-text-secondary break-all max-w-[260px]" role="status">{note}</span>}
      {open && (
        <div ref={menuRef} role="menu" aria-label="Customer link" className="absolute left-0 bottom-full mb-1 z-dropdown min-w-[180px] bg-surface border border-border rounded-spa spa-shadow-modal py-1">
          <button type="button" role="menuitem" onClick={copy} className="w-full text-left px-3 py-2 text-[13px] text-text-primary hover:bg-background focus:bg-background outline-none">Copy link</button>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); setSure(true); }} className="w-full text-left px-3 py-2 text-[13px] text-text-primary hover:bg-background focus:bg-background outline-none">Turn off link</button>
        </div>
      )}
    </span>
  );
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const SEND_WORDS = { queued: 'Sending', approved: 'Sending', sending: 'Sending', sent: 'Sent', delivered: 'Sent', failed: 'Failed' };

// Asks for an address when the customer has none (bottom sheet on a phone), optionally saving it to the profile.
const EmailDialog = ({ onSend, onClose, busy, error }) => {
  const [email, setEmail] = useState('');
  const [save, setSave] = useState(true);
  const valid = EMAIL_RE.test(email.trim());
  return (
    <ModalShell onClose={onClose} className="max-w-sm max-sm:fixed max-sm:bottom-0 max-sm:left-0 max-sm:right-0 max-sm:max-w-none max-sm:rounded-b-none">
      <div className="p-5 space-y-3">
        <h2 className="font-heading font-heading-semibold text-base text-text-primary">Send the bill by email</h2>
        <label className="block text-[13px] text-text-secondary">This customer has no email yet. Type one:
          <input type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" className="mt-1 w-full h-10 px-3 rounded-spa border border-border text-sm text-text-primary bg-surface" />
        </label>
        <label className="flex items-center gap-2 text-[13px] text-text-primary"><input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />Save to profile</label>
        {error && <p role="alert" className="text-xs text-error">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSend(email.trim(), save)} disabled={!valid || busy}>{busy ? 'Sending…' : 'Send'}</Button>
        </div>
      </div>
    </ModalShell>
  );
};

// Loads and builds the bill (shared by the side panel and the in-dialog view).
function useBillDoc(bookingId, extraIds, withLink) {
  const { multi, billingOn, orgInfo } = useBillOrg();
  const [state, setState] = useState({ loading: true, bill: null, error: false });
  const [link, setLink] = useState(null);
  useEffect(() => {
    let alive = true;
    fetchBillUnit({ bookingId, multi, single: billingOn, extraIds }).then(async ({ data }) => {
      if (!alive) return;
      setState(data ? { loading: false, bill: buildBill(billSource(data, orgInfo)), error: false } : { loading: false, bill: null, error: true });
      if (data && withLink) { const l = await fetchBillLink(data.rows); if (alive) setLink(l.data); }
    });
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId]);
  return { state, link, setLink };
}

const BillDocBody = ({ state }) => (
  <>
    <style data-bill-panel>{BILL_CSS}</style>
    {state.loading && <p className="p-6 text-sm text-text-secondary">Preparing the bill…</p>}
    {state.error && <p className="p-6 text-sm text-text-secondary">Couldn&apos;t load this bill. Go back and try again.</p>}
    {state.bill && <div className="border border-border rounded-spa m-4 overflow-hidden text-left"><Bill bill={state.bill} layout="a4" /></div>}
  </>
);

/** The bill drawn inside a centred dialog (the checkout success screen swaps its body to this). */
export const BillInDialog = ({ bookingId, extraIds }) => <BillDocBody state={useBillDoc(bookingId, extraIds, false).state} />;

const BillPanel = ({ bookingId, extraIds, onClose, onPrint, busy }) => {
  const { state, link, setLink } = useBillDoc(bookingId, extraIds, true);
  const turnOff = async () => { const r = await turnOffBillLink(link.token); if (!r.error) setLink(null); };
  const { bill } = state;
  return (
    <SidePanel isOpen title={bill ? `${bill.title === 'Tax invoice' ? 'Tax invoice' : 'Bill'} ${bill.number}` : 'Bill'} onClose={onClose}
      width="min(560px, 100vw)"
      footer={<div className="flex items-center justify-end gap-2 w-full">{link && <LinkMenu token={link.token} onOff={turnOff} />}<PrintMenu onPick={onPrint} busy={busy} up /></div>}>
      <BillDocBody state={state} />
    </SidePanel>
  );
};

// onView: the host shows the bill itself (a centred dialog) instead of the side panel; hideView: the bill is already on screen.
const BillActions = ({ bookingId, extraIds, up = false, onView, hideView = false, className = '' }) => {
  const { multi, billingOn, orgInfo } = useBillOrg();
  const [viewing, setViewing] = useState(false);
  const [invoiceLayout, setInvoiceLayout] = useState(null); // set = the tax-invoice dialog is open (issue + Original/Copy logging stay exactly as before)
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { org } = useOrg();
  const orgSlug = org?.slug;
  const [sendMenu, setSendMenu] = useState(false);
  const [info, setInfo] = useState(null);   // { customerId, name, email, emailReady }
  const [askEmail, setAskEmail] = useState(false);
  const [sending, setSending] = useState(false);
  const [dialogError, setDialogError] = useState('');
  const { notify, toastNode } = useToast();
  const sendMenuRef = useRef(null);
  const sendTriggerRef = useRef(null);
  useMenuNav({ open: sendMenu, onClose: () => setSendMenu(false), menuRef: sendMenuRef, triggerRef: sendTriggerRef });

  const openSend = async () => {
    const next = !sendMenu;
    setSendMenu(next);
    if (!next) return;
    const { data } = await fetchBillSendInfo(bookingId, { multi, single: billingOn, extraIds });
    setInfo(data || { error: true });
  };

  const sendEmail = async (to, saveToProfile) => {
    setSending(true); setDialogError('');
    try {
      if (saveToProfile) {
        const { error: saveErr } = await updateCustomerContact(info.customerId, { email: to });
        if (saveErr) throw new Error('save');
      }
      const { data: shared, error: shareErr } = await shareBill(bookingId, extraIds || []);
      if (shareErr || !shared) throw new Error('share');
      const { data: msg, error: msgErr } = await fetchBillMessage('email');
      if (msgErr || !msg) throw new Error('message');
      const vars = { first_name: info.name.trim().split(/\s+/)[0] || '', business: orgInfo.name || '', bill_number: shared.billNumber };
      const url = `${window.location.origin}/${orgSlug}/bill/${shared.token}`;
      const html = `${esc(fillBillMessage(msg.body, vars)).replace(/\n/g, '<br>')}<p><a href="${url}">View bill</a></p>`;
      const { error: sendErr } = await sendCustomerMessage({ customerId: info.customerId, bookingId, channel: 'email', toAddress: to, subject: fillBillMessage(msg.subject, vars), body: html, dedupePrefix: `bill:${shared.billNumber}` });
      if (sendErr) throw new Error('send');
      setAskEmail(false);
      notify(`Bill sent to ${to} by email`);
      setInfo((i) => ({ ...i, last: { status: 'queued' } }));
    } catch (e) {
      const text = e.message === 'save' ? "Couldn't save the email to the profile. Try again." : "Couldn't send this bill. Try again.";
      setDialogError(text);
      notify(text, 'error');
    } finally { setSending(false); }
  };

  const pickEmail = () => {
    setSendMenu(false);
    setDialogError('');
    if (info?.email) sendEmail(info.email, false); else setAskEmail(true);
  };

  const print = async (layout) => {
    setError('');
    if (billingOn) { setInvoiceLayout(layout); return; }
    setBusy(true);
    try {
      const { data, error: err } = await fetchBillUnit({ bookingId, multi, extraIds });
      if (err || !data) throw err || new Error('load');
      if (data.invoice) { setInvoiceLayout(layout); return; } // billed before Billing was switched off: still the tax invoice
      // A checkout of several bookings is one bill: its number is the first booking number among them, fixed on that booking.
      const bundled = (extraIds || []).length > 0;
      const anchor = bundled ? [...data.rows].sort((a, b) => String(a.bookingNumber).localeCompare(String(b.bookingNumber)))[0].id : bookingId;
      const { data: number, error: numErr } = await fixBillNumber(anchor, bundled);
      if (numErr) throw numErr;
      const ok = await printBill(buildBill(billSource({ ...data, billNumber: number }, orgInfo)), layout);
      if (!ok) setError('The print window was blocked. Allow pop-ups for this site and try again.');
    } catch {
      setError("Couldn't print this bill. Try again.");
    } finally { setBusy(false); }
  };

  return (
    <span className={`inline-flex flex-wrap items-center gap-2 ${className}`} data-bill-actions>
      {!hideView && <button type="button" onClick={() => (onView ? onView() : setViewing(true))} className="inline-flex items-center gap-1 h-8 px-2.5 rounded-spa border border-border text-xs font-medium text-text-primary hover:bg-background"><Icon name="Eye" size={13} />View</button>}
      <span className="relative inline-block">
        <button ref={sendTriggerRef} type="button" onClick={openSend} disabled={sending} aria-haspopup="menu" aria-expanded={sendMenu}
          className="inline-flex items-center gap-1 h-8 px-2.5 rounded-spa border border-border text-xs font-medium text-text-primary hover:bg-background disabled:opacity-50">
          <Icon name="Send" size={13} />{sending ? 'Sending…' : 'Send to'}<Icon name="ChevronDown" size={11} />
        </button>
        {sendMenu && (
          <div ref={sendMenuRef} role="menu" aria-label="Send to" className={`absolute left-0 z-dropdown min-w-[240px] bg-surface border border-border rounded-spa spa-shadow-modal py-1 ${up ? 'bottom-full mb-1' : 'top-full mt-1'}`}>
            {!info && <p className="px-3 py-2 text-[13px] text-text-secondary">Checking…</p>}
            {info?.error && <p className="px-3 py-2 text-[13px] text-text-secondary">Couldn&apos;t check this customer. Close and try again.</p>}
            {info && !info.error && (info.emailReady === false
              ? <p role="menuitem" aria-disabled="true" className="px-3 py-2 text-[13px] text-text-secondary">Email isn&apos;t set up yet. Ask Zennly support.</p>
              : <button type="button" role="menuitem" onClick={pickEmail} className="w-full text-left px-3 py-2 text-[13px] text-text-primary hover:bg-background focus:bg-background outline-none">
                  Email{info.email ? ` · ${info.email}` : ''}
                  {info.last && SEND_WORDS[info.last.status] && <span className={`block text-[11px] ${info.last.status === 'failed' ? 'text-error' : 'text-text-secondary'}`}>{SEND_WORDS[info.last.status]}</span>}
                </button>)}
          </div>
        )}
      </span>
      <PrintMenu onPick={print} busy={busy} up={up} />
      {createPortal(toastNode, document.body)}
      {askEmail && <EmailDialog onSend={sendEmail} onClose={() => setAskEmail(false)} busy={sending} error={dialogError} />}
      {error && <span role="alert" className="basis-full text-xs text-error">{error}</span>}
      {viewing && <BillPanel bookingId={bookingId} extraIds={extraIds} onClose={() => setViewing(false)} onPrint={print} busy={busy} />}
      {invoiceLayout && <InvoicePrintModal bookingId={bookingId} initialLayout={invoiceLayout} onClose={() => setInvoiceLayout(null)} />}
    </span>
  );
};

export default BillActions;
