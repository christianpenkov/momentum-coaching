import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

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

  for (const lead of leads) {
    try {
      const profileRes = await fetch(
        `https://graph.instagram.com/v22.0/${lead.ig_user_id}?fields=profile_pic&access_token=${token}`
      );
      if (!profileRes.ok) { errors.push(`${lead.ig_username}: profile fetch ${profileRes.status}`); continue; }
      const profileData = await profileRes.json();
      const profilePicUrl: string | undefined = profileData?.profile_pic;
      if (!profilePicUrl) { errors.push(`${lead.ig_username}: no profile_pic`); continue; }

      const imgRes = await fetch(profilePicUrl);
      if (!imgRes.ok) { errors.push(`${lead.ig_username}: img fetch ${imgRes.status}`); continue; }
      const arrayBuffer = await imgRes.arrayBuffer();

      const { error: uploadError } = await serviceSupabase.storage
        .from('instagram-avatars')
        .upload(`${lead.ig_user_id}.jpg`, arrayBuffer, { contentType: 'image/jpeg', upsert: true });

      if (uploadError) { errors.push(`${lead.ig_username}: upload ${uploadError.message}`); continue; }

      const { data: { publicUrl } } = serviceSupabase.storage
        .from('instagram-avatars')
        .getPublicUrl(`${lead.ig_user_id}.jpg`);

      await serviceSupabase
        .from('instagram_leads')
        .update({ avatar_url: publicUrl })
        .eq('id', lead.id);

      updated++;
    } catch (e: any) {
      errors.push(`${lead.ig_username}: ${e?.message || 'unknown'}`);
    }
  }

  return NextResponse.json({ ok: true, updated, total: leads.length, errors });
}
