'use client';

import { useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';

/**
 * Track la présence de l'utilisateur sur toute la plateforme (pas seulement dans la messagerie).
 * À monter dans les layouts client et coach.
 */
export function useGlobalPresence({
  userId,
  role,
  clientId,
}: {
  userId: string | null;
  role: 'client' | 'coach';
  clientId: string | null;
}) {
  const supabase = useRef(createClient()).current;
  const chRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    if (!userId || !clientId) return;

    const ch = supabase.channel(`presence-chat-${clientId}`, {
      config: { presence: { key: userId } },
    });
    chRef.current = ch;

    ch.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await ch.track({
          user_id: userId,
          role,
          online_at: new Date().toISOString(),
        });
      }
    });

    return () => {
      supabase.removeChannel(ch);
      chRef.current = null;
    };
  }, [userId, role, clientId, supabase]);
}
