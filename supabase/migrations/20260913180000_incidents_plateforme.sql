-- Incidents de la plateforme, et les quatre angles morts que l'audit du 2026-09-13 a trouvés
--
-- ── Pourquoi ─────────────────────────────────────────────────────────────────────────
--
-- Les dix-neuf vues de santé surveillent des CONSÉQUENCES dans les données. Aucune ne
-- voyait trois choses, mesurées une par une le 2026-09-13 :
--
--   1. Les ERREURS elles-mêmes. ~150 écritures Supabase ne lisent pas leur `{ error }`
--      (webhook Stripe, DM, Calendly, paiements) ; aucune route n'avait de capture
--      d'exception (ni `instrumentation.ts`, ni `error.tsx`) ; les logs Vercel Hobby
--      vivent une heure. Une panne de code ne laissait AUCUNE trace lisible le lendemain.
--   2. pg_cron et pg_net. `cron.job_run_details` et `net._http_response` n'étaient lues
--      par rien : dix jobs SQL quotidiens pouvaient échouer tous les jours en silence.
--   3. La file des webhooks Instagram. Un événement abandonné après 5 essais, ou resté
--      bloqué en `processing` (la réservation ne reprend plus une ligne à 5 essais),
--      est un DM perdu, et rien ne le disait.
--   4. Les versions d'API qui expirent. Graph API v21.0, utilisée par une vingtaine
--      d'appels, expire le 21 janvier 2027 ; Meta sert alors la plus ancienne version
--      active À LA PLACE, sans erreur — le comportement change en silence.
--
-- ── Le modèle d'incident ─────────────────────────────────────────────────────────────
--
-- Une ligne par EMPREINTE (la même panne, regroupée), jamais une ligne par occurrence :
-- la table ne grossit qu'avec le nombre de pannes DISTINCTES, pas avec le trafic.
--
-- ⚠️ La leçon de `cron_runs` (AGENTS.md, « Un incident CORRIGÉ rendait l'alerte muette
-- pendant 30 jours ») est appliquée d'emblée : un incident déjà notifié se RÉARME TOUT
-- SEUL, sans geste humain, dans trois cas —
--   · il revient après 7 jours sans occurrence (« le problème est revenu ») ;
--   · il survit à un déploiement, pour un incident critique (« ton correctif n'a pas
--     marché ») ;
--   · il revient après avoir été marqué résolu à la main.
-- Aucune ligne ne peut donc condamner une alerte au silence. Et le réarmement ne vit que
-- dans cette fonction, pas dans le code qui notifie.

create table if not exists public.incidents (
  empreinte         text primary key,
  source            text not null,           -- 'vercel-serveur', 'vercel-navigateur', 'edge:<nom>', 'sante'
  gravite           text not null check (gravite in ('critique', 'normale')),
  titre             text not null,
  premiere_le       timestamptz not null default now(),
  derniere_le       timestamptz not null default now(),
  occurrences       integer not null default 1,
  dernier_detail    jsonb not null default '{}'::jsonb,
  -- Les 5 dernières occurrences complètes, la plus récente d'abord : le « log » qu'un
  -- e-mail peut montrer, alors que les logs de la plateforme ont disparu depuis longtemps.
  echantillons      jsonb not null default '[]'::jsonb,
  version_derniere  text,                    -- commit déployé à la dernière occurrence
  version_notifiee  text,                    -- commit déployé quand l'e-mail est parti
  notifie_le        timestamptz,
  resolu_le         timestamptz,
  resolu_note       text
);

comment on table public.incidents is
  'Une ligne par panne distincte (empreinte). Alimentée par signaler_incident() depuis Vercel, le navigateur et les Edge Functions ; notifiée par /api/sante/dispatch. Réarmement automatique : voir la migration 20260913180000.';

create index if not exists incidents_a_notifier on public.incidents (gravite, premiere_le) where notifie_le is null and resolu_le is null;
create index if not exists incidents_derniere_le on public.incidents (derniere_le);

-- Lue et écrite par le serveur seulement. RLS active SANS policy : `anon` et
-- `authenticated` ne voient rien, `service_role` contourne la RLS. C'est aussi ce
-- qu'exige l'invariant d'`acces_sante_lecture`.
alter table public.incidents enable row level security;
revoke all on public.incidents from anon, authenticated;
grant select, insert, update, delete on public.incidents to service_role;

create or replace function public.signaler_incident(
  p_empreinte   text,
  p_source      text,
  p_gravite     text,
  p_titre       text,
  p_detail      jsonb,
  p_occurrences integer default 1,
  p_version     text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_empreinte text := left(coalesce(p_empreinte, 'sans-empreinte'), 64);
  v_titre     text := left(coalesce(p_titre, 'Incident sans titre'), 300);
  v_gravite   text := case when p_gravite = 'critique' then 'critique' else 'normale' end;
  v_detail    jsonb := coalesce(p_detail, '{}'::jsonb);
begin
  -- Garde de débordement. Une empreinte mal normalisée (un identifiant resté dans le
  -- message) fabriquerait une ligne par occurrence, et une rafale remplirait la base
  -- — qui passe en LECTURE SEULE à 500 Mo sur le plan gratuit. Au-delà de 200 pannes
  -- NOUVELLES en une heure, tout ce qui est nouveau est regroupé sous une seule ligne,
  -- qui est elle-même critique : ce volume-là est un incident en soi.
  if not exists (select 1 from public.incidents where empreinte = v_empreinte)
     and (select count(*) from public.incidents where premiere_le > now() - interval '1 hour') >= 200 then
    v_detail    := jsonb_build_object('empreinte_regroupee', v_empreinte, 'titre_regroupe', v_titre, 'detail', v_detail);
    v_empreinte := 'debordement';
    v_titre     := 'Plus de 200 pannes distinctes en une heure — les nouvelles sont regroupées ici';
    v_gravite   := 'critique';
  end if;

  -- Les échantillons sont bornés en taille AVANT d'entrer : un corps de réponse de
  -- plusieurs mégaoctets ne doit pas faire gonfler une ligne relue toutes les 5 minutes.
  if length(v_detail::text) > 20000 then
    v_detail := jsonb_build_object('tronque', true, 'apercu', left(v_detail::text, 20000));
  end if;

  insert into public.incidents as i (
    empreinte, source, gravite, titre, occurrences, dernier_detail, echantillons, version_derniere
  ) values (
    v_empreinte, left(coalesce(p_source, 'inconnue'), 80), v_gravite, v_titre,
    greatest(coalesce(p_occurrences, 1), 1), v_detail, jsonb_build_array(v_detail), p_version
  )
  on conflict (empreinte) do update set
    derniere_le      = now(),
    occurrences      = i.occurrences + greatest(coalesce(p_occurrences, 1), 1),
    dernier_detail   = excluded.dernier_detail,
    echantillons     = (
      select coalesce(jsonb_agg(e.valeur order by e.rang), '[]'::jsonb)
      from (
        select valeur, rang
        from jsonb_array_elements(excluded.echantillons || i.echantillons) with ordinality as t(valeur, rang)
        order by rang
        limit 5
      ) e
    ),
    -- Une gravité ne redescend jamais d'elle-même : une panne vue une fois sur une route
    -- critique reste critique.
    gravite          = case when i.gravite = 'critique' or excluded.gravite = 'critique' then 'critique' else 'normale' end,
    titre            = excluded.titre,
    source           = excluded.source,
    version_derniere = coalesce(excluded.version_derniere, i.version_derniere),
    -- ── Réarmement ────────────────────────────────────────────────────────────────
    -- ⚠️ `i.*` désigne l'état AVANT la mise à jour : c'est ce qui permet de lire
    -- « depuis combien de temps n'était-il plus apparu ».
    notifie_le = case
      when i.resolu_le is not null then null
      when i.notifie_le is null then null
      when i.derniere_le < now() - interval '7 days' then null
      when i.gravite = 'critique'
           and excluded.version_derniere is not null
           and i.version_notifiee is not null
           and excluded.version_derniere <> i.version_notifiee then null
      else i.notifie_le
    end,
    resolu_le   = null,
    resolu_note = case when i.resolu_le is not null then coalesce(i.resolu_note, '') || ' [revenu le ' || to_char(now(), 'YYYY-MM-DD HH24:MI') || ' UTC]' else i.resolu_note end;
end;
$$;

comment on function public.signaler_incident(text, text, text, text, jsonb, integer, text) is
  'Enregistre une occurrence de panne, regroupée par empreinte, avec réarmement automatique de la notification. Réservée au service.';

-- ⚠️ Supabase grante EXECUTE à anon/authenticated par défaut. Le navigateur passe par
-- /api/sante/incident-client, qui borne la taille et le débit : jamais en direct.
revoke execute on function public.signaler_incident(text, text, text, text, jsonb, integer, text) from public, anon, authenticated;
grant execute on function public.signaler_incident(text, text, text, text, jsonb, integer, text) to service_role;

-- Purge : un incident sans occurrence depuis 90 jours n'apprend plus rien à personne.
create or replace function public.purge_incidents()
returns bigint
language sql
security definer
set search_path = public, pg_temp
as $$
  with supprimes as (
    delete from public.incidents where derniere_le < now() - interval '90 days' returning 1
  )
  select count(*) from supprimes;
$$;
revoke execute on function public.purge_incidents() from public, anon, authenticated;

select cron.schedule('purge-incidents-daily', '20 4 * * *', $job$select public.purge_incidents();$job$);

-- ── Le réarmement fin des alertes de vues ───────────────────────────────────────────
--
-- `alertes_plateforme` n'envoyait qu'UN e-mail par vue tant qu'elle n'était pas
-- redevenue entièrement propre. Donc un DEUXIÈME cron qui se tait pendant que le premier
-- est encore en alerte ne produisait aucun e-mail — relevé par l'audit du 2026-09-13.
-- `identites` retient QUELLES lignes ont déjà été signalées : une ligne nouvelle part,
-- une ligne déjà connue se tait.
alter table public.alertes_plateforme add column if not exists identites text[];

-- ── pg_cron ─────────────────────────────────────────────────────────────────────────
--
-- ⚠️ Un job qui appelle `declencher_cron` est TOUJOURS « succeeded » : pg_net met la
-- requête en file et rend la main. Ce qu'on attrape ici, ce sont les jobs SQL purs
-- (purges, dégrossissage, photo de la taille de base) — les appels HTTP sont couverts
-- par `crons_passages` et par `pgnet_sante` ci-dessous.
--
-- On juge le DERNIER passage, pas l'historique : un échec suivi d'un succès s'est réparé
-- seul et ne demande rien. Un job quotidien sans succès depuis 26 h est `SILENCIEUX`.
create or replace view public.pgcron_sante as
with runs as (
  select
    j.jobname,
    j.schedule,
    j.active,
    count(d.runid)                                                    as passages_7j,
    max(d.start_time) filter (where d.status = 'succeeded')          as dernier_succes,
    max(d.start_time) filter (where d.status = 'failed')             as dernier_echec,
    count(*) filter (where d.status = 'failed' and d.start_time > now() - interval '24 hours') as echecs_24h,
    (array_agg(d.return_message order by d.start_time desc) filter (where d.status = 'failed'))[1] as message_dernier_echec
  from cron.job j
  left join cron.job_run_details d on d.jobid = j.jobid and d.start_time > now() - interval '7 days'
  group by j.jobid, j.jobname, j.schedule, j.active
)
select
  jobname as nom,
  schedule,
  dernier_succes,
  dernier_echec,
  echecs_24h,
  left(message_dernier_echec, 500) as message_dernier_echec,
  case
    when not active then 'ALERTE : job desactive'
    when dernier_echec is not null and (dernier_succes is null or dernier_echec > dernier_succes) then 'ALERTE : dernier passage en echec'
    -- Un job qui n'a encore jamais tourné (créé dans la journée) n'est pas un silence.
    when passages_7j = 0 then 'en attente du premier passage'
    when schedule ~ '^\d+ \d+ \* \* \*$' and (dernier_succes is null or dernier_succes < now() - interval '26 hours') then 'SILENCIEUX'
    else 'ok'
  end as etat
from runs;

comment on view public.pgcron_sante is
  'Jobs pg_cron dont le dernier passage a échoué, désactivés, ou quotidiens sans succès depuis 26 h. Surveillée par /api/sante/alerte-vues.';

-- ── pg_net ──────────────────────────────────────────────────────────────────────────
--
-- ⚠️ pg_net ne garde ses réponses que ~6 h : cette vue est lue toutes les heures, jamais
-- une fois par jour.
-- ⚠️ Les délais dépassés (« Timeout of 5000 ms reached ») sont EXCLUS, et c'est mesuré :
-- 28 le 2026-09-13, tous bénins — pg_net cesse d'attendre à 5 s pendant que la fonction
-- appelée continue et termine son travail (`crons_sante` était « ok » partout). Une
-- panne réelle de la cible se voit en statut HTTP, ou en absence de réponse autre qu'un
-- délai (DNS, connexion refusée).
-- Seuil de 3 dans la fenêtre : un démarrage à froid isolé qui rend 500 n'appelle aucune
-- action, trois oui.
create or replace view public.pgnet_sante as
select
  coalesce(r.status_code::text, 'sans reponse') as statut,
  count(*)                                       as nb_6h,
  max(r.created)                                 as dernier,
  left((array_agg(coalesce(r.error_msg, r.content) order by r.created desc))[1], 500) as dernier_detail,
  case when count(*) >= 3 then 'ALERTE : appels internes en echec' else 'isole' end as etat
from net._http_response r
where r.created > now() - interval '6 hours'
  and (
    r.status_code >= 400
    or (r.status_code is null and coalesce(r.error_msg, '') not ilike 'Timeout of%')
  )
group by 1;

comment on view public.pgnet_sante is
  'Appels HTTP sortants de la base (crons pg_cron, notifications push) en échec sur les 6 dernières heures, délais dépassés exclus. Surveillée toutes les heures.';

-- ── File des webhooks Instagram ─────────────────────────────────────────────────────
--
-- Une ligne par source, jamais une ligne par événement : une panne Meta qui fait
-- échouer 300 commentaires est UN incident, pas 300 e-mails.
-- « bloquée » = une ligne qui devrait avoir été reprise depuis 10 minutes et ne l'a pas
-- été. Cas réel possible : `claim_webhook_queue` ne reprend PAS une ligne restée en
-- `processing` avec 5 essais (Vercel a coupé le worker pendant le dernier), elle y reste
-- donc pour toujours.
create or replace view public.webhook_queue_sante as
select
  q.source,
  count(*) filter (where q.status = 'failed' and coalesce(q.processed_at, q.created_at) > now() - interval '24 hours') as abandonnes_24h,
  count(*) filter (where q.status in ('pending', 'processing') and q.next_retry_at < now() - interval '10 minutes')  as bloques,
  min(q.created_at) filter (where q.status in ('pending', 'processing'))                                             as plus_ancien_en_attente,
  left((array_agg(q.last_error order by q.created_at desc) filter (where q.status in ('failed', 'pending') and q.last_error is not null))[1], 500) as derniere_erreur,
  case
    when count(*) filter (where q.status in ('pending', 'processing') and q.next_retry_at < now() - interval '10 minutes') > 0
      then 'ALERTE : file bloquee'
    when count(*) filter (where q.status = 'failed' and coalesce(q.processed_at, q.created_at) > now() - interval '24 hours') > 0
      then 'ALERTE : evenements abandonnes apres 5 essais'
    else 'ok'
  end as etat
from public.webhook_queue q
group by q.source;

comment on view public.webhook_queue_sante is
  'File des webhooks : événements abandonnés dans les 24 h, ou bloqués depuis plus de 10 min. Surveillée toutes les heures.';

-- ── Versions d'API qui expirent ─────────────────────────────────────────────────────
--
-- Deux tables, deux sources, et aucune n'est devinée :
--   · `versions_api_depot`      — les versions RÉELLEMENT écrites dans le code, relevées
--     à chaque build par scripts/manifeste-versions-api.mjs et recopiées par le
--     répartiteur (même pont que `migrations_du_depot`). Une version retirée du code
--     disparaît de la table.
--   · `versions_api_expirations` — les dates PUBLIÉES par le fournisseur, chacune avec
--     sa source et la date du relevé.
-- ⚠️ Une version absente de la seconde n'alerte PAS : c'est une version plus récente
-- que le relevé, donc plus lointaine. Le jour où le fournisseur publie sa date, une
-- ligne suffit.
create table if not exists public.versions_api_expirations (
  fournisseur text not null,
  version     text not null,
  expire_le   date not null,
  source      text not null,
  releve_le   date not null,
  primary key (fournisseur, version)
);
alter table public.versions_api_expirations enable row level security;
revoke all on public.versions_api_expirations from anon, authenticated;
grant select, insert, update, delete on public.versions_api_expirations to service_role;

-- Relevé du 2026-09-13 sur https://developers.facebook.com/docs/graph-api/changelog/versions
insert into public.versions_api_expirations (fournisseur, version, expire_le, source, releve_le) values
  ('meta-graph', 'v19.0', '2026-05-21', 'https://developers.facebook.com/docs/graph-api/changelog/versions', '2026-09-13'),
  ('meta-graph', 'v20.0', '2026-09-24', 'https://developers.facebook.com/docs/graph-api/changelog/versions', '2026-09-13'),
  ('meta-graph', 'v21.0', '2027-01-21', 'https://developers.facebook.com/docs/graph-api/changelog/versions', '2026-09-13'),
  ('meta-graph', 'v22.0', '2027-05-20', 'https://developers.facebook.com/docs/graph-api/changelog/versions', '2026-09-13'),
  ('meta-graph', 'v23.0', '2027-10-08', 'https://developers.facebook.com/docs/graph-api/changelog/versions', '2026-09-13'),
  ('meta-graph', 'v24.0', '2028-02-18', 'https://developers.facebook.com/docs/graph-api/changelog/versions', '2026-09-13'),
  ('meta-graph', 'v25.0', '2028-07-29', 'https://developers.facebook.com/docs/graph-api/changelog/versions', '2026-09-13')
on conflict (fournisseur, version) do update set expire_le = excluded.expire_le, source = excluded.source, releve_le = excluded.releve_le;

create table if not exists public.versions_api_depot (
  fournisseur    text not null,
  version        text not null,
  occurrences    integer not null,
  fichiers       text[] not null,
  mis_a_jour_le  timestamptz not null default now(),
  primary key (fournisseur, version)
);
alter table public.versions_api_depot enable row level security;
revoke all on public.versions_api_depot from anon, authenticated;
grant select, insert, update, delete on public.versions_api_depot to service_role;

-- 90 jours : le temps de migrer une vingtaine d'appels ET de refaire l'audit métrique
-- par métrique qu'un changement de version Graph exige sur ce projet.
create or replace view public.versions_api_sante as
select
  d.fournisseur,
  d.version,
  d.occurrences,
  d.fichiers,
  e.expire_le,
  (e.expire_le - current_date) as jours_restants,
  e.source,
  case
    when e.expire_le is null then 'date non publiee'
    when e.expire_le <= current_date then 'ALERTE : version expiree, servie en silence par une autre'
    when e.expire_le - current_date <= 90 then 'ALERTE : expire dans moins de 90 jours'
    else 'ok'
  end as etat
from public.versions_api_depot d
left join public.versions_api_expirations e using (fournisseur, version);

comment on view public.versions_api_sante is
  'Versions d''API écrites dans le code et leur date d''expiration publiée. ALERTE à 90 jours. Surveillée par /api/sante/alerte-vues.';

-- Les quatre vues sont lues par le serveur seulement. Sans ces revoke, les privilèges
-- par défaut du schéma les ouvriraient à `anon` — et `pgnet_sante` expose des corps de
-- réponse internes (docs/sante-plateforme.md, « Un revoke ne se maintient pas »).
revoke all on public.pgcron_sante, public.pgnet_sante, public.webhook_queue_sante, public.versions_api_sante from anon, authenticated;
grant select on public.pgcron_sante, public.pgnet_sante, public.webhook_queue_sante, public.versions_api_sante to service_role;
