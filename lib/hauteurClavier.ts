/**
 * Le calcul de la hauteur du clavier, isolé du hook React pour être éprouvable.
 *
 * Le hook `useHauteurClavier` se contente de brancher les écouteurs de
 * `visualViewport` et d'appeler cette fonction. Tout ce qui peut se tromper est
 * ici, et `hauteurClavier.test.ts` rejoue les mesures réelles d'un iPhone.
 */

/** Au-dessous de ce nombre de pixels, on ne considère pas qu'un clavier est ouvert. */
export const SEUIL_CLAVIER = 100;

export interface MesureViewport {
  /** `window.innerHeight` — la hauteur du viewport de MISE EN PAGE. */
  innerHeight: number;
  /** `visualViewport.height` — la hauteur réellement visible. */
  hauteurVisible: number;
  /** `visualViewport.offsetTop` — le décalage de la zone visible. */
  decalage: number;
}

/**
 * La hauteur occupée par le clavier. Zéro s'il est fermé.
 *
 * ⚠️ `decalage` n'entre PAS dans ce calcul, et c'est tout le piège de ce fichier.
 *
 * iOS fait deux choses distinctes quand le clavier s'ouvre : il RÉTRÉCIT la zone
 * visible (le clavier occupe le bas), puis il la DÉCALE vers le bas pour amener
 * le champ touché sous les yeux. La première dit la hauteur du clavier, la
 * seconde dit seulement OÙ regarder — elle appartient au positionnement
 * (`dessus`), jamais à la hauteur.
 *
 * Les avoir confondues (`innerHeight - hauteurVisible - decalage`, commit
 * `f7c9956`) donnait exactement le symptôme rapporté par Chris le 2026-09-04 :
 * la feuille passait en plein écran à l'ouverture du clavier (décalage encore
 * nul), puis retombait dès qu'iOS décalait la vue — le décalage soustrait
 * faisait passer le résultat sous le seuil — et ne revenait en plein écran que
 * si on remontait le défilement à la main, ce qui ramène le décalage à zéro.
 *
 * Un défaut de cette famille ne se voit pas à la lecture : le calcul faux et le
 * calcul juste donnent le même nombre au premier instant. Il faut le rejouer sur
 * les trois moments, ce que fait le test.
 */
export function hauteurClavier({ innerHeight, hauteurVisible }: MesureViewport): number {
  const occupe = innerHeight - hauteurVisible;
  return occupe > SEUIL_CLAVIER ? Math.round(occupe) : 0;
}
