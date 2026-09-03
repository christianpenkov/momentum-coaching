-- Même règle que la migration verrouillage_acces_anon du 2026-09-02 : search_path
-- figé sur toute fonction du schéma public (advisor function_search_path_mutable).
-- figer_detected_at a été créée après cette migration et n'avait pas reçu la règle.
alter function public.figer_detected_at() set search_path = public;
