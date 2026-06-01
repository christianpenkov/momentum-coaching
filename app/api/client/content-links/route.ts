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
    .eq('profile_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ content_links: data ?? [] });
}

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const body = await request.json();
  const { content_id, platform, desc_short_url, desc_dest_type, lm_id, lm_short_url, lm_keyword, dm_opener_message, dm_lm_message } = body;

  if (!content_id || !platform) return NextResponse.json({ error: 'content_id et platform requis' }, { status: 400 });

  const { data, error } = await supa
    .from('content_links')
    .upsert({
      profile_id: user.id,
      content_id,
      platform,
      ...(desc_short_url !== undefined && { desc_short_url }),
      ...(desc_dest_type !== undefined && { desc_dest_type }),
      ...(lm_id !== undefined && { lm_id }),
      ...(lm_short_url !== undefined && { lm_short_url }),
      ...(lm_keyword !== undefined && { lm_keyword }),
      ...(dm_opener_message !== undefined && { dm_opener_message }),
      ...(dm_lm_message !== undefined && { dm_lm_message }),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'profile_id,content_id' })
    .select()
    .single();

  console.log('[content-links POST] dm_lm_message recu:', dm_lm_message, '| saved:', data?.dm_lm_message, '| error:', error?.message);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Synchronise le keyword dans lead_magnet_keywords pour que le webhook puisse le matcher
  if (lm_keyword && lm_keyword.trim()) {
    const cleanKeyword = lm_keyword.trim().toUpperCase();
    await supa
      .from('lead_magnet_keywords')
      .upsert({ profile_id: user.id, keyword: cleanKeyword }, { onConflict: 'profile_id,keyword' })
      .select();
  }

  return NextResponse.json({ content_link: data });
}
