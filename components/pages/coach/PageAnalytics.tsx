'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useSupabaseClients } from '@/lib/SupabaseClientsContext';
import Icon from '@/components/ui/Icon';

const LineChart = dynamic(() => import('@/components/charts/LineChart'), { ssr: false });
const BarChart = dynamic(() => import('@/components/charts/BarChart'), { ssr: false });
const Heatmap = dynamic(() => import('@/components/charts/Heatmap'), { ssr: false });

type Platform = 'ig' | 'yt';

const CLIENT_COLORS = [
  '#7c6dde', '#3f8a52', '#cd5b3f', '#b58025', '#2a7fad',
  '#a63d8f', '#4d8070', '#c24e4e', '#6b7cde', '#7a9e3f',
  '#d4814a', '#3d7da6',
];

function initials(name: string) {
  return name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
}

export default function PageAnalytics() {
  const { clients, loading } = useSupabaseClients();
  const [platform, setPlatform] = useState<Platform>('ig');

  if (loading) {
    return (
      <div className="page-content">
        <div className="page-header"><h1 className="page-title">Analytics</h1></div>
        <div style={{ color: 'var(--muted)', fontSize: 13, paddingTop: 40, textAlign: 'center' }}>
          <Icon name="refresh-cw" size={16} /> Chargement…
        </div>
      </div>
    );
  }

  // ── KPIs agrégés ──────────────────────────────────────────────────────────
  const totalMRR = clients.reduce((s, c) => s + (c.latestMetrics?.stripe_mrr || 0), 0);
  const totalCalls = clients.reduce((s, c) => {
    const metrics = c.weeklyMetrics || [];
    // somme calls du mois (4 dernières semaines)
    return s + metrics.slice(-4).reduce((a, m) => a + (m.calendly_calls || 0), 0);
  }, 0);
  const avgClosing = clients.length > 0
    ? Math.round(clients.reduce((s, c) => s + (c.latestMetrics?.closing_rate || 0), 0) / clients.length)
    : 0;

  // croissance IG moyenne sur 12 semaines
  const clientsWithEnoughMetrics = clients.filter(c => (c.weeklyMetrics?.length || 0) >= 2);
  const avgGrowth = clientsWithEnoughMetrics.length > 0
    ? Math.round(clientsWithEnoughMetrics.reduce((s, c) => {
        const m = c.weeklyMetrics!;
        const first = m[0].followers_ig || 1;
        const last = m[m.length - 1].followers_ig || 0;
        return s + ((last - first) / first) * 100;
      }, 0) / clientsWithEnoughMetrics.length)
    : 0;

  // ── Courbe croissance audience ─────────────────────────────────────────────
  // Aligner sur "semaine relative" S1…S12 pour comparer les élèves entre eux
  const maxWeeks = Math.max(...clients.map(c => c.weeklyMetrics?.length || 0), 0);
  const weekLabels = Array.from({ length: Math.min(maxWeeks, 12) }, (_, i) => `S${i + 1}`);

  const growthLines = clients.map((c, idx) => {
    const metrics = (c.weeklyMetrics || []).slice(0, 12);
    const row: Record<string, unknown> = { week: '' };
    metrics.forEach((m, i) => {
      row[`S${i + 1}`] = platform === 'ig' ? (m.followers_ig || 0) : (m.followers_yt || 0);
    });
    return { client: c, metrics, color: CLIENT_COLORS[idx % CLIENT_COLORS.length] };
  });

  // Construire les data points pour LineChart : une entrée par semaine
  const growthData = weekLabels.map((wk, i) => {
    const row: Record<string, unknown> = { week: wk };
    growthLines.forEach(({ client, metrics }) => {
      row[client.id] = metrics[i] ? (platform === 'ig' ? metrics[i].followers_ig : metrics[i].followers_yt) : null;
    });
    return row;
  });

  const growthLinesDef = growthLines.map(({ client, color }) => ({
    key: client.id,
    label: client.name,
    color,
  }));

  // ── Heatmap posts ──────────────────────────────────────────────────────────
  const heatmapRows = clients.map(c => ({
    name: initials(c.name),
    cells: (c.weeklyMetrics || []).slice(0, 12).map((m, i) => ({
      label: `S${i + 1}`,
      value: m.posts_count || 0,
    })),
  }));
  const heatmapCols = clients.length > 0
    ? (clients[0].weeklyMetrics || []).slice(0, 12).map((_, i) => `S${i + 1}`)
    : [];

  // ── BarChart DM vs taux réponse ────────────────────────────────────────────
  const dmBarData = clients.map(c => ({
    name: initials(c.name),
    'DM/sem moy.': c.weeklyMetrics?.length
      ? Math.round(c.weeklyMetrics.reduce((s, m) => s + (m.dms_sent || 0), 0) / c.weeklyMetrics.length)
      : 0,
    'Réponses %': c.latestMetrics?.dms_reply_rate || 0,
  }));

  // ── Tableau comparatif ─────────────────────────────────────────────────────
  const tableRows = clients.map((c, idx) => {
    const m = c.latestMetrics;
    const metrics = c.weeklyMetrics || [];
    const igFirst = metrics[0]?.followers_ig || 0;
    const igLast = m?.followers_ig || 0;
    const igGrowthPct = igFirst > 0 ? Math.round(((igLast - igFirst) / igFirst) * 100) : 0;
    const avgPosts = metrics.length > 0
      ? Math.round(metrics.reduce((s, x) => s + (x.posts_count || 0), 0) / metrics.length * 10) / 10
      : 0;
    const avgDms = metrics.length > 0
      ? Math.round(metrics.reduce((s, x) => s + (x.dms_sent || 0), 0) / metrics.length)
      : 0;
    const totalCallsClient = metrics.slice(-4).reduce((s, x) => s + (x.calendly_calls || 0), 0);
    return { c, m, igGrowthPct, avgPosts, avgDms, totalCallsClient, color: CLIENT_COLORS[idx % CLIENT_COLORS.length] };
  });

  return (
    <div className="page-content">
      <div className="page-header">
        <h1 className="page-title">Analytics</h1>
      </div>

      {/* KPIs */}
      <div className="grid-4" style={{ marginBottom: 24 }}>
        <div className="card" style={{ padding: '16px 20px' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Calls Calendly</div>
          <div style={{ fontSize: 28, fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>{totalCalls}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>ce mois</div>
        </div>
        <div className="card" style={{ padding: '16px 20px' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Deals iClosed</div>
          <div style={{ fontSize: 28, fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>{avgClosing}%</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>taux closing moy.</div>
        </div>
        <div className="card" style={{ padding: '16px 20px' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>MRR Stripe</div>
          <div style={{ fontSize: 28, fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--green)' }}>{totalMRR.toLocaleString('fr-FR')} €</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>mensuel récurrent</div>
        </div>
        <div className="card" style={{ padding: '16px 20px' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Croissance moy.</div>
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
                  const headers = ['Élève', 'Statut', 'Audience IG', 'Croissance IG', 'Posts/sem', 'DM/sem', 'Calls', 'MRR'];
                  const rows = tableRows.map(({ c, m, igGrowthPct, avgPosts, avgDms, totalCallsClient }) => [
                    c.name,
                    c.status === 'green' ? 'Vert' : c.status === 'amber' ? 'Vigilance' : 'Alerte',
                    (m?.followers_ig || 0).toLocaleString('fr-FR'),
                    `${igGrowthPct >= 0 ? '+' : ''}${igGrowthPct}%`,
                    avgPosts,
                    avgDms,
                    totalCallsClient,
                    `${(m?.stripe_mrr || 0).toLocaleString('fr-FR')} €`,
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
                    <th>Statut</th>
                    <th>Audience totale</th>
                    <th>Croissance IG</th>
                    <th>Posts/sem</th>
                    <th>DM/sem</th>
                    <th>Calls</th>
                    <th>MRR</th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map(({ c, m, igGrowthPct, avgPosts, avgDms, totalCallsClient, color }) => (
                    <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => window.location.href = `/clients/${c.id}/analytics`}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{
                            width: 32, height: 32, borderRadius: '50%', background: color,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0,
                          }}>
                            {initials(c.name)}
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 13 }}>{c.name}</div>
                            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{c.niche}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={`pill pill-${c.status}`} style={{ fontSize: 11 }}>
                          {c.status === 'green' ? 'Vert' : c.status === 'amber' ? 'Vigilance' : 'Alerte'}
                        </span>
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700 }}>
                        {((m?.followers_ig || 0) + (m?.followers_yt || 0)).toLocaleString('fr-FR')}
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: igGrowthPct > 0 ? 'var(--green)' : igGrowthPct < 0 ? 'var(--red)' : 'var(--muted)' }}>
                        {igGrowthPct !== 0 ? `${igGrowthPct >= 0 ? '+' : ''}${igGrowthPct}%` : '—'}
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{avgPosts}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{avgDms}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{totalCallsClient}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: (m?.stripe_mrr || 0) > 0 ? 'var(--green)' : 'var(--muted)' }}>
                        {(m?.stripe_mrr || 0).toLocaleString('fr-FR')} €
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
