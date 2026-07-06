import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// POST /api/instagram/backfill-post-thumbnails
// Rattrapage manuel, à déclencher une seule fois : pérennise dans le bucket
// instagram-post-thumbnails les thumbnails déjà en base (analytics_ig_posts_history)
// qui pointent encore vers une URL Meta signée (donc potentiellement déjà expirée,
// ~24-48h de durée de vie) — remplace toutes les lignes de ce post_id (pas
// seulement la plus récente) par l'URL Storage permanente, une fois obtenue.
export async function POST() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  // 1 ligne par post_id (peu importe laquelle, on veut juste l'URL courante)
  const { data: rows } = await serviceSupabase
    .from('analytics_ig_posts_history')
    .select('post_id, thumbnail')
    .eq('profile_id', user.id)
    .not('thumbnail', 'is', null)
    .order('snapshot_date', { ascending: false });

  const seen = new Set<string>();
  const posts: { post_id: string; thumbnail: string }[] = [];
  for (const r of rows || []) {
    if (seen.has(r.post_id)) continue;
    seen.add(r.post_id);
    if (r.thumbnail && !r.thumbnail.includes('supabase.co/storage')) posts.push(r);
  }

  let updated = 0;
  const errors: string[] = [];

  for (const post of posts) {
    try {
      const path = `${post.post_id}.jpg`;
      const imgRes = await fetch(post.thumbnail);
      if (!imgRes.ok) { errors.push(`${post.post_id}: img fetch ${imgRes.status}`); continue; }
      const buf = await imgRes.arrayBuffer();

      const { error: uploadError } = await serviceSupabase.storage
        .from('instagram-post-thumbnails')
        .upload(path, buf, { contentType: 'image/jpeg', upsert: true });
      if (uploadError) { errors.push(`${post.post_id}: upload ${uploadError.message}`); continue; }

      const { data: { publicUrl } } = serviceSupabase.storage
        .from('instagram-post-thumbnails')
        .getPublicUrl(path);

      const { error: updateError } = await serviceSupabase
        .from('analytics_ig_posts_history')
        .update({ thumbnail: publicUrl })
        .eq('profile_id', user.id)
        .eq('post_id', post.post_id);
      if (updateError) { errors.push(`${post.post_id}: db update ${updateError.message}`); continue; }

      updated++;
    } catch (e: any) {
      errors.push(`${post.post_id}: ${e?.message || 'unknown'}`);
    }
  }

  return NextResponse.json({ ok: true, updated, total: posts.length, errors });
}
