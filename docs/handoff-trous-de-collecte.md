# Handoff — les trous de collecte dans les graphiques de Mes Stats

> **ÉTAT AU 2026-09-06 — CLOS.** Rien à reprendre.
> Commits `2333946`, `bf1f0d4`, puis les cinq dernières cartes. Le constat ci-dessous
> reste exact et vaut d'être lu : c'est le POURQUOI, et il explique des choix que le
> code seul ne justifie pas. Mais tout ce qui était « à faire » est fait — ne pas
> repartir du début, et surtout ne pas « re-corriger » un `?? 0` sans lire d'abord la
> section **« Les trois `?? 0` qui restent, volontairement »**.

**Origine** : audit de divergence entre Stats Clients (page coach) et Mes Stats
(`components/analytics/PageClientStats.tsx`), 2026-09-06. Divergence n° 2 sur 5.
Les divergences 3 à 5 (calls `declined`, calcul du cash, continuations) sont des
règles métier et sont traitées ailleurs — **ce document ne couvre QUE les trous de
collecte**.

---

## Le constat

Une colonne `NULL` dans `analytics_daily_snapshots` veut dire « le collecteur n'a
rien rapporté ce jour-là ». Elle ne veut PAS dire « la valeur était zéro ».

Les deux écrans en tirent des conclusions opposées :

| Écran | Code | Une fenêtre 100 % non collectée affiche |
|---|---|---|
| Stats Clients | `sum(s.ig_views)` — `sum()` SQL rend `NULL` si toutes les lignes le sont | un trou (courbe interrompue, raccord en pointillés) |
| Mes Stats | `snaps.reduce((s, r) => s + (r.ig_views ?? 0), 0)` | **« 0 »**, affirmé |

⚠️ **La distinction dépend de la nature de la donnée, pas d'un principe général.**
Les publications sont *énumérées* : on compte des lignes, donc l'absence de ligne
EST un zéro réel — afficher 0 y est juste (tranché le 2026-09-04). Les vues, la
portée, le temps de visionnage sont *collectés* par un cron : le silence du
collecteur ne dit rien de la valeur, et un 0 y est une invention.

---

## La parade existe déjà — pour 2 métriques sur 13

Quelqu'un a posé la règle, correctement, et n'a couvert que la première métrique de
chaque plateforme. Le commentaire en place dit mot pour mot :

> `Un 0 affirme « personne ne t'a vu », un trou dit « on ne sait pas ».`

### Protégées

| Métrique | Drapeau | Produit ligne | Consommé ligne |
|---|---|---|---|
| `ig_reach` | `reachPending` | 10263 (+ `app/api/instagram/stats/route.ts:344`) | 1425, 2276 |
| `yt_views` | `viewsPending` | 10349 | 1406 |

### NON protégées — 11 métriques de flux, toutes en `?? 0` sans drapeau

Instagram (`chartData`, ~ligne 10264) :
`views`, `accountsEngaged`, `totalInteractions`, `websiteClicks`

YouTube (`chartData`, ~ligne 10350) :
`watchTime`, `subsGained`, `subsLost`, `netSubs`, `likes`, `comments`, `shares`

### Correctes, ne pas y toucher

Toutes les métriques de **niveau** sont déjà en `?? null` : `followerCount`,
`subscribers`, `reachFollower`, `reachNonFollower`, `profileViews`,
`avgViewDurationSec`, `watchTimeShorts`, `watchTimeLong`, `avgDurationShorts`,
`avgDurationLong`, `viewsShorts`, `viewsLong`.

---

## Volume réel des trous (mesuré en base le 2026-09-06)

`analytics_daily_snapshots`, `archived_at is null`. 285 lignes, 5 profils,
du 2026-05-07 au 2026-09-06.

### Instagram

| Périmètre | Jours | portée | vues | engagés | interactions | clics site |
|---|---|---|---|---|---|---|
| Christian, 30 derniers jours | 31 | 0 | 0 | 0 | 0 | 0 |
| Christian, tout | 123 | 0 | 0 | 27 | 33 | **70** |
| Tous élèves | 285 | 113 | 114 | 141 | 147 | **184** |

### YouTube

| Périmètre | Jours | vues | temps vu | abos gagnés | abos nets | likes | comm. | partages |
|---|---|---|---|---|---|---|---|---|
| Christian | 123 | 31 | **60** | 60 | 60 | 58 | 60 | 58 |
| Tous élèves | 285 | 101 | **151** | 151 | 151 | 147 | 151 | 147 |

Découpé en semaines calendaires (vues IG) : **18 fenêtres sur 44 sont entièrement
non collectées**, 1 est partielle, 6 ont une somme réelle de zéro.

---

## Ce qu'il restait à faire — le plan d'origine

> ⚠️ **Tout est fait.** Section gardée pour la trace : elle dit ce qui avait été
> prévu, et les deux sections suivantes disent ce qui a réellement été fait et en
> quoi cela s'en écarte. Le point 3 s'est révélé incomplet — il y avait QUATRE
> chemins de données, pas deux.


1. **Ajouter le drapeau `<metrique>Pending` aux 11 métriques de flux** listées
   ci-dessus, sur le modèle exact de `reachPending` / `viewsPending`, et le
   consommer au rendu comme les deux existantes le sont déjà.

2. **Les KPI totaux (lignes 10161-10167 et 10288-10295).** Aucun chiffre ne change :
   `null ?? 0` ajoute 0 à la somme. Le seul cas à traiter est celui où **aucun** jour
   de la période n'a été collecté — le KPI affiche « 0 » aujourd'hui, il devrait dire
   « Non mesuré ». Décision produit à confirmer avec Chris avant de l'appliquer.

3. **Les deux chemins de données de Mes Stats doivent produire les mêmes drapeaux.**
   Il y en a deux : la route API `app/api/instagram/stats/route.ts` et la
   reconstruction depuis la base dans `PageClientStats.tsx`. La route produit
   `reachPending` ET `viewsPending` ; la reconstruction ne produit que `reachPending`.
   Toute métrique corrigée doit l'être **des deux côtés**, sinon le comportement change
   selon le chemin emprunté.

---

## Ce qui a été fait (2026-09-06)

### Écart de méthode assumé par rapport au point 1

Le handoff proposait 11 drapeaux `<metrique>Pending`. **Les valeurs ont été rendues
NULLABLES à la place**, comme le sont déjà les métriques de niveau. Trois raisons, et
la première suffit :

- **TypeScript énumère alors les consommateurs.** Il en a trouvé 13, tous corrigés.
  Aucun n'aurait été trouvé par relecture. Les deux drapeaux existants étaient
  d'ailleurs lus à travers des `as any` — donc invisibles au type-checker, et
  silencieux le jour où ils ont cessé d'exister.
- Un drapeau parallèle à la donnée peut diverger d'elle ; une valeur, non.
- Le piège nommé plus bas — `viewsPending` désigne deux choses — disparaît avec le
  drapeau au lieu d'être documenté.

### Fait

| | |
|---|---|
| Les 11 métriques rendent `null` | dans **les deux chemins** (route API + reconstruction), comme l'exigeait le point 3 |
| Consommateurs | sommes en `?? 0`, courbes propagent le trou |
| Heuristique YouTube | **supprimée** — elle devinait « aucune activité, donc non collecté » et marquait à tort une vraie journée à zéro vue |
| Pointillés | pont `dasharray 2 3`, opacité .45, dans `components/charts/AreaChart.tsx` |
| « Non mesuré » | 8 cartes (voir plus bas) |
| `sommeFlux` / `rienDeCollecte` | `lib/collecte.ts`, **10 tests** |

### Le rendu des trous

`pendingKey` coupait la courbe sans rien dire — son propre commentaire l'admettait :
« aucun point ni segment, pas de distinction visuelle ». Un pont en **pointillés**
enjambe désormais les trous, tracé SOUS la courbe réelle, hors légende et hors
infobulle (sinon chaque valeur s'affiche en double au survol).

⚠️ Le pont n'apparaît **qu'entre deux valeurs connues**. Les `null` de tête et de
queue — jours futurs, jours antérieurs à la mise en route — ne sont pas des trous : il
n'y a pas d'« après » à relier.

Même vocabulaire visuel que Stats Clients (`lib/grapheSvg.ts`) : deux moteurs de rendu
différents, Recharts ici et du SVG là-bas, mais un pointillé doit vouloir dire la même
chose sur les deux écrans.

### Cartes qui disent « Non mesuré »

Instagram : Interactions posts, Visites de profil.
YouTube : Vues, Watch time, Abonnés nets, Likes, Commentaires, Partages.

⚠️ **« Abonnés nets » demandait une précaution** : « +0 » dit « autant d'arrivées que
de départs », « Non mesuré » dit qu'on n'en sait rien. La couleur suit — ni vert ni
rouge sans mesure — et le solde n'existe que si ses DEUX termes ont été mesurés.

---

## Les cinq dernières cartes — faites

**Vue générale : « Reach Instagram », « Vues YouTube ». Onglet YouTube : « Likes »,
« Commentaires », « Partages ».**

Toutes les cinq avaient le même mode de panne, et c'est celui qu'il faut retenir : elles
ne lisaient pas la série, elles lisaient un **total pré-calculé** posé dans la charge
utile. Un total est le dernier endroit de la chaîne où un trou peut encore se faire
passer pour un zéro, parce que l'écran l'affiche sans jamais revoir les journalières.

Les trois cartes YouTube sont le cas le plus instructif : leur code était **déjà juste**
(`v !== null ? … : 'Non mesuré'`). C'est leur type qui mentait — `yt.likes30d` était
`number`, donc `v !== null` valait toujours vrai et « Non mesuré » était littéralement
inatteignable. Du code correct posé sur un type trop optimiste.

⚠️ **La limite de la méthode employée la veille**, et la raison pour laquelle ce lot a
existé : TypeScript énumère les valeurs devenues **nullables**, jamais celles qui
**auraient dû l'être**. `number !== null` est une comparaison légale, donc muette. Le
passage qui avait trouvé 13 consommateurs ne pouvait pas trouver ceux-là — il a fallu
remonter aux totaux pré-calculés un par un.

### Ce qui a changé

| Où | Quoi |
|---|---|
| `app/api/instagram/stats/route.ts` | les 6 totaux de flux passent par `sommeFlux` |
| `app/api/youtube/stats/route.ts` | `views/watchTime/likes/comments/shares` → `null` si l'appel Analytics a échoué |
| `fetchIgCurrentPeriodTotals` / `fetchYtCurrentPeriodTotals` | `sommeFlux` |
| `fetchSnapshot` (périodes passées) | `sommeFlux` |
| `IGStats` / `YTStats` | les totaux concernés deviennent `number \| null` |

**Les QUATRE chemins ont été corrigés ensemble**, et c'est le point à ne pas défaire :
la route API, les totaux de période courante, ceux des périodes passées, et la branche
« 7 jours » qui somme la série à la main. N'en corriger que certains ferait dire à la
**même carte** « Non mesuré » sur un mois et « 0 » sur le mois d'à côté, pour des
données également absentes — pire que l'invention uniforme qu'on corrigeait.

### Le cas YouTube n'est PAS un trou de cron

Côté Instagram le trou vient de la base : le cron n'a pas écrit. Côté YouTube, ces
totaux viennent de l'**API Analytics en direct**. Le trou y prend une autre forme, plus
fréquente : l'appel échoue (quota, jeton, 5xx Google), `analyticsData?.rows` vaut
`undefined`, `rows` devient `[]`, et tout tombe à 0. Une panne racontée comme un mois
sans audience.

La frontière retenue est le **statut de la réponse**, jamais son contenu — c'est la
seule chose démontrable. Un 200 est un témoin positif : Google a répondu, la mesure a eu
lieu, et un total de 0 est alors un vrai zéro qu'il faut afficher tel quel (chaîne
neuve, mois sans publication).

### Trois états à l'écran, pas deux

Les deux cartes de la Vue générale distinguent désormais :

| Situation | Affichage |
|---|---|
| la réponse n'est pas encore là | `—` |
| la réponse est là, aucun jour collecté | `Non mesuré` |
| la réponse est là, tout vaut zéro | `0` |

Le troisième est celui qu'il ne faut surtout pas avaler : un vrai zéro est une
information, et le confondre avec un trou, c'est refaire le bug en sens inverse.

### Vérifié sur données réelles (2026-09-06, septembre en cours)

Les deux cas coexistaient le jour même, ce qui a permis de prouver la distinction plutôt
que de la supposer :

| Profil | `ig_reach` mesuré | Somme | Avant | Après |
|---|---|---|---|---|
| Chris (coach) | **0 jour sur 6** | — | « 0 personnes » | **« Non mesuré »** |
| Dolphin | 6 jours sur 6 | **0** | « 0 » | **« 0 »** — inchangé |
| Christian | 6 jours sur 6 | 4 | « 4 » | « 4 » — inchangé |

La ligne du milieu est le vrai test : c'est celle qu'une implémentation testant la
VÉRITÉ de la valeur (`if (v)`) au lieu de sa PRÉSENCE (`v != null`) aurait cassée.

---

## Les trois `?? 0` qui restent, volontairement

Ne pas les « corriger » sans lire ceci — ils ne sont pas un oubli.

`subsGained30d`, `subsLost30d`, `netSubs30d` gardent leur `?? 0` dans les trois chemins.
Deux raisons :

1. Ils ne sont **jamais affichés bruts**. La carte « Abonnés nets » lit la série de
   période, et elle sait déjà dire « Non mesuré » (voir plus haut).
2. Côté route YouTube, ils servent à **remonter la courbe des abonnés jour par jour** en
   partant du total actuel. Un `null` y casserait la reconstitution entière au lieu de
   signaler un trou — le remède serait pire que le mal.

⚠️ Le jour où l'un des trois devient affiché directement, cette justification tombe.

---

## Pièges à connaître avant de commencer

- ~~**`viewsPending` désigne deux choses.**~~ **Caduc** : les drapeaux ont été
  supprimés au profit de valeurs nullables, l'ambiguïté est partie avec eux. Gardé ici
  parce que le raisonnement vaut pour tout drapeau futur — un drapeau qui double une
  donnée finit par en désigner une autre.

- **Chercher le symptôme, pas le remède.** Pour vérifier la couverture, chercher
  `?? 0` sur les colonnes de snapshot — chercher `Pending` ne montrera que ce qui est
  déjà corrigé et confirmera toujours ce qu'on croit déjà.

- **Ne pas toucher aux métriques de niveau.** Elles sont déjà justes ; les passer en
  drapeau casserait le calcul de la dernière valeur non nulle. **Toujours valable.**

- **Un vrai zéro n'est pas une absence.** Le piège central, et celui qu'on ne voit pas
  en relisant : une implémentation qui teste la VÉRITÉ de la valeur (`if (v)`) au lieu
  de sa PRÉSENCE (`v != null`) transforme une journée réellement à zéro en « non
  mesuré ». Sur les vues Instagram découpées en semaines, 6 fenêtres sur 44 ont une
  somme réelle de zéro — ce sont exactement celles que `null` ne doit pas avaler. Deux
  tests de `lib/collecte.test.ts` fixent ce cas ; ne pas les affaiblir.

- **Vérifier au navigateur, pas seulement au type-checker.** Sur le compte de
  Christian, sur 30 jours, aucune métrique n'est trouée : le rendu ne changera pas
  d'un pixel et une régression y serait invisible. Les trous vivent dans l'historique
  ancien et sur les autres profils.

- **Une session parallèle travaille sur `TabYouTube`** dans le même fichier
  (lignes ~3463-4699). Vérifier `git status` et la branche avant tout commit.
