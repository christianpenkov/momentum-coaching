'use client';

import { useState } from 'react';

const TOOLS = [
  {
    key: 'instagram',
    label: 'Instagram',
    endpoints: [
      { label: 'Stats complètes', url: '/api/instagram/stats', method: 'GET' },
    ],
  },
  {
    key: 'youtube',
    label: 'YouTube',
    endpoints: [
      { label: 'Stats complètes', url: '/api/youtube/stats', method: 'GET' },
      { label: 'Test métriques exhaustif', url: '/api/youtube/test-metrics', method: 'GET' },
      { label: 'Rétention vidéo (exemple)', url: '/api/youtube/video-retention?videoId=awrGQJIdthA', method: 'GET' },
    ],
  },
  {
    key: 'stripe',
    label: 'Stripe',
    endpoints: [
      { label: 'Client data', url: '/api/stripe/client-data', method: 'GET' },
    ],
  },
  {
    key: 'shortio',
    label: 'Short.io',
    endpoints: [
      { label: 'Stats complètes', url: '/api/shortio/stats', method: 'GET' },
    ],
  },
  {
    key: 'calendly',
    label: 'Calendly',
    endpoints: [
      { label: 'Sync (POST)', url: '/api/calendly/sync', method: 'POST' },
      { label: 'Test métriques exhaustif', url: '/api/calendly/test-metrics', method: 'GET' },
    ],
  },
];

type Result = { status: number; data: unknown; duration: number };

export default function MetricsPage() {
  const [activeTool, setActiveTool] = useState(TOOLS[0].key);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});

  const tool = TOOLS.find(t => t.key === activeTool)!;

  async function fetchEndpoint(key: string, url: string, method: string) {
    setLoading(l => ({ ...l, [key]: true }));
    const t0 = Date.now();
    try {
      const res = await fetch(url, { method });
      const text = await res.text();
      let data: unknown;
      try { data = JSON.parse(text); } catch { data = text || null; }
      setResults(r => ({ ...r, [key]: { status: res.status, data, duration: Date.now() - t0 } }));
    } catch (e: any) {
      setResults(r => ({ ...r, [key]: { status: 0, data: { error: e.message }, duration: Date.now() - t0 } }));
    } finally {
      setLoading(l => ({ ...l, [key]: false }));
    }
  }

  async function fetchAll() {
    await Promise.all(tool.endpoints.map(e => fetchEndpoint(`${activeTool}:${e.url}`, e.url, e.method)));
  }

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'monospace', fontSize: 12 }}>
      {/* Sidebar outils */}
      <div style={{ width: 160, borderRight: '1px solid var(--border)', padding: '16px 0', flexShrink: 0, background: 'var(--surface-2)' }}>
        <div style={{ padding: '0 16px 12px', fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Outils</div>
        {TOOLS.map(t => (
          <button key={t.key} onClick={() => setActiveTool(t.key)} style={{
            display: 'block', width: '100%', textAlign: 'left', padding: '8px 16px',
            background: activeTool === t.key ? 'var(--surface)' : 'transparent',
            border: 'none', borderLeft: activeTool === t.key ? '2px solid var(--ink)' : '2px solid transparent',
            fontWeight: activeTool === t.key ? 700 : 400, fontSize: 13, cursor: 'pointer',
            color: activeTool === t.key ? 'var(--ink)' : 'var(--muted)',
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Contenu */}
      <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{tool.label}</h1>
          <button onClick={fetchAll} style={{
            padding: '6px 16px', background: 'var(--ink)', color: 'var(--surface)',
            border: 'none', borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: 'pointer',
          }}>
            Tout appeler
          </button>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>{tool.endpoints.length} endpoint{tool.endpoints.length > 1 ? 's' : ''}</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {tool.endpoints.map(e => {
            const key = `${activeTool}:${e.url}`;
            const res = results[key];
            const isLoading = loading[key];
            return (
              <div key={e.url} style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 3, background: e.method === 'POST' ? '#7c5cbf20' : '#3f8a5220', color: e.method === 'POST' ? '#7c5cbf' : '#3f8a52' }}>
                    {e.method}
                  </span>
                  <code style={{ fontSize: 12, color: 'var(--ink)', fontWeight: 600 }}>{e.url}</code>
                  <span style={{ color: 'var(--muted)', fontSize: 11 }}>{e.label}</span>
                  <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                    {res && (
                      <>
                        <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: res.status === 200 ? '#3f8a5220' : '#cd5b3f20', color: res.status === 200 ? '#3f8a52' : '#cd5b3f' }}>
                          {res.status || 'ERR'}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--muted)' }}>{res.duration}ms</span>
                      </>
                    )}
                    <button onClick={() => fetchEndpoint(key, e.url, e.method)} disabled={isLoading} style={{
                      padding: '4px 12px', fontSize: 11, fontWeight: 600, borderRadius: 5, cursor: 'pointer',
                      border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--ink)',
                      opacity: isLoading ? 0.5 : 1,
                    }}>
                      {isLoading ? '…' : 'Appeler'}
                    </button>
                  </div>
                </div>

                {res && (
                  <pre style={{
                    margin: 0, padding: '16px', fontSize: 11, lineHeight: 1.6,
                    overflowX: 'auto', background: 'var(--surface)',
                    color: res.status !== 200 ? '#cd5b3f' : 'var(--ink)',
                    whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                  }}>
                    {JSON.stringify(res.data, null, 2)}
                  </pre>
                )}
                {!res && !isLoading && (
                  <div style={{ padding: '24px 16px', color: 'var(--faint)', fontSize: 11, textAlign: 'center' }}>
                    Non appelé
                  </div>
                )}
                {isLoading && (
                  <div style={{ padding: '24px 16px', color: 'var(--muted)', fontSize: 11, textAlign: 'center' }}>
                    Chargement…
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
