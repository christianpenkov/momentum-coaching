'use client';
import InlineLoader from '@/components/ui/InlineLoader';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Icon from '@/components/ui/Icon';
import RapportModal from '@/components/ui/RapportModal';
import CallInfosModal from '@/components/ui/CallInfosModal';
import Avatar, { getInitials } from '@/components/ui/Avatar';
import { createClient } from '@/lib/supabase/client';
import { useClientSelfData } from '@/lib/supabase/useCoachData';
import { isCallMissingRecording, isCallReallyOver } from '@/lib/sessionRapport';

function isCoachingCall(call: { call_type?: string | null } | null | undefined) {
  return call?.call_type === 'google';
}

type Tab = 'upcoming' | 'history' | 'prospects' | 'coachings' | 'canceled';

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
  session_completed?: boolean | null;
  session_no_show?: boolean | null;
  fathom_status?: 'pending' | 'matched' | 'unmatched' | 'not_recorded' | null;
  fathom_share_url?: string | null;
  fathom_summary?: string | null;
  fathom_action_items?: unknown;
  fathom_transcript?: string | null;
}

interface RapportModal {
  callId: string;
  inviteeName: string | null;
  scheduledAt: string | null;
  fathomShareUrl?: string | null;
  fathomSummary?: string | null;
  fathomActionItems?: unknown;
  fathomTranscript?: string | null;
}

function daysUntil(dateStr: string) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - now.getTime()) / 86400000);
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

// Notes personnelles de l'élève sur un call de coaching (Google Meet), indépendantes
// du rapport du coach — toujours affichées et éditables, peu importe si le coach a
// déjà rapporté ce call ou non (voir lib/sessionRapport.ts / route student-notes).
function MyCallNotes({ callId, initialNotes, initialDismissed, coachHasReported }: { callId: string; initialNotes: string; initialDismissed: boolean; coachHasReported: boolean }) {
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
          {!coachHasReported && (
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>
              Ton coach n'a pas encore rapporté ce call.
            </div>
          )}
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

export default function PageClientCalls() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { data: client } = useClientSelfData();
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasCalendly, setHasCalendly] = useState<boolean | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [dismissingCanceledId, setDismissingCanceledId] = useState<string | null>(null);
  const [confirmDismissId, setConfirmDismissId] = useState<string | null>(null);
  const [declineModal, setDeclineModal] = useState<{ callId: string; topic: string; scheduledAt: string } | null>(null);
  const [proposedAt, setProposedAt] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('upcoming');

  // Carrousel rapports en attente
  const [rapportIdx, setRapportIdx] = useState(0);
  // Carrousel historique

  // Modal rapport
  const [rapportModal, setRapportModal] = useState<RapportModal | null>(null);

  // Modale de consultation (rapport déjà rempli + infos Fathom) — jamais de formulaire.
  const [infosModalCall, setInfosModalCall] = useState<Call | null>(null);

  // Historique : 4 derniers affichés par défaut, "Voir plus" affiche le reste
  const [historyLimited, setHistoryLimited] = useState(true);

  // Notes personnelles + statut du rapport coach, par call_id (calls Google coach-élève)
  const [sessionReportsByCall, setSessionReportsByCall] = useState<Record<string, { student_notes: string | null; student_notes_dismissed: boolean; attended: boolean | null }>>({});

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);

    const { data: integ } = await supabase
      .from('integrations')
      .select('id, connected_at')
      .eq('profile_id', user.id)
      .eq('provider', 'calendly')
      .single();
    setHasCalendly(!!integ);

    // Date de connexion Calendly — les calls antérieurs sont ignorés partout
    const calendlyConnectedAt: string | null = integ?.connected_at ?? null;

    // Calls Calendly : coach_id = profileId de l'élève (l'élève est l'hôte de ses calls leads)
    let calendlyQuery = supabase
      .from('calls')
      .select('*')
      .eq('coach_id', user.id)
      .eq('call_type', 'calendly')
      .neq('ignored', true)
      .order('scheduled_at', { ascending: false });

    if (calendlyConnectedAt) {
      // Marge de 24h avant connected_at pour éviter d'exclure des calls
      // bookés légèrement avant la (re)connexion Calendly
      const cutoff = new Date(new Date(calendlyConnectedAt).getTime() - 24 * 3600_000).toISOString();
      calendlyQuery = calendlyQuery.gte('scheduled_at', cutoff);
    }

    const { data: calendlyCalls } = await calendlyQuery;

    // Calls Google Calendar (coach ↔ élève) : client_id = clientRow.id
    const { data: clientRow } = await supabase
      .from('clients')
      .select('id')
      .eq('profile_id', user.id)
      .single();

    let googleCalls: Call[] = [];
    if (clientRow) {
      const { data } = await supabase
        .from('calls')
        .select('*')
        .eq('client_id', clientRow.id)
        .neq('call_type', 'calendly')
        .neq('ignored', true)
        .order('scheduled_at', { ascending: false });
      googleCalls = (data as Call[]) || [];

      const { data: reports } = await supabase
        .from('session_reports')
        .select('call_id, student_notes, student_notes_dismissed, attended')
        .eq('client_id', clientRow.id);
      const reportsMap: Record<string, { student_notes: string | null; student_notes_dismissed: boolean; attended: boolean | null }> = {};
      for (const r of reports || []) reportsMap[r.call_id] = { student_notes: r.student_notes, student_notes_dismissed: r.student_notes_dismissed, attended: r.attended };
      setSessionReportsByCall(reportsMap);
    }

    const allCalls = [...(calendlyCalls as Call[] || []), ...googleCalls];
    // Déduplique par id
    const seen = new Set<string>();
    const unique = allCalls.filter(c => { if (seen.has(c.id)) return false; seen.add(c.id); return true; });
    setCalls(unique);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const supabase = createClient();
    const channel = supabase
      .channel('calls-client')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calls' }, () => { load(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  // Deep link : ?rapport=<call_id> → ouvre la modal une seule fois (depuis push notif)
  const deepLinkHandled = useRef(false);
  useEffect(() => {
    const rapportId = searchParams.get('rapport');
    if (!rapportId || calls.length === 0 || deepLinkHandled.current) return;
    const call = calls.find(c => c.id === rapportId);
    if (!call || call.no_show !== null) return;
    deepLinkHandled.current = true;
    setRapportModal({ callId: call.id, inviteeName: call.invitee_name, scheduledAt: call.scheduled_at, fathomShareUrl: call.fathom_share_url, fathomSummary: call.fathom_summary, fathomActionItems: call.fathom_action_items, fathomTranscript: call.fathom_transcript });
  }, [searchParams, calls]);

  function closeRapportModal() {
    setRapportModal(null);
    // Retire ?rapport= de l'URL sans reload
    const url = new URL(window.location.href);
    url.searchParams.delete('rapport');
    router.replace(url.pathname + url.search, { scroll: false });
    load();
  }

  const now = new Date();
  const pendingCalls = calls.filter(c => c.status === 'pending_acceptance' && c.call_type !== 'calendly');
  const canceledCalls = calls.filter(c => ['canceled', 'cancelled', 'declined'].includes(c.status || ''));
  // isCallReallyOver (pas juste scheduled_at < now) : un call reste "à venir" tant que
  // son heure de FIN théorique (scheduled_at + duration) n'est pas dépassée, pour rester
  // rejoignable pendant toute sa durée même si l'élève arrive après l'heure de début.
  const upcoming = calls
    .filter(c => c.scheduled_at && !isCallReallyOver(c as any, now.getTime()) && c.status === 'active')
    .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime());
  const nextCall = upcoming[0];

  // Calls historique : passés, non annulés
  const history = calls
    .filter(c => c.scheduled_at && isCallReallyOver(c as any, now.getTime()) && !['cancelled', 'declined', 'canceled'].includes(c.status || ''))
    .sort((a, b) => new Date(b.scheduled_at!).getTime() - new Date(a.scheduled_at!).getTime());

  // Onglets Prospects / Coachings — chacun affiche ses propres sections À venir puis
  // Historique en dessous, indépendamment de l'onglet À venir/Historique principal
  // (qui, lui, mélange tous les types sans filtre). Même logique que côté coach.
  const prospectUpcoming = upcoming.filter(c => !isCoachingCall(c));
  const prospectHistory = history.filter(c => !isCoachingCall(c));
  const coachingUpcoming = upcoming.filter(c => isCoachingCall(c));
  const coachingHistory = history.filter(c => isCoachingCall(c));

  // Rapports en attente : calls Calendly passés sans rapport rempli
  // outcome = source de vérité : null = pas rempli, renseigné = rempli (tous les chemins du formulaire écrivent outcome)
  const pendingRapports = calls.filter(c =>
    c.call_type === 'calendly' &&
    c.outcome === null &&
    c.status === 'active' &&
    c.scheduled_at !== null &&
    new Date(c.scheduled_at).getTime() <= now.getTime()
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
        await load();
      } else {
        setSyncMsg(data.error || 'Erreur lors de la synchronisation');
      }
    } catch {
      setSyncMsg('Erreur réseau');
    }
    setSyncing(false);
    setTimeout(() => setSyncMsg(null), 4000);
  }

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}><InlineLoader /></div>;

  function getCallCounterpart(call: Call) {
    if (isCoachingCall(call)) {
      return { id: 'coach', name: client?.coachFullName || client?.coachName || 'Coach', initials: null, avatar_url: client?.coachAvatarUrl };
    }
    const name = call.invitee_name || 'Prospect';
    return { id: call.id, name, initials: getInitials(name), avatar_url: null };
  }

  const visibleHistory = historyLimited ? history.slice(0, 4) : history;

  // Rendu carte-liste "historique" — réutilisé par l'onglet Historique principal
  // (avec limite "Voir plus") et les sections Historique de Prospects/Coachings (sans limite).
  function renderHistoryList(list: Call[], emptyMsg: string | null) {
    if (list.length === 0) return emptyMsg ? (
      <div className="card" style={{ padding: '32px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>{emptyMsg}</div>
      </div>
    ) : null;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {list.map((call) => {
          const rapportPending = call.call_type === 'calendly' && call.no_show === null && call.status === 'active';
          return (
            <div key={call.id} className="card" style={{ padding: '18px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>
                      {call.invitee_name ? `Appel avec ${call.invitee_name}` : call.topic || 'Session de coaching'}
                    </span>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: isCoachingCall(call) ? 'var(--surface-2)' : 'var(--accent-brand-soft)', color: isCoachingCall(call) ? 'var(--accent)' : 'var(--accent-brand)' }}>
                      {isCoachingCall(call) ? 'Coaching' : 'Prospect'}
                    </span>
                    {call.fathom_status === 'matched' ? (
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: 'var(--green-soft)', color: 'var(--green)' }}>
                        Replay dispo
                      </span>
                    ) : isCallMissingRecording(call as any) ? (
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: 'transparent', border: '1px solid var(--border)', color: 'var(--ink-2)' }}>
                        Pas de replay
                      </span>
                    ) : null}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
                    {formatDate(call.scheduled_at!)} · {call.duration || '—'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                  {rapportPending ? (
                    <button
                      className="btn-ghost"
                      type="button"
                      style={{ fontSize: 11, color: 'var(--accent-brand)', border: '1px solid var(--accent-brand)' }}
                      onClick={() => setRapportModal({ callId: call.id, inviteeName: call.invitee_name, scheduledAt: call.scheduled_at, fathomShareUrl: call.fathom_share_url, fathomSummary: call.fathom_summary, fathomActionItems: call.fathom_action_items, fathomTranscript: call.fathom_transcript })}
                    >
                      Rapport
                    </button>
                  ) : call.no_show === true ? (
                    <span className="pill" style={{ fontSize: 11, background: 'var(--surface-2)', color: 'var(--muted)' }}>No-show</span>
                  ) : call.deal_closed === true ? (
                    <span className="pill pill-green" style={{ fontSize: 11 }}>Closé{call.revenue ? ` · ${call.revenue}€` : ''}</span>
                  ) : call.outcome === 'second_call' ? (
                    <span className="pill" style={{ fontSize: 11, background: '#3b82f620', color: '#3b82f6' }}>2ème call prévu</span>
                  ) : call.outcome === 'to_recontact' ? (
                    <span className="pill" style={{ fontSize: 11, background: '#f59e0b20', color: '#f59e0b' }}>À recontacter</span>
                  ) : call.outcome === 'not_closed' || call.outcome === 'not_qualified' ? (
                    <span className="pill" style={{ fontSize: 11, background: 'var(--surface-2)', color: 'var(--muted)' }}>
                      {call.outcome === 'not_qualified' ? 'Pas qualifié' : 'Pas closé'}
                    </span>
                  ) : call.deal_closed === false && call.no_show === false ? (
                    <span className="pill" style={{ fontSize: 11, background: 'var(--surface-2)', color: 'var(--muted)' }}>Pas closé</span>
                  ) : (
                    <span className="pill" style={{ fontSize: 11, background: 'var(--surface-2)', color: 'var(--muted)' }}>Terminé</span>
                  )}
                  {(call.fathom_status === 'matched' || sessionReportsByCall[call.id]?.attended != null || call.outcome != null) && (
                    <button
                      type="button"
                      className="btn-ghost"
                      style={{ fontSize: 11, border: '1px solid var(--border)', borderRadius: 8 }}
                      onClick={() => setInfosModalCall(call)}
                    >
                      Infos
                    </button>
                  )}
                </div>
              </div>
              {call.notes && (
                <div style={{ marginTop: 8, padding: '6px 10px', background: 'var(--surface-2)', borderRadius: 6, fontSize: 12, color: 'var(--accent)', borderLeft: '2px solid var(--accent)' }}>
                  {call.notes}
                </div>
              )}
              {call.call_type === 'calendly' && call.lead_rapport_comment && (
                <div style={{ marginTop: 8, padding: '6px 10px', background: 'var(--surface-2)', borderRadius: 6, fontSize: 12, color: 'var(--accent)', borderLeft: '2px solid var(--accent)' }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', marginBottom: 3 }}>Ton commentaire perso</div>
                  {call.lead_rapport_comment}
                </div>
              )}
              {call.call_type !== 'calendly' && (
                <MyCallNotes
                  callId={call.id}
                  initialNotes={sessionReportsByCall[call.id]?.student_notes || ''}
                  initialDismissed={sessionReportsByCall[call.id]?.student_notes_dismissed || false}
                  coachHasReported={sessionReportsByCall[call.id]?.attended != null}
                />
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // Rendu "à venir" version compacte (réutilisé pour les sections "À venir" des
  // onglets Prospects/Coachings) — pas de bannière géante, juste des cartes simples
  // cohérentes avec le style de renderHistoryList.
  function renderUpcomingCompact(list: Call[], emptyMsg: string) {
    if (list.length === 0) return (
      <div className="card" style={{ padding: '32px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>{emptyMsg}</div>
      </div>
    );
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {list.map(call => (
          <div key={call.id} className="card" style={{ padding: '18px 20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>
                    {call.invitee_name ? `Appel avec ${call.invitee_name}` : call.topic || 'Session de coaching'}
                  </span>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: isCoachingCall(call) ? 'var(--surface-2)' : 'var(--accent-brand-soft)', color: isCoachingCall(call) ? 'var(--accent)' : 'var(--accent-brand)' }}>
                    {isCoachingCall(call) ? 'Coaching' : 'Prospect'}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3, textTransform: 'capitalize' }}>
                  {formatDate(call.scheduled_at!)} · {formatTime(call.scheduled_at!)}
                  {call.duration && <span> · {call.duration}</span>}
                </div>
              </div>
              {call.join_url && call.status !== 'canceled' && call.status !== 'cancelled' && (
                <a href={call.join_url} target="_blank" rel="noopener noreferrer" className="btn-ghost"
                  style={{ fontSize: 12, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid var(--border)', borderRadius: 8, padding: '4px 10px', flexShrink: 0 }}>
                  <Icon name="video" size={13} /> Rejoindre
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Sections "À venir" + "Historique" empilées — utilisées par les onglets Prospects/Coachings.
  function renderStackedSections(upcomingList: Call[], historyList: Call[], upcomingEmptyMsg: string, historyEmptyMsg: string) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
        <div>
          <div className="eyebrow-sm" style={{ color: 'var(--muted)', marginBottom: 10 }}>À venir</div>
          {renderUpcomingCompact(upcomingList, upcomingEmptyMsg)}
        </div>
        <div>
          <div className="eyebrow-sm" style={{ color: 'var(--muted)', marginBottom: 10 }}>Historique</div>
          {renderHistoryList(historyList, historyEmptyMsg)}
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
            className="btn-ghost"
            type="button"
            onClick={syncCalendly}
            disabled={syncing}
            style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Icon name="refresh-cw" size={13} />
            {syncing ? 'Sync…' : 'Synchroniser'}
          </button>
        </div>
      </div>

      {/* Rapports en attente — carrousel, flèches latérales */}
      {pendingRapports.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div className="eyebrow-lg" style={{ color: 'var(--accent-brand)', marginBottom: 10 }}>
            {pendingRapports.length} rapport{pendingRapports.length > 1 ? 's' : ''} en attente
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              onClick={() => setRapportIdx(i => Math.max(0, i - 1))}
              disabled={rapportIdx === 0 || pendingRapports.length <= 1}
              style={{ flexShrink: 0, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, cursor: rapportIdx === 0 ? 'default' : 'pointer', opacity: rapportIdx === 0 || pendingRapports.length <= 1 ? 0.2 : 1 }}
            >‹</button>
            {(() => {
              const call = pendingRapports[rapportIdx];
              if (!call) return null;
              return (
                <div className="card" style={{ flex: 1, borderLeft: '3px solid var(--accent-brand)', padding: '18px 20px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent-brand)', marginBottom: 4 }}>
                        RAPPORT DE CALL{pendingRapports.length > 1 && <span style={{ fontWeight: 400, color: 'var(--muted)', marginLeft: 8 }}>{rapportIdx + 1} / {pendingRapports.length}</span>}
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)' }}>
                        {call.invitee_name ? `Appel avec ${call.invitee_name}` : call.topic || 'Appel découverte'}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
                        {call.scheduled_at ? formatDate(call.scheduled_at) : '—'}
                        {call.duration && <span style={{ marginLeft: 8 }}>· {call.duration}</span>}
                      </div>
                    </div>
                    <button
                      className="btn-primary-brand"
                      type="button"
                      style={{ fontSize: 13, background: 'var(--accent-brand)', flexShrink: 0 }}
                      onClick={() => setRapportModal({ callId: call.id, inviteeName: call.invitee_name, scheduledAt: call.scheduled_at, fathomShareUrl: call.fathom_share_url, fathomSummary: call.fathom_summary, fathomActionItems: call.fathom_action_items, fathomTranscript: call.fathom_transcript })}
                    >
                      Remplir le rapport
                    </button>
                  </div>
                </div>
              );
            })()}
            <button
              type="button"
              onClick={() => setRapportIdx(i => Math.min(pendingRapports.length - 1, i + 1))}
              disabled={rapportIdx === pendingRapports.length - 1 || pendingRapports.length <= 1}
              style={{ flexShrink: 0, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, cursor: rapportIdx === pendingRapports.length - 1 ? 'default' : 'pointer', opacity: rapportIdx === pendingRapports.length - 1 || pendingRapports.length <= 1 ? 0.2 : 1 }}
            >›</button>
          </div>
        </div>
      )}

      {/* Demandes de call en attente d'acceptation (Google Calendar) */}
      {pendingCalls.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div className="eyebrow-lg" style={{ color: '#f59e0b', marginBottom: 10 }}>
            {pendingCalls.length} demande{pendingCalls.length > 1 ? 's' : ''} en attente
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {pendingCalls.map(call => {
              const d = new Date(call.scheduled_at!);
              const dateStr = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
              const timeStr = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
              return (
                <div key={call.id} className="card" style={{ borderLeft: '3px solid var(--amber)', padding: '18px 20px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#92400e', marginBottom: 4 }}>TON COACH TE PROPOSE UN CALL</div>
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
            />
            <div className="next-call-banner-info">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>PROCHAIN CALL</span>
                <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: isCoachingCall(nextCall) ? 'var(--surface-2)' : 'var(--accent-brand-soft)', color: isCoachingCall(nextCall) ? 'var(--accent)' : 'var(--accent-brand)' }}>
                  {isCoachingCall(nextCall) ? 'Coaching' : 'Prospect'}
                </span>
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent)', lineHeight: 1.2, textTransform: 'capitalize' }}>
                {formatDate(nextCall.scheduled_at!)}
              </div>
              <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--accent)', marginTop: 4 }}>
                {formatTime(nextCall.scheduled_at!)}
                {nextCall.duration && <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 400, marginLeft: 8 }}>· {nextCall.duration}</span>}
              </div>
              {nextCall.invitee_name && (
                <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>avec {nextCall.invitee_name}</div>
              )}
              <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: nextCall.invitee_name ? 2 : 8 }}>
                {nextCall.topic || 'Session de coaching'}
              </div>
              {nextCall.join_url && nextCall.status !== 'canceled' && nextCall.status !== 'cancelled' && (
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
      ) : hasCalendly ? (
        <div className="card" style={{ padding: '32px 24px', textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>Aucun call planifié pour le moment.</div>
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
          Prospects ({prospectUpcoming.length + prospectHistory.length})
        </button>
        <button className={`chip${tab === 'coachings' ? ' chip-active' : ''}`} onClick={() => setTab('coachings')} type="button">
          Coachings ({coachingUpcoming.length + coachingHistory.length})
        </button>
        <button className={`chip${tab === 'canceled' ? ' chip-active' : ''}`} onClick={() => setTab('canceled')} type="button">
          Annulés ({canceledCalls.length})
        </button>
      </div>

      {tab === 'upcoming' && renderUpcomingCompact(upcoming, 'Aucun call à venir.')}

      {tab === 'history' && (
        history.length === 0 ? renderHistoryList([], "Aucun call dans l'historique.") : (
          <div>
            {renderHistoryList(visibleHistory, null)}
            {historyLimited && history.length > 4 && (
              <button
                type="button"
                onClick={() => setHistoryLimited(false)}
                className="card"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: '100%', marginTop: 10, padding: '16px 20px',
                  fontSize: 14, fontWeight: 600, color: 'var(--accent)',
                  cursor: 'pointer', border: '1px dashed var(--border)',
                }}
              >
                Voir plus ({history.length - 4} restant{history.length - 4 > 1 ? 's' : ''})
              </button>
            )}
          </div>
        )
      )}

      {tab === 'prospects' && renderStackedSections(
        prospectUpcoming, prospectHistory,
        'Aucun call prospect à venir.', "Aucun call prospect dans l'historique."
      )}

      {tab === 'coachings' && renderStackedSections(
        coachingUpcoming, coachingHistory,
        'Aucun call coaching à venir.', "Aucun call coaching dans l'historique."
      )}

      {tab === 'canceled' && (
        canceledCalls.length === 0 ? (
          <div className="card" style={{ padding: '32px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>Aucun call annulé.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {canceledCalls.map(call => {
              const isDeclined = call.status === 'declined';
              return (
                <div key={call.id} className="card" style={{ borderLeft: '3px solid var(--red)', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0, opacity: 0.6 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)', textDecoration: 'line-through' }}>{call.topic || 'Call coaching'}</div>
                    {call.scheduled_at && (
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                        {new Date(call.scheduled_at).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
                        {' · '}{new Date(call.scheduled_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    )}
                  </div>
                  <span style={{ fontSize: 10, padding: '2px 8px', background: '#fee2e2', color: '#991b1b', borderRadius: 20, fontWeight: 700, border: '1px solid #fca5a5', flexShrink: 0 }}>
                    {isDeclined ? 'Refusé' : 'Annulé'}
                  </span>
                  {confirmDismissId === call.id ? (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>Retirer ?</span>
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={async () => {
                          setDismissingCanceledId(call.id);
                          setConfirmDismissId(null);
                          try {
                            const res = await fetch(`/api/client/calls/${call.id}`, { method: 'DELETE' });
                            if (res.ok) setCalls(prev => prev.filter(c => c.id !== call.id));
                          } finally {
                            setDismissingCanceledId(null);
                          }
                        }}
                        disabled={dismissingCanceledId === call.id}
                        style={{ fontSize: 11, color: 'var(--red)', border: 'none', background: 'none', cursor: 'pointer', padding: '2px 6px' }}
                      >
                        {dismissingCanceledId === call.id ? '…' : 'Oui'}
                      </button>
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => setConfirmDismissId(null)}
                        style={{ fontSize: 11, border: 'none', background: 'none', cursor: 'pointer', padding: '2px 6px' }}
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
                      style={{ fontSize: 11, color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}
                    >
                      <Icon name="trash" size={12} />
                      {dismissingCanceledId === call.id ? '…' : 'Retirer'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )
      )}

      {/* Modal rapport */}
      {rapportModal && (
        <RapportModal
          callId={rapportModal.callId}
          inviteeName={rapportModal.inviteeName}
          scheduledAt={rapportModal.scheduledAt}
          onClose={closeRapportModal}
        />
      )}

      {infosModalCall && (
        <CallInfosModal
          counterpartName={infosModalCall.invitee_name}
          scheduledAt={infosModalCall.scheduled_at}
          attended={sessionReportsByCall[infosModalCall.id]?.attended ?? (infosModalCall.outcome != null ? infosModalCall.outcome !== 'no_show' : undefined)}
          notes={infosModalCall.notes ?? infosModalCall.lead_rapport_comment ?? null}
          studentNotes={sessionReportsByCall[infosModalCall.id]?.student_notes ?? null}
          fathomData={{
            shareUrl: infosModalCall.fathom_share_url ?? null,
            summary: infosModalCall.fathom_summary ?? null,
            actionItems: infosModalCall.fathom_action_items ?? null,
            transcript: infosModalCall.fathom_transcript ?? null,
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
              {declineModal.topic} · {new Date(declineModal.scheduledAt).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
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
