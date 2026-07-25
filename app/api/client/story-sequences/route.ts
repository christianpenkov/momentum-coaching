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

  const { data: sequences, error } = await serviceSupabase
    .from('story_sequences')
    .select('id, name, cta_type, cta_story_id, lm_keyword, lm_url, dm1_message, dm2_story_message, calendly_short_url, created_at')
    .eq('profile_id', user.id)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const seqIds = (sequences || []).map(s => s.id);
  const { data: counts } = seqIds.length
    ? await serviceSupabase.from('ig_stories').select('sequence_id').in('sequence_id', seqIds)
    : { data: [] };
  const countBySeq = new Map<string, number>();
  for (const row of counts || []) {
    countBySeq.set(row.sequence_id, (countBySeq.get(row.sequence_id) || 0) + 1);
  }

  const rows = (sequences || []).map(s => ({ ...s, story_count: countBySeq.get(s.id) || 0 }));
  return NextResponse.json({ sequences: rows });
}

// POST — crée une séquence à partir d'une sélection de stories. Pour le CTA Calendly,
// génère un lien Short.io trackable classique (réutilise POST /api/shortio/links) que
// l'élève devra ajouter lui-même via le sticker "Lien" natif Instagram — impossible
// d'insérer un lien directement dans une story déjà publiée.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }); }

  const { name, ctaType, ctaStoryId, storyIds, lmId, lmKeyword, lmUrl, dm1Message, dm2StoryMessage } = body;
  if (!name?.trim() || !ctaType || !ctaStoryId || !Array.isArray(storyIds) || storyIds.length === 0) {
    return NextResponse.json({ error: 'Champs requis manquants' }, { status: 400 });
  }
  if (ctaType !== 'lead_magnet' && ctaType !== 'calendly') {
    return NextResponse.json({ error: 'ctaType invalide' }, { status: 400 });
  }

  // Vérifie qu'aucune des stories sélectionnées n'appartient déjà à une séquence —
  // une story ne peut appartenir qu'à une seule séquence à la fois.
  const { data: alreadyAssigned } = await serviceSupabase
    .from('ig_stories')
    .select('id')
    .eq('profile_id', user.id)
    .in('id', storyIds)
    .not('sequence_id', 'is', null);
  if (alreadyAssigned && alreadyAssigned.length > 0) {
    return NextResponse.json({ error: 'Une des stories sélectionnées appartient déjà à une séquence' }, { status: 409 });
  }

  if (ctaType === 'calendly') {
    const { data: settings } = await serviceSupabase.from('clients').select('calendly_url').eq('profile_id', user.id).single();
    if (!settings?.calendly_url) return NextResponse.json({ error: 'Aucun lien Calendly configuré dans les Réglages' }, { status: 400 });
    const { data: shortioInteg } = await serviceSupabase.from('integrations').select('api_key, metadata').eq('profile_id', user.id).eq('provider', 'shortio').single();
    if (!shortioInteg?.api_key || !(shortioInteg?.metadata as any)?.domain) return NextResponse.json({ error: 'Short.io non configuré' }, { status: 400 });
  }

  // Crée la séquence D'ABORD (avant le lien Calendly) pour disposer de son id — le
  // lien Short.io porte utm_content=seq.id, pivot d'attribution business daté au clic,
  // indépendant de l'état mutable de instagram_leads (voir matchesContent, TabFunnel).
  const { data: seq, error: seqErr } = await serviceSupabase
    .from('story_sequences')
    .insert({
      profile_id: user.id,
      name: name.trim(),
      cta_type: ctaType,
      cta_story_id: ctaStoryId,
      lm_keyword: ctaType === 'lead_magnet' ? (lmKeyword || '').toUpperCase().trim() : null,
      lm_id: ctaType === 'lead_magnet' ? (lmId || null) : null,
      lm_url: ctaType === 'lead_magnet' ? (lmUrl || null) : null,
      dm1_message: ctaType === 'lead_magnet' ? (dm1Message || null) : null,
      dm2_story_message: ctaType === 'lead_magnet' ? (dm2StoryMessage || null) : null,
    })
    .select('id')
    .single();

  if (seqErr) return NextResponse.json({ error: seqErr.message }, { status: 500 });

  const { error: updateErr } = await serviceSupabase
    .from('ig_stories')
    .update({ sequence_id: seq.id })
    .in('id', storyIds)
    .eq('profile_id', user.id);
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  let calendlyShortUrl: string | null = null;

  if (ctaType === 'calendly') {
    const { data: settings } = await serviceSupabase.from('clients').select('calendly_url').eq('profile_id', user.id).single();
    const { data: shortioInteg } = await serviceSupabase.from('integrations').select('api_key, metadata').eq('profile_id', user.id).eq('provider', 'shortio').single();
    const apiKey = shortioInteg!.api_key;
    const domain = (shortioInteg!.metadata as any).domain;
    const calendlyUrl = settings!.calendly_url;

    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
    const path = `story-calendly-${slug}`;

    const destUrl = new URL(calendlyUrl);
    destUrl.searchParams.set('utm_source', 'ig');
    destUrl.searchParams.set('utm_medium', 'story');
    destUrl.searchParams.set('utm_campaign', slug);
    destUrl.searchParams.set('utm_content', seq.id);

    const linkRes = await fetch('https://api.short.io/links', {
      method: 'POST',
      headers: { authorization: apiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ domain, originalURL: destUrl.toString(), title: `Story — ${name}`, path }),
    });
    const linkData = await linkRes.json().catch(() => ({}));
    if (linkRes.ok || linkRes.status === 409) {
      calendlyShortUrl = linkData.secureShortURL || linkData.shortURL || null;
      await serviceSupabase.from('story_sequences').update({ calendly_short_url: calendlyShortUrl, calendly_dest_url: calendlyUrl }).eq('id', seq.id);
    }
  }

  return NextResponse.json({ id: seq.id, calendlyShortUrl });
}

export async function PATCH(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }); }
  const { id, name, dm1Message, dm2StoryMessage, lmKeyword } = body;
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 });

  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  if (name !== undefined) patch.name = name.trim();
  if (dm1Message !== undefined) patch.dm1_message = dm1Message;
  if (dm2StoryMessage !== undefined) patch.dm2_story_message = dm2StoryMessage;
  if (lmKeyword !== undefined) patch.lm_keyword = (lmKeyword || '').toUpperCase().trim();

  const { error } = await serviceSupabase.from('story_sequences').update(patch).eq('id', id).eq('profile_id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
