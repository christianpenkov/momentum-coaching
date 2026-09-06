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
    return NextResponse.redirect(`${origin}/settings?error=calendly_denied`);
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
    return NextResponse.redirect(`${origin}/settings?error=calendly_state`);
  }

  // Échanger le code
  const credentials = Buffer.from(
    `${process.env.CALENDLY_CLIENT_ID}:${process.env.CALENDLY_CLIENT_SECRET}`
  ).toString('base64');

  const tokenRes = await fetch('https://auth.calendly.com/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${process.env.NEXT_PUBLIC_PLATFORM_URL}/api/oauth/calendly/callback`,
    }),
  });

  const tokenData = await tokenRes.json();

  if (!tokenData.access_token) {
    return NextResponse.redirect(`${origin}/settings?error=calendly_token`);
  }

  // Récupérer le profil Calendly pour le label
  const meRes = await fetch('https://api.calendly.com/users/me', {
    headers: { 'Authorization': `Bearer ${tokenData.access_token}` },
  });
  const meData = await meRes.json();
  const accountLabel = meData?.resource?.name || meData?.resource?.email || null;
  // L'URL de réservation, dans la MÊME réponse. Voir plus bas : c'est elle qui
  // manquait à tout l'écran « Gérer mes liens ».
  const schedulingUrl: string | null = meData?.resource?.scheduling_url || null;

  const expiresAt = tokenData.expires_in
    ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
    : null;

  const serviceSupabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // first_connected_at ne doit jamais être réécrit après la toute première connexion —
  // contrairement à connected_at, réécrit à chaque reconnexion OAuth. C'est la référence
  // stable utilisée pour filtrer les calls générés par le pipeline Momentum.
  const { data: existingIntegration } = await serviceSupabase
    .from('integrations')
    .select('first_connected_at')
    .eq('profile_id', user.id)
    .eq('provider', 'calendly')
    .maybeSingle();

  const now = new Date().toISOString();

  await serviceSupabase.from('integrations').upsert({
    profile_id: user.id,
    provider: 'calendly',
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token || null,
    account_label: accountLabel,
    expires_at: expiresAt,
    connected_at: now,
    first_connected_at: existingIntegration?.first_connected_at || now,
  }, { onConflict: 'profile_id,provider' });

  // ── L'URL DE RÉSERVATION SE CAPTURE, ELLE NE SE DEMANDE PAS ───────────────
  //
  // Deux choses différentes portent le nom « Calendly » : la CONNEXION, qui
  // synchronise les rendez-vous, et le LIEN DE RÉSERVATION, celui qu'on colle
  // dans un sticker de story ou un DM. Seule la première était demandée.
  //
  // Conséquence : on terminait l'onboarding sans lien de réservation, et plus
  // rien dans « Gérer mes liens » ne pouvait générer de Calendly — sans qu'aucun
  // écran ne dise pourquoi. Le champ existait, dans un coin des Paramètres.
  //
  // Calendly renvoie `scheduling_url` dans la réponse `/users/me` qu'on fait
  // DÉJÀ juste au-dessus, pour le libellé du compte. Il n'y a donc rien à
  // demander à personne : on la pose au moment de la connexion.
  //
  // ⚠️ Seulement si le champ est VIDE. `scheduling_url` est la page générale du
  // compte ; un élève qui a délibérément choisi un type de rendez-vous précis
  // (« /30min ») a une raison de l'avoir fait, et l'écraser à chaque
  // reconnexion effacerait ce choix en silence.
  if (schedulingUrl) {
    const { data: profil } = await serviceSupabase
      .from('profiles').select('role').eq('id', user.id).maybeSingle();

    if (profil?.role === 'coach') {
      const { data: actuel } = await serviceSupabase
        .from('profiles').select('calendly_url').eq('id', user.id).maybeSingle();
      if (!actuel?.calendly_url) {
        await serviceSupabase.from('profiles').update({ calendly_url: schedulingUrl }).eq('id', user.id);
      }
    } else {
      const { data: actuel } = await serviceSupabase
        .from('clients').select('calendly_url').eq('profile_id', user.id).maybeSingle();
      if (actuel && !actuel.calendly_url) {
        await serviceSupabase.from('clients').update({ calendly_url: schedulingUrl }).eq('profile_id', user.id);
      }
    }
  }

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();

  const base = process.env.NEXT_PUBLIC_PLATFORM_URL || '';

  // Enregistrement webhook Calendly — pour tous les rôles (fire-and-forget)
  fetch(`${base}/api/calendly/register-webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: request.headers.get('cookie') || '' },
  }).catch(e => console.error('[Calendly callback] register-webhook failed:', e));

  // Pour les élèves : sync immédiat des events (fire-and-forget)
  //
  // On ne passe PLUS `connected_at` : la route le resout elle-meme depuis
  // `first_connected_at`. Envoyer l'instant present rehaussait le plancher
  // d'ingestion a aujourd'hui des qu'un eleve reconnectait LE MEME compte, et ses
  // rendez-vous anterieurs cessaient d'etre rafraichis. A la toute premiere
  // connexion le resultat est identique (first_connected_at vaut maintenant) ; a la
  // deuxieme, il est correct au lieu d'etre destructeur.
  if (profile?.role === 'client') {
    fetch(`${base}/api/calendly/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'authorization': `Bearer ${process.env.CRON_SECRET}`,
      },
      body: JSON.stringify({ profile_id: user.id }),
    }).catch(e => console.error('[Calendly callback] sync trigger failed:', e));
  }

  const dest = profile?.role === 'coach' ? '/settings' : '/client/settings';
  return NextResponse.redirect(`${origin}${dest}?connected=calendly`);
}
