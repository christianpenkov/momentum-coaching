import { useEffect, useState } from 'react';
import { CALL_TYPES_VENTE } from '@/lib/callTypes';
import { createClient } from '@/lib/supabase/client';
import type { Call } from '@/lib/supabase/types';

export function useClientAllCalls(client: { id: string; profile_id: string } | null) {
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!client) return;
    const supabase = createClient();
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      // Calls Calendly : coach_id = profileId de l'élève. Référence stable "toutes les
      // intégrations obligatoires connectées pour la 1ère fois" (trigger DB, jamais
      // réécrite) — voir docs/integrations-ready-at-vs-onboarding-completed-at.md.
      const { data: clientRow } = await supabase.from('clients')
        .select('integrations_ready_at').eq('profile_id', client.profile_id).maybeSingle();
      const integrationsReadyAt: string | null = clientRow?.integrations_ready_at ?? null;

      let calendlyQuery = supabase.from('calls').select('*')
        .eq('coach_id', client.profile_id)
        .in('call_type', CALL_TYPES_VENTE)
        .neq('status', 'cancelled')
        .neq('status', 'canceled')
        .order('scheduled_at', { ascending: true });
      if (integrationsReadyAt) {
        // Un call réservé (booked_at) avant que toutes les intégrations obligatoires
        // soient connectées n'a pas pu être généré par le pipeline Momentum — fallback
        // sur scheduled_at si booked_at manque (anciens calls importés sans cette donnée).
        calendlyQuery = calendlyQuery.or(
          `booked_at.gte.${integrationsReadyAt},and(booked_at.is.null,scheduled_at.gte.${integrationsReadyAt})`
        );
      }
      const { data: calendlyCalls } = await calendlyQuery;

      // Calls Google Calendar : client_id = client.id
      const { data: googleCalls } = await supabase.from('calls').select('*')
        .eq('client_id', client.id)
        .eq('call_type', 'google')
        .neq('status', 'canceled')
        .neq('status', 'cancelled')
        .neq('status', 'declined')
        .neq('ignored', true)
        .order('scheduled_at', { ascending: true });

      if (cancelled) return;
      const all = [...(calendlyCalls || []), ...(googleCalls || [])];
      const seen = new Set<string>();
      setCalls(all.filter(c => { if (seen.has(c.id)) return false; seen.add(c.id); return true; }) as Call[]);
      setLoading(false);
    };
    load();

    return () => { cancelled = true; };
  }, [client?.id, client?.profile_id]);

  return { calls, loading };
}
