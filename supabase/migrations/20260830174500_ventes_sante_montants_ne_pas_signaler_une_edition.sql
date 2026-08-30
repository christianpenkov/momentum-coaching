-- Correction de 20260830031500. La vue signalait tout ecart entre le montant du
-- rapport (calls.revenue) et celui du deal (deals.amount_total). Or editer le montant
-- d'un deal depuis la page Paiements est une action NORMALE, et
-- app/api/payments/deals/[id]/amount ne reecrit deliberement pas calls.revenue : ce
-- champ est la trace de ce qui a ete DECLARE dans le rapport, pas une source de cash.
-- L'ecart est donc attendu apres chaque edition.
--
-- Une vue de sante qui se remplit lors d'un usage normal cesse d'etre lue. Celle-ci
-- serait devenue non vide a la premiere correction de montant.
--
-- Elle ne signale donc plus qu'un ecart NON EXPLIQUE par une edition : un deal dont
-- updated_at n'a jamais bouge depuis sa creation et dont le montant differe pourtant
-- du rapport — le seul cas ou le chemin d'ecriture est en cause. Verifie le
-- 2026-08-30 : les 4 deals jamais edites portent tous exactement le montant de leur
-- rapport, ce qui disculpe ce chemin.
--
-- Limite assumee : un backfill en masse qui touche updated_at rend le controle
-- aveugle sur les lignes concernees. C'est le prix a payer pour ne pas produire un
-- faux positif a chaque correction de montant ; le deal_manquant, lui, reste
-- inconditionnel.

create or replace view ventes_sante_montants as
select
  c.coach_id                              as profile_id,
  c.id                                    as call_id,
  c.invitee_name,
  c.source,
  c.booked_at,
  c.revenue                               as montant_rapport,
  d.amount_total                          as montant_deal,
  case
    when d.id is null then 'deal_manquant'
    else 'montant_jamais_edite_mais_divergent'
  end                                     as anomalie
from calls c
left join deals d
  on d.call_id = c.id
 and d.status <> 'canceled'
where c.deal_closed
  and c.ignored is not true
  and c.call_type in ('calendly', 'manual')
  and c.status = 'active'
  and (
    -- Du cash declare qu'aucun deal ne porte : trou reel, toujours signale.
    d.id is null
    -- Ou un montant qui diverge SANS qu'une edition puisse l'expliquer.
    or (
      coalesce(d.amount_total, 0) <> coalesce(c.revenue, 0)
      and d.updated_at <= d.created_at + interval '1 minute'
    )
  );
