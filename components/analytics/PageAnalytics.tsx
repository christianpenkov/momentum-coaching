'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import AreaChart from '@/components/charts/AreaChart';
import BarChart from '@/components/charts/BarChart';
import Heatmap from '@/components/charts/Heatmap';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, PieChart, Pie, Cell,
  AreaChart as ReAreaChart, Area,
} from 'recharts';

// ─── Types ────────────────────────────────────────────────────────────────────

interface IGStats {
  username: string; name: string; profilePicture: string | null;
  followers: number; following: number; mediaCount: number; biography: string;
  reach30d: number; accountsEngaged30d: number; totalInteractions30d: number;
  followsUnfollows30d: number; profileLinksTaps30d: number; websiteClicks30d: number;
  profileViews30d: number; views30d: number;
  viewsFollowerBreakdown: { follower: number; nonFollower: number } | null;
  chartData: { date: string; reach: number; followerCount?: number | null }[];
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
            <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--muted)', marginBottom: 8 }}>{item.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: item.color, lineHeight: 1, marginBottom: 4 }}>{item.value}</div>
            <div style={{ fontSize: 10, color: 'var(--faint)' }}>{item.sub}</div>
          </div>
        ))}
      </div>

      {/* ── SECTION 2 : GRAPHIQUES 2×2 (reach, vues IG, vues YT, clics) ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {sparkCards.map((item, i) => (
          <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '18px 20px 14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--muted)', marginBottom: 4 }}>{item.label}</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--ink)', lineHeight: 1 }}>{item.value}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 500 }}>{item.unit}</div>
                </div>
                <div style={{ fontSize: 10, color: 'var(--faint)', marginTop: 3 }}>{item.sub}</div>
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
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
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
                <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--muted)', marginBottom: 4 }}>{item.label}</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--ink)', lineHeight: 1 }}>{item.total !== null ? fmt(item.total) : '—'}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>total</div>
                </div>
                <div style={{ fontSize: 10, color: 'var(--faint)', marginTop: 3 }}>{period}j</div>
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
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
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
                    <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: 13, fontWeight: 700 }}>{fmt(c.watchTime)} min</td>
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

  return (
    <div className="stack">

      {/* ── BLOC 1 : KPIs ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9, 1fr)', gap: 10 }}>
        {[
          { label: 'Abonnés IG', value: fmt(ig?.followers || 0), sub: 'total', color: IG_COLOR },
          { label: 'Abonnés YT', value: fmt(yt?.subscribers || 0), sub: 'total', color: YT_COLOR },
          { label: 'Clics lien', value: fmt(shortioClicks), sub: `${period}j — vers Calendly`, color: BLUE },
          { label: 'Calls bookés', value: fmt(callsBookes), sub: `${period}j`, color: 'var(--ink)' as string },
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
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--muted)' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
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
                    <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: 13, fontWeight: 700 }}>{fmt(c.watchTime)} min</td>
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

  const engRate = pct(ig.totalInteractions30d, ig.reach30d);
  const reachRate = pct(ig.reach30d, ig.followers);
  const viralPct = ig.viewsFollowerBreakdown
    ? pct(ig.viewsFollowerBreakdown.nonFollower, ig.viewsFollowerBreakdown.follower + ig.viewsFollowerBreakdown.nonFollower)
    : null;

  // Génère données jour par jour à partir du chartData ou mock cohérent
  const igDays = ig.chartData.slice(-period);
  const mockFromTotal = (total: number, seed: number) => {
    if (total === 0) return igDays.map(d => ({ date: d.date, v: 0 }));
    const pts = igDays.map((_, i) => Math.max(0, Math.sin(i * 1.7 + seed) * 0.5 + 0.5));
    const sum = pts.reduce((a, b) => a + b, 0);
    let vals = pts.map(p => Math.round((p / sum) * total));
    vals[vals.length - 1] += total - vals.reduce((a, b) => a + b, 0);
    return igDays.map((d, i) => ({ date: d.date, v: vals[i] }));
  };

  const igStatSeries: Record<string, { data: { date: string; v: number }[]; color: string; unit?: string }> = {
    'Reach': { data: igDays.map(d => ({ date: d.date, v: d.reach })), color: ACCENT },
    'Abonnés': { data: igDays.map(d => ({ date: d.date, v: d.followerCount ?? ig.followers })), color: IG_COLOR },
    'Vues': { data: mockFromTotal(ig.views30d, 1), color: ACCENT },
    'Interactions posts': { data: mockFromTotal(ig.accountsEngaged30d, 2), color: GREEN },
    'Abonnés nets': { data: mockFromTotal(ig.followsUnfollows30d, 4), color: ig.followsUnfollows30d >= 0 ? GREEN : RED },
    'Clics site web': { data: mockFromTotal(ig.websiteClicks30d, 5), color: BLUE },
    'Vues profil': { data: mockFromTotal(ig.profileViews30d, 6), color: BLUE },
    "Taux d'engagement": { data: mockFromTotal(Math.round(engRate * 10) / 10, 7), color: engRate > 5 ? GREEN : engRate > 2 ? AMBER : RED, unit: '%' },
    'Reach rate': { data: mockFromTotal(Math.round(reachRate * 10) / 10, 8), color: ACCENT, unit: '%' },
    'Viralité': { data: mockFromTotal(viralPct ? Math.round(viralPct * 10) / 10 : 0, 9), color: viralPct && viralPct > 50 ? GREEN : AMBER, unit: '%' },
  };

  const openStatModal = (label: string, value: string) => {
    const s = igStatSeries[label];
    if (!s) return;
    setStatModal({ label, value, color: s.color, data: s.data, unit: s.unit });
  };

  // Online followers heatmap
  let heatmapRows: { name: string; cells: { label: string; value: number }[] }[] = [];
  const days = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  const hours = Array.from({ length: 24 }, (_, i) => `${i}h`);
  if (ig.onlineFollowers?.hour_counts) {
    heatmapRows = days.map((day, di) => ({
      name: day,
      cells: hours.map((h, hi) => ({
        label: `${day} ${h}`,
        value: ig.onlineFollowers.hour_counts?.[di]?.[hi] ?? 0,
      })),
    }));
  }

  const demoPieData = (ig.demographics?.age || []).slice(0, 6).map(d => ({ name: d.label, value: d.value }));

  return (
    <div className="stack">
      {/* Ligne 1 — 5 stats audience */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
        {[
          { label: 'Abonnés', value: fmt(ig.followers), sub: 'total', color: 'var(--ink)', key: 'Abonnés' },
          { label: 'Reach 30j', value: fmt(ig.reach30d), sub: `${period}j`, color: 'var(--ink)', key: 'Reach' },
          { label: 'Vues 30j', value: fmt(ig.views30d), sub: `${period}j`, color: 'var(--ink)', key: 'Vues' },
          { label: 'Interactions posts', value: fmt(ig.accountsEngaged30d), sub: `${period}j`, color: 'var(--ink)', key: 'Interactions posts' },
          { label: 'Clics site web', value: fmt(ig.websiteClicks30d), sub: `${period}j`, color: 'var(--ink)', key: 'Clics site web' },
        ].map(s => (
          <div key={s.key} onClick={() => openStatModal(s.key, s.value)} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px', cursor: 'pointer', transition: 'background .15s' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--surface)'}>
            <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--muted)', marginBottom: 8 }}>{s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.color, lineHeight: 1, marginBottom: 4 }}>{s.value}</div>
            <div style={{ fontSize: 10, color: 'var(--faint)' }}>{s.sub}</div>
          </div>
        ))}
      </div>
      {/* Ligne 2 — 4 stats performance */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        {[
          { label: 'Abonnés nets', value: `${ig.followsUnfollows30d >= 0 ? '+' : ''}${fmt(ig.followsUnfollows30d)}`, sub: `${period}j`, color: ig.followsUnfollows30d >= 0 ? GREEN : RED, key: 'Abonnés nets' },
          { label: "Taux d'engagement", value: fmtPct(engRate), sub: 'interactions / reach', color: engRate > 5 ? GREEN : engRate > 2 ? AMBER : RED, key: "Taux d'engagement" },
          { label: 'Reach rate', value: fmtPct(reachRate), sub: 'reach / abonnés', color: 'var(--ink)', key: 'Reach rate' },
          { label: 'Viralité', value: viralPct !== null ? fmtPct(viralPct) : '—', sub: 'vues non-abonnés', color: viralPct !== null ? (viralPct > 50 ? GREEN : AMBER) : 'var(--muted)', key: 'Viralité' },
        ].map(s => (
          <div key={s.key} onClick={() => openStatModal(s.key, s.value)} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px', cursor: 'pointer', transition: 'background .15s' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--surface)'}>
            <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--muted)', marginBottom: 8 }}>{s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.color, lineHeight: 1, marginBottom: 4 }}>{s.value}</div>
            <div style={{ fontSize: 10, color: 'var(--faint)' }}>{s.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 18 }}>
        <Card title="Reach par jour" sub="30 jours">
          <AreaChart data={ig.chartData} areas={[{ key: 'reach', label: 'Reach', color: ACCENT }]} xKey="date" height={200} />
        </Card>
        <Card title="Âge des abonnés">
          {demoPieData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={demoPieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" paddingAngle={2}>
                  {demoPieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: any) => `${v} abonnés`} />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : <Empty msg="Seuil minimum non atteint (100+ abonnés requis)" />}
        </Card>
      </div>


      {ig.chartData.some(d => d.followerCount != null) && (
        <Card title="Abonnés / jour" sub="30 jours — progression">
          <ResponsiveContainer width="100%" height={160}>
            <ReAreaChart data={ig.chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="grad-ig-subs" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={ACCENT} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={ACCENT} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} domain={['auto', 'auto']} tickFormatter={(v: number) => v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)} width={40} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  return (
                    <div className="chart-tooltip">
                      <div className="chart-tooltip-label">{label}</div>
                      <div className="chart-tooltip-row"><strong>{fmt(payload[0].value as number)}</strong><span style={{ color: 'var(--muted)', marginLeft: 4 }}>abonnés</span></div>
                    </div>
                  );
                }}
              />
              <Area type="monotone" dataKey="followerCount" name="Abonnés" stroke={ACCENT} strokeWidth={2} fill="url(#grad-ig-subs)" dot={false} activeDot={{ r: 4, strokeWidth: 0, fill: ACCENT }} isAnimationActive={false} />
            </ReAreaChart>
          </ResponsiveContainer>
        </Card>
      )}

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
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={() => setStatModal(null)}>
          <div style={{ background: 'var(--surface)', borderRadius: 20, padding: '32px 32px 28px', width: '100%', maxWidth: 720, boxShadow: '0 24px 60px rgba(0,0,0,.18)' }}
            onClick={e => e.stopPropagation()}>
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
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={44} tickFormatter={(v: number) => v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)} />
                <Tooltip content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  return <div className="chart-tooltip"><div className="chart-tooltip-label">{label}</div><div className="chart-tooltip-row"><strong>{fmt(payload[0].value as number)}{statModal.unit ?? ''}</strong></div></div>;
                }} />
                <Area type="monotone" dataKey="v" stroke={statModal.color} strokeWidth={2} fill="url(#grad-ig-stat-modal)" dot={false} activeDot={{ r: 4, strokeWidth: 0, fill: statModal.color }} isAnimationActive={false} />
              </ReAreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {selectedPost && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={() => setSelectedPost(null)}>
          <div style={{ background: 'var(--surface)', borderRadius: 14, padding: 24, maxWidth: 500, width: '100%', maxHeight: '80vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}>
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
                ['👁 Reach', selectedPost.reach],
                ['🔖 Saves', selectedPost.saved],
                ['↗️ Partages', selectedPost.shares],
                ['▶️ Vues', selectedPost.views],
                ['⚡ Interactions', selectedPost.totalInteractions],
                ['➕ Nouveaux abonnés', selectedPost.follows],
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
        </div>
      )}
    </div>
  );
}

// ─── TAB 3 : YouTube ──────────────────────────────────────────────────────────

function TabYouTube({ yt, period }: { yt: YTStats | null; period: Period }) {
  const [selectedVideo, setSelectedVideo] = useState<YTVideo | null>(null);
  const [retention, setRetention] = useState<{ ratio: number; watchRatio: number }[] | null>(null);
  const [loadingRetention, setLoadingRetention] = useState(false);
  const [statModal, setStatModal] = useState<{ label: string; value: string; color: string; data: { date: string; v: number }[]; unit?: string } | null>(null);

  const loadRetention = useCallback(async (videoId: string, publishedAt?: string) => {
    setLoadingRetention(true);
    try {
      const q = publishedAt ? `?videoId=${videoId}&publishedAt=${encodeURIComponent(publishedAt)}` : `?videoId=${videoId}`;
      const r = await fetch(`/api/youtube/video-retention${q}`);
      const d = await r.json();
      setRetention(d.retentionCurve || []);
    } catch { setRetention([]); }
    finally { setLoadingRetention(false); }
  }, []);

  if (!yt) return <Empty msg="Connecte ton compte YouTube pour voir les stats." />;

  const conversionRate = yt.views30d > 0 ? ((yt.subsGained30d / yt.views30d) * 100).toFixed(3) : '0';
  const watchTimeH = Math.round(yt.watchTime30d / 60);

  const ytDays = yt.chartData.slice(-period);
  const mockFromTotalYT = (total: number, seed: number) => {
    if (total === 0) return ytDays.map(d => ({ date: d.date, v: 0 }));
    const pts = ytDays.map((_, i) => Math.max(0, Math.sin(i * 1.7 + seed) * 0.5 + 0.5));
    const sum = pts.reduce((a, b) => a + b, 0);
    let vals = pts.map(p => Math.round((p / sum) * total));
    vals[vals.length - 1] += total - vals.reduce((a, b) => a + b, 0);
    return ytDays.map((d, i) => ({ date: d.date, v: vals[i] }));
  };

  const ytStatSeries: Record<string, { data: { date: string; v: number }[]; color: string; unit?: string }> = {
    'Vues 30j':           { data: ytDays.map(d => ({ date: d.date, v: d.views })), color: RED },
    'Watch time':         { data: ytDays.map(d => ({ date: d.date, v: Math.round(d.watchTime / 60) })), color: AMBER, unit: 'h' },
    'Watch time moyen':   { data: mockFromTotalYT(yt.avgViewDurationSec ?? 0, 5), color: AMBER, unit: 's' },
    'Subs gagnés':        { data: ytDays.map(d => ({ date: d.date, v: d.subsGained ?? 0 })), color: GREEN },
    'Subs perdus':        { data: ytDays.map(d => ({ date: d.date, v: d.subsLost ?? 0 })), color: RED },
    'Subs nets':          { data: ytDays.map(d => ({ date: d.date, v: d.netSubs ?? 0 })), color: yt.netSubs30d >= 0 ? GREEN : RED },
    'Likes':              { data: mockFromTotalYT(yt.likes30d, 1), color: ACCENT },
    'Commentaires':       { data: mockFromTotalYT(yt.comments30d, 2), color: BLUE },
    'Partages':           { data: mockFromTotalYT(yt.shares30d, 3), color: GREEN },
    'Conv. vue→sub':      { data: mockFromTotalYT(parseFloat(conversionRate), 4), color: ACCENT, unit: '%' },
    'Abonnés YT':         { data: mockFromTotalYT(yt.subscribers, 6), color: RED },
    'Vues all-time':      { data: mockFromTotalYT(yt.totalViews, 7), color: RED },
  };

  const openStatModal = (label: string, value: string) => {
    const s = ytStatSeries[label];
    if (!s) return;
    setStatModal({ label, value, color: s.color, data: s.data, unit: s.unit });
  };

  const trafficData = yt.trafficSources.slice(0, 8).map(s => ({
    name: s.source.replace('YT_', '').replace('_', ' ').toLowerCase(),
    views: s.views,
  }));

  const deviceData = yt.devices.map(d => ({ name: d.device.toLowerCase(), views: d.views }));

  return (
    <div className="stack">
      {/* Ligne 1 — audience & portée */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10 }}>
        {[
          { label: 'Abonnés', value: fmt(yt.subscribers), sub: 'total', color: 'var(--ink)', key: 'Abonnés YT' },
          { label: 'Subs nets 30j', value: `${yt.netSubs30d >= 0 ? '+' : ''}${fmt(yt.netSubs30d)}`, sub: `+${fmt(yt.subsGained30d)} / -${fmt(yt.subsLost30d)}`, color: yt.netSubs30d >= 0 ? GREEN : RED, key: 'Subs nets' },
          { label: 'Vues all-time', value: fmt(yt.totalViews), sub: 'depuis le début', color: 'var(--ink)', key: 'Vues all-time' },
          { label: 'Vidéos', value: fmt(yt.videoCount), sub: 'publiées', color: 'var(--ink)', key: null },
          { label: `Vues ${period}j`, value: fmt(yt.views30d), sub: `${period} derniers jours`, color: 'var(--ink)', key: 'Vues 30j' },
          { label: 'Conv. vue→sub', value: `${conversionRate}%`, sub: 'subs gagnés / vues', color: 'var(--ink)', key: 'Conv. vue→sub' },
        ].map(s => (
          <div key={s.label} onClick={s.key ? () => openStatModal(s.key!, s.value) : undefined} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px', cursor: s.key ? 'pointer' : 'default', transition: 'background .15s' }}
            onMouseEnter={e => { if (s.key) e.currentTarget.style.background = 'var(--surface-2)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--surface)'; }}>
            <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--muted)', marginBottom: 8 }}>{s.label}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: s.color, lineHeight: 1, marginBottom: 4 }}>{s.value}</div>
            <div style={{ fontSize: 10, color: 'var(--faint)' }}>{s.sub}</div>
          </div>
        ))}
      </div>
      {/* Ligne 2 — engagement & watch time */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
        {[
          { label: `Watch time ${period}j`, value: `${watchTimeH}h`, sub: `${Math.round(watchTimeH * 60 / 1000)}k min au total`, color: AMBER, key: 'Watch time' },
          { label: 'Watch time moyen / vue', value: yt.avgViewDurationSec ? `${Math.floor(yt.avgViewDurationSec / 60)}m${String(yt.avgViewDurationSec % 60).padStart(2, '0')}s` : '—', sub: 'durée moyenne par vue', color: 'var(--ink)', key: 'Watch time moyen' },
          { label: 'Likes 30j', value: fmt(yt.likes30d), sub: `${period}j`, color: 'var(--ink)', key: 'Likes' },
          { label: 'Commentaires 30j', value: fmt(yt.comments30d), sub: `${period}j`, color: 'var(--ink)', key: 'Commentaires' },
          { label: 'Partages 30j', value: fmt(yt.shares30d), sub: `${period}j`, color: 'var(--ink)', key: 'Partages' },
        ].map(s => (
          <div key={s.label} onClick={s.key ? () => openStatModal(s.key!, s.value) : undefined} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px', cursor: s.key ? 'pointer' : 'default', transition: 'background .15s' }}
            onMouseEnter={e => { if (s.key) e.currentTarget.style.background = 'var(--surface-2)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--surface)'; }}>
            <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--muted)', marginBottom: 8 }}>{s.label}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: s.color, lineHeight: 1, marginBottom: 4 }}>{s.value}</div>
            <div style={{ fontSize: 10, color: 'var(--faint)' }}>{s.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 18 }}>
        <Card title="Vues / jour" sub="30 jours">
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={yt.chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--muted)' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
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

      {yt.chartData.some(d => d.netSubs !== undefined) && (
        <Card title="Abonnés nets / jour" sub="30 jours">
          <ResponsiveContainer width="100%" height={160}>
            <ComposedChart data={yt.chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
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
              <tr key={v.id} onClick={() => { setSelectedVideo(v); loadRetention(v.id, v.publishedAt); }}
                style={{ cursor: 'pointer' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                onMouseLeave={e => (e.currentTarget.style.background = '')}>
                <td style={{ padding: '10px' }}>
                  <img src={v.thumbnail} alt="" style={{ width: 56, height: 32, objectFit: 'cover', borderRadius: 4 }} />
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
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={() => setStatModal(null)}>
          <div style={{ background: 'var(--surface)', borderRadius: 20, padding: '32px 32px 28px', width: '100%', maxWidth: 720, boxShadow: '0 24px 60px rgba(0,0,0,.18)' }}
            onClick={e => e.stopPropagation()}>
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
                  <linearGradient id="grad-yt-stat-modal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={statModal.color} stopOpacity={0.2} />
                    <stop offset="95%" stopColor={statModal.color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={44} tickFormatter={(v: number) => v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)} />
                <Tooltip content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  return <div className="chart-tooltip"><div className="chart-tooltip-label">{label}</div><div className="chart-tooltip-row"><strong>{fmt(payload[0].value as number)}{statModal.unit ?? ''}</strong></div></div>;
                }} />
                <Area type="monotone" dataKey="v" stroke={statModal.color} strokeWidth={2} fill="url(#grad-yt-stat-modal)" dot={false} activeDot={{ r: 4, strokeWidth: 0, fill: statModal.color }} isAnimationActive={false} />
              </ReAreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {selectedVideo && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={() => { setSelectedVideo(null); setRetention(null); }}>
          <div style={{ background: 'var(--surface)', borderRadius: 14, padding: 24, maxWidth: 600, width: '100%', maxHeight: '85vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', gap: 14, marginBottom: 16 }}>
              <img src={selectedVideo.thumbnail} alt="" style={{ width: 120, height: 68, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.3, marginBottom: 4 }}>{selectedVideo.title}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{new Date(selectedVideo.publishedAt).toLocaleDateString('fr-FR', { dateStyle: 'long' })} · {selectedVideo.duration} · {selectedVideo.isShort ? 'Short' : 'Vidéo'}</div>
              </div>
              <button onClick={() => { setSelectedVideo(null); setRetention(null); }} style={{ marginLeft: 'auto', background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--muted)' }}>×</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
              {[
                ['Vues totales', fmt(selectedVideo.views)],
                ['Vues 30j', `+${fmt(selectedVideo.views30d)}`],
                ['Watch time 30j', `${selectedVideo.watchTime30d}min`],
                ['Rétention moy.', selectedVideo.avgViewPct ? fmtPct(selectedVideo.avgViewPct) : '—'],
                ['Likes', fmt(selectedVideo.likes)],
                ['Commentaires', fmt(selectedVideo.comments)],
                ['Likes 30j', `+${fmt(selectedVideo.likes30d)}`],
                ['Partages 30j', `+${fmt(selectedVideo.shares30d)}`],
              ].map(([label, value], i) => (
                <div key={i} style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
                  <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>{value}</div>
                </div>
              ))}
            </div>
            <div style={{ marginBottom: 8, fontSize: 12, fontWeight: 600 }}>Courbe de rétention</div>
            {loadingRetention ? <Loading /> : retention && retention.length > 0
              ? (() => {
                  const step = Math.max(1, Math.floor(retention.length / 10));
                  const sampled = retention.filter((_, i) => i % step === 0 || i === retention.length - 1);
                  return <AreaChart data={sampled.map(p => ({ x: `${Math.round(p.ratio * 100)}%`, pct: Math.round(p.watchRatio * 100) }))}
                    areas={[{ key: 'pct', label: 'Viewers restants', color: GREEN }]}
                    xKey="x" height={160} formatter={(v: number) => `${v}%`} />;
                })()
              : <Empty msg="Rétention non disponible pour cette vidéo" />}
            <a href={selectedVideo.url} target="_blank" rel="noreferrer" style={{ display: 'block', marginTop: 14, textAlign: 'center', fontSize: 12, color: RED, textDecoration: 'none', fontWeight: 600 }}>
              Voir sur YouTube →
            </a>
          </div>
        </div>
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

// ── Données mock historiques pour la navigation par période ──────────────────
// Chaque entrée représente une période (7j ou 30j) dans le passé
// index 0 = période la plus récente (actuelle), index 1 = précédente, etc.
const MOCK_HISTORY_7D = [
  // période actuelle (S0)
  { igReach: 68400, igLeads: 5, igBio: 3, igBookes: 2, igHonores: 1, igCloses: 1, igRev: 1200, ytViews: 11800, ytClics: 34, ytBookes: 1, ytHonores: 1, ytCloses: 1, ytRev: 2400 },
  // S-1
  { igReach: 72100, igLeads: 4, igBio: 2, igBookes: 2, igHonores: 2, igCloses: 1, igRev: 1200, ytViews: 9400,  ytClics: 28, ytBookes: 1, ytHonores: 1, ytCloses: 0, ytRev: 0    },
  // S-2
  { igReach: 61800, igLeads: 6, igBio: 3, igBookes: 2, igHonores: 2, igCloses: 1, igRev: 1200, ytViews: 13200, ytClics: 38, ytBookes: 1, ytHonores: 1, ytCloses: 1, ytRev: 1800 },
  // S-3
  { igReach: 58200, igLeads: 3, igBio: 2, igBookes: 1, igHonores: 1, igCloses: 0, igRev: 0,    ytViews: 8600,  ytClics: 24, ytBookes: 1, ytHonores: 0, ytCloses: 0, ytRev: 0    },
  // S-4
  { igReach: 54600, igLeads: 4, igBio: 2, igBookes: 1, igHonores: 1, igCloses: 1, igRev: 1200, ytViews: 10200, ytClics: 29, ytBookes: 1, ytHonores: 1, ytCloses: 0, ytRev: 0    },
  // S-5
  { igReach: 49800, igLeads: 2, igBio: 1, igBookes: 1, igHonores: 0, igCloses: 0, igRev: 0,    ytViews: 7800,  ytClics: 22, ytBookes: 0, ytHonores: 0, ytCloses: 0, ytRev: 0    },
  // S-6
  { igReach: 46200, igLeads: 3, igBio: 1, igBookes: 1, igHonores: 1, igCloses: 1, igRev: 1200, ytViews: 9100,  ytClics: 26, ytBookes: 1, ytHonores: 1, ytCloses: 1, ytRev: 1800 },
  // S-7
  { igReach: 44800, igLeads: 2, igBio: 1, igBookes: 1, igHonores: 1, igCloses: 0, igRev: 0,    ytViews: 8400,  ytClics: 24, ytBookes: 0, ytHonores: 0, ytCloses: 0, ytRev: 0    },
];

const MOCK_HISTORY_30D = [
  // M0 — mois actuel
  { igReach: 284500, igLeads: 18, igBio: 11, igBookes: 7, igHonores: 5, igCloses: 3, igRev: 3600, ytViews: 48200, ytClics: 138, ytBookes: 4, ytHonores: 4, ytCloses: 2, ytRev: 4200 },
  // M-1
  { igReach: 248000, igLeads: 14, igBio: 9,  igBookes: 5, igHonores: 4, igCloses: 2, igRev: 2400, ytViews: 41600, ytClics: 112, ytBookes: 3, ytHonores: 3, ytCloses: 2, ytRev: 3600 },
  // M-2
  { igReach: 218400, igLeads: 11, igBio: 7,  igBookes: 4, igHonores: 3, igCloses: 2, igRev: 2400, ytViews: 36200, ytClics: 94,  ytBookes: 2, ytHonores: 2, ytCloses: 1, ytRev: 1800 },
  // M-3
  { igReach: 194200, igLeads: 9,  igBio: 5,  igBookes: 3, igHonores: 2, igCloses: 1, igRev: 1200, ytViews: 29800, ytClics: 78,  ytBookes: 2, ytHonores: 2, ytCloses: 1, ytRev: 1800 },
  // M-4
  { igReach: 172600, igLeads: 7,  igBio: 4,  igBookes: 2, igHonores: 2, igCloses: 1, igRev: 1200, ytViews: 24100, ytClics: 62,  ytBookes: 1, ytHonores: 1, ytCloses: 0, ytRev: 0    },
  // M-5
  { igReach: 148000, igLeads: 5,  igBio: 3,  igBookes: 2, igHonores: 1, igCloses: 1, igRev: 1200, ytViews: 18400, ytClics: 48,  ytBookes: 1, ytHonores: 1, ytCloses: 1, ytRev: 1800 },
];

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

function TabFunnel({ msgs, calls, stripe, ig, yt, shortio, period, periodIndex, onModalChange }: { msgs: IGMessages | null; calls: CallRecord[]; stripe: StripeStats | null; ig: IGStats | null; yt: YTStats | null; shortio: ShortioStats | null; period: Period; periodIndex: number; onModalChange?: (open: boolean) => void }) {
  const [callsFilter, setCallsFilter] = useState<'all' | 'ig' | 'yt'>('all');
  const [expandedHero, setExpandedHero] = useState<number | null>(null);
  const [heroSnapshot, setHeroSnapshot] = useState<{ label: string; value: string; sub: string } | null>(null);
  const [modalPeriod, setModalPeriod] = useState<Period>(30);
  const [modalPeriodIndex, setModalPeriodIndex] = useState(0);
  const [expandedEff, setExpandedEff] = useState<{ label: string; value: string; color: string; data: { date: string; v: number }[] } | null>(null);
  const now = new Date();
  const mrr = stripe?.mrr || 0;

  const history = period === 7 ? MOCK_HISTORY_7D : MOCK_HISTORY_30D;
  const maxIndex = history.length - 1;
  const cur = history[periodIndex];
  const prev = history[periodIndex + 1] || null;

  // ── Calls par plateforme ──
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

  // ── Métriques de la période sélectionnée ──
  const igReach = ig?.reach30d || 0;
  const igLeads = msgs?.leadCount || 0;
  const igBioClicks = ig?.profileLinksTaps30d || 0;

  // période 0 = données live (avec fallback mock), autres = historique mock
  const igBookes  = periodIndex === 0 ? (igCallsLive.bookes  || cur.igBookes)  : cur.igBookes;
  const igHonores = periodIndex === 0 ? (igCallsLive.honores || cur.igHonores) : cur.igHonores;
  const igCloses  = periodIndex === 0 ? (igCallsLive.closes  || cur.igCloses)  : cur.igCloses;
  const igRev     = periodIndex === 0 ? (igCallsLive.rev     || cur.igRev)     : cur.igRev;
  const igReachD  = periodIndex === 0 ? (igReach  || cur.igReach)  : cur.igReach;
  const igLeadsD  = periodIndex === 0 ? (igLeads  || cur.igLeads)  : cur.igLeads;
  const igBioD    = periodIndex === 0 ? (igBioClicks || cur.igBio) : cur.igBio;

  const ytViews   = yt?.views30d || 0;
  const ytBookes  = periodIndex === 0 ? (ytCallsLive.bookes  || cur.ytBookes)  : cur.ytBookes;
  const ytHonores = periodIndex === 0 ? (ytCallsLive.honores || cur.ytHonores) : cur.ytHonores;
  const ytCloses  = periodIndex === 0 ? (ytCallsLive.closes  || cur.ytCloses)  : cur.ytCloses;
  const ytRev     = periodIndex === 0 ? (ytCallsLive.rev     || cur.ytRev)     : cur.ytRev;
  const ytViewsD  = periodIndex === 0 ? (ytViews || cur.ytViews) : cur.ytViews;
  const ytClicsD  = cur.ytClics;

  const igFunnelSteps = [
    { label: period === 7 ? 'Reach 7j' : 'Reach 30j', value: igReachD >= 1000 ? `${fmt(igReachD / 1000, 1)}k` : fmt(igReachD), rawValue: igReachD },
    { label: 'Leads commentaires', value: fmt(igLeadsD), sub: 'mots-clés détectés', rawValue: igLeadsD, rate: (igLeadsD / igReachD) * 100 },
    { label: 'Clics bio → Calendly', value: fmt(igBioD), sub: 'Short.io', rawValue: igBioD, rate: (igBioD / igReachD) * 100 },
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

  // ── Deltas vs période précédente ──
  const dIgCloseRate = prev ? delta(igHonores > 0 ? Math.round((igCloses / igHonores) * 100) : 0, prev.igHonores > 0 ? Math.round((prev.igCloses / prev.igHonores) * 100) : 0) : null;
  const dYtCloseRate = prev ? delta(ytHonores > 0 ? Math.round((ytCloses / ytHonores) * 100) : 0, prev.ytHonores > 0 ? Math.round((prev.ytCloses / prev.ytHonores) * 100) : 0) : null;
  const dIgReach = prev ? delta(igReachD, prev.igReach) : null;
  const dYtViews = prev ? delta(ytViewsD, prev.ytViews) : null;
  const dIgRev = prev ? delta(igRev, prev.igRev) : null;
  const dYtRev = prev ? delta(ytRev, prev.ytRev) : null;

  // No-shows par plateforme (estimés proportionnellement aux bookés)
  const igNoShows = periodIndex === 0 ? (igCallsLive.noShows || Math.round(cur.igBookes * 0.12)) : Math.round(cur.igBookes * 0.12);
  const ytNoShows = periodIndex === 0 ? (ytCallsLive.noShows || Math.round(cur.ytBookes * 0.12)) : Math.round(cur.ytBookes * 0.12);
  const igNoShowRate = igBookes > 0 ? pct(igNoShows, igBookes) : 0;
  const ytNoShowRate = ytBookes > 0 ? pct(ytNoShows, ytBookes) : 0;
  const prevIgNoShowRate = prev && prev.igBookes > 0 ? pct(Math.round(prev.igBookes * 0.12), prev.igBookes) : null;
  const prevYtNoShowRate = prev && prev.ytBookes > 0 ? pct(Math.round(prev.ytBookes * 0.12), prev.ytBookes) : null;

  // ── Efficacité par plateforme ──
  const effRows = [
    {
      platform: 'Instagram', color: IG_COLOR,
      metrics: [
        { label: 'Reach pour 1 call', value: igBookes > 0 ? fmt(Math.round(igReachD / igBookes)) : '—', prevValue: prev && prev.igBookes > 0 ? fmt(Math.round(prev.igReach / prev.igBookes)) : null, delta: prev && prev.igBookes > 0 ? delta(Math.round(igReachD / igBookes), Math.round(prev.igReach / prev.igBookes)) : null, lowerIsBetter: true },
        { label: 'No-show', value: igBookes > 0 ? `${igNoShowRate}%` : '—', prevValue: prevIgNoShowRate !== null ? `${prevIgNoShowRate}%` : null, delta: prevIgNoShowRate !== null ? delta(igNoShowRate, prevIgNoShowRate) : null, lowerIsBetter: true },
        { label: 'Close rate', value: igHonores > 0 ? `${pct(igCloses, igHonores)}%` : '—', prevValue: prev && prev.igHonores > 0 ? `${pct(prev.igCloses, prev.igHonores)}%` : null, delta: dIgCloseRate, lowerIsBetter: false },
        { label: 'Rev / call honoré', value: igHonores > 0 ? fmtEur(Math.round(igRev / igHonores)) : '—', prevValue: prev && prev.igHonores > 0 ? fmtEur(Math.round(prev.igRev / prev.igHonores)) : null, delta: prev && prev.igHonores > 0 ? delta(Math.round(igRev / igHonores), Math.round(prev.igRev / prev.igHonores)) : null, lowerIsBetter: false },
        { label: 'Revenue total', value: fmtEur(igRev), prevValue: prev ? fmtEur(prev.igRev) : null, delta: dIgRev, lowerIsBetter: false },
      ],
    },
    {
      platform: 'YouTube', color: YT_COLOR,
      metrics: [
        { label: 'Vues pour 1 call', value: ytBookes > 0 ? fmt(Math.round(ytViewsD / ytBookes)) : '—', prevValue: prev && prev.ytBookes > 0 ? fmt(Math.round(prev.ytViews / prev.ytBookes)) : null, delta: prev && prev.ytBookes > 0 ? delta(Math.round(ytViewsD / ytBookes), Math.round(prev.ytViews / prev.ytBookes)) : null, lowerIsBetter: true },
        { label: 'No-show', value: ytBookes > 0 ? `${ytNoShowRate}%` : '—', prevValue: prevYtNoShowRate !== null ? `${prevYtNoShowRate}%` : null, delta: prevYtNoShowRate !== null ? delta(ytNoShowRate, prevYtNoShowRate) : null, lowerIsBetter: true },
        { label: 'Close rate', value: ytHonores > 0 ? `${pct(ytCloses, ytHonores)}%` : '—', prevValue: prev && prev.ytHonores > 0 ? `${pct(prev.ytCloses, prev.ytHonores)}%` : null, delta: dYtCloseRate, lowerIsBetter: false },
        { label: 'Rev / call honoré', value: ytHonores > 0 ? fmtEur(Math.round(ytRev / ytHonores)) : '—', prevValue: prev && prev.ytHonores > 0 ? fmtEur(Math.round(prev.ytRev / prev.ytHonores)) : null, delta: prev && prev.ytHonores > 0 ? delta(Math.round(ytRev / ytHonores), Math.round(prev.ytRev / prev.ytHonores)) : null, lowerIsBetter: false },
        { label: 'Revenue total', value: fmtEur(ytRev), prevValue: prev ? fmtEur(prev.ytRev) : null, delta: dYtRev, lowerIsBetter: false },
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
                style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
                onClick={() => setExpandedHero(null)}
              >
                <div
                  style={{ background: 'var(--surface)', borderRadius: 16, padding: '32px 36px 28px', width: '100%', maxWidth: 780, boxShadow: '0 24px 60px rgba(0,0,0,.18)' }}
                  onClick={e => e.stopPropagation()}
                >
                  {(() => {
                    const mHistory = period === 7 ? MOCK_HISTORY_7D : MOCK_HISTORY_30D;
                    const mMaxIndex = mHistory.length - 1;
                    const mn = period;
                    const h = mHistory[Math.min(periodIndex, mMaxIndex)];

                    // Génère n points jour-par-jour à partir d'un total, avec seed déterministe
                    const spread = (total: number, n: number, seed: number): number[] => {
                      if (total === 0) return Array(n).fill(0);
                      const pts = Array.from({ length: n }, (_, i) => Math.max(0, Math.sin(i * 1.7 + seed) * 0.5 + 0.5));
                      const sum = pts.reduce((a, b) => a + b, 0);
                      let distributed = pts.map(p => Math.round((p / sum) * total));
                      const diff = total - distributed.reduce((a, b) => a + b, 0);
                      distributed[n - 1] += diff;
                      return distributed;
                    };

                    const dates = Array.from({ length: mn }, (_, i) => {
                      const d = new Date(); d.setDate(d.getDate() - (periodIndex * mn) - (mn - 1 - i));
                      return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
                    });

                    const toData = (vals: number[]) => dates.map((date, i) => ({ date, v: vals[i] }));

                    const totalBookes7 = h.igBookes + h.ytBookes;
                    const totalHonores7 = h.igHonores + h.ytHonores;
                    const totalCloses7 = h.igCloses + h.ytCloses;
                    const totalRev7 = h.igRev + h.ytRev;
                    const totalNS7 = Math.round(totalBookes7 * 0.12);
                    const revPerCall7 = totalHonores7 > 0 ? Math.round(totalRev7 / totalHonores7) : 0;

                    const modalCharts: { data: { date: string; v: number }[]; color: string; fmtV: (v: number) => string }[] = [
                      // 0 Calls bookés
                      { color: 'var(--ink)', fmtV: String, data: toData(spread(totalBookes7, mn, 1)) },
                      // 1 Calls honorés
                      { color: AMBER, fmtV: String, data: toData(spread(totalHonores7, mn, 2)) },
                      // 2 Deals closés
                      { color: GREEN, fmtV: String, data: toData(spread(totalCloses7, mn, 3)) },
                      // 3 Revenue total
                      { color: GREEN, fmtV: (v) => `${v} €`, data: toData(spread(totalRev7, mn, 4)) },
                      // 4 Rev / call — valeur moyenne lissée
                      { color: GREEN, fmtV: (v) => `${Math.round(v)} €`, data: dates.map((date, i) => ({ date, v: revPerCall7 * (0.88 + Math.sin(i * 1.3 + 5) * 0.12) })) },
                      // 5 No-show
                      { color: RED, fmtV: String, data: toData(spread(totalNS7, mn, 6)) },
                      // 6 Calls IG
                      { color: IG_COLOR, fmtV: String, data: toData(spread(h.igBookes, mn, 7)) },
                      // 7 Calls YT
                      { color: YT_COLOR, fmtV: String, data: toData(spread(h.ytBookes, mn, 8)) },
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
                          <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
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
                {prev && <div style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--muted)' }}>{periodLabel(period, periodIndex)} · vs {periodLabel(period, periodIndex + 1)}</div>}
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
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
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
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
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

function TabFunnelDetail({ msgs, calls, stripe, ig, yt, shortio }: { msgs: IGMessages | null; calls: CallRecord[]; stripe: StripeStats | null; ig: IGStats | null; yt: YTStats | null; shortio: ShortioStats | null }) {
  const [period, setPeriod] = useState<Period>(30);
  const [periodIndex, setPeriodIndex] = useState(0);
  const [callsFilter, setCallsFilter] = useState<'all' | 'ig' | 'yt'>('all');
  const [expandedHero, setExpandedHero] = useState<number | null>(null);
  const [heroSnapshot, setHeroSnapshot] = useState<{ label: string; value: string; sub: string } | null>(null);
  const [expandedEff, setExpandedEff] = useState<{ label: string; value: string; color: string; data: { date: string; v: number }[] } | null>(null);

  const now = new Date();
  const history = period === 7 ? MOCK_HISTORY_7D : MOCK_HISTORY_30D;
  const cur = history[periodIndex];
  const prev = history[periodIndex + 1] || null;

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

  const igBookes  = periodIndex === 0 ? (igCallsLive.bookes  || cur.igBookes)  : cur.igBookes;
  const igHonores = periodIndex === 0 ? (igCallsLive.honores || cur.igHonores) : cur.igHonores;
  const igCloses  = periodIndex === 0 ? (igCallsLive.closes  || cur.igCloses)  : cur.igCloses;
  const igRev     = periodIndex === 0 ? (igCallsLive.rev     || cur.igRev)     : cur.igRev;
  const igReachD  = periodIndex === 0 ? (ig?.reach30d        || cur.igReach)   : cur.igReach;
  const igLeadsD  = periodIndex === 0 ? (msgs?.leadCount     || cur.igLeads)   : cur.igLeads;
  const igBioD    = periodIndex === 0 ? (ig?.profileLinksTaps30d || cur.igBio) : cur.igBio;

  const ytBookes  = periodIndex === 0 ? (ytCallsLive.bookes  || cur.ytBookes)  : cur.ytBookes;
  const ytHonores = periodIndex === 0 ? (ytCallsLive.honores || cur.ytHonores) : cur.ytHonores;
  const ytCloses  = periodIndex === 0 ? (ytCallsLive.closes  || cur.ytCloses)  : cur.ytCloses;
  const ytRev     = periodIndex === 0 ? (ytCallsLive.rev     || cur.ytRev)     : cur.ytRev;
  const ytViewsD  = periodIndex === 0 ? (yt?.views30d        || cur.ytViews)   : cur.ytViews;
  const ytClicsD  = cur.ytClics;

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

  const dIgCloseRate = prev ? delta(igHonores > 0 ? Math.round((igCloses / igHonores) * 100) : 0, prev.igHonores > 0 ? Math.round((prev.igCloses / prev.igHonores) * 100) : 0) : null;
  const dYtCloseRate = prev ? delta(ytHonores > 0 ? Math.round((ytCloses / ytHonores) * 100) : 0, prev.ytHonores > 0 ? Math.round((prev.ytCloses / prev.ytHonores) * 100) : 0) : null;
  const dIgRev = prev ? delta(igRev, prev.igRev) : null;
  const dYtRev = prev ? delta(ytRev, prev.ytRev) : null;

  const igNoShows = periodIndex === 0 ? (igCallsLive.noShows || Math.round(cur.igBookes * 0.12)) : Math.round(cur.igBookes * 0.12);
  const ytNoShows = periodIndex === 0 ? (ytCallsLive.noShows || Math.round(cur.ytBookes * 0.12)) : Math.round(cur.ytBookes * 0.12);
  const igNoShowRate = igBookes > 0 ? pct(igNoShows, igBookes) : 0;
  const ytNoShowRate = ytBookes > 0 ? pct(ytNoShows, ytBookes) : 0;
  const prevIgNoShowRate = prev && prev.igBookes > 0 ? pct(Math.round(prev.igBookes * 0.12), prev.igBookes) : null;
  const prevYtNoShowRate = prev && prev.ytBookes > 0 ? pct(Math.round(prev.ytBookes * 0.12), prev.ytBookes) : null;

  const effRows = [
    {
      platform: 'Instagram', color: IG_COLOR,
      metrics: [
        { label: 'Reach pour 1 call', value: igBookes > 0 ? fmt(Math.round(igReachD / igBookes)) : '—', prevValue: prev && prev.igBookes > 0 ? fmt(Math.round(prev.igReach / prev.igBookes)) : null, delta: prev && prev.igBookes > 0 ? delta(Math.round(igReachD / igBookes), Math.round(prev.igReach / prev.igBookes)) : null, lowerIsBetter: true },
        { label: 'No-show', value: igBookes > 0 ? `${igNoShowRate}%` : '—', prevValue: prevIgNoShowRate !== null ? `${prevIgNoShowRate}%` : null, delta: prevIgNoShowRate !== null ? delta(igNoShowRate, prevIgNoShowRate) : null, lowerIsBetter: true },
        { label: 'Close rate', value: igHonores > 0 ? `${pct(igCloses, igHonores)}%` : '—', prevValue: prev && prev.igHonores > 0 ? `${pct(prev.igCloses, prev.igHonores)}%` : null, delta: dIgCloseRate, lowerIsBetter: false },
        { label: 'Rev / call honoré', value: igHonores > 0 ? fmtEur(Math.round(igRev / igHonores)) : '—', prevValue: prev && prev.igHonores > 0 ? fmtEur(Math.round(prev.igRev / prev.igHonores)) : null, delta: prev && prev.igHonores > 0 ? delta(Math.round(igRev / igHonores), Math.round(prev.igRev / prev.igHonores)) : null, lowerIsBetter: false },
        { label: 'Revenue total', value: fmtEur(igRev), prevValue: prev ? fmtEur(prev.igRev) : null, delta: dIgRev, lowerIsBetter: false },
      ],
    },
    {
      platform: 'YouTube', color: YT_COLOR,
      metrics: [
        { label: 'Vues pour 1 call', value: ytBookes > 0 ? fmt(Math.round(ytViewsD / ytBookes)) : '—', prevValue: prev && prev.ytBookes > 0 ? fmt(Math.round(prev.ytViews / prev.ytBookes)) : null, delta: prev && prev.ytBookes > 0 ? delta(Math.round(ytViewsD / ytBookes), Math.round(prev.ytViews / prev.ytBookes)) : null, lowerIsBetter: true },
        { label: 'No-show', value: ytBookes > 0 ? `${ytNoShowRate}%` : '—', prevValue: prevYtNoShowRate !== null ? `${prevYtNoShowRate}%` : null, delta: prevYtNoShowRate !== null ? delta(ytNoShowRate, prevYtNoShowRate) : null, lowerIsBetter: true },
        { label: 'Close rate', value: ytHonores > 0 ? `${pct(ytCloses, ytHonores)}%` : '—', prevValue: prev && prev.ytHonores > 0 ? `${pct(prev.ytCloses, prev.ytHonores)}%` : null, delta: dYtCloseRate, lowerIsBetter: false },
        { label: 'Rev / call honoré', value: ytHonores > 0 ? fmtEur(Math.round(ytRev / ytHonores)) : '—', prevValue: prev && prev.ytHonores > 0 ? fmtEur(Math.round(prev.ytRev / prev.ytHonores)) : null, delta: prev && prev.ytHonores > 0 ? delta(Math.round(ytRev / ytHonores), Math.round(prev.ytRev / prev.ytHonores)) : null, lowerIsBetter: false },
        { label: 'Revenue total', value: fmtEur(ytRev), prevValue: prev ? fmtEur(prev.ytRev) : null, delta: dYtRev, lowerIsBetter: false },
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
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
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
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
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
                {prev && <div style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--muted)' }}>{periodLabel(period, periodIndex)} · vs {periodLabel(period, periodIndex + 1)}</div>}
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
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
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
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
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
  if (!stripe) return <Empty msg="Connecte ton compte Stripe pour voir les revenus." />;

  const arr = stripe.mrr * 12;
  const avgBasket = stripe.recentPayments.length > 0
    ? stripe.recentPayments.filter(p => p.status === 'succeeded').reduce((s, p) => s + p.amount, 0) / stripe.recentPayments.filter(p => p.status === 'succeeded').length
    : 0;
  const failedPct = stripe.recentPayments.length > 0
    ? pct(stripe.recentPayments.filter(p => p.status !== 'succeeded').length, stripe.recentPayments.length)
    : 0;

  // MRR simulé sur 12 semaines
  const mrrData = Array.from({ length: 12 }, (_, i) => ({ week: `S${i + 1}`, mrr: Math.round(stripe.mrr * (0.88 + i * 0.01)) }));

  // CA par mois simulé sur 3 mois
  const caData = [
    { month: 'Mars', ca: Math.round(stripe.monthlyRevenue * 0.85) },
    { month: 'Avril', ca: Math.round(stripe.monthlyRevenue * 0.92) },
    { month: 'Mai', ca: stripe.monthlyRevenue },
  ];

  return (
    <div className="stack">
      <StatGrid>
        <Stat label="MRR" value={fmtEur(stripe.mrr)} color={GREEN} />
        <Stat label="ARR" value={fmtEur(arr)} sub="MRR × 12" />
        <Stat label="CA ce mois" value={fmtEur(stripe.monthlyRevenue)} />
        <Stat label="Abonnements actifs" value={fmt(stripe.activeSubscriptions)} />
        <Stat label="Solde disponible" value={fmtEur(stripe.availableBalance)} />
        <Stat label="Panier moyen" value={fmtEur(Math.round(avgBasket))} sub="moyenne paiements" />
        <Stat label="Taux d'échec" value={fmtPct(failedPct)} color={failedPct > 5 ? RED : GREEN} sub="paiements échoués" />
      </StatGrid>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 18 }}>
        <Card title="MRR" sub="12 semaines">
          <AreaChart data={mrrData} areas={[{ key: 'mrr', label: 'MRR', color: GREEN }]} xKey="week" height={200} formatter={fmtEur} />
        </Card>
        <Card title="CA par mois" sub="3 derniers mois">
          <BarChart data={caData} bars={[{ key: 'ca', label: 'CA', color: ACCENT }]} xKey="month" height={200} formatter={fmtEur} />
        </Card>
      </div>

      <Card title="Derniers paiements">
        <table className="table" style={{ width: '100%' }}>
          <thead>
            <tr>
              {['Date', 'Description', 'Montant', 'Statut'].map((h, i) => (
                <th key={i} style={{ textAlign: 'left', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', color: 'var(--muted)', padding: '8px 10px' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stripe.recentPayments.map((p, i) => (
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
      </Card>
    </div>
  );
}

// ─── TAB 6 : Short.io ─────────────────────────────────────────────────────────

function TabShortio({ shortio, period }: { shortio: ShortioStats | null; period: Period }) {
  const [selectedLink, setSelectedLink] = useState<ShortioLink | null>(null);

  if (!shortio) return <Empty msg="Connecte ton compte Short.io pour voir les stats." />;

  return (
    <div className="stack">
      <StatGrid>
        <Stat label="Domaine" value={shortio.domain} />
        <Stat label="Liens actifs" value={fmt(shortio.totalLinks)} />
        <Stat label="Clics 30j" value={fmt(shortio.clicks30d)} />
        <Stat label="Clics humains 30j" value={fmt(shortio.humanClicks30d)} />
        <Stat label="Variation" value={shortio.clicksChange !== null ? `${shortio.clicksChange >= 0 ? '+' : ''}${fmtPct(shortio.clicksChange)}` : '—'} color={shortio.clicksChange !== null ? (shortio.clicksChange >= 0 ? GREEN : RED) : undefined} />
        <Stat label="Moy. / lien" value={fmt(shortio.clicksPerLink30d, 1)} />
      </StatGrid>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 18 }}>
        <Card title="Clics par jour" sub="30 jours">
          <AreaChart data={shortio.chartData} areas={[{ key: 'clicks', label: 'Clics', color: BLUE }]} xKey="date" height={200} />
        </Card>
        <Card title="Top referrers">
          {shortio.topReferrers.map((r, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label || 'Direct'}</div>
              <div style={{ fontSize: 11, fontWeight: 600 }}>{fmt(r.value)}</div>
            </div>
          ))}
        </Card>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18 }}>
        {[
          { title: 'Top pays', data: shortio.topCountries },
          { title: 'Top réseaux sociaux', data: shortio.topSocial },
          { title: 'Top navigateurs', data: shortio.topBrowsers },
        ].map(({ title, data }, i) => (
          <Card key={i} title={title}>
            {data.slice(0, 5).map((d, j) => (
              <div key={j} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', flex: 1 }}>{d.label}</div>
                <div style={{ flex: 2, height: 5, background: 'var(--border)', borderRadius: 3 }}>
                  <div style={{ height: 5, width: `${pct(d.value, data[0]?.value || 1)}%`, background: BLUE, borderRadius: 3 }} />
                </div>
                <div style={{ fontSize: 11, fontWeight: 600, width: 30, textAlign: 'right' }}>{fmt(d.value)}</div>
              </div>
            ))}
          </Card>
        ))}
      </div>

      <Card title="Liens" sub="Top 20 — clic pour détail">
        <table className="table" style={{ width: '100%' }}>
          <thead>
            <tr>
              {['Lien court', 'Destination', 'Clics 30j', 'Humains', 'Variation', 'Créé le'].map((h, i) => (
                <th key={i} style={{ textAlign: 'left', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', color: 'var(--muted)', padding: '8px 10px' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shortio.links.map((l, i) => (
              <tr key={i} onClick={() => setSelectedLink(l)} style={{ cursor: 'pointer', borderTop: '1px solid var(--border-soft)' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                onMouseLeave={e => (e.currentTarget.style.background = '')}>
                <td style={{ padding: '10px', fontSize: 12, fontWeight: 600, color: BLUE }}>/{l.path}</td>
                <td style={{ padding: '10px', fontSize: 11, color: 'var(--muted)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.originalUrl}</td>
                <td style={{ padding: '10px', fontSize: 13, fontWeight: 700 }}>{fmt(l.clicks30d)}</td>
                <td style={{ padding: '10px', fontSize: 12 }}>{fmt(l.humanClicks30d)}</td>
                <td style={{ padding: '10px', fontSize: 12, color: l.clicksChange !== null ? (l.clicksChange >= 0 ? GREEN : RED) : 'var(--muted)', fontWeight: 600 }}>
                  {l.clicksChange !== null ? `${l.clicksChange >= 0 ? '+' : ''}${fmtPct(l.clicksChange)}` : '—'}
                </td>
                <td style={{ padding: '10px', fontSize: 11, color: 'var(--muted)' }}>{new Date(l.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: '2-digit' })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {selectedLink && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
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
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 16 }}>
              {[
                { title: 'Pays', data: selectedLink.countries },
                { title: 'Referrers', data: selectedLink.referrers },
                { title: 'UTM Source', data: selectedLink.utmSource },
                { title: 'UTM Medium', data: selectedLink.utmMedium },
              ].map(({ title, data }, i) => (
                <div key={i}>
                  <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6 }}>{title}</div>
                  {data.slice(0, 5).map((d, j) => (
                    <div key={j} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>
                      <span>{d.label || '—'}</span><span style={{ fontWeight: 600, color: 'var(--ink)' }}>{fmt(d.value)}</span>
                    </div>
                  ))}
                  {data.length === 0 && <div style={{ fontSize: 11, color: 'var(--faint)' }}>—</div>}
                </div>
              ))}
            </div>
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
  profileViews30d: 21400, views30d: 512000,
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
  channelName: 'Quennel Coaching', channelThumbnail: '', subscribers: 8240,
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
    { id: 'v3', title: 'Script DM qui converti #shorts', thumbnail: '', publishedAt: new Date(Date.now() - 4*86400000).toISOString(), duration: '0:58', isShort: true, views: 84200, likes: 3800, comments: 412, views30d: 72000, watchTime30d: 41760, avgViewPct: 48, url: '#', likes30d: 2840, comments30d: 312, shares30d: 580 },
    { id: 'v4', title: 'Ma méthode pour closer 80% de mes calls', thumbnail: '', publishedAt: new Date(Date.now() - 35*86400000).toISOString(), duration: '31:04', isShort: false, views: 18400, likes: 780, comments: 124, views30d: 4100, watchTime30d: 38000, avgViewPct: 71, url: '#', likes30d: 180, comments30d: 28, shares30d: 24 },
    { id: 'v5', title: 'Mindset millionnaire — 5 habitudes', thumbnail: '', publishedAt: new Date(Date.now() - 48*86400000).toISOString(), duration: '14:22', isShort: false, views: 9800, likes: 342, comments: 58, views30d: 2400, watchTime30d: 18000, avgViewPct: 54, url: '#', likes30d: 120, comments30d: 18, shares30d: 14 },
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

const MOCK_STRIPE: StripeStats = {
  mrr: 11400, monthlyRevenue: 13200, activeSubscriptions: 8, availableBalance: 4820,
  recentPayments: [
    { id: 'p1', amount: 1800, currency: 'eur', description: 'Coaching Premium — Thomas R.', date: new Date(Date.now() - 2*86400000).toISOString(), status: 'succeeded' },
    { id: 'p2', amount: 1800, currency: 'eur', description: 'Coaching Premium — Sarah M.', date: new Date(Date.now() - 3*86400000).toISOString(), status: 'succeeded' },
    { id: 'p3', amount: 1200, currency: 'eur', description: 'Coaching Standard — Lucas B.', date: new Date(Date.now() - 5*86400000).toISOString(), status: 'succeeded' },
    { id: 'p4', amount: 1200, currency: 'eur', description: 'Coaching Standard — Emma D.', date: new Date(Date.now() - 7*86400000).toISOString(), status: 'succeeded' },
    { id: 'p5', amount: 1800, currency: 'eur', description: 'Coaching Premium — Mehdi A.', date: new Date(Date.now() - 9*86400000).toISOString(), status: 'succeeded' },
    { id: 'p6', amount: 1200, currency: 'eur', description: 'Coaching Standard — Julie F.', date: new Date(Date.now() - 12*86400000).toISOString(), status: 'failed' },
    { id: 'p7', amount: 1800, currency: 'eur', description: 'Coaching Premium — Kevin L.', date: new Date(Date.now() - 14*86400000).toISOString(), status: 'succeeded' },
  ],
};

const MOCK_MSGS: IGMessages = {
  totalThreads30d: 148, repliedThreads: 124, responseRate: 83.8, leadCount: 18,
  keywordCounts: { 'coaching': 38, 'tarif': 31, 'accompagnement': 28, 'résultats': 24, 'programme': 19, 'call': 17, 'aide': 14 },
  threads: [
    { threadId: 't1', updatedAt: new Date(Date.now() - 1*3600000).toISOString(), messageCount: 8, hasReply: true, participant: 'thomas_entreprise', preview: 'Bonjour, je suis intéressé par votre programme coaching...', isLead: true },
    { threadId: 't2', updatedAt: new Date(Date.now() - 3*3600000).toISOString(), messageCount: 3, hasReply: false, participant: 'sarah.mindset', preview: 'C\'est quoi le tarif pour 3 mois ?', isLead: true },
    { threadId: 't3', updatedAt: new Date(Date.now() - 6*3600000).toISOString(), messageCount: 12, hasReply: true, participant: 'lucas_b_officiel', preview: 'Merci pour ta réponse ! Je voulais te dire que...', isLead: false },
    { threadId: 't4', updatedAt: new Date(Date.now() - 1*86400000).toISOString(), messageCount: 5, hasReply: true, participant: 'emma.dev', preview: 'Est-ce que tu fais des sessions individuelles ?', isLead: true },
    { threadId: 't5', updatedAt: new Date(Date.now() - 1.5*86400000).toISOString(), messageCount: 2, hasReply: false, participant: 'mehdi_academy', preview: 'J\'ai vu ta vidéo sur les tunnels de vente, incroyable !', isLead: false },
    { threadId: 't6', updatedAt: new Date(Date.now() - 2*86400000).toISOString(), messageCount: 7, hasReply: true, participant: 'julie_coaching', preview: 'Tu peux me parler de ton accompagnement ?', isLead: true },
  ],
};

// Logique calls :
// 11 bookés actifs (status active) + 1 canceled = 12 au total
// 2 à venir (c1, c2) → pas encore honorés ni no-show
// 9 passés actifs dont 2 no-shows (c4, c9) → 7 honorés
// 5 deals closés sur 7 honorés = 71% closing
// Revenue total IG : 1200+1200+1200 = 3600€ / YT : 1800+2400 = 4200€ → total 7800€
const MOCK_CALLS: CallRecord[] = [
  // À venir — pas encore honorés
  { id: 'c1',  scheduled_at: new Date(Date.now() + 3*86400000).toISOString(),   status: 'active',   invitee_name: 'Thomas Renard',    invitee_email: 'thomas@email.com',   duration: 60, source: 'ig_bio' },
  { id: 'c2',  scheduled_at: new Date(Date.now() + 6*86400000).toISOString(),   status: 'active',   invitee_name: 'Sarah Martin',     invitee_email: 'sarah@email.com',    duration: 60, source: 'yt_description' },
  // Passés — no-show (2)
  { id: 'c4',  scheduled_at: new Date(Date.now() - 4*86400000).toISOString(),   status: 'active',   invitee_name: 'Emma Dupont',      invitee_email: 'emma@email.com',     duration: 60, source: 'ig_story',      no_show: true },
  { id: 'c9',  scheduled_at: new Date(Date.now() - 15*86400000).toISOString(),  status: 'active',   invitee_name: 'Antoine Morel',    invitee_email: 'antoine@email.com',  duration: 60, source: 'ig_bio',        no_show: true },
  // Passés honorés — deal closé (5)
  { id: 'c6',  scheduled_at: new Date(Date.now() - 7*86400000).toISOString(),   status: 'active',   invitee_name: 'Julie Fontaine',   invitee_email: 'julie@email.com',    duration: 60, source: 'ig_bio',        deal_closed: true, revenue: 1200 },
  { id: 'c8',  scheduled_at: new Date(Date.now() - 10*86400000).toISOString(),  status: 'active',   invitee_name: 'Camille Rey',      invitee_email: 'camille@email.com',  duration: 60, source: 'ig_reel',       deal_closed: true, revenue: 1200 },
  { id: 'c14', scheduled_at: new Date(Date.now() - 13*86400000).toISOString(),  status: 'active',   invitee_name: 'Yasmine Benali',   invitee_email: 'yasmine@email.com',  duration: 60, source: 'ig_story',      deal_closed: true, revenue: 1200 },
  { id: 'c7',  scheduled_at: new Date(Date.now() - 17*86400000).toISOString(),  status: 'active',   invitee_name: 'Kevin Laurent',    invitee_email: 'kevin@email.com',    duration: 60, source: 'yt_description', deal_closed: true, revenue: 1800 },
  { id: 'c10', scheduled_at: new Date(Date.now() - 21*86400000).toISOString(),  status: 'active',   invitee_name: 'Léa Petit',        invitee_email: 'lea@email.com',      duration: 60, source: 'yt_description', deal_closed: true, revenue: 2400 },
  // Passés honorés — pas closé (2)
  { id: 'c3',  scheduled_at: new Date(Date.now() - 5*86400000).toISOString(),   status: 'active',   invitee_name: 'Lucas Bernard',    invitee_email: 'lucas@email.com',    duration: 60, source: 'ig_reel',       deal_closed: false },
  { id: 'c5',  scheduled_at: new Date(Date.now() - 8*86400000).toISOString(),   status: 'active',   invitee_name: 'Mehdi Amrani',     invitee_email: 'mehdi@email.com',    duration: 60, source: 'yt_description', deal_closed: false },
  // Annulé non rebooké (abandon avant call)
  { id: 'c12', scheduled_at: new Date(Date.now() - 12*86400000).toISOString(),  status: 'canceled', invitee_name: 'Inès Garnier',     invitee_email: 'ines@email.com',     duration: 60, source: 'ig_bio' },
  // Annulé + rebooké (le nouveau call = c1, même personne)
  { id: 'c13', scheduled_at: new Date(Date.now() - 6*86400000).toISOString(),   status: 'canceled', invitee_name: 'Thomas Renard',    invitee_email: 'thomas@email.com',   duration: 60, source: 'ig_bio', rescheduled: true },
];
// Résultat : 11 actifs + 2 canceled (1 abandon, 1 rebooké) = 13 calls au total
// Bookés (active) = 11 | À venir = 2 | Passés = 9 | No-show = 2 | Honorés = 7 | Closés = 5 (71%) | Revenue = 7 800€
// IG : 7 actifs (2 no-show, 3 closés, 2 pas closés) | YT : 4 actifs (2 closés, 2 pas closés)
// c13 (Thomas Renard rebooké) est lié à c1 — ne pas compter en double dans les bookés

const MOCK_SHORTIO: ShortioStats = {
  domain: 'qnl.link', totalLinks: 14, clicks30d: 418, humanClicks30d: 374,
  clicksChange: 12.4, clicksPerLink30d: 29.9,
  chartData: makeDays(30, 14, 7).map(d => ({ date: d.date, clicks: d.value })),
  topCountries: [{ label: 'France', value: 284 }, { label: 'Belgique', value: 52 }, { label: 'Suisse', value: 28 }, { label: 'Canada', value: 18 }, { label: 'Maroc', value: 12 }],
  topReferrers: [{ label: 'instagram.com', value: 218 }, { label: 'Direct', value: 98 }, { label: 'youtube.com', value: 42 }, { label: 't.co', value: 22 }, { label: 'linktr.ee', value: 14 }],
  topBrowsers: [{ label: 'Chrome', value: 214 }, { label: 'Safari', value: 128 }, { label: 'Firefox', value: 42 }, { label: 'Edge', value: 18 }],
  topOs: [{ label: 'Android', value: 178 }, { label: 'iOS', value: 148 }, { label: 'Windows', value: 62 }, { label: 'macOS', value: 24 }],
  topSocial: [{ label: 'Instagram', value: 218 }, { label: 'Twitter/X', value: 42 }, { label: 'Facebook', value: 18 }, { label: 'LinkedIn', value: 12 }],
  topCities: [{ label: 'Paris', value: 92 }, { label: 'Lyon', value: 34 }, { label: 'Marseille', value: 26 }, { label: 'Bruxelles', value: 22 }, { label: 'Genève', value: 16 }],
  links: [
    { id: 1, path: 'appel', shortUrl: 'qnl.link/appel', originalUrl: 'https://calendly.com/quennel/discovery', title: 'Réserver un appel', createdAt: new Date(Date.now() - 45*86400000).toISOString(), clicks30d: 162, humanClicks30d: 148, clicksChange: 24.6, chartData: makeDays(30, 5, 3).map(d => ({ date: d.date, clicks: d.value })), countries: [{ label: 'France', value: 108 }], referrers: [{ label: 'instagram.com', value: 92 }], browsers: [{ label: 'Safari', value: 78 }], os: [{ label: 'iOS', value: 84 }], social: [{ label: 'Instagram', value: 92 }], cities: [{ label: 'Paris', value: 42 }], utmMedium: [], utmSource: [] },
    { id: 2, path: 'coaching', shortUrl: 'qnl.link/coaching', originalUrl: 'https://quennel.com/coaching', title: 'Page Coaching', createdAt: new Date(Date.now() - 60*86400000).toISOString(), clicks30d: 124, humanClicks30d: 112, clicksChange: 8.4, chartData: makeDays(30, 4, 2).map(d => ({ date: d.date, clicks: d.value })), countries: [{ label: 'France', value: 84 }], referrers: [{ label: 'instagram.com', value: 68 }], browsers: [{ label: 'Chrome', value: 72 }], os: [{ label: 'Android', value: 64 }], social: [{ label: 'Instagram', value: 68 }], cities: [{ label: 'Paris', value: 32 }], utmMedium: [], utmSource: [] },
    { id: 3, path: 'yt', shortUrl: 'qnl.link/yt', originalUrl: 'https://youtube.com/@quennel', title: 'Chaîne YouTube', createdAt: new Date(Date.now() - 30*86400000).toISOString(), clicks30d: 82, humanClicks30d: 72, clicksChange: 6.2, chartData: makeDays(30, 3, 2).map(d => ({ date: d.date, clicks: d.value })), countries: [{ label: 'France', value: 54 }], referrers: [{ label: 'instagram.com', value: 38 }], browsers: [{ label: 'Chrome', value: 44 }], os: [{ label: 'Android', value: 38 }], social: [{ label: 'Instagram', value: 38 }], cities: [{ label: 'Paris', value: 22 }], utmMedium: [], utmSource: [] },
    { id: 4, path: 'temoignages', shortUrl: 'qnl.link/temoignages', originalUrl: 'https://quennel.com/resultats', title: 'Témoignages clients', createdAt: new Date(Date.now() - 20*86400000).toISOString(), clicks30d: 50, humanClicks30d: 42, clicksChange: -3.8, chartData: makeDays(30, 2, 1).map(d => ({ date: d.date, clicks: d.value })), countries: [{ label: 'France', value: 34 }], referrers: [{ label: 'Direct', value: 22 }], browsers: [{ label: 'Chrome', value: 28 }], os: [{ label: 'Android', value: 24 }], social: [{ label: 'Instagram', value: 18 }], cities: [{ label: 'Paris', value: 12 }], utmMedium: [], utmSource: [] },
  ],
};

// ── Pill flottant haut-droit (onglet A) ──────────────────────────────────────
function PeriodPill({ period, setPeriod, periodIndex, setPeriodIndex, modalOpen }: {
  period: Period; setPeriod: (p: Period) => void;
  periodIndex: number; setPeriodIndex: (fn: (i: number) => number) => void;
  modalOpen: boolean;
}) {
  const history = period === 7 ? MOCK_HISTORY_7D : MOCK_HISTORY_30D;
  const maxIndex = history.length - 1;

  const STICKY_TOP = 56;
  const ORIGIN_TOP = 96;

  const pillRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scroller = document.querySelector('.main-content') as HTMLElement | null;
    if (!scroller) return;
    const onScroll = () => {
      if (!pillRef.current) return;
      const scrollY = scroller.scrollTop;
      const threshold = ORIGIN_TOP - STICKY_TOP;
      const top = scrollY >= threshold ? STICKY_TOP : ORIGIN_TOP - scrollY;
      pillRef.current.style.top = `${top}px`;
      const shadowOpacity = Math.min(scrollY / 60, 1) * 0.12;
      pillRef.current.style.boxShadow = `0 4px 16px rgba(0,0,0,${shadowOpacity.toFixed(3)})`;
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => scroller.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!pillRef.current) return;
    const scroller = document.querySelector('.main-content') as HTMLElement | null;
    const scrollY = scroller?.scrollTop ?? 0;
    const threshold = ORIGIN_TOP - STICKY_TOP;
    const baseTop = scrollY >= threshold ? STICKY_TOP : ORIGIN_TOP - scrollY;
    pillRef.current.style.top = modalOpen ? `${STICKY_TOP}px` : `${baseTop}px`;
  }, [modalOpen]);

  return (
    <div ref={pillRef} style={{
      position: 'fixed', top: 96, right: 27, zIndex: 1100,
      display: 'flex', alignItems: 'center', gap: 8,
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 12, padding: '5px 10px',
      boxShadow: 'none',
    }}>
      {/* Navigateur période */}
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
      {/* Séparateur */}
      <div style={{ width: 1, height: 28, background: 'var(--border)', margin: '0 4px' }} />
      {/* 7j / 30j */}
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
  const history = period === 7 ? MOCK_HISTORY_7D : MOCK_HISTORY_30D;
  const maxIndex = history.length - 1;
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

export default function PageAnalytics({ profileId }: { profileId?: string } = {}) {
  const [tab, setTab] = useState(0);
  const [period, setPeriod] = useState<Period>(30);
  const [periodIndex, setPeriodIndex] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [ig, setIg] = useState<IGStats | null>(null);
  const [yt, setYt] = useState<YTStats | null>(null);
  const [stripe, setStripe] = useState<StripeStats | null>(null);
  const [msgs, setMsgs] = useState<IGMessages | null>(null);
  const [shortio, setShortio] = useState<ShortioStats | null>(null);
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    const q = profileId ? `?profileId=${profileId}` : '';

    async function load() {
      const safe = async (fn: () => Promise<Response>) => {
        try { const r = await fn(); return r.ok ? r.json() : null; } catch { return null; }
      };

      const [igData, ytData, stripeData, msgsData, shortioData] = await Promise.all([
        safe(() => fetch(`/api/instagram/stats${q}`)),
        safe(() => fetch(`/api/youtube/stats${q}`)),
        safe(() => fetch(`/api/stripe/client-data${q}`)),
        safe(() => fetch(`/api/instagram/messages${q}`)),
        safe(() => fetch(`/api/shortio/stats${q}`)),
      ]);

      if (igData && !igData.error) setIg(igData);
      if (ytData && !ytData.error) setYt(ytData);
      if (stripeData && !stripeData.error) setStripe(stripeData);
      if (msgsData && !msgsData.error) setMsgs(msgsData);
      if (shortioData && !shortioData.error) setShortio(shortioData);

      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        if (profileId) {
          // Mode coach : calls de l'élève filtrés par coach_id (le coach connecté)
          const { data } = await supabase
            .from('calls')
            .select('*')
            .eq('coach_id', user.id)
            .order('scheduled_at', { ascending: false })
            .limit(500);
          if (data) setCalls(data);
        } else {
          // Mode élève : calls via client_id → profile_id de l'élève connecté
          const { data: clientRow } = await supabase
            .from('clients')
            .select('id')
            .eq('profile_id', user.id)
            .maybeSingle();
          if (clientRow) {
            const { data } = await supabase
              .from('calls')
              .select('*')
              .eq('client_id', clientRow.id)
              .order('scheduled_at', { ascending: false })
              .limit(500);
            if (data) setCalls(data);
          }
        }
      }

      setLoading(false);
    }

    load();
  }, [profileId]);

  const TABS = ['Vue générale', 'Instagram', 'YouTube', 'Funnel & Calls (A)', 'Funnel & Calls (B)', 'Revenus', 'Short.io'];

  return (
    <div className="page-content">
      <div className="page-header" style={{ marginBottom: 20, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 className="page-title">Analytics</h1>
          <p className="page-sub">Tableau de bord complet — toutes les plateformes</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          {/* Pill période — onglet Funnel & Calls (A) */}
          {tab === 3 && (
            <PeriodPill period={period} setPeriod={setPeriod} periodIndex={periodIndex} setPeriodIndex={setPeriodIndex} modalOpen={modalOpen} />
          )}
          {/* Sélecteur 7j/30j — autres onglets */}
          {tab !== 3 && tab !== 4 && (
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
      </div>

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {loading ? <Loading /> : (
        <>
          {tab === 0 && <TabOverviewV2 ig={ig} yt={yt} stripe={stripe} msgs={msgs} calls={calls} shortio={shortio} period={period} />}
          {tab === 1 && <TabInstagram ig={ig} period={period} />}
          {tab === 2 && <TabYouTube yt={yt} period={period} />}
          {tab === 3 && <TabFunnel msgs={msgs} calls={calls} stripe={stripe} ig={ig} yt={yt} shortio={shortio} period={period} periodIndex={periodIndex} onModalChange={setModalOpen} />}
          {tab === 4 && <TabFunnelDetail msgs={msgs} calls={calls} stripe={stripe} ig={ig} yt={yt} shortio={shortio} />}
          {tab === 5 && <TabRevenues stripe={stripe} period={period} />}
          {tab === 6 && <TabShortio shortio={shortio} period={period} />}
        </>
      )}
    </div>
  );
}
