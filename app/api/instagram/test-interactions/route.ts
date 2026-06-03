import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/instagram/test-interactions
// Vérifie que accounts_engaged et total_interactions remontent bien au niveau compte
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

  const since = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);
  const until = Math.floor(Date.now() / 1000);
  const safeJson = async (r: Response) => { try { return await r.json(); } catch { return { error: 'parse_failed' }; } };

  const [t1, t2, t3, t4, t5, t6, t7] = await Promise.all([
    // period=day 30j
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=accounts_engaged&period=day&since=${since}&until=${until}&access_token=${token}`).then(safeJson),
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=total_interactions&period=day&since=${since}&until=${until}&access_token=${token}`).then(safeJson),
    // period=week
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=accounts_engaged,total_interactions&period=week&access_token=${token}`).then(safeJson),
    // period=days_28
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=accounts_engaged,total_interactions&period=days_28&access_token=${token}`).then(safeJson),
    // metric_type=total_value (format agrégé)
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=accounts_engaged,total_interactions&metric_type=total_value&period=day&since=${since}&until=${until}&access_token=${token}`).then(safeJson),
    // Depuis les posts individuels — total_interactions sur le dernier post
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/media?fields=id,media_type&limit=1&access_token=${token}`).then(safeJson),
    // likes + comments + saved + shares agrégés au niveau compte (métriques de base)
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=likes,comments,shares,saved&period=day&since=${since}&until=${until}&access_token=${token}`).then(safeJson),
  ]);

  // Insights du dernier post
  const lastPostId = t6?.data?.[0]?.id;
  const lastPostInsights = lastPostId
    ? await fetch(`https://graph.instagram.com/v22.0/${lastPostId}/insights?metric=total_interactions,likes,comments,saved,shares,reach&access_token=${token}`).then(safeJson)
    : { skipped: 'aucun post' };

  return NextResponse.json({
    igAccountId,
    period_day_30j: { accounts_engaged: t1, total_interactions: t2 },
    period_week: t3,
    period_days_28: t4,
    metric_type_total_value: t5,
    basic_metrics_day: t7,
    last_post: { id: lastPostId, insights: lastPostInsights },
  });
}
