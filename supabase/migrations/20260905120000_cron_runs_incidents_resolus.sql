-- Un incident CORRIGÉ empêchait toute alerte sur les 30 jours suivants.
--
-- ── Le défaut, et il est pire que l'alerte qu'il produit ───────────────────────────
--
-- `cron_runs` a pour contrat « vide = aucun incident », et `/api/sante/alerte-vues` la
-- surveille en mode `toute_ligne`. Le garde anti-répétition n'envoie l'e-mail qu'UNE
-- fois par clé, et ne se réarme **que lorsque la vue redevient propre**.
--
-- Or cette table ne se purge qu'à 30 jours. Donc une ligne dont la CAUSE est déjà
-- corrigée garde l'alerte « déjà envoyée » pendant un mois entier :
--
--     un NOUVEL échec de cron, différent, dans cette fenêtre → AUCUN e-mail.
--
-- Une alerte qui ne peut plus partir est pire que celle qu'on a reçue. Et ce n'est pas
-- une hypothèse : le 2026-09-04 à 21:38, `purger-vocaux` a échoué sur
-- `lecture: Invalid schema: storage` ; la cause a été corrigée le lendemain (commit
-- 5c20ceb, la lecture passe désormais par la fonction `vocaux_ig_a_purger` au lieu de
-- `supa.schema('storage')`, que PostgREST n'expose pas). L'e-mail du 05/09 08:00 portait
-- donc sur un problème déjà réglé — et il aurait été le DERNIER jusqu'au 4 octobre.
--
-- ── Pourquoi une résolution explicite, et pas une purge plus courte ────────────────
--
-- Raccourcir la rétention effacerait la trace d'un incident RÉEL non corrigé aussi vite
-- que celle d'un incident réglé. La table doit garder les deux ; c'est la SURVEILLANCE
-- qui doit distinguer.
--
-- ⚠️ Et surtout : on ne supprime pas la ligne. Effacer la preuve d'un incident pour
-- faire taire une alerte est exactement le geste que ce projet interdit ailleurs
-- (« la supprimer à la main serait le même geste que d'insérer une ligne au registre »).
-- On l'annote, elle reste lisible, et `cron_runs` continue de raconter l'histoire
-- complète des 30 derniers jours.
--
-- ⚠️ Pourquoi pas une résolution AUTOMATIQUE : la tentation serait de considérer un
-- incident réglé dès que le cron repasse. Mais `marquer_passage_cron` est appelé au
-- DÉBUT d'un run — un passage prouve l'invocation, jamais le succès. Et `purger-vocaux`
-- n'est même pas inscrit dans `crons_passages`. Une résolution automatique fondée
-- là-dessus effacerait des incidents encore vivants.
--
-- Marquer résolu fait donc partie du geste de CORRECTION, au moment où quelqu'un sait
-- pourquoi c'est réglé — pas d'une tâche récurrente.

alter table public.cron_runs
  add column if not exists resolu_le   timestamptz,
  add column if not exists resolu_note text;

comment on column public.cron_runs.resolu_le is
  'Renseignée quand la CAUSE de l''incident est corrigée. La ligne reste en base — on '
  'n''efface jamais la trace d''un incident — mais elle sort de `cron_runs_actifs`, donc '
  'de la surveillance. Sans ça, un incident deja regle gardait l''alerte « deja '
  'envoyee » pendant 30 jours et un NOUVEL echec ne produisait aucun e-mail.';
comment on column public.cron_runs.resolu_note is
  'Pourquoi c''est resolu, verifiable : le commit ou la migration qui corrige la cause. '
  'Une resolution sans justification est une ligne effacee avec un pas de plus.';

-- ── La source de la surveillance ───────────────────────────────────────────────────
--
-- ⚠️ La clé d'anti-répétition de la route (`sante_cron_runs`) ne change PAS : elle
-- identifie l'alerte dans `alertes_plateforme`. Seule la SOURCE change.
create or replace view public.cron_runs_actifs as
  select id, ran_at, fonction, profils_en_erreur, erreurs
  from public.cron_runs
  where resolu_le is null;

comment on view public.cron_runs_actifs is
  'Les incidents de cron qui demandent ENCORE une action. Meme contrat que `cron_runs` '
  '— vide = rien a faire — mais sans les lignes dont la cause est corrigee, qui '
  'gardaient l''alerte muette pendant 30 jours. Pour l''historique complet, lire '
  '`cron_runs` directement.';

-- Les privilèges par défaut de Supabase rendent toute vue NOUVELLE de `public` lisible
-- par `anon` et `authenticated` sans qu'aucun `grant` n'apparaisse ; et sans
-- `security_invoker`, elle s'exécuterait avec les droits de son propriétaire, court-
-- circuitant la RLS de `cron_runs`. Les trois lignes sont nécessaires ensemble.
revoke select on public.cron_runs_actifs from anon, authenticated;
alter view public.cron_runs_actifs set (security_invoker = true);
grant select on public.cron_runs_actifs to service_role;

-- ── L'incident du 2026-09-04, résolu ───────────────────────────────────────────────
--
-- Ce que cette instruction change, exactement : UNE ligne, DEUX colonnes qui étaient
-- nulles. Rien n'est supprimé, `erreurs`, `ran_at` et `fonction` sont intacts.
--
--   avant : id=424f7abb… fonction=purger-vocaux resolu_le=NULL resolu_note=NULL
--   après : id=424f7abb… fonction=purger-vocaux resolu_le=<maintenant>
--                                               resolu_note='corrigé par 5c20ceb…'
--
-- Ciblée par l'identifiant ET par le message : si la ligne avait changé entre la mesure
-- et l'application, l'instruction ne toucherait rien plutôt que la mauvaise.
update public.cron_runs
set resolu_le  = now(),
    resolu_note = 'Cause corrigee par le commit 5c20ceb : la lecture passe par la '
                  'fonction `vocaux_ig_a_purger` au lieu de `supa.schema(''storage'')`, '
                  'que PostgREST n''expose pas. Verifie dans '
                  'app/api/instagram/purger-vocaux/route.ts le 2026-09-05.'
where id = '424f7abb-e061-45ab-b027-9022b68411fb'
  and fonction = 'purger-vocaux'
  and resolu_le is null
  and erreurs::text like '%Invalid schema: storage%';
