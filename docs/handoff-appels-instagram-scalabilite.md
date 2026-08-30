# Handoff — coût des appels Instagram à 40 comptes

Écrit le 2026-08-30, en clôture du chantier Business micro. Le sujet a été **volontairement
sorti** de ce chantier : il touche le cron, pas l'affichage.

## Le problème en un chiffre

`snapshotIgPosts` (`supabase/functions/_shared/ig-posts.ts`) interroge **un post à la fois,
une métrique à la fois**. Soit **8 appels HTTP par post**.

- Aujourd'hui : 15 posts × 8 × 4 profils = 480 appels par nuit. Ça tient.
- Cible : 40 élèves × 100 posts × 8 = **32 000 appels**, dans une Edge Function qui
  dispose de **150 secondes**. Ça ne tient pas, et pas d'un peu.

## Pourquoi c'est écrit comme ça — ne pas défaire sans comprendre

Le découpage par métrique est **une parade délibérée**, documentée dans le fichier :

> Un seul appel groupé (`metric=a,b,c`) perd **TOUTES** les métriques du groupe si Meta
> en refuse ne serait-ce qu'une seule — cas fréquent sur les posts les plus vieux
> (hors fenêtre de rétention, ou publiés avant le passage en compte pro).

Revenir à un appel groupé par post ferait donc perdre des métriques qui répondaient
très bien. C'est un vrai problème, pas une précaution.

## Comment YouTube s'en sort — le point de comparaison

Le cron YouTube (`poll-leads/index.ts`, ~ligne 1452) **groupe sur les deux axes** :

```
dimensions=video&filters=video==id1,id2,id3…&metrics=views,estimatedMinutesWatched,likes,…
```

Plusieurs vidéos **et** toutes leurs métriques en un appel. C'est ce qui a permis à
l'audit YouTube de passer d'une capacité de 4 élèves à 121.

## La piste, et pourquoi elle préserve la parade

Meta expose des **requêtes groupées** : jusqu'à **50 sous-requêtes dans un seul appel
HTTP**, chacune avec sa propre réponse et son propre code d'erreur.

C'est exactement la propriété que le découpage par métrique protégeait : **une métrique
refusée ne fait tomber qu'elle-même**. On garde donc une sous-requête par métrique, et on
en envoie 50 d'un coup.

**120 appels HTTP deviennent 3.**

- https://developers.facebook.com/docs/graph-api/batch-requests
- https://developers.facebook.com/docs/graph-api/making-multiple-requests

### La nuance à ne pas oublier

Le groupage règle le **temps**, pas le **quota** : chaque sous-requête compte toujours
dans les limites de Meta. À vérifier avant d'élargir le nombre de posts rafraîchis —
mesurer, ne pas supposer.

## Le second levier : la rotation

Rafraîchir **tout** chaque nuit n'a pas de sens : un post publié hier gagne des vues
toutes les heures, un post de février n'en gagne presque plus.

Proposition : **les 15 plus récents chaque nuit** (ils bougent) **plus une dizaine
choisis parmi les plus anciennement rafraîchis**, en rotation. Le coût par nuit reste
**constant**, que l'élève ait 20 posts ou 500. Avec 10 par nuit, 100 posts sont tous
revus en dix jours.

Rien de nouveau à stocker : `analytics_ig_posts_history.snapshot_date` donne déjà, par
post, la date du dernier rafraîchissement.

Même motif que la fenêtre d'auto-réparation Short.io : coût borné, rattrapage
automatique, zéro entretien.

## Ce qui a déjà été corrigé, ne pas le refaire

Le `limit=15` **n'est pas** une limite de l'API — l'edge `/media` renvoie jusqu'à
**10 000 médias** avec pagination par curseur. C'est notre garde-fou de coût, et il n'est
justifié nulle part : introduit le 2026-07-29 dans un commit portant sur un autre sujet.

Ce qui **était** faux et a été corrigé le 2026-08-30 (commit `2124d2c`) : le code
comparait cette liste de 15 à une fenêtre de **90 jours** pour décider quels posts avaient
été supprimés. Un élève publiant deux fois par semaine (26 posts en 90 jours) aurait vu
onze posts réels marqués supprimés. Et une réponse Meta vide marquait supprimés **tous**
les posts de 90 jours d'un coup.

La borne est désormais le post le plus ancien réellement renvoyé. **Si tu élargis le
`limit`, cette garde reste correcte** — elle s'adapte à ce que le fetch a couvert.

## Ce qui n'est PAS un problème

Les métriques d'un post sont **« lifetime »** — un cumul depuis sa publication, pas une
fenêtre glissante. Elles restent interrogeables indéfiniment. La rétention de 90 jours
porte sur les métriques de **compte**, pas sur celles des posts.

Et la vignette est **déjà pérennisée** : `getPermanentThumbnail` la copie dans le bucket
Supabase à la première collecte. Rien n'est perdu quand un post sort de la fenêtre.

## Avant de toucher au cron

- `npx deno check supabase/functions/_shared/ig-posts.ts`
- Déploiement **séparé obligatoire** — `git push` n'emmène pas les Edge Functions — et
  des **deux** fonctions qui importent ce module : `poll-leads` **et** `refresh-ig-posts`.
- Lire `docs/checklist-scalabilite.md` : chaque point y a trouvé un vrai défaut.
- Vérifier la fonction déployée **par le contenu du bundle**, jamais par `updated_at`
  (voir `AGENTS.md`, « Vérifier qu'une Edge Function tourne bien le code du dépôt »).
