-- Ces deux fonctions renvoyaient une colonne nommee `total_clicks` qui contient en
-- realite `sum(human_clicks)` — donc des clics HUMAINS, bots exclus.
--
-- Le nom est la seule indication disponible en lecture de code. Celui-ci disait
-- l'inverse de ce qu'il portait, juste a cote d'une vraie colonne `total_clicks` qui,
-- elle, inclut les bots (499 contre 169 sur le profil de test, soit 3 fois plus). Le
-- prochain qui s'y fie affichera des chiffres gonfles sans qu'aucun test ne bronche.
--
-- C'est exactement le mecanisme qui a produit les 39 % de clics fantomes : un nom qui
-- ment survit a la correction de son symptome et reproduit le bug ailleurs.
--
-- Renomme en `clics_humains`. Les deux appelants (fetchSnapshot et fetchSupabaseStats
-- dans PageClientStats) sont mis a jour dans le meme commit.
drop function if exists public.get_shortio_clicks_by_day(uuid, date, date);
create function public.get_shortio_clicks_by_day(
  p_profile_id uuid, p_start_date date, p_end_date date
)
returns table(date date, link_category text, clics_humains bigint)
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
    raise exception 'Acces refuse';
  end if;

  return query
  select s.date, s.link_category, sum(s.human_clicks)::bigint as clics_humains
  from shortio_link_daily_snapshots s
  where s.profile_id = p_profile_id
    and s.date between p_start_date and p_end_date
  group by s.date, s.link_category
  order by s.date;
end;
$function$;

drop function if exists public.get_shortio_clicks_by_url(uuid, date, date);
create function public.get_shortio_clicks_by_url(
  p_profile_id uuid, p_start_date date, p_end_date date
)
returns table(short_url text, path text, link_category text, clics_humains bigint)
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
    raise exception 'Acces refuse';
  end if;

  return query
  select s.short_url, s.path, max(s.link_category) as link_category,
         sum(s.human_clicks)::bigint as clics_humains
  from shortio_link_daily_snapshots s
  where s.profile_id = p_profile_id
    and s.date between p_start_date and p_end_date
  group by s.short_url, s.path;
end;
$function$;
