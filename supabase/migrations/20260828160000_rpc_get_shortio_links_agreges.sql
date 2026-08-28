-- Liste des liens agregee EN SQL — une ligne par lien, au lieu d'une ligne par lien et
-- par jour rapatriee cote serveur.
--
-- C'est le dernier endroit ou le cout de lecture croissait avec la profondeur de
-- l'historique. /api/shortio/snapshots rapatriait les lignes brutes en paginant par
-- 1000 : a 40 eleves et 3 ans, un All-Time represente ~110 000 lignes, soit
-- ~110 allers-retours PostgREST. Ici, la reponse fait une ligne par lien — ~100 —
-- que la periode couvre 3 mois ou 5 ans.
--
-- Meme motif que get_shortio_clicks_by_day et get_shortio_clicks_by_url, qui avaient
-- deja regle ce probleme pour les deux autres lectures.
--
-- Deux corrections au passage, par rapport a l'agregation qui se faisait en TypeScript :
--
--   * `link_category` etait pris sur la ligne la PLUS ANCIENNE portant une valeur. Or
--     la RPC d'ecriture ne remplace jamais une categorie par NULL mais peut la
--     corriger : les lignes recentes portent donc la valeur juste, les anciennes une
--     valeur perimee. Exemple reel : un lien lead magnet de bio corrige de
--     'calendly_bio_ig' vers 'lm_bio_ig' gardait l'ancienne dans la liste des liens.
--     On prend desormais la plus recente.
--
--   * meme raisonnement pour path / short_url / original_url / link_type : l'etat
--     courant du lien est celui de sa derniere ligne, pas de sa premiere.
--
-- `chart_data` ne contient que les journees avec au moins un clic : son seul
-- consommateur en somme les valeurs sur une periode, et les journees a zero
-- n'y changent rien.
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
  with lignes as (
    select s.*
    from shortio_link_daily_snapshots s
    where s.profile_id = p_profile_id
      and s.date between p_start_date and p_end_date
  ),
  -- Etat courant du lien : sa ligne la plus recente dans la fenetre.
  dernier as (
    select distinct on (l.link_id)
      l.link_id, l.path, l.short_url, l.original_url, l.link_type
    from lignes l
    order by l.link_id, l.date desc
  ),
  -- Categorie : la plus recente NON NULLE (une ligne recente peut etre a NULL si le
  -- lien est sorti du perimetre Momentum, sans que cela efface ce qu'on savait).
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
