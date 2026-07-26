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
    .select('id, name, cta_story_id, lm_id, lm_keyword, lm_url, dm1_message, dm2_story_message, calendly_short_url, created_at')
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

// Vérifie la contrainte de contiguïté : deux séquences distinctes ne peuvent jamais
// être "entrelacées" — aucune story appartenant à une AUTRE séquence ne doit se situer
// (dans l'ordre chronologique posted_at) entre le min et le max de finalStoryIds.
// Des stories encore libres (sans séquence) peuvent en revanche s'intercaler librement.
// excludeSequenceId : la séquence en cours d'édition elle-même, à ne pas compter comme
// "autre séquence" (utilisé par l'ajout de stories à une séquence existante).
async function validateContiguity(
  profileId: string,
  finalStoryIds: string[],
  excludeSequenceId: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: selectedStories } = await serviceSupabase
    .from('ig_stories')
    .select('id, posted_at')
    .eq('profile_id', profileId)
    .in('id', finalStoryIds);
  if (!selectedStories || selectedStories.length !== finalStoryIds.length) {
    return { ok: false, error: 'Stories introuvables' };
  }
  const postedDates = selectedStories.map(s => new Date(s.posted_at).getTime());
  const minPosted = new Date(Math.min(...postedDates)).toISOString();
  const maxPosted = new Date(Math.max(...postedDates)).toISOString();

  let query = serviceSupabase
    .from('ig_stories')
    .select('id, sequence_id, story_sequences!ig_stories_sequence_id_fkey(name)')
    .eq('profile_id', profileId)
    .not('sequence_id', 'is', null)
    .gt('posted_at', minPosted)
    .lt('posted_at', maxPosted)
    .not('id', 'in', `(${finalStoryIds.join(',')})`);
  if (excludeSequenceId) query = query.neq('sequence_id', excludeSequenceId);

  const { data: interleaved } = await query;
  if (interleaved && interleaved.length > 0) {
    const clashName = (interleaved[0] as any).story_sequences?.name || 'une autre séquence';
    return { ok: false, error: `Cette sélection chevauche la séquence « ${clashName} »` };
  }
  return { ok: true };
}

// POST — crée une séquence à partir d'une sélection de stories. Les 2 blocs CTA
// (Lead Magnet / Calendly) sont indépendants, comme content_links pour les posts —
// au moins un des deux doit être fourni. Pour le CTA Calendly, génère un lien Short.io
// trackable classique (réutilise POST /api/shortio/links) que l'élève devra ajouter
// lui-même via le sticker "Lien" natif Instagram — impossible d'insérer un lien
// directement dans une story déjà publiée.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }); }

  const { name, ctaStoryId, storyIds, lmId, lmKeyword, lmUrl, dm1Message, dm2StoryMessage, wantsCalendly } = body;
  const wantsLm = !!lmKeyword;
  if (!name?.trim() || !ctaStoryId || !Array.isArray(storyIds) || storyIds.length === 0) {
    return NextResponse.json({ error: 'Champs requis manquants' }, { status: 400 });
  }
  if (!wantsLm && !wantsCalendly) {
    return NextResponse.json({ error: 'Configure au moins un Lead Magnet ou un lien Calendly' }, { status: 400 });
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

  const contiguity = await validateContiguity(user.id, storyIds, null);
  if (!contiguity.ok) return NextResponse.json({ error: contiguity.error }, { status: 409 });

  if (wantsCalendly) {
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
      cta_story_id: ctaStoryId,
      lm_keyword: wantsLm ? (lmKeyword || '').toUpperCase().trim() : null,
      lm_id: wantsLm ? (lmId || null) : null,
      lm_url: wantsLm ? (lmUrl || null) : null,
      dm1_message: wantsLm ? (dm1Message || null) : null,
      dm2_story_message: wantsLm ? (dm2StoryMessage || null) : null,
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

  if (wantsCalendly) {
    calendlyShortUrl = await generateCalendlyLink(user.id, seq.id, name);
  }

  return NextResponse.json({ id: seq.id, calendlyShortUrl });
}

async function generateCalendlyLink(profileId: string, sequenceId: string, name: string): Promise<string | null> {
  const { data: settings } = await serviceSupabase.from('clients').select('calendly_url').eq('profile_id', profileId).single();
  const { data: shortioInteg } = await serviceSupabase.from('integrations').select('api_key, metadata').eq('profile_id', profileId).eq('provider', 'shortio').single();
  if (!settings?.calendly_url || !shortioInteg?.api_key || !(shortioInteg?.metadata as any)?.domain) return null;
  const apiKey = shortioInteg.api_key;
  const domain = (shortioInteg.metadata as any).domain;
  const calendlyUrl = settings.calendly_url;

  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  const path = `story-calendly-${slug}`;

  const destUrl = new URL(calendlyUrl);
  destUrl.searchParams.set('utm_source', 'ig');
  destUrl.searchParams.set('utm_medium', 'story');
  destUrl.searchParams.set('utm_campaign', slug);
  destUrl.searchParams.set('utm_content', sequenceId);

  const linkRes = await fetch('https://api.short.io/links', {
    method: 'POST',
    headers: { authorization: apiKey, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ domain, originalURL: destUrl.toString(), title: `Story — ${name}`, path }),
  });
  const linkData = await linkRes.json().catch(() => ({}));
  if (linkRes.ok || linkRes.status === 409) {
    const shortUrl = linkData.secureShortURL || linkData.shortURL || null;
    if (shortUrl) {
      await serviceSupabase.from('story_sequences').update({ calendly_short_url: shortUrl, calendly_dest_url: calendlyUrl }).eq('id', sequenceId);
    }
    return shortUrl;
  }
  return null;
}

// PATCH — édite une séquence existante : nom/mot-clé LM/messages DM (déjà supporté),
// génération du lien Calendly après coup (generateCalendly: true), et composition
// (addStoryIds/removeStoryIds).
export async function PATCH(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }); }
  const { id, name, dm1Message, dm2StoryMessage, lmKeyword, generateCalendly, addStoryIds, removeStoryIds } = body;
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 });

  const { data: seq, error: seqFetchErr } = await serviceSupabase
    .from('story_sequences')
    .select('id, name, cta_story_id, calendly_short_url')
    .eq('id', id)
    .eq('profile_id', user.id)
    .maybeSingle();
  if (seqFetchErr) return NextResponse.json({ error: seqFetchErr.message }, { status: 500 });
  if (!seq) return NextResponse.json({ error: 'Séquence introuvable' }, { status: 404 });

  // ── Retrait de stories ──────────────────────────────────────────────────
  if (Array.isArray(removeStoryIds) && removeStoryIds.length > 0) {
    const { data: currentStories } = await serviceSupabase
      .from('ig_stories')
      .select('id')
      .eq('profile_id', user.id)
      .eq('sequence_id', id);
    const currentIds = (currentStories || []).map(s => s.id);
    const remainingIds = currentIds.filter(sid => !removeStoryIds.includes(sid));

    if (remainingIds.length > 0 && removeStoryIds.includes(seq.cta_story_id)) {
      return NextResponse.json({ error: 'Déplace d\'abord le CTA sur une autre story avant de la retirer' }, { status: 409 });
    }

    if (remainingIds.length === 0) {
      // Dernière story retirée — supprime la séquence entière, les stories redeviennent libres.
      const { error: delErr } = await serviceSupabase.from('story_sequences').delete().eq('id', id).eq('profile_id', user.id);
      if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
      return NextResponse.json({ ok: true, sequenceDeleted: true });
    }

    const { error: removeErr } = await serviceSupabase
      .from('ig_stories')
      .update({ sequence_id: null })
      .in('id', removeStoryIds)
      .eq('profile_id', user.id);
    if (removeErr) return NextResponse.json({ error: removeErr.message }, { status: 500 });
  }

  // ── Ajout de stories ────────────────────────────────────────────────────
  if (Array.isArray(addStoryIds) && addStoryIds.length > 0) {
    const { data: alreadyAssigned } = await serviceSupabase
      .from('ig_stories')
      .select('id')
      .eq('profile_id', user.id)
      .in('id', addStoryIds)
      .not('sequence_id', 'is', null);
    if (alreadyAssigned && alreadyAssigned.length > 0) {
      return NextResponse.json({ error: 'Une des stories sélectionnées appartient déjà à une séquence' }, { status: 409 });
    }

    const { data: currentStories } = await serviceSupabase
      .from('ig_stories')
      .select('id')
      .eq('profile_id', user.id)
      .eq('sequence_id', id);
    const finalStoryIds = [...new Set([...(currentStories || []).map(s => s.id), ...addStoryIds])];

    const contiguity = await validateContiguity(user.id, finalStoryIds, id);
    if (!contiguity.ok) return NextResponse.json({ error: contiguity.error }, { status: 409 });

    const { error: addErr } = await serviceSupabase
      .from('ig_stories')
      .update({ sequence_id: id })
      .in('id', addStoryIds)
      .eq('profile_id', user.id);
    if (addErr) return NextResponse.json({ error: addErr.message }, { status: 500 });
  }

  // ── Champs simples + génération Calendly après coup ────────────────────
  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  if (name !== undefined) patch.name = name.trim();
  if (dm1Message !== undefined) patch.dm1_message = dm1Message;
  if (dm2StoryMessage !== undefined) patch.dm2_story_message = dm2StoryMessage;
  if (lmKeyword !== undefined) patch.lm_keyword = (lmKeyword || '').toUpperCase().trim();

  if (Object.keys(patch).length > 1) {
    const { error } = await serviceSupabase.from('story_sequences').update(patch).eq('id', id).eq('profile_id', user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let calendlyShortUrl: string | null = seq.calendly_short_url;
  if (generateCalendly && !seq.calendly_short_url) {
    calendlyShortUrl = await generateCalendlyLink(user.id, id, patch.name ?? seq.name);
    if (!calendlyShortUrl) return NextResponse.json({ error: 'Impossible de générer le lien Calendly — vérifie ta configuration Calendly/Short.io dans les Réglages' }, { status: 400 });
  }

  return NextResponse.json({ ok: true, calendlyShortUrl });
}
