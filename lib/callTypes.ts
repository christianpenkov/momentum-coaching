// Vente ou coaching : la reponse vit ICI, une seule fois, pour les deux runtimes.
//
// Module volontairement SANS import : il est charge aussi bien par Next
// (`@/lib/callTypes`) que par les Edge Functions Deno (chemin relatif avec
// extension, comme `lib/shortio-link-category.ts` l'est deja par backfill-shortio).
// C'est ce qui permet a la liste de ne pas exister en deux copies — le piege que
// docs/fuseaux-horaires.md documente pour le formatage d'heure, ou deux runtimes
// ont fini avec deux verites.
//
// ── Pourquoi `manual` est de la vente ────────────────────────────────────────
// `calendly` : rendez-vous ne du sync Calendly. `manual` : MEME nature — un
// rendez-vous de vente — mais cree par la plateforme elle-meme, quand on saisit a
// la main la date d'un appel reporte ou d'un 2e call dans le rapport, ou depuis le
// geste « avancer vers RDV pris » du pipeline. Il n'a simplement pas de
// `calendly_event_uuid` : la contrainte `calls_call_type_uuid_consistency` impose
// d'ailleurs que SEULS les `calendly` en portent un — creer un call manuel sous le
// type `calendly` serait donc rejete par la base.
//
// Jusqu'au 2026-08-29, toutes les lectures de vente filtraient strictement
// `= 'calendly'`. Un call manuel etait ecrit en base et n'apparaissait sur AUCUN
// ecran, ne comptait nulle part, et ne pouvait pas recevoir de rapport. Pire, le
// geste « avancer vers RDV pris » creait un call que le pipeline lui-meme ne
// pouvait pas relire — la carte ne bougeait donc pas.
//
// ⚠️ Les filtres NEGATIFS (`!= 'calendly'`) doivent devenir `= 'google'`. Sans
// cela un call manuel apparait des DEUX cotes — vente ET coaching — et se compte
// deux fois a l'ecran.
export const CALL_TYPES_VENTE = ['calendly', 'manual'] as const;

export type CallTypeVente = typeof CALL_TYPES_VENTE[number];

export function estCallDeVente(call: { call_type?: string | null }): boolean {
  return CALL_TYPES_VENTE.includes(call.call_type as CallTypeVente);
}

export function estCallDeCoaching(call: { call_type?: string | null }): boolean {
  return call.call_type === 'google';
}
