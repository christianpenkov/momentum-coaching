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

// GET /api/instagram/story-sequences-stats?profileId=&sequenceId=
// Combine deux niveaux dans un seul objet stats :
// 1. Funnel business de la séquence entière (leads/calls/deals/revenue), pivot = story_sequence_id
// 2. Détail story par story (reach, navigation...) pour le funnel de rétention visuel
export async function GET(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const sequenceId = searchParams.get('sequenceId');
  const profileIdParam = searchParams.get('profileId');
  if (!sequenceId) return NextResponse.json({ error: 'sequenceId requis' }, { status: 400 });

  const targetProfileId = await resolveProfileId(user.id, profileIdParam);
  if (!targetProfileId) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

  const { data: sequence, error: seqErr } = await serviceSupabase
    .from('story_sequences')
    .select('id, name, cta_type, lm_keyword')
    .eq('id', sequenceId)
    .eq('profile_id', targetProfileId)
    .maybeSingle();
  if (seqErr) return NextResponse.json({ error: seqErr.message }, { status: 500 });
  if (!sequence) return NextResponse.json({ error: 'Séquence introuvable' }, { status: 404 });

  // ── Détail story par story (reach, navigation, etc.) ──────────────────────
  const { data: stories } = await serviceSupabase
    .from('ig_stories')
    .select('id, ig_story_id, storage_url, posted_at')
    .eq('sequence_id', sequenceId)
    .order('posted_at', { ascending: true });

  const storyIds = (stories || []).map(s => s.ig_story_id);
  const { data: snapshots } = storyIds.length
    ? await serviceSupabase
        .from('analytics_ig_stories_history')
        .select('*')
        .eq('profile_id', targetProfileId)
        .in('ig_story_id', storyIds)
        .order('snapshot_date', { ascending: false })
    : { data: [] };

  const latestByStory = new Map<string, any>();
  for (const snap of snapshots || []) {
    if (!latestByStory.has(snap.ig_story_id)) latestByStory.set(snap.ig_story_id, snap);
  }

  const storiesDetail = (stories || []).map(s => {
    const snap = latestByStory.get(s.ig_story_id);
    return {
      id: s.id,
      storage_url: s.storage_url,
      posted_at: s.posted_at,
      reach: snap?.reach ?? null,
      views: snap?.views ?? null,
      shares: snap?.shares ?? null,
      follows: snap?.follows ?? null,
      profile_visits: snap?.profile_visits ?? null,
      total_interactions: snap?.total_interactions ?? null,
      navigation_taps_forward: snap?.navigation_taps_forward ?? null,
      navigation_taps_back: snap?.navigation_taps_back ?? null,
      navigation_exits: snap?.navigation_exits ?? null,
    };
  });

  const firstReach = storiesDetail[0]?.reach ?? null;
  const lastReach = storiesDetail[storiesDetail.length - 1]?.reach ?? null;
  const retentionPct = firstReach && lastReach != null && firstReach > 0
    ? Math.round((lastReach / firstReach) * 1000) / 10
    : null;

  // ── Funnel business — pivot instagram_leads.story_sequence_id ─────────────
  const { data: leads } = await serviceSupabase
    .from('instagram_leads')
    .select('id')
    .eq('profile_id', targetProfileId)
    .eq('story_sequence_id', sequenceId);

  const leadIds = (leads || []).map(l => l.id);
  const leadsCount = leadIds.length;

  let callsBooked = 0, callsHonored = 0, dealsClosed = 0, revenue = 0;
  if (leadIds.length) {
    const { data: calls } = await serviceSupabase
      .from('calls')
      .select('status, scheduled_at, no_show, deal_closed, revenue, outcome')
      .eq('coach_id', targetProfileId)
      .in('ig_lead_id', leadIds)
      .neq('ignored', true);

    const now = new Date();
    for (const c of calls || []) {
      if (c.status === 'active') {
        callsBooked++;
        if (new Date(c.scheduled_at) < now && c.outcome != null && !c.no_show) callsHonored++;
      }
      if (c.deal_closed) { dealsClosed++; revenue += c.revenue || 0; }
    }
  }

  return NextResponse.json({
    stats: {
      retentionPct,
      leadsCount,
      callsBooked,
      callsHonored,
      dealsClosed,
      revenue,
      storiesDetail,
    },
  });
}
