'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Icon from '@/components/ui/Icon';
import RapportModal from '@/components/ui/RapportModal';
import { createClient } from '@/lib/supabase/client';

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
}

interface RapportModal {
  callId: string;
  inviteeName: string | null;
  scheduledAt: string | null;
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

export default function PageClientCalls() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasCalendly, setHasCalendly] = useState<boolean | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [declineModal, setDeclineModal] = useState<{ callId: string; topic: string; scheduledAt: string } | null>(null);
  const [proposedAt, setProposedAt] = useState('');
  const [userId, setUserId] = useState<string | null>(null);

  // Modal rapport
  const [rapportModal, setRapportModal] = useState<RapportModal | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);

    const { data: integ } = await supabase
      .from('integrations')
      .select('id')
      .eq('profile_id', user.id)
      .eq('provider', 'calendly')
      .single();
    setHasCalendly(!!integ);

    // Calls Calendly : coach_id = profileId de l'élève (l'élève est l'hôte de ses calls leads)
    const { data: calendlyCalls } = await supabase
      .from('calls')
      .select('*')
      .eq('coach_id', user.id)
      .not('calendly_event_uuid', 'is', null)
      .order('scheduled_at', { ascending: false });

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
        .is('calendly_event_uuid', null)
        .order('scheduled_at', { ascending: false });
      googleCalls = (data as Call[]) || [];
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
    setRapportModal({ callId: call.id, inviteeName: call.invitee_name, scheduledAt: call.scheduled_at });
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
  const pendingCalls = calls.filter(c => c.status === 'pending_acceptance' && !c.calendly_event_uuid);
  const upcoming = calls
    .filter(c => c.scheduled_at && new Date(c.scheduled_at) >= now && c.status === 'active')
    .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime());
  const nextCall = upcoming[0];

  // Calls historique : passés, non annulés
  const history = calls
    .filter(c => c.scheduled_at && new Date(c.scheduled_at) < now && !['cancelled', 'declined', 'canceled'].includes(c.status || ''))
    .sort((a, b) => new Date(b.scheduled_at!).getTime() - new Date(a.scheduled_at!).getTime());

  // Rapports en attente : calls Calendly dont scheduled_at <= now et no_show = null (inclut les calls en cours)
  const pendingRapports = calls.filter(c =>
    c.calendly_event_uuid !== null &&
    c.no_show === null &&
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

  if (loading) {
    return (
      <div className="page-content">
        <div className="page-header"><h1 className="page-title">Mes calls</h1></div>
        <div style={{ color: 'var(--muted)', fontSize: 13, paddingTop: 40, textAlign: 'center' }}>
          <Icon name="refresh-cw" size={16} /> Chargement…
        </div>
      </div>
    );
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <h1 className="page-title">Mes calls</h1>
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

      {/* Rapports en attente — prioritaire */}
      {pendingRapports.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
            {pendingRapports.length} rapport{pendingRapports.length > 1 ? 's' : ''} en attente
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {pendingRapports.map(call => (
              <div key={call.id} className="card" style={{ borderLeft: '4px solid #f59e0b', padding: '18px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#92400e', marginBottom: 4 }}>RAPPORT DE CALL</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)' }}>
                      {call.invitee_name ? `Appel avec ${call.invitee_name}` : call.topic || 'Appel découverte'}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
                      {call.scheduled_at ? formatDate(call.scheduled_at) : '—'}
                      {call.duration && <span style={{ marginLeft: 8 }}>· {call.duration}</span>}
                    </div>
                  </div>
                  <button
                    className="btn-primary"
                    type="button"
                    style={{ fontSize: 13, background: '#f59e0b', flexShrink: 0 }}
                    onClick={() => {
                      setRapportModal({ callId: call.id, inviteeName: call.invitee_name, scheduledAt: call.scheduled_at });
                    }}
                  >
                    Remplir le rapport
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Demandes de call en attente d'acceptation (Google Calendar) */}
      {pendingCalls.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
            {pendingCalls.length} demande{pendingCalls.length > 1 ? 's' : ''} en attente
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {pendingCalls.map(call => {
              const d = new Date(call.scheduled_at!);
              const dateStr = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
              const timeStr = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
              return (
                <div key={call.id} className="card" style={{ borderLeft: '4px solid #f59e0b', padding: '18px 20px' }}>
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
                        className="btn-primary"
                        type="button"
                        onClick={() => handleAccept(call.id)}
                        disabled={respondingId === call.id}
                        style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 5 }}
                      >
                        <Icon name="check" size={13} />
                        {respondingId === call.id ? '…' : 'Accepter'}
                      </button>
                      <button
                        className="btn-ghost"
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
          <a href="/client/settings" className="btn-primary" style={{ fontSize: 13, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon name="link" size={13} /> Connecter Calendly
          </a>
        </div>
      )}

      {/* Prochain call */}
      {nextCall ? (
        <div className="card" style={{ marginBottom: 24, borderLeft: '4px solid var(--green)', padding: '28px 28px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6, fontWeight: 600 }}>PROCHAIN CALL</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--accent)', lineHeight: 1.2, textTransform: 'capitalize' }}>
                {formatDate(nextCall.scheduled_at!)}
              </div>
              <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--accent)', marginTop: 4 }}>
                {formatTime(nextCall.scheduled_at!)}
                {nextCall.duration && <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 400, marginLeft: 8 }}>· {nextCall.duration}</span>}
              </div>
              {nextCall.invitee_name && (
                <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>avec {nextCall.invitee_name}</div>
              )}
              <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: nextCall.invitee_name ? 2 : 8 }}>
                {nextCall.topic || 'Session de coaching'}
              </div>
              {nextCall.join_url && (
                <div style={{ marginTop: 16 }}>
                  <a href={nextCall.join_url} target="_blank" rel="noopener noreferrer" className="btn-primary" style={{ fontSize: 13, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Icon name="video" size={14} /> Rejoindre le call
                  </a>
                </div>
              )}
            </div>
            <div style={{ padding: '20px 24px', background: 'var(--surface-2)', borderRadius: 12, textAlign: 'center', minWidth: 140 }}>
              {(() => {
                const days = daysUntil(nextCall.scheduled_at!);
                return (
                  <>
                    <div style={{ fontSize: 36, fontWeight: 800, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
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
        <div className="card" style={{ padding: '32px 24px', textAlign: 'center', marginBottom: 24, borderLeft: '4px solid var(--border)' }}>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>Aucun call planifié pour le moment.</div>
        </div>
      ) : null}

      {/* Préparation */}
      {nextCall && (
        <div className="grid-2" style={{ marginBottom: 24 }}>
          <div className="card">
            <div className="card-head">
              <div className="card-title">Se préparer</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
              {[
                'Compléter les tâches de la semaine',
                'Rassembler ses stats (posts, DM, réponses)',
                'Préparer 1-2 questions pour le coach',
                'Identifier son principal blocage',
              ].map((item, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{ width: 20, height: 20, borderRadius: 4, border: '1.5px solid var(--border)', flexShrink: 0, marginTop: 1 }} />
                  <span style={{ fontSize: 13, color: 'var(--accent)', lineHeight: 1.5 }}>{item}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <div className="card-head">
              <div className="card-title">Infos pratiques</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 16 }}>
              {[
                { label: 'Durée', value: nextCall.duration || '—' },
                { label: 'Heure', value: formatTime(nextCall.scheduled_at!) },
              ].map(({ label, value }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Historique */}
      {history.length > 0 && (
        <div className="card">
          <div className="card-head">
            <div className="card-title">Historique des calls</div>
          </div>
          <div style={{ marginTop: 16 }}>
            {history.map((call, i) => {
              const rapportPending = call.calendly_event_uuid && call.no_show === null && call.status === 'active';
              return (
                <div key={call.id} style={{ padding: '14px 0', borderBottom: i < history.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>
                        {call.invitee_name ? `Appel avec ${call.invitee_name}` : call.topic || 'Session de coaching'}
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
                          style={{ fontSize: 11, color: '#f59e0b', border: '1px solid #f59e0b' }}
                          onClick={() => {
                            setRapportModal({ callId: call.id, inviteeName: call.invitee_name, scheduledAt: call.scheduled_at });
                          }}
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
                      ) : call.outcome === 'not_closed' ? (
                        <span className="pill" style={{ fontSize: 11, background: 'var(--surface-2)', color: 'var(--muted)' }}>Pas closé</span>
                      ) : call.deal_closed === false && call.no_show === false ? (
                        <span className="pill" style={{ fontSize: 11, background: 'var(--surface-2)', color: 'var(--muted)' }}>Pas closé</span>
                      ) : (
                        <span className="pill" style={{ fontSize: 11, background: 'var(--surface-2)', color: 'var(--muted)' }}>Terminé</span>
                      )}
                    </div>
                  </div>
                  {call.notes && (
                    <div style={{ marginTop: 8, padding: '6px 10px', background: 'var(--surface-2)', borderRadius: 6, fontSize: 12, color: 'var(--accent)', borderLeft: '2px solid var(--accent)' }}>
                      {call.notes}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
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
                className="btn-primary"
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
