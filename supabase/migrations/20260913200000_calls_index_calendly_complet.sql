-- Les rendez-vous Calendly ne s'écrivaient plus depuis le 2026-09-07
--
-- ── Ce qui s'est passé ───────────────────────────────────────────────────────────────
--
-- `20260907100000_calls_isolation_par_profil_index` a remplacé l'unicité GLOBALE de
-- `calendly_event_uuid` par une unicité par élève, sous la forme d'un index PARTIEL :
--
--   create unique index calls_coach_calendly_event_uuid_key
--     on calls (coach_id, calendly_event_uuid) where calendly_event_uuid is not null;
--
-- Or les quatre écrivains font `upsert(…, { onConflict: 'coach_id,calendly_event_uuid' })`,
-- c'est-à-dire `ON CONFLICT (coach_id, calendly_event_uuid)` SANS la clause `WHERE`.
-- Postgres ne sait pas inférer un index partiel sans son prédicat :
--
--   ERROR 42P10: there is no unique or exclusion constraint matching the ON CONFLICT specification
--
-- Reproduit le 2026-09-13 par `explain insert … on conflict (coach_id, calendly_event_uuid)`.
-- Dernier rendez-vous Calendly créé en base : 2026-08-31. Le piège était pourtant déjà
-- documenté dans ce projet, pour `prospect_events` (commentaire de sync-calendly : « le
-- client Supabase JS ne peut cibler un ON CONFLICT que sur un index/contrainte total »).
--
-- ⚠️ Rien ne l'a signalé pendant six jours : l'erreur de l'upsert n'était pas lue, le
-- rendez-vous était compté « synchronisé » et `last_synced_at` avançait. C'est le filet
-- d'incidents posé le même jour et la relecture adversariale qui l'ont trouvé.
--
-- ── Le correctif ─────────────────────────────────────────────────────────────────────
--
-- Un index unique COMPLET sur les mêmes colonnes. Sémantique strictement identique à
-- l'index partiel : un index unique traite les NULL comme distincts (NULLS DISTINCT par
-- défaut), donc plusieurs lignes sans `calendly_event_uuid` pour un même coach restent
-- permises — exactement ce que la clause `where … is not null` exprimait.
--
-- ⚠️ `calls_coach_fathom_recording_id_key` a la même forme partielle mais n'est la cible
-- d'AUCUN `onConflict` (les upserts Fathom visent `call_recordings` et `fathom_unmatched`,
-- qui ont des index complets) : il n'est pas touché ici.

create unique index if not exists calls_coach_calendly_event_uuid_uidx
  on public.calls (coach_id, calendly_event_uuid);

comment on index public.calls_coach_calendly_event_uuid_uidx is
  'Unicité par élève des rendez-vous Calendly, cible de onConflict coach_id,calendly_event_uuid. COMPLET et non partiel : un index partiel ne peut pas être inféré par ON CONFLICT sans son prédicat (42P10), ce qui a bloqué toute écriture de rendez-vous du 2026-09-07 au 2026-09-13.';

drop index if exists public.calls_coach_calendly_event_uuid_key;

-- Preuve dans la migration elle-même : l'inférence doit maintenant réussir.
do $$
begin
  if not exists (select 1 from pg_indexes where indexname = 'calls_coach_calendly_event_uuid_uidx') then
    raise exception 'index complet absent';
  end if;
  if exists (select 1 from pg_indexes where indexname = 'calls_coach_calendly_event_uuid_key') then
    raise exception 'index partiel encore présent';
  end if;
  execute 'explain insert into public.calls (coach_id, calendly_event_uuid) values (gen_random_uuid(), ''temoin'')
           on conflict (coach_id, calendly_event_uuid) do update set calendly_event_uuid = excluded.calendly_event_uuid';
end $$;
