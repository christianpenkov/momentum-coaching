import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

// ⚠️ Un journal de navigation (`logNavigation`) vivait ici : une écriture dans
// `webhook_debug_log` avec la clé ANON à chaque page ouverte, pour l'enquête sur le
// double démarrage de l'app (close, voir components/AppBootstrap.tsx).
// Retiré le 2026-09-13 : depuis le verrouillage RLS du 2026-09-02, la table n'a aucune
// policy, donc CHAQUE écriture était refusée — 222 lignes jusqu'au 02/09 16:39, zéro
// depuis — et son `.catch(() => {})` ne lisait pas le statut. Il ne journalisait donc
// plus rien et coûtait une requête refusée par navigation, sur un quota d'egress qui se
// paie au NOMBRE de requêtes (AGENTS.md). Ne pas le réintroduire avec la clé anon.

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

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
