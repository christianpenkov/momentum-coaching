-- Versionner ig_entry_id_mapping, et purger les verrous de traitement.
--
-- 1. `ig_entry_id_mapping` existait EN PROD SEULEMENT (créée à la main lors du
--    fix entry.id ≠ ig_account_id) : un environnement reconstruit depuis les
--    migrations ne l'aurait pas eue — chaque webhook serait retombé sur le scan
--    parallèle de tous les tokens, et l'upsert de cache aurait échoué en
--    silence. `create if not exists` : sans effet en prod, structurant partout
--    ailleurs. La colonne accueille aussi la sentinelle 'introuvable' du cache
--    négatif (lib/instagram-webhook-processor.ts, audit du 2026-09-02).
--
-- 2. `ig_comment_processing_lock` n'était JAMAIS purgée globalement : seul un
--    delete ciblé par clé précède chaque insert. Une ligne par (profil,
--    utilisateur, média) restait indéfiniment — dizaines de milliers de lignes
--    par an à 40 élèves avec posts viraux. Un verrou n'a de valeur que 2 min
--    (le cutoff du code) : 7 jours de rétention sont déjà très larges.

create table if not exists public.ig_entry_id_mapping (
  entry_id text primary key,
  ig_account_id text not null,
  created_at timestamptz not null default now()
);
alter table public.ig_entry_id_mapping enable row level security;

select cron.schedule(
  'purge-verrous-ig-daily',
  '53 3 * * *',
  $$delete from public.ig_comment_processing_lock where locked_at < now() - interval '7 days'$$
);
