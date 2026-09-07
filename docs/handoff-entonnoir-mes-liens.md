# Handoff — l'entonnoir de « Gérer mes liens » compte des interactions là où il dit « Leads »

**Origine** : constat de Chris le 2026-09-07, sur son compte RDJ. Décision produit prise
le même jour, détaillée plus bas.

---

## Le constat, chiffré

La marche « Leads » de l'entonnoir (`PageLiens.tsx`, ~5129 pour le rendu, ~5938 pour le
calcul) vaut `lmHistory.length` — le nombre de **lignes** dans
`instagram_lead_lm_history`, donc de **demandes de lead magnet**, pas de personnes.

Mesuré le 2026-09-07 :

| Élève | « Leads » dans Mes Liens | Personnes réelles | Ce que Mes Stats affiche |
|---|---|---|---|
| **Rdjdkz** | **21** | **1** | **1** |
| Christian | 19 | 4 | 19 |
| Dolphin | 4 | 2 | 2 |

Vingt-et-une demandes faites par **une seule personne** s'affichaient « 21 leads ».
Christian tombe juste par coïncidence (19 interactions, 19 personnes au sens de Mes
Stats) — ça ne se reproduira pas.

## Pourquoi l'écart existe, et depuis quand

⚠️ **C'est une régression introduite le 2026-09-06, et il faut le savoir pour ne pas
« corriger » dans le mauvais sens.**

Avant cette date, les deux écrans comptaient tous deux `instagram_lead_lm_history` : le
même mot donnait le même nombre. Le commentaire de `PageLiens.tsx` le dit encore
explicitement — « la definition de Mes Stats, pour que le meme mot donne le meme
nombre » — et **cette phrase est devenue fausse**.

Ce jour-là, Mes Stats (`PageClientStats.tsx`) est passé à `compterLeads` : les
**personnes qui se sont manifestées**, dédoublonnées. C'était la bonne correction (Mes
Stats comptait les entrés dans la séquence de DM, ce qui masquait une fuite du tunnel),
mais personne n'a vu que `PageLiens` s'appuyait sur l'ancienne définition.

**Corriger le commentaire fait partie du travail** : le laisser ferait recommencer le
raisonnement à l'envers dans six mois.

---

## Ce que Chris a décidé

### 1. « Leads » compte des PERSONNES

Deux apports, dédoublonnés ensemble :

- les personnes ayant demandé un lead magnet (une par personne, pas une par demande) ;
- **plus** les calls bookés directement, sans passer par un lead magnet : depuis la
  **bio Instagram**, la **bio YouTube**, la **description Instagram** et la
  **description YouTube**.

Le second apport est essentiel : ce sont des prospects réels que l'entonnoir ignorait
parce qu'ils n'ont jamais réclamé de lead magnet. Le commentaire du funnel le disait
déjà pour les calls (« la conversation n'est qu'un chemin parmi deux, l'autre part
directement d'un lien en bio ou en description — et c'est même le plus gros ») ; la
première marche doit suivre la même logique.

### 2. « Conversations » se limite aux mêmes sources

Toutes les sources **sauf le cold DM sortant** — c'est-à-dire sauf les personnes que le
coach est allé chercher lui-même. Une conversation née d'un reach-out n'appartient pas à
un entonnoir qui mesure ce que le CONTENU produit.

---

## Comment l'écrire, et ce qu'il ne faut pas refaire

### ⚠️ `canalDuDm()` existe déjà — ne pas réécrire la règle

`lib/canalDm.ts` répond exactement à « qui a fait le premier pas » :

```ts
canalDuDm(source) // → 'sortant' | 'entrant' | 'story'
```

Le cold DM sortant, c'est `canalDuDm(source) === 'sortant'`.

Son en-tête raconte pourquoi elle existe : la règle vivait **recopiée à sept endroits**
de `PageClientStats`, écrite en négatif (`source !== 'story_reply' && source !==
'comment'`), ce qui rangeait dans « sortant » tout ce qu'elle ne connaissait pas — y
compris `null`. Un lien créé pour un inconnu atterrissait en « le coach est allé le
chercher » sans que personne l'ait décidé. **Ne pas produire une huitième copie.**

⚠️ Et garder en tête son comportement volontaire : **une source inconnue ou absente rend
`'sortant'`**. C'est un choix écrit, pas un défaut — mais il veut dire qu'une source
nouvelle sera exclue des conversations par défaut, silencieusement.

### ⚠️ Deux familles de `source` qui ne se ressemblent pas

C'est le piège principal de ce chantier :

| Table | Valeurs de `source` | Sert à |
|---|---|---|
| `prospect_links`, leads | `comment`, `dm_entrant`, `dm_sortant`, `cold_dm`, `story_reply` | `canalDuDm()` |
| `calls` | `ig_bio`, `ig_description`, `ig_story`, `ig_dm`, `yt_description` | l'origine du rendez-vous |

`canalDuDm()` ne s'applique **pas** aux sources de `calls`. Pour la marche « Leads », les
calls se filtrent sur leur propre famille : `ig_bio`, `ig_description`, `yt_bio`,
`yt_description`.

Relevé en base le 2026-09-07 sur les calls de vente non ignorés :
`ig_description` (7), `ig_bio` (5), `ig_dm` (4), `yt_description` (3), `ig_story` (1).
`yt_bio` n'existe pas encore en données mais la catégorie est prévue
(`BUSINESS_CATEGORIES`, `lib/shortio-link-category.ts`).

### ⚠️ `compterLeads` fait DÉJÀ presque tout — mais pas exactement ça

`lib/salesCallStats.ts` dédoublonne déjà personnes + calls IG directs + calls YouTube, et
c'est ce que Mes Stats utilise. **Mais son volet IG prend `source like 'ig\_%'`, donc
`ig_dm` compris** — or Chris veut exclure le reach-out.

Deux chemins possibles, à trancher par l'exécutant :

- passer à `compterLeads` un jeu de calls **déjà filtré** par l'appelant (elle accepte
  des lignes pré-découpées, c'est documenté dans sa signature) ;
- ou écrire le comptage dans `PageLiens` en réutilisant ses briques.

⚠️ **Ne pas dupliquer la règle de dédoublonnage** (`invitee_email || invitee_name || id`,
en minuscules) : c'est elle qui évite de compter deux fois un prospect qui a reprogrammé
son rendez-vous — Calendly crée un nouvel événement à chaque report, et ce défaut a déjà
affiché 18 leads là où le pipeline en montrait 17 (2026-08-19).

---

## Question ouverte, à poser à Chris avant d'écrire

**`ig_story` compte-t-il dans la marche « Leads » ?**

Chris a nommé « les bios ig et yt » et « les contenus description ig et yt ». Il n'a pas
mentionné les stories. Or `ig_story` est bien un contenu qui génère des rendez-vous
directs (1 call en base aujourd'hui), et les stories comptent déjà comme des publications
partout ailleurs depuis le 2026-09-04.

Probablement un oubli plutôt qu'une exclusion — mais c'est un choix produit, à confirmer
en une phrase, pas à décider par défaut.

---

## Vérification attendue

Après le changement, sur les trois profils de test :

| Élève | « Leads » attendu | Pourquoi |
|---|---|---|
| Rdjdkz | 1 (+ ses calls directs éventuels) | 21 demandes, une seule personne |
| Dolphin | 2 (+ calls directs) | 4 demandes, deux personnes |
| Christian | à recalculer | 4 personnes en lead magnet + ses calls bio/description |

⚠️ **Le nombre de Mes Stats et celui de Mes Liens n'ont PAS à être identiques**, et c'est
voulu : Mes Stats compte toutes les personnes manifestées, Mes Liens seulement celles
venues du contenu (cold DM exclu). Deux questions différentes, deux nombres — ce qu'il
faut, c'est que chacun dise ce qu'il compte.

## Pièges d'exécution

- **`PageLiens.tsx` est édité en parallèle par une autre session.** Vérifier
  `git status` et la branche avant tout commit, et ne commiter que ses propres fichiers.
- Le fichier porte **deux entonnoirs distincts** : un vers la ligne 2036
  (`commentaires = personnes.size`, déjà dédoublonné) et un vers 5938
  (`commentaires = lmHistory.length`). Celui à corriger est le **second**. Vérifier
  lequel alimente le rendu de la ligne ~5129 avant de modifier.
- La route `/api/client/pipeline` filtre déjà `archived_at is null` sur `lmHistory` :
  ne pas rajouter un filtre par compte Instagram, ce serait un second mécanisme
  concurrent (voir `docs/a-deployer-apres-meta-review.md`).
