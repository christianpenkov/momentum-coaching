# Instagram — audit complet du 2026-08-22

Même méthode que [YouTube](./youtube-scalabilite.md) : chaque métrique remontée
API → base → écran, recoupée contre une réponse d'API réelle et une capture.

---

## Le défaut le plus grave : un chiffre inversé

L'écran affichait **« Followers reach rate 0 % »** et **« Reach non-followers
100 % »**. L'API dit l'inverse : **121 abonnés touchés contre 14 non-abonnés**,
soit **48 %**.

**Cause** : la requête omettait `since`/`until`, sur la foi d'un commentaire
affirmant qu'ils n'étaient pas acceptés pour cette métrique. C'était faux.

```
sans since/until : { NON_FOLLOWER: 1 }                  -> 0 %
avec since/until : { FOLLOWER: 121, NON_FOLLOWER: 14 }  -> 48 %
```

Sans les bornes, Meta **ignore le `period=days_28`**, répond `period: day` et ne
renvoie **qu'une journée** — celle-ci n'avait qu'un non-abonné.

Le code posait en plus `0` dès que la clé `breakdowns` existait, même vide :
« 0 % » s'affichait là où « N/D » était prévu.

---

## Les métriques jamais collectées

`ig_views` était **vide sur les 107 jours** du profil de test. Le cron demandait
`views` **sans** `metric_type=total_value` : Meta acceptait la requête et ne
renvoyait aucune série, sans erreur.

⚠️ **Les deux formes ne prennent pas les mêmes métriques** :

| Métrique | Sans `total_value` | Avec `total_value` |
|---|---|---|
| `reach` | ✅ | ✅ |
| `follower_count` | ✅ | ❌ réponse vide |
| `views` | ❌ aucune série | ✅ 271 sur 7j |
| `profile_links_taps` | ❌ | ✅ (0 sur ce compte) |
| `website_clicks` | ❌ | ✅ (0 sur ce compte) |
| `impressions` | **supprimée de l'API** (HTTP 400) | — |

D'où la séparation en deux appels.

**Métriques disponibles et toujours non collectées** (aucune colonne pour les
stocker) : `profile_views` (19), `likes` (14), `comments` (1), `shares` (6),
`replies` (1) sur 7 jours.

---

## Deux copies de la même logique, une seule à jour

La ventilation du reach n'était collectée que par `lib/ig-fetch.ts` (Node,
backfill de première connexion). Les colonnes s'arrêtaient donc au **27 juillet**,
date de la dernière connexion. Le cron Deno ne la demandait pas.

Même motif pour le **rafraîchissement du jeton**, présent en trois exemplaires
(`poll-leads`, `poll-stories`, `lib/ig-fetch`) avec le même défaut dans chacun.

---

## Le jeton qui expirait en silence

```javascript
const needsRefresh = integ.expires_at && ...   // ❌
```

`expires_at` **NULL** veut dire « on ne sait pas quand il expire », pas « il
n'expire jamais » — un jeton Instagram longue durée vaut 60 jours. Avec cette
condition, un NULL la rendait toujours fausse : le jeton n'était jamais rafraîchi.

Constaté sur un profil dont la collecte s'était arrêtée depuis **5 jours**, avec
`last_snapshot_status` toujours à `ok` et aucune erreur tracée.

⚠️ Le même motif existe pour **Stripe, Calendly, Fathom et YouTube**. Il n'y est
**pas** corrigé : un jeton Stripe Connect n'expire réellement jamais, et forcer un
rafraîchissement y serait un appel inutile. La correction ne vaut que là où
l'absence de date est forcément une anomalie.

---

## Quota : structurellement différent de YouTube

| | YouTube | Instagram |
|---|---|---|
| Quota | 10 000 unités/jour | **4800 × impressions sur 24 h** |
| Partagé ? | **oui**, entre tous les élèves | **non**, par utilisateur |
| Risque | saturation collective | faible, sauf compte sans audience |

Le quota Instagram **grandit avec l'audience du compte**. La saturation n'est pas
le risque immédiat (`x-app-usage` mesuré à 0 %), mais émettre 864 appels par jour
et par profil pour des chiffres qui changent une fois par jour rapproche du
plafond sans aucun gain de fraîcheur.

**Cadence passée à une synchronisation par heure : 869 → 125 appels/jour, 7× moins.**

Le collecteur de leads et de DM n'est **pas** ralenti : il doit réagir vite.

---

## Rattrapage des trous

43 journées de reach manquaient sur trois profils, **sans aucun mécanisme** pour
les récupérer.

L'API accepte pourtant les dates anciennes, avec une rétention de **2 ans**
au-delà de laquelle elle répond « Metrics data is available for the last 2 years ».

`rattraperTrousIg` tourne une fois par jour, **jour par jour** (les métriques
`total_value` ne se découpent pas sur une plage), **3 journées par passage**.

> Pourquoi 3 : le rattrapage est séquentiel, 5 appels par journée, pour chaque
> profil. À 40 élèves ayant tous des trous, 5 journées mettaient le passage à
> ~112 s sur 150 de budget. À 3, on redescend à ~80 s.

Il couvre **deux cas** : `ig_reach` NULL (jamais collecté) et `ig_views` NULL sur
une journée existante (venue du backfill, qui ne peut pas récupérer ces colonnes).

---

## Vue de santé

```sql
select * from ig_sante_donnees;
```

Elle a immédiatement trouvé le profil au jeton expiré. Un profil **sans
intégration** est distingué d'une vraie panne : sans ce garde, elle signalait le
compte meta-review, déconnecté depuis des semaines.

---

## Corrections d'affichage

- **Dates de posts sans année** : un post de 2023 s'affichait « 21 août »,
  indiscernable d'un post de la semaine. Le profil de test en a de 2023 à 2026.
- **Étiquettes en All-Time** : « 30j » affiché alors que le bandeau dit
  « All-Time ». Trouvé dans **trois** composants.
- **Courbe des abonnés nets toujours verte**, même en perte : la couleur suivait
  `ig_follows_unfollows`, une colonne vide, donc toujours `>= 0`.
- **Modale de story** : 2 métriques sur 12. La route des séquences en exposait
  déjà 9 sur la même table.
- **Modale de post** : 7 sur 10.
- **Onglet Stories** : « Aucune story » affiché pendant le chargement.
- **All-Time** : ses deux requêtes n'étaient pas dans le calcul de `loading`, d'où
  un « Connecte ton compte Instagram » pendant le chargement.
- **Axe des dates** : formule locale à 9 labels, non alignée sur `graduationsDates`.

---

## Soupçons écartés après vérification

Notés ici pour ne pas les réinstruire :

- La carte de chaleur « Abonnés en ligne » **n'est pas simulée** : l'API renvoie
  de vraies valeurs horaires (64, 73, 72, 75, 91…).
- **L'absence de badge de fraîcheur est correcte** : Instagram n'a aucun retard
  (0 jour mesuré), contrairement à YouTube qui est en J-2.
- `follows` / `profile_visits` ne sont demandés que pour les posts **non-Reels**,
  ce qui est exactement ce que Meta autorise (HTTP 400 sur les Reels).
- **« Publications 30j : 0 » est exact** : le dernier post date du 23 février.

---

## Colonnes mortes — décision en attente

| Colonne | Remplissage | Lue par l'UI ? |
|---|---|---|
| `ig_impressions` | 0/107 | non — métrique **supprimée** de l'API |
| `ig_profile_taps` | 0/107 | oui (champ jamais affiché) |
| `ig_website_clicks` | 0/107 | oui (champ jamais affiché) |
| `ig_follows_unfollows` | 0/107 | oui — pilotait une couleur, corrigé |
| `ig_demographics` | 0/107 | oui — API renvoie 0 série |
| `ig_response_rate` | 0/107 | oui |
| `ig_lead_count` | 0/107 | oui |
| `video_duration_sec` (posts) | 0/971 | **aucune référence dans le code** |

Quatre colonnes de stories jamais demandées au cron : `total_views`, `replies`,
`reposts`, `link_clicks`. **Non conclu** — aucune story active au moment de
l'audit, donc impossible de tester si Meta les fournit.

---

## Commandes de contrôle

```bash
npx deno check supabase/functions/poll-leads/index.ts
npx deno check supabase/functions/poll-stories/index.ts
npx supabase functions deploy poll-leads --project-ref nvjgwtetyuatnkjihmtw --no-verify-jwt
```

```sql
select * from ig_sante_donnees;
select * from cron_runs order by ran_at desc;
```

## Le compteur d'abonnés n'etait pas un historique (2026-08-30)

`ig_followers` vient de `?fields=followers_count` — l'**etat actuel** du compte, sans
aucune date. Il etait melange aux metriques datees dans le retour de
`fetchIgDayMetrics`, et les appelants faisaient `...metrics` sur la ligne qu'ils
ecrivaient. Le nombre d'abonnes d'aujourd'hui atterrissait donc sur des dates passees —
le rattrapage remonte jusqu'a 720 jours.

Constate en base : les lignes du **22 juillet au 18 aout**, toutes ecrites le **27 aout**
par le rattrapage (`ecrit_n_jours_apres` decroit de 1 exactement chaque jour), portaient
**toutes 255 abonnes** — la valeur live ce jour-la. La colonne valait « derniere valeur
connue au moment ou la ligne a ete touchee », pas « abonnes ce jour-la ».

Les deux graphiques qui la lisent en heritaient : **Abonnes** (cumulatif) et
**Abonnes nets** (calcule en delta jour a jour, donc plat a zero).

⚠️ Sur le compte de test le degat est invisible : il est reellement reste autour de
254-256 pendant des mois. Il devient tres visible sur un compte qui gagne des abonnes,
c'est-a-dire les eleves reels.

Le chemin Node (`lib/ig-fetch.ts`, `upsertIgSnapshot`) portait **deja** la garde, avec un
commentaire decrivant le meme incident du 2026-07-06 (« 60 jours d'historique aplatis a
la meme valeur avant d'etre restaures a la main »). La copie Deno ne l'avait jamais
recue.

**Correctif** : `fetchIgDayMetrics` rend desormais `{ jour, compte }`. `compte` n'est
ecrit que sur la ligne d'aujourd'hui, jamais ailleurs. La frontiere est dans le type, pas
dans un commentaire — elle ne peut plus se reperdre a la copie suivante.

Rien a retrocorriger : l'historique existant reste tel quel et se reconstruit tout seul,
un jour a la fois. Une reconstruction retroactive serait approximative de toute facon,
`follower_count` ne comptant que les gains, pas les desabonnements.

## Cadence du bloc metriques de compte (2026-08-30)

`fetchIgDayMetrics` etait appele **deux fois par passage horaire** (hier + aujourd'hui),
soit 6 x 2 x 24 = **288 appels par jour et par eleve** — contre 36 pour les contenus
apres leur refonte.

Refetcher la journee d'HIER 24 fois n'apportait rien : la ligne du jour J est deja
ecrite toutes les heures PENDANT le jour J, sa derniere ecriture tombe vers 23 h et vaut
deja quasiment la cloture. Ce refetch ne sert qu'a recuperer l'agregation tardive de
Meta, une fois, apres minuit.

Il est desormais conditionne a `igPremierPassageDuJour`, deduit de `last_synced_at` deja
lu (aucune requete supplementaire). **288 -> 150 appels par jour et par eleve.**

### Comment ces deux corrections ont ete verifiees

`updated_at` de la ligne ne prouve rien : les blocs calls et Stripe upsertent aussi sur
`date: yesterday` a chaque passage et la font bouger. Un premier test a conclu a tort que
le garde-fou ne marchait pas.

La preuve s'obtient par **valeur sentinelle** dans la colonne visee :

| test | sentinelle | resultat |
|---|---|---|
| premier passage du jour | `ig_followers = 999` sur hier | reste 999 → l'etat du compte n'est plus ecrit sur une date passee |
| second passage du jour | `ig_views = 12345` sur hier | reste 12345 → hier n'est plus refetche |

