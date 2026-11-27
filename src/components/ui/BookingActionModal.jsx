import { NEPAL_TZ, nepalToday } from '../../utils/nepalTime';
import { formatClockTime, formatClockIsoNow, formatClockRange } from '../../utils/clockTime';
import { useUse24h } from '../../hooks/useUse24h';
import { futureBookingMessage } from '../../services/bookingTransformers';
import { friendlyError } from '../../utils/friendlyError';
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { viewerAccess, isRestricted } from '../../services/dataMasking';
import { supabase as supabaseClient } from '../../lib/supabase';
import BookingHistory from './BookingHistory';
import { createPortal } from 'react-dom';
import Button from './Button';
import CustomSelect from './CustomSelect';
import ServicePickRow from './ServicePickRow';
import PaymentModal from './PaymentModal';
import { submitCheckout } from '../../services/checkoutSubmit';
import ConfirmDialog, { CANCEL_REASON_OPTIONS } from './ConfirmDialog';
import Icon from '../AppIcon';
import MembershipWalletCard from './MembershipWalletCard';
import PaymentMethodSelector from './PaymentMethodSelector';
import PaymentModeCorrectionModal from './PaymentModeCorrectionModal';
import TimeBoxInput from './TimeBoxInput';
import { paymentStatusLabel } from '../../utils/paymentStatusLabel';
const payTone = (b) => ({ success: 'text-success', neutral: 'text-text-secondary', warning: 'text-warning' })[paymentStatusLabel(b).tone];
import BillActions from './Bill/BillActions';
import { relatedFetchers } from '../../utils/visitGate';
import { deleteBlockers } from '../../utils/deleteBlockers';
import { fetchBookingServices } from '../../services/api';
import { buildBookingBlock } from '../../utils/bookingBlock';
import { VisitStatusFlow } from './VisitStatusDialog';
import RemoveServiceFlow from './RemoveServiceFlow';
import CreateBookingHost from '../../pages/branch-manager-dashboard/components/calendar/CreateBookingHost';
import { buildEditSlot } from '../../pages/branch-manager-dashboard/components/calendar/editBookingSlot';
import { lockReason as lockReasonOf } from '../../pages/branch-manager-dashboard/components/calendar/editBookingSlot';
import BookingServicesBlock, { waitingNote } from './BookingServicesBlock';
import BookingStaffRows, { rowIds, rowRoom, rowChanged } from './BookingStaffRows';
import BookingDiscountLines from './BookingDiscountLines';
import { planBookingDiscount } from '../../utils/bookingDiscount';
import { adminCorrectBooking, correctPaymentMode, adminDeleteBooking, correctPaymentAmount, fetchMemberDiscountContext, applyMemberDiscount,  fetchBookingCreator, acknowledgeBooking, fetchDiscountApprovers, fetchDueHolderNames, getCustomerOutstandingBalance, fetchMembershipForBooking, fetchCustomerReferralForBooking, resolveCustomerReferralReward, recordGroupPayment, fetchBookingProductSales, refundProductSale, recordTip, fetchBookingPackageUseCount, getCustomerFirstBookingFlag, fetchInvoiceByBookingId, staffCanRequestDiscountApproval } from '../../services/api';
import { excludeRelatedFromPreviousDue, toDbStatus } from '../../services/bookingTransformers';
import { useBranch } from '../../contexts/BranchContext';
import { useOrg } from '../../contexts/OrgContext';
import { getExtendOptions } from '../../utils/serviceVariants';
import BlockOverlapWarning from './BlockOverlapWarning';
import SidePanel, { PANEL_WIDTH_BOOKING } from './SidePanel';
import { DetentSheet, SheetExpandButton, useMediaQuery, releaseSheetEntry } from './BottomSheet';
import ClientDayLine from '../../pages/branch-manager-dashboard/components/calendar/ClientDayLine';
import BookingCustomerLine from './BookingCustomerLine';
import WalkInClientLine from './WalkInClientLine';
import { useNavigate } from 'react-router-dom';
import AvailabilityNoteLine from './AvailabilityNoteLine';
import { AlertsBlock } from '../../pages/branch-manager-dashboard/components/calendar/BookingHoverCard';
import { getBookingStatusColors } from '../../utils/bookingStatusColors';
import { InlineError, GuideCard } from './GuideCard';
import { describeError } from '../../utils/errorGuide';
import { editFormChanged, editFormSeed, editChanges, isClientlessWalkIn } from '../../utils/editDetails';
import { formatPhoneGrouped } from '../../utils/phone';
import { parsePhone } from './CountryCodeSelect';
import PhoneField, { usePhoneState, phoneFieldProblem, phoneFieldValue } from './PhoneField';
import DateTimeRow from './DateTimeRow';
import { useBlockOverlap } from '../../hooks/useBlockOverlap';
import { Segmented } from './PanelFormKit';
import { memberDiscountFor } from '../../services/memberDiscount';
import { nepalNow } from '../../utils/customerDirectory';
import { MEMBERSHIP_ENABLED, PRODUCTS_ENABLED } from '../../lib/featureFlags';
import { humanizePaymentMethod } from '../../services/paymentMethods';
import { wordBranchCap } from '../../utils/industryTerms';
import { canonicalMode } from 'lib/dayMoney';
import StaffPicker from './StaffPicker';
import StaffPickRow from './StaffPickRow';
import { pickedRowStatus, pickedRowStatusMulti, staffDayRanges, rangeLabel, clockToMin } from '../../utils/staffFit';
import { useDayAvailability } from '../../hooks/useDayAvailability';
import { staffPickIncomplete } from '../../utils/staffFit';

function getNepalNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: NEPAL_TZ }));
}

// "No Show" only becomes selectable once the booking's scheduled start time
// has passed — otherwise staff could mark a client a no-show before they were
// even due.
function hasBookingStarted(booking) {
  if (!booking?.date || !booking?.startTime) return false;
  const start = new Date(`${booking.date}T${booking.startTime}`);
  return getNepalNow() >= start;
}

// An ISO timestamp as "5 Jun 2026, 2:14pm" (Nepal time; the clock part follows the 12h/24h choice).
function formatCreatedAt(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toLocaleDateString('en-GB', { timeZone: NEPAL_TZ, day: 'numeric', month: 'short', year: 'numeric' })}, ${formatClockIsoNow(iso)}`;
}

// Status badge styles

// Discount tab, member part (V22 addendum A): the tier's discount for this booking. Undecided (applies itself at checkout,
// "Apply now" / "Don't apply for this visit"), applied ("Remove"), declined ("Apply N%"), or a better rate than the booking's
// own discount ("Apply N% instead"). The price box shows what the guest will pay.
const fmtNpr = (n) => Number(n || 0).toLocaleString('en-IN');
const whenShort = (ts) => {
  if (!ts) return '';
  const d = new Date(ts);
  const day = d.toLocaleDateString('en-CA', { timeZone: NEPAL_TZ });
  const t = formatClockIsoNow(ts);
  return `${day === nepalNow().today ? 'today' : d.toLocaleDateString('en-GB', { timeZone: NEPAL_TZ, day: 'numeric', month: 'short' })} ${t}`;
};
const MemberDiscountCard = ({ md, ctx, serviceLabel, busy, onApply, onDecline }) => {
  const b = ctx.booking;
  const title = `${md.tierName} · ${md.pct}% off ${md.label.toLowerCase()}`;
  const star = (muted) => (
    <span className={`w-8 h-8 rounded-md grid place-items-center flex-none border ${muted ? 'bg-[#F7F7F5] border-[#E7E8E6] text-[#B4B4BA]' : 'bg-white border-[#F1E2B8] text-[#C99A2E]'}`}>
      <Icon name="Star" size={13} className="fill-current" strokeWidth={0} />
    </span>
  );
  const btn = 'h-8 px-3 rounded-md border text-[13px] font-medium whitespace-nowrap disabled:opacity-60';
  let card;
  if (md.kind === 'saved') {
    card = (
      <div className="rounded-[10px] border border-[#F1E2B8] bg-[#FFFBF0] p-3.5 flex gap-3" data-member-card="applied">
        {star(false)}
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2">
            <p className="flex-1 text-[13.5px] font-semibold text-[#7A5608]">{title}</p>
            <span className="inline-flex items-center gap-1 text-[12.5px] text-primary whitespace-nowrap"><Icon name="Check" size={13} />Applied</span>
          </div>
          <p className="text-[12.5px] text-[#92600A]">{b.approvedByName ? `Applied by ${b.approvedByName}${b.updatedAt ? ` · ${whenShort(b.updatedAt)}` : ''}` : 'Applied'}</p>
          <button type="button" disabled={busy} onClick={onDecline} className="mt-2 text-[12px] text-[#8A8A90] underline underline-offset-2 hover:text-text-primary" data-member-remove>Remove</button>
        </div>
      </div>
    );
  } else if (md.kind === 'apply' && md.declined) {
    card = (
      <div className="rounded-[10px] border border-border bg-[#FAFAF9] p-3.5 flex items-center gap-3" data-member-card="declined">
        {star(true)}
        <div className="flex-1 min-w-0">
          <p className="text-[13.5px] font-medium text-text-primary">Member discount not applied this visit</p>
          <p className="text-[12.5px] text-[#8A8A90]">{title}</p>
        </div>
        <button type="button" disabled={busy} onClick={onApply} className={`${btn} border-[#E7C766] bg-white text-[#7A5608] hover:bg-[#FFF6DD]`} data-member-apply>Apply {md.pct}%</button>
      </div>
    );
  } else {
    const better = md.kind === 'better';
    card = (
      <div className="rounded-[10px] border border-[#F1E2B8] bg-[#FFFBF0] p-3.5 flex gap-3" data-member-card={better ? 'better' : 'undecided'}>
        {star(false)}
        <div className="flex-1 min-w-0">
          <p className="text-[13.5px] font-semibold text-[#7A5608]">{title}</p>
          <p className="text-[12.5px] text-[#92600A]">{better ? `Replaces the current discount and saves the guest NPR ${fmtNpr(md.extra)} more. They never add up.` : 'Comes off automatically when the guest pays.'}</p>
          <div className="flex items-center gap-3 mt-3">
            <button type="button" disabled={busy} onClick={onApply} className={`${btn} border-[#E7C766] bg-white text-[#7A5608] hover:bg-[#FFF6DD]`} data-member-apply>{better ? `Apply ${md.pct}% instead` : 'Apply now'}</button>
            {!better && <button type="button" disabled={busy} onClick={onDecline} className="text-[12.5px] text-[#8A8A90] underline underline-offset-2 hover:text-text-primary" data-member-decline>Don&apos;t apply for this visit</button>}
          </div>
        </div>
      </div>
    );
  }
  // Price box
  const base = b.baseAmount;
  const rows = [[serviceLabel, fmtNpr(base)]];
  let totalLabel = 'Final amount';
  let total = b.finalAmount;
  if (md.kind === 'saved') rows.push([`★ ${md.tierName} ${md.pct}% off`, `−${fmtNpr(b.discountAmount)}`, true]);
  else if (md.kind === 'apply' && !md.declined) { rows.push(['★ Member price at checkout', `−${fmtNpr(md.amount)}`, true]); totalLabel = 'Guest will pay'; total = Math.max(0, base - md.amount); }
  else if (b.discountAmount > 0) rows.push([`Discount${b.discountReason ? ` · ${b.discountReason}` : ''}`, `−${fmtNpr(b.discountAmount)}`]);
  return (
    <>
      {card}
      <div>
        <p className="text-[11.5px] text-[#8A8A90] font-medium uppercase tracking-[.05em] mb-2">Price</p>
        <div className="border border-border rounded-lg text-[13px]" data-member-price>
          {rows.map(([k, v, gold], i) => (
            <div key={i} className={`flex items-center gap-3 px-3.5 py-2.5 ${i ? 'border-t border-[#F1F1EF]' : ''} ${gold ? 'text-[#9A6B0B]' : 'text-[#515152]'}`}>
              <span className="flex-1 min-w-0 truncate">{k}</span><span className="tabular-nums">{v}</span>
            </div>
          ))}
          <div className="flex items-center gap-3 px-3.5 py-2.5 border-t border-[#F1F1EF] font-semibold text-text-primary">
            <span className="flex-1">{totalLabel}</span><span className="tabular-nums">NPR {fmtNpr(total)}</span>
          </div>
        </div>
      </div>
    </>
  );
};

const STATUS_STYLES = {
  pending: 'bg-warning/10 text-warning',
  confirmed: 'bg-success/10 text-success',
  'in-progress': 'bg-primary/10 text-primary',
  completed: 'bg-gray-100 text-gray-500',
  cancelled: 'bg-error/10 text-error',
  'no show': 'bg-gray-100 text-gray-500',
};

const CORRECTION_REASON_MIN = 10;

// Only fields an admin can sensibly retype. The RPC enforces its own, wider
// whitelist server-side; this is the deliberately narrower UI surface, so a
// mis-click cannot rewrite something obscure. Adding a field here is safe only
// if it also appears in the RPC's v_allowed array (admin_correct_booking).
const CORRECTABLE_FIELDS = [
  { value: 'status',          label: 'Status',            kind: 'status' },
  { value: 'base_amount',     label: 'Base amount (NPR)', kind: 'number' },
  { value: 'discount_amount', label: 'Discount (NPR)',    kind: 'number' },
  { value: 'date',            label: 'Date',              kind: 'date'   },
  { value: 'start_time',      label: 'Start time',        kind: 'time'   },
  { value: 'customer_name',   label: 'Customer name',     kind: 'text'   },
  { value: 'customer_phone',  label: 'Customer phone',    kind: 'text'   },
];

const CORRECTION_STATUS_OPTIONS = [
  { value: 'Pending',     label: 'Pending' },
  { value: 'Confirmed',   label: 'Confirmed' },
  { value: 'In-Progress', label: 'In-Progress' },
  { value: 'Completed',   label: 'Completed' },
  { value: 'Cancelled',   label: 'Cancelled' },
  { value: 'No Show',     label: 'No Show' },
];

// Current value of each correctable field, read off the transformed booking
// object the way the rest of this modal already does.
function correctionFieldsFromBooking(booking) {
  return {
    status: booking?.status ? toDbStatus(booking.status) : '',
    base_amount: booking?.baseAmount ?? '',
    discount_amount: booking?.discountAmount ?? '',
    date: booking?.date || '',
    start_time: booking?.startTime ? booking.startTime.slice(0, 5) : '',
    customer_name: booking?.customerName || '',
    customer_phone: booking?.customerPhone || '',
    // ZNLY-331: how the phone is shown in PhoneField; customer_phone (above) stays the value that is diffed and saved.
    _phone: parsePhone(booking?.customerPhone || ''),
  };
}

// ZNLY-235: notes on a booking for a restricted login (their only free-text write), saved through the definer RPC.
const RestrictedNotes = ({ bookingId, value, onSaved }) => {
  const [text, setText] = React.useState(value || '');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(null);
  React.useEffect(() => { setText(value || ''); }, [bookingId, value]);
  const save = async () => {
    setBusy(true); setErr(null);
    const { error } = await supabaseClient.rpc('restricted_set_booking_notes', { p_booking_id: bookingId, p_notes: text });
    setBusy(false);
    if (error) setErr(friendlyError(error)); else onSaved?.();
  };
  return (
    <div className="space-y-1.5" data-restricted-notes>
      <label className="font-body font-medium text-xs uppercase tracking-wider text-text-tertiary">Notes</label>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="Add a note for this booking…"
        className="w-full px-3 py-2 border border-border rounded-spa text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30" />
      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={busy || text === (value || '')} className="px-3 py-1.5 rounded-spa bg-primary text-white text-sm disabled:opacity-40">{busy ? 'Saving…' : 'Save note'}</button>
        {err && <span className="text-xs text-error">{err}</span>}
      </div>
    </div>
  );
};

const BookingActionModal = ({
  clientDay = null, // ZNLY-281: { count, first, last } of this client's bookings that day (calendar only)
  isOpen = false,
  onClose,
  booking = null,
  therapists = [],
  rooms = [],
  services = [],
  onAssignTherapist,
  onUpdateStatus,
  onRecordPayment,
  // Optional: when provided, the whole bundle (primary booking + every
  // allocation, any tender type) is paid atomically via recordGroupPayment
  // instead of one sequential onRecordPayment call per booking — see
  // migration-178. Callback takes no args; just refresh + toast, the same
  // tail the caller's own onRecordPayment handler already does. Falls back
  // to the existing sequential loop wherever this isn't wired, so it's
  // fully opt-in and backward compatible.
  onGroupPaymentRecorded,
  onApplyDiscount,
  onEditBooking,
  onAddServiceStart,
  onRebookStart,
  branchHours,
  userRole = 'staff',
  dayBookings = null, // raw calendar bookings of the day: turns on the time-aware Staff list (Free / Busy then / Best fit); null = plain list
  offStaff = {}, // { staffId: 'Off today' | 'On leave' } for the Staff list's Off today group
  initialTab = null, // tab to open on for a newly opened booking (e.g. 'assign'); default Details
  // variant: 'modal' (default, centered dialog — every other caller) | 'panel' (docked SidePanel, used by the calendar).
  // Printing an invoice hands the customer their own name/phone on paper: an account with customer details hidden must not
  // get that affordance (same gate as issue_invoice(), migration-334).
  canViewCustomerDetails = true,
  variant = 'modal',
  use24h: use24hProp,      // optional override; by default the staff member's own 12h/24h choice (useUse24h)
  previewBooking = null,   // panel only: the calendar card's already-known data, shown while the full booking loads
  onRefreshBooking,        // panel only: re-fetch the open booking after an in-place action (status change)
  liveBackdrop = false,    // panel on phones: the page behind stays live (calendar): no scrim, no focus trap at half
  guardRef,                // panel only: parent calls guardRef.current(action) to run `action` through the dirty guard
  // Optional: when provided, a small "view" affordance appears on each Related-
  // services/Other-unpaid-bookings row, letting staff jump straight to THAT
  // booking's own management dialog instead of only being able to select it for
  // a bundled payment. Takes the booking id, same contract as onBookingClick.
  onViewBooking,
  // Optional: when provided, "Reschedule" becomes available in the status row.
  // Like onRebookStart, this closes the modal and hands the booking back to
  // the caller to run its own pick-a-slot (or form) flow — but afterward the
  // caller is expected to create the new booking AND cancel this one, not
  // update it in place.
  onRescheduleStart,
  // ZNLY-402 piece 5: the pencil opens the shared booking form (prefilled with the whole booking) when the host provides it; else the inline Edit details.
  onEditForm,
  // ZNLY-435: the calendar's day rows (raw `bookings` shape) so the card is drawn on first paint; every other host leaves it out and gets the placeholder.
  instantRows = null,
}) => {
  const [use24hPref] = useUse24h();
  const use24h = use24hProp ?? use24hPref;
  const clock = (t) => formatClockTime(t, use24h);
  const { branchId } = useBranch();
  const { org: orgForNav, paymentMethods, orgSettings, staffLabel, staffLabelPlural, allowStaffOverlap, multiServiceBookings } = useOrg();
  const navigate = useNavigate();
  const cancelReasonOptions = orgSettings?.cancellation_reasons?.length
    ? orgSettings.cancellation_reasons
    : CANCEL_REASON_OPTIONS;
  // ZNLY-235: a login that cannot see prices gets no Discount / Payment tabs and no Collect payment (never shown then erroring).
  const { profile: viewerProfile } = useAuth();
  const canViewPrices = viewerAccess(viewerProfile).canViewPrices;
  // A restricted login cannot read a booking back after writing it, so the only writes it gets are status, check-in and notes (each a
  // definer RPC in migration 393). Everything else is removed, not shown-then-failing.
  const restricted = isRestricted(viewerProfile);
  if (restricted) { onEditBooking = undefined; onAddServiceStart = undefined; onRebookStart = undefined; onRescheduleStart = undefined; }
  const [activeTab, setActiveTab] = useState('details');
  const [isFirstBooking, setIsFirstBooking] = useState(false);
  const [selectedTherapists, setSelectedTherapists] = useState([]);
  // ZNLY-312: callers that pass no day data (everything but the calendar's day view) get Free / Busy / Off from the panel's own
  // fetch of the booking's day. Own-only logins keep the plain list: RLS hides colleagues' bookings, so everyone would look Free.
  const ownOnlyViewer = viewerAccess(viewerProfile).ownOnly;
  const ownDay = useDayAvailability({
    branchId: booking?.branchId || branchId,
    date: booking?.date,
    enabled: !!(isOpen && activeTab === 'assign' && booking?.bookingId && dayBookings == null && !ownOnlyViewer),
    refreshKey: `${booking?.therapist?.id || ''}|${(booking?.therapists || []).map((t) => t.id).join(',')}`,
  });
  const effDayBookings = dayBookings ?? (ownDay.ready ? ownDay.bookings : null);
  const effOffStaff = dayBookings != null ? offStaff : (ownDay.ready ? ownDay.offById : offStaff);
  const [selectedRoom, setSelectedRoom] = useState('');
  // Per-companion (non-primary therapist) room override for couple bookings where each
  // person is in a separate room — { [therapistId]: roomId }. Primary therapist (index 0
  // of selectedTherapists) always uses selectedRoom above.
  const companionPhone = usePhoneState('');
  const [notes, setNotes] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [payTicks, setPayTicks] = useState(null); // checkout of a 2+ service booking: ticked service ids (null = all ticked); reset each time checkout opens
  useEffect(() => { if (showPaymentModal) setPayTicks(null); }, [showPaymentModal]);
  const [addClientSignal, setAddClientSignal] = useState(0); // ZNLY-327: the Payment tab's "＋ Add client" opens the header's client list
  // Products added to this visit (V26, product_sales.booking_id): read-only lines on the Payment tab; a manager/admin can refund one.
  const [visitProducts, setVisitProducts] = useState([]);
  const [visitProductRefund, setVisitProductRefund] = useState(null); // the sale awaiting a refund confirmation
  // Keeps "Print invoice" reachable for a booking invoiced before billing was
  // later disabled — the invoice data isn't orphaned, only this button would
  // be if it hid unconditionally on the toggle. See CustomerPaymentsTab for the
  // batched equivalent over a list; this is a single booking.
  const [hasExistingInvoice, setHasExistingInvoice] = useState(false);
  // Admin correction — inline mode replacing the tab bar/content with an
  // edit-everything form (no separate popup modal). `showAdminCorrection`
  // toggles the mode; the rest is the form's own local state.
  const [showAdminCorrection, setShowAdminCorrection] = useState(false);
  const [correctionMode, setCorrectionMode] = useState('correct'); // 'correct' | 'delete'
  const [correctionFields, setCorrectionFields] = useState(null);
  const [correctionInitialFields, setCorrectionInitialFields] = useState(null);
  const [correctionReason, setCorrectionReason] = useState('');
  const [correctionDeleteText, setCorrectionDeleteText] = useState('');
  const [correctionConfirming, setCorrectionConfirming] = useState(null); // null | 'discard' | 'save'
  const [correctionSubmitting, setCorrectionSubmitting] = useState(false);
  const [correctionError, setCorrectionError] = useState(null);
  // Payment tab, correction mode — keyed by payment.id -> string input value.
  // Separate from correctionFields since it writes through a different RPC
  // (admin_correct_payment_amount, one call per changed row) than the rest
  // of the correction form (admin_correct_booking, one batched call).
  const [correctionPaymentAmounts, setCorrectionPaymentAmounts] = useState({});
  const [correctionPaymentInitialAmounts, setCorrectionPaymentInitialAmounts] = useState({});
  // Payment mode per row, same keying — writes through correctPaymentMode()
  // (migration-237) alongside correctPaymentAmount() when both changed.
  const [correctionPaymentModes, setCorrectionPaymentModes] = useState({});
  const [correctionPaymentInitialModes, setCorrectionPaymentInitialModes] = useState({});
  // Discount tab, correction mode — a %/Fixed toggle like the normal Apply
  // Discount form, kept separate from the shared discountType/discountValue
  // state so entering/leaving correction mode never perturbs the normal
  // (non-correction) Discount tab's own in-progress entry. Recomputes into
  // correctionFields.discount_amount — the single source of truth also
  // shown as a flat NPR value on the Booking Details tab.
  const [correctionDiscountType, setCorrectionDiscountType] = useState('percentage');
  const [correctionDiscountValue, setCorrectionDiscountValue] = useState('');
  const [correctingPayment, setCorrectingPayment] = useState(null);
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [editSlot, setEditSlot] = useState(null); // the shared booking form (QuickCreatePanel in Edit mode) opened from the pencil / Edit details, for hosts that don't render it themselves
  const [removeRow, setRemoveRow] = useState(null); // ZNLY-402 piece 5: the service row being removed from this booking (screen D)
  const [pendingStatus, setPendingStatus] = useState(null); // 'cancelled' while confirm dialog is open

  // Edit mode state
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [editError, setEditError] = useState(null);
  const [referredByOpen, setReferredByOpen] = useState(false);

  // Discount state
  const [discountType, setDiscountType] = useState('percentage');
  const [discountValue, setDiscountValue] = useState('');
  const [discountReason, setDiscountReason] = useState('');
  const [discountError, setDiscountError] = useState(null);
  const [discountSuccess, setDiscountSuccess] = useState(false);
  // Member discount in the Discount tab (V22 addendum A)
  const [memberCtx, setMemberCtx] = useState(null);
  const [memberBusy, setMemberBusy] = useState(false);
  const [showManualDiscount, setShowManualDiscount] = useState(false);
  // Approver routing when a discount exceeds the user's limit
  const [approvers, setApprovers] = useState([]);
  const [selectedApprover, setSelectedApprover] = useState('');
  // Per-row discount override: { [bookingId]: '10' } — lets each selected service get its
  // own rate instead of the shared discountValue prorated/applied across the whole selection.
  const [rowDiscountOverrides, setRowDiscountOverrides] = useState({});

  // Add another service / Rebook state

  // Who created this booking (lazy-loaded on open)
  const [creator, setCreator] = useState(null);
  const [customerReferral, setCustomerReferral] = useState(null);
  const [rewardAmount, setRewardAmount] = useState('');
  const [rewardSubmitting, setRewardSubmitting] = useState(false);
  const [rewardError, setRewardError] = useState(null);

  // Discount tab: same-day related bookings for combined discount application
  const [relatedBookings, setRelatedBookings] = useState([]);
  // ZNLY-402 piece 4: every row of this booking (visit_id) for the constant "This booking" block. Only fetched when the org setting is ON.
  // ZNLY-435: with the setting OFF the panel LOOKS the same, but group / same-day related bookings keep working as before (related list, discount ticks, paid siblings, checkout bundle).
  const legacyGroups = !multiServiceBookings;
  const [groupSiblings, setGroupSiblings] = useState([]);
  const [blockRows, setBlockRows] = useState(null); // null = not loaded yet
  const [blockReload, setBlockReload] = useState(0);
  const [rowBusy, setRowBusy] = useState(null);
  const [rowPicks, setRowPicks] = useState({});        // Staff tab of a multi-service booking: { [bookingId]: { ids, room } }
  const [failedName, setFailedName] = useState(null);
  const [perService, setPerService] = useState(false); // Discount tab: "Set a different discount per service"
  const pendingTabRef = useRef(null); // a click on another service keeps the tab you are on
  const holdTabRef = useRef(null);    // ZNLY-402 A4: Apply / Remove discount re-opens the panel on each saved row; this keeps the Discount tab through the whole loop
  // Every sibling (ZNLY-402 ON: the other bookings of this visit_id; OFF: formal group, or same customer_name+date), any payment_status — display only, never used for
  // bundling (see fetchGroupBookings). Keeps a paid sibling
  // visible from every other sibling's modal instead of silently vanishing.
  const [historyReload, setHistoryReload] = useState(0);
  const [correctionNote, setCorrectionNote] = useState(null);
  const [dueHolderSuggestions, setDueHolderSuggestions] = useState([]);
  const [selectedDiscountIds, setSelectedDiscountIds] = useState(new Set()); // includes current booking ID by default
  // Tracks the `activeTab:bookingId` pair the discount-selection state was last reset for, so a
  // same-tab/same-booking rerun of the effect below (e.g. paymentStatus changing after a
  // discount apply) doesn't wipe out staff's still-open selection — only a genuine tab switch or
  // booking switch should reset it.
  const discountResetKeyRef = useRef(null);

  // Previous due: this customer's outstanding balance from earlier visits (any date),
  // separate from `relatedBookings` (same-day services, used by the Discount tab).
  // Pre-selected by default so it's bundled into payment automatically.
  const [previousDueBookings, setPreviousDueBookings] = useState([]);
  const [previousDueFor, setPreviousDueFor] = useState(null); // the booking the list above was loaded for
  const [selectedPreviousDueIds, setSelectedPreviousDueIds] = useState(new Set());
  const [selectedRelatedIds, setSelectedRelatedIds] = useState(new Set());

  // This customer's membership wallet, if any — re-fetched every time the
  // Payment tab opens so the balance shown is always current, not cached
  // from whenever this booking was first loaded.
  const [membership, setMembership] = useState(null);

  // Load due-holder name suggestions for the split-payment typeahead.
  useEffect(() => {
    if (!showPaymentModal) return;
    let cancelled = false;
    fetchDueHolderNames(branchId).then(({ data }) => {
      if (!cancelled && Array.isArray(data)) setDueHolderSuggestions(data);
    });
    return () => { cancelled = true; };
  }, [showPaymentModal, branchId]);

  useEffect(() => {
    // ZNLY-207: also needed with billing on, to warn before a refund of an invoiced booking
    if (booking?.paymentStatus !== 'paid' || !booking?.bookingId) return;
    let cancelled = false;
    fetchInvoiceByBookingId(booking.bookingId).then(({ data }) => {
      if (!cancelled) setHasExistingInvoice(!!data);
    });
    return () => { cancelled = true; };
  }, [booking?.bookingId, booking?.paymentStatus]);

  // Pre-select current therapists/room when booking changes or assign tab opens
  useEffect(() => {
    if (booking) {
      const ids = booking.therapists?.length > 0
        ? booking.therapists.map(t => t.id)
        : (booking.therapist?.id ? [booking.therapist.id] : []);
      setSelectedTherapists(ids);
      setSelectedRoom(booking.roomId || '');
      companionPhone.reset(booking.companionPhone || '');
    }
  }, [booking?.bookingId]);

  // Reset edit state when booking changes
  useEffect(() => {
    setIsEditing(false);
    setEditError(null);
    setActionError(null);
    setShowAdminCorrection(false);
    setCorrectionConfirming(null);
    setCorrectionError(null);
    setCorrectionPaymentAmounts({});
    setCorrectionPaymentInitialAmounts({});
  }, [booking?.bookingId]);

  // "New" badge — this is the modal staff actually reach by clicking a booking card on the
  // Calendar (booking-details-assignment-modal is a separate route, /:orgSlug/bookings/:id).
  useEffect(() => {
    let cancelled = false;
    if (!booking?.bookingId) {
      setIsFirstBooking(false);
      return;
    }
    getCustomerFirstBookingFlag(booking.customerId, booking.bookingId, booking.date, booking.startTime, booking.isWalkIn).then((result) => {
      if (!cancelled) setIsFirstBooking(!!result.data?.isFirstBooking);
    });
    return () => { cancelled = true; };
  }, [booking?.bookingId, booking?.customerId, booking?.date, booking?.startTime]);

  useEffect(() => { setRowPicks({}); setPerService(false); }, [booking?.bookingId]);
  useEffect(() => {
    if (!isOpen || !booking?.bookingId) { setBlockRows(null); return undefined; }
    let cancelled = false;
    setBlockRows((prev) => (prev?.some((r) => r.id === booking.bookingId) ? prev : null)); // another booking's rows never stand in for this one
    fetchBookingServices({ visitId: booking.visitId, customerId: booking.customerId, bookingId: booking.bookingId }).then(({ data, error }) => { if (!cancelled) setBlockRows(error ? [] : (data || [])); });
    return () => { cancelled = true; };
  }, [isOpen, booking?.visitId, booking?.customerId, booking?.bookingId, booking?.status, booking?.paymentStatus, booking?.finalAmount, booking?.discountAmount, booking?.amountPaid, booking?.therapist?.id, booking?.startTime, blockReload]);
  // ZNLY-435: ONE layout. Every booking, in every org, is the "This booking" card (1 service = 1 row). Rows come from the fetch; the calendar hands
  // its day rows so the first paint is already the card (the fetch then refreshes it quietly). Until either has this booking: the placeholder, never another layout.
  const fetchedRows = blockRows?.some((r) => r.id === booking?.bookingId) ? blockRows : null;
  const usableInstant = instantRows?.some((r) => r.id === booking?.bookingId) ? instantRows : null;
  const block = useMemo(() => buildBookingBlock(fetchedRows || usableInstant || [], booking?.bookingId), [fetchedRows, usableInstant, booking?.bookingId]);
  const blockReady = block.rows.some((r) => r.id === booking?.bookingId);
  // Checkout (ZNLY-402 piece 5, B): every payable service is one equal row; the first TICKED one is the payment's main booking (the opened service when it is ticked).
  const payOrder = useMemo(() => {
    const ids = new Set([booking?.bookingId, ...relatedBookings.filter((rb) => !(multiServiceBookings && rb.status === 'Pending')).map((rb) => rb.id)]);
    return block.rows.filter((r) => ids.has(r.id) && !r.dead).map((r) => r.id);
  }, [block.rows, booking?.bookingId, relatedBookings, multiServiceBookings]);
  const payTicked = payTicks || new Set(payOrder);
  const payMainId = payTicked.has(booking?.bookingId) ? booking.bookingId : (payOrder.find((id) => payTicked.has(id)) || booking?.bookingId);
  const payNoneTicked = payOrder.every((id) => !payTicked.has(id));
  // One service as the checkout wants it (the opened booking, or one of the related raw rows).
  const payRowView = (id) => {
    const info = block.rows.find((r) => r.id === id);
    if (id === booking?.bookingId) return { id: booking.id, bookingId: booking.bookingId, bookingNumber: booking.id, booking_number: booking.id, branchId: booking.branchId, service: booking.service, base_amount: booking.baseAmount, discount_amount: booking.discountAmount, final_amount: booking.finalAmount, amountPaid: booking.amountPaid, dueHolderName: booking.dueHolderName, minutes: info?.minutes, staff: info?.staff?.join(', ') };
    const rb = relatedBookings.find((x) => x.id === id) || {};
    return { id: rb.booking_number, bookingId: rb.id, bookingNumber: rb.booking_number, booking_number: rb.booking_number, branchId: booking?.branchId, service: rb.service?.name, base_amount: rb.base_amount, discount_amount: rb.discount_amount, final_amount: rb.final_amount, amountPaid: 0, dueHolderName: booking?.dueHolderName, minutes: info?.minutes, staff: info?.staff?.join(', ') };
  };
  const togglePayTick = (id) => setPayTicks((prev) => { const n = new Set(prev || payOrder); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const payMainView = booking ? payRowView(payMainId) : null;
  const visitStatusFlow = block.rows.length > 1 && !!booking?.visitId && (pendingStatus === 'no show' || pendingStatus === 'cancelled');

  // Fetch related unpaid bookings when payment tab opens
  useEffect(() => {
    // ZNLY-402 A1 / ZNLY-435: the Details card shows the earlier balance and its "Collect payment" opens the checkout, so related services and the earlier balance load as soon as the panel opens (not only on the Payment / Discount tab).
    if (isOpen && booking) {
      // ZNLY-402: orgs with "Several services in one booking" ON: "related" = the rest of THIS visit (booking.visitId); no visit = none.
      // Every other org keeps the original rule: the booking group, else the same customer name + date.
      const fetchers = relatedFetchers(multiServiceBookings);
      const relatedPromise = fetchers.related(booking);
      if (legacyGroups && activeTab === 'payment') fetchers.siblings(booking).then(({ data }) => setGroupSiblings(data || []));
      else setGroupSiblings([]);
      const duePromise = (booking?.customerId || booking?.customerPhone)
        ? getCustomerOutstandingBalance({
            customerPhone: booking.customerPhone,
            customerId: booking.customerId,
            branchId,
            excludeBookingId: booking.bookingId,
          })
        : Promise.resolve({ data: { bookings: [] } });

      Promise.all([relatedPromise, duePromise]).then(([relatedResult, dueResult]) => {
        const related = relatedResult.data || [];
        setRelatedBookings(related);
        // Auto-bundled by default — staff can uncheck individual items, same
        // as previous-due below.
        // ZNLY-402 A3 (setting ON): a service still Pending is not bundled into the payment (the discount still covers it).
        setSelectedRelatedIds(new Set(related.filter(rb => !(multiServiceBookings && rb.status === 'Pending')).map(rb => rb.id)));

        const resetKey = `${activeTab}:${booking.bookingId}:${isOpen}`;
        if (discountResetKeyRef.current !== resetKey) {
          discountResetKeyRef.current = resetKey;
          // ZNLY-402 piece 4: with the setting ON the discount is for the whole booking: every unpaid service is in, no per-service ticking.
          setSelectedDiscountIds(new Set(multiServiceBookings ? [booking.bookingId, ...related.map(rb => rb.id)] : [booking.bookingId]));
          setSelectedApprover('');
          setDiscountSuccess(false);
          setRowDiscountOverrides({});
        }

        {
          // Exclude any booking already shown under "Related Services" — a real
          // same-visit sibling that's unpaid always also matches
          // getCustomerOutstandingBalance's phone-wide criteria, so without this it would be
          // double-counted in the Grand Total (see BK-20260908-0011/-0012 incident).
          const bookings = excludeRelatedFromPreviousDue(dueResult.data?.bookings, related);
          setPreviousDueBookings(bookings);
          setPreviousDueFor(booking.bookingId);
          // Auto-bundled by default — staff can uncheck individual items.
          setSelectedPreviousDueIds(new Set(bookings.map(b => b.bookingId)));
        }
      }).catch(err => {
        console.error('[BookingActionModal] related/previous-due bookings fetch failed:', err.message);
        setPreviousDueBookings([]);
        setSelectedPreviousDueIds(new Set());
        setSelectedRelatedIds(new Set());
      });
    }
    if (isOpen && activeTab === 'payment' && booking?.bookingId) {
      fetchMembershipForBooking(booking.bookingId).then(result => {
        setMembership(result.data || null);
      });
    } else if (isOpen && activeTab === 'payment') {
      setMembership(null);
    }
  }, [activeTab, booking?.bookingId, booking?.visitId, booking?.paymentStatus, booking?.customerPhone, branchId, isOpen, multiServiceBookings]);

  const loadVisitProducts = useCallback(async () => {
    if (!booking?.bookingId) { setVisitProducts([]); return; }
    const { data } = await fetchBookingProductSales({ bookingId: booking.bookingId });
    setVisitProducts(data || []);
  }, [booking?.bookingId]);
  useEffect(() => {
    if (isOpen && booking?.bookingId && PRODUCTS_ENABLED) loadVisitProducts(); else setVisitProducts([]);
  }, [isOpen, booking?.bookingId, booking?.paymentStatus, booking?.amountPaid, loadVisitProducts]);

  // Load who created this booking when the modal opens
  // Opening an unopened online booking acknowledges it for the whole team (migration-335). Fire and forget: never blocks the UI,
  // read-only roles don't call it, and the RPC itself only ever sets it once.
  const acknowledgedRef = useRef(null);
  useEffect(() => {
    if (isOpen && booking?.bookingId) {
      fetchBookingCreator(booking.bookingId).then(result => setCreator(result.data || null));
      if (userRole !== 'admin_viewer' && booking.createdBy == null && !booking.acknowledgedAt && acknowledgedRef.current !== booking.bookingId) {
        acknowledgedRef.current = booking.bookingId;
        acknowledgeBooking(booking.bookingId).then(() => fetchBookingCreator(booking.bookingId).then(result => setCreator(result.data || null)));
      }
    } else {
      setCreator(null);
    }
  }, [isOpen, booking?.bookingId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load the customer-to-customer referral attached to this booking (if this is
  // the referred customer's first booking) — distinct from the legacy free-text
  // referredBy field below.
  useEffect(() => {
    if (isOpen && booking?.bookingId) {
      fetchCustomerReferralForBooking(booking.bookingId).then(result => setCustomerReferral(result.data || null));
    } else {
      setCustomerReferral(null);
    }
  }, [isOpen, booking?.bookingId]);

  // Reset the reward picker each time a different booking's pending referral is shown
  useEffect(() => {
    setRewardAmount('');
    setRewardError(null);
  }, [customerReferral?.referralId]);

  // Admin correction: package sessions used on this booking (the one delete blocker the panel doesn't already hold).
  const [packageUses, setPackageUses] = useState(0);
  useEffect(() => {
    setPackageUses(0);
    if (showAdminCorrection && booking?.bookingId) fetchBookingPackageUseCount(booking.bookingId).then(setPackageUses).catch(() => {});
  }, [showAdminCorrection, booking?.bookingId]);
  const delBlock = showAdminCorrection ? deleteBlockers({
    payments: booking?.payments, refunds: booking?.refunds, tips: booking?.tips,
    hasReferral: !!customerReferral, packageUses, status: booking?.status, paymentStatus: booking?.paymentStatus,
  }) : null;
  // "Cancel and refund": the existing cancel path for a settled booking is the admin correction to Cancelled (the DB refunds the payments on that change).
  const cancelAndRefund = () => { setCorrectionMode('correct'); setCorrectionField('status', 'Cancelled'); };
  useEffect(() => { if (delBlock && correctionMode === 'delete') setCorrectionMode('correct'); }, [!!delBlock, correctionMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleResolveReferralReward = async () => {
    if (!customerReferral?.referralId) return;
    setRewardSubmitting(true);
    setRewardError(null);
    try {
      const { error } = await resolveCustomerReferralReward({
        referralId: customerReferral.referralId,
        rewardType: 'wallet',
        rewardAmount: rewardAmount ? Number(rewardAmount) : null,
        rewardCatalogId: null,
      });
      if (error) {
        setRewardError(friendlyError(error, 'Failed to save reward. Please try again.'));
        return;
      }
      const refreshed = await fetchCustomerReferralForBooking(booking.bookingId);
      setCustomerReferral(refreshed.data || null);
    } catch (err) {
      setRewardError(friendlyError(err, 'Failed to save reward. Please try again.'));
    } finally {
      setRewardSubmitting(false);
    }
  };

  // Member discount for the Discount tab: re-read whenever the tab opens or the booking's amounts change.
  const memberBookingId = booking?.bookingId;
  const loadMemberCtx = useCallback(async () => {
    if (!MEMBERSHIP_ENABLED || !memberBookingId) { setMemberCtx(null); return; }
    const { data } = await fetchMemberDiscountContext([memberBookingId]);
    setMemberCtx(data?.[memberBookingId] || null);
  }, [memberBookingId]);
  useEffect(() => {
    if (isOpen && activeTab === 'discount') loadMemberCtx();
  }, [isOpen, activeTab, loadMemberCtx, booking?.discountAmount, booking?.finalAmount, booking?.paymentStatus]);
  useEffect(() => { setShowManualDiscount(false); }, [memberBookingId]);

  // Load eligible approvers the first time the discount tab is opened
  useEffect(() => {
    if (isOpen && activeTab === 'discount' && approvers.length === 0) {
      fetchDiscountApprovers().then(result => setApprovers(result.data || []));
    }
  }, [isOpen, activeTab]);

  const tabs = [
    { id: 'details', label: 'Details', labelFull: 'Booking Details', icon: 'FileText' },
    { id: 'assign', label: 'Assigned', labelFull: 'Assigned', icon: 'UserCheck' },
    { id: 'discount', label: 'Discount', labelFull: 'Discount', icon: 'Percent' },
    { id: 'payment', label: 'Payment', labelFull: 'Payment', icon: 'CreditCard' }
  ].filter((t) => canViewPrices || (t.id !== 'discount' && t.id !== 'payment'));

  // Valid next-status transitions (lowercase UI values)
  const getNextStatuses = (currentStatus) => {
    const transitions = {
      // "No show" is offered from Pending/Confirmed everywhere (api.js VALID_TRANSITIONS allows it); in the panel it is gated until the
      // booking's scheduled time (see noShowGated below), and both variants ask for confirmation first.
      'pending': ['confirmed', 'cancelled', 'no show'],
      'confirmed': ['in-progress', 'cancelled', 'no show'],
      'in-progress': ['completed'],
    };
    return transitions[currentStatus] || [];
  };

  // Service preview when editing
  const selectedService = useMemo(() => {
    if (!isEditing || !editForm.serviceId || !services?.length) return null;
    return services.find(s => s.id === editForm.serviceId);
  }, [isEditing, editForm.serviceId, services]);

  // Manual-block overlap warnings (client-side, warn-only): editing the date/time, and the
  // Reschedule/Rebook/Add-service form. Both disable their save button while overlapping.
  const currentDurationMin = parseInt(booking?.duration, 10) || 60;
  const bookingTherapistIds = (booking?.therapists || []).map((d) => d.id);
  const { message: editBlockMsg } = useBlockOverlap(branchId, {
    date: editForm.date,
    startTime: editForm.startTime,
    durationMinutes: selectedService?.duration_minutes || currentDurationMin,
    therapistIds: bookingTherapistIds,
    roomId: booking?.roomId || null,
  }, !!isEditing);
  // Extend-duration options (same service, category, longer duration)
  const [showExtendPanel, setShowExtendPanel] = useState(false);
  const extendPanelRef = useRef(null);
  const [extendError, setExtendError] = useState(null);
  const [extendSubmitting, setExtendSubmitting] = useState(false);


  const currentServiceObj = useMemo(() => {
    if (!booking?.serviceId || !services?.length) return null;
    return services.find(s => s.id === booking.serviceId) || null;
  }, [booking?.serviceId, services]);

  const extendOptions = useMemo(
    () => getExtendOptions(currentServiceObj, services),
    [currentServiceObj, services]
  );

  // Auto-scroll to the extend panel once it renders, so the option list is
  // immediately visible instead of hidden below the fold.
  useEffect(() => {
    if (showExtendPanel && extendPanelRef.current) {
      extendPanelRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [showExtendPanel]);

  // ── Error guidance (ZNLY-365): every refused save becomes a ✦ card (or the calm system card); field checks stay plain text ──
  const errCtx = (extra) => ({
    staffLabel, staffLabelPlural, hasRooms: (rooms || []).length > 0, staffName: booking?.therapists?.[0]?.name,
    serviceName: booking?.service, startTime: booking?.startTime?.slice(0, 5), endTime: booking?.endTime?.slice(0, 5),
    status: booking?.status ? booking.status.charAt(0).toUpperCase() + booking.status.slice(1) : undefined, isPaid: booking?.paymentStatus === 'paid',
    customerName: booking?.customerName, ...extra,
  });
  const guideFor = (error, extra) => describeError(error, errCtx(extra));
  const retryRef = useRef(null);
  const [guideNote, setGuideNote] = useState('');
  // Fix buttons only fill or open something. Nothing here saves.
  const onGuideAction = (a) => {
    switch (a.intent) {
      case 'show-calendar': onClose?.(); break;
      case 'set-discount-percent': setDiscountType('percentage'); setDiscountValue(String(a.value)); setDiscountError(null); setGuideNote(''); break;
      case 'explain-manager': setGuideNote('Managers and admins can give a bigger discount. Ask one of them to apply it for you.'); break;
      case 'explain-admin': setGuideNote('An admin can correct a completed or paid booking. Every change is logged.'); break;
      case 'open-staff': setActiveTab('assign'); break;
      case 'retry': { const r = retryRef.current; if (r) r(); break; }
      default: break;
    }
  };

  const handleExtendService = async (option) => {
    if (!booking || !onEditBooking) return;
    setExtendError(null);
    setExtendSubmitting(true);
    try {
      const result = await onEditBooking(booking.bookingId, { serviceId: option.id }, { inline: true });
      if (result?.error) {
        retryRef.current = () => handleExtendService(option);
        setExtendError(guideFor(result.error));
      } else {
        setShowExtendPanel(false);
      }
    } catch (error) {
      retryRef.current = () => handleExtendService(option);
      setExtendError(guideFor(error));
    } finally {
      setExtendSubmitting(false);
    }
  };

  const startEditing = () => {
    setEditForm(editFormSeed(booking));
    setEditError(null);
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setEditError(null);
  };

  // ZNLY-327: a phone typed in Edit details must be a real number for its country; a number left untouched always saves as stored.
  const editPhoneProblem = phoneFieldProblem({ dial: editForm.phoneDial, national: editForm.phoneNational, original: editForm.customerPhone, walkInHint: true });
  const handleSaveEdit = async () => {
    if (!booking || !onEditBooking) return;
    setEditError(null);

    const walkInEdit = isClientlessWalkIn(booking);
    if (!walkInEdit && !editForm.customerName.trim()) {
      setEditError('Customer name is required.');
      return;
    }
    if (editBlockMsg) return;
    if (!walkInEdit && editPhoneProblem) { setEditError(editPhoneProblem); return; }

    // Only what the user changed is sent (ZNLY-330); nothing changed just closes the form.
    const updates = editChanges(editForm, booking, phoneFieldValue({ dial: editForm.phoneDial, national: editForm.phoneNational, original: editForm.customerPhone }));
    if (Object.keys(updates).length === 0) { setIsEditing(false); return; }

    setIsLoading(true);
    try {
      const result = await onEditBooking(booking.bookingId, updates, { inline: true });
      if (result?.error) {
        retryRef.current = () => handleSaveEdit();
        setEditError(guideFor(result.error));
      } else {
        setIsEditing(false);
      }
    } catch (error) {
      retryRef.current = () => handleSaveEdit();
      setEditError(guideFor(error));
    } finally {
      setIsLoading(false);
    }
  };

  // ── Time options for new booking forms ──
  const timeOptions = useMemo(() => {
    const [openH] = (branchHours?.openTime || '09:00:00').split(':').map(Number);
    const [closeH, closeM] = (branchHours?.closeTime || '21:00:00').split(':').map(Number);
    const opts = [];
    for (let h = openH; h <= closeH; h++) {
      for (let m = 0; m < 60; m += 15) {
        if (h === closeH && m > closeM) break;
        opts.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
      }
    }
    return opts;
  }, [branchHours]);

  // TimeBoxInput lets staff type any time, unlike the old dropdown which only
  // ever offered times inside branch hours — not a hard rule (nothing blocks
  // this server-side either), just a heads-up so an out-of-hours edit isn't
  // silent.
  const isWithinBranchHours = (time24) => {
    const [h, m] = time24.split(':').map(Number);
    const minutes = h * 60 + m;
    const [openH, openM] = (branchHours?.openTime || '09:00:00').split(':').map(Number);
    const [closeH, closeM] = (branchHours?.closeTime || '21:00:00').split(':').map(Number);
    return minutes >= openH * 60 + openM && minutes <= closeH * 60 + closeM;
  };

  // ── Admin correction (inline) ──────────────────────────────
  const openCorrection = () => {
    const initial = correctionFieldsFromBooking(booking);
    setCorrectionInitialFields(initial);
    setCorrectionFields(initial);
    const paymentAmounts = {};
    const paymentModes = {};
    (booking?.payments || []).forEach((p) => {
      if (!p.id) return;
      paymentAmounts[p.id] = String(p.amount);
      paymentModes[p.id] = p.paymentMode;
    });
    setCorrectionPaymentInitialAmounts(paymentAmounts);
    setCorrectionPaymentAmounts(paymentAmounts);
    setCorrectionPaymentInitialModes(paymentModes);
    setCorrectionPaymentModes(paymentModes);
    // Reverse the current discount into a starting %/Fixed toggle state —
    // percentage by default, matching the proportion already applied.
    const basePct = booking?.baseAmount > 0
      ? Math.round((Number(booking.discountAmount || 0) / booking.baseAmount) * 100)
      : 0;
    setCorrectionDiscountType('percentage');
    setCorrectionDiscountValue(basePct > 0 ? String(basePct) : '');
    setCorrectionMode('correct');
    setCorrectionReason('');
    setCorrectionDeleteText('');
    setCorrectionError(null);
    setCorrectionConfirming(null);
    setShowAdminCorrection(true);
  };

  // The %/Fixed toggle is a draft, previewed live on the Discount tab itself,
  // but only written into correctionFields.discount_amount — the field that
  // actually feeds admin_correct_booking, the footer's "changed" count, and
  // the Payment tab's summary — when the admin explicitly clicks Apply.
  const correctionDiscountComputed = () => {
    const value = Number(correctionDiscountValue) || 0;
    return correctionDiscountType === 'percentage'
      ? Math.round((Number(correctionFields?.base_amount) || 0) * (value / 100))
      : value;
  };
  const applyCorrectionDiscount = () => {
    setCorrectionField('discount_amount', String(correctionDiscountComputed()));
  };
  const cancelCorrectionDiscount = () => {
    const original = correctionInitialFields?.discount_amount ?? '';
    setCorrectionField('discount_amount', original);
    const base = Number(correctionInitialFields?.base_amount) || 0;
    const basePct = base > 0 ? Math.round((Number(original || 0) / base) * 100) : 0;
    setCorrectionDiscountType('percentage');
    setCorrectionDiscountValue(basePct > 0 ? String(basePct) : '');
  };

  const correctionChangedFields = useMemo(() => {
    if (!correctionFields || !correctionInitialFields) return {};
    const out = {};
    for (const f of CORRECTABLE_FIELDS) {
      const next = correctionFields[f.value];
      const prev = correctionInitialFields[f.value];
      if (String(next) !== String(prev) && !(next === '' && prev === '')) {
        out[f.value] = f.kind === 'number' ? Number(next) : next;
      }
    }
    // Assigned tab, correction mode only — admin_correct_booking's whitelist
    // covers a single therapist_id/room_id (not the multi-therapist
    // booking_therapists junction the normal Assign flow supports), so this
    // only picks up the primary therapist. Reuses the same selectedTherapists/
    // selectedRoom state the ordinary Assign tab UI already edits.
    if (showAdminCorrection) {
      const origTherapistId = booking?.therapists?.[0]?.id || booking?.therapist?.id || null;
      const nextTherapistId = selectedTherapists[0] || null;
      if (nextTherapistId !== origTherapistId) out.therapist_id = nextTherapistId;
      const origRoomId = booking?.roomId || null;
      const nextRoomId = selectedRoom || null;
      if (nextRoomId !== origRoomId) out.room_id = nextRoomId;
    }
    return out;
  }, [correctionFields, correctionInitialFields, showAdminCorrection, selectedTherapists, selectedRoom, booking]);
  const correctionChangedCount = Object.keys(correctionChangedFields).length;

  // Payment tab — diff against the same booking.payments rows the tab
  // already renders. Scoped to this booking's own payments only (not the
  // "Other Day Services"/previous-due bundling shown elsewhere on the tab,
  // which belongs to a different booking entirely and stays read-only).
  const correctionPaymentChanged = useMemo(() => {
    const out = {};
    const ids = new Set([...Object.keys(correctionPaymentAmounts), ...Object.keys(correctionPaymentModes)]);
    for (const id of ids) {
      const nextAmount = correctionPaymentAmounts[id];
      const prevAmount = correctionPaymentInitialAmounts[id];
      const amountChanged = nextAmount !== '' && Number(nextAmount) !== Number(prevAmount);
      const nextMode = correctionPaymentModes[id];
      const prevMode = correctionPaymentInitialModes[id];
      const modeChanged = nextMode && nextMode !== prevMode;
      if (amountChanged || modeChanged) {
        out[id] = {
          ...(amountChanged ? { amount: Number(nextAmount) } : {}),
          ...(modeChanged ? { mode: nextMode } : {}),
        };
      }
    }
    return out;
  }, [correctionPaymentAmounts, correctionPaymentInitialAmounts, correctionPaymentModes, correctionPaymentInitialModes]);
  const correctionPaymentChangedCount = Object.keys(correctionPaymentChanged).length;

  const correctionReasonOk = correctionReason.trim().length >= CORRECTION_REASON_MIN;
  const correctionDeleteConfirmed = correctionDeleteText.trim().toUpperCase() === 'DELETE';
  const correctionIsDirty = correctionMode === 'correct'
    ? (correctionChangedCount > 0 || correctionPaymentChangedCount > 0 || correctionReason.trim().length > 0)
    : (correctionDeleteText.trim().length > 0 || correctionReason.trim().length > 0);

  const setCorrectionField = (field, value) => setCorrectionFields((prev) => ({ ...prev, [field]: value }));
  const setCorrectionPaymentAmount = (paymentId, value) =>
    setCorrectionPaymentAmounts((prev) => ({ ...prev, [paymentId]: value }));
  const setCorrectionPaymentMode = (paymentId, value) =>
    setCorrectionPaymentModes((prev) => ({ ...prev, [paymentId]: value }));

  // Shared by the header X and the inline footer's Discard button while in
  // correction mode — only interrupts with a confirmation when there's
  // actually something unsaved to lose.
  const requestCorrectionClose = () => {
    if (correctionIsDirty) { setCorrectionConfirming('discard'); return; }
    setShowAdminCorrection(false);
  };

  const requestCorrectionSave = () => {
    setCorrectionError(null);
    if (correctionMode === 'delete') {
      if (!correctionDeleteConfirmed) { setCorrectionError('Type DELETE to confirm.'); return; }
    } else if (correctionChangedCount === 0 && correctionPaymentChangedCount === 0) {
      setCorrectionError('Change at least one field before saving.');
      return;
    }
    if (correctionFields?._phone) {
      const phoneIssue = phoneFieldProblem({ ...correctionFields._phone, original: correctionInitialFields?.customer_phone });
      if (phoneIssue) { setCorrectionError(phoneIssue); return; }
    }
    // Reason is collected in the confirm dialog itself, right before submit —
    // not required to already be filled in while still editing.
    setCorrectionConfirming('save');
  };

  const runCorrectionSubmit = async () => {
    setCorrectionSubmitting(true);
    setCorrectionError(null);

    if (correctionMode === 'delete') {
      const { error: rpcError } = await adminDeleteBooking({
        bookingId: booking.bookingId,
        reason: correctionReason.trim(),
      });
      setCorrectionSubmitting(false);
      if (rpcError) {
        setCorrectionError(friendlyError(rpcError, 'Failed to delete booking.'));
        return;
      }
      setCorrectionConfirming(null);
      setShowAdminCorrection(false);
      if (onClose) onClose();
      return;
    }

    let bookingSaved = false;
    if (correctionChangedCount > 0) {
      const { error: rpcError } = await adminCorrectBooking({
        bookingId: booking.bookingId,
        changes: correctionChangedFields,
        reason: correctionReason.trim(),
      });
      if (rpcError) {
        setCorrectionSubmitting(false);
        setCorrectionError(friendlyError(rpcError, 'Failed to correct booking.'));
        return;
      }
      bookingSaved = true;
      // Snapshot so a retry (if the payment leg below fails) won't resend
      // already-saved booking fields.
      setCorrectionInitialFields(correctionFields);
    }

    if (correctionPaymentChangedCount > 0) {
      // One admin_correct_payment_mode/admin_correct_payment_amount call per
      // changed row — different RPCs/table than admin_correct_booking, so
      // this can't be batched the same way. Stop at the first failure rather
      // than racing ahead through rows that would leave a confusing partial-
      // success state; already-committed rows stay committed (each is its
      // own audited transaction) and the error names which row failed so a
      // retry doesn't re-submit rows that already succeeded.
      for (const [paymentId, changes] of Object.entries(correctionPaymentChanged)) {
        if (changes.mode) {
          const { error: rpcError } = await correctPaymentMode({
            paymentId,
            newMode: changes.mode,
            reason: correctionReason.trim(),
          });
          if (rpcError) {
            setCorrectionSubmitting(false);
            setCorrectionError(
              (bookingSaved ? 'Booking changes saved. ' : '')
              + `Failed to correct payment ${paymentId}: ${friendlyError(rpcError, 'please try again.')}`
            );
            return;
          }
          setCorrectionPaymentInitialModes((prev) => ({ ...prev, [paymentId]: changes.mode }));
        }
        if (changes.amount !== undefined) {
          const { error: rpcError } = await correctPaymentAmount({
            paymentId,
            newAmount: changes.amount,
            reason: correctionReason.trim(),
          });
          if (rpcError) {
            setCorrectionSubmitting(false);
            setCorrectionError(
              (bookingSaved ? 'Booking changes saved. ' : '')
              + (changes.mode ? 'Payment method corrected, but the ' : 'Failed to correct payment ')
              + `${paymentId}${changes.mode ? ' amount correction failed: ' : ': '}`
              + (friendlyError(rpcError, 'please try again.'))
            );
            return;
          }
          setCorrectionPaymentInitialAmounts((prev) => ({ ...prev, [paymentId]: String(changes.amount) }));
        }
      }
    }

    setCorrectionSubmitting(false);
    setCorrectionConfirming(null);
    setShowAdminCorrection(false);
    if (onClose) onClose();
  };

  const handleStatusUpdate = async (newStatus, reason) => {
    if (!booking) return;
    setIsLoading(true);
    setActionError(null);
    try {
      if (onUpdateStatus) {
        const updated = await onUpdateStatus(booking.bookingId, newStatus, reason, { inline: true });
        if (updated?.error) {
          retryRef.current = () => handleStatusUpdate(newStatus, reason);
          setActionError(guideFor(updated.error));
          setPendingStatus(null);
          return;
        }
      }
      setPendingStatus(null);
      if (variant === 'panel') {
        // The panel stays open on the updated booking instead of closing.
        await onRefreshBooking?.(booking.bookingId);
      } else {
        onClose();
      }
    } catch (error) {
      retryRef.current = () => handleStatusUpdate(newStatus, reason);
      setActionError(guideFor(error));
    } finally {
      setIsLoading(false);
    }
  };

  const handlePaymentConfirm = async (payload) => {
    const { tenders, additionalAllocations, dueHolderName, notes: paymentNotes, tipSplits } = payload;
    const payId = payMainId || booking.bookingId;   // the main (first ticked) service pays first, the others follow as allocations
    if (!booking || !onRecordPayment) return { error: { message: 'No payment handler available.' } };
    setPaymentSubmitting(true);
    setActionError(null);
    try {
      // Atomic path: the parent opted in via onGroupPaymentRecorded — pay
      // the primary booking + every allocation in ONE transaction
      // (migration-178, every tender type supported), instead of N
      // sequential onRecordPayment calls that can't be rolled back if one
      // fails partway through (payments rows are immutable). This closes
      // the partial-bundle failure mode, not just the stale-related-list
      // display bug the BK-20260915-0025/-0026/-0027 incident also had.
      // Products on the bill (V26) go through the one shared submit (services/checkoutSubmit.js, ZNLY-233): with products it is ONE call
      // (products + stock + treatment payment); without, `treatment` below runs as it always did.
      return await submitCheckout({
        bookingId: payId,
        payload,
        onSaved: async () => { if (onGroupPaymentRecorded) onGroupPaymentRecorded(); else await onRefreshBooking?.(booking.bookingId); },
        treatment: async () => {
        if (onGroupPaymentRecorded) {
          const { data, error } = await recordGroupPayment([
            { bookingId: payId, tenders, dueHolderName, notes: paymentNotes },
            ...(additionalAllocations || []).map((alloc) => ({ bookingId: alloc.bookingId, tenders: alloc.tenders, notes: paymentNotes })),
          ]);
          if (error) return { error };

          // Tip is a separate, independent write (booking_tips, migration-240) with
          // no FK/trigger relationship to `payments` — safe to log here too, even
          // though the payments themselves went through the atomic group RPC.
          // Best-effort, attributed to the primary booking only (never split across
          // the bundle) — a failure here must never undo the payment that already
          // succeeded.
          for (const split of (tipSplits || [])) {
            const tipResult = await recordTip({ bookingId: payId, amount: split.amount, receivedBy: split.receivedBy });
            if (tipResult.error) console.warn('[Tips] recordTip failed:', tipResult.error.message);
          }

          // Checkout stays open on its success state until staff press Done (see onClose below).
          onGroupPaymentRecorded();
          return { data: data?.[0], error: null };
        }

        const result = await onRecordPayment(payId, { tenders, dueHolderName, notes: paymentNotes, tipSplits });
        if (result?.error) return result;

        // Pay each bundled previous-due/related booking with its own allocated
        // tenders (PaymentModal splits the entered amount across bookings and
        // methods). The parent above already succeeded — a failure here must be
        // surfaced, not swallowed, since staff would otherwise see "Paid" on the
        // parent and wrongly assume the whole bundle settled (see BK-20260913-0037
        // incident: a bundled Jacuzzi payment failed silently and stayed unpaid).
        const failedAllocations = [];
        for (const alloc of (additionalAllocations || [])) {
          const allocResult = await onRecordPayment(alloc.bookingId, { tenders: alloc.tenders, notes: paymentNotes });
          if (allocResult?.error) {
            failedAllocations.push(alloc.bookingNumber || alloc.bookingId);
          }
        }

        // Stay open on the Payment tab (rather than closing the whole modal) so
        // staff immediately see the refreshed status, balance, and — for members —
        // the updated wallet amount, instead of having to reopen the booking.
        if (failedAllocations.length > 0) {
          setActionError(`Payment recorded for this booking, but failed for: ${failedAllocations.join(', ')}. Open ${failedAllocations.length > 1 ? 'those bookings' : 'that booking'} directly and record payment again.`);
        }
        return result;
        },
      });
    } finally {
      setPaymentSubmitting(false);
    }
  };

  // ── Panel variant: dirty guard + overflow menu ───────────────────────────────────────────
  const isPanel = variant === 'panel';
  const [panelConfirm, setPanelConfirm] = useState(null); // { type: 'close' | 'switch', action? }
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef(null);
  // ZNLY-285: below md the panel is a two-detent bottom sheet (half / full) instead of the right-hand SidePanel.
  const phoneViewport = useMediaQuery('(max-width: 767px)');
  const useSheet = isPanel && phoneViewport;
  const [detent, setDetent] = useState('half');
  useEffect(() => { if (!isOpen) setDetent('half'); }, [isOpen]);
  // Anything that needs room (edit, payment, + Service, Extend) opens the sheet fully.
  useEffect(() => {
    if (useSheet && isOpen && (isEditing || showExtendPanel || showPaymentModal)) setDetent('full');
  }, [useSheet, isOpen, isEditing, showExtendPanel, showPaymentModal]);
  // Two-column Customer | Service layout only when the panel body is >= 520px wide (container-based, not viewport-based).
  const bodyRef = useRef(null);
  const [wideBody, setWideBody] = useState(false);
  // Footer width, to collapse the lowest-priority visible actions into ⋯ so the footer never wraps.
  const footerRef = useRef(null);
  const [footerW, setFooterW] = useState(0);
  useEffect(() => {
    if (!isPanel || !booking) return undefined;
    const ro = new ResizeObserver(() => {
      if (bodyRef.current) setWideBody(bodyRef.current.getBoundingClientRect().width >= 520);
      if (footerRef.current) setFooterW(footerRef.current.getBoundingClientRect().width);
    });
    if (bodyRef.current) ro.observe(bodyRef.current);
    if (footerRef.current) ro.observe(footerRef.current);
    return () => ro.disconnect();
  }, [isPanel, booking?.bookingId]);
  const bookingTherapistIdsStr = booking
    ? (booking.therapists?.length > 0 ? booking.therapists.map(t => t.id) : (booking.therapist?.id ? [booking.therapist.id] : [])).slice().sort().join(',')
    : '';
  // Open forms count as unsaved only when a value really differs from where it started (ZNLY-326). The extend panel holds no
  // value (picking an option applies at once), so opening it alone is never dirty.
  const formDirty = !!booking && (
    (isEditing && editFormChanged(editForm, booking))
  );
  const isDirty = !!booking && (
    formDirty
    || !!String(discountValue || '').trim() || !!String(discountReason || '').trim()
    || (selectedTherapists.slice().sort().join(',') !== bookingTherapistIdsStr)
    || ((selectedRoom || '') !== (booking.roomId || ''))
    || block.rows.some((r) => rowChanged(r, rowPicks))
    || Object.values(rowDiscountOverrides || {}).some((v) => String(v ?? '').trim())
  );
  useEffect(() => {
    if (!guardRef) return undefined;
    guardRef.current = (action) => {
      if (isPanel && isDirty) setPanelConfirm({ type: 'switch', action });
      else action();
    };
    return () => { guardRef.current = null; };
  });
  useEffect(() => { setPanelConfirm(null); setMoreOpen(false); if (booking) { setActiveTab(holdTabRef.current || pendingTabRef.current || initialTab || 'details'); pendingTabRef.current = null; } }, [booking?.bookingId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!moreOpen) return undefined;
    const onDown = (e) => { if (moreRef.current && !moreRef.current.contains(e.target)) setMoreOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [moreOpen]);
  // Leaving Edit details for another tab: unsaved edits go through the same discard confirm as closing; a clean form switches at once.
  const goTab = (id) => {
    const go = () => { setActiveTab(id); setActionError(null); if (id !== 'details') setIsEditing(false); };
    if (isEditing && id !== 'details' && editFormChanged(editForm, booking)) setPanelConfirm({ type: 'switch', action: go });
    else go();
  };
  const requestPanelClose = () => {
    if (isDirty) setPanelConfirm({ type: 'close' });
    else onClose?.();
  };
  // Leaving for another page goes through the same unsaved-changes guard as closing.
  const requestPanelCloseThen = (go) => {
    if (isDirty) setPanelConfirm({ type: 'switch', action: go });
    else go();
  };

  // Collapsing full -> half closes any edit / extend / add form; unsaved edits go through the same discard guard as closing.
  const changeDetent = (next) => {
    if (next !== 'half') { setDetent(next); return; }
    const collapse = () => { if (isEditing) cancelEditing(); setShowExtendPanel(false); setDetent('half'); };
    if (formDirty) setPanelConfirm({ type: 'switch', action: collapse });
    else collapse();
  };

  if (!isOpen) return null;
  if (!booking) {
    // Panel opens instantly from the card's known data; skeleton rows stand in for the rest while it loads.
    if (!isPanel) return null;
    const pv = previewBooking || {};
    const pvStatusLabel = String(pv.status || '').toLowerCase();
    const pvColors = getBookingStatusColors(pvStatusLabel === 'in-progress' ? 'In-Progress' : pvStatusLabel === 'no show' ? 'No Show' : pvStatusLabel.charAt(0).toUpperCase() + pvStatusLabel.slice(1));
    // Same tree shape as the loaded panel (fragment > SidePanel) so switching bookings doesn't remount/re-animate it.
    if (useSheet) {
      return (
        <DetentSheet
          isOpen detent={detent} onDetentChange={changeDetent} onClose={onClose} scrim={!liveBackdrop} titleId="booking-panel-title"
          header={(
            <div className="border-b border-border">
              <div className="flex items-center justify-between gap-1 pl-5 pr-2">
                <h3 id="booking-panel-title" className="min-w-0 truncate font-heading font-heading-semibold text-[16px] text-text-primary">{pv.customerName || 'Booking'}</h3>
                <div className="flex items-center flex-shrink-0">
                  <SheetExpandButton full={detent === 'full'} onToggle={() => changeDetent(detent === 'full' ? 'half' : 'full')} />
                  <button type="button" onClick={onClose} aria-label="Close" className="w-11 h-11 flex items-center justify-center rounded-spa text-text-secondary hover:bg-background spa-transition-fast"><Icon name="X" size={18} /></button>
                </div>
              </div>
              <div className="flex items-center gap-3 px-5 pb-2 -mt-1 min-h-[28px]">
                {pv.status && <span className="px-2 py-0.5 rounded-full text-[11px] font-medium capitalize flex-shrink-0" style={{ backgroundColor: pvColors.fill, color: pvColors.text }}>{pvStatusLabel.replace('-', ' ')}</span>}
              </div>
            </div>
          )}
        >
          <div className="p-5 space-y-5" aria-busy="true">
            <div>
              <p className="text-[13px] text-text-primary">{pv.serviceName || pv.service || ''}</p>
              <p className="text-[13px] text-text-secondary mt-0.5">{[pv.date, pv.startTime && pv.endTime ? `${pv.startTime.slice(0, 5)}–${pv.endTime.slice(0, 5)}` : ''].filter(Boolean).join(' · ')}</p>
            </div>
            {[0, 1].map((i) => (<div key={i} className="space-y-2 animate-pulse"><div className="h-3 w-24 bg-gray-100 rounded" /><div className="h-4 w-full bg-gray-100 rounded" /></div>))}
          </div>
        </DetentSheet>
      );
    }
    return (
      <>
      <SidePanel
        isOpen
        width={PANEL_WIDTH_BOOKING}
        onClose={onClose}
        title={(
          <span className="flex items-center gap-2 min-w-0">
            <span className="truncate">{pv.customerName || 'Booking'}</span>
            {pv.status && <span className="px-2 py-0.5 rounded-full text-[11px] font-medium capitalize flex-shrink-0" style={{ backgroundColor: pvColors.fill, color: pvColors.text }}>{pvStatusLabel.replace('-', ' ')}</span>}
          </span>
        )}
      >
        <div className="p-5 space-y-5" aria-busy="true">
          <div>
            <p className="text-[13px] text-text-primary">{pv.serviceName || pv.service || ''}</p>
            <p className="text-[13px] text-text-secondary mt-0.5">{[pv.date, pv.startTime && pv.endTime ? `${pv.startTime.slice(0, 5)}–${pv.endTime.slice(0, 5)}` : ''].filter(Boolean).join(' · ')}</p>
          </div>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="space-y-2 animate-pulse">
              <div className="h-3 w-24 bg-gray-100 rounded" />
              <div className="h-4 w-full bg-gray-100 rounded" />
              <div className="h-4 w-2/3 bg-gray-100 rounded" />
            </div>
          ))}
        </div>
      </SidePanel>
      {null}
      </>
    );
  }

  const isTerminal = ['completed', 'cancelled', 'no show'].includes(booking.status);
  const isLocked = booking.isLocked || false;
  const isSettled = booking.paymentStatus === 'paid';
  const isServiceStarted = booking.status === 'in-progress';
  // Clicking Start locks everything except Discount/Payment (still needed to
  // settle the bill); being paid locks Discount/Payment too (via canDiscount/
  // canPay below). Day-close and terminal status always lock everything.
  // admin_viewer is read-only: every write affordance below (status, assign, edit, discount, payment, extend) is off for them.
  const isViewer = userRole === 'admin_viewer';
  const isMutationBlocked = isViewer || isTerminal || isLocked || isServiceStarted || isSettled;
  // Assignment (therapist/room) locks once the service has started (or is
  // terminal/day-closed) — NOT merely because it's been paid. A booking can be
  // paid before it starts (pay-after-service isn't mandatory) and reassignment
  // should still be possible right up until the service actually begins.
  // Admin correction bypasses this the same way it bypasses the Booking Details fields: its save path goes through adminCorrectBooking
  // (therapist_id/room_id are in its whitelist), not the normal onAssignTherapist call that the DB immutability trigger would reject.
  // Multi-service Staff tab: one Save for every changed service. Saved one service at a time with the SAME assign call as the single-service
  // tab (no new write path): if one fails the earlier ones stay saved and the screen says which service did not.
  const multiStaffEditable = (r) => !r.dead && !isViewer && !isLocked && ['pending', 'confirmed'].includes(r.status);
  const multiStaffChanged = block.rows.filter((r) => multiStaffEditable(r) && rowChanged(r, rowPicks));
  const multiStaffIncomplete = multiStaffChanged.some((r) => {
    const optional = rooms.find((x) => x.id === rowRoom(r, rowPicks))?.requires_therapist === false;
    return staffPickIncomplete({ isCouple: r.isCouple, optional, count: rowIds(r, rowPicks).length });
  });
  const handleAssignAll = async () => {
    if (!multiStaffChanged.length) return;
    setIsLoading(true); setActionError(null); setFailedName(null);
    const open = multiStaffChanged.filter((r) => r.id !== booking.bookingId); // open service last: it is the one the panel stays on
    const ordered = [...open, ...multiStaffChanged.filter((r) => r.id === booking.bookingId)];
    try {
      for (const r of ordered) {
        const res = await onAssignTherapist?.(r.id, rowIds(r, rowPicks), notes, rowRoom(r, rowPicks) || null, undefined, undefined, undefined, { inline: true });
        if (res?.error) {
          retryRef.current = () => handleAssignAll();
          setFailedName(r.name); setActionError(guideFor(res.error));
          setBlockReload((n) => n + 1);
          return;
        }
      }
      setRowPicks({});
      await onRefreshBooking?.(booking.bookingId);
      setBlockReload((n) => n + 1);
    } catch (e) { setActionError(guideFor(e)); } finally { setIsLoading(false); }
  };

  // Always "Rebook" — this always creates a brand-new booking with the same
  // customer/service info, leaving the original untouched, regardless of
  // the source booking's status. "Reschedule" would wrongly imply the same
  // appointment moves (confirmed business decision, see handleRebookStart).
  const rebookLabel = 'Rebook';

  // Self-service rooms (Jacuzzi/Sauna/Steam) don't need a therapist to start — driven by
  // rooms.requires_therapist, not a hardcoded room/branch list.
  // Save assignment waits for a complete pick: someone, or both people for a couple service (ZNLY-300).

  const nextStatuses = isViewer ? [] : getNextStatuses(booking.status);
  // Payment is allowed on Completed bookings (pay-after-service is standard cash-spa flow).
  // Only day-lock and already-paid block it — not terminal status.
  const canPay = canViewPrices && !isViewer && ['confirmed', 'in-progress', 'completed'].includes(booking.status) && booking.paymentStatus !== 'paid' && booking.paymentStatus !== 'refunded';   // ZNLY-234: a closed day's balance can still be collected
  // Allow discounts on completed-but-unpaid bookings (standard cash-spa flow: service done → apply discount → pay).
  // Once the booking is fully paid, the price is locked — the discount can no longer move retroactively
  // against money already collected. 'partial' stays discountable so a discount can still be applied
  // against the still-owed remainder (e.g. after extending a booking that already had a payment).
  const canDiscount = !isViewer && booking.paymentStatus !== 'paid' && !isLocked
    && !['cancelled', 'no show'].includes(booking.status);
  const memberMd = memberCtx ? memberDiscountFor({ booking: memberCtx.booking, membership: memberCtx.membership, today: nepalNow().today }) : null;
  const memberCardOn = !!memberMd && ['apply', 'saved', 'better'].includes(memberMd.kind);
  const runMember = async (remove) => {
    setMemberBusy(true);
    setDiscountError(null);
    const { error } = await applyMemberDiscount({ bookingId: booking.bookingId, remove });
    if (error) setDiscountError(guideFor(error));
    await loadMemberCtx();
    await onRefreshBooking?.(booking.bookingId);
    setMemberBusy(false);
  };
  // TEMPORARY (2026-08-31): staff direct-apply limit raised from 15% to 50% to
  // match the hard cap below — see DISCOUNT_LIMITS in services/api.js for the
  // revert note.
  const discountLimitLabel = userRole === 'admin' ? '100%' : userRole === 'manager' ? '100%' : '50%';

  // Request-mode derivations: a discount over the user's role limit must be
  // routed to a chosen approver instead of being applied directly.
  // Staff request ceiling stays at 50%; manager/admin direct-apply ceiling is 100%.
  const DISCOUNT_HARD_CAP = userRole === 'staff' ? 50 : 100;
  const discountMaxPercent = userRole === 'admin' ? 100 : userRole === 'manager' ? 100 : 50;

  // --- Discount tab: per-row resolution ---
  // Every checked booking (current + related) resolves to a discount either from its own
  // rowDiscountOverrides entry (e.g. Facial=10%, Massage=15%, Package=20%), or — when left
  // blank — from the shared discountType/discountValue, prorated across the "pooled"
  // (non-overridden) checked bookings for a fixed NPR amount so the pool's total discount
  // equals discountValue exactly. Percentage needs no pooling: the same % applied to each
  // booking's own base already sums to that % of the combined total.
  // ZNLY-402 piece 4 (v3), setting ON + 2+ services: the lines come from the whole-rupee plan (utils/bookingDiscount.js); only lines with a
  // discount are applied, the open service LAST (the calendar re-opens the panel on the last row it saved).
  const mvRows = block.rows.filter((r) => !r.dead);
  const mvEligible = mvRows.filter((r) => r.paymentStatus !== 'paid');
  const planMV = planBookingDiscount({ rows: mvEligible.map((r) => ({ id: r.id, base: r.base })), type: discountType, value: discountValue, perLine: perService ? rowDiscountOverrides : null });
  const discountRowBase = (id) => id === booking.bookingId
    ? (booking.baseAmount || 0)
    : Number(relatedBookings.find(rb => rb.id === id)?.base_amount || 0);
  const checkedRowIds = legacyGroups
    ? [booking.bookingId, ...relatedBookings.map(rb => rb.id)].filter(id => selectedDiscountIds.has(id))
    : [...planMV.lines.filter((l) => l.amount > 0 && l.id !== booking.bookingId), ...planMV.lines.filter((l) => l.amount > 0 && l.id === booking.bookingId)].map((l) => l.id);
  // A3/A2: with ONE or more lines carrying a discount, a line planned at 0 (typed 0 or left blank) that already has a discount is CLEARED.
  const mvClearIds = !legacyGroups && planMV.total > 0 ? planMV.lines.filter((l) => l.amount === 0 && (mvRows.find((r) => r.id === l.id)?.discount || 0) > 0).map((l) => l.id) : [];
  const overriddenRowIds = checkedRowIds.filter(id => rowDiscountOverrides[id] !== undefined && rowDiscountOverrides[id] !== '');
  const pooledBase = checkedRowIds
    .filter(id => !overriddenRowIds.includes(id))
    .reduce((s, id) => s + discountRowBase(id), 0);
  const resolveRowDiscount = (id) => {
    if (!legacyGroups) { const l = planMV.lines.find((x) => x.id === id); return { value: l?.amount || 0, amount: l?.amount || 0, base: l?.base || 0, effPercent: l?.limitPercent || 0, hasOverride: false }; }
    const rowBase = discountRowBase(id);
    const hasOverride = overriddenRowIds.includes(id);
    const value = Number(hasOverride ? rowDiscountOverrides[id] : discountValue) || 0;
    let amount;
    if (discountType === 'percentage') {
      amount = Math.round(rowBase * value / 100 * 100) / 100;
    } else if (hasOverride) {
      amount = value;
    } else {
      const pct = pooledBase > 0 ? value / pooledBase : 0;
      amount = Math.round(rowBase * pct * 100) / 100;
    }
    const effPercent = rowBase > 0 ? (amount / rowBase) * 100 : 0;
    return { value, amount, base: rowBase, effPercent, hasOverride };
  };
  const setRowOverride = (id, val) => setRowDiscountOverrides(prev => ({ ...prev, [id]: val }));
  const clearRowOverride = (id) => setRowDiscountOverrides(prev => {
    const next = { ...prev };
    delete next[id];
    return next;
  });

  const handleApplyDiscount = async () => {
    if (!booking || !onApplyDiscount) return;
    setDiscountError(null);
    setDiscountSuccess(false);

    if (checkedRowIds.length === 0) {
      setDiscountError(legacyGroups ? 'Select at least one service.' : 'Enter a discount first.');
      return;
    }
    const rowPlans = checkedRowIds.map(id => ({ id, ...resolveRowDiscount(id) }));
    if (rowPlans.some(r => !(r.value > 0))) {
      setDiscountError('Enter a discount value for every selected service.');
      return;
    }
    if (!discountReason.trim()) {
      setDiscountError('Reason is required.');
      return;
    }

    // Hard ceiling: staff requests capped at 50%, manager/admin can apply up to 100%.
    const hardCeiling = userRole === 'staff' ? 50 : 100;
    const maxRowEffPercent = Math.max(...rowPlans.map(r => r.effPercent));
    if (maxRowEffPercent > hardCeiling) {
      setDiscountError(guideFor({ code: 'DISCOUNT_LIMIT_EXCEEDED' }, { limitPercent: hardCeiling }));
      return;
    }

    // If ANY row exceeds the role's direct-apply limit, the whole batch routes to one approver.
    // TEMPORARY: staff limit raised 15% -> 50%, see the discountMaxPercent note above.
    const maxPercent = userRole === 'admin' ? 100 : userRole === 'manager' ? 100 : 50;
    const exceedsLimit = maxRowEffPercent > maxPercent;

    if (exceedsLimit && !selectedApprover) {
      setDiscountError(guideFor({ code: 'APPROVER_REQUIRED' }));
      return;
    }

    setIsLoading(true);
    try {
      let lastResult = null;
      let failed = false;

      // Lines to clear go with the others; the open service is always saved last (the calendar re-opens the panel on the last row it saved).
      const clearPlans = mvClearIds.map((id) => ({ id, clear: true }));
      const allPlans = [...rowPlans, ...clearPlans];
      const orderedPlans = [...allPlans.filter((r) => r.id !== booking.bookingId), ...allPlans.filter((r) => r.id === booking.bookingId)];
      holdTabRef.current = activeTab;
      for (const row of orderedPlans) {
        const result = await onApplyDiscount(row.id, row.clear
          ? { discountType: 'fixed', discountValue: 0, discountReason: 'Discount cancelled' }
          : {
            discountType: legacyGroups && discountType === 'percentage' ? 'percentage' : 'fixed',
            discountValue: legacyGroups && discountType === 'percentage' ? row.value : row.amount,
            discountReason: discountReason.trim(),
            requestedTo: exceedsLimit ? selectedApprover : undefined
          });
        lastResult = row.clear && !result?.error && lastResult ? lastResult : result;
        if (result?.error) { failed = true; break; }
      }

      if (failed) {
        setDiscountError(guideFor(lastResult?.error, { limitPercent: discountMaxPercent }));
      } else if (lastResult?.data?.isPending) {
        setDiscountSuccess('pending');
        setDiscountValue('');
        setDiscountReason('');
        setSelectedApprover('');
        setRowDiscountOverrides({});
      } else {
        setDiscountSuccess('approved');
        setDiscountValue('');
        setDiscountReason('');
        setRowDiscountOverrides({});
      }
    } catch (error) {
      setDiscountError(guideFor(error));
    } finally {
      setTimeout(() => { holdTabRef.current = null; }, 800);
      setIsLoading(false);
    }
  };

  // Multi-service "Remove the discount": the same single-service cancel call, one service at a time, the open service last.
  const handleRemoveAllDiscounts = async () => {
    if (!onApplyDiscount) return;
    setIsLoading(true); setDiscountError(null);
    const withDiscount = mvRows.filter((r) => r.discount > 0);
    const ordered = [...withDiscount.filter((r) => r.id !== booking.bookingId), ...withDiscount.filter((r) => r.id === booking.bookingId)];
    holdTabRef.current = activeTab;
    try {
      for (const r of ordered) {
        const res = await onApplyDiscount(r.id, { discountType: 'fixed', discountValue: 0, discountReason: 'Discount cancelled' });
        if (res?.error) { setDiscountError(guideFor(res.error)); return; }
      }
      setDiscountSuccess('removed'); setRowDiscountOverrides({});
      setBlockReload((n) => n + 1);
    } catch (e) { setDiscountError(guideFor(e)); } finally { setTimeout(() => { holdTabRef.current = null; }, 800); setIsLoading(false); }
  };

  const discountEffPercent = checkedRowIds.length > 0
    ? Math.max(...checkedRowIds.map(id => resolveRowDiscount(id).effPercent))
    : 0;
  const discountHasInput = checkedRowIds.some(id => resolveRowDiscount(id).value > 0);
  const discountExceedsCap = discountHasInput && discountEffPercent > DISCOUNT_HARD_CAP;
  // Routable request range only — above the hard cap it's blocked, not requestable.
  const discountExceedsLimit = discountHasInput && discountEffPercent > discountMaxPercent && !discountExceedsCap;
  const previewDiscountAmount = checkedRowIds.reduce((s, id) => s + resolveRowDiscount(id).amount, 0);
  const selectedApproverName = approvers.find(a => a.id === selectedApprover)?.fullName || '';

  const inputClasses = 'w-full px-3 py-2 border border-border rounded-spa bg-surface text-text-primary text-sm focus:ring-2 focus:ring-primary focus:border-primary spa-transition-fast';


  // ── Panel variant: header title, primary footer action, overflow menu ─────────────────────
  const statusKey = booking.status === 'in-progress' ? 'In-Progress' : booking.status === 'no show' ? 'No Show' : booking.status.charAt(0).toUpperCase() + booking.status.slice(1);
  const statusColors = getBookingStatusColors(statusKey);
  const panelTitle = (
    <span className="flex items-center gap-2 min-w-0">
      <span className="truncate">{booking.customerName}</span>
      <span className="px-2 py-0.5 rounded-full text-[11px] font-medium capitalize flex-shrink-0" style={{ backgroundColor: statusColors.fill, color: statusColors.text }}>
        {booking.status.replace('-', ' ')}
      </span>
    </span>
  );
  // Panel header: name + status + pencil + ×, then the customer subline (phone · View profile · birthday). Restricted staff: name + status only.
  const openEdit = () => {
    const referredBy = booking.referredBy || (customerReferral ? [customerReferral.referrerName, customerReferral.referrerPhone].filter(Boolean).join(' · ') : '');
    if (onEditForm) { onEditForm(booking, block.rows, referredBy); return; }
    setEditSlot(buildEditSlot({ booking, blockRows: block.rows, referredBy }));
  };
  // The shared form handles started / paid services itself (read-only cards), so a 2+ service booking can be edited unless the day is closed.
  const editAllowed = !isLocked;
  const canEditDetails = !restricted && editAllowed && !!onEditBooking;
  // ZNLY-327: a walk-in with no client gets "＋ Add client" instead of View profile / phone / birthday; a walk-in that has one keeps a small tag.
  const walkInNoClient = !!booking.isWalkIn && !booking.customerId;
  // Add client changes no money, so it follows the API's own lifecycle rule (a closed day, Cancelled and No Show refuse); a paid, in-progress or Completed booking may still get one.
  const canAddClient = !restricted && !isViewer && !isLocked && booking.status !== 'Cancelled' && booking.status !== 'No Show';
  const walkInTag = booking.isWalkIn ? <span className="px-2 py-0.5 rounded-full text-[11px] font-medium flex-shrink-0 inline-flex items-center gap-1 bg-warning/15 text-warning" data-walkin-tag><span aria-hidden="true">🚶</span>Walk-in</span> : null;
  const customerLine = walkInNoClient
    ? <WalkInClientLine booking={booking} canAdd={canAddClient} openSignal={addClientSignal} onLinked={() => onRefreshBooking?.(booking.bookingId)} />
    : <BookingCustomerLine booking={booking} restricted={restricted} canEdit={!isViewer} onSaved={() => onRefreshBooking?.(booking.bookingId)} />;
  const desktopPanelHeader = (
    <div className="border-b border-border">
      <div className="min-h-14 flex items-center justify-between gap-2 px-5 py-2">
        <div className="min-w-0 flex items-center gap-2">
        <h3 id="booking-panel-title" className="font-heading font-heading-semibold text-[15px] text-text-primary min-w-0 flex items-center gap-2">
          <span className="truncate">{booking.customerName}</span>
          <span className="px-2 py-0.5 rounded-full text-[11px] font-medium flex-shrink-0 first-letter:uppercase" style={{ backgroundColor: statusColors.fill, color: statusColors.text }}>
            {booking.status.replace('-', ' ')}
          </span>
          {walkInTag}
        </h3>
        {!restricted && booking.customerId && (
          <button type="button" onClick={() => requestPanelCloseThen(() => { releaseSheetEntry(); navigate(`/${orgForNav?.slug}/customers/${booking.customerId}`); })}
            className="relative flex-shrink-0 whitespace-nowrap text-[13px] font-medium text-primary hover:underline before:content-[''] before:absolute before:-inset-x-1 before:-inset-y-3">
            View profile
          </button>
        )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {canEditDetails && (
            <button type="button" onClick={openEdit} title="Edit booking details" aria-label="Edit booking details"
              className="w-8 h-8 max-lg:w-11 max-lg:h-11 flex items-center justify-center rounded-spa text-text-secondary hover:bg-background hover:text-primary spa-transition-fast">
              <Icon name="Pencil" size={15} />
            </button>
          )}
          {useSheet && <SheetExpandButton full={detent === 'full'} onToggle={() => changeDetent(detent === 'full' ? 'half' : 'full')} />}
          <button type="button" onClick={requestPanelClose} aria-label="Close"
            className="w-8 h-8 max-lg:w-11 max-lg:h-11 flex items-center justify-center rounded-spa text-text-secondary hover:bg-background spa-transition-fast">
            <Icon name="X" size={18} />
          </button>
        </div>
      </div>
      {customerLine}
    </div>
  );

  // Phone sheet header (ZNLY-285): row 1 name + controls, row 2 status chip · View profile, row 3 the customer line.
  const sheetHeader = (
    <div className="border-b border-border">
      <div className="flex items-center justify-between gap-1 pl-5 pr-2">
        <h3 id="booking-panel-title" className="min-w-0 truncate font-heading font-heading-semibold text-[16px] text-text-primary">{booking.customerName}</h3>
        <div className="flex items-center flex-shrink-0">
          {canEditDetails && (
            <button type="button" onClick={openEdit} aria-label="Edit booking details"
              className="w-11 h-11 flex items-center justify-center rounded-spa text-text-secondary hover:bg-background hover:text-primary spa-transition-fast">
              <Icon name="Pencil" size={15} />
            </button>
          )}
          <SheetExpandButton full={detent === 'full'} onToggle={() => changeDetent(detent === 'full' ? 'half' : 'full')} />
          <button type="button" onClick={requestPanelClose} aria-label="Close"
            className="w-11 h-11 flex items-center justify-center rounded-spa text-text-secondary hover:bg-background spa-transition-fast">
            <Icon name="X" size={18} />
          </button>
        </div>
      </div>
      <div className="flex items-center gap-3 px-5 pb-2 -mt-1">
        <span className="px-2 py-0.5 rounded-full text-[11px] font-medium flex-shrink-0 first-letter:uppercase" style={{ backgroundColor: statusColors.fill, color: statusColors.text }}>
          {booking.status.replace('-', ' ')}
        </span>
        {walkInTag}
        {!restricted && booking.customerId && (
          <button type="button" onClick={() => requestPanelCloseThen(() => { releaseSheetEntry(); navigate(`/${orgForNav?.slug}/customers/${booking.customerId}`); })}
            className="relative flex-shrink-0 whitespace-nowrap text-[13px] font-medium text-primary hover:underline before:content-[''] before:absolute before:-inset-x-2 before:-inset-y-3">
            View profile
          </button>
        )}
      </div>
      {customerLine}
    </div>
  );
  const panelHeader = useSheet ? sheetHeader : desktopPanelHeader;

  // Primary next action for the booking's status; everything else lives in the "⋯" overflow.
  // ZNLY-275: a booking for a later day can't be started, completed or marked no-show; staff move it to today first.
  const futureStart = futureBookingMessage(booking.date, 'start');
  const futureComplete = futureBookingMessage(booking.date, 'complete');
  const futureNoShow = futureBookingMessage(booking.date, 'noshow');
  // ZNLY-402 piece 4: the "This booking" block's actions. Start / Done go through the SAME status action as the footer, per service
  // (onUpdateStatus with that service's id). Remove stays out until piece 5 (an atomic, previewed remove): no dead button on screen.
  const runRowStatus = async (rowId, status) => {
    if (rowId === booking.bookingId) { await handleStatusUpdate(status); setBlockReload((n) => n + 1); return; }
    setRowBusy(rowId); setActionError(null);
    try {
      const res = await onUpdateStatus?.(rowId, status, undefined, { inline: true });
      if (res?.error) setActionError(guideFor(res.error));
      else await onRefreshBooking?.(booking.bookingId);
    } catch (e) { setActionError(guideFor(e)); }
    finally { setRowBusy(null); setBlockReload((n) => n + 1); }
  };
  // The card's "Earlier balance": what the client still owes from OTHER bookings. Shown under To pay, never added to it.
  const earlierBalance = previousDueFor === booking.bookingId ? previousDueBookings.reduce((sm, pb) => sm + Number(pb.amountDue || 0), 0) : 0;
  const relatedRemaining = (rb) => Math.max(Number(rb.base_amount || 0) - Number(rb.discount_amount || 0), 0);
  const relatedGroupLabel = booking.date === nepalToday() ? "Today's Services" : 'Other Day Services';
  const blockDateLabel = booking.date && !Number.isNaN(new Date(`${booking.date}T00:00:00`).getTime()) ? new Date(`${booking.date}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '') : '';
  const blockRowAction = (r) => {
    if (isViewer || isLocked || !onUpdateStatus || r.dead) return null;
    // Remove (U12): shown on every live service; the server dry run says whether it may go (started / paid ones give the plain reason).
    // A started / done / paid service has no Remove: it shows a lock chip with the plain reason instead (the dialog stays the server-side fallback).
    const lock = lockReasonOf(r);
    // ZNLY-435: Remove on the only live service of the open booking IS cancelling the booking: the plain Cancel Booking dialog (reason required), same as the footer.
    const onlyOne = block.live.length === 1 && r.id === booking.bookingId;
    const remove = restricted ? undefined : lock ? undefined : { run: () => (onlyOne ? setPendingStatus('cancelled') : setRemoveRow(r)) };
    const lockChip = lock ? lock.replace(' – can\'t change', '') : undefined;
    if (r.status === 'confirmed') { const why = futureBookingMessage(r.date, 'start'); return { start: { disabled: !!why, reason: why, run: () => runRowStatus(r.id, 'in-progress') }, remove, lock: lockChip }; }
    if (r.status === 'in-progress') { const why = futureBookingMessage(r.date, 'complete'); return { done: { disabled: !!why, reason: why, run: () => runRowStatus(r.id, 'completed') }, remove, lock: lockChip }; }
    if (r.status === 'pending') return { confirm: { disabled: false, run: () => runRowStatus(r.id, 'confirmed') }, remove, lock: lockChip };
    return lock ? { lock: lockChip } : null;
  };
  const selectBlockRow = (id) => {
    const go = () => { pendingTabRef.current = activeTab; onViewBooking(id); };
    if (isDirty) setPanelConfirm({ type: 'switch', action: go }); else go();
  };
  const blockPaid = block.allPaid ? { label: 'Paid', cls: 'bg-success/10 text-success' } : block.paid > 0 ? { label: 'Part paid', cls: 'bg-warning/10 text-warning' } : { label: 'Not paid yet', cls: 'bg-warning/10 text-warning' };
  const blockCollect = canViewPrices && !isViewer && (block.toPay > 0 || block.waiting > 0) ? { disabled: !canPay, reason: canPay ? null : 'Confirm or complete this service first.', run: () => { setActiveTab('payment'); setShowPaymentModal(true); } } : null;
  // Visible secondary actions (left), in collapse-priority order; disabled ones are not shown here (only in the overflow).
  const secondaryVisible = [
    !isViewer && onAddServiceStart && !isEditing && { key: 'rebook', label: rebookLabel, icon: 'CalendarClock', run: () => onRebookStart?.(booking) },
    !isViewer && onAddServiceStart && !isEditing && { key: 'add', label: '+ Service', icon: 'PlusCircle', run: () => onAddServiceStart(booking, 'add-service', block.rows) },
    !isViewer && !restricted && !isTerminal && !isLocked && extendOptions.length > 0 && { key: 'extend', label: 'Extend', icon: 'Timer', run: () => { setActiveTab('details'); setShowExtendPanel(true); } },
  ].filter(Boolean);
  // Fit: footer width minus the ⋯ button, the primary action and gaps; each button's width is estimated from its label.
  let budget = (footerW || 600) - 36 - 8 - 8;
  const shownKeys = [];
  secondaryVisible.forEach((it) => {
    const w = 28 + it.label.length * 7 + 8;
    if (budget >= w) { shownKeys.push(it.key); budget -= w; } else budget = -1; // once one doesn't fit, lower priorities collapse too
  });
  const visibleSecondary = secondaryVisible.filter((it) => shownKeys.includes(it.key));
  const noShowGated = !hasBookingStarted(booking);
  // A 2+ service booking whose opened service already started can still cancel / no-show the services that have not started (the preview lists what stays).
  const visitCanCancel = block.rows.some((r) => !r.dead && ['pending', 'confirmed'].includes(r.status) && !lockReasonOf(r));
  const overflowItems = [
    ...secondaryVisible.filter((it) => !shownKeys.includes(it.key)),
    onEditBooking && editAllowed && !isEditing && { key: 'edit', label: 'Edit details', icon: 'Pencil', run: openEdit },
    onEditBooking && !editAllowed && !isEditing && !isTerminal && { key: 'edit', label: 'Edit details', icon: 'Pencil', disabled: true, reason: isLocked ? 'Booking is locked (day closed)' : isSettled ? 'Paid bookings can\'t be edited' : 'Locked once service has started', run: () => {} },
    // Zennly-only: Reschedule creates a new booking and cancels this one (the caller runs the slot picker).
    !isViewer && onRescheduleStart && !isTerminal && !isLocked && (() => {
      // A 2+ service booking moves its waiting services; started / paid ones stay. Disabled only when nothing can move.
      const nothingMovable = !block.rows.some((r) => !lockReasonOf(r) && !r.dead);
      const blocked = nothingMovable;
      return { key: 'reschedule', label: 'Reschedule', icon: 'CalendarClock', disabled: blocked, reason: 'Every service has started or is paid, so nothing can be moved.', run: () => (block.rows.length > 1 && booking.visitId
        ? onRescheduleStart(booking, { visitKey: booking.visitId, count: block.count, minutes: block.live.reduce((m, r) => m + (r.minutes || 0), 0), lines: Object.fromEntries(block.rows.map((r) => [r.id, { name: r.name, price: r.final, minutes: r.minutes, staff: r.staff.join(', ') }])) })
        : onRescheduleStart(booking)) };
    })(),
    !isTerminal && !isLocked && (nextStatuses.includes('no show') || visitCanCancel) && { key: 'noshow', label: 'Mark no-show', icon: 'UserX', disabled: noShowGated || !!futureNoShow, reason: futureNoShow || "Available after the booking's scheduled time", run: () => setPendingStatus('no show') },
    !isTerminal && !isLocked && (nextStatuses.includes('cancelled') || visitCanCancel) && { key: 'cancel', label: 'Cancel booking', icon: 'XCircle', danger: true, run: () => setPendingStatus('cancelled') },
  ].filter(Boolean);

  const panelFooter = panelConfirm ? (
    <div key="confirm" role="alertdialog" aria-label="Unsaved changes" className="flex items-center gap-3">
      <p className="flex-1 min-w-0 text-[13px] text-text-primary">Discard unsaved changes?</p>
      <button type="button" onClick={() => setPanelConfirm(null)} className="h-9 px-3 text-[13px] font-body font-body-medium border border-border rounded-spa hover:bg-background spa-transition-fast whitespace-nowrap">Keep editing</button>
      <button
        type="button"
        onClick={() => { const c = panelConfirm; setPanelConfirm(null); if (c.type === 'switch') c.action?.(); else onClose?.(); }}
        className="h-9 px-3 text-[13px] font-body font-body-medium bg-text-primary text-white rounded-spa hover:opacity-90 spa-transition-fast whitespace-nowrap"
      >
        Discard
      </button>
    </div>
  ) : showAdminCorrection ? (
    <div key="correction" className="flex items-center gap-2 flex-nowrap whitespace-nowrap">
      <span className="flex-1 min-w-0 truncate font-caption text-[11px] text-text-tertiary">
        {correctionMode === 'correct'
          ? [
              correctionChangedCount > 0 ? `${correctionChangedCount} field${correctionChangedCount === 1 ? '' : 's'} changed` : null,
              correctionPaymentChangedCount > 0 ? `${correctionPaymentChangedCount} payment${correctionPaymentChangedCount === 1 ? '' : 's'} changed` : null,
            ].filter(Boolean).join(' · ')
          : ''}
      </span>
      <Button variant="outline" size="sm" onClick={requestCorrectionClose} disabled={correctionSubmitting}>Discard</Button>
      <Button
        variant={correctionMode === 'delete' ? 'danger' : 'primary'}
        size="sm"
        onClick={requestCorrectionSave}
        loading={correctionSubmitting}
        disabled={
          correctionSubmitting ||
          (correctionMode === 'delete' && !correctionDeleteConfirmed) ||
          (correctionMode === 'correct' && correctionChangedCount === 0 && correctionPaymentChangedCount === 0)
        }
      >
        {correctionMode === 'delete' ? 'Delete booking' : 'Save'}
      </Button>
    </div>
  ) : (
    <div key="actions" ref={footerRef} className="flex items-center gap-2 flex-nowrap whitespace-nowrap">
      {isEditing && activeTab === 'details' ? (
        <>
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={cancelEditing}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={handleSaveEdit} loading={isLoading} disabled={!!editBlockMsg}>Save changes</Button>
        </>
      ) : (
        <>
          {visibleSecondary.map((it) => (
            <button
              key={it.key}
              type="button"
              onClick={it.run}
              className="h-9 px-3 flex items-center gap-1.5 text-[13px] font-body font-body-medium text-text-primary border border-border rounded-spa hover:bg-background spa-transition-fast flex-shrink-0"
            >
              {it.label}
            </button>
          ))}
          <div className="relative flex-shrink-0" ref={moreRef}>
            <button
              type="button"
              aria-label="More actions"
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((v) => !v)}
              disabled={overflowItems.length === 0}
              className="h-9 w-9 flex items-center justify-center border border-border rounded-spa text-text-secondary hover:bg-background spa-transition-fast disabled:opacity-40"
            >
              <Icon name="MoreHorizontal" size={16} />
            </button>
            {moreOpen && (
              <div role="menu" className="absolute bottom-full left-0 mb-1 w-56 bg-surface border border-border rounded-spa-lg shadow-spa-elevated py-1 z-dropdown">
                {overflowItems.map((it) => (
                  <button
                    key={it.key}
                    type="button"
                    role="menuitem"
                    disabled={it.disabled}
                    title={it.disabled ? it.reason : undefined}
                    onClick={() => { setMoreOpen(false); it.run(); }}
                    className={`w-full flex items-center gap-2 px-3 h-9 text-[13px] font-body text-left hover:bg-background disabled:opacity-40 ${it.danger ? 'text-error' : 'text-text-primary'}`}
                  >
                    <Icon name={it.icon} size={14} className={it.danger ? 'text-error' : 'text-text-tertiary'} />
                    <span>{it.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex-1" />
          {activeTab === 'assign' && block.rows.some(multiStaffEditable) ? (
            <Button variant="primary" size="sm" onClick={handleAssignAll} loading={isLoading} disabled={!multiStaffChanged.length || multiStaffIncomplete}>Save assignment</Button>
          ) : null}
        </>
      )}
    </div>
  );
  // Equal-fit tab bar for the panel: never scrolls horizontally.
  const panelTabs = [
    { id: 'details', label: 'Details', icon: 'FileText' },
    { id: 'assign', label: `${staffLabelPlural || 'Team'}`, icon: 'UserCheck' },
    { id: 'discount', label: 'Discount', icon: 'Percent' },
    { id: 'payment', label: 'Payment', icon: 'CreditCard' },
  ].filter((t) => canViewPrices || (t.id !== 'discount' && t.id !== 'payment'));
  const panelTabsNode = (
    <div className="sticky top-0 z-10 bg-surface border-b border-border">
      <nav className="grid" style={{ gridTemplateColumns: `repeat(${panelTabs.length}, minmax(0, 1fr))` }} role="tablist">
        {panelTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => goTab(tab.id)}
            className={`h-12 flex items-center justify-center gap-1.5 text-[13px] font-body font-body-medium border-b-2 -mb-px spa-transition-fast whitespace-nowrap ${
              activeTab === tab.id ? 'border-primary text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            <Icon name={tab.icon} size={14} />
            <span className="flex flex-col items-start leading-tight text-left">
              <span>{tab.label}</span>
              <span className="text-[10px] font-normal text-text-tertiary">{tab.id === 'details' ? 'All services' : tab.id === 'assign' ? 'Each service' : 'Whole booking'}</span>
            </span>
          </button>
        ))}
      </nav>
    </div>
  );

  const tabsNode = (
    <>
          {/* Tabs - Horizontal scroll on mobile with padding for last item visibility */}
          <div className={isPanel ? 'border-b border-border flex-shrink-0 sticky top-0 z-10 bg-surface' : 'border-b border-border flex-shrink-0'}>
            <nav className={`flex overflow-x-auto scrollbar-hide gap-1 sm:gap-6 ${isPanel ? 'pl-3' : 'pl-4 sm:pl-6'}`}>
              {tabs.map((tab, index) => (
                <button
                  key={tab.id}
                  onClick={() => goTab(tab.id)}
                  className={`flex items-center gap-1.5 sm:gap-2 py-3 sm:py-4 px-3 sm:px-1 border-b-2 spa-transition-fast whitespace-nowrap flex-shrink-0 min-h-[44px] ${
                    index === tabs.length - 1 ? 'mr-4 sm:mr-6' : ''
                  } ${
                    activeTab === tab.id
                      ? 'border-primary text-primary bg-primary/5 sm:bg-transparent rounded-t-lg sm:rounded-none'
                      : 'border-transparent text-text-secondary hover:text-text-primary'
                  }`}
                >
                  <Icon name={tab.icon} size={16} />
                  {/* Short label on mobile, full on desktop */}
                  <span className="font-body font-body-medium text-sm sm:hidden">{tab.label}</span>
                  <span className="font-body font-body-medium text-sm hidden sm:inline">{tab.labelFull}</span>
                </button>
              ))}
            </nav>
          </div>

    </>
  );

  const contentNode = (
    <>
          {/* Content - Scrollable area takes remaining space, extra bottom padding on mobile for bottom nav */}
          <div ref={bodyRef} className={isPanel ? 'p-5' : 'p-4 sm:p-6 pb-24 sm:pb-6 overflow-y-auto flex-1'}>
            {/* Admin-correction indicator + delete toggle — visible on every tab while
                actively correcting, so switching tabs mid-correction never hides it.
                The reason itself is collected in the Save confirm dialog, right before
                submit, so it's shared across whatever was edited on any tab. */}
            {showAdminCorrection && (
              <div className="space-y-3 border border-warning/20 bg-warning/5 rounded-spa p-3 sm:p-4 mb-4 sm:mb-6">
                <div className="flex items-center justify-between">
                  <span className="font-body font-body-medium text-xs text-text-secondary">Admin correction</span>
                  {!delBlock && (
                    <button
                      type="button"
                      onClick={() => setCorrectionMode((m) => (m === 'delete' ? 'correct' : 'delete'))}
                      className="font-caption text-[11px] text-error hover:underline"
                    >
                      {correctionMode === 'delete' ? 'Cancel delete' : 'Delete this booking instead'}
                    </button>
                  )}
                </div>

                {delBlock && (
                  <div className="bg-surface border border-border rounded-spa px-3 py-2 space-y-2" data-delete-blocked>
                    <p className="font-body text-xs text-text-primary">{delBlock.title}</p>
                    <p className="font-body text-xs text-text-secondary">{delBlock.advice}</p>
                    {delBlock.canCancel && correctionFields?.status !== 'Cancelled' && (
                      <button type="button" onClick={cancelAndRefund} className="h-8 px-3 text-xs font-body font-body-medium rounded-spa bg-error text-white hover:bg-error/90">
                        {delBlock.refund > 0 ? `Cancel and refund ${Number(delBlock.refund).toLocaleString('en-IN')}` : 'Cancel booking'}
                      </button>
                    )}
                    {delBlock.canCancel && correctionFields?.status === 'Cancelled' && (
                      <p className="font-body text-xs text-text-secondary">Status is now Cancelled. Press Save and give a reason{delBlock.refund > 0 ? `; NPR ${Number(delBlock.refund).toLocaleString('en-IN')} is recorded as a refund` : ''}.</p>
                    )}
                  </div>
                )}

                {correctionMode === 'delete' && (
                  <div className="bg-error/5 border border-error/20 rounded-spa px-3 py-2 space-y-2">
                    <p className="font-body text-xs text-error">
                      Deleting removes this booking entirely. It will disappear from past reports that counted it.
                    </p>
                    <div>
                      <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">
                        Type <span className="font-data">DELETE</span> to confirm
                      </label>
                      <input
                        value={correctionDeleteText}
                        onChange={(e) => setCorrectionDeleteText(e.target.value)}
                        className={inputClasses}
                      />
                    </div>
                  </div>
                )}

                {correctionError && !correctionConfirming && (
                  <div className="bg-error/5 border border-error/20 rounded-spa px-3 py-2 flex items-start space-x-2">
                    <Icon name="AlertCircle" size={14} className="text-error flex-shrink-0 mt-0.5" />
                    <p className="font-body text-xs text-error">{correctionError}</p>
                  </div>
                )}
              </div>
            )}

            {!(isEditing && activeTab === 'details') && (blockReady ? (
              <BookingServicesBlock
                block={block}
                mode={activeTab === 'details' ? 'full' : 'strip'}
                canViewPrices={canViewPrices}
                paidState={blockPaid}
                collect={activeTab === 'details' ? blockCollect : null}
                earlier={canViewPrices ? earlierBalance : 0}
                earlierRows={previousDueFor === booking.bookingId ? previousDueBookings : []}
                onViewEarlier={onViewBooking}
                use24h={use24h}
                dateLabel={blockDateLabel}
                note={activeTab === 'assign' ? `Tap a service to change its ${(staffLabel || 'team member').toLowerCase()}.` : null}
                onSelect={onViewBooking ? selectBlockRow : undefined}
                rowAction={blockRowAction}
                busyId={rowBusy}
              />
            ) : blockRows ? (
              <p className="mb-5 text-[13px] text-text-secondary" data-block-failed>This booking's services could not be loaded. Close the panel and open it again.</p>
            ) : (
              <BookingServicesBlock loading dateLabel={blockDateLabel} />
            ))}

            {/* ZNLY-435 (setting OFF): group / same-day related bookings, below the card. Same ticks and same bundling as before. */}
            {legacyGroups && (activeTab === 'details' || activeTab === 'payment') && (
              <div className="space-y-4 mb-5" data-related-section>
                {/* Related services — same-session bookings discounted together on the
                    Discount tab. Bundled into payment by default (all checked), but staff
                    can uncheck one to pay it later — see combinedTotal/selectedCount above. */}
                {relatedBookings.length > 0 && (
                  <div className="space-y-2">
                    <label className="font-body font-body-medium text-xs text-text-secondary uppercase flex items-center gap-1.5">
                      <Icon name="Layers" size={13} />
                      {relatedGroupLabel} ({relatedBookings.length})
                    </label>
                    <div className="border border-border rounded-spa divide-y divide-border overflow-hidden">
                      {relatedBookings.map(rb => {
                        const isChecked = selectedRelatedIds.has(rb.id);
                        return (
                          <label key={rb.id} className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-background/50 ${isChecked ? 'bg-primary/5' : ''}`}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                setSelectedRelatedIds(prev => {
                                  const next = new Set(prev);
                                  if (e.target.checked) next.add(rb.id);
                                  else next.delete(rb.id);
                                  return next;
                                });
                              }}
                              className="text-primary focus:ring-primary w-4 h-4 rounded"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="font-body text-sm text-text-primary">{rb.service?.name || 'Service'}</div>
                              <div className="font-caption text-xs text-text-secondary">
                                #{rb.booking_number} · {clock(rb.start_time)}
                                {Number(rb.discount_amount) > 0 && ` · discount -NPR ${Number(rb.discount_amount).toLocaleString('en-IN')}`}
                              </div>
                            </div>
                            <span className="font-data text-sm text-text-primary flex-shrink-0">NPR {relatedRemaining(rb).toLocaleString('en-IN')}</span>
                            {onViewBooking && (
                              <button
                                type="button"
                                title="View this booking"
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onViewBooking(rb.id); }}
                                className="flex-shrink-0 p-1 rounded hover:bg-background text-text-secondary hover:text-primary"
                              >
                                <Icon name="ChevronRight" size={16} />
                              </button>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Group siblings already paid — display only (never bundled), so a paid
                    sibling never silently vanishes just because it's no longer "unpaid".
                    See the BK-20260915-0025/-0026/-0027 incident this closes. */}
                {groupSiblings.some(gb => gb.payment_status === 'paid') && (
                  <div className="space-y-2">
                    <label className="font-body font-body-medium text-xs text-text-secondary uppercase flex items-center gap-1.5">
                      <Icon name="CheckCircle2" size={13} className="text-success" />
                      {booking?.bookingGroupId ? 'Already paid in this group' : 'Already paid for this customer today'}
                    </label>
                    <div className="border border-success/20 bg-success/5 rounded-spa divide-y divide-success/10 overflow-hidden">
                      {groupSiblings.filter(gb => gb.payment_status === 'paid').map(gb => (
                        <div key={gb.id} className="flex items-center gap-3 px-3 py-2">
                          <div className="flex-1 min-w-0">
                            <div className="font-body text-sm text-text-primary">{gb.service?.name || 'Service'}</div>
                            <div className="font-caption text-xs text-text-secondary">#{gb.booking_number}</div>
                          </div>
                          <span className="font-data text-sm text-success flex-shrink-0">
                            NPR {Number(gb.final_amount || 0).toLocaleString('en-IN')} · Paid
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Details Tab */}
            {activeTab === 'details' && (
              <div className={isPanel ? 'space-y-5' : 'space-y-4 sm:space-y-6'}>
                <ClientDayLine info={clientDay} range={clientDay ? formatClockRange(clientDay.first, clientDay.last, use24h) : ''} />
                {/* Lock / Immutability Banner — payment-aware on Completed so it complements the Record Payment button */}
                {isMutationBlocked && (() => {
                  const banner = isLocked
                    ? { bg: 'bg-amber-50', border: 'border-amber-200', iconColor: 'text-amber-600', textColor: 'text-amber-700', icon: 'Lock', label: 'Day Closed — Locked' }
                    : booking.status === 'completed'
                      ? booking.paymentStatus === 'paid'
                        ? { bg: 'bg-success/5', border: 'border-success/20', iconColor: 'text-success', textColor: 'text-success', icon: 'ShieldCheck', label: 'Completed — Settled' }
                        : { bg: 'bg-warning/5', border: 'border-warning/20', iconColor: 'text-warning', textColor: 'text-warning', icon: 'Clock', label: 'Service Completed — Payment Pending' }
                      : isTerminal
                        ? { bg: 'bg-gray-50', border: 'border-gray-200', iconColor: 'text-gray-500', textColor: 'text-gray-600', icon: 'ShieldCheck', label: booking.status === 'cancelled' ? 'Cancelled — Immutable' : 'No Show — Immutable' }
                        : isSettled
                          ? { bg: 'bg-success/5', border: 'border-success/20', iconColor: 'text-success', textColor: 'text-success', icon: 'CheckCircle', label: 'Paid — Settled' }
                          : isServiceStarted
                            ? { bg: 'bg-gray-50', border: 'border-gray-200', iconColor: 'text-gray-500', textColor: 'text-gray-600', icon: 'Lock', label: 'Service Started — Locked (Discount/Payment still open)' }
                            : { bg: 'bg-gray-50', border: 'border-gray-200', iconColor: 'text-gray-500', textColor: 'text-gray-600', icon: 'Lock', label: 'Booking Locked' };
                  const tone = isPanel
                    ? { bg: 'bg-background', border: 'border-border', iconColor: 'text-text-tertiary', textColor: 'text-text-secondary' }
                    : banner;
                  return (
                    <div className={`flex items-center space-x-2 px-3 py-2.5 rounded-spa ${tone.bg} border ${tone.border}`}>
                      <Icon name={banner.icon} size={16} className={tone.iconColor} />
                      <span className={`font-body font-body-medium text-xs ${tone.textColor}`}>
                        {banner.label}
                        {showAdminCorrection && ' — editing as admin. Every change is recorded in the audit log with your reason.'}
                      </span>
                      {/* The only route past this lock. Admin-only, and every use is
                          recorded in audit_logs with a mandatory reason. */}
                      {userRole === 'admin' && !showAdminCorrection && (
                        <div className="ml-auto flex flex-col items-end gap-0.5 flex-shrink-0">
                        <button
                          type="button"
                          onClick={openCorrection}
                          className="inline-flex items-center space-x-1 px-2 py-1 rounded-spa border border-warning/40 text-warning hover:bg-warning/10 spa-transition-fast font-body font-body-medium text-[11px] flex-shrink-0"
                        >
                          <Icon name="Wrench" size={12} />
                          <span>Correct as admin</span>
                        </button>
                        <span className="text-[10px] text-text-tertiary text-right">Change a settled booking. Needs a reason; it's logged.</span>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Status and Actions - Stack on mobile (modal only: the panel shows status as the header pill and moves transitions to the footer) */}
                {!isPanel && (
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="flex items-center space-x-2">
                    <span className="font-body font-body-medium text-sm text-text-primary">Status:</span>
                    {showAdminCorrection ? (
                      <div className="w-40">
                        <CustomSelect
                          value={correctionFields.status}
                          onChange={(v) => setCorrectionField('status', v)}
                          options={CORRECTION_STATUS_OPTIONS}
                          size="sm"
                        />
                      </div>
                    ) : (
                      <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-caption font-caption-normal capitalize ${STATUS_STYLES[booking.status] || 'bg-gray-100 text-gray-500'}`}>
                        {booking.status.replace('-', ' ')}
                      </span>
                    )}
                  </div>
                  {!showAdminCorrection && !isTerminal && !isLocked && nextStatuses.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {nextStatuses.map((status) => {
                        const needsConfirm = status === 'cancelled' || status === 'no show';
                        const futureBlock = status === 'in-progress' ? futureStart : status === 'completed' ? futureComplete : status === 'no show' ? futureNoShow : null;
                        const noShowBlocked = (status === 'no show' && !hasBookingStarted(booking)) || !!futureBlock;
                        const rescheduleDisabled = isServiceStarted || isLocked || booking.paymentStatus === 'paid';
                        return (
                          <React.Fragment key={status}>
                            {status === 'cancelled' && onRescheduleStart && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="min-h-[40px] sm:min-h-0 sm:h-auto"
                                onClick={() => onRescheduleStart(booking)}
                                disabled={rescheduleDisabled}
                                title={booking.paymentStatus === 'paid' ? 'Cannot reschedule a paid booking.' : rescheduleDisabled ? 'This service has already started.' : undefined}
                              >
                                Reschedule
                              </Button>
                            )}
                            <Button
                              variant={needsConfirm ? 'outline' : 'primary'}
                              size="sm"
                              className="min-h-[40px] sm:min-h-0 sm:h-auto"
                              onClick={() => needsConfirm ? setPendingStatus(status) : handleStatusUpdate(status)}
                              loading={isLoading}
                              disabled={noShowBlocked}
                              title={noShowBlocked ? (futureBlock || "Available after the booking's scheduled time") : undefined}
                            >
                              {status === 'in-progress' ? 'Start' : status === 'no show' ? 'No show' : status.charAt(0).toUpperCase() + status.slice(1)}
                            </Button>
                          </React.Fragment>
                        );
                      })}
                    </div>
                  )}
                </div>
                )}

                {isPanel && !isEditing && (() => {
                  // Alerts / previous due come from the calendar card's data (the panel's own fetch doesn't carry them).
                  const extras = previewBooking && (previewBooking.bookingId || previewBooking.id) === booking.bookingId ? previewBooking : null;
                  const copy = (v) => { try { navigator.clipboard?.writeText(v); } catch (_) { /* clipboard unavailable */ } };
                  const copyBtn = (value, label) => (
                    <button type="button" onClick={() => copy(value)} aria-label={label} title={label}
                      className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded-spa text-text-tertiary hover:text-primary hover:bg-background spa-transition-fast">
                      <Icon name="Copy" size={12} />
                    </button>
                  );
                  const sectionHead = 'font-body font-medium text-xs uppercase tracking-wider text-text-tertiary whitespace-nowrap';
                  return (
                    <>

                      <AvailabilityNoteLine note={booking.availabilityNote} className="mb-2" />
                      <AlertsBlock customerNotes={extras?.customerNotes} specialRequests={booking.specialRequests} />
                      {restricted && !isViewer && !isTerminal && !isLocked && (
                        <RestrictedNotes bookingId={booking.bookingId} value={booking.specialRequests} onSaved={() => onRefreshBooking?.(booking.bookingId)} />
                      )}

                      {!restricted && booking.customerEmail && (
                        <div className="group flex items-center gap-2 text-[13px] text-text-primary min-w-0">
                          <Icon name="Mail" size={14} className="text-text-tertiary flex-shrink-0" />
                          <span className="break-all">{booking.customerEmail}</span>
                          {copyBtn(booking.customerEmail, 'Copy email')}
                        </div>
                      )}

                      {booking.referredBy && (
                        <div className="border-t border-border pt-5 space-y-2">
                          <h3 className={sectionHead}>Referral</h3>
                          <p className="text-[13px] text-text-primary"><span className="text-text-secondary">Referred by:</span> {booking.referredBy}</p>
                        </div>
                      )}
                    </>
                  );
                })()}

                {!(isPanel && !isEditing) && (
                <>
                {/* Customer & Service Information - Responsive grid */}
                {isEditing && !showAdminCorrection ? (
                  <div className="space-y-4">
                    {/* Edit details (ZNLY-324): one column at every width, same controls as New booking. */}
                    <h3 className="font-body font-medium text-xs uppercase tracking-wider text-text-tertiary">Booking</h3>
                    <div>
                      <label className="block font-body font-body-medium text-[13px] text-text-primary mb-1.5">Date &amp; time <span className="text-error">*</span></label>
                      <DateTimeRow
                        date={editForm.date}
                        time={editForm.startTime}
                        onDateChange={(d) => setEditForm(f => ({ ...f, date: d }))}
                        onTimeChange={(t) => setEditForm(f => ({ ...f, startTime: t }))}
                        branchHours={branchHours}
                      />
                      {editForm.startTime && !isWithinBranchHours(editForm.startTime) && (
                        <p className="font-caption text-[11px] text-warning mt-1.5">
                          Outside branch hours ({formatClockRange(branchHours?.openTime?.slice(0, 5) || '09:00', branchHours?.closeTime?.slice(0, 5) || '21:00', use24h)})
                        </p>
                      )}
                      <BlockOverlapWarning message={editBlockMsg} className="mt-2" />
                    </div>
                    <div>
                      <label className="block font-body font-body-medium text-[13px] text-text-primary mb-1.5">Service <span className="text-error">*</span></label>
                      {services?.length > 0 ? (
                        <ServicePickRow required services={services} value={editForm.serviceId} onChange={(val) => setEditForm(f => ({ ...f, serviceId: val }))} branchId={booking?.branchId || branchId} canViewPrices={canViewPrices} title="Service for this booking" sub={booking.customerName || ''} ariaLabel="Service" />
                      ) : (
                        <p className="font-body font-body-normal text-sm text-text-primary">{booking.service}</p>
                      )}
                    </div>
                    {canViewPrices && (
                      <div className="flex items-center justify-between gap-3 rounded-spa bg-background px-3 py-2 text-[13px]">
                        <span className="text-text-secondary">Payment <span className={`font-body-medium ${payTone(booking)}`}>{paymentStatusLabel(booking, { partialText: 'Partial' }).label}</span></span>
                        <button type="button" onClick={() => goTab('payment')} className="text-primary font-body-medium hover:underline whitespace-nowrap">Payment tab ›</button>
                      </div>
                    )}
                    <h3 className="font-body font-medium text-xs uppercase tracking-wider text-text-tertiary pt-1">Customer</h3>
                    <div>
                      {walkInNoClient ? (
                        <label className="flex items-baseline justify-between font-body font-body-medium text-[13px] text-text-primary mb-1.5"><span>Name</span><span className="text-xs font-normal text-text-secondary">optional</span></label>
                      ) : (
                        <label className="block font-body font-body-medium text-[13px] text-text-primary mb-1.5">Name <span className="text-error">*</span></label>
                      )}
                      <input type="text" value={editForm.customerName} onChange={(e) => setEditForm(f => ({ ...f, customerName: e.target.value }))} className={inputClasses}
                        {...(walkInNoClient ? { placeholder: 'First name, e.g. Ram', maxLength: 40 } : {})} />
                    </div>
                    {walkInNoClient ? (
                      canAddClient ? (
                        <button type="button" onClick={() => setAddClientSignal((n) => n + 1)} className="text-sm font-body-medium text-primary hover:underline">＋ Add client</button>
                      ) : null
                    ) : (
                      <PhoneField
                        label="Phone" id="edit-booking-phone" walkInHint placeholder="Phone number"
                        dial={editForm.phoneDial} national={editForm.phoneNational} original={editForm.customerPhone}
                        onChange={({ dial, national }) => setEditForm(f => ({ ...f, phoneDial: dial, phoneNational: national }))}
                      />
                    )}
                  </div>
                ) : (
                <div className={isPanel ? `grid gap-6 ${wideBody ? 'grid-cols-2' : 'grid-cols-1'}` : 'grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6'}>
                  <div className="space-y-3 sm:space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className={isPanel ? 'font-body font-medium text-xs uppercase tracking-wider text-text-tertiary whitespace-nowrap' : 'font-heading font-heading-medium text-sm sm:text-base text-text-primary'}>
                        {isPanel ? 'Customer' : 'Customer Information'}
                      </h3>
                      {editAllowed && !isEditing && !showAdminCorrection && onEditBooking && (
                        <button
                          onClick={openEdit}
                          className="p-1.5 rounded-spa hover:bg-background spa-transition-fast text-text-secondary hover:text-primary"
                          title="Edit booking details"
                        >
                          <Icon name="Pencil" size={14} />
                        </button>
                      )}
                    </div>
                    <div className="space-y-2.5 sm:space-y-3">
                      <div>
                        <label className="flex items-center gap-1.5 font-body font-body-medium text-xs sm:text-sm text-text-secondary">
                          Name
                          {showAdminCorrection && Object.prototype.hasOwnProperty.call(correctionChangedFields, 'customer_name') && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-warning/10 text-warning text-[10px] font-body-medium">changed</span>
                          )}
                        </label>
                        {showAdminCorrection ? (
                          <input
                            type="text"
                            value={correctionFields.customer_name}
                            onChange={(e) => setCorrectionField('customer_name', e.target.value)}
                            className={inputClasses}
                          />
                        ) : isEditing ? (
                          <input
                            type="text"
                            value={editForm.customerName}
                            onChange={(e) => setEditForm(f => ({ ...f, customerName: e.target.value }))}
                            className={inputClasses}
                            {...(walkInNoClient ? { placeholder: 'First name, e.g. Ram (optional)', maxLength: 40 } : {})}
                          />
                        ) : (
                          <p className="font-body font-body-normal text-sm text-text-primary">{booking.customerName}</p>
                        )}
                      </div>
                      {(booking.customerEmail && !isEditing && !showAdminCorrection) && (
                        <div>
                          <label className="font-body font-body-medium text-xs sm:text-sm text-text-secondary">Email</label>
                          <p className="font-body font-body-normal text-sm text-text-primary break-all">{booking.customerEmail}</p>
                        </div>
                      )}
                      <div>
                        <label className="flex items-center gap-1.5 font-body font-body-medium text-xs sm:text-sm text-text-secondary">
                          Phone
                          {showAdminCorrection && Object.prototype.hasOwnProperty.call(correctionChangedFields, 'customer_phone') && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-warning/10 text-warning text-[10px] font-body-medium">changed</span>
                          )}
                        </label>
                        {showAdminCorrection ? (
                          <PhoneField
                            id="correction-phone" placeholder="Phone number"
                            dial={correctionFields._phone.dial} national={correctionFields._phone.national} original={correctionInitialFields?.customer_phone}
                            onChange={({ dial, national }) => setCorrectionFields((prev) => ({ ...prev, _phone: { dial, national }, customer_phone: phoneFieldValue({ dial, national, original: correctionInitialFields?.customer_phone }) || '' }))}
                          />
                        ) : isEditing && walkInNoClient ? (
                          canAddClient ? (
                            <button type="button" onClick={() => setAddClientSignal((n) => n + 1)} className="text-sm font-body-medium text-primary hover:underline">＋ Add client</button>
                          ) : <p className="font-body text-sm text-text-secondary italic">Not provided</p>
                        ) : isEditing ? (
                          <PhoneField
                            id="edit-booking-phone-modal" walkInHint placeholder="Phone number"
                            dial={editForm.phoneDial} national={editForm.phoneNational} original={editForm.customerPhone}
                            onChange={({ dial, national }) => setEditForm(f => ({ ...f, phoneDial: dial, phoneNational: national }))}
                          />
                        ) : (
                          booking.customerPhone ? (
                            <p className="font-body font-body-normal text-sm text-text-primary">{formatPhoneGrouped(booking.customerPhone)}</p>
                          ) : (
                            <p className="font-body font-body-normal text-sm text-text-secondary italic">Not provided</p>
                          )
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3 sm:space-y-4">
                    <h3 className={isPanel ? 'font-body font-medium text-xs uppercase tracking-wider text-text-tertiary whitespace-nowrap' : 'font-heading font-heading-medium text-sm sm:text-base text-text-primary'}>
                      {isPanel ? 'Service' : 'Service Details'}
                    </h3>
                    <div className="space-y-2.5 sm:space-y-3">
                      <div>
                        <label className="font-body font-body-medium text-xs sm:text-sm text-text-secondary">Service</label>
                        {isEditing && services?.length > 0 ? (
                          <>
                            <div className="mt-1"><ServicePickRow required services={services} value={editForm.serviceId} onChange={(val) => setEditForm(f => ({ ...f, serviceId: val }))} branchId={booking?.branchId || branchId} canViewPrices={canViewPrices} title="Service for this booking" sub={booking.customerName || ''} ariaLabel="Service" /></div>
                          </>
                        ) : (
                          <p className="font-body font-body-normal text-sm text-text-primary">{booking.service}</p>
                        )}
                      </div>
                      {!isEditing && (
                        <div className="flex gap-4">
                          <div>
                            <label className="font-body font-body-medium text-xs sm:text-sm text-text-secondary">Duration</label>
                            <p className="font-body font-body-normal text-sm text-text-primary">{booking.duration}</p>
                          </div>
                          <div>
                            <label className="flex items-center gap-1.5 font-body font-body-medium text-xs sm:text-sm text-text-secondary">
                              Price
                              {showAdminCorrection && Object.prototype.hasOwnProperty.call(correctionChangedFields, 'base_amount') && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-warning/10 text-warning text-[10px] font-body-medium">changed</span>
                              )}
                            </label>
                            {showAdminCorrection ? (
                              <input
                                type="number"
                                step="any"
                                value={correctionFields.base_amount}
                                onChange={(e) => setCorrectionField('base_amount', e.target.value)}
                                className={`${inputClasses} w-28`}
                              />
                            ) : (
                              <p className="font-body font-body-normal text-sm text-text-primary">{booking.price}</p>
                            )}
                          </div>
                          {showAdminCorrection && (
                            <div>
                              <label className="flex items-center gap-1.5 font-body font-body-medium text-xs sm:text-sm text-text-secondary">
                                Discount
                                {Object.prototype.hasOwnProperty.call(correctionChangedFields, 'discount_amount') && (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-warning/10 text-warning text-[10px] font-body-medium">changed</span>
                                )}
                              </label>
                              <p className="font-body font-body-normal text-sm text-text-primary py-2">
                                NPR {Number(correctionFields.discount_amount || 0).toLocaleString('en-IN')}
                              </p>
                              <p className="font-caption text-[11px] text-text-tertiary">Edit on the Discount tab</p>
                            </div>
                          )}
                        </div>
                      )}
                      <div>
                        <label className="flex items-center gap-1.5 font-body font-body-medium text-xs sm:text-sm text-text-secondary">
                          Date & Time
                          {showAdminCorrection && (Object.prototype.hasOwnProperty.call(correctionChangedFields, 'date') || Object.prototype.hasOwnProperty.call(correctionChangedFields, 'start_time')) && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-warning/10 text-warning text-[10px] font-body-medium">changed</span>
                          )}
                        </label>
                        {showAdminCorrection ? (
                          <div className="flex gap-2">
                            <input
                              type="date"
                              value={correctionFields.date}
                              onChange={(e) => setCorrectionField('date', e.target.value)}
                              className={inputClasses}
                            />
                            <input
                              type="time"
                              value={correctionFields.start_time}
                              onChange={(e) => setCorrectionField('start_time', e.target.value)}
                              className={inputClasses}
                            />
                          </div>
                        ) : isEditing ? (
                          <div className="space-y-1.5">
                            <input
                              type="date"
                              value={editForm.date}
                              onChange={(e) => setEditForm(f => ({ ...f, date: e.target.value }))}
                              className={inputClasses}
                            />
                            <TimeBoxInput
                              value={editForm.startTime}
                              onChange={(val) => setEditForm(f => ({ ...f, startTime: val }))}
                            />
                            {editForm.startTime && !isWithinBranchHours(editForm.startTime) && (
                              <p className="font-caption text-[11px] text-warning">
                                Outside branch hours ({formatClockRange(branchHours?.openTime?.slice(0, 5) || '09:00', branchHours?.closeTime?.slice(0, 5) || '21:00', use24h)})
                              </p>
                            )}
                          </div>
                        ) : null}
                        {isEditing ? (
                          <BlockOverlapWarning message={editBlockMsg} className="mt-2" />
                        ) : (
                          <p className="font-body font-body-normal text-sm text-text-primary">{booking.date} at {clock(booking.time || booking.startTime)}</p>
                        )}
                      </div>
{canViewPrices && <div>
                        <label className="font-body font-body-medium text-xs sm:text-sm text-text-secondary">Payment</label>
                        <p className={`font-body font-body-medium text-sm ${payTone(booking)}`}>
                          {paymentStatusLabel(booking, { partialText: 'Partial' }).label}
                        </p>
                      </div>}
                    </div>
                  </div>
                </div>
                )}

                {/* Therapist(s) */}
                {(booking.therapists?.length > 0 || booking.therapist) && !isEditing && (
                  <div className="space-y-1.5 sm:space-y-2">
                    <label className="font-body font-body-medium text-xs sm:text-sm text-text-secondary">
                      Assigned {staffLabel}{(booking.therapists?.length || 0) > 1 ? 's' : ''}
                    </label>
                    <div className="font-body font-body-normal text-sm text-text-primary">
                      {(booking.therapists?.length > 0 ? booking.therapists : [booking.therapist]).filter(Boolean).map((t, i) => (
                        <span key={t.id}>
                          {i > 0 && ', '}
                          {t.name}{t.gender ? ` (${t.gender})` : ''}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Gender Preference — read-only, customer-submitted at booking time */}
                {booking.genderPreference && booking.genderPreference !== 'no-preference' && (
                  <div className="space-y-1.5 sm:space-y-2">
                    <label className="font-body font-body-medium text-xs sm:text-sm text-text-secondary">Gender Preference</label>
                    <p className="font-body font-body-normal text-sm text-text-primary capitalize">{booking.genderPreference}</p>
                  </div>
                )}

                {/* Special Requests */}
                <div className="space-y-1.5 sm:space-y-2">
                  {isEditing && !showAdminCorrection ? (
                    <label className="block font-body font-body-medium text-[13px] text-text-primary">Special requests</label>
                  ) : (
                    <label className="font-body font-body-medium text-xs sm:text-sm text-text-secondary">Special Requests</label>
                  )}
                  {isEditing ? (
                    <textarea
                      value={editForm.specialRequests}
                      onChange={(e) => setEditForm(f => ({ ...f, specialRequests: e.target.value }))}
                      rows={2}
                      placeholder="Any special requests or notes..."
                      className={`${inputClasses} resize-none`}
                    />
                  ) : booking.specialRequests ? (
                    <div className="p-2.5 sm:p-3 bg-background rounded-spa">
                      <p className="font-body font-body-normal text-sm text-text-primary">{booking.specialRequests}</p>
                    </div>
                  ) : (
                    <p className="font-body font-body-normal text-sm text-text-secondary italic">None</p>
                  )}
                </div>

                {/* Referred by — type freely or pick an existing therapist */}
                <div className="space-y-1.5 sm:space-y-2">
                  {isEditing && !showAdminCorrection ? (
                    <div className="flex items-baseline justify-between">
                      <label className="font-body font-body-medium text-[13px] text-text-primary">Referred by</label>
                      <span className="text-[12px] text-text-tertiary">optional</span>
                    </div>
                  ) : (
                    <label className="font-body font-body-medium text-xs sm:text-sm text-text-secondary">Referred by</label>
                  )}
                  {isEditing ? (
                    <div className="relative">
                      <input
                        type="text"
                        value={editForm.referredBy || ''}
                        onChange={(e) => { setEditForm(f => ({ ...f, referredBy: e.target.value })); setReferredByOpen(true); }}
                        onFocus={() => setReferredByOpen(true)}
                        onBlur={() => setTimeout(() => setReferredByOpen(false), 150)}
                        placeholder={`Type a name or pick a ${(staffLabel || 'team member').toLowerCase()}…`}
                        className={inputClasses}
                      />
                      {referredByOpen && (() => {
                        const q = (editForm.referredBy || '').toLowerCase().trim();
                        const matches = therapists.filter(t => !q || t.name.toLowerCase().includes(q));
                        if (matches.length === 0) return null;
                        return (
                          <div className="absolute z-dropdown mt-1 w-full bg-surface border border-border rounded-spa shadow-spa-elevated max-h-[180px] overflow-y-auto">
                            {matches.map(t => (
                              <button
                                key={t.id}
                                type="button"
                                onMouseDown={() => { setEditForm(f => ({ ...f, referredBy: t.name })); setReferredByOpen(false); }}
                                className="w-full text-left px-3 py-2 text-sm text-text-primary hover:bg-background spa-transition-fast"
                              >
                                {t.name}
                              </button>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  ) : booking.referredBy ? (
                    <div className="p-2.5 sm:p-3 bg-background rounded-spa">
                      <p className="font-body font-body-normal text-sm text-text-primary">{booking.referredBy}</p>
                    </div>
                  ) : (
                    <p className="font-body font-body-normal text-sm text-text-secondary italic">None</p>
                  )}
                </div>
                </>
                )}

                {/* Customer-to-customer referral reward — separate from the legacy
                    staff/therapist referredBy field above. Only present when this
                    booking was the referred customer's first booking. */}
                {customerReferral && (
                  <div className="space-y-1.5 sm:space-y-2">
                    <label className="font-body font-body-medium text-xs sm:text-sm text-text-secondary">Referred by (customer)</label>
                    <div className="p-2.5 sm:p-3 bg-background rounded-spa flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-body font-body-normal text-sm text-text-primary truncate">
                          {customerReferral.referrerName}
                          {customerReferral.referrerPhone ? ` · ${customerReferral.referrerPhone}` : ''}
                        </p>
                        <p className="font-caption text-xs text-text-tertiary">
                          {customerReferral.rewardType === 'voucher'
                            ? (customerReferral.rewardLabel || 'Gift Voucher')
                            : 'Wallet credit'}
                          {customerReferral.rewardAmount > 0 ? ` — NPR ${customerReferral.rewardAmount.toLocaleString('en-IN')}` : ''}
                        </p>
                      </div>
                      <span className={`flex-shrink-0 px-2 py-0.5 rounded-full text-[11px] font-caption font-caption-medium ${
                        customerReferral.rewardStatus === 'credited' ? 'bg-success/10 text-success' : 'bg-amber-100 text-amber-800'
                      }`}>
                        {customerReferral.rewardStatus === 'credited' ? 'Credited' : 'Pending'}
                      </span>
                    </div>

                    {customerReferral.rewardStatus === 'pending' && customerReferral.requiresManualReward && ['manager', 'admin'].includes(userRole) && (
                      <div className="p-2.5 sm:p-3 bg-background rounded-spa space-y-2">
                        <p className="font-body font-body-medium text-xs sm:text-sm text-text-primary">Wallet credit amount</p>
                        <input
                          type="number"
                          min="0"
                          value={rewardAmount}
                          onWheel={(e) => e.target.blur()}
                          onChange={(e) => setRewardAmount(e.target.value)}
                          placeholder="e.g. 500 (leave blank for the org default)"
                          className="w-full h-10 px-3 rounded-md border border-gray-200 bg-white text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                        />
                        {rewardError && (
                          <p className="font-caption text-xs text-error">{rewardError}</p>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          onClick={handleResolveReferralReward}
                          loading={rewardSubmitting}
                          disabled={rewardSubmitting}
                        >
                          Issue Reward
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                {/* Created-by audit line — shows staff name, or "Online booking" for
                    anonymous customer self-bookings (created_by is null). Matches
                    CalendarBookingCard's fallback. */}
                {!isPanel && !isEditing && creator && (
                  <div className="pt-3 border-t border-border">
                    <p className="font-caption text-xs text-text-tertiary">
                      <Icon name="UserPlus" size={12} className="inline-block mr-1 -mt-0.5" />
                      Created by{' '}
                      <span className="text-text-secondary">{creator.createdByName || 'Online booking'}</span>
                      {creator.createdAt ? ` · ${formatCreatedAt(creator.createdAt)}` : ''}
                    </p>
                    {creator.acknowledgedAt && !creator.createdByName && creator.acknowledgedByName && (
                      <p className="font-caption text-xs text-text-tertiary mt-1">Seen by <span className="text-text-secondary">{creator.acknowledgedByName}</span> · {formatCreatedAt(creator.acknowledgedAt)}</p>
                    )}
                  </div>
                )}

                {/* Panel meta line: booking number + created-by audit */}
                {isPanel && !isEditing && (
                  <div className="border-t border-border pt-4 group flex items-center flex-wrap gap-x-1 text-xs text-text-tertiary">
                    <span className="tabular-nums" data-booking-reference>{block.reference}</span>
                    {block.reference !== booking.id && <span className="tabular-nums text-text-tertiary/80">· this service {booking.id}</span>}
                    {booking.id && (
                      <button type="button" onClick={() => { try { navigator.clipboard?.writeText(String(block.reference)); } catch (_) { /* clipboard unavailable */ } }}
                        aria-label="Copy booking number" title="Copy booking number"
                        className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded-spa hover:text-primary hover:bg-background spa-transition-fast">
                        <Icon name="Copy" size={12} />
                      </button>
                    )}
                    {creator?.createdByName && <span>· Created by {creator.createdByName}{creator.createdAt ? ` · ${formatCreatedAt(creator.createdAt)}` : ''}</span>}
                    {creator && !creator.createdByName && creator.acknowledgedAt && creator.acknowledgedByName && <span>· Seen by {creator.acknowledgedByName} · {formatCreatedAt(creator.acknowledgedAt)}</span>}
                  </div>
                )}

                {/* History: availability overrides (reason, code, who) for managers/admins */}
                {!isEditing && (userRole === 'manager' || userRole === 'admin') && booking?.bookingId && (
                  <BookingHistory bookingId={booking.bookingId} paymentIds={(booking.payments || []).map((p) => p.id).filter(Boolean)} reloadKey={historyReload} />
                )}

                {correctionNote && (
                  <div role="status" className="flex items-center gap-2 p-3 bg-success/10 border border-success/20 rounded-spa text-success text-sm">
                    <Icon name="CheckCircle2" size={16} />
                    <span>{correctionNote}</span>
                  </div>
                )}

                {/* Action error (status update failures) */}
                {actionError && !editError && (
                  <><InlineError error={actionError} onAction={onGuideAction} area="booking-panel" />{actionError && guideNote ? <p data-guide-note className="mt-1.5 text-xs text-text-secondary">{guideNote}</p> : null}</>
                )}

                {/* Edit error */}
                {editError && (
                  <><InlineError error={editError} onAction={onGuideAction} area="booking-panel" />{editError && guideNote ? <p data-guide-note className="mt-1.5 text-xs text-text-secondary">{guideNote}</p> : null}</>
                )}
              </div>
            )}

            {/* Assigned Tab */}
            {activeTab === 'assign' && (
              <BookingStaffRows
                rows={block.rows.filter((r) => !r.dead)}
                picks={rowPicks}
                setPicks={setRowPicks}
                editable={multiStaffEditable}
                therapists={therapists}
                rooms={rooms}
                dayBookings={effDayBookings}
                offStaff={effOffStaff}
                allowOverlap={allowStaffOverlap}
                staffLabel={staffLabel}
                staffLabelPlural={staffLabelPlural}
                use24h={use24h}
                notes={notes}
                setNotes={setNotes}
                notesDisabled={isViewer || isLocked}
                error={actionError && (
                  <><InlineError error={actionError} onAction={onGuideAction} area="booking-panel" />{failedName && <p className="mt-1.5 text-xs text-text-secondary">Not saved for {failedName}. The services above it were saved.</p>}</>
                )}
              />
            )}

            {/* Discount Tab */}
            {activeTab === 'discount' && (
              <div className="space-y-4 sm:space-y-6">
                {!memberCardOn && (
                  <h3 className="font-heading font-heading-medium text-sm sm:text-base text-text-primary">
                    Apply Discount
                  </h3>
                )}

                {showAdminCorrection ? (
                  <>
                    {/* Admin-correction discount UI — a single booking, no related-row
                        bundling and no approver routing (admin's limit is already 100%).
                        Submits through correctionFields.discount_amount -> admin_correct_booking,
                        same as every other correction field, not the normal applyDiscount() path
                        (which rejects locked/terminal bookings). */}
                    <div className="bg-background rounded-spa p-3 sm:p-4 space-y-2">
                      {(() => {
                        const base = Number(correctionFields.base_amount) || 0;
                        const discount = correctionDiscountComputed();
                        const final = Math.max(base - discount, 0);
                        return (
                          <>
                            <div className="flex justify-between items-center">
                              <span className="font-body font-body-normal text-sm text-text-secondary">Base Amount</span>
                              <span className="font-data font-data-normal text-sm text-text-primary">NPR {base.toLocaleString('en-IN')}</span>
                            </div>
                            {discount > 0 && (
                              <div className="flex justify-between items-center">
                                <span className="font-body font-body-normal text-sm text-text-secondary">Discount Applied</span>
                                <span className="font-data font-data-normal text-sm text-success">- NPR {discount.toLocaleString('en-IN')}</span>
                              </div>
                            )}
                            <div className="flex justify-between items-center">
                              <span className="font-body font-body-normal text-sm text-text-secondary">Subtotal</span>
                              <span className="font-data font-data-normal text-sm text-text-primary">NPR {final.toLocaleString('en-IN')}</span>
                            </div>
                            <div className="pt-2 border-t border-border flex justify-between items-center">
                              <span className="font-body font-body-medium text-sm text-text-primary">Final Amount</span>
                              <span className="font-data font-data-medium text-base text-primary">NPR {final.toLocaleString('en-IN')}</span>
                            </div>
                          </>
                        );
                      })()}
                    </div>

                    <div className="flex items-center space-x-2 px-3 py-2.5 rounded-spa bg-accent/5 border border-accent/20">
                      <Icon name="Info" size={14} className="text-accent flex-shrink-0" />
                      <span className="font-caption font-caption-normal text-xs text-accent">
                        Your role ({userRole}) allows up to {discountLimitLabel} discount.
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 sm:gap-3">
                      {['percentage', 'fixed'].map(type => (
                        <label
                          key={type}
                          className={`flex items-center space-x-2 p-2.5 sm:p-3 rounded-spa border-2 cursor-pointer spa-transition-fast min-h-[48px] ${
                            correctionDiscountType === type ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
                          }`}
                        >
                          <input
                            type="radio"
                            name="correctionDiscountType"
                            value={type}
                            checked={correctionDiscountType === type}
                            onChange={() => setCorrectionDiscountType(type)}
                            className="text-primary focus:ring-primary w-4 h-4"
                          />
                          <span className="font-body font-body-medium text-xs sm:text-sm text-text-primary">
                            {type === 'percentage' ? '% Percent' : 'NPR Fixed'}
                          </span>
                        </label>
                      ))}
                    </div>

                    <div className="space-y-1.5 sm:space-y-2">
                      <label className="flex items-center gap-1.5 font-body font-body-medium text-xs sm:text-sm text-text-primary">
                        {correctionDiscountType === 'percentage' ? 'Discount Percentage' : 'Discount Amount (NPR)'}
                        {Object.prototype.hasOwnProperty.call(correctionChangedFields, 'discount_amount') && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-warning/10 text-warning text-[10px] font-body-medium">changed</span>
                        )}
                      </label>
                      <input
                        type="number"
                        min="0"
                        step={correctionDiscountType === 'percentage' ? 1 : 10}
                        value={correctionDiscountValue}
                        onWheel={(e) => e.target.blur()}
                        onChange={(e) => setCorrectionDiscountValue(e.target.value)}
                        placeholder={correctionDiscountType === 'percentage' ? `Max ${discountLimitLabel}` : 'NPR'}
                        className={inputClasses}
                      />
                    </div>

                    {(() => {
                      const applied = String(correctionFields.discount_amount) !== String(correctionInitialFields?.discount_amount ?? '');
                      const pending = Number(correctionFields.discount_amount) !== correctionDiscountComputed();
                      return (
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-caption text-[11px] text-text-tertiary">
                            {applied
                              ? <span className="text-success font-body-medium">Applied — reason is captured when you click Save.</span>
                              : 'Not applied yet — click Apply to stage this discount.'}
                          </span>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {applied && (
                              <button
                                type="button"
                                onClick={cancelCorrectionDiscount}
                                className="px-3 py-1.5 rounded-spa border border-border text-xs font-body font-body-medium text-text-secondary hover:bg-background spa-transition-fast"
                              >
                                Cancel
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={applyCorrectionDiscount}
                              disabled={!pending}
                              className="px-3 py-1.5 rounded-spa bg-primary text-white text-xs font-body font-body-medium hover:bg-primary/90 disabled:opacity-40 spa-transition-fast"
                            >
                              Apply
                            </button>
                          </div>
                        </div>
                      );
                    })()}
                  </>
                ) : !canDiscount ? (
                  <div className="flex items-center space-x-2 px-3 py-2.5 rounded-spa bg-gray-50 border border-gray-200">
                    <Icon name="Lock" size={16} className="text-gray-500 flex-shrink-0" />
                    <span className="font-body font-body-medium text-xs text-gray-600">
                      {booking.paymentStatus === 'paid'
                        ? 'Cannot modify discount on a paid booking.'
                        : booking.paymentStatus === 'partial'
                          ? 'Cannot modify discount — a payment has already been recorded.'
                          : 'Discount changes are not allowed for this booking state.'}
                    </span>
                  </div>
                ) : (
                  <>
                    {memberCardOn && (
                      <>
                        <MemberDiscountCard md={memberMd} ctx={memberCtx} busy={memberBusy}
                          serviceLabel={[memberCtx.booking.serviceName || booking.service || 'Service', memberCtx.booking.serviceMinutes ? `${memberCtx.booking.serviceMinutes} min` : null].filter(Boolean).join(' · ')}
                          onApply={() => runMember(false)} onDecline={() => runMember(true)} />
                        {discountError && !showManualDiscount && (
                          <><InlineError error={discountError} onAction={onGuideAction} area="booking-panel" />{discountError && guideNote ? <p data-guide-note className="mt-1.5 text-xs text-text-secondary">{guideNote}</p> : null}</>
                        )}
                        <div className="border-t border-border pt-4">
                          <button type="button" onClick={() => setShowManualDiscount((v) => !v)} className="w-full flex items-start gap-2.5 text-left group" aria-expanded={showManualDiscount} data-manual-toggle>
                            <Icon name={showManualDiscount ? 'Minus' : 'Plus'} size={14} className="mt-0.5 text-[#8A8A90]" />
                            <span>
                              <span className="block text-[13px] text-text-primary group-hover:underline">Give a different discount instead</span>
                              <span className="block text-[12px] text-[#8A8A90]">Replaces the member discount. They never add up.</span>
                            </span>
                          </button>
                        </div>
                      </>
                    )}
                    {memberMd?.kind === 'noRule' && (
                      <p className="flex items-center gap-2 text-[12.5px] text-[#8A8A90]" data-member-card="none"><Icon name="Star" size={12} className="fill-current text-[#B4B4BA]" strokeWidth={0} />No {memberMd.tierName} discount on {memberMd.label} services</p>
                    )}
                    {(!memberCardOn || showManualDiscount) && (<>
                    {!legacyGroups ? (
                      <BookingDiscountLines
                        rows={mvRows}
                        plan={planMV}
                        perService={perService}
                        onTogglePer={() => { setPerService((v) => !v); setDiscountError(null); }}
                        type={discountType}
                        values={rowDiscountOverrides}
                        onChange={(id, v) => { setRowOverride(id, v); setDiscountError(null); }}
                        use24h={use24h}
                        canEdit={!isViewer && !isLocked && mvEligible.length > 0}
                        existingTotal={mvRows.reduce((sm, r) => sm + r.discount, 0)}
                        onRemove={handleRemoveAllDiscounts}
                        removing={isLoading}
                      />
                    ) : (<>
                    {/* All bookings pricing summary */}
                    <p className="text-[11.5px] text-[#8A8A90] font-medium uppercase tracking-[.05em] -mb-2 sm:-mb-4">Price</p>
                    <div className="bg-surface border border-border rounded-lg p-3 sm:p-4 space-y-2">
                      {(() => {
                        const base = booking.baseAmount || 0;
                        const multiRow = relatedBookings.length > 0;
                        const primaryChecked = selectedDiscountIds.has(booking.bookingId);
                        const primaryPlan = resolveRowDiscount(booking.bookingId);
                        const primaryLive = primaryChecked && primaryPlan.value > 0;

                        let previewDiscountAmt = booking.discountAmount || 0;
                        let previewDiscountPct = base > 0 ? Math.round((previewDiscountAmt / base) * 100) : 0;
                        if (primaryLive) {
                          previewDiscountAmt = primaryPlan.amount;
                          previewDiscountPct = Math.round(primaryPlan.effPercent * 10) / 10;
                        }
                        const previewFinal = Math.max(base - previewDiscountAmt, 0);
                        const hasExistingDiscount = booking.discountAmount > 0;
                        const showDiscount = primaryLive || hasExistingDiscount;

                        // Per-row override input, reused for the primary booking and every related row —
                        // lets each checked service get its own rate instead of the shared value above.
                        const renderOverrideInput = (id) => (
                          <div className="pl-5 mt-1 flex items-center gap-1.5">
                            <input
                              type="number"
                              min="0"
                              value={rowDiscountOverrides[id] ?? ''}
                              onWheel={(e) => e.target.blur()}
                              onChange={(e) => setRowOverride(id, e.target.value)}
                              placeholder={discountType === 'percentage' ? 'Same %' : 'Same NPR'}
                              title={discountType === 'percentage' ? 'Same as shared %' : 'Same as shared NPR'}
                              className="w-20 px-2 py-1 border border-border rounded-spa bg-surface text-text-primary text-xs focus:ring-2 focus:ring-primary focus:border-primary spa-transition-fast"
                            />
                            <span className="font-caption text-[10px] text-text-secondary">
                              {discountType === 'percentage' ? '% for just this service' : 'NPR for just this service'}
                            </span>
                          </div>
                        );

                        return (
                          <>
                            {/* Current booking — checkbox + override only when multiple services */}
                            {multiRow ? (
                              <div className="mb-1">
                                <label className={`flex items-start gap-2 cursor-pointer`}>
                                  <input
                                    type="checkbox"
                                    checked={primaryChecked}
                                    onChange={(e) => {
                                      setSelectedDiscountIds(prev => {
                                        const next = new Set(prev);
                                        if (e.target.checked) next.add(booking.bookingId);
                                        else next.delete(booking.bookingId);
                                        return next;
                                      });
                                      if (!e.target.checked) clearRowOverride(booking.bookingId);
                                    }}
                                    className="text-primary focus:ring-primary w-3.5 h-3.5 rounded mt-0.5"
                                  />
                                  <div className="flex-1 min-w-0">
                                    <span className="font-body font-body-medium text-xs text-text-primary">{booking.service}</span>
                                    <div className="font-caption text-[10px] text-text-secondary flex flex-wrap gap-x-2">
                                      {booking.time && <span>{clock(booking.startTime || booking.time)}{booking.startTime && booking.startTime !== booking.time ? '' : ''}</span>}
                                      {booking.therapist?.name && <span>· {booking.therapist.name}</span>}
                                      {booking.roomName && <span>· {booking.roomName}</span>}
                                    </div>
                                  </div>
                                </label>
                                {primaryChecked && renderOverrideInput(booking.bookingId)}
                              </div>
                            ) : null}
                            <div className="flex items-center justify-between">
                              <span className="font-body font-body-normal text-xs text-text-secondary">Base Amount</span>
                              <span className="font-data text-sm text-text-primary">NPR {base.toLocaleString('en-IN')}</span>
                            </div>
                            {showDiscount && (
                              <div className="flex items-center justify-between">
                                <span className="font-body font-body-normal text-xs text-text-secondary">
                                  {primaryLive ? 'Discount Preview' : 'Discount Applied'}
                                </span>
                                <span className={`font-data text-sm ${primaryLive ? 'text-warning' : 'text-error'}`}>
                                  - NPR {previewDiscountAmt.toLocaleString('en-IN')} ({previewDiscountPct}%)
                                </span>
                              </div>
                            )}
                            <div className="flex items-center justify-between">
                              <span className="font-body font-body-normal text-xs text-text-secondary">Subtotal</span>
                              <span className={`font-data text-sm ${primaryLive ? 'text-warning' : 'text-text-primary'}`}>
                                NPR {previewFinal.toLocaleString('en-IN')}
                              </span>
                            </div>
                            {booking.paymentStatus === 'partial' && (
                              <>
                                <div className="flex items-center justify-between">
                                  <span className="font-body font-body-normal text-xs text-text-secondary">Paid Amount</span>
                                  <span className="font-data text-sm text-text-primary tabular-nums">- NPR {Number(booking.amountPaid || 0).toLocaleString('en-IN')}</span>
                                </div>
                                <div className="flex items-center justify-between border-t border-border pt-2">
                                  <span className="font-body font-body-medium text-xs text-text-primary">Final Amount</span>
                                  <span className="font-data font-data-medium text-sm text-text-primary">
                                    NPR {Math.max(previewFinal - Number(booking.amountPaid || 0), 0).toLocaleString('en-IN')}
                                  </span>
                                </div>
                              </>
                            )}

                            {/* Related bookings */}
                            {multiRow && (
                              <>
                                <div className="border-t border-border my-2" />
                                {relatedBookings.map(rb => {
                                  const rbBase = Number(rb.base_amount || 0);
                                  const rbExistingDiscount = Number(rb.discount_amount || 0);
                                  const rbChecked = selectedDiscountIds.has(rb.id);
                                  const rbPlan = resolveRowDiscount(rb.id);
                                  const rbHasPreview = rbChecked && rbPlan.value > 0;
                                  const rbPreviewDiscount = rbHasPreview ? rbPlan.amount : rbExistingDiscount;
                                  const rbPreviewFinal = Math.max(rbBase - rbPreviewDiscount, 0);
                                  return (
                                    <div key={rb.id} className="space-y-1">
                                      <label className={`flex items-start gap-2 cursor-pointer`}>
                                        <input
                                          type="checkbox"
                                          checked={rbChecked}
                                          onChange={(e) => {
                                            setSelectedDiscountIds(prev => {
                                              const next = new Set(prev);
                                              if (e.target.checked) next.add(rb.id);
                                              else next.delete(rb.id);
                                              return next;
                                            });
                                            if (!e.target.checked) clearRowOverride(rb.id);
                                          }}
                                          className="text-primary focus:ring-primary w-3.5 h-3.5 rounded mt-0.5"
                                        />
                                        <div className="flex-1 min-w-0">
                                          <div className="flex items-center justify-between">
                                            <span className="font-body text-xs text-text-primary font-medium">{rb.service?.name || 'Service'}</span>
                                            <span className="font-caption text-[10px] text-text-secondary">{rb.booking_number}</span>
                                          </div>
                                          <div className="font-caption text-[10px] text-text-secondary flex flex-wrap gap-x-2">
                                            {rb.start_time && <span>{formatClockRange(rb.start_time, rb.end_time, use24h)}</span>}
                                            {rb.therapist?.name && <span>· {rb.therapist.name}</span>}
                                            {rb.room?.name && <span>· {rb.room.name}</span>}
                                          </div>
                                        </div>
                                      </label>
                                      {rbChecked && renderOverrideInput(rb.id)}
                                      <div className="flex items-center justify-between pl-5">
                                        <span className="font-body font-body-normal text-xs text-text-secondary">Base</span>
                                        <span className="font-data text-sm text-text-primary">NPR {rbBase.toLocaleString('en-IN')}</span>
                                      </div>
                                      {(rbHasPreview || rbExistingDiscount > 0) && (
                                        <div className="flex items-center justify-between pl-5">
                                          <span className="font-body font-body-normal text-xs text-text-secondary">
                                            {rbHasPreview ? 'Discount Preview' : 'Discount'}
                                          </span>
                                          <span className={`font-data text-sm ${rbHasPreview ? 'text-warning' : 'text-error'}`}>
                                            - NPR {rbPreviewDiscount.toLocaleString('en-IN')} ({rbBase > 0 ? Math.round(rbPreviewDiscount / rbBase * 100) : 0}%)
                                          </span>
                                        </div>
                                      )}
                                      <div className="flex items-center justify-between pl-5">
                                        <span className="font-body font-body-normal text-xs text-text-secondary">Subtotal</span>
                                        <span className={`font-data text-sm ${rbHasPreview ? 'text-warning' : 'text-text-primary'}`}>
                                          NPR {rbPreviewFinal.toLocaleString('en-IN')}
                                        </span>
                                      </div>
                                    </div>
                                  );
                                })}
                              </>
                            )}

                            {/* Overall total — reuses resolveRowDiscount so this can never disagree
                                with each related row's own displayed Subtotal above. Skipped when
                                partial-payment already showed its own Final Amount (balance due) above. */}
                            {booking.paymentStatus !== 'partial' && (() => {
                              let total = primaryLive ? previewFinal : (booking.finalAmount || base);
                              let anyLive = primaryLive;
                              relatedBookings.forEach(rb => {
                                const rbChecked = selectedDiscountIds.has(rb.id);
                                const rbPlan = resolveRowDiscount(rb.id);
                                const rbLive = rbChecked && rbPlan.value > 0;
                                anyLive = anyLive || rbLive;
                                total += rbLive ? Math.max(rbPlan.base - rbPlan.amount, 0) : Number(rb.final_amount || rb.base_amount || 0);
                              });
                              return (
                                <div className="flex items-center justify-between border-t border-border pt-2 mt-1">
                                  <span className="font-body font-body-medium text-xs text-text-primary">
                                    {multiRow ? 'Overall Total' : 'Final Amount'}
                                  </span>
                                  <span className={`font-data font-data-medium text-sm ${anyLive ? 'text-warning' : 'text-primary'}`}>
                                    NPR {total.toLocaleString('en-IN')}
                                  </span>
                                </div>
                              );
                            })()}
                          </>
                        );
                      })()}
                      {booking.discountAmount > 0 && (
                        <button
                          onClick={async () => {
                            if (!onApplyDiscount) return;
                            setIsLoading(true);
                            setDiscountError(null);
                            const result = await onApplyDiscount(booking.bookingId, {
                              discountType: 'fixed',
                              discountValue: 0,
                              discountReason: 'Discount cancelled',
                            });
                            if (result?.error) {
                              setDiscountError(guideFor(result.error));
                            } else {
                              setDiscountSuccess('removed');
                            }
                            setIsLoading(false);
                          }}
                          disabled={isLoading}
                          className="w-full text-center py-2 text-xs font-body font-body-medium text-error border border-error/30 rounded-spa hover:bg-error/5 spa-transition-fast"
                        >
                          Cancel Discount
                        </button>
                      )}
                    </div>
                    </>)}

                    {/* Discount type */}
                    <Segmented options={[['percentage', '% Percent'], ['fixed', 'NPR Fixed']]} value={discountType} onChange={setDiscountType} />

                    {/* Discount value */}
                    <div className="space-y-1.5 sm:space-y-2">
                      {!perService && (<>
                      <label className="font-body font-body-medium text-xs sm:text-sm text-text-primary">
                        {discountType === 'percentage' ? 'Discount Percentage' : 'Discount Amount (NPR)'}
                        {relatedBookings.length > 0 && legacyGroups && (
                          <span className="font-body font-body-normal text-text-secondary"> (shared default — override any service above for its own rate)</span>
                        )}
                      </label>
                      <input
                        type="number"
                        min="0"
                        max={
                          !legacyGroups
                            ? (discountType === 'percentage' ? 100 : planMV.totalBase)
                            : discountType === 'percentage'
                              ? Math.min(100, Math.floor(((booking.baseAmount - (booking.amountPaid || 0)) / booking.baseAmount) * 100))
                              : Math.floor((booking.baseAmount || 0) - (booking.amountPaid || 0))
                        }
                        step={discountType === 'percentage' ? 1 : 10}
                        value={discountValue}
                        onWheel={(e) => e.target.blur()}
                        onChange={(e) => { setDiscountValue(e.target.value); setDiscountError(null); }}
                        placeholder={discountType === 'percentage' ? `Max ${discountLimitLabel}` : `Max NPR ${Math.floor((legacyGroups ? (booking.baseAmount || 0) : planMV.totalBase) * (userRole === 'admin' ? 1.00 : userRole === 'manager' ? 1.00 : 0.50))}`}
                        className={`w-full px-3 py-2.5 border rounded-spa bg-surface text-text-primary text-sm focus:ring-2 focus:ring-primary focus:border-primary spa-transition-fast ${
                          discountExceedsCap ? 'border-error' : 'border-border'
                        }`}
                      />
                      {discountType === 'percentage' && (
                        <div className="flex flex-wrap gap-1.5" data-quick-chips>
                          {[5, 10, 15, 20].map((n) => (
                            <button key={n} type="button" onClick={() => { setDiscountValue(String(n)); setDiscountError(null); }}
                              className={`h-7 px-2.5 rounded-full border text-[12.5px] font-medium ${String(discountValue) === String(n) ? 'border-primary bg-primary/5 text-primary' : 'border-border text-[#515152] hover:bg-[#FAFAF9]'}`}>{n}%</button>
                          ))}
                        </div>
                      )}
                      </>)}
                      {discountExceedsCap && (
                        <GuideCard card={guideFor({ code: 'DISCOUNT_LIMIT_EXCEEDED' }, { limitPercent: DISCOUNT_HARD_CAP })} onAction={onGuideAction} className="mt-1.5" />
                      )}
                      {discountExceedsCap && guideNote && <p className="mt-1.5 text-xs text-text-secondary" data-guide-note>{guideNote}</p>}
                      {discountExceedsLimit && (
                        <p className="text-xs text-amber-700 mt-1 flex items-center gap-1">
                          <Icon name="AlertTriangle" size={12} />
                          Exceeds your {discountMaxPercent}% limit — send a request to an approver below.
                        </p>
                      )}
                    </div>

                    {/* Reason / Remarks */}
                    <div className="space-y-1.5 sm:space-y-2">
                      <label className="font-body font-body-medium text-xs sm:text-sm text-text-primary">
                        {discountExceedsLimit ? 'Remarks' : 'Reason'} <span className="text-error">*</span>
                      </label>
                      <textarea
                        value={discountReason}
                        onChange={(e) => setDiscountReason(e.target.value)}
                        placeholder={discountExceedsLimit ? 'Add remarks for the approver…' : 'Why is this discount being applied?'}
                        rows={2}
                        className="w-full px-3 py-2.5 border border-border rounded-spa bg-surface text-text-primary text-sm focus:ring-2 focus:ring-primary focus:border-primary spa-transition-fast resize-none"
                      />
                    </div>

                    {/* Role limit */}
                    <p className="flex items-start gap-2 text-[12px] text-[#8A8A90]" data-limit-note>
                      <Icon name="Info" size={13} className="mt-0.5 flex-shrink-0" />
                      <span>You ({userRole}) can give up to {discountLimitLabel}.{discountMaxPercent < 100 && staffCanRequestDiscountApproval ? ' More than your limit goes to a manager for approval.' : ''}{memberCardOn ? ' This replaces the member discount.' : ''}</span>
                    </p>

                    {/* Request routing — only when discount exceeds the user's limit */}
                    {discountExceedsLimit && (
                      <div className="space-y-3 p-3 rounded-spa bg-amber-50 border border-amber-200">
                        <div className="flex items-center gap-2">
                          <Icon name="Send" size={14} className="text-amber-600" />
                          <span className="font-body font-body-medium text-xs sm:text-sm text-amber-800">
                            Send discount request for approval
                          </span>
                        </div>

                        {/* Request summary */}
                        <div className="space-y-1 text-xs">
                          <div className="flex items-center justify-between">
                            <span className="text-text-secondary">Client</span>
                            <span className="font-body-medium text-text-primary">{booking.customerName || '—'}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-text-secondary">Package</span>
                            <span className="font-body-medium text-text-primary text-right">{legacyGroups ? (booking.service || '—') : `${block.count} service${block.count === 1 ? '' : 's'}`}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-text-secondary">Discount</span>
                            <span className="font-data text-error">
                              {Math.round(discountEffPercent)}% · NPR {previewDiscountAmount.toLocaleString('en-IN')}
                            </span>
                          </div>
                        </div>

                        {/* Approver picker */}
                        <div className="space-y-1.5">
                          <label className="font-body font-body-medium text-xs text-text-primary">
                            Send request to <span className="text-error">*</span>
                          </label>
                          {approvers.length === 0 ? (
                            <p className="text-xs text-text-tertiary">No managers or admins available to approve.</p>
                          ) : (
                            <CustomSelect
                              value={selectedApprover}
                              onChange={(val) => { setSelectedApprover(val); setDiscountError(null); }}
                              options={approvers.map(a => ({
                                value: a.id,
                                label: `${a.fullName} (${a.role === 'admin' ? 'Admin' : `${wordBranchCap()} Manager`})`,
                              }))}
                              placeholder="Select an approver…"
                              size="md"
                            />
                          )}
                        </div>
                      </div>
                    )}

                    {/* Error / Success */}
                    {discountError && (
                      <><InlineError error={discountError} onAction={onGuideAction} area="booking-panel" />{discountError && guideNote ? <p data-guide-note className="mt-1.5 text-xs text-text-secondary">{guideNote}</p> : null}</>
                    )}
                    {discountSuccess === 'approved' && (
                      <div className="flex items-center space-x-2 px-3 py-2.5 rounded-spa bg-success/10 border border-success/20">
                        <Icon name="CheckCircle" size={14} className="text-success flex-shrink-0" />
                        <span className="font-body font-body-normal text-xs text-success">Discount applied successfully.</span>
                      </div>
                    )}
                    {discountSuccess === 'removed' && (
                      <div className="flex items-center space-x-2 px-3 py-2.5 rounded-spa bg-success/10 border border-success/20">
                        <Icon name="CheckCircle" size={14} className="text-success flex-shrink-0" />
                        <span className="font-body font-body-normal text-xs text-success">Discount removed successfully.</span>
                      </div>
                    )}
                    {discountSuccess === 'pending' && (
                      <div className="flex items-center space-x-2 px-3 py-2.5 rounded-spa bg-amber-50 border border-amber-200">
                        <Icon name="Clock" size={14} className="text-amber-600 flex-shrink-0" />
                        <span className="font-body font-body-normal text-xs text-amber-700">Discount request sent for approval.</span>
                      </div>
                    )}

                    <Button
                      variant="primary"
                      onClick={handleApplyDiscount}
                      loading={isLoading}
                      disabled={
                        checkedRowIds.length === 0 ||
                        checkedRowIds.some(id => !(resolveRowDiscount(id).value > 0)) ||
                        !discountReason.trim() ||
                        discountExceedsCap ||
                        (discountExceedsLimit && !selectedApprover)
                      }
                      iconName={discountExceedsLimit ? 'Send' : 'Percent'}
                      iconPosition="left"
                      className="w-full sm:w-auto min-h-[44px]"
                    >
                      {discountExceedsLimit
                        ? 'Send Discount Request'
                        : (legacyGroups ? (checkedRowIds.length > 1 ? `Apply Discount to ${checkedRowIds.length} Services` : 'Apply Discount') : 'Apply discount')}
                    </Button>
                    </>)}
                  </>
                )}
              </div>
            )}

            {/* Payment Tab */}
            {activeTab === 'payment' && (() => {
              const selectedPreviousDue = previousDueBookings.filter(pb => selectedPreviousDueIds.has(pb.bookingId));
              const previousDueTotal = selectedPreviousDue.reduce((sum, pb) => sum + Number(pb.amountDue || 0), 0);
              // Related same-session services are still discounted together via the
              // Discount tab, but paying for them is a separate decision — a customer
              // may want to settle just one service now and the other later. Selection
              // defaults to "all" (matching the old always-bundled behavior) but staff
              // can uncheck individual ones, same pattern as previous-due below.
              const relatedRemaining = (rb) => Math.max(Number(rb.base_amount || 0) - Number(rb.discount_amount || 0), 0);
              const selectedRelated = relatedBookings.filter(rb => selectedRelatedIds.has(rb.id));
              const relatedBookingsTotal = selectedRelated.reduce((sum, rb) => sum + relatedRemaining(rb), 0);
              const combinedTotal = (booking.finalAmount || 0) + relatedBookingsTotal + previousDueTotal;
              const paidThisVisit = (booking.payments || [])
                .filter(p => canonicalMode(p.paymentMode) === 'Membership')
                .reduce((s, p) => s + p.amount, 0);
              // relatedBookings is always same-day as the booking being viewed — label it
              // "Today's" only when that day actually IS today, so a staffer looking at a
              // past booking (via search, not the live Calendar) doesn't see a misleading
              // "Today" label on services that happened days ago.

              return (
              <div className="space-y-4 sm:space-y-6">
                <h3 className="font-heading font-heading-medium text-sm sm:text-base text-text-primary">
                  Payment Status
                </h3>

                <MembershipWalletCard membership={membership} paidThisVisit={paidThisVisit} />

                {/* ZNLY-402 piece 4: ONE invoice view for the whole booking (2+ services, setting ON): lines, discount, total, paid so far, to pay.
                    The numbers are the block's, so they equal the rows above. Methods and the one button stay below, as today. */}
                {!showAdminCorrection && (
                  <div className="bg-background rounded-spa p-3 sm:p-4 space-y-2" data-booking-invoice>
                    {block.rows.map((r) => (
                      <div key={r.id}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className={`text-[13px] ${r.dead ? 'line-through text-text-tertiary' : 'text-text-primary'}`}>{r.name}</p>
                            {(r.dead || (r.paid >= r.final && r.final > 0)) && <p className="text-[11px] text-text-secondary">{r.dead ? 'Cancelled' : 'Paid'}</p>}
                          </div>
                          <span className={`font-data text-sm tabular-nums flex-shrink-0 ${r.dead ? 'line-through text-text-tertiary' : 'text-text-primary'}`}>NPR {r.base.toLocaleString('en-IN')}</span>
                        </div>
                        {!r.dead && r.discount > 0 && (
                          <div className="flex items-center justify-between pl-3 mt-0.5">
                            <span className="text-[12px] text-text-secondary">Discount</span>
                            <span className="font-data text-[12px] text-error tabular-nums">- NPR {r.discount.toLocaleString('en-IN')}</span>
                          </div>
                        )}
                      </div>
                    ))}
                    <div className="flex items-center justify-between border-t border-border pt-2">
                      <span className="text-xs font-medium text-text-primary">Total</span>
                      <span className="font-data text-sm font-medium text-text-primary tabular-nums" data-invoice-total>NPR {block.total.toLocaleString('en-IN')}</span>
                    </div>
                    {block.paid > 0 && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-text-secondary">Paid so far</span>
                        <span className="font-data text-sm text-text-primary tabular-nums">- NPR {block.paid.toLocaleString('en-IN')}</span>
                      </div>
                    )}
                    {block.waiting > 0 && <p className="text-[12px] text-warning" data-invoice-waiting>{waitingNote(block.waiting)}</p>}
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-text-primary">To pay</span>
                      <span className="flex items-center gap-2">
                        <span className={`font-data text-sm font-medium tabular-nums ${block.toPay > 0 ? 'text-warning' : 'text-text-primary'}`} data-invoice-topay>NPR {block.toPay.toLocaleString('en-IN')}</span>
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${blockPaid.cls}`}>{blockPaid.label}</span>
                      </span>
                    </div>
                  </div>
                )}

                {/* Current booking */}
                {showAdminCorrection && (
                <div className="bg-background rounded-spa p-3 sm:p-4 space-y-2">
                  {(previousDueBookings.length > 0 || relatedBookings.length > 0) && (
                    <div className="flex items-center gap-2 mb-1">
                      <Icon name="CheckSquare" size={14} className="text-primary" />
                      <span className="font-body font-body-medium text-xs text-text-primary">{booking.service}</span>
                    </div>
                  )}
                  {(() => {
                    // While in admin correction, this card reflects the live correctionFields
                    // (which the Discount tab's Apply button writes into) instead of the
                    // original booking row — otherwise this stays stuck showing pre-correction
                    // numbers while the admin is trying to work out the new payment amount.
                    const payBase = showAdminCorrection ? (Number(correctionFields?.base_amount) || 0) : (booking.baseAmount || 0);
                    const payDiscount = showAdminCorrection ? (Number(correctionFields?.discount_amount) || 0) : (booking.discountAmount || 0);
                    const payFinal = showAdminCorrection ? Math.max(payBase - payDiscount, 0) : (booking.finalAmount || 0);
                    const discountChanged = showAdminCorrection && Object.prototype.hasOwnProperty.call(correctionChangedFields, 'discount_amount');
                    return (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="font-body font-body-normal text-xs text-text-secondary">Base Amount</span>
                          <span className="font-data text-sm text-text-primary">NPR {payBase.toLocaleString('en-IN') || '—'}</span>
                        </div>
                        {payDiscount > 0 && (
                          <div className="flex items-center justify-between">
                            <span className="font-body font-body-normal text-xs text-text-secondary flex items-center gap-1.5">
                              Discount
                              {discountChanged && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-warning/10 text-warning text-[10px] font-body-medium">changed</span>
                              )}
                            </span>
                            <span className="font-data text-sm text-error">- NPR {payDiscount.toLocaleString('en-IN')} ({payBase > 0 ? Math.round((payDiscount / payBase) * 100) : 0}%)</span>
                          </div>
                        )}
                        <div className="flex items-center justify-between border-t border-border pt-2">
                          <span className="font-body font-body-medium text-xs text-text-primary">{(previousDueBookings.length > 0 || relatedBookings.length > 0) ? 'Subtotal' : 'Final Amount'}</span>
                          <span className="font-data font-data-medium text-sm text-text-primary">NPR {payFinal.toLocaleString('en-IN') || '—'}</span>
                        </div>
                      </>
                    );
                  })()}
                  {booking.paymentStatus === 'partial' && (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="font-body font-body-normal text-xs text-text-secondary">Already Paid</span>
                        <span className="font-data text-sm text-text-primary tabular-nums">- NPR {Number(booking.amountPaid || 0).toLocaleString('en-IN')}</span>
                      </div>
                      {(booking.payments || []).map((p) => (
                        p.id ? (
                          showAdminCorrection ? (
                            <div key={p.id} className="flex items-center justify-between pl-2 py-1 gap-2">
                              <div className="w-28 flex-shrink-0">
                                <PaymentMethodSelector
                                  value={correctionPaymentModes[p.id] ?? p.paymentMode}
                                  onChange={(v) => setCorrectionPaymentMode(p.id, v)}
                                  paymentMethods={paymentMethods}
                                  size="sm"
                                />
                              </div>
                              <input
                                type="number"
                                step="any"
                                min="0"
                                value={correctionPaymentAmounts[p.id] ?? ''}
                                onChange={(e) => setCorrectionPaymentAmount(p.id, e.target.value)}
                                className="w-24 h-9 px-2 text-[11px] border border-border rounded-spa bg-surface text-text-primary"
                              />
                              {Object.prototype.hasOwnProperty.call(correctionPaymentChanged, p.id) && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-warning/10 text-warning text-[10px] font-body-medium flex-shrink-0">changed</span>
                              )}
                            </div>
                          ) : (
                            <div key={p.id} className="flex items-center justify-between pl-2 text-[11px] gap-2">
                              <span className="text-text-tertiary">{humanizePaymentMethod(p.paymentMode)}</span>
                              <div className="flex items-center space-x-1.5">
                                <span className="font-data text-text-tertiary">NPR {Number(p.amount).toLocaleString('en-IN')}</span>
                                {userRole === 'admin' && (
                                  <button
                                    type="button"
                                    onClick={() => setCorrectingPayment(p)}
                                    title="Correct payment"
                                    className="p-0.5 rounded hover:bg-background text-text-tertiary hover:text-primary"
                                  >
                                    <Icon name="Pencil" size={11} />
                                  </button>
                                )}
                              </div>
                            </div>
                          )
                        ) : (
                          <div key={`${humanizePaymentMethod(p.paymentMode)}-${p.amount}`} className="flex items-center justify-between pl-2 text-[11px]">
                            <span className="text-text-tertiary">{humanizePaymentMethod(p.paymentMode)}</span>
                            <span className="font-data text-text-tertiary">NPR {Number(p.amount).toLocaleString('en-IN')}</span>
                          </div>
                        )
                      ))}
                      {(booking.tips || []).map((t) => (
                        <div key={t.id || `tip-${t.amount}`} className="flex items-center justify-between pl-2 text-[11px]">
                          <span className="text-text-tertiary italic">Tip{t.receivedByName ? ` → ${t.receivedByName}` : ''} (not revenue)</span>
                          <span className="font-data text-text-tertiary">NPR {t.amount.toLocaleString('en-IN')}</span>
                        </div>
                      ))}
                      {(booking.refunds || []).map((r) => (
                        <div key={r.id || `refund-${r.amount}`} className="flex items-center justify-between pl-2 text-[11px]" title={r.reason || ''}>
                          <span className="text-error">Refunded</span>
                          <span className="font-data text-error">- NPR {r.amount.toLocaleString('en-IN')}</span>
                        </div>
                      ))}
                      <div className="flex items-center justify-between border-t border-border pt-2">
                        <span className="font-body font-body-medium text-xs text-text-primary">Balance Due</span>
                        <span className="font-data font-data-medium text-sm text-warning">NPR {Number(booking.amountDue || 0).toLocaleString('en-IN')}</span>
                      </div>
                    </>
                  )}
                </div>
                )}



                {/* Pending bookings aren't payable yet — guide staff to confirm/complete first */}
                {!canPay && booking.status === 'pending' && booking.paymentStatus !== 'paid' && !isLocked && (
                  <div className="flex items-start space-x-2 px-3 py-2.5 rounded-spa bg-warning/5 border border-warning/20">
                    <Icon name="Info" size={14} className="text-warning flex-shrink-0 mt-0.5" />
                    <span className="font-body font-body-normal text-xs sm:text-sm text-warning">
                      Confirm or complete this booking before recording payment.
                    </span>
                  </div>
                )}

                {/* Previous due — this customer's outstanding balance from earlier visits,
                    bundled in by default so it's collected together with this booking */}
                {previousDueBookings.length > 0 && canPay && (
                  <div className="space-y-2">
                    <label className="font-body font-body-medium text-xs text-warning uppercase flex items-center gap-1.5">
                      <Icon name="AlertCircle" size={13} />
                      Other unpaid bookings for {booking.customerName}
                    </label>
                    <div className="border border-warning/20 rounded-spa divide-y divide-border overflow-hidden">
                      {previousDueBookings.map(pb => {
                        const isChecked = selectedPreviousDueIds.has(pb.bookingId);
                        return (
                          <label key={pb.bookingId} className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-background/50 ${isChecked ? 'bg-warning/5' : ''}`}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                setSelectedPreviousDueIds(prev => {
                                  const next = new Set(prev);
                                  if (e.target.checked) next.add(pb.bookingId);
                                  else next.delete(pb.bookingId);
                                  return next;
                                });
                              }}
                              className="text-primary focus:ring-primary w-4 h-4 rounded"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="font-body text-sm text-text-primary">{pb.serviceName}</div>
                              <div className="font-caption text-xs text-text-secondary">
                                #{pb.bookingNumber} · {isPanel && pb.date && !Number.isNaN(new Date(`${pb.date}T00:00:00`).getTime()) ? new Date(`${pb.date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : pb.date}
                              </div>
                            </div>
                            <span className="font-data text-sm text-warning flex-shrink-0">NPR {Number(pb.amountDue).toLocaleString('en-IN')}</span>
                            {onViewBooking && (
                              <button
                                type="button"
                                title="View this booking"
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onViewBooking(pb.bookingId); }}
                                className="flex-shrink-0 p-1 rounded hover:bg-background text-text-secondary hover:text-warning"
                              >
                                <Icon name="ChevronRight" size={16} />
                              </button>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Grand total */}
                {(legacyGroups ? (selectedRelatedIds.size + selectedPreviousDueIds.size) > 0 : selectedPreviousDueIds.size > 0) && (
                  <div className="bg-primary/5 border border-primary/20 rounded-spa p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-body font-body-medium text-sm text-text-primary">
                        {legacyGroups ? `Grand Total (${1 + selectedRelatedIds.size + selectedPreviousDueIds.size} services)` : 'Total with the other unpaid bookings'}
                      </span>
                      <span className="font-data font-data-medium text-base text-primary">
                        NPR {combinedTotal.toLocaleString('en-IN')}
                      </span>
                    </div>
                  </div>
                )}

                {actionError && (
                  <><InlineError error={actionError} onAction={onGuideAction} area="booking-panel" />{actionError && guideNote ? <p data-guide-note className="mt-1.5 text-xs text-text-secondary">{guideNote}</p> : null}</>
                )}

                {visitProducts.length > 0 && (
                  <div className="rounded-spa border border-border" data-visit-products>
                    <div className="px-3 pt-2.5 pb-1 text-[11px] font-medium uppercase tracking-[.04em] text-text-secondary">Products on this visit</div>
                    <ul className="divide-y divide-border">
                      {visitProducts.map((vp) => (
                        <li key={vp.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                          <div className="min-w-0 flex-1">
                            <p className={`truncate ${vp.refundedAt ? 'line-through text-text-secondary' : 'text-text-primary'}`}>{vp.name} × {vp.quantity}</p>
                            <p className="text-text-secondary truncate">{[vp.soldBy ? `Sold by ${vp.soldBy}` : 'No commission', vp.payments.map((p) => p.paymentMode).join(' + ') || vp.paymentMode, vp.refundedAt ? 'refunded' : null].filter(Boolean).join(' · ')}</p>
                          </div>
                          <span className="font-data text-text-primary">NPR {Number(vp.total).toLocaleString('en-IN')}</span>
                          {['manager', 'admin'].includes(userRole) && !vp.refundedAt && (
                            <button type="button" onClick={() => setVisitProductRefund(vp)} className="text-[12px] font-medium text-primary hover:underline" data-visit-product-refund>Refund</button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {canViewCustomerDetails && booking.paymentStatus !== 'paid' && (['partial', 'refunded'].includes(booking.paymentStatus) || String(booking.status).toLowerCase() === 'completed') && (
                  <div className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-spa border border-border" data-bill-row>
                    <span className="text-xs sm:text-sm font-body-medium text-text-primary">Bill</span>
                    <BillActions bookingId={booking.bookingId} up />
                  </div>
                )}

                {canPay && (
                  <Button
                    variant="primary"
                    onClick={() => setShowPaymentModal(true)}
                    iconName="CreditCard"
                    iconPosition="left"
                    className={`w-full min-h-[44px] `}
                  >
                    Collect payment
                  </Button>
                )}
                {booking.paymentStatus === 'paid' && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-spa bg-success/10 border border-success/20">
                      <div className="flex items-center space-x-2">
                        <Icon name="CheckCircle" size={14} className="text-success flex-shrink-0" />
                        <span className="font-body font-body-normal text-xs sm:text-sm text-success">Payment has been recorded.</span>
                      </div>
                      {canViewCustomerDetails && <BillActions bookingId={booking.bookingId} up />}
                    </div>
                    {(booking.payments || []).map((p) => (
                      p.id && showAdminCorrection ? (
                        <div key={p.id} className="flex items-center justify-between px-3 py-1.5 gap-2">
                          <div className="w-28 flex-shrink-0">
                            <PaymentMethodSelector
                              value={correctionPaymentModes[p.id] ?? p.paymentMode}
                              onChange={(v) => setCorrectionPaymentMode(p.id, v)}
                              paymentMethods={paymentMethods}
                              size="sm"
                            />
                          </div>
                          <input
                            type="number"
                            step="any"
                            min="0"
                            value={correctionPaymentAmounts[p.id] ?? ''}
                            onChange={(e) => setCorrectionPaymentAmount(p.id, e.target.value)}
                            className="w-24 h-9 px-2 text-xs border border-border rounded-spa bg-surface text-text-primary"
                          />
                          {Object.prototype.hasOwnProperty.call(correctionPaymentChanged, p.id) && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-warning/10 text-warning text-[10px] font-body-medium flex-shrink-0">changed</span>
                          )}
                        </div>
                      ) : (
                        <div key={p.id || `${humanizePaymentMethod(p.paymentMode)}-${p.amount}`} className="flex items-center justify-between px-3 py-1.5 text-xs gap-2">
                          <span className="text-text-secondary">{humanizePaymentMethod(p.paymentMode)}</span>
                            <div className="flex items-center space-x-2">
                              <span className="font-data text-text-primary">NPR {Number(p.amount).toLocaleString('en-IN')}</span>
                              {userRole === 'admin' && p.id && (
                                <button
                                  type="button"
                                  onClick={() => setCorrectingPayment(p)}
                                  title="Correct payment"
                                  className="p-1 rounded hover:bg-background text-text-secondary hover:text-primary"
                                >
                                  <Icon name="Pencil" size={12} />
                                </button>
                              )}
                            </div>
                        </div>
                      )
                    ))}
                    {(booking.tips || []).map((t) => (
                      <div key={t.id || `tip-${t.amount}`} className="flex items-center justify-between px-3 py-1.5 text-xs">
                        <span className="text-text-secondary italic">Tip{t.receivedByName ? ` → ${t.receivedByName}` : ''} (not revenue)</span>
                        <span className="font-data text-text-secondary">NPR {t.amount.toLocaleString('en-IN')}</span>
                      </div>
                    ))}
                    {(booking.refunds || []).map((r) => (
                      <div key={r.id || `refund-${r.amount}`} className="flex items-center justify-between px-3 py-1.5 text-xs" title={r.reason || ''}>
                        <span className="text-error">Refunded</span>
                        <span className="font-data text-error">- NPR {r.amount.toLocaleString('en-IN')}</span>
                      </div>
                    ))}
                    {booking.refundTotal > 0 && (
                      <div className="flex items-center justify-between px-3 py-1.5 text-xs border-t border-border pt-2">
                        <span className="font-body font-body-medium text-text-primary">Net Received</span>
                        <span className="font-data font-data-medium text-text-primary">
                          NPR {Math.max(0, (booking.amountPaid || 0) - booking.refundTotal).toLocaleString('en-IN')}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
              );
            })()}

            {/* Extend Service — longer-duration variant panel */}
            {showExtendPanel && (
              <div ref={extendPanelRef} className="space-y-4 scroll-mt-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon name="Clock" size={18} className="text-primary" />
                    <h3 className="font-heading font-heading-medium text-sm sm:text-base text-text-primary">
                      Extend Service
                    </h3>
                  </div>
                  <button
                    onClick={() => setShowExtendPanel(false)}
                    className="p-1.5 rounded-spa hover:bg-background spa-transition-fast text-text-secondary hover:text-text-primary"
                  >
                    <Icon name="X" size={16} />
                  </button>
                </div>

                <><InlineError error={extendError} onAction={onGuideAction} area="booking-panel" />{extendError && guideNote ? <p data-guide-note className="mt-1.5 text-xs text-text-secondary">{guideNote}</p> : null}</>

                <div className="space-y-2">
                  {extendOptions.map(option => (
                    <button
                      key={option.id}
                      onClick={() => handleExtendService(option)}
                      disabled={extendSubmitting}
                      className="w-full flex items-center justify-between px-3 py-2.5 rounded-spa border border-border hover:border-primary/50 hover:bg-primary/5 spa-transition-fast text-left disabled:opacity-50"
                    >
                      <span className="font-body font-body-medium text-sm text-text-primary">
                        {option.name} — {option.duration_minutes}min
                      </span>
                      <span className="font-data text-sm text-primary">NPR {option.price_npr}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

          </div>

    </>
  );

  const overlays = (
    <>
      {/* Refund one product sale added to this visit (manager / admin): the units go back on the shelf */}
      {visitProductRefund && (
        <ConfirmDialog
          title="Refund this product?"
          message={`${visitProductRefund.name} × ${visitProductRefund.quantity} (NPR ${Number(visitProductRefund.total).toLocaleString('en-IN')}) will be refunded and the stock put back.${hasExistingInvoice ? ' An invoice was issued for this booking: it stays as it is, and no credit note is made.' : ''}`}
          confirmLabel="Refund"
          reasonOptional
          reasonLabel="Note"
          reasonPlaceholder="Optional"
          isSubmitting={isLoading}
          onClose={() => setVisitProductRefund(null)}
          onConfirm={async (note) => {
            setIsLoading(true);
            const { error } = await refundProductSale({ saleId: visitProductRefund.id, reason: (note || '').trim() || null });
            setIsLoading(false);
            setVisitProductRefund(null);
            if (error) { setActionError(guideFor(error)); return; }
            loadVisitProducts();
          }}
        />
      )}
      {/* Cancel / No Show confirmation */}
      {visitStatusFlow && (
        <VisitStatusFlow
          visitKey={booking.visitId}
          kind={pendingStatus}
          lines={Object.fromEntries(block.rows.map((r) => [r.id, { name: r.name, price: r.final, start: r.start, staff: r.staff.join(', ') }]))}
          reasonOptions={cancelReasonOptions}
          onClose={() => setPendingStatus(null)}
          onDone={async () => { setPendingStatus(null); setBlockReload((n) => n + 1); await onRefreshBooking?.(booking.bookingId); }}
        />
      )}
      {removeRow && (
        <RemoveServiceFlow
          row={removeRow}
          newTotal={Math.max(block.total - removeRow.final, 0)}
          canViewPrices={canViewPrices}
          reasonOptions={cancelReasonOptions}
          onClose={() => setRemoveRow(null)}
          onCancelWhole={() => setPendingStatus('cancelled')}
          onDone={async () => { setRemoveRow(null); setBlockReload((n) => n + 1); await onRefreshBooking?.(booking.bookingId); }}
        />
      )}
      {!visitStatusFlow && pendingStatus === 'no show' && (
        <ConfirmDialog
          title="Mark as no-show"
          message={`Mark ${booking.customerName} as a no-show?`}
          confirmLabel="Mark no-show"
          reasonOptional
          reasonLabel="Note"
          reasonPlaceholder="e.g. Didn't arrive and didn't call"
          isSubmitting={isLoading}
          onClose={() => setPendingStatus(null)}
          // The stored reason is the note, or "No show" when it is left empty.
          onConfirm={(note) => handleStatusUpdate('no show', (note || '').trim() || 'No show')}
        />
      )}
      {!visitStatusFlow && pendingStatus && pendingStatus !== 'no show' && (
        <ConfirmDialog
          title="Cancel Booking"
          message={`This will cancel the booking. This cannot be undone.${hasExistingInvoice ? ' An invoice was issued for this booking: it stays as it is, and no credit note is made.' : ''}`}
          confirmLabel="Cancel Booking"
          reasonOptions={cancelReasonOptions}
          isSubmitting={isLoading}
          onClose={() => setPendingStatus(null)}
          onConfirm={(reason) => handleStatusUpdate(pendingStatus, reason)}
        />
      )}

      {/* Admin correction — discard/save confirmation. Edits happen inline in the
          content area above (no separate popup); this is just the "are you sure"
          step before either throwing changes away or committing them. On a
          successful save/delete the booking row has changed underneath us (or is
          gone entirely), so the modal closes outright and the parent re-fetches
          rather than rendering stale data — see runCorrectionSubmit. */}
      {showAdminCorrection && correctionConfirming && (
        <div className="fixed inset-0 z-notification flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/50" onClick={correctionSubmitting ? undefined : () => setCorrectionConfirming(null)} aria-hidden="true" />
          <div className="relative bg-surface rounded-spa-lg border border-border shadow-spa-modal w-full max-w-sm p-5 space-y-4">
            <div className="flex items-start space-x-3">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${correctionConfirming === 'discard' ? 'bg-error/10' : 'bg-warning/10'}`}>
                <Icon name={correctionConfirming === 'discard' ? 'AlertTriangle' : 'ShieldAlert'} size={18} className={correctionConfirming === 'discard' ? 'text-error' : 'text-warning'} />
              </div>
              <div>
                <h3 className="font-heading font-heading-semibold text-sm text-text-primary">
                  {correctionConfirming === 'discard' ? 'Discard changes?' : correctionMode === 'delete' ? 'Delete this booking?' : 'Save these corrections?'}
                </h3>
                <p className="font-body text-xs text-text-secondary mt-1">
                  {correctionConfirming === 'discard'
                    ? 'Nothing will be saved and this booking stays exactly as it is now.'
                    : correctionMode === 'delete'
                      ? 'This permanently removes the booking. This cannot be undone.'
                      : [
                          correctionChangedCount > 0 ? `${correctionChangedCount} field${correctionChangedCount === 1 ? '' : 's'}` : null,
                          correctionPaymentChangedCount > 0 ? `${correctionPaymentChangedCount} payment${correctionPaymentChangedCount === 1 ? '' : 's'}` : null,
                        ].filter(Boolean).join(' and ') + ' will be updated and recorded in the audit log.'}
                </p>
              </div>
            </div>

            {correctionConfirming === 'save' && (
              <div>
                <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">
                  Reason <span className="text-error">*</span>
                </label>
                <textarea
                  value={correctionReason}
                  onChange={(e) => setCorrectionReason(e.target.value)}
                  rows={2}
                  placeholder="Required. Explain what was wrong and why this change is correct."
                  className={`${inputClasses} resize-none`}
                  autoFocus
                />
                {!correctionReasonOk && correctionReason.length > 0 && (
                  <p className="mt-1 font-caption text-[11px] text-text-tertiary">
                    {CORRECTION_REASON_MIN - correctionReason.trim().length} more character{CORRECTION_REASON_MIN - correctionReason.trim().length === 1 ? '' : 's'} needed.
                  </p>
                )}
              </div>
            )}

            {correctionError && (
              <div className="bg-error/5 border border-error/20 rounded-spa px-3 py-2 flex items-start space-x-2">
                <Icon name="AlertCircle" size={14} className="text-error flex-shrink-0 mt-0.5" />
                <p className="font-body text-xs text-error">{correctionError}</p>
              </div>
            )}

            <div className="flex items-center justify-end space-x-2">
              <button
                type="button"
                onClick={() => setCorrectionConfirming(null)}
                disabled={correctionSubmitting}
                className="px-3 py-2 rounded-spa border border-border text-sm font-body font-body-medium text-text-secondary hover:bg-background spa-transition-fast disabled:opacity-40"
              >
                Back
              </button>
              <button
                type="button"
                onClick={correctionConfirming === 'discard' ? () => { setCorrectionConfirming(null); setShowAdminCorrection(false); } : runCorrectionSubmit}
                disabled={correctionSubmitting || (correctionConfirming === 'save' && !correctionReasonOk)}
                className={`px-3 py-2 rounded-spa text-white text-sm font-body font-body-medium disabled:opacity-50 spa-transition-fast inline-flex items-center space-x-1.5 ${
                  correctionConfirming === 'discard' || correctionMode === 'delete' ? 'bg-error hover:bg-error/90' : 'bg-warning hover:bg-warning/90'
                }`}
              >
                {correctionSubmitting && <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                <span>{correctionConfirming === 'discard' ? 'Discard' : correctionMode === 'delete' ? 'Delete booking' : 'Save changes'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payment mode correction — admin-only, from the pencil icon next to a
          recorded payment on the Payment tab. Same "close and let the parent
          re-fetch" posture as runCorrectionSubmit above, since this component
          doesn't own the booking data it's rendering. */}
      {correctingPayment && (
        <PaymentModeCorrectionModal
          payment={correctingPayment}
          paymentMethods={paymentMethods}
          onClose={() => setCorrectingPayment(null)}
          onSuccess={() => {
            setCorrectingPayment(null);
            if (onClose) onClose();
          }}
        />
      )}

      {/* Payment mode correction — admin-only, from the pencil icon next to a
          recorded payment on the Payment tab. Same "close and let the parent
          re-fetch" posture as the inline admin correction, since this component
          doesn't own the booking data it's rendering. */}
      {correctingPayment && (
        <PaymentModeCorrectionModal
          payment={correctingPayment}
          paymentMethods={paymentMethods}
          onClose={() => setCorrectingPayment(null)}
          onSuccess={() => {
            setCorrectingPayment(null);
            setCorrectionNote('Payment corrected. It is on the booking history.');
            setHistoryReload((n) => n + 1);
            setTimeout(() => setCorrectionNote(null), 4000);
            if (isPanel) onRefreshBooking?.(booking.bookingId);
            else if (onClose) onClose();
          }}
        />
      )}

      {/* Payment Modal */}
      {showPaymentModal && (
        <PaymentModal
          key={payMainId}
          showBill={canViewCustomerDetails}
          savesProducts
          visitList={!legacyGroups}
          visitOrder={payOrder}
          headerNumber={block.reference}
          mainTicked={!payNoneTicked}
          onVisitToggle={togglePayTick}
          waitingRows={block.rows.filter((r) => !r.dead && r.status === 'pending' && !payOrder.includes(r.id)).map((r) => ({ bookingId: r.id, name: r.name, minutes: r.minutes, staff: r.staff.join(', '), price: r.final }))}
          booking={payMainView}
          addOnCandidates={[
            ...payOrder.filter((id) => id !== payMainId).map((id) => payRowView(id)),
            ...(legacyGroups ? relatedBookings.map((rb) => payRowView(rb.id)) : []),
            ...previousDueBookings,
          ]}
          additionalBookings={[
            ...payOrder.filter((id) => id !== payMainId && payTicked.has(id)).map((id) => payRowView(id)),
            ...(legacyGroups ? relatedBookings.filter((rb) => selectedRelatedIds.has(rb.id)).map((rb) => payRowView(rb.id)) : []),
            ...previousDueBookings.filter(pb => selectedPreviousDueIds.has(pb.bookingId)),
          ]}
          dueHolderSuggestions={dueHolderSuggestions}
          onAddClient={walkInNoClient && canAddClient ? () => { setShowPaymentModal(false); setAddClientSignal((n) => n + 1); } : undefined}
          onConfirm={handlePaymentConfirm}
          onClose={(res) => {
            setShowPaymentModal(false);
            if (res?.paid || res?.alreadyPaid) setSelectedPreviousDueIds(new Set());
            // Someone else collected: refresh only. onGroupPaymentRecorded toasts "Payment recorded", which this tab did not do.
            if (res?.alreadyPaid) onRefreshBooking?.(booking.bookingId);
          }}
          isSubmitting={paymentSubmitting}
        />
      )}
    </>
  );

  if (editSlot) {
    return (
      <CreateBookingHost
        slot={editSlot}
        branchId={booking.branchId || branchId}
        onClose={() => setEditSlot(null)}
        onBack={() => setEditSlot(null)}
        onCreated={async () => { setEditSlot(null); setBlockReload((n) => n + 1); await onRefreshBooking?.(booking.bookingId); }}
      />
    );
  }

  if (isPanel) {
    if (useSheet) {
      return (
        <>
          <DetentSheet
            isOpen={isOpen}
            detent={detent}
            onDetentChange={changeDetent}
            onClose={requestPanelClose}
            scrim={!liveBackdrop}
            titleId="booking-panel-title"
            header={panelHeader}
            footer={panelFooter}
          >
            {panelTabsNode}
            {contentNode}
          </DetentSheet>
          {createPortal(overlays, document.body)}
        </>
      );
    }
    return (
      <>
        <SidePanel isOpen={isOpen} width={PANEL_WIDTH_BOOKING} header={panelHeader} titleId="booking-panel-title" onClose={requestPanelClose} footer={panelFooter}>
          {panelTabsNode}
          {contentNode}
        </SidePanel>
        {createPortal(overlays, document.body)}
      </>
    );
  }

  // Use Portal to render modal at document body level, escaping any stacking context
  return createPortal(
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-text-primary/50 backdrop-blur-sm z-modal flex items-end sm:items-center justify-center sm:p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-modal-title"
      >
        {/* Modal Container - Bottom sheet on mobile (85vh to clear iOS notch), centered card on desktop */}
        <div className="bg-surface w-full sm:max-w-2xl h-[85vh] sm:h-auto sm:max-h-[90vh] rounded-t-2xl sm:rounded-spa-lg spa-shadow-modal overflow-hidden animate-fade-in flex flex-col">
          {/* Header - Responsive padding */}
          <div className="flex items-center justify-between p-4 sm:p-6 border-b border-border flex-shrink-0">
            <div className="flex items-center space-x-3 min-w-0">
              <div className="w-9 h-9 sm:w-10 sm:h-10 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
                <Icon name="Calendar" size={18} className="text-primary sm:w-5 sm:h-5" />
              </div>
              <div className="min-w-0">
                <h2 id="booking-modal-title" className="font-heading font-heading-semibold text-base sm:text-lg text-text-primary truncate">
                  Booking Management
                </h2>
                <p className="font-caption font-caption-normal text-xs sm:text-sm text-text-secondary truncate flex items-center gap-1.5">
                  <span className="truncate">{booking.id} — {booking.customerName}</span>
                  {isFirstBooking && (
                    <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-caption font-caption-medium bg-success/10 text-success flex-shrink-0">
                      New
                    </span>
                  )}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-spa hover:bg-background spa-transition-fast min-h-[44px] min-w-[44px] flex items-center justify-center flex-shrink-0"
            >
              <Icon name="X" size={20} className="text-text-secondary" />
            </button>
          </div>

          {tabsNode}
          {contentNode}
          {/* Footer - Responsive with safe area padding for iOS */}
          {showAdminCorrection ? (
          <div className="flex items-center justify-between gap-2 sm:gap-3 p-4 pb-6 sm:p-6 border-t border-border flex-shrink-0">
            <span className="font-caption text-[11px] text-text-tertiary">
              {correctionMode === 'correct'
                ? [
                    correctionChangedCount > 0 ? `${correctionChangedCount} field${correctionChangedCount === 1 ? '' : 's'} changed` : null,
                    correctionPaymentChangedCount > 0 ? `${correctionPaymentChangedCount} payment${correctionPaymentChangedCount === 1 ? '' : 's'} changed` : null,
                  ].filter(Boolean).join(' · ')
                : ''}
            </span>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={requestCorrectionClose} disabled={correctionSubmitting} className="min-h-[44px] sm:min-h-0">
                Discard
              </Button>
              <button
                type="button"
                onClick={requestCorrectionSave}
                disabled={
                  correctionSubmitting ||
                  (correctionMode === 'delete' && !correctionDeleteConfirmed) ||
                  (correctionMode === 'correct' && correctionChangedCount === 0 && correctionPaymentChangedCount === 0)
                }
                className={`px-4 h-11 sm:h-10 rounded-spa text-white text-sm font-body font-body-medium disabled:opacity-50 spa-transition-fast inline-flex items-center space-x-1.5 ${
                  correctionMode === 'delete' ? 'bg-error hover:bg-error/90' : 'bg-warning hover:bg-warning/90'
                }`}
              >
                {correctionSubmitting && <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                <span>{correctionMode === 'delete' ? 'Delete booking' : 'Save'}</span>
              </button>
            </div>
          </div>
          ) : (
          <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 p-4 pb-6 sm:p-6 border-t border-border flex-shrink-0">
            {/* Left side — Add another service / Rebook */}
            {!isEditing && !showExtendPanel && !isViewer && onAddServiceStart ? (
              <div className="flex items-stretch gap-2">
                <button
                  onClick={() => onAddServiceStart(booking, 'add-service', block.rows)}
                  className="flex items-center justify-center text-center px-3 py-1.5 text-xs font-body font-body-medium text-primary border border-primary/30 rounded-spa hover:bg-primary/5 spa-transition-fast min-h-[36px]"
                >
                  Add another service
                </button>
                {/* "Rebook" always creates a brand-new booking with the same customer/service
                    info, leaving the original untouched — onRebookStart (only wired on the
                    branch-manager calendar today) closes this modal and lets staff click a
                    slot on the real calendar grid to place it. Disabled while the service has
                    already started or the day is locked — a sanity check independent of what
                    the button does, not a data-safety boundary (rebook never mutates the
                    original booking either way). */}
                <button
                  onClick={() => onRebookStart?.(booking)}
                  disabled={isServiceStarted || isLocked}
                  title={isServiceStarted ? 'This service has already started.' : undefined}
                  className="flex items-center justify-center text-center px-3 py-1.5 text-xs font-body font-body-medium text-text-secondary border border-border rounded-spa hover:bg-background spa-transition-fast min-h-[36px] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                >
                  {rebookLabel}
                </button>
                {!isTerminal && !isLocked && extendOptions.length > 0 && (
                  <button
                    onClick={() => setShowExtendPanel(true)}
                    className="flex items-center justify-center text-center px-3 py-1.5 text-xs font-body font-body-medium text-primary border border-primary/30 rounded-spa hover:bg-primary/5 spa-transition-fast min-h-[36px]"
                  >
                    Extend Service
                  </button>
                )}
              </div>
            ) : (
              <div />
            )}

            {/* Right side — action buttons */}
            <div className="flex items-center gap-2">
              {isEditing && activeTab === 'details' ? (
                <>
                  <Button variant="outline" onClick={cancelEditing} className="min-h-[44px] sm:min-h-0">
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    onClick={handleSaveEdit}
                    loading={isLoading}
                    disabled={!!editBlockMsg}
                    className="min-h-[44px] sm:min-h-0"
                  >
                    Save Changes
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" onClick={showAdminCorrection ? requestCorrectionClose : onClose} className="min-h-[44px] sm:min-h-0">
                    Close
                  </Button>
                  {activeTab === 'assign' && block.rows.some(multiStaffEditable) && (
                    <Button
                      variant="primary"
                      onClick={handleAssignAll}
                      loading={isLoading}
                      disabled={!multiStaffChanged.length || multiStaffIncomplete}
                      className="min-h-[44px] sm:min-h-0"
                    >
                      Save Assignment
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
          )}
        </div>
      </div>

      {overlays}
    </>,
    document.body
  );
};

export default BookingActionModal;
