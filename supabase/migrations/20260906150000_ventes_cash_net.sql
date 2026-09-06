-- Le cash net d'une vente, lisible en SQL : la regle de lib/dealCash.ts, une seule fois
--
-- ── Pourquoi cette vue existe ──────────────────────────────────────────────────────
--
-- Le 2026-09-06, deux sessions ont controle les memes chiffres de l'onglet Revenus avec
-- deux requetes SQL ecrites a la main. L'une deduisait `refunded` mais pas `disputed`,
-- l'autre les deux — d'ou deux « verites » et une heure passee a chercher laquelle avait
-- raison. Personne n'avait touche au code : les cinq ecrans passaient deja par
-- `calculerCash`. AGENTS.md porte desormais la regle : ne jamais sommer les paiements a
-- la main, y compris dans une requete de VERIFICATION.
--
-- Mais une regle ecrite est une discipline, et une discipline s'oublie — c'est
-- exactement ce qui venait de se produire, sur une regle deja ecrite depuis le
-- 2026-08-30. Cette vue est le MECANISME qui rend la discipline inutile : il n'y a plus
-- rien a reimplementer, donc plus rien a oublier.
--
-- ── Pourquoi `ventes_sante_sur_encaissement` ne pouvait pas servir ─────────────────
--
-- Elle calcule DEJA `succeeded − refunded − disputed`, exactement. Mais son `having` ne
-- garde que les trop-percus restes sans suite plus de 72 h : c'est une ALERTE, et une
-- alerte ne repond pas a « combien cette vente a-t-elle rapporte ». Le calcul juste
-- existait donc en base, enferme derriere un filtre qui le rendait inutilisable comme
-- source de verite. D'ou les deux requetes reecrites a la main.
--
-- ── La correspondance avec lib/dealCash.ts, terme a terme ─────────────────────────
--
--   encaisse_brut    = `encaisse`      (paiements `succeeded`)
--   rembourse        = `rembourse`     (paiements `refunded`)
--   conteste         = `conteste`      (paiements `disputed`)
--   encaisse_net     = `calculerCash().net`
--   encaisse_retenu  = `encaisseRetenu(cash, amount_total)` — ecrete au contracte
--   a_rembourser     = `aRembourser(cash, amount_total)`    — le surplus, jamais negatif
--
-- ⚠️ Toute evolution de `lib/dealCash.ts` doit etre repercutee ICI, et reciproquement.
-- C'est le prix d'une regle qui doit vivre dans deux runtimes (TypeScript et SQL) ; la
-- parade est que les deux se nomment mutuellement, ici et dans le fichier TS.
--
-- ── Ce que la vue ne fait PAS, deliberement ──────────────────────────────────────
--
-- Elle ne filtre pas les ventes annulees. `calculerCash` ne connait pas le statut du
-- deal non plus : c'est l'appelant qui decide. `deal_status` est donc expose, et tout
-- lecteur qui totalise doit ajouter `where deal_status is distinct from 'canceled'` —
-- la meme condition que les ecrans appliquent deja.
--
-- Elle ne borne aucune periode. Le decoupage n'est pas une propriete du cash : selon la
-- question posee il se fait sur `paid_at` (tresorerie) ou sur `signed_at` (cohorte), et
-- les deux sont legitimes. Voir docs/handoff-cash-revenus.md pour la regle qui tranche.
--
-- ── Securite ─────────────────────────────────────────────────────────────────────
--
-- `security_invoker = true` + `revoke` sur `anon` et `authenticated`, comme les quinze
-- vues de sante depuis 20260903170000. Sans les deux, `acces_sante_lecture` la
-- signalerait immediatement en anomalie — et elle aurait raison : `deals` porte des noms
-- d'acheteurs et des montants.

create or replace view public.ventes_cash_net as
select
  d.profile_id,
  d.id                                     as deal_id,
  d.buyer_name,
  d.status                                 as deal_status,
  d.signed_at,
  round(coalesce(d.amount_total, 0), 2)    as contracte,
  round(coalesce(sum(p.amount) filter (where p.status = 'succeeded'), 0), 2) as encaisse_brut,
  round(coalesce(sum(p.amount) filter (where p.status = 'refunded'),  0), 2) as rembourse,
  round(coalesce(sum(p.amount) filter (where p.status = 'disputed'),  0), 2) as conteste,
  -- `calculerCash().net`
  round(
      coalesce(sum(p.amount) filter (where p.status = 'succeeded'), 0)
    - coalesce(sum(p.amount) filter (where p.status = 'refunded'),  0)
    - coalesce(sum(p.amount) filter (where p.status = 'disputed'),  0)
  , 2)                                     as encaisse_net,
  -- `encaisseRetenu(cash, amount_total)` : jamais plus que le contracte, sinon le
  -- surplus d'une vente vient effacer l'impaye d'une autre dans un total.
  round(least(
      coalesce(sum(p.amount) filter (where p.status = 'succeeded'), 0)
    - coalesce(sum(p.amount) filter (where p.status = 'refunded'),  0)
    - coalesce(sum(p.amount) filter (where p.status = 'disputed'),  0)
  , coalesce(d.amount_total, 0)), 2)       as encaisse_retenu,
  -- `aRembourser(cash, amount_total)` : ce que l'ecretage met de cote, nomme plutot
  -- qu'efface. `greatest(…, 0)` — un impaye n'est pas un surplus negatif.
  round(greatest(
      coalesce(sum(p.amount) filter (where p.status = 'succeeded'), 0)
    - coalesce(sum(p.amount) filter (where p.status = 'refunded'),  0)
    - coalesce(sum(p.amount) filter (where p.status = 'disputed'),  0)
    - coalesce(d.amount_total, 0)
  , 0), 2)                                 as a_rembourser,
  count(*) filter (where p.status = 'succeeded')                     as nb_paiements,
  max(p.paid_at) filter (where p.status = 'succeeded')               as dernier_paiement
from deals d
left join deal_payments p on p.deal_id = d.id
group by d.profile_id, d.id, d.buyer_name, d.status, d.signed_at, d.amount_total;

comment on view public.ventes_cash_net is
  'Le cash net par vente, seule lecture SQL autorisee du cash. Reprend terme a terme lib/dealCash.ts : encaisse_net = calculerCash().net, encaisse_retenu = encaisseRetenu(), a_rembourser = aRembourser(). Ne filtre PAS les ventes annulees (filtrer deal_status) et ne borne aucune periode (tresorerie sur paid_at, cohorte sur signed_at). Toute requete qui somme deal_payments a la main est un bug en attente : elle oubliera un statut.';

-- `security_invoker` : la vue s'execute avec les droits de l'appelant, donc la RLS de
-- `deals` s'applique. Un eleve connecte ne verrait que ses ventes, `anon` aucune.
alter view public.ventes_cash_net set (security_invoker = true);

-- Defense en profondeur : meme sans lecteur legitime parmi eux aujourd'hui, on ferme
-- explicitement — c'est l'invariant que `acces_sante_lecture` surveille.
revoke select on public.ventes_cash_net from anon, authenticated;

-- Controle : la vue doit rendre le meme net que la somme des trois statuts. Une egalite
-- triviale a la lecture, mais elle echouerait si un `filter` etait recopie de travers.
do $$
declare
  par_la_vue numeric := (select coalesce(sum(encaisse_net), 0) from ventes_cash_net);
  en_direct  numeric := (
    select coalesce(sum(case p.status when 'succeeded' then p.amount
                                      when 'refunded'  then -p.amount
                                      when 'disputed'  then -p.amount
                                      else 0 end), 0)
    from deal_payments p
    join deals d on d.id = p.deal_id
  );
begin
  if round(par_la_vue, 2) is distinct from round(en_direct, 2) then
    raise exception 'ventes_cash_net : % par la vue contre % en direct', par_la_vue, en_direct;
  end if;
end $$;
