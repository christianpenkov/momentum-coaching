'use client';

/**
 * Derniere FORME connue de l'accueil, retenue d'un lancement a l'autre.
 *
 * Au demarrage a froid, l'accueil affiche un squelette le temps de charger. Ce
 * squelette ne peut pas savoir si le bandeau « Prochain call » sera la (il ne
 * s'affiche que s'il y a un call dans les 24 h) ni s'il y aura des rapports en
 * attente. Sans indice, il ne reservait rien : le contenu arrivait ensuite et
 * poussait tout vers le bas.
 *
 * On retient donc ce que l'ecran contenait au dernier passage, et le squelette
 * reserve la place correspondante. Si la situation a change entre-temps, la
 * reservation est simplement fausse d'un bloc — jamais pire que l'absence
 * totale de reservation d'aujourd'hui.
 *
 * ATTENTION : on ne memorise QUE des formes (y avait-il un bandeau, combien de
 * cartes), jamais un contenu. Reafficher un nom ou une heure lus au lancement
 * precedent reviendrait a affirmer une donnee qu'on n'a pas verifiee — un call
 * annule s'afficherait comme s'il tenait toujours. Une place vide ne ment pas ;
 * une donnee perimee, si.
 */

/**
 * Cloisonne par espace : les deux accueils n'ont ni la meme structure ni les
 * memes donnees, et un meme navigateur peut voir les deux (Chris teste avec un
 * compte coach et un compte eleve). Une cle commune ferait reserver a l'un la
 * forme observee chez l'autre.
 */
export type AccueilScope = 'coach' | 'client';

const KEY = (scope: AccueilScope) => `momentum:accueil-shape:${scope}`;

export interface AccueilShape {
  /** Le bandeau « Prochain call » etait-il affiche au dernier passage ? */
  hasNextCall: boolean;
  /** Nombre de rapports en attente au dernier passage (0 = carrousel absent). */
  pendingRapports: number;
}

export const EMPTY_SHAPE: AccueilShape = { hasNextCall: false, pendingRapports: 0 };

export function readAccueilShape(scope: AccueilScope): AccueilShape {
  if (typeof localStorage === 'undefined') return EMPTY_SHAPE;
  try {
    const raw = localStorage.getItem(KEY(scope));
    if (!raw) return EMPTY_SHAPE;
    const parsed = JSON.parse(raw);
    return {
      hasNextCall: parsed?.hasNextCall === true,
      pendingRapports: Number(parsed?.pendingRapports) || 0,
    };
  } catch {
    // Stockage indisponible (navigation privee, quota) : on retombe sur « rien
    // a reserver », c'est-a-dire le comportement d'avant.
    return EMPTY_SHAPE;
  }
}

export function writeAccueilShape(scope: AccueilScope, shape: AccueilShape) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY(scope), JSON.stringify(shape));
  } catch { /* idem : perdre l'indice degrade l'affichage, ne le casse pas */ }
}
