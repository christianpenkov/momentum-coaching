-- Backfill : reconstruire les evenements `hook_replied` manquants au journal.
--
-- POURQUOI
-- La fiche `instagram_leads.hook_replied` decrit l'etat COURANT d'une personne et
-- retombe a false des qu'un nouveau lead magnet part. Le journal `prospect_events`
-- n'efface rien, c'est donc lui la source des colonnes « Ont repondu ».
--
-- Mais le journal est incomplet sur l'historique : certaines reponses sont anterieures
-- a la journalisation, et la route d'avance manuelle du pipeline n'ecrivait que le
-- drapeau de la fiche jusqu'au 2026-08-30.
--
-- Consequence mesuree sur le profil de test : `rdjdkzjd` porte
-- `hook_replied_at = 2026-07-08 16:34`, deux minutes avant la reservation de son call,
-- et ZERO evenement. Un tableau de parcours lisant le journal l'aurait montre avec
-- 0 conversation et 1 call booke — une chaine non monotone, donc illisible.
--
-- CE QUE CE BACKFILL AFFIRME, ET CE QU'IL N'AFFIRME PAS
-- Il affirme QUE la personne a repondu, et QUAND : les deux viennent de la fiche, qui
-- les tient de la meme source que le journal. Il n'affirme RIEN sur le contenu a
-- l'origine de la reponse : `metadata->>'media_id'` reste absent, parce que la fiche ne
-- porte que le DERNIER contenu commente (champ ecrase). Les roles d'attribution
-- retombent alors sur la reconstruction par horodatage, qui est leur comportement
-- documente en l'absence de media_id — jamais sur une valeur inventee.
--
-- `metadata->>'source' = 'backfill'` distingue definitivement un fait journalise d'un
-- fait reconstitue. Ne jamais retirer ce marqueur.
--
-- Idempotent : le NOT EXISTS empeche tout doublon si la migration est rejouee.

insert into prospect_events (profile_id, prospect_key, platform, event_type, occurred_at, cycle, ig_lead_id, metadata)
select
  il.profile_id,
  lower(il.ig_username),
  'ig',
  'hook_replied',
  il.hook_replied_at,
  coalesce(
    (select max(e.cycle) from prospect_events e
      where e.profile_id = il.profile_id and e.ig_lead_id = il.id),
    1
  ),
  il.id,
  jsonb_build_object('source', 'backfill', 'media_id', null)
from instagram_leads il
where il.hook_replied is true
  and il.hook_replied_at is not null
  and il.ig_username is not null
  and il.archived_at is null
  and not exists (
    select 1 from prospect_events e
    where e.profile_id = il.profile_id
      and e.ig_lead_id = il.id
      and e.event_type = 'hook_replied'
  );
