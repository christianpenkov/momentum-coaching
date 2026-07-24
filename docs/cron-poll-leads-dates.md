# Cron poll-leads — comment les dates sont écrites

Référence pour tester/déboguer le cron Edge Function `supabase/functions/poll-leads/index.ts` (tourne toutes les 30 min via cron-job.org).

## Source de vérité unique (2026-07-07)

`isoDate()` et `fetchIgDayMetrics()` sont maintenant centralisées dans **`lib/ig-metrics-core.ts`** (fetch natif, aucun import npm). Ce module est utilisé par :
- Le bouton **Rafraîchir** (`app/api/instagram/refresh-today/route.ts`, via `lib/ig-fetch.ts` qui ré-exporte le module) — runtime Node.
- Le **cron** (`supabase/functions/poll-leads/index.ts`) — runtime Deno, qui ne peut pas importer un fichier hors de son dossier de déploiement. Le contenu de `ig-metrics-core.ts` y est donc **dupliqué manuellement** (voir le commentaire `⚠️` en tête du fichier Deno).

**Conséquence pratique : toute modification de la logique de fetch Meta (dates, métriques, bug fix) doit être faite dans `lib/ig-metrics-core.ts` PUIS recopiée dans le bloc équivalent de `supabase/functions/poll-leads/index.ts`, puis redéployée via `mcp__claude_ai_Supabase__deploy_edge_function`.** Oublier la resynchronisation fait revenir la divergence qu'on vient d'éliminer (ex : le bug de fuseau horaire n'était corrigé que d'un côté avant ce refactor).

Le bouton Rafraîchir et le cron font donc maintenant EXACTEMENT le même calcul de date et le même fetch Meta pour les métriques compte (reach/abonnés/engagement) — seule différence restante : le bouton n'appelle pas `snapshotIgPosts` (pas de mise à jour des posts individuels/thumbnails), qui reste une exclusivité du cron.

## Quelle date reçoit quelle métrique, à chaque passage du cron

À chaque exécution, dans `snapshotProfile()` :

| Métrique | Ligne écrite (`date`) | Fréquence réelle d'écriture | Notes |
|---|---|---|---|
| `ig_reach`, `ig_views`, `ig_profile_taps`, `ig_website_clicks`, `ig_follows_unfollows` | **hier** (`yesterday`) | à chaque run (mais valeur déjà stable dès le lendemain) | Jamais écrit sur "aujourd'hui" — ces métriques ne sont fiables qu'une fois la journée terminée. |
| `ig_followers`, `ig_following` | **hier** ET **aujourd'hui** | à chaque run | Reflète l'état ACTUEL du compte (pas une vraie métrique datée) — donc recopié aussi sur la ligne du jour même pour ne pas attendre le lendemain. Fix du 2026-07-06 (commit `c2c7996`). |
| `ig_accounts_engaged`, `ig_total_interactions` | **hier** ET **aujourd'hui** | à chaque run | Vrai appel Meta daté (`period=day`) sur les deux jours — PAS un recopiage comme `ig_followers`. Fix du 2026-07-07. Nécessaire depuis que `stats/route.ts` (vue "Période actuelle") lit 100% depuis la DB. |
| Posts individuels (`analytics_ig_posts_history`) | **hier** seulement | **une seule fois par jour** (guard : skip si une ligne existe déjà pour "hier") | Contrairement aux métriques ci-dessus, ne tourne pas à chaque passage cron — regarder `updated_at`/`snapshot_at` en DB pour savoir si le run du jour a eu lieu. |
| Short.io (clics) | hier + aujourd'hui | à chaque run | Aujourd'hui via `last_clicks` (stable), hier via l'API stats (finalisée). |
| YouTube | J-3 à J-1 (jamais aujourd'hui) | à chaque run | Les Analytics YouTube ont un délai de traitement de ~48h côté Google, jamais fiable le jour même. |
| Calls / Stripe | hier seulement | à chaque run | |

## Ce que "aujourd'hui" veut dire exactement

`isoDate(0)` calcule la date du jour en **heure de Paris** (`Intl.DateTimeFormat` avec `timeZone: 'Europe/Paris'`), pas en UTC brut.

**Bug corrigé le 2026-07-07** (déployé en v22) : avant ce fix, `isoDate()` utilisait `new Date().toISOString().split('T')[0]` — un calcul UTC pur. Entre 22h et minuit UTC (= 00h-02h heure d'été à Paris), "aujourd'hui" calculé par le cron correspondait en fait à la veille côté Paris → les métriques du jour s'écrivaient sur la ligne d'hier. Ce bug est corrigé pour toute date à partir de la v22.

## Pièges à connaître en testant

1. **Un like/interaction fait manuellement n'apparaît pas immédiatement** — il faut attendre le prochain passage cron (max 30 min), PAS cliquer sur "Rafraîchir" (qui n'appelle pas cette logique).
2. **Meta a un délai de propagation** sur `accounts_engaged`/`total_interactions` — même après le passage du cron, une interaction très récente (quelques minutes) peut ne pas encore apparaître dans la réponse Meta elle-même. Ce n'est pas un bug du cron.
3. **Pour vérifier ce qui a réellement été écrit et quand** : requêter `analytics_daily_snapshots` avec `updated_at`/`created_at`, comparer à l'heure du déploiement de la version en cours (`list_edge_functions` donne `updated_at` du déploiement) pour savoir si un run donné utilisait l'ancien ou le nouveau code.
4. **`total_interactions`/`accounts_engaged` comptent TOUT le compte** (posts, reels, stories, lives), pas seulement les posts/reels — confirmé par la description officielle Meta de la métrique. Le libellé UI "Interactions posts" est donc actuellement imprécis par rapport à ce qu'il affiche réellement.
