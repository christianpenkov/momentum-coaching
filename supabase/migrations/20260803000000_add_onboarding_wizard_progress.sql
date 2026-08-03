-- Progression du wizard d'onboarding (coach ET élève). onboarding_step est un état
-- fini simple (machine à état légère, string) ; onboarding_data est un jsonb libre
-- pour ce qui ne mérite pas sa propre colonne (étapes vues, outils skip volontairement,
-- horodatages ponctuels).
--
-- Distinct de clients.onboarding_completed_at, qui sert de borne (floor) pour le calcul
-- d'analytics dans PageClientStats.tsx — ne pas confondre les deux, ne pas réutiliser
-- l'un pour l'autre.

alter table profiles add column if not exists onboarding_step text not null default 'not_started';
alter table profiles add column if not exists onboarding_data jsonb not null default '{}'::jsonb;

alter table clients add column if not exists onboarding_step text not null default 'not_started';
alter table clients add column if not exists onboarding_data jsonb not null default '{}'::jsonb;

-- Backfill : tous les comptes coach et élèves existants ne doivent JAMAIS revoir le
-- wizard automatiquement au prochain login. Sans ce backfill, le DEFAULT 'not_started'
-- ci-dessus déclencherait le wizard à la prochaine connexion de tous les utilisateurs
-- actuels.
update profiles set onboarding_step = 'completed' where onboarding_step = 'not_started';
update clients set onboarding_step = 'completed' where onboarding_step = 'not_started';

comment on column profiles.onboarding_step is 'État du wizard d''onboarding coach : not_started | in_progress | completed. Backfill initial : completed pour tous les comptes créés avant l''introduction du wizard.';
comment on column profiles.onboarding_data is 'Détail libre de la progression (étapes vues/skip, ex: {"instagram_skipped_at": "..."}) — jsonb pour flexibilité, pas de schéma figé.';
comment on column clients.onboarding_step is 'État du wizard d''onboarding élève : not_started | in_progress | completed. Distinct de clients.onboarding_completed_at qui sert de borne analytics (PageClientStats.tsx) — NE PAS confondre.';
comment on column clients.onboarding_data is 'Détail libre de la progression élève (même structure que profiles.onboarding_data).';

-- Note RLS : pas de nouvelle policy ajoutée ici. saveProfile() dans PageSettings.tsx/
-- PageClientSettings.tsx fait déjà des update()/upsert() réussis sur profiles pour
-- l'utilisateur courant via le client de session (pas le service role — confirmé en
-- lisant app/api/oauth/calendly/route.ts, qui utilise createServerClient + cookies,
-- pas SUPABASE_SERVICE_ROLE_KEY). Une policy UPDATE permissive existe donc déjà en
-- base pour le propriétaire de la ligne (créée à la main, comme le reste du schéma
-- RLS de ce projet — jamais versionné en SQL). Ajouter ici une policy sans voir
-- l'existante risquerait de la dupliquer ou de la contredire.
-- app/api/onboarding/progress/route.ts suit ce même pattern (client de session).
