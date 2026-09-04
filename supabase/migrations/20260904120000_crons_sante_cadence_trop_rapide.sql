-- Un cron qui tourne TROP SOUVENT était aussi invisible qu'un cron qui se tait.
--
-- ── Ce qui a motivé cette migration ────────────────────────────────────────────────
--
-- Le 2026-09-04, en cherchant d'où venaient 5 Go d'egress consommés en une semaine sur
-- un quota MENSUEL de 5 Go, deux jobs de cron-job.org tournaient **toutes les minutes**
-- au lieu de toutes les 30 minutes : `sync-calendly` et `notify-rapport`. Trente fois
-- la cadence prévue, depuis une date inconnue.
--
-- Rien ne pouvait le voir :
--
--   • `crons_sante` ne détectait que le SILENCE. Un cron trop rapide passe tous ses
--     contrôles : il laisse une trace fraîche, ses données sont à jour, `cron_runs`
--     reste vide puisqu'il ne rate rien. Il est plus « en bonne santé » que la normale.
--   • `cron.job` ne le montre pas non plus : ces deux jobs vivent chez cron-job.org, et
--     AGENTS.md le dit déjà — ni leur URL ni leur cadence ne se lisent dans le dépôt.
--
-- Le coût n'est pas théorique : 23 requêtes par MINUTE mesurées dans les logs de la
-- passerelle, soit ~33 000 par jour, pour un travail que 48 passages quotidiens
-- suffisaient à faire. Et ça consomme le quota d'appels Calendly (60/min par jeton),
-- qui deviendra la contrainte réelle à 40 élèves.
--
-- ⚠️ La correction elle-même se fait dans cron-job.org, hors du dépôt. Cette migration
-- ne la remplace pas : elle fait en sorte que la PROCHAINE fois, la plateforme le dise
-- toute seule, par le même e-mail quotidien que les autres vues de santé.
--
-- ── Pourquoi compter les passages du jour, et non mesurer le dernier intervalle ─────
--
-- Mesurer l'écart entre les deux derniers passages serait plus simple et donnerait un
-- FAUX POSITIF garanti : les boutons « Rafraîchir » de l'interface appellent les mêmes
-- traitements que les crons (`docs` — architecture des boutons Rafraîchir). Un élève
-- qui clique juste après un passage automatique produirait un intervalle d'une seconde,
-- donc une alerte, donc une alerte qu'on apprend à ignorer — le défaut que ce projet
-- traque partout ailleurs.
--
-- Un COMPTEUR JOURNALIER est insensible à ça : quelques clics manuels ajoutent quelques
-- unités, là où un cron déréglé multiplie le total par trente.
--
-- ── Le seuil : quatre fois la cadence prévue ───────────────────────────────────────
--
-- Assez large pour qu'aucun usage normal ne l'atteigne (un cron de 30 min devrait être
-- déclenché 144 fois à la main dans la journée), assez serré pour attraper le cas réel
-- (1 440 passages contre 48 attendus, soit 30×). Même esprit que `silence_max`, qui vaut
-- environ quatre cadences dans l'autre sens : on ne crie ni pour un passage manqué, ni
-- pour un passage en trop.
--
-- ⚠️ Le compteur repart à zéro à minuit UTC, et l'e-mail part vers 8 h de Paris. Un cron
-- réglé à la minute a alors déjà ~360 passages contre 48 attendus : largement au-dessus
-- du seuil de 192. La détection ne dépend donc pas de l'heure d'envoi.
--
-- ⚠️ `cadence_attendue` NULLE veut dire « on ne sait pas » et n'alerte jamais. C'est
-- volontaire : un cron inscrit sans qu'on ait lu sa fréquence dans cron-job.org ne doit
-- pas hériter d'un seuil au jugé. AGENTS.md porte déjà cette règle pour `silence_max`,
-- où un défaut posé au jugé avait produit une fausse alerte hebdomadaire garantie.

alter table public.crons_passages
  add column if not exists cadence_attendue  interval,
  add column if not exists passages_du_jour  integer not null default 0,
  add column if not exists jour_compte       date;

comment on column public.crons_passages.cadence_attendue is
  'Intervalle NOMINAL entre deux passages, tel que lu dans cron-job.org ou cron.job — '
  'jamais deduit. NULL = cadence inconnue, aucune alerte de sur-frequence.';
comment on column public.crons_passages.passages_du_jour is
  'Nombre de passages depuis minuit UTC. Remis a zero par marquer_passage_cron au '
  'premier passage d''un nouveau jour, jamais par une purge.';

-- ── Le compteur ────────────────────────────────────────────────────────────────────
-- Le corps reste une seule instruction SQL : la remise a zero se fait par un `case` sur
-- `jour_compte`, sans lecture prealable ni condition en PL/pgSQL. Un cron a la minute
-- appelle cette fonction 1 440 fois par jour — elle doit rester aussi bon marche
-- qu'avant, sinon le remede coute ce que la mesure economise.
create or replace function public.marquer_passage_cron(
  p_nom text,
  p_contexte text default null,
  p_empreinte text default null
) returns void
language sql
security definer
set search_path to 'public'
as $function$
  insert into public.crons_passages (nom, dernier_passage, contexte, empreinte,
                                     passages_du_jour, jour_compte)
  values (p_nom, now(), p_contexte, p_empreinte, 1, (now() at time zone 'utc')::date)
  on conflict (nom) do update
    set dernier_passage  = now(),
        contexte         = excluded.contexte,
        empreinte        = excluded.empreinte,
        -- Premier passage d'un nouveau jour : on repart de 1, pas de 0 — ce passage-ci
        -- compte. Repartir de 0 sous-estimerait d'une unite chaque journee.
        passages_du_jour = case
          when crons_passages.jour_compte is distinct from excluded.jour_compte then 1
          else crons_passages.passages_du_jour + 1
        end,
        jour_compte      = excluded.jour_compte;
$function$;

-- Les cadences NOMINALES, relevees une par une le 2026-09-04 : `cron.job` pour les deux
-- jobs pg_cron, et le tableau d'AGENTS.md (lui-meme confirme job par job dans
-- cron-job.org le 2026-09-01) pour les autres.
--
-- ⚠️ Ce sont les cadences ATTENDUES, pas les cadences observees. `sync-calendly` et
-- `notify-rapport` tournent aujourd'hui a la minute : c'est precisement l'ecart que la
-- vue doit signaler, donc on inscrit 30 minutes et non ce qu'on mesure.
update public.crons_passages set cadence_attendue = v.cadence
from (values
  ('poll-leads',             interval '5 minutes'),
  ('poll-stories',           interval '30 minutes'),
  ('sync-calendly',          interval '30 minutes'),
  ('sync-stripe-payments',   interval '30 minutes'),
  ('notify-rapport',         interval '30 minutes'),
  ('fathom-cron-sync',       interval '15 minutes'),
  ('call-reminders',         interval '15 minutes'),
  ('send-pending-dm3',       interval '1 minute'),
  ('process-webhook-queue',  interval '1 minute'),
  ('installment-reminders',  interval '1 day'),
  ('cron-refresh-tokens',    interval '7 days')
) as v(nom, cadence)
where crons_passages.nom = v.nom;

-- ── La vue ─────────────────────────────────────────────────────────────────────────
-- `create or replace` et non `drop` + `create` : un `drop` reinitialiserait les
-- privileges par defaut du schema `public`, qui rendent toute vue NOUVELLE lisible par
-- `anon` et `authenticated` sans qu'aucun `grant` n'apparaisse. C'est exactement ce qui
-- a rouvert quinze vues de sante le 2026-09-03. Les trois lignes de fermeture sont
-- reaffirmees plus bas de toute facon : les deux, pas l'une ou l'autre.
--
-- Les six colonnes existantes gardent leur position et leur type ; les deux nouvelles
-- sont ajoutees a la fin, seule forme que `create or replace view` accepte.
create or replace view public.crons_sante as
  select
    nom,
    dernier_passage,
    silence_max,
    round(extract(epoch from now() - dernier_passage) / 3600::numeric, 1) as il_y_a_heures,
    contexte,
    case
      -- Le silence passe en premier : un cron mort est plus grave qu'un cron bavard, et
      -- les deux etats ne peuvent de toute facon pas etre vrais en meme temps.
      when (now() - dernier_passage) > silence_max then 'SILENCIEUX'
      when cadence_attendue is not null
       and jour_compte = (now() at time zone 'utc')::date
       and passages_du_jour > 4 * (86400.0 / extract(epoch from cadence_attendue))
        then 'ALERTE cadence trop rapide'
      else 'ok'
    end as etat,
    passages_du_jour,
    cadence_attendue
  from crons_passages
  order by
    (now() - dernier_passage) > silence_max desc,
    dernier_passage;

comment on view public.crons_sante is
  'Sante des crons inscrits, dans les DEUX sens : "SILENCIEUX" quand un cron ne laisse '
  'plus de trace, "ALERTE cadence trop rapide" quand il en laisse quatre fois trop. Le '
  'second cas a existe en vrai (sync-calendly et notify-rapport a la minute au lieu de '
  '30 min, decouvert le 2026-09-04 en cherchant une surconsommation d''egress) et ne '
  'declenchait aucun controle : un cron trop rapide a l''air plus sain que la normale.';

-- L'invariant d'`acces_sante_lecture` ne souffre pas d'exception, meme sur une vue qui
-- ne contient que des noms de crons : c'est de n'avoir aucune exception qu'il tire sa
-- fiabilite.
revoke select on public.crons_sante from anon, authenticated;
alter view public.crons_sante set (security_invoker = true);
grant select on public.crons_sante to service_role;
