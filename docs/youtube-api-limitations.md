# YouTube Analytics API — Limitations connues

Basé sur des tests réels effectués le 2 août 2026 contre YouTube Analytics API v2 (`youtubeanalytics.googleapis.com/v2/reports`), et sur la documentation officielle Google for Developers (developers.google.com/youtube/analytics).

---

## "% ont continué de regarder" (Shorts) — non disponible via l'API publique

YouTube Studio affiche nativement, pour chaque Short, un KPI "X% Ont continué de regarder" (swipe-away rate inversé — le % de spectateurs qui n'ont pas immédiatement zappé le Short dans le fil). Ce chiffre n'est **pas reproductible** via l'API YouTube Analytics publique.

**Deux pistes testées, aucune ne correspond :**

1. **Dernier point de la courbe de rétention** (`audienceWatchRatio` par `elapsedVideoTimeRatio`, au ratio le plus proche de 1.0). Testé sur un Short réel (18s, `videoId=vMCX8srWkjo`) : le dernier point donne **33,1%**, contre **28,5%** affiché par Studio pour la même vidéo, sur la même fenêtre "depuis la mise en ligne". Écart de 4,6 points — trop significatif pour être une simple différence d'arrondi ou de fenêtre temporelle. Cause probable : `audienceWatchRatio` mesure la rétention **pendant** le visionnage (peut dépasser 100% en cas de rewatch, confirmé en tête de courbe : 130% sur ce même test), alors que le KPI Studio mesure le comportement **avant même de commencer à regarder** (swipe immédiat dans le fil Shorts) — deux moments différents du parcours spectateur, pas la même métrique.

2. **Metrics `shortsViews`/`shortsSwipeAways`** — n'existent pas. Vérifié trois fois : absentes de la liste complète des metrics (developers.google.com/youtube/analytics/metrics), absentes de la liste complète des dimensions, aucune trace dans une recherche web ciblée. Le concept "swipe-away rate" existe bien dans YouTube Studio (confirmé par plusieurs sources tierces), mais n'est associé à aucun nom de metric API documenté par Google.

**Ce qui existe côté API, sans donner ce chiffre précis :**
- `creatorContentType=SHORTS` : dimension documentée pour filtrer les metrics existantes (vues, rétention, etc.) par type de contenu — ne donne pas le swipe-away rate lui-même.
- `insightTrafficSourceType=SHORTS` : indique qu'un spectateur est arrivé en swipant depuis le Short précédent — une source de trafic, pas un taux de rétention au niveau feed.

**Conclusion :** ce KPI est propriétaire à l'interface YouTube Studio, calculé en interne par Google sur des données (impressions dans le fil Shorts) non exposées via l'API publique aux développeurs tiers. Ne pas retenter de le reproduire sans revérifier d'abord si Google a documenté une nouvelle metric à ce sujet — vérifier `developers.google.com/youtube/analytics/metrics` et `.../dimensions` en premier lieu.

**Code concerné :** `app/api/youtube/video-retention/route.ts` — aucune tentative d'implémentation n'a été laissée dans le code (testé via un champ de debug temporaire, retiré après vérification).
