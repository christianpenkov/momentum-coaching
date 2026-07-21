'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import Avatar from '@/components/ui/Avatar';
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
  likes30d: number;
  comments30d: number;
  shares30d: number;
  subsGained30d: number;
  subsLost30d: number;
  netSubs30d: number;
  chartData: { date: string; views: number }[];
  videos: { id: string; title: string; thumbnail: string; views: number; views30d: number; avgViewPct: number; publishedAt: string; isShort: boolean; duration: string }[];
  trafficSources: { source: string; views: number }[];
  searchKeywords: { term: string; views: number }[];
}

interface IgData {
  username: string;
  followers: number;
  mediaCount: number;
  reach30d: number;
  accountsEngaged30d: number;
  totalInteractions30d: number;
  followsUnfollows30d: number;
  profileLinksTaps30d: number;
  websiteClicks30d: number;
  profileViews30d: number;
  views30d: number;
  viewsFollowerBreakdown: { follower: number; nonFollower: number } | null;
  chartData: { date: string; reach: number }[];
  posts: { id: string; type: string; thumbnail: string; timestamp: string; permalink: string; likes: number; comments: number; reach: number; saved: number; shares: number; views: number; follows: number; profileVisits: number }[];
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

  const [showAllYt, setShowAllYt] = useState(false);
  const [showAllIg, setShowAllIg] = useState(false);

  const profileId = client?.profile_id;

  const { data: stripeResult, isLoading: stripeLoading } = useQuery({
    queryKey: ['analytics-stripe', profileId],
    queryFn: async () => {
      const r = await fetch(`/api/stripe/client-data?profileId=${profileId}`);
      if (r.status === 404) return { connected: false, data: null };
      return { connected: true, data: r.ok ? await r.json() : null };
    },
    enabled: !!profileId,
    staleTime: 5 * 60 * 1000,
  });
  const hasStripe = stripeResult?.connected ?? null;
  const stripeData: StripeData | null = stripeResult?.data ?? null;

  const { data: youtubeResult, isLoading: youtubeLoading } = useQuery({
    queryKey: ['analytics-youtube', profileId],
    queryFn: async () => {
      const r = await fetch(`/api/youtube/stats?profileId=${profileId}`);
      if (r.status === 404) return { connected: false, data: null };
      return { connected: true, data: r.ok ? await r.json() : null };
    },
    enabled: !!profileId,
    staleTime: 5 * 60 * 1000,
  });
  const hasYoutube = youtubeResult?.connected ?? null;
  const youtubeData: YoutubeData | null = youtubeResult?.data ?? null;

  const { data: igResult, isLoading: igLoading } = useQuery({
    queryKey: ['analytics-instagram', profileId],
    queryFn: async () => {
      const r = await fetch(`/api/instagram/stats?profileId=${profileId}`);
      if (r.status === 404) return { connected: false, data: null };
      const json = r.ok ? await r.json() : null;
      return { connected: true, data: json && !json.error ? json : null };
    },
    enabled: !!profileId,
    staleTime: 5 * 60 * 1000,
  });
  const hasInstagram = igResult?.connected ?? null;
  const igData: IgData | null = igResult?.data ?? null;

  const { data: leadsResult } = useQuery({
    queryKey: ['analytics-leads', profileId],
    queryFn: async () => {
      const r = await fetch(`/api/instagram/leads?profileId=${profileId}`);
      return r.ok ? r.json() : null;
    },
    enabled: !!profileId,
    staleTime: 5 * 60 * 1000,
  });
  const leadsStats: { dmCount30d: number; commentCount30d: number; total: number } | null =
    leadsResult ? { dmCount30d: leadsResult.dmCount30d, commentCount30d: leadsResult.commentCount30d, total: leadsResult.total } : null;

  const { data: shortioResult, isLoading: shortioLoading } = useQuery({
    queryKey: ['analytics-shortio', profileId],
    queryFn: async () => {
      const r = await fetch(`/api/shortio/stats?profileId=${profileId}`);
      if (r.status === 404) return { connected: false, data: null };
      return { connected: true, data: r.ok ? await r.json() : null };
    },
    enabled: !!profileId,
    staleTime: 15 * 60 * 1000,
  });
  const hasShortio = shortioResult?.connected ?? null;
  const shortioData: any | null = shortioResult?.data ?? null;

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
          <Avatar initials={client.initials || client.name.slice(0, 2).toUpperCase()} avatarUrl={client.avatar_url} size={42} />
          <div>
            <h1 className="page-title">Analytics — {client.name}</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>{client.niche} · Semaine {client.week}</span>
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
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10, marginTop: 24 }}>
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
            <KpiCard label="Vues 30j" value={youtubeData.views30d.toLocaleString('fr-FR')} sub={`Watch time : ${youtubeData.watchTime30d}h`} />
            <KpiCard label="Nouveaux abonnés 30j" value={`${youtubeData.netSubs30d >= 0 ? '+' : ''}${youtubeData.netSubs30d.toLocaleString('fr-FR')}`} color={youtubeData.netSubs30d >= 0 ? 'var(--green)' : 'var(--red)'} />
            <KpiCard label="Interactions 30j" value={(youtubeData.likes30d + youtubeData.comments30d + youtubeData.shares30d).toLocaleString('fr-FR')} sub={`${youtubeData.likes30d} likes · ${youtubeData.comments30d} coms`} />
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

          {youtubeData.videos.length > 0 && (
            <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="card-title">Vidéos</div>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>{youtubeData.videos.length} vidéos</span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="data-table">
                  <thead>
                    <tr><th style={{ width: 88 }}>Miniature</th><th>Titre</th><th>Type</th><th>Vues totales</th><th>Vues 30j</th><th>Rétention</th><th>Date</th></tr>
                  </thead>
                  <tbody>
                    {(showAllYt ? youtubeData.videos : youtubeData.videos.slice(0, 5)).map(v => (
                      <tr key={v.id}>
                        <td><img src={v.thumbnail} alt={v.title} style={{ width: 80, height: 45, objectFit: 'cover', borderRadius: 4 }} /></td>
                        <td style={{ fontSize: 12, maxWidth: 200 }}>
                          <a href={`https://youtube.com/watch?v=${v.id}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
                            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>{v.title}</div>
                          </a>
                        </td>
                        <td><span className={`pill pill-${v.isShort ? 'blue' : 'neutral'}`} style={{ fontSize: 10 }}>{v.isShort ? 'Short' : 'Vidéo'}</span></td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700 }}>{v.views.toLocaleString('fr-FR')}</td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: v.views30d > 0 ? 'var(--green)' : 'var(--muted)' }}>
                          {v.views30d > 0 ? `+${v.views30d.toLocaleString('fr-FR')}` : '—'}
                        </td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: v.avgViewPct >= 50 ? 'var(--green)' : v.avgViewPct >= 30 ? 'var(--ink)' : v.avgViewPct > 0 ? 'var(--amber)' : 'var(--muted)' }}>
                          {v.avgViewPct > 0 ? `${v.avgViewPct}%` : '—'}
                        </td>
                        <td style={{ fontSize: 11, color: 'var(--muted)' }}>
                          {new Date(v.publishedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {youtubeData.videos.length > 5 && (
                <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', textAlign: 'center' }}>
                  <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => setShowAllYt(v => !v)}>
                    {showAllYt ? `Réduire ↑` : `Voir toutes les ${youtubeData.videos.length} vidéos ↓`}
                  </button>
                </div>
              )}
            </div>
          )}

          {youtubeData.trafficSources?.length > 0 && (
            <div className="card" style={{ marginBottom: 16, padding: '16px 20px' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Sources de trafic (30j)</div>
              {youtubeData.trafficSources.slice(0, 5).map((s, i) => {
                const max = youtubeData.trafficSources[0].views;
                return (
                  <div key={i} style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                      <span style={{ color: 'var(--muted)' }}>{s.source}</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{s.views.toLocaleString('fr-FR')}</span>
                    </div>
                    <div style={{ height: 4, background: 'var(--surface-2)', borderRadius: 2 }}>
                      <div style={{ height: 4, background: '#ff0000', borderRadius: 2, width: `${(s.views / max) * 100}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {youtubeData.searchKeywords?.length > 0 && (
            <div className="card" style={{ marginBottom: 16, padding: '16px 20px' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Mots-clés recherche (30j)</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {youtubeData.searchKeywords.map((k, i) => (
                  <div key={i} style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 20, padding: '4px 12px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: 'var(--muted)' }}>{k.term}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--accent)' }}>{k.views}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Instagram ── */}
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10, marginTop: 24 }}>
        Instagram
      </div>
      {igLoading ? (
        <div className="card" style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          <Icon name="refresh-cw" size={14} /> Chargement…
        </div>
      ) : !hasInstagram || !igData ? (
        <div className="card" style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          Instagram non connecté par le client.
        </div>
      ) : (
        <>
          <div className="grid-4" style={{ marginBottom: 16 }}>
            <KpiCard label="Abonnés" value={igData.followers.toLocaleString('fr-FR')} sub={`@${igData.username}`} color="#E1306C" />
            <KpiCard label="Reach 30j" value={igData.reach30d.toLocaleString('fr-FR')} sub="Comptes uniques atteints" />
            <KpiCard label="Nouveaux abonnés 30j" value={`${igData.followsUnfollows30d >= 0 ? '+' : ''}${igData.followsUnfollows30d.toLocaleString('fr-FR')}`} color={igData.followsUnfollows30d >= 0 ? 'var(--green)' : 'var(--red)'} />
            <KpiCard label="Interactions 30j" value={igData.totalInteractions30d.toLocaleString('fr-FR')} sub={`${igData.accountsEngaged30d.toLocaleString('fr-FR')} comptes engagés`} />
            {igData.websiteClicks30d > 0 && <KpiCard label="Clics lien bio" value={igData.websiteClicks30d.toLocaleString('fr-FR')} />}
            {igData.profileViews30d > 0 && <KpiCard label="Vues de profil 30j" value={igData.profileViews30d.toLocaleString('fr-FR')} />}
            {igData.views30d > 0 && <KpiCard label="Vues 30j" value={igData.views30d.toLocaleString('fr-FR')} />}
            {igData.viewsFollowerBreakdown && (() => {
              const bd = igData.viewsFollowerBreakdown!;
              const total = bd.follower + bd.nonFollower;
              const viralPct = total > 0 ? Math.round((bd.nonFollower / total) * 100) : 0;
              return <KpiCard label="Part non-abonnés" value={`${viralPct}%`} sub="des vues (viralité)" color={viralPct > 50 ? 'var(--green)' : undefined} />;
            })()}
          </div>

          {igData.chartData?.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-head">
                <div className="card-title">Reach par jour</div>
                <div className="card-sub">30 derniers jours</div>
              </div>
              <AreaChart
                data={igData.chartData}
                areas={[{ key: 'reach', label: 'Reach', color: '#E1306C' }]}
                xKey="date"
                height={180}
                formatter={(n) => n.toLocaleString('fr-FR')}
              />
            </div>
          )}

          {igData.posts?.length > 0 && (
            <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="card-title">Posts récents</div>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>{igData.posts.length} posts</span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="data-table">
                  <thead>
                    <tr><th style={{ width: 70 }}>Miniature</th><th>Type</th><th>Reach</th><th>Likes</th><th>Commentaires</th><th>Partages</th><th>Date</th></tr>
                  </thead>
                  <tbody>
                    {(showAllIg ? igData.posts : igData.posts.slice(0, 5)).map((p: any) => (
                      <tr key={p.id}>
                        <td>
                          {p.thumbnail ? (
                            <a href={p.permalink} target="_blank" rel="noopener noreferrer">
                              <img src={p.thumbnail} alt="" style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 6 }} />
                            </a>
                          ) : <div style={{ width: 60, height: 60, background: 'var(--surface-2)', borderRadius: 6 }} />}
                        </td>
                        <td><span className="pill pill-neutral" style={{ fontSize: 10 }}>{p.type === 'VIDEO' ? 'Reel' : p.type === 'CAROUSEL_ALBUM' ? 'Carrousel' : 'Photo'}</span></td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700 }}>{p.reach.toLocaleString('fr-FR')}</td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{p.likes.toLocaleString('fr-FR')}</td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{p.comments.toLocaleString('fr-FR')}</td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{p.shares.toLocaleString('fr-FR')}</td>
                        <td style={{ fontSize: 11, color: 'var(--muted)' }}>{new Date(p.timestamp).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {igData.posts.length > 5 && (
                <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', textAlign: 'center' }}>
                  <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => setShowAllIg(v => !v)}>
                    {showAllIg ? `Réduire ↑` : `Voir tous les ${igData.posts.length} posts ↓`}
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Short.io ── */}
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10, marginTop: 24 }}>
        Short.io — Tracking liens
      </div>
      {shortioLoading ? (
        <div className="card" style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          <Icon name="refresh-cw" size={14} /> Chargement…
        </div>
      ) : !hasShortio || !shortioData ? (
        <div className="card" style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          Short.io non connecté par le client.
        </div>
      ) : (
        <>
          <div className="grid-4" style={{ marginBottom: 16 }}>
            <KpiCard label="Clics 30j" value={(shortioData.clicks30d ?? 0).toLocaleString('fr-FR')} sub="Tous liens" />
            <KpiCard label="Clics humains 30j" value={(shortioData.humanClicks30d ?? 0).toLocaleString('fr-FR')} sub="Sans bots" />
            <KpiCard label="Moy. par lien" value={(shortioData.clicksPerLink30d ?? 0) > 0 ? Number(shortioData.clicksPerLink30d).toFixed(1) : '—'} sub="Clics / lien actif" />
            <KpiCard label="Liens actifs" value={(shortioData.totalLinks ?? 0).toLocaleString('fr-FR')} sub={shortioData.domain ?? ''} />
          </div>

          {shortioData.chartData?.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-head">
                <div className="card-title">Clics par jour</div>
                <div className="card-sub">30 derniers jours</div>
              </div>
              <AreaChart
                data={shortioData.chartData}
                areas={[{ key: 'clicks', label: 'Clics', color: 'var(--accent)' }]}
                xKey="date"
                height={160}
                formatter={(n) => n.toLocaleString('fr-FR')}
              />
            </div>
          )}

          {shortioData.links?.length > 0 && (
            <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="card-title">Top liens</div>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>{shortioData.links.length} liens</span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="data-table">
                  <thead>
                    <tr><th>Lien</th><th>Destination</th><th>Clics 30j</th><th>Humains</th><th>Top pays</th></tr>
                  </thead>
                  <tbody>
                    {shortioData.links.map((l: any) => (
                      <tr key={l.id}>
                        <td>
                          <a href={l.shortUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>/{l.path}</a>
                          {l.title && l.title !== l.path && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{l.title}</div>}
                        </td>
                        <td style={{ fontSize: 11, color: 'var(--muted)', maxWidth: 180 }}>
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>{l.originalUrl}</div>
                        </td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700 }}>{l.clicks30d.toLocaleString('fr-FR')}</td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)' }}>{l.humanClicks30d.toLocaleString('fr-FR')}</td>
                        <td style={{ fontSize: 11, color: 'var(--muted)' }}>{l.countries?.[0]?.label || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Leads Instagram ── */}
      {leadsStats && (leadsStats.dmCount30d > 0 || leadsStats.commentCount30d > 0) && (
        <>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10, marginTop: 24 }}>
            Leads détectés (30j)
          </div>
          <div className="grid-4" style={{ marginBottom: 24 }}>
            <KpiCard label="Leads DM" value={leadsStats.dmCount30d.toLocaleString('fr-FR')} sub="Mots-clés en DM" color={leadsStats.dmCount30d > 0 ? 'var(--green)' : undefined} />
            <KpiCard label="Leads commentaires" value={leadsStats.commentCount30d.toLocaleString('fr-FR')} sub="Mots-clés en commentaire" color={leadsStats.commentCount30d > 0 ? 'var(--green)' : undefined} />
            <KpiCard label="Total leads" value={leadsStats.total.toLocaleString('fr-FR')} sub="Tous canaux" />
          </div>
        </>
      )}
    </div>
  );
}
