'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import DesktopOnly from '@/components/ui/DesktopOnly';

// ─── Section Data Range ───────────────────────────────────────────────────────
function DataRangeSection() {
  const [profileId, setProfileId] = useState('');
  const [profileLabel, setProfileLabel] = useState('');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [loadingProfiles, setLoadingProfiles] = useState(true);
  const [profiles, setProfiles] = useState<{ id: string; name: string }[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Charge tous les profils clients accessibles au coach
  useEffect(() => {
    async function loadProfiles() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoadingProfiles(false); return; }

      // D'abord l'ID du coach lui-même
      const { data: myProfile } = await supabase
        .from('profiles')
        .select('id, full_name, role')
        .eq('id', user.id)
        .single();

      if (myProfile?.role === 'coach') {
        // Cherche les clients liés à ce coach
        const { data: clients } = await supabase
          .from('profiles')
          .select('id, full_name')
          .eq('coach_id', user.id)
          .eq('role', 'client');

        const list = [
          { id: myProfile.id, name: `Moi (${myProfile.full_name || 'coach'})` },
          ...(clients || []).map(c => ({ id: c.id, name: c.full_name || c.id.slice(0, 8) })),
        ];
        setProfiles(list);
        // Auto-select le premier client
        if (clients?.length) {
          setProfileId(clients[0].id);
          setProfileLabel(clients[0].full_name || clients[0].id.slice(0, 8));
        }
      } else {
        // C'est un client, on prend son propre ID
        setProfiles([{ id: user.id, name: myProfile?.full_name || 'Mon profil' }]);
        setProfileId(user.id);
        setProfileLabel(myProfile?.full_name || 'Mon profil');
      }
      setLoadingProfiles(false);
    }
    loadProfiles();
  }, []);

  async function run() {
    if (!profileId) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch(`/api/debug-data-range?profile_id=${profileId}`);
      const data = await res.json();
      setResult(data);
      setExpanded({ _summary: true });
    } catch (e: any) {
      setResult({ error: e.message });
    } finally {
      setLoading(false);
    }
  }

  const statusColor = (s: string) => s?.includes('✅') ? '#3f8a52' : s?.includes('⚠️') ? '#d97706' : '#cd5b3f';

  return (
    <div style={{ marginBottom: 36 }}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>Data Range — Granularité & Day-to-Day</div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
        Inspecte ce que chaque API retourne réellement sur 30j : dates disponibles, day-to-day ou pas, champs.
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {loadingProfiles ? (
          <div style={{ flex: 1, padding: '9px 14px', fontSize: 13, color: 'var(--muted)' }}>Chargement des profils…</div>
        ) : profiles.length > 1 ? (
          <select
            value={profileId}
            onChange={e => {
              const p = profiles.find(p => p.id === e.target.value);
              setProfileId(e.target.value);
              setProfileLabel(p?.name || '');
            }}
            style={{ flex: 1, padding: '9px 14px', fontSize: 13, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)', color: 'var(--ink)' }}
          >
            {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        ) : (
          <div style={{ flex: 1, padding: '9px 14px', fontSize: 13, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--muted)' }}>
            {profileLabel || profileId || 'Aucun profil trouvé'}
          </div>
        )}
        <button onClick={run} disabled={loading || !profileId}
          style={{ padding: '9px 22px', background: 'var(--ink)', color: 'var(--surface)', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: loading ? 'wait' : 'pointer', opacity: loading || !profileId ? 0.5 : 1 }}>
          {loading ? '⏳ Analyse…' : 'Analyser'}
        </button>
      </div>

      {result && !result.error && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Summary en premier */}
          {result._summary && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 20px', background: 'var(--surface-2)', cursor: 'pointer' }}
                onClick={() => setExpanded(e => ({ ...e, _summary: !e._summary }))}>
                <span style={{ fontWeight: 700, fontSize: 13 }}>📋 Résumé & Recommandations</span>
                <span style={{ marginLeft: 'auto', fontSize: 16 }}>{expanded._summary ? '▲' : '▼'}</span>
              </div>
              {expanded._summary && (
                <div style={{ padding: '16px 20px' }}>
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 8 }}>Day-to-day disponible</div>
                    {Object.entries(result._summary.dayToDayAvailable).map(([k, v]: [string, any]) => (
                      <div key={k} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 6 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, minWidth: 180, color: 'var(--muted)' }}>{k}</span>
                        <span style={{ fontSize: 12, color: statusColor(v) }}>{v}</span>
                      </div>
                    ))}
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 8 }}>Recommandations</div>
                    {result._summary.recommendation.map((r: string, i: number) => (
                      <div key={i} style={{ fontSize: 12, color: 'var(--ink)', marginBottom: 5, paddingLeft: 12, borderLeft: '2px solid var(--border)' }}>→ {r}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Chaque API */}
          {(['instagram', 'youtube', 'stripe', 'calendly'] as const).map(api => {
            const d = result[api];
            if (!d) return null;
            const ok = d.status === 'OK' || d.status?.includes('OK');
            return (
              <div key={api} style={{ background: 'var(--surface)', border: `1px solid ${ok ? 'var(--border)' : '#cd5b3f40'}`, borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 20px', background: 'var(--surface-2)', cursor: 'pointer' }}
                  onClick={() => setExpanded(e => ({ ...e, [api]: !e[api] }))}>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>
                    {api === 'instagram' ? '📸 Instagram' : api === 'youtube' ? '▶️ YouTube' : api === 'stripe' ? '💳 Stripe' : '📅 Calendly'}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: ok ? '#3f8a52' : '#cd5b3f', background: ok ? '#3f8a5220' : '#cd5b3f20', borderRadius: 4, padding: '2px 8px' }}>
                    {d.status}
                  </span>
                  {d.chartData && (
                    <span style={{ fontSize: 11, color: statusColor(d.chartData.status), fontWeight: 600 }}>
                      {d.chartData.status} · {d.chartData.count} pts · {d.chartData.firstDate} → {d.chartData.lastDate}
                    </span>
                  )}
                  {d.timeSeries && (
                    <span style={{ fontSize: 11, color: statusColor(d.timeSeries.status), fontWeight: 600 }}>
                      {d.timeSeries.datesWithCalls} dates avec calls
                    </span>
                  )}
                  <span style={{ marginLeft: 'auto', fontSize: 16 }}>{expanded[api] ? '▲' : '▼'}</span>
                </div>
                {expanded[api] && (
                  <pre style={{ margin: 0, padding: '16px 20px', fontSize: 11, lineHeight: 1.6, overflowX: 'auto', maxHeight: 500, background: 'transparent', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--ink)' }}>
                    {JSON.stringify(d, null, 2)}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      )}

      {result?.error && (
        <div style={{ padding: '12px 16px', background: '#cd5b3f15', border: '1px solid #cd5b3f40', borderRadius: 8, fontSize: 12, color: '#cd5b3f' }}>
          Erreur : {result.error}
        </div>
      )}
    </div>
  );
}

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

function CopyButton({ data }: { data: unknown }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }
  return (
    <button onClick={copy} style={{ marginLeft: 'auto', padding: '4px 12px', fontSize: 11, fontWeight: 600, borderRadius: 6, border: '1px solid var(--border)', background: copied ? '#3f8a5220' : 'var(--surface)', color: copied ? '#3f8a52' : 'var(--muted)', cursor: 'pointer', flexShrink: 0 }}>
      {copied ? '✓ Copié' : 'Copier JSON'}
    </button>
  );
}

export default function ApiDebugPage() {
  return <DesktopOnly><ApiDebugPageContent /></DesktopOnly>;
}

function ApiDebugPageContent() {
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

      {/* ─── DATA RANGE DEBUG ─── */}
      <DataRangeSection />

      <hr style={{ border: 'none', borderTop: '1px solid var(--border)', marginBottom: 28 }} />

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
                  <CopyButton data={res.data} />
                </div>
                <pre className="selectable" style={{ margin: 0, padding: '16px 20px', fontSize: 11, lineHeight: 1.6, overflowX: 'auto', maxHeight: 600, color: res.error ? '#cd5b3f' : 'var(--ink)', background: 'transparent', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
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
                    {!isUnauth && <CopyButton data={res.data} />}
                  </>
                )}
                {!res && !loading[r.key] && <span style={{ fontSize: 11, color: 'var(--faint)' }}>Non appelé</span>}
                {loading[r.key] && <span style={{ fontSize: 11, color: 'var(--muted)' }}>Chargement…</span>}
              </div>
              {res && !isUnauth && (
                <pre className="selectable" style={{ margin: 0, padding: '16px 20px', fontSize: 11, lineHeight: 1.6, overflowX: 'auto', maxHeight: 500, color: res.error ? '#cd5b3f' : 'var(--ink)', background: 'transparent', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
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
