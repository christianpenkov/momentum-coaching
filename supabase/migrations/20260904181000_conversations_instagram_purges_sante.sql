-- Conversations Instagram — rétention et surveillance.
-- Plan et motifs : docs/conversations-instagram.md
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ DEUX RÉTENTIONS, ET LA DIFFÉRENCE EST LE CŒUR DU DIMENSIONNEMENT          │
-- │                                                                           │
-- │   fil dont l'interlocuteur EST un lead ......... 12 mois                  │
-- │   tout le reste (« quarantaine ») ..............  30 jours                │
-- │                                                                           │
-- │ Mesuré le 2026-09-04 : sur un compte réel, 6 leads pour 50 conversations. │
-- │ Sans la quarantaine on stockerait huit fois ce que le coach peut voir —   │
-- │ ~550 Mo/an contre ~170 Mo, sur un plafond gratuit de 500 Mo.              │
-- │                                                                           │
-- │ La quarantaine n'est pas qu'une économie : elle borne aussi le temps      │
-- │ pendant lequel une conversation privée de l'élève reste en base.          │
-- │                                                                           │
-- │ ⚠️ Un fil qui devient un lead bascule tout seul à 12 mois AVEC son        │
-- │    historique, parce que la visibilité est dérivée et jamais stockée.     │
-- │    Rien à déclencher.                                                     │
-- └───────────────────────────────────────────────────────────────────────────┘

create or replace function public.purge_ig_messages()
returns table(motif text, supprimes bigint)
language plpgsql
security definer
set search_path to 'public'
as $$
declare n bigint;
begin
  -- 1. Fils de leads : 12 mois.
  delete from ig_messages m
   where m.envoye_a < now() - interval '12 months'
     and exists (
       select 1 from ig_conversations cv
         join instagram_leads l
           on l.profile_id = cv.profile_id and l.ig_user_id = cv.peer_id
        where cv.id = m.conversation_id
          and l.not_a_lead  = false
          and l.archived_at is null);
  get diagnostics n = row_count;
  motif := 'lead_12_mois'; supprimes := n; return next;

  -- 2. Quarantaine : 30 jours pour tout le reste — inconnus ET exclus.
  delete from ig_messages m
   where m.envoye_a < now() - interval '30 days'
     and not exists (
       select 1 from ig_conversations cv
         join instagram_leads l
           on l.profile_id = cv.profile_id and l.ig_user_id = cv.peer_id
        where cv.id = m.conversation_id
          and l.not_a_lead  = false
          and l.archived_at is null);
  get diagnostics n = row_count;
  motif := 'quarantaine_30_jours'; supprimes := n; return next;

  -- 3. Les fils devenus vides.
  delete from ig_conversations cv
   where not exists (select 1 from ig_messages m where m.conversation_id = cv.id);
  get diagnostics n = row_count;
  motif := 'fils_vides'; supprimes := n; return next;
end;
$$;

revoke execute on function public.purge_ig_messages() from public, anon, authenticated;

-- SQL pur, aucune URL, aucun secret. La déplacer sur un planificateur externe
-- imposerait de créer une route HTTP et d'exposer une opération de purge sur
-- Internet — plus de code et plus de surface d'attaque pour un ménage qui
-- aujourd'hui ne dépend de rien.
select cron.schedule(
  'purge-ig-messages-daily', '15 4 * * *',
  $cron$ select public.purge_ig_messages(); $cron$
);

-- ─────────────────────────────────────────────────────────────────────────────
-- ig_dm_sante — VIDE quand tout va bien (mode `toute_ligne`)
--
-- Sans elle, une collecte qui s'arrête est indiscernable d'un élève qui n'a pas
-- de conversation. La règle du projet : un mécanisme n'est « zéro maintenance »
-- que quand son SILENCE est détectable.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.ig_dm_sante with (security_invoker = true) as

-- 1. La collecte s'est arrêtée.
--    Le signal est solide : quand un lead est créé, la plateforme lui envoie un
--    lead magnet, ce départ revient en `is_echo`, donc un message DOIT être écrit.
--    Un lead servi sans aucun message stocké = le webhook n'écrit plus.
select 'ALERTE collecte muette'::text as etat,
       c.profile_id::text             as sujet,
       ('lead servi le ' || to_char(max(l.detected_at), 'DD/MM') ||
        ', aucun message stocké depuis 7 jours')::text as detail
  from clients c
  join instagram_leads l
    on l.profile_id = c.profile_id
   and l.lead_magnet_sent = true
   and l.detected_at > now() - interval '7 days'
 where c.ig_dm_lecture_accordee_le is not null
   and c.archived_at is null
   and not exists (
     select 1 from ig_messages m
      where m.profile_id = c.profile_id
        and m.cree_le > now() - interval '7 days')
 group by c.profile_id

union all

-- 2. Le backfill ne se termine pas.
--    Chaque page se rappelle elle-même, et poll-leads réveille les réveils perdus.
--    Au-delà de 24 h, ce n'est plus un retard, c'est un blocage.
select 'ALERTE backfill bloque'::text,
       b.profile_id::text,
       ('démarré le ' || to_char(b.demarre_le, 'DD/MM à HH24:MI') ||
        ', ' || b.fils_traites || ' fils traités, toujours pas terminé')::text
  from ig_backfill_etat b
 where b.termine_le is null
   and b.demarre_le < now() - interval '24 hours'

union all

-- 3. L'accord est donné mais aucun backfill n'a démarré.
--    Le réveil du backfill part de la route de consentement ; s'il échoue, l'élève
--    a un écran vide et rien ne le dit.
select 'ALERTE backfill jamais demarre'::text,
       c.profile_id::text,
       ('accord donné le ' || to_char(c.ig_dm_lecture_accordee_le, 'DD/MM à HH24:MI') ||
        ', aucune ligne dans ig_backfill_etat')::text
  from clients c
 where c.ig_dm_lecture_accordee_le is not null
   and c.ig_dm_lecture_accordee_le < now() - interval '1 hour'
   and c.archived_at is null
   and not exists (select 1 from ig_backfill_etat b where b.profile_id = c.profile_id)

union all

-- 4. La purge ne tourne plus.
--    Une ligne ici veut dire que la quarantaine ne se vide pas : la vie privée de
--    l'élève reste stockée au-delà de ce qui lui a été annoncé, et la base grossit
--    sans borne.
select 'ALERTE purge muette'::text,
       'quarantaine'::text,
       (count(*) || ' messages hors lead ont plus de 31 jours')::text
  from ig_messages m
 where m.envoye_a < now() - interval '31 days'
   and not exists (
     select 1 from ig_conversations cv
       join instagram_leads l
         on l.profile_id = cv.profile_id and l.ig_user_id = cv.peer_id
      where cv.id = m.conversation_id
        and l.not_a_lead  = false
        and l.archived_at is null)
 having count(*) > 0;

comment on view public.ig_dm_sante is
  'Vide quand tout va bien. À inscrire dans SURVEILLANCES de /api/sante/alerte-vues, sinon elle est muette comme les dix vues qui l''ont précédée.';

-- ⚠️ Aucun grant : les privilèges par défaut de Supabase suffisent à exposer une
--    vue nouvelle. security_invoker = true fait appliquer la RLS de l'appelant.
--    Vérifier acces_sante_lecture après cette migration.
