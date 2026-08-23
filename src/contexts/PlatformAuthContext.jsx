import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { supabasePlatform } from 'lib/supabase';

const PlatformAuthContext = createContext(null);

export const usePlatformAuth = () => {
  const ctx = useContext(PlatformAuthContext);
  if (!ctx) throw new Error('usePlatformAuth must be used within a PlatformAuthProvider');
  return ctx;
};

export const PlatformAuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const signInActiveRef = useRef(false);

  const checkAdmin = async () => {
    const { data, error } = await supabasePlatform.rpc('is_platform_admin');
    if (error) return false;
    return data === true;
  };

  const signIn = async (email, password) => {
    signInActiveRef.current = true;
    try {
      const { data, error } = await supabasePlatform.auth.signInWithPassword({ email, password });
      if (error) throw error;
      const ok = await checkAdmin();
      if (!ok) {
        await supabasePlatform.auth.signOut();
        throw new Error('This account is not a platform administrator.');
      }
      setUser(data.user);
      setIsPlatformAdmin(true);
      setLoading(false);
      return { user: data.user };
    } finally {
      signInActiveRef.current = false;
    }
  };

  const signOut = async () => {
    setUser(null);
    setIsPlatformAdmin(false);
    await supabasePlatform.auth.signOut();
  };

  useEffect(() => {
    const { data: { subscription } } = supabasePlatform.auth.onAuthStateChange(
      async (event, session) => {
        if (signInActiveRef.current) return;
        if (session?.user) {
          setUser(session.user);
          setIsPlatformAdmin(await checkAdmin());
        } else {
          setUser(null);
          setIsPlatformAdmin(false);
        }
        setLoading(false);
      }
    );
    return () => subscription.unsubscribe();
  }, []);

  return (
    <PlatformAuthContext.Provider value={{ user, isPlatformAdmin, loading, signIn, signOut }}>
      {children}
    </PlatformAuthContext.Provider>
  );
};
