-- Conversations Instagram — le coach lit et annote les DM de son élève.
-- Plan complet, mesures et motifs : docs/conversations-instagram.md
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ TROIS IDÉES PORTENT TOUT CE FICHIER                                       │
-- │                                                                           │
-- │ 1. La visibilité n'est JAMAIS stockée. Elle se dérive d'un `exists` sur   │
-- │    instagram_leads (profile_id, ig_user_id = peer_id). Une colonne        │
-- │    « statut » serait une copie que personne ne confronte à sa source —    │
-- │    le mécanisme exact que ventes_sante_contenu surveille ailleurs.        │
-- │                                                                           │
-- │ 2. La règle de visibilité n'est écrite QU'UNE fois, sur                   │
-- │    ig_conversations. ig_messages s'y délègue. Deux copies d'une règle     │
-- │    divergent toujours, et le jour de la divergence un message reste       │
-- │    lisible alors que sa conversation ne l'est plus.                       │
-- │                                                                           │
-- │ 3. L'écriture passe par UNE fonction, jamais par quatre requêtes.         │
-- │    L'egress Supabase se paie au NOMBRE de requêtes : 4 par message ×      │
-- │    ~6 000 messages/jour à 40 élèves = 24 000 requêtes/jour sur un         │
-- │    budget mesuré à ~66 000.                                              │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- Flux d'écriture :
--
--   Meta ──► webhook (répond 200 en <100ms) ──► webhook_queue
--                                                    │
--                                     worker process-webhook-queue
--                                                    │
--                                     enregistrer_message_ig()  ◄── UNE requête
--                                       ├─ accord ? sinon null, rien n'est écrit
--                                       ├─ upsert conversation
--                                       ├─ insert message (on conflict do nothing)
--                                       └─ dates
--
-- Flux de lecture :
--
--   coach ──► RLS ig_conversations (accord + lead non exclu + non archivé)
--                    │
--                    └──► RLS ig_messages : « suit ta conversation »

-- ─────────────────────────────────────────────────────────────────────────────
-- ig_conversations
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.ig_conversations (
  id                uuid primary key default gen_random_uuid(),
  profile_id        uuid not null references public.profiles(id) on delete cascade,
  ig_account_id     text not null,
  peer_id           text not null,
  peer_username     text,
  first_message_at  timestamptz,
  last_message_at   timestamptz not null,
  last_inbound_at   timestamptz,
  note              text,
  note_le           timestamptz,
  archived_at       timestamptz,
  cree_le           timestamptz not null default now(),
  unique (profile_id, ig_account_id, peer_id)
);

comment on table public.ig_conversations is
  'Un fil de DM Instagram. AUCUNE colonne de statut : la visibilité se dérive d''un exists sur instagram_leads. Voir docs/conversations-instagram.md.';

comment on column public.ig_conversations.peer_id is
  'IGSID de l''interlocuteur, SCOPÉ AU COMPTE. La même personne porte un identifiant DIFFÉRENT par compte Instagram connecté (mesuré : rdjdkzjd en porte trois). Ne jamais joindre dessus sans profile_id, ni le traiter comme l''identité d''une personne.';

comment on column public.ig_conversations.last_inbound_at is
  'Date du dernier message REÇU. Ne sert PAS à autoriser un envoi — la plateforme n''envoie aucun message de coach. Sert à repérer les fils où le prospect attend une réponse.';

comment on column public.ig_conversations.archived_at is
  'Posé à la bascule OAuth du compte Instagram. C''est l''archivage qui isole les comptes, jamais un filtre ig_account_id à la lecture.';

-- Liste des fils : par activité décroissante, dans le compte de l'élève.
create index if not exists ig_conversations_profil_activite
  on public.ig_conversations (profile_id, last_message_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- ig_messages
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.ig_messages (
  id                 uuid primary key default gen_random_uuid(),
  profile_id         uuid not null references public.profiles(id) on delete cascade,
  conversation_id    uuid not null references public.ig_conversations(id) on delete cascade,
  mid_hash           bytea not null,
  mid                text,
  sortant            boolean not null,
  texte              text,
  type_piece_jointe  text,
  envoye_a           timestamptz not null,
  note               text,
  note_le            timestamptz,
  cree_le            timestamptz not null default now(),
  unique (profile_id, mid_hash)
);

comment on column public.ig_messages.mid_hash is
  'sha256 tronqué à 16 octets de l''identifiant Meta. Le mid brut fait 164 caractères, le texte moyen 40 : le stocker en index unique ferait peser la clé quatre fois la donnée. Passe la ligne de ~600 à ~250 octets — c''est ce qui fait tenir la fonctionnalité sur le plan gratuit.';

comment on column public.ig_messages.mid is
  'Renseigné UNIQUEMENT pour les messages à pièce jointe (14 % des cas mesurés) : c''est le seul cas où l''on doit redemander quelque chose à Meta (URL fraîche du média, qui expire).';

comment on column public.ig_messages.sortant is
  'true = envoyé par l''élève. Détecté par is_echo, ou par un expéditeur appartenant au compte de l''élève sous L''UNE OU L''AUTRE de ses deux formes (ig_account_id ET entry.id — voir ig_entry_id_mapping).';

comment on constraint ig_messages_profile_id_mid_hash_key on public.ig_messages is
  'Pas décoratif : quand deux comptes connectés à la plateforme se parlent, Meta livre le MÊME message deux fois, une fois par compte, avec et sans is_echo. Observé en base le 2026-09-04.';

create index if not exists ig_messages_fil_chrono
  on public.ig_messages (conversation_id, envoye_a desc);

create index if not exists ig_messages_profil_date
  on public.ig_messages (profile_id, envoye_a);

-- ─────────────────────────────────────────────────────────────────────────────
-- Rend gratuit le test « cet interlocuteur est-il un lead visible ? »
--
-- Index PARTIEL : il ne porte que les lignes que la lecture veut, donc il reste
-- petit même quand instagram_leads grossit. À 40 élèves un élève peut avoir
-- 2 000 conversations dont 300 seulement sont des leads — sans cet index, la
-- liste des fils parcourt les 2 000 en rejetant au fil de l'eau.
-- ─────────────────────────────────────────────────────────────────────────────
create index if not exists instagram_leads_visibles
  on public.instagram_leads (profile_id, ig_user_id)
  where not_a_lead = false and archived_at is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- L'accord de l'élève
--
-- Une DATE, pas un booléen : null dit « jamais accordé », et la date sert de
-- preuve le jour où quelqu'un demande depuis quand.
--
-- Il n'y en a qu'UN, parce qu'il n'y a qu'une capacité : la lecture. Une version
-- antérieure du plan prévoyait un second accord pour l'écriture ; l'écriture a
-- été retirée le 2026-09-04 (décision produit, pas technique). Ne pas rajouter
-- la colonne « au cas où » — la rouvrir demande de rouvrir la décision d'abord.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.clients
  add column if not exists ig_dm_lecture_accordee_le timestamptz;

comment on column public.clients.ig_dm_lecture_accordee_le is
  'Date à laquelle l''élève a autorisé son coach à lire ses conversations Instagram DM. null = jamais accordé, et alors AUCUN message n''est stocké en base.';

-- ─────────────────────────────────────────────────────────────────────────────
-- État du backfill — une ligne par élève, écrasée. Ne grossit jamais.
-- Même modèle que crons_passages : aucune purge à prévoir.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.ig_backfill_etat (
  profile_id    uuid primary key references public.profiles(id) on delete cascade,
  curseur       text,
  fils_traites  int not null default 0,
  demarre_le    timestamptz not null default now(),
  termine_le    timestamptz
);

comment on column public.ig_backfill_etat.curseur is
  'paging.after de la liste des conversations Meta. La route de backfill traite UNE page puis se rappelle elle-même ; poll-leads ne fait qu''une lecture par passage pour réveiller un backfill inachevé.';

-- ─────────────────────────────────────────────────────────────────────────────
-- enregistrer_message_ig — UNE requête là où quatre étaient naïvement possibles
--
-- ⚠️ La garde d'accord vit DANS la fonction, pas avant l'appel. C'est ce qui
--    rend la règle durable : aucun appelant futur ne peut l'oublier.
-- ⚠️ extensions.digest : pgcrypto vit dans le schéma `extensions` sur ce projet.
--    Un digest() nu échouerait avec search_path = 'public'.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.enregistrer_message_ig(
  p_profile_id        uuid,
  p_ig_account_id     text,
  p_peer_id           text,
  p_peer_username     text,
  p_mid               text,
  p_sortant           boolean,
  p_texte             text,
  p_type_piece_jointe text,
  p_envoye_a          timestamptz
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_conv uuid;
  v_hash bytea;
begin
  -- 1. Pas d'accord, pas de ligne. Le coût et le risque sont nuls tant que
  --    personne n'a dit oui.
  if not exists (
    select 1 from public.clients c
     where c.profile_id = p_profile_id
       and c.ig_dm_lecture_accordee_le is not null
       and c.archived_at is null
  ) then
    return null;
  end if;

  -- 2. La conversation.
  --    peer_username : le webhook ne le fournit PAS. Un null ne doit donc
  --    jamais écraser une valeur déjà résolue — d'où le coalesce.
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
    -- greatest ignore les null : un premier message entrant pose la date même
    -- quand la colonne était vide.
    last_inbound_at  = case when p_sortant then ig_conversations.last_inbound_at
                            else greatest(ig_conversations.last_inbound_at, p_envoye_a) end
  returning id into v_conv;

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

  return v_conv;
end;
$$;

-- ⚠️ revoke ET grant, jamais l'un ou l'autre. Supabase accorde EXECUTE à `anon`
--    par défaut : sans le revoke, n'importe qui sur Internet pourrait écrire des
--    messages dans les conversations de n'importe quel élève. Même motif que
--    declencher_cron (voir AGENTS.md).
revoke execute on function public.enregistrer_message_ig(
  uuid, text, text, text, text, boolean, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.enregistrer_message_ig(
  uuid, text, text, text, text, boolean, text, text, timestamptz)
  to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — la règle vit sur ig_conversations, et NULLE PART ailleurs
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.ig_conversations enable row level security;
alter table public.ig_messages      enable row level security;
alter table public.ig_backfill_etat enable row level security;

drop policy if exists "owner access" on public.ig_conversations;
create policy "owner access" on public.ig_conversations for all
  using (profile_id = (select auth.uid()));

drop policy if exists "coach lit les fils de leads accordes" on public.ig_conversations;
create policy "coach lit les fils de leads accordes" on public.ig_conversations for select
  using (
    archived_at is null
    and exists (
      select 1 from public.clients c
       where c.profile_id = ig_conversations.profile_id
         and c.coach_id   = (select auth.uid())
         and c.ig_dm_lecture_accordee_le is not null
    )
    and exists (
      select 1 from public.instagram_leads l
       where l.profile_id  = ig_conversations.profile_id
         and l.ig_user_id  = ig_conversations.peer_id
         and l.not_a_lead  = false
         and l.archived_at is null
    )
  );

drop policy if exists "owner access" on public.ig_messages;
create policy "owner access" on public.ig_messages for all
  using (profile_id = (select auth.uid()));

-- Délégation : ig_messages ne réimplémente pas la règle, il suit sa
-- conversation. La RLS d'ig_conversations s'applique à cette sous-requête.
drop policy if exists "suit la conversation" on public.ig_messages;
create policy "suit la conversation" on public.ig_messages for select
  using (exists (
    select 1 from public.ig_conversations cv where cv.id = ig_messages.conversation_id
  ));

-- L'état de backfill n'intéresse personne dans le navigateur.
-- Aucune policy = aucune ligne lisible sous RLS. Le service_role la contourne.

-- ⚠️ Après cette migration : vérifier que les trois tables n'apparaissent PAS
--    dans acces_sante_lecture. Supabase pose des privilèges par défaut sur
--    `public` : un create table suffit à exposer, sans qu'aucun grant
--    n'apparaisse dans le diff.
