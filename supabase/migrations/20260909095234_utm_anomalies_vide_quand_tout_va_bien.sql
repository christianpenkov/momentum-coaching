-- utm_anomalies rejoint la convention : VIDE quand tout va bien
--
-- Elle renvoyait TOUS les rendez-vous Calendly, avec une colonne `anomalie` a NULL
-- quand la ligne etait saine. D'ou le « piege du comptage » documente dans
-- docs/utm-nomenclature.md : `select count(*) from utm_anomalies` comptait l'historique,
-- pas les anomalies.
--
-- Ce piege n'etait pas seulement une gene de lecture, il rendait la vue INSURVEILLABLE.
-- `/api/sante/alerte-vues` ne connait que deux formes de detection :
--   * `alerte`      — une colonne `etat` commencant par ALERTE ou SILENCIEUX ;
--   * `toute_ligne` — la vue est VIDE quand tout va bien.
-- utm_anomalies n'entrait dans aucune des deux : `toute_ligne` aurait signale les 47
-- lignes saines, `alerte` aurait cherche une colonne `etat` inexistante et serait resté
-- muet pour toujours.
--
-- Resultat : la vue existait depuis le 2026-08-19 et **personne ne la lisait**. Les 18
-- autres vues de sante sont surveillees, pas elle. Or ce fichier-la enonce lui-meme la
-- regle : « une surveillance qu'il faut penser a consulter n'est pas une surveillance ».
--
-- Elle ne renvoie donc plus que les lignes fautives, comme ses 17 soeurs, et elle est
-- inscrite dans SURVEILLANCES en mode `toute_ligne`. Le piege du comptage disparait par
-- construction : il n'y a plus de ligne saine a compter.
--
-- Verifie : 0 ligne apres bascule (aucune anomalie reelle en base), et aucun objet ne
-- dependait de la vue — le changement de perimetre ne casse aucune lecture existante.

create or replace view public.utm_anomalies as
with calcul as (
  select
    id, coach_id, scheduled_at, invitee_name, revenue,
    source, utm_medium, utm_campaign, utm_content, utm_term,
    case
      when source like '%.%'
        then 'source contient un domaine au lieu de la plateforme'

      when utm_content is not null
       and utm_content !~ '^[0-9]{15,20}$'
       and utm_content !~ '^[A-Za-z0-9_-]{11}$'
       and utm_content !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then 'utm_content ne contient pas un identifiant de contenu'

      when utm_medium = 'bio' and utm_content is not null
        then 'utm_content pose sur un lien de bio, qui ne vient d aucun contenu'

      when split_part(coalesce(source, ''), '_', 1) = 'ig'
       and utm_content ~ '^[A-Za-z0-9_-]{11}$'
       and utm_content !~ '^[0-9]{15,20}$'
        then 'utm_content a la forme d un identifiant YouTube sur une source Instagram'

      when split_part(coalesce(source, ''), '_', 1) = 'yt'
       and utm_content ~ '^[0-9]{15,20}$'
        then 'utm_content a la forme d un identifiant Instagram sur une source YouTube'

      when utm_medium is not null
       and utm_medium <> all (array['bio','description','dm','story'])
        then 'utm_medium hors nomenclature : ' || utm_medium

      when source is not null
       and split_part(source, '_', 1) <> all (array['ig','yt'])
        then 'plateforme inconnue dans source : ' || split_part(source, '_', 1)

      when source is not null and utm_medium is not null
       and split_part(source, '_', 2) <> utm_medium
        then 'source et utm_medium se contredisent'

      else null
    end as anomalie
  from calls
  where call_type = 'calendly'
)
select id, coach_id, scheduled_at, invitee_name, revenue,
       source, utm_medium, utm_campaign, utm_content, utm_term, anomalie
from calcul
where anomalie is not null;

alter view public.utm_anomalies set (security_invoker = true);
revoke select on public.utm_anomalies from anon, authenticated;

comment on view public.utm_anomalies is
  'Anomalies d attribution sur les rendez-vous Calendly. VIDE quand tout va bien, comme les 17 autres vues de sante — elle ne renvoie plus les lignes saines, donc le piege du comptage n existe plus. Surveillee par /api/sante/alerte-vues en mode toute_ligne. La forme d un utm_content est croisee avec la PLATEFORME de source : une chaine de 11 caracteres est indiscernable d un identifiant YouTube par sa seule forme, seul le contexte tranche.';
