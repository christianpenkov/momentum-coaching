# Handoff — Réparation et audit de l'onglet « Revenus »

Dernier périmètre de « Mes Stats ». YouTube, Instagram, Business micro et
Funnel & Calls sont clos. Brief écrit le **2026-08-30**, à la fin du chantier
Funnel & Calls.

**Ce document ne contient aucune conclusion d'audit.** Il contient le périmètre, la
méthode, la procédure de vérification et des pistes à vérifier. Les pistes de la
section 6 ont été repérées **en lisant le code**, ce que la méthode interdit
explicitement de considérer comme un résultat. Chacune doit être confirmée ou
infirmée en base, contre l'API Stripe ou à l'écran avant d'être tenue pour vraie —
et il faut s'attendre à ce que certaines soient fausses.

---

## 1. La méthode — elle a tout trouvé, la respecter

**Charger le skill `audit-metrique-bout-en-bout` (`~/.claude/skills/`) avant de
commencer.** Il contient la méthode complète et les sept pièges récurrents.

**Une métrique à la fois**, en remontant la chaîne **API → base → écran**, recoupée
avec **une réponse d'API réelle** et **une capture d'écran**. Jamais de conclusion
tirée de la lecture du code ou de la documentation seules.

> **La règle qui compte le plus : vérifier en base ou contre l'API avant d'affirmer.
> Un « ça devrait marcher » n'est pas un résultat.**

Deux règles ajoutées par les chantiers récents, qui valent particulièrement ici :

- **Apparier sur le jeu le plus large, filtrer ensuite.** Un rapprochement calculé
  sur la seule fenêtre affichée rate les paires qu'elle coupe. Sur cet onglet, un
  paiement de septembre peut solder un deal signé en juin.
- **Une garde ne vaut que par la portée de sa donnée d'entrée.** Une borne calculée
  depuis la fenêtre courante se désarme hors fenêtre, et un ensemble vide se lit
  alors « rien à signaler » au lieu de « je ne sais rien ». C'est exactement ce qui
  a produit un taux à 250 % sur l'onglet Funnel, invisible sur le mois en cours.

### Les sept pièges

1. La règle écrite à plusieurs endroits, qui a divergé.
2. Une donnée présente n'est pas une donnée fiable (croiser avec un volume de référence).
3. Une donnée affichée n'est pas une donnée collectée.
4. Un zéro qui devrait être un trou.
5. L'échec silencieux (une panne qui ne rend aucun chiffre faux, mais fige leur fraîcheur).
6. Le total qui ne réconcilie pas avec la somme de ses filtres.
7. Deux calendriers pour un même jour.

**Le piège 7 est le plus probable sur ce périmètre.** Stripe horodate en UTC, l'écran
raisonne en jours de Paris, et le code découpe les journées par comparaison de
préfixes de chaînes. *Signature en base* : une même entité qui porte des valeurs sur
deux jours **consécutifs**.

---

## 2. Le périmètre exact

### Ce qui est dans le périmètre

| Surface | Emplacement | Taille |
|---|---|---|
| **Onglet Revenus** (Mes Stats, onglet 5) | `components/analytics/PageClientStats.tsx`, `TabRevenues` ~ligne 4842 | ~207 lignes |
| **Cash par origine** | `CashByOrigin`, même fichier | composant appelé par l'onglet |
| **Alimentation Stripe** | `app/api/stripe/client-data/` | route lue par l'écran |
| **Règle du cash** | `lib/dealCash.ts`, `lib/salesCallStats.ts` | source partagée |
| **Échéanciers** | `deal_installments`, `supabase/functions/installment-reminders` | uniquement pour recouper les montants |

### Ce qui n'est PAS dans le périmètre

- La page **Paiements** (`/paiements`) et la création de liens de paiement — c'est un
  chantier distinct, déjà documenté dans `docs/handoff-clics-liens-paiement.md`.
- Le **webhook Stripe** et la configuration du dashboard — voir
  `docs/stripe-paiements.md`, à lire mais pas à modifier ici.
- Les crons, sauf si l'audit établit qu'une valeur affichée n'est jamais collectée.

### Ce que l'onglet affiche, à auditer une métrique à la fois

Quatre cartes, un graphique, un bloc et un tableau :

1. **Cash contracté** — somme des `deals.amount_total`, découpés sur `signed_at`,
   annulés exclus. Sous-titre : « deals closés (N) ».
2. **Cash collecté** — somme des paiements Stripe `succeeded` de la période.
3. **Panier moyen** — `cashContracte / dealsClosed.length`.
4. **Taux de cash collecté** — `cashCollecte / cashContracte`.
5. **Graphique « Revenus / jour »** — deux séries, contracté et collecté.
6. **Cash par origine** — `CashByOrigin`.
7. **Tableau « Derniers paiements »**.

---

## 3. À lire impérativement avant de toucher au cash

- **`docs/stripe-paiements.md`** — obligatoire. La configuration vit dans le
  dashboard, hors du dépôt : une case cochée par erreur fait passer un chiffre en
  négatif sans qu'aucun test ne s'en aperçoive.
- **`docs/perimetre-stats-referentiel.md`** — les règles de fenêtre et de date.
- **`docs/calls-coach-id-piege.md`** — `calls.coach_id` n'est pas le coach humain.

### La règle du cash

**`deals` est la source du cash.** Depuis le 2026-08-20, tous les écrans lisent
`deals` ; `calls.revenue` n'est plus qu'une trace du rapport et une requête de
contrôle des deals manquants. Un deal peut exister **sans call** (upsell, vente hors
pipeline) et un call closé peut n'avoir **aucun deal**.

### Les deux filtres obligatoires sur `calls`

Toute requête sur `calls` — audit compris, pas seulement les backfills — doit filtrer
`ignored is not true` et préciser `call_type` (`'calendly'` et `'manual'` = vente,
`'google'` = coaching). Sans ça les chiffres sont faux.

⚠️ En PostgREST, `.neq('ignored', true)` produit `ignored <> true`, qui vaut NULL —
donc faux — quand la colonne est NULL. Ce n'est **pas** `ignored is not true`.

### L'attribution

`calls.source` dit **d'où** arrive un rendez-vous ; `ig_lead_id` dit **chez qui** il
est rangé. Toute attribution se lit sur `source`. Depuis la fusion de fiches, les deux
divergent.

---

## 4. La procédure, métrique par métrique

Pour chacune des sept surfaces de la section 2 :

1. **Capture d'écran d'abord**, lue ligne à ligne — avant toute lecture de code.
   Chercher : valeurs au signe inattendu, libellés incohérents entre cartes voisines,
   textes non traduits, blocs qui changent de taille selon leur état.
2. **Quelle requête produit la valeur**, et sa fenêtre exacte — lue dans le code, pas
   déduite du nom de la variable.
3. **Dans quelle colonne elle atterrit**, et son taux de remplissage réel.
4. **Recouper** avec une requête SQL sur les données réelles **et** une réponse
   d'API Stripe réelle.
5. **Balayer toutes les périodes** — voir section 5, c'est là que se cachent les
   défauts de cet écran.

### Le contrôle le plus rentable : RECALCULER chaque taux depuis l'écran

Pour chaque pourcentage affiché, essayer de le retrouver **avec les seuls nombres
visibles à côté de lui**. S'il ne tombe pas juste, le dénominateur réel est autre
chose que ce que le lecteur croit — et il doit être **nommé à l'écran**.

Cette classe de défaut a été manquée par l'audit de Funnel & Calls, qui avait
pourtant vérifié que tous les chiffres étaient JUSTES. Deux cas y sont passés :

- « 15 Calls honorés » à côté de « 57 % closing » : la division donne 53 %, parce
  que le vrai dénominateur est 14 (les opportunités). Le chiffre était exact et
  impossible à reconstituer.
- L'étage « Calls bookés » retirait de son numérateur **deux** populations — hors
  fenêtre de collecte ET continuations — et sa note n'en nommait qu'une.

Sur l'onglet Revenus, le candidat évident est le **taux de cash collecté** :
`cashCollecte / cashContracte` rapporte des paiements de la période à des deals
signés dans la période — deux populations différentes, qui ne se recalculent pas
l'une depuis l'autre.

### Et une vérification que la lecture d'écran ne donne pas

**La somme des barres du graphique doit égaler le total de la carte correspondante.**
C'est l'invariant le moins cher et le plus révélateur de cet onglet : il lie deux
chemins de calcul distincts. S'ils divergent, l'un des deux ment.

Même principe pour `CashByOrigin` : la somme des origines doit valoir le cash
contracté de la période.

---

## 5. Le balayage des périodes — obligatoire, et non négociable

L'onglet a **trois modes** (`7j`, `30j`, `All-Time`) et une navigation `‹ ›` vers les
périodes passées. Le dernier chantier a montré que les défauts de cet écran ne se
voient **ni sur la période courante, ni sur les périodes récentes**.

Balayer au minimum :

- 4 mois en arrière (dont un **antérieur au début de la collecte Stripe**),
- 4 semaines en arrière,
- **All-Time**.

Pour chaque état, contrôler : aucun `NaN`, aucun `Infinity`, aucun `undefined`,
aucune `Invalid Date`, aucun `[object Object]`, aucun taux impossible, et l'invariant
« somme des barres = total ».

⚠️ **Le mode All-Time passe par `sinceConnection`, pas par `periodIndex`.** Les deux
chemins de données sont différents (`fetchSnapshot` pour les périodes passées, le
chemin live pour la période courante). Vérifier les deux séparément : un correctif
appliqué à l'un ne touche pas l'autre.

---

## 6. Pistes à vérifier — aucune n'est un résultat

Repérées **en lisant le code** le 2026-08-30. Aucune n'a été vérifiée. Certaines
seront fausses.

### Le graphique pourrait ne pas couvrir la même fenêtre que ses cartes

En mode All-Time, les cartes lisent tout (`sinceConnection` court-circuite le filtre
de période), mais `revenueByDay` boucle de `periodStart` à `periodEnd`, tous deux
issus de `getPeriodWindow(periodIndex, …)` — soit le mois ou la semaine **en cours**.
Si c'est confirmé, la somme des barres ne peut pas valoir le total affiché en
All-Time. `CashByOrigin` reçoit les mêmes bornes et pourrait avoir le même écart.

*À vérifier : l'invariant de la section 4, en All-Time.*

### Le tableau « Derniers paiements » semble ignorer la période

Il itère sur `stripe.recentPayments` — la liste brute — alors que les cartes utilisent
`allInPeriod`, la même liste filtrée. Un tableau qui affiche des paiements hors de la
fenêtre sélectionnée est exactement le défaut corrigé sur trois autres onglets.

### Les journées pourraient être découpées en UTC sous un libellé de Paris

`revenueByDay` compare `p.date.startsWith(iso)` et `d.signed_at.startsWith(iso)`, où
`iso` est un **jour de Paris** (`parisDateStr`) et où `p.date` / `signed_at` sont
vraisemblablement des instants **UTC**. Si c'est le cas, un paiement du 31 à 01h00
Paris tombe dans la barre du 30. C'est le piège 7.

*Signature à chercher en base : des paiements entre 22h00 et 00h00 UTC.*

### Le panier moyen mélange peut-être deux sources et deux dates

`avgBasket = cashContracte / dealsClosed.length` : le numérateur vient des **deals**
découpés sur `signed_at`, le dénominateur des **calls** découpés sur `booked_at`. Un
deal sans call gonflerait le numérateur seul ; un call closé sans deal gonflerait le
dénominateur seul. Le sous-titre de la carte « Cash contracté » annonce d'ailleurs
« deals closés (N) » alors que N compte des **calls**.

*Point de départ mesuré le 2026-08-30 sur le profil de test `a02e5927` : 8 deals pour
**10 200 €**, contre 8 calls closés portant **12 000 €** de `calls.revenue`. L'écart
de 1 800 € est un fait ; sa cause ne l'est pas — à établir.*

### Le taux de cash collecté pourrait dépasser 100 %

`cashCollecte / cashContracte` rapporte des paiements de la période à des deals signés
dans la période. Une échéance encaissée ce mois-ci pour un deal signé le mois dernier
compte au numérateur sans compter au dénominateur. Vérifier ce que l'écran affiche
alors, et si le seuil de couleur (`>= 80 %` vert) reste lisible.

### `recentPayments` porte peut-être une limite

Le nom dit « récents ». Si la route `app/api/stripe/client-data/` demande à Stripe une
liste bornée (`limit`), toute période au-delà de cette profondeur sous-compte le cash
collecté **en silence** — et le taux de collecte avec. C'est le piège 3 : une donnée
affichée n'est pas une donnée collectée.

*À vérifier : le `limit` réel de l'appel, et le comportement au-delà.*

### Les remboursements et litiges sont-ils traités ?

`succeeded` filtre `status === 'succeeded'`. Un paiement remboursé ou contesté
reste-t-il `succeeded` dans cette liste ? `lib/dealCash.ts` connaît des statuts
`ended` / `disputed` — vérifier que les deux chemins disent la même chose, sinon
c'est le piège 1.

### Un intervalle d'axe possiblement négatif

`xInterval={period === 7 ? 0 : Math.floor(revenueByDay.length / 7) - 1}` vaut **−1**
dès que la série compte moins de 7 points — début de mois, ou période sans donnée.
Vérifier ce que Recharts en fait.

### Pièges déjà documentés ailleurs, à re-vérifier ici

- **Recharts ignore `domain` sans `ticks`** — la bibliothèque recalcule ses propres
  bornes par-dessus.
- **`|| null` efface un vrai 0**, et `?? 0` invente un 0 quand la donnée manque.
- **`initialDimension`** manquant sur un `ResponsiveContainer` produit
  `width(-1) and height(-1)` dans la console.
- **Les montants `numeric` de Postgres arrivent en chaîne** : sans `Number()`
  explicite, `"10" + "20"` donne `"1020"` et passe le typage.

---

## 7. Outils et comptes

**Comptes de test** (`browse`) :
- Élève : `christianpenkov80@gmail.com` / `Momentum123`
- Coach : `christianpenkov06@gmail.com` / `Momentum123`
- Profil avec données réelles : `a02e5927-7b39-4b7d-b112-0a43b30e9f09`

⚠️ Le mot de passe change. Il valait `Fortnite2605` jusqu'au 2026-08-30, et un
`invalid_credentials` ne veut donc pas dire que le compte est cassé. Le tester
directement plutôt que de renoncer au navigateur — quelques secondes, et ça évite de
livrer un audit sans sa vérification à l'écran :

```bash
curl -s -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' \
  -d '{"email":"christianpenkov80@gmail.com","password":"..."}'
```

**Serveur de dev** : `npx next dev -p 3007`. Il tombe régulièrement — le relancer
plutôt que de conclure à une panne applicative.

**Santé de la plateforme** :

```sql
select * from cron_runs order by ran_at desc;   -- vide = aucun incident (30j)
select * from integrations_sante;               -- 'ok' ou 'non_connectee'
```

⚠️ Sur les vues de santé, `etat <> 'ok'` n'est **pas** un filtre d'anomalie :
`non_connectee` dit seulement que l'intégration n'est pas branchée.

### Trois pièges d'outillage sous Windows

- **Le serveur `browse` s'arrête entre deux commandes** et repart avec un profil
  vierge : la session de connexion est perdue. Faire tenir connexion, navigation et
  relevé dans **un seul appel**.
- **`$B text` retourne tout le DOM**, y compris ce qu'un overlay masque. Pour juger de
  ce qui est réellement visible, compter les éléments ou prendre une capture.
- **Les fichiers en CRLF** : une réécriture en LF produit un diff de plusieurs milliers
  de lignes pour deux changements. Préserver la fin de ligne d'origine.

### Vérifier une Edge Function

`tsc` et `npm run build` ne couvrent **pas** `supabase/functions/`. Avant tout
déploiement : `npx deno check`. Et une Edge Function ne part pas avec `git push` —
déploiement séparé obligatoire, puis **preuve par le contenu du bundle**
(`get_edge_function`), jamais par `updated_at`, qui ment.

---

## 8. État des autres périmètres

| Périmètre | État |
|---|---|
| YouTube | clos le 2026-08-21 — 23 corrections |
| Instagram | clos — ~30 corrections |
| Business micro | clos le 2026-08-28 |
| Funnel & Calls | clos le 2026-08-30 |
| **Revenus** | **ce document** |

Deux points laissés ouverts par le chantier Funnel & Calls, qui touchent le cash :

- Le taux clics → opportunités peut encore dépasser 100 % pour deux causes qui ne
  sont pas des défauts de collecte : une URL Calendly rouverte depuis l'historique
  réserve sans repasser par Short.io, et un clic de fin de période donne une
  réservation la période suivante.
- Une session parallèle câble l'**attribution par contenu** (rôles Acquisition,
  Activation, Conversion). L'invariant retenu est : *somme des crédits de Conversion =
  nombre d'opportunités*. Se coordonner avant de toucher à `matchesContent`.

---

## 9. Comment livrer

- **Un commit par correction**, avec le *pourquoi* dans le message : ce qui était
  faux, ce que ça produisait à l'écran, et pourquoi cette solution-là.
- **Vérifier la branche avant chaque commit** — une session parallèle peut l'avoir
  fait basculer.
- Réponses en français, explications non techniques.
- **Aucune donnée inventée, simulée ou codée en dur.** Un `0` affirme quelque chose,
  un trou dit « on ne sait pas ».
- Chaque affirmation adossée à une mesure. Si une cause n'est pas établie, le dire
  plutôt que de la présenter comme certaine.
- Distinguer explicitement ce qui est corrigé de ce qui attend un arbitrage.

---

## 10. Clôture de l'audit — 2026-08-30

Périmètre audité métrique par métrique, chaîne API → base → écran, recoupé avec des
requêtes SQL sur les données réelles et des captures d'écran de production et de local.
Balayage complet des périodes : 30j courant, M−1 à M−3, All-Time, 7j S−0 à S−3.

### Ce qui a été trouvé et corrigé

| # | Défaut | Preuve |
|---|--------|--------|
| 1 | **Deux sources pour « Cash collecté ».** Période courante = API Stripe (`charges.list` limité à 50 puis `.slice(0,10)`, sans borne de date) ; périodes passées = `deal_payments`. | Août : 2 360 € en carte contre 2 800 € dans « Cash encaissé par origine » **sur le même écran**. |
| 2 | **La limite à 10 paiements** faisait sous-compter le cash collecté, et le taux de collecte avec, dès qu'un mois portait plus de dix encaissements. | Lecture de la route ; 6 lignes affichées sur 10 possibles au moment du test. |
| 3 | **Le tableau « Derniers paiements » ignorait la période** sur le chemin courant. | Semaine du 24–30 août : carte « paiements reçus (0) », tableau = 6 lignes des 19, 20 et 21 août. |
| 4 | **Le graphique ne couvrait pas la période en All-Time** : il bouclait sur le mois en cours. | Cartes 10 200 €, axe borné au 1er–29 août, somme des barres 5 700 €. Écart 4 500 €. |
| 5 | **Piège 7 — journées découpées en UTC sous un libellé de Paris.** | Le paiement de 300 € (`2026-08-20T22:00:52Z`) était daté « 21 août » dans le tableau et rangé dans la barre du 20 août. |
| 6 | **Sous-titre du graphique faux** : « 30 derniers jours » sur un mois calendaire, et aussi en All-Time. | Capture. |
| 7 | **Colonne « Description » morte** sur le chemin des périodes passées : `buyer_name` n'était pas sélectionné. | « — » sur toutes les lignes en S−1 et All-Time, alors que les mêmes paiements portaient un libellé en S−0. |
| 8 | **Panier moyen à cheval sur deux sources et deux dates** : numérateur = deals sur `signed_at`, dénominateur = calls closés sur `booked_at`. Le sous-titre « deals closés (N) » comptait des calls. | Structurel. Les deux comptes coïncident sur le jeu actuel (8 = 8) : l'écran n'était pas faux, il l'aurait été au premier upsell sans call. |
| 9 | **Taux de collecte à « 0 % » en rouge** sur une période sans aucune vente. | Mai 2026 et semaine en cours. Affiche désormais « — · aucune vente à collecter ». |
| 10 | **`xInterval` négatif** (`Math.floor(n/7) − 1`) les 6 premiers jours de chaque mois → Recharts 3.8.1 renvoie un tableau de graduations VIDE, l'axe des dates disparaît. | Code source de `getEveryNth` (`n < 1` → `[]`). |
| 11 | **Barres rendues à 0,02 px** au-delà de ~60 points : le graphique paraît vide alors que ses valeurs sont justes. Révélé par la correction n°4. | `getBBox()` au navigateur sur les 7 barres de l'All-Time. |
| 12 | **`ResponsiveContainer` sans `initialDimension`** → `width(-1) and height(-1)` en console à chaque changement de période. | Console. Zéro occurrence après correction. |
| 13 | **Statut « Échoué » en rouge** pour tout ce qui n'est pas `succeeded` — un remboursement, un litige ou un paiement en attente. | Lecture ; non atteignable aujourd'hui, voir la question ouverte n°1. |
| 14 | **L'onglet dépendait de `analytics_daily_snapshots`** : un mois sans collecte Instagram/YouTube rendait tout le cash muet. | `stripeHist` était conditionné à `snaps.length > 0`. |
| 15 | **Une panne Stripe se lisait « compte non connecté »**, et emportait les montants des ventes qui vivent en base. | Reproduit : clé absente → 500 non géré (`getStripeAccess` hors du try) → écran « Connecte ton compte Stripe » sur un compte au jeton OAuth valide. |
| 16 | **La route ne passait pas par `appelStripe`** : ses pannes n'ont jamais marqué aucune intégration, contrairement à la règle posée dans `lib/stripe-account.ts`. | Lecture croisée. |
| 17 | **`CashByOrigin` ne bornait rien en All-Time** malgré un commentaire affirmant le contraire — il lisait tout l'historique là où les cartes s'arrêtent à `integrations_ready_at`. | Lecture de son propre `useQuery`. |
| 18 | **Champs morts** `mrr`, `monthlyRevenue`, `activeSubscriptions`, `availableBalance` — alimentés des deux côtés, lus nulle part, et `monthlyRevenue` sommait tous les statuts, remboursements compris. | Recherche d'usage. |

### La correction de fond

Le chemin de la période courante n'appelle plus l'API Stripe. Il lit `deal_payments`,
comme le faisaient déjà les périodes passées. La règle « on ne compte que les paiements
rattachés à une vente » était écrite et datée (19/08/2026) dans le chemin snapshot ;
elle n'avait jamais été portée au chemin live. Effet de bord bienvenu : un appel réseau
externe de moins sur le chemin d'affichage de chaque visite.

### Vérification après correction

- Invariant **somme des barres = total de la carte**, All-Time :
  1 000 + 3 000 + 500 + 2 100 + 3 600 = **10 200 €**, égal à la carte. Collecté : 2 800 €.
- Invariant **somme de « Cash encaissé par origine » = « Cash collecté »** : 2 800 € des
  deux côtés en août (2 360 € contre 2 800 € avant).
- Quatre périodes relues carte par carte : août 5 700 / 2 800 / 1 140 / 49 % ·
  juillet 500 / 0 / 500 / 0 % · juin 4 000 / 0 / 2 000 / 0 % · mai 0 / 0 / 0 / **—**.
- Console de l'onglet : zéro avertissement, zéro erreur.
- `npx tsc --noEmit` propre, `npm test` 222/222.

### Décisions prises le 2026-08-30, et livrées

**Le taux de collecte se lit par cohorte.** Numérateur et dénominateur portent désormais
sur les mêmes deals — ceux signés dans la période — et on somme TOUS leurs paiements
sans les borner sur la fenêtre. Le taux ne peut plus dépasser 100 %, et le sous-titre de
la carte affiche son numérateur pour que la fraction soit vérifiable à l'œil. La carte
« Cash collecté » voisine garde son sens de trésorerie : les deux questions sont
légitimes, elles ne devaient pas être mélangées dans une même division. Contrepartie
assumée : un mois passé voit son taux monter au fil des échéances.

**Un remboursement porte la date du paiement d'origine.** `paid_at` était NULL sur toute
ligne non-`succeeded`, or c'est la colonne qui borne les périodes : les remboursements et
litiges étaient invisibles de toutes les fenêtres, donc jamais déduits. Le webhook les
date maintenant sur la charge d'origine, une migration rattrape l'existant, et les trois
chemins de lecture passent par `calculerCash`. Le mois de la vente finit donc par dire ce
qu'il a réellement rapporté — au prix d'un montant passé qui peut changer.

Vérifié à l'écran après livraison, profil de test, août 2026 :
cash collecté **2 600 €** (2 800 € avant, remboursement de 200 € non déduit) ·
taux **46 %** (« 2 600 € sur les deals signés ») ·
somme de « Cash encaissé par origine » **2 600 €**, égale à la carte ·
tableau des paiements affichant « TestYT − 200 € Remboursé » au 20 août.
All-Time 10 200 / 2 600 / 25 %. Juillet 500 / 0 / 0 %. Juin 4 000 / 0 / 0 %.

### Le tableau du bas liste les VENTES, plus les paiements

« Derniers paiements » redisait, en moins bien, ce que la page Paiements dit déjà — par
client, avec « À rattacher » et « Relances ». Et l'onglet n'affichait jamais une seule
vente : on y lisait « 5 700 € · 5 deals signés » sans savoir lesquels.

Le tableau liste maintenant les ventes signées dans la période : date, client, contracté,
encaissé à ce jour, statut, avec un total en pied. Ce qui compte le plus n'est pas
l'information ajoutée, c'est que **les deux chiffres du haut deviennent vérifiables ligne
à ligne** : la colonne « Contracté » totalise la carte « Cash contracté », la colonne
« Encaissé » totalise le numérateur du taux de collecte. C'est en contrôlant ces deux
invariants qu'on a trouvé la moitié des défauts de cet écran.

Un remboursement reste lisible dans l'écart entre les deux colonnes (800 € encaissés sur
une vente de 1 000 €) ; le détail paiement par paiement vit sur la page Paiements.

Le bloc « Cash encaissé par origine » s'arrête à 4 lignes avant « Voir plus », et porte
une note de rapprochement : son total est l'argent REÇU, pas l'argent VENDU — c'est ce
qui explique 2 600 € ici sous 10 200 € en carte, et rien ne le disait.

### Les six arbitrages du 2026-08-30, tous livres et verifies

| | Decision | Ou |
|---|---|---|
| 1 | Le trop-percu est **plafonne vente par vente** dans tout total rapporte au contracte | `encaisseRetenu()` dans `lib/dealCash.ts` |
| 2 | Une vente **terminee garde son montant entier** — l'arret se lit dans le taux, pas dans le contracte | rien a faire, deja le cas partout |
| 3 | Le **ruban de la page Paiements** cesse de compter les ventes annulees | `app/api/payments/route.ts` |
| 4 | L'addition des paiements passe **cote base** | migration `20260830190000` |
| 5 | Le tableau des ventes **affiche le trop-percu** sur la ligne | `TabRevenues` |
| 6 | La **ligne d'un client** et sa fiche disent ce qu'il a **vraiment verse** | `FicheClient` |

Plus une decision anterieure : un **cash collecte negatif** s'affiche en ambre, jamais
en vert, et sans plancher a zero.

#### Les deux notions du cash, a ne jamais confondre

C'est le point le plus facile a casser en relisant ce code dans six mois.

- **`cash.net`** — « combien cette personne a **verse** ». Ecrans d'action : la ligne
  d'un client, sa fiche, le cash encaisse d'une periode, la ventilation par origine.
  Peut depasser le montant de la vente, et c'est un fait, pas une erreur.
- **`encaisseRetenu()`** — « quelle part de cette **vente** est rentree ». Ecrans de
  pilotage : taux de collecte, reste a encaisser, tout total rapporte au contracte.

Consequence assumee : sur une periode avec un trop-percu, la carte « Cash collecte » de
l'onglet Revenus annonce plus que le total de la colonne « Encaisse » du tableau. C'est
la mention « +X EUR a rendre » sur la ligne concernee qui explique l'ecart — sans elle,
l'ecran aurait l'air faux et l'argent du au client disparaitrait de la vue.

#### Comment ca a ete verifie

Aucun trop-percu, aucune vente annulee et aucun mois negatif n'existent en base. Les
trois cas ont donc ete **crees en base**, verifies a l'ecran sur les quatre vues et sur
les deux pages, puis **restaures** — les chiffres sont revenus identiques a l'octet.
La regle elle-meme est couverte par sept tests unitaires, seule verification possible
tant qu'aucun client n'aura paye deux fois.

### Ce qui reste ouvert

Un seul point, et c'est le plus serieux de tout l'audit.

**Un compte Stripe branche en OAuth n'a AUCUN filet de rattrapage.** Verifie dans le
code le 2026-08-30 : `supabase/functions/sync-stripe-payments` — la seule fonction qui
relit les paiements chez Stripe — **ignore volontairement les comptes OAuth**, au motif
que « leur webhook fait deja le travail en temps reel ». Pour ces comptes, le webhook
est donc l'unique chemin d'ecriture. Un evenement non delivre, ou une erreur pendant son
traitement, et le paiement n'existe nulle part : ni dans le cash, ni dans « A rattacher »
(qui lit `stripe_payments`, donc ce que le webhook a ecrit), ni dans aucune vue de sante.

Ce n'est pas theorique. Trois encaissements vus dans `charges.list` du compte de test
(25 €, 25 €, 10 €, dates du 19/08) sont absents de `stripe_payments`, qui ne compte que
6 lignes en tout. Le compte etait connecte depuis le 18/08 a 23 h 13 et le webhook
ecrivait bien le 19/08 a 00 h 30 : ils sont donc posterieurs au branchement. La cause
exacte demande le journal de livraison des webhooks cote Stripe, hors de portee d'ici.

**La correction tient en une ligne de perimetre** : cesser d'exclure les comptes OAuth
de `sync-stripe-payments`, et la faire tourner une fois par jour comme filet. Elle sait
deja lire les charges, les rattacher par metadata et ne pas creer de doublon (garde
`existing` sur `(deal_id, stripe_payment_id)`). C'est le motif « fenetre de rattrapage
plus large que l'intervalle » de `docs/checklist-scalabilite.md`, applique au seul
chemin d'ecriture qui n'en a pas.

⚠️ C'est une Edge Function : elle ne part **pas** avec `git push`. Deploiement separe
obligatoire, et `npx deno check` avant.

### Ce qui a ete clos depuis, et comment

- **Le cash brut** — quatre lectures sommaient les paiements `succeeded` sans deduire
  les remboursements : `useCoachData`, `SupabaseClientsContext` (x4 requetes),
  `salesCallStats.fetchDealsForStats`. 2 800 € affiches pour 2 600 € en caisse sur
  l'accueil coach, la liste des clients et la fiche eleve. Toutes passent desormais par
  `calculerCash`. Le commentaire de `computeDealTotals` affirmait qu'un remboursement
  etait une ligne NEGATIVE — c'est faux, et c'est ce qui a fait survivre le defaut.
- **Le doublon `in_` / `pi_` dans `stripe_payments`** — deja gere : `/api/payments`
  ecarte tout paiement dont le montant ET l'instant coincident avec un paiement deja
  rattache. Verifie a l'ecran : « Tout est rattache », zero faux orphelin.
- **Les `width(-1)`** — 11 conteneurs corriges (10 dans `PageClientStats`, plus le
  composant partage `LineChart`). Console a zero sur les six onglets.
- **Les sequences de stories** — voir plus haut, `first_touch_content_id` porte trois
  formes d'identifiant.

### `first_touch_content_id` porte TROIS formes d'identifiant, pas deux

À retenir avant toute lecture de ce champ :

| Forme | Exemple | Contenu | Où le résoudre |
|---|---|---|---|
| numérique, 17-18 chiffres | `18056185901693457` | post Instagram | `ig_post_meta` |
| 11 caractères | `EMvwzHVjNJg` | vidéo YouTube | `resolveYtVideoTitles`, vignette via `/api/resources/yt-thumb` |
| UUID | `d1ad9817-…` | **séquence de stories** | `story_sequences.name`, vignette = première story non archivée (`ig_stories.storage_url`, `posted_at` croissant) |

`/api/payments/by-origin` n'en connaissait que deux : toute séquence de stories tombait
donc dans le repli « Contenu supprimé », sans vignette, alors qu'elle était bien vivante.
Et aucune vidéo YouTube n'avait jamais de vignette — la route posait `thumbnail: null` en
dur. Corrigé le 2026-08-30, en reprenant la résolution de « Performance par contenu »
(onglet Business micro, `app/api/instagram/story-sequences-stats`) pour que les deux
écrans nomment et illustrent un contenu de la même façon.

⚠️ J'avais d'abord conclu, en voyant un UUID, à une attribution mal écrite en amont.
C'était faux : la forme d'un identifiant ne dit rien tant qu'on n'a pas cherché quel type
de contenu l'utilise. L'écran voisin le savait déjà.
4. **Neuf `ResponsiveContainer` sans `initialDimension`** produisent encore des
   `width(-1)` en console : huit en ligne dans `PageClientStats` (un dans
   `TabOverviewV2`, deux dans `TabInstagram`, cinq dans `TabYouTube`) et le composant
   partagé `components/charts/LineChart.tsx`, qui vaut pour tous ses appelants.
   `BarChart` et `AreaChart` sont corrigés. Hors périmètre de ce chantier.

### Note de livraison

Les corrections de `PageClientStats.tsx` ont été absorbées par le commit `090f408` d'une
session parallèle travaillant dans le même fichier, et poussées sous son message. Le
*pourquoi* de chaque correction vit dans les commentaires du code. Les deux fichiers
restants portent leurs propres commits : `970cbe5` (BarChart) et `3ea6e8d` (route Stripe).
