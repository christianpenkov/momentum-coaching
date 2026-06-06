import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ── Auth token Instagram ──────────────────────────────────────────────────────
async function getToken(profileId: string): Promise<{ token: string; igAccountId: string } | null> {
  const { data: integ } = await supabase
    .from('integrations')
    .select('access_token, expires_at, metadata')
    .eq('profile_id', profileId)
    .eq('provider', 'instagram')
    .single();

  if (!integ?.access_token) return null;

  const needsRefresh = integ.expires_at &&
    new Date(integ.expires_at).getTime() < Date.now() + 5 * 24 * 60 * 60 * 1000;

  let token = integ.access_token;

  if (needsRefresh) {
    const res = await fetch(
      `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${token}`
    );
    const data = await res.json();
    if (data.access_token) {
      token = data.access_token;
      const expiresAt = data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000).toISOString()
        : null;
      await supabase.from('integrations').update({ access_token: token, expires_at: expiresAt })
        .eq('profile_id', profileId).eq('provider', 'instagram');
    }
  }

  const igAccountId = (integ.metadata as any)?.ig_account_id || null;
  if (!igAccountId) return null;
  return { token, igAccountId };
}

// ── Poll DMs ──────────────────────────────────────────────────────────────────
async function pollDMs(profileId: string, token: string, igAccountId: string, keywords: string[], since: Date) {
  const threadsRes = await fetch(
    `https://graph.instagram.com/v21.0/${igAccountId}/conversations?fields=id,updated_time,participants,message_count&limit=50&access_token=${token}`
  );
  const threadsData = await threadsRes.json();
  if (threadsData.error) return [];

  const threads = (threadsData.data || []).filter(
    (t: any) => new Date(t.updated_time).getTime() > since.getTime()
  );

  const leads: any[] = [];

  await Promise.all(threads.map(async (thread: any) => {
    const msgRes = await fetch(
      `https://graph.instagram.com/v21.0/${thread.id}/messages?fields=id,message,from,created_time&limit=20&access_token=${token}`
    );
    const msgData = await msgRes.json();
    const messages: any[] = msgData?.data || [];

    for (const msg of messages) {
      if (!msg.message || msg.from?.id === igAccountId) continue;
      const text = msg.message.toLowerCase();
      for (const kw of keywords) {
        if (text.includes(kw)) {
          const participant = thread.participants?.data?.find((p: any) => p.id !== igAccountId);
          leads.push({
            profile_id: profileId,
            source: 'dm',
            ig_username: participant?.username || participant?.name || null,
            ig_user_id: msg.from?.id ? String(msg.from.id) : null,
            message: msg.message.slice(0, 500),
            media_id: thread.id,
            media_permalink: null,
            keyword_matched: kw,
            detected_at: new Date(msg.created_time).toISOString(),
          });
          break;
        }
      }
    }
  }));

  return leads;
}

// ── Poll commentaires ─────────────────────────────────────────────────────────
async function pollComments(profileId: string, token: string, igAccountId: string, keywords: string[], since: Date) {
  const mediaRes = await fetch(
    `https://graph.instagram.com/v21.0/${igAccountId}/media?fields=id,permalink,timestamp&limit=20&access_token=${token}`
  );
  const mediaData = await mediaRes.json();
  if (mediaData.error) return [];

  const recentMedia = (mediaData.data || []).filter(
    (m: any) => new Date(m.timestamp).getTime() > since.getTime() - 90 * 24 * 60 * 60 * 1000
  );

  const leads: any[] = [];

  await Promise.all(recentMedia.map(async (media: any) => {
    const commRes = await fetch(
      `https://graph.instagram.com/v21.0/${media.id}/comments?fields=id,text,timestamp,from,username&limit=50&access_token=${token}`
    );
    const commData = await commRes.json();
    if (commData.error) return;

    for (const comment of commData.data || []) {
      if (!comment.text) continue;
      if (new Date(comment.timestamp).getTime() < since.getTime()) continue;
      const text = comment.text.toLowerCase();
      for (const kw of keywords) {
        if (text.includes(kw)) {
          leads.push({
            profile_id: profileId,
            source: 'comment',
            ig_username: comment.from?.username || comment.username || null,
            ig_user_id: comment.from?.id ? String(comment.from.id) : null,
            message: comment.text.slice(0, 500),
            media_id: media.id,
            media_permalink: media.permalink || null,
            keyword_matched: kw,
            detected_at: new Date(comment.timestamp).toISOString(),
          });
          break;
        }
      }
    }
  }));

  return leads;
}

// ── Snapshot métriques pour un profil ────────────────────────────────────────
async function snapshotProfile(profileId: string): Promise<string[]> {
  const errors: string[] = [];
  const today = new Date().toISOString().split('T')[0];
  const base = process.env.NEXT_PUBLIC_APP_URL!;
  const h = { 'authorization': `Bearer ${process.env.CRON_SECRET}` };

  const [igRes, ytRes, shortioRes, stripeRes, msgsRes] = await Promise.allSettled([
    fetch(`${base}/api/instagram/stats?profile_id=${profileId}`, { headers: h }),
    fetch(`${base}/api/youtube/stats?profile_id=${profileId}`, { headers: h }),
    fetch(`${base}/api/shortio/stats?profile_id=${profileId}`, { headers: h }),
    fetch(`${base}/api/stripe/client-data?profile_id=${profileId}`, { headers: h }),
    fetch(`${base}/api/instagram/messages?profile_id=${profileId}`, { headers: h }),
  ]);

  const ig       = igRes.status === 'fulfilled' && igRes.value.ok ? await igRes.value.json() : null;
  const yt       = ytRes.status === 'fulfilled' && ytRes.value.ok ? await ytRes.value.json() : null;
  const shortio  = shortioRes.status === 'fulfilled' && shortioRes.value.ok ? await shortioRes.value.json() : null;
  const stripe   = stripeRes.status === 'fulfilled' && stripeRes.value.ok ? await stripeRes.value.json() : null;
  const msgs     = msgsRes.status === 'fulfilled' && msgsRes.value.ok ? await msgsRes.value.json() : null;

  if (!ig) errors.push('ig_fetch_failed');
  if (!yt) errors.push('yt_fetch_failed');
  if (!shortio) errors.push('shortio_fetch_failed');

  // Calls depuis Supabase
  const { data: callsData } = await supabase
    .from('calls')
    .select('status, scheduled_at, no_show, deal_closed, revenue')
    .eq('client_id', profileId)
    .not('calendly_event_uuid', 'is', null);

  const calls = callsData || [];
  const now = new Date();
  const callsBooked   = calls.filter(c => c.status === 'active').length;
  const callsHonored  = calls.filter(c => c.status === 'active' && new Date(c.scheduled_at) < now && !c.no_show).length;
  const callsCanceled = calls.filter(c => c.status === 'canceled').length;
  const callsNoShow   = calls.filter(c => c.no_show).length;
  const dealsClosed   = calls.filter(c => c.deal_closed).length;
  const revenue       = calls.reduce((s: number, c: any) => s + (c.revenue || 0), 0);

  // Upsert snapshot principal
  const { error: snapErr } = await supabase
    .from('analytics_daily_snapshots')
    .upsert({
      profile_id: profileId,
      date: today,

      ig_reach:              ig?.reach30d ?? null,
      ig_followers:          ig?.followers ?? null,
      ig_following:          ig?.following ?? null,
      ig_accounts_engaged:   ig?.accountsEngaged30d ?? null,
      ig_total_interactions: ig?.totalInteractions30d ?? null,
      ig_profile_taps:       ig?.profileLinksTaps30d ?? null,
      ig_website_clicks:     ig?.websiteClicks30d ?? null,
      ig_views:              ig?.views30d ?? null,
      ig_follows_unfollows:  ig?.followsUnfollows30d ?? null,
      ig_lead_count:         msgs?.leadCount ?? null,
      ig_response_rate:      msgs?.responseRate ?? null,
      ig_demographics:       ig?.demographics ?? null,

      yt_views:                 yt?.views30d ?? null,
      yt_watch_time_min:        yt?.watchTime30d ?? null,
      yt_subscribers:           yt?.subscribers ?? null,
      yt_subs_gained:           yt?.subsGained30d ?? null,
      yt_subs_lost:             yt?.subsLost30d ?? null,
      yt_net_subs:              yt?.netSubs30d ?? null,
      yt_likes:                 yt?.likes30d ?? null,
      yt_comments:              yt?.comments30d ?? null,
      yt_shares:                yt?.shares30d ?? null,
      yt_avg_view_duration_sec: yt?.avgViewDurationSec ?? null,
      yt_traffic_sources:       yt?.trafficSources ?? null,
      yt_devices:               yt?.devices ?? null,
      yt_demographics:          yt?.demographics ?? null,

      shortio_clicks:        shortio?.clicks30d ?? null,
      shortio_human_clicks:  shortio?.humanClicks30d ?? null,
      shortio_links:         shortio?.links ?? null,
      shortio_top_countries: shortio?.topCountries ?? null,
      shortio_top_referrers: shortio?.topReferrers ?? null,

      calls_booked:       callsBooked,
      calls_honored:      callsHonored,
      calls_canceled:     callsCanceled,
      calls_no_show:      callsNoShow,
      deals_closed:       dealsClosed,
      revenue,
      mrr:                stripe?.mrr ?? null,
      stripe_active_subs: stripe?.activeSubscriptions ?? null,
    }, { onConflict: 'profile_id,date' });

  if (snapErr) errors.push(`snapshot_upsert: ${snapErr.message}`);

  // Upsert posts IG
  if (ig?.posts?.length) {
    const { error: postsErr } = await supabase
      .from('analytics_ig_posts_history')
      .upsert(ig.posts.map((p: any) => ({
        profile_id: profileId, snapshot_date: today,
        post_id: p.id, post_type: p.type, caption: p.caption,
        permalink: p.permalink, thumbnail: p.thumbnail, published_at: p.timestamp,
        reach: p.reach, views: p.views, likes: p.likes, comments: p.comments,
        saves: p.saved, shares: p.shares, follows: p.follows,
        profile_visits: p.profileVisits, total_interactions: p.totalInteractions,
        avg_watch_time_ms: p.avgWatchTimeMs, total_watch_time_ms: p.totalWatchTimeMs,
        skip_rate: p.skipRate, video_duration_sec: p.videoDuration,
      })), { onConflict: 'profile_id,snapshot_date,post_id' });
    if (postsErr) errors.push(`posts_upsert: ${postsErr.message}`);
  }

  // Upsert vidéos YT
  if (yt?.videos?.length) {
    const { error: vidsErr } = await supabase
      .from('analytics_yt_videos_history')
      .upsert(yt.videos.map((v: any) => ({
        profile_id: profileId, snapshot_date: today,
        video_id: v.id, title: v.title, thumbnail: v.thumbnail,
        published_at: v.publishedAt, is_short: v.isShort,
        views: v.views, views_period: v.views30d, watch_time_min: v.watchTime30d,
        likes: v.likes, comments: v.comments, shares: v.shares,
        avg_view_pct: v.avgViewPct, url: v.url,
      })), { onConflict: 'profile_id,snapshot_date,video_id' });
    if (vidsErr) errors.push(`videos_upsert: ${vidsErr.message}`);
  }

  return errors;
}

// ── Cron Vercel — GET /api/instagram/poll-leads ───────────────────────────────
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  // Tous les profils avec Instagram connecté
  const { data: profiles } = await supabase
    .from('integrations')
    .select('profile_id, last_ig_poll')
    .eq('provider', 'instagram');

  if (!profiles?.length) return NextResponse.json({ polled: 0, snapshots: 0 });

  const profileIds = profiles.map(p => p.profile_id);

  // Mots-clés par profil (pour le poll leads)
  const { data: keywordRows } = await supabase
    .from('lead_magnet_keywords')
    .select('profile_id, keyword')
    .in('profile_id', profileIds);

  const keywordsByProfile: Record<string, string[]> = {};
  for (const row of keywordRows || []) {
    if (!keywordsByProfile[row.profile_id]) keywordsByProfile[row.profile_id] = [];
    keywordsByProfile[row.profile_id].push(row.keyword);
  }

  let polled = 0;
  let leadsFound = 0;
  let snapshots = 0;
  const allErrors: Record<string, string[]> = {};

  // Traite chaque profil séquentiellement pour éviter de saturer les APIs
  for (const profile of profiles) {
    const profileErrors: string[] = [];

    // ── 1. Poll leads IG (si mots-clés configurés) ──
    const keywords = keywordsByProfile[profile.profile_id] || [];
    if (keywords.length > 0) {
      try {
        const creds = await getToken(profile.profile_id);
        if (creds) {
          const { token, igAccountId } = creds;
          const since = profile.last_ig_poll
            ? new Date(profile.last_ig_poll)
            : new Date(Date.now() - 24 * 60 * 60 * 1000);

          const [dmLeads, commentLeads] = await Promise.all([
            pollDMs(profile.profile_id, token, igAccountId, keywords, since),
            pollComments(profile.profile_id, token, igAccountId, keywords, since),
          ]);

          const allLeads = [...dmLeads, ...commentLeads];
          if (allLeads.length > 0) {
            await supabase.from('instagram_leads').upsert(allLeads, {
              onConflict: 'profile_id,source,ig_user_id,keyword_matched,media_id',
              ignoreDuplicates: true,
            });
            leadsFound += allLeads.length;
          }

          await supabase.from('integrations')
            .update({ last_ig_poll: new Date().toISOString() })
            .eq('profile_id', profile.profile_id)
            .eq('provider', 'instagram');

          polled++;
        }
      } catch {
        profileErrors.push('lead_poll_failed');
      }
    }

    // ── 2. Snapshot métriques ──
    try {
      const snapErrors = await snapshotProfile(profile.profile_id);
      if (snapErrors.length === 0) snapshots++;
      else profileErrors.push(...snapErrors);
    } catch {
      profileErrors.push('snapshot_failed');
    }

    if (profileErrors.length) allErrors[profile.profile_id] = profileErrors;
  }

  return NextResponse.json({ polled, leadsFound, snapshots, errors: allErrors });
}
