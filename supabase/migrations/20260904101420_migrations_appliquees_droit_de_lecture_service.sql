-- `security_invoker = true` fait executer la vue avec les droits de l'APPELANT. Le role
-- `service_role` n'ayant aucun droit sur le schema `supabase_migrations`, la lecture
-- repondait 403 — la vue existait et restait illisible.
--
-- Le reflexe serait de retirer `security_invoker`. Ce serait le mauvais choix : c'est
-- lui qui garantit qu'aucune vue de `public` ne contourne la RLS de ses sources, et
-- l'invariant de `acces_sante_lecture` ne souffre pas d'exception — c'est ce qui le rend
-- increvable. On donne donc le droit manquant plutot que d'affaiblir la vue.
--
-- Portee : SELECT seul, sur la seule table qui liste les migrations, et pour le seul
-- role deja capable de tout faire en SQL. Aucune exposition nouvelle : `service_role`
-- n'est jamais dans un navigateur, il vit dans les variables serveur.

grant usage on schema supabase_migrations to service_role;
grant select on supabase_migrations.schema_migrations to service_role;
