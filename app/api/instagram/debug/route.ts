'use server';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const safe = async (url: string, opts?: RequestInit) => {
  try {
    const r = await fetch(url, opts);
    return await r.json();
  } catch (e) { return { fetchError: String(e) }; }
};

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

  if (!integ?.access_token) return NextResponse.json({ error: 'Pas de token IG en DB' }, { status: 404 });

  const token = integ.access_token;
  const igAccountId = String((integ.metadata as any)?.ig_account_id ?? '');
  const pageId = String((integ.metadata as any)?.page_id ?? '');

  // 1. /me — infos de base du compte
  const me = await safe(`https://graph.instagram.com/v22.0/me?fields=id,username,account_type&access_token=${token}`);

  // 2. Posts du compte
  const media = await safe(`https://graph.instagram.com/v21.0/${igAccountId}/media?fields=id,permalink,timestamp,caption&limit=5&access_token=${token}`);

  // 3. Abonnement webhook actif
  const subscriptions = await safe(`https://graph.instagram.com/v21.0/${igAccountId}/subscribed_apps?access_token=${token}`);

  // 4. Tentative récupération page_id via /page
  const pageField = await safe(`https://graph.instagram.com/v22.0/${igAccountId}?fields=page&access_token=${token}`);

  // 5. Tentative via /me/accounts (Facebook Graph)
  const fbAccounts = await safe(`https://graph.facebook.com/v21.0/me/accounts?access_token=${token}`);

  // 6. Abonnement app-level Meta
  const appToken = `${process.env.INSTAGRAM_CLIENT_ID}|${process.env.INSTAGRAM_CLIENT_SECRET}`;
  const appSubs = await safe(`https://graph.facebook.com/v21.0/${process.env.INSTAGRAM_CLIENT_ID}/subscriptions?access_token=${appToken}`);

  return NextResponse.json({
    stored: { igAccountId, pageId, tokenPrefix: token.slice(0, 20) },
    me,
    media: { count: media?.data?.length ?? 0, error: media?.error ?? null, posts: media?.data ?? [] },
    webhookSubscriptions: subscriptions,
    pageFieldFromApi: pageField,
    fbAccounts,
    appLevelSubscriptions: appSubs,
    diagnosis: {
      hasToken: !!token,
      hasIgAccountId: !!igAccountId,
      hasPageId: !!pageId,
      canReadPosts: !media?.error,
      isSubscribed: (subscriptions?.data?.length ?? 0) > 0,
    },
  });
}
