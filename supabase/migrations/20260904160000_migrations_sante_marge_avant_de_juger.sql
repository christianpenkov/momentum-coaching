-- Un instantané peut être frais de trente secondes et porter un contenu périmé
--
-- ⚠️ LE DÉFAUT, trouvé par la vue elle-même — sur MA propre migration, dix minutes après
-- l'avoir écrite. `migrations_sante_plancher_sur_la_premiere_vue` s'est signalée
-- « appliquée sans fichier » alors que le fichier était écrit, commité et poussé.
--
-- ── Pourquoi la tolérance précédente ne suffisait pas ──────────────────────────────
--
-- Elle disait : « ne pas juger une migration appliquée APRÈS la prise de l'instantané ».
-- L'ancre était `max(mis_a_jour_le)`, c'est-à-dire l'heure à laquelle l'instantané a été
-- ÉCRIT en base.
--
-- Or cette heure ne dit rien de ce que l'instantané CONTIENT. Le trajet complet est :
--
--   git push  →  Vercel reconstruit (1 à 5 min)  →  poll-leads rafraîchit (jusqu'à 1 h)
--
-- Un rafraîchissement qui tombe entre le `push` et la fin de la construction écrit un
-- instantané **daté de maintenant mais bâti sur le dépôt d'avant**. La migration, elle,
-- est plus ancienne que cette heure d'écriture — donc elle est jugée, contre un
-- inventaire qui ne pouvait pas encore la connaître.
--
-- ⚠️ La fenêtre n'est que de quelques minutes. Mais si elle chevauche le passage de 8 h,
-- **un vrai e-mail part pour rien** — précisément ce que ce mécanisme existe pour éviter.
--
-- ── Le correctif : une marge, pas une plomberie ────────────────────────────────────
--
-- La première idée était de faire émettre au manifeste l'horodatage de sa CONSTRUCTION,
-- et d'ancrer la tolérance là-dessus. C'est plus juste en théorie, et c'est une mauvaise
-- idée en pratique : cette valeur changerait à chaque exécution du générateur, donc le
-- fichier généré apparaîtrait modifié après chaque `npm run build` local. Une plomberie
-- de plus, et du bruit permanent dans le dépôt, pour corriger une fenêtre de cinq
-- minutes.
--
-- Une migration doit désormais être **plus vieille d'une heure** que l'instantané pour
-- être jugée. Une heure, parce que c'est la cadence du rafraîchissement : au bout d'une
-- heure, l'instantané a forcément été réécrit depuis une construction postérieure au
-- `push`. La marge couvre donc tout le trajet, sans rien avoir à mesurer.
--
-- Ce que ça coûte : un vrai orphelin est signalé une heure plus tard. L'alerte part par
-- un e-mail QUOTIDIEN — une heure n'y change rien.
--
-- ⚠️ C'est la même forme que le délai de grâce de quatre heures de l'autre branche, et
-- pour la même raison de fond : **on ne juge pas un état tant qu'on n'a pas la preuve de
-- l'avoir observé après le fait**. Les deux branches disposent maintenant chacune de leur
-- marge, et aucune ne repose sur une date saisie à la main.

create or replace view public.migrations_sante as
with instantane as (
  select max(mis_a_jour_le) as pris_le from public.migrations_du_depot
),
appliquees as (
  select version, name as nom from supabase_migrations.schema_migrations
),
fichiers as (
  select version, nom, vu_le from public.migrations_du_depot
)
select
  a.nom,
  a.version                             as version_appliquee,
  null::text                            as version_fichier,
  'ALERTE appliquee sans fichier'::text as anomalie
from appliquees a, instantane i
where a.version >= '20260901000000'
  and i.pris_le is not null
  -- ⚠️ La marge d'une heure est le correctif. Sans elle, une migration appliquee juste
  -- avant un rafraichissement bati sur une construction anterieure au push est jugee
  -- contre un inventaire qui ne peut pas encore la connaitre.
  and a.version < to_char((i.pris_le - interval '1 hour') at time zone 'UTC', 'YYYYMMDDHH24MISS')
  and not exists (select 1 from fichiers f where f.nom = a.nom)

union all

select
  f.nom,
  null::text,
  f.version,
  'ALERTE fichier jamais applique'::text
from fichiers f
where f.vu_le < now() - interval '4 hours'
  and not exists (select 1 from public.migrations_ecarts_historiques e where e.nom = f.nom)
  and not exists (select 1 from appliquees a where a.nom = f.nom)

union all

select
  'instantane du depot'::text,
  null::text,
  coalesce(to_char((select pris_le from instantane), 'YYYY-MM-DD HH24:MI'), 'jamais'),
  'ALERTE instantane du depot perime — la route ne le rafraichit plus'::text
from instantane i
where i.pris_le is null or i.pris_le < now() - interval '4 hours';

comment on view public.migrations_sante is
  'Vide = le depot et la base racontent la meme histoire recente. La cle de '
  'rapprochement est le NOM : celui passe a apply_migration doit etre exactement celui '
  'du fichier, horodatage retire. DEUX MARGES, et aucune date saisie a la main : une '
  'migration doit etre plus vieille d''une heure que l''instantane pour etre jugee (le '
  'temps du trajet push -> construction -> rafraichissement), et un fichier dispose de '
  '4 heures avant d''etre juge (ecrire puis appliquer est un ordre legitime). Les quinze '
  'ecarts anterieurs sont NOMMES dans migrations_ecarts_historiques, chacun verifie '
  'present en base — cette liste ne doit jamais grandir.';

revoke select on public.migrations_sante from anon, authenticated;
grant select on public.migrations_sante to service_role;
