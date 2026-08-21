-- Le CTR miniature n'a de sens que pour les videos publiees APRES le demarrage du
-- job de rapports YouTube.
--
-- L'API Reporting ne collecte qu'a partir de la creation du job. Une video anterieure
-- n'a donc en base que ses impressions residuelles : une video de juin 2025 cumulant
-- 2012 vues n'avait que 113 impressions enregistrees, soit 0,1 % de son audience
-- reelle. Le « CTR » calcule dessus (1,77 %) ne mesure pas la performance de la
-- miniature mais un fond de traine sur un echantillon minuscule.
--
-- On annule donc le CTR a la LECTURE plutot que de le supprimer : la donnee brute
-- reste en base (utile si YouTube ouvre un jour l'historique), et la regle vaut pour
-- tous les ecrans a la fois, present et futurs. La filtrer dans chaque composant
-- aurait recree la divergence habituelle entre chemins d'affichage.
--
-- Sans ligne dans youtube_ctr_sync_state, on ne peut rien affirmer : on masque, par
-- prudence, plutot que d'afficher un chiffre invalidable.
CREATE OR REPLACE FUNCTION public.get_yt_videos_history(p_profile_id uuid, p_start_date date, p_end_date date)
 RETURNS TABLE(video_id text, title text, thumbnail text, published_at timestamp with time zone, snapshot_date date, is_short boolean, views integer, views_period integer, watch_time_min numeric, likes integer, comments integer, shares integer, avg_view_pct numeric, url text, subs_gained integer, ctr numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_job_created_at timestamptz;
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

  select s.job_created_at into v_job_created_at
  from youtube_ctr_sync_state s
  where s.profile_id = p_profile_id;

  return query
  select distinct on (v.video_id)
    v.video_id, v.title, v.thumbnail, v.published_at,
    v.snapshot_date, v.is_short, v.views, v.views_period,
    v.watch_time_min, v.likes, v.comments, v.shares,
    v.avg_view_pct, v.url, v.subs_gained,
    case
      when v_job_created_at is null then null::numeric
      when v.published_at < v_job_created_at then null::numeric
      else v.ctr
    end as ctr
  from analytics_yt_videos_history v
  where v.profile_id = p_profile_id
    and v.snapshot_date between p_start_date and p_end_date
  order by v.video_id, v.snapshot_date desc;
end;
$function$;
