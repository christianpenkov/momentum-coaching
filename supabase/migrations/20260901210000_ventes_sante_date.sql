-- Surveille que `deals.signed_at` porte bien la TENUE d'un rendez-vous, et non
-- l'instant de saisie du rapport.
--
-- ⚠️ Cette vue ne REIMPLEMENTE PAS la regle. La regle vit dans `dateDeVente`
-- (lib/callSeries.ts) : elle choisit le PREMIER rendez-vous de la chaine
-- d'opportunite, ce qui suppose de reconstruire les chaines. La reecrire ici
-- creerait une troisieme version de la meme regle, qui derivera un jour des deux
-- autres sans que rien ne le dise.
--
-- On verifie donc une CONSEQUENCE necessaire, bien plus simple et qui ne peut pas
-- deriver : quel que soit le rendez-vous que la regle choisit, `signed_at` doit
-- coincider avec la tenue de l'UN des rendez-vous de ce prospect. L'instant de
-- saisie d'un rapport, lui, ne tombe jamais pile sur un creneau.
--
-- C'est le defaut corrige le 2026-09-01 : quatre ventes portaient l'heure de saisie
-- (20/08 21h47 pour un rendez-vous du 19/08 13h30). Voir
-- docs/perimetre-stats-referentiel.md regle 7, et le rollback dans
-- docs/sauvegardes/redatage-ventes-2026-09-01.txt.
--
-- Temoin positif joue le 2026-09-01 : en remettant l'ancienne date fausse sur
-- `fc206512`, la vue l'a bien signalee ; restauree ensuite. Une vue qui ne montre
-- rien n'a rien prouve tant qu'on ne lui a pas montre quelque chose.
create or replace view public.ventes_sante_date as
with rdv as (
  select d.id as deal_id, d.profile_id, d.signed_at, d.amount_total, d.buyer_name,
         c.id as call_id, c.scheduled_at, c.prospect_id, c.invitee_email
  from public.deals d
  left join public.calls c on c.id = d.call_id
  where d.status is distinct from 'canceled'
)
select
  r.deal_id,
  r.profile_id,
  r.buyer_name,
  r.amount_total,
  r.signed_at,
  r.scheduled_at as tenue_du_rendez_vous,
  case
    -- Un upsell n'a aucun rendez-vous a crediter : `signed_at` vaut la saisie, et
    -- c'est correct. Meme exception que dans `ventes_sante_contenu`.
    when r.call_id is null then 'ok — vente sans rendez-vous'
    -- Rapportee AVANT le creneau : la regle replie volontairement sur la saisie,
    -- parce qu'une vente ne peut pas avoir ete faite demain. Rien n'a mal tourne.
    when r.signed_at < r.scheduled_at then 'ok — rapportée avant le rendez-vous'
    when exists (
      select 1 from public.calls f
      where f.coach_id = r.profile_id
        and f.ignored is not true
        and f.scheduled_at = r.signed_at
        and (
          (r.prospect_id is not null and f.prospect_id = r.prospect_id)
          or (r.prospect_id is null and r.invitee_email is not null
              and f.invitee_email = r.invitee_email)
        )
    ) then 'ok'
    else 'ALERTE date de vente hors rendez-vous'
  end as etat
from rdv r;

comment on view public.ventes_sante_date is
  'Une ligne ALERTE = une vente datee autrement qu''a la tenue d''un rendez-vous du '
  'prospect, typiquement l''instant de saisie du rapport. Filtrer sur '
  'etat like ''ALERTE%'' : « ok — vente sans rendez-vous » et « ok — rapportée avant '
  'le rendez-vous » sont des cas legitimes, pas des anomalies.';

grant select on public.ventes_sante_date to authenticated, service_role;
