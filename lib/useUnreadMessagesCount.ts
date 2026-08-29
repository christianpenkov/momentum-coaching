'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/lib/UserContext';
import { setBadgeCount } from '@/lib/pwaBadge';

let channelSeq = 0;

// Abonnement PARTAGÉ entre tous les montages du hook.
//
// Sidebar et BottomNavCoach sont tous deux montés en permanence dans
// (coach)/layout.tsx — seul le CSS en cache un selon la taille d'écran. Le hook
// tournait donc en double : 2 canaux Realtime et 2 refetch pour chaque message
// reçu. Un compteur global identique pour tout le monde n'a aucune raison d'être
// calculé deux fois : le premier montage ouvre l'abonnement, les suivants
// s'abonnent au même résultat, et le canal se ferme au démontage du dernier.
type Subscriber = (n: number) => void;
const sharedSubscribers = new Set<Subscriber>();
let sharedTeardown: (() => void) | null = null;
let sharedUserId: string | null = null;
let sharedCount = 0;
// Posé SYNCHRONEMENT dès que le premier montage prend la main. `sharedTeardown`
// ne peut pas servir de témoin : il n'est assigné qu'après l'appel async à init(),
// or React monte Sidebar et BottomNavCoach l'un après l'autre sans laisser tourner
// la microtask entre les deux — le second verrait encore null et ouvrirait un
// second canal, ce que ce drapeau empêche.
let sharedActive = false;

// Nombre de messages non lus adressés à l'utilisateur courant (coach ou élève),
// tous clients confondus pour un coach. Se recalcule automatiquement dès qu'un
// message est inséré ou marqué lu (read_at) via Realtime — pas de polling.
export function useUnreadMessagesCount(): number {
  const { user } = useUser();
  const [count, setCount] = useState(sharedCount);

  useEffect(() => {
    if (!user?.id) { setCount(0); return; }

    // S'attacher à l'abonnement partagé. Le premier montage le crée (plus bas),
    // les suivants réutilisent le même canal et reçoivent la valeur courante.
    const subscriber: Subscriber = n => setCount(n);
    sharedSubscribers.add(subscriber);

    const release = () => {
      sharedSubscribers.delete(subscriber);
      if (sharedSubscribers.size === 0 && sharedTeardown) {
        sharedTeardown();
        sharedTeardown = null;
        sharedUserId = null;
        sharedActive = false;
      }
    };

    // Abonnement déjà ouvert pour ce même utilisateur : se greffer dessus.
    if (sharedActive && sharedUserId === user.id) {
      setCount(sharedCount);
      return release;
    }

    // Changement d'utilisateur : fermer l'abonnement précédent avant d'en ouvrir un neuf.
    if (sharedTeardown) { sharedTeardown(); sharedTeardown = null; }
    sharedActive = true;
    sharedUserId = user.id;

    let cancelled = false;
    const supabase = createClient();
    let clientIds: string[] = [];

    async function refresh() {
      if (clientIds.length === 0 || cancelled) return;
      const { count: c, error } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .in('client_id', clientIds)
        .neq('sender_id', user!.id)
        .is('read_at', null);
      if (cancelled) return;
      // Une requête en échec renvoie `count: null`, que le code transformait en
      // 0 : la part « messages » de la pastille s'effaçait alors qu'on ne savait
      // simplement rien. Même défaut que dans useNotifications — on sort sans
      // rien écrire, le prochain événement Realtime corrigera.
      if (error) return;
      const n = c ?? 0;
      // Diffusé à TOUS les montages (Sidebar + BottomNavCoach) depuis l'unique
      // abonnement partagé, au lieu d'un setCount par instance du hook.
      sharedCount = n;
      sharedSubscribers.forEach(fn => fn(n));
      // Les messages non lus alimentent la pastille au même titre que les notifs
      // de la cloche. Avant, cette source ne savait QUE l'effacer (à 0) : un
      // message non lu ne la posait donc jamais depuis l'app, et le badge posé
      // par le push finissait écrasé par le refresh de la cloche. On déclare
      // maintenant le compte réel, dans les deux sens.
      setBadgeCount('messages', n);
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
      if (cancelled) return;
      clientIds = (clients ?? []).map(c => c.id);
      await refresh();
      if (cancelled) return;
      channel
        // filter serveur : sans lui, l'abonnement portait sur TOUTE la table
        // `messages` — chaque message de n'importe quelle conversation de la
        // plateforme déclenchait un refetch ici, y compris ceux d'autres coachs.
        // Un badge de non-lus ne dépend que des messages REÇUS, donc ceux dont
        // l'expéditeur n'est pas l'utilisateur : `sender_id=neq` écarte déjà
        // l'essentiel du bruit (ses propres envois) côté serveur. Le filtrage fin
        // par clientIds reste fait dans refresh(), PostgREST ne supportant pas
        // le `in.()` dans un filtre Realtime.
        .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `sender_id=neq.${user!.id}` }, () => {
          refresh();
        })
        .subscribe();
    }
    init();

    // Fermeture de l'abonnement partagé : n'a lieu qu'au démontage du DERNIER
    // consommateur (voir le retour anticipé plus haut pour les montages suivants).
    sharedTeardown = () => {
      cancelled = true;
      sharedCount = 0;
      supabase.removeChannel(channel);
    };

    return release;
  }, [user?.id]);

  return count;
}
