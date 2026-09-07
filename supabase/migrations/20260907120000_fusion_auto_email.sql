-- ─────────────────────────────────────────────────────────────────────────────
-- Fusionner automatiquement deux fiches qui partagent un e-mail EXACT
--
-- ── LE PROBLÈME ──────────────────────────────────────────────────────────────
--
-- Une même personne peut occuper deux fiches : une fiche Instagram (elle a
-- commenté) et une fiche e-mail (elle a réservé depuis une bio ou une
-- description, donc un `call` sans `ig_lead_id`). Tant que le coach n'a pas
-- cliqué le bandeau de doublon, elle est comptée DEUX FOIS partout.
--
-- Un lead Instagram n'acquiert une adresse qu'en réservant : c'est le call qui
-- porte `ig_lead_id` ET `invitee_email`. Le pont est donc indirect, et il
-- n'existe qu'à partir du premier rendez-vous.
--
-- Décision de Chris (2026-09-07) : l'adresse exacte suffit, « personne au monde
-- n'a exactement le même email ».
--
-- ── POURQUOI UNE FONCTION SQL ET PAS DU CODE ─────────────────────────────────
--
-- Deux chemins écrivent les rendez-vous : l'Edge Function `sync-calendly` (le
-- seul qui tourne aujourd'hui) et la route Vercel `api/webhooks/calendly`. La
-- première est en Deno et ne peut PAS importer `lib/`.
--
-- C'est très exactement d'avoir laissé ces deux chemins diverger qui a produit
-- le bug du 2026-08-27 : seule la route posait `prospect_id`, et 11 calls sur 13
-- n'étaient jamais rattachés. `resolve_prospect` avait été créée pour ça. Une
-- deuxième règle écrite deux fois referait la même erreur.
--
-- ── ELLE AGIT, ELLE NE CONSEILLE PAS ─────────────────────────────────────────
--
-- Elle prend un call DÉJÀ ÉCRIT et fait tout : le rattachement et sa trace. Une
-- variante qui se contenterait de rendre l'identifiant obligerait chaque
-- appelant à écrire la trace lui-même — deux endroits, donc un endroit qui
-- l'oubliera, et une fusion sans trace est une fusion que le coach ne peut plus
-- défaire (« Séparer » exige une décision `fusionnee`).
--
-- ── LES DEUX GARDES, TOUTES DEUX DÉCIDÉES PAR CHRIS ──────────────────────────
--
-- 1. UNE DÉCISION DU COACH NE SE CONTOURNE JAMAIS. `refusee` (« ce n'est pas la
--    même personne ») et `separee` (« défais ça ») bloquent le rapprochement.
--
--    ⚠️ `separee` est créé par cette migration, et il n'est pas décoratif.
--    Avant, « Séparer » SUPPRIMAIT la décision pour que le bandeau repropose la
--    paire. Avec une fusion automatique qui repasse toutes les 30 minutes, une
--    séparation aurait été défaite dans la demi-heure, en silence et pour
--    toujours. Le troisième état préserve l'intention d'origine — le bandeau
--    repose la question, l'automatique s'abstient.
--
-- 2. L'ADRESSE DU COMPTE DE L'ÉLÈVE LUI-MÊME est écartée. C'est le seul faux
--    positif connu : ses propres réservations de test. Vérifié en base le
--    2026-09-07 — `christianpenkov80@gmail.com` est à la fois l'adresse du
--    compte `a02e5927` et celle portée par un de ses calls. Le bandeau, lui,
--    continue de proposer la paire : on écarte l'automatisme, pas la
--    possibilité.
--
-- ── CE QUE ÇA NE CHANGE PAS ──────────────────────────────────────────────────
--
-- ⚠️ Poser `ig_lead_id` ne change PAS d'où vient le rendez-vous : `calls.source`
-- reste `yt_description`. La règle du 2026-08-29 tient — « l'attribution d'un
-- call se lit sur sa source, jamais sur son rattachement ». Une fusion qui
-- ferait basculer un call en « via DM » quelque part serait un bug.
--
-- `prospect_id` est conservé, comme le fait déjà la fusion manuelle : le call
-- porte les deux, et c'est `ig_lead_id` qui commande le regroupement.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Le troisième état ────────────────────────────────────────────────────────
alter table public.fusions_fiches drop constraint if exists fusions_fiches_statut_check;
alter table public.fusions_fiches
  add constraint fusions_fiches_statut_check
  check (statut = any (array['fusionnee'::text, 'refusee'::text, 'separee'::text]));

comment on column public.fusions_fiches.statut is
  'fusionnee = les deux fiches n''en font qu''une | refusee = ce n''est pas la meme personne, ne plus demander | separee = fusion defaite, le bandeau repropose mais la fusion automatique s''abstient.';

-- ── La règle, en un seul endroit ─────────────────────────────────────────────
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
  select c.coach_id, lower(trim(c.invitee_email)), c.prospect_id, c.ig_lead_id
    into v_eleve, v_email, v_prospect, v_deja
  from public.calls c
  where c.id = p_call_id and c.ignored is not true and c.call_type = 'calendly';

  -- Rien à faire : call absent, déjà rattaché, ou sans adresse.
  if v_eleve is null or v_deja is not null or v_email is null or v_email = '' then
    return null;
  end if;

  -- Garde 2 — les réservations de test de l'élève avec sa propre adresse.
  if exists (
    select 1 from auth.users u where u.id = v_eleve and lower(u.email) = v_email
  ) then
    return null;
  end if;

  -- L'autre fiche : un rendez-vous du MÊME élève, même adresse exacte, déjà
  -- rattaché à un lead Instagram.
  --
  -- ⚠️ Un `order by` explicite, et non le premier venu : sans lui, deux passages
  -- pourraient choisir deux leads différents pour la même adresse le jour où
  -- elle en désigne plusieurs. Le plus ancien rendez-vous gagne — c'est la
  -- première fiche que la personne a occupée.
  select c.ig_lead_id into v_lead
  from public.calls c
  where c.coach_id = v_eleve
    and c.ignored is not true
    and c.call_type = 'calendly'
    and c.ig_lead_id is not null
    and c.id <> p_call_id
    and lower(trim(c.invitee_email)) = v_email
  order by c.scheduled_at asc nulls last, c.id asc
  limit 1;

  if v_lead is null then return null; end if;

  -- Garde 1 — une décision du coach sur cette paire.
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

  -- La trace, sans laquelle « Séparer » n'a rien à défaire.
  --
  -- ⚠️ Elle n'existe que si le call porte un `prospect_id` : la clé d'une
  -- décision est la PAIRE (lead, prospect). Un call sans prospect est rattaché
  -- sans trace — il n'y a alors aucune paire à refuser, donc rien à défaire non
  -- plus. Ce cas est théorique : `resolve_prospect` pose un prospect dès qu'il y
  -- a une adresse, et c'est justement la condition d'entrée ici.
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
  'Rattache un call a un lead Instagram quand un autre call du meme eleve porte exactement la meme adresse. Respecte les decisions refusee/separee, et ecarte l''adresse du compte de l''eleve. Rend l''ig_lead_id pose, ou NULL.';

-- ⚠️ Supabase accorde EXECUTE a `anon` par defaut sur toute fonction nouvelle,
-- et un `create or replace` qui change la signature repasse par la creation.
-- Celle-ci est SECURITY DEFINER, ecrit dans `calls`, et prend un identifiant en
-- parametre : exactement le profil dangereux decrit dans AGENTS.md. Elle
-- n'est appelee que par la cle de service, depuis le cron et le webhook.
-- ⚠️ `from public`, PAS `from anon`. Le revoke sur `anon` seul ne fait RIEN :
-- PUBLIC garde EXECUTE et les deux rôles en héritent. Mesuré ici même —
-- `has_function_privilege('anon', …)` rendait encore `true` après un revoke sur
-- `anon` et `authenticated`. AGENTS.md documente l'inverse de ce piège
-- (« `revoke … from public` ne couvre pas `anon` ») ; les deux sens existent, et
-- la seule façon de savoir est de le demander à la base.
revoke execute on function public.fusionner_call_par_email(uuid) from public;
grant  execute on function public.fusionner_call_par_email(uuid) to service_role;

-- ── Rattrapage sur l'existant ────────────────────────────────────────────────
--
-- Mesuré le 2026-09-07 : 0 paire concernée, sur 19 rendez-vous de vente portant
-- une adresse. Ce rattrapage ne change donc RIEN aujourd'hui.
--
-- Il existe pour que la règle soit vraie sur tout l'historique et pas seulement
-- à partir de maintenant — décision de Chris : « je choisis les deux comme ça on
-- a pas de trucs qui sont différents de compta différente ».
--
-- ⚠️ Ce zéro ne prouve rien sur l'avenir : la base ne contient que des données
-- de test. C'est la même erreur de raisonnement que celle corrigée le
-- 2026-08-27, où « chevauchement = 0 » avait failli faire abandonner la
-- détection des doublons.
--
-- Il passe par la MÊME fonction que les deux chemins d'écriture : un rattrapage
-- qui réimplémenterait la règle produirait un historique different de ce que le
-- code produira demain.
do $$
declare r record; n int := 0;
begin
  for r in
    select c.id from public.calls c
    where c.ignored is not true and c.call_type = 'calendly'
      and c.ig_lead_id is null
      and c.invitee_email is not null and trim(c.invitee_email) <> ''
    order by c.scheduled_at asc nulls last, c.id asc
  loop
    if public.fusionner_call_par_email(r.id) is not null then n := n + 1; end if;
  end loop;
  raise notice 'fusion auto par e-mail : % rendez-vous rattaches', n;
end $$;
