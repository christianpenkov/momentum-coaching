import { createClient } from '@supabase/supabase-js';
import { isYtVideoId } from '@/lib/ytId';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function fetchOembedTitle(videoId: string): Promise<string | null> {
  try {
    const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const data = await r.json();
    return data.title ?? null;
  } catch {
    return null;
  }
}

// Résout les titres d'une liste de video_id : cache DB (youtube_video_ctr.title) en
// priorité, puis oEmbed pour les manquants (upsert en DB pour ne jamais refetch ensuite).
export async function resolveYtVideoTitles(
  profileId: string,
  videoIds: string[],
): Promise<Record<string, string>> {
  const uniqueIds = [...new Set(videoIds.filter(isYtVideoId))];
  if (uniqueIds.length === 0) return {};

  const titles: Record<string, string> = {};

  const { data: cached } = await serviceSupabase
    .from('youtube_video_ctr')
    .select('video_id, title')
    .eq('profile_id', profileId)
    .in('video_id', uniqueIds);

  const existingIds = new Set((cached ?? []).map(c => c.video_id));
  const missing: string[] = [];
  for (const id of uniqueIds) {
    const row = cached?.find(c => c.video_id === id);
    if (row?.title) titles[id] = row.title;
    else missing.push(id);
  }

  if (missing.length === 0) return titles;

  const fetched = await Promise.all(missing.map(async id => ({ id, title: await fetchOembedTitle(id) })));
  const toUpsert = fetched.filter(f => f.title);
  if (toUpsert.length === 0) return titles;

  for (const { id, title } of toUpsert) titles[id] = title!;

  // Lignes déjà existantes (juste sans title) : update simple, ne touche pas impressions/clicks.
  const toUpdate = toUpsert.filter(f => existingIds.has(f.id));
  await Promise.all(toUpdate.map(({ id, title }) =>
    serviceSupabase.from('youtube_video_ctr')
      .update({ title, updated_at: new Date().toISOString() })
      .eq('profile_id', profileId).eq('video_id', id)
  ));

  // Nouvelles lignes : impressions/clicks à 0 (jamais null) — upsert_yt_ctr (lib/yt-fetch.ts)
  // fait ensuite `impressions = existing.impressions + new`, une valeur null corromprait
  // silencieusement les stats CTR pour toujours.
  const toInsert = toUpsert.filter(f => !existingIds.has(f.id));
  if (toInsert.length > 0) {
    await serviceSupabase.from('youtube_video_ctr').upsert(
      toInsert.map(({ id, title }) => ({
        profile_id: profileId, video_id: id, title,
        impressions: 0, clicks: 0, updated_at: new Date().toISOString(),
      })),
      { onConflict: 'profile_id,video_id', ignoreDuplicates: false }
    );
  }

  return titles;
}
