'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import Avatar from '@/components/ui/Avatar';
import Pill from '@/components/ui/Pill';
import Icon from '@/components/ui/Icon';
import { getClient } from '@/lib/data';

const LineChart = dynamic(() => import('@/components/charts/LineChart'), { ssr: false });
const BarChart = dynamic(() => import('@/components/charts/BarChart'), { ssr: false });
const AreaChart = dynamic(() => import('@/components/charts/AreaChart'), { ssr: false });

interface Props { id: string }

const WEEKS = Array.from({ length: 12 }, (_, i) => `S${i + 1}`);

export default function PageClientAnalytics({ id }: Props) {
  const client = getClient(id);
  if (!client) return null;

  const data = client.weeklyHistory.map((w, i) => ({
    week: WEEKS[i],
    ig: w.followersIG,
    yt: w.followersYT,
    posts: w.postsCount,
    views: w.avgViews,
    videoRetention: w.videoRetention,
    engagement: w.engagementRate,
    ctrBioLink: w.ctrBioLink,
    dms: w.dmsSent,
    reply: w.dmsReplyRate,
    closingRate: w.closingRate,
    noShowRate: w.noShowRate,
    mrr: w.stripeMRR,
    calendly: w.calendlyCalls,
    deals: w.iClosedDeals,
  }));

  const last = client.weeklyHistory[11];
  const momentum = client.momentumScore || 0;

  return (
    <div className="page-content">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Avatar initials={client.initials} size={42} />
          <div>
            <h1 className="page-title">Analytics — {client.name}</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>{client.niche} · Semaine {client.week}</span>
              <Pill status={client.status as 'green' | 'amber' | 'red'} label={client.statusText} size="sm" />
            </div>
          </div>
        </div>
        <Link href={`/clients/${id}`} className="btn-ghost">← Fiche</Link>
      </div>

      {/* Section 1 — Audience */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-head">
          <div className="card-title">Croissance audience</div>
          <div className="card-sub">Tous réseaux · 12 semaines</div>
        </div>
        <LineChart
          data={data}
          lines={[
            { key: 'ig', label: 'Instagram', color: '#E1306C' },
            { key: 'yt', label: 'YouTube', color: '#FF0000' },
          ]}
          xKey="week"
          height={240}
          formatter={(n) => n.toLocaleString('fr-FR')}
        />
      </div>

      <div className="grid-2" style={{ marginBottom: 24 }}>
        {/* Contenu */}
        <div className="card">
          <div className="card-head">
            <div className="card-title">Contenu</div>
            <div className="card-sub">Posts & vues moyennes</div>
          </div>
          <BarChart
            data={data}
            bars={[{ key: 'posts', label: 'Posts/sem', color: 'var(--accent)' }]}
            xKey="week"
            height={160}
          />
          <div style={{ borderTop: '1px solid var(--border)', marginTop: 12, paddingTop: 12 }}>
            <LineChart
              data={data}
              lines={[{ key: 'views', label: 'Vues moyennes', color: 'var(--amber)' }]}
              xKey="week"
              height={120}
              formatter={(n) => n.toLocaleString('fr-FR')}
            />
          </div>
          <AreaChart
            data={data}
            areas={[{ key: 'engagement', label: 'Engagement %', color: 'var(--green)' }]}
            xKey="week"
            height={100}
            formatter={(n) => `${n}%`}
          />
        </div>

        {/* DM & Prospection */}
        <div className="card">
          <div className="card-head">
            <div className="card-title">DM & Prospection</div>
          </div>
          <BarChart
            data={data}
            bars={[
              { key: 'dms', label: 'DM envoyés', color: 'var(--accent)' },
              { key: 'reply', label: 'Taux réponse %', color: 'var(--green)' },
            ]}
            xKey="week"
            height={180}
          />
          <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>Corrélation DM → Calendly</div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>{last.dmsSent}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>DM envoyés</div>
              </div>
              <span style={{ alignSelf: 'center', color: 'var(--muted)', display: 'flex' }}><Icon name="arrowR" size={16} /></span>
              <div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>{last.calendlyCalls}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>Calls Calendly</div>
              </div>
              <span style={{ alignSelf: 'center', color: 'var(--muted)', display: 'flex' }}><Icon name="arrowR" size={16} /></span>
              <div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--green)', fontFamily: 'var(--font-mono)' }}>{last.iClosedDeals}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>Deals closés</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Revenus */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-head">
          <div className="card-title">Revenus Stripe</div>
          <div className="card-sub">MRR sur 12 semaines</div>
        </div>
        <AreaChart
          data={data}
          areas={[{ key: 'mrr', label: 'MRR', color: 'var(--green)' }]}
          xKey="week"
          height={200}
          formatter={(n) => `${n.toLocaleString('fr-FR')} €`}
        />
      </div>

      {/* Score momentum */}
      <div className="card">
        <div className="card-head">
          <div className="card-title">Score Momentum</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Pill
              status={momentum >= 70 ? 'green' : momentum >= 40 ? 'amber' : 'red'}
              label={momentum >= 70 ? 'Excellent' : momentum >= 40 ? 'À surveiller' : 'Critique'}
              size="sm"
            />
          </div>
        </div>
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
            <div style={{ fontSize: 48, fontWeight: 800, color: momentum >= 70 ? 'var(--green)' : momentum >= 40 ? 'var(--amber)' : 'var(--red)', fontFamily: 'var(--font-mono)', lineHeight: 1 }}>
              {momentum}
            </div>
            <div>
              <div style={{ fontSize: 13, color: 'var(--accent)', marginBottom: 4 }}>Score composite sur 100</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>Calculé sur : fréquence publication + engagement + activité DM + progression tâches</div>
            </div>
          </div>
          <div className="momentum-bar" style={{ height: 10, borderRadius: 5 }}>
            <div
              className="momentum-fill"
              style={{
                width: `${momentum}%`,
                height: '100%',
                borderRadius: 5,
                background: momentum >= 70 ? 'var(--green)' : momentum >= 40 ? 'var(--amber)' : 'var(--red)',
                transition: 'width 0.6s cubic-bezier(0.16,1,0.3,1)',
              }}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginTop: 20 }}>
            {[
              { label: 'Publication', value: Math.min(100, last.postsCount * 20), max: 'objectif 5/sem' },
              { label: 'Engagement', value: Math.min(100, last.engagementRate * 20), max: `${last.engagementRate}%` },
              { label: 'Prospection', value: Math.min(100, last.dmsReplyRate * 2.5), max: `${last.dmsReplyRate}% réponse` },
              { label: 'Tâches', value: Math.round((client.plan?.filter(t => t.done).length || 0) / Math.max(1, client.plan?.length || 1) * 100), max: `${client.plan?.filter(t => t.done).length || 0}/${client.plan?.length || 0}` },
            ].map(({ label, value, max }) => (
              <div key={label} style={{ padding: '12px', background: 'var(--surface-2)', borderRadius: 8, textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>{label}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: value >= 70 ? 'var(--green)' : value >= 40 ? 'var(--amber)' : 'var(--red)' }}>{value}</div>
                <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>{max}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
