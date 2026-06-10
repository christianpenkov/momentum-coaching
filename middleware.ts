import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

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
    '/resources/:path*',
    '/settings/:path*',
    '/client/:path*',
  ],
};
