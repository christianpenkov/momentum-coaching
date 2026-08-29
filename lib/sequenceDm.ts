// ─────────────────────────────────────────────────────────────────────────────
// La règle des champs obligatoires d'une séquence de DM.
//
// Elle vit ici, et pas dans le composant, parce qu'elle s'applique à DEUX
// formulaires — les posts et les stories, unifiés le 2026-08-28 — et qu'un
// garde-fou appliqué à un seul des deux ne garde rien.
// ─────────────────────────────────────────────────────────────────────────────

export interface ChampsSequence {
  /** DM1 — le premier message reçu, celui qui porte le bouton d'accroche. */
  accroche: string;
  /** Le libellé du bouton du DM1. Son clic est un postback. */
  accrocheBtn: string;
  /** Le libellé du bouton du DM2, celui qui porte l'URL du lead magnet. */
  lienBtn: string;
}

/**
 * Rend la raison du refus, ou `null` si la séquence peut être enregistrée.
 *
 * Trois champs ne peuvent pas rester vides : l'accroche, le bouton de
 * l'accroche, et le bouton qui porte le lien.
 *
 * « Vide » ne veut pas dire « rien » ici. Le webhook remplace un champ manquant
 * par un texte générique — « 🚀 Je veux le lien ! », « 👋 Clique sur le bouton
 * pour recevoir le lien ! » — qui part au nom du coach sans qu'il l'ait jamais
 * écrit, pendant que l'aperçu, lui, affiche une bulle vide. Le coach ne voit donc
 * pas ce que son prospect recevra : c'est le pire des deux mondes, et c'est
 * silencieux.
 *
 * Le bouton de l'accroche est le plus critique des trois : son clic est un
 * postback, et le postback est la SEULE chose qui ouvre la fenêtre de 24 h de
 * Meta. Sans libellé, pas de bouton — donc pas de fenêtre, donc le message du
 * lien ne part jamais et la séquence meurt au premier message.
 *
 * Le texte du lien et la relance ont le droit d'être vides, et ne sont donc pas
 * demandés ici : le premier laisse un message réduit à son bouton, la seconde
 * n'existe simplement pas et la conversation s'arrête après le lien.
 */
export function refusSequence(v: ChampsSequence): string | null {
  if (!v.accroche.trim())    return "L'accroche ne peut pas être vide : c'est le premier message que reçoit le prospect.";
  if (!v.accrocheBtn.trim()) return "Le bouton de l'accroche ne peut pas être vide : c'est son clic qui autorise l'envoi du lien.";
  if (!v.lienBtn.trim())     return "Le bouton du lien ne peut pas être vide : c'est lui qui porte le lien du lead magnet.";
  return null;
}
