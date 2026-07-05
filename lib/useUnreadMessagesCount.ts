'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/lib/UserContext';

// Nombre de messages non lus adressés à l'utilisateur courant (coach ou élève),
// tous clients confondus pour un coach. Se recalcule automatiquement dès qu'un
// message est inséré ou marqué lu (read_at) via Realtime — pas de polling.
export function useUnreadMessagesCount(): number {
  const { user } = useUser();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!user?.id) { setCount(0); return; }
    const supabase = createClient();
    let clientIds: string[] = [];

    async function refresh() {
      if (clientIds.length === 0) return;
      const { count: c } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .in('client_id', clientIds)
        .neq('sender_id', user!.id)
        .is('read_at', null);
      setCount(c ?? 0);
    }

    async function init() {
      const { data: clients } = await supabase
        .from('clients')
        .select('id')
        .or(`coach_id.eq.${user!.id},profile_id.eq.${user!.id}`);
      clientIds = (clients ?? []).map(c => c.id);
      await refresh();
    }
    init();

    const channel = supabase
      .channel(`unread-badge-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => {
        refresh();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user?.id]);

  return count;
}
