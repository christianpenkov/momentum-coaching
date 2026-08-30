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

## La cadence : 6 passages par jour depuis le 2026-08-30

Tant qu'un passage coûtait 801 appels pour 100 posts, une fois par jour était le seul
réglage tenable. Il en coûte 6.

| | |
|---|---|
| cadence | **6×/jour**, créneaux de 4 h, heure de Paris |
| appels posts | 36/jour/élève (les métriques de compte en consomment ~310 à côté) |
| quota Meta | `4800 × impressions/24 h`, **propre à chaque élève** → facteur 14 de marge |
| budget fonction | ~19 s sur 150 s, dans 6 invocations sur 288 |
| lignes en base | **aucune de plus** — l'upsert porte sur `(profile_id, post_id, snapshot_date)` |

Pourquoi pas plus : 24×/jour tiendrait encore côté quota. Mais les insights Meta ne sont
pas temps réel — au-delà de 6, on paie des appels sans gagner de fraîcheur, et on ajoute
de la surface de panne pour rien.

### La date écrite — le piège qui n'aurait rien affiché

Monter la cadence **sans** changer la date écrite aurait été une panne silencieuse. Le
code écrivait `isoDate(1)` : les passages de 04 h, 08 h, 12 h… auraient écrasé la ligne
d'**hier** avec des chiffres accumulés **aujourd'hui**, et les stats de la veille
auraient gonflé toute la journée. Aucune erreur, aucun log, juste des chiffres faux.

Deux dates sont donc écrites, depuis la même mesure — modèle déjà en place juste à côté
pour les métriques de compte (`fetchIgDayMetrics` écrit hier ET aujourd'hui) :

- **toujours** la ligne du jour, celle que les écrans affichent ;
- **la ligne de la veille seulement au premier passage du jour, et seulement avant 04 h.**

Cette dernière condition a trois branches, et les confondre fausse les chiffres dans un
sens ou dans l'autre. Elles vivent dans `datesDuSnapshot`, testée :

| situation | décision | pourquoi |
|---|---|---|
| pas de ligne d'hier | l'écrire | une clôture tardive vaut mieux qu'un trou |
| ligne d'hier + 1ᵉʳ passage avant 04 h | la réécrire | elle porte la valeur de 20 h, il lui manque 4 h |
| ligne d'hier + plus tard dans la journée | **ne pas y toucher** | l'écraser à 14 h lui ajouterait 14 h de trafic du jour |

Le troisième cas corrige un défaut qui existait déjà : une ligne du 26 août réécrite le
27 à 12 h 10 par un clic sur « Actualiser ». La date n'est plus un paramètre de
`snapshotIgPosts` — elle ne peut plus être passée à tort.

### L'étalement des élèves

Les profils sont aujourd'hui répartis dans le temps, mais **par accident** : chacun suit
la phase de son propre `last_synced_at`. Mesuré le 2026-08-28 sur trois profils — 00:10,
00:20, 00:45. Cette répartition disparaîtrait après tout événement remettant les
horodatages en phase (panne longue, reconnexions groupées) : les 40 élèves tomberaient
alors dans la même invocation de 150 s.

Le créneau est donc décalé de `hash(profile_id) % 55` minutes. Déterministe, sans état,
vrai dès le premier passage. Vérifié sur 500 profils simulés : toujours exactement
6 passages espacés de 240 min, premier passage entre 00:00 et 00:54, réparti sur les
11 invocations de 5 min.

### Tests

```bash
npx deno test supabase/functions/_shared/ig-posts.test.ts
```

⚠️ `npm test` ne couvre **pas** `supabase/functions/`. Ces deux décisions — cadence et
clôture — sont les seules du module dont une erreur ne produirait aucun symptôme :
ni erreur, ni ligne dans `cron_runs`, ni écran cassé. Seulement des chiffres légèrement
faux, tous les jours. D'où leur extraction en fonctions pures testées.

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
