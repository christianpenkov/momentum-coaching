-- ⚠️ FICHIER RECONSTITUÉ le 2026-09-03. LA PLUS GRAVE DES SEPT.
--
-- Appliquée à la base le 2026-09-01, jamais versionnée. C'est celle qui crée la table
-- `crons_passages`, sa vue `crons_sante` et la fonction `marquer_passage_cron` —
-- autrement dit **toute la surveillance des crons de la plateforme**.
--
-- Conséquence concrète tant qu'elle manquait : deux migrations ultérieures agissent sur
-- une table qu'aucun fichier ne créait. `20260902200000_verrouillage_acces_anon` active
-- sa RLS, `20260903180000_edge_sante_version` lui ajoute une colonne — les deux auraient
-- échoué au rejeu.
--
-- Contenu lu en base le 2026-09-03 (`pg_get_viewdef`, `pg_get_functiondef`,
-- `pg_get_constraintdef`, `obj_description`). Rien n'est supposé.
--
-- ── À quelle question cette table répond, et pourquoi elle a dû exister ───────────
--
-- `cron_runs` ne journalise que les ÉCHECS, volontairement. Mais **un cron qui ne tourne
-- plus n'échoue pas : il se tait**, et un silence ne se distingue pas d'un succès. C'est
-- le mode de panne le plus dangereux de la plateforme, parce qu'il ne produit aucun
-- symptôme jusqu'au jour où l'on cherche une donnée qui n'a jamais été collectée.
--
-- ⚠️ Une ligne par cron, ÉCRASÉE à chaque passage : la table ne grossit jamais, aucune
-- purge à prévoir. C'est ce qui la distingue d'un journal.
--
-- ⚠️ Le seuil de silence vit sur la LIGNE (`silence_max`), pas dans la vue : un cron
-- quotidien et un cron aux 5 minutes n'ont pas le même. Le défaut de 2 jours est absurde
-- pour un cron à la minute — **toujours le poser explicitement à l'inscription**. Règle
-- du projet : environ quatre cadences, jamais moins de deux heures. Un planificateur
-- externe saute un passage de temps en temps, et une alerte qui crie pour un passage
-- manqué est une alerte qu'on apprend à ignorer.
--
-- ⚠️ **Insérer la ligne à l'inscription, sans attendre le premier passage.** Une ligne
-- ABSENTE est invisible pour `crons_sante` : la vue ne peut signaler que le silence d'un
-- cron qu'elle connaît. Le piège s'est produit sur `cron-refresh-tokens`, instrumenté
-- mais jamais inscrit — donc jamais surveillé, exactement le trou qu'on croyait fermer.
--
-- ⚠️ Ne PAS réutiliser `integrations.last_synced_at` pour un cron qui touche Instagram :
-- `poll-leads` l'écrit toutes les 5 minutes, et le battement de l'un masquerait la mort
-- de l'autre. C'est le défaut qui a motivé cette table.
--
-- ── Ce que ce fichier ne fait PAS, et par qui c'est fait ──────────────────────────
--
-- Pas de RLS, pas de `revoke` : `20260902200000_verrouillage_acces_anon` s'en charge, et
-- rejouer ces droits ici les défairait à l'ordre de rejeu. Un `grant` ajoute, il n'enlève
-- rien — la restriction doit rester à un seul endroit.
--
-- La colonne `empreinte` et la version à trois arguments de `marquer_passage_cron`
-- appartiennent à `20260903180000_edge_sante_version` : la fonction créée ici est bien
-- celle d'origine, à deux arguments. Recopier ici la version ultérieure ferait échouer le
-- `drop function ... (text, text)` de cette migration-là.

create table if not exists public.crons_passages (
  nom              text        not null,
  dernier_passage  timestamptz not null default now(),
  silence_max      interval    not null default '2 days'::interval,
  contexte         text,
  primary key (nom)
);

comment on table public.crons_passages is
  'Filigrane de passage des crons. Chaque cron ecrase sa ligne a chaque execution, '
  'succes OU echec : c''est la preuve qu''il tourne encore. Voir la vue crons_sante.';

-- ⚠️⚠️ NE PAS REJOUER CE FICHIER SEUL SUR UNE BASE DÉJÀ À JOUR.
--
-- Mesuré le 2026-09-03 dans une transaction annulée : sur la base actuelle, ce bloc
-- crée la version à DEUX arguments **à côté** de celle à trois posée par
-- `20260903180000_edge_sante_version` — deux signatures coexistent alors, et un appel
-- `rpc('marquer_passage_cron', { p_nom })` devient AMBIGU. Concrètement : chaque cron
-- échoue à chaque passage, et toute la surveillance `crons_sante` tombe d'un coup.
--
-- Ce n'est un problème que si l'on rejoue CE fichier isolément : rejouée dans l'ordre,
-- la chaîne va bien, puisque `20260903180000` commence par
-- `drop function if exists public.marquer_passage_cron(text, text)`.
--
-- Pour remettre une base d'aplomb, rejouer la chaîne ENTIÈRE, jamais un fichier au
-- milieu. C'est vrai de toute migration qui crée une fonction dont une signature
-- ultérieure change.
--
-- ⚠️ `security definer` : la fonction est appelée par des crons qui ne sont pas
-- propriétaires de la table. `set search_path` la protège d'un objet homonyme posé dans
-- un autre schéma du chemin de recherche.
create or replace function public.marquer_passage_cron(
  p_nom text,
  p_contexte text default null
) returns void
language sql
security definer
set search_path to 'public'
as $$
  insert into public.crons_passages (nom, dernier_passage, contexte)
  values (p_nom, now(), p_contexte)
  on conflict (nom) do update
    set dernier_passage = now(), contexte = excluded.contexte;
$$;

create or replace view public.crons_sante as
 SELECT nom,
    dernier_passage,
    silence_max,
    round(EXTRACT(epoch FROM now() - dernier_passage) / 3600::numeric, 1) AS il_y_a_heures,
    contexte,
        CASE
            WHEN (now() - dernier_passage) > silence_max THEN 'SILENCIEUX'::text
            ELSE 'ok'::text
        END AS etat
   FROM crons_passages
  ORDER BY ((now() - dernier_passage) > silence_max) DESC, dernier_passage;

comment on view public.crons_sante is
  'Un cron qui ne s''est pas manifeste depuis plus que son silence_max. Vide de lignes '
  'SILENCIEUX = tous les crons inscrits tournent.';
