-- La policy élève précédente référençait resource_sections à l'intérieur
-- de sa propre sous-requête (self-jointure sur une table protégée par RLS),
-- ce que Postgres détecte comme récursion infinie (42P17). On la remplace
-- par une fonction SECURITY DEFINER (comme client_has_resource_access) qui
-- contourne le RLS pour son propre calcul interne, cassant la boucle.

create or replace function public.client_can_read_section(p_section_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from resources r
    where r.section_id = p_section_id
      and client_has_resource_access(r.id)
  )
  or exists (
    select 1 from resource_sections child
    join resources r on r.section_id = child.id
    where child.parent_id = p_section_id
      and client_has_resource_access(r.id)
  );
$$;

drop policy if exists "Client can read sections with unlocked resources" on public.resource_sections;

create policy "Client can read sections with unlocked resources"
  on public.resource_sections
  for select
  using (client_can_read_section(id));
