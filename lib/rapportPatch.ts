/**
 * Ce qui part en base quand un rapport de vente est soumis.
 *
 * SEUL ENDROIT qui décide du contenu de l'écriture. Toute écriture ajoutée
 * ailleurs dans RapportModal est un bug : c'est précisément la dispersion (11
 * fonctions écrivaient au fil de l'eau) qui laissait `qualified` posé en base sur
 * des rapports jamais terminés, et qui pouvait marquer un call `outcome='closed'`
 * sans deal correspondant si l'utilisateur fermait après l'étape du montant.
 *
 * Fonction PURE : ni React, ni réseau, ni base. C'est ce qui la rend testable
 * (lib/rapportPatch.test.ts) et ce qui garantit qu'on peut vérifier les 5 chemins
 * terminaux sans ouvrir un navigateur.
 */

/**
 * Les résultats possibles d'un rendez-vous.
 *
 * ⚠️ Ce ne sont PAS les colonnes du pipeline. `rescheduled` et `second_call` ne
 * sont pas des résultats — ce sont des rendez-vous qui n'ont pas encore donné le
 * leur, et le lead reste actif en « RDV pris ». La traduction en colonne se fait
 * dans lib/pipelineStage.ts (OUTCOME_TO_ISSUE), pas ici.
 *
 * `lost` et `not_qualified` sont arrivés le 2026-08-27 : le pipeline avait deux
 * colonnes sans aucune source. La carte du parcours (docs/rapports-de-call.md)
 * passe donc de 5 à 7 sorties.
 */
export type OutcomeChoice =
  | 'closed' | 'second_call' | 'to_recontact' | 'rescheduled' | 'lost' | 'not_qualified';

/**
 * Ce qui a bloqué. Mêmes valeurs sur les trois branches qui la posent (perdu,
 * pas qualifié, à recontacter) : c'est la même question à deux moments, seule la
 * formulation change à l'écran.
 *
 * `pas_la_cible` n'est proposée que sur « pas qualifié » — ailleurs, elle
 * contredirait l'issue choisie.
 */
export type ObjectionChoice =
  | 'prix' | 'temps' | 'reflechir' | 'confiance' | 'autre_priorite' | 'pas_la_cible' | 'autre';

export const OBJECTIONS: readonly { key: ObjectionChoice; label: string; only?: OutcomeChoice }[] = [
  { key: 'prix',           label: 'Le prix / le budget' },
  { key: 'temps',          label: 'Le manque de temps' },
  { key: 'reflechir',      label: 'Doit réfléchir ou en parler' },
  { key: 'confiance',      label: 'Pas assez convaincu' },
  { key: 'autre_priorite', label: 'Une autre priorité passe avant' },
  { key: 'pas_la_cible',   label: "Aucune — il n'était pas la cible", only: 'not_qualified' },
  { key: 'autre',          label: 'Autre' },
] as const;

/** Les objections proposées pour une issue donnée. */
export function objectionsPour(outcome: OutcomeChoice | null): typeof OBJECTIONS {
  return OBJECTIONS.filter(o => !o.only || o.only === outcome) as unknown as typeof OBJECTIONS;
}

/** Les trois branches sur lesquelles la question « qu'est-ce qui a bloqué ? » se pose. */
export function demandeObjection(outcome: OutcomeChoice | null): boolean {
  return outcome === 'lost' || outcome === 'not_qualified' || outcome === 'to_recontact';
}

/** Toutes les réponses saisies. C'est cet objet qu'on sérialise dans le brouillon. */
export interface RapportAnswers {
  /** null = pas encore répondu. */
  showedUp: boolean | null;
  qualified: boolean | null;
  outcomeChoice: OutcomeChoice | null;
  /** Saisi tel quel, virgule décimale acceptée. */
  revenue: string;
  comment: string;
  /** Comment le prospect va reprendre rendez-vous (branches report / 2ᵉ call). */
  reschedHow: 'calendly' | 'manual' | 'unknown' | null;
  manualDate: string;
  manualTimeStart: string;
  manualTimeEnd: string;
  /** Lien de visio du prochain call, saisi a la main. Vit sur le CALL une fois
   *  cree (`join_url`), pas dans le rapport : il doit rester trouvable apres la
   *  fermeture du modal, et c'est aussi lui qui permet a Fathom de rattacher
   *  l'enregistrement par URL exacte. */
  manualJoinUrl: string;
  /** Créneau détecté automatiquement par Calendly. */
  foundCall: { id: string; scheduledAt: string; inviteeName: string | null } | null;
  /**
   * Modalités de paiement choisies et deal créé. Dernière question d'un deal
   * closé — tant qu'elle n'a pas de réponse, le rapport n'est pas terminé.
   */
  paymentDone?: boolean;
  /**
   * Encaissement hors Stripe : l'argent est-il déjà arrivé ? Question posée
   * uniquement sur ce chemin, et qui compte comme une étape à part entière —
   * sans elle un virement simplement convenu était compté comme encaissé.
   */
  offlineReceived?: boolean | null;
  /** Ce qui a bloqué. Posée sur perdu / pas qualifié / à recontacter. */
  objection?: ObjectionChoice | null;
  /** Le texte libre de « Autre ». Ignoré si l'objection n'est pas 'autre'. */
  objectionAutre?: string;
  /**
   * Quand recontacter, sur la seule branche « à recontacter ». Date locale
   * (AAAA-MM-JJ) : l'heure n'a pas de sens pour un rappel à trois semaines, et en
   * demander une serait une question de plus pour rien.
   */
  relanceAt?: string;
  /** Mode correction d'un rapport déjà soumis — sert aussi à détecter un brouillon périmé. */
  isCorrection: boolean;
}

/**
 * Ce qu'un rapport DÉJÀ SOUMIS contient, pour rouvrir la modale sur les réponses
 * existantes plutôt que sur des champs vides.
 *
 * Ce type était recopié à SIX endroits (les deux pages Calls, le pipeline à trois
 * reprises, le chargeur de modale). Ajouter une question au rapport obligeait donc
 * à penser à six fichiers — et l'objection avait été oubliée dans les six, si bien
 * que corriger un montant effaçait ce qui avait bloqué. Une seule définition, ici.
 */
export interface RapportExistant {
  revenue?: number | null;
  comment?: string | null;
  outcome?: string | null;
  qualified?: boolean | null;
  objection?: string | null;
  objectionAutre?: string | null;
  relanceAt?: string | null;
}

export const EMPTY_ANSWERS: RapportAnswers = {
  showedUp: null,
  qualified: null,
  outcomeChoice: null,
  revenue: '',
  comment: '',
  reschedHow: null,
  manualDate: '',
  manualTimeStart: '',
  manualTimeEnd: '',
  manualJoinUrl: '',
  foundCall: null,
  objection: null,
  objectionAutre: '',
  relanceAt: '',
  isCorrection: false,
};

export function parseAmount(revenue: string): number {
  return parseFloat(revenue.replace(',', '.')) || 0;
}

export interface RapportPatch {
  /** → PATCH /api/calls/{id}/rapport (liste blanche stricte côté route). */
  rapport: Record<string, unknown>;
  /** → PATCH /api/client/calls/{id} : champs du call lui-même. */
  callFields: Record<string, unknown>;
}

/**
 * @param answers      réponses saisies
 * @param scheduledAt  nouvelle date du call, déjà convertie en UTC par l'appelant
 *                     (la conversion dépend du fuseau du lecteur, hors périmètre
 *                     d'une fonction pure)
 */
export function buildRapportPatch(answers: RapportAnswers, scheduledAt?: string | null): RapportPatch {
  const a = answers;

  // Le commentaire : en correction on envoie la chaîne même vide, pour pouvoir
  // EFFACER un commentaire existant (la route fait `slice(0, 2000) || null`).
  // En saisie initiale on omet le champ quand il est vide — `undefined` n'est pas
  // sérialisé par JSON.stringify, donc la colonne n'est pas touchée.
  const commentField = (): Record<string, unknown> => {
    const c = a.comment.trim();
    if (a.isCorrection) return { lead_rapport_comment: c };
    return c ? { lead_rapport_comment: c } : {};
  };

  // `qualified` part TOUJOURS avec l'outcome, jamais seul. C'est ce qui fait
  // disparaître le bug d'origine par construction et non par discipline.
  const qualifiedField = (): Record<string, unknown> =>
    a.qualified === null ? {} : { qualified: a.qualified };

  // L'objection part avec son texte libre, et seulement quand elle est posée.
  // `objection_autre` est vidé dès que le choix n'est plus « autre » : sans ça,
  // corriger un rapport laisserait en base un texte qui ne correspond plus à
  // rien — invisible à l'écran, et faux dans toute lecture ultérieure.
  const objectionField = (): Record<string, unknown> => {
    if (!demandeObjection(a.outcomeChoice) || !a.objection) return {};
    const libre = (a.objectionAutre ?? '').trim();
    return {
      objection: a.objection,
      objection_autre: a.objection === 'autre' && libre ? libre.slice(0, 500) : null,
    };
  };

  // ── No-show : terminal dès la première question ──────────────────────────
  if (a.showedUp === false) {
    return {
      rapport: { no_show: true, deal_closed: false, revenue: 0, outcome: 'no_show' },
      callFields: {},
    };
  }

  // ── Appel reporté : atteignable directement depuis la première question ───
  if (a.outcomeChoice === 'rescheduled') {
    const callFields: Record<string, unknown> = {
      rescheduled: true,
      rescheduled_at: new Date().toISOString(),
    };
    // Date saisie à la main : on déplace le call. Sur les autres chemins
    // (« il va reréserver », « date inconnue ») le call garde sa date.
    if (a.reschedHow === 'manual' && scheduledAt) callFields.scheduled_at = scheduledAt;
    return { rapport: { outcome: 'rescheduled' }, callFields };
  }

  // ── Deal closé ───────────────────────────────────────────────────────────
  if (a.outcomeChoice === 'closed') {
    return {
      rapport: {
        no_show: false,
        deal_closed: true,
        // `revenue` reste écrit sur le call sans être la source du cash (c'est
        // `deals` que lisent les écrans) : il garde la trace du montant SAISI si
        // la création du deal échoue ensuite.
        revenue: parseAmount(a.revenue),
        outcome: 'closed',
        ...qualifiedField(),
        ...commentField(),
      },
      callFields: {},
    };
  }

  // ── 2ᵉ call prévu ────────────────────────────────────────────────────────
  if (a.outcomeChoice === 'second_call') {
    return {
      rapport: {
        outcome: 'second_call',
        no_show: false,
        deal_closed: false,
        revenue: 0,
        ...qualifiedField(),
        ...commentField(),
      },
      callFields: {},
    };
  }

  // ── Perdu ────────────────────────────────────────────────────────────────
  // Le prospect a dit non, et il n'y a pas de suite prévue. Distinct de « pas
  // qualifié » : perdre un prospect qui était la cible et écarter quelqu'un qui
  // ne l'était jamais ne se lisent pas dans le même chiffre.
  if (a.outcomeChoice === 'lost') {
    return {
      rapport: {
        outcome: 'lost',
        no_show: false,
        deal_closed: false,
        revenue: 0,
        ...qualifiedField(),
        ...objectionField(),
        ...commentField(),
      },
      callFields: {},
    };
  }

  // ── Pas qualifié ─────────────────────────────────────────────────────────
  // `qualified: false` part TOUJOURS avec cette issue, sans attendre la question
  // dédiée : choisir « pas qualifié » EST la réponse à « était-il la cible ? ».
  // C'est ce qui garde le « % Calls Qualifiés » juste sans le recalculer.
  if (a.outcomeChoice === 'not_qualified') {
    return {
      rapport: {
        outcome: 'not_qualified',
        no_show: false,
        deal_closed: false,
        revenue: 0,
        qualified: false,
        ...objectionField(),
        ...commentField(),
      },
      callFields: {},
    };
  }

  // ── À recontacter ────────────────────────────────────────────────────────
  // `relance_at` vit sur le call et non dans le rapport : c'est une échéance du
  // rendez-vous, pas une réponse à une question. Le COMPTEUR de relances, lui,
  // n'est écrit nulle part ici — il vit dans prospect_events.cycle.
  const callFields: Record<string, unknown> = {};
  if (a.relanceAt) callFields.relance_at = a.relanceAt;

  return {
    rapport: {
      outcome: 'to_recontact',
      no_show: false,
      deal_closed: false,
      revenue: 0,
      ...qualifiedField(),
      ...objectionField(),
      ...commentField(),
    },
    callFields,
  };
}

/** Le parcours est-il arrivé à un état soumettable ? */
export function isSubmittable(a: RapportAnswers): boolean {
  if (a.showedUp === false) return true;
  return a.outcomeChoice !== null;
}

/**
 * Nombre de questions RÉPONDUES, compté sur les réponses elles-mêmes et non sur le
 * chemin parcouru.
 *
 * C'est la différence qui compte : revenir en arrière n'efface pas la réponse
 * donnée, elle reste enregistrée dans le brouillon. Compter les étapes franchies
 * faisait reculer le compteur à chaque Retour, comme si la réponse avait été
 * perdue — alors qu'elle est toujours là et qu'on la voit cochée à l'écran.
 */
export function countAnswered(a: RapportAnswers): number {
  // Un no-show est terminal dès la première question : une seule réponse existe.
  if (a.showedUp === false) return 1;

  let n = 0;
  if (a.showedUp !== null) n++;
  if (a.qualified !== null) n++;
  if (a.outcomeChoice !== null) n++;
  // Montant et modalité de reprise de rendez-vous ne sont demandés que sur
  // certaines branches — ils ne comptent que là où ils sont posés.
  if (a.outcomeChoice === 'closed' && a.revenue !== '') n++;
  if (a.reschedHow !== null) n++;
  // Les modalités de paiement sont la DERNIÈRE question d'un deal closé, pas une
  // action d'après-coup : tant qu'elles ne sont pas choisies, le rapport n'est pas
  // terminé. `paymentDone` est posé par la modale à la création du deal.
  if (a.outcomeChoice === 'closed' && a.paymentDone === true) n++;
  // Chemin hors Stripe seulement : une question de plus, « l'argent est-il déjà
  // arrivé ? ». Elle n'existe pas sur un paiement par lien, d'où le total variable.
  if (a.outcomeChoice === 'closed' && a.offlineReceived != null) n++;
  // L'objection ne compte que là où elle est posée — perdu, pas qualifié, à
  // recontacter. Ailleurs, la question n'existe pas.
  if (demandeObjection(a.outcomeChoice) && a.objection != null) n++;
  // La date de relance : une question de plus, sur la seule branche qui la pose.
  if (a.outcomeChoice === 'to_recontact' && a.relanceAt) n++;
  return n;
}

/**
 * Progression affichée sur les cartes. Approximative par nature — l'utilisateur
 * peut encore changer de branche — et c'est voulu : un total figé à 17 pour un
 * no-show en 2 étapes serait mensonger.
 *
 * `Math.max` garantit répondues <= total, sans quoi changer de branche pour un
 * chemin plus court afficherait « 5/3 ».
 */
export function estimateTotal(a: RapportAnswers, answeredCount = countAnswered(a)): number {
  // Un no-show est complet dès la première réponse : rien ne reste à demander.
  if (a.showedUp === false) return 1;

  // Parcours complet : le total ÉGALE le compte, sinon on afficherait « 5/6 » sur
  // un rapport où plus rien n'est demandé.
  if (isSubmittable(a)) {
    if (a.outcomeChoice === 'closed' && a.paymentDone === true) return answeredCount;
    if (a.outcomeChoice !== 'closed' && a.outcomeChoice !== null) {
      // Les autres branches se terminent au commentaire, déjà passé ici.
      return Math.max(answeredCount, a.outcomeChoice === 'rescheduled' ? 3 : 4);
    }
  }

  // +1 : il reste au moins la question en cours à répondre.
  const minimum = answeredCount + 1;
  // Un deal closé compte 5 questions : présent, qualifié, résultat, montant,
  // modalités de paiement — et une 6ᵉ sur le chemin hors Stripe (« déjà
  // encaissé ? »), qui n'est pas posée sur un paiement par lien.
  if (a.outcomeChoice === 'closed') {
    return Math.max(minimum, a.offlineReceived != null ? 6 : 5);
  }
  if (a.outcomeChoice === 'rescheduled') return Math.max(minimum, 3);
  // Pas qualifié : la question « était-il la cible ? » ne se pose pas, l'issue y
  // répond. Présent, résultat, objection, commentaire.
  if (a.outcomeChoice === 'not_qualified') return Math.max(minimum, 4);
  // Perdu : présent, qualifié, résultat, objection, commentaire.
  if (a.outcomeChoice === 'lost') return Math.max(minimum, 5);
  // À recontacter : les cinq de « perdu », plus la date de relance.
  if (a.outcomeChoice === 'to_recontact') return Math.max(minimum, 6);
  return Math.max(minimum, 4);
}
