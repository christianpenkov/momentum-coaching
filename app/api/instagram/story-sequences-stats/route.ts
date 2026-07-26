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
// Sans sequenceId : liste TOUTES les séquences du profil avec des stats légères
// (reach 1ère/dernière story, rétention, nb stories) — utilisé par les vignettes
// TabInstagram et le funnel business TabFunnel/Business micro de PageClientStats.
// Avec sequenceId : combine deux niveaux dans un objet stats détaillé pour UNE séquence :
// 1. Funnel business de la séquence entière (leads/calls/deals/revenue), pivot = story_sequence_id
// 2. Détail story par story (reach, navigation...) pour le funnel de rétention visuel
export async function GET(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const sequenceId = searchParams.get('sequenceId');
  const profileIdParam = searchParams.get('profileId');

  const targetProfileId = await resolveProfileId(user.id, profileIdParam);
  if (!targetProfileId) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

  if (!sequenceId) {
    return listAllSequences(targetProfileId);
  }

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

  // Priorité à utm_content = sequenceId (daté au clic du lien Calendly de CETTE
  // séquence, insensible aux interactions ultérieures de la même personne ailleurs)
  // — fallback sur ig_lead_id uniquement pour les calls sans utm_content (ex: LM
  // story sans lien Calendly tracké, cf. discussion produit sur ce trou connu).
  let callsBooked = 0, callsHonored = 0, dealsClosed = 0, revenue = 0;
  {
    const { data: bySequence } = await serviceSupabase
      .from('calls')
      .select('status, scheduled_at, no_show, deal_closed, revenue, outcome, ig_lead_id')
      .eq('coach_id', targetProfileId)
      .eq('utm_content', sequenceId)
      .neq('ignored', true);

    const { data: byLead } = leadIds.length
      ? await serviceSupabase
          .from('calls')
          .select('status, scheduled_at, no_show, deal_closed, revenue, outcome, utm_content')
          .eq('coach_id', targetProfileId)
          .in('ig_lead_id', leadIds)
          .is('utm_content', null)
          .neq('ignored', true)
      : { data: [] };

    const now = new Date();
    for (const c of [...(bySequence || []), ...(byLead || [])]) {
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

// Liste légère de toutes les séquences d'un profil, avec reach 1ère/dernière story
// et % de rétention — sans funnel business détaillé (trop coûteux à calculer pour
// N séquences d'un coup ; le détail complet reste accessible via ?sequenceId=).
async function listAllSequences(profileId: string) {
  const { data: sequences, error: seqErr } = await serviceSupabase
    .from('story_sequences')
    .select('id, name, cta_type, cta_story_id, lm_keyword, created_at')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false });
  if (seqErr) return NextResponse.json({ error: seqErr.message }, { status: 500 });
  if (!sequences || sequences.length === 0) return NextResponse.json({ sequences: [] });

  const sequenceIds = sequences.map(s => s.id);
  const { data: stories } = await serviceSupabase
    .from('ig_stories')
    .select('id, ig_story_id, sequence_id, storage_url, posted_at')
    .in('sequence_id', sequenceIds)
    .order('posted_at', { ascending: true });

  const storyIds = (stories || []).map(s => s.ig_story_id);
  const { data: snapshots } = storyIds.length
    ? await serviceSupabase
        .from('analytics_ig_stories_history')
        .select('ig_story_id, reach, views')
        .eq('profile_id', profileId)
        .in('ig_story_id', storyIds)
        .order('snapshot_date', { ascending: false })
    : { data: [] };

  const latestByStory = new Map<string, { reach: number | null; views: number | null }>();
  for (const snap of snapshots || []) {
    if (!latestByStory.has(snap.ig_story_id)) latestByStory.set(snap.ig_story_id, { reach: snap.reach, views: snap.views });
  }

  const storiesBySequence = new Map<string, typeof stories>();
  for (const s of stories || []) {
    if (!s.sequence_id) continue;
    if (!storiesBySequence.has(s.sequence_id)) storiesBySequence.set(s.sequence_id, []);
    storiesBySequence.get(s.sequence_id)!.push(s);
  }

  const rows = sequences.map(seq => {
    const seqStories = storiesBySequence.get(seq.id) || [];
    const firstReach = seqStories[0] ? latestByStory.get(seqStories[0].ig_story_id)?.reach ?? null : null;
    const ctaStory = seqStories.find(s => s.id === seq.cta_story_id) ?? seqStories[seqStories.length - 1];
    const ctaReach = ctaStory ? latestByStory.get(ctaStory.ig_story_id)?.reach ?? null : null;
    const retentionPct = firstReach && ctaReach != null && firstReach > 0
      ? Math.round((ctaReach / firstReach) * 1000) / 10
      : null;
    return {
      id: seq.id,
      name: seq.name,
      cta_type: seq.cta_type,
      lm_keyword: seq.lm_keyword,
      story_count: seqStories.length,
      thumbnail: seqStories[0]?.storage_url ?? null,
      first_reach: firstReach,
      cta_reach: ctaReach,
      retention_pct: retentionPct,
      created_at: seq.created_at,
    };
  });

  return NextResponse.json({ sequences: rows });
}
