// ─────────────────────────────────────────────────────────────────────────────
// Les deux premières marches de l'entonnoir de « Gérer mes liens ».
//
// Cette règle a été fausse DEUX FOIS le 2026-09-07 : elle comptait les lignes du
// journal (« 21 leads » pour une personne), puis elle comptait deux fois
// quelqu'un présent des deux côtés. Les deux fois, elle vivait en ligne dans un
// `useMemo` de 5 000 lignes, où rien ne pouvait la vérifier.
//
// Elle vit donc ici, avec ses tests.
//
// ── CE QUE L'ENTONNOIR MESURE ────────────────────────────────────────────────
//
// Ce que le CONTENU produit. D'où deux populations, et une exclusion :
//
//   • les personnes qui se sont manifestées d'elles-mêmes — un commentaire, une
//     réponse à une story, ou un DM qu'elles ont envoyé les premières ;
//   • celles qui ont réservé DIRECTEMENT depuis un contenu — bio, description ou
//     sticker de story — sans jamais écrire ;
//   • jamais le cold DM sortant : quelqu'un que le coach est allé chercher n'a
//     été produit par aucun contenu.
// ─────────────────────────────────────────────────────────────────────────────

import { canalDuDm } from './canalDm.ts';

/**
 * Les sources de `calls` qui désignent un rendez-vous pris depuis un contenu,
 * sans conversation préalable.
 *
 * ⚠️ Deux familles de `source` cohabitent dans la base et ne se ressemblent pas :
 * `calls` porte `ig_bio` / `ig_description` / `ig_story` / `yt_description`,
 * tandis que les leads et les liens portent `comment` / `cold_dm` /
 * `story_reply`. `canalDuDm` ne s'applique QU'À la seconde. C'est le piège
 * principal de ce calcul.
 *
 * `ig_story` en fait partie : un rendez-vous pris depuis le sticker d'une story
 * vient d'un contenu au même titre qu'un lien en description. `yt_bio` n'existe
 * pas encore en données, la catégorie est prévue.
 */
export const SOURCES_CONTENU_DIRECT = new Set([
  'ig_bio', 'ig_description', 'ig_story', 'yt_bio', 'yt_description',
]);

export interface LeadEntonnoir {
  id: string;
  ig_user_id?: string | null;
  ig_username?: string | null;
  source?: string | null;
  hook_replied?: boolean | null;
}

export interface CallEntonnoir {
  id: string;
  source?: string | null;
  ig_lead_id?: string | null;
  invitee_email?: string | null;
  invitee_name?: string | null;
}

/** La clé d'une personne côté calls. Même règle que `clefPersonne` de salesCallStats. */
function clefCall(c: CallEntonnoir): string {
  return (c.invitee_email || c.invitee_name || c.id).toLowerCase();
}

/** Les fiches produites par un contenu — tout sauf le cold DM sortant. */
export function fichesDuContenu(leads: LeadEntonnoir[]): LeadEntonnoir[] {
  return leads.filter(l => canalDuDm(l.source) !== 'sortant');
}

/**
 * La marche « Leads » : des PERSONNES, pas des interactions.
 *
 * ⚠️ Les deux apports ne partagent aucune clé — pseudo Instagram d'un côté,
 * e-mail ou nom d'invité de l'autre — et `instagram_leads` n'a pas de colonne
 * e-mail. Une personne qui a pris un lead magnet puis réservé depuis une bio ne
 * peut donc PAS être rapprochée d'elle-même, sauf si un `ig_lead_id` a été posé
 * sur son rendez-vous. C'est justement ce que fait la fusion automatique par
 * e-mail exact, et c'est pourquoi ce cas est traité ici.
 */
export function compterLeadsDuContenu(leads: LeadEntonnoir[], calls: CallEntonnoir[]): {
  total: number; personnesManifestees: number; callsDirectsPersonnes: number;
} {
  const retenues = fichesDuContenu(leads);
  const personnes = new Set(
    retenues.map(l => l.ig_user_id || l.ig_username).filter(Boolean) as string[],
  );

  // Les fiches DÉJÀ comptées. Un rendez-vous porté par l'une d'elles décrit une
  // personne déjà dans le total : la recompter par son e-mail l'ajouterait une
  // seconde fois, sous une autre clé.
  //
  // On compare aux fiches RETENUES, pas à toutes : un cold DM sortant qui
  // réserve ensuite depuis une bio n'est pas dans `personnes`, et son
  // rendez-vous doit donc bien le faire entrer — il vient d'un contenu.
  const idsComptees = new Set(retenues.map(l => l.id));

  const directs = new Set(
    calls
      .filter(c => SOURCES_CONTENU_DIRECT.has(c.source ?? '')
        && !(c.ig_lead_id && idsComptees.has(c.ig_lead_id)))
      .map(clefCall),
  );

  return {
    total: personnes.size + directs.size,
    personnesManifestees: personnes.size,
    callsDirectsPersonnes: directs.size,
  };
}

/**
 * La marche « Conversations » : les personnes qui ont répondu.
 *
 * Même exclusion que la marche précédente, et ce n'est pas un détail de style :
 * une marche ne peut pas contenir des gens que la précédente ignore. Compter ici
 * un cold DM sortant afficherait plus de conversations que de leads.
 */
export function compterConversationsDuContenu(leads: LeadEntonnoir[]): number {
  return fichesDuContenu(leads).filter(l => l.hook_replied).length;
}
