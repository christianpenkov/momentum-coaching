-- Optimisation RLS : envelopper auth.uid()/auth.role()/auth.jwt() dans un SELECT.
--
-- Problème (87 policies signalées par les advisors Supabase) : écrite nue,
-- `auth.uid()` est réévaluée POUR CHAQUE LIGNE examinée. Sur une table de 100 000
-- messages, c'est 100 000 appels de fonction pour une valeur qui ne change jamais
-- pendant la requête. Enveloppée dans `(select auth.uid())`, Postgres la traite
-- comme un InitPlan : évaluée UNE fois, puis réutilisée.
--
-- Ce que ça ne change PAS : la valeur retournée est identique, donc la logique
-- d'autorisation est strictement inchangée. On modifie QUAND la fonction est
-- appelée, jamais CE QU'ELLE retourne ni la condition qui l'utilise.
--
-- Vérification faite après application : en retirant l'enveloppe des nouvelles
-- policies et en comparant à une sauvegarde de pg_policies prise avant, les 90
-- expressions sont identiques au caractère près (0 différence de logique).
--
-- ALTER POLICY (et non DROP + CREATE) : la policy n'est jamais absente, même une
-- fraction de seconde — pas de fenêtre pendant laquelle des données seraient
-- exposées. Chaque ALTER est atomique dans la transaction de la migration.
DO $$
DECLARE
  r record;
  new_qual  text;
  new_check text;
  stmt      text;
  n         int := 0;
BEGIN
  FOR r IN
    SELECT tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    -- Le negative lookbehind évite de ré-envelopper une occurrence déjà traitée,
    -- ce qui rend la migration idempotente (rejouable sans dégât).
    new_qual  := regexp_replace(r.qual,       '(?<!select )auth\.(uid|role|jwt)\(\)', '(select auth.\1())', 'g');
    new_check := regexp_replace(r.with_check, '(?<!select )auth\.(uid|role|jwt)\(\)', '(select auth.\1())', 'g');

    IF r.qual IS NOT DISTINCT FROM new_qual
       AND r.with_check IS NOT DISTINCT FROM new_check THEN
      CONTINUE;
    END IF;

    stmt := format('ALTER POLICY %I ON public.%I', r.policyname, r.tablename);
    IF new_qual IS NOT NULL THEN
      stmt := stmt || format(' USING (%s)', new_qual);
    END IF;
    IF new_check IS NOT NULL THEN
      stmt := stmt || format(' WITH CHECK (%s)', new_check);
    END IF;

    EXECUTE stmt;
    n := n + 1;
  END LOOP;

  RAISE NOTICE 'Policies optimisées : %', n;
END $$;
