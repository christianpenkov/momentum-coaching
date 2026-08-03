import { isCallHonored } from '@/lib/callHonored';
import type { Call } from '@/lib/supabase/types';

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
