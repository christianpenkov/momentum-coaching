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

**`avg_view_pct` dépasse 100 %** (145 lignes, jusqu'à 113,98 %). **Ce n'est pas un bug** :
sur un Short, dépasser 100 % signifie que les spectateurs **rejouent** la vidéo, et c'est
l'un des signaux les plus positifs que YouTube reconnaisse. Vérifié par la répartition :
117 dépassements sur les Shorts (max 114 %) contre 28 sur les vidéos longues, plafonnées
à 100,6 % — soit une simple marge d'arrondi.

**14 vidéos sur 30 ont leurs champs de période à `null`.** Elles ont toutes plus d'un an
(444 à 578 jours) et n'ont eu aucune vue sur la fenêtre : l'API n'émet alors pas de ligne.
`null` est le bon comportement — « pas de données », pas « zéro vue ».

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

## Métriques non auditées

Sources de trafic, appareils, démographie, mots-clés de recherche, rétention par vidéo.
Elles s'affichent, mais leur chaîne n'a pas été remontée jusqu'à l'API.

Deux métriques réelles disponibles et **inexploitées** : `engagedViews` (537 vues engagées
sur 2 012 pour une vidéo — combien ont vraiment regardé) et la courbe de rétention par
vidéo (100 points via `elapsedVideoTimeRatio`).
