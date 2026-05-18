import { NextRequest, NextResponse } from 'next/server';

// Routes protégées — nécessitent une session
const PROTECTED = ['/dashboard', '/clients', '/calendar', '/calls', '/messages', '/analytics', '/resources', '/settings', '/espace'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isProtected = PROTECTED.some(p => pathname === p || pathname.startsWith(p + '/'));
  if (!isProtected) return NextResponse.next();

  // Vérifie la présence du cookie de session Supabase
  const cookies = request.cookies;
  const hasSession = [...cookies.getAll()].some(c =>
    c.name.startsWith('sb-') && c.name.endsWith('-auth-token')
  );

  if (!hasSession) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
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
    '/espace/:path*',
  ],
};
