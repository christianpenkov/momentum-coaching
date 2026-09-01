/**
 * PARCOURS DES LEADS — la chaîne, comptée en PERSONNES, de bout en bout.
 *
 * Répond à une seule question : sur les personnes entrées par ce contenu (ou par ce
 * lead magnet), combien sont allées jusqu'au bout, et où les autres se sont arrêtées.
 *
 * ── UNE SEULE FONCTION, DEUX ANGLES ─────────────────────────────────────────
 *
 * La différence entre « par contenu » et « par lead magnet » est un **prédicat
 * d'appartenance**, et rien d'autre. Tout l'aval — personnes → liens → rendez-vous →
 * ventes — est identique. C'est ce qui garantit que les deux angles ne peuvent pas
 * diverger : il n'y a pas deux calculs à maintenir d'accord.
 *
 *   Contenu     : prise => prise.media_id === postId
 *   Lead magnet : prise => motsCles.has(prise.keyword_matched)
 *
 * ── POURQUOI DES PERSONNES, ET POURQUOI ÇA SUFFIT ───────────────────────────
 *
 * Chaque colonne est un sous-ensemble de la précédente, donc la chaîne ne peut jamais
 * remonter de gauche à droite. Une personne qui réserve deux fois compte 1.
 *
 * Conséquence assumée : ces nombres DIFFÈRENT de ceux de « Ce que fait chaque contenu »,
 * qui compte des événements. Les deux sont justes, ils répondent à deux questions. Le
 * point d'interrogation de chaque tableau doit renvoyer à l'autre.
 *
 * Seul `revenue` n'est pas un compte de personnes : c'est de l'argent, donc une somme.
 * Dédupliquée par rendez-vous, jamais par personne — un prospect qui achète deux fois a
 * payé deux fois.
 *
 * ── LA COHORTE EST DATÉE ────────────────────────────────────────────────────
 *
 * Une personne peut entrer plusieurs fois : elle prend le lead magnet A en janvier,
 * le B en juin. Elle appartient alors aux DEUX lignes, et ses rendez-vous doivent se
 * ranger dans la bonne : celle qui était ouverte **au moment où le rendez-vous a eu
 * lieu**. Sans cette règle, une vente de juin remonterait crédier la ligne de janvier.
 *
 * C'est la même forme que `contenuActivation` dans `lib/attribution-roles.ts` : la
 * dernière entrée AVANT l'événement. Écrite ici parce que la clé n'est pas la même
 * (un contenu là-bas, une ligne de tableau ici).
 */

/** Une prise de lead magnet, telle que `instagram_lead_lm_history` l'enregistre. */
export interface PriseParcours {
  /** La personne. Sans elle on ne peut ni dédupliquer ni suivre. */
  ig_user_id: string | null;
  /** Le contenu d'où vient la prise. */
  media_id: string | null;
  /** Le mot-clé détecté. */
  keyword_matched: string | null;
  /** Horodatage de la prise. Format Postgres ou ISO. */
  detected_at: string;
  /** Faux quand la demande a été vue mais le lead magnet jamais parti. */
  lead_magnet_sent?: boolean | null;
}

/** Un rendez-vous, réduit à ce dont la chaîne a besoin. */
export interface CallParcours {
  id: string;
  /** La personne, via sa fiche. */
  ig_lead_id: string | null;
  /** `active` compte, le reste non. */
  status?: string | null;
  /** Date à laquelle le rendez-vous a EU LIEU — c'est elle qui range dans la cohorte. */
  scheduled_at?: string | null;
  honore: boolean;
  closed: boolean;
  /** `null` quand le rapport n'a pas posé la question. */
  qualified?: boolean | null;
}

/** Ce que la chaîne sait des personnes, indépendamment de l'angle. */
export interface RefsParcours {
  /** `ig_user_id` → identifiant de fiche. Les fiches font le pont vers tout l'aval. */
  ficheParPersonne: Map<string, string>;
  /** Fiches ayant APPUYÉ sur le bouton du DM1 (`lm_link_requested`). */
  lmReclame: Set<string>;
  /** Fiches ayant cliqué leur lead magnet. */
  lmClique: Set<string>;
  /** Fiches ayant répondu au message d'accroche. */
  ontRepondu: Set<string>;
  /** Fiches à qui un lien Calendly a été envoyé. */
  calendlyEnvoye: Set<string>;
  /** Fiches ayant cliqué ce lien. */
  calendlyClique: Set<string>;
  /** Fiche → ses rendez-vous. */
  callsParFiche: Map<string, CallParcours[]>;
  /** Rendez-vous → montant contracté (`deals`, jamais `calls.revenue`). */
  montantParCall: Map<string, number>;
  /** Rendez-vous à écarter : un 2ᵉ ne crée pas d'opportunité. */
  continuations: ReadonlySet<string>;
}

/** Une ligne du tableau. Tout est en personnes, sauf `revenue`. */
export interface LigneParcours {
  commentairesLm: number;
  /**
   * HORS CHAÎNE, tous les deux. Appuyer sur le bouton du DM1 puis cliquer le lead
   * magnet ne sont pas obligatoires pour répondre au message d'accroche : quelqu'un peut
   * répondre sans avoir jamais appuyé. Les mettre dans la chaîne la ferait donc remonter
   * le jour où ça arrive — 1 clic et 2 réponses. Ils mesurent l'efficacité du message
   * automatique, pas la progression du prospect.
   */
  lmReclames: number;
  clicsLm: number;
  ontRepondu: number;
  calendlyEnvoyes: number;
  clicsCalendly: number;
  callsBookes: number;
  callsHonores: number;
  /** Numérateur et dénominateur séparés : un taux sans son effectif ment. */
  qualifies: { oui: number; renseignes: number };
  closes: number;
  revenue: number;
  /** Les personnes de la ligne, pour un éventuel détail au clic. */
  personnes: string[];
}

const LIGNE_VIDE: Omit<LigneParcours, 'personnes'> = {
  commentairesLm: 0, lmReclames: 0, clicsLm: 0, ontRepondu: 0, calendlyEnvoyes: 0, clicsCalendly: 0,
  callsBookes: 0, callsHonores: 0, qualifies: { oui: 0, renseignes: 0 }, closes: 0, revenue: 0,
};

/** Millisecondes d'un horodatage, ou `null` s'il est inexploitable. */
function ms(valeur: string | null | undefined): number | null {
  if (!valeur) return null;
  const t = Date.parse(valeur);
  return Number.isFinite(t) ? t : null;
}

/** Une entrée dans la chronologie d'une personne : quand, et vers quelle ligne. */
export interface EntreeDatee {
  t: number;
  cle: string | null;
  /** Faux quand l'entree est hors de la periode affichee : elle borne, elle n'ouvre pas. */
  dansPeriode?: boolean;
}

/**
 * À QUELLE LIGNE APPARTIENT CE RENDEZ-VOUS ?
 *
 * Celle de la **dernière entrée avant lui**. Rien d'autre.
 *
 * C'est la seule règle qui tienne quand une personne entre plusieurs fois, y compris
 * plusieurs fois par la même porte. Cas réel : `rdjdkzjd` prend LM le 28/06, GUIDE le
 * 05/07, LM de nouveau le 06/07, puis réserve le 08/07. Sa dernière entrée est LM, donc
 * c'est LM qui a produit ce rendez-vous — GUIDE l'a fait entrer entre-temps sans rien
 * produire, et ne doit pas récolter la vente.
 *
 * Deux renvois à `null`, tous deux volontaires :
 *
 * - **Aucune entrée avant le rendez-vous.** Il a précédé l'entrée, il n'en découle pas.
 * - **La dernière entrée n'appartient à aucune ligne de cet angle** (une story sans
 *   contenu, vue depuis l'angle Contenu). La personne est bien rentrée par là, mais cet
 *   angle ne sait pas le nommer — le créditer à la ligne d'avant serait inventer.
 *
 * `chronologie` doit être triée par `t` croissant.
 */
export function entreeDuCall(chronologie: EntreeDatee[], instantDuCall: number | null): EntreeDatee | null {
  if (instantDuCall === null) return null;
  let derniere: EntreeDatee | null = null;
  for (const e of chronologie) {
    if (e.t > instantDuCall) break;
    derniere = e;
  }
  return derniere;
}

/** La ligne seule, quand l'entree qui la porte n'a pas d'importance. */
export function ligneDuCall(chronologie: EntreeDatee[], instantDuCall: number | null): string | null {
  return entreeDuCall(chronologie, instantDuCall)?.cle ?? null;
}

/**
 * Construit une ligne par clé, à partir du journal et d'un prédicat d'appartenance.
 *
 * `cleDeLaPrise` rend la clé de ligne d'une prise (un `media_id`, un mot-clé…), ou
 * `null` si la prise n'appartient à aucune ligne de cet angle.
 */
export function parcoursDesLeads(
  journal: PriseParcours[],
  cleDeLaPrise: (prise: PriseParcours) => string | null,
  refs: RefsParcours,
  /**
   * Quelles entrées ouvrent une ligne — c'est ici que la PÉRIODE s'applique, et nulle
   * part ailleurs.
   *
   * ⚠️ Le journal reçu doit rester ENTIER, non filtré. La chronologie d'une personne se
   * construit sur toutes ses entrées, y compris hors période : sans elles, un rendez-vous
   * postérieur à une entrée de juin serait crédité à la ligne de mars simplement parce
   * que juin n'est pas affiché. Filtrer en amont produirait ce défaut sans qu'aucun
   * chiffre ne paraisse faux.
   */
  entreeDansLaPeriode: (prise: PriseParcours) => boolean = () => true,
): Map<string, LigneParcours> {
  // 1. LA CHRONOLOGIE DE CHAQUE PERSONNE — toutes ses entrées livrées, dans l'ordre,
  //    avec la ligne vers laquelle chacune pointe (`null` si cet angle ne sait pas la
  //    nommer). C'est elle qui décide à quelle ligne appartient chaque rendez-vous.
  //
  //    Construite sur le journal ENTIER, y compris les prises hors angle : une personne
  //    rentrée par une porte que ce tableau n'affiche pas est quand même rentrée, et le
  //    rendez-vous qui suit ne doit pas être crédité à la porte d'avant.
  const chronologies = new Map<string, EntreeDatee[]>();
  for (const prise of journal) {
    if (prise.lead_magnet_sent === false || !prise.ig_user_id) continue;
    const t = ms(prise.detected_at);
    if (t === null) continue;
    const entree: EntreeDatee = { t, cle: cleDeLaPrise(prise), dansPeriode: entreeDansLaPeriode(prise) };
    const liste = chronologies.get(prise.ig_user_id);
    if (liste) liste.push(entree); else chronologies.set(prise.ig_user_id, [entree]);
  }
  for (const liste of chronologies.values()) liste.sort((a, b) => a.t - b.t);

  // 2. QUI APPARTIENT À QUELLE LIGNE. Une personne entrée quatre fois par la même porte
  //    n'y compte qu'une : c'est toute la raison d'être de ce tableau.
  const personnesParCle = new Map<string, Set<string>>();
  for (const [personne, liste] of chronologies) {
    for (const { cle, dansPeriode } of liste) {
      // Hors periode : l'entree BORNE la chronologie mais n'ouvre aucune ligne.
      if (!cle || dansPeriode === false) continue;
      let set = personnesParCle.get(cle);
      if (!set) { set = new Set(); personnesParCle.set(cle, set); }
      set.add(personne);
    }
  }

  const lignes = new Map<string, LigneParcours>();
  for (const [cle, personnes] of personnesParCle) {
    const ligne: LigneParcours = { ...LIGNE_VIDE, qualifies: { oui: 0, renseignes: 0 }, personnes: [] };
    const callsDejaComptes = new Set<string>();

    for (const personne of personnes) {
      ligne.personnes.push(personne);
      ligne.commentairesLm += 1;

      const fiche = refs.ficheParPersonne.get(personne);
      if (!fiche) continue;

      if (refs.lmReclame.has(fiche)) ligne.lmReclames += 1;
      if (refs.lmClique.has(fiche)) ligne.clicsLm += 1;
      if (refs.ontRepondu.has(fiche)) ligne.ontRepondu += 1;
      if (refs.calendlyEnvoye.has(fiche)) ligne.calendlyEnvoyes += 1;
      if (refs.calendlyClique.has(fiche)) ligne.clicsCalendly += 1;

      // Les rendez-vous que cette ligne a réellement produits : ceux dont la dernière
      // entrée avant eux est la nôtre.
      const chronologie = chronologies.get(personne) ?? [];
      // ⚠️ On exige que l'entree PROPRIETAIRE soit dans la periode, pas seulement que sa
      // cle corresponde. Une personne rentree DEUX FOIS par la meme porte — en juin puis
      // en juillet — a deux cohortes portant la meme cle : son rendez-vous de juillet
      // appartient a la seconde, et la ligne de juin ne doit pas le recolter.
      const aMoi = (refs.callsParFiche.get(fiche) ?? []).filter(c => {
        const proprietaire = entreeDuCall(chronologie, ms(c.scheduled_at));
        return !!proprietaire && proprietaire.cle === cle && proprietaire.dansPeriode !== false;
      });

      const actifs = aMoi.filter(c => c.status === 'active');
      // Opportunités : un 2ᵉ rendez-vous n'en ouvre pas une nouvelle. Même règle que
      // partout ailleurs dans Mes stats.
      const opportunites = actifs.filter(c => !refs.continuations.has(c.id));
      if (opportunites.length > 0) ligne.callsBookes += 1;

      const honores = opportunites.filter(c => c.honore);
      if (honores.length > 0) ligne.callsHonores += 1;

      // `% qualifiés` n'est PAS un sous-ensemble de la colonne précédente : son
      // dénominateur ne compte que les personnes dont un rapport a répondu.
      const renseignes = honores.filter(c => c.qualified === true || c.qualified === false);
      if (renseignes.length > 0) {
        ligne.qualifies.renseignes += 1;
        if (renseignes.some(c => c.qualified === true)) ligne.qualifies.oui += 1;
      }

      // Une vente se compte là où elle a été signée, 2ᵉ rendez-vous compris — c'est
      // l'autre grain, assumé, comme dans « Performance par contenu ».
      if (actifs.some(c => c.closed)) ligne.closes += 1;

      for (const c of actifs) {
        if (callsDejaComptes.has(c.id)) continue;
        callsDejaComptes.add(c.id);
        ligne.revenue += refs.montantParCall.get(c.id) ?? 0;
      }
    }

    lignes.set(cle, ligne);
  }

  return lignes;
}
