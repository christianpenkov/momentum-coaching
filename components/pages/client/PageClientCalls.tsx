'use client';

import { useState, useEffect } from 'react';
import Icon from '@/components/ui/Icon';
import { createClient } from '@/lib/supabase/client';

interface Call {
  id: string;
  topic: string | null;
  scheduled_at: string | null;
  duration: string | null;
  join_url: string | null;
  status: string;
  notes: string | null;
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
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasCalendly, setHasCalendly] = useState<boolean | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Vérifie si Calendly est connecté
      const { data: integ } = await supabase
        .from('integrations')
        .select('id')
        .eq('profile_id', user.id)
        .eq('provider', 'calendly')
        .single();
      setHasCalendly(!!integ);

      // Récupère le client_id lié à ce profil
      const { data: clientRow } = await supabase
        .from('clients')
        .select('id')
        .eq('profile_id', user.id)
        .single();

      if (!clientRow) { setLoading(false); return; }

      const { data } = await supabase
        .from('calls')
        .select('*')
        .eq('client_id', clientRow.id)
        .order('scheduled_at', { ascending: false });

      setCalls(data || []);
      setLoading(false);
    }
    load();

    // Realtime — mise à jour automatique quand un call est ajouté/modifié
    const supabase = createClient();
    const channel = supabase
      .channel('calls-client')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calls' }, () => {
        load();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const now = new Date();
  const upcoming = calls
    .filter(c => c.scheduled_at && new Date(c.scheduled_at) >= now && c.status !== 'cancelled')
    .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime());
  const history = calls
    .filter(c => c.scheduled_at && new Date(c.scheduled_at) < now && c.status !== 'cancelled')
    .sort((a, b) => new Date(b.scheduled_at!).getTime() - new Date(a.scheduled_at!).getTime());

  const nextCall = upcoming[0];

  async function syncCalendly() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch('/api/calendly/sync', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        setSyncMsg(data.synced > 0 ? `${data.synced} call${data.synced > 1 ? 's' : ''} synchronisé${data.synced > 1 ? 's' : ''}` : 'Aucun nouveau call trouvé');
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: clientRow } = await supabase.from('clients').select('id').eq('profile_id', user.id).single();
          if (clientRow) {
            const { data } = await supabase.from('calls').select('*').eq('client_id', clientRow.id).order('scheduled_at', { ascending: false });
            setCalls(data || []);
          }
        }
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
            <span style={{ fontSize: 12, color: syncMsg.includes('Erreur') || syncMsg.includes('introuvable') ? 'var(--red)' : 'var(--green)' }}>
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
              <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 8 }}>
                {nextCall.topic || 'Session de coaching'}
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                {nextCall.join_url ? (
                  <a href={nextCall.join_url} target="_blank" rel="noopener noreferrer" className="btn-primary" style={{ fontSize: 13, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Icon name="video" size={14} /> Rejoindre le call
                  </a>
                ) : (
                  <button className="btn-primary" type="button" disabled style={{ fontSize: 13, opacity: 0.5 }}>
                    <Icon name="video" size={14} /> Lien bientôt disponible
                  </button>
                )}
              </div>
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
                { icon: 'calendar' as const, label: 'Durée', value: nextCall.duration || '—' },
                { icon: 'calendar' as const, label: 'Heure', value: formatTime(nextCall.scheduled_at!) },
              ].map(({ icon, label, value }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <Icon name={icon} size={14} />
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</span>
                  </div>
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
            {history.map((call, i) => (
              <div key={call.id} style={{ padding: '14px 0', borderBottom: i < history.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>
                      {call.topic || 'Session de coaching'}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
                      {formatDate(call.scheduled_at!)} · {call.duration || '—'}
                    </div>
                  </div>
                  <span className="pill pill-green" style={{ fontSize: 11, flexShrink: 0 }}>Terminé</span>
                </div>
                {call.notes && (
                  <div style={{ marginTop: 8, padding: '6px 10px', background: 'var(--surface-2)', borderRadius: 6, fontSize: 12, color: 'var(--accent)', borderLeft: '2px solid var(--accent)' }}>
                    {call.notes}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
