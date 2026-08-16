import { isCallHonored } from '@/lib/callHonored';
import type { Call } from '@/lib/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';

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
}

// Reproduit exactement le calcul de PageClientDetail.tsx:495-505 — closingRate =
// deals closés / calls honorés (pas / calls bookés), cf. docs/calls-coach-id-piege.md
// pour le filtre coach_id à appliquer en amont sur les calls passés ici.
export function computeSalesCallStats(calls: Call[], now: Date): SalesCallStats {
  const salesCalls = calls.filter(isNotCanceled);
  const callsBookedCount = salesCalls.filter(c => c.status === 'active').length;
  const callsHonoredCount = salesCalls.filter(c => c.status && c.scheduled_at && isCallHonored({ ...c, status: c.status, scheduled_at: c.scheduled_at }, now)).length;
  const dealsClosedCount = salesCalls.filter(c => c.deal_closed).length;
  const closingRate = callsHonoredCount > 0 ? Math.round((dealsClosedCount / callsHonoredCount) * 100) : 0;
  const cashContracted = salesCalls.reduce((s, c) => s + (c.revenue || 0), 0);
  return { callsBookedCount, callsHonoredCount, dealsClosedCount, closingRate, cashContracted };
}

// Leads IG totaux — voir docs/pipeline-leads-ig-sources.md pour l'explication
// complète. 3 sources cumulées, pas juste instagram_leads : (1) leads détectés
// automatiquement, (2) prospect_links dédupliqués par ig_username avec (1), (3)
// calls IG directs sans lead (clic bio/description sans jamais avoir commenté).
// Extrait de PageClientDetail.tsx (coach) pour être réutilisé tel quel côté
// élève (useClientSelfData) — même formule, même compte des deux côtés.
export async function fetchIgLeadsCount(supabase: SupabaseClient, profileId: string, since: string | null): Promise<number> {
  // Pas de filtre `since` sur ces deux requêtes : un même prospect peut apparaître dans
  // instagram_leads ET prospect_links à des dates différentes (ex: détecté en juillet,
  // relance/re-clic en août). Filtrer chaque source séparément par `since` avant de
  // dédupliquer faisait recompter comme "nouveau ce mois" un lead déjà ancien dès que
  // sa 2ème source (souvent prospect_links, recréé à chaque nouveau lien envoyé) tombait
  // dans la période — le filtre doit s'appliquer sur la date la plus ancienne connue par
  // username, après dédup, jamais avant.
  const leadsQuery = supabase.from('instagram_leads').select('ig_username, detected_at')
    .eq('profile_id', profileId).is('archived_at', null).eq('not_a_lead', false);
  const linksQuery = supabase.from('prospect_links').select('ig_username, created_at').eq('profile_id', profileId);

  // .neq('ignored', true) est indispensable ici — sans lui, ce compteur inclut
  // aussi les calls que le coach a "supprimés" depuis le pipeline. Même filtre
  // que app/api/client/pipeline/route.ts.
  // Filtre sur booked_at (date de réservation réelle), pas scheduled_at (heure du
  // call) — un call réservé avant `since` n'a pas pu être généré par le pipeline
  // Momentum même si son scheduled_at tombe après. Fallback sur scheduled_at si
  // booked_at manque (anciens calls importés sans cette donnée).
  let directCallsQuery = supabase.from('calls').select('id')
    .eq('coach_id', profileId)
    .eq('call_type', 'calendly')
    .neq('ignored', true)
    .is('ig_lead_id', null)
    .neq('lead_deleted', true)
    .in('source', ['ig_description', 'ig_bio']);
  if (since) directCallsQuery = directCallsQuery.or(`booked_at.gte.${since},and(booked_at.is.null,scheduled_at.gte.${since})`);

  const [leadsRes, linksRes, directCallsRes] = await Promise.all([leadsQuery, linksQuery, directCallsQuery]);

  // Date la plus ancienne connue par username, toutes sources confondues.
  const earliestByUsername = new Map<string, string>();
  for (const r of (leadsRes.data ?? []) as { ig_username: string | null; detected_at: string | null }[]) {
    if (!r.ig_username || !r.detected_at) continue;
    const key = r.ig_username.toLowerCase();
    const prev = earliestByUsername.get(key);
    if (!prev || r.detected_at < prev) earliestByUsername.set(key, r.detected_at);
  }
  for (const r of (linksRes.data ?? []) as { ig_username: string | null; created_at: string | null }[]) {
    if (!r.ig_username || !r.created_at) continue;
    const key = r.ig_username.toLowerCase();
    const prev = earliestByUsername.get(key);
    if (!prev || r.created_at < prev) earliestByUsername.set(key, r.created_at);
  }

  const count = since
    ? Array.from(earliestByUsername.values()).filter(d => d >= since).length
    : earliestByUsername.size;

  return count + ((directCallsRes.data as { id: string }[] | null)?.length ?? 0);
}

// Leads toutes sources = fetchIgLeadsCount (Instagram) + calls YouTube bookés (source
// commençant par "yt", non annulés). Point d'entrée unique "Leads" pour tout écran
// (accueil élève, fiche coach, Mes stats) — évite que chacun recolle IG + YT séparément
// et diverge silencieusement (déjà arrivé : Mes Stats oubliait YouTube).
export async function fetchAllLeadsCount(supabase: SupabaseClient, profileId: string, since: string | null): Promise<number> {
  let ytCallsQuery = supabase.from('calls').select('id, status')
    .eq('coach_id', profileId)
    .eq('call_type', 'calendly')
    .neq('ignored', true)
    .like('source', 'yt%');
  if (since) ytCallsQuery = ytCallsQuery.or(`booked_at.gte.${since},and(booked_at.is.null,scheduled_at.gte.${since})`);

  const [igCount, ytCallsRes] = await Promise.all([
    fetchIgLeadsCount(supabase, profileId, since),
    ytCallsQuery,
  ]);

  const ytBookedCount = ((ytCallsRes.data ?? []) as { id: string; status: string | null }[])
    .filter(c => !['cancelled', 'canceled', 'declined'].includes(c.status ?? '')).length;

  return igCount + ytBookedCount;
}
