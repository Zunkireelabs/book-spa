import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, pointerWithin } from '@dnd-kit/core';
import Icon from '../../../../components/AppIcon';
import BookingActionModal from '../../../../components/ui/BookingActionModal';
import StatusLegend from '../../../../components/ui/StatusLegend';
import MiniMonthCalendar from './MiniMonthCalendar';
import CalendarGrid, { HOUR_HEIGHT } from './CalendarGrid';
import {
  getCalendarBookings,
  fetchBookingById,
  updateBookingStatus,
  assignTherapist,
  recordPayment,
  fetchAttendance,
  rescheduleBooking,
  fetchServices,
  createBooking,
  updateBookingDetails,
  updateTherapistOrder,
  updateRoomOrder,
} from '../../../../services/api';
import { transformBooking, toDbStatus } from '../../../../services/bookingTransformers';
import CustomSelect from '../../../../components/ui/CustomSelect';
import CustomerAutocomplete from '../../../../components/ui/CustomerAutocomplete';
import { useAuth } from '../../../../contexts/AuthContext';

// ── Helpers ──────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function formatDateTitle(dateStr, viewMode) {
  const d = new Date(dateStr + 'T00:00:00');
  if (viewMode === '4day') {
    const end = new Date(d);
    end.setDate(end.getDate() + 3);
    const startStr = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const endStr = end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    return `${startStr} – ${endStr}`;
  }
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function getDateRange(dateStr, viewMode) {
  if (viewMode === '4day') {
    return { start: dateStr, end: addDays(dateStr, 3) };
  }
  return { start: dateStr, end: dateStr };
}

function getStepDays(viewMode) {
  return viewMode === '4day' ? 4 : 1;
}

function formatTimeFromSlot(hour, minute) {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function calculateEndTime(startHour, startMinute, durationMinutes) {
  const totalMinutes = startHour * 60 + startMinute + (durationMinutes || 60);
  const endHour = Math.floor(totalMinutes / 60);
  const endMinute = totalMinutes % 60;
  return `${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}`;
}

function formatTimeDisplay(time) {
  if (!time) return '';
  // Convert HH:MM to display format
  const [h, m] = time.split(':').map(Number);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ── Quick Create Panel ────────────────────────────────────────

const QuickCreatePanel = ({ slotInfo, services, servicesLoading, therapists, rooms, bookings = [], onClose, onSubmit, branchId, branchHours }) => {
  const [serviceId, setServiceId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerGender, setCustomerGender] = useState('');
  const [specialRequests, setSpecialRequests] = useState('');
  const [selectedTherapistIds, setSelectedTherapistIds] = useState([]);
  const [roomId, setRoomId] = useState('');
  const [bookingDate, setBookingDate] = useState('');
  const [bookingTime, setBookingTime] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [therapistSearch, setTherapistSearch] = useState('');
  const [timeDropdownOpen, setTimeDropdownOpen] = useState(false);
  const nameRef = useRef(null);
  const timeDropdownRef = useRef(null);
  const timeListRef = useRef(null);

  const handleCustomerSelect = useCallback((customer) => {
    setCustomerName(customer.full_name);
    setCustomerPhone(customer.phone || '');
    setCustomerEmail(customer.email || '');
    setCustomerGender(customer.gender || '');
  }, []);

  // Reset form when slot changes + pre-select therapist/room from column
  useEffect(() => {
    setServiceId('');
    setCustomerName('');
    setCustomerPhone('');
    setCustomerEmail('');
    setCustomerGender('');
    setSpecialRequests('');
    setSelectedTherapistIds(slotInfo?.colType === 'therapist' && slotInfo.colId ? [slotInfo.colId] : []);
    setTherapistSearch('');
    setRoomId(slotInfo?.colType === 'room' ? slotInfo.colId : '');
    setBookingDate(slotInfo?.day || '');
    setBookingTime(slotInfo ? `${String(slotInfo.hour).padStart(2, '0')}:${String(slotInfo.minute).padStart(2, '0')}` : '');
    setError(null);
    setSubmitting(false);
  }, [slotInfo]);

  // Compute which therapists & rooms are busy during the selected time slot
  const selectedService = (services || []).find((s) => s.id === serviceId);
  // Parse room capacity from amenities (e.g., "3 Chair" → 3, "1 Bed" → 1)
  const getRoomCapacity = (room) => {
    if (!room.amenities || room.amenities.length === 0) return 1;
    const match = room.amenities[0].match(/^(\d+)/);
    return match ? parseInt(match[1], 10) : 1;
  };

  const busyResources = useMemo(() => {
    if (!bookingDate || !bookingTime) return { therapistIds: new Set(), roomBookingCounts: new Map() };
    const durationMin = selectedService?.duration_minutes || 60;
    const [sh, sm] = bookingTime.split(':').map(Number);
    const slotStart = sh * 60 + sm;
    const slotEnd = slotStart + durationMin;

    const busyTherapists = new Set();
    const roomBookingCounts = new Map();

    for (const b of bookings) {
      // calendarData.bookings uses raw DB format (snake_case)
      const status = (b.status || '').toLowerCase();
      if (['cancelled', 'no show', 'completed'].includes(status)) continue;
      if (b.date !== bookingDate) continue;

      // Raw DB: start_time = "HH:MM:SS", end_time = "HH:MM:SS"
      const startStr = b.start_time || '00:00:00';
      const endStr = b.end_time;
      const [bh, bm] = startStr.split(':').map(Number);
      const bStart = bh * 60 + bm;

      let bEnd;
      if (endStr) {
        const [eh, em] = endStr.split(':').map(Number);
        bEnd = eh * 60 + em;
      } else {
        // Fallback: use service duration
        const svc = (services || []).find((s) => s.id === b.service_id);
        bEnd = bStart + (svc?.duration_minutes || 60);
      }

      // Check time overlap: new booking [slotStart, slotEnd) overlaps [bStart, bEnd)
      if (slotStart < bEnd && slotEnd > bStart) {
        // Mark all therapists (from junction table or primary) as busy
        if (b.booking_therapists?.length > 0) {
          b.booking_therapists.forEach(bt => busyTherapists.add(bt.therapist_id));
        } else if (b.therapist_id) {
          busyTherapists.add(b.therapist_id);
        }
        if (b.room_id) roomBookingCounts.set(b.room_id, (roomBookingCounts.get(b.room_id) || 0) + 1);
      }
    }

    return { therapistIds: busyTherapists, roomBookingCounts };
  }, [bookings, bookingDate, bookingTime, selectedService, services]);

  // Autofocus name field when panel opens
  useEffect(() => {
    if (slotInfo && nameRef.current) {
      const timer = setTimeout(() => nameRef.current?.focus(), 350);
      return () => clearTimeout(timer);
    }
  }, [slotInfo]);

  const timeOptions = useMemo(() => {
    const [openH] = (branchHours?.openTime || '09:00:00').split(':').map(Number);
    const [closeH, closeM] = (branchHours?.closeTime || '21:00:00').split(':').map(Number);
    const opts = [];
    for (let h = openH; h <= closeH; h++) {
      for (let m = 0; m < 60; m += 15) {
        if (h === closeH && m > closeM) break;
        const val = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        opts.push(val);
      }
    }
    // Include current bookingTime if it doesn't match a 15-min slot
    if (bookingTime && !opts.includes(bookingTime)) {
      opts.push(bookingTime);
      opts.sort();
    }
    return opts;
  }, [branchHours, bookingTime]);

  const format12h = (time24) => {
    const [h, m] = time24.split(':').map(Number);
    const suffix = h >= 12 ? 'pm' : 'am';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}:${String(m).padStart(2, '0')}${suffix}`;
  };

  // Close time dropdown on outside click
  useEffect(() => {
    if (!timeDropdownOpen) return;
    const handleClick = (e) => {
      if (timeDropdownRef.current && !timeDropdownRef.current.contains(e.target)) {
        setTimeDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [timeDropdownOpen]);

  // Auto-scroll to selected time when dropdown opens
  useEffect(() => {
    if (timeDropdownOpen && timeListRef.current) {
      const selected = timeListRef.current.querySelector('[data-selected="true"]');
      if (selected) selected.scrollIntoView({ block: 'center' });
    }
  }, [timeDropdownOpen]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!serviceId || !customerName.trim()) return;
    setSubmitting(true);
    setError(null);
    const err = await onSubmit({
      serviceId,
      customerName: customerName.trim(),
      customerPhone: customerPhone.replace(/\D/g, '') || null,
      customerEmail: customerEmail.trim() || null,
      customerGender: customerGender || null,
      specialRequests: specialRequests.trim() || null,
      therapistIds: selectedTherapistIds.length > 0 ? selectedTherapistIds : null,
      roomId: roomId || null,
      bookingDate,
      bookingTime,
    });
    if (err) {
      setError(err);
      setSubmitting(false);
    }
  };

  const isOpen = !!slotInfo;

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-text-primary/20 z-sidebar transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />
      {/* Panel */}
      <div
        className={`fixed top-0 right-0 h-full w-[400px] z-modal bg-surface border-l border-border shadow-2xl flex flex-col transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-background/50">
          <div className="flex items-center gap-2">
            <Icon name="CalendarPlus" size={20} className="text-primary" />
            <h3 className="font-heading font-heading-semibold text-base text-text-primary">Quick Booking</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-spa hover:bg-background spa-transition-fast">
            <Icon name="X" size={18} className="text-text-secondary" />
          </button>
        </div>

        {/* Context banner */}
        {slotInfo && (
          <div className="px-5 py-3 bg-primary/5 border-b border-border">
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-1.5">
                <Icon name="Calendar" size={14} className="text-primary" />
                <input
                  type="date"
                  value={bookingDate}
                  onChange={(e) => setBookingDate(e.target.value)}
                  className="font-body font-body-medium text-sm text-text-primary bg-transparent border border-border rounded-spa px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div className="relative flex items-center gap-1.5" ref={timeDropdownRef}>
                <Icon name="Clock" size={14} className="text-primary" />
                <input
                  type="text"
                  value={bookingTime ? format12h(bookingTime) : ''}
                  onChange={(e) => {
                    // Parse manual time input (HH:MM, H:MM AM/PM formats)
                    const raw = e.target.value;
                    const match24 = raw.match(/^(\d{1,2}):(\d{2})$/);
                    const matchAmPm = raw.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
                    if (match24) {
                      const h = parseInt(match24[1]), m = parseInt(match24[2]);
                      if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
                        setBookingTime(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`);
                      }
                    } else if (matchAmPm) {
                      let h = parseInt(matchAmPm[1]);
                      const m = parseInt(matchAmPm[2]);
                      const pm = matchAmPm[3].toLowerCase() === 'pm';
                      if (pm && h < 12) h += 12;
                      if (!pm && h === 12) h = 0;
                      if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
                        setBookingTime(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`);
                      }
                    }
                  }}
                  onFocus={(e) => { e.target.select(); setTimeDropdownOpen(true); }}
                  placeholder="--:--"
                  autoComplete="off"
                  className="font-body font-body-medium text-sm text-text-primary bg-transparent border border-border rounded-spa px-2 py-0.5 w-20 focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <button
                  type="button"
                  onClick={() => setTimeDropdownOpen((v) => !v)}
                  className="text-text-secondary hover:text-primary transition-colors"
                >
                  <Icon name="ChevronDown" size={14} />
                </button>
                {timeDropdownOpen && (
                  <div
                    ref={timeListRef}
                    className="absolute top-full left-0 mt-1 w-28 max-h-48 overflow-y-auto bg-surface border border-border rounded-spa shadow-spa-elevated z-dropdown"
                  >
                    {timeOptions.map((t) => (
                      <button
                        key={t}
                        type="button"
                        data-selected={t === bookingTime}
                        onClick={() => { setBookingTime(t); setTimeDropdownOpen(false); }}
                        className={`w-full text-left px-3 py-1.5 text-sm font-body cursor-pointer hover:bg-primary/10 ${t === bookingTime ? 'bg-primary/10 font-body-medium text-primary' : 'text-text-primary'}`}
                      >
                        {format12h(t)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1.5 mt-1.5">
              <Icon name={slotInfo.colType === 'room' ? 'DoorOpen' : slotInfo.colType === 'therapist' ? 'User' : 'LayoutGrid'} size={14} className="text-text-secondary" />
              <span className="font-body text-sm text-text-secondary">{slotInfo.colName}</span>
            </div>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-y-auto">
          <div className="px-5 py-4 space-y-4 flex-1">
            {/* Service */}
            <div>
              <label className="block font-body font-body-medium text-sm text-text-primary mb-1.5">
                Service <span className="text-error">*</span>
              </label>
              {servicesLoading ? (
                <div className="flex items-center gap-2 py-2">
                  <div className="animate-spin w-4 h-4 border-2 border-primary border-t-transparent rounded-full" />
                  <span className="text-sm text-text-secondary">Loading services...</span>
                </div>
              ) : (
                <CustomSelect
                  value={serviceId}
                  onChange={(val) => setServiceId(val)}
                  options={[
                    { value: '', label: 'Select a service' },
                    ...(services || []).map((s) => ({
                      value: s.id,
                      label: `${s.name} — ${s.duration_minutes}min — Rs.${s.price_npr}`,
                    })),
                  ]}
                  placeholder="Select a service"
                  size="md"
                  searchable
                />
              )}
            </div>

            {/* Room */}
            {rooms && rooms.length > 0 && (
              <div>
                <label className="block font-body font-body-medium text-sm text-text-primary mb-1.5">
                  Room
                </label>
                <CustomSelect
                  value={roomId}
                  onChange={(val) => {
                    const room = (rooms || []).find(r => r.id === val);
                    if (room) {
                      const capacity = getRoomCapacity(room);
                      const used = busyResources.roomBookingCounts.get(val) || 0;
                      if (used >= capacity) return; // fully packed, block selection
                    }
                    setRoomId(val);
                  }}
                  options={[
                    { value: '', label: 'No room' },
                    ...(rooms || []).map((r) => {
                      const capacity = getRoomCapacity(r);
                      const used = busyResources.roomBookingCounts.get(r.id) || 0;
                      const remaining = capacity - used;
                      const amenityStr = r.amenities?.join(', ') || '';
                      const isFull = used >= capacity;

                      let statusLabel;
                      if (isFull) {
                        statusLabel = <span className="text-error font-bold">— Unavailable</span>;
                      } else if (used > 0 && capacity > 1) {
                        statusLabel = <span className="text-warning font-bold">— {remaining} left</span>;
                      } else if (used > 0) {
                        statusLabel = <span className="text-warning font-bold">— Allocated</span>;
                      }

                      return {
                        value: r.id,
                        label: (
                          <>
                            {r.name}
                            {amenityStr && <span className="text-text-secondary"> ({amenityStr})</span>}
                            {statusLabel && <> {statusLabel}</>}
                          </>
                        ),
                        searchLabel: r.name,
                        disabled: isFull,
                      };
                    }),
                  ]}
                  placeholder="No room"
                  size="md"
                  searchable
                />
              </div>
            )}

            {/* Therapist(s) */}
            <div>
              <label className="block font-body font-body-medium text-sm text-text-primary mb-1.5">
                Therapist{selectedTherapistIds.length > 1 ? 's' : ''}
                {selectedTherapistIds.length > 0 && (
                  <span className="ml-2 text-xs text-text-secondary font-normal">({selectedTherapistIds.length} selected)</span>
                )}
              </label>
              <div className="border border-border rounded-spa bg-background overflow-hidden">
                <div className="relative px-2 pt-2">
                  <Icon name="Search" size={14} className="absolute left-4 top-1/2 mt-1 -translate-y-1/2 text-text-secondary" />
                  <input
                    type="text"
                    value={therapistSearch}
                    onChange={(e) => setTherapistSearch(e.target.value)}
                    placeholder="Search therapists..."
                    className="w-full pl-7 pr-3 py-1.5 bg-surface border border-border rounded text-sm focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                  />
                </div>
                <div className="space-y-1 max-h-[140px] overflow-y-auto p-2">
                  {(therapists || [])
                    .filter(t => {
                      if (!therapistSearch.trim()) return true;
                      const name = (t.full_name || t.name).toLowerCase();
                      return name.includes(therapistSearch.toLowerCase());
                    })
                    .map((t) => {
                      const isBusy = busyResources.therapistIds.has(t.id);
                      const isChecked = selectedTherapistIds.includes(t.id);
                      const name = t.full_name || t.name;
                      return (
                        <label key={t.id} className={`flex items-center gap-2.5 px-2 py-1.5 rounded cursor-pointer hover:bg-primary/5 ${isChecked ? 'bg-primary/5' : ''}`}>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedTherapistIds(prev => [...prev, t.id]);
                              } else {
                                setSelectedTherapistIds(prev => prev.filter(id => id !== t.id));
                              }
                            }}
                            className="text-primary focus:ring-primary w-3.5 h-3.5 rounded"
                          />
                          <span className="font-body text-sm text-text-primary truncate">
                            {name}
                            {isBusy && <span className="text-warning font-bold"> — Assigned</span>}
                          </span>
                        </label>
                      );
                    })}
                </div>
              </div>
            </div>

            {/* Customer name */}
            <div>
              <label className="block font-body font-body-medium text-sm text-text-primary mb-1.5">
                Customer Name <span className="text-error">*</span>
              </label>
              <CustomerAutocomplete
                value={customerName}
                onChange={setCustomerName}
                onSelect={handleCustomerSelect}
                branchId={branchId}
                inputRef={nameRef}
              />
            </div>

            {/* Phone */}
            <div>
              <label className="block font-body font-body-medium text-sm text-text-primary mb-1.5">
                Phone
              </label>
              <div className="flex">
                <span className="inline-flex items-center px-3 py-2 text-sm border border-r-0 border-border rounded-l-spa bg-background text-text-secondary">
                  +977
                </span>
                <CustomerAutocomplete
                  value={customerPhone}
                  onChange={setCustomerPhone}
                  onSelect={handleCustomerSelect}
                  branchId={branchId}
                  searchBy="phone"
                  inputClassName="flex-1 px-3 py-2 text-sm border border-border rounded-r-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
              </div>
            </div>

            {/* Email */}
            <div>
              <label className="block font-body font-body-medium text-sm text-text-primary mb-1.5">
                Email
              </label>
              <input
                type="email"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                placeholder="customer@email.com"
                className="w-full px-3 py-2 text-sm border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
            </div>

            {/* Gender */}
            <div>
              <label className="block font-body font-body-medium text-sm text-text-primary mb-1.5">
                Gender
              </label>
              <div className="flex gap-2">
                {['Male', 'Female'].map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setCustomerGender(customerGender === g.toLowerCase() ? '' : g.toLowerCase())}
                    className={`px-4 py-2 text-sm border rounded-spa transition-colors ${
                      customerGender === g.toLowerCase()
                        ? 'border-primary bg-primary/10 text-primary font-medium'
                        : 'border-border bg-surface text-text-secondary hover:bg-background'
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>

            {/* Special requests */}
            <div>
              <label className="block font-body font-body-medium text-sm text-text-primary mb-1.5">
                Special Requests
              </label>
              <textarea
                value={specialRequests}
                onChange={(e) => setSpecialRequests(e.target.value)}
                placeholder="Any special requests or notes..."
                rows={3}
                className="w-full px-3 py-2 text-sm border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-none"
              />
            </div>

            {/* Error display */}
            {error && (
              <div className="flex items-start gap-2 p-3 bg-error/10 border border-error/20 rounded-spa">
                <Icon name="AlertCircle" size={16} className="text-error mt-0.5 flex-shrink-0" />
                <span className="font-body text-sm text-error">{error}</span>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-5 py-4 border-t border-border bg-background/50 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-body font-body-medium border border-border rounded-spa hover:bg-background spa-transition-fast"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !serviceId || !customerName.trim()}
              className="px-4 py-2 text-sm font-body font-body-medium bg-primary text-white rounded-spa hover:bg-primary/90 spa-transition-fast disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {submitting && <div className="animate-spin w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full" />}
              {submitting ? 'Creating...' : 'Create Booking'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
};

// ── Component ────────────────────────────────────────────────

const OperationalCalendar = ({ branchId, heightOffset = 100 }) => {
  // Industry-specific labels from auth context
  const { profile } = useAuth();
  const industry = profile?.organizations?.industries;
  const staffLabel = industry?.staff_label || 'Therapist';
  const staffLabelPlural = industry?.staff_label_plural || 'Therapists';
  const locationLabel = industry?.location_label || 'Room';
  const locationLabelPlural = industry?.location_label_plural || 'Rooms';
  const enableRooms = industry?.enable_rooms !== false;

  // View state
  const [currentDate, setCurrentDate] = useState(todayStr());
  const [viewMode, setViewMode] = useState('day'); // day | 4day
  // Default to staff view if rooms are disabled
  const [columnMode, setColumnMode] = useState('therapist'); // therapist | room
  const [freezeUnassigned, setFreezeUnassigned] = useState(true);
  const [showServiceOnly, setShowServiceOnly] = useState(true);
  const [selectedPositions, setSelectedPositions] = useState([]); // empty = all
  const [positionDropdownOpen, setPositionDropdownOpen] = useState(false);
  const positionDropdownRef = useRef(null);

  // Calendar data state
  const [calendarData, setCalendarData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Available position options for filter (from service staff only)
  const calendarPositionOptions = useMemo(() => {
    if (!calendarData?.therapists) return [];
    const positions = new Set();
    calendarData.therapists.forEach(t => {
      if (t.is_service_staff !== false && t.position) {
        t.position.split('/').forEach(p => positions.add(p.trim()));
      }
    });
    return Array.from(positions).sort();
  }, [calendarData?.therapists]);

  // Filter therapists for calendar display
  const filteredTherapists = useMemo(() => {
    if (!calendarData?.therapists) return [];
    let list = calendarData.therapists;
    if (showServiceOnly) {
      list = list.filter(t => t.is_service_staff !== false);
    }
    if (selectedPositions.length > 0) {
      list = list.filter(t => t.position && t.position.split('/').some(p => selectedPositions.includes(p.trim())));
    }
    return list;
  }, [calendarData?.therapists, showServiceOnly, selectedPositions]);

  // Close position dropdown on outside click
  useEffect(() => {
    if (!positionDropdownOpen) return;
    const handle = (e) => {
      if (positionDropdownRef.current && !positionDropdownRef.current.contains(e.target)) setPositionDropdownOpen(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [positionDropdownOpen]);

  // Attendance indicators
  const [attendanceMap, setAttendanceMap] = useState({});

  // Modal state
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);
  const [actionToast, setActionToast] = useState(null);

  // Drag state
  const [activeDragId, setActiveDragId] = useState(null);
  const [activeDragBooking, setActiveDragBooking] = useState(null);
  const [overSlotData, setOverSlotData] = useState(null); // { hour, minute, day }
  const [isRescheduling, setIsRescheduling] = useState(false);
  const [dragGrabOffset, setDragGrabOffset] = useState(0); // Y offset from card top where user grabbed

  // Cross-column reassignment confirmation
  // Shape: { booking, bookingId, newDate, newStartTime, newEndTime, targetColId, targetColName, sourceColName, type: 'therapist'|'room', durationMinutes }
  const [pendingReassign, setPendingReassign] = useState(null);

  // Quick-create panel state
  const [quickCreateSlot, setQuickCreateSlot] = useState(null);
  const [servicesCache, setServicesCache] = useState(null);
  const [servicesLoading, setServicesLoading] = useState(false);

  // Rebook "pick and place" mode
  // Shape: { booking, customerName, customerPhone, serviceId, serviceName, duration }
  const [rebookSource, setRebookSource] = useState(null);
  const [rebookFallback, setRebookFallback] = useState(false);

  // Ref to the grid body for calculating time from cursor position
  const gridRef = useRef(null);

  // Rebook floating card — mouse tracking
  const rebookCardRef = useRef(null);
  const rebookOverGrid = useRef(false);

  useEffect(() => {
    if (!rebookSource) return;

    const handleMouseMove = (e) => {
      const card = rebookCardRef.current;
      if (!card) return;

      // Check if cursor is over the calendar grid
      const grid = gridRef.current;
      if (grid) {
        const rect = grid.getBoundingClientRect();
        const isOver = e.clientX >= rect.left && e.clientX <= rect.right &&
                       e.clientY >= rect.top && e.clientY <= rect.bottom;
        rebookOverGrid.current = isOver;
        card.style.opacity = isOver ? '0.95' : '0.5';
      }

      card.style.left = `${e.clientX + 12}px`;
      card.style.top = `${e.clientY - 20}px`;
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && rebookSource) {
        // Reopen modal with rebook inline form
        setSelectedBooking(rebookSource.booking);
        setModalOpen(true);
        setRebookFallback(true);
        setRebookSource(null);
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [rebookSource]);

  // Configure drag sensors with activation constraints
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        // Require 5px movement or 150ms delay before drag starts
        // This prevents accidental drags and allows clicks to work
        distance: 5,
      },
    })
  );

  // ── Data fetching ──────────────────────────────────────────

  const fetchData = useCallback(async (startDate, endDate) => {
    if (!branchId || !startDate || !endDate) return;

    setLoading(true);
    setError(null);

    const [result, attResult] = await Promise.all([
      getCalendarBookings(branchId, startDate, endDate),
      fetchAttendance({ branchId, date: startDate }),
    ]);

    if (result.error) {
      setError(result.error.message || 'Failed to load calendar data.');
      setLoading(false);
      return;
    }

    setCalendarData(result.data);

    const attMap = {};
    if (attResult.data) {
      for (const a of attResult.data) {
        if (a.status === 'Absent' || a.status === 'Leave') {
          attMap[a.therapistId] = a.status;
        }
      }
    }
    setAttendanceMap(attMap);
    setLoading(false);
  }, [branchId]);

  // Reload when date or view changes
  useEffect(() => {
    if (!branchId) return;
    const { start, end } = getDateRange(currentDate, viewMode);
    fetchData(start, end);
  }, [branchId, currentDate, viewMode, fetchData]);

  const refreshCalendar = useCallback(() => {
    const { start, end } = getDateRange(currentDate, viewMode);
    fetchData(start, end);
  }, [currentDate, viewMode, fetchData]);

  // ── Navigation ─────────────────────────────────────────────

  const goToday = () => setCurrentDate(todayStr());
  const goPrev = () => setCurrentDate(addDays(currentDate, -getStepDays(viewMode)));
  const goNext = () => setCurrentDate(addDays(currentDate, getStepDays(viewMode)));

  // Ref to track current pointer Y position during drag (synchronous updates)
  const pointerYRef = useRef(null);

  // Track pointer position during drag
  useEffect(() => {
    if (!activeDragId) {
      pointerYRef.current = null;
      return;
    }

    const handlePointerMove = (e) => {
      pointerYRef.current = e.clientY;
    };

    document.addEventListener('pointermove', handlePointerMove);
    return () => document.removeEventListener('pointermove', handlePointerMove);
  }, [activeDragId]);

  // Calculate time slot from pointer Y position
  const calculateTimeFromPointer = useCallback((overData) => {
    if (!overData || !gridRef.current || pointerYRef.current === null) {
      return null;
    }

    const { day, colId, openHour } = overData;
    const gridRect = gridRef.current.getBoundingClientRect();

    // Get cursor position relative to the grid body element
    // Subtract dragGrabOffset so the card's TOP edge aligns with the time slot
    // (not the cursor position which could be anywhere on the card)
    const relativeY = pointerYRef.current - gridRect.top - dragGrabOffset;

    // Calculate hour and minute from Y position
    const minutesFromTop = (relativeY / HOUR_HEIGHT) * 60;
    const hour = Math.floor(minutesFromTop / 60) + openHour;
    const rawMinute = minutesFromTop % 60;
    const minute = Math.floor(rawMinute / 5) * 5; // Round to 5-minute intervals

    // Clamp to valid hours
    if (hour < openHour || minute < 0) {
      return { day, colId, hour: openHour, minute: 0 };
    }

    return { day, colId, hour, minute };
  }, [dragGrabOffset]);

  // ── Drag and Drop Handlers ────────────────────────────────

  const handleDragStart = useCallback((event) => {
    const { active, activatorEvent } = event;
    setActiveDragId(active.id);

    const booking = active.data.current?.booking;
    if (booking) {
      setActiveDragBooking(booking);
    }

    // Calculate how far down the card the user grabbed
    // This offset is used to align the card's TOP edge with the time slot
    const cursorY = activatorEvent?.clientY ?? 0;

    // Calculate expected card top position based on booking's start time
    // This is more reliable than trying to get the DOM element's position
    if (booking?.startTime && gridRef.current) {
      const gridRect = gridRef.current.getBoundingClientRect();
      const openHour = parseInt(gridRef.current.dataset?.openHour || '9', 10);
      const hourHeight = parseInt(gridRef.current.dataset?.hourHeight || '120', 10);

      const [bookingHour, bookingMinute] = booking.startTime.split(':').map(Number);
      const minutesFromOpen = (bookingHour - openHour) * 60 + bookingMinute;
      const expectedCardTop = gridRect.top + (minutesFromOpen / 60) * hourHeight;

      const grabOffset = cursorY - expectedCardTop;
      setDragGrabOffset(grabOffset);
    } else {
      setDragGrabOffset(0);
    }
  }, []);

  // Called on every mouse move during drag - calculates time from position
  const handleDragMove = useCallback((event) => {
    const { over } = event;
    if (!over?.data?.current) {
      setOverSlotData(null);
      return;
    }

    const timeData = calculateTimeFromPointer(over.data.current);
    if (timeData) {
      setOverSlotData(timeData);
    }
  }, [calculateTimeFromPointer]);

  // Called when hovering over a new droppable (less frequent than dragMove)
  const handleDragOver = useCallback((event) => {
    const { over } = event;
    if (!over?.data?.current) {
      setOverSlotData(null);
      return;
    }

    const timeData = calculateTimeFromPointer(over.data.current);
    if (timeData) {
      setOverSlotData(timeData);
    }
  }, [calculateTimeFromPointer]);

  // Build column name lookup maps for confirmation dialog
  const colNameMap = useMemo(() => {
    const map = { unassigned: 'Unassigned' };
    if (calendarData?.therapists) {
      for (const t of calendarData.therapists) map[t.id] = t.name;
    }
    if (calendarData?.rooms) {
      for (const r of calendarData.rooms) map[r.id] = r.name;
    }
    return map;
  }, [calendarData]);

  const handleDragEnd = useCallback((event) => {
    const { active, over } = event;

    // Capture final position before clearing state
    const finalTimeData = over?.data?.current ? calculateTimeFromPointer(over.data.current) : null;

    // If not dropped on a valid target, just clear state
    if (!over || !active.data.current?.booking || !finalTimeData) {
      setActiveDragId(null);
      setActiveDragBooking(null);
      setOverSlotData(null);
      setDragGrabOffset(0);
      return;
    }

    const booking = active.data.current.booking;
    const { day: newDate, colId: targetColId, hour, minute } = finalTimeData;

    if (hour === undefined || minute === undefined) {
      setActiveDragId(null);
      setActiveDragBooking(null);
      setOverSlotData(null);
      setDragGrabOffset(0);
      return;
    }

    const newStartTime = formatTimeFromSlot(hour, minute);
    const bookingId = booking.bookingId || booking.id;

    // Determine source column based on column mode
    const sourceColId = columnMode === 'therapist'
      ? (booking.therapistId || 'unassigned')
      : (booking.roomId || 'unassigned');
    const effectiveTargetColId = targetColId || 'unassigned';

    const isCrossColumn = sourceColId !== effectiveTargetColId;

    // Check if anything actually changed
    const oldTime = booking.startTime?.slice(0, 5);
    const oldDate = booking.date;
    if (oldTime === newStartTime && oldDate === newDate && !isCrossColumn) {
      setActiveDragId(null);
      setActiveDragBooking(null);
      setOverSlotData(null);
      setDragGrabOffset(0);
      return; // No change
    }

    // Calculate new end time
    const durationMinutes = booking.serviceDuration ||
      (booking.startTime && booking.endTime
        ? (() => {
            const [sh, sm] = booking.startTime.split(':').map(Number);
            const [eh, em] = booking.endTime.split(':').map(Number);
            return (eh * 60 + em) - (sh * 60 + sm);
          })()
        : 60);
    const newEndTime = calculateEndTime(hour, minute, durationMinutes);

    // Clear drag state
    setActiveDragId(null);
    setActiveDragBooking(null);
    setOverSlotData(null);
    setDragGrabOffset(0);

    if (isCrossColumn) {
      // Cross-column drop → show confirmation dialog
      setPendingReassign({
        booking,
        bookingId,
        newDate,
        newStartTime,
        newEndTime,
        durationMinutes,
        targetColId: effectiveTargetColId,
        sourceColId,
        targetColName: colNameMap[effectiveTargetColId] || effectiveTargetColId,
        sourceColName: colNameMap[sourceColId] || sourceColId,
        type: columnMode,
        timeChanged: oldTime !== newStartTime || oldDate !== newDate,
      });
    } else {
      // Same column — time-only reschedule, show confirmation dialog
      setPendingReassign({
        booking,
        bookingId,
        newDate,
        newStartTime,
        newEndTime,
        durationMinutes,
        targetColId: effectiveTargetColId,
        sourceColId,
        targetColName: colNameMap[effectiveTargetColId] || effectiveTargetColId,
        sourceColName: colNameMap[sourceColId] || sourceColId,
        type: columnMode,
        timeChanged: true,
        timeOnly: true,
      });
    }
  }, [refreshCalendar, calculateTimeFromPointer, columnMode, colNameMap]);

  // Execute reschedule with optimistic update (time-only, no column change)
  const executeReschedule = useCallback(async ({ bookingId, newDate, newStartTime, newEndTime, durationMinutes }) => {
    // Optimistic UI update
    setCalendarData(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        bookings: prev.bookings.map(b => {
          if (b.id === bookingId) {
            return { ...b, date: newDate, start_time: newStartTime, end_time: newEndTime };
          }
          return b;
        }),
      };
    });

    setIsRescheduling(true);
    try {
      const result = await rescheduleBooking({ bookingId, newDate, newStartTime });
      if (result.error) {
        showToast(result.error.message || 'Failed to reschedule booking.', 'error');
        refreshCalendar();
      } else {
        showToast(`Rescheduled to ${newStartTime}`, 'success');
      }
    } catch (err) {
      showToast('An error occurred while rescheduling.', 'error');
      refreshCalendar();
    } finally {
      setIsRescheduling(false);
    }
  }, [refreshCalendar]);

  // Handle cross-column reassignment confirmation
  const handleConfirmReassign = useCallback(async () => {
    if (!pendingReassign) return;

    const { bookingId, newDate, newStartTime, newEndTime, targetColId, type, targetColName, timeOnly } = pendingReassign;

    // Build API params
    const apiParams = { bookingId, newDate, newStartTime };
    const optimisticFields = { date: newDate, start_time: newStartTime, end_time: newEndTime };

    if (!timeOnly) {
      if (type === 'therapist') {
        const therapistVal = targetColId === 'unassigned' ? null : targetColId;
        apiParams.newTherapistId = targetColId === 'unassigned' ? 'unassigned' : targetColId;
        optimisticFields.therapist_id = therapistVal;
      } else {
        const roomVal = targetColId === 'unassigned' ? null : targetColId;
        apiParams.newRoomId = targetColId === 'unassigned' ? 'unassigned' : targetColId;
        optimisticFields.room_id = roomVal;
      }
    }

    // Optimistic UI update
    setCalendarData(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        bookings: prev.bookings.map(b => {
          if (b.id === bookingId) {
            return { ...b, ...optimisticFields };
          }
          return b;
        }),
      };
    });

    setPendingReassign(null);
    setIsRescheduling(true);

    try {
      const result = await rescheduleBooking(apiParams);
      if (result.error) {
        showToast(result.error.message || 'Failed to reassign booking.', 'error');
        refreshCalendar();
      } else {
        showToast(timeOnly ? `Rescheduled to ${newStartTime}` : `Reassigned to ${targetColName}`, 'success');
      }
    } catch (err) {
      showToast('An error occurred while reassigning.', 'error');
      refreshCalendar();
    } finally {
      setIsRescheduling(false);
    }
  }, [pendingReassign, refreshCalendar]);

  const handleDragCancel = useCallback(() => {
    setActiveDragId(null);
    setActiveDragBooking(null);
    setOverSlotData(null);
    setDragGrabOffset(0);
  }, []);

  // ── Quick-create handlers ──────────────────────────────────

  const handleEmptySlotClick = useCallback(async (slotInfo) => {
    // Rebook mode — place booking at clicked slot
    if (rebookSource) {
      // Capture and immediately clear to prevent double-click duplicates
      const source = rebookSource;
      setRebookSource(null);

      const startTime = `${String(slotInfo.hour).padStart(2, '0')}:${String(slotInfo.minute).padStart(2, '0')}`;
      const therapistId = slotInfo.colType === 'therapist' ? slotInfo.colId : null;
      const roomId = slotInfo.colType === 'room' ? slotInfo.colId : null;
      const result = await createBooking({
        branchId,
        serviceId: source.serviceId,
        date: slotInfo.day,
        startTime,
        customerName: source.customerName,
        customerPhone: source.customerPhone,
        therapistId,
        roomId,
      });
      if (result.error) {
        showToast(result.error.message || 'Failed to rebook.', 'error');
        // Restore rebook mode on failure so user can retry
        setRebookSource(source);
      } else {
        showToast('Rebooked successfully — payment will be collected at the new appointment.');
        refreshCalendar();
      }
      return;
    }

    // Normal flow — open QuickCreatePanel
    setQuickCreateSlot(slotInfo);
    if (!servicesCache && !servicesLoading) {
      setServicesLoading(true);
      const result = await fetchServices();
      if (result.data) setServicesCache(result.data);
      setServicesLoading(false);
    }
  }, [servicesCache, servicesLoading, rebookSource, branchId, refreshCalendar]);

  const handleQuickCreateClose = useCallback(() => {
    setQuickCreateSlot(null);
  }, []);

  const handleQuickCreateSubmit = useCallback(async (formData) => {
    if (!branchId) return 'Missing branch info.';
    const date = formData.bookingDate;
    const startTime = formData.bookingTime;
    if (!date || !startTime) return 'Date and time are required.';
    const result = await createBooking({
      branchId,
      serviceId: formData.serviceId,
      date,
      startTime,
      customerName: formData.customerName,
      customerPhone: formData.customerPhone,
      customerEmail: formData.customerEmail,
      customerGender: formData.customerGender,
      specialRequests: formData.specialRequests,
      therapistId: formData.therapistId,
      roomId: formData.roomId,
    });
    if (result.error) {
      return result.error.message || 'Failed to create booking.';
    }
    showToast('Booking created successfully');
    setQuickCreateSlot(null);
    refreshCalendar();
    return null;
  }, [branchId, refreshCalendar]);

  // ── Rebook "pick and place" handlers ───────────────────────

  const handleRebookStart = useCallback((booking) => {
    setRebookSource({
      booking,
      customerName: booking.customerName,
      customerPhone: booking.customerPhone,
      serviceId: booking.serviceId,
      serviceName: booking.service,
      duration: booking.duration,
    });
    setModalOpen(false);
    setSelectedBooking(null);
  }, []);

  const handleRebookCancel = useCallback(() => setRebookSource(null), []);

  // ── Event click → modal ────────────────────────────────────

  const handleBookingClick = useCallback(async (booking) => {
    const bookingId = booking.bookingId || booking.id;
    if (!bookingId) return;

    setModalLoading(true);
    setModalOpen(true);

    const result = await fetchBookingById(bookingId);

    if (result.error) {
      setModalOpen(false);
      setModalLoading(false);
      showToast(result.error.message || 'Failed to load booking.', 'error');
      return;
    }

    setSelectedBooking(transformBooking(result.data));
    setModalLoading(false);

    // Pre-fetch services for "Add Another Service" / edit mode
    if (!servicesCache && !servicesLoading) {
      setServicesLoading(true);
      const svcResult = await fetchServices();
      if (svcResult.data) setServicesCache(svcResult.data);
      setServicesLoading(false);
    }
  }, [servicesCache, servicesLoading]);

  const handleModalClose = useCallback(() => {
    setModalOpen(false);
    setSelectedBooking(null);
    setRebookFallback(false);
    refreshCalendar();
  }, [refreshCalendar]);

  // ── Action handlers ────────────────────────────────────────

  const showToast = (msg, type = 'success') => {
    setActionToast({ msg, type });
    setTimeout(() => setActionToast(null), 3000);
  };

  const handleStatusUpdate = async (bookingId, newStatus) => {
    const dbStatus = toDbStatus(newStatus);
    const result = await updateBookingStatus({ bookingId, newStatus: dbStatus });
    if (result.error) {
      showToast(result.error.message || 'Failed to update status.', 'error');
      return;
    }
    showToast(`Status updated to ${newStatus}`);
  };

  const handleAssignTherapist = async (bookingId, therapistIds, notes, roomId) => {
    const ids = Array.isArray(therapistIds) ? therapistIds : (therapistIds ? [therapistIds] : []);
    const result = await assignTherapist({ bookingId, therapistIds: ids, roomId: roomId !== undefined ? (roomId || null) : undefined });
    if (result.error) {
      showToast(result.error.message || `Failed to assign ${staffLabel.toLowerCase()}.`, 'error');
      return;
    }
    showToast('Assignment saved successfully');
  };

  const handleEditBooking = async (bookingId, updates) => {
    const result = await updateBookingDetails({ bookingId, ...updates });
    if (result.error) {
      showToast(result.error.message || 'Failed to update booking.', 'error');
      return { error: result.error };
    }
    showToast('Booking updated successfully');
    // Re-fetch the booking to update modal data
    const refreshed = await fetchBookingById(bookingId);
    if (!refreshed.error) {
      setSelectedBooking(transformBooking(refreshed.data));
    }
    refreshCalendar();
    return { error: null };
  };

  const handleRecordPayment = async (bookingId, { paymentMode, notes }) => {
    const result = await recordPayment({ bookingId, paymentMode, notes });
    if (result.error) {
      return { error: result.error };
    }
    showToast('Payment recorded successfully');
    return { error: null };
  };

  // ── Therapist column reorder ─────────────────────────────────
  const canReorderTherapists = ['manager', 'admin'].includes(profile?.role);

  const handleTherapistReorder = useCallback(async (orderedIds) => {
    if (!branchId) return;
    // Optimistic: reorder therapists array in local state
    setCalendarData(prev => {
      if (!prev) return prev;
      const therapistMap = {};
      prev.therapists.forEach(t => { therapistMap[t.id] = t; });
      const reordered = orderedIds
        .map(id => therapistMap[id])
        .filter(Boolean);
      // Append any therapists not in orderedIds (safety)
      prev.therapists.forEach(t => {
        if (!orderedIds.includes(t.id)) reordered.push(t);
      });
      return { ...prev, therapists: reordered };
    });

    // Persist to DB
    const { error } = await updateTherapistOrder({ branchId, orderedIds });
    if (error) {
      console.error('[Calendar] Failed to persist therapist order:', error.message);
      refreshCalendar();
    }
  }, [branchId, refreshCalendar]);

  // ── Room column reorder ───────────────────────────────────
  const handleRoomReorder = useCallback(async (orderedIds) => {
    if (!branchId) return;
    // Optimistic: reorder rooms array in local state
    setCalendarData(prev => {
      if (!prev) return prev;
      const roomMap = {};
      prev.rooms.forEach(r => { roomMap[r.id] = r; });
      const reordered = orderedIds
        .map(id => roomMap[id])
        .filter(Boolean);
      // Append any rooms not in orderedIds (safety)
      prev.rooms.forEach(r => {
        if (!orderedIds.includes(r.id)) reordered.push(r);
      });
      return { ...prev, rooms: reordered };
    });

    // Persist to DB
    const { error } = await updateRoomOrder({ branchId, orderedIds });
    if (error) {
      console.error('[Calendar] Failed to persist room order:', error.message);
      refreshCalendar();
    }
  }, [branchId, refreshCalendar]);

  // ── Derived data ───────────────────────────────────────────

  const therapistsForModal = useMemo(() =>
    calendarData
      ? calendarData.therapists.filter(t => t.is_service_staff !== false).map(t => ({
          id: t.id,
          name: t.name,
          gender: t.gender,
          specialties: t.specialties || [],
        }))
      : [],
    [calendarData]
  );

  // ── Error state ────────────────────────────────────────────

  if (error && !calendarData) {
    return (
      <div className="bg-surface rounded-spa-lg border border-border p-8">
        <div className="text-center py-8">
          <Icon name="AlertCircle" size={48} className="text-error mx-auto mb-4" />
          <h3 className="font-heading font-heading-semibold text-lg text-text-primary mb-2">
            Failed to Load Calendar
          </h3>
          <p className="font-body font-body-normal text-text-secondary mb-4">{error}</p>
          <button
            onClick={() => fetchData(currentDate, currentDate)}
            className="inline-flex items-center space-x-2 px-4 py-2 bg-primary text-white rounded-spa font-body font-body-medium text-sm hover:bg-primary/90 spa-transition-fast"
          >
            <Icon name="RefreshCw" size={16} />
            <span>Retry</span>
          </button>
        </div>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="bg-surface overflow-hidden flex flex-col" style={{ height: `calc(100vh - ${heightOffset}px)` }}>
          {/* Top toolbar */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-background/50 flex-shrink-0">
            {/* Left: Navigation */}
            <div className="flex items-center space-x-2">
              <div className="flex items-center border border-border rounded-spa overflow-hidden">
                <button
                  onClick={goPrev}
                  className="px-2 py-1.5 hover:bg-background spa-transition-fast border-r border-border"
                  aria-label="Previous day"
                >
                  <Icon name="ChevronLeft" size={16} className="text-text-secondary" />
                </button>
                <button
                  onClick={goNext}
                  className="px-2 py-1.5 hover:bg-background spa-transition-fast"
                  aria-label="Next day"
                >
                  <Icon name="ChevronRight" size={16} className="text-text-secondary" />
                </button>
              </div>
              <button
                onClick={goToday}
                className="px-3 py-1.5 text-sm font-body font-body-medium border border-border rounded-spa hover:bg-background spa-transition-fast"
              >
                Today
              </button>
            </div>

            {/* Center: Date title with navigation */}
            <div className="flex items-center space-x-3">
              <button
                onClick={goPrev}
                className="p-1.5 border border-border rounded-spa hover:bg-background spa-transition-fast"
                aria-label="Previous"
              >
                <Icon name="ChevronLeft" size={18} className="text-text-secondary" />
              </button>
              <h2 className="font-heading font-heading-semibold text-base text-text-primary min-w-[140px] text-center">
                {formatDateTitle(currentDate, viewMode)}
              </h2>
              <button
                onClick={goNext}
                className="p-1.5 border border-border rounded-spa hover:bg-background spa-transition-fast"
                aria-label="Next"
              >
                <Icon name="ChevronRight" size={18} className="text-text-secondary" />
              </button>
            </div>

            {/* Right: Position filter + View toggle + loading */}
            <div className="flex items-center space-x-3">
              {(loading || isRescheduling) && (
                <div className="flex items-center space-x-1.5 text-text-secondary">
                  <div className="animate-spin w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full" />
                  <span className="font-caption text-xs">{isRescheduling ? 'Updating...' : 'Loading...'}</span>
                </div>
              )}
              {columnMode === 'therapist' && calendarPositionOptions.length > 0 && (
                <div className="relative" ref={positionDropdownRef}>
                  <button
                    onClick={() => setPositionDropdownOpen(prev => !prev)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-spa spa-transition-fast ${
                      selectedPositions.length > 0 ? 'border-primary bg-primary/5 text-primary' : 'border-border bg-surface text-text-primary'
                    }`}
                  >
                    <Icon name="Filter" size={14} />
                    <span>{selectedPositions.length === 0 ? 'All Positions' : `${selectedPositions.length} selected`}</span>
                    <Icon name="ChevronDown" size={14} className={`spa-transition-fast ${positionDropdownOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {positionDropdownOpen && (
                    <div className="absolute right-0 top-full mt-1 w-56 bg-surface border border-border rounded-spa shadow-lg z-dropdown">
                      <div className="p-1.5 border-b border-border">
                        <button
                          onClick={() => setSelectedPositions([])}
                          className="w-full text-left px-2 py-1 text-xs text-primary hover:bg-primary/5 rounded"
                        >
                          Clear all
                        </button>
                      </div>
                      <div className="max-h-[200px] overflow-y-auto p-1.5 space-y-0.5">
                        {calendarPositionOptions.map(pos => (
                          <label key={pos} className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-primary/5 ${selectedPositions.includes(pos) ? 'bg-primary/5' : ''}`}>
                            <input
                              type="checkbox"
                              checked={selectedPositions.includes(pos)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedPositions(prev => [...prev, pos]);
                                } else {
                                  setSelectedPositions(prev => prev.filter(p => p !== pos));
                                }
                              }}
                              className="text-primary focus:ring-primary w-3.5 h-3.5 rounded"
                            />
                            <span className="text-sm text-text-primary">{pos}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              <div className="flex items-center border border-border rounded-spa overflow-hidden">
                {[
                  { key: 'day', label: 'Day' },
                  { key: '4day', label: '4 Day' },
                ].map(v => (
                  <button
                    key={v.key}
                    onClick={() => setViewMode(v.key)}
                    className={`px-3 py-1.5 text-sm font-body font-body-medium spa-transition-fast ${
                      viewMode === v.key
                        ? 'bg-primary text-white'
                        : 'text-text-primary hover:bg-background'
                    }`}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Main content area: Sidebar + Grid */}
          <div className="flex flex-1 min-h-0">
            {/* Left sidebar: Mini calendar + Legend */}
            <div className="w-52 flex-shrink-0 border-r border-border bg-surface p-3 flex flex-col overflow-y-auto sidebar-scroll">
              <MiniMonthCalendar
                selectedDate={currentDate}
                onDateSelect={setCurrentDate}
              />

              {/* View By toggle - only show if rooms are enabled, otherwise just show staff */}
              <div className="mt-4 pt-4 border-t border-border">
                <div className="font-caption font-semibold text-[10px] text-text-secondary uppercase tracking-wider mb-2">
                  View By
                </div>
                {enableRooms ? (
                  <div className="flex border border-border rounded-spa overflow-hidden">
                    <button
                      onClick={() => setColumnMode('therapist')}
                      className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-body font-body-medium spa-transition-fast ${
                        columnMode === 'therapist'
                          ? 'bg-primary text-white'
                          : 'text-text-primary hover:bg-background'
                      }`}
                    >
                      <Icon name="User" size={12} />
                      <span>{staffLabel}</span>
                    </button>
                    <button
                      onClick={() => setColumnMode('room')}
                      className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-body font-body-medium spa-transition-fast border-l border-border ${
                        columnMode === 'room'
                          ? 'bg-primary text-white'
                          : 'text-text-primary hover:bg-background'
                      }`}
                    >
                      <Icon name="DoorOpen" size={12} />
                      <span>{locationLabel}</span>
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-sm text-text-primary font-body">
                    <Icon name="User" size={14} className="text-text-secondary" />
                    <span>{staffLabelPlural}</span>
                  </div>
                )}
              </div>

              <div className="mt-4 pt-4 border-t border-border">
                <div className="font-caption font-semibold text-[10px] text-text-secondary uppercase tracking-wider mb-2">
                  Status
                </div>
                <StatusLegend showPayment compact />
              </div>

              {/* Drag hint */}
              <div className="mt-4 pt-4 border-t border-border">
                <div className="font-caption font-semibold text-[10px] text-text-secondary uppercase tracking-wider mb-2">
                  Tip
                </div>
                <p className="text-xs text-text-secondary leading-relaxed">
                  Drag unpaid bookings to reschedule. Paid and completed bookings are locked.
                </p>
              </div>

              {/* Resource count */}
              {calendarData && (
                <div className="mt-4 pt-4 border-t border-border">
                  {columnMode === 'therapist' || !enableRooms ? (
                    <>
                      <div className="font-caption font-semibold text-[10px] text-text-secondary uppercase tracking-wider mb-2">
                        {staffLabelPlural}
                      </div>
                      <div className="flex items-center gap-1.5 text-sm text-text-primary font-body">
                        <Icon name="Users" size={14} className="text-text-secondary" />
                        <span>{filteredTherapists.length} active</span>
                      </div>
                      <label className="flex items-center gap-2 mt-2 cursor-pointer">
                        <button
                          type="button"
                          onClick={() => setShowServiceOnly(prev => !prev)}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full spa-transition-fast ${
                            showServiceOnly ? 'bg-primary' : 'bg-border'
                          }`}
                        >
                          <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white spa-transition-fast transform ${
                            showServiceOnly ? 'translate-x-4' : 'translate-x-0.5'
                          }`} />
                        </button>
                        <span className="font-caption text-xs text-text-secondary">Service staff only</span>
                      </label>
                      {Object.keys(attendanceMap).length > 0 && (
                        <div className="mt-1.5 space-y-1">
                          {Object.entries(attendanceMap).map(([tid, status]) => {
                            const t = calendarData.therapists.find(th => th.id === tid);
                            if (!t) return null;
                            return (
                              <div key={tid} className="flex items-center gap-1.5 text-xs text-text-secondary">
                                <span className={`w-1.5 h-1.5 rounded-full ${status === 'Absent' ? 'bg-error' : 'bg-warning'}`} />
                                <span className="truncate">{t.name}</span>
                                <span className="opacity-60">({status})</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="font-caption font-semibold text-[10px] text-text-secondary uppercase tracking-wider mb-2">
                        {locationLabelPlural}
                      </div>
                      <div className="flex items-center gap-1.5 text-sm text-text-primary font-body">
                        <Icon name="DoorOpen" size={14} className="text-text-secondary" />
                        <span>{calendarData.rooms?.length || 0} active</span>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Calendar grid */}
            <div className="flex-1 overflow-hidden">
              {calendarData ? (
                <CalendarGrid
                  therapists={filteredTherapists}
                  rooms={calendarData.rooms || []}
                  bookings={calendarData.bookings}
                  branchHours={calendarData.branchHours}
                  attendanceMap={attendanceMap}
                  onBookingClick={handleBookingClick}
                  onEmptySlotClick={handleEmptySlotClick}
                  currentDate={currentDate}
                  viewMode={viewMode}
                  columnMode={columnMode}
                  activeDragId={activeDragId}
                  gridRef={gridRef}
                  freezeUnassigned={freezeUnassigned}
                  onToggleFreezeUnassigned={() => setFreezeUnassigned(prev => !prev)}
                  onTherapistReorder={canReorderTherapists ? handleTherapistReorder : undefined}
                  onRoomReorder={canReorderTherapists ? handleRoomReorder : undefined}
                />
              ) : (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
                    <p className="font-body text-sm text-text-secondary">Loading calendar...</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Drag overlay for visual feedback */}
        <DragOverlay>
          {activeDragBooking && (() => {
            // Calculate preview time based on hovered slot
            const duration = activeDragBooking.serviceDuration ||
              (activeDragBooking.startTime && activeDragBooking.endTime
                ? (() => {
                    const [sh, sm] = activeDragBooking.startTime.split(':').map(Number);
                    const [eh, em] = activeDragBooking.endTime.split(':').map(Number);
                    return (eh * 60 + em) - (sh * 60 + sm);
                  })()
                : 60);

            const previewStartTime = overSlotData
              ? formatTimeFromSlot(overSlotData.hour, overSlotData.minute)
              : activeDragBooking.startTime?.slice(0, 5) || '';

            const previewEndTime = overSlotData
              ? calculateEndTime(overSlotData.hour, overSlotData.minute, duration)
              : activeDragBooking.endTime?.slice(0, 5) || '';

            return (
              <div className="bg-white rounded-md border-2 border-primary shadow-lg px-3 py-2 opacity-95 min-w-[140px]">
                {/* Time display - prominent */}
                <div className="font-data text-sm font-semibold text-text-primary mb-1">
                  {previewStartTime} – {previewEndTime}
                </div>
                <div className="font-body font-semibold text-xs text-text-primary">
                  {activeDragBooking.customerName}
                </div>
                <div className="font-body text-[11px] text-text-secondary">
                  {activeDragBooking.serviceName}
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="font-caption text-[10px] text-text-secondary">
                    {duration} mins
                  </span>
                  {overSlotData && (
                    <span className="font-caption text-[10px] text-primary font-medium">
                      Drop here
                    </span>
                  )}
                </div>
              </div>
            );
          })()}
        </DragOverlay>
      </DndContext>

      {/* Rebook floating cursor card */}
      {rebookSource && (
        <div
          ref={rebookCardRef}
          role="status"
          aria-live="polite"
          aria-label={`Rebook mode active for ${rebookSource.customerName}. Click an empty calendar slot to place, or press Escape to cancel.`}
          className="fixed pointer-events-none z-notification"
          style={{ left: -9999, top: -9999, opacity: 0 }}
        >
          <div className="bg-white rounded-md border-2 border-primary shadow-lg px-3 py-2 min-w-[140px]">
            <div className="font-body font-semibold text-xs text-text-primary">
              {rebookSource.customerName}
            </div>
            <div className="font-body text-[11px] text-text-secondary">
              {rebookSource.serviceName}
            </div>
            <div className="flex items-center justify-between mt-1">
              <span className="font-caption text-[10px] text-text-secondary">
                {rebookSource.duration}
              </span>
              <span className="font-caption text-[10px] text-primary font-medium">
                Click to place
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Modal loading overlay */}
      {modalOpen && modalLoading && (
        <div className="fixed inset-0 bg-text-primary/50 backdrop-blur-sm z-modal flex items-center justify-center p-4">
          <div className="bg-surface rounded-spa-lg spa-shadow-modal p-12 text-center animate-fade-in">
            <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
            <p className="font-body font-body-normal text-text-secondary">Loading booking...</p>
          </div>
        </div>
      )}

      {/* Booking Action Modal */}
      <BookingActionModal
        isOpen={modalOpen && !modalLoading && !!selectedBooking}
        onClose={handleModalClose}
        booking={selectedBooking}
        therapists={therapistsForModal}
        rooms={calendarData?.rooms || []}
        services={servicesCache || []}
        onUpdateStatus={handleStatusUpdate}
        onAssignTherapist={handleAssignTherapist}
        onRecordPayment={handleRecordPayment}
        onEditBooking={handleEditBooking}
        onCreateBooking={handleQuickCreateSubmit}
        onRebookStart={handleRebookStart}
        branchHours={calendarData?.branchHours}
        defaultNewBookingMode={rebookFallback ? 'rebook' : null}
        userRole={profile?.role || 'staff'}
      />

      {/* Toast */}
      {actionToast && (
        <div className={`fixed top-20 left-1/2 transform -translate-x-1/2 z-toast px-5 py-3 rounded-spa-lg spa-shadow-elevated animate-fade-in flex items-center space-x-2 ${
          actionToast.type === 'error' ? 'bg-error text-white' :
          actionToast.type === 'info' ? 'bg-blue-500 text-white' :
          'bg-success text-white'
        }`}>
          <Icon name={actionToast.type === 'error' ? 'AlertCircle' : actionToast.type === 'info' ? 'Clock' : 'CheckCircle'} size={16} />
          <span className="font-body font-body-medium text-sm">{actionToast.msg}</span>
        </div>
      )}

      {/* Quick Create Panel */}
      <QuickCreatePanel
        slotInfo={quickCreateSlot}
        services={servicesCache}
        servicesLoading={servicesLoading}
        therapists={(calendarData?.therapists || []).filter(t => t.is_service_staff !== false)}
        rooms={calendarData?.rooms || []}
        bookings={calendarData?.bookings || []}
        onClose={handleQuickCreateClose}
        onSubmit={handleQuickCreateSubmit}
        branchId={branchId}
        branchHours={calendarData?.branchHours}
      />

      {/* Reassignment Confirmation Dialog */}
      {pendingReassign && (
        <div className="fixed inset-0 bg-text-primary/50 backdrop-blur-sm z-modal flex items-center justify-center p-4">
          <div className="bg-surface rounded-spa-lg spa-shadow-modal p-6 max-w-sm w-full animate-fade-in">
            <div className="flex items-center gap-2 mb-4">
              <Icon name={pendingReassign.timeOnly ? 'Clock' : (pendingReassign.type === 'therapist' ? 'UserCheck' : 'DoorOpen')} size={20} className="text-primary" />
              <h3 className="font-heading font-heading-semibold text-base text-text-primary">
                {pendingReassign.timeOnly ? 'Reschedule Booking' : `Reassign ${pendingReassign.type === 'therapist' ? staffLabel : locationLabel}`}
              </h3>
            </div>
            <p className="font-body text-sm text-text-secondary mb-1">
              {pendingReassign.timeOnly ? 'Reschedule' : 'Move'} <span className="font-semibold text-text-primary">{pendingReassign.booking.customerName}</span>
            </p>
            {!pendingReassign.timeOnly && (
              <p className="font-body text-sm text-text-secondary mb-3">
                from <span className="font-semibold text-text-primary">{pendingReassign.sourceColName}</span>
                {' '}&rarr;{' '}
                <span className="font-semibold text-text-primary">{pendingReassign.targetColName}</span>
              </p>
            )}
            {pendingReassign.timeChanged && (
              <p className="font-body text-xs text-text-secondary mb-3">
                {pendingReassign.timeOnly ? 'New time' : 'Time'}: {formatTimeDisplay(pendingReassign.newStartTime)} – {formatTimeDisplay(pendingReassign.newEndTime)}
                {pendingReassign.newDate !== pendingReassign.booking.date && (
                  <span> on {pendingReassign.newDate}</span>
                )}
              </p>
            )}
            <div className="flex items-center justify-end gap-2 mt-4">
              <button
                onClick={() => setPendingReassign(null)}
                className="px-4 py-2 text-sm font-body font-body-medium border border-border rounded-spa hover:bg-background spa-transition-fast"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmReassign}
                className="px-4 py-2 text-sm font-body font-body-medium bg-primary text-white rounded-spa hover:bg-primary/90 spa-transition-fast"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default OperationalCalendar;
