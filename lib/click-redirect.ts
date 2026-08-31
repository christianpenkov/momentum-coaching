/**
 * Click ID sur les liens Calendly PARTAGÉS (bio, description, story).
 *
 * Un lien partagé n'identifie personne : plusieurs prospects cliquent le même
 * lien. Un rendez-vous venu de là ne pouvait donc pas être relié au clic qui l'a
 * produit — l'écran comparait « les clics de la période » aux « calls de la
 * période », deux ensembles qui ne se recouvrent pas.
 *
 * La chaîne devient :
 *
 *   Instagram / YouTube → lien Short.io → /r/<chemin> → calendly.com/... &salesforce_uuid=<click_id>
 *
 * Ce fichier ne contient QUE des fonctions pures, sans aucune dépendance : la
 * route de redirection tourne en runtime edge, le script de migration en Node,
 * et `npm test` (node --test) doit pouvoir les charger telles quelles.
 *
 * ⚠️ Les liens de DM (`prospect_links`) ne passent PAS par ici : ils sont déjà
 * instrumentés par `prospect_links.first_click_at` et l'événement `link_clicked`.
 *
 * Voir docs/click-id.md.
 */

// ── Liste blanche des hôtes de destination ──────────────────────────────────
//
// `d` ne porte QUE le chemin, jamais un hôte : l'hôte est écrit en dur ici.
// Aucune valeur de `d` ne peut donc faire sortir la redirection de cette liste,
// ce qui interdit structurellement l'open redirect.
//
// Constante nommée et non comparaison en ligne, pour que l'ajout d'un hôte
// (les liens lead magnet le jour où ils seront instrumentés — voir la section
// « hors périmètre » de docs/click-id.md) soit l'ajout d'une seule ligne.
export const HOTES_AUTORISES = {
  calendly: 'https://calendly.com',
} as const;

export type CleHote = keyof typeof HOTES_AUTORISES;

export const CLE_HOTE_PAR_DEFAUT: CleHote = 'calendly';

/** Nom du paramètre Calendly qui porte le Click ID. */
//
// Calendly ne transmet que les cinq UTM standards plus `salesforce_uuid` ; tout
// paramètre sur mesure est supprimé silencieusement. `salesforce_uuid` était
// réservé pour un besoin futur par docs/utm-nomenclature.md, et il résiste mieux
// aux redirections que les UTM — ce qui compte ici, puisque ce chantier AJOUTE
// une redirection.
export const PARAM_CLICK_ID = 'salesforce_uuid';

/** Les cinq UTM que Calendly accepte. */
export const UTMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;

// ── Nos paramètres, par opposition à ceux qu'on reçoit ──────────────────────
//
// ⚠️ **Un `utm_*` reçu dans une requête n'est PAS le `utm_*` qu'on a écrit.**
//
// Mesuré le 2026-09-01 sur deux vrais taps depuis la bio Instagram de Chris : la
// requête arrivait avec `utm_medium` ABSENT et `utm_content=link_in_bio`. Le
// navigateur intégré d'Instagram réécrit les paramètres UTM pendant la navigation.
// Détail qui décide de la gravité : les préchargements d'Instagram, eux, arrivaient
// intacts — ce sont les clics HUMAINS qui étaient abîmés, donc précisément ceux
// qu'on mesure.
//
// Et `link_in_bio` fait exactement 11 caractères dans [A-Za-z0-9_-] : il PASSE
// `isYtVideoId`, donc `isValidContentId` (lib/contentId.ts). Un rendez-vous pris
// depuis la bio serait parti avec `utm_content=link_in_bio`, aurait été écrit tel
// quel dans `calls.utm_content` par la garde censée le refuser, et `resolveCallSource`
// en aurait déduit la plateforme **YouTube**. La vue `utm_anomalies`, qui porte une
// copie SQL de la même règle, ne l'aurait pas signalé.
//
// La règle qui en découle : **le token, `d`, `p` et les paramètres ci-dessous sont à
// nous ; les `utm_*` d'une requête entrante ne le sont pas.** On classe sur les
// nôtres, et on retransmet à Calendly les UTM qu'on a VOULUS, pas ceux qu'on a reçus.
//
// Les `utm_*` restent posés sur l'URL `/r/` : `lib/shortio-link-category.ts` les lit
// sur la destination STOCKÉE chez Short.io, que personne ne réécrit — c'est la même
// chaîne de caractères des deux côtés, mais pas la même confiance.
export const PARAM_PLATEFORME = 's';
export const PARAM_MEDIUM = 'm';
export const PARAM_CONTENU = 'c';
export const PARAM_CAMPAGNE = 'k';

// ⚠️ Copies des règles de `lib/contentId.ts`. Ce fichier ne peut rien importer : il
// est chargé par la route edge, par un script Node et par `npm test`. Une copie qui
// se sait copie vaut mieux que deux implémentations qui s'ignorent — même contrainte
// que `resolveClickId` côté Edge Function. Toute évolution de la règle doit être
// répercutée là-bas, et dans la copie SQL de la vue `utm_anomalies`.
const estIdPostIg = (v: string) => /^\d{10,}$/.test(v);
const estIdVideoYt = (v: string) => /^[A-Za-z0-9_-]{11}$/.test(v);
const estUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** Identifiant de contenu : post Instagram, vidéo YouTube, ou séquence story. */
export function estIdContenu(v: string | null | undefined): v is string {
  return !!v && (estIdPostIg(v) || estIdVideoYt(v) || estUuid(v));
}

/** Valeurs de campagne : libres par conception, donc seulement bornées en forme. */
const FORME_CAMPAGNE = /^[A-Za-z0-9_.-]{1,120}$/;

/** Canaux de liens PARTAGÉS. `dm` en est volontairement absent (déjà instrumenté). */
export const MEDIUMS_PARTAGES = ['bio', 'description', 'story'] as const;

/** Plateformes reconnues, mêmes valeurs que la nomenclature UTM. */
export const PLATEFORMES = ['ig', 'yt'] as const;

/** Calendly limite chaque valeur de paramètre à 255 caractères. */
export const LONGUEUR_MAX_VALEUR = 255;

// ── Assainissement du chemin de destination ─────────────────────────────────

/**
 * Valide le paramètre `d` (chemin de la page Calendly, ex. `christianpenkov/30min`).
 *
 * Retourne `null` dès que la valeur sort du jeu de caractères attendu. La
 * validation est volontairement plus stricte que nécessaire : elle protège une
 * concaténation d'URL, et un caractère inattendu y coûte plus cher qu'un lien
 * refusé.
 *
 * ⚠️ Ne JAMAIS remplacer la construction par `new URL(d, hote)` : un `d` valant
 * `//exemple.test` produirait alors `https://exemple.test/` — l'open redirect
 * exact que la liste blanche existe pour interdire.
 */
export function assainirChemin(d: string | null | undefined): string | null {
  if (!d) return null;
  const brut = d.replace(/^\/+/, '');
  if (!brut || brut.length > 200) return null;
  if (brut.includes('..')) return null;
  if (!/^[A-Za-z0-9/_-]+$/.test(brut)) return null;
  return brut;
}

/**
 * Lit NOS paramètres et n'en garde que ce qui est conforme.
 *
 * Même règle que `lib/contentId.ts` : **champ vide plutôt que champ faux**. Une
 * valeur hors nomenclature n'est pas recopiée — un `medium` inventé polluerait
 * silencieusement la répartition des clics par canal.
 *
 * ⚠️ **Aucun repli sur les `utm_*` reçus.** Un repli réintroduirait exactement la
 * confiance qu'on vient de retirer, et une règle assortie d'une exception se recopie
 * sans son exception. Le prix est que les liens réécrits AVANT ce changement, tant
 * qu'ils ne portent pas `m`, produisent des clics non classés — un trou honnête, que
 * la relance du script referme.
 */
export function nosValeurs(parametres: URLSearchParams): {
  platform: string | null;
  medium: string | null;
  content_id: string | null;
  campagne: string | null;
} {
  const s = parametres.get(PARAM_PLATEFORME);
  const m = parametres.get(PARAM_MEDIUM);
  const c = parametres.get(PARAM_CONTENU);
  const k = parametres.get(PARAM_CAMPAGNE);

  const medium = (MEDIUMS_PARTAGES as readonly string[]).includes(m || '') ? m : null;

  // ⚠️ `content_id` n'a de sens que pour un contenu. Un lien de BIO ne vient d'aucun
  // contenu précis : son `utm_content` est vide par nature (docs/utm-nomenclature.md).
  // Refuser tout contenu sur un lien de bio n'est donc pas une précaution, c'est la
  // définition — et ça neutralise structurellement le cas observé, où un tiers avait
  // glissé `link_in_bio` dans ce champ sur un clic de bio.
  const contenu = medium === 'bio' ? null : (estIdContenu(c) ? c : null);

  return {
    platform: (PLATEFORMES as readonly string[]).includes(s || '') ? s : null,
    medium,
    content_id: contenu,
    campagne: k && FORME_CAMPAGNE.test(k) ? k : null,
  };
}

/**
 * Construit l'URL de destination finale.
 *
 * Aucune lecture en base : la destination se déduit ENTIÈREMENT de l'URL reçue.
 * C'est ce qui rend le fail-open réellement tenable — une panne de la base ne
 * peut pas empêcher un prospect d'atteindre Calendly.
 *
 * ⚠️ **Les UTM transmis à Calendly sont reconstruits depuis NOS paramètres**, jamais
 * recopiés depuis la requête. Sans ça, une réservation depuis la bio Instagram partait
 * avec `utm_content=link_in_bio` — une valeur que `isValidContentId` accepte, faute de
 * quoi elle aurait été rejetée à l'écriture.
 *
 * `utm_term` n'est pas transmis : il porte « qui — le prospect », et un lien PARTAGÉ
 * n'identifie personne. Il n'y a donc rien de légitime à y mettre.
 *
 * Retourne `null` si le chemin est invalide ou l'hôte inconnu ; l'appelant
 * décide alors de son repli, il n'affiche jamais d'erreur.
 */
export function construireDestination(
  parametres: URLSearchParams,
  clickId: string | null,
): string | null {
  const cleHote = (parametres.get('h') || CLE_HOTE_PAR_DEFAUT) as CleHote;
  const hote = HOTES_AUTORISES[cleHote];
  if (!hote) return null;

  const chemin = assainirChemin(parametres.get('d'));
  if (!chemin) return null;

  let url: URL;
  try {
    url = new URL(`${hote}/${chemin}`);
  } catch {
    return null;
  }
  // Garde de dernier recours : quoi qu'il arrive plus haut, on ne sort pas de
  // l'hôte de la liste blanche.
  if (url.origin !== hote) return null;

  const nous = nosValeurs(parametres);
  if (nous.platform)   url.searchParams.set('utm_source', nous.platform);
  if (nous.medium)     url.searchParams.set('utm_medium', nous.medium);
  if (nous.campagne)   url.searchParams.set('utm_campaign', nous.campagne);
  if (nous.content_id) url.searchParams.set('utm_content', nous.content_id);
  if (clickId) url.searchParams.set(PARAM_CLICK_ID, clickId.slice(0, LONGUEUR_MAX_VALEUR));

  return url.toString();
}

// ── Click ID ────────────────────────────────────────────────────────────────

/** Identifiant opaque d'un clic. UUID v4 : 36 caractères, très loin des 255 de Calendly. */
export function genererClickId(): string {
  return crypto.randomUUID();
}

const FORME_CLICK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Valide un Click ID reçu de Calendly avant de l'écrire ou de l'interroger.
 *
 * Même règle que `lib/contentId.ts` : une valeur externe non conforme n'est
 * jamais écrite. Calendly renvoie `salesforce_uuid` tel qu'il l'a figé au
 * moment du clic — n'importe qui peut donc y avoir mis n'importe quoi en
 * fabriquant une URL à la main.
 *
 * Retourne `undefined` quand il ne faut RIEN écrire : l'appelant omet alors la
 * clé de son upsert, il ne pose surtout pas `null` (ce qui écraserait une valeur
 * correcte déjà en base — cf. l'incident du 2026-08-19 sur utm_content).
 */
export function resolveClickId(entrant: string | null | undefined): string | undefined {
  if (!entrant) return undefined;
  return FORME_CLICK_ID.test(entrant) ? entrant.toLowerCase() : undefined;
}

// ── Robots d'aperçu de lien ─────────────────────────────────────────────────

// Instagram, WhatsApp, Slack et consorts déréférencent un lien pour en afficher
// l'aperçu. Ces requêtes sont réelles et arrivent jusqu'ici : les MARQUER, jamais
// les jeter — sans la ligne, on ne peut ni mesurer le bruit ni expliquer un écart
// avec le compteur de Short.io.
//
// ⚠️ « Instagram » seul n'est PAS un robot : c'est le navigateur intégré de
// l'application, donc un humain. Seul `facebookexternalhit` est le crawler Meta.
const ROBOTS = [
  'facebookexternalhit', 'facebookcatalog', 'facebot', 'meta-externalagent',
  'whatsapp', 'slackbot', 'slack-imgproxy', 'twitterbot', 'telegrambot',
  'discordbot', 'linkedinbot', 'skypeuripreview', 'applebot', 'redditbot',
  'pinterest', 'vkshare', 'iframely', 'embedly', 'quora link preview',
  'googlebot', 'bingbot', 'yandexbot', 'duckduckbot', 'ahrefsbot', 'semrushbot',
  'headlesschrome', 'python-requests', 'curl/', 'wget/', 'axios/', 'go-http-client',
];

const ROBOTS_GENERIQUES = /(^|[^a-z])(bot|crawler|spider|preview|scraper|monitor)([^a-z]|$)/;

/**
 * Un robot d'aperçu de lien plutôt qu'un humain ?
 *
 * Deux signaux : le User-Agent, et l'en-tête `Sec-Purpose: prefetch` que les
 * navigateurs et proxys posent quand ils pré-chargent une URL sans que personne
 * ne l'ait demandée.
 */
export function estRobotApercu(
  userAgent: string | null | undefined,
  secPurpose?: string | null,
): boolean {
  if (secPurpose && secPurpose.toLowerCase().includes('prefetch')) return true;
  const ua = (userAgent || '').toLowerCase();
  if (!ua) return true; // aucun UA : jamais un vrai navigateur
  if (ROBOTS.some(r => ua.includes(r))) return true;
  return ROBOTS_GENERIQUES.test(ua);
}

// ── Empreinte d'IP ──────────────────────────────────────────────────────────

/**
 * Empreinte salée d'une IP. **L'IP brute n'est jamais écrite en base.**
 *
 * Sert uniquement à repérer les doubles déclenchements des navigateurs intégrés
 * (Instagram ouvre parfois deux fois la même URL). Le sel du jour rend l'empreinte
 * incomparable d'un jour à l'autre : on ne peut donc pas reconstituer un visiteur
 * dans la durée, ce qui n'est pas le but — voir docs/click-id.md.
 *
 * Retourne `null` sans secret configuré : un champ vide dit « on ne sait pas »,
 * une empreinte non salée mentirait sur ce qu'elle protège.
 */
export async function empreinteIp(
  ip: string | null | undefined,
  secret: string | null | undefined,
  jour: string,
): Promise<string | null> {
  if (!ip || !secret) return null;
  const octets = new TextEncoder().encode(`${ip}|${secret}|${jour}`);
  const condensat = await crypto.subtle.digest('SHA-256', octets);
  return Array.from(new Uint8Array(condensat))
    .slice(0, 8)
    .map(o => o.toString(16).padStart(2, '0'))
    .join('');
}

/** Sel du jour, en UTC — une seule définition partagée par la route et les tests. */
export function selDuJour(maintenant: Date): string {
  return maintenant.toISOString().slice(0, 10);
}

// ── Champs de la ligne de clic ──────────────────────────────────────────────

/**
 * Ce qu'on écrit dans `link_clicks`, déduit de NOS paramètres — jamais des `utm_*`
 * de la requête, qu'un tiers réécrit (voir le bloc en tête de fichier).
 */
export function champsDuClic(parametres: URLSearchParams): {
  platform: string | null;
  medium: string | null;
  content_id: string | null;
} {
  const { platform, medium, content_id } = nosValeurs(parametres);
  return { platform, medium, content_id };
}

// ── Construction de la destination Short.io ─────────────────────────────────

/**
 * Transforme une destination Calendly directe en destination `/r/<chemin>`.
 *
 * Utilisée par les DEUX chemins qui posent une destination Short.io : le script
 * de migration (liens existants) et les points de génération (liens à venir).
 * Une seule implémentation, pour qu'un lien créé demain soit instrumenté comme
 * un lien réécrit hier.
 *
 * ⚠️ **Les UTM sont reportés à l'identique sur la nouvelle destination**, et ce
 * n'est pas une commodité : `lib/shortio-link-category.ts` classe chaque lien en
 * lisant `utm_medium`, `utm_campaign` et `utm_source` SUR la destination
 * Short.io. Une destination nue casserait la catégorisation de deux façons, les
 * deux silencieuses — les clics de bio disparaîtraient de « Clics totaux », et
 * les liens de description (`prendre-rdv-3457`…) seraient reclassés en clics de
 * DM prospect par la branche `medium === null && path.includes('prendre-rdv')`.
 * Verrouillé par un test dans `lib/shortio-link-category.test.ts`.
 *
 * ⚠️ **Gère aussi le CHANGEMENT d'origine.** Une destination déjà réécrite sur une
 * autre origine est reconstruite sur la nouvelle, à l'identique. Sans ça, changer de
 * domaine (adresse de test → domaine définitif) ne réécrirait RIEN : la destination
 * n'étant plus une URL Calendly, elle serait classée « hors périmètre » et le script
 * passerait à côté sans le dire. C'est le genre de défaut qui ne se découvre que le
 * jour de la bascule, quand tous les liens pointent encore vers l'ancien domaine.
 *
 * Retourne `null` quand il ne faut PAS réécrire — l'appelant garde alors la
 * destination directe, qui fonctionne exactement comme aujourd'hui :
 *  - pas d'origine de redirection configurée (le domaine n'est pas encore branché)
 *  - destination hors liste blanche (lead magnet, page de paiement Stripe…)
 *  - canal non partagé (`dm` : déjà instrumenté par prospect_links)
 *  - destination déjà réécrite SUR LA MÊME origine (le script est rejouable sans effet)
 */
/**
 * Cette URL est-elle déjà une destination de redirection Click ID ?
 *
 * Le chemin `/r/` seul ne suffit pas — n'importe quel site peut en avoir un. La
 * présence de `d` est ce qui identifie nos URL : c'est le paramètre sans lequel la
 * route ne saurait pas où rediriger.
 */
/**
 * Recopie les UTM d'une destination STOCKÉE vers nos propres paramètres.
 *
 * La source est toujours une chaîne écrite par nous chez Short.io — jamais une
 * requête entrante. C'est toute la différence : `utm_medium` a la même orthographe
 * des deux côtés, mais pas la même confiance.
 */
function posrNosValeurs(cible: URL, source: URLSearchParams): void {
  const paires: [string, string | null][] = [
    [PARAM_PLATEFORME, source.get('utm_source')],
    [PARAM_MEDIUM,     source.get('utm_medium')],
    [PARAM_CAMPAGNE,   source.get('utm_campaign')],
    [PARAM_CONTENU,    source.get('utm_content')],
  ];
  for (const [nom, valeur] of paires) {
    if (valeur) cible.searchParams.set(nom, valeur);
  }
}

function estUneRedirection(url: URL): boolean {
  return url.pathname.startsWith('/r/') && url.searchParams.has('d');
}

export function construireDestinationShortio(
  origineRedirection: string | null | undefined,
  cheminShortio: string,
  destinationActuelle: string,
  profileId: string,
): string | null {
  if (!origineRedirection || !cheminShortio || !profileId) return null;

  let source: URL;
  let origine: URL;
  try {
    source = new URL(destinationActuelle);
    origine = new URL(origineRedirection);
  } catch {
    return null;
  }

  // Déjà réécrite. Trois cas, et les confondre coûte cher.
  if (estUneRedirection(source)) {
    const memeOrigine = source.origin === origine.origin;
    // `m` est le marqueur du format qui porte NOS valeurs. Une URL réécrite avant
    // son introduction ne le porte pas : elle est à mettre à niveau, pas à ignorer.
    const aJour = source.searchParams.has(PARAM_MEDIUM);
    // Rien à faire : le script est rejouable sans effet.
    if (memeOrigine && aJour) return null;

    // Déménagement d'origine et/ou mise à niveau. On repart des `utm_*` posés sur
    // cette URL : ils sont à NOUS, écrits par ce script chez Short.io, et personne
    // ne les a réécrits — ce n'est pas une requête, c'est une chaîne stockée.
    const cible = new URL(source.pathname + source.search, origine.origin);
    posrNosValeurs(cible, source.searchParams);
    return cible.toString();
  }

  const cleHote = (Object.keys(HOTES_AUTORISES) as CleHote[])
    .find(cle => HOTES_AUTORISES[cle] === source.origin);
  if (!cleHote) return null;

  const medium = source.searchParams.get('utm_medium');
  if (!(MEDIUMS_PARTAGES as readonly string[]).includes(medium || '')) return null;

  const chemin = assainirChemin(source.pathname);
  if (!chemin) return null;

  const cible = new URL(`${origine.origin}/r/${cheminShortio.replace(/^\/+/, '')}`);
  // Les `utm_*` restent posés : `lib/shortio-link-category.ts` les lit sur cette
  // destination stockée chez Short.io pour classer le lien. Ils ne servent à rien
  // d'autre — la route, elle, ne lit que nos paramètres.
  for (const utm of UTMS) {
    const valeur = source.searchParams.get(utm);
    if (valeur) cible.searchParams.set(utm, valeur);
  }
  posrNosValeurs(cible, source.searchParams);
  cible.searchParams.set('d', chemin);
  // `h` n'est posé que pour un hôte non par défaut : les URL restent lisibles
  // tant qu'il n'y a qu'un seul hôte, et l'ajout d'un second ne casse rien.
  if (cleHote !== CLE_HOTE_PAR_DEFAUT) cible.searchParams.set('h', cleHote);
  // Le profil est porté par l'URL, pas résolu en base : la ligne de clic s'écrit
  // alors en un seul INSERT, sans SELECT préalable, donc sans lecture en base
  // même en dehors du chemin critique. Un identifiant de profil n'est pas un
  // secret — il ne donne accès à rien, la RLS ne s'appuie jamais dessus.
  cible.searchParams.set('p', profileId);

  return cible.toString();
}
