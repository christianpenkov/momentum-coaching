'use client';

import { useState, useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/lib/UserContext';

let channelSeq = 0;

// Nombre de messages non lus par client_id, pour le coach connecté — alimente le badge
// de non-lu dans la liste des conversations (PageChat). Même pattern Realtime que
// useUnreadMessagesCount (lib/useUnreadMessagesCount.ts), mais groupé par client au lieu
// d'un total global.
export function useUnreadCountsByClient(clientIds: string[]): Record<string, number> {
  const { user } = useUser();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const cancelledRef = useRef(false);
  const idsKey = clientIds.slice().sort().join(',');

  useEffect(() => {
    cancelledRef.current = false;
    if (!user?.id || clientIds.length === 0) { setCounts({}); return; }
    const supabase = createClient();

    async function refresh() {
      if (cancelledRef.current) return;
      const { data } = await supabase
        .from('messages')
        .select('client_id')
        .in('client_id', clientIds)
        .neq('sender_id', user!.id)
        .is('read_at', null);
      if (cancelledRef.current) return;
      const next: Record<string, number> = {};
      (data ?? []).forEach(row => {
        next[row.client_id] = (next[row.client_id] || 0) + 1;
      });
      setCounts(next);
    }

    channelSeq += 1;
    const channel = supabase.channel(`unread-by-client-${user.id}-${channelSeq}`);

    refresh();
    channel
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => {
        refresh();
      })
      .subscribe();

    return () => {
      cancelledRef.current = true;
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, idsKey]);

  return counts;
}
