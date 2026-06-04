'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/lib/UserContext';

/**
 * Client : track présence sur toute la plateforme (pas seulement messagerie).
 */
export function GlobalPresenceClient() {
  const { user } = useUser();
  const [clientId, setClientId] = useState<string | null>(null);
  const supabase = useRef(createClient()).current;

  useEffect(() => {
    if (!user) return;
    supabase.from('clients').select('id').eq('profile_id', user.id).single()
      .then(({ data }) => { if (data) setClientId(data.id); });
  }, [user, supabase]);

  useEffect(() => {
    if (!user || !clientId) return;
    const ch = supabase.channel(`presence-chat-${clientId}`, {
      config: { presence: { key: user.id } },
    });
    ch.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await ch.track({ user_id: user.id, role: 'client', online_at: new Date().toISOString() });
      }
    });
    return () => { supabase.removeChannel(ch); };
  }, [user, clientId, supabase]);

  return null;
}

/**
 * Coach : track présence sur le canal de chaque client pour qu'ils voient le coach en ligne
 * même quand le coach n'est pas dans la page messagerie.
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

        const channels = data.map(({ id }) => {
          const ch = supabase.channel(`presence-chat-${id}`, {
            config: { presence: { key: user.id } },
          });
          ch.subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
              await ch.track({ user_id: user.id, role: 'coach', online_at: new Date().toISOString() });
            }
          });
          return ch;
        });
        channelsRef.current = channels;
      });

    return () => {
      channelsRef.current.forEach(ch => supabase.removeChannel(ch));
      channelsRef.current = [];
    };
  }, [user, supabase]);

  return null;
}
