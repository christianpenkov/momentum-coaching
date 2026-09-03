-- Verrouillage des accès anon/authenticated sur les objets « machine ».
--
-- Constat (advisors Supabase, 2026-09-02) : la clé anon — publique par
-- construction, elle est dans le bundle JS de chaque élève — pouvait exécuter
-- les fonctions d'infrastructure via PostgREST : purger la file de webhooks
-- (perte de leads), simuler un battement de cron via marquer_passage_cron
-- (un cron mort devient indétectable — ça casse toute la surveillance
-- crons_sante), déplacer le filigrane Stripe via set_integration_metadata_key
-- (des paiements sautés en silence), ou réclamer des items de la file via
-- claim_webhook_queue (des DMs jamais envoyés). Elle pouvait aussi lire les
-- 5 tables machine sans RLS et les 15 vues de santé (profile_ids, données
-- opérationnelles).
--
-- Vérifié avant d'écrire (2026-09-02) : TOUS les appelants de ces objets sont
-- en service_role (Edge Functions via SUPABASE_SERVICE_ROLE_KEY, routes
-- Vercel via serviceSupabase, pg_cron en postgres, triggers). Aucun code
-- navigateur ne les touche. Les RPC réellement appelées du navigateur
-- (get_* de PageClientStats, set/clear_message_reaction,
-- stats_clients_series) gardent authenticated — elles portent déjà leur
-- propre contrôle d'ownership (auth.uid() = profil ou relation coach) —
-- et perdent seulement anon.
--
-- Les deux aides de policies RLS (client_can_read_section,
-- client_has_resource_access) ne sont volontairement PAS touchées : une
-- policy qui appelle une fonction non exécutable par le rôle courant fait
-- échouer la requête au lieu de rendre zéro ligne.

-- ── 1. Tables machine : RLS activée, aucune policy = accès service_role
--      uniquement (service_role contourne la RLS, PostgREST anon est bloqué).
alter table public.ig_comment_processing_lock enable row level security;
alter table public.cron_invocation_logs enable row level security;
alter table public.webhook_debug_log enable row level security;
alter table public.ig_entry_id_mapping enable row level security;
alter table public.crons_passages enable row level security;

-- ── 2. Fonctions machine : ni anon, ni authenticated, ni PUBLIC.
--      service_role regagne explicitement EXECUTE (il le tenait via PUBLIC).
do $$
declare
  fn text;
  fns text[] := array[
    'claim_webhook_queue(integer)',
    'degrossir_historiques_analytics()',
    'insert_prospect_event_relance(uuid, text, text, timestamptz, uuid, jsonb)',
    'marquer_passage_cron(text, text)',
    'purge_call_rapport_drafts()',
    'purge_cron_runs()',
    'purge_debug_logs()',
    'purge_journaux_machine()',
    'purge_link_clicks()',
    'purge_webhook_queue()',
    'resolve_prospect(uuid, text, text, text, text)',
    'set_integration_metadata_key(uuid, text, text, text)',
    'upsert_prospect_event_by_lead(uuid, text, text, text, timestamptz, uuid, jsonb)',
    'upsert_prospect_event_by_link(uuid, text, text, text, timestamptz, uuid, uuid, jsonb)',
    'upsert_prospect_event_call_booked(uuid, text, text, text, timestamptz, uuid, uuid, uuid)',
    'upsert_yt_ctr(jsonb)',
    'upsert_shortio_link_snapshot(uuid, text, text, text, text, date, integer, integer, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, boolean)',
    'get_profile_id_by_email(text)',
    'get_shortio_links_agreges(uuid, date, date)'
  ];
begin
  foreach fn in array fns loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', fn);
    execute format('grant execute on function public.%s to service_role', fn);
  end loop;
end $$;

-- Fonctions de trigger : jamais appelées par un client, EXECUTE inutile
-- pour tout le monde (le déclenchement d'un trigger ne vérifie pas EXECUTE).
do $$
declare
  fn text;
  fns text[] := array[
    'memoriser_premiere_connexion()',
    'restaurer_premiere_connexion()',
    'reject_deal_on_ignored_call()',
    'tasks_restrict_student_update()',
    'update_shortio_link_snapshots_updated_at()',
    'recalc_integrations_ready_at()',
    'guard_message_recipient_update()',
    'enforce_resource_section_depth()'
  ];
begin
  foreach fn in array fns loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', fn);
  end loop;
end $$;

-- ── 3. RPC navigateur : authenticated reste, anon part. Chacune vérifie déjà
--      l'ownership dans son corps ; ceci ferme juste l'appel sans session.
do $$
declare
  fn text;
  fns text[] := array[
    'get_ig_posts_history(uuid, date, date)',
    'get_yt_videos_history(uuid, date, date)',
    'get_shortio_clicks_by_url(uuid, date, date)',
    'get_shortio_clicks_by_day(uuid, date, date)',
    'get_encaissements_par_jour(uuid, timestamptz, timestamptz)',
    'get_ventes_de_la_periode(uuid, timestamptz, timestamptz)',
    'set_message_reaction(uuid, text)',
    'clear_message_reaction(uuid)',
    'stats_clients_series(uuid[], date, date, text)'
  ];
begin
  foreach fn in array fns loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated, service_role', fn);
  end loop;
end $$;

-- ── 4. Vues de santé : lues uniquement par service_role (alerte-vues,
--      integrations/health) et par le SQL editor. Le navigateur n'en lit
--      aucune (vérifié par grep sur app/, components/, lib/).
do $$
declare
  v text;
  vs text[] := array[
    'utm_anomalies','ventes_sante_montants','integrations_sante',
    'ig_sante_insights_posts','ventes_sante_contenu','yt_sante_donnees',
    'shortio_sante_donnees','stripe_sante_rattachement','base_sante_taille',
    'clics_sante_redirection','crons_sante','ig_sante_periodes',
    'ventes_sante_sur_encaissement','ventes_sante_date','ig_sante_donnees'
  ];
begin
  foreach v in array vs loop
    execute format('revoke select on public.%I from anon, authenticated', v);
  end loop;
end $$;

-- ── 5. search_path figé sur les fonctions signalées mutable (advisor
--      function_search_path_mutable) : un objet homonyme posé dans un autre
--      schéma du search_path ne peut plus détourner l'exécution.
alter function public.tasks_restrict_student_update() set search_path = public;
alter function public.update_shortio_link_snapshots_updated_at() set search_path = public;
alter function public.upsert_yt_ctr(jsonb) set search_path = public;
alter function public.recalc_integrations_ready_at() set search_path = public;
alter function public.guard_message_recipient_update() set search_path = public;
alter function public.enforce_resource_section_depth() set search_path = public;
alter function public.purge_cron_runs() set search_path = public;
alter function public.upsert_shortio_link_snapshot(uuid, text, text, text, text, date, integer, integer, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, boolean) set search_path = public;
