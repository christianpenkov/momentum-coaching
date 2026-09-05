-- Déployer une Edge Function peu fréquente garantissait une fausse alerte.
--
-- ── Le générateur de fausses alertes ──────────────────────────────────────────────
--
-- `edge_sante_version` compare l'empreinte du DÉPÔT à celle que la fonction remonte
-- **en tournant**. Les deux ne bougent pas au même moment :
--
--   1. on déploie              → le code en ligne change
--   2. Vercel reconstruit      → `edge_empreintes_attendues.empreinte` change
--   3. la fonction re-tourne   → `crons_passages.empreinte` change
--
-- Entre 2 et 3, la vue voit deux empreintes différentes et crie — alors que rien n'est
-- anormal : la fonction n'a simplement pas encore eu l'occasion de parler.
--
-- Pour un cron QUOTIDIEN, cette fenêtre dure jusqu'à 24 heures, et l'e-mail de santé
-- part à 06:00. C'est exactement ce qui s'est produit le 2026-09-05 sur
-- `installment-reminders` (déployée la veille, prochain passage 07:00) : l'alerte est
-- partie une heure avant que la fonction ne puisse se déclarer conforme, et elle était
-- déjà `ok` quand on l'a lue.
--
-- Une alerte qui part à chaque déploiement d'un cron quotidien est une alerte qu'on
-- n'ouvre plus.
--
-- ── Le piège dans lequel il ne fallait PAS tomber ─────────────────────────────────
--
-- La correction évidente serait « ne pas alerter tant que la fonction n'a pas tourné
-- depuis la mise à jour du dépôt », soit `dernier_passage > mis_a_jour_le`.
--
-- ⚠️ Telle quelle, elle ÉTEINT la surveillance. `/api/sante/alerte-vues` réécrit
-- `mis_a_jour_le` à `now()` **à chaque passage quotidien**, que l'empreinte ait changé
-- ou non. La colonne ne dit donc pas « quand l'empreinte a changé » mais « quand la
-- ligne a été touchée » — toujours ~06:00 du jour même. Un cron quotidien de 07:00
-- aurait alors `dernier_passage` (hier 07:00) < `mis_a_jour_le` (aujourd'hui 06:00) en
-- permanence : « en attente » pour toujours, plus jamais d'alerte.
--
-- On corrige donc d'abord le SENS de la colonne, ensuite seulement la vue.
--
-- Le déclencheur ci-dessous est posé sur la table plutôt que dans la route : il fait
-- tenir l'invariant quel que soit l'appelant, y compris un `update` fait à la main.

create or replace function public.edge_empreinte_horodater_si_changee()
returns trigger
language plpgsql
as $function$
begin
  -- Empreinte inchangée : on conserve la date du dernier CHANGEMENT réel.
  -- `is not distinct from` et non `=` : un NULL des deux côtés est un non-changement.
  if new.empreinte is not distinct from old.empreinte then
    new.mis_a_jour_le := old.mis_a_jour_le;
  end if;
  return new;
end;
$function$;

comment on function public.edge_empreinte_horodater_si_changee is
  'Fait dire a `edge_empreintes_attendues.mis_a_jour_le` ce que son nom promet : la date '
  'du dernier CHANGEMENT d''empreinte, pas celle de la derniere ecriture. '
  '/api/sante/alerte-vues reecrit la ligne chaque jour meme sans changement ; sans ce '
  'declencheur, `edge_sante_version` ne pourrait jamais distinguer « deploiement pas '
  'encore confirme » de « vraie derive ».';

drop trigger if exists edge_empreinte_horodater on public.edge_empreintes_attendues;
create trigger edge_empreinte_horodater
  before update on public.edge_empreintes_attendues
  for each row execute function public.edge_empreinte_horodater_si_changee();

-- ── La vue, adoucie SANS être affaiblie ───────────────────────────────────────────
--
-- ⚠️ L'état d'attente ne s'applique QUE si les empreintes diffèrent. Une fonction déjà
-- conforme reste `ok`, quelle que soit la date de son dernier passage : on n'introduit
-- aucune zone d'ombre sur ce qui va bien.
--
-- ⚠️ Et il ne cache rien durablement. Deux garde-fous :
--   • dès que la fonction tourne, elle se déclare, et l'écart devient une vraie ALERTE ;
--   • si elle ne tourne PLUS du tout, c'est `crons_sante` qui le dit (`SILENCIEUX`).
-- Les deux vues se couvrent l'une l'autre — aucune ne peut être muette seule.
--
-- ⚠️ `'en attente du prochain passage'` ne commence ni par ALERTE ni par SILENCIEUX :
-- la route ne le compte donc pas comme une anomalie. C'est délibéré, et c'est aussi la
-- raison pour laquelle on ne peut pas se contenter de `etat <> 'ok'` sur ces vues.
create or replace view public.edge_sante_version as
  select
    a.nom,
    a.empreinte as empreinte_du_depot,
    p.empreinte as empreinte_en_ligne,
    p.dernier_passage,
    a.fichiers,
    case
      when p.nom is null then 'hors crons inscrits'
      when p.empreinte is null then 'non instrumentee'
      when p.empreinte = a.empreinte then 'ok'
      when p.dernier_passage is null or p.dernier_passage <= a.mis_a_jour_le
        then 'en attente du prochain passage'
      else 'ALERTE la fonction en ligne n''est pas celle du depot'
    end as etat
  from edge_empreintes_attendues a
  left join crons_passages p on p.nom = a.nom
  order by
    (case when p.empreinte is not null and p.empreinte <> a.empreinte
            and p.dernier_passage is not null and p.dernier_passage > a.mis_a_jour_le
          then 0 else 1 end),
    a.nom;

comment on view public.edge_sante_version is
  'Compare le code EN LIGNE de chaque Edge Function a celui du depot. '
  '« en attente du prochain passage » n''est PAS une anomalie : la fonction a ete '
  'redeployee et n''a pas encore retourne, elle ne peut donc pas encore se declarer. '
  'Sans cet etat, tout deploiement d''un cron quotidien produisait une fausse alerte '
  'pendant 24 h (constate le 2026-09-05 sur installment-reminders). Si la fonction ne '
  'tourne plus du tout, c''est `crons_sante` qui le signale.';

revoke select on public.edge_sante_version from anon, authenticated;
alter view public.edge_sante_version set (security_invoker = true);
grant select on public.edge_sante_version to service_role;
