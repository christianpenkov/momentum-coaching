'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import Icon from '@/components/ui/Icon';
import { createClient } from '@/lib/supabase/client';

const AreaChart = dynamic(() => import('@/components/charts/AreaChart'), { ssr: false });

interface StripeData {
  mrr: number;
  monthlyRevenue: number;
  activeSubscriptions: number;
  availableBalance: number;
  recentPayments: {
    id: string;
    amount: number;
    currency: string;
    description: string;
    date: string;
    status: string;
  }[];
}

interface YoutubeVideo {
  id: string;
  title: string;
  thumbnail: string;
  publishedAt: string;
  duration: string;
  views: number;
  likes: number;
  comments: number;
  views30d: number;
  url: string;
}

interface YoutubeData {
  channelName: string;
  channelThumbnail: string;
  subscribers: number;
  totalViews: number;
  videoCount: number;
  views30d: number;
  watchTime30d: number;
  subsGained30d: number;
  subsLost30d: number;
  netSubs30d: number;
  chartData: { date: string; views: number }[];
  videos: YoutubeVideo[];
}

function KpiCard({ label, value, sub, positive }: { label: string; value: string; sub?: string; positive?: boolean }) {
  return (
    <div className="card" style={{ padding: '18px 20px' }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4, fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>{value}</div>
      {sub && (
        <div style={{ fontSize: 11, marginTop: 4, color: positive === false ? 'var(--red)' : positive ? 'var(--green)' : 'var(--muted)' }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function SectionHeader({ icon, title, sub, right }: { icon: string; title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name={icon as any} size={18} />
        <div>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>{title}</span>
          {sub && <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 8 }}>{sub}</span>}
        </div>
      </div>
      {right}
    </div>
  );
}

export default function PageClientStats() {
  const [stripeData, setStripeData] = useState<StripeData | null>(null);
  const [stripeError, setStripeError] = useState<string | null>(null);
  const [stripeLoading, setStripeLoading] = useState(true);
  const [hasStripeKey, setHasStripeKey] = useState<boolean | null>(null);
  const [youtubeData, setYoutubeData] = useState<YoutubeData | null>(null);
  const [hasYoutube, setHasYoutube] = useState<boolean | null>(null);
  const [youtubeLoading, setYoutubeLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: integs } = await supabase
        .from('integrations')
        .select('provider')
        .eq('profile_id', user.id)
        .in('provider', ['stripe', 'youtube']);

      const hasStripe = integs?.some(i => i.provider === 'stripe') ?? false;
      const hasYT = integs?.some(i => i.provider === 'youtube') ?? false;

      setHasStripeKey(hasStripe);
      setHasYoutube(hasYT);

      if (hasStripe) {
        try {
          const res = await fetch('/api/stripe/client-data');
          if (res.ok) setStripeData(await res.json());
          else {
            const err = await res.json().catch(() => ({}));
            setStripeError(err.error || 'Erreur Stripe');
          }
        } catch { setStripeError('Impossible de contacter Stripe'); }
      }
      setStripeLoading(false);

      if (hasYT) {
        try {
          const res = await fetch('/api/youtube/stats');
          if (res.ok) setYoutubeData(await res.json());
        } catch {}
      }
      setYoutubeLoading(false);
    }
    load();
  }, []);

  const stripeChartData = stripeData?.recentPayments
    ? Object.entries(
        stripeData.recentPayments.reduce((acc, p) => {
          const month = new Date(p.date).toLocaleDateString('fr-FR', { month: 'short' });
          acc[month] = (acc[month] || 0) + p.amount;
          return acc;
        }, {} as Record<string, number>)
      )
        .slice(-6)
        .map(([month, amount]) => ({ month, amount }))
    : [];

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1 className="page-title">Mes stats</h1>
          <p className="page-sub">Données en temps réel depuis tes intégrations</p>
        </div>
      </div>

      {/* ── Stripe ── */}
      <div style={{ marginBottom: 32 }}>
        <SectionHeader
          icon="stripe"
          title="Revenus Stripe"
          right={stripeData ? (
            <span style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
              <Icon name="refresh-cw" size={11} /> Mis à jour à l'instant
            </span>
          ) : undefined}
        />

        {stripeLoading ? (
          <div className="card" style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
            <Icon name="refresh-cw" size={16} /> Chargement des données Stripe…
          </div>
        ) : !hasStripeKey ? (
          <div className="card" style={{ padding: '32px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 28, marginBottom: 10 }}>💳</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)', marginBottom: 6 }}>Stripe non connecté</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16, lineHeight: 1.6 }}>
              Ajoute ta clé Stripe dans Réglages pour voir ton MRR, tes paiements et tes abonnements en temps réel.
            </div>
            <a href="/client/settings" className="btn-primary" style={{ fontSize: 13, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Icon name="link" size={13} /> Connecter Stripe
            </a>
          </div>
        ) : stripeError ? (
          <div className="card" style={{ padding: '24px', background: '#fef2f2', border: '1px solid #fca5a5' }}>
            <div style={{ fontSize: 13, color: '#dc2626', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="shield" size={14} />
              <div>
                <div style={{ fontWeight: 600 }}>Erreur Stripe</div>
                <div style={{ fontSize: 12, marginTop: 2 }}>{stripeError}</div>
                <a href="/client/settings" style={{ fontSize: 12, color: '#dc2626', marginTop: 6, display: 'inline-block' }}>
                  Vérifier la clé dans Réglages →
                </a>
              </div>
            </div>
          </div>
        ) : stripeData ? (
          <>
            <div className="grid-4" style={{ marginBottom: 20 }}>
              <KpiCard label="MRR" value={`${stripeData.mrr.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} €`} sub="Revenus mensuels récurrents" />
              <KpiCard label="Ce mois" value={`${stripeData.monthlyRevenue.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} €`} sub="Encaissé ce mois" positive={stripeData.monthlyRevenue > 0} />
              <KpiCard label="Abonnements actifs" value={String(stripeData.activeSubscriptions)} sub={stripeData.activeSubscriptions === 0 ? 'Aucun abonnement actif' : 'Clients actifs'} positive={stripeData.activeSubscriptions > 0} />
              <KpiCard label="Solde disponible" value={`${stripeData.availableBalance.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} €`} sub="Prêt à virer" positive={stripeData.availableBalance > 0} />
            </div>
            {stripeChartData.length > 0 && (
              <div className="card" style={{ marginBottom: 20 }}>
                <div className="card-head">
                  <div className="card-title">Revenus par mois</div>
                  <div className="card-sub">Basé sur tes paiements récents</div>
                </div>
                <AreaChart data={stripeChartData} areas={[{ key: 'amount', label: 'Revenus', color: 'var(--green)' }]} xKey="month" height={180} formatter={(n) => `${n.toLocaleString('fr-FR')} €`} />
              </div>
            )}
            {stripeData.recentPayments.length > 0 && (
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
                  <div className="card-title">Derniers paiements</div>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Description</th><th>Montant</th><th>Date</th><th>Statut</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stripeData.recentPayments.map(p => (
                        <tr key={p.id}>
                          <td style={{ fontSize: 13, color: 'var(--accent)' }}>{p.description}</td>
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
          </>
        ) : null}
      </div>

      {/* ── YouTube ── */}
      <div style={{ marginBottom: 32 }}>
        <SectionHeader icon="youtube" title="YouTube" sub={youtubeData ? youtubeData.channelName : undefined} />

        {youtubeLoading ? (
          <div className="card" style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
            <Icon name="refresh-cw" size={16} /> Chargement…
          </div>
        ) : !hasYoutube ? (
          <div className="card" style={{ padding: '32px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 28, marginBottom: 10 }}>▶️</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)', marginBottom: 6 }}>YouTube non connecté</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16, lineHeight: 1.6 }}>
              Connecte ta chaîne YouTube pour voir tes abonnés, vues et watch time en temps réel.
            </div>
            <a href="/client/settings" className="btn-primary" style={{ fontSize: 13, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Icon name="link" size={13} /> Connecter YouTube
            </a>
          </div>
        ) : youtubeData ? (
          <>
            {/* KPIs globaux chaîne */}
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
              Chaîne (tout temps)
            </div>
            <div className="grid-4" style={{ marginBottom: 20 }}>
              <KpiCard label="Abonnés" value={youtubeData.subscribers.toLocaleString('fr-FR')} sub={youtubeData.channelName} />
              <KpiCard label="Vues totales" value={youtubeData.totalViews.toLocaleString('fr-FR')} sub="Depuis le début" />
              <KpiCard label="Vidéos publiées" value={youtubeData.videoCount.toLocaleString('fr-FR')} sub="Sur la chaîne" />
            </div>

            {/* KPIs 30 jours */}
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
              30 derniers jours
            </div>
            <div className="grid-4" style={{ marginBottom: 20 }}>
              <KpiCard label="Vues" value={youtubeData.views30d.toLocaleString('fr-FR')} positive={youtubeData.views30d > 0} />
              <KpiCard label="Watch time" value={`${youtubeData.watchTime30d}h`} sub="Heures regardées" positive={youtubeData.watchTime30d > 0} />
              <KpiCard label="Abonnés gagnés" value={`+${youtubeData.subsGained30d.toLocaleString('fr-FR')}`} positive={youtubeData.subsGained30d > 0} />
              <KpiCard
                label="Abonnés nets"
                value={youtubeData.netSubs30d >= 0 ? `+${youtubeData.netSubs30d}` : String(youtubeData.netSubs30d)}
                sub={youtubeData.subsLost30d > 0 ? `${youtubeData.subsLost30d} perdus` : undefined}
                positive={youtubeData.netSubs30d > 0}
              />
            </div>

            {/* Graphique vues par jour */}
            {youtubeData.chartData.length > 0 && (
              <div className="card" style={{ marginBottom: 20 }}>
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

            {/* Vidéos récentes */}
            {youtubeData.videos.length > 0 && (
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div className="card-title">Dernières vidéos</div>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>{youtubeData.videos.length} vidéos</span>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th style={{ width: 100 }}>Miniature</th>
                        <th>Titre</th>
                        <th>Durée</th>
                        <th>Vues totales</th>
                        <th>Vues 30j</th>
                        <th>Likes</th>
                        <th>Commentaires</th>
                        <th>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {youtubeData.videos.map(v => (
                        <tr key={v.id}>
                          <td>
                            <a href={v.url} target="_blank" rel="noopener noreferrer">
                              <img
                                src={v.thumbnail}
                                alt={v.title}
                                style={{ width: 80, height: 45, objectFit: 'cover', borderRadius: 4, display: 'block' }}
                              />
                            </a>
                          </td>
                          <td style={{ fontSize: 12, color: 'var(--accent)', maxWidth: 240 }}>
                            <a href={v.url} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>
                              <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 240 }}>{v.title}</div>
                            </a>
                          </td>
                          <td style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>{v.duration}</td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700 }}>{v.views.toLocaleString('fr-FR')}</td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: v.views30d > 0 ? 'var(--green)' : 'var(--muted)' }}>
                            {v.views30d > 0 ? `+${v.views30d.toLocaleString('fr-FR')}` : '—'}
                          </td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{v.likes.toLocaleString('fr-FR')}</td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{v.comments.toLocaleString('fr-FR')}</td>
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
        ) : (
          <div className="card" style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
            Impossible de charger les stats YouTube. <a href="/client/settings" style={{ color: 'var(--accent)' }}>Reconnecter</a>
          </div>
        )}
      </div>
    </div>
  );
}
