-- Le dernier jour collecté par élève, sans borne de date.
--
-- La page Stats Clients lisait jusqu'ici les dix derniers jours de
-- `analytics_daily_snapshots` et prenait la première ligne de chaque profil. Deux
-- défauts :
--
-- 1. un élève collecté il y a quinze jours en était absent, donc indiscernable d'un
--    élève dont rien n'a JAMAIS été collecté — deux situations très différentes,
--    affichées avec les mêmes mots ;
-- 2. à 40 élèves sur un an, la même requête sans borne rapatrierait ~14 000 lignes
--    pour n'en garder que 40.
--
-- Une vue qui agrège en base règle les deux : une ligne par élève, et la date vraie.
--
-- ⚠️ `security_invoker = true` : la vue hérite des politiques de la table sous-jacente
-- (« coach sees clients » et « own profile only »), donc elle ne montre à chacun que ce
-- qu'il a déjà le droit de lire. Sans ce réglage, une vue s'exécute avec les droits de
-- son PROPRIÉTAIRE et court-circuiterait le RLS en silence.
create or replace view public.dernier_snapshot_par_profil
with (security_invoker = true) as
select
  profile_id,
  max(date) as dernier_jour,
  count(*) as jours_collectes
from public.analytics_daily_snapshots
where archived_at is null
group by profile_id;

comment on view public.dernier_snapshot_par_profil is
  'Dernier jour collecté et volume par élève. Sert à dater la page Stats Clients sur '
  'l''élève le plus en retard, et à distinguer « en retard » de « jamais collecté ».';

-- L''agrégat balaie la table entière : sans index, c''est un Seq Scan à chaque
-- chargement de page.
create index if not exists idx_ads_profil_date_actifs
  on public.analytics_daily_snapshots (profile_id, date desc)
  where archived_at is null;
