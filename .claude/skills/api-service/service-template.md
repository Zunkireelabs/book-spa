# Service Module Template

> Use this template when creating new service modules in `src/services/`.

## Single-File API Module (Recommended for Phase 3)

```js
// src/services/api.js
import { supabase } from '../lib/supabase';

// ============================================================
// BRANCHES
// ============================================================

export const getBranches = async () => {
  const { data, error } = await supabase
    .from('branches')
    .select('*')
    .eq('is_active', true)
    .order('name');

  if (error) throw error;
  return data;
};

// ============================================================
// ROOMS
// ============================================================

export const getRooms = async (branchId) => {
  const { data, error } = await supabase
    .from('rooms')
    .select('*')
    .eq('branch_id', branchId)
    .eq('is_active', true)
    .order('name');

  if (error) throw error;
  return data;
};

// ============================================================
// SERVICES
// ============================================================

export const getServices = async () => {
  const { data, error } = await supabase
    .from('services')
    .select('*')
    .eq('is_active', true)
    .order('name');

  if (error) throw error;
  return data;
};

// ============================================================
// THERAPISTS
// ============================================================

export const getTherapists = async (branchId) => {
  const { data, error } = await supabase
    .from('therapists')
    .select('*')
    .eq('branch_id', branchId)
    .eq('is_active', true)
    .order('name');

  if (error) throw error;
  return data;
};

// ============================================================
// BOOKINGS
// ============================================================

export const getBookings = async (branchId, date) => {
  const { data, error } = await supabase
    .from('bookings')
    .select(`
      *,
      services(name, duration_minutes, price_npr),
      rooms(name),
      therapists(name, gender)
    `)
    .eq('branch_id', branchId)
    .eq('date', date)
    .order('start_time', { ascending: true });

  if (error) throw error;
  return data;
};

export const getBookingById = async (bookingId) => {
  const { data, error } = await supabase
    .from('bookings')
    .select(`
      *,
      services(name, duration_minutes, price_npr),
      rooms(name),
      therapists(name, gender),
      payments(id, amount, payment_mode, recorded_by, created_at)
    `)
    .eq('id', bookingId)
    .single();

  if (error) throw error;
  return data;
};

export const createBooking = async (booking) => {
  const { data, error } = await supabase
    .from('bookings')
    .insert({
      branch_id: booking.branchId,
      room_id: booking.roomId,
      service_id: booking.serviceId,
      therapist_id: booking.therapistId || null,
      customer_name: booking.customerName,
      customer_email: booking.customerEmail || null,
      customer_phone: booking.customerPhone || null,
      customer_gender: booking.customerGender || null,
      date: booking.date,
      start_time: booking.startTime,
      base_amount: booking.baseAmount,
      discount_amount: booking.discountAmount || 0,
      special_requests: booking.specialRequests || null,
      created_by: booking.createdBy || null,
    })
    .select(`
      *,
      services(name, duration_minutes, price_npr),
      rooms(name),
      therapists(name, gender)
    `)
    .single();

  if (error) throw error;
  return data;
};

export const updateBookingStatus = async (bookingId, status) => {
  const { data, error } = await supabase
    .from('bookings')
    .update({ status })
    .eq('id', bookingId)
    .select()
    .single();

  if (error) throw error;
  return data;
};

export const assignTherapist = async (bookingId, therapistId) => {
  const { data, error } = await supabase
    .from('bookings')
    .update({ therapist_id: therapistId })
    .eq('id', bookingId)
    .select(`
      *,
      therapists(name, gender)
    `)
    .single();

  if (error) throw error;
  return data;
};

export const searchBookings = async (query) => {
  const { data, error } = await supabase
    .from('bookings')
    .select(`
      *,
      services(name),
      rooms(name),
      therapists(name)
    `)
    .or(`booking_number.ilike.%${query}%,customer_name.ilike.%${query}%,customer_phone.ilike.%${query}%`)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) throw error;
  return data;
};

// ============================================================
// PAYMENTS
// ============================================================

export const recordPayment = async (payment) => {
  const { data, error } = await supabase
    .from('payments')
    .insert({
      booking_id: payment.bookingId,
      amount: payment.amount,
      payment_mode: payment.paymentMode,
      recorded_by: payment.recordedBy,
      notes: payment.notes || null,
    })
    .select()
    .single();

  if (error) throw error;

  // Also update booking payment_status
  await supabase
    .from('bookings')
    .update({ payment_status: 'paid' })
    .eq('id', payment.bookingId);

  return data;
};

// ============================================================
// ATTENDANCE
// ============================================================

export const checkIn = async (userId, branchId) => {
  const today = new Date().toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('attendance')
    .insert({
      user_id: userId,
      branch_id: branchId,
      date: today,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
};

export const checkOut = async (attendanceId) => {
  const { data, error } = await supabase
    .from('attendance')
    .update({ check_out: new Date().toISOString() })
    .eq('id', attendanceId)
    .select()
    .single();

  if (error) throw error;
  return data;
};

// ============================================================
// RECONCILIATION (Manager Dashboard)
// ============================================================

export const getRevenueMetrics = async (branchId, startDate, endDate) => {
  const { data, error } = await supabase
    .from('bookings')
    .select('base_amount, discount_amount, final_amount, date')
    .eq('branch_id', branchId)
    .eq('payment_status', 'paid')
    .gte('date', startDate)
    .lte('date', endDate);

  if (error) throw error;

  const gross = data.reduce((sum, b) => sum + Number(b.base_amount), 0);
  const discounts = data.reduce((sum, b) => sum + Number(b.discount_amount), 0);
  const net = data.reduce((sum, b) => sum + Number(b.final_amount), 0);

  return { gross, discounts, net, bookingCount: data.length };
};

export const getBookingStatusCounts = async (branchId, date) => {
  const { data, error } = await supabase
    .from('bookings')
    .select('status')
    .eq('branch_id', branchId)
    .eq('date', date);

  if (error) throw error;

  return data.reduce((acc, b) => {
    acc[b.status] = (acc[b.status] || 0) + 1;
    return acc;
  }, {});
};
```

## Usage in Components

```jsx
import { getBookings, updateBookingStatus } from 'services/api';
import { useAuth } from 'contexts/AuthContext';

const Dashboard = () => {
  const { profile } = useAuth();
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!profile?.branch_id) return;

    const load = async () => {
      setLoading(true);
      try {
        const today = new Date().toISOString().split('T')[0];
        const data = await getBookings(profile.branch_id, today);
        setBookings(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [profile]);

  // ...
};
```
