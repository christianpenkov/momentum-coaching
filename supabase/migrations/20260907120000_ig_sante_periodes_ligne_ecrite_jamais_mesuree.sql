-- Complément indispensable à `20260907090000` : une ligne ÉCRITE mais JAMAIS MESURÉE
-- ne doit pas se lire « ok ».
--
-- ── Pourquoi ce cas apparaît maintenant ────────────────────────────────────
--
-- Le même jour, `poll-leads` change de conduite quand Meta ne sert rien : au lieu de
-- lever (et donc de rejouer l'appel à chaque synchro horaire du profil, ~24 fois par
-- jour), il inscrit la ligne de la période EN COURS avec des valeurs NULLES. C'est ce
-- qui arrête la boucle : la ligne existe, donc la règle de fraîcheur des 6 h
-- s'applique enfin.
--
-- Mais cette ligne porte un `mesure_le` frais. Sans ce correctif, la vue la lirait
-- « ok » — alors qu'aucune portée n'a jamais été mesurée pour cette période. On aurait
-- remplacé une fausse alerte par un ANGLE MORT, ce qui est strictement pire : la
-- fausse alerte se voyait.
--
-- ── La règle ────────────────────────────────────────────────────────────────
--
-- Les deux formes d'absence méritent le même délai de grâce, et la même alerte
-- ensuite :
--
--   * pas de ligne du tout          → « jamais mesurée »
--   * ligne présente, `reach_total` NULL → « écrite mais jamais mesurée »
--
-- Toutes deux graciées jusqu'à `D+2` (D = le jour où la période et l'intégration
-- existent toutes les deux), puis alertées. Le seuil est celui de la branche voisine.
--
-- ⚠️ `reach_total` est le bon témoin, et pas `reach_abonnes` : la ventilation par type
-- d'audience revient vide au-delà d'environ un an (mesuré le 2026-09-07 : 0 ligne de
-- ventilation à J-500, J-700, J-729), alors que `total_value.value` reste servi. Juger
-- sur la ventilation ferait donc alerter sur tout l'historique ancien, qui est
-- pourtant correctement mesuré.

create or replace view public.ig_sante_periodes
with (security_invoker = true) as
with attendu as (
  select
    i.profile_id,
    t.type,
    case t.type
      when 'semaine' then date_trunc('week',  (now() at time zone 'Europe/Paris'))::date
      when 'mois'    then date_trunc('month', (now() at time zone 'Europe/Paris'))::date
      else null::date
    end as debut_attendu,
    -- `first_connected_at` de préférence : il survit à une reconnexion, là où
    -- `connected_at` est réécrit et rouvrirait une grâce à chaque bascule OAuth.
    (coalesce(i.first_connected_at, i.connected_at) at time zone 'Europe/Paris')::date
      as depart_integration
  from integrations i
  cross join (values ('semaine'), ('mois'), ('all_time')) t(type)
  where i.provider = 'instagram' and i.status = 'ok'
)
select
  a.profile_id,
  a.type,
  a.debut_attendu,
  p.debut     as debut_trouve,
  p.mesure_le,
  round(extract(epoch from now() - p.mesure_le) / 3600.0, 1) as il_y_a_heures,
  case
    -- Trop jeune pour être jugée : Meta ne sert le seau d'une période qu'une fois
    -- qu'il a traité quelque chose pour elle, et on ne peut pas prédire quand.
    when (p.mesure_le is null or p.reach_total is null)
     and greatest(a.debut_attendu, a.depart_integration) is not null
     and (now() at time zone 'Europe/Paris')::date
         < greatest(a.debut_attendu, a.depart_integration) + 2
      then 'ok (période trop jeune pour être mesurable)'
    when p.mesure_le is null   then 'ALERTE période jamais mesurée'
    -- La ligne existe, le cron tourne, mais Meta n'a toujours rien servi.
    when p.reach_total is null then 'ALERTE période écrite mais jamais mesurée'
    when (now() - p.mesure_le) > interval '24 hours' then 'ALERTE période courante figée'
    else 'ok'
  end as etat,
  -- ⚠️ Ajoutée EN DERNIER, et pas à côté de `mesure_le` où sa place serait plus
  -- logique : `create or replace view` refuse d'insérer une colonne au milieu
  -- (« cannot change name of view column »). L'alternative serait un drop+create,
  -- qui perdrait l'ACL et re-accorderait `select` à `anon` par les privilèges par
  -- défaut du schéma. Une colonne mal placée coûte moins cher qu'une vue de santé
  -- rendue lisible sans session.
  p.reach_total
from attendu a
left join analytics_ig_periodes p
  on  p.profile_id  = a.profile_id
  and p.type        = a.type
  and p.archived_at is null
  and (a.debut_attendu is null or p.debut = a.debut_attendu);

-- Droits à l'identique : les vues de santé ne sont lisibles ni par `anon` ni par
-- `authenticated` (verrou du 2026-09-02).
revoke select on public.ig_sante_periodes from anon, authenticated;
