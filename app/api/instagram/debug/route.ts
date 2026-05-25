import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const profileId = searchParams.get('profileId');

  let targetProfileId = user.id;
  if (profileId && profileId !== user.id) {
    const { data: clientRow } = await serviceSupabase
      .from('clients')
      .select('id')
      .eq('profile_id', profileId)
      .eq('coach_id', user.id)
      .single();
    if (!clientRow) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    targetProfileId = profileId;
  }

  const { data: integ } = await serviceSupabase
    .from('integrations')
    .select('access_token, metadata')
    .eq('profile_id', targetProfileId)
    .eq('provider', 'instagram')
    .single();

  if (!integ?.access_token) return NextResponse.json({ error: 'Pas de token IG' }, { status: 404 });

  const token = integ.access_token;
  const igAccountId: string = (integ.metadata as any)?.ig_account_id;
  if (!igAccountId) return NextResponse.json({ error: 'Pas de ig_account_id' }, { status: 404 });

  const since = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);
  const until = Math.floor(Date.now() / 1000);
  const safe = async (url: string) => {
    try { const r = await fetch(url); return r.json(); } catch (e) { return { fetchError: String(e) }; }
  };

  // 0. /me avec le token directement
  const meRes = await safe(
    `https://graph.instagram.com/v22.0/me?fields=id,username,account_type,followers_count&access_token=${token}`
  );

  // 0a. Test échange token long-terme pour voir l'erreur exacte
  const longTokenTestRes = await safe(
    `https://graph.instagram.com/oauth/access_token?grant_type=ig_exchange_token&client_secret=${process.env.INSTAGRAM_CLIENT_SECRET}&access_token=${token}`
  );

  // 0b. reach simple pour tester si le compte supporte les insights du tout
  const reachTestRes = await safe(
    `https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=reach&period=day&since=${since}&until=${until}&access_token=${token}`
  );

  // 1. follower_count jour par jour
  const followerCountRes = await safe(
    `https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=follower_count&period=day&since=${since}&until=${until}&access_token=${token}`
  );

  // 2. follower_demographics — toutes les breakdowns
  const demoRes = await safe(
    `https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=follower_demographics&period=lifetime&breakdown=age,gender,country,city&access_token=${token}`
  );

  // 3. follower_demographics sans breakdown (certains comptes ça marche autrement)
  const demoSimpleRes = await safe(
    `https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=follower_demographics&period=lifetime&access_token=${token}`
  );

  // 4. audience_gender_age (ancienne API) — parfois disponible sur certains comptes
  const audienceRes = await safe(
    `https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=audience_gender_age&period=lifetime&access_token=${token}`
  );

  // 5. follows_and_unfollows jour par jour (vérification structure brute)
  const followsRes = await safe(
    `https://graph.instagram.com/v22.0/${igAccountId}/insights?metric=follows_and_unfollows&period=day&since=${since}&until=${until}&access_token=${token}`
  );

  return NextResponse.json({
    igAccountId,
    me: meRes,
    longTokenTest: longTokenTestRes,
    reachTest: reachTestRes,
    followerCount: {
      error: followerCountRes?.error || null,
      dataLength: followerCountRes?.data?.length ?? 0,
      sample: followerCountRes?.data?.slice(0, 3) ?? [],
    },
    demographics: {
      error: demoRes?.error || null,
      dataLength: demoRes?.data?.length ?? 0,
      raw: demoRes,
    },
    demographicsSimple: {
      error: demoSimpleRes?.error || null,
      raw: demoSimpleRes,
    },
    audienceGenderAge: {
      error: audienceRes?.error || null,
      raw: audienceRes,
    },
    followsAndUnfollows: {
      error: followsRes?.error || null,
      dataLength: followsRes?.data?.length ?? 0,
      sample: followsRes?.data?.slice(0, 3) ?? [],
    },
  });
}
