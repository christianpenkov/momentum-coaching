import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function resolveProfileId(userId: string, profileId: string | null): Promise<string | null> {
  if (!profileId || profileId === userId) return userId;
  const { data: clientRow } = await serviceSupabase.from('clients').select('id').eq('profile_id', profileId).eq('coach_id', userId).single();
  return clientRow ? profileId : null;
}

// GET /api/client/stories?profileId= — lecture DB uniquement (pattern DB-first), pas
// d'appel Meta. profileId optionnel : permet à un coach de lire les stories d'un élève
// (analytics), sinon lit celles de l'utilisateur connecté (Gérer mes liens élève).
// Le live-refresh (POST /api/client/stories/live-refresh) est un endpoint séparé,
// déclenché explicitement par le bouton "Actualiser" de l'onglet Stories.
export async function GET(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const targetProfileId = await resolveProfileId(user.id, searchParams.get('profileId'));
  if (!targetProfileId) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

  const { data: integ } = await serviceSupabase
    .from('integrations')
    .select('profile_id')
    .eq('profile_id', targetProfileId)
    .eq('provider', 'instagram')
    .maybeSingle();

  if (!integ) return NextResponse.json({ connected: false, stories: [] });

  const { data: stories, error } = await serviceSupabase
    .from('ig_stories')
    .select('id, ig_story_id, storage_url, permalink, posted_at, expired_at, sequence_id, story_sequences!ig_stories_sequence_id_fkey(name, cta_story_id, lm_id, lm_keyword, dm1_message, dm2_story_message, calendly_short_url)')
    .eq('profile_id', targetProfileId)
    .is('archived_at', null)
    .order('posted_at', { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const storyIds = (stories || []).map(s => s.ig_story_id);
  const { data: snapshots } = storyIds.length
    ? await serviceSupabase
        .from('analytics_ig_stories_history')
        // Toutes les metriques collectees, pas seulement reach et vues : la modale de
        // story n'en affichait que deux sur les douze presentes en base (demande de
        // Chris, 2026-08-22).
        .select('ig_story_id, reach, views, replies, shares, follows, profile_visits, total_interactions, navigation_taps_forward, navigation_taps_back, navigation_exits, snapshot_date')
        .eq('profile_id', targetProfileId)
        .in('ig_story_id', storyIds)
        .order('snapshot_date', { ascending: false })
    : { data: [] };

  type MetriquesStory = {
    reach: number | null; views: number | null; replies: number | null;
    shares: number | null;
    follows: number | null; profile_visits: number | null;
    total_interactions: number | null;
    navigation_taps_forward: number | null; navigation_taps_back: number | null;
    navigation_exits: number | null;
  };
  const latestSnapshotByStory = new Map<string, MetriquesStory>();
  for (const snap of snapshots || []) {
    if (!latestSnapshotByStory.has(snap.ig_story_id)) {
      const { ig_story_id: _id, snapshot_date: _d, ...metriques } = snap as any;
      latestSnapshotByStory.set(snap.ig_story_id, metriques as MetriquesStory);
    }
  }

  // Comptage du nombre de stories par séquence — permet de distinguer côté UI une
  // "séquence solo" (1 story, CTA géré directement dessus) d'une vraie séquence
  // multi-stories (badge de regroupement affiché à la place du badge CTA direct).
  const sequenceIds = [...new Set((stories || []).map(s => s.sequence_id).filter(Boolean))] as string[];
  // profile_id + archived_at : sans eux, une séquence dont les stories ont été
  // archivées (bascule de compte) garde son badge « multi-stories » alors qu'il ne
  // reste qu'une story active. Mêmes filtres que le comptage identique de
  // app/api/client/story-sequences/route.ts.
  const { data: countRows } = sequenceIds.length
    ? await serviceSupabase.from('ig_stories').select('sequence_id')
        .eq('profile_id', targetProfileId).is('archived_at', null).in('sequence_id', sequenceIds)
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
    // Toutes les metriques, alignees sur ce que la route des SEQUENCES exposait deja
    // (story-sequences-stats). Les deux routes lisent la meme table : celle-ci n'en
    // remontait que deux, si bien que la modale de story affichait « — » partout
    // ailleurs alors que la donnee etait en base.
    ...(latestSnapshotByStory.get(s.ig_story_id) ?? {
      reach: null, views: null, replies: null, shares: null, follows: null, profile_visits: null,
      total_interactions: null, navigation_taps_forward: null,
      navigation_taps_back: null, navigation_exits: null,
    }),
  }));

  return NextResponse.json({ connected: true, stories: rows });
}
