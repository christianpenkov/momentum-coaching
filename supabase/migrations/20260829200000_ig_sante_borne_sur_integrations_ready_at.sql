-- La vue comptait les trous depuis le PREMIER JOUR COLLECTÉ, pas depuis le début
-- des stats de l'élève. Sur le profil de test : 25 trous annoncés, dont 14
-- antérieurs au 09/06 — la date à laquelle ses stats commencent. Ces 14 journées
-- ne peuvent affecter aucun chiffre affiché nulle part, et le bandeau de santé
-- alarmait pourtant dessus. Un bandeau qui crie au loup sur des données hors
-- périmètre est pire que pas de bandeau : on apprend à l'ignorer.
--
-- Même correction que celle appliquée à shortio_sante_donnees le 2026-08-29
-- (migration 20260829160000_sante_shortio_borne_sur_la_connexion) — la règle
-- existait, elle n'avait été posée que d'un côté.
--
-- GREATEST des deux bornes : on ne compte jamais avant le premier jour réellement
-- collecté non plus, sinon un élève dont les stats démarrent avant sa première
-- collecte verrait apparaître des trous qui n'ont jamais pu exister.
create or replace view ig_sante_donnees as
with debut as (
  select s.profile_id,
         greatest(
           min(s.date),
           coalesce((select c.integrations_ready_at::date
                       from clients c where c.profile_id = s.profile_id),
                    min(s.date))
         ) as d0
    from analytics_daily_snapshots s
   where s.ig_reach is not null
   group by s.profile_id
)
select s.profile_id,
  count(*) filter (where s.ig_reach is null and s.date > b.d0 and s.date <= (current_date - 1)) as trous_reach,
  count(*) filter (where s.ig_followers is null and s.date > b.d0) as trous_abonnes,
  count(*) filter (where s.ig_reach > 0 and s.ig_reach_follower is null and s.date > b.d0 and s.date <= (current_date - 1)) as jours_sans_ventilation,
  max(s.date) filter (where s.ig_reach is not null) as derniere_donnee,
  (current_date - max(s.date) filter (where s.ig_reach is not null)) as retard_jours,
  case
    when i.profile_id is null then 'integration deconnectee'::text
    when (i.access_token is null and i.api_key is null) then 'ALERTE : integration sans identifiant'::text
    when (current_date - max(s.date) filter (where s.ig_reach is not null)) > 2 then 'ALERTE : collecte arretee'::text
    when count(*) filter (where s.ig_reach is null and s.date > b.d0 and s.date <= (current_date - 1)) > 0 then 'trous a rattraper'::text
    else 'ok'::text
  end as etat
from analytics_daily_snapshots s
join debut b on b.profile_id = s.profile_id
left join integrations i on i.profile_id = s.profile_id and i.provider = 'instagram'
group by s.profile_id, i.profile_id, i.access_token, i.api_key;
