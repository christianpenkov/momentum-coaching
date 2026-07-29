import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { data, error } = await supa
    .from('content_links')
    .select('*')
    .eq('profile_id', user.id)
    .is('archived_at', null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ content_links: data ?? [] });
}

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }); }
  const {
    content_id, platform,
    // Ancien format (compat)
    desc_short_url, desc_short_id, desc_short_path, desc_utms, desc_dest_type,
    // Nouveau format — 3 liens séparés
    desc_calendly_short_id, desc_calendly_short_url,
    desc_lm_short_id, desc_lm_short_url, desc_lm_lm_id,
    desc_custom_short_id, desc_custom_short_url,
    lm_id, lm_short_url, lm_url, lm_keyword, dm_opener_message, dm_lm_message, dm_button_text,
  } = body;

  if (!content_id || !platform) return NextResponse.json({ error: 'content_id et platform requis' }, { status: 400 });
  if (dm_opener_message && dm_opener_message.length > 1000) return NextResponse.json({ error: 'dm_opener_message trop long (max 1000)' }, { status: 400 });
  if (dm_lm_message && dm_lm_message.length > 1000) return NextResponse.json({ error: 'dm_lm_message trop long (max 1000)' }, { status: 400 });
  if (dm_button_text && dm_button_text.length > 20) return NextResponse.json({ error: 'dm_button_text trop long (max 20)' }, { status: 400 });

  // content_links sert aussi YouTube — ig_account_id n'a de sens que pour Instagram
  // (posts ET stories). Valeurs réelles envoyées par le frontend (PageLiens.tsx) :
  // 'IG' | 'YT' | 'STORY' — pas 'instagram'/'youtube', comparaison insensible à la
  // casse pour ne jamais rater ce cas silencieusement (bug trouvé le 2026-07-30 :
  // ig_account_id restait NULL sur tous les content_links car la comparaison exacte
  // à 'instagram' ne matchait jamais 'IG').
  const platformLower = String(platform).toLowerCase();
  let igAccountId: string | null = null;
  if (platformLower === 'ig' || platformLower === 'story') {
    const { data: integ } = await supa
      .from('integrations')
      .select('metadata')
      .eq('profile_id', user.id)
      .eq('provider', 'instagram')
      .maybeSingle();
    igAccountId = (integ?.metadata as any)?.ig_account_id ?? null;
  }

  const { data, error } = await supa
    .from('content_links')
    .upsert({
      profile_id: user.id,
      content_id,
      platform,
      ...(igAccountId && { ig_account_id: igAccountId }),
      ...(desc_short_url !== undefined && { desc_short_url }),
      ...(desc_short_id !== undefined && { desc_short_id }),
      ...(desc_short_path !== undefined && { desc_short_path }),
      ...(desc_utms !== undefined && { desc_utms }),
      ...(desc_dest_type !== undefined && { desc_dest_type }),
      ...(desc_calendly_short_id !== undefined && { desc_calendly_short_id }),
      ...(desc_calendly_short_url !== undefined && { desc_calendly_short_url }),
      ...(desc_lm_short_id !== undefined && { desc_lm_short_id }),
      ...(desc_lm_short_url !== undefined && { desc_lm_short_url }),
      ...(desc_lm_lm_id !== undefined && { desc_lm_lm_id }),
      ...(desc_custom_short_id !== undefined && { desc_custom_short_id }),
      ...(desc_custom_short_url !== undefined && { desc_custom_short_url }),
      ...(lm_id !== undefined && { lm_id }),
      ...(lm_short_url !== undefined && { lm_short_url }),
      ...(lm_url !== undefined && { lm_url }),
      ...(lm_keyword !== undefined && { lm_keyword }),
      ...(dm_opener_message !== undefined && { dm_opener_message }),
      ...(dm_lm_message !== undefined && { dm_lm_message }),
      ...(dm_button_text !== undefined && { dm_button_text }),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'profile_id,content_id' })
    .select()
    .single();

  console.log('[content-links POST] dm_lm_message recu:', dm_lm_message, '| saved:', data?.dm_lm_message, '| error:', error?.message);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Synchronise le keyword dans lead_magnet_keywords pour que le webhook puisse le matcher
  if (lm_keyword && lm_keyword.trim()) {
    const cleanKeyword = lm_keyword.trim().toUpperCase();
    const { error: kwError } = await supa
      .from('lead_magnet_keywords')
      .upsert({ profile_id: user.id, keyword: cleanKeyword }, { onConflict: 'profile_id,keyword' });
    if (kwError) console.error('[content-links] lead_magnet_keywords sync failed:', kwError.message);
  }

  return NextResponse.json({ content_link: data });
}
