-- La duree revient dans la fonction, mais cette fois adossee a une vraie table
-- (`ig_post_durees`) au lieu d'une colonne fantome. Elle est JOINTE, pas stockee sur
-- chaque instantane : la duree d'un post ne change jamais, la repeter sur les 675
-- lignes d'historique de Reels serait la meme valeur ecrite des centaines de fois.
--
-- `left join` : un post dont la duree n'a pas encore ete mesuree, ou dont Meta ne
-- sert pas le fichier (musique protegee), rend `null` — un trou, jamais un zero.
drop function if exists get_ig_posts_history(uuid, date, date);

create function get_ig_posts_history(p_profile_id uuid, p_start_date date, p_end_date date)
returns table(
  post_id text, post_type text, caption text, permalink text, thumbnail text,
  published_at timestamp with time zone, snapshot_date date, reach integer,
  views integer, likes integer, comments integer, saves integer, shares integer,
  follows integer, profile_visits integer, total_interactions integer,
  avg_watch_time_ms bigint, total_watch_time_ms bigint, skip_rate numeric,
  duree_sec numeric
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
    p.total_watch_time_ms, p.skip_rate, d.duree_sec
  from analytics_ig_posts_history p
  left join ig_post_durees d on d.post_id = p.post_id
  where p.profile_id = p_profile_id
    and p.archived_at is null
    and p.snapshot_date between p_start_date and p_end_date
  order by p.post_id, p.snapshot_date desc;
end;
$function$;
