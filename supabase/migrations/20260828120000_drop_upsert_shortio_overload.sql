-- Le bouton « Rafraîchir » côté Short.io ne synchronisait plus RIEN depuis
-- l'ajout de `p_link_category` : deux versions de `upsert_shortio_link_snapshot`
-- coexistaient (18 arguments, puis 19 avec `p_link_category` par défaut NULL).
--
-- `lib/shortio-fetch.ts` appelle la RPC avec les 18 arguments d'origine. Les deux
-- signatures étant alors candidates, PostgREST refuse de trancher :
--
--   Could not choose the best candidate function between:
--     public.upsert_shortio_link_snapshot(... p_backfill_source => text),
--     public.upsert_shortio_link_snapshot(... p_backfill_source => text,
--                                             p_link_category => text)
--
-- Constaté en production le 2026-08-28 : POST /api/shortio/refresh-today renvoie
-- `synced_links: 0` et une erreur par lien. Dernière écriture réussie avec
-- `backfill_source = 'refresh_partial'` : 2026-06-18. Le cron poll-leads, lui,
-- passe les 19 arguments et n'a jamais été touché — d'où l'absence de symptôme
-- visible sur les chiffres, seulement sur la fraîcheur du bouton.
--
-- On supprime la signature à 18 arguments. La version à 19 a `p_link_category`
-- avec une valeur par défaut : tous les appelants existants restent valides.
drop function if exists public.upsert_shortio_link_snapshot(
  uuid, text, text, text, text, date, integer, integer, text,
  jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, text
);
