import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { buildDestUrl } from '@/lib/shortio-create';
import { construireDestinationShortio } from '@/lib/click-redirect';

/**
 * Fait passer la destination d'un lien Calendry PARTAGÉ par la route qui pose le
 * Click ID, quand c'est possible.
 *
 * Sans quoi le chantier Click ID se dégraderait tout seul : les liens existants
 * seraient réécrits une fois par le script de migration, mais chaque nouveau
 * contenu publié recréerait un lien pointant droit sur Calendly, donc sans
 * identifiant de clic. La mesure s'éroderait sans que rien ne le signale.
 *
 * `construireDestinationShortio` renvoie `null` — et on garde alors la
 * destination directe, exactement comme avant ce chantier — dans quatre cas :
 * domaine de redirection non configuré, hôte hors liste blanche (lead magnet,
 * paiement), canal non partagé (`dm`), destination déjà réécrite.
 */
function versLaRouteDeClic(destUrl: string, path: string | undefined, profileId: string): string {
  if (!path) return destUrl;
  return construireDestinationShortio(process.env.MOMENTUM_REDIRECT_ORIGIN, path, destUrl, profileId) ?? destUrl;
}

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

async function resolveProfileId(user: { id: string }, profileId: string): Promise<string | null> {
  if (!profileId || profileId === user.id) return user.id;
  const { data: clientRow } = await serviceSupabase
    .from('clients')
    .select('id')
    .eq('profile_id', profileId)
    .eq('coach_id', user.id)
    .single();
  return clientRow ? profileId : null;
}

// POST — crée un nouveau lien. Si 409 (path existant), récupère l'ID existant et le retourne
// pour que l'appelant puisse faire un PATCH ensuite.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const body = await request.json();
  const { profileId, domainId, originalUrl, title, utmSource, utmMedium, utmCampaign, utmContent, utmTerm, path } = body;

  const targetProfileId = await resolveProfileId(user, profileId);
  if (!targetProfileId) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

  const creds = await getCreds(targetProfileId);
  if (!creds) return NextResponse.json({ error: 'no_token', profileId: targetProfileId }, { status: 400 });
  const { apiKey, domainId: numericDomainId } = creds;

  const destUrl = versLaRouteDeClic(
    buildDestUrl(originalUrl, { source: utmSource, medium: utmMedium, campaign: utmCampaign, content: utmContent, term: utmTerm }),
    path, targetProfileId,
  );

  const payload: Record<string, any> = {
    domain: domainId,
    originalURL: destUrl,
    title: title || utmCampaign || 'Lien',
  };
  if (path) payload.path = path;

  const res = await fetch('https://api.short.io/links', {
    method: 'POST',
    headers: { authorization: apiKey, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));

  // 409 = path déjà utilisé → récupère l'ID existant pour permettre un PATCH ultérieur
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
    console.error('[shortio/links POST]', res.status, JSON.stringify(data));
    return NextResponse.json({ error: data?.message || `Erreur Short.io HTTP ${res.status}`, details: data }, { status: 400 });
  }

  return NextResponse.json({
    id: data.id,
    shortUrl: data.secureShortURL || data.shortURL || data.shortUrl,
    path: data.path,
    originalUrl: data.originalURL,
  });
}

// PATCH — modifie la destination d'un lien existant (par son ID Short.io)
export async function PATCH(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const body = await request.json();
  // `path` est facultatif : sans lui, la destination reste directe. Il est fourni
  // par le repli 409 de PageLiens, seul chemin qui PATCHe un lien Calendly.
  const { profileId, shortId, originalUrl, title, utmSource, utmMedium, utmCampaign, utmContent, utmTerm, path } = body;

  if (!shortId) return NextResponse.json({ error: 'shortId requis' }, { status: 400 });

  const targetProfileId = await resolveProfileId(user, profileId);
  if (!targetProfileId) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

  const creds = await getCreds(targetProfileId);
  if (!creds) return NextResponse.json({ error: 'no_token' }, { status: 400 });
  const { apiKey } = creds;

  const destUrl = versLaRouteDeClic(
    buildDestUrl(originalUrl, { source: utmSource, medium: utmMedium, campaign: utmCampaign, content: utmContent, term: utmTerm }),
    path, targetProfileId,
  );

  const res = await fetch(`https://api.short.io/links/${shortId}`, {
    method: 'POST',
    headers: { authorization: apiKey, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      originalURL: destUrl,
      ...(title ? { title } : {}),
    }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    console.error('[shortio/links PATCH]', res.status, JSON.stringify(data));
    return NextResponse.json({ error: data?.message || `Erreur Short.io HTTP ${res.status}` }, { status: 400 });
  }

  return NextResponse.json({
    id: data.id,
    shortUrl: data.secureShortURL || data.shortURL || data.shortUrl,
    originalUrl: data.originalURL,
  });
}
