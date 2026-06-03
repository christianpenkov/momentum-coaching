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

  const [t1, t2, t3] = await Promise.all([
    // accounts_engaged : comptes uniques ayant interagi
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=accounts_engaged&period=day&since=${since}&until=${until}&access_token=${token}`).then(safeJson),
    // total_interactions : total des interactions (likes + comments + saves + shares)
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=total_interactions&period=day&since=${since}&until=${until}&access_token=${token}`).then(safeJson),
    // Les deux ensemble
    fetch(`https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=accounts_engaged,total_interactions&period=day&since=${since}&until=${until}&access_token=${token}`).then(safeJson),
  ]);

  const sum = (data: any[], name: string) =>
    (data?.find((m: any) => m.name === name)?.values || []).reduce((a: number, b: any) => a + (b.value || 0), 0);

  return NextResponse.json({
    igAccountId,
    accounts_engaged_raw: t1,
    total_interactions_raw: t2,
    combined_raw: t3,
    totals_30d: {
      accounts_engaged: sum(t3?.data || [], 'accounts_engaged'),
      total_interactions: sum(t3?.data || [], 'total_interactions'),
    },
  });
}
