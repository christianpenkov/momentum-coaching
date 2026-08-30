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
- Élève : `christianpenkov80@gmail.com` / `Fortnite2605`
- Coach : `christianpenkov06@gmail.com` / `Fortnite2605`
- Profil avec données réelles : `a02e5927-7b39-4b7d-b112-0a43b30e9f09`

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
