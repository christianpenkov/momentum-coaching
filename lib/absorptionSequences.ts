// ─────────────────────────────────────────────────────────────────────────────
// Regrouper des stories dont certaines portent DÉJÀ un mot-clé.
//
// ── LE PROBLÈME QUE CE FICHIER RÉSOUT ────────────────────────────────────────
//
// Poser un lead magnet sur une story unique crée une séquence à UNE story —
// obligatoirement, parce que le webhook ne sait lire un mot-clé que par
// `ig_stories.sequence_id → story_sequences.lm_keyword`. Rien n'est stocké sur
// la story elle-même.
//
// Conséquence : cette story appartient à une séquence. Et comme une séquence doit
// être un bloc continu (`validateContiguity`), elle bloquait ensuite TOUT
// regroupement qui l'englobe. Tu publies 4 stories, tu poses un mot-clé sur la
// deuxième, tu ne peux plus jamais grouper les quatre — sans porte de sortie.
//
// ── LA RÈGLE RETENUE ─────────────────────────────────────────────────────────
//
// La sélection ABSORBE les séquences qu'elle contient entièrement. Décision de
// Chris le 2026-09-08 : une séquence à une story n'est pas un objet qu'il a voulu
// créer, c'est la conséquence technique d'un mot-clé — elle ne doit donc pas se
// comporter comme un obstacle.
//
// Absorber veut dire : reprendre son CTA, migrer ses leads vers la nouvelle
// séquence, puis la supprimer. Rien n'est perdu, et surtout pas le rattachement
// des leads — `instagram_leads.story_sequence_id` est en `NO ACTION`, une
// séquence encore référencée ne PEUT PAS être supprimée.
//
// ── CE QU'ON REFUSE, ET POURQUOI ─────────────────────────────────────────────
//
// Une séquence seulement PARTIELLEMENT sélectionnée n'est pas absorbée : on la
// démantèlerait dans le dos du coach, en laissant derrière des stories orphelines
// et des statistiques amputées. On refuse en le disant.
//
// Deux CTA différents ne se fusionnent pas non plus tout seuls : une séquence n'a
// qu'un mot-clé et qu'un jeu de messages. On rend le conflit au client pour qu'il
// demande, plutôt que d'en abandonner un en silence — c'est le genre de perte qui
// se paie trois semaines plus tard, quand un prospect ne reçoit rien.
// ─────────────────────────────────────────────────────────────────────────────

export interface SequenceExistante {
  id: string;
  name: string;
  /** Les stories qu'elle contient aujourd'hui. */
  storyIds: string[];
  lm_keyword?: string | null;
  calendly_short_url?: string | null;
}

/** Le CTA qu'une séquence absorbée transmet à celle qui la remplace. */
export interface CtaHerite {
  sequenceId: string;
  name: string;
  lmKeyword: string | null;
  calendlyShortUrl: string | null;
}

export type Absorption =
  /** Rien à absorber : aucune story sélectionnée n'appartient à une séquence. */
  | { type: 'aucune' }
  /** Une ou plusieurs séquences sont entièrement reprises. */
  | { type: 'absorber'; sequenceIds: string[]; herite: CtaHerite | null }
  /** Une séquence n'est que partiellement sélectionnée — on ne la démantèle pas. */
  | { type: 'refus-partiel'; sequence: SequenceExistante; manquantes: string[] }
  /** Plusieurs CTA en lice : au client de demander lequel garder. */
  | { type: 'conflit-cta'; sequenceIds: string[]; candidats: CtaHerite[] };

const porteUnCta = (s: SequenceExistante) => !!(s.lm_keyword || s.calendly_short_url);

const enCta = (s: SequenceExistante): CtaHerite => ({
  sequenceId: s.id,
  name: s.name,
  lmKeyword: s.lm_keyword ?? null,
  calendlyShortUrl: s.calendly_short_url ?? null,
});

/**
 * Que faire des séquences auxquelles appartiennent déjà les stories sélectionnées.
 *
 * @param storyIdsSelectionnees les stories que le coach vient de cocher
 * @param sequencesConcernees   les séquences possédant AU MOINS une de ces stories
 * @param heriterDe             la séquence dont le coach a choisi de garder le CTA,
 *                              après qu'un conflit lui a été rendu
 */
export function planifierAbsorption(
  storyIdsSelectionnees: string[],
  sequencesConcernees: SequenceExistante[],
  heriterDe?: string | null,
): Absorption {
  if (sequencesConcernees.length === 0) return { type: 'aucune' };

  const selection = new Set(storyIdsSelectionnees);

  // ── Une séquence à moitié prise serait une séquence détruite ───────────────
  //
  // On signale la PREMIÈRE rencontrée, avec ce qui manque : le coach a besoin de
  // savoir quoi cocher en plus, pas seulement que c'est refusé.
  for (const seq of sequencesConcernees) {
    const manquantes = seq.storyIds.filter(id => !selection.has(id));
    if (manquantes.length > 0) return { type: 'refus-partiel', sequence: seq, manquantes };
  }

  const sequenceIds = sequencesConcernees.map(s => s.id);
  const avecCta = sequencesConcernees.filter(porteUnCta);

  // Aucun CTA à reprendre : les séquences absorbées n'étaient que des regroupements.
  if (avecCta.length === 0) return { type: 'absorber', sequenceIds, herite: null };

  // Un seul CTA en lice : il passe, sans rien demander.
  if (avecCta.length === 1) return { type: 'absorber', sequenceIds, herite: enCta(avecCta[0]) };

  // Plusieurs. Si le coach a déjà tranché, on honore son choix — mais seulement
  // s'il désigne l'une des séquences réellement en lice : un identifiant venu
  // d'ailleurs ferait hériter d'un CTA que personne n'a vu.
  const choisie = heriterDe ? avecCta.find(s => s.id === heriterDe) : undefined;
  if (choisie) return { type: 'absorber', sequenceIds, herite: enCta(choisie) };

  return { type: 'conflit-cta', sequenceIds, candidats: avecCta.map(enCta) };
}

/** Le message rendu au coach quand une séquence n'est que partiellement sélectionnée. */
export function messageRefusPartiel(seq: SequenceExistante, manquantes: string[]): string {
  const n = manquantes.length;
  return `La séquence « ${seq.name} » compte ${n} stor${n > 1 ? 'ies' : 'y'} que tu n'as pas sélectionnée${n > 1 ? 's' : ''}. `
    + `Sélectionne-la${n > 1 ? 's' : ''} aussi pour la reprendre entièrement, ou décoche ses stories.`;
}
