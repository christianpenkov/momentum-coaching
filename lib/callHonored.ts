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