'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { CALL_TYPES_VENTE } from '@/lib/callTypes';
import { createClient } from '@/lib/supabase/client';
import { setBadgeCount, reassertAppBadge } from '@/lib/pwaBadge';
import { getPendingSessionRapports } from '@/lib/sessionRapport';
import { formatTimeIn, formatDateIn } from '@/lib/timezone';
import { useViewerTimeZone } from '@/lib/UserContext';
import type { Call } from '@/lib/supabase/types';

let instanceCounter = 0;

// Dernière liste connue, conservée ENTRE les montages du hook.
//
// Sans ce cache, revenir sur l'accueil repartait systématiquement d'une liste
// vide : le carrousel « rapports en attente » disparaît quand il n'a rien à
// montrer, donc il occupait zéro hauteur au premier rendu puis surgissait à
// pleine hauteur une fois la requête revenue, en poussant tout le contenu
// situé en dessous. Le saut était garanti à CHAQUE arrivée sur l'écran.
//
// La liste précédente est réaffichée immédiatement, puis remplacée sur place
// par la version fraîche. Même intention que l'abonnement partagé de
// useUnreadMessagesCount : un compteur global n'a aucune raison de repartir de
// zéro parce qu'un composant a été démonté.
let cachedNotifs: AppNotif[] = [];
let cachedKey: string | null = null;

// `clients.integrations_ready_at` est posée UNE fois puis jamais réécrite : le trigger
// `recalc_integrations_ready_at` ne l'écrit que tant qu'elle est nulle — vérifié dans
// la définition de la fonction le 2026-09-04, pas seulement dans un commentaire. Une
// fois connue, elle ne peut plus changer, donc la relire toutes les 60 s dans chaque
// onglet ouvert est une requête pure perte.
//
// ⚠️ On ne mémorise QUE la valeur non nulle. Tant qu'elle est nulle, l'élève n'a pas
// fini de connecter ses intégrations et la valeur est encore à venir : mémoriser
// « null » figerait le hook sur un état périmé jusqu'au rechargement de la page.
const cacheIntegrationsReadyAt = new Map<string, string>();

// ⚠️ Piste ÉCARTÉE, pour qu'elle ne soit pas retentée sans mesure : mutualiser les
// instances du hook. `TopBar` le monte en permanence, `PageToday` ou `PageClientView`
// une seconde fois, et chacune porte son `setInterval` et son canal Realtime.
//
// Fusionner leurs rafraîchissements ne se réduit PAS à sauter le tour de la seconde
// instance : chacune a son propre `useState`, donc celle qui saute resterait figée sur
// une liste périmée au lieu de coûter moins cher. Il faudrait un état partagé avec
// abonnés — un vrai changement de structure, pour un gain que la mesure ne montre pas :
// un onglet ouvert émet 5 requêtes par minute, soit UNE passe de `refresh`, pas deux.
// À reprendre seulement si une mesure montre le double.

export type NotifType = 'rapport_call' | 'session_rapport' | 'call_request' | 'call_canceled' | 'call_rescheduled' | 'call_accepted' | 'call_declined' | 'rapport_ready';

export interface AppNotif {
  id: string;
  type: NotifType;
  title: string;
  body: string;
  callId?: string;
  dbId?: string;
  inviteeName?: string | null;
  scheduledAt?: string | null;
  duration?: string | null;
  topic?: string | null;
}

export function useNotifications(profileId: string | null, isClient: boolean) {
  // Rendu CLIENT : le fuseau du lecteur s'applique normalement, contrairement aux
  // notifications serveur qui doivent lire profiles.timezone du destinataire.
  const viewerTz = useViewerTimeZone();
  const cacheKey = `${profileId ?? ''}:${isClient}`;
  const [notifs, setNotifsState] = useState<AppNotif[]>(
    () => (cachedKey === cacheKey ? cachedNotifs : [])
  );
  // Toute écriture passe par ici : l'état local et le cache inter-montages ne
  // doivent jamais diverger.
  const setNotifs = useCallback((list: AppNotif[]) => {
    cachedNotifs = list;
    cachedKey = cacheKey;
    setNotifsState(list);
  }, [cacheKey]);
  const coachNameRef = useRef<string | null>(null);
  const instanceId = useRef(`${++instanceCounter}`);

  // Charge le prénom du coach une seule fois (pour l'élève uniquement)
  useEffect(() => {
    if (!profileId || !isClient) return;
    const supabase = createClient();
    supabase.from('clients').select('coach_id').eq('profile_id', profileId).maybeSingle()
      .then(({ data }) => {
        if (!data?.coach_id) return;
        supabase.from('profiles').select('full_name').eq('id', data.coach_id).maybeSingle()
          .then(({ data: p }) => { if (p?.full_name) coachNameRef.current = p.full_name.split(' ')[0]; });
      });
  }, [profileId, isClient]);

  /**
   * ⚠️ Une requête en ÉCHEC ne doit jamais produire une liste vide.
   *
   * Les requêtes ci-dessous ne récupéraient que `data`, jamais `error`. Or en
   * cas d'échec — jeton expiré au réveil de la PWA, coupure réseau brève, RLS
   * momentanément en défaut — Supabase renvoie `data: null`. Le code en faisait
   * une liste vide, écrivait `setBadgeCount('notifs', 0)`, et LA PASTILLE
   * DISPARAISSAIT : un rapport en attente semblait traité. Elle revenait à la
   * réouverture de l'app, quand le jeton se rafraîchissait et que les requêtes
   * repassaient — d'où un défaut qui se corrigeait tout seul et paraissait
   * venir d'iOS.
   *
   * Sur échec on sort donc sans rien écrire : l'état précédent reste affiché,
   * et le prochain passage (60 s, Realtime, ou retour au premier plan)
   * corrigera. Un compte périmé vaut mieux qu'un compte faux — ne rien savoir
   * n'est pas savoir qu'il n'y a rien.
   *
   * Les requêtes ANNEXES (noms d'élèves) n'ont pas ce garde : leur échec ne
   * retire aucune ligne, il laisse seulement un libellé de repli.
   */
  const refresh = useCallback(async () => {
    if (!profileId) { setNotifs([]); return; }

    // ── Notifs coach (réponses élève + rapports de session en attente) ──
    if (!isClient) {
      const supabase = createClient();
      const { data: coachRows, error: errCoachRows } = await supabase
        .from('client_notifications')
        .select('id, type, payload, created_at, call_id')
        .in('type', ['call_accepted', 'call_declined'])
        .is('read_at', null);
      // Requête en échec : on garde l'état précédent au lieu de conclure « rien
      // en attente ». Voir le commentaire de `refresh` plus haut.
      if (errCoachRows) return;

      // Nom de l'élève : pas stocké dans le payload, résolu via un join call_id → clients.name
      // (même pattern que pour session_rapport ci-dessous).
      const coachCallIds = [...new Set((coachRows ?? []).map(r => r.call_id).filter((id): id is string => !!id))];
      const coachClientNameByCallId: Record<string, string> = {};
      if (coachCallIds.length > 0) {
        const { data: callsRows } = await supabase.from('calls').select('id, client_id').in('id', coachCallIds);
        const clientIds = [...new Set((callsRows ?? []).map(c => c.client_id).filter((id): id is string => !!id))];
        if (clientIds.length > 0) {
          const { data: clientsRows } = await supabase.from('clients').select('id, name').in('id', clientIds);
          const nameByClientId: Record<string, string> = {};
          (clientsRows ?? []).forEach(c => { nameByClientId[c.id] = c.name; });
          (callsRows ?? []).forEach(c => {
            if (c.client_id && nameByClientId[c.client_id]) coachClientNameByCallId[c.id] = nameByClientId[c.client_id];
          });
        }
      }

      const coachNotifs: AppNotif[] = (coachRows ?? []).map(row => {
        const isAccepted = row.type === 'call_accepted';
        const topic = row.payload?.topic || 'Call coaching';
        const d = row.payload?.scheduled_at ? new Date(row.payload.scheduled_at) : null;
        const dateStr = d ? formatDateIn(d, viewerTz) : '';
        const timeStr = d ? formatTimeIn(d, viewerTz) : '';
        const proposedSuffix = row.payload?.proposed_at ? ` — propose : ${row.payload.proposed_at}` : '';
        const clientName = row.call_id ? coachClientNameByCallId[row.call_id] : undefined;
        const nameSuffix = clientName ? ` — ${clientName}` : '';
        return {
          id: `coach_notif_${row.id}`,
          type: row.type as NotifType,
          title: isAccepted ? 'Call accepté ✓' : 'Call refusé',
          body: isAccepted
            ? `${topic} · ${dateStr} à ${timeStr}${nameSuffix}`
            : `${topic} · ${dateStr} à ${timeStr}${proposedSuffix}${nameSuffix}`,
          callId: row.call_id ?? undefined,
          inviteeName: clientName ?? null,
          scheduledAt: row.payload?.scheduled_at ?? null,
          dbId: row.id,
        };
      });

      // ── Rapports de session Google Meet en attente ──
      const { data: googleCalls, error: errGoogleCalls } = await supabase
        .from('calls')
        .select('id, client_id, topic, scheduled_at, duration, call_type, status, session_completed, session_no_show')
        .eq('coach_id', profileId)
        .eq('call_type', 'google')
        .eq('status', 'active');
      if (errGoogleCalls) return;

      const pendingSessionCalls = getPendingSessionRapports((googleCalls ?? []) as Call[]);
      let sessionRapportNotifs: AppNotif[] = [];
      if (pendingSessionCalls.length > 0) {
        const clientIds = [...new Set(pendingSessionCalls.map(c => c.client_id).filter((id): id is string => !!id))];
        const { data: clientsRows } = await supabase.from('clients').select('id, name').in('id', clientIds);
        const nameById: Record<string, string> = {};
        (clientsRows ?? []).forEach(c => { nameById[c.id] = c.name; });

        sessionRapportNotifs = pendingSessionCalls.map(c => ({
          id: `session_rapport_${c.id}`,
          type: 'session_rapport' as NotifType,
          // « de coaching » explicite : dans la cloche, les rapports de session et
          // de vente s'empilent dans la même liste, et « session » seul ne disait
          // pas de quel type de call il s'agissait.
          title: 'Rapport de session de coaching',
          body: `Comment s'est passée ta session${c.client_id && nameById[c.client_id] ? ` avec ${nameById[c.client_id]}` : ''} ?`,
          callId: c.id,
          inviteeName: c.client_id ? (nameById[c.client_id] ?? null) : null,
          scheduledAt: c.scheduled_at,
          duration: c.duration,
          topic: c.topic,
        }));
      }

      // ── Rapports de call de vente en attente — uniquement les calls du coach
      // lui-même (coach_id = profileId), jamais ceux de ses élèves. Pour un call
      // Calendly, coach_id désigne le propriétaire du lien Calendly connecté — voir
      // docs/calls-coach-id-piege.md. Ne renvoie rien tant que le coach n'a pas
      // connecté son propre Calendly (comportement attendu, pas une erreur).
      const nowIso = new Date().toISOString();
      const { data: coachSalesCalls, error: errCoachSales } = await supabase
        .from('calls')
        .select('id, invitee_name, scheduled_at, duration, outcome')
        .eq('coach_id', profileId)
        .eq('status', 'active')
        .is('outcome', null)
        .neq('ignored', true)
        .in('call_type', CALL_TYPES_VENTE)
        .lt('scheduled_at', nowIso);
      if (errCoachSales) return;

      const salesRapportNotifs: AppNotif[] = (coachSalesCalls ?? [])
        .filter(c => c.outcome === null)
        .map(c => ({
          id: `rapport_${c.id}`,
          type: 'rapport_call' as NotifType,
          // « de vente » explicite : « call » seul ne disait pas de quel type de
          // call il s'agissait. Le même titre est construit plus bas pour l'élève
          // (branche `rapportNotifs`) — les deux doivent rester identiques.
          title: 'Rapport de call de vente',
          body: `Comment s'est passé ton appel${c.invitee_name ? ` avec ${c.invitee_name}` : ''} ?`,
          callId: c.id,
          inviteeName: c.invitee_name,
          scheduledAt: c.scheduled_at,
          duration: c.duration,
        }));

      const allCoachNotifs = [...coachNotifs, ...sessionRapportNotifs, ...salesRapportNotifs];
      setNotifs(allCoachNotifs);
      // Recalcule le badge natif au nombre exact à chaque refresh — un push pose
      // toujours 1 (pas d'unreadCount dans le payload), donc sans ça le badge reste
      // bloqué au lieu de suivre le vrai nombre de notifs restantes.
      // `setBadgeCount` et non `setAppBadge` : les messages non lus ont leur propre
      // compte, qu'un total de 0 notif ici ne doit surtout pas effacer.
      setBadgeCount('notifs', allCoachNotifs.length);
      return;
    }
    const supabase = createClient();
    const now = new Date().toISOString();

    // ── Référence stable "toutes les intégrations obligatoires connectées pour la 1ère
    // fois" (trigger DB, jamais réécrite) — cutoff pour ignorer les calls pré-Momentum,
    // voir docs/integrations-ready-at-vs-onboarding-completed-at.md. ──
    let integrationsReadyAt: string | null = cacheIntegrationsReadyAt.get(profileId) ?? null;
    if (!integrationsReadyAt) {
      const { data: clientRow } = await supabase
        .from('clients')
        .select('integrations_ready_at')
        .eq('profile_id', profileId)
        .maybeSingle();
      integrationsReadyAt = clientRow?.integrations_ready_at ?? null;
      if (integrationsReadyAt) cacheIntegrationsReadyAt.set(profileId, integrationsReadyAt);
    }

    // ── Rapports de call en attente ──
    let callsQuery = supabase
      .from('calls')
      .select('id, invitee_name, scheduled_at, duration, outcome')
      .eq('coach_id', profileId)
      .eq('status', 'active')
      .is('outcome', null)
      .neq('ignored', true)
      .in('call_type', CALL_TYPES_VENTE)
      .lt('scheduled_at', now);

    if (integrationsReadyAt) {
      // Un call réservé (booked_at) avant que toutes les intégrations obligatoires
      // soient connectées n'a pas pu être généré par le pipeline Momentum — fallback sur
      // scheduled_at si booked_at manque.
      callsQuery = callsQuery.or(
        `booked_at.gte.${integrationsReadyAt},and(booked_at.is.null,scheduled_at.gte.${integrationsReadyAt})`
      );
    }

    // C'est CETTE requête qui portait le rapport de vente en attente côté élève :
    // son échec silencieux vidait la liste et effaçait la pastille.
    const { data: calls, error: errCalls } = await callsQuery;
    if (errCalls) return;

    const rapportNotifs: AppNotif[] = (calls || [])
      .filter(c => c.outcome === null)
      .map(c => ({
        id: `rapport_${c.id}`,
        type: 'rapport_call' as NotifType,
        // Doit rester identique au titre de la branche coach ci-dessus : c'est le
        // même objet vu des deux côtés, deux libellés différents dérouteraient.
        title: 'Rapport de call de vente',
        body: `Comment s'est passé ton appel${c.invitee_name ? ` avec ${c.invitee_name}` : ''} ?`,
        callId: c.id,
        inviteeName: c.invitee_name,
        scheduledAt: c.scheduled_at,
        duration: c.duration,
      }));

    // ── Calls coaching en attente d'acceptation (créés par le coach, pas Calendly) ──
    const { data: pendingCalls, error: errPending } = await supabase
      .from('calls')
      .select('id, topic, scheduled_at, duration')
      .eq('status', 'pending_acceptance')
      .eq('call_type', 'google');
    if (errPending) return;

    const callRequestNotifs: AppNotif[] = (pendingCalls ?? []).map(c => ({
      id: `call_request_${c.id}`,
      type: 'call_request' as NotifType,
      title: 'Demande de call coaching',
      body: (c.topic && c.topic !== 'Call coaching') ? c.topic : 'En attente de ta réponse',
      callId: c.id,
      scheduledAt: c.scheduled_at,
      duration: c.duration,
    }));

    // ── Annulations et reports de call non lus (persistés en DB jusqu'au clic OK) ──
    //
    // UNE requête pour les deux types, au lieu de deux qui ne différaient que par
    // `type`. Ce hook tourne toutes les 60 s dans chaque onglet ouvert : chaque
    // requête épargnée ici l'est 1 440 fois par jour et par onglet. Mesure du
    // 2026-09-04 : le navigateur émettait 5 requêtes par minute et par onglet, soit
    // 7 200 par jour — et l'egress de ce projet se paie au NOMBRE de requêtes, pas
    // au volume (corps moyen mesuré : 2 octets).
    //
    // La partition ci-dessous est exhaustive et disjointe : chaque ligne lue porte
    // l'un des deux types demandés, et un seul. ⚠️ Ajouter un type au `in` sans
    // ajouter la branche qui le consomme le ferait disparaître en silence.
    const { data: notifRows, error: errNotifRows } = await supabase
      .from('client_notifications')
      .select('id, type, payload, created_at, call_id')
      .in('type', ['call_canceled', 'call_rescheduled'])
      .is('read_at', null);
    // Requête en échec : on garde l'état précédent au lieu de conclure « rien en
    // attente ». Voir le commentaire de `refresh` plus haut.
    if (errNotifRows) return;

    const canceledRows = (notifRows ?? []).filter(r => r.type === 'call_canceled');
    const rescheduledRows = (notifRows ?? []).filter(r => r.type === 'call_rescheduled');

    const callCanceledNotifs: AppNotif[] = (canceledRows ?? []).map(row => ({
      id: `call_canceled_${row.id}`,
      type: 'call_canceled' as NotifType,
      title: 'Call annulé',
      body: row.payload?.topic ? `${coachNameRef.current || 'Ton coach'} a annulé : ${row.payload.topic}` : `${coachNameRef.current || 'Ton coach'} a annulé ce call.`,
      callId: row.call_id ?? undefined,
      scheduledAt: row.payload?.scheduled_at ?? null,
      // on stocke le notif DB id pour pouvoir le marquer lu
      dbId: row.id,
    }));

    // ── Calls reportés non lus — lus par la même requête que les annulations ──
    const callRescheduledNotifs: AppNotif[] = (rescheduledRows ?? []).map(row => {
      const d = row.payload?.scheduled_at ? new Date(row.payload.scheduled_at) : null;
      const dateStr = d ? formatDateIn(d, viewerTz) : '';
      const timeStr = d ? formatTimeIn(d, viewerTz) : '';
      return {
        id: `call_rescheduled_${row.id}`,
        type: 'call_rescheduled' as NotifType,
        title: `Call déplacé — ${coachNameRef.current || 'ton coach'}`,
        body: d ? `Nouveau créneau : ${dateStr} à ${timeStr}` : (row.payload?.topic ?? 'Nouveau créneau proposé'),
        callId: row.call_id ?? undefined,
        scheduledAt: row.payload?.scheduled_at ?? null,
        dbId: row.id,
      };
    });

    const allNotifs = [...rapportNotifs, ...callRequestNotifs, ...callCanceledNotifs, ...callRescheduledNotifs];
    setNotifs(allNotifs);
    setBadgeCount('notifs', allNotifs.length);
    // viewerTz dans les dépendances : sans lui, les libellés d'heure des notifs
    // resteraient figés sur l'ancien fuseau après un changement de pays.
  }, [profileId, isClient, viewerTz, setNotifs]);

  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);

  useEffect(() => {
    if (!profileId) return;
    refreshRef.current();
    // ── Le FILET, pas le canal principal ────────────────────────────────────────
    //
    // Une notification n'attend pas ce minuteur : l'abonnement Realtime plus bas
    // pousse tout changement de `client_notifications` et de `calls` en quelques
    // millisecondes (les deux tables sont bien publiées dans `supabase_realtime`,
    // vérifié le 2026-09-04), et un retour au premier plan rafraîchit tout de suite.
    // Ce `setInterval` ne sert QUE si le WebSocket décroche en silence — veille du
    // téléphone, changement de réseau, PWA suspendue par iOS.
    //
    // Porté de 60 s à 3 min : le filet tourne dans CHAQUE onglet ouvert, et l'egress
    // du plan gratuit se paie au nombre de requêtes (5 Go/mois tous services
    // confondus, voir AGENTS.md). À 20 élèves, ces sondages à vide pesaient à eux
    // seuls ~29 000 requêtes par jour.
    //
    // Ce que ça coûte, précisément : rien tant que le Realtime tient. Et s'il tombe,
    // la pastille peut avoir 3 minutes de retard au lieu d'1 — à condition que l'app
    // soit restée au premier plan sans qu'on y touche, puisque le moindre
    // retour d'arrière-plan force un rafraîchissement immédiat.
    const interval = setInterval(() => refreshRef.current(), 180_000);
    const handler = () => refreshRef.current();
    window.addEventListener('notifs-refresh', handler);

    // iOS efface la pastille d'une PWA de son propre chef — redémarrage du
    // téléphone, purge mémoire, ou plusieurs jours sans ouvrir l'app — et rien
    // ne la rétablit tout seul. Au moindre retour au premier plan on la
    // réaffirme immédiatement avec les comptes déjà en mémoire (pas d'attente
    // réseau), puis on refait un vrai refresh pour la remettre à la valeur
    // exacte. Sans ça, la pastille ne revenait qu'après un aller-retour complet
    // en base — et jamais du tout si l'utilisateur n'ouvrait pas l'app.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      reassertAppBadge();
      refreshRef.current();
    };
    document.addEventListener('visibilitychange', onVisible);
    // Retour depuis le bfcache iOS, où `visibilitychange` ne se déclenche pas
    // systématiquement.
    window.addEventListener('pageshow', onVisible);

    const supabase = createClient();
    const channel = supabase
      .channel(`notifs-rt-${profileId}-${instanceId.current}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'client_notifications', filter: `profile_id=eq.${profileId}` }, () => refreshRef.current())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calls', ...(isClient ? {} : { filter: `coach_id=eq.${profileId}` }) }, () => refreshRef.current())
      .subscribe();

    return () => {
      clearInterval(interval);
      window.removeEventListener('notifs-refresh', handler);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onVisible);
      supabase.removeChannel(channel);
    };
  }, [profileId, isClient]);

  return { notifs, refresh };
}
