-- 1. Le verdict de détection de robot doit pouvoir s'expliquer
-- 2. La vue de santé ne savait détecter qu'une sous-détection, pas une sur-détection
--
-- Mesuré le 2026-09-01 sur `bio-calendly-ig`, en confrontant les deux compteurs :
--
--   jour        total Short.io  total route   humains Short.io  humains route
--   2026-08-31        1              1               1                1
--   2026-09-01       15             15               2                8
--
-- Les TOTAUX concordent à la ligne près : c'est le même trafic, et les journées sont
-- alignées des deux côtés (règle Paris de docs/fuseaux-horaires.md, respectée par la
-- vue). Ce sont les CLASSIFICATIONS qui divergent — le filtre à robots laisse passer
-- 6 préchargements d'Instagram pour des humains, faute de pouvoir les distinguer par
-- leur User-Agent.
--
-- Deux manques que cet incident a révélés, et qui sont corrigés ici.

-- ── 1. Un instrument doit pouvoir expliquer son propre verdict ──────────────
--
-- `is_bot` enregistrait une conclusion sans rien de ce sur quoi elle reposait :
-- impossible de vérifier après coup POURQUOI une ligne était passée pour humaine.
-- La colonne dit désormais quelle règle a tranché.
--
-- ⚠️ **Aucun backfill.** Les lignes antérieures restent à `null`, qui veut dire « on
-- ne sait pas » — c'est la vérité. `'aucune'` est réservé aux lignes écrites depuis
-- cette colonne et sur lesquelles aucune règle n'a déclenché ; confondre les deux
-- ferait croire à un diagnostic là où il n'y en a jamais eu.
alter table public.link_clicks add column if not exists bot_motif text
  check (bot_motif in ('prefetch', 'ua_robot', 'sans_ua', 'aucune'));

comment on column public.link_clicks.bot_motif is
  'Quelle regle a conclu au robot : prefetch (en-tete Sec-Purpose), ua_robot (User-Agent), sans_ua, ou aucune (juge humain). NULL = ligne anterieure a la colonne, verdict inexplicable. Jamais backfille.';

-- ── 2. Le juge ne regardait que dans un sens ────────────────────────────────
--
-- La vue signalait « route < Short.io » — le symptôme d'une route cassée ou d'un lien
-- non réécrit. Elle ne disait rien de « route > Short.io », qui est le symptôme d'un
-- filtre à robots trop laxiste. Sur le cas mesuré, elle affichait `ok` avec 8 humains
-- comptés contre 2.
--
-- Or c'est précisément ce sens-là qui rend le garde-fou utile : Short.io classe le
-- MÊME trafic, indépendamment de nous et sans que ça coûte un appel. Un écart durable
-- entre les deux comptes est un meilleur juge que n'importe quelle heuristique qu'on
-- écrirait soi-même — et sûrement meilleur qu'un durcissement sur l'adresse IP, qui
-- décrirait une flotte aujourd'hui et un lien qui marche demain.
--
-- Aucun des deux n'est la vérité : le filtre de Short.io et le nôtre ne classeront
-- jamais identiquement. La vue ne tranche donc pas qui a raison, elle signale une
-- divergence DURABLE — d'où le seuil, qui laisse passer le bruit ordinaire.
drop view if exists public.clics_sante_redirection;
create view public.clics_sante_redirection as
with jours as (
  select
    s.profile_id,
    s.path              as link_path,
    s.date              as jour,
    max(s.human_clicks) as clics_shortio,
    -- ⚠️ Ne dit PAS « ce jour-là le lien était réécrit ». Dit « la dernière fois que
    -- cette ligne a été touchée, le lien était réécrit » : poll-leads réécrit les
    -- journées de sa fenêtre de rattrapage avec la destination COURANTE. Utilisable
    -- dans un seul sens — `false` prouve que la ligne précède la réécriture.
    bool_or(s.original_url like '%/r/%') as redirige_derniere_ecriture
  from public.shortio_link_daily_snapshots s
  where (
          s.original_url like '%/r/%'
          or (s.original_url like 'https://calendly.com/%'
              and substring(s.original_url from 'utm_medium=([a-z]+)')
                  in ('bio', 'description', 'story'))
        )
    and s.date between current_date - 30 and current_date - 1
  group by s.profile_id, s.path, s.date
), borne as (
  select profile_id, link_path,
         max(jour) filter (where not redirige_derniere_ecriture) as dernier_jour_direct
  from jours group by profile_id, link_path
), route as (
  select
    c.profile_id,
    c.link_path,
    -- Un clic appartient au jour PARIS de son horodatage, des deux côtés
    -- (docs/fuseaux-horaires.md, et lib/shortio-clicks.ts pour le snapshot).
    -- Vérifié le 2026-09-01 : les totaux concordent jour par jour.
    (timezone('Europe/Paris', c.occurred_at))::date as jour,
    count(*) filter (where not c.is_bot) as clics_route,
    count(*) filter (where c.is_bot)     as clics_robots
  from public.link_clicks c
  where c.occurred_at >= (current_date - 31)
  group by 1, 2, 3
), apparie as (
  select
    j.profile_id, j.link_path, j.jour, j.clics_shortio,
    coalesce(r.clics_route, 0)  as clics_route,
    coalesce(r.clics_robots, 0) as clics_robots,
    (j.redirige_derniere_ecriture
       and (b.dernier_jour_direct is null or j.jour > b.dernier_jour_direct)) as comparable
  from jours j
  join borne b on b.profile_id = j.profile_id and b.link_path = j.link_path
  left join route r
    on r.profile_id = j.profile_id
   and r.link_path  = j.link_path
   and r.jour       = j.jour
), totaux as (
  select
    profile_id,
    link_path,
    bool_or(comparable)                                     as redirige,
    coalesce(sum(clics_shortio) filter (where comparable), 0)::bigint as shortio,
    coalesce(sum(clics_route)   filter (where comparable), 0)::bigint as route,
    coalesce(sum(clics_robots)  filter (where comparable), 0)::bigint as robots,
    count(*) filter (where comparable and clics_shortio > 0 and clics_route = 0)::bigint
                                                            as jours_sans_route,
    max(jour) filter (where clics_route > 0)                as dernier_jour_avec_clic_route
  from apparie
  group by profile_id, link_path
)
select
  profile_id, link_path, redirige,
  shortio                      as clics_shortio_30j,
  route                        as clics_route_30j,
  robots                       as clics_robots_30j,
  jours_sans_route,
  dernier_jour_avec_clic_route,
  case
    when not redirige                    then 'lien non redirige'
    when shortio = 0 and route = 0       then 'ok'
    -- Sous-détection : la route ne voit pas des clics que Short.io voit.
    when route = 0 and shortio > 0       then 'ALERTE : route sans clic'
    when route * 2 < shortio             then 'ALERTE : ecart important'
    -- Sur-détection : on compte des humains que Short.io classe robots. Seuil
    -- volontairement large (le double + 3) : les deux filtres ne s'accorderont
    -- jamais exactement, et une alerte qui se déclenche sur du bruit ordinaire
    -- cesse d'être lue.
    when route > shortio * 2 + 3         then 'ALERTE : robots comptes humains'
    else 'ok'
  end as etat
from totaux;

comment on view public.clics_sante_redirection is
  'Compare, par lien, notre compte de clics humains a celui de Short.io — une classification tierce et independante du meme trafic. Alerte dans LES DEUX SENS : route sans clic (route cassee ou lien non reecrit) et robots comptes humains (filtre trop laxiste). Ne juge que les journees posterieures au dernier jour ou la destination etait encore directe. lien non redirige n est PAS une anomalie.';
