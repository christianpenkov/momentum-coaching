# Handoff — Conversations DM dans Pipeline Leads, et la collecte du coach

> Écrit le 2026-09-09 pour reprendre le chantier dans un nouveau chat.
> Travail réalisé le 2026-09-08. **Tout est livré, poussé et vérifié en base.**
> Ce fichier remplace la conversation : il porte les décisions, les preuves et
> les pièges, pas seulement la liste des fichiers touchés.

---

## 0. Comment travailler avec Chris — à lire avant tout

Ces règles de forme ne sont pas négociables et ne se redemandent pas.

| Règle | Détail |
|---|---|
| **Français toujours** | Même pour les réponses techniques. Sans exception. |
| **`AskUserQuestion` pour toute question** | Avec des **aperçus ASCII** quand il y a un choix visuel. |
| **Il n'est PAS développeur** | Chaque question doit porter son contexte complet : ce que ça veut dire, l'impact d'usage, l'impact technique, l'impact business. Une question qui suppose qu'il connaît le code est une question ratée. |
| **Être proactif** | Recommander, argumenter, **le contredire quand il a tort**. Ne pas lui faire arbitrer un choix purement technique — appliquer d'office le critère « le plus robuste, zéro maintenance ». Ne le questionner que sur le **produit**. |
| **Plans courts, réponses directes** | Pas de circonlocutions. Proposer une action concrète après chaque analyse. |
| **Confirmation avant l'irréversible** | Toute action risquée ou destructrice se fait valider d'abord. |

---

## 1. Les règles du projet — ne pas les réapprendre à la dure

**Objectif permanent : zéro maintenance après livraison, robuste à 30-40 élèves.
Solide plutôt que rapide.**

**Aucune donnée inventée, simulée ou codée en dur.** Un `0` affirme quelque
chose ; un trou dit « on ne sait pas ». Les deux ne se remplacent pas.

| Domaine | Règle |
|---|---|
| Requêtes `calls` | Toujours `ignored is not true` **et** `call_type` explicite. `CALL_TYPES_VENTE = ['calendly', 'manual']` (`lib/callTypes.ts`) — **`manual` EST un appel de vente**. `'google'` = coaching. |
| `calls.coach_id` | C'est le **`profile_id` de l'élève**, pas le coach humain (`docs/calls-coach-id-piege.md`). |
| Migrations | Nouvelle colonne + backfill = **la même migration**. Un fichier appliqué par `apply_migration` doit porter **exactement** le même nom (hors horodatage), sinon `migrations_sante` signale un orphelin. |
| Droits SQL | **`revoke execute … from anon` seul ne fait RIEN** : PUBLIC garde EXECUTE et les rôles en héritent. Il faut `revoke … from public` puis `grant … to service_role`, **et vérifier avec `has_function_privilege`**. |
| Edge Functions | **Pas déployées par `git push`.** `npm run deployer-edge <nom>`, puis `npm run empreintes-edge -- --depuis-head`, et commiter `lib/empreintes-edge.generated.ts`. Vérifier un déploiement **par le contenu du bundle**, jamais par `updated_at` (il ment). |
| Debug | **Écrire en base**, jamais `console.log` ni les logs Vercel (plan Hobby = 1 h de rétention). |
| Déploiement | `git push origin main` uniquement. Jamais `vercel deploy --prod`. |
| Dépôt | **Il est PUBLIC.** Aucune valeur secrète dans un fichier versionné, migrations SQL comprises. |
| Avant de commiter | **Vérifier la branche** — une session parallèle peut la faire basculer. |
| TypeScript | Un `as` **retire la seule protection automatique** de TypeScript (`docs/requetes-qui-echouent-en-silence.md`). |
| Next.js | Lire `node_modules/next/dist/docs/` avant d'écrire du code Next. |

**⚠️ Chris travaille en parallèle dans un autre chat, sur les mêmes fichiers.**
Pendant cette session, mes fichiers ont été **absorbés dans un commit de l'autre
chantier** (`19b9ee61`). C'est documenté et normal : le contenu est bon, il porte
juste le mauvais message. **Ne pas re-commiter, ne pas toucher au code cassé
d'autrui.** Commiter en nommant explicitement ses propres chemins :
`git commit -F - -- <chemin> <chemin>`.

---

## 2. Ce qui a été livré — trois commits, tous poussés

### `18c1a5d5` — Le fil de DM dans la fiche de lead, et la collecte du coach

**Le bouton.** La fiche de détail d'un lead (panneau latéral du pipeline) porte
un bouton **« Conversation »** en bas, à gauche de « Fermer », encadré. Il ouvre
**le fil de cette personne, seul**, sans la colonne des autres conversations.

Rien de l'affichage n'a été réécrit : c'est le même `components/ig/ConversationsIg.tsx`,
avec une prop `peerId` qui filtre en base et retire la colonne de gauche. La
modale passe de 1500 à **860 px** — un fil seul dans 1500 px serait une colonne
de bulles perdue au milieu du vide.

Le bouton n'apparaît **que s'il y a un fil**. La route rend `conversationsPeerIds`
— une lecture pour tout l'écran, jamais une par fiche ouverte.

**La collecte du coach.** Elle n'avait jamais pu démarrer, en silence. La garde
d'écriture cherchait *« une ligne dans `clients` avec un accord »*, et un coach
n'est l'élève de personne : ses DM n'étaient jamais stockés, sans erreur, sans
alerte.

La question devient **`collecte_dm_ig_autorisee(profile_id)`** — accord de
l'élève **OU** compte propre du coach — écrite **une seule fois** et lue par
`enregistrer_message_ig`, `enregistrer_messages_ig_lot`, la route de reprise
d'historique et la vue de santé `ig_dm_sante`.

Décision de Chris : *« Collecte sans accord, c'est ses données »*. Aucun écran de
consentement à construire côté coach.

### `2072d7b1` — Vue liste : le libellé d'étape cassé dans les issues

`columns` servait à **deux** choses : construire les sections **et** traduire la
clé d'étape d'une ligne. `PagePipeline` la filtrait pour n'afficher qu'une case ;
la recherche du libellé ne trouvait alors plus rien et retombait sur la clé brute
(`call_booked` au lieu de « RDV pris »). Visible **uniquement en case isolée** —
c'est-à-dire exactement le geste qu'on fait pour regarder une issue.

Le filtrage descend dans la vue sous le nom **`caseIsolee`** : les sections se
réduisent, tous les libellés restent connus.

### `d89a8fcd` — La colonne annonce l'issue, pas l'étape

**Choix produit de Chris**, après que je lui aie recommandé l'inverse : un lead
classé affiche son **issue** (Closé, Perdu, No show, Pas qualifié, À recontacter)
dans « Étape actuelle ». Une ligne active n'a pas d'issue et garde son étape.

Mon argument était que la section au-dessus dit déjà « CLOSÉ » et que l'étape
apprenait quelque chose de plus. Il a tranché pour l'issue. **C'est sa décision,
ne pas la rouvrir.**

---

## 3. Les fichiers touchés

| Fichier | Ce qui a changé |
|---|---|
| `supabase/migrations/20260908200000_conversations_ig_du_coach.sql` | **NOUVEAU** — `collecte_dm_ig_autorisee`, les deux fonctions d'écriture, `ig_dm_sante`, l'amorce de `ig_backfill_etat` pour les coachs déjà connectés |
| `lib/identiteCoach.ts` | **NOUVEAU** — prénom + photo du coach, une seule définition pour les deux écrans |
| `components/ig/ConversationsIg.tsx` | props `peerId` (fil unique) et `avatarAuteurNotes` ; `BlocNote` rend la photo à la place du 📝 |
| `components/ig/ModaleConversationsIg.tsx` | passe `peerId`, `proprietaire`, `avatarAuteurNotes` ; largeur 860 en fil unique |
| `components/pipeline/ProspectDetailModal.tsx` | le bouton « Conversation », la prop `conversation`, et `echapDesactive` sur l'enveloppe |
| `components/pipeline/PagePipeline.tsx` | `conversationsAvecFil`, la prop `conversation`, `columns` non filtrée + `caseIsolee` |
| `components/pipeline/PipelineListView.tsx` | `caseIsolee`, `sections`, la colonne qui annonce l'issue |
| `components/pages/client/PageConversationsIg.tsx` | reçoit `coachAvatarUrl` |
| `app/api/client/pipeline/route.ts` | rend `profileId`, `conversationsPeerIds`, `coach` |
| `app/api/client/ig-dm-consentement/route.ts` | rend `coachAvatarUrl`, lit par `identiteDuCoach` |
| `app/api/instagram/backfill-conversations/route.ts` | la garde passe par la RPC partagée ; marqueur `leads_12_mois_sans_curseur_coach_inclus` |
| `app/api/oauth/instagram/callback/route.ts` | amorce `ig_backfill_etat` quand le profil est un coach |
| `app/api/sante/alerte-vues/route.ts` | le texte de `sante_ig_dm` suit la nouvelle règle |
| `docs/conversations-instagram.md` | la doc de référence (1448 l.) mise à jour : garde, troisième contexte, `prenomEleve`, la photo |

---

## 4. Ce qui est PROUVÉ, et comment

La discipline du **témoin positif** a été appliquée : un résultat vide ne prouve
rien tant qu'on n'a pas montré que l'instrument sait dire « oui ».

| Affirmation | Preuve |
|---|---|
| Le coach écrit maintenant | Appel réel de `enregistrer_message_ig` sur le profil coach → **1 ligne rendue**. Témoin supprimé ensuite, base revérifiée à 0. |
| Un élève sans accord reste refusé | Même appel sur Dolphin (sans accord) → **0 ligne**. |
| Les droits sont bien fermés | `has_function_privilege` : anon `false`, authenticated `false`, service_role `true`. |
| `ig_dm_sante` n'est pas muette | Sa branche 1 rejouée avec une fenêtre élargie → **elle émet une ligne**. Vide = santé réelle, pas requête cassée. |
| Les fiches qui porteront le bouton | 6 fils sur le compte de test Christian, **tous** appariés à un lead : `thejacobroach`, `incogniton.734`, `dolphin.2089562`, `rdjdkzjd`, `galiamerdjanova`, `christian_penkov`. |
| La photo du coach s'affichera | Le coach de Christian est **Chris**, avec un `avatar_url` renseigné. CSP et `remotePatterns` autorisent déjà `*.supabase.co`. |
| Rien n'est cassé | `npx tsc --noEmit` propre, `npm run build` compilé, `npm test` → **fail 0**, migrations sans écart. |

**⚠️ Ce qui n'a PAS été vérifié : l'écran lui-même.** Aucun outil de navigateur
n'était disponible dans la session. Le bouton, la modale à 860 px, la photo dans
le bloc note et la colonne « Étape actuelle » **n'ont pas été vus**. C'est le
premier geste à faire en reprenant.

---

## 5. Ce qui reste ouvert

### À vérifier au navigateur (priorité 1)
Se connecter avec le compte élève de test (`reference_test_accounts.md`) et
regarder :
1. Pipeline Leads → ouvrir la fiche de `@rdjdkzjd` → le bouton **Conversation**
   est là, il ouvre le fil seul, la fiche reste ouverte derrière.
2. **Échap** ferme le fil **sans** fermer la fiche.
3. Dans le fil : une note de DM affiche **« Note de Chris »** avec sa **photo**
   à la place du 📝. La note épinglée en haut garde son 📌 (choix assumé).
4. Vue Liste → cliquer sur l'issue **Closé** → la colonne « Étape actuelle »
   affiche **« Closé »**, pas `call_booked`. Idem sur les 4 autres issues.

### Le coach n'a encore rien à voir
**Aucun coach n'a d'intégration Instagram** (vérifié le 2026-09-09 : 0). Donc
zéro lead, zéro fil côté coach. Le code est prêt ; à la connexion Instagram de
Quennel, la ligne `ig_backfill_etat` est semée et `poll-leads` lance la reprise
des **12 derniers mois**. **Rien à faire avant cette connexion — et surtout, ne
pas conclure que la fonctionnalité est cassée en voyant un écran vide.**

### Hors de ce chantier
- **Le bloc résumé Fathom dans le rapport de vente** : jamais construit. Fathom
  n'a de toute façon **jamais reçu d'enregistrement** — ni durée réelle, ni
  résumé, ni replay.
- **Le second handoff (Mes Stats)** appartient à l'autre chat.
- Le call `9c7ae4d0` (Incogniton, closé sans vente) **est réparé** : 1 deal,
  1,50 €. `ventes_sante_montants` est vide. Plus rien à faire ici.

---

## 6. Les pièges rencontrés — ils se reproduiront

**Une garde formulée sur `clients` exclut le coach en silence.** Il n'a pas de
ligne dans cette table. Toute règle du type « existe-t-il une ligne `clients`
pour ce profil ? » traite un coach comme un refus, sans erreur. Chercher ce
motif ailleurs avant de conclure qu'une fonctionnalité « ne marche pas pour le
coach ».

**Une même liste qui sert à filtrer ET à traduire.** C'est la cause exacte du
`call_booked` affiché. Quand un appelant filtre une liste pour l'affichage, tout
autre usage de cette liste perd des entrées **sans erreur** — il retombe sur un
repli. Séparer les deux usages, ou descendre le filtrage dans le composant.

**Deux écoutes d'Échap sur la même touche.** Le panneau écoute sur `document`,
`ModalShell` sur `window` : les deux se déclenchent, et fermer la modale fermait
aussi la fiche. Vérifier systématiquement quand on imbrique une modale dans un
panneau.

**`prenomEleve` ne désigne pas l'élève.** Malgré son nom, la prop désigne
**l'autre partie** — l'élève quand le coach regarde, le coach quand l'élève
regarde. Lui passer le nom affiché de la fiche produisait « Note de
@pseudo_du_prospect » : la note attribuée à la personne dont elle parle.

**Un `.filter()` sur un tableau de props se corrige chez l'appelant OU chez
l'appelé, jamais entre les deux.** Le choix retenu : la prop reste entière et
porte une contrainte écrite dans son commentaire (« TOUTES les cases, jamais un
sous-ensemble »).

---

## 7. Où reprendre

L'arbre est **propre**, `main` est **synchronisé** avec `origin`, `tsc` est
**vert**, `npm test` passe.

Le chantier demandé par Chris est **terminé**. La reprise consiste à :
1. Faire les 4 vérifications au navigateur de la section 5.
2. Attendre la connexion Instagram de Quennel pour éprouver le côté coach.

S'il reste un doute sur une décision, la source de vérité est
**`docs/conversations-instagram.md`** — mise à jour dans ce chantier, et lecture
obligatoire selon `AGENTS.md` avant de toucher aux conversations.
