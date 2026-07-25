import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/instagram/test-stories
// Route de test (lecture seule, aucune écriture DB) — valide empiriquement ce que
// l'API Meta renvoie réellement pour les stories actives et leurs insights, avant
// de mapper quoi que ce soit dans le cron poll-stories définitif.
export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { data: integ } = await serviceSupabase
    .from('integrations')
    .select('access_token, metadata')
    .eq('profile_id', user.id)
    .eq('provider', 'instagram')
    .single();

  if (!integ?.access_token) return NextResponse.json({ error: 'Instagram non connecté' }, { status: 404 });

  const token = integ.access_token;
  const igAccountId = (integ.metadata as any)?.ig_account_id;

  const safeJson = async (r: Response) => { try { return await r.json(); } catch { return { error: 'parse_failed' }; } };

  // ── Liste des stories actives ───────────────────────────────────────────────
  const storiesData = await fetch(
    `https://graph.instagram.com/v22.0/${igAccountId}/stories?fields=id,media_type,media_url,permalink,timestamp&access_token=${token}`
  ).then(safeJson);

  const stories: any[] = storiesData?.data || [];
  const firstStory = stories[0] ?? null;

  // ── Insights sur la 1ère story active trouvée (si elle existe) ─────────────
  let insightsTests: Record<string, any> = { skipped: 'aucune story active' };
  if (firstStory) {
    const calls: [string, string][] = [
      ['base_metrics', 'reach,shares,views,follows,profile_visits,total_interactions'],
      ['total_views_only', 'total_views'],
      ['link_clicks_only', 'link_clicks'],
      ['navigation_with_breakdown', 'navigation&breakdown=story_navigation_action_type'],
      ['profile_activity_with_breakdown', 'profile_activity&breakdown=action_type'],
    ];
    const results = await Promise.all(
      calls.map(([, q]) =>
        fetch(`https://graph.instagram.com/v22.0/${firstStory.id}/insights?metric=${q}&access_token=${token}`).then(safeJson)
      )
    );
    insightsTests = Object.fromEntries(calls.map(([key], i) => [key, results[i]]));
    // Extrait explicitement les dimension_values des breakdowns pour lisibilité —
    // Meta les renvoie dans total_value.breakdowns[].results[] (confirmé empiriquement
    // le 2026-07-25, ex: navigation avec dimension_keys=["story_navigation_action_type"]).
    const extractBreakdown = (payload: any) => {
      const breakdowns = payload?.data?.[0]?.total_value?.breakdowns || [];
      return breakdowns.map((b: any) => ({
        dimension_keys: b.dimension_keys,
        results: (b.results || []).map((r: any) => ({ dimension_values: r.dimension_values, value: r.value })),
      }));
    };
    insightsTests.navigation_breakdown_parsed = extractBreakdown(results[3]);
    insightsTests.profile_activity_breakdown_parsed = extractBreakdown(results[4]);
  }

  return NextResponse.json({
    igAccountId,
    stories_count: stories.length,
    stories_raw: storiesData,
    first_story: firstStory,
    first_story_insights: insightsTests,
  });
}
