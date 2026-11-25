import { friendlyError } from '../../../../utils/friendlyError';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { formatDistanceToNow, format, parseISO } from 'date-fns';
import Icon from '../../../../components/AppIcon';
import SidePanel from '../../../../components/ui/SidePanel';
import ConfirmDialog from '../../../../components/ui/ConfirmDialog';
import StaffPickRow from '../../../../components/ui/StaffPickRow';
import ServicePickRow from '../../../../components/ui/ServicePickRow';
import { useAuth } from '../../../../contexts/AuthContext';
import { viewerAccess } from '../../../../services/dataMasking';
import StaffPicker from '../../../../components/ui/StaffPicker';
import { useDayAvailability } from '../../../../hooks/useDayAvailability';
import { rangeLabel, pickedRowStatus, staffDayRanges } from '../../../../utils/staffFit';
import CustomSelect from '../../../../components/ui/CustomSelect';
import CustomerAutocomplete from '../../../../components/ui/CustomerAutocomplete';
import { parsePhone } from '../../../../components/ui/CountryCodeSelect';
import PhoneField, { phoneFieldProblem, phoneFieldValue } from '../../../../components/ui/PhoneField';
import TimeBoxInput from '../../../../components/ui/TimeBoxInput';
import { PanelShell, FormBody, Field, TextInput, SelectField, DateField, InlineError, CONTROL } from '../../../../components/ui/PanelFormKit';
import { fetchWaitlist, addToWaitlist, updateWaitlistEntry, removeFromWaitlist, isOverallBranch } from '../../../../services/api';
import { nepalNow } from '../../../../utils/customerDirectory';
import { useIndustry } from '../../../../hooks/useIndustry';
import { useClock } from '../../../../hooks/useUse24h';

const SORT_OPTIONS = [
  { value: 'oldest', label: 'Oldest first' },
  { value: 'newest', label: 'Newest first' },
];

// Deterministic colour bar per service — Timely's reference shows one, and
// there's no services.color column to key off, so a stable hash over the
// service id stands in for one rather than adding a schema column for a
// cosmetic detail.
const SERVICE_COLORS = ['#2D5A27', '#8B4513', '#DAA520', '#1D7874', '#A6416B', '#6B5CA5'];
function colorForService(serviceId) {
  if (!serviceId) return '#8A938E';
  let hash = 0;
  for (let i = 0; i < serviceId.length; i++) hash = (hash * 31 + serviceId.charCodeAt(i)) >>> 0;
  return SERVICE_COLORS[hash % SERVICE_COLORS.length];
}

const EMPTY_FORM = {
  customerId: '', customerName: '', customerPhone: '', customerCountryCode: '+977',
  serviceId: '', preferredDate: '', preferredTime: '', preferredTherapistId: '', notes: '',
};

// The waiting list for one branch. Lives in the calendar (not in the panel) so the header's phone button can show the count while
// the panel is closed or collapsed.
export const useWaitlistEntries = (branchId, refreshToken) => {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sort, setSort] = useState('oldest');

  const load = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    setError(null);
    const result = await fetchWaitlist(branchId, { sort });
    if (result.error) setError("Couldn't load the waitlist.");
    else setEntries(result.data || []);
    setLoading(false);
  }, [branchId, sort]);

  useEffect(() => { load(); }, [load, refreshToken]);
  return { entries, loading, error, setError, sort, setSort, reload: load };
};

export const WaitlistEntryForm = ({ initial, services, therapists, branchId, staffLabel, onCancel, onSaved }) => {
  const { profile: viewerProfile } = useAuth();
  const canViewPrices = viewerAccess(viewerProfile).canViewPrices;
  const [form, setForm] = useState(initial || EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const isEdit = !!initial?.id;
  const baseline = React.useRef(JSON.stringify(initial || EMPTY_FORM));
  // "Any time" is the default and must stay reachable: migration-327 treats a blank preferred_time as a real request. TimeBoxInput has
  // no empty state, so the boxes only mount once the person opts into a specific time; until then preferredTime stays ''.
  const [useSpecificTime, setUseSpecificTime] = useState(!!initial?.preferredTime);

  const handleSave = async () => {
    if (!form.customerName.trim()) { setError('Customer name is required.'); return; }
    const phoneIssue = phoneFieldProblem({ dial: form.customerCountryCode, national: form.customerPhone, original: form.originalPhone });
    if (phoneIssue) { setError(phoneIssue); return; }
    setSaving(true);
    setError(null);
    const fullPhone = phoneFieldValue({ dial: form.customerCountryCode, national: form.customerPhone, original: form.originalPhone }) || '';
    const payload = {
      customerId: form.customerId || null,
      customerName: form.customerName,
      customerPhone: fullPhone || null,
      serviceId: form.serviceId || null,
      preferredDate: form.preferredDate || null,
      preferredTime: form.preferredTime || null,
      preferredTherapistId: form.preferredTherapistId || null,
      notes: form.notes || null,
    };
    const result = isEdit
      ? await updateWaitlistEntry({ id: initial.id, ...payload })
      : await addToWaitlist({ branchId, ...payload });
    setSaving(false);
    if (result.error) { setError(friendlyError(result.error, "Couldn't save. Nothing was changed. Try again.")); return; }
    onSaved();
  };

  const staffLower = staffLabel.toLowerCase();
  const { staffLabelPlural } = useIndustry();
  // ZNLY-310: Free / Busy only when the entry has BOTH a date and a time (otherwise there is nothing to check against: plain list).
  const timed = !!(form.preferredDate && form.preferredTime);
  const day = useDayAvailability({ branchId, date: form.preferredDate, enabled: timed });
  const svc = services.find((x) => x.id === form.serviceId);
  const slotStart = (() => { const [h, m] = String(form.preferredTime || '').slice(0, 5).split(':').map(Number); return h * 60 + (m || 0); })();
  const slotEndMin = slotStart + (svc?.duration_minutes || 60);
  const hhmm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const useFit = timed && day.ready;
  const staffPeople = therapists || [];
  const picked = staffPeople.find((t) => t.id === form.preferredTherapistId);
  const pickInfo = pickedRowStatus(picked, {
    slot: useFit ? { start: slotStart, end: slotEndMin } : null,
    rangesById: useFit ? staffDayRanges(day.bookings, { date: form.preferredDate }) : {},
    offById: useFit ? day.offById : {}, date: form.preferredDate, today: nepalNow().today, busyOk: true,
  });
  return (
    <PanelShell
      title={isEdit ? 'Edit waitlist entry' : 'Add to waitlist'}
      onClose={onCancel}
      dirty={JSON.stringify(form) !== baseline.current}
      busy={saving}
      primary={{ label: isEdit ? 'Save changes' : 'Add to waitlist', onClick: handleSave, loading: saving }}
    >
      <FormBody>
        <InlineError message={error} />
        <Field label="Customer name" hint="Pick an existing client or type a new name.">
          <CustomerAutocomplete
            value={form.customerName}
            branchId={branchId}
            onChange={(val) => setForm((f) => ({ ...f, customerName: val, customerId: '' }))}
            onSelect={(customer) => {
              const { dial, national } = parsePhone(customer.phone || '');
              setForm((f) => ({ ...f, customerId: customer.id, customerName: customer.full_name, customerPhone: national, customerCountryCode: dial || '+977', originalPhone: customer.phone || '' }));
            }}
            placeholder="Search or type a name"
          />
        </Field>

        <Field label={<>Phone <span className="text-text-tertiary font-normal">(optional)</span></>}>
          <PhoneField
            id="waitlist-phone" original={form.originalPhone}
            dial={form.customerCountryCode} national={form.customerPhone}
            onChange={({ dial, national }) => setForm((f) => ({ ...f, customerCountryCode: dial, customerPhone: national }))}
          />
        </Field>

        <Field label="Service">
          <ServicePickRow services={services} value={form.serviceId} onChange={(val) => setForm((f) => ({ ...f, serviceId: val }))} branchId={branchId} canViewPrices={canViewPrices} anyLabel="Any service" title="Service for the waitlist" sub="Optional · leave on “Any service”" ariaLabel="Service" />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <DateField label="Preferred date" value={form.preferredDate} onChange={(d) => setForm((f) => ({ ...f, preferredDate: d }))} hint={form.preferredDate ? undefined : 'Blank means any day.'} />
          <Field label="Preferred time">
            <label className="flex items-center gap-2 h-10 text-[13px] text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                className="accent-primary w-4 h-4"
                checked={!useSpecificTime}
                onChange={(e) => {
                  const anyTime = e.target.checked;
                  setUseSpecificTime(!anyTime);
                  // Starting point to edit from once they opt into a specific time, not a default applied before they asked.
                  if (anyTime) setForm((f) => ({ ...f, preferredTime: '' }));
                  else if (!form.preferredTime) setForm((f) => ({ ...f, preferredTime: '09:00' }));
                }}
              />
              Any time
            </label>
            {useSpecificTime && (
              <TimeBoxInput value={form.preferredTime || '09:00'} onChange={(val) => setForm((f) => ({ ...f, preferredTime: val }))} />
            )}
          </Field>
        </div>

        <Field label={`Preferred ${staffLower}`}>
          <StaffPickRow
            id={form.preferredTherapistId || null}
            {...pickInfo}
            emptyLabel={`Any ${staffLower}`}
            title={`Preferred ${staffLower}`}
            renderPicker={(close) => (
              <StaffPicker
                people={staffPeople}
                selectedIds={form.preferredTherapistId ? [form.preferredTherapistId] : []}
                onChange={(ids) => { setForm((f) => ({ ...f, preferredTherapistId: ids[0] || '' })); close(); }}
                max={1}
                header={{ title: `Preferred ${staffLower}${form.customerName.trim() ? ` · ${form.customerName.trim()}` : ''}`, sub: [svc?.name || 'Any service', useFit ? `${rangeLabel(slotStart, slotEndMin)}` : 'any time'].join(' · ') }}
                note={useFit ? null : <p className="px-4 pb-2 text-[12.5px] text-text-secondary">Pick a time to see who&apos;s free</p>}
                onNone={() => { setForm((f) => ({ ...f, preferredTherapistId: '' })); close(); }}
                noneLabel={`Any ${staffLower}`}
                staffLabel={staffLabel}
                staffLabelPlural={staffLabelPlural}
                slot={useFit ? { date: form.preferredDate, start: hhmm(slotStart), end: hhmm(slotEndMin) } : null}
                serviceId={svc?.id || null}
                bookings={useFit ? day.bookings : null}
                offById={useFit ? day.offById : {}}
              />
            )}
          />
        </Field>

        <Field label="Notes">
          <textarea
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            rows={2}
            placeholder="Anything the front desk should know"
            className={`${CONTROL} h-auto py-2 resize-none`}
          />
        </Field>
      </FormBody>
    </PanelShell>
  );
};

const ICON_BTN = 'w-[34px] h-9 flex items-center justify-center rounded-spa border border-border text-text-secondary hover:bg-background hover:text-text-primary spa-transition-fast flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed';
const PHONE_BTN = 'w-11 h-11 flex items-center justify-center rounded-spa border border-border text-text-secondary hover:bg-background flex-shrink-0';

const WaitlistCard = ({ entry, therapistName, staffLabel, overall, canBook, phone, onBookIn, onEdit, onRemove }) => {
  const clock = useClock();
  const [more, setMore] = useState(false);
  const withWho = entry.preferred_therapist_id && therapistName[entry.preferred_therapist_id];
  // Same three slots as the board: day · time · who. An empty slot reads "Any …" so the line never looks half-filled.
  const detail = [
    entry.preferred_date ? format(parseISO(entry.preferred_date), 'EEE d MMM') : 'Any day',
    entry.preferred_time ? clock(entry.preferred_time) : 'Any time',
    withWho ? `with ${withWho}` : `Any ${staffLabel.toLowerCase()}`,
  ].join(' · ');
  const added = formatDistanceToNow(new Date(entry.created_at), { addSuffix: true });
  const bookHint = overall ? 'Pick a specific location to book this person in' : undefined;

  const bookBtn = canBook && (
    <button
      type="button"
      onClick={() => !overall && onBookIn(entry)}
      disabled={overall}
      title={bookHint}
      className="flex-1 h-9 max-lg:h-11 rounded-spa bg-primary text-white text-[13px] font-body font-body-medium hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
    >
      Book in
    </button>
  );
  const callBtn = phone && (
    <a href={`tel:${phone}`} aria-label={`Call ${entry.customer_name}`} className={`${ICON_BTN} max-lg:w-11 max-lg:h-11`}><Icon name="Phone" size={15} /></a>
  );

  return (
    <div className="border border-border rounded-spa-lg p-3 max-lg:p-3.5 bg-surface space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <p className="font-body font-body-semibold text-[13.5px] text-text-primary truncate">{entry.customer_name}</p>
        <span className="text-xs text-text-secondary whitespace-nowrap">Added {added.replace(/^about /, '')}</span>
      </div>
      <div className="flex items-center gap-1.5 text-[12.5px] text-text-secondary">
        <span className="w-1.5 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: colorForService(entry.service_id) }} />
        <span className="truncate">{entry.service?.name || 'Any service'}</span>
      </div>
      <p className="text-xs text-text-secondary">{detail}</p>
      {entry.notes && <p className="text-xs text-text-secondary italic">"{entry.notes}"</p>}

      {/* Desktop: Book in + icon buttons. Phone: Book in, Call, and a "⋯" that opens Edit / Remove, every target 44 px. */}
      <div className="flex gap-1.5 pt-0.5 max-lg:hidden">
        {bookBtn}{callBtn}
        <button type="button" onClick={() => onEdit(entry)} aria-label="Edit" className={ICON_BTN}><Icon name="Pencil" size={15} /></button>
        <button type="button" onClick={() => onRemove(entry)} aria-label="Remove" className={ICON_BTN}><Icon name="XCircle" size={15} /></button>
      </div>
      <div className="lg:hidden pt-1 space-y-2">
        <div className="flex gap-2">
          {bookBtn}{callBtn}
          <button type="button" onClick={() => setMore((v) => !v)} aria-label="More" aria-expanded={more} className={PHONE_BTN}><Icon name="MoreHorizontal" size={18} /></button>
        </div>
        {more && (
          <div className="flex gap-2">
            <button type="button" onClick={() => onEdit(entry)} className="flex-1 h-11 rounded-spa border border-border text-[13px] font-body-medium text-text-primary">Edit</button>
            <button type="button" onClick={() => onRemove(entry)} className="flex-1 h-11 rounded-spa border border-error/30 text-[13px] font-body-medium text-error">Remove</button>
          </div>
        )}
      </div>
    </div>
  );
};

const WaitlistList = ({ wl, branchId, therapistName, staffLabel, locationLabel, canViewCustomerDetails, onBookIn, onAdd, onEdit, onRemove, compactHeader }) => {
  const overall = isOverallBranch(branchId);
  const { entries, loading, error, sort, setSort, reload } = wl;
  return (
    <>
      <div className="px-3.5 pb-3 space-y-2 border-b border-border">
        <button
          type="button"
          onClick={() => !overall && onAdd()}
          disabled={overall}
          title={overall ? `Pick a specific ${locationLabel.toLowerCase()} to add someone to the waitlist` : undefined}
          className={`w-full h-9 rounded-spa text-[13px] font-body font-body-medium disabled:opacity-40 disabled:cursor-not-allowed ${compactHeader ? 'max-lg:h-11 bg-primary text-white hover:bg-primary/90' : 'border border-border text-text-primary hover:bg-background'}`}
        >
          Add to waitlist
        </button>
        {overall && <p className="text-xs text-text-secondary">Pick a specific {locationLabel.toLowerCase()} to add someone to the waitlist</p>}
        <CustomSelect value={sort} onChange={setSort} options={SORT_OPTIONS} size="sm" />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-3.5 space-y-2.5">
        {error && (
          <div role="alert" className="flex items-center justify-between gap-2 px-3 py-2 bg-error/10 border border-error/20 rounded-spa text-error text-[13px]">
            <span>{error}</span>
            <button type="button" onClick={reload} className="underline font-body-medium">Retry</button>
          </div>
        )}
        {loading ? (
          [0, 1, 2].map((i) => <div key={i} className="h-[112px] rounded-spa-lg bg-background animate-pulse" />)
        ) : entries.length === 0 && !error ? (
          <div className="border border-border rounded-spa-lg p-5 text-center">
            <p className="text-[13.5px] font-body-semibold text-text-primary">No one on the waitlist</p>
            <p className="mt-1 text-xs text-text-secondary">When a day is full, add the client here and book them in when a slot opens.</p>
          </div>
        ) : (
          entries.map((entry) => (
            <WaitlistCard
              key={entry.id}
              entry={entry}
              therapistName={therapistName}
              staffLabel={staffLabel}
              overall={overall}
              canBook={canViewCustomerDetails || !!entry.customer_id}
              phone={canViewCustomerDetails ? entry.customer_phone : null}
              onBookIn={onBookIn}
              onEdit={onEdit}
              onRemove={onRemove}
            />
          ))
        )}
      </div>
    </>
  );
};

// Desktop (lg+): a docked column beside the calendar that collapses to a rail with the count. Below lg the same list opens as a
// full-width sheet from the calendar header's Waitlist button (`sheetOpen` / `onCloseSheet`).
const WaitlistPanel = ({ wl, branchId, services = [], therapists = [], collapsed, onToggleCollapse, onBookIn, canViewCustomerDetails = true, sheetOpen = false, onCloseSheet }) => {
  const { staffLabel, locationLabel } = useIndustry();
  const [formOpen, setFormOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState(null);
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [removing, setRemoving] = useState(false);

  const therapistName = useMemo(() => {
    const map = {};
    therapists.forEach((t) => { map[t.id] = t.name; });
    return map;
  }, [therapists]);

  const editInitialFor = (entry) => {
    const { dial, national } = parsePhone(entry.customer_phone || '');
    return {
      id: entry.id,
      customerId: entry.customer_id || '',
      customerName: entry.customer_name || '',
      customerPhone: national,
      customerCountryCode: dial || '+977',
      originalPhone: entry.customer_phone || '',
      serviceId: entry.service_id || '',
      preferredDate: entry.preferred_date || '',
      preferredTime: entry.preferred_time ? entry.preferred_time.slice(0, 5) : '',
      preferredTherapistId: entry.preferred_therapist_id || '',
      notes: entry.notes || '',
    };
  };

  const handleRemove = async () => {
    if (!confirmRemove) return;
    setRemoving(true);
    const result = await removeFromWaitlist(confirmRemove.id);
    setRemoving(false);
    setConfirmRemove(null);
    if (result.error) { wl.setError("Couldn't remove that entry. Try again."); return; }
    wl.reload();
  };

  const listProps = {
    wl, branchId, therapistName, staffLabel, locationLabel, canViewCustomerDetails,
    onBookIn,
    onAdd: () => { setEditingEntry(null); setFormOpen(true); },
    onEdit: (entry) => { setEditingEntry(entry); setFormOpen(true); },
    onRemove: setConfirmRemove,
  };

  const overlays = (
    <>
      {formOpen && (
        <WaitlistEntryForm
          initial={editingEntry ? editInitialFor(editingEntry) : null}
          services={services}
          therapists={therapists}
          branchId={branchId}
          staffLabel={staffLabel}
          onCancel={() => { setFormOpen(false); setEditingEntry(null); }}
          onSaved={() => { setFormOpen(false); setEditingEntry(null); wl.reload(); }}
        />
      )}
      {confirmRemove && (
        <ConfirmDialog
          title={`Remove ${confirmRemove.customer_name} from the waitlist?`}
          message="They are not booked. This only takes them off the list."
          confirmLabel="Remove"
          cancelLabel="Keep"
          requireReason={false}
          isSubmitting={removing}
          onClose={() => !removing && setConfirmRemove(null)}
          onConfirm={handleRemove}
        />
      )}
    </>
  );

  // The phone sheet: SidePanel is a full-screen sheet under 640px and a right-hand sheet up to lg.
  // Phone Back closes the sheet instead of leaving the calendar: one history entry while it is open.
  useEffect(() => {
    if (!sheetOpen) return undefined;
    window.history.pushState({ waitlistSheet: true }, '');
    const onPop = () => onCloseSheet?.();
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (window.history.state?.waitlistSheet) window.history.back();
    };
  }, [sheetOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const sheet = (
    <SidePanel isOpen={sheetOpen} title={`Waitlist · ${wl.entries.length} waiting`} onClose={onCloseSheet}>
      <div className="flex flex-col h-full -mx-0 pt-3">
        <WaitlistList {...listProps} compactHeader />
      </div>
    </SidePanel>
  );

  if (collapsed) {
    return (
      <>
        <button
          type="button"
          onClick={onToggleCollapse}
          className="max-lg:hidden flex-shrink-0 w-9 border-l border-border bg-background hover:bg-primary/5 flex flex-col items-center justify-start pt-4 gap-2 text-text-secondary"
          title="Show waitlist"
          aria-label={`Show waitlist, ${wl.entries.length} waiting`}
        >
          <Icon name="ListPlus" size={16} />
          {wl.entries.length > 0 && (
            <span className="text-[10px] font-bold bg-primary text-white rounded-full min-w-4 h-4 px-1 flex items-center justify-center">{wl.entries.length}</span>
          )}
        </button>
        {sheet}
        {overlays}
      </>
    );
  }

  return (
    <>
      <aside aria-label="Waitlist" className="max-lg:hidden flex-shrink-0 w-[340px] border-l border-border bg-surface flex flex-col h-full">
        <div className="flex items-center justify-between px-3.5 pt-3.5 pb-2.5">
          <div>
            <b className="font-heading font-heading-semibold text-sm text-text-primary">Waitlist</b>
            <span className="ml-2 text-xs text-text-secondary">{wl.entries.length} waiting</span>
          </div>
          <button type="button" onClick={onToggleCollapse} aria-label="Hide waitlist" title="Hide" className="w-[30px] h-[30px] flex items-center justify-center rounded-spa hover:bg-background text-text-secondary">
            <Icon name="PanelRightClose" size={16} />
          </button>
        </div>
        <WaitlistList {...listProps} />
      </aside>
      {sheet}
      {overlays}
    </>
  );
};

export default WaitlistPanel;
