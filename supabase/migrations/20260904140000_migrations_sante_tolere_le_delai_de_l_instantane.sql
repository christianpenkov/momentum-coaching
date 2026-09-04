-- On ne juge pas une migration que l'instantané du dépôt n'a pas pu voir
--
-- ⚠️ CINQ FAUSSES ALERTES LE 2026-09-04, le lendemain de la mise en place. Mesurées, pas
-- supposées : les quatre migrations signalées « appliquée sans fichier » avaient bel et
-- bien leur fichier, commité, au nom exact. Et `edge_sante_version` criait sur
-- `poll-leads` alors que la fonction en ligne remontait `3525d1d294766fe6`, c'est-à-dire
-- exactement ce que le dépôt dit au HEAD.
--
-- ── La cause, et elle est de conception ────────────────────────────────────────────
--
-- Ces deux surveillances comparent un état VIVANT — ce qui tourne, ce qui est appliqué —
-- à un INSTANTANÉ du dépôt. La base ne peut pas lire le dépôt : seule
-- `/api/sante/alerte-vues` sait écrire cet instantané, et elle ne passait qu'une fois par
-- jour, à 8 h. Tout ce qui bougeait ensuite — un déploiement, une migration — faisait
-- donc crier les vues jusqu'au lendemain matin.
--
-- L'e-mail, lui, ne se trompait pas : la route réécrit l'instantané AVANT de lire les
-- vues, et cet ordre avait été choisi exprès. Mais **une vue qui ment en journée finit
-- par ne plus être ouverte**, et c'est précisément le mode de panne que ces surveillances
-- existent pour fermer.
--
-- ── Les deux moitiés du correctif ──────────────────────────────────────────────────
--
-- 1. `poll-leads` rafraîchit l'instantané **une fois par heure** (`?manifeste=1` : aucune
--    lecture de vue, aucun e-mail). La fenêtre passe de 24 heures à une heure.
-- 2. Ce fichier : dans l'heure restante, une migration appliquée APRÈS la prise de
--    l'instantané n'est pas jugeable. On ne la signale donc pas — au lieu d'affirmer une
--    absence qu'on n'a pas pu constater.
--
-- ⚠️ La seconde moitié ne remplace pas la première : sans le rafraîchissement horaire,
-- la tolérance rendrait la vue AVEUGLE à tout ce qui arrive après 8 h — le contraire du
-- but. Les deux vont ensemble.
--
-- ⚠️ Et l'instantané lui-même devient surveillé. Une vue qui se tait parce que son
-- instantané est mort ne dit pas « tout va bien », elle dit « je ne sais pas » — sans le
-- dire. La troisième branche rend cette panne visible, avec le seuil du projet : environ
-- quatre cadences, jamais moins de deux heures.
--
-- ⚠️ La borne `>= '20260901000000'` et celle de la seconde branche restent inchangées :
-- leur motif est dans `20260903200000_migrations_sante.sql`, chacune posée là où la
-- mesure montrait zéro faux positif sur l'arriéré de 185 migrations sans fichier.

create or replace view public.migrations_sante as
with instantane as (
  select max(mis_a_jour_le) as pris_le from public.migrations_du_depot
),
appliquees as (
  select version, name as nom from supabase_migrations.schema_migrations
),
fichiers as (
  select version, nom from public.migrations_du_depot
)
select
  a.nom,
  a.version                             as version_appliquee,
  null::text                            as version_fichier,
  'ALERTE appliquee sans fichier'::text as anomalie
from appliquees a, instantane i
where a.version >= '20260901000000'
  -- ⚠️ Le cœur du correctif : l'instantané ne peut rien dire d'un fichier écrit après
  -- qu'il a été pris. `version` est un horodatage UTC en `YYYYMMDDHH24MISS`, comme celui
  -- que produit `to_char` ci-dessous — les deux se comparent donc en texte.
  and i.pris_le is not null
  and a.version < to_char(i.pris_le at time zone 'UTC', 'YYYYMMDDHH24MISS')
  and not exists (select 1 from fichiers f where f.nom = a.nom)

union all

select
  f.nom,
  null::text,
  f.version,
  'ALERTE fichier jamais applique'::text
from fichiers f
where f.version >= '20260903200000'
  and not exists (select 1 from appliquees a where a.nom = f.nom)

union all

-- L'instrument se surveille lui-même : sans instantané frais, les deux branches
-- ci-dessus se taisent, et leur silence ne prouverait plus rien.
select
  'instantane du depot'::text,
  null::text,
  coalesce(to_char((select pris_le from instantane), 'YYYY-MM-DD HH24:MI'), 'jamais'),
  'ALERTE instantane du depot perime — la route ne le rafraichit plus'::text
from instantane i
where i.pris_le is null or i.pris_le < now() - interval '4 hours';

comment on view public.migrations_sante is
  'Vide = le depot et la base racontent la meme histoire recente. La cle de rapprochement '
  'est le NOM : celui passe a apply_migration doit etre exactement celui du fichier. '
  '⚠️ Une migration appliquee APRES la derniere prise de l''instantane n''est pas jugee — '
  'l''instantane n''a pas pu voir son fichier. `poll-leads` le rafraichit toutes les '
  'heures via /api/sante/alerte-vues?manifeste=1 ; si ce rafraichissement s''arrete, la '
  'vue le dit elle-meme au bout de 4 heures au lieu de se taire.';

revoke select on public.migrations_sante from anon, authenticated;
grant select on public.migrations_sante to service_role;
