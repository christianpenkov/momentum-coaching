'use client';

import dynamic from 'next/dynamic';
import Pill from '@/components/ui/Pill';
import Icon from '@/components/ui/Icon';
import { getClient } from '@/lib/data';

const LineChart = dynamic(() => import('@/components/charts/LineChart'), { ssr: false });
const BarChart = dynamic(() => import('@/components/charts/BarChart'), { ssr: false });
const AreaChart = dynamic(() => import('@/components/charts/AreaChart'), { ssr: false });

const THOMAS_ID = 'thomas';
const WEEKS = Array.from({ length: 12 }, (_, i) => `S${i + 1}`);

export default function PageClientStats() {
  const client = getClient(THOMAS_ID) || getClient('thomas');
  if (!client) return null;

  const data = client.weeklyHistory.map((w, i) => ({
    week: WEEKS[i],
    ig: w.followersIG,
    tiktok: w.followersTikTok,
    yt: w.followersYT,
    linkedin: w.followersLinkedIn,
    posts: w.postsCount,
    views: w.avgViews,
    engagement: w.engagementRate,
    dms: w.dmsSent,
    reply: w.dmsReplyRate,
    mrr: w.stripeMRR,
    calendly: w.calendlyCalls,
  }));

  const last = client.weeklyHistory[11];
  const prev = client.weeklyHistory[10];
  const momentum = client.momentumScore || 0;

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1 className="page-title">Mes stats</h1>
          <p className="page-sub">Semaine {client.week} · vue complète de vos données</p>
        </div>
        <Pill
          status={momentum >= 70 ? 'green' : momentum >= 40 ? 'amber' : 'red'}
          label={`Momentum ${momentum}/100`}
        />
      </div>

      {/* KPIs */}
      <div className="grid-4" style={{ marginBottom: 24 }}>
        {[
          { label: 'Followers IG', value: last.followersIG.toLocaleString('fr-FR'), delta: `+${last.followersIG - prev.followersIG}`, positive: true },
          { label: 'Vues moyennes', value: last.avgViews.toLocaleString('fr-FR'), delta: `${last.engagementRate}% engagement`, positive: last.engagementRate > 3 },
          { label: 'DM envoyés', value: last.dmsSent.toString(), delta: `${last.dmsReplyRate}% réponse`, positive: last.dmsReplyRate > 15 },
          { label: 'MRR', value: `${last.stripeMRR.toLocaleString('fr-FR')} €`, delta: `+${last.stripeMRR - prev.stripeMRR} € vs sem. préc.`, positive: last.stripeMRR > prev.stripeMRR },
        ].map(({ label, value, delta, positive }) => (
          <div key={label} className="card" style={{ padding: '16px 20px' }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>{value}</div>
            <div style={{ fontSize: 11, marginTop: 4, color: positive ? 'var(--green)' : 'var(--red)' }}>{delta}</div>
          </div>
        ))}
      </div>

      {/* Audience */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-head">
          <div className="card-title">Croissance audience</div>
          <div className="card-sub">Tous réseaux · 12 semaines</div>
        </div>
        <LineChart
          data={data}
          lines={[
            { key: 'ig', label: 'Instagram', color: '#E1306C' },
            { key: 'tiktok', label: 'TikTok', color: '#2d2d2d' },
            { key: 'yt', label: 'YouTube', color: '#FF0000' },
            { key: 'linkedin', label: 'LinkedIn', color: '#0A66C2' },
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
            <div className="card-title">Contenu & Engagement</div>
          </div>
          <BarChart
            data={data}
            bars={[{ key: 'posts', label: 'Posts/sem', color: 'var(--accent)' }]}
            xKey="week"
            height={140}
          />
          <AreaChart
            data={data}
            areas={[{ key: 'engagement', label: 'Engagement %', color: 'var(--green)' }]}
            xKey="week"
            height={100}
            formatter={(n) => `${n}%`}
          />
        </div>

        {/* DM & Funnel */}
        <div className="card">
          <div className="card-head">
            <div className="card-title">Prospection & Funnel</div>
          </div>
          <BarChart
            data={data}
            bars={[
              { key: 'dms', label: 'DM envoyés', color: 'var(--accent)' },
              { key: 'reply', label: 'Réponse %', color: 'var(--amber)' },
            ]}
            xKey="week"
            height={150}
          />
          <div style={{ marginTop: 16, display: 'flex', gap: 12, padding: '12px', background: 'var(--surface-2)', borderRadius: 8 }}>
            <div style={{ textAlign: 'center', flex: 1 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>{last.dmsSent}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>DM</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', color: 'var(--muted)' }}><Icon name="arrowR" size={16} /></div>
            <div style={{ textAlign: 'center', flex: 1 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>{last.calendlyCalls}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>Calls</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', color: 'var(--muted)' }}><Icon name="arrowR" size={16} /></div>
            <div style={{ textAlign: 'center', flex: 1 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--green)', fontFamily: 'var(--font-mono)' }}>{last.iClosedDeals}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>Deals</div>
            </div>
          </div>
        </div>
      </div>

      {/* MRR */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-head">
          <div className="card-title">Revenus Stripe</div>
          <div className="card-sub">MRR mensuel récurrent sur 12 semaines</div>
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
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="zap" size={16} /> Score Momentum
          </div>
          <Pill status={momentum >= 70 ? 'green' : momentum >= 40 ? 'amber' : 'red'} label={momentum >= 70 ? 'Excellent' : momentum >= 40 ? 'Bon' : 'À améliorer'} size="sm" />
        </div>
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 42, fontWeight: 800, color: momentum >= 70 ? 'var(--green)' : momentum >= 40 ? 'var(--amber)' : 'var(--red)', fontFamily: 'var(--font-mono)' }}>
            {momentum}<span style={{ fontSize: 20, fontWeight: 400 }}>/100</span>
          </div>
          <div className="momentum-bar" style={{ height: 10, borderRadius: 5, marginTop: 12, marginBottom: 20 }}>
            <div style={{ height: '100%', width: `${momentum}%`, borderRadius: 5, background: momentum >= 70 ? 'var(--green)' : momentum >= 40 ? 'var(--amber)' : 'var(--red)', transition: 'width 0.6s cubic-bezier(0.16,1,0.3,1)' }} />
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
            Calculé sur votre fréquence de publication ({last.postsCount} posts/sem), engagement ({last.engagementRate}%), activité DM ({last.dmsSent} DM), et progression des tâches.
          </div>
        </div>
      </div>
    </div>
  );
}
