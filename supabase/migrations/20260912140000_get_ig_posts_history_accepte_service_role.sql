-- `get_ig_posts_history` accepte les appels serveur (`service_role`)
--
-- ⚠️ POURQUOI
--
-- La fonction refusait tout appel `service_role`. Son garde-fou est :
--
--     if current_setting('request.jwt.claims', true) is not null
--        and (auth.uid() is null or …) then raise exception 'Accès refusé';
--
-- Or la clé `service_role` EST un JWT : `request.jwt.claims` est donc renseigné, mais
-- sans `sub` — `auth.uid()` vaut null, et la première branche déclenche le refus.
-- Mesuré le 2026-09-12 : l'appel échoue bien sur « Accès refusé ».
--
-- La conséquence est indirecte mais réelle : `app/api/instagram/stats` ne pouvait pas
-- s'en servir, et lisait donc `analytics_ig_posts_history` en `select('*')` pour
-- dédupliquer ENSUITE côté application. Cette table porte une ligne par post ET PAR
-- JOUR : sur une fenêtre de 30 jours, elle télécharge trente copies de chaque post pour
-- n'en garder qu'une. Mesuré : ~4 Mo par chargement d'écran à 300 posts, contre ~136 ko
-- en laissant la base dédupliquer.
--
-- ── Pourquoi élargir le garde-fou n'ouvre RIEN ───────────────────────────────────
--
-- C'est l'argument qui rend ce changement sûr, et il vaut d'être écrit :
-- **le garde-fou ne pouvait de toute façon rien contre `service_role`.** Ce rôle
-- contourne la RLS et tous les GRANT par construction (docs/security-notes.md) — il lit
-- déjà la table directement, et c'est exactement ce que faisait la route. Tout ce que
-- `service_role` obtient via cette fonction, il l'obtenait déjà sans elle.
--
-- Le garde-fou protège le chemin NAVIGATEUR (`authenticated`), et celui-là ne bouge pas :
-- un utilisateur qui demande un profil qui n'est pas le sien, ou dont il n'est pas le
-- coach, continue de recevoir « Accès refusé ».
--
-- ⚠️ La contrepartie, à assumer : la vérification d'ownership repose alors entièrement
-- sur la route appelante. `app/api/instagram/stats` la fait — `getUser()` puis 401, et
-- un contrôle `clients` puis 403 avant de résoudre `targetProfileId`. C'est le motif
-- dominant du projet, documenté dans docs/security-notes.md : « RLS est un filet contre
-- l'accès direct à l'API REST publique, pas la seule ligne de défense ».
--
-- ⚠️ `security definer` et `search_path = public` sont restatés : un `create or replace`
-- qui les oublierait changerait le contexte d'exécution sans que rien ne le signale.
-- Les GRANT, eux, sont conservés par `create or replace` (anon: non, authenticated: oui).

create or replace function public.get_ig_posts_history(
  p_profile_id uuid,
  p_start_date date,
  p_end_date date
)
returns table (
  post_id text, post_type text, caption text, permalink text, thumbnail text,
  published_at timestamptz, snapshot_date date, reach integer, views integer,
  likes integer, comments integer, saves integer, shares integer, follows integer,
  profile_visits integer, total_interactions integer, avg_watch_time_ms bigint,
  total_watch_time_ms bigint, skip_rate numeric, duree_sec numeric,
  deleted_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Un appel serveur (`service_role`) passe : il lit deja la table sans cette fonction.
  -- Tout le reste — donc le navigateur — garde le controle d'ownership a l'identique.
  if current_setting('request.jwt.claims', true) is not null
     and coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'service_role'
     and (auth.uid() is null or (
       auth.uid() <> p_profile_id
       and not exists (
         select 1 from clients c
         where c.profile_id = p_profile_id and c.coach_id = auth.uid()
       )
     ))
  then
    raise exception 'Accès refusé';
  end if;

  return query
  select distinct on (p.post_id)
    p.post_id, p.post_type, p.caption, p.permalink, p.thumbnail,
    p.published_at, p.snapshot_date, p.reach, p.views,
    p.likes, p.comments, p.saves, p.shares, p.follows,
    p.profile_visits, p.total_interactions, p.avg_watch_time_ms,
    p.total_watch_time_ms, p.skip_rate, d.duree_sec,
    p.deleted_at
  from analytics_ig_posts_history p
  left join ig_post_durees d on d.post_id = p.post_id
  where p.profile_id = p_profile_id
    and p.archived_at is null
    and p.snapshot_date between p_start_date and p_end_date
  order by p.post_id, p.snapshot_date desc;
end;
$$;
