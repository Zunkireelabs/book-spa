import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { supabaseCustomer } from '../lib/supabase';

const CustomerAuthContext = createContext(null);

export const useCustomerAuth = () => {
  const context = useContext(CustomerAuthContext);
  if (!context) {
    throw new Error('useCustomerAuth must be used within a CustomerAuthProvider');
  }
  return context;
};

// A customer_accounts row belongs to exactly one org (auth_user_id is
// globally unique). Since the provider is hoisted above every org-scoped
// route, the profile fetch must be scoped to the org in the URL — otherwise
// a customer signed in under org A still reads as "logged in" (with org A's
// profile/booking history) after navigating to org B's pages.
function getOrgSlugFromPath(pathname) {
  return pathname.split('/').filter(Boolean)[0] || null;
}

async function fetchCustomerProfile(authUserId, orgSlug) {
  if (!orgSlug) return null;

  try {
    const { data, error } = await supabaseCustomer
      .from('customer_accounts')
      .select('*, organizations!inner(slug)')
      .eq('auth_user_id', authUserId)
      .eq('organizations.slug', orgSlug)
      .maybeSingle();

    if (error) {
      console.error('[CustomerAuth] Profile fetch error:', error.message);
      return null;
    }
    return data;
  } catch (err) {
    console.error('[CustomerAuth] Profile fetch exception:', err);
    return null;
  }
}

export const CustomerAuthProvider = ({ children }) => {
  const location = useLocation();
  const orgSlug = getOrgSlugFromPath(location.pathname);

  const [customer, setCustomer] = useState(null);
  const [customerProfile, setCustomerProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  // Guard: signUp/signIn already resolve user + profile themselves, so the
  // onAuthStateChange listener must not race them with a duplicate fetch.
  const authActiveRef = useRef(false);

  // Which org slug customerProfile was resolved for — tracked separately
  // from the DB row shape so signUp's raw RPC result (no joined org) and
  // signIn/fetch's joined result both compare the same way.
  const profileOrgSlugRef = useRef(null);

  const signUp = async (orgId, email, password, fullName, phone) => {
    authActiveRef.current = true;

    try {
      const { data, error } = await supabaseCustomer.auth.signUp({ email, password });
      if (error) throw error;

      const { data: account, error: rpcError } = await supabaseCustomer.rpc(
        'create_customer_account',
        { p_org_id: orgId, p_email: email, p_phone: phone, p_full_name: fullName }
      );
      if (rpcError) throw rpcError;

      profileOrgSlugRef.current = orgSlug;
      setCustomer(data.user);
      setCustomerProfile(account);
      setLoading(false);

      return { customer: data.user, customerProfile: account };
    } finally {
      authActiveRef.current = false;
    }
  };

  const signIn = async (email, password) => {
    authActiveRef.current = true;

    try {
      const { data, error } = await supabaseCustomer.auth.signInWithPassword({ email, password });
      if (error) throw error;

      const profile = await fetchCustomerProfile(data.user.id, orgSlug);
      if (!profile) {
        await supabaseCustomer.auth.signOut();
        setCustomer(null);
        setCustomerProfile(null);
        setLoading(false);
        throw new Error('No account found for this organization.');
      }

      profileOrgSlugRef.current = orgSlug;
      setCustomer(data.user);
      setCustomerProfile(profile);
      setLoading(false);

      return { customer: data.user, customerProfile: profile };
    } finally {
      authActiveRef.current = false;
    }
  };

  const signOut = async () => {
    profileOrgSlugRef.current = null;
    setCustomerProfile(null);
    setCustomer(null);
    const { error } = await supabaseCustomer.auth.signOut();
    if (error) console.error('[CustomerAuth] Sign out error:', error.message);
  };

  useEffect(() => {
    const { data: { subscription } } = supabaseCustomer.auth.onAuthStateChange(
      (event, session) => {
        if (authActiveRef.current) return;

        if (session?.user) {
          setCustomer(session.user);
        } else {
          profileOrgSlugRef.current = null;
          setCustomer(null);
          setCustomerProfile(null);
        }

        if (event === 'INITIAL_SESSION' && !session?.user) {
          setLoading(false);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!customer) {
      setLoading(false);
      return;
    }

    if (authActiveRef.current) return;

    if (
      customerProfile &&
      customerProfile.auth_user_id === customer.id &&
      profileOrgSlugRef.current === orgSlug
    ) {
      setLoading(false);
      return;
    }

    setLoading(true);

    fetchCustomerProfile(customer.id, orgSlug)
      .then((p) => {
        if (cancelled) return;
        profileOrgSlugRef.current = p ? orgSlug : null;
        setCustomerProfile(p);
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [customer?.id, orgSlug]);

  return (
    <CustomerAuthContext.Provider value={{ customer, customerProfile, loading, signUp, signIn, signOut }}>
      {children}
    </CustomerAuthContext.Provider>
  );
};
