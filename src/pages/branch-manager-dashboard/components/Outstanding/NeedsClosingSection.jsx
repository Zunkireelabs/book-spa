import { friendlyError } from '../../../../utils/friendlyError';
import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams, useLocation } from 'react-router-dom';
import Icon from '../../../../components/AppIcon';
import { getNeedsClosing } from '../../../../services/api';
import { daysSinceNepal } from '../Reports/moneyOwedView';
import { staffWord } from '../../../../utils/industryTerms';
import { teamMemberWord } from '../../../../utils/industryTerms';

const npr = (n) => `NPR ${Number(n || 0).toLocaleString('en-IN')}`;
const fmtDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

// Past bookings still Pending/Confirmed: the visit happened (or didn't) but was never closed, so nothing is owed yet. Listed separately
// from Outstanding so the due figures stay honest. Also shows the (grey, collapsed) total of upcoming unpaid bookings, which is not owed.
// Same cell styles as the Money owed table, used in collapsible (Reports) mode.
const th = 'px-3.5 py-2 text-[11px] font-medium text-text-tertiary bg-background border-b border-border';
const td = 'px-2.5 py-2.5 border-b border-border text-[12.5px]';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDay = (iso) => { const [, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]}`; };
const daysAgo = (iso) => { const n = daysSinceNepal(iso); return n === 0 ? 'today' : `${n} d ago`; };
const Sm = ({ children }) => <span className="block text-[11px] text-text-tertiary font-normal">{children}</span>;

// `collapsible` (Money owed report): a collapsed summary card that expands to a paged list. Deep links (?section=needs-closing or
// #needs-closing) open it expanded. Without the prop the section renders the full list inline, as before.
// `therapistId` (+ `therapistName`, `onShowAll`) narrows the list to one therapist's bookings, with a chip to drop the filter.
const NeedsClosingSection = ({ branchId, from, to, collapsible = false, therapistId = null, therapistName = '', onShowAll = null }) => {
  const navigate = useNavigate();
  const { orgSlug } = useParams();
  const [searchParams] = useSearchParams();
  const { hash } = useLocation();
  const sectionRef = useRef(null);
  const deepLinked = searchParams.get('section') === 'needs-closing' || hash === '#needs-closing';
  const [expanded, setExpanded] = useState(deepLinked);
  const [raw, setRaw] = useState(null);
  const [error, setError] = useState(null);
  const [showUpcoming, setShowUpcoming] = useState(false);

  const load = useCallback(async () => {
    const { data: d, error: err } = await getNeedsClosing({ branchId, from, to });
    if (err) setError(friendlyError(err, 'Could not load bookings that need closing.')); else { setError(null); setRaw(d); }
  }, [branchId, from, to]);
  useEffect(() => { load(); }, [load]);

  const data = useMemo(() => {
    if (!raw || !therapistId) return raw;
    const unclosed = raw.unclosed.filter((b) => (b.therapistIds || []).includes(therapistId));
    return { ...raw, unclosed, unclosedAtStake: unclosed.reduce((n, b) => n + (b.atStake || 0), 0) };
  }, [raw, therapistId]);
  const filterChip = therapistId && onShowAll
    ? <p className="text-xs text-text-secondary"><span className="rounded-full bg-primary/10 text-primary px-2 py-0.5 font-medium">Showing {therapistName || `this ${staffWord()}`} only</span> <button type="button" onClick={onShowAll} className="text-primary hover:underline ml-1">show all</button></p>
    : null;

  // Arriving with ?section=needs-closing (e.g. from the notice): scroll here once the section has rendered.
  useEffect(() => {
    if (deepLinked) setExpanded(true);
    if (data && deepLinked) sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [data, deepLinked]); // eslint-disable-line react-hooks/exhaustive-deps

  const lockedCount = data ? data.unclosed.filter((b) => b.isLocked).length : 0;

  if (error) return <p className="font-body text-sm text-error">{error}</p>;
  if (!data) return null;

  if (collapsible && !expanded) {
    return (
      <section id="needs-closing" ref={sectionRef} aria-label="Needs closing" className="scroll-mt-4">
        <div className="bg-surface border border-border rounded-spa-lg px-4 py-3 flex items-center justify-between gap-4">
          <div>
            <h3 className="font-heading font-heading-semibold text-base text-text-primary">
              Needs closing <span className="text-text-tertiary font-normal">· {data.unclosed.length}{data.unclosed.length > 0 ? ` · ${npr(data.unclosedAtStake)} at stake` : ''} · not owed yet</span>
            </h3>
            <p className="font-caption text-xs text-text-tertiary mt-0.5">
              {data.unclosed.length === 0 ? 'Every past booking is closed.' : 'Past bookings still Pending, Confirmed or In-Progress. Nothing is owed until they’re closed, so they’re not in the total.'}
            </p>
          </div>
          {data.unclosed.length > 0 && (
            <button type="button" onClick={() => setExpanded(true)} aria-expanded={false} className="shrink-0 text-primary text-sm font-medium hover:underline">Show list</button>
          )}
        </div>
      </section>
    );
  }

  const rows = data.unclosed;

  return (
    <section id="needs-closing" ref={sectionRef} aria-label="Needs closing" className="space-y-3 pt-2 scroll-mt-4">
      <div>
        <h3 className="font-heading font-heading-semibold text-base text-text-primary">
          Needs closing {collapsible
            ? <span className="text-text-tertiary font-normal">· {data.unclosed.length} · {npr(data.unclosedAtStake)} at stake · not owed yet</span>
            : data.unclosed.length > 0 && <span className="text-text-tertiary font-normal">· {data.unclosed.length - lockedCount}{lockedCount > 0 ? ` + ${lockedCount} on closed days` : ''}</span>}
        </h3>
        <p className="font-caption text-xs text-text-tertiary mt-0.5">
          {collapsible
            ? 'Past bookings still Pending, Confirmed or In-Progress. Nothing is owed until they’re closed, so they’re not in the total.'
            : `Past bookings still Pending or Confirmed, and visits left In-Progress from an earlier day. Nothing extra is owed until they are closed (in-progress visits are already in Outstanding).${data.unclosed.length > 0 ? ` ${npr(data.unclosedAtStake)} at stake.` : ''}`}
        </p>
        {filterChip}
      </div>
      {data.unclosed.length === 0 ? (
        <p className="font-body text-sm text-text-tertiary">Every past booking is closed.</p>
      ) : (
        <div className={`bg-surface rounded-spa-lg border border-border ${collapsible ? 'max-h-[520px] overflow-auto' : 'overflow-x-auto'}`}>
          {collapsible ? (
            <table className="w-full border-collapse">
              <thead><tr>
                <th className={`${th} text-left sticky top-0`}>Customer</th><th className={`${th} text-left sticky top-0`}>Date</th><th className={`${th} text-left sticky top-0`}>Service · team member</th>
                <th className={`${th} text-right sticky top-0`}>At stake</th><th className={`${th} sticky top-0`} />
              </tr></thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.bookingId}>
                    <td className={`${td} whitespace-nowrap`}>{b.customerName}<Sm>{b.bookingNumber} · {b.stillInProgress ? 'Still in progress' : b.status}{b.isLocked ? ' · Closed day' : ''}</Sm></td>
                    <td className={`${td} whitespace-nowrap`}>{shortDay(b.date)}<Sm>{[b.startTime, daysAgo(b.date)].filter(Boolean).join(' · ')}</Sm></td>
                    <td className={`${td} max-w-[160px]`}><span className="block truncate" title={b.serviceName}>{b.serviceName}</span><Sm>{b.therapistName || ''}</Sm></td>
                    <td className={`${td} text-right font-data tabular-nums whitespace-nowrap`}>{b.stillInProgress ? <span className="text-text-tertiary">—</span> : Number(b.atStake || 0).toLocaleString('en-IN')}</td>
                    <td className={`${td} text-right whitespace-nowrap`}>
                      <button type="button" onClick={() => navigate(`/${orgSlug}/bookings/${b.bookingId}`)} className="inline-flex items-center gap-1 text-primary text-xs font-medium hover:underline">Open<Icon name="ArrowUpRight" size={12} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full">
            <thead>
              <tr className="bg-background border-b border-border text-left font-body font-body-medium text-xs text-text-secondary">
                <th className="px-4 py-2.5">Date</th><th className="px-4 py-2.5">Customer</th><th className="px-4 py-2.5">Service</th>
                <th className="px-4 py-2.5">{teamMemberWord()}</th><th className="px-4 py-2.5 text-right">At stake</th><th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.bookingId} className="border-b border-border last:border-0 text-sm">
                  <td className="px-4 py-2.5 whitespace-nowrap">{fmtDate(b.date)}{b.startTime ? <span className="text-text-tertiary"> · {b.startTime}</span> : null}</td>
                  <td className="px-4 py-2.5">{b.customerName}<span className="block text-xs text-text-tertiary">{b.bookingNumber} · {b.stillInProgress ? 'Still in progress' : b.status}{b.isLocked ? ' · Closed day: can’t be changed' : ''}</span></td>
                  <td className="px-4 py-2.5">{b.serviceName}</td>
                  <td className="px-4 py-2.5">{b.therapistName}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">{b.stillInProgress ? <span className="text-text-tertiary">—</span> : npr(b.atStake)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button type="button" onClick={() => navigate(`/${orgSlug}/bookings/${b.bookingId}`)} className="inline-flex items-center gap-1 text-primary text-xs font-medium hover:underline">Open<Icon name="ArrowUpRight" size={12} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
            </table>
          )}
        </div>
      )}
      {collapsible && data.unclosed.length > 0 && (
        <div className="flex items-center gap-4 text-sm">
          <button type="button" onClick={() => { setExpanded(false); }} className="text-text-secondary hover:underline">Hide list</button>
        </div>
      )}
      <div>
        <button type="button" onClick={() => setShowUpcoming((o) => !o)} aria-expanded={showUpcoming} className="inline-flex items-center gap-1.5 text-xs text-text-tertiary hover:text-text-secondary">
          <Icon name={showUpcoming ? 'ChevronDown' : 'ChevronRight'} size={13} />Upcoming (not owed)
        </button>
        {showUpcoming && (
          <p className="text-xs text-text-tertiary mt-1.5 pl-5">{data.upcomingCount === 0 ? 'No upcoming bookings have an unpaid balance.' : `${npr(data.upcoming)} across ${data.upcomingCount} upcoming booking${data.upcomingCount === 1 ? '' : 's'}. This is not owed until the visit happens.`}</p>
        )}
      </div>
    </section>
  );
};

export default NeedsClosingSection;
