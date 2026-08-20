// Edge Function Supabase — poll-stories
// Toutes les 30 min (cron-job.org, Authorization: Bearer CRON_SECRET) :
// liste les stories actives de chaque profil connecté Instagram, télécharge le
// visuel dans le bucket "ig-stories" (une seule fois par story), et snapshotte
// les insights avant expiration de la story (fenêtre ~24-48h côté Meta).
// Pattern calqué sur supabase/functions/poll-leads/index.ts.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { mapWithConcurrency } from '../_shared/rate-limit.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET')!;

const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function safeJson(res: Response): Promise<any> {
  try { return await res.json(); } catch { return {}; }
}

function isoDateParis(): string {
  // Même logique que poll-leads/index.ts (offset Paris dupliqué faute d'import
  // cross-runtime entre cette Edge Function et lib/timezone.ts côté Next.js).
  function lastSundayOfMonth(year: number, month: number): number {
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const lastDate = new Date(Date.UTC(year, month, lastDay));
    return lastDay - lastDate.getUTCDay();
  }
  const now = new Date();
  const year = now.getUTCFullYear();
  const dstStart = Date.UTC(year, 2, lastSundayOfMonth(year, 2), 1, 0, 0);
  const dstEnd = Date.UTC(year, 9, lastSundayOfMonth(year, 9), 1, 0, 0);
  const offsetHours = now.getTime() >= dstStart && now.getTime() < dstEnd ? 2 : 1;
  const parisNow = new Date(now.getTime() + offsetHours * 3600_000);
  return parisNow.toISOString().split('T')[0];
}

async function getIgCreds(profileId: string): Promise<{ token: string; igAccountId: string } | null> {
  const { data: integ } = await supa
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
    const r = await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${token}`);
    const d = await safeJson(r);
    if (d.access_token) {
      token = d.access_token;
      const expiresAt = d.expires_in ? new Date(Date.now() + d.expires_in * 1000).toISOString() : null;
      await supa.from('integrations').update({ access_token: token, expires_at: expiresAt })
        .eq('profile_id', profileId).eq('provider', 'instagram');
    }
  }

  const igAccountId: string | null = (integ.metadata as any)?.ig_account_id || null;
  if (!igAccountId) return null;
  return { token, igAccountId };
}

// Télécharge le visuel une seule fois par story (jamais re-téléchargé si déjà en
// bucket — le visuel d'une story ne change pas dans le temps, contrairement aux
// insights qui doivent être re-pollés jusqu'à expiration).
async function ensureStoryMediaStored(profileId: string, igStoryId: string, mediaUrl: string | null): Promise<{ storagePath: string | null; storageUrl: string | null }> {
  if (!mediaUrl) return { storagePath: null, storageUrl: null };

  const ext = mediaUrl.includes('.mp4') || mediaUrl.includes('video') ? 'mp4' : 'jpg';
  const path = `${profileId}/${igStoryId}.${ext}`;

  const { data: existing } = await supa.storage.from('ig-stories').list(profileId, { search: `${igStoryId}.${ext}` });
  if (existing?.some(f => f.name === `${igStoryId}.${ext}`)) {
    const { data: { publicUrl } } = supa.storage.from('ig-stories').getPublicUrl(path);
    return { storagePath: path, storageUrl: publicUrl };
  }

  try {
    const mediaRes = await fetch(mediaUrl);
    if (!mediaRes.ok) return { storagePath: null, storageUrl: null };
    const buf = await mediaRes.arrayBuffer();
    const { error } = await supa.storage.from('ig-stories')
      .upload(path, buf, { contentType: ext === 'mp4' ? 'video/mp4' : 'image/jpeg', upsert: true });
    if (error) return { storagePath: null, storageUrl: null };
    const { data: { publicUrl } } = supa.storage.from('ig-stories').getPublicUrl(path);
    return { storagePath: path, storageUrl: publicUrl };
  } catch {
    return { storagePath: null, storageUrl: null };
  }
}

// Appels isolés par groupe de metrics — une metric refusée par Meta (ex: "reposts"
// rejeté en test réel le 2026-07-25) n'invalide pas les autres groupes.
async function safeStoryInsights(storyId: string, token: string, metrics: string): Promise<Record<string, number>> {
  try {
    const r = await fetch(`https://graph.instagram.com/v22.0/${storyId}/insights?metric=${metrics}&access_token=${token}`);
    const d = r.ok ? await safeJson(r) : {};
    if (d?.error || !d?.data) return {};
    const out: Record<string, number> = {};
    for (const m of d.data) out[m.name] = m.values?.[0]?.value ?? m.total_value?.value ?? 0;
    return out;
  } catch { return {}; }
}

async function pollProfileStories(profileId: string, token: string, igAccountId: string): Promise<{ found: number; errors: string[] }> {
  const errors: string[] = [];
  let found = 0;

  const storiesRes = await fetch(`https://graph.instagram.com/v22.0/${igAccountId}/stories?fields=id,media_type,media_url,permalink,timestamp&access_token=${token}`);
  if (!storiesRes.ok) return { found: 0, errors: [`stories_fetch: HTTP ${storiesRes.status}`] };
  const storiesData = await safeJson(storiesRes);
  const activeStories: any[] = storiesData?.data || [];
  const activeIds = new Set(activeStories.map(s => String(s.id)));

  await Promise.allSettled(activeStories.map(async (story) => {
    try {
      const igStoryId = String(story.id);
      const { data: existingRow } = await supa.from('ig_stories')
        .select('id, storage_path, first_seen_at')
        .eq('profile_id', profileId).eq('ig_story_id', igStoryId).maybeSingle();

      let storagePath = existingRow?.storage_path ?? null;
      let storageUrl: string | null = null;
      if (!storagePath) {
        const stored = await ensureStoryMediaStored(profileId, igStoryId, story.media_url || null);
        storagePath = stored.storagePath;
        storageUrl = stored.storageUrl;
      } else {
        const { data: { publicUrl } } = supa.storage.from('ig-stories').getPublicUrl(storagePath);
        storageUrl = publicUrl;
      }

      const { error: upsertErr } = await supa.from('ig_stories').upsert({
        profile_id: profileId,
        ig_story_id: igStoryId,
        media_type: story.media_type || null,
        storage_path: storagePath,
        storage_url: storageUrl,
        permalink: story.permalink || null,
        posted_at: story.timestamp ? new Date(story.timestamp).toISOString() : new Date().toISOString(),
        ig_account_id: igAccountId,
      }, { onConflict: 'profile_id,ig_story_id', ignoreDuplicates: false });
      if (upsertErr) { errors.push(`ig_stories_upsert_${igStoryId}: ${upsertErr.message}`); return; }

      found++;

      // Insights — reposts/total_views/link_clicks volontairement exclus : rejetés par
      // l'API en test réel (2026-07-25) malgré la doc Meta qui les liste comme valides
      // pour STORY ("The metric total_views is not available on this endpoint.", idem
      // link_clicks). Colonnes DB conservées (toujours null) au cas où Meta les active un jour.
      const m: Record<string, number> = {};
      Object.assign(m, await safeStoryInsights(igStoryId, token, 'reach,shares,views,follows,profile_visits,total_interactions'));

      // Format confirmé empiriquement le 2026-07-25 (voir /api/instagram/test-stories) :
      // total_value.breakdowns[0].results[] avec dimension_values en snake_case minuscule
      // ("tap_exit", "tap_forward", "swipe_forward"), pas en majuscules comme documenté.
      let tapsForward: number | null = null, tapsBack: number | null = null, exits: number | null = null;
      try {
        const navRes = await fetch(`https://graph.instagram.com/v22.0/${igStoryId}/insights?metric=navigation&breakdown=story_navigation_action_type&access_token=${token}`);
        const navData = navRes.ok ? await safeJson(navRes) : {};
        const navValue = navData?.data?.[0];
        const breakdownResults = navValue?.total_value?.breakdowns?.[0]?.results || [];
        for (const r of breakdownResults) {
          const type = r.dimension_values?.[0];
          const val = r.value ?? 0;
          if (type === 'tap_forward' || type === 'swipe_forward') tapsForward = (tapsForward ?? 0) + val;
          if (type === 'tap_back') tapsBack = (tapsBack ?? 0) + val;
          if (type === 'tap_exit') exits = (exits ?? 0) + val;
        }
      } catch { /* non bloquant — breakdown non dispo */ }

      const { error: historyErr } = await supa.from('analytics_ig_stories_history').upsert({
        profile_id: profileId,
        ig_story_id: igStoryId,
        reach: m['reach'] ?? null,
        shares: m['shares'] ?? null,
        views: m['views'] ?? null,
        total_views: null, // metric rejetée par l'API sur cet endpoint — colonne conservée pour usage futur
        follows: m['follows'] ?? null,
        profile_visits: m['profile_visits'] ?? null,
        total_interactions: m['total_interactions'] ?? null,
        navigation_taps_forward: tapsForward,
        navigation_taps_back: tapsBack,
        navigation_exits: exits,
        snapshot_date: isoDateParis(),
        snapshot_at: new Date().toISOString(),
        ig_account_id: igAccountId,
      }, { onConflict: 'profile_id,ig_story_id,snapshot_date', ignoreDuplicates: false });
      if (historyErr) errors.push(`analytics_history_upsert_${igStoryId}: ${historyErr.message}`);
    } catch (e: any) {
      errors.push(`story_${story.id}: ${e?.message || 'unknown'}`);
    }
  }));

  // Marquer expired_at sur les stories qui ne réapparaissent plus dans /stories
  // après >48h — sans les supprimer, la card reste affichable via storage_url.
  try {
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    // ig_account_id + archived_at : `activeIds` ne contient que les stories du compte
    // actuellement connecté. Sans ces deux filtres, les stories d'un compte précédent
    // — absentes de cette API par construction — étaient marquées expirées à tort. Et
    // comme expired_at n'est jamais remis à null, le retour sur l'ancien compte les
    // désarchivait sans jamais les « désexpirer » : corruption définitive.
    // Même garde que supabase/functions/_shared/ig-posts.ts, qui documente ce piège
    // pour les posts sans qu'il ait été transposé ici.
    const { data: staleStories } = await supa.from('ig_stories')
      .select('id, ig_story_id')
      .eq('profile_id', profileId)
      .eq('ig_account_id', igAccountId)
      .is('archived_at', null)
      .is('expired_at', null)
      .lt('posted_at', cutoff);
    const toExpire = (staleStories || []).filter(s => !activeIds.has(s.ig_story_id));
    if (toExpire.length) {
      await supa.from('ig_stories').update({ expired_at: new Date().toISOString() }).in('id', toExpire.map(s => s.id));
    }
  } catch (e: any) {
    errors.push(`expire_stale: ${e?.message || 'unknown'}`);
  }

  return { found, errors };
}

Deno.serve(async (req: Request) => {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: 'Non autorisé' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const { data: integrations } = await supa.from('integrations').select('profile_id').eq('provider', 'instagram');
  if (!integrations?.length) return new Response(JSON.stringify({ polled: 0 }), { headers: { 'Content-Type': 'application/json' } });

  const runMain = async () => {
    const allErrors: Record<string, string[]> = {};
    let polled = 0, storiesFound = 0;

    // Concurrence bornée à 5 : chaque profil déclenche 2-3 appels Meta par story
    // (liste, insights, téléchargement du média). Ces appels partagent le quota
    // Graph avec poll-leads, qui tourne sur les mêmes comptes — un Promise.all non
    // borné à 30 élèves émettait ~450 requêtes en rafale sur ce même quota.
    await mapWithConcurrency(integrations, 5, async ({ profile_id }) => {
      try {
        const creds = await getIgCreds(profile_id);
        if (!creds) return;
        const { found, errors } = await pollProfileStories(profile_id, creds.token, creds.igAccountId);
        polled++;
        storiesFound += found;
        if (errors.length) allErrors[profile_id] = errors;
      } catch (e: any) {
        allErrors[profile_id] = [`profile_failed: ${e?.message || 'unknown'}`];
      }
    });

    if (Object.keys(allErrors).length) {
      console.error('poll-stories errors', JSON.stringify(allErrors));
    }
  };

  // .catch() OBLIGATOIRE : la réponse 202 est déjà partie quand runMain s'exécute,
  // donc une exception non capturée ici ne remonte NULLE PART — ni au client, ni
  // dans les logs. La fonction pouvait échouer silencieusement à chaque cycle sans
  // qu'aucun signal ne l'indique. poll-leads a ce catch, pas poll-stories.
  (globalThis as any).EdgeRuntime?.waitUntil(
    runMain().catch((e: any) => console.error('[poll-stories] runMain_fatal:', e?.message || e))
  );

  return new Response(JSON.stringify({ status: 'accepted' }), { status: 202, headers: { 'Content-Type': 'application/json' } });
});
