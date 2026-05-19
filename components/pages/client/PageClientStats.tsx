'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
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
  isShort: boolean;
  views: number;
  likes: number;
  comments: number;
  views30d: number;
  watchTime30d: number;
  avgViewPct: number;
  likes30d: number;
  comments30d: number;
  shares30d: number;
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
  likes30d: number;
  comments30d: number;
  shares30d: number;
  subsGained30d: number;
  subsLost30d: number;
  netSubs30d: number;
  chartData: { date: string; views: number }[];
  videos: YoutubeVideo[];
  retentionCurve: { ratio: number; watchRatio: number }[];
  trafficSources: { source: string; views: number; watchMinutes: number }[];
  devices: { device: string; views: number; watchMinutes: number }[];
  demographics: { ageGroup: string; gender: string; viewerPct: number }[];
  searchKeywords: { term: string; views: number }[];
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

interface VideoModalProps {
  video: YoutubeVideo;
  onClose: () => void;
}

function VideoModal({ video, onClose }: VideoModalProps) {
  const [retentionCurve, setRetentionCurve] = useState<{ ratio: number; watchRatio: number }[]>([]);
  const [retentionLoading, setRetentionLoading] = useState(true);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`/api/youtube/video-retention?videoId=${video.id}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.retentionCurve) setRetentionCurve(data.retentionCurve);
        setRetentionLoading(false);
      })
      .catch(() => setRetentionLoading(false));
  }, [video.id]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const stats = [
    { label: 'Vues totales', value: video.views.toLocaleString('fr-FR') },
    { label: 'Vues 30j', value: video.views30d > 0 ? `+${video.views30d.toLocaleString('fr-FR')}` : '—' },
    { label: 'Rétention moy.', value: video.avgViewPct > 0 ? `${video.avgViewPct}%` : '—' },
    { label: 'Watch time 30j', value: video.watchTime30d > 0 ? `${video.watchTime30d}h` : '—' },
    { label: 'Likes (total)', value: video.likes.toLocaleString('fr-FR') },
    { label: 'Likes 30j', value: video.likes30d > 0 ? `+${video.likes30d.toLocaleString('fr-FR')}` : '—' },
    { label: 'Commentaires (total)', value: video.comments.toLocaleString('fr-FR') },
    { label: 'Commentaires 30j', value: video.comments30d > 0 ? `+${video.comments30d.toLocaleString('fr-FR')}` : '—' },
    { label: 'Partages 30j', value: video.shares30d > 0 ? `+${video.shares30d.toLocaleString('fr-FR')}` : '—' },
    { label: 'Durée', value: video.duration },
    { label: 'Publiée le', value: new Date(video.publishedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) },
  ];

  return (
    <div
      ref={overlayRef}
      onClick={e => { if (e.target === overlayRef.current) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div style={{
        background: 'var(--surface)', borderRadius: 16, border: '1px solid var(--border)',
        width: '100%', maxWidth: 680, maxHeight: '90vh', overflowY: 'auto',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header modal */}
        <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          <img src={video.thumbnail} alt={video.title} style={{ width: 100, height: 56, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)', lineHeight: 1.4, marginBottom: 6 }}>{video.title}</div>
            <a href={video.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Icon name="external" size={11} /> Voir sur YouTube
            </a>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 4, flexShrink: 0 }}>
            <Icon name="x" size={18} />
          </button>
        </div>

        {/* Stats grid */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Statistiques</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
            {stats.map(s => (
              <div key={s.label} style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '10px 14px', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4, fontWeight: 500 }}>{s.label}</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>{s.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Courbe de rétention */}
        <div style={{ padding: '16px 20px' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
            Courbe de rétention
          </div>
          {retentionLoading ? (
            <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: '24px 0' }}>
              <Icon name="refresh-cw" size={14} /> Chargement de la courbe…
            </div>
          ) : retentionCurve.length > 0 ? (
            <AreaChart
              data={retentionCurve}
              areas={[{ key: 'watchRatio', label: 'Rétention', color: '#ff0000' }]}
              xKey="ratio"
              height={160}
              formatter={(n) => `${n}%`}
            />
          ) : (
            <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12, padding: '24px 0' }}>
              Données de rétention non disponibles pour cette vidéo.
            </div>
          )}
        </div>
      </div>
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
  const [selectedVideo, setSelectedVideo] = useState<YoutubeVideo | null>(null);
  const [videoFilter, setVideoFilter] = useState<'all' | 'video' | 'short'>('all');
  const [igData, setIgData] = useState<any | null>(null);
  const [igDmData, setIgDmData] = useState<any | null>(null);
  const [hasInstagram, setHasInstagram] = useState<boolean | null>(null);
  const [igLoading, setIgLoading] = useState(true);
  const [selectedPost, setSelectedPost] = useState<any | null>(null);
  const [showAllYt, setShowAllYt] = useState(false);
  const [showAllIg, setShowAllIg] = useState(false);
  const [leads, setLeads] = useState<any[]>([]);
  const [leadsStats, setLeadsStats] = useState<{ dmCount30d: number; commentCount30d: number } | null>(null);
  const [leadsLoading, setLeadsLoading] = useState(true);
  const [leadsPage, setLeadsPage] = useState(1);
  const [leadsTotal, setLeadsTotal] = useState(0);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: integs } = await supabase
        .from('integrations')
        .select('provider')
        .eq('profile_id', user.id)
        .in('provider', ['stripe', 'youtube', 'instagram']);

      const hasStripe = integs?.some(i => i.provider === 'stripe') ?? false;
      const hasYT = integs?.some(i => i.provider === 'youtube') ?? false;
      const hasIG = integs?.some(i => i.provider === 'instagram') ?? false;

      setHasStripeKey(hasStripe);
      setHasYoutube(hasYT);
      setHasInstagram(hasIG);

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

      if (hasIG) {
        try {
          const [statsRes, dmRes, leadsRes] = await Promise.all([
            fetch('/api/instagram/stats'),
            fetch('/api/instagram/messages'),
            fetch('/api/instagram/leads'),
          ]);
          const statsJson = await statsRes.json();
          if (statsRes.ok) setIgData(statsJson);
          else setIgData({ _error: statsJson.error || 'Erreur inconnue', _code: statsJson.code, _type: statsJson.type });
          if (dmRes.ok) setIgDmData(await dmRes.json());
          if (leadsRes.ok) {
            const leadsJson = await leadsRes.json();
            setLeads(leadsJson.leads || []);
            setLeadsTotal(leadsJson.total || 0);
            setLeadsStats({ dmCount30d: leadsJson.dmCount30d, commentCount30d: leadsJson.commentCount30d });
          }
        } catch {}
      }
      setIgLoading(false);
      setLeadsLoading(false);
    }
    load();
  }, []);

  async function loadLeadsPage(page: number) {
    setLeadsLoading(true);
    const res = await fetch(`/api/instagram/leads?page=${page}`);
    if (res.ok) {
      const data = await res.json();
      setLeads(data.leads || []);
      setLeadsTotal(data.total || 0);
      setLeadsStats({ dmCount30d: data.dmCount30d, commentCount30d: data.commentCount30d });
      setLeadsPage(page);
    }
    setLeadsLoading(false);
  }

  async function markLeadRead(id: string) {
    await fetch('/api/instagram/leads', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    setLeads(prev => prev.map(l => l.id === id ? { ...l, read: true } : l));
  }

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
              <KpiCard label="Likes" value={youtubeData.likes30d.toLocaleString('fr-FR')} positive={youtubeData.likes30d > 0} />
              <KpiCard label="Commentaires" value={youtubeData.comments30d.toLocaleString('fr-FR')} positive={youtubeData.comments30d > 0} />
              <KpiCard label="Partages" value={youtubeData.shares30d.toLocaleString('fr-FR')} positive={youtubeData.shares30d > 0} />
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

            {/* Sources de trafic + Appareils */}
            {(youtubeData.trafficSources?.length > 0 || youtubeData.devices?.length > 0) && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
                {youtubeData.trafficSources?.length > 0 && (
                  <div className="card" style={{ padding: '16px 20px' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Sources de trafic</div>
                    {youtubeData.trafficSources.slice(0, 6).map(s => {
                      const total = youtubeData.trafficSources.reduce((a, b) => a + b.views, 0);
                      const pct = total > 0 ? Math.round((s.views / total) * 100) : 0;
                      const labels: Record<string, string> = { YT_SEARCH: 'Recherche YT', YT_CHANNEL: 'Page chaîne', EXT_URL: 'Liens externes', SHORTS: 'Shorts', BROWSE: 'Accueil', SUGGESTED: 'Suggestions', PLAYLIST: 'Playlists', NOTIFICATION: 'Notifications', END_SCREEN: 'Écrans de fin', HASHTAGS: 'Hashtags', NO_LINK_OTHER: 'Autres', ADVERTISING: 'Pubs' };
                      return (
                        <div key={s.source} style={{ marginBottom: 10 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                            <span style={{ color: 'var(--ink)' }}>{labels[s.source] || s.source}</span>
                            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--accent)' }}>{pct}%</span>
                          </div>
                          <div style={{ height: 4, background: 'var(--surface-2)', borderRadius: 2 }}>
                            <div style={{ height: '100%', background: '#ff0000', borderRadius: 2, width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {youtubeData.devices?.length > 0 && (
                  <div className="card" style={{ padding: '16px 20px' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Appareils</div>
                    {youtubeData.devices.map(d => {
                      const total = youtubeData.devices.reduce((a, b) => a + b.views, 0);
                      const pct = total > 0 ? Math.round((d.views / total) * 100) : 0;
                      const labels: Record<string, string> = { MOBILE: 'Mobile', DESKTOP: 'Ordinateur', TABLET: 'Tablette', TV: 'TV', GAME_CONSOLE: 'Console' };
                      const colors: Record<string, string> = { MOBILE: '#3b82f6', DESKTOP: '#8b5cf6', TABLET: '#f59e0b', TV: '#10b981', GAME_CONSOLE: '#ef4444' };
                      return (
                        <div key={d.device} style={{ marginBottom: 10 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                            <span style={{ color: 'var(--ink)' }}>{labels[d.device] || d.device}</span>
                            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--accent)' }}>{pct}%</span>
                          </div>
                          <div style={{ height: 4, background: 'var(--surface-2)', borderRadius: 2 }}>
                            <div style={{ height: '100%', background: colors[d.device] || '#6b7280', borderRadius: 2, width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Démographie audience + Mots-clés de recherche */}
            {(youtubeData.demographics?.length > 0 || youtubeData.searchKeywords?.length > 0) && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
                {youtubeData.demographics?.length > 0 && (
                  <div className="card" style={{ padding: '16px 20px' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Démographie audience</div>
                    {(() => {
                      const byAge: Record<string, number> = {};
                      for (const d of youtubeData.demographics) {
                        byAge[d.ageGroup] = (byAge[d.ageGroup] || 0) + d.viewerPct;
                      }
                      return Object.entries(byAge).sort((a, b) => b[1] - a[1]).map(([age, pct]) => (
                        <div key={age} style={{ marginBottom: 8 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                            <span style={{ color: 'var(--ink)' }}>{age.replace('age', '')}</span>
                            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--accent)' }}>{pct.toFixed(0)}%</span>
                          </div>
                          <div style={{ height: 4, background: 'var(--surface-2)', borderRadius: 2 }}>
                            <div style={{ height: '100%', background: '#ff0000', borderRadius: 2, width: `${Math.min(pct, 100)}%` }} />
                          </div>
                        </div>
                      ));
                    })()}
                  </div>
                )}
                {youtubeData.searchKeywords?.length > 0 && (
                  <div className="card" style={{ padding: '16px 20px' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Mots-clés de recherche</div>
                    {youtubeData.searchKeywords.map((k, i) => (
                      <div key={k.term} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', width: 16, textAlign: 'right' }}>{i + 1}</span>
                        <span style={{ fontSize: 12, color: 'var(--ink)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k.term}</span>
                        <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--accent)', flexShrink: 0 }}>{k.views} vues</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Vidéos */}
            {youtubeData.videos.length > 0 && (() => {
              const filtered = youtubeData.videos.filter(v =>
                videoFilter === 'all' ? true : videoFilter === 'short' ? v.isShort : !v.isShort
              );
              const shortCount = youtubeData.videos.filter(v => v.isShort).length;
              const videoCount = youtubeData.videos.filter(v => !v.isShort).length;
              return (
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                  <div className="card-title">Vidéos</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {([['all', `Toutes (${youtubeData.videos.length})`], ['video', `Vidéos (${videoCount})`], ['short', `Shorts (${shortCount})`]] as const).map(([val, label]) => (
                      <button
                        key={val}
                        onClick={() => { setVideoFilter(val); setShowAllYt(false); }}
                        style={{
                          fontSize: 11, padding: '4px 10px', borderRadius: 20, border: '1px solid var(--border)', cursor: 'pointer',
                          background: videoFilter === val ? 'var(--accent)' : 'transparent',
                          color: videoFilter === val ? 'var(--bg)' : 'var(--muted)',
                          fontWeight: videoFilter === val ? 700 : 400,
                        }}
                      >{label}</button>
                    ))}
                  </div>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th style={{ width: 88 }}>Miniature</th>
                        <th>Titre</th>
                        <th>Type</th>
                        <th>Vues totales</th>
                        <th>Vues 30j</th>
                        <th>Rétention moy.</th>
                        <th>Likes</th>
                        <th>Date</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {(showAllYt ? filtered : filtered.slice(0, 5)).map(v => (
                        <tr key={v.id}>
                          <td>
                            <img src={v.thumbnail} alt={v.title} style={{ width: 80, height: 45, objectFit: 'cover', borderRadius: 4, display: 'block' }} />
                          </td>
                          <td style={{ fontSize: 12, color: 'var(--accent)', maxWidth: 200 }}>
                            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>{v.title}</div>
                          </td>
                          <td>
                            <span className={`pill pill-${v.isShort ? 'amber' : 'neutral'}`} style={{ fontSize: 10 }}>
                              {v.isShort ? 'Short' : 'Vidéo'}
                            </span>
                          </td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700 }}>{v.views.toLocaleString('fr-FR')}</td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600, color: v.views30d > 0 ? 'var(--green)' : 'var(--muted)' }}>
                            {v.views30d > 0 ? `+${v.views30d.toLocaleString('fr-FR')}` : '—'}
                          </td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: v.avgViewPct >= 50 ? 'var(--green)' : v.avgViewPct >= 30 ? 'var(--ink)' : v.avgViewPct > 0 ? 'var(--amber)' : 'var(--muted)' }}>
                            {v.avgViewPct > 0 ? `${v.avgViewPct}%` : '—'}
                          </td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--muted)' }}>
                            {v.likes > 0 ? v.likes.toLocaleString('fr-FR') : '—'}
                          </td>
                          <td style={{ fontSize: 11, color: 'var(--muted)' }}>
                            {new Date(v.publishedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </td>
                          <td>
                            <button
                              onClick={() => setSelectedVideo(v)}
                              className="btn-ghost"
                              style={{ fontSize: 11, padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}
                            >
                              Détails <Icon name="chevR" size={11} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {filtered.length > 5 && (
                  <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', textAlign: 'center' }}>
                    <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => setShowAllYt(v => !v)}>
                      {showAllYt ? `Réduire ↑` : `Voir toutes les ${filtered.length} vidéos ↓`}
                    </button>
                  </div>
                )}
              </div>
              );
            })()}
            {selectedVideo && <VideoModal video={selectedVideo} onClose={() => setSelectedVideo(null)} />}
          </>
        ) : (
          <div className="card" style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
            Impossible de charger les stats YouTube. <a href="/client/settings" style={{ color: 'var(--accent)' }}>Reconnecter</a>
          </div>
        )}
      </div>

      {/* ── Instagram ── */}
      <div style={{ marginBottom: 32 }}>
        <SectionHeader icon="instagram" title="Instagram" sub={igData ? `@${igData.username}` : undefined} />

        {igLoading ? (
          <div className="card" style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
            <Icon name="refresh-cw" size={16} /> Chargement…
          </div>
        ) : !hasInstagram ? (
          <div className="card" style={{ padding: '32px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 28, marginBottom: 10 }}>📸</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)', marginBottom: 6 }}>Instagram non connecté</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16, lineHeight: 1.6 }}>
              Connecte ton compte Instagram Business pour voir tes abonnés, reach et publications.
            </div>
            <a href="/client/settings" className="btn-primary" style={{ fontSize: 13, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Icon name="link" size={13} /> Connecter Instagram
            </a>
          </div>
        ) : igData?._error ? (
          <div className="card" style={{ padding: '24px' }}>
            <div style={{ fontSize: 13, color: 'var(--red)', fontWeight: 600, marginBottom: 8 }}>Erreur Instagram (code {igData._code})</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12, fontFamily: 'var(--font-mono)' }}>{igData._error}</div>
            <a href="/client/settings" className="btn-primary" style={{ fontSize: 12, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Icon name="refresh-cw" size={12} /> Se reconnecter
            </a>
          </div>
        ) : igData ? (
          <>
            {/* KPIs compte */}
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Compte</div>
            <div className="grid-4" style={{ marginBottom: 20 }}>
              <KpiCard label="Abonnés" value={igData.followers.toLocaleString('fr-FR')} sub={`${igData.following} abonnements`} />
              <KpiCard label="Publications" value={igData.mediaCount.toLocaleString('fr-FR')} />
              {igData.followsUnfollows30d !== 0 && <KpiCard label="Nouveaux abonnés 30j" value={igData.followsUnfollows30d > 0 ? `+${igData.followsUnfollows30d}` : String(igData.followsUnfollows30d)} positive={igData.followsUnfollows30d > 0} />}
            </div>

            {/* KPIs 30j */}
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>30 derniers jours</div>
            <div className="grid-4" style={{ marginBottom: 20 }}>
              <KpiCard label="Reach" value={igData.reach30d.toLocaleString('fr-FR')} sub="Comptes uniques atteints" positive={igData.reach30d > 0} />
              <KpiCard label="Comptes engagés" value={igData.accountsEngaged30d.toLocaleString('fr-FR')} positive={igData.accountsEngaged30d > 0} />
              <KpiCard label="Interactions" value={igData.totalInteractions30d.toLocaleString('fr-FR')} positive={igData.totalInteractions30d > 0} />
              {igData.profileLinksTaps30d > 0 && <KpiCard label="Taps liens profil" value={igData.profileLinksTaps30d.toLocaleString('fr-FR')} positive />}
            </div>

            {/* Graphique reach par jour */}
            {igData.chartData?.length > 0 && igData.reach30d > 0 && (
              <div className="card" style={{ marginBottom: 20 }}>
                <div className="card-head">
                  <div className="card-title">Reach par jour</div>
                  <div className="card-sub">30 derniers jours</div>
                </div>
                <AreaChart
                  data={igData.chartData}
                  areas={[{ key: 'reach', label: 'Reach', color: '#e1306c' }]}
                  xKey="date"
                  height={180}
                  formatter={(n) => n.toLocaleString('fr-FR')}
                />
              </div>
            )}

            {/* Démographie abonnés Instagram */}
            {igData.demographics && Object.keys(igData.demographics).length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16, marginBottom: 20 }}>
                {igData.demographics.age && igData.demographics.age.length > 0 && (
                  <div className="card" style={{ padding: '16px 20px' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Âge des abonnés</div>
                    {igData.demographics.age.map((d: any) => {
                      const max = igData.demographics.age[0].value;
                      return (
                        <div key={d.label} style={{ marginBottom: 8 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                            <span>{d.label}</span>
                            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--accent)' }}>{d.value}</span>
                          </div>
                          <div style={{ height: 4, background: 'var(--surface-2)', borderRadius: 2 }}>
                            <div style={{ height: '100%', background: '#e1306c', borderRadius: 2, width: `${max > 0 ? (d.value / max) * 100 : 0}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {igData.demographics.gender && igData.demographics.gender.length > 0 && (
                  <div className="card" style={{ padding: '16px 20px' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Genre des abonnés</div>
                    {igData.demographics.gender.map((d: any) => {
                      const total = igData.demographics.gender.reduce((a: number, b: any) => a + b.value, 0);
                      const pct = total > 0 ? Math.round((d.value / total) * 100) : 0;
                      const gLabel: Record<string, string> = { M: 'Hommes', F: 'Femmes', U: 'Non précisé' };
                      return (
                        <div key={d.label} style={{ marginBottom: 10 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                            <span>{gLabel[d.label] || d.label}</span>
                            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--accent)' }}>{pct}%</span>
                          </div>
                          <div style={{ height: 4, background: 'var(--surface-2)', borderRadius: 2 }}>
                            <div style={{ height: '100%', background: '#e1306c', borderRadius: 2, width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {igData.demographics.country && igData.demographics.country.length > 0 && (
                  <div className="card" style={{ padding: '16px 20px' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Top pays</div>
                    {igData.demographics.country.slice(0, 6).map((d: any) => {
                      const max = igData.demographics.country[0].value;
                      return (
                        <div key={d.label} style={{ marginBottom: 8 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                            <span>{d.label}</span>
                            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--accent)' }}>{d.value}</span>
                          </div>
                          <div style={{ height: 4, background: 'var(--surface-2)', borderRadius: 2 }}>
                            <div style={{ height: '100%', background: '#e1306c', borderRadius: 2, width: `${max > 0 ? (d.value / max) * 100 : 0}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Publications récentes */}
            {igData.posts?.length > 0 && (
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div className="card-title">Publications récentes</div>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>{igData.posts.length} posts</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12, padding: 16 }}>
                  {(showAllIg ? igData.posts : igData.posts.slice(0, 6)).map((p: any) => (
                    <div
                      key={p.id}
                      onClick={() => setSelectedPost(p)}
                      style={{ cursor: 'pointer', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--surface-2)' }}
                    >
                      {p.thumbnail ? (
                        <img src={p.thumbnail} alt="" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }} />
                      ) : (
                        <div style={{ width: '100%', aspectRatio: '1', background: 'var(--surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Icon name="instagram" size={24} />
                        </div>
                      )}
                      <div style={{ padding: '8px 10px' }}>
                        <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>
                          {new Date(p.timestamp).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                          {p.type === 'VIDEO' && <span style={{ marginLeft: 4, color: '#e1306c' }}>▶</span>}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                          <span>❤️ {p.likes}</span>
                          <span>💬 {p.comments}</span>
                          <span>👁 {p.reach}</span>
                          <span>↗ {p.shares}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {igData.posts.length > 6 && (
                  <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', textAlign: 'center' }}>
                    <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => setShowAllIg(v => !v)}>
                      {showAllIg ? `Réduire ↑` : `Voir tous les ${igData.posts.length} posts ↓`}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Modal post */}
            {selectedPost && (
              <div
                onClick={(e) => { if (e.target === e.currentTarget) setSelectedPost(null); }}
                style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
              >
                <div style={{ background: 'var(--surface)', borderRadius: 16, border: '1px solid var(--border)', width: '100%', maxWidth: 600, maxHeight: '90vh', overflowY: 'auto' }}>
                  {/* Header */}
                  <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                    {selectedPost.thumbnail && (
                      <img src={selectedPost.thumbnail} alt="" style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }} />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {selectedPost.caption || '—'}
                      </div>
                      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                        <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                          {new Date(selectedPost.timestamp).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
                        </span>
                        <a href={selectedPost.permalink} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <Icon name="external" size={11} /> Voir sur Instagram
                        </a>
                      </div>
                    </div>
                    <button onClick={() => setSelectedPost(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 4, flexShrink: 0 }}>
                      <Icon name="x" size={18} />
                    </button>
                  </div>

                  {/* Stats grid */}
                  <div style={{ padding: '16px 20px' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Statistiques</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10 }}>
                      {[
                        { label: 'Vues', value: selectedPost.views > 0 ? selectedPost.views.toLocaleString('fr-FR') : '—' },
                        { label: 'Reach', value: selectedPost.reach > 0 ? selectedPost.reach.toLocaleString('fr-FR') : '—' },
                        { label: 'Likes', value: selectedPost.likes.toLocaleString('fr-FR') },
                        { label: 'Commentaires', value: selectedPost.comments.toLocaleString('fr-FR') },
                        { label: 'Partages', value: selectedPost.shares > 0 ? selectedPost.shares.toLocaleString('fr-FR') : '—' },
                        { label: 'Enregistrements', value: selectedPost.saved > 0 ? selectedPost.saved.toLocaleString('fr-FR') : '—' },
                        { label: 'Interactions', value: selectedPost.totalInteractions > 0 ? selectedPost.totalInteractions.toLocaleString('fr-FR') : '—' },
                        ...(selectedPost.type === 'VIDEO' ? [
                          { label: 'Watch time moy.', value: selectedPost.avgWatchTimeMs > 0 ? `${(selectedPost.avgWatchTimeMs / 1000).toFixed(1)}s` : '—' },
                          { label: 'Watch time total', value: selectedPost.totalWatchTimeMs > 0 ? `${Math.round(selectedPost.totalWatchTimeMs / 1000)}s` : '—' },
                          { label: 'Taux de skip', value: selectedPost.skipRate > 0 ? `${selectedPost.skipRate.toFixed(1)}%` : '—' },
                          { label: 'Complétion', value: selectedPost.completionRate > 0 ? `${selectedPost.completionRate.toFixed(1)}%` : '—' },
                        ] : []),
                      ].map(s => (
                        <div key={s.label} style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '10px 14px', border: '1px solid var(--border)' }}>
                          <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4, fontWeight: 500 }}>{s.label}</div>
                          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>{s.value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="card" style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
            Impossible de charger les stats Instagram. <a href="/client/settings" style={{ color: 'var(--accent)' }}>Reconnecter</a>
          </div>
        )}
      </div>

      {/* ── Instagram DMs ── */}
      {hasInstagram && (
        <div style={{ marginBottom: 32 }}>
          <SectionHeader icon="mail" title="Instagram DMs" sub="30 derniers jours" />

          {igLoading ? (
            <div className="card" style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
              <Icon name="refresh-cw" size={16} /> Chargement…
            </div>
          ) : igDmData?.error ? (
            <div className="card" style={{ padding: '24px', textAlign: 'center' }}>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>
                Les stats DMs seront disponibles après approbation Meta.
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>{igDmData.error}</div>
            </div>
          ) : igDmData ? (
            <>
              <div className="grid-4" style={{ marginBottom: 20 }}>
                <KpiCard label="Conversations reçues" value={igDmData.totalThreads30d.toLocaleString('fr-FR')} sub="30 derniers jours" positive={igDmData.totalThreads30d > 0} />
                <KpiCard label="Taux de réponse" value={`${igDmData.responseRate}%`} sub={`${igDmData.repliedThreads} répondus`} positive={igDmData.responseRate >= 50} />
                <KpiCard label="Leads détectés" value={igDmData.leadCount.toLocaleString('fr-FR')} sub="Messages avec intent" positive={igDmData.leadCount > 0} />
              </div>

              {/* Mots-clés leads */}
              {Object.keys(igDmData.keywordCounts || {}).length > 0 && (
                <div className="card" style={{ marginBottom: 20, padding: '16px 20px' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Mots-clés détectés dans les DMs</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {Object.entries(igDmData.keywordCounts).map(([kw, count]: [string, any]) => (
                      <div key={kw} style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 20, padding: '4px 12px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontWeight: 600, color: 'var(--accent)' }}>{kw}</span>
                        <span style={{ background: '#e1306c', color: '#fff', borderRadius: 10, padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Liste conversations récentes */}
              {igDmData.threads?.length > 0 && (
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                  <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div className="card-title">Conversations récentes</div>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>{igDmData.threads.length} threads</span>
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Expéditeur</th>
                          <th>Aperçu</th>
                          <th>Messages</th>
                          <th>Date</th>
                          <th>Statut</th>
                        </tr>
                      </thead>
                      <tbody>
                        {igDmData.threads.map((t: any) => (
                          <tr key={t.threadId}>
                            <td style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)', whiteSpace: 'nowrap' }}>{t.participant}</td>
                            <td style={{ fontSize: 12, color: 'var(--muted)', maxWidth: 220 }}>
                              <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>
                                {t.preview || '—'}
                              </div>
                            </td>
                            <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{t.messageCount}</td>
                            <td style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                              {new Date(t.updatedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                            </td>
                            <td>
                              <div style={{ display: 'flex', gap: 4, flexWrap: 'nowrap' }}>
                                {t.isLead && <span className="pill pill-green" style={{ fontSize: 10 }}>Lead</span>}
                                <span className={`pill pill-${t.hasReply ? 'green' : 'amber'}`} style={{ fontSize: 10 }}>
                                  {t.hasReply ? 'Répondu' : 'Sans réponse'}
                                </span>
                              </div>
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
              Stats DMs indisponibles pour le moment.
            </div>
          )}
        </div>
      )}

      {/* ── Leads Instagram ── */}
      {hasInstagram && (
        <div style={{ marginBottom: 32 }}>
          <SectionHeader
            icon="users"
            title="Leads détectés"
            sub="DMs et commentaires contenant tes mots-clés"
            right={
              <a href="/client/settings" style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}>
                <Icon name="settings" size={11} /> Configurer les mots-clés
              </a>
            }
          />

          {leadsStats && (
            <div className="grid-4" style={{ marginBottom: 20 }}>
              <KpiCard label="Leads DM (30j)" value={leadsStats.dmCount30d.toLocaleString('fr-FR')} sub="Mots-clés en message direct" positive={leadsStats.dmCount30d > 0} />
              <KpiCard label="Leads commentaires (30j)" value={leadsStats.commentCount30d.toLocaleString('fr-FR')} sub="Mots-clés en commentaire" positive={leadsStats.commentCount30d > 0} />
              <KpiCard label="Total leads" value={leadsTotal.toLocaleString('fr-FR')} sub="Tous les leads stockés" />
            </div>
          )}

          {leadsLoading ? (
            <div className="card" style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
              <Icon name="refresh-cw" size={16} /> Chargement des leads…
            </div>
          ) : leads.length === 0 ? (
            <div className="card" style={{ padding: '32px 24px', textAlign: 'center' }}>
              <div style={{ fontSize: 28, marginBottom: 10 }}>🎯</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)', marginBottom: 6 }}>Aucun lead détecté</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16, lineHeight: 1.6 }}>
                Configure tes mots-clés lead magnet dans les réglages.<br />
                Le scan tourne automatiquement chaque matin à 6h.
              </div>
              <a href="/client/settings" className="btn-primary" style={{ fontSize: 13, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Icon name="settings" size={13} /> Configurer les mots-clés
              </a>
            </div>
          ) : (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
                      <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--muted)' }}>Compte</th>
                      <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--muted)' }}>Source</th>
                      <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--muted)' }}>Mot-clé</th>
                      <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--muted)' }}>Message</th>
                      <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--muted)' }}>Post</th>
                      <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--muted)' }}>Date</th>
                      <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--muted)' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {leads.map((lead: any) => (
                      <tr
                        key={lead.id}
                        style={{ borderBottom: '1px solid var(--border)', background: lead.read ? 'transparent' : 'rgba(var(--accent-rgb), 0.03)' }}
                      >
                        <td style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--accent)', whiteSpace: 'nowrap' }}>
                          {lead.ig_username ? (
                            <a
                              href={`https://www.instagram.com/${lead.ig_username}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ color: 'var(--accent)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}
                            >
                              @{lead.ig_username}
                              <Icon name="external" size={11} />
                            </a>
                          ) : '—'}
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <span className={`pill pill-${lead.source === 'dm' ? 'blue' : 'neutral'}`} style={{ fontSize: 10 }}>
                            {lead.source === 'dm' ? 'DM' : 'Commentaire'}
                          </span>
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <span style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 12, padding: '2px 8px', fontSize: 11, fontWeight: 600, color: 'var(--accent)' }}>
                            {lead.keyword_matched}
                          </span>
                        </td>
                        <td style={{ padding: '12px 16px', color: 'var(--muted)', maxWidth: 260 }}>
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>
                            {lead.message || '—'}
                          </div>
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          {lead.media_permalink ? (
                            <a
                              href={lead.media_permalink}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ fontSize: 11, color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}
                            >
                              <Icon name="external" size={11} /> Voir le post
                            </a>
                          ) : '—'}
                        </td>
                        <td style={{ padding: '12px 16px', fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                          {new Date(lead.detected_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          {!lead.read && (
                            <button
                              className="btn-ghost"
                              style={{ fontSize: 11, padding: '3px 8px' }}
                              type="button"
                              onClick={() => markLeadRead(lead.id)}
                            >
                              Marquer lu
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {leadsTotal > 20 && (
                <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{leadsTotal} leads au total</span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn-ghost" style={{ fontSize: 12 }} type="button" disabled={leadsPage <= 1} onClick={() => loadLeadsPage(leadsPage - 1)}>← Précédent</button>
                    <span style={{ fontSize: 12, color: 'var(--muted)', alignSelf: 'center' }}>Page {leadsPage}</span>
                    <button className="btn-ghost" style={{ fontSize: 12 }} type="button" disabled={leadsPage * 20 >= leadsTotal} onClick={() => loadLeadsPage(leadsPage + 1)}>Suivant →</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
