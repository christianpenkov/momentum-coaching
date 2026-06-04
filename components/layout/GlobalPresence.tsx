'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/lib/UserContext';

/**
 * Client : track présence globale sur un canal dédié (distinct du canal messagerie).
 * Gère visibilitychange pour untrack quand l'écran se verrouille.
 */
export function GlobalPresenceClient() {
  const { user } = useUser();
  const [clientId, setClientId] = useState<string | null>(null);
  const supabase = useRef(createClient()).current;
  const chRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    if (!user) return;
    supabase.from('clients').select('id').eq('profile_id', user.id).single()
      .then(({ data }) => { if (data) setClientId(data.id); });
  }, [user, supabase]);

  useEffect(() => {
    if (!user || !clientId) return;

    // Canal séparé du canal messagerie — pas de collision
    const ch = supabase.channel(`global-presence-${clientId}`, {
      config: { presence: { key: user.id } },
    });
    chRef.current = ch;

    ch.subscribe(async (status) => {
      if (status === 'SUBSCRIBED' && document.visibilityState === 'visible') {
        await ch.track({ user_id: user.id, role: 'client', online_at: new Date().toISOString() });
      }
    });

    const handleVisibility = async () => {
      if (!chRef.current) return;
      if (document.visibilityState === 'hidden') {
        await chRef.current.untrack();
      } else {
        await chRef.current.track({ user_id: user.id, role: 'client', online_at: new Date().toISOString() });
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      supabase.removeChannel(ch);
      chRef.current = null;
    };
  }, [user, clientId, supabase]);

  return null;
}

/**
 * Coach : track présence globale sur le canal de chaque client.
 * Gère visibilitychange.
 */
export function GlobalPresenceCoach() {
  const { user } = useUser();
  const supabase = useRef(createClient()).current;
  const channelsRef = useRef<ReturnType<typeof supabase.channel>[]>([]);

  useEffect(() => {
    if (!user) return;

    supabase.from('clients').select('id').eq('coach_id', user.id)
      .then(({ data }) => {
        if (!data || data.length === 0) return;

        const channels = data.map(({ id: clientId }) => {
          const ch = supabase.channel(`global-presence-${clientId}`, {
            config: { presence: { key: user.id } },
          });
          ch.subscribe(async (status) => {
            if (status === 'SUBSCRIBED' && document.visibilityState === 'visible') {
              await ch.track({ user_id: user.id, role: 'coach', online_at: new Date().toISOString() });
            }
          });
          return ch;
        });
        channelsRef.current = channels;
      });

    const handleVisibility = async () => {
      for (const ch of channelsRef.current) {
        if (document.visibilityState === 'hidden') {
          await ch.untrack();
        } else {
          await ch.track({ user_id: user.id, role: 'coach', online_at: new Date().toISOString() });
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      channelsRef.current.forEach(ch => supabase.removeChannel(ch));
      channelsRef.current = [];
    };
  }, [user, supabase]);

  return null;
}
