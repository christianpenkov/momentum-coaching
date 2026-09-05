-- Le déclencheur préservait la date, mais ne savait pas en poser une.
--
-- `20260905140000_edge_sante_attendre_le_passage.sql` fait dire à
-- `edge_empreintes_attendues.mis_a_jour_le` « quand l'empreinte a changé » plutôt que
-- « quand la ligne a été touchée » — sans quoi `edge_sante_version` ne peut pas
-- distinguer un déploiement pas encore confirmé d'une vraie dérive.
--
-- Il ne traitait que la moitié du problème : quand l'empreinte NE change PAS, il
-- restaure l'ancienne date. Mais quand elle CHANGE, il laisse passer ce que l'appelant
-- a fourni. `/api/sante/alerte-vues` fournit toujours `now()`, donc la production était
-- juste — mais l'invariant dépendait de l'appelant, ce qui n'est pas un invariant.
--
-- ⚠️ Trouvé par le témoin positif, pas par relecture : en rejouant les trois cas, celui
-- de l'empreinte modifiée a échoué. Une écriture qui change l'empreinte sans fournir de
-- date laissait `mis_a_jour_le` sur l'ancienne valeur, donc antérieure au dernier
-- passage — et la vue criait ALERTE sur un déploiement tout frais.
--
-- Le sens de la panne était le bon (crier à tort plutôt que se taire), mais c'est
-- précisément la fausse alerte que cette migration existait pour supprimer.
--
-- Le déclencheur pose donc maintenant la date lui-même. La colonne devient vraie quel
-- que soit l'écrivain : la route, une session, ou une correction à la main.

create or replace function public.edge_empreinte_horodater_si_changee()
returns trigger
language plpgsql
as $function$
begin
  if new.empreinte is not distinct from old.empreinte then
    -- Pas de changement : on garde la date du dernier changement REEL, quelle que soit
    -- celle que l'appelant a fournie. C'est ce qui empeche la reecriture quotidienne de
    -- /api/sante/alerte-vues d'effacer l'information.
    new.mis_a_jour_le := old.mis_a_jour_le;
  else
    -- Changement : la date est MAINTENANT, sans dependre de l'appelant.
    new.mis_a_jour_le := now();
  end if;
  return new;
end;
$function$;

comment on function public.edge_empreinte_horodater_si_changee is
  'Rend `edge_empreintes_attendues.mis_a_jour_le` autonome : la date du dernier '
  'CHANGEMENT d''empreinte, posee et preservee par la base, jamais par l''appelant. '
  'Sans elle, `edge_sante_version` ne peut pas distinguer « deploye, pas encore '
  'retourne » de « vraie derive » — et tout deploiement d''un cron quotidien produisait '
  'une fausse alerte pendant 24 h.';
