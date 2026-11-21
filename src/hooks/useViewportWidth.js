import { useEffect, useState } from 'react';

export const PHONE_MAX = 767; // below Tailwind's md (768px)

// Live window.innerWidth (SSR-safe). `useIsPhone` = under md.
export function useViewportWidth() {
  const [w, setW] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1280));
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return w;
}
export const useIsPhone = () => useViewportWidth() <= PHONE_MAX;
