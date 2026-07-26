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
  const mode = searchParams.get('mode');

  const targetProfileId = await resolveProfileId(user.id, profileIdParam);
  if (!targetProfileId) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

  if (mode === 'funnel') {
    return listSequenceFunnelRows(targetProfileId);
  }

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
  // — fallback sur ig_lead_id pour les calls du flux DM classique, qui portent
  // utm_content=pseudo Instagram (jamais l'id de séquence, cf. webhook
  // instagram/route.ts:477/768) plutôt que d'être vides. On exclut du fallback les
  // calls dont utm_content pointe déjà vers une AUTRE séquence connue du profil
  // (évite le double-compte et les faux rattachements) — même principe que
  // matchesContent (PageClientStats.tsx:3195) pour les posts.
  const { data: allProfileSequences } = await serviceSupabase
    .from('story_sequences')
    .select('id')
    .eq('profile_id', targetProfileId);
  const allSequenceIds = (allProfileSequences || []).map(s => s.id);

  let callsBooked = 0, callsHonored = 0, dealsClosed = 0, revenue = 0;
  {
    const { data: bySequence } = await serviceSupabase
      .from('calls')
      .select('id, status, scheduled_at, no_show, deal_closed, revenue, outcome, ig_lead_id')
      .eq('coach_id', targetProfileId)
      .eq('utm_content', sequenceId)
      .neq('ignored', true);

    const { data: byLead } = leadIds.length
      ? await serviceSupabase
          .from('calls')
          .select('id, status, scheduled_at, no_show, deal_closed, revenue, outcome, utm_content')
          .eq('coach_id', targetProfileId)
          .in('ig_lead_id', leadIds)
          .neq('ignored', true)
      : { data: [] };
    const byLeadFiltered = (byLead || []).filter(c => !c.utm_content || !allSequenceIds.includes(c.utm_content));

    const seenCallIds = new Set<string>();
    const now = new Date();
    for (const c of [...(bySequence || []), ...byLeadFiltered]) {
      if (seenCallIds.has(c.id)) continue;
      seenCallIds.add(c.id);
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

// Funnel business par séquence — même format de ligne que consolidatedRows des posts
// (TabFunnel, PageClientStats.tsx), pour que les séquences apparaissent comme des
// lignes de contenu supplémentaires dans "Performance par contenu". Pivot toujours
// story_sequence_id (jamais ig_story_id seul), même logique utm_content-first que
// le mode ?sequenceId= (voir plus haut) pour rester cohérent avec matchesContent.
async function listSequenceFunnelRows(profileId: string) {
  const { data: sequences, error: seqErr } = await serviceSupabase
    .from('story_sequences')
    .select('id, name, cta_type, cta_story_id, lm_keyword, created_at')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false });
  if (seqErr) return NextResponse.json({ error: seqErr.message }, { status: 500 });
  if (!sequences || sequences.length === 0) return NextResponse.json({ rows: [] });

  const sequenceIds = sequences.map(s => s.id);

  const { data: stories } = await serviceSupabase
    .from('ig_stories')
    .select('id, ig_story_id, sequence_id, storage_url, posted_at')
    .in('sequence_id', sequenceIds)
    .order('posted_at', { ascending: true });
  const storiesBySequence = new Map<string, typeof stories>();
  for (const s of stories || []) {
    if (!s.sequence_id) continue;
    if (!storiesBySequence.has(s.sequence_id)) storiesBySequence.set(s.sequence_id, []);
    storiesBySequence.get(s.sequence_id)!.push(s);
  }

  const storyIds = (stories || []).map(s => s.ig_story_id);
  const { data: snapshots } = storyIds.length
    ? await serviceSupabase.from('analytics_ig_stories_history').select('ig_story_id, views').eq('profile_id', profileId).in('ig_story_id', storyIds)
    : { data: [] };
  const viewsByStory = new Map<string, number>();
  for (const snap of snapshots || []) viewsByStory.set(snap.ig_story_id, Math.max(viewsByStory.get(snap.ig_story_id) ?? 0, snap.views ?? 0));

  const { data: leads } = await serviceSupabase
    .from('instagram_leads')
    .select('id, story_sequence_id, lead_magnet_sent, hook_replied')
    .eq('profile_id', profileId)
    .not('story_sequence_id', 'is', null);
  const leadsBySequence = new Map<string, typeof leads>();
  for (const l of leads || []) {
    if (!l.story_sequence_id) continue;
    if (!leadsBySequence.has(l.story_sequence_id)) leadsBySequence.set(l.story_sequence_id, []);
    leadsBySequence.get(l.story_sequence_id)!.push(l);
  }

  const now = new Date();
  const rows = await Promise.all(sequences.map(async seq => {
    const seqStories = storiesBySequence.get(seq.id) || [];
    const views = seqStories.reduce((s, st) => s + (viewsByStory.get(st.ig_story_id) ?? 0), 0);
    const seqLeads = leadsBySequence.get(seq.id) || [];
    const leadIds = seqLeads.map(l => l.id);

    // Priorité utm_content (daté au clic, fiable) puis fallback ig_lead_id — même
    // principe que matchesContent (PageClientStats.tsx:3195) pour les posts : un call
    // du flux DM porte utm_content=pseudo Instagram (pas l'id de séquence, cf. webhook
    // instagram/route.ts:477/768), donc le fallback par lead est nécessaire pour ne pas
    // perdre ces calls. On exclut du fallback les calls dont utm_content pointe déjà
    // vers une AUTRE séquence connue (évite le double-compte et les faux rattachements).
    const { data: bySequence } = await serviceSupabase
      .from('calls')
      .select('id, status, scheduled_at, no_show, deal_closed, revenue, outcome')
      .eq('coach_id', profileId)
      .eq('utm_content', seq.id)
      .neq('ignored', true);
    const { data: byLead } = leadIds.length
      ? await serviceSupabase
          .from('calls')
          .select('id, status, scheduled_at, no_show, deal_closed, revenue, outcome, utm_content')
          .eq('coach_id', profileId)
          .in('ig_lead_id', leadIds)
          .neq('ignored', true)
      : { data: [] };
    const byLeadFiltered = (byLead || []).filter(c => !c.utm_content || !sequenceIds.includes(c.utm_content));

    const seenCallIds = new Set<string>();
    let callsBooked = 0, callsHonored = 0, closed = 0, revenue = 0;
    for (const c of [...(bySequence || []), ...byLeadFiltered]) {
      if (seenCallIds.has(c.id)) continue;
      seenCallIds.add(c.id);
      if (c.status === 'active') {
        callsBooked++;
        if (new Date(c.scheduled_at) < now && c.outcome != null && !c.no_show) callsHonored++;
      }
      if (c.deal_closed) { closed++; revenue += c.revenue || 0; }
    }

    return {
      sequenceId: seq.id,
      name: seq.name,
      ctaType: seq.cta_type,
      lmKeyword: seq.lm_keyword,
      thumbnail: seqStories[0]?.storage_url ?? null,
      storyCount: seqStories.length,
      views,
      lmDetectes: seqLeads.length,
      lmSent: seqLeads.filter(l => l.lead_magnet_sent).length,
      lmReponses: seqLeads.filter(l => l.hook_replied).length,
      callsBooked,
      callsHonored,
      closed,
      revenue,
    };
  }));

  return NextResponse.json({ rows });
}
