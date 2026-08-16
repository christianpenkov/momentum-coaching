import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Log direct vers Supabase (pas d'appel à /api/client-log, pour ne pas dépendre
// d'une autre route Next.js depuis le contexte Edge du middleware) — sert à
// compter, côté SERVEUR, le nombre réel de requêtes de navigation document pour
// /client à chaque ouverture d'app. Si le navigateur envoie bien 2 requêtes
// séparées, ça confirme un vrai double chargement HTTP (pas un bug React côté
// client) ; si une seule requête arrive ici mais qu'on voit 2 boots côté client,
// le problème est isolé au rendu/hydratation, pas au réseau.
function logNavigation(data: Record<string, unknown>) {
  fetch(`${SUPABASE_URL}/rest/v1/webhook_debug_log`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ message: '[MIDDLEWARE] navigation_request', data }),
  }).catch(() => {});
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (request.headers.get('sec-fetch-dest') === 'document') {
    logNavigation({
      pathname,
      method: request.method,
      mode: request.headers.get('sec-fetch-mode'),
      site: request.headers.get('sec-fetch-site'),
      referer: request.headers.get('referer'),
      ua: request.headers.get('user-agent'),
    });
  }

  const response = NextResponse.next({
    request: { headers: request.headers },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  // getSession lit le cookie local sans appel réseau — évite les déconnexions PWA
  // Le client gère le refresh automatiquement via le SDK Supabase
  const { data: { session } } = await supabase.auth.getSession();

  // Pas de session → login
  if (!session) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Récupère le rôle
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', session.user.id)
    .single();

  const role = profile?.role;
  const isClientPath = pathname === '/client' || pathname.startsWith('/client/');
  const isCoachPath = !isClientPath;

  // Client essaie d'accéder à l'espace coach → redirige vers /client
  if (role === 'client' && isCoachPath) {
    return NextResponse.redirect(new URL('/client', request.url));
  }

  // Coach essaie d'accéder à l'espace client → redirige vers /dashboard
  if (role === 'coach' && isClientPath) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return response;
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/clients/:path*',
    '/calendar/:path*',
    '/calls/:path*',
    '/messages/:path*',
    '/analytics/:path*',
    '/ressources/:path*',
    '/settings/:path*',
    '/client/:path*',
    '/tasks/:path*',
    '/ai/:path*',
    '/metrics/:path*',
    '/api-debug/:path*',
    '/ig-live/:path*',
    '/pipeline/:path*',
    '/liens/:path*',
    '/mes-stats/:path*',
  ],
};
