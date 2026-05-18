import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Routes publiques
  const publicRoutes = ['/login', '/signup', '/signup/confirm', '/auth/callback'];
  if (publicRoutes.includes(pathname)) return supabaseResponse;

  // Non connecté → login
  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // Récupérer le rôle
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  const role = profile?.role;

  // Élève qui essaie d'accéder aux routes coach
  if (role === 'client' && !pathname.startsWith('/espace') && pathname !== '/') {
    return NextResponse.redirect(new URL('/espace', request.url));
  }

  // Coach qui essaie d'accéder aux routes élève
  if (role === 'coach' && pathname.startsWith('/espace')) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return supabaseResponse;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|fonts|logo|.*\\.png$|.*\\.svg$).*)'],
};
