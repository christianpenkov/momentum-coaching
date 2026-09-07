-- Etape 3 sur 3 : retirer les index uniques GLOBAUX de `calls`
--
-- ── Ne pas appliquer avant que le code soit deploye ────────────────────────────────
--
-- Les cinq upserts qui ecrivent dans `calls` utilisent desormais
-- `onConflict: 'coach_id,calendly_event_uuid'`. Tant que la version deployee fait encore
-- `onConflict: 'calendly_event_uuid'`, supprimer l'index correspondant ferait echouer
-- TOUTE synchro Calendly — le chemin qui enregistre les rendez-vous.
--
-- Sequence, rappelee ici pour qui relit :
--   1. 20260907100000 — creer les index par profil (les deux jeux coexistent) ;
--   2. commit c5861cb6 — les upserts passent au nouveau `onConflict`, Edge Function
--      sync-calendly redeployee ;
--   3. CE FICHIER — retirer les anciens, une fois le deploiement Vercel confirme READY.
--
-- ── Pourquoi il faut vraiment les retirer ──────────────────────────────────────────
--
-- Tant que `calls_calendly_event_uuid_key` existe, un rendez-vous Calendly ne peut
-- toujours exister qu'UNE fois dans toute la base : deux profils sur le meme compte
-- Calendly continueraient de se disputer la ligne. Le nouvel index ne PROTEGE rien tant
-- que l'ancien impose son unicite globale — il ne fait qu'offrir une cible d'upsert.
--
-- C'est la difference entre « le vol ne se produit plus par ce chemin » (etape 2) et
-- « la base ne peut plus le representer » (ici).
--
-- ── Ce qui reste garanti apres ─────────────────────────────────────────────────────
--
-- L'unicite d'un rendez-vous PAR ELEVE reste totale : un meme `calendly_event_uuid` ne
-- peut pas apparaitre deux fois chez le meme profil. Ce qui devient possible, c'est
-- qu'il apparaisse chez DEUX profils distincts — exactement ce que font deja
-- `analytics_daily_snapshots`, `instagram_leads`, `prospects` et cinq autres tables
-- quand deux eleves partagent un compte externe.

-- ⚠️ `calls_calendly_event_uuid_key` est adosse a une CONTRAINTE unique, pas seulement
-- a un index : Postgres refuse `drop index` dessus (« constraint requires it »). Il faut
-- retirer la contrainte, ce qui emporte son index. `idx_calls_fathom_recording_id`, lui,
-- a bien ete cree par `create unique index` et se retire directement.
alter table public.calls drop constraint if exists calls_calendly_event_uuid_key;
drop index if exists public.idx_calls_fathom_recording_id;

-- Controle : les index par profil doivent etre en place ET les globaux partis. Sans le
-- premier test, cette migration pourrait retirer toute unicite si l'etape 1 n'avait pas
-- ete jouee — et rien ne l'aurait dit.
do $$
declare
  nouveaux int := (select count(*) from pg_class where relname in
    ('calls_coach_calendly_event_uuid_key','calls_coach_fathom_recording_id_key'));
  anciens  int := (select count(*) from pg_class where relname in
    ('calls_calendly_event_uuid_key','idx_calls_fathom_recording_id'));
  doublons int := (
    select count(*) from (
      select coach_id, calendly_event_uuid from calls
      where calendly_event_uuid is not null
      group by 1, 2 having count(*) > 1
    ) x
  );
begin
  if nouveaux <> 2 then
    raise exception 'Les index par profil manquent (% sur 2) — jouer 20260907100000 d''abord', nouveaux;
  end if;
  if anciens <> 0 then
    raise exception 'Un index global subsiste (% sur 0)', anciens;
  end if;
  if doublons > 0 then
    raise exception 'Doublons (coach_id, calendly_event_uuid) : % — l''unicite par eleve est rompue', doublons;
  end if;
end $$;
