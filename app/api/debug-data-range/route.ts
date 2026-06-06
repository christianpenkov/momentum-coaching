import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// GET /api/debug-data-range?profile_id=xxx
// Montre exactement ce que chaque API retourne : dates disponibles, granularité, day-to-day ou pas

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function analyzeTimeSeries(data: { date: string; [key: string]: any }[], label: string) {
  if (!data?.length) return { label, status: 'VIDE', count: 0 };
  const dates = data.map(d => d.date).sort();
  const first = dates[0];
  const last = dates[dates.length - 1];
  const daySpan = Math.round((new Date(last).getTime() - new Date(first).getTime()) / 86400000) + 1;
  const isDayToDay = data.length >= daySpan - 2; // tolérance 2 jours manquants
  const keys = Object.keys(data[0]).filter(k => k !== 'date');
  return {
    label,
    status: isDayToDay ? '✅ DAY-TO-DAY' : '⚠️ PAS DAY-TO-DAY',
    count: data.length,
    firstDate: first,
    lastDate: last,
    daySpan,
    fields: keys,
    sample: data.slice(-3), // 3 dernières entrées
  };
}

export async function GET(req: NextRequest) {
  const profile_id = req.nextUrl.searchParams.get('profile_id');
  if (!profile_id) return NextResponse.json({ error: 'profile_id requis' }, { status: 400 });

  const base = process.env.NEXT_PUBLIC_APP_URL!;
  const h = { 'authorization': `Bearer ${process.env.CRON_SECRET}` };
  const results: Record<string, any> = {};

  // ── Instagram ─────────────────────────────────────────────────────────────────
  try {
    const res = await fetch(`${base}/api/instagram/stats?profile_id=${profile_id}`, { headers: h });
    const data = await res.json();

    results.instagram = {
      status: res.ok ? 'OK' : 'ERREUR',
      error: data.error || null,

      // Métriques scalaires disponibles
      scalars: res.ok ? {
        followers: data.followers,
        following: data.following,
        reach30d: data.reach30d,
        views30d: data.views30d,
        accountsEngaged30d: data.accountsEngaged30d,
        totalInteractions30d: data.totalInteractions30d,
        profileLinksTaps30d: data.profileLinksTaps30d,
        websiteClicks30d: data.websiteClicks30d,
        followsUnfollows30d: data.followsUnfollows30d,
      } : null,

      // Analyse du chartData (reach/vues jour par jour)
      chartData: res.ok ? analyzeTimeSeries(data.chartData || [], 'IG chartData') : null,

      // Posts : est-ce qu'on a des dates individuelles ?
      posts: res.ok ? {
        count: data.posts?.length || 0,
        fields: data.posts?.[0] ? Object.keys(data.posts[0]) : [],
        hasDates: data.posts?.every((p: any) => !!p.timestamp),
        sample: data.posts?.slice(0, 2).map((p: any) => ({
          id: p.id,
          type: p.type,
          timestamp: p.timestamp,
          reach: p.reach,
          views: p.views,
          likes: p.likes,
        })),
      } : null,

      // Démographie
      demographics: res.ok ? {
        available: Object.keys(data.demographics || {}),
      } : null,
    };
  } catch (e: any) {
    results.instagram = { status: 'EXCEPTION', error: e.message };
  }

  // ── YouTube ───────────────────────────────────────────────────────────────────
  try {
    const res = await fetch(`${base}/api/youtube/stats?profile_id=${profile_id}`, { headers: h });
    const data = await res.json();

    results.youtube = {
      status: res.ok ? 'OK' : 'ERREUR',
      error: data.error || null,

      scalars: res.ok ? {
        subscribers: data.subscribers,
        totalViews: data.totalViews,
        views30d: data.views30d,
        watchTime30d: data.watchTime30d,
        avgViewDurationSec: data.avgViewDurationSec,
        likes30d: data.likes30d,
        comments30d: data.comments30d,
        shares30d: data.shares30d,
        subsGained30d: data.subsGained30d,
        subsLost30d: data.subsLost30d,
        netSubs30d: data.netSubs30d,
      } : null,

      // Analyse du chartData
      chartData: res.ok ? analyzeTimeSeries(data.chartData || [], 'YT chartData') : null,

      // Vidéos
      videos: res.ok ? {
        count: data.videos?.length || 0,
        fields: data.videos?.[0] ? Object.keys(data.videos[0]) : [],
        hasDates: data.videos?.every((v: any) => !!v.publishedAt),
        sample: data.videos?.slice(0, 2).map((v: any) => ({
          id: v.id,
          title: v.title?.slice(0, 40),
          publishedAt: v.publishedAt,
          views: v.views,
          views30d: v.views30d,
          watchTime30d: v.watchTime30d,
        })),
      } : null,

      // Sources de trafic disponibles
      trafficSources: res.ok ? data.trafficSources?.slice(0, 5) : null,
      devices: res.ok ? data.devices : null,
    };
  } catch (e: any) {
    results.youtube = { status: 'EXCEPTION', error: e.message };
  }

  // ── Stripe ────────────────────────────────────────────────────────────────────
  try {
    const res = await fetch(`${base}/api/stripe/client-data?profile_id=${profile_id}`, { headers: h });
    const data = await res.json();

    results.stripe = {
      status: res.ok ? 'OK' : 'ERREUR',
      error: data.error || null,

      scalars: res.ok ? {
        mrr: data.mrr,
        monthlyRevenue: data.monthlyRevenue,
        activeSubscriptions: data.activeSubscriptions,
        availableBalance: data.availableBalance,
      } : null,

      // Paiements : dates disponibles ?
      recentPayments: res.ok ? {
        count: data.recentPayments?.length || 0,
        hasDates: data.recentPayments?.every((p: any) => !!p.date),
        dateRange: data.recentPayments?.length ? {
          first: data.recentPayments[data.recentPayments.length - 1]?.date,
          last: data.recentPayments[0]?.date,
        } : null,
        note: 'Stripe ne retourne que 10 paiements récents — pas de série temporelle 30j',
        sample: data.recentPayments?.slice(0, 3),
      } : null,
    };
  } catch (e: any) {
    results.stripe = { status: 'EXCEPTION', error: e.message };
  }

  // ── Calendly (calls depuis Supabase) ─────────────────────────────────────────
  try {
    const { data: calls, error } = await supabase
      .from('calls')
      .select('id, scheduled_at, status, no_show, deal_closed, revenue, source')
      .eq('client_id', profile_id)
      .order('scheduled_at', { ascending: false })
      .limit(100);

    if (error) throw new Error(error.message);

    const now = new Date();
    const since30 = new Date(now.getTime() - 30 * 86400000);
    const calls30 = (calls || []).filter(c => new Date(c.scheduled_at) >= since30);

    // Analyse day-to-day
    const byDate: Record<string, number> = {};
    for (const c of calls30) {
      const d = c.scheduled_at?.split('T')[0];
      if (d) byDate[d] = (byDate[d] || 0) + 1;
    }
    const datesWithCalls = Object.keys(byDate).sort();

    results.calendly = {
      status: 'OK (Supabase)',
      note: 'Calendly passe par la table calls en Supabase — pas d\'API directe',

      total: calls?.length || 0,
      last30d: {
        count: calls30.length,
        booked: calls30.filter(c => c.status === 'active').length,
        canceled: calls30.filter(c => c.status === 'canceled').length,
        honored: calls30.filter(c => c.status === 'active' && new Date(c.scheduled_at) < now && !c.no_show).length,
        noShow: calls30.filter(c => c.no_show).length,
        closed: calls30.filter(c => c.deal_closed).length,
        revenue: calls30.reduce((s, c) => s + (c.revenue || 0), 0),
      },

      timeSeries: {
        status: datesWithCalls.length > 0 ? '✅ DAY-TO-DAY possible (si calls chaque jour)' : '⚠️ Pas assez de calls pour série temporelle dense',
        datesWithCalls: datesWithCalls.length,
        firstDate: datesWithCalls[0] || null,
        lastDate: datesWithCalls[datesWithCalls.length - 1] || null,
        byDate,
      },

      sample: calls?.slice(0, 3).map(c => ({
        scheduled_at: c.scheduled_at,
        status: c.status,
        no_show: c.no_show,
        deal_closed: c.deal_closed,
        revenue: c.revenue,
        source: c.source,
      })),
    };
  } catch (e: any) {
    results.calendly = { status: 'EXCEPTION', error: e.message };
  }

  // ── Résumé global ─────────────────────────────────────────────────────────────
  results._summary = {
    profile_id,
    timestamp: new Date().toISOString(),
    dayToDayAvailable: {
      ig_reach_views: results.instagram?.chartData?.status || 'N/A',
      ig_followers: '⚠️ Delta seulement (follower_count = variation, pas valeur absolue)',
      yt_views_watchtime: results.youtube?.chartData?.status || 'N/A',
      stripe_revenue: '⚠️ Pas de série temporelle — scalaires seulement',
      calls_booked: results.calendly?.timeSeries?.status || 'N/A',
    },
    recommendation: [
      'Stocker ig_chart_data (JSONB) dans les snapshots pour reconstituer les semaines passées',
      'Stocker yt_chart_data (JSONB) dans les snapshots idem',
      'Les calls sont déjà day-to-day en DB — requête directe sur scheduled_at suffit',
      'Stripe : agréger revenue depuis la table calls (deal_closed + revenue) plutôt que Stripe API',
    ],
  };

  return NextResponse.json(results, { status: 200 });
}
