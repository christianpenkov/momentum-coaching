-- ═══════════════════════════════════════════════════════════════════════════
-- Un remboursement intégral n'est pas une annulation
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Depuis le 2026-08-28 (commit 91f74504), `statutDeal` faisait basculer en
-- `canceled` toute vente dont l'argent était intégralement reparti. Le motif
-- écrit dans ce commit est juste et reste valable :
--
--     « tout remboursé après avoir encaissé → annulée, et non "en attente",
--       qui aurait relancé un client qu'on vient de rembourser »
--
-- Mais `canceled` était une réponse plus FORTE que le motif ne l'exigeait. Le
-- besoin était « arrête de réclamer l'argent » ; `canceled` fait cela, ET efface
-- la vente du cash contracté, ET déclasse l'appel qui l'a produite.
--
-- `ended` porte exactement les quatre protections voulues — liens désactivés,
-- aucun rappel d'échéance, sortie de l'onglet Relances, statut qui ne se
-- recalcule plus (lib/dealCash.ts:251) — sans les deux effets de trop.
--
-- Relevé par Chris le 2026-09-09 : « un remboursement intégral c'est pas une
-- annulation de la vente […] tu peux pas annuler une vente si y a de
-- l'encaissé, à ce moment-là c'est CLÔTURER une vente, et là ça reste dans le
-- closing ».
--
-- ── Ce qui distingue désormais les deux ────────────────────────────────────
-- Une INTENTION, posée par le seul geste qui l'exprime : le bouton « Annuler la
-- vente ». Quand de l'argent est encore là, ce bouton ne peut pas conclure tout
-- de suite — il demande de rembourser d'abord. L'intention existait donc déjà,
-- elle n'était simplement stockée nulle part, et le webhook qui constatait le
-- remboursement quelques minutes plus tard ne pouvait pas la retrouver.

alter table public.deals
  add column if not exists cancel_requested_at timestamptz;

comment on column public.deals.cancel_requested_at is
  'Quand l''élève a DEMANDÉ l''annulation, depuis « Annuler la vente ». Posée au clic, avant tout remboursement — c''est justement l''écart entre le clic et l''arrivée du remboursement qui rendait l''intention introuvable. Lue par statutDeal() pour trancher entre `canceled` (annulation voulue) et `ended` (remboursement intégral sans annulation). NULL = personne n''a demandé l''annulation, quoi qu''il soit arrivé à l''argent.';

-- ═══════════════════════════════════════════════════════════════════════════
-- Backfill — « cause fermée ≠ trace réparée »
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Les lignes déjà écrites portent la valeur que l'ancien code produisait. On
-- les réécrit avec celle que le nouveau aurait produite, et SEULEMENT celles-là.
--
-- Le discriminant historique est l'ABSENCE de geste humain. Une annulation
-- voulue laisse toujours une ligne de journal signée (`actor_id`) : le parcours
-- guidé en écrit une au clic (« Annulation demandée — X à rembourser ») et
-- l'annulation immédiate en écrit une autre (« Vente annulée »). Le constat
-- automatique d'un remboursement, lui, n'a pas d'auteur.
--
-- ⚠️ On ne fabrique rien : `ended_reason` dit explicitement que c'est un
-- rattrapage, et `ended_at` reprend la date du remboursement quand elle existe
-- plutôt que d'inventer « maintenant ». Une vente annulée sans rien avoir
-- encaissé n'est pas touchée — elle n'a jamais été concernée par cette règle.

with concernees as (
  select d.id,
         (select max(p.paid_at) from public.deal_payments p
           where p.deal_id = d.id and p.status = 'refunded') as dernier_remboursement
  from public.deals d
  join public.ventes_cash_net v on v.deal_id = d.id
  where d.status = 'canceled'
    -- Tout l'argent est reparti : c'est bien cette règle-ci qui l'a annulée.
    and v.encaisse_net <= 0.01
    -- ...et il est reparti par un REMBOURSEMENT (et non par un litige perdu,
    -- que `dispute_lost` couvre déjà et qui ne se raconte pas pareil).
    and exists (
      select 1 from public.deal_payments p
      where p.deal_id = d.id and p.status = 'refunded'
    )
    -- Aucun humain n'a demandé cette annulation.
    and not exists (
      select 1 from public.deal_events e
      where e.deal_id = d.id and e.kind = 'canceled' and e.actor_id is not null
    )
)
update public.deals d
set status        = 'ended',
    ended_by      = 'stripe',
    ended_at      = coalesce(d.ended_at, c.dernier_remboursement, now()),
    ended_reason  = 'Remboursement intégral constaté chez Stripe — aucune annulation n''avait été demandée (rattrapage du 2026-09-09)'
from concernees c
where d.id = c.id;

-- La trace du rattrapage, dans le journal que les écrans affichent. Sans
-- `actor_id` : personne n'a fait ce geste, c'est une migration.
insert into public.deal_events (deal_id, kind, label, meta)
select d.id,
       'ended',
       'Vente reclassée « clôturée » — un remboursement intégral n''est pas une annulation',
       jsonb_build_object(
         'motif_rattrapage', 'migration 20260909120000_annulation_demandee',
         'statut_avant', 'canceled'
       )
from public.deals d
where d.ended_reason = 'Remboursement intégral constaté chez Stripe — aucune annulation n''avait été demandée (rattrapage du 2026-09-09)'
  -- Rejouable sans doubler la trace : `add column if not exists` plus haut dit
  -- déjà que cette migration doit survivre à une seconde application.
  and not exists (
    select 1 from public.deal_events e
    where e.deal_id = d.id
      and e.meta ->> 'motif_rattrapage' = 'migration 20260909120000_annulation_demandee'
  );
