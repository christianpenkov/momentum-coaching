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
export function isNotCanceled(c: Call): boolean {
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
  /** `instagram_leads` — leads détectés automatiquement. */
  leads: { ig_username: string | null; detected_at: string | null }[];
  /** `prospect_links` — dédupliqués par `ig_username` avec les précédents. */
  liens: { ig_username: string | null; created_at: string | null }[];
  /** Calls IG directs sans lead : clic bio/description sans jamais avoir commenté.
   *  `booked_at` / `scheduled_at` sont là pour que l'appelant puisse les répartir par
   *  fenêtre — `compterLeads` ne les filtre PAS lui-même. */
  callsIgDirects: LigneCallLead[];
  /** Calls venus de YouTube. Vide quand on ne compte que le volet Instagram. */
  callsYoutube: LigneCallLead[];
}

/** Une personne compte UNE fois, quelle que soit sa source et son nombre de calls. */
function clefPersonne(c: LigneCallLead): string {
  return (c.invitee_email || c.invitee_name || c.id).toLowerCase();
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
  const plusAncienneParUsername = new Map<string, string>();
  for (const r of l.leads) {
    if (!r.ig_username || !r.detected_at) continue;
    const cle = r.ig_username.toLowerCase();
    const prec = plusAncienneParUsername.get(cle);
    if (!prec || r.detected_at < prec) plusAncienneParUsername.set(cle, r.detected_at);
  }
  for (const r of l.liens) {
    if (!r.ig_username || !r.created_at) continue;
    const cle = r.ig_username.toLowerCase();
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

/* ─── Les trois lecteurs de cette règle ───────────────────────────────────── */

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
  const leads = () => supabase.from('instagram_leads')
    .select('profile_id, ig_username, detected_at')
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

  const callsYt = () => {
    let q = supabase.from('calls')
      .select('coach_id, id, invitee_email, invitee_name, booked_at, scheduled_at')
      .in('coach_id', profileIds)
      .in('call_type', CALL_TYPES_VENTE)
      .neq('ignored', true)
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
