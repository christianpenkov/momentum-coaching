import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { recupererAvatar } from '@/lib/instagram-avatar';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// POST /api/instagram/backfill-avatars
// Remplit avatar_url pour tous les leads IG qui n'en ont pas encore
export async function POST() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { data: integ } = await serviceSupabase
    .from('integrations')
    .select('access_token')
    .eq('profile_id', user.id)
    .eq('provider', 'instagram')
    .maybeSingle();

  if (!integ?.access_token) return NextResponse.json({ error: 'no_token' }, { status: 400 });
  const token = integ.access_token;

  const { data: leads } = await serviceSupabase
    .from('instagram_leads')
    .select('id, ig_user_id, ig_username')
    .eq('profile_id', user.id)
    .is('avatar_url', null)
    .not('ig_user_id', 'is', null);

  if (!leads?.length) return NextResponse.json({ ok: true, updated: 0, message: 'Aucun lead sans avatar' });

  let updated = 0;
  const errors: string[] = [];

  // La MEME fonction que le webhook, pas une copie : les deux versions avaient
  // deja diverge (celle-ci disait pourquoi elle echouait, l'autre non).
  for (const lead of leads) {
    const { url, echec } = await recupererAvatar(serviceSupabase, lead.ig_user_id, token);
    if (url) {
      await serviceSupabase.from('instagram_leads').update({ avatar_url: url }).eq('id', lead.id);
      updated++;
    } else {
      errors.push(`${lead.ig_username}: ${echec}`);
    }
  }

  return NextResponse.json({ ok: true, updated, total: leads.length, errors });
}
