# Handoff — Audit de « Vue générale », puis repasse sur Instagram et YouTube

Écrit le **2026-08-31**, après la clôture de Funnel & Calls.

> ## État au 2026-09-01
>
> **Mission 1 — « Vue générale » : CLOSE.** Onze défauts trouvés, tous corrigés,
> **vérifiés en production**. Le détail et sa méthode sont en §8, qui ne porte plus
> des pistes mais des résultats mesurés. Trois points restent ouverts, listés en
> §8bis — deux risques structurels non déclenchés et une décision de cohérence.
>
> **Mission 2 — repasse Instagram et YouTube : en cours**, dans une session dédiée.
> Elle a déjà corrigé deux défauts que l'audit de Vue générale lui a signalés (voir
> §8, défauts 2 et 3). Les §6 et §7 restent son cahier des charges.
>
> Les §1 à §4, §5, §7, §9 et §10 gardent toute leur valeur : méthode, pièges,
> outillage. Ce sont eux qu'il faut lire avant de toucher à un chiffre affiché.

Deux missions distinctes, dans cet ordre :

1. **Auditer « Vue générale »** — jamais audité, c'est le premier écran que voit un
   élève.
2. **Repasser sur Instagram et YouTube** — clos respectivement fin août et le
   2026-08-21, mais beaucoup a bougé depuis (section 6).

---

## 1. La méthode

**Charger le skill `audit-metrique-bout-en-bout` avant de commencer.** Il porte la
méthode et les **sept** pièges récurrents.

**Une métrique à la fois**, en remontant **API → base → écran**, recoupée avec une
réponse d'API réelle et une capture d'écran. Jamais de conclusion tirée de la lecture
du code seule.

> **Vérifier en base ou contre l'API avant d'affirmer. Un « ça devrait marcher »
> n'est pas un résultat.**

Quatre règles nées des chantiers récents, toutes applicables ici :

- **Apparier sur le jeu le plus large, filtrer ensuite.** Un rapprochement calculé sur
  la seule fenêtre affichée rate les paires qu'elle coupe.
- **Une garde ne vaut que par la portée de sa donnée d'entrée.** Une borne calculée
  depuis la fenêtre courante se désarme hors fenêtre, et un ensemble vide se lit alors
  « rien à signaler » au lieu de « je ne sais rien ». C'est ce qui a produit un taux à
  250 %, invisible sur le mois en cours.
- **Recalculer chaque taux depuis l'écran** (7ᵉ piège, voir §4).
- **Le grand chiffre ne bouge jamais ; seul le taux se calcule sur la population
  comparable.** Renommer un étage pour résoudre un problème de taux a été essayé puis
  annulé.

---

## 2. Périmètre

### Mission 1 — Vue générale

| Surface | Emplacement | Taille |
|---|---|---|
| **Onglet Vue générale** (onglet 0) | `PageClientStats.tsx`, `TabOverviewV2` ~ligne 839 | ~572 lignes |

Ce qu'il affiche : abonnés IG et YT · Calls bookés · Calls honorés · No-show ·
Closing · Rev/call · Revenue · deux courbes (Reach Instagram, Vues YouTube).

### Mission 2 — Repasse Instagram et YouTube

| Surface | Emplacement | Taille |
|---|---|---|
| **Onglet Instagram** (onglet 1) | `TabInstagram` ~ligne 1411 | ~840 lignes |
| **Onglet YouTube** (onglet 2) | `TabYouTube` ~ligne 2592 | ~1334 lignes |

Une **repasse**, pas un audit complet : vérifier que ce qui était juste l'est encore,
en ciblant ce qui a changé (§6).

### Hors périmètre

- Funnel & Calls (onglet 3) — **clos sans réserve** le 2026-08-31. Lire quand même
  la §5 : le piège qu'il a laissé vaut pour tout l'audit.
- Business micro (onglet 4) et Revenus (onglet 5) — chantiers distincts, ce dernier a
  son propre `docs/handoff-audit-revenus.md`.
- La page Paiements, le webhook Stripe, les crons — sauf si l'audit établit qu'une
  valeur affichée n'est jamais collectée.

⚠️ **`PageClientStats.tsx` fait 10 047 lignes et plusieurs sessions y travaillent en
parallèle.** Vérifier la branche avant chaque commit, et s'attendre à ce que le
fichier bouge sous les doigts. Un edit peut être absorbé dans le commit d'un autre
chantier.

---

## 3. À lire avant de toucher

- **`docs/perimetre-stats-referentiel.md`** — les **six** règles de périmètre. La 6ᵉ
  (l'opportunité) est récente et commande quatre chiffres de Funnel & Calls.
- **`docs/click-id.md`** — l'attribution d'un rendez-vous venu d'un lien **partagé**
  (bio, description, story). Récent, et il touche directement les deux onglets de la
  mission 2.
- **`docs/calls-coach-id-piege.md`** — `calls.coach_id` n'est pas le coach humain.
- **`AGENTS.md`**, section « Les crons vivent à DEUX endroits » et la garantie de
  `degrossir_historiques_analytics()` — voir §6, c'est le point le plus sensible.

### Les deux filtres obligatoires sur `calls`

`ignored is not true` **et** `call_type` (`'calendly'` et `'manual'` = vente,
`'google'` = coaching).

⚠️ En PostgREST, `.neq('ignored', true)` produit `ignored <> true`, qui vaut NULL —
donc faux — quand la colonne est NULL. Ce n'est **pas** `ignored is not true`.

### L'attribution

`calls.source` dit **d'où** arrive un rendez-vous ; `ig_lead_id` dit **chez qui** il
est rangé. Toute attribution se lit sur `source`.

---

## 4. La procédure

Pour chaque valeur affichée :

1. **Capture d'écran d'abord**, lue ligne à ligne, avant toute lecture de code.
2. **Quelle requête la produit**, et sa fenêtre exacte — lue dans le code, jamais
   déduite du nom de la variable.
3. **Dans quelle colonne elle atterrit**, et son taux de remplissage réel.
4. **Recouper** avec une requête SQL et une réponse d'API réelle.
5. **Balayer toutes les périodes** — voir §7.

### Le contrôle le plus rentable : RECALCULER chaque taux depuis l'écran

Pour chaque pourcentage, essayer de le retrouver **avec les seuls nombres visibles à
côté**. S'il ne tombe pas juste, le dénominateur réel doit être **nommé à l'écran**.

Cette classe de défaut a été **manquée** par l'audit de Funnel & Calls, qui avait
pourtant validé que tous les chiffres étaient justes — elle a été trouvée par une
relecture. Deux cas y sont passés : un « 57 % closing » à côté d'un « 15 honorés »
(le vrai dénominateur valait 14), et un étage qui retirait **deux** populations de son
numérateur en n'en nommant qu'une.

⚠️ **Les exclusions s'empilent.** Vérifier qu'on les a toutes trouvées, pas seulement
la première.

**Sur Vue générale, le candidat évident était « Closing ».** Vérifié le 2026-08-31 :
son dénominateur EST bien le « Calls honorés » de la carte voisine, et la division
tombe juste (5/8 = 63 %). Le contrôle a néanmoins payé deux fois — il a fait remarquer
que le seuil de couleur n'était calibré sur rien (défaut 8), et que le numérateur et le
dénominateur ne portaient pas sur la même population dès qu'une paire de rendez-vous
était à cheval sur deux périodes (défaut 10).

### Et l'invariant que la lecture d'écran ne donne pas

**La somme des points d'une courbe doit égaler le total de la carte qu'elle détaille.**
Il lie deux chemins de calcul distincts ; s'ils divergent, l'un des deux ment. Sur
Funnel & Calls, il se démontrait en SQL : aucun call hors de la boucle de jours, aucun
dans un jour futur, aucun sans date.

---

## 5. Le cash affiché vient des deals — le piège qui a coûté une demi-journée

**Tout composant qui semble sommer `calls.revenue` somme en réalité des montants de
deals.** `callsEff` (~ligne 9892) réécrit `c.revenue` avec le montant du deal
rattaché, avant que le moindre onglet ne le lise :

```ts
byCall.set(d.call_id, … Number(d.amount_total || 0));
return callsRaw.map(c => byCall.has(c.id) ? { ...c, revenue: byCall.get(c.id)! } : c);
```

Introduit le 2026-08-20 (`cf3743e`, « PageClientStats lit le cash depuis deals »),
étendu à l'historique complet le 2026-08-28 (`e3a8bf1`). `callsAllTimeEff` fait de
même.

**Conséquence pour cet audit** : Vue générale reçoit `callsEff`, donc son `totalRev`
et celui de l'entonnoir portent la même valeur. Il n'y a **pas** de divergence à
chercher entre les deux onglets — c'était une fausse piste, écartée le 2026-08-31.

⚠️ **La leçon vaut pour tout l'audit.** Chercher `amount_total` ne trouve pas cette
ligne : la valeur y vient d'une `Map`, et le mot est trente lignes plus haut. **Partir
du chiffre AFFICHÉ et remonter la chaîne, jamais du nom de la variable et de ses
occurrences.** C'est le piège « chercher le remède au lieu du symptôme », appliqué à
soi-même.

En base, `calls.revenue` et `deals.amount_total` peuvent légitimement diverger — le
montant d'un deal s'édite depuis la page Paiements, et `calls.revenue` reste la trace
de ce qui avait été déclaré dans le rapport. La vue `ventes_sante_montants` ne signale
que les écarts qu'aucune édition n'explique.

## 6. Ce qui a changé depuis la clôture d'Instagram et de YouTube

C'est ce qui justifie la repasse. Aucun de ces points n'est un défaut connu — ce sont
des **changements à revérifier**.

### La rétention des historiques par contenu — le point le plus sensible

`degrossir_historiques_analytics()` (cron `pg_cron`, 4h05) **supprime des lignes** de
`analytics_ig_posts_history` et `analytics_yt_videos_history` : elle ne garde que le
dernier instantané de chaque semaine et de chaque mois.

La garantie de non-perte repose sur trois choses — et **uniquement** sur elles :

- les lecteurs font tous `distinct on (contenu) … snapshot_date desc` sur une fenêtre ;
- `lib/period.ts` garantit des fenêtres **calendaires** (semaines ou mois) ;
- `get_ig_posts_history` et `get_yt_videos_history` respectent ce motif.

**Un lecteur qui agrégerait jour par jour, ou une fenêtre glissante au lieu de
calendaire, invaliderait la règle — et la perte serait silencieuse.** À vérifier en
premier sur les deux onglets : chaque requête d'historique par contenu suit-elle
encore le motif ?

`shortio_link_daily_snapshots` est volontairement exclue de cette rétention.

### Les autres changements

- **`docs/click-id.md`** et la route `/r/` : l'attribution des liens partagés (bio,
  description, story). Les UTM reportés sur la destination ne sont pas décoratifs —
  sans eux, les clics de bio disparaissent des stats et ceux de description sont
  comptés en « Cold DM ».
- **Six purges `pg_cron`** ajoutées (`sw_logs`, `webhook_debug_log`,
  `cron_invocation_logs`, `link_clicks` à 400 j, `cron.job_run_details`, `cron_runs` à
  30 j). Vérifier qu'aucune ne coupe une fenêtre qu'un écran peut afficher.
- **`cron_runs` n'avait aucune purge** jusqu'au 2026-08-31, alors que la doc affirmait
  à cinq endroits qu'elle se purgeait seule. Invisible parce que la table ne journalise
  que les échecs. **Signal : une « parade » documentée peut ne plus protéger de rien —
  la tester avant de bâtir dessus.**
- **`sync-stripe-payments`** est passé sur cron-job.org (30 min). Ne pas le recréer.
- **Des tests Deno existent** pour les fonctions pures des Edge Functions, que
  `npm test` ne voit pas : `npx deno test supabase/functions/_shared/ig-posts.test.ts`.

---

## 7. Le balayage des périodes — obligatoire

Trois modes (`7j`, `30j`, `All-Time`) et une navigation `‹ ›`. **Les défauts de ces
écrans ne se voient ni sur la période courante, ni sur les périodes récentes.**

⚠️ **Depuis le 2026-09-01, la flèche « ‹ » s'arrête à la période qui contient
`integrations_ready_at`** — elle partait avant de `connectedAt`, ce qui donnait accès
à des mois entièrement antérieurs à la mise en route (voir §8, défaut 5). Le balayage
va donc moins loin qu'avant, et c'est voulu : au-delà, il n'y a rien à mesurer.

Balayer tout ce qui reste atteignable (dont un mois **antérieur au début de la collecte
Short.io, le 19/07**), les semaines, et l'All-Time. Pour chaque état : aucun `NaN`,
`Infinity`, `undefined`, `Invalid Date`, `[object Object]`, aucun taux impossible.

⚠️ **All-Time passe par `sinceConnection`, pas par `periodIndex`.** Les périodes
passées passent par `fetchSnapshot`, la période courante par le chemin live : **trois
chemins de données distincts**. Un correctif appliqué à l'un ne touche pas les autres —
c'est exactement ce qui a laissé passer le 250 %.

---

## 8. Ce que l'audit a trouvé — onze défauts, tous corrigés

Audit mené le 2026-08-31, corrections livrées et **vérifiées en production le
2026-09-01** (commits `d72ebfd`, `44023e1`, `8ed663f`, `785e535`).

Les pistes que ce document portait avant l'audit sont signalées : plusieurs étaient
justes, **une était fausse**, et c'est utile à savoir.

| # | Défaut | Comment il a été trouvé |
|---|---|---|
| 1 | **All-Time traçait un seul mois.** Carte « Reach Instagram 503 · total » au-dessus d'une courbe totalisant 146. Depuis le mode 7 jours, c'est la CARTE qui devenait fausse : « 4 personnes · total », les chiffres d'une semaine. | l'invariant courbe/carte (§4) |
| 2 | **Les jours non collectés étaient tracés à zéro** sur toute période passée. `igHist`/`ytHist.chartData` écrivaient `?? 0` sans porter le drapeau `pending`, que seule la route API produisait. *(piste confirmée)* | 25 jours sans mesure YouTube en mai |
| 3 | **Fausse alerte permanente** « Taux de réponse DM bas : 0 % — 0 conversations sans réponse » sur toute période passée. `ig_response_rate` est écrite **littéralement `null`** par les trois chemins de collecte : colonne morte, lue en `?? 0`, branchée sur un seuil d'alerte. | inventaire des colonnes (phase 2) |
| 4 | **« Abonnés YT : 0 » en mai**, alors que la colonne est NULL sur les 25 jours du mois. Deux `?? 0` empilés. *(piste confirmée)* | balayage des périodes |
| 5 | **La navigation arrière menait à un mois antérieur au démarrage.** Bornée par `connectedAt` (29/05) au lieu de `integrations_ready_at` (09/06), et comptée en périodes **glissantes** alors que les périodes affichées sont **calendaires**. C'est la cause racine du défaut 6. | une question de Chris, pas le code |
| 6 | **Le bandeau de couverture annonçait « les 39 premiers jours » d'un mois de 31 jours**, et affirmait « aucune donnée » alors que l'écran affichait 106 de reach — le backfill Instagram remonte avant la mise en route. | lecture d'écran (phase 1) |
| 7 | **Un mois sans aucun call était peint en couleur** : no-show « 0 % » en VERT, closing « 0 % » en ROUGE. Un mois vide se lisait comme une contre-performance. | balayage des périodes |
| 8 | **Le seuil de couleur du closing** (25 % / 15 %) n'était calibré sur rien de traçable, et un signal annonçait un « seuil cible de 25 % ». Couleur et signal retirés. *(piste confirmée, arbitrée par Chris)* | lecture de code + arbitrage |
| 9 | **Le signal no-show disait « % des calls bookés »** alors que le taux porte sur les RENDEZ-VOUS — l'inverse de ce que son propre texte d'aide explique. | recalcul depuis l'écran |
| 10 | **Un deal signé au 2ᵉ rendez-vous comptait dans une période sans dénominateur.** Le closing pouvait dépasser 100 %. Fermé par `representantDOpportunite` : le deal reste attaché à son rendez-vous, c'est la PÉRIODE de comptage qui suit l'opportunité (règle de cohorte, référentiel règle 2). | raisonnement sur les grains, confirmé sur une paire réelle en base |
| 11 | **« 0 personnes » là où rien n'est mesuré.** Le 1ᵉʳ de chaque mois, la ligne du jour existe en base avec `ig_reach` à NULL : la courbe disait « Pas encore de données », le grand chiffre annonçait « 0 ». | **la vérification en production**, le 2026-09-01 |

### La piste qui était FAUSSE

Ce document a longtemps annoncé une divergence de revenu entre Vue générale et
l'entonnoir (6 500 € contre 4 700 €), présentée comme « la première chose à établir ».
**Il n'y en a aucune.** `callsEff` réécrit `c.revenue` avec le montant du deal avant
que le moindre onglet ne le lise — voir §5, qui porte la bonne version. Mesuré à
l'écran : août affiche 5 700 €, soit 4 700 € (Instagram) + 1 000 € (YouTube).

**La leçon** : une réserve héritée d'un document n'est pas un fait. Celle-ci disait
« aucun endroit ne remplace `calls.revenue` — mais la recherche n'a pas été
exhaustive », et elle avait cherché par le NOM du champ. La substitution se fait en
amont, dans le producteur de la liste : le nom reste intact partout en aval. Quand une
recherche par nom ne trouve rien, la question n'est pas « où est-ce écrit » mais « qui
construit l'objet que je lis ».

### Ce que le recalcul depuis l'écran a donné

Le 7ᵉ piège ne mordait pas ici : **tous les taux se retrouvent avec les seuls nombres
affichés à côté**, sur les onze états balayés. Août 5/8 = 63 %, 1/10 = 10 %,
5700/9 = 633 € ; juin 2/7 = 29 %, 2/5 = 40 %, 4000/7 = 571 € ; All-Time 3/18 = 17 %,
8/14 = 57 %, 10200/17 = 600 €. Le dénominateur du closing **est** la carte voisine, et
celui du no-show est écrit sous le chiffre.

### Les deux invariants qui ont fait le travail

1. **La somme des points d'une courbe égale le total de sa carte.** Seul contrôle
   capable de voir le défaut 1 : la carte était juste, la courbe était juste, seule
   leur mise en regard était fausse. Aucun recalcul d'écran, aucune requête SQL ne
   pouvait le signaler.
2. **Rejouer ce contrôle sur TOUS les comptes, pas sur celui de l'enquête.** Le premier
   correctif du défaut 1 bornait la fenêtre à l'HEURE de démarrage alors que les points
   de courbe sont posés à midi. Mesure sur les quatre élèves ayant une date de
   démarrage — 08h13, 17h36, 12h56, 19h05 UTC : **trois sur quatre perdaient leur
   premier jour**. Le correctif ne tenait que parce que le profil de test démarre le
   matin. Corollaire : une garde bornée par un INSTANT et une donnée agrégée par JOUR
   ne se comparent pas ; c'est la résolution la plus fine qui doit céder.

### Une leçon de méthode, à ne pas perdre

Le défaut 5 a été trouvé par une question de Chris — « si la période n'a aucune donnée,
normalement tu ne peux pas y accéder ? » — après que l'audit eut proposé trois façons
de **réécrire la phrase** du bandeau. Aucune ne touchait à la raison pour laquelle cet
écran existait.

**Avant de corriger ce qu'un écran DIT, se demander si l'état qu'il décrit devrait
pouvoir exister.** Un affichage absurde est souvent le symptôme d'un état que rien
n'aurait dû produire. Un texte bien rédigé rend cet état présentable et enlève l'envie
de chercher pourquoi on y est arrivé.

---

## 8bis. Ce qui reste ouvert sur Vue générale

**Deux risques structurels, aucun déclenché — mesurés à zéro cas le 2026-09-01.**

- **« Leads » compterait un prospect écarté du pipeline.** `instagram_lead_lm_history`
  n'est filtrée que sur `archived_at`, pas sur `not_a_lead`, contrairement à
  `instagram_leads` juste à côté dans la même requête. Zéro cas aujourd'hui : les deux
  prospects marqués « pas un lead » viennent de cold DM et n'ont aucune ligne
  `lm_history`. Le jour où un prospect issu d'un **commentaire** est écarté, il restera
  compté dans le grand chiffre — et pas dans le badge « nouveaux », qui lit l'autre
  table.
  ⚠️ Ce zéro a été vérifié par un témoin positif : la même jointure sans le filtre
  d'exclusion remonte 24 lignes. L'instrument voit donc quelque chose quand il y a
  quelque chose à voir.
- **« Calls honorés » peut devenir négatif dans le tableau Top contenus.**
  `callsBooked − noShowCount`, où `noShowCount` compte les continuations et les annulés
  que `callsBooked` exclut.

**Une décision de cohérence, à appliquer avec la session Instagram/YouTube.**

La carte « Abonnés » n'affiche pas la même chose selon l'onglet, sur un mois passé :
Vue générale montre **255** (le compte du jour), l'onglet Instagram **253**
(« au 30 juin »). Chris a tranché le 2026-09-01 : **le compte du jour partout, avec le
libellé qui le dit.** Un nombre d'abonnés est un état, pas une activité — même règle
que « publications » (activité, suit la période) contre « abonnés » (état). Reste à
aligner l'onglet Instagram.

**Hors périmètre mais noté** : `totalRev` est découpé sur `booked_at` alors que le
référentiel prévoit `deals.signed_at` pour le cash contracté. Divergence connue, déjà
inscrite dans « Ce qui reste ouvert » du référentiel — pas touchée ici.

---

## 9. Outils, comptes, pièges d'outillage

**Comptes de test** : élève `christianpenkov80@gmail.com` / `Momentum123`, coach
`christianpenkov06@gmail.com` / même mot de passe. ⚠️ Ce document a porté
`Fortnite2605` jusqu'au 2026-09-01, mot de passe changé le 2026-08-30 — une session
a perdu deux essais de connexion dessus. Le vérifier avant de conclure à une panne. Profil avec données réelles :
`a02e5927-7b39-4b7d-b112-0a43b30e9f09`.

**Serveur de dev** : `npx next dev -p 3007`. Il tombe régulièrement — le relancer
plutôt que de conclure à une panne applicative.

**Santé de la plateforme** :

```sql
select * from cron_runs order by ran_at desc;   -- vide = aucun incident
select * from integrations_sante;               -- 'ok' ou 'non_connectee'
select * from yt_sante_donnees;
select * from ventes_sante_montants;            -- vide = rapport et deal concordent
```

⚠️ `etat <> 'ok'` n'est **pas** un filtre d'anomalie : `non_connectee` dit seulement
que l'intégration n'est pas branchée. Les chercher comme des pannes remonte 23 faux
positifs.

### Trois pièges d'outillage sous Windows

- **Le serveur `browse` s'arrête entre deux commandes** et repart avec un profil
  vierge : la session de connexion est perdue. Faire tenir connexion, navigation et
  relevé dans **un seul appel**. Sélectionner les boutons **par leur texte**, jamais
  par leur index — les index bougent au changement d'onglet.
- **`$B text` retourne tout le DOM**, y compris ce qu'un overlay masque. Pour juger du
  visible, compter les éléments ou capturer.
- **Les fichiers en CRLF** : une réécriture en LF produit un diff de milliers de lignes
  pour deux changements. Préserver la fin de ligne d'origine.

### Vérifier une Edge Function

`tsc` et `npm run build` ne couvrent **pas** `supabase/functions/`. Avant tout
déploiement : `npx deno check`. Une Edge Function ne part pas avec `git push`, et la
seule preuve qu'elle tourne le bon code est **le contenu de son bundle** — jamais
`updated_at`, qui ment.

---

## 10. Comment livrer

- **Un commit par correction**, avec le *pourquoi* : ce qui était faux, ce que ça
  produisait à l'écran, pourquoi cette solution-là.
- **Vérifier la branche avant chaque commit** — plusieurs sessions travaillent sur ce
  fichier.
- Réponses en français, explications non techniques.
- **Aucune donnée inventée, simulée ou codée en dur.** Un `0` affirme quelque chose, un
  trou dit « on ne sait pas ».
- Chaque affirmation adossée à une mesure. Si une cause n'est pas établie, le dire.
- Distinguer explicitement ce qui est corrigé de ce qui attend un arbitrage.
