import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/instagram/test-virality
// Retourne la réponse brute Meta pour le breakdown views/follow_type
// + les autres variantes testées pour débugger pourquoi viralité = N/D
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

  if (!integ?.access_token) return NextResponse.json({ error: 'Compte Instagram non connecté' }, { status: 404 });

  const token = integ.access_token;
  const igAccountId = (integ.metadata as any)?.ig_account_id;
  if (!igAccountId) return NextResponse.json({ error: 'ig_account_id manquant' }, { status: 404 });

  const since = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);
  const until = Math.floor(Date.now() / 1000);

  const safeJson = async (res: Response) => {
    try { return await res.json(); } catch { return { error: 'parse_failed' }; }
  };

  // Teste plusieurs variantes d'appel pour le breakdown follow_type
  const [v1, v2, v3, v4] = await Promise.all([
    // Variante 1 : views + breakdown follow_type avec fenêtre 30j
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=views&period=day&since=${since}&until=${until}&breakdown=follow_type&access_token=${token}`).then(safeJson),
    // Variante 2 : reach + breakdown follow_type
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=reach&period=day&since=${since}&until=${until}&breakdown=follow_type&access_token=${token}`).then(safeJson),
    // Variante 3 : views sans breakdown (pour confirmer que views remonte bien)
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=views&period=day&since=${since}&until=${until}&access_token=${token}`).then(safeJson),
    // Variante 4 : reach_breakdown (metric alternatif documenté dans certaines versions)
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=reach&period=day&since=${since}&until=${until}&breakdown=media_product_type&access_token=${token}`).then(safeJson),
  ]);

  return NextResponse.json({
    igAccountId,
    v1_views_follow_type: v1,
    v2_reach_follow_type: v2,
    v3_views_no_breakdown: v3,
    v4_reach_media_type: v4,
  });
}
