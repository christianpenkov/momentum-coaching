'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createPortal } from 'react-dom';
import { createClient } from '@/lib/supabase/client';
import AreaChart from '@/components/charts/AreaChart';
import BarChart from '@/components/charts/BarChart';
import Heatmap from '@/components/charts/Heatmap';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, PieChart, Pie, Cell,
  AreaChart as ReAreaChart, Area,
} from 'recharts';

// ─── Portal Modal ─────────────────────────────────────────────────────────────
function ModalOverlay({ children, onClose, maxWidth = 760 }: { children: React.ReactNode; onClose: () => void; maxWidth?: number }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;
  return createPortal(
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={onClose}>
      <div style={{ width: '100%', maxWidth }} onClick={e => e.stopPropagation()}>{children}</div>
    </div>,
    document.body
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface IGStats {
  username: string; name: string; profilePicture: string | null;
  followers: number; following: number; mediaCount: number; biography: string;
  reach30d: number; accountsEngaged30d: number; totalInteractions30d: number;
  followsUnfollows30d: number; profileLinksTaps30d: number; websiteClicks30d: number;
  views30d: number;
  viewsFollowerBreakdown: { follower: number; nonFollower: number } | null;
  chartData: { date: string; reach: number; followerCount?: number | null; views?: number; accountsEngaged?: number; totalInteractions?: number; websiteClicks?: number }[];
  posts: IGPost[]; demographics: Record<string, { label: string; value: number }[]>;
  onlineFollowers: any;
}
interface IGPost {
  id: string; caption: string; type: string; thumbnail: string | null;
  timestamp: string; permalink: string;
  likes: number | null; comments: number | null; reach: number | null;
  saved: number | null; shares: number | null; views: number | null;
  totalInteractions: number | null; follows: number | null; profileVisits: number | null;
  videoDuration: number | null; avgWatchTimeMs: number | null;
  totalWatchTimeMs: number | null; skipRate: number | null;
}
interface YTStats {
  channelName: string; channelThumbnail: string; subscribers: number;
  totalViews: number; videoCount: number;
  views30d: number; watchTime30d: number; avgViewDurationSec?: number; likes30d: number; comments30d: number;
  shares30d: number; subsGained30d: number; subsLost30d: number; netSubs30d: number;
  chartData: { date: string; views: number; watchTime: number; subsGained?: number; subsLost?: number; netSubs?: number }[];
  videos: YTVideo[]; trafficSources: { source: string; views: number; watchMinutes: number }[];
  devices: { device: string; views: number; watchMinutes: number }[];
  demographics: { ageGroup: string; gender: string; viewerPct: number }[];
  searchKeywords: { term: string; views: number }[];
}
interface YTVideo {
  id: string; title: string; thumbnail: string; publishedAt: string;
  duration: string; isShort: boolean;
  views: number; likes: number; comments: number;
  views30d: number; watchTime30d: number; avgViewPct: number;
  likes30d: number; comments30d: number; shares30d: number; url: string;
}
interface CallRecord {
  id: string; scheduled_at: string; status: 'active' | 'canceled';
  invitee_name: string; invitee_email: string; duration: number;
  no_show?: boolean; deal_closed?: boolean; revenue?: number;
  rescheduled?: boolean; source?: string; notes?: string;
}
interface StripeStats {
  mrr: number; monthlyRevenue: number; activeSubscriptions: number;
  availableBalance: number;
  recentPayments: { id: string; amount: number; currency: string; description: string; date: string; status: string }[];
}
interface IGMessages {
  totalThreads30d: number; repliedThreads: number; responseRate: number; leadCount: number;
  keywordCounts: Record<string, number>;
  threads: { threadId: string; updatedAt: string; messageCount: number; hasReply: boolean; participant: string; preview: string; isLead: boolean }[];
}
interface ShortioStats {
  domain: string; totalLinks: number; clicks30d: number; humanClicks30d: number;
  clicksChange: number | null; clicksPerLink30d: number;
  chartData: { date: string; clicks: number }[];
  topCountries: { label: string; value: number }[];
  topReferrers: { label: string; value: number }[];
  topBrowsers: { label: string; value: number }[];
  topOs: { label: string; value: number }[];
  topSocial: { label: string; value: number }[];
  topCities: { label: string; value: number }[];
  links: ShortioLink[];
}
interface ShortioLink {
  id: number; path: string; shortUrl: string; originalUrl: string; title: string;
  createdAt: string; clicks30d: number; humanClicks30d: number; clicksChange: number | null;
  chartData: { date: string; clicks: number }[];
  countries: { label: string; value: number }[];
  referrers: { label: string; value: number }[];
  browsers: { label: string; value: number }[];
  os: { label: string; value: number }[];
  social: { label: string; value: number }[];
  cities: { label: string; value: number }[];
  utmMedium: { label: string; value: number }[];
  utmSource: { label: string; value: number }[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number, decimals = 0) => n.toLocaleString('fr-FR', { maximumFractionDigits: decimals });
const fmtEur = (n: number) => `${fmt(n)} €`;
const fmtPct = (n: number) => `${fmt(n, 1)} %`;
const fmtMs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

function pct(a: number, b: number) { return b > 0 ? Math.round((a / b) * 100) : 0; }

// Format axe X : "13 févr." — pas d'année, espacé uniformément
const fmtAxisDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }).replace('.', '');
};

const ACCENT = 'var(--accent)';
const GREEN = '#3f8a52';
const AMBER = '#b58025';
const RED = '#cd5b3f';
const BLUE = '#6b7cde';
const PIE_COLORS = [ACCENT, GREEN, AMBER, RED, BLUE, '#a78bfa', '#f59e0b', '#10b981'];

// ─── Sub-components ───────────────────────────────────────────────────────────

function Card({ title, sub, children, style }: { title?: string; sub?: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="card" style={style}>
      {title && (
        <div className="card-head">
          <div>
            <div className="card-title">{title}</div>
            {sub && <div className="card-sub">{sub}</div>}
          </div>
        </div>
      )}
      {children}
    </div>
  );
}

function Stat({ label, value, sub, color, onClick }: { label: string; value: string | number; sub?: string; color?: string; onClick?: () => void }) {
  return (
    <div onClick={onClick} style={{ display: 'flex', flexDirection: 'column', gap: 2, cursor: onClick ? 'pointer' : 'default', borderRadius: 8, padding: onClick ? '6px 8px' : '0', margin: onClick ? '-6px -8px' : '0', transition: 'background .15s' }}
      onMouseEnter={e => { if (onClick) e.currentTarget.style.background = 'var(--surface-2)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = ''; }}>
      <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || 'var(--ink)', lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{sub}</div>}
    </div>
  );
}

function StatGrid({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 20, marginBottom: 20 }}>{children}</div>;
}

function Tabs({ tabs, active, onChange }: { tabs: string[]; active: number; onChange: (i: number) => void }) {
  return (
    <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 28 }}>
      {tabs.map((t, i) => (
        <button key={i} onClick={() => onChange(i)} style={{
          padding: '10px 16px', fontSize: 13, fontWeight: active === i ? 600 : 400,
          color: active === i ? 'var(--ink)' : 'var(--muted)',
          background: 'none', border: 'none', cursor: 'pointer',
          borderBottom: active === i ? '2px solid var(--ink)' : '2px solid transparent',
          marginBottom: -1, transition: 'all .15s',
        }}>{t}</button>
      ))}
    </div>
  );
}

function Loading() {
  return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 120, color: 'var(--muted)', fontSize: 13 }}>Chargement…</div>;
}

function Empty({ msg = 'Aucune donnée disponible' }: { msg?: string }) {
  return <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--faint)', fontSize: 13 }}>{msg}</div>;
}

// ─── TAB 1 : Vue Générale — helpers ──────────────────────────────────────────

function DeltaBadge({ value, suffix = '%' }: { value: number; suffix?: string }) {
  const color = value > 0 ? GREEN : value < 0 ? RED : 'var(--muted)';
  const sign = value > 0 ? '+' : '';
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color }}>
      {sign}{fmt(value, 1)}{suffix} vs S-1
    </span>
  );
}

function TodayStat({ label, value, delta, deltaLabel }: { label: string; value: string; delta?: number; deltaLabel?: string }) {
  return (
    <div style={{ flex: 1, minWidth: 0, padding: '20px 24px', borderRight: '1px solid var(--border)' }}>
      <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--muted)', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--ink)', lineHeight: 1, marginBottom: 6 }}>{value}</div>
      {delta !== undefined && <DeltaBadge value={delta} suffix={deltaLabel || '%'} />}
    </div>
  );
}

interface FunnelStageProps {
  label: string;
  value: number | string;
  sub?: string;
  convRate?: number;
  isLast?: boolean;
  highlight?: boolean;
}

function FunnelStage({ label, value, sub, convRate, isLast, highlight }: FunnelStageProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', flex: 1 }}>
      <div style={{
        width: '100%', padding: '20px 12px 16px',
        background: highlight ? 'var(--accent)10' : 'var(--surface)',
        border: `1px solid ${highlight ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: 10,
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: highlight ? 'var(--accent)' : 'var(--muted)', marginBottom: 6 }}>{label}</div>
        <div style={{ fontSize: 28, fontWeight: 800, color: highlight ? 'var(--accent)' : 'var(--ink)', lineHeight: 1 }}>{typeof value === 'number' ? fmt(value) : value}</div>
        {sub && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>{sub}</div>}
      </div>
      {!isLast && convRate !== undefined && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'absolute', right: -22, top: '50%', transform: 'translateY(-50%)', zIndex: 1 }}>
          <div style={{ fontSize: 16, color: 'var(--border)', lineHeight: 1 }}>→</div>
          <div style={{ fontSize: 10, fontWeight: 700, color: convRate < 5 ? RED : convRate < 20 ? AMBER : GREEN, marginTop: 2, whiteSpace: 'nowrap' }}>{fmt(convRate, 1)}%</div>
        </div>
      )}
    </div>
  );
}

function LeverCard({ label, value, formula }: { label: string; value: string; formula: string }) {
  return (
    <div style={{ padding: '16px 18px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
      <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted)', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--ink)', lineHeight: 1, marginBottom: 4 }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--faint)', fontFamily: 'monospace' }}>{formula}</div>
    </div>
  );
}

type SignalType = 'green' | 'amber' | 'red';
function Signal({ type, text }: { type: SignalType; text: string }) {
  const dot = type === 'green' ? GREEN : type === 'amber' ? AMBER : RED;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border-soft)' }}>
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: dot, marginTop: 3, flexShrink: 0 }} />
      <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.4 }}>{text}</div>
    </div>
  );
}

// ─── Custom Tooltip ───────────────────────────────────────────────────────────

function Sparkline({ data, color = 'var(--accent)', height = 52 }: { data: number[]; color?: string; height?: number }) {
  const pts = data.map((v, i) => ({ i, v }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ReAreaChart data={pts} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`sg-${color.replace(/[^a-z0-9]/gi, '')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.2} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} fill={`url(#sg-${color.replace(/[^a-z0-9]/gi, '')})`} dot={false} isAnimationActive={false} />
      </ReAreaChart>
    </ResponsiveContainer>
  );
}

function ChartTooltip({ active, payload, label, fmtFn }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-label">{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} className="chart-tooltip-row">
          <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color, display: 'inline-block', marginRight: 6 }} />
          <span>{p.name}: </span>
          <strong>{fmtFn ? fmtFn(p.value) : fmt(p.value)}</strong>
        </div>
      ))}
    </div>
  );
}

// ─── TAB 1 : Vue Générale ─────────────────────────────────────────────────────

type ContentSortKey = 'views' | 'watchTime' | 'calls' | 'revenue';
type Period = 7 | 30;

function TabOverview_UNUSED({ ig, yt, stripe, shortio, msgs, calls, period }: { ig: IGStats | null; yt: YTStats | null; stripe: StripeStats | null; shortio: ShortioStats | null; msgs: IGMessages | null; calls: CallRecord[]; period: Period }) {
  const [contentSort, setContentSort] = useState<ContentSortKey>('views');
  const [showAllContent, setShowAllContent] = useState(false);
  const now = new Date();

  // ── Vues IG sur la période ─────────────────────────────────────────────────
  const igViews30d = ig?.views30d || 0;
  const igViews7d = ig ? ig.chartData.slice(-7).reduce((s, d) => {
    // chartData contient reach, on estime les vues via le ratio views30d/reach30d
    const ratio = (ig.reach30d > 0) ? igViews30d / ig.reach30d : 1;
    return s + Math.round(d.reach * ratio);
  }, 0) : 0;
  const igViews = period === 7 ? igViews7d : igViews30d;

  // ── Vues YT sur la période ─────────────────────────────────────────────────
  const ytViews30d = yt?.views30d || 0;
  const ytViews7d = yt ? yt.chartData.slice(-7).reduce((s, d) => s + d.views, 0) : 0;
  const ytViews = period === 7 ? ytViews7d : ytViews30d;

  // ── Reach total (IG chartData + YT chartData) ──────────────────────────────
  const igReach = period === 7
    ? (ig?.chartData.slice(-7).reduce((s, d) => s + d.reach, 0) || 0)
    : (ig?.reach30d || 0);
  const ytReach = period === 7 ? ytViews7d : ytViews30d;
  const totalReach = igReach + ytReach;

  // ── Clics lien Short.io ────────────────────────────────────────────────────
  const shortioClicks30d = shortio?.humanClicks30d || 0;
  const shortioClicks7d = shortio ? shortio.chartData.slice(-7).reduce((s, d) => s + d.clicks, 0) : 0;
  const shortioClicks = period === 7 ? shortioClicks7d : shortioClicks30d;

  // ── Calls sur la période ───────────────────────────────────────────────────
  const cutoff = new Date(now.getTime() - period * 86400000);
  const callsInPeriod = calls.filter(c => new Date(c.scheduled_at) >= cutoff);
  const callsBookes = callsInPeriod.filter(c => c.status === 'active').length;
  const callsHonores = callsInPeriod.filter(c => c.status === 'active' && new Date(c.scheduled_at) < now && !c.no_show).length;
  const noShows = callsInPeriod.filter(c => c.status === 'active' && new Date(c.scheduled_at) < now && c.no_show).length;
  const dealsCloses = callsInPeriod.filter(c => c.deal_closed).length;
  const revenueFromCalls = callsInPeriod.filter(c => c.deal_closed && c.revenue).reduce((s, c) => s + (c.revenue || 0), 0);
  const noShowRate = callsBookes > 0 ? (noShows / callsBookes) * 100 : 0;
  const closingRate = callsHonores > 0 ? (dealsCloses / callsHonores) * 100 : 0;

  // ── Revenue 30j (fixe) ─────────────────────────────────────────────────────
  const mrr = stripe?.mrr || 0;
  const revenue30j = stripe?.monthlyRevenue || 0;

  // ── Funnel ────────────────────────────────────────────────────────────────
  const rateClickToCall = shortioClicks > 0 ? (callsBookes / shortioClicks) * 100 : 0;
  const rateCallToShow = callsBookes > 0 ? (callsHonores / callsBookes) * 100 : 0;
  const rateShowToClose = callsHonores > 0 ? (dealsCloses / callsHonores) * 100 : 0;

  // ── Lever metrics ─────────────────────────────────────────────────────────
  const totalViews = igViews + ytViews;
  const revPer1kViews = totalViews > 0 ? (mrr / (totalViews / 1000)) : 0;
  const callsPer10kReach = totalReach > 0 ? (callsBookes / (totalReach / 10000)) : 0;
  const contentCount = (ig?.posts.length || 0) + (yt?.videos.length || 0);
  const revPerContent = contentCount > 0 ? mrr / contentCount : 0;
  const subs = (ig?.followers || 0) + (yt?.subscribers || 0);
  const revPerSub = subs > 0 ? (mrr / subs) * 1000 : 0;
  const watchTimeH = yt ? yt.watchTime30d / 60 : 0;
  const callsPer100hWatch = watchTimeH > 0 ? (callsBookes / watchTimeH) * 100 : 0;

  // ── Top content ───────────────────────────────────────────────────────────
  // Calls par plateforme (seule granularité dispo — source UTM = plateforme, pas post individuel)
  // Attribution manuelle cohérente avec les MOCK_CALLS (9 IG + 5 YT, revenue total ~7 800€)
  // Chaque post reçoit une fraction réaliste des calls selon son reach relatif
  const igCallsAll  = calls.filter(c => c.source?.startsWith('ig'));
  const ytCallsAll  = calls.filter(c => c.source?.startsWith('yt'));

  // Totaux par plateforme pour la répartition proportionnelle
  const igPosts = ig?.posts || [];
  const igTotalReach = igPosts.reduce((s, p) => s + (p.reach || 0), 0);
  const igTotalCallsBooked = igCallsAll.filter(c => c.status === 'active').length;
  const igTotalNoShow = igCallsAll.filter(c => c.no_show).length;
  const igTotalClosed = igCallsAll.filter(c => c.deal_closed).length;
  const igTotalRev = igCallsAll.reduce((s, c) => s + (c.revenue || 0), 0);

  const ytVideos = yt?.videos || [];
  const ytTotalViews = ytVideos.reduce((s, v) => s + v.views30d, 0);
  const ytTotalCallsBooked = ytCallsAll.filter(c => c.status === 'active').length;
  const ytTotalNoShow = ytCallsAll.filter(c => c.no_show).length;
  const ytTotalClosed = ytCallsAll.filter(c => c.deal_closed).length;
  const ytTotalRev = ytCallsAll.reduce((s, c) => s + (c.revenue || 0), 0);

  type ContentItem = { id: string; title: string; thumbnail: string | null; platform: 'IG' | 'YT'; type: string; views: number; totalViews: number; watchTime: number; avgWatchTimeMin: number | null; noShowCount: number; noShowPct: number | null; closedCount: number; closedPct: number | null; callsBooked: number; revenueTotal: number; revenuePerCall: number };
  const allContent: ContentItem[] = [
    ...igPosts.map(p => {
      const share = igTotalReach > 0 ? (p.reach || 0) / igTotalReach : 0;
      const callsBooked = Math.round(igTotalCallsBooked * share);
      // no-show et closé proportionnels au callsBooked du post — jamais > callsBooked
      const noShowCount = Math.min(callsBooked, Math.round(igTotalNoShow * share));
      const closedCount = Math.min(callsBooked - noShowCount, Math.round(igTotalClosed * share));
      const honored = callsBooked - noShowCount;
      const noShowPct = callsBooked > 0 ? Math.round((noShowCount / callsBooked) * 100) : null;
      const closedPct = honored > 0 ? Math.round((closedCount / honored) * 100) : null;
      const revTotal = Math.round(igTotalRev * share);
      const avgWatchTimeMin = p.avgWatchTimeMs ? Math.round(p.avgWatchTimeMs / 1000 / 60 * 10) / 10 : null;
      return {
        id: p.id, title: p.caption?.slice(0, 60) || '(sans titre)', thumbnail: p.thumbnail || null, platform: 'IG' as const,
        type: p.type === 'VIDEO' ? 'Reel' : p.type === 'CAROUSEL_ALBUM' ? 'Carousel' : 'Image',
        views: p.views || p.reach || 0, totalViews: p.views || p.reach || 0,
        watchTime: p.totalWatchTimeMs ? Math.round(p.totalWatchTimeMs / 1000 / 60) : 0, avgWatchTimeMin,
        noShowCount, noShowPct, closedCount, closedPct, callsBooked, revenueTotal: revTotal,
        revenuePerCall: callsBooked > 0 ? Math.round(revTotal / callsBooked) : 0,
      };
    }),
    ...ytVideos.map(v => {
      const share = ytTotalViews > 0 ? v.views30d / ytTotalViews : 0;
      const callsBooked = Math.round(ytTotalCallsBooked * share);
      const noShowCount = Math.min(callsBooked, Math.round(ytTotalNoShow * share));
      const closedCount = Math.min(callsBooked - noShowCount, Math.round(ytTotalClosed * share));
      const honored = callsBooked - noShowCount;
      const noShowPct = callsBooked > 0 ? Math.round((noShowCount / callsBooked) * 100) : null;
      const closedPct = honored > 0 ? Math.round((closedCount / honored) * 100) : null;
      const revTotal = Math.round(ytTotalRev * share);
      const avgWatchTimeMin = v.watchTime30d && v.views30d > 0 ? Math.round(v.watchTime30d / v.views30d / 60 * 10) / 10 : null;
      return {
        id: v.id, title: v.title, thumbnail: v.thumbnail || null, platform: 'YT' as const,
        type: v.isShort ? 'Short' : 'Vidéo',
        views: v.views30d, totalViews: v.views,
        watchTime: Math.round(v.watchTime30d / 60), avgWatchTimeMin,
        noShowCount, noShowPct, closedCount, closedPct, callsBooked, revenueTotal: revTotal,
        revenuePerCall: callsBooked > 0 ? Math.round(revTotal / callsBooked) : 0,
      };
    }),
  ];

  const sortedContent = [...allContent].sort((a, b) => {
    if (contentSort === 'views') return b.totalViews - a.totalViews;
    if (contentSort === 'watchTime') return b.watchTime - a.watchTime;
    if (contentSort === 'calls') return b.callsBooked - a.callsBooked;
    return b.revenueTotal - a.revenueTotal;
  });
  const visibleContent = showAllContent ? sortedContent : sortedContent.slice(0, 5);

  // ── Signals ───────────────────────────────────────────────────────────────
  const nextCall = calls.filter(c => new Date(c.scheduled_at) > now).sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())[0];
  const topPost = ig?.posts.reduce((a, b) => (b.reach || 0) > (a.reach || 0) ? b : a, ig.posts[0]);
  const signalData: { type: SignalType; text: string }[] = [];
  if (nextCall) signalData.push({ type: 'green', text: `Prochain call : ${nextCall.invitee_name} — ${new Date(nextCall.scheduled_at).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` });
  if (dealsCloses > 0) signalData.push({ type: 'green', text: `${dealsCloses} deal${dealsCloses > 1 ? 's' : ''} closé${dealsCloses > 1 ? 's' : ''} sur ${period}j — ${fmtEur(revenueFromCalls)} générés` });
  if (noShowRate > 20) signalData.push({ type: 'red', text: `Taux no-show élevé : ${fmt(noShowRate, 1)} % des calls bookés` });
  if (topPost && (topPost.reach || 0) > 40000) signalData.push({ type: 'green', text: `Meilleur reel du mois : ${fmt(topPost.reach || 0)} reach — ${topPost.caption?.slice(0, 50)}…` });
  if (msgs && msgs.responseRate < 70) signalData.push({ type: 'amber', text: `Taux de réponse DM bas : ${fmt(msgs.responseRate, 1)} % — ${msgs.totalThreads30d - msgs.repliedThreads} conversations sans réponse` });
  if (rateShowToClose > 0 && rateShowToClose < 20) signalData.push({ type: 'amber', text: `Taux de closing à ${fmt(rateShowToClose, 1)} % — sous le seuil cible de 25 %` });

  const SORT_LABELS: { key: ContentSortKey; label: string }[] = [
    { key: 'views', label: 'Vues' },
    { key: 'watchTime', label: 'Watch Time' },
    { key: 'calls', label: 'Calls' },
    { key: 'revenue', label: 'Revenue' },
  ];

  const periodLabel = `${period} derniers jours`;

  // ── Abonnés gagnés sur la période ────────────────────────────────────────
  const igFollowsGained = period === 7
    ? ig?.followsUnfollows30d != null ? Math.round(ig.followsUnfollows30d / 30 * 7) : null
    : ig?.followsUnfollows30d ?? null;
  const ytSubsGained = period === 7
    ? yt ? Math.round(yt.subsGained30d / 30 * 7) : null
    : yt?.subsGained30d ?? null;

  // ── Données graphiques avec dates réelles ────────────────────────────────
  const igChartSlice = ig?.chartData.slice(-period) || [];
  const ytChartSlice = yt?.chartData.slice(-period) || [];
  const shortioChartSlice = shortio?.chartData.slice(-period) || [];

  const igViewRatio = ig && ig.reach30d > 0 ? igViews30d / ig.reach30d : 1;

  const sparkCards = [
    {
      label: 'Reach total', value: fmt(totalReach), sub: `${period}j — IG + YT`, unit: 'personnes',
      delta: (() => { const prev = (ig?.chartData.slice(-(period * 2), -period).reduce((s, d) => s + d.reach, 0) || 0) + (yt?.chartData.slice(-(period * 2), -period).reduce((s, d) => s + d.views, 0) || 0); return prev > 0 ? ((totalReach - prev) / prev) * 100 : null; })(),
      data: igChartSlice.map((d, i) => ({ date: d.date, v: d.reach + (ytChartSlice[i]?.views || 0) })),
      color: ACCENT,
    },
    {
      label: 'Vues Instagram', value: fmt(igViews), sub: `${period}j`, unit: 'vues',
      delta: (() => { const prev = ig?.chartData.slice(-(period * 2), -period).reduce((s, d) => s + Math.round(d.reach * igViewRatio), 0) || 0; return prev > 0 ? ((igViews - prev) / prev) * 100 : null; })(),
      data: igChartSlice.map(d => ({ date: d.date, v: Math.round(d.reach * igViewRatio) })),
      color: ACCENT,
    },
    {
      label: 'Vues YouTube', value: fmt(ytViews), sub: `${period}j`, unit: 'vues',
      delta: (() => { const prev = yt?.chartData.slice(-(period * 2), -period).reduce((s, d) => s + d.views, 0) || 0; return prev > 0 ? ((ytViews - prev) / prev) * 100 : null; })(),
      data: ytChartSlice.map(d => ({ date: d.date, v: d.views })),
      color: RED,
    },
    {
      label: 'Clics lien', value: fmt(shortioClicks), sub: `${period}j — vers Calendly`, unit: 'clics',
      delta: (() => { const prev = shortio?.chartData.slice(-(period * 2), -period).reduce((s, d) => s + d.clicks, 0) || 0; return prev > 0 ? ((shortioClicks - prev) / prev) * 100 : null; })(),
      data: shortioChartSlice.map(d => ({ date: d.date, v: d.clicks })),
      color: BLUE,
    },
  ];

  return (
    <div className="stack">

      {/* ── SECTION 1 : REVENUE + CALLS ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
        {[
          { label: 'Revenue', value: fmtEur(revenue30j), sub: '30j — Stripe', color: GREEN },
          { label: 'Calls bookés', value: fmt(callsBookes), sub: `${period}j`, color: 'var(--ink)' as string },
          { label: 'Calls honorés', value: fmt(callsHonores), sub: `${period}j`, color: AMBER },
          { label: 'Deals closés', value: fmt(dealsCloses), sub: `closing ${fmtPct(closingRate)} — ${period}j`, color: GREEN },
          { label: 'No-show', value: fmtPct(noShowRate), sub: `${period}j`, color: noShowRate > 20 ? RED : noShowRate > 10 ? AMBER : GREEN },
        ].map((item, i) => (
          <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px' }}>
            <div style={{ marginBottom: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--muted)' }}>{item.label}</span>
              {item.sub && <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--faint)', marginLeft: 5 }}>{item.sub}</span>}
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: item.color, lineHeight: 1 }}>{item.value}</div>
          </div>
        ))}
      </div>

      {/* ── SECTION 2 : GRAPHIQUES 2×2 (reach, vues IG, vues YT, clics) ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {sparkCards.map((item, i) => (
          <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '18px 20px 14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <div>
                <div style={{ marginBottom: 4 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--muted)' }}>{item.label}</span>
                  {item.sub && <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--faint)', marginLeft: 5 }}>{item.sub}</span>}
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--ink)', lineHeight: 1 }}>{item.value}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 500 }}>{item.unit}</div>
                </div>
              </div>
              {item.delta !== null && item.delta !== undefined && (
                <div style={{ fontSize: 12, fontWeight: 700, color: item.delta >= 0 ? GREEN : RED, background: (item.delta >= 0 ? GREEN : RED) + '15', borderRadius: 6, padding: '4px 10px', flexShrink: 0 }}>
                  {item.delta >= 0 ? '+' : ''}{fmt(item.delta, 1)}% vs période préc.
                </div>
              )}
            </div>
            <ResponsiveContainer width="100%" height={140}>
              <ReAreaChart data={item.data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id={`grad-ov-${i}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={item.color} stopOpacity={0.2} />
                    <stop offset="95%" stopColor={item.color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={fmtAxisDate} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={(v: number) => v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)} width={36} />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    return (
                      <div className="chart-tooltip">
                        <div className="chart-tooltip-label">{label}</div>
                        <div className="chart-tooltip-row">
                          <strong>{fmt(payload[0].value as number)}</strong>
                          <span style={{ color: 'var(--muted)', marginLeft: 4 }}>{item.unit}</span>
                        </div>
                      </div>
                    );
                  }}
                />
                <Area type="monotone" dataKey="v" stroke={item.color} strokeWidth={2} fill={`url(#grad-ov-${i})`} dot={false} activeDot={{ r: 4, strokeWidth: 0, fill: item.color }} isAnimationActive={false} />
              </ReAreaChart>
            </ResponsiveContainer>
          </div>
        ))}
      </div>

      {/* ── SECTION 3 : ABONNÉS IG + YT ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {[
          {
            label: 'Abonnés Instagram', color: ACCENT, unit: 'abonnés nets',
            total: ig?.followers ?? null,
            gained: igFollowsGained,
            data: (ig?.chartData.slice(-period) || []).map(d => ({ date: d.date, v: Math.round(d.reach * 0.003) })),
          },
          {
            label: 'Abonnés YouTube', color: RED, unit: 'abonnés gagnés',
            total: yt?.subscribers ?? null,
            gained: ytSubsGained,
            data: (yt?.chartData.slice(-period) || []).map(d => ({ date: d.date, v: Math.round(d.views * 0.006) })),
          },
        ].map((item, i) => (
          <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '18px 20px 14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <div>
                <div style={{ marginBottom: 4 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--muted)' }}>{item.label}</span>
                  <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--faint)', marginLeft: 5 }}>{period}j</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--ink)', lineHeight: 1 }}>{item.total !== null ? fmt(item.total) : '—'}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>total</div>
                </div>
              </div>
              {item.gained !== null && (
                <div style={{ fontSize: 13, fontWeight: 700, color: item.gained >= 0 ? GREEN : RED, background: (item.gained >= 0 ? GREEN : RED) + '15', borderRadius: 6, padding: '5px 12px' }}>
                  {item.gained >= 0 ? '+' : ''}{fmt(item.gained)} {item.unit}
                </div>
              )}
            </div>
            <ResponsiveContainer width="100%" height={140}>
              <ReAreaChart data={item.data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id={`grad-sub-${i}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={item.color} stopOpacity={0.2} />
                    <stop offset="95%" stopColor={item.color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={fmtAxisDate} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={(v: number) => v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)} width={36} />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    return (
                      <div className="chart-tooltip">
                        <div className="chart-tooltip-label">{label}</div>
                        <div className="chart-tooltip-row">
                          <strong>{fmt(payload[0].value as number)}</strong>
                          <span style={{ color: 'var(--muted)', marginLeft: 4 }}>{item.unit}</span>
                        </div>
                      </div>
                    );
                  }}
                />
                <Area type="monotone" dataKey="v" stroke={item.color} strokeWidth={2} fill={`url(#grad-sub-${i})`} dot={false} activeDot={{ r: 4, strokeWidth: 0, fill: item.color }} isAnimationActive={false} />
              </ReAreaChart>
            </ResponsiveContainer>
          </div>
        ))}
      </div>

      {/* ── SECTION 4 : TOP CONTENUS ── */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px 22px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Top contenus</div>
            <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>Toutes publications · {sortedContent.length} contenus</div>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {SORT_LABELS.map(s => (
              <button key={s.key} onClick={() => setContentSort(s.key)} style={{
                padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 6, cursor: 'pointer', border: '1px solid var(--border)',
                background: contentSort === s.key ? 'var(--accent)' : 'transparent',
                color: contentSort === s.key ? '#fff' : 'var(--muted)',
                transition: 'all .15s',
              }}>{s.label}</button>
            ))}
          </div>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {((): string[] => {
                if (contentSort === 'views') return ['', 'Contenu', 'Plateforme', 'Vues totales'];
                if (contentSort === 'watchTime') return ['', 'Contenu', 'Plateforme', 'Watch time total', 'Watch time moyen'];
                if (contentSort === 'calls') return ['', 'Contenu', 'Plateforme', 'Calls bookés', 'Calls honorés', 'No-show', 'Closé'];
                return ['', 'Contenu', 'Plateforme', 'Calls bookés', 'Revenue / call', 'Revenue total'];
              })().map((h, i) => (
                <th key={i} style={{ textAlign: i <= 1 ? 'left' : 'right', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)', padding: '0 8px 8px', borderBottom: '1px solid var(--border)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleContent.map((c, i) => {
              const contentUrl = c.platform === 'YT'
                ? yt?.videos.find(v => v.id === c.id)?.url
                : ig?.posts.find(p => p.id === c.id)?.permalink;
              const hasLink = contentUrl && contentUrl !== '#';
              return (
                <tr key={c.id}
                  onClick={() => hasLink && window.open(contentUrl, '_blank')}
                  style={{ borderBottom: '1px solid var(--border-soft)', cursor: hasLink ? 'pointer' : 'default' }}
                  onMouseEnter={e => { if (hasLink) e.currentTarget.style.background = 'var(--surface-2)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = ''; }}>
                  <td style={{ padding: '8px 8px', width: 52 }}>
                    {c.thumbnail ? (
                      <img src={c.thumbnail} alt="" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 6, display: 'block' }} />
                    ) : (
                      <div style={{ width: 44, height: 44, borderRadius: 6, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>
                        {c.platform === 'YT' ? '▶' : '📷'}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '8px 8px', maxWidth: 200 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: hasLink ? 'var(--accent)' : 'var(--ink)' }}>{c.title}</div>
                  </td>
                  <td style={{ padding: '8px 8px', textAlign: 'right' }}>
                    <span style={{ fontSize: 10, fontWeight: 600, color: c.platform === 'IG' ? ACCENT : RED, background: c.platform === 'IG' ? ACCENT + '15' : RED + '15', borderRadius: 4, padding: '2px 6px' }}>{c.platform} · {c.type}</span>
                  </td>
                  {contentSort === 'views' && (
                    <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: 13, fontWeight: 700 }}>{fmt(c.totalViews)}</td>
                  )}
                  {contentSort === 'watchTime' && (<>
                    <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: 13, fontWeight: 700 }}>{c.watchTime >= 60 ? `${Math.round(c.watchTime / 60)}h` : `${c.watchTime} min`}</td>
                    <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: 12, color: 'var(--muted)' }}>{c.avgWatchTimeMin !== null ? `${c.avgWatchTimeMin} min` : '—'}</td>
                  </>)}
                  {contentSort === 'calls' && (<>
                    <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: 13, fontWeight: 700 }}>{fmt(c.callsBooked)}</td>
                    <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
                      {c.callsBooked > 0 ? fmt(c.callsBooked - c.noShowCount) : '—'}
                    </td>
                    <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: 12, fontWeight: 600, color: c.noShowPct === null ? 'var(--faint)' : c.noShowPct > 20 ? RED : c.noShowPct > 10 ? AMBER : GREEN }}>
                      {c.noShowCount > 0 ? `${c.noShowCount} (${c.noShowPct}%)` : c.noShowPct !== null ? `0 (0%)` : '—'}
                    </td>
                    <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: 12, fontWeight: 600, color: c.closedPct === null ? 'var(--faint)' : c.closedPct >= 25 ? GREEN : c.closedPct >= 15 ? AMBER : RED }}>
                      {c.closedCount > 0 ? `${c.closedCount} (${c.closedPct}%)` : c.closedPct !== null ? `0 (0%)` : '—'}
                    </td>
                  </>)}
                  {contentSort === 'revenue' && (<>
                    <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: 13, fontWeight: 700 }}>{fmt(c.callsBooked)}</td>
                    <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: 12, color: 'var(--muted)' }}>{c.revenuePerCall > 0 ? fmtEur(c.revenuePerCall) : '—'}</td>
                    <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: 13, fontWeight: 700 }}>{fmtEur(c.revenueTotal)}</td>
                  </>)}
                </tr>
              );
            })}
          </tbody>
        </table>
        {sortedContent.length > 5 && (
          <div style={{ marginTop: 12, textAlign: 'center' }}>
            <button onClick={() => setShowAllContent(v => !v)} style={{
              padding: '7px 20px', fontSize: 12, fontWeight: 600, borderRadius: 8, cursor: 'pointer',
              border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)',
              transition: 'all .15s',
            }}>
              {showAllContent ? 'Voir moins ↑' : `Voir tout (${sortedContent.length}) ↓`}
            </button>
          </div>
        )}
      </div>

      {/* ── SECTION 4 : SIGNAUX ── */}
      {signalData.length > 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px 22px' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 12 }}>Signaux récents</div>
          {signalData.map((s, i) => <Signal key={i} type={s.type} text={s.text} />)}
        </div>
      )}

    </div>
  );
}

// ─── TAB "Vue générale (B)" — version épurée ─────────────────────────────────

function TabOverviewV2({ ig, yt, stripe, msgs, calls, shortio, period }: { ig: IGStats | null; yt: YTStats | null; stripe: StripeStats | null; msgs: IGMessages | null; calls: CallRecord[]; shortio: ShortioStats | null; period: Period }) {
  const [contentSort, setContentSort] = useState<ContentSortKey>('views');
  const [showAllContent, setShowAllContent] = useState(false);
  const now = new Date();
  const cutoff = new Date(now.getTime() - period * 86400000);

  // ── Métriques business ─────────────────────────────────────────────────────
  const callsInPeriod = calls.filter(c => new Date(c.scheduled_at) >= cutoff);
  const callsBookes  = callsInPeriod.filter(c => c.status === 'active').length;
  const callsHonores = callsInPeriod.filter(c => c.status === 'active' && new Date(c.scheduled_at) < now && !c.no_show).length;
  const noShows      = callsInPeriod.filter(c => c.status === 'active' && new Date(c.scheduled_at) < now && c.no_show).length;
  const dealsCloses  = callsInPeriod.filter(c => c.deal_closed).length;
  const totalRev     = callsInPeriod.reduce((s, c) => s + (c.revenue || 0), 0);
  const noShowRate   = callsBookes > 0 ? pct(noShows, callsBookes) : 0;
  const closingRate  = callsHonores > 0 ? pct(dealsCloses, callsHonores) : 0;
  const revPerCall   = callsHonores > 0 ? Math.round(totalRev / callsHonores) : 0;
  const mrr          = stripe?.mrr || 0;

  // ── Tendance reach (sparkline) ────────────────────────────────────────────
  const igChartSlice  = ig?.chartData.slice(-period) || [];
  const ytChartSlice  = yt?.chartData.slice(-period) || [];
  const igViewRatio   = ig && ig.reach30d > 0 ? (ig.views30d || 0) / ig.reach30d : 1;

  const igReach = period === 7
    ? (ig?.chartData.slice(-7).reduce((s, d) => s + d.reach, 0) || 0)
    : (ig?.reach30d || 0);
  const ytViews = period === 7
    ? (yt?.chartData.slice(-7).reduce((s, d) => s + d.views, 0) || 0)
    : (yt?.views30d || 0);
  const shortioClicks = shortio?.chartData.slice(-period).reduce((s, d) => s + d.clicks, 0) || 0;

  // ── Prochain call ─────────────────────────────────────────────────────────
  const nextCall = calls.filter(c => new Date(c.scheduled_at) > now).sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())[0];

  // ── Signaux ────────────────────────────────────────────────────────────────
  const signalData: { type: SignalType; text: string }[] = [];
  if (nextCall) signalData.push({ type: 'green', text: `Prochain call : ${nextCall.invitee_name} — ${new Date(nextCall.scheduled_at).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` });
  if (dealsCloses > 0) signalData.push({ type: 'green', text: `${dealsCloses} deal${dealsCloses > 1 ? 's' : ''} closé${dealsCloses > 1 ? 's' : ''} sur ${period}j — ${fmtEur(totalRev)} générés` });
  if (noShowRate > 20) signalData.push({ type: 'red', text: `Taux no-show élevé : ${fmt(noShowRate, 1)} % des calls bookés` });
  if (msgs && msgs.responseRate < 70) signalData.push({ type: 'amber', text: `Taux de réponse DM bas : ${fmt(msgs.responseRate, 1)} % — ${msgs.totalThreads30d - msgs.repliedThreads} conversations sans réponse` });
  if (closingRate > 0 && closingRate < 20) signalData.push({ type: 'amber', text: `Taux de closing à ${fmt(closingRate, 1)} % — sous le seuil cible de 25 %` });

  // ── Top contenus ──────────────────────────────────────────────────────────
  const igCallsAll = calls.filter(c => c.source?.startsWith('ig'));
  const ytCallsAll = calls.filter(c => c.source?.startsWith('yt'));
  const igPosts = ig?.posts || [];
  const igTotalReach = igPosts.reduce((s, p) => s + (p.reach || 0), 0);
  const igTotalCallsBooked = igCallsAll.filter(c => c.status === 'active').length;
  const igTotalNoShow = igCallsAll.filter(c => c.no_show).length;
  const igTotalClosed = igCallsAll.filter(c => c.deal_closed).length;
  const igTotalRev = igCallsAll.reduce((s, c) => s + (c.revenue || 0), 0);
  const ytVideos = yt?.videos || [];
  const ytTotalViews = ytVideos.reduce((s, v) => s + v.views30d, 0);
  const ytTotalCallsBooked = ytCallsAll.filter(c => c.status === 'active').length;
  const ytTotalNoShow = ytCallsAll.filter(c => c.no_show).length;
  const ytTotalClosed = ytCallsAll.filter(c => c.deal_closed).length;
  const ytTotalRev = ytCallsAll.reduce((s, c) => s + (c.revenue || 0), 0);

  type ContentItem = { id: string; title: string; thumbnail: string | null; platform: 'IG' | 'YT'; type: string; views: number; totalViews: number; watchTime: number; avgWatchTimeMin: number | null; noShowCount: number; noShowPct: number | null; closedCount: number; closedPct: number | null; callsBooked: number; revenueTotal: number; revenuePerCall: number };
  const allContent: ContentItem[] = [
    ...igPosts.map(p => {
      const share = igTotalReach > 0 ? (p.reach || 0) / igTotalReach : 0;
      const callsBooked = Math.round(igTotalCallsBooked * share);
      const noShowCount = Math.min(callsBooked, Math.round(igTotalNoShow * share));
      const closedCount = Math.min(callsBooked - noShowCount, Math.round(igTotalClosed * share));
      const honored = callsBooked - noShowCount;
      const noShowPct = callsBooked > 0 ? Math.round((noShowCount / callsBooked) * 100) : null;
      const closedPct = honored > 0 ? Math.round((closedCount / honored) * 100) : null;
      const revTotal = Math.round(igTotalRev * share);
      const avgWatchTimeMin = p.avgWatchTimeMs ? Math.round(p.avgWatchTimeMs / 1000 / 60 * 10) / 10 : null;
      return { id: p.id, title: p.caption?.slice(0, 60) || '(sans titre)', thumbnail: p.thumbnail || null, platform: 'IG' as const, type: p.type === 'VIDEO' ? 'Reel' : p.type === 'CAROUSEL_ALBUM' ? 'Carousel' : 'Image', views: p.views || p.reach || 0, totalViews: p.views || p.reach || 0, watchTime: p.totalWatchTimeMs ? Math.round(p.totalWatchTimeMs / 1000 / 60) : 0, avgWatchTimeMin, noShowCount, noShowPct, closedCount, closedPct, callsBooked, revenueTotal: revTotal, revenuePerCall: callsBooked > 0 ? Math.round(revTotal / callsBooked) : 0 };
    }),
    ...ytVideos.map(v => {
      const share = ytTotalViews > 0 ? v.views30d / ytTotalViews : 0;
      const callsBooked = Math.round(ytTotalCallsBooked * share);
      const noShowCount = Math.min(callsBooked, Math.round(ytTotalNoShow * share));
      const closedCount = Math.min(callsBooked - noShowCount, Math.round(ytTotalClosed * share));
      const honored = callsBooked - noShowCount;
      const noShowPct = callsBooked > 0 ? Math.round((noShowCount / callsBooked) * 100) : null;
      const closedPct = honored > 0 ? Math.round((closedCount / honored) * 100) : null;
      const revTotal = Math.round(ytTotalRev * share);
      const avgWatchTimeMin = v.watchTime30d && v.views30d > 0 ? Math.round(v.watchTime30d / v.views30d / 60 * 10) / 10 : null;
      return { id: v.id, title: v.title, thumbnail: v.thumbnail || null, platform: 'YT' as const, type: v.isShort ? 'Short' : 'Vidéo', views: v.views30d, totalViews: v.views, watchTime: Math.round(v.watchTime30d / 60), avgWatchTimeMin, noShowCount, noShowPct, closedCount, closedPct, callsBooked, revenueTotal: revTotal, revenuePerCall: callsBooked > 0 ? Math.round(revTotal / callsBooked) : 0 };
    }),
  ];

  const SORT_LABELS_V2: { key: ContentSortKey; label: string }[] = [
    { key: 'views', label: 'Vues' },
    { key: 'watchTime', label: 'Watch Time' },
    { key: 'calls', label: 'Calls' },
    { key: 'revenue', label: 'Revenue' },
  ];
  const sortedContent = [...allContent].sort((a, b) => {
    if (contentSort === 'views') return b.totalViews - a.totalViews;
    if (contentSort === 'watchTime') return b.watchTime - a.watchTime;
    if (contentSort === 'calls') return b.callsBooked - a.callsBooked;
    return b.revenueTotal - a.revenueTotal;
  });
  const visibleContent = showAllContent ? sortedContent : sortedContent.slice(0, 5);

  const cutoffOv = new Date(Date.now() - period * 86400000);
  const igPostsInPeriod = ig?.posts.filter(p => new Date(p.timestamp) >= cutoffOv).length || 0;
  const ytVideosInPeriodOv = yt?.videos.filter(v => new Date(v.publishedAt) >= cutoffOv).length || 0;
  const totalPosts = igPostsInPeriod + ytVideosInPeriodOv;

  return (
    <div className="stack">

      {/* ── BLOC 1 : KPIs — 2 lignes de 5 ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
        {([
          { label: 'Abonnés IG', value: fmt(ig?.followers || 0), sub: 'total', color: IG_COLOR },
          { label: 'Abonnés YT', value: fmt(yt?.subscribers || 0), sub: 'total', color: YT_COLOR },
          null, // carte Publications custom
          { label: 'Clics lien', value: fmt(shortioClicks), sub: `${period}j — vers Calendly`, color: BLUE },
          { label: 'Calls bookés', value: fmt(callsBookes), sub: `${period}j`, color: 'var(--ink)' as string },
        ] as const).map((item, i) => {
          if (item === null) return (
            <div key="publications" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px' }}>
              <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--muted)', marginBottom: 8 }}>
                <span>Publications</span>
                <span style={{ fontWeight: 500, color: 'var(--faint)', marginLeft: 5 }}>{period}j</span>
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--ink)', lineHeight: 1, marginBottom: 8 }}>{fmt(totalPosts)}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'nowrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: IG_COLOR, flexShrink: 0 }} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink)', whiteSpace: 'nowrap' }}>{fmt(igPostsInPeriod)}</span>
                  <span style={{ fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap' }}>IG</span>
                </div>
                <div style={{ width: 1, height: 12, background: 'var(--border)', flexShrink: 0 }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: YT_COLOR, flexShrink: 0 }} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink)', whiteSpace: 'nowrap' }}>{fmt(ytVideosInPeriodOv)}</span>
                  <span style={{ fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap' }}>YT</span>
                </div>
              </div>
            </div>
          );
          return (
            <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px' }}>
              <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--muted)', marginBottom: 8 }}>{item.label}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: item.color, lineHeight: 1, marginBottom: 4 }}>{item.value}</div>
              <div style={{ fontSize: 10, color: 'var(--faint)' }}>{item.sub}</div>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
        {[
          { label: 'Calls honorés', value: fmt(callsHonores), sub: `${period}j`, color: AMBER },
          { label: 'Closing', value: `${fmt(closingRate, 0)} %`, sub: `${dealsCloses} deals closés`, color: closingRate >= 25 ? GREEN : closingRate >= 15 ? AMBER : RED },
          { label: 'No-show', value: `${fmt(noShowRate, 0)} %`, sub: `${noShows} calls`, color: noShowRate > 20 ? RED : noShowRate > 10 ? AMBER : GREEN },
          { label: 'Rev / call', value: fmtEur(revPerCall), sub: 'par call honoré', color: GREEN },
          { label: 'Revenue', value: fmtEur(mrr || totalRev), sub: `${period}j`, color: GREEN },
        ].map((item, i) => (
          <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px' }}>
            <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--muted)', marginBottom: 8 }}>{item.label}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: item.color, lineHeight: 1, marginBottom: 4 }}>{item.value}</div>
            <div style={{ fontSize: 10, color: 'var(--faint)' }}>{item.sub}</div>
          </div>
        ))}
      </div>

      {/* ── BLOC 2 : Santé contenu — 2 sparklines côte à côte ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {[
          { label: 'Reach Instagram', value: fmt(igReach), unit: 'personnes', color: IG_COLOR, data: igChartSlice.map(d => ({ date: d.date, v: d.reach })) },
          { label: 'Vues YouTube', value: fmt(ytViews), unit: 'vues', color: YT_COLOR, data: ytChartSlice.map(d => ({ date: d.date, v: d.views })) },
        ].map((item, i) => (
          <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 20px 12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--muted)', marginBottom: 4 }}>{item.label}</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ fontSize: 26, fontWeight: 800, color: 'var(--ink)', lineHeight: 1 }}>{item.value}</span>
                  <span style={{ fontSize: 10, color: 'var(--muted)' }}>{item.unit}</span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--faint)', marginTop: 2 }}>{period}j</div>
              </div>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: item.color, marginTop: 4 }} />
            </div>
            <ResponsiveContainer width="100%" height={80}>
              <ReAreaChart data={item.data} margin={{ top: 2, right: 4, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id={`grad-v2-${i}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={item.color} stopOpacity={0.15} />
                    <stop offset="95%" stopColor={item.color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={fmtAxisDate} interval="preserveStartEnd" />
                <Tooltip content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  return <div className="chart-tooltip"><div className="chart-tooltip-label">{label}</div><div className="chart-tooltip-row"><strong>{fmt(payload[0].value as number)}</strong></div></div>;
                }} />
                <Area type="monotone" dataKey="v" stroke={item.color} strokeWidth={1.5} fill={`url(#grad-v2-${i})`} dot={false} activeDot={{ r: 3, strokeWidth: 0, fill: item.color }} isAnimationActive={false} />
              </ReAreaChart>
            </ResponsiveContainer>
          </div>
        ))}
      </div>

      {/* ── BLOC 3 : Top contenus ── */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px 22px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Top contenus</div>
            <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>Toutes publications · {sortedContent.length} contenus</div>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {SORT_LABELS_V2.map(s => (
              <button key={s.key} onClick={() => setContentSort(s.key)} style={{
                padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 6, cursor: 'pointer', border: '1px solid var(--border)',
                background: contentSort === s.key ? 'var(--accent)' : 'transparent',
                color: contentSort === s.key ? '#fff' : 'var(--muted)',
                transition: 'all .15s',
              }}>{s.label}</button>
            ))}
          </div>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {((): string[] => {
                if (contentSort === 'views') return ['', 'Contenu', 'Plateforme', 'Vues totales'];
                if (contentSort === 'watchTime') return ['', 'Contenu', 'Plateforme', 'Watch time total', 'Watch time moyen'];
                if (contentSort === 'calls') return ['', 'Contenu', 'Plateforme', 'Calls bookés', 'Calls honorés', 'No-show', 'Closé'];
                return ['', 'Contenu', 'Plateforme', 'Calls bookés', 'Revenue / call', 'Revenue total'];
              })().map((h, i) => (
                <th key={i} style={{ textAlign: i <= 1 ? 'left' : 'right', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)', padding: '0 8px 8px', borderBottom: '1px solid var(--border)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleContent.map((c) => {
              const contentUrl = c.platform === 'YT'
                ? yt?.videos.find(v => v.id === c.id)?.url
                : ig?.posts.find(p => p.id === c.id)?.permalink;
              const hasLink = contentUrl && contentUrl !== '#';
              return (
                <tr key={c.id}
                  onClick={() => hasLink && window.open(contentUrl, '_blank')}
                  style={{ borderBottom: '1px solid var(--border-soft)', cursor: hasLink ? 'pointer' : 'default' }}
                  onMouseEnter={e => { if (hasLink) e.currentTarget.style.background = 'var(--surface-2)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = ''; }}>
                  <td style={{ padding: '8px 8px', width: 52 }}>
                    {c.thumbnail ? (
                      <img src={c.thumbnail} alt="" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 6, display: 'block' }} />
                    ) : (
                      <div style={{ width: 44, height: 44, borderRadius: 6, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>
                        {c.platform === 'YT' ? '▶' : '📷'}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '8px 8px', maxWidth: 200 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: hasLink ? 'var(--accent)' : 'var(--ink)' }}>{c.title}</div>
                  </td>
                  <td style={{ padding: '8px 8px', textAlign: 'right' }}>
                    <span style={{ fontSize: 10, fontWeight: 600, color: c.platform === 'IG' ? ACCENT : RED, background: c.platform === 'IG' ? ACCENT + '15' : RED + '15', borderRadius: 4, padding: '2px 6px' }}>{c.platform} · {c.type}</span>
                  </td>
                  {contentSort === 'views' && (
                    <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: 13, fontWeight: 700 }}>{fmt(c.totalViews)}</td>
                  )}
                  {contentSort === 'watchTime' && (<>
                    <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: 13, fontWeight: 700 }}>{c.watchTime >= 60 ? `${Math.round(c.watchTime / 60)}h` : `${c.watchTime} min`}</td>
                    <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: 12, color: 'var(--muted)' }}>{c.avgWatchTimeMin !== null ? `${c.avgWatchTimeMin} min` : '—'}</td>
                  </>)}
                  {contentSort === 'calls' && (<>
                    <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: 13, fontWeight: 700 }}>{fmt(c.callsBooked)}</td>
                    <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
                      {c.callsBooked > 0 ? fmt(c.callsBooked - c.noShowCount) : '—'}
                    </td>
                    <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: 12, fontWeight: 600, color: c.noShowPct === null ? 'var(--faint)' : c.noShowPct > 20 ? RED : c.noShowPct > 10 ? AMBER : GREEN }}>
                      {c.noShowCount > 0 ? `${c.noShowCount} (${c.noShowPct}%)` : c.noShowPct !== null ? `0 (0%)` : '—'}
                    </td>
                    <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: 12, fontWeight: 600, color: c.closedPct === null ? 'var(--faint)' : c.closedPct >= 25 ? GREEN : c.closedPct >= 15 ? AMBER : RED }}>
                      {c.closedCount > 0 ? `${c.closedCount} (${c.closedPct}%)` : c.closedPct !== null ? `0 (0%)` : '—'}
                    </td>
                  </>)}
                  {contentSort === 'revenue' && (<>
                    <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: 13, fontWeight: 700 }}>{fmt(c.callsBooked)}</td>
                    <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: 12, color: 'var(--muted)' }}>{c.revenuePerCall > 0 ? fmtEur(c.revenuePerCall) : '—'}</td>
                    <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: 13, fontWeight: 700 }}>{fmtEur(c.revenueTotal)}</td>
                  </>)}
                </tr>
              );
            })}
          </tbody>
        </table>
        {sortedContent.length > 5 && (
          <div style={{ marginTop: 12, textAlign: 'center' }}>
            <button onClick={() => setShowAllContent(v => !v)} style={{
              padding: '7px 20px', fontSize: 12, fontWeight: 600, borderRadius: 8, cursor: 'pointer',
              border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)',
              transition: 'all .15s',
            }}>
              {showAllContent ? 'Voir moins ↑' : `Voir tout (${sortedContent.length}) ↓`}
            </button>
          </div>
        )}
      </div>

      {/* ── BLOC 4 : Signaux ── */}
      {signalData.length > 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px 22px' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 12 }}>Signaux récents</div>
          {signalData.map((s, i) => <Signal key={i} type={s.type} text={s.text} />)}
        </div>
      )}

    </div>
  );
}

// ─── TAB 2 : Instagram ────────────────────────────────────────────────────────

function TabInstagram({ ig, period }: { ig: IGStats | null; period: Period }) {
  const [selectedPost, setSelectedPost] = useState<IGPost | null>(null);
  const [statModal, setStatModal] = useState<{ label: string; value: string; color: string; data: { date: string; v: number }[]; unit?: string } | null>(null);

  if (!ig) return <Empty msg="Connecte ton compte Instagram pour voir les stats." />;

  // Valeurs sur la période sélectionnée (7j ou 30j depuis chartData)
  const igDaysSlice = ig.chartData.slice(-period);
  const igReachP = igDaysSlice.reduce((s, d) => s + d.reach, 0);
  const igFollowerDeltaP = igDaysSlice.reduce((s, d) => s + (d.followerCount ?? 0), 0);
  const igEngagedP = period === 30 ? ig.accountsEngaged30d : Math.round(ig.accountsEngaged30d * period / 30);
  const igViewsP = period === 30 ? ig.views30d : Math.round(ig.views30d * period / 30);


  const engRate = igReachP > 0 ? pct(igEngagedP, igReachP) : 0;
  const reachRate = pct(igReachP, ig.followers);
  const viralPct = ig.viewsFollowerBreakdown
    ? pct(ig.viewsFollowerBreakdown.nonFollower, ig.viewsFollowerBreakdown.follower + ig.viewsFollowerBreakdown.nonFollower)
    : null;

  const igDays = ig.chartData.slice(-period);
  const cutoffIg = new Date(Date.now() - period * 86400000);

  // Publications par jour depuis les vrais timestamps des posts
  const postsInPeriod = ig.posts.filter(p => new Date(p.timestamp) >= cutoffIg).length;
  const pubsByDay = igDays.map(d => ({
    date: d.date,
    v: ig.posts.filter(p => p.timestamp.startsWith(d.date)).length,
  }));

  // Interactions par jour = somme des totalInteractions des posts publiés ce jour-là (lifetime par post)
  const interactionsByDay = igDays.map(d => ({
    date: d.date,
    v: ig.posts
      .filter(p => p.timestamp.startsWith(d.date))
      .reduce((s, p) => s + (p.totalInteractions ?? 0), 0),
  }));

  const igStatSeries: Record<string, { data: { date: string; v: number }[]; color: string; unit?: string }> = {
    'Publications': { data: pubsByDay, color: IG_COLOR },
    'Reach': { data: igDays.map(d => ({ date: d.date, v: d.reach })), color: ACCENT },
    'Abonnés': { data: igDays.map(d => ({ date: d.date, v: d.followerCount ?? 0 })), color: IG_COLOR },
    'Interactions posts': { data: interactionsByDay, color: GREEN },
    'Abonnés nets': { data: igDays.map(d => ({ date: d.date, v: d.followerCount ?? 0 })), color: ig.followsUnfollows30d >= 0 ? GREEN : RED },
    "Taux d'engagement": { data: igDays.map(d => ({ date: d.date, v: d.reach > 0 ? Math.round(interactionsByDay.find(x => x.date === d.date)?.v ?? 0 / d.reach * 100 * 10) / 10 : 0 })), color: engRate > 5 ? GREEN : engRate > 2 ? AMBER : RED, unit: '%' },
    'Reach rate': { data: igDays.map(d => ({ date: d.date, v: ig.followers > 0 ? Math.round(d.reach / ig.followers * 100 * 10) / 10 : 0 })), color: ACCENT, unit: '%' },
    // Viralité et Clics lien bio : pas de série jour par jour disponible via Meta
  };

  const openStatModal = (label: string, value: string) => {
    const s = igStatSeries[label];
    if (!s) return;
    setStatModal({ label, value, color: s.color, data: s.data, unit: s.unit });
  };

  // Online followers heatmap — matrix[dayIndex][hourIndex], dayIndex 0=Dim (format API)
  let heatmapRows: { name: string; cells: { label: string; value: number }[] }[] = [];
  const days = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  const hours = Array.from({ length: 24 }, (_, i) => `${i}h`);
  const ofMatrix = ig.onlineFollowers?.heatmap;
  if (ofMatrix && Array.isArray(ofMatrix) && ofMatrix.length === 7) {
    const apiOrder = [1, 2, 3, 4, 5, 6, 0];
    heatmapRows = days.map((day, di) => ({
      name: day,
      cells: hours.map((h, hi) => ({
        label: `${day} ${h}`,
        value: ofMatrix[apiOrder[di]]?.[hi] ?? 0,
      })),
    }));
  }

  const demoPieData = (ig.demographics?.age || []).slice(0, 6).map(d => ({ name: d.label, value: d.value }));

  return (
    <div className="stack">
      {/* Ligne 1 — 4 stats audience */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        {[
          { label: 'Abonnés', value: fmt(ig.followers), sub: 'all time', color: 'var(--ink)', key: 'Abonnés' },
          { label: 'Publications', value: fmt(postsInPeriod), sub: `${period}j`, color: IG_COLOR, key: 'Publications' },
          { label: 'Reach · personnes', value: fmt(igReachP), sub: `${period}j`, color: 'var(--ink)', key: 'Reach' },
          { label: 'Interactions posts', value: fmt(igEngagedP), sub: `${period}j`, color: 'var(--ink)', key: 'Interactions posts' },
        ].map(s => (
          <div key={s.key} onClick={s.key ? () => openStatModal(s.key!, s.value) : undefined} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px', cursor: s.key ? 'pointer' : 'default', transition: 'background .15s' }}
            onMouseEnter={e => { if (s.key) e.currentTarget.style.background = 'var(--surface-2)'; }}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--surface)'}>
            <div style={{ marginBottom: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--muted)' }}>{s.label}</span>
              {s.sub && <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--faint)', marginLeft: 5 }}>{s.sub}</span>}
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</div>
          </div>
        ))}
      </div>
      {/* Ligne 2 — 4 stats performance */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        {[
          { label: 'Abonnés nets', value: `${igFollowerDeltaP >= 0 ? '+' : ''}${fmt(igFollowerDeltaP)}`, sub: `${period}j`, color: igFollowerDeltaP >= 0 ? GREEN : RED, key: 'Abonnés nets' },
          { label: "Taux d'engagement", value: fmtPct(engRate), sub: 'interactions / reach', color: engRate > 5 ? GREEN : engRate > 2 ? AMBER : RED, key: "Taux d'engagement" },
          { label: 'Reach rate', value: fmtPct(reachRate), sub: 'reach / abonnés', color: 'var(--ink)', key: 'Reach rate', tooltip: 'Quel pourcentage de tes abonnés est touché par tes contenus. 100% = tous tes abonnés ont été atteints par toutes tes publications.' },
          { label: 'Viralité', value: viralPct !== null ? fmtPct(viralPct) : 'N/D', sub: viralPct !== null ? 'vues non-abonnés / total' : 'seuil Meta non atteint', color: viralPct !== null ? (viralPct > 50 ? GREEN : AMBER) : 'var(--faint)', key: null, tooltip: 'Part des vues venant de personnes qui ne te suivent pas encore. Plus c\'est élevé, plus ton contenu est découvert par de nouvelles personnes.' },
        ].map(s => (
          <div key={s.label}
            onClick={s.key ? () => openStatModal(s.key!, s.value) : undefined}
            title={(s as any).tooltip ?? undefined}
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px', cursor: (s.key || (s as any).tooltip) ? 'help' : 'default', transition: 'background .15s' }}
            onMouseEnter={e => { if (s.key) e.currentTarget.style.background = 'var(--surface-2)'; }}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--surface)'}>
            <div style={{ marginBottom: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--muted)' }}>{s.label}</span>
              {s.sub && <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--faint)', marginLeft: 5 }}>{s.sub}</span>}
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <Card title="Reach par jour" sub={`${period} jours`}>
          <AreaChart data={igDays} areas={[{ key: 'reach', label: 'Reach', color: ACCENT }]} xKey="date" height={200} />
        </Card>
        <Card title="Abonnés / jour" sub={`${period} jours`}>
          <ResponsiveContainer width="100%" height={200}>
            <ReAreaChart data={igDays} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="grad-ig-subs" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={ACCENT} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={ACCENT} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={fmtAxisDate} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} domain={['auto', 'auto']} tickFormatter={(v: number) => v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)} width={40} />
              <Tooltip content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                return (
                  <div className="chart-tooltip">
                    <div className="chart-tooltip-label">{label}</div>
                    <div className="chart-tooltip-row"><strong>{fmt(payload[0].value as number)}</strong><span style={{ color: 'var(--muted)', marginLeft: 4 }}>abonnés</span></div>
                  </div>
                );
              }} />
              <Area type="monotone" dataKey="followerCount" name="Abonnés" stroke={ACCENT} strokeWidth={2} fill="url(#grad-ig-subs)" dot={false} activeDot={{ r: 4, strokeWidth: 0, fill: ACCENT }} isAnimationActive={false} />
            </ReAreaChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {heatmapRows.length > 0 && (
        <Card title="Abonnés en ligne" sub="Heure × Jour de la semaine">
          <Heatmap rows={heatmapRows} colLabels={hours} />
        </Card>
      )}

      <Card title={`Posts (${ig.posts.length})`} sub="Cliquer pour le détail">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
          {ig.posts.map(post => {
            const er = post.totalInteractions && post.reach ? fmtPct(pct(post.totalInteractions, post.reach)) : '—';
            const isReel = post.type === 'VIDEO' || post.type === 'REEL';
            const completion = isReel && post.avgWatchTimeMs && post.videoDuration
              ? `${Math.round((post.avgWatchTimeMs / 1000) / post.videoDuration * 100)}%`
              : null;
            return (
              <div key={post.id} onClick={() => setSelectedPost(post)} style={{ cursor: 'pointer', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', transition: 'box-shadow .15s' }}
                onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,.08)')}
                onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}>
                <div style={{ position: 'relative', aspectRatio: '1', background: 'var(--surface-2)' }}>
                  {post.thumbnail
                    ? <img src={post.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--faint)', fontSize: 24 }}>🎬</div>}
                  <div style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,.6)', color: '#fff', fontSize: 9, padding: '2px 5px', borderRadius: 4, fontWeight: 600 }}>
                    {isReel ? 'REEL' : post.type === 'CAROUSEL_ALBUM' ? 'CAROUSEL' : 'IMAGE'}
                  </div>
                  {completion && <div style={{ position: 'absolute', bottom: 6, right: 6, background: 'rgba(63,138,82,.85)', color: '#fff', fontSize: 9, padding: '2px 5px', borderRadius: 4, fontWeight: 600 }}>{completion}</div>}
                </div>
                <div style={{ padding: '8px 10px' }}>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>{new Date(post.timestamp).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                    <span>❤️ {post.likes ?? '—'}</span>
                    <span>👁 {post.reach ?? '—'}</span>
                    <span>⚡ {er}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Modal stat IG */}
      {statModal && (
        <ModalOverlay onClose={() => setStatModal(null)}>
          <div style={{ background: 'var(--surface)', borderRadius: 20, padding: '32px 32px 28px', width: '100%', maxWidth: 720, boxShadow: '0 24px 60px rgba(0,0,0,.18)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>{statModal.label}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Jour par jour · {period} derniers jours</div>
              </div>
              <button onClick={() => setStatModal(null)} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--muted)', lineHeight: 1 }}>×</button>
            </div>
            <div style={{ fontSize: 36, fontWeight: 800, color: statModal.color, marginBottom: 20 }}>{statModal.value}</div>
            <ResponsiveContainer width="100%" height={220}>
              <ReAreaChart data={statModal.data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="grad-ig-stat-modal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={statModal.color} stopOpacity={0.2} />
                    <stop offset="95%" stopColor={statModal.color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={fmtAxisDate} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={44} tickFormatter={(v: number) => v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)} />
                <Tooltip content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  return <div className="chart-tooltip"><div className="chart-tooltip-label">{label}</div><div className="chart-tooltip-row"><strong>{fmt(payload[0].value as number)}{statModal.unit ?? ''}</strong></div></div>;
                }} />
                <Area type="monotone" dataKey="v" stroke={statModal.color} strokeWidth={2} fill="url(#grad-ig-stat-modal)" dot={false} activeDot={{ r: 4, strokeWidth: 0, fill: statModal.color }} isAnimationActive={false} />
              </ReAreaChart>
            </ResponsiveContainer>
          </div>
        </ModalOverlay>
      )}

      {selectedPost && (
        <ModalOverlay onClose={() => setSelectedPost(null)} maxWidth={520}>
          <div style={{ background: 'var(--surface)', borderRadius: 14, padding: 24, width: '100%', maxHeight: '80vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{new Date(selectedPost.timestamp).toLocaleDateString('fr-FR', { dateStyle: 'long' })}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                  {selectedPost.type === 'VIDEO' || selectedPost.type === 'REEL' ? 'Reel' : selectedPost.type === 'CAROUSEL_ALBUM' ? 'Carousel' : 'Image'}
                </div>
              </div>
              <button onClick={() => setSelectedPost(null)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--muted)' }}>×</button>
            </div>
            {selectedPost.caption && <div style={{ fontSize: 12, color: 'var(--ink-2)', marginBottom: 16, lineHeight: 1.5, borderLeft: '2px solid var(--border)', paddingLeft: 10 }}>{selectedPost.caption}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {[
                ['❤️ Likes', selectedPost.likes],
                ['💬 Commentaires', selectedPost.comments],
                ['👁 Reach · personnes', selectedPost.reach],
                ['🔖 Saves', selectedPost.saved],
                ['↗️ Partages', selectedPost.shares],
                ['▶️ Vues', selectedPost.views],
                ['⚡ Interactions', selectedPost.totalInteractions],
              ].map(([label, value], i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{value !== null && value !== undefined ? fmt(value as number) : '—'}</div>
                </div>
              ))}
              {(selectedPost.type === 'VIDEO' || selectedPost.type === 'REEL') && <>
                {[
                  ['⏱ Watch time moyen', selectedPost.avgWatchTimeMs !== null ? fmtMs(selectedPost.avgWatchTimeMs!) : null],
                  ['⏩ Skip rate', selectedPost.skipRate !== null ? fmtPct(selectedPost.skipRate!) : null],
                  ['⏳ Durée', selectedPost.videoDuration !== null ? `${selectedPost.videoDuration}s` : null],
                  ['✅ Complétion', selectedPost.avgWatchTimeMs && selectedPost.videoDuration
                    ? fmtPct(Math.round((selectedPost.avgWatchTimeMs / 1000) / selectedPost.videoDuration * 100)) : null],
                ].map(([label, value], i) => (
                  <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
                    <div style={{ fontSize: 18, fontWeight: 700 }}>{value ?? '—'}</div>
                  </div>
                ))}
              </>}
            </div>
            <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border-soft)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                {[
                  ['ER', selectedPost.totalInteractions && selectedPost.reach ? fmtPct(pct(selectedPost.totalInteractions, selectedPost.reach)) : '—', 'Engagement rate'],
                  ['Save rate', selectedPost.saved && selectedPost.reach ? fmtPct(pct(selectedPost.saved, selectedPost.reach)) : '—', 'Saves / Reach'],
                  ['Reach rate', selectedPost.reach && ig.followers ? fmtPct(pct(selectedPost.reach, ig.followers)) : '—', 'Reach / Abonnés'],
                ].map(([label, value, desc], i) => (
                  <div key={i} style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
                    <div style={{ fontSize: 10, color: 'var(--muted)' }}>{label}</div>
                    <div style={{ fontSize: 20, fontWeight: 700 }}>{value}</div>
                    <div style={{ fontSize: 9, color: 'var(--faint)' }}>{desc}</div>
                  </div>
                ))}
              </div>
            </div>
            <a href={selectedPost.permalink} target="_blank" rel="noreferrer" style={{ display: 'block', marginTop: 14, textAlign: 'center', fontSize: 12, color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>
              Voir sur Instagram →
            </a>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
}

// ─── TAB 3 : YouTube ──────────────────────────────────────────────────────────

function TabYouTube({ yt, period }: { yt: YTStats | null; period: Period }) {
  const [selectedVideo, setSelectedVideo] = useState<YTVideo | null>(null);
  const [retention, setRetention] = useState<{ ratio: number; watchRatio: number }[] | null>(null);
  const [loadingRetention, setLoadingRetention] = useState(false);
  const [statModal, setStatModal] = useState<{ label: string; value: string; color: string; data: { date: string; v: number }[]; unit?: string; data2?: { date: string; v: number }[]; label2?: string; color2?: string } | null>(null);

  const loadRetention = useCallback(async (videoId: string) => {
    setLoadingRetention(true);
    try {
      const r = await fetch(`/api/youtube/video-retention?videoId=${videoId}`);
      const d = await r.json();
      setRetention(d.retentionCurve || []);
    } catch { setRetention([]); }
    finally { setLoadingRetention(false); }
  }, []);

  if (!yt) return <Empty msg="Connecte ton compte YouTube pour voir les stats." />;

  const ytDays = yt.chartData.slice(-period);
  // Valeurs sur la période sélectionnée depuis chartData
  const ytViewsP = ytDays.reduce((s, d) => s + d.views, 0);
  const ytWatchTimeP = ytDays.reduce((s, d) => s + d.watchTime, 0);
  const ytSubsGainedP = ytDays.reduce((s, d) => s + (d.subsGained ?? 0), 0);
  const ytSubsLostP = ytDays.reduce((s, d) => s + (d.subsLost ?? 0), 0);
  const ytNetSubsP = ytSubsGainedP - ytSubsLostP;

  const conversionRate = ytViewsP > 0 ? ((ytSubsGainedP / ytViewsP) * 100).toFixed(3) : '0';
  const viewsPerSub = ytSubsGainedP > 0 ? Math.round(ytViewsP / ytSubsGainedP) : null;
  const watchTimeH = Math.round(ytWatchTimeP / 60);

  // Vues/sub par type de contenu (depuis les vidéos de la période)
  const shortsViewsP = yt.videos.filter(v => v.isShort).reduce((s, v) => s + v.views30d, 0);
  const longViewsP = yt.videos.filter(v => !v.isShort).reduce((s, v) => s + v.views30d, 0);
  const viewsPerSubShorts = ytSubsGainedP > 0 && shortsViewsP > 0 ? Math.round(shortsViewsP / ytSubsGainedP) : null;
  const viewsPerSubLong = ytSubsGainedP > 0 && longViewsP > 0 ? Math.round(longViewsP / ytSubsGainedP) : null;
  const mockFromTotalYT = (total: number, seed: number) => {
    if (total === 0) return ytDays.map(d => ({ date: d.date, v: 0 }));
    const pts = ytDays.map((_, i) => Math.max(0, Math.sin(i * 1.7 + seed) * 0.5 + 0.5));
    const sum = pts.reduce((a, b) => a + b, 0);
    let vals = pts.map(p => Math.round((p / sum) * total));
    vals[vals.length - 1] += total - vals.reduce((a, b) => a + b, 0);
    return ytDays.map((d, i) => ({ date: d.date, v: vals[i] }));
  };

  const cutoffYt = new Date(Date.now() - period * 86400000);
  const videosInPeriod = yt.videos.filter(v => new Date(v.publishedAt) >= cutoffYt);
  const ytShortsCount = videosInPeriod.filter(v => v.isShort).length;
  const ytLongCount = videosInPeriod.filter(v => !v.isShort).length;
  const ytVideosInPeriodCount = videosInPeriod.length;

  // Publications par jour depuis les vrais timestamps des vidéos
  const ytPubsByDay = ytDays.map(d => ({
    date: d.date,
    shorts: yt.videos.filter(v => v.isShort && v.publishedAt.startsWith(d.date)).length,
    longues: yt.videos.filter(v => !v.isShort && v.publishedAt.startsWith(d.date)).length,
  }));

  const fmtSec = (sec: number) => sec >= 3600 ? `${Math.round(sec/3600)}h` : `${Math.floor(sec/60)}m${String(sec%60).padStart(2,'0')}s`;

  const shortsVideos = yt.videos.filter(v => v.isShort);
  const longVideos = yt.videos.filter(v => !v.isShort);
  const avgWatchShorts = shortsVideos.length > 0 && shortsVideos.reduce((s,v) => s + v.views30d, 0) > 0
    ? Math.round(shortsVideos.reduce((s,v) => s + v.watchTime30d, 0) / shortsVideos.reduce((s,v) => s + v.views30d, 0))
    : null;
  const avgWatchLong = longVideos.length > 0 && longVideos.reduce((s,v) => s + v.views30d, 0) > 0
    ? Math.round(longVideos.reduce((s,v) => s + v.watchTime30d, 0) / longVideos.reduce((s,v) => s + v.views30d, 0))
    : null;

  const mockAroundAvgYT = (avg: number, seed: number, variancePct = 0.2) => {
    if (!avg) return ytDays.map(d => ({ date: d.date, v: 0 }));
    return ytDays.map((_, i) => ({
      date: ytDays[i].date,
      v: Math.round(avg * (1 + Math.sin(i * 1.7 + seed) * variancePct)),
    }));
  };

  const ytStatSeries: Record<string, { data: { date: string; v: number }[]; color: string; unit?: string }> = {
    'Vidéos publiées':    { data: ytPubsByDay.map(d => ({ date: d.date, v: d.shorts + d.longues })), color: YT_COLOR },
    'Vues 30j':           { data: ytDays.map(d => ({ date: d.date, v: d.views })), color: RED },
    'Watch time':         { data: ytDays.map(d => ({ date: d.date, v: Math.round(d.watchTime / 60) })), color: AMBER, unit: 'h' },
    'Watch time moyen':   { data: mockFromTotalYT(avgWatchShorts ?? 0, 5), color: '#f43f5e', unit: 's' },
    'Subs gagnés':        { data: ytDays.map(d => ({ date: d.date, v: d.subsGained ?? 0 })), color: GREEN },
    'Subs perdus':        { data: ytDays.map(d => ({ date: d.date, v: d.subsLost ?? 0 })), color: RED },
    'Subs nets':          { data: ytDays.map(d => ({ date: d.date, v: d.netSubs ?? 0 })), color: yt.netSubs30d >= 0 ? GREEN : RED },
    'Likes':              { data: mockFromTotalYT(yt.likes30d, 1), color: ACCENT },
    'Commentaires':       { data: mockFromTotalYT(yt.comments30d, 2), color: BLUE },
    'Partages':           { data: mockFromTotalYT(yt.shares30d, 3), color: GREEN },
    'Conv. vue→sub':      { data: mockFromTotalYT(parseFloat(conversionRate), 4), color: ACCENT, unit: '%' },
    'Abonnés YT':         { data: ytDays.map(d => ({ date: d.date, v: d.subsGained ?? 0 })), color: RED },
    'Vues all-time':      { data: mockFromTotalYT(yt.totalViews, 7), color: RED },
  };

  const openStatModal = (label: string, value: string) => {
    const s = ytStatSeries[label];
    if (!s) return;
    if (label === 'Watch time moyen') {
      setStatModal({
        label: 'Watch time moyen / vue', value: avgWatchShorts !== null ? fmtSec(avgWatchShorts) : '—',
        color: '#e8a838', data: mockAroundAvgYT(avgWatchShorts ?? 45, 5),
        label2: 'Vidéos longues', data2: mockAroundAvgYT(avgWatchLong ?? 480, 6), color2: '#64748b',
        unit: 's',
      });
      return;
    }
    if (label === 'Vidéos publiées') {
      setStatModal({
        label, value, color: '#e8a838', data: ytPubsByDay.map(d => ({ date: d.date, v: d.shorts })),
        label2: 'Vidéos longues', data2: ytPubsByDay.map(d => ({ date: d.date, v: d.longues })), color2: '#64748b',
      });
    } else {
      setStatModal({ label, value, color: s.color, data: s.data, unit: s.unit });
    }
  };

  const trafficData = yt.trafficSources.slice(0, 8).map(s => ({
    name: s.source.replace('YT_', '').replace('_', ' ').toLowerCase(),
    views: s.views,
  }));

  const deviceData = yt.devices.map(d => ({ name: d.device.toLowerCase(), views: d.views }));

  return (
    <div className="stack">
      {/* Ligne 1 — audience & portée */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
        {[
          { label: 'Abonnés', value: fmt(yt.subscribers), sub: 'all time', color: 'var(--ink)', key: 'Abonnés YT' },
          { label: 'Vidéos publiées', value: fmt(ytVideosInPeriodCount), sub: `${period}j`, color: YT_COLOR, key: 'Vidéos publiées' },
          { label: 'Subs nets', value: `${ytNetSubsP >= 0 ? '+' : ''}${fmt(ytNetSubsP)}`, sub: `${period}j — +${fmt(ytSubsGainedP)} / -${fmt(ytSubsLostP)}`, color: ytNetSubsP >= 0 ? GREEN : RED, key: 'Subs nets' },
          { label: 'Vues', value: fmt(ytViewsP), sub: `${period}j`, color: 'var(--ink)', key: 'Vues 30j' },
          null, // carte Vues/sub custom Shorts vs Vidéos
        ].map((s, i) => {
          if (s === null) return (
            <div key="vues-sub" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px' }}>
              <div style={{ marginBottom: 10 }}>
                <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--muted)' }}>Vues pour 1 sub gagné</span>
                <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--faint)', marginLeft: 5 }}>{period}j</span>
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--faint)', marginBottom: 3 }}>Shorts</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink)', lineHeight: 1 }}>{viewsPerSubShorts !== null ? fmt(viewsPerSubShorts) : '—'}</div>
                </div>
                <div style={{ width: 1, height: 32, background: 'var(--border)', flexShrink: 0, marginTop: 14 }} />
                <div>
                  <div style={{ fontSize: 10, color: 'var(--faint)', marginBottom: 3 }}>Vidéos</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink)', lineHeight: 1 }}>{viewsPerSubLong !== null ? fmt(viewsPerSubLong) : '—'}</div>
                </div>
              </div>
            </div>
          );
          return (
          <div key={s.label} onClick={s.key ? () => openStatModal(s.key!, s.value) : undefined} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px', cursor: s.key ? 'pointer' : 'default', transition: 'background .15s' }}
            onMouseEnter={e => { if (s.key) e.currentTarget.style.background = 'var(--surface-2)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--surface)'; }}>
            <div style={{ marginBottom: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--muted)' }}>{s.label}</span>
              {s.sub && <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--faint)', marginLeft: 5 }}>{s.sub}</span>}
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: s.color, lineHeight: 1, marginBottom: s.label === 'Vidéos publiées' ? 8 : 0 }}>{s.value}</div>
            {s.label === 'Vidéos publiées' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'nowrap', marginTop: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink)', whiteSpace: 'nowrap' }}>{fmt(ytShortsCount)}</span>
                  <span style={{ fontSize: 10, color: 'var(--ink)', whiteSpace: 'nowrap' }}>Shorts</span>
                </div>
                <div style={{ width: 1, height: 12, background: 'var(--border)', flexShrink: 0 }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink)', whiteSpace: 'nowrap' }}>{fmt(ytLongCount)}</span>
                  <span style={{ fontSize: 10, color: 'var(--ink)', whiteSpace: 'nowrap' }}>Vidéos</span>
                </div>
              </div>
            )}
          </div>
          );
        })}
      </div>
      {/* Ligne 2 — engagement & watch time */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
        {[
          { label: 'Watch time', value: `${watchTimeH}h`, sub: `${period}j`, color: AMBER, key: 'Watch time' },
          null, // carte Watch time moyen custom
          { label: 'Likes', value: fmt(yt.likes30d), sub: `${period}j`, color: 'var(--ink)', key: 'Likes' },
          { label: 'Commentaires', value: fmt(yt.comments30d), sub: `${period}j`, color: 'var(--ink)', key: 'Commentaires' },
          { label: 'Partages', value: fmt(yt.shares30d), sub: `${period}j`, color: 'var(--ink)', key: 'Partages' },
        ].map((s, i) => {
          if (s === null) return (
            <div key="wt-moyen" onClick={() => openStatModal('Watch time moyen', '')} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px', cursor: 'pointer', transition: 'background .15s' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'} onMouseLeave={e => e.currentTarget.style.background = 'var(--surface)'}>
              <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--muted)', marginBottom: 10 }}>Watch time moyen / vue</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#f43f5e', flexShrink: 0 }} />
                    <span style={{ fontSize: 10, color: 'var(--muted)' }}>Shorts</span>
                  </div>
                  <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)' }}>{avgWatchShorts !== null ? fmtSec(avgWatchShorts) : '—'}</span>
                </div>
                <div style={{ width: 1, height: 32, background: 'var(--border)', flexShrink: 0 }} />
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: YT_COLOR, flexShrink: 0 }} />
                    <span style={{ fontSize: 10, color: 'var(--muted)' }}>Vidéos longues</span>
                  </div>
                  <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)' }}>{avgWatchLong !== null ? fmtSec(avgWatchLong) : '—'}</span>
                </div>
              </div>
            </div>
          );
          return (
            <div key={s.label} onClick={s.key ? () => openStatModal(s.key!, s.value) : undefined} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px', cursor: s.key ? 'pointer' : 'default', transition: 'background .15s' }}
              onMouseEnter={e => { if (s.key) e.currentTarget.style.background = 'var(--surface-2)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'var(--surface)'; }}>
              <div style={{ marginBottom: 8 }}>
                <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--muted)' }}>{s.label}</span>
                {s.sub && <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--faint)', marginLeft: 5 }}>{s.sub}</span>}
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</div>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 18 }}>
        <Card title="Vues / jour" sub={`${period} jours · données J-3`}>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={ytDays} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={fmtAxisDate} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="views" name="Vues" fill={ACCENT} radius={[2, 2, 0, 0]} opacity={0.8} />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Appareils">
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={deviceData} cx="50%" cy="50%" outerRadius={80} dataKey="views" nameKey="name" label={({ name, percent }: { name?: string; percent?: number }) => `${name ?? ''} ${((percent ?? 0) * 100).toFixed(0)}%`} labelLine={false}>
                {deviceData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i]} />)}
              </Pie>
              <Tooltip formatter={(v: any) => fmt(v)} />
            </PieChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {ytDays.some(d => d.netSubs !== undefined) && (
        <Card title="Abonnés nets / jour" sub={`${period} jours · données J-3`}>
          <ResponsiveContainer width="100%" height={160}>
            <ComposedChart data={ytDays} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={fmtAxisDate} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="netSubs" name="Subs nets" fill={GREEN} radius={[2, 2, 0, 0]} opacity={0.85} />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>
      )}

      <Card title={`Vidéos (${yt.videos.length})`} sub="Clic → courbe de rétention">
        <table className="table" style={{ width: '100%' }}>
          <thead>
            <tr>
              {['', 'Titre', 'Type', 'Vues totales', 'Vues 30j', 'Rétention', 'Durée', 'Likes', 'Date'].map((h, i) => (
                <th key={i} style={{ textAlign: 'left', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)', padding: '8px 10px' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {yt.videos.map(v => (
              <tr key={v.id} onClick={() => { setSelectedVideo(v); loadRetention(v.id); }}
                style={{ cursor: 'pointer' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                onMouseLeave={e => (e.currentTarget.style.background = '')}>
                <td style={{ padding: '10px' }}>
                  {v.thumbnail ? <img src={v.thumbnail} alt="" style={{ width: 56, height: 32, objectFit: 'cover', borderRadius: 4 }} /> : <div style={{ width: 56, height: 32, borderRadius: 4, background: 'var(--surface-2)' }} />}
                </td>
                <td style={{ padding: '10px', maxWidth: 200 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.title}</div>
                </td>
                <td style={{ padding: '10px' }}>
                  <span style={{ fontSize: 10, background: v.isShort ? RED + '20' : ACCENT + '20', color: v.isShort ? RED : ACCENT, borderRadius: 4, padding: '2px 6px', fontWeight: 600 }}>
                    {v.isShort ? 'Short' : 'Vidéo'}
                  </span>
                </td>
                <td style={{ padding: '10px', fontSize: 13, fontWeight: 600 }}>{fmt(v.views)}</td>
                <td style={{ padding: '10px', fontSize: 13, color: v.views30d > 0 ? GREEN : 'var(--muted)', fontWeight: 600 }}>+{fmt(v.views30d)}</td>
                <td style={{ padding: '10px', fontSize: 13 }}>{v.avgViewPct ? fmtPct(v.avgViewPct) : '—'}</td>
                <td style={{ padding: '10px', fontSize: 12, color: 'var(--muted)' }}>{v.duration}</td>
                <td style={{ padding: '10px', fontSize: 13 }}>{fmt(v.likes)}</td>
                <td style={{ padding: '10px', fontSize: 11, color: 'var(--muted)' }}>{new Date(v.publishedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: '2-digit' })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <Card title="Sources de trafic" sub="Vues par source">
          {trafficData.map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', width: 90, textTransform: 'capitalize' }}>{s.name}</div>
              <div style={{ flex: 1, height: 6, background: 'var(--border)', borderRadius: 3 }}>
                <div style={{ height: 6, width: `${pct(s.views, trafficData[0]?.views || 1)}%`, background: ACCENT, borderRadius: 3 }} />
              </div>
              <div style={{ fontSize: 11, fontWeight: 600, width: 40, textAlign: 'right' }}>{fmt(s.views)}</div>
            </div>
          ))}
        </Card>
        <Card title="Mots-clés de recherche" sub="Top 10 termes">
          {yt.searchKeywords.slice(0, 10).map((k, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k.term}</div>
              <div style={{ fontSize: 11, fontWeight: 600 }}>{fmt(k.views)}</div>
            </div>
          ))}
          {yt.searchKeywords.length === 0 && <Empty msg="Pas encore de données de recherche" />}
        </Card>
      </div>

      {/* Modal stat YT */}
      {statModal && (
        <ModalOverlay onClose={() => setStatModal(null)}>
          <div style={{ background: 'var(--surface)', borderRadius: 20, padding: '32px 32px 28px', width: '100%', maxWidth: 720, boxShadow: '0 24px 60px rgba(0,0,0,.18)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>{statModal.label}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Jour par jour · {period} derniers jours</div>
              </div>
              <button onClick={() => setStatModal(null)} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--muted)', lineHeight: 1 }}>×</button>
            </div>
            {statModal.data2 ? (() => {
              const color1 = statModal.color;
              const color2 = statModal.color2 || '#64748b';
              const isWatchTime = statModal.label.includes('Watch time');
              const merged = statModal.data.map((d, i) => ({
                date: d.date,
                shorts: d.v,
                longues: statModal.data2![i]?.v ?? 0,
              }));
              const formatVal = (v: number) => isWatchTime ? fmtSec(v) : fmt(v);
              const val1 = isWatchTime ? (avgWatchShorts !== null ? fmtSec(avgWatchShorts) : '—') : `${fmt(ytShortsCount)}`;
              const val2 = isWatchTime ? (avgWatchLong !== null ? fmtSec(avgWatchLong) : '—') : `${fmt(ytLongCount)}`;
              return (
                <>
                  <div style={{ display: 'flex', gap: 32, marginBottom: 20 }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: color1 }} />
                        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Shorts</span>
                      </div>
                      <span style={{ fontSize: 28, fontWeight: 800, color: 'var(--ink)' }}>{val1}</span>
                    </div>
                    <div style={{ width: 1, background: 'var(--border)', alignSelf: 'stretch' }} />
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: color2 }} />
                        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{statModal.label2 || 'Vidéos longues'}</span>
                      </div>
                      <span style={{ fontSize: 28, fontWeight: 800, color: 'var(--ink)' }}>{val2}</span>
                    </div>
                  </div>
                  <ResponsiveContainer width="100%" height={220}>
                    <ReAreaChart data={merged} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="grad-yt-shorts" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={color1} stopOpacity={0.15} />
                          <stop offset="95%" stopColor={color1} stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="grad-yt-longues" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={color2} stopOpacity={0.15} />
                          <stop offset="95%" stopColor={color2} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={fmtAxisDate} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={isWatchTime ? 50 : 36} tickFormatter={(v: number) => isWatchTime ? fmtSec(v) : fmt(v)} />
                      <Tooltip content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        return (
                          <div className="chart-tooltip">
                            <div className="chart-tooltip-label">{label}</div>
                            {payload.map((p: any, i: number) => (
                              <div key={i} className="chart-tooltip-row" style={{ color: p.color }}>
                                <span>{p.name}</span><strong style={{ marginLeft: 8 }}>{formatVal(p.value)}</strong>
                              </div>
                            ))}
                          </div>
                        );
                      }} />
                      <Area type="monotone" dataKey="shorts" name="Shorts" stroke={color1} strokeWidth={2} fill="url(#grad-yt-shorts)" dot={false} activeDot={{ r: 4, strokeWidth: 0, fill: color1 }} isAnimationActive={false} />
                      <Area type="monotone" dataKey="longues" name="Vidéos longues" stroke={color2} strokeWidth={2} fill="url(#grad-yt-longues)" dot={false} activeDot={{ r: 4, strokeWidth: 0, fill: color2 }} isAnimationActive={false} />
                    </ReAreaChart>
                  </ResponsiveContainer>
                </>
              );
            })() : (
              <ResponsiveContainer width="100%" height={220}>
                <ReAreaChart data={statModal.data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="grad-yt-stat-modal" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={statModal.color} stopOpacity={0.2} />
                      <stop offset="95%" stopColor={statModal.color} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={fmtAxisDate} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={44} tickFormatter={(v: number) => v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)} />
                  <Tooltip content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    return <div className="chart-tooltip"><div className="chart-tooltip-label">{label}</div><div className="chart-tooltip-row"><strong>{fmt(payload[0].value as number)}{statModal.unit ?? ''}</strong></div></div>;
                  }} />
                  <Area type="monotone" dataKey="v" stroke={statModal.color} strokeWidth={2} fill="url(#grad-yt-stat-modal)" dot={false} activeDot={{ r: 4, strokeWidth: 0, fill: statModal.color }} isAnimationActive={false} />
                </ReAreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </ModalOverlay>
      )}

      {selectedVideo && (
        <ModalOverlay onClose={() => { setSelectedVideo(null); setRetention(null); }} maxWidth={640}>
          <div style={{ background: 'var(--surface)', borderRadius: 14, padding: 24, width: '100%', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', gap: 14, marginBottom: 16 }}>
              {selectedVideo.thumbnail ? <img src={selectedVideo.thumbnail} alt="" style={{ width: 120, height: 68, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }} /> : <div style={{ width: 120, height: 68, borderRadius: 8, background: 'var(--surface-2)', flexShrink: 0 }} />}
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.3, marginBottom: 4 }}>{selectedVideo.title}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{new Date(selectedVideo.publishedAt).toLocaleDateString('fr-FR', { dateStyle: 'long' })} · {selectedVideo.duration} · {selectedVideo.isShort ? 'Short' : 'Vidéo'}</div>
              </div>
              <button onClick={() => { setSelectedVideo(null); setRetention(null); }} style={{ marginLeft: 'auto', background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--muted)' }}>×</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
              {[
                ['Vues totales', fmt(selectedVideo.views)],
                ['Watch time total', selectedVideo.watchTime30d >= 3600 ? `${Math.round(selectedVideo.watchTime30d / 3600)}h` : `${Math.round(selectedVideo.watchTime30d / 60)}min`],
                ['Rétention moy.', selectedVideo.avgViewPct ? fmtPct(selectedVideo.avgViewPct) : '—'],
                ['Likes', fmt(selectedVideo.likes)],
                ['Commentaires', fmt(selectedVideo.comments)],
                ['Partages', fmt(selectedVideo.shares30d)],
              ].map(([label, value], i) => (
                <div key={i} style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
                  <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>{value}</div>
                </div>
              ))}
            </div>
            <div style={{ marginBottom: 8, fontSize: 12, fontWeight: 600 }}>Courbe de rétention</div>
            {loadingRetention ? <Loading /> : retention && retention.length > 0
              ? <AreaChart data={retention.map(p => ({ x: `${Math.round(p.ratio * 100)}%`, pct: Math.round(p.watchRatio * 100) }))}
                areas={[{ key: 'pct', label: 'Viewers restants (%)', color: GREEN }]}
                xKey="x" height={160} formatter={(v: number) => `${v}%`} />
              : <Empty msg="Rétention non disponible pour cette vidéo" />}
            <a href={selectedVideo.url} target="_blank" rel="noreferrer" style={{ display: 'block', marginTop: 14, textAlign: 'center', fontSize: 12, color: RED, textDecoration: 'none', fontWeight: 600 }}>
              Voir sur YouTube →
            </a>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
}

// ─── TAB 4 : Funnel & Calls ───────────────────────────────────────────────────

const IG_COLOR = '#E1306C';
const YT_COLOR = '#FF0000';

function FunnelHorizontal({ platform, color, steps }: {
  platform: string;
  color: string;
  steps: { label: string; value: string; sub?: string; rate?: number; rawValue: number }[];
}) {
  const DOT = 64;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 28 }}>
        <div style={{ width: 9, height: 9, borderRadius: '50%', background: color, flexShrink: 0 }} />
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{platform}</div>
      </div>

      {/* Timeline horizontale */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        {/* Ligne de fond qui relie tous les points */}
        <div style={{
          position: 'absolute',
          top: DOT / 2,
          left: DOT / 2,
          right: DOT / 2,
          height: 2,
          background: 'var(--border)',
          zIndex: 0,
        }} />

        {steps.map((step, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, position: 'relative', zIndex: 1 }}>
            {/* Point */}
            <div style={{
              width: DOT,
              height: DOT,
              borderRadius: '50%',
              background: 'var(--ink)',
              border: '4px solid var(--surface)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 0 0 2px var(--ink)',
              flexShrink: 0,
              gap: 1,
            }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#fff', textAlign: 'center', lineHeight: 1 }}>{step.value}</div>
            </div>

            {/* Label + sous-titre + taux sous le point */}
            <div style={{ marginTop: 12, textAlign: 'center', maxWidth: 100 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.3 }}>{step.label}</div>
              {step.sub && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>{step.sub}</div>}
              {step.rate !== undefined && (
                <div style={{
                  marginTop: 5,
                  fontSize: 11, fontWeight: 700,
                  color: step.rate < 1 ? RED : step.rate < 5 ? AMBER : GREEN,
                }}>
                  {fmt(step.rate, 1)}%
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


function periodLabel(period: number, index: number): string {
  const now = new Date();
  const end = new Date(now.getTime() - index * period * 86400000);
  const start = new Date(end.getTime() - period * 86400000);
  const fmt2 = (d: Date) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  return `${fmt2(start)} – ${fmt2(end)}`;
}

function delta(current: number, previous: number): { value: number; label: string; color: string } {
  if (previous === 0) return { value: 0, label: '—', color: 'var(--muted)' };
  const d = Math.round(((current - previous) / previous) * 100);
  return {
    value: d,
    label: `${d >= 0 ? '+' : ''}${d}%`,
    color: d > 0 ? GREEN : d < 0 ? RED : 'var(--muted)',
  };
}

function TabFunnel({ msgs, calls, stripe, ig, yt, shortio, period, periodIndex, onModalChange, leads: leadsFromProp }: { msgs: IGMessages | null; calls: CallRecord[]; stripe: StripeStats | null; ig: IGStats | null; yt: YTStats | null; shortio: ShortioStats | null; period: Period; periodIndex: number; onModalChange?: (open: boolean) => void; leads?: MockLead[] }) {
  const leads = leadsFromProp && leadsFromProp.length > 0 ? leadsFromProp : [];
  const [callsFilter, setCallsFilter] = useState<'all' | 'ig' | 'yt'>('all');
  const [expandedHero, setExpandedHero] = useState<number | null>(null);
  const [heroSnapshot, setHeroSnapshot] = useState<{ label: string; value: string; sub: string } | null>(null);
  const [modalPeriod, setModalPeriod] = useState<Period>(30);
  const [modalPeriodIndex, setModalPeriodIndex] = useState(0);
  const [expandedEff, setExpandedEff] = useState<{ label: string; value: string; color: string; data: { date: string; v: number }[] } | null>(null);
  const now = new Date();
  const mrr = stripe?.mrr || 0;

  // ── Calls par plateforme (données réelles uniquement) ──
  const callsIG = calls.filter(c => c.source?.startsWith('ig') || c.source?.startsWith('instagram'));
  const callsYT = calls.filter(c => c.source?.startsWith('yt') || c.source?.startsWith('youtube'));

  const calcCalls = (subset: CallRecord[]) => {
    const bookes = subset.filter(c => c.status === 'active').length;
    const honores = subset.filter(c => c.status === 'active' && new Date(c.scheduled_at) < now && !c.no_show).length;
    const closes = subset.filter(c => c.deal_closed).length;
    const rev = subset.reduce((acc, c) => acc + (c.revenue || 0), 0);
    const noShows = subset.filter(c => c.no_show).length;
    return { bookes, honores, closes, rev, noShows };
  };

  const igCallsLive = calcCalls(callsIG);
  const ytCallsLive = calcCalls(callsYT);

  const igReachD  = ig ? ig.chartData.slice(-period).reduce((s, d) => s + d.reach, 0) : 0;
  const igLeadsD  = msgs?.leadCount || 0;
  const igBioD    = ig?.profileLinksTaps30d || 0;
  const igBookes  = igCallsLive.bookes;
  const igHonores = igCallsLive.honores;
  const igCloses  = igCallsLive.closes;
  const igRev     = igCallsLive.rev;
  const igNoShows = igCallsLive.noShows;

  const ytViewsD  = yt ? yt.chartData.slice(-period).reduce((s, d) => s + d.views, 0) : 0;
  const ytBookes  = ytCallsLive.bookes;
  const ytHonores = ytCallsLive.honores;
  const ytCloses  = ytCallsLive.closes;
  const ytRev     = ytCallsLive.rev;
  const ytNoShows = ytCallsLive.noShows;
  // Clics YT description → Calendly depuis shortio
  const ytClicsD  = shortio ? shortio.links.filter((l: any) => l.linkType === 'post' && l.postPlatform === 'YT').reduce((s: number, l: any) => s + (l.humanClicks30d || 0), 0) : 0;

  // Clics totaux IG = bio + liens description contenu (postLinks IG)
  const igPostClics = shortio ? shortio.links.filter((l: any) => l.linkType === 'post' && l.postPlatform === 'IG').reduce((s: number, l: any) => s + (l.humanClicks30d || 0), 0) : 0;
  const igTotalClicsD = igBioD + igPostClics;

  const igFunnelSteps = [
    { label: period === 7 ? 'Reach 7j' : 'Reach 30j', value: igReachD >= 1000 ? `${fmt(igReachD / 1000, 1)}k` : fmt(igReachD), rawValue: igReachD },
    { label: 'Clics liens Calendly', value: fmt(igTotalClicsD), sub: 'bio + descr. + LM', rawValue: igTotalClicsD, rate: igReachD > 0 ? (igTotalClicsD / igReachD) * 100 : 0 },
    { label: 'Calls bookés', value: fmt(igBookes), rawValue: igBookes, rate: igTotalClicsD > 0 ? (igBookes / igTotalClicsD) * 100 : 0 },
    { label: 'Calls honorés', value: fmt(igHonores), rawValue: igHonores, rate: igBookes > 0 ? (igHonores / igBookes) * 100 : 0 },
    { label: 'Deals closés', value: fmt(igCloses), rawValue: igCloses, rate: igHonores > 0 ? (igCloses / igHonores) * 100 : 0 },
    { label: 'Revenue', value: fmtEur(igRev), rawValue: igRev },
  ];

  const ytFunnelSteps = [
    { label: period === 7 ? 'Vues 7j' : 'Vues 30j', value: ytViewsD >= 1000 ? `${fmt(ytViewsD / 1000, 1)}k` : fmt(ytViewsD), rawValue: ytViewsD },
    { label: 'Clics description → Calendly', value: fmt(ytClicsD), sub: 'Short.io', rawValue: ytClicsD, rate: ytViewsD > 0 ? (ytClicsD / ytViewsD) * 100 : 0 },
    { label: 'Calls bookés', value: fmt(ytBookes), rawValue: ytBookes, rate: ytClicsD > 0 ? (ytBookes / ytClicsD) * 100 : 0 },
    { label: 'Calls honorés', value: fmt(ytHonores), rawValue: ytHonores, rate: ytBookes > 0 ? (ytHonores / ytBookes) * 100 : 0 },
    { label: 'Deals closés', value: fmt(ytCloses), rawValue: ytCloses, rate: ytHonores > 0 ? (ytCloses / ytHonores) * 100 : 0 },
    { label: 'Revenue', value: fmtEur(ytRev), rawValue: ytRev },
  ];

  const igNoShowRate = igBookes > 0 ? pct(igNoShows, igBookes) : 0;
  const ytNoShowRate = ytBookes > 0 ? pct(ytNoShows, ytBookes) : 0;

  type EffMetric = { label: string; value: string; prevValue: string | null; delta: { value: number; label: string; color: string } | null; lowerIsBetter: boolean };
  type EffRow = { platform: string; color: string; metrics: EffMetric[] };
  // ── Efficacité par plateforme (données réelles, pas de comparaison historique) ──
  const effRows: EffRow[] = [
    {
      platform: 'Instagram', color: IG_COLOR,
      metrics: [
        { label: 'Reach pour 1 call', value: igBookes > 0 ? fmt(Math.round(igReachD / igBookes)) : '—', prevValue: null, delta: null, lowerIsBetter: true },
        { label: 'No-show', value: igBookes > 0 ? `${igNoShowRate}%` : '—', prevValue: null, delta: null, lowerIsBetter: true },
        { label: 'Close rate', value: igHonores > 0 ? `${pct(igCloses, igHonores)}%` : '—', prevValue: null, delta: null, lowerIsBetter: false },
        { label: 'Rev / call honoré', value: igHonores > 0 ? fmtEur(Math.round(igRev / igHonores)) : '—', prevValue: null, delta: null, lowerIsBetter: false },
        { label: 'Revenue total', value: fmtEur(igRev), prevValue: null, delta: null, lowerIsBetter: false },
      ],
    },
    {
      platform: 'YouTube', color: YT_COLOR,
      metrics: [
        { label: 'Vues pour 1 call', value: ytBookes > 0 ? fmt(Math.round(ytViewsD / ytBookes)) : '—', prevValue: null, delta: null, lowerIsBetter: true },
        { label: 'No-show', value: ytBookes > 0 ? `${ytNoShowRate}%` : '—', prevValue: null, delta: null, lowerIsBetter: true },
        { label: 'Close rate', value: ytHonores > 0 ? `${pct(ytCloses, ytHonores)}%` : '—', prevValue: null, delta: null, lowerIsBetter: false },
        { label: 'Rev / call honoré', value: ytHonores > 0 ? fmtEur(Math.round(ytRev / ytHonores)) : '—', prevValue: null, delta: null, lowerIsBetter: false },
        { label: 'Revenue total', value: fmtEur(ytRev), prevValue: null, delta: null, lowerIsBetter: false },
      ],
    },
  ];

  // ── Calls filtrés pour la table (toujours live) ──
  const filteredCalls = callsFilter === 'ig' ? callsIG : callsFilter === 'yt' ? callsYT : calls;

  const totalBookes  = igBookes + ytBookes;
  const totalHonores = igHonores + ytHonores;
  const totalCloses  = igCloses + ytCloses;
  const totalRev     = igRev + ytRev;
  const closingRate  = totalHonores > 0 ? pct(totalCloses, totalHonores) : 0;
  const noShowRate   = totalBookes > 0 ? pct(calls.filter(c => c.no_show).length, totalBookes) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 48 }}>

      {/* ── HERO — STATS GLOBALES ── */}
      {(() => {
        const noShowCount = calls.filter(c => c.no_show).length;
        const revPerCall = totalHonores > 0 ? Math.round(totalRev / totalHonores) : 0;

        // Données mock jour par jour pour chaque métrique (période actuelle)
        const n = period;
        const heroCharts: { data: { date: string; v: number }[]; color: string; unit: string; fmtV: (v: number) => string }[] = [
          // 0 Calls bookés — quelques calls éparpillés
          { color: 'var(--ink)', unit: 'calls', fmtV: String,
            data: Array.from({ length: n }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (n - 1 - i)); return { date: d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }), v: [0,0,1,0,0,0,1,0,0,0,0,1,0,0,0,0,0,0,1,0,0,1,0,0,0,0,0,0,1,0][i] || 0 }; }) },
          // 1 Calls honorés
          { color: AMBER, unit: 'honorés', fmtV: String,
            data: Array.from({ length: n }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (n - 1 - i)); return { date: d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }), v: [0,0,1,0,0,0,1,0,0,0,0,1,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,1,0][i] || 0 }; }) },
          // 2 Deals closés
          { color: GREEN, unit: 'closés', fmtV: String,
            data: Array.from({ length: n }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (n - 1 - i)); return { date: d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }), v: [0,0,0,0,0,0,1,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0][i] || 0 }; }) },
          // 3 Revenue cumulé
          { color: GREEN, unit: '€', fmtV: (v) => `${v} €`,
            data: Array.from({ length: n }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (n - 1 - i)); const dayRev = [0,0,0,0,0,0,1200,0,0,0,0,1200,0,0,0,0,0,0,0,0,0,2400,0,0,0,0,0,0,1200,0][i] || 0; return { date: d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }), v: dayRev }; }) },
          // 4 Rev / call — valeur fixe (pas de tendance jour par jour pertinente, on montre par semaine)
          { color: GREEN, unit: '€/call', fmtV: (v) => `${v} €`,
            data: Array.from({ length: n }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (n - 1 - i)); return { date: d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }), v: 780 + Math.round((Math.random() - 0.5) * 200) }; }) },
          // 5 No-show
          { color: RED, unit: 'no-shows', fmtV: String,
            data: Array.from({ length: n }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (n - 1 - i)); return { date: d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }), v: [0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0][i] || 0 }; }) },
          // 6 Calls IG
          { color: IG_COLOR, unit: 'calls IG', fmtV: String,
            data: Array.from({ length: n }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (n - 1 - i)); return { date: d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }), v: [0,0,1,0,0,0,1,0,0,0,0,1,0,0,0,0,0,0,1,0,0,1,0,0,0,0,0,0,0,0][i] || 0 }; }) },
          // 7 Calls YT
          { color: YT_COLOR, unit: 'calls YT', fmtV: String,
            data: Array.from({ length: n }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (n - 1 - i)); return { date: d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }), v: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,1,0][i] || 0 }; }) },
        ];

        const heroItems = [
          { label: 'Calls bookés',  value: fmt(totalBookes),   sub: 'toutes sources' },
          { label: 'Calls honorés', value: fmt(totalHonores),  sub: `${noShowRate}% no-show` },
          { label: 'Deals closés',  value: fmt(totalCloses),   sub: `${closingRate}% closing` },
          { label: 'Revenue total', value: fmtEur(totalRev),   sub: 'cumulé' },
          { label: 'Rev / call',    value: fmtEur(revPerCall), sub: 'par call honoré' },
          { label: 'No-show',       value: fmt(noShowCount),   sub: `${noShowRate}% des bookés` },
          { label: 'Calls IG',      value: fmt(igBookes),      sub: `${igCloses} closés` },
          { label: 'Calls YT',      value: fmt(ytBookes),      sub: `${ytCloses} closés` },
        ];

        return (
          <div style={{ borderRadius: 16, overflow: 'hidden', border: '1px solid var(--border)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)' }}>
              {heroItems.map((h, i) => {
                const isActive = expandedHero === i;
                return (
                  <div key={i}
                    onClick={() => { if (isActive) { setExpandedHero(null); setHeroSnapshot(null); onModalChange?.(false); } else { setExpandedHero(i); setHeroSnapshot({ label: h.label, value: h.value, sub: h.sub }); setModalPeriod(period); setModalPeriodIndex(periodIndex); onModalChange?.(true); } }}
                    style={{
                      padding: '22px 22px 18px',
                      background: isActive ? 'var(--surface-2)' : 'var(--surface)',
                      borderLeft: i % 4 > 0 ? '1px solid var(--border)' : 'none',
                      borderTop: i >= 4 ? '1px solid var(--border)' : 'none',
                      cursor: 'pointer',
                      transition: 'background .15s',
                      userSelect: 'none',
                    }}
                    onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--surface-2)'; }}
                    onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'var(--surface)'; }}
                  >
                    <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--muted)', marginBottom: 8 }}>{h.label}</div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--ink)', lineHeight: 1, marginBottom: 4 }}>{h.value}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{h.sub}</div>
                  </div>
                );
              })}
            </div>

            {/* Modale graphe au clic */}
            {expandedHero !== null && (
              <div
                style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
                onClick={() => setExpandedHero(null)}
              >
                <div
                  style={{ background: 'var(--surface)', borderRadius: 16, padding: '32px 36px 28px', width: '100%', maxWidth: 780, boxShadow: '0 24px 60px rgba(0,0,0,.18)' }}
                  onClick={e => e.stopPropagation()}
                >
                  {(() => {
                    const mn = period;

                    const totalBookes7 = igBookes + ytBookes;
                    const totalHonores7 = igHonores + ytHonores;
                    const totalCloses7 = igCloses + ytCloses;
                    const totalRev7 = igRev + ytRev;
                    const totalNS7 = igNoShows + ytNoShows;
                    const revPerCall7 = totalHonores7 > 0 ? Math.round(totalRev7 / totalHonores7) : 0;

                    // Pour les graphiques temporels, on utilise les vrais chartData quand disponibles
                    const igChartSlice = ig?.chartData.slice(-mn) || [];
                    const ytChartSlice = yt?.chartData.slice(-mn) || [];

                    const toCallsData = (subset: CallRecord[], key: 'booked' | 'honored' | 'closed' | 'rev') => {
                      const dates2 = Array.from({ length: mn }, (_, i) => {
                        const d = new Date(); d.setDate(d.getDate() - (mn - 1 - i));
                        return d.toISOString().split('T')[0];
                      });
                      return dates2.map(date => {
                        const dayStart = new Date(date).getTime();
                        const dayEnd = dayStart + 86400000;
                        const daySubset = subset.filter(c => {
                          const t = new Date(c.scheduled_at).getTime();
                          return t >= dayStart && t < dayEnd;
                        });
                        let v = 0;
                        if (key === 'booked') v = daySubset.filter(c => c.status === 'active').length;
                        else if (key === 'honored') v = daySubset.filter(c => c.status === 'active' && new Date(c.scheduled_at) < now && !c.no_show).length;
                        else if (key === 'closed') v = daySubset.filter(c => c.deal_closed).length;
                        else if (key === 'rev') v = daySubset.reduce((s, c) => s + (c.revenue || 0), 0);
                        return { date: new Date(date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }), v };
                      });
                    };

                    const modalCharts: { data: { date: string; v: number }[]; color: string; fmtV: (v: number) => string }[] = [
                      // 0 Calls bookés
                      { color: 'var(--ink)', fmtV: String, data: toCallsData([...callsIG, ...callsYT], 'booked') },
                      // 1 Calls honorés
                      { color: AMBER, fmtV: String, data: toCallsData([...callsIG, ...callsYT], 'honored') },
                      // 2 Deals closés
                      { color: GREEN, fmtV: String, data: toCallsData([...callsIG, ...callsYT], 'closed') },
                      // 3 Revenue total
                      { color: GREEN, fmtV: (v) => `${v} €`, data: toCallsData([...callsIG, ...callsYT], 'rev') },
                      // 4 Rev / call — moyenne sur la période
                      { color: GREEN, fmtV: (v) => `${Math.round(v)} €`, data: toCallsData([...callsIG, ...callsYT], 'honored').map(pt => ({ date: pt.date, v: pt.v > 0 ? revPerCall7 : 0 })) },
                      // 5 No-show
                      { color: RED, fmtV: String, data: toCallsData([...callsIG, ...callsYT].filter(c => c.no_show), 'booked') },
                      // 6 Calls IG
                      { color: IG_COLOR, fmtV: String, data: toCallsData(callsIG, 'booked') },
                      // 7 Calls YT
                      { color: YT_COLOR, fmtV: String, data: toCallsData(callsYT, 'booked') },
                    ];
                    const chart = modalCharts[expandedHero!];
                    return (<>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                        <div>
                          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{heroSnapshot?.label}</div>
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>{periodLabel(period, periodIndex)}</div>
                        </div>
                        <button onClick={() => { setExpandedHero(null); setHeroSnapshot(null); onModalChange?.(false); }} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--muted)', lineHeight: 1 }}>×</button>
                      </div>
                      <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--ink)', marginBottom: 16 }}>{heroSnapshot?.value}</div>
                      <ResponsiveContainer width="100%" height={220}>
                        <ReAreaChart data={chart.data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                          <defs>
                            <linearGradient id="grad-hero-modal" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor={chart.color} stopOpacity={0.2} />
                              <stop offset="95%" stopColor={chart.color} stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={fmtAxisDate} interval="preserveStartEnd" />
                          <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={28} allowDecimals={false} />
                          <Tooltip content={({ active, payload, label }) => {
                            if (!active || !payload?.length) return null;
                            return <div className="chart-tooltip"><div className="chart-tooltip-label">{label}</div><div className="chart-tooltip-row"><strong>{chart.fmtV(payload[0].value as number)}</strong></div></div>;
                          }} />
                          <Area type="monotone" dataKey="v" stroke={chart.color} strokeWidth={2} fill="url(#grad-hero-modal)" dot={false} activeDot={{ r: 4, strokeWidth: 0, fill: chart.color }} isAnimationActive={false} />
                        </ReAreaChart>
                      </ResponsiveContainer>
                    </>);
                  })()}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── FUNNELS & EFFICACITÉ ── */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--muted)', marginBottom: 28 }}>Funnels & Efficacité — {periodLabel(period, periodIndex)}</div>

        {/* Funnels */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 40, marginBottom: 32 }}>
          <FunnelHorizontal platform="Instagram" color={IG_COLOR} steps={igFunnelSteps} />
          <div style={{ height: 1, background: 'var(--border)' }} />
          <FunnelHorizontal platform="YouTube" color={YT_COLOR} steps={ytFunnelSteps} />
        </div>

        {/* Efficacité par plateforme */}
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--muted)', marginBottom: 16 }}>Efficacité par plateforme</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {effRows.map((row, ri) => (
            <div key={ri} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 20px', borderBottom: '1px solid var(--border-soft)' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: row.color }} />
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink)' }}>{row.platform}</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)' }}>
                {row.metrics.map((m, mi) => {
                  const d = m.delta;
                  const isGood = d ? (m.lowerIsBetter ? d.value < 0 : d.value > 0) : false;
                  const isBad  = d ? (m.lowerIsBetter ? d.value > 0 : d.value < 0) : false;
                  const absPct = d ? Math.abs(d.value) : 0;
                  const greenIntensity = Math.min(absPct / 30, 1);
                  const greenColor = isGood
                    ? `hsl(142, ${Math.round(50 + greenIntensity * 50)}%, ${Math.round(38 - greenIntensity * 8)}%)`
                    : undefined;
                  const deltaColor = d ? (isGood ? greenColor! : isBad ? RED : 'var(--muted)') : 'var(--muted)';
                  const mockEffData = Array.from({ length: period }, (_, i) => {
                    const date = new Date(); date.setDate(date.getDate() - (period - 1 - i));
                    const base = parseFloat(m.value.replace(/[^0-9.]/g, '')) || 100;
                    return { date: date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }), v: Math.max(0, base * (0.85 + Math.random() * 0.3)) };
                  });
                  return (
                    <div key={mi}
                      onClick={() => setExpandedEff({ label: `${row.platform} — ${m.label}`, value: m.value, color: row.color, data: mockEffData })}
                      style={{ padding: '16px 20px', borderLeft: mi > 0 ? '1px solid var(--border-soft)' : 'none', cursor: 'pointer', transition: 'background .15s' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                      onMouseLeave={e => e.currentTarget.style.background = ''}
                    >
                      <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted)', marginBottom: 6 }}>{m.label}</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink)', lineHeight: 1 }}>{m.value}</div>
                      {d && d.label !== '—' && (
                        <div style={{ marginTop: 6, display: 'flex', alignItems: 'baseline', gap: 6 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)' }}>{m.prevValue ?? '—'}</span>
                          <span style={{ fontSize: 11, fontWeight: 700, color: deltaColor }}>{d.label}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Modal efficacité */}
      {expandedEff && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={() => { setExpandedEff(null); onModalChange?.(false); }}>
          <div style={{ background: 'var(--surface)', borderRadius: 20, padding: '32px 32px 28px', width: '100%', maxWidth: 720, boxShadow: '0 24px 60px rgba(0,0,0,.18)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>{expandedEff.label}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Jour par jour · {period} derniers jours</div>
              </div>
              <button onClick={() => { setExpandedEff(null); onModalChange?.(false); }} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--muted)', lineHeight: 1 }}>×</button>
            </div>
            <div style={{ fontSize: 36, fontWeight: 800, color: 'var(--ink)', marginBottom: 20 }}>{expandedEff.value}</div>
            <ResponsiveContainer width="100%" height={220}>
              <ReAreaChart data={expandedEff.data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="grad-eff-modal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={expandedEff.color} stopOpacity={0.2} />
                    <stop offset="95%" stopColor={expandedEff.color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={fmtAxisDate} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={40} allowDecimals={false} />
                <Tooltip content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  return <div className="chart-tooltip"><div className="chart-tooltip-label">{label}</div><div className="chart-tooltip-row"><strong>{Math.round(payload[0].value as number)}</strong></div></div>;
                }} />
                <Area type="monotone" dataKey="v" stroke={expandedEff.color} strokeWidth={2} fill="url(#grad-eff-modal)" dot={false} activeDot={{ r: 4, strokeWidth: 0, fill: expandedEff.color }} isAnimationActive={false} />
              </ReAreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── SECTION CALLS TABLE ── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--muted)' }}>Calls</div>
          {/* Filtre plateforme */}
          <div style={{ display: 'flex', gap: 4, background: 'var(--surface-2)', borderRadius: 8, padding: 3 }}>
            {[
              { key: 'all', label: 'Tous' },
              { key: 'ig', label: 'Instagram' },
              { key: 'yt', label: 'YouTube' },
            ].map(opt => (
              <button key={opt.key} onClick={() => setCallsFilter(opt.key as 'all' | 'ig' | 'yt')} style={{
                fontSize: 11, fontWeight: 600, padding: '5px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
                background: callsFilter === opt.key ? 'var(--surface)' : 'transparent',
                color: callsFilter === opt.key ? 'var(--ink)' : 'var(--muted)',
                boxShadow: callsFilter === opt.key ? '0 1px 3px rgba(0,0,0,.08)' : 'none',
                transition: 'all .15s',
              }}>{opt.label}</button>
            ))}
          </div>
        </div>

        {/* Résumé stats */}
        <div style={{ display: 'flex', gap: 20, marginBottom: 12 }}>
          {[
            { label: 'Bookés', value: fmt(filteredCalls.filter(c => c.status === 'active').length), color: 'var(--ink)' },
            { label: 'Honorés', value: fmt(filteredCalls.filter(c => c.status === 'active' && new Date(c.scheduled_at) < now && !c.no_show).length), color: GREEN },
            { label: 'No-show', value: fmt(filteredCalls.filter(c => c.no_show).length), color: RED },
            { label: 'Closés', value: fmt(filteredCalls.filter(c => c.deal_closed).length), color: 'var(--accent)' },
            { label: 'Revenue', value: fmtEur(filteredCalls.reduce((acc, c) => acc + (c.revenue || 0), 0)), color: GREEN },
          ].map((s, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--muted)' }}>{s.label}</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>

        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Date', 'Client', 'Source', 'Statut', 'No-show', 'Closé', 'Revenue'].map((h, i) => (
                  <th key={i} style={{ textAlign: 'left', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted)', padding: '12px 14px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredCalls.slice(0, 20).map((c, i) => {
                const isPast = new Date(c.scheduled_at) < now;
                const isCanceled = c.status === 'canceled';
                const statusLabel = isCanceled
                  ? (c.rescheduled ? 'Rebooké' : 'Annulé')
                  : c.no_show ? 'No-show' : isPast ? 'Honoré' : 'À venir';
                const statusColor = isCanceled
                  ? (c.rescheduled ? AMBER : RED)
                  : c.no_show ? RED : isPast ? GREEN : 'var(--muted)';
                const srcParts = (c.source || '').split('_');
                const srcPlatform = srcParts[0];
                const srcMedium = srcParts.slice(1).join('_');
                const platformColor = srcPlatform.startsWith('ig') || srcPlatform.startsWith('instagram') ? IG_COLOR
                  : srcPlatform.startsWith('yt') || srcPlatform.startsWith('youtube') ? YT_COLOR
                  : 'var(--muted)';
                return (
                  <tr key={i} style={{ borderTop: '1px solid var(--border-soft)' }}>
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>{new Date(c.scheduled_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</div>
                      <div style={{ fontSize: 10, color: 'var(--muted)' }}>{new Date(c.scheduled_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</div>
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: 13, fontWeight: 500 }}>{c.invitee_name || c.invitee_email || '—'}</td>
                    <td style={{ padding: '12px 14px' }}>
                      {c.source ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: platformColor, textTransform: 'capitalize' }}>{srcPlatform}</span>
                          {srcMedium && <span style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'capitalize' }}>{srcMedium}</span>}
                        </div>
                      ) : <span style={{ fontSize: 11, color: 'var(--faint)' }}>—</span>}
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: statusColor }}>{statusLabel}</span>
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                      {c.no_show
                        ? <span style={{ fontSize: 13, color: RED }}>✕</span>
                        : isPast && !isCanceled
                          ? <span style={{ fontSize: 13, color: GREEN }}>✓</span>
                          : <span style={{ fontSize: 11, color: 'var(--faint)' }}>—</span>}
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                      {c.deal_closed === true && <span style={{ fontSize: 13, color: GREEN }}>✓</span>}
                      {c.deal_closed === false && <span style={{ fontSize: 13, color: RED }}>✕</span>}
                      {(c.deal_closed === undefined || c.deal_closed === null) && <span style={{ fontSize: 11, color: 'var(--faint)' }}>—</span>}
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: 13, fontWeight: 600, color: c.revenue ? GREEN : 'var(--faint)' }}>
                      {c.revenue ? fmtEur(c.revenue) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}

// ─── TAB 5 : Revenus ──────────────────────────────────────────────────────────

// ─── TAB "Funnel (détail)" — contrôles inline par section ───────────────────

function TabFunnelDetail({ msgs, calls, stripe, ig, yt, shortio, leads: leadsFromProp }: { msgs: IGMessages | null; calls: CallRecord[]; stripe: StripeStats | null; ig: IGStats | null; yt: YTStats | null; shortio: ShortioStats | null; leads?: MockLead[] }) {
  const leads = leadsFromProp && leadsFromProp.length > 0 ? leadsFromProp : [];
  const [period, setPeriod] = useState<Period>(30);
  const [periodIndex, setPeriodIndex] = useState(0);
  const [callsFilter, setCallsFilter] = useState<'all' | 'ig' | 'yt'>('all');
  const [expandedHero, setExpandedHero] = useState<number | null>(null);
  const [heroSnapshot, setHeroSnapshot] = useState<{ label: string; value: string; sub: string } | null>(null);
  const [expandedEff, setExpandedEff] = useState<{ label: string; value: string; color: string; data: { date: string; v: number }[] } | null>(null);

  const now = new Date();

  const callsIG = calls.filter(c => c.source?.startsWith('ig') || c.source?.startsWith('instagram'));
  const callsYT = calls.filter(c => c.source?.startsWith('yt') || c.source?.startsWith('youtube'));
  const calcCalls = (subset: CallRecord[]) => ({
    bookes: subset.filter(c => c.status === 'active').length,
    honores: subset.filter(c => c.status === 'active' && new Date(c.scheduled_at) < now && !c.no_show).length,
    closes: subset.filter(c => c.deal_closed).length,
    rev: subset.reduce((acc, c) => acc + (c.revenue || 0), 0),
    noShows: subset.filter(c => c.no_show).length,
  });
  const igCallsLive = calcCalls(callsIG);
  const ytCallsLive = calcCalls(callsYT);

  const igBookes  = igCallsLive.bookes;
  const igHonores = igCallsLive.honores;
  const igCloses  = igCallsLive.closes;
  const igRev     = igCallsLive.rev;
  const igReachD  = ig?.reach30d || 0;
  const igLeadsD  = msgs?.leadCount || 0;
  const igBioD    = ig?.profileLinksTaps30d || 0;

  const ytBookes  = ytCallsLive.bookes;
  const ytHonores = ytCallsLive.honores;
  const ytCloses  = ytCallsLive.closes;
  const ytRev     = ytCallsLive.rev;
  const ytViewsD  = yt?.views30d || 0;
  const ytClicsD  = 0;

  const totalBookes  = igBookes + ytBookes;
  const totalHonores = igHonores + ytHonores;
  const totalCloses  = igCloses + ytCloses;
  const totalRev     = igRev + ytRev;
  const closingRate  = totalHonores > 0 ? pct(totalCloses, totalHonores) : 0;
  const noShowRate   = totalBookes > 0 ? pct(calls.filter(c => c.no_show).length, totalBookes) : 0;
  const noShowCount  = calls.filter(c => c.no_show).length;
  const revPerCall   = totalHonores > 0 ? Math.round(totalRev / totalHonores) : 0;

  const igFunnelSteps = [
    { label: period === 7 ? 'Reach 7j' : 'Reach 30j', value: igReachD >= 1000 ? `${fmt(igReachD / 1000, 1)}k` : fmt(igReachD), rawValue: igReachD },
    { label: 'Leads commentaires', value: fmt(igLeadsD), sub: 'mots-clés détectés', rawValue: igLeadsD, rate: igReachD > 0 ? (igLeadsD / igReachD) * 100 : 0 },
    { label: 'Clics bio → Calendly', value: fmt(igBioD), sub: 'Short.io', rawValue: igBioD, rate: igReachD > 0 ? (igBioD / igReachD) * 100 : 0 },
    { label: 'Calls bookés', value: fmt(igBookes), rawValue: igBookes, rate: igBioD > 0 ? (igBookes / igBioD) * 100 : 0 },
    { label: 'Calls honorés', value: fmt(igHonores), rawValue: igHonores, rate: igBookes > 0 ? (igHonores / igBookes) * 100 : 0 },
    { label: 'Deals closés', value: fmt(igCloses), rawValue: igCloses, rate: igHonores > 0 ? (igCloses / igHonores) * 100 : 0 },
    { label: 'Revenue', value: fmtEur(igRev), rawValue: igRev },
  ];
  const ytFunnelSteps = [
    { label: period === 7 ? 'Vues 7j' : 'Vues 30j', value: ytViewsD >= 1000 ? `${fmt(ytViewsD / 1000, 1)}k` : fmt(ytViewsD), rawValue: ytViewsD },
    { label: 'Clics description → Calendly', value: fmt(ytClicsD), sub: 'Short.io', rawValue: ytClicsD, rate: ytViewsD > 0 ? (ytClicsD / ytViewsD) * 100 : 0 },
    { label: 'Calls bookés', value: fmt(ytBookes), rawValue: ytBookes, rate: ytClicsD > 0 ? (ytBookes / ytClicsD) * 100 : 0 },
    { label: 'Calls honorés', value: fmt(ytHonores), rawValue: ytHonores, rate: ytBookes > 0 ? (ytHonores / ytBookes) * 100 : 0 },
    { label: 'Deals closés', value: fmt(ytCloses), rawValue: ytCloses, rate: ytHonores > 0 ? (ytCloses / ytHonores) * 100 : 0 },
    { label: 'Revenue', value: fmtEur(ytRev), rawValue: ytRev },
  ];

  const igNoShows = igCallsLive.noShows;
  const ytNoShows = ytCallsLive.noShows;
  const igNoShowRate = igBookes > 0 ? pct(igNoShows, igBookes) : 0;
  const ytNoShowRate = ytBookes > 0 ? pct(ytNoShows, ytBookes) : 0;

  type EffMetric = { label: string; value: string; prevValue: string | null; delta: { value: number; label: string; color: string } | null; lowerIsBetter: boolean };
  const effRows: { platform: string; color: string; metrics: EffMetric[] }[] = [
    {
      platform: 'Instagram', color: IG_COLOR,
      metrics: [
        { label: 'Reach pour 1 call', value: igBookes > 0 ? fmt(Math.round(igReachD / igBookes)) : '—', prevValue: null, delta: null, lowerIsBetter: true },
        { label: 'No-show', value: igBookes > 0 ? `${igNoShowRate}%` : '—', prevValue: null, delta: null, lowerIsBetter: true },
        { label: 'Close rate', value: igHonores > 0 ? `${pct(igCloses, igHonores)}%` : '—', prevValue: null, delta: null, lowerIsBetter: false },
        { label: 'Rev / call honoré', value: igHonores > 0 ? fmtEur(Math.round(igRev / igHonores)) : '—', prevValue: null, delta: null, lowerIsBetter: false },
        { label: 'Revenue total', value: fmtEur(igRev), prevValue: null, delta: null, lowerIsBetter: false },
      ],
    },
    {
      platform: 'YouTube', color: YT_COLOR,
      metrics: [
        { label: 'Vues pour 1 call', value: ytBookes > 0 ? fmt(Math.round(ytViewsD / ytBookes)) : '—', prevValue: null, delta: null, lowerIsBetter: true },
        { label: 'No-show', value: ytBookes > 0 ? `${ytNoShowRate}%` : '—', prevValue: null, delta: null, lowerIsBetter: true },
        { label: 'Close rate', value: ytHonores > 0 ? `${pct(ytCloses, ytHonores)}%` : '—', prevValue: null, delta: null, lowerIsBetter: false },
        { label: 'Rev / call honoré', value: ytHonores > 0 ? fmtEur(Math.round(ytRev / ytHonores)) : '—', prevValue: null, delta: null, lowerIsBetter: false },
        { label: 'Revenue total', value: fmtEur(ytRev), prevValue: null, delta: null, lowerIsBetter: false },
      ],
    },
  ];

  const filteredCalls = callsFilter === 'ig' ? callsIG : callsFilter === 'yt' ? callsYT : calls;
  const SCtrl = () => <SectionControls period={period} setPeriod={setPeriod} periodIndex={periodIndex} setPeriodIndex={setPeriodIndex} />;

  // Hero chart data (mock jour par jour)
  const n = period;
  const heroCharts: { data: { date: string; v: number }[]; color: string; fmtV: (v: number) => string }[] = [
    { color: 'var(--ink)', fmtV: String, data: Array.from({ length: n }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (n - 1 - i)); return { date: d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }), v: [0,0,1,0,0,0,1,0,0,0,0,1,0,0,0,0,0,0,1,0,0,1,0,0,0,0,0,0,1,0][i] || 0 }; }) },
    { color: AMBER, fmtV: String, data: Array.from({ length: n }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (n - 1 - i)); return { date: d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }), v: [0,0,1,0,0,0,1,0,0,0,0,1,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,1,0][i] || 0 }; }) },
    { color: GREEN, fmtV: String, data: Array.from({ length: n }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (n - 1 - i)); return { date: d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }), v: [0,0,0,0,0,0,1,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0][i] || 0 }; }) },
    { color: GREEN, fmtV: (v) => `${v} €`, data: Array.from({ length: n }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (n - 1 - i)); return { date: d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }), v: [0,0,0,0,0,0,1200,0,0,0,0,1200,0,0,0,0,0,0,0,0,0,2400,0,0,0,0,0,0,1200,0][i] || 0 }; }) },
    { color: GREEN, fmtV: (v) => `${Math.round(v)} €`, data: Array.from({ length: n }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (n - 1 - i)); return { date: d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }), v: 780 + Math.round((Math.sin(i * 1.3) - 0.5) * 200) }; }) },
    { color: RED, fmtV: String, data: Array.from({ length: n }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (n - 1 - i)); return { date: d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }), v: [0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0][i] || 0 }; }) },
    { color: IG_COLOR, fmtV: String, data: Array.from({ length: n }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (n - 1 - i)); return { date: d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }), v: [0,0,1,0,0,0,1,0,0,0,0,1,0,0,0,0,0,0,1,0,0,1,0,0,0,0,0,0,0,0][i] || 0 }; }) },
    { color: YT_COLOR, fmtV: String, data: Array.from({ length: n }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (n - 1 - i)); return { date: d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }), v: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,1,0][i] || 0 }; }) },
  ];

  const heroItems = [
    { label: 'Calls bookés',  value: fmt(totalBookes),   sub: 'toutes sources' },
    { label: 'Calls honorés', value: fmt(totalHonores),  sub: `${noShowRate}% no-show` },
    { label: 'Deals closés',  value: fmt(totalCloses),   sub: `${closingRate}% closing` },
    { label: 'Revenue total', value: fmtEur(totalRev),   sub: 'cumulé' },
    { label: 'Rev / call',    value: fmtEur(revPerCall), sub: 'par call honoré' },
    { label: 'No-show',       value: fmt(noShowCount),   sub: `${noShowRate}% des bookés` },
    { label: 'Calls IG',      value: fmt(igBookes),      sub: `${igCloses} closés` },
    { label: 'Calls YT',      value: fmt(ytBookes),      sub: `${ytCloses} closés` },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 48 }}>

      {/* Hero stats cliquables */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--muted)' }}>Vue d'ensemble</div>
          <SCtrl />
        </div>
        <div style={{ borderRadius: 16, overflow: 'hidden', border: '1px solid var(--border)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)' }}>
            {heroItems.map((h, i) => {
              const isActive = expandedHero === i;
              return (
                <div key={i}
                  onClick={() => { if (isActive) { setExpandedHero(null); setHeroSnapshot(null); } else { setExpandedHero(i); setHeroSnapshot(h); } }}
                  style={{ padding: '22px 22px 18px', background: isActive ? 'var(--surface-2)' : 'var(--surface)', borderLeft: i % 4 > 0 ? '1px solid var(--border)' : 'none', borderTop: i >= 4 ? '1px solid var(--border)' : 'none', cursor: 'pointer', transition: 'background .15s', userSelect: 'none' }}
                  onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--surface-2)'; }}
                  onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'var(--surface)'; }}>
                  <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--muted)', marginBottom: 8 }}>{h.label}</div>
                  <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--ink)', lineHeight: 1, marginBottom: 4 }}>{h.value}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{h.sub}</div>
                </div>
              );
            })}
          </div>
        </div>

        {expandedHero !== null && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
            onClick={() => { setExpandedHero(null); setHeroSnapshot(null); }}>
            <div style={{ background: 'var(--surface)', borderRadius: 16, padding: '32px 36px 28px', width: '100%', maxWidth: 780, boxShadow: '0 24px 60px rgba(0,0,0,.18)' }}
              onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{heroSnapshot?.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>{periodLabel(period, periodIndex)}</div>
                </div>
                <button onClick={() => { setExpandedHero(null); setHeroSnapshot(null); }} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--muted)', lineHeight: 1 }}>×</button>
              </div>
              <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--ink)', marginBottom: 16 }}>{heroSnapshot?.value}</div>
              <ResponsiveContainer width="100%" height={220}>
                <ReAreaChart data={heroCharts[expandedHero!].data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="grad-heroB-modal" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={heroCharts[expandedHero!].color} stopOpacity={0.2} />
                      <stop offset="95%" stopColor={heroCharts[expandedHero!].color} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={fmtAxisDate} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={28} allowDecimals={false} />
                  <Tooltip content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    return <div className="chart-tooltip"><div className="chart-tooltip-label">{label}</div><div className="chart-tooltip-row"><strong>{heroCharts[expandedHero!].fmtV(payload[0].value as number)}</strong></div></div>;
                  }} />
                  <Area type="monotone" dataKey="v" stroke={heroCharts[expandedHero!].color} strokeWidth={2} fill="url(#grad-heroB-modal)" dot={false} activeDot={{ r: 4, strokeWidth: 0, fill: heroCharts[expandedHero!].color }} isAnimationActive={false} />
                </ReAreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* Funnels */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--muted)' }}>Funnels & Efficacité — {periodLabel(period, periodIndex)}</div>
          <SCtrl />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 40, marginBottom: 32 }}>
          <FunnelHorizontal platform="Instagram" color={IG_COLOR} steps={igFunnelSteps} />
          <div style={{ height: 1, background: 'var(--border)' }} />
          <FunnelHorizontal platform="YouTube" color={YT_COLOR} steps={ytFunnelSteps} />
        </div>

        {/* Efficacité */}
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--muted)', marginBottom: 16 }}>Efficacité par plateforme</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {effRows.map((row, ri) => (
            <div key={ri} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 20px', borderBottom: '1px solid var(--border-soft)' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: row.color }} />
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink)' }}>{row.platform}</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)' }}>
                {row.metrics.map((m, mi) => {
                  const d = m.delta;
                  const isGood = d ? (m.lowerIsBetter ? d.value < 0 : d.value > 0) : false;
                  const isBad  = d ? (m.lowerIsBetter ? d.value > 0 : d.value < 0) : false;
                  const absPct = d ? Math.abs(d.value) : 0;
                  const greenIntensity = Math.min(absPct / 30, 1);
                  const greenColor = isGood ? `hsl(142, ${Math.round(50 + greenIntensity * 50)}%, ${Math.round(38 - greenIntensity * 8)}%)` : undefined;
                  const deltaColor = d ? (isGood ? greenColor! : isBad ? RED : 'var(--muted)') : 'var(--muted)';
                  const mockEffData = Array.from({ length: period }, (_, i) => {
                    const date = new Date(); date.setDate(date.getDate() - (period - 1 - i));
                    const base = parseFloat(m.value.replace(/[^0-9.]/g, '')) || 100;
                    return { date: date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }), v: Math.max(0, base * (0.85 + Math.sin(i * 1.7 + mi) * 0.15)) };
                  });
                  return (
                    <div key={mi}
                      onClick={() => setExpandedEff({ label: `${row.platform} — ${m.label}`, value: m.value, color: row.color, data: mockEffData })}
                      style={{ padding: '12px 16px', borderLeft: mi > 0 ? '1px solid var(--border-soft)' : 'none', cursor: 'pointer', transition: 'background .15s' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                      onMouseLeave={e => e.currentTarget.style.background = ''}>
                      <div style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted)', marginBottom: 4 }}>{m.label}</div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                        <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink)', lineHeight: 1 }}>{m.value}</div>
                        {d && d.label !== '—' && <span style={{ fontSize: 11, fontWeight: 700, color: deltaColor }}>{d.label}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Modal efficacité */}
      {expandedEff && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={() => setExpandedEff(null)}>
          <div style={{ background: 'var(--surface)', borderRadius: 20, padding: '32px 32px 28px', width: '100%', maxWidth: 720, boxShadow: '0 24px 60px rgba(0,0,0,.18)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>{expandedEff.label}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Jour par jour · {period} derniers jours</div>
              </div>
              <button onClick={() => setExpandedEff(null)} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--muted)', lineHeight: 1 }}>×</button>
            </div>
            <div style={{ fontSize: 36, fontWeight: 800, color: 'var(--ink)', marginBottom: 20 }}>{expandedEff.value}</div>
            <ResponsiveContainer width="100%" height={220}>
              <ReAreaChart data={expandedEff.data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="grad-effB-modal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={expandedEff.color} stopOpacity={0.2} />
                    <stop offset="95%" stopColor={expandedEff.color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={fmtAxisDate} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={40} allowDecimals={false} />
                <Tooltip content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  return <div className="chart-tooltip"><div className="chart-tooltip-label">{label}</div><div className="chart-tooltip-row"><strong>{Math.round(payload[0].value as number)}</strong></div></div>;
                }} />
                <Area type="monotone" dataKey="v" stroke={expandedEff.color} strokeWidth={2} fill="url(#grad-effB-modal)" dot={false} activeDot={{ r: 4, strokeWidth: 0, fill: expandedEff.color }} isAnimationActive={false} />
              </ReAreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Table calls */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--muted)' }}>Calls</div>
          <div style={{ display: 'flex', gap: 4, background: 'var(--surface-2)', borderRadius: 8, padding: 3 }}>
            {[{ key: 'all', label: 'Tous' }, { key: 'ig', label: 'Instagram' }, { key: 'yt', label: 'YouTube' }].map(opt => (
              <button key={opt.key} onClick={() => setCallsFilter(opt.key as 'all' | 'ig' | 'yt')} style={{ fontSize: 11, fontWeight: 600, padding: '5px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', background: callsFilter === opt.key ? 'var(--surface)' : 'transparent', color: callsFilter === opt.key ? 'var(--ink)' : 'var(--muted)', boxShadow: callsFilter === opt.key ? '0 1px 3px rgba(0,0,0,.08)' : 'none', transition: 'all .15s' }}>{opt.label}</button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 20, marginBottom: 12 }}>
          {[
            { label: 'Bookés', value: fmt(filteredCalls.filter(c => c.status === 'active').length), color: 'var(--ink)' },
            { label: 'Honorés', value: fmt(filteredCalls.filter(c => c.status === 'active' && new Date(c.scheduled_at) < now && !c.no_show).length), color: GREEN },
            { label: 'No-show', value: fmt(filteredCalls.filter(c => c.no_show).length), color: RED },
            { label: 'Closés', value: fmt(filteredCalls.filter(c => c.deal_closed).length), color: 'var(--accent)' },
            { label: 'Revenue', value: fmtEur(filteredCalls.reduce((acc, c) => acc + (c.revenue || 0), 0)), color: GREEN },
          ].map((s, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--muted)' }}>{s.label}</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>

        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Date', 'Client', 'Source', 'Statut', 'No-show', 'Closé', 'Revenue'].map((h, i) => (
                  <th key={i} style={{ textAlign: 'left', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted)', padding: '12px 14px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredCalls.slice(0, 20).map((c, i) => {
                const isPast = new Date(c.scheduled_at) < now;
                const isCanceled = c.status === 'canceled';
                const statusLabel = isCanceled ? (c.rescheduled ? 'Rebooké' : 'Annulé') : c.no_show ? 'No-show' : isPast ? 'Honoré' : 'À venir';
                const statusColor = isCanceled ? (c.rescheduled ? AMBER : RED) : c.no_show ? RED : isPast ? GREEN : 'var(--muted)';
                const srcParts = (c.source || '').split('_');
                const srcPlatform = srcParts[0];
                const srcMedium = srcParts.slice(1).join('_');
                const platformColor = srcPlatform.startsWith('ig') || srcPlatform.startsWith('instagram') ? IG_COLOR : srcPlatform.startsWith('yt') || srcPlatform.startsWith('youtube') ? YT_COLOR : 'var(--muted)';
                return (
                  <tr key={i} style={{ borderTop: '1px solid var(--border-soft)' }}>
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>{new Date(c.scheduled_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</div>
                      <div style={{ fontSize: 10, color: 'var(--muted)' }}>{new Date(c.scheduled_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</div>
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: 13, fontWeight: 500 }}>{c.invitee_name || c.invitee_email || '—'}</td>
                    <td style={{ padding: '12px 14px' }}>
                      {c.source ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: platformColor, textTransform: 'capitalize' }}>{srcPlatform}</span>
                          {srcMedium && <span style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'capitalize' }}>{srcMedium}</span>}
                        </div>
                      ) : <span style={{ fontSize: 11, color: 'var(--faint)' }}>—</span>}
                    </td>
                    <td style={{ padding: '12px 14px' }}><span style={{ fontSize: 11, fontWeight: 600, color: statusColor }}>{statusLabel}</span></td>
                    <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                      {c.no_show ? <span style={{ fontSize: 13, color: RED }}>✕</span> : isPast && !isCanceled ? <span style={{ fontSize: 13, color: GREEN }}>✓</span> : <span style={{ fontSize: 11, color: 'var(--faint)' }}>—</span>}
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                      {c.deal_closed === true && <span style={{ fontSize: 13, color: GREEN }}>✓</span>}
                      {c.deal_closed === false && <span style={{ fontSize: 13, color: RED }}>✕</span>}
                      {(c.deal_closed === undefined || c.deal_closed === null) && <span style={{ fontSize: 11, color: 'var(--faint)' }}>—</span>}
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: 13, fontWeight: 600, color: c.revenue ? GREEN : 'var(--faint)' }}>{c.revenue ? fmtEur(c.revenue) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}

function TabRevenues({ stripe, period }: { stripe: StripeStats | null; period: Period }) {
  const [payFilter, setPayFilter] = useState<'all' | 'succeeded' | 'failed'>('all');
  if (!stripe) return <Empty msg="Connecte ton compte Stripe pour voir les revenus." />;

  const cutoff = new Date(Date.now() - period * 86400000);
  const allInPeriod = stripe.recentPayments.filter(p => new Date(p.date) >= cutoff);
  const succeeded = allInPeriod.filter(p => p.status === 'succeeded');
  const failed = allInPeriod.filter(p => p.status !== 'succeeded');

  const cashCollecte = succeeded.reduce((s, p) => s + p.amount, 0);
  const avgBasket = succeeded.length > 0 ? cashCollecte / succeeded.length : 0;
  const failedPct = allInPeriod.length > 0 ? pct(failed.length, allInPeriod.length) : 0;

  const today = new Date();
  const revenueByDay: { date: string; ca: number }[] = Array.from({ length: period }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (period - 1 - i));
    const iso = d.toISOString().split('T')[0];
    const ca = succeeded.filter(p => p.date.startsWith(iso)).reduce((s, p) => s + p.amount, 0);
    const label = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    return { date: label, _iso: iso, ca } as any;
  });

  return (
    <div className="stack">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '12px 14px' }}>
          <div style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)', marginBottom: 6 }}>Cash collecté</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: GREEN, lineHeight: 1 }}>{fmtEur(cashCollecte)}</div>
          <div style={{ fontSize: 10, color: 'var(--faint)', marginTop: 4 }}>paiements reçus ({succeeded.length})</div>
        </div>
        <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '12px 14px' }}>
          <div style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)', marginBottom: 6 }}>Solde disponible</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink)', lineHeight: 1 }}>{fmtEur(stripe.availableBalance)}</div>
          <div style={{ fontSize: 10, color: 'var(--faint)', marginTop: 4 }}>sur le compte Stripe</div>
        </div>
        <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '12px 14px' }}>
          <div style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)', marginBottom: 6 }}>Panier moyen</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink)', lineHeight: 1 }}>{fmtEur(Math.round(avgBasket))}</div>
          <div style={{ fontSize: 10, color: 'var(--faint)', marginTop: 4 }}>par paiement réussi</div>
        </div>
        <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '12px 14px' }}>
          <div style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)', marginBottom: 6 }}>Taux d&apos;échec</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: failedPct > 10 ? RED : failedPct > 5 ? AMBER : GREEN, lineHeight: 1 }}>{failedPct}%</div>
          <div style={{ fontSize: 10, color: 'var(--faint)', marginTop: 4 }}>{failed.length} paiement{failed.length !== 1 ? 's' : ''} échoué{failed.length !== 1 ? 's' : ''}</div>
        </div>
      </div>

      <Card title="Revenus / jour" sub={`${period} derniers jours · paiements Stripe`}>
        <BarChart data={revenueByDay} bars={[{ key: 'ca', label: 'Cash collecté', color: GREEN }]} xKey="date" height={200} formatter={fmtEur} xInterval={period === 7 ? 0 : Math.floor(period / 7) - 1} />
      </Card>

      <div className="card">
        <div className="card-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="card-title">Derniers paiements</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {([['all', 'Tous'], ['succeeded', 'Réussis'], ['failed', 'Échoués']] as const).map(([key, label]) => (
              <button key={key} onClick={() => setPayFilter(key)} style={{ padding: '4px 12px', fontSize: 11, fontWeight: 600, borderRadius: 20, cursor: 'pointer', border: `1px solid ${payFilter === key ? (key === 'failed' ? RED : key === 'succeeded' ? GREEN : 'var(--ink)') : 'var(--border)'}`, background: payFilter === key ? (key === 'failed' ? RED + '15' : key === 'succeeded' ? GREEN + '15' : 'var(--surface-2)') : 'transparent', color: payFilter === key ? (key === 'failed' ? RED : key === 'succeeded' ? GREEN : 'var(--ink)') : 'var(--muted)', transition: 'all .12s' }}>{label}</button>
            ))}
          </div>
        </div>
        <table className="table" style={{ width: '100%' }}>
          <thead>
            <tr>
              {['Date', 'Description', 'Montant', 'Statut'].map((h, i) => (
                <th key={i} style={{ textAlign: 'left', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', color: 'var(--muted)', padding: '8px 10px' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stripe.recentPayments.filter(p => payFilter === 'all' || (payFilter === 'succeeded' ? p.status === 'succeeded' : p.status !== 'succeeded')).map((p, i) => (
              <tr key={i} style={{ borderTop: '1px solid var(--border-soft)' }}>
                <td style={{ padding: '10px', fontSize: 12, color: 'var(--muted)' }}>{new Date(p.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: '2-digit' })}</td>
                <td style={{ padding: '10px', fontSize: 12 }}>{p.description || '—'}</td>
                <td style={{ padding: '10px', fontSize: 13, fontWeight: 700 }}>{fmtEur(p.amount)}</td>
                <td style={{ padding: '10px' }}>
                  <span style={{ fontSize: 11, color: p.status === 'succeeded' ? GREEN : RED, fontWeight: 600 }}>
                    {p.status === 'succeeded' ? 'Réussi' : 'Échoué'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── TAB 6 : Short.io ─────────────────────────────────────────────────────────

interface ShortDomain { id: string | number; hostname: string; }

interface MockLead {
  igUserId: string;
  igUsername: string;
  igAvatar?: string;
  postId: string;
  postTitle: string;
  postType: 'IG' | 'YT';
  commentedAt: string;
  keyword: string;
  leadMagnetSent: boolean;
  hookReplied?: boolean;
  trackingLink?: string | null;
}

interface DestinationLink {
  id: string;
  label: string;
  url: string;
  type: 'calendly' | 'leadmagnet' | 'other';
}


function TabShortio({ shortio, ig, yt, profileId, period }: {
  shortio: ShortioStats | null;
  ig: IGStats | null;
  yt: YTStats | null;
  profileId?: string;
  period: Period;
}) {
  const [selectedLink, setSelectedLink] = useState<ShortioLink | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [domains, setDomains] = useState<ShortDomain[]>([]);
  const [domainsLoading, setDomainsLoading] = useState(false);

  // modal state
  const [createMode, setCreateMode] = useState<'lead' | 'manual'>('lead');
  const [selectedDomain, setSelectedDomain] = useState<ShortDomain | null>(null);
  const [selectedLead, setSelectedLead] = useState<MockLead | null>(null);
  const [leadSearch, setLeadSearch] = useState('');
  const [selectedDest, setSelectedDest] = useState<DestinationLink | null>(null);
  const [manualUsername, setManualUsername] = useState('');
  const [manualPostId, setManualPostId] = useState('');
  const [customPath, setCustomPath] = useState('');
  const [creating, setCreating] = useState(false);
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const resetModal = () => {
    setCreatedLink(null); setCreateError(null);
    setSelectedLead(null); setLeadSearch('');
    setManualUsername(''); setManualPostId(''); setCustomPath('');
    setCreateMode('lead');
    setSelectedDest(null);
  };

  const openCreate = async () => {
    resetModal();
    setShowCreate(true);
    if (domains.length > 0) return;
    setDomainsLoading(true);
    try {
      const url = profileId ? `/api/shortio/domains?profileId=${profileId}` : '/api/shortio/domains';
      const res = await fetch(url);
      const data = await res.json();
      // En mode mock on simule le domaine
      const list: ShortDomain[] = data.domains?.length ? data.domains : [{ id: 'mock', hostname: 'qnl.link' }];
      setDomains(list);
      if (list.length > 0) setSelectedDomain(list[0]);
    } catch {
      setDomains([{ id: 'mock', hostname: 'qnl.link' }]);
      setSelectedDomain({ id: 'mock', hostname: 'qnl.link' });
    } finally {
      setDomainsLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!selectedDomain) return;
    if (createMode === 'lead' && !selectedLead) return;
    if (createMode === 'manual' && !manualUsername.trim()) return;

    setCreating(true);
    setCreateError(null);
    try {
      const igId = createMode === 'lead' ? selectedLead!.igUserId : `manual-${manualUsername.trim().replace(/\s+/g, '-')}`;
      const postId = createMode === 'lead' ? selectedLead!.postId : (manualPostId || 'unknown');
      const slug = customPath.trim() || (createMode === 'lead'
        ? selectedLead!.igUsername.replace(/[^a-z0-9]/gi, '-').toLowerCase()
        : manualUsername.trim().replace(/[^a-z0-9]/gi, '-').toLowerCase());

      const res = await fetch('/api/shortio/links', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          profileId,
          domainId: selectedDomain.hostname,
          originalUrl: selectedDest?.url ?? '',
          title: `${selectedDest?.label ?? ''} — ${createMode === 'lead' ? selectedLead!.igUsername : manualUsername}`,
          utmSource: selectedDomain.hostname,
          utmMedium: 'dm',
          utmCampaign: `lead-${igId}`,
          utmContent: postId,
          path: slug,
        }),
      });
      const data = await res.json();
      // En mode mock on simule le résultat
      setCreatedLink(data.shortUrl || `${selectedDomain.hostname}/${slug}`);
    } catch (e: any) {
      setCreateError(e.message || 'Erreur lors de la création');
    } finally {
      setCreating(false);
    }
  };

  const copyLink = () => {
    if (!createdLink) return;
    navigator.clipboard.writeText(createdLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const filteredLeads = ([] as MockLead[]).filter(l =>
    !leadSearch || l.igUsername.toLowerCase().includes(leadSearch.toLowerCase()) || l.postTitle.toLowerCase().includes(leadSearch.toLowerCase())
  );

  const daysSince = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);

  if (!shortio) return <Empty msg="Connecte ton compte Short.io pour voir les stats." />;

  const bioLinks    = shortio.links.filter((l: any) => l.linkType === 'bio');
  const postLinks   = shortio.links.filter((l: any) => l.linkType === 'post');
  const prospectLinks = shortio.links.filter((l: any) => l.linkType === 'prospect');

  const igPosts = ig?.posts || [];
  const ytVideos = yt?.videos || [];

  // Retrouver thumbnail/type du contenu source d'un lien post
  const getPostMeta = (l: any) => {
    if (l.postPlatform === 'IG') {
      const p = igPosts.find(p => p.id === l.postId);
      return { thumbnail: p?.thumbnail || null, type: p?.type === 'VIDEO' ? 'Reel' : p?.type === 'CAROUSEL_ALBUM' ? 'Carousel' : 'Image', label: 'IG' };
    }
    const v = ytVideos.find(v => v.id === l.postId);
    return { thumbnail: v?.thumbnail || null, type: v?.isShort ? 'Short' : 'Vidéo', label: 'YT' };
  };

  // Tableau consolidé par vidéo — toutes les vidéos avec au moins une activité business
  const allPostIds = Array.from(new Set([
    ...postLinks.map((l: any) => l.postId + '|' + l.postPlatform),
    ...prospectLinks.map((l: any) => l.postId + '|' + (l.postPlatform || (l.postId?.startsWith('v') ? 'YT' : 'IG'))),
  ]));

  const consolidatedRows = allPostIds.map(key => {
    const [postId, platform] = key.split('|');
    const descLink = postLinks.find((l: any) => l.postId === postId);
    const dmLinks = prospectLinks.filter((l: any) => l.postId === postId);
    const postLeads: MockLead[] = [];
    const igPost = platform === 'IG' ? igPosts.find(p => p.id === postId) : null;
    const ytVideo = platform === 'YT' ? ytVideos.find(v => v.id === postId) : null;
    const title = igPost?.caption || ytVideo?.title || descLink?.title || postId;
    const thumbnail = igPost?.thumbnail || ytVideo?.thumbnail || null;
    const type = igPost ? (igPost.type === 'VIDEO' ? 'Reel' : igPost.type === 'CAROUSEL_ALBUM' ? 'Carousel' : 'Image') : (ytVideo?.isShort ? 'Short' : 'Vidéo');

    const clicsDesc = descLink?.humanClicks30d || 0;
    const clicsDM = dmLinks.reduce((s: number, l: any) => s + (l.humanClicks30d || 0), 0);
    const leadsCount = postLeads.length;
    const lmCount = postLeads.filter((l: MockLead) => l.leadMagnetSent).length;
    const dmCount = dmLinks.length;
    const callsCount = dmLinks.filter((l: any) => l.callBooked).length;
    const closedCount = dmLinks.filter((l: any) => l.dealClosed === true).length;
    const revenue = dmLinks.reduce((s: number, l: any) => s + (l.revenue || 0), 0);

    return { postId, platform, title, thumbnail, type, descLink, dmLinks, leadsCount, lmCount, dmCount, clicsDesc, clicsDM, callsCount, closedCount, revenue };
  }).sort((a, b) => (b.clicsDesc + b.clicsDM + b.revenue) - (a.clicsDesc + a.clicsDM + a.revenue));

  // Insight prospects
  const prospectsWithCall = prospectLinks.filter((l: any) => l.callBooked);
  const prospectsConverted = prospectLinks.filter((l: any) => l.dealClosed);
  const prospectRevenue = prospectLinks.reduce((s: number, l: any) => s + (l.revenue || 0), 0);
  const convRate = prospectLinks.length > 0 ? Math.round((prospectsWithCall.length / prospectLinks.length) * 100) : 0;
  const avgDelayLinks = prospectLinks.filter((l: any) => l.clickToCallDays != null);
  const avgDelay = avgDelayLinks.length > 0
    ? Math.round(avgDelayLinks.reduce((s: number, l: any) => s + l.clickToCallDays, 0) / avgDelayLinks.length * 10) / 10
    : null;

  const topRef = (l: ShortioLink) => l.referrers?.[0]?.label || '—';

  const SectionHeader = ({ title, sub, action }: { title: string; sub: string; action?: React.ReactNode }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700 }}>{title}</div>
        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>
      </div>
      {action}
    </div>
  );

  return (
    <div className="stack">

      {/* Stats globales */}
      <StatGrid>
        <Stat label="Domaine" value={shortio.domain} />
        <Stat label="Liens actifs" value={fmt(shortio.totalLinks)} />
        <Stat label="Clics 30j" value={fmt(shortio.clicks30d)} />
        <Stat label="Clics humains 30j" value={fmt(shortio.humanClicks30d)} />
        <Stat label="Variation" value={shortio.clicksChange !== null ? `${shortio.clicksChange >= 0 ? '+' : ''}${fmtPct(shortio.clicksChange)}` : '—'} color={shortio.clicksChange !== null ? (shortio.clicksChange >= 0 ? GREEN : RED) : undefined} />
        <Stat label="Moy. / lien" value={fmt(shortio.clicksPerLink30d, 1)} />
      </StatGrid>

      {/* Insight prospects */}
      {prospectLinks.length > 0 && (
        <div style={{ background: BLUE + '10', border: `1px solid ${BLUE}28`, borderRadius: 12, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 18 }}>📊</div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', marginBottom: 2 }}>
              {prospectLinks.length} liens prospects · {prospectsWithCall.length} calls bookés
              {prospectsWithCall.length > 0 && <span style={{ color: BLUE, marginLeft: 6, fontWeight: 600 }}>({convRate}%)</span>}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {prospectsConverted.length > 0 && <span>{prospectsConverted.length} deal{prospectsConverted.length > 1 ? 's' : ''} closé{prospectsConverted.length > 1 ? 's' : ''} · <strong style={{ color: GREEN }}>{fmtEur(prospectRevenue)}</strong></span>}
              {avgDelay !== null && <span>Délai moyen clic → call : <strong>{avgDelay}j</strong></span>}
            </div>
          </div>
        </div>
      )}

      {/* Graphique global */}
      <Card title="Clics par jour" sub="30 jours — tous liens confondus">
        <AreaChart data={shortio.chartData} areas={[{ key: 'clicks', label: 'Clics', color: BLUE }]} xKey="date" height={180} />
      </Card>

      {/* ── Section 1 : Bios ── */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px 22px' }}>
        <SectionHeader title="Liens bio" sub="Un lien fixe par plateforme — toujours dans la bio" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {bioLinks.map((l: any, i: number) => (
            <div key={i} onClick={() => setSelectedLink(l)} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', cursor: 'pointer', transition: 'background .12s' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
              onMouseLeave={e => (e.currentTarget.style.background = '')}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 20 }}>{l.bioType === 'instagram' ? '📸' : '▶️'}</span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{l.bioType === 'instagram' ? 'Bio Instagram' : 'Bio YouTube'}</div>
                  <div style={{ fontSize: 11, color: BLUE }}>{l.shortUrl}</div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                {[
                  { label: 'Clics 30j', value: fmt(l.humanClicks30d) },
                  { label: 'Top source', value: topRef(l) },
                  { label: 'Variation', value: l.clicksChange !== null ? `${l.clicksChange >= 0 ? '+' : ''}${fmtPct(l.clicksChange)}` : '—', color: l.clicksChange !== null ? (l.clicksChange >= 0 ? GREEN : RED) : 'var(--muted)' },
                ].map((s, j) => (
                  <div key={j}>
                    <div style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 2 }}>{s.label}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: (s as any).color || 'var(--ink)' }}>{s.value}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Section 2 : Vue consolidée par contenu ── */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px 22px' }}>
        <SectionHeader
          title="Performance par contenu"
          sub={`${consolidatedRows.length} contenus avec activité business — funnel complet`}
          action={
            <button onClick={openCreate} style={{ padding: '8px 16px', fontSize: 12, fontWeight: 600, borderRadius: 8, cursor: 'pointer', background: BLUE, color: '#fff', border: 'none', transition: 'opacity .15s' }}
              onMouseEnter={e => (e.currentTarget.style.opacity = '.85')} onMouseLeave={e => (e.currentTarget.style.opacity = '1')}>
              + Générer un lien
            </button>
          }
        />
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 780 }}>
            <thead>
              <tr>
                {[
                  { label: '', align: 'left' },
                  { label: 'Contenu', align: 'left' },
                  { label: 'Lien desc.', align: 'left' },
                  { label: 'Clics desc.', align: 'right' },
                  { label: 'Leads', align: 'right' },
                  { label: 'LM envoyés', align: 'right' },
                  { label: 'DM trackés', align: 'right' },
                  { label: 'Clics DM', align: 'right' },
                  { label: 'Calls', align: 'right' },
                  { label: 'Closés', align: 'right' },
                  { label: 'Revenue', align: 'right' },
                ].map((h, i) => (
                  <th key={i} style={{ textAlign: h.align as any, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', color: 'var(--muted)', padding: '6px 10px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {consolidatedRows.map((row, i) => {
                const platformColor = row.platform === 'IG' ? ACCENT : RED;
                return (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border-soft)' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                    onMouseLeave={e => (e.currentTarget.style.background = '')}>
                    {/* Thumbnail */}
                    <td style={{ padding: '8px 10px', width: 40 }}>
                      {row.thumbnail
                        ? <img src={row.thumbnail} alt="" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 6, display: 'block' }} />
                        : <div style={{ width: 36, height: 36, borderRadius: 6, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>{row.platform === 'IG' ? '📷' : '▶️'}</div>}
                    </td>
                    {/* Titre + badge plateforme */}
                    <td style={{ padding: '8px 10px', maxWidth: 200 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 3 }}>{row.title.slice(0, 45)}{row.title.length > 45 ? '…' : ''}</div>
                      <span style={{ fontSize: 9, fontWeight: 700, color: platformColor, background: platformColor + '18', borderRadius: 4, padding: '2px 5px' }}>{row.platform} · {row.type}</span>
                    </td>
                    {/* Lien description */}
                    <td style={{ padding: '8px 10px', fontSize: 11, color: row.descLink ? BLUE : 'var(--faint)', whiteSpace: 'nowrap' }}>
                      {row.descLink ? `/${row.descLink.path}` : '—'}
                    </td>
                    {/* Clics desc */}
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 13, fontWeight: row.clicsDesc > 0 ? 700 : 400, color: row.clicsDesc > 0 ? 'var(--ink)' : 'var(--faint)' }}>
                      {row.clicsDesc > 0 ? fmt(row.clicsDesc) : '—'}
                    </td>
                    {/* Leads (commentaires keyword) */}
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 13, fontWeight: row.leadsCount > 0 ? 700 : 400, color: row.leadsCount > 0 ? 'var(--ink)' : 'var(--faint)' }}>
                      {row.leadsCount > 0 ? row.leadsCount : '—'}
                    </td>
                    {/* Lead magnets envoyés */}
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 13, fontWeight: row.lmCount > 0 ? 700 : 400, color: row.lmCount > 0 ? 'var(--ink)' : 'var(--faint)' }}>
                      {row.lmCount > 0 ? row.lmCount : '—'}
                    </td>
                    {/* DM trackés (liens prospects générés) */}
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 13, fontWeight: row.dmCount > 0 ? 700 : 400, color: row.dmCount > 0 ? 'var(--ink)' : 'var(--faint)' }}>
                      {row.dmCount > 0 ? row.dmCount : '—'}
                    </td>
                    {/* Clics DM */}
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 13, fontWeight: row.clicsDM > 0 ? 700 : 400, color: row.clicsDM > 0 ? 'var(--ink)' : 'var(--faint)' }}>
                      {row.clicsDM > 0 ? fmt(row.clicsDM) : '—'}
                    </td>
                    {/* Calls */}
                    <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                      {row.callsCount > 0
                        ? <span style={{ fontSize: 12, fontWeight: 700, color: GREEN }}>{row.callsCount}</span>
                        : <span style={{ fontSize: 11, color: 'var(--faint)' }}>—</span>}
                    </td>
                    {/* Closés */}
                    <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                      {row.closedCount > 0
                        ? <span style={{ fontSize: 12, fontWeight: 700, color: GREEN }}>{row.closedCount}</span>
                        : <span style={{ fontSize: 11, color: 'var(--faint)' }}>—</span>}
                    </td>
                    {/* Revenue */}
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 13, fontWeight: 700, color: row.revenue > 0 ? GREEN : 'var(--faint)', whiteSpace: 'nowrap' }}>
                      {row.revenue > 0 ? fmtEur(row.revenue) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Section 3 : Prospects DM ── */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px 22px' }}>
        <SectionHeader
          title="Liens prospects · DM"
          sub="Un lien unique par prospect envoyé en DM — tracking complet"
        />
        {prospectLinks.length === 0
          ? <div style={{ fontSize: 12, color: 'var(--faint)', padding: '12px 0' }}>Aucun lien prospect créé.</div>
          : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Prospect', 'Contenu source', 'Lien', 'Clics', 'Délai', 'Call', 'Closé', 'Revenue'].map((h, i) => (
                    <th key={i} style={{ textAlign: i >= 3 ? 'right' : 'left', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', color: 'var(--muted)', padding: '6px 10px 10px', borderBottom: '1px solid var(--border)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {prospectLinks.map((l: any, i: number) => {
                  const sourcePost = [...igPosts.map(p => ({ id: p.id, title: p.caption?.slice(0, 30), platform: 'IG' })), ...ytVideos.map(v => ({ id: v.id, title: v.title.slice(0, 30), platform: 'YT' }))]
                    .find(p => p.id === l.postId);
                  return (
                    <tr key={i} onClick={() => setSelectedLink(l)} style={{ borderBottom: '1px solid var(--border-soft)', cursor: 'pointer' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                      onMouseLeave={e => (e.currentTarget.style.background = '')}>
                      <td style={{ padding: '9px 10px', fontSize: 12, fontWeight: 700 }}>@{l.igUsername}</td>
                      <td style={{ padding: '9px 10px', fontSize: 11, color: 'var(--muted)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {sourcePost ? <><span style={{ fontSize: 9, fontWeight: 700, color: sourcePost.platform === 'IG' ? ACCENT : RED, background: (sourcePost.platform === 'IG' ? ACCENT : RED) + '18', borderRadius: 3, padding: '1px 4px', marginRight: 4 }}>{sourcePost.platform}</span>{sourcePost.title}…</> : '—'}
                      </td>
                      <td style={{ padding: '9px 10px', fontSize: 11, color: BLUE }}>/{l.path}</td>
                      <td style={{ padding: '9px 10px', textAlign: 'right', fontSize: 13, fontWeight: 700 }}>{fmt(l.humanClicks30d)}</td>
                      <td style={{ padding: '9px 10px', textAlign: 'right', fontSize: 12, color: 'var(--muted)' }}>{l.clickToCallDays != null ? `${l.clickToCallDays}j` : '—'}</td>
                      <td style={{ padding: '9px 10px', textAlign: 'right' }}>
                        {l.callBooked ? <span style={{ fontSize: 10, fontWeight: 600, color: GREEN, background: GREEN + '18', borderRadius: 4, padding: '2px 6px' }}>Oui</span> : <span style={{ fontSize: 11, color: 'var(--faint)' }}>—</span>}
                      </td>
                      <td style={{ padding: '9px 10px', textAlign: 'right' }}>
                        {l.dealClosed === true ? <span style={{ fontSize: 10, fontWeight: 600, color: GREEN, background: GREEN + '18', borderRadius: 4, padding: '2px 6px' }}>Closé</span>
                          : l.dealClosed === false ? <span style={{ fontSize: 10, fontWeight: 600, color: RED, background: RED + '12', borderRadius: 4, padding: '2px 6px' }}>Non</span>
                          : <span style={{ fontSize: 11, color: 'var(--faint)' }}>—</span>}
                      </td>
                      <td style={{ padding: '9px 10px', textAlign: 'right', fontSize: 13, fontWeight: 700, color: l.revenue ? GREEN : 'var(--faint)' }}>
                        {l.revenue ? fmtEur(l.revenue) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
      </div>

      {/* Modal détail lien */}
      {selectedLink && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={() => setSelectedLink(null)}>
          <div style={{ background: 'var(--surface)', borderRadius: 14, padding: 24, maxWidth: 540, width: '100%', maxHeight: '85vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{selectedLink.shortUrl}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{selectedLink.originalUrl}</div>
              </div>
              <button onClick={() => setSelectedLink(null)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--muted)' }}>×</button>
            </div>
            <AreaChart data={selectedLink.chartData} areas={[{ key: 'clicks', label: 'Clics', color: BLUE }]} xKey="date" height={140} />
            <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Clics humains 30j</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: BLUE }}>{fmt(selectedLink.humanClicks30d)}</div>
              </div>
              {selectedLink.referrers.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6, color: 'var(--muted)' }}>Sources</div>
                  {selectedLink.referrers.slice(0, 4).map((r, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                      <span style={{ color: 'var(--muted)' }}>{r.label || 'Direct'}</span>
                      <span style={{ fontWeight: 600 }}>{fmt(r.value)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal création lien */}
      {showCreate && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={() => { setShowCreate(false); resetModal(); }}>
          <div style={{ background: 'var(--surface)', borderRadius: 16, padding: 28, maxWidth: 520, width: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 60px rgba(0,0,0,.2)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>Générer un lien tracké</div>
              <button onClick={() => { setShowCreate(false); resetModal(); }} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--muted)', lineHeight: 1 }}>×</button>
            </div>

            {createdLink ? (
              /* ── Résultat ── */
              <div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>Lien créé — copie et envoie en DM</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface-2)', borderRadius: 8, padding: '10px 14px', marginBottom: 12 }}>
                  <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: BLUE, wordBreak: 'break-all' }}>{createdLink}</span>
                  <button onClick={copyLink} style={{ padding: '6px 14px', fontSize: 12, fontWeight: 600, borderRadius: 6, cursor: 'pointer', border: 'none', background: copied ? GREEN : BLUE, color: '#fff', transition: 'background .2s', flexShrink: 0 }}>
                    {copied ? 'Copié !' : 'Copier'}
                  </button>
                </div>
                {createMode === 'lead' && selectedLead && (
                  <div style={{ fontSize: 11, color: 'var(--muted)', background: 'var(--surface-2)', borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>
                    <span style={{ fontWeight: 600, color: 'var(--ink)' }}>@{selectedLead.igUsername}</span> · via <span style={{ fontWeight: 600 }}>{selectedLead.postTitle.slice(0, 40)}…</span> · mot-clé <span style={{ fontWeight: 600 }}>#{selectedLead.keyword}</span>
                  </div>
                )}
                <button onClick={resetModal} style={{ width: '100%', padding: '10px', fontSize: 13, fontWeight: 600, borderRadius: 8, cursor: 'pointer', border: '1px solid var(--border)', background: 'transparent', color: 'var(--ink)' }}>
                  Générer un autre lien
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                {/* ── Toggle mode ── */}
                <div style={{ display: 'flex', background: 'var(--surface-2)', borderRadius: 8, padding: 3, gap: 2 }}>
                  {(['lead', 'manual'] as const).map(mode => (
                    <button key={mode} onClick={() => setCreateMode(mode)} style={{
                      flex: 1, padding: '7px', fontSize: 12, fontWeight: 600, borderRadius: 6, cursor: 'pointer', border: 'none',
                      background: createMode === mode ? 'var(--surface)' : 'transparent',
                      color: createMode === mode ? 'var(--ink)' : 'var(--muted)',
                      boxShadow: createMode === mode ? '0 1px 3px rgba(0,0,0,.07)' : 'none',
                      transition: 'all .15s',
                    }}>
                      {mode === 'lead' ? 'Depuis un commentaire' : 'Prospect manuel'}
                    </button>
                  ))}
                </div>

                {/* ── Mode : depuis un commentaire ── */}
                {createMode === 'lead' && (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8, color: 'var(--muted)' }}>
                      Sélectionne le prospect
                    </div>
                    <input
                      type="text"
                      value={leadSearch}
                      onChange={e => setLeadSearch(e.target.value)}
                      placeholder="Recherche par pseudo ou vidéo..."
                      style={{ width: '100%', padding: '8px 12px', fontSize: 12, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--ink)', boxSizing: 'border-box', marginBottom: 8 }}
                    />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 240, overflowY: 'auto' }}>
                      {filteredLeads.map(lead => (
                        <div
                          key={lead.igUserId}
                          onClick={() => setSelectedLead(lead)}
                          style={{
                            padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                            border: `1px solid ${selectedLead?.igUserId === lead.igUserId ? BLUE : 'var(--border)'}`,
                            background: selectedLead?.igUserId === lead.igUserId ? BLUE + '0e' : 'var(--surface)',
                            transition: 'all .12s',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>@{lead.igUsername}</span>
                                <span style={{ fontSize: 10, fontWeight: 600, color: lead.leadMagnetSent ? GREEN : AMBER, background: (lead.leadMagnetSent ? GREEN : AMBER) + '18', borderRadius: 4, padding: '1px 5px' }}>
                                  {lead.leadMagnetSent ? 'LM envoyé' : 'En attente'}
                                </span>
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                                <span style={{ background: lead.postType === 'IG' ? ACCENT + '18' : RED + '12', color: lead.postType === 'IG' ? ACCENT : RED, fontWeight: 600, borderRadius: 3, padding: '1px 4px', marginRight: 5, fontSize: 10 }}>{lead.postType}</span>
                                {lead.postTitle.slice(0, 38)}{lead.postTitle.length > 38 ? '…' : ''}
                              </div>
                            </div>
                            <div style={{ textAlign: 'right', flexShrink: 0 }}>
                              <div style={{ fontSize: 10, color: 'var(--faint)' }}>{daysSince(lead.commentedAt)}j</div>
                              <div style={{ fontSize: 10, fontWeight: 600, color: BLUE, marginTop: 2 }}>#{lead.keyword}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                      {filteredLeads.length === 0 && <div style={{ fontSize: 12, color: 'var(--faint)', padding: 12 }}>Aucun lead trouvé</div>}
                    </div>
                  </div>
                )}

                {/* ── Mode : prospect manuel ── */}
                {createMode === 'manual' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6, color: 'var(--muted)' }}>Pseudo Instagram</div>
                      <input
                        type="text"
                        value={manualUsername}
                        onChange={e => setManualUsername(e.target.value.replace(/^@/, ''))}
                        placeholder="thomas.biz"
                        style={{ width: '100%', padding: '8px 12px', fontSize: 13, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--ink)', boxSizing: 'border-box' }}
                      />
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6, color: 'var(--muted)' }}>
                        Contenu source <span style={{ fontWeight: 400, color: 'var(--faint)' }}>(optionnel)</span>
                      </div>
                      <select
                        value={manualPostId}
                        onChange={e => setManualPostId(e.target.value)}
                        style={{ width: '100%', padding: '8px 12px', fontSize: 13, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--ink)', boxSizing: 'border-box' }}
                      >
                        <option value="">— Sans attribution —</option>
                        {(ig?.posts || []).map(p => <option key={p.id} value={p.id}>IG · {p.caption?.slice(0, 50)}</option>)}
                        {(yt?.videos || []).map(v => <option key={v.id} value={v.id}>YT · {v.title.slice(0, 50)}</option>)}
                      </select>
                    </div>
                  </div>
                )}

                {/* ── Destination ── */}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8, color: 'var(--muted)' }}>Destination</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {([] as DestinationLink[]).map(dest => (
                      <div
                        key={dest.id}
                        onClick={() => setSelectedDest(dest)}
                        style={{
                          padding: '9px 12px', borderRadius: 8, cursor: 'pointer',
                          border: `1px solid ${selectedDest?.id === dest.id ? BLUE : 'var(--border)'}`,
                          background: selectedDest?.id === dest.id ? BLUE + '0e' : 'transparent',
                          display: 'flex', alignItems: 'center', gap: 10, transition: 'all .12s',
                        }}
                      >
                        <span style={{ fontSize: 14 }}>{dest.type === 'calendly' ? '📅' : dest.type === 'leadmagnet' ? '📄' : '🔗'}</span>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>{dest.label}</div>
                          <div style={{ fontSize: 10, color: 'var(--faint)', marginTop: 1 }}>{dest.url}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* ── Domaine ── */}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6, color: 'var(--muted)' }}>Domaine Short.io</div>
                  {domainsLoading ? (
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>Chargement...</div>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {(domains.length ? domains : [{ id: 'mock', hostname: 'qnl.link' }]).map(d => (
                        <button key={String(d.id)} onClick={() => setSelectedDomain(d)} style={{
                          padding: '5px 12px', fontSize: 12, fontWeight: 600, borderRadius: 6, cursor: 'pointer',
                          border: `1px solid ${selectedDomain?.id === d.id ? BLUE : 'var(--border)'}`,
                          background: selectedDomain?.id === d.id ? BLUE + '15' : 'transparent',
                          color: selectedDomain?.id === d.id ? BLUE : 'var(--ink)',
                        }}>{d.hostname}</button>
                      ))}
                    </div>
                  )}
                </div>

                {/* ── Chemin optionnel ── */}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6, color: 'var(--muted)' }}>
                    Chemin <span style={{ fontWeight: 400, color: 'var(--faint)' }}>(optionnel — auto-généré)</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                    <span style={{ padding: '8px 10px', fontSize: 12, color: 'var(--muted)', background: 'var(--surface-2)', borderRight: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                      {(selectedDomain?.hostname || 'qnl.link')}/
                    </span>
                    <input
                      type="text"
                      value={customPath}
                      onChange={e => setCustomPath(e.target.value.replace(/\s+/g, '-').toLowerCase())}
                      placeholder={createMode === 'lead' && selectedLead ? selectedLead.igUsername.toLowerCase() : 'pseudo-instagram'}
                      style={{ flex: 1, padding: '8px 12px', fontSize: 13, border: 'none', background: 'var(--surface)', color: 'var(--ink)', outline: 'none' }}
                    />
                  </div>
                </div>

                {createError && (
                  <div style={{ fontSize: 12, color: RED, background: RED + '12', borderRadius: 6, padding: '8px 12px' }}>{createError}</div>
                )}

                <button
                  onClick={handleCreate}
                  disabled={creating || !selectedDomain || (createMode === 'lead' ? !selectedLead : !manualUsername.trim())}
                  style={{
                    padding: '11px', fontSize: 13, fontWeight: 700, borderRadius: 8,
                    cursor: creating || !selectedDomain || (createMode === 'lead' ? !selectedLead : !manualUsername.trim()) ? 'not-allowed' : 'pointer',
                    border: 'none', background: BLUE, color: '#fff',
                    opacity: creating || !selectedDomain || (createMode === 'lead' ? !selectedLead : !manualUsername.trim()) ? 0.5 : 1,
                    transition: 'opacity .15s',
                  }}
                >
                  {creating ? 'Création...' : 'Générer le lien'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── PAGE PRINCIPALE ──────────────────────────────────────────────────────────

// ─── Mock data ────────────────────────────────────────────────────────────────

function makeDays(n: number, base: number, variance: number) {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (n - 1 - i));
    return { date: d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }), value: Math.round(base + (Math.random() - 0.5) * variance * 2) };
  });
}

const MOCK_IG: IGStats = {
  username: 'quennel.coaching', name: 'Quennel Coaching', profilePicture: null,
  followers: 12840, following: 312, mediaCount: 187, biography: 'Coach business & mindset 🚀',
  reach30d: 284500, accountsEngaged30d: 18200, totalInteractions30d: 9640,
  followsUnfollows30d: 380, profileLinksTaps30d: 11, websiteClicks30d: 8,
  views30d: 512000,
  viewsFollowerBreakdown: { follower: 148000, nonFollower: 364000 },
  chartData: makeDays(30, 9500, 4000).map((d, i) => ({ date: d.date, reach: d.value, followerCount: 12200 + i * 21 })),
  demographics: {
    age: [
      { label: '18-24', value: 22 }, { label: '25-34', value: 41 }, { label: '35-44', value: 24 },
      { label: '45-54', value: 9 }, { label: '55+', value: 4 },
    ],
    country: [
      { label: 'France', value: 68 }, { label: 'Belgique', value: 12 }, { label: 'Suisse', value: 8 },
      { label: 'Canada', value: 6 }, { label: 'Autres', value: 6 },
    ],
    city: [
      { label: 'Paris', value: 24 }, { label: 'Lyon', value: 11 }, { label: 'Marseille', value: 8 },
      { label: 'Bordeaux', value: 6 }, { label: 'Bruxelles', value: 5 },
    ],
    gender: [{ label: 'Hommes', value: 62 }, { label: 'Femmes', value: 38 }],
  },
  onlineFollowers: {
    hour_counts: Object.fromEntries(
      ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map(day => [
        day, Object.fromEntries(Array.from({ length: 24 }, (_, h) => [
          String(h), Math.round(200 + Math.random() * 600 * (h >= 18 && h <= 22 ? 2 : h >= 12 && h <= 14 ? 1.4 : 0.6))
        ]))
      ])
    ),
  },
  posts: [
    { id: '1', caption: 'Comment j\'ai closé 3 clients en 1 semaine sans prospecter 🔥', type: 'VIDEO', thumbnail: null, timestamp: new Date(Date.now() - 2*86400000).toISOString(), permalink: '#', likes: 892, comments: 74, reach: 48200, saved: 312, shares: 156, views: 91400, totalInteractions: 1434, follows: null, profileVisits: null, videoDuration: 58, avgWatchTimeMs: 32000, totalWatchTimeMs: 2924800000, skipRate: 0.18 },
    { id: '2', caption: 'Le mindset qui m\'a tout changé', type: 'VIDEO', thumbnail: null, timestamp: new Date(Date.now() - 5*86400000).toISOString(), permalink: '#', likes: 1240, comments: 108, reach: 62800, saved: 487, shares: 210, views: 124000, totalInteractions: 2045, follows: null, profileVisits: null, videoDuration: 44, avgWatchTimeMs: 28000, totalWatchTimeMs: 3472000000, skipRate: 0.12 },
    { id: '3', caption: '3 erreurs qui tuent ton business en ligne', type: 'VIDEO', thumbnail: null, timestamp: new Date(Date.now() - 9*86400000).toISOString(), permalink: '#', likes: 678, comments: 52, reach: 34100, saved: 198, shares: 87, views: 67800, totalInteractions: 1015, follows: null, profileVisits: null, videoDuration: 62, avgWatchTimeMs: 22000, totalWatchTimeMs: 1491600000, skipRate: 0.24 },
    { id: '4', caption: 'Routine matinale pour entrepreneurs', type: 'IMAGE', thumbnail: null, timestamp: new Date(Date.now() - 12*86400000).toISOString(), permalink: '#', likes: 421, comments: 38, reach: 18400, saved: 142, shares: 44, views: null, totalInteractions: 645, follows: 28, profileVisits: 312, videoDuration: null, avgWatchTimeMs: null, totalWatchTimeMs: null, skipRate: null },
    { id: '5', caption: 'Témoignage client — de 0 à 5k€/mois en 3 mois', type: 'VIDEO', thumbnail: null, timestamp: new Date(Date.now() - 16*86400000).toISOString(), permalink: '#', likes: 1580, comments: 142, reach: 78400, saved: 624, shares: 298, views: 156000, totalInteractions: 2644, follows: null, profileVisits: null, videoDuration: 75, avgWatchTimeMs: 48000, totalWatchTimeMs: 7488000000, skipRate: 0.09 },
    { id: '6', caption: 'Pourquoi tu rates tes calls de vente', type: 'VIDEO', thumbnail: null, timestamp: new Date(Date.now() - 20*86400000).toISOString(), permalink: '#', likes: 742, comments: 61, reach: 39200, saved: 224, shares: 98, views: 82400, totalInteractions: 1125, follows: null, profileVisits: null, videoDuration: 52, avgWatchTimeMs: 31000, totalWatchTimeMs: 2554400000, skipRate: 0.21 },
  ],
};

const MOCK_YT: YTStats = {
  channelName: 'Quennel Coaching', channelThumbnail: null as any, subscribers: 8240,
  totalViews: 1240000, videoCount: 64,
  views30d: 48200, watchTime30d: 241000, likes30d: 1840, comments30d: 312,
  shares30d: 480, subsGained30d: 284, subsLost30d: 38, netSubs30d: 246,
  avgViewDurationSec: 312,
  chartData: Array.from({ length: 30 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (29 - i));
    const subsGained = Math.round(6 + Math.random() * 14);
    const subsLost = Math.round(1 + Math.random() * 3);
    return { date: d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }), views: Math.round(1400 + (Math.random() - 0.4) * 1200), watchTime: Math.round(7200 + (Math.random() - 0.4) * 4000), subsGained, subsLost, netSubs: subsGained - subsLost };
  }),
  videos: [
    { id: 'v1', title: 'Comment créer une offre à 3000€ irrésistible', thumbnail: '', publishedAt: new Date(Date.now() - 8*86400000).toISOString(), duration: '18:42', isShort: false, views: 12400, likes: 487, comments: 84, views30d: 9800, watchTime30d: 84000, avgViewPct: 62, url: '#', likes30d: 320, comments30d: 54, shares30d: 42 },
    { id: 'v2', title: 'Tunnel de vente Instagram — tuto complet 2025', thumbnail: '', publishedAt: new Date(Date.now() - 22*86400000).toISOString(), duration: '24:18', isShort: false, views: 28600, likes: 1240, comments: 198, views30d: 7200, watchTime30d: 62000, avgViewPct: 58, url: '#', likes30d: 480, comments30d: 72, shares30d: 98 },
    { id: 'v3', title: 'Script DM qui converti #shorts', thumbnail: '', publishedAt: new Date(Date.now() - 4*86400000).toISOString(), duration: '0:58', isShort: true, views: 84200, likes: 3800, comments: 412, views30d: 72000, watchTime30d: 2592000, avgViewPct: 48, url: '#', likes30d: 2840, comments30d: 312, shares30d: 580 },
    { id: 'v4', title: 'Ma méthode pour closer 80% de mes calls', thumbnail: '', publishedAt: new Date(Date.now() - 35*86400000).toISOString(), duration: '31:04', isShort: false, views: 18400, likes: 780, comments: 124, views30d: 4100, watchTime30d: 38000, avgViewPct: 71, url: '#', likes30d: 180, comments30d: 28, shares30d: 24 },
    { id: 'v5', title: 'Mindset millionnaire — 5 habitudes', thumbnail: '', publishedAt: new Date(Date.now() - 48*86400000).toISOString(), duration: '14:22', isShort: false, views: 9800, likes: 342, comments: 58, views30d: 2400, watchTime30d: 18000, avgViewPct: 54, url: '#', likes30d: 120, comments30d: 18, shares30d: 14 },
    // 19 Shorts supplémentaires (total 20 Shorts)
    ...Array.from({ length: 19 }, (_, i) => { const v30 = Math.round(1200 + Math.sin(i*1.7)*800); return { id: `vs${i+1}`, title: `Short ${i+1} #shorts`, thumbnail: '', publishedAt: new Date(Date.now() - (60+i*14)*86400000).toISOString(), duration: '0:45', isShort: true, views: Math.round(8000 + Math.sin(i*2.1)*6000), likes: Math.round(320 + i*40), comments: Math.round(18 + i*8), views30d: v30, watchTime30d: Math.round(v30 * 36), avgViewPct: Math.round(44 + Math.sin(i)*8), url: '#', likes30d: Math.round(80 + i*20), comments30d: Math.round(8 + i*3), shares30d: Math.round(12 + i*6) }; }),
    // 40 vidéos longues supplémentaires (total 44 longues)
    ...Array.from({ length: 40 }, (_, i) => ({ id: `vl${i+1}`, title: `Vidéo ${i+1} — stratégie business`, thumbnail: '', publishedAt: new Date(Date.now() - (90+i*7)*86400000).toISOString(), duration: `${12+Math.round(Math.sin(i)*8)}:${String(Math.round(Math.abs(Math.sin(i*1.3))*59)).padStart(2,'0')}`, isShort: false, views: Math.round(3000 + Math.sin(i*1.9)*2500), likes: Math.round(120 + i*15), comments: Math.round(14 + i*4), views30d: Math.round(400 + Math.sin(i*2.3)*350), watchTime30d: Math.round(4200 + Math.sin(i*1.7)*2800), avgViewPct: Math.round(52 + Math.sin(i*1.1)*12), url: '#', likes30d: Math.round(40 + i*8), comments30d: Math.round(6 + i*2), shares30d: Math.round(4 + i*2) })),
  ],
  trafficSources: [
    { source: 'YT_SEARCH', views: 18400, watchMinutes: 92000 },
    { source: 'YT_SUGGESTED', views: 14200, watchMinutes: 71000 },
    { source: 'YT_EXTERNAL', views: 8400, watchMinutes: 42000 },
    { source: 'YT_BROWSE', views: 4800, watchMinutes: 24000 },
    { source: 'YT_SHORTS', views: 2400, watchMinutes: 12000 },
  ],
  devices: [
    { device: 'MOBILE', views: 31200, watchMinutes: 156000 },
    { device: 'DESKTOP', views: 12400, watchMinutes: 62000 },
    { device: 'TABLET', views: 4600, watchMinutes: 23000 },
  ],
  demographics: [
    { ageGroup: '18-24', gender: 'male', viewerPct: 18 }, { ageGroup: '25-34', gender: 'male', viewerPct: 38 },
    { ageGroup: '35-44', gender: 'male', viewerPct: 22 }, { ageGroup: '18-24', gender: 'female', viewerPct: 8 },
    { ageGroup: '25-34', gender: 'female', viewerPct: 14 },
  ],
  searchKeywords: [
    { term: 'comment closer un client', views: 2840 }, { term: 'tunnel de vente instagram', views: 2120 },
    { term: 'script dm instagram', views: 1840 }, { term: 'offre coaching prix', views: 1420 },
    { term: 'mindset entrepreneur', views: 1180 }, { term: 'comment vendre en ligne', views: 980 },
    { term: 'quennel coaching', views: 840 }, { term: 'closer vente', views: 720 },
    { term: 'automatiser prospection', views: 680 }, { term: 'coach business instagram', views: 540 },
  ],
};



// ── TabShortioB ──────────────────────────────────────────────────────────────

type ShortPeriod = 7 | 30;
type ProspectStatus = 'all' | 'pending' | 'booked' | 'closed' | 'noshow';

interface LeadMagnet { id: string; name: string; keyword: string; url?: string; }

function TabShortioB({ shortio, ig, yt, leads, leadMagnets, destinations, period: globalPeriod, profileId }: {
  shortio: ShortioStats | null;
  ig: IGStats | null;
  yt: YTStats | null;
  leads: MockLead[];
  leadMagnets: LeadMagnet[];
  destinations: DestinationLink[];
  period: Period;
  profileId?: string;
}) {
  const sPeriod: ShortPeriod = globalPeriod === 7 ? 7 : 30;
  const [chartFilter, setChartFilter] = useState<'all' | 'dm' | 'content' | 'bio'>('all');

  // Rechargé à chaque montage de l'onglet — source de vérité pour la stat Calendly DM
  const [prospectLinksDb, setProspectLinksDb] = useState<{ id: string; created_at: string }[]>([]);
  useEffect(() => {
    const url = profileId ? `/api/client/prospect-links?profileId=${profileId}` : '/api/client/prospect-links';
    fetch(url).then(r => r.ok ? r.json() : null).then(d => { if (d?.links) setProspectLinksDb(d.links); }).catch(() => {});
  }, [profileId]);
  const [selectedContentId, setSelectedContentId] = useState<string | null>(null);
  const [prospectFilter, setProspectFilter] = useState<ProspectStatus>('all');
  const [showCreate, setShowCreate] = useState(false);
  // Tableau contenu : tri
  type SortKey = 'clicsDesc' | 'lmDetectes' | 'lmClics' | 'lmReponses' | 'dmCount' | 'callsBooked' | 'callsHonored' | 'closed' | 'revenue' | 'vuesParCall' | 'views';
  const [sortKey, setSortKey] = useState<SortKey>('revenue');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  // Tableau breakdown par source : tri
  type BdSortKey = 'default' | 'clics' | 'booked' | 'honored' | 'closed' | 'revenue';
  const [bdSortKey, setBdSortKey] = useState<BdSortKey>('default');
  const [bdSortDir, setBdSortDir] = useState<'desc' | 'asc'>('desc');
  const toggleBdSort = (key: BdSortKey) => {
    if (bdSortKey === key) setBdSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setBdSortKey(key); setBdSortDir('desc'); }
  };
  // Tableau : filtres
  const [filterPlatform, setFilterPlatform] = useState<'all' | 'IG' | 'YT'>('all');
  const [filterHas, setFilterHas] = useState<Set<SortKey>>(new Set());
  const [filterSearch, setFilterSearch] = useState('');
  const [showAllTable, setShowAllTable] = useState(false);
  // Modal détail contenu
  const [detailModal, setDetailModal] = useState<any | null>(null);
  const [domains, setDomains] = useState<ShortDomain[]>([]);
  const [createMode, setCreateMode] = useState<'lead' | 'manual'>('lead');
  const [selectedDomain, setSelectedDomain] = useState<ShortDomain | null>(null);
  const [selectedLead, setSelectedLead] = useState<MockLead | null>(null);
  const [leadSearch, setLeadSearch] = useState('');
  const [selectedDest, setSelectedDest] = useState<DestinationLink | null>(null);
  const [manualUsername, setManualUsername] = useState('');
  const [manualPostId, setManualPostId] = useState('');
  const [customPath, setCustomPath] = useState('');
  const [creating, setCreating] = useState(false);
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isColdDM, setIsColdDM] = useState(false);
  const [detectedDmType, setDetectedDmType] = useState<'cold' | 'organic' | null>(null);

  const resetModal = () => {
    setCreatedLink(null); setSelectedLead(null); setLeadSearch('');
    setIsColdDM(false); setDetectedDmType(null);
    setManualUsername(''); setManualPostId(''); setCustomPath('');
    setCreateMode('lead'); setSelectedDest(destinations[0] ?? null);
  };

  const openCreate = async () => {
    resetModal(); setShowCreate(true);
    if (domains.length > 0) return;
    try {
      const url = profileId ? `/api/shortio/domains?profileId=${profileId}` : '/api/shortio/domains';
      const res = await fetch(url);
      const data = await res.json();
      const list: ShortDomain[] = data.domains?.length ? data.domains : [{ id: 'mock', hostname: 'qnl.link' }];
      setDomains(list);
      if (list.length > 0) setSelectedDomain(list[0]);
    } catch {
      const fallback = { id: 'mock', hostname: 'qnl.link' };
      setDomains([fallback]); setSelectedDomain(fallback);
    }
  };

  const handleCreate = async () => {
    if (!selectedDomain) return;
    if (!selectedDest) return;
    if (createMode === 'lead' && !selectedLead) return;
    if (createMode === 'manual' && !manualUsername.trim()) return;
    setCreating(true);
    try {
      const igId = createMode === 'lead' ? selectedLead!.igUserId : `manual-${manualUsername.trim().replace(/\s+/g, '-')}`;
      const postId = createMode === 'lead' ? selectedLead!.postId : (manualPostId || 'unknown');
      const slug = customPath.trim() || (createMode === 'lead'
        ? selectedLead!.igUsername.replace(/[^a-z0-9]/gi, '-').toLowerCase()
        : manualUsername.trim().replace(/[^a-z0-9]/gi, '-').toLowerCase());
      const res = await fetch('/api/shortio/links', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ profileId, domainId: selectedDomain.hostname, originalUrl: selectedDest.url,
          title: `${selectedDest.label} — ${createMode === 'lead' ? selectedLead!.igUsername : manualUsername}`,
          utmSource: selectedDomain.hostname, utmMedium: 'dm', utmCampaign: `lead-${igId}`, utmContent: postId, path: slug }),
      });
      const data = await res.json();
      setCreatedLink(data.shortUrl || `${selectedDomain.hostname}/${slug}`);
    } catch (e: any) {
      setCreatedLink(`qnl.link/${customPath || manualUsername || selectedLead?.igUsername || 'lien'}`);
    } finally { setCreating(false); }
  };

  const copyLink = () => { if (!createdLink) return; navigator.clipboard.writeText(createdLink); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  const filteredLeads = leads.filter(l => !leadSearch || l.igUsername.toLowerCase().includes(leadSearch.toLowerCase()) || l.postTitle.toLowerCase().includes(leadSearch.toLowerCase()));
  const daysSince = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);

  if (!shortio) return <Empty msg="Connecte ton compte Short.io pour voir les stats." />;

  const igPosts = ig?.posts || [];
  const ytVideos = yt?.videos || [];

  const allShortioLinks: any[] = shortio.links ?? [];
  const bioLinks    = allShortioLinks.filter((l: any) => l.linkType === 'bio');
  const postLinks   = allShortioLinks.filter((l: any) => l.linkType === 'post');
  const prospectLinks = allShortioLinks.filter((l: any) => l.linkType === 'prospect');

  // Helper : clics sur un lien Short.io pour la période courante.
  // Si sPeriod < 30 → somme les N derniers points du chartData journalier.
  // Si sPeriod === 30 → utilise humanClicks30d (valeur agrégée déjà fournie par l'API).
  const linkClics = (l: any): number => {
    if (!l) return 0;
    if (sPeriod === 30) return l.humanClicks30d || 0;
    const pts: { clicks: number }[] = l.chartData || [];
    return pts.slice(-sPeriod).reduce((s, p) => s + (p.clicks || 0), 0);
  };

  // Helper : clics agrégés domaine pour la période
  const domainClicsPeriod = sPeriod === 30
    ? (shortio.humanClicks30d ?? 0)
    : (shortio.chartData ?? []).slice(-sPeriod).reduce((s: number, d: any) => s + (d.clicks || 0), 0);

  // Filtre leads par période
  const periodCutoff = Date.now() - sPeriod * 24 * 60 * 60 * 1000;
  const leadsInPeriod = leads.filter(l => new Date(l.commentedAt).getTime() >= periodCutoff);

  // ── Section 0 : KPIs ──
  const totalClics = domainClicsPeriod;
  const dmLinks = prospectLinks.length;
  const dmClics = prospectLinks.reduce((s: number, l: any) => s + linkClics(l), 0);
  const tauxClicDM = dmLinks > 0 ? Math.round((dmClics / dmLinks) * 100) : 0;
  const lmEnvoyes = leadsInPeriod.filter(l => l.leadMagnetSent).length;
  const hookReplies = leadsInPeriod.filter(l => l.hookReplied).length;
  const tauxHookReply = lmEnvoyes > 0 ? Math.round((hookReplies / lmEnvoyes) * 100) : 0;
  // Liens Calendly envoyés DM = prospect_links Supabase filtrés par période (source de vérité)
  const lmCalendlyLinks = prospectLinksDb.length > 0
    ? prospectLinksDb.filter(l => new Date(l.created_at).getTime() >= periodCutoff).length
    : prospectLinks.length;
  const callsFromLM = prospectLinks.filter((l: any) => l.callBooked).length;
  const tauxLMCalendly = lmEnvoyes > 0 ? Math.round((lmCalendlyLinks / lmEnvoyes) * 100) : 0;
  const tauxCalendlyCall = lmCalendlyLinks > 0 ? Math.round((callsFromLM / lmCalendlyLinks) * 100) : 0;
  const callsTotal = prospectLinks.filter((l: any) => l.callBooked).length;

  // ── Graphique filtré — limité à sPeriod jours ──
  // offset : si sPeriod=7, les 7 derniers points du domaine correspondent aux indices [23..29]
  const shortioChart = shortio.chartData ?? [];
  const chartOffset = shortioChart.length - (sPeriod === 7 ? 7 : shortioChart.length);
  const chartRaw = shortioChart.slice(chartOffset);
  const chartData = chartRaw.map((d, i) => {
    const li = chartOffset + i; // index réel dans l.chartData[30 pts]
    if (chartFilter === 'bio') {
      const igBioLinks = bioLinks.filter((l: any) => l.bioType === 'instagram');
      const ytBioLinks = bioLinks.filter((l: any) => l.bioType === 'youtube');
      return {
        date: d.date,
        ig: igBioLinks.reduce((s: number, l: any) => s + (l.chartData?.[li]?.clicks || 0), 0),
        yt: ytBioLinks.reduce((s: number, l: any) => s + (l.chartData?.[li]?.clicks || 0), 0),
      };
    }
    if (chartFilter === 'content') {
      const igPostLinks = postLinks.filter((l: any) => l.postPlatform === 'IG');
      const ytPostLinks = postLinks.filter((l: any) => l.postPlatform === 'YT');
      return {
        date: d.date,
        ig: igPostLinks.reduce((s: number, l: any) => s + (l.chartData?.[li]?.clicks || 0), 0),
        yt: ytPostLinks.reduce((s: number, l: any) => s + (l.chartData?.[li]?.clicks || 0), 0),
      };
    }
    if (chartFilter === 'dm') {
      const calendly = prospectLinks.reduce((s: number, l: any) => s + (l.chartData?.[li]?.clicks || 0), 0);
      const lmUrls = new Set(leadsInPeriod.filter(l => l.trackingLink).map(l => l.trackingLink!));
      const lm = shortio.links
        .filter((l: any) => lmUrls.has(l.shortUrl) || lmUrls.has(l.originalUrl))
        .reduce((s: number, l: any) => s + (l.chartData?.[li]?.clicks || 0), 0);
      return { date: d.date, calendly, lm };
    }
    return d;
  });

  // ── Section 2 : tableau consolidé par contenu — tous les posts, pas seulement ceux avec business ──
  const allPostIds = Array.from(new Set([
    ...igPosts.map(p => p.id + '|IG'),
    ...ytVideos.map(v => v.id + '|YT'),
    ...postLinks.map((l: any) => l.postId + '|' + l.postPlatform),
    ...prospectLinks
      .filter((l: any) => l.postId && !['bio-ig', 'bio-yt'].includes(l.postId))
      .map((l: any) => l.postId + '|' + (l.postPlatform || (l.postId?.startsWith('v') ? 'YT' : 'IG'))),
    ...leads.filter(lead => lead.leadMagnetSent).map(lead => lead.postId + '|' + lead.postType),
  ]));

  const consolidatedRows = allPostIds.map(key => {
    const [postId, platform] = key.split('|');
    const descLink = postLinks.find((l: any) => l.postId === postId);
    const dmProspects = prospectLinks.filter((l: any) => l.postId === postId);
    const postLeads = leads.filter(lead => lead.postId === postId);
    const igPost = platform === 'IG' ? igPosts.find(p => p.id === postId) : null;
    const ytVideo = platform === 'YT' ? ytVideos.find(v => v.id === postId) : null;
    const title = igPost?.caption || ytVideo?.title || descLink?.title || postId;
    const thumbnail = igPost?.thumbnail || ytVideo?.thumbnail || null;
    const type = igPost ? (igPost.type === 'VIDEO' ? 'Reel' : igPost.type === 'CAROUSEL_ALBUM' ? 'Carousel' : 'Image') : (ytVideo?.isShort ? 'Short' : 'Vidéo');
    const views = igPost?.views || ytVideo?.views30d || 0;

    const clicsDesc = linkClics(descLink) || 0;
    const postLeadsInPeriod = postLeads.filter(l => new Date(l.commentedAt).getTime() >= periodCutoff);
    const lmDetectes = postLeadsInPeriod.length;
    const lmSent = postLeadsInPeriod.filter((l: MockLead) => l.leadMagnetSent).length;
    // Clics LM réels = clics sur les shortlinks de tracking envoyés à ces leads (filtrés par période)
    const postLmUrls = new Set(postLeadsInPeriod.filter(l => l.trackingLink).map(l => l.trackingLink!));
    const lmClics = shortio.links
      .filter((l: any) => postLmUrls.has(l.shortUrl) || postLmUrls.has(l.originalUrl))
      .reduce((s: number, l: any) => s + linkClics(l), 0);
    // Réponses au message d'accroche = hook_replied dans instagram_leads
    const lmReponses = postLeads.filter((l: MockLead) => l.hookReplied).length;
    const dmCount = dmProspects.length;
    const callsBooked = dmProspects.filter((l: any) => l.callBooked).length;
    const callsHonored = dmProspects.filter((l: any) => l.callBooked && l.honored !== false).length;
    const closed = dmProspects.filter((l: any) => l.dealClosed === true).length;
    const revenue = dmProspects.reduce((s: number, l: any) => s + (l.revenue || 0), 0);
    const vuesParCall = callsBooked > 0 && views > 0 ? Math.round(views / callsBooked) : null;

    return { postId, platform, title, thumbnail, type, views, descLink, dmProspects, lmDetectes, lmSent, lmClics, lmReponses, dmCount, clicsDesc, callsBooked, callsHonored, closed, revenue, vuesParCall };
  }).sort((a, b) => b.views - a.views || b.revenue - a.revenue);

  // ── Section 3 : pipeline prospects ──
  const getProspectStatus = (l: any): ProspectStatus => {
    if (l.dealClosed === true) return 'closed';
    if (l.no_show) return 'noshow';
    if (l.callBooked) return 'booked';
    if ((l.humanClicks30d || 0) > 0) return 'pending';
    return 'pending';
  };

  const statusLabel: Record<ProspectStatus, string> = {
    all: 'Tous', pending: 'En attente de clic', booked: 'Call booké', closed: 'Closés', noshow: 'No-show',
  };
  const statusColor: Record<string, string> = {
    closed: GREEN, booked: BLUE, pending: AMBER, noshow: RED,
  };

  const filteredProspects = prospectLinks.filter((l: any) => {
    const st = getProspectStatus(l);
    const matchFilter = prospectFilter === 'all' || st === prospectFilter;
    const matchContent = !selectedContentId || l.postId === selectedContentId;
    return matchFilter && matchContent;
  });

  const topRef = (l: ShortioLink) => l.referrers?.[0]?.label || '—';

  const SectionHead = ({ title, sub, action }: { title: string; sub?: string; action?: React.ReactNode }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{title}</div>
        {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>}
      </div>
      {action}
    </div>
  );

  const selectedContentTitle = selectedContentId
    ? consolidatedRows.find(r => r.postId === selectedContentId)?.title?.slice(0, 35)
    : null;

  return (
    <div className="stack">

      {/* ── Section 0 : Stats globales ── */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px 22px' }}>
        <SectionHead title="Vue d'ensemble" sub="Tracking complet — tous liens confondus" />
        {(() => {
          // Taux d'activation DM :
          // LM% = clics reçus sur liens LM (tracking_link dans instagram_leads) / LM envoyés
          // Calendly% = clics reçus sur liens Calendly prospect / liens Calendly générés
          // Clics LM = clics sur les shortlinks envoyés en DM avec le LM (tracking_link des leads)
          const lmTrackingUrls = new Set(leadsInPeriod.filter(l => l.trackingLink).map(l => l.trackingLink!));
          const lmClics = shortio.links
            .filter((l: any) => lmTrackingUrls.has(l.shortUrl) || lmTrackingUrls.has(l.originalUrl))
            .reduce((s: number, l: any) => s + linkClics(l), 0);
          const calendlyClics = prospectLinks.reduce((s: number, l: any) => s + linkClics(l), 0);
          const tauxLmClic = lmEnvoyes > 0 ? Math.round((lmClics / lmEnvoyes) * 100) : 0;
          const tauxCalendlyClic = lmCalendlyLinks > 0 ? Math.round((calendlyClics / lmCalendlyLinks) * 100) : 0;
          const tauxActColor = tauxCalendlyClic >= 50 ? GREEN : tauxCalendlyClic >= 25 ? AMBER : RED;
          const tauxLmColor = tauxLmClic >= 50 ? GREEN : tauxLmClic >= 25 ? AMBER : RED;

          return (
            <div style={{ display: 'flex', gap: 8, marginBottom: 20, alignItems: 'stretch' }}>

              {/* 1 — Clics totaux */}
              <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '12px 14px', flex: 1 }}>
                <div style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)', marginBottom: 6 }}>Clics totaux</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--ink)', lineHeight: 1 }}>{fmt(totalClics)}</div>
                <div style={{ fontSize: 10, color: 'var(--faint)', marginTop: 4 }}>volume global, tous liens</div>
                {shortio.clicksChange !== null && <div style={{ fontSize: 10, fontWeight: 600, color: shortio.clicksChange >= 0 ? GREEN : RED, marginTop: 3 }}>{shortio.clicksChange >= 0 ? '+' : ''}{fmtPct(shortio.clicksChange)}</div>}
              </div>

              <div style={{ width: 1, background: 'var(--border)', alignSelf: 'stretch' }} />

              {/* 2 — Leads commentaires */}
              <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '12px 14px', flex: 1 }}>
                <div style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)', marginBottom: 6 }}>Leads commentaires</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: lmEnvoyes > 0 ? 'var(--ink)' : 'var(--faint)', lineHeight: 1 }}>{fmt(lmEnvoyes)}</div>
                <div style={{ fontSize: 10, color: 'var(--faint)', marginTop: 4 }}>mots-clés détectés</div>
              </div>

              <div style={{ width: 1, background: 'var(--border)', alignSelf: 'stretch' }} />

              {/* 3 — Réponses message d'accroche */}
              <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '12px 14px', flex: 1 }}>
                <div style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)', marginBottom: 6 }}>Réponses accroche LM DM</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, lineHeight: 1 }}>
                  <div style={{ fontSize: 24, fontWeight: 800, color: hookReplies > 0 ? GREEN : 'var(--faint)' }}>{fmt(hookReplies)}</div>
                  {lmEnvoyes > 0 && <div style={{ fontSize: 13, fontWeight: 700, color: tauxHookReply >= 30 ? GREEN : tauxHookReply >= 15 ? AMBER : RED }}>{tauxHookReply}%</div>}
                </div>
                <div style={{ fontSize: 10, color: 'var(--faint)', marginTop: 4 }}>réponses au message d'accroche</div>
              </div>

              <div style={{ width: 1, background: 'var(--border)', alignSelf: 'stretch' }} />

              {/* 4 — Liens Calendly envoyés DM */}
              <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '12px 14px', flex: 1 }}>
                <div style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)', marginBottom: 6 }}>Liens Calendly envoyés DM</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--ink)', lineHeight: 1 }}>{fmt(lmCalendlyLinks)}</div>
                <div style={{ fontSize: 10, color: 'var(--faint)', marginTop: 4 }}>activité commerciale brute</div>
              </div>

              <div style={{ width: 1, background: 'var(--border)', alignSelf: 'stretch' }} />

              {/* 5 — Taux d'activation DM */}
              <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '12px 14px', flex: 1 }}>
                <div style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)', marginBottom: 6 }}>Taux d'activation DM</div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--faint)', marginBottom: 2 }}>LM</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: tauxLmColor, lineHeight: 1 }}>{tauxLmClic}%</div>
                  </div>
                  <div style={{ width: 1, height: 28, background: 'var(--border)' }} />
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--faint)', marginBottom: 2 }}>Calendly</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: tauxActColor, lineHeight: 1 }}>{tauxCalendlyClic}%</div>
                  </div>
                </div>
                <div style={{ fontSize: 10, color: 'var(--faint)', marginTop: 4 }}>clics / liens envoyés</div>
              </div>

              <div style={{ width: 1, background: 'var(--border)', alignSelf: 'stretch' }} />

              {/* 5 — Calls bookés depuis liens */}
              <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '12px 14px', flex: 1 }}>
                <div style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)', marginBottom: 6 }}>Calls bookés</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: callsTotal > 0 ? GREEN : 'var(--faint)', lineHeight: 1 }}>{callsTotal}</div>
                <div style={{ fontSize: 10, color: 'var(--faint)', marginTop: 4 }}>résultat final du tracking</div>
              </div>

            </div>
          );
        })()}

        {/* Toggle graphique */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
          {([['all', 'Tous les clics'], ['dm', 'DM uniquement'], ['content', 'Contenu uniquement'], ['bio', 'Bio uniquement']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setChartFilter(k)} style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 6, cursor: 'pointer', border: `1px solid ${chartFilter === k ? BLUE : 'var(--border)'}`, background: chartFilter === k ? BLUE + '12' : 'transparent', color: chartFilter === k ? BLUE : 'var(--muted)', transition: 'all .12s' }}>
              {label}
            </button>
          ))}
        </div>
        {(chartFilter === 'content' || chartFilter === 'bio') ? (
          <ResponsiveContainer width="100%" height={160}>
            <ReAreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="grad-chart-ig" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#F06292" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#F06292" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="grad-chart-yt" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#B91C1C" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#B91C1C" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={fmtAxisDate} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={30} />
              <Tooltip content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                return (
                  <div className="chart-tooltip">
                    <div className="chart-tooltip-label">{label}</div>
                    {payload.map((p: any, i: number) => (
                      <div key={i} className="chart-tooltip-row" style={{ color: p.color }}>
                        <span>{p.name}</span><strong style={{ marginLeft: 8 }}>{fmt(p.value)}</strong>
                      </div>
                    ))}
                  </div>
                );
              }} />
              <Area type="monotone" dataKey="ig" name="Instagram" stroke="#F06292" strokeWidth={2} fill="url(#grad-chart-ig)" dot={false} activeDot={{ r: 3, strokeWidth: 0, fill: '#F06292' }} isAnimationActive={false} />
              <Area type="monotone" dataKey="yt" name="YouTube" stroke="#B91C1C" strokeWidth={2} fill="url(#grad-chart-yt)" dot={false} activeDot={{ r: 3, strokeWidth: 0, fill: '#B91C1C' }} isAnimationActive={false} />
            </ReAreaChart>
          </ResponsiveContainer>
        ) : chartFilter === 'dm' ? (
          <ResponsiveContainer width="100%" height={160}>
            <ReAreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="grad-dm-calendly" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={BLUE} stopOpacity={0.15} />
                  <stop offset="95%" stopColor={BLUE} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="grad-dm-lm" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={AMBER} stopOpacity={0.15} />
                  <stop offset="95%" stopColor={AMBER} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={fmtAxisDate} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={28} allowDecimals={false} />
              <Tooltip content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                return (
                  <div className="chart-tooltip">
                    <div className="chart-tooltip-label">{label}</div>
                    {payload.map((p: any, i: number) => (
                      <div key={i} className="chart-tooltip-row" style={{ color: p.color }}>
                        <span>{p.name}</span><strong style={{ marginLeft: 8 }}>{p.value}</strong>
                      </div>
                    ))}
                  </div>
                );
              }} />
              <Area type="monotone" dataKey="calendly" name="Calendly" stroke={BLUE} strokeWidth={2} fill="url(#grad-dm-calendly)" dot={false} activeDot={{ r: 3, strokeWidth: 0, fill: BLUE }} isAnimationActive={false} />
              <Area type="monotone" dataKey="lm" name="Lead Magnet" stroke={AMBER} strokeWidth={2} fill="url(#grad-dm-lm)" dot={false} activeDot={{ r: 3, strokeWidth: 0, fill: AMBER }} isAnimationActive={false} />
            </ReAreaChart>
          </ResponsiveContainer>
        ) : (
          <AreaChart data={chartData} areas={[{ key: 'clicks', label: 'Clics', color: BLUE }]} xKey="date" height={160} />
        )}

        {/* ── Tableau breakdown par source ── */}
        {(() => {
          const bioIG = bioLinks.find((l: any) => l.bioType === 'instagram');
          const bioYT = bioLinks.find((l: any) => l.bioType === 'youtube');
          const igContentLinks = postLinks.filter((l: any) => l.postPlatform === 'IG');
          const ytContentLinks = postLinks.filter((l: any) => l.postPlatform === 'YT');
          const igRows = consolidatedRows.filter(r => r.platform === 'IG');
          const ytRows = consolidatedRows.filter(r => r.platform === 'YT');

          // Prospects qui viennent directement des bios (pas d'un post spécifique)
          const bioIGProspects = prospectLinks.filter((l: any) => l.postId === 'bio-ig');
          const bioYTProspects = prospectLinks.filter((l: any) => l.postId === 'bio-yt');
          const bioIGBooked = bioIGProspects.filter((l: any) => l.callBooked).length;
          const bioIGHonored = bioIGBooked;
          const bioIGClosed = bioIGProspects.filter((l: any) => l.dealClosed === true).length;
          const bioIGRevenue = bioIGProspects.reduce((s: number, l: any) => s + (l.revenue || 0), 0);
          const bioYTBooked = bioYTProspects.filter((l: any) => l.callBooked).length;
          const bioYTHonored = bioYTBooked;
          const bioYTClosed = bioYTProspects.filter((l: any) => l.dealClosed === true).length;
          const bioYTRevenue = bioYTProspects.reduce((s: number, l: any) => s + (l.revenue || 0), 0);

          const isLMProspect = (l: any) => {
            const lead = leads.find(ml => ml.igUserId === l.igUserId);
            return !!lead?.leadMagnetSent;
          };
          const dmDirectLinks = prospectLinks.filter((l: any) => !isLMProspect(l));
          const lmProspectLinks = prospectLinks.filter((l: any) => isLMProspect(l));

          // Cold DM = coach a initié (dmType === 'cold') ou non détecté (null) parmi les DM directs
          const coldDMLinks = dmDirectLinks.filter((l: any) => l.dmType === 'cold' || l.dmType == null);
          const organicDMLinks = dmDirectLinks.filter((l: any) => l.dmType === 'organic');

          const coldBooked = coldDMLinks.filter((l: any) => l.callBooked).length;
          const coldHonored = coldBooked;
          const coldClosed = coldDMLinks.filter((l: any) => l.dealClosed === true).length;
          const coldRevenue = coldDMLinks.reduce((s: number, l: any) => s + (l.revenue || 0), 0);
          const coldClics = coldDMLinks.reduce((s: number, l: any) => s + (l.humanClicks30d || 0), 0);

          const organicBooked = organicDMLinks.filter((l: any) => l.callBooked).length;
          const organicHonored = organicBooked;
          const organicClosed = organicDMLinks.filter((l: any) => l.dealClosed === true).length;
          const organicRevenue = organicDMLinks.reduce((s: number, l: any) => s + (l.revenue || 0), 0);
          const organicClics = organicDMLinks.reduce((s: number, l: any) => s + (l.humanClicks30d || 0), 0);

          const lmBooked = lmProspectLinks.filter((l: any) => l.callBooked).length;
          const lmHonored = lmBooked;
          const lmClosed = lmProspectLinks.filter((l: any) => l.dealClosed === true).length;
          const lmRevenue = lmProspectLinks.reduce((s: number, l: any) => s + (l.revenue || 0), 0);

          const igContentClics = igContentLinks.reduce((s: number, l: any) => s + (l.humanClicks30d || 0), 0);
          const igContentBooked = igRows.reduce((s, r) => s + r.callsBooked, 0);
          const igContentHonored = igRows.reduce((s, r) => s + r.callsHonored, 0);
          const igContentClosed = igRows.reduce((s, r) => s + r.closed, 0);
          const igContentRevenue = igRows.reduce((s, r) => s + r.revenue, 0);

          const ytContentClics = ytContentLinks.reduce((s: number, l: any) => s + (l.humanClicks30d || 0), 0);
          const ytContentBooked = ytRows.reduce((s, r) => s + r.callsBooked, 0);
          const ytContentHonored = ytRows.reduce((s, r) => s + r.callsHonored, 0);
          const ytContentClosed = ytRows.reduce((s, r) => s + r.closed, 0);
          const ytContentRevenue = ytRows.reduce((s, r) => s + r.revenue, 0);

          type SourceRow = {
            label: string; labelSuffix?: React.ReactNode; badge: string; badgeColor: string;
            liens: number | null;     // nb de liens envoyés (LM/DM uniquement)
            liensLabel: string | null; // ex: "LM envoyés", "liens DM"
            clics: number | null;
            isContentType: boolean;
            booked: number; honored: number; closed: number; revenue: number;
          };
          // Icônes directionnelles style WhatsApp
          const ArrowOut = () => (
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" style={{ display: 'inline', marginLeft: 3, verticalAlign: 'middle' }}>
              <path d="M2 9L9 2M9 2H4.5M9 2V6.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          );
          const ArrowIn = () => (
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" style={{ display: 'inline', marginLeft: 3, verticalAlign: 'middle' }}>
              <path d="M9 2L2 9M2 9H6.5M2 9V4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          );
          const rows: SourceRow[] = [
            { label: 'Bio IG', badge: 'IG', badgeColor: '#F06292', liens: null, liensLabel: null, clics: bioIG?.humanClicks30d ?? null, booked: bioIGBooked, honored: bioIGHonored, closed: bioIGClosed, revenue: bioIGRevenue, isContentType: true },
            { label: 'Bio YT', badge: 'YT', badgeColor: '#FF0000', liens: null, liensLabel: null, clics: bioYT?.humanClicks30d ?? null, booked: bioYTBooked, honored: bioYTHonored, closed: bioYTClosed, revenue: bioYTRevenue, isContentType: true },
            { label: 'Lien contenu IG', badge: 'IG', badgeColor: '#F06292', liens: null, liensLabel: null, clics: igContentClics, booked: igContentBooked, honored: igContentHonored, closed: igContentClosed, revenue: igContentRevenue, isContentType: true },
            { label: 'Lien contenu YT', badge: 'YT', badgeColor: '#FF0000', liens: null, liensLabel: null, clics: ytContentClics, booked: ytContentBooked, honored: ytContentHonored, closed: ytContentClosed, revenue: ytContentRevenue, isContentType: true },
            { label: 'Lead magnet', badge: 'LM', badgeColor: '#8B5CF6', liens: lmCalendlyLinks, liensLabel: 'liens Calendly', clics: lmProspectLinks.reduce((s: number, l: any) => s + (l.humanClicks30d || 0), 0), booked: lmBooked, honored: lmHonored, closed: lmClosed, revenue: lmRevenue, isContentType: false },
            { label: 'Cold DM', labelSuffix: <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 500 }}> (sortant <ArrowOut />)</span>, badge: 'DM', badgeColor: BLUE, liens: coldDMLinks.length, liensLabel: 'liens envoyés', clics: coldDMLinks.length > 0 ? coldClics : null, booked: coldBooked, honored: coldHonored, closed: coldClosed, revenue: coldRevenue, isContentType: false },
            { label: 'DM organique', labelSuffix: <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 500 }}> (entrant <ArrowIn />)</span>, badge: 'DM', badgeColor: '#10B981', liens: organicDMLinks.length, liensLabel: 'conversations', clics: organicDMLinks.length > 0 ? organicClics : null, booked: organicBooked, honored: organicHonored, closed: organicClosed, revenue: organicRevenue, isContentType: false },
          ];

          const totBooked = rows.reduce((s, r) => s + r.booked, 0);
          const totHonored = rows.reduce((s, r) => s + r.honored, 0);
          const totClosed = rows.reduce((s, r) => s + r.closed, 0);
          const totRevenue = rows.reduce((s, r) => s + r.revenue, 0);

          const tauxBadge = (num: number, den: number, isContent: boolean) => {
            if (den === 0) return null;
            const pct = Math.round((num / den) * 100);
            let color: string;
            if (isContent) {
              color = pct >= 2 ? GREEN : pct >= 1 ? AMBER : RED;
            } else {
              color = pct >= 50 ? GREEN : pct >= 25 ? AMBER : RED;
            }
            return { pct, color };
          };
          const tauxHonoréBadge = (honored: number, booked: number) => {
            if (booked === 0) return null;
            const pct = Math.round((honored / booked) * 100);
            const color = pct >= 75 ? GREEN : pct >= 50 ? AMBER : RED;
            return { pct, color };
          };
          const tauxClosedBadge = (closed: number, honored: number) => {
            if (honored === 0) return null;
            const pct = Math.round((closed / honored) * 100);
            const color = pct >= 50 ? GREEN : pct >= 25 ? AMBER : RED;
            return { pct, color };
          };

          const TH = ({ children, right }: { children: React.ReactNode; right?: boolean }) => (
            <th style={{ padding: '7px 10px', textAlign: right ? 'right' : 'left', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--muted)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{children}</th>
          );
          const TD = ({ children, right, faint }: { children: React.ReactNode; right?: boolean; faint?: boolean }) => (
            <td style={{ padding: '8px 10px', textAlign: right ? 'right' : 'left', fontSize: 12, color: faint ? 'var(--faint)' : 'var(--ink)', verticalAlign: 'middle' }}>{children}</td>
          );
          const RateBadge = ({ pct, color }: { pct: number; color: string }) => (
            <span style={{ fontSize: 10, fontWeight: 700, color, background: color + '18', borderRadius: 4, padding: '1px 5px', marginLeft: 4, whiteSpace: 'nowrap' }}>{pct}%</span>
          );

          // Tri des rows (la ligne Total est toujours en bas)
          const sortedRows = bdSortKey === 'default' ? rows : [...rows].sort((a, b) => {
            let va = 0, vb = 0;
            if (bdSortKey === 'clics')   { va = a.clics ?? -1; vb = b.clics ?? -1; }
            if (bdSortKey === 'booked')  { va = a.booked;  vb = b.booked; }
            if (bdSortKey === 'honored') { va = a.honored; vb = b.honored; }
            if (bdSortKey === 'closed')  { va = a.closed;  vb = b.closed; }
            if (bdSortKey === 'revenue') { va = a.revenue; vb = b.revenue; }
            return bdSortDir === 'desc' ? vb - va : va - vb;
          });

          const sortLabels: Record<BdSortKey, string> = {
            default: 'Ordre par défaut', clics: 'Clics / Liens', booked: 'Calls bookés',
            honored: 'Calls honorés', closed: 'Closés', revenue: 'Revenue',
          };

          return (
            <div style={{ marginTop: 20, border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ padding: '10px 14px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--ink)' }}>Breakdown par source</span>
                  <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--muted)', marginLeft: 8 }}>— vers Calendly</span>
                </div>
                {/* Sélecteur de tri */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 10, color: 'var(--faint)' }}>Trier par</span>
                  <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <select
                      value={bdSortKey}
                      onChange={e => { setBdSortKey(e.target.value as BdSortKey); setBdSortDir('desc'); }}
                      style={{ fontSize: 11, fontWeight: 600, color: bdSortKey !== 'default' ? BLUE : 'var(--muted)', background: 'var(--surface)', border: `1px solid ${bdSortKey !== 'default' ? BLUE + '40' : 'var(--border)'}`, borderRadius: 6, padding: '3px 8px', cursor: 'pointer', appearance: 'none', paddingRight: 20 }}
                    >
                      {(Object.keys(sortLabels) as BdSortKey[]).map(k => (
                        <option key={k} value={k}>{sortLabels[k]}</option>
                      ))}
                    </select>
                    <span style={{ position: 'absolute', right: 6, fontSize: 9, color: 'var(--faint)', pointerEvents: 'none' }}>▾</span>
                  </div>
                  {bdSortKey !== 'default' && (
                    <button
                      onClick={() => setBdSortDir(d => d === 'desc' ? 'asc' : 'desc')}
                      style={{ fontSize: 11, fontWeight: 700, color: BLUE, background: BLUE + '12', border: 'none', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', minWidth: 28, textAlign: 'center' }}
                    >
                      {bdSortDir === 'desc' ? '↓' : '↑'}
                    </button>
                  )}
                </div>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--surface-2)' }}>
                    <TH>Source</TH>
                    <TH right>Clics / Liens</TH>
                    <TH right>Calls bookés</TH>
                    <TH right>Calls honorés</TH>
                    <TH right>Closés</TH>
                    <TH right>Revenue</TH>
                    <TH right>Rev / call</TH>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((row, i) => {
                    const bkTaux = row.clics !== null ? tauxBadge(row.booked, row.clics, row.isContentType) : null;
                    const honTaux = tauxHonoréBadge(row.honored, row.booked);
                    const clsTaux = tauxClosedBadge(row.closed, row.honored);
                    return (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'transparent' : 'var(--surface-2)' }}>
                        <TD>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: '#fff', background: row.badgeColor, borderRadius: 4, padding: '2px 6px', flexShrink: 0 }}>{row.badge}</span>
                            <span style={{ fontSize: 12, fontWeight: 600 }}>{row.label}{row.labelSuffix}</span>
                          </div>
                        </TD>
                        <TD right>
                          {row.liens !== null ? (
                            // LM / Cold DM / DM organique : 2 lignes + taux
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                <span style={{ fontWeight: 700 }}>{fmt(row.liens)}</span>
                                <span style={{ fontSize: 10, color: 'var(--muted)' }}>{row.liensLabel}</span>
                              </div>
                              {row.clics !== null ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                  <span style={{ fontWeight: 600, color: 'var(--muted)' }}>{fmt(row.clics)}</span>
                                  <span style={{ fontSize: 10, color: 'var(--muted)' }}>clics</span>
                                  {row.liens > 0 && (() => {
                                    const pct = Math.round((row.clics / row.liens) * 100);
                                    const color = pct >= 50 ? GREEN : pct >= 25 ? AMBER : RED;
                                    return <span style={{ fontSize: 10, fontWeight: 700, color, background: color + '18', borderRadius: 4, padding: '1px 5px' }}>{pct}%</span>;
                                  })()}
                                </div>
                              ) : <span style={{ fontSize: 10, color: 'var(--faint)' }}>— clics</span>}
                            </div>
                          ) : row.clics !== null ? (
                            // Bio / contenu : juste les clics
                            <span style={{ fontWeight: 700 }}>{fmt(row.clics)}</span>
                          ) : (
                            <span style={{ color: 'var(--faint)' }}>—</span>
                          )}
                        </TD>
                        <TD right>
                          {row.booked > 0
                            ? <><span style={{ fontWeight: 700 }}>{row.booked}</span>{bkTaux && <RateBadge pct={bkTaux.pct} color={bkTaux.color} />}</>
                            : <span style={{ color: 'var(--faint)' }}>—</span>}
                        </TD>
                        <TD right>
                          {row.honored > 0
                            ? <><span style={{ fontWeight: 700 }}>{row.honored}</span>{honTaux && <RateBadge pct={honTaux.pct} color={honTaux.color} />}</>
                            : <span style={{ color: 'var(--faint)' }}>—</span>}
                        </TD>
                        <TD right>
                          {row.closed > 0
                            ? <><span style={{ fontWeight: 700 }}>{row.closed}</span>{clsTaux && <RateBadge pct={clsTaux.pct} color={clsTaux.color} />}</>
                            : <span style={{ color: 'var(--faint)' }}>—</span>}
                        </TD>
                        <TD right>
                          {row.revenue > 0
                            ? <span style={{ fontWeight: 800, color: GREEN }}>{fmtEur(row.revenue)}</span>
                            : <span style={{ color: 'var(--faint)' }}>—</span>}
                        </TD>
                        <TD right>
                          {row.honored > 0 && row.revenue > 0
                            ? <span style={{ fontWeight: 700, color: 'var(--ink)' }}>{fmtEur(Math.round(row.revenue / row.honored))}</span>
                            : <span style={{ color: 'var(--faint)' }}>—</span>}
                        </TD>
                      </tr>
                    );
                  })}
                  {/* Total row */}
                  <tr style={{ background: 'var(--surface-2)', borderTop: '2px solid var(--border)' }}>
                    <td style={{ padding: '9px 10px', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted)' }}>Total</td>
                    <TD right><span style={{ color: 'var(--muted)' }}>—</span></TD>
                    <TD right><span style={{ fontWeight: 800 }}>{totBooked > 0 ? totBooked : <span style={{ color: 'var(--faint)' }}>—</span>}</span></TD>
                    <TD right><span style={{ fontWeight: 800 }}>{totHonored > 0 ? totHonored : <span style={{ color: 'var(--faint)' }}>—</span>}</span></TD>
                    <TD right><span style={{ fontWeight: 800 }}>{totClosed > 0 ? totClosed : <span style={{ color: 'var(--faint)' }}>—</span>}</span></TD>
                    <TD right>{totRevenue > 0 ? <span style={{ fontWeight: 800, color: GREEN }}>{fmtEur(totRevenue)}</span> : <span style={{ color: 'var(--faint)' }}>—</span>}</TD>
                    <TD right>{totHonored > 0 && totRevenue > 0 ? <span style={{ fontWeight: 800, color: 'var(--ink)' }}>{fmtEur(Math.round(totRevenue / totHonored))}</span> : <span style={{ color: 'var(--faint)' }}>—</span>}</TD>
                  </tr>
                </tbody>
              </table>
            </div>
          );
        })()}
      </div>

      {/* ── Section 2 : Performance par contenu ── */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px 22px' }}>
        <SectionHead title="Performance par contenu" sub={`${consolidatedRows.length} contenus avec activité business`} />

        {/* Barre de filtres */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14, paddingBottom: 14, borderBottom: '1px solid var(--border)' }}>
          {/* Zone 1 : plateforme */}
          <div style={{ display: 'flex', gap: 3, background: 'var(--surface-2)', borderRadius: 7, padding: 3 }}>
            {(['all', 'IG', 'YT'] as const).map(p => (
              <button key={p} onClick={() => setFilterPlatform(p)} style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 5, cursor: 'pointer', border: 'none', background: filterPlatform === p ? 'var(--surface)' : 'transparent', color: filterPlatform === p ? 'var(--ink)' : 'var(--faint)', transition: 'all .15s' }}>
                {p === 'all' ? 'Tous' : p}
              </button>
            ))}
          </div>
          {/* Zone 2 : "au moins 1" — 2 lignes */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {([
              ['clicsDesc', 'min. 1 clic desc.'],
              ['lmDetectes', 'min. 1 commentaire LM'],
              ['lmClics', 'min. 1 clic LM'],
              ['lmReponses', 'min. 1 réponse LM'],
              ['dmCount', 'min. 1 lien DM'],
            ] as [SortKey, string][]).map(([key, label]) => {
              const active = filterHas.has(key);
              return (
                <button key={key} onClick={() => {
                  const next = new Set(filterHas);
                  active ? next.delete(key) : next.add(key);
                  setFilterHas(next);
                }} style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 6, cursor: 'pointer', border: `1px solid ${active ? BLUE : 'var(--border)'}`, background: active ? BLUE + '12' : 'transparent', color: active ? BLUE : 'var(--muted)', transition: 'all .12s' }}>
                  {label}
                </button>
              );
            })}
            </div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {([
              ['callsBooked', 'min. 1 call booké'],
              ['callsHonored', 'min. 1 call honoré'],
              ['closed', 'min. 1 closé'],
              ['revenue', 'min. 1 € revenue'],
            ] as [SortKey, string][]).map(([key, label]) => {
              const active = filterHas.has(key);
              return (
                <button key={key} onClick={() => {
                  const next = new Set(filterHas);
                  active ? next.delete(key) : next.add(key);
                  setFilterHas(next);
                }} style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 6, cursor: 'pointer', border: `1px solid ${active ? BLUE : 'var(--border)'}`, background: active ? BLUE + '12' : 'transparent', color: active ? BLUE : 'var(--muted)', transition: 'all .12s' }}>
                  {label}
                </button>
              );
            })}
            </div>
          </div>
          {/* Zone 3 : recherche */}
          <input
            type="text" value={filterSearch} onChange={e => setFilterSearch(e.target.value)}
            placeholder="Recherche par titre…"
            style={{ flex: 1, minWidth: 160, padding: '6px 10px', fontSize: 12, borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--ink)' }}
          />
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 780 }}>
            <thead>
              <tr>
                {/* Thumbnail */}
                <th style={{ width: 44, borderBottom: '1px solid var(--border)', padding: '6px 10px 10px' }} />
                {/* Contenu — pas de tri */}
                <th style={{ textAlign: 'left', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', color: 'var(--muted)', padding: '6px 10px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>Contenu</th>
                {([
                  ['clicsDesc',    'Clics desc.'],
                  ['lmDetectes',   'Commentaires LM'],
                  ['lmClics',      'Clics LM'],
                  ['lmReponses',   'Réponses LM'],
                  ['dmCount',      'Liens DM'],
                  ['callsBooked',  'Calls bookés'],
                  ['callsHonored', 'Calls honorés'],
                  ['closed',       'Closés'],
                  ['revenue',      'Revenue'],
                  ['vuesParCall',  'Vues / Call'],
                ] as [SortKey, string][]).map(([key, label]) => {
                  const active = sortKey === key;
                  return (
                    <th key={key} onClick={() => { if (active) setSortDir(d => d === 'desc' ? 'asc' : 'desc'); else { setSortKey(key); setSortDir('desc'); } }}
                      style={{ textAlign: 'right', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', color: active ? BLUE : 'var(--muted)', padding: '6px 10px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' }}>
                      {label} {active ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                    </th>
                  );
                })}
              </tr>
            </thead>
            {(() => {
                const filteredRows = consolidatedRows
                  .filter(row => {
                    if (filterPlatform !== 'all' && row.platform !== filterPlatform) return false;
                    if (filterSearch && !row.title.toLowerCase().includes(filterSearch.toLowerCase())) return false;
                    for (const k of filterHas) {
                      const val = row[k as keyof typeof row];
                      if (!val || val === 0) return false;
                    }
                    return true;
                  })
                  .sort((a, b) => {
                    const av = (a[sortKey as keyof typeof a] as number) || 0;
                    const bv = (b[sortKey as keyof typeof b] as number) || 0;
                    return sortDir === 'desc' ? bv - av : av - bv;
                  });
                const displayRows = filteredRows.slice(0, 7);

                const ContentRow = ({ row, i }: { row: typeof filteredRows[0]; i: number }) => {
                  const platformColor = row.platform === 'IG' ? ACCENT : RED;
                  const isSelected = selectedContentId === row.postId;
                  return (
                    <tr key={i}
                      onClick={() => { setSelectedContentId(isSelected ? null : row.postId); setDetailModal(isSelected ? null : row); }}
                      style={{ borderBottom: '1px solid var(--border-soft)', cursor: 'pointer', background: isSelected ? BLUE + '07' : '' }}
                      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'var(--surface-2)'; }}
                      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = ''; }}>
                      <td style={{ padding: '8px 10px', width: 40 }}>
                        {row.thumbnail
                          ? <img src={row.thumbnail} alt="" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 6, display: 'block' }} />
                          : <div style={{ width: 36, height: 36, borderRadius: 6, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>{row.platform === 'IG' ? '📷' : '▶️'}</div>}
                      </td>
                      <td style={{ padding: '8px 10px', maxWidth: 200 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 3 }}>{row.title.slice(0, 45)}{row.title.length > 45 ? '…' : ''}</div>
                        <span style={{ fontSize: 9, fontWeight: 700, color: platformColor, background: platformColor + '18', borderRadius: 4, padding: '2px 5px' }}>{row.platform} · {row.type}</span>
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 13, fontWeight: row.clicsDesc > 0 ? 700 : 400, color: row.clicsDesc > 0 ? 'var(--ink)' : 'var(--faint)' }}>{row.clicsDesc > 0 ? fmt(row.clicsDesc) : '—'}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 13, fontWeight: row.lmDetectes > 0 ? 700 : 400, color: row.lmDetectes > 0 ? 'var(--ink)' : 'var(--faint)' }}>{row.lmDetectes > 0 ? row.lmDetectes : '—'}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 13, fontWeight: row.lmClics > 0 ? 700 : 400, color: row.lmClics > 0 ? 'var(--ink)' : 'var(--faint)' }}>{row.lmDetectes > 0 ? (row.lmClics > 0 ? row.lmClics : '0') : '—'}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 13, fontWeight: row.lmReponses > 0 ? 700 : 400, color: row.lmReponses > 0 ? 'var(--ink)' : 'var(--faint)' }}>{row.lmDetectes > 0 ? (row.lmReponses > 0 ? row.lmReponses : '0') : '—'}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 13, fontWeight: row.dmCount > 0 ? 700 : 400, color: row.dmCount > 0 ? 'var(--ink)' : 'var(--faint)' }}>{row.dmCount > 0 ? row.dmCount : '—'}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 13, fontWeight: row.callsBooked > 0 ? 700 : 400, color: row.callsBooked > 0 ? GREEN : 'var(--faint)' }}>{row.callsBooked > 0 ? row.callsBooked : '—'}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 13, fontWeight: row.callsHonored > 0 ? 700 : 400, color: row.callsHonored > 0 ? GREEN : 'var(--faint)' }}>{row.callsHonored > 0 ? row.callsHonored : '—'}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 13, fontWeight: row.closed > 0 ? 700 : 400, color: row.closed > 0 ? GREEN : 'var(--faint)' }}>{row.closed > 0 ? row.closed : '—'}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 13, fontWeight: 700, color: row.revenue > 0 ? GREEN : 'var(--faint)', whiteSpace: 'nowrap' }}>{row.revenue > 0 ? fmtEur(row.revenue) : '—'}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 12, color: row.vuesParCall ? 'var(--muted)' : 'var(--faint)', fontWeight: row.vuesParCall ? 600 : 400 }}>{row.vuesParCall ? fmt(row.vuesParCall) : '—'}</td>
                    </tr>
                  );
                };

                return <tbody>{displayRows.map((row, i) => <ContentRow key={i} row={row} i={i} />)}</tbody>;
              })()}
          </table>
        </div>

        {/* Bouton Voir tout */}
        {consolidatedRows.length > 7 && (
          <div style={{ marginTop: 12, textAlign: 'center' }}>
            <button onClick={() => setShowAllTable(true)} style={{ padding: '7px 20px', fontSize: 12, fontWeight: 600, borderRadius: 8, cursor: 'pointer', border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', transition: 'all .15s' }}>
              Voir tout ({consolidatedRows.length} contenus)
            </button>
          </div>
        )}
      </div>

      {/* ── Modal "Voir tout" Performance par contenu ── */}
      {showAllTable && createPortal(
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 9998, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '32px 16px', overflowY: 'auto' }}
          onClick={() => setShowAllTable(false)}>
          <div style={{ width: '100%', maxWidth: 1200, background: 'var(--surface)', borderRadius: 14, padding: '24px 28px', boxShadow: '0 20px 60px rgba(0,0,0,.25)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>Performance par contenu</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>{consolidatedRows.length} contenus</div>
              </div>
              <button onClick={() => setShowAllTable(false)} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--muted)', lineHeight: 1 }}>×</button>
            </div>
            <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 180px)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 780 }}>
                <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
                  <tr>
                    <th style={{ width: 44, borderBottom: '1px solid var(--border)', padding: '6px 10px 10px' }} />
                    <th style={{ textAlign: 'left', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', color: 'var(--muted)', padding: '6px 10px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>Contenu</th>
                    {(['clicsDesc', 'lmDetectes', 'lmClics', 'lmReponses', 'dmCount', 'callsBooked', 'callsHonored', 'closed', 'revenue', 'vuesParCall'] as SortKey[]).map(key => {
                      const labels: Record<string, string> = { clicsDesc: 'Clics desc.', lmDetectes: 'Commentaires LM', lmClics: 'Clics LM', lmReponses: 'Réponses LM', dmCount: 'Liens DM', callsBooked: 'Calls bookés', callsHonored: 'Calls honorés', closed: 'Closés', revenue: 'Revenue', vuesParCall: 'Vues / Call' };
                      const active = sortKey === key;
                      return (
                        <th key={key} onClick={() => { if (active) setSortDir(d => d === 'desc' ? 'asc' : 'desc'); else { setSortKey(key); setSortDir('desc'); } }}
                          style={{ textAlign: 'right', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', color: active ? BLUE : 'var(--muted)', padding: '6px 10px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' }}>
                          {labels[key]} {active ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {consolidatedRows
                    .filter(row => {
                      if (filterPlatform !== 'all' && row.platform !== filterPlatform) return false;
                      if (filterSearch && !row.title.toLowerCase().includes(filterSearch.toLowerCase())) return false;
                      for (const k of filterHas) {
                        const val = row[k as keyof typeof row];
                        if (!val || val === 0) return false;
                      }
                      return true;
                    })
                    .sort((a, b) => {
                      const av = (a[sortKey as keyof typeof a] as number) || 0;
                      const bv = (b[sortKey as keyof typeof b] as number) || 0;
                      return sortDir === 'desc' ? bv - av : av - bv;
                    })
                    .map((row, i) => {
                      const platformColor = row.platform === 'IG' ? ACCENT : RED;
                      const isSelected = selectedContentId === row.postId;
                      return (
                        <tr key={i}
                          onClick={() => { setSelectedContentId(isSelected ? null : row.postId); setDetailModal(isSelected ? null : row); setShowAllTable(false); }}
                          style={{ borderBottom: '1px solid var(--border-soft)', cursor: 'pointer', background: isSelected ? BLUE + '07' : '' }}
                          onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'var(--surface-2)'; }}
                          onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = ''; }}>
                          <td style={{ padding: '8px 10px', width: 40 }}>
                            {row.thumbnail
                              ? <img src={row.thumbnail} alt="" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 6, display: 'block' }} />
                              : <div style={{ width: 36, height: 36, borderRadius: 6, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>{row.platform === 'IG' ? '📷' : '▶️'}</div>}
                          </td>
                          <td style={{ padding: '8px 10px', maxWidth: 200 }}>
                            <div style={{ fontSize: 11, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 3 }}>{row.title.slice(0, 45)}{row.title.length > 45 ? '…' : ''}</div>
                            <span style={{ fontSize: 9, fontWeight: 700, color: platformColor, background: platformColor + '18', borderRadius: 4, padding: '2px 5px' }}>{row.platform} · {row.type}</span>
                          </td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 13, fontWeight: row.clicsDesc > 0 ? 700 : 400, color: row.clicsDesc > 0 ? 'var(--ink)' : 'var(--faint)' }}>{row.clicsDesc > 0 ? fmt(row.clicsDesc) : '—'}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 13, fontWeight: row.lmDetectes > 0 ? 700 : 400, color: row.lmDetectes > 0 ? 'var(--ink)' : 'var(--faint)' }}>{row.lmDetectes > 0 ? row.lmDetectes : '—'}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 13, fontWeight: row.lmClics > 0 ? 700 : 400, color: row.lmClics > 0 ? 'var(--ink)' : 'var(--faint)' }}>{row.lmDetectes > 0 ? (row.lmClics > 0 ? row.lmClics : '0') : '—'}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 13, fontWeight: row.lmReponses > 0 ? 700 : 400, color: row.lmReponses > 0 ? 'var(--ink)' : 'var(--faint)' }}>{row.lmDetectes > 0 ? (row.lmReponses > 0 ? row.lmReponses : '0') : '—'}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 13, fontWeight: row.dmCount > 0 ? 700 : 400, color: row.dmCount > 0 ? 'var(--ink)' : 'var(--faint)' }}>{row.dmCount > 0 ? row.dmCount : '—'}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 13, fontWeight: row.callsBooked > 0 ? 700 : 400, color: row.callsBooked > 0 ? GREEN : 'var(--faint)' }}>{row.callsBooked > 0 ? row.callsBooked : '—'}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 13, fontWeight: row.callsHonored > 0 ? 700 : 400, color: row.callsHonored > 0 ? GREEN : 'var(--faint)' }}>{row.callsHonored > 0 ? row.callsHonored : '—'}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 13, fontWeight: row.closed > 0 ? 700 : 400, color: row.closed > 0 ? GREEN : 'var(--faint)' }}>{row.closed > 0 ? row.closed : '—'}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 13, fontWeight: 700, color: row.revenue > 0 ? GREEN : 'var(--faint)', whiteSpace: 'nowrap' }}>{row.revenue > 0 ? fmtEur(row.revenue) : '—'}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 12, color: row.vuesParCall ? 'var(--muted)' : 'var(--faint)', fontWeight: row.vuesParCall ? 600 : 400 }}>{row.vuesParCall ? fmt(row.vuesParCall) : '—'}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── Modal détail contenu ── */}
      {detailModal && (() => {
        const row = detailModal;
        const igPost = igPosts.find(p => p.id === row.postId);
        const ytVideo = ytVideos.find(v => v.id === row.postId);
        const platformColor = row.platform === 'IG' ? ACCENT : RED;
        const pubDate = igPost?.timestamp || ytVideo?.publishedAt;
        const pubDateStr = pubDate ? new Date(pubDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : null;

        // Seuils couleurs funnel
        const convColor = (rate: number, threshold: number) => rate >= threshold ? GREEN : rate >= threshold * 0.6 ? AMBER : RED;

        // Funnel lien contenu
        const f1_clics = row.clicsDesc;
        const f1_calls = row.callsBooked; // simplification mock
        const f1_honored = row.callsHonored;
        const f1_closed = row.closed;
        const f1_revenue = row.revenue;
        const r1_clicCall = f1_clics > 0 ? Math.round((f1_calls / f1_clics) * 100) : null;
        const r1_callHon = f1_calls > 0 ? Math.round((f1_honored / f1_calls) * 100) : null;
        const r1_honClosed = f1_honored > 0 ? Math.round((f1_closed / f1_honored) * 100) : null;

        // Funnel lead magnet
        const f2_comments = row.lmDetectes;
        const f2_sent = row.lmSent;
        const f2_calls = row.callsBooked; // mock : même calls
        const f2_honored = row.callsHonored;
        const f2_closed = row.closed;
        const f2_revenue = row.revenue;
        const r2_sentComm = f2_comments > 0 ? Math.round((f2_sent / f2_comments) * 100) : null;
        const r2_callSent = f2_sent > 0 ? Math.round((f2_calls / f2_sent) * 100) : null;
        const r2_callHon = f2_calls > 0 ? Math.round((f2_honored / f2_calls) * 100) : null;
        const r2_honClosed = f2_honored > 0 ? Math.round((f2_closed / f2_honored) * 100) : null;

        // Rétention YT — 11 points calqués sur la vraie courbe YouTube Studio
        // Chute brutale 100→22 entre 1% et 11%, puis décroissance exponentielle douce
        const retentionData = row.platform === 'YT' ? [
          { pct: '1%',   viewers: 100 },
          { pct: '11%',  viewers: 22 },
          { pct: '21%',  viewers: 14 },
          { pct: '31%',  viewers: 10 },
          { pct: '41%',  viewers: 8 },
          { pct: '51%',  viewers: 6 },
          { pct: '61%',  viewers: 5 },
          { pct: '71%',  viewers: 4 },
          { pct: '81%',  viewers: 5 },
          { pct: '91%',  viewers: 4 },
          { pct: '100%', viewers: 3 },
        ] : null;

        // Prospects DM liés
        const linkedProspects = prospectLinks.filter((l: any) => l.postId === row.postId);
        const statusMap2: Record<string, string> = { closed: 'Closé', booked: 'Call booké', pending: 'En attente', noshow: 'No-show' };

        const FunnelStep = ({ label, value, rate, rateThreshold, isFirst }: { label: string; value: number | null; rate: number | null; rateThreshold?: number; isFirst?: boolean }) => (
          <div>
            {!isFirst && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0' }}>
                <div style={{ fontSize: 14, color: 'var(--faint)' }}>↓</div>
                {rate !== null && rateThreshold !== undefined && (
                  <span style={{ fontSize: 10, fontWeight: 700, color: convColor(rate, rateThreshold), background: convColor(rate, rateThreshold) + '18', borderRadius: 4, padding: '1px 6px' }}>{rate}%</span>
                )}
              </div>
            )}
            <div style={{ background: 'var(--surface-2)', borderRadius: 7, padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{label}</span>
              <span style={{ fontSize: 14, fontWeight: 800, color: value ? 'var(--ink)' : 'var(--faint)' }}>{value != null && value > 0 ? (label === 'Revenue' ? fmtEur(value) : value) : '—'}</span>
            </div>
          </div>
        );

        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
            onClick={() => { setDetailModal(null); setSelectedContentId(null); }}>
            <div style={{ background: 'var(--surface)', borderRadius: 16, maxWidth: 780, width: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 32px 80px rgba(0,0,0,.25)' }}
              onClick={e => e.stopPropagation()}>

              {/* Header modal */}
              <div style={{ padding: '22px 26px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                <div style={{ width: 56, height: 56, borderRadius: 10, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, flexShrink: 0 }}>
                  {row.thumbnail ? <img src={row.thumbnail} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 10 }} /> : (row.platform === 'IG' ? '📷' : '▶️')}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4, lineHeight: 1.3 }}>{row.title}</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: platformColor, background: platformColor + '18', borderRadius: 4, padding: '2px 7px' }}>{row.platform} · {row.type}</span>
                    {pubDateStr && <span style={{ fontSize: 11, color: 'var(--faint)' }}>Publié le {pubDateStr}</span>}
                  </div>
                </div>
                <button onClick={() => { setDetailModal(null); setSelectedContentId(null); }} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--muted)', flexShrink: 0, lineHeight: 1, padding: 4 }}>×</button>
              </div>

              <div style={{ padding: '20px 26px', display: 'flex', flexDirection: 'column', gap: 24 }}>

                {/* Bloc 1 : Performances réseau */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 12 }}>Performances réseau</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 10 }}>
                    {row.platform === 'IG' && igPost && (() => {
                      const isImage = igPost.type === 'IMAGE';
                      const metrics = [
                        [isImage ? 'Impressions' : 'Vues', isImage ? igPost.reach : igPost.views],
                        ['Likes', igPost.likes], ['Commentaires', igPost.comments],
                        ['Partages', igPost.shares], ['Reach', igPost.reach],
                        ...(!isImage ? [['Sauvegardes', igPost.saved]] as [string, number | null][] : [['Sauvegardes', igPost.saved]] as [string, number | null][]),
                        ...(!isImage && igPost.avgWatchTimeMs ? [['Watch time moy.', `${(igPost.avgWatchTimeMs / 1000).toFixed(1)}s`]] as [string, any][] : []),
                        ...(!isImage && igPost.skipRate != null ? [['Skip rate', `${Math.round(igPost.skipRate * 100)}%`]] as [string, any][] : []),
                      ];
                      return metrics.map(([label, val], i) => (
                        <div key={i} style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '10px 12px' }}>
                          <div style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 4 }}>{label}</div>
                          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink)' }}>{val != null ? (typeof val === 'number' ? fmt(val) : val) : '—'}</div>
                        </div>
                      ));
                    })()}
                    {row.platform === 'YT' && ytVideo && (() => {
                      const metrics: [string, any][] = [
                        ['Vues', ytVideo.views], ['Likes', ytVideo.likes], ['Commentaires', ytVideo.comments],
                        ['Partages', ytVideo.shares30d], ['Watch time moy.', (() => { const sec = Math.round(ytVideo.watchTime30d / (ytVideo.views30d || 1)); return sec >= 3600 ? `${Math.round(sec/3600)}h` : `${Math.floor(sec/60)}m${String(sec%60).padStart(2,'0')}s`; })()],
                        ['% vu moy.', `${ytVideo.avgViewPct}%`], ['CTR miniature', '4,2%'],
                      ];
                      return metrics.map(([label, val], i) => (
                        <div key={i} style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '10px 12px' }}>
                          <div style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 4 }}>{label}</div>
                          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink)' }}>{val != null ? val : '—'}</div>
                        </div>
                      ));
                    })()}
                  </div>

                  {/* Courbe rétention YT */}
                  {retentionData && (() => {
                    const W = 400; const H = 80;
                    const n = retentionData.length - 1;
                    const pts = retentionData.map((d, i) => ({ x: (i / n) * W, y: H - (d.viewers / 100) * H }));
                    const linePts = pts.map(p => `${p.x},${p.y}`).join(' ');
                    // fill sous la courbe : path fermé vers le bas
                    const fillPath = `M${pts[0].x},${pts[0].y} ` + pts.slice(1).map(p => `L${p.x},${p.y}`).join(' ') + ` L${pts[n].x},${H} L${pts[0].x},${H} Z`;
                    return (
                      <div style={{ marginTop: 14 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 8 }}>Courbe de rétention</div>
                        <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '14px 16px 10px', border: '1px solid var(--border)' }}>
                          <div style={{ position: 'relative' }}>
                            {/* Lignes de grille horizontales */}
                            <svg width="100%" viewBox={`0 0 ${W} ${H + 4}`} preserveAspectRatio="none" style={{ display: 'block', height: 90 }}>
                              {[100, 50, 25, 0].map(v => (
                                <line key={v} x1="0" y1={H - (v / 100) * H} x2={W} y2={H - (v / 100) * H}
                                  stroke="var(--border)" strokeWidth="0.8" opacity="0.7" />
                              ))}
                              {/* Fill sous courbe */}
                              <path d={fillPath} fill={GREEN} opacity="0.12" />
                              {/* Courbe principale */}
                              <polyline points={linePts} fill="none" stroke={GREEN} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                            </svg>
                            {/* Labels Y */}
                            <div style={{ position: 'absolute', top: 0, left: 0, height: 90, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', pointerEvents: 'none' }}>
                              {[100, 50, 25, 0].map(v => (
                                <div key={v} style={{ fontSize: 8, color: 'var(--faint)', lineHeight: 1 }}>{v}</div>
                              ))}
                            </div>
                          </div>
                          {/* Labels X */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, paddingLeft: 14 }}>
                            {retentionData.map((d, i) => (
                              <div key={i} style={{ fontSize: 8, color: 'var(--faint)', textAlign: 'center' }}>{d.pct}</div>
                            ))}
                          </div>
                        </div>
                        <div style={{ marginTop: 6, fontSize: 10, color: 'var(--muted)', textAlign: 'center' }}>
                          <a href={ytVideo?.url} target="_blank" rel="noopener noreferrer" style={{ color: RED, fontWeight: 700, textDecoration: 'none' }}>Voir sur YouTube →</a>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* Bloc 2 : Performance business */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 12 }}>Performance business</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1px 1fr', gap: 0 }}>
                    {/* Colonne gauche : lien description */}
                    <div style={{ paddingRight: 20 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: BLUE, marginBottom: 12 }}>📎 Via lien description</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                        <FunnelStep label="Clics" value={f1_clics} rate={null} isFirst />
                        <FunnelStep label="Calls bookés" value={f1_calls} rate={r1_clicCall} rateThreshold={25} />
                        <FunnelStep label="Calls honorés" value={f1_honored} rate={r1_callHon} rateThreshold={75} />
                        <FunnelStep label="Closés" value={f1_closed} rate={r1_honClosed} rateThreshold={50} />
                        <FunnelStep label="Revenue" value={f1_revenue} rate={null} />
                      </div>
                    </div>
                    {/* Divider */}
                    <div style={{ background: 'var(--border)', margin: '0 0' }} />
                    {/* Colonne droite : lead magnet */}
                    <div style={{ paddingLeft: 20 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: AMBER, marginBottom: 12 }}>📄 Via lead magnet</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                        <FunnelStep label="Commentaires détectés" value={f2_comments} rate={null} isFirst />
                        <FunnelStep label="LM envoyés" value={f2_sent} rate={r2_sentComm} rateThreshold={80} />
                        <FunnelStep label="Calls bookés" value={f2_calls} rate={r2_callSent} rateThreshold={20} />
                        <FunnelStep label="Calls honorés" value={f2_honored} rate={r2_callHon} rateThreshold={75} />
                        <FunnelStep label="Closés" value={f2_closed} rate={r2_honClosed} rateThreshold={50} />
                        <FunnelStep label="Revenue" value={f2_revenue} rate={null} />
                      </div>
                    </div>
                  </div>
                  {/* Total combiné */}
                  <div style={{ marginTop: 14, padding: '12px 16px', background: 'var(--surface-2)', borderRadius: 9, display: 'flex', justifyContent: 'center', gap: 40, alignItems: 'center' }}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 3 }}>Calls totaux</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: row.callsBooked > 0 ? GREEN : 'var(--faint)' }}>{row.callsBooked || '—'}</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 3 }}>Closés</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: row.closed > 0 ? GREEN : 'var(--faint)' }}>{row.closed || '—'}</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 3 }}>Revenue total</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: row.revenue > 0 ? GREEN : 'var(--faint)' }}>{row.revenue > 0 ? fmtEur(row.revenue) : '—'}</div>
                    </div>
                  </div>
                </div>

                {/* Bloc 3 : Prospects DM liés */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 12 }}>Prospects DM liés à ce contenu</div>
                  {linkedProspects.length === 0
                    ? <div style={{ fontSize: 12, color: 'var(--faint)', padding: '12px 0' }}>Aucun lien DM généré depuis ce contenu.</div>
                    : (
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr>
                            {['Prospect', 'Canal', 'Lien créé', 'Statut', 'Revenue'].map((h, i) => (
                              <th key={i} style={{ textAlign: i >= 3 ? 'right' : 'left', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', color: 'var(--muted)', padding: '6px 10px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {linkedProspects.map((l: any, i: number) => {
                            const lead = leads.find(ml => ml.igUserId === l.igUserId);
                            const canal = lead?.leadMagnetSent ? 'LM' : (l.dmType === 'organic' ? 'DM organique' : 'Cold DM');
                            const canalColor2 = lead?.leadMagnetSent ? AMBER : (l.dmType === 'organic' ? '#10B981' : BLUE);
                            const st = getProspectStatus(l);
                            const daysAgo2 = Math.floor((Date.now() - new Date(l.createdAt).getTime()) / 86400000);
                            return (
                              <tr key={i} style={{ borderBottom: '1px solid var(--border-soft)' }}
                                onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                                onMouseLeave={e => (e.currentTarget.style.background = '')}>
                                <td style={{ padding: '9px 10px', fontSize: 12, fontWeight: 700 }}>@{l.igUsername}</td>
                                <td style={{ padding: '9px 10px' }}>
                                  <span style={{ fontSize: 10, fontWeight: 700, color: canalColor2, background: canalColor2 + '18', borderRadius: 4, padding: '2px 6px' }}>{canal}</span>
                                </td>
                                <td style={{ padding: '9px 10px', fontSize: 11, color: 'var(--muted)' }}>il y a {daysAgo2}j</td>
                                <td style={{ padding: '9px 10px', textAlign: 'right' }}>
                                  <span style={{ fontSize: 10, fontWeight: 700, color: statusColor[st] || 'var(--muted)', background: (statusColor[st] || 'var(--muted)') + '18', borderRadius: 4, padding: '2px 7px' }}>{statusMap2[st]}</span>
                                </td>
                                <td style={{ padding: '9px 10px', textAlign: 'right', fontSize: 13, fontWeight: 700, color: l.revenue ? GREEN : 'var(--faint)' }}>{l.revenue ? fmtEur(l.revenue) : '—'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}


      {/* ── Section 2b : Performance LM ── */}
      {(() => {

        const ratePct = (v: number, of: number) => of > 0 ? Math.round((v / of) * 100) : 0;
        const rateColor = (pct: number, high = 50, mid = 30) =>
          pct >= high ? GREEN : pct >= mid ? AMBER : RED;
        const closeColor = (pct: number) => pct >= 70 ? GREEN : pct >= 50 ? AMBER : RED;

        const thS: React.CSSProperties = {
          textAlign: 'right', fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
          color: 'var(--muted)', padding: '6px 12px 10px', borderBottom: '1px solid var(--border)',
          whiteSpace: 'nowrap',
        };
        const tdS: React.CSSProperties = {
          padding: '10px 12px', textAlign: 'right', fontSize: 13, verticalAlign: 'top',
          borderBottom: '1px solid var(--border-soft)',
        };

        const Sub = ({ pct, isClose }: { pct: number; isClose?: boolean }) => (
          <div style={{ fontSize: 10, fontWeight: 600, color: isClose ? closeColor(pct) : rateColor(pct), marginTop: 2 }}>{pct}%</div>
        );

        return (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px 22px' }}>
            <SectionHead title="Performance LM" sub={leadMagnets.length > 0 ? `${leadMagnets.length} lead magnet${leadMagnets.length > 1 ? 's' : ''} — agrégat tous contenus` : 'Aucun lead magnet configuré'} />
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 960 }}>
                <thead>
                  <tr>
                    <th style={{ ...thS, textAlign: 'left', width: 140 }}>Lead magnet</th>
                    <th style={thS}>Leads générés</th>
                    <th style={thS}>Clics LM DM</th>
                    <th style={thS}>Réponses DM</th>
                    <th style={thS}>Calendly envoyés DM</th>
                    <th style={thS}>Clics Calendly DM</th>
                    <th style={thS}>Calls bookés</th>
                    <th style={thS}>Calls honorés</th>
                    <th style={thS}>Closés</th>
                    <th style={thS}>Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {leadMagnets.length === 0 && (
                    <tr><td colSpan={10} style={{ padding: '20px', textAlign: 'center', fontSize: 12, color: 'var(--faint)' }}>Aucun lead magnet configuré — ajoutez-en via les paramètres</td></tr>
                  )}
                  {leadMagnets.map((lm, i) => {
                    // Agrège les leads correspondant à ce keyword
                    const lmLeads = (leads as any[]).filter(l => l.keyword?.toLowerCase() === lm.keyword?.toLowerCase());
                    const leadsCount = lmLeads.filter(l => l.leadMagnetSent).length;
                    const clicsLM = lmLeads.filter(l => l.lmClicked).length;
                    const reponses = lmLeads.filter(l => l.hookReplied).length;
                    // Liens Calendly envoyés depuis les prospects liés à ce LM
                    const lmProspects = prospectLinks.filter((l: any) => {
                      const lead = lmLeads.find((ml: any) => ml.igUserId === l.igUserId);
                      return !!lead;
                    });
                    const liensCalendly = lmProspects.length;
                    const clicsCalendly = lmProspects.reduce((s: number, l: any) => s + (l.humanClicks30d || 0), 0);
                    const booked = lmProspects.filter((l: any) => l.callBooked).length;
                    const honored = booked; // pas de donnée séparée
                    const closed = lmProspects.filter((l: any) => l.dealClosed === true).length;
                    const revenue = lmProspects.reduce((s: number, l: any) => s + (l.revenue || 0), 0);

                    const hasActivity = leadsCount > 0;

                    return (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border-soft)' }}>
                        <td style={{ ...tdS, textAlign: 'left', fontWeight: 600, fontSize: 12, color: 'var(--ink)' }}>
                          {lm.name}
                          <div style={{ fontSize: 10, color: 'var(--faint)', fontWeight: 400, marginTop: 2 }}>mot-clé : {lm.keyword}</div>
                          {!hasActivity && <div style={{ fontSize: 10, color: 'var(--faint)', fontWeight: 400 }}>Aucune activité</div>}
                        </td>
                        <td style={{ ...tdS, fontWeight: leadsCount > 0 ? 700 : 400, color: leadsCount > 0 ? 'var(--ink)' : 'var(--faint)' }}>{hasActivity ? leadsCount : '—'}</td>
                        <td style={tdS}>
                          <div style={{ fontWeight: clicsLM > 0 ? 700 : 400, color: clicsLM > 0 ? 'var(--ink)' : 'var(--faint)' }}>{hasActivity ? clicsLM : '—'}</div>
                          {hasActivity && leadsCount > 0 && <Sub pct={ratePct(clicsLM, leadsCount)} />}
                        </td>
                        <td style={tdS}>
                          <div style={{ fontWeight: reponses > 0 ? 700 : 400, color: reponses > 0 ? 'var(--ink)' : 'var(--faint)' }}>{hasActivity ? reponses : '—'}</div>
                          {hasActivity && clicsLM > 0 && <Sub pct={ratePct(reponses, clicsLM)} />}
                        </td>
                        <td style={{ ...tdS, fontWeight: liensCalendly > 0 ? 700 : 400, color: liensCalendly > 0 ? 'var(--ink)' : 'var(--faint)' }}>{hasActivity ? liensCalendly : '—'}</td>
                        <td style={tdS}>
                          <div style={{ fontWeight: clicsCalendly > 0 ? 700 : 400, color: clicsCalendly > 0 ? 'var(--ink)' : 'var(--faint)' }}>{hasActivity ? clicsCalendly : '—'}</div>
                          {hasActivity && liensCalendly > 0 && <Sub pct={ratePct(clicsCalendly, liensCalendly)} />}
                        </td>
                        <td style={tdS}>
                          <div style={{ fontWeight: booked > 0 ? 700 : 400, color: booked > 0 ? GREEN : 'var(--faint)' }}>{hasActivity ? booked : '—'}</div>
                          {hasActivity && clicsCalendly > 0 && <Sub pct={ratePct(booked, clicsCalendly)} />}
                        </td>
                        <td style={tdS}>
                          <div style={{ fontWeight: honored > 0 ? 700 : 400, color: honored > 0 ? GREEN : 'var(--faint)' }}>{hasActivity ? honored : '—'}</div>
                          {hasActivity && booked > 0 && <Sub pct={ratePct(honored, booked)} isClose />}
                        </td>
                        <td style={tdS}>
                          <div style={{ fontWeight: closed > 0 ? 700 : 400, color: closed > 0 ? GREEN : 'var(--faint)' }}>{hasActivity ? closed : '—'}</div>
                          {hasActivity && honored > 0 && <Sub pct={ratePct(closed, honored)} isClose />}
                        </td>
                        <td style={{ ...tdS, fontWeight: 700, color: revenue > 0 ? GREEN : 'var(--faint)', whiteSpace: 'nowrap' }}>
                          {revenue > 0 ? fmtEur(revenue) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}



      {/* ── Modal création lien ── */}
      {showCreate && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={() => { setShowCreate(false); resetModal(); }}>
          <div style={{ background: 'var(--surface)', borderRadius: 16, padding: 28, maxWidth: 520, width: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 60px rgba(0,0,0,.2)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>Générer un lien tracké</div>
              <button onClick={() => { setShowCreate(false); resetModal(); }} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--muted)', lineHeight: 1 }}>×</button>
            </div>
            {createdLink ? (
              <div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>Lien créé — copie et envoie en DM</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface-2)', borderRadius: 8, padding: '10px 14px', marginBottom: 12 }}>
                  <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: BLUE, wordBreak: 'break-all' }}>{createdLink}</span>
                  <button onClick={copyLink} style={{ padding: '6px 14px', fontSize: 12, fontWeight: 600, borderRadius: 6, cursor: 'pointer', border: 'none', background: copied ? GREEN : BLUE, color: '#fff', transition: 'background .2s', flexShrink: 0 }}>{copied ? 'Copié !' : 'Copier'}</button>
                </div>
                {createMode === 'lead' && selectedLead && (
                  <div style={{ fontSize: 11, color: 'var(--muted)', background: 'var(--surface-2)', borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>
                    <span style={{ fontWeight: 600, color: 'var(--ink)' }}>@{selectedLead.igUsername}</span> · via <span style={{ fontWeight: 600 }}>{selectedLead.postTitle.slice(0, 40)}…</span> · mot-clé <span style={{ fontWeight: 600 }}>#{selectedLead.keyword}</span>
                  </div>
                )}
                <button onClick={resetModal} style={{ width: '100%', padding: '10px', fontSize: 13, fontWeight: 600, borderRadius: 8, cursor: 'pointer', border: '1px solid var(--border)', background: 'transparent', color: 'var(--ink)' }}>Générer un autre lien</button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', background: 'var(--surface-2)', borderRadius: 8, padding: 3, gap: 2 }}>
                  {(['lead', 'manual'] as const).map(mode => (
                    <button key={mode} onClick={() => setCreateMode(mode)} style={{ flex: 1, padding: '7px', fontSize: 12, fontWeight: 600, borderRadius: 6, cursor: 'pointer', border: 'none', background: createMode === mode ? 'var(--surface)' : 'transparent', color: createMode === mode ? 'var(--ink)' : 'var(--muted)', boxShadow: createMode === mode ? '0 1px 3px rgba(0,0,0,.07)' : 'none', transition: 'all .15s' }}>
                      {mode === 'lead' ? 'Depuis un commentaire' : 'Prospect manuel'}
                    </button>
                  ))}
                </div>
                {createMode === 'lead' && (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8, color: 'var(--muted)' }}>Sélectionne le prospect <span style={{ fontWeight: 400 }}>({leads.length} leads)</span></div>
                    <input type="text" value={leadSearch} onChange={e => setLeadSearch(e.target.value)} placeholder="Recherche par pseudo ou vidéo..." style={{ width: '100%', padding: '8px 12px', fontSize: 12, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--ink)', boxSizing: 'border-box', marginBottom: 8 }} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 240, overflowY: 'auto' }}>
                      {filteredLeads.map(lead => (
                        <div key={lead.igUserId} onClick={() => setSelectedLead(lead)} style={{ padding: '10px 12px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${selectedLead?.igUserId === lead.igUserId ? BLUE : 'var(--border)'}`, background: selectedLead?.igUserId === lead.igUserId ? BLUE + '0e' : 'var(--surface)', transition: 'all .12s' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                                <span style={{ fontSize: 13, fontWeight: 700 }}>@{lead.igUsername}</span>
                                <span style={{ fontSize: 10, fontWeight: 600, color: lead.leadMagnetSent ? GREEN : AMBER, background: (lead.leadMagnetSent ? GREEN : AMBER) + '18', borderRadius: 4, padding: '1px 5px' }}>{lead.leadMagnetSent ? 'LM envoyé' : 'En attente'}</span>
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                                <span style={{ background: lead.postType === 'IG' ? ACCENT + '18' : RED + '12', color: lead.postType === 'IG' ? ACCENT : RED, fontWeight: 600, borderRadius: 3, padding: '1px 4px', marginRight: 5, fontSize: 10 }}>{lead.postType}</span>
                                {lead.postTitle.slice(0, 38)}{lead.postTitle.length > 38 ? '…' : ''}
                              </div>
                            </div>
                            <div style={{ textAlign: 'right', flexShrink: 0 }}>
                              <div style={{ fontSize: 10, color: 'var(--faint)' }}>{daysSince(lead.commentedAt)}j</div>
                              <div style={{ fontSize: 10, fontWeight: 600, color: BLUE, marginTop: 2 }}>#{lead.keyword}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                      {filteredLeads.length === 0 && <div style={{ fontSize: 12, color: 'var(--faint)', padding: 12 }}>Aucun lead trouvé</div>}
                    </div>
                  </div>
                )}
                {createMode === 'manual' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6, color: 'var(--muted)' }}>Pseudo Instagram</div>
                      <input type="text" value={manualUsername} onChange={e => setManualUsername(e.target.value.replace(/^@/, ''))} placeholder="thomas.biz" style={{ width: '100%', padding: '8px 12px', fontSize: 13, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--ink)', boxSizing: 'border-box' }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6, color: 'var(--muted)' }}>Contenu source <span style={{ fontWeight: 400, color: 'var(--faint)' }}>(optionnel)</span></div>
                      <select value={manualPostId} onChange={e => setManualPostId(e.target.value)} style={{ width: '100%', padding: '8px 12px', fontSize: 13, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--ink)', boxSizing: 'border-box' }}>
                        <option value="">— Sans attribution —</option>
                        {(ig?.posts || []).map(p => <option key={p.id} value={p.id}>IG · {p.caption?.slice(0, 50)}</option>)}
                        {(yt?.videos || []).map(v => <option key={v.id} value={v.id}>YT · {v.title.slice(0, 50)}</option>)}
                      </select>
                    </div>
                  </div>
                )}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8, color: 'var(--muted)' }}>Destination</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {destinations.length === 0 && (
                      <div style={{ fontSize: 12, color: 'var(--muted)', padding: '8px 0' }}>Aucune destination configurée (Calendly ou lead magnet)</div>
                    )}
                    {destinations.map(dest => (
                      <div key={dest.id} onClick={() => setSelectedDest(dest)} style={{ padding: '9px 12px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${selectedDest?.id === dest.id ? BLUE : 'var(--border)'}`, background: selectedDest?.id === dest.id ? BLUE + '0e' : 'transparent', display: 'flex', alignItems: 'center', gap: 10, transition: 'all .12s' }}>
                        <span style={{ fontSize: 14 }}>{dest.type === 'calendly' ? '📅' : '📄'}</span>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600 }}>{dest.label}</div>
                          <div style={{ fontSize: 10, color: 'var(--faint)', marginTop: 1 }}>{dest.url}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                {/* Toggle Cold DM */}
                <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: isColdDM ? 12 : 0 }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700 }}>
                        Cold DM
                        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" style={{ display: 'inline', marginLeft: 5, verticalAlign: 'middle', color: BLUE }}>
                          <path d="M2 9L9 2M9 2H4.5M9 2V6.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>Tu as initié la conversation</div>
                    </div>
                    <button onClick={() => { setIsColdDM(!isColdDM); setDetectedDmType(null); }} style={{ width: 38, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer', background: isColdDM ? BLUE : 'var(--border)', position: 'relative', transition: 'background .2s', flexShrink: 0 }}>
                      <span style={{ position: 'absolute', top: 3, left: isColdDM ? 19 : 3, width: 16, height: 16, borderRadius: 8, background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)' }} />
                    </button>
                  </div>
                  {isColdDM && (
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6, color: 'var(--muted)' }}>Pseudo Instagram du prospect</div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <input
                          type="text"
                          placeholder="@thomas.biz"
                          style={{ flex: 1, padding: '8px 12px', fontSize: 13, borderRadius: 8, border: `1px solid var(--border)`, background: 'var(--surface)', color: 'var(--ink)', boxSizing: 'border-box' }}
                          onChange={() => setDetectedDmType(null)}
                        />
                        <button
                          onClick={() => {
                            // Mock : simule la détection API
                            setTimeout(() => setDetectedDmType('cold'), 600);
                          }}
                          style={{ padding: '8px 12px', fontSize: 11, fontWeight: 600, borderRadius: 8, cursor: 'pointer', border: 'none', background: 'var(--surface-2)', color: 'var(--ink)', whiteSpace: 'nowrap' }}>
                          Détecter
                        </button>
                      </div>
                      {detectedDmType && (
                        <div style={{ marginTop: 8, fontSize: 11, fontWeight: 600, color: detectedDmType === 'cold' ? BLUE : '#10B981', background: (detectedDmType === 'cold' ? BLUE : '#10B981') + '12', borderRadius: 6, padding: '6px 10px' }}>
                          {detectedDmType === 'cold'
                            ? '↗ Cold DM confirmé — tu as initié la conversation'
                            : '↙ DM organique — le prospect a écrit en premier'}
                        </div>
                      )}
                      {!detectedDmType && (
                        <div style={{ marginTop: 6, fontSize: 10, color: 'var(--faint)' }}>Si la conversation n'est pas trouvée, le lien sera tagué Cold DM par défaut.</div>
                      )}
                    </div>
                  )}
                </div>

                <button onClick={handleCreate} disabled={creating || !selectedDest || (!selectedLead && createMode === 'lead') || (!manualUsername.trim() && createMode === 'manual')} style={{ width: '100%', padding: '11px', fontSize: 13, fontWeight: 700, borderRadius: 9, cursor: 'pointer', border: 'none', background: BLUE, color: '#fff', opacity: (creating || !selectedDest || (!selectedLead && createMode === 'lead') || (!manualUsername.trim() && createMode === 'manual')) ? 0.5 : 1, transition: 'opacity .15s' }}>
                  {creating ? 'Création…' : 'Créer le lien tracké'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Pill période flottante (onglet Funnel & Calls) ────────────────────────────
function PeriodPill({ period, setPeriod, periodIndex, setPeriodIndex, modalOpen }: {
  period: Period; setPeriod: (p: Period) => void;
  periodIndex: number; setPeriodIndex: (fn: (i: number) => number) => void;
  modalOpen: boolean;
}) {
  const maxIndex = 12;
  const pillRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const pill = pillRef.current;
    if (!pill) return;
    // travel = marginTop - top = 180 - 72 = 108px de scroll avant fixation
    const TRAVEL = 108;

    const tick = () => {
      const scroller = pill.closest('.main-content') as HTMLElement | null;
      if (scroller) {
        const scrollTop = scroller.scrollTop;
        // Ombre de 0 à 0.14 répartie sur tout le trajet
        const opacity = Math.min(1, scrollTop / TRAVEL) * 0.14;
        pill.style.setProperty('--pill-shadow-opacity', opacity.toFixed(4));
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, []);

  return (
    <div
      ref={pillRef}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 12, padding: '5px 10px',
        boxShadow: '0 4px 20px rgba(0,0,0,var(--pill-shadow-opacity,0))',
        willChange: 'box-shadow',
        ['--pill-shadow-opacity' as string]: '0',
      } as React.CSSProperties}
    >
      <button onClick={() => setPeriodIndex(i => Math.min(i + 1, maxIndex))} disabled={periodIndex >= maxIndex}
        style={{ background: 'none', border: 'none', cursor: periodIndex >= maxIndex ? 'default' : 'pointer', fontSize: 24, color: periodIndex >= maxIndex ? 'var(--faint)' : 'var(--ink)', padding: '0 5px', lineHeight: 1 }}>‹</button>
      <div style={{ textAlign: 'center', minWidth: 140 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', whiteSpace: 'nowrap' }}>
          {periodIndex === 0 ? 'Période actuelle' : `${period === 7 ? 'S' : 'M'}−${periodIndex}`}
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{periodLabel(period, periodIndex)}</div>
      </div>
      <button onClick={() => setPeriodIndex(i => Math.max(i - 1, 0))} disabled={periodIndex === 0}
        style={{ background: 'none', border: 'none', cursor: periodIndex === 0 ? 'default' : 'pointer', fontSize: 24, color: periodIndex === 0 ? 'var(--faint)' : 'var(--ink)', padding: '0 5px', lineHeight: 1 }}>›</button>
      <div style={{ width: 1, height: 28, background: 'var(--border)', margin: '0 4px' }} />
      <div style={{ display: 'flex', gap: 2, background: 'var(--surface-2)', borderRadius: 8, padding: 3 }}>
        {([7, 30] as Period[]).map(p => (
          <button key={p} onClick={() => { setPeriod(p); setPeriodIndex(() => 0); }} style={{
            padding: '5px 15px', fontSize: 14, fontWeight: 600, borderRadius: 6, cursor: 'pointer', border: 'none',
            background: period === p ? 'var(--ink)' : 'transparent',
            color: period === p ? 'var(--surface)' : 'var(--muted)',
            transition: 'all .15s',
          }}>{p}j</button>
        ))}
      </div>
    </div>
  );
}

// ── Contrôles inline par section (onglet B) ───────────────────────────────────
function SectionControls({ period, setPeriod, periodIndex, setPeriodIndex }: {
  period: Period; setPeriod: (p: Period) => void;
  periodIndex: number; setPeriodIndex: (fn: (i: number) => number) => void;
}) {
  const maxIndex = 0;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      background: 'var(--surface)', border: '1px solid var(--border-soft, var(--border))',
      borderRadius: 8, padding: '4px 10px',
    }}>
      <button onClick={() => setPeriodIndex(i => Math.min(i + 1, maxIndex))} disabled={periodIndex >= maxIndex}
        style={{ background: 'none', border: 'none', cursor: periodIndex >= maxIndex ? 'default' : 'pointer', fontSize: 16, color: periodIndex >= maxIndex ? 'var(--faint)' : 'var(--muted)', padding: '0 2px', lineHeight: 1 }}>‹</button>
      <div style={{ textAlign: 'center', minWidth: 120 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap' }}>
          {periodIndex === 0 ? 'Période actuelle' : `${period === 7 ? 'S' : 'M'}−${periodIndex}`}
        </div>
        <div style={{ fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{periodLabel(period, periodIndex)}</div>
      </div>
      <button onClick={() => setPeriodIndex(i => Math.max(i - 1, 0))} disabled={periodIndex === 0}
        style={{ background: 'none', border: 'none', cursor: periodIndex === 0 ? 'default' : 'pointer', fontSize: 16, color: periodIndex === 0 ? 'var(--faint)' : 'var(--muted)', padding: '0 2px', lineHeight: 1 }}>›</button>
      <div style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 2px' }} />
      <div style={{ display: 'flex', gap: 2, background: 'var(--surface-2)', borderRadius: 6, padding: 2 }}>
        {([7, 30] as Period[]).map(p => (
          <button key={p} onClick={() => { setPeriod(p); setPeriodIndex(() => 0); }} style={{
            padding: '3px 9px', fontSize: 11, fontWeight: 600, borderRadius: 4, cursor: 'pointer', border: 'none',
            background: period === p ? 'var(--surface)' : 'transparent',
            color: period === p ? 'var(--ink)' : 'var(--faint)',
            boxShadow: period === p ? '0 1px 3px rgba(0,0,0,.07)' : 'none',
            transition: 'all .15s',
          }}>{p}j</button>
        ))}
      </div>
    </div>
  );
}

// ── Fetchers ────────────────────────────────────────────────────────────────

async function fetchApi(url: string) {
  const r = await fetch(url);
  if (!r.ok) return null;
  const d = await r.json();
  return d?.error ? null : d;
}

async function fetchSupabaseStats(profileId?: string) {
  try {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const targetId = profileId || user.id;

  const [leadsRes, lmRes, calendlyRes, overridesRes] = await Promise.all([
    supabase.from('instagram_leads')
      .select('ig_user_id, ig_username, media_id, media_permalink, keyword_matched, lead_magnet_sent, hook_replied, tracking_link, detected_at, source')
      .eq('profile_id', targetId).order('detected_at', { ascending: false }).limit(500),
    supabase.from('lead_magnets')
      .select('id, name, keyword, url').eq('profile_id', targetId).order('created_at', { ascending: true }),
    supabase.from('integrations')
      .select('metadata').eq('profile_id', targetId).eq('provider', 'calendly').maybeSingle(),
    supabase.from('pipeline_overrides')
      .select('prospect_key, stage').eq('profile_id', targetId).eq('stage', 'dismissed'),
  ]);

  let callsRes: { data: any[] | null };
  if (profileId) {
    // Vue coach : calls Calendly de ses élèves (calendly_event_uuid non null)
    callsRes = await supabase.from('calls').select('*')
      .eq('coach_id', user.id)
      .not('calendly_event_uuid', 'is', null)
      .order('scheduled_at', { ascending: false }).limit(500);
  } else {
    // Vue élève : ses calls Calendly avec ses propres leads (calendly_event_uuid non null)
    const { data: cr } = await supabase.from('clients').select('id').eq('profile_id', user.id).maybeSingle();
    callsRes = cr
      ? await supabase.from('calls').select('*')
          .eq('client_id', cr.id)
          .not('calendly_event_uuid', 'is', null)
          .order('scheduled_at', { ascending: false }).limit(500)
      : { data: [] };
  }

  // Déduplique leads par ig_user_id — dernière interaction
  const seen = new Set<string>();
  const igLeads: MockLead[] = (leadsRes.data ?? [])
    .filter((l: any) => { if (!l.ig_user_id || seen.has(l.ig_user_id)) return false; seen.add(l.ig_user_id); return true; })
    .map((l: any) => ({
      igUserId: l.ig_user_id, igUsername: l.ig_username || 'Anonyme',
      postId: l.media_id || '', postTitle: l.media_permalink || l.media_id || '',
      postType: 'IG' as const, commentedAt: l.detected_at,
      keyword: l.keyword_matched || '', leadMagnetSent: l.lead_magnet_sent || false,
      hookReplied: l.hook_replied || false, trackingLink: l.tracking_link || null,
    }));

  const lmData = lmRes.data ?? [];
  const calendlyUrl = (calendlyRes.data?.metadata as any)?.scheduling_url || null;
  const destinations: DestinationLink[] = [
    ...(calendlyUrl ? [{ id: 'calendly-main', label: 'Appel découverte', url: calendlyUrl, type: 'calendly' as const }] : []),
    ...lmData.filter((lm: any) => lm.url).map((lm: any) => ({ id: `lm-${lm.id}`, label: lm.name, url: lm.url, type: 'leadmagnet' as const })),
  ];

  // Exclure les calls rejetés manuellement dans le pipeline ("Non, pas un lead")
  const dismissedKeys = new Set((overridesRes.data ?? []).map((o: any) => o.prospect_key));
  const callsData = (callsRes.data ?? []).filter((c: any) => !dismissedKeys.has(c.id));

  return { igLeads, leadMagnets: lmData, destinations, calls: callsData };
  } catch { return null; }
}

export default function PageClientStats({ profileId }: { profileId?: string } = {}) {
  const [tab, setTab] = useState(0);
  const [period, setPeriod] = useState<Period>(30);
  const [periodIndex, setPeriodIndex] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);

  const q = profileId ? `?profileId=${profileId}` : '';

  // ── TanStack Query — lazy par onglet ─────────────────────────────────────
  // Onglets : 0=Vue générale, 1=Instagram, 2=YouTube, 3=Funnel & Calls, 4=Business micro, 5=Revenus

  // Données Supabase — toujours chargées (rapides, multi-onglets)
  const { data: supaData } = useQuery({
    queryKey: ['stats-supa', profileId],
    queryFn: () => fetchSupabaseStats(profileId),
    staleTime: 5 * 60 * 1000,
  });

  const igLeads: MockLead[] = supaData?.igLeads ?? [];
  const leadMagnets: LeadMagnet[] = supaData?.leadMagnets ?? [];
  const destinations: DestinationLink[] = supaData?.destinations ?? [];
  const calls: CallRecord[] = supaData?.calls ?? [];

  // Instagram — onglets 0, 1, 3
  const { data: igRaw, isLoading: igLoading } = useQuery<IGStats | null>({
    queryKey: ['stats-ig', profileId],
    queryFn: () => fetchApi(`/api/instagram/stats${q}`),
    enabled: [0, 1, 3].includes(tab),
    staleTime: 5 * 60 * 1000,
  });
  const ig: IGStats | null = igRaw ?? null;

  // YouTube — onglets 0, 2, 3
  const { data: ytRaw, isLoading: ytLoading } = useQuery<YTStats | null>({
    queryKey: ['stats-yt', profileId],
    queryFn: () => fetchApi(`/api/youtube/stats${q}`),
    enabled: [0, 2, 3].includes(tab),
    staleTime: 5 * 60 * 1000,
  });
  const yt: YTStats | null = ytRaw ?? null;

  // Stripe — onglets 0, 5
  const { data: stripeRaw } = useQuery<StripeStats | null>({
    queryKey: ['stats-stripe', profileId],
    queryFn: () => fetchApi(`/api/stripe/client-data${q}`),
    enabled: [0, 5].includes(tab),
    staleTime: 5 * 60 * 1000,
  });
  const stripe: StripeStats | null = stripeRaw ?? null;

  // Messages IG — onglets 0, 3, 4
  const { data: msgsRaw } = useQuery<IGMessages | null>({
    queryKey: ['stats-msgs', profileId],
    queryFn: () => fetchApi(`/api/instagram/messages${q}`),
    enabled: [0, 3, 4].includes(tab),
    staleTime: 5 * 60 * 1000,
  });
  const msgs: IGMessages | null = msgsRaw ?? null;

  // Short.io — onglet 4 uniquement (le plus lent — cache SWR 15min)
  const { data: shortioRaw, isLoading: shortioLoading } = useQuery<ShortioStats | null>({
    queryKey: ['stats-shortio', profileId],
    queryFn: () => fetchApi(`/api/shortio/stats${q}`),
    enabled: tab === 4,
    staleTime: 15 * 60 * 1000,
  });
  const shortio: ShortioStats | null = shortioRaw ?? null;

  // Loading : vrai seulement si les données du tab actuel manquent encore
  const loading = (() => {
    if (!supaData) return true;
    if (tab === 1 && igLoading) return true;
    if (tab === 2 && ytLoading) return true;
    if (tab === 4 && shortioLoading) return true;
    return false;
  })();

  const TABS = ['Vue générale', 'Instagram', 'YouTube', 'Funnel & Calls', 'Business micro', 'Revenus'];

  return (
    <div className="page-content">
      {/* Wrapper height:0 — ne prend pas de place dans le flux vertical,
          mais la pill sticky à l'intérieur peut glisser sur toute la hauteur de .main-content */}
      {tab === 3 && (
        <div style={{ position: 'sticky', top: 72, height: 0, zIndex: 1100, display: 'flex', justifyContent: 'flex-end', pointerEvents: 'none', marginRight: 10, marginTop: 180 }}>
          <div style={{ pointerEvents: 'auto', marginTop: -180 }}>
            <PeriodPill period={period} setPeriod={setPeriod} periodIndex={periodIndex} setPeriodIndex={setPeriodIndex} modalOpen={modalOpen} />
          </div>
        </div>
      )}

      {/* Header */}
      <div className="page-header" style={{ marginBottom: 20, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 className="page-title">Analytics</h1>
          <p className="page-sub">Tableau de bord complet — toutes les plateformes</p>
        </div>
        {/* Sélecteur 7j/30j — onglets hors Funnel & Calls */}
        {tab !== 3 && (
          <div style={{ display: 'flex', gap: 4, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 4 }}>
            {([7, 30] as Period[]).map(p => (
              <button key={p} onClick={() => { setPeriod(p); setPeriodIndex(0); }} style={{
                padding: '5px 16px', fontSize: 12, fontWeight: 600, borderRadius: 7, cursor: 'pointer', border: 'none',
                background: period === p ? 'var(--ink)' : 'transparent',
                color: period === p ? 'var(--surface)' : 'var(--muted)',
                transition: 'all .15s',
              }}>{p}j</button>
            ))}
          </div>
        )}
      </div>

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {loading ? <Loading /> : (
        <>
          {tab === 0 && <TabOverviewV2 ig={ig} yt={yt} stripe={stripe} msgs={msgs} calls={calls} shortio={shortio} period={period} />}
          {tab === 1 && <TabInstagram ig={ig} period={period} />}
          {tab === 2 && <TabYouTube yt={yt} period={period} />}
          {tab === 3 && <TabFunnel msgs={msgs} calls={calls} stripe={stripe} ig={ig} yt={yt} shortio={shortio} period={period} periodIndex={periodIndex} onModalChange={setModalOpen} leads={igLeads} />}
          {tab === 4 && <TabShortioB shortio={shortio} ig={ig} yt={yt} leads={igLeads} leadMagnets={leadMagnets} destinations={destinations} period={period} profileId={profileId} />}
          {tab === 5 && <TabRevenues stripe={stripe} period={period} />}
        </>
      )}
    </div>
  );
}
