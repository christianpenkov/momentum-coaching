import { createClient } from '@supabase/supabase-js';

/**
 * Création de liens Short.io côté serveur.
 *
 * `app/api/shortio/links` fait la même chose mais s'authentifie par session
 * utilisateur : inutilisable depuis un webhook ou une route qui agit pour le
 * compte de quelqu'un d'autre. Ce helper prend le profil en paramètre.
 *
 * `buildDestUrl` était jusqu'ici dupliqué dans quatre fichiers (route shortio,
 * webhook Instagram × 2, story-sequences). Il vit ici désormais — les appelants
 * existants peuvent migrer au fil de l'eau.
 */

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface Utms {
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
  term?: string;
}

/** Pose les UTM sur l'URL de destination. Les paramètres déjà présents sont écrasés. */
export function buildDestUrl(originalUrl: string, utms: Utms): string {
  const url = new URL(originalUrl);
  if (utms.source) url.searchParams.set('utm_source', utms.source);
  if (utms.medium) url.searchParams.set('utm_medium', utms.medium);
  if (utms.campaign) url.searchParams.set('utm_campaign', utms.campaign);
  if (utms.content) url.searchParams.set('utm_content', utms.content);
  if (utms.term) url.searchParams.set('utm_term', utms.term);
  return url.toString();
}

async function getCreds(profileId: string): Promise<{ apiKey: string; domain: string | null } | null> {
  const { data: integ } = await serviceSupabase
    .from('integrations')
    .select('api_key, metadata')
    .eq('profile_id', profileId)
    .eq('provider', 'shortio')
    .maybeSingle();
  if (!integ?.api_key) return null;
  return { apiKey: integ.api_key, domain: (integ.metadata as any)?.domain ?? null };
}

export interface ShortLink {
  id: string;
  shortUrl: string;
  path: string;
}

/**
 * Raccourcit une URL, en enrobant les échecs plutôt qu'en les propageant.
 *
 * Renvoie `null` si Short.io n'est pas connecté ou refuse : un lien de paiement
 * doit exister même sans raccourcisseur. L'appelant retombe alors sur l'URL
 * Stripe brute — on perd le tracking du clic, jamais la capacité d'encaisser.
 *
 * PAS de `path` fixe : contrairement aux liens Calendly (un par prospect, réutilisé),
 * les liens de paiement s'accumulent. Le fallback 409 de la route existante ne
 * liste que 150 liens et échouerait silencieusement au-delà. On laisse Short.io
 * générer un path aléatoire et on stocke l'ID retourné.
 */
export async function shortenUrl(
  profileId: string,
  originalUrl: string,
  opts: { title?: string; utms?: Utms } = {},
): Promise<ShortLink | null> {
  const creds = await getCreds(profileId);
  if (!creds) return null;

  const destUrl = opts.utms ? buildDestUrl(originalUrl, opts.utms) : originalUrl;

  try {
    const res = await fetch('https://api.short.io/links', {
      method: 'POST',
      headers: {
        authorization: creds.apiKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        domain: creds.domain,
        originalURL: destUrl,
        title: opts.title || 'Paiement',
      }),
    });

    if (!res.ok) {
      console.error(`[shortio] création refusée (${res.status})`, await res.text().catch(() => ''));
      return null;
    }

    const data = await res.json();
    const shortUrl = data.secureShortURL || data.shortURL;
    if (!shortUrl) return null;

    return { id: data.idString || data.id, shortUrl, path: data.path };
  } catch (err) {
    console.error('[shortio] création impossible', err);
    return null;
  }
}
