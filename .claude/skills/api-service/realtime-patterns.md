# Supabase Real-Time Patterns

> Use these patterns when implementing live data updates in BooX.

## When to Use Real-Time

- **Staff Dashboard** — new bookings, status changes appear instantly
- **Manager Dashboard** — live booking feed
- **Booking Details** — status updates while viewing

## Basic Subscription Pattern

```jsx
import { useEffect, useState } from 'react';
import { supabase } from 'lib/supabase';

const useRealtimeBookings = (branchId, date) => {
  const [bookings, setBookings] = useState([]);

  useEffect(() => {
    // Initial fetch
    const fetchBookings = async () => {
      const { data } = await supabase
        .from('bookings')
        .select('*, services(name), rooms(name), therapists(name)')
        .eq('branch_id', branchId)
        .eq('date', date)
        .order('start_time');

      if (data) setBookings(data);
    };

    fetchBookings();

    // Subscribe to changes
    const channel = supabase
      .channel(`bookings-${branchId}-${date}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'bookings',
          filter: `branch_id=eq.${branchId}`,
        },
        (payload) => {
          switch (payload.eventType) {
            case 'INSERT':
              setBookings(prev => [...prev, payload.new].sort(
                (a, b) => a.start_time.localeCompare(b.start_time)
              ));
              break;

            case 'UPDATE':
              setBookings(prev =>
                prev.map(b => b.id === payload.new.id ? payload.new : b)
              );
              break;

            case 'DELETE':
              setBookings(prev =>
                prev.filter(b => b.id !== payload.old.id)
              );
              break;
          }
        }
      )
      .subscribe();

    // Cleanup
    return () => {
      supabase.removeChannel(channel);
    };
  }, [branchId, date]);

  return bookings;
};
```

## Important Notes

1. **Real-time only delivers the changed row** — not joined data. If you need joins, refetch the full record after receiving the change event.

2. **RLS applies to real-time** — users only receive events for rows they can see.

3. **Filter on the server** — use the `filter` parameter to reduce traffic:
   ```js
   filter: `branch_id=eq.${branchId}`
   ```

4. **Clean up subscriptions** — always return a cleanup function from useEffect.

5. **Channel naming** — use descriptive, unique channel names to avoid conflicts:
   ```js
   `bookings-${branchId}-${date}`
   `payments-${branchId}`
   ```

## Refetch Pattern (Simpler Alternative)

For cases where real-time joined data is needed, use a simpler refetch pattern:

```jsx
const channel = supabase
  .channel('booking-changes')
  .on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'bookings' },
    () => {
      // Just refetch everything when any booking changes
      fetchBookings();
    }
  )
  .subscribe();
```

This is simpler and guarantees you always have joined data. Use this for the manager dashboard's RealtimeBookingFeed.

## Supabase Real-Time Requirements

- Real-time must be enabled on the table in Supabase Dashboard
- For the free tier, there's a limit of 200 concurrent connections
- Consider using the refetch pattern for complex queries to stay within limits
