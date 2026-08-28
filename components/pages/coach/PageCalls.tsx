'use client';

import { type RapportExistant } from '@/lib/rapportPatch';
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useEscapeKey } from '@/lib/useEscapeKey';
import Icon from '@/components/ui/Icon';
import { Skeleton } from '@/components/ui/Skeleton';
import Avatar, { getInitials } from '@/components/ui/Avatar';
import SessionRapportModal from '@/components/ui/SessionRapportModalLoader';
import RapportModal from '@/components/ui/RapportModalLoader';
import CreateCallModal from '@/components/ui/CreateCallModal';
import FathomUnmatchedTab from '@/components/ui/FathomUnmatchedTab';
import CallInfosModal from '@/components/ui/CallInfosModal';
import { useSupabaseClients } from '@/lib/SupabaseClientsContext';
import { createClient } from '@/lib/supabase/client';
import { getPendingSessionRapports, isCallReallyOver, isCallJoinable, isCallCanceled, isCoachingCall, pickDisplayedCall } from '@/lib/sessionRapport';
import CallCard from '@/components/ui/CallCard';
import { CallTypeBadge } from '@/components/ui/CallBadges';
import { formatCallLongDate, formatCallTime, groupCallsByPeriod } from '@/lib/callFormat';
import type { Call } from '@/lib/supabase/types';
import { useViewerTimeZone } from '@/lib/UserContext';

type Tab = 'upcoming' | 'history' | 'prospects' | 'coachings' | 'canceled' | 'unmatched';

// Nombre de périodes (semaine/mois) affichées avant le bouton "Voir plus". Remplace
// l'ancien découpage à N calls, qui coupait au milieu d'un mois.
const VISIBLE_PERIODS = 2;

export default function PageCalls() {
  const [tab, setTab] = useState<Tab>('upcoming');
  const viewerTz = useViewerTimeZone();
  const { calls, clients, loading, refetch } = useSupabaseClients();
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  // Modal création
  const [showModal, setShowModal] = useState(false);

  // Annulation / suppression (2 étapes)
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
  // Confirmation d'annulation : couche modale, Echap la ferme.
  useEscapeKey(() => setConfirmCancelId(null), confirmCancelId !== null);

  // Rapports de session Google Meet en attente — même condition que le badge élève
  const [openSessionRapportCall, setOpenSessionRapportCall] = useState<{ callId: string; clientName: string | null; scheduledAt: string | null; call: Call } | null>(null);
  const pendingSessionRapportIds = new Set(getPendingSessionRapports(calls as Call[]).map(c => c.id));

  // Modale de consultation (rapport déjà rempli + infos Fathom) — jamais de formulaire.
  const [infosModalCall, setInfosModalCall] = useState<{ call: Call; clientName: string | null } | null>(null);

  // Rapport de vente pour les calls Calendly du coach lui-même (coach_id = son propre
  // profile_id, cf. docs/calls-coach-id-piege.md). Jamais pour les calls de ses élèves.
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);
  // `existing` renseigné uniquement en mode correction (rapport déjà rempli qu'on rouvre).
  const [openSalesRapportCall, setOpenSalesRapportCall] = useState<{ callId: string; inviteeName: string | null; scheduledAt: string | null; isFollowUp: boolean; existing?: RapportExistant | null } | null>(null);

  // Historique paginé par période — les 2 premières (semaine/mois courant) sont
  // affichées, le reste derrière un bouton.
  const [historyExpanded, setHistoryExpanded] = useState(false);

  // Force un recalcul du split upcoming/historique chaque minute, pour que la
  // bascule se fasse en temps réel sans dépendre uniquement des changements
  // de `calls` déclenchés par le realtime.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, []);

  async function syncCalls() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch('/api/calendly/sync', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        await refetch();
        setSyncMsg(data.synced > 0
          ? `${data.synced} call${data.synced > 1 ? 's' : ''} Calendly synchronisé${data.synced > 1 ? 's' : ''}`
          : 'Calls à jour');
      } else {
        setSyncMsg(data.error || 'Erreur');
      }
    } catch {
      setSyncMsg('Erreur réseau');
    }
    setSyncing(false);
    setTimeout(() => setSyncMsg(null), 4000);
  }

  function handleCallCreated() {
    refetch();
    setSyncMsg('✓ Call créé — invitation envoyée à l\'élève');
    setTimeout(() => setSyncMsg(null), 5000);
  }

  async function handleCancelCall(callId: string) {
    setCancelingId(callId);
    try {
      const res = await fetch(`/api/calls/${callId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'canceled' }),
      });
      const data = await res.json();
      if (data.ok) {
        await refetch();
        setSyncMsg('Call annulé — visible rayé pour l\'élève');
        setTimeout(() => setSyncMsg(null), 4000);
      } else {
        setSyncMsg(data.error || 'Erreur annulation');
        setTimeout(() => setSyncMsg(null), 4000);
      }
    } catch {
      setSyncMsg('Erreur réseau');
      setTimeout(() => setSyncMsg(null), 4000);
    }
    setCancelingId(null);
  }

  async function handleDeleteCall(callId: string) {
    setDeletingId(callId);
    setConfirmDeleteId(null);
    try {
      const res = await fetch(`/api/calls/${callId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.ok) {
        await refetch();
        setSyncMsg('Call retiré de l\'interface');
        setTimeout(() => setSyncMsg(null), 4000);
      } else {
        setSyncMsg(data.error || 'Erreur suppression');
        setTimeout(() => setSyncMsg(null), 4000);
      }
    } catch {
      setSyncMsg('Erreur réseau');
      setTimeout(() => setSyncMsg(null), 4000);
    }
    setDeletingId(null);
  }

  // La liste "À venir" inclut aussi les calls encore dans leur fenêtre de rattrapage
  // (isCallJoinable, 15min après la fin théorique) — pas seulement !isCallReallyOver
  // strict — pour que le bouton Rejoindre reste visible pendant le rattrapage.
  // nowTick force ce recalcul chaque minute (voir useEffect ci-dessus).
  const upcoming = calls
    .filter(c => c.scheduled_at && isCallJoinable(c, nowTick))
    .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime());
  // Historique : réellement terminé ET plus joignable.
  //
  // Le `!isCallJoinable` est indispensable : isCallReallyOver bascule dès la fin
  // théorique, mais isCallJoinable reste vrai 15 min de plus (fenêtre de rattrapage
  // pour le bouton Rejoindre). Sans cette exclusion, un call qui vient de se
  // terminer appartenait aux DEUX listes pendant 15 minutes — donc affiché deux
  // fois dans les onglets Ventes/Coachings/Annulés (une fois en "À venir", une fois
  // en "Historique") et compté deux fois dans leur badge.
  const history = calls
    .filter(c => c.scheduled_at && isCallReallyOver(c, nowTick) && !isCallJoinable(c, nowTick))
    .sort((a, b) => new Date(b.scheduled_at!).getTime() - new Date(a.scheduled_at!).getTime());
  const upcomingActive = upcoming.filter(c => c.status === 'active');

  const nextCall = pickDisplayedCall(upcomingActive, nowTick);
  const pending = calls.filter(c => c.status === 'pending_acceptance');

  // Onglets Ventes / Coachings / Annulés — chacun affiche ses propres sections
  // "À venir" puis "Historique" en dessous, indépendamment de l'onglet À venir/Historique
  // principal (qui, lui, mélange tous les types sans filtre).
  const salesUpcoming = upcoming.filter(c => !isCoachingCall(c) && !isCallCanceled(c));
  const salesHistory = history.filter(c => !isCoachingCall(c));
  const coachingUpcoming = upcoming.filter(c => isCoachingCall(c) && !isCallCanceled(c));
  const coachingHistory = history.filter(c => isCoachingCall(c));
  const canceledUpcoming = upcoming.filter(isCallCanceled);
  const canceledHistory = history.filter(isCallCanceled);

  // Le coach n'a de calls de vente que s'il a connecté son PROPRE Calendly (ses
  // calls, pas ceux de ses élèves — cf. docs/calls-coach-id-piege.md). Sans ça
  // l'onglet est vide sans explication.
  const hasOwnSalesCalls = salesUpcoming.length + salesHistory.length > 0;

  function getClient(clientId: string) {
    return clients.find(c => c.id === clientId);
  }

  // Identité de l'interlocuteur — le client lié pour un coaching, l'invité Calendly
  // pour un call de vente.
  function getCounterpart(call: Call) {
    const cl = getClient(call.client_id || '');
    return {
      displayName: cl?.name || call.invitee_name || call.invitee_email || '—',
      initials: cl?.initials || getInitials(call.invitee_name),
      avatarUrl: cl?.avatar_url ?? null,
      seed: cl?.id,
      client: cl,
    };
  }

  // Boutons propres au coach : Annuler/Retirer sur les coachings, Rapport quand il
  // en reste un à remplir, Infos quand il y a quelque chose à consulter.
  function renderActions(call: Call, variant: 'upcoming' | 'history' | 'canceled') {
    const cl = getClient(call.client_id || '');
    const coaching = isCoachingCall(call);
    const canceled = isCallCanceled(call);
    const showInfos = variant === 'history' && (call.fathom_status === 'matched' || call.session_completed || call.session_no_show || call.outcome != null);

    return (
      <>
        {coaching && pendingSessionRapportIds.has(call.id) && (
          <button type="button" className="btn-ghost call-action-rapport"
            onClick={() => setOpenSessionRapportCall({ callId: call.id, clientName: cl?.name ?? null, scheduledAt: call.scheduled_at, call })}>
            <Icon name="alert-triangle" size={13} />Rapport
          </button>
        )}
        {/* `!canceled` : un call annulé n'a pas eu lieu, il n'y a rien à rapporter.
            Le bouton s'affichait pourtant dans l'onglet Annulés, alors que son
            équivalent coaching juste au-dessus était déjà protégé (la liste
            pendingSessionRapportIds vient de getPendingSessionRapports, qui filtre
            sur status === 'active'). */}
        {!coaching && !canceled && call.coach_id === userId && call.outcome == null && (
          <button type="button" className="btn-ghost call-action-rapport"
            onClick={() => setOpenSalesRapportCall({ callId: call.id, inviteeName: call.invitee_name, scheduledAt: call.scheduled_at, isFollowUp: call.is_follow_up === true })}>
            <Icon name="alert-triangle" size={13} />Rapport
          </button>
        )}
        {showInfos && (
          <button type="button" className="btn-ghost call-action-infos"
            onClick={() => setInfosModalCall({ call, clientName: cl?.name ?? null })}>
            Infos
          </button>
        )}
        {coaching && variant !== 'history' && (
          confirmDeleteId === call.id ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>Retirer ?</span>
              <button className="btn-ghost call-confirm-btn" type="button" onClick={() => handleDeleteCall(call.id)} disabled={deletingId === call.id}
                style={{ fontSize: 12, color: 'var(--red)', border: '1px solid var(--red)' }}>{deletingId === call.id ? '…' : 'Oui'}</button>
              <button className="btn-ghost call-confirm-btn" type="button" onClick={() => setConfirmDeleteId(null)}
                style={{ fontSize: 12, border: '1px solid var(--border)' }}>Non</button>
            </div>
          ) : (
            <button className="btn-ghost call-action-cancel" type="button"
              onClick={() => canceled ? setConfirmDeleteId(call.id) : setConfirmCancelId(call.id)}
              disabled={cancelingId === call.id}
              style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--red)', border: '1px solid var(--red)' }}>
              <Icon name={canceled ? 'trash' : 'x'} size={13} />
              {cancelingId === call.id ? '…' : canceled ? 'Retirer' : 'Annuler'}
            </button>
          )
        )}
      </>
    );
  }

  // Liste de cartes groupées par période, avec séparateurs collants. Une seule
  // fonction pour tous les onglets : la variante ne change que les badges et les
  // actions, jamais la structure.
  function renderCallList(
    list: Call[],
    variant: 'upcoming' | 'history' | 'canceled',
    emptyMsg: string,
    opts?: { paginate?: boolean }
  ) {
    if (list.length === 0) return (
      <div className="card" style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--muted)', fontSize: 13 }}>
        {emptyMsg}
      </div>
    );

    const groups = groupCallsByPeriod(list, nowTick);
    const paginate = opts?.paginate && !historyExpanded;
    const shown = paginate ? groups.slice(0, VISIBLE_PERIODS) : groups;
    const hiddenCount = groups.slice(VISIBLE_PERIODS).reduce((n, g) => n + g.calls.length, 0);

    return (
      <div>
        {shown.map(group => (
          <div key={group.key}>
            <div className="call-period-sep"><span>{group.label}</span></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 18 }}>
              {group.calls.map(call => {
                const cp = getCounterpart(call);
                return (
                  <CallCard
                    key={call.id}
                    call={call}
                    variant={variant}
                    displayName={cp.displayName}
                    initials={cp.initials}
                    avatarUrl={cp.avatarUrl}
                    seed={cp.seed}
                    now={nowTick}
                    actions={renderActions(call, variant)}
                  />
                );
              })}
            </div>
          </div>
        ))}
        {paginate && hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setHistoryExpanded(true)}
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

  // Sections "À venir" + "Historique" empilées, utilisées par les onglets
  // Ventes/Coachings/Annulés — même pattern, juste des listes/messages différents.
  function renderStackedSections(
    upcomingList: Call[],
    historyList: Call[],
    upcomingEmptyMsg: string,
    historyEmptyMsg: string,
    canceledVariant = false
  ) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
        <div>
          <div className="eyebrow-sm" style={{ color: 'var(--muted)', marginBottom: 10 }}>À venir</div>
          {renderCallList(upcomingList, canceledVariant ? 'canceled' : 'upcoming', upcomingEmptyMsg)}
        </div>
        <div>
          <div className="eyebrow-sm" style={{ color: 'var(--muted)', marginBottom: 10 }}>Historique</div>
          {renderCallList(historyList, canceledVariant ? 'canceled' : 'history', historyEmptyMsg)}
        </div>
      </div>
    );
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

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1 className="page-title">Calls</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {syncMsg && (
            <span style={{ fontSize: 12, color: syncMsg.includes('Erreur') ? 'var(--red)' : 'var(--green)' }}>
              {syncMsg}
            </span>
          )}
          <button className="btn-ghost call-action-sync" type="button" onClick={syncCalls} disabled={syncing}
            style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon name="refresh-cw" size={13} />
            {syncing ? 'Sync…' : 'Sync calls'}
          </button>
          <button
            className="btn-primary-brand"
            type="button"
            onClick={() => setShowModal(true)}
            style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Icon name="plus" size={13} />
            Créer un call
          </button>
        </div>
      </div>

      {/* Prochain call — mêmes classes .next-call-banner-* que côté élève, qui
          portent tout le responsive (avatar masqué, compteur réduit, bouton pleine
          largeur). Le bandeau coach n'en avait aucune : il gardait son compteur de
          110px et son texte de 28px sur 375px. */}
      {nextCall?.scheduled_at && (() => {
        const cp = getCounterpart(nextCall);
        return (
          <div className="next-call-banner card" style={{ marginBottom: 20, padding: '24px 24px' }}>
            <div className="next-call-banner-top">
              <Avatar initials={cp.initials} avatarUrl={cp.avatarUrl} size={52} seed={cp.seed} className="next-call-banner-avatar" />
              <div className="next-call-banner-info">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>PROCHAIN CALL</span>
                  <CallTypeBadge call={nextCall} />
                </div>
                <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--accent)', lineHeight: 1.2 }}>
                  {formatCallLongDate(nextCall.scheduled_at, viewerTz)}
                </div>
                <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--accent)', marginTop: 2 }}>
                  {formatCallTime(nextCall.scheduled_at, viewerTz)}
                  {nextCall.duration && <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 400, marginLeft: 8 }}>· {nextCall.duration}</span>}
                </div>
                <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
                  {cp.displayName}{nextCall.topic ? ` · ${nextCall.topic}` : ''}
                </div>
                {nextCall.join_url && isCallJoinable(nextCall, nowTick) && (
                  <a href={nextCall.join_url} target="_blank" rel="noopener noreferrer" className="btn-primary-brand next-call-banner-join"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, textDecoration: 'none', marginTop: 16, padding: '8px 16px' }}>
                    <Icon name="video" size={14} /> Rejoindre le call
                  </a>
                )}
              </div>
              <div className="next-call-banner-countdown" style={{ background: 'var(--surface-2)', borderRadius: 12, textAlign: 'center' }}>
                {(() => {
                  const diffMs = new Date(nextCall.scheduled_at).getTime() - nowTick;
                  const days = Math.ceil(diffMs / 86_400_000);
                  return (
                    <>
                      <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
                        {days <= 0 ? 'Auj.' : `J-${days}`}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                        {days <= 0 ? "C'est aujourd'hui !" : days === 1 ? 'Demain' : `dans ${days} jours`}
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Section calls en attente d'acceptation */}
      {pending.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div className="eyebrow-lg" style={{ color: '#f59e0b', marginBottom: 10 }}>
            En attente d'acceptation ({pending.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {pending.map(call => {
              const cp = getCounterpart(call);
              return (
                <CallCard
                  key={call.id}
                  call={call}
                  variant="pending"
                  displayName={cp.displayName}
                  initials={cp.initials}
                  avatarUrl={cp.avatarUrl}
                  seed={cp.seed}
                  now={nowTick}
                  actions={
                    confirmDeleteId === call.id ? (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <span style={{ fontSize: 12, color: 'var(--muted)' }}>Retirer ?</span>
                        <button className="btn-ghost call-confirm-btn" type="button" onClick={() => handleDeleteCall(call.id)} disabled={deletingId === call.id}
                          style={{ fontSize: 12, color: 'var(--red)', border: '1px solid var(--red)' }}>
                          {deletingId === call.id ? '…' : 'Oui'}
                        </button>
                        <button className="btn-ghost call-confirm-btn" type="button" onClick={() => setConfirmDeleteId(null)}
                          style={{ fontSize: 12, border: '1px solid var(--border)' }}>Non</button>
                      </div>
                    ) : (
                      <button className="btn-ghost call-action-cancel" type="button"
                        onClick={() => isCallCanceled(call) ? setConfirmDeleteId(call.id) : handleCancelCall(call.id)}
                        disabled={cancelingId === call.id}
                        style={{ fontSize: 12, color: 'var(--red)', border: '1px solid var(--red)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <Icon name={isCallCanceled(call) ? 'trash' : 'x'} size={13} />
                        {cancelingId === call.id ? '…' : isCallCanceled(call) ? 'Retirer' : 'Annuler'}
                      </button>
                    )
                  }
                />
              );
            })}
          </div>
        </div>
      )}

      <div className="chip-scroll" style={{ display: 'flex', gap: 6, marginBottom: 20, overflowX: 'auto' }}>
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
          Annulés ({canceledUpcoming.length + canceledHistory.length})
        </button>
        <button className={`chip${tab === 'unmatched' ? ' chip-active' : ''}`} onClick={() => setTab('unmatched')} type="button">
          Autres Fathoms
        </button>
      </div>

      {tab === 'unmatched' && (
        <FathomUnmatchedTab
          calls={calls}
          getClientName={(clientId) => (clientId ? getClient(clientId)?.name ?? null : null)}
          onResolved={refetch}
        />
      )}

      {tab === 'upcoming' && renderCallList(upcoming, 'upcoming', 'Aucun call planifié pour le moment.')}

      {tab === 'history' && renderCallList(history, 'history', "Aucun call dans l'historique.", { paginate: true })}

      {tab === 'prospects' && (
        hasOwnSalesCalls ? renderStackedSections(
          salesUpcoming, salesHistory,
          'Aucun call de vente à venir.', "Aucun call de vente dans l'historique."
        ) : (
          // Le coach n'a pas connecté son propre Calendly : sans ce message, l'onglet
          // est simplement vide et rien n'explique pourquoi.
          <div className="card" style={{ padding: '32px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 28, marginBottom: 10 }}>📅</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)', marginBottom: 6 }}>Aucun call de vente</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16, lineHeight: 1.6 }}>
              Connecte ton propre Calendly pour suivre ici les calls avec tes prospects.
              Les calls de vente de tes élèves restent sur leurs fiches.
            </div>
            <a href="/settings" className="btn-primary-brand" style={{ fontSize: 13, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Icon name="link" size={13} /> Connecter Calendly
            </a>
          </div>
        )
      )}

      {tab === 'coachings' && renderStackedSections(
        coachingUpcoming, coachingHistory,
        'Aucun call coaching à venir.', "Aucun call coaching dans l'historique."
      )}

      {tab === 'canceled' && renderStackedSections(
        canceledUpcoming, canceledHistory,
        'Aucun call annulé à venir.', "Aucun call annulé dans l'historique.",
        true
      )}

      <CreateCallModal
        open={showModal}
        onClose={() => setShowModal(false)}
        onCreated={handleCallCreated}
      />

      {/* Modal confirmation annulation */}
      {confirmCancelId && createPortal(
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}
          onClick={(e) => { if (e.target === e.currentTarget) setConfirmCancelId(null); }}
        >
          <div className="card" style={{ width: '100%', maxWidth: 380, padding: 24, margin: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', marginBottom: 10 }}>Annuler ce call ?</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20, lineHeight: 1.5 }}>
              L'élève sera notifié et l'événement Google Calendar sera supprimé.
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn-ghost" type="button" style={{ flex: 1 }} onClick={() => setConfirmCancelId(null)}>
                Retour
              </button>
              <button
                className="btn-primary-brand"
                type="button"
                style={{ flex: 1, background: '#ef4444', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                disabled={cancelingId === confirmCancelId}
                onClick={async () => {
                  const id = confirmCancelId;
                  setConfirmCancelId(null);
                  await handleCancelCall(id);
                }}
              >
                {cancelingId === confirmCancelId ? '…' : 'Confirmer'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {openSessionRapportCall && (
        <SessionRapportModal
          callId={openSessionRapportCall.callId}
          studentName={openSessionRapportCall.clientName}
          scheduledAt={openSessionRapportCall.scheduledAt}
          onClose={() => { setOpenSessionRapportCall(null); refetch(); }}
        />
      )}

      {openSalesRapportCall && (
        <RapportModal
          callId={openSalesRapportCall.callId}
          inviteeName={openSalesRapportCall.inviteeName}
          scheduledAt={openSalesRapportCall.scheduledAt}
          isFollowUp={openSalesRapportCall.isFollowUp}
          existing={openSalesRapportCall.existing}
          onClose={() => { setOpenSalesRapportCall(null); refetch(); }}
        />
      )}

      {infosModalCall && (() => {
        const { call } = infosModalCall;
        const report = call.client_id
          ? (getClient(call.client_id) as any)?.sessionReports?.find((r: any) => r.call_id === call.id)
          : null;
        return (
          <CallInfosModal
            counterpartName={infosModalCall.clientName}
            scheduledAt={call.scheduled_at}
            attended={report ? report.attended : (call.outcome != null ? call.outcome !== 'no_show' : undefined)}
            topic={report?.topic ?? null}
            topicCustom={report?.topic_custom ?? null}
            notes={report?.notes ?? call.lead_rapport_comment ?? null}
            studentNotes={report?.student_notes ?? null}
            // Calls de vente déjà rapportés : permet de corriger un montant mal saisi ou
            // un deal enregistré sur la mauvaise personne. Même accès que côté élève —
            // chacun corrige ses propres calls (voir docs/tracking-prospect.md).
            onEditRapport={call.call_type === 'calendly' && call.outcome != null ? () => {
              setInfosModalCall(null);
              setOpenSalesRapportCall({
                callId: call.id,
                inviteeName: infosModalCall.clientName,
                scheduledAt: call.scheduled_at,
                isFollowUp: (call as { is_follow_up?: boolean | null }).is_follow_up === true,
                existing: {
                  revenue: call.revenue ?? null,
                  comment: call.lead_rapport_comment ?? null,
                  outcome: call.outcome ?? null,
                  qualified: call.qualified ?? null,
                  objection: call.objection ?? null,
                  objectionAutre: call.objection_autre ?? null,
                  relanceAt: call.relance_at ?? null,
                },
              });
            } : undefined}
            fathomData={{
              shareUrl: call.fathom_share_url ?? null,
              summary: call.fathom_summary ?? null,
              actionItems: call.fathom_action_items ?? null,
              // Transcript chargé à la demande au clic (~40 Ko/call, sinon
              // transféré sur chaque page coach). Voir CALL_COLUMNS.
              transcript: null,
              callId: call.id,
              hasTranscript: (call as { has_fathom_transcript?: boolean }).has_fathom_transcript === true,
            }}
            onClose={() => setInfosModalCall(null)}
          />
        );
      })()}
    </div>
  );
}
