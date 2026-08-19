-- Les tables de sauvegarde sont dans le schéma `public`, donc exposées par
-- PostgREST. Sans RLS activé, leur contenu serait lisible via l'API REST —
-- _backup_calls_* contient des données commerciales (emails d'invités, montants).
--
-- Détecté par les advisors sécurité Supabase après création de ces sauvegardes.
--
-- RLS activé SANS aucune policy = personne n'y accède via l'API. Le service_role
-- (crons, migrations) contourne RLS par conception, donc les sauvegardes restent
-- exploitables pour une restauration.
--
-- Ces tables sont temporaires : à supprimer une fois les chantiers validés.
ALTER TABLE IF EXISTS public._backup_calls_20260819        ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public._backup_calls_utm_20260819    ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public._backup_rls_policies_20260819 ENABLE ROW LEVEL SECURITY;
