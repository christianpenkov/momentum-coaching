import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  return `https://${trimmed}`;
}

// Propagation : met à jour Short.io pour tous les content_links desc qui pointent vers ce LM.
// Batching : 5 requêtes en parallèle max, 200ms entre chaque batch pour éviter le rate-limiting.
async function propagateLmUrlChange(profileId: string, lmId: string, newUrl: string) {
  // 1. Récupérer les creds Short.io du profil
  const { data: integ } = await serviceSupabase
    .from('integrations')
    .select('api_key')
    .eq('profile_id', profileId)
    .eq('provider', 'shortio')
    .single();
  if (!integ?.api_key) return; // Pas de Short.io configuré — on skip silencieusement

  const apiKey = integ.api_key;

  // 2. Trouver tous les content_links avec ce lm_id ET un lien description LM existant
  const { data: links } = await serviceSupabase
    .from('content_links')
    .select('id, desc_short_id, desc_utms')
    .eq('profile_id', profileId)
    .eq('lm_id', lmId)
    .eq('desc_dest_type', 'leadmagnet')
    .not('desc_short_id', 'is', null);

  if (!links || links.length === 0) return;

  // 3. Batch de 5 mises à jour en parallèle avec 200ms entre chaque batch
  const BATCH_SIZE = 5;
  const BATCH_DELAY_MS = 200;

  for (let i = 0; i < links.length; i += BATCH_SIZE) {
    const batch = links.slice(i, i + BATCH_SIZE);

    await Promise.all(batch.map(async (link) => {
      if (!link.desc_short_id) return;

      // Reconstruit l'URL avec les UTM spécifiques à ce contenu
      const utms = (link.desc_utms as Record<string, string>) || {};
      const destUrl = new URL(newUrl);
      if (utms.source) destUrl.searchParams.set('utm_source', utms.source);
      if (utms.medium) destUrl.searchParams.set('utm_medium', utms.medium);
      if (utms.campaign) destUrl.searchParams.set('utm_campaign', utms.campaign);
      if (utms.content) destUrl.searchParams.set('utm_content', utms.content);

      try {
        const res = await fetch(`https://api.short.io/links/${link.desc_short_id}`, {
          method: 'POST',
          headers: { authorization: apiKey, 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ originalURL: destUrl.toString() }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          console.error(`[propagateLmUrl] Erreur Short.io pour link ${link.id}:`, err);
        }
      } catch (e) {
        console.error(`[propagateLmUrl] Exception pour link ${link.id}:`, e);
      }
    }));

    // Délai entre batches (sauf pour le dernier)
    if (i + BATCH_SIZE < links.length) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }
}

export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { data, error } = await serviceSupabase
    .from('lead_magnets')
    .select('id, name, url, keyword, bio_ig_url, bio_yt_url, bio_ig_source_url, bio_yt_source_url, created_at')
    .eq('profile_id', user.id)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ lead_magnets: data ?? [] });
}

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }); }
  const { name, url, keyword } = body;

  if (!url?.trim()) return NextResponse.json({ error: 'URL requise' }, { status: 400 });

  const normalizedUrl = normalizeUrl(url);
  const cleanKeyword = (keyword || '').toUpperCase().trim().replace(/\s+/g, '');

  const { data, error } = await serviceSupabase
    .from('lead_magnets')
    .insert({ profile_id: user.id, name: name?.trim() || normalizedUrl, url: normalizedUrl, keyword: cleanKeyword })
    .select('id, name, url, keyword, bio_ig_url, bio_yt_url, bio_ig_source_url, bio_yt_source_url, created_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ lead_magnet: data });
}

export async function PATCH(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }); }
  const { id, name, url, keyword, bio_ig_url, bio_yt_url, bio_ig_source_url, bio_yt_source_url } = body;
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 });

  // Récupérer l'ancienne URL pour détecter si elle a changé
  const { data: existing } = await serviceSupabase
    .from('lead_magnets')
    .select('url')
    .eq('id', id)
    .eq('profile_id', user.id)
    .single();

  const patch: Record<string, any> = {};
  if (url !== undefined) { patch.url = normalizeUrl(url); patch.name = name?.trim() || normalizeUrl(url); }
  if (name !== undefined && url === undefined) patch.name = name.trim();
  if (keyword !== undefined) patch.keyword = (keyword || '').toUpperCase().trim().replace(/\s+/g, '');
  if (bio_ig_url !== undefined) patch.bio_ig_url = bio_ig_url;
  if (bio_yt_url !== undefined) patch.bio_yt_url = bio_yt_url;
  if (bio_ig_source_url !== undefined) patch.bio_ig_source_url = bio_ig_source_url;
  if (bio_yt_source_url !== undefined) patch.bio_yt_source_url = bio_yt_source_url;

  const { data, error } = await serviceSupabase
    .from('lead_magnets')
    .update(patch)
    .eq('id', id)
    .eq('profile_id', user.id)
    .select('id, name, url, keyword, bio_ig_url, bio_yt_url, bio_ig_source_url, bio_yt_source_url, created_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Propagation asynchrone si l'URL a changé — ne bloque pas la réponse
  const newUrl = patch.url;
  if (newUrl && existing?.url && newUrl !== existing.url) {
    propagateLmUrlChange(user.id, id, newUrl).catch(e =>
      console.error('[lead-magnets PATCH] propagation error:', e)
    );
  }

  return NextResponse.json({ lead_magnet: data });
}

export async function DELETE(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 });

  const { error } = await serviceSupabase
    .from('lead_magnets')
    .delete()
    .eq('id', id)
    .eq('profile_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
