-- Correction de 20260830023000, qui produisait une phrase FAUSSE a l'ecran :
-- « Stripe ne repond plus depuis le 18 aout — les chiffres affiches s'arretent la ».
--
-- Deux erreurs, la meme racine. Un BATTEMENT DE COEUR (le cron tourne-t-il ?) etait
-- passe par le canal de la FRAICHEUR DES DONNEES (derniere_donnee, retard_jours), que
-- le bandeau formule comme « ne repond plus depuis le … ». Deux sens differents dans
-- le meme tuyau : le bandeau a dit d'une surveillance absente ce qu'il aurait dit
-- d'une integration morte.
--
-- Et le repli sur connected_at datait retroactivement une absence de ping qui n'avait
-- jamais eu lieu — le champ n'existait que depuis quelques minutes. Un ping jamais
-- enregistre n'est pas « en retard de 12 jours », il est INCONNU.
--
-- Donc : plus de repli, et un code d'etat (ping_absent) que le bandeau traduit par
-- « la surveillance ne tourne plus », jamais par « Stripe est en panne ».

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
                    WHEN 'stripe'::text THEN i.last_synced_at::date
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
                    WHEN 'stripe'::text THEN (CURRENT_DATE - i.last_synced_at::date)
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
                    -- Code stable, pas une phrase : c'est le bandeau qui redige, et
                    -- lui seul sait distinguer « Stripe est en panne » de « on ne
                    -- surveille plus Stripe ».
                    WHEN 'stripe'::text THEN
                        CASE
                            WHEN i.last_synced_at IS NULL THEN NULL::text
                            WHEN (CURRENT_DATE - i.last_synced_at::date) > 2 THEN 'ping_absent'::text
                            ELSE 'ok'::text
                        END
                    ELSE NULL::text
                END AS etat_collecte) h ON true
  WHERE c.profile_id IS NOT NULL;
