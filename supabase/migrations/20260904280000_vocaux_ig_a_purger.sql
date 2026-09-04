-- Quels messages vocaux ont dépassé leur rétention ?
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ POURQUOI CETTE FONCTION EXISTE                                            │
-- │                                                                           │
-- │ La purge doit lire `storage.objects` pour savoir QUI supprimer, puis       │
-- │ appeler l'API de stockage pour la suppression réelle (une ligne effacée en │
-- │ SQL ne supprime pas les octets). La première version lisait la table par   │
-- │ `supabase.schema('storage')` depuis la route.                              │
-- │                                                                           │
-- │ ⚠️ Ça ne marche pas, et l'échec ne se voyait qu'à l'exécution :            │
-- │ PostgREST n'expose que les schémas déclarés dans sa configuration, et      │
-- │ `storage` n'en fait pas partie. Mesuré en production le 2026-09-04 :       │
-- │     POST /api/instagram/purger-vocaux → 500 {"error":"Invalid schema: storage"} │
-- │                                                                           │
-- │ Le mode de panne était le pire possible : la route répond, journalise son  │
-- │ échec dans `cron_runs`… et le stockage grossit indéfiniment pendant que la │
-- │ purge a l'air d'exister. Elle n'aurait JAMAIS supprimé un seul fichier.    │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- L'alternative était de parcourir le stockage par son API : lister la racine
-- pour trouver les dossiers, puis chaque dossier. À 40 élèves ça fait 41 appels
-- par jour là où celui-ci en fait un — et sur ce projet l'egress se paie au
-- NOMBRE de requêtes, pas au volume.
--
-- ⚠️ La fonction ne supprime RIEN. Elle nomme, la route supprime. C'est ce
--    partage qui garantit qu'on ne peut pas vider l'index en laissant les
--    octets.

create or replace function public.vocaux_ig_a_purger(
  p_jours int default 30,
  p_limite int default 500
)
returns table(chemin text)
language sql
security definer
set search_path to 'public'
as $$
  select o.name
    from storage.objects o
   where o.bucket_id = 'ig-vocaux'
     and o.created_at < now() - make_interval(days => p_jours)
   order by o.created_at
   limit p_limite;
$$;

-- ⚠️ Supabase grante `execute` à `anon` par défaut sur toute fonction nouvelle.
-- Sans ce revoke, n'importe qui pourrait énumérer les noms de fichiers vocaux
-- de tous les élèves — le nom porte le `profile_id`. Le revoke ET la restriction
-- au rôle de service, pas l'un ou l'autre.
revoke execute on function public.vocaux_ig_a_purger(int, int) from public, anon, authenticated;
grant execute on function public.vocaux_ig_a_purger(int, int) to service_role;

comment on function public.vocaux_ig_a_purger(int, int) is
  'Nomme les vocaux Instagram plus vieux que p_jours. Ne supprime rien : seule l''API de stockage supprime reellement les octets, une ligne effacee de storage.objects viderait l''index en les laissant. Existe parce que PostgREST n''expose pas le schema storage — la route ne peut pas lire la table directement.';
