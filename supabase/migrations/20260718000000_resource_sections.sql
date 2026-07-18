-- Une table resource_sections existait déjà avec un schéma incompatible
-- (title/locked, pas de parent_id, donc aucune hiérarchie possible) et n'était
-- exploitée par aucun code — remplacée ici par le schéma dossiers/sous-dossiers.
-- Une ressource pointait dessus ("360 Viral") : on la détache d'abord (remonte à "Toutes les ressources").
update public.resources set section_id = null where section_id is not null;

drop table if exists public.resource_sections cascade;

-- Dossiers/sous-dossiers de ressources (2 niveaux max, façon Notion)
create table public.resource_sections (
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

-- FK sur resources.section_id (le drop cascade ci-dessus a supprimé l'ancienne contrainte)
alter table public.resources
  add constraint resources_section_id_fkey
  foreign key (section_id) references public.resource_sections(id) on delete set null;

create index if not exists idx_resource_sections_coach_id on public.resource_sections(coach_id);
create index if not exists idx_resource_sections_parent_id on public.resource_sections(parent_id);
create index if not exists idx_resources_section_id on public.resources(section_id);

-- RLS — alignée sur les policies réelles de `resources` ("resources coach" = coach_id = auth.uid())
-- et réutilise la fonction existante client_has_resource_access(resource_id).
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
      where r.section_id = resource_sections.id
        and public.client_has_resource_access(r.id)
    )
    or exists (
      select 1 from public.resource_sections child
      join public.resources r on r.section_id = child.id
      where child.parent_id = resource_sections.id
        and public.client_has_resource_access(r.id)
    )
  );
