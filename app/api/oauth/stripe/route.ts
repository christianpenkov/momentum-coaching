import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// Démarre le flux OAuth Stripe Connect
// GET /api/oauth/stripe?role=coach|client
export async function GET(request: NextRequest) {
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
  if (!user) return NextResponse.redirect(new URL('/login', request.url));

  const clientId = process.env.STRIPE_CLIENT_ID!;
  const redirectUri = `${process.env.NEXT_PUBLIC_PLATFORM_URL}/api/oauth/stripe/callback`;

  // state = user_id encodé pour vérifier au retour
  const state = Buffer.from(user.id).toString('base64');

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: 'read_write',
    redirect_uri: redirectUri,
    state,
  });

  return NextResponse.redirect(`https://connect.stripe.com/oauth/authorize?${params}`);
}
