// ─────────────────────────────────────────────────────────────────────────────
// Détecter qu'une même personne occupe DEUX fiches du pipeline
//
// Le problème, en une phrase : quelqu'un qui a commenté un post a une fiche
// Instagram (`instagram_leads`) ; s'il réserve ensuite depuis une bio ou une
// description, il crée en plus une fiche e-mail (un `call` rattaché à un
// `prospects`). Rien ne relie les deux — `instagram_leads` n'a aucune colonne
// e-mail, et un pseudo n'a aucun champ commun avec une adresse.
//
// LE SEUL PONT est indirect : quand un lead Instagram réserve, son call porte à
// la fois `ig_lead_id` ET `invitee_email`. On apprend donc ses adresses par ses
// rendez-vous, jamais autrement.
//
// ⚠️ UN LEAD PEUT AVOIR PLUSIEURS ADRESSES. Vérifié en base : `incogniton.734`
// a réservé une fois avec `drgdrgdrg315@gmail.com`, une autre avec
// `jsjdj@mail.com`. « Un lead = un e-mail » est faux, et stocker « l'e-mail du
// lead » sur `instagram_leads` produirait un pont qui rate la moitié des cas.
// On collecte TOUTES ses adresses.
//
// Cette fonction ne décide rien : elle soupçonne. C'est l'élève qui tranche, et
// sa réponse est retenue (table `fusions_fiches`) pour ne jamais reposer une
// question déjà répondue.
// ─────────────────────────────────────────────────────────────────────────────

export interface LeadIg {
  id: string;
  ig_username: string;
}

export interface CallPourFusion {
  id: string;
  ig_lead_id: string | null;
  prospect_id: string | null;
  invitee_email: string | null;
  /** Le serveur filtre déjà, ceci est la ceinture — voir AGENTS.md. */
  ignored?: boolean | null;
  call_type?: string | null;
}

export interface ProspectPourFusion {
  id: string;
  name: string | null;
  email: string | null;
}

/** Une décision déjà prise sur une paire : fusionnée, ou refusée. */
export interface DecisionFusion {
  ig_lead_id: string;
  prospect_id: string;
  statut: 'fusionnee' | 'refusee';
}

export interface DoublonSoupconne {
  igLeadId: string;
  igUsername: string;
  prospectId: string;
  prospectNom: string;
  /** L'adresse qui a servi de pont — c'est elle qu'on montre à l'élève. */
  email: string;
  /** Les calls qui bougeraient si l'élève fusionne. */
  callIds: string[];
}

/** Une adresse se compare en minuscules, sans espaces autour. */
function normaliser(email: string | null | undefined): string | null {
  if (!email) return null;
  const e = email.trim().toLowerCase();
  return e.length > 0 ? e : null;
}

/**
 * Un call compte-t-il ? Règle projet : `ignored is not true` ET `call_type`
 * explicite. Sans ces deux conditions les chiffres sont faux — un call ignoré ou
 * un call de coaching n'a rien à voir avec le parcours de vente d'un prospect.
 */
function callRetenu(c: CallPourFusion): boolean {
  if (c.ignored === true) return false;
  if (c.call_type != null && c.call_type !== 'calendly') return false;
  return true;
}

/**
 * Les paires (lead Instagram, prospect) qui partagent une adresse et sur
 * lesquelles l'élève n'a pas encore tranché.
 *
 * Rend un tableau vide dans le cas normal : c'est un cas rare, pas la règle.
 */
export function detecterDoublons(input: {
  leads: readonly LeadIg[];
  calls: readonly CallPourFusion[];
  prospects: readonly ProspectPourFusion[];
  decisions?: readonly DecisionFusion[];
}): DoublonSoupconne[] {
  const { leads, calls, prospects } = input;

  // 1. Les adresses connues de chaque lead Instagram, apprises par ses calls.
  const emailsParLead = new Map<string, Set<string>>();
  for (const c of calls) {
    if (!c.ig_lead_id || !callRetenu(c)) continue;
    const email = normaliser(c.invitee_email);
    if (!email) continue;
    const s = emailsParLead.get(c.ig_lead_id) ?? new Set<string>();
    s.add(email);
    emailsParLead.set(c.ig_lead_id, s);
  }
  if (emailsParLead.size === 0) return [];

  // 2. Les calls de chaque prospect — ce sont eux qui bougeraient à la fusion.
  //    Seuls comptent ceux qui ne sont PAS déjà rattachés à un lead : un call
  //    déjà chez quelqu'un n'a pas à être déplacé, et le déplacer casserait sa
  //    fiche d'origine.
  const callsParProspect = new Map<string, string[]>();
  for (const c of calls) {
    if (!c.prospect_id || c.ig_lead_id || !callRetenu(c)) continue;
    const l = callsParProspect.get(c.prospect_id) ?? [];
    l.push(c.id);
    callsParProspect.set(c.prospect_id, l);
  }

  // 3. Les paires déjà tranchées, dans un sens ou dans l'autre.
  const tranchees = new Set(
    (input.decisions ?? []).map(d => `${d.ig_lead_id}|${d.prospect_id}`),
  );

  const doublons: DoublonSoupconne[] = [];
  for (const prospect of prospects) {
    const email = normaliser(prospect.email);
    if (!email) continue;

    for (const lead of leads) {
      const emails = emailsParLead.get(lead.id);
      if (!emails || !emails.has(email)) continue;
      if (tranchees.has(`${lead.id}|${prospect.id}`)) continue;

      const callIds = callsParProspect.get(prospect.id) ?? [];
      // Rien à déplacer : la fusion serait un geste sans effet. Ça arrive quand
      // les calls du prospect ont déjà été rattachés ailleurs.
      if (callIds.length === 0) continue;

      doublons.push({
        igLeadId: lead.id,
        igUsername: lead.ig_username,
        prospectId: prospect.id,
        prospectNom: prospect.name || 'Prospect',
        email,
        callIds,
      });
    }
  }

  return doublons;
}
