-- La retention de 30 jours de `cron_runs` etait AFFIRMEE par la doc (AGENTS.md et
-- 4 handoffs : « se purge seule a 30 jours ») mais n'existait nulle part : aucun
-- `delete from cron_runs` dans le depot, aucun job pg_cron la visant. La table
-- croissait sans borne depuis sa creation.
--
-- Revele en dimensionnant `sync-stripe-payments`, passe a 48 passages/jour : un seul
-- profil durablement en erreur y ecrirait 48 lignes par jour, indefiniment. Le volume
-- actuel est negligeable (34 lignes en 5 jours) parce que la table ne journalise que
-- les ECHECS -- c'est justement pourquoi personne ne l'a vu : une table qui reste vide
-- quand tout va bien ne revele son absence de purge qu'une fois quelque chose casse.
--
-- 30 jours : la valeur que la doc annoncait deja. On rend vrai ce qui etait ecrit,
-- plutot que de reecrire la doc pour l'aligner sur l'absence de mecanisme.
--
-- Loge dans purge_journaux_machine() plutot que dans un job dedie : meme nature
-- (journal de passages), meme creneau nocturne, et un job de moins a surveiller --
-- l'objectif du projet etant zero maintenance.

create or replace function public.purge_journaux_machine()
returns table(objet text, supprime bigint)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare n bigint;
begin
  -- 7 jours suffisent : les incidents REELS sont deja retenus 30 jours dans la table
  -- `cron_runs` du projet, qui ne journalise que les passages en echec. Ici, c'est le
  -- journal brut de pg_cron, utile seulement pour une enquete a chaud.
  delete from cron.job_run_details where start_time < now() - interval '7 days';
  get diagnostics n = row_count;
  objet := 'cron.job_run_details'; supprime := n; return next;

  -- Les 30 jours annonces par la doc, desormais reellement appliques.
  delete from public.cron_runs where ran_at < now() - interval '30 days';
  get diagnostics n = row_count;
  objet := 'public.cron_runs'; supprime := n; return next;
end;
$function$;
