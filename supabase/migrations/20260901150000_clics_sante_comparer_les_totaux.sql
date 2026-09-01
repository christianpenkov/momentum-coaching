-- La vue cesse de comparer les humains : elle compare les totaux
--
-- Elle confrontait notre compte d'humains a celui de Short.io, pour detecter un filtre
-- a robots trop laxiste. Impasse.
--
-- La raison n'est PAS que le filtre est bon. Il ne l'est pas : sur un tap depuis la bio
-- Instagram, une partie de la flotte de prechargement passe pour humaine, faute de se
-- distinguer par son User-Agent. La raison est que cette erreur ne fausse rien.
--
-- Recherche de tous les lecteurs de link_clicks : le webhook Calendly, calendly-fetch,
-- sync-calendly — tous pour retrouver le clic d'une reservation a partir de son
-- click_id — plus cette vue et le calcul de taille. AUCUN chiffre affiche dans le
-- produit ne vient de link_clicks : tous les « clics » des ecrans viennent des
-- snapshots Short.io. Une ligne de robot n'entre donc dans aucune statistique, et le
-- seul consommateur de is_bot etait la vue elle-meme.
--
-- On aurait entretenu une heuristique a regler indefiniment — Instagram changeant sa
-- flotte quand il veut — uniquement pour faire tomber d'accord deux surveillants.
-- Aucun utilisateur n'aurait vu la difference.
--
-- Les totaux, eux, concordent une fois le double comptage du writer corrige : 15/15 sur
-- la bio, 4/4 sur YouTube. Et un ecart de totaux ne veut plus dire qu'une seule chose,
-- la route ne repond plus — la seule panne qui merite une alerte.
--
-- is_bot et bot_motif restent ecrits et restent utiles : ils expliquent une ligne quand
-- on l'interroge. Ils ne jugent plus rien.

drop view if exists public.clics_sante_redirection;
create view public.clics_sante_redirection as
with aujourdhui as (
  -- UNE seule notion d'« aujourd'hui », en heure de Paris comme les deux compteurs.
  select (timezone('Europe/Paris', now()))::date as jour
), jours as (
  select
    s.profile_id, s.path as link_path, s.date as jour,
    max(s.total_clicks) as clics_shortio,
    -- ⚠️ Ne dit PAS « ce jour-la le lien etait reecrit » mais « la derniere fois que
    -- cette ligne a ete touchee, il l'etait » : poll-leads reecrit les journees de sa
    -- fenetre de rattrapage avec la destination COURANTE. Utilisable dans un seul
    -- sens — `false` prouve que la ligne precede la reecriture.
    bool_or(s.original_url like '%/r/%') as redirige_derniere_ecriture
  from public.shortio_link_daily_snapshots s, aujourdhui a
  where (
          s.original_url like '%/r/%'
          or (s.original_url like 'https://calendly.com/%'
              and substring(s.original_url from 'utm_medium=([a-z]+)') in ('bio', 'description', 'story'))
        )
    -- La journee en cours est incomplete des deux cotes.
    and s.date between a.jour - 30 and a.jour - 1
    -- ⚠️ Ne juger que la ligne du PROPRIETAIRE : sur un domaine partage, chaque profil
    -- ecrit sa propre ligne alors que la route n'attribue le clic qu'a un seul. La
    -- destination reecrite NOMME son proprietaire dans `p`.
    and (
      s.original_url !~ 'p=[0-9a-f-]{36}'
      or substring(s.original_url from 'p=([0-9a-f-]{36})') = s.profile_id::text
    )
  group by s.profile_id, s.path, s.date
), borne as (
  select profile_id, link_path,
         max(jour) filter (where not redirige_derniere_ecriture) as dernier_jour_direct
  from jours group by profile_id, link_path
), route as (
  select
    c.profile_id, c.link_path,
    (timezone('Europe/Paris', c.occurred_at))::date as jour,
    count(*)                         as clics_route,
    -- Conserve pour information seulement : plus aucun etat ne s'en sert.
    count(*) filter (where c.is_bot) as clics_robots
  from public.link_clicks c, aujourdhui a
  where c.occurred_at >= (a.jour - 31)
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
    on r.profile_id = j.profile_id and r.link_path = j.link_path and r.jour = j.jour
), totaux as (
  select
    profile_id, link_path,
    bool_or(comparable) as redirige,
    coalesce(sum(clics_shortio) filter (where comparable), 0)::bigint as shortio,
    coalesce(sum(clics_route)   filter (where comparable), 0)::bigint as route,
    coalesce(sum(clics_robots)  filter (where comparable), 0)::bigint as robots,
    count(*) filter (where comparable and clics_shortio > 0 and clics_route = 0)::bigint as jours_sans_route,
    max(jour) filter (where clics_route > 0) as dernier_jour_avec_clic_route
  from apparie group by profile_id, link_path
)
select
  profile_id, link_path, redirige,
  shortio as clics_shortio_30j,
  route   as clics_route_30j,
  robots  as clics_robots_30j,
  jours_sans_route,
  dernier_jour_avec_clic_route,
  case
    when not redirige        then 'lien non redirige'
    when shortio = 0         then 'ok'
    when route = 0           then 'ALERTE : route sans clic'
    -- Les deux compteurs ne tomberont jamais parfaitement d'accord (une requete perdue,
    -- un 302 non suivi) : la moitie laisse passer ce bruit sans laisser passer une
    -- route muette.
    when route * 2 < shortio then 'ALERTE : ecart important'
    else 'ok'
  end as etat
from totaux;

comment on view public.clics_sante_redirection is
  'Compare les TOTAUX de requetes comptees par Short.io et par la route /r/. Ne compare PAS les humains : aucun chiffre affiche dans le produit ne vient de link_clicks, donc une ligne de robot ne fausse rien, et faire concorder deux filtres a robots serait un reglage sans fin pour personne. is_bot et bot_motif restent une INFORMATION, pas un juge. Un ecart de totaux ne signifie plus qu une chose : la route ne repond plus.';
