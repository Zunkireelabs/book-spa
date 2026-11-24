import React, { useEffect } from 'react';
import { useAvailabilityPrecheck } from '../../../../hooks/useAvailabilityPrecheck';
import { TimeField } from '../../../../components/ui/DateTimeRow';
import Icon from '../../../../components/AppIcon';
import ServicePickRow from '../../../../components/ui/ServicePickRow';
import StaffPickRow from '../../../../components/ui/StaffPickRow';
import StaffPicker from '../../../../components/ui/StaffPicker';
import { staffDayRanges, pickedRowStatusMulti, rangeLabel } from '../../../../utils/staffFit';
import { nepalNow } from '../../../../utils/customerDirectory';
import { format12h } from '../../../../utils/timeInput';
import { formatNPR } from '../../../../services/bookingTransformers';
import { bookingTotal, newRow, minToClock } from './multiServiceRows';

// ZNLY-402 piece 3b: "+ Add another service" under the first Service / Staff rows of the New booking panel (Individual mode, org setting ON).
// Same pickers as the first row (ServicePickRow, StaffPickRow + StaffPicker). Each row: service, staff, start (defaults to when the previous service
// ends), duration + price, remove. Total and "N services" show only from 2 services. A refused row shows the plain reason on that row.
// One extra service. It runs the SAME live checks as a single booking (shift / break / leave / blocked / clash, from the availability rule and the day's
// bookings) for ITS OWN staff and time, and reports the reason upward, so Create stays off with the reason on THIS row (nothing is made before every row passes).
const ExtraRow = ({
  r, i, t, svc, patch, remove, problem, ownProblem, onProblem, errorRow, errorText, flashRow, isFirst = false, solo = false, first1 = null, staffRing = '',
  services, branchId, canViewPrices, pickerPeople, dayBookings, dayOff, bookingDate, allowStaffOverlap, staffLabel, staffLabelPlural, branchHours,
}) => {
  const needsStaff = !svc || svc.requires_therapist !== false;
  const picked = r.therapistId ? [pickerPeople.find((p) => p.id === r.therapistId) || { id: r.therapistId, name: 'Selected' }] : [];
  const info = pickedRowStatusMulti(picked, {
    slot: dayBookings && svc ? { start: t.startMin, end: t.endMin > t.startMin ? t.endMin : t.startMin + 60 } : null,
    rangesById: dayBookings && bookingDate ? staffDayRanges(dayBookings, { date: bookingDate }) : {},
    offById: dayOff, date: bookingDate, today: nepalNow().today, busyOk: allowStaffOverlap,
  });
  const n = i + 1;   // the number shown: Service 1 is the panel's own service, extras follow
  const pre = useAvailabilityPrecheck({ branchId, date: bookingDate, startTime: t.start, durationMin: svc?.duration_minutes || 0, therapistId: needsStaff ? r.therapistId : null, enabled: !!svc && !isFirst });   // Service 1's verdict is the panel's own card, never doubled here
  const text = ownProblem || (pre.verdict ? `${pre.verdict.message}` : '') || info.problem || '';
  // A manager / admin may book anyway with a reason when the ONLY problem is an overridable availability verdict (same rule as a single booking).
  const overridable = !ownProblem && !info.problem && !!pre.verdict && pre.warn;
  useEffect(() => { if (!isFirst) onProblem(r.key, text, overridable); }, [text, overridable]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (!isFirst) onProblem(r.key, '', false); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const refused = !isFirst && errorRow === i;
  const shown = text || (refused ? errorText : '');
  const staffShows = !!(svc && needsStaff && r.therapistId && text);   // the staff card itself carries the reason, so it never says "Free" next to it
  return (
    <div data-qc-field={isFirst ? 'service' : `service-x${i - 1}`} data-row-problem={shown ? 'true' : undefined} className={`rounded-spa-lg border bg-background p-3 space-y-2.5 ${!shown ? 'border-border' : overridable ? 'border-amber-300 ring-2 ring-amber-200' : 'border-error ring-2 ring-error/20'}`}>
      {!solo && (
        <div className="flex items-center justify-between">
          <p className="font-body font-body-medium text-[13px] text-text-primary">Service {n}</p>
          <button type="button" onClick={() => remove(r.key)} aria-label={`Remove service ${n}`}
            className="inline-flex h-8 items-center gap-1 rounded-spa px-2 text-xs text-text-secondary hover:bg-surface hover:text-error spa-transition-fast">
            <Icon name="X" size={14} /> Remove
          </button>
        </div>
      )}
      <ServicePickRow required invalid={flashRow === (isFirst ? -1 : i - 1) && !r.serviceId} services={services} value={r.serviceId}
        // Service 1 keeps the staff already picked (e.g. from the calendar column), as the single-service form always did; extras start clean.
        onChange={(val) => patch(r.key, isFirst ? { serviceId: val } : { serviceId: val, therapistId: '' })} branchId={branchId} canViewPrices={canViewPrices}
        title={solo ? 'Service for the booking' : `Service ${n}`} ariaLabel={solo ? 'Service' : undefined}
        loading={isFirst && first1?.loading} openSignal={isFirst ? first1?.openSignal || 0 : 0} onSignalConsumed={isFirst ? first1?.onSignalConsumed : null} />
      {needsStaff && (svc || isFirst) && (
        <div {...(isFirst ? { 'data-qc-field': 'staff' } : {})} className={isFirst ? staffRing : ''}>
          <p className="flex items-baseline justify-between mb-1.5 font-body font-body-medium text-[13px] text-text-primary">{staffLabel} <span className="text-xs font-normal text-text-secondary">optional</span></p>
          <StaffPickRow
            people={picked} max={1} statusLine={text ? '' : info.statusLine} pill={text ? null : info.pill} problem={text}
            emptyLabel={svc ? `Pick ${staffLabel.toLowerCase()}` : 'Pick a service first'} disabled={!svc} title={`${staffLabel} for service ${n}`}
            renderPicker={(close) => (
              <StaffPicker
                people={pickerPeople} selectedIds={r.therapistId ? [r.therapistId] : []} max={1}
                onChange={(ids) => { patch(r.key, { therapistId: ids[0] || '' }); close(); }}
                onNone={() => { patch(r.key, { therapistId: '' }); close(); }}
                noneLabel={`No ${staffLabel.toLowerCase()} · assign later`}
                header={{ title: `${staffLabel} for service ${n}`, sub: [svc?.name, rangeLabel(t.startMin, t.endMin)].filter(Boolean).join(' · ') }}
                staffLabel={staffLabel} staffLabelPlural={staffLabelPlural}
                slot={bookingDate ? { date: bookingDate, start: t.start, end: t.end } : null}
                serviceId={svc?.id} bookings={dayBookings} offById={dayOff}
              />
            )}
          />
          {svc && !r.therapistId && <p className="mt-1 text-xs text-text-secondary" data-no-staff-yet>No {staffLabel.toLowerCase()} yet · goes to Unassigned</p>}
        </div>
      )}
      {svc && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {!solo && (
          <div className="flex items-center gap-2 text-[13px] text-text-primary">
            <span className="font-body-medium">Starts</span>
            <div className="w-32"><TimeField time={t.start} onTimeChange={(v) => patch(r.key, { start: v })} branchHours={branchHours} ariaLabel={`Start time of service ${n}`} /></div>
          </div>
          )}
          <span className="text-xs text-text-secondary">
            {svc.duration_minutes} min · ends {format12h(t.end)}{canViewPrices && (svc.effective_price_npr ?? svc.price_npr) != null ? ` · ${svc.price_type === 'tiered' ? 'from ' : ''}${formatNPR(Number(svc.effective_price_npr ?? svc.price_npr))}` : ''}
          </span>
          {!isFirst && r.start && <button type="button" onClick={() => patch(r.key, { start: '' })} className="text-xs text-primary underline underline-offset-2">Start after the previous service</button>}
        </div>
      )}
      {shown && !staffShows && <p className={`text-xs font-medium ${overridable ? 'text-amber-800' : 'text-error'}`} role="alert" data-row-problem-text>{shown}</p>}
      {overridable && <p className="text-xs text-text-secondary">You can still book it; you'll be asked why.</p>}
    </div>
  );
};

const ExtraServiceRows = ({
  rows, setRows, times, services, first, firstCard, canAdd = true, staffRing = '', branchId, canViewPrices, pickerPeople, dayBookings, dayOff, bookingDate,
  allowStaffOverlap, staffLabel, staffLabelPlural, branchHours, errorRow = null, errorText = '', flashRow = null, problems = {}, ownProblems = {}, onProblem = () => {},
}) => {
  const patch = (key, p) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const remove = (key) => setRows((rs) => rs.filter((r) => r.key !== key));
  const byId = new Map((services || []).map((s) => [s.id, s]));
  const sum = bookingTotal(first, rows, services);

  const shared = { services, branchId, canViewPrices, pickerPeople, dayBookings, dayOff, bookingDate, allowStaffOverlap, staffLabel, staffLabelPlural, branchHours };
  // Service 1 (the panel's own service): the same card as every extra, mapped onto the panel's state. Its start IS the top date/time field.
  const f = firstCard;
  const firstStartMin = (() => { const m = /^(\d{1,2}):(\d{2})/.exec(f?.start || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; })();
  const firstDur = first?.duration_minutes || 0;
  const firstT = { start: f?.start || '', end: minToClock(firstStartMin + firstDur), startMin: firstStartMin, endMin: firstStartMin + firstDur };
  const firstRow = { key: 'first', serviceId: f?.serviceId || '', therapistId: f?.therapistId || '', start: f?.start || '' };
  const firstPatch = (_k, p) => {
    if ('serviceId' in p) f.onService(p.serviceId);
    if ('therapistId' in p) f.onStaff(p.therapistId);
    if ('start' in p) f.onStart(p.start);
  };
  return (
    <div className="space-y-3" data-extra-services>
      {f && (
        <ExtraRow key="first" isFirst solo={rows.length === 0} first1={f} staffRing={staffRing} r={firstRow} i={0} t={firstT} svc={first || null} patch={firstPatch} remove={() => f.onRemove(rows[0])}
          problem="" ownProblem="" onProblem={onProblem} errorRow={null} errorText="" flashRow={f.flash ? -1 : null} {...shared} services={f.firstServices && rows.length === 0 ? f.firstServices : services} />
      )}
      {rows.map((r, i) => (
        <ExtraRow key={r.key} r={r} i={i + 1} t={times[i]} svc={byId.get(r.serviceId) || null} patch={patch} remove={remove}
          problem={problems[r.key] || ''} ownProblem={ownProblems[i + 1] || ''} onProblem={onProblem}
          errorRow={errorRow} errorText={errorText} flashRow={flashRow}
          {...shared} />
      ))}
      {canAdd && <button type="button" onClick={() => setRows((rs) => [...rs, newRow()])}
        className="inline-flex h-10 items-center gap-1.5 rounded-spa border border-dashed border-border px-3 text-[13px] font-body-medium text-primary hover:bg-background spa-transition-fast" data-add-service>
        <Icon name="Plus" size={15} /> Add another service
      </button>}
      {sum.count > 1 && (
        <div className="flex items-baseline justify-between rounded-spa bg-primary/[0.07] px-3 py-2 text-[13px] font-medium text-[#1f3f1b]" data-booking-total>
          <span>{sum.count} services</span>
          {canViewPrices && sum.known && <span>Total {sum.approx ? 'from ' : ''}{formatNPR(sum.total)}</span>}
        </div>
      )}
    </div>
  );
};

export default ExtraServiceRows;
