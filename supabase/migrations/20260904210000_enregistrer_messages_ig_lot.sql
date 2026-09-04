-- Insertion des messages Instagram PAR LOT, pour la reprise d'historique.
--
-- Le premier jet du backfill appelait `enregistrer_message_ig` une fois par
-- message : 122 messages = 122 requêtes, mesuré en conditions réelles. C'est
-- exactement le N+1 que la RPC unitaire existe pour éviter côté webhook, et le
-- laisser ici aurait été incohérent — l'egress Supabase se paie au NOMBRE de
-- requêtes, quel que soit le chemin qui les émet.
--
-- Une page de messages Meta = UN appel. Sur un backfill de 40 élèves, l'écart
-- se compte en centaines de milliers de requêtes.
--
-- ⚠️ Même garde d'accord que la version unitaire, et pour la même raison :
--    elle vit DANS la fonction pour qu'aucun appelant futur ne l'oublie.

create or replace function public.enregistrer_messages_ig_lot(
  p_profile_id      uuid,
  p_ig_account_id   text,
  p_peer_id         text,
  p_peer_username   text,
  p_messages        jsonb      -- [{mid, sortant, texte, type_piece_jointe, envoye_a}, …]
) returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_conv    uuid;
  v_ecrits  integer := 0;
begin
  if not exists (
    select 1 from public.clients c
     where c.profile_id = p_profile_id
       and c.ig_dm_lecture_accordee_le is not null
       and c.archived_at is null
  ) then
    return 0;
  end if;

  if p_messages is null or jsonb_array_length(p_messages) = 0 then
    return 0;
  end if;

  -- La conversation est bornée par les dates du lot, pas message par message.
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
           -- Le mid brut (164 caractères) n'est gardé que pour les pièces
           -- jointes : c'est le seul cas où l'on redemande une URL à Meta.
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

revoke execute on function public.enregistrer_messages_ig_lot(uuid, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.enregistrer_messages_ig_lot(uuid, text, text, text, jsonb)
  to service_role;
