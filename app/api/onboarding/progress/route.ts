import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { step, data } = await request.json();
  if (!step || typeof step !== 'string') {
    return NextResponse.json({ error: 'Paramètre step manquant' }, { status: 400 });
  }

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  if (!profile) return NextResponse.json({ error: 'Profil introuvable' }, { status: 404 });

  const table = profile.role === 'coach' ? 'profiles' : 'clients';
  const idColumn = profile.role === 'coach' ? 'id' : 'profile_id';

  const { data: current } = await supabase.from(table).select('onboarding_data').eq(idColumn, user.id).single();
  const mergedData = { ...(current?.onboarding_data || {}), ...(data || {}) };

  const { error } = await supabase.from(table)
    .update({ onboarding_step: step, onboarding_data: mergedData })
    .eq(idColumn, user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, onboarding_step: step, onboarding_data: mergedData });
}
