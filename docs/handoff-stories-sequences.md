# Handoff — Séquences de stories dans « Gérer mes liens »

> **État au 2026-09-09 : le chantier est LIVRÉ et poussé sur `main`.**
> Rien n'est en cours, l'arbre est propre. Ce document sert à reprendre le sujet
> sans relire la conversation — décisions prises, pièges rencontrés, restes.

Commits du chantier, dans l'ordre :

| commit | objet |
|---|---|
| `a5e9bea3` | Story écartée : le refus vit en base, borné sur la parution |
| `f658f624` | Lien Calendly prospect : le champ accepte un nom |
| `f84ee2f6` | Deux portes pour créer une séquence, et un badge qui dit vrai |
| `d26618ab` | Le badge « Pas de lead magnet » ne s'adresse plus aux stories en séquence |

Chantier voisin (chat **Business micro**), à ne pas confondre : `aa425ce5`,
`115e66a5`, `23f4c9c5`.

---

## 1. LA CONTRAINTE QUI COMMANDE TOUT

**Un mot-clé ne peut vivre que sur une séquence.** Le webhook ne sait le lire que
par `ig_stories.sequence_id` → `story_sequences.lm_keyword`
(`lib/instagram-webhook-processor.ts:1271-1283`). **Aucun mot-clé n'est stocké sur
une story.** Une story sans `sequence_id` est muette : personne ne lui répondra
jamais.

Conséquence, et ce n'est pas un choix produit : poser un lead magnet sur une story
unique **crée une séquence à une story**. Tout le modèle en découle.

Corollaire pour le chat Business micro : leur garde
`!s.sequence_id && (s.lm_keyword || s.calendly_short_url)` était **indécidable par
construction**, pas seulement vide. Ils l'ont supprimée.

---

## 2. LE MODÈLE, TEL QUE CHRIS L'A ARBITRÉ

Huit décisions prises au `/grilling` du 2026-09-08. **Ne pas les rouvrir sans
raison neuve.**

1. **Deux portes, jamais trois.** Story seule → lead magnet uniquement (ce qui
   fabrique une séquence à une story). Multi-stories → les deux boutons de
   l'onglet Stories, et eux seuls.
2. **La sélection absorbe** les séquences qu'elle contient entièrement. Une
   séquence à une story n'est pas un objet voulu, c'est la conséquence technique
   d'un mot-clé : elle ne doit pas se comporter comme un obstacle.
3. **Badge story** : expirée si `posted_at + 24 h` dépassé **ou** `expired_at`
   posé.
4. **Badge séquence** : « En préparation » (aucune story), « Active », « Expirée ».
   Le **même mot** que les stories — « Terminée » aurait ajouté du vocabulaire
   pour la même idée.
5. **Onglet Calendly** visible tant qu'aucune story n'est rattachée (ou si un lien
   est déjà généré, pour pouvoir le recopier).
6. **Bouton « + »** retiré sur une story seule, **gardé** sur une séquence
   existante : c'est la seule porte de rattrapage.
7. **Deux CTA en lice** → on demande lequel garder, jamais d'abandon silencieux.
8. **Nom par défaut** « Story du 06/09 » quand la séquence n'a qu'une story.

---

## 3. OÙ VIT QUOI

### Règles extraites, avec leurs tests

| fichier | rôle | tests |
|---|---|---|
| `lib/etatStory.ts` | `etatStory`, `etatSequence`, `LIBELLE_ETAT` | 10 |
| `lib/absorptionSequences.ts` | `planifierAbsorption`, `messageRefusPartiel` | 13 |
| `lib/rattachementStories.ts` | `storiesARattacher`, `bornerArbitrage` | 13 |

Ces trois fichiers portent **la raison** de chaque règle en tête. Les lire avant
de toucher au sujet fait gagner une heure.

### Écrans

- `components/liens/PageLiens.tsx` — ~7 000 lignes. Repères :
  `storyUniqueLibre`, `calendlyDisponible`, `arbitrageSequence`,
  `ParcoursSequence`, `ETAPES_PARCOURS`, `Pastille`, `storeuseDuCta`.
- `app/api/client/story-sequences/route.ts` — POST (création + absorption),
  PATCH (rattachement, retrait, borne d'arbitrage).

### Migrations appliquées

- `20260907190000_story_sequences_stories_rattachees_le.sql` — **dépassée le jour
  même**, garder pour un rejeu depuis zéro.
- `20260907203000_story_sequences_arbitrage_parution.sql` — renomme en
  `stories_arbitrees_jusqua` et change la **nature** du contenu.

---

## 4. LES PIÈGES — à relire avant toute modification

### 4.1 La borne est une PARUTION, jamais l'heure du clic

Première version fausse : `stories_rattachees_le = now()`. La parution d'une story
est datée par **Instagram**, le clic par **notre serveur**, et le cron a du retard
entre les deux. Une story publiée depuis le téléphone pendant que l'écran est
ouvert précède donc le clic **sans avoir été affichée** — elle aurait été écartée
à vie sans jamais avoir été proposée.

La borne est le `posted_at` maximum des stories **arbitrées** — rattachées **et**
écartées. Les écartées sont indispensables : sans elles, écarter la story la plus
récente la fait revenir aussitôt.

Test qui fige ça : *« une story JAMAIS montrée n'est jamais écartée »*.

### 4.2 `expired_at` ne dit pas quand la story a expiré

Il dit quand le **cron l'a constaté**, et ce cron tourne une fois par semaine.
Mesuré le 2026-09-08 : **5 stories sur 8** affichaient « Active » à tort, et les 3
autres avaient reçu leur `expired_at` plus de 25 h après publication.

C'était la **troisième** fois qu'`expired_at` piégeait quelqu'un sur cet écran.
D'où l'extraction dans `lib/`.

### 4.3 `instagram_leads.story_sequence_id` est en `NO ACTION`

Postgres **REFUSE** de supprimer une séquence encore référencée. Deux effets :

- **L'absorption doit migrer les leads AVANT de supprimer.** L'ordre inverse
  échoue. Prouvé en base dans une transaction annulée : suppression avant
  migration refusée, après migration réussie.
- **Retirer la dernière story** d'une séquence qui a produit des leads est
  **refusé** avec un message. Les deux contournements perdent quelque chose :
  détacher efface l'origine des leads, garder une séquence vide fabrique un objet
  porteur d'historique que la règle des 7 jours (`fantome`, GET) finirait par
  masquer.

Voir la mémoire `reference-fk-no-action-avant-suppression`.

### 4.4 L'héritage doit être ENTIER

Reprendre le mot-clé seul donnerait une séquence qui **répond au prospect avec des
champs vides**. Le bloc transmis : mot-clé, `lm_id`, `lm_url` et les cinq messages.

### 4.5 Deux pertes silencieuses, deux garde-fous différents

- **Deux CTA en lice** → le serveur rend les prétendants (`conflitCta`), l'écran
  fait choisir.
- **Un seul CTA en lice** ne déclenchait aucun conflit — mais l'écran partait de la
  **première story cochée**. Si elle n'avait pas de mot-clé, le champ se
  pré-remplissait avec le premier lead magnet de la liste et enregistrer
  **écrasait** le mot-clé existant. D'où `storeuseDuCta`, qui repart de la story
  qui porte quelque chose, et l'annonce à l'écran.

---

## 5. CE QUI RESTE OUVERT

### 5.1 Non vérifié par Chris à l'écran

Le code est poussé et testé, mais **Chris n'a pas encore parcouru l'écran** depuis
la livraison. À regarder ensemble au prochain passage :

- les badges (« Active » / « Expirée » / « En préparation ») sur des données réelles ;
- le bandeau des trois étapes (`ParcoursSequence`) au clic sur « Nouvelle séquence
  · CTA lead magnet » ;
- **le parcours d'absorption de bout en bout** — cocher 4 stories dont une porte un
  mot-clé, vérifier que le bandeau de reprise s'affiche et que le lead suit ;
- le badge « CTA Calendly » qui remplace l'ambre sur une story en séquence :
  **Chris n'avait demandé que le retrait de l'ambre**, l'ajout est une initiative à
  valider ou retirer.

### 5.2 Résidu assumé, côté Business micro

La colonne **vues** d'une séquence reste un cumul all-time de ses stories, alors
que les autres colonnes suivent la période. Le borner demanderait des instantanés
par période côté route. C'est le moins faux des écarts — une story vit 24 h, ses
vues sont quasi définitives ensuite — mais ce n'est pas zéro.

### 5.3 Fermé depuis

- La date `2026-09-04` restante dans `story-sequences-stats/route.ts` : **corrigée**
  (0 occurrence au 2026-09-09).
- `lmDetectes` qui recomptait les personnes : **corrigé** par Business micro
  (`personnesReunies` dans `lib/attribution-roles.ts`, 3 tests). Vérifié : les deux
  colonnes l'utilisent, et `acquisitionParContenuGlobal` /
  `personnesParContenuAcquisition` partent de la **même expression exacte**, donc
  posts et séquences ne peuvent pas diverger.

---

## 6. CHANTIER VOISIN — « Lien Calendly prospect » (`f658f624`)

Fait dans la même session, sujet distinct.

Le champ demandait un pseudo Instagram avec une arobase en préfixe. Devant un
prospect rencontré ailleurs, le coach ne savait pas s'il était au bon endroit et
envoyait le lien Calendly brut — non tracké.

**Le moteur acceptait un nom depuis toujours** : `app/api/client/prospect-links`
retrouve la personne par `invitee_name` et lui crée une fiche `prospects`. Seul
l'écran l'interdisait. Corrigé côté textes uniquement.

Décision de Chris : **pas de troisième bac statistique** pour les prospects hors
réseaux. Les deux réponses ont été reformulées sans le mot « DM » (« Il est venu
vers moi » / « Je suis allé le chercher »), les bacs restent DM organique / Cold DM.
Coût assumé : une connaissance relancée apparaît en « Cold DM ».

`slugify` translittère désormais les accents (`Éric` donnait `prendre-rdv-ric-…`)
et traduit les ligatures avant `NFD`, qui ne les décompose pas.

---

## 7. MÉTHODE — ce qui a marché, et qu'il faut refaire

1. **Vérifier en base avant de conclure.** Chaque chiffre de ce document est
   mesuré, pas déduit. « 5 stories sur 8 », « 2 séquences à une story portant
   chacune un lead », « 0 paire concernée ».
2. **Prouver un ordre d'écriture en réel, sans rien laisser** : un bloc
   `do $$ … $$` qui crée le cas, tente les deux ordres, puis `raise exception`
   avec les constats — la transaction est annulée et le message porte le résultat.
3. **Relecture adversariale obligatoire.** Les deux défauts les plus graves de ce
   chantier (la borne `now()`, la FK `NO ACTION`) ont été trouvés sur du code déjà
   écrit, typé **et** construit.
4. **Extraire la règle dans `lib/` avec ses tests** dès qu'elle s'est trompée une
   fois. Un commentaire n'a pas suffi à empêcher `lmDetectes` — Business micro l'a
   transformé en fonction, c'est la bonne réponse.
5. **Ne pas croire les autres chats sur parole.** Leur travail était juste, sauf un
   point réel trouvé en lisant le code.

---

## 8. ATTENTION AU TRAVAIL PARALLÈLE

Plusieurs chantiers de Chris tournent en même temps sur ce dépôt. Pendant cette
session, `PageClientCalls.tsx`, `PagePipeline.tsx`, `pipeline/route.ts` et
`RapportModal.tsx` sont passés cassés puis réparés sans que ce chantier y touche.

**Règles :** vérifier `git branch --show-current` avant chaque commit, ne
committer que ses propres fichiers, ne jamais réparer le code cassé d'un autre
chantier — le signaler.
