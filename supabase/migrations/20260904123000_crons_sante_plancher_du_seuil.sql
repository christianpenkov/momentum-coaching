-- Le seuil de sur-fréquence avait un trou pour les crons RARES.
--
-- `20260904120000_crons_sante_cadence_trop_rapide.sql` calcule le seuil comme quatre
-- fois le nombre de passages attendus dans une journée. Pour un cron qui tourne plus
-- souvent que quotidiennement, c'est large et sûr. Pour un cron plus rare, le calcul
-- s'effondre :
--
--   cron-refresh-tokens : hebdomadaire → 0,14 passage/jour → seuil = 1 (arrondi)
--   installment-reminders : quotidien  → 1 passage/jour    → seuil = 4
--
-- Le premier alerterait donc dès le DEUXIÈME passage dans une même journée. Or un
-- planificateur externe rejoue un job de temps en temps — une reprise après échec, un
-- déclenchement à la main pendant une vérification — et ce projet a déjà payé ce
-- défaut-là dans l'autre sens : `silence_max` posé au jugé à 2 jours sur ce même cron
-- hebdomadaire produisait une fausse alerte garantie chaque jeudi soir, c'est-à-dire le
-- début d'une alerte qu'on n'ouvre plus.
--
-- On pose donc un PLANCHER de 4 passages : en dessous, on ne conclut rien. Un cron rare
-- déclenché quatre fois de trop dans la même journée reste indétectable, et c'est
-- assumé — le cas que cette vue doit attraper est un facteur 30, pas un facteur 2.
--
-- ⚠️ Le plancher ne relâche rien pour les crons fréquents, dont le seuil calculé est
-- déjà très au-dessus de 4 (192 pour un cron de 30 min, 5 760 pour un cron à la minute).
-- `greatest` ne peut que remonter un seuil trop bas, jamais abaisser un seuil correct.

create or replace view public.crons_sante as
  select
    nom,
    dernier_passage,
    silence_max,
    round(extract(epoch from now() - dernier_passage) / 3600::numeric, 1) as il_y_a_heures,
    contexte,
    case
      -- Le silence passe en premier : un cron mort est plus grave qu'un cron bavard.
      when (now() - dernier_passage) > silence_max then 'SILENCIEUX'
      when cadence_attendue is not null
       and jour_compte = (now() at time zone 'utc')::date
       and passages_du_jour > greatest(4, 4 * (86400.0 / extract(epoch from cadence_attendue)))
        then 'ALERTE cadence trop rapide'
      else 'ok'
    end as etat,
    passages_du_jour,
    cadence_attendue
  from crons_passages
  order by
    (now() - dernier_passage) > silence_max desc,
    dernier_passage;

comment on view public.crons_sante is
  'Sante des crons inscrits, dans les DEUX sens : "SILENCIEUX" quand un cron ne laisse '
  'plus de trace, "ALERTE cadence trop rapide" quand il en laisse quatre fois trop — '
  'avec un plancher de 4 passages, sans quoi un cron hebdomadaire alerterait des sa '
  'deuxieme execution du jour. Le second etat a existe en vrai (sync-calendly et '
  'notify-rapport a la minute au lieu de 30 min, decouvert le 2026-09-04 en cherchant '
  'une surconsommation d''egress) et ne declenchait aucun controle : un cron trop '
  'rapide a l''air plus sain que la normale.';

revoke select on public.crons_sante from anon, authenticated;
alter view public.crons_sante set (security_invoker = true);
grant select on public.crons_sante to service_role;
