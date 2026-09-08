-- Les conversations Instagram DU COACH — collecte de ses propres DM.
-- Plan et motifs : docs/conversations-instagram.md
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ POURQUOI LE COACH N'ÉTAIT PAS COLLECTÉ                                    │
-- │                                                                           │
-- │ La garde d'écriture posait UNE question : « l'élève a-t-il accordé la     │
-- │ lecture à son coach ? », en cherchant une ligne dans `clients`. Un coach  │
-- │ n'a pas de ligne dans `clients` — il n'est l'élève de personne. Ses DM    │
-- │ n'étaient donc JAMAIS écrits, en silence, et son pipeline ne pouvait rien │
-- │ afficher.                                                                 │
-- │                                                                           │
-- │ La garde n'était pas fausse, elle était incomplète : elle traitait le     │
-- │ partage, pas la propriété. Un coach qui lit ses propres conversations ne  │
-- │ demande rien à personne — ce sont ses données, sur son compte, dans son   │
-- │ inbox. Décision de Chris, 2026-09-08 : collecte sans accord.              │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- ⚠️ LA RÈGLE VIT À UN SEUL ENDROIT — `collecte_dm_ig_autorisee`.
--    Elle était déjà écrite quatre fois (les deux fonctions d'écriture, la vue
--    de santé, la route de reprise). Quatre copies d'une règle sont quatre
--    occasions de n'en corriger que trois : c'est exactement le mode de panne
--    « partition à moitié corrigée » déjà rencontré sur ce projet.
--
-- ⚠️ CE N'EST PAS UNE DÉSACTIVATION DE LA GARDE. Pour un élève, rien ne change :
--    sans accord, aucun message n'est écrit, et `/api/sante/alerte-vues` a
--    raison de dire qu'il ne faut jamais « réparer » une collecte muette en
--    ouvrant la garde. Ce qu'on ajoute est un cas où il n'y a personne à qui
--    demander l'accord.

-- ─────────────────────────────────────────────────────────────────────────────
-- La règle, une fois pour toutes
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.collecte_dm_ig_autorisee(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    -- L'élève a accordé la lecture à son coach.
    exists (
      select 1 from public.clients c
       where c.profile_id = p_profile_id
         and c.ig_dm_lecture_accordee_le is not null
         and c.archived_at is null
    )
    -- ou bien c'est le coach, sur son propre compte : personne à qui demander.
    or exists (
      select 1 from public.profiles p
       where p.id = p_profile_id
         and p.role = 'coach'
    );
$$;

comment on function public.collecte_dm_ig_autorisee(uuid) is
  'La seule définition de « les DM de ce profil peuvent-ils être stockés ». Accord de l''élève, ou compte propre du coach. Toute autre copie de cette règle est un bug en attente.';

-- ⚠️ `revoke ... from anon` seul ne fait RIEN : PUBLIC garde EXECUTE et les
--    rôles en héritent. Il faut retirer à PUBLIC, puis rendre à service_role.
revoke execute on function public.collecte_dm_ig_autorisee(uuid) from public, anon, authenticated;
grant  execute on function public.collecte_dm_ig_autorisee(uuid) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Les deux écrivains lisent désormais la même règle
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.enregistrer_message_ig(
  p_profile_id uuid, p_ig_account_id text, p_peer_id text, p_peer_username text,
  p_mid text, p_sortant boolean, p_texte text, p_type_piece_jointe text,
  p_envoye_a timestamptz
)
returns table(conversation_id uuid, pseudo_a_resoudre boolean)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_conv   uuid;
  v_pseudo text;
  v_hash   bytea;
begin
  if not public.collecte_dm_ig_autorisee(p_profile_id) then
    return;
  end if;

  if exists (
    select 1 from public.instagram_leads l
     where l.profile_id = p_profile_id
       and l.ig_user_id = p_peer_id
       and l.not_a_lead = true
  ) then
    return;
  end if;

  insert into public.ig_conversations (
    profile_id, ig_account_id, peer_id, peer_username,
    first_message_at, last_message_at, last_inbound_at
  ) values (
    p_profile_id, p_ig_account_id, p_peer_id, nullif(p_peer_username, ''),
    p_envoye_a, p_envoye_a,
    case when p_sortant then null else p_envoye_a end
  )
  on conflict (profile_id, ig_account_id, peer_id) do update set
    peer_username    = coalesce(excluded.peer_username, ig_conversations.peer_username),
    last_message_at  = greatest(ig_conversations.last_message_at, excluded.last_message_at),
    first_message_at = least(
                         coalesce(ig_conversations.first_message_at, excluded.first_message_at),
                         excluded.first_message_at),
    last_inbound_at  = case when p_sortant then ig_conversations.last_inbound_at
                            else greatest(ig_conversations.last_inbound_at, p_envoye_a) end
  returning id, peer_username into v_conv, v_pseudo;

  v_hash := substring(extensions.digest(p_mid, 'sha256') from 1 for 16);

  insert into public.ig_messages (
    profile_id, conversation_id, mid_hash, mid,
    sortant, texte, type_piece_jointe, envoye_a
  ) values (
    p_profile_id, v_conv, v_hash,
    case when p_type_piece_jointe is null then null else p_mid end,
    p_sortant, nullif(p_texte, ''), p_type_piece_jointe, p_envoye_a
  )
  on conflict (profile_id, mid_hash) do nothing;

  conversation_id   := v_conv;
  pseudo_a_resoudre := v_pseudo is null;
  return next;
end;
$$;

revoke execute on function public.enregistrer_message_ig(
  uuid, text, text, text, text, boolean, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.enregistrer_message_ig(
  uuid, text, text, text, text, boolean, text, text, timestamptz
) to service_role;

create or replace function public.enregistrer_messages_ig_lot(
  p_profile_id uuid, p_ig_account_id text, p_peer_id text, p_peer_username text,
  p_messages jsonb
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_conv    uuid;
  v_ecrits  integer := 0;
begin
  if not public.collecte_dm_ig_autorisee(p_profile_id) then
    return 0;
  end if;

  if exists (
    select 1 from public.instagram_leads l
     where l.profile_id = p_profile_id
       and l.ig_user_id = p_peer_id
       and l.not_a_lead = true
  ) then
    return 0;
  end if;

  if p_messages is null or jsonb_array_length(p_messages) = 0 then
    return 0;
  end if;

  insert into public.ig_conversations (
    profile_id, ig_account_id, peer_id, peer_username,
    first_message_at, last_message_at, last_inbound_at
  )
  select p_profile_id, p_ig_account_id, p_peer_id, nullif(p_peer_username, ''),
         min((m->>'envoye_a')::timestamptz),
         max((m->>'envoye_a')::timestamptz),
         max((m->>'envoye_a')::timestamptz) filter (where (m->>'sortant')::boolean is not true)
    from jsonb_array_elements(p_messages) m
  on conflict (profile_id, ig_account_id, peer_id) do update set
    peer_username    = coalesce(excluded.peer_username, ig_conversations.peer_username),
    last_message_at  = greatest(ig_conversations.last_message_at, excluded.last_message_at),
    first_message_at = least(
                         coalesce(ig_conversations.first_message_at, excluded.first_message_at),
                         excluded.first_message_at),
    last_inbound_at  = greatest(ig_conversations.last_inbound_at, excluded.last_inbound_at)
  returning id into v_conv;

  with insere as (
    insert into public.ig_messages (
      profile_id, conversation_id, mid_hash, mid,
      sortant, texte, type_piece_jointe, envoye_a
    )
    select p_profile_id, v_conv,
           substring(extensions.digest(m->>'mid', 'sha256') from 1 for 16),
           case when nullif(m->>'type_piece_jointe','') is null then null else m->>'mid' end,
           coalesce((m->>'sortant')::boolean, false),
           nullif(m->>'texte', ''),
           nullif(m->>'type_piece_jointe', ''),
           (m->>'envoye_a')::timestamptz
      from jsonb_array_elements(p_messages) m
     where nullif(m->>'mid','') is not null
    on conflict (profile_id, mid_hash) do nothing
    returning 1
  )
  select count(*) into v_ecrits from insere;

  return v_ecrits;
end;
$$;

revoke execute on function public.enregistrer_messages_ig_lot(
  uuid, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.enregistrer_messages_ig_lot(
  uuid, text, text, text, jsonb
) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- La surveillance suit la règle, sinon le silence du coach reste indétectable
--
-- Sans ce changement, une collecte qui s'arrête sur le compte du coach ne
-- déclencherait rien : la vue ne regardait que les élèves ayant accordé. Un
-- mécanisme n'est « zéro maintenance » que quand son silence se voit.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.ig_dm_sante with (security_invoker = true) as

-- 1. La collecte s'est arrêtée.
--    Le signal est solide : quand un lead est créé, la plateforme lui envoie un
--    lead magnet, ce départ revient en `is_echo`, donc un message DOIT être écrit.
select 'ALERTE collecte muette'::text as etat,
       p.id::text                     as sujet,
       ('lead servi le ' || to_char(max(l.detected_at), 'DD/MM') ||
        ', aucun message stocké depuis 7 jours')::text as detail
  from profiles p
  join instagram_leads l
    on l.profile_id = p.id
   and l.lead_magnet_sent = true
   and l.detected_at > now() - interval '7 days'
 where public.collecte_dm_ig_autorisee(p.id)
   and not exists (
     select 1 from ig_messages m
      where m.profile_id = p.id
        and m.cree_le > now() - interval '7 days')
 group by p.id

union all

-- 2. Le backfill ne se termine pas.
select 'ALERTE backfill bloque'::text,
       b.profile_id::text,
       ('démarré le ' || to_char(b.demarre_le, 'DD/MM à HH24:MI') ||
        ', ' || b.fils_traites || ' fils traités, toujours pas terminé')::text
  from ig_backfill_etat b
 where b.termine_le is null
   and b.demarre_le < now() - interval '24 hours'

union all

-- 3. L'accord est donné mais aucun backfill n'a démarré.
--    Reste indexé sur l'accord : c'est lui qui déclenche le réveil. Le coach n'a
--    pas d'accord — sa ligne est semée à la connexion Instagram, pas ici.
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

-- ─────────────────────────────────────────────────────────────────────────────
-- La reprise d'historique des coachs DÉJÀ connectés à Instagram
--
-- Règle du projet : une colonne (ici, une ligne d'état) et son rattrapage
-- voyagent dans la même migration. Sans ceci, un coach connecté depuis des mois
-- ne verrait que les messages postérieurs au déploiement, sans que rien ne le
-- dise. `poll-leads` ramasse les lignes non terminées et appelle la route.
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.ig_backfill_etat (profile_id)
select p.id
  from public.profiles p
  join public.integrations i
    on i.profile_id = p.id
   and i.provider = 'instagram'
 where p.role = 'coach'
on conflict (profile_id) do nothing;
