// ─────────────────────────────────────────────────────────────────────────────
// D'où vient une fiche Instagram — et dans quel sens le premier DM est parti
//
// ── LES DEUX AXES, À NE PAS CONFONDRE ────────────────────────────────────────
//
// L'ÉTAPE dit où en est la personne dans l'entonnoir (`lib/pipelineStage.ts`).
// L'ORIGINE dit d'où elle vient. Une personne à qui l'élève a écrit et une
// personne qui a écrit à l'élève sont exactement au même endroit de l'entonnoir
// — une conversation existe, rien de plus — mais elles ne viennent pas du même
// endroit. Même colonne, origine différente.
//
// C'est pour ça qu'il n'y a PAS de colonne « DM entrant » dans le kanban :
// ajouter une colonne dirait que ces gens sont plus ou moins avancés que les
// autres, ce qui est faux. Le sens se lit sur le badge, et en toutes lettres
// dans la fiche.
//
// ── POURQUOI UN FICHIER PLUTÔT QU'UNE COMPARAISON SUR PLACE ──────────────────
//
// Parce qu'ajouter une valeur d'origine sans l'apprendre à chaque lecteur est
// le défaut qu'on vient de payer : `keyword_matched = 'cold_dm'` obligeait
// chaque écran à connaître l'exception, et un seul l'avait oubliée.
//
// Treize endroits comparaient `source === 'cold_dm'`. En ajouter une quatorzième
// à chaque nouvelle origine, c'est garantir qu'un jour l'un d'eux sera oublié —
// et un oubli ici ne casse rien de visible : la fiche se range simplement au
// mauvais endroit, en silence. Les lecteurs posent donc une QUESTION
// (« est-ce un DM ? ») au lieu de tester une VALEUR.
//
// ── L'ATTRIBUTION N'EST PAS ICI, ET C'EST VOULU ──────────────────────────────
//
// « D'où vient la personne » et « à quoi on crédite la vente » sont deux
// questions différentes. Une vente va au dernier contenu complet : quelqu'un
// arrivé par DM entrant qui prend ensuite un lead magnet et achète, sa vente va
// au LEAD MAGNET — l'origine reste seulement l'histoire de son arrivée.
//
// C'est déjà ce que fait `app/api/payments/links` : il ne retient l'origine
// qu'À DÉFAUT de premier contact (`if (!firstTouch && …)`). Une origine de plus
// n'y change donc rien, et un DM entrant y tombe naturellement du bon côté —
// `organic`, ce qu'il est.
// ─────────────────────────────────────────────────────────────────────────────

/** L'élève a écrit le premier (démarchage). */
export const ORIGINE_COLD_DM = 'cold_dm';

/** La personne a écrit la première, sans avoir rien commenté. */
export const ORIGINE_DM_ENTRANT = 'dm_entrant';

/** Une conversation en DM, quel qu'en soit l'initiateur. */
export function estOrigineDm(source: string | null | undefined): boolean {
  return source === ORIGINE_COLD_DM || source === ORIGINE_DM_ENTRANT;
}

/** La personne a écrit la première. */
export function estDmEntrant(source: string | null | undefined): boolean {
  return source === ORIGINE_DM_ENTRANT;
}

/**
 * Le sens du premier message, ou `null` quand la question ne se pose pas — un
 * commentaire n'a pas de sens d'envoi.
 *
 * `null` n'est pas « on ne sait pas » : c'est « il n'y a rien à dire ». Un écran
 * qui affiche une flèche sur un commentaire affirmerait quelque chose de faux.
 */
export function sensDuDm(source: string | null | undefined): 'entrant' | 'sortant' | null {
  if (source === ORIGINE_DM_ENTRANT) return 'entrant';
  if (source === ORIGINE_COLD_DM) return 'sortant';
  return null;
}

/**
 * La flèche du badge — décision de Chris (2026-09-05) : une seule colonne
 * « Cold DM », le sens porté par un symbole.
 *
 * ↗ part de nous, ↙ vient vers nous.
 */
export function flecheDuDm(source: string | null | undefined): string {
  const sens = sensDuDm(source);
  return sens === 'entrant' ? '↙' : sens === 'sortant' ? '↗' : '';
}

/**
 * Le nom d'une origine, en toutes lettres.
 *
 * ⚠️ Ce sont les valeurs de `instagram_leads.source`, PAS celles de
 * `calls.source` (`ig_bio`, `ig_description`, …) : deux vocabulaires distincts
 * que rien n'empêche de mélanger, sinon de le dire ici. Un mélange donne un
 * libellé vide, sans erreur.
 */
export const LIBELLE_ORIGINE: Record<string, string> = {
  [ORIGINE_COLD_DM]:     'Cold DM',
  [ORIGINE_DM_ENTRANT]:  'DM entrant',
  comment:               'Commentaire',
  story_reply:           'Réponse à une story',
};
