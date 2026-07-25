import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function safeJson(res: Response): Promise<any> {
  try { return await res.json(); } catch { return {}; }
}

async function getIgCreds(profileId: string): Promise<{ token: string; igAccountId: string } | null> {
  const { data: integ } = await serviceSupabase
    .from('integrations')
    .select('access_token, expires_at, metadata')
    .eq('profile_id', profileId)
    .eq('provider', 'instagram')
    .single();
  if (!integ?.access_token) return null;
  const igAccountId: string | null = (integ.metadata as any)?.ig_account_id || null;
  if (!igAccountId) return null;
  return { token: integ.access_token, igAccountId };
}

// POST /api/client/stories/live-refresh — poll RAPIDE déclenché par le bouton "Actualiser"
// de l'onglet Stories : liste les stories actives + télécharge le visuel, SANS les insights
// (contrairement au cron poll-stories qui fait les deux) pour rester sous le timeout Vercel
// et afficher immédiatement une story qui vient d'être publiée. Les insights arrivent
// ensuite via le cron */30min.
export async function POST() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const creds = await getIgCreds(user.id);
  if (!creds) return NextResponse.json({ error: 'Instagram non connecté' }, { status: 404 });

  const storiesRes = await fetch(`https://graph.instagram.com/v22.0/${creds.igAccountId}/stories?fields=id,media_type,media_url,permalink,timestamp&access_token=${creds.token}`);
  if (!storiesRes.ok) return NextResponse.json({ error: `Erreur API Meta: HTTP ${storiesRes.status}` }, { status: 502 });
  const storiesData = await safeJson(storiesRes);
  const activeStories: any[] = storiesData?.data || [];

  let found = 0;
  await Promise.allSettled(activeStories.map(async (story) => {
    const igStoryId = String(story.id);
    const { data: existingRow } = await serviceSupabase
      .from('ig_stories')
      .select('id, storage_path')
      .eq('profile_id', user.id).eq('ig_story_id', igStoryId).maybeSingle();

    let storagePath = existingRow?.storage_path ?? null;
    let storageUrl: string | null = null;

    if (!storagePath && story.media_url) {
      const ext = story.media_url.includes('.mp4') || story.media_url.includes('video') ? 'mp4' : 'jpg';
      const path = `${user.id}/${igStoryId}.${ext}`;
      try {
        const mediaRes = await fetch(story.media_url);
        if (mediaRes.ok) {
          const buf = await mediaRes.arrayBuffer();
          const { error } = await serviceSupabase.storage.from('ig-stories')
            .upload(path, buf, { contentType: ext === 'mp4' ? 'video/mp4' : 'image/jpeg', upsert: true });
          if (!error) {
            storagePath = path;
            const { data: { publicUrl } } = serviceSupabase.storage.from('ig-stories').getPublicUrl(path);
            storageUrl = publicUrl;
          }
        }
      } catch { /* non bloquant — le cron réessaiera au prochain passage */ }
    } else if (storagePath) {
      const { data: { publicUrl } } = serviceSupabase.storage.from('ig-stories').getPublicUrl(storagePath);
      storageUrl = publicUrl;
    }

    const { error: upsertErr } = await serviceSupabase.from('ig_stories').upsert({
      profile_id: user.id,
      ig_story_id: igStoryId,
      media_type: story.media_type || null,
      storage_path: storagePath,
      storage_url: storageUrl,
      permalink: story.permalink || null,
      posted_at: story.timestamp ? new Date(story.timestamp).toISOString() : new Date().toISOString(),
    }, { onConflict: 'profile_id,ig_story_id', ignoreDuplicates: false });
    if (!upsertErr) found++;
  }));

  return NextResponse.json({ found });
}
