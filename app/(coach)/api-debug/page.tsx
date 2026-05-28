'use client';

import { useState } from 'react';

const ROUTES = [
  { key: 'instagram', label: 'Instagram Stats', url: '/api/instagram/stats', method: 'GET' },
  { key: 'youtube', label: 'YouTube Stats', url: '/api/youtube/stats', method: 'GET' },
  { key: 'stripe', label: 'Stripe', url: '/api/stripe/client-data', method: 'GET' },
  { key: 'shortio', label: 'Short.io Stats', url: '/api/shortio/stats', method: 'GET' },
  { key: 'calendly', label: 'Calendly Sync', url: '/api/calendly/sync', method: 'POST' },
];

const IG_WORKFLOW_ROUTES = [
  { key: 'ig-workflow', label: '🚀 Test workflow complet (dernier post → commentaires → DMs)', url: '/api/instagram/test-full-workflow', method: 'GET' },
  { key: 'ig-leads', label: '📋 Leads stockés en DB', url: '/api/instagram/leads', method: 'GET' },
];

type Result = { status: number; data: unknown; error?: string; duration: number };

export default function ApiDebugPage() {
  const [results, setResults] = useState<Record<string, Result>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});

  const allUnauth = Object.values(results).length > 0 && Object.values(results).every(r => r.status === 401);

  async function fetchOne(key: string, url: string, method = 'GET') {
    setLoading(l => ({ ...l, [key]: true }));
    const t0 = Date.now();
    try {
      const res = await fetch(url, { method });
      const text = await res.text();
      let data: unknown;
      try { data = JSON.parse(text); } catch { data = text || null; }
      setResults(r => ({ ...r, [key]: { status: res.status, data, duration: Date.now() - t0 } }));
    } catch (e: any) {
      setResults(r => ({ ...r, [key]: { status: 0, data: null, error: e.message, duration: Date.now() - t0 } }));
    } finally {
      setLoading(l => ({ ...l, [key]: false }));
    }
  }

  async function fetchAll() {
    await Promise.all(ROUTES.map(r => fetchOne(r.key, r.url, r.method)));
  }

  return (
    <div className="page-content">
      <div className="page-header" style={{ marginBottom: 24 }}>
        <h1 className="page-title">API Debug</h1>
        <p className="page-sub">Vérification des données brutes retournées par chaque API</p>
      </div>

      {/* ─── SECTION INSTAGRAM WORKFLOW ─── */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>Instagram Lead Magnet — Workflow complet</span>
          <span style={{ fontSize: 11, color: 'var(--muted)', background: 'var(--surface-2)', padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border)' }}>
            Test temps réel
          </span>
        </div>
        <div style={{ padding: '12px 16px', background: '#3f8a5210', border: '1px solid #3f8a5230', borderRadius: 10, marginBottom: 16, fontSize: 12, color: 'var(--ink)', lineHeight: 1.7 }}>
          <strong>Comment tester :</strong><br />
          1. Fais une publication sur ton compte Instagram connecté<br />
          2. Commente <code style={{ background: 'var(--surface-2)', padding: '1px 6px', borderRadius: 4 }}>ok</code> depuis un <strong>autre compte</strong><br />
          3. Clique "Test workflow complet" ci-dessous → la route détecte le commentaire et envoie les DMs automatiquement<br />
          4. Vérifie la boîte DM du compte qui a commenté
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {IG_WORKFLOW_ROUTES.map(r => (
            <button key={r.key} onClick={() => fetchOne(r.key, r.url, r.method)} disabled={loading[r.key]}
              style={{ padding: '10px 20px', background: r.key === 'ig-workflow' ? 'var(--ink)' : 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer', color: r.key === 'ig-workflow' ? 'var(--surface)' : 'var(--ink)', opacity: loading[r.key] ? 0.5 : 1 }}>
              {loading[r.key] ? '⏳ En cours…' : r.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {IG_WORKFLOW_ROUTES.map(r => {
            const res = results[r.key];
            if (!res) return null;
            return (
              <div key={r.key} style={{ background: 'var(--surface)', border: `1px solid ${res.status === 200 ? '#3f8a5240' : '#cd5b3f40'}`, borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' }}>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{r.label}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: res.status === 200 ? '#3f8a52' : '#cd5b3f', background: res.status === 200 ? '#3f8a5220' : '#cd5b3f20', borderRadius: 4, padding: '2px 8px' }}>
                    {res.status || 'ERR'}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>{res.duration}ms</span>
                </div>
                <pre style={{ margin: 0, padding: '16px 20px', fontSize: 11, lineHeight: 1.6, overflowX: 'auto', maxHeight: 600, color: res.error ? '#cd5b3f' : 'var(--ink)', background: 'transparent', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {res.error ? res.error : JSON.stringify(res.data, null, 2)}
                </pre>
              </div>
            );
          })}
        </div>
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid var(--border)', marginBottom: 28 }} />

      {allUnauth && (
        <div style={{ marginBottom: 20, padding: '14px 20px', background: '#cd5b3f15', border: '1px solid #cd5b3f40', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontSize: 13, color: '#cd5b3f', fontWeight: 600 }}>
            401 partout — tu n&apos;es pas connecté.
          </span>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            Les routes API requièrent une session Supabase Auth.
          </span>
          <a href="/login" style={{ marginLeft: 'auto', padding: '6px 16px', background: '#cd5b3f', color: '#fff', borderRadius: 7, fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>
            Se connecter →
          </a>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
        <button onClick={fetchAll} style={{ padding: '8px 20px', background: 'var(--ink)', color: 'var(--surface)', borderRadius: 8, border: 'none', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
          Tout appeler
        </button>
        {ROUTES.map(r => (
          <button key={r.key} onClick={() => fetchOne(r.key, r.url, r.method)} disabled={loading[r.key]} style={{ padding: '8px 16px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontWeight: 500, fontSize: 12, cursor: 'pointer', color: 'var(--ink)', opacity: loading[r.key] ? 0.5 : 1 }}>
            {loading[r.key] ? '…' : r.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {ROUTES.map(r => {
          const res = results[r.key];
          const isUnauth = res?.status === 401;
          return (
            <div key={r.key} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderBottom: res ? '1px solid var(--border)' : 'none', background: 'var(--surface-2)' }}>
                <span style={{ fontWeight: 700, fontSize: 13 }}>{r.label}</span>
                <code style={{ fontSize: 11, color: 'var(--muted)' }}>{r.url}</code>
                {res && (
                  <>
                    <span style={{ fontSize: 11, fontWeight: 700, color: res.status === 200 ? '#3f8a52' : '#cd5b3f', background: res.status === 200 ? '#3f8a5220' : '#cd5b3f20', borderRadius: 4, padding: '2px 8px' }}>
                      {res.status || 'ERR'}{isUnauth ? ' Non authentifié' : ''}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>{res.duration}ms</span>
                  </>
                )}
                {!res && !loading[r.key] && <span style={{ fontSize: 11, color: 'var(--faint)' }}>Non appelé</span>}
                {loading[r.key] && <span style={{ fontSize: 11, color: 'var(--muted)' }}>Chargement…</span>}
              </div>
              {res && !isUnauth && (
                <pre style={{ margin: 0, padding: '16px 20px', fontSize: 11, lineHeight: 1.6, overflowX: 'auto', maxHeight: 500, color: res.error ? '#cd5b3f' : 'var(--ink)', background: 'transparent' }}>
                  {res.error ? res.error : JSON.stringify(res.data, null, 2)}
                </pre>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
