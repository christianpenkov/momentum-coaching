// Définition officielle unique de "call honoré" (décision produit, 2026-07-27) :
// un call sans rapport rempli (outcome null) compte comme NON honoré — tant que le
// rapport n'est pas rempli, c'est comme si le call n'avait pas encore eu lieu.
// Remplace les anciennes définitions divergentes (isCallHonoredStrict/Simple dans
// PageClientStats.tsx, logique inline dans ProspectDetailModal.tsx/PagePipeline.tsx)
// qui pouvaient donner des résultats différents pour un même call. Vérifié à cette
// date : 0 call call_type='calendly' actif et passé sans rapport en base — donc
// aucun impact chiffré rétroactif sur les données existantes.
export interface HonoredCheckCall {
  status: 'active' | 'canceled' | string;
  scheduled_at: string;
  outcome?: string | null;
  no_show?: boolean | null;
}

export function isCallHonored(c: HonoredCheckCall, now: Date): boolean {
  return c.status === 'active' && new Date(c.scheduled_at) < now && c.outcome != null && !c.no_show;
}

/** Un créneau posé, arrivé, et que le prospect n'a pas honoré. */
export function estRendezVousManque(c: HonoredCheckCall): boolean {
  return c.status === 'active' && !!c.no_show;
}

/**
 * Un rendez-vous dont l'issue est TRANCHÉE : la personne est venue, ou elle ne l'est pas.
 *
 * C'est le seul dénominateur honnête d'un taux de présence. Les deux autres candidats
 * mentent, chacun à sa façon :
 *
 *   - « tous les rendez-vous posés » compte les créneaux À VENIR comme des absences.
 *     Un mois avec trois rendez-vous encore à tenir afficherait un taux effondré, qui
 *     remonterait tout seul en les tenant. C'était tolérable tant qu'on affichait le
 *     no-show — un petit nombre se lit bien — et faux dès qu'on l'inverse.
 *   - « tous les rendez-vous passés » compte comme absences ceux dont le rapport n'est
 *     pas rempli, alors que la définition officielle du call honoré dit l'inverse :
 *     sans rapport, c'est comme si le call n'avait pas encore eu lieu.
 *
 * Conséquence voulue : présence % + no-show % = 100 % exactement. C'est ce qui permet
 * d'afficher l'un ou l'autre sans que les deux lectures se contredisent.
 */
export function estRendezVousTranche(c: HonoredCheckCall, now: Date): boolean {
  return isCallHonored(c, now) || estRendezVousManque(c);
}

export interface ShowUp {
  /** Rendez-vous honorés — le numérateur. */
  honores: number;
  /** Rendez-vous manqués. `honores + manques === tranches`, par construction. */
  manques: number;
  /** Rendez-vous à l'issue connue — le dénominateur, à ÉCRIRE partout où le taux s'affiche. */
  tranches: number;
  /** null quand aucun rendez-vous n'est encore tranché : un taux sur rien n'est ni bon ni mauvais. */
  taux: number | null;
}

/**
 * Le taux de présence, calculé UNE fois pour tous les écrans.
 *
 * Grain RENDEZ-VOUS, délibérément : un créneau posé puis manqué est un créneau perdu,
 * même s'il prolongeait une vente déjà ouverte. Son dénominateur n'est donc jamais
 * « Calls bookés », qui compte des opportunités — d'où l'obligation de l'écrire à côté
 * du taux sur chaque écran qui l'affiche.
 */
export function calculerShowUp(calls: HonoredCheckCall[], now: Date): ShowUp {
  const honores = calls.filter(c => isCallHonored(c, now)).length;
  const manques = calls.filter(estRendezVousManque).length;
  const tranches = honores + manques;
  return { honores, manques, tranches, taux: tranches > 0 ? (honores / tranches) * 100 : null };
}