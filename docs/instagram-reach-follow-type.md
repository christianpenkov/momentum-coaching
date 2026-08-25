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
> 365 jours — au-delà, le breakdown se fige. Voir « Mesures du 2026-08-26 » en fin
> de document, qui fait foi sur ces points.

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
365 jours.** Le code actuel demande 28 jours, il est donc sûr.

### Aucune catégorie `UNKNOWN` observée

Sur toutes les fenêtres testées (7 j à 2 ans), seules `FOLLOWER` et
`NON_FOLLOWER` sont renvoyées. L'énumération Meta prévoit `UNKNOWN` mais elle ne
sort pas ici. Le code la trace désormais dans `webhook_debug_log` si elle
apparaît, plutôt que de l'avaler en silence.
