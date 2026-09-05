-- Un fil retiré ne doit plus se réécrire.
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ CE QUE LE RETRAIT NE FAISAIT PAS                                          │
-- │                                                                           │
-- │ Retirer une conversation efface le fil et pose `not_a_lead = true`. Le    │
-- │ fil ne revenait donc PAS à l'écran — la vue joint `not_a_lead = false`.   │
-- │ Mais les deux fonctions d'écriture, elles, ne regardaient pas ce drapeau : │
-- │ le message suivant recréait la ligne de conversation et remettait à       │
-- │ stocker, en silence, pendant les 30 jours de quarantaine.                 │
-- │                                                                           │
-- │ Invisible, donc, mais pas retiré. Ce n'est pas ce que la confirmation     │
-- │ promet à l'élève, et une promesse d'effacement à moitié tenue est pire    │
-- │ qu'une promesse absente.                                                  │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- ⚠️ La garde DÉRIVE d'`instagram_leads`, elle n'ajoute aucun drapeau. C'est la
--    règle porteuse du chantier : la visibilité d'un fil n'est jamais stockée.
--    Un `retire_le` sur `ig_conversations` aurait été un second endroit où se
--    décide la même chose, et les deux auraient fini par diverger.
--
-- ⚠️ Elle ne coûte AUCUNE requête de plus. La lecture se fait à l'intérieur de
--    la fonction, dans le même aller-retour — c'est tout l'intérêt d'avoir une
--    écriture qui passe par une seule fonction Postgres. Quatre requêtes par
--    message auraient ajouté 24 000 requêtes/jour à 40 élèves.
--
-- ⚠️ Le prédicat est « un lead EXISTE et il est écarté », pas « aucun lead ».
--    Un inconnu sans fiche continue d'être stocké sous quarantaine de 30 jours :
--    c'est la décision « on stocke tout l'inbox, on n'affiche que les leads »,
--    et l'inverser ici casserait la bascule automatique du jour où un inconnu
--    devient un lead.

create or replace function public.enregistrer_message_ig(
  p_profile_id uuid, p_ig_account_id text, p_peer_id text, p_peer_username text,
  p_mid text, p_sortant boolean, p_texte text, p_type_piece_jointe text,
  p_envoye_a timestamp with time zone
)
returns table(conversation_id uuid, pseudo_a_resoudre boolean)
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_conv   uuid;
  v_pseudo text;
  v_hash   bytea;
begin
  if not exists (
    select 1 from public.clients c
     where c.profile_id = p_profile_id
       and c.ig_dm_lecture_accordee_le is not null
       and c.archived_at is null
  ) then
    return;
  end if;

  -- Le fil a été retiré : on n'écrit rien, et on ne le recrée pas.
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
$function$;

create or replace function public.enregistrer_messages_ig_lot(
  p_profile_id uuid, p_ig_account_id text, p_peer_id text, p_peer_username text,
  p_messages jsonb
)
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
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

  -- Même garde que sur l'écriture unitaire. Sans elle, la reprise d'historique
  -- réimporterait un fil que l'élève vient de retirer.
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
$function$;
