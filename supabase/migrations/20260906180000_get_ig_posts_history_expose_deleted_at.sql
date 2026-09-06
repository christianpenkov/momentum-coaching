-- Exposer `deleted_at` dans `get_ig_posts_history`.
--
-- ⚠️ La RPC continue de NE PAS FILTRER les posts supprimés, et c'est délibéré.
--
-- Un audit du 2026-09-06 avait relevé que `stats_clients_series` filtre `deleted_at`
-- alors que celle-ci ne le fait pas, et proposait d'ajouter le filtre ici pour aligner
-- les deux écrans. Chris a tranché dans l'autre sens le même jour, et le code lui donne
-- raison : le commentaire qui POSE `deleted_at`, dans `supabase/functions/_shared/
-- ig-posts.ts`, dit depuis toujours
--
--     « on le marque deleted_at plutôt que de l'effacer : l'historique de stats
--       (analytics, rapports passés) doit rester intact, seul "Gérer mes liens" doit
--       filtrer ces posts »
--
-- C'est donc `stats_clients_series` qui s'est écartée de la règle écrite, pas celle-ci.
-- L'alignement se fera en retirant le filtre là-bas.
--
-- ── Les trois décisions produit qui en découlent ────────────────────────────
--
-- 1. Un post supprimé COMPTE TOUJOURS dans le KPI « Publications ». Ce compteur mesure
--    une activité passée, pas un inventaire présent : sinon un élève fait baisser ses
--    statistiques de juin en faisant du ménage en septembre, et un rapport imprimé la
--    veille cesse de correspondre à l'écran du lendemain.
-- 2. Il RESTE dans « Top contenus », avec une pastille « supprimé » et son lien
--    désactivé — il a réellement produit de la portée, et parfois des rendez-vous.
-- 3. Le revenu qui lui est attribué ne disparaît donc jamais d'un total.
--
-- C'est le point 2 qui exige cette migration : la colonne est en base, mais la RPC ne
-- la renvoyait pas, donc l'écran ne pouvait pas distinguer un post supprimé d'un autre.
--
-- ── Sur la fiabilité de ce drapeau ──────────────────────────────────────────
--
-- ⚠️ `deleted_at` ne veut pas dire « supprimé », il veut dire « absent de la réponse
-- Meta » sur une fenêtre de 90 jours. Un faux positif est déjà arrivé (bascule de compte
-- A→B→A, corrigé le 2026-07-29).
--
-- Aucune garde n'est nécessaire pour autant, et c'est une propriété du mécanisme, pas un
-- pari : le cron réécrit `deleted_at: null` à CHAQUE passage où Meta renvoie le post.
-- Le drapeau est donc auto-réparant, et depuis les décisions ci-dessus il ne pilote plus
-- aucun chiffre — seulement une pastille et l'activation d'un lien. Un faux positif est
-- cosmétique et se corrige seul au passage suivant.

-- ⚠️ `create or replace` NE SUFFIT PAS ici : ajouter une colonne à un `returns table`
-- change le type de retour, et Postgres refuse (« cannot change return type of existing
-- function »). Il faut donc supprimer puis recréer — ce qui fait perdre les droits, que
-- l'on repose explicitement à la fin. Sans ce `revoke`, la recréation rendrait la
-- fonction exécutable par PUBLIC (le défaut de Postgres), donc par `anon`.
drop function if exists public.get_ig_posts_history(uuid, date, date);

create function public.get_ig_posts_history(
  p_profile_id uuid, p_start_date date, p_end_date date
)
returns table(
  post_id text, post_type text, caption text, permalink text, thumbnail text,
  published_at timestamptz, snapshot_date date, reach integer, views integer,
  likes integer, comments integer, saves integer, shares integer, follows integer,
  profile_visits integer, total_interactions integer, avg_watch_time_ms bigint,
  total_watch_time_ms bigint, skip_rate numeric, duree_sec numeric,
  deleted_at timestamptz
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if current_setting('request.jwt.claims', true) is not null
     and (auth.uid() is null or (
       auth.uid() <> p_profile_id
       and not exists (
         select 1 from clients c
         where c.profile_id = p_profile_id and c.coach_id = auth.uid()
       )
     ))
  then
    raise exception 'Accès refusé';
  end if;

  return query
  select distinct on (p.post_id)
    p.post_id, p.post_type, p.caption, p.permalink, p.thumbnail,
    p.published_at, p.snapshot_date, p.reach, p.views,
    p.likes, p.comments, p.saves, p.shares, p.follows,
    p.profile_visits, p.total_interactions, p.avg_watch_time_ms,
    p.total_watch_time_ms, p.skip_rate, d.duree_sec,
    p.deleted_at
  from analytics_ig_posts_history p
  left join ig_post_durees d on d.post_id = p.post_id
  where p.profile_id = p_profile_id
    and p.archived_at is null
    and p.snapshot_date between p_start_date and p_end_date
  order by p.post_id, p.snapshot_date desc;
end;
$function$;

-- Droits à l'identique de l'état d'avant : {postgres, authenticated, service_role}, et
-- surtout PAS `anon`.
--
-- ⚠️ Les DEUX `revoke` sont nécessaires, et le second n'est pas une redondance du
-- premier. Vérifié à l'exécution le 2026-09-06 : après le `create`, l'ACL était
-- `{postgres, anon, authenticated, service_role}` alors que l'état d'avant n'avait pas
-- `anon`. Supabase pose un `alter default privileges ... to anon` sur les fonctions ;
-- `anon` est un RÔLE, pas `PUBLIC`, donc `revoke ... from public` ne l'atteint pas.
-- Autrement dit : toute recréation de fonction dans ce projet ROUVRE `anon` en silence,
-- et le `verrouillage_acces_anon` du 2026-09-02 est défait fonction par fonction sans
-- que rien ne le signale.
revoke all on function public.get_ig_posts_history(uuid, date, date) from public;
revoke all on function public.get_ig_posts_history(uuid, date, date) from anon;
grant execute on function public.get_ig_posts_history(uuid, date, date) to authenticated;
grant execute on function public.get_ig_posts_history(uuid, date, date) to service_role;
