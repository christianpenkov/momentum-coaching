# Instagram Graph API — Limitations connues

Basé sur des tests réels effectués le 31 juillet et 1er août 2026 contre l'API graph.instagram.com v22.0, et sur la documentation officielle Meta for Developers (developers.facebook.com/docs/instagram-platform).

---

## Durée d'un Reel — non disponible

Aucun champ ni métrique de l'API Instagram Graph ne donne la durée réelle du fichier vidéo d'un Reel. Testé et confirmé en direct sur l'API :

- `GET /{media-id}?fields=video_duration` → `IGApiException` : "Tried accessing nonexisting field (video_duration)"
- `GET /{media-id}?fields=video_data` → même erreur, champ inexistant
- `GET /{media-id}?fields=duration` → même erreur

Confirmé aussi par la doc officielle : la référence complète de l'objet [IG Media](https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/) (29 champs documentés) ne contient aucun champ de durée. La référence complète des [IG Media Insights](https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights/) (25 métriques) non plus.

**Conséquence :** le "taux de complétion" (temps de visionnage moyen ÷ durée totale × 100) est structurellement incalculable — on a le numérateur (`ig_reels_avg_watch_time`) mais jamais le dénominateur. Les stats "Durée" et "Complétion" ont été retirées de l'UI (`PageClientStats.tsx`) plutôt que d'afficher un `—` qui laisse croire à un bug corrigeable.

**Solution existante si on veut vraiment cette donnée un jour :** extraire la durée soi-même côté serveur via `ffprobe`/`ffmpeg` sur le fichier `media_url`. Chantier d'infra non trivial (téléchargement du fichier, exécution ffmpeg dans l'Edge Function Deno) — pas fait à ce jour.

---

## Rétention des insights — 2 ans maximum

Confirmé par la doc officielle Meta (`instagram-media/insights`) : *"Metrics data is stored for up to 2 years."*

Un post publié il y a plus de 2 ans peut avoir toutes ses métriques (`reach`, `saves`, `shares`, `views`, `total_interactions`) qui reviennent `null` — ce n'est pas un bug de collecte, Meta ne stocke tout simplement plus la donnée.

Nuance additionnelle : les métriques **compte/user** (niveau profil, pas média) ont une fenêtre différente — *"User Metrics data is stored for up to 90 days"* d'après une autre page Meta. À garder en tête si un endroit du code s'appuie sur des insights compte au-delà de 90 jours.

**Comment le reconnaître côté produit :** si `published_at` du post a plus de 2 ans ET que `reach`/`views` sont `null`, c'est très probablement cette limite Meta plutôt qu'un échec de collecte — d'où le badge ajouté dans `PageClientStats.tsx` (voir section suivante).

---

## Perte de groupe sur les appels `/insights`

Un appel groupé `metric=a,b,c` sur `/insights` échoue **entièrement** si Meta refuse ne serait-ce qu'une seule métrique du groupe (`d.error` non-null, aucune donnée récupérable même pour les métriques qui auraient individuellement répondu). C'est le cas fréquent avec des posts proches de la limite des 2 ans.

**Fix appliqué (`ig-posts.ts`, fonction `safeInsight`/`safeInsights`) :** chaque métrique est demandée dans un appel séparé, pour isoler les échecs — une métrique refusée ne fait plus perdre les autres.

---

## Métriques par post — noms confirmés fonctionnels

Toutes testées en production avec de vraies données (reach=1993, views=3036, avg_watch_time_ms=6236, skip_rate=9.2, etc.) :

| Métrique | Endpoint | Disponible pour |
|---|---|---|
| `reach` | `/insights` | Tous types |
| `saved` | `/insights` | Tous types |
| `shares` | `/insights` | Tous types |
| `views` | `/insights` | Tous types |
| `total_interactions` | `/insights` | Tous types |
| `ig_reels_avg_watch_time` | `/insights` | REELS uniquement |
| `ig_reels_video_view_total_time` | `/insights` | REELS uniquement |
| `reels_skip_rate` | `/insights` | REELS uniquement |
| `follows` | `/insights` | Non-REELS uniquement (jamais demandé sur un Reel — comportement actuel du code, pas une limite Meta confirmée) |
| `profile_visits` | `/insights` | Non-REELS uniquement (idem) |

---

## `profile_views` — déprécié, non disponible

Testé le 2 août 2026 sur `graph.instagram.com/v22.0` (flow Instagram business login direct, sans Page Facebook liée) : `metric=profile_views` retourne systématiquement `{"data": []}`, sans erreur explicite.

Confirmé en isolant la cause : un appel groupé `metric=reach,profile_views` retourne les données de `reach` normalement (30 jours de valeurs réelles) mais **aucune trace de `profile_views`** dans la réponse — ni erreur, ni entrée vide, la métrique est simplement absente du tableau `data`. Meta filtre silencieusement les métriques invalides d'un groupe plutôt que de faire échouer toute la requête (comportement différent de la "perte de groupe" décrite plus haut, qui elle renvoie une erreur explicite).

**Cause confirmée :** `profile_views` a été déprécié dans Instagram Graph API v22.0, remplacé officiellement par `views`, `reach`, `follower_count`, `reposts` — aucun de ces remplaçants ne couvre le même concept ("nombre de visites du profil"). Il n'existe pas d'équivalent 1:1 disponible sur cet endpoint pour ce type de compte.

**Conséquence :** le champ `profileViews30d` (`app/api/instagram/stats/route.ts:285`) reste hardcodé à `0` — c'est correct en l'état, pas un bug à corriger tant que Meta ne réintroduit pas une métrique équivalente. Ne pas retenter de brancher `profile_views` sans revérifier d'abord la doc Meta à jour.

**Option écartée, à reconsidérer seulement si Meta change la donne — flow "Page Facebook liée" :**

Un flow OAuth alternatif existe côté Meta : lier le compte Instagram à une Page Facebook (`graph.facebook.com`, scope `pages_show_list`, champ `instagram_business_account` sur la Page) au lieu du flow direct actuel (`instagram.com/oauth/authorize`, `graph.instagram.com`). Certaines sources suggèrent que `profile_views` pourrait encore être exposé sur ce flow — **non vérifié empiriquement**, à tester en premier avant tout autre travail si repris un jour.

Coût estimé si repris (évalué le 2026-08-02, avant tout test empirique du flow alternatif) :
- **Réécriture de l'auth Instagram** : ~67 fichiers dépendent du flow actuel (`ig_account_id` direct + token `graph.instagram.com`), dont `lib/ig-fetch.ts`, `app/api/oauth/instagram/{route,callback}`, `app/api/webhooks/instagram/route.ts`, les Edge Functions `poll-leads`/`poll-stories`. Le token change de nature (token Page vs token IG direct), la clé de résolution webhook (`entry.id` ↔ `ig_account_id`) doit être réévaluée, le refresh token fonctionne différemment (`fb_exchange_token` vs `ig_exchange_token`).
- **Reconnexion obligatoire** : tous les comptes déjà connectés en flow direct devraient tout refaire (nouveau scope, nouveau token, réabonnement webhook).
- **Friction onboarding** : chaque coach/élève devrait en plus lier son compte Instagram à une Page Facebook (créer la Page si besoin) avant de connecter Momentum — étape supplémentaire souvent confuse pour un utilisateur non-technique.
- **Gain incertain** : même ce flow pourrait avoir la même dépréciation (non testé) — risque de refaire tout ce travail pour rien.

**Verdict au 2026-08-02 :** coût/bénéfice jugé mauvais pour un seul KPI, chantier abandonné. Si repris un jour, commencer impérativement par un test empirique isolé (une route de debug comme `test-profile-views/route.ts` mais avec un token Page Facebook) avant d'engager la réécriture.

---

## Breakdown `follow_type` — incompatible au niveau média

`breakdown=follow_type` sur l'insight `reach` fonctionne au **niveau compte** (`GET /{ig-user-id}/insights?metric=reach&metric_type=total_value&breakdown=follow_type&period=days_28`) mais est rejeté au **niveau média** :

```
GET /{media-id}/insights?metric=reach&breakdown=follow_type
→ IGApiException code 100 : "Incompatible breakdowns (follow_type) for metric (reach)"
```

**Conséquence :** impossible d'obtenir un vrai "reach abonnés" par post individuel — seulement l'agrégat compte sur la fenêtre glissante de 28 jours (`analytics_daily_snapshots.ig_reach_follower`/`ig_reach_non_follower`, calculé dans `route.ts`). La carte "Followers reach rate" a été retirée du modal de détail par post pour cette raison (aucune formule fiable disponible à ce niveau).
