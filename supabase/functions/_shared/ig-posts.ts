// Module partagé — snapshot des posts Instagram individuels (analytics_ig_posts_history)
// Importé par poll-leads/index.ts (cron régulier, guard 1x/jour) ET refresh-ig-posts/index.ts
// (bouton "Actualiser" du frontend, ciblé sur un seul profil, skipGuard=true).
// Une seule source de vérité — ne pas dupliquer ce code dans une autre Edge Function.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export async function safeJson(res: Response): Promise<any> {
  try { return await res.json(); } catch { return {}; }
}

export async function getIgCreds(supa: SupabaseClient, profileId: string): Promise<{ token: string; igAccountId: string } | null> {
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

const permanentThumbnailCache = new Map<string, string | null>();
export async function getPermanentThumbnail(supa: SupabaseClient, postId: string, metaUrl: string | null): Promise<string | null> {
  if (!metaUrl) return null;
  if (permanentThumbnailCache.has(postId)) return permanentThumbnailCache.get(postId)!;

  const path = `${postId}.jpg`;
  const { data: existing } = await supa.storage.from('instagram-post-thumbnails').list('', { search: path });
  if (existing?.some((f: any) => f.name === path)) {
    const { data: { publicUrl } } = supa.storage.from('instagram-post-thumbnails').getPublicUrl(path);
    permanentThumbnailCache.set(postId, publicUrl);
    return publicUrl;
  }

  try {
    const imgRes = await fetch(metaUrl);
    if (!imgRes.ok) {
      console.log(`[getPermanentThumbnail] ${postId} fetch metaUrl HTTP ${imgRes.status}`);
      permanentThumbnailCache.set(postId, null);
      return null;
    }
    const buf = await imgRes.arrayBuffer();
    const { error } = await supa.storage.from('instagram-post-thumbnails')
      .upload(path, buf, { contentType: 'image/jpeg', upsert: true });
    if (error) {
      console.log(`[getPermanentThumbnail] ${postId} upload storage erreur: ${error.message}`);
      permanentThumbnailCache.set(postId, null);
      return null;
    }
    const { data: { publicUrl } } = supa.storage.from('instagram-post-thumbnails').getPublicUrl(path);
    permanentThumbnailCache.set(postId, publicUrl);
    return publicUrl;
  } catch (e: any) {
    console.log(`[getPermanentThumbnail] ${postId} exception: ${e?.message || 'unknown'}`);
    permanentThumbnailCache.set(postId, null);
    return null;
  }
}

// Guard : si des snapshots existent déjà pour `yesterday`, on ne refetch pas — le cron
// régulier n'a besoin de figer les métriques qu'1x/jour. skipGuard=true (bouton
// "Actualiser" côté frontend) force le refetch pour rafraîchir la LISTE de posts
// (nouveaux publiés/supprimés) sans attendre le lendemain — l'upsert reste idempotent
// pour les métriques d'un post déjà snapshotté (Meta ne les change pas rétroactivement).
export async function snapshotIgPosts(
  supa: SupabaseClient,
  profileId: string,
  token: string,
  igAccountId: string,
  yesterday: string,
  skipGuard = false,
): Promise<string[]> {
  const errors: string[] = [];
  try {
    if (!skipGuard) {
      const { count } = await supa.from('analytics_ig_posts_history')
        .select('*', { count: 'exact', head: true })
        .eq('profile_id', profileId)
        .eq('snapshot_date', yesterday);
      if (count && count > 0) return [];
    }

    const mediaRes = await fetch(
      `https://graph.instagram.com/v22.0/${igAccountId}/media?fields=id,caption,media_type,media_product_type,thumbnail_url,media_url,timestamp,like_count,comments_count,permalink&limit=15&access_token=${token}`
    );
    if (!mediaRes.ok) return [`ig_posts_media: HTTP ${mediaRes.status}`];
    const mediaData = await safeJson(mediaRes);
    const posts: any[] = mediaData.data || [];

    // Un post absent de la réponse Meta actuelle mais présent en base (parmi les 90
    // derniers jours, fenêtre couverte par /media limit=15+90j ailleurs dans ce fichier)
    // a été supprimé côté Instagram — on le marque deleted_at plutôt que de l'effacer :
    // l'historique de stats (analytics, rapports passés) doit rester intact, seul
    // "Gérer mes liens" doit filtrer ces posts (deleted_at is null).
    // Filtre ig_account_id + archived_at IS NULL obligatoire : sinon un post d'un AUTRE
    // compte (archivé après une bascule, donc invisible mais toujours en base) se
    // retrouve marqué "supprimé" à tort dès que ce compte n'est plus le compte actif —
    // bug trouvé le 2026-07-29 en testant le cycle A→B→A (le post de A disparaissait
    // définitivement de "Gérer mes liens" après un passage par B, alors qu'il n'avait
    // jamais été supprimé sur Instagram).
    const currentPostIds = new Set(posts.map((p: any) => p.id));
    const since90d = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const { data: existingRows } = await supa.from('analytics_ig_posts_history')
      .select('post_id')
      .eq('profile_id', profileId)
      .eq('ig_account_id', igAccountId)
      .is('deleted_at', null)
      .is('archived_at', null)
      .gte('published_at', since90d);
    const missingPostIds = [...new Set((existingRows ?? []).map((r: any) => r.post_id))]
      .filter((id: string) => !currentPostIds.has(id));
    if (missingPostIds.length) {
      await supa.from('analytics_ig_posts_history')
        .update({ deleted_at: new Date().toISOString() })
        .eq('profile_id', profileId)
        .in('post_id', missingPostIds);
    }

    const snapshotAt = new Date().toISOString();

    // Un seul appel groupé (metric=a,b,c) perd TOUTES les métriques du groupe si Meta en
    // refuse ne serait-ce qu'une seule (posts trop anciens hors fenêtre de rétention
    // insights, ou publiés avant passage en compte pro) — cas fréquent sur les posts les
    // plus vieux. On appelle donc chaque métrique individuellement pour isoler les échecs :
    // une métrique refusée par Meta ne doit plus faire perdre les autres qui auraient
    // répondu normalement.
    const safeInsight = async (postId: string, metric: string): Promise<number | null> => {
      try {
        const r = await fetch(`https://graph.instagram.com/v22.0/${postId}/insights?metric=${metric}&access_token=${token}`);
        const d = r.ok ? await safeJson(r) : { error: { message: `HTTP ${r.status}` } };
        if (d?.error) return null;
        if (!d?.data?.length) return null;
        return d.data[0].values?.[0]?.value ?? d.data[0].total_value?.value ?? null;
      } catch { return null; }
    };
    const safeInsights = async (postId: string, metrics: string[]): Promise<Record<string, number>> => {
      const out: Record<string, number> = {};
      const values = await Promise.all(metrics.map(metric => safeInsight(postId, metric)));
      metrics.forEach((metric, i) => { if (values[i] !== null) out[metric] = values[i]!; });
      return out;
    };

    await Promise.allSettled(posts.map(async (post: any) => {
      const isReel = post.media_product_type === 'REELS' || post.media_type === 'VIDEO';
      try {
        const m: Record<string, number> = {};
        Object.assign(m, await safeInsights(post.id, ['reach', 'saved', 'shares', 'total_interactions', 'views']));
        if (isReel) {
          Object.assign(m, await safeInsights(post.id, ['ig_reels_avg_watch_time', 'ig_reels_video_view_total_time', 'reels_skip_rate']));
        } else {
          Object.assign(m, await safeInsights(post.id, ['follows', 'profile_visits']));
        }

        const metaThumbnailUrl = post.thumbnail_url || post.media_url || null;
        const permanentThumbnail = await getPermanentThumbnail(supa, post.id, metaThumbnailUrl);

        const row: Record<string, any> = {
          profile_id: profileId,
          post_id: post.id,
          post_type: post.media_product_type || post.media_type || 'IMAGE',
          caption: (post.caption || '').slice(0, 500),
          permalink: post.permalink || null,
          thumbnail: permanentThumbnail || metaThumbnailUrl,
          published_at: post.timestamp ? new Date(post.timestamp).toISOString() : null,
          reach: m['reach'] ?? null,
          views: m['views'] ?? null,
          likes: post.like_count ?? null,
          comments: post.comments_count ?? null,
          saves: m['saved'] ?? null,
          shares: m['shares'] ?? null,
          follows: m['follows'] ?? null,
          profile_visits: m['profile_visits'] ?? null,
          total_interactions: m['total_interactions'] ?? null,
          snapshot_date: yesterday,
          snapshot_at: snapshotAt,
          // Dé-marque explicitement si ce post avait été précédemment marqué supprimé
          // (republié, ou faux positif d'une exécution antérieure) — un post présent
          // dans la réponse Meta actuelle n'est par définition pas supprimé.
          deleted_at: null,
          ig_account_id: igAccountId,
        };
        if (isReel) {
          row.avg_watch_time_ms = m['ig_reels_avg_watch_time'] ?? null;
          row.total_watch_time_ms = m['ig_reels_video_view_total_time'] ?? null;
          row.skip_rate = m['reels_skip_rate'] ?? null;
        }

        const { error } = await supa.from('analytics_ig_posts_history').upsert(row, { onConflict: 'profile_id,post_id,snapshot_date', ignoreDuplicates: false });
        if (error) {
          errors.push(`ig_post_upsert_${post.id}: ${error.message}`);
          console.log(`[snapshotIgPosts] ${post.id} upsert ÉCHEC: ${JSON.stringify(error)}`);
        }
      } catch (e: any) {
        errors.push(`ig_post_${post.id}: ${e?.message || 'unknown'}`);
        console.log(`[snapshotIgPosts] ${post.id} EXCEPTION: ${e?.stack || e?.message || JSON.stringify(e) || 'unknown'}`);
      }
    }));
  } catch (e: any) { errors.push(`ig_posts_snapshot: ${e?.message || 'unknown'}`); }
  return errors;
}
