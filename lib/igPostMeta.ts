import { createClient } from '@supabase/supabase-js';
import { getIgCreds } from '@/lib/ig-fetch';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface IgPostMeta {
  caption: string | null;
  permalink: string | null;
  thumbnail: string | null;
}

async function fetchGraphPostMeta(mediaId: string, token: string): Promise<IgPostMeta | null> {
  try {
    const r = await fetch(
      `https://graph.instagram.com/v22.0/${mediaId}?fields=caption,permalink,thumbnail_url,media_url&access_token=${token}`
    );
    if (!r.ok) return null;
    const data = await r.json();
    if (data.error) return null;
    return {
      caption: data.caption ?? null,
      permalink: data.permalink ?? null,
      thumbnail: data.thumbnail_url ?? data.media_url ?? null,
    };
  } catch {
    return null;
  }
}

// Résout les métadonnées (légende, permalink, thumbnail) d'une liste de media_id IG :
// cache DB (ig_post_meta) en priorité, puis fetch Graph API à la demande pour les
// manquants (n'importe quel post, pas seulement les 15 plus récents du cron quotidien),
// upsert en DB pour ne jamais refetch ensuite — même principe que resolveYtVideoTitles.
export async function resolveIgPostMeta(
  profileId: string,
  mediaIds: string[],
): Promise<Record<string, IgPostMeta>> {
  const uniqueIds = [...new Set(mediaIds.filter(Boolean))];
  if (uniqueIds.length === 0) return {};

  const result: Record<string, IgPostMeta> = {};

  const { data: cached } = await serviceSupabase
    .from('ig_post_meta')
    .select('media_id, caption, permalink, thumbnail')
    .eq('profile_id', profileId)
    .in('media_id', uniqueIds);

  const missing: string[] = [];
  for (const id of uniqueIds) {
    const row = cached?.find(c => c.media_id === id);
    if (row) result[id] = { caption: row.caption, permalink: row.permalink, thumbnail: row.thumbnail };
    else missing.push(id);
  }

  if (missing.length === 0) return result;

  const creds = await getIgCreds(profileId);
  if (!creds) return result;

  const fetched = await Promise.all(missing.map(async id => ({ id, meta: await fetchGraphPostMeta(id, creds.token) })));
  const toUpsert = fetched.filter(f => f.meta);
  if (toUpsert.length === 0) return result;

  for (const { id, meta } of toUpsert) result[id] = meta!;

  await serviceSupabase.from('ig_post_meta').upsert(
    toUpsert.map(({ id, meta }) => ({
      profile_id: profileId, media_id: id,
      caption: meta!.caption, permalink: meta!.permalink, thumbnail: meta!.thumbnail,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: 'profile_id,media_id', ignoreDuplicates: false }
  );

  return result;
}
