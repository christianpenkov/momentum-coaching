import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function getCreds(profileId: string): Promise<{ apiKey: string; domainId: number | null } | null> {
  const { data: integ } = await serviceSupabase
    .from('integrations')
    .select('api_key, metadata')
    .eq('profile_id', profileId)
    .eq('provider', 'shortio')
    .single();
  if (!integ?.api_key) return null;
  return { apiKey: integ.api_key, domainId: (integ.metadata as any)?.domain_id ?? null };
}

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const body = await request.json();
  const { profileId, domainId, originalUrl, title, utmSource, utmMedium, utmCampaign, utmContent, path } = body;

  let targetProfileId = user.id;
  if (profileId && profileId !== user.id) {
    const { data: clientRow } = await serviceSupabase
      .from('clients')
      .select('id')
      .eq('profile_id', profileId)
      .eq('coach_id', user.id)
      .single();
    if (!clientRow) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    targetProfileId = profileId;
  }

  const creds = await getCreds(targetProfileId);
  if (!creds) {
    console.error('[shortio/links] Clé API manquante pour profileId:', targetProfileId);
    return NextResponse.json({ error: 'no_token', profileId: targetProfileId }, { status: 400 });
  }
  const { apiKey, domainId: numericDomainId } = creds;

  // Build the destination URL with UTM params
  const destUrl = new URL(originalUrl);
  if (utmSource) destUrl.searchParams.set('utm_source', utmSource);
  if (utmMedium) destUrl.searchParams.set('utm_medium', utmMedium);
  if (utmCampaign) destUrl.searchParams.set('utm_campaign', utmCampaign);
  if (utmContent) destUrl.searchParams.set('utm_content', utmContent);

  const payload: Record<string, any> = {
    domain: domainId,
    originalURL: destUrl.toString(),
    title: title || utmCampaign || 'Lien Calendly',
  };
  if (path) payload.path = path;

  const res = await fetch('https://api.short.io/links', {
    method: 'POST',
    headers: {
      authorization: apiKey,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));

  // 409 = path déjà utilisé → récupère le lien existant et le retourne
  if (res.status === 409 && path && numericDomainId) {
    const existingRes = await fetch(
      `https://api.short.io/api/links?domain_id=${numericDomainId}&limit=150`,
      { headers: { authorization: apiKey, accept: 'application/json' } }
    );
    const existingData = await existingRes.json().catch(() => ({}));
    const existing = (existingData?.links || []).find((l: any) => l.path === path);
    if (existing) {
      return NextResponse.json({
        id: existing.id,
        shortUrl: existing.secureShortURL || existing.shortURL,
        path: existing.path,
        originalUrl: existing.originalURL,
        existed: true,
      });
    }
  }

  if (!res.ok) {
    console.error('[shortio/links] Erreur Short.io', res.status, JSON.stringify(data), JSON.stringify(payload));
    return NextResponse.json({ error: data?.message || `Erreur Short.io HTTP ${res.status}`, details: data }, { status: 400 });
  }

  return NextResponse.json({
    id: data.id,
    shortUrl: data.secureShortURL || data.shortURL || data.shortUrl,
    path: data.path,
    originalUrl: data.originalURL,
  });
}
