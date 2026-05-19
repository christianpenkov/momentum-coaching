import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function GET(request: NextRequest) {
  const { origin } = new URL(request.url);
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

  const state = Buffer.from(user.id).toString('base64');

  const params = new URLSearchParams({
    client_id: process.env.INSTAGRAM_CLIENT_ID!,
    redirect_uri: `${process.env.NEXT_PUBLIC_PLATFORM_URL}/api/oauth/instagram/callback`,
    scope: 'instagram_business_basic,instagram_business_manage_insights,instagram_business_manage_messages,instagram_business_manage_comments',
    response_type: 'code',
    state,
  });

  return NextResponse.redirect(`https://www.instagram.com/oauth/authorize?${params}`);
}
