-- Isolation des données Instagram par compte connecté (bascule + archivage).
-- ig_account_id : figé à l'écriture (comme prospect_links.source_at_creation), utilisé
-- uniquement par le callback OAuth pour savoir quoi désarchiver lors d'une reconnexion
-- vers un compte déjà vu — jamais lu/filtré ailleurs dans le code applicatif.
-- archived_at : filtre d'affichage simple (comme deleted_at déjà en place sur
-- analytics_ig_posts_history) — jamais de DELETE, seulement marquer/démarquer.

alter table analytics_ig_posts_history add column if not exists ig_account_id text;
alter table analytics_ig_posts_history add column if not exists archived_at timestamptz;

alter table analytics_ig_stories_history add column if not exists ig_account_id text;
alter table analytics_ig_stories_history add column if not exists archived_at timestamptz;

alter table ig_stories add column if not exists ig_account_id text;
alter table ig_stories add column if not exists archived_at timestamptz;

alter table instagram_leads add column if not exists ig_account_id text;
alter table instagram_leads add column if not exists archived_at timestamptz;

alter table instagram_lead_lm_history add column if not exists ig_account_id text;
alter table instagram_lead_lm_history add column if not exists archived_at timestamptz;

alter table content_links add column if not exists ig_account_id text;
alter table content_links add column if not exists archived_at timestamptz;

alter table ig_post_meta add column if not exists ig_account_id text;
alter table ig_post_meta add column if not exists archived_at timestamptz;

alter table analytics_daily_snapshots add column if not exists ig_account_id text;
alter table analytics_daily_snapshots add column if not exists archived_at timestamptz;

-- Backfill : toutes les lignes existantes appartiennent au compte IG ACTUELLEMENT
-- connecté pour leur profil (vrai pour l'immense majorité des profils qui n'ont jamais
-- changé de compte ; le seul cas de test connu a déjà été manuellement nettoyé en base).
update analytics_ig_posts_history t
  set ig_account_id = (i.metadata->>'ig_account_id')
  from integrations i
  where i.profile_id = t.profile_id and i.provider = 'instagram' and t.ig_account_id is null;

update analytics_ig_stories_history t
  set ig_account_id = (i.metadata->>'ig_account_id')
  from integrations i
  where i.profile_id = t.profile_id and i.provider = 'instagram' and t.ig_account_id is null;

update ig_stories t
  set ig_account_id = (i.metadata->>'ig_account_id')
  from integrations i
  where i.profile_id = t.profile_id and i.provider = 'instagram' and t.ig_account_id is null;

update instagram_leads t
  set ig_account_id = (i.metadata->>'ig_account_id')
  from integrations i
  where i.profile_id = t.profile_id and i.provider = 'instagram' and t.ig_account_id is null;

update instagram_lead_lm_history t
  set ig_account_id = (i.metadata->>'ig_account_id')
  from integrations i
  where i.profile_id = t.profile_id and i.provider = 'instagram' and t.ig_account_id is null;

update content_links t
  set ig_account_id = (i.metadata->>'ig_account_id')
  from integrations i
  where i.profile_id = t.profile_id and i.provider = 'instagram' and t.ig_account_id is null;

update ig_post_meta t
  set ig_account_id = (i.metadata->>'ig_account_id')
  from integrations i
  where i.profile_id = t.profile_id and i.provider = 'instagram' and t.ig_account_id is null;

update analytics_daily_snapshots t
  set ig_account_id = (i.metadata->>'ig_account_id')
  from integrations i
  where i.profile_id = t.profile_id and i.provider = 'instagram' and t.ig_account_id is null;

comment on column instagram_leads.ig_account_id is 'Compte Instagram propriétaire au moment de la création de cette ligne (figé, jamais réécrit) — utilisé uniquement par le callback OAuth pour désarchiver au bon moment lors d''une reconnexion vers un compte déjà vu.';
comment on column instagram_leads.archived_at is 'Posé quand le profil bascule vers un autre compte Instagram (callback OAuth) — jamais de DELETE. Filtre d''affichage uniquement : archived_at IS NULL = données du compte actuellement connecté.';
