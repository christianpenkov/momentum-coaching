-- Le garde-fou copie sur get_shortio_clicks_by_day refusait la CLE DE SERVICE.
--
-- Les deux RPC existantes sont appelees depuis le navigateur, avec le jeton de
-- l'utilisateur : auth.uid() y vaut son identifiant, le garde-fou fonctionne. Celle-ci
-- est appelee depuis une route serveur avec la cle de service : les claims JWT existent
-- (role = service_role) mais auth.uid() est NULL, donc la condition tombait toujours sur
-- « Acces refuse ».
--
-- Constate en production : /api/shortio/snapshots repondait 503 sur chaque appel. La
-- page ne plantait pas — l'appelant fait `r.ok ? r.json() : null` — elle affichait
-- simplement l'ecran « pas de donnees ». Un test SQL direct ne pouvait pas le voir :
-- en SQL, current_setting('request.jwt.claims') est NULL et le garde-fou est saute.
-- Seul l'appel reel de la route, depuis le navigateur connecte, l'a revele.
--
-- La route fait deja sa propre verification d'acces (coach proprietaire du client) AVANT
-- d'appeler. Le garde-fou reste en place pour un eventuel appel direct depuis le
-- navigateur, et laisse passer le role de service.
create or replace function public.get_shortio_links_agreges(
  p_profile_id uuid, p_start_date date, p_end_date date
)
returns table (
  link_id text, path text, short_url text, original_url text,
  link_type text, link_category text,
  human_clicks bigint, total_clicks bigint,
  chart_data jsonb
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_claims text := current_setting('request.jwt.claims', true);
  v_role   text := case when v_claims is null then null
                        else coalesce((v_claims::json ->> 'role'), '') end;
begin
  if v_claims is not null
     and v_role is distinct from 'service_role'
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
  with lignes as (
    select s.*
    from shortio_link_daily_snapshots s
    where s.profile_id = p_profile_id
      and s.date between p_start_date and p_end_date
  ),
  dernier as (
    select distinct on (l.link_id)
      l.link_id, l.path, l.short_url, l.original_url, l.link_type
    from lignes l
    order by l.link_id, l.date desc
  ),
  categorie as (
    select distinct on (l.link_id) l.link_id, l.link_category
    from lignes l
    where l.link_category is not null
    order by l.link_id, l.date desc
  ),
  totaux as (
    select l.link_id,
      sum(l.human_clicks)::bigint h,
      sum(l.total_clicks)::bigint t,
      coalesce(
        jsonb_agg(jsonb_build_object('date', l.date, 'clicks', l.total_clicks)
                  order by l.date) filter (where l.total_clicks > 0),
        '[]'::jsonb
      ) chart
    from lignes l
    group by l.link_id
  )
  select d.link_id, d.path, d.short_url, d.original_url, d.link_type,
         c.link_category, tt.h, tt.t, tt.chart
  from dernier d
  join totaux tt on tt.link_id = d.link_id
  left join categorie c on c.link_id = d.link_id
  order by tt.t desc;
end;
$function$;
