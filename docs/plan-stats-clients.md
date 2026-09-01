# Plan — Refonte « Stats Clients » (côté coach)

> Document vivant. Mis à jour à **chaque décision** de la conversation.
> Version : v2 — 2026-08-31 (après le premier passage de retours de Chris sur la maquette)
>
> **Maquette interactive** : https://claude.ai/code/artifact/35558a3a-9805-40cf-93ef-79324c91184b
> Support des retours : toute décision prise devant la maquette redescend ici.
> 14 décisions actées (D1 à D14), 8 questions ouvertes (Q-A à Q-H).

---

## 1. Ce qu'on sait déjà (constat, pas hypothèse)

### La page existe et elle est morte

`components/pages/coach/PageAnalytics.tsx` (272 lignes), route
`app/(coach)/analytics/page.tsx`, titre affiché « Stats Clients ».

Elle est un **stub compilable** depuis le 2026-08-03. Commentaire dans le fichier :

> « cette page dépendait entièrement de `weekly_metrics`, table jamais alimentée par
> aucun cron. Stub minimal pour rester compilable en attendant la refonte complète
> prévue (renommage "Stats Clients", chantier séparé) »

Concrètement : `totalCalls = 0`, `avgGrowth = 0`, `growthData = []`,
`heatmapRows = []`, `dmBarData = []`, et toutes les colonnes du tableau comparatif
sauf audience et cash sont codées à `0`. Les sections sont donc **invisibles**
(gardées derrière des `maxWeeks >= 2` et `.some(...)` toujours faux).

**Les maquettes fournies par Chris sont exactement cette page-là**, remplie de données
simulées. Elles montrent donc l'intention d'origine, pas un état atteignable :
« MRR total 124 300 € », « 21 clients actifs », « Rétention moy. 91 % » n'ont
aujourd'hui **aucune source**.

### Ce qui existe déjà et couvre une partie du besoin

| Écran | Rôle actuel | Recouvrement |
|---|---|---|
| `PageClients` | Liste des élèves, signaux (tâches en retard, no-shows), tri cash/followers/semaine | **Fort** sur « qui va mal » côté relationnel |
| `PageClientStats` (10 047 l.) | Stats **d'un seul** élève, 6 onglets, période, All-Time | **Fort** sur le détail — c'est le niveau « en dessous » |
| `PageToday` / `PageBriefing` | L'action du jour | Faible |

→ La nouvelle page doit se positionner **entre** `PageClients` (opérationnel) et
`PageClientStats` (détail d'un élève) : le **niveau portefeuille**.

### Les données réellement disponibles

Colonne vertébrale : **`analytics_daily_snapshots`** — une ligne par `profile_id` et
par jour, 55 colonnes, alimentée par l'Edge Function `poll-leads` (5 min).

Familles de colonnes disponibles par élève et par jour :

- **Instagram** : `ig_followers`, `ig_reach`, `ig_reach_follower` /
  `ig_reach_non_follower`, `ig_views`, `ig_profile_views`, `ig_accounts_engaged`,
  `ig_total_interactions`, `ig_website_clicks`, `ig_follows_unfollows`,
  `ig_response_rate`, `ig_demographics`
- **YouTube** : `yt_subscribers`, `yt_net_subs`, `yt_views` (+ shorts/long),
  `yt_watch_time_min`, `yt_avg_view_duration_sec`, `yt_likes/comments/shares`
- **Short.io** : `shortio_clicks`, `shortio_human_clicks`, `shortio_links` (jsonb)
- **Business** : `calls_booked`, `calls_honored`, `calls_canceled`, `calls_no_show`,
  `deals_closed`, `revenue`, `mrr`, `stripe_active_subs`

Autres sources déjà exploitées ailleurs : `calls`, `deals`, `deal_payments`,
`instagram_leads`, `prospect_events`, `tasks`, `session_reports`.

**Contrainte non négociable** : tout agrégat doit obéir à
`docs/perimetre-stats-referentiel.md` (6 règles de périmètre) et à
`lib/dealCash.ts` pour le cash. Les onze écarts entre écrans du 2026-08-19 venaient
tous de règles de périmètre recopiées.

### Contraintes du projet

- **Zéro maintenance après livraison, robuste à 20-40 élèves** (`AGENTS.md`).
- **Aucune donnée inventée** : un `0` affirme, un trou dit « on ne sait pas ».
- Design : `DESIGN.md` — « Le Cabinet du Coach », crème/encre, ardoise rare, plat par
  défaut. Pas de Tailwind dans `orbit/` (styles inline + CSS global) → attention au
  piège `feedback_style_inline_bat_media_query`.
- Page **desktop-only** aujourd'hui (`<DesktopOnly>`).

---

## 2. Objectif exprimé par Chris

> « L'objectif c'est que le coach puisse voir comment ses élèves évoluent au global
> et voir directement ici s'il y a un élève qui est moins bien par exemple. »
> « Pas forcément d'avoir absolument tous les détails du funnel de chaque personne. »

⚠️ **Lecture initiale fausse, corrigée par Chris.** J'avais retenu « détecter le
décrochage » comme job principal, parce que c'est la clause la plus tractable des deux.
Chris a corrigé deux fois : « ça doit pas être la raison principale de la page ».
Le job principal est le **premier** volet — voir l'évolution au global — et le
décrochage n'en est qu'un des cinq usages listés au §3.

---

## 3. Ce que la page doit servir (confirmé par Chris)

Les **cinq** usages sont retenus, aucun n'est prioritaire sur les autres :

1. **État du portefeuille** — les 20 élèves côte à côte sur les mêmes métriques.
2. **Est-ce que ma méthode marche** — la progression des élèves, vue de haut.
3. **La preuve chiffrée** — les résultats agrégés, montrables.
4. **Préparer mes calls** — où en est chacun, sans ouvrir 20 pages.
5. **Détecter un décrochage** — présent, mais ce n'est **pas** la raison principale
   (correction explicite de Chris, deux fois).

Fréquence déclarée : **tous les jours**.

---

## 4. Décisions prises

### D1 — L'utilisateur est **le coach** (Quennel sur la plateforme actuelle)

Pas Chris. La page doit rester lisible pour quelqu'un qui ne l'a pas construite.

« Tous les jours » n'est **pas vérifié auprès de Quennel** — la page actuelle est un stub
vide, personne ne peut l'ouvrir quotidiennement aujourd'hui. Conséquence retenue : la page
doit porter du **delta** (ce qui a bougé) et pas seulement du **niveau** (où on en est),
sinon elle affiche la même chose sept jours de suite. Mais la mise en page ne parie pas
sur l'habitude quotidienne.

### D2 — ~~Un dénominateur collé à chaque chiffre~~ → **révisé, ma prémisse était fausse**

**Ce que je proposais** : `42 300 € · 12 élèves sur 20 connectés` sur chaque carte.

**Ce que Chris a répondu, et il a raison** : ça ne sert à rien, parce que
`integrations_ready_at` est un **gate** — tant que les 7 intégrations ne sont pas
connectées, l'élève ne peut rien faire sur la plateforme. Vérifié dans
`docs/integrations-ready-at-vs-onboarding-completed-at.md` :

> « le système de waiver par intégration (…) a été **supprimé** dans ce même chantier :
> les 7 intégrations sont obligatoires sans exception pour tout élève »
> « **Mécanisme A (gate initial)** — un élève qui n'a jamais eu ses 7 intégrations
> connectées voit un écran de blocage complet »

Donc **tout élève vivant a une couverture complète, par construction**. Un dénominateur
qui vaut toujours `20 / 20` est du bruit. Et le nombre d'élèves est déjà dans l'en-tête.

→ **Pas de dénominateur par carte.** Les élèves en cours d'installation n'entrent pas
dans les agrégats et apparaissent uniquement dans le tableau, avec leur état écrit.

⚠️ **Le trou que le gate ne bouche PAS — Mécanisme B.** Le même document :

> « un élève déjà débloqué dont une intégration tombe plus tard (token expiré,
> déconnexion) (…) `integrations_ready_at` reste figé »

Un élève dont le jeton Stripe casse le 3 du mois reste compté dans les agrégats avec des
chiffres **figés au 3**. Rien à l'écran ne le dit, et le total du portefeuille est faux
sans qu'aucune règle de périmètre soit violée. C'est exactement le motif contre lequel
`AGENTS.md` met en garde : « un `0` affirme quelque chose ».

→ Voir **Q-H** : un bandeau global au niveau coach, l'équivalent de
`BandeauIntegrations` qui existe déjà pour la page d'un seul élève.

### D3 — Sélecteur de période : réutiliser l'existant, ne rien inventer

Le composant `PeriodPill` (`PageClientStats.tsx:8122`) fait déjà exactement ce que Chris
demande : **7j / 30j / All-Time**, plus une navigation `‹ ›` vers les périodes
précédentes (`S−1`, `M−3`…). Il s'appuie sur `getPeriodWindow()` de `lib/period.ts`, qui
garantit des fenêtres **calendaires** — garantie dont dépend la purge
`degrossir_historiques_analytics()` (voir `AGENTS.md`).

→ Extraire `PeriodPill` dans son propre fichier et le partager entre les deux pages,
plutôt que d'en écrire un second qui divergera.

⚠️ **Point non tranché** : `All-Time` est aujourd'hui défini **par élève**
(`integrations_ready_at`). Sur une page à 20 élèves ayant 20 dates de démarrage
différentes, « All-Time » doit être redéfini. Voir Q7.

### D4 — Vue de cohorte : **l'axe normalisé**, pas la moyenne par tranche

J'avais proposé de l'abandonner (tranches d'ancienneté = 6-7 élèves par tranche, dominées
par un seul cas exceptionnel). **Chris a reformulé autrement, et sa version est la bonne** :

> « ça affiche 12 semaines, et pour chaque personne quelle que soit la date où elle a
> commencé, ils sont tous dans ces 12 semaines — tu vois le graphique de la personne en
> semaine de l'accompagnement, et donc tu compares chaque personne par rapport au temps
> qu'elle a passé dans l'accompagnement »

Ce n'est pas une analyse de cohorte, c'est un **changement d'axe** : l'abscisse n'est plus
le calendrier mais la **semaine d'accompagnement**, chaque courbe démarrant à SON S1.

Trois raisons pour lesquelles c'est meilleur que ce que je proposais :

1. **Aucune moyenne n'est calculée** — donc aucun outlier ne peut fausser un agrégat.
   Chaque courbe reste la donnée brute d'une personne réelle.
2. **Ça répond vraiment à « est-ce que ma méthode marche »** : si l'accompagnement
   fonctionne, les courbes se redressent toutes autour de la même semaine. Sur un axe
   calendaire, ce motif est invisible — il est noyé par les dates de démarrage.
3. **Ça réduit les spaghettis** : des courbes qui partent toutes de la même origine sont
   nettement plus lisibles que des courbes décalées au hasard sur le calendrier.

Prérequis technique : `getClientWeek(onboarding_completed_at)` existe déjà
(`lib/clientWeek.ts`). ⚠️ Mais `perimetre-stats-referentiel.md` règle 1 impose
`integrations_ready_at` pour tout filtre de leads/calls, et `onboarding_completed_at`
pour l'ancienneté. **Les deux dates coexistent ici** : l'axe des semaines suit
l'ancienneté, les métriques suivent le périmètre. À ne pas confondre.

---

### D5 — Sur l'axe normalisé, l'ordonnée est en **%**, pas en abonnés

Découvert en construisant la maquette. Si le §6 affiche des abonnés bruts, les 146 798
de Camille écrasent les 6 234 de Hugo et le graphe ne montre plus qu'une courbe utile.
En pourcentage du niveau à S1, toutes les trajectoires deviennent comparables.

⚠️ **Contrepartie assumée, à écrire dans l'interface** : un élève qui démarre à 400
abonnés fait +180 % sans effort, là où un compte à 140 000 plafonne à +12 %. Le
pourcentage favorise mécaniquement les petits comptes. Ce graphe sert à lire **la forme**
des trajectoires (est-ce que ça se redresse, et vers quelle semaine), pas à classer les
élèves entre eux — le classement, c'est le tableau du §4 qui le fait.

---

## 5. La page — structure retenue

Ordre **décidé par Chris** (le tableau descend tout en bas) :

| # | Section | État |
|---|---|---|
| `§1` | En-tête + `PeriodPill` | **validé**, identique à `PageClientStats` |
| `§2` | Bandeau agrégé — 4 cartes | **validé**, contenu ci-dessous |
| `§3` | Bande « à regarder » | principe validé, **règle à définir** |
| `§4` | Graphe de croissance — onglets Instagram / YouTube | **redéfini** par Chris |
| `§5` | Graphe axe « semaines d'accompagnement » | validé, questions ouvertes |
| `§6` | Tableau du portefeuille | **descendu tout en bas** |

Les élèves sans données ne forment plus une section à part : ce sont des **lignes du
tableau `§6`** portant un état écrit à la place des chiffres.

---

## 6. Décisions prises (suite)

### D6 — Le bandeau agrégé : 4 cartes, dans cet ordre exact

1. **Cash** — collecté **et** contracté, avec le pourcentage entre les deux
2. **Abonnés gagnés**
3. **Calls bookés**
4. **Ventes**

Chaque carte porte sa comparaison à la période précédente (D1).

### D7 — La référence de comparaison suit la période sélectionnée

| Période affichée | Comparée à |
|---|---|
| Semaine | La semaine précédente |
| Mois | Le mois précédent |
| All-Time | Voir D9 |

Piège à ne pas reproduire : une carte qui annonce « vs semaine précédente » alors que le
sélecteur est sur le mois. La formulation doit être **calculée**, jamais écrite en dur.

### D8 — Toute la page suit la période sélectionnée

Le bandeau `§2`, le graphe `§4`, la colonne courbe et les deltas du tableau `§6` : tous
lisent la même fenêtre. **Une seule exception, par nature :** le graphe `§5`, dont l'axe
est la semaine d'accompagnement et non le calendrier — il est donc hors période.

Chris a explicitement écarté l'alternative (« ou vaut mieux par période comme ça c'est
directement la personne qui choisit, oui vaut mieux »).

### D9 — « All-Time » = l'union des All-Time individuels, jamais une fenêtre commune

Chaque élève apporte **son propre** `integrations_ready_at`. Il n'y a pas de date de
départ commune au portefeuille, et il ne faut pas en inventer une.

| Élément | En mode All-Time |
|---|---|
| Bandeau `§2` | Chaque statistique cumule le All-Time de chaque élève |
| Tableau — posts, calls, cash | All-Time de chaque élève |
| Tableau — abonnés | **Le niveau actuel**, temps réel — un nombre d'abonnés n'est pas un cumul |
| Tous les deltas | Exprimés **au mois** (bandeau `§2` comme tableau `§6`) |

⚠️ Conséquence à assumer et à écrire dans l'interface : en All-Time, deux élèves ne sont
pas comparables sur les colonnes cumulées — l'un cumule sur 14 semaines, l'autre sur 3.
La comparaison entre élèves n'a de sens que sur une période commune.

### D10 — Le graphe de croissance `§4` : deux états, pas deux options

Ma question « `§5-A` ou `§5-B` » **n'avait pas la bonne réponse dans ses options.**
Chris veut les deux, selon l'état du graphe :

| État | Rendu |
|---|---|
| **Au repos** | Toutes les courbes en couleur, comme la maquette d'origine. Au survol, un cartouche liste **tous les élèves avec leur valeur à cette date** — exactement le comportement de la capture fournie par Chris. |
| **Un élève sélectionné** | Sa courbe en couleur saturée et épaissie, toutes les autres en gris, la médiane (ou la moyenne, voir Q-B) en pointillé. |

> « faudra vraiment faire en sorte que la courbe de la personne sélectionnée ressorte
> bien par rapport aux grises »

→ Contrainte de rendu : l'écart doit passer par **trois** canaux simultanés (épaisseur,
saturation, et un point terminal marqué ou un halo), pas seulement la couleur. Une seule
courbe colorée au milieu de 19 grises se perd dès que les grises se croisent au même
endroit.

**Deux sélecteurs sur cette section :**
- Onglets **Instagram / YouTube**
- Sélecteur de **métrique** — la section ne montre pas que les abonnés

### D11 — Le tableau `§6`

| Colonne | Règle |
|---|---|
| Élève | Avatar, nom, niche |
| Semaine | `getClientWeek(onboarding_completed_at)` |
| Abonnés | **Séparés Instagram / YouTube**, jamais additionnés |
| Courbe | Suit la période sélectionnée (voir Q-D pour son intitulé) |
| Delta | Suit la période ; au mois en All-Time |
| Posts | Suit la période ; All-Time de l'élève en All-Time |
| Calls | Idem |
| Cash | **Contracté et collecté, avec le pourcentage** — via `lib/dealCash.ts`, jamais une somme à la main |
| Leads | **Optionnel**, seulement s'il reste de la place |

**Le tri n'est pas une barre d'onglets** mais deux contrôles : un **critère** et un
**sens** (croissant / décroissant). Un onglet dit « voici une vue » ; ici on choisit un
axe de lecture et une direction, ce sont deux informations distinctes.

### D12 — Desktop uniquement

Tranché par Chris. La page rejoint `mes-stats` et `clients/[id]/analytics` sous
`<DesktopOnly>`. Aucun travail mobile n'est prévu, et la ligne du tableau n'a donc pas à
être conçue pour s'empiler.

### D13 — On n'agit jamais depuis cette page

Pas d'envoi de message, pas de création de tâche, pas de modale d'action. Les seules
interactions sont **lire, filtrer, et cliquer vers la fiche d'un élève**. Cette décision
retire une catégorie entière de complexité : pas d'écriture, donc pas d'état optimiste,
pas de rollback, pas de `lib/mutate.ts` (voir `reference_mutate_echec_silencieux`).

### D14 — Format des maquettes à partir de maintenant

Demandé par Chris :

1. **D'abord la page entière**, à sa vraie largeur, avec défilement — « comme si c'était
   la plateforme ». La v1 découpait la page en fragments, ce qui empêchait de juger les
   proportions, les respirations et la densité réelle.
2. **Ensuite, section par section**, pour expliquer et proposer des variantes.

---

## 7. Questions ouvertes

### Q-A — Le graphe `§5` : « pourquoi l'axe Y est un peu au milieu et pas tout à gauche ? »

Constat de Chris sur la maquette v1, à reproduire et corriger. Piste : la ligne du zéro
est tracée à `yOf(0)` alors que le minimum de l'échelle est négatif (un élève en recul),
ce qui la remonte au-dessus du bas du graphe. À trancher au passage : est-ce que
l'échelle doit **toujours** partir de 0, quitte à écraser les variations, ou s'adapter
aux données ?

### Q-B — Médiane ou moyenne sur le graphe `§4` ?

Ouvert par Chris. Éléments pour trancher : la **médiane** ne bouge pas quand un seul
élève explose, la **moyenne** oui. À 20 élèves dont un à 146 798 abonnés et un à 1 290,
la moyenne décrit un élève qui n'existe pas.

### Q-C — Les leads entrent-ils dans le bandeau `§2` ?

Chris hésite. Ça ferait 5 cartes. Question de fond : est-ce que « leads » et « calls
bookés » disent deux choses différentes au niveau du portefeuille, ou est-ce que le
second suffit ?

### Q-D — La colonne courbe du tableau : intitulé, fenêtre, et tenue dans le temps

Trois questions de Chris sur le même objet :
- « pourquoi 12 semaines ? » — c'était mon choix par défaut, jamais motivé
- « au bout d'un an, comment ça va s'afficher ? »
- « le nom de la colonne c'est quoi ? »

Acquis : elle suit la période sélectionnée, et vaut le All-Time de l'élève en All-Time.
Reste à trancher le nombre de points et l'intitulé.

### Q-E — Le graphe `§4` en mode All-Time

Chris : « pour le All-Time, je sais pas, propose des solutions ». Le problème : 20 élèves
avec 20 dates de départ, sur un axe calendaire. Les nouveaux arrivants n'ont de courbe
que sur la droite du graphe.

### Q-F — Le graphe `§5` : l'échelle des semaines à 52 contre 1

Question de Chris, et c'est le vrai défaut de conception de cette section :

> « par rapport au nombre de semaines affichées, c'est par rapport à celui qui est le
> plus ancien ? et si y a un mec à 52 semaines et un autre à 1 il sera toujours visible ? »

À 52 semaines d'amplitude, l'élève en S1 est **un point unique collé au bord gauche** —
invisible en pratique. Il faut une réponse explicite, pas un comportement subi.

### Q-G — ~~La règle de déclenchement de la bande `§3`~~ → **répondue par le transcript**

> « il faudra définir pour chaque stat à partir de combien c'est à regarder ? »

Quennel a répondu à cette question exacte le 17 mai : **l'implémentation de ce qu'on dit**
et **la disponibilité en appel**. Voir §9.1 et **D15**. Reste seulement à fixer les seuils
et les fenêtres.

### Q-H — L'intégration qui casse APRÈS le gate (Mécanisme B, voir D2)

Un élève dont un jeton tombe reste compté avec des chiffres figés, sans que rien ne le
dise. Proposition : un bandeau au niveau du portefeuille, l'équivalent coach de
`BandeauIntegrations`. À valider.

---

## 8. Phases d'implémentation

→ **Écrites en section 16.** Les questions Q-A à Q-H sont toutes fermées ; le détail des
phases et les pièges par phase sont en fin de document.

---

## 9. Ce que disent les deux transcripts de calls avec Quennel

Sources : `RDV Onboarding Quennel Momentum` (17 mai 2026, 29 min) et
`RDV Quennel Suivi 1` (28 juin 2026, 48 min). Fournis par Chris le 2026-08-31.

### 9.1 — Q-G est répondue, et la réponse n'est pas une métrique de performance

Christian pose exactement la question (@15:14, onboarding) : « comment est-ce que vous
savez si un client est en train de décrocher ? ». Après relance sur « c'est quoi les
indicateurs », Quennel donne **deux** choses, et deux seulement :

> « **L'implémentation de ce qu'on dit.** » (@16:00)
> « Et **la disponibilité en appel** aussi de temps en temps. » (@16:10)

Ni les abonnés, ni les vues, ni le cash. Du **comportement**, pas de la performance.

**Et la plateforme mesure déjà les deux.** `lib/clientSignals.ts` →
`getClientSignals(tasks, sessionReports)` :

| Ce que dit Quennel | Ce que calcule déjà `getClientSignals` |
|---|---|
| « l'implémentation de ce qu'on dit » | `overdueTasksCount` — tâches assignées **par le coach** et en retard |
| « la disponibilité en appel » | `activeNoShowsCount` — `session_reports.attended === false` non acquittés |

La correspondance est exacte, y compris sur le détail qui compte : `getClientSignals`
filtre sur `added_by === 'coach'`, donc les tâches personnelles de l'élève ne comptent
jamais. C'est bien « l'implémentation de ce que **le coach** dit ».

→ **La règle de la bande `§3` n'est pas à inventer : elle est écrite et testée depuis
des mois.** Elle est simplement affichée sur la mauvaise page (`PageClients`). Voir D15.

### 9.2 — Quennel a listé ses métriques, et les abonnés n'y sont pas

Question posée (@13:09, onboarding) : « c'est quoi les métriques que vous regardez pour
savoir si votre avatar avance ? ». Réponse, dans son ordre :

1. **Le taux de closing**
2. **Le taux de no-show** — « si tu as un gros taux de no-show, en soi c'est un problème
   d'autorité »
3. **Les vues**
4. **La rétention** — « surtout. Donc, quand une personne voit le CTA à la fin »
5. **Le CTR sur les liens en bio**

Puis, mot pour mot :

> « **Et après, c'est tout. Le reste, en soi, c'est pas les métriques les plus
> pertinentes.** On va dire que c'est les simples et les plus importantes. »

⚠️ **Ça contredit frontalement la maquette v2.** J'y ai mis les abonnés au centre : le
grand graphe s'appelle « Croissance de l'audience », le bandeau agrégé affiche « Abonnés
gagnés », le tableau leur consacre deux colonnes, et le tri par défaut classe sur le
mouvement des abonnés. **Quennel ne cite les abonnés à aucun moment**, ni dans
l'onboarding, ni dans les 48 minutes du call de suivi.

Ce qu'il regarde est un **funnel de conversion**, pas une histoire de croissance
d'audience :

```
vues → rétention (voit le CTA) → CTR lien bio → call booké → no-show → closing → cash
```

Les abonnés sont en dehors de cette chaîne. Ils sont la conséquence des vues, pas une
cause de revenus — et Quennel les range explicitement dans « le reste ».

### 9.3 — Ce que Quennel a demandé en plus, dans le call de suivi

| Demande | Horodatage | Statut |
|---|---|---|
| **Taux de réponse au DM1** sur la vue générale | @1:35 | à placer |
| Renommer « Viralité » (→ portée hors abonnés) | @3:42 | hors périmètre de cette page |
| **Partie stories** : nombre postées, nombre de séquences, vues générées, calls bookés, **cash par vue** | @29:23 | métrique candidate |
| **Taux de collecté** — « c'est important de l'avoir très vite aussi » | @19:19, @29:56 | déjà dans D6 |
| **Charges / dépenses**, pour obtenir le net | @18:32 | hors périmètre (page Revenus) |

Et sur la page qui nous occupe (@28:42) : Christian montre l'écran analytics coach en
disant « c'est même pas branché », et ajoute — **« c'est le plus important en plus pour
toi »**. Quennel ne le contredit pas.

### 9.4 — Deux contraintes venues de sa bouche

**Sur le design** (@26:19-27:00, onboarding), sur la question « des trucs que vous ne
voulez pas » :

> William : « il faut que ce soit **extrêmement intuitif** »
> Chris : « des trucs trop surchargés »
> Quennel : « essaye de **pas trop faire un truc dans le style Notion** »
> William : « je mets trop de temps pour comprendre Notion »

Le reproche fait à Notion est précis : le **temps de compréhension**. Une page de stats
qui demande d'apprendre à la lire est disqualifiée par cette phrase.

**Sur l'échelle** (@3:31, onboarding) :

> « Le max, honnêtement, là, maintenant, on ne pourra pas en prendre plus que **10**, je
> pense. Si, à peut-être **15** au grand maximum. »

⚠️ À ne pas confondre avec la cible de robustesse de `AGENTS.md` (30-40 élèves), qui est
une **marge de sécurité technique**, pas une prévision commerciale. Pour le **design**,
la bonne hypothèse est **10 à 15 élèves**, pas 20. Ça n'annule pas l'argument des
courbes illisibles — 15 courbes qui se croisent restent illisibles — mais ça le rend
moins écrasant, et ça change les proportions de la page.

**Sur les plateformes** (@10:30) : Instagram et YouTube, **et rien d'autre**. Pas de
TikTok, pas de LinkedIn, question posée explicitement. Les deux onglets du `§4` sont donc
la liste complète, pas un début.

---

## 10. Décisions issues des transcripts

### D15 — La bande `§3` réutilise `getClientSignals`, elle n'invente aucune règle

Deux signaux, ceux que Quennel a nommés : **tâches du coach en retard** et **no-shows non
acquittés**. Le code existe (`lib/clientSignals.ts`), il est déjà utilisé par
`PageClients`, et il porte déjà les bons filtres.

Reste à trancher : les seuils et les fenêtres (une tâche en retard d'un jour est-elle un
signal ?), et si on ajoute un troisième signal tiré de la performance.

### D16 — À rééquilibrer : la page parle d'abonnés, Quennel parle de conversion

La maquette v2 est construite autour d'une métrique que l'utilisateur final n'a jamais
citée. À reprendre en v3 :

- Le grand graphe `§4` doit proposer **les métriques de Quennel en premier** dans son
  sélecteur : vues, rétention, CTR bio, calls, closing, cash. Les abonnés restent
  disponibles, mais ils ne sont plus le défaut.
- Le bandeau `§2` : « Abonnés gagnés » est la seule des quatre cartes qui ne figure pas
  dans sa liste. Candidat au remplacement.
- Le tableau `§6` : deux colonnes d'abonnés sur neuf, c'est beaucoup pour une métrique
  rangée dans « le reste ».
- Le tri par défaut « mouvement » se calcule aujourd'hui sur les abonnés. À rebaser.

⚠️ **Ne pas sur-corriger.** Chris a explicitement demandé les abonnés séparés IG/YT dans
le tableau, et le graphe de croissance d'audience vient de sa maquette d'origine. Les
transcrits datent de mai et juin ; l'arbitrage revient à Chris, pas au document.

---

## 11. Corrections de Chris sur les transcripts (2026-08-31)

### D17 — L'échelle de conception est **40 élèves**, pas 10-15

Le « 10, peut-être 15 au grand maximum » de Quennel (@3:31, onboarding du 17 mai)
décrivait sa capacité **du moment**, dans une phase où il disait lui-même que son
problème numéro un était l'acquisition. Chris tranche : **40 à terme**.

Conséquence : c'est aussi la cible de robustesse de `AGENTS.md`, donc design et technique
visent enfin le même nombre. Et l'argument des courbes illisibles reprend toute sa force —
40 courbes sur un axe commun ne se lisent pas, quelle que soit la palette.

⚠️ Le §9.4 du présent document affirmait le contraire. **Il est caduc sur ce point
uniquement** ; le reste du §9 (les métriques de Quennel, sa règle de décrochage, les
contraintes de design) reste valide.

### D18 — La bande `§3` est un **miroir exact** de « Clients à surveiller », pas une variante

Demande de Chris : « les élèves affichés ici seront les mêmes que ceux affichés sur
l'écran d'accueil du coach dans clients à surveiller ».

La section existe : `components/pages/coach/PageToday.tsx:392`. Sa règle, ligne 88 :

```js
const watchList = clientsWithSignals
  .filter(cs => cs.signals.total > 0)
  .sort((a, b) => b.signals.total - a.signals.total)
  .slice(0, 4);
```

Tout est déjà tranché, y compris ce que je comptais demander :

| Point | Valeur déjà en place |
|---|---|
| Seuil de déclenchement | `total > 0` — **un seul signal suffit** |
| Tri | Nombre de signaux, décroissant |
| Plafond | **4** élèves (ma maquette en montrait 3) |
| État vide | « Aucun signal actif ✓ », en vert |
| Sous-titre de la carte | « Tâches en retard ou no-show non traité » |
| Libellé par élève | « N tâches en retard · N no-shows », joints par ` · ` |

→ **Rien à décider, rien à réécrire.** La bande de `§3` reprend `getClientSignals`, le
même tri, le même plafond et les mêmes phrases. Deux pages qui affichent la même chose
avec deux règles recopiées finiraient par diverger — c'est le motif exact des onze écarts
du 2026-08-19 (`docs/perimetre-stats-referentiel.md`).

⚠️ **À l'implémentation : extraire ce calcul**, ne pas le recopier. `watchList` est
aujourd'hui une expression locale dans `PageToday`. Elle doit devenir une fonction
partagée (à côté de `getAggregatedSignals` dans `lib/clientSignals.ts`), appelée par les
deux pages.

**Ce que ça referme :** la variante B du `§3` de la maquette v3 (ajouter l'arrêt de
publication comme troisième signal) sort du périmètre — elle ferait diverger les deux
écrans. Si ce signal doit exister un jour, il s'ajoute **dans la fonction partagée**, donc
sur les deux pages à la fois.

---

## 12. Arbitrages de Chris sur la maquette v4 (2026-08-31)

### D19 — Bandeau `§2` : **5 cartes**, ordre imposé

`Cash` · `Abonnés` · `Leads` · `Calls` · `Ventes`

Le cash garde sa ligne secondaire « X % des Y € contractés ». À 5 colonnes la carte est
plus étroite : cette ligne doit tenir sans passer à la ligne, sinon la carte grandit et
décale tout le bandeau.

### D20 — Bande `§3` : les 2 signaux de Quennel **+ un signal de performance**

Chris choisit la variante B : tâches du coach en retard, no-shows non acquittés, **et
l'arrêt de publication**.

⚠️ **Conséquence non optionnelle, à valider avant d'écrire une ligne.** D18 a établi que
cette bande est le **miroir exact** de « Clients à surveiller » sur l'accueil
(`PageToday.tsx:392`), qui n'a que **deux** signaux. Deux issues, pas trois :

| | Ce que ça implique |
|---|---|
| **(a) Le 3ᵉ signal entre dans la fonction partagée** | `getClientSignals` gagne un champ `noPublishDays`. **L'accueil du coach change aussi** : il affichera les mêmes élèves, avec la même phrase. Les deux écrans restent identiques. |
| **(b) La bande de Stats Clients a sa propre règle** | Les deux écrans affichent des élèves différents sous le même nom. C'est exactement le motif des onze écarts du 2026-08-19. **À écarter.** |

→ **(a)**, sauf refus explicite de Chris. Ce n'est pas un détail d'implémentation : ça
modifie un écran qu'il n'a pas demandé à changer.

**Ce que le 3ᵉ signal exige en plus des deux autres :** un seuil et une fenêtre. Les deux
signaux existants n'en ont pas besoin (une tâche est en retard ou ne l'est pas). « Arrêt
de publication » demande de fixer un nombre de jours. Non tranché.

### D21 — Graphe `§5` : **plage réglable** (F3), et masquage réduit à 5 jours

Chris retient F3. Le masquage passe de « moins de 4 semaines » à **« moins de 5 jours »**
— donc on n'exclut plus que les élèves qui n'ont littéralement aucun historique.

La cohérence tient : c'est **le curseur de plage qui produit la lisibilité**, plus le
masquage. Si le coach regarde S1→S12, un élève à S3 y est parfaitement visible ; c'est
sur un axe à 52 semaines qu'il disparaissait.

### D22 — Tableau `§6` : la colonne courbe suit la période (variante D1)

7 points en semaine, 30 en mois, un point par mois en All-Time. L'intitulé est **calculé**
depuis la période : « Cette semaine », « Ce mois », « Depuis l'arrivée ». Les 12 semaines
codées en dur disparaissent, et la question du « au bout d'un an » avec elles.

### D23 — Le titre d'une carte-graphe suit la métrique affichée

Relevé par Chris : « c'est juste, tu vois, "croissance d'audience", faudra le changer à
chaque fois ». Exact — un titre fixe au-dessus d'un sélecteur de métrique devient faux dès
le premier changement.

Le titre, le sous-titre et l'unité de l'axe se calculent tous depuis la métrique
sélectionnée. Aucune chaîne de caractères en dur au-dessus d'un sélecteur.

### D24 — Au-delà de 8 courbes, le repos n'est plus « toutes en couleur »

Problème posé par Chris sur l'All-Time : « ça devient un peu des spaghettis
incompréhensibles ».

Le diagnostic est plus large que l'All-Time : **le rendu « toutes les courbes en couleur »
que Chris a demandé en D10 ne fonctionne que jusqu'à 7 ou 8 élèves** — c'est le nombre
qu'affichait sa maquette d'origine. À 37, il est illisible quelle que soit la période.

Règle proposée, automatique, sans réglage :

| Nombre de courbes | Rendu au repos |
|---|---|
| **≤ 8** | Toutes en couleur — le rendu de la maquette d'origine, préservé |
| **> 8** | **Médiane en trait plein + bande interquartile ombrée + les individus en gris très clair** |

Dans les deux cas, le survol garde le cartouche multi-élèves, et le clic isole toujours
une personne en couleur.

Ce que la bande apporte que 37 courbes colorées n'apportent pas : elle répond
immédiatement à « est-ce que cet élève est au-dessus ou en dessous des autres », qui est
la seule question qu'un coach pose devant un graphe de portefeuille. Trente-sept couleurs
ne répondent à aucune question — elles obligent à chercher une légende de 37 entrées.

### D25 — Défaut du graphe `§4` : **abonnés**

Chris tranche : le défaut reste les abonnés, les métriques de Quennel restent dans le
sélecteur. **D16 est donc close** — l'écart avec les transcripts est assumé, pas ignoré.

### D26 — ⚠️ Le plafond de 4 empêche le 3ᵉ signal de faire remonter qui que ce soit

Découvert en implémentant D20 sur 37 élèves simulés, seuil à 10 jours sans publier :
**8 élèves portent au moins un signal, la bande en montre 4**, et comme le tri classe par
**nombre** de signaux, les tâches en retard et les no-shows passent systématiquement
devant. Les trois élèves qui n'ont *que* le signal de publication ne remontent jamais,
quel que soit le seuil choisi.

Autrement dit : **le 3ᵉ signal n'ajoute qu'une phrase à des gens déjà signalés.** Le
seuil en jours, qu'on croyait être la question, ne change presque rien tant que le
plafond et le tri restent ceux de `PageToday`.

Trois issues, aucune évidente :

| | Coût |
|---|---|
| **(a) Monter le plafond** à 6 ou 8 | La bande devient un deuxième tableau et perd son rôle. Change aussi l'accueil. |
| **(b) Trier par gravité** | Impose de pondérer chaque signal, donc d'inventer un score — et un score ne s'explique pas à l'écran. |
| **(c) Laisser tel quel** | Le 3ᵉ signal enrichit la phrase, ne déclenche jamais. Un élève sans publication depuis 3 semaines et sans tâche en retard n'apparaît nulle part. |

→ **(c)** proposé : ne casse rien, n'invente aucun score, et garde les deux signaux de
Quennel comme seuls déclencheurs. **En attente de l'arbitrage de Chris.**

⚠️ Ce plafond de 4 vient de `PageToday`, où il a été dimensionné pour un portefeuille
bien plus petit. **À 40 élèves il cache plus qu'il ne montre** — le problème existe donc
déjà sur l'accueil, indépendamment de cette page.

---

## 13. Arbitrages sur la v5 (2026-08-31)

### D27 — La bande `§3` devient un carrousel, et **perd son plafond**

Demande de Chris : le même défilement que les rapports de calls quand il y en a
plusieurs. Le mécanisme est `PendingRapportCard` + les classes `.rapport-fil` /
`.rapport-slide` / `.rapport-points` (`app/globals.css:3202`) :

- `display:flex` + `overflow-x:auto` + `scroll-snap-type: x mandatory`
- **Ascenseur masqué** (`scrollbar-width:none` + `::-webkit-scrollbar{display:none}`)
- `flex: 0 0 calc(100% - 28px)` : **le débord de l'élément suivant EST l'indication de
  défilement.** Le commentaire du fichier est explicite — « un élément visiblement coupé
  se lit comme *ça continue* », et il remplace toute mention « glisser ».
- **Aucune flèche.** Elles ont été retirées volontairement : 44 px chacune, 104 px avec
  les gouttières sur 358 px de large en mobile, et elles restaient affichées à
  `opacity: .2` même pour un seul élément.
- Pastilles en dessous pour la position, `goTo(i)` au clic.
- ⚠️ **L'index se déduit du défilement réel** (`onScroll` → `Math.round(scrollLeft/step)`),
  jamais d'un état maintenu à la main : « le doigt peut s'arrêter n'importe où, c'est
  l'accroche CSS qui tranche ».
- `SLIDE_GAP` en JS **doit rester égal** au `gap` du CSS.

**Conséquence directe : D26 est close.** Le plafond de 4 disparaît sur Stats Clients,
tous les élèves signalés sont accessibles en défilant. Le 3ᵉ signal fait donc bien
remonter des gens, et la question du tri par gravité s'évapore.

### D28 — L'accueil garde son plafond de 4 et renvoie ici

Solution de Chris. **Deux changements sur `PageToday`, pas un :**

1. Le lien « Voir tout » de la carte passe de `/clients` à Stats Clients
   (`PageToday.tsx:399`). Sans ça le coach atterrit sur la liste complète, pas sur la
   bande qui défile.
2. Le 3ᵉ signal entre dans `getClientSignals`, donc **l'accueil l'affiche aussi**. C'est
   ce qui garantit que les deux écrans montrent les mêmes élèves.

⚠️ **En attente du feu vert de Chris** : ça modifie un écran qu'il n'a pas demandé à
changer.

### D29 — Graphe au repos : variante B, avec la **moyenne**

Chris retient la bande, mais avec la moyenne plutôt que la médiane. La bande ombrée reste
la **moitié centrale** (25–75 %) et est étiquetée comme telle.

⚠️ Noter l'attelage : ligne = moyenne, bande = quartiles. Statistiquement hétérogène,
visuellement lisible, et les deux sont nommés à l'écran. Si un jour ça gêne, la bande
deviendra ± un écart-type — mais elle sera alors beaucoup plus sensible aux gros comptes.

### D30 — Bascule couleur / bande à **10 élèves**

Chris tranche 10 (je proposais 8). En dessous : toutes les courbes en couleur, le rendu
de sa maquette d'origine. Au-delà : moyenne + bande + individus en gris.

### D31 — Les deux interactions sont confirmées

- **Clic sur une personne** → sa courbe passe en couleur pleine, épaissie, avec un point
  terminal cerclé de blanc et son prénom. Les autres passent en gris.
- **Survol** → le cartouche liste **le maximum de monde** verticalement. Passé de 8 à
  **16 lignes**, avec un « + N autres » quand il en reste.

### Q ouverte — Le tableau à 40 lignes

Ni recherche, ni pagination, ni en-tête collant. À 40 élèves, dès qu'on descend on ne
sait plus quelle colonne on lit, et le tri ne remplace pas la recherche : chercher
quelqu'un par son nom ne devrait pas obliger à reclasser la page.

Proposition : **en-tête collant + champ de recherche**, sans repli des lignes — la page
est en bas de parcours, on y vient justement pour tout voir.

---

## 14. Arbitrages sur la v6 (2026-09-01)

### D32 — Seuil d'arrêt de publication : **7 jours**

Chris tranche 7 (je recommandais 21). C'est le **seul seuil de toute la page**.

⚠️ Conséquence mesurée sur les 37 élèves simulés : à 7 jours, **8 élèves sur 8 portant un
signal sont retenus** — la bande contient tout le monde qui a une semaine creuse. C'est un
choix de sensibilité assumé : mieux vaut voir trop tôt que trop tard. À surveiller après
la mise en service : si la bande est pleine en permanence, elle cesse d'être lue.

### D33 — Les deux changements sur `PageToday` sont validés

1. « Voir tout » de la carte « Clients à surveiller » pointe vers Stats Clients au lieu de
   `/clients` (`PageToday.tsx:399`).
2. Le 3ᵉ signal entre dans `getClientSignals`, donc l'accueil l'affiche aussi. L'accueil
   garde son plafond de 4 ; Stats Clients les montre tous en défilant.

### D34 — Le tableau gagne un en-tête collant et une recherche

Pas de pagination ni de repli : la page est en bas de parcours, on y vient pour tout voir.

### D35 — Le clic sur une ligne **navigue**, le survol met la courbe en avant

Comportement du code actuel préservé (`/clients/[id]/analytics`). Le survol d'une ligne
met la courbe de cet élève en avant dans le graphe, sans naviguer. Un geste, un résultat.

### D36 — Fraîcheur : « màj il y a X » calculé sur l'élève **le plus en retard**

La page lit la base seule — 40 élèves × 4 API au chargement serait 160 appels et ferait
sauter les quotas Meta et YouTube. L'indicateur porte donc sur le portefeuille entier :
un seul élève à jour ne doit pas afficher « il y a 5 min » quand la moitié date d'hier.

### D37 — Pas de bouton Rafraîchir

Toutes les autres pages de stats en ont un ; ici il déclencherait les 160 appels.
L'indicateur de fraîcheur et le bandeau d'intégration disent déjà ce qu'il faut savoir.

### D38 — Un seul export CSV, sur le tableau

Il sort exactement ce qui est affiché : période courante, tri courant, colonnes visibles.
Le bouton « Exporter » global de la maquette d'origine disparaît — il ne disait pas ce
qu'il exportait.

### D39 — Les flèches ‹ › reculent jusqu'au **plus ancien du portefeuille**

Un élève qui n'existait pas à cette période affiche « pas encore arrivé » dans le tableau,
jamais un `0`.

### D40 — Un élève archivé reste dans les agrégats des périodes **antérieures** à son archivage

Le cash de juillet reste le cash de juillet même si on archive quelqu'un en septembre. Le
tableau ne le montre plus.

⚠️ **Ça diverge du comportement de tous les autres écrans**, qui filtrent
`archived_at is null` sans regarder la date. C'est délibéré : ailleurs on affiche un état
courant, ici on affiche un historique — et un historique qui se réécrit quand on archive
quelqu'un n'est pas un historique. À écrire dans le code, sinon la prochaine relecture le
prendra pour un oubli et « corrigera » le filtre.

### Q ouverte — Les stories dans le tableau

Non tranchée : les propositions n'étaient pas lisibles en texte. Reportée à la maquette,
trois options rendues en taille réelle.

---

## 15. Arbitrages sur la v7 et la v8 (2026-09-01)

### D41 — Les stories vont dans le **sélecteur du graphe**, pas dans le tableau

Le tableau garde ses 10 colonnes. Les quatre mesures que Quennel a demandées (stories
postées, séquences, vues générées, cash par vue) entrent toutes dans le sélecteur de
métrique du `§4`, où il y a la place pour les quatre.

Les deux alternatives ont été rendues en taille réelle avant d'être écartées : une 11ᵉ
colonne resserre tout et ne laisse de place pour aucune des trois autres mesures ; et
additionner posts et stories dans une colonne « Publications » produit un nombre
ininterprétable, qui récompense celui qui poste vingt stories vides.

### D42 — Le menu de tri distingue Instagram de YouTube

Demande de Chris. Le menu complet, dans cet ordre :

`Variation d'abonnés IG` (défaut) · `Variation d'abonnés YT` · `Abonnés IG` ·
`Abonnés YT` · `Posts` · `Leads` · `Calls bookés` · `Cash collecté` · `Ancienneté` · `Nom`

Plus le bouton croissant / décroissant à côté (D11). « Mouvement » disparaît : un critère
de tri doit nommer sa métrique, surtout celui qui s'applique par défaut sans que le coach
l'ait choisi.

### D43 — La colonne s'appelle « Calls bookés » et compte les **RDV de vente de l'élève**

Pas les coachings avec le coach — l'assiduité de l'élève est déjà couverte par les
no-shows dans la bande du `§3`.

⚠️ **Trois pièges documentés sur cette lecture, tous à respecter ensemble**
(`docs/calls-coach-id-piege.md`, `lib/callTypes.ts`, mémoire projet) :

1. **`calls.coach_id` n'est PAS le coach** — c'est le `profile_id` de l'**élève**. Filtrer
   sur le coach connecté renvoie quasiment rien : le bug du 2026-08-03 affichait 1 call
   et 1 000 € au lieu de 8 calls et 4 500 €.
2. **Vente = `call_type IN ('calendly','manual')`**, jamais `= 'calendly'` seul. Jusqu'au
   2026-08-29, ce filtre trop strict faisait disparaître de tous les écrans les calls
   créés à la main (appel reporté, 2ᵉ call, geste « avancer vers RDV pris »).
3. **`ignored is not true`** sur toute lecture de `calls`.

### D44 — La carte « Abonnés » du bandeau porte son détail

`+19 600` en valeur principale, `IG +16 200 · YT +3 400` en ligne secondaire — la même
structure que la carte cash qui porte déjà son pourcentage. Le bandeau reste à 5 cartes.

Écarté : additionner sans le dire (un abonné Instagram et un abonné YouTube ne coûtent ni
ne rapportent la même chose), et passer à 6 cartes (la carte cash perdrait la place de sa
ligne secondaire).

### D45 — Le bandeau d'intégration est validé, **avec** son lien

« Voir lesquels » **filtre le tableau du bas** sur les élèves concernés et y fait défiler.
C'est le mécanisme du champ de recherche, déclenché par le lien : aucune modale, aucune
écriture — cohérent avec D13.

Le bandeau ne s'affiche que s'il a quelque chose à dire, et il énonce la **conséquence**
(« faussent les totaux ci-dessous »), pas seulement l'état.

### D46 — L'agrégation se fait **côté base, dans une fonction SQL**

À 40 élèves en All-Time, la page devrait sinon rapatrier de l'ordre de **15 000 lignes**
de `analytics_daily_snapshots` et les additionner en JavaScript. La base renverra quelques
centaines de lignes déjà groupées par élève et par semaine.

C'est la même logique que `get_ig_posts_history` / `get_yt_videos_history`, qui existent
déjà. Écarté : la troisième voie (une table d'instantanés remplie par `poll-leads`) —
elle serait une quatrième copie de la vérité à garder synchrone, et le projet a déjà payé
ce prix.

⚠️ **La fonction devra respecter `lib/period.ts`** : fenêtres **calendaires**, semaines ou
mois, jamais glissantes. C'est la garantie sur laquelle repose
`degrossir_historiques_analytics()` (voir `AGENTS.md`) — une fonction qui agrégerait jour
par jour ou sur une fenêtre glissante invaliderait la rétention, et la perte serait
silencieuse.

### Non-décision — La route reste `/analytics`

Le libellé de la barre latérale est **déjà** « Stats Clients » (`Sidebar.tsx:14`), seul le
chemin est resté `/analytics`. Le renommer casserait les liens existants pour un gain
purement cosmétique, invisible du coach.

### D47 — Les pastilles de légende sont **conservées**

Chris tranche. Je proposais de les supprimer : à 37 élèves elles forment un pavé plus haut
que le graphe, et le survol d'une ligne du tableau (D35) fait déjà le même travail.

Sa raison, et elle est bonne : **c'est le seul moyen d'épingler un élève durablement**,
sans garder la souris sur sa ligne. On peut alors changer de métrique ou d'onglet en
gardant la même personne en avant — ce que le survol ne permet pas.

⚠️ Coût assumé : deux bandes de 37 pastilles sur la page. Si ça se révèle pénible à
l'usage, la porte de sortie est le champ « épingler un élève » à côté du sélecteur de
métrique, pas la suppression pure.

### D48 — Chargement : **squelette de la page**

Les formes grises ont exactement les dimensions du contenu qui va les remplacer. Reprend
le motif de `PageClients`, dont le code porte déjà la raison :

> « Squelette plutôt qu'un loader centré : la page montre sa structure (en-tête + lignes
> de clients), donc elle paraît déjà là et le contenu remplace des formes de mêmes
> dimensions au lieu de surgir dans le vide. »

### D49 — État vide : **un message qui explique la suite**, jamais des zéros

« Aucun élève n'a encore de données. Les chiffres apparaîtront dès qu'un élève aura
connecté ses 7 intégrations », suivi de la **liste nommée** de ceux en cours
d'installation avec leur état.

Un `0` affirmerait qu'il ne s'est rien passé alors qu'on ne sait pas encore
(`AGENTS.md`). Et l'écran doit survivre à une capture (`PRODUCT.md`) : nommer les trois
élèves à relancer transforme un vide en action.

---

## 16. Phases d'implémentation

**Aucune ligne de code n'a encore été écrite.** Les 49 décisions ci-dessus sont fermées ;
ces phases sont l'ordre dans lequel les appliquer. Chaque phase est livrable seule.

### Phase 0 — Le travail partagé, avant de toucher à la page

Trois extractions, toutes dans du code existant. **C'est la phase la plus risquée du
chantier** : elle modifie des écrans qui marchent aujourd'hui.

| Ce qu'on extrait | D'où | Pourquoi |
|---|---|---|
| `PeriodPill` | `PageClientStats.tsx:8122` | D3 — deux pages, un seul composant, sinon il divergera |
| `watchList` | expression locale dans `PageToday.tsx:88` | D18, D27 — deux écrans doivent montrer les mêmes élèves |
| 3ᵉ signal `noPublishDays` | à ajouter dans `getClientSignals` | D20, D32 — seuil **7 jours** |

Puis les deux changements validés sur `PageToday` (D33) : le lien « Voir tout » pointe
vers Stats Clients, et l'accueil affiche le 3ᵉ signal en gardant son plafond de 4.

⚠️ **Vérifier l'accueil après cette phase seule**, avant de continuer. Si elle casse
quelque chose, il faut le savoir avant que la nouvelle page brouille la piste.

### Phase 1 — La fonction SQL d'agrégation (D46)

Elle rend, par élève et par fenêtre : abonnés IG, abonnés YT, vues, posts, clics, leads,
calls bookés, cash contracté, cash collecté.

⚠️ **Fenêtres calendaires, jamais glissantes** — c'est la garantie sur laquelle repose
`degrossir_historiques_analytics()` (`AGENTS.md`). Une agrégation jour par jour ou sur une
fenêtre glissante invaliderait la rétention, **et la perte serait silencieuse**.

Les règles de périmètre à respecter, toutes documentées et toutes déjà à l'origine d'un
bug :

- Date de départ : `integrations_ready_at`, jamais `onboarding_completed_at`
  (`docs/perimetre-stats-referentiel.md` règle 1)
- Calls : `coach_id = profile_id de l'élève`, `call_type IN ('calendly','manual')`,
  `ignored is not true`, découpe sur `booked_at` avec repli `scheduled_at` (D43)
- Cash : `lib/dealCash.ts`, jamais une somme à la main — sept lectures le faisaient encore
  le 2026-08-30 et n'ont donc jamais déduit un remboursement
- Leads : `fetchAllLeadsCount`, pas `fetchIgLeadsCount` — le second est Instagram seul
- Archivés : conservés pour toute période **antérieure** à leur archivage (D40)

**Vérification de la phase** : comparer, pour un élève, les chiffres rendus par la
fonction et ceux affichés sur sa propre page `Mes Stats`. Un écart ici est un écart entre
deux écrans, et c'est exactement ce que le référentiel de périmètre existe pour empêcher.

### Phase 2 — La page, le bandeau, les états

Route `/analytics` conservée (le libellé de la barre latérale dit déjà « Stats Clients »).
En-tête + `PeriodPill` + 5 cartes (D6, D19, D44) + bandeau d'intégration (D45) + squelette
(D48) + état vide (D49).

À ce stade la page est déjà utile et livrable.

### Phase 3 — La bande « à regarder »

Carrousel repris de `PendingRapportCard` (D27) : accroche CSS, ascenseur masqué, débord de
la carte suivante, pastilles, aucune flèche. ⚠️ `SLIDE_GAP` en JS doit rester égal au
`gap` du CSS, et l'index se déduit du défilement réel.

### Phase 4 — Les deux graphes

`§4` calendaire avec onglets IG/YT et sélecteur de métrique ; `§5` en semaines
d'accompagnement avec plage réglable. Titre, sous-titre et unité **calculés** depuis la
métrique (D23). Bascule couleur / moyenne+bande à 10 courbes (D29, D30). Cartouche à 16
lignes, pastilles d'épinglage conservées (D31, D47).

### Phase 5 — Le tableau

10 colonnes, tri à 10 critères + sens, recherche, en-tête collant, export CSV, clic qui
navigue et survol qui met la courbe en avant (D11, D34, D35, D38, D42, D43).

### Phase 6 — Vérification de bout en bout

Passer la page au skill `audit-metrique-bout-en-bout` : API → base → écran, métrique par
métrique, en recoupant avec une réponse d'API réelle. C'est la méthode qui a trouvé 4
problèmes sur 4 métriques auditées le 2026-08-20.

Puis les points de `docs/checklist-scalabilite.md` qui concernent une lecture : coût de la
requête à 40 élèves, comportement quand une intégration est déconnectée, comportement
quand un élève n'a aucune donnée.

---

## 17. Les pièges à ne pas rouvrir

Rassemblés ici parce qu'ils sont dispersés dans les décisions et qu'une relecture future
les prendra pour des oublis à « corriger ».

1. **`calls.coach_id` est le `profile_id` de l'élève**, pas le coach. Filtrer sur le coach
   connecté renvoie quasiment rien.
2. **Vente = `('calendly','manual')`**, jamais `= 'calendly'` seul.
3. **Le filtre des archivés est volontairement différent ici** : les autres écrans font
   `archived_at is null` sans regarder la date, cette page conserve les archivés dans le
   passé. Ailleurs on affiche un état courant, ici un historique — et un historique qui se
   réécrit quand on archive quelqu'un n'est pas un historique.
4. **Aucun appel d'API depuis cette page.** 40 élèves × 4 API = 160 appels et les quotas
   Meta et YouTube sautent. C'est pourquoi il n'y a pas de bouton Rafraîchir.
5. **« Màj » porte sur l'élève le plus en retard**, pas le plus récent. Un seul élève à
   jour ne doit pas afficher « il y a 5 min ».
6. **Le seuil de 7 jours est le seul seuil de la page.** Il rend la bande sensible : à
   surveiller après mise en service, une bande toujours pleine cesse d'être lue.
7. **Les abonnés ne sont pas une métrique de Quennel.** Il cite closing, no-show, vues,
   rétention, CTR bio — « et après c'est tout ». Le défaut sur les abonnés est un choix
   assumé de Chris (D25), pas un oubli.

---

## 18. Revue d'ingénierie (2026-09-01)

Six trouvailles, dont deux P1. Les politiques RLS ont été vérifiées en base, pas supposées.

### D50 — Les graphes sont dessinés en **SVG à la main**, pas en Recharts

L'app utilise Recharts partout (`recharts ^3.8.1`). Cette page est l'exception, et
c'est délibéré : au repos elle trace **39 séries** (37 élèves en gris + la moyenne + la
bande interquartile), et le survol d'une ligne du tableau (D35) redessine le graphe.
En Recharts, chaque survol déclenche un cycle de réconciliation React sur 39 composants
`<Line>` ; en SVG assemblé, c'est un `innerHTML` unique avec un anti-rebond de 60 ms.

Chris a délégué le choix en demandant « le plus robuste et le plus ergonomique ». Les
deux autres options coûtaient soit une mémoïsation acrobatique, soit l'abandon du survol
qu'il venait de choisir.

⚠️ **Ne pas généraliser.** C'est une exception motivée par le nombre de séries. Toute
page à moins de dix séries continue d'utiliser Recharts et `components/charts/`.

### D51 — Le clic sur une ligne va sur la **fiche client**, pas sur ses stats

Correction de D35, sur la parole de Chris : « ça t'amène à la fiche client de la
personne ». Donc `/clients/[id]`, pas `/clients/[id]/analytics`.

Rien n'est perdu : la fiche porte déjà un bouton primaire vers les stats
(`PageClientDetail.tsx:684`), et elle donne le contexte complet — tâches, notes,
ressources, messages — qui est ce qu'on veut quand on repère quelque chose dans le
tableau.

### D52 — La fonction SQL : `SECURITY INVOKER`, et **niveau ≠ flux**

**Deux règles, les deux P1.**

**1. `SECURITY INVOKER` (le défaut), jamais `DEFINER`.** Vérifié en base : les politiques
existantes donnent déjà exactement le bon périmètre au coach.

| Table | Politique | Effet |
|---|---|---|
| `analytics_daily_snapshots` | `coach sees clients` | le coach lit les snapshots de ses élèves |
| `deals` | `deals_owner` | idem sur les ventes |
| `calls` | `coach sees client calls` | via `clients.profile_id = calls.coach_id` |

En `INVOKER`, le filtrage est hérité gratuitement et ne peut pas être contourné. En
`DEFINER`, il faudrait le réécrire à la main — et une erreur exposerait les élèves d'un
autre coach. **À écrire dans le commentaire de la fonction**, sinon quelqu'un la passera
un jour en `DEFINER` pour gagner en vitesse.

Bonus : la politique sur les snapshots ne filtre pas `archived_at`, donc D40 fonctionne
sans rien ajouter.

**2. Deux natures de métriques, deux agrégations.**

```
NIVEAU  — une photo à un instant          FLUX  — un compteur sur la période
ig_followers, yt_subscribers, mrr         ig_views, posts, shortio_clicks,
                                          calls_booked, deals_closed, revenue
        ↓                                         ↓
DERNIÈRE valeur de la fenêtre             SOMME sur la fenêtre
        ↓                                         ↓
sommer donnerait 7× les abonnés           prendre la dernière ne verrait
                                          qu'un jour sur sept
```

Le plan disait « agrégé par élève et par semaine » sans trancher. C'est exactement la
classe de bug que ce projet a déjà rencontrée plusieurs fois.

### D53 — `lib/clientSignals.ts` : les tests **avant** la modification

Ce module n'a aucun fichier de test, alors que onze autres modules de `lib/` en ont un.
Et il est lu par **deux écrans en production** — `PageToday` et `PageClients`.

Ordre imposé : écrire `clientSignals.test.ts` sur le comportement **actuel** (2 signaux),
vérifier qu'il passe, **puis** ajouter le 3ᵉ signal. Sinon on testerait ce qu'on vient
d'écrire au lieu de ce qui existait, et une régression sur l'accueil passerait inaperçue.

### D54 — La page charge ses élèves elle-même, pas via le contexte

`SupabaseClientsContext` filtre `archived_at is null` (ligne 91). D40 impose de garder
les archivés dans les périodes antérieures à leur archivage : la page a donc besoin de sa
propre requête `clients`, avec `archived_at`, en plus du contexte.

### D55 — Une seule table `METRIQUES`, partagée

Trois correspondances risquent d'être écrites en dur à trois endroits : métrique → titre,
métrique → unité, métrique → nature (niveau ou flux). Une seule table, lue par la
fonction SQL, le graphe et le tableau. C'est le motif exact des onze écarts du
2026-08-19 : une règle recopiée diverge dès que l'une des copies bouge.

---

## GSTACK REVIEW REPORT

| Revue | Déclencheur | Pourquoi | Passages | Statut | Trouvailles |
|---|---|---|---|---|---|
| Eng Review | `/plan-eng-review` | Architecture et tests (requise) | 1 | ISSUES_RESOLUES | 6 trouvailles, 2 P1, 0 non résolue |
| CEO Review | `/plan-ceo-review` | Périmètre et stratégie | 0 | — | — |
| Design Review | `/plan-design-review` | Écarts UI/UX | 0 | couvert par 10 versions de maquette arbitrées | — |
| Outside Voice | — | Second avis indépendant | 0 | — | — |

**Détail des trouvailles**

| # | Sévérité | Confiance | Sujet | Issue |
|---|---|---|---|---|
| 1 | P1 | 9/10 | Niveau contre flux dans l'agrégation SQL | D52 |
| 2 | P1 | 9/10 | `SECURITY INVOKER` obligatoire | D52 |
| 3 | P1 | 9/10 | `clientSignals.ts` sans test, modifié, lu par 2 écrans | D53 |
| 4 | P2 | 8/10 | D40 incompatible avec `SupabaseClientsContext` | D54 |
| 5 | P2 | 8/10 | Choix de bibliothèque graphique jamais posé | D50 |
| 6 | P2 | 8/10 | Trois tables de correspondance à ne pas dupliquer | D55 |

**HORS PÉRIMÈTRE** — mobile (desktop seulement, D12) · toute écriture depuis la page
(D13) · le renommage de la route `/analytics` (cosmétique, casserait les liens) · les
métriques de rétention et de CTR bio que Quennel cite mais qui ne sont pas encore
collectées par élève · une table d'instantanés remplie par le cron (écartée en D46 : une
quatrième copie de la vérité).

**NON RÉSOLU** — aucun. Les six trouvailles sont tranchées en D50 à D55.

**VERDICT : ENG REVIEW PASSÉE** — 0 décision non résolue, 0 faille critique sans parade.
Prêt à implémenter, en commençant par la phase 0 (§16).

---

## 19. Phase 1 — ce que la fonction SQL a révélé (2026-09-01)

### D56 — ⚠️ La fonction n'utilise PAS `calls_booked`, `deals_closed` ni `revenue`

D52 avait vu deux natures dans `analytics_daily_snapshots` — niveau et flux. **Il y en a
une troisième, et deux noms de colonnes mentent dessus.**

Relevé en base sur le profil `a02e5927` :

```
date        calls_booked  deals_closed  revenue     ig_views  ig_followers
2026-08-20      17             8        12000.00       16        254
2026-08-28      17             8        12000.00       13        255
2026-08-29      18             8        12000.00       11        255
```

`revenue` vaut **12 000 € tous les jours** : c'est le cumul depuis le début, pas le
revenu du jour. `poll-leads` les écrit avec `calls.filter(...).length` sur tout
l'historique, réécrit à chaque passage. **Les sommer sur 30 jours donnerait 360 000 € au
lieu de 12 000.**

Le commentaire de `poll-leads` l'annonce sans le dire : « ces colonnes ne sont lues par
aucun écran aujourd'hui, mais restent correctes pour le jour où un historique sera
affiché ». Elles sont correctes **en tant que cumul**, pas en tant que série.

Deuxième raison, indépendante : elles dérivent de `calls.revenue`, alors que depuis le
2026-08-20 tous les écrans lisent `deals` — `calls.revenue` n'est plus qu'une trace du
rapport de call.

→ **Calls, ventes et encaissements sont lus depuis leurs tables sources**, avec les
règles de `docs/perimetre-stats-referentiel.md` et `docs/calls-coach-id-piege.md`. Ils
n'ont d'ailleurs aucun problème de volume : quelques milliers de lignes à 40 élèves,
contre 15 000 pour les seuls snapshots quotidiens. **La fonction SQL existe pour le
volume, et le volume est dans les snapshots.**

Documenté dans `AGENTS.md` : le piège dépasse ce chantier, n'importe qui lisant ces
colonnes tombe dedans.

### D57 — `ig_reach` est exclu : il n'a aucune agrégation correcte

La portée est **dédupliquée par Meta** sur sa propre fenêtre. La somme de sept portées
quotidiennes compte plusieurs fois la même personne ; la dernière valeur ne couvre qu'un
jour. Ce n'est ni un niveau ni un flux — il n'existe pas d'agrégation juste côté base.

La portée reste affichée **par élève, sur la page de l'élève**, où la fenêtre est celle
que Meta a elle-même dédupliquée. Elle n'entre pas dans le sélecteur de métrique de
Stats Clients.

### D58 — `mrr` n'est jamais écrite

0 ligne renseignée sur 265. À ne pas lire, et à ne pas confondre avec un portefeuille
sans abonnement.

### Ce que la fonction rend, et comment elle a été prouvée

`stats_clients_series(profile_ids, debut, fin, granularite)` — `security invoker`,
`stable`, `search_path` épinglé, exécutable par `authenticated`.

| Sortie | Nature | Agrégation |
|---|---|---|
| `ig_followers`, `yt_subscribers` | niveau | dernière valeur **non nulle** de la fenêtre |
| `ig_views`, `ig_profile_views`, `clics` | flux | somme |
| `publications` | flux | `count(distinct post_id)` sur `published_at` |

⚠️ Le filtre « non nulle » compte autant que l'ordre : `yt_subscribers` peut être nul les
derniers jours avant le passage du cron, et prendre bêtement la plus récente rendrait
`null` pour un élève qui a des abonnés.

⚠️ `count(distinct post_id)` est obligatoire : `analytics_ig_posts_history` porte une
ligne par post **et par jour de relevé**. Sans `distinct`, chaque publication serait
comptée autant de fois qu'elle a été photographiée.

**Preuve** : comparaison de la fonction à un agrégat écrit à la main sur les lignes
brutes — 10 fenêtres hebdomadaires, dont deux partielles aux extrémités (5 jours et
2 jours), **10 « ok », zéro écart**, sur les abonnés comme sur les vues. Publications
vérifiées séparément par le même procédé.
