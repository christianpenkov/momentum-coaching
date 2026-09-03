# Transférer Momentum vers d'autres comptes

**Document autonome.** Il sera lu un jour de stress, peut-être par quelqu'un qui n'a
aucun contexte. Tout ce qu'il faut savoir est ici ou nommé ici.

Écrit le **2026-09-03**. Toutes les mesures qu'il contient ont été prises ce jour-là,
sur le projet réel.

---

## 0. La décision, en dix lignes

**On TRANSFÈRE les projets. On ne les reconstruit pas.**

Supabase et Vercel savent tous les deux déplacer un projet d'un compte à un autre en
gardant tout : l'identifiant du projet, son URL, ses clés, ses utilisateurs, ses
fichiers, ses variables, ses crons, ses fonctions. La bascule dure quelques minutes et
ne coupe rien.

Ce que ça change : **cinq des six points de casse redoutés disparaissent purement et
simplement**, parce que rien ne change d'adresse. Les liens de bio des élèves ne sont
pas touchés. Les URL de stockage restent valides. Les Edge Functions restent en place.
Les secrets restent posés. Le service worker installé sur les téléphones continue de
parler au bon serveur.

Il reste : trois transferts à déclencher (Supabase, Vercel, GitHub) et quelques comptes
tiers. **L'application Meta — la seule chose qui pouvait coûter des semaines — a été
écartée le 2026-09-03 : elle reste chez Chris, qui en reste administrateur** (§5 phase 3).

👉 **Le mode d'emploi à dérouler le jour J est en §12.** Le reste de ce document explique
*pourquoi*, et sert le jour où quelque chose ne se passe pas comme prévu.

> ⚠️ **Une réponse trouvée en ligne le 2026-09-03 affirmait que « Supabase ne propose
> pas de bouton pour transférer un projet d'un compte à un autre ».** C'est faux. La
> fonction existe, elle est documentée
> ([Project Transfers](https://supabase.com/docs/guides/platform/project-transfer)),
> et elle préserve l'identifiant du projet. Suivre cette réponse aurait fait choisir la
> voie la plus longue et la plus risquée — celle du plan B ci-dessous — sans aucune
> raison. **Une affirmation qui retire une option est plus dangereuse qu'une
> affirmation qui en ajoute : la seconde se heurte à la réalité dès qu'on l'essaie, la
> première ne se heurte à rien, parce qu'elle autorise à ne pas essayer.**

---

## 0 bis. Combien de temps ça prend

Deux durées, à ne jamais confondre : le **travail** (des mains sur le clavier) et
l'**attente** (des tiers qui valident, des crons qui passent).

| Étape | Travail effectif | Attente incompressible |
|---|---|---|
| Acheter le domaine définitif | 15 min | propagation DNS : quelques heures |
| Basculer l'origine du Click ID (§3, à froid) | **1 h**, lots compris | 48 h avant de retirer l'ancien domaine |
| Le repreneur crée org Supabase + équipe Vercel + compte GitHub, et invite Chris | 30 min (de son côté) | le temps qu'il s'y mette |
| Relevé de santé de référence | 10 min | — |
| **Transfert GitHub** | 5 min | acceptation de l'invitation |
| **Transfert Vercel** | 5 min | 10 s à 10 min de bascule |
| **Transfert Supabase** | 5 min | quelques minutes |
| Rebrancher ce poste (`git remote set-url`, `vercel link`) | 10 min | — |
| Vérifications immédiates **V1 → V7** | 15 min | — |
| Comptes tiers : cron-job.org, Resend, et Stripe si on le déplace | **1 à 2 h** | — |
| Vérifications **V8 → V14** | 20 min | **24 h** (le temps qu'un cycle de crons passe) |
| **Applications OAuth (Meta, Google, Calendly, Fathom)** | ✅ **0** — décidé le 2026-09-03 : elles restent chez Chris | **0** |

**Le jour de la bascule proprement dite : moins d'une heure de travail, zéro coupure.**
Tout compris hors achat de domaine : **une demi-journée de travail, étalée sur 2 à 3
jours** à cause des attentes.

⚠️ **Ce qui pouvait faire dériver le calendrier en semaines, c'était le transfert de
l'application Meta** — la vérification d'entreprise du repreneur en est le préalable, et
elle ne dépend de personne ici. **Cette branche est fermée** : l'application reste chez
Chris (§5 phase 3). Ne pas la rouvrir sans relire l'encadré sur la contrepartie.

À titre de comparaison, le plan B (reconstruire sur un projet neuf, §8) demanderait
plusieurs jours de travail, une reconnexion par élève et par intégration, et porterait
un risque irréversible sur les liens de bio. **C'est le rapport 1 à 10 qui justifie tout
ce document.**

---

## 1. L'inventaire, re-mesuré le 2026-09-03

Le handoff qui a lancé ce travail donnait un inventaire « mesuré la veille, à vérifier ».
Il a été rejoué en entier. **Quatre chiffres sur onze étaient faux ou trompeurs** — ils
sont corrigés ici, et c'est cette version qui fait foi.

### La base

| Quoi | Valeur | Note |
|---|---|---|
| Tables `public` | 71 | |
| Vues `public` | 20 | dont **17** vues de santé |
| Fonctions `public` | 43 | |
| Policies RLS | 96 | |
| Triggers | **15** | ⚠️ le handoff disait 19 : c'est le compte d'`information_schema.triggers`, qui produit **une ligne par ÉVÉNEMENT**, pas par trigger |
| Jobs pg_cron | 10 | |
| Utilisateurs `auth.users` | 7 | dont 6 avec mot de passe, 6 confirmés, **auth par e-mail uniquement — aucun fournisseur social à reconfigurer** |
| Sessions actives | 52 | |
| Taille | 61 Mo | plan **gratuit**, plafond 500 Mo |
| Tables sans RLS | 0 | |
| Migrations en base | **283** | 114 fichiers dans le dépôt |
| Extensions | `pg_cron`, `pg_net`, `pg_stat_statements`, `pgcrypto`, `plpgsql`, `supabase_vault`, `uuid-ossp` | |
| Secrets dans le Vault | 1 | `push_webhook_secret` |
| Publications Realtime | `public.calls`, `public.client_notifications`, `public.messages` | ⚠️ à réactiver **à la main** dans le plan B |

### Le stockage — 9 buckets, 111 objets, ~27 Mo

| Bucket | Public | Objets | Poids |
|---|---|---|---|
| `avatars` | oui | 2 | 74 ko |
| `ig-stories` | oui | 2 | 1 Mo |
| `instagram-avatars` | oui | 7 | 42 ko |
| `instagram-post-thumbnails` | oui | 21 | 3 Mo |
| `resources` | oui | 14 | 3,7 Mo |
| `chat-medias` | **non** | 32 | 12 Mo |
| `depot-files` | **non** | 0 | — |
| `task-attachments` | **non** | 2 | 4,3 Mo |
| `voice-messages` | **non** | 31 | 2,7 Mo |

### Les secrets des Edge Functions — 21, dont 7 automatiques

⚠️ Le handoff disait « 6 automatiques, 15 posés à la main ». Le vrai compte est
**7 automatiques, 14 posés à la main**, et **2 des 14 ne sont lus par aucune fonction**.

| Secret | Posé par | Lu par |
|---|---|---|
| `SUPABASE_URL` | **auto** | les 11 fonctions |
| `SUPABASE_SERVICE_ROLE_KEY` | **auto** | les 11 fonctions |
| `SUPABASE_ANON_KEY` | **auto** | `refresh-ig-posts` |
| `SUPABASE_DB_URL`, `SUPABASE_JWKS`, `SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_SECRET_KEYS` | **auto** | personne |
| `CRON_SECRET` | main | les 11 fonctions |
| `NEXT_PUBLIC_PLATFORM_URL` | main | `notify-rapport`, `poll-leads`, `refresh-ig-posts`, `sync-stripe-payments` |
| `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | main | `call-reminders`, `installment-reminders` |
| `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` | main | `poll-leads` |
| `CALENDLY_CLIENT_ID`, `CALENDLY_CLIENT_SECRET` | main | `sync-calendly` |
| `FATHOM_CLIENT_ID`, `FATHOM_CLIENT_SECRET` | main | `fathom-cron-sync` |
| `STRIPE_SECRET_KEY` | main | `sync-stripe-payments` |
| `NEXT_PUBLIC_SUPABASE_URL` | main | **personne** — doublon inutile de `SUPABASE_URL` |
| `CALENDLY_WEBHOOK_SIGNING_KEY` | main | **personne** — le webhook Calendly est une route Vercel |

> Les deux dernières lignes ne sont pas des erreurs à corriger aujourd'hui, mais **ne
> pas les reposer** dans le plan B : reposer un secret inutile, c'est inscrire dans le
> nouveau projet une dette qu'on vient de payer pour découvrir.

### Vercel

31 variables d'environnement en production. Compte actuel :
`christianpenkov06-2255s-projects` (personnel), projet `momentum-plateforme`
(`prj_bJsNTFxTelIqO7DWcgd6E8J5rDTx`), plan **Hobby**.

Un domaine existe dans le compte — `momentun-plateforme.com` (avec la faute de frappe)
— mais il **n'est pas configuré** : aucun DNS ne pointe dessus, il ne sert rien.
La production vit entièrement sur `momentum-plateforme.vercel.app`.

### GitHub

`https://github.com/christianpenkov/momentum-coaching.git`, branche `main`, aucun
workflow d'intégration continue (`.github/` n'existe pas).

**Le handoff ne mentionnait pas GitHub du tout.** C'est pourtant le quatrième pilier :
sans lui, Vercel ne redéploie plus.

### Les jetons d'intégration — EN BASE, table `integrations`

⚠️ **Correction importante du handoff** : il annonçait que « ces jetons meurent tous »
si l'application OAuth change. C'est vrai pour six providers sur sept.

| Provider | Comptes | Nature du secret | Meurt si l'application OAuth change ? |
|---|---|---|---|
| `instagram` | 3 | `access_token` longue durée (rafraîchi par `poll-leads`) | **oui** |
| `google` | 2 | `refresh_token` | **oui** |
| `youtube` | 2 | `refresh_token` | **oui** |
| `calendly` | 1 | `refresh_token` | **oui** |
| `fathom` | 1 | `refresh_token` | **oui** |
| `stripe` | 1 | Stripe Connect | **oui** |
| `shortio` | 4 | **`api_key`, pas d'OAuth** | **non — survit à tout** |

Short.io n'est pas concerné : chaque élève pose sa propre clé d'API. Elle ne dépend
d'aucune application, d'aucun compte de plateforme, et **le transfert ne la touche pas.**

---

## 2. Pourquoi transférer, et pourquoi surtout pas reconstruire

Trois voies étaient envisageables. Une seule est disponible aujourd'hui, une est
possible mais coûteuse, une n'existe pas.

### ❌ Restaurer une sauvegarde — **cette option n'existe pas**

Le handoff la listait comme l'une des deux voies possibles. Elle est indisponible :

> **Le plan gratuit de Supabase ne produit AUCUNE sauvegarde automatique.**
> Les sauvegardes quotidiennes commencent au plan Pro. Et même sur Pro, elles
> **n'incluent pas les objets du Storage**
> ([Backups](https://supabase.com/docs/guides/platform/backups)).

Il n'y a donc rien à restaurer. Cette voie est fermée tant que le projet est sur le
plan gratuit, et elle ne serait de toute façon que partielle.

### ⚠️ Reconstruire sur un projet neuf (export / réimport) — le **plan B**

C'est la voie que décrivait la réponse trouvée en ligne. Elle marche, elle est
documentée
([Backup and restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)),
et elle est **beaucoup plus chère qu'elle n'en a l'air** : le projet change
d'identifiant, donc l'identifiant change **partout**, y compris dans des endroits que
le dépôt ne connaît pas. C'est le plan B, décrit en section 8. À n'utiliser que si le
transfert est refusé.

### ✅ Transférer les projets — le **plan A**

| | Supabase | Vercel |
|---|---|---|
| Existe ? | oui, entre **organisations** | oui, entre **équipes** |
| Conditions | être **propriétaire** de l'org source, **membre** de l'org cible | être **propriétaire** de l'équipe source, **membre** de l'équipe cible |
| Durée | quelques minutes | 10 s à 10 min |
| Coupure | 0 (1-2 min seulement en passant d'un plan payant au gratuit) | **zéro** |
| Identifiant du projet | **inchangé** | — |
| URL / clés d'API | **inchangées** | — |
| Nom du projet | — | **conservé**, sauf collision de nom |

**Ce que le transfert Supabase préserve** : le projet, sa base, ses clés d'API, son
URL et tous ses réglages se déplacent tels quels. Donc : les 7 utilisateurs et leurs
mots de passe, les 52 sessions ouvertes, les 9 buckets et leurs 111 fichiers, les 10
jobs pg_cron, le Vault, les 11 Edge Functions, les 21 secrets, les publications
Realtime. **Rien à refaire.**

**Ce que le transfert Vercel préserve** : les déploiements, les variables
d'environnement, les domaines et alias, le nom du projet, le lien vers le dépôt Git,
les réglages de sécurité, les Cron Jobs.
**Ce qu'il ne préserve pas** : les intégrations tierces (à réinstaller), les données de
Monitoring, et **les logs** — ce qui est sans conséquence ici, la rétention étant déjà
d'une heure sur Hobby.

### Ce que ça fait aux six points de casse du handoff

| Point de casse | Sous le plan A |
|---|---|
| 1. L'adresse est écrite dans chaque lien partagé | **neutralisé** — le nom du projet Vercel est conservé, donc l'origine ne change pas, donc aucun lien Short.io n'est à réécrire ⚠️ *sauf si le nom doit changer, voir §3* |
| 2. Le dépôt ne peut pas reconstruire la base | **sans objet** — on ne reconstruit rien |
| 3. Trois applications OAuth, dont une validée par Meta | **le seul vrai chantier** — il ne dépend ni de Supabase ni de Vercel, §5 |
| 4. Les crons vivent à deux endroits | pg_cron **part avec le projet** ; cron-job.org est un compte tiers, §5 |
| 5. Les Edge Functions ne partent pas avec `git push` | **sans objet** — elles ne bougent pas |
| 6. Les URL de Storage contiennent la référence du projet | **sans objet** — la référence ne change pas |

---

## 3. Le seul endroit où le plan A peut faire mal

> ⚠️ **Vercel impose un nouveau nom de projet si l'équipe cible possède déjà un projet
> nommé `momentum-plateforme`.** Un nouveau nom = une nouvelle adresse `*.vercel.app`
> = **tous les liens de bio des élèves cassent d'un coup**, et le lien de bio est le
> seul qu'aucune édition de publication ne rattrape.

C'est le seul échec irréversible de tout ce document. Deux parades, dans cet ordre de
préférence.

### Parade 1 (recommandée) — sortir l'origine du nom Vercel, avant le transfert

Aujourd'hui, `MOMENTUM_REDIRECT_ORIGIN` vaut `https://momentum-plateforme.vercel.app`,
donc l'adresse publiée dans chaque lien dépend du **nom d'un projet Vercel**. C'est
fragile par construction : un renommage, un transfert avec collision, un changement
d'équipe, et tout casse.

`docs/click-id.md` prévoyait déjà de basculer sur `https://prendre-rdv.app` avant la
livraison. **Faire cette bascule AVANT le transfert, pas après**, et le problème
disparaît définitivement : l'origine devient un domaine qu'on possède, indépendant de
tout hébergeur et de tout nom de projet.

La procédure est déjà écrite, elle ne se réinvente pas :
`docs/click-id.md`, section « La procédure complète, le jour où l'origine change ».
Dix étapes, ordre non négociable, et l'étape 8 (« relancer la simulation, elle doit
annoncer 0 lien à réécrire ») est la seule preuve qui fait autorité.

⚠️ Le domaine doit être **acheté et attaché des deux côtés** : il suit le projet lors
du transfert Vercel, mais il faut avoir décidé qui le paie (le compte qui le détient
sera facturé s'il a été acheté chez Vercel).

### Parade 2 (minimale) — vérifier le nom avant de cliquer

Avant de lancer le transfert Vercel : demander à l'équipe cible de confirmer
qu'**aucun projet ne s'appelle `momentum-plateforme`**. L'écran de transfert affiche le
nom retenu avant de valider — **s'il propose autre chose que `momentum-plateforme`,
s'arrêter et revenir à la parade 1.**

### Et les noms de domaine, alors ?

Question posée le 2026-09-03. Il faut distinguer trois objets qu'on appelle tous
« le domaine », et qui ne se comportent pas pareil.

| Objet | Transféré avec le projet ? | Détail |
|---|---|---|
| **`momentum-plateforme.vercel.app`** | ✅ **oui** — c'est un alias, et « domaines et alias » suivent le projet | Ce n'est **pas un domaine qu'on possède** : c'est un sous-domaine de `vercel.app`, dans un espace de noms mondial. Il suit le projet **tant que le projet garde son nom** — d'où tout le §3 |
| **`momentum-plateforme-…-christianpenkov06-2255s-projects.vercel.app`** | ❌ non, il change | Il contient le nom de l'équipe. **Aucun lien publié ne l'utilise**, donc sans conséquence |
| **Un vrai domaine acheté** (`prendre-rdv.app`, ou autre) | ✅ **oui** — Vercel le délègue à l'équipe cible | ⚠️ **l'enregistrement chez le bureau d'enregistrement ne bouge pas.** Vercel ne déplace que le rattachement. Qui paie le renouvellement reste à décider **hors de Vercel** |

**Donc oui : on peut transférer le domaine avec le projet.** Ce n'est pas ça qui pose
problème — c'est que l'adresse actuellement inscrite dans les liens des élèves est un
`*.vercel.app`, c'est-à-dire une adresse **dont le nom appartient à Vercel et dépend du
nom du projet.** C'est ça qu'il faut quitter, pas le compte.

> ⚠️ **Le domaine `momentun-plateforme.com` existe déjà dans le compte Vercel, mais il ne
> peut pas servir.** Relevé le 2026-09-03 : il est enregistré chez un bureau tiers,
> **aucun DNS ne pointe sur Vercel** (« This Domain is not configured properly »), il
> n'est **rattaché à aucun projet** — et il porte une **faute de frappe** :
> `momentu**n**` au lieu de `momentu**m**`.
>
> Il n'était de toute façon pas le bon choix pour la route `/r/`. `docs/click-id.md`
> tranche cette question depuis le 2026-08-31, et pour une raison de fond : le domaine
> servi aux liens partagés est **la seule chose que voit le prospect dans le funnel d'un
> coach**. Y afficher le nom de la plateforme ferait apparaître un outil là où le coach
> doit être seul en scène. D'où un domaine **neutre à dessein**, du type
> `prendre-rdv.app` — et **un seul pour tous les élèves**, jamais un sous-domaine par
> coach : à 40 élèves ce serait 40 domaines à brancher et renouveler.

---

## 4. Les conditions préalables — à régler à froid, sans urgence

Aucune de ces quatre lignes n'est technique. Toutes bloquent le jour J si elles ne sont
pas faites avant.

| # | Ce qu'il faut | Chez qui | Pourquoi ça bloque |
|---|---|---|---|
| P1 | Une **organisation Supabase** créée par le repreneur, avec Chris ajouté en **Administrator** | repreneur | le transfert exige d'être membre de l'org cible — et c'est aussi ce qui permet à Chris de continuer à travailler (§6) |
| P2 | Une **équipe Vercel au plan Pro**, avec Chris invité en membre | repreneur | ⚠️ voir l'encadré ci-dessous — c'est la seule condition qui **coûte de l'argent** et la seule qui n'a aucun contournement |
| P3 | Un **compte GitHub** | repreneur | Chris est **rajouté automatiquement** en collaborateur par GitHub (voir phase 1) ; rien à demander |
| P4 | Une **carte de paiement valide** sur l'équipe Vercel cible | repreneur | Vercel refuse le transfert sans moyen de paiement valide |

> 🔴 **P2 est le piège du jour J, et il n'a AUCUN contournement technique.**
>
> Sur Vercel, un compte **Hobby** est par définition un compte à **un seul utilisateur** :
> on ne peut y inviter personne, et il ne permet pas de collaborer sur un dépôt privé.
> Les membres n'existent que dans une **équipe**, et les équipes commencent au plan
> **Pro** (payant, au siège).
>
> Autrement dit : **si le repreneur reste en Hobby, Chris perd tout accès à Vercel le
> jour du transfert** — plus de `vercel env`, plus de lecture des variables, plus de
> réglage de domaine. Et ça ne se découvre qu'au moment où on cherche le bouton
> « inviter un membre », qui n'existe pas.
>
> Le plan Hobby **interdit de toute façon l'usage commercial**, ce qui règle le débat :
> la plateforme est un outil vendu à des clients. Et Pro apporte au passage ce qui manque
> aujourd'hui pour enquêter — **1 jour de rétention de logs au lieu d'une heure**.
>
> **À trancher avec le repreneur AVANT tout le reste**, parce que c'est la seule
> condition préalable qui engage une dépense.

#### Trois montages possibles côté Vercel — et pourquoi le premier est recommandé

La question a été posée le 2026-09-03 : « on ne peut pas juste utiliser le compte du
repreneur ? ». Si, techniquement. Voici les options, honnêtement.

> ✅ **D'abord, réduire le périmètre : la question ne se pose QUE pour Vercel.**
>
> | | Chris a-t-il besoin des identifiants du repreneur ? | Pourquoi |
> |---|---|---|
> | **GitHub** | **non** | GitHub ajoute **automatiquement** l'ancien propriétaire comme collaborateur du dépôt transféré. Chris pousse avec **son propre** compte, et c'est gratuit |
> | **Supabase** | **non** | l'invitation d'un membre en `Owner`, `Administrator` ou `Developer` existe **dès le plan gratuit** (seuls `Read-Only` et les rôles par projet demandent le plan Team). Chris garde **son propre** compte |
> | **Vercel** | **c'est le seul cas** | les membres n'existent que dans une équipe, et les équipes commencent au Pro |
>
> Autrement dit : **sur deux des trois piliers, chacun garde son identité sans rien
> payer.** Le débat ne porte que sur le troisième.

| | Montage | Ça marche ? | Ce que ça coûte vraiment |
|---|---|---|---|
| **1** | **Équipe Pro du repreneur, Chris invité en membre** | oui | le prix des sièges. **Chacun garde son identité**, Chris peut être retiré proprement le jour où il s'arrête, et les logs passent d'1 h à 1 jour de rétention |
| **2** | **Compte du repreneur partagé** (Chris se connecte avec ses identifiants) | oui, techniquement | ⚠️ une seule identité pour deux personnes : plus aucune trace de qui a fait quoi, la double authentification à partager, et **Chris est enfermé dehors** si le repreneur change son mot de passe. Sur un compte Hobby, s'ajoutent 1 h de rétention de logs et le risque de suspension (voir ci-dessous) |
| **2 bis** | **Le repreneur crée un jeton d'accès**, limité à ce projet, et le donne à Chris | oui | ✅ **la bonne version du montage 2** — détail ci-dessous |
| **3** | **Le projet reste sur le compte de Chris**, le repreneur ne prend que Supabase et GitHub | oui | ⚠️ **contraire au but** : le repreneur ne possède pas son hébergement, donc il reste dépendant de Chris pour toujours. Ça contredit frontalement « zéro maintenance après livraison » |

> 🔴 **Le montage 2 ne dispense PAS de payer, contrairement à ce qu'on croit d'abord.**
> Vercel définit l'usage commercial comme **« tout déploiement servant le gain financier
> de quiconque participe à sa production, y compris un salarié ou un prestataire payé
> pour écrire le code »**, et cite explicitement « être payé pour créer, mettre à jour ou
> héberger le site ». Freelance payé + coach qui facture ses élèves : **les deux
> critères sont remplis, deux fois.**
>
> Ce n'est pas une limite technique, c'est une règle d'usage — donc elle ne se manifeste
> par aucune erreur, jusqu'au jour où le compte est suspendu. **Et c'est déjà vrai
> aujourd'hui, avant tout transfert** : le projet tourne sur un compte Hobby personnel.
> Le transfert ne crée pas cette exposition, il donne l'occasion de la refermer.

#### Montage 2 bis — le jeton d'accès, si on ne veut pas payer un siège

**Ne jamais partager un mot de passe : partager un jeton.** Vercel sait émettre des
jetons d'accès personnels, et c'est ce qui rend le montage 2 acceptable.

Le repreneur, **une fois**, depuis son compte :

```bash
npx vercel tokens add "chris-momentum" --project momentum-plateforme
# le jeton en clair n'est affiche QU'UNE FOIS. Le copier tout de suite.
```

Chris, sur ce poste :

```bash
# a poser dans l'environnement du terminal, jamais dans un fichier versionne
export VERCEL_TOKEN=vcp_…
npx vercel env ls production      # fonctionne sans aucune connexion
```

Ce que ça change par rapport au partage d'identifiants :

| | Mot de passe partagé | Jeton |
|---|---|---|
| Double authentification | à partager | **rien à partager** |
| Accès à la boîte mail du repreneur | souvent nécessaire (code de connexion) | **jamais** |
| Portée | **tout le compte**, tous ses projets | **limitée à ce projet** avec `--project` |
| Le jour où on arrête | changer le mot de passe, et espérer qu'aucune session ne traîne | `npx vercel tokens rm <id>` — **révocation immédiate et totale** |
| Trace | aucune | le jeton est nommé, listé, daté |

⚠️ **Ce que le jeton ne donne PAS : le tableau de bord.** Les opérations qui n'existent
qu'à l'écran — le transfert lui-même (B2), le rattachement d'un domaine, la protection
de déploiement, la lecture confortable des journaux de compilation — demandent que le
repreneur soit au clavier. Ce sont des gestes rares : en régime de croisière, Chris
déploie par `git push` et lit la base, pas le tableau de bord Vercel.

⚠️ **Le jeton ne règle rien à la question de l'usage commercial** : elle porte sur le
plan, pas sur la façon de se connecter.

#### Recommandation

**Montage 1 si le repreneur accepte le Pro** — c'est de toute façon ce que les règles
d'usage imposent, et ça donne à chacun son identité.

**Sinon, montage 2 bis, jamais le montage 2 nu.** Un jeton nommé, limité au projet et
révocable en une commande fait exactement le même travail qu'un mot de passe partagé,
sans aucun de ses inconvénients — et sans jamais empêcher Chris de travailler le jour où
le repreneur change ses identifiants.

> **Sur « et le jour où on n'en a plus besoin, j'arrête, c'est tout » :** oui, et c'est
> vrai des trois montages. La sortie est propre partout — retirer un membre, révoquer un
> jeton, ou ne plus se connecter. **Ce n'est pas le critère qui départage.** Ce qui
> départage, c'est ce qui se passe **pendant**, pas à la fin : qui est bloqué si l'autre
> change son mot de passe, et ce qui arrive si le compte est suspendu pour usage
> commercial sur un plan qui l'interdit.

**Deux blocages possibles côté Supabase**, à vérifier avant :
- le transfert est **refusé si une intégration GitHub est active** sur le projet
  Supabase. Vérifié le 2026-09-03 : **aucune branche Supabase n'existe** (`list_branches`
  renvoie vide), donc a priori aucune intégration — mais **le confirmer dans le
  tableau de bord**, c'est une question à un clic ;
- l'org cible sur le plan gratuit est limitée à **2 projets gratuits**.

---

## 5. Plan A — la procédure, dans l'ordre

L'ordre est contraint par une seule règle, la même que pour le Click ID :
**à aucun instant un élève ne doit se retrouver devant quelque chose qui ne répond pas.**

### Phase 0 — à froid, jours ou semaines avant (aucune coupure)

**0.1 — Basculer l'origine du Click ID sur le domaine définitif.**
Voir §3, parade 1, et `docs/click-id.md`. C'est la seule opération de tout ce document
qui touche des liens publiés : elle se fait **à part, à tête reposée**, jamais le même
jour que le reste. Une fois faite, plus rien du reste ne peut casser un lien de bio.

**0.2 — Régler les quatre conditions préalables** de la §4.

**0.3 — Relever l'état de santé de référence.** On ne peut pas savoir ce que la bascule
a cassé si on ne sait pas ce qui n'allait déjà pas. Relevé du 2026-09-03, à rejouer la
veille :

```sql
select count(*) from cron_runs;                                    -- 0
select count(*) from ventes_sante_montants;                        -- 0
select count(*) from stripe_sante_rattachement;                    -- 0
select count(*) from ventes_sante_sur_encaissement;                -- 0
select count(*) from ig_sante_periodes where etat like 'ALERTE%';  -- 0
select count(*) from crons_sante where etat like '%SILENCIEUX%';   -- 0
select count(*) from acces_sante_lecture;                          -- 0
select count(*) from edge_sante_version where etat like 'ALERTE%'; -- 0
select count(*) from migrations_sante;                             -- 0
select count(*) from alertes_plateforme;                           -- 0
select etat from base_sante_taille;                                -- 'ok'
```

⚠️ **Trois lignes `integration deconnectee` sont attendues** et ne sont PAS des
anomalies (une dans `yt_sante_donnees`, deux dans `integrations_sante` pour `instagram`
et `youtube`) — voir la dernière ligne d'`AGENTS.md`. Les compter comme des pannes fait
remonter des faux positifs.

**0.4 — Prendre une photo des comptes tiers** (§5, phase 3) : qui détient quoi, avec
quel e-mail. La moitié des blocages du jour J sont des mots de passe qu'on n'a pas.

### Phase 1 — GitHub (aucun impact production)

**Point rassurant à connaître avant de commencer :** casser le lien Git ne fait pas
tomber le site. Vercel continue de servir le dernier déploiement de production. Ce
qu'on perd, c'est la capacité à en publier un nouveau — jamais le site lui-même.

**GitHub est l'étape la plus simple des trois**, et deux comportements de la plateforme
l'expliquent :

- ✅ **« The original owner of the repository is added as a collaborator on the
  transferred repository. »** Chris est donc rajouté **automatiquement** comme
  collaborateur : il n'y a rien à demander, et le droit d'écriture est là par défaut sur
  un dépôt personnel.
- ✅ **Les anciennes URL redirigent.** `git clone`, `git fetch` et `git push` sur
  l'ancienne adresse sont redirigés vers la nouvelle. Le poste continue donc de
  fonctionner même si on oublie le `set-url` — ce n'est pas une raison pour l'oublier,
  mais ça veut dire qu'aucune fenêtre de casse n'existe.

Sont également conservés : l'historique, les issues, les pull requests, le wiki, les
webhooks, les clés de déploiement et les secrets Actions (il n'y en a aucun ici).

1. Sur GitHub : *Settings → Danger Zone → Transfer ownership* vers le compte du
   repreneur. ⚠️ **Le compte destinataire ne doit pas déjà posséder un dépôt nommé
   `momentum-coaching`.**
2. Le repreneur accepte l'invitation.
3. Sur ce poste :
   ```bash
   git remote set-url origin https://github.com/<nouveau-proprietaire>/momentum-coaching.git
   git remote -v            # ne prouve rien : affiche ce qu'on vient d'ecrire
   git fetch origin         # prouve la LECTURE
   git push origin main     # prouve l'ECRITURE — le seul test qui compte
   ```
   ⚠️ **`git fetch` ne prouve pas le droit d'écriture.** Un collaborateur en lecture
   seule voit `fetch` réussir et `push` échouer. C'est le refus le plus déroutant, parce
   que tout **semble** fonctionner. Faire un `push` réel (le commit vide de l'étape 2.5
   convient).

### Phase 2 — Vercel, puis Supabase

**2.1 — Vercel.** *Project Settings → General → tout en bas → Transfer Project.*
Choisir l'équipe cible. **Lire l'écran de confirmation** : il liste les domaines,
alias et variables transférés, et **le nom retenu**.

> 🛑 **Si le nom proposé n'est pas `momentum-plateforme`, ANNULER.** Voir §3.

Pendant le transfert (10 s à 10 min), on ne peut ni déployer, ni modifier les réglages,
ni supprimer le projet. Aucune coupure pour les élèves.

**2.2 — Reconnecter le dépôt Git** si le lien a sauté (il saute si le dépôt a changé de
propriétaire à la phase 1) : *Project Settings → Git → Connect Git Repository*. Le
repreneur devra autoriser l'application GitHub de Vercel sur son compte.

**2.3 — Vérifier immédiatement les 31 variables d'environnement** :
```bash
npx vercel env ls production      # doit rendre 31 lignes
```
Elles sont copiées par le transfert, mais on ne le suppose pas — on le regarde.

**2.4 — Supabase.** *Project Settings → General → Transfer Project* vers
l'organisation du repreneur.

**2.5 — Redéployer une fois**, à vide, pour prouver que la chaîne
`git push → GitHub → Vercel → production` fonctionne de bout en bout :
```bash
git commit --allow-empty -m "Verification de la chaine de deploiement apres transfert"
git push origin main
```

### Phase 3 — les comptes tiers (le vrai travail)

Rien de tout ça ne bouge avec Supabase ou Vercel. Chaque ligne est un compte séparé.

| Compte | Ce qu'il détient | Comment le passer | Risque |
|---|---|---|---|
| **Meta / Instagram** | l'application, ses 4 permissions approuvées le 2026-08-25, le webhook | **décision prise : l'application RESTE chez Chris, qui en reste administrateur** → **rien à faire** | 🟢 **aucun** |
| **Google Cloud** | client OAuth YouTube + Google Calendar | ajouter le repreneur en propriétaire du projet Google Cloud — le client OAuth ne bouge pas, donc **les jetons survivent** | 🟢 faible |
| **Calendly** | l'application OAuth développeur | transférer ou partager le compte développeur | 🟠 moyen |
| **Stripe** | la plateforme **Connect** (`STRIPE_CLIENT_ID`) | ⚠️ changer de plateforme Connect oblige **chaque élève à reconnecter Stripe**, et les encaissements passés restent sur l'ancienne plateforme | 🔴 **élevé** |
| **Fathom** | l'application OAuth | transférer ou partager | 🟠 moyen |
| **cron-job.org** | les **9 jobs** hors de la base | soit passer le compte, soit **recréer les 9 jobs** — leurs URL ne changent pas sous le plan A, la recréation est mécanique (tableau dans `AGENTS.md`) | 🟢 faible |
| **Resend** | `RESEND_API_KEY`, l'envoi des e-mails d'alerte | poser la clé du repreneur dans Vercel | 🟢 faible |
| **Short.io** | rien de central | ⚠️ **chaque élève a sa propre clé d'API, stockée en base. Rien à faire.** | 🟢 aucun |

#### ✅ L'application Meta — décision prise le 2026-09-03 : elle ne bouge pas

**Chris reste propriétaire et administrateur de l'application Meta.** C'est la décision,
et elle supprime d'un coup le seul élément du chantier qui pouvait coûter des semaines.

Conséquences, toutes bonnes :

- **rien à faire** sur Meta le jour du transfert ;
- **les 3 jetons Instagram survivent** — aucun élève n'a à reconnecter son compte ;
- **l'abonnement au webhook Meta reste valide**, puisque son URL de rappel ne change pas
  (elle est construite sur `NEXT_PUBLIC_PLATFORM_URL`, inchangée sous le plan A) ;
- **aucune fenêtre sans portefeuille**, aucune vérification d'entreprise à attendre.

Le même raisonnement s'applique **une intégration à la fois** : tant qu'une application
OAuth reste sur le compte de Chris, ses jetons survivent et personne ne reconnecte rien.
C'est vrai pour Google/YouTube, Calendly et Fathom. **Stripe est le seul cas où la
question se pose vraiment**, parce que c'est là que passe l'argent — voir le tableau
ci-dessus.

> ⚠️ **La contrepartie, à énoncer une fois et à assumer.** Une application qui reste chez
> Chris est une dépendance permanente de la plateforme à un compte personnel : si ce
> compte est fermé, suspendu ou perdu, les intégrations concernées tombent, et le
> repreneur ne peut rien y faire. C'est un arbitrage parfaitement raisonnable
> aujourd'hui — c'est l'inverse qui coûterait des semaines — mais ça contredit à terme
> l'objectif « zéro maintenance après livraison ». **À rouvrir le jour où la plateforme
> ne dépendra plus de Chris, pas avant.**

Le reste de cette sous-section ne sert que **si cette décision change un jour.**

**Ne pas créer une nouvelle application.** Refaire l'App Review a pris des semaines, et
`reference_meta_acces_avance` documente un mode de panne invisible : perdre la
publication sur `instagram_business_basic` coupe **tous les comptes sauf celui de
l'administrateur**, pendant que les jetons continuent de se rafraîchir comme si de rien
n'était.

Ce qui est établi sur le transfert d'une application Meta :

- une application n'est rattachée qu'à **un seul Business Portfolio à la fois** ;
- le transfert se fait en deux temps : le portefeuille d'origine **retire**
  l'application, puis le portefeuille cible la **réclame** ;
- il faut être **administrateur de l'application ET du Business d'origine** ;
- ⚠️ **si le portefeuille qui réclame l'application n'est pas rattaché à une entreprise
  vérifiée, l'application perd les permissions qui exigent la vérification
  d'entreprise** — et les permissions Instagram en font partie.

Trois conséquences, à traiter dans cet ordre :

1. **La vérification d'entreprise du repreneur doit être FAITE et VALIDÉE avant de
   retirer l'application.** Elle prend elle-même des jours. C'est le seul élément du
   projet dont le délai ne dépend de personne ici.
2. **Il existe une fenêtre entre le retrait et la réclamation** où l'application n'a
   plus de portefeuille. Ne pas l'ouvrir un vendredi soir.
3. **Se demander d'abord si le transfert est nécessaire.** Ajouter le repreneur comme
   **administrateur de l'application** lui donne le contrôle sans rien déplacer et sans
   aucun risque. Le transfert n'est indispensable que si l'application doit changer
   d'entité juridique.

> **La bonne question n'est pas « comment transférer l'application Meta ? » mais
> « faut-il la transférer ? ».** Tant que la réponse n'est pas un oui argumenté, la
> réponse par défaut est : **on ajoute un administrateur, on ne touche à rien.**

---

## 5 bis. Les crons et leur `CRON_SECRET` — sept endroits, zéro à changer

**Sous le plan A, aucun bearer n'est à changer.** C'est le point le plus contre-intuitif
du dossier, et il mérite d'être démontré plutôt qu'affirmé : le secret ne change pas
parce que **rien ne change d'adresse ni de clé**. Les jobs continuent d'appeler les mêmes
URL avec le même jeton, et les fonctions continuent de les accepter.

Ce qui a été **mesuré** le 2026-09-03 — une seule et même valeur vivait à **sept
endroits**, dont **trois en clair** :

| # | Où | Forme | Depuis le 2026-09-04 |
|---|---|---|---|
| 1 | Variable Vercel `CRON_SECRET` | chiffrée | inchangé |
| 2 | Secret Edge Supabase `CRON_SECRET` | chiffré | inchangé |
| 3 | `cron.job` → `call-reminders-15min` | ~~en clair dans la commande SQL~~ | ✅ **plus aucune copie** — lit le Vault |
| 4 | `cron.job` → `send-pending-dm3-1min` | ~~en clair~~ | ✅ **plus aucune copie** |
| 5 | `cron.job` → `process-webhook-queue-1min` | ~~en clair~~ | ✅ **plus aucune copie** |
| 6 | Vault → `push_webhook_secret` | chiffré | inchangé — **c'est désormais la source** |
| 7 | Les **9 jobs cron-job.org**, en-tête `Authorization: Bearer …` | **hors de tout dépôt et de toute base** | inchangé |

Vérifié par empreinte, pas par ressemblance : la valeur portée par les commandes pg_cron
était **exactement** le `CRON_SECRET` de Vercel, et son SHA-256 **exactement** l'empreinte
publiée pour le secret Edge et pour celui du Vault. Sept copies d'une seule valeur, pas
sept valeurs qui se ressemblent.

**Il en reste quatre**, dont une seule en clair — et elle est hors de portée d'un dépôt.

> ⚠️ **Rien ne les synchronise.** Le jour où ce secret sera tourné, il faudra le changer
> aux quatre endroits restants, dont le quatrième ne se lit nulle part ailleurs que dans
> l'interface de cron-job.org. En rater un ne casse pas tout : ça casse **un seul**
> chemin, en silence. Un DM3 qui ne part plus, ou une notification push qui n'arrive
> plus, sans aucune erreur nulle part.

### 🔴 L'incident du 2026-09-04 — le secret était public

**Le dépôt GitHub est public** (`private: false`, vérifié auprès de l'hébergeur, créé le
2026-05-18). Deux migrations du 19 août portaient le `CRON_SECRET` **en clair**, parce
qu'elles inscrivaient un job pg_cron avec son en-tête `Authorization` écrit
littéralement :

```
supabase/migrations/20260819000007_dm2_fields_and_dm3_delay.sql   → HTTP 200, secret présent
supabase/migrations/20260819000009_webhook_queue.sql              → HTTP 200, secret présent
```

Prouvé par la conséquence, pas déduit d'un réglage : les deux fichiers se récupéraient
**sans aucune authentification**.

⚠️ **Le contrôle habituel était vert et sans rapport avec la question.** Aucun fichier
`.env` suivi, aucun dans l'historique, règles d'ignorance correctes. Le secret n'a pas
fui par le fichier prévu pour les secrets : **il a fui par du SQL**, écrit par quelqu'un
qui pensait écrire du SQL. Il n'a été trouvé qu'en balayant tout l'historique **par
valeur** :

```bash
git log --all --oneline -S"<valeur>"     # une valeur, pas un nom de fichier
```

**Ce que ce jeton ouvre** : il est l'**unique** rempart des 11 Edge Functions — toutes
déployées en `verify_jwt: false` — et de 21 routes Vercel, dont `/api/push/webhook` et
`/api/push/send`. Preuve non destructive de leur joignabilité, avec un jeton
volontairement faux :

```
send-pending-dm3 → 401     poll-leads → 401     sync-stripe-payments → 401
```

401 et non 404 : les endpoints répondent depuis Internet, et seule la valeur du jeton les
sépare de l'envoi de DM depuis les comptes Instagram des élèves, de notifications push
sur tous les téléphones, ou de l'avancement du filigrane de `sync-stripe-payments`.

#### Ce qui a été fait le 2026-09-04

**La cause est fermée** (migration `20260904000000_secret_cron_hors_des_fichiers.sql`) :

- une fonction `public.declencher_cron(p_nom text)`, `SECURITY DEFINER`, lit le secret
  dans le Vault et l'attache à l'appel ;
- les 3 jobs pg_cron ne portent plus qu'un **nom** :
  `select public.declencher_cron('send-pending-dm3');` ;
- les deux fichiers de migration fautifs sont **expurgés**, avec l'explication en place.

⚠️ **Elle prend un NOM, pas une URL.** Une fonction `declencher_cron(url text)` aurait
été plus souple et bien pire : `SECURITY DEFINER`, elle attache le secret à l'URL qu'on
lui donne, et Supabase la grante à `anon` par défaut — on aurait remplacé une fuite
passive par une fuite active. Elle résout donc l'URL dans une **liste fermée** écrite
dans son corps, et le `revoke execute … from public, anon, authenticated` est posé
par-dessus. **Les deux, pas l'un ou l'autre.**

Vérifié après coup, pas supposé :

| Contrôle | Résultat |
|---|---|
| `has_function_privilege('anon', …, 'EXECUTE')` | `false` |
| `has_function_privilege('authenticated', …, 'EXECUTE')` | `false` |
| `crons_passages` — `send-pending-dm3` et `process-webhook-queue` | **passage réel après la migration** (chemin Edge en POST **et** chemin Vercel en GET) |
| Le secret dans les fichiers suivis | **absent** |

#### Ce qui RESTE à faire — la rotation

⚠️ **La cause est fermée, la fuite ne l'est pas.** La valeur est toujours dans
l'historique git d'un dépôt public : **seule sa rotation la rend inoffensive.**

**Étape 0, à faire en premier, un clic :** passer le dépôt en privé. Ça n'invalide pas ce
qui a déjà été copié, mais ça arrête l'exposition. *(Un compte Hobby déploie bien son
propre dépôt privé ; la restriction Hobby porte sur la collaboration à plusieurs sur
dépôt privé — un argument de plus pour le Pro, §4.)*

**La rotation ne peut PAS être faite par une seule main**, et c'est le point à connaître
avant de commencer : les **9 jobs cron-job.org** ne se modifient que dans leur interface
web. Rien dans le dépôt, dans la base ou dans une API accessible ici ne peut les
atteindre.

Séquence, à dérouler **d'un seul tenant** :

| ☐ | Faire | Vérifier |
|---|---|---|
| ☐ 1 | Générer une nouvelle valeur (`openssl rand -hex 32`) | 64 caractères hexadécimaux |
| ☐ 2 | Vercel : `printf '%s' "<nouvelle>" \| npx vercel env add CRON_SECRET production` (⚠️ **`printf`, jamais `echo`**), après avoir retiré l'ancienne | `npx vercel env ls production` |
| ☐ 3 | **Redéployer** — une variable modifiée n'atteint pas un déploiement en ligne | statut `Ready` |
| ☐ 4 | Supabase : `npx supabase secrets set CRON_SECRET=<nouvelle> --project-ref nvjgwtetyuatnkjihmtw` | `npx supabase secrets list` |
| ☐ 5 | Vault : `select vault.update_secret(id, '<nouvelle>') from vault.secrets where name='push_webhook_secret';` → **couvre les 3 jobs pg_cron ET les deux triggers push d'un coup** | l'empreinte SHA-256 correspond à la nouvelle valeur |
| ☐ 6 | **cron-job.org : les 9 jobs, en-tête `Authorization`** — *seul Chris peut le faire* | les 9 sont à jour |
| ☐ 7 | Le lendemain : `select * from crons_sante;` | aucun `SILENCIEUX` |
| ☐ 8 | Le lendemain : `select * from cron_runs order by ran_at desc;` | aucun incident |

⚠️ **Entre l'étape 3 et l'étape 6, les crons prennent des 401.** C'est visible
(`crons_passages` cesse d'avancer) et auto-réparant (le passage suivant réussit une fois
l'étape 6 faite), mais ça veut dire qu'**il ne faut pas commencer sans pouvoir finir** :
les 7 Edge Functions pilotées par cron-job.org ne collectent plus rien pendant la
fenêtre. Faire les étapes 2 à 6 en une fois, pas en deux séances.

⚠️ **Ne pas oublier `push_webhook_secret` (étape 5).** C'est le même secret : l'oublier
ne casse pas les crons — ça casse **les notifications push**, en silence, et rien ne
relie l'un à l'autre.

**Nettoyage à faire pendant la rotation, tant qu'on y est** : le secret du Vault
s'appelle `push_webhook_secret`, un nom qui sous-décrit ce qu'il contient — c'est LA
valeur partagée par les crons **et** par le webhook push. Le renommer suppose d'éditer
`notify_push_on_message` et `notify_push_on_reaction` : à faire le jour où l'on touche
déjà à tout, jamais dans une migration qui répare autre chose.

**Donc, côté crons, le transfert ne demande qu'une seule décision : à qui appartient le
compte cron-job.org.** Deux réponses acceptables :

- **le passer au repreneur** (changer l'e-mail du compte) — les 9 jobs restent tels
  quels, rien à recréer ;
- **recréer les 9 jobs** dans un nouveau compte — leurs URL et leur bearer ne changent
  pas, c'est de la recopie mécanique. Le tableau complet est dans `AGENTS.md`, section
  « cron-job.org — hors de la base ».

⚠️ **Ne jamais faire tourner les deux comptes en parallèle « le temps de vérifier ».**
`AGENTS.md` le dit déjà pour une autre raison : deux passages simultanés lisent le même
drapeau d'idempotence avant que l'un ne l'écrive, et **la notification part en double**.

⚠️ Après bascule du compte cron-job.org, la preuve n'est pas « les 9 jobs sont listés »
mais `select * from crons_sante;` sans aucune ligne `SILENCIEUX`, **le lendemain** — le
temps que chaque cadence ait eu son tour.

### Phase 4 — ce qui reste à corriger dans le code (petit, mais réel)

Même sous le plan A, quatre valeurs codées en dur deviennent fausses ou trompeuses.
Aucune ne casse la production ; toutes mentent à celui qui les lira plus tard.

| Fichier | Ligne | Valeur | Effet sous le plan A |
|---|---|---|---|
| [app/api/sante/alerte-stockage/route.ts](../app/api/sante/alerte-stockage/route.ts#L41) | 41 | lien vers le tableau de bord Supabase | ✅ reste juste (l'identifiant ne change pas) |
| [app/api/sante/alerte-vues/route.ts](../app/api/sante/alerte-vues/route.ts#L50) | 50 | `PROJET_SUPABASE` | ✅ reste juste |
| [public/sw.js](../public/sw.js#L16) | 16-17 | URL + clé anon | ✅ reste juste |
| [PROJET.json](../PROJET.json) | — | `supabase_ref`, Vercel, git remote | ⚠️ **à mettre à jour en premier** — `scripts/deployer-edge.mjs` la lit désormais ici (§6) |
| [lib/onboarding/integrationConfig.ts](../lib/onboarding/integrationConfig.ts#L122) | 122, 146 | « Accéder à momentum-plateforme.vercel.app » **en texte lu par l'élève** | ⚠️ **faux dès que le domaine définitif est en service** — à corriger avec la bascule 0.1 |

Et quatre replis silencieux, qui n'ont jamais servi et qui serviraient au pire moment :

```
supabase/functions/{poll-leads,notify-rapport,refresh-ig-posts,sync-stripe-payments}/index.ts
  const PLATFORM_URL = Deno.env.get('NEXT_PUBLIC_PLATFORM_URL') || 'https://momentum-plateforme.vercel.app';
```

⚠️ **Si le secret `NEXT_PUBLIC_PLATFORM_URL` venait à manquer, ces quatre fonctions
pointeraient sur l'ancienne adresse sans rien dire.** Sous le plan A le secret ne bouge
pas, donc le risque est nul aujourd'hui ; il devient réel au moindre changement de
domaine. C'est exactement le raisonnement de `docs/click-id.md` sur
`MOMENTUM_REDIRECT_ORIGIN` : **un repli inscrit une adresse que personne n'a décidée.**
Le bon comportement serait d'échouer bruyamment.

---

## 6. Garder la main depuis ce poste — après la bascule

C'est une exigence, pas un confort : tout doit pouvoir continuer exactement comme
aujourd'hui — modifier, déployer, interroger la base, lancer les scripts.

**Sous le plan A, l'installation locale ne change presque pas.** C'est l'autre grande
raison de préférer le transfert.

| Ce qu'on fait aujourd'hui | Après le plan A | Action |
|---|---|---|
| `.env.local` | **inchangé** — l'URL et les clés Supabase ne bougent pas | rien |
| `supabase/.temp/project-ref` | **inchangé** | rien |
| `npm run deployer-edge <nom>` | fonctionne (`REF_PROJET` toujours bon) | rien, **si** Chris est membre de l'org |
| Requêtes SQL / MCP Supabase | fonctionnent | Chris doit être **Administrator** de l'org cible (P1) |
| `git push origin main` | à repointer | `git remote set-url` + collaborateur écriture (P3) |
| `npx vercel env ls`, `vercel env pull` | à relier | `npx vercel link` (voir ci-dessous) + membre de l'équipe (P2) |
| `.vercel/project.json` | ⚠️ **périmé** — il contient l'ancien `orgId` `team_AXapxwtsI8F9IFjU8hWhE0Xo` | régénéré par `vercel link` |
| `node scripts/reecrire-liens-shortio.mjs` | fonctionne (clés Short.io en base, inchangées) | rien |

```bash
# apres le transfert Vercel, sur ce poste :
npx vercel login          # si besoin
npx vercel link           # choisir l'equipe du repreneur, puis le projet
npx vercel env pull .env.local   # ⚠️ ecrase .env.local : re-ajouter MOMENTUM_REDIRECT_ORIGIN a la main
```

> ⚠️ **`vercel env pull` écrase `.env.local`**, et `MOMENTUM_REDIRECT_ORIGIN` y a été
> ajoutée à la main, sous la ligne « Created by Vercel CLI ». Elle disparaîtra
> silencieusement, et `scripts/reecrire-liens-shortio.mjs` réécrira alors vers rien.
> **Copier `.env.local` avant tout `env pull`.**

### Et les AUTRES projets ne doivent jamais se mêler de celui-ci

C'est le risque symétrique, et il ne vient pas du transfert : il vient du fait que
**les outils en ligne de commande gardent leur session dans le compte, pas dans le
dossier.** Une seule connexion Supabase, une seule connexion Vercel, valables pour tous
les projets du poste. Le dossier ne porte que des pointeurs :

```
supabase/.temp/project-ref     → quel projet Supabase le CLI vise
.env.local                     → quelle base les scripts locaux lisent
.vercel/project.json           → quel projet Vercel, dans quelle équipe
git remote origin              → quel dépôt, donc quel déploiement
```

⚠️ **Rien ne garantissait que ces quatre pointeurs désignent le même projet.** Et un
pointeur qui en désigne un autre **ne produit aucune erreur** : la commande réussit, et
elle réussit ailleurs. C'est le pire mode de panne possible — une Edge Function déployée
dans la mauvaise base, ou pire, `reecrire-liens-shortio.mjs` qui réécrit les liens de bio
d'un autre compte, alors qu'un lien de bio ne se corrige pas en éditant une publication.

Le risque grandit avec le nombre de projets ouverts sur le poste, et il devient **certain
le jour du transfert** : les quatre pointeurs sont alors tous à repointer, et il suffit
d'en oublier un.

**La parade, mise en place le 2026-09-03 :** l'identité est déclarée une fois dans
`PROJET.json`, à la racine du dépôt, et tout le reste est vérifié contre elle.

```bash
npm run verifier-cible
```

Le contrôle tourne **tout seul**, sans rien à penser à faire :

| Où | Quand | Effet d'un écart |
|---|---|---|
| `npm run deployer-edge <nom>` | avant le `deno check` | **refus**, avec le pointeur fautif nommé |
| `scripts/reecrire-liens-shortio.mjs` | avant même la simulation | **refus** — une simulation sur la mauvaise base donne une liste juste pour le mauvais projet, ce qui est pire qu'une erreur |
| `npm test` | à la fin | **échec** |

⚠️ **Un pointeur ABSENT n'est pas un écart.** « Pas encore relié » échoue tout seul et
bruyamment au moment de s'en servir ; seul un pointeur **présent et différent** est une
contamination. Exiger une installation locale complète ferait échouer la vérification
chez quelqu'un qui ne déploie pas — donc ferait désactiver la vérification.

⚠️ **`REF_PROJET` n'est plus codée en dur dans `scripts/deployer-edge.mjs`** : elle est
lue dans `PROJET.json`. Une constante en dur et un lien CLI peuvent désigner deux projets
différents sans que rien ne le dise.

⚠️ **Ne jamais modifier `PROJET.json` « pour que ça passe ».** C'est la déclaration
d'identité, pas un paramètre de confort. On ne l'édite que quand le projet a *réellement*
changé de compte — et c'est alors **la première ligne de la procédure de transfert**, pas
la dernière.

**Le jour du transfert, `PROJET.json` est donc le premier fichier à mettre à jour**, avant
`git remote set-url` et `vercel link`. Le contrôle passe ensuite du statut de garde-fou à
celui de preuve : quand `npm run verifier-cible` est vert, les quatre pointeurs désignent
le nouveau projet, et on le sait au lieu de l'espérer.

Témoin positif joué le 2026-09-03 : trois pointeurs faussés volontairement, trois écarts
signalés, le quatrième resté juste déclaré juste. **Un instrument qui ne rapporte que des
absences n'a jamais prouvé qu'il détecte une présence.**

**Trois rôles, trois refus différents à connaître :**

- Supabase, rôle insuffisant → les requêtes MCP et le déploiement des Edge Functions
  échouent avec une erreur d'autorisation. Demander **Administrator**.
- Vercel, compte personnel côté repreneur → **on ne peut pas inviter Chris du tout.**
  Il n'y a pas de contournement : il faut une équipe.
- GitHub, collaborateur en lecture seule → `git fetch` marche, `git push` est refusé.
  C'est le refus le plus déroutant, parce que tout **semble** fonctionner.

---

## 7. La vérification d'après-bascule — des CONSÉQUENCES, jamais des intentions

Une variable posée, un secret présent, un job listé : ça ne prouve rien. Chaque ligne
ci-dessous teste un effet observable de bout en bout.

### Immédiatement (< 15 minutes)

| # | Ce qu'on fait | Ce qu'on doit voir | Ce que ça prouve |
|---|---|---|---|
| V1 | Ouvrir la plateforme, se connecter avec un compte de test | la connexion passe **sans redemander le mot de passe** | les utilisateurs et les sessions ont survécu |
| V2 | ```curl -sI "https://<origine>/r/verif?utm_source=ig&utm_medium=bio&d=<slug-calendly>" \| head -3``` | `302` + `location:` vers `calendly.com` | la route de redirection répond sur la bonne origine |
| V3 | **Cliquer le lien de bio depuis l'application Instagram, sur un téléphone** | arrivée sur Calendly | le seul lien qu'aucune édition de publication ne rattrape |
| V4 | Ouvrir une conversation, envoyer un message | il apparaît **sans rafraîchir** chez le destinataire | Realtime est actif sur `messages` |
| V5 | Ouvrir un fichier de `chat-medias` et une vignette Instagram | les deux s'affichent | Storage privé (URL signée) **et** public |
| V6 | `git commit --allow-empty` + `git push` | déploiement Vercel déclenché et réussi | la chaîne complète de livraison |
| V7 | ```select count(*) from acces_sante_lecture;``` | **0** | ⚠️ aucune donnée lisible depuis le navigateur sans RLS |

### Dans les 24 heures (le temps qu'un cycle passe)

| # | Ce qu'on fait | Ce qu'on doit voir | Ce que ça prouve |
|---|---|---|---|
| V8 | ```select * from crons_sante;``` | aucun `SILENCIEUX` | les 9 jobs cron-job.org **et** les 10 pg_cron tournent encore |
| V9 | ```select * from edge_sante_version;``` | aucune ligne `ALERTE%` | les fonctions en ligne sont celles du dépôt |
| V10 | Réserver un vrai rendez-vous sur un Calendly d'élève | la ligne apparaît dans `calls` au bout de 30 min max | `sync-calendly` — **le SEUL chemin d'écriture des rendez-vous** |
| V11 | Envoyer un message et regarder le téléphone | la notification push arrive, avec la pastille | VAPID + `notify_push_on_message` + le service worker installé |
| V12 | Faire un paiement de test | ```select * from stripe_sante_rattachement;``` reste **vide** | le webhook Stripe atteint bien la plateforme |
| V13 | ```select * from cron_runs order by ran_at desc;``` | vide | aucun incident journalisé |
| V14 | Vérifier la réception de l'e-mail quotidien de santé | il arrive | `/api/sante/alerte-vues` + Resend |

⚠️ **V10 et V12 ne sont pas facultatifs.** Ce sont les deux seuls chemins par lesquels
l'argent et les rendez-vous entrent dans la plateforme, et **aucun des deux ne prévient
quand il se tait** : un rendez-vous qui n'arrive pas ne produit aucune erreur, juste une
ligne qui n'existe pas.

⚠️ **V11 est le test le plus révélateur du plan B**, et c'est pour ça qu'il figure ici :
la chaîne push traverse un trigger Postgres, une URL en dur dans le corps d'une fonction
de la base, une route Vercel, les clés VAPID et le service worker installé sur le
téléphone. Si une seule maille a changé d'adresse, il échoue — en silence.

### Et si quelque chose casse

Le plan A est **réversible dans les deux sens** : un projet retransféré revient à
l'organisation d'origine avec les mêmes garanties. Ce n'est pas un aller sans retour.
Les deux seules choses qui ne se rejouent pas d'un clic : le retrait de l'application
Meta de son portefeuille, et une réécriture de liens Short.io — d'où le fait que ces
deux-là se font **à part et en premier**, jamais dans la même fenêtre que le reste.

---

## 8. Plan B — reconstruire sur un projet neuf

**À n'utiliser que si le transfert Supabase est refusé** (intégration GitHub active
impossible à retirer, quota de projets, refus de la plateforme).

Sous ce plan, **l'identifiant du projet change**, donc tout ce que la §2 déclarait
« sans objet » redevient vrai. Voici la liste exhaustive de ce qui casse, mesurée le
2026-09-03 — c'est le travail que le plan A permet d'éviter.

### B1 — Les valeurs en dur, dans les trois substrats

Un `grep` du dépôt ne suffit pas. L'identifiant se cache à **trois endroits**, et le
troisième est celui qu'on oublie : du code qui ne vit dans aucun fichier.

**Substrat 1 — le dépôt** (7 occurrences de l'identifiant) :

```
app/api/sante/alerte-stockage/route.ts:41    lien tableau de bord
app/api/sante/alerte-vues/route.ts:50        const PROJET_SUPABASE
public/sw.js:16-17                           SUPABASE_URL + SUPABASE_ANON_KEY  ← le plus dangereux
PROJET.json                                  supabase_ref  ← a changer EN PREMIER (§6)
supabase/.temp/*                             etat du lien CLI
supabase/migrations/20260819000007_*.sql:66  migration historique
components/analytics/PageClientStats.tsx     commentaire seulement
```

> 🔴 **`public/sw.js` est le point le plus vicieux du plan B.** Le service worker est
> **déjà installé sur les téléphones des élèves** avec l'ancienne URL et l'ancienne clé
> anon écrites dedans. Tant qu'il ne s'est pas mis à jour, il écrit dans l'ancien
> projet. Et l'ancienne clé anon reste publiée dans un fichier servi à tout le monde.
> Il ne sert qu'à écrire des logs techniques (`sw_logs`) — mais **ne pas supprimer
> l'ancien projet avant que tous les appareils aient renouvelé leur worker.**

**Substrat 2 — les VALEURS en base.** Balayage de toutes les colonnes texte/jsonb :
**1 052 lignes portent une URL absolue de Storage** contenant l'identifiant du projet.

| Table.colonne | Lignes |
|---|---|
| `analytics_ig_posts_history.thumbnail` | 952 |
| `messages.audio_url` | 48 |
| `ig_post_vignettes.url` | 17 |
| `messages.thumbnail_url` | 13 |
| `sw_logs.data` | 9 |
| `instagram_leads.avatar_url` | 8 |
| `resources.file_url` | 4 |
| `resources.thumbnail_url` | 3 |
| `ig_stories.storage_url`, `profiles.avatar_url` | 2 chacune |
| `task_attachments.file_url`, `task_attachments.thumbnail_url` | 1 chacune |

Et **203 lignes** de `shortio_link_daily_snapshots.original_url` portent l'origine
Vercel — celles-là sont un miroir de ce que Short.io détient, pas une source de vérité :
elles se corrigent d'elles-mêmes au prochain instantané.

Requête de réécriture (à jouer **après** la restauration, avant la remise en service) :

```sql
update <table> set <colonne> = replace(<colonne>,
  'https://<ANCIEN_REF>.supabase.co', 'https://<NOUVEAU_REF>.supabase.co')
where <colonne> like '%<ANCIEN_REF>%';
```

**Substrat 3 — le code stocké DANS la base.** Invisible à tout `grep` du dépôt :

| Où | Contenu | Effet si non corrigé |
|---|---|---|
| `public.notify_push_on_message` | `https://momentum-plateforme.vercel.app/api/push/webhook` en dur | **plus aucune notification de message** |
| `public.notify_push_on_reaction` | idem | plus aucune notification de réaction |
| `cron.job` — `call-reminders-15min` | URL Edge + `CRON_SECRET` en clair | rappels d'appel morts |
| `cron.job` — `send-pending-dm3-1min` | URL Edge + `CRON_SECRET` en clair | DM3 jamais envoyés |
| `cron.job` — `process-webhook-queue-1min` | ⚠️ URL **Vercel** + `CRON_SECRET` en clair | file de webhooks jamais traitée |

> ⚠️ **`process-webhook-queue-1min` vise une route Vercel, pas une Edge Function.**
> `AGENTS.md` le range parmi les jobs « chemin critique à la minute » sans dire de quel
> côté il tape. Vérifié le 2026-09-03 : c'est
> `momentum-plateforme.vercel.app/api/cron/process-webhook-queue`.

Voir §5 bis pour les **sept** endroits où vit le `CRON_SECRET`.

### B2 — La procédure d'export / réimport

Voir
[Backup and restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).
L'ossature :

```bash
supabase db dump --db-url "$ANCIEN" -f roles.sql  --role-only
supabase db dump --db-url "$ANCIEN" -f schema.sql
supabase db dump --db-url "$ANCIEN" -f data.sql   --use-copy --data-only

psql --single-transaction --variable ON_ERROR_STOP=1 \
  --file roles.sql --file schema.sql \
  --command 'SET session_replication_role = replica' \
  --file data.sql --dbname "$NOUVEAU"

# l'historique des migrations, sinon migrations_sante alerte en permanence
supabase db dump --db-url "$ANCIEN" -f hist_schema.sql --schema supabase_migrations
supabase db dump --db-url "$ANCIEN" -f hist_data.sql --use-copy --data-only --schema supabase_migrations
psql --single-transaction --variable ON_ERROR_STOP=1 --file hist_schema.sql --file hist_data.sql --dbname "$NOUVEAU"
```

⚠️ **La clé de chiffrement du Vault doit être copiée AVANT de mettre l'ancien projet en
pause ou de le supprimer** — sinon `push_webhook_secret` est perdu :

```bash
curl "https://api.supabase.com/v1/projects/$ANCIEN_REF/pgsodium" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" |
curl "https://api.supabase.com/v1/projects/$NOUVEAU_REF/pgsodium" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -X PUT --json @-
```

### B3 — Ce que l'export ne contient pas, et qu'il faut refaire à la main

| Quoi | Combien | Comment |
|---|---|---|
| Les fichiers du Storage | 111 objets, ~27 Mo | script Node de la doc Supabase — ⚠️ **les sauvegardes n'incluent jamais le Storage** |
| Les 9 buckets et leur caractère public/privé | 9 | à recréer **avant** la copie, en respectant le tableau de la §1 |
| Les Edge Functions | 11 | `npm run deployer-edge <nom>` pour chacune, après avoir changé `REF_PROJET` |
| Les secrets Edge | 12 utiles sur 14 (§1) | `npx supabase secrets set …` |
| Les publications Realtime | `calls`, `client_notifications`, `messages` | **à réactiver à la main** — l'export ne les rétablit pas |
| Les réglages d'authentification | Site URL, URL de redirection, gabarits d'e-mail, SMTP | hors base, hors dépôt : **à recopier écran par écran** |
| Les 31 variables Vercel | 31 | ⚠️ toujours avec `printf`, **jamais `echo`** (un `\n` corrompt les clés VAPID) |

### B4 — Les conséquences visibles par les élèves, sous le plan B

- **Les 52 sessions sont invalidées** : le secret JWT change, tout le monde est
  déconnecté d'un coup, sur tous les appareils.
- **Toutes les intégrations OAuth sont à reconnecter par chaque élève** si les
  applications changent aussi de compte (sauf Short.io).
- **Les liens de bio cassent** si l'origine change et que le script de réécriture n'est
  pas rejoué (`docs/click-id.md`).

C'est la mesure du coût du plan B : trois événements visibles côté élèves, contre zéro
sous le plan A.

---

## 9. La répétition à blanc

**Répéter le mécanisme et les autorisations, pas les données.** Un transfert ne touche
pas aux données : les répéter n'apprendrait rien. Ce qui se découvre à la répétition,
c'est **qui a le droit de cliquer sur quoi**, et c'est là que le jour J se perd.

### Répétition 1 — le transfert Supabase (30 min, coût nul)

1. Créer une **deuxième organisation** gratuite dans le compte Supabase.
2. Y créer un projet jetable, avec deux ou trois tables et un utilisateur.
3. Le transférer vers la première organisation, puis le retransférer.
4. **Chronométrer**, et noter à quel écran on bute.

Ce qu'on apprend et qu'aucune documentation ne dit : où se trouve exactement le bouton,
ce que l'écran de confirmation demande, ce qui se passe si on n'est que membre et pas
propriétaire, et si l'intégration GitHub est bien absente.

### Répétition 2 — le transfert Vercel (20 min)

1. Créer une **équipe** Vercel jetable (pas un compte personnel — c'est justement le
   point à éprouver).
2. Y inviter un second compte, pour vérifier de ses yeux qu'une équipe accepte des
   membres et qu'un compte personnel n'en accepte pas.
3. Déployer un projet vide, le transférer, mesurer.
4. **Vérifier explicitement le comportement en cas de collision de nom** — créer
   volontairement un projet du même nom dans l'équipe cible et regarder ce que Vercel
   propose. C'est le seul risque irréversible du plan A (§3), il mérite d'être vu une
   fois pour de vrai.

### Répétition 3 — le lien Git (5 min)

Sur le dépôt jetable : transférer, `git remote set-url`, puis **`git push`** (pas
seulement `git fetch` : c'est l'écriture qui est refusée quand le droit de collaborateur
est mal posé).

### Ce qui ne se répète pas

Le transfert de l'application Meta. Le retrait de son portefeuille est un acte réel sur
un actif réel. La seule préparation possible est **de vérifier que la vérification
d'entreprise du repreneur est validée avant de commencer**, et de garder l'option
« ajouter un administrateur au lieu de transférer » ouverte jusqu'au bout.

---

## 10. Les pièges déjà payés — ne pas les redécouvrir

- ⚠️ **Supabase pose des privilèges par défaut sur `public`** : toute vue nouvellement
  créée est lisible par `anon`, dont la clé est publique. Une fuite a été ouverte et
  refermée le 2026-09-03. Après toute opération sur la base :
  `select * from acces_sante_lecture;` **doit être vide**.
- ⚠️ **`create or replace view` conserve les droits mais efface `security_invoker` ;
  `drop view` + `create view` réinitialise les droits.** Aucune des deux ne prévient.
- ⚠️ **La clé anon n'est pas un secret, mais le `profile_id` d'un élève non plus** : il
  est inscrit dans les liens partagés. Authentifier d'abord, vérifier l'ownership
  ensuite (`docs/security-notes.md`).
- ⚠️ **Les webhooks Calendly sont payants et aucun abonnement n'existe** :
  `sync-calendly` est le **seul** chemin d'écriture des rendez-vous. Ne pas l'alléger en
  croyant qu'un webhook prend le relais.
- ⚠️ **Ne jamais investiguer par les logs Vercel** : une heure de rétention sur Hobby, et
  « No logs found » se lit comme « ça n'a pas tourné » alors que ça veut dire « je ne
  sais pas ». Écrire en base.
- ⚠️ **Le nom passé à `apply_migration` doit être exactement celui du fichier,
  horodatage retiré.** C'est la seule clé de rapprochement qui reste, et
  `migrations_sante` alerte si elle est cassée.
- ⚠️ **Variables d'environnement Vercel : toujours `printf`, jamais `echo`** — `echo`
  ajoute un `\n` qui corrompt les clés VAPID.
- ⚠️ **Ne rien mettre dans `vercel.json`** — il est volontairement vide.
- ⚠️ **Ne pas réécrire les 185 migrations manquantes.** C'est un cul-de-sac : il manque
  le schéma initial, elles ne rendraient pas le dépôt capable de reconstruire la base,
  et sous le plan A la question ne se pose même pas.

---

## 11. Ce qu'il ne faut PAS faire

- **Ne pas lancer le transfert** avant que les quatre conditions préalables (§4) soient
  vertes. L'objectif de ce document est d'être prêt.
- **Ne pas transférer Vercel si l'écran propose un autre nom que `momentum-plateforme`.**
  C'est le seul échec irréversible.
- **Ne pas toucher aux liens Short.io** en dehors de la procédure de `docs/click-id.md`.
- **Ne pas créer une nouvelle application Meta**, et ne pas retirer l'existante de son
  portefeuille avant que la vérification d'entreprise du repreneur soit validée.
- **Ne pas supprimer l'ancien projet Supabase** tant que V1 à V14 ne sont pas toutes
  vertes — et, sous le plan B, tant que les service workers installés n'ont pas tourné.
- **Ne pas partir du principe qu'une variable posée est une variable qui marche.** Tout
  se vérifie par une conséquence.

---

## 12. LE MODE D'EMPLOI — chaque geste, sa preuve, son feu vert

Cette section ne se lit pas, elle **se déroule**.

**Chaque étape a la même forme, et la règle est unique :**

> **Faire** → **Vérifier** (une commande ou une observation précise) → **✅ Feu vert**
> ou **🛑 Arrêt**.
>
> **On ne passe JAMAIS à l'étape suivante sur « c'est fait ». On y passe sur
> « c'est constaté ».** Une action réussie et une action efficace sont deux choses
> différentes : sur ce projet, presque toutes les pannes durables sont venues d'un geste
> qui avait « marché » sans qu'on regarde ce qu'il avait produit.

Les renvois `→ §x` pointent vers l'explication, si on veut savoir pourquoi.

Trois moments séparés par des jours : **A** à froid, **B** le jour J, **C** le lendemain.

---

### ☐ A — À FROID, les jours ou semaines qui précèdent

Aucune de ces étapes ne touche la production. Toutes bloquent le jour J si elles manquent.

---

**☐ A1 — Trancher le plan Vercel du repreneur** → §4 P2

- **Faire** : décider entre les trois montages possibles (encadré « Trois montages » en §4).
- **Vérifier** : la décision est **écrite**, et si c'est Pro, une carte de paiement est
  posée sur l'équipe.
- ✅ **Feu vert si** : la décision est écrite et le moyen de paiement en place.
- 🛑 **Arrêt si** : « on verra le jour J ». C'est la seule condition préalable qui engage
  une dépense, et la découvrir en pleine bascule fait choisir dans l'urgence.

**☐ A2 — Ouvrir l'accès Vercel de Chris**

Deux variantes selon la décision d'A1. **Une seule des deux est à faire.**

*Variante montage 1 — équipe Pro*, **le repreneur**, clic par clic :
  1. `https://vercel.com` → sélecteur de portée en haut à gauche → **`Create Team`**
  2. Nommer l'équipe, choisir le plan **`Pro`**, poser la carte
  3. Dans l'équipe → **`Settings`** → **`Members`** → **`Invite Member`**
  4. Adresse e-mail de Chris, rôle **`Member`** (ou `Developer`) → envoyer
  5. **Chris accepte** l'invitation reçue par e-mail

- **Vérifier** : `npx vercel teams ls` **depuis ce poste**.
- ✅ **Feu vert si** : l'équipe du repreneur apparaît dans la liste.
- 🛑 **Arrêt si** : elle n'apparaît pas. Une invitation **envoyée** n'est pas une
  invitation **acceptée**, et sur un compte Hobby elle n'existe pas du tout.

*Variante montage 2 bis — jeton d'accès*, **le repreneur**, une seule fois :
  ```bash
  npx vercel tokens add "chris-momentum" --project momentum-plateforme
  # le jeton en clair n'est affiche QU'UNE FOIS — le transmettre par un canal sur
  ```
  Chris, dans son terminal (jamais dans un fichier versionné) :
  ```bash
  export VERCEL_TOKEN=vcp_…
  ```

- **Vérifier** : `npx vercel whoami` **depuis ce poste**.
- ✅ **Feu vert si** : le compte du repreneur est affiché.
- ⚠️ **Le jeton ne donne pas le tableau de bord** : B2 (le transfert lui-même) devra être
  cliqué par le repreneur, ou par Chris sur son écran. → §4

**☐ A3 — Le repreneur crée l'organisation Supabase et invite Chris en `Administrator`**

- **Faire**, clic par clic, **côté repreneur** :
  1. `https://supabase.com/dashboard` → sélecteur d'organisation en haut à gauche →
     **`New organization`**
  2. Nommer l'organisation, plan **`Free`** (suffisant — l'invitation de membres en
     `Owner`/`Administrator`/`Developer` existe dès le plan gratuit)
  3. **`Organization Settings`** → **`Team`** → **`Invite`**
  4. Adresse e-mail de Chris, rôle **`Administrator`** → envoyer
  5. **Chris accepte** l'invitation reçue par e-mail
- **Vérifier** : depuis ce poste, lister les organisations (MCP `list_organizations`, ou
  le sélecteur d'organisation du tableau de bord).
- ✅ **Feu vert si** : **deux** organisations apparaissent, dont celle du repreneur.
- 🛑 **Arrêt si** : une seule. Sans être membre de l'organisation cible, **le transfert
  est refusé** — et Chris perdrait l'accès juste après.
- ⚠️ **`Administrator`, pas `Developer`** : c'est ce rôle qui permet de gérer les secrets
  des Edge Functions et les réglages du projet. `Read-Only` n'existe qu'au plan Team.

**☐ A4 — Le repreneur a un compte GitHub**

- **Vérifier** : ouvrir `https://github.com/<son-identifiant>` — la page existe.
- ✅ **Feu vert si** : la page existe.

**☐ A5 — Aucun projet Vercel nommé `momentum-plateforme` dans l'équipe cible** → §3

- **Faire** : lire la liste des projets de l'équipe cible.
- **Vérifier** : `npx vercel project ls --scope <equipe-cible>`.
- ✅ **Feu vert si** : le nom n'y est pas.
- 🛑 **Arrêt si** : il y est. **Ne pas continuer** : Vercel imposerait un autre nom, donc
  une autre adresse `*.vercel.app`, donc **tous les liens de bio casseraient**. Deux
  issues : faire renommer l'autre projet, ou exécuter A8 d'abord (qui rend le problème
  sans objet).

**☐ A6 — Aucun dépôt GitHub nommé `momentum-coaching` chez le repreneur**

- **Vérifier** : `https://github.com/<repreneur>/momentum-coaching` renvoie une 404.
- ✅ **Feu vert si** : 404.
- 🛑 **Arrêt si** : la page existe. GitHub refuserait le transfert.

**☐ A7 — Aucune intégration GitHub active côté Supabase** → §4

- **Faire** : Supabase → *Project Settings → Integrations*.
- **Vérifier** : aucune connexion GitHub listée ; et `list_branches` renvoie une liste
  vide (vérifié le 2026-09-03).
- ✅ **Feu vert si** : rien de connecté.
- 🛑 **Arrêt si** : une intégration existe. **Supabase refuse le transfert d'un projet
  avec une intégration GitHub active** : la retirer d'abord.

**☐ A8 — Basculer `MOMENTUM_REDIRECT_ORIGIN` sur le domaine définitif** → §3 + `docs/click-id.md`

⚠️ **Opération séparée, à froid, JAMAIS le même jour que le bloc B.** C'est la seule
opération irréversible du dossier.

- **Faire** : dérouler les 10 étapes de `docs/click-id.md`, section « La procédure
  complète, le jour où l'origine change ». Ne pas les réinventer ici.
- **Vérifier** : `node scripts/reecrire-liens-shortio.mjs` (simulation, sans
  `--appliquer`).
- ✅ **Feu vert si** : la simulation annonce **« À réécrire : 0 »**. C'est la seule preuve
  qui fait autorité — le script lit Short.io **en direct**, contrairement aux instantanés
  qui ont jusqu'à 5 minutes de retard.
- 🛑 **Arrêt si** : un nombre différent de 0. Il reste des liens sur l'ancienne origine.
- **Et ensuite** : `select * from clics_sante_redirection where etat like 'ALERTE%';` →
  vide, après un passage de cron.

> *Relevé du 2026-09-03, avant toute bascule : la simulation annonce déjà 0 lien à
> réécrire sur l'origine actuelle. Le mécanisme est donc complet — c'est le point de
> départ propre.*

**☐ A9 — Décider du sort du compte cron-job.org** → §5 bis

- **Faire** : choisir — passer le compte au repreneur, **ou** recréer les 9 jobs.
- ✅ **Feu vert si** : la décision est écrite. ⚠️ **Jamais les deux comptes en parallèle**
  (notifications en double).

**☐ A10 — Décider du sort de Stripe Connect** → §5 phase 3

- **Faire** : choisir — la plateforme Connect reste chez Chris, ou passe au repreneur.
- ✅ **Feu vert si** : la décision est écrite, en sachant que **changer de plateforme
  Connect oblige chaque élève à reconnecter Stripe**, et que les encaissements passés
  restent sur l'ancienne.

> ✅ **Meta, Google/YouTube, Calendly, Fathom : décidé le 2026-09-03 — ils restent chez
> Chris. Aucune étape, ni en A, ni en B.** → §5 phase 3

---

### ☐ B — LE JOUR J

#### B0 — Avant de toucher à quoi que ce soit

**☐ B0.1 — Relever la santé de référence** → §5 0.3

- **Faire** : jouer les 11 requêtes de la section 0.3.
- **Vérifier** : noter les résultats **dans un fichier**, pas de mémoire.
- ✅ **Feu vert si** : le relevé est écrit quelque part.
- 🛑 **Arrêt si** : on ne l'a pas. Sans référence, on ne pourra pas distinguer « la
  bascule a cassé ça » de « ça n'allait déjà pas ».

> ⚠️ **Deux de ces vues ne comparent pas au dépôt : elles comparent à une COPIE du dépôt,
> inscrite en base par `/api/sante/alerte-vues`.** `edge_sante_version` et
> `migrations_sante` sont donc **fausses entre un push et le passage suivant de cette
> route** — elle ne tourne qu'une fois par jour, déclenchée par `poll-leads` dans la
> tranche 8 h Paris.
>
> Constaté le 2026-09-04 : `edge_sante_version` affichait **7 alertes** deux heures après
> un relevé à 0. Vérification faite, les 8 empreintes en ligne étaient **identiques** à
> celles de `HEAD` — les fonctions déployées étaient bien celles du dépôt, et seule la
> copie en base était périmée. Aucun e-mail n'est parti : la route réécrit les empreintes
> **avant** de lire les vues, précisément pour ça.
>
> **Conséquence pour ce mode d'emploi** : ne pas lire ces deux vues comme témoin
> avant/après sur une échelle plus courte que leur cycle de rafraîchissement. C'est
> pourquoi V9 est en bloc **C** (le lendemain) et pas en bloc B. Si l'on veut trancher
> tout de suite, la seule preuve valable est la comparaison directe :
> `lib/empreintes-edge.generated.ts` de `HEAD` contre la colonne `empreinte_en_ligne`.

**☐ B0.2 — Arbre de travail propre**

- **Vérifier** : `git status --porcelain` (attention : d'autres sessions travaillent
  parfois dans ce dépôt).
- ✅ **Feu vert si** : aucune ligne, ou uniquement des fichiers qu'on maîtrise.
- 🛑 **Arrêt si** : du travail en cours non poussé. Le transfert GitHub ne le perd pas,
  mais on ne veut pas mélanger deux sujets un jour de bascule.

**☐ B0.3 — Sauvegarder `.env.local`**

- **Faire** : `cp .env.local .env.local.avant-transfert`
- **Vérifier** : `ls -l .env.local.avant-transfert`
- ✅ **Feu vert si** : le fichier existe. → §6, `vercel env pull` **écrase** `.env.local`,
  et `MOMENTUM_REDIRECT_ORIGIN` y a été ajoutée à la main : elle disparaîtrait en silence.

**☐ B0.4 — Point de départ sain**

- **Faire** : `npm run verifier-cible`
- ✅ **Feu vert si** : les 5 pointeurs sont ✓.
- 🛑 **Arrêt si** : un écart. On part déjà branché sur autre chose — le régler avant, pas
  pendant. → §6

---

#### B1 — GitHub → §5 phase 1

**☐ B1.1 — Lancer le transfert**

- **Faire**, clic par clic :
  1. Ouvrir `https://github.com/christianpenkov/momentum-coaching`
  2. Onglet **`Settings`** (barre d'onglets du dépôt, tout à droite — pas les réglages
     du compte)
  3. Rester sur **`General`**, descendre **tout en bas** jusqu'au cadre rouge
     **`Danger Zone`**
  4. Ligne **`Transfer ownership`** → bouton **`Transfer`**
  5. Champ **« New owner's GitHub username or organization name »** → identifiant du
     repreneur
  6. Champ de confirmation → retaper **`christianpenkov/momentum-coaching`**
  7. Bouton **`I understand, transfer this repository`**
- **Vérifier** : GitHub affiche que la demande est en attente d'acceptation.
- 🛑 **Arrêt si** : GitHub refuse pour cause de nom déjà pris → retour A6.

**☐ B1.2 — Le repreneur accepte**

- **Vérifier** : `https://github.com/<repreneur>/momentum-coaching` s'ouvre.
- ✅ **Feu vert si** : la page existe sous son compte.

**☐ B1.3 — Repointer le poste**

- **Faire** : `git remote set-url origin https://github.com/<repreneur>/momentum-coaching.git`
- **Vérifier** : `git fetch origin`
- ✅ **Feu vert si** : pas d'erreur → **la lecture** fonctionne.
- ⚠️ **Ce n'est PAS la preuve du droit d'écriture.** Un collaborateur en lecture seule
  voit `fetch` réussir et `push` échouer : c'est le refus le plus déroutant, parce que
  tout **semble** fonctionner. L'écriture se prouve en B4.4, pas ici.

---

#### B2 — Vercel → §5 phase 2

**☐ B2.1 — Ouvrir l'écran de transfert**

- **Faire**, clic par clic :
  1. `https://vercel.com` → en haut à gauche, sélecteur de portée → **`christianpenkov06-2255s-projects`**
  2. Cliquer le projet **`momentum-plateforme`**
  3. Onglet **`Settings`** (barre du projet)
  4. Menu de gauche → **`General`**
  5. Descendre **tout en bas** → section **`Transfer Project`**
  6. Bouton **`Transfer`**
  7. Dans la liste **« Select a Team »** → choisir l'**équipe** du repreneur
     ⚠️ **une équipe, pas un compte personnel** — s'il n'apparaît que des comptes
     personnels, retour à A1/A2

**☐ B2.2 — 🛑 LE POINT D'ARRÊT PRINCIPAL DU DOSSIER**

- **Faire** : **lire** l'écran de confirmation — il liste les domaines, les alias, les
  variables transférées, et **le nom retenu pour le projet**.
- **Vérifier** : le nom proposé.
- ✅ **Feu vert UNIQUEMENT si** : le nom est **exactement `momentum-plateforme`**.
- 🛑 **ANNULER si** : c'est autre chose. **Ne pas « voir si ça marche ».** Un autre nom =
  une autre adresse `*.vercel.app` = **tous les liens de bio des élèves cassent d'un
  coup**, et un lien de bio ne se corrige pas en éditant une publication. → §3

**☐ B2.3 — Confirmer et attendre**

- **Vérifier** : Vercel redirige vers le projet dans la nouvelle équipe, sans indicateur
  « en cours ». (10 s à 10 min selon le volume.)
- ✅ **Feu vert si** : le projet s'ouvre normalement dans l'équipe cible.

**☐ B2.4 — Le site répond toujours**

- **Faire** : ouvrir `https://momentum-plateforme.vercel.app` dans un navigateur.
- ✅ **Feu vert si** : la page se charge. Le transfert Vercel est annoncé **sans coupure**
  — on le constate au lieu de le croire.
- 🛑 **Arrêt si** : erreur. Ne rien faire d'autre avant d'avoir compris.

**☐ B2.5 — Reconnecter le dépôt Git si le lien a sauté**

- **Faire** : *Settings → Git*. Si aucun dépôt n'est lié : **Connect Git Repository**
  (le repreneur devra autoriser l'application GitHub de Vercel sur son compte).
- **Vérifier** : le dépôt du repreneur est affiché, branche `main`.
- ✅ **Feu vert si** : le lien est établi.
- *Rappel rassurant : un lien Git cassé n'interrompt PAS le site — Vercel continue de
  servir le dernier déploiement. Seuls les nouveaux déploiements sont bloqués.*

**☐ B2.6 — Relier ce poste**

- **Faire** : `npx vercel login` (si besoin) puis `npx vercel link` → choisir l'équipe
  du repreneur, puis le projet.
- **Vérifier** : `cat .vercel/project.json`
- ✅ **Feu vert si** : `orgId` est celui de la nouvelle équipe.

**☐ B2.7 — Les 31 variables sont bien là**

- **Faire** : `npx vercel env ls production`
- ✅ **Feu vert si** : **31 lignes**, dont `MOMENTUM_REDIRECT_ORIGIN`,
  `CLICK_IP_HASH_SECRET`, `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`.
- 🛑 **Arrêt si** : il en manque. Les reposer **avec `printf`, jamais `echo`** (un `\n`
  corrompt les clés VAPID), puis **redéployer** — une variable modifiée n'atteint pas un
  déploiement déjà en ligne.

---

#### B3 — Supabase → §5 phase 2

**☐ B3.1 — Lancer le transfert**

- **Faire**, clic par clic :
  1. `https://supabase.com/dashboard/project/nvjgwtetyuatnkjihmtw`
  2. Menu de gauche, tout en bas → **`Project Settings`**
  3. Sous-menu → **`General`**
  4. Descendre jusqu'à **`Transfer project`**
  5. Bouton **`Transfer project`**
  6. Liste **« Select organization »** → l'organisation du repreneur
     ⚠️ **si elle n'apparaît pas, Chris n'en est pas membre** → retour A3
  7. Retaper le nom du projet pour confirmer, puis valider
- 🛑 **Arrêt si** : refus pour intégration GitHub active → retour A7. Refus pour quota →
  l'organisation cible est au plan gratuit et a déjà 2 projets.

**☐ B3.2 — Attendre la fin**

- **Vérifier** : le projet apparaît sous l'organisation du repreneur.

**☐ B3.3 — 🛑 LE SECOND POINT D'ARRÊT : l'identité du projet n'a pas bougé**

- **Faire** : *Settings → API*.
- **Vérifier** : l'URL du projet et les clés `anon` / `service_role`.
- ✅ **Feu vert si** : elles sont **strictement identiques** à avant — même référence
  `nvjgwtetyuatnkjihmtw`, mêmes clés.
- 🛑 **Arrêt si** : quoi que ce soit a changé. **Ce n'était pas un transfert.** Tout le
  reste de ce mode d'emploi suppose que l'identité est préservée ; si elle ne l'est pas,
  basculer sur le plan B (§8), qui est un autre chantier.

**☐ B3.4 — La base répond, et elle est complète**

- **Faire** :
  ```sql
  select (select count(*) from auth.users)          as utilisateurs,   -- 7
         (select count(*) from storage.objects)      as fichiers,       -- 111
         (select count(*) from cron.job)             as jobs_pg_cron,   -- 10
         (select count(*) from integrations)         as integrations,   -- 14
         (select count(*) from vault.decrypted_secrets) as secrets_vault; -- 1
  ```
- ✅ **Feu vert si** : `7 / 111 / 10 / 14 / 1`, les valeurs du 2026-09-03.
- 🛑 **Arrêt si** : un écart. Ne pas continuer avant de l'avoir expliqué.

**☐ B3.5 — Les 11 Edge Functions et leurs secrets sont toujours là**

- **Faire** : `npx supabase secrets list --project-ref nvjgwtetyuatnkjihmtw`
- ✅ **Feu vert si** : **21 secrets**, dont `CRON_SECRET` et `NEXT_PUBLIC_PLATFORM_URL`.
- **Et** : la liste des Edge Functions en montre **11**, toutes `ACTIVE`.

---

#### B4 — Rebrancher ce poste → §6

**☐ B4.1 — Mettre `PROJET.json` à jour**

- **Faire** : y reporter `vercel_project_id`, `vercel_org_id`, `git_remote`.
  ⚠️ **`supabase_ref` ne change PAS** sous le plan A.
- ✅ **Feu vert si** : le fichier reflète la nouvelle réalité.
- ⚠️ **Ne jamais l'éditer « pour que ça passe »** : ici on l'édite parce que le projet a
  *réellement* changé de compte. C'est le seul cas légitime.

**☐ B4.2 — Le contrôle d'identité passe**

- **Faire** : `npm run verifier-cible`
- ✅ **Feu vert si** : **les 5 pointeurs sont ✓**. C'est la preuve que les quatre
  déclarations locales désignent bien le même projet, et le bon.
- 🛑 **Arrêt si** : un ✗. Le message nomme le pointeur fautif et la commande pour le
  corriger.

**☐ B4.3 — Le dépôt est cohérent**

- **Faire** : `npm test`
- ✅ **Feu vert si** : **527 tests**, `empreintes a jour (11 fonctions)`, cible verte.

**☐ B4.4 — La chaîne complète de livraison fonctionne (et prouve l'écriture Git)**

- **Faire** :
  ```bash
  git commit --allow-empty -m "Verification de la chaine de deploiement apres transfert"
  git push origin main
  ```
- **Vérifier** : le `push` passe **et** Vercel démarre un déploiement.
- ✅ **Feu vert si** : statut **Ready** dans Vercel.
- 🛑 **Arrêt si** : le `push` est refusé → droit de collaborateur en lecture seule (§5
  phase 1). Si le push passe mais qu'aucun déploiement ne démarre → retour B2.5.

---

#### B5 — Les comptes tiers → §5 phase 3 et §5 bis

**☐ B5.1 — cron-job.org**

- **Faire** : appliquer la décision d'A9.
- **Vérifier** : les **9 jobs** sont actifs dans **un seul** compte, avec les mêmes URL
  et le même bearer.
- ✅ **Feu vert si** : 9 jobs, un seul compte.
- 🛑 **Arrêt si** : deux comptes actifs en même temps → notifications en double.
- *La vraie preuve n'est pas ici : c'est V8, le lendemain.*

**☐ B5.2 — Resend**

- **Faire** : si la clé change, la poser avec `printf` (**jamais `echo`**), puis
  **redéployer**.
- **Vérifier** : `npx vercel env ls production` la montre.
- *La vraie preuve est V14, le lendemain.*

---

#### B6 — Les vérifications immédiates → §7

**☐ V1 — Les comptes et les sessions ont survécu**

- **Faire** : se connecter avec un compte de test.
- ✅ **Feu vert si** : la connexion passe. Et si une session était déjà ouverte sur un
  appareil, elle l'est encore — le secret JWT n'a pas changé.
- 🛑 **Arrêt si** : tout le monde est déconnecté → l'identité du projet a changé, voir
  B3.3.

**☐ V2 — La route de redirection répond**

- **Faire** :
  ```bash
  curl -sI "https://<origine>/r/verif?utm_source=ig&utm_medium=bio&d=<slug-calendly>" | head -3
  ```
- ✅ **Feu vert si** : `302` **et** un `location:` vers `calendly.com`.
- 🛑 **Arrêt si** : autre chose. Ne rien faire d'autre : c'est le chemin de tous les liens
  partagés.

**☐ V3 — Le lien de bio, en vrai**

- **Faire** : **depuis l'application Instagram, sur un téléphone**, cliquer le lien de
  bio d'un élève.
- ✅ **Feu vert si** : arrivée sur Calendly.
- ⚠️ **Vérifier sur le lien RÉELLEMENT publié.** Un élève qui a changé de domaine
  Short.io a deux liens homonymes, dont un dormant : « une vérification juste sur un
  objet dormant ne prouve rien du parcours réel » (`docs/click-id.md`).

**☐ V4 — La messagerie est temps réel**

- **Faire** : envoyer un message dans une conversation.
- ✅ **Feu vert si** : il apparaît **sans rafraîchir** chez le destinataire.
- 🛑 **Arrêt si** : il faut rafraîchir → les publications Realtime.

**☐ V5 — Le stockage, privé et public**

- **Faire** : ouvrir un fichier de `chat-medias` (privé, URL signée) **et** une vignette
  Instagram (bucket public).
- ✅ **Feu vert si** : **les deux** s'affichent. Un seul des deux ne prouve rien : ce sont
  deux chemins différents.

**☐ V6 — Déjà couvert par B4.4.**

**☐ V7 — Aucune donnée lisible sans RLS**

- **Faire** : `select count(*) from acces_sante_lecture;`
- ✅ **Feu vert si** : **0**.
- 🛑 **Arrêt si** : > 0 → une relation de `public` est lisible par `anon` ou
  `authenticated` sans appliquer la RLS. → §10

> 🛑 **Si V1, V2 ou V3 échoue, ne pas continuer et ne rien supprimer.** Ce sont les trois
> seuls tests dont l'échec est visible par un élève ou par un prospect.

---

### ☐ C — LE LENDEMAIN, quand un cycle complet est passé

**☐ V8 — Les crons tournent tous**

- **Faire** : `select * from crons_sante;`
- ✅ **Feu vert si** : aucune ligne `SILENCIEUX`.
- ⚠️ `cron-refresh-tokens` est **hebdomadaire (lundi 07h00)** : son silence en semaine est
  normal, son `silence_max` est à 28 jours.

**☐ V9 — Les fonctions en ligne sont celles du dépôt**

- **Faire** : `select * from edge_sante_version;`
- ✅ **Feu vert si** : aucune ligne `ALERTE%`.
- ⚠️ `'non instrumentee'` et `'hors crons inscrits'` **ne sont pas des anomalies**.

**☐ V10 — Un rendez-vous réservé arrive en base**

- **Faire** : réserver un **vrai** rendez-vous sur le Calendly d'un élève.
- ✅ **Feu vert si** : la ligne apparaît dans `calls` sous 30 minutes.
- ⚠️ **Non facultatif.** `sync-calendly` est le **SEUL** chemin d'écriture des
  rendez-vous — les webhooks Calendly sont payants et aucun abonnement n'existe. Un
  rendez-vous qui n'arrive pas ne produit **aucune erreur**, juste une ligne absente.

**☐ V11 — La notification push arrive sur le téléphone**

- **Faire** : envoyer un message, regarder le téléphone.
- ✅ **Feu vert si** : la notification arrive **et** la pastille se met à jour.
- ⚠️ C'est le test le plus révélateur : la chaîne traverse un trigger Postgres, une URL
  écrite **en dur dans le corps d'une fonction de la base**, une route Vercel, les clés
  VAPID et le service worker installé sur l'appareil. Si une seule maille a changé
  d'adresse, il échoue **en silence**.

**☐ V12 — Un paiement se rattache**

- **Faire** : faire un paiement de test.
- ✅ **Feu vert si** : `select * from stripe_sante_rattachement;` reste **vide**.
- ⚠️ Non facultatif : c'est le chemin de l'argent.

**☐ V13 — Aucun incident journalisé**

- **Faire** : `select * from cron_runs order by ran_at desc;`
- ✅ **Feu vert si** : vide.

**☐ V14 — L'e-mail quotidien de santé arrive**

- ✅ **Feu vert si** : il est reçu. Il prouve `/api/sante/alerte-vues` **et** Resend.

**☐ C1 — Comparaison au relevé de référence**

- **Faire** : rejouer les 11 requêtes de B0.1 et comparer.
- ✅ **Feu vert si** : **aucune nouvelle ligne** par rapport à la référence.
- ⚠️ Les **3 lignes `integration deconnectee`** (une dans `yt_sante_donnees`, deux dans
  `integrations_sante`) sont attendues et **ne sont pas des anomalies**.

**☐ C2 — Retirer l'ancien domaine, si A8 en a laissé un**

- ⚠️ **48 heures après**, jamais avant. La marge couvre un lien créé hors du compte
  Short.io, que le script ne voit pas. → `docs/click-id.md`

**☐ C3 — Ranger**

- **Faire** : supprimer `.env.local.avant-transfert` une fois C1 verte, et commiter
  `PROJET.json`.

> **La bascule est finie quand C1 est verte. Avant, elle est seulement faite.**

---

### Si quelque chose casse

Le plan A est **réversible dans les deux sens** : un projet se retransfère à
l'organisation d'origine avec les mêmes garanties. Ce n'est pas un aller sans retour.

Les deux seules opérations qui ne se rejouent pas d'un clic sont **A8** (réécriture des
liens Short.io) et un éventuel retrait de l'application Meta de son portefeuille — d'où
le fait que la première se fasse **à froid et séparément**, et que la seconde ait été
**écartée**.

---

**Durée réaliste : moins d'une heure pour tout le bloc B**, une demi-journée avec les
comptes tiers, étalée sur 2 à 3 jours à cause des attentes de C. Le reste de ce document
existe pour que cette demi-journée ne devienne pas trois semaines.
