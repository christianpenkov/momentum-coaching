-- Dossiers/sous-dossiers de ressources (2 niveaux max, façon Notion)
create table if not exists public.resource_sections (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  parent_id uuid references public.resource_sections(id) on delete restrict,
  position integer not null default 0,
  icon text not null default 'folder',
  created_at timestamptz not null default now()
);

-- Garde-fou "2 niveaux max" côté serveur (en plus de la validation UI)
create or replace function public.enforce_resource_section_depth()
returns trigger
language plpgsql
as $$
declare
  grandparent uuid;
begin
  if new.parent_id is not null then
    if new.parent_id = new.id then
      raise exception 'Un dossier ne peut pas être son propre parent';
    end if;
    select parent_id into grandparent from public.resource_sections where id = new.parent_id;
    if grandparent is not null then
      raise exception 'Profondeur maximale de 2 niveaux atteinte';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_resource_section_depth on public.resource_sections;
create trigger trg_resource_section_depth
  before insert or update of parent_id on public.resource_sections
  for each row execute function public.enforce_resource_section_depth();

-- FK sur resources.section_id (colonne déjà existante, non contrainte à ce jour)
alter table public.resources
  add constraint resources_section_id_fkey
  foreign key (section_id) references public.resource_sections(id) on delete set null;

create index if not exists idx_resource_sections_coach_id on public.resource_sections(coach_id);
create index if not exists idx_resource_sections_parent_id on public.resource_sections(parent_id);
create index if not exists idx_resources_section_id on public.resources(section_id);

-- RLS — hypothèse par analogie avec le pattern observé côté code (coach_id = auth.uid()).
-- À VALIDER contre les policies réelles de `resources` avant application.
alter table public.resource_sections enable row level security;

create policy "Coach can manage own sections"
  on public.resource_sections
  for all
  using (coach_id = auth.uid())
  with check (coach_id = auth.uid());

-- Élève : lecture seule des dossiers contenant au moins une ressource déverrouillée pour lui
-- (directement, ou via un sous-dossier de ce dossier).
create policy "Client can read sections with unlocked resources"
  on public.resource_sections
  for select
  using (
    exists (
      select 1 from public.resources r
      join public.resource_access ra on ra.resource_id = r.id
      where r.section_id = resource_sections.id
        and ra.client_id = auth.uid()
        and ra.unlocked = true
    )
    or exists (
      select 1 from public.resource_sections child
      join public.resources r on r.section_id = child.id
      join public.resource_access ra on ra.resource_id = r.id
      where child.parent_id = resource_sections.id
        and ra.client_id = auth.uid()
        and ra.unlocked = true
    )
  );
