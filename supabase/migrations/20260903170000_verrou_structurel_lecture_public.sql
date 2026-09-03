-- Une relation lisible du navigateur doit appliquer la RLS. Sans exception, sans liste.
--
-- ⚠️ CE QUI S'EST PASSE LE 2026-09-03, et pourquoi ce n'etait pas une etourderie.
--
-- La migration 20260902200000 a ferme `anon` et `authenticated` sur les 15 vues de
-- sante. Deux migrations du LENDEMAIN les ont rouvertes :
--
--   * `ventes_sante_sur_encaissement` (20260903150000) — `drop view` + `create view`.
--     Lisible SANS AUCUNE SESSION. La cle `anon` est publique par construction : elle
--     est dans le bundle JS de chaque eleve.
--   * `ventes_sante_contenu` (20260903140000) — un `grant select … to authenticated`
--     recopie de la migration d'origine. Lisible par n'importe quel compte connecte.
--
-- Et `security_invoker` valant `false` par defaut, une vue s'execute avec les droits de
-- son PROPRIETAIRE : la RLS des tables sources est contournee. Ces deux vues exposaient
-- donc les ventes, les montants et les identifiants Stripe de TOUS les coachs.
--
-- ── La cause racine : les privileges par defaut du schema `public` ──────────────────
--
--   select * from pg_default_acl;
--   → public, tables et vues : {anon=arwdDxtm, authenticated=arwdDxtm, …}
--
-- Supabase pose ces defauts a la creation du projet. **Toute** vue creee dans `public`
-- est donc immediatement lisible par `anon` et `authenticated`, sans qu'aucun `grant`
-- ne soit ecrit. Le verrouillage du 2026-09-02 etait un coup unique : le premier
-- `create view` suivant le defaisait, en silence, sans qu'aucun `grant` fautif
-- n'apparaisse dans le diff.
--
-- ⚠️ **Un `revoke` ne se maintient pas.** C'est le mode de panne de ce projet — la
-- copie figee d'un module partage, la colonne recopiee qui derive de sa source — un
-- cran plus bas : un etat pose une fois, qu'aucun mecanisme ne reaffirme.
--
-- On n'enleve PAS ces privileges par defaut : les tables applicatives en dependent
-- (le navigateur les lit avec `authenticated`, protege par la RLS). Les retirer
-- casserait chaque future table de l'application.
--
-- ── L'invariant retenu, qui ne depend d'aucune liste ni d'aucun nom ────────────────
--
--   Une relation de `public` lisible par `anon` ou `authenticated` DOIT appliquer la
--   RLS — `security_invoker = true` pour une vue, RLS activee pour une table.
--
-- Il n'enumere rien, ne nomme rien, et ne peut pas etre oublie : les defauts de
-- Postgres (ACL ouverte, `security_invoker` a false, RLS desactivee) placent
-- automatiquement toute relation nouvelle DU MAUVAIS COTE. Une convention de nommage
-- (« les vues de sante s'appellent *_sante_* ») aurait laisse passer la premiere vue
-- nommee autrement — et c'est precisement une vue nommee autrement qu'on ne penserait
-- pas a verifier.
--
-- Relevé avant d'ecrire : 17 vues dans `public`. Deux sont lues par le navigateur
-- (`dernier_snapshot_par_profil`, `derniere_publication_par_profil`) et portent DEJA
-- `security_invoker = true` — elles satisfont l'invariant sans etre touchees. Les 15
-- autres ne sont lues que par `service_role`.

-- ── 1. Fermer les deux fuites ───────────────────────────────────────────────────────
-- Verifie : aucun lecteur legitime n'est `authenticated`. `alerte-vues`,
-- `alerte-stockage` et `integrations/health` utilisent tous SUPABASE_SERVICE_ROLE_KEY.
revoke select on public.ventes_sante_sur_encaissement from anon, authenticated;
revoke select on public.ventes_sante_contenu           from anon, authenticated;

-- ── 2. Defense en profondeur : la RLS s'applique meme si un `grant` revient ─────────
--
-- `security_invoker = true` fait executer la vue avec les droits de l'APPELANT. Un
-- futur `create view` qui rouvrirait l'acces par defaut ne serait alors plus une
-- fuite : `anon` ne lit aucune ligne des tables sources, un eleve connecte ne lit que
-- les siennes. `service_role` continue de tout voir (il contourne la RLS).
--
-- ⚠️ Verifie AVANT d'etendre aux 15, sur les deux natures de vue : une qui lit des
-- tables applicatives (`ventes_sante_sur_encaissement`) et une qui lit des catalogues
-- systeme (`base_sante_taille`). Les deux repondent normalement sous `service_role`.
-- Le controle final de cette migration rejoue la lecture des 15 dans la peau de
-- `service_role` — une vue de sante muette serait une surveillance morte, donc pire
-- que la fuite qu'on ferme.
do $$
declare
  v text;
  vs text[] := array[
    'utm_anomalies','ventes_sante_montants','integrations_sante',
    'ig_sante_insights_posts','ventes_sante_contenu','yt_sante_donnees',
    'shortio_sante_donnees','stripe_sante_rattachement','base_sante_taille',
    'clics_sante_redirection','crons_sante','ig_sante_periodes',
    'ventes_sante_sur_encaissement','ventes_sante_date','ig_sante_donnees'
  ];
begin
  foreach v in array vs loop
    execute format('alter view public.%I set (security_invoker = true)', v);
  end loop;
end $$;

-- ── 3. La vue qui rend la prochaine fuite detectable ───────────────────────────────
--
-- Sans elle, cette migration est elle aussi un coup unique. Elle teste l'invariant
-- lui-meme, pas une liste : une relation nouvelle y tombe par le seul effet des
-- defauts de Postgres.
--
-- ⚠️ Elle se surveille ELLE-MEME : creee dans `public`, elle herite de l'ACL ouverte
-- et se signalerait donc en anomalie. Le `revoke` en bas de ce bloc la ferme — et si
-- quelqu'un la recreait sans le rejouer, elle apparaitrait dans son propre resultat.
-- C'est le temoin positif integre : une surveillance qui ne peut pas etre rouverte
-- sans le dire.
create or replace view public.acces_sante_lecture as
select
  c.relname                                              as relation,
  case c.relkind when 'v' then 'vue' when 'r' then 'table' else c.relkind::text end as nature,
  has_table_privilege('anon',          c.oid, 'SELECT')  as lisible_par_anon,
  has_table_privilege('authenticated', c.oid, 'SELECT')  as lisible_par_authenticated,
  case c.relkind
    when 'v' then coalesce((select option_value from pg_options_to_table(c.reloptions)
                            where option_name = 'security_invoker'), 'false')
    when 'r' then case when c.relrowsecurity then 'rls activee' else 'rls DESACTIVEE' end
  end                                                    as protection,
  case
    when has_table_privilege('anon', c.oid, 'SELECT')
      then 'ALERTE lisible sans session et RLS contournee'
    else 'ALERTE lisible par tout compte connecte et RLS contournee'
  end                                                    as anomalie
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('v', 'r')
  -- Lisible depuis le navigateur…
  and (has_table_privilege('anon', c.oid, 'SELECT')
       or has_table_privilege('authenticated', c.oid, 'SELECT'))
  -- …sans que la RLS ne s'applique.
  and case c.relkind
        when 'v' then coalesce((select option_value from pg_options_to_table(c.reloptions)
                                where option_name = 'security_invoker'), 'false') <> 'true'
        when 'r' then not c.relrowsecurity
      end
order by has_table_privilege('anon', c.oid, 'SELECT') desc, c.relname;

comment on view public.acces_sante_lecture is
  'Une ligne = une relation de public que le navigateur peut lire SANS que la RLS ne '
  's''applique (vue sans security_invoker, ou table sans RLS). Vide = invariant tenu. '
  '⚠️ Ne repose sur aucune liste ni convention de nommage : les defauts Postgres '
  '(ACL ouverte a anon/authenticated, security_invoker a false, RLS desactivee) font '
  'tomber toute relation NOUVELLE dans cette vue. C''est ce qui la rend increvable — '
  'un revoke ne se maintient pas, un invariant teste se maintient.';

revoke select on public.acces_sante_lecture from anon, authenticated;
alter view public.acces_sante_lecture set (security_invoker = true);
grant select on public.acces_sante_lecture to service_role;

-- ⚠️ `acces_sante_lecture` doit etre ajoutee au tableau SURVEILLANCES de
-- `app/api/sante/alerte-vues/route.ts`, sinon elle est muette — exactement le defaut
-- des dix vues qui attendaient qu'on pense a les consulter. Fait dans le meme commit.
