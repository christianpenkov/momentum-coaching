-- Click ID sur les liens Calendly PARTAGÉS (bio, description, story)
--
-- Un lien partagé n'identifie personne. Un rendez-vous venu de là ne pouvait donc
-- pas être relié au clic qui l'a produit : l'écran comparait « les clics de la
-- période » aux « calls de la période », deux ensembles qui ne se recouvrent pas.
-- Mesuré sur le profil de test : 5 calls sur 13 issus de liens partagés n'avaient
-- aucun clic antérieur enregistré, et les snapshots Short.io sont agrégés au JOUR,
-- donc inappariables à la minute.
--
-- Un identifiant unique par clic est désormais transmis à Calendly dans
-- `salesforce_uuid`, restitué par le webhook de réservation, et recopié sur le call.
--
-- ⚠️ Les liens de DM (`prospect_links`) ne sont PAS concernés : ils sont déjà
-- instrumentés par `first_click_at` et l'événement `link_clicked`.
--
-- Voir docs/click-id.md et lib/click-redirect.ts.

-- ── 1. Le journal des clics ─────────────────────────────────────────────────

create table if not exists public.link_clicks (
  -- Le Click ID lui-même. `text` et non `uuid` : la valeur revient de Calendly,
  -- qui la rend telle qu'elle a été figée au moment du clic — n'importe qui peut
  -- donc en fabriquer une à la main. Un type `uuid` ferait échouer la requête de
  -- rattachement sur une valeur malformée (22P02) au lieu de simplement ne rien
  -- trouver. La forme est validée côté code par `resolveClickId`.
  -- ≤ 255 caractères : limite d'une valeur de paramètre Calendly.
  id          text primary key check (length(id) between 1 and 255),
  profile_id  uuid        not null references public.profiles(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  -- Chemin Short.io cliqué (`bio-calendly-ig`, `prendre-rdv-3457`…). Sert à
  -- rapprocher ce compteur de celui de Short.io dans la vue de santé.
  link_path   text        not null,
  platform    text,       -- 'ig' | 'yt', jamais une valeur hors nomenclature
  medium      text,       -- 'bio' | 'description' | 'story'
  content_id  text,       -- id de post, de vidéo ou de séquence — vide pour la bio
  -- Robot d'aperçu de lien (Instagram, WhatsApp, Slack…). MARQUÉ, jamais jeté :
  -- sans la ligne, on ne pourrait ni mesurer le bruit ni expliquer un écart avec
  -- le compteur de Short.io.
  is_bot      boolean     not null default false,
  -- Empreinte salée de l'IP — **l'IP brute n'est jamais écrite**. Sert seulement à
  -- repérer les doubles déclenchements des navigateurs intégrés. Le sel change
  -- chaque jour : l'empreinte n'est pas comparable d'un jour à l'autre, donc elle
  -- ne permet pas de reconstituer un visiteur. Ce n'est pas le but.
  ip_hash     text
);

comment on table public.link_clicks is
  'Un clic sur un lien Calendly PARTAGÉ (bio / description / story). Purgée à 400 jours par purge_link_clicks() : au moment de la réservation, le webhook recopie click_id et clicked_at sur le call, donc la ligne devient jetable sans jamais perdre une attribution.';

create index if not exists link_clicks_profil_date_idx
  on public.link_clicks (profile_id, occurred_at desc);

-- Même modèle que `cron_runs` et `alertes_plateforme` : RLS active, aucune
-- policy. Seule la clé de service écrit, et aucun écran ne lit cette table
-- directement — les stats lisent `calls.click_id`.
alter table public.link_clicks enable row level security;

-- ── 2. L'attribution recopiée sur le rendez-vous ────────────────────────────

-- Recopier click_id et clicked_at sur le call au moment de la réservation est ce
-- qui rend la purge sans perte : la ligne de clic ne porte plus rien d'unique
-- une fois le rendez-vous pris.
alter table public.calls add column if not exists click_id   text;
alter table public.calls add column if not exists clicked_at timestamptz;

comment on column public.calls.click_id is
  'Identifiant du clic qui a produit ce rendez-vous, pour les liens PARTAGÉS. Nommé click_id et non salesforce_uuid : le nom décrit ce que la donnée est, pas le champ Calendly qui l''a transportée. Hérité tel quel lors d''une reprogrammation.';
comment on column public.calls.clicked_at is
  'Horodatage du clic à l''origine du rendez-vous, recopié depuis link_clicks. Rend le taux clic → call exact au lieu d''une comparaison de deux périodes.';

-- ⚠️ **Volontairement AUCUNE contrainte d'unicité sur `calls.click_id`.**
--
-- Une reprogrammation fait hériter l'attribution du premier contact : l'ancien
-- rendez-vous passe en `canceled` et le nouveau reçoit le même `click_id`. Deux
-- lignes portent donc légitimement le même clic, et une unicité les refuserait.
--
-- La restreindre aux rendez-vous actifs a été écarté aussi : les trois chemins
-- d'écriture (webhook, sync-calendly, calendly-fetch) annulent l'ancien avant
-- d'insérer le nouveau, mais une course entre deux d'entre eux ferait échouer
-- l'upsert — donc **perdre une réservation** pour protéger un invariant de
-- confort. Le funnel passe avant.
--
-- Ce que la contrainte aurait attrapé se vérifie à la demande, sans rien risquer :
--   select click_id, count(*) from calls
--    where click_id is not null and status <> 'canceled' and ignored is not true
--    group by 1 having count(*) > 1;

-- ── 3. Purge automatique, 400 jours ─────────────────────────────────────────

-- En pg_cron plutôt que sur un planificateur externe : c'est du SQL pur, aucune
-- URL, donc rien à exposer sur Internet et rien qui dépende d'un compte tiers.
-- Même raisonnement que les quatre purges existantes (voir AGENTS.md).
create or replace function public.purge_link_clicks()
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $$
declare n bigint;
begin
  -- 400 jours : au-delà d'un an, un clic qui n'a produit aucune réservation
  -- n'apprend plus rien. Ceux qui en ont produit une ont déjà été recopiés sur
  -- le call (click_id + clicked_at), donc aucune attribution n'est perdue.
  delete from public.link_clicks
   where occurred_at < now() - interval '400 days';
  get diagnostics n = row_count;
  return n;
end;
$$;

-- 3h40 : le seul créneau libre entre purge-webhook-queue (3h35) et
-- purge-call-rapport-drafts (3h45).
select cron.unschedule('purge-link-clicks-daily')
 where exists (select 1 from cron.job where jobname = 'purge-link-clicks-daily');
select cron.schedule('purge-link-clicks-daily', '40 3 * * *', 'select public.purge_link_clicks();');

-- ── 4. Vue de santé à deux compteurs ────────────────────────────────────────

-- Short.io compte les clics de son côté, la route `/r/` les compte du sien. Une
-- divergence durable signifie que la route est cassée, ou qu'un lien Short.io
-- pointe encore droit sur Calendly. Le second compteur existe déjà : la vue ne
-- coûte rien.
--
-- ⚠️ Cette vue détecte une PANNE, pas une parité exacte, et c'est délibéré :
-- Short.io applique son propre filtre à robots, la route applique le sien, les
-- deux ne classeront jamais identiquement. Prétendre à l'égalité produirait une
-- alerte permanente que personne ne regarderait plus.
--
-- ⚠️ `etat <> 'ok'` n'est PAS un filtre d'anomalie — même convention que
-- yt_sante_donnees et integrations_sante. « lien non redirige » dit seulement
-- que la réécriture n'a pas encore atteint ce lien, ce qui est normal pendant la
-- fenêtre de migration.
--
-- Deux choix de périmètre, tous deux nécessaires pour que la vue puisse un jour
-- afficher « ok partout » :
--
--  1. Le périmètre se lit sur `original_url`, PAS sur `link_category`. Cette
--     colonne porte la catégorie figée au moment du snapshot : de vieux liens
--     lead magnet y sont classés `calendly_story`, et ils ne seront jamais
--     réécrits. S'y fier laisserait une queue de lignes en alerte permanente.
--     La destination réelle, elle, dit sans ambiguïté de quoi il s'agit.
--
--  2. La comparaison ne porte que sur les journées où le lien était DÉJÀ réécrit
--     (`original_url` de CETTE journée). Sans ça, chaque lien passerait 30 jours
--     en alerte après sa réécriture, à cause des journées d'avant — où l'absence
--     de ligne de clic était parfaitement normale.
drop view if exists public.clics_sante_redirection;
create view public.clics_sante_redirection as
with jours as (
  select
    s.profile_id,
    s.path              as link_path,
    s.date              as jour,
    max(s.human_clicks) as clics_shortio,
    -- Ce jour-là, le lien passait-il déjà par la route ?
    bool_or(s.original_url like '%/r/%') as redirige_ce_jour
  from public.shortio_link_daily_snapshots s
  where (
          s.original_url like '%/r/%'
          -- …ou lien Calendly partagé pas encore réécrit. `dm` est exclu : les
          -- liens de prospect sont déjà instrumentés par prospect_links.
          or (s.original_url like 'https://calendly.com/%'
              and substring(s.original_url from 'utm_medium=([a-z]+)')
                  in ('bio', 'description', 'story'))
        )
    -- La journée en cours est incomplète des deux côtés : la comparer ferait
    -- clignoter la vue tous les jours sans rien apprendre.
    and s.date between current_date - 30 and current_date - 1
  group by s.profile_id, s.path, s.date
), route as (
  select
    c.profile_id,
    c.link_path,
    -- Même règle de journée que le snapshot Short.io : un clic appartient au jour
    -- PARIS de son horodatage (cf. lib/shortio-clicks.ts). Comparer un jour UTC à
    -- un jour Paris décalerait deux heures de clics chaque nuit.
    (timezone('Europe/Paris', c.occurred_at))::date as jour,
    count(*) filter (where not c.is_bot) as clics_route,
    count(*) filter (where c.is_bot)     as clics_robots
  from public.link_clicks c
  where c.occurred_at >= (current_date - 31)
  group by 1, 2, 3
), apparie as (
  select
    j.profile_id, j.link_path, j.jour, j.redirige_ce_jour, j.clics_shortio,
    coalesce(r.clics_route, 0)  as clics_route,
    coalesce(r.clics_robots, 0) as clics_robots
  from jours j
  left join route r
    on r.profile_id = j.profile_id
   and r.link_path  = j.link_path
   and r.jour       = j.jour
)
-- Une ligne par lien, pas par lien et par jour : la vue se lit d'un coup d'œil,
-- comme yt_sante_donnees. Le détail par jour reste dans `jours_sans_route`, qui
-- compte les journées où Short.io a vu des clics et la route aucun.
select
  profile_id,
  link_path,
  bool_or(redirige_ce_jour)                                   as redirige,
  sum(clics_shortio) filter (where redirige_ce_jour)::bigint  as clics_shortio_30j,
  sum(clics_route)   filter (where redirige_ce_jour)::bigint  as clics_route_30j,
  sum(clics_robots)  filter (where redirige_ce_jour)::bigint  as clics_robots_30j,
  count(*) filter (where redirige_ce_jour and clics_shortio > 0 and clics_route = 0)::bigint
                                                              as jours_sans_route,
  max(jour) filter (where clics_route > 0)                    as dernier_jour_avec_clic_route,
  case
    when not bool_or(redirige_ce_jour) then 'lien non redirige'
    when coalesce(sum(clics_shortio) filter (where redirige_ce_jour), 0) = 0 then 'ok'
    when coalesce(sum(clics_route)   filter (where redirige_ce_jour), 0) = 0
         then 'ALERTE : route sans clic'
    when coalesce(sum(clics_route)   filter (where redirige_ce_jour), 0) * 2
       < coalesce(sum(clics_shortio) filter (where redirige_ce_jour), 0)
         then 'ALERTE : ecart important'
    else 'ok'
  end as etat
from apparie
group by profile_id, link_path;

comment on view public.clics_sante_redirection is
  'Compare, par lien, les clics humains comptés par Short.io à ceux comptés par la route /r/, sur les seules journées où le lien passait déjà par la route. Doit être ''ok'' partout. ''lien non redirige'' n''est PAS une anomalie : la réécriture n''a pas encore atteint ce lien.';

-- ── 5. La nouvelle table entre dans la surveillance du plafond de stockage ───

-- Sans ça, `base_sante_taille` sous-estimerait la croissance et l'alerte e-mail
-- partirait trop tard : la vue ne mesure QUE les tables qu'on lui a nommées.
-- Une table qui grossit sans être comptée est exactement le genre de trou que
-- cette vue existe pour fermer.
create or replace view public.base_sante_taille as
with lignes_par_jour as (
  select
    coalesce((select count(*)::numeric / nullif(count(distinct snapshot_date), 0)::numeric
                from analytics_ig_posts_history
               where snapshot_date > current_date - 7), 0) as ig_posts,
    coalesce((select count(*)::numeric / nullif(count(distinct snapshot_date), 0)::numeric
                from analytics_yt_videos_history
               where snapshot_date > current_date - 7), 0) as yt_videos,
    coalesce((select count(*)::numeric / nullif(count(distinct snapshot_date), 0)::numeric
                from analytics_ig_stories_history
               where snapshot_date > current_date - 7), 0) as ig_stories,
    coalesce((select count(*)::numeric
                     / nullif(count(distinct (timezone('Europe/Paris', occurred_at))::date), 0)::numeric
                from link_clicks
               where occurred_at > now() - interval '7 days'), 0) as link_clicks
), poids as (
  select
    coalesce((select pg_total_relation_size(c.oid::regclass)::numeric / nullif(s.n_live_tup, 0)::numeric
                from pg_class c join pg_stat_user_tables s on s.relid = c.oid
               where c.relname = 'analytics_ig_posts_history'), 0) as o_ig_posts,
    coalesce((select pg_total_relation_size(c.oid::regclass)::numeric / nullif(s.n_live_tup, 0)::numeric
                from pg_class c join pg_stat_user_tables s on s.relid = c.oid
               where c.relname = 'analytics_yt_videos_history'), 0) as o_yt_videos,
    coalesce((select pg_total_relation_size(c.oid::regclass)::numeric / nullif(s.n_live_tup, 0)::numeric
                from pg_class c join pg_stat_user_tables s on s.relid = c.oid
               where c.relname = 'analytics_ig_stories_history'), 0) as o_ig_stories,
    coalesce((select pg_total_relation_size(c.oid::regclass)::numeric / nullif(s.n_live_tup, 0)::numeric
                from pg_class c join pg_stat_user_tables s on s.relid = c.oid
               where c.relname = 'link_clicks'), 0) as o_link_clicks
), calcul as (
  select
    pg_database_size(current_database())::numeric as octets,
    l.ig_posts * p.o_ig_posts
      + l.yt_videos * p.o_yt_videos
      + l.ig_stories * p.o_ig_stories
      + l.link_clicks * p.o_link_clicks as octets_par_jour
  from lignes_par_jour l, poids p
)
select
  pg_size_pretty(octets::bigint)                              as taille_actuelle,
  pg_size_pretty(greatest(octets_par_jour, 0)::bigint)        as croissance_par_jour,
  case when octets_par_jour > 0
       then floor((500::numeric * 1024 * 1024 - octets) / octets_par_jour)::integer end
                                                              as jours_restants_plan_gratuit,
  case when octets_par_jour > 0
       then floor((8192::numeric * 1024 * 1024 - octets) / octets_par_jour)::integer end
                                                              as jours_restants_plan_pro,
  case
    when octets >= 500::numeric * 1024 * 1024 then 'plafond gratuit atteint'
    when octets_par_jour > 0
     and (500::numeric * 1024 * 1024 - octets) / octets_par_jour < 60
                                              then 'moins de 60 jours sur le plan gratuit'
    else 'ok'
  end                                                         as etat
from calcul;
