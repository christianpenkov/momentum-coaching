-- Feature Stories Instagram + séquences
-- Voir plan: C:\Users\chris\.claude\plans\ok-nous-ici-on-proud-rocket.md

-- Catalogue des stories détectées (média + rattachement séquence)
create table if not exists story_sequences (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  cta_type text not null check (cta_type in ('lead_magnet', 'calendly')),
  cta_story_id uuid, -- FK ajoutée après création de ig_stories (dépendance circulaire)
  lm_keyword text,
  lm_id uuid references lead_magnets(id),
  lm_url text,
  dm1_message text,
  dm2_story_message text,
  calendly_short_url text,
  calendly_dest_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists story_sequences_profile_idx on story_sequences(profile_id, created_at desc);

create table if not exists ig_stories (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  ig_story_id text not null,
  media_type text,
  storage_path text,
  storage_url text,
  permalink text,
  posted_at timestamptz not null,
  first_seen_at timestamptz not null default now(),
  expired_at timestamptz,
  sequence_id uuid references story_sequences(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (profile_id, ig_story_id)
);
create index if not exists ig_stories_profile_posted_idx on ig_stories(profile_id, posted_at desc);
create index if not exists ig_stories_sequence_idx on ig_stories(sequence_id);

alter table story_sequences
  add constraint story_sequences_cta_story_id_fkey
  foreign key (cta_story_id) references ig_stories(id) on delete set null;

-- Snapshot quotidien des insights par story (pattern analytics_ig_posts_history)
create table if not exists analytics_ig_stories_history (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  ig_story_id text not null,
  reach int,
  replies int,
  shares int,
  reposts int,
  views int,
  total_views int,
  link_clicks int,
  follows int,
  profile_visits int,
  navigation_taps_forward int,
  navigation_taps_back int,
  navigation_exits int,
  total_interactions int,
  snapshot_date date not null,
  snapshot_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (profile_id, ig_story_id, snapshot_date)
);
create index if not exists analytics_ig_stories_history_profile_date_idx on analytics_ig_stories_history(profile_id, snapshot_date desc);

-- Rattachement des leads Instagram issus d'un reply à une story
alter table instagram_leads
  add column if not exists awaiting_story_followup boolean not null default false,
  add column if not exists story_sequence_id uuid references story_sequences(id),
  add column if not exists story_id uuid references ig_stories(id);

alter table instagram_leads drop constraint if exists instagram_leads_source_check;
alter table instagram_leads
  add constraint instagram_leads_source_check
  check (source = ANY (ARRAY['dm'::text, 'comment'::text, 'cold_dm'::text, 'story_reply'::text]));

alter table ig_stories enable row level security;
alter table story_sequences enable row level security;
alter table analytics_ig_stories_history enable row level security;

create policy "owner access" on ig_stories for all
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());
create policy "coach sees client ig_stories" on ig_stories for select
  using (exists (select 1 from clients where clients.profile_id = ig_stories.profile_id and clients.coach_id = auth.uid()));

create policy "owner access" on story_sequences for all
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());
create policy "coach sees client story_sequences" on story_sequences for select
  using (exists (select 1 from clients where clients.profile_id = story_sequences.profile_id and clients.coach_id = auth.uid()));

create policy "owner access" on analytics_ig_stories_history for all
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());
create policy "coach sees client analytics_ig_stories_history" on analytics_ig_stories_history for select
  using (exists (select 1 from clients where clients.profile_id = analytics_ig_stories_history.profile_id and clients.coach_id = auth.uid()));
