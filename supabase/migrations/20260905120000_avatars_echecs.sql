-- ─────────────────────────────────────────────────────────────────────────────
-- Pourquoi la photo d'un lead n'a pas pu être récupérée
--
-- La récupération est volontairement non bloquante : une photo manquante ne doit
-- jamais faire échouer le traitement d'un webhook. Mais l'ancienne version
-- rendait `null` sur CINQ chemins différents sans laisser la moindre trace —
-- un lead sans photo était indiscernable d'une récupération qui avait planté, et
-- on ne pouvait pas dire lequel des deux on regardait.
--
-- Cette table porte la raison. Elle ne sert qu'au diagnostic : rien ne la lit
-- pour afficher quoi que ce soit.
--
-- En base et non en console : les logs Vercel ne se relisent pas trois jours
-- plus tard, et c'est exactement le délai au bout duquel on remarque qu'un lead
-- n'a pas d'avatar. Règle projet, voir AGENTS.md.
--
-- ── LA CAUSE LA PLUS PROBABLE, ÉCRITE ICI POUR LA PROCHAINE FOIS ─────────────
--
-- « Object with ID … does not exist » ne veut PAS dire que l'identifiant est
-- faux. Un `ig_user_id` est scopé au compte Instagram avec lequel la personne a
-- interagi : interroger avec le jeton d'un autre compte de la plateforme donne
-- exactement ce message. Vérifié le 2026-09-05 — les mêmes identifiants
-- échouent avec un jeton étranger et réussissent avec le bon.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.instagram_avatar_echecs (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  lead_id     uuid references public.instagram_leads(id) on delete cascade,
  ig_user_id  text,
  raison      text not null,
  survenu_le  timestamptz not null default now()
);

create index if not exists instagram_avatar_echecs_profil_idx
  on public.instagram_avatar_echecs (profile_id, survenu_le desc);

alter table public.instagram_avatar_echecs enable row level security;

-- Lecture par le propriétaire et son coach, comme le reste du pipeline.
-- L'écriture passe par la clé de service, qui contourne RLS.
create policy "instagram_avatar_echecs_lecture"
  on public.instagram_avatar_echecs for select
  using (
    profile_id = auth.uid()
    or exists (
      select 1 from public.clients
      where clients.profile_id = instagram_avatar_echecs.profile_id
        and clients.coach_id = auth.uid()
    )
  );

comment on table public.instagram_avatar_echecs is
  'Diagnostic seul : pourquoi la photo de profil d''un lead n''a pas pu etre recuperee. Rien ne la lit pour l''affichage.';
