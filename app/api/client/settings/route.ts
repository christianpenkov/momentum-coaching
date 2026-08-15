import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { data: profile } = await serviceSupabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  // Le coach n'a jamais de ligne dans `clients` (table réservée aux élèves) — son
  // URL Calendly perso vit sur profiles.calendly_url. Voir PATCH ci-dessous.
  if (profile?.role === 'coach') {
    const { data } = await serviceSupabase
      .from('profiles')
      .select('calendly_url')
      .eq('id', user.id)
      .single();
    return NextResponse.json({ calendly_url: data?.calendly_url ?? null });
  }

  const { data } = await serviceSupabase
    .from('clients')
    .select('calendly_url')
    .eq('profile_id', user.id)
    .single();

  return NextResponse.json({ calendly_url: data?.calendly_url ?? null });
}

export async function PATCH(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const body = await request.json();
  const { calendly_url } = body;

  const { data: profile } = await serviceSupabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profile?.role === 'coach') {
    const { error } = await serviceSupabase
      .from('profiles')
      .update({ calendly_url: calendly_url ?? null })
      .eq('id', user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  const { error } = await serviceSupabase
    .from('clients')
    .update({ calendly_url: calendly_url ?? null })
    .eq('profile_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
