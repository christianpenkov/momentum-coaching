/**
 * Short ou vidéo longue : la règle, écrite une seule fois.
 *
 * ── CE QUI ÉTAIT CASSÉ ──────────────────────────────────────────────────────
 *
 * Deux chemins classaient les vidéos, chacun avec sa propre heuristique de durée,
 * et les deux se trompaient — mesuré le 2026-09-06 sur la chaîne de test :
 * **10 vidéos sur 32 mal classées**, toutes des Shorts étiquetés « vidéo longue ».
 *
 *   • Le seuil codé était ≤ 60 s, alors que YouTube autorise les Shorts jusqu'à
 *     3 minutes depuis fin 2024. Les Shorts de 60 à 180 s tombaient tous du
 *     mauvais côté.
 *   • Les deux chemins se contredisaient au cas limite. Une vidéo de 60 s pile
 *     rend `"PT1M"` : la regex du cron exigeait une terminaison en `S` et
 *     répondait « longue », le calcul de la route en direct trouvait 60 et
 *     répondait « Short ». La MÊME vidéo changeait d'étiquette selon la période
 *     consultée — constaté sur `LNbAKuHpows`.
 *
 * ── POURQUOI PAS SIMPLEMENT CORRIGER LE SEUIL ───────────────────────────────
 *
 * Parce que ça ne suffit pas. Mesuré sur les mêmes 32 vidéos : un seuil ≤ 180 s,
 * pourtant juste au regard de la règle YouTube, **se tromperait encore 3 fois**.
 * Rien n'interdit de publier une vidéo classique de deux minutes — la durée ne
 * distingue pas le format, elle le suggère.
 *
 * ── LA SOURCE AUTORITAIRE ───────────────────────────────────────────────────
 *
 * L'API Analytics sait répondre, via la dimension `creatorContentType`. Le projet
 * l'utilisait déjà, mais seulement au niveau de la CHAÎNE (ventilation des vues
 * par format), jamais par vidéo.
 *
 * Vérifié contre l'API réelle avant d'écrire ce fichier :
 *   ✅ `filters=creatorContentType==shorts` + `dimensions=video` → 200
 *   ❌ la même chose en `SHORTS` → 400 « Invalid value »
 *   ❌ `dimensions=video,creatorContentType` → 400 « query is not supported »
 *   ❌ `maxResults=500` → 400 ; 200 passe
 *
 * La casse minuscule est donc obligatoire, et le croisement par dimension
 * impossible : il faut DEUX requêtes filtrées, une par format.
 *
 * ── LA LIMITE, ET LE REPLI ──────────────────────────────────────────────────
 *
 * C'est une requête d'ANALYTICS : elle ne rend que les vidéos ayant eu des vues
 * sur la période. Une vidéo sans aucune vue n'a pas de verdict — d'où le repli
 * sur la durée, qui reste imparfait mais ne s'applique qu'à ce cas-là.
 */

/**
 * Durée maximale d'un Short, en secondes. Relevée à 180 par YouTube fin 2024 ;
 * la plateforme codait encore 60.
 *
 * ⚠️ Ne sert QUE de repli, pour une vidéo dont l'API ne dit rien. Ce n'est pas la
 * règle : elle se trompe (mesuré 3 fois sur 32), parce qu'une vidéo classique
 * peut parfaitement durer moins de trois minutes.
 */
export const DUREE_MAX_SHORT_SEC = 180;

/**
 * Plafond de `maxResults` accepté par l'API sur cette requête. 500 est refusé
 * (400 « query is not supported »), 200 passe — vérifié contre l'API.
 */
export const MAX_RESULTS_CLASSIFICATION = 200;

/** Ce que l'API a répondu, par format. */
export interface VerdictFormats {
  /** Vidéos que l'API dit être des Shorts. */
  shorts: ReadonlySet<string>;
  /** Vidéos que l'API dit être des vidéos longues. */
  longues: ReadonlySet<string>;
}

/** Un verdict vide — aucune classification connue, tout retombe sur la durée. */
export const AUCUN_VERDICT: VerdictFormats = { shorts: new Set(), longues: new Set() };

/**
 * Les paramètres de la requête Analytics qui classe les vidéos d'un format.
 *
 * Construits ici pour que le cron et la route en direct posent EXACTEMENT la même
 * question : c'est d'avoir deux formulations légèrement différentes qui a produit
 * la divergence qu'on corrige.
 *
 * @param format      `shorts` ou `videoOnDemand`, en minuscules — l'API refuse
 *                    les majuscules.
 * @param debut/fin   au format `AAAA-MM-JJ`.
 */
export function parametresClassification(
  format: 'shorts' | 'videoOnDemand',
  debut: string,
  fin: string,
): URLSearchParams {
  return new URLSearchParams({
    ids: 'channel==MINE',
    startDate: debut,
    endDate: fin,
    dimensions: 'video',
    metrics: 'views',
    filters: `creatorContentType==${format}`,
    maxResults: String(MAX_RESULTS_CLASSIFICATION),
    sort: '-views',
  });
}

/**
 * Cette vidéo est-elle un Short ?
 *
 * L'ordre compte : le verdict de l'API l'emporte TOUJOURS sur la durée. La durée
 * n'intervient que pour une vidéo dont l'API ne dit rien — c'est-à-dire une vidéo
 * sans aucune vue sur la période interrogée.
 *
 * Sans durée connue non plus, on répond « pas un Short ». C'est le choix le moins
 * dommageable : une vidéo longue comptée comme telle est le cas majoritaire, et
 * l'inverse gonflerait les statistiques Shorts d'une chaîne qui n'en publie pas.
 */
export function estUnShort(
  videoId: string,
  dureeSec: number | null | undefined,
  verdict: VerdictFormats = AUCUN_VERDICT,
): boolean {
  if (verdict.shorts.has(videoId)) return true;
  if (verdict.longues.has(videoId)) return false;
  if (dureeSec == null) return false;
  return dureeSec <= DUREE_MAX_SHORT_SEC;
}

/**
 * Cette vidéo a-t-elle été classée par l'API, ou par le repli sur la durée ?
 *
 * Utile pour journaliser : un profil dont beaucoup de vidéos passent par le repli
 * signale soit une chaîne sans vues, soit un plafond de 200 atteint.
 */
export function verdictConnu(videoId: string, verdict: VerdictFormats): boolean {
  return verdict.shorts.has(videoId) || verdict.longues.has(videoId);
}

/**
 * Durée ISO 8601 de YouTube (`PT1M30S`) en secondes.
 *
 * Recopiée à l'identique dans les deux chemins jusqu'ici. Ce n'est pas elle qui
 * portait le bug, mais elle en était le support : deux copies d'un même calcul
 * finissent par se répondre différemment.
 */
export function dureeIsoEnSecondes(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const m = iso.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  const [, j, h, min, s] = m;
  const total = (+(j || 0) * 86400) + (+(h || 0) * 3600) + (+(min || 0) * 60) + +(s || 0);
  // Zéro n'est pas une durée, c'est une absence de durée. `P0D` est ce que rend
  // un direct PROGRAMMÉ, et le laisser passer pour 0 en ferait un Short.
  //
  // ⚠️ Tester la présence des groupes ne suffit PAS : la regex capture la chaîne
  // « 0 », qui est truthy en JavaScript. `P0D` passait donc la garde et rendait
  // 0 — défaut trouvé par le test, pas à la relecture.
  return total > 0 ? total : null;
}
