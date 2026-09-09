-- Une vue compagne, agregee, pour que la surveillance puisse enfin la lire
--
-- `utm_anomalies` detecte bien, mais elle expose `invitee_name` et `revenue`. Or
-- /api/sante/alerte-vues serialise jusqu'a 5 lignes dans le corps de l'e-mail, et la
-- regle inscrite au-dessus de SURVEILLANCES est explicite : n'y mettre que ce que
-- l'EXPLOITANT peut reparer, JAMAIS une donnee metier d'un compte client.
--
-- La brancher telle quelle aurait donc envoye des noms de prospects et des montants
-- dans un e-mail d'exploitation. Cette vue-ci porte le meme signal sans aucune donnee
-- personnelle : le TYPE d'anomalie et son nombre. L'exploitant sait quoi chercher, et
-- va lire `utm_anomalies` s'il a besoin du detail.
--
-- Vide quand tout va bien, comme ses soeurs — surveillee en mode `toute_ligne`.
create or replace view public.utm_sante_attribution as
select
  anomalie                    as etat,
  count(*)                    as rendez_vous_concernes,
  min(scheduled_at)           as plus_ancien,
  max(scheduled_at)           as plus_recent
from public.utm_anomalies
group by anomalie;

alter view public.utm_sante_attribution set (security_invoker = true);
revoke select on public.utm_sante_attribution from anon, authenticated;

comment on view public.utm_sante_attribution is
  'Nombre de rendez-vous par TYPE d anomalie d attribution, sans aucune donnee personnelle — c est cette vue que surveille alerte-vues, pas utm_anomalies qui porte invitee_name et revenue. Vide quand tout va bien.';
