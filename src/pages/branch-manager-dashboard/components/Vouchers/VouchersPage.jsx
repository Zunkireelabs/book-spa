import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../../../contexts/AuthContext';
import { useOrg } from '../../../../contexts/OrgContext';
import { fetchVouchers, fetchVoucherTypes, fetchVoucherCustomerMatches, logVoucherReminder } from '../../../../services/api';
import { leadParts, reminderText, forPhone, buyerPhoneOf } from '../../../../services/vouchersView';
import { buildWhatsAppUrl } from '../../../../utils/checkoutReceipt';
import { nepalNow } from '../../../../utils/customerDirectory';
import { friendlyError } from '../../../../utils/friendlyError';
import { useAutoRefresh } from '../../../../hooks/useAutoRefresh';
import { ListPageShell, useToast, useExportSlot, ExportButton, PrimaryButton, leadNodes } from '../Area/listKit';
import VoucherListPanel from './VoucherListPanel';
import VoucherTypesPanel from './VoucherTypesPanel';
import VoucherActivityPanel from './VoucherActivityPanel';
import VoucherDetailPanel from './VoucherDetailPanel';
import NewVoucherPanel from './NewVoucherPanel';
import VoucherTypePanel from './VoucherTypePanel';

// Vouchers (V23): one header (title, lead sentence, Export + New voucher) over three tabs: Vouchers, Voucher types, Activity.
// Vouchers and types share one load (every voucher + every type, off-sale ones included) plus the "matches a customer" list.
// Vouchers belong to the org (any branch can redeem one), so every branch sees all of them. The voucher panel opens from any tab
// through `?open=<id>` (`&vv=extend|contact|claim|coupon` lands on a sub-view).
const VouchersPage = ({ view, branchId, readOnly = false }) => {
  const { profile } = useAuth();
  const { orgName } = useOrg();
  const { orgSlug } = useParams();
  const role = profile?.role;
  const isAdmin = role === 'admin';
  const canExport = role === 'manager' || role === 'admin';
  const [sp, setSp] = useSearchParams();

  const [vouchers, setVouchers] = useState(null);
  const [types, setTypes] = useState(null);
  const [matches, setMatches] = useState(() => new Map());
  const [error, setError] = useState(null);
  const [today, setToday] = useState(() => nepalNow().today);
  const [issue, setIssue] = useState(null); // { typeId?, kind? } while the New voucher panel is open
  const [typeEdit, setTypeEdit] = useState(null); // { type } (null type = new) while the type panel is open
  const [activityLead, setActivityLead] = useState(' ');
  const { notify, toastNode } = useToast();
  const { registerExport, runExport, exportReady } = useExportSlot();

  // Refreshes swap data in silently (no skeleton), so an open panel and the scroll position stay put.
  const load = useCallback(async () => {
    setError(null);
    const [vRes, tRes, mRes] = await Promise.all([fetchVouchers(), fetchVoucherTypes({ includeInactive: true }), fetchVoucherCustomerMatches()]);
    setToday(nepalNow().today);
    if (vRes.error || tRes.error) { setError(friendlyError(vRes.error || tRes.error, 'Failed to load vouchers.')); return; }
    setVouchers(vRes.data || []);
    setTypes(tRes.data || []);
    setMatches(mRes.data || new Map());
  }, []);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load, { intervalMs: 90000, enabled: view === 'vouchers' });

  const openId = sp.get('open') || null;
  const openView = sp.get('vv') || null;
  const openVoucher = useCallback((id, subView = null) => {
    const next = new URLSearchParams(sp);
    if (id) next.set('open', id); else next.delete('open');
    if (subView) next.set('vv', subView); else next.delete('vv');
    setSp(next, { replace: true });
  }, [sp, setSp]);

  // Reminders: one WhatsApp template for the For and the Bought by person; opening it is logged (the row then shows
  // "reminded …" and leaves Needs you now for 7 days).
  const bookUrl = orgSlug ? `${window.location.origin}/${orgSlug}/book` : '';
  const remindUrl = useCallback((v, to = 'for') => {
    if (readOnly || !v) return null;
    const phone = to === 'buyer' ? buyerPhoneOf(v) : forPhone(v);
    return phone ? buildWhatsAppUrl(phone, reminderText(v, { to, orgName, bookUrl })) : null;
  }, [readOnly, orgName, bookUrl]);
  const logReminder = useCallback(async (v, to = 'for') => {
    const { error: err } = await logVoucherReminder({ voucherId: v.id, note: to === 'buyer' ? `to ${v.buyerName || 'the buyer'}` : `to ${v.guestName}` });
    if (err) { notify(friendlyError(err, 'Could not save the reminder.'), 'error'); return; }
    load();
  }, [load, notify]);
  const remind = { url: remindUrl, log: logReminder };

  const lead = view === 'vouchers' ? (vouchers ? leadNodes(leadParts(vouchers, today)) : ' ')
    : view === 'voucher-types' ? 'What each voucher is worth, and whether you usually sell it or give it away.'
      : activityLead;

  return (
    <ListPageShell
      view={view}
      title="Vouchers"
      lead={lead}
      counts={{ vouchers: vouchers?.length, 'voucher-types': types?.length }}
      actions={(
        <>
          {canExport && <ExportButton onClick={runExport} disabled={!exportReady} />}
          {!readOnly && <PrimaryButton onClick={() => setIssue({})}>New voucher</PrimaryButton>}
        </>
      )}
    >
      {(stickyTop) => {
        const childProps = { vouchers, types, matches, today, error, onRetry: load, onChanged: load, readOnly, isAdmin, role, branchId, stickyTop, notify, registerExport, onOpen: openVoucher, openId, remind };
        return (
          <>
            {view === 'vouchers' && <VoucherListPanel {...childProps} />}
            {view === 'voucher-types' && (
              <VoucherTypesPanel {...childProps} onIssue={(typeId, kind) => setIssue({ typeId, kind })} onEditType={(type) => setTypeEdit({ type })} />
            )}
            {view === 'voucher-activity' && <VoucherActivityPanel {...childProps} onLead={setActivityLead} />}
            {openId && (
              <VoucherDetailPanel
                key={`${openId}:${openView || ''}`}
                voucherId={openId}
                initialView={openView}
                width="460px"
                readOnly={readOnly}
                match={matches.get(openId) || null}
                onClose={() => openVoucher(null)}
                onChanged={load}
              />
            )}
            {!readOnly && issue && (
              <NewVoucherPanel
                userRole={role}
                initialTypeId={issue.typeId || null}
                initialKind={issue.kind || null}
                onClose={() => setIssue(null)}
                onIssued={(v) => { setIssue(null); notify(v?.issue_kind === 'free' ? 'Voucher given' : 'Voucher sold'); load(); if (v?.id) openVoucher(v.id); }}
              />
            )}
            {isAdmin && !readOnly && typeEdit && (
              <VoucherTypePanel
                type={typeEdit.type}
                types={types || []}
                onClose={() => setTypeEdit(null)}
                onSaved={(saved, created) => { setTypeEdit(null); notify(created ? 'Voucher type created' : 'Voucher type saved'); load(); }}
              />
            )}
            {toastNode}
          </>
        );
      }}
    </ListPageShell>
  );
};

export default VouchersPage;
