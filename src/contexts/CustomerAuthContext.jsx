import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { supabaseCustomer } from '../lib/supabase';
import { useTenant } from './TenantContext';

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
  const { orgId } = useTenant();
  const [customer, setCustomer] = useState(null);
  const [customerProfile, setCustomerProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  // Guard: signUp/signIn already resolve user + profile themselves, so the
  // onAuthStateChange listener must not race them with a duplicate fetch.
  const authActiveRef = useRef(false);

  const signUp = async (email, password, fullName, phone) => {
    authActiveRef.current = true;

    try {
      const { data, error } = await supabaseCustomer.auth.signUp({ email, password });
      if (error) throw error;

      const { data: account, error: rpcError } = await supabaseCustomer.rpc(
        'create_customer_account',
        { p_org_id: orgId, p_email: email, p_phone: phone, p_full_name: fullName }
      );
      if (rpcError) throw rpcError;

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

      const profile = await fetchCustomerProfile(data.user.id);

      setCustomer(data.user);
      setCustomerProfile(profile);
      setLoading(false);

      return { customer: data.user, customerProfile: profile };
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
    <CustomerAuthContext.Provider value={{ customer, customerProfile, loading, signUp, signIn, signOut }}>
      {children}
    </CustomerAuthContext.Provider>
  );
};
