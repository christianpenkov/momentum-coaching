'use client';

import { useState, useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/lib/UserContext';

let channelSeq = 0;

// Nombre de messages non lus adressés à l'utilisateur courant (coach ou élève),
// tous clients confondus pour un coach. Se recalcule automatiquement dès qu'un
// message est inséré ou marqué lu (read_at) via Realtime — pas de polling.
export function useUnreadMessagesCount(): number {
  const { user } = useUser();
  const [count, setCount] = useState(0);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    if (!user?.id) { setCount(0); return; }
    const supabase = createClient();
    let clientIds: string[] = [];

    async function refresh() {
      if (clientIds.length === 0 || cancelledRef.current) return;
      const { count: c } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .in('client_id', clientIds)
        .neq('sender_id', user!.id)
        .is('read_at', null);
      if (!cancelledRef.current) setCount(c ?? 0);
    }

    // Nom de canal unique par montage — deux Sidebar/BottomNav montés simultanément
    // (ou un remount rapide) ne doivent jamais partager le même canal Supabase :
    // appeler .on() sur un canal déjà .subscribe() par un montage précédent lève
    // "cannot add postgres_changes callbacks after subscribe()", une exception
    // non catchée qui plantait toute la page (cf. bug remonté "couldn't load").
    channelSeq += 1;
    const channel = supabase.channel(`unread-badge-${user.id}-${channelSeq}`);

    async function init() {
      const { data: clients } = await supabase
        .from('clients')
        .select('id')
        .or(`coach_id.eq.${user!.id},profile_id.eq.${user!.id}`);
      if (cancelledRef.current) return;
      clientIds = (clients ?? []).map(c => c.id);
      await refresh();
      if (cancelledRef.current) return;
      channel
        .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => {
          refresh();
        })
        .subscribe();
    }
    init();

    return () => {
      cancelledRef.current = true;
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  return count;
}
