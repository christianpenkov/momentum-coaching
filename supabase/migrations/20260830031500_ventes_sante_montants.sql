-- Le cash a DEUX écritures pour une même vente : le montant saisi dans le rapport
-- de call (`calls.revenue`) et le deal qui en découle (`deals.amount_total`). Depuis
-- le 2026-08-20, tous les écrans lisent `deals` — `calls.revenue` n'est plus qu'une
-- trace du rapport.
--
-- Rien ne vérifiait que les deux disent la même chose. Constaté le 2026-08-30 : un
-- call dont le rapport annonce 3 000 € porte un deal de 1 200 €. L'écran affiche
-- 1 200 € (la bonne règle), l'élève se souvient d'avoir saisi 3 000 €, et aucun
-- écran ne dit lequel des deux a raison ni qu'ils diffèrent.
--
-- Cette vue ne corrige rien et ne décide rien : elle rend l'écart VISIBLE, au même
-- titre que les vues de fraîcheur des autres intégrations. Vide = les deux écritures
-- concordent.
--
-- `status <> 'canceled'` sur le deal : une vente annulée n'a pas à concorder.
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
    else 'montants_divergents'
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
    d.id is null
    or coalesce(d.amount_total, 0) <> coalesce(c.revenue, 0)
  );
