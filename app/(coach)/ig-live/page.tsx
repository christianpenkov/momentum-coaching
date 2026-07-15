'use client';

import { useEffect, useRef, useState } from 'react';
import DesktopOnly from '@/components/ui/DesktopOnly';

type LogEvent = {
  ts: string;
  data: any;
};

async function registerWebhook() {
  const res = await fetch('/api/instagram/register-webhook', { method: 'POST' });
  return res.json();
}

const TYPE_COLORS: Record<string, string> = {
  comment_received: '#3b82f6',
  keyword_matched: '#8b5cf6',
  duplicate_skipped: '#f59e0b',
  dm1_sent: '#10b981',
  dm1_error: '#ef4444',
  dm2_sent: '#10b981',
  dm2_error: '#ef4444',
  dm2_skipped: '#f59e0b',
  lead_stored: '#6366f1',
};

const TYPE_LABELS: Record<string, string> = {
  comment_received: '💬 Commentaire reçu',
  keyword_matched: '🎯 Mot-clé détecté',
  duplicate_skipped: '⏭️ Doublon ignoré',
  dm1_sent: '✅ DM 1 envoyé (lead magnet)',
  dm1_error: '❌ DM 1 erreur',
  dm2_sent: '✅ DM 2 envoyé (question)',
  dm2_error: '❌ DM 2 erreur',
  dm2_skipped: '⚠️ DM 2 ignoré',
  lead_stored: '💾 Lead stocké en DB',
};

export default function IgLivePage() {
  return <DesktopOnly><IgLivePageContent /></DesktopOnly>;
}

function IgLivePageContent() {
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [subStatus, setSubStatus] = useState<any>(null);
  const [subLoading, setSubLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const es = new EventSource('/api/instagram/webhook-stream');

    es.onopen = () => setConnected(true);

    es.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data);
        setEvents(prev => [...prev, parsed]);
      } catch {}
    };

    es.onerror = () => setConnected(false);

    return () => es.close();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events]);

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#e5e7eb', fontFamily: 'monospace', padding: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: connected ? '#10b981' : '#ef4444', boxShadow: connected ? '0 0 8px #10b981' : '0 0 8px #ef4444' }} />
        <span style={{ fontWeight: 700, fontSize: 16 }}>Instagram Webhook — Live</span>
        <span style={{ fontSize: 12, color: '#6b7280' }}>{connected ? 'Connecté · en écoute' : 'Déconnecté'}</span>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#6b7280' }}>{events.length} event{events.length !== 1 ? 's' : ''}</span>
        {events.length > 0 && (
          <button onClick={() => setEvents([])} style={{ fontSize: 11, color: '#6b7280', background: 'none', border: '1px solid #374151', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>
            Effacer
          </button>
        )}
      </div>

      {/* Souscription webhook */}
      <div style={{ border: '1px solid #1f2937', borderRadius: 10, padding: '14px 18px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: '#9ca3af' }}>Souscription aux champs <code style={{ color: '#10b981', background: '#0f2723', padding: '1px 6px', borderRadius: 4 }}>comments</code> + <code style={{ color: '#10b981', background: '#0f2723', padding: '1px 6px', borderRadius: 4 }}>messages</code></span>
        <button
          onClick={async () => {
            setSubLoading(true);
            const result = await registerWebhook();
            setSubStatus(result);
            setSubLoading(false);
          }}
          disabled={subLoading}
          style={{ padding: '7px 16px', background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 7, fontWeight: 600, fontSize: 12, cursor: 'pointer', opacity: subLoading ? 0.6 : 1 }}
        >
          {subLoading ? '⏳ En cours…' : '🔗 S\'abonner maintenant'}
        </button>
        {subStatus && (
          <span style={{ fontSize: 11, color: subStatus.success ? '#10b981' : '#ef4444' }}>
            {subStatus.success ? '✅ Souscription active' : `❌ ${JSON.stringify(subStatus.results?.subscribed_apps?.error?.message || subStatus)}`}
          </span>
        )}
      </div>

      {/* Instructions */}
      {events.length === 0 && (
        <div style={{ border: '1px solid #1f2937', borderRadius: 12, padding: '24px 28px', marginBottom: 24, color: '#9ca3af', lineHeight: 2 }}>
          <div style={{ fontWeight: 700, color: '#e5e7eb', marginBottom: 8 }}>En attente d'events…</div>
          <div>1. Fais une publication sur ton compte Instagram</div>
          <div>2. Commente <code style={{ background: '#1f2937', padding: '2px 8px', borderRadius: 4, color: '#10b981' }}>ok</code> depuis un autre compte</div>
          <div>3. Meta envoie l'event ici automatiquement (webhook temps réel)</div>
          <div style={{ marginTop: 8, fontSize: 12, color: '#4b5563' }}>
            ⚠️ Le webhook doit être enregistré dans le dashboard Meta pour que les events arrivent.
          </div>
        </div>
      )}

      {/* Events */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {events.map((ev, i) => {
          const color = TYPE_COLORS[ev.data?.type] || '#6b7280';
          const label = TYPE_LABELS[ev.data?.type] || ev.data?.type || 'event';
          const { type, ...rest } = ev.data || {};
          return (
            <div key={i} style={{ border: `1px solid ${color}30`, borderLeft: `3px solid ${color}`, borderRadius: 8, background: '#111827', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: '1px solid #1f2937' }}>
                <span style={{ fontWeight: 700, fontSize: 13, color }}>{label}</span>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: '#4b5563' }}>{new Date(ev.ts).toLocaleTimeString('fr-FR')}</span>
              </div>
              <pre style={{ margin: 0, padding: '10px 14px', fontSize: 11, lineHeight: 1.7, color: '#d1d5db', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {JSON.stringify(rest, null, 2)}
              </pre>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
