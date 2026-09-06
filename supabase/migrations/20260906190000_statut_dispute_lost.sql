-- Un litige PERDU cesse d'etre un litige
--
-- ── Le probleme, constate en reel le 2026-09-06 ─────────────────────────────
--
-- Test complet du cycle d'un litige sur TestYT : 200 EUR contestes, preuves
-- envoyees avec `losing_evidence`, verdict `lost` chez Stripe. Momentum a fait
-- ce qu'il fallait — la ligne contestee RESTE, puisque la banque garde l'argent
-- pour de bon, et le net s'arrete a 900 EUR sur 1 100.
--
-- Mais la vente reste « Contestee » POUR TOUJOURS. `statutDeal` rend `disputed`
-- des qu'une ligne contestee existe, et cette ligne doit rester. Une pastille
-- rouge d'alerte sur une affaire close depuis des semaines, c'est encore une
-- alerte qu'on cesse de lire — le defaut que ce chantier traque partout.
--
-- ── Un seul signal pour deux etats ──────────────────────────────────────────
--
-- La cause est celle qui revient sans cesse ici : `status = 'disputed'` portait
-- a la fois « instruction EN COURS » et « verdict rendu, argent perdu ». Deux
-- situations qui n'appellent ni la meme couleur, ni la meme phrase, ni la meme
-- action — la premiere reclame une reponse sous quelques jours, la seconde ne
-- reclame plus rien.
--
-- Le meme jour, la meme confusion avait ete trouvee a quatre endroits de
-- l'interface (bandeau, ligne client, pastille, fiche) entre « litige ouvert »
-- et « reponse encore due ». Celle-ci en est la derniere couche, cote donnee.
--
-- ── Pourquoi un statut a part, et non `refunded` ────────────────────────────
--
-- Verser un litige perdu dans les remboursements aurait ete plus simple : meme
-- effet sur la caisse, aucune contrainte a toucher. Mais la fiche affiche
-- « X EUR rembourses » avec la RAISON que l'eleve a donnee — geste commercial,
-- retractation, erreur. Un litige perdu n'a aucune de ces raisons : l'eleve n'a
-- rien choisi, la banque a repris l'argent. L'y ranger ferait apparaitre comme
-- un geste volontaire une somme subie.
--
-- ── Ce que la contrainte autorise en plus ───────────────────────────────────
--
-- `deal_payments.status` : la ligne du litige bascule de `disputed` a
-- `dispute_lost` quand `charge.dispute.closed` arrive avec `status = lost`.
-- `deals.status`         : `statutDeal` peut desormais rendre `dispute_lost`.
--
-- La deduction du cash est identique dans les deux cas (lib/dealCash.ts et sa
-- copie Deno, tests a l'appui) : seule la LECTURE change.

alter table public.deal_payments drop constraint if exists deal_payments_status_check;
alter table public.deal_payments add constraint deal_payments_status_check
  check (status = any (array['succeeded', 'failed', 'pending', 'refunded', 'disputed', 'dispute_lost']));

alter table public.deals drop constraint if exists deals_status_check;
alter table public.deals add constraint deals_status_check
  check (status = any (array['open', 'paid', 'past_due', 'canceled', 'ended', 'disputed', 'dispute_lost']));

-- ── Rattrapage des litiges DEJA tranches ────────────────────────────────────
--
-- Une cause fermee ne repare pas la trace : les lignes deja ecrites porteraient
-- `disputed` pour toujours, et leurs ventes resteraient « Contestees » alors
-- que le nouveau code ne les ecrirait plus ainsi.
--
-- ⚠️ On ne bascule QUE les litiges dont la defaite est ETABLIE par le journal —
-- l'evenement `Litige perdu` ecrit par le webhook a la reception du verdict.
-- Deviner d'apres l'anciennete, ou d'apres une echeance depassee, transformerait
-- une instruction en cours en defaite definitive : exactement l'erreur que cette
-- migration corrige, dans l'autre sens.
update public.deal_payments p
set status = 'dispute_lost'
where p.status = 'disputed'
  and exists (
    select 1 from public.deal_events e
    where e.deal_id = p.deal_id
      and e.kind = 'dispute'
      and e.label like 'Litige perdu%'
      and e.at >= p.created_at
  );

-- Les ventes concernees suivent, avec la meme exigence de preuve.
update public.deals d
set status = 'dispute_lost'
where d.status = 'disputed'
  and exists (select 1 from public.deal_payments p
               where p.deal_id = d.id and p.status = 'dispute_lost')
  and not exists (select 1 from public.deal_payments p
                   where p.deal_id = d.id and p.status = 'disputed');
