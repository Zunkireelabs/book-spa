import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const getDashboardPath = (role) => {
  switch (role) {
    case 'manager':
    case 'admin':
      return '/branch-manager-dashboard';
    case 'staff':
    default:
      return '/branch-staff-dashboard';
  }
};

/**
 * Fetch a user's staff profile from public.users with branch name.
 *
 * When called with an explicit accessToken (e.g. right after signIn),
 * we use a direct REST call because the supabase-js client's internal
 * session state may not be ready yet after signInWithPassword.
 *
 * When called without a token (page refresh), the supabase client reads
 * the stored session from localStorage automatically — this path works fine.
 */
async function fetchProfile(userId, accessToken) {
  try {
    if (accessToken) {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/users`
        + `?select=*,branches(name)&id=eq.${userId}`;
      const res = await fetch(url, {
        headers: {
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/vnd.pgrst.object+json',
        },
      });
      if (!res.ok) {
        const body = await res.text();
        console.error('[Auth] Profile fetch failed:', res.status, body);
        return null;
      }
      return await res.json();
    }

    // Fallback: use supabase client (session from localStorage)
    const { data, error } = await supabase
      .from('users')
      .select('*, branches(name)')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('[Auth] Profile fetch error:', error.message);
      return null;
    }
    return data;
  } catch (err) {
    console.error('[Auth] Profile fetch exception:', err);
    return null;
  }
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  // Guard: when signIn() is actively running, the useEffect must not
  // race with its own profile fetch.
  const signInActiveRef = useRef(false);

  const signIn = async (email, password) => {
    signInActiveRef.current = true;

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      const userProfile = await fetchProfile(
        data.user.id,
        data.session.access_token
      );

      setUser(data.user);
      setProfile(userProfile);
      setLoading(false);

      return { user: data.user, profile: userProfile };
    } finally {
      signInActiveRef.current = false;
    }
  };

  const signOut = async () => {
    setProfile(null);
    setUser(null);
    const { error } = await supabase.auth.signOut();
    if (error) console.error('[Auth] Sign out error:', error.message);
  };

  // Bootstrap: listen for auth state changes.
  // The callback MUST stay synchronous — supabase-js awaits all listeners
  // inside signInWithPassword, so any await here would deadlock.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        // During signIn(), we handle user + profile ourselves.
        // Only update state from the listener when signIn is NOT active.
        if (signInActiveRef.current) return;

        if (session?.user) {
          setUser(session.user);
        } else {
          setUser(null);
          setProfile(null);
        }

        if (event === 'INITIAL_SESSION' && !session?.user) {
          setLoading(false);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  // Fetch profile on page refresh (INITIAL_SESSION with an existing session).
  // Skipped when signIn already set both user + profile in the same render.
  useEffect(() => {
    let cancelled = false;

    if (!user) {
      setLoading(false);
      return;
    }

    // signIn() is handling auth + profile — don't compete
    if (signInActiveRef.current) return;

    // Profile already loaded for this user
    if (profile && profile.id === user.id) {
      setLoading(false);
      return;
    }

    setLoading(true);

    // No explicit token — supabase client uses localStorage session
    fetchProfile(user.id)
      .then((p) => { if (!cancelled) setProfile(p); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [user?.id]);

  return (
    <AuthContext.Provider value={{ user, profile, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};
