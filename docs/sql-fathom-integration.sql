-- ============================================================
-- Intégration Fathom — enregistrements, résumés, transcripts d'appel
-- À exécuter manuellement dans le SQL Editor Supabase (dashboard).
-- Cohérent avec le mode opératoire existant : aucune table de ce
-- repo (calls, tasks, clients...) n'a de migration versionnée,
-- toutes ont été créées/évoluées directement en base.
-- ============================================================

-- 1. Colonnes Fathom sur calls
alter table calls
  add column if not exists fathom_recording_id text,
  add column if not exists fathom_share_url text,
  add column if not exists fathom_summary text,
  add column if not exists fathom_action_items jsonb,
  add column if not exists fathom_transcript text,
  add column if not exists fathom_status text
    check (fathom_status in ('pending','matched','unmatched','not_recorded') or fathom_status is null),
  add column if not exists fathom_matched_at timestamptz;

-- Idempotence webhook : un recording_id Fathom ne doit matcher qu'un seul call
create unique index if not exists idx_calls_fathom_recording_id
  on calls(fathom_recording_id) where fathom_recording_id is not null;

-- Accélère la recherche par URL de jonction (matching prioritaire du webhook)
create index if not exists idx_calls_join_url on calls(join_url) where join_url is not null;
create index if not exists idx_calls_meet_link on calls(meet_link) where meet_link is not null;

-- 2. Table des enregistrements Fathom non rattachés à un call existant
-- (aucun call trouvé par URL exacte ni par email+créneau — le coach rattache manuellement)
create table if not exists fathom_unmatched (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  fathom_recording_id text not null unique,
  fathom_share_url text,
  fathom_summary text,
  fathom_action_items jsonb,
  fathom_transcript text,
  meeting_title text,
  meeting_url text,
  calendar_invitees jsonb,
  recording_start_time timestamptz,
  recording_end_time timestamptz,
  resolved_call_id uuid references calls(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_fathom_unmatched_profile_id
  on fathom_unmatched(profile_id) where resolved_call_id is null;

alter table fathom_unmatched enable row level security;

drop policy if exists "coach_full_access_fathom_unmatched" on fathom_unmatched;
create policy "coach_full_access_fathom_unmatched" on fathom_unmatched
  for all
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- Note : écriture/lecture passent uniquement par routes API (service role) côté
-- webhook et rattachement manuel — la policy ci-dessus couvre la lecture directe
-- côté client JS pour la vue coach "Enregistrements non rattachés".

-- 3. RPC de lookup profil par email — recherche directe indexée sur auth.users,
-- utilisée par le webhook Fathom pour résoudre le profile_id d'un enregistrement
-- non rattaché (recorded_by.email). Remplace auth.admin.listUsers() côté webhook,
-- qui ne retourne que les 50 premiers utilisateurs par défaut (pagination
-- silencieuse) et cesserait de trouver certains profils au-delà de cette limite.
create or replace function public.get_profile_id_by_email(p_email text)
returns uuid
language sql
security definer
set search_path = public, auth
as $$
  select id from auth.users where email = p_email limit 1;
$$;

revoke all on function public.get_profile_id_by_email(text) from public, anon, authenticated;
grant execute on function public.get_profile_id_by_email(text) to service_role;
