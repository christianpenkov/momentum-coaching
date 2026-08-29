-- Les 23 lectures de `calls` du dépôt filtrent en `.neq('ignored', true)`, ce que
-- PostgREST traduit par `ignored <> true`. En logique SQL à trois valeurs, cette
-- comparaison vaut NULL — donc FAUX — dès que `ignored` est NULL : la ligne
-- disparaît de TOUS les écrans sans qu'aucune erreur ne soit levée. Même chose
-- pour `.eq('call_type', 'calendly')` et `.neq('call_type', 'calendly')`, qui
-- excluent l'un comme l'autre une ligne dont le type est NULL — un appel visible
-- nulle part.
--
-- Les trois colonnes ont déjà un défaut et zéro ligne à NULL au 2026-08-29 (70
-- lignes). La contrainte ne change donc rien aux données : elle empêche la classe
-- d'échec silencieux à la racine, une fois, plutôt qu'à chacun des 23 endroits qui
-- lisent la table. Une écriture qui poserait NULL échouera désormais bruyamment,
-- ce qui est le comportement voulu.
alter table public.calls
  alter column ignored   set not null,
  alter column call_type set not null,
  alter column status    set not null;
