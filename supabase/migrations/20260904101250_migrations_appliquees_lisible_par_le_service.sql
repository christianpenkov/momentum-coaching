-- La liste des migrations APPLIQUEES, lisible depuis un script local.
--
-- ── Pourquoi `migrations_sante` ne suffit pas pour un controle AVANT le push ──
--
-- Cette vue compare la base a `migrations_du_depot`, table alimentee par
-- `/api/sante/alerte-vues` avec les migrations du BUILD VERCEL DEPLOYE. Au moment ou
-- une session lance `npm test`, avant d'avoir pousse, cette table est donc EN RETARD :
-- une migration qu'on vient d'appliquer et dont on vient d'ecrire le fichier y
-- apparaitrait comme « appliquee sans fichier ». Un faux positif systematique, a
-- l'instant precis ou l'on veut un signal fiable.
--
-- Le controle local (`scripts/verifier-migrations.mjs`, branche sur `npm test`) doit
-- donc confronter les FICHIERS DU DISQUE a la liste appliquee, sans passer par le pont
-- Vercel. D'ou cette vue : elle n'expose que ce que
-- `supabase_migrations.schema_migrations` contient deja, rien de plus.
--
-- `schema_migrations` vit dans un schema que PostgREST n'expose pas ; un script n'a
-- donc aucun moyen de la lire. C'est la seule raison d'etre de cette vue.
--
-- ── Le patron de securite, repris a l'identique ──────────────────────────────
-- Les privileges par defaut de Supabase rendent TOUTE vue nouvelle de `public`
-- lisible par `anon` et `authenticated`, sans qu'aucun grant ne soit ecrit, et
-- `security_invoker` valant false, elle s'executerait avec les droits de son
-- proprietaire. Les trois lignes ci-dessous sont donc obligatoires — sans elles,
-- cette vue apparaitrait immediatement dans `acces_sante_lecture`.
--
-- Le contenu n'est pas sensible (des noms de migrations), mais l'invariant ne souffre
-- pas d'exception : c'est ce qui le rend increvable.

create or replace view public.migrations_appliquees as
  select version, name as nom
  from supabase_migrations.schema_migrations;

comment on view public.migrations_appliquees is
  'Liste brute des migrations appliquees, pour qu''un script local puisse la comparer '
  'aux fichiers du disque AVANT un push. Ne pas confondre avec `migrations_sante`, qui '
  'compare a `migrations_du_depot` — celle-ci reflete le dernier build Vercel deploye, '
  'donc en retard au moment d''un `npm test`.';

revoke select on public.migrations_appliquees from anon, authenticated;
alter view public.migrations_appliquees set (security_invoker = true);
grant select on public.migrations_appliquees to service_role;
