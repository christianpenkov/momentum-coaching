# Audit des métriques YouTube — 2026-08-20

Audit complet de l'onglet YouTube de « Mes Stats », métrique par métrique, en remontant
chaque chaîne API → base → affichage et en recoupant avec une réponse d'API réelle
(route `/api/youtube/test-metrics`, chaîne `UClE9wTnIhlE66XzSgmq0IpQ`).

---

## Ce qui était cassé

| # | Métrique | Défaut | Correction |
|---|---|---|---|
| 1 | **Watch time** | `Math.round(minutes / 60)` sur `estimatedMinutesWatched`, déjà en minutes → toute journée sous 30 min arrondie à **0**. Affichait 0 au lieu de ~82 min, depuis des mois, sur **3 chemins de code**. | Division supprimée dans `poll-leads`, `lib/yt-fetch.ts` et `app/api/youtube/stats`. Arrondi retiré aussi (colonne `numeric(12,2)`). Historique récupéré par backfill API. |
| 2 | **Conv. vue→sub** | Courbe générée par un sinus (`mockFromTotalYT`) à partir du taux global. | Calcul réel par jour : `subs_gained / views`. |
| 3 | **Watch time moyen** | Courbe simulée (`mockAroundAvgYT`), **et valeurs de secours inventées** : 45 s pour les Shorts, 480 s pour les longues, sans source. | 4 colonnes ajoutées, alimentées depuis la dimension `creatorContentType`. Les deux fonctions de simulation sont supprimées du projet. |
| 4 | **CTR miniature** | `'4,2%'` **codé en dur**, identique pour toutes les vidéos — alors que le vrai CTR était collecté depuis des mois et affiché correctement ailleurs sur la même page. | Lit `analytics_yt_videos_history.ctr` (ratio → ×100). `—` quand la donnée manque. |

**4 métriques auditées en profondeur, 4 problèmes trouvés.**

---

## Ce qui est vérifié exact

Comparaison base ↔ API sur 30 jours :

| Métrique | Base | API |
|---|---|---|
| Vues | 42 | 42 |
| Watch time | 20 min | 20 min |
| Abonnés gagnés / perdus | 0 / 0 | 0 / 0 |
| Likes | 2 | 2 |
| Commentaires | 3 | 3 |
| Partages | 5 | 5 |
| Total d'abonnés | 49 | 49 |
| Ventilation Shorts / longues | 26 / 16 vues | 26 / 16 |

---

## Trois fausses pistes — ne pas « corriger »

**`avg_view_pct` dépasse 100 %** (145 lignes, jusqu'à 113,98 %). **Ce n'est pas un bug.**

`averageViewPercentage` compare le temps réellement visionné à la durée de la vidéo. Sur
un Short, qui reboucle automatiquement, un spectateur peut voir 100 % de la vidéo **puis
recommencer** — le compteur dépasse alors 100 %. Un Short à 114 % signifie qu'en moyenne,
les spectateurs l'ont vu en entier plus un septième de plus.

C'est l'un des signaux les plus positifs que YouTube reconnaisse : l'algorithme l'interprète
comme un contenu addictif et élargit la diffusion. Le « hook de boucle » — terminer la
vidéo de façon à ce qu'elle enchaîne naturellement sur son début — est une technique
courante précisément pour ça.

Vérifié sur les données plutôt que supposé : **117 dépassements sur les Shorts**
(max 113,98 %) contre **28 sur les vidéos longues**, celles-ci plafonnées à 100,6 %. Une
vidéo longue ne reboucle pas, donc son dépassement se limite à une marge d'arrondi — la
répartition confirme l'explication.

**Ne pas plafonner cette valeur à 100 %** : ce serait détruire l'information la plus utile
de la métrique. Un Short au-dessus de 100 % est une réussite, pas une anomalie.

**14 vidéos sur 30 ont leurs champs de période à `null`.** Elles n'ont eu aucune vue **sur
la fenêtre de 30 jours**, et l'API n'émet alors pas de ligne pour elles. `null` est le bon
comportement — « pas de données sur cette fenêtre », pas « zéro vue ».

⚠️ **Cela ne veut PAS dire que ces vidéos ne sont plus suivies.** Leur total lifetime
continue d'être mis à jour chaque jour : `awrGQJIdthA` est passée de 2 011 à 2 012 vues,
`uzbDb_yehI8` de 49 à 50, sur la même période. Et une vidéo réapparaît dans les métriques
de période dès qu'elle reçoit une vue — `awrGQJIdthA` alterne : 37 jours avec données de
période, 29 sans. Le `null` est un état transitoire, jamais un abandon du suivi.

**`views` (1 970) ≠ `views_period` (13).** Deux mesures différentes, toutes deux justes :
total depuis la publication contre vues des 30 derniers jours.

---

## Métriques indisponibles sur cette chaîne

Trois requêtes échouent, et **aucune n'alimente Mes Stats** :

- `impressions` / `impressionClickThroughRate` → exige le scope `yt-analytics-monetary`,
  donc une chaîne monétisée. Celle-ci ne l'est pas.
- `videoThumbnailImpressionsClickRate` → « query is not supported » sur cette chaîne.
- `relativeRetentionPerformance` avec `dimensions=video` → non supporté ; **fonctionne**
  avec `dimensions=elapsedVideoTimeRatio` (100 points réels), mais mesure la rétention
  *à l'intérieur* d'une vidéo, pas jour par jour.

Le CTR affiché passe par l'API **Reporting** (rapport `channel_reach_basic_a1`, table
`youtube_video_ctr`), qui fonctionne sans monétisation.

---

## Deux pièges rencontrés

**Ne jamais reconstituer une valeur que l'API peut donner.** Le premier backfill
recalculait `watch_time = vues × durée_moyenne` : il a donné **32 minutes au lieu de 20**.
`averageViewDuration` est arrondi à la seconde, et l'erreur s'amplifie sur petits volumes
(4 minutes d'écart sur une seule journée à 14 vues). Le backfill correct redemande à l'API.
La sauvegarde préalable a permis d'annuler proprement.

**Tester la combinaison d'API sur la vraie chaîne avant d'en dépendre.** La documentation
annonçait `creatorContentType` combinable avec `day` — vrai, vérifié. Mais deux autres
combinaisons documentées le même jour renvoient « query is not supported » sur cette
chaîne. La doc ne suffit pas.

---

## Rétention par vidéo — auditée, chaîne saine

Seule métrique de cet onglet dont la chaîne était correcte de bout en bout :

- **Requête** : `audienceWatchRatio` par `elapsedVideoTimeRatio`, la seule combinaison
  de rétention que cette chaîne accepte (vérifié : `dimensions=video` est refusé).
- **Fenêtre** : depuis la publication de la vidéo, pas 30 jours — correct pour une
  rétention, qui doit couvrir toute la vie du contenu. Repli à 365 jours si la date de
  publication manque, cas défensif jamais atteint (elle est toujours transmise).
- **Tri** : `sort=elapsedVideoTimeRatio` demandé à l'API **et** re-trié côté serveur.
- **Affichage** : ratio converti en secondes réelles quand la durée est connue, en
  pourcentage sinon.

## Vues engagées — ajoutées

`engagedViews` distingue les spectateurs qui ont **vraiment regardé** d'une vue comptée
dès les premières secondes. Métrique Shorts introduite par YouTube en 2025, disponible
sur cette chaîne (537 vues engagées sur 2 012 pour `awrGQJIdthA`, soit 27 %).

Ajoutée à la modale de chaque vidéo, avec son ratio. **Sans appel supplémentaire** :
`views` et `engagedViews` ont été ajoutés à la requête de résumé qui existait déjà.

## Mots-clés de recherche — vide, et c'est normal

Colonne `yt_search_keywords` créée et collectée, mais l'API renvoie un tableau vide
malgré 27 vues venant de la recherche.

**Ce n'est pas un bug.** La documentation Google est explicite : « pour garantir
l'anonymat des spectateurs, les valeurs de certaines dimensions ne sont renvoyées que si
une métrique de la même ligne atteint un certain seuil » et « les termes de recherche qui
génèrent très peu de vues n'apparaîtront pas dans les rapports ». Les 27 vues sont
réparties sur trop de termes pour qu'aucun n'atteigne le seuil.

Même mécanisme que la démographie. Le bloc affiche un message explicite plutôt qu'un vide
inexpliqué.

---

# Session du 2026-08-21 — affichage, unités, CTR

Suite de l'audit, centrée sur ce que la page **montre** plutôt que sur ce qu'elle collecte.

## CTR miniature — la correction du 20 août était insuffisante

Le 20 août, le CTR codé en dur (`'4,2%'`) a été remplacé par la vraie colonne. **Mais la
vraie colonne est trompeuse pour les vidéos publiées avant le démarrage du suivi.**

L'API Reporting ne collecte qu'à partir de la création du job (ici le **29 mai 2026**).
Une vidéo antérieure n'a en base que ses impressions résiduelles :

| Vidéo | Publiée | Vues totales | Impressions en base | Couverture |
|---|---|---|---|---|
| `awrGQJIdthA` | 2025-06-02 | 2 012 | 113 | **0,1 %** |
| `oM7qrjjHvlw` | 2025-06-14 | 1 972 | 593 | 0,5 % |
| `DABmJUjKEcE` | 2025-06-14 | 1 731 | 102 | 0,2 % |

Le « CTR » de 1,77 % affiché sur la première ne mesurait pas la performance de sa
miniature : il mesurait un fond de traîne sur un échantillon minuscule.

**Les 30 vidéos de la chaîne sont antérieures au job** (la plus récente date de juillet
2025). Les 58 CTR affichés étaient donc tous trompeurs.

**Correction** : `get_yt_videos_history` annule le CTR à la lecture quand
`published_at < job_created_at` (migration `20260821180000`). La règle vit dans la RPC et
non dans les composants — un écran sur deux appliquait déjà le test, l'autre non, exactement
le motif de divergence corrigé partout ailleurs dans cet audit. La donnée brute reste en
base si YouTube ouvre un jour l'historique.

L'affichage montre **`N/D`** grisé avec l'explication au survol, et non un tiret muet ni
une case absente : une absence expliquée informe, une case vide ressemble à un oubli.

⚠️ **Corrige une affirmation de la section « Métriques indisponibles »** ci-dessus : le CTR
via l'API Reporting fonctionne sans monétisation, c'est exact, mais **uniquement pour les
vidéos publiées après la création du job**. Ce n'est pas une limite de monétisation, c'est
une limite de date de démarrage.

## Durées — un seul composant, `lib/duree.ts`

Le watch time était formaté à **trois endroits avec trois règles**. La carte affichait
« 0 min » pendant que l'axe du même graphique montrait « 40s ».

Pire : **deux fonctions `fmtSec` différentes cohabitaient dans le même fichier** — l'une
pour une durée écoulée (« 3m45s »), l'autre pour une position dans une vidéo (« 3:45 »).

`lib/duree.ts` expose désormais `dureeDepuisSecondes`, `dureeDepuisMinutes` et
`positionLecteur`. L'unité s'adapte pour que **deux valeurs proches ne tombent jamais sur
le même libellé** : un arrondi en minutes entières graduait « 1 min, 1 min, 1 min, 0 min,
0 min » sur une chaîne dont les journées vont de 0 à 16 minutes. Sous 3 minutes, on affiche
des secondes.

`lib/duree.test.ts` contient un test qui vérifie qu'aucune série de graduations ne produit
deux libellés identiques — le bug ne peut pas revenir sans faire échouer `npm test`.

## Zéro dans un graphique, zéro dans un KPI — deux questions différentes

Décision de Chris, appliquée aux courbes de moyennes (« Watch time moyen / vue »,
« Conv. vue→abonné ») :

- **Le graphique affiche 0** les jours sans vue. Une courbe continue se lit mieux qu'une
  nuée de points isolés.
- **Le KPI de période les exclut**. Il divise somme(watch time) par somme(vues) : un jour
  sans vue contribue 0 au numérateur *et* au dénominateur, donc ne dilue rien.

Le graphique montre le rythme, le KPI mesure la performance. Seuls les jours que YouTube
n'a **pas encore traités** restent des trous — la donnée n'existe pas, ce qui n'est pas la
même chose qu'un jour mesuré sans vue.

## Axe des abonnés nets — `domain` ne suffit pas dans Recharts

Trois tentatives ont échoué avant de trouver la cause réelle :

1. Domaine symétrique posé sur le `YAxis` → **sans effet visible**.
2. Marge proportionnelle de 20 % → gonflait l'axe à −24/+24 pour une pointe à 20.
3. Carte qui affichait « Pas de mouvement sur cette période » **à la place du graphique**
   dès que tous les jours valaient zéro — le cas normal sur une chaîne stable.

**Cause racine** : Recharts recalcule ses propres bornes « jolies » par-dessus le `domain`.
Il faut lui passer `ticks` explicitement. Les graduations sont construites **depuis zéro
vers l'extérieur**, sans quoi le pas ne retombe pas sur zéro (borne 101 graduait
« …−2, 31… » sans zéro).

Résultat : rien ne bouge → `−1 / 0 / +1`, puis l'échelle s'ouvre à l'amplitude réelle.

**Ne pas remettre de `ReferenceLine` sur zéro** : la `CartesianGrid` trace déjà une ligne à
chaque graduation. La superposer d'un trait plein `var(--border)` dessine une barre blanche
en travers du graphique.
