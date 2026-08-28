-- `GREATEST(existant, nouveau)` protège le compteur du jour en cours contre le retard
-- d'indexation de Short.io : un passage qui ne voit pas encore un clic très récent ne
-- doit pas ramener le compteur à 0.
--
-- Mais il rendait AUSSI toute correction impossible. Or une valeur fausse était écrite
-- chaque nuit : « hier » selon Paris (isoDate(1)) et « hier » selon Short.io
-- (period=yesterday, calendrier UTC) ne désignent pas le même jour entre minuit Paris
-- et minuit UTC. Le cron tournant toutes les 30 min, 2 à 4 passages tombaient dans
-- cette fenêtre chaque nuit et écrivaient les clics de J-2 sur la ligne de J-1.
--
-- Mesuré le 2026-08-28 en recoupant lien par lien avec l'API Short.io : 13 liens sur
-- 18 portaient leurs clics sur deux jours consécutifs. Après réparation, le total du
-- profil de test passe de 36 à 22 clics sur 40 jours — ~39 % de clics fantômes.
--
-- `p_ecraser` permet à une source qui fait autorité sur une journée entière (le flux
-- de clics rejoué) d'imposer sa valeur. Par défaut `false` : le jour en cours garde le
-- comportement monotone qui le protège.
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
    human_clicks    = case when p_ecraser then excluded.human_clicks
                           else greatest(shortio_link_daily_snapshots.human_clicks, excluded.human_clicks) end,
    total_clicks    = case when p_ecraser then excluded.total_clicks
                           else greatest(shortio_link_daily_snapshots.total_clicks, excluded.total_clicks) end,
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
    backfill_source = excluded.backfill_source,
    updated_at      = now();
$function$;

-- Une seule signature doit exister : deux surcharges rendaient l'appel ambigu et ont
-- cassé le bouton « Rafraîchir » pendant deux mois (cf. 20260828120000).
drop function if exists public.upsert_shortio_link_snapshot(
  uuid, text, text, text, text, date, integer, integer, text,
  jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, text, text
);
