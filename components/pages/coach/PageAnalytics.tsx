'use client';
import InlineLoader from '@/components/ui/InlineLoader';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useSupabaseClients } from '@/lib/SupabaseClientsContext';
import { getClientSignals } from '@/lib/clientSignals';
import Icon from '@/components/ui/Icon';

const LineChart = dynamic(() => import('@/components/charts/LineChart'), { ssr: false });
const BarChart = dynamic(() => import('@/components/charts/BarChart'), { ssr: false });
const Heatmap = dynamic(() => import('@/components/charts/Heatmap'), { ssr: false });

type Platform = 'ig' | 'yt';

// Couleur stable par personne (hash de son id) — même palette que components/ui/Avatar.tsx.
const CLIENT_COLORS = ['#7C3AED', '#2563EB', '#059669', '#D97706', '#EA580C', '#DB2777', '#0891B2', '#65A30D'];
function clientColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) & 0xffffffff;
  return CLIENT_COLORS[Math.abs(h) % CLIENT_COLORS.length];
}

function initials(name: string) {
  return name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
}

export default function PageAnalytics() {
  const { clients, loading } = useSupabaseClients();
  const [platform, setPlatform] = useState<Platform>('ig');

  if (loading) return <InlineLoader fullPage />;

  // ── KPIs agrégés ──────────────────────────────────────────────────────────
  // NOTE (2026-08-03) : cette page dépendait entièrement de weekly_metrics, table
  // jamais alimentée par aucun cron (voir docs/... chantier weekly_metrics). Stub
  // minimal pour rester compilable en attendant la refonte complète prévue
  // (renommage "Stats Clients", chantier séparé) — comportement inchangé pour
  // l'utilisateur : les sections restent vides comme avant.
  const totalCash = clients.reduce((s, c) => s + (c.currentStats?.cashContracted || 0), 0);
  const totalCalls = 0;
  const avgClosing = clients.length > 0
    ? Math.round(clients.reduce((s, c) => s + (c.currentStats?.closingRate || 0), 0) / clients.length)
    : 0;

  const avgGrowth = 0;

  // ── Courbe croissance audience ─────────────────────────────────────────────
  const maxWeeks = 0;
  const weekLabels: string[] = [];
  const growthData: Record<string, unknown>[] = [];
  const growthLinesDef: { key: string; label: string; color: string }[] = [];

  // ── Heatmap posts ──────────────────────────────────────────────────────────
  const heatmapRows: { name: string; cells: { label: string; value: number }[] }[] = [];
  const heatmapCols: string[] = [];

  // ── BarChart DM vs taux réponse ────────────────────────────────────────────
  const dmBarData: { name: string; 'DM/sem moy.': number; 'Réponses %': number }[] = [];

  // ── Tableau comparatif ─────────────────────────────────────────────────────
  const tableRows = clients.map(c => {
    const m = c.currentStats;
    const igGrowthPct = 0;
    const avgPosts = 0;
    const avgDms = 0;
    const totalCallsClient = 0;
    return { c, m, igGrowthPct, avgPosts, avgDms, totalCallsClient, color: clientColor(c.id) };
  });

  return (
    <div className="page-content">
      <div className="page-header">
        <h1 className="page-title">Stats Clients</h1>
      </div>

      {/* KPIs */}
      <div className="grid-4" style={{ marginBottom: 24 }}>
        <div className="card" style={{ padding: '16px 20px' }}>
          <div className="eyebrow-sm" style={{ color: 'var(--muted)', marginBottom: 8 }}>Calls Calendly</div>
          <div style={{ fontSize: 28, fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>{totalCalls}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>ce mois</div>
        </div>
        <div className="card" style={{ padding: '16px 20px' }}>
          <div className="eyebrow-sm" style={{ color: 'var(--muted)', marginBottom: 8 }}>Deals iClosed</div>
          <div style={{ fontSize: 28, fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>{avgClosing}%</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>taux closing moy.</div>
        </div>
        <div className="card" style={{ padding: '16px 20px' }}>
          <div className="eyebrow-sm" style={{ color: 'var(--muted)', marginBottom: 8 }}>Cash contracté</div>
          <div style={{ fontSize: 28, fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--green)' }}>{totalCash.toLocaleString('fr-FR')} €</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>total</div>
        </div>
        <div className="card" style={{ padding: '16px 20px' }}>
          <div className="eyebrow-sm" style={{ color: 'var(--muted)', marginBottom: 8 }}>Croissance moy.</div>
          <div style={{ fontSize: 28, fontWeight: 800, fontFamily: 'var(--font-mono)', color: avgGrowth >= 0 ? 'var(--green)' : 'var(--red)' }}>
            {avgGrowth >= 0 ? '+' : ''}{avgGrowth}%
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>followers sur {Math.min(maxWeeks, 12)} sem.</div>
        </div>
      </div>

      {clients.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--muted)', fontSize: 13 }}>
          Les graphiques apparaîtront ici une fois que tes clients auront des métriques enregistrées.
        </div>
      ) : (
        <>
          {/* Croissance audience */}
          {maxWeeks >= 2 && (
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card-head">
                <div>
                  <div className="card-title">Croissance audience</div>
                  <div className="card-sub">Trajectoire par élève sur {Math.min(maxWeeks, 12)} semaines</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {(['ig', 'yt'] as Platform[]).map(p => (
                    <button
                      key={p}
                      onClick={() => setPlatform(p)}
                      style={{
                        padding: '5px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none',
                        background: platform === p ? 'var(--ink)' : 'var(--surface-2)',
                        color: platform === p ? 'var(--bg)' : 'var(--muted)',
                      }}
                    >
                      {p === 'ig' ? 'Instagram' : 'YouTube'}
                    </button>
                  ))}
                </div>
              </div>
              <LineChart
                data={growthData}
                lines={growthLinesDef}
                xKey="week"
                height={240}
                formatter={(n) => n.toLocaleString('fr-FR')}
              />
            </div>
          )}

          {/* Heatmap + DM */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
            {heatmapRows.some(r => r.cells.length > 0) && (
              <div className="card">
                <div className="card-head">
                  <div className="card-title">Posts par élève / semaine</div>
                  <div className="card-sub">Fréquence de publication ({Math.min(maxWeeks, 12)} semaines)</div>
                </div>
                <Heatmap rows={heatmapRows} colLabels={heatmapCols} />
              </div>
            )}
            {dmBarData.some(d => d['DM/sem moy.'] > 0) && (
              <div className="card">
                <div className="card-head">
                  <div className="card-title">DM envoyés vs Taux réponse</div>
                  <div className="card-sub">Activité prospection par élève</div>
                </div>
                <BarChart
                  data={dmBarData}
                  bars={[
                    { key: 'DM/sem moy.', label: 'DM/sem moy.', color: 'var(--ink)' },
                    { key: 'Réponses %', label: 'Réponses %', color: 'var(--green)' },
                  ]}
                  xKey="name"
                  height={220}
                />
              </div>
            )}
          </div>

          {/* Tableau comparatif */}
          <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 24 }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div className="card-title">Tableau comparatif</div>
                <div className="card-sub">Tous les élèves · métriques clés</div>
              </div>
              <button
                className="btn-ghost"
                style={{ fontSize: 12 }}
                onClick={() => {
                  const headers = ['Élève', 'Signaux', 'Audience IG', 'Croissance IG', 'Posts/sem', 'DM/sem', 'Calls', 'Cash'];
                  const rows = tableRows.map(({ c, m, igGrowthPct, avgPosts, avgDms, totalCallsClient }) => [
                    c.name,
                    String(getClientSignals(c.tasks, c.sessionReports).total),
                    (m?.followersIg || 0).toLocaleString('fr-FR'),
                    `${igGrowthPct >= 0 ? '+' : ''}${igGrowthPct}%`,
                    avgPosts,
                    avgDms,
                    totalCallsClient,
                    `${(m?.cashContracted || 0).toLocaleString('fr-FR')} €`,
                  ]);
                  const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
                  const a = document.createElement('a');
                  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
                  a.download = 'analytics-eleves.csv';
                  a.click();
                }}
              >
                ↓ Export CSV
              </button>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Élève</th>
                    <th>Signaux</th>
                    <th>Audience totale</th>
                    <th>Croissance IG</th>
                    <th>Posts/sem</th>
                    <th>DM/sem</th>
                    <th>Calls</th>
                    <th>Cash</th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map(({ c, m, igGrowthPct, avgPosts, avgDms, totalCallsClient, color }) => (
                    <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => window.location.href = `/clients/${c.id}/analytics`}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{
                            width: 32, height: 32, borderRadius: '50%', background: c.avatar_url ? undefined : color,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0,
                            overflow: 'hidden',
                          }}>
                            {c.avatar_url
                              ? <img src={c.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              : initials(c.name)}
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 13 }}>{c.name}</div>
                            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{c.niche}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        {(() => {
                          const s = getClientSignals(c.tasks, c.sessionReports);
                          return s.total > 0
                            ? <span className="pill pill-red" style={{ fontSize: 11 }}>{s.total} signal{s.total > 1 ? 's' : ''}</span>
                            : <span style={{ fontSize: 12, color: 'var(--muted)' }}>—</span>;
                        })()}
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700 }}>
                        {((m?.followersIg || 0) + (m?.followersYt || 0)).toLocaleString('fr-FR')}
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: igGrowthPct > 0 ? 'var(--green)' : igGrowthPct < 0 ? 'var(--red)' : 'var(--muted)' }}>
                        {igGrowthPct !== 0 ? `${igGrowthPct >= 0 ? '+' : ''}${igGrowthPct}%` : '—'}
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{avgPosts}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{avgDms}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{totalCallsClient}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: (m?.cashContracted || 0) > 0 ? 'var(--green)' : 'var(--muted)' }}>
                        {(m?.cashContracted || 0).toLocaleString('fr-FR')} €
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
