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

export type OutcomeChoice = 'closed' | 'second_call' | 'to_recontact' | 'rescheduled';

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
  /** Créneau détecté automatiquement par Calendly. */
  foundCall: { id: string; scheduledAt: string; inviteeName: string | null } | null;
  /** Mode correction d'un rapport déjà soumis — sert aussi à détecter un brouillon périmé. */
  isCorrection: boolean;
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
  foundCall: null,
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

  // ── À recontacter ────────────────────────────────────────────────────────
  return {
    rapport: {
      outcome: 'to_recontact',
      no_show: false,
      deal_closed: false,
      revenue: 0,
      ...qualifiedField(),
      ...commentField(),
    },
    callFields: {},
  };
}

/** Le parcours est-il arrivé à un état soumettable ? */
export function isSubmittable(a: RapportAnswers): boolean {
  if (a.showedUp === false) return true;
  return a.outcomeChoice !== null;
}

/**
 * Progression affichée sur les cartes. Approximative par nature — l'utilisateur
 * peut encore changer de branche — et c'est voulu : un total figé à 17 pour un
 * no-show en 2 étapes serait mensonger.
 *
 * `historyLength` = nombre de questions RÉPONDUES (les étapes franchies), et non
 * le rang de l'étape courante : afficher « 2/2 » alors qu'il reste une question
 * laisse croire que le rapport est terminé.
 *
 * `Math.max` garantit répondues <= total, sans quoi un retour arrière suivi d'un
 * chemin plus court afficherait « 5/3 ».
 */
export function estimateTotal(a: RapportAnswers, historyLength: number): number {
  // +1 : il reste au moins la question en cours à répondre.
  const minimum = historyLength + 1;
  if (a.showedUp === false) return minimum;
  if (a.outcomeChoice === 'closed') return Math.max(minimum, 5);
  if (a.outcomeChoice === 'rescheduled') return Math.max(minimum, 3);
  return Math.max(minimum, 4);
}
