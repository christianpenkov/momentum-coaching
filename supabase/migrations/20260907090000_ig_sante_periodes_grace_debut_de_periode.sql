-- `ig_sante_periodes` criait à chaque début de période, pour un état normal et inévitable.
--
-- ── Le symptôme ─────────────────────────────────────────────────────────────
--
-- E-mail reçu le lundi 2026-09-07 à 08h00 : « 3 lignes dans ig_sante_periodes »,
-- les trois profils connectés, type `semaine`, `debut_attendu = 2026-09-07`,
-- `debut_trouve = null`, état « ALERTE période jamais mesurée ». La semaine avait
-- commencé huit heures plus tôt.
--
-- ── La cause racine, mesurée contre l'API Meta et non déduite ────────────────
--
-- `mesurer()` (poll-leads) borne la fenêtre demandée à aujourd'hui. Le lundi, la
-- semaine en cours vaut donc `[aujourd'hui → aujourd'hui]` : une fenêtre qui ne
-- contient AUCUNE journée terminée. Meta répond `200` avec un corps sans
-- `total_value`, et l'écriture échoue.
--
-- Trois appels réels le 2026-09-07, avec témoin positif — c'est bien la présence
-- d'une journée TERMINÉE qui décide, ni la taille de la fenêtre, ni le fait que
-- `until` soit dans le futur :
--
--   [hier        → hier]        → total_value PRÉSENT
--   [aujourd'hui → aujourd'hui] → total_value ABSENT
--   [hier        → aujourd'hui] → total_value PRÉSENT
--
-- La ligne de la semaine ne PEUT donc pas exister son premier jour. Ce n'est pas
-- une panne à réparer, c'est une donnée qui n'existe pas encore chez Meta.
--
-- ── Pourquoi la vue le lisait comme une panne ───────────────────────────────
--
-- Elle a deux branches, et une seule portait l'intention de son auteur. La branche
-- « figée » attend 24 h ; la branche « jamais mesurée » n'attendait RIEN — elle
-- déclenchait à l'instant où `date_trunc('week', now())` bascule.
--
-- Le commentaire d'`estIncidentPassager` (poll-leads) dit d'ailleurs que cette vue
-- est le garde-fou censé rattraper les échecs `ig_periode*`, volontairement écartés
-- de `cron_runs`, « une période COURANTE qui cesse d'être rafraîchie pendant plus
-- de 24 h ». Les 24 h n'avaient jamais été appliquées à cette branche-ci.
--
-- Conséquence : une fausse alerte GARANTIE chaque lundi et chaque 1er du mois, soit
-- ~64 jours par an, pour chaque élève connecté. C'est-à-dire le début d'une alerte
-- qu'on n'ouvre plus — le mode de panne que ce projet combat partout ailleurs.
--
-- ── La correction ───────────────────────────────────────────────────────────
--
-- On ne juge pas un état tant qu'on n'a pas la preuve de l'avoir observé APRÈS
-- qu'il soit devenu observable. Même principe que `edge_sante_version`
-- (« en attente du prochain passage ») et que la marge de `migrations_sante`.
--
-- Soit `D = greatest(debut_attendu, depart_integration)`, le jour où la période ET
-- l'intégration existent toutes les deux. La première mesure possible est `D+1`
-- (la veille est alors terminée), et on accorde ensuite les mêmes 24 h que la
-- branche voisine : l'alerte ne part qu'à partir de `D+2`. D'où le `+ 2` ci-dessous.
--
-- ⚠️ `greatest` ignore les NULL, et c'est ce qui rend les trois types uniformes :
--   * `semaine` / `mois` : la plus tardive des deux dates — un élève qui connecte
--     un mercredi ne peut pas avoir mesuré la semaine dès le lundi ;
--   * `all_time` : `debut_attendu` est NULL, donc seule la date de connexion compte.
-- Si les deux sont NULL, `premier_jour_mesurable` est NULL et l'alerte part comme
-- avant : une ignorance ne doit pas fabriquer du silence.
--
-- ⚠️ **Cette grâce ne cache aucune panne durable, et c'est ce qui la rend
-- acceptable.** Les trois types sont surveillés pour le même profil. Si Meta tombe
-- vraiment, les lignes `mois` et `all_time` — qui existent déjà et sont rafraîchies
-- toutes les 6 h — cessent de l'être, et la branche « figée » alerte au bout de
-- 24 h. La branche corrigée ici n'est donc pas le seul détecteur ; elle était juste
-- le seul à se déclencher sur du normal.
--
-- ⚠️ La cause est traitée des DEUX côtés. Le même jour, `poll-leads` cesse de
-- demander à Meta une fenêtre sans journée terminée. Sans ça, l'échec se rejouait à
-- chaque passage — aucune ligne n'existant encore, la règle de fraîcheur des 6 h ne
-- pouvait pas freiner la relance : 81 appels Meta perdus entre minuit et 06h40 le
-- 2026-09-07, sur une trajectoire de 288 pour la journée, par profil. Faire taire
-- la vue sans corriger le cron aurait rendu ce gaspillage invisible au lieu de
-- l'arrêter.

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
    -- La période n'a pas encore pu être mesurée : Meta ne sert rien tant qu'elle
    -- ne contient aucune journée terminée. Rien à juger, donc rien à dire.
    when p.mesure_le is null
     and greatest(a.debut_attendu, a.depart_integration) is not null
     and (now() at time zone 'Europe/Paris')::date
         < greatest(a.debut_attendu, a.depart_integration) + 2
      then 'ok (période trop jeune pour être mesurable)'
    when p.mesure_le is null then 'ALERTE période jamais mesurée'
    when (now() - p.mesure_le) > interval '24 hours' then 'ALERTE période courante figée'
    else 'ok'
  end as etat
from attendu a
left join analytics_ig_periodes p
  on  p.profile_id  = a.profile_id
  and p.type        = a.type
  and p.archived_at is null
  and (a.debut_attendu is null or p.debut = a.debut_attendu);

-- Droits à l'identique : `anon` et `authenticated` n'ont PAS `select` sur les vues
-- de santé (verrou du 2026-09-02), et `security_invoker` est déclaré ci-dessus.
-- `create or replace view` les préserve — reposés explicitement pour que le fichier
-- décrive l'état complet, et non un delta qui dépend de ce qui existait avant.
revoke select on public.ig_sante_periodes from anon, authenticated;
