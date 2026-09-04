/**
 * Le calcul de la hauteur du clavier, isolé du hook React pour être éprouvable.
 *
 * `useHauteurClavier` branche les écouteurs et tient l'étalonnage ; tout ce qui
 * peut se tromper est ici, et `hauteurClavier.test.ts` rejoue les mesures
 * relevées sur l'iPhone de Chris le 2026-09-04.
 */

/** En dessous, c'est du bruit (barre d'URL, barre d'outils), pas un clavier. */
export const SEUIL_BRUIT = 60;

export interface MesureViewport {
  /**
   * La hauteur visible relevée pendant qu'AUCUN champ n'était focalisé.
   * Auto-étalonnée par le hook, jamais un nombre en dur : c'est ce qui rend le
   * calcul valable sur n'importe quelle taille d'écran.
   */
  plein: number;
  /** `visualViewport.height` maintenant. */
  hauteurVisible: number;
  /** Un champ de saisie est focalisé. */
  ouvert: boolean;
}

/**
 * La hauteur occupée par le clavier. Zéro s'il est fermé.
 *
 * ⚠️ `window.innerHeight` n'entre PAS dans ce calcul, et c'est tout l'enjeu du
 * fichier. Mesuré sur iPhone à 16 ms d'écart :
 *
 *     3482 ms   innerHeight 394   visible 394   ← iOS l'écrase pendant l'animation
 *     3498 ms   innerHeight 797   visible 394   ← il le restaure, SANS evenement
 *
 * Sa restauration ne déclenche rien — `visualViewport` n'a pas bougé — donc un
 * calcul qui s'appuie dessus reste figé sur le zéro mesuré pendant l'animation,
 * pour toujours. Toute valeur qui entre dans un calcul réactif doit avoir un
 * événement qui annonce son changement ; celle-ci n'en a aucun.
 *
 * L'ouverture vient du focus et non d'un écart de pixels : c'est la question
 * qu'on se pose vraiment, elle n'a pas de seuil à deviner, et elle reste vraie
 * quand on passe d'un champ à l'autre — moment où aucune hauteur ne change.
 */
export function hauteurClavier({ plein, hauteurVisible, ouvert }: MesureViewport): number {
  if (!ouvert) return 0;
  const manque = plein - hauteurVisible;
  return manque > SEUIL_BRUIT ? Math.round(manque) : 0;
}
