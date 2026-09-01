-- Surveille la CONSEQUENCE d'un echec de mesure des periodes Instagram, pas la cause.
--
-- `poll-leads` mesure la portee dedupliquee par semaine, par mois et sur tout
-- l'historique. Chaque appel peut echouer (Meta renvoie des HTTP 400 passagers), mais
-- le passage suivant reessaie : une periode se repare toute seule en 65 minutes.
--
-- Journaliser ces echecs dans `cron_runs` remplissait la table d'incidents deja
-- resolus — 58 lignes au 2026-09-01, alors qu'aucune periode ne manquait. Or le
-- contrat de `cron_runs` est « table vide = aucun incident » : le jour ou elle contient
-- des lignes qu'on ne peut pas traiter, on prend l'habitude de ne plus la lire, et elle
-- ne sert plus le jour d'un vrai incident.
--
-- Ils sont donc classes passagers dans `estIncidentPassager`, et c'est CETTE VUE qui
-- garde l'oeil ouvert a leur place : elle ne regarde pas si un appel a echoue, mais si
-- une periode COURANTE a cesse d'etre rafraichie. Le cron rafraichit toutes les 6 h ;
-- au-dela de 24 h, l'auto-reparation a echoue quatre fois de suite et c'est une vraie
-- panne. Meme paire que `shortio_sante_donnees` avec les 500 de Short.io.
--
-- ⚠️ Le RATTRAPAGE des periodes anciennes n'est PAS surveille ici, et c'est voulu :
-- il avance d'une periode par passage, donc un profil connecte depuis un an met des
-- semaines a se remplir. Un trou ancien n'est pas une panne, c'est un remplissage en
-- cours.
create or replace view public.ig_sante_periodes as
with attendu as (
  select i.profile_id,
         t.type,
         case t.type
           when 'semaine' then date_trunc('week', (now() at time zone 'Europe/Paris'))::date
           when 'mois' then date_trunc('month', (now() at time zone 'Europe/Paris'))::date
           else null::date
         end as debut_attendu
  from public.integrations i
  cross join (values ('semaine'), ('mois'), ('all_time')) as t(type)
  where i.provider = 'instagram' and i.status = 'ok'
)
select
  a.profile_id,
  a.type,
  a.debut_attendu,
  p.debut as debut_trouve,
  p.mesure_le,
  round(extract(epoch from (now() - p.mesure_le)) / 3600.0, 1) as il_y_a_heures,
  case
    -- Aucune ligne : normal tant que le premier passage n'a pas eu lieu. La colonne
    -- `mesure_le` vide se lit comme « pas encore mesure », jamais comme un zero.
    when p.mesure_le is null then 'ALERTE période jamais mesurée'
    when now() - p.mesure_le > interval '24 hours' then 'ALERTE période courante figée'
    else 'ok'
  end as etat
from attendu a
left join public.analytics_ig_periodes p
  on p.profile_id = a.profile_id
 and p.type = a.type
 and p.archived_at is null
 and (a.debut_attendu is null or p.debut = a.debut_attendu);

comment on view public.ig_sante_periodes is
  'Une ligne ALERTE = la portee dedupliquee d''une periode COURANTE (semaine en cours, '
  'mois en cours, all_time) n''est plus rafraichie depuis plus de 24 h, alors que le '
  'cron passe toutes les 6 h. Surveille la consequence, pas les HTTP 400 passagers de '
  'Meta, qui se reparent au passage suivant. Filtrer sur etat like ''ALERTE%''.';

grant select on public.ig_sante_periodes to authenticated, service_role;
