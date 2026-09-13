/**
 * Le classement des incidents — UNE seule règle, lue par les trois mondes.
 *
 * ── Pourquoi ce fichier existe ─────────────────────────────────────────────────────
 *
 * L'audit de surveillance du 2026-09-13 a compté ~150 écritures Supabase dont
 * l'erreur n'est jamais lue (`{ error }` ignoré), dans les webhooks Stripe, les DM,
 * Calendly, les paiements. `supabase-js` ne lève JAMAIS : une écriture refusée rend
 * `{ error }`, et si personne ne le lit, la route répond 200 pendant que la base n'a
 * rien reçu. Aucun log ne survit (Vercel Hobby : 1 h), aucune vue ne le voit.
 *
 * Corriger 150 endroits un par un aurait été long, fragile, et le 151ᵉ serait écrit
 * demain. Le filet est donc STRUCTUREL : `supabase-js` appelle `fetch` au moment de
 * chaque requête (`(...args) => fetch(...args)`, vérifié dans le code du paquet
 * 2.105.4), donc un `fetch` enveloppé une fois voit toutes les réponses de la base,
 * qu'un appelant lise son erreur ou non.
 *
 * Ce fichier décide, pour une réponse donnée, si c'est un incident et de quelle
 * gravité. Il est importé TEL QUEL par :
 *   · Vercel (Node)        — `lib/incidents.ts`, `instrumentation.ts`
 *   · les Edge Functions   — `supabase/functions/_shared/incidents.ts` (Deno)
 *   · le navigateur        — `components/AppBootstrap.tsx`
 *
 * ⚠️ D'où ses contraintes, à ne pas relâcher : AUCUN import, aucune API propre à un
 * runtime (ni `Buffer`, ni `crypto`, ni `Deno`, ni `window`), TypeScript effaçable
 * seulement (pas d'`enum`). Une copie par runtime aurait été le mode de panne
 * dominant de ce projet : deux règles qui divergent sans que rien ne le dise
 * (docs/sante-plateforme.md, « Une règle ne doit vivre qu'à UN endroit »).
 */

export type Gravite = 'critique' | 'normale';

/**
 * Codes d'erreur PostgREST/Postgres qui ne sont PAS des pannes.
 *
 * ⚠️ Chaque entrée a une raison, et la liste ne doit grandir qu'avec une raison
 * écrite. Un code ajouté « parce qu'il fait du bruit » transforme un défaut réel en
 * silence — exactement ce que ce filet existe pour fermer.
 */
export const CODES_BENINS: Record<string, string> = {
  // `.single()` sur zéro ligne : c'est une réponse (« rien »), pas un échec.
  PGRST116: 'aucune ligne pour .single()',
  // Violation d'unicité : plusieurs chemins s'en servent VOLONTAIREMENT comme garde
  // d'idempotence (ex. sync-stripe-payments écarte 23505 après un insert, webhook
  // rejoué deux fois). La signaler ferait crier chaque rejeu légitime.
  '23505': 'violation d’unicité utilisée comme garde d’idempotence',
  // Session d'un utilisateur expirée ou jeton illisible : c'est le navigateur qui
  // doit se reconnecter, pas un défaut de la plateforme.
  PGRST301: 'jeton utilisateur illisible',
  PGRST303: 'jeton utilisateur expiré',
};

/** Préfixes de routes où une panne coûte de l'argent, un DM, ou une donnée perdue. */
const ROUTES_CRITIQUES = [
  '/api/webhooks/',
  '/api/cron/',
  '/api/payments/',
  '/api/stripe/',
  '/api/push/',
  '/api/sante/',
  '/api/oauth/',
  '/api/instagram/cron-refresh-tokens',
  '/api/instagram/backfill-conversations',
  '/api/instagram/purger-vocaux',
  '/api/calls/',
  '/api/client/pipeline',
  '/api/client/claim-invite',
  '/r/',
];

export function routeEstCritique(route: string | null | undefined): boolean {
  if (!route) return false;
  const r = route.replace(/^\/app/, '');
  return ROUTES_CRITIQUES.some((p) => r.startsWith(p) || r.startsWith(p.replace(/\/$/, '')));
}

export interface ClassementSupabase {
  gravite: Gravite;
  /** Table, fonction RPC ou bucket visé. */
  cible: string;
  /** `rest`, `rpc` ou `storage`. */
  service: 'rest' | 'rpc' | 'storage';
  code: string | null;
  message: string;
  details: string | null;
  hint: string | null;
}

/**
 * Une réponse de Supabase est-elle un incident ?
 *
 * Rend `null` pour tout ce qui n'en est pas un : succès, service non surveillé
 * (auth — un mot de passe faux n'est pas une panne), ou code bénin.
 *
 * Gravité : une ÉCRITURE refusée est critique (la donnée est perdue, et l'appelant
 * répond souvent 200), une LECTURE refusée est normale (un écran vide, qui se voit),
 * sauf si l'appelant est une route critique — c'est à lui de relever la gravité.
 */
export function classerReponseSupabase(p: {
  methode: string;
  url: string;
  statut: number;
  corps: string | null;
}): ClassementSupabase | null {
  if (p.statut < 400) return null;

  let chemin: string;
  try {
    chemin = new URL(p.url).pathname;
  } catch {
    return null;
  }

  let service: ClassementSupabase['service'];
  let cible: string;
  const rpc = chemin.match(/^\/rest\/v1\/rpc\/([^/?]+)/);
  const rest = chemin.match(/^\/rest\/v1\/([^/?]+)/);
  const storage = chemin.match(/^\/storage\/v1\/object\/(?:sign\/|public\/|authenticated\/|upload\/sign\/)?([^/?]+)/);
  if (rpc) { service = 'rpc'; cible = rpc[1]; }
  else if (rest) { service = 'rest'; cible = rest[1]; }
  else if (storage) { service = 'storage'; cible = storage[1]; }
  else return null;

  const methode = p.methode.toUpperCase();
  const lecture = methode === 'GET' || methode === 'HEAD';

  // Stockage : un fichier absent à la lecture est une réponse, pas une panne
  // (vignette purgée, vocal jamais capturé — l'écran le montre déjà).
  if (service === 'storage' && lecture && (p.statut === 404 || p.statut === 400)) return null;
  // Plage demandée au-delà du total : réponse normale d'une pagination.
  if (p.statut === 416) return null;

  let code: string | null = null;
  let message = `HTTP ${p.statut}`;
  let details: string | null = null;
  let hint: string | null = null;
  if (p.corps) {
    try {
      const j = JSON.parse(p.corps);
      if (j && typeof j === 'object') {
        code = j.code != null ? String(j.code) : (j.statusCode != null ? String(j.statusCode) : null);
        message = String(j.message ?? j.error ?? message);
        details = j.details != null ? String(j.details) : null;
        hint = j.hint != null ? String(j.hint) : null;
      }
    } catch {
      message = `HTTP ${p.statut} — ${p.corps.slice(0, 300)}`;
    }
  }

  if (code && CODES_BENINS[code]) return null;

  // Un appel RPC est une écriture tant qu'on ne sait pas le contraire : la plupart des
  // RPC de ce projet écrivent (upsert_*, enregistrer_*, marquer_*).
  const ecriture = !lecture || service === 'rpc';
  return {
    gravite: ecriture ? 'critique' : 'normale',
    cible,
    service,
    code,
    message: tronquer(retirerLigneEnEchec(message), 500),
    details: details ? tronquer(retirerLigneEnEchec(details), 500) : null,
    hint: hint ? tronquer(hint, 300) : null,
  };
}

/**
 * Ramène un message à sa forme stable, pour que la même panne produise la même
 * empreinte : un uuid, un nombre ou une valeur entre guillemets changent d'une
 * occurrence à l'autre et fabriqueraient un incident par ligne.
 */
export function normaliserMessage(message: string): string {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/"[^"]{0,200}"/g, '"…"')
    .replace(/'[^']{0,200}'/g, "'…'")
    .replace(/«[^»]{0,200}»/g, '«…»')
    .replace(/\b\d{4}-\d{2}-\d{2}[T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?\b/g, '<date>')
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, '<id>')
    .replace(/\d+/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

/**
 * Empreinte stable (FNV-1a 32 bits, deux passes) — pure, identique dans les trois
 * runtimes. Pas de `crypto` : il n'a pas la même API partout, et une collision n'a
 * aucune conséquence grave ici (deux incidents regroupés sous le même titre).
 */
export function empreinte(parties: (string | null | undefined)[]): string {
  const texte = parties.map((p) => p ?? '').join('␟');
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < texte.length; i++) {
    const c = texte.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

export function tronquer(texte: string, max: number): string {
  return texte.length > max ? `${texte.slice(0, max)}… [tronqué, ${texte.length} caractères]` : texte;
}

/** En-têtes qui portent un secret ou une identité : jamais recopiés dans un incident. */
const ENTETES_SECRETS = /^(authorization|cookie|set-cookie|apikey|x-api-key|proxy-authorization|stripe-signature|x-hub-signature.*|svix-.*|webhook-signature|x-vercel-oidc-token|x-supabase-.*-key)$/i;

export function nettoyerEntetes(entetes: Record<string, string | string[] | undefined> | null | undefined): Record<string, string> {
  const propre: Record<string, string> = {};
  if (!entetes) return propre;
  for (const [cle, valeur] of Object.entries(entetes)) {
    if (valeur == null) continue;
    propre[cle] = ENTETES_SECRETS.test(cle) ? '[retiré]' : tronquer(Array.isArray(valeur) ? valeur.join(', ') : String(valeur), 300);
  }
  return propre;
}

/**
 * Retire les secrets d'une URL (jetons d'accès Meta/Google passés en paramètre).
 * Une URL Graph API porte `access_token=` en clair : la recopier dans un e-mail
 * publierait le jeton d'un élève.
 */
export function nettoyerUrl(url: string): string {
  return url.replace(/([?&](?:access_token|token|key|api_key|client_secret|code|refresh_token|apikey|secret)=)[^&#]*/gi, '$1[retiré]');
}

/**
 * Postgres recopie la ligne ENTIÈRE dans le détail d'une violation de contrainte
 * (« Failing row contains (…) ») ou d'unicité (« Key (…)=(…) »). Sur `integrations`,
 * cette ligne porte les jetons d'accès. On garde la phrase, jamais les valeurs.
 */
export function retirerLigneEnEchec(texte: string): string {
  return texte
    .replace(/Failing row contains \([\s\S]*\)/g, 'Failing row contains (…) [valeurs retirées]')
    .replace(/Key \(([^)]*)\)=\(.*?\)/g, 'Key ($1)=(…)');
}

/** Clés dont la VALEUR est un secret, où qu'elles apparaissent dans un corps JSON. */
const CLES_SECRETES = /token|secret|password|passwd|api_?key|apikey|signing_key|private_key|authorization|cookie|vapid|client_secret|code_verifier/i;

/**
 * Le corps d'une requête refusée, sans ses secrets.
 *
 * ⚠️ Cas réel qui l'impose : le retour OAuth écrit `integrations.access_token` et
 * `refresh_token`. Si cette écriture échoue, le corps recopié tel quel dans l'incident
 * partirait par e-mail avec le jeton de l'élève dedans.
 */
export function nettoyerCorps(corps: string | null | undefined, max = 1_500): string | null {
  if (!corps) return null;
  const masquer = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.slice(0, 20).map(masquer);
    if (v && typeof v === 'object') {
      const o: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        o[k] = CLES_SECRETES.test(k) && val != null ? '[retiré]'
          : typeof val === 'string' ? retirerLigneEnEchec(val)
          : masquer(val);
      }
      return o;
    }
    return v;
  };
  try {
    return tronquer(JSON.stringify(masquer(JSON.parse(corps))), max);
  } catch {
    // Pas du JSON : on masque les formes `cle=valeur` et `"cle":"valeur"` connues.
    return tronquer(
      corps
        .replace(/("[^"]*(?:token|secret|password|api_?key|apikey)[^"]*"\s*:\s*)"[^"]*"/gi, '$1"[retiré]"')
        .replace(/((?:access_token|refresh_token|client_secret|api_key|apikey|password)=)[^&\s]*/gi, '$1[retiré]'),
      max,
    );
  }
}

/**
 * La route qui a émis une requête, lue dans la pile d'appels capturée au moment du
 * `fetch`. Sur Vercel les cadres ressemblent à
 * `/var/task/.next/server/app/api/webhooks/stripe/route.js:1:2345`.
 */
export function routeDepuisPile(pile: string | null | undefined): string | null {
  if (!pile) return null;
  const m = pile.match(/\.next\/server\/(app\/[^\s:)]*?)\/(route|page)(?:\.js|\.ts)?/)
    ?? pile.match(/[/\\](app[/\\][^\s:)]*?)[/\\](route|page)\.(?:ts|tsx|js)/);
  if (!m) return null;
  return `/${m[1].replace(/\\/g, '/')}/${m[2]}`.replace(/^\/app/, '');
}

/**
 * Meta sert une version expirée avec la plus ancienne version encore active, et le
 * dit dans l'en-tête `facebook-api-version` (mesuré le 2026-09-13 : v19.0 demandée,
 * `facebook-api-version: v20.0` rendue). Rien ne casse : le comportement change en
 * silence. Rend la version demandée et la version servie quand elles diffèrent.
 */
export function versionGraphSurclassee(url: string, enteteVersion: string | null | undefined): { demandee: string; servie: string } | null {
  if (!enteteVersion) return null;
  const m = url.match(/^https:\/\/graph\.(?:facebook|instagram)\.com\/(v\d+\.\d+)\//);
  if (!m) return null;
  const servie = enteteVersion.trim();
  return servie && servie !== m[1] ? { demandee: m[1], servie } : null;
}

/**
 * Erreurs de navigateur qui ne disent rien de la plateforme. Chacune a déjà été vue
 * ailleurs comme bruit pur : extensions, réseau mobile coupé, onglet rechargé
 * pendant un déploiement.
 */
const BRUIT_NAVIGATEUR = [
  /^Script error\.?$/i,
  /ResizeObserver loop/i,
  /^Load failed$/i,
  /^Failed to fetch$/i,
  /NetworkError when attempting to fetch/i,
  /The network connection was lost/i,
  /The Internet connection appears to be offline/i,
  /AbortError/i,
  /The operation was aborted/i,
  /^(The )?(request|operation|fetch|user) (was |has been )?(aborted|cancell?ed)/i,
  /chrome-extension:|moz-extension:|safari-extension:/i,
  /Loading chunk [\w-]+ failed|ChunkLoadError|Failed to load chunk|Importing a module script failed|error loading dynamically imported module/i,
  /Non-Error promise rejection captured/i,
];

export function estBruitNavigateur(message: string | null | undefined, fichier?: string | null): boolean {
  const textes = [(message ?? '').trim(), (fichier ?? '').trim()].filter(Boolean);
  return textes.some((t) => BRUIT_NAVIGATEUR.some((r) => r.test(t)));
}

/** Erreurs serveur qui décrivent un client parti, pas une panne. */
export function estBruitServeur(erreur: { name?: string; message?: string } | null | undefined): boolean {
  if (!erreur) return false;
  const n = erreur.name ?? '';
  const msg = erreur.message ?? '';
  return n === 'AbortError' || n === 'ResponseAborted' || (/aborted|ECONNRESET|socket hang up/i.test(msg) && /client|request|socket/i.test(msg));
}
