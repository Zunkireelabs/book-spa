import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { viewerAccess } from '../services/dataMasking';

// ZNLY-235: an own-only login that is not linked to a team member (therapists.user_id) can see nothing; say why instead of
// showing an empty screen. Returns true only once the lookup has finished and found no link.
export function useUnlinkedLogin(profile) {
  const [unlinked, setUnlinked] = useState(false);
  const ownOnly = viewerAccess(profile).ownOnly;
  const userId = profile?.id;
  useEffect(() => {
    if (!ownOnly || !userId) { setUnlinked(false); return undefined; }
    let alive = true;
    supabase.from('therapists').select('id').eq('user_id', userId).limit(1)
      .then(({ data, error }) => { if (alive && !error) setUnlinked(!(data && data.length)); });
    return () => { alive = false; };
  }, [ownOnly, userId]);
  return unlinked;
}
