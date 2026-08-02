import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const body = await request.json();
  const { name, email, niche } = body as { name?: string; email?: string; niche?: string };
  if (!name?.trim()) return NextResponse.json({ error: 'Nom requis' }, { status: 400 });
  if (!email?.trim()) return NextResponse.json({ error: 'Email requis' }, { status: 400 });

  const { data: clientRow, error: insertErr } = await serviceSupabase
    .from('clients')
    .insert({
      coach_id: user.id,
      name: name.trim(),
      email: email.trim(),
      niche: niche?.trim() || null,
      week: 1,
    })
    .select('id')
    .single();

  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

  const { origin } = new URL(request.url);
  const { error: inviteErr } = await serviceSupabase.auth.admin.inviteUserByEmail(email.trim(), {
    redirectTo: `${origin}/auth/callback?next=/invite/callback`,
    data: { client_id: clientRow.id },
  });

  if (inviteErr) {
    // Rollback de la ligne clients pour ne pas laisser un élève fantôme sans invitation.
    await serviceSupabase.from('clients').delete().eq('id', clientRow.id);
    return NextResponse.json({ error: inviteErr.message }, { status: 500 });
  }

  return NextResponse.json({ client_id: clientRow.id });
}
