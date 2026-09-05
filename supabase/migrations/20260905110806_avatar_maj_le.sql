-- RECONSTITUTION — le fichier manquait, la migration était appliquée.
--
-- Appliquée le 2026-09-05 à 11:08 (version 20260905110806) sans que son fichier soit
-- écrit. `migrations_sante` l'a signalée comme « appliquée sans fichier ».
--
-- ⚠️ Le SQL ci-dessous n'est PAS reconstruit à partir de l'état de la base : il est
-- recopié VERBATIM depuis `supabase_migrations.schema_migrations.statements`, qui
-- conserve les instructions exactes de chaque migration appliquée. Rien n'est inventé,
-- rien n'est déduit.
--
-- ⚠️ NE PAS REJOUER en croyant qu'il manque quelque chose : cette colonne a été
-- RETIRÉE quatre minutes plus tard par `20260905111210_retrait_avatar_maj_le.sql`.
-- L'effet net des deux est nul, et la colonne n'existe pas aujourd'hui (vérifié dans
-- `information_schema.columns` le 2026-09-05). Les deux fichiers existent pour que le
-- dépôt raconte la même histoire que la base, pas pour être appliqués.

alter table public.instagram_leads
  add column if not exists avatar_maj_le timestamptz;

comment on column public.instagram_leads.avatar_maj_le is
  'Derniere recuperation reussie de avatar_url. NULL = jamais mesuree, donc a rafraichir. Delai minimum entre deux rafraichissements : voir JOURS_AVANT_RAFRAICHISSEMENT dans lib/instagram-avatar.ts.';
