-- Purge automatique des tables de DEBUG TECHNIQUE (rétention 14 jours).
--
-- Ne concerne AUCUNE donnée métier : ni messages, ni calls, ni analytics, ni
-- historique commercial. Uniquement des journaux techniques qui ne servent qu'au
-- diagnostic à chaud.
--
-- Pourquoi : sw_logs est la plus grosse table de la base (44 152 lignes, 8,7 Mo)
-- et la SEULE dont la croissance est incontrôlée — 194 lignes/semaine en juillet,
-- 20 781 en août, soit un facteur 100 en un mois, sans rapport avec le nombre
-- d'élèves (c'était une session de debug PWA). Sur le plan gratuit, la base bascule
-- en LECTURE SEULE à 500 Mo : cette table seule pouvait consommer ~1 Go/an et
-- déclencher la bascule bien avant les tables analytics.
--
-- 14 jours (choix de Chris) : la méthode de debug du projet repose sur ces tables
-- (écriture en base plutôt que console.log), mais elles sont consultées dans les
-- heures qui suivent un incident, jamais au-delà de deux semaines.
CREATE OR REPLACE FUNCTION public.purge_debug_logs()
RETURNS TABLE(table_name text, deleted bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cutoff timestamptz := now() - interval '14 days';
  n bigint;
BEGIN
  DELETE FROM public.sw_logs WHERE created_at < cutoff;
  GET DIAGNOSTICS n = ROW_COUNT;
  table_name := 'sw_logs'; deleted := n; RETURN NEXT;

  DELETE FROM public.webhook_debug_log WHERE created_at < cutoff;
  GET DIAGNOSTICS n = ROW_COUNT;
  table_name := 'webhook_debug_log'; deleted := n; RETURN NEXT;

  DELETE FROM public.cron_invocation_logs WHERE created_at < cutoff;
  GET DIAGNOSTICS n = ROW_COUNT;
  table_name := 'cron_invocation_logs'; deleted := n; RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.purge_debug_logs IS
  'Supprime les journaux techniques de plus de 14 jours (sw_logs, webhook_debug_log, cron_invocation_logs). Aucune donnée métier concernée.';

-- Index sur created_at : sans lui, chaque purge ferait un seq scan complet de
-- sw_logs. webhook_debug_log a déjà le sien (webhook_debug_log_created_at_idx).
CREATE INDEX IF NOT EXISTS idx_sw_logs_created_at
  ON public.sw_logs (created_at);

CREATE INDEX IF NOT EXISTS idx_cron_invocation_logs_created_at
  ON public.cron_invocation_logs (created_at);

-- Planification quotidienne à 03:30 UTC (heure creuse). unschedule d'abord pour
-- rendre la migration rejouable sans créer de doublon de job.
SELECT cron.unschedule('purge-debug-logs')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-debug-logs');

SELECT cron.schedule(
  'purge-debug-logs',
  '30 3 * * *',
  $cron$SELECT public.purge_debug_logs();$cron$
);
