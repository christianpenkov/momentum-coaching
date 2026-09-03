-- Trois protections décidées avec Chris le 2026-09-04 (clôture de l'audit 40 élèves).
--
-- 1. VERROU ANTI-DOUBLE-PASSAGE de poll-leads. Deux invocations simultanées
--    (double-fire cron-job.org, ou déclenchement manuel pendant un passage)
--    téléchargeaient les mêmes rapports CTR YouTube et `upsert_yt_ctr`
--    ADDITIONNE (« impressions + EXCLUDED ») : impressions et clics doublés,
--    corruption permanente. Le verrou vit sur la ligne crons_passages du cron :
--    un UPDATE conditionnel est atomique (le second passage re-évalue le WHERE
--    sur la ligne verrouillée et ne matche plus). Il expire tout seul à 4 min
--    — un run dure 150 s max, un crash ne bloque donc qu'un seul passage.
alter table public.crons_passages add column if not exists verrou_pris_a timestamptz;
comment on column public.crons_passages.verrou_pris_a is
  'Verrou anti-double-passage : posé par UPDATE conditionnel au début du run, '
  'relâché à la fin, périmé après 4 min. NULL = aucun run en cours.';

-- 2. MÉMOIRE DES JOURS QUE META NE SERVIRA JAMAIS. Le rattrapage IG re-tentait
--    chaque heure, indéfiniment, les journées pour lesquelles Meta ne renvoie
--    rien : jusqu'à 30 jours × 6 appels = 180 appels/heure/profil gaspillés,
--    et un bandeau « partial » permanent. Un refus est mémorisé ici : retenté
--    une fois après 30 jours (l'agrégation tardive de Meta existe), puis plus
--    jamais. Une journée qui finit par répondre voit sa ligne supprimée.
--    Volume borné par l'histoire du compte (≤ 720 lignes/profil, en pratique
--    quelques dizaines) — aucune purge nécessaire.
create table if not exists public.ig_rattrapage_refus (
  profile_id uuid not null,
  date date not null,
  tentatives int not null default 1,
  reessayer_apres timestamptz not null,
  constate_le timestamptz not null default now(),
  primary key (profile_id, date)
);
alter table public.ig_rattrapage_refus enable row level security;

-- 3. PLAFOND DE WORKERS WEBHOOK SIMULTANÉS. Chaque commentaire Instagram
--    réveille SA propre invocation du worker : sur un post viral, la
--    concurrence d'envoi devenait la taille de la rafale (le commentaire du
--    worker décrivait une protection que les réveils avaient supprimée).
--    Sémaphore à une ligne : claim atomique via RPC, cap à 3 workers
--    (3 × 5 envois = 15 simultanés max), reset automatique si la ligne est
--    périmée (> 2 min — un worker vit 60 s max). Le tick pg_cron à la minute
--    garantit qu'un réveil refusé ne retarde jamais la file de plus de 60 s.
create table if not exists public.webhook_worker_slots (
  id int primary key,
  slots_pris int not null default 0,
  maj timestamptz not null default now()
);
alter table public.webhook_worker_slots enable row level security;
insert into public.webhook_worker_slots (id, slots_pris) values (1, 0)
on conflict (id) do nothing;

create or replace function public.prendre_slot_worker(p_max int default 3)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.webhook_worker_slots
     set slots_pris = case when maj < now() - interval '2 minutes' then 1 else slots_pris + 1 end,
         maj = now()
   where id = 1
     and (slots_pris < p_max or maj < now() - interval '2 minutes');
  return found;
end;
$$;

create or replace function public.liberer_slot_worker()
returns void
language sql
security definer
set search_path = public
as $$
  update public.webhook_worker_slots
     set slots_pris = greatest(slots_pris - 1, 0)
   where id = 1;
$$;

-- Fonctions machine : mêmes règles que la migration verrouillage_acces_anon.
revoke execute on function public.prendre_slot_worker(int) from public, anon, authenticated;
revoke execute on function public.liberer_slot_worker() from public, anon, authenticated;
grant execute on function public.prendre_slot_worker(int) to service_role;
grant execute on function public.liberer_slot_worker() to service_role;
