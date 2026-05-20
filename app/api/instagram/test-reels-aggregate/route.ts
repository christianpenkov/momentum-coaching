import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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

  if (!integ?.access_token) return NextResponse.json({ error: 'no_token' }, { status: 404 });
  const token = integ.access_token;
  const igId = (integ.metadata as any)?.ig_account_id;
  if (!igId) return NextResponse.json({ error: 'no_ig_account_id' }, { status: 404 });

  const safe = async (url: string) => {
    try { const r = await fetch(url); return await r.json(); }
    catch (e) { return { _error: String(e) }; }
  };

  const since = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);
  const until = Math.floor(Date.now() / 1000);

  // Test 1 : profile_visits + breakdown=media_product_type
  const profile_visits_by_type = await safe(
    `https://graph.instagram.com/v22.0/${igId}/insights?metric=profile_visits&period=day&since=${since}&until=${until}&breakdown=media_product_type&access_token=${token}`
  );

  // Test 2 : follows_and_unfollows + breakdown=media_product_type
  const follows_by_type = await safe(
    `https://graph.instagram.com/v22.0/${igId}/insights?metric=follows_and_unfollows&period=day&since=${since}&until=${until}&breakdown=media_product_type&access_token=${token}`
  );

  // Test 3 : profile_views (deprecated mais testons) + breakdown=media_product_type
  const profile_views_by_type = await safe(
    `https://graph.instagram.com/v22.0/${igId}/insights?metric=profile_views&period=day&since=${since}&until=${until}&breakdown=media_product_type&access_token=${token}`
  );

  // Test 4 : profile_links_taps + breakdown=media_product_type
  const profile_links_taps_by_type = await safe(
    `https://graph.instagram.com/v22.0/${igId}/insights?metric=profile_links_taps&period=day&since=${since}&until=${until}&breakdown=media_product_type&access_token=${token}`
  );

  // Test 5 : website_clicks + breakdown=media_product_type
  const website_clicks_by_type = await safe(
    `https://graph.instagram.com/v22.0/${igId}/insights?metric=website_clicks&period=day&since=${since}&until=${until}&breakdown=media_product_type&access_token=${token}`
  );

  // Test 6 : total_interactions + breakdown=media_product_type
  const total_interactions_by_type = await safe(
    `https://graph.instagram.com/v22.0/${igId}/insights?metric=total_interactions&period=day&since=${since}&until=${until}&breakdown=media_product_type&access_token=${token}`
  );

  // Test 7 : reach + breakdown=media_product_type
  const reach_by_type = await safe(
    `https://graph.instagram.com/v22.0/${igId}/insights?metric=reach&period=day&since=${since}&until=${until}&breakdown=media_product_type&access_token=${token}`
  );

  return NextResponse.json({
    _test_route: 'SUPPRIMER AVANT LIVRAISON',
    _ig_account_id: igId,
    _timestamp: new Date().toISOString(),
    profile_visits_by_type,
    follows_by_type,
    profile_views_by_type,
    profile_links_taps_by_type,
    website_clicks_by_type,
    total_interactions_by_type,
    reach_by_type,
  });
}
