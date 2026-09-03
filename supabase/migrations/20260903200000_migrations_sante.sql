-- Une migration appliquée sans fichier ne laisse AUCUNE trace. Celle-ci la fait crier.
--
-- ── Ce qui s'est passé le 2026-09-03 ───────────────────────────────────────────────
--
-- Sept migrations des 1ᵉʳ au 3 septembre avaient été appliquées à la base sans qu'aucun
-- fichier ne soit écrit dans le dépôt. Venues de quatre sessions différentes, dont celle
-- qui crée `crons_passages`, `crons_sante` et `marquer_passage_cron` — c'est-à-dire toute
-- la surveillance des crons. Deux migrations ultérieures agissaient sur une table
-- qu'aucun fichier ne créait.
--
-- ⚠️ Personne ne l'avait vu, et rien ne pouvait le voir : **il n'existe aucun symptôme**.
-- La base fonctionne, les écrans fonctionnent, les tests passent. La divergence ne se
-- manifeste que le jour où l'on veut rejouer l'histoire — c'est-à-dire trop tard.
--
-- Ce n'est pas un problème de discipline qu'une consigne réglerait : la consigne existait
-- en substance, et sept migrations sont passées à côté en trois jours.
--
-- ── Pourquoi DEUX lignes de démarcation, et pas zéro ───────────────────────────────
--
-- La réconciliation complète est IMPOSSIBLE sur l'historique de ce projet, et c'est
-- mesuré, pas supposé :
--
--   * **185 migrations appliquées n'ont aucun fichier.** Le dossier `supabase/migrations`
--     commence au 2026-07-18 et ne contient pas de schéma initial : les tables `profiles`,
--     `deals`, `calls` ne sont créées par aucun fichier. Le dépôt n'a JAMAIS permis de
--     reconstruire la base.
--   * **16 fichiers n'ont aucune ligne à leur nom**, mais la moitié sont des faux positifs
--     de nommage : `webhook_queue` (fichier) contre `create_webhook_queue` (appliquée),
--     `purge_journaux_machine` contre `purge_journaux_machine_pg_cron`,
--     `rpc_shortio_renomme_colonnes` contre
--     `rpc_shortio_renomme_total_clicks_en_clics_humains`…
--
-- ⚠️ **Il n'existe aucune clé commune fiable.** Le numéro de version en base est généré
-- par l'outil d'application ; l'horodatage du nom de fichier est choisi à la main. Les
-- deux ne coïncident jamais (appliquée `20260903165006 inscrire_les_trois_crons_pg_cron`,
-- fichier `20260903190000_inscrire_les_trois_crons_pg_cron.sql`). Reste le NOM — à
-- condition qu'il soit identique des deux côtés, ce qui n'a pas toujours été le cas.
--
-- Surveiller tout l'historique produirait donc ~200 lignes permanentes, c'est-à-dire une
-- alerte qu'on n'ouvre plus. On trace une ligne, et **chaque ligne est posée là où la
-- mesure dit qu'elle ne produit aucun faux positif** :
--
--   * `SEUIL_APPLIQUEES` = 20260901000000 — vérifié le 2026-09-03 : au-delà, les 23
--     migrations appliquées ont toutes un fichier au même nom (une fois les sept
--     reconstituées). Zéro faux positif. Cette borne aurait attrapé l'incident du jour.
--   * `SEUIL_FICHIERS` = 20260903200000 — plus tardive, et pour une raison précise : le
--     fichier `20260902100000_dernier_snapshot_par_profil.sql` n'a aucune ligne à son nom
--     alors que la vue existe bel et bien. Elle a été appliquée sous un autre nom, et rien
--     ne permet de savoir lequel. Placer la borne avant lui ferait crier l'alerte pour
--     toujours.
--
-- **La convention qui rend tout ceci vrai à l'avenir** : le nom passé à `apply_migration`
-- doit être EXACTEMENT celui du fichier, horodatage retiré. C'est la seule clé commune
-- qui reste, et une divergence de nom est désormais signalée comme une orpheline — ce qui
-- est le bon comportement : sans nom commun, plus rien n'est réconciliable.
--
-- ── Le pont ────────────────────────────────────────────────────────────────────────
--
-- La base ne peut pas lire le dépôt. `scripts/manifeste-migrations.mjs` liste les fichiers,
-- `npm run prebuild` le rejoue à chaque construction Vercel, et
-- `/api/sante/alerte-vues` inscrit la liste dans `migrations_du_depot`. Même mécanique
-- que `edge_sante_version`, faite de la même matière.

-- ⚠️ La clé primaire est le NOM, pas la version — trouvé en remplissant la table pour la
-- première fois, pas en la concevant. **Cinq horodatages de fichiers sont en double dans
-- le dépôt** (`20260819000000`, `20260827000000`, `20260830190000`, `20260830210000`,
-- `20260831170000`) : ils sont choisis à la main, rien ne les rend uniques. Avec la
-- version en clé, cinq fichiers auraient été silencieusement écrasés à l'insertion, et
-- leur absence se serait lue comme « fichier jamais appliqué ».
--
-- Les noms, eux, sont uniques — vérifié sur les 113 fichiers — et c'est de toute façon
-- la seule clé de rapprochement avec la base. Une table dont la clé n'est pas la clé de
-- jointure est une invitation à ce genre de perte.
create table if not exists public.migrations_du_depot (
  nom            text primary key,
  version        text not null,
  mis_a_jour_le  timestamptz not null default now()
);

comment on table public.migrations_du_depot is
  'Une ligne par fichier de supabase/migrations/, ecrite par /api/sante/alerte-vues a '
  'chaque passage. La base ne peut pas lire le depot : cette table est le pont. Ne '
  'jamais la remplir a la main.';

-- ⚠️ RLS obligatoire, sinon cette table tombe dans `acces_sante_lecture` : les privileges
-- par defaut du schema `public` la rendraient lisible par `anon` sans qu'aucun `grant` ne
-- soit ecrit. Aucune policy = `service_role` seul, qui contourne la RLS.
alter table public.migrations_du_depot enable row level security;

-- ⚠️ PAS de `security_invoker` sur cette vue, contrairement aux autres vues de sante, et
-- ce n'est pas un oubli : `service_role` n'a meme pas `USAGE` sur le schema
-- `supabase_migrations` (verifie le 2026-09-03 — « permission denied for schema »). La
-- vue doit donc s'executer avec les droits de son PROPRIETAIRE. Sa fermeture a `anon` et
-- `authenticated` ci-dessous est ce qui la protege, et `acces_sante_lecture` le verifie.
create or replace view public.migrations_sante as
with appliquees as (
  select version, name as nom from supabase_migrations.schema_migrations
),
fichiers as (
  select version, nom from public.migrations_du_depot
)
select
  a.nom,
  a.version                          as version_appliquee,
  null::text                         as version_fichier,
  'ALERTE appliquee sans fichier'::text as anomalie
from appliquees a
where a.version >= '20260901000000'
  and not exists (select 1 from fichiers f where f.nom = a.nom)

union all

select
  f.nom,
  null::text,
  f.version,
  'ALERTE fichier jamais applique'::text
from fichiers f
where f.version >= '20260903200000'
  and not exists (select 1 from appliquees a where a.nom = f.nom);

comment on view public.migrations_sante is
  'Vide = le depot et la base racontent la meme histoire recente. Une ligne '
  '« appliquee sans fichier » signifie qu''un changement de schema n''existe QUE dans la '
  'base : invisible au depot, perdu a toute reconstruction, et sans aucun symptome. '
  '⚠️ Ne couvre que les migrations recentes — 185 migrations anciennes n''ont aucun '
  'fichier, et il n''existe pas de cle commune fiable pour les rapprocher. Les bornes '
  'sont dans le fichier de migration, avec la mesure qui les justifie. '
  '⚠️ La cle est le NOM : celui passe a apply_migration doit etre exactement celui du '
  'fichier, horodatage retire.';

revoke select on public.migrations_sante from anon, authenticated;
grant select on public.migrations_sante to service_role;
