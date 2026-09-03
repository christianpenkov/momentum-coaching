-- Rendre detectable qu'une Edge Function EN LIGNE est plus vieille que le code.
--
-- ── Ce qui s'est passe ──────────────────────────────────────────────────────────────
--
-- Une Edge Function ne part PAS avec `git push` : elle demande une commande a part.
-- Constate le 2026-09-03 : `poll-leads` tournait avec du code du 1er septembre, huit
-- commits en retard, dont un correctif qui empechait l'origine d'un lead d'etre ecrasee
-- toutes les cinq minutes — un champ que six ecrans lisent, dont toute l'attribution
-- des paiements. Personne ne l'a vu pendant deux jours, et rien n'aurait pu le voir.
--
-- ⚠️ `crons_passages` prouve qu'un cron TOURNE, jamais qu'il tourne le BON code. C'est
-- une surveillance qui repond a cote de la question, donc rassurante a tort.
--
-- ⚠️ `updated_at` du tableau de bord Supabase MENT — prouve sur `refresh-ig-posts` :
-- date au 02/08, contenu deploye contenant les filtres du 20/08. `version` et
-- `entrypoint_path` se contredisent meme entre eux.
--
-- ⚠️ Chercher un marqueur a la main se trompe DANS LES DEUX SENS. Ma propre sonde
-- « maxResults=500 absent » etait un faux negatif : cette chaine n'avait jamais existe
-- dans ce fichier, le commit dont elle venait touchait deux fichiers et elle vivait
-- dans l'autre. Un marqueur choisi au jugé est un instrument dont personne n'a mesure
-- la sensibilite.
--
-- ── Pourquoi une empreinte du code, et pas un identifiant de commit ────────────────
--
-- Un identifiant de commit change a CHAQUE commit, meme sans rapport avec la fonction :
-- l'alerte crierait en permanence, donc on cesserait de l'ouvrir. L'empreinte ne change
-- que quand le code de cette fonction change reellement.
--
-- ⚠️ Elle couvre `index.ts` ET la cloture de ses imports locaux. C'est le point
-- essentiel : le mode de panne dominant du projet est que « chaque deploiement fige sa
-- propre copie des modules partages, donc une fonction perime sans que son dossier
-- bouge » (AGENTS.md). Une empreinte du seul `index.ts` aurait laisse passer exactement
-- ce cas — celui qui a deja produit une vraie dette sur `sync-stripe-payments`.
--
-- ── Pourquoi pas l'API de gestion Supabase ─────────────────────────────────────────
--
-- Comparer le bundle en ligne au depot serait plus direct, mais demanderait de poser un
-- jeton d'acces personnel dans les variables Vercel — un secret aux pouvoirs tres larges
-- ajoute pour une commodite de surveillance, le jour ou l'on vient de fermer une fuite
-- de lecture. Verifie le 2026-09-03 : aucun jeton de ce type n'existe cote Vercel, et on
-- n'en cree pas.
--
-- ── La boucle ───────────────────────────────────────────────────────────────────────
--
--   `scripts/empreintes-edge.mjs` (copie de travail) → `lib/empreintes-edge.generated.ts`
--     → l'Edge Function importe SON empreinte et la remonte via `marquer_passage_cron`
--     → `npm run prebuild` la recalcule a chaque construction Vercel (valeur attendue)
--     → `/api/sante/alerte-vues` inscrit l'attendu dans `edge_empreintes_attendues`
--     → `edge_sante_version` compare, et l'e-mail quotidien part comme pour les autres.
--
-- Le sens du mode de panne est choisi : si quelqu'un deploie sans regenerer l'empreinte,
-- la fonction remonte l'ancienne valeur et l'alerte CRIE alors que tout va bien. Jamais
-- l'inverse. `npm run deployer-edge <nom>` fait les trois gestes dans le bon ordre.

-- ── 1. Ou l'empreinte en ligne se depose ────────────────────────────────────────────
alter table public.crons_passages add column if not exists empreinte text;

comment on column public.crons_passages.empreinte is
  'Empreinte du code source que la fonction EN LIGNE execute, remontee a chaque passage. '
  'null = cette fonction ne la remonte pas encore. Comparee a edge_empreintes_attendues '
  'par la vue edge_sante_version.';

-- ⚠️ `drop` puis `create`, et non un surcharge a trois arguments : l'ancienne signature
-- est `(p_nom text, p_contexte text default null)`, et les sept appelants ne passent que
-- `p_nom`. Ajouter une surcharge aurait rendu `{p_nom}` AMBIGU cote PostgREST — donc une
-- erreur a chaque passage de chaque cron, c'est-a-dire toute la surveillance des crons
-- cassee d'un coup.
drop function if exists public.marquer_passage_cron(text, text);

create function public.marquer_passage_cron(
  p_nom text,
  p_contexte text default null,
  p_empreinte text default null
) returns void
language sql
security definer
set search_path to 'public'
as $$
  insert into public.crons_passages (nom, dernier_passage, contexte, empreinte)
  values (p_nom, now(), p_contexte, p_empreinte)
  on conflict (nom) do update
    set dernier_passage = now(),
        contexte        = excluded.contexte,
        -- ⚠️ ECRASE, y compris avec null — delibrement, et c'est le sens le plus sur.
        --
        -- Un `coalesce(excluded.empreinte, crons_passages.empreinte)` aurait conserve la
        -- derniere valeur connue. Alors une fonction redeployee depuis une version qui
        -- ne remonte plus son empreinte garderait l'ancienne, et la vue afficherait
        -- « ok » pour du code dont on ne sait plus rien. C'est le piege du `|| null` a
        -- l'envers : preserver une valeur perimee affirme quelque chose de faux, la
        -- mettre a null dit « on ne sait pas » — et `edge_sante_version` traite null
        -- comme `non instrumentee`, pas comme une panne.
        empreinte       = excluded.empreinte;
$$;

comment on function public.marquer_passage_cron(text, text, text) is
  'Un cron declare son passage. p_empreinte : l''empreinte du code source qu''il '
  'execute (lib/empreintes-edge.generated.ts), pour que edge_sante_version puisse dire '
  'si la fonction en ligne est plus vieille que le depot.';

-- ⚠️ Les droits ne suivent PAS un `drop`/`create` : la migration 20260902200000 avait
-- ferme cette fonction a `anon`/`authenticated` et l'avait ouverte a `service_role` — la
-- nouvelle fonction repart des privileges par defaut du schema, qui ouvrent a tout le
-- monde. Un cron simulable par la cle publique rendrait un cron mort indetectable :
-- toute la surveillance `crons_sante` s'effondrerait sans bruit.
revoke execute on function public.marquer_passage_cron(text, text, text) from public, anon, authenticated;
grant  execute on function public.marquer_passage_cron(text, text, text) to service_role;

-- ── 2. Ou l'empreinte attendue se depose ────────────────────────────────────────────
--
-- Elle vient du DEPOT, que la base ne peut pas lire. C'est donc `/api/sante/alerte-vues`
-- qui l'inscrit a chaque passage : la route est reconstruite par Vercel a chaque push,
-- et `npm run prebuild` recalcule les empreintes a chaque construction. La valeur
-- attendue est donc toujours celle du depot pousse, sans que personne ne l'entretienne.
create table if not exists public.edge_empreintes_attendues (
  nom            text primary key,
  empreinte      text not null,
  fichiers       integer,
  mis_a_jour_le  timestamptz not null default now()
);

comment on table public.edge_empreintes_attendues is
  'Une ligne par Edge Function du depot : l''empreinte de son code source, ecrite par '
  '/api/sante/alerte-vues a chaque passage. La base ne peut pas lire le depot, cette '
  'table est le pont. Ne jamais la remplir a la main.';

-- ⚠️ RLS obligatoire, sinon cette table apparait dans `acces_sante_lecture` (invariant
-- pose le meme jour) : les privileges par defaut du schema `public` la rendraient
-- lisible par `anon` sans qu'aucun `grant` ne soit ecrit. Aucune policy = `service_role`
-- seul, qui contourne la RLS.
alter table public.edge_empreintes_attendues enable row level security;

-- ── 3. La comparaison ───────────────────────────────────────────────────────────────
--
-- ⚠️ Le nom d'un cron est celui de sa fonction (verifie : `p_nom: 'poll-leads'`,
-- `'sync-calendly'`, …). C'est ce qui permet la jointure sans table de correspondance.
create or replace view public.edge_sante_version as
select
  a.nom,
  a.empreinte                     as empreinte_du_depot,
  p.empreinte                     as empreinte_en_ligne,
  p.dernier_passage,
  a.fichiers,
  case
    -- Aucun passage jamais enregistre : cette fonction n'est pas un cron inscrit
    -- (`call-reminders` et `send-pending-dm3` tournent en pg_cron, `refresh-ig-posts` et
    -- `backfill-shortio` sont declenchees a la main). Ce n'est PAS une anomalie.
    when p.nom is null            then 'hors crons inscrits'
    -- Le cron passe mais ne remonte pas encore son empreinte : instrumentation a
    -- terminer. Information, pas panne — meme registre que `non_connectee`.
    when p.empreinte is null      then 'non instrumentee'
    when p.empreinte = a.empreinte then 'ok'
    else 'ALERTE la fonction en ligne n''est pas celle du depot'
  end                             as etat
from public.edge_empreintes_attendues a
left join public.crons_passages p on p.nom = a.nom
order by
  case when p.empreinte is not null and p.empreinte <> a.empreinte then 0 else 1 end,
  a.nom;

comment on view public.edge_sante_version is
  'Une ligne par Edge Function : l''empreinte de son code dans le depot, celle que la '
  'fonction EN LIGNE remonte a chaque passage, et l''ecart. Filtrer sur '
  'etat like ''ALERTE%'' — ni ''hors crons inscrits'' ni ''non instrumentee'' ne sont des '
  'anomalies. ⚠️ Repond a la question a laquelle crons_sante ne repond PAS : un cron '
  'peut tourner parfaitement en executant du code vieux de huit commits.';

revoke select on public.edge_sante_version from anon, authenticated;
alter view public.edge_sante_version set (security_invoker = true);
grant select on public.edge_sante_version to service_role;
