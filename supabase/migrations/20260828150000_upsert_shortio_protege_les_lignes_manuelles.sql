-- Une affirmation humaine ne se fait pas ecraser par une re-derivation.
--
-- Quand le coach avance un lead a l'etape « lien clique » dans le pipeline,
-- app/api/client/pipeline/advance ecrit une ligne `backfill_source = 'manual'` avec
-- human_clicks = 1 : le coach affirme que le clic a eu lieu, meme si Short.io ne l'a
-- jamais vu (lien ouvert hors navigateur, prospect qui le dit en DM...).
--
-- Depuis que le cron reecrit les journees closes a partir du flux de clics
-- (p_ecraser), cette ligne serait ramenee a 0 des le lendemain : le clic affirme
-- disparaitrait des statistiques. L'etape du pipeline, elle, survit — elle est portee
-- par prospect_events — mais le chiffre, non.
--
-- Aucune ligne 'manual' n'existe encore en base : le defaut est corrige avant d'avoir
-- eu lieu.
create or replace function public.upsert_shortio_link_snapshot(
  p_profile_id uuid, p_link_id text, p_path text, p_short_url text, p_original_url text,
  p_date date, p_human_clicks integer, p_total_clicks integer, p_link_type text,
  p_top_countries jsonb, p_top_referrers jsonb, p_top_browsers jsonb, p_top_os jsonb,
  p_top_social jsonb, p_top_cities jsonb, p_utm_sources jsonb, p_utm_mediums jsonb,
  p_backfill_source text, p_link_category text default null::text,
  p_ecraser boolean default false
)
returns void
language sql
as $function$
  insert into shortio_link_daily_snapshots (
    profile_id, link_id, path, short_url, original_url, date,
    human_clicks, total_clicks, link_type, link_category,
    top_countries, top_referrers, top_browsers, top_os, top_social, top_cities,
    utm_sources, utm_mediums, backfill_source, updated_at
  ) values (
    p_profile_id, p_link_id, p_path, p_short_url, p_original_url, p_date,
    p_human_clicks, p_total_clicks, p_link_type, p_link_category,
    p_top_countries, p_top_referrers, p_top_browsers, p_top_os, p_top_social, p_top_cities,
    p_utm_sources, p_utm_mediums, p_backfill_source, now()
  )
  on conflict (profile_id, link_id, date) do update set
    path            = excluded.path,
    short_url       = excluded.short_url,
    original_url    = coalesce(excluded.original_url, shortio_link_daily_snapshots.original_url),
    -- L'ecrasement ne s'applique JAMAIS a une ligne posee a la main.
    human_clicks    = case
                        when p_ecraser and shortio_link_daily_snapshots.backfill_source is distinct from 'manual'
                          then excluded.human_clicks
                        else greatest(shortio_link_daily_snapshots.human_clicks, excluded.human_clicks)
                      end,
    total_clicks    = case
                        when p_ecraser and shortio_link_daily_snapshots.backfill_source is distinct from 'manual'
                          then excluded.total_clicks
                        else greatest(shortio_link_daily_snapshots.total_clicks, excluded.total_clicks)
                      end,
    link_type       = coalesce(excluded.link_type, shortio_link_daily_snapshots.link_type),
    link_category   = coalesce(excluded.link_category, shortio_link_daily_snapshots.link_category),
    top_countries   = coalesce(excluded.top_countries, shortio_link_daily_snapshots.top_countries),
    top_referrers   = coalesce(excluded.top_referrers, shortio_link_daily_snapshots.top_referrers),
    top_browsers    = coalesce(excluded.top_browsers, shortio_link_daily_snapshots.top_browsers),
    top_os          = coalesce(excluded.top_os, shortio_link_daily_snapshots.top_os),
    top_social      = coalesce(excluded.top_social, shortio_link_daily_snapshots.top_social),
    top_cities      = coalesce(excluded.top_cities, shortio_link_daily_snapshots.top_cities),
    utm_sources     = coalesce(excluded.utm_sources, shortio_link_daily_snapshots.utm_sources),
    utm_mediums     = coalesce(excluded.utm_mediums, shortio_link_daily_snapshots.utm_mediums),
    -- La marque 'manual' ne doit pas etre effacee par un passage de cron, sans quoi la
    -- protection ci-dessus ne tiendrait qu'un seul tour.
    backfill_source = case
                        when shortio_link_daily_snapshots.backfill_source = 'manual' then 'manual'
                        else excluded.backfill_source
                      end,
    updated_at      = now();
$function$;
