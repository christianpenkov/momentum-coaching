'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import Avatar from '@/components/ui/Avatar';
import Pill from '@/components/ui/Pill';
import Icon from '@/components/ui/Icon';
import { useSupabaseClients } from '@/lib/SupabaseClientsContext';

const LineChart = dynamic(() => import('@/components/charts/LineChart'), { ssr: false });
const AreaChart = dynamic(() => import('@/components/charts/AreaChart'), { ssr: false });
const BarChart = dynamic(() => import('@/components/charts/BarChart'), { ssr: false });

interface Props { id: string }

interface StripeData {
  mrr: number;
  monthlyRevenue: number;
  activeSubscriptions: number;
  availableBalance: number;
  recentPayments: { id: string; amount: number; currency: string; description: string; date: string; status: string }[];
}

interface YoutubeData {
  channelName: string;
  subscribers: number;
  totalViews: number;
  videoCount: number;
  views30d: number;
  watchTime30d: number;
  subsGained30d: number;
  netSubs30d: number;
  chartData: { date: string; views: number }[];
  retentionCurve: { ratio: number; watchRatio: number }[];
  videos: { id: string; title: string; thumbnail: string; views: number; ctr: number; avgViewPct: number; publishedAt: string }[];
}

function KpiCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="card" style={{ padding: '16px 20px' }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4, fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: color || 'var(--accent)', fontFamily: 'var(--font-mono)' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

export default function PageClientAnalytics({ id }: Props) {
  const { getClient } = useSupabaseClients();
  const client = getClient(id);

  const [stripeData, setStripeData] = useState<StripeData | null>(null);
  const [stripeLoading, setStripeLoading] = useState(true);
  const [hasStripe, setHasStripe] = useState<boolean | null>(null);

  const [youtubeData, setYoutubeData] = useState<YoutubeData | null>(null);
  const [youtubeLoading, setYoutubeLoading] = useState(true);
  const [hasYoutube, setHasYoutube] = useState<boolean | null>(null);

  const profileId = client?.profile_id;

  useEffect(() => {
    if (!profileId) return;

    // Stripe
    fetch(`/api/stripe/client-data?profileId=${profileId}`)
      .then(r => {
        if (r.status === 404) { setHasStripe(false); return null; }
        setHasStripe(true);
        return r.ok ? r.json() : null;
      })
      .then(data => { if (data) setStripeData(data); })
      .finally(() => setStripeLoading(false));

    // YouTube
    fetch(`/api/youtube/stats?profileId=${profileId}`)
      .then(r => {
        if (r.status === 404) { setHasYoutube(false); return null; }
        setHasYoutube(true);
        return r.ok ? r.json() : null;
      })
      .then(data => { if (data) setYoutubeData(data); })
      .finally(() => setYoutubeLoading(false));
  }, [profileId]);

  if (!client) return (
    <div className="page-content">
      <div className="page-header"><h1 className="page-title">Client introuvable</h1></div>
    </div>
  );

  // Métriques hebdomadaires Supabase
  const metrics = client.weeklyMetrics || [];
  const last = client.latestMetrics;
  const prev = client.prevMetrics;
  const weekLabels = metrics.map(m => `S${m.week}`);

  const igDelta = last && prev ? last.followers_ig - prev.followers_ig : 0;

  return (
    <div className="page-content">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Avatar initials={client.initials || client.name.slice(0, 2).toUpperCase()} size={42} />
          <div>
            <h1 className="page-title">Analytics — {client.name}</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>{client.niche} · Semaine {client.week}</span>
              <Pill status={client.status as 'green' | 'amber' | 'red'} label={client.status_text || ''} size="sm" />
            </div>
          </div>
        </div>
        <Link href={`/clients/${id}`} className="btn-ghost">← Fiche</Link>
      </div>

      {/* ── Métriques hebdo Supabase ── */}
      {metrics.length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
            Progression hebdomadaire
          </div>
          <div className="grid-4" style={{ marginBottom: 20 }}>
            {last && (
              <>
                <KpiCard label="Followers IG" value={last.followers_ig.toLocaleString('fr-FR')} sub={igDelta !== 0 ? `${igDelta > 0 ? '+' : ''}${igDelta} cette semaine` : undefined} color="#E1306C" />
                <KpiCard label="Posts publiés" value={String(last.posts_count)} sub={`${last.avg_views.toLocaleString('fr-FR')} vues moy.`} />
                <KpiCard label="DM envoyés" value={String(last.dms_sent)} sub={`${last.dms_reply_rate}% réponse`} />
                <KpiCard label="MRR Supabase" value={`${last.stripe_mrr.toLocaleString('fr-FR')} €`} color="var(--green)" />
              </>
            )}
          </div>

          {metrics.length >= 2 && (
            <div className="card" style={{ marginBottom: 24 }}>
              <div className="card-head">
                <div className="card-title">Croissance audience</div>
                <div className="card-sub">{metrics.length} semaines</div>
              </div>
              <LineChart
                data={metrics.map(m => ({ week: `S${m.week}`, ig: m.followers_ig, yt: m.followers_yt }))}
                lines={[
                  { key: 'ig', label: 'Instagram', color: '#E1306C' },
                  { key: 'yt', label: 'YouTube', color: '#FF0000' },
                ]}
                xKey="week"
                height={220}
                formatter={(n) => n.toLocaleString('fr-FR')}
              />
            </div>
          )}
        </>
      )}

      {/* ── Stripe ── */}
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
        Revenus Stripe
      </div>
      {stripeLoading ? (
        <div className="card" style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--muted)', fontSize: 13, marginBottom: 24 }}>
          <Icon name="refresh-cw" size={14} /> Chargement…
        </div>
      ) : !hasStripe || !stripeData ? (
        <div className="card" style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)', fontSize: 13, marginBottom: 24 }}>
          Stripe non connecté par le client.
        </div>
      ) : (
        <div style={{ marginBottom: 24 }}>
          <div className="grid-4" style={{ marginBottom: 16 }}>
            <KpiCard label="MRR" value={`${stripeData.mrr.toLocaleString('fr-FR')} €`} color="var(--green)" />
            <KpiCard label="Ce mois" value={`${stripeData.monthlyRevenue.toLocaleString('fr-FR')} €`} />
            <KpiCard label="Abonnements actifs" value={String(stripeData.activeSubscriptions)} />
            <KpiCard label="Solde disponible" value={`${stripeData.availableBalance.toLocaleString('fr-FR')} €`} />
          </div>
          {stripeData.recentPayments.length > 0 && (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
                <div className="card-title">Derniers paiements</div>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="data-table">
                  <thead>
                    <tr><th>Description</th><th>Montant</th><th>Date</th><th>Statut</th></tr>
                  </thead>
                  <tbody>
                    {stripeData.recentPayments.map(p => (
                      <tr key={p.id}>
                        <td style={{ fontSize: 13 }}>{p.description}</td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700 }}>
                          {p.amount.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} {p.currency.toUpperCase()}
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--muted)' }}>
                          {new Date(p.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </td>
                        <td>
                          <span className={`pill pill-${p.status === 'succeeded' ? 'green' : 'amber'}`} style={{ fontSize: 11 }}>
                            {p.status === 'succeeded' ? 'Réussi' : p.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── YouTube ── */}
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
        YouTube
      </div>
      {youtubeLoading ? (
        <div className="card" style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          <Icon name="refresh-cw" size={14} /> Chargement…
        </div>
      ) : !hasYoutube || !youtubeData ? (
        <div className="card" style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          YouTube non connecté par le client.
        </div>
      ) : (
        <>
          <div className="grid-4" style={{ marginBottom: 16 }}>
            <KpiCard label="Abonnés" value={youtubeData.subscribers.toLocaleString('fr-FR')} sub={youtubeData.channelName} />
            <KpiCard label="Vues totales" value={youtubeData.totalViews.toLocaleString('fr-FR')} />
            <KpiCard label="Vues 30j" value={youtubeData.views30d.toLocaleString('fr-FR')} />
            <KpiCard label="Watch time 30j" value={`${youtubeData.watchTime30d}h`} />
          </div>

          {youtubeData.chartData.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-head">
                <div className="card-title">Vues par jour</div>
                <div className="card-sub">30 derniers jours</div>
              </div>
              <AreaChart
                data={youtubeData.chartData}
                areas={[{ key: 'views', label: 'Vues', color: '#ff0000' }]}
                xKey="date"
                height={180}
                formatter={(n) => n.toLocaleString('fr-FR')}
              />
            </div>
          )}

          {youtubeData.retentionCurve?.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-head">
                <div className="card-title">Rétention audience</div>
                <div className="card-sub">% spectateurs encore présents</div>
              </div>
              <AreaChart
                data={youtubeData.retentionCurve}
                areas={[{ key: 'watchRatio', label: 'Rétention', color: '#ff0000' }]}
                xKey="ratio"
                height={160}
                formatter={(n) => `${n}%`}
              />
            </div>
          )}

          {youtubeData.videos.length > 0 && (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="card-title">Dernières vidéos</div>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>{youtubeData.videos.length} vidéos</span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="data-table">
                  <thead>
                    <tr><th style={{ width: 88 }}>Miniature</th><th>Titre</th><th>Vues</th><th>CTR</th><th>Rétention</th><th>Date</th></tr>
                  </thead>
                  <tbody>
                    {youtubeData.videos.map(v => (
                      <tr key={v.id}>
                        <td><img src={v.thumbnail} alt={v.title} style={{ width: 80, height: 45, objectFit: 'cover', borderRadius: 4 }} /></td>
                        <td style={{ fontSize: 12, maxWidth: 220 }}>
                          <a href={`https://youtube.com/watch?v=${v.id}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
                            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>{v.title}</div>
                          </a>
                        </td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700 }}>{v.views.toLocaleString('fr-FR')}</td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: v.ctr >= 5 ? 'var(--green)' : v.ctr >= 2 ? 'var(--ink)' : v.ctr > 0 ? 'var(--amber)' : 'var(--muted)' }}>
                          {v.ctr > 0 ? `${v.ctr}%` : '—'}
                        </td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: v.avgViewPct >= 50 ? 'var(--green)' : v.avgViewPct >= 30 ? 'var(--ink)' : v.avgViewPct > 0 ? 'var(--amber)' : 'var(--muted)' }}>
                          {v.avgViewPct > 0 ? `${v.avgViewPct}%` : '—'}
                        </td>
                        <td style={{ fontSize: 11, color: 'var(--muted)' }}>
                          {new Date(v.publishedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
