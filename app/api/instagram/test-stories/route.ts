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
    const metricSets = [
      'reach,replies,shares,reposts,views,total_views,link_clicks,follows,profile_visits,total_interactions',
      'navigation',
      'profile_activity',
    ];
    const results = await Promise.all(
      metricSets.map(metrics =>
        fetch(`https://graph.instagram.com/v22.0/${firstStory.id}/insights?metric=${metrics}&access_token=${token}`).then(safeJson)
      )
    );
    insightsTests = {
      base_metrics: results[0],
      navigation_breakdown: results[1],
      profile_activity_breakdown: results[2],
    };
  }

  return NextResponse.json({
    igAccountId,
    stories_count: stories.length,
    stories_raw: storiesData,
    first_story: firstStory,
    first_story_insights: insightsTests,
  });
}
