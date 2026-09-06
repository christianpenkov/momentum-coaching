# Handoff — les trous de collecte dans les graphiques de Mes Stats

> **ÉTAT AU 2026-09-06 — traité, sauf un point identifié en bas de page.**
> Commits `2333946` puis `bf1f0d4`. Le constat ci-dessous reste exact et vaut d'être
> lu : c'est le POURQUOI. Mais les points 1 et 3 de « Ce qu'il reste à faire » sont
> faits, et le point 2 l'est à deux cartes près — voir **« Ce qui reste vraiment »**
> tout en bas. Ne pas repartir du début.

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

## Ce qu'il reste à faire

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

## Ce qui reste vraiment

**Deux cartes de la Vue générale : « Reach Instagram » et « Vues YouTube ».**

Elles ne lisent pas seulement la série : hors du mode 7 jours, elles prennent un total
**pré-calculé dans la charge utile** — `ig.reach30d` et `yt.views30d`, produits par
`sum()` dans `app/api/instagram/stats/route.ts`. Ce `sum()` rend `0` quand toutes les
lignes sont nulles, donc l'invention de zéro survit là.

Les rendre « Non mesuré » suppose donc de **changer le contrat de la route** : que
`reach30d` / `views30d` puissent valoir `null`, et de traiter ce `null` chez tous leurs
lecteurs. C'est un lot à part, pas un oubli.

⚠️ **Ne pas le faire à moitié.** Ne convertir que la branche « 7 jours » (celle qui
somme la série) produirait « Non mesuré » en 7 jours et « 0 » en 30 jours **sur la
même carte** — un comportement qui change avec le sélecteur est pire que l'invention
uniforme qu'on cherche à corriger.

**Point de départ** : `components/analytics/PageClientStats.tsx`, `const igReach =` et
`const ytViews =` (chercher `reach30d ||`), et `const reach30d = sum(...)` dans la
route.

### Et trois cartes de plus, même cause (relevé le 2026-09-06 par la session Stats Clients)

**« Likes », « Commentaires » et « Partages » de l'onglet YouTube**, lignes ~4063-4065.

Elles sont écrites correctement — `v !== null ? … : 'Non mesuré'` — et leur valeur de
période (`ytLikesP`, `ytCommentsP`, `ytSharesP`) passe bien par `sommeFlux`. Mais elles
choisissent leur source :

```ts
const v = ytIsFallback ? yt.likes30d : ytLikesP;
```

`yt.likes30d` est typé `number` dans `YTStats` (ligne ~127), jamais `null`. Donc dès que
`ytIsFallback` vaut vrai — `!sinceConnection && periodIndex === 0 && !ytCurrentPeriodTotals`,
ligne ~11629 — la condition `v !== null` est **toujours** satisfaite, « Non mesuré » ne
peut pas s'afficher, et le zéro inventé passe.

C'est exactement le mode de panne des deux cartes ci-dessus : un total **pré-calculé et
non nullable** lu à la place de la série. Le même lot doit donc couvrir cinq cartes, pas
deux — et `likes30d`, `comments30d`, `shares30d` doivent devenir nullables dans `YTStats`
en même temps que `reach30d` et `views30d`.

⚠️ Le type-checker ne signale rien ici : `number !== null` est une comparaison légale
qui vaut toujours vrai. C'est pour ça que la correction du 2026-09-06 l'a manqué alors
qu'elle a trouvé les 13 autres consommateurs — TypeScript énumère les valeurs devenues
nullables, il ne signale pas celles qui auraient dû l'être.

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
