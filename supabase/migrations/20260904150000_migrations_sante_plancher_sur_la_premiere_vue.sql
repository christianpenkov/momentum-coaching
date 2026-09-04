-- Un fichier neuf ne doit pas pouvoir passer sous le plancher en portant une date ancienne
--
-- ⚠️ LE DÉFAUT, trouvé par la session Stats Clients le 2026-09-04.
--
-- La branche « fichier jamais appliqué » portait un plancher sur `f.version`,
-- c'est-à-dire sur **l'horodatage du NOM DE FICHIER** — une valeur saisie à la main.
-- `dernier_snapshot_par_profil` a été écrit le 4 septembre mais daté du 2 : il tombait
-- donc un jour sous le plancher, et la vue ne pouvait pas le voir alors qu'il faisait
-- partie du même travail. Il a fallu une requête manuelle pour le trouver.
--
-- Le plancher n'était pas l'erreur — sans lui, quinze fichiers historiques crieraient
-- chaque jour. L'erreur était **ce sur quoi il portait**. On ne borne pas une
-- surveillance avec une valeur que son auteur choisit librement.
--
-- ── Ce qui le remplace ─────────────────────────────────────────────────────────────
--
-- Deux mécanismes, aucun ne reposant sur une date saisie à la main :
--
-- 1. **`vu_le`** : la date à laquelle le dépôt a montré ce fichier pour la PREMIÈRE
--    fois. Posée à l'insertion, jamais mise à jour — la route ne l'envoie pas dans son
--    `upsert`, donc `on conflict do update` ne peut pas y toucher. Elle sert de délai de
--    grâce : écrire le fichier PUIS appliquer la migration est un ordre légitime, et
--    sans grâce la vue crierait dans l'intervalle.
--
-- 2. **`migrations_ecarts_historiques`** : les quinze exceptions, NOMMÉES une par une.
--    Une liste fermée qui ne grandira jamais toute seule vaut mieux qu'une date qui
--    laisse passer tout ce qui se présente avec le bon costume.
--
-- ⚠️ Chacune des quinze a été VÉRIFIÉE présente en base avant d'être gelée, le
-- 2026-09-04. Geler sans vérifier aurait transformé un angle mort en angle mort
-- **documenté**, ce qui est pire : on cesse de chercher.
--
-- ⚠️ Et une leçon de méthode payée en route : trois d'entre elles avaient d'abord été
-- déclarées « absentes » parce que j'avais DEVINÉ le nom de leur colonne au lieu de le
-- lire dans le fichier. Une sonde inventée produit un faux négatif indiscernable d'un
-- vrai. Les trois sont en réalité présentes — deux sont des migrations de DONNÉES, qui
-- ne laissent aucune empreinte de schéma et ne se vérifient que par leur CONSÉQUENCE.

alter table public.migrations_du_depot
  add column if not exists vu_le timestamptz not null default now();

comment on column public.migrations_du_depot.vu_le is
  'Quand le depot a montre ce fichier pour la PREMIERE fois. Posee a l''insertion, '
  'jamais mise a jour : la route ne l''envoie pas dans son upsert. Sert de delai de '
  'grace — ecrire le fichier puis appliquer la migration est un ordre legitime.';

create table if not exists public.migrations_ecarts_historiques (
  nom    text primary key,
  motif  text not null
);

comment on table public.migrations_ecarts_historiques is
  'Les fichiers de migration anterieurs a la mise en place du rapprochement, dont le nom '
  'ne correspond a aucune ligne du registre. Chacun a ete VERIFIE present en base le '
  '2026-09-04. Liste FERMEE : elle ne doit jamais grandir. Une ligne de plus signifie '
  'qu''on a renonce a comprendre un ecart, pas qu''on l''a resolu.';

-- ⚠️ RLS, sinon la table tombe dans `acces_sante_lecture` : les privileges par defaut du
-- schema `public` la rendraient lisible par `anon` sans qu'aucun `grant` ne soit ecrit.
alter table public.migrations_ecarts_historiques enable row level security;

insert into public.migrations_ecarts_historiques (nom, motif) values
  -- Appliquees sous un nom voisin : le rapprochement se fait par le NOM, et il differe.
  ('webhook_queue',                          'appliquee sous « create_webhook_queue »'),
  ('set_integration_metadata_key_rpc',       'appliquee sous « add_set_integration_metadata_key_rpc »'),
  ('purge_journaux_machine',                 'appliquee sous « purge_journaux_machine_pg_cron »'),
  ('upsert_shortio_mode_ecrasement',         'appliquee sous « upsert_shortio_snapshot_mode_ecrasement »'),
  ('rpc_shortio_links_agreges_service_role', 'appliquee sous « rpc_shortio_links_agreges_autorise_service_role »'),
  ('rpc_shortio_renomme_colonnes',           'appliquee sous « rpc_shortio_renomme_total_clicks_en_clics_humains »'),
  -- Verifiees par la PRESENCE de la colonne qu'elles creent (nom lu dans le fichier).
  ('add_instagram_leads_not_a_lead',         'verifiee : instagram_leads.not_a_lead existe'),
  ('add_prospects_not_a_lead',               'verifiee : prospects.not_a_lead existe'),
  ('add_lm_history_comment_id',              'verifiee : instagram_lead_lm_history.comment_id existe'),
  ('add_integrations_first_connected_at',    'verifiee : integrations.first_connected_at existe'),
  ('add_integrations_ready_at_gate',         'verifiee : clients.integrations_ready_at existe'),
  ('dm2_fields_and_dm3_delay',               'verifiee : content_links.dm_link_message, dm_link_button_text et instagram_leads.dm3_scheduled_at existent'),
  -- Migrations de DONNEES : aucune empreinte de schema, verifiees par leur CONSEQUENCE.
  ('remboursements_dates_du_paiement_dorigine', 'verifiee par consequence : 0 paiement refunded sans paid_at'),
  ('story_sequences_textes_par_defaut',      'verifiee par consequence : 0 sequence portant encore un gabarit {{...}}'),
  ('utm_medium_coherence',                   'verifiee par consequence : 0 call calendly dont utm_medium contredit sa source ig_/yt_')
on conflict (nom) do update set motif = excluded.motif;

create or replace view public.migrations_sante as
with instantane as (
  select max(mis_a_jour_le) as pris_le from public.migrations_du_depot
),
appliquees as (
  select version, name as nom from supabase_migrations.schema_migrations
),
fichiers as (
  select version, nom, vu_le from public.migrations_du_depot
)
select
  a.nom,
  a.version                             as version_appliquee,
  null::text                            as version_fichier,
  'ALERTE appliquee sans fichier'::text as anomalie
from appliquees a, instantane i
where a.version >= '20260901000000'
  and i.pris_le is not null
  and a.version < to_char(i.pris_le at time zone 'UTC', 'YYYYMMDDHH24MISS')
  and not exists (select 1 from fichiers f where f.nom = a.nom)

union all

select
  f.nom,
  null::text,
  f.version,
  'ALERTE fichier jamais applique'::text
from fichiers f
-- ⚠️ PLUS DE PLANCHER SUR `f.version` : c'est ce qui laissait passer un fichier neuf
-- portant une date ancienne. Deux conditions le remplacent, aucune choisie a la main.
where f.vu_le < now() - interval '4 hours'
  and not exists (select 1 from public.migrations_ecarts_historiques e where e.nom = f.nom)
  and not exists (select 1 from appliquees a where a.nom = f.nom)

union all

select
  'instantane du depot'::text,
  null::text,
  coalesce(to_char((select pris_le from instantane), 'YYYY-MM-DD HH24:MI'), 'jamais'),
  'ALERTE instantane du depot perime — la route ne le rafraichit plus'::text
from instantane i
where i.pris_le is null or i.pris_le < now() - interval '4 hours';

comment on view public.migrations_sante is
  'Vide = le depot et la base racontent la meme histoire recente. La cle de '
  'rapprochement est le NOM : celui passe a apply_migration doit etre exactement celui '
  'du fichier, horodatage retire. Un fichier dispose de 4 heures de grace avant d''etre '
  'juge (ecrire puis appliquer est un ordre legitime). Les quinze ecarts anterieurs a la '
  'mise en place sont NOMMES dans migrations_ecarts_historiques, chacun verifie present '
  'en base — cette liste ne doit jamais grandir.';

revoke select on public.migrations_sante from anon, authenticated;
grant select on public.migrations_sante to service_role;
