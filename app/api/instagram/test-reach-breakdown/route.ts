import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/instagram/test-reach-breakdown
// Teste le breakdown follower/non-follower par post individuel
// Prend les 3 derniers posts et essaie toutes les variantes de l'API
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

  // Récupère les 3 derniers posts
  const mediaRes = await fetch(
    `https://graph.instagram.com/v22.0/${igAccountId}/media?fields=id,caption,media_type,timestamp&limit=3&access_token=${token}`
  );
  const mediaData = await mediaRes.json();
  const posts = mediaData?.data || [];

  if (posts.length === 0) return NextResponse.json({ error: 'Aucun post trouvé' }, { status: 404 });

  const results: any[] = [];

  for (const post of posts) {
    const postResult: any = {
      id: post.id,
      caption: post.caption?.slice(0, 60),
      type: post.media_type,
      timestamp: post.timestamp,
      tests: {},
    };

    // Test 1 : reach avec breakdown=follow_type (méthode décrite par l'IA)
    const r1 = await fetch(
      `https://graph.instagram.com/v22.0/${post.id}/insights?metric=reach&breakdown=follow_type&access_token=${token}`
    );
    postResult.tests.reach_breakdown_follow_type = await r1.json();

    // Test 2 : views avec breakdown=follow_type
    const r2 = await fetch(
      `https://graph.instagram.com/v22.0/${post.id}/insights?metric=views&breakdown=follow_type&access_token=${token}`
    );
    postResult.tests.views_breakdown_follow_type = await r2.json();

    // Test 3 : reach sans breakdown (baseline)
    const r3 = await fetch(
      `https://graph.instagram.com/v22.0/${post.id}/insights?metric=reach&access_token=${token}`
    );
    postResult.tests.reach_no_breakdown = await r3.json();

    // Test 4 : impressions avec breakdown=follow_type
    const r4 = await fetch(
      `https://graph.instagram.com/v22.0/${post.id}/insights?metric=impressions&breakdown=follow_type&access_token=${token}`
    );
    postResult.tests.impressions_breakdown_follow_type = await r4.json();

    results.push(postResult);
  }

  return NextResponse.json({ igAccountId, postsTestedCount: results.length, results });
}
