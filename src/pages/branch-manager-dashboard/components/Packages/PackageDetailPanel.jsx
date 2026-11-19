import { friendlyError } from '../../../../utils/friendlyError';
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Icon from '../../../../components/AppIcon';
import CustomerContactQuickEdit from '../../../../components/ui/CustomerContactQuickEdit';
import ValueCorrectionView from '../../../../components/ui/ValueCorrectionView';
import { PanelShell, OverflowMenu } from '../../../../components/ui/PanelFormKit';
import { fetchPackage, fetchPackageRedemptions, adminCorrectPackageSessions } from '../../../../services/api';
import { useAuth } from '../../../../contexts/AuthContext';
import { useOrg } from '../../../../contexts/OrgContext';
import { displayStatus, isLive, valuePerSession, shortName, daysUntil, ENDS_SOON_DAYS } from '../../../../services/packagesView';
import { buildWhatsAppUrl } from '../../../../utils/checkoutReceipt';
import { nepalNow } from '../../../../utils/customerDirectory';
import { Avatar, StatusPill, longDate, shortDate, tileDate, timeLeft, npr, phoneOf, phoneLabel } from './packageBits';

const SECTION = 'text-[11.5px] text-[#8A8A90] font-medium uppercase tracking-[.05em] mb-2 flex items-baseline justify-between gap-3';

// Package detail in the right-hand panel (V20): who holds it, how many sessions are left (one box per session), the sessions used
// so far, and the payment. Session redemptions run through redeem_package_session() at checkout, so nothing here records usage;
// the admin-only "Correct sessions" sub-view stays in the ⋯ menu.
const PackageDetailPanel = ({ packageId, today: todayProp, readOnly = false, canBook = false, onBook, width = '460px', onClose, onChanged }) => {
  const { orgSlug } = useParams();
  const { profile } = useAuth();
  const { orgName } = useOrg();
  const isAdmin = profile?.role === 'admin';
  const today = todayProp || nepalNow().today;
  const [pkg, setPkg] = useState(null);
  const [redemptions, setRedemptions] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [view, setView] = useState('detail'); // detail | correct
  const [notice, setNotice] = useState('');

  const loadData = useCallback(async () => {
    setLoadError(null);
    const [packageRes, redemptionsRes] = await Promise.all([fetchPackage(packageId), fetchPackageRedemptions(packageId)]);
    if (packageRes.error) { setLoadError(friendlyError(packageRes.error, 'Failed to load package.')); return; }
    setPkg(packageRes.data);
    setRedemptions(redemptionsRes.data || []);
  }, [packageId]);
  useEffect(() => { setPkg(null); setView('detail'); loadData(); }, [loadData]);
  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  if (pkg && isAdmin && !readOnly && view === 'correct') {
    return (
      <ValueCorrectionView width={width}
        title="Correct sessions" label="Total sessions on this package" currentLabel={`${pkg.sessionsTotal} total, ${pkg.sessionsUsed} used`} kind="integer"
        warning="Sessions remaining is calculated as total minus redemptions, so this corrects the total. It cannot be set below the number already redeemed; void the incorrect redemption first."
        blocked={(v) => (v < pkg.sessionsUsed ? `Can't be below the ${pkg.sessionsUsed} already redeemed.` : null)}
        afterRows={(v) => [['Total sessions', `${pkg.sessionsTotal} → ${v}`], ['Remaining', `${pkg.sessionsRemaining} → ${v - pkg.sessionsUsed}`, v < pkg.sessionsUsed ? 'error' : 'total']]}
        onSubmit={({ value, reason }) => adminCorrectPackageSessions({ packageId, newSessionsTotal: value, reason })}
        onBack={() => setView('detail')} onClose={onClose}
        onDone={() => { setView('detail'); setNotice('Sessions corrected.'); loadData(); onChanged?.(); }}
      />
    );
  }

  const status = pkg ? displayStatus(pkg, today) : null;
  const live = pkg ? isLive(pkg, today) : false;
  const phone = pkg ? phoneOf(pkg) : '';
  const firstName = pkg ? String(pkg.guestName || '').trim().split(/\s+/)[0] : '';
  const messageUrl = pkg && !readOnly ? buildWhatsAppUrl(phone, `Hi ${firstName}, this is ${orgName || 'our team'} about your ${pkg.packageTypeName} package: ${pkg.sessionsRemaining} of ${pkg.sessionsTotal} sessions left, valid until ${longDate(pkg.expiryDate)}.`) : null;
  const profileUrl = pkg?.customerId ? `/${orgSlug}/customers/${pkg.customerId}` : null;
  const overflow = pkg && isAdmin && !readOnly ? [{ key: 'correct', label: 'Correct sessions', icon: 'Pencil', run: () => setView('correct') }] : [];

  // Session boxes in the order they were used (redemptions arrive newest first).
  const usedAsc = [...redemptions].sort((a, b) => String(a.redeemed_date).localeCompare(String(b.redeemed_date)) || String(a.created_at).localeCompare(String(b.created_at)));
  const total = pkg ? Number(pkg.sessionsTotal) || 0 : 0;
  const used = pkg ? Math.min(total, Number(pkg.sessionsUsed) || 0) : 0;
  const cols = total <= 6 ? Math.max(total, 1) : Math.ceil(total / 2);
  const d = pkg ? daysUntil(pkg.expiryDate, today) : null;
  const warn = live && d != null && d <= ENDS_SOON_DAYS;
  const perSession = pkg ? valuePerSession(pkg) : null;
  const price = pkg ? (pkg.baseAmount ?? pkg.finalAmount ?? pkg.paidAmount) : 0;

  return (
    <PanelShell width={width} variant="panel" title="Package" onClose={onClose} hideFooter headerExtra={overflow.length ? <OverflowMenu items={overflow} /> : null}>
      {!pkg && !loadError && (
        <div className="px-5 py-5 space-y-3" aria-busy="true" aria-label="Loading package">
          <div className="flex items-center gap-3.5"><div className="w-11 h-11 rounded-full bg-[#F1F1EF] animate-pulse" /><div className="h-5 w-40 rounded bg-[#F1F1EF] animate-pulse" /></div>
          {[0, 1, 2].map((i) => <div key={i} className="h-16 rounded-lg bg-[#F1F1EF] animate-pulse" />)}
        </div>
      )}
      {loadError && (
        <div className="px-5 py-5">
          <div role="alert" className="flex items-center gap-2 border border-error/30 bg-error/5 rounded-spa px-3 py-2">
            <Icon name="AlertCircle" size={14} className="text-error flex-shrink-0" />
            <p className="flex-1 text-[13px] text-error">{loadError}</p>
            <button type="button" onClick={loadData} className="text-[13px] font-body-medium text-error underline">Retry</button>
          </div>
        </div>
      )}
      {pkg && (
        <>
          <div className="px-5 pt-1 pb-4 border-b border-border">
            <div className="flex items-center gap-3.5">
              <Avatar name={pkg.guestName} size={44} />
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {profileUrl
                    ? <Link to={profileUrl} className="text-[17px] font-semibold tracking-[-0.3px] text-text-primary hover:text-primary hover:underline truncate">{pkg.guestName}</Link>
                    : <span className="text-[17px] font-semibold tracking-[-0.3px] text-text-primary truncate">{pkg.guestName}</span>}
                  <StatusPill status={status} />
                </div>
                <p className="text-[12.5px] text-[#8A8A90] mt-0.5 tabular-nums">
                  {phoneLabel(pkg) || 'No phone on file'}
                  {profileUrl && <> · <Link to={profileUrl} className="hover:text-text-primary hover:underline">View profile</Link></>}
                </p>
              </div>
            </div>
            {((live && canBook && pkg.serviceId) || messageUrl) && (
              <div className="flex gap-2 mt-4">
                {live && canBook && pkg.serviceId && (
                  <button type="button" onClick={() => onBook?.(pkg)} className="h-8 px-3 rounded-md bg-primary text-white text-[13px] font-medium inline-flex items-center gap-1.5 shadow-[0_1px_2px_rgba(45,90,39,.25),inset_0_1px_0_rgba(255,255,255,.15)] hover:bg-primary/95">
                    <Icon name="CalendarPlus" size={14} />Book next session
                  </button>
                )}
                {messageUrl && (
                  <a href={messageUrl} target="_blank" rel="noopener noreferrer" className="h-8 px-3 rounded-md border border-border bg-white text-[13px] font-medium inline-flex items-center gap-1.5 text-text-primary hover:bg-[#FAFAF9]">
                    <Icon name="MessageSquare" size={14} />Message
                  </a>
                )}
              </div>
            )}
            {!readOnly && pkg.customerId && (
              <div className="mt-3"><CustomerContactQuickEdit customerId={pkg.customerId} email={pkg.customerEmail} phone={pkg.customerPhone} onSaved={() => { loadData(); onChanged?.(); }} /></div>
            )}
          </div>

          <div className="px-5 py-[18px] flex flex-col gap-[22px]">
            {notice && (
              <p role="status" className="flex items-start gap-2 border border-success/30 bg-success/5 rounded-spa px-3 py-2 text-[13px] text-success">
                <Icon name="CheckCircle2" size={14} className="mt-0.5 flex-shrink-0" /><span>{notice}</span>
              </p>
            )}

            <section>
              <div className={SECTION}>
                <span className="truncate">{pkg.packageTypeName}</span>
                <span className="normal-case tracking-normal text-[#515152] font-normal text-[12px] truncate">{pkg.serviceName}{pkg.serviceDurationMinutes ? ` · ${pkg.serviceDurationMinutes} min` : ''}</span>
              </div>
              <div className="border border-border rounded-[10px] px-4 py-3.5">
                <div className="flex items-baseline gap-2" data-sessions-left>
                  <b className="text-[28px] font-semibold tracking-[-0.8px] tabular-nums">{pkg.sessionsRemaining}</b>
                  <span className="text-[13px] text-[#8A8A90]">of {total} session{total === 1 ? '' : 's'} left</span>
                </div>
                {total > 0 && total <= 12 ? (
                  <div className="grid gap-1.5 mt-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }} data-session-boxes>
                    {Array.from({ length: total }).map((_, i) => {
                      if (i < used) {
                        const r = usedAsc[i];
                        return (
                          <div key={i} data-box="used" className="h-11 rounded-lg border border-border bg-[#FAFAF9] flex flex-col items-center justify-center text-[11px] text-[#8A8A90] tabular-nums">
                            <Icon name="Check" size={13} className="text-text-primary" />{r ? shortDate(r.redeemed_date, today) : 'Used'}
                          </div>
                        );
                      }
                      if (i === used && live) {
                        return (
                          <div key={i} data-box="next" className="h-11 rounded-lg border border-primary bg-white flex flex-col items-center justify-center text-[11px] text-primary">
                            <b className="text-[12px] font-semibold">{i + 1}</b>next
                          </div>
                        );
                      }
                      return (
                        <div key={i} data-box="left" className="h-11 rounded-lg border border-dashed border-[#CFDCCC] bg-[#FBFCFA] flex items-center justify-center">
                          <b className="text-[12px] font-semibold text-[#515152]">{i + 1}</b>
                        </div>
                      );
                    })}
                  </div>
                ) : total > 12 ? (
                  <div className="h-2 rounded bg-[#E4E4E1] mt-3 overflow-hidden" aria-label={`${used} of ${total} used`}>
                    <div className="h-full rounded bg-[#6E9A66] ml-auto" style={{ width: `${(Math.max(0, pkg.sessionsRemaining) / total) * 100}%` }} />
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-[12.5px] text-[#515152] tabular-nums">
                  <span className="inline-flex items-center gap-1.5"><Icon name="Calendar" size={14} />{status === 'expired' ? 'Ended' : 'Valid until'} {longDate(pkg.expiryDate)}</span>
                  {live && timeLeft(pkg.expiryDate, today) && (
                    <span className={`inline-flex items-center gap-1.5 ${warn ? 'text-[#B45309] font-medium' : ''}`} data-time-left><Icon name="Clock" size={14} />{timeLeft(pkg.expiryDate, today)}</span>
                  )}
                </div>
              </div>
            </section>

            <section>
              <div className={SECTION}>
                <span>Used</span>
                {redemptions.length > 0 && <span className="normal-case tracking-normal text-[#515152] font-normal text-[12px]">{redemptions.length} session{redemptions.length === 1 ? '' : 's'}</span>}
              </div>
              {redemptions.length === 0 ? (
                <p className="text-[13px] text-[#8A8A90]">No sessions used yet.</p>
              ) : (
                <ul className="flex flex-col" data-timeline>
                  {redemptions.map((r) => {
                    const k = usedAsc.indexOf(r) + 1;
                    const t = tileDate(r.redeemed_date);
                    const bits = [r.branch?.name, r.booking?.therapist?.name ? `with ${shortName(r.booking.therapist.name)}` : null, r.booking?.booking_number ? `booking ${/^\d+$/.test(String(r.booking.booking_number)) ? '#' : ''}${r.booking.booking_number}` : null].filter(Boolean);
                    const usedBy = r.guest_name_used_by && r.guest_name_used_by !== pkg.guestName ? `Used by ${r.guest_name_used_by}` : null;
                    return (
                      <li key={r.id} className="flex gap-3 items-start py-2">
                        <div className="w-10 text-center rounded-md bg-[#FAFAF9] border border-border py-[3px] flex-shrink-0">
                          <b className="block text-[14px] font-semibold tabular-nums">{t.day}</b>
                          <span className="text-[9.5px] text-[#8A8A90] font-semibold uppercase">{t.mon}</span>
                        </div>
                        <div className="min-w-0">
                          <p className="text-[13px] font-medium text-text-primary">Session {k} · {pkg.serviceName}</p>
                          {bits.length > 0 && <p className="text-[12.5px] text-[#8A8A90] mt-0.5">{bits.join(' · ')}</p>}
                          {(usedBy || r.notes) && <p className="text-[12.5px] text-[#8A8A90] mt-0.5">{[usedBy, r.notes].filter(Boolean).join(' · ')}</p>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section>
              <div className={SECTION}><span>Payment</span></div>
              <dl className="border border-border rounded-lg text-[13px] tabular-nums" data-payment>
                {[
                  ['Price', npr(price)],
                  pkg.discountAmount > 0 ? [`Discount${pkg.discountType === 'percentage' && pkg.discountValue ? ` (${pkg.discountValue}%)` : ''}`, `−${npr(pkg.discountAmount)}`] : null,
                  [`Paid${pkg.paymentMethod ? ` · ${pkg.paymentMethod}` : ''}`, npr(pkg.paidAmount)],
                  pkg.dueAmount > 0 ? [`Due${pkg.dueHolderName ? ` · ${pkg.dueHolderName}` : ''}`, npr(pkg.dueAmount), 'due'] : null,
                  perSession != null ? ['Value per session', npr(perSession), 'total'] : null,
                ].filter(Boolean).map(([k, v, tone], i) => (
                  <div key={k} className={`flex items-center gap-2.5 px-3.5 py-2.5 ${i > 0 ? 'border-t border-[#F1F1EF]' : ''} ${tone === 'total' ? 'bg-[#FAFAF9] rounded-b-lg' : ''}`}>
                    <dt className="text-[#515152]">{k}</dt>
                    <dd className={`ml-auto text-right font-medium ${tone === 'due' ? 'text-[#B45309]' : 'text-text-primary'}`}>{v}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <div className="text-[12.5px] text-[#8A8A90] space-y-2">
              <p>Sold {longDate(pkg.issuedDate)} at {pkg.branchName}{pkg.issuedByName && pkg.issuedByName !== '—' ? ` by ${shortName(pkg.issuedByName)}` : ''}</p>
              {pkg.guestInfo && pkg.guestInfo !== phone && <p className="whitespace-pre-wrap"><span className="text-[#515152] font-medium">Guest info</span> · {pkg.guestInfo}</p>}
              {pkg.remarks && <p className="whitespace-pre-wrap"><span className="text-[#515152] font-medium">Remarks</span> · {pkg.remarks}</p>}
            </div>
          </div>
        </>
      )}
    </PanelShell>
  );
};

export default PackageDetailPanel;
