// Calculs de vente partagés — calls bookés/honorés/closés, cash, comptage des leads.
//
// ⚠️ Les règles de PÉRIMÈTRE (quelle date de démarrage, quelle date de référence,
// personnes vs lignes, traitement des annulés, bornes de journée) sont communes à
// tous les écrans et documentées dans docs/perimetre-stats-referentiel.md.
// Neuf écarts entre écrans ont été corrigés le 2026-08-19, tous causés par une de
// ces règles appliquée ici mais pas là. À lire avant de modifier un compteur.
// Imports relatifs avec extension, et non l'alias `@/lib` : c'est ce qui rend ce
// module chargeable par `node --test` (meme convention que lib/callSeries.ts). Les
// imports de TYPE gardent l'alias, ils sont effaces a la compilation.
import { isCallHonored, calculerShowUp } from './callHonored.ts';
import { calculerCash } from './dealCash.ts';
import { CALL_TYPES_VENTE } from './callTypes.ts';
import { idsDeContinuation } from './callSeries.ts';
import type { Call } from '@/lib/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';
// Relatif avec extension, comme les autres imports de ce fichier : `node --test`
// (npm test) charge ce module sans bundler et ne connaît pas l'alias `@/`.
import { lireTout } from './supabase/lireTout.ts';

// Calls annulés exclus de tout calcul de funnel de vente (booking, show-up, closing).
// Même filtre que PageClientDetail.tsx (8 KPI all-time), extrait ici pour être
// réutilisé tel quel par tout calcul batch (liste clients) sans risque de divergence.
// Signature volontairement large : la regle ne lit QUE `status`. L'exiger sur un `Call`
// complet forcait les appelants qui ne selectionnent que quelques colonnes a passer par
// un `as any` — et un `as any` sur un filtre d'annulation ferait taire exactement
// l'erreur qu'on veut voir. Tout objet qui porte un statut suffit.
export function isNotCanceled(c: Pick<Call, 'status'> | { status?: string | null }): boolean {
  return !['cancelled', 'canceled', 'declined'].includes(c.status ?? '');
}

export interface SalesCallStats {
  /**
   * OPPORTUNITÉS bookées — pas rendez-vous posés.
   *
   * Un deuxième rendez-vous qui prolonge la même vente ne recompte pas. C'est le grain
   * du référentiel (docs/perimetre-stats-referentiel.md) et celui de « Mes stats ».
   */
  callsBookedCount: number;
  /** OPPORTUNITÉS honorées. Même dédup que `callsBookedCount`. */
  callsHonoredCount: number;
  /**
   * RENDEZ-VOUS posés — le grain AUTRE, celui du show-up et du no-show.
   *
   * Un créneau posé puis manqué est un créneau perdu, même s'il prolongeait une vente
   * déjà ouverte : le taux de présence mesure la fiabilité d'un créneau, pas ce que le
   * contenu a produit. Tout écran qui affiche un show-up doit ÉCRIRE ce dénominateur
   * (« 8 sur 10 rendez-vous »), sinon il se lit comme dérivé de `callsBookedCount`.
   */
  rendezVousCount: number;
  /** RENDEZ-VOUS honorés — numérateur du taux de présence. */
  rendezVousHonoredCount: number;
  /**
   * RENDEZ-VOUS à l'issue tranchée (honorés + manqués) — DÉNOMINATEUR du taux de
   * présence, et non `rendezVousCount` : voir `estRendezVousTranche`, un créneau encore
   * à venir n'est pas une absence.
   */
  rendezVousTranchesCount: number;
  dealsClosedCount: number;
  closingRate: number;
  cashContracted: number;
  /** Encaissé réel. null quand les deals n'ont pas été fournis (voir plus bas). */
  cashCollected: number | null;
}

/**
 * Un deal, tel que les calculs de cash en ont besoin.
 *
 * `deals` remplace `calls.revenue` comme source du cash : un deal porte sa devise,
 * sa date de signature, son échéancier, et surtout il peut exister SANS call —
 * upsell, vente hors pipeline. Sommer `calls.revenue` rendrait ces deals invisibles.
 */
export interface DealForStats {
  amount_total: number | string;
  status?: string | null;
  collected?: number;
  /**
   * Le rendez-vous qui a produit cette vente. OPTIONNEL, et son absence a un sens
   * précis : sans lui, `closingRate` ne peut pas savoir quelle vente appartient à
   * quel appel, donc il compte comme avant le 2026-09-12. Un appelant qui affiche
   * un taux de closing doit le fournir ; un deal d'upsell n'en a légitimement pas.
   */
  call_id?: string | null;
}

/**
 * Une vente annulée, au sens de la colonne `deals.status`.
 *
 * ⚠️ Écrite UNE fois et partagée, parce que la même question se pose à deux endroits
 * (le cash contracté et le taux de closing) et que deux copies divergeraient au
 * premier statut ajouté par Stripe — le défaut que ce dépôt corrige partout ailleurs.
 * Les trois écrivains de cette valeur sont `declare-refund`, `calls/[id]/rapport` et
 * `lib/dealStatus.ts` : tous posent `'canceled'`.
 */
function estVenteAnnulee(d: DealForStats): boolean {
  return d.status === 'canceled';
}

/**
 * Les appels dont TOUTES les ventes ont été annulées — ceux qui ne comptent plus
 * comme des closings.
 *
 * ⚠️ Exportée, et c'est le point : « Mes stats » (PageClientStats) calcule son
 * propre taux de closing à partir des mêmes deals, avec son propre découpage par
 * opportunité. Deux copies de cette règle afficheraient deux taux différents pour
 * le même élève dès la première vente annulée — le défaut exact que
 * `npm run verifier-regles-uniques` existe pour empêcher.
 *
 * Trois précautions, chacune contre un faux négatif :
 *   • un appel sans AUCUN deal n'est PAS dans l'ensemble : un rapport interrompu
 *     avant la création de la vente n'a que `deal_closed` comme trace, et le
 *     retirer effacerait un closing réel (même repli que le garde de
 *     `client/pipeline`) ;
 *   • un appel qui porte une vente annulée ET une vente vivante n'y est pas non plus ;
 *   • un deal sans `call_id` (upsell) ne peut disqualifier aucun appel.
 */
export function callsAVenteEntierementAnnulee(deals?: DealForStats[]): Set<string> {
  const parCall = new Map<string, { vivantes: number; annulees: number }>();
  for (const d of deals ?? []) {
    if (!d.call_id) continue;
    const e = parCall.get(d.call_id) ?? { vivantes: 0, annulees: 0 };
    if (estVenteAnnulee(d)) e.annulees++; else e.vivantes++;
    parCall.set(d.call_id, e);
  }
  const annules = new Set<string>();
  for (const [callId, e] of parCall) {
    if (e.annulees > 0 && e.vivantes === 0) annules.add(callId);
  }
  return annules;
}

/**
 * Cash contracté et collecté à partir des deals.
 *
 * Les deals annulés sont exclus du contracté : une vente annulée n'a pas été
 * signée. En revanche ce qui a déjà été encaissé dessus reste compté — l'argent
 * est bien entré.
 *
 * ⚠️ Ce commentaire affirmait qu'« un remboursement passe par un `deal_payments`
 * négatif ». C'est FAUX, et c'est ce qui a fait vivre le défaut : un remboursement
 * est une ligne de statut `refunded` portant un montant POSITIF, vérifié en base le
 * 2026-08-30. Le `collected` fourni ici doit donc être un NET calculé par
 * `calculerCash`, jamais une somme de montants — voir fetchDealsForStats.
 */
function computeDealTotals(deals: DealForStats[]): { contracted: number; collected: number } {
  const active = deals.filter(d => !estVenteAnnulee(d));
  return {
    contracted: active.reduce((s, d) => s + Number(d.amount_total || 0), 0),
    collected: deals.reduce((s, d) => s + Number(d.collected || 0), 0),
  };
}

/**
 * closingRate = deals closés / calls HONORÉS (pas / calls bookés). Voir
 * docs/calls-coach-id-piege.md pour le filtre coach_id à appliquer en amont.
 *
 * ⚠️ **Deux grains cohabitent ici, et c'est voulu.** Bookés / honorés / closing comptent
 * des OPPORTUNITÉS : un deuxième rendez-vous qui prolonge la même vente ne recompte pas.
 * Le show-up, lui, compte des RENDEZ-VOUS (`rendezVousCount`) — voir l'interface. Ne pas
 * « harmoniser » les deux : c'est la même décision qu'en Vue générale de « Mes stats »
 * (PageClientStats.tsx, calcul des métriques business).
 *
 * Jusqu'au 2026-09-12 cette fonction ne connaissait que le grain rendez-vous, alors que
 * « Mes stats » comptait des opportunités : le MÊME libellé « Calls bookés » affichait
 * deux nombres différents pour le même élève.
 *
 * @param callsPourAppariement Le jeu COMPLET des calls du même propriétaire, quand
 *   `calls` est déjà découpé par période. Sans lui, une paire à cheval sur deux fenêtres
 *   est invisible depuis la fenêtre et le 2e rendez-vous recompte comme une opportunité
 *   neuve. Même raison qu'en Vue générale, qui apparie sur `callsAllTime`. À omettre
 *   quand `calls` est déjà le jeu complet (fiche client, all-time).
 */
export function computeSalesCallStats(
  calls: Call[],
  now: Date,
  deals?: DealForStats[],
  callsPourAppariement?: Call[],
): SalesCallStats {
  const salesCalls = calls.filter(isNotCanceled);

  // L'appariement se fait sur le jeu complet, mais l'ANNULÉ n'ouvre pas d'opportunité :
  // le même filtre des deux côtés, sinon un rendez-vous annulé pourrait servir de tête
  // de chaîne et écarter à tort le suivant.
  const continuations = idsDeContinuation((callsPourAppariement ?? calls).filter(isNotCanceled));
  const estOpportunite = (c: Call) => !continuations.has(c.id);

  const estHonore = (c: Call) =>
    !!c.status && !!c.scheduled_at
    && isCallHonored({ ...c, status: c.status, scheduled_at: c.scheduled_at }, now);

  // Un call sans statut ni date n'a pas de créneau : il ne peut ni être honoré ni être
  // manqué. Le retirer ici, et non dans `calculerShowUp`, garde la règle partagée
  // exempte des trous propres au schéma de `calls`.
  const creneaux = salesCalls
    .filter((c): c is Call & { status: string; scheduled_at: string } => !!c.status && !!c.scheduled_at);

  const callsBookedCount = salesCalls.filter(c => c.status === 'active' && estOpportunite(c)).length;
  const callsHonoredCount = salesCalls.filter(c => estHonore(c) && estOpportunite(c)).length;
  const rendezVousCount = salesCalls.filter(c => c.status === 'active').length;
  const showUp = calculerShowUp(creneaux, now);
  const rendezVousHonoredCount = showUp.honores;
  const rendezVousTranchesCount = showUp.tranches;

  // Le numérateur compte des VENTES, pas des rendez-vous : un deal signé au 2e
  // rendez-vous reste compté, même si ce rendez-vous est écarté du dénominateur. C'est
  // exactement ce que fait la Vue générale, et c'est ce qui rend le taux lisible — 1
  // opportunité honorée, 1 vente, 100 %.
  //
  // ⚠️ Une vente ANNULÉE n'est plus un closing — décision produit de Chris du
  // 2026-09-12. AGENTS.md portait la question ouverte depuis le 2026-09-09 (« une
  // vente annulée est-elle un closing ? ») et le comportement d'alors répondait
  // « oui » par défaut, faute d'arbitrage.
  //
  // ⚠️ `calls.deal_closed` reste VRAI, et c'est délibéré : le drapeau dit qu'une
  // vente a été déclarée pendant l'appel, `deals` dit ce qu'elle est devenue. C'est
  // la règle de `payments/deals/[id]/cancel` — on ne la défait pas ici, on cesse
  // seulement de compter cet appel au numérateur du taux.
  //
  // Trois précautions, chacune contre un faux négatif :
  //   • un appel sans AUCUN deal continue de compter (rapport interrompu avant la
  //     création de la vente : le drapeau est alors la seule trace, même repli que
  //     le garde de `client/pipeline`) ;
  //   • un appel qui porte une vente annulée ET une vente vivante compte encore ;
  //   • un deal sans `call_id` (upsell) ne peut disqualifier aucun appel.
  const venteAnnulee = callsAVenteEntierementAnnulee(deals);

  const dealsClosedCount = salesCalls.filter(
    c => c.deal_closed && !venteAnnulee.has(c.id),
  ).length;
  const closingRate = callsHonoredCount > 0 ? Math.round((dealsClosedCount / callsHonoredCount) * 100) : 0;

  // Source du cash : la table `deals` quand elle est fournie, sinon `calls.revenue`.
  //
  // Le repli n'est pas de la compatibilité paresseuse : certains appelants n'ont
  // qu'une liste de calls sous la main (batch sur plusieurs élèves) et charger les
  // deals leur coûterait une requête de plus. Tant que tout deal naît d'un call,
  // les deux sommes sont égales — vérifié en base le 19/08/2026, 8 700 € des deux
  // côtés. Elles divergeront dès le premier deal créé hors call (upsell, vente
  // directe) : c'est précisément pour ça que `deals` doit devenir la source.
  if (deals) {
    const totals = computeDealTotals(deals);
    return {
      callsBookedCount, callsHonoredCount, rendezVousCount, rendezVousHonoredCount, rendezVousTranchesCount,
      dealsClosedCount, closingRate,
      cashContracted: totals.contracted,
      cashCollected: totals.collected,
    };
  }

  const cashContracted = salesCalls.reduce((s, c) => s + (c.revenue || 0), 0);
  return {
    callsBookedCount, callsHonoredCount, rendezVousCount, rendezVousHonoredCount, rendezVousTranchesCount,
    dealsClosedCount, closingRate,
    cashContracted,
    cashCollected: null,   // inconnu sans les deals — surtout pas 0, qui se lirait « rien encaissé »
  };
}

/**
 * Charge les deals d'un profil avec leur cash encaissé.
 *
 * Une seule requête, jointure incluse : appelée par écran, pas par deal.
 */
export async function fetchDealsForStats(
  supabase: SupabaseClient,
  profileId: string,
): Promise<DealForStats[]> {
  const { data } = await supabase
    .from('deals')
    .select('amount_total, status, call_id, deal_payments(amount, status)')
    .eq('profile_id', profileId);

  return (data ?? []).map((d: any) => ({
    amount_total: d.amount_total,
    status: d.status,
    // Sans lui, `closingRate` ne peut pas retirer un appel dont la vente a été
    // annulée : il compterait comme avant. Voir `DealForStats.call_id`.
    call_id: d.call_id ?? null,
    // `calculerCash().net` et non une somme des `succeeded` : encaissé − remboursé
    // − contesté, la règle partagée de lib/dealCash.ts. Ce filtre affichait
    // 2 800 € sur la fiche d'un élève qui en avait 2 600 en caisse — 200 € rendus
    // que l'écran comptait encore (mesuré le 2026-08-30).
    collected: calculerCash(d.deal_payments ?? []).net,
  }));
}

// Leads IG totaux — voir docs/pipeline-leads-ig-sources.md pour l'explication
// complète. 3 sources cumulées, pas juste instagram_leads : (1) leads détectés
// automatiquement, (2) prospect_links dédupliqués par ig_username avec (1), (3)
// calls IG directs sans lead (clic bio/description sans jamais avoir commenté).
// Extrait de PageClientDetail.tsx (coach) pour être réutilisé tel quel côté
// élève (useClientSelfData) — même formule, même compte des deux côtés.

/* ─── La règle, une seule fois ────────────────────────────────────────────────
 *
 * Le comptage lui-même est PUR : quatre listes de lignes déjà lues, et une réponse.
 * Il est extrait ici pour que la version « un élève » et la version « quarante élèves »
 * appellent exactement le même code. Les recopier aurait créé une SECONDE définition
 * de « lead » — la chose que ce fichier existe précisément pour empêcher, et qui est
 * déjà arrivée (Mes Stats oubliait YouTube).
 */

export interface LigneCallLead {
  id: string;
  invitee_email: string | null;
  invitee_name: string | null;
  booked_at?: string | null;
  scheduled_at?: string | null;
}

export interface LignesLeads {
  /** `instagram_leads` — leads détectés automatiquement.
   *
   *  ⚠️ PLUSIEURS lignes par personne : chaque reprise de lead magnet, réponse de story
   *  ou cold DM en crée une nouvelle. `ig_username` est donc la clé de la PERSONNE, pas
   *  de la ligne — c'est ce qui rend l'agrégation ci-dessous nécessaire.
   *
   *  `source` et `hook_replied_at` sont OPTIONNELS : un appelant qui ne les fournit pas
   *  obtient exactement le comportement d'avant le 2026-09-07. Ils ne servent qu'à la
   *  règle du cold DM (voir `personnesDemarcheesSansReponse`). */
  leads: {
    ig_username: string | null;
    detected_at: string | null;
    source?: string | null;
    hook_replied_at?: string | null;
  }[];
  /** `prospect_links` — dédupliqués par `ig_username` avec les précédents. */
  liens: { ig_username: string | null; created_at: string | null }[];
  /** Calls IG directs sans lead : clic bio/description sans jamais avoir commenté.
   *  `booked_at` / `scheduled_at` sont là pour que l'appelant puisse les répartir par
   *  fenêtre — `compterLeads` ne les filtre PAS lui-même. */
  callsIgDirects: LigneCallLead[];
  /** Calls venus de YouTube. Vide quand on ne compte que le volet Instagram. */
  callsYoutube: LigneCallLead[];
}

/**
 * Une personne compte UNE fois, quelle que soit sa source et son nombre de calls.
 *
 * Exportée parce que l'entonnoir de « Gérer mes liens » compte lui aussi des
 * personnes à partir de `calls`, et qu'une seconde définition du même
 * dédoublonnage diverge toujours : c'est précisément ce défaut qui affichait
 * 18 leads là où le pipeline en montrait 17 le 2026-08-19.
 */
export function clefPersonne(c: LigneCallLead): string {
  return (c.invitee_email || c.invitee_name || c.id).toLowerCase();
}

/**
 * La date à laquelle une fiche `instagram_leads` fait de quelqu'un un LEAD.
 *
 * Pour presque toutes les sources, c'est `detected_at` : la personne s'est manifestée
 * (elle a commenté un mot-clé), et cette date est gelée en base par le déclencheur
 * `figer_detected_at` depuis le 2026-09-03 — c'est bien sa PREMIÈRE détection.
 *
 * ⚠️ Le cold DM est l'exception, et c'est une règle produit : *« un cold DM, c'est pas
 * un lead tant qu'il n'a pas répondu »* (Chris, 2026-09-07). Là, `detected_at` est la
 * date où NOUS l'avons démarchée — elle ne dit rien d'elle. Ce qui la fait entrer, c'est
 * sa réponse. Tant qu'il n'y en a pas, cette fiche ne vaut pas lead : on rend `null`.
 *
 * Sans cette règle, le compteur était pilotable par l'élève : démarcher cinquante
 * dormants créait cinquante « leads » sans qu'aucun n'ait répondu. Et c'était l'inverse
 * du réel — mesuré le 2026-09-07, le seul cold DM compté était le seul à n'avoir jamais
 * répondu, les deux qui avaient répondu étant écartés à la main.
 */
function dateDeLead(r: LignesLeads['leads'][number]): string | null {
  if (r.source === 'cold_dm') return r.hook_replied_at ?? null;
  return r.detected_at;
}

/**
 * La PREMIÈRE APPARITION de chaque personne connue par son pseudo Instagram.
 *
 * Une seule définition, partagée par les deux compteurs : `compterLeads` (combien de
 * personnes sont apparues dans la fenêtre) et `compterLeadsActifs` (qui, en plus, compte
 * les retours). Deux implémentations du même dédoublonnage divergent toujours — c'est
 * précisément ce défaut qui affichait 18 leads là où le pipeline en montrait 17.
 *
 * ⚠️ La date retenue est la PLUS ANCIENNE, toutes sources confondues, et le filtre de
 * fenêtre s'applique APRÈS. Filtrer chaque source avant de dédupliquer recompterait
 * comme « nouveau ce mois » un prospect vu en juillet dans `instagram_leads` et revu en
 * août dans `prospect_links` — un lien est recréé à chaque envoi.
 */
export function premieresApparitions(
  leads: LignesLeads['leads'],
  liens: LignesLeads['liens'],
): Map<string, string> {
  // ── État du cold DM, agrégé par PERSONNE et jamais par ligne ───────────────
  //
  // `instagram_leads` porte plusieurs fiches pour la même personne : chaque reprise de
  // lead magnet, réponse de story ou cold DM en crée une. Sa réponse peut donc être
  // portée par une AUTRE fiche que celle qu'on lit — juger ligne par ligne écarterait
  // quelqu'un qui a bel et bien répondu.
  //
  // ⚠️ Rétro-compatible par construction : un appelant qui ne fournit pas `source` laisse
  // `tousDemarches` à faux dès la première fiche, donc n'exclut personne. Le comportement
  // d'avant le 2026-09-07 est conservé à l'octet près pour qui ne passe pas ces colonnes.
  const etatCold = new Map<string, { tousDemarches: boolean; aRepondu: boolean }>();
  for (const r of leads) {
    if (!r.ig_username) continue;
    const cle = r.ig_username.toLowerCase();
    const etat = etatCold.get(cle) ?? { tousDemarches: true, aRepondu: false };
    if (r.source !== 'cold_dm') etat.tousDemarches = false;
    if (r.hook_replied_at) etat.aRepondu = true;
    etatCold.set(cle, etat);
  }

  const plusAncienne = new Map<string, string>();
  for (const r of leads) {
    const date = dateDeLead(r);
    if (!r.ig_username || !date) continue;
    const cle = r.ig_username.toLowerCase();
    const prec = plusAncienne.get(cle);
    if (!prec || date < prec) plusAncienne.set(cle, date);
  }

  // ⚠️ Un lien ne doit pas RESSUSCITER un démarché sans réponse.
  //
  // `prospect_links` continue d'entrer une personne par lui-même — c'est la règle
  // d'origine, et elle ne change pas. Une seule exception, sans quoi la règle du cold DM
  // fuirait par la fenêtre : quelqu'un dont TOUTES les fiches sont des cold DM sans
  // réponse redeviendrait un lead au seul motif qu'on lui a envoyé un Calendly,
  // c'est-à-dire encore une action de notre côté.
  const demarchesSansReponse = new Set<string>();
  for (const [cle, etat] of etatCold) if (etat.tousDemarches && !etat.aRepondu) demarchesSansReponse.add(cle);

  for (const r of liens) {
    if (!r.ig_username || !r.created_at) continue;
    const cle = r.ig_username.toLowerCase();
    if (demarchesSansReponse.has(cle)) continue;
    const prec = plusAncienne.get(cle);
    if (!prec || r.created_at < prec) plusAncienne.set(cle, r.created_at);
  }

  return plusAncienne;
}

/** `since` seul répond à « combien depuis telle date ». `jusqua` ferme la fenêtre et
 *  répond à « combien DANS cette fenêtre » — ce dont le graphe a besoin, un point par
 *  fenêtre. Le filtre porte toujours sur la date la plus ancienne connue, après
 *  déduplication : c'est la même règle, juste bornée des deux côtés.
 *
 *  ⚠️ Les calls ne sont PAS filtrés ici : leur fenêtre est appliquée par la requête,
 *  sur `booked_at`. Pour une répartition par fenêtre, l'appelant doit donc leur passer
 *  des lignes déjà découpées. */
export function compterLeads(l: LignesLeads, since: string | null, jusqua?: string | null): number {
  // Date la plus ancienne connue par username, toutes sources confondues.
  //
  // ⚠️ Le filtre `since` s'applique APRÈS la déduplication, sur la date la plus
  // ancienne — jamais source par source avant. Un même prospect peut apparaître dans
  // instagram_leads en juillet et dans prospect_links en août (un lien est recréé à
  // chaque envoi) : filtrer chaque source séparément le recomptait comme « nouveau ce
  // mois » alors qu'il était déjà ancien.
  const dates = Array.from(premieresApparitions(l.leads, l.liens).values());
  const parUsername = (since || jusqua)
    ? dates.filter(d => (!since || d >= since) && (!jusqua || d <= jusqua)).length
    : dates.length;

  // Dédoublonné par personne, pas par call : Calendly crée un NOUVEL événement à chaque
  // reprogrammation, donc un prospect qui déplace son rendez-vous a deux lignes dans
  // `calls`. Les compter séparément affichait 18 leads là où le pipeline en montrait 17
  // (constaté le 2026-08-19).
  const igDirects = new Set(l.callsIgDirects.map(clefPersonne)).size;

  // Les calls YouTube ANNULÉS sont comptés : un prospect qui annule reste un prospect.
  // Ce qu'une annulation retire, c'est un call BOOKÉ — pas un lead. Avant le
  // 2026-08-19, ce volet excluait les annulés là où le volet Instagram les gardait :
  // deux plateformes, deux règles, dans la même fonction.
  const youtube = new Set(l.callsYoutube.map(clefPersonne)).size;

  return parUsername + igDirects + youtube;
}

/* ─── Les SIX lecteurs de cette règle ─────────────────────────────────────────
 *
 * ⚠️ Ce bloc a annoncé « les trois lecteurs » jusqu'au 2026-09-07. Il y en a six, et
 * l'inventaire compte : `requetesLeads` est partagée, donc y ajouter une REQUÊTE (et
 * pas seulement une colonne) se paie sur chacun d'eux.
 *
 *   1. `fetchIgLeadsCount`      → dashboard coach (×2 : all-time et ce mois)
 *   2. `fetchAllLeadsCount`     → accueil élève (×2) et fiche client coach
 *   3. `fetchLeadsCountsBatch`  → aucun appelant vivant hors tests
 *   4. `PageClientStats`        → carte « Leads » de la Vue générale
 *   5. `PageStatsClients`       → bandeau, colonne du tableau, export CSV
 *   6. `PageStatsClients`       → un point par fenêtre du graphe
 *
 * ⚠️ Le plus coûteux est le 2 : `useCoachData` appelle `fetchAllLeadsCount` EN BOUCLE,
 * une fois par élève. Une requête ajoutée ici coûte donc +2 requêtes PAR ÉLÈVE sur
 * l'accueil coach — à 40 élèves, c'est 80 requêtes par affichage. Tout besoin de
 * lecture supplémentaire doit vivre chez l'appelant qui en a besoin, jamais ici.
 *
 * La forme de ces quatre lectures est figée par des tests de caractérisation
 * (`salesCallStats.test.ts`) : elles ne peuvent plus changer par effet de bord. */

function requetesLeads(supabase: SupabaseClient, profileIds: string[], since: string | null) {
  // `archived_at` : sans lui, un prospect dont le lead a été archivé (bascule vers un
  // autre compte Instagram) resterait compté alors que le pipeline ne le montre plus.
  // Volontairement PAS de filtre sur `deleted_at` : un lien supprimé depuis « Gérer mes
  // liens » doit rester dans les stats, sinon le prospect sort du dénominateur du taux
  // d'activation (voir app/api/client/prospect-links/route.ts:127).
  // Des FABRIQUES (`() => …`), lues par `lireTout` chez les appelants : ces quatre
  // lectures portent sur PLUSIEURS élèves à la fois (page coach, stats clients) et
  // dépassent 1 000 lignes bien avant 40 élèves — PostgREST tronquait sans erreur,
  // et le comptage de leads / le CA sous-comptaient en silence (balayage du
  // 2026-09-05). Tri sur `id` pour des pages déterministes.
  // `source` et `hook_replied_at` servent la règle du cold DM (voir `dateDeLead`) :
  // une personne démarchée n'est un lead qu'à partir de sa réponse.
  //
  // ⚠️ Deux COLONNES, jamais une requête de plus. La question « a-t-elle répondu ? »
  // pouvait aussi se lire dans le journal `prospect_events`, plus durable — mais ce
  // journal n'est chargé que par Mes Stats, donc l'ajouter ici coûterait +1 requête sur
  // Stats Clients et +2 PAR ÉLÈVE sur l'accueil coach, qui appelle en boucle.
  //
  // Vérifié en base le 2026-09-07 : au niveau PERSONNE, l'horodatage des fiches et le
  // journal désignent exactement les six mêmes gens, zéro divergence. Et l'horodatage a
  // une propriété que le journal n'a pas : il suit le « reset » manuel du pipeline. Un
  // prospect qu'on remet en arrière redevient cohéremment « pas encore répondu », là où
  // le journal, immuable, continuerait de le compter.
  const leads = () => supabase.from('instagram_leads')
    .select('id, profile_id, ig_username, detected_at, source, hook_replied_at')
    .in('profile_id', profileIds).is('archived_at', null).eq('not_a_lead', false)
    .order('id', { ascending: true });

  const liens = () => supabase.from('prospect_links')
    .select('profile_id, ig_username, created_at')
    .in('profile_id', profileIds).is('archived_at', null)
    .order('id', { ascending: true });

  // ⚠️ `calls.coach_id` est le profile_id de l'ÉLÈVE, pas le coach humain
  // (docs/calls-coach-id-piege.md). `.neq('ignored', true)` est indispensable : sans
  // lui, ce compteur inclut les calls « supprimés » depuis le pipeline. Filtre sur
  // `booked_at` (réservation réelle) avec repli `scheduled_at` — un call réservé avant
  // `since` n'a pas pu être généré par le pipeline même si son rendez-vous tombe après.
  //
  // `like('source', 'ig\\_%')` : un préfixe, pas une liste fermée. `ig_story` manquait,
  // donc un rendez-vous venu d'une story n'était compté nulle part (corrigé aux trois
  // endroits le 2026-08-19). L'underscore est un joker SQL, d'où l'échappement.
  const callsIg = () => {
    let q = supabase.from('calls')
      .select('coach_id, id, invitee_email, invitee_name, booked_at, scheduled_at')
      .in('coach_id', profileIds)
      .in('call_type', CALL_TYPES_VENTE)
      .neq('ignored', true)
      .is('ig_lead_id', null)
      .neq('lead_deleted', true)
      .like('source', 'ig\\_%')
      .order('id', { ascending: true });
    if (since) q = q.or(`booked_at.gte.${since},and(booked_at.is.null,scheduled_at.gte.${since})`);
    return q;
  };

  // ⚠️ `is('ig_lead_id', null)` est une DÉDUPLICATION, pas une attribution.
  //
  // La règle du 2026-08-29 dit que l'attribution d'un rendez-vous se lit sur
  // `calls.source`, jamais sur `ig_lead_id`. Elle reste vraie. La question posée ici
  // n'est pas « d'où vient ce rendez-vous » mais « cette personne est-elle déjà comptée
  // ailleurs » — et `ig_lead_id` répond précisément à celle-là : il dit CHEZ QUI le call
  // est rangé. Ne pas ranger ce filtre parmi les lecteurs d'attribution, il serait
  // supprimé à la prochaine revue.
  //
  // Sans lui, un lead Instagram qui réserve depuis une description YouTube compte DEUX
  // fois : une fois par son pseudo (volet `leads`), une fois par son e-mail (ce volet).
  // Le volet Instagram porte ce filtre depuis toujours ; celui-ci l'avait oublié.
  //
  // Mesuré le 2026-09-07 : zéro paire concernée en base, donc aucun chiffre ne bouge
  // aujourd'hui. La fusion automatique par e-mail (docs/handoff-fusion-auto-email.md)
  // en créera, et ce jour-là personne ne chercherait un doublon dans la requête YouTube.
  const callsYt = () => {
    let q = supabase.from('calls')
      .select('coach_id, id, invitee_email, invitee_name, booked_at, scheduled_at')
      .in('coach_id', profileIds)
      .in('call_type', CALL_TYPES_VENTE)
      .neq('ignored', true)
      .is('ig_lead_id', null)
      .like('source', 'yt%')
      .order('id', { ascending: true });
    if (since) q = q.or(`booked_at.gte.${since},and(booked_at.is.null,scheduled_at.gte.${since})`);
    return q;
  };

  return { leads, liens, callsIg, callsYt };
}

/* ─── Les ACTIFS d'une période ─────────────────────────────────────────────────
 *
 * `compterLeads` répond à « combien de personnes sont APPARUES dans cette fenêtre ».
 * Sur une période, ce n'est pas ce qu'on veut afficher : tout le monde y est nouveau par
 * construction, ce qui rendait le badge « +N nouveaux » rigoureusement égal au chiffre
 * qu'il accompagnait (mesuré : écart 0 sur juin, juillet, août et septembre 2026).
 *
 * `compterLeadsActifs` répond à « combien de personnes se sont manifestées dans cette
 * fenêtre » — la définition que le commentaire de `PageClientStats` décrivait déjà,
 * mais que le code n'appliquait plus.
 *
 * ── Ce qui fait ENTRER quelqu'un dans une période ────────────────────────────
 *
 *   1. c'est sa première apparition — quel que soit le chemin ;
 *   2. il reprend un lead magnet (une ligne de plus dans l'historique) ;
 *   3. il réserve depuis un lien PARTAGÉ — bio, description, story.
 *
 * ── Ce qui ne le fait PAS ────────────────────────────────────────────────────
 *
 * La progression dans une conversation déjà ouverte : répondre, cliquer un lien,
 * recevoir un Calendly, réserver depuis ce Calendly (`utm_medium = 'dm'`).
 *
 * L'exemple qui fixe la règle (Chris, 2026-09-07) : quelqu'un commente fin août, puis
 * répond et réserve depuis le DM début septembre. Il compte en AOÛT, pas en septembre —
 * on n'a pas gagné un lead, on a déroulé le parcours normal. À l'inverse, quelqu'un qui
 * réserve depuis une bio en juin puis depuis une description en août compte DEUX fois.
 *
 * ⚠️ Conséquence assumée : la somme des périodes DÉPASSE l'all-time, où une personne
 * reste une personne. Les deux chiffres répondent à deux questions ; l'écran doit le
 * dire, et son infobulle le dit.
 *
 * ⚠️ Limite connue, et elle n'est pas réparable ici : `instagram_leads` n'a AUCUNE
 * colonne e-mail. Une personne connue par son pseudo (elle a commenté) et par son
 * e-mail (elle a réservé depuis une bio) occupe deux identités que rien ne rapproche.
 * `docs/handoff-fusion-auto-email.md` pose la fusion qui les réunira ; le jour où elle
 * remplit `ig_lead_id` sur ces calls, la ré-attribution ci-dessous les unifie sans autre
 * changement. Mesuré le 2026-09-07 : zéro paire concernée en base. */

/** Les mediums d'un lien PARTAGÉ. `dm` en est volontairement absent : le Calendly envoyé
 *  en conversation prolonge un parcours, il n'en ouvre pas un nouveau. */
const MEDIUMS_PARTAGES = new Set(['bio', 'description', 'story']);

export interface LignesActifs {
  /** Mêmes lignes que `LignesLeads.leads`. `id` est optionnel et ne sert qu'à
   *  ré-attribuer un call à son lead quand la fusion l'aura rattaché. */
  leads: (LignesLeads['leads'][number] & { id?: string | null })[];
  liens: LignesLeads['liens'];
  /** `instagram_lead_lm_history` — UNE ligne par reprise, jamais écrasée. C'est elle qui
   *  permet de voir qu'une personne est revenue, là où `instagram_leads` fige la
   *  première détection. */
  reprises: { ig_username: string | null; detected_at: string | null }[];
  /** TOUS les calls de vente, `utm_medium` compris — y compris ceux rattachés à un lead,
   *  puisqu'une réservation depuis une bio compte même quand la personne est déjà connue. */
  calls: (LigneCallLead & {
    utm_medium?: string | null;
    booked_at?: string | null;
    scheduled_at?: string | null;
    ig_lead_id?: string | null;
  })[];
}

/**
 * ⚠️ `debut` est OBLIGATOIRE, et c'est délibéré : « actif » n'a de sens que sur une
 * fenêtre. L'all-time garde `compterLeads`, qui compte des personnes. Rendre `debut`
 * nullable aurait permis d'appeler cette fonction sur tout l'historique et d'y compter
 * la même personne plusieurs fois — le type l'interdit.
 */
export function compterLeadsActifs(l: LignesActifs, debut: string, fin: string | null): number {
  const dansLaFenetre = (d: string | null | undefined) => !!d && d >= debut && (!fin || d <= fin);
  const actifs = new Set<string>();

  // 1. Première apparition — exactement la règle de `compterLeads`, pas une copie.
  for (const [cle, date] of premieresApparitions(l.leads, l.liens)) {
    if (dansLaFenetre(date)) actifs.add(cle);
  }

  // 2. Reprise de lead magnet. Pas de garde cold DM ici : reprendre un lead magnet EST
  //    une manifestation, donc la personne est un lead par ce seul fait.
  //
  // ⚠️ Mais seulement pour une personne que `leads` connaît. `instagram_lead_lm_history`
  // n'a PAS de colonne `not_a_lead` : un prospect écarté à la main depuis le pipeline y
  // garde ses lignes, et sans cette garde il reviendrait par les reprises alors qu'il
  // est exclu partout ailleurs.
  //
  // Le filtre vit ICI plutôt que chez l'appelant, et c'est délibéré : Mes Stats écartait
  // ces personnes de son côté, Stats Clients non. Deux écrans, deux filtres, donc deux
  // nombres — exactement la divergence que ce chantier ferme. Une seule règle, appliquée
  // par la fonction, ne peut plus se rouvrir selon qui l'appelle.
  //
  // Une personne qui a une reprise a forcément une fiche `instagram_leads` (les deux
  // s'écrivent ensemble), donc cette garde n'écarte que les exclusions volontaires.
  const connues = new Set<string>();
  for (const r of l.leads) if (r.ig_username) connues.add(r.ig_username.toLowerCase());
  for (const r of l.reprises) {
    if (!r.ig_username || !dansLaFenetre(r.detected_at)) continue;
    const cle = r.ig_username.toLowerCase();
    if (connues.has(cle)) actifs.add(cle);
  }

  // 3. Réservation depuis un lien partagé.
  const usernameParLeadId = new Map<string, string>();
  for (const r of l.leads) {
    if (r.id && r.ig_username) usernameParLeadId.set(r.id, r.ig_username.toLowerCase());
  }
  for (const c of l.calls) {
    if (!MEDIUMS_PARTAGES.has((c.utm_medium ?? '').toLowerCase())) continue;
    // `booked_at` avec repli `scheduled_at` — règle 2 du référentiel. Un rendez-vous PRIS
    // en août pour septembre appartient à août : c'est la réservation qui est l'entrée.
    if (!dansLaFenetre(c.booked_at ?? c.scheduled_at)) continue;
    const viaLead = c.ig_lead_id ? usernameParLeadId.get(c.ig_lead_id) : undefined;
    actifs.add(viaLead ?? clefPersonne(c));
  }

  return actifs.size;
}

function grouper<T extends Record<string, any>>(lignes: T[] | null, cle: 'profile_id' | 'coach_id'): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const l of lignes ?? []) {
    const k = l[cle] as string | null;
    if (!k) continue;
    const liste = m.get(k);
    if (liste) liste.push(l); else m.set(k, [l]);
  }
  return m;
}

/** Leads Instagram seuls (sans le volet YouTube). Signature inchangée. */
export async function fetchIgLeadsCount(supabase: SupabaseClient, profileId: string, since: string | null): Promise<number> {
  const q = requetesLeads(supabase, [profileId], since);
  const [leadsRes, liensRes, callsIgRes] = await Promise.all([lireTout(q.leads), lireTout(q.liens), lireTout(q.callsIg)]);
  return compterLeads({
    leads: (leadsRes.data ?? []) as any[],
    liens: (liensRes.data ?? []) as any[],
    callsIgDirects: (callsIgRes.data ?? []) as any[],
    callsYoutube: [],
  }, since);
}

// Leads toutes sources = Instagram + calls YouTube bookés. Point d'entrée unique
// « Leads » pour tout écran (accueil élève, fiche coach, Mes stats) — évite que chacun
// recolle IG + YT séparément et diverge silencieusement (déjà arrivé).
export async function fetchAllLeadsCount(supabase: SupabaseClient, profileId: string, since: string | null): Promise<number> {
  const q = requetesLeads(supabase, [profileId], since);
  const [leadsRes, liensRes, callsIgRes, callsYtRes] = await Promise.all([lireTout(q.leads), lireTout(q.liens), lireTout(q.callsIg), lireTout(q.callsYt)]);
  return compterLeads({
    leads: (leadsRes.data ?? []) as any[],
    liens: (liensRes.data ?? []) as any[],
    callsIgDirects: (callsIgRes.data ?? []) as any[],
    callsYoutube: (callsYtRes.data ?? []) as any[],
  }, since);
}

/** Les lignes BRUTES par élève, pour que l'appelant les redécoupe lui-même.
 *
 *  Le graphe a besoin d'un point par fenêtre : appeler `fetchLeadsCountsBatch` une fois
 *  par fenêtre ferait quatre requêtes × trente fenêtres. On lit une fois, on répartit
 *  en mémoire, et c'est toujours `compterLeads` qui compte — la règle reste unique. */
export async function fetchLignesLeadsBatch(
  supabase: SupabaseClient,
  profileIds: string[],
  since: string | null,
): Promise<Map<string, LignesLeads>> {
  const resultat = new Map<string, LignesLeads>();
  if (profileIds.length === 0) return resultat;

  const q = requetesLeads(supabase, profileIds, since);
  const [leadsRes, liensRes, callsIgRes, callsYtRes] = await Promise.all([lireTout(q.leads), lireTout(q.liens), lireTout(q.callsIg), lireTout(q.callsYt)]);

  const parLeads = grouper(leadsRes.data as any[], 'profile_id');
  const parLiens = grouper(liensRes.data as any[], 'profile_id');
  // ⚠️ Les calls se groupent sur `coach_id`, qui EST le profile_id de l'élève.
  const parCallsIg = grouper(callsIgRes.data as any[], 'coach_id');
  const parCallsYt = grouper(callsYtRes.data as any[], 'coach_id');

  for (const id of profileIds) {
    resultat.set(id, {
      leads: parLeads.get(id) ?? [],
      liens: parLiens.get(id) ?? [],
      callsIgDirects: parCallsIg.get(id) ?? [],
      callsYoutube: parCallsYt.get(id) ?? [],
    });
  }
  return resultat;
}

/** Le même compte, pour N élèves, en QUATRE requêtes au lieu de quatre par élève.
 *
 *  Écrit pour Stats Clients : à 40 élèves, appeler `fetchAllLeadsCount` en boucle
 *  ferait 160 requêtes. La règle appliquée est rigoureusement la même — c'est
 *  `compterLeads` des deux côtés, seule la façon de lire les lignes change.
 *
 *  Un élève sans aucune ligne n'apparaît PAS dans la Map : l'appelant distingue alors
 *  « aucun lead » de « on n'a pas la donnée », plutôt que de recevoir un 0 qui affirme. */
export async function fetchLeadsCountsBatch(
  supabase: SupabaseClient,
  profileIds: string[],
  since: string | null,
): Promise<Map<string, number>> {
  const resultat = new Map<string, number>();
  if (profileIds.length === 0) return resultat;

  const q = requetesLeads(supabase, profileIds, since);
  const [leadsRes, liensRes, callsIgRes, callsYtRes] = await Promise.all([lireTout(q.leads), lireTout(q.liens), lireTout(q.callsIg), lireTout(q.callsYt)]);

  const parLeads = grouper(leadsRes.data as any[], 'profile_id');
  const parLiens = grouper(liensRes.data as any[], 'profile_id');
  // ⚠️ Les calls se groupent sur `coach_id`, qui EST le profile_id de l'élève.
  const parCallsIg = grouper(callsIgRes.data as any[], 'coach_id');
  const parCallsYt = grouper(callsYtRes.data as any[], 'coach_id');

  for (const id of profileIds) {
    const lignes = {
      leads: parLeads.get(id) ?? [],
      liens: parLiens.get(id) ?? [],
      callsIgDirects: parCallsIg.get(id) ?? [],
      callsYoutube: parCallsYt.get(id) ?? [],
    };
    const aDesLignes = lignes.leads.length || lignes.liens.length
      || lignes.callsIgDirects.length || lignes.callsYoutube.length;
    if (aDesLignes) resultat.set(id, compterLeads(lignes, since));
  }
  return resultat;
}
