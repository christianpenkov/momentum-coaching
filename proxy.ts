import { NextResponse, type NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Routes publiques — laisser passer
  const publicRoutes = ['/login', '/signup', '/signup/confirm', '/auth/callback'];
  if (publicRoutes.some(r => pathname.startsWith(r))) {
    return NextResponse.next();
  }

  // Vérifier la session via le cookie Supabase
  const hasSession = request.cookies.getAll().some(c => c.name.includes('auth-token'));

  if (!hasSession && pathname !== '/') {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|fonts|logo|.*\\.png$|.*\\.svg$).*)'],
};
