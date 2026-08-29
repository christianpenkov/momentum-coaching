# Handoff — Audit « Funnel & Calls »

Dernier périmètre de « Mes Stats ». YouTube, Instagram et Business micro sont clos.
Brief écrit le **2026-08-29** à la fin du chantier Business micro.

**Ce document ne contient aucune conclusion d'audit.** Il contient le périmètre, la
méthode, la procédure de vérification et des pistes à vérifier. Les pistes de la
section 6 ont été repérées **en lisant le code**, ce que la méthode interdit
explicitement de considérer comme un résultat. Elles ne valent que comme points de
départ : chacune doit être confirmée ou infirmée en base ou contre l'API avant d'être
tenue pour vraie, et il faut s'attendre à ce que certaines soient fausses.

---

## 1. La méthode — elle a tout trouvé, la respecter

**Charger le skill `audit-metrique-bout-en-bout` (`~/.claude/skills/`) avant de
commencer.** Il contient la méthode complète et les sept pièges récurrents.

**Une métrique à la fois**, en remontant la chaîne **API → base → écran**, recoupée
avec **une réponse d'API réelle** et **une capture d'écran**. Jamais de conclusion
tirée de la lecture du code ou de la documentation seules.

Résultat sur les périmètres déjà traités : ~23 corrections sur YouTube, ~30 sur
Instagram, et sur Business micro le plus gros défaut trouvé jusqu'ici — **39 % de
clics fantômes**, totalement invisible à toute lecture de la base seule.

> **La règle qui compte le plus : vérifier en base ou contre l'API avant d'affirmer.
> Un « ça devrait marcher » n'est pas un résultat.**

Et son inverse, tout aussi coûteux : `GREATEST` et `ignoreDuplicates` masquent une
sous-évaluation. **Nettoyer puis constater zéro ne prouve rien** — il faut forcer une
recollecte (`last_synced_at = null`) et vérifier après le passage du cron.

### Les sept pièges

1. La règle écrite à plusieurs endroits, qui a divergé.
2. Une donnée présente n'est pas une donnée fiable (croiser avec un volume de référence).
3. Une donnée affichée n'est pas une donnée collectée.
4. Un zéro qui devrait être un trou.
5. L'échec silencieux (une panne qui ne rend aucun chiffre faux, mais fige leur fraîcheur).
6. Le total qui ne réconcilie pas avec la somme de ses filtres.
7. **Deux calendriers pour un même jour** — trouvé le 2026-08-28. Dès qu'une API
   expose une fenêtre nommée (`today`, `yesterday`) et que le code calcule sa propre
   date, vérifier que les deux définissent la journée dans le même fuseau.
   *Signature en base* : une même entité qui porte des valeurs sur deux jours
   **consécutifs**.

Sur ce périmètre-ci, le piège 7 a une variante à surveiller de près : **un `Date`
construit depuis une chaîne `YYYY-MM-DD` est interprété en UTC**, alors que
`parisDateStr()` produit un jour de Paris. Mélanger les deux décale les frontières de
journée de une à deux heures selon la saison.

---

## 2. Le périmètre exact

### Ce qui est dans le périmètre

| Surface | Fichier | Taille |
|---|---|---|
| **Onglet Funnel** (Mes Stats, onglet 3) | `components/analytics/PageClientStats.tsx`, `TabFunnel` ~ligne 3825 | ~700 lignes |
| **Page Calls élève** | `components/pages/client/PageClientCalls.tsx` | 980 lignes |
| **Page Calls coach** | `components/pages/coach/PageCalls.tsx` | 680 lignes |
| **Calls à venir** (élève) | `app/(client)/client/calls-a-venir/page.tsx` | wrapper |

Les trois `page.tsx` ne sont que des enveloppes ; tout est dans les composants.

### Ce qui n'est PAS dans le périmètre

- **L'onglet Revenus** (`TabRevenues`, ~4558) — il lit `deals` et Stripe. Le toucher
  ouvre le chantier Paiements, qui a son propre historique.
- **Le pipeline leads** — refondu récemment, voir la note mémoire
  `project-refonte-pipeline-leads`.
- **La saisie du rapport de call** (`RapportModal`) — c'est de l'écriture, pas de
  l'affichage de statistiques. Mais **lire** `docs/rapports-de-call.md` reste
  obligatoire : c'est ce rapport qui produit `outcome`, `no_show` et `deal_closed`,
  donc les trois quarts des chiffres de ce périmètre.

### Ce que l'onglet Funnel affiche, à auditer une métrique à la fois

1. **Hero, 8 cartes** : Calls bookés, Calls IG, Calls YT, Calls honorés, No-show,
   Deals closés, Revenue total, Rev / call. Chacune ouvre une **modale avec un
   graphique** au clic.
2. **Deux entonnoirs** (Instagram, YouTube), 6 étapes chacun : Reach/Vues → Clics
   liens Calendly → Calls bookés → Calls honorés → Deals closés → Revenue, avec un
   **taux de passage** entre chaque étape.
3. **Tableau « Efficacité par plateforme »**, 7 métriques × 2 plateformes : Reach pour
   1 call, Calls bookés, No-show, Close rate, Rev / call booké, Cash / vue, Revenue
   total. Chaque cellule ouvre une modale avec sa série jour par jour.
4. **Table des calls**, avec un filtre Tous / IG / YT.

**Les modales comptent.** C'est en ouvrant une modale d'un autre onglet qu'on a trouvé
le « 7500 % » : un taux déjà en pourcentage, multiplié une seconde fois par 100. Aucune
requête SQL ne pouvait le montrer, la donnée stockée était juste. **Ouvrir chaque
modale, sur chaque carte, sur chaque cellule.**

---

## 3. À lire impérativement avant de toucher aux calls

- `docs/rapports-de-call.md` — **le parcours de vente a 17 étapes et 5 sorties.**
  Cette carte n'existe nulle part ailleurs.
- `docs/calls-coach-id-piege.md` — **`calls.coach_id` n'est pas le coach humain.**
- `docs/perimetre-stats-referentiel.md` — les cinq règles de périmètre.
- `docs/fuseaux-horaires.md` — pour tout affichage d'heure.
- `docs/checklist-scalabilite.md` — chaque point y a trouvé un vrai défaut.

### Les deux filtres obligatoires

```sql
-- TOUTE requête sur calls, audit compris, porte ces deux filtres :
where ignored is not true
  and call_type = 'calendly'   -- vente ; 'google' = coaching
```

Sans le second, **22 calls de coaching** entrent dans les chiffres de vente (compté en
base le 2026-08-29). Sans le premier, **25 calls ignorés** y entrent aussi.

### La règle du cash

> **`deals` est la source du cash. `calls.revenue` n'est qu'une trace du rapport.**

Les deux **ont divergé en base** : le deal `4a8dde35` vaut 1 200 € après modification
des modalités, `calls.revenue` en dit toujours 3 000. Business micro passe par
`callsEff` / `callsAllTimeEff`, qui réappliquent la somme des deals rattachés.

---

## 4. La procédure, métrique par métrique

Pour **chacune** des ~25 valeurs listées en 2, dans cet ordre :

**a. Capturer.** Ouvrir l'écran dans le navigateur, en élève et en coach, et noter la
valeur affichée. Ouvrir la modale associée. Identifiants : note mémoire
`reference-test-accounts`.

**b. Remonter à la requête.** Trouver d'où vient le chiffre. Noter les filtres
appliqués, la borne de date, et **sur quelle colonne de date** la fenêtre est découpée.

**c. Recalculer en SQL, à la main**, avec les deux filtres obligatoires. Comparer au
chiffre de l'écran. **Un écart d'une seule unité est un défaut**, pas un arrondi :
c'est un écart d'un point qui a révélé qu'une catégorie entière manquait à un filtre.

**d. Croiser avec la source externe** quand il y en a une (Meta pour le reach,
Short.io pour les clics, Stripe pour le cash). Pour interroger une API avec les vrais
jetons : les lire depuis `integrations` avec la clé service de `.env.local`. **Chris
autorise explicitement l'usage de ses jetons pour tester en conditions réelles.**

**e. Faire varier la période.** 7 jours, 30 jours, semaines et mois antérieurs
(`periodIndex > 0`, qui bascule sur les snapshots), et **All-Time**. C'est en changeant
de période qu'on a trouvé les graphiques All-Time bornés au mois en cours : en-tête
« All-Time », KPI à 150, courbe totalisant 23.

**f. Vérifier la cohérence interne.** Le total égale-t-il la somme de ses parties ?
Le hero égale-t-il la somme des deux entonnoirs ? La modale d'une carte égale-t-elle
la carte ? Un taux dépasse-t-il 100 % ?

**g. Chercher le zéro qui ment.** Un `0` affiché correspond-il à « mesuré, c'était
zéro » ou à « pas collecté » ? Dans le second cas, l'écran doit montrer **un trou**.

### Et une vérification que la lecture d'écran ne donne pas

Le passage à l'échelle. `docs/checklist-scalabilite.md`, en particulier : **compter
les appels d'API par passage de cron**, et vérifier que ce nombre ne croît pas avec le
nombre d'élèves ni avec la profondeur de l'historique. C'est ce point qui a fait
passer YouTube d'une capacité de 4 élèves à 121.

---

## 5. Contraintes permanentes

- **Zéro maintenance** après livraison à Quennel ; robuste à **30-40 élèves**.
  Solide > rapide.
- **Aucune donnée inventée, simulée ou codée en dur.** Un `0` affirme quelque chose,
  un trou dit « on ne sait pas ».
- **Corriger tout bug évident, y compris quand le cas ne s'est jamais produit** —
  demande explicite de Chris, 2026-08-28. Ne pas attendre qu'un défaut latent se
  manifeste pour le traiter.
- Réponses en **français**, explications non techniques.
- **Poser une question uniquement quand la réponse change ce qu'on fait.**
- Déploiement : **`git push origin main`**. Jamais `vercel deploy --prod`.
- Edge Functions : **déploiement séparé obligatoire**, `git push` ne les emmène pas.
  `npx deno check` d'abord — `tsc` et `npm run build` ne couvrent pas
  `supabase/functions/`.
- **Vérifier la branche avant chaque commit**, et **stager les fichiers explicitement**
  (`git add <fichier>`, jamais `-A`) : une session parallèle de Chris tourne souvent en
  même temps, et un `-A` emporte son travail en cours.
- Ne jamais annoncer qu'une correction fonctionne avant de l'avoir **constatée**.

---

## 6. Pistes à vérifier — aucune n'est un résultat

Repérées en lisant le code le 2026-08-29, donc **sans valeur tant qu'elles ne sont pas
vérifiées**. Elles sont classées par intérêt supposé. Certaines seront fausses.

### Deux règles de journée coexistent dans le même onglet

`toCallsData` (modales du hero) découpe les journées sur `callPeriodDate(c)`, avec un
commentaire qui explique pourquoi. `buildEffDayData` (modales du tableau d'efficacité)
découpe sur `c.scheduled_at?.startsWith(iso)`. Deux règles pour la même notion, dans le
même écran. **À vérifier** : les deux modales donnent-elles le même nombre de calls
bookés le même jour ? Piège 1 et piège 7.

### Frontières de journée en UTC comparées à des jours de Paris

Dans `toCallsData`, `new Date(date).getTime()` où `date` vient de `parisDateStr()`.
Une chaîne `YYYY-MM-DD` est parsée en **UTC**. **À vérifier** : un call réservé entre
minuit et 2 h du matin heure de Paris tombe-t-il sur le bon jour dans la modale ?
Piège 7.

### Reach Instagram : somme de jours contre mesure de période

`igReachD` somme `ig.chartData[].reach` jour par jour. Or le reach Meta est
**dédupliqué par période** : une même personne touchée trois jours de suite compte
trois fois dans une somme de jours, une seule fois dans une mesure de période. La
table `analytics_ig_periodes` existe précisément pour porter la mesure de période.
**À vérifier** : l'entonnoir affiche-t-il le même reach que l'onglet Instagram sur la
même période ? Si non, lequel est juste, et le taux « clics / reach » a-t-il un sens ?

### Populations mélangées dans le taux de no-show

`noShowRate` prend son numérateur sur `callsInWindow` (tous les calls de la fenêtre) et
son dénominateur sur `totalBookes = igBookes + ytBookes` (uniquement les calls dont
`source` commence par `ig`/`yt`). Un call dont la source ne matche ni l'un ni l'autre
compterait au numérateur sans compter au dénominateur. **Mesuré le 2026-08-29 : aucun
cas aujourd'hui**, les 19 calls de vente ont tous une source `ig_*` ou `yt_*`. Reste
que la règle de Chris est de corriger même sans cas. Piège 6.

### `.neq('ignored', true)` n'est pas `ignored is not true`

En SQL à trois valeurs, `ignored <> true` vaut NULL — donc **faux** — quand `ignored`
est NULL : la ligne disparaît silencieusement. La colonne est `nullable` avec un défaut
`false` : un `insert` qui passe explicitement `null` produirait des calls invisibles
partout. **Mesuré le 2026-08-29 : aucune ligne à NULL aujourd'hui.** Même remarque sur
`.neq('call_type', 'calendly')` dans `PageClientCalls` (ligne 223) pour les calls de
coaching. Piège 5 — c'est exactement la forme d'un échec silencieux.

### Un deal annulé laisse-t-il un revenu périmé ?

`callsEff` ignore les deals `status = 'canceled'`. Un call dont l'unique deal a été
annulé n'entre donc pas dans la table de correction et **conserve `calls.revenue`**,
c'est-à-dire le montant saisi au rapport. **À vérifier en base** : existe-t-il un call
avec un deal annulé et un `calls.revenue` non nul, et que montre l'écran pour ce call ?

### Un commentaire périmé sur les clics

Dans `resolveClics` : « clicsHumains est all-time 30j ». Ce n'est plus vrai depuis le
2026-08-29 — le champ a été renommé et la RPC renvoie désormais la fenêtre demandée,
quelle qu'elle soit. **À vérifier** : le repli `if (periodIndex === 0 && period === 30)`
donne-t-il encore le bon chiffre, ou compte-t-il une fenêtre différente de celle
affichée ?

### Le taux de conversion compare deux périodes différentes

Le badge « Calls bookés » du breakdown vaut `bookés ÷ clics de la période`. Or un clic
du 30 août peut donner une réservation le 1er septembre : le dénominateur est dans une
période, le numérateur dans la suivante. Sur une vue hebdomadaire et de petits volumes,
l'effet de bord est proportionnellement énorme.

Ce que fait l'industrie : attribuer la conversion à la **date du clic**, pas à celle de
la réservation (Google Ads et Meta Ads le font par défaut, via `gclid` / `fbclid` — un
**identifiant de clic** transporté jusqu'à la conversion). Le prix accepté : les
périodes passées continuent de bouger pendant la fenêtre d'attribution.

**Mesuré le 2026-08-29 : ce n'est pas implémentable en l'état.** Sur 19 calls de vente,
**0** portent un `prospect_link_id`, et les clics bio/contenu sont anonymes dans le flux
Short.io (chemin + horodatage, aucune identité). Il n'existe donc aujourd'hui aucun
moyen de relier une réservation au clic qui l'a produite, ni même de mesurer le délai
entre les deux.

**À vérifier** : ce `0 / 19` est-il normal (les liens par prospect sont peu utilisés,
3 lignes seulement dans `prospect_links`) ou révèle-t-il que la résolution
`prospect_link_id` du webhook Calendly — par `short_link_path` — ne marche jamais ?
C'est la première chose à trancher, parce que toute la question de l'attribution en
dépend.

### Pièges déjà documentés ailleurs, à re-vérifier ici

- `.maybeSingle()` sur `instagram_leads` sans filtre (`pipeline/advance`,
  `client/calls`) : deux lignes pour un même `ig_username` font **échouer** la requête.
- Résolution Calendly par `ig_user_id` sans borne de compte.
- Marge de **24 h sur `connected_at`** (note `feedback-connected-at-margin`).

---

## 7. Outils et comptes

**Profil de test principal** : `a02e5927-7b39-4b7d-b112-0a43b30e9f09` (Christian,
`@chris.pkv`) — le seul avec des données réelles sur toutes les plateformes.
Son `integrations_ready_at` est le **09/06/2026** : c'est la borne de l'All-Time, et
elle diffère de `connected_at` (29/05).

Identifiants navigateur : note mémoire `reference-test-accounts`.

**Projet Supabase** : `nvjgwtetyuatnkjihmtw`.

**Santé de la plateforme :**

```sql
select * from cron_runs order by ran_at desc;   -- vide = aucun incident (30j)
select * from shortio_sante_donnees;            -- tout à 'ok'
select * from yt_sante_donnees;                 -- tout à 'ok'
```

**Tests** : `npm test` (node --test, aucune dépendance). Couvre les fonctions pures de
`lib/*.test.ts`. Quand un audit trouve un invariant — un total qui doit égaler la somme
de ses parties — **la livraison n'est pas la correction du chiffre, c'est le test qui
interdit la récidive**. C'est ce qui a été fait pour la couverture des catégories de
liens dans Business micro.

### Deux pièges d'outillage sous Windows

⚠️ **`curl` corrompt les accents.** Utiliser Python pour tout appel HTTP de test
(note `feedback-accents-curl-windows`). Les `???` viennent du terminal, pas du code.

⚠️ **Les heredocs PowerShell (`@'…'@`) ne passent pas dans l'outil Bash**, et un
`git commit -m` multiligne y casse. Écrire le message dans un fichier, puis
`git commit -F <fichier>`.

---

## 8. État des autres périmètres

**YouTube** — clos. `docs/youtube-scalabilite.md`. 23 corrections, capacité 4 → 121
élèves.

**Instagram** — clos. `docs/instagram-scalabilite.md`,
`docs/instagram-reach-follow-type.md`.

**Business micro** — clos le 2026-08-29. `docs/handoff-audit-stats.md` contient le
détail complet : ce qui était cassé et comment on l'a su, l'architecture retenue, et
ce qui reste ouvert volontairement.

**Clics des liens de paiement** — traité par le chantier Paiements le 2026-08-29.
`docs/handoff-clics-liens-paiement.md`.

**Rendez-vous du 31 août** — la première clôture de période Instagram. Une routine
cloud vérifie et rapporte :
https://claude.ai/code/routines/trig_013FSi3fHa8nTV977c8jWxKf

---

## 9. Comment livrer

Corriger directement ce qui est un bug évident. Poser une question uniquement quand la
réponse change ce qu'on fait.

À la fin, mettre à jour `docs/handoff-audit-stats.md` : « Reste Funnel & Calls »
devient « tout est clos », avec la liste de ce qui a été trouvé, **comment chaque
défaut a été établi** (c'est la colonne la plus utile du tableau de Business micro), et
ce qui reste ouvert volontairement.

Et écrire les observations réutilisables dans le log du skill `task-observer` : c'est
ce qui a fait passer la méthode de six pièges à sept.
