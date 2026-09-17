-- La photo de profil d'un lead : une seconde chance, et une seule règle pour la donner.
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ CE QUI EXISTAIT, ET CE QUI MANQUAIT (mesuré le 2026-09-17)                │
-- │                                                                           │
-- │ Les cinq chemins du webhook et le cron `poll-leads` récupèrent la photo   │
-- │ à la CRÉATION du lead — 10 leads sur 10 en ont une. Mais :                │
-- │                                                                           │
-- │   1. le webhook ne tentait qu'UNE fois. Une panne passagère de Meta, et   │
-- │      le lead restait sans photo pour toujours, même en écrivant chaque    │
-- │      jour ;                                                               │
-- │   2. le cron, à l'inverse, retentait à CHAQUE passage (toutes les 5 min,  │
-- │      pendant sa fenêtre de 48 h) sans aucune limite : un échec permanent  │
-- │      y produisait ~576 appels à Meta et autant de lignes d'échec ;        │
-- │   3. `instagram_avatar_echecs` n'était purgée par rien.                   │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- ⚠️ La règle « faut-il tenter maintenant ? » vit en UN seul endroit,
--    `lead_photo_a_tenter`. Le webhook, le cron et le bouton Rafraîchir la lisent
--    tous. Trois copies d'un délai de 24 h auraient fini par en compter trois.

create index if not exists instagram_avatar_echecs_recent
  on public.instagram_avatar_echecs (profile_id, ig_user_id, survenu_le desc);

/**
 * L'identifiant du lead dont il faut tenter la photo MAINTENANT, ou null.
 *
 * Non null seulement si les trois sont vrais :
 *   - le lead existe, n'est ni écarté ni archivé ;
 *   - il n'a pas de photo ;
 *   - aucun échec n'a été enregistré pour lui depuis 24 heures.
 *
 * ⚠️ 24 heures, pas « jamais » ni « toujours ». « Jamais » laissait une panne
 * passagère devenir une absence définitive. « Toujours » faisait marteler Meta
 * toutes les cinq minutes sur un compte qui ne rendra jamais de photo. Un jour
 * rattrape toute panne passagère et borne une panne permanente à un appel par
 * jour — et encore, seulement quand la personne se manifeste.
 */
create or replace function public.lead_photo_a_tenter(p_profile_id uuid, p_ig_user_id text)
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select l.id
    from instagram_leads l
   where l.profile_id  = p_profile_id
     and l.ig_user_id  = p_ig_user_id
     and l.avatar_url  is null
     and l.not_a_lead  = false
     and l.archived_at is null
     and not exists (
       select 1 from instagram_avatar_echecs e
        where e.profile_id = p_profile_id
          and e.ig_user_id = p_ig_user_id
          and e.survenu_le > now() - interval '24 hours'
     )
   limit 1;
$$;

revoke execute on function public.lead_photo_a_tenter(uuid, text) from public, anon, authenticated;
grant execute on function public.lead_photo_a_tenter(uuid, text) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- L'écriture d'un message dit, dans la MÊME réponse, s'il faut tenter la photo.
--
-- ⚠️ Pourquoi ici plutôt qu'une lecture à part dans le webhook : l'egress se paie
-- au NOMBRE de requêtes. Une lecture par message entrant, c'est une requête de
-- plus à chaque DM de chaque élève, pour une réponse qui vaut « non » presque
-- toujours. Dans la fonction, elle ne coûte rien.
--
-- ⚠️ `drop` puis `create` : ajouter une colonne au `returns table` change le type
-- de retour, que `create or replace` refuse. Et un `drop` + `create` réapplique
-- les privilèges PAR DÉFAUT du schéma — `anon` récupère `execute` en silence.
-- D'où le `revoke … from anon` explicite en fin de bloc : `revoke … from public`
-- ne le couvre pas (AGENTS.md). L'ancien code du webhook lit
-- `conversation_id` et `pseudo_a_resoudre` : une colonne de plus ne le casse pas,
-- l'ordre de déploiement base-puis-code est donc sans risque.
-- ─────────────────────────────────────────────────────────────────────────────

drop function if exists public.enregistrer_message_ig(
  uuid, text, text, text, text, boolean, text, text, timestamp with time zone);

create function public.enregistrer_message_ig(
  p_profile_id uuid, p_ig_account_id text, p_peer_id text, p_peer_username text,
  p_mid text, p_sortant boolean, p_texte text, p_type_piece_jointe text,
  p_envoye_a timestamp with time zone
)
returns table(conversation_id uuid, pseudo_a_resoudre boolean, lead_sans_photo uuid)
language plpgsql security definer set search_path to 'public'
as $function$
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
  lead_sans_photo   := public.lead_photo_a_tenter(p_profile_id, p_peer_id);
  return next;
end;
$function$;

revoke execute on function public.enregistrer_message_ig(
  uuid, text, text, text, text, boolean, text, text, timestamp with time zone)
  from public, anon, authenticated;
grant execute on function public.enregistrer_message_ig(
  uuid, text, text, text, text, boolean, text, text, timestamp with time zone)
  to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Les échecs de photo se purgent avec le reste du chantier Instagram (4 h 15).
--
-- ⚠️ 30 jours : bien au-delà des 24 h dont la règle a besoin, assez pour enquêter
-- sur une panne récente. Rien d'autre ne lit cette table.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.purge_ig_messages()
returns table(motif text, supprimes bigint)
language plpgsql security definer set search_path to 'public'
as $function$
declare n bigint;
begin
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

  delete from ig_conversations cv
   where not exists (select 1 from ig_messages m where m.conversation_id = cv.id);
  get diagnostics n = row_count;
  motif := 'fils_vides'; supprimes := n; return next;

  delete from instagram_avatar_echecs e
   where e.survenu_le < now() - interval '30 days';
  get diagnostics n = row_count;
  motif := 'echecs_photo_30_jours'; supprimes := n; return next;
end;
$function$;
