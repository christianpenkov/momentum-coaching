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
  let leadsQuery = supabase.from('instagram_leads').select('ig_username')
    .eq('profile_id', profileId).is('archived_at', null).eq('not_a_lead', false);
  if (since) leadsQuery = leadsQuery.gte('detected_at', since);

  let linksQuery = supabase.from('prospect_links').select('ig_username').eq('profile_id', profileId);
  if (since) linksQuery = linksQuery.gte('created_at', since);

  // .neq('ignored', true) est indispensable ici — sans lui, ce compteur inclut
  // aussi les calls que le coach a "supprimés" depuis le pipeline. Même filtre
  // que app/api/client/pipeline/route.ts.
  let directCallsQuery = supabase.from('calls').select('id')
    .eq('coach_id', profileId)
    .eq('call_type', 'calendly')
    .neq('ignored', true)
    .is('ig_lead_id', null)
    .neq('lead_deleted', true)
    .in('source', ['ig_description', 'ig_bio']);
  if (since) directCallsQuery = directCallsQuery.gte('scheduled_at', since);

  const [leadsRes, linksRes, directCallsRes] = await Promise.all([leadsQuery, linksQuery, directCallsQuery]);

  const usernames = new Set<string>();
  for (const r of (leadsRes.data ?? []) as { ig_username: string | null }[]) if (r.ig_username) usernames.add(r.ig_username.toLowerCase());
  for (const r of (linksRes.data ?? []) as { ig_username: string | null }[]) if (r.ig_username) usernames.add(r.ig_username.toLowerCase());

  return usernames.size + ((directCallsRes.data as { id: string }[] | null)?.length ?? 0);
}
