/**
 * Recherche d'un call par le nom de la personne.
 *
 * ── CE QU'ELLE REGARDE, ET RIEN D'AUTRE ─────────────────────────────────────
 *
 * Le NOM seul. Pas le titre du call, pas l'email.
 *
 * C'est un choix, pas un oubli : le nom est le seul champ visible sur la carte.
 * Chercher dans un champ qu'on n'affiche pas fait remonter des résultats dont on
 * ne voit pas la raison — on croit alors à un bug de la recherche, et on cesse de
 * s'en servir.
 *
 * ── INSENSIBLE AUX ACCENTS ET À LA CASSE ────────────────────────────────────
 *
 * « leroy » doit trouver « Léroy », et « joel » trouver « Joël ». Les noms
 * viennent de Calendris et d'Instagram : personne ne les tape avec leurs
 * diacritiques. Même normalisation que le matching de mots-clés des lead magnets
 * (`normalizeForKeywordMatch`), pour la même raison.
 */

/** Minuscules, sans accents, sans espaces de bord. */
export function normaliser(texte: string | null | undefined): string {
  if (!texte) return '';
  // NFD décompose « é » en « e » + accent, que \p{Diacritic} retire ensuite.
  return texte.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

/**
 * Ce call correspond-il à la recherche ?
 *
 * Une recherche vide accepte tout : c'est ce qui permet d'appeler ce filtre sans
 * condition, plutôt que de le sauter quand le champ est vide.
 *
 * @param nom      le nom affiché sur la carte — celui que la personne voit.
 * @param recherche ce qui est tapé dans la barre.
 */
export function correspond(nom: string | null | undefined, recherche: string): boolean {
  const q = normaliser(recherche);
  if (!q) return true;
  return normaliser(nom).includes(q);
}

/**
 * Filtre une liste de calls sur le nom de leur interlocuteur.
 *
 * `nomDe` est fourni par l'appelant plutôt que déduit ici : le nom affiché n'est
 * pas une colonne, il se résout différemment côté coach et côté élève (client
 * lié, invité Calendly, ou « Coach »). Le déduire ici ferait diverger la
 * recherche de ce qui est écrit à l'écran — et une recherche qui ne trouve pas ce
 * qu'on lit est pire que pas de recherche.
 */
export function filtrerCalls<T>(calls: readonly T[], recherche: string, nomDe: (call: T) => string | null | undefined): T[] {
  if (!normaliser(recherche)) return [...calls];
  return calls.filter(c => correspond(nomDe(c), recherche));
}
