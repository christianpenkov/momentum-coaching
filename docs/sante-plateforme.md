# Santé de la plateforme

Extrait d'`AGENTS.md` le 2026-09-12, mot pour mot. Il y occupait 680 lignes — 40 %
du fichier — que chaque session chargeait, alors qu'on n'en a besoin qu'en
diagnostiquant une alerte ou en créant une vue.

**Aucune de ces vues n'a besoin d'être regardée.** Depuis le 2026-09-01,
`/api/sante/alerte-vues` les parcourt toutes une fois par jour et envoie un e-mail dès
qu'une se met à alerter — une fois par sujet, réarmée d'elle-même quand la vue redevient
propre (table `alertes_plateforme`). Auparavant, seul le plafond de stockage prévenait :
les dix autres attendaient qu'on pense à les consulter, ce qui n'est pas une
surveillance mais une documentation.

L'e-mail est écrit pour être lu **dans un an, par quelqu'un sans contexte** : ce que la
vue surveille, ce que l'alerte veut dire, ce que ça coûte, les vérifications dans
l'ordre, et un **prompt prêt à coller dans Claude Code** qui nomme le dossier du projet
et la référence Supabase. Toute nouvelle vue de santé doit être ajoutée au tableau
`SURVEILLANCES` de cette route — sinon elle est muette, exactement comme les dix
précédentes.

Déclenchée par `poll-leads` dans la tranche 8 h Paris, comme `alerte-stockage` : aucun
planificateur à créer, et la clé Resend ne quitte pas les variables Vercel.

```sql
select * from cron_runs_actifs;                 -- vide = aucun incident à traiter
select * from yt_sante_donnees;                 -- 'ok' partout
select * from integrations_sante;               -- 'ok' ou 'non_connectee'
select * from ventes_sante_montants;            -- vide = rapport et deal concordent
select * from stripe_sante_rattachement;        -- vide = chaque encaissement a sa vente
select * from ventes_sante_sur_encaissement;    -- vide = aucun deal n'a encaisse 2x
select * from ventes_sante_contenu;             -- 'ok' partout
select * from ventes_sante_date;                -- aucune ligne 'ALERTE%'
select * from ig_sante_insights_posts;          -- 'ok' partout
select * from ig_sante_periodes;                -- aucune ligne 'ALERTE%'
select * from base_sante_taille;                -- 'ok' = plafond de stockage loin
select * from clics_sante_redirection;          -- 'ok' partout
select * from crons_sante;                      -- aucun 'SILENCIEUX' = les crons inscrits tournent
select * from acces_sante_lecture;              -- vide = aucune donnée lisible du navigateur sans RLS
select * from edge_sante_version;               -- aucune ligne 'ALERTE%' = les fonctions en ligne sont celles du dépôt
select * from migrations_sante;                 -- vide = dépôt et base racontent la même histoire récente
```

## ⚠️ Une migration vit à DEUX endroits, et rien ne les rapprochait

Appliquer un changement de schéma sans écrire le fichier **ne produit aucun symptôme** :
la base fonctionne, les écrans fonctionnent, les tests passent. Mesuré le 2026-09-03 :
**sept migrations des 1ᵉʳ au 3 septembre n'existaient que dans la base**, venues de quatre
sessions différentes — dont celle qui crée `crons_passages`, `crons_sante` et
`marquer_passage_cron`, c'est-à-dire toute la surveillance des crons. Deux migrations
ultérieures agissaient sur une table qu'aucun fichier ne créait.

**La règle, et c'est la seule clé qui reste** : le nom passé à `apply_migration` doit être
**exactement** celui du fichier, horodatage retiré.

```
supabase/migrations/20260903200000_migrations_sante.sql   →   apply_migration(name: 'migrations_sante')
```

### ✅ Le SQL exact d'une migration appliquée est RÉCUPÉRABLE (trouvé le 2026-09-05)

`supabase_migrations.schema_migrations` porte une colonne **`statements`** : les
instructions exactes de chaque migration appliquée, commentaires d'origine compris.

```sql
select name, version, array_to_string(statements, E'\n')
from supabase_migrations.schema_migrations
where name in ('…');
```

⚠️ **C'est très supérieur à la méthode que ce document recommandait** — reconstruire
depuis `pg_get_viewdef`, `pg_get_functiondef` et `information_schema`. Celle-ci ne rend
que l'état FINAL : elle ne peut pas distinguer « la colonne n'a jamais existé » de « elle
a été ajoutée puis retirée », et elle perd tous les commentaires, donc le *pourquoi*.

Utiliser `statements` en premier pour toute migration « appliquée sans fichier » :
la reconstitution devient une **copie**, pas une déduction. Ne garder l'inspection de
l'état que pour les migrations trop anciennes (les 185 d'avant la surveillance, dont
`statements` peut être vide).

Cas réel : `avatar_maj_le` et `retrait_avatar_maj_le` (05/09, colonne posée puis retirée
en quatre minutes, effet net nul). L'état de la base seul aurait fait conclure « rien à
reconstituer » — et aurait laissé deux trous permanents dans `migrations_sante`.

⚠️ **Le numéro de version ne peut PAS servir de clé** : celui de la base est généré par
l'outil d'application, celui du fichier est choisi à la main, et les deux ne coïncident
jamais (appliquée `20260903165006 inscrire_les_trois_crons_pg_cron`, fichier
`20260903190000_inscrire_les_trois_crons_pg_cron.sql`). **Cinq horodatages de fichiers
sont même en double** dans le dépôt.

⚠️ **Le dépôt n'a JAMAIS permis de reconstruire la base, et ce n'est pas nouveau.**
`supabase/migrations/` commence au 2026-07-18 et ne contient aucun schéma initial : les
tables `profiles`, `deals`, `calls` ne sont créées par aucun fichier. Relevé du
2026-09-03 : **282 migrations enregistrées en base, 114 fichiers, 185 sans fichier** — et
16 fichiers sans ligne à leur nom, dont la moitié sont des divergences de nommage
(`webhook_queue` contre `create_webhook_queue`, `purge_journaux_machine` contre
`purge_journaux_machine_pg_cron`). Ne pas énoncer « une reconstruction échouerait » comme
une conséquence des sept dernières : c'était déjà vrai.

⚠️ **CE PLANCHER DE DATE A ÉTÉ SUPPRIMÉ le 2026-09-04, et la vérification manuelle
ci-dessous n'est plus nécessaire.** Il portait sur `f.version`, l'horodatage du NOM DE
FICHIER — une valeur saisie à la main. `20260902100000_dernier_snapshot_par_profil.sql`,
écrit le 4 mais daté du 2, passait donc dessous : la vue ne pouvait pas le voir alors
qu'il faisait partie du même travail. Trouvé par la session Stats Clients, à la main.

**On ne borne pas une surveillance avec une valeur que son auteur choisit librement.**
Deux mécanismes le remplacent, aucun n'étant une date tapée par quelqu'un :

- **`migrations_du_depot.vu_le`** — le jour où le dépôt a montré le fichier pour la
  première fois. Posée à l'insertion, jamais mise à jour (la route ne l'envoie pas dans
  son `upsert`). Elle donne **4 heures de grâce** côté fichiers : écrire le fichier puis appliquer la
  migration est un ordre légitime, et sans grâce la vue crierait dans l'intervalle.
- **`migrations_ecarts_historiques`** — les quinze exceptions antérieures, **nommées une
  par une avec leur preuve**. Une liste fermée qui ne grandit jamais toute seule vaut
  mieux qu'une date qui laisse passer tout ce qui se présente avec le bon costume.

⚠️ **Les quinze ont été vérifiées présentes en base avant d'être gelées** : six sont
appliquées sous un nom voisin, six par la présence de la colonne qu'elles créent, trois —
des migrations de DONNÉES, sans empreinte de schéma — par leur **conséquence** (0
remboursement sans `paid_at`, 0 séquence portant encore un gabarit `{{…}}`, 0 call dont
l'`utm_medium` contredit sa source). Geler sans vérifier aurait transformé un angle mort
en angle mort *documenté*, ce qui est pire : on cesse de chercher.

⚠️ **Cette liste ne doit jamais grandir.** Une ligne de plus signifie qu'on a renoncé à
comprendre un écart, pas qu'on l'a résolu.

⚠️ **Et une marge d'UNE HEURE côté migrations appliquées**, ajoutée le 2026-09-04 après
que la vue se soit signalée elle-même. L'instantané peut être frais de trente secondes et
porter un contenu périmé : le trajet complet est `git push` → construction Vercel (1 à
5 min) → rafraîchissement horaire. Un rafraîchissement qui tombe entre le `push` et la
fin de la construction écrit un inventaire **daté de maintenant, bâti sur le dépôt
d'avant** — et la migration, plus ancienne que cette heure d'écriture, était jugée contre
lui. Une migration doit donc être plus vieille d'une heure que l'instantané pour être
jugée. Un vrai orphelin est signalé une heure plus tard ; l'alerte part par un e-mail
quotidien, ça ne change rien.

**Les deux branches ont maintenant chacune leur marge, et aucune ne repose sur une date
saisie à la main** — c'est le même principe des deux côtés : on ne juge pas un état tant
qu'on n'a pas la preuve de l'avoir observé après le fait.

⚠️ Leçon de méthode payée en route : trois de ces quinze avaient d'abord été déclarées
« absentes » parce que le nom de leur colonne avait été **deviné** au lieu d'être lu dans
le fichier. Une sonde inventée produit un faux négatif indiscernable d'un vrai.

`migrations_sante` ne surveille donc que le récent, et **chaque borne est posée là où la
mesure dit qu'elle ne produit aucun faux positif** — le détail et le motif sont dans
`20260903200000_migrations_sante.sql`. Surveiller tout l'historique donnerait ~200 lignes
permanentes, c'est-à-dire une alerte qu'on n'ouvre plus.

## ⚠️ « Personne ne lit cette colonne » a une date de péremption

Le 2026-08-28, quatre colonnes de `analytics_daily_snapshots` ont cessé d'être
alimentées — `shortio_clicks`, `shortio_human_clicks`, `shortio_top_countries`,
`shortio_top_referrers` — pour économiser deux appels Short.io par élève et par passage.
La justification écrite dans le code était : « Vérifié : AUCUN code et AUCUNE vue SQL ne
lit ces quatre colonnes. » **Elle était exacte.**

Le 2026-09-01, soit quatre jours plus tard, `stats_clients_series` a été créée et s'est
branchée sur `shortio_human_clicks`. Rien ne pouvait le signaler : la colonne existait
toujours, elle portait un nom parlant, et elle contenait des valeurs — figées au 28 août.

Constaté le 2026-09-06 : la carte « Clics » du portefeuille coach affichait **550 clics
pour un élève qui en avait 27**, et « aucune donnée » pour un élève qui en avait 20. Neuf
jours sans que rien n'alerte, pendant que la table vivante (`shortio_link_daily_snapshots`)
recevait 2 943 lignes.

**Une colonne qu'on cesse d'écrire mais qu'on laisse en place est un piège armé.** Elle
survit à la vérification qui l'a déclarée morte, et le prochain écran s'y branchera
d'autant plus volontiers que son nom est le bon. Trois gestes, par ordre de solidité :

1. **La supprimer** dans la même migration que l'arrêt de son écriture. Une colonne
   absente produit une erreur au premier `select` — le seul signal qui ne se périme pas.
2. Si elle doit rester (rattrapage possible, coût de migration), **la renommer**
   `<nom>_abandonnee_AAAAMMJJ`. Le nom porte alors la date, et un futur lecteur ne peut
   plus s'y brancher par mégarde.
3. À défaut, **`comment on column`** disant depuis quand elle n'est plus écrite. Le plus
   faible des trois : rien n'oblige à lire un commentaire.

⚠️ **Le corollaire pour toute nouvelle lecture.** Avant de brancher un écran sur une
colonne de snapshot, vérifier qu'elle est encore ÉCRITE — pas seulement qu'elle contient
des valeurs. La requête tient en une ligne, et elle aurait évité ces neuf jours :

```sql
select max(date) from analytics_daily_snapshots where <colonne> is not null;
```

Si la date n'est pas d'hier ou d'aujourd'hui, la colonne est morte, quoi qu'en dise son
contenu.

## ⚠️ Un `revoke` ne se maintient pas — l'invariant, si

Supabase pose des **privilèges par défaut** sur le schéma `public`
(`select * from pg_default_acl`) : `anon` et `authenticated` reçoivent `ALL` sur toute
table et toute vue **nouvellement créée**. Donc `create view` suffit à exposer une
donnée, sans qu'aucun `grant` n'apparaisse dans le diff.

Constaté le 2026-09-03 : la migration `20260902200000` avait fermé les 15 vues de santé
la veille ; **deux migrations du lendemain les ont rouvertes** — l'une par un `drop` +
`create` (privilèges par défaut), l'autre par un `grant … to authenticated` recopié.
`ventes_sante_sur_encaissement` est redevenue lisible **sans aucune session**, et comme
`security_invoker` vaut `false` par défaut, la RLS était contournée : les ventes, les
montants et les identifiants Stripe de tous les coachs.

**Ne jamais lire un `grant` comme une restriction.** Un `grant` ajoute, il n'enlève rien.
La seule façon de savoir ce qu'une relation autorise est de le demander à la base :

```sql
select has_table_privilege('anon', 'public.ma_vue', 'SELECT');
```

L'invariant qui remplace la vigilance, porté par `acces_sante_lecture` et alerté par
e-mail comme les autres vues :

> Toute relation de `public` que `anon` ou `authenticated` peut lire **doit appliquer la
> RLS** — `security_invoker = true` pour une vue, RLS activée pour une table.

Il n'énumère rien et ne dépend d'aucune convention de nommage : les défauts de Postgres
(ACL ouverte, `security_invoker` à false, RLS désactivée) font tomber toute relation
nouvelle **du mauvais côté**, donc dans la vue. Témoin positif joué : une vue créée sans
aucun `grant` y apparaît d'elle-même.

⚠️ **Ne PAS retirer les privilèges par défaut du schéma** (`alter default privileges …
revoke`) : les tables applicatives en dépendent — le navigateur les lit avec
`authenticated`, protégé par la RLS.

### Le même défaut existe pour les FONCTIONS, et il est plus discret

`create or replace function` préserve l'ACL — vérifié le 2026-09-06 sur
`stats_clients_series`, recréée deux fois sans que `anon` réapparaisse. **Mais ajouter
une colonne à un `returns table` change le type de retour, et Postgres refuse alors le
`replace` : il faut `drop` puis `create`.** À la recréation, les privilèges par défaut
du schéma re-accordent `execute` à `anon`, en silence.

⚠️ **`revoke … from public` ne couvre PAS ce cas.** `anon` est un rôle, `PUBLIC` en est
un autre — constaté à l'exécution : l'ACL portait `{postgres, anon, authenticated,
service_role}` après le `create`, alors que l'état d'avant n'avait pas `anon`. Après
tout `drop + create` de fonction, le `revoke … from anon` explicite est **obligatoire**.

La requête de contrôle :

```sql
select p.proname, p.prosecdef as definer, p.proacl::text
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proacl::text like '%anon=X%';
```

**Trier le résultat, ne pas le corriger en bloc.** Elle rend 6 lignes au 2026-09-06, et
aucune n'est une fuite — trois catégories, une seule à examiner :

- **Fonctions de trigger** (`set_updated_at`, `figer_detected_at`,
  `edge_empreinte_horodater_si_changee`) : sans argument et de type `trigger`, Postgres
  refuse de les appeler directement. `anon=X` y est inerte.
- **Sans argument et `invoker`** (`integrations_obligatoires`) : la RLS s'applique, il
  n'y a rien à faire fuir.
- **`SECURITY DEFINER` avec un argument** (`client_can_read_section`,
  `client_has_resource_access`) : **la seule catégorie à examiner**, parce qu'elle
  contourne la RLS et répond à une question sur une ressource précise — un oracle
  potentiel pour qui connaît un uuid.

Ces deux-là sont sûres, et c'est prouvé plutôt que déduit : elles filtrent sur
`ra.client_id = auth.uid()`, qui vaut NULL pour `anon`. Test joué le 2026-09-06 sur le
MÊME uuid, avec témoin positif — le propriétaire légitime obtient `true`, `anon` obtient
`false`. Sans le témoin positif, deux `false` n'auraient rien prouvé.

**Le critère à retenir** : ce qui rend `anon=X` dangereux n'est pas le droit d'exécuter,
c'est `SECURITY DEFINER` **combiné** à un paramètre qui désigne une ressource. Une
fonction `invoker` reste tenue par la RLS ; une fonction `definer` bornée par
`auth.uid()` ne peut rien dire à qui n'a pas de session.

⚠️ **`cron_runs` couvre désormais aussi `sync-calendly`** (ajouté le 2026-08-31 : ses
erreurs partaient dans une réponse HTTP que cron-job.org jette). Filtrer par
`fonction` pour savoir qui a échoué.

⚠️ **`/api/calendly/cron-sync` a été SUPPRIMÉE** le 2026-09-01. Elle portait un
commentaire « Cron Vercel 6h » qui n'a jamais été vrai — zéro appel en 24 h dans les logs
Vercel le 2026-08-31. Le vrai chemin est, et a toujours été, l'Edge Function
`sync-calendly`.



`base_sante_taille` surveille le **plan Supabase**, qui est aujourd'hui le **gratuit**
(500 Mo, base à 97 Mo le 2026-08-30). C'est le seul risque de la plateforme qui ne
prévient pas : rien ne casse à l'avance, les écritures échouent d'un coup. La vue
mesure la croissance réelle des trois tables « une ligne par contenu et par jour »
**et de `link_clicks`** (ajoutée le 2026-08-31 : une table qui grossit sans être
comptée fait partir l'alerte trop tard) et affiche les jours restants pour les deux
plans — passer en Pro ne demande donc aucune
modification. À 40 élèves × 300 posts, le gratuit tient ~6 semaines ; le Pro, ~2,5 ans.

**Et cette vue n'a pas besoin d'être regardée** : `/api/sante/alerte-stockage` envoie
un e-mail à 90 puis à 30 jours du plafond, chacun **une seule fois** (table
`alertes_plateforme`, réarmée d'elle-même si la situation redevient saine). Le mail
rappelle tout le contexte — il arrivera dans plusieurs mois. Déclenché par
`poll-leads` dans la tranche 8 h Paris : **aucun planificateur à créer**, et la clé
Resend ne quitte pas les variables Vercel.

```sql
select * from alertes_plateforme;   -- vide = aucun seuil encore franchi
```

⚠️ **La taille de la base n'est pas que de la donnée.** Alerte Disk IO reçue le
2026-08-30 : sur 112 Mo, **la moitié était du journal de machine** —
`net._http_response` 34 Mo pour 24 lignes vivantes (autovacuum passé une seule fois
en 25 jours, pages jamais réutilisées) et `cron.job_run_details` 19 Mo que pg_cron
ne purge jamais. Après nettoyage : **54 Mo**, et deux jobs quotidiens l'entretiennent.
Avant de conclure que « la base grossit », regarder QUI grossit :

```sql
select schemaname||'.'||relname, pg_size_pretty(pg_total_relation_size(relid)),
       n_live_tup, n_dead_tup, last_autovacuum
from pg_stat_all_tables order by pg_total_relation_size(relid) desc limit 10;
```

`ig_sante_insights_posts` surveille la collecte des contenus Instagram.
`depreciation_metrique_probable` = une métrique Meta vient de disparaître ; la
plateforme a déjà encaissé la perte toute seule, c'est une information, pas une
panne. `posts_muets_definitif` n'est **pas** une anomalie : Meta ne rend aucune
statistique sur les publications antérieures au passage en compte pro.

## ⚠️ Ce que l'API Insights d'Instagram accepte vraiment (mesuré, pas déduit)

La doc officielle ne suffit pas : elle annonce « User Metrics data is stored for up to
90 days » alors que l'API en sert **729**, et elle ne dit rien du cas d'une période en
cours. Tout ce qui suit a été mesuré contre l'API réelle le 2026-09-07, sur trois
comptes. La règle vit dans **`lib/meta-fenetre.ts`**, avec ses tests.

### La seule borne dure : 729 jours, sur `since`

```
J-726 … J-729 → ACCEPTÉ
J-730 …       → HTTP 400, code 100
                « since param is not valid. Metrics data is available for the last 2 years »
```

Testé jour par jour de J-726 à J-732. C'est la **seule** condition qui fasse échouer
l'appel, donc la seule à éviter avant d'appeler : un HTTP 400 est rejoué indéfiniment
par un appelant qui réessaie. Le code s'arrête à J-728, un jour de marge, parce que la
borne se déplace à minuit.

Deux non-limites, également mesurées : **pas de longueur maximale de fenêtre** (testé à
500 jours, valeur dédupliquée, aucune troncature silencieuse), et **le seuil des
100 abonnés ne s'applique pas** à `reach` + `breakdown=follow_type` — deux comptes à
0 abonné rendent leur mesure. Il ne concerne que `follower_count`, `online_followers` et
la démographie.

⚠️ Au-delà d'environ un an, `total_value.value` reste servi mais **la ventilation
`follow_type` revient VIDE** (0 ligne à J-500, J-700, J-729 ; 1 ou 2 lignes en deçà).
C'est ce qui justifie le plafond de 12 mois du rattrapage. Le parsing laisse alors
`abonnes` / `nonAbonnes` à `null` — un trou, jamais un zéro.

### ⚠️ Une réponse VIDE n'est pas une panne, et n'est pas définitive

C'est le piège qui a coûté le plus cher, et il s'est doublé d'une **erreur de
raisonnement qu'il faut connaître pour ne pas la refaire**.

Première mesure, un lundi matin, sur les trois comptes :

```
[hier        → hier]        → total_value PRÉSENT
[aujourd'hui → aujourd'hui] → total_value ABSENT
[hier        → aujourd'hui] → total_value PRÉSENT
```

Conclusion tirée : « une fenêtre sans journée TERMINÉE ne rend rien ». Trois lignes
cohérentes, trois comptes concordants, et deux hypothèses concurrentes réfutées au
passage. **C'était faux.** Quelques heures plus tard, le même appel sur le même compte
rend `valeur = 0`. Un balayage de `until` seconde par seconde (de 00:00:00 à J+2) donne
la même réponse partout : ce n'est ni `until`, ni la taille de la fenêtre, ni la
journée terminée.

**C'est l'HEURE.** Meta ne sert le seau d'une période qu'une fois qu'il a traité quelque
chose pour elle ; avant, il rend un jeu de données vide. Sa doc le dit, pour une raison
qu'on croyait sans rapport : « If insights data you are requesting does not exist or is
currently unavailable the API will return an empty data set instead of `0` ».

⚠️ **La leçon de méthode, plus utile que le fait lui-même** : trois observations
concordantes au même instant ne distinguent pas une règle d'un état transitoire. Il
manquait la seule variable qu'on n'avait pas fait varier — **le temps**. Devant un
comportement d'API, rejouer la même sonde plus tard avant d'en tirer une loi.

**Conséquence pour le code** : une réponse vide ne doit ni être traitée comme une
erreur, ni faire renoncer à appeler. Elle doit se **stocker** comme « pas encore
mesuré ».

### Le mode de panne : une ligne ABSENTE ne freine rien

Le 2026-09-07, la mesure de la semaine en cours levait tous les lundis. Aucune ligne
n'étant écrite, la règle de fraîcheur des 6 h n'avait rien à comparer et l'appel
repartait **à chaque synchro Instagram du profil** — une par heure, donc ~24 appels
Meta perdus par profil chaque lundi, et autant chaque 1er du mois.

⚠️ **Chiffre corrigé après coup, et l'erreur vaut d'être retenue.** La première version
de cette section annonçait « 288 appels par jour » : c'était le nombre de passages de
`poll-leads` (toutes les 5 min), pas le nombre d'appels Meta. Le bloc Instagram entier
est gaté par `igDoitSync` / `IG_INTERVALLE_MS`, une fois par heure et par profil.
**Un compteur de passages du cron n'est pas un compteur d'appels d'API** — vérifier
quelle garde enferme le code avant de multiplier.

Trois gardes ferment la boucle, et il faut les trois :

| Cas | Conduite |
|---|---|
| À la clôture (`figee`) | **lever** — ne jamais figer un vide, il deviendrait indiscernable d'une portée nulle |
| En cours, ligne déjà présente | **ne toucher à rien**, et noter l'essai |
| En cours, aucune ligne | **écrire la ligne à valeurs nulles** |

⚠️ Le deuxième cas est le moins évident et le plus dangereux : l'écriture est un
`delete` + `insert`. Sans ce retour anticipé, un simple hoquet de Meta **efface une
mesure réelle** pour la remplacer par du vide, toutes les 6 heures.

⚠️ Et `dernier_essai_le` est une colonne SÉPARÉE de `mesure_le`, délibérément. Une ligne
périmée que Meta ne sert pas relancerait l'appel à chaque passage ; rafraîchir
`mesure_le` à la place aurait éteint **pour toujours** la branche « période courante
figée » de `ig_sante_periodes` — exactement le piège déjà documenté plus haut sur
`edge_sante_version`. Deux questions, deux colonnes :

```
mesure_le         quand la portée a été RÉELLEMENT obtenue  → sert la surveillance
dernier_essai_le  quand on a appelé Meta, succès ou non     → sert la cadence
```

### Une surveillance ne doit pas juger un état plus jeune que son premier instant observable

`ig_sante_periodes` avait deux branches et une seule portait l'intention de son auteur :
« figée » attendait 24 h, « jamais mesurée » déclenchait à l'instant du basculement de
`date_trunc('week', now())`. D'où un e-mail d'alerte **garanti chaque lundi et chaque
1er du mois** (~64 jours/an, par élève) sur un état normal et inévitable.

Corrigé : soit `D = greatest(debut_attendu, depart_integration)`, l'alerte ne part qu'à
`D+2` — les mêmes 24 h que la branche voisine, comptées depuis le premier moment
observable. `greatest` ignore les NULL, ce qui rend `all_time` (sans `debut_attendu`)
uniforme avec les deux autres. Si les deux ancres sont NULL, l'alerte part comme avant :
**une ignorance ne doit pas fabriquer du silence.**

⚠️ **La contrepartie est obligatoire** : puisque le cron écrit désormais une ligne à
valeurs nulles, la vue devait apprendre à voir `reach_total is null` — sinon on
remplaçait une fausse alerte par un **angle mort**, strictement pire, la fausse alerte
ayant au moins le mérite de se voir.

⚠️ **Cette grâce ne cache aucune panne durable** : les lignes `mois` et `all_time` du
même profil sont rafraîchies toutes les 6 h ; si Meta tombe, leur branche « figée »
alerte à 24 h. La branche corrigée n'était pas le seul détecteur, seulement le seul à
crier sur du normal.

C'est le même principe que `edge_sante_version` (« en attente du prochain passage ») et
que les deux marges de `migrations_sante` : **on ne juge pas un état tant qu'on n'a pas
la preuve de l'avoir observé après coup.** Trois surveillances ont eu ce défaut ; devant
une nouvelle vue, se demander d'emblée quel est son premier instant observable.

⚠️ **Le corollaire piégeux** : faire taire la vue sans corriger le cron aurait rendu ces
appels perdus **invisibles** au lieu de les arrêter. Une fausse alerte est parfois le
seul symptôme visible d'un vrai gaspillage — corriger les deux côtés, ou aucun.

### Une lecture tronquée doit être triée

`majPeriodesIg` lisait les périodes non figées avec `.limit(20)` **sans `order`**. La
troncature était donc arbitraire, et cette lecture sert deux questions : trouver les
périodes à clôturer, ET savoir si la période EN COURS doit être rafraîchie. Si la
période courante tombait hors du lot, elle était réécrite **à chaque passage** au lieu
de toutes les 6 h.

Triée par `fin` décroissant : les périodes en cours ont la `fin` la plus lointaine, donc
elles sont toujours en tête et ne peuvent pas être évincées. Le tri inverse serait le
piège. Règle générale : **un `limit` sans `order` est un bug qui attend son volume.**

`stripe_sante_rattachement` liste les encaissements que Stripe connaît et qu'aucune
vente ne revendique. ⚠️ Elle ne voit QUE ce qu'un chemin d'écriture a déjà enregistré :
un webhook jamais délivré ne laisse aucune trace et reste invisible ici. Seule la passe
quotidienne de `sync-stripe-payments` ferme ce trou-là, en rapportant chez nous ce que
Stripe sait. Les deux sont complémentaires, ni l'un ni l'autre ne suffit.

⚠️ **Stripe a retiré le lien charge ↔ facture.** Mesuré contre l'API réelle le
2026-08-31 sur `2026-04-22.dahlia` : `charge.invoice`, `invoice.charge`,
`invoice.payment_intent` et `payment_intent.invoice` sont **tous absents**. Le seul lien
restant est `invoice.payments` sous `expand`, au prix d'un appel par facture. Ne pas
réessayer de rattacher une charge à sa facture — et ne pas s'en inquiéter : une charge
d'abonnement porte `metadata: {}`, donc elle ne se rattache à aucun deal et n'écrit rien.
C'est `ventes_sante_sur_encaissement` qui garde le cash, pas une garde à l'écriture.

⚠️ **Le cash a UNE seule règle : `lib/dealCash.ts`.** Ne jamais sommer des paiements à
la main. Sept lectures le faisaient encore le 2026-08-30 (`.eq('status','succeeded')`
puis une somme) et n'ont donc JAMAIS déduit un remboursement : 2 800 € affichés pour
2 600 € en caisse. `calculerCash().net` pour « ce qui reste dans la caisse »,
`encaisseRetenu()` pour « quelle part d'une vente est rentrée » — la seconde plafonne
au montant contracté, sinon un trop-perçu fait dépasser 100 % et vient effacer la dette
d'un autre client dans les totaux.

## ⚠️ « VERSÉ PAR LE CLIENT » N'EST PAS « RESTÉ DANS LA CAISSE »

**Neuf écrans ont confondu les deux les 6 et 7 septembre 2026**, et la conséquence était
toujours la même : réclamer une seconde fois un argent déjà payé.

```
net              = encaissé − remboursé − contesté − perdu en litige
verseParLeClient = encaissé − remboursé
```

Un **remboursement** fait baisser les deux : l'argent sort de la caisse ET retourne chez
le client, qui peut donc redevoir. Un **litige** ne fait baisser que le premier — la
banque retient, mais le client a bien versé. **Il ne doit rien.**

| La question posée | La grandeur |
|---|---|
| combien me reste-t-il ? | `cash.net` |
| combien me doit-il **encore** ? | `verseParLeClient()` |
| combien puis-je lui **rendre** ? | `cash.net` — on ne rend que ce qu'on tient |

⚠️ `resteAEncaisser()` prend donc le **versé** et `aRembourser()` le **net** : cette
asymétrie est délibérée, ne pas « harmoniser » les deux.

Le détail des neuf endroits, et le modèle `dispute_lost` qui en découle, sont dans
`docs/stripe-paiements.md` §1.

## ⚠️ Une règle ne doit vivre qu'à UN endroit — `npm test` le vérifie

Les 6 et 7 septembre 2026, **onze défauts** ont été trouvés sur les paiements. Tous, sans
exception, avaient la même forme : *une règle posée d'un côté d'une partition, oubliée de
l'autre* — `modeDe` corrigé dans l'écran mais pas dans la route, `refreshDealStatus`
recopié dans deux routes, la règle du cash absente du SQL, le garde « vente signée »
lisant `deals` d'un côté et `calls.deal_closed` de l'autre…

**Aucun n'était visible en relisant le fichier qu'on modifiait.** Ils vivaient dans
l'autre fichier, celui qu'on n'ouvrait pas.

```bash
npm run verifier-regles-uniques    # tourne dans `npm test`
```

Trois motifs, chacun mesuré sur le dépôt avant d'être retenu : une somme de paiements à
la main, un ternaire qui décide `'paid'`, un `refreshDealStatus` local. Il a trouvé une
dixième occurrence à son premier passage.

⚠️ **Ne JAMAIS allonger sa liste d'exceptions pour le faire passer.** La correction est
de supprimer la copie, pas de la déclarer légitime.

⚠️ **Il ne couvre ni le SQL, ni les gardes métier, ni deux écrans qui posent la même
question autrement.** Le seul filet général reste le réflexe : **devant un défaut trouvé
DEUX fois, chercher immédiatement tous les endroits où il peut se produire**, au lieu
d'en corriger un troisième. C'est ce réflexe qui a sorti les six derniers d'un coup.

⚠️ **Une règle de cash vit potentiellement à TROIS endroits** — `lib/dealCash.ts` (Node),
sa copie Deno, et le SQL (`ventes_cash_net`, `cash_regles_statut`). Le troisième est
invisible depuis TypeScript : l'ajout de `dispute_lost` l'a oublié. **Avant d'ajouter une
valeur à une colonne de statut, `grep` sur le NOM DE LA COLONNE, pas sur le nom du
module.**

⚠️ **La règle vaut aussi pour les requêtes de VÉRIFICATION**, et c'est là qu'on l'oublie.

Le 2026-09-06, deux sessions ont contrôlé les mêmes chiffres de l'onglet Revenus avec
deux requêtes SQL écrites à la main. L'une déduisait `refunded` mais pas `disputed`,
l'autre les deux — d'où deux « vérités » et une heure passée à chercher laquelle des
deux avait raison. Personne n'avait touché au code : les cinq écrans passaient déjà
par `calculerCash`.

C'est exactement l'erreur que ce paragraphe documente depuis le 2026-08-30, reproduite
dans **l'outil censé la détecter**. Une requête de contrôle qui somme les paiements à
la main n'est pas une vérification : c'est une sixième implémentation de la règle, non
testée, et qui contredira les cinq autres au premier statut ajouté par Stripe.

En SQL, les trois statuts qui sortent de la caisse sont `refunded`, `disputed` et — le
jour où il apparaîtra — celui que Stripe n'a pas encore inventé. Un contrôle honnête
les énumère explicitement et se relit à côté de `lib/dealCash.ts`, ou n'existe pas.

⚠️ **Corollaire sur le DIAGNOSTIC.** Devant deux mesures qui divergent, la première
hypothèse tentante est « les données ont bougé depuis ». Elle est confortable et
invérifiable. Le 2026-09-06, elle a été avancée à tort : les contestations dataient de
la veille 19h24, donc antérieures aux deux mesures. La divergence venait de la requête,
pas du temps. **Avant d'accuser l'horloge, comparer les deux requêtes.**

`ventes_sante_montants` compare les DEUX écritures du cash : le montant saisi dans le
rapport de call et le deal qui en découle. Les écrans lisent `deals` ; une ligne ici
signifie qu'un élève a saisi un montant que ses stats n'affichent pas.

⚠️ **Exclure une ligne dans un LEFT JOIN, c'est la transformer en ABSENCE** — et si
l'absence est ce que l'autre branche dénonce, l'exclusion produit l'alerte qu'elle
croyait éteindre.

Cette vue en a fait la démonstration le 2026-09-09, avec la **première alerte de toute
son existence** : un faux positif. Son auteur avait écrit `d.status <> 'canceled'` dans
le `on` pour dire « une vente annulée n'a pas à concorder » — son commentaire d'origine
le dit mot pour mot. Mais un `LEFT JOIN` ne retire pas la ligne écartée, il la remplace
par des NULL : la vente annulée se présentait donc au `where` avec `d.id is null`,
c'est-à-dire sous l'apparence exacte d'une vente **jamais créée**, le seul cas que
`deal_manquant` signale sans condition. **Écarter se fait dans le `where`, ou par un
`not exists` ; le `on` ne sert qu'à apparier.**

⚠️ **Un appel reste marqué « vente conclue » après l'annulation de sa vente, et c'est
DÉLIBÉRÉ.** `payments/deals/[id]/cancel` le dit : « c'est ici, et seulement ici, qu'un
appel est déclassé — un remboursement fait dans Stripe n'y touche jamais, il dit qu'un
mouvement d'argent a eu lieu, pas que la vente n'a pas eu lieu ». `calls.revenue` reste
la trace de ce qui a été déclaré, `deals` reste la source du cash. Ne pas « corriger »
les trois autres écrivains de `deals.status = 'canceled'` (`declare-refund`,
`calls/[id]/rapport`, et `lib/dealStatus.ts` pour le chemin automatique) en croyant
réparer un oubli de partition.

✅ **La conséquence sur le taux de closing est TRANCHÉE (Chris, 2026-09-12) : une vente
annulée n'est plus un closing.** La règle vit dans `callsAVenteEntierementAnnulee`
(`lib/salesCallStats.ts`), écrite une seule fois et lue par les DEUX écrans qui affichent
un taux — le tableau de bord coach via `computeSalesCallStats`, et la Vue générale de
« Mes stats » qui fait son propre découpage par opportunité.

⚠️ **Elle a besoin de `deals.call_id`.** Un appelant qui ne fournit pas cette colonne
obtient le comptage d'avant, en silence : c'est un repli délibéré (certains appelants
n'ont qu'une liste de calls), mais tout écran qui affiche un taux de closing doit la
passer. `fetchDealsForStats` la sélectionne.

⚠️ **Trois faux négatifs sont écartés par construction, et chacun a son test** : un appel
sans AUCUN deal compte encore (rapport interrompu avant la création de la vente — le
drapeau est alors la seule trace, même repli que le garde de `client/pipeline`) ; un appel
portant une vente annulée ET une vente vivante compte encore ; un deal sans `call_id`
(upsell) ne disqualifie aucun appel.

⚠️ **Ce qui n'est PAS traité, faute de cas réel** : les compteurs « Closés » par contenu,
par source et par jour de « Mes stats » (une vingtaine de `filter(c => c.deal_closed)`)
comptent toujours les ventes annulées, alors que le REVENU de ces mêmes tableaux les
exclut déjà (`if (!d.call_id || d.status === 'canceled') continue`). L'écart est
antérieur à ce chantier et vaut 0 aujourd'hui — 0 deal `canceled` en base. **Le signal de
déclenchement est la première vente réellement annulée** : ce jour-là, un tableau affichera
une ligne « 1 closé, 0 € ».

⚠️ **Une surveillance dont le cas visé n'est JAMAIS survenu n'a jamais rien détecté.**
Avant de croire une alerte, compter sur toute la base les occurrences de chaque cas
qu'elle prétend distinguer. Ici : 0 call sans aucun deal, 2 avec des deals tous annulés.
La requête tenait en dix lignes et a renversé le diagnostic.

`ventes_sante_contenu` compare les DEUX lectures de l'attribution d'une vente :
`deals.first_touch_content_id`, que lisent les **quatre routes de paiement**
(`payments/by-origin`, `payments/chain`, `payments/deals/[id]/amount` et `/terms`), et
le contenu que porte le **call**, que Business micro recalcule via `contenuConversion()`
— `utm_content`, puis repli sur `prospect_links.content_id`. La colonne est une copie
figée à la création du deal ; tant qu'elle concorde personne ne voit rien, et le jour où
elle diverge le même euro est crédité à deux contenus différents selon l'écran. C'est le
mécanisme d'`instagram_leads` : une copie que personne ne confronte à sa source finit par
mentir. ⚠️ `vente sans rendez-vous` n'est **pas** une anomalie — un upsell n'a aucun call,
donc aucun contenu à créditer, et il est exclu de Business micro pour cette raison.

`ventes_sante_date` vérifie que `deals.signed_at` porte la **tenue d'un rendez-vous**
du prospect, et non l'instant de saisie du rapport — le défaut corrigé le 2026-09-01,
où quatre ventes portaient 20/08 21h47 pour un rendez-vous du 19/08 13h30.

⚠️ Elle ne réimplémente **pas** la règle. Celle-ci vit dans `dateDeVente`
(`lib/callSeries.ts`) et suppose de reconstruire les chaînes d'opportunité ; la réécrire
en SQL créerait une troisième version qui dériverait des deux autres en silence. La vue
teste une **conséquence** : quel que soit le rendez-vous que la règle choisit,
`signed_at` doit tomber pile sur la tenue de l'un d'eux. Un instant de saisie ne tombe
jamais pile sur un créneau. `vente sans rendez-vous` et `rapportée avant le rendez-vous`
ne sont **pas** des anomalies.

**Dette à lever, pas maintenant.** Business micro et Funnel & Calls recalculent la date
au lieu de lire la colonne, parce qu'elle était fausse. Elle ne l'est plus. Quand cette
vue aura tourné un moment sans alerte, les deux recalculs deviendront supprimables au
profit d'une simple lecture de `signed_at`. Tant que ce délai n'est pas écoulé, garder
les deux versions est une sécurité, pas une redondance.

⚠️ **`analytics_daily_snapshots` mélange TROIS natures, et deux noms de colonnes
mentent.** Relevé le 2026-09-01 en préparant Stats Clients :

| Colonnes | Nature réelle | Agrégation correcte |
|---|---|---|
| `ig_followers`, `yt_subscribers` | niveau (photo du jour) | **dernière** valeur non nulle de la fenêtre |
| `ig_views`, `shortio_human_clicks`… | flux quotidien | **somme** |
| `calls_booked`, `calls_honored`, `deals_closed`, `revenue` | **cumul depuis le début** | **dernière** valeur, ou `last − first` pour l'écart |
| `ig_reach` | dédupliqué par Meta | **aucune** — la somme compte deux fois la même personne |

`poll-leads` écrit les quatre colonnes business avec `calls.filter(...).length` sur tout
l'historique, réécrit à chaque passage. Preuve en base sur `a02e5927` : `revenue` vaut
`12000.00` **tous les jours** du 20 au 31 août. Les sommer sur 30 jours donnerait
360 000 € au lieu de 12 000. Leur nom suggère un flux, leur contenu est un cumul.

Deuxième raison de ne pas les lire : elles dérivent de `calls.revenue`, alors que depuis
le 2026-08-20 tous les écrans lisent `deals`. Pour les calls, les ventes et le cash, aller
aux tables sources avec les règles de `docs/perimetre-stats-referentiel.md`.

`mrr` n'est **jamais** écrite (0 ligne renseignée sur 265) — ne pas la lire non plus.

`clics_sante_redirection` compare, par lien, les clics comptés par Short.io à ceux
comptés par la route `/r/` qui pose le Click ID sur les liens Calendly **partagés**
(`docs/click-id.md`). ⚠️ Elle détecte une **panne**, pas une parité exacte : les deux
filtres à robots ne classeront jamais identiquement, et prétendre à l'égalité
produirait une alerte permanente. `lien non redirige` n'est **pas** une anomalie — la
réécriture n'a pas encore atteint ce lien. C'est aussi cette vue qui rend un échec
d'écriture non silencieux : on ne peut pas journaliser une panne de base dans la base.

⚠️ Sur les vues de santé, `etat <> 'ok'` n'est **pas** un filtre d'anomalie :
`non_connectee` et `integration deconnectee` disent seulement que l'intégration n'est
pas branchée. Les chercher comme des pannes fait remonter 23 faux positifs.
