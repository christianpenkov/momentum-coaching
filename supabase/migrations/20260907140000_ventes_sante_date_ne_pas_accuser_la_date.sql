-- `ventes_sante_date` accusait la DATE alors que la date était exacte à la seconde.
--
-- ── Le constat ──────────────────────────────────────────────────────────────
--
-- Cinq deals alertaient le 2026-09-07 sous « ALERTE date de vente hors rendez-vous »,
-- en affichant eux-mêmes le démenti :
--
--   buyer_name        signed_at              tenue_du_rendez_vous
--   TestStory         2026-08-19 15:10:00    2026-08-19 15:10:00
--   TestYT            2026-08-19 15:15:00    2026-08-19 15:15:00
--   TestBIO           2026-08-19 14:40:00    2026-08-19 14:40:00
--   Christos          2026-08-15 21:05:00    2026-08-15 21:05:00
--   Test Description  2026-08-19 13:30:00    2026-08-19 13:30:00
--
-- Identiques. La date tombe PILE sur la tenue du rendez-vous lié — c'est exactement
-- l'invariant que la vue prétend vérifier.
--
-- ── Pourquoi elle criait quand même ─────────────────────────────────────────
--
-- Sa branche « ok » cherche un rendez-vous à `signed_at` parmi les calls DU MÊME
-- PROFIL (`f.coach_id = r.profile_id`). Ce détour est volontaire et doit rester : la
-- règle `dateDeVente` peut retenir un autre rendez-vous de la chaîne d'opportunité
-- que celui porté par `deals.call_id`, et la vue teste la CONSÉQUENCE plutôt que de
-- réimplémenter la règle.
--
-- Mais elle avait oublié le cas le plus simple : `signed_at` tombant sur le rendez-vous
-- LIÉ lui-même, quand ce rendez-vous appartient à un AUTRE profil. Aucun call du bon
-- profil ne correspond, donc aucune branche « ok » ne matche, donc ALERTE.
--
-- ── Ce que ça produisait, et pourquoi c'est grave ───────────────────────────
--
-- Un e-mail quotidien accusant un problème de DATE là où la date est parfaite. Le vrai
-- défaut de ces cinq lignes — le deal est rattaché au rendez-vous d'un autre élève —
-- est déjà signalé, correctement et sous son vrai nom, par `ventes_sante_rattachement`.
--
-- Deux alertes pour un seul défaut, dont une qui envoie chercher au mauvais endroit.
-- C'est le mécanisme qui tue une surveillance : on finit par ne plus l'ouvrir.
--
-- ── La correction ───────────────────────────────────────────────────────────
--
-- Une branche de plus, avant l'alerte : si `signed_at` égale la tenue du rendez-vous
-- lié, la date EST juste, et le sujet n'est pas celui de cette vue.
--
-- ⚠️ Elle ne peut rien masquer, et c'est démontrable : elle ne s'applique QUE lorsque
-- `signed_at = scheduled_at` du call lié, c'est-à-dire précisément la définition de
-- « la date est bonne » que porte cette vue. Un instant de saisie ne tombe jamais pile
-- sur un créneau — c'est le raisonnement d'origine, et il reste valable.
--
-- ⚠️ Et elle ne fait DISPARAÎTRE aucune anomalie : le libellé nomme la vue qui la
-- porte, pour que personne ne lise « ok » comme « tout va bien ».

create or replace view public.ventes_sante_date
with (security_invoker = true) as
with rdv as (
  select d.id as deal_id, d.profile_id, d.signed_at, d.amount_total, d.buyer_name,
         c.id as call_id, c.scheduled_at, c.prospect_id, c.invitee_email
  from deals d
  left join calls c on c.id = d.call_id
  where d.status is distinct from 'canceled'
)
select
  deal_id,
  profile_id,
  buyer_name,
  amount_total,
  signed_at,
  scheduled_at as tenue_du_rendez_vous,
  case
    when call_id is null then 'ok — vente sans rendez-vous'
    when signed_at < scheduled_at then 'ok — rapportée avant le rendez-vous'
    when exists (
      select 1 from calls f
      where f.coach_id = r.profile_id
        and f.ignored is not true
        and f.scheduled_at = r.signed_at
        and (
          (r.prospect_id is not null and f.prospect_id = r.prospect_id)
          or (r.prospect_id is null and r.invitee_email is not null and f.invitee_email = r.invitee_email)
        )
    ) then 'ok'
    -- La date tombe pile sur le rendez-vous LIÉ, mais celui-ci appartient à un autre
    -- profil. La date n'est donc pas en cause ; le rattachement l'est, et c'est
    -- `ventes_sante_rattachement` qui le dit sous son vrai nom.
    when signed_at = scheduled_at
      then 'ok — date exacte ; rattachement signalé par ventes_sante_rattachement'
    else 'ALERTE date de vente hors rendez-vous'
  end as etat
from rdv r;

-- Droits à l'identique : les vues de santé ne sont lisibles ni par `anon` ni par
-- `authenticated` (verrou du 2026-09-02).
revoke select on public.ventes_sante_date from anon, authenticated;
