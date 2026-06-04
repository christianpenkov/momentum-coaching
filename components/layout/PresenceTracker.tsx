'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/lib/UserContext';

/**
 * Monte la présence globale dès l'entrée dans l'app (layout).
 * Client : fetch clientId depuis la table clients, track sur presence-chat-{clientId}.
 * Coach : track sur presence-chat-{clientId} pour chaque client dès qu'on connaît les clients.
 *         Ici simplifié : le coach track sur son propre canal global (le tracking par conv est dans PageChat).
 */
export function PresenceTracker({ role }: { role: 'client' | 'coach' }) {
  const { user } = useUser();
  const supabase = useRef(createClient()).current;
  const [clientId, setClientId] = useState<string | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Pour le client : récupère son clientId
  useEffect(() => {
    if (!user || role !== 'client') return;
    supabase.from('clients').select('id').eq('profile_id', user.id).single()
      .then(({ data }) => { if (data) setClientId(data.id); });
  }, [user, role, supabase]);

  // Track la présence dès qu'on a userId + clientId
  useEffect(() => {
    if (!user) return;
    // Coach : pas de canal global ici, il se connecte dans PageChat par conversation
    if (role === 'coach') return;
    if (!clientId) return;

    // Nettoie l'ancien canal si existe
    if (channelRef.current) { supabase.removeChannel(channelRef.current); }

    const ch = supabase.channel(`presence-chat-${clientId}`, {
      config: { presence: { key: user.id } },
    });
    channelRef.current = ch;

    ch.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await ch.track({
          user_id: user.id,
          role: 'client',
          online_at: new Date().toISOString(),
        });
      }
    });

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [user, role, clientId, supabase]);

  return null;
}
