/**
 * Catégorie d'un lien Short.io — source unique de la règle.
 *
 * Elle existait en TROIS exemplaires (`supabase/functions/poll-leads`,
 * `supabase/functions/backfill-shortio`, et une absence de règle dans
 * `lib/shortio-fetch.ts`). Ils avaient déjà divergé : la copie de
 * `backfill-shortio` ignore `utm_medium=story` et renvoie donc `null` pour tous
 * les liens Calendly de séquence story.
 *
 * Fichier volontairement sans aucun import : il doit rester consommable à la
 * fois par Next (Node) et par les Edge Functions (Deno).
 *
 * ⚠️ Une catégorie `null` est un clic PERDU pour l'écran Business micro :
 * `BUSINESS_CATEGORIES` est le filtre de « Clics totaux » et des trois filtres du
 * graphique. Ne jamais renvoyer `null` pour un lien manifestement Momentum.
 */

export type LinkCategory =
  | 'calendly_bio_ig' | 'calendly_bio_yt'
  | 'lm_bio_ig' | 'lm_bio_yt'
  | 'calendly_desc_ig' | 'calendly_desc_yt'
  | 'lm_desc_ig' | 'lm_desc_yt'
  | 'lm_dm_auto' | 'calendly_dm_prospect'
  | 'calendly_story';

/**
 * Catégories comptées dans « Clics totaux ».
 *
 * Écrite une seule fois ici : elle l'était trois fois dans `PageClientStats.tsx`
 * (`TOTAL_CLICS_CATS`, `SNAP_BUSINESS_CATS`, `CHART_BUSINESS_CATS`). Toute
 * catégorie ajoutée au type ci-dessus doit apparaître ici ET dans l'un des
 * groupes de `CATEGORY_GROUPS`, sinon ses clics existent en base et sont
 * invisibles à l'écran.
 */
export const BUSINESS_CATEGORIES: readonly LinkCategory[] = [
  'calendly_bio_ig', 'calendly_bio_yt', 'lm_bio_ig', 'lm_bio_yt',
  'calendly_desc_ig', 'calendly_desc_yt', 'lm_desc_ig', 'lm_desc_yt',
  'lm_dm_auto', 'calendly_dm_prospect', 'calendly_story',
];

/**
 * Répartition des catégories dans les filtres du graphique « Clics totaux / jour ».
 *
 * L'union de ces groupes DOIT couvrir `BUSINESS_CATEGORIES` : sans quoi
 * « Tous les clics » est strictement supérieur à Bio + Contenu + DM + Story, et
 * l'écart n'est explicable nulle part. C'était le cas de `calendly_story`, absent
 * des trois filtres jusqu'au 2026-08-28 (1 clic manquant sur 23 en août).
 */
export const CATEGORY_GROUPS = {
  bioIg:      ['calendly_bio_ig', 'lm_bio_ig'],
  bioYt:      ['calendly_bio_yt', 'lm_bio_yt'],
  contentIg:  ['calendly_desc_ig', 'lm_desc_ig'],
  contentYt:  ['calendly_desc_yt', 'lm_desc_yt'],
  dmCalendly: ['calendly_dm_prospect'],
  dmLm:       ['lm_dm_auto'],
  story:      ['calendly_story'],
} as const satisfies Record<string, readonly LinkCategory[]>;

/** Tables de référence du profil, préchargées par l'appelant. */
export interface LinkCategoryRefs {
  /** `content_links` du profil : plateforme + les trois URL courtes possibles. */
  contentLinks: { platform: string | null; desc_calendly_short_url: string | null; desc_lm_short_url: string | null; lm_short_url: string | null }[];
  /** `prospect_links.short_url` du profil. */
  prospectShortUrls: (string | null)[];
}

function param(url: string, name: string): string | null {
  try { return new URL(url).searchParams.get(name); } catch { return null; }
}

/**
 * Construit le résolveur pour un profil donné.
 *
 * `originalUrl` = URL de destination du lien court, porteuse des UTM.
 * `utm_medium` donne l'emplacement (bio / description / dm / story / leadmagnet),
 * `utm_campaign` la nature (Calendly ou lead magnet) et la plateforme.
 */
export function createLinkCategoryResolver(refs: LinkCategoryRefs) {
  const descCalendlyIg = new Set<string>();
  const descCalendlyYt = new Set<string>();
  const descLmIg = new Set<string>();
  const descLmYt = new Set<string>();
  const prospect = new Set<string>();
  for (const cl of refs.contentLinks ?? []) {
    const yt = (cl.platform || '').toUpperCase() === 'YT';
    if (cl.desc_calendly_short_url) (yt ? descCalendlyYt : descCalendlyIg).add(cl.desc_calendly_short_url.toLowerCase());
    if (cl.desc_lm_short_url) (yt ? descLmYt : descLmIg).add(cl.desc_lm_short_url.toLowerCase());
  }
  for (const u of refs.prospectShortUrls ?? []) if (u) prospect.add(u.toLowerCase());

  return function resolveLinkCategory(path: string, shortUrl: string, originalUrl: string): LinkCategory | null {
    const p = (path || '').toLowerCase();
    const u = (shortUrl || '').toLowerCase();
    const medium = param(originalUrl, 'utm_medium');
    const campaign = (param(originalUrl, 'utm_campaign') || '').toLowerCase();
    const source = (param(originalUrl, 'utm_source') || '').toLowerCase();

    // Plateforme : utm_source d'abord ('ig' / 'yt'), puis la campagne, puis le path.
    // Les liens créés avant 2026-07 portent le domaine Short.io en utm_source
    // (ex: 'ubizenai.s.gy') — d'où les deux replis.
    const isYt = source === 'yt'
      || campaign.includes('youtube') || campaign.endsWith('-yt')
      || p.includes('-yt') || p.endsWith('yt');

    if (medium === 'bio') {
      // `utm_campaign` fait foi, pas le path. Un lien lead magnet de bio dont le
      // path ne commence pas par `lm-` (ex: `tunnel-closing-ig`, campagne
      // `lm-bio-ig`) était classé Calendly par l'ancienne heuristique de path,
      // donc compté comme un clic de prise de rendez-vous. Défaut trouvé le
      // 2026-08-28 ; aucun clic concerné à cette date, mais le lien existe.
      const isLm = campaign.startsWith('lm-') || p.startsWith('lm-');
      if (isLm) return isYt ? 'lm_bio_yt' : 'lm_bio_ig';
      return isYt ? 'calendly_bio_yt' : 'calendly_bio_ig';
    }

    if (medium === 'description') {
      if (descCalendlyIg.has(u)) return 'calendly_desc_ig';
      if (descCalendlyYt.has(u)) return 'calendly_desc_yt';
      if (descLmIg.has(u)) return 'lm_desc_ig';
      if (descLmYt.has(u)) return 'lm_desc_yt';
      // Repli : le lien porte `utm_medium=description` (donc généré par Momentum)
      // mais ne figure plus dans `content_links` — contenu supprimé, lien régénéré
      // avec une autre URL, ou compte Short.io partagé entre plusieurs profils.
      // L'ancienne version renvoyait `null` et ces clics disparaissaient de
      // « Clics totaux » : mesuré le 2026-08-28, 9 clics sur 15 effacés pour un
      // profil de test.
      const isLm = campaign.startsWith('lm-') || p.startsWith('lm-');
      if (isLm) return isYt ? 'lm_desc_yt' : 'lm_desc_ig';
      return isYt ? 'calendly_desc_yt' : 'calendly_desc_ig';
    }

    if (medium === 'leadmagnet' || (medium === null && (p.startsWith('lm-') || p.startsWith('guide-') || p.startsWith('beau-')))) {
      return 'lm_dm_auto';
    }

    if (medium === 'dm' || (medium === null && (p.includes('prendre-rdv') || p.includes('christian') || p.includes('incogniton')))) {
      if (prospect.has(u)) return 'calendly_dm_prospect';
      if (p.startsWith('lm-')) return 'lm_dm_auto';
      return 'calendly_dm_prospect';
    }

    // Lien Calendly d'une séquence story — `utm_medium=story`, path
    // `story-calendly-{slug}`. Le CTA Lead Magnet d'une séquence n'a pas de lien
    // Short.io propre (mot-clé en réponse, aucun clic à tracker).
    if (medium === 'story') return 'calendly_story';

    // Volontairement `null` : liens de paiement Stripe (`utm_medium=payment`) et
    // liens créés à la main hors Momentum. Ils ne relèvent pas de l'acquisition et
    // n'entrent pas dans « Clics totaux ».
    return null;
  };
}
