// Source unique de l'état d'un lead dans le pipeline (décision produit, 2026-08-27).
//
// Remplace les trois cascades divergentes de PagePipeline.tsx (leads IG :1382,
// liens IG :1512, YouTube :1646) qui pouvaient donner trois résultats différents
// pour un même lead.
//
// ── LE MODÈLE : DEUX AXES ─────────────────────────────────────────────────────
//
// Un lead porte une ÉTAPE (où il en est) ET une ISSUE (ce qui a été décidé).
// Les mélanger sur un seul axe est ce qui produisait « 3 show up » affiché
// au-dessus de « 4 closés » — impossible dans un entonnoir.
//
//   ÉTAPES (progression, ordonnées)        ISSUES (résultat, non ordonnées)
//   ────────────────────────────────       ─────────────────────────────────
//   lm_sent       Commentaire LM           to_recontact   À recontacter
//   lm_received   Lead magnet reçu         no_show        No show
//   cold_dm       Cold DM                  not_qualified  Pas qualifié
//   in_convo      En conversation          lost           Perdu
//   calendly_sent Calendly envoyé          closed         Closé
//   link_clicked  Lien cliqué
//   call_booked   RDV pris
//
// Les clés d'étape sont celles déjà en base — `lm_sent` porte « Commentaire LM »
// malgré son nom, parce que `lead_magnet_sent` est posé au commentaire. La
// renommer casserait IG_PRE_CALL dans reset/route.ts et advance/route.ts pour
// zéro gain. `lm_received` est la seule clé nouvelle.
//
// `closed` est à la fois une ancienne clé d'étape et la nouvelle clé d'issue :
// les overrides `closed` existants deviennent donc des issues valides sans
// migration. `showed_up`, en revanche, n'existe plus — un override qui le porte
// est ignoré et le lead retombe sur son calcul naturel (comportement testé).
//
// ── D'OÙ VIENT L'ISSUE ────────────────────────────────────────────────────────
//
// Elle n'est JAMAIS écrite en base. La stocker demanderait d'écrire deux fois le
// même fait (dans `calls` et dans une colonne), et si une des deux écritures
// échoue, l'écran et les statistiques se contredisent sans que personne ne le
// voie. Mode de panne déjà rencontré trois fois sur ce projet.
//
//   calls (ignored is not true,          ┌──────────────────┐
//          call_type = 'calendly')  ──┐  │  issue du LEAD   │
//     outcome · no_show · deal_closed ├─►│  une seule       │
//                                     │  └──────────────────┘
//   pipeline_overrides.stage      ────┘
//     le classement à la main
//
//   1. Le call le plus récent non ignoré gagne (traduit par OUTCOME_TO_ISSUE)
//   2. Pas de call → le classement manuel
//   3. Ni l'un ni l'autre → le lead est ACTIF, étape seule
//
// ⚠️ Les 5 issues ne sont PAS les 5 outcomes. `rescheduled` et `second_call` ne
// sont pas des résultats — ce sont des rendez-vous qui n'ont pas encore donné le
// leur. Les traiter comme des issues créerait deux colonnes fantômes.

export type StageKey =
  | 'lm_sent'
  | 'lm_received'
  | 'cold_dm'
  | 'in_convo'
  | 'calendly_sent'
  | 'link_clicked'
  | 'call_booked';

export type IssueKey =
  | 'to_recontact'
  | 'no_show'
  | 'not_qualified'
  | 'lost'
  | 'closed';

/** Ordre de progression. L'index sert de plancher : un lead ne recule jamais tout seul. */
export const STAGE_ORDER: readonly StageKey[] = [
  'lm_sent',
  'lm_received',
  'cold_dm',
  'in_convo',
  'calendly_sent',
  'link_clicked',
  'call_booked',
] as const;

export const ISSUE_KEYS: readonly IssueKey[] = [
  'to_recontact',
  'no_show',
  'not_qualified',
  'lost',
  'closed',
] as const;

/**
 * Traduction d'un `calls.outcome` en issue.
 *
 * `null` = le call n'a PAS d'issue : le lead reste actif en « RDV pris ».
 * Vérifié en base le 2026-08-27 — `lib/rapportPatch.ts:15` déclare
 * `'closed' | 'second_call' | 'to_recontact' | 'rescheduled'`, plus `no_show`
 * posé séparément. `lost` et `not_qualified` sont ajoutés par ce chantier.
 */
export const OUTCOME_TO_ISSUE: Readonly<Record<string, IssueKey | null>> = {
  closed:        'closed',
  no_show:       'no_show',
  to_recontact:  'to_recontact',
  lost:          'lost',
  not_qualified: 'not_qualified',
  // Pas des résultats — le rendez-vous n'a pas encore donné le sien.
  rescheduled:   null,
  second_call:   null,
};

/** Une issue dont on ne revient jamais, quoi que le lead fasse ensuite. */
export const TERMINAL_ISSUES: readonly IssueKey[] = ['closed'] as const;

/** Nombre de relances au-delà duquel un lead sans réponse sort en Perdu. */
export const MAX_RELANCES = 3;
/** Délai après la dernière relance avant la sortie automatique. */
export const RELANCE_EXPIRY_DAYS = 21;

// ── Entrées ───────────────────────────────────────────────────────────────────

export interface StageCall {
  id: string;
  status: string;
  scheduled_at: string;
  outcome: string | null;
  no_show: boolean | null;
  /** Vrai quand ce call a été reprogrammé — le résultat viendra du suivant. */
  rescheduled?: boolean | null;
  /** Exclu de tout calcul quand vrai. Le serveur filtre déjà, ceci est la ceinture. */
  ignored?: boolean | null;
  lead_deleted?: boolean | null;
}

export interface StageSignals {
  /** Le lead a commenté un mot-clé de lead magnet. */
  hasComment?: boolean;
  /** Le lead a cliqué le bouton du DM1 pour recevoir le contenu (event lm_link_requested). */
  lmLinkRequested?: boolean;
  /** Détecté par Cold DM et non par un commentaire. */
  isColdDm?: boolean;
  /** Le lead a répondu en DM. */
  hasReplied?: boolean;
  /** Un lien Calendly lui a été envoyé, et l'envoi est postérieur à sa détection. */
  calendlySentValid?: boolean;
  /** Il a cliqué ce lien, et le clic est postérieur au dernier envoi. */
  linkClickedValid?: boolean;
  /** Plancher déjà atteint — une avance manuelle ou un signal auto passé. */
  minStageReached?: StageKey | null;
}

export interface StageInput {
  signals: StageSignals;
  /** Tous les calls rattachés à ce lead. Le plus récent programmé décide. */
  calls?: readonly StageCall[];
  /** `pipeline_overrides.stage` — le classement à la main, s'il existe. */
  manualIssue?: string | null;
  /** `pipeline_overrides.reason` — le motif saisi au classement. */
  manualReason?: string | null;
  /** Dates des relances, du plus ancien au plus récent (events `relance`). */
  relances?: readonly string[];
  /** Dernière réponse du lead — remet le compteur de relances à zéro. */
  lastReplyAt?: string | null;
  /** Retiré du pipeline : ne compte plus jamais, ne revient jamais. */
  notALead?: boolean;
}

export interface LeadState {
  stage: StageKey;
  status: 'active' | 'classed' | 'removed';
  issue: IssueKey | null;
  /** Pourquoi cette issue : le motif manuel, ou 'sans_reponse' pour une sortie auto. */
  issueReason: string | null;
  /** Le call qui a décidé de l'issue, quand elle vient d'un call. */
  decidedByCallId: string | null;
  flags: {
    /** Le RDV est passé et aucun rapport n'est rempli. */
    rapportEnRetard: boolean;
    /** Le lead est en relance et la prochaine est due. */
    relanceDue: boolean;
    /** Nombre de relances déjà faites dans le cycle en cours. */
    relancesFaites: number;
    /** Le cycle est arrivé au bout : le lead sort en Perdu « sans réponse ». */
    cycleEpuise: boolean;
  };
}

// ── Utilitaires ───────────────────────────────────────────────────────────────

function stageIndex(s: StageKey | null | undefined): number {
  return s ? STAGE_ORDER.indexOf(s) : -1;
}

function toTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

const JOUR_MS = 86_400_000;

/**
 * L'étape atteinte par les signaux automatiques, avant toute prise en compte
 * des calls. Chaque signal ne peut que faire avancer.
 */
export function resolveNaturalStage(signals: StageSignals): StageKey {
  let stage: StageKey = signals.isColdDm ? 'cold_dm' : 'lm_sent';
  if (signals.lmLinkRequested)   stage = 'lm_received';
  if (signals.isColdDm)          stage = 'cold_dm';
  if (signals.hasReplied)        stage = 'in_convo';
  if (signals.calendlySentValid) stage = 'calendly_sent';
  if (signals.linkClickedValid)  stage = 'link_clicked';

  // Le plancher : un signal automatique qui se re-déclenche (un nouveau
  // commentaire du même lead, par exemple) ne doit jamais faire reculer la
  // carte sous une étape déjà atteinte.
  const floor = stageIndex(signals.minStageReached);
  if (floor > stageIndex(stage)) return STAGE_ORDER[floor];
  return stage;
}

/**
 * Le call qui décide de l'issue.
 *
 * Un deal conclu l'emporte sur tout, même sur un rendez-vous plus récent : le
 * lead qui a signé puis manqué son call de suivi reste CLOSÉ — l'argent est
 * encaissé, un no-show postérieur ne l'annule pas. Cette règle vivait déjà dans
 * PagePipeline (« un deal conclu sur le 1er rendez-vous ne doit pas être perdu
 * parce que le dernier a été annulé ») et doit survivre à l'unification.
 *
 * Sinon, le plus récemment programmé. Un call reprogrammé ne décide jamais —
 * son remplaçant le fera.
 */
export function pickDecidingCall(calls: readonly StageCall[]): StageCall | null {
  const utiles = calls.filter(c =>
    !c.ignored && !c.lead_deleted && c.status === 'active' && !c.rescheduled,
  );
  if (utiles.length === 0) return null;

  const plusRecent = (a: StageCall, b: StageCall) =>
    (toTime(b.scheduled_at) ?? 0) > (toTime(a.scheduled_at) ?? 0) ? b : a;

  // Un deal conclu passe devant, quelle que soit sa date.
  const closes = utiles.filter(c => !c.no_show && OUTCOME_TO_ISSUE[c.outcome ?? ''] === 'closed');
  if (closes.length > 0) return closes.reduce(plusRecent);

  return utiles.reduce(plusRecent);
}

/**
 * Le compteur de relances du cycle en cours. Une réponse du lead remet à zéro :
 * les relances qui la précèdent appartiennent à un cycle terminé.
 */
export function countRelancesCycle(
  relances: readonly string[],
  lastReplyAt: string | null | undefined,
): { faites: number; derniere: number | null } {
  const reply = toTime(lastReplyAt);
  const apresReponse = relances
    .map(toTime)
    .filter((t): t is number => t !== null)
    .filter(t => reply === null || t > reply)
    .sort((a, b) => a - b);
  return {
    faites: apresReponse.length,
    derniere: apresReponse.length ? apresReponse[apresReponse.length - 1] : null,
  };
}

// ── La fonction ───────────────────────────────────────────────────────────────

export function resolveLeadState(input: StageInput, now: Date): LeadState {
  const maintenant = now.getTime();
  const stage = resolveNaturalStage(input.signals);

  const vide: LeadState['flags'] = {
    rapportEnRetard: false,
    relanceDue: false,
    relancesFaites: 0,
    cycleEpuise: false,
  };

  // « Ce n'est pas un lead » l'emporte sur tout et ne revient jamais.
  if (input.notALead) {
    return {
      stage, status: 'removed', issue: null, issueReason: null,
      decidedByCallId: null, flags: vide,
    };
  }

  const call = pickDecidingCall(input.calls ?? []);
  const passe = call ? (toTime(call.scheduled_at) ?? 0) < maintenant : false;

  // 1. Le call décide, quand il en a un à dire.
  if (call) {
    // `no_show` est posé à part de `outcome` par rapportPatch — on le lit d'abord.
    const outcome = call.no_show ? 'no_show' : call.outcome;
    const issue = outcome ? (OUTCOME_TO_ISSUE[outcome] ?? null) : null;

    if (issue) {
      // Une issue terminale fige tout : ni relance, ni retour.
      if (TERMINAL_ISSUES.includes(issue)) {
        return {
          stage: 'call_booked', status: 'classed', issue, issueReason: null,
          decidedByCallId: call.id, flags: vide,
        };
      }
      return {
        ...applyRelanceCycle(input, issue, maintenant),
        stage: 'call_booked',
        decidedByCallId: call.id,
      };
    }

    // Pas d'issue : `rescheduled`, `second_call`, ou aucun rapport. Le lead
    // reste ACTIF en « RDV pris ». La garde : si la date est passée sans
    // rapport, la ligne le dit — sinon un 2e call jamais booké resterait
    // éternellement en « RDV pris ».
    return {
      stage: 'call_booked', status: 'active', issue: null, issueReason: null,
      decidedByCallId: call.id,
      flags: { ...vide, rapportEnRetard: passe },
    };
  }

  // 2. Aucun call — le classement à la main, s'il existe.
  const manuelle = input.manualIssue as IssueKey | undefined;
  if (manuelle && ISSUE_KEYS.includes(manuelle)) {
    if (TERMINAL_ISSUES.includes(manuelle)) {
      return {
        stage, status: 'classed', issue: manuelle,
        issueReason: input.manualReason ?? null,
        decidedByCallId: null, flags: vide,
      };
    }
    return { ...applyRelanceCycle(input, manuelle, maintenant), stage, decidedByCallId: null };
  }

  // 3. Ni l'un ni l'autre : le lead est actif, il porte une étape et rien d'autre.
  return {
    stage, status: 'active', issue: null, issueReason: null,
    decidedByCallId: null, flags: vide,
  };
}

/**
 * Le cycle de relance, borné. Sans borne, le volume ne se stabilise jamais :
 * 5 leads classés par semaine relancés tous les mois donnent ~120 relances par
 * mois à deux ans.
 *
 * Trois relances sans réponse, puis sortie automatique en Perdu « sans
 * réponse ». Rien n'est écrit en base : la sortie est calculée, donc aucun cron
 * ne peut tomber en panne un dimanche sans que personne ne s'en aperçoive.
 *
 * Ne s'applique qu'à « À recontacter » — un lead Perdu ou Pas qualifié n'est
 * dans aucun cycle de relance.
 */
function applyRelanceCycle(
  input: StageInput,
  issue: IssueKey,
  maintenant: number,
): Omit<LeadState, 'stage' | 'decidedByCallId'> {
  const base = {
    status: 'classed' as const,
    issueReason: input.manualReason ?? null,
  };

  if (issue !== 'to_recontact') {
    return {
      ...base, issue,
      flags: { rapportEnRetard: false, relanceDue: false, relancesFaites: 0, cycleEpuise: false },
    };
  }

  const { faites, derniere } = countRelancesCycle(input.relances ?? [], input.lastReplyAt);
  const ageDerniere = derniere === null ? null : (maintenant - derniere) / JOUR_MS;
  const expiree = ageDerniere !== null && ageDerniere >= RELANCE_EXPIRY_DAYS;
  const cycleEpuise = faites >= MAX_RELANCES && expiree;

  if (cycleEpuise) {
    return {
      ...base,
      issue: 'lost',
      issueReason: 'sans_reponse',
      flags: { rapportEnRetard: false, relanceDue: false, relancesFaites: faites, cycleEpuise: true },
    };
  }

  return {
    ...base, issue: 'to_recontact',
    flags: {
      rapportEnRetard: false,
      // Une relance est due dès que la précédente a vieilli — ou dès le
      // classement, quand aucune n'a encore été faite.
      relanceDue: faites < MAX_RELANCES && (derniere === null || expiree),
      relancesFaites: faites,
      cycleEpuise: false,
    },
  };
}
