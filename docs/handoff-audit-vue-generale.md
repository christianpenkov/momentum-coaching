# Handoff — Audit de « Vue générale », puis repasse sur Instagram et YouTube

Écrit le **2026-08-31**, après la clôture de Funnel & Calls.

**Ce document ne contient aucune conclusion d'audit.** Il porte le périmètre, la
méthode, la procédure et des pistes **non vérifiées**, repérées en lisant le code —
ce que la méthode interdit explicitement de considérer comme un résultat. Chacune
doit être confirmée ou infirmée en base, contre l'API ou à l'écran. Certaines seront
fausses.

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

**Sur Vue générale, le candidat évident est « Closing »** : il porte un seuil de
couleur (`>= 25 %` vert) et affiche « N deals closés » juste en dessous. Si son
dénominateur n'est pas le « Calls honorés » de la carte voisine, la division ne
tombera pas juste.

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

Balayer au minimum 4 mois en arrière (dont un **antérieur au début de la collecte
Short.io, le 19/07**), 4 semaines, et l'All-Time. Pour chaque état : aucun `NaN`,
`Infinity`, `undefined`, `Invalid Date`, `[object Object]`, aucun taux impossible.

⚠️ **All-Time passe par `sinceConnection`, pas par `periodIndex`.** Les périodes
passées passent par `fetchSnapshot`, la période courante par le chemin live : **trois
chemins de données distincts**. Un correctif appliqué à l'un ne touche pas les autres —
c'est exactement ce qui a laissé passer le 250 %.

---

## 8. Pistes à vérifier sur Vue générale — aucune n'est un résultat

Repérées en lisant le code le 2026-08-31. Non vérifiées.

### Le revenu diverge peut-être de celui de l'entonnoir

Voir §5. `totalRev` somme `calls.revenue`. À établir en premier.

### « Abonnés IG » et « Abonnés YT » affichent `|| 0`

`fmt(ig?.followers || 0)` : si l'API n'a rien renvoyé, la carte affiche **0 abonné**
plutôt qu'un tiret. Un `0` affirme quelque chose. Et `|| 0` efface aussi un vrai 0 —
motif déjà responsable de six défauts sur ce projet.

### Le sous-titre « total » ne dit pas de quand

Les abonnés sont un **état courant**, pas une mesure de période. Vérifier que la carte
ne change pas quand on navigue vers un mois passé — et si elle ne change pas, que le
libellé le dise.

### Le seuil de couleur du closing

`>= 25 %` vert, `>= 15 %` ambre. Calibré sur quoi ? Un seuil inventé qui colore en
rouge une performance normale est un chiffre décoratif qui trompe.

### Les deux courbes portent un drapeau `pending`

`d.pending ? null : d.reach` : un point « en attente » devient un trou, ce qui est la
bonne règle. Vérifier que `pending` est bien posé partout où la donnée n'est pas
consolidée, et **seulement** là.

### Le no-show a son propre dénominateur

`${noShows} sur ${rendezVous} rendez-vous`, avec un `rendezVous` qui n'est pas
forcément le « Calls honorés » de la carte voisine. Cas typique du 7ᵉ piège.

### Pièges déjà documentés, à revérifier ici

- **Recharts ignore `domain` sans `ticks`.**
- **`initialDimension`** manquant sur un `ResponsiveContainer` produit
  `width(-1) and height(-1)` en console.
- **Les `numeric` Postgres arrivent en chaîne** : sans `Number()`, `"10" + "20"` donne
  `"1020"` et passe le typage.

---

## 9. Outils, comptes, pièges d'outillage

**Comptes de test** : élève `christianpenkov80@gmail.com` / `Fortnite2605`, coach
`christianpenkov06@gmail.com` / même mot de passe. Profil avec données réelles :
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
