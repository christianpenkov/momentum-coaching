import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/instagram/test-profile-views
// Teste les métriques liées aux visites de profil et clics site web
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

  const [v1, v2, v3, v4] = await Promise.all([
    // profile_views (visites du profil)
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=profile_views&period=day&since=${since}&until=${until}&access_token=${token}`).then(safeJson),
    // website_clicks (clics sur le lien bio)
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=website_clicks&period=day&since=${since}&until=${until}&access_token=${token}`).then(safeJson),
    // profile_links_taps (taps sur les liens du profil — métrique plus récente)
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=profile_links_taps&period=day&since=${since}&until=${until}&access_token=${token}`).then(safeJson),
    // Les 4 en une seule requête pour voir ce qui passe
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=profile_views,website_clicks,profile_links_taps&period=day&since=${since}&until=${until}&access_token=${token}`).then(safeJson),
  ]);

  return NextResponse.json({
    igAccountId,
    profile_views: v1,
    website_clicks: v2,
    profile_links_taps: v3,
    all_combined: v4,
  });
}
