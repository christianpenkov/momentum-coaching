-- ============================================================
-- Rapport de fin d'appel coach-élève + Page Tâches
-- À exécuter manuellement dans le SQL Editor Supabase (dashboard).
-- Cohérent avec le mode opératoire existant : aucune table de ce
-- repo (calls, tasks, clients...) n'a de migration versionnée,
-- toutes ont été créées/évoluées directement en base.
-- ============================================================

-- ─── Partie A : Rapport de fin d'appel coach-élève ───────────

-- A1. Colonnes sur calls
alter table calls
  add column if not exists session_completed boolean,
  add column if not exists session_no_show boolean,
  add column if not exists session_rapport_reminder_sent boolean not null default false;

-- A2. Table session_reports
create table if not exists session_reports (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references calls(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  coach_id uuid not null references profiles(id) on delete cascade,
  attended boolean,         -- nullable : la ligne peut exister avant que le coach ait répondu
  topic text check (topic in ('strategie_contenu','closing_vente','mindset_blocage','technique_outils','autre') or topic is null),
  notes text,               -- notes du coach, privées, jamais vues par l'élève
  student_notes text,       -- notes de l'élève, privées, jamais vues par le coach
  structured_answers jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint session_reports_call_id_unique unique (call_id)
);
create index if not exists idx_session_reports_client_id on session_reports(client_id, created_at desc);
create index if not exists idx_session_reports_coach_id on session_reports(coach_id);

-- RLS : coach voit/écrit les rapports de ses propres élèves ; élève voit/écrit uniquement student_notes des siens.
alter table session_reports enable row level security;

drop policy if exists "coach_full_access_session_reports" on session_reports;
create policy "coach_full_access_session_reports" on session_reports
  for all
  using (coach_id = auth.uid())
  with check (coach_id = auth.uid());

drop policy if exists "client_read_own_session_reports" on session_reports;
create policy "client_read_own_session_reports" on session_reports
  for select
  using (client_id in (select id from clients where profile_id = auth.uid()));

-- Note : l'écriture élève (student_notes uniquement) passe par la route API
-- (service role, contrôle applicatif), pas par une policy RLS directe côté client JS,
-- pour éviter qu'un élève écrive dans attended/topic/notes via une policy trop permissive.

-- ─── Partie B : Page Tâches ───────────────────────────────────

-- B2. Extension de tasks + nouvelle table task_attachments
alter table tasks
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists created_by uuid references profiles(id);

create table if not exists task_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  uploaded_by uuid not null references profiles(id),
  file_url text not null,
  thumbnail_url text,
  file_name text not null,
  file_size_bytes integer,
  file_type text,
  created_at timestamptz not null default now()
);
create index if not exists idx_task_attachments_task_id on task_attachments(task_id);

alter table task_attachments enable row level security;

drop policy if exists "coach_or_client_access_task_attachments" on task_attachments;
create policy "coach_or_client_access_task_attachments" on task_attachments
  for all
  using (
    task_id in (
      select t.id from tasks t
      join clients c on c.id = t.client_id
      where c.coach_id = auth.uid() or c.profile_id = auth.uid()
    )
  )
  with check (
    task_id in (
      select t.id from tasks t
      join clients c on c.id = t.client_id
      where c.coach_id = auth.uid() or c.profile_id = auth.uid()
    )
  );

-- ============================================================
-- Étape manuelle supplémentaire (hors SQL) :
-- Créer le bucket Storage "task-attachments" dans le dashboard
-- Supabase (Storage > New bucket), public read, comme les buckets
-- "resources" et "chat-medias" déjà en place.
-- ============================================================
