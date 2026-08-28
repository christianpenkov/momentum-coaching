'use client';
import InlineLoader from '@/components/ui/InlineLoader';
import { Skeleton } from '@/components/ui/Skeleton';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Icon from '@/components/ui/Icon';
import RapportModal from '@/components/ui/RapportModalLoader';
import PendingRapportCard from '@/components/ui/PendingRapportCard';
import CallInfosModal from '@/components/ui/CallInfosModal';
import Avatar, { getInitials } from '@/components/ui/Avatar';
import { createClient } from '@/lib/supabase/client';
import { notifyError } from '@/lib/mutate';
import { CALL_COLUMNS } from '@/lib/supabase/types';
import { useClientSelfData } from '@/lib/supabase/useCoachData';
import { useClientSelf } from '@/lib/ClientSelfContext';
import { isCallReallyOver, isCallJoinable, isCallCanceled, isCoachingCall, pickDisplayedCall } from '@/lib/sessionRapport';
import CallCard from '@/components/ui/CallCard';
import { CallTypeBadge } from '@/components/ui/CallBadges';
import { formatCallLongDate, formatCallTime, groupCallsByPeriod } from '@/lib/callFormat';
import { useViewerTimeZone } from '@/lib/UserContext';
import { formatTimeIn, formatDateIn } from '@/lib/timezone';

type Tab = 'upcoming' | 'history' | 'prospects' | 'coachings' | 'canceled';

// Nombre de périodes (semaine/mois) affichées avant le bouton "Voir plus" —
// remplace l'ancienne limite à 4 calls, qui coupait au milieu d'un mois.
const VISIBLE_PERIODS = 2;

interface Call {
  id: string;
  topic: string | null;
  scheduled_at: string | null;
  duration: string | null;
  join_url: string | null;
  status: string | null;
  notes: string | null;
  call_type: string | null;
  calendly_event_uuid: string | null;
  coach_id: string | null;
  client_id: string | null;
  invitee_name: string | null;
  no_show: boolean | null;
  deal_closed: boolean | null;
  revenue: number | null;
  outcome: string | null;
  lead_rapport_comment: string | null;
  objection: string | null;
  objection_autre: string | null;
  relance_at: string | null;
  session_completed?: boolean | null;
  session_no_show?: boolean | null;
  fathom_status?: 'pending' | 'matched' | 'unmatched' | 'not_recorded' | null;
  fathom_share_url?: string | null;
  fathom_summary?: string | null;
  fathom_action_items?: unknown;
  // Le transcript lui-même n'est PAS chargé avec le call (~40 Ko/call, sur tout
  // l'historique de l'élève à chaque affichage de la page). Ce booléen généré
  // dit s'il en existe un, sans transporter son contenu ; FathomRecordingSection
  // va le chercher au clic via /api/calls/[id]/transcript. Voir CALL_COLUMNS.
  has_fathom_transcript?: boolean | null;
}

interface RapportModal {
  callId: string;
  inviteeName: string | null;
  scheduledAt: string | null;
  isFollowUp?: boolean;
  // Renseigné uniquement en mode correction (rapport déjà rempli qu'on rouvre).
  existing?: { revenue?: number | null; comment?: string | null } | null;
  // Pas de champs fathom* ici : RapportModal ne les accepte pas dans ses props
  // et le JSX ne passe que callId/inviteeName/scheduledAt/isFollowUp/existing.
  // Les données Fathom s'affichent dans CallInfosModal, pas dans le formulaire
  // de rapport.
}

function daysUntil(dateStr: string) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - now.getTime()) / 86400000);
}

// Notes personnelles de l'élève sur un call de coaching (Google Meet), indépendantes
// du rapport du coach — toujours affichées et éditables, peu importe si le coach a
// déjà rapporté ce call ou non (voir lib/sessionRapport.ts / route student-notes).
// Le statut du rapport coach reste un détail de gestion interne, jamais exposé à l'élève.
function MyCallNotes({ callId, initialNotes, initialDismissed }: { callId: string; initialNotes: string; initialDismissed: boolean }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(initialNotes);
  const [dismissed, setDismissed] = useState(initialDismissed);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);

  async function save() {
    setSaving(true);
    setError(false);
    const res = await fetch(`/api/session-reports/by-call/${callId}/student-notes`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student_notes: value }),
    });
    setSaving(false);
    if (!res.ok) { setError(true); return; }
    setDismissed(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function markDismissed() {
    setSaving(true);
    setError(false);
    const res = await fetch(`/api/session-reports/by-call/${callId}/student-notes`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dismissed: true }),
    });
    setSaving(false);
    if (!res.ok) { setError(true); return; }
    setDismissed(true);
  }

  return (
    <div style={{ marginTop: 8 }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{ fontSize: 11, color: 'var(--accent-brand)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 4 }}
      >
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={11} />
        Mes notes sur cet appel
        {dismissed && !value.trim() && <Icon name="check" size={10} style={{ color: 'var(--green)' }} />}
      </button>
      {open && (
        <div style={{ marginTop: 8 }}>
          <textarea
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder="Ce que tu veux retenir de cette séance…"
            style={{ width: '100%', minHeight: 80, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)', fontSize: 12, color: 'var(--accent)', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6, outline: 'none', boxSizing: 'border-box' }}
          />
          <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            {dismissed && !value.trim() ? (
              <span style={{ fontSize: 11, color: 'var(--green)' }}>✓ Tu as indiqué n'avoir rien à ajouter</span>
            ) : !value.trim() ? (
              <button className="btn-ghost" style={{ fontSize: 11 }} type="button" onClick={markDismissed} disabled={saving}>
                Je n'ai rien à ajouter
              </button>
            ) : <span />}
            <button className="btn-ghost" style={{ fontSize: 11, color: error ? 'var(--red)' : undefined }} type="button" onClick={save} disabled={saving}>
              {error ? 'Erreur — réessayer' : saved ? '✓ Sauvegardé' : saving ? 'Enregistrement…' : 'Sauvegarder'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

type SessionReportInfo = { student_notes: string | null; student_notes_dismissed: boolean; attended: boolean | null; topic: string | null; topic_custom: string | null };

// integrations_ready_at est désormais déclaré sur le type Client
// (lib/supabase/types.ts, ajouté le 2026-08-19) — l'angle mort qui obligeait
// SupabaseClientsContext.tsx et useCoachData.ts à y accéder en `any` est levé.
async function fetchClientCallsData(clientRow: { id: string; integrations_ready_at?: string | null } | null): Promise<{
  calls: Call[];
  hasCalendly: boolean;
  sessionReportsByCall: Record<string, SessionReportInfo>;
  userId: string | null;
}> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { calls: [], hasCalendly: false, sessionReportsByCall: {}, userId: null };

  const { data: integ } = await supabase
    .from('integrations')
    .select('id')
    .eq('profile_id', user.id)
    .eq('provider', 'calendly')
    .single();
  const hasCalendly = !!integ;

  // clientRow (id + integrations_ready_at) vient désormais du ClientSelfContext —
  // plus besoin de le requêter ici, c'était un aller-retour réseau en série avant
  // de pouvoir lancer les requêtes calls/session_reports ci-dessous. Référence
  // stable "toutes les intégrations obligatoires connectées pour la 1ère fois"
  // (trigger DB, jamais réécrite) — les calls réservés avant sont ignorés
  // partout, voir docs/integrations-ready-at-vs-onboarding-completed-at.md.
  const integrationsReadyAt: string | null = clientRow?.integrations_ready_at ?? null;

  // Calls Calendly : coach_id = profileId de l'élève (l'élève est l'hôte de ses calls leads)
  let calendlyQuery = supabase
    .from('calls')
    .select(CALL_COLUMNS)
    .eq('coach_id', user.id)
    .eq('call_type', 'calendly')
    .neq('ignored', true)
    .order('scheduled_at', { ascending: false });

  if (integrationsReadyAt) {
    // Un call réservé (booked_at) avant que toutes les intégrations obligatoires
    // soient connectées n'a pas pu être généré par le pipeline Momentum — fallback sur
    // scheduled_at si booked_at manque.
    calendlyQuery = calendlyQuery.or(
      `booked_at.gte.${integrationsReadyAt},and(booked_at.is.null,scheduled_at.gte.${integrationsReadyAt})`
    );
  }

  const { data: calendlyCalls } = await calendlyQuery;

  // Calls Google Calendar (coach ↔ élève) : client_id = clientRow.id
  let googleCalls: Call[] = [];
  let sessionReportsByCall: Record<string, SessionReportInfo> = {};
  if (clientRow) {
    const { data } = await supabase
      .from('calls')
      .select(CALL_COLUMNS)
      .eq('client_id', clientRow.id)
      .neq('call_type', 'calendly')
      .neq('ignored', true)
      .order('scheduled_at', { ascending: false });
    googleCalls = (data as Call[]) || [];

    const { data: reports } = await supabase
      .from('session_reports')
      // Visibilité des 3 champs du rapport de session, décidée côté saisie :
      //  - notes   : "Privé, visible coach uniquement" (SessionRapportModal l.202)
      //              → JAMAIS sélectionné ici, ne doit pas atteindre le client.
      //  - topic   : "Visible par l'élève" (SessionRapportModal l.159) → partagé,
      //              le coach voit la mention au moment où il le remplit.
      //  - attended: aucune mention côté saisie, mais partage confirmé comme
      //              voulu (2026-08-18). Ne pas "corriger" en le masquant.
      // Le champ `notes` affiché à l'élève dans CallInfosModal vient de
      // calls.notes, qui est une colonne distincte de session_reports.notes.
      .select('call_id, student_notes, student_notes_dismissed, attended, topic, topic_custom')
      .eq('client_id', clientRow.id);
    const reportsMap: Record<string, SessionReportInfo> = {};
    for (const r of reports || []) reportsMap[r.call_id] = { student_notes: r.student_notes, student_notes_dismissed: r.student_notes_dismissed, attended: r.attended, topic: r.topic, topic_custom: r.topic_custom };
    sessionReportsByCall = reportsMap;
  }

  const allCalls = [...(calendlyCalls as Call[] || []), ...googleCalls];
  // Déduplique par id
  const seen = new Set<string>();
  const calls = allCalls.filter(c => { if (seen.has(c.id)) return false; seen.add(c.id); return true; });

  return { calls, hasCalendly, sessionReportsByCall, userId: user.id };
}

type ClientCallsData = Awaited<ReturnType<typeof fetchClientCallsData>>;

export default function PageClientCalls() {
  const searchParams = useSearchParams();
  const viewerTz = useViewerTimeZone();
  const router = useRouter();
  const { data: client } = useClientSelfData();
  const { clientRow: selfRow } = useClientSelf();
  const queryClient = useQueryClient();
  const callsQueryKey = ['client-calls-page', selfRow?.id];
  const { data: callsData, isLoading: callsLoading } = useQuery({
    queryKey: callsQueryKey,
    queryFn: () => fetchClientCallsData(selfRow),
    enabled: !!selfRow,
  });
  const calls = callsData?.calls ?? [];
  const hasCalendly = callsData?.hasCalendly ?? null;
  const sessionReportsByCall = callsData?.sessionReportsByCall ?? {};
  const userId = callsData?.userId ?? null;
  const loading = (callsLoading || !selfRow) && !callsData;

  const setCalls = (updater: (prev: Call[]) => Call[]) => {
    queryClient.setQueryData<ClientCallsData>(callsQueryKey, prev => prev && { ...prev, calls: updater(prev.calls) });
  };
  const refetchCalls = () => queryClient.invalidateQueries({ queryKey: callsQueryKey });

  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [dismissingCanceledId, setDismissingCanceledId] = useState<string | null>(null);
  const [confirmDismissId, setConfirmDismissId] = useState<string | null>(null);
  const [declineModal, setDeclineModal] = useState<{ callId: string; topic: string; scheduledAt: string } | null>(null);
  const [proposedAt, setProposedAt] = useState('');
  const [tab, setTab] = useState<Tab>('upcoming');

  // Force un recalcul du split upcoming/historique chaque minute, pour que la
  // bascule se fasse en temps réel sans dépendre uniquement des changements
  // de `calls` déclenchés par le realtime.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, []);

  // Carrousel historique

  // Modal rapport
  const [rapportModal, setRapportModal] = useState<RapportModal | null>(null);

  // Modale de consultation (rapport déjà rempli + infos Fathom) — jamais de formulaire.
  const [infosModalCall, setInfosModalCall] = useState<Call | null>(null);

  // Historique : 4 derniers affichés par défaut, "Voir plus" affiche le reste
  const [historyLimited, setHistoryLimited] = useState(true);

  // Realtime : un changement sur les calls DE CET ÉLÈVE invalide le cache, qui
  // refetch (pas de mutation fine ici, contrairement au contexte coach : les
  // calls sont recomposés depuis deux requêtes et un mapping de rapports).
  //
  // Deux filtres serveur, un par colonne : un call calendly porte le profile_id
  // de l'élève dans `coach_id` (l'élève est l'hôte de ses calls leads, cf.
  // docs/calls-coach-id-piege.md), les autres portent `client_id`. PostgREST
  // n'accepte qu'une égalité par abonnement, d'où deux `.on()` sur le même canal.
  //
  // Sans ces filtres, chaque élève était réveillé par les calls de TOUS les
  // autres élèves et coachs, et par les écritures des crons — refetchant à
  // chaque fois son historique complet pour un résultat inchangé.
  //
  // Le nom du canal porte l'identifiant : il était fixe ('calls-client'), donc
  // partagé entre tous les élèves connectés.
  useEffect(() => {
    if (!userId || !selfRow?.id) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`calls-client-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calls', filter: `coach_id=eq.${userId}` }, () => { refetchCalls(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calls', filter: `client_id=eq.${selfRow.id}` }, () => { refetchCalls(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, selfRow?.id]);

  // Deep link : ?rapport=<call_id> → ouvre la modal une seule fois (depuis push notif)
  const deepLinkHandled = useRef(false);
  useEffect(() => {
    const rapportId = searchParams.get('rapport');
    if (!rapportId || calls.length === 0 || deepLinkHandled.current) return;
    const call = calls.find(c => c.id === rapportId);
    if (!call || call.no_show !== null) return;
    deepLinkHandled.current = true;
    setRapportModal({ callId: call.id, inviteeName: call.invitee_name, scheduledAt: call.scheduled_at });
  }, [searchParams, calls]);

  function closeRapportModal() {
    setRapportModal(null);
    // Retire ?rapport= de l'URL sans reload
    const url = new URL(window.location.href);
    url.searchParams.delete('rapport');
    router.replace(url.pathname + url.search, { scroll: false });
    refetchCalls();
  }

  const pendingCalls = calls.filter(c => c.status === 'pending_acceptance' && c.call_type !== 'calendly');
  const canceledCalls = calls.filter(c => ['canceled', 'cancelled', 'declined'].includes(c.status || ''));
  // La liste "À venir" inclut aussi les calls encore dans leur fenêtre de rattrapage
  // (isCallJoinable, 15min après la fin théorique) — pas seulement !isCallReallyOver
  // strict — pour que le bouton Rejoindre reste visible pendant le rattrapage. isCallReallyOver
  // reste la référence stricte pour Historique, inchangée.
  const upcoming = calls
    .filter(c => c.scheduled_at && c.status === 'active' && isCallJoinable(c as any, nowTick))
    .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime());

  // Calls historique : passés, non annulés, réellement terminés (fin théorique stricte,
  // pas la fenêtre de rattrapage — un call encore en rattrapage reste dans "upcoming").
  // Le `!isCallJoinable` évite qu'un call qui vient de se terminer appartienne aux
  // DEUX listes pendant les 15 min de fenêtre de rattrapage — il serait alors
  // affiché et compté deux fois dans les onglets Ventes et Coachings.
  const history = calls
    .filter(c => c.scheduled_at && isCallReallyOver(c as any, nowTick) && !isCallJoinable(c as any, nowTick) && !isCallCanceled(c))
    .sort((a, b) => new Date(b.scheduled_at!).getTime() - new Date(a.scheduled_at!).getTime());

  // Onglets Ventes / Coachings — chacun affiche ses propres sections À venir puis
  // Historique en dessous, indépendamment de l'onglet À venir/Historique principal
  // (qui, lui, mélange tous les types sans filtre). Même logique que côté coach.
  const salesUpcoming = upcoming.filter(c => !isCoachingCall(c));
  const salesHistory = history.filter(c => !isCoachingCall(c));
  const coachingUpcoming = upcoming.filter(c => isCoachingCall(c));
  const coachingHistory = history.filter(c => isCoachingCall(c));

  // Widget "Prochain call" — liste candidate séparée de `upcoming` (qui inclut la
  // grâce) : bascule vers le call suivant dès que le call affiché est réellement
  // terminé (isCallReallyOver), peu importe le délai avant le suivant.
  const widgetCandidates = calls
    .filter(c => c.scheduled_at && c.status === 'active' && isCallJoinable(c as any, nowTick))
    .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime());
  const nextCall = pickDisplayedCall(widgetCandidates, nowTick);

  // Rapports en attente : calls Calendly passés sans rapport rempli
  // outcome = source de vérité : null = pas rempli, renseigné = rempli (tous les chemins du formulaire écrivent outcome)
  const pendingRapports = calls.filter(c =>
    c.call_type === 'calendly' &&
    c.outcome === null &&
    c.status === 'active' &&
    c.scheduled_at !== null &&
    new Date(c.scheduled_at).getTime() <= nowTick
  );

  async function handleAccept(callId: string) {
    setRespondingId(callId);
    const res = await fetch(`/api/calls/${callId}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response: 'accepted' }),
    });
    if (res.ok) {
      setCalls(prev => prev.map(c => c.id === callId ? { ...c, status: 'active' } : c));
    }
    setRespondingId(null);
  }

  async function handleDecline(callId: string, proposed: string) {
    setRespondingId(callId);
    const res = await fetch(`/api/calls/${callId}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response: 'declined', proposedAt: proposed || undefined }),
    });
    if (res.ok) {
      setCalls(prev => prev.map(c => c.id === callId ? { ...c, status: 'declined' } : c));
    }
    setRespondingId(null);
    setDeclineModal(null);
    setProposedAt('');
  }

  async function syncCalendly() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch('/api/calendly/sync', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        setSyncMsg(data.synced > 0 ? `${data.synced} call${data.synced > 1 ? 's' : ''} synchronisé${data.synced > 1 ? 's' : ''}` : 'Aucun nouveau call trouvé');
        await refetchCalls();
      } else {
        setSyncMsg(data.error || 'Erreur lors de la synchronisation');
      }
    } catch {
      setSyncMsg('Erreur réseau');
    }
    setSyncing(false);
    setTimeout(() => setSyncMsg(null), 4000);
  }

  // Squelette calque sur la page : titre, chips de filtre, cartes de call.
  if (loading) return (
    <div className="page-content">
      <div className="page-header">
        <Skeleton width={90} height={22} />
      </div>
      {/* Rangee de chips de filtre, puis cartes de call : avatar, identite,
          heure a droite. Memes dimensions que le rendu reel. */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        {[74, 82, 90, 96].map((w, i) => (
          <Skeleton key={i} width={w} height={32} radius={20} />
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px' }}>
            <Skeleton width={38} height={38} radius={19} />
            <div style={{ flex: 1 }}>
              <Skeleton width={`${46 - i * 5}%`} height={13} />
              <Skeleton width="28%" height={11} style={{ marginTop: 7 }} />
            </div>
            <Skeleton width={54} height={12} />
          </div>
        ))}
      </div>
    </div>
  );

  function getCallCounterpart(call: Call) {
    if (isCoachingCall(call)) {
      return { id: 'coach', name: client?.coachFullName || client?.coachName || 'Coach', initials: null, avatar_url: client?.coachAvatarUrl };
    }
    const name = call.invitee_name || 'Prospect';
    return { id: call.id, name, initials: getInitials(name), avatar_url: null };
  }

  // Boutons propres à l'élève : Rapport de vente sur ses propres calls Calendly,
  // Infos quand il y a quelque chose à consulter. Jamais de rapport de session —
  // c'est le coach qui le remplit, l'élève ne fait qu'annoter (MyCallNotes).
  function renderActions(call: Call, variant: 'upcoming' | 'history' | 'canceled') {
    const rapportPending = call.call_type === 'calendly' && call.no_show === null && call.status === 'active';
    // La modale est devenue le seul point d'accès aux notes et commentaires, et
    // le seul endroit où l'élève peut SAISIR ses notes perso : le bouton s'affiche
    // donc sur tout call de coaching, et sur tout call de vente ayant du contenu.
    const showInfos = variant === 'history'
      && (isCoachingCall(call) || call.fathom_status === 'matched'
        || sessionReportsByCall[call.id]?.attended != null
        || call.outcome != null || !!call.notes || !!call.lead_rapport_comment);

    return (
      <>
        {variant === 'history' && rapportPending && (
          <button
            className="btn-ghost call-action-rapport"
            type="button"
            onClick={() => setRapportModal({ callId: call.id, inviteeName: call.invitee_name, scheduledAt: call.scheduled_at, isFollowUp: (call as { is_follow_up?: boolean | null }).is_follow_up === true })}
          >
            <Icon name="alert-triangle" size={13} />Rapport
          </button>
        )}
        {showInfos && (
          <button
            type="button"
            className="btn-ghost call-action-infos"
            onClick={() => setInfosModalCall(call)}
          >
            Infos
          </button>
        )}
        {variant === 'canceled' && (
          confirmDismissId === call.id ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>Retirer ?</span>
              <button
                type="button"
                className="btn-ghost call-confirm-btn"
                onClick={async () => {
                  setDismissingCanceledId(call.id);
                  setConfirmDismissId(null);
                  try {
                    const res = await fetch(`/api/client/calls/${call.id}`, { method: 'DELETE' });
                    if (res.ok) setCalls(prev => prev.filter(c => c.id !== call.id));
                    else {
                      // Le serveur refuse quand un deal est signé sur cet appel : sans
                      // ce message, le bouton semblait simplement ne rien faire.
                      const data = await res.json().catch(() => null);
                      notifyError(data?.error ?? "Cet appel n'a pas pu être retiré.");
                    }
                  } finally {
                    setDismissingCanceledId(null);
                  }
                }}
                disabled={dismissingCanceledId === call.id}
                style={{ fontSize: 12, color: 'var(--red)', border: '1px solid var(--red)' }}
              >
                {dismissingCanceledId === call.id ? '…' : 'Oui'}
              </button>
              <button
                type="button"
                className="btn-ghost call-confirm-btn"
                onClick={() => setConfirmDismissId(null)}
                style={{ fontSize: 12, border: '1px solid var(--border)' }}
              >
                Non
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setConfirmDismissId(call.id)}
              disabled={dismissingCanceledId === call.id}
              style={{ fontSize: 12, color: 'var(--accent)', border: '1px solid var(--border)', display: 'inline-flex', alignItems: 'center', gap: 5 }}
            >
              <Icon name="trash" size={13} />
              {dismissingCanceledId === call.id ? '…' : 'Retirer'}
            </button>
          )
        )}
      </>
    );
  }

  // Blocs rendus SOUS la carte : notes du coach, commentaire perso de l'élève sur
  // un call de vente, et accordéon de notes personnelles sur un coaching.
  function renderExtra(call: Call) {
    // Plus rien sous la carte : notes du coach, commentaire perso et accordéon de
    // notes vivent désormais dans la modale Infos. Un texte libre de longueur
    // imprévisible dans une liste étirait la carte et déséquilibrait le rail.
    return null;
  }

  // Liste de cartes groupées par période, avec séparateurs collants. Structure
  // strictement identique à celle du coach — seules les actions diffèrent.
  function renderCallList(
    list: Call[],
    variant: 'upcoming' | 'history' | 'canceled',
    emptyMsg: string | null,
    opts?: { paginate?: boolean }
  ) {
    if (list.length === 0) return emptyMsg ? (
      <div className="card" style={{ padding: '32px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>{emptyMsg}</div>
      </div>
    ) : null;

    const groups = groupCallsByPeriod(list, nowTick);
    const paginate = opts?.paginate && historyLimited;
    const shown = paginate ? groups.slice(0, VISIBLE_PERIODS) : groups;
    const hiddenCount = groups.slice(VISIBLE_PERIODS).reduce((n, g) => n + g.calls.length, 0);

    return (
      <div>
        {shown.map(group => (
          <div key={group.key}>
            <div className="call-period-sep"><span>{group.label}</span></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 18 }}>
              {group.calls.map(call => {
                const cp = getCallCounterpart(call);
                return (
                  <CallCard
                    key={call.id}
                    call={call}
                    variant={variant}
                    displayName={cp.name}
                    initials={cp.initials || getInitials(cp.name)}
                    avatarUrl={cp.avatar_url}
                    seed={cp.id}
                    now={nowTick}
                    actions={renderActions(call, variant)}
                  >
                    {variant === 'history' ? renderExtra(call) : null}
                  </CallCard>
                );
              })}
            </div>
          </div>
        ))}
        {paginate && hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setHistoryLimited(false)}
            className="card"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '100%', padding: '16px 20px', fontSize: 14, fontWeight: 600,
              color: 'var(--accent)', cursor: 'pointer', border: '1px dashed var(--border)',
            }}
          >
            Voir les périodes précédentes ({hiddenCount} call{hiddenCount > 1 ? 's' : ''})
          </button>
        )}
      </div>
    );
  }

  // Sections "À venir" + "Historique" empilées — utilisées par les onglets Ventes/Coachings.
  function renderStackedSections(upcomingList: Call[], historyList: Call[], upcomingEmptyMsg: string, historyEmptyMsg: string) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
        <div>
          <div className="eyebrow-sm" style={{ color: 'var(--muted)', marginBottom: 10 }}>À venir</div>
          {renderCallList(upcomingList, 'upcoming', upcomingEmptyMsg)}
        </div>
        <div>
          <div className="eyebrow-sm" style={{ color: 'var(--muted)', marginBottom: 10 }}>Historique</div>
          {renderCallList(historyList, 'history', historyEmptyMsg)}
        </div>
      </div>
    );
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <h1 className="page-title">Calls</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {syncMsg && (
            <span style={{ fontSize: 12, color: syncMsg.includes('Erreur') ? 'var(--red)' : 'var(--green)' }}>
              {syncMsg}
            </span>
          )}
          <button
            className="btn-ghost call-action-sync"
            type="button"
            onClick={syncCalendly}
            disabled={syncing}
            style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Icon name="refresh-cw" size={13} />
            {syncing ? 'Sync…' : 'Sync calls'}
          </button>
        </div>
      </div>

      {/* Rapports en attente — carrousel partagé avec les deux accueils. Flèches à
          44 px ici (et 32 ailleurs) : cet écran est le plus utilisé au doigt, la
          cible tactile y était volontairement plus grande. */}
      <PendingRapportCard
        arrowSize={44}
        marginBottom={24}
        items={pendingRapports.map(call => ({
          id: call.id,
          // Ici l'item EST un call : les deux coïncident, contrairement aux accueils
          // qui partent de notifications.
          callId: call.id,
          title: call.invitee_name ? `Appel avec ${call.invitee_name}` : call.topic || 'Appel découverte',
          scheduledAt: call.scheduled_at,
          duration: call.duration,
        }))}
        onOpen={(_item, index) => {
          const call = pendingRapports[index];
          if (call) setRapportModal({ callId: call.id, inviteeName: call.invitee_name, scheduledAt: call.scheduled_at });
        }}
      />

      {/* Demandes de call en attente d'acceptation (Google Calendar) */}
      {pendingCalls.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div className="eyebrow-lg" style={{ color: '#f59e0b', marginBottom: 10 }}>
            {pendingCalls.length} demande{pendingCalls.length > 1 ? 's' : ''} en attente
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {pendingCalls.map(call => {
              const d = new Date(call.scheduled_at!);
              const dateStr = formatDateIn(d, viewerTz);
              const timeStr = formatTimeIn(d, viewerTz);
              return (
                <div key={call.id} className="card" style={{ borderLeft: '3px solid var(--amber)', padding: '18px 20px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <div>
                      {/* Prénom du coach plutôt que "ton coach" : l'élève sait de qui
                          vient l'invitation sans avoir à deviner. Repli sur la formule
                          générique tant que le profil du coach n'est pas chargé. */}
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#92400e', marginBottom: 4 }}>
                        {(client?.coachName || 'TON COACH').toUpperCase()} TE PROPOSE UN CALL
                      </div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)', textTransform: 'capitalize' }}>{dateStr}</div>
                      <div style={{ fontSize: 13, color: 'var(--accent)', marginTop: 2 }}>
                        {timeStr}
                        {call.duration && <span style={{ color: 'var(--muted)', fontWeight: 400, marginLeft: 8 }}>· {call.duration}</span>}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{call.topic || 'Call coaching'}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                      <button
                        className="btn-primary-brand"
                        type="button"
                        onClick={() => handleAccept(call.id)}
                        disabled={respondingId === call.id}
                        style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 5 }}
                      >
                        <Icon name="check" size={13} />
                        {respondingId === call.id ? '…' : 'Accepter'}
                      </button>
                      <button
                        className="btn-ghost call-action-decline"
                        type="button"
                        onClick={() => setDeclineModal({ callId: call.id, topic: call.topic || 'Call coaching', scheduledAt: call.scheduled_at! })}
                        disabled={respondingId === call.id}
                        style={{ fontSize: 13, color: 'var(--red)' }}
                      >
                        Refuser
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Pas de Calendly connecté */}
      {!hasCalendly && (
        <div className="card" style={{ padding: '32px 24px', textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 28, marginBottom: 10 }}>📅</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)', marginBottom: 6 }}>Calendly non connecté</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16, lineHeight: 1.6 }}>
            Connecte ton Calendly pour voir tes calls ici automatiquement dès qu'ils sont planifiés.
          </div>
          <a href="/client/settings" className="btn-primary-brand" style={{ fontSize: 13, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon name="link" size={13} /> Connecter Calendly
          </a>
        </div>
      )}

      {/* Prochain call */}
      {nextCall ? (
        <div className="next-call-banner card" style={{ marginBottom: 24, borderLeft: '3px solid var(--accent-brand)', padding: '24px 28px' }}>
          <div className="next-call-banner-top">
            <Avatar
              initials={getCallCounterpart(nextCall).initials || getInitials(getCallCounterpart(nextCall).name)}
              avatarUrl={getCallCounterpart(nextCall).avatar_url}
              size={52}
              seed={getCallCounterpart(nextCall).id}
              className="next-call-banner-avatar"
            />
            <div className="next-call-banner-info">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>PROCHAIN CALL</span>
                <CallTypeBadge call={nextCall} />
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent)', lineHeight: 1.2 }}>
                {formatCallLongDate(nextCall.scheduled_at!, viewerTz)}
              </div>
              <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--accent)', marginTop: 4 }}>
                {formatCallTime(nextCall.scheduled_at!, viewerTz)}
                {nextCall.duration && <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 400, marginLeft: 8 }}>· {nextCall.duration}</span>}
              </div>
              {nextCall.invitee_name && (
                <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>avec {nextCall.invitee_name}</div>
              )}
              <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: nextCall.invitee_name ? 2 : 8 }}>
                {nextCall.topic || 'Session de coaching'}
              </div>
              {nextCall.join_url && isCallJoinable(nextCall as any, nowTick) && (
                <a href={nextCall.join_url} target="_blank" rel="noopener noreferrer" className="btn-primary-brand next-call-banner-join" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, marginTop: 16, padding: '8px 16px' }}>
                  <Icon name="video" size={14} /> Rejoindre le call
                </a>
              )}
            </div>
            <div className="next-call-banner-countdown" style={{ background: 'var(--surface-2)', borderRadius: 12, textAlign: 'center' }}>
              {(() => {
                const days = daysUntil(nextCall.scheduled_at!);
                return (
                  <>
                    <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
                      {days <= 0 ? 'Auj.' : `J-${days}`}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                      {days <= 0 ? "C'est aujourd'hui !" : days === 1 ? 'Demain' : `dans ${days} jours`}
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      ) : null}

      {/* Onglets de filtrage — À venir/Historique mélangent tous les types, Prospects/Coachings
          filtrent par type avec leurs propres sections À venir + Historique, Annulés liste direct. */}
      <div className="chip-scroll" style={{ display: 'flex', gap: 6, marginTop: 8, marginBottom: 20, overflowX: 'auto' }}>
        <button className={`chip${tab === 'upcoming' ? ' chip-active' : ''}`} onClick={() => setTab('upcoming')} type="button">
          À venir ({upcoming.length})
        </button>
        <button className={`chip${tab === 'history' ? ' chip-active' : ''}`} onClick={() => setTab('history')} type="button">
          Historique ({history.length})
        </button>
        <button className={`chip${tab === 'prospects' ? ' chip-active' : ''}`} onClick={() => setTab('prospects')} type="button">
          Ventes ({salesUpcoming.length + salesHistory.length})
        </button>
        <button className={`chip${tab === 'coachings' ? ' chip-active' : ''}`} onClick={() => setTab('coachings')} type="button">
          Coachings ({coachingUpcoming.length + coachingHistory.length})
        </button>
        <button className={`chip${tab === 'canceled' ? ' chip-active' : ''}`} onClick={() => setTab('canceled')} type="button">
          Annulés ({canceledCalls.length})
        </button>
      </div>

      {tab === 'upcoming' && renderCallList(upcoming, 'upcoming', 'Aucun call à venir.')}

      {tab === 'history' && renderCallList(history, 'history', "Aucun call dans l'historique.", { paginate: true })}

      {tab === 'prospects' && renderStackedSections(
        salesUpcoming, salesHistory,
        'Aucun call de vente à venir.', "Aucun call de vente dans l'historique."
      )}

      {tab === 'coachings' && renderStackedSections(
        coachingUpcoming, coachingHistory,
        'Aucun call coaching à venir.', "Aucun call coaching dans l'historique."
      )}

      {tab === 'canceled' && renderCallList(canceledCalls, 'canceled', 'Aucun call annulé.')}

      {/* Modal rapport */}
      {rapportModal && (
        <RapportModal
          callId={rapportModal.callId}
          inviteeName={rapportModal.inviteeName}
          scheduledAt={rapportModal.scheduledAt}
          isFollowUp={rapportModal.isFollowUp}
          existing={rapportModal.existing}
          onClose={closeRapportModal}
        />
      )}

      {infosModalCall && (
        <CallInfosModal
          counterpartName={infosModalCall.invitee_name}
          scheduledAt={infosModalCall.scheduled_at}
          // Présence et thème sont partagés avec l'élève (la modale du coach le lui
          // indique au moment de la saisie). Les notes du rapport de session, elles,
          // sont marquées "Privé, visible coach uniquement" et ne sont donc ni
          // chargées ni passées ici — `notes` reste null quoi qu'il arrive.
          attended={sessionReportsByCall[infosModalCall.id]?.attended ?? (infosModalCall.outcome != null ? infosModalCall.outcome !== 'no_show' : undefined)}
          topic={(sessionReportsByCall[infosModalCall.id]?.topic ?? null) as never}
          topicCustom={sessionReportsByCall[infosModalCall.id]?.topic_custom ?? null}
          notes={null}
          leadComment={infosModalCall.call_type === 'calendly' ? infosModalCall.lead_rapport_comment : null}
          outcome={infosModalCall.call_type === 'calendly' ? infosModalCall.outcome : null}
          objection={infosModalCall.call_type === 'calendly' ? infosModalCall.objection : null}
          objectionAutre={infosModalCall.call_type === 'calendly' ? infosModalCall.objection_autre : null}
          relanceAt={infosModalCall.call_type === 'calendly' ? infosModalCall.relance_at : null}
          // Calls de vente déjà rapportés : permet de corriger un montant mal saisi ou un
          // deal enregistré sur la mauvaise personne. Sans ce chemin, un rapport rempli
          // était définitif (voir docs/tracking-prospect.md). Ferme la modale de lecture
          // et rouvre RapportModal pré-rempli.
          onEditRapport={infosModalCall.call_type === 'calendly' && infosModalCall.outcome != null ? () => {
            const call = infosModalCall;
            setInfosModalCall(null);
            setRapportModal({
              callId: call.id,
              inviteeName: call.invitee_name,
              scheduledAt: call.scheduled_at,
              isFollowUp: (call as { is_follow_up?: boolean | null }).is_follow_up === true,
              existing: { revenue: call.revenue ?? null, comment: call.lead_rapport_comment ?? null },
            });
          } : undefined}
          editableNotes={infosModalCall.call_type !== 'calendly' ? (
            <MyCallNotes
              callId={infosModalCall.id}
              initialNotes={sessionReportsByCall[infosModalCall.id]?.student_notes || ''}
              initialDismissed={sessionReportsByCall[infosModalCall.id]?.student_notes_dismissed || false}
            />
          ) : undefined}
          studentNotes={null}
          fathomData={{
            shareUrl: infosModalCall.fathom_share_url ?? null,
            summary: infosModalCall.fathom_summary ?? null,
            actionItems: infosModalCall.fathom_action_items ?? null,
            // Transcript chargé à la demande au clic (~40 Ko/call, sinon
            // transféré sur tout l'historique à chaque affichage de la page).
            // Voir CALL_COLUMNS.
            transcript: null,
            callId: infosModalCall.id,
            hasTranscript: infosModalCall.has_fathom_transcript === true,
          }}
          onClose={() => setInfosModalCall(null)}
        />
      )}

      {/* Modale refus avec créneau alternatif */}
      {declineModal && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={e => { if (e.target === e.currentTarget) { setDeclineModal(null); setProposedAt(''); } }}
        >
          <div className="card" style={{ width: '100%', maxWidth: 400, padding: 24, margin: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)', marginBottom: 8 }}>Refuser ce call</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16, lineHeight: 1.5 }}>
              {declineModal.topic} · {formatDateIn(new Date(declineModal.scheduledAt), viewerTz)}
            </div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>
              Proposer un autre créneau (optionnel)
            </label>
            <input
              className="input"
              type="text"
              placeholder="Ex : jeudi 12 juin après 14h"
              value={proposedAt}
              onChange={e => setProposedAt(e.target.value)}
              style={{ width: '100%', marginBottom: 16 }}
              autoFocus
            />
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn-ghost" type="button" style={{ flex: 1 }} onClick={() => { setDeclineModal(null); setProposedAt(''); }}>
                Annuler
              </button>
              <button
                className="btn-primary-brand"
                type="button"
                style={{ flex: 1, background: 'var(--red, #ef4444)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                onClick={() => handleDecline(declineModal.callId, proposedAt)}
                disabled={respondingId === declineModal.callId}
              >
                {respondingId === declineModal.callId ? '…' : 'Confirmer le refus'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
