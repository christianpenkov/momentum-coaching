import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  if (error || !code || !state) {
    return NextResponse.redirect(`${origin}/client/settings?error=instagram_denied`);
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);

  const expectedState = Buffer.from(user.id).toString('base64');
  if (state !== expectedState) {
    return NextResponse.redirect(`${origin}/client/settings?error=instagram_state`);
  }

  // Échange le code contre un token court (Instagram)
  const tokenRes = await fetch('https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.INSTAGRAM_CLIENT_ID!,
      client_secret: process.env.INSTAGRAM_CLIENT_SECRET!,
      grant_type: 'authorization_code',
      redirect_uri: `${process.env.NEXT_PUBLIC_PLATFORM_URL}/api/oauth/instagram/callback`,
      code,
    }),
  });

  const tokenData = await tokenRes.json();
  console.log('[IG callback] short token:', JSON.stringify({ user_id: tokenData.user_id, has_token: !!tokenData.access_token, permissions: tokenData.permissions }));
  if (!tokenData.access_token) {
    return NextResponse.redirect(`${origin}/client/settings?error=instagram_token`);
  }

  // Échange contre un token long-terme (60 jours)
  const longTokenRes = await fetch(
    `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${process.env.INSTAGRAM_CLIENT_SECRET}&access_token=${tokenData.access_token}`
  );
  const longTokenData = await longTokenRes.json();
  console.log('[IG callback] long token:', JSON.stringify({ has_token: !!longTokenData.access_token, expires_in: longTokenData.expires_in, error: longTokenData.error }));
  const accessToken = longTokenData.access_token || tokenData.access_token;
  const expiresIn = longTokenData.expires_in || null;

  // Récupère l'ID réel + username via /me (ig_account_id)
  const meRes = await fetch(
    `https://graph.instagram.com/v22.0/me?fields=id,username,account_type&access_token=${accessToken}`
  );
  const meData = await meRes.json();
  console.log('[IG callback] /me response:', JSON.stringify(meData));
  const igAccountId = meData.id ? String(meData.id) : (tokenData.user_id ? String(tokenData.user_id) : null);
  const accountLabel = meData.username ? `@${meData.username}` : null;

  const expiresAt = expiresIn
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : null;

  const serviceSupabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Isolation par compte IG connecté (bascule + archivage) — si ce profil bascule vers
  // un compte Instagram DIFFÉRENT de celui précédemment connecté, on archive toutes les
  // données actives (jamais de DELETE) puis on désarchive celles qui appartenaient déjà
  // au nouveau compte (reconnexion d'un compte déjà vu avant). Voir
  // ~/.claude/plans/ok-nous-ici-on-proud-rocket.md pour le contexte complet.
  const { data: existingInteg } = await serviceSupabase
    .from('integrations')
    .select('metadata, first_connected_at')
    .eq('profile_id', user.id)
    .eq('provider', 'instagram')
    .maybeSingle();
  const previousAccountId = (existingInteg?.metadata as any)?.ig_account_id ?? null;

  if (igAccountId) {
    const now = new Date().toISOString();
    // ⚠️ Cette liste existe en DEUX exemplaires : ici et dans
    // app/api/oauth/instagram/disconnect/route.ts (IG_TABLES). Toute table ajoutee
    // a l'une doit l'etre a l'autre, sinon l'archivage devient partiel.
    // Non factorisee volontairement : ces deux routes sont dans le parcours de la
    // review Meta en cours, on n'y touche pas plus que necessaire.
    const igTables = [
      'analytics_ig_posts_history', 'analytics_ig_stories_history', 'ig_stories',
      'instagram_leads', 'instagram_lead_lm_history', 'content_links',
      'ig_post_meta', 'analytics_daily_snapshots',
      'analytics_ig_periodes',
    ];
    try {
      // Étape 1 : archiver tout ce qui est actif pour ce profil et n'appartient PAS au
      // compte qu'on connecte maintenant. Se déclenche à CHAQUE connexion (pas
      // seulement si previousAccountId diffère) — previousAccountId peut être null même
      // quand une vraie bascule a eu lieu, si la déconnexion précédente a supprimé la
      // ligne integrations (voir /api/oauth/instagram/disconnect) : il ne faut jamais
      // dépendre de la mémoire de l'ancien compte pour savoir s'il faut archiver.
      const archiveResults = await Promise.all(igTables.map(async t => {
        const { error, count } = await serviceSupabase.from(t).update({ archived_at: now }, { count: 'exact' })
          .eq('profile_id', user.id).is('archived_at', null)
          .or(`ig_account_id.is.null,ig_account_id.neq.${igAccountId}`);
        return { t, count, error: error?.message };
      }));
      // Étape 2 : désarchiver les lignes qui appartenaient déjà à CE compte (reconnexion
      // d'un compte déjà vu avant, y compris après une déconnexion qui a effacé
      // previousAccountId) — leurs données réapparaissent.
      const unarchiveResults = await Promise.all(igTables.map(async t => {
        const { error, count } = await serviceSupabase.from(t).update({ archived_at: null }, { count: 'exact' })
          .eq('profile_id', user.id).eq('ig_account_id', igAccountId);
        return { t, count, error: error?.message };
      }));
      console.log(`[IG callback] archive/désarchive pour profile_id=${user.id} previousAccountId=${previousAccountId} igAccountId=${igAccountId}:`,
        JSON.stringify({ archived: archiveResults, unarchived: unarchiveResults }));
    } catch (e) {
      console.error('[IG callback] Erreur archivage bascule de compte:', e);
    }
  }

  const igConnectedNow = new Date().toISOString();
  await serviceSupabase.from('integrations').upsert({
    profile_id: user.id,
    provider: 'instagram',
    access_token: accessToken,
    refresh_token: null,
    account_label: accountLabel,
    expires_at: expiresAt,
    connected_at: igConnectedNow,
    first_connected_at: existingInteg?.first_connected_at || igConnectedNow,
    metadata: igAccountId ? { ig_account_id: igAccountId } : null,
  }, { onConflict: 'profile_id,provider' });

  // Réabonner aux deux niveaux webhook après chaque connexion
  if (igAccountId) {
    const appToken = `${process.env.INSTAGRAM_CLIENT_ID}|${process.env.INSTAGRAM_CLIENT_SECRET}`;
    try {
      // Niveau 1 — app-level (fields comments+messages au niveau Meta app)
      await fetch(`https://graph.facebook.com/v21.0/${process.env.INSTAGRAM_CLIENT_ID}/subscriptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          object: 'instagram',
          callback_url: `${process.env.NEXT_PUBLIC_PLATFORM_URL}/api/webhooks/instagram`,
          fields: 'comments,messages',
          verify_token: process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN!,
          access_token: appToken,
        }),
      });
      // Niveau 2 — account-level (autorise l'app sur ce compte IG)
      await fetch(`https://graph.instagram.com/v21.0/${igAccountId}/subscribed_apps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscribed_fields: 'comments,messages', access_token: accessToken }),
      });
    } catch (e) {
      console.error('[IG callback] webhook registration failed:', e);
    }
  }

  // Fire-and-forget backfill 30j (non-bloquant — ne retarde pas le redirect)
  const backfillUrl = `${process.env.NEXT_PUBLIC_PLATFORM_URL}/api/instagram/backfill`;
  fetch(backfillUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'authorization': `Bearer ${process.env.CRON_SECRET}`,
    },
    body: JSON.stringify({ profile_id: user.id }),
  }).catch(e => console.error('[IG callback] backfill trigger failed:', e));

  // Fire-and-forget refresh des posts — sans ça "Gérer mes liens" reste vide juste
  // après une connexion tant que l'utilisateur ne clique pas lui-même sur Actualiser
  // (le cron poll-leads ne tourne qu'1x/jour). Même Edge Function que le bouton
  // Actualiser, appelée ici en mode serveur-à-serveur via CRON_SECRET.
  if (igAccountId) {
    fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/refresh-ig-posts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'authorization': `Bearer ${process.env.CRON_SECRET}`,
      },
      body: JSON.stringify({ profile_id: user.id }),
    }).catch(e => console.error('[IG callback] refresh-ig-posts trigger failed:', e));
  }

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  const dest = profile?.role === 'coach' ? '/settings' : '/client/settings';
  return NextResponse.redirect(`${origin}${dest}?connected=instagram`);
}
