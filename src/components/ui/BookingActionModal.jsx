import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import Button from './Button';
import CustomSelect from './CustomSelect';
import PaymentModal from './PaymentModal';
import ConfirmDialog, { CANCEL_REASON_OPTIONS } from './ConfirmDialog';
import Icon from '../AppIcon';
import MembershipWalletCard from './MembershipWalletCard';
import PaymentModeCorrectionModal from './PaymentModeCorrectionModal';
import PaymentMethodSelector from './PaymentMethodSelector';
import { fetchRelatedUnpaidBookings, fetchGroupBookings, fetchBookingCreator, fetchDiscountApprovers, fetchDueHolderNames, getCustomerOutstandingBalance, fetchMembershipForBooking, fetchCustomerReferralForBooking, resolveCustomerReferralReward, recordGroupPayment, recordTip, getCustomerFirstBookingFlag, adminCorrectBooking, adminDeleteBooking, correctPaymentAmount, correctPaymentMode } from '../../services/api';
import { excludeRelatedFromPreviousDue, toDbStatus } from '../../services/bookingTransformers';
import { useBranch } from '../../contexts/BranchContext';
import { useOrg } from '../../contexts/OrgContext';
import { getExtendOptions } from '../../utils/serviceVariants';

// Convert "HH:MM" or "HH:MM:SS" to 12h format
function to12h(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  const period = h >= 12 ? 'pm' : 'am';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

// Format an ISO timestamp as "5 Jun 2026, 2:14 pm"
function formatCreatedAt(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

// Status badge styles
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
  };
}

const BookingActionModal = ({
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
  onCreateBooking,
  onRebookStart,
  branchHours,
  defaultNewBookingMode,
  userRole = 'staff',
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
}) => {
  const { branchId } = useBranch();
  const { paymentMethods, orgSettings } = useOrg();
  const cancelReasonOptions = orgSettings?.cancellation_reasons?.length
    ? orgSettings.cancellation_reasons
    : CANCEL_REASON_OPTIONS;
  const [activeTab, setActiveTab] = useState('details');
  const [isFirstBooking, setIsFirstBooking] = useState(false);
  const [selectedTherapists, setSelectedTherapists] = useState([]);
  const [therapistSearch, setTherapistSearch] = useState('');
  const [selectedRoom, setSelectedRoom] = useState('');
  // Per-companion (non-primary therapist) room override for couple bookings where each
  // person is in a separate room — { [therapistId]: roomId }. Primary therapist (index 0
  // of selectedTherapists) always uses selectedRoom above.
  const [therapistRoomOverrides, setTherapistRoomOverrides] = useState({});
  const [companionName, setCompanionName] = useState('');
  const [companionPhone, setCompanionPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
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
  // Approver routing when a discount exceeds the user's limit
  const [approvers, setApprovers] = useState([]);
  const [selectedApprover, setSelectedApprover] = useState('');
  // Per-row discount override: { [bookingId]: '10' } — lets each selected service get its
  // own rate instead of the shared discountValue prorated/applied across the whole selection.
  const [rowDiscountOverrides, setRowDiscountOverrides] = useState({});

  // Add another service / Rebook state
  const [newBookingMode, setNewBookingMode] = useState(null); // 'add-service' | 'rebook' | null
  const [newBookingForm, setNewBookingForm] = useState({});
  const [newBookingError, setNewBookingError] = useState(null);
  const [newBookingSubmitting, setNewBookingSubmitting] = useState(false);

  // Who created this booking (lazy-loaded on open)
  const [creator, setCreator] = useState(null);
  const [customerReferral, setCustomerReferral] = useState(null);
  const [rewardAmount, setRewardAmount] = useState('');
  const [rewardSubmitting, setRewardSubmitting] = useState(false);
  const [rewardError, setRewardError] = useState(null);

  // Discount tab: same-day related bookings for combined discount application
  const [relatedBookings, setRelatedBookings] = useState([]);
  // Every sibling (formal group, or same customer_name+date when there's no
  // booking_group_id), any payment_status — display only, never used for
  // bundling (see fetchGroupBookings). Keeps a paid sibling
  // visible from every other sibling's modal instead of silently vanishing.
  const [groupSiblings, setGroupSiblings] = useState([]);
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

  // Pre-select current therapists/room when booking changes or assign tab opens
  useEffect(() => {
    if (booking) {
      const ids = booking.therapists?.length > 0
        ? booking.therapists.map(t => t.id)
        : (booking.therapist?.id ? [booking.therapist.id] : []);
      setSelectedTherapists(ids);
      setSelectedRoom(booking.roomId || '');
      const overrides = {};
      (booking.therapists || []).forEach(t => {
        if (t.roomId) overrides[t.id] = t.roomId;
      });
      setTherapistRoomOverrides(overrides);
      setCompanionName(booking.companionName || '');
      setCompanionPhone(booking.companionPhone || '');
    }
  }, [booking?.bookingId]);

  // Reset edit state when booking changes
  useEffect(() => {
    setIsEditing(false);
    setEditError(null);
    setActionError(null);
    setTherapistSearch('');
    setNewBookingMode(null);
    setNewBookingError(null);
    setNewBookingForm({});
    setNewBookingSubmitting(false);
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
    getCustomerFirstBookingFlag(booking.customerId, booking.bookingId, booking.date, booking.startTime).then((result) => {
      if (!cancelled) setIsFirstBooking(!!result.data?.isFirstBooking);
    });
    return () => { cancelled = true; };
  }, [booking?.bookingId, booking?.customerId, booking?.date, booking?.startTime]);

  // Fetch related unpaid bookings when payment tab opens
  useEffect(() => {
    if (isOpen && (activeTab === 'payment' || activeTab === 'discount') && booking) {
      const relatedPromise = fetchRelatedUnpaidBookings({
        customerName: booking.customerName,
        date: booking.date,
        excludeBookingId: booking.bookingId,
        bookingGroupId: booking.bookingGroupId,
        customerId: booking.customerId,
      });
      if (activeTab === 'payment') {
        fetchGroupBookings({
          bookingGroupId: booking.bookingGroupId,
          customerName: booking.customerName,
          date: booking.date,
          excludeBookingId: booking.bookingId,
        }).then(({ data }) => setGroupSiblings(data || []));
      } else {
        setGroupSiblings([]);
      }
      const duePromise = (activeTab === 'payment' && booking?.customerPhone)
        ? getCustomerOutstandingBalance({
            customerPhone: booking.customerPhone,
            branchId,
            excludeBookingId: booking.bookingId,
          })
        : Promise.resolve({ data: { bookings: [] } });

      Promise.all([relatedPromise, duePromise]).then(([relatedResult, dueResult]) => {
        const related = relatedResult.data || [];
        setRelatedBookings(related);
        // Auto-bundled by default — staff can uncheck individual items, same
        // as previous-due below.
        setSelectedRelatedIds(new Set(related.map(rb => rb.id)));

        const resetKey = `${activeTab}:${booking.bookingId}:${isOpen}`;
        if (discountResetKeyRef.current !== resetKey) {
          discountResetKeyRef.current = resetKey;
          setSelectedDiscountIds(new Set([booking.bookingId]));
          setSelectedApprover('');
          setDiscountSuccess(false);
          setRowDiscountOverrides({});
        }

        if (activeTab === 'payment') {
          // Exclude any booking already shown under "Related Services" — a real
          // booking_group_id sibling that's unpaid always also matches
          // getCustomerOutstandingBalance's phone-wide criteria, so without this it would be
          // double-counted in the Grand Total (see BK-20260908-0011/-0012 incident).
          const bookings = excludeRelatedFromPreviousDue(dueResult.data?.bookings, related);
          setPreviousDueBookings(bookings);
          // Auto-bundled by default — staff can uncheck individual items.
          setSelectedPreviousDueIds(new Set(bookings.map(b => b.bookingId)));
        }
      }).catch(err => {
        console.error('[BookingActionModal] related/previous-due bookings fetch failed:', err.message);
        if (activeTab === 'payment') {
          setPreviousDueBookings([]);
          setSelectedPreviousDueIds(new Set());
          setSelectedRelatedIds(new Set());
        }
      });
    } else if (isOpen && activeTab === 'payment') {
      setPreviousDueBookings([]);
      setSelectedPreviousDueIds(new Set());
    }
    if (isOpen && activeTab === 'payment' && booking?.bookingId) {
      fetchMembershipForBooking(booking.bookingId).then(result => {
        setMembership(result.data || null);
      });
    } else if (isOpen && activeTab === 'payment') {
      setMembership(null);
    }
  }, [activeTab, booking?.bookingId, booking?.paymentStatus, booking?.customerPhone, branchId, isOpen]);

  // Load who created this booking when the modal opens
  useEffect(() => {
    if (isOpen && booking?.bookingId) {
      fetchBookingCreator(booking.bookingId).then(result => setCreator(result.data || null));
    } else {
      setCreator(null);
    }
  }, [isOpen, booking?.bookingId]);

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
        setRewardError(error.message || 'Failed to save reward. Please try again.');
        return;
      }
      const refreshed = await fetchCustomerReferralForBooking(booking.bookingId);
      setCustomerReferral(refreshed.data || null);
    } catch (err) {
      setRewardError(err?.message || 'Failed to save reward. Please try again.');
    } finally {
      setRewardSubmitting(false);
    }
  };

  // Load eligible approvers the first time the discount tab is opened
  useEffect(() => {
    if (isOpen && activeTab === 'discount' && approvers.length === 0) {
      fetchDiscountApprovers().then(result => setApprovers(result.data || []));
    }
  }, [isOpen, activeTab]);

  // Auto-open rebook form when triggered via Escape fallback
  useEffect(() => {
    if (defaultNewBookingMode && booking) {
      openNewBookingForm(defaultNewBookingMode);
    }
  }, [defaultNewBookingMode, booking?.bookingId]);

  const tabs = [
    { id: 'details', label: 'Details', labelFull: 'Booking Details', icon: 'FileText' },
    { id: 'assign', label: 'Assigned', labelFull: 'Assigned', icon: 'UserCheck' },
    { id: 'discount', label: 'Discount', labelFull: 'Discount', icon: 'Percent' },
    { id: 'payment', label: 'Payment', labelFull: 'Payment', icon: 'CreditCard' }
  ];

  // Valid next-status transitions (lowercase UI values)
  const getNextStatuses = (currentStatus) => {
    const transitions = {
      'pending': ['confirmed', 'cancelled'],
      'confirmed': ['in-progress', 'cancelled'],
      'in-progress': ['completed'],
    };
    return transitions[currentStatus] || [];
  };

  // Service preview when editing
  const selectedService = useMemo(() => {
    if (!isEditing || !editForm.serviceId || !services?.length) return null;
    return services.find(s => s.id === editForm.serviceId);
  }, [isEditing, editForm.serviceId, services]);

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

  // Same auto-scroll for the Add another service / Rebook panel.
  const newBookingPanelRef = useRef(null);
  useEffect(() => {
    if (newBookingMode && newBookingPanelRef.current) {
      newBookingPanelRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [newBookingMode]);

  const handleExtendService = async (option) => {
    if (!booking || !onEditBooking) return;
    setExtendError(null);
    setExtendSubmitting(true);
    try {
      const result = await onEditBooking(booking.bookingId, { serviceId: option.id });
      if (result?.error) {
        setExtendError(result.error.message || 'Failed to extend service.');
      } else {
        setShowExtendPanel(false);
      }
    } catch (error) {
      setExtendError('An unexpected error occurred.');
    } finally {
      setExtendSubmitting(false);
    }
  };

  const startEditing = () => {
    setEditForm({
      customerName: booking.customerName || '',
      customerPhone: booking.customerPhone || '',
      serviceId: booking.serviceId || '',
      date: booking.date || '',
      startTime: booking.startTime ? booking.startTime.slice(0, 5) : booking.time || '',
      specialRequests: booking.specialRequests || '',
      referredBy: booking.referredBy || '',
    });
    setEditError(null);
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setEditError(null);
  };

  const handleSaveEdit = async () => {
    if (!booking || !onEditBooking) return;
    setEditError(null);

    if (!editForm.customerName.trim()) {
      setEditError('Customer name is required.');
      return;
    }

    setIsLoading(true);
    try {
      const result = await onEditBooking(booking.bookingId, {
        customerName: editForm.customerName.trim(),
        customerPhone: editForm.customerPhone.trim() || null,
        serviceId: editForm.serviceId || undefined,
        date: editForm.date || undefined,
        startTime: editForm.startTime ? editForm.startTime + ':00' : undefined,
        specialRequests: editForm.specialRequests.trim() || null,
        referredBy: (editForm.referredBy || '').trim() || null,
      });
      if (result?.error) {
        setEditError(result.error.message || 'Failed to update booking.');
      } else {
        setIsEditing(false);
      }
    } catch (error) {
      setEditError('An unexpected error occurred.');
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

  const format12h = (time24) => {
    const [h, m] = time24.split(':').map(Number);
    const suffix = h >= 12 ? 'pm' : 'am';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}:${String(m).padStart(2, '0')}${suffix}`;
  };

  const openNewBookingForm = (mode) => {
    const today = new Date().toISOString().slice(0, 10);
    setNewBookingForm({
      serviceId: mode === 'rebook' ? (booking.serviceId || '') : '',
      date: mode === 'rebook' ? '' : (booking.date || today),
      startTime: '',
      therapistId: '',
      roomId: '',
    });
    setNewBookingError(null);
    setNewBookingSubmitting(false);
    setNewBookingMode(mode);
  };

  const handleNewBookingSubmit = async () => {
    if (!booking || !onCreateBooking) return;
    if (!newBookingForm.serviceId) {
      setNewBookingError('Please select a service.');
      return;
    }
    if (!newBookingForm.date) {
      setNewBookingError('Please select a date.');
      return;
    }
    if (!newBookingForm.startTime) {
      setNewBookingError('Please select a time.');
      return;
    }

    setNewBookingSubmitting(true);
    setNewBookingError(null);

    try {
      const result = await onCreateBooking({
        serviceId: newBookingForm.serviceId,
        customerName: booking.customerName,
        customerPhone: booking.customerPhone || null,
        bookingDate: newBookingForm.date,
        bookingTime: newBookingForm.startTime,
        therapistId: newBookingForm.therapistId || null,
        roomId: newBookingForm.roomId || null,
      });

      if (result) {
        setNewBookingError(result);
      } else {
        setNewBookingMode(null);
        onClose();
      }
    } catch (err) {
      setNewBookingError(err?.message || 'Unexpected error. Please try again.');
    } finally {
      setNewBookingSubmitting(false);
    }
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
        setCorrectionError(rpcError.message || 'Failed to delete booking.');
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
        setCorrectionError(rpcError.message || 'Failed to correct booking.');
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
              + `Failed to correct payment ${paymentId}: ${rpcError.message || 'please try again.'}`
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
              + (rpcError.message || 'please try again.')
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

  const handleAssignTherapist = async () => {
    if (!booking) return;

    setIsLoading(true);
    setActionError(null);
    try {
      if (onAssignTherapist) {
        // Overrides/companion info only make sense for a couple-flagged service with
        // 2+ therapists selected -- gate on BOTH, not just therapist count, or this data
        // ships even after the section that shows it has been hidden (e.g. staff picked
        // 2 therapists on a couple service, then changed the service before saving).
        const isCoupleAssignment = selectedTherapists.length > 1 && !!currentServiceObj?.is_couple;
        const overridesToSend = isCoupleAssignment
          ? Object.fromEntries(
              selectedTherapists.slice(1).map(tid => [tid, therapistRoomOverrides[tid] || selectedRoom || null])
            )
          : undefined;
        await onAssignTherapist(
          booking.bookingId,
          selectedTherapists,
          notes,
          selectedRoom || null,
          overridesToSend,
          isCoupleAssignment ? (companionName.trim() || null) : undefined,
          isCoupleAssignment ? (companionPhone.trim() || null) : undefined
        );
      }
      onClose();
    } catch (error) {
      setActionError(error?.message || 'Assignment failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleStatusUpdate = async (newStatus, reason) => {
    if (!booking) return;
    setIsLoading(true);
    setActionError(null);
    try {
      if (onUpdateStatus) {
        await onUpdateStatus(booking.bookingId, newStatus, reason);
      }
      setPendingStatus(null);
      onClose();
    } catch (error) {
      setActionError(error?.message || 'Status update failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePaymentConfirm = async ({ tenders, additionalAllocations, dueHolderName, notes: paymentNotes, tipSplits }) => {
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
      if (onGroupPaymentRecorded) {
        const { data, error } = await recordGroupPayment([
          { bookingId: booking.bookingId, tenders, dueHolderName, notes: paymentNotes },
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
          const tipResult = await recordTip({ bookingId: booking.bookingId, amount: split.amount, receivedBy: split.receivedBy });
          if (tipResult.error) console.warn('[Tips] recordTip failed:', tipResult.error.message);
        }

        setShowPaymentModal(false);
        setSelectedPreviousDueIds(new Set());
        onGroupPaymentRecorded();
        return { data: data?.[0], error: null };
      }

      const result = await onRecordPayment(booking.bookingId, { tenders, dueHolderName, notes: paymentNotes, tipSplits });
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
      setShowPaymentModal(false);
      setSelectedPreviousDueIds(new Set());
      if (failedAllocations.length > 0) {
        setActionError(`Payment recorded for this booking, but failed for: ${failedAllocations.join(', ')}. Open ${failedAllocations.length > 1 ? 'those bookings' : 'that booking'} directly and record payment again.`);
      }
      return result;
    } finally {
      setPaymentSubmitting(false);
    }
  };

  if (!isOpen || !booking) return null;

  const isTerminal = ['completed', 'cancelled', 'no show'].includes(booking.status);
  const isLocked = booking.isLocked || false;
  const isSettled = booking.paymentStatus === 'paid';
  const isServiceStarted = booking.status === 'in-progress';
  // Clicking Start locks everything except Discount/Payment (still needed to
  // settle the bill); being paid locks Discount/Payment too (via canDiscount/
  // canPay below). Day-close and terminal status always lock everything.
  const isMutationBlocked = isTerminal || isLocked || isServiceStarted || isSettled;
  // Assignment (therapist/room) locks once the service has started (or is
  // terminal/day-closed) — NOT merely because it's been paid. A booking can be
  // paid before it starts (pay-after-service isn't mandatory) and reassignment
  // should still be possible right up until the service actually begins.
  // Admin correction bypasses this exact same way it bypasses the Booking
  // Details fields — the save path below routes through adminCorrectBooking
  // (therapist_id/room_id are in its whitelist), not the normal
  // onAssignTherapist call, which the DB immutability trigger would still
  // reject regardless of what the UI shows.
  const isAssignmentBlocked = !showAdminCorrection && (isTerminal || isLocked || isServiceStarted);
  // Always "Rebook" — this always creates a brand-new booking with the same
  // customer/service info, leaving the original untouched, regardless of
  // the source booking's status. "Reschedule" would wrongly imply the same
  // appointment moves (confirmed business decision, see handleRebookStart).
  const rebookLabel = 'Rebook';

  // Self-service rooms (Jacuzzi/Sauna/Steam) don't need a therapist to start — driven by
  // rooms.requires_therapist, not a hardcoded room/branch list.
  const selectedRoomObj = rooms.find(r => r.id === selectedRoom);
  const isTherapistOptional = selectedRoomObj?.requires_therapist === false;

  const nextStatuses = getNextStatuses(booking.status);
  // Payment is allowed on Completed bookings (pay-after-service is standard cash-spa flow).
  // Only day-lock and already-paid block it — not terminal status.
  const canPay = ['confirmed', 'in-progress', 'completed'].includes(booking.status) && booking.paymentStatus !== 'paid' && !isLocked;
  // Allow discounts on completed-but-unpaid bookings (standard cash-spa flow: service done → apply discount → pay).
  // Once the booking is fully paid, the price is locked — the discount can no longer move retroactively
  // against money already collected. 'partial' stays discountable so a discount can still be applied
  // against the still-owed remainder (e.g. after extending a booking that already had a payment).
  const canDiscount = booking.paymentStatus !== 'paid' && !isLocked
    && !['cancelled', 'no show'].includes(booking.status);
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
  const discountRowBase = (id) => id === booking.bookingId
    ? (booking.baseAmount || 0)
    : Number(relatedBookings.find(rb => rb.id === id)?.base_amount || 0);
  const checkedRowIds = [booking.bookingId, ...relatedBookings.map(rb => rb.id)].filter(id => selectedDiscountIds.has(id));
  const overriddenRowIds = checkedRowIds.filter(id => rowDiscountOverrides[id] !== undefined && rowDiscountOverrides[id] !== '');
  const pooledBase = checkedRowIds
    .filter(id => !overriddenRowIds.includes(id))
    .reduce((s, id) => s + discountRowBase(id), 0);
  const resolveRowDiscount = (id) => {
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
      setDiscountError('Select at least one service.');
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
      setDiscountError(`Discount cannot exceed ${hardCeiling}%.`);
      return;
    }

    // If ANY row exceeds the role's direct-apply limit, the whole batch routes to one approver.
    // TEMPORARY: staff limit raised 15% -> 50%, see the discountMaxPercent note above.
    const maxPercent = userRole === 'admin' ? 100 : userRole === 'manager' ? 100 : 50;
    const exceedsLimit = maxRowEffPercent > maxPercent;

    if (exceedsLimit && !selectedApprover) {
      setDiscountError('Select a manager or admin to send this discount request to.');
      return;
    }

    setIsLoading(true);
    try {
      let lastResult = null;
      let failed = false;

      for (const row of rowPlans) {
        const result = await onApplyDiscount(row.id, {
          discountType: discountType === 'percentage' ? 'percentage' : 'fixed',
          discountValue: discountType === 'percentage' ? row.value : row.amount,
          discountReason: discountReason.trim(),
          requestedTo: exceedsLimit ? selectedApprover : undefined
        });
        lastResult = result;
        if (result?.error) { failed = true; break; }
      }

      if (failed) {
        setDiscountError(lastResult?.error?.message || 'Failed to apply discount.');
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
      setDiscountError('An unexpected error occurred.');
    } finally {
      setIsLoading(false);
    }
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
              onClick={showAdminCorrection ? requestCorrectionClose : onClose}
              disabled={correctionSubmitting}
              className="p-2 rounded-spa hover:bg-background spa-transition-fast min-h-[44px] min-w-[44px] flex items-center justify-center flex-shrink-0 disabled:opacity-40"
            >
              <Icon name="X" size={20} className="text-text-secondary" />
            </button>
          </div>

          {/* Tabs - Horizontal scroll on mobile with padding for last item visibility */}
          <div className="border-b border-border flex-shrink-0">
            <nav className="flex overflow-x-auto scrollbar-hide pl-4 sm:pl-6 gap-1 sm:gap-6">
              {tabs.map((tab, index) => (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id);
                    setActionError(null);
                    if (tab.id !== 'details') setIsEditing(false);
                  }}
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

          {/* Content - Scrollable area takes remaining space, extra bottom padding on mobile for bottom nav */}
          <div className="p-4 sm:p-6 pb-24 sm:pb-6 overflow-y-auto flex-1">
            {/* Admin-correction indicator + delete toggle — visible on every tab while
                actively correcting, so switching tabs mid-correction never hides it.
                The reason itself is collected in the Save confirm dialog, right before
                submit, so it's shared across whatever was edited on any tab. */}
            {showAdminCorrection && (
              <div className="space-y-3 border border-warning/20 bg-warning/5 rounded-spa p-3 sm:p-4 mb-4 sm:mb-6">
                <div className="flex items-center justify-between">
                  <span className="font-body font-body-medium text-xs text-text-secondary">Admin correction</span>
                  <button
                    type="button"
                    onClick={() => setCorrectionMode((m) => (m === 'delete' ? 'correct' : 'delete'))}
                    className="font-caption text-[11px] text-error hover:underline"
                  >
                    {correctionMode === 'delete' ? 'Cancel delete' : 'Delete this booking instead'}
                  </button>
                </div>

                {correctionMode === 'delete' && (
                  <div className="bg-error/5 border border-error/20 rounded-spa px-3 py-2 space-y-2">
                    <p className="font-body text-xs text-error">
                      Deleting removes this booking entirely. It will disappear from past reports that counted it. A booking with a
                      payment, refund, referral or package redemption attached cannot be deleted — cancel it instead.
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

                {correctionError && (
                  <div className="bg-error/5 border border-error/20 rounded-spa px-3 py-2 flex items-start space-x-2">
                    <Icon name="AlertCircle" size={14} className="text-error flex-shrink-0 mt-0.5" />
                    <p className="font-body text-xs text-error">{correctionError}</p>
                  </div>
                )}
              </div>
            )}

            {/* Details Tab */}
            {activeTab === 'details' && (
              <div className="space-y-4 sm:space-y-6">
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
                  return (
                    <div className={`flex items-start sm:items-center space-x-2 px-3 py-2.5 rounded-spa ${banner.bg} border ${banner.border}`}>
                      <Icon name={banner.icon} size={16} className={`${banner.iconColor} flex-shrink-0 mt-0.5 sm:mt-0`} />
                      <span className={`font-body font-body-medium text-xs ${banner.textColor}`}>
                        {banner.label}
                        {showAdminCorrection && ' — editing as admin. Every change is recorded in the audit log with your reason.'}
                      </span>
                      {/* The only route past this lock. Admin-only, and every use is
                          recorded in audit_logs with a mandatory reason. */}
                      {userRole === 'admin' && !showAdminCorrection && (
                        <button
                          type="button"
                          onClick={openCorrection}
                          className="ml-auto inline-flex items-center space-x-1 px-2 py-1 rounded-spa border border-warning/40 text-warning hover:bg-warning/10 spa-transition-fast font-body font-body-medium text-[11px] flex-shrink-0"
                        >
                          <Icon name="Wrench" size={12} />
                          <span>Correct as admin</span>
                        </button>
                      )}
                    </div>
                  );
                })()}

                {/* Status and Actions - Stack on mobile */}
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
                        const needsConfirm = status === 'cancelled';
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
                            >
                              {status === 'in-progress' ? 'Start' : status.charAt(0).toUpperCase() + status.slice(1)}
                            </Button>
                          </React.Fragment>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Customer & Service Information - Responsive grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                  <div className="space-y-3 sm:space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="font-heading font-heading-medium text-sm sm:text-base text-text-primary">
                        Customer Information
                      </h3>
                      {!isMutationBlocked && !isEditing && !showAdminCorrection && onEditBooking && (
                        <button
                          onClick={startEditing}
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
                          <input
                            type="tel"
                            value={correctionFields.customer_phone}
                            onChange={(e) => setCorrectionField('customer_phone', e.target.value)}
                            className={inputClasses}
                            placeholder="Phone number"
                          />
                        ) : isEditing ? (
                          <input
                            type="tel"
                            value={editForm.customerPhone}
                            onChange={(e) => setEditForm(f => ({ ...f, customerPhone: e.target.value }))}
                            className={inputClasses}
                            placeholder="Phone number"
                          />
                        ) : (
                          booking.customerPhone ? (
                            <p className="font-body font-body-normal text-sm text-text-primary">{booking.customerPhone}</p>
                          ) : (
                            <p className="font-body font-body-normal text-sm text-text-secondary italic">Not provided</p>
                          )
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3 sm:space-y-4">
                    <h3 className="font-heading font-heading-medium text-sm sm:text-base text-text-primary">
                      Service Details
                    </h3>
                    <div className="space-y-2.5 sm:space-y-3">
                      <div>
                        <label className="font-body font-body-medium text-xs sm:text-sm text-text-secondary">Service</label>
                        {isEditing && services?.length > 0 ? (
                          <>
                            <CustomSelect
                              value={editForm.serviceId}
                              onChange={(val) => setEditForm(f => ({ ...f, serviceId: val }))}
                              options={services.map(s => ({ value: s.id, label: s.name }))}
                              placeholder="Select service"
                              searchable
                              size="sm"
                            />
                            {selectedService && (
                              <p className="font-caption text-xs text-text-secondary mt-1">
                                {selectedService.duration_minutes} min — NPR {selectedService.price_npr?.toLocaleString('en-IN')}
                              </p>
                            )}
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
                          <div className="flex gap-2">
                            <input
                              type="date"
                              value={editForm.date}
                              onChange={(e) => setEditForm(f => ({ ...f, date: e.target.value }))}
                              className={inputClasses}
                            />
                            <input
                              type="time"
                              value={editForm.startTime}
                              onChange={(e) => setEditForm(f => ({ ...f, startTime: e.target.value }))}
                              className={inputClasses}
                            />
                          </div>
                        ) : (
                          <p className="font-body font-body-normal text-sm text-text-primary">{booking.date} at {to12h(booking.time || booking.startTime)}</p>
                        )}
                      </div>
                      <div>
                        <label className="font-body font-body-medium text-xs sm:text-sm text-text-secondary">Payment</label>
                        <p className={`font-body font-body-medium text-sm ${booking.paymentStatus === 'paid' ? 'text-success' : 'text-warning'}`}>
                          {booking.paymentStatus === 'paid' ? 'Paid' : booking.paymentStatus === 'partial' ? 'Partial' : 'Unpaid'}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Therapist(s) */}
                {(booking.therapists?.length > 0 || booking.therapist) && !isEditing && (
                  <div className="space-y-1.5 sm:space-y-2">
                    <label className="font-body font-body-medium text-xs sm:text-sm text-text-secondary">
                      Assigned Therapist{(booking.therapists?.length || 0) > 1 ? 's' : ''}
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
                  <label className="font-body font-body-medium text-xs sm:text-sm text-text-secondary">Special Requests</label>
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
                  <label className="font-body font-body-medium text-xs sm:text-sm text-text-secondary">Referred by</label>
                  {isEditing ? (
                    <div className="relative">
                      <input
                        type="text"
                        value={editForm.referredBy || ''}
                        onChange={(e) => { setEditForm(f => ({ ...f, referredBy: e.target.value })); setReferredByOpen(true); }}
                        onFocus={() => setReferredByOpen(true)}
                        onBlur={() => setTimeout(() => setReferredByOpen(false), 150)}
                        placeholder="Type a name or pick a therapist…"
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
                {!isEditing && creator && (
                  <div className="pt-3 border-t border-border">
                    <p className="font-caption text-xs text-text-tertiary">
                      <Icon name="UserPlus" size={12} className="inline-block mr-1 -mt-0.5" />
                      Created by{' '}
                      <span className="text-text-secondary">{creator.createdByName || 'Online booking'}</span>
                      {creator.createdAt ? ` · ${formatCreatedAt(creator.createdAt)}` : ''}
                    </p>
                  </div>
                )}

                {/* Action error (status update failures) */}
                {actionError && !editError && (
                  <div className="flex items-center space-x-2 px-3 py-2.5 rounded-spa bg-error/10 border border-error/20">
                    <Icon name="AlertTriangle" size={14} className="text-error flex-shrink-0" />
                    <span className="font-body font-body-normal text-xs text-error">{actionError}</span>
                  </div>
                )}

                {/* Edit error */}
                {editError && (
                  <div className="flex items-center space-x-2 px-3 py-2.5 rounded-spa bg-error/10 border border-error/20">
                    <Icon name="AlertTriangle" size={14} className="text-error flex-shrink-0" />
                    <span className="font-body font-body-normal text-xs text-error">{editError}</span>
                  </div>
                )}
              </div>
            )}

            {/* Assigned Tab */}
            {activeTab === 'assign' && (
              <div className="space-y-4 sm:space-y-6">
                {isAssignmentBlocked && (
                  <div className={`flex items-center space-x-2 px-3 py-2.5 rounded-spa ${isLocked ? 'bg-amber-50 border border-amber-200' : 'bg-gray-50 border border-gray-200'}`}>
                    <Icon name="Lock" size={16} className={isLocked ? 'text-amber-600' : 'text-gray-500'} />
                    <span className={`font-body font-body-medium text-xs ${isLocked ? 'text-amber-700' : 'text-gray-600'}`}>
                      Assignment is disabled — {isLocked ? 'day is closed' : isTerminal ? 'booking is immutable' : 'booking has started'}
                    </span>
                  </div>
                )}

                {/* Section 1: Therapist */}
                <div className="space-y-3">
                  <h3 className="font-heading font-heading-medium text-sm sm:text-base text-text-primary">
                    Therapist
                  </h3>
                  {isTherapistOptional && (
                    <p className="font-caption font-caption-normal text-xs text-text-secondary">
                      Optional for {selectedRoomObj?.name} — self-service room, no therapist required.
                    </p>
                  )}
                  {therapists.length === 0 ? (
                    <p className="font-body font-body-normal text-sm text-text-secondary">No therapists available.</p>
                  ) : (
                    <div>
                      <div className="relative mb-2">
                        <Icon name="Search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
                        <input
                          type="text"
                          value={therapistSearch}
                          onChange={(e) => setTherapistSearch(e.target.value)}
                          placeholder="Search therapists..."
                          className="w-full pl-8 pr-3 py-2 bg-background border border-border rounded-spa text-sm focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                        />
                      </div>
                    <div className="space-y-2 max-h-[200px] overflow-y-auto">
                      {therapists
                        .filter(t => !therapistSearch.trim() || t.name.toLowerCase().includes(therapistSearch.toLowerCase()))
                        .map((therapist) => {
                        const isSelected = selectedTherapists.includes(therapist.id);
                        const isCurrentlyAssigned = booking?.therapists?.some(t => t.id === therapist.id)
                          || booking?.therapist?.id === therapist.id;
                        return (
                          <label
                            key={therapist.id}
                            className={`flex items-center space-x-3 sm:space-x-4 p-3 rounded-spa border-2 spa-transition-fast min-h-[52px] ${
                              isAssignmentBlocked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
                            } ${
                              isSelected
                                ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
                            }`}
                          >
                            <input
                              type="checkbox"
                              value={therapist.id}
                              checked={isSelected}
                              disabled={isAssignmentBlocked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedTherapists(prev => [...prev, therapist.id]);
                                } else {
                                  setSelectedTherapists(prev => prev.filter(id => id !== therapist.id));
                                }
                              }}
                              className="text-primary focus:ring-primary w-4 h-4 rounded disabled:cursor-not-allowed"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-body font-body-medium text-sm text-text-primary truncate">
                                  {therapist.name}
                                  {isCurrentlyAssigned && (
                                    <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-success/10 text-success">Assigned</span>
                                  )}
                                </span>
                                <span className="text-xs font-caption font-caption-normal text-text-secondary capitalize flex-shrink-0">
                                  {therapist.gender}
                                </span>
                              </div>
                              {therapist.specialties && therapist.specialties.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {therapist.specialties.map((specialty) => (
                                    <span
                                      key={specialty}
                                      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-caption font-caption-normal bg-accent/10 text-accent"
                                    >
                                      {specialty}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                    </div>
                  )}
                </div>

                {/* Section 2: Room */}
                {rooms.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="font-heading font-heading-medium text-sm sm:text-base text-text-primary">
                      Room
                    </h3>
                    <div className="space-y-2 max-h-[200px] overflow-y-auto">
                      {/* Unassign room option */}
                      <label
                        className={`flex items-center space-x-3 sm:space-x-4 p-3 rounded-spa border-2 spa-transition-fast min-h-[44px] ${
                          isAssignmentBlocked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
                        } ${
                          selectedRoom === ''
                            ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
                        }`}
                      >
                        <input
                          type="radio"
                          name="room"
                          value=""
                          checked={selectedRoom === ''}
                          disabled={isAssignmentBlocked}
                          onChange={() => setSelectedRoom('')}
                          className="text-primary focus:ring-primary w-4 h-4 disabled:cursor-not-allowed"
                        />
                        <span className="font-body font-body-normal text-sm text-text-secondary italic">No room assigned</span>
                      </label>
                      {rooms.map((room) => (
                        <label
                          key={room.id}
                          className={`flex items-center space-x-3 sm:space-x-4 p-3 rounded-spa border-2 spa-transition-fast min-h-[44px] ${
                            isAssignmentBlocked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
                          } ${
                            selectedRoom === room.id
                              ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
                          }`}
                        >
                          <input
                            type="radio"
                            name="room"
                            value={room.id}
                            checked={selectedRoom === room.id}
                            disabled={isAssignmentBlocked}
                            onChange={(e) => setSelectedRoom(e.target.value)}
                            className="text-primary focus:ring-primary w-4 h-4 disabled:cursor-not-allowed"
                          />
                          <div className="flex items-center gap-2">
                            <Icon name="DoorOpen" size={14} className="text-text-secondary" />
                            <span className="font-body font-body-medium text-sm text-text-primary">
                              {room.name}
                              {booking?.roomId === room.id && (
                                <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-primary/10 text-primary">Allocated</span>
                              )}
                            </span>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {/* Section 2b: Couple in separate rooms — surfaced only for a couple-flagged
                    service with 2+ therapists selected, not any multi-therapist assignment. */}
                {selectedTherapists.length > 1 && currentServiceObj?.is_couple && (
                  <div className="space-y-3">
                    <h3 className="font-heading font-heading-medium text-sm sm:text-base text-text-primary">
                      Couple — separate rooms &amp; companion (optional)
                    </h3>
                    <p className="font-caption font-caption-normal text-xs text-text-secondary">
                      Leave a companion's room unset to keep them in the room selected above.
                    </p>
                    <div className="space-y-2">
                      {selectedTherapists.slice(1).map((tid) => {
                        const t = therapists.find(th => th.id === tid);
                        return (
                          <div key={tid} className="flex items-center gap-3">
                            <span className="font-body font-body-medium text-sm text-text-primary w-32 truncate flex-shrink-0">
                              {t?.name || 'Companion'}
                            </span>
                            <CustomSelect
                              value={therapistRoomOverrides[tid] || ''}
                              onChange={(val) => setTherapistRoomOverrides(prev => ({ ...prev, [tid]: val }))}
                              options={[
                                { value: '', label: 'Same room as above' },
                                ...rooms.map(r => ({ value: r.id, label: r.name })),
                              ]}
                              placeholder="Same room as above"
                              size="sm"
                              className="flex-1"
                            />
                          </div>
                        );
                      })}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={companionName}
                        onChange={(e) => setCompanionName(e.target.value)}
                        placeholder="Companion's name (optional)"
                        className="w-full px-3 py-2 bg-background border border-border rounded-spa text-sm focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                      />
                      <input
                        type="tel"
                        value={companionPhone}
                        onChange={(e) => setCompanionPhone(e.target.value)}
                        placeholder="Companion's phone (optional)"
                        className="w-full px-3 py-2 bg-background border border-border rounded-spa text-sm focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                      />
                    </div>
                  </div>
                )}

                <div className="space-y-1.5 sm:space-y-2">
                  <label className="font-body font-body-medium text-xs sm:text-sm text-text-primary">
                    Assignment Notes
                  </label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Add any special instructions for the therapist..."
                    rows={3}
                    disabled={isAssignmentBlocked}
                    className="w-full px-3 py-2.5 border border-border rounded-spa bg-surface text-text-primary text-sm focus:ring-2 focus:ring-primary focus:border-primary spa-transition-fast resize-none disabled:opacity-60 disabled:cursor-not-allowed"
                  />
                </div>

                {actionError && (
                  <div className="flex items-center space-x-2 px-3 py-2.5 rounded-spa bg-error/10 border border-error/20">
                    <Icon name="AlertTriangle" size={14} className="text-error flex-shrink-0" />
                    <span className="font-body font-body-normal text-xs text-error">{actionError}</span>
                  </div>
                )}
              </div>
            )}

            {/* Discount Tab */}
            {activeTab === 'discount' && (
              <div className="space-y-4 sm:space-y-6">
                <h3 className="font-heading font-heading-medium text-sm sm:text-base text-text-primary">
                  Apply Discount
                </h3>

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
                    {/* All bookings pricing summary */}
                    <div className="bg-background rounded-spa p-3 sm:p-4 space-y-2">
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
                                <label className="flex items-start gap-2 cursor-pointer">
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
                                      {booking.time && <span>{to12h(booking.startTime || booking.time)}{booking.startTime && booking.startTime !== booking.time ? '' : ''}</span>}
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
                                  <span className="font-data text-sm text-success">- NPR {Number(booking.amountPaid || 0).toLocaleString('en-IN')}</span>
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
                                      <label className="flex items-start gap-2 cursor-pointer">
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
                                            {rb.start_time && <span>{to12h(rb.start_time)}{rb.end_time ? ` – ${to12h(rb.end_time)}` : ''}</span>}
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
                              setDiscountError(result.error.message || 'Failed to cancel discount.');
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

                    {/* Role limit info */}
                    <div className="flex items-center space-x-2 px-3 py-2.5 rounded-spa bg-accent/5 border border-accent/20">
                      <Icon name="Info" size={14} className="text-accent flex-shrink-0" />
                      <span className="font-caption font-caption-normal text-xs text-accent">
                        Your role ({userRole}) allows up to {discountLimitLabel} discount.
                      </span>
                    </div>

                    {/* Discount type */}
                    <div className="grid grid-cols-2 gap-2 sm:gap-3">
                      {['percentage', 'fixed'].map(type => (
                        <label
                          key={type}
                          className={`flex items-center space-x-2 p-2.5 sm:p-3 rounded-spa border-2 cursor-pointer spa-transition-fast min-h-[48px] ${
                            discountType === type ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
                          }`}
                        >
                          <input
                            type="radio"
                            name="discountType"
                            value={type}
                            checked={discountType === type}
                            onChange={() => setDiscountType(type)}
                            className="text-primary focus:ring-primary w-4 h-4"
                          />
                          <span className="font-body font-body-medium text-xs sm:text-sm text-text-primary">
                            {type === 'percentage' ? '% Percent' : 'NPR Fixed'}
                          </span>
                        </label>
                      ))}
                    </div>

                    {/* Discount value */}
                    <div className="space-y-1.5 sm:space-y-2">
                      <label className="font-body font-body-medium text-xs sm:text-sm text-text-primary">
                        {discountType === 'percentage' ? 'Discount Percentage' : 'Discount Amount (NPR)'}
                        {relatedBookings.length > 0 && (
                          <span className="font-body font-body-normal text-text-secondary"> (shared default — override any service above for its own rate)</span>
                        )}
                      </label>
                      <input
                        type="number"
                        min="0"
                        max={
                          discountType === 'percentage'
                            ? Math.min(100, Math.floor(((booking.baseAmount - (booking.amountPaid || 0)) / booking.baseAmount) * 100))
                            : Math.floor((booking.baseAmount || 0) - (booking.amountPaid || 0))
                        }
                        step={discountType === 'percentage' ? 1 : 10}
                        value={discountValue}
                        onWheel={(e) => e.target.blur()}
                        onChange={(e) => { setDiscountValue(e.target.value); setDiscountError(null); }}
                        placeholder={discountType === 'percentage' ? `Max ${discountLimitLabel}` : `Max NPR ${Math.floor((booking.baseAmount || 0) * (userRole === 'admin' ? 1.00 : userRole === 'manager' ? 1.00 : 0.50))}`}
                        className={`w-full px-3 py-2.5 border rounded-spa bg-surface text-text-primary text-sm focus:ring-2 focus:ring-primary focus:border-primary spa-transition-fast ${
                          discountExceedsCap ? 'border-error' : 'border-border'
                        }`}
                      />
                      {discountExceedsCap && (
                        <p className="text-xs text-error mt-1 flex items-center gap-1">
                          <Icon name="AlertTriangle" size={12} />
                          Discount cannot exceed {DISCOUNT_HARD_CAP}%.
                        </p>
                      )}
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
                            <span className="font-body-medium text-text-primary text-right">{booking.service || '—'}</span>
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
                                label: `${a.fullName} (${a.role === 'admin' ? 'Admin' : 'Branch Manager'})`,
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
                      <div className="flex items-center space-x-2 px-3 py-2.5 rounded-spa bg-error/10 border border-error/20">
                        <Icon name="AlertTriangle" size={14} className="text-error flex-shrink-0" />
                        <span className="font-body font-body-normal text-xs text-error">{discountError}</span>
                      </div>
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
                        : (checkedRowIds.length > 1 ? `Apply Discount to ${checkedRowIds.length} Services` : 'Apply Discount')}
                    </Button>
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
              const selectedCount = selectedRelatedIds.size + selectedPreviousDueIds.size;
              const paidThisVisit = (booking.payments || [])
                .filter(p => p.paymentMode === 'Membership')
                .reduce((s, p) => s + p.amount, 0);
              // relatedBookings is always same-day as the booking being viewed — label it
              // "Today's" only when that day actually IS today, so a staffer looking at a
              // past booking (via search, not the live Calendar) doesn't see a misleading
              // "Today" label on services that happened days ago.
              const todayStr = new Date().toISOString().slice(0, 10);
              const relatedGroupLabel = booking.date === todayStr ? "Today's Services" : 'Other Day Services';

              return (
              <div className="space-y-4 sm:space-y-6">
                <h3 className="font-heading font-heading-medium text-sm sm:text-base text-text-primary">
                  Payment Status
                </h3>

                <MembershipWalletCard membership={membership} paidThisVisit={paidThisVisit} />

                {/* Current booking */}
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
                        <span className="font-data text-sm text-success">- NPR {Number(booking.amountPaid || 0).toLocaleString('en-IN')}</span>
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
                              <span className="text-text-tertiary">{p.paymentMode}</span>
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
                          <div key={`${p.paymentMode}-${p.amount}`} className="flex items-center justify-between pl-2 text-[11px]">
                            <span className="text-text-tertiary">{p.paymentMode}</span>
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
                                #{rb.booking_number} · {to12h(rb.start_time)}
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
                      Already paid in this group
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
                                #{pb.bookingNumber} · {pb.date}
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
                {selectedCount > 0 && (
                  <div className="bg-primary/5 border border-primary/20 rounded-spa p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-body font-body-medium text-sm text-text-primary">
                        Grand Total ({1 + selectedCount} services)
                      </span>
                      <span className="font-data font-data-medium text-base text-primary">
                        NPR {combinedTotal.toLocaleString('en-IN')}
                      </span>
                    </div>
                  </div>
                )}

                {actionError && (
                  <div className="flex items-center space-x-2 px-3 py-2.5 rounded-spa bg-error/10 border border-error/20">
                    <Icon name="AlertTriangle" size={14} className="text-error flex-shrink-0" />
                    <span className="font-body font-body-normal text-xs text-error">{actionError}</span>
                  </div>
                )}

                {/* Payment status */}
                <div className="flex items-center justify-between px-1">
                  <span className="font-body font-body-normal text-xs text-text-secondary">Status</span>
                  <span className={`font-body font-body-medium text-sm ${booking.paymentStatus === 'paid' ? 'text-success' : booking.paymentStatus === 'partial' ? 'text-warning' : 'text-warning'}`}>
                    {booking.paymentStatus === 'paid' ? 'Paid' : booking.paymentStatus === 'partial' ? 'Partial' : 'Unpaid'}
                  </span>
                </div>

                {canPay && (
                  <Button
                    variant="success"
                    onClick={() => setShowPaymentModal(true)}
                    iconName="CreditCard"
                    iconPosition="left"
                    className="w-full sm:w-auto min-h-[44px]"
                  >
                    {selectedCount > 0 ? `Pay ${1 + selectedCount} Services` : 'Record Payment'}
                  </Button>
                )}
                {booking.paymentStatus === 'paid' && (
                  <div className="space-y-2">
                    <div className="flex items-center space-x-2 px-3 py-2.5 rounded-spa bg-success/10 border border-success/20">
                      <Icon name="CheckCircle" size={14} className="text-success flex-shrink-0" />
                      <span className="font-body font-body-normal text-xs sm:text-sm text-success">Payment has been recorded.</span>
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
                        <div key={p.id || `${p.paymentMode}-${p.amount}`} className="flex items-center justify-between px-3 py-1.5 text-xs gap-2">
                          <span className="text-text-secondary">{p.paymentMode}</span>
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

                {extendError && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-spa bg-error/10 border border-error/20">
                    <Icon name="AlertCircle" size={14} className="text-error flex-shrink-0" />
                    <span className="font-body text-xs text-error">{extendError}</span>
                  </div>
                )}

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

            {/* Add Another Service / Rebook Form */}
            {!showExtendPanel && newBookingMode && (
              <div ref={newBookingPanelRef} className="space-y-4 scroll-mt-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon name={newBookingMode === 'rebook' ? 'CalendarClock' : 'PlusCircle'} size={18} className="text-primary" />
                    <h3 className="font-heading font-heading-medium text-sm sm:text-base text-text-primary">
                      {newBookingMode === 'rebook' ? `${rebookLabel} Service` : 'Add Another Service'}
                    </h3>
                  </div>
                  <button
                    onClick={() => setNewBookingMode(null)}
                    className="p-1.5 rounded-spa hover:bg-background spa-transition-fast text-text-secondary hover:text-text-primary"
                  >
                    <Icon name="X" size={16} />
                  </button>
                </div>

                <div className="bg-background/50 rounded-spa p-3 border border-border/50">
                  <p className="font-body text-xs text-text-secondary">
                    Customer: <span className="font-semibold text-text-primary">{booking.customerName}</span>
                    {booking.customerPhone && <span className="ml-2">({booking.customerPhone})</span>}
                  </p>
                  {newBookingMode === 'rebook' && (
                    <p className="font-body text-xs text-text-secondary mt-1">
                      Same service: <span className="font-semibold text-text-primary">{booking.service}</span>
                    </p>
                  )}
                </div>

                {newBookingError && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-spa bg-error/10 border border-error/20">
                    <Icon name="AlertCircle" size={14} className="text-error flex-shrink-0" />
                    <span className="font-body text-xs text-error">{newBookingError}</span>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Service — editable only for "add another service" */}
                  {newBookingMode === 'add-service' && (
                    <div className="sm:col-span-2">
                      <label className="block font-body font-body-medium text-xs text-text-secondary mb-1">Service *</label>
                      <CustomSelect
                        value={newBookingForm.serviceId}
                        onChange={(val) => setNewBookingForm(f => ({ ...f, serviceId: val }))}
                        options={services.map(s => ({ value: s.id, label: `${s.name} — ${s.duration_minutes}min — NPR ${s.price_npr}` }))}
                        placeholder="Select service..."
                        searchable
                        size="sm"
                      />
                    </div>
                  )}

                  {/* Date */}
                  <div>
                    <label className="block font-body font-body-medium text-xs text-text-secondary mb-1">Date *</label>
                    <input
                      type="date"
                      value={newBookingForm.date}
                      min={new Date().toISOString().slice(0, 10)}
                      onChange={e => setNewBookingForm(f => ({ ...f, date: e.target.value }))}
                      className={inputClasses}
                    />
                  </div>

                  {/* Time */}
                  <div>
                    <label className="block font-body font-body-medium text-xs text-text-secondary mb-1">Time *</label>
                    <CustomSelect
                      value={newBookingForm.startTime}
                      onChange={(val) => setNewBookingForm(f => ({ ...f, startTime: val }))}
                      options={timeOptions.map(t => ({ value: t, label: format12h(t) }))}
                      placeholder="Select time..."
                      searchable
                      size="sm"
                    />
                  </div>

                  {/* Therapist */}
                  <div>
                    <label className="block font-body font-body-medium text-xs text-text-secondary mb-1">Therapist</label>
                    <CustomSelect
                      value={newBookingForm.therapistId}
                      onChange={(val) => setNewBookingForm(f => ({ ...f, therapistId: val }))}
                      options={[{ value: '', label: 'Any available' }, ...therapists.map(t => ({ value: t.id, label: t.name }))]}
                      placeholder="Any available"
                      size="sm"
                    />
                  </div>

                  {/* Room */}
                  <div>
                    <label className="block font-body font-body-medium text-xs text-text-secondary mb-1">Room</label>
                    <CustomSelect
                      value={newBookingForm.roomId}
                      onChange={(val) => setNewBookingForm(f => ({ ...f, roomId: val }))}
                      options={[{ value: '', label: 'Any available' }, ...rooms.map(r => ({ value: r.id, label: r.name }))]}
                      placeholder="Any available"
                      size="sm"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => setNewBookingMode(null)} className="min-h-[44px] sm:min-h-0">
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    onClick={handleNewBookingSubmit}
                    loading={newBookingSubmitting}
                    className="min-h-[44px] sm:min-h-0"
                  >
                    {newBookingMode === 'rebook' ? rebookLabel : 'Create Booking'}
                  </Button>
                </div>
              </div>
            )}
          </div>

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
            {!isEditing && !newBookingMode && !showExtendPanel && onCreateBooking ? (
              <div className="flex items-stretch gap-2">
                <button
                  onClick={() => openNewBookingForm('add-service')}
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
                  {activeTab === 'assign' && !isAssignmentBlocked && (
                    <Button
                      variant="primary"
                      onClick={handleAssignTherapist}
                      loading={isLoading}
                      disabled={selectedTherapists.length === 0 && !isTherapistOptional}
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

      {/* Cancel confirmation */}
      {pendingStatus && (
        <ConfirmDialog
          title="Cancel Booking"
          message="This will cancel the booking. This cannot be undone."
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

      {/* Payment Modal */}
      {showPaymentModal && (
        <PaymentModal
          booking={{
            id: booking.id,
            bookingId: booking.bookingId,
            booking_number: booking.id,
            branchId: booking.branchId,
            service: booking.service,
            base_amount: booking.baseAmount,
            discount_amount: booking.discountAmount,
            final_amount: booking.finalAmount,
            amountPaid: booking.amountPaid,
            dueHolderName: booking.dueHolderName,
          }}
          additionalBookings={[
            ...relatedBookings.filter(rb => selectedRelatedIds.has(rb.id)).map(rb => ({
              bookingId: rb.id,
              bookingNumber: rb.booking_number,
              service: rb.service?.name,
              base_amount: rb.base_amount,
              discount_amount: rb.discount_amount,
              final_amount: rb.final_amount,
            })),
            ...previousDueBookings.filter(pb => selectedPreviousDueIds.has(pb.bookingId)),
          ]}
          dueHolderSuggestions={dueHolderSuggestions}
          onConfirm={handlePaymentConfirm}
          onClose={() => setShowPaymentModal(false)}
          isSubmitting={paymentSubmitting}
        />
      )}
    </>,
    document.body
  );
};

export default BookingActionModal;
