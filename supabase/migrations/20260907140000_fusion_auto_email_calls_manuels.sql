-- ─────────────────────────────────────────────────────────────────────────────
-- La fusion automatique ignorait les rendez-vous MANUELS
--
-- `fusionner_call_par_email` filtrait `call_type = 'calendly'` aux DEUX endroits :
-- pour lire le rendez-vous à rattacher, et pour chercher celui qui porte déjà le
-- lead. Un rendez-vous `manual` n'était donc ni fusionné, ni utilisable comme
-- point d'ancrage.
--
-- ── `manual` EST DE LA VENTE, et c'est écrit depuis le 2026-08-29 ────────────
--
-- `lib/callTypes.ts` porte la réponse : `CALL_TYPES_VENTE = ['calendly', 'manual']`.
-- Un call manuel est un rendez-vous de vente créé par la plateforme elle-même —
-- la date saisie à la main pour un appel reporté ou un 2e call, ou le geste
-- « avancer vers RDV pris » du pipeline. Il n'a pas de `calendly_event_uuid`, et
-- la contrainte `calls_call_type_uuid_consistency` impose que seuls les
-- `calendly` en portent un : le créer sous le type `calendly` serait rejeté.
--
-- `detecterDoublons` le savait déjà (il appelle `estCallDeVente`). Seule cette
-- fonction SQL l'ignorait — le bandeau proposait donc une paire que
-- l'automatisme ne pouvait pas traiter.
--
-- ⚠️ D'OÙ VIENT L'ERREUR, parce qu'elle se reproduira. Une consigne circule,
-- hors du dépôt, sous la forme « `call_type` : 'calendly' = vente, 'google' =
-- coaching ». Elle ne mentionne pas `manual`, elle est plus ancienne que la
-- règle du code, et rien ne la périme. Deux sessions s'y sont trompées le même
-- jour — l'une a compté 17 rendez-vous au lieu de 18, l'autre a écrit cette
-- fonction.
--
-- ⚠️ Cette consigne n'est PAS dans AGENTS.md — vérifié, `call_type` n'y apparaît
-- nulle part. Une première version de ce commentaire l'y attribuait : accuser le
-- mauvais document aurait envoyé le prochain lecteur corriger un fichier
-- innocent, et laissé la vraie source intacte.
--
-- **Une règle vit dans le code, jamais dans une phrase de documentation.**
-- `lib/callTypes.ts` existe précisément pour ça, et il dit lui-même pourquoi :
-- jusqu'au 2026-08-29 un call manuel « était écrit en base et n'apparaissait sur
-- AUCUN écran ».
--
-- Mesuré ici le 2026-09-07 : un rendez-vous manuel non ignoré, avec une adresse
-- (`rapporttestpass@gmail.com`, `source = ig_description`) — donc exactement le
-- profil que cette fusion doit servir. Il n'a aujourd'hui aucun homologue portant
-- la même adresse, donc le rattrapage ne le déplacera pas ; la règle, elle,
-- redevient vraie.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.fusionner_call_par_email(p_call_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_eleve      uuid;
  v_email      text;
  v_prospect   uuid;
  v_deja       uuid;
  v_lead       uuid;
  v_ids        uuid[];
begin
  -- `in ('calendly','manual')` et jamais `= 'calendly'` : voir CALL_TYPES_VENTE
  -- dans lib/callTypes.ts. Un rendez-vous de coaching ('google') n'a pas
  -- d'invite et n'entre pas dans ce parcours.
  select c.coach_id, lower(trim(c.invitee_email)), c.prospect_id, c.ig_lead_id
    into v_eleve, v_email, v_prospect, v_deja
  from public.calls c
  where c.id = p_call_id and c.ignored is not true
    and c.call_type in ('calendly', 'manual');

  if v_eleve is null or v_deja is not null or v_email is null or v_email = '' then
    return null;
  end if;

  if exists (
    select 1 from auth.users u where u.id = v_eleve and lower(u.email) = v_email
  ) then
    return null;
  end if;

  select c.ig_lead_id into v_lead
  from public.calls c
  where c.coach_id = v_eleve
    and c.ignored is not true
    and c.call_type in ('calendly', 'manual')
    and c.ig_lead_id is not null
    and c.id <> p_call_id
    and lower(trim(c.invitee_email)) = v_email
  order by c.scheduled_at asc nulls last, c.id asc
  limit 1;

  if v_lead is null then return null; end if;

  if v_prospect is not null and exists (
    select 1 from public.fusions_fiches f
    where f.profile_id = v_eleve
      and f.ig_lead_id = v_lead
      and f.prospect_id = v_prospect
      and f.statut in ('refusee', 'separee')
  ) then
    return null;
  end if;

  update public.calls set ig_lead_id = v_lead where id = p_call_id;

  if v_prospect is not null then
    select coalesce(f.call_ids, '{}'::uuid[]) into v_ids
    from public.fusions_fiches f
    where f.profile_id = v_eleve and f.ig_lead_id = v_lead and f.prospect_id = v_prospect;

    insert into public.fusions_fiches (profile_id, ig_lead_id, prospect_id, statut, call_ids, decided_at)
    values (v_eleve, v_lead, v_prospect, 'fusionnee',
            array(select distinct unnest(coalesce(v_ids, '{}'::uuid[]) || p_call_id)), now())
    on conflict (profile_id, ig_lead_id, prospect_id) do update
      set statut = 'fusionnee', call_ids = excluded.call_ids, decided_at = excluded.decided_at;
  end if;

  return v_lead;
end;
$$;

comment on function public.fusionner_call_par_email(uuid) is
  'Rattache un call de VENTE (calendly ou manual, voir lib/callTypes.ts) a un lead Instagram quand un autre call de vente du meme eleve porte exactement la meme adresse. Respecte refusee/separee, ecarte l''adresse du compte de l''eleve. Rend l''ig_lead_id pose, ou NULL.';

-- ⚠️ `create or replace` PRESERVE l'ACL tant que la signature ne change pas —
-- elle ne change pas ici. Le revoke de la migration precedente tient donc, mais
-- ca se verifie, ca ne se suppose pas :
--   select has_function_privilege('anon', 'public.fusionner_call_par_email(uuid)', 'EXECUTE');
-- doit rendre false.

-- ── Rattrapage, rejoue avec le bon perimetre ─────────────────────────────────
-- Le precedent ne voyait pas les rendez-vous manuels, ni comme cible ni comme
-- ancre. Il passe par la MEME fonction, donc l'historique et l'avenir suivent
-- exactement la meme regle.
do $$
declare r record; n int := 0;
begin
  for r in
    select c.id from public.calls c
    where c.ignored is not true and c.call_type in ('calendly', 'manual')
      and c.ig_lead_id is null
      and c.invitee_email is not null and trim(c.invitee_email) <> ''
    order by c.scheduled_at asc nulls last, c.id asc
  loop
    if public.fusionner_call_par_email(r.id) is not null then n := n + 1; end if;
  end loop;
  raise notice 'fusion auto (calls manuels compris) : % rendez-vous rattaches', n;
end $$;
