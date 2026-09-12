# Handoff — ce qui reste de l'audit Stats Clients vs Mes Stats

> ## ÉTAT AU 2026-09-06, 19 h 30 — CLOS. Les sept divergences sont fermées.
>
> ⚠️ **Le lot A a été tranché À L'INVERSE de ce que ce document prescrivait.** Lire la
> section « Lot A » avant toute chose : quelqu'un qui appliquerait la consigne d'origine
> (`and deleted_at is null`) défferait le travail sans s'en rendre compte.

**Origine** : audit de divergence entre Stats Clients (portefeuille coach) et Mes Stats,
2026-09-06. **Sept divergences trouvées, sept fermées.**

| # | Sujet | État |
|---|---|---|
| 1 | Leads comptés sur deux règles différentes | ✅ `5976ba0` |
| 2 | Trous de collecte affichés « 0 » | ✅ `f09eb1d` — lot B, voir ci-dessous |
| 3 | Règle d'annulation recopiée sans `declined` | ✅ `5e3644b` |
| 4 | Cash : trésorerie contre cohorte | ✅ `f77fe82` + Revenus refait |
| 5 | « Calls bookés » : créneaux contre affaires | ✅ `4dba987` |
| 6 | Publications : posts supprimés | ✅ `dd0003c` + `77bf7b2` — **sens inversé**, voir lot A |
| 7 | Clics : carte morte depuis le 28 août | ✅ `b216a82` |

---

## Lot A — un post Instagram supprimé compte encore dans Mes Stats

### Le fait

Les deux écrans lisent la **même table**, `analytics_ig_posts_history`, mais pas avec les
mêmes filtres :

| Lecture | `deleted_at` | `archived_at` |
|---|---|---|
| `stats_clients_series` (Stats Clients) | filtré | filtré |
| `get_ig_posts_history` (Mes Stats) | **non filtré** | filtré |

Un post supprimé sur Instagram reste donc compté dans le KPI « Publications » de Mes
Stats, et disparaît de celui de Stats Clients. Même mot, deux nombres.

### L'ampleur, mesurée le 2026-09-06

`analytics_ig_posts_history` : **17 posts distincts, 0 supprimé**, 15 archivés, 4 profils.

**L'écart est donc nul aujourd'hui.** Il apparaîtra au premier post effacé par un élève.
C'est la même nature que la divergence n° 3 (`declined`) : une règle appliquée d'un côté
et pas de l'autre, sans conséquence visible tant que le cas ne se présente pas — donc
rien ne la signalera avant qu'elle ne fasse un faux chiffre.

### ⚠️ CE QU'IL NE FAUT PAS FAIRE — la consigne d'origine était fausse

> **Ce document disait : « ajouter `and deleted_at is null` à `get_ig_posts_history` ».**
> **C'est l'inverse qui a été fait, et il ne faut pas y revenir.**

Le filtre a été **retiré de `stats_clients_series`** (et de la vue
`derniere_publication_par_profil`, qui alimente le signal « ne publie plus »), pour
aligner les deux écrans sur le comportement de Mes Stats.

**Pourquoi ce sens-là.** La règle était déjà écrite, à l'endroit qui POSE le drapeau —
`supabase/functions/_shared/ig-posts.ts` : « on le marque `deleted_at` plutôt que de
l'effacer : l'historique de stats (analytics, rapports passés) doit rester intact, seul
"Gérer mes liens" doit filtrer ces posts ». C'est donc `stats_clients_series` qui s'était
écartée d'une règle existante, pas Mes Stats. Ce handoff proposait de corriger le
mauvais côté.

**La décision produit, prise par Chris le 2026-09-06 :**

1. Un post supprimé **compte toujours** dans « Publications ». Ce compteur mesure une
   activité passée, pas un inventaire présent — sinon un élève fait baisser ses
   statistiques de juin en faisant du ménage en septembre, et un rapport imprimé la
   veille cesse de correspondre à l'écran du lendemain.
2. Il **reste dans « Top contenus »**, avec une pastille « supprimé » et son lien
   désactivé : il a réellement produit cette portée, et parfois des rendez-vous.
3. Le revenu qui lui est attribué ne disparaît donc jamais d'un total.

**Ce que le point 2 a exigé** (`77bf7b2`) : `deleted_at` existait en base mais
`get_ig_posts_history` ne le RENVOYAIT pas — l'écran ne pouvait pas distinguer un post
supprimé d'un autre. La RPC l'expose désormais, et continue de ne pas le filtrer.

⚠️ **Deux pièges rencontrés en le faisant**, notés dans la migration :
`create or replace` ne suffit pas pour ajouter une colonne à un `returns table` (il faut
drop + create) — et à la recréation, Supabase re-accorde `execute` à `anon` par ses
privilèges par défaut. `revoke ... from public` ne l'enlève PAS : `anon` est un rôle,
`PUBLIC` en est un autre. Voir `docs/sante-plateforme.md` (`264d5fe`) pour le critère de tri des
fonctions réellement exposées.

**Aucun chiffre n'a bougé** : 0 post porte `deleted_at` sur 972 lignes. Comme la
divergence n° 3 (`declined`), cet écart ne se signalera pas de lui-même — il se
manifestera le jour où il produira un faux chiffre, et ce jour-là personne ne fera le
lien avec la règle divergente.

⚠️ **Ce n'est pas qu'un compteur — décider avant d'écrire.** Cette RPC a **un seul
appelant** (`PageClientStats.tsx:9968`, dans `fetchSnapshot`) mais son résultat alimente
**deux choses** : le KPI « Publications » ET la **liste des top contenus**. Ajouter le
filtre fait donc aussi disparaître les posts supprimés de cette liste.

C'est probablement ce qu'il faut — un contenu qui n'existe plus n'a pas à figurer dans un
classement de performance, et son lien serait mort. Mais c'est un choix produit :
**le poser à Chris en une phrase avant d'appliquer**, plutôt que de le décider par effet
de bord d'une correction de compteur.

### Ce qu'il ne faut PAS faire

**Ne pas toucher à YouTube.** `analytics_yt_videos_history` n'a **ni `deleted_at` ni
`archived_at`** — vérifié en base le 2026-09-06, les colonnes n'existent pas. Une vidéo
supprimée sur YouTube reste donc comptée des deux côtés, et l'isolation par archivage lors
d'une bascule de compte ne s'y applique pas non plus. C'est une limite de schéma, pas une
divergence : les deux écrans se comportent identiquement. La corriger serait une migration
de schéma sur une table alimentée par un cron — un autre chantier, à ne pas ouvrir ici.

`ig_stories` a `archived_at` mais pas `deleted_at`, et les deux lectures la filtrent
pareil. Rien à faire.

---

## Lot B — les cinq cartes qui lisent un total pré-calculé — ✅ FAIT (`f09eb1d`)

**Détail complet dans `docs/handoff-trous-de-collecte.md`**, passé à CLOS. Ne pas
dupliquer ici — s'y reporter.

⚠️ **L'inventaire ci-dessous était incomplet** : il annonçait deux chemins de données, il
y en avait **quatre** (route API, totaux de période courante, périodes passées, et la
branche « 7 jours » qui somme la série à la main). N'en corriger qu'une partie aurait fait
dire à la MÊME carte « Non mesuré » sur un mois et « 0 » sur celui d'à côté.

Résumé en trois lignes : « Reach Instagram » et « Vues YouTube » de la Vue générale, plus
« Likes », « Commentaires » et « Partages » de l'onglet YouTube, lisent hors du mode
7 jours un total pré-calculé (`reach30d`, `views30d`, `likes30d`, `comments30d`,
`shares30d`) typé `number` et jamais `null`. Leur test `v !== null` est donc toujours vrai
et « Non mesuré » ne peut pas s'afficher.

⚠️ Le piège de méthode, qui vaut au-delà de ce lot : **TypeScript énumère les valeurs
devenues nullables, il ne signale pas celles qui auraient dû l'être.** `number !== null`
est une comparaison légale qui vaut toujours vrai. C'est pour ça que la correction du
2026-09-06 a trouvé ses 13 consommateurs et manqué ces trois cartes-là.

---

## Lot C — ménage — ✅ FAIT (`333be7a`), feu vert donné par Chris le 2026-09-06

Quatre colonnes de `analytics_daily_snapshots` n'ont **plus aucun lecteur ni aucun
écrivain** : `shortio_clicks`, `shortio_human_clicks`, `shortio_top_countries`,
`shortio_top_referrers`.

Leur écriture a été supprimée le 2026-08-28. Leur dernier lecteur — `stats_clients_series`
— a été rebranché sur la table vivante le 2026-09-06 (`b216a82`). Vérifié ce jour : les
trois RPC Short.io (`get_shortio_clicks_by_day`, `_by_url`, `get_shortio_links_agreges`)
lisent toutes `shortio_link_daily_snapshots`, aucune ne touche ces colonnes.

**Le geste recommandé par `docs/sante-plateforme.md`** (section « Personne ne lit cette colonne a une date
de péremption ») est de les supprimer : une colonne absente produit une erreur au premier
`select`, et c'est le seul signal qui ne se périme pas. C'est précisément ce qui a manqué
ici — la carte « Clics » du coach a affiché 550 clics pour un élève qui en avait 27,
pendant neuf jours, sans que rien n'alerte.

**Choix retenu : la suppression**, Chris ayant tranché « si on supprime directement c'est
le mieux pour le reste et la maintenance, je m'en fiche de l'historique tant que j'ai
celui d'août complet ».

⚠️ **Une affirmation de ce document était fausse, et la vérification l'a montrée avant
d'agir** : « la table vivante couvre la même période par lien ». Non —

| colonnes supprimées | 08/06/2026 → 28/08/2026 |
|---|---|
| `shortio_link_daily_snapshots` | à partir du **19/07/2026** |

Un mois d'historique (8 juin → 8 juillet, 122 clics humains) n'existait donc nulle part
ailleurs. Perte acceptée en connaissance de cause, à la condition qu'août soit complet —
vérifié, 31 jours sur 31. Le backfill a été écarté pour une raison de fond : l'ancien
format est agrégé PAR JOUR ET PAR PROFIL, la table vivante est PAR LIEN. Il n'existe
aucun lien à qui attribuer ces clics, une recopie aurait donc inventé une ventilation.

---

## Rappels de méthode pour ces trois lots

- **Vérifier la branche et `git status` avant tout commit.** Plusieurs sessions
  travaillent en parallèle sur ce dépôt ; ne commiter que ses propres fichiers.
- **Chercher le symptôme, pas le remède.** Pour vérifier une correction transversale,
  chercher le motif défectueux — chercher le correctif ne montre que ce qui est déjà fait
  et confirme toujours ce qu'on croit déjà.
- **Ne jamais sommer les paiements à la main**, y compris dans une requête de contrôle :
  lire la vue `ventes_cash_net`. Elle reprend `lib/dealCash.ts` terme à terme.
- **Une migration se pose avec `apply_migration`**, sous le nom du fichier sans son
  horodatage, et le fichier du dépôt doit porter le même corps. `npm test` vérifie
  l'absence d'écart entre le registre et les fichiers.
