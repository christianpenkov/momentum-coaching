-- Écriture atomique d'UNE clé dans integrations.metadata.
--
-- Problème résolu : sync-stripe-payments lisait metadata au début du run puis
-- réécrivait l'objet entier à la fin ({...ancien, stripe_synced_at}). Or
-- sync-calendly écrit AUSSI dans integrations.metadata (user_uri, resource) —
-- si les deux crons se croisent, celui qui écrit en dernier écrase les clés
-- posées entre-temps par l'autre. Les deux tournent toutes les 5 min sur les
-- mêmes lignes : la collision est une question de temps, pas d'hypothèse.
--
-- jsonb_set côté serveur lit et écrit dans la MÊME instruction : la ligne est
-- verrouillée par Postgres pendant l'opération, aucune fenêtre de course.
-- COALESCE gère le cas metadata IS NULL (sinon jsonb_set renvoie NULL).
CREATE OR REPLACE FUNCTION public.set_integration_metadata_key(
  p_profile_id uuid,
  p_provider   text,
  p_key        text,
  p_value      text
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.integrations
     SET metadata = jsonb_set(
           COALESCE(metadata, '{}'::jsonb),
           ARRAY[p_key],
           to_jsonb(p_value),
           true
         )
   WHERE profile_id = p_profile_id
     AND provider   = p_provider;
$$;

COMMENT ON FUNCTION public.set_integration_metadata_key IS
  'Pose une clé dans integrations.metadata sans écraser les autres (évite la course entre sync-stripe-payments et sync-calendly, qui écrivent tous deux dans cette colonne).';
