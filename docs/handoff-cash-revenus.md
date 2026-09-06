# Handoff — les deux cash de l'onglet Revenus

**Origine** : audit de divergence entre Stats Clients et Mes Stats, 2026-09-06.
Divergence n° 4 sur 5. Le volet Stats Clients est **fait et poussé** (commit
`f77fe82`) ; ce document ne porte que sur **`components/analytics/PageClientStats.tsx`,
onglet Revenus**.

Ne couvre PAS les trous de collecte — c'est `docs/handoff-trous-de-collecte.md`,
un chantier distinct dans le même fichier.

---

## La règle, posée une fois

Décision de Chris, 2026-09-06, après mesure :

> Un cash **seul** se compte en **trésorerie** — l'argent arrivé pendant la période.
> Il ne change jamais après coup et correspond au relevé bancaire.
>
> Un cash **divisé par un contracté** se compte en **cohorte** — les ventes signées
> dans la période et TOUS leurs paiements. Sinon le numérateur et le dénominateur
> portent sur des ventes différentes, et le lecteur ne peut pas refaire la division
> qu'on lui montre.

Le découpage n'est donc pas un choix d'écran : il est dicté par ce qui est affiché à
côté du chiffre.

### Application aux cinq écrans (inventaire complet, vérifié)

| Écran | Fichier | Découpage | Verdict |
|---|---|---|---|
| Stats Clients (portefeuille coach) | `PageStatsClients.tsx` | cohorte | ✅ corrigé le 2026-09-06 |
| Mes Stats — vue d'ensemble | `PageClientStats.tsx:1391` | cohorte | ✅ conforme, **ne pas y toucher** |
| **Mes Stats — onglet Revenus** | `PageClientStats.tsx:6286` et `6315` | les deux, mal présentés | ⚠️ **objet de ce document** |
| Accueil élève — badge « ce mois » | `useCoachData.ts:283` | trésorerie | ✅ conforme : le badge est seul, divisé par rien |
| Fiche client + panneau messagerie | `PageClientDetail.tsx`, `ChatContextPanel.tsx` | depuis le début | ✅ sans objet : les deux découpages convergent |

⚠️ **Décision explicite de Chris** : afficher les deux montants ne se fait QUE dans
Revenus. La vue d'ensemble de Mes Stats reste en cohorte simple — c'est une rangée de
KPI de survol, et l'élève a déjà sa trésorerie du mois sur son accueil. Ne pas étendre
le motif.

---

## Le problème précis dans Revenus

Les deux nombres existent déjà et sont tous les deux justes. Ce qui ne va pas, c'est
**où** ils sont posés. La rangée compte quatre cartes :

| # | Carte | Grand chiffre | Sous-titre |
|---|---|---|---|
| 1 | Cash contracté | `cashContracte` | « deals signés (n) » |
| 2 | **Cash collecté** | `cashCollecte` — **trésorerie** | « paiements reçus (n) » |
| 3 | Panier moyen | `avgBasket` | « sur n deals » |
| 4 | Taux de cash collecté | `cashCollectePct` — **cohorte** | `« {cashCollecteCohorte} sur les deals signés »` |

Trois défauts qui s'ajoutent :

1. **Deux nombres nommés « collecté » dans la même rangée**, portant sur des ensembles
   différents, sans que rien ne les distingue au premier regard.
2. **Ils sont séparés par « Panier moyen »**, donc rien ne suggère qu'ils se répondent.
3. **Le montant de la cohorte vit en 10 px `var(--faint)`**, en sous-titre d'une carte
   de *pourcentage* — la place la moins lisible de la rangée pour un montant en euros.

Le commentaire déjà présent au-dessus de la carte 4 nomme le problème lui-même :

> `Le sous-titre dit quels deals sont comptés : sans ça, deux nombres « collectés »`
> `différents cohabitent sur la même rangée de cartes`

La parade retenue à l'époque a été un sous-titre. Chris a tranché le 2026-09-06 : il
faut une structure, pas une glose.

---

## Ce qu'il faut faire

Rendre les deux notions explicites et lisibles, sans en supprimer aucune et sans
changer un seul calcul — `cashCollecte` (trésorerie) et `cashCollecteCohorte`
(cohorte) sont corrects tels quels.

La forme validée visuellement par Chris (maquette du 2026-09-06) est une carte qui
porte les deux, sur le modèle :

```
CASH COLLECTÉ
0 €                     ← trésorerie : l'argent arrivé pendant la période
arrivé sur la période
─────────────────────
Ventes de la période      2 100 €     ← contracté
rentré à ce jour          2 100 € · 100 %   ← cohorte + son taux
```

Libre à l'exécutant d'adapter à la rangée de quatre cartes existante plutôt que de la
casser — l'exigence n'est pas la maquette, c'est que **les trois nombres soient
nommés sans ambiguïté et qu'aucun ne soit relégué en sous-titre d'une carte qui parle
d'autre chose**.

⚠️ Vocabulaire à employer, validé avec Chris — ces trois phrases veulent dire trois
choses différentes et ne doivent pas être interverties :
- « arrivé sur la période » → trésorerie
- « ventes de la période » → contracté
- « rentré à ce jour » → cohorte. **C'est la seule des trois qui bouge dans le temps** :
  la même période affichera davantage le mois prochain, quand les échéances tomberont.

---

## Fait le 2026-09-06 — et une correction à mon propre compte rendu

Livré (commits `26fc019` puis le suivant) : les trois montants sont des grands
chiffres sous un titre qui dit leur question — **Cash contracté**, **Cash arrivé**,
**Cash rentré** — le taux passe en sous-titre du montant qu'il décrit, et « Panier
moyen » descend en quatrième position pour cesser de couper les deux cartes qui se
répondent. La colonne « Encaissé » du tableau devient « Rentré » : elle totalise
exactement cette carte, elle doit porter son mot. **Aucun calcul modifié.**

### ⚠️ Les valeurs de contrôle de ce document sont fausses, et pas parce qu'elles ont vieilli

Il annonçait « sem. 10 août : 0 € trésorerie, 2 100 € cohorte ». La cohorte y vaut
**0**.

J'ai d'abord écrit que le document avait été rédigé avant que le litige n'arrive.
**C'était faux** : les deux lignes de la vente contestée sont créées le 5 septembre à
19 h 24, donc antérieures aux deux mesures.

La vraie cause est une requête de contrôle qui faisait `succeeded − refunded` **sans
déduire `disputed`** — l'erreur exacte que `lib/dealCash.ts` existe pour empêcher,
reproduite dans l'outil censé la vérifier.

Deux leçons, et la seconde est la plus coûteuse à réapprendre :

- **Ne jamais sommer les paiements à la main, y compris dans une requête de
  vérification.** Une requête qui les somme n'est pas un contrôle, c'est une
  implémentation de plus de la règle, non testée. Voir `AGENTS.md`, section sur
  `lib/dealCash.ts`.
- **Devant deux mesures qui divergent, ne pas accuser l'horloge avant d'avoir comparé
  les deux requêtes.** « Les données ont bougé depuis » est confortable et
  invérifiable ; ici c'était faux, et ça masquait le vrai défaut.

### Valeurs à utiliser pour juger le rendu (mesurées avec les trois statuts déduits)

| Fenêtre | Contracté | Arrivé | Rentré |
|---|---|---|---|
| sem. 10 août | 2 100 € | 0 € | 0 € |
| sem. 31 août | 0 € | **300 €** | 0 € |

⚠️ La semaine du 31 août est le meilleur cas de contrôle : **3 600 € encaissés bruts,
3 300 € remboursés ou contestés, donc 300 € nets**. Si « Cash arrivé » y affiche
3 600 €, c'est que `.net` a été remplacé par une somme des seuls `succeeded`.

---

## Pièges

- **Ne pas toucher aux calculs.** `cashCollecte` (`cashParJour`, ~6286) et
  `cashCollecteCohorte` (`cashDeLaVente`, ~6315) sont justes. Le chantier est
  d'affichage et de libellé.

- **`cashCollecte` peut être NÉGATIF** et la carte le gère déjà (couleur ambre, pas de
  plancher à 0) : un remboursement porte la date du paiement qu'il annule, donc une
  période ancienne peut sortir plus d'argent qu'elle n'en fait entrer. Toute
  reformulation doit conserver ce comportement — le commentaire en place explique
  pourquoi peindre « − 200 € » en vert serait un contresens.

- **`cashCollecteCohorte` passe par `encaisseRetenu`**, pas par `.net` : il est écrêté
  au montant contracté vente par vente. C'est pour ça qu'il ne dépasse jamais le
  contracté, et c'est voulu — sans l'écrêtage, un trop-perçu masquerait l'impayé d'une
  autre vente. Voir `lib/dealCash.ts`.

- **Le tableau plus bas dans le même onglet** (colonne « Encaissé », ~6517) totalise
  `cashCollecteCohorte` en pied. Si les libellés de la rangée changent, vérifier que
  cette colonne et son total disent toujours la même chose que la carte à laquelle ils
  se rapportent.

- **Une session parallèle travaille dans ce fichier.** Vérifier `git status` et la
  branche avant tout commit, et ne commiter que ce fichier.

- **Vérifier au navigateur.** Sur le compte de Christian, trésorerie et cohorte valent
  toutes les deux 5 900 € en All-Time : l'écart ne se voit QUE sur une période bornée.
  Prendre la semaine du 10 août 2026 (0 € en trésorerie, 2 100 € en cohorte) ou celle
  du 31 août (3 400 € en trésorerie, 0 € contracté) — c'est là que le rendu se juge.
