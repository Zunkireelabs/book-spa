import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { supabaseCustomer } from '../lib/supabase';

const CustomerAuthContext = createContext(null);

export const useCustomerAuth = () => {
  const context = useContext(CustomerAuthContext);
  if (!context) {
    throw new Error('useCustomerAuth must be used within a CustomerAuthProvider');
  }
  return context;
};

async function fetchCustomerProfile(authUserId) {
  try {
    const { data, error } = await supabaseCustomer
      .from('customer_accounts')
      .select('*')
      .eq('auth_user_id', authUserId)
      .single();

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
  const [customer, setCustomer] = useState(null);
  const [customerProfile, setCustomerProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  // Guard: verifyOtp/finalizeCustomerAccount already resolve user + profile
  // themselves, so the onAuthStateChange listener must not race them with a
  // duplicate fetch while the customer_accounts row is still being created.
  const authActiveRef = useRef(false);

  // Creates the customer_accounts row using the full_name/phone stashed as
  // user metadata at signup time (or read live off the confirmed user, for
  // an existing customer signing in again). If the row already exists
  // (returning customer, or this ran twice), falls back to reading it
  // instead of surfacing an error. Called internally by verifyOtp() once a
  // session exists — not exposed on the context, nothing external calls it.
  const finalizeCustomerAccount = async (orgId) => {
    authActiveRef.current = true;

    try {
      const { data: { user }, error: userError } = await supabaseCustomer.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error('No active session to verify.');

      const fullName = user.user_metadata?.full_name || '';
      const phone = user.user_metadata?.phone || '';

      const { data: account, error: rpcError } = await supabaseCustomer.rpc(
        'create_customer_account',
        { p_org_id: orgId, p_email: user.email, p_phone: phone, p_full_name: fullName }
      );

      if (!rpcError) {
        setCustomer(user);
        setCustomerProfile(account);
        setLoading(false);
        return account;
      }

      if (rpcError.code === '23505') {
        const existing = await fetchCustomerProfile(user.id);
        if (existing) {
          setCustomer(user);
          setCustomerProfile(existing);
          setLoading(false);
          return existing;
        }
      }

      throw rpcError;
    } finally {
      authActiveRef.current = false;
    }
  };

  // Sends a 6-digit code by email. shouldCreateUser=true for signup (also
  // stashes full_name/phone as user metadata, read back by
  // finalizeCustomerAccount once the code is verified); false for login,
  // which errors cleanly if no account exists yet for this email.
  const requestOtp = async (email, { fullName, phone, shouldCreateUser } = {}) => {
    const { error } = await supabaseCustomer.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: !!shouldCreateUser,
        data: shouldCreateUser ? { full_name: fullName, phone } : undefined,
      },
    });
    if (error) throw error;
  };

  // Verifies the 6-digit code, establishing a session, then reuses
  // finalizeCustomerAccount to create-or-fetch the customer_accounts row —
  // it already handles both the new-signup and returning-customer cases.
  const verifyOtp = async (email, token, orgId) => {
    authActiveRef.current = true;

    try {
      const { data, error } = await supabaseCustomer.auth.verifyOtp({ email, token, type: 'email' });
      if (error) throw error;
      if (!data.session) throw new Error('Verification did not return a session.');

      const account = await finalizeCustomerAccount(orgId);
      return { customer: data.user, customerProfile: account };
    } finally {
      authActiveRef.current = false;
    }
  };

  const signOut = async () => {
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

    if (customerProfile && customerProfile.auth_user_id === customer.id) {
      setLoading(false);
      return;
    }

    setLoading(true);

    fetchCustomerProfile(customer.id)
      .then((p) => { if (!cancelled) setCustomerProfile(p); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [customer?.id]);

  return (
    <CustomerAuthContext.Provider value={{ customer, customerProfile, loading, requestOtp, verifyOtp, signOut }}>
      {children}
    </CustomerAuthContext.Provider>
  );
};
