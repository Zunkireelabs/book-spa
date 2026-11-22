import { NEPAL_TZ } from '../../../../utils/nepalTime';
import { friendlyError } from '../../../../utils/friendlyError';
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Icon from '../../../../components/AppIcon';
import CustomerContactQuickEdit from '../../../../components/ui/CustomerContactQuickEdit';
import { PanelShell, OverflowMenu } from '../../../../components/ui/PanelFormKit';
import { fetchMembership, fetchMembershipTransactions } from '../../../../services/api';
import { useBranch } from '../../../../contexts/BranchContext';
import { useOrg } from '../../../../contexts/OrgContext';
import {
  DISPLAY_STATUS, displayStatus, discountChips, perkUsedInCurrentCycle, nextBirthday, longDay, toActivate, tierDeposit, kindLabel, extensionNote, shortName, npr,
} from '../../../../services/membershipsView';
import { buildWhatsAppUrl } from '../../../../utils/checkoutReceipt';
import { formatPhoneGrouped } from '../../../../utils/phone';
import { nepalNow } from '../../../../utils/customerDirectory';
import { Avatar, StatusPill, longDate, tileDate } from '../Area/listKit';
import { DiscountChips } from './memberBits';
import { TopUpView, RenewView, ExtendView, AdjustView, BirthdayView } from './MembershipActionViews';

const SECTION = 'text-[11.5px] text-[#8A8A90] font-medium uppercase tracking-[.05em] mb-2 flex items-baseline justify-between gap-3';
const SUB_VIEWS = ['topup', 'renew', 'extend', 'adjust', 'birthday'];
const ghostBtn = 'h-8 px-3 rounded-md border border-border bg-white text-[13px] font-medium inline-flex items-center gap-1.5 text-text-primary hover:bg-[#FAFAF9]';

// One ledger row in the panel's timeline: "Spent · Aromatherapy Massage" / "with Vina O. · BK-…", amount on the right.
const ledgerLine = (t) => {
  const service = t.booking?.service_name_snapshot;
  const title = t.kind === 'deduction' && service ? `${kindLabel(t.kind)} · ${service}` : kindLabel(t.kind);
  const bits = t.kind === 'deduction'
    ? [t.booking?.therapist?.name ? `with ${shortName(t.booking.therapist.name)}` : null, t.booking?.booking_number || null, !t.booking && t.notes ? t.notes : null]
    : [t.payment_mode || null, t.kind === 'extension' ? extensionNote(t.notes) : (t.notes || null), t.performer?.full_name ? `by ${shortName(t.performer.full_name)}${t.branch?.name ? ` at ${t.branch.name}` : ''}` : null];
  return { title, sub: bits.filter(Boolean).join(' · ') };
};

// Member detail in the right-hand panel (V21): who, the membership card (balance, spent share, dates), the tier's discounts, the
// birthday perk and the latest wallet activity. Actions: Book visit, the one status action (Collect / Top up / Extend / Renew),
// Message; the ⋯ menu keeps Renew, Extend, Birthday gift and Adjust (admin). Each action is a stacked sub-view (MembershipActionViews,
// unchanged) with a back arrow; on success we land back here with the record refreshed. Props are unchanged from before (the
// Customers panel opens it too), plus `initialView` to land straight on a sub-view.
const MembershipDetailPanel = ({ membershipId, isAdmin = false, readOnly = false, branchId, width = '460px', initialView = null, onClose, onChanged }) => {
  const { orgSlug } = useParams();
  const navigate = useNavigate();
  const { isOverall } = useBranch();
  const { orgName } = useOrg();
  const today = nepalNow().today;
  const [m, setMembership] = useState(null);
  const [txns, setTxns] = useState([]);
  const [error, setError] = useState(null);
  const [view, setView] = useState(SUB_VIEWS.includes(initialView) ? initialView : 'detail');
  const [notice, setNotice] = useState('');

  const reload = useCallback(async () => {
    if (!membershipId) return;
    setError(null);
    const [mRes, tRes] = await Promise.all([fetchMembership(membershipId), fetchMembershipTransactions(membershipId)]);
    if (mRes.error) { setError(friendlyError(mRes.error, 'Failed to load membership.')); return; }
    if (tRes.error) { setError(friendlyError(tRes.error, 'Failed to load transactions.')); return; }
    setMembership(mRes.data);
    setTxns(tRes.data || []);
  }, [membershipId]);
  useEffect(() => { setMembership(null); reload(); }, [reload]);
  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const done = (message) => { setView('detail'); setNotice(message || ''); reload(); onChanged?.(); };
  const back = () => setView('detail');

  if (m && !readOnly) {
    const props = { membership: m, branchId, onBack: back, onClose, onDone: done, width };
    if (view === 'topup') return <TopUpView {...props} />;
    if (view === 'renew') return <RenewView {...props} />;
    if (view === 'extend') return <ExtendView {...props} />;
    if (view === 'adjust' && isAdmin) return <AdjustView {...props} />;
    if (view === 'birthday') return <BirthdayView {...props} />;
  }

  const status = m ? displayStatus(m, today) : null;
  const perkUsed = m ? perkUsedInCurrentCycle(m) : false;
  const canBirthday = !!m && m.status === 'active' && !perkUsed;
  const hasBalance = !!m && Number(m.balance) > 0;
  const statusAction = !m || readOnly ? null
    : m.status === 'pending' ? { label: 'Collect', icon: 'Wallet', view: 'topup' }
      : m.status === 'lapsed' ? (hasBalance ? { label: 'Extend', icon: 'CalendarPlus', view: 'extend' } : { label: 'Renew', icon: 'RefreshCw', view: 'renew' })
        : { label: 'Top up', icon: 'Plus', view: 'topup' };
  const canBook = !!m && !readOnly && !isOverall && m.status === 'active';
  const phone = m?.customerPhone || '';
  const firstName = m ? String(m.customerName || '').trim().split(/\s+/)[0] : '';
  const messageUrl = m && !readOnly ? buildWhatsAppUrl(phone, `Hi ${firstName}, this is ${orgName || 'our team'} about your ${m.tierName || 'membership'}: ${npr(m.balance)} in your wallet${m.expiryDate ? `, valid until ${longDate(m.expiryDate)}` : ''}.`) : null;
  const profileUrl = m?.customerId ? `/${orgSlug}/customers/${m.customerId}` : null;
  const menu = readOnly || !m ? [] : [
    { key: 'renew', label: 'Renew', icon: 'RefreshCw', run: () => setView('renew') },
    { key: 'extend', label: 'Extend', icon: 'CalendarPlus', run: () => setView('extend'), disabled: !(m.status === 'lapsed' && hasBalance), reason: 'Only a lapsed membership with money left can be extended' },
    { key: 'birthday', label: 'Birthday gift', icon: 'Gift', run: () => setView('birthday'), disabled: !canBirthday, reason: perkUsed ? 'Already given this cycle' : 'Membership must be active' },
    ...(isAdmin ? [{ key: 'adjust', label: 'Adjust balance', icon: 'Pencil', run: () => setView('adjust') }] : []),
  ];
  const bookVisit = () => navigate('?view=new-booking', { state: { prefill: { fullName: m.customerName, phone: m.customerPhone, email: m.customerEmail || '', gender: m.customerGender || '' } } });

  // Membership card numbers
  const dep = m ? tierDeposit(m) : 0;
  const cycle = m ? Math.max(Number(m.cycleDeposited) || 0, dep) : 0;
  const spentPct = cycle > 0 ? Math.min(100, Math.max(0, Math.round((1 - (Number(m?.balance) || 0) / cycle) * 100))) : 0;
  const nb = m?.customerDateOfBirth ? nextBirthday(m.customerDateOfBirth, today) : null;

  return (
    <PanelShell width={width} variant="panel" title="Membership" onClose={onClose} hideFooter headerExtra={menu.length ? <OverflowMenu items={menu} /> : null}>
      {!m && !error && (
        <div className="px-5 py-5 space-y-3" aria-busy="true" aria-label="Loading membership">
          <div className="flex items-center gap-3.5"><div className="w-11 h-11 rounded-full bg-[#F1F1EF] animate-pulse" /><div className="h-5 w-40 rounded bg-[#F1F1EF] animate-pulse" /></div>
          <div className="h-[150px] rounded-xl bg-[#F1F1EF] animate-pulse" />
          {[0, 1].map((i) => <div key={i} className="h-12 rounded-lg bg-[#F1F1EF] animate-pulse" />)}
        </div>
      )}
      {error && (
        <div className="px-5 py-5">
          <div role="alert" className="flex items-center gap-2 border border-error/30 bg-error/5 rounded-spa px-3 py-2">
            <Icon name="AlertCircle" size={14} className="text-error flex-shrink-0" />
            <p className="flex-1 text-[13px] text-error">{error}</p>
            <button type="button" onClick={reload} className="text-[13px] font-body-medium text-error underline">Retry</button>
          </div>
        </div>
      )}
      {m && (
        <>
          <div className="px-5 pt-1 pb-4 border-b border-border">
            <div className="flex items-center gap-3.5">
              <Avatar name={m.customerName} size={44} />
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {profileUrl
                    ? <Link to={profileUrl} className="text-[17px] font-semibold tracking-[-0.3px] text-text-primary hover:text-primary hover:underline truncate">{m.customerName}</Link>
                    : <span className="text-[17px] font-semibold tracking-[-0.3px] text-text-primary truncate">{m.customerName}</span>}
                  <StatusPill status={status} config={DISPLAY_STATUS} />
                </div>
                <p className="text-[12.5px] text-[#8A8A90] mt-0.5 tabular-nums">
                  {phone ? (formatPhoneGrouped(phone) || phone) : 'No phone on file'}
                  {profileUrl && <> · <Link to={profileUrl} className="hover:text-text-primary hover:underline">View profile</Link></>}
                </p>
              </div>
            </div>
            {(canBook || statusAction || messageUrl) && (
              <div className="flex gap-2 mt-4 flex-wrap">
                {canBook && (
                  <button type="button" onClick={bookVisit} className="h-8 px-3 rounded-md bg-primary text-white text-[13px] font-medium inline-flex items-center gap-1.5 shadow-[0_1px_2px_rgba(45,90,39,.25),inset_0_1px_0_rgba(255,255,255,.15)] hover:bg-primary/95">
                    <Icon name="CalendarPlus" size={14} />Book visit
                  </button>
                )}
                {statusAction && (
                  <button type="button" onClick={() => setView(statusAction.view)} className={ghostBtn} data-status-action>
                    <Icon name={statusAction.icon} size={14} />{statusAction.label}
                  </button>
                )}
                {messageUrl && <a href={messageUrl} target="_blank" rel="noopener noreferrer" className={ghostBtn}><Icon name="MessageSquare" size={14} />Message</a>}
              </div>
            )}
            {!readOnly && m.customerId && (
              <div className="mt-3"><CustomerContactQuickEdit customerId={m.customerId} email={m.customerEmail} phone={m.customerPhone} onSaved={() => { reload(); onChanged?.(); }} /></div>
            )}
          </div>

          <div className="px-5 py-[18px] flex flex-col gap-[22px]">
            {notice && (
              <p role="status" className="flex items-start gap-2 border border-success/30 bg-success/5 rounded-spa px-3 py-2 text-[13px] text-success">
                <Icon name="CheckCircle2" size={14} className="mt-0.5 flex-shrink-0" /><span>{notice}</span>
              </p>
            )}

            {/* Membership card */}
            <div className="rounded-xl px-5 py-4 text-white shadow-spa-elevated" style={{ background: 'linear-gradient(135deg,#16261A 0%,#1F3B22 55%,#2D5A27 100%)' }} data-member-card>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11.5px] font-semibold uppercase tracking-[.12em] text-[#E7C766] truncate">{m.tierName || 'Membership'}</span>
                <span className="font-data text-[11.5px] tracking-wide text-white/70">{m.membershipNumber || ''}</span>
              </div>
              {m.status === 'pending' ? (
                <>
                  <p className="mt-3 text-[28px] font-semibold tracking-[-0.8px] tabular-nums">{npr(m.cycleDeposited)}</p>
                  <p className="text-[13px] text-white/75 tabular-nums">paid of {npr(dep)} · {npr(toActivate(m))} to activate</p>
                  <div className="h-[5px] rounded-sm bg-white/15 mt-3 overflow-hidden"><div className="h-full rounded-sm bg-[#E7C766]" style={{ width: `${Math.min(100, ((Number(m.cycleDeposited) || 0) / (dep || 1)) * 100)}%` }} /></div>
                  <div className="flex justify-between gap-3 mt-3 text-[12.5px] text-white/75"><span>Starts once fully paid</span></div>
                </>
              ) : (
                <>
                  <p className="mt-3 text-[28px] font-semibold tracking-[-0.8px] tabular-nums" data-card-balance>{npr(m.balance)}</p>
                  <p className="text-[13px] text-white/75 tabular-nums">left of {npr(cycle)} · {spentPct}% spent</p>
                  <div className="h-[5px] rounded-sm bg-white/15 mt-3 overflow-hidden"><div className="h-full rounded-sm bg-[#E7C766]" style={{ width: `${100 - spentPct}%` }} /></div>
                  <div className="flex justify-between gap-3 mt-3 text-[12.5px] text-white/75 tabular-nums">
                    <span>{m.activationDate ? `Member since ${longDate(m.activationDate)}` : ''}</span>
                    <span>{m.expiryDate ? `${m.status === 'lapsed' ? 'Ended' : 'Valid until'} ${longDate(m.expiryDate)}` : ''}</span>
                  </div>
                </>
              )}
            </div>
            {m.status === 'lapsed' && hasBalance && <p className="-mt-3 text-[12.5px] text-[#515152]">This membership has lapsed, but the {npr(m.balance)} balance is still there. Extend the validity to use it; no new payment needed.</p>}
            {m.status === 'depleted' && <p className="-mt-3 text-[12.5px] text-[#515152]">This wallet is empty. Top up to keep using it, or renew to start a fresh validity cycle on this card.</p>}

            <section>
              <div className={SECTION}><span>Member discounts</span></div>
              {discountChips(m.tierDiscountRules).length
                ? <DiscountChips rules={m.tierDiscountRules} />
                : <p className="text-[13px] text-[#8A8A90]">No member discounts on this tier.</p>}
            </section>

            {/* Birthday */}
            {perkUsed ? (
              <p className="flex items-center gap-2 text-[13px] text-[#515152]" data-birthday="used"><Icon name="Gift" size={15} className="text-[#BE185D]" />Birthday gift given {longDate(String(m.birthdayPerkUsedAt).slice(0, 10))}</p>
            ) : nb ? (
              <div className="flex items-center gap-3 rounded-[10px] border border-[#F5D0E2] bg-[#FDF2F8]/60 px-3.5 py-3" data-birthday="due">
                <div className="w-8 h-8 rounded-md bg-white border border-[#F5D0E2] grid place-items-center text-[#BE185D] flex-shrink-0"><Icon name="Cake" size={15} /></div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-text-primary">Birthday {nb.days === 0 ? 'today' : `on ${longDay(nb.date)}`}</p>
                  <p className="text-[12.5px] text-[#515152]">This year&apos;s birthday gift hasn&apos;t been used yet.</p>
                </div>
                {canBirthday && !readOnly && <button type="button" onClick={() => setView('birthday')} className="h-8 px-3 rounded-md border border-[#F5D0E2] bg-white text-[13px] font-medium text-[#BE185D] hover:bg-[#FDF2F8] whitespace-nowrap">Give gift</button>}
              </div>
            ) : (
              <p className="text-[12.5px] text-[#8A8A90]" data-birthday="none">Add a birthdate to get birthday reminders.</p>
            )}

            <section>
              <div className={SECTION}>
                <span>Wallet activity</span>
                {txns.length > 0 && (
                  <button type="button" onClick={() => navigate(`?view=wallet-usage&member=${m.id}&r=all`)} className="normal-case tracking-normal text-[12px] font-normal text-[#515152] hover:text-text-primary hover:underline" data-see-all>See all</button>
                )}
              </div>
              {txns.length === 0 ? <p className="text-[13px] text-[#8A8A90]">No wallet activity yet.</p> : (
                <ul className="flex flex-col" data-timeline>
                  {txns.slice(0, 5).map((t) => {
                    const tile = tileDate(new Date(t.created_at).toLocaleDateString('en-CA', { timeZone: NEPAL_TZ }));
                    const { title, sub } = ledgerLine(t);
                    const amt = Number(t.amount) || 0;
                    return (
                      <li key={t.id} className="flex gap-3 items-start py-2">
                        <div className="w-10 text-center rounded-md bg-[#FAFAF9] border border-border py-[3px] flex-shrink-0">
                          <b className="block text-[14px] font-semibold tabular-nums">{String(tile.day).padStart(2, '0')}</b>
                          <span className="text-[9.5px] text-[#8A8A90] font-semibold uppercase">{tile.mon}</span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-medium text-text-primary truncate">{title}</p>
                          {sub && <p className="text-[12.5px] text-[#8A8A90] mt-0.5 truncate">{sub}</p>}
                        </div>
                        <span className={`text-[13px] font-semibold tabular-nums whitespace-nowrap ${amt > 0 ? 'text-[#2D7A32]' : 'text-text-primary'}`}>
                          {amt === 0 ? '—' : `${amt > 0 ? '+' : '−'} ${Math.abs(amt).toLocaleString('en-IN')}`}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {m.notes && <p className="text-[12.5px] text-[#8A8A90] whitespace-pre-wrap"><span className="text-[#515152] font-medium">Notes</span> · {m.notes}</p>}
          </div>
        </>
      )}
    </PanelShell>
  );
};

export default MembershipDetailPanel;
