-- Purge des journaux de MACHINE (pg_cron, pg_net) — pas des donnees du projet.
--
-- Contexte : le 2026-08-30, Supabase a alerte sur l'epuisement du budget Disk IO.
-- La base pesait 112 Mo, dont pres de la MOITIE etait du dechet d'infrastructure :
--
--   net._http_response      34 Mo (30 %)  -- 24 lignes vivantes dans 34 Mo de pages
--   cron.job_run_details    19 Mo (17 %)  -- 40 767 lignes depuis le 5 juin
--
-- Apres nettoyage ponctuel (VACUUM FULL sur la premiere, suppression au-dela de
-- 7 jours puis VACUUM FULL sur la seconde) : base a 54 Mo. Aucune donnee du projet
-- touchee.
--
-- Ce fichier rend le nettoyage AUTOMATIQUE, pour ne pas avoir a le refaire.
--
-- ── Pourquoi ces deux tables gonflent ────────────────────────────────────────
--
-- Deux jobs pg_cron appellent une URL toutes les MINUTES (send-pending-dm3,
-- process-webhook-queue). Cela produit ~2 900 requetes HTTP par jour, donc :
--   • ~2 900 lignes dans cron.job_run_details, que pg_cron ne purge JAMAIS ;
--   • ~2 900 insertions puis suppressions dans les tables de pg_net.
--
-- pg_net purge bien ses lignes (pg_net.ttl = 6 heures). Le probleme etait ailleurs :
-- autovacuum n'etait passe qu'UNE SEULE FOIS en 25 jours sur net._http_response, si
-- bien que les pages liberees n'etaient jamais reutilisees et la table ne faisait que
-- croitre. C'est ce qui explique 34 Mo pour 24 lignes.

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
end;
$function$;

select cron.schedule('purge-journaux-machine-daily', '50 3 * * *', 'select public.purge_journaux_machine();');

-- Le reglage propre serait `alter table net._http_response set
-- (autovacuum_vacuum_threshold = 500)` : le facteur d'echelle par defaut (20 % de la
-- table) ne declenche presque jamais sur une table qui ne garde que ~700 lignes
-- vivantes tout en encaissant 2 900 ecritures par jour.
--
-- Impossible ici : ces tables appartiennent a supabase_admin et le role postgres ne
-- peut pas les ALTER. Il PEUT en revanche les vacuumer — d'ou ce passage quotidien.
--
-- VACUUM simple et non FULL : il ne rend pas l'espace au systeme de fichiers mais rend
-- les pages reutilisables, ce qui suffit a empecher la table de regonfler. Le FULL
-- prend un verrou exclusif et n'a de sens qu'une fois, apres coup.
--
-- Hors fonction plpgsql, volontairement : VACUUM ne peut pas s'executer dans un bloc
-- transactionnel, il doit etre la commande de premier niveau du job.
select cron.schedule('vacuum-pg-net-daily', '55 3 * * *', 'vacuum (analyze) net._http_response, net.http_request_queue');
