-- Réarmement des incidents : borné à 24 h pour un déploiement, et ouvert à l'aggravation
--
-- Deux défauts de `20260913180000_incidents_plateforme` trouvés par la relecture
-- adversariale du 2026-09-13 :
--
-- 1. « Survit à un déploiement → réarmé » était trop large. Le projet pousse ~24 fois par
--    jour (168 commits sur 7 jours au 2026-09-13), et chaque push change le commit : tout
--    incident critique récurrent renvoyait un e-mail après CHAQUE push, y compris un
--    commit de documentation. Le quota Resend (100/jour) est partagé avec les e-mails de
--    connexion des élèves. On ne réarme donc sur changement de version que si le dernier
--    e-mail a plus de 24 h : « ton correctif n'a pas marché » arrive toujours, au plus une
--    fois par jour.
--
-- 2. Un incident NORMAL déjà envoyé dans le récapitulatif, qui devenait critique (vu sur
--    une route critique, par exemple), ne renvoyait rien — alors que le récapitulatif
--    promet « un problème qui s'aggrave jusqu'à devenir critique part immédiatement ».
--
-- Le reste de la fonction est strictement identique.

create or replace function public.signaler_incident(
  p_empreinte   text,
  p_source      text,
  p_gravite     text,
  p_titre       text,
  p_detail      jsonb,
  p_occurrences integer default 1,
  p_version     text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_empreinte text := left(coalesce(p_empreinte, 'sans-empreinte'), 64);
  v_titre     text := left(coalesce(p_titre, 'Incident sans titre'), 300);
  v_gravite   text := case when p_gravite = 'critique' then 'critique' else 'normale' end;
  v_detail    jsonb := coalesce(p_detail, '{}'::jsonb);
begin
  if not exists (select 1 from public.incidents where empreinte = v_empreinte)
     and (select count(*) from public.incidents where premiere_le > now() - interval '1 hour') >= 200 then
    v_detail    := jsonb_build_object('empreinte_regroupee', v_empreinte, 'titre_regroupe', v_titre, 'detail', v_detail);
    v_empreinte := 'debordement';
    v_titre     := 'Plus de 200 pannes distinctes en une heure — les nouvelles sont regroupées ici';
    v_gravite   := 'critique';
  end if;

  if length(v_detail::text) > 20000 then
    v_detail := jsonb_build_object('tronque', true, 'apercu', left(v_detail::text, 20000));
  end if;

  insert into public.incidents as i (
    empreinte, source, gravite, titre, occurrences, dernier_detail, echantillons, version_derniere
  ) values (
    v_empreinte, left(coalesce(p_source, 'inconnue'), 80), v_gravite, v_titre,
    greatest(coalesce(p_occurrences, 1), 1), v_detail, jsonb_build_array(v_detail), p_version
  )
  on conflict (empreinte) do update set
    derniere_le      = now(),
    occurrences      = i.occurrences + greatest(coalesce(p_occurrences, 1), 1),
    dernier_detail   = excluded.dernier_detail,
    echantillons     = (
      select coalesce(jsonb_agg(e.valeur order by e.rang), '[]'::jsonb)
      from (
        select valeur, rang
        from jsonb_array_elements(excluded.echantillons || i.echantillons) with ordinality as t(valeur, rang)
        order by rang
        limit 5
      ) e
    ),
    gravite          = case when i.gravite = 'critique' or excluded.gravite = 'critique' then 'critique' else 'normale' end,
    titre            = excluded.titre,
    source           = excluded.source,
    version_derniere = coalesce(excluded.version_derniere, i.version_derniere),
    notifie_le = case
      when i.resolu_le is not null then null
      when i.notifie_le is null then null
      when i.derniere_le < now() - interval '7 days' then null
      -- Aggravation : envoyé comme non urgent, devient critique → part immédiatement.
      when i.gravite = 'normale' and excluded.gravite = 'critique' then null
      -- Survit à un déploiement : au plus un e-mail par 24 h.
      when i.gravite = 'critique'
           and excluded.version_derniere is not null
           and i.version_notifiee is not null
           and excluded.version_derniere <> i.version_notifiee
           and i.notifie_le < now() - interval '24 hours' then null
      else i.notifie_le
    end,
    resolu_le   = null,
    resolu_note = case when i.resolu_le is not null then coalesce(i.resolu_note, '') || ' [revenu le ' || to_char(now(), 'YYYY-MM-DD HH24:MI') || ' UTC]' else i.resolu_note end;
end;
$$;

revoke execute on function public.signaler_incident(text, text, text, text, jsonb, integer, text) from public, anon, authenticated;
grant execute on function public.signaler_incident(text, text, text, text, jsonb, integer, text) to service_role;
