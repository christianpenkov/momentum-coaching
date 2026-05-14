'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import KpiRibbon from '@/components/ui/KpiRibbon';
import CardHead from '@/components/ui/CardHead';
import Pill from '@/components/ui/Pill';
import Icon from '@/components/ui/Icon';
import { clients, getTotalMRR, getActiveClients } from '@/lib/data';

const LineChart = dynamic(() => import('@/components/charts/LineChart'), { ssr: false });
const BarChart = dynamic(() => import('@/components/charts/BarChart'), { ssr: false });
const AreaChart = dynamic(() => import('@/components/charts/AreaChart'), { ssr: false });
const DonutChart = dynamic(() => import('@/components/charts/DonutChart'), { ssr: false });
const Heatmap = dynamic(() => import('@/components/charts/Heatmap'), { ssr: false });

const WEEKS = Array.from({ length: 12 }, (_, i) => `S${i + 1}`);

function buildMRRTimeline() {
  return WEEKS.map((week, wi) => ({
    week,
    mrr: clients.reduce((sum, c) => sum + (c.weeklyHistory[wi]?.stripeMRR || 0), 0),
  }));
}

function buildFollowerTimeline(network: 'followersIG' | 'followersTikTok' | 'followersYT' | 'followersLinkedIn') {
  return WEEKS.map((week, wi) => {
    const entry: Record<string, unknown> = { week };
    clients.slice(0, 6).forEach(c => {
      entry[c.initials] = c.weeklyHistory[wi]?.[network] || 0;
    });
    return entry;
  });
}

function buildHeatmapRows() {
  return clients.slice(0, 8).map(c => ({
    name: c.initials,
    cells: c.weeklyHistory.map((w, i) => ({ label: `S${i + 1}`, value: w.postsCount })),
  }));
}

function buildComparativeTable() {
  return clients.slice(0, 12).map(c => {
    const last = c.weeklyHistory[11];
    const first = c.weeklyHistory[0];
    const totalFollowers = last.followersIG + last.followersTikTok + last.followersYT + last.followersLinkedIn;
    const growth = first.followersIG > 0 ? Math.round(((last.followersIG - first.followersIG) / first.followersIG) * 100) : 0;
    return {
      ...c,
      totalFollowers,
      growth,
      lastMRR: last.stripeMRR,
      lastPosts: last.postsCount,
      lastDMs: last.dmsSent,
      lastCals: last.calendlyCalls,
    };
  });
}

const donutData = [
  { label: 'En vert', value: clients.filter(c => c.status === 'green').length, color: 'var(--green)' },
  { label: 'En amber', value: clients.filter(c => c.status === 'amber').length, color: 'var(--amber)' },
  { label: 'En alerte', value: clients.filter(c => c.status === 'red').length, color: 'var(--red)' },
];

type NetworkKey = 'followersIG' | 'followersTikTok' | 'followersYT' | 'followersLinkedIn';
const NETWORKS: { key: NetworkKey; label: string }[] = [
  { key: 'followersIG', label: 'Instagram' },
  { key: 'followersTikTok', label: 'TikTok' },
  { key: 'followersYT', label: 'YouTube' },
  { key: 'followersLinkedIn', label: 'LinkedIn' },
];

export default function PageAnalytics() {
  const [network, setNetwork] = useState<NetworkKey>('followersIG');
  const mrrTimeline = buildMRRTimeline();
  const followerTimeline = buildFollowerTimeline(network);
  const heatmapRows = buildHeatmapRows();
  const tableData = buildComparativeTable();
  const totalMRR = getTotalMRR();
  const activeCount = getActiveClients();
  const avgGrowth = Math.round(tableData.reduce((s, c) => s + c.growth, 0) / tableData.length);

  const kpis = [
    { label: 'MRR total', value: totalMRR, formatter: (n: number) => `${n.toLocaleString('fr-FR')} €` },
    { label: 'Clients actifs', value: activeCount },
    { label: 'Rétention moy.', value: 91, formatter: (n: number) => `${n}%` },
    { label: 'Croissance moy.', value: avgGrowth, formatter: (n: number) => `+${n}%`, color: 'var(--green)' },
  ];

  const top6 = clients.slice(0, 6);
  const followerLines = top6.map((c, i) => ({ key: c.initials, label: c.name.split(' ')[0] }));

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1 className="page-title">Analytics</h1>
          <p className="page-sub">Vue cross-data de tous vos élèves</p>
        </div>
        <button className="btn-ghost" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon name="download" size={14} /> Exporter
        </button>
      </div>

      <KpiRibbon items={kpis} />

      {/* Section 1 — Portfolio */}
      <div className="grid-analytics" style={{ marginTop: 24 }}>
        <div className="card" style={{ gridColumn: 'span 2' }}>
          <CardHead title="Évolution MRR" subtitle="12 dernières semaines · tous élèves" />
          <LineChart
            data={mrrTimeline}
            lines={[{ key: 'mrr', label: 'MRR global', color: 'var(--accent)' }]}
            xKey="week"
            height={200}
            formatter={(n) => `${n.toLocaleString('fr-FR')} €`}
          />
        </div>

        <div className="card" style={{ position: 'relative' }}>
          <CardHead title="Répartition statuts" subtitle="Distribution rouge/amber/vert" />
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}>
            <DonutChart
              data={donutData}
              height={180}
              centerLabel={`${clients.length}`}
              centerSub="élèves"
              formatter={(n) => `${n} élèves`}
            />
          </div>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 8 }}>
            {donutData.map((d, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: d.color, display: 'inline-block' }} />
                <span style={{ color: 'var(--muted)' }}>{d.label}</span>
                <strong style={{ color: 'var(--accent)' }}>{d.value}</strong>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Section 2 — Croissance followers */}
      <div className="card" style={{ marginTop: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <CardHead title="Croissance audience" subtitle="Trajectoire par élève sur 12 semaines" />
          <div style={{ display: 'flex', gap: 6 }}>
            {NETWORKS.map(n => (
              <button
                key={n.key}
                className={`chip${network === n.key ? ' chip-active' : ''}`}
                onClick={() => setNetwork(n.key)}
                type="button"
              >
                {n.label}
              </button>
            ))}
          </div>
        </div>
        <LineChart
          data={followerTimeline}
          lines={followerLines}
          xKey="week"
          height={240}
          formatter={(n) => n.toLocaleString('fr-FR')}
        />
      </div>

      {/* Section 3 — Activité contenu */}
      <div className="grid-2" style={{ marginTop: 24 }}>
        <div className="card">
          <CardHead title="Posts par élève / semaine" subtitle="Fréquence de publication (12 semaines)" />
          <Heatmap
            rows={heatmapRows}
            colLabels={WEEKS}
          />
        </div>

        <div className="card">
          <CardHead title="DM envoyés vs Taux réponse" subtitle="Activité prospection par élève" />
          <BarChart
            data={clients.slice(0, 8).map(c => ({
              name: c.initials,
              dms: Math.round(c.weeklyHistory.reduce((s, w) => s + w.dmsSent, 0) / 12),
              reply: Math.round(c.weeklyHistory.reduce((s, w) => s + w.dmsReplyRate, 0) / 12),
            }))}
            bars={[
              { key: 'dms', label: 'DM/sem moy.', color: 'var(--accent)' },
              { key: 'reply', label: 'Réponses %', color: 'var(--green)' },
            ]}
            xKey="name"
            height={220}
          />
        </div>
      </div>

      {/* Section 4 — Funnel business */}
      <div className="grid-4" style={{ marginTop: 24 }}>
        <div className="card funnel-card">
          <div className="funnel-icon"><Icon name="calendar" size={20} /></div>
          <div className="funnel-label">Calls Calendly</div>
          <div className="funnel-value">{clients.reduce((s, c) => s + (c.calendlyMonthly || 0), 0)}</div>
          <div className="funnel-sub">ce mois</div>
        </div>
        <div className="card funnel-card">
          <div className="funnel-icon"><Icon name="target" size={20} /></div>
          <div className="funnel-label">Deals iClosed</div>
          <div className="funnel-value">{Math.round(clients.reduce((s, c) => s + (c.iClosedRate || 0), 0) / clients.length)}%</div>
          <div className="funnel-sub">taux closing moy.</div>
        </div>
        <div className="card funnel-card">
          <div className="funnel-icon"><Icon name="dollar-sign" size={20} /></div>
          <div className="funnel-label">MRR Stripe</div>
          <div className="funnel-value">{totalMRR.toLocaleString('fr-FR')} €</div>
          <div className="funnel-sub">mensuel récurrent</div>
        </div>
        <div className="card funnel-card">
          <div className="funnel-icon" style={{ color: 'var(--green)' }}><Icon name="trending-up" size={20} /></div>
          <div className="funnel-label">Croissance moy.</div>
          <div className="funnel-value" style={{ color: 'var(--green)' }}>+{avgGrowth}%</div>
          <div className="funnel-sub">followers sur 12 sem.</div>
        </div>
      </div>

      {/* Section 5 — Tableau comparatif */}
      <div className="card" style={{ marginTop: 24 }}>
        <CardHead
          title="Tableau comparatif"
          subtitle="Tous les élèves · métriques clés"
          action={<button className="btn-ghost" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}><Icon name="download" size={13} /> Export CSV</button>}
        />
        <div style={{ overflowX: 'auto', marginTop: 16 }}>
          <table className="data-table" style={{ minWidth: 700 }}>
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
              {tableData.map(c => (
                <tr key={c.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div className="avatar" style={{ width: 26, height: 26, fontSize: 10 }}>{c.initials}</div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 12 }}>{c.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{c.niche}</div>
                      </div>
                    </div>
                  </td>
                  <td><Pill status={c.status as 'green' | 'amber' | 'red'} label={c.status === 'green' ? 'Vert' : c.status === 'amber' ? 'Vigilance' : 'Alerte'} size="sm" /></td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{c.totalFollowers.toLocaleString('fr-FR')}</td>
                  <td style={{ color: c.growth >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600, fontSize: 12 }}>{c.growth >= 0 ? '+' : ''}{c.growth}%</td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{c.lastPosts}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{c.lastDMs}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{c.lastCals}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600 }}>{c.lastMRR.toLocaleString('fr-FR')} €</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
