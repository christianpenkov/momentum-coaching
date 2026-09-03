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

**Confirmé par la mesure le 2026-09-03**, sur un Reel réel :

```
metric=reach,views,saved           → OK, 3 metriques (224 / 399 / 0)
metric=reach,views,saved,follows   → TOUT le groupe echoue (code 100)
```

Une seule metrique non supportee fait donc perdre les trois autres.

**Ce qui l'evite dans le code (`ig-posts.ts`) :** deux jeux distincts,
`METRIQUES_REELS` et `METRIQUES_FEED`, ce dernier seul portant `follows` et
`profile_visits`. Cette separation n'est pas une precaution — elle est PORTEUSE : la
supprimer detruirait silencieusement `reach`, `views` et `saved` sur tous les Reels.

⚠️ Le paragraphe precedent annoncait « chaque metrique est demandee dans un appel
separe ». Ce n'est plus vrai : le code lit en MULTI-OBJETS groupes
(`?ids=…&fields=insights.metric(…)`), et c'est la machine a etats
(`jeu_metriques` = `reduit` / `aucun`) qui isole les echecs, pas un appel par
metrique.

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
| `follows` | `/insights` | **FEED uniquement** — refusé sur REELS par Meta (message exact plus bas). ⚠️ non monotone |
| `profile_visits` | `/insights` | **FEED uniquement** — refusé sur REELS par Meta. ⚠️ non monotone |

---

## ⚠️ `follows` et `profile_visits` ne sont PAS monotones (2026-09-03)

**Vérifié contre l'API réelle**, pas depuis la doc :
`GET graph.instagram.com/v23.0/{media-id}/insights?metric=follows,profile_visits,reach,views,total_interactions,saved,shares`
avec le jeton du projet. Les sept métriques répondent, toutes en période `lifetime`.

Donc **oui, le nombre d'abonnés gagnés est disponible PAR CONTENU** — et les visites
de profil aussi, contrairement à ce qu'affirment plusieurs guides en ligne qui les
déclarent réservées au niveau du compte.

### Refusées sur les REELS — limite Meta, pas un choix du code

Testé métrique par métrique le 2026-09-03 sur deux Reels réels (un appel groupé
qui échoue ne dit pas LAQUELLE est refusée, or c'était toute la question) :

```
GET /{reel-id}/insights?metric=follows         → 100  The Media Insights API does not
                                                     support the follows metric for
                                                     this media product type.
GET /{reel-id}/insights?metric=profile_visits  → 100  idem pour profile_visits
GET /{reel-id}/insights?metric=reach           → OK   224
GET /{reel-id}/insights?metric=views           → OK   399
```

Le doute qui figurait ici (« jamais demandé sur un Reel — comportement du code, pas
une limite Meta confirmée ») est donc **levé** : Meta refuse explicitement ces deux
métriques sur les Reels. Rien à corriger côté plateforme, et inutile de réessayer.

### Abonnés gagnés par Reel : AUCUNE voie, toutes testées (2026-09-03)

Question posée deux fois, donc creusée à fond. Tout ci-dessous est un appel réel à
Meta avec le jeton du projet. **Ne pas relancer cette recherche sans nouvelle raison.**

| Tentative | Résultat |
|---|---|
| `metric=follows` sur un Reel | `100` — *does not support the follows metric for this media product type* |
| `ig_reels_follows`, `net_follows`, `follower_count`, `accounts_engaged`, `follows_and_unfollows` sur le média | `100` — noms inexistants au niveau média |
| `profile_activity`, `profile_visits` sur un Reel | `100` — même refus par type de média |
| `metric=follows` en **v21, v22, v23, v24, v25** | refus identique dans les cinq versions |
| Compte : `follows_and_unfollows` + `breakdown=media_product_type` | `1` — *An unknown error has occurred.* sur `day`, `week`, `days_28`, avec et sans `metric_type`, avec et sans fenêtre explicite |
| Compte : la même sans `breakdown` (témoin) | ✅ répond — donc c'est bien la ventilation qui casse, pas la métrique |

#### La doc officielle dit la même chose que le test

Deux affirmations circulent et sont **fausses toutes les deux** : « les Reels ont bien
la métrique `follows` », et « il suffit d'avoir 1 000 abonnés ». Vérifié sur la page
de référence de Meta :

> `"follows"` … The number of Instagram users following your app user's Instagram
> professional account. | **FEED (posts) STORY**

Donc **FEED et STORY, jamais REELS**. Et la page ne mentionne **aucun seuil
d'abonnés** pour les métriques de média : le seul seuil qui y figure concerne les
stories vues par moins de 5 personnes (erreur 10).

Le message d'erreur du test le disait déjà : *« does not support the follows metric
for this media product type »* parle du TYPE DE MÉDIA, pas d'un volume d'audience.
Un refus de seuil se présenterait autrement. **Doc et mesure concordent** — c'est le
seul cas où l'on peut clore une question d'API.

#### Les STORIES, elles, l'ont — et on les collecte déjà

`follows` est supporté sur STORY, et `poll-stories` le demande déjà
(`reach,shares,views,follows,profile_visits,total_interactions,replies`). Les 5
stories en base portent la colonne renseignée, dont 4 avec des visites de profil non
nulles. Rien à ajouter de ce côté non plus.

⚠️ **Piège d'introspection à connaître.** Demander une métrique inexistante fait
énumérer les valeurs valides par Meta — 29 pour un média. `follows` y figure, et la
liste est **identique pour un Reel et pour une image**. Cette énumération décrit donc
le SCHÉMA de l'endpoint, pas ce qui est supporté pour ce média : le filtrage par type
se joue à un second niveau. Se fier à cette liste conduirait à croire la métrique
disponible sur les Reels.

**Conclusion : l'attribution d'un abonné à un Reel n'existe pas dans l'API**, ni par
Reel ni même par FORMAT. Le seul chemin autorisé par le validateur
(`breakdown=media_product_type`) n'est pas implémenté côté Meta.

Corollaire produit : sur un compte majoritairement en Reels, « abonnés gagnés par
contenu » est structurellement borgne. Ne pas construire de classement de contenus
là-dessus — il ne verrait que les images.

### Pourquoi la métrique manque sur un post donné — les trois causes

Relevé du 2026-09-03 sur les 32 posts du compte de test :

| Cause | Posts | Reconnaissable à |
|---|---|---|
| **REELS** — Meta refuse la métrique | 18 | `post_type = 'REELS'`, `follows` toujours NULL |
| **Publié avant le compte pro** — Meta refuse l'objet | 4 | les métriques SONT toutes NULL, pas seulement `follows` |
| Disponible | 10 | FEED publié après la conversion |

⚠️ **Correction d'une premiere lecture erronee.** J'avais attribue les 4 posts vides
a la retention de 2 ans, sur la seule correlation de leur age. Le message de Meta
dit autre chose :

```
GET /17978338856424267/insights?metric=follows,profile_visits,reach
→ 100  « Le contenu multimédia a été publié avant la conversion en compte pro »
```

La cause est donc **permanente et sans rapport avec l'age** : ces posts ne rendront
jamais rien, meme s'ils rajeunissaient. C'est le cas `posts_muets_definitif` de la
vue `ig_sante_insights_posts`, que `AGENTS.md` signale deja comme NON-anomalie.

La lecon vaut plus que le fait : deux causes produisent le meme symptome (colonnes
NULL) et l'age les correlait par hasard. **Seul le message d'erreur de Meta
distingue « trop vieux » de « publie avant le compte pro ».**

### La collecte est-elle exacte ? Oui, a l'unite

Comparaison base contre API en direct, sur les 5 posts FEED du profil actif
(2026-09-03) :

| Publié le | En base (fol/vis/reach) | API en direct | |
|---|---|---|---|
| 12/04/2025 | 0 / 8 / 307 | 0 / 8 / 307 | identique |
| 19/08/2024 | 0 / 7 / 373 | 0 / 7 / 373 | identique |
| 30/08/2024 | 0 / 1 / 212 | 0 / 1 / 212 | identique |
| 21/08/2023 | — | refusé | avant compte pro |
| 11/04/2024 | — | refusé | avant compte pro |

**3 sur 3 identiques**, zéro écart. Le cron collecte donc correctement `follows` et
`profile_visits` partout où Meta les rend — il n'y a rien à mettre a jour.

⚠️ Et il n'y a PAS de mecanisme « lire une fois puis seulement si ça bouge » : chaque
passage relit tous les posts eligibles. La machine a etats (`jeu_metriques` =
`aucun` / `reduit`) choisit QUELLES metriques demander, pas QUAND relire. Les lignes
quotidiennes sont donc de vraies relectures — ce qui est ce qui rend les baisses du
3 du mois attribuables a Meta, et non a notre cadence.

⚠️ Corollaire pour l'affichage : `follows` absent sur un Reel n'est PAS la même
chose que `follows = 0` sur un FEED. Le premier veut dire « Meta ne le dit pas », le
second « personne ne s'est abonné ». C'est pourquoi la modale de post filtre les
métriques absentes au lieu d'afficher un tiret.

### Mais Meta les fait REDESCENDRE, y compris jusqu'à zéro

Le mot `lifetime` que renvoie l'API laisse croire à un cumul qui ne peut que
monter. C'est faux. Historique d'un même post du compte de test
(`18020261033173460`), relevé dans `analytics_ig_posts_history` :

| Date | `reach` | `profile_visits` | `follows` |
|---|---|---|---|
| 21 juin → 13 juillet | 1 424 → 1 436 | 45 | **2** |
| 3 août | **417** | **9** | **0** |
| 3 septembre | **373** | **7** | 0 |

`views`, lui, reste monotone sur la même période (2 466 → 2 501). La chute ne
touche donc pas toutes les métriques : elle frappe `reach`, `profile_visits` et
`follows`.

**Les deux SEULES dates de tout l'historique portant des baisses sont le 3 août et
le 3 septembre** — le 3 du mois dans les deux cas. Piste d'une fenêtre glissante
mensuelle côté Meta malgré la période annoncée. Deux observations ne suffisent pas
à l'affirmer ; elles suffisent à ne jamais traiter un `lifetime` Meta comme
monotone.

### Conséquence pratique

État au 2026-09-03, sur les 32 posts du compte de test (dernière photo de chacun) :

| | Posts |
|---|---|
| `follows` > 0 | **0** |
| `follows` = 0 | 10 |
| `follows` absent (Reels ou trop ancien) | 22 |

⚠️ Un premier relevé annonçait « 1 post avec `follows` > 0 ». C'était une ligne
PÉRIMÉE : elle appartient au profil `dc6f6aec`, dont la dernière photo date du
29 juillet 2026 — sa collecte s'est arrêtée, la valeur est restée figée à 2. Le
même post, sur le profil dont la collecte tourne, est à 0. **Toujours vérifier la
date de la dernière photo avant de conclure qu'une métrique porte une valeur.**

Toute statistique qui DIVISE par `follows` — « vues par abonné gagné », coût
d'acquisition par contenu — sera donc vide la plupart du temps. Ce n'est pas un
défaut de collecte, et il n'y a rien à corriger côté plateforme.

⚠️ **Ne pas non plus construire de série historique sur ces trois métriques** en
supposant qu'elle est croissante : un graphique « abonnés gagnés par contenu »
afficherait une chute collective le 3 du mois, sans aucune cause côté plateforme.
Même famille que « le compteur d'abonnés n'était pas un historique » plus bas.

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
