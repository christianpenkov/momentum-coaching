# Périmètre des stats — le référentiel

**À lire avant de toucher à un compteur de leads, de calls ou de revenus.**

Ce document existe parce que la session du 2026-08-19 a corrigé **onze** écarts entre
écrans, tous causés par le même motif : une règle de périmètre écrite à plusieurs
endroits, qui diverge dès que l'un des endroits bouge.

Les calculs eux-mêmes n'étaient presque jamais faux. Ce qui divergeait, c'était le
**périmètre** : quelles lignes chaque écran regarde avant de compter.

---

## Les cinq règles

### 1. Date de démarrage : `integrations_ready_at`, jamais autre chose

Posée par trigger quand les 7 intégrations obligatoires sont connectées pour la
première fois. Ne redescend jamais. C'est la réponse à « depuis quand le pipeline
Momentum de cet élève est-il opérationnel ».

Trois autres dates existent et ont été utilisées à tort :

| Date | Ce qu'elle vaut | Usage légitime |
|---|---|---|
| `onboarding_completed_at` | Choix du mot de passe | Ancienneté du compte, `getClientWeek` — **jamais** un filtre de leads/calls |
| `integrations.connected_at` | Dernière connexion d'un provider | Diagnostic d'intégration |
| `integrations.first_connected_at` | Première connexion d'un provider | Historique OAuth |

Voir `integrations-ready-at-vs-onboarding-completed-at.md` pour le détail.

### 2. Date de référence d'un call : `booked_at`, avec repli sur `scheduled_at`

Un call **réservé** avant la mise en route mais **planifié** après n'a pas été généré
par Momentum. Filtrer sur `scheduled_at` le fait entrer à tort.

```ts
q.or(`booked_at.gte.${since},and(booked_at.is.null,scheduled_at.gte.${since})`)
```

Le repli couvre les calls anciens importés sans `booked_at`.

Cette date sert aussi à la **découpe mensuelle** : un call réservé le 29 août pour un
rendez-vous le 2 septembre compte dans **août**. C'est ce que font les CRM, qui traitent
« date de réservation » et « date du rendez-vous » comme deux champs distincts — le
premier crédite la génération du rendez-vous, le second l'interaction.

Les métriques dérivées suivent chacune la date qui a du sens pour elle, et non une date
unique imposée :

| Métrique | Découpée sur | Signifie |
|---|---|---|
| Calls bookés | `booked_at` | rendez-vous générés ce mois |
| Leads | `booked_at` | prospects arrivés ce mois |
| Taux de closing | cohorte de `booked_at` | qualité des rendez-vous générés ce mois |
| Cash contracté | `deals.signed_at` | argent engagé ce mois |
| Cash collecté | date du paiement Stripe | argent encaissé ce mois |

**Le taux de closing obéit à la règle de cohorte** : numérateur et dénominateur portent
sur la même population — les deals issus des calls réservés ce mois, quelle que soit
leur date de signature. Diviser les deals signés ce mois par les calls tenus ce mois
mélange deux populations, et un deal signé en relance faisait dépasser 100 %.

Contrepartie assumée : le taux du mois en cours est provisoire, il se stabilise à mesure
que les rendez-vous se tiennent. Sur un cycle long, un taux par cohorte devient un
indicateur retardé ; le cycle mesuré ici est de quelques heures (max 1 jour au
2026-08-19), donc le décalage se résorbe en jours.

### 3. Un prospect est une PERSONNE, jamais une ligne de call

Calendly crée un **nouvel événement** à chaque reprogrammation et annule l'ancien :
deux lignes dans `calls` pour la même personne. Tout compteur de prospects doit
dédoublonner — clé `invitee_email`, repli `invitee_name`.

### 4. Un call annulé retire un call booké, pas un lead

Un prospect qui annule a manifesté un intérêt : il reste un prospect. Le pipeline
en fait même un filtre dédié « Annulés ».

- **Compteurs de leads** : gardent les annulés.
- **Compteurs de calls bookés** : les excluent (`isNotCanceled`, `status === 'active'`).

### 5. Une borne haute de journée va jusqu'à 23:59:59.999

`new Date('2026-08-19')` vaut **minuit**. Utilisée comme borne haute, elle exclut
toute la journée en cours — un rendez-vous du jour devenait invisible jusqu'au
lendemain.

---

## Les onze écarts corrigés le 2026-08-19

| # | Symptôme | Cause | Règle |
|---|---|---|---|
| 1 | Un rendez-vous story n'apparaissait dans **aucun** onglet du pipeline | Liste fermée `['ig_description','ig_bio']`, écrite avant l'existence des stories ; le bloc YT/Autres excluait tout `ig*` | — |
| 2 | Même oubli dans le compteur de leads et `salesCallStats` | Idem | — |
| 3 | 12 calls au lieu de 16 en All-Time | Borne haute à minuit | 5 |
| 4 | 1 call en « Autre / non catégorisé » | Les leads dont on rattache les calls étaient sélectionnés depuis les liens **envoyés dans la période** ; lien de juin, call d'août | — |
| 5 | 11 jours de snapshots IG/YT en trop | All-Time partait de `connected_at` | 1 |
| 6 | Calls hors périmètre de la fiche client | Fetch borné sur `onboarding_completed_at` + `scheduled_at` | 1, 2 |
| 7 | Compteurs leads/stories de la fiche client sur une fenêtre plus large | `onboarding_completed_at` | 1 |
| 8 | 18 leads au lieu de 17 | Un prospect ayant reporté comptait deux fois | 3 |
| 9 | Un prospect YouTube annulé disparaissait des leads, pas un prospect Instagram | Filtre `status` sur un volet et pas l'autre | 4 |
| 10 | Un call réservé le 29 août pour le 2 septembre comptait en septembre | Découpe mensuelle sur `scheduled_at` alors que le périmètre filtre sur `booked_at` | 2 |
| 11 | Taux de closing pouvant dépasser 100 % | Numérateur sur `signed_at`, dénominateur sur `scheduled_at` — deux populations | 2 |

Écarts 1, 2, 4 : pas d'une règle générale mais du même réflexe — une **liste fermée**
ou une **fenêtre** qui n'a pas suivi l'évolution du produit.

---

## Où vit quoi

**Fonctions partagées** (`lib/salesCallStats.ts`) :
- `computeSalesCallStats` — calls bookés/honorés/closés, taux, cash
- `fetchIgLeadsCount` / `fetchAllLeadsCount` — comptage des leads
- `isNotCanceled` — définition d'un call annulé

**Écrans qui les utilisent** : fiche client coach, accueil coach,
`SupabaseClientsContext`.

**Écrans qui ont leur propre implémentation** : `PageClientStats.tsx` (6 700 lignes),
`PagePipeline.tsx`, `app/api/client/pipeline/route.ts`.

Cette divergence est structurelle et connue. Elle n'a pas été supprimée en une passe :
les calculs concordent, ce sont les périmètres qui divergeaient. Toute correction de
périmètre doit être répercutée dans les trois.

---

## Ce qui reste ouvert

**Le cash vient de deux sources.** `computeSalesCallStats` lit la table `deals`,
`PageClientStats` somme `calls.revenue`. Aujourd'hui : 6 600 € des deux côtés, 4 deals
tous rattachés à un call. Un deal **sans call** (upsell, vente hors pipeline) serait
invisible dans Mes Stats.

Décision prise le 2026-08-19 : basculer les **totaux** sur `deals`, garder les cartes
**par contenu** sur `calls.revenue` — un upsell vendu six mois après ne doit pas gonfler
la performance du post qui a amené le client. Non implémenté : `PageClientStats` ne
charge pas encore la table `deals` (seulement `deal_payments`).

**Divergence sur le cash contracté entre deux écrans.** L'accueil (`useCoachData`)
rattache son cash au mois de **signature** du deal ; Mes Stats somme `calls.revenue` et
le rattache donc au mois de **réservation** du call. Les deux divergent dès qu'une
signature ne tombe pas dans le mois de son call. Aucun cas à ce jour (cycle de quelques
heures). La convergence passe par le chantier « cash sur `deals` » ci-dessus — c'est le
même correctif.

**Le parcours lead magnet depuis une story n'a jamais été exercé.** Le code existe
(`source = 'story_reply'`), la catégorie d'affichage existe, aucun lead de ce type en
base. Les tests du 2026-08-19 ont montré ce que cachent les chemins jamais parcourus.

---

## Le réflexe à garder

Avant d'ajouter un compteur, se demander :

1. Quelle date de démarrage ? (`integrations_ready_at`)
2. Quelle date de référence ? (`booked_at`)
3. Je compte des personnes ou des lignes ?
4. Les annulés comptent-ils ?
5. Ma borne haute couvre-t-elle la journée entière ?

Et surtout : **cette règle existe-t-elle déjà ailleurs ?** Dix des onze écarts
venaient d'une règle déjà écrite quelque part, recopiée puis désynchronisée.
