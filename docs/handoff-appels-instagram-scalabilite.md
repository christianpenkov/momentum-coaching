# Coût des appels Instagram — chantier CLOS le 2026-08-30

> Ce fichier était un handoff. Il est conservé parce que **deux de ses trois hypothèses
> étaient fausses**, et que la façon dont elles sont tombées vaut plus que la solution.
> Ce qui a été livré est décrit plus bas.

## Le problème de départ

`snapshotIgPosts` (`supabase/functions/_shared/ig-posts.ts`) interrogeait **un post à la
fois, une métrique à la fois** — 8 appels HTTP par post — et ne regardait que les
**15 posts les plus récents**.

- Avant : 15 posts × 8 × 4 profils = 480 appels par nuit, et 85 % du catalogue d'un
  élève actif jamais rafraîchi.
- Cible : 40 élèves × 100 posts × 8 = **32 000 appels**, dans une Edge Function qui
  dispose de **150 secondes**.

## Ce qui a été livré

| | avant | après |
|---|---|---|
| appels Meta, compte de 14 posts | **113** | **3** (7 au tout premier passage) |
| appels Meta, compte de 100 posts | 801 | **~6** |
| appels Meta, compte de 500 posts | 4 001 | **~25** |
| posts couverts | les 15 plus récents | **tous** (pagination, borne à 1 200) |
| `storage.list()` par nuit à 40 élèves | ~20 000 | **40** |
| écritures en base | 1 upsert par post | 1 upsert par 200 lignes |

Mesuré, pas estimé : banc d'essai sur le profil de test, 113 → 7 → 3 appels sur deux
passages consécutifs, chiffres écrits **identiques** à ceux de l'ancien code.

## Hypothèse fausse n° 1 — « le découpage par métrique est une parade »

Le code portait ce commentaire, et ce handoff l'avait repris comme un fait :

> Un seul appel groupé (`metric=a,b,c`) perd **TOUTES** les métriques du groupe si Meta
> en refuse ne serait-ce qu'une seule — cas fréquent sur les posts les plus vieux.

**Testé sur les 14 posts d'un compte couvrant 2023 → 2026 : faux.** L'appel groupé rend
exactement les mêmes métriques que les appels unitaires, dans les 14 cas. Le refus de
Meta porte sur l'**objet** (sous-code `2108006`, « publié avant la conversion du compte
en compte professionnel »), pas sur la métrique : quand il tombe, il fait tomber les
8 métriques, groupées ou non.

La parade coûtait 8× et ne rattrapait rien.

Elle garde un sens dans **un seul** cas, réel lui aussi : demander une métrique que le
type de média ne supporte pas (`follows` sur un Reel, ou une métrique dépréciée) fait
échouer tout le groupe. C'est ce que gère la dégradation `'reduit'` décrite plus bas.

## Hypothèse fausse n° 2 — « les requêtes groupées de Meta sont la solution »

Ce handoff proposait `POST /?batch=[…]`, 50 sous-requêtes en un appel. **Ce n'est pas
disponible ici.** Testé :

```
POST https://graph.instagram.com/v22.0/  batch=[…]
→ 400, WWW-Authenticate: "access_denied" "Cannot call API for app … on behalf of user 0"

POST https://graph.facebook.com/v22.0/   batch=[…]
→ {"code":190,"message":"Invalid OAuth access token - Cannot parse access token"}
```

Le point d'entrée `batch` est une fonctionnalité de la plateforme Facebook. Un jeton
**Instagram Login** n'y est pas accepté, et l'autre hôte refuse le jeton tout court.
**Ne pas y revenir.**

## Ce qui marche à la place : la lecture multi-objets

```
GET /?ids=post1,post2,…,post25&fields=insights.metric(reach,saved,shares,total_interactions,views,…)
```

25 posts × 8 métriques en **un** appel HTTP, sur `graph.instagram.com`, avec le jeton du
projet. Vérifié le 2026-08-30 : 12 posts couverts en 2 appels au lieu de 96.

⚠️ **C'est du tout ou rien** : un seul post refusé fait échouer la réponse entière.
D'où les deux mécanismes ci-dessous, sans lesquels le groupage ne tiendrait pas.

### La dichotomie

Un lot refusé est coupé en deux, récursivement, jusqu'à isoler le post fautif. Coût :
log2(25) ≈ 5 appels **une fois**. Plafonné à 120 appels par profil et par passage — une
dépréciation de métrique côté Meta la déclencherait sur tout le catalogue d'un coup, et
ce plafond garantit que ça coûte au pire une nuit, jamais un dépassement des 150 s.

### La mémoire des refus — `ig_post_insights_etat`

Une ligne par post, jamais par jour :

- `'aucun'` + `reessayer_apres` **null** → définitif (`2108006` ne se lève jamais). Le
  post n'est plus jamais demandé. **C'est cette exclusion qui rend le groupage
  possible, pas seulement économique.**
- `'aucun'` + une date → panne passagère, nouvelle chance dans 7 jours. Une coupure ne
  condamne pas un post à vie.
- `'reduit'` → seules les 5 métriques communes répondent ; réévalué tous les 30 jours.
  **C'est ce qui absorbera sans intervention la prochaine dépréciation Meta** : la
  plateforme perd la métrique concernée, pas la ligne entière.

Toute erreur non reconnue est classée **transitoire** : on ne conclut rien, on retente.
Même règle que la détection de suppression — ne jamais conclure au-delà de ce que la
réponse démontre.

## Hypothèse fausse n° 3 — « il faut une rotation »

Ce handoff proposait de rafraîchir « les 15 plus récents chaque nuit plus une dizaine en
rotation ». **À ne pas faire** : le chemin de lecture (`get_ig_posts_history`, et
`app/api/instagram/stats/route.ts`) filtre sur `snapshot_date BETWEEN début AND fin`
puis déduplique. Un post non rafraîchi depuis 9 jours **disparaît** de l'écran « 7
derniers jours ».

Et la rotation n'était de toute façon plus nécessaire : à ~6 appels pour 100 posts, tout
rafraîchir chaque nuit coûte moins cher que la rotation ne coûtait avant le groupage.

## Les deux autres goulots, réglés au passage

Ils n'étaient pas dans ce handoff et pesaient autant que les insights à la cible.

- **Vignettes** : un `storage.list()` par post ET par passage (le cache mémoire ne vivait
  que le temps d'une invocation) — 20 000 requêtes de stockage par nuit à 40 élèves.
  Remplacé par `ig_post_vignettes`, une ligne par post, une lecture par profil.
- **Durées de Reels** : un `select` par post. Même traitement — la table est lue une fois.

Ces deux travaux sont « une seule fois par post » et **bornés par passage** (100 vignettes,
30 durées), avec une échéance transmise par l'appelant. Le temps d'exécution ne dépend
donc pas de la taille du catalogue, **même au tout premier passage sur un compte de
500 posts** : le reste se rattrape aux passages suivants. Même motif que la fenêtre
d'auto-réparation Short.io.

## Ce qui ne bouge pas

- **La borne de la détection de suppression** reste le post le plus ancien réellement
  renvoyé. La pagination complète la rend très large, mais la règle protège aussi le cas
  d'une pagination interrompue en cours de route.
- **Les métriques d'un post sont « lifetime »** — un cumul depuis la publication.
  Interrogeables indéfiniment ; la rétention de 90 jours porte sur les métriques de
  **compte**, pas sur celles des posts.
- **La notification « nouveau post »** est désormais bornée aux publications de moins de
  7 jours. Sans cette borne, le premier passage après le retrait de `limit=15` aurait
  envoyé une notification pour **chaque post de l'historique**.

## Surveillance

```sql
select * from ig_sante_insights_posts;
```

`etat = 'depreciation_metrique_probable'` signale une dégradation `'reduit'` de moins de
7 jours — le signe qu'une métrique Meta vient de disparaître. Aucune urgence : la
plateforme a déjà encaissé la perte toute seule, c'est une information, pas une panne.
Des posts `posts_muets_definitif` ne sont **pas** une anomalie : c'est une limite connue
de Meta sur les publications antérieures au passage en compte pro.

## Avant de retoucher au cron

- `npx deno check supabase/functions/_shared/ig-posts.ts`
- Déploiement **séparé obligatoire** — `git push` n'emmène pas les Edge Functions — et
  des **deux** fonctions qui importent ce module : `poll-leads` **et** `refresh-ig-posts`.
- Lire `docs/checklist-scalabilite.md`.
- Vérifier la fonction déployée **par le contenu du bundle**, jamais par `updated_at`
  (voir `AGENTS.md`).
