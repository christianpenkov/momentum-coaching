/* La dernière publication d'un élève, toutes plateformes et tous formats confondus.
 *
 * Demandé par Chris le 2026-09-04 pour le KPI « Publications sur le compte » de la fiche
 * client : le compteur dit COMBIEN, jamais QUAND ni QUOI. Un élève à 49 publications
 * dont la dernière remonte à six mois se lit comme un élève actif.
 *
 * ⚠️ Ce fichier ne compte rien et ne va rien chercher : il reçoit des candidats déjà
 * lus par l'appelant et désigne le plus récent. La règle de comptage des publications
 * vit dans `stats_clients_series` (base) et dans `PageClientStats` — en ajouter une
 * troisième ici recréerait l'écart entre écrans corrigé la veille.
 */
import { ecartEnJours } from './statsClients.ts';
import { parisDateStr } from './period.ts';

/** Les cinq formats réellement distinguables en base, vérifiés le 2026-09-04 :
 *  `post_type` ne porte que `FEED` et `REELS`, `is_short` sépare les deux formats
 *  YouTube, et les stories vivent dans leur propre table. */
export type FormatPublication = 'reel' | 'post' | 'story' | 'short' | 'video';

export const LIBELLE_FORMAT: Record<FormatPublication, string> = {
  reel:  'Reel Instagram',
  post:  'Post Instagram',
  story: 'Story Instagram',
  short: 'Short YouTube',
  video: 'Vidéo YouTube',
};

export interface ContenuPublie {
  format: FormatPublication;
  /** Instant de publication. `null` quand la source ne le connaît pas — le contenu est
   *  alors ÉCARTÉ, jamais daté au jugé. */
  publieLe: string | null | undefined;
}

/** Le type Instagram tel que l'API le rend, ramené à l'un des deux formats.
 *
 *  ⚠️ La liste des valeurs « reel » vient de `PageClientStats` (`estReel`), pour que les
 *  deux écrans classent un contenu de la même façon. `REELS` est la seule valeur présente
 *  en base aujourd'hui ; les autres sont là parce que l'API a déjà changé de vocabulaire. */
export function formatInstagram(type: string | null | undefined): FormatPublication {
  const t = (type ?? '').toUpperCase();
  return t === 'REEL' || t === 'REELS' || t === 'VIDEO' ? 'reel' : 'post';
}

/** Le plus récent des candidats. Un candidat sans date est écarté : on ne devine pas.
 *
 *  ⚠️ Renvoie `null` plutôt qu'un objet vide — l'appelant doit distinguer « rien publié »
 *  de « publié à une date inconnue », et les deux se disent avec des mots différents. */
export function laPlusRecente(contenus: ContenuPublie[]): { format: FormatPublication; publieLe: string } | null {
  let meilleur: { format: FormatPublication; publieLe: string; t: number } | null = null;
  for (const c of contenus) {
    if (!c.publieLe) continue;
    const t = new Date(c.publieLe).getTime();
    if (Number.isNaN(t)) continue;
    if (meilleur === null || t > meilleur.t) meilleur = { format: c.format, publieLe: c.publieLe, t };
  }
  return meilleur ? { format: meilleur.format, publieLe: meilleur.publieLe } : null;
}

/** « le 22/08/2026 · il y a 13 j ».
 *
 *  La date exacte répond à la demande de Chris ; l'écart est ce qui fait tiquer sans
 *  calcul mental — « il y a 193 j » se lit comme un problème, « 23/02/2026 » oblige à
 *  connaître la date du jour et à soustraire.
 *
 *  ⚠️ L'écart se compte en jours CALENDAIRES, en heure de Paris, exactement comme la
 *  fraîcheur de Stats Clients : une division du nombre de millisecondes par 86 400 000
 *  ferait dépendre le résultat de l'heure à laquelle on ouvre la page. */
export function formaterQuand(publieLe: string, aujourdhui: string): string | null {
  const d = new Date(publieLe);
  if (Number.isNaN(d.getTime())) return null;
  const jour = parisDateStr(d);
  const n = ecartEnJours(jour, aujourdhui);
  const date = `le ${jour.slice(8, 10)}/${jour.slice(5, 7)}/${jour.slice(0, 4)}`;
  if (n === null) return date;
  if (n <= 0) return `${date} · aujourd'hui`;
  if (n === 1) return `${date} · hier`;
  return `${date} · il y a ${n} j`;
}
