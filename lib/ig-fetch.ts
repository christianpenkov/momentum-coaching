import { createClient } from '@supabase/supabase-js';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface IgCreds {
  token: string;
  igAccountId: string;
}

export interface IgDaySnapshot {
  date: string; // ISO YYYY-MM-DD
  ig_reach: number | null;
  ig_followers: number | null;
  ig_following: number | null;
  ig_views: number | null;
  ig_follows_unfollows: number | null;
  ig_profile_taps: number | null;
  ig_website_clicks: number | null;
  ig_accounts_engaged: number | null;
  ig_total_interactions: number | null;
  ig_lead_count: number | null;
  ig_response_rate: number | null;
}

// ── Token ─────────────────────────────────────────────────────────────────────

export async function getIgCreds(profileId: string): Promise<IgCreds | null> {
  const { data: integ } = await serviceSupabase
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
      await serviceSupabase.from('integrations')
        .update({ access_token: token, expires_at: expiresAt })
        .eq('profile_id', profileId).eq('provider', 'instagram');
    }
  }

  const igAccountId: string | null = (integ.metadata as any)?.ig_account_id || null;
  if (!igAccountId) return null;
  return { token, igAccountId };
}

// ── Fetch métriques J-1 (une seule journée) ──────────────────────────────────
// Utilisé par le cron et refresh-today

export async function fetchIgDayMetrics(
  creds: IgCreds,
  date: string // ISO YYYY-MM-DD — la journée à récupérer
): Promise<Omit<IgDaySnapshot, 'date'>> {
  const { token, igAccountId } = creds;

  // since/until en unix pour l'API Meta (period=day)
  const d = new Date(date + 'T00:00:00Z');
  const since = Math.floor(d.getTime() / 1000);
  const until = Math.floor(d.getTime() / 1000) + 86400;

  const safeJson = async (res: Response) => {
    try { return await res.json(); } catch { return {}; }
  };

  const [accountRes, insightsRes, engagedRes] = await Promise.all([
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}?fields=followers_count,follows_count&access_token=${token}`),
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=reach,follower_count,follows_and_unfollows,profile_links_taps,website_clicks,views&period=day&since=${since}&until=${until}&access_token=${token}`),
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=accounts_engaged,total_interactions&metric_type=total_value&period=day&since=${since}&until=${until}&access_token=${token}`),
  ]);

  const [accountData, insightsData, engagedData] = await Promise.all([
    safeJson(accountRes), safeJson(insightsRes), safeJson(engagedRes),
  ]);

  const insightMap: Record<string, number[]> = {};
  for (const metric of insightsData?.data || []) {
    insightMap[metric.name] = (metric.values || []).map((v: any) => v.value || 0);
  }
  const sum = (arr: number[]) => (arr || []).reduce((a, b) => a + b, 0);

  const engagedTotal = (engagedData?.data || []).reduce((acc: number, m: any) => {
    return acc + (m.total_value?.value || 0);
  }, 0);

  return {
    ig_reach:              sum(insightMap['reach'] || []) || null,
    ig_followers:          accountData.followers_count ?? null,
    ig_following:          accountData.follows_count ?? null,
    ig_views:              sum(insightMap['views'] || []) || null,
    ig_follows_unfollows:  sum(insightMap['follows_and_unfollows'] || []) || null,
    ig_profile_taps:       sum(insightMap['profile_links_taps'] || []) || null,
    ig_website_clicks:     sum(insightMap['website_clicks'] || []) || null,
    ig_accounts_engaged:   engagedTotal || null,
    ig_total_interactions: engagedTotal || null,
    ig_lead_count:         null,
    ig_response_rate:      null,
  };
}

// ── Fetch backfill 30j (métriques agrégées par jour) ─────────────────────────
// Retourne un tableau de snapshots jour par jour sur les 30 derniers jours.
// Utilisé une seule fois lors du OAuth callback.

export async function fetchIgBackfill30d(
  creds: IgCreds
): Promise<IgDaySnapshot[]> {
  const { token, igAccountId } = creds;

  const since30 = Math.floor((Date.now() - 31 * 24 * 60 * 60 * 1000) / 1000);
  const until = Math.floor(Date.now() / 1000);

  const safeJson = async (res: Response) => {
    try { return await res.json(); } catch { return {}; }
  };

  const [accountRes, insightsRes, engagedRes] = await Promise.all([
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}?fields=followers_count,follows_count&access_token=${token}`),
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=reach,follower_count,follows_and_unfollows,profile_links_taps,website_clicks,views&period=day&since=${since30}&until=${until}&access_token=${token}`),
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=accounts_engaged,total_interactions&metric_type=total_value&period=day&since=${since30}&until=${until}&access_token=${token}`),
  ]);

  const [accountData, insightsData, engagedData] = await Promise.all([
    safeJson(accountRes), safeJson(insightsRes), safeJson(engagedRes),
  ]);

  // Reconstruit un tableau indexé par date depuis les values
  const byDate: Record<string, Record<string, number>> = {};

  for (const metric of insightsData?.data || []) {
    for (const val of metric.values || []) {
      // end_time format: "2026-06-06T07:00:00+0000"
      const iso = val.end_time?.split('T')[0];
      if (!iso) continue;
      if (!byDate[iso]) byDate[iso] = {};
      byDate[iso][metric.name] = (byDate[iso][metric.name] || 0) + (val.value || 0);
    }
  }

  // engaged/total_interactions (total_value) — non décomposé par jour via cette API,
  // on l'ignore pour le backfill historique (sera 0 sur toutes les rows)
  // Les valeurs actuelles seront remplies par le cron J-1

  const followers = accountData.followers_count ?? null;
  const following = accountData.follows_count ?? null;

  return Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, metrics]) => ({
      date,
      ig_reach:              metrics['reach'] ?? null,
      ig_followers:          followers,
      ig_following:          following,
      ig_views:              metrics['views'] ?? null,
      ig_follows_unfollows:  metrics['follows_and_unfollows'] ?? null,
      ig_profile_taps:       metrics['profile_links_taps'] ?? null,
      ig_website_clicks:     metrics['website_clicks'] ?? null,
      ig_accounts_engaged:   null,
      ig_total_interactions: null,
      ig_lead_count:         null,
      ig_response_rate:      null,
    }));
}

// ── Upsert snapshot dans Supabase ────────────────────────────────────────────

// ── Poll leads (DMs + commentaires) ──────────────────────────────────────────

export async function pollIgLeads(
  profileId: string,
  token: string,
  igAccountId: string,
  since: Date,
): Promise<{ leadsFound: number; error?: string }> {
  // Récupère les keywords actifs pour ce profil
  const { data: kwRows } = await serviceSupabase
    .from('lead_magnet_keywords')
    .select('keyword')
    .eq('profile_id', profileId);

  const keywords = (kwRows || []).map((r: any) => r.keyword as string);
  if (!keywords.length) return { leadsFound: 0 };

  const allLeads: any[] = [];

  // ── DMs ──
  try {
    const threadsRes = await fetch(
      `https://graph.instagram.com/v21.0/${igAccountId}/conversations?fields=id,updated_time,participants,message_count&limit=50&access_token=${token}`
    );
    const threadsData = await threadsRes.json();
    const threads = (threadsData.data || []).filter(
      (t: any) => new Date(t.updated_time).getTime() > since.getTime()
    );
    await Promise.all(threads.map(async (thread: any) => {
      const msgRes = await fetch(
        `https://graph.instagram.com/v21.0/${thread.id}/messages?fields=id,message,from,created_time&limit=20&access_token=${token}`
      );
      const msgData = await msgRes.json();
      for (const msg of msgData?.data || []) {
        if (!msg.message || msg.from?.id === igAccountId) continue;
        const text = msg.message.toLowerCase();
        for (const kw of keywords) {
          if (text.includes(kw.toLowerCase())) {
            const participant = thread.participants?.data?.find((p: any) => p.id !== igAccountId);
            allLeads.push({
              profile_id: profileId, source: 'dm',
              ig_username: participant?.username || participant?.name || null,
              ig_user_id: msg.from?.id ? String(msg.from.id) : null,
              message: msg.message.slice(0, 500),
              media_id: thread.id, media_permalink: null,
              keyword_matched: kw,
              detected_at: new Date(msg.created_time).toISOString(),
            });
            break;
          }
        }
      }
    }));
  } catch {}

  // ── Commentaires ──
  try {
    const mediaRes = await fetch(
      `https://graph.instagram.com/v21.0/${igAccountId}/media?fields=id,permalink,timestamp&limit=20&access_token=${token}`
    );
    const mediaData = await mediaRes.json();
    const recentMedia = (mediaData.data || []).filter(
      (m: any) => new Date(m.timestamp).getTime() > since.getTime() - 90 * 24 * 60 * 60 * 1000
    );
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
          if (text.includes(kw.toLowerCase())) {
            allLeads.push({
              profile_id: profileId, source: 'comment',
              ig_username: comment.from?.username || comment.username || null,
              ig_user_id: comment.from?.id ? String(comment.from.id) : null,
              message: comment.text.slice(0, 500),
              media_id: media.id, media_permalink: media.permalink || null,
              keyword_matched: kw,
              detected_at: new Date(comment.timestamp).toISOString(),
            });
            break;
          }
        }
      }
    }));
  } catch {}

  if (!allLeads.length) return { leadsFound: 0 };

  try {
    await serviceSupabase.from('instagram_leads').upsert(allLeads, {
      onConflict: 'profile_id,ig_user_id', ignoreDuplicates: false,
    });
    const historyRows = allLeads.filter(l => l.ig_user_id).map(l => ({
      profile_id: l.profile_id, ig_username: l.ig_username, ig_user_id: l.ig_user_id,
      keyword_matched: l.keyword_matched, media_id: l.media_id,
      lm_url: null, lead_magnet_sent: false, detected_at: l.detected_at,
    }));
    if (historyRows.length) {
      await serviceSupabase.from('instagram_lead_lm_history').insert(historyRows);
    }
    await serviceSupabase.from('integrations')
      .update({ last_ig_poll: new Date().toISOString() })
      .eq('profile_id', profileId).eq('provider', 'instagram');
  } catch (e: any) {
    return { leadsFound: 0, error: e?.message };
  }

  return { leadsFound: allLeads.length };
}

export async function upsertIgSnapshot(
  profileId: string,
  snapshot: IgDaySnapshot,
  source: 'backfill' | 'cron' | 'refresh_partial'
): Promise<string | null> {
  const { error } = await serviceSupabase
    .from('analytics_daily_snapshots')
    .upsert({
      profile_id: profileId,
      date: snapshot.date,
      ig_reach:              snapshot.ig_reach,
      ig_followers:          snapshot.ig_followers,
      ig_following:          snapshot.ig_following,
      ig_views:              snapshot.ig_views,
      ig_follows_unfollows:  snapshot.ig_follows_unfollows,
      ig_profile_taps:       snapshot.ig_profile_taps,
      ig_website_clicks:     snapshot.ig_website_clicks,
      ig_accounts_engaged:   snapshot.ig_accounts_engaged,
      ig_total_interactions: snapshot.ig_total_interactions,
      ig_lead_count:         snapshot.ig_lead_count,
      ig_response_rate:      snapshot.ig_response_rate,
      backfill_source:       source,
    }, { onConflict: 'profile_id,date', ignoreDuplicates: false });

  return error?.message ?? null;
}
