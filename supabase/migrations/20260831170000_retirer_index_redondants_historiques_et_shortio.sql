-- Deux index redondants, mesures le 2026-08-31. Sur ces tables, l'index coute PLUS
-- CHER que la donnee : 802 octets par ligne Short.io sur disque pour 343 octets de
-- donnee reelle, soit 57 % d'index.
--
-- ── 1. analytics_yt_videos_history : deux UNIQUE sur le MEME jeu de colonnes ──
--   ..._profile_video_date_key              (profile_id, video_id, snapshot_date)
--   ..._profile_id_snapshot_date_video__key (profile_id, snapshot_date, video_id)
--
-- Meme ensemble de colonnes, donc meme contrainte d'unicite exprimee deux fois. Le
-- second est supprime : l'upsert de poll-leads vise explicitement
-- `onConflict: 'profile_id,video_id,snapshot_date'`, et les lectures par plage de
-- dates sont deja servies par idx_analytics_yt_videos_profile_date
-- (profile_id, snapshot_date DESC).
--
-- ⚠️ C'est EXACTEMENT le defaut corrige la veille sur analytics_ig_posts_history
-- (commit 6bc85d1, « Retirer l'index UNIQUE redondant »). Il n'avait pas ete reporte
-- sur la table jumelle. Une correction appliquee a un cote d'une paire doit toujours
-- etre cherchee sur l'autre.
--
-- ── 2. shortio_link_daily_snapshots : le meme index deux fois ──────────────────
--   ..._profile_id_link_id_date_key  UNIQUE (profile_id, link_id, date)   5 072 432 scans
--   ..._link_date_idx                       (profile_id, link_id, date DESC)  1 334 scans
--
-- Un index btree se parcourt dans LES DEUX SENS : le DESC n'apporte rien que
-- l'UNIQUE ne fournisse deja. 960 ko aujourd'hui, ~100 Mo/an a 40 eleves.

do $$
begin
  if exists (select 1 from pg_constraint
             where conname = 'analytics_yt_videos_history_profile_id_snapshot_date_video__key') then
    alter table public.analytics_yt_videos_history
      drop constraint analytics_yt_videos_history_profile_id_snapshot_date_video__key;
  else
    drop index if exists public.analytics_yt_videos_history_profile_id_snapshot_date_video__key;
  end if;

  if exists (select 1 from pg_constraint
             where conname = 'shortio_link_daily_snapshots_link_date_idx') then
    alter table public.shortio_link_daily_snapshots
      drop constraint shortio_link_daily_snapshots_link_date_idx;
  else
    drop index if exists public.shortio_link_daily_snapshots_link_date_idx;
  end if;
end $$;
