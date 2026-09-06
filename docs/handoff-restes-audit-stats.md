# Handoff — ce qui reste de l'audit Stats Clients vs Mes Stats

**Origine** : audit de divergence entre Stats Clients (portefeuille coach) et Mes Stats,
2026-09-06. **Sept divergences trouvées, cinq fermées.** Ce document porte les deux qui
restent, plus un ménage optionnel.

| # | Sujet | État |
|---|---|---|
| 1 | Leads comptés sur deux règles différentes | ✅ `5976ba0` |
| 2 | Trous de collecte affichés « 0 » | ⚠️ **lot B ci-dessous** |
| 3 | Règle d'annulation recopiée sans `declined` | ✅ `5e3644b` |
| 4 | Cash : trésorerie contre cohorte | ✅ `f77fe82` + Revenus refait |
| 5 | « Calls bookés » : créneaux contre affaires | ✅ `4dba987` |
| 6 | Publications : posts supprimés | ⚠️ **lot A ci-dessous** |
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

### Ce qu'il faut faire

Ajouter `and deleted_at is null` à `get_ig_posts_history`, dans une migration.

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

## Lot B — les cinq cartes qui lisent un total pré-calculé

**Déjà décrit en détail dans `docs/handoff-trous-de-collecte.md`**, section « Ce qui reste
vraiment ». Ne pas dupliquer ici — s'y reporter.

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

## Lot C — ménage optionnel, demande le feu vert de Chris

Quatre colonnes de `analytics_daily_snapshots` n'ont **plus aucun lecteur ni aucun
écrivain** : `shortio_clicks`, `shortio_human_clicks`, `shortio_top_countries`,
`shortio_top_referrers`.

Leur écriture a été supprimée le 2026-08-28. Leur dernier lecteur — `stats_clients_series`
— a été rebranché sur la table vivante le 2026-09-06 (`b216a82`). Vérifié ce jour : les
trois RPC Short.io (`get_shortio_clicks_by_day`, `_by_url`, `get_shortio_links_agreges`)
lisent toutes `shortio_link_daily_snapshots`, aucune ne touche ces colonnes.

**Le geste recommandé par `AGENTS.md`** (section « Personne ne lit cette colonne a une date
de péremption ») est de les supprimer : une colonne absente produit une erreur au premier
`select`, et c'est le seul signal qui ne se périme pas. C'est précisément ce qui a manqué
ici — la carte « Clics » du coach a affiché 550 clics pour un élève qui en avait 27,
pendant neuf jours, sans que rien n'alerte.

⚠️ **Ne pas le faire sans l'accord explicite de Chris.** Supprimer des colonnes en
production est irréversible, et ces quatre-là portent encore de l'historique jusqu'au
28 août. Deux options à lui présenter :

- **Supprimer** — l'historique est perdu, mais il n'est plus lu par rien et la table
  vivante couvre la même période par lien.
- **Renommer `<nom>_abandonnee_20260828`** — l'historique reste, et le nom porte la date,
  donc plus personne ne peut s'y brancher par mégarde.

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
