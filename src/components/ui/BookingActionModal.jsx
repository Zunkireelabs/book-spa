import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import Button from './Button';
import CustomSelect from './CustomSelect';
import PaymentModal from './PaymentModal';
import ConfirmDialog from './ConfirmDialog';
import Icon from '../AppIcon';
import MembershipWalletCard from './MembershipWalletCard';
import { fetchRelatedUnpaidBookings, fetchBookingCreator, fetchDiscountApprovers, fetchDueHolderNames, getCustomerOutstandingBalance, fetchMembershipForBooking, fetchCustomerReferralForBooking, resolveCustomerReferralReward } from '../../services/api';
import { useBranch } from '../../contexts/BranchContext';
import { getExtendOptions } from '../../utils/serviceVariants';

function getNepalNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kathmandu' }));
}

// "No Show" only becomes selectable once the booking's scheduled start time
// has passed — otherwise staff could mark a client a no-show before they were
// even due.
function hasBookingStarted(booking) {
  if (!booking?.date || !booking?.startTime) return false;
  const start = new Date(`${booking.date}T${booking.startTime}`);
  return getNepalNow() >= start;
}

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

// Rooms that are self-service experiences — no therapist needed (Thamel branch hotfix)
const THERAPIST_OPTIONAL_ROOM_NAMES = ['JACUZZI', 'SAUNA', 'STEAM'];

// Status badge styles
const STATUS_STYLES = {
  pending: 'bg-warning/10 text-warning',
  confirmed: 'bg-success/10 text-success',
  'in-progress': 'bg-primary/10 text-primary',
  completed: 'bg-gray-100 text-gray-500',
  cancelled: 'bg-error/10 text-error',
  'no show': 'bg-gray-100 text-gray-500',
};

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
  onApplyDiscount,
  onEditBooking,
  onCreateBooking,
  onRebookStart,
  branchHours,
  defaultNewBookingMode,
  userRole = 'staff'
}) => {
  const { branchId, branchName } = useBranch();
  const [activeTab, setActiveTab] = useState('details');
  const [selectedTherapists, setSelectedTherapists] = useState([]);
  const [therapistSearch, setTherapistSearch] = useState('');
  const [selectedRoom, setSelectedRoom] = useState('');
  const [notes, setNotes] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [pendingStatus, setPendingStatus] = useState(null); // 'cancelled' | 'no show' while confirm dialog is open

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
  const [dueHolderSuggestions, setDueHolderSuggestions] = useState([]);
  const [selectedDiscountIds, setSelectedDiscountIds] = useState(new Set()); // includes current booking ID by default

  // Previous due: this customer's outstanding balance from earlier visits (any date),
  // separate from `relatedBookings` (same-day services, used by the Discount tab).
  // Pre-selected by default so it's bundled into payment automatically.
  const [previousDueBookings, setPreviousDueBookings] = useState([]);
  const [selectedPreviousDueIds, setSelectedPreviousDueIds] = useState(new Set());

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
  }, [booking?.bookingId]);

  // Fetch related unpaid bookings when payment tab opens
  useEffect(() => {
    if ((activeTab === 'payment' || activeTab === 'discount') && booking) {
      fetchRelatedUnpaidBookings({
        customerName: booking.customerName,
        date: booking.date,
        excludeBookingId: booking.bookingId,
      }).then(result => {
        setRelatedBookings(result.data || []);
        setSelectedDiscountIds(new Set([booking.bookingId]));
        setSelectedApprover('');
        setDiscountSuccess(false);
        setRowDiscountOverrides({});
      });
    }
    if (activeTab === 'payment' && booking?.customerPhone) {
      getCustomerOutstandingBalance({
        customerPhone: booking.customerPhone,
        branchId,
        excludeBookingId: booking.bookingId,
      }).then(result => {
        const bookings = result.data?.bookings || [];
        setPreviousDueBookings(bookings);
        // Auto-bundled by default — staff can uncheck individual items.
        setSelectedPreviousDueIds(new Set(bookings.map(b => b.bookingId)));
      }).catch(err => {
        console.error('[BookingActionModal] getCustomerOutstandingBalance failed:', err.message);
        setPreviousDueBookings([]);
        setSelectedPreviousDueIds(new Set());
      });
    } else if (activeTab === 'payment') {
      setPreviousDueBookings([]);
      setSelectedPreviousDueIds(new Set());
    }
    if (activeTab === 'payment' && booking?.bookingId) {
      fetchMembershipForBooking(booking.bookingId).then(result => {
        setMembership(result.data || null);
      });
    } else if (activeTab === 'payment') {
      setMembership(null);
    }
  }, [activeTab, booking?.bookingId, booking?.paymentStatus, booking?.customerPhone, branchId]);

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

  const handleAssignTherapist = async () => {
    if (!booking) return;

    setIsLoading(true);
    setActionError(null);
    try {
      if (onAssignTherapist) {
        await onAssignTherapist(booking.bookingId, selectedTherapists, notes, selectedRoom || null);
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

  const handlePaymentConfirm = async ({ tenders, additionalAllocations, dueHolderName, notes: paymentNotes }) => {
    if (!booking || !onRecordPayment) return { error: { message: 'No payment handler available.' } };
    setPaymentSubmitting(true);
    try {
      const result = await onRecordPayment(booking.bookingId, { tenders, dueHolderName, notes: paymentNotes });
      if (result?.error) return result;

      // Pay each bundled previous-due booking with its own allocated tenders
      // (PaymentModal splits the entered amount across bookings and methods).
      for (const alloc of (additionalAllocations || [])) {
        await onRecordPayment(alloc.bookingId, { tenders: alloc.tenders, notes: paymentNotes });
      }

      // Stay open on the Payment tab (rather than closing the whole modal) so
      // staff immediately see the refreshed status, balance, and — for members —
      // the updated wallet amount, instead of having to reopen the booking.
      setShowPaymentModal(false);
      setSelectedPreviousDueIds(new Set());
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
  const isAssignmentBlocked = isTerminal || isLocked || isServiceStarted;
  // "Rebook" reads as booking-again-after on terminal states; on active bookings "Reschedule" is clearer
  const rebookLabel = isTerminal ? 'Rebook' : 'Reschedule';

  // Thamel hotfix: Jacuzzi/Sauna/Steam are self-service rooms — no therapist needed
  const selectedRoomObj = rooms.find(r => r.id === selectedRoom);
  const isTherapistOptional = branchName?.trim().toLowerCase() === 'thamel'
    && THERAPIST_OPTIONAL_ROOM_NAMES.includes(selectedRoomObj?.name?.trim().toUpperCase());

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
  const discountLimitLabel = userRole === 'admin' ? '100%' : userRole === 'manager' ? '100%' : '15%';

  // Request-mode derivations: a discount over the user's role limit must be
  // routed to a chosen approver instead of being applied directly.
  // Staff request ceiling stays at 50%; manager/admin direct-apply ceiling is 100%.
  const DISCOUNT_HARD_CAP = userRole === 'staff' ? 50 : 100;
  const discountMaxPercent = userRole === 'admin' ? 100 : userRole === 'manager' ? 100 : 15;

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
    const maxPercent = userRole === 'admin' ? 100 : userRole === 'manager' ? 100 : 15;
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
                <p className="font-caption font-caption-normal text-xs sm:text-sm text-text-secondary truncate">
                  {booking.id} — {booking.customerName}
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
                    <div className={`flex items-center space-x-2 px-3 py-2.5 rounded-spa ${banner.bg} border ${banner.border}`}>
                      <Icon name={banner.icon} size={16} className={banner.iconColor} />
                      <span className={`font-body font-body-medium text-xs ${banner.textColor}`}>
                        {banner.label}
                      </span>
                    </div>
                  );
                })()}

                {/* Status and Actions - Stack on mobile */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="flex items-center space-x-2">
                    <span className="font-body font-body-medium text-sm text-text-primary">Status:</span>
                    <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-caption font-caption-normal capitalize ${STATUS_STYLES[booking.status] || 'bg-gray-100 text-gray-500'}`}>
                      {booking.status.replace('-', ' ')}
                    </span>
                  </div>
                  {!isTerminal && !isLocked && nextStatuses.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {nextStatuses.map((status) => {
                        const needsConfirm = status === 'cancelled' || status === 'no show';
                        const noShowGated = status === 'no show' && !hasBookingStarted(booking);
                        return (
                          <Button
                            key={status}
                            variant={needsConfirm ? 'outline' : 'primary'}
                            size="sm"
                            className="min-h-[40px] sm:min-h-0 sm:h-auto"
                            onClick={() => needsConfirm ? setPendingStatus(status) : handleStatusUpdate(status)}
                            loading={isLoading}
                            disabled={noShowGated}
                            title={noShowGated ? "Available after the booking's scheduled time" : undefined}
                          >
                            {status === 'in-progress' ? 'Start' : status === 'no show' ? 'No Show' : status.charAt(0).toUpperCase() + status.slice(1)}
                          </Button>
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
                      {!isMutationBlocked && !isEditing && onEditBooking && (
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
                        <label className="font-body font-body-medium text-xs sm:text-sm text-text-secondary">Name</label>
                        {isEditing ? (
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
                      {(booking.customerEmail && !isEditing) && (
                        <div>
                          <label className="font-body font-body-medium text-xs sm:text-sm text-text-secondary">Email</label>
                          <p className="font-body font-body-normal text-sm text-text-primary break-all">{booking.customerEmail}</p>
                        </div>
                      )}
                      <div>
                        <label className="font-body font-body-medium text-xs sm:text-sm text-text-secondary">Phone</label>
                        {isEditing ? (
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
                            <label className="font-body font-body-medium text-xs sm:text-sm text-text-secondary">Price</label>
                            <p className="font-body font-body-normal text-sm text-text-primary">{booking.price}</p>
                          </div>
                        </div>
                      )}
                      <div>
                        <label className="font-body font-body-medium text-xs sm:text-sm text-text-secondary">Date & Time</label>
                        {isEditing ? (
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

                {/* Created-by audit line — only when a staff creator was recorded */}
                {!isEditing && creator?.createdByName && (
                  <div className="pt-3 border-t border-border">
                    <p className="font-caption text-xs text-text-tertiary">
                      <Icon name="UserPlus" size={12} className="inline-block mr-1 -mt-0.5" />
                      Created by{' '}
                      <span className="text-text-secondary">{creator.createdByName}</span>
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

                {!canDiscount ? (
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
                        {userRole !== 'admin' && userRole !== 'manager' && ' You can request up to 50% from a manager or admin.'}
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
                        max={discountType === 'percentage' ? 100 : Math.floor(booking.baseAmount || 0)}
                        step={discountType === 'percentage' ? 1 : 10}
                        value={discountValue}
                        onWheel={(e) => e.target.blur()}
                        onChange={(e) => { setDiscountValue(e.target.value); setDiscountError(null); }}
                        placeholder={discountType === 'percentage' ? `Max ${discountLimitLabel}` : `Max NPR ${Math.floor((booking.baseAmount || 0) * (userRole === 'admin' ? 1.00 : userRole === 'manager' ? 1.00 : 0.15))}`}
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
              // Related same-session services (discounted together via the Discount tab)
              // are bundled into payment automatically — no opt-in checkboxes, since they
              // were already grouped as one action.
              const relatedRemaining = (rb) => Math.max(Number(rb.base_amount || 0) - Number(rb.discount_amount || 0), 0);
              const relatedBookingsTotal = relatedBookings.reduce((sum, rb) => sum + relatedRemaining(rb), 0);
              const combinedTotal = (booking.finalAmount || 0) + relatedBookingsTotal + previousDueTotal;
              const selectedCount = relatedBookings.length + selectedPreviousDueIds.size;
              const paidThisVisit = (booking.payments || [])
                .filter(p => p.paymentMode === 'Membership')
                .reduce((s, p) => s + p.amount, 0);

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
                  <div className="flex items-center justify-between">
                    <span className="font-body font-body-normal text-xs text-text-secondary">Base Amount</span>
                    <span className="font-data text-sm text-text-primary">NPR {booking.baseAmount?.toLocaleString('en-IN') || '—'}</span>
                  </div>
                  {booking.discountAmount > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="font-body font-body-normal text-xs text-text-secondary">Discount</span>
                      <span className="font-data text-sm text-error">- NPR {booking.discountAmount?.toLocaleString('en-IN')} ({booking.baseAmount > 0 ? Math.round((booking.discountAmount / booking.baseAmount) * 100) : 0}%)</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between border-t border-border pt-2">
                    <span className="font-body font-body-medium text-xs text-text-primary">{(previousDueBookings.length > 0 || relatedBookings.length > 0) ? 'Subtotal' : 'Final Amount'}</span>
                    <span className="font-data font-data-medium text-sm text-text-primary">NPR {booking.finalAmount?.toLocaleString('en-IN') || '—'}</span>
                  </div>
                  {booking.paymentStatus === 'partial' && (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="font-body font-body-normal text-xs text-text-secondary">Already Paid</span>
                        <span className="font-data text-sm text-success">- NPR {Number(booking.amountPaid || 0).toLocaleString('en-IN')}</span>
                      </div>
                      <div className="flex items-center justify-between border-t border-border pt-2">
                        <span className="font-body font-body-medium text-xs text-text-primary">Balance Due</span>
                        <span className="font-data font-data-medium text-sm text-warning">NPR {Number(booking.amountDue || 0).toLocaleString('en-IN')}</span>
                      </div>
                    </>
                  )}
                </div>

                {/* Related services — same-session bookings discounted together on the
                    Discount tab. Bundled into payment by default, no opt-in needed. */}
                {relatedBookings.length > 0 && (
                  <div className="space-y-2">
                    <label className="font-body font-body-medium text-xs text-text-secondary uppercase flex items-center gap-1.5">
                      <Icon name="Layers" size={13} />
                      Related services ({relatedBookings.length})
                    </label>
                    <div className="border border-border rounded-spa divide-y divide-border overflow-hidden">
                      {relatedBookings.map(rb => (
                        <div key={rb.id} className="flex items-center gap-3 px-3 py-2.5">
                          <div className="flex-1 min-w-0">
                            <div className="font-body text-sm text-text-primary">{rb.service?.name || 'Service'}</div>
                            <div className="font-caption text-xs text-text-secondary">
                              #{rb.booking_number} · {to12h(rb.start_time)}
                              {Number(rb.discount_amount) > 0 && ` · discount -NPR ${Number(rb.discount_amount).toLocaleString('en-IN')}`}
                            </div>
                          </div>
                          <span className="font-data text-sm text-text-primary flex-shrink-0">NPR {relatedRemaining(rb).toLocaleString('en-IN')}</span>
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
                      Previous due for {booking.customerName}
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
                  <div className="flex items-center space-x-2 px-3 py-2.5 rounded-spa bg-success/10 border border-success/20">
                    <Icon name="CheckCircle" size={14} className="text-success flex-shrink-0" />
                    <span className="font-body font-body-normal text-xs sm:text-sm text-success">Payment has been recorded.</span>
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
          <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 p-4 pb-6 sm:p-6 border-t border-border flex-shrink-0">
            {/* Left side — Add another service / Rebook */}
            {!isEditing && !newBookingMode && !showExtendPanel && onCreateBooking ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => openNewBookingForm('add-service')}
                  className="px-3 py-1.5 text-xs font-body font-body-medium text-primary border border-primary/30 rounded-spa hover:bg-primary/5 spa-transition-fast min-h-[36px]"
                >
                  Add another service
                </button>
                <button
                  onClick={() => onRebookStart?.(booking)}
                  className="px-3 py-1.5 text-xs font-body font-body-medium text-text-secondary border border-border rounded-spa hover:bg-background spa-transition-fast min-h-[36px]"
                >
                  {rebookLabel}
                </button>
                {!isTerminal && !isLocked && extendOptions.length > 0 && (
                  <button
                    onClick={() => setShowExtendPanel(true)}
                    className="px-3 py-1.5 text-xs font-body font-body-medium text-primary border border-primary/30 rounded-spa hover:bg-primary/5 spa-transition-fast min-h-[36px]"
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
                  <Button variant="outline" onClick={onClose} className="min-h-[44px] sm:min-h-0">
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
        </div>
      </div>

      {/* Cancel / No Show confirmation */}
      {pendingStatus && (
        <ConfirmDialog
          title={pendingStatus === 'no show' ? 'Mark as No Show' : 'Cancel Booking'}
          message={
            pendingStatus === 'no show'
              ? 'This will mark the booking as a no-show. This cannot be undone.'
              : 'This will cancel the booking. This cannot be undone.'
          }
          confirmLabel={pendingStatus === 'no show' ? 'Mark No Show' : 'Cancel Booking'}
          isSubmitting={isLoading}
          onClose={() => setPendingStatus(null)}
          onConfirm={(reason) => handleStatusUpdate(pendingStatus, reason)}
        />
      )}

      {/* Payment Modal */}
      {showPaymentModal && (
        <PaymentModal
          booking={{
            id: booking.id,
            bookingId: booking.bookingId,
            booking_number: booking.id,
            service: booking.service,
            base_amount: booking.baseAmount,
            discount_amount: booking.discountAmount,
            final_amount: booking.finalAmount,
            amountPaid: booking.amountPaid,
            dueHolderName: booking.dueHolderName,
          }}
          additionalBookings={[
            ...relatedBookings.map(rb => ({
              bookingId: rb.id,
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
