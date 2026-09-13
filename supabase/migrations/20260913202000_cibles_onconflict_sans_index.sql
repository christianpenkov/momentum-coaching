-- Contrôle : chaque `onConflict` du code vise-t-il un index unique COMPLET ?
--
-- Le 2026-09-13, les rendez-vous Calendly ne s'écrivaient plus depuis six jours : un
-- index unique partiel avait remplacé l'index complet que visait
-- `onConflict: 'coach_id,calendly_event_uuid'`, et Postgres refusait (42P10) sans que
-- personne ne lise l'erreur (`20260913200000_calls_index_calendly_complet.sql`).
--
-- Ni `tsc`, ni `next build`, ni aucun test ne pouvait le voir : la divergence est entre le
-- CODE (la chaîne `onConflict`) et le SCHÉMA (les index), et seul un contrôle qui lit les
-- deux la voit. `scripts/verifier-onconflict.mjs` extrait les couples (table, colonnes) du
-- code et les passe à cette fonction, dans `npm test`.
--
-- Rend les couples SANS index unique complet correspondant (vide = tout va bien).

create or replace function public.cibles_onconflict_sans_index(p_paires jsonb)
returns table (tbl text, cols text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.tbl, p.cols
  from jsonb_to_recordset(p_paires) as p(tbl text, cols text)
  where not exists (
    select 1
    from pg_index i
    join pg_class c on c.oid = i.indrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = p.tbl
      and i.indisunique
      and i.indpred is null
      and (select array_agg(a.attname::text order by a.attname)
           from unnest(i.indkey) k join pg_attribute a on a.attrelid = c.oid and a.attnum = k)
        = (select array_agg(trim(x) order by trim(x)) from unnest(string_to_array(p.cols, ',')) x)
  );
$$;

revoke execute on function public.cibles_onconflict_sans_index(jsonb) from public, anon, authenticated;
grant execute on function public.cibles_onconflict_sans_index(jsonb) to service_role;
