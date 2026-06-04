'use client';

import { useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';

/**
 * Publie la présence de l'utilisateur sur un canal global.
 * À monter dans le layout — persiste tant que l'app est ouverte.
 * Pour le client : role='client', clientId fourni.
 * Pour le coach : role='coach', clientId null.
 */
export function usePresence({
  userId,
  role,
  clientId,
}: {
  userId: string | null;
  role: 'client' | 'coach';
  clientId: string | null;
}) {
  const supabase = useRef(createClient()).current;

  useEffect(() => {
    if (!userId || !clientId) return;

    // Canal partagé coach+client pour ce client_id
    const ch = supabase.channel(`presence-chat-${clientId}`, {
      config: { presence: { key: userId } },
    });

    ch.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await ch.track({
          user_id: userId,
          role,
          online_at: new Date().toISOString(),
        });
      }
    });

    return () => { supabase.removeChannel(ch); };
  }, [userId, role, clientId, supabase]);
}
