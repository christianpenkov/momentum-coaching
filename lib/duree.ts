/**
 * Formatage des durees — source unique pour toute la plateforme.
 *
 * Pourquoi ce fichier existe : le watch time etait formate a trois endroits avec
 * trois regles differentes. La carte affichait « 0 min » pendant que l'axe du meme
 * graphique montrait « 40s », parce que chaque appel refaisait son propre arrondi.
 * Le probleme n'etait pas l'arrondi mais sa duplication (2026-08-21).
 *
 * Regle de choix :
 *   - une duree ECOULEE (temps de visionnage, duree moyenne d'une vue) → dureeDepuisMinutes
 *     ou dureeDepuisSecondes selon l'unite de la donnee d'origine ;
 *   - une POSITION dans une video (courbe de retention) → positionLecteur.
 *
 * Ne jamais reformater une duree a la main ailleurs : ajouter un cas ici.
 */

/**
 * Formate une duree exprimee en SECONDES.
 *
 * L'unite s'adapte pour que deux valeurs proches ne s'ecrasent jamais sur le meme
 * libelle — c'est ce qui rend un axe de graphique lisible. Un arrondi en minutes
 * entieres graduait « 1 min, 1 min, 1 min, 0 min, 0 min » sur une chaine dont les
 * journees vont de 0 a 16 minutes.
 *
 *   45      → « 45s »
 *   90      → « 1m30s »
 *   240     → « 4 min »
 *   5400    → « 1,5h »
 *   43200   → « 12h »
 */
export function dureeDepuisSecondes(sec: number): string {
  if (!Number.isFinite(sec)) return '—';
  const s = Math.max(0, sec);

  if (s >= 3600) {
    const h = s / 3600;
    // Une decimale sous 10h, sinon les heures entieres suffisent.
    return h >= 10
      ? `${Math.round(h)}h`
      : `${String(Math.round(h * 10) / 10).replace('.', ',')}h`;
  }
  // Au-dela de 3 minutes, la seconde n'apporte plus rien de lisible.
  if (s >= 180) return `${Math.round(s / 60)} min`;

  const arrondi = Math.round(s);
  return arrondi >= 60
    ? `${Math.floor(arrondi / 60)}m${String(arrondi % 60).padStart(2, '0')}s`
    : `${arrondi}s`;
}

/**
 * Formate une duree exprimee en MINUTES (unite des colonnes yt_watch_time_*_min).
 *
 * Simple conversion vers dureeDepuisSecondes : une seule regle d'arrondi existe,
 * et les deux unites de stockage y aboutissent.
 */
export function dureeDepuisMinutes(min: number): string {
  if (!Number.isFinite(min)) return '—';
  return dureeDepuisSecondes(min * 60);
}

/**
 * Formate une POSITION dans une video, facon lecteur video : « 3:45 ».
 *
 * A ne pas confondre avec une duree ecoulee. « 3:45 » situe un instant dans la
 * video (courbe de retention), « 3m45s » mesure un temps passe. Les deux etaient
 * portees par une fonction `fmtSec` chacune, dans le meme fichier.
 */
export function positionLecteur(sec: number): string {
  if (!Number.isFinite(sec)) return '—';
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const reste = Math.round(s % 60);
  // 59,6s arrondit a 60 : sans report, on afficherait « 3:60 ».
  return reste === 60
    ? `${m + 1}:00`
    : `${m}:${String(reste).padStart(2, '0')}`;
}

/**
 * Duree TOTALE d'une video, facon YouTube : « 3:45 », ou « 1:05:30 » au-dela d'une heure.
 *
 * Meme rendu que le mode direct, qui formate la chaine ISO 8601 de l'API
 * (app/api/youtube/stats/route.ts, parseDuration) : le mode historique lit des
 * secondes stockees en base et doit produire exactement la meme chose, sans quoi la
 * meme video s'afficherait « 1:05:30 » sur une periode et « 65:30 » sur une autre.
 *
 * Distincte de positionLecteur, qui situe un INSTANT dans la video et n'a pas besoin
 * du cas des heures.
 */
export function formaterDureeVideo(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '';
  const total = Math.round(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}
