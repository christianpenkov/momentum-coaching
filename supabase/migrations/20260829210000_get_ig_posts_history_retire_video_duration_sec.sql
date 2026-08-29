-- La fonction declarait et selectionnait `p.video_duration_sec`, une colonne qui
-- n'existe pas sur `analytics_ig_posts_history`. Consequence : TOUTE la requete
-- echouait (ERROR 42703), y compris pour les dix-neuf autres colonnes qui, elles,
-- existent. Cote application l'echec etait silencieux — un `console.error` dans
-- PageClientStats et rien a l'ecran.
--
-- La colonne ne pourra jamais etre remplie : Meta ne sert pas la duree d'un post
-- Instagram (confirme par Chris le 2026-08-29). Aucun fichier du depot ne
-- mentionne ce nom, et aucune migration versionnee ne le creait — la fonction
-- avait ete modifiee hors du depot, ce qui est aussi pourquoi personne ne l'a vu.
--
-- `drop` avant `create` : changer le type de retour d'une fonction interdit le
-- simple `create or replace`.
drop function if exists get_ig_posts_history(uuid, date, date);

create function get_ig_posts_history(p_profile_id uuid, p_start_date date, p_end_date date)
returns table(
  post_id text, post_type text, caption text, permalink text, thumbnail text,
  published_at timestamp with time zone, snapshot_date date, reach integer,
  views integer, likes integer, comments integer, saves integer, shares integer,
  follows integer, profile_visits integer, total_interactions integer,
  avg_watch_time_ms bigint, total_watch_time_ms bigint, skip_rate numeric
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if current_setting('request.jwt.claims', true) is not null
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
    p.total_watch_time_ms, p.skip_rate
  from analytics_ig_posts_history p
  where p.profile_id = p_profile_id
    and p.archived_at is null
    and p.snapshot_date between p_start_date and p_end_date
  order by p.post_id, p.snapshot_date desc;
end;
$function$;
