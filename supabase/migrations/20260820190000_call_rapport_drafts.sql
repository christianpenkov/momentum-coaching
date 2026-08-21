-- Brouillons de rapport de call — reprise exacte après fermeture.
--
-- POURQUOI : fermer une modale de rapport en cours de saisie perdait tout. Les deux
-- flux échouaient différemment.
--
--   • Rapport de COACHING (components/ui/SessionRapportModal.tsx, 3 étapes) : n'écrit
--     qu'à la soumission finale. Un abandon perdait 100 % de la saisie, notes
--     comprises.
--
--   • Rapport de VENTE (components/ui/RapportModal.tsx, 17 étapes) : écrivait à
--     CHAQUE étape pour limiter la casse, au prix de deux défauts. L'étape
--     intermédiaire posait `calls.qualified` sur un rapport jamais terminé — et
--     cette colonne alimente le KPI « % Qualifié » de PageClientStats, qui comptait
--     donc des rapports abandonnés. Pire, un abandon après l'étape « montant »
--     laissait un call marqué `outcome = 'closed'` sans deal correspondant.
--
-- Cette table sépare les deux moments : le BROUILLON (ici, jamais lu par aucune
-- statistique) et le RAPPORT SOUMIS (colonnes de `calls`, `deals`, `session_reports`
-- — seule source des chiffres). Le marqueur « rapport rempli » reste inchangé et
-- unique : lib/sessionRapport.ts, `outcome != null || session_completed ||
-- session_no_show`. Un call qui a un brouillon reste « rapport à remplir ».
--
-- CE QUI N'EST PAS NETTOYÉ : les calls existants qui portent déjà un `qualified`
-- sans `outcome`, laissés par des rapports abandonnés avant ce chantier. Un UPDATE
-- en masse sur `calls` déclencherait le realtime (PageClientCalls et
-- useNotifications y sont abonnés) chez tous les clients connectés, pour quelques
-- lignes de KPI. Décision assumée, pas un oubli.
--
-- Volumétrie : une ligne vivante par (call, personne) le temps d'une saisie
-- interrompue. À 20 élèves actifs, la table reste sous le millier de lignes en
-- régime permanent, avec la purge ci-dessous.

-- ── 1. Table ─────────────────────────────────────────────────────────────────
create table if not exists public.call_rapport_drafts (
  id          uuid primary key default gen_random_uuid(),
  call_id     uuid not null references public.calls(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null check (kind in ('sales', 'session')),
  step        text not null,
  step_index  smallint not null default 1 check (step_index >= 1),
  step_total  smallint not null default 1 check (step_total >= 1),
  answers     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (call_id, user_id)
);

comment on table public.call_rapport_drafts is
  'Brouillons de rapport de call (vente + coaching). JAMAIS compté dans les statistiques : le marqueur "rapport rempli" reste calls.outcome / session_completed / session_no_show (lib/sessionRapport.ts). Supprimé à la soumission finale.';

comment on column public.call_rapport_drafts.user_id is
  'auth.users.id du rédacteur. Un brouillon n''est jamais lu par quelqu''un d''autre, même par une personne ayant accès au call. En pratique une seule personne remplit un call donné (useNotifications filtre sur coach_id), mais la colonne évite que deux saisies concurrentes s''écrasent en silence.';

comment on column public.call_rapport_drafts.kind is
  'sales = RapportModal (Calendly, 17 étapes) ; session = SessionRapportModal (Google Meet, 3 étapes).';

comment on column public.call_rapport_drafts.step is
  'Étape courante de la machine à états côté client. Volontairement NON contraint : la liste des étapes vit dans le TypeScript (type RapportStep), la figer ici imposerait une migration à chaque ajout d''étape pour un gain nul — aucune requête ne filtre sur sa valeur.';

comment on column public.call_rapport_drafts.step_index is
  'Rang de l''étape dans le parcours, pré-calculé par le client. Sert au libellé "Commencé · étape N/M" des cartes sans avoir à lire ni interpréter le payload.';

comment on column public.call_rapport_drafts.step_total is
  'Nombre d''étapes du parcours emprunté. Varie selon la branche : un no-show ne suit pas le même chemin qu''un closing, un total figé serait mensonger.';

comment on column public.call_rapport_drafts.answers is
  'Réponses saisies. Shape défini par le client, ni interprété par l''API ni par la base — c''est ce qui permet d''ajouter une question à la modale sans toucher au schéma.';

-- ── 2. Index ─────────────────────────────────────────────────────────────────
-- L'unique (call_id, user_id) couvre déjà la lecture d'un brouillon précis. Cet
-- index sert la requête des écrans de cartes : « parmi ces N calls en attente,
-- lesquels ont un brouillon À MOI ? » — un seul aller-retour, filtré sur les deux
-- colonnes dans cet ordre.
create index if not exists call_rapport_drafts_user_call_idx
  on public.call_rapport_drafts (user_id, call_id);

-- Balayage de la purge ci-dessous.
create index if not exists call_rapport_drafts_updated_idx
  on public.call_rapport_drafts (updated_at);

-- ── 3. Sécurité ──────────────────────────────────────────────────────────────
-- RLS activée SANS aucune policy : la table est exposée via PostgREST mais
-- inaccessible avec la clé anon. Tous les accès passent par
-- app/api/calls/[id]/rapport-draft/route.ts, qui réutilise le contrôle
-- d'appartenance déjà écrit dans app/api/calls/[id]/rapport/route.ts — lequel
-- documente une incohérence connue sur call.client_id pour les calls Calendly.
-- Réécrire cette logique en policy SQL la dupliquerait, donc garantirait qu'elle
-- diverge de la version TypeScript un jour ou l'autre. Une seule définition.
--
-- Une policy `user_id = auth.uid()` seule serait de toute façon insuffisante : elle
-- laisserait n'importe quel utilisateur authentifié créer un brouillon sur
-- n'importe quel call_id (il lui suffit de renseigner son propre user_id). Pas de
-- fuite de données, mais des lignes parasites.
--
-- Le service_role contourne RLS par conception.
alter table public.call_rapport_drafts enable row level security;

-- ── 4. Purge ─────────────────────────────────────────────────────────────────
-- Ce n'est PAS une question de place : un brouillon pèse quelques centaines
-- d'octets et pourrait vivre indéfiniment sans coût. C'est une question de
-- fiabilité. Passé un mois, on ne se souvient plus de ce qu'on avait répondu sur
-- ce call ; reprendre à l'étape 4 avec des réponses qu'on ne reconnaît pas est plus
-- dangereux que repartir de zéro, parce qu'on validerait alors un rapport sans
-- savoir ce qu'il contient — et ce rapport-là, lui, compte dans les statistiques.
--
-- ATTENTION à ne pas mal lire cette fonction : elle supprime LE BROUILLON, jamais
-- le rapport à remplir. Ce statut vient de `calls.outcome IS NULL`, pas de
-- l'existence d'une ligne ici. Après purge, la carte « rapport à remplir » reste
-- affichée à l'identique et son bouton repasse de « Reprendre » à « Remplir ».
--
-- En pratique elle agira rarement : le brouillon disparaît déjà à la soumission
-- (cas normal), en cascade si le call est supprimé, ou au clic sur « Recommencer ».
create or replace function public.purge_call_rapport_drafts()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare n bigint;
begin
  delete from public.call_rapport_drafts
   where updated_at < now() - interval '30 days';
  get diagnostics n = row_count;
  return n;
end;
$$;

comment on function public.purge_call_rapport_drafts is
  'Supprime les brouillons de rapport inactifs depuis 30 jours. Sans aucun effet sur les rapports soumis, qui vivent dans calls/deals/session_reports, ni sur le fait qu''un call soit « à remplir » (qui dépend de calls.outcome).';

select cron.unschedule('purge-call-rapport-drafts-daily')
  where exists (select 1 from cron.job where jobname = 'purge-call-rapport-drafts-daily');

select cron.schedule(
  'purge-call-rapport-drafts-daily',
  '45 3 * * *',
  $cron$select public.purge_call_rapport_drafts();$cron$
);
