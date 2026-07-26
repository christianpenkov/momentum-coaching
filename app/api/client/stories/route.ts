import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/client/stories — lecture DB uniquement (pattern DB-first), pas d'appel Meta.
// Le live-refresh (POST /api/client/stories/live-refresh) est un endpoint séparé,
// déclenché explicitement par le bouton "Actualiser" de l'onglet Stories.
export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { data: integ } = await serviceSupabase
    .from('integrations')
    .select('profile_id')
    .eq('profile_id', user.id)
    .eq('provider', 'instagram')
    .maybeSingle();

  if (!integ) return NextResponse.json({ connected: false, stories: [] });

  const { data: stories, error } = await serviceSupabase
    .from('ig_stories')
    .select('id, ig_story_id, storage_url, permalink, posted_at, expired_at, sequence_id, story_sequences!ig_stories_sequence_id_fkey(name, cta_story_id, lm_id, lm_keyword, dm1_message, dm2_story_message, calendly_short_url)')
    .eq('profile_id', user.id)
    .order('posted_at', { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const storyIds = (stories || []).map(s => s.ig_story_id);
  const { data: snapshots } = storyIds.length
    ? await serviceSupabase
        .from('analytics_ig_stories_history')
        .select('ig_story_id, reach, views, snapshot_date')
        .eq('profile_id', user.id)
        .in('ig_story_id', storyIds)
        .order('snapshot_date', { ascending: false })
    : { data: [] };

  const latestSnapshotByStory = new Map<string, { reach: number | null; views: number | null }>();
  for (const snap of snapshots || []) {
    if (!latestSnapshotByStory.has(snap.ig_story_id)) {
      latestSnapshotByStory.set(snap.ig_story_id, { reach: snap.reach, views: snap.views });
    }
  }

  // Comptage du nombre de stories par séquence — permet de distinguer côté UI une
  // "séquence solo" (1 story, CTA géré directement dessus) d'une vraie séquence
  // multi-stories (badge de regroupement affiché à la place du badge CTA direct).
  const sequenceIds = [...new Set((stories || []).map(s => s.sequence_id).filter(Boolean))] as string[];
  const { data: countRows } = sequenceIds.length
    ? await serviceSupabase.from('ig_stories').select('sequence_id').in('sequence_id', sequenceIds)
    : { data: [] };
  const countBySequence = new Map<string, number>();
  for (const row of countRows || []) {
    countBySequence.set(row.sequence_id, (countBySequence.get(row.sequence_id) || 0) + 1);
  }

  const rows = (stories || []).map((s: any) => ({
    id: s.id,
    ig_story_id: s.ig_story_id,
    storage_url: s.storage_url,
    permalink: s.permalink,
    posted_at: s.posted_at,
    expired_at: s.expired_at,
    sequence_id: s.sequence_id,
    sequence_name: s.story_sequences?.name ?? null,
    sequence_story_count: s.sequence_id ? (countBySequence.get(s.sequence_id) ?? 1) : 0,
    cta_story_id: s.story_sequences?.cta_story_id ?? null,
    lm_id: s.story_sequences?.lm_id ?? null,
    lm_keyword: s.story_sequences?.lm_keyword ?? null,
    dm1_message: s.story_sequences?.dm1_message ?? null,
    dm2_story_message: s.story_sequences?.dm2_story_message ?? null,
    calendly_short_url: s.story_sequences?.calendly_short_url ?? null,
    reach: latestSnapshotByStory.get(s.ig_story_id)?.reach ?? null,
    views: latestSnapshotByStory.get(s.ig_story_id)?.views ?? null,
  }));

  return NextResponse.json({ connected: true, stories: rows });
}
