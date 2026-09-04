-- enregistrer_message_ig rend maintenant DEUX informations au lieu d'une.
--
-- Le problème : le webhook de Meta ne contient PAS le pseudo de l'interlocuteur,
-- seulement son identifiant. Il faut donc le résoudre par un appel Graph — mais
-- une seule fois par fil, jamais à chaque message.
--
-- Savoir s'il manque demandait une lecture supplémentaire… c'est-à-dire
-- exactement la requête que cette fonction existe pour supprimer. Elle le dit
-- donc elle-même, dans la même réponse : `pseudo_a_resoudre`.
--
-- Le TypeScript, en le voyant à true, va chercher le pseudo chez Meta et rappelle
-- CETTE fonction avec. Un seul chemin de code, aucun `update` séparé, et le
-- deuxième appel n'insère pas de doublon : le `on conflict (profile_id, mid_hash)`
-- absorbe le message pendant que l'upsert de la conversation pose le pseudo.
--
-- ⚠️ Le type de retour change : Postgres refuse un `create or replace` dans ce
--    cas, il faut passer par un drop. Sans conséquence, rien n'en dépend encore.

drop function if exists public.enregistrer_message_ig(
  uuid, text, text, text, text, boolean, text, text, timestamptz);

create function public.enregistrer_message_ig(
  p_profile_id        uuid,
  p_ig_account_id     text,
  p_peer_id           text,
  p_peer_username     text,
  p_mid               text,
  p_sortant           boolean,
  p_texte             text,
  p_type_piece_jointe text,
  p_envoye_a          timestamptz
) returns table(conversation_id uuid, pseudo_a_resoudre boolean)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_conv   uuid;
  v_pseudo text;
  v_hash   bytea;
begin
  -- 1. Pas d'accord, pas de ligne. La garde vit ICI pour qu'aucun appelant
  --    futur ne puisse l'oublier.
  if not exists (
    select 1 from public.clients c
     where c.profile_id = p_profile_id
       and c.ig_dm_lecture_accordee_le is not null
       and c.archived_at is null
  ) then
    return;   -- aucune ligne rendue = « rien n'a été écrit »
  end if;

  -- 2. La conversation.
  --    coalesce sur le pseudo : un null ne doit jamais écraser une valeur déjà
  --    résolue, puisque le webhook n'en fournit pas.
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

  -- 3. Le message.
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

-- ⚠️ revoke ET grant, jamais l'un ou l'autre : Supabase accorde EXECUTE à `anon`
--    par défaut, et un drop/create repose les privilèges par défaut.
revoke execute on function public.enregistrer_message_ig(
  uuid, text, text, text, text, boolean, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.enregistrer_message_ig(
  uuid, text, text, text, text, boolean, text, text, timestamptz)
  to service_role;
