# Instagram Insights — `reach` × `breakdown=follow_type`

Recherche menée le 2026-08-25 contre les **sources primaires uniquement** : documentation officielle Meta for Developers (`developers.facebook.com/docs/instagram-platform/...`), changelog officiel de la plateforme Instagram, et blog officiel Meta for Developers. Les rares points où seule une source secondaire existe sont **marqués explicitement comme tels**.

Complète [`instagram-api-limitations.md`](./instagram-api-limitations.md) (section « Breakdown `follow_type` — incompatible au niveau média ») et [`instagram-scalabilite.md`](./instagram-scalabilite.md).

Code concerné : `app/api/instagram/stats/route.ts:119`, `components/analytics/PageClientStats.tsx:1307`.

---

## Réponse courte aux 5 questions

| # | Question | Réponse |
|---|---|---|
| 1 | FOLLOWER + NON_FOLLOWER = reach total ? | **Non, pas garanti.** Une 3ᵉ valeur `UNKNOWN` est officiellement documentée dans l'énumération `follow_type`. Meta ne documente nulle part que la somme égale le total. |
| 2 | Périodes valides pour `reach` | **`day` uniquement** dans la doc actuelle. `week` / `days_28` ne sont plus listés nulle part sur les pages de référence à jour. |
| 3 | Combinaisons breakdown × période | `metric_type=total_value` est **obligatoire** pour obtenir un breakdown. `since`/`until` sont **optionnels** — mais leur absence déclenche un repli à 24 h. Aucune limite de plage documentée pour `reach`. |
| 4 | Autres breakdowns | `media_product_type`, `contact_button_type`, plus `age`/`city`/`country`/`gender` sur les métriques démographiques. |
| 5 | Pièges 2025-2026 | Latence 48 h, seuil des 100 abonnés, et le fait qu'une donnée absente revient en **jeu vide plutôt qu'en `0`**. |

> ⚠️ **Deux réponses de ce tableau ont été corrigées par la mesure le 2026-08-26.**
> La rétention n'est pas de 90 jours mais de **2 ans** (l'API le dit dans son
> message d'erreur), et la somme FOLLOWER + NON_FOLLOWER **est** exacte jusqu'à
> **366 jours** — à partir de 367, le breakdown se fige et les pourcentages
> deviennent faux sans aucune erreur. Voir « Mesures du 2026-08-26 » en fin de
> document, qui fait foi sur ces points.

---

## 1. Somme à 100 % ou non — la question centrale

### Ce que la doc dit noir sur blanc

L'énumération officielle du breakdown `follow_type` contient **trois** valeurs, pas deux :

> `follow_type` — "Breaks down results by followers or non-followers"
> Valeurs : `FOLLOWER`, `NON_FOLLOWER`, **`UNKNOWN`**

Source : [Instagram User Insights — API reference](https://developers.facebook.com/docs/instagram-platform/api-reference/instagram-user/insights/), confirmé indépendamment sur la page miroir [Instagram Platform / instagram-graph-api / ig-user / insights](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/insights/).

C'est le point décisif : **Meta prévoit explicitement une catégorie « non déterminé »**. Un compte touché dont Meta ne peut pas établir le statut d'abonnement au moment de la vue tombe dans `UNKNOWN`.

### Ce que la doc ne dit PAS — à assumer comme non tranché

**Meta ne documente nulle part** une garantie du type « la somme des breakdowns égale le `total_value` sans breakdown ». Il n'existe aucune phrase affirmant l'égalité, ni aucune phrase la niant explicitement pour `follow_type`. Vérifié sur les quatre pages de référence Insights (Instagram Login, Facebook Login, page `insights/` généraliste, changelog).

Ce qui existe, c'est une mise en garde **sur les métriques démographiques uniquement** :

> "Summing demographic metric values may result in a value less than the follower count"
> — [Instagram User Insights](https://developers.facebook.com/docs/instagram-platform/api-reference/instagram-user/insights/)

et

> "Only viewers for whom we have demographic data are used in demographic metric calculations"

Ces deux phrases visent `follower_demographics` / `engaged_audience_demographics`, **pas** `reach × follow_type`. Les extrapoler à `follow_type` serait une inférence, pas une citation — je ne le fais pas. Mais elles établissent que le principe « Meta ne classe que ce qu'il sait classer, et la somme peut être inférieure » est bien un comportement assumé de cette API.

### Verdict actionnable

**Ne jamais coder en supposant que les deux pourcentages font 100 %.** Trois raisons, par ordre de solidité :

1. **Certaine (doc officielle)** — `UNKNOWN` est une valeur d'énumération légitime. Elle peut apparaître dans la réponse à tout moment. Un code qui ne lit que `FOLLOWER` et `NON_FOLLOWER` perdra silencieusement cette part.
2. **Certaine (doc officielle)** — quand une catégorie n'a pas de donnée, Meta **omet la ligne** au lieu de renvoyer `0` : *"If insights data you are requesting does not exist or is currently unavailable, the API will return an empty data set instead of `0`"*. Donc l'absence de `FOLLOWER` dans la réponse ne veut pas dire « zéro abonné touché ».
3. ~~**Non tranchée par la doc**~~ — **tranchée empiriquement le 2026-08-25** (voir ci-dessous). La doc reste muette, mais le test comparatif a été fait.

#### Test comparatif — fait le 2026-08-25

La vérification recommandée ci-dessus a été menée sur le compte de test, fenêtre
de 27 jours, deux appels séparés sur les mêmes bornes `since`/`until` :

| Appel | Résultat |
|---|---|
| `reach` **sans** breakdown | `total_value.value = 121` |
| `reach` **avec** `breakdown=follow_type` | `FOLLOWER 109` + `NON_FOLLOWER 12` = **121** |

**Somme exacte.** Les deux chiffres viennent d'appels distincts, donc l'égalité
n'est pas un artefact de calcul. Aucune ligne `UNKNOWN` n'a été renvoyée.

Recoupé en base sur l'historique complet : **59 journées sur 59** où le détail
existe, `ig_reach = ig_reach_follower + ig_reach_non_follower`, écart maximum 0.

**Ce que ça ne prouve pas** : que `UNKNOWN` n'apparaîtra jamais. L'énumération de
Meta la prévoit, et son absence ici est cohérente avec la règle 2 (une catégorie
vide est omise, pas renvoyée à 0). Le code trace désormais toute dimension
inattendue dans `webhook_debug_log` plutôt que de l'avaler en silence — sans
créer de colonne tant qu'aucun cas réel n'a été observé.

> Source secondaire, à titre indicatif seulement : plusieurs éditeurs d'outils analytics (Supermetrics, Power My Analytics) documentent des écarts systématiques entre reach total et somme des ventilations Instagram, en invoquant une déduplication calculée indépendamment par catégorie. **Non confirmé par Meta**, à ne pas citer comme fait.

### Correctif recommandé dans le code

`app/api/instagram/stats/route.ts` boucle actuellement sur `metric.total_value.breakdowns` en ne retenant que `FOLLOWER` et `NON_FOLLOWER`. Deux ajustements :

- Lire aussi `UNKNOWN` et le conserver, ne serait-ce que pour l'exclure sciemment du dénominateur.
- Pour un affichage en pourcentage, **calculer le dénominateur comme la somme des catégories effectivement renvoyées**, jamais comme `FOLLOWER + NON_FOLLOWER` supposés exhaustifs, et jamais comme le `reach` global d'un autre appel (fenêtres de déduplication potentiellement différentes).

---

## 2. Périodes acceptées pour `reach`

### État au 2026-08 : `day` uniquement

La page de référence à jour donne, pour `reach` :

| Attribut | Valeur documentée |
|---|---|
| `period` | `day` |
| `metric_type` | `total_value` et `time_series` |
| `breakdown` | `media_product_type`, `follow_type` |

Source : [Instagram User Insights — API reference](https://developers.facebook.com/docs/instagram-platform/api-reference/instagram-user/insights/).

La description du paramètre `period` lui-même :

> "Tells the API which time frame to use when aggregating results. Only compatible with interaction-related metrics."

**Ni `week` ni `days_28` n'apparaissent nulle part** sur les pages de référence actuelles — même pas dans une mention de dépréciation. Les seules valeurs listées sur l'ensemble de la page sont `day` (métriques d'interaction) et `lifetime` (métriques démographiques).

### Ce qui a été déprécié, et quand

Extrait du [changelog officiel Instagram Platform](https://developers.facebook.com/docs/instagram-platform/changelog) :

| Date annonce | Effet toutes versions | Contenu |
|---|---|---|
| 2025-01-21 | **2025-04-21** | `impressions` déprécié sur media et user insights. *"API requests made after April 21, 2025 for media created on or after July 2, 2024 will return an error"* |
| 2024-10-02 | 2025-01-08 | Suppression de `email_contacts`, `get_direction_clicks`, `profile_views`, `text_message_clicks`, `website_clicks`, `phone_call_clicks` |
| 2024-10-02 | 2025-01-08 | `video_views` n'est plus supporté |
| 2024-05-21 | 2024-08-19 | Timeframes `last_14_days`, `last_30_days`, `last_90_days`, `prev_month` retirés pour `reached_audience_demographics` et `engaged_audience_demographics` |
| 2023-09-12 | 2023-12-11 | Métriques carrousel, `engagement`, `navigation` dépréciées — `total_interactions` est l'alternative |
| 2020-11-10 | 2021-05-09 | `follower_count` renvoie *"a maximum of 30 days of data instead of 2 years"* |

**Point important à noter honnêtement :** je n'ai **trouvé aucune entrée de changelog annonçant la dépréciation de `period=week` ou `period=days_28`**. Ces valeurs ont simplement disparu des tableaux de référence entre les anciennes pages et les pages actuelles, sans annonce dédiée. C'est cohérent avec le comportement observé en production sur ce projet (voir §3), mais **ce point n'est pas tranché par une source officielle explicite** — la doc actuelle ne les liste plus, c'est tout ce qu'on peut affirmer.

### `impressions` — ne pas retenter

Remplacé officiellement par `views`, qui accepte les breakdowns `follow_type` et `media_product_type`. Déjà utilisé dans `stats/route.ts:103`.

---

## 3. Combinaisons `metric` × `metric_type` × `breakdown` × `period`

### Règle 1 — `total_value` obligatoire pour tout breakdown

> "If you request `metric_type=time_series`, breakdowns will not be included in the response."
> — [Instagram User Insights](https://developers.facebook.com/docs/instagram-platform/api-reference/instagram-user/insights/)

`metric_type=total_value` : *"Tells the API to return results as a simple total. If breakdowns are included in the request, the result set will be further broken down"*.

**Conséquence :** un appel avec `breakdown=follow_type` mais sans `metric_type=total_value` ne renvoie **pas d'erreur** — il renvoie simplement une série temporelle sans ventilation. Piège silencieux, déjà rencontré sur ce projet avec `views` (`poll-leads/index.ts:188`, `instagram-scalabilite.md:33`).

### Règle 2 — `since`/`until` sont optionnels, mais leur absence a un effet fort

> "Assign UNIX timestamps to the `since` and `until` parameters to define a range. The API will only include data created within this range (inclusive). **If you do not include these parameters, the API will look back 24 hours.**"
> — [Instagram User Insights](https://developers.facebook.com/docs/instagram-platform/api-reference/instagram-user/insights/)

**C'est la clé de l'observation empirique du 2026-08-22 sur ce projet.**

Ce qui avait été observé :
- sans `since`/`until` : Meta répond `period: day` et renvoie une seule journée → `{NON_FOLLOWER: 1}`
- avec `since`/`until` : `{FOLLOWER: 121, NON_FOLLOWER: 14}`

**Ce comportement est-il documenté ?** Partiellement, et il faut être précis :

- ✅ **Documenté** : le repli à 24 h en l'absence de `since`/`until`. La phrase ci-dessus l'énonce explicitement. C'est bien l'explication du « une seule journée ».
- ✅ **Cohérent avec la doc** : la réponse `period: day` est logique puisque `day` est **la seule valeur valide** pour `reach` (§2). Meta n'« ignore » pas vraiment `days_28` — il n'a jamais accepté cette valeur pour `reach` dans la version actuelle de l'API, et normalise en `day`.
- ❌ **Non documenté** : Meta ne dit **nulle part** qu'il accepte silencieusement un `period` invalide en le remplaçant par `day` sans lever d'erreur. Aucune page ne décrit cette tolérance. C'est une observation empirique valide de ce projet, **sans contrepartie dans la doc officielle**.

**Recommandation concrète pour `stats/route.ts:119` :** l'appel actuel passe `period=days_28` **et** `since`/`until`. Il fonctionne, mais uniquement parce que `since`/`until` font tout le travail — `days_28` est inerte. Remplacer par `period=day` rendrait l'intention exacte et supprimerait la dépendance à un comportement de tolérance non documenté, susceptible de devenir une erreur dure dans une version future. Le commentaire du code (« Meta ignorait alors le `period=days_28` ») décrit bien le symptôme, mais la cause réelle est le repli à 24 h, pas un rejet de `days_28`.

### Règle 3 — compatibilité breakdown / métrique

Tableau officiel ([source](https://developers.facebook.com/docs/instagram-platform/api-reference/instagram-user/insights/)) :

| Métrique | Breakdowns compatibles |
|---|---|
| `reach` | `media_product_type`, `follow_type` |
| `views` | `follow_type`, `media_product_type` |
| `follows_and_unfollows` | `follow_type` |
| `profile_links_taps` | `contact_button_type` |
| `likes`, `comments`, `saves`, `shares`, `total_interactions` | `media_product_type` |
| `follower_demographics`, `engaged_audience_demographics` | `age`, `city`, `country`, `gender` |
| `accounts_engaged`, `replies`, `reposts` | aucun |

> "If you request a metric that doesn't support a breakdown, the API will return an error (`"An unknown error has occurred."`), so be careful if requesting multiple metrics in a single query."

À rapprocher de la « perte de groupe » déjà documentée dans `instagram-api-limitations.md` : un breakdown incompatible sur une seule métrique d'un appel groupé fait tomber tout l'appel, avec un message d'erreur inutilisable. **Ne jamais grouper des métriques quand un breakdown est en jeu.**

### Règle 4 — limite de plage de dates

**Aucune limite de plage documentée pour `reach`.** La doc ne mentionne un maximum que pour deux cas précis :

- `follower_count` : *"returns a maximum of 30 days of data instead of 2 years"* (changelog v9.0)
- `online_followers` : *"Only available for the last 30 days"*

Pour `reach` avec `since`/`until`, **rien n'est documenté** — ni maximum, ni erreur attendue au-delà d'une certaine plage. La rétention générale de 90 jours (§5) constitue de fait la borne haute pratique. Point **non tranché par la doc** au-delà de ça.

---

## 4. Autres breakdowns disponibles

Énumérations complètes, [source officielle](https://developers.facebook.com/docs/instagram-platform/api-reference/instagram-user/insights/) :

| Breakdown | Description Meta | Valeurs |
|---|---|---|
| `follow_type` | "Breaks down results by followers or non-followers" | `FOLLOWER`, `NON_FOLLOWER`, `UNKNOWN` |
| `media_product_type` | "Breaks down results by the surface where viewers viewed or interacted with the app user's media" | `AD`, `STORY`, `REEL` (= `REELS`), `CAROUSEL_CONTAINER`, `POST`, `FEED` |
| `contact_button_type` | "Divides results by profile component in the native app" | `BOOK_NOW`, `CALL`, `DIRECTION`, `EMAIL`, `INSTANT_EXPERIENCE`, `TEXT`, `UNDEFINED` |
| `age`, `city`, `country`, `gender` | démographiques | variables |

### Combinaison de plusieurs breakdowns

Le code de ce projet combine déjà `breakdown=follow_type,media_product_type` sur `views` (`stats/route.ts:103`) et la requête aboutit. La doc **ne documente cependant pas explicitement** quelles paires de breakdowns sont combinables ni le format exact de la réponse croisée. Point **non tranché par la doc officielle** — s'appuyer sur la vérification empirique existante.

Noter que `contact_button_type` contient `UNDEFINED` et `media_product_type` ne contient pas de valeur fourre-tout : le pattern « catégorie résiduelle » est donc inégal selon les breakdowns, ce qui renforce le §1 (traiter chaque énumération selon sa propre définition, pas par analogie).

---

## 5. Limitations et pièges 2025-2026

### Rétention

| Périmètre | Durée | Source |
|---|---|---|
| Insights **compte / user** | **90 jours** — *"User Metrics data is stored for up to 90 days."* | [Insights](https://developers.facebook.com/docs/instagram-platform/insights/) |
| Insights **média** | 2 ans — *"Metrics data is stored for up to 2 years."* | déjà documenté dans `instagram-api-limitations.md` |
| `follower_count` | 30 jours | changelog v9.0 |

C'est `reach × follow_type` qui est concerné par la fenêtre **90 jours** : c'est une métrique compte. Toute tentative de backfill au-delà reviendra vide.

### Latence

> "Data used to calculate metrics may be delayed up to 48 hours"

Un `since`/`until` incluant les 2 derniers jours renvoie des valeurs qui bougeront encore. À prendre en compte avant de conclure à une régression sur un chiffre récent.

### Seuils minimums — s'appliquent-ils à `follow_type` ?

Ce que Meta documente :

- *"Some metrics are not available on Instagram accounts with fewer than 100 followers."*
- Métriques follower : *"not available on Instagram business or creator accounts with fewer than 100 followers"*
- `follows_and_unfollows` : non renvoyé sous 100 abonnés
- Démographiques : non renvoyé si l'engagement tombe sous 100 sur la période ; *"only return the top 45 performers"*

**Est-ce que le seuil des 100 s'applique à `reach × follow_type` ?** **Non tranché par la doc officielle.** Meta liste nommément `follows_and_unfollows` et les métriques démographiques, mais **ne cite jamais `reach` ni `follow_type`** dans les phrases sur les seuils. La formule générique *"Some metrics are not available…"* ne précise pas lesquelles.

Il faut néanmoins prévoir le cas : sur un compte à faible audience, une catégorie peut ne pas être renvoyée du tout — que ce soit par seuil d'anonymisation ou par simple absence de donnée, le code voit la même chose.

### Le piège du jeu vide plutôt que zéro

> "If insights data you are requesting does not exist or is currently unavailable, the API will return an empty data set instead of `0`"

C'est exactement le bug déjà corrigé dans `stats/route.ts:151` (initialiser à `0` seulement si la ventilation contient réellement des lignes). Le même piège vaut pour chaque catégorie prise isolément, pas seulement pour le bloc `breakdowns` entier — et il rejoint le pattern « `|| null` efface un vrai 0 » déjà connu sur ce projet.

### `graph.instagram.com` vs `graph.facebook.com`

| | Instagram API with **Instagram Login** | Instagram API with **Facebook Login** |
|---|---|---|
| Base URL | `graph.instagram.com` | `graph.facebook.com` |
| Comptes | *"Instagram professional accounts with a presence on Instagram only"* | *"Instagram professional accounts that are linked to a Facebook Page"* |
| **Insights** | ✅ | ✅ |
| Hashtag Search | ✗ | ✅ |
| Product Tagging / Partnership Ads | ✗ | ✅ |
| Messagerie | directe | via Messenger Platform |

Source : [Instagram Platform Overview](https://developers.facebook.com/docs/instagram-platform/overview).

**Pour ce projet : aucune différence sur les Insights.** Le tableau de comparaison officiel donne la parité (✅ des deux côtés) sur Insights. Migrer vers le flow Facebook Login n'apporterait donc **rien** sur `reach × follow_type` — ce qui confirme le verdict déjà pris dans `instagram-api-limitations.md` (chantier abandonné au 2026-08-02, coût ~67 fichiers pour un gain incertain).

Nuance : la parité porte sur la disponibilité de l'endpoint, pas nécessairement sur l'identité des valeurs renvoyées. Meta ne documente pas de comparaison chiffrée. **Non tranché.**

---

## Ce qui reste explicitement non tranché

Récapitulatif des points où la doc officielle **ne permet pas de conclure** — à ne pas combler par déduction :

1. Si `FOLLOWER + NON_FOLLOWER + UNKNOWN` égale exactement le `reach` global sur la même fenêtre. **Seul un test empirique comparatif peut trancher.**
2. Si le seuil des 100 abonnés s'applique à `reach × follow_type`.
3. La limite maximale de plage `since`/`until` pour `reach` (au-delà de la rétention 90 j).
4. La tolérance de Meta face à un `period` invalide (normalisation silencieuse en `day` sans erreur).
5. Quelles paires de breakdowns sont officiellement combinables, et le format exact de la réponse croisée.
6. Si les valeurs renvoyées sont identiques entre `graph.instagram.com` et `graph.facebook.com`.
7. L'absence d'annonce de dépréciation pour `period=week` / `days_28` — disparus des tableaux sans entrée de changelog.

**Test à faire si le point 1 doit être tranché** (le plus utile) : sur le même `since`/`until`, lancer deux appels et comparer.

```
# Avec breakdown
GET /{ig-user-id}/insights?metric=reach&metric_type=total_value
    &breakdown=follow_type&period=day&since=X&until=Y

# Sans breakdown, même fenêtre
GET /{ig-user-id}/insights?metric=reach&metric_type=total_value
    &period=day&since=X&until=Y
```

Si la somme des catégories du premier est inférieure au `total_value` du second, l'écart est la part non attribuée — et il faudra l'afficher ou l'exclure sciemment, jamais la répartir implicitement entre les deux autres catégories. Le pattern d'une route de debug isolée (`app/api/instagram/test-reach-breakdown/route.ts` existe déjà) est la bonne façon de le faire.

---

## Sources primaires

- [Instagram User Insights — API reference](https://developers.facebook.com/docs/instagram-platform/api-reference/instagram-user/insights/) — référence principale : métriques, périodes, breakdowns, énumérations
- [Instagram Platform — Insights](https://developers.facebook.com/docs/instagram-platform/insights/) — rétention 90 j, seuil 100 abonnés
- [Instagram Platform — Changelog](https://developers.facebook.com/docs/instagram-platform/changelog) — dates de dépréciation
- [Instagram Platform — Overview](https://developers.facebook.com/docs/instagram-platform/overview) — comparatif Instagram Login / Facebook Login
- [ig-user/insights (page miroir)](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/insights/) — confirmation indépendante de l'énumération `follow_type`
- [Blog Meta for Developers, 2025-12-03 — Instagram API Updates](https://developers.facebook.com/blog/post/2025/12/03/instragram-api-updates/) — nouvelles métriques (reels skip rate, reposts, crossposted views) ; **aucun changement sur `follow_type` ni `reach`**

### Sources secondaires (citées comme telles, non probantes)

- Supermetrics / Power My Analytics — écarts observés entre reach total et somme des ventilations. Aucune confirmation Meta.

---

## Mesures du 2026-08-26 — ce que l'API fait vraiment

Tests directs sur le compte `chris.pkv` (255 abonnés), en réponse à la question
« pourquoi 43 et 12, y a-t-il 45 % d'inconnus ? ».

### Les deux cartes de l'écran n'ont pas le même dénominateur

| Carte | Calcul | Sur ce compte |
|---|---|---|
| Followers reach rate | abonnés touchés ÷ **nombre total d'abonnés** | 109 ÷ 255 = **43 %** |
| Reach Non-Followers | non-abonnés ÷ **reach total** | 12 ÷ 121 = **10 %** |

**Elles ne somment donc pas à 100 %, et ne le doivent pas.** Les 57 % qui semblent
manquer sur la première sont les 146 abonnés non touchés (255 − 109), pas une
catégorie `UNKNOWN`.

Les libellés induisaient en erreur et ont été corrigés : « / total » ne disait pas
quel total, et « vues non-abonnés » annonçait les vues alors que le calcul porte
sur le reach.

### Reach et vues divergent fortement — ne jamais confondre

Même fenêtre de 28 jours, même breakdown :

| Métrique | Total | FOLLOWER | NON_FOLLOWER | Part non-abonnés |
|---|---|---|---|---|
| `reach` (comptes uniques) | 121 | 109 | 12 | **9,9 %** |
| `views` (revisionnages inclus) | 485 | 228 | 257 | **53 %** |

Un facteur 5 entre les deux lectures. L'écran affiche le reach ; c'est un choix
délibéré (cohérence avec le graphique voisin), mais il doit être **dit**.

### Fenêtres acceptées

`period=day` avec `since`/`until` fonctionne de 7 jours à 2 ans. Au-delà :
`"since param is not valid. Metrics data is available for the last 2 years"`.

La rétention réelle est donc de **2 ans**, et non de 90 jours comme le laissait
supposer la lecture de la doc (§5 plus haut) — corrigé ici par la mesure.

Une fenêtre d'**une seule journée** renvoie `total=0` et aucun breakdown : trop
courte pour être exploitable.

### ⚠️ Le breakdown a sa propre limite, plus courte que le total

C'est le piège majeur, et il produit exactement l'impression de « part inconnue ».

| Fenêtre | Total | Somme du breakdown | Écart |
|---|---|---|---|
| 28 j | 123 | 123 | 0 % |
| 90 j | 211 | 213 | −0,9 % |
| 180 j | 271 | 275 | −1,5 % |
| 365 j | 825 | 832 | −0,8 % |
| **370 j** | **2 202** | **971** | **56 %** |
| 400 j | 2 231 | 971 | 56 % |

Jusqu'à **365 jours**, l'écart reste sous 1,5 % — bruit d'arrondi, parfois négatif
(la ventilation dépasse le total, car Meta déduplique chaque catégorie
indépendamment).

Au-delà, **la ventilation se fige à 971** et n'évolue plus, pendant que le total
continue de croître. Toute fenêtre > 365 jours produit donc des pourcentages
faux, sans aucune erreur d'API pour le signaler.

**Règle à retenir : ne jamais demander `breakdown=follow_type` sur plus de
366 jours.** Le code actuel demande 28 jours, il est donc sûr.

#### Frontière localisée au jour près (2026-08-26)

| Fenêtre | Total | Somme breakdown | Écart |
|---|---|---|---|
| 364 j | 813 | 821 | −8 |
| 365 j | 825 | 832 | −7 |
| 366 j | 971 | 971 | **0** |
| **367 j** | **1 735** | **971** | **764** |
| 368 j | 2 202 | 971 | 1 231 |
| 375 j | 2 207 | 971 | 1 236 |

La ventilation se fige à **971** à partir de 366 jours et n'évolue plus jamais,
tandis que le total continue de croître. La dernière fenêtre exploitable est donc
**366 jours**, et la première fausse **367**.

Aucune erreur d'API n'accompagne ce décrochage — les pourcentages deviennent faux
en silence.

#### Toute fenêtre est acceptée, il n'y a pas de périodes imposées

`since`/`until` sont deux dates libres (secondes Unix). Testé : 89, 90, 91, 92,
120, 180 jours répondent tous normalement, avec des valeurs qui évoluent bien
avec la fenêtre. `period=day` ne désigne pas la longueur demandée mais l'unité
d'agrégation interne ; c'est `total_value` qui replie ensuite le tout en un seul
chiffre dédupliqué.

### Aucune catégorie `UNKNOWN` observée

Sur toutes les fenêtres testées (7 j à 2 ans), seules `FOLLOWER` et
`NON_FOLLOWER` sont renvoyées. L'énumération Meta prévoit `UNKNOWN` mais elle ne
sort pas ici. Le code la trace désormais dans `webhook_debug_log` si elle
apparaît, plutôt que de l'avaler en silence.

---

## Recherche complémentaire du 2026-08-26 — time_series, déduplication, alternatives

Cinq points laissés ouverts par la recherche du 2026-08-25. Mêmes règles :
**sources primaires uniquement**, URL pour chaque affirmation, et « non
documenté » assumé comme réponse quand la doc est muette.

### Verdict en une ligne par point

| # | Question | Verdict |
|---|---|---|
| 1 | `time_series` + `breakdown` ? | **TRANCHÉ — impossible.** Phrase explicite de Meta. |
| 2 | Déduplication sur la fenêtre ? | **TRANCHÉ pour le principe** (« unique accounts »), **NON DOCUMENTÉ** pour la ventilation par catégorie. |
| 3 | Limite de plage du breakdown | **NON DOCUMENTÉ.** Aucune limite spécifique au breakdown nulle part. |
| 4 | `followers_count` historique | **TRANCHÉ — instantané, pas d'historique.** `follower_count` (insights) n'existe plus dans la table de référence. |
| 5 | Métrique « follower reach rate » officielle | **TRANCHÉ — n'existe pas.** `reached_audience_demographics` a disparu de la doc. |

---

### 1. `metric_type=time_series` avec `breakdown` — TRANCHÉ, c'est impossible

La doc est explicite, et la phrase est la même mot pour mot sur les deux pages de
référence :

> "If you request `metric_type=time_series`, breakdowns will not be included in the response."

Sources, vérifiées indépendamment l'une de l'autre :
- [Instagram User Insights — API reference](https://developers.facebook.com/docs/instagram-platform/api-reference/instagram-user/insights/)
- [ig-user/insights (page miroir)](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/insights/)

Définition complète du paramètre, verbatim :

> `metric_type` — "Designates how you want results aggregated, either by time period or as a simple total (with breakdowns, if requested). Values can be: `time_series` — Tells the API to aggregate results by time period. `total_value` — Tells the API to return results as a simple total."

Noter le **« (with breakdowns, if requested) »** accolé à « simple total » : la
parenthèse ne s'applique qu'au cas `total_value`. Les deux formulations
convergent.

**Ce que ça veut dire pour le projet :** le graphique d'évolution jour par jour
de la ventilation abonnés / non-abonnés **ne peut pas être obtenu en un appel**.
Ce n'est pas une erreur silencieuse — c'est le comportement documenté : la
requête aboutit, elle renvoie une série temporelle **sans** ventilation. C'est
exactement le piège déjà rencontré sur `views` (§3, règle 1).

**Deux contournements possibles, aucun gratuit :**

| Approche | Coût | Verdict pour 30-40 élèves |
|---|---|---|
| N appels `total_value` + `breakdown`, un par jour (`since`/`until` = 1 journée) | N appels/élève/jour | ❌ **Inutilisable.** Mesuré le 2026-08-26 : une fenêtre d'une seule journée renvoie `total=0` et **aucun breakdown**. La brique de base ne fonctionne pas. |
| Stocker chaque jour le `total_value` + breakdown sur une fenêtre glissante, et construire l'historique en base | 1 appel/élève/jour, déjà fait | ✅ **C'est déjà l'architecture du projet.** Le graphique d'évolution se construit depuis `ig_reach_follower` / `ig_reach_non_follower` en base, pas depuis l'API. |

Conclusion : le graphique d'évolution est faisable, mais **par accumulation en
base**, jamais par un appel `time_series`. Ce que le projet fait déjà. Aucun
changement d'appel API à faire.

---

### 2. Sémantique de la déduplication — TRANCHÉ pour le total, NON DOCUMENTÉ pour la ventilation

#### Ce que Meta dit du `reach` lui-même

Définition officielle, verbatim :

> `reach` — "The number of unique accounts that have seen your content, at least once, including in ads. Content includes posts, stories, reels, videos and live videos."
> — [Instagram User Insights](https://developers.facebook.com/docs/instagram-platform/api-reference/instagram-user/insights/)

et, en opposition explicite avec l'ancienne métrique `impressions` :

> "Reach is different from impressions, which may include multiple views of your content by the same accounts."

Les termes **« unique accounts »** et **« at least once »** sont dans la
définition officielle. La métrique est aussi marquée **« This metric is
estimated »** sur la page de référence.

#### Somme des journées, ou déduplication sur la fenêtre ?

**Meta ne l'énonce jamais explicitement pour un `total_value` sur une plage
`since`/`until` multi-jours.** Aucune phrase du type « the total value is
deduplicated across the requested range » n'existe sur aucune des pages de
référence. Recherché sur les termes `unique`, `deduplicated`, `distinct
accounts`, `counted once` : les seules occurrences sont celles citées ci-dessus,
qui portent sur la définition de la métrique, pas sur l'agrégation d'une plage.

Ce qu'on peut affirmer sans inventer :
- **Documenté :** `reach` est un compte de comptes uniques (« unique accounts »).
- **Documenté :** `total_value` renvoie « a simple total ».
- **NON documenté :** si ce « simple total » sur 28 jours est une déduplication
  sur les 28 jours ou une somme de 28 déduplications journalières.

**La mesure du 2026-08-26 tranche indirectement en faveur de la déduplication sur
la fenêtre.** Sur ce compte, 28 jours donnent 121 et 365 jours donnent 825 : une
somme de reach journaliers sur un an dépasserait très largement 825 pour un
compte à 255 abonnés. Mais c'est une **inférence à partir d'une mesure**, pas une
citation. À traiter comme tel.

#### Chaque catégorie est-elle dédupliquée indépendamment ?

**NON DOCUMENTÉ.** Meta ne dit rien du mode de calcul d'un breakdown.

Le seul indice officiel proche concerne **les métriques démographiques
uniquement** :

> "Summing demographic metric values may result in a value less than the follower count"
> "Only viewers for whom we have demographic data are used in demographic metric calculations"
> — [Limitations, Instagram User Insights](https://developers.facebook.com/docs/instagram-platform/api-reference/instagram-user/insights/)

Ces phrases visent `follower_demographics` / `engaged_audience_demographics`.
Les étendre à `reach × follow_type` serait une extrapolation — déjà refusée au
§1 de ce document, refusée ici aussi. Et noter que ces phrases décrivent une
somme **inférieure** au total, alors que la mesure observe une somme
**supérieure** de 1 à 2 unités : le mécanisme n'est donc pas le même.

**L'observation empirique (somme du breakdown dépassant le total de 1-2 unités
sur les fenêtres 90/180/365 jours) reste la seule base pour l'hypothèse d'une
déduplication indépendante par catégorie.** Elle est cohérente : un compte qui
suit puis se désabonne au cours de la fenêtre peut légitimement être compté une
fois dans `FOLLOWER` et une fois dans `NON_FOLLOWER`, tout en n'étant compté
qu'une fois dans le total. C'est une explication plausible, **pas une explication
confirmée par Meta**.

**Conséquence pratique — inchangée par rapport au §1 :** ne jamais utiliser le
`total_value` d'un appel comme dénominateur des catégories d'un autre appel. Si
un pourcentage doit sommer à 100 %, le dénominateur doit être la somme des
catégories effectivement renvoyées.

---

### 3. Limite de plage spécifique au breakdown — NON DOCUMENTÉ

**Recherche exhaustive, résultat négatif.** Aucune page de la documentation
officielle ne mentionne de limite de plage propre aux breakdowns.

Ce qui a été vérifié :

| Source | Ce qu'elle documente sur les plages | Limite breakdown ? |
|---|---|---|
| [Instagram User Insights — API reference](https://developers.facebook.com/docs/instagram-platform/api-reference/instagram-user/insights/) | `since` : "Unix timestamp indicating start of range" ; `until` : "Unix timestamp indicating end of range" ; "If you do not include these parameters, the API will look back 24 hours." | **Aucune** |
| [Section Limitations, même page](https://developers.facebook.com/docs/instagram-platform/api-reference/instagram-user/insights/) | 7 bullets : seuil 100 abonnés (`follower_count`, `online_followers`), 30 j pour `online_followers`, jeu vide au lieu de `0`, top 45 démographiques, somme démographique inférieure, latence 48 h | **Aucune** |
| [Instagram Platform — Insights](https://developers.facebook.com/docs/instagram-platform/insights/) | "User Metrics data is stored for up to 90 days." | **Aucune** |
| [Changelog Instagram Platform](https://developers.facebook.com/docs/instagram-platform/changelog) | 2020-11-10 : `follower_count` "now returns a maximum of 30 days of data instead of 2 years" ; 2024-05-21 : retrait de 4 timeframes démographiques | **Aucune** |

Le mot `breakdown` n'apparaît **jamais** à côté de `range`, `maximum`,
`limitation` ou `date` dans la doc. Les seules limites de plage documentées sont
attachées à des **métriques nommées** (`follower_count` 30 j, `online_followers`
30 j), jamais à un paramètre de ventilation.

**Verdict : le décrochage à 365 jours mesuré le 2026-08-26 (breakdown figé à 971
pendant que le total monte à 2 231, soit 56 % d'écart, sans erreur d'API) n'est
documenté nulle part.** C'est un comportement non documenté de l'API, et il est
**silencieux** — donc impossible à détecter autrement que par la mesure.

Deux remarques qui aggravent le cas :

1. **La doc se contredit elle-même sur la rétention.** La page Insights annonce
   90 jours (« User Metrics data is stored for up to 90 days »), alors que le
   message d'erreur de l'API renvoie *« Metrics data is available for the last
   2 years »* (mesuré le 2026-08-26). Les deux ne peuvent pas être vrais. C'est
   un signal que cette zone de la doc n'est pas maintenue — raison de plus pour
   ne rien déduire d'une absence de mention.
2. **Aucune entrée de changelog** ne mentionne un changement de comportement des
   breakdowns depuis 2024. Le décrochage n'est donc pas une régression annoncée.

**Règle opérationnelle confirmée : plafonner toute requête
`breakdown=follow_type` à 365 jours, et le faire dans le code, pas dans un
commentaire.** Meta ne renverra jamais d'erreur pour le signaler.

---

### 4. `follower_count` vs `followers_count` — TRANCHÉ, aucun historique disponible

C'est le point où la doc réserve la plus mauvaise surprise.

#### `followers_count` (pluriel) — champ du nœud, instantané

> `followers_count` — "Total number of Instagram users following the user."
> — [IG User node](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user)

C'est tout. **Meta ne documente ni latence, ni cache, ni date de référence pour
ce champ.** Il n'y a aucun paramètre `since`/`until` sur un champ de nœud : c'est
structurellement une lecture à l'instant de l'appel. Aucune façon documentée
d'obtenir sa valeur à une date passée.

**Non documenté :** l'existence ou non d'une latence sur ce champ. La latence de
48 h documentée porte explicitement sur les *insights* (« Data used to calculate
metrics may be delayed up to 48 hours »), pas sur les champs du nœud IG User.

#### `follower_count` (singulier, insights) — a disparu de la table de référence

C'est le point le plus important, et il est contre-intuitif.

**`follower_count` n'apparaît plus dans la table des métriques** de la page de
référence à jour ([Instagram User Insights](https://developers.facebook.com/docs/instagram-platform/api-reference/instagram-user/insights/)).
La table actuelle liste 11 métriques d'interaction (`accounts_engaged`,
`comments`, `likes`, `profile_links_taps`, `reach`, `replies`, `reposts`,
`saves`, `shares`, `total_interactions`, `views`) et 3 métriques
démographiques / follower (`engaged_audience_demographics`,
`follower_demographics`, `follows_and_unfollows`). **`follower_count` n'est dans
aucune des deux.**

Il ne survit que dans **un bullet de la section Limitations** :

> "`follower_count` and `online_followers` metrics are not available on Instagram business or creator accounts with fewer than 100 followers."

**C'est une incohérence de la documentation Meta**, pas une inférence de ma part :
une métrique citée dans les limitations mais absente de la table qui définit ses
`period`, `metric_type` et `breakdown` valides. Idem pour `online_followers`.

Ce que le changelog dit de son passé :

> 2020-11-10 — "`follower_count` now returns a maximum of 30 days of data instead of 2 years."
> 2020-11-10 — "The `follower_count` values now align more closely with their corresponding values displayed in the Instagram app."
> — [Changelog Instagram Platform](https://developers.facebook.com/docs/instagram-platform/changelog)

**Gains quotidiens ou cumul ?** **NON DOCUMENTÉ dans la doc actuelle.** La
définition de `follower_count` n'existe plus sur aucune page de référence à jour
consultée. La seule chose qu'on puisse affirmer, c'est que `period=day` +
rétention 30 jours + « align with the Instagram app » pointent vers une lecture
journalière — mais la phrase de définition qui trancherait n'est **plus
publiée**. Ne pas construire dessus sans mesure directe.

#### Existe-t-il un moyen documenté d'avoir le nombre d'abonnés à une date passée ?

**Non.** Bilan des trois pistes :

| Piste | Statut |
|---|---|
| `followers_count` (champ nœud) | Instantané uniquement, pas de `since`/`until` |
| `follower_count` (insights) | Absent de la table de référence ; historiquement 30 j max ; donnerait au mieux une variation, pas un stock |
| `follower_demographics` | `period=lifetime`, renvoie une répartition démographique de l'audience **actuelle**, pas un total à une date |

**Conséquence directe pour le « Followers reach rate » :** diviser un reach de
28 jours par le `followers_count` d'aujourd'hui est **le seul calcul possible
avec l'API**. Ce n'est pas un choix discutable qu'on pourrait améliorer — il n'y
a pas d'alternative documentée. Le biais existe (le dénominateur est celui de
J, le numérateur couvre J-28 à J) et il grandit avec la croissance du compte,
mais il n'est pas corrigeable côté API.

**La seule correction possible est côté projet :** si un historique de
`followers_count` est déjà stocké en base par le cron quotidien, utiliser la
valeur au **début** de la fenêtre (ou la moyenne sur la fenêtre) plutôt que celle
d'aujourd'hui. C'est un travail de base de données, pas d'API — et c'est la seule
voie. À vérifier avant de décider : est-ce qu'une colonne d'abonnés est
historisée par jour dans les snapshots Instagram du projet ?

---

### 5. Métriques alternatives — TRANCHÉ, aucun « follower reach rate » officiel

#### Il n'existe pas de métrique officielle de taux de portée sur les abonnés

Aucune métrique de la table de référence ne renvoie un ratio. Meta n'expose que
des numérateurs bruts. **Le « Followers reach rate » doit être calculé, il n'a
pas d'équivalent natif.**

#### `reached_audience_demographics` — a existé, n'est plus documenté

La métrique **a existé** : le changelog en garde la trace.

> 2024-05-21 — "The `last_14_days`, `last_30_days`, `last_90_days` and `prev_month` timeframes will no longer be supported for the `reached_audience_demographics` and `engaged_audience_demographics` metrics."
> — [Changelog Instagram Platform](https://developers.facebook.com/docs/instagram-platform/changelog)

Mais **elle n'apparaît plus sur aucune page de référence à jour** — ni la page
[Instagram User Insights](https://developers.facebook.com/docs/instagram-platform/api-reference/instagram-user/insights/),
ni la [page miroir ig-user/insights](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/insights/),
ni la [page Insights généraliste](https://developers.facebook.com/docs/instagram-platform/insights/).
Seule `engaged_audience_demographics`, citée dans la même phrase du changelog, a
survécu.

**Aucune entrée de changelog n'annonce sa suppression.** C'est le même schéma que
`period=week` / `days_28` (§2) : disparition silencieuse de la table de référence
sans entrée dédiée. À traiter comme indisponible, sans compter dessus.

De toute façon, elle n'aurait pas répondu au besoin : une ventilation
démographique (âge, ville, pays, genre) de l'audience touchée ne dit rien du
statut d'abonnement.

#### Table de référence — métriques `/{ig-user-id}/insights` au 2026-08

Source unique de ce tableau :
[Instagram User Insights — API reference](https://developers.facebook.com/docs/instagram-platform/api-reference/instagram-user/insights/),
recoupée sur la [page miroir](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/insights/).

**Métriques d'interaction** — toutes en `period=day`, `timeframe` non applicable :

| Métrique | `metric_type` | `breakdown` | Description Meta (verbatim) |
|---|---|---|---|
| `accounts_engaged` | `total_value` | — | "The number of accounts that have interacted with your content, including in ads." *Estimated* |
| `comments` | `total_value` | `media_product_type` | "The number of comments on your posts, reels, videos and live videos." *In development* |
| `likes` | `total_value` | `media_product_type` | "The number of likes on your posts, reels, and videos." |
| `profile_links_taps` | `total_value` | `contact_button_type` | "The number of taps on your business address, call button, email button and text button." |
| **`reach`** | **`total_value`, `time_series`** | **`media_product_type`, `follow_type`** | **"The number of unique accounts that have seen your content, at least once, including in ads."** *Estimated* |
| `replies` | `total_value` | — | "The number of replies you received from your story, including text replies and quick reaction replies." |
| `reposts` | `total_value` | — | "The number of reposts of your posts, stories, reels, and videos." |
| `saves` | `total_value` | `media_product_type` | "The number of saves of your posts, reels, and videos." |
| `shares` | `total_value` | `media_product_type` | "The number of shares of your posts, stories, reels, videos and live videos." |
| `total_interactions` | `total_value` | `media_product_type` | "The total number of post interactions, story interactions, reels interactions, video interactions and live video interactions." |
| **`views`** | `total_value` | `follow_type`, `media_product_type` | "The number of times your content was played or displayed." *In development* |

> ⚠️ **`reach` est la SEULE métrique de la table à accepter `time_series`.**
> Toutes les autres sont `total_value` uniquement. Et — point 1 — ce
> `time_series` est justement celui qui exclut les breakdowns. Les deux
> capacités les plus intéressantes de `reach` sont mutuellement exclusives.

> ⚠️ La page de référence orthographie le breakdown de `views` **`follower_type`**
> (et non `follow_type` comme partout ailleurs). Le code du projet passe
> `follow_type` sur `views` et la requête aboutit — c'est donc très probablement
> une coquille de la doc. **Non tranché formellement**, mais ne pas « corriger »
> le code vers `follower_type` sans mesure.

**Métriques démographiques et follower :**

| Métrique | `period` | `timeframe` valides | `breakdown` | `metric_type` | Note |
|---|---|---|---|---|---|
| `engaged_audience_demographics` | `lifetime` | `last_14_days`, `last_30_days`, `last_90_days`, `prev_month`, `this_month`, `this_week` | `age`, `city`, `country`, `gender` | `total_value` | Ne supporte **pas** `since`/`until` |
| `follower_demographics` | `lifetime` | idem | `age`, `city`, `country`, `gender` | `total_value` | |
| `follows_and_unfollows` | `day` | n/a | `follow_type` | `total_value` | Indisponible sous 100 abonnés |

> Note sur les `timeframe` : le changelog du 2024-05-21 annonçait le retrait de
> `last_14_days`, `last_30_days`, `last_90_days` et `prev_month`. **La table de
> référence actuelle les liste pourtant toujours.** Contradiction non résolue
> entre changelog et référence — tester avant de s'appuyer sur l'un des deux.

**Métriques citées mais hors table (statut ambigu) :**

| Métrique | Statut |
|---|---|
| `follower_count` | Citée dans Limitations, **absente de la table**. Historique 30 j max (changelog 2020). Définition plus publiée. |
| `online_followers` | Citée dans Limitations ("only available for the last 30 days"), **absente de la table**. |
| `reached_audience_demographics` | Citée dans le changelog 2024, **absente de toutes les pages de référence**. Traiter comme retirée. |
| `impressions` | **Dépréciée** depuis le 2025-04-21, toutes versions. Remplacée par `views`. |

#### Métriques ajoutées récemment — rien d'utile ici

Le [changelog](https://developers.facebook.com/docs/instagram-platform/changelog)
du 2025-12-03 introduit `reels_skip_rate`, `reposts`, `crossposted_views`,
`facebook_views`. Le 2026-04-22 ajoute `total_like_count`,
`total_comments_count`, `total_views_count` et trois champs d'engagement sur IG
Media. Le 2026-06-22 ajoute `link_clicks` sur les Stories (Facebook Login
uniquement).

**Aucun de ces ajouts ne concerne le reach, la ventilation par statut
d'abonnement, ni un ratio de portée.** Rien à récupérer de ce côté.

---

### Ce que ça change pour le projet — synthèse actionnable

| Décision | Verdict |
|---|---|
| Graphique d'évolution de la ventilation | ✅ Faisable, **par accumulation en base** — l'appel `time_series` ne peut pas la fournir. C'est déjà l'architecture. Aucun changement d'appel API. |
| Changer la période affichée (28 j) | ⚠️ Possible jusqu'à **365 jours maximum** pour le breakdown. Au-delà, chiffres faux et silencieux. Plafonner dans le code. |
| Dénominateur du « Followers reach rate » | ⚠️ `followers_count` d'aujourd'hui est **le seul disponible via l'API**. Amélioration possible uniquement si les abonnés sont historisés en base par le cron — à vérifier. |
| Basculer vers une métrique officielle de taux | ❌ **N'existe pas.** Calcul maison obligatoire. |
| Récupérer `reached_audience_demographics` | ❌ Retirée de la doc sans annonce. Et n'aurait pas répondu au besoin. |
| Faire 28 appels/jour/élève pour une série ventilée | ❌ **Techniquement impossible** (fenêtre 1 jour = 0 + aucun breakdown) **et** hors budget à 30-40 élèves. |

### Sources primaires de cette section

- [Instagram User Insights — API reference](https://developers.facebook.com/docs/instagram-platform/api-reference/instagram-user/insights/) — table des métriques, paramètres, Limitations, phrase `time_series`
- [ig-user/insights — page miroir](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/insights/) — confirmation indépendante de la phrase `time_series` et de la définition de `reach`
- [IG User node](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user) — définition de `followers_count`
- [Instagram Platform — Insights](https://developers.facebook.com/docs/instagram-platform/insights/) — rétention 90 j (contredite par l'API)
- [Instagram Platform — Changelog](https://developers.facebook.com/docs/instagram-platform/changelog) — `follower_count` 30 j (2020-11-10), timeframes démographiques (2024-05-21), dépréciation `impressions` (2025-01-21), métriques 2025-2026

**Aucune source secondaire n'a été utilisée dans cette section.** Les quatre
points marqués « non documenté » l'ont été après vérification négative sur les
cinq pages ci-dessus.

### Pourquoi un ratio résiste à la déduplication, mais pas un taux

Mesure du 2026-08-26, 28 jours, un appel unique contre 28 appels d'un jour
additionnés :

| | Total | FOLLOWER | NON_FOLLOWER |
|---|---|---|---|
| 1 appel sur 28 j (dédupliqué) | 121 | 109 | 12 |
| 28 appels d'1 j (cumulé) | 146 | 132 | 14 |
| Écart | +21 % | +21 % | +17 % |

**Les deux catégories sont touchées de la même façon** — la déduplication n'épargne
pas les non-abonnés. Ce qui change, c'est ce qu'on en fait ensuite :

| Indicateur | Dénominateur | Dédupliqué | Cumulé | Verdict |
|---|---|---|---|---|
| Reach Non-Followers | reach (gonfle aussi) | 9,9 % | 9,6 % | **stable** |
| Followers reach rate | abonnés (fixe) | 43 % | 52 % | **fausse de 9 pts** |

Quand numérateur et dénominateur gonflent ensemble, le gonflement s'annule dans la
division. Quand le dénominateur est fixe (le nombre d'abonnés), il passe en entier
dans le résultat.

**Conséquence pratique** : le *Followers reach rate* doit impérativement rester sur
la valeur dédupliquée de l'API. Avec du cumulé, un même abonné vu plusieurs fois est
compté plusieurs fois et le taux peut dépasser 100 %, ce qui n'a aucun sens.

Le *Reach Non-Followers*, lui, est indifférent à la méthode : il pourrait être
alimenté depuis l'historique journalier déjà en base, sans appel supplémentaire, ce
qui rendrait possible une courbe d'évolution.

---

## Le figeage du breakdown au-delà d'un an — recherche documentaire

Recherche du 2026-08-26, **sources primaires uniquement**. Objectif : trouver dans
la documentation Meta une trace du phénomène mesuré — la somme du breakdown
`follow_type` se fige à 971 dès 367 jours pendant que `total_value` continue de
croître jusqu'à 5 505 à 540 jours, sans aucune erreur d'API.

### Résultat principal : le phénomène n'est pas documenté pour Instagram, mais il l'est pour la Marketing API

C'est le résultat le plus important de cette recherche, et il demande d'être lu
avec précaution : **Meta documente noir sur blanc, sur la Marketing API, un
comportement dont la description correspond presque mot pour mot à ce qui a été
mesuré sur Instagram.** Ce n'est pas la même API, donc ce n'est pas une preuve —
mais c'est un faisceau beaucoup plus solide qu'une simple analogie.

#### Ce que Meta annonce le 2025-03-10, effectif le 2025-06-10

> "To improve overall API performance, `reach` will no longer be returned for
> queries that apply breakdowns and use `start_date`s more than 13 months old;
> developers may leverage asynchronous jobs to request such data."
> — [Marketing API — Out-of-Cycle Changes 2025](https://developers.facebook.com/docs/marketing-api/out-of-cycle-changes/occ-2025/)

Repris dans la page de bonnes pratiques, avec le détail du comportement :

> "Responses to such requests will omit `reach` and related fields, such as
> `frequency` and `cpp`."
> — [Marketing API — Limits & Best Practices](https://developers.facebook.com/docs/marketing-api/insights/best-practices/)

Quatre éléments de cette annonce recoupent la mesure du 2026-08-26 :

| Élément documenté (Marketing API) | Mesure Instagram du 2026-08-26 |
|---|---|
| La restriction vise **`reach` spécifiquement**, pas les autres métriques | C'est bien `reach` qui décroche |
| Elle ne s'applique **que quand un breakdown est demandé** | Sans breakdown, `total_value` monte normalement jusqu'à 2 ans |
| Le seuil est une **ancienneté de `start_date`**, ~13 mois | Décrochage à 367 jours (~12 mois) |
| La dégradation est **silencieuse** (champs omis, pas d'erreur) | Aucune erreur d'API, breakdown figé |
| Motif invoqué : **« improve overall API performance »** | — |

**Ce que ça n'établit pas :** la Marketing API et l'Instagram Platform API sont
deux produits distincts, avec des pages de documentation, des versions et des
changelogs séparés. Meta n'a **jamais** publié cette restriction pour
`/{ig-user-id}/insights`. Écrire « Instagram applique la règle des 13 mois »
serait une extrapolation — elle n'est pas faite ici. Ce qui est établi, c'est que
**le mécanisme existe chez Meta, est assumé, et est délibérément silencieux.**

#### La distinction totaux / breakdowns est explicite chez Meta

Le point le plus éclairant est une annonce du 2025-10-16, effective le
2026-01-12, qui sépare formellement les deux rétentions :

> "All breakdowns for unique-count fields (like `unique_actions` and
> `cost_per_unique_action_type`) will be limited to 13-month's of historical data."
>
> "Consistent with Ads Manager behavior, total values for API fields are
> unaffected by the above changes and will continue to be available for up to
> 37 months."
> — [Blog Meta for Developers, 2025-10-16 — Ads Insights API Metric Availability Updates](https://developers.facebook.com/blog/post/2025/10/16/ads-insights-api-metric-availability-updates/)

**C'est exactement la forme du symptôme mesuré** : un total qui reste disponible
très loin dans le passé, et une ventilation qui s'arrête beaucoup plus tôt. Meta
confirme donc qu'il existe chez lui une architecture où le total et sa
ventilation n'ont **pas la même profondeur d'historique**, et que la ventilation
est la plus courte des deux.

Noter la catégorie employée : **« unique-count fields »**. `reach` est par
définition un compte de comptes uniques (« The number of unique accounts that
have seen your content ») et il est marqué *« This metric is estimated »* sur la
page de référence Instagram. Il appartient donc à la même famille de métriques
que celles visées par la restriction — celles dont la ventilation exige une
déduplication coûteuse. **Meta ne nomme cependant pas `reach` dans cette
annonce-ci**, et ne parle pas d'Instagram.

### Question 1 — limite de plage spécifique aux breakdowns : NON DOCUMENTÉ côté Instagram, DOCUMENTÉ côté Marketing API

#### Côté Instagram : vérification négative

Le mot `breakdown` n'apparaît jamais à proximité de `range`, `maximum`, `limit`,
`365`, `year` ou `date` sur aucune des pages Instagram consultées.

| Page | Ce qu'elle documente sur les plages | Limite propre au breakdown ? |
|---|---|---|
| [Instagram User Insights — API reference](https://developers.facebook.com/docs/instagram-platform/api-reference/instagram-user/insights/) | `since`/`until` définissent une plage ; repli à 24 h si absents. Section Limitations = 7 bullets (seuil 100 abonnés, `online_followers` 30 j, jeu vide au lieu de `0`, top 45 démographiques, somme démographique inférieure, latence 48 h) | **Aucune** |
| [ig-user/insights — page miroir](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/insights/) | idem ; `reach` marqué *« This metric is estimated »* | **Aucune** |
| [Instagram Platform — Insights](https://developers.facebook.com/docs/instagram-platform/insights/) | « User Metrics data is stored for up to 90 days. » Aucune mention de plage maximale, de breakdown, ni de découpage | **Aucune** |
| [Changelog Instagram Platform](https://developers.facebook.com/docs/instagram-platform/changelog) | `follower_count` 30 j (2020-11-10) ; retrait de 4 timeframes démographiques (2024-05-21) | **Aucune** |

La seule règle de plage documentée sur les breakdowns Instagram est
qualitative — quelles métriques acceptent quel breakdown — jamais quantitative.

#### Côté Facebook Page Insights : une limite de plage existe, mais elle est différente

La demande était de vérifier les pages Insights de l'API Facebook Page, les deux
APIs partageant de l'infrastructure. Il y a bien une limite documentée, mais elle
ne correspond pas au phénomène :

> "Only 90 days of insights can be viewed at one time when using the `since` and
> `until` parameters."
>
> "The value 'lifetime' means the time period for which the insights data is
> available. By default, this time period is 2 years or shorter."
> — [Page/insights — Graph API](https://developers.facebook.com/docs/graph-api/reference/insights/)

**Cette limite de 90 jours n'est pas transposable** : elle est globale (elle vaut
avec ou sans breakdown), elle vaut 90 jours et non 366, et surtout l'API
Instagram accepte manifestement des plages de 2 ans sans broncher — la mesure le
montre. C'est une limite d'un autre produit, citée ici parce qu'elle a été
cherchée et trouvée, pas parce qu'elle explique quoi que ce soit.

En revanche, la même page contient une phrase de principe qui, elle, résonne
directement avec le §1 de ce document :

> "Total page reach may not always be exactly equal to the sum of paid and
> non-paid unique values."
>
> "Total page reach may not always be exactly equal to the sum of `viral_unique`
> and `organic_unique`."
> — [Page/insights — Graph API](https://developers.facebook.com/docs/graph-api/reference/insights/)

**C'est la confirmation officielle la plus proche qu'on ait du principe « la somme
d'une ventilation de reach n'égale pas forcément le total ».** Meta l'écrit pour
les Pages Facebook, pas pour Instagram — mais il l'écrit. Cela valide l'écart de
1 à 2 unités observé sur les fenêtres courtes (§ Déduplication). **Cela n'explique
pas le décrochage à 56 %**, qui est d'une tout autre nature.

### Question 2 — bug report ou discussion officielle : NON TROUVÉ

Aucun fil du forum communautaire ni entrée du bug tracker décrivant ce figeage
n'a pu être trouvé.

**Termes cherchés** (via recherche restreinte à `developers.facebook.com` et
recherche ouverte) : `breakdown stuck`, `breakdown not updating large date range`,
`follow_type breakdown incorrect`, `insights breakdown sum mismatch`,
`follow_type breakdown wrong values long period`, `instagram insights breakdown
one year limit reach frozen`, `breakdown reach follower non_follower` sur
`developers.facebook.com/support/bugs`.

**Le seul fil pertinent trouvé** porte sur un tout autre symptôme :

> [The follows_and_unfollows metric, follow_type breakdown not returned for the
> last two days](https://developers.facebook.com/community/threads/297985066648003/)

Il concerne une absence de données sur les **deux derniers jours** (donc la
latence de 48 h documentée), sur la métrique `follows_and_unfollows`, et non un
figeage sur longue plage. Plusieurs développeurs confirment le symptôme, **aucune
réponse officielle Meta** n'y figure. Sans rapport avec le phénomène étudié, cité
pour être complet.

**Limite méthodologique à assumer :** le moteur de recherche du forum Meta n'est
pas interrogeable directement par URL (`/community/threads/?q=...` renvoie un
404). La couverture repose donc sur l'indexation par les moteurs de recherche,
qui est notoirement partielle sur ce forum. **Une absence de résultat ici ne
prouve pas l'absence de fil** — elle prouve seulement qu'aucun fil n'est
accessible par ces chemins.

### Question 3 — limite de buckets ou de points de données : NON DOCUMENTÉ

Aucune limite de nombre de buckets, de lignes ou de points agrégés n'est
documentée pour les breakdowns Instagram. Termes cherchés : `maximum number of`,
`aggregation limit`, `buckets`.

Les seules limites de cardinalité trouvées chez Meta sont ailleurs et d'une autre
nature :

- **Instagram, démographiques uniquement** : *« Demographic metrics only return
  the top 45 performers »* — [Instagram User Insights](https://developers.facebook.com/docs/instagram-platform/api-reference/instagram-user/insights/).
  C'est une limite sur le **nombre de valeurs distinctes** d'un breakdown (45
  villes, 45 pays…), pas sur le nombre de jours agrégés. `follow_type` n'a que 3
  valeurs possibles, il n'est structurellement pas concerné.
- **Marketing API** : *« Avoid account-level queries that include high cardinality
  breakdowns such as `action_target_id` or `product_id`, and wider date ranges
  like lifetime »* — [Limits & Best Practices](https://developers.facebook.com/docs/marketing-api/insights/best-practices/).
  Là encore, la cardinalité visée est celle des **valeurs du breakdown**, pas celle
  des journées.

**L'hypothèse « 366 = nombre maximal de buckets journaliers » n'a donc aucun
appui documentaire.** Elle est plausible et cohérente avec la mesure, mais
strictement rien chez Meta ne l'énonce. À traiter comme une hypothèse non
vérifiée, pas comme une explication.

### Question 4 — changements de changelog sur les breakdowns : RIEN côté Instagram, DEUX ENTRÉES côté Marketing API

#### Changelog Instagram Platform — vérification négative

Aucune entrée de 2024, 2025 ou 2026 ne mentionne `breakdown`, `total_value` ou
`metric_type`. La seule entrée touchant une plage temporelle est celle déjà
connue :

> 2024-05-21 — "The `last_14_days`, `last_30_days`, `last_90_days` and
> `prev_month` timeframes will no longer be supported for the
> `reached_audience_demographics` and `engaged_audience_demographics` metrics."
> — [Changelog Instagram Platform](https://developers.facebook.com/docs/instagram-platform/changelog)

Elle vise les métriques démographiques, pas `reach`, et retire des `timeframe`
nommés — pas une plage `since`/`until`.

**Conclusion : le décrochage à 367 jours n'a été annoncé nulle part pour
Instagram.** Ce n'est pas une régression documentée.

#### Changelog Marketing API — deux entrées, toutes deux dans le sens du phénomène

| Date annonce | Effet | Contenu |
|---|---|---|
| 2025-03-10 | **2025-06-10** | `reach` n'est plus renvoyé pour les requêtes **avec breakdown** dont le `start_date` a plus de **13 mois**. Champs omis, pas d'erreur. [Source](https://developers.facebook.com/docs/marketing-api/out-of-cycle-changes/occ-2025/) |
| 2025-10-16 | **2026-01-12** | Breakdowns des **unique-count fields** limités à **13 mois** ; breakdowns horaires à 13 mois ; `frequency_value` à 6 mois ; **totaux inchangés à 37 mois**. [Source](https://developers.facebook.com/blog/post/2025/10/16/ads-insights-api-metric-availability-updates/) |

Deux annonces indépendantes, à sept mois d'intervalle, qui vont dans le même
sens : **chez Meta, en 2025-2026, les ventilations des métriques de comptage
unique voient leur profondeur d'historique réduite, pendant que les totaux la
conservent.** La mesure du 2026-08-26 sur Instagram est le même motif. Le lien
reste **une convergence, pas une preuve** — le changelog Instagram est muet.

### Question 5 — recommandation de découpage (chunking) : DOCUMENTÉ, mais pour la Marketing API seulement

Meta recommande explicitement le découpage, en plusieurs endroits — tous sur la
Marketing API :

> "When it times out, try to break down the query into smaller queries by using
> filters like date range."
>
> "Limit your query by limiting the date range or number of ad ids."
>
> "Avoid account-level queries that include high cardinality breakdowns such as
> `action_target_id` or `product_id`, and wider date ranges like lifetime."
>
> "Use `date_preset` if possible. Custom date ranges are less efficient to run in
> our system."
> — [Marketing API — Limits & Best Practices](https://developers.facebook.com/docs/marketing-api/insights/best-practices/)

Une recommandation proche existe sur les Page Insights :

> "NOTE: If your request times out or some metrics are not returned, try reducing
> the number of metrics in your API request."
> — [Page/insights — Graph API](https://developers.facebook.com/docs/graph-api/reference/insights/)

**Côté Instagram Platform : rien.** Aucune des pages consultées ne recommande de
découper une requête `/{ig-user-id}/insights` en fenêtres plus courtes. Termes
cherchés : `split your request`, `smaller date ranges`, `chunk`.

**Attention au piège pratique :** le chunking est de toute façon **inapplicable
ici**, et ce point est déjà tranché par la mesure plus haut dans ce document —
une fenêtre d'une seule journée renvoie `total=0` et aucun breakdown. Découper
365 jours en 365 appels d'un jour ne produirait rien d'exploitable, et découper
en tranches de 366 jours ne permettrait pas de recoller les morceaux, puisque
`reach` est dédupliqué sur la fenêtre : additionner deux ventilations de 366
jours ne donne pas la ventilation de 732 jours. **La seule voie reste
l'accumulation en base**, déjà en place.

### Ce que la recherche ne permet toujours pas d'affirmer

À ne pas combler par déduction, même si l'explication est tentante :

1. **Que le seuil Instagram soit « 13 mois » ou une quelconque valeur voulue.** La
   mesure donne 366/367 jours (~12 mois). Le 13 mois documenté est celui d'une
   autre API. Le chiffre qui fait foi pour le code est **la mesure**, pas
   l'analogie.
2. **Que le mécanisme soit le même.** Sur la Marketing API, Meta *omet* les champs.
   Sur Instagram, la mesure montre un breakdown **figé à une valeur non nulle**
   (971) qui n'évolue plus — ce n'est pas une omission, c'est un plafonnement.
   Les deux comportements ne sont pas identiques.
3. **Que 971 corresponde à la ventilation d'une fenêtre de 366 jours.** La mesure
   montre que 366 j donne bien 971, ce qui rend l'hypothèse « le breakdown est
   silencieusement plafonné à 366 jours » très cohérente — mais aucune source ne
   la confirme, et une coïncidence de valeur n'est pas une démonstration.
4. **Que le comportement soit stable dans le temps.** Rien n'étant documenté, rien
   n'empêche Meta de le changer sans annonce — comme pour `period=week` et
   `reached_audience_demographics`, disparus sans entrée de changelog.

**Conséquence opérationnelle, inchangée et renforcée : plafonner dans le code
toute requête `breakdown=follow_type` à 366 jours.** La recherche documentaire ne
fournit aucune garantie de substitution, et Meta a démontré à deux reprises en
2025 qu'il dégrade ce type de requête **silencieusement**. Un garde-fou dans le
code est la seule protection.

### Sources de cette section

**Primaires — Instagram Platform :**
- [Instagram User Insights — API reference](https://developers.facebook.com/docs/instagram-platform/api-reference/instagram-user/insights/)
- [ig-user/insights — page miroir](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/insights/)
- [Instagram Platform — Insights](https://developers.facebook.com/docs/instagram-platform/insights/)
- [Instagram Platform — Changelog](https://developers.facebook.com/docs/instagram-platform/changelog)

**Primaires — autres produits Meta (à ne pas confondre avec l'API Instagram) :**
- [Page/insights — Graph API](https://developers.facebook.com/docs/graph-api/reference/insights/) — 90 j de plage max, 2 ans de rétention, somme des ventilations ≠ total
- [Marketing API — Limits & Best Practices](https://developers.facebook.com/docs/marketing-api/insights/best-practices/) — `reach` + breakdown > 13 mois, omission silencieuse, jobs asynchrones, recommandations de découpage
- [Marketing API — Out-of-Cycle Changes 2025](https://developers.facebook.com/docs/marketing-api/out-of-cycle-changes/occ-2025/) — annonce du 2025-03-10
- [Blog Meta for Developers, 2025-10-16 — Ads Insights API Metric Availability Updates](https://developers.facebook.com/blog/post/2025/10/16/ads-insights-api-metric-availability-updates/) — breakdowns unique-count 13 mois vs totaux 37 mois
- [Marketing API — Breakdowns](https://developers.facebook.com/docs/marketing-api/insights/breakdowns/) — vérifié, ne contient pas de limite de plage

**Forum communautaire :**
- [The follows_and_unfollows metric, follow_type breakdown not returned for the last two days](https://developers.facebook.com/community/threads/297985066648003/) — symptôme différent (latence 48 h), aucune réponse Meta

**Aucune source secondaire n'a été utilisée dans cette section.**

### Résumé

1. **Limite de plage propre aux breakdowns — NON DOCUMENTÉ pour Instagram** (vérifié : référence Insights, page miroir, page Insights généraliste, changelog) ; **DOCUMENTÉ pour la Marketing API** : `reach` + breakdown > 13 mois n'est plus renvoyé ([occ-2025](https://developers.facebook.com/docs/marketing-api/out-of-cycle-changes/occ-2025/)), et breakdowns unique-count 13 mois vs totaux 37 mois ([blog 2025-10-16](https://developers.facebook.com/blog/post/2025/10/16/ads-insights-api-metric-availability-updates/)) — même motif, autre API, donc convergence et non preuve.
2. **Bug report ou fil officiel — NON TROUVÉ** (4 formulations de symptôme cherchées sur le forum et le bug tracker ; seul fil proche = latence 48 h sur `follows_and_unfollows`, sans réponse Meta ; le moteur du forum n'étant pas interrogeable par URL, l'absence n'est pas concluante).
3. **Limite de buckets ou de points de données — NON DOCUMENTÉ** (`maximum number of`, `aggregation limit`, `buckets` : seules trouvailles = top 45 démographiques et cardinalité des valeurs de breakdown, aucune limite sur le nombre de jours agrégés).
4. **Changelog — RIEN sur les breakdowns Instagram en 2024-2026** ; deux entrées Marketing API en 2025 réduisant la profondeur des breakdowns tout en préservant les totaux.
5. **Chunking — DOCUMENTÉ pour la Marketing API et les Page Insights, PAS pour Instagram** ; et inapplicable ici de toute façon, `reach` étant dédupliqué sur la fenêtre.

---

## Mesures complémentaires du 2026-08-26 — ce n'est pas un « figeage »

Tests poussés à la demande de Chris. Ils **requalifient** le phénomène décrit
plus haut : ce n'est pas la largeur de la fenêtre qui pose problème, c'est
**l'ancienneté des données demandées**.

### Le breakdown ne bouge plus du tout au-delà d'un an

| Fenêtre | Total | FOLLOWER | NON_FOLLOWER |
|---|---|---|---|
| 400 j | 2 231 | 167 | 806 |
| 500 j | 4 551 | 167 | 806 |
| 600 j | 9 901 | 167 | 806 |
| 700 j | 12 308 | 167 | 806 |
| 729 j | 12 732 | 167 | 806 |

Strictement constant sur 329 jours de fenêtres différentes, pendant que le total
est multiplié par 5,7. Écart final : **93 %**.

### Test décisif : fenêtres de largeur CONSTANTE, décalées dans le passé

C'est ce test qui tranche. Toutes ces fenêtres font exactement 300 jours :

| Période | Total | FOLLOWER | NON_FOLLOWER |
|---|---|---|---|
| 2025-10-30 → 2026-08-26 | 760 | 161 | 601 |
| 2025-07-22 → 2026-05-18 | 2 155 | 146 | 736 |
| 2025-04-13 → 2026-02-07 | 4 227 | 129 | 459 |
| 2025-01-03 → 2025-10-30 | 9 309 | 105 | 197 |
| 2024-09-25 → 2025-07-22 | 10 445 | **—** | **—** |

À largeur identique, la ventilation se dégrade puis **disparaît entièrement**
quand la fenêtre recule. Ce n'est donc pas une limite de largeur.

### Où la ventilation s'arrête exactement

Fenêtres de 7 jours placées de plus en plus loin :

| Début de fenêtre | Total | Ventilation |
|---|---|---|
| 2025-08-29 | 70 | FOLLOWER 59, NON_FOLLOWER 11 |
| 2025-08-19 | 1 491 | FOLLOWER 9, NON_FOLLOWER 127 |
| **2025-08-14** | 7 | **AUCUNE** |
| 2025-08-09 | 9 | **AUCUNE** |
| 2025-07-25 | 9 | **AUCUNE** |

**La ventilation n'existe plus avant ~2025-08-14**, soit environ 367 jours avant
la mesure. Le reach total, lui, remonte à 2 ans.

Le « figeage à 971 » n'était donc pas un bug : c'est **toute la ventilation
disponible**, celle des 12 derniers mois. Sur une fenêtre de 500 jours, Meta
totalise 500 jours mais ne ventile que la partie récente qu'il détient encore.

### Rapprochement avec la doc Marketing API — analogie, pas preuve

Meta documente sur la **Marketing API** (annonce 2025-10-16, effet 2026-01-12) :

> "All breakdowns for unique-count fields will be limited to 13 month's of
> historical data" — "total values for API fields are unaffected […] up to
> 37 months"

Deux rétentions distinctes, la ventilation plus courte que le total : c'est la
forme exacte du symptôme mesuré ici.

⚠️ **Ce n'est pas une preuve.** Marketing API et Instagram Insights sont deux
produits, deux changelogs. Rien n'est documenté côté Instagram — zéro occurrence
de `breakdown` dans le changelog 2024-2026. Ce qui fait foi pour le code reste la
mesure (~367 jours), pas l'analogie (13 mois).

### Effet des périodes sur les deux indicateurs

Mesure sur le compte de test (255 abonnés) :

| Fenêtre | Total | FOLLOWER | Followers reach rate | Part non-abonnés |
|---|---|---|---|---|
| 7 j | 28 | 23 | 9,0 % | 17,9 % |
| 28 j | 124 | 109 | 42,7 % | 12,1 % |
| 90 j | 212 | 137 | 53,7 % | 36,3 % |
| 180 j | 272 | 149 | 58,4 % | 46,7 % |
| 365 j | 826 | 167 | 65,5 % | 80,8 % |

**Ces deux indicateurs ne sont pas comparables d'une période à l'autre.** Plus la
fenêtre est longue, plus le taux monte, parce qu'on accumule des personnes
distinctes. « 43 % ce mois-ci » contre « 65 % cette année » n'est pas une baisse :
ce sont deux questions différentes (« qui m'a vu ce mois-ci » contre « qui m'a vu
au moins une fois cette année »).

`FOLLOWER` plafonne à 167 pour 255 abonnés : la déduplication fait converger vers
« le nombre d'abonnés distincts touchés au moins une fois », qui ne peut jamais
dépasser le nombre d'abonnés.

### Conséquence pour la navigation par périodes

| Période demandée | Faisable ? |
|---|---|
| 7 j, 28 j, mois en cours, mois précédent | ✅ |
| « la semaine d'il y a 6 semaines », « il y a 3 mois » | ✅ — `since`/`until` sont libres |
| 90 j, 6 mois, 12 mois | ✅ |
| **All-Time** | ❌ **pour la ventilation** — inexistante au-delà de ~12 mois |

---

## Faisabilité d'un historique par période — validé le 2026-08-26

Tests menés pour valider une conception proposée par Chris : la période en cours
se met à jour chaque jour, puis se fige une fois terminée.

### La fenêtre qui grandit — validé

| Fenêtre demandée | Total | FOLLOWER | NON_FOLLOWER |
|---|---|---|---|
| 1er → 1er août | 1 | 1 | 0 |
| 1er → 13 août | 7 | 3 | 4 |
| 1er → 20 août | 115 | 106 | 9 |
| 1er → 26 août | 122 | 109 | 13 |

### Le backfill rétroactif — validé

Mois complets déjà terminés, interrogés aujourd'hui :

| Mois | Total | FOLLOWER | NON_FOLLOWER |
|---|---|---|---|
| mai 2026 | 107 | 76 | 31 |
| juin 2026 | 120 | 93 | 28 |
| juillet 2026 | 143 | 103 | 41 |

Les semaines ISO (lundi → dimanche) fonctionnent également. **Une journée manquée
par le cron est donc rattrapable**, en rejouant l'appel sur les dates exactes —
mais seulement dans la fenêtre de 12 mois où la ventilation existe.

### Le nombre d'abonnés à une date passée — deux chemins

`followers_count` est un instantané : l'API ne donne que la valeur du jour. Mais
la métrique `follower_count` (insights, singulier) donne les **gains quotidiens**,
ce qui permet de remonter le temps depuis la valeur actuelle.

Reconstruction confrontée à `analytics_daily_snapshots.ig_followers` :
**9 jours exacts sur 14, écart maximum 1 abonné** (0,4 % sur 255).

En pratique la base historise déjà `ig_followers` (112 jours sur 112) ; la
reconstruction n'est utile que pour un trou de collecte total.

### Les valeurs ne dérivent pas après coup

Reach journalier capté par le cron le jour même, comparé à ce que l'API répond
aujourd'hui : **9 jours sur 9 identiques**. Figer en fin de période est donc
fiable.

⚠️ Mesuré sur un compte à faible volume. Non vérifié sur un compte très actif.

### ⚠️ La journée de Meta ne commence pas à minuit Paris

Les `end_time` renvoyés sont systématiquement à **07:00 UTC**, soit 09:00 à Paris
en été — signature du fuseau Pacifique (minuit PDT = 07:00 UTC).

Meta cale les bornes `since`/`until` sur ses propres journées. Impact mesuré sur
juillet 2026 :

| Convention de bornes | Total | FOLLOWER |
|---|---|---|
| minuit Paris | 143 | 103 |
| minuit UTC | 143 | 103 |
| 07:00 UTC (bascule Meta) | 144 | 104 |

**Écart d'une unité sur 143** (0,7 %). Effet de bord réel mais négligeable ; il
ne justifie pas de tordre les bornes de période, qui doivent rester lisibles pour
le coach (un mois va du 1er au 31).

### Le figeage n'est pas une optimisation, c'est une nécessité

La ventilation disparaissant au-delà de ~12 mois, une stat de période non stockée
devient **irrécupérable** un an plus tard. Le backfill est possible, mais lui
aussi borné à 12 mois : passé ce délai, un trou est définitif.

### Infrastructure existante

`lib/period.ts:93` expose déjà `getPeriodWindow(periodIndex, 'week'|'month')`,
qui rend `periodStart`, `periodEnd` et `isCurrentIncomplete` en heure de Paris.
**Définition unique dans tout le dépôt** — aucune copie divergente à réconcilier.
