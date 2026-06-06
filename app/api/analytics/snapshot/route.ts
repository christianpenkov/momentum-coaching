import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Appelé par Make.com chaque nuit à minuit pour chaque client
// POST /api/analytics/snapshot
// Body: { profile_id: string, cron_secret: string }
export async function POST(req: NextRequest) {
  const body = await req.json();

  if (body.cron_secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { profile_id } = body;
  if (!profile_id) {
    return NextResponse.json({ error: 'profile_id required' }, { status: 400 });
  }

  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const errors: string[] = [];

  // ── Fetch Instagram ──────────────────────────────────────────────────────────
  let igStats: any = null;
  try {
    const igRes = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL}/api/instagram/stats?profile_id=${profile_id}`,
      { headers: { 'x-internal-cron': process.env.CRON_SECRET! } }
    );
    if (igRes.ok) igStats = await igRes.json();
  } catch (e) { errors.push('ig_fetch_failed'); }

  // ── Fetch YouTube ────────────────────────────────────────────────────────────
  let ytStats: any = null;
  try {
    const ytRes = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL}/api/youtube/stats?profile_id=${profile_id}`,
      { headers: { 'x-internal-cron': process.env.CRON_SECRET! } }
    );
    if (ytRes.ok) ytStats = await ytRes.json();
  } catch (e) { errors.push('yt_fetch_failed'); }

  // ── Fetch Short.io ───────────────────────────────────────────────────────────
  let shortioStats: any = null;
  try {
    const shortioRes = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL}/api/shortio/stats?profile_id=${profile_id}`,
      { headers: { 'x-internal-cron': process.env.CRON_SECRET! } }
    );
    if (shortioRes.ok) shortioStats = await shortioRes.json();
  } catch (e) { errors.push('shortio_fetch_failed'); }

  // ── Fetch Stripe ─────────────────────────────────────────────────────────────
  let stripeStats: any = null;
  try {
    const stripeRes = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL}/api/stripe/client-data?profile_id=${profile_id}`,
      { headers: { 'x-internal-cron': process.env.CRON_SECRET! } }
    );
    if (stripeRes.ok) stripeStats = await stripeRes.json();
  } catch (e) { errors.push('stripe_fetch_failed'); }

  // ── Fetch calls depuis Supabase ───────────────────────────────────────────────
  let callsData: any[] = [];
  try {
    const { data } = await supabase
      .from('calls')
      .select('*')
      .eq('client_id', profile_id)
      .not('calendly_event_uuid', 'is', null);
    callsData = data || [];
  } catch (e) { errors.push('calls_fetch_failed'); }

  // ── Fetch IG messages ─────────────────────────────────────────────────────────
  let igMessages: any = null;
  try {
    const msgsRes = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL}/api/instagram/messages?profile_id=${profile_id}`,
      { headers: { 'x-internal-cron': process.env.CRON_SECRET! } }
    );
    if (msgsRes.ok) igMessages = await msgsRes.json();
  } catch (e) { errors.push('ig_messages_fetch_failed'); }

  // ── Calcul appels ─────────────────────────────────────────────────────────────
  const now = new Date();
  const callsBooked   = callsData.filter(c => c.status === 'active').length;
  const callsHonored  = callsData.filter(c => c.status === 'active' && new Date(c.scheduled_at) < now && !c.no_show).length;
  const callsCanceled = callsData.filter(c => c.status === 'canceled').length;
  const callsNoShow   = callsData.filter(c => c.no_show).length;
  const dealsClosed   = callsData.filter(c => c.deal_closed).length;
  const revenue       = callsData.reduce((s, c) => s + (c.revenue || 0), 0);

  // ── Upsert snapshot quotidien ────────────────────────────────────────────────
  const snapshot = {
    profile_id,
    date: today,

    // Instagram
    ig_reach:              igStats?.reach30d ?? null,
    ig_impressions:        null, // pas exposé actuellement
    ig_followers:          igStats?.followers ?? null,
    ig_following:          igStats?.following ?? null,
    ig_accounts_engaged:   igStats?.accountsEngaged30d ?? null,
    ig_total_interactions: igStats?.totalInteractions30d ?? null,
    ig_profile_taps:       igStats?.profileLinksTaps30d ?? null,
    ig_website_clicks:     igStats?.websiteClicks30d ?? null,
    ig_views:              igStats?.views30d ?? null,
    ig_follows_unfollows:  igStats?.followsUnfollows30d ?? null,
    ig_lead_count:         igMessages?.leadCount ?? null,
    ig_response_rate:      igMessages?.responseRate ?? null,
    ig_demographics:       igStats?.demographics ?? null,

    // YouTube
    yt_views:                  ytStats?.views30d ?? null,
    yt_watch_time_min:         ytStats?.watchTime30d ?? null,
    yt_subscribers:            ytStats?.subscribers ?? null,
    yt_subs_gained:            ytStats?.subsGained30d ?? null,
    yt_subs_lost:              ytStats?.subsLost30d ?? null,
    yt_net_subs:               ytStats?.netSubs30d ?? null,
    yt_likes:                  ytStats?.likes30d ?? null,
    yt_comments:               ytStats?.comments30d ?? null,
    yt_shares:                 ytStats?.shares30d ?? null,
    yt_avg_view_duration_sec:  ytStats?.avgViewDurationSec ?? null,
    yt_traffic_sources:        ytStats?.trafficSources ?? null,
    yt_devices:                ytStats?.devices ?? null,
    yt_demographics:           ytStats?.demographics ?? null,

    // Short.io
    shortio_clicks:       shortioStats?.clicks30d ?? null,
    shortio_human_clicks: shortioStats?.humanClicks30d ?? null,
    shortio_links:        shortioStats?.links ?? null,
    shortio_top_countries: shortioStats?.topCountries ?? null,
    shortio_top_referrers: shortioStats?.topReferrers ?? null,

    // Business
    calls_booked:        callsBooked,
    calls_honored:       callsHonored,
    calls_canceled:      callsCanceled,
    calls_no_show:       callsNoShow,
    deals_closed:        dealsClosed,
    revenue,
    mrr:                 stripeStats?.mrr ?? null,
    stripe_active_subs:  stripeStats?.activeSubscriptions ?? null,
  };

  const { error: snapshotError } = await supabase
    .from('analytics_daily_snapshots')
    .upsert(snapshot, { onConflict: 'profile_id,date' });

  if (snapshotError) errors.push(`snapshot_upsert: ${snapshotError.message}`);

  // ── Upsert posts Instagram ────────────────────────────────────────────────────
  if (igStats?.posts?.length) {
    const posts = igStats.posts.map((p: any) => ({
      profile_id,
      snapshot_date:       today,
      post_id:             p.id,
      post_type:           p.type,
      caption:             p.caption,
      permalink:           p.permalink,
      thumbnail:           p.thumbnail,
      published_at:        p.timestamp,
      reach:               p.reach,
      views:               p.views,
      likes:               p.likes,
      comments:            p.comments,
      saves:               p.saved,
      shares:              p.shares,
      follows:             p.follows,
      profile_visits:      p.profileVisits,
      total_interactions:  p.totalInteractions,
      avg_watch_time_ms:   p.avgWatchTimeMs,
      total_watch_time_ms: p.totalWatchTimeMs,
      skip_rate:           p.skipRate,
      video_duration_sec:  p.videoDuration,
    }));

    const { error: postsError } = await supabase
      .from('analytics_ig_posts_history')
      .upsert(posts, { onConflict: 'profile_id,snapshot_date,post_id' });

    if (postsError) errors.push(`posts_upsert: ${postsError.message}`);
  }

  // ── Upsert vidéos YouTube ─────────────────────────────────────────────────────
  if (ytStats?.videos?.length) {
    const videos = ytStats.videos.map((v: any) => ({
      profile_id,
      snapshot_date:   today,
      video_id:        v.id,
      title:           v.title,
      thumbnail:       v.thumbnail,
      published_at:    v.publishedAt,
      is_short:        v.isShort,
      views:           v.views,
      views_period:    v.views30d,
      watch_time_min:  v.watchTime30d,
      likes:           v.likes,
      comments:        v.comments,
      shares:          v.shares,
      avg_view_pct:    v.avgViewPct,
      url:             v.url,
    }));

    const { error: videosError } = await supabase
      .from('analytics_yt_videos_history')
      .upsert(videos, { onConflict: 'profile_id,snapshot_date,video_id' });

    if (videosError) errors.push(`videos_upsert: ${videosError.message}`);
  }

  return NextResponse.json({
    success: errors.length === 0,
    date: today,
    profile_id,
    errors: errors.length ? errors : undefined,
  });
}
