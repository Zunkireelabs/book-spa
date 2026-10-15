import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import Icon from '../../../../components/AppIcon';
import { getNeedsClosing } from '../../../../services/api';

const npr = (n) => `NPR ${Number(n || 0).toLocaleString('en-IN')}`;
const fmtDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

// Past bookings still Pending/Confirmed: the visit happened (or didn't) but was never closed, so nothing is owed yet. Listed separately
// from Outstanding so the due figures stay honest. Also shows the (grey, collapsed) total of upcoming unpaid bookings, which is not owed.
const NeedsClosingSection = ({ branchId, from, to }) => {
  const navigate = useNavigate();
  const { orgSlug } = useParams();
  const [searchParams] = useSearchParams();
  const sectionRef = useRef(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [showUpcoming, setShowUpcoming] = useState(false);

  const load = useCallback(async () => {
    const { data: d, error: err } = await getNeedsClosing({ branchId, from, to });
    if (err) setError(err.message || 'Could not load bookings that need closing.'); else { setError(null); setData(d); }
  }, [branchId, from, to]);
  useEffect(() => { load(); }, [load]);

  // Arriving with ?section=needs-closing (e.g. from the notice): scroll here once the section has rendered.
  useEffect(() => {
    if (data && searchParams.get('section') === 'needs-closing') sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const lockedCount = data ? data.unclosed.filter((b) => b.isLocked).length : 0;

  if (error) return <p className="font-body text-sm text-error">{error}</p>;
  if (!data) return null;

  return (
    <section id="needs-closing" ref={sectionRef} aria-label="Needs closing" className="space-y-3 pt-2 scroll-mt-4">
      <div>
        <h3 className="font-heading font-heading-semibold text-base text-text-primary">
          Needs closing {data.unclosed.length > 0 && <span className="text-text-tertiary font-normal">· {data.unclosed.length - lockedCount}{lockedCount > 0 ? ` + ${lockedCount} on closed days` : ''}</span>}
        </h3>
        <p className="font-caption text-xs text-text-tertiary mt-0.5">
          Past bookings still Pending or Confirmed, and visits left In-Progress from an earlier day. Nothing extra is owed until they are closed (in-progress visits are already in Outstanding).{data.unclosed.length > 0 && ` ${npr(data.unclosedAtStake)} at stake.`}
        </p>
      </div>
      {data.unclosed.length === 0 ? (
        <p className="font-body text-sm text-text-tertiary">Every past booking is closed.</p>
      ) : (
        <div className="bg-surface rounded-spa-lg border border-border overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-background border-b border-border text-left font-body font-body-medium text-xs text-text-secondary">
                <th className="px-4 py-2.5">Date</th><th className="px-4 py-2.5">Customer</th><th className="px-4 py-2.5">Service</th>
                <th className="px-4 py-2.5">Therapist</th><th className="px-4 py-2.5 text-right">At stake</th><th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {data.unclosed.map((b) => (
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
