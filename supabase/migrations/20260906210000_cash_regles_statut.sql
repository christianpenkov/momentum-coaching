-- La regle du cash cesse d'exister en double : le SQL n'a plus de formule
--
-- ── Le probleme qu'on ferme pour de bon ────────────────────────────────────────────
--
-- `lib/dealCash.ts` et la vue `ventes_cash_net` implementaient CHACUNE la liste des
-- statuts et leur effet sur la caisse. Le 2026-09-06, `dispute_lost` a ete ajoute au
-- code a 15 h 21 ; la vue l'ignorait encore a 21 h et rendait 3 200 EUR la ou les
-- ecrans affichaient 3 000. Les deux etaient chacune coherente avec elle-meme — aucun
-- test, aucun type, aucune relecture ne compare deux runtimes.
--
-- Le correctif d'alors ajoutait un garde-fou qui SIGNALAIT la divergence. Insuffisant :
-- il ne voyait qu'un statut nouveau ARRIVE EN DONNEES, jamais un changement de formule,
-- et il fallait encore penser a corriger les deux cotes.
--
-- ── Ce que cette migration change ──────────────────────────────────────────────────
--
-- La liste et les signes vivent desormais dans UNE TABLE, `cash_regles_statut`, et la
-- vue les LIT au lieu de les redire. Il n'y a plus de formule en SQL : plus rien a
-- oublier de mettre a jour. Ajouter un statut, c'est
--
--   1. une entree dans `REGLES_CASH` (lib/dealCash.ts, les deux copies) ;
--   2. une ligne dans `cash_regles_statut`.
--
-- Et `scripts/verifier-cash-sql.mjs`, branche dans `npm test`, refuse de passer si les
-- deux ne coincident pas EXACTEMENT — statut par statut, signe par signe. La divergence
-- est detectee avant qu'une seule ligne de donnees ne porte le nouveau statut, donc
-- avant que le moindre chiffre ne soit faux a l'ecran.
--
-- ── Pourquoi `par_statut` en jsonb plutot que des colonnes nommees ─────────────────
--
-- La version precedente exposait `encaisse_brut`, `rembourse`, `conteste`,
-- `perdu_en_litige` : quatre colonnes en dur, donc quatre choses a ajouter a chaque
-- statut, donc quatre occasions d'oublier. `par_statut` porte le detail sans nommer
-- aucun statut : `par_statut->>'refunded'` pour lire un montant. Une colonne de moins
-- a maintenir a chaque evolution, et la vue devient litteralement invariante.
--
-- ── Ce qui reste volontairement en dur ─────────────────────────────────────────────
--
-- `encaisse_retenu` (ecretage au contracte) et `a_rembourser` (le surplus) sont des
-- regles de CADRAGE, pas de statuts : elles ne changent pas quand un statut s'ajoute.
-- Elles restent donc ecrites ici, et `lib/dealCash.ts` les porte sous les noms
-- `encaisseRetenu()` et `aRembourser()`.

create table if not exists public.cash_regles_statut (
  statut  text primary key,
  -- +1 entre en caisse, -1 en sort, 0 ne la touche pas. `0` n'est pas « rien » :
  -- c'est la preuve qu'on a DECIDE qu'un paiement echoue ne bouge pas la caisse.
  signe   smallint not null check (signe in (-1, 0, 1)),
  -- Le champ correspondant de l'interface `Cash` cote TypeScript, ou null quand on ne
  -- somme pas. Sert au verificateur : il controle que les deux runtimes rangent la
  -- somme au meme endroit, pas seulement qu'ils tombent sur le meme total.
  champ_ts text,
  note     text
);

comment on table public.cash_regles_statut is
  'La source SQL des statuts de paiement et de leur effet sur la caisse. Doit correspondre EXACTEMENT a REGLES_CASH dans lib/dealCash.ts — scripts/verifier-cash-sql.mjs le verifie a chaque npm test. Ajouter un statut ici ET la-bas, jamais dans une formule.';

insert into public.cash_regles_statut (statut, signe, champ_ts, note) values
  ('succeeded',     1, 'encaisse',      'Paiement reussi : entre en caisse.'),
  ('refunded',     -1, 'rembourse',     'Rembourse volontairement. Ligne SEPAREE du paiement qu''elle annule (identifiants Stripe differents) — c''est ce qui rend la soustraction juste.'),
  ('disputed',     -1, 'conteste',      'Litige EN COURS : Stripe reprend les fonds le temps de l''instruction. Peut encore etre gagne.'),
  ('dispute_lost', -1, 'perduEnLitige', 'Litige PERDU : l''argent est parti pour de bon. Compte a part de `rembourse` — la fiche affiche les remboursements avec la raison donnee par l''eleve, et un litige perdu n''est pas un geste volontaire.'),
  ('failed',        0, null,            'Paiement echoue : ne bouge pas la caisse. Sert seulement a distinguer `past_due` de `open` (`aEchoue` cote TS).')
on conflict (statut) do update
  set signe = excluded.signe, champ_ts = excluded.champ_ts, note = excluded.note;

-- Table de reference, pas de donnees d'eleve : aucune ligne n'est personnelle. La RLS
-- est activee sans policy — seul `service_role` lit, comme pour la vue qui s'en sert.
alter table public.cash_regles_statut enable row level security;

-- ── La vue, desormais sans aucune formule de statut ────────────────────────────────
drop view if exists public.ventes_cash_net;

create view public.ventes_cash_net as
select
  d.profile_id,
  d.id                                  as deal_id,
  d.buyer_name,
  d.status                              as deal_status,
  d.signed_at,
  round(coalesce(d.amount_total, 0), 2) as contracte,
  -- Le detail par statut, sans en nommer aucun. `par_statut->>'refunded'` pour lire.
  coalesce(
    jsonb_object_agg(x.statut, x.montant) filter (where x.statut is not null),
    '{}'::jsonb
  )                                     as par_statut,
  -- `calculerCash().net` : la somme signee, les signes venant de la TABLE.
  round(coalesce(sum(x.montant * x.signe), 0), 2)                                  as encaisse_net,
  -- `encaisseRetenu()` : jamais plus que le contracte, sinon le surplus d'une vente
  -- vient effacer l'impaye d'une autre dans un total.
  round(least(coalesce(sum(x.montant * x.signe), 0), coalesce(d.amount_total, 0)), 2) as encaisse_retenu,
  -- `aRembourser()` : ce que l'ecretage met de cote, nomme plutot qu'efface.
  round(greatest(coalesce(sum(x.montant * x.signe), 0) - coalesce(d.amount_total, 0), 0), 2) as a_rembourser,
  coalesce(max(x.nb) filter (where x.signe = 1), 0)                                as nb_paiements,
  max(x.dernier) filter (where x.signe = 1)                                        as dernier_paiement
from deals d
left join lateral (
  select p.status as statut, r.signe, sum(p.amount) as montant,
         count(*) as nb, max(p.paid_at) as dernier
  from deal_payments p
  join cash_regles_statut r on r.statut = p.status
  where p.deal_id = d.id
  group by p.status, r.signe
) x on true
group by d.profile_id, d.id, d.buyer_name, d.status, d.signed_at, d.amount_total;

comment on view public.ventes_cash_net is
  'Le cash net par vente, seule lecture SQL autorisee du cash. Les statuts et leurs signes viennent de `cash_regles_statut`, PAS d''une formule ecrite ici : ajouter un statut ne demande aucune modification de cette vue. Miroir de lib/dealCash.ts (encaisse_net = calculerCash().net, encaisse_retenu = encaisseRetenu(), a_rembourser = aRembourser()). Ne filtre PAS les ventes annulees (filtrer deal_status) et ne borne aucune periode.';

alter view public.ventes_cash_net set (security_invoker = true);
revoke select on public.ventes_cash_net from anon, authenticated;

-- ── Le garde-fou, lui aussi sans liste en dur ──────────────────────────────────────
create or replace view public.ventes_sante_statut_paiement_inconnu as
select
  p.status                       as statut_inconnu,
  count(*)                       as lignes,
  sum(p.amount)                  as montant_total,
  min(p.paid_at)                 as vu_pour_la_premiere_fois,
  max(p.paid_at)                 as vu_pour_la_derniere_fois,
  'statut absent de cash_regles_statut — son montant n''est ni compte ni deduit, le cash affiche est faux'::text as anomalie
from deal_payments p
where not exists (select 1 from cash_regles_statut r where r.statut = p.status)
group by p.status;

comment on view public.ventes_sante_statut_paiement_inconnu is
  'Statuts de deal_payments absents de cash_regles_statut. Doit rendre ZERO ligne. Une ligne ici signifie que le cash affiche est faux — le montant concerne n''est ni compte ni deduit. Ne porte plus de liste en dur : elle interroge la table de reference.';

alter view public.ventes_sante_statut_paiement_inconnu set (security_invoker = true);
revoke select on public.ventes_sante_statut_paiement_inconnu from anon, authenticated;

-- ── La vue que le verificateur lit ─────────────────────────────────────────────────
--
-- `cash_regles_statut` est une TABLE avec RLS et sans policy : PostgREST la refuserait
-- meme au service_role sans exposition explicite. Cette vue la publie en lecture seule
-- pour le script, qui compare son contenu a `REGLES_CASH` du TypeScript.
create or replace view public.cash_regles_appliquees as
select statut, signe, champ_ts from public.cash_regles_statut;

comment on view public.cash_regles_appliquees is
  'Lecture seule de cash_regles_statut, pour scripts/verifier-cash-sql.mjs. Le script echoue si elle ne correspond pas exactement a REGLES_CASH dans lib/dealCash.ts.';

alter view public.cash_regles_appliquees set (security_invoker = true);
revoke select on public.cash_regles_appliquees from anon, authenticated;

-- ── Controles ──────────────────────────────────────────────────────────────────────
do $$
declare
  par_la_vue numeric := (select coalesce(sum(encaisse_net), 0) from ventes_cash_net);
  en_direct  numeric := (
    select coalesce(sum(p.amount * r.signe), 0)
    from deal_payments p
    join cash_regles_statut r on r.statut = p.status
    join deals d on d.id = p.deal_id
  );
  inconnus int := (select count(*) from ventes_sante_statut_paiement_inconnu);
  regles   int := (select count(*) from cash_regles_statut);
begin
  if regles < 5 then
    raise exception 'cash_regles_statut : % regle(s) seulement, l''insertion a echoue', regles;
  end if;
  if round(par_la_vue, 2) is distinct from round(en_direct, 2) then
    raise exception 'ventes_cash_net : % par la vue contre % en direct', par_la_vue, en_direct;
  end if;
  if inconnus > 0 then
    raise exception 'ventes_cash_net : % statut(s) de paiement inconnu(s) en base', inconnus;
  end if;
end $$;
