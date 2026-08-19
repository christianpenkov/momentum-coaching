-- Cohérence source / utm_medium — voir docs/utm-nomenclature.md
--
-- calls.source vaut "<plateforme>_<canal>" et utm_medium vaut le canal seul : les deux
-- doivent donc toujours dire la même chose. Neuf rendez-vous disaient à la fois
-- "ig_description" (vient d'un lien en description) et "dm" (envoyé en message privé).
--
-- Cause : sur une reprogrammation, le webhook Calendly faisait hériter source de
-- l'ancien rendez-vous mais reprenait utm_medium du nouveau clic. Les deux champs
-- décrivaient alors deux moments différents — d'où venait le prospect, et par où il
-- avait replanifié.
--
-- Règle retenue : le premier contact fait foi. C'est le contenu d'origine qui a créé
-- l'opportunité, le canal de replanification n'a rien généré. Le webhook fait désormais
-- hériter les quatre champs d'attribution de la même façon (source, utm_campaign,
-- utm_medium, utm_term).
--
-- Cette migration aligne les lignes existantes sur cette règle. Aucun rendez-vous
-- porteur de chiffre d'affaires n'était concerné.

update calls
   set utm_medium = split_part(source, '_', 2)
 where call_type = 'calendly'
   and source is not null
   and utm_medium is not null
   and split_part(source, '_', 2) <> utm_medium
   and split_part(source, '_', 1) in ('ig','yt');

-- Vue de contrôle : signale les écarts de nomenclature sans jamais rien bloquer.
-- Une contrainte stricte rejetterait un canal légitime encore non formalisé
-- (LinkedIn, newsletter, publicité) ; la vue rend le désordre visible sans figer
-- l'évolution. À consulter ainsi :
--   select anomalie, count(*) from utm_anomalies where anomalie is not null group by 1;
create or replace view utm_anomalies as
select
  c.id, c.coach_id, c.scheduled_at, c.invitee_name, c.revenue,
  c.source, c.utm_medium, c.utm_campaign, c.utm_content, c.utm_term,
  case
    when c.source like '%.%'
      then 'source contient un domaine au lieu de la plateforme'
    when c.utm_content is not null
     and c.utm_content !~ '^[0-9]{15,20}$'
     and c.utm_content !~ '^[A-Za-z0-9_-]{11}$'
      then 'utm_content ne contient pas un identifiant de contenu'
    when c.utm_medium is not null
     and c.utm_medium not in ('bio','description','dm','story')
      then 'utm_medium hors nomenclature : ' || c.utm_medium
    when c.source is not null
     and split_part(c.source, '_', 1) not in ('ig','yt')
      then 'plateforme inconnue dans source : ' || split_part(c.source, '_', 1)
    when c.source is not null and c.utm_medium is not null
     and split_part(c.source, '_', 2) <> c.utm_medium
      then 'source et utm_medium se contredisent'
    else null
  end as anomalie
from calls c
where c.call_type = 'calendly';
