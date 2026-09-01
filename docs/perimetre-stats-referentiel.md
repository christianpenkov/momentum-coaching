# Périmètre des stats — le référentiel

**À lire avant de toucher à un compteur de leads, de calls ou de revenus.**

Ce document existe parce que la session du 2026-08-19 a corrigé **onze** écarts entre
écrans, tous causés par le même motif : une règle de périmètre écrite à plusieurs
endroits, qui diverge dès que l'un des endroits bouge.

Les calculs eux-mêmes n'étaient presque jamais faux. Ce qui divergeait, c'était le
**périmètre** : quelles lignes chaque écran regarde avant de compter.

---

## Les sept règles

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

### 6. Une OPPORTUNITÉ n'est pas un rendez-vous

**Définition.** Une opportunité est **une chance de vendre à une personne**, quel
que soit le nombre de rendez-vous qu'elle a demandés. Deux rendez-vous avec le même
prospect, quand le second prolonge le premier, sont **une seule** opportunité.

**Pourquoi cette notion existe.** Sans elle, un prospect qui fait deux calls et signe
au second affichait **50 % de close rate** : le deal comptait une fois, mais les deux
rendez-vous comptaient au dénominateur. C'est 100 % — une opportunité, un deal.
Bien mener une vente en deux temps faisait donc *baisser* la performance affichée.

**Ce qui relie deux rendez-vous : la DÉCLARATION, jamais un délai.** Le vendeur
répond « 2ème call » dans son rapport, ce qui pose `outcome = 'second_call'` sur le
call précédent. Un seuil de temps (« moins d'un mois = même opportunité ») aurait
coupé en deux un 2ᵉ call calé à cinq semaines, fusionné à tort deux vraies
opportunités rapprochées, et imposé un nombre magique indéfendable. Un prospect qui
rebooke spontanément trois mois plus tard ne passe jamais par là : son call précédent
porte `to_recontact` ou `lost`, et compte donc pour **deux** opportunités.

**Le drapeau `is_follow_up` n'est PAS lu.** Il est posé par un PATCH dont le code
tolère l'échec. On relit `outcome`, écrit dans le même patch que le rapport lui-même,
qui ne peut pas manquer. Corollaire de la refonte du pipeline : l'issue se calcule à
l'affichage, jamais stockée deux fois.

**Quel call est exclu : le SECOND.** L'opportunité est représentée par son premier
rendez-vous ; le deal, lui, est compté là où il a été signé.

**Source unique : `idsDeContinuation` dans `lib/callSeries.ts`.** Ne jamais
re-dériver la règle ailleurs. Et l'appariement se fait sur le **jeu de calls le plus
large disponible**, le filtrage par période venant ensuite — sinon une paire à cheval
sur deux périodes devient invisible et le 2ᵉ call recompte comme une opportunité
neuve.

**Identité du prospect : l'e-mail IDENTIFIE, le nom ne fait que RAPPROCHER.** Deux
e-mails différents sont deux personnes, quoi que disent les noms. Le nom sert
uniquement de passerelle pour un call qui n'a **aucun** e-mail — cas réel, le 2ᵉ call
saisi à la main. Si un call sans e-mail porte un nom que se partagent deux adresses,
l'ambiguïté n'est pas tranchée : il reste seul et compte pour une opportunité de
plus. Se tromper en gonflant le dénominateur sous-estime la performance ; se tromper
en le rétrécissant la surestime. Entre les deux, on choisit celle qui ne flatte pas.

**Où la notion s'applique, et où elle ne s'applique PAS :**

| Mesure | Grain | Pourquoi |
|---|---|---|
| Close rate | **opportunité** | mesure la capacité à closer une PERSONNE |
| Taux clics → calls | **opportunité** | un 2ᵉ rendez-vous n'est produit par aucun nouveau clic |
| No-show | rendez-vous | mesure la fiabilité d'un CRÉNEAU, pas d'une personne |
| Calls bookés, Calls honorés | rendez-vous | ce sont des comptes de rendez-vous, et ils sont vrais |
| Crédit d'un contenu | **opportunité** | sinon un contenu est crédité deux fois pour un prospect |

**Le grand chiffre ne bouge jamais.** « Calls bookés » affiche le nombre vrai de
rendez-vous ; seul le **taux** se calcule sur les opportunités. Renommer l'étage en
« Opportunités » a été essayé le 2026-08-30 puis annulé : le libellé payait le prix
d'un problème qui ne concernait que le taux.

---

### 7. Le cash : deux notions, deux dates, jamais deux dates pour un même chiffre

Posée le 2026-09-01, après qu'un même montant a été trouvé daté de trois façons
différentes selon l'écran.

**Cash contracté** — ce que le client s'est engagé à payer.
Source : `deals.amount_total`, jamais `calls.revenue`.
Date : **`signed_at`**, et voir ci-dessous ce que ce champ vaut exactement.

**Cash encaissé** — ce qui est réellement rentré.
Source : `deal_payments`, via `calculerCash` (`lib/dealCash.ts`).
Date : celle du versement.
N'existe que dans l'onglet Revenus, où la question est la trésorerie.

Un deal de 2 100 € vendu au rendez-vous du 21 août et payé en trois fois : le contracté
est **entièrement en août partout**, l'encaissé s'étale sur trois mois dans Revenus.

#### Ce que `signed_at` vaut exactement

**La date de TENUE du PREMIER rendez-vous de la chaîne d'opportunité.** Pas l'instant de
saisie du rapport, pas la date de réservation, pas le rendez-vous où la vente a été
déclarée.

La règle vit dans `dateDeVente` (`lib/callSeries.ts`), avec cinq tests. Elle est posée à
l'**écriture** : aucune règle de découpe ne change côté lecture, c'est la donnée qui est
vraie. `created_at` porte toujours la date de saisie.

Les trois choix, et ce que chacun corrigeait :

| Choix | Ce qu'il évite |
|---|---|
| le rendez-vous, pas la saisie | les brouillons de rapport vivent 30 jours : un rendez-vous de fin août rapporté en septembre basculait son cash dans le mois suivant, **sur les quatre écrans à la fois** — donc sans qu'aucun ne contredise l'autre |
| sa **tenue** (`scheduled_at`), pas sa réservation | dater sur la réservation place la vente **avant** le rendez-vous qui l'a produite : faux en permanence, là où le cas inverse (réservé le 29/08, tenu le 02/09) est rare |
| le **premier** rendez-vous de la chaîne | un 2ᵉ rendez-vous ne crée pas d'opportunité : sans ça, une période affichait une vente closée sans cash et la suivante du cash sans aucun rendez-vous |

Repli sur l'instant de saisie dans deux cas : aucun rendez-vous exploitable, ou
rendez-vous **encore à venir** — une vente ne peut pas avoir été faite demain, et rien
n'empêche de rapporter avant le créneau.

⚠️ **Limite assumée.** Une vente conclue en **relance** quelques jours après le
rendez-vous est datée du rendez-vous. L'écart se compte alors en jours. Une date de vente
saisissable dans le rapport la fermerait, et se brancherait dans `dateDeVente`.

#### Deux dates sur le même écran, et c'est voulu

Un rendez-vous **réservé le 29 août pour le 2 septembre** compte dans les **calls bookés
d'août** et dans le **cash de septembre**, sur le même écran.

Ce n'est pas une incohérence : un call booké se produit au moment de la réservation, une
vente au moment du rendez-vous. Deux faits, deux moments, deux dates. Les aligner de
force daterait la vente avant le rendez-vous qui l'a produite.

Concerne aujourd'hui : **Vue générale**, **Funnel & Calls**, **l'accueil coach**.

#### Où la source diffère volontairement

Les écrans qui attribuent **par contenu ou par plateforme** lisent le montant rattaché au
rendez-vous (`call_id` non nul), donc une vente **sans** rendez-vous n'y figure pas :
elle n'a ni plateforme ni contenu à créditer. Elle reste comptée dans Vue générale et
dans l'onglet Revenus.

Conséquence assumée : le total de ces écrans peut être **inférieur** à celui des autres.
C'est la source qui diffère, pas la date.

⚠️ **`calls.revenue` n'est pas le montant de la vente.** C'est ce que l'élève a
**déclaré** dans son rapport. Corriger un montant depuis la page Paiements ne le réécrit
pas — le rendez-vous `TestBIO` porte 3 000 € d'un côté et 1 200 € de l'autre au
2026-09-01. Les deux champs restent, ils portent deux faits, et l'écart entre eux est
lui-même une information : c'est ce que surveille `ventes_sante_montants`.

#### État de la migration vers `deals`

**Terminée le 2026-09-02.** Il ne reste que deux lectures de `calls.revenue`, toutes deux
volontaires et documentées ci-dessous. La dernière à aligner, la route des séquences de
story, l'a été avec deux corrections de plus que prévu — elle ne retirait pas non plus
les continuations (un 2ᵉ rendez-vous y comptait comme une opportunité nouvelle) et lisait
`hook_replied` sur la fiche mutable au lieu du journal.

⚠️ **Aucune des trois corrections ne change un chiffre aujourd'hui.** Vérifié en base :
les 8 rendez-vous porteurs d'un deal concordent avec leur drapeau `deal_closed`, aucun
des 2 rendez-vous de la séquence n'est une continuation, et fiche et journal disent la
même chose sur la seule conversation concernée. C'est le cas le plus dangereux — une
correction invisible se fait retirer par la première personne qui la trouve superflue.
Elles protègent la première fusion de fiches, le premier 2ᵉ rendez-vous sur une séquence,
et la première correction de montant faite depuis la page Paiements.

Cinq lectures de `calls.revenue` pour du cash subsistaient au 2026-09-01. **Aucune n'est
dans Vue générale ni dans Funnel & Calls**, tous deux passés sur `deals` :

| Site | Écran | Décision |
|---|---|---|
| `PageClientStats.tsx` (Top contenus, branches IG et YT) | Vue générale | **volontaire** — attribution par contenu, voir ci-dessus |
| `lib/salesCallStats.ts:92` | repli partagé | **volontaire et documenté** — certains appelants n'ont qu'une liste de calls (batch multi-élèves) ; le repli ne sert que sans `deals` |
| ~~`app/api/instagram/story-sequences-stats/route.ts`~~ | Business micro | ✅ **aligné le 2026-09-02** |
| ~~`app/api/instagram/poll-leads/route.ts`~~ | — | **fichier supprimé le 2026-09-01** — code mort, doublon de l'Edge Function |

✅ **Business micro est aligné** depuis le 2026-09-01 : source `deals`, date de vente.
Trois choses à savoir avant d'y toucher.

**Il recalcule la date au lieu de lire `signed_at` — et c'est désormais une dette, plus
une nécessité.** Quatre des huit ventes portaient l'heure de SAISIE du rapport (20/08
21h47 pour un rendez-vous du 19/08 13h30) : la règle avait été posée après leur
création. **Elles ont été redatées le 2026-09-01** par `scripts/redater-ventes.mjs`, qui
appelle `dateDeVente` — la même fonction que l'écriture et que les écrans, jamais une
requête réécrite pour l'occasion. Aucune ne franchissait un mois ni une semaine : aucun
agrégat n'a bougé. Anciennes valeurs et rollback exécutable dans
`docs/sauvegardes/redatage-ventes-2026-09-01.txt`.

`ventes_sante_date` surveille désormais la colonne. **Quand elle aura tourné un moment
sans alerte, les deux recalculs deviendront supprimables** au profit d'une simple lecture
de `signed_at`. D'ici là, garder les deux versions est une sécurité et non une
redondance — et deux écrans qui recalculent à l'identique ne peuvent pas diverger, là où
deux écrans dont l'un lit une copie figée le peuvent.

**Il reçoit le jeu de ventes COMPLET, jamais découpé sur la période.** Le Parcours des
leads borne la seule ENTRÉE : une personne entrée en juin appartient à la ligne de juin
même si elle close en juillet. Avec un jeu déjà découpé sur `signed_at`, sa ligne
afficherait **« 1 closé, 0 € »** — le compte venant d'un jeu non borné et le montant
d'un jeu borné, la cohorte suivrait la personne et l'argent resterait derrière.

⚠️ **Aucun cas ne l'exhibe aujourd'hui, et c'est précisément ce qui le rendait
indétectable.** Vérifié le 2026-09-01 : les deux ventes rattachables à une cohorte
tombent dans le mois de leur entrée, et la conversion la plus longue fait 8 jours sans
traverser de mois. Le défaut n'attend qu'une conversion à cheval sur deux périodes. Ne
pas conclure d'un écran juste que le périmètre l'était.

En contrepartie, tout le bornage du cash se fait désormais dans l'onglet.

**Deux fenêtres cohabitent, et les catégories du breakdown forment une partition.**
`callsInWindow` retient les rendez-vous RÉSERVÉS dans la période, `callsVenteInWindow`
ceux dont la VENTE y tombe. Chaque catégorie a son jumeau, **y compris « Autre »**, qui
est leur complément : mélanger les deux populations ferait compter un euro deux fois,
ici et dans sa vraie catégorie.

⚠️ **Ne pas y toucher depuis une autre session** — deux sessions s'y sont déjà écrasées
une fois.

#### Rattachement à une cohorte ≠ date de vente

Piège trouvé en corrigeant ce qui précède, et le commentaire du code affirmait
explicitement le contraire.

Le Parcours des leads rattache un rendez-vous à la porte d'entrée qui l'a produit. Cette
question se répond à la **RÉSERVATION** — règle 2 —, pas à la tenue : un lead magnet pris
**après** qu'une personne a déjà réservé ne peut pas avoir produit ce rendez-vous, et
ranger sur la tenue le lui créditerait quand même, en volant la ligne de la porte qui
l'avait réellement fait venir.

`dateDeVente` répond à une **autre** question — à quelle période l'argent appartient —
et se répond, elle, à la tenue. Le champ s'appelle donc `dateDeRattachement` dans
`lib/parcoursLeads.ts`, et non `scheduled_at` : un nom qui décrit la question, pour que
le prochain lecteur ne refasse pas l'amalgame. Verrouillé par un test.

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

**Le cash sur `deals` : fait.** La décision du 2026-08-19 — totaux sur `deals`, cartes
par contenu sur le montant rattaché au rendez-vous — est appliquée depuis le 2026-09-01
sur Vue générale, Funnel & Calls, l'accueil et l'onglet Revenus. Voir la **règle 7**
ci-dessus pour l'état complet, y compris ce qui reste volontairement sur `calls.revenue`.

⚠️ Ce paragraphe a affirmé pendant douze jours que « `PageClientStats` ne charge pas
encore la table `deals` », alors que c'était fait depuis le 2026-08-20. Une session
d'audit a perdu une demi-journée sur cette réserve périmée. **Une note datée n'est pas
un fait : la revérifier avant de bâtir dessus.**

**Reste ouvert : Business micro.** Seul écran encore sur `calls.revenue` découpé sur
`booked_at`. Reconstruction en cours dans une session dédiée — voir la règle 7.

**Le parcours lead magnet depuis une story n'a jamais été exercé.** Le code existe
(`source = 'story_reply'`), la catégorie d'affichage existe, aucun lead de ce type en
base. Les tests du 2026-08-19 ont montré ce que cachent les chemins jamais parcourus.

---

## Piège nommé : la fonction qui a besoin d'un contexte plus large que ce qu'on lui passe

Trouvé le 2026-09-01 dans Funnel & Calls, après avoir été corrigé ailleurs sans que
personne pense à vérifier les voisins.

**La forme.** Une fonction a besoin de voir **au-delà de la période affichée** pour
répondre juste. L'appelant, lui, travaille sur la période et lui passe naturellement ce
qu'il a sous la main : le jeu déjà filtré. La fonction ne peut pas s'en apercevoir — elle
reçoit une liste valide, elle répond une réponse valide. **Sur cette liste-là.**

**Le cas réel.** `idsDeContinuation` apparie un 2ᵉ rendez-vous avec le 1ᵉʳ de la même
personne. Funnel & Calls lui passait `calls`, déjà coupé sur la période dès qu'on navigue
en arrière. Une paire à cheval sur deux périodes devenait invisible depuis la seconde : le
2ᵉ rendez-vous y recomptait comme une opportunité neuve, et gonflait les calls bookés, le
taux clics → calls et le dénominateur du closing.

Atteignable sur les données réelles au moment de la découverte : 1ᵉʳ rendez-vous le 21/08
(semaine 17-23), continuation le 29/08 (semaine 24-30).

**Pourquoi il est difficile à voir.** Il ne produit ni erreur, ni valeur absurde, ni
divergence entre deux nombres de la même page. Il produit un chiffre **plausible**, et
seulement sur les périodes passées — jamais sur celle qu'on regarde en premier. Aucune
relecture de la fonction ne le montre : elle est juste. C'est l'appel qui est faux.

**Le réflexe.** Pour toute fonction dont la réponse dépend de lignes qui peuvent être
hors fenêtre — appariement, chaîne, déduplication, « premier / dernier », rattachement à
un parent — se demander : **est-ce que je lui passe le jeu le plus large disponible, ou
celui que j'ai sous la main ?** Le filtrage par période vient **après**, jamais avant.

Concrètement dans cette page : ces fonctions reçoivent `callsAllTime ?? calls`, jamais
`calls` seul. Les cinq appels ont été vérifiés un par un le 2026-09-01.

**La parenté avec le piège de la partition.** Là, une ligne et son complément lisaient le
même prédicat et n'en corriger qu'un faisait compter deux fois. Ici, une fonction et son
appelant n'ont pas le même périmètre, et c'est le plus étroit qui gagne en silence. Même
famille : **deux endroits qui doivent s'accorder, dont un seul est visible depuis
l'autre.**

---

## Piège nommé : l'instrument qui se dégrade sans jamais se tromper

Posé le 2026-09-01. Même forme que les deux précédents — rien ne casse, aucun nombre
absurde n'apparaît — mais il frappe l'outil de mesure au lieu de la mesure.

Un journal d'incidents comptait **58 lignes**. Vérification faite : **aucune ne
correspondait à un problème réel**. Meta renvoie des HTTP 400 passagers sur la mesure
des périodes Instagram, et le passage suivant réécrit toujours — les trois profils
avaient leur semaine, leur mois et leur all-time frais de moins de six heures.

Aucune de ces lignes n'était fausse. Chacune décrivait un échec qui avait bien eu lieu.
Le défaut n'est pas dans les lignes, il est dans ce qu'elles font à l'instrument : le
contrat de `cron_runs` est **« table vide = aucun incident »**, et c'est ce contrat qui
lui donne sa valeur. Une table qu'on ouvre pour y trouver cinquante-huit problèmes déjà
résolus, on cesse de l'ouvrir. Le jour d'un vrai incident, la ligne s'y ajoute et
personne ne la voit.

**Le réflexe.** Avant de journaliser un échec, se demander : **est-ce qu'il sera rejoué
automatiquement ?** Si oui, il n'appartient pas au journal des incidents actionnables.

Et sa contrepartie, indissociable : **surveiller la conséquence plutôt que la cause,
quand la cause se répare seule.** Retirer le bruit sans rien mettre à la place crée un
angle mort. Ce qui garde l'œil ouvert, c'est une vue qui regarde non pas « un appel
a-t-il échoué » mais « la donnée a-t-elle cessé d'être rafraîchie », avec un seuil
exprimé en **nombre de cycles de réparation ratés** — quatre pour `ig_sante_periodes`,
sept jours pour `shortio_sante_donnees`.

**La parenté avec les deux autres pièges.** La partition : deux endroits doivent
s'accorder, on n'en corrige qu'un. Le contexte trop étroit : deux périmètres doivent
s'accorder, le plus étroit gagne en silence. Ici : le signal et le bruit partagent un
canal, et le bruit gagne — non pas en falsifiant le signal, mais en le rendant
illisible. **Trois formes d'une même famille : quelque chose se dégrade sans qu'aucune
valeur affichée ne devienne fausse.**

C'est aussi ce qui rend ces trois pièges invisibles à la relecture de code. Aucune
fonction n'est incorrecte. Ce qui est incorrect, c'est ce que l'ensemble produit.

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
