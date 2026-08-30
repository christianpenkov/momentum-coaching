-- La vue ne surveillait la fraîcheur que d'Instagram, YouTube et Short.io. Stripe
-- n'avait AUCUN contrôle : son état valait 'ok' tant que `status` n'était pas
-- 'failed'. Or la panne Stripe n'est déclarée que par un appel qui échoue — si le
-- cron de santé s'arrête (job supprimé, secret changé, route en 500), plus rien
-- n'appelle Stripe, donc plus rien ne déclare de panne, et la vue reste verte.
-- Le silence signifiait « tout va bien » alors qu'il signifiait « je ne regarde plus ».
--
-- `/api/stripe/cron-health` horodate désormais chaque passage dans last_synced_at.
-- Cette vue signale son absence, au même endroit que les autres intégrations.
--
-- Repli sur `connected_at` quand aucun ping n'a encore eu lieu : sinon un compte
-- tout juste connecté serait déclaré dégradé avant le premier passage du cron.
-- Seuil à 2 jours pour un cron quotidien — un passage manqué ne doit pas alerter.
create or replace view integrations_sante as
 SELECT c.profile_id,
    o.provider,
    o.libelle,
    i.id IS NOT NULL AS connectee,
    i.connected_at,
    COALESCE(i.status, 'ok'::text) AS statut,
    i.last_snapshot_error AS erreur,
    h.derniere_donnee,
    h.retard_jours,
    h.etat_collecte,
        CASE
            WHEN i.id IS NULL THEN 'non_connectee'::text
            WHEN COALESCE(i.status, 'ok'::text) = 'failed'::text THEN 'en_echec'::text
            WHEN h.etat_collecte IS NOT NULL AND h.etat_collecte <> 'ok'::text THEN 'collecte_degradee'::text
            ELSE 'ok'::text
        END AS etat
   FROM clients c
     CROSS JOIN integrations_obligatoires() o(provider, libelle)
     LEFT JOIN integrations i ON i.profile_id = c.profile_id AND i.provider = o.provider
     LEFT JOIN LATERAL ( SELECT
                CASE o.provider
                    WHEN 'instagram'::text THEN ( SELECT v.derniere_donnee
                       FROM ig_sante_donnees v
                      WHERE v.profile_id = c.profile_id)
                    WHEN 'youtube'::text THEN ( SELECT v.derniere_donnee_vues
                       FROM yt_sante_donnees v
                      WHERE v.profile_id = c.profile_id)
                    WHEN 'shortio'::text THEN ( SELECT v.derniere_ecriture
                       FROM shortio_sante_donnees v
                      WHERE v.profile_id = c.profile_id)
                    WHEN 'stripe'::text THEN COALESCE(i.last_synced_at, i.connected_at)::date
                    ELSE NULL::date
                END AS derniere_donnee,
                CASE o.provider
                    WHEN 'instagram'::text THEN ( SELECT v.retard_jours
                       FROM ig_sante_donnees v
                      WHERE v.profile_id = c.profile_id)
                    WHEN 'youtube'::text THEN ( SELECT v.retard_jours
                       FROM yt_sante_donnees v
                      WHERE v.profile_id = c.profile_id)
                    WHEN 'shortio'::text THEN ( SELECT v.retard_jours
                       FROM shortio_sante_donnees v
                      WHERE v.profile_id = c.profile_id)
                    WHEN 'stripe'::text THEN (CURRENT_DATE - COALESCE(i.last_synced_at, i.connected_at)::date)
                    ELSE NULL::integer
                END AS retard_jours,
                CASE o.provider
                    WHEN 'instagram'::text THEN ( SELECT v.etat
                       FROM ig_sante_donnees v
                      WHERE v.profile_id = c.profile_id)
                    WHEN 'youtube'::text THEN ( SELECT v.etat
                       FROM yt_sante_donnees v
                      WHERE v.profile_id = c.profile_id)
                    WHEN 'shortio'::text THEN ( SELECT v.etat
                       FROM shortio_sante_donnees v
                      WHERE v.profile_id = c.profile_id)
                    WHEN 'stripe'::text THEN
                        CASE
                            WHEN COALESCE(i.last_synced_at, i.connected_at) IS NULL THEN NULL::text
                            WHEN (CURRENT_DATE - COALESCE(i.last_synced_at, i.connected_at)::date) > 2
                                THEN 'ping de sante absent depuis ' || (CURRENT_DATE - COALESCE(i.last_synced_at, i.connected_at)::date)::text || ' jours'
                            ELSE 'ok'::text
                        END
                    ELSE NULL::text
                END AS etat_collecte) h ON true
  WHERE c.profile_id IS NOT NULL;
