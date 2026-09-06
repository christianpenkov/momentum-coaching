// ─────────────────────────────────────────────────────────────────────────────
// Quel lead magnet répond à ce message ?
//
// La règle vit ici, hors du webhook, pour une seule raison : c'est elle qui
// porte la promesse de zéro maintenance, et une règle qu'on ne peut pas tester
// n'est pas une garantie, c'est une intention.
//
// Trois cas, un seul ordre :
//
//   message reçu
//     │
//     ├─ réponse à une story rattachée à une séquence, dont le mot-clé
//     │  correspond ? ────────────────────────────► la SÉQUENCE répond
//     │                                             (réglée pour ce lancement,
//     │                                              porte ses propres messages)
//     │
//     └─ sinon ───────────────────────────────────► le mot-clé PERMANENT
//                                                    d'un lead magnet, s'il
//                                                    en existe un
//
// Le plus précis gagne. Et un mot-clé ne désigne qu'UN lead magnet — garanti par
// l'index `lead_magnets_mot_cle_unique` — donc le second cas n'a jamais à
// départager quoi que ce soit. C'est là que Momentum diffère de ManyChat, qui
// range ses mots-clés dans une liste ordonnée et fait gagner le premier : un
// ordre invisible, à maintenir à la main, et à re-vérifier à chaque ajout.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Comparaison des mots-clés : minuscules, sans accents, et « contient » plutôt
 * qu'« égale ».
 *
 * « contient » parce que personne n'écrit le mot-clé tout seul : on reçoit
 * « Guide stp ! » ou « je veux le GUIDE 🙏 ». Exiger l'égalité stricte ferait
 * échouer la quasi-totalité des vrais messages.
 */
export function normaliserMotCle(brut: string): string {
  return brut.toLowerCase().trim().normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

export function messageContientMotCle(texte: string, motCle: string | null | undefined): boolean {
  if (!motCle || !motCle.trim()) return false;
  return normaliserMotCle(texte).includes(normaliserMotCle(motCle));
}

/** La configuration d'une séquence de stories, telle que la base la rend. */
export interface SequenceCandidate {
  lm_keyword: string | null;
  dm_lm_message: string | null;
  dm_button_text: string | null;
  dm2_story_message: string | null;
}

/** Un lead magnet dont le mot-clé répond partout. */
export interface LeadMagnetPermanent {
  id: string;
  name: string;
  keyword: string | null;
  dm_accroche: string | null;
  dm_accroche_bouton: string | null;
  dm_relance: string | null;
}

/** Ce qui doit partir, et d'où ça vient. */
export interface Declencheur {
  keyword: string;
  accroche: string | null;
  accrocheBtn: string | null;
  relance: string | null;
  origine: 'sequence' | 'permanent';
  /** L'identifiant du lead magnet — seulement pour le mot-clé permanent. */
  leadMagnetId: string | null;
}

/**
 * Choisit le déclencheur, ou rend `null` si le message ne réclame rien.
 *
 * ⚠️ Ne décide PAS s'il faut envoyer : le mot-clé permanent est soumis à une
 * garde « une fois par personne et par lead magnet », qui demande de lire le
 * journal. `gardeDejaRecuRequise` dit quand cette lecture est nécessaire —
 * elle ne l'est jamais pour une séquence, dont le comportement ne change pas.
 */
export function choisirDeclencheur(
  texte: string,
  sequence: SequenceCandidate | null | undefined,
  lmPermanents: LeadMagnetPermanent[],
): Declencheur | null {
  if (!texte.trim()) return null;

  if (sequence && messageContientMotCle(texte, sequence.lm_keyword)) {
    return {
      keyword: sequence.lm_keyword!,
      accroche: sequence.dm_lm_message,
      accrocheBtn: sequence.dm_button_text,
      relance: sequence.dm2_story_message,
      origine: 'sequence',
      leadMagnetId: null,
    };
  }

  const trouve = lmPermanents.find(lm => messageContientMotCle(texte, lm.keyword));
  if (!trouve) return null;

  return {
    keyword: trouve.keyword!,
    accroche: trouve.dm_accroche,
    accrocheBtn: trouve.dm_accroche_bouton,
    relance: trouve.dm_relance,
    origine: 'permanent',
    leadMagnetId: trouve.id,
  };
}

/**
 * Faut-il vérifier que la personne n'a pas déjà reçu ce lead magnet ?
 *
 * Oui pour le mot-clé permanent, non pour une séquence.
 *
 * Sans cette garde, le cas le PLUS courant d'un message contenant le mot-clé —
 * « merci pour le GUIDE ! » — renverrait le fichier et ferait reculer la carte
 * du prospect à « LM envoyé » alors qu'il est en pleine conversation. Le bloc
 * du webhook se termine par `continue` : il sauterait aussi l'enregistrement de
 * la réponse, et la conversation n'existerait jamais.
 *
 * Une séquence garde son comportement d'avant : elle est réglée pour un
 * lancement précis, et son propre verrou anti-doublon d'une minute suffit.
 */
export function gardeDejaRecuRequise(d: Declencheur): boolean {
  return d.origine === 'permanent';
}
