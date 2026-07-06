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
  ig_reach_follower: number | null;
  ig_reach_non_follower: number | null;
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

  const [accountRes, insightsRes, engagedRes, reachBreakdownRes] = await Promise.all([
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}?fields=followers_count,follows_count&access_token=${token}`),
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=reach,follower_count,follows_and_unfollows,profile_links_taps,website_clicks,views&period=day&since=${since}&until=${until}&access_token=${token}`),
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=accounts_engaged,total_interactions&metric_type=total_value&period=day&since=${since}&until=${until}&access_token=${token}`),
    // reach + breakdown follow_type ne renvoie un vrai détail (pas un agrégat collapsé)
    // que sur une fenêtre d'UN jour — confirmé en testant l'API réelle. C'est pour ça
    // que ce breakdown est fetché ici (jour par jour) et pas dans la vue live 30j.
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=reach&metric_type=total_value&breakdown=follow_type&period=day&since=${since}&until=${until}&access_token=${token}`),
  ]);

  const [accountData, insightsData, engagedData, reachBreakdownData] = await Promise.all([
    safeJson(accountRes), safeJson(insightsRes), safeJson(engagedRes), safeJson(reachBreakdownRes),
  ]);

  const insightMap: Record<string, number[]> = {};
  for (const metric of insightsData?.data || []) {
    insightMap[metric.name] = (metric.values || []).map((v: any) => v.value || 0);
  }
  const sum = (arr: number[]) => (arr || []).reduce((a, b) => a + b, 0);

  // engagedData contient 2 métriques distinctes dans le même appel (accounts_engaged
  // ET total_interactions) — un .reduce() sur tout le tableau sans distinguer m.name
  // additionnait les deux valeurs ensemble et assignait cette somme aux deux colonnes
  // (bug trouvé le 2026-07-06 : taux d'engagement quotidien explosant à 400%+ sur les
  // jours à faible reach, ig_accounts_engaged et ig_total_interactions identiques en DB
  // alors que ce sont deux métriques Meta différentes par définition).
  let accountsEngagedTotal = 0;
  let totalInteractionsTotal = 0;
  for (const m of (engagedData?.data || [])) {
    const v = m.total_value?.value || 0;
    if (m.name === 'accounts_engaged') accountsEngagedTotal += v;
    else if (m.name === 'total_interactions') totalInteractionsTotal += v;
  }

  let reachFollower: number | null = null;
  let reachNonFollower: number | null = null;
  for (const metric of reachBreakdownData?.data || []) {
    if (metric.name === 'reach' && metric.total_value?.breakdowns) {
      let follower = 0, nonFollower = 0, found = false;
      for (const bd of metric.total_value.breakdowns) {
        for (const r of bd.results || []) {
          const key = r.dimension_values?.[0];
          if (key === 'FOLLOWER') { follower += r.value || 0; found = true; }
          else if (key === 'NON_FOLLOWER') { nonFollower += r.value || 0; found = true; }
        }
      }
      if (found) { reachFollower = follower; reachNonFollower = nonFollower; }
    }
  }

  return {
    ig_reach:              sum(insightMap['reach'] || []) || null,
    ig_followers:          accountData.followers_count ?? null,
    ig_following:          accountData.follows_count ?? null,
    ig_views:              sum(insightMap['views'] || []) || null,
    ig_follows_unfollows:  sum(insightMap['follows_and_unfollows'] || []) || null,
    ig_profile_taps:       sum(insightMap['profile_links_taps'] || []) || null,
    ig_website_clicks:     sum(insightMap['website_clicks'] || []) || null,
    ig_accounts_engaged:   accountsEngagedTotal || null,
    ig_total_interactions: totalInteractionsTotal || null,
    ig_lead_count:         null,
    ig_response_rate:      null,
    ig_reach_follower:     reachFollower,
    ig_reach_non_follower: reachNonFollower,
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
      // Non backfillable rétroactivement en un seul appel (le breakdown follow_type sur
      // reach ne renvoie un vrai détail que sur une fenêtre d'un jour, cf. fetchIgDayMetrics)
      // — l'historique de cette métrique ne démarre qu'à partir du prochain cron/refresh.
      ig_reach_follower:     null,
      ig_reach_non_follower: null,
    }));
}

// ── Upsert snapshot dans Supabase ────────────────────────────────────────────

// ── Poll commentaires (backup webhook — détecte nouveaux leads) ───────────────
// Ne crée des leads que depuis les commentaires. Keywords lus depuis content_links.
// Déduplication atomique via INSERT lm_history ON CONFLICT DO NOTHING.

export async function pollIgComments(
  profileId: string,
  token: string,
  igAccountId: string,
  since: Date,
): Promise<{ leadsFound: number; error?: string }> {
  // Lire les content_links avec keyword configuré (source de vérité)
  const { data: contentLinks } = await serviceSupabase
    .from('content_links')
    .select('content_id, lm_keyword, lm_short_url, dm_opener_message, dm_lm_message, dm_button_text')
    .eq('profile_id', profileId)
    .not('lm_keyword', 'is', null)
    .not('lm_short_url', 'is', null);

  if (!contentLinks?.length) return { leadsFound: 0 };

  // Map content_id (media_id IG) → config LM
  const clByMedia = new Map<string, typeof contentLinks[0]>();
  for (const cl of contentLinks) {
    if (cl.content_id) clByMedia.set(cl.content_id, cl);
  }

  // Fenêtre max 48h pour le poll backup (évite de spammer des leads anciens)
  const sinceMs = Math.max(since.getTime(), Date.now() - 48 * 60 * 60 * 1000);
  const sinceDate = new Date(sinceMs);

  let leadsFound = 0;

  try {
    const mediaRes = await fetch(
      `https://graph.instagram.com/v21.0/${igAccountId}/media?fields=id,permalink,timestamp&limit=30&access_token=${token}`
    );
    const mediaData = await mediaRes.json();
    // Médias des 90 derniers jours max (pour couvrir les posts avec LM)
    const recentMedia = (mediaData.data || []).filter(
      (m: any) => new Date(m.timestamp).getTime() > Date.now() - 90 * 24 * 60 * 60 * 1000
    );

    for (const media of recentMedia) {
      const cl = clByMedia.get(media.id);
      if (!cl) continue; // ce post n'a pas de LM configuré

      const commRes = await fetch(
        `https://graph.instagram.com/v21.0/${media.id}/comments?fields=id,text,timestamp,from,username&limit=50&access_token=${token}`
      );
      const commData = await commRes.json();
      if (commData.error) continue;

      for (const comment of commData.data || []) {
        if (!comment.text) continue;
        if (new Date(comment.timestamp).getTime() < sinceDate.getTime()) continue;

        const text = comment.text.toLowerCase().trim();
        if (!text.includes(cl.lm_keyword!.toLowerCase())) continue;

        const commenterId = comment.from?.id ? String(comment.from.id) : null;
        if (!commenterId) continue;

        const commenterUsername = comment.from?.username || comment.username || '';
        const detectedAt = new Date(comment.timestamp).toISOString();

        // Dédup atomique : INSERT lm_history ON CONFLICT DO NOTHING
        // Si count = 0 → déjà traité → skip
        const { count } = await serviceSupabase
          .from('instagram_lead_lm_history')
          .insert({
            profile_id: profileId,
            ig_username: commenterUsername || '',
            ig_user_id: commenterId,
            keyword_matched: cl.lm_keyword,
            media_id: media.id,
            lm_url: cl.lm_short_url || null,
            lead_magnet_sent: false,
            detected_at: detectedAt,
          }, { count: 'exact' })
          .select();

        // Si la contrainte UNIQUE a joué → l'insert retourne 0 rows → déjà traité
        if (!count || count === 0) continue;

        leadsFound++;

        // Upsert lead
        await serviceSupabase.from('instagram_leads').upsert({
          profile_id: profileId,
          source: 'comment',
          ig_username: commenterUsername || null,
          ig_user_id: commenterId,
          message: comment.text.slice(0, 500),
          media_id: media.id,
          media_permalink: media.permalink || null,
          keyword_matched: cl.lm_keyword,
          detected_at: detectedAt,
          lead_magnet_sent: false,
          tracking_link: cl.lm_short_url || null,
        }, { onConflict: 'profile_id,ig_user_id', ignoreDuplicates: false });

        // Envoyer DM LM (backup — le webhook l'a peut-être déjà envoyé)
        // DM1 : accroche SANS le lien + bouton Quick Reply
        // DM2 (lien) et DM3 (ouverture) stockés en pending_dm2/pending_dm3, envoyés après clic du bouton
        if (cl.lm_short_url && cl.dm_lm_message) {
          const dm1Text = (cl.dm_lm_message || 'Clique sur le bouton pour recevoir le lien !')
            .replace(/\{\{lien_lm\}\}/gi, '')
            .replace(/{{username}}/gi, `@${commenterUsername || 'toi'}`)
            .replace(/\s{2,}/g, ' ')
            .trim();
          const dm2Text = cl.lm_short_url;
          const dm3Text = (cl.dm_opener_message || '').replace(/{{username}}/gi, `@${commenterUsername || 'toi'}`).trim();
          const buttonText = (cl.dm_button_text || '🚀 Je veux le lien !').slice(0, 20);
          try {
            await fetch(
              `https://graph.instagram.com/v21.0/${igAccountId}/messages`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  recipient: { comment_id: comment.id },
                  messaging_type: 'RESPONSE',
                  message: {
                    text: dm1Text,
                    quick_replies: [
                      {
                        content_type: 'text',
                        title: buttonText,
                        payload: 'LM_LINK_CLICKED',
                      },
                    ],
                  },
                  access_token: token,
                }),
              }
            );
            // Mettre à jour pending_dm2/pending_dm3 sur le lead déjà upsert
            await serviceSupabase.from('instagram_leads')
              .update({ pending_dm2: dm2Text, pending_dm3: dm3Text || null })
              .eq('profile_id', profileId)
              .eq('ig_user_id', commenterId);
          } catch {}
        }
      }
    }
  } catch (e: any) {
    return { leadsFound, error: e?.message };
  }

  if (leadsFound > 0) {
    await serviceSupabase.from('integrations')
      .update({ last_ig_poll: new Date().toISOString() })
      .eq('profile_id', profileId).eq('provider', 'instagram');
  }

  return { leadsFound };
}

// ── Poll DMs (backup webhook — détecte hook_replied manqués) ─────────────────
// Ne crée JAMAIS de nouveaux leads. Pas de keyword matching.
// Cherche seulement les leads existants qui ont reçu un LM mais pas encore répondu.

export async function pollIgHookReplied(
  profileId: string,
  token: string,
  igAccountId: string,
): Promise<{ updated: number; error?: string }> {
  let updated = 0;

  try {
    const threadsRes = await fetch(
      `https://graph.instagram.com/v21.0/${igAccountId}/conversations?fields=id,updated_time,participants,message_count&limit=50&access_token=${token}`
    );
    const threadsData = await threadsRes.json();

    const since48h = Date.now() - 48 * 60 * 60 * 1000;
    const recentThreads = (threadsData.data || []).filter(
      (t: any) => new Date(t.updated_time).getTime() > since48h
    );

    await Promise.all(recentThreads.map(async (thread: any) => {
      const participant = thread.participants?.data?.find((p: any) => p.id !== igAccountId);
      if (!participant?.id) return;

      const participantId = String(participant.id);

      // Chercher si ce participant est un lead avec LM envoyé mais hook_replied=false
      const { data: leadToUpdate } = await serviceSupabase
        .from('instagram_leads')
        .select('id, hook_replied, hook_replied_at')
        .eq('profile_id', profileId)
        .eq('ig_user_id', participantId)
        .eq('lead_magnet_sent', true)
        .eq('hook_replied', false)
        .maybeSingle();

      if (!leadToUpdate || leadToUpdate.hook_replied_at) return;

      // Fetch les messages du thread pour trouver le premier message du lead
      const msgRes = await fetch(
        `https://graph.instagram.com/v21.0/${thread.id}/messages?fields=id,message,from,created_time&limit=20&access_token=${token}`
      );
      const msgData = await msgRes.json();

      // Trouver le premier message envoyé par le lead (from.id !== igAccountId)
      const leadMessages = (msgData?.data || [])
        .filter((m: any) => m.from?.id && String(m.from.id) !== igAccountId && m.message)
        .sort((a: any, b: any) => new Date(a.created_time).getTime() - new Date(b.created_time).getTime());

      if (!leadMessages.length) return;

      const firstReply = leadMessages[0];
      await serviceSupabase.from('instagram_leads')
        .update({
          hook_replied: true,
          hook_reply_text: firstReply.message?.slice(0, 500) ?? null,
          hook_replied_at: new Date(firstReply.created_time).toISOString(),
        })
        .eq('id', leadToUpdate.id);

      updated++;
    }));
  } catch (e: any) {
    return { updated, error: e?.message };
  }

  return { updated };
}

export async function upsertIgSnapshot(
  profileId: string,
  snapshot: IgDaySnapshot,
  source: 'backfill' | 'cron' | 'refresh_partial'
): Promise<string | null> {
  // ig_followers/ig_following viennent du endpoint compte (followers_count), qui
  // reflète toujours l'état ACTUEL du compte, jamais une valeur historique pour la
  // date demandée — contrairement à reach/accounts_engaged/total_interactions qui
  // sont de vraies métriques period=day. Un backfill/refresh rétroactif écraserait
  // sinon l'historique réel (déjà collecté par le vrai cron J-1) avec le nombre
  // d'abonnés d'AUJOURD'HUI sur toutes les dates rejouées (bug survenu le 2026-07-06,
  // 60 jours d'historique aplatis à la même valeur avant d'être restaurés à la main).
  // Seul le cron J-1 (qui interroge un jour réellement récent) est autorisé à écrire
  // ces deux colonnes.
  const row: Record<string, any> = {
    profile_id: profileId,
    date: snapshot.date,
    ig_reach:              snapshot.ig_reach,
    ig_views:              snapshot.ig_views,
    ig_follows_unfollows:  snapshot.ig_follows_unfollows,
    ig_profile_taps:       snapshot.ig_profile_taps,
    ig_website_clicks:     snapshot.ig_website_clicks,
    ig_accounts_engaged:   snapshot.ig_accounts_engaged,
    ig_total_interactions: snapshot.ig_total_interactions,
    ig_lead_count:         snapshot.ig_lead_count,
    ig_response_rate:      snapshot.ig_response_rate,
    ig_reach_follower:     snapshot.ig_reach_follower,
    ig_reach_non_follower: snapshot.ig_reach_non_follower,
    backfill_source:       source,
  };
  if (source !== 'backfill') {
    row.ig_followers = snapshot.ig_followers;
    row.ig_following = snapshot.ig_following;
  }

  const { error } = await serviceSupabase
    .from('analytics_daily_snapshots')
    .upsert(row, { onConflict: 'profile_id,date', ignoreDuplicates: false });

  return error?.message ?? null;
}
