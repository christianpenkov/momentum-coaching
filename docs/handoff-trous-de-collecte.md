# Handoff — les trous de collecte dans les graphiques de Mes Stats

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

## Pièges à connaître avant de commencer

- **`viewsPending` désigne deux choses.** Côté YouTube il porte le graphe des vues
  (`ytChartSlice`, ligne 1406). Côté Instagram la route API le produit
  (`stats/route.ts:347`) mais **personne ne le lit** — le graphe IG s'appuie sur
  `reachPending`. Nommer les nouveaux drapeaux sans lever cette ambiguïté la
  reproduira.

- **Chercher le symptôme, pas le remède.** Pour vérifier la couverture, chercher
  `?? 0` sur les colonnes de snapshot — chercher `Pending` ne montrera que ce qui est
  déjà corrigé et confirmera toujours ce qu'on croit déjà.

- **Ne pas toucher aux métriques de niveau.** Elles sont déjà justes ; les passer en
  drapeau casserait le calcul de la dernière valeur non nulle.

- **Vérifier au navigateur, pas seulement au type-checker.** Sur le compte de
  Christian, sur 30 jours, aucune métrique n'est trouée : le rendu ne changera pas
  d'un pixel et une régression y serait invisible. Les trous vivent dans l'historique
  ancien et sur les autres profils.

- **Une session parallèle travaille sur `TabYouTube`** dans le même fichier
  (lignes ~3463-4699). Vérifier `git status` et la branche avant tout commit.
