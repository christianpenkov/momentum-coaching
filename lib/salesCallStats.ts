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
import { isCallHonored } from './callHonored.ts';
import { calculerCash } from './dealCash.ts';
import { CALL_TYPES_VENTE } from './callTypes.ts';
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
  callsBookedCount: number;
  callsHonoredCount: number;
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
  const active = deals.filter(d => d.status !== 'canceled');
  return {
    contracted: active.reduce((s, d) => s + Number(d.amount_total || 0), 0),
    collected: deals.reduce((s, d) => s + Number(d.collected || 0), 0),
  };
}

// Reproduit exactement le calcul de PageClientDetail.tsx:495-505 — closingRate =
// deals closés / calls honorés (pas / calls bookés), cf. docs/calls-coach-id-piege.md
// pour le filtre coach_id à appliquer en amont sur les calls passés ici.
export function computeSalesCallStats(calls: Call[], now: Date, deals?: DealForStats[]): SalesCallStats {
  const salesCalls = calls.filter(isNotCanceled);
  const callsBookedCount = salesCalls.filter(c => c.status === 'active').length;
  const callsHonoredCount = salesCalls.filter(c => c.status && c.scheduled_at && isCallHonored({ ...c, status: c.status, scheduled_at: c.scheduled_at }, now)).length;
  const dealsClosedCount = salesCalls.filter(c => c.deal_closed).length;
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
      callsBookedCount, callsHonoredCount, dealsClosedCount, closingRate,
      cashContracted: totals.contracted,
      cashCollected: totals.collected,
    };
  }

  const cashContracted = salesCalls.reduce((s, c) => s + (c.revenue || 0), 0);
  return {
    callsBookedCount, callsHonoredCount, dealsClosedCount, closingRate,
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
    .select('amount_total, status, deal_payments(amount, status)')
    .eq('profile_id', profileId);

  return (data ?? []).map((d: any) => ({
    amount_total: d.amount_total,
    status: d.status,
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
  // ── État du cold DM, agrégé par PERSONNE et jamais par ligne ───────────────
  //
  // `instagram_leads` porte plusieurs fiches pour la même personne : chaque reprise de
  // lead magnet, réponse de story ou cold DM en crée une. Sa réponse peut donc être
  // portée par une AUTRE fiche que celle qu'on est en train de lire — juger ligne par
  // ligne écarterait quelqu'un qui a bel et bien répondu.
  //
  // ⚠️ Rétro-compatible par construction : un appelant qui ne fournit pas `source` laisse
  // `tousDemarches` à faux dès la première fiche, donc n'exclut personne. Le comportement
  // d'avant le 2026-09-07 est conservé à l'octet près pour qui ne passe pas ces colonnes.
  const etatCold = new Map<string, { tousDemarches: boolean; aRepondu: boolean }>();
  for (const r of l.leads) {
    if (!r.ig_username) continue;
    const cle = r.ig_username.toLowerCase();
    const etat = etatCold.get(cle) ?? { tousDemarches: true, aRepondu: false };
    if (r.source !== 'cold_dm') etat.tousDemarches = false;
    if (r.hook_replied_at) etat.aRepondu = true;
    etatCold.set(cle, etat);
  }

  const plusAncienneParUsername = new Map<string, string>();
  for (const r of l.leads) {
    const date = dateDeLead(r);
    if (!r.ig_username || !date) continue;
    const cle = r.ig_username.toLowerCase();
    const prec = plusAncienneParUsername.get(cle);
    if (!prec || date < prec) plusAncienneParUsername.set(cle, date);
  }

  // ⚠️ Un lien ne doit pas RESSUSCITER un démarché sans réponse.
  //
  // `prospect_links` continue d'entrer une personne par lui-même — c'est la règle
  // d'origine, et elle ne change pas ici. Une seule exception, sans quoi la règle du
  // cold DM fuirait par la fenêtre : quelqu'un dont TOUTES les fiches sont des cold DM
  // sans réponse redeviendrait un lead au seul motif qu'on lui a envoyé un Calendly,
  // c'est-à-dire encore une action de notre côté.
  //
  // Mesuré le 2026-09-07 : zéro personne dans ce cas, donc aucun chiffre ne bouge.
  // C'est un chemin qu'on ferme, pas un compte qu'on corrige.
  const demarchesSansReponse = new Set<string>();
  for (const [cle, etat] of etatCold) if (etat.tousDemarches && !etat.aRepondu) demarchesSansReponse.add(cle);

  for (const r of l.liens) {
    if (!r.ig_username || !r.created_at) continue;
    const cle = r.ig_username.toLowerCase();
    if (demarchesSansReponse.has(cle)) continue;
    const prec = plusAncienneParUsername.get(cle);
    if (!prec || r.created_at < prec) plusAncienneParUsername.set(cle, r.created_at);
  }

  const dates = Array.from(plusAncienneParUsername.values());
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
    .select('profile_id, ig_username, detected_at, source, hook_replied_at')
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
