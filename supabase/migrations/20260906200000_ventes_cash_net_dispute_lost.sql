-- `ventes_cash_net` ignorait `dispute_lost`, et rien ne l'a signale
--
-- ── Ce qui s'est passe, en trois heures ────────────────────────────────────────────
--
-- La vue a ete creee le 2026-09-06 a 13 h 04 POUR empecher que la regle du cash soit
-- reecrite a la main. Son propre en-tete disait : « Toute evolution de lib/dealCash.ts
-- doit etre repercutee ICI, et reciproquement. »
--
-- A 15 h 21, une autre session a ajoute le statut `dispute_lost` (« un litige perdu
-- cesse d'etre un litige ») et l'a traite dans `lib/dealCash.ts` :
--   net = encaisse − rembourse − conteste − perduEnLitige
--
-- La vue, elle, ne connaissait que les trois premiers. Elle a donc rendu 3 200 EUR la
-- ou l'ecran, lui correct, affichait 3 000 EUR. Trouve a 21 h par une verification au
-- NAVIGATEUR — aucun test, aucun type, aucune relecture ne pouvait le voir : les deux
-- implementations etaient chacune coherente avec elle-meme.
--
-- ⚠️ La lecon n'est pas « il fallait mieux relire ». Une regle qui vit dans deux
-- runtimes DIVERGERA, c'est une question de temps, pas d'attention. Ce que la vue peut
-- faire, c'est cesser de diverger EN SILENCE.
--
-- ── Le garde-fou ──────────────────────────────────────────────────────────────────
--
-- `ventes_sante_statut_paiement_inconnu` plus bas liste tout statut de `deal_payments`
-- hors des cinq que la vue sait traiter. Elle rend zero ligne aujourd'hui ; le jour ou
-- Stripe ou le produit en ajoute un sixieme, elle le nomme immediatement — avant que
-- quiconque n'ait a comparer deux chiffres pour s'en apercevoir.
--
-- C'est la meme forme que `acces_sante_lecture` : elle ne teste pas une liste, elle
-- teste l'INVARIANT, donc un cas nouveau y tombe par construction.

-- ⚠️ `drop` + `create`, et non `create or replace` : Postgres refuse d'INSERER une
-- colonne au milieu d'une vue existante (« cannot change name of view column »).
-- `perdu_en_litige` est place a cote de ses trois freres plutot qu'a la fin, parce que
-- l'ordre des colonnes est la premiere chose qu'on lit pour verifier une formule.
--
-- Le `revoke` plus bas est donc OBLIGATOIRE et pas decoratif : a la recreation, les
-- privileges par defaut du schema re-accordent la lecture a `anon`. Meme piege que pour
-- les fonctions, documente dans AGENTS.md le 2026-09-06.
drop view if exists public.ventes_cash_net;

create view public.ventes_cash_net as
select
  d.profile_id,
  d.id                                     as deal_id,
  d.buyer_name,
  d.status                                 as deal_status,
  d.signed_at,
  round(coalesce(d.amount_total, 0), 2)    as contracte,
  round(coalesce(sum(p.amount) filter (where p.status = 'succeeded'), 0), 2)    as encaisse_brut,
  round(coalesce(sum(p.amount) filter (where p.status = 'refunded'),  0), 2)    as rembourse,
  round(coalesce(sum(p.amount) filter (where p.status = 'disputed'),  0), 2)    as conteste,
  -- Ajoute le 2026-09-06 : un litige PERDU sort definitivement de la caisse. Il est
  -- distinct de `disputed`, qui est un litige EN COURS et peut encore etre gagne.
  round(coalesce(sum(p.amount) filter (where p.status = 'dispute_lost'), 0), 2) as perdu_en_litige,
  -- `calculerCash().net` — les quatre termes, dans le meme ordre que lib/dealCash.ts.
  round(
      coalesce(sum(p.amount) filter (where p.status = 'succeeded'),    0)
    - coalesce(sum(p.amount) filter (where p.status = 'refunded'),     0)
    - coalesce(sum(p.amount) filter (where p.status = 'disputed'),     0)
    - coalesce(sum(p.amount) filter (where p.status = 'dispute_lost'), 0)
  , 2)                                     as encaisse_net,
  -- `encaisseRetenu(cash, amount_total)` : jamais plus que le contracte, sinon le
  -- surplus d'une vente vient effacer l'impaye d'une autre dans un total.
  round(least(
      coalesce(sum(p.amount) filter (where p.status = 'succeeded'),    0)
    - coalesce(sum(p.amount) filter (where p.status = 'refunded'),     0)
    - coalesce(sum(p.amount) filter (where p.status = 'disputed'),     0)
    - coalesce(sum(p.amount) filter (where p.status = 'dispute_lost'), 0)
  , coalesce(d.amount_total, 0)), 2)       as encaisse_retenu,
  -- `aRembourser(cash, amount_total)` : ce que l'ecretage met de cote, nomme plutot
  -- qu'efface. `greatest(…, 0)` — un impaye n'est pas un surplus negatif.
  round(greatest(
      coalesce(sum(p.amount) filter (where p.status = 'succeeded'),    0)
    - coalesce(sum(p.amount) filter (where p.status = 'refunded'),     0)
    - coalesce(sum(p.amount) filter (where p.status = 'disputed'),     0)
    - coalesce(sum(p.amount) filter (where p.status = 'dispute_lost'), 0)
    - coalesce(d.amount_total, 0)
  , 0), 2)                                 as a_rembourser,
  count(*) filter (where p.status = 'succeeded')                     as nb_paiements,
  max(p.paid_at) filter (where p.status = 'succeeded')               as dernier_paiement
from deals d
left join deal_payments p on p.deal_id = d.id
group by d.profile_id, d.id, d.buyer_name, d.status, d.signed_at, d.amount_total;

comment on view public.ventes_cash_net is
  'Le cash net par vente, seule lecture SQL autorisee du cash. Reprend terme a terme lib/dealCash.ts : encaisse_net = calculerCash().net (succeeded − refunded − disputed − dispute_lost), encaisse_retenu = encaisseRetenu(), a_rembourser = aRembourser(). Ne filtre PAS les ventes annulees (filtrer deal_status) et ne borne aucune periode (tresorerie sur paid_at, cohorte sur signed_at). ⚠️ Tout statut ajoute a lib/dealCash.ts doit l''etre ici : ventes_sante_statut_paiement_inconnu le signale.';

alter view public.ventes_cash_net set (security_invoker = true);
revoke select on public.ventes_cash_net from anon, authenticated;

-- ── Le garde-fou : un statut que la vue ne sait pas traiter ────────────────────────
--
-- Elle n'enumere pas ce qui va mal, elle enumere ce que la vue SAIT faire et signale le
-- reste. Un statut nouveau y tombe donc sans que personne ait a y penser.
create or replace view public.ventes_sante_statut_paiement_inconnu as
select
  p.status                                   as statut_inconnu,
  count(*)                                   as lignes,
  sum(p.amount)                              as montant_total,
  min(p.paid_at)                             as vu_pour_la_premiere_fois,
  max(p.paid_at)                             as vu_pour_la_derniere_fois,
  'statut absent de ventes_cash_net et peut-etre de lib/dealCash.ts — le cash est faux tant qu''il n''y est pas traite'::text as anomalie
from deal_payments p
where p.status is null
   or p.status not in ('succeeded', 'refunded', 'disputed', 'dispute_lost', 'failed')
group by p.status;

comment on view public.ventes_sante_statut_paiement_inconnu is
  'Statuts de deal_payments que ventes_cash_net ne sait pas traiter. Doit rendre ZERO ligne. Une ligne ici signifie que le cash affiche est faux — le montant concerne n''est ni compte ni deduit. Nee le 2026-09-06 apres que la vue a ignore `dispute_lost` pendant trois heures sans que rien ne le signale.';

alter view public.ventes_sante_statut_paiement_inconnu set (security_invoker = true);
revoke select on public.ventes_sante_statut_paiement_inconnu from anon, authenticated;

-- Controle : la vue doit rendre le meme net que la somme directe des quatre statuts,
-- ET le garde-fou doit etre muet. Si un sixieme statut existait deja, cette migration
-- echoue plutot que de poser une source de verite fausse.
do $$
declare
  par_la_vue numeric := (select coalesce(sum(encaisse_net), 0) from ventes_cash_net);
  en_direct  numeric := (
    select coalesce(sum(case p.status
                          when 'succeeded'    then p.amount
                          when 'refunded'     then -p.amount
                          when 'disputed'     then -p.amount
                          when 'dispute_lost' then -p.amount
                          else 0 end), 0)
    from deal_payments p join deals d on d.id = p.deal_id
  );
  inconnus int := (select count(*) from ventes_sante_statut_paiement_inconnu);
begin
  if round(par_la_vue, 2) is distinct from round(en_direct, 2) then
    raise exception 'ventes_cash_net : % par la vue contre % en direct', par_la_vue, en_direct;
  end if;
  if inconnus > 0 then
    raise exception 'ventes_cash_net : % statut(s) de paiement inconnu(s) en base', inconnus;
  end if;
end $$;
