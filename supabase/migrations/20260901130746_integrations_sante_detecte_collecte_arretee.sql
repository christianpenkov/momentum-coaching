-- ⚠️ FICHIER RECONSTITUÉ le 2026-09-03. Lire ceci avant de s'y fier.
--
-- Cette migration a été APPLIQUÉE à la base le 2026-09-01 sans qu'aucun fichier ne soit
-- écrit dans le dépôt. Elle n'existait donc que dans la base de production : une
-- reconstruction ne l'aurait jamais rejouée, et personne n'aurait pu dire ce qu'elle
-- avait changé.
--
-- Elle a été retrouvée en réconciliant `supabase_migrations.schema_migrations` (ce que la
-- base a enregistré) avec les fichiers du dépôt. Sept migrations des 1ᵉʳ au 3 septembre
-- étaient dans ce cas.
--
-- ⚠️ CE QUI EST RECONSTITUÉ, ET CE QUI NE L'EST PAS.
--
-- Le contenu ci-dessous est la définition RÉELLE de la vue, lue en base
-- (`pg_get_viewdef`) le 2026-09-03. C'est donc l'état d'arrivée, pas nécessairement ce
-- que cette migration-ci écrivait : une seconde migration orpheline
-- (`20260901131311_integrations_sante_seuil_par_plateforme`, 5 minutes plus tard) a
-- modifié la même vue. **L'état intermédiaire entre les deux est irrécupérable** — rien
-- ne le conserve nulle part.
--
-- Ce fichier porte donc l'état d'arrivée des DEUX, et le second est un fichier de
-- documentation sans instruction. Rejouer la chaîne produit le bon état final ; ce qui
-- est perdu, c'est l'histoire intermédiaire. On ne l'invente pas.
--
-- ── Ce que la vue fait, d'après son contenu ────────────────────────────────────────
--
-- Une ligne par élève et par intégration obligatoire. Au-delà de « connectée ou non »,
-- elle regarde si la DONNÉE arrive encore : `collecte_arretee` quand Instagram ou
-- Short.io ont plus de 2 jours de retard, `collecte_degradee` quand la vue de santé de
-- la plateforme concernée signale autre chose que `ok`.
--
-- ⚠️ `non_connectee` et `integration deconnectee` ne sont PAS des anomalies : chercher
-- `etat <> 'ok'` sur cette vue remonte 23 faux positifs. Toujours filtrer sur les états
-- de panne nommés.
--
-- ⚠️ Le seuil de 2 jours ne s'applique qu'à `instagram` et `shortio`, jamais à YouTube :
-- l'API YouTube Analytics accuse un retard normal de plusieurs jours, et lui appliquer le
-- même seuil ferait crier l'alerte en permanence.
--
-- ⚠️ Aucun `grant` ici, volontairement : la migration `20260902200000_verrouillage_acces_anon`
-- ferme cette vue à `anon` et `authenticated`, et `20260903170000_verrou_structurel_lecture_public`
-- lui pose `security_invoker = true`. Rejouer un `grant` ici les défairait à l'ordre de
-- rejeu — un `grant` ajoute, il n'enlève rien.
--
-- ⚠️⚠️ CE QU'UN REMPLACEMENT DE VUE FAIT AUX PROTECTIONS — mesuré le 2026-09-03 en
-- rejouant ce fichier dans une transaction annulée. Les deux formes ne se comportent
-- PAS pareil, et aucune ne prévient :
--
--   | forme                        | droits (`revoke`) | `security_invoker` |
--   |------------------------------|-------------------|--------------------|
--   | `create or replace view`     | **conservés**     | **EFFACÉ**         |
--   | `drop view` + `create view`  | **RÉINITIALISÉS** | absent             |
--
-- La seconde ligne est le trou de lecture ouvert le matin du 2026-09-03 : les privilèges
-- par défaut du schéma `public` rendent toute vue nouvellement créée lisible par `anon`.
-- La première est plus discrète — la vue reste fermée, mais elle cesse d'appliquer la RLS
-- de ses tables sources, donc la défense en profondeur disparaît sans que rien ne change
-- à l'écran.
--
-- **Après tout remplacement d'une vue de santé, rejouer les deux lignes :**
--   revoke select on public.<vue> from anon, authenticated;
--   alter view public.<vue> set (security_invoker = true);
--
-- `acces_sante_lecture` attrape la combinaison dangereuse (lisible du navigateur ET RLS
-- contournée), donc le cas `drop`+`create`. Elle ne peut pas attraper le cas
-- `create or replace` seul, qui ne crée aucune fuite tant que les droits restent fermés.

create or replace view public.integrations_sante as
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
            WHEN i.last_snapshot_error IS NOT NULL THEN 'erreur_api'::text
            WHEN (o.provider = ANY (ARRAY['instagram'::text, 'shortio'::text])) AND h.retard_jours IS NOT NULL AND h.retard_jours >= 2 THEN 'collecte_arretee'::text
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
                    WHEN 'stripe'::text THEN CURRENT_DATE - i.last_synced_at::date
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
                        WHEN i.last_synced_at IS NULL THEN NULL::text
                        WHEN (CURRENT_DATE - i.last_synced_at::date) > 2 THEN 'ping_absent'::text
                        ELSE 'ok'::text
                    END
                    ELSE NULL::text
                END AS etat_collecte) h ON true
  WHERE c.profile_id IS NOT NULL;
