'use client';
import InlineLoader from '@/components/ui/InlineLoader';
import { mutate } from '@/lib/mutate';
import { Skeleton } from '@/components/ui/Skeleton';

import Link from 'next/link';
import Ring from '@/components/ui/Ring';
import Icon from '@/components/ui/Icon';
import { useClientSelfData } from '@/lib/supabase/useCoachData';
import { readAccueilShape, writeAccueilShape, EMPTY_SHAPE, type AccueilShape } from '@/lib/accueilLayoutHint';
import { createClient } from '@/lib/supabase/client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNotifications } from '@/lib/useNotifications';
import { useUser } from '@/lib/UserContext';
import RapportModal from '@/components/ui/RapportModalLoader';
import PendingRapportCard, { type PendingRapportItem } from '@/components/ui/PendingRapportCard';
import { getDeadlineStatus } from '@/lib/clientSignals';
import DeadlineBadge from '@/components/ui/DeadlineBadge';
import TrendBadge from '@/components/ui/TrendBadge';
import { getClientWeek } from '@/lib/clientWeek';
import CallStack from '@/components/ui/CallStack';
import Avatar, { getInitials } from '@/components/ui/Avatar';
import type { Call } from '@/lib/supabase/types';
import { isCallReallyOver, isCallJoinable } from '@/lib/sessionRapport';
import { useViewerTimeZone } from '@/lib/UserContext';
import { formatTimeIn, formatDateIn } from '@/lib/timezone';

const PRIORITY_CONFIG = {
  high:   { label: 'Haute',   color: 'var(--red)',   bg: '#ef444420' },
  medium: { label: 'Moyenne', color: 'var(--amber)', bg: 'var(--amber-soft)' },
  low:    { label: 'Basse',   color: 'var(--green)', bg: '#22c55e20' },
};

function CallRequestInlineButtons({ callId, onRefresh }: { callId: string; onRefresh: () => void }) {
  const [state, setState] = useState<'idle' | 'accepting' | 'declining' | 'done'>('idle');
  async function respond(response: 'accepted' | 'declined') {
    setState(response === 'accepted' ? 'accepting' : 'declining');
    // Le "✓ Réponse envoyée" s'affichait quoi qu'il arrive, meme sur un refus
    // du serveur : l'eleve croyait avoir repondu a son coach alors que rien
    // n'etait enregistre. On revient a 'idle' pour qu'il puisse reessayer.
    const ok = await mutate(`/api/calls/${callId}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response }),
      erreur: "Ta réponse n'a pas pu être envoyée. Réessaie.",
    });
    if (!ok) { setState('idle'); return; }
    setState('done');
    onRefresh();
  }
  if (state === 'done') return <span style={{ fontSize: 12, color: 'var(--green)', fontWeight: 600 }}>✓ Réponse envoyée</span>;
  return (
    <>
      <button type="button" className="btn-primary-brand" onClick={() => respond('accepted')} disabled={state !== 'idle'}
        style={{ fontSize: 12, padding: '7px 14px' }}>
        {state === 'accepting' ? '…' : 'Accepter'}
      </button>
      <button type="button" className="btn-ghost call-action-decline" onClick={() => respond('declined')} disabled={state !== 'idle'}
        style={{ fontSize: 12, fontWeight: 700, background: 'none', color: 'var(--red)', border: '1px solid var(--red)', borderRadius: 8, padding: '7px 14px', cursor: 'pointer' }}>
        {state === 'declining' ? '…' : 'Refuser'}
      </button>
    </>
  );
}

function daysUntil(dateStr: string) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - now.getTime()) / 86400000);
}

function isCoachingCall(call: { call_type?: string | null } | null | undefined) {
  return call?.call_type === 'google';
}

const WIDGET_VISIBILITY_WINDOW_MS = 24 * 3600_000;

// Widget d'accueil : même bascule que la page Calls (vers le suivant dès que le call
// affiché est réellement terminé, peu importe le délai), MAIS n'affiche rien du tout
// si le call à montrer est à plus de 24h — l'accueil est une alerte "call bientôt",
// pas un calendrier complet (contrairement à la page Calls).
function pickAccueilCall(list: Call[], now: number): Call | null {
  const candidates = list.filter(c => c.scheduled_at && isCallJoinable(c, now));
  if (candidates.length === 0) return null;
  const current = candidates[0];
  const next = candidates[1];
  const displayed = (next && isCallReallyOver(current, now)) ? next : current;
  if (!displayed.scheduled_at) return null;
  const startsIn = new Date(displayed.scheduled_at).getTime() - now;
  return startsIn <= WIDGET_VISIBILITY_WINDOW_MS ? displayed : null;
}

export default function PageClientView() {
  const viewerTz = useViewerTimeZone();
  const { data: client, loading } = useClientSelfData();
  const [taskOverrides, setTaskOverrides] = useState<Record<string, boolean>>({});
  const supabase = useRef(createClient()).current;
  const { user } = useUser();
  const { notifs, refresh } = useNotifications(user?.id ?? null, true);
  const rapportNotifs = notifs.filter(n => n.type === 'rapport_call');
  const callRequestNotifs = notifs.filter(n => n.type === 'call_request');
  const [openRapport, setOpenRapport] = useState<typeof rapportNotifs[0] | null>(null);

  // Recalcul local chaque minute (bascule + fenêtre de grâce du widget "Prochain
  // call") — zéro requête réseau, purement sur les données déjà en mémoire.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, []);

  // Forme du dernier passage — même dispositif que l'accueil coach, cloisonné
  // par espace. Lue APRÈS le montage : le stockage local n'existe pas au rendu
  // serveur, et lire pendant le rendu produirait deux sorties différentes.
  const [shape, setShape] = useState<AccueilShape>(EMPTY_SHAPE);
  useEffect(() => { setShape(readAccueilShape('client')); }, []);

  // EXACTEMENT la condition du rendu, pas une approximation : `upcomingCalls`
  // peut etre non vide sans qu'aucun bandeau ne s'affiche (call a plus de 24 h,
  // rapport deja rempli). Reserver la place dans ce cas creerait le saut qu'on
  // cherche a supprimer, dans l'autre sens.
  const hasNextCallNow = !!pickAccueilCall(client?.business?.upcomingCalls ?? [], nowTick);
  useEffect(() => {
    if (loading) return;
    writeAccueilShape('client', {
      hasNextCall: hasNextCallNow,
      pendingRapports: rapportNotifs.length + callRequestNotifs.length,
    });
  }, [loading, hasNextCallNow, rapportNotifs.length, callRequestNotifs.length]);

  const toggleTask = useCallback(async (taskId: string, done: boolean) => {
    setTaskOverrides(prev => ({ ...prev, [taskId]: done }));
    await supabase.from('tasks').update({ done }).eq('id', taskId);
  }, [supabase]);

  // Squelette plutôt qu'un loader centré : il reproduit la structure réelle de
  // la page, donc l'app paraît déjà là et le contenu remplace des formes de
  // mêmes dimensions au lieu de surgir dans le vide.
  //
  // La carte du prochain call n'est dessinée que si l'écran en contenait une au
  // dernier passage. Elle l'était auparavant SYSTÉMATIQUEMENT, alors que le
  // bandeau est conditionnel : sans call, elle disparaissait et tout remontait ;
  // avec un call, la vraie carte est plus haute et poussait tout vers le bas.
  // Voir lib/accueilLayoutHint et docs/pastille-et-sauts-accueil.md.
  if (loading) {
    return (
      <div className="page-content">
        <div className="page-header">
          <div>
            <Skeleton width={160} height={22} />
            <Skeleton width={110} height={12} style={{ marginTop: 8 }} />
          </div>
        </div>
        {shape.hasNextCall && (
          <div className="card" style={{ padding: '18px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <Skeleton width={40} height={40} radius={20} />
              <div style={{ flex: 1 }}>
                <Skeleton width="45%" height={14} />
                <Skeleton width="30%" height={11} style={{ marginTop: 8 }} />
              </div>
            </div>
          </div>
        )}
        {shape.pendingRapports > 0 && (
          <div className="card" style={{ marginTop: shape.hasNextCall ? 20 : 0, padding: '18px 20px' }}>
            <Skeleton width="42%" height={12} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
              <Skeleton width={36} height={36} radius={18} />
              <div style={{ flex: 1 }}>
                <Skeleton width="52%" height={13} />
                <Skeleton width="34%" height={11} style={{ marginTop: 6 }} />
              </div>
            </div>
          </div>
        )}
        <div className="grid-4 client-kpi-grid" style={{ marginTop: 24 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card" style={{ padding: '16px 20px' }}>
              <Skeleton width="70%" height={11} />
              <Skeleton width="45%" height={22} style={{ marginTop: 10 }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="page-content">
        <div style={{ textAlign: 'center', paddingTop: 60 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>👋</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)', marginBottom: 8 }}>Bienvenue sur Momentum</div>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>Ton espace sera disponible dès que ton coach t'aura configuré.</div>
        </div>
      </div>
    );
  }

  // File d'attente unique de l'accueil. L'ordre est délibéré :
  //   1. les demandes de call — le coach attend une réponse, et la date approche ;
  //   2. les rapports, du PLUS ANCIEN au plus récent — un rapport vieillit mal,
  //      passé quelques jours on ne se souvient plus du call.
  const fileAttente: PendingRapportItem[] = [
    ...callRequestNotifs.map(notif => ({
      id: notif.id,
      callId: notif.callId ?? '',
      kicker: `DEMANDE DE CALL${client.coachName ? ` AVEC ${client.coachName.toUpperCase()}` : ''}`,
      title: notif.body,
      scheduledAt: notif.scheduledAt,
      duration: notif.duration,
      // Une invitation n'a pas de brouillon : l'exclure du listing évite une
      // recherche vouée à ne rien trouver.
      trackDraft: false,
      actions: (
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <CallRequestInlineButtons callId={notif.callId!} onRefresh={refresh} />
        </div>
      ),
    })),
    ...[...rapportNotifs]
      .sort((a, b) =>
        new Date(a.scheduledAt ?? 0).getTime() - new Date(b.scheduledAt ?? 0).getTime())
      .map(notif => ({
        id: notif.id,
        // `notif.id` vaut `rapport_<uuid>` : le callId est distinct, et c'est lui
        // qui permet de retrouver le brouillon.
        callId: notif.callId ?? '',
        title: notif.inviteeName ? `Appel avec ${notif.inviteeName}` : 'Appel découverte',
        scheduledAt: notif.scheduledAt,
        duration: notif.duration,
      })),
  ];

  const tasks = client.tasks.map(t => ({ ...t, done: taskOverrides[t.id] ?? t.done }));
  const coachTasks = tasks.filter(t => t.added_by === 'coach');
  const doneCount = coachTasks.filter(t => t.done).length;
  const progress = coachTasks.length > 0 ? Math.round((doneCount / coachTasks.length) * 100) : 0;

  const {
    upcomingCalls, callsToday,
    callsBookedAllTime, leadsAllTimeCount, cashContractedAllTime, cashCollectedAllTime, closingRateAllTime,
    callsBookedThisMonthCount, leadsThisMonthCount, cashContractedThisMonth, cashCollectedThisMonth, closingRateThisMonth,
  } = client.business;
  const nextCall = pickAccueilCall(upcomingCalls, nowTick);
  const coachingCallsToday = callsToday.filter(isCoachingCall).length;
  const prospectCallsToday = callsToday.length - coachingCallsToday;
  const collectRate = cashContractedAllTime > 0 && cashCollectedAllTime !== null ? Math.round((cashCollectedAllTime / cashContractedAllTime) * 100) : null;

  // CallStack attend un "client" par call — côté élève ça n'a pas de sens d'afficher
  // sa propre fiche : un call coaching (google) se fait avec le coach (avatar réel
  // dispo), un call vente (calendly) avec un prospect (invitee_name, pas d'avatar
  // réel donc repli sur initiales).
  function getCallCounterpart(call: Call) {
    if (isCoachingCall(call)) {
      return { id: 'coach', name: client!.coachFullName || client!.coachName || 'Coach', initials: null, avatar_url: client!.coachAvatarUrl };
    }
    const name = call.invitee_name || 'Prospect';
    return { id: call.id, name, initials: getInitials(name), avatar_url: null };
  }

  return (
    <div className="page-content">

      {/* Prochain call */}
      {nextCall?.scheduled_at && (
        <div className="next-call-banner card" style={{ marginBottom: 20, padding: '20px' }}>
          <div className="next-call-banner-top">
            <Avatar
              initials={getCallCounterpart(nextCall).initials || getInitials(getCallCounterpart(nextCall).name)}
              avatarUrl={getCallCounterpart(nextCall).avatar_url}
              size={48}
              seed={getCallCounterpart(nextCall).id}
              className="next-call-banner-avatar"
            />
            <div className="next-call-banner-info">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>PROCHAIN CALL</span>
                <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: isCoachingCall(nextCall) ? 'var(--surface-2)' : 'var(--accent-brand-soft)', color: isCoachingCall(nextCall) ? 'var(--accent)' : 'var(--accent-brand)' }}>
                  {isCoachingCall(nextCall) ? 'Coaching' : 'Prospect'}
                </span>
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--accent)', lineHeight: 1.2, textTransform: 'capitalize' }}>
                {formatDateIn(new Date(nextCall.scheduled_at), viewerTz)}
              </div>
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--accent)', marginTop: 2 }}>
                {formatTimeIn(new Date(nextCall.scheduled_at), viewerTz)}
                {nextCall.duration && <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 400, marginLeft: 8 }}>· {nextCall.duration}</span>}
              </div>
              {isCoachingCall(nextCall) && nextCall.topic && (
                <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>{nextCall.topic}</div>
              )}
              {(nextCall.join_url || nextCall.meet_link) && isCallJoinable(nextCall, nowTick) && (
                <a
                  href={nextCall.join_url || nextCall.meet_link || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-primary-brand next-call-banner-join-mobile"
                  style={{ alignItems: 'center', gap: 6, fontSize: 13, marginTop: 12, padding: '8px 16px' }}
                >
                  <Icon name="phone-call" size={14} />
                  Rejoindre le call
                </a>
              )}
            </div>
            <div className="next-call-banner-countdown" style={{ background: 'var(--surface-2)', borderRadius: 12, textAlign: 'center' }}>
              {(() => {
                const days = daysUntil(nextCall.scheduled_at!);
                return (
                  <>
                    <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
                      {days <= 0 ? 'Auj.' : `J-${days}`}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                      {days <= 0 ? "aujourd'hui" : days === 1 ? 'demain' : `dans ${days}j`}
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Un seul fil pour tout ce qui attend une action : demandes de call
          d'abord, rapports ensuite du plus ancien au plus récent.
          Les deux blocs étaient séparés et empilés — deux titres, deux
          rythmes, et sur mobile une hauteur qui repoussait les KPI hors de
          l'écran. Les regrouper donne une seule question à l'élève :
          « qu'est-ce que j'ai à traiter ? » */}
      <PendingRapportCard
        label={
          fileAttente.length === 1
            ? '1 chose à traiter'
            : `${fileAttente.length} choses à traiter`
        }
        items={fileAttente}
        onOpen={(item) => {
          // L'index du fil ne correspond plus à celui de `rapportNotifs` depuis
          // que les demandes de call ouvrent la marche : on retrouve la
          // notification par son id plutôt que par sa position.
          const notif = rapportNotifs.find(n => n.id === item.id);
          if (notif) setOpenRapport(notif);
        }}
      />

      {openRapport?.callId && (
        <RapportModal
          callId={openRapport.callId}
          inviteeName={openRapport.inviteeName ?? null}
          scheduledAt={openRapport.scheduledAt ?? null}
          onClose={() => { setOpenRapport(null); refresh(); }}
        />
      )}

      {/* Header élève */}
      <div style={{ background: 'linear-gradient(135deg, var(--surface-2) 0%, var(--surface) 100%)', borderRadius: 16, padding: 'clamp(12px, 3vw, 20px) clamp(14px, 5vw, 32px)', marginBottom: 20, border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(12px, 4vw, 24px)', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <Ring value={progress} size={80} stroke={7} />
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', pointerEvents: 'none' }}>
              <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--accent)', lineHeight: 1 }}>{progress}%</span>
              <span style={{ fontSize: 9, color: 'var(--muted)', marginTop: 1 }}>prog.</span>
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 140 }}>
            <h1 style={{ fontSize: 'clamp(16px, 3vw, 20px)', fontWeight: 700, color: 'var(--accent)', marginBottom: 4, lineHeight: 1.2 }}>
              Bonjour, {client.name}
            </h1>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
              {client.niche || 'Infopreneur'} · Sem. <strong style={{ color: 'var(--accent)' }}>{getClientWeek(client.onboarding_completed_at)}</strong>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, color: 'var(--accent)', background: 'var(--surface)', border: '1px solid var(--border)', padding: '4px 10px', borderRadius: 20, fontWeight: 600, whiteSpace: 'nowrap' }}>
                {doneCount}/{coachTasks.length} tâches
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid-2">
        {/* Calls du jour */}
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">Calls du jour</div>
              <div className="card-sub">{callsToday.length} session{callsToday.length !== 1 ? 's' : ''} planifiée{callsToday.length !== 1 ? 's' : ''}</div>
            </div>
          </div>
          <div style={{ marginTop: 16 }}>
            <CallStack calls={callsToday} getClient={getCallCounterpart} />
          </div>
        </div>

        {/* Tâches à effectuer */}
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">Tâches à effectuer</div>
              <div className="card-sub">{doneCount} sur {coachTasks.length} tâches complétées</div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
            {tasks.filter(t => !t.done).map((task) => {
              const prio = task.priority ? PRIORITY_CONFIG[task.priority] : null;
              const overdue = getDeadlineStatus(task.deadline, task.done)?.overdue ?? false;
              return (
                <div
                  key={task.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 14px', borderRadius: 12,
                    background: overdue ? '#ef444408' : 'var(--surface-2)',
                    border: `1px solid ${overdue ? '#ef444440' : 'var(--border)'}`,
                  }}
                >
                  <div
                    className="task-check"
                    onClick={() => toggleTask(task.id, true)}
                    role="checkbox" aria-checked={false} tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleTask(task.id, true); } }}
                    style={{ flexShrink: 0 }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: 'var(--accent)', marginBottom: task.deadline ? 3 : 0 }}>{task.label}</div>
                    {task.meta && task.meta !== 'fait' && (
                      <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>{task.meta}</div>
                    )}
                  </div>
                  <DeadlineBadge deadline={task.deadline} done={false} />
                  {prio && (
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: prio.bg, color: prio.color, flexShrink: 0 }}>
                      {prio.label}
                    </span>
                  )}
                  {task.added_by === 'coach' && (
                    <span title={`Tâche assignée par ${client.coachName || 'ton coach'}`} style={{ fontSize: 10, fontWeight: 600, color: 'var(--accent)', background: 'var(--surface-2)', padding: '2px 7px', borderRadius: 20, flexShrink: 0 }}>Coach</span>
                  )}
                  {task.added_by === 'client' && (
                    <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', background: 'var(--surface-2)', padding: '2px 7px', borderRadius: 20, flexShrink: 0 }}>Perso</span>
                  )}
                </div>
              );
            })}
            {tasks.filter(t => !t.done).length === 0 && (
              <div style={{ fontSize: 13, color: 'var(--green)', padding: '8px 0' }}>✓ Toutes tes tâches sont terminées !</div>
            )}
          </div>
        </div>
      </div>

      {/* Business du mois */}
      <div className="grid-4 client-kpi-grid" style={{ marginTop: 24 }}>
        <div className="card" style={{ padding: '16px 20px' }}>
          <div className="kpi-label">Appels aujourd'hui</div>
          <div className="kpi-value">{callsToday.length}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
            {callsToday.length > 0 ? `${coachingCallsToday} coaching · ${prospectCallsToday} prospect` : 'Aucun call prévu'}
          </div>
        </div>
        <div className="card" style={{ padding: '16px 20px' }}>
          <div className="kpi-label">Calls bookés</div>
          <div className="kpi-value">{callsBookedAllTime}</div>
          <div style={{ marginTop: 3 }}>
            <TrendBadge value={callsBookedThisMonthCount} label="ce mois" />
          </div>
        </div>
        <div className="card" style={{ padding: '16px 20px' }}>
          <div className="kpi-label">Leads</div>
          <div className="kpi-value">{leadsAllTimeCount}</div>
          <div style={{ marginTop: 3 }}>
            <TrendBadge value={leadsThisMonthCount} label="ce mois" />
          </div>
        </div>
        <div className="card" style={{ padding: '16px 20px' }}>
          <div className="kpi-label">Taux de closing</div>
          <div className="kpi-value">{closingRateAllTime}%</div>
          <div style={{ marginTop: 3 }}>
            <TrendBadge value={closingRateThisMonth} label="ce mois" format={(n) => `${n}%`} />
          </div>
        </div>
      </div>

      <div className="grid-2 client-kpi-grid" style={{ marginTop: 16, marginBottom: 22 }}>
        <div className="card" style={{ padding: '16px 20px' }}>
          <div className="kpi-label">Cash contracté</div>
          <div className="kpi-value" style={{ color: 'var(--green)' }}>{cashContractedAllTime.toLocaleString('fr-FR')} €</div>
          <div style={{ marginTop: 3 }}>
            <TrendBadge value={cashContractedThisMonth} label="ce mois" format={(n) => `${n.toLocaleString('fr-FR')} €`} />
          </div>
        </div>
        <div className="card" style={{ padding: '16px 20px' }}>
          <div className="kpi-label">Cash collecté</div>
          {cashCollectedAllTime === null ? (
            <>
              <div className="kpi-value" style={{ color: 'var(--muted)' }}>—</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>en attente de connexion Stripe</div>
            </>
          ) : (
            <>
              <div className="kpi-value" style={{ color: 'var(--green)' }}>{cashCollectedAllTime.toLocaleString('fr-FR')} €</div>
              <div style={{ marginTop: 3, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <TrendBadge value={cashCollectedThisMonth ?? 0} label="ce mois" format={(n) => `${n.toLocaleString('fr-FR')} €`} />
                {collectRate !== null && (
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>{collectRate}% du cash contracté</span>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
