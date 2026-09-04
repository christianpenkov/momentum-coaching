-- Le plafond de STOCKAGE DE FICHIERS, distinct de celui de la base.
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ CE QUOTA N'ÉTAIT SURVEILLÉ PAR RIEN                                       │
-- │                                                                           │
-- │ `base_sante_taille` mesure la BASE (500 Mo sur le plan gratuit). Le        │
-- │ stockage de fichiers est un quota SÉPARÉ — 1 Go — partagé par les neuf     │
-- │ buckets du projet. Aucune vue ne le regardait.                             │
-- │                                                                           │
-- │ Ça devient critique le 2026-09-04 : Chris décide de stocker les messages   │
-- │ vocaux Instagram, que Meta refuse de servir après coup. Sans surveillance, │
-- │ le jour où le gigaoctet est plein, les envois échouent — en silence, comme │
-- │ toujours avec un plafond.                                                  │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- Mesuré le 2026-09-04, avant d'ajouter les vocaux : 27 Mo sur 1 Go, 111
-- fichiers répartis sur 9 buckets.
--
-- ⚠️ Vide quand tout va bien — mode `toute_ligne` de `/api/sante/alerte-vues`.
-- ⚠️ `security_invoker = true`, aucun `grant` : sinon `acces_sante_lecture`
--    la signalerait, à raison.

create or replace view public.stockage_fichiers_sante
with (security_invoker = true) as
with total as (
  select coalesce(sum((metadata->>'size')::bigint), 0) as octets,
         count(*) as fichiers
    from storage.objects
)
select
  case
    when octets >= 1024::bigint*1024*1024      then 'ALERTE plafond de stockage atteint'
    when octets >= 0.90 * 1024::bigint*1024*1024 then 'ALERTE stockage a plus de 90 %'
    when octets >= 0.70 * 1024::bigint*1024*1024 then 'ALERTE stockage a plus de 70 %'
  end::text as etat,
  pg_size_pretty(octets) as utilise,
  round(100.0 * octets / (1024::bigint*1024*1024), 1)::text || ' %' as part_du_plan_gratuit,
  fichiers::text as nb_fichiers,
  (select string_agg(b || ' ' || p, ' · ' order by o desc) from (
      select bucket_id as b, pg_size_pretty(sum((metadata->>'size')::bigint)) as p,
             sum((metadata->>'size')::bigint) as o
        from storage.objects group by bucket_id order by o desc limit 4
   ) x) as principaux_buckets
from total
where octets >= 0.70 * 1024::bigint*1024*1024;

comment on view public.stockage_fichiers_sante is
  'Le quota de FICHIERS (1 Go sur le plan gratuit), distinct de celui de la base que surveille base_sante_taille. Vide quand tout va bien. Devenu necessaire quand les messages vocaux Instagram ont commence a etre stockes : Meta refuse de les servir apres coup, donc on garde le fichier 30 jours.';
