-- RECONSTITUTION — le fichier manquait, la migration était appliquée.
--
-- Appliquée le 2026-09-05 à 11:12 (version 20260905111210) sans que son fichier soit
-- écrit. Elle retire la colonne posée quatre minutes plus tôt par
-- `20260905110806_avatar_maj_le.sql` : l'effet net des deux est nul.
--
-- ⚠️ SQL recopié VERBATIM depuis `supabase_migrations.schema_migrations.statements`,
-- commentaire d'origine compris. Rien n'est reconstruit à partir de l'état de la base.
--
-- État vérifié le 2026-09-05 : la colonne `instagram_leads.avatar_maj_le` n'existe pas.

-- Ajoutee puis retiree le 2026-09-05, jamais remplie (0 ligne), jamais lue par
-- aucun code. Decision de Chris : on ne rafraichit jamais la photo d'un lead.
alter table public.instagram_leads drop column if exists avatar_maj_le;
