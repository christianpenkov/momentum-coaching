-- Sémaphore des workers webhook : des BAUX à la place d'un compteur.
--
-- Le compteur (webhook_worker_slots, migration 20260904120000) avait un défaut de
-- fond, trouvé à la revue adversariale du 2026-09-04 : sa remise à zéro exigeait
-- `maj < now() - 2 min`, or CHAQUE claim rafraîchissait `maj`. Sous trafic (le
-- tick pg_cron claime toutes les minutes), un slot fuité par un kill Vercel à
-- maxDuration (process gelé, pas d'exception, donc pas de `finally`) n'expirait
-- JAMAIS : le plafond tombait de 3 à 2 puis 1, en silence, pour toujours.
--
-- Un bail par worker règle le problème à la racine : chaque bail porte sa propre
-- date, périme seul à 2 min (un worker vit 60 s max), et une fuite n'affecte
-- que le bail fuité — jamais les autres, jamais le compteur.
create table if not exists public.webhook_worker_baux (
  id uuid primary key default gen_random_uuid(),
  pris_a timestamptz not null default now()
);
alter table public.webhook_worker_baux enable row level security;

-- Atomicité : verrou consultatif transactionnel sur un même entier pour tous les
-- appelants — le comptage + l'insertion ne peuvent pas s'entrelacer.
-- DROP d'abord : le type de retour change (boolean → uuid), Postgres refuse un
-- CREATE OR REPLACE dans ce cas.
drop function if exists public.prendre_slot_worker(int);
create function public.prendre_slot_worker(p_max int default 3)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('webhook_worker_baux'));
  delete from public.webhook_worker_baux where pris_a < now() - interval '2 minutes';
  if (select count(*) from public.webhook_worker_baux) >= p_max then
    return null;
  end if;
  insert into public.webhook_worker_baux default values returning id into v_id;
  return v_id;
end;
$$;

drop function if exists public.liberer_slot_worker();
create or replace function public.liberer_slot_worker(p_bail uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.webhook_worker_baux where id = p_bail;
$$;

revoke execute on function public.prendre_slot_worker(int) from public, anon, authenticated;
revoke execute on function public.liberer_slot_worker(uuid) from public, anon, authenticated;
grant execute on function public.prendre_slot_worker(int) to service_role;
grant execute on function public.liberer_slot_worker(uuid) to service_role;

drop table if exists public.webhook_worker_slots;
