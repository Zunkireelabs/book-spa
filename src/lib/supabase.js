import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Separate client for customer-facing auth (own storage key) so a customer
// logging in on /:orgSlug/book doesn't clobber a staff session in the same
// browser, and vice versa.
export const supabaseCustomer = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { storageKey: 'zenly-customer-auth' },
});

// Isolated client for the platform super-admin area (own storage key) so a
// platform login never triggers the staff AuthContext listener (which would
// look up a non-existent org profile and bounce to /login). Mirrors
// supabaseCustomer's isolation.
export const supabasePlatform = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { storageKey: 'zenly-platform-auth' },
});
