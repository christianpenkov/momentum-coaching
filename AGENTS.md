<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Docs à lire avant de toucher certaines zones

> ⚠️ **Ce fichier est chargé en ENTIER au démarrage de chaque session** (`CLAUDE.md` →
> `@AGENTS.md`). Il pesait 1 697 lignes, soit ~25 000 jetons payés à chaque fois, y
> compris pour une question qui n'y touchait pas. Trois sections de référence en ont été
> extraites le 2026-09-12, **mot pour mot, sans rien réécrire** — le contrôle a vérifié
> que les 1 698 lignes d'origine se retrouvent toutes :
>
> - `docs/deploiement-et-verifications.md` — empreintes, latences, copies figées
> - `docs/crons.md` — les deux planificateurs, les neuf jobs, pg_cron
> - `docs/sante-plateforme.md` — les seize vues, les migrations, la règle du cash
>
> **Elles ne sont pas devenues optionnelles**, elles sont devenues *à la demande*. Chaque
> section ci-dessous garde sa règle impérative et pointe vers son document.
> **Avant d'ajouter ici trente lignes de récit, se demander si elles ont leur place dans
> un `docs/` que l'on charge en les ouvrant.**

- **Rapports de call** (vente ou coaching) → `docs/rapports-de-call.md`. Le parcours
  de vente a 17 étapes et 5 sorties ; la carte n'existe nulle part ailleurs.
- **Filtrer `calls` par « propriétaire »** → `docs/calls-coach-id-piege.md`.
  `calls.coach_id` n'est pas le coach humain.
- **Afficher une heure** → `docs/fuseaux-horaires.md`.
- **Dire si une vidéo YouTube est un Short** → `lib/youtubeShorts.ts`, jamais un
  seuil de durée écrit sur place. La durée ne distingue pas le format, elle le
  suggère : un seuil même bien réglé (180 s) se trompe encore 3 fois sur 32,
  mesuré. La source autoritaire est `creatorContentType`, en MINUSCULES, sans
  croisement possible avec `dimensions=video` — donc deux requêtes filtrées,
  plafonnées à 200.
- **Enregistrements Fathom** (qui voit quoi, avec quel compte, où c'est stocké) →
  `docs/replays-fathom.md`, et la règle d'accès seule dans `lib/replayAccess.ts`.
  Chacun connecte son propre Fathom : un call de coaching peut donc avoir DEUX
  enregistrements de la même conversation, et le second ne se rattache que par
  l'URL de jonction exacte — ne pas lever le filtre `fathom_recording_id IS NULL`
  ailleurs. Trois réglages hors dépôt conditionnent le replay et échouent en
  silence (`components/ui/FathomSetupHint.tsx`).
- **Toucher aux paiements, aux ventes ou au webhook Stripe** →
  `docs/stripe-paiements.md`. La configuration vit dans le dashboard, hors du
  dépôt : une case cochée par erreur fait passer un chiffre en négatif sans
  qu'aucun test ne s'en aperçoive.
- **Toucher un cron ou une intégration API** (YouTube, Instagram, Short.io,
  Calendry, Stripe) → **`docs/checklist-scalabilite.md`**. Objectif 30-40 élèves
  sans maintenance ; chaque point de la liste a trouvé un vrai défaut. L'audit
  YouTube qui l'a produite est dans `docs/youtube-scalabilite.md`.
- **Toucher la pastille de notification, le service worker ou un squelette de
  chargement** → `docs/pastille-et-sauts-accueil.md`. Dix bugs, un seul
  mécanisme : une valeur inconnue lue comme une valeur connue. Contient aussi
  les requêtes de diagnostic de la chaîne push.
- **Écrire une requête Supabase dont le résultat vide s'affiche** (journal,
  historique, liste d'événements) → `docs/requetes-qui-echouent-en-silence.md`.
  Une colonne inconnue rend HTTP 400 ; l'erreur non lue devient `data: null`,
  puis une liste vide, puis un écran qui montre une absence au lieu d'une panne.
  Le journal des ventes a été vide **depuis toujours** pour cette raison. Deux
  pièges nommés : `order` n'accepte pas les alias du `select`, et un cast `as`
  supprime la seule protection automatique qui reste.
- **Poser une modale mobile qui contient un champ de saisie** →
  `docs/clavier-mobile-modales.md`. La recette tient en dix lignes, mais six
  corrections déduites ont échoué avant : `window.innerHeight` est écrasé par iOS
  pendant l'animation du clavier **et restauré sans émettre d'événement**, donc
  tout calcul fondé dessus reste figé sur zéro. La règle générale qui en sort
  vaut bien au-delà du clavier : *toute valeur qui entre dans un calcul réactif
  doit avoir un événement qui annonce son changement.*
- **Toucher un lien Short.io, la route `/r/`, ou l'attribution d'un rendez-vous
  venu d'un lien PARTAGÉ** (bio, description, story) → `docs/click-id.md`. Les UTM
  reportés sur la destination ne sont pas décoratifs : sans eux, les clics de bio
  disparaissent des stats et ceux de description sont comptés en « Cold DM ».
- **Renommer le projet Vercel, ou changer le domaine de la plateforme** →
  `docs/click-id.md`, section « La procédure complète, le jour où l'origine change ».
  L'adresse du projet est écrite dans la **destination de tous les liens partagés** :
  la changer sans rejouer le script de réécriture casse d'un coup le lien de bio de
  chaque élève, celui qu'aucune édition de publication ne rattrape.
- **Transférer la plateforme vers d'autres comptes** (Supabase, Vercel, GitHub) →
  `docs/transfert-de-compte.md`, et **d'abord sa §0 ter**, qui liste les six décisions
  déjà prises avec ce qui les fonde. Le reste du document présente encore des options :
  ce tableau-là fait foi, et le rouvrir sans le lire fait refaire un arbitrage déjà rendu.
  L'essentiel en une ligne : **on transfère les projets, on ne les reconstruit pas** — Supabase et Vercel savent tous
  les deux déplacer un projet d'un compte à l'autre en gardant l'identifiant, les clés,
  l'URL et le nom, ce qui neutralise cinq des six points de casse. Le document contient
  aussi la seule opération irréversible du chantier (une collision de nom côté Vercel) et
  la liste exhaustive des valeurs codées en dur, si un jour la reconstruction devient
  inévitable.
- **Changer une règle de comptage, ou trouver une décision bizarre dans les stats** →
  `docs/pourquoi-ces-choix-stats.md` **avant** `docs/perimetre-stats-referentiel.md`. Le
  second dit ce que fait la plateforme, le premier dit **pourquoi ces choix plutôt que
  d'autres**, et surtout ce qu'on a failli faire à la place. Une règle sans son motif se
  fait supprimer par la première personne qui la trouve gênante. Trois décisions y sont
  volontairement contre-intuitives : le grain du no-show, les deux dates sur le même
  écran, et les deux tableaux qui affichent des nombres différents pour ce qui ressemble
  à la même chose.
- **Toucher les conversations Instagram** (stockage des DM, écrans coach/élève,
  reprise d'historique, notes, suggestions) → `docs/conversations-instagram.md`.
  Trois règles y sont porteuses et se cassent en silence si on les défait : la
  visibilité d'un fil n'est **jamais stockée** (elle se dérive d'`instagram_leads`,
  ce qui fait basculer un fil de 30 jours à 12 mois tout seul le jour où la
  personne devient un lead) ; le prédicat de visibilité n'est écrit **qu'une
  fois**, sur `ig_conversations`, et `ig_messages` s'y délègue — cinq témoins RLS
  le prouvent, à rejouer si l'une des deux politiques bouge ; et l'écriture passe
  par **une seule** fonction Postgres, parce que quatre requêtes par message
  auraient ajouté 24 000 requêtes/jour à 40 élèves sur un budget de 66 000.
  ⚠️ La plateforme **n'envoie aucun message de coach**, et c'est une décision
  produit, pas une limite technique : elle est ce qui dispense de demander
  `human_agent` à Meta. La rouvrir demande de rouvrir cette décision d'abord.
- **Auditer des chiffres affichés** → skill `audit-metrique-bout-en-bout`
  (`~/.claude/skills/`). La méthode API → base → écran, et les six pièges
  récurrents.
- **Déployer une Edge Function, ou comprendre quel code tourne vraiment** →
  `docs/deploiement-et-verifications.md`. `updated_at` ment, l'empreinte non ; une
  ALERTE juste après un déploiement est le cas bénin le plus fréquent ; et chaque
  déploiement fige sa propre copie des modules partagés, donc une fonction périme
  sans que son dossier bouge.
- **Ajouter, déplacer ou diagnostiquer un cron** → `docs/crons.md`. Ils vivent à
  DEUX endroits, et **quelle URL chaque job vise ne se lit pas dans le dépôt**.
  Un cron trop rapide a l'air plus sain que la normale.
- **Créer une vue de santé, interpréter une alerte, reconstituer une migration** →
  `docs/sante-plateforme.md`. Aucune vue n'a besoin d'être regardée — mais une vue
  absente du tableau `SURVEILLANCES` est muette, et `etat <> 'ok'` n'est pas un
  filtre d'anomalie.

# ⚠️ Un `profile_id` est PUBLIC

Depuis le 2026-08-31, le `profile_id` de l'élève est inscrit dans la destination de
chaque lien Calendly partagé (bio Instagram, description YouTube) — voir
`docs/click-id.md`. **Un `profile_id` reçu d'un appelant n'est donc jamais une preuve
d'identité** : authentifier d'abord, vérifier l'ownership ensuite, jamais un `.eq()` sur
l'identifiant reçu tel quel. Détail et motif dans `docs/security-notes.md`.

# L'identité du projet est DÉCLARÉE, et vérifiée avant toute écriture

`PROJET.json`, à la racine, déclare une fois pour toutes sur quoi ce dossier travaille :
référence Supabase, projet et équipe Vercel, dépôt git. **C'est la seule source de
vérité**, et le seul endroit où l'identité se change le jour d'un transfert.

```bash
npm run verifier-cible          # ✓ sur chaque pointeur, ou refus motivé
npm run vercel -- env ls production   # Vercel, borné à CE projet
```

Les outils en ligne de commande gardent leur session dans le **compte**, pas dans le
dossier : une seule connexion Supabase, une seule connexion Vercel, valables pour tous
les projets. Le dossier ne porte que des pointeurs — `.vercel/project.json`,
`supabase/.temp/project-ref`, `.env.local`, le remote git — et **rien ne garantissait
qu'ils désignent le même projet**.

⚠️ **Un pointeur qui désigne un autre projet ne produit aucune erreur : la commande
réussit, et elle réussit ailleurs.** Un déploiement d'Edge Function part dans la mauvaise
base, une réécriture de liens touche les bios d'un autre compte. Le risque grandit avec
le nombre de projets ouverts sur le poste, et il devient certain le jour d'un transfert,
où les pointeurs sont tous à repointer — il suffit d'en oublier un.

Le contrôle tourne **tout seul** au début de `npm run deployer-edge`, au début de
`scripts/reecrire-liens-shortio.mjs` (y compris en simulation : une simulation sur la
mauvaise base donne une liste juste pour le mauvais projet) et dans `npm test`. Rien à
penser à faire.

⚠️ **Un pointeur ABSENT n'est pas un écart** — « pas encore relié » échoue tout seul et
bruyamment au moment de s'en servir. Seul un pointeur **présent et différent** est une
contamination. Exiger une installation locale complète ferait échouer la vérification
chez quelqu'un qui ne déploie pas, donc ferait désactiver la vérification.

⚠️ **Ne jamais modifier `PROJET.json` « pour que ça passe ».** C'est la déclaration
d'identité, pas un paramètre de confort : on ne l'édite que quand le projet a
*réellement* changé de compte, en suivant `docs/transfert-de-compte.md`.

Témoin positif joué le 2026-09-03 : trois pointeurs faussés volontairement, trois écarts
signalés, le quatrième resté juste déclaré juste.

⚠️ **La session des CLI est GLOBALE à la machine, pas au dossier.** Mesuré le
2026-09-04 : depuis `C:/Users/chris`, `npx vercel whoami` répond déjà le compte connecté
(`%APPDATA%/com.vercel.cli/Data/auth.json`). Donc **ne jamais faire `vercel login` avec
le compte d'un tiers** : tous les dossiers de la machine basculeraient sur son compte.
Passer par `npm run vercel --`, qui lit un jeton posé dans `.vercel-token` (ignoré par
git) et vérifie la cible avant d'agir. Le jeton est créé avec `--project` : même utilisé
ailleurs par erreur, il ne peut toucher que ce projet.

⚠️ **`vercel env pull` écrase `.env.local`** et emporte `MOMENTUM_REDIRECT_ORIGIN`, qui
n'existe pas côté Vercel dans ce fichier — sans rien dire, et
`scripts/reecrire-liens-shortio.mjs` cesse alors d'écrire vers quoi que ce soit. Le
wrapper sauvegarde en `.env.local.avant-pull` et énumère les variables perdues.

# ⚠️ Le dépôt est PUBLIC — un secret écrit ici est un secret publié

Vérifié auprès de GitHub le 2026-09-04 : `private: false`. Tout ce qui est commité est
lisible par n'importe qui, sans authentification.

**Ne jamais écrire une valeur de secret dans un fichier versionné — y compris dans une
migration SQL.** C'est exactement comme ça que le `CRON_SECRET` a fuité : deux migrations
du 19 août inscrivaient un job pg_cron avec son en-tête `Authorization` en clair. Personne
n'avait écrit un secret dans un fichier de secrets ; il a fui par du SQL, que personne ne
range dans cette catégorie.

⚠️ **Le contrôle « les fichiers `.env` sont-ils ignorés ? » était vert, et sans rapport
avec la question.** Le seul contrôle qui répond est une recherche par **valeur** sur tout
l'historique :

```bash
git log --all --oneline -S"<la valeur>"     # une valeur, jamais un nom de fichier
```

**Un secret que la base doit connaître va dans le Vault**, jamais dans une commande
`cron.job` ni dans un corps de fonction. Le motif est posé :

```sql
select public.declencher_cron('send-pending-dm3');   -- un NOM, pas une URL, pas un jeton
```

⚠️ `declencher_cron` prend un **nom** et résout l'URL dans une liste fermée. Une variante
prenant une URL aurait attaché le secret à n'importe quelle destination — et Supabase
grante `EXECUTE` à `anon` par défaut, donc la fuite serait devenue active. Le `revoke`
est posé par-dessus : **les deux, pas l'un ou l'autre**. Toute nouvelle fonction
`SECURITY DEFINER` qui manipule un secret suit ce modèle.

**La cause est fermée, la fuite ne l'est pas** : la valeur reste dans l'historique git.
Seule sa ROTATION la rend inoffensive — procédure complète, y compris les 9 jobs
cron-job.org que rien d'autre ne peut atteindre, dans `docs/transfert-de-compte.md` §5 bis.

# Objectif permanent

**Zéro maintenance après livraison, robuste à 30-40 élèves.** Solide plutôt que
rapide. Aucune donnée inventée, simulée ou codée en dur : un `0` affirme quelque
chose, un trou dit « on ne sait pas ».

# Tests et vérifications

```bash
npm test                              # 814 tests + 5 gardes (empreintes, cible, migrations, cash, règles uniques)
npm run deployer-edge <fonction>      # deno check + empreinte + envoi, dans le bon ordre
npm run empreintes-edge -- --depuis-head && git add lib/empreintes-edge.generated.ts
```

⚠️ **Une Edge Function ne part PAS avec `git push`** — déploiement séparé obligatoire, et
`tsc` / `npm run build` ne couvrent pas `supabase/functions/`.

⚠️ **`npm run deployer-edge` envoie la COPIE DE TRAVAIL**, donc le travail non commité des
autres sessions. ⚠️ **`updated_at` ment** : pour savoir quel code tourne vraiment, comparer
`empreinte_en_ligne` à `git show HEAD:lib/empreintes-edge.generated.ts`.

📖 **Tout le reste dans `docs/deploiement-et-verifications.md`** — le détail des empreintes,
les deux latences normales après un déploiement (une ALERTE juste après est le cas bénin le
plus fréquent), le mode de panne des copies figées de `_shared/`, et la méthode de
vérification manuelle en trois étapes. **À lire avant tout déploiement d'Edge Function.**

# L'egress se paie au NOMBRE de requêtes, pas au volume

Le quota Supabase est de **5 Go par mois**, tous services confondus. Il a été dépassé en
**une semaine** début septembre 2026, et la cause n'était pas celle qu'on cherche
spontanément.

**Mesure du 2026-09-04, sur 24 h : le corps de TOUTES les réponses pesait moins de 1 Mo.**
Le corps moyen d'une réponse `prospect_links` faisait **1,4 octet**. Ce qui a consommé
5 Go, c'est le **nombre** — 288 969 requêtes par jour — chacune traînant ses en-têtes et
le surcoût de la passerelle, de l'ordre du kilo-octet, **invisible dans le corps**.

⚠️ **Conséquence contre-intuitive : optimiser un `select` ne sert presque à rien, et
regrouper N petites requêtes en une grosse est presque toujours gagnant.** Une session
antérieure avait retiré un `select('*')` sur `calls` en croyant traiter le sujet ; le
vrai poste — deux boucles qui faisaient *une requête par clic* — était juste à côté et
représentait 66 % du trafic.

**Le réflexe à avoir devant une facture d'egress : compter, pas peser.**

### Résultat mesuré, pour que ces règles restent crédibles

| Poste | 03 sept. | 05 sept. | Facteur |
|---|---|---|---|
| PostgREST | 386 MB | **30,2 MB** | ÷ 12,8 |
| Realtime | 465 MB | **4,0 MB** | **÷ 116** |
| **Total / jour** | **858 MB** | **42,4 MB** | **÷ 20** |

Soit **~1,3 Go/mois projeté** sur un quota de 5 Go, contre ~26 Go au rythme du 3 septembre.

⚠️ **Le coût réel par requête est de ~1,4 ko**, mesuré (386 MB ÷ 289 000 requêtes), et non
2,5 ko comme je l'avais d'abord estimé. Toute projection faite avant cette mesure était
deux fois trop pessimiste — c'est la raison pour laquelle on compte les requêtes ET on
recoupe avec la facture.

```sql
-- Dans les logs de la passerelle (ClickHouse, source `edge_logs`) :
-- grouper par `request.path` et COMPTER. La colonne `content_length` ment sur le coût.
```

Trois causes trouvées ce jour-là, dans l'ordre de taille :

| Cause | Coût mesuré | Nature |
|---|---|---|
| `poll-leads` : une requête **par clic**, sur une fenêtre de 48 h rejouée 288×/jour | 192 000 req/j | N+1 |
| `sync-calendly` et `notify-rapport` réglés à **1 min au lieu de 30** | 33 000 req/j | réglage cron-job.org |
| `poll-leads` : 4 lectures d'`integrations` **par profil et par passage** | 12 000 req/j (46 000 à 40 élèves) | lectures redondantes |

⚠️ **Le cache d'`integrations` de `poll-leads` a des règles**, toutes écrites en tête du
fichier : il est vidé à chaque invocation (un isolat Deno survit d'un passage à l'autre),
tout rafraîchissement de jeton doit le mettre à jour, il se replie sur une lecture directe
tant que la lecture groupée n'a pas réussi, et le type `FournisseurCache` interdit de
l'interroger pour un fournisseur que la lecture groupée ne couvre pas. **Ne pas y ajouter
un fournisseur sans l'ajouter aussi à `FOURNISSEURS_CACHE`** — la réponse serait
« absent » sur une ligne bien présente en base.

⚠️ **Un onglet ouvert coûte, lui aussi.** `useNotifications` interroge la base dans
**chaque onglet ouvert** : à 60 s c'était 5 requêtes par minute, 7 200 par jour et par
onglet. Avant d'ajouter une requête dans un hook qui tourne en boucle, se demander
combien de fois elle partira par jour — la réponse est rarement une.

## ⚠️ L'egress Realtime ne se paie PAS au message — il se paie à la CONNEXION

Le 2026-09-04, le Realtime pesait **63,6 %** de la facture, devant PostgREST. Trois
chiffres du même tableau de bord, le même jour :

```
egress Realtime            336 MB
Realtime Messages          187
connexions simultanées max   8
```

**336 MB pour 187 messages font 1,8 MB par message** — impossible pour de la donnée
applicative. Le compteur « Realtime Messages » ne compte que les changements de base, les
broadcasts et la présence ; l'**egress**, lui, compte *toute* trame envoyée sur une socket
ouverte : `join`, `phx_reply`, état de présence, battements.

⚠️ **Corollaire : optimiser les abonnements ne sert à rien si le coût vient des
connexions.** J'ai perdu une demi-journée en attribuant le Realtime aux écritures sur
`calls` — les messages sont bien tombés de 4 200 à 187 quand les crons ont été corrigés,
**et l'egress n'a pas suivi**. C'est ce décalage entre les deux courbes qui donne la
réponse.

**Le réflexe** : comparer egress ÷ messages ÷ connexions. Un ratio absurde par message
désigne le niveau connexion, pas l'applicatif. La FAQ Realtime de Supabase le dit
elle-même : *« si vos chiffres semblent anormalement élevés au regard du nombre de
connexions, écartez d'abord une boucle de reconnexion »*.

### `CLOSED` n'est pas une panne

C'est le statut normal émis après un `removeChannel()`, donc **à chaque nettoyage
d'effet**. `GlobalPresenceContext` le traitait comme un échec et programmait une
reconnexion :

```
nettoyage → removeChannel → CLOSED → on programme une reconnexion
→ setRetryKey → l'effet se rejoue → nettoyage → CLOSED → …
```

Et comme le compteur de tentatives repart à zéro à chaque `SUBSCRIBED`, le délai
retombait à **une seconde**. Le canal se réabonnait donc ~1 fois par seconde,
indéfiniment, dans chaque onglet — et pour le coach, sur chaque canal d'élève.

**La règle** : ne jamais reconnecter sur un `CLOSED` que l'on a soi-même provoqué. Un
drapeau posé par le nettoyage **avant** `removeChannel` distingue le nôtre de celui du
serveur. `CHANNEL_ERROR` et `TIMED_OUT` restent les vrais signaux d'échec.

⚠️ **Un canal par instance de hook coûte double, même quand il ne se passe rien.**
`useNotifications` en ouvrait un par montage alors que deux sont montés en permanence
(`TopBar` + la page). Le motif d'état partagé avec abonnés de `useUnreadMessagesCount`
est la référence — ne pas en réinventer un autre.

## Le plan GRATUIT doit tenir jusqu'à plusieurs mois APRÈS la livraison

Décision de Chris, 2026-09-04 : **on ne passe pas en Pro à la livraison**, mais plusieurs
mois plus tard. Le quota qui compte n'est donc pas les 250 Go du Pro, c'est **les 5 Go du
gratuit, avec de vrais élèves**.

Mesure du 2026-09-04, sur 8 passages : **~11 requêtes par élève et par passage**, plus
~25 fixes.

⚠️ **Le budget est d'environ 120 000 requêtes/jour**, pas 66 000. La première estimation
partait d'un coût de 2,5 ko par requête ; la facture réelle donne **~1,4 ko**. Ne pas
refaire ce calcul de tête : le diviseur se lit sur le tableau de bord, en croisant les
Go facturés avec le nombre de requêtes compté dans les logs.

| Élèves | Requêtes/jour | Egress projeté | Verdict |
|---|---|---|---|
| 5 (mesuré le 05/09) | ~20 000 | **1,3 Go/mois** | 25 % du quota |
| 20 | ~55 000 | ~3 Go/mois | tient |
| 40 | ~64 000 | ~3,5 Go/mois | tient, sans marge confortable |

**Le plan gratuit tient donc jusqu'à la livraison et au-delà** — à condition qu'aucun des
trois défauts corrigés le 04-05 septembre ne revienne. C'est le rôle des sections
ci-dessus.

D'où deux cadences espacées, **choisies après chiffrage, pas au jugé** :

- **Flux Short.io : un quart d'heure** au lieu de chaque passage. Fenêtre de minutes
  sans état (`getUTCMinutes() % 15 < 5`) : aucune colonne, aucune écriture, aucune requête
  ajoutée pour se souvenir du dernier passage, et exactement 4 passages/heure quelle que
  soit la dérive du planificateur.
- **Filet des notifications : 3 min** au lieu de 60 s.

⚠️ **Ce qui ne ralentit PAS, et qu'il ne faut pas « re-corriger » par erreur** : la
collecte des leads et des DM Instagram reste à chaque passage ; `send-pending-dm3` ne lit
que `instagram_leads.pending_dm3` et `dm3_scheduled_at`, donc **aucun DM ne dépend d'un
événement de clic** ; le bouton « Rafraîchir » passe par `/api/shortio/refresh-today`, un
chemin séparé de l'Edge Function ; et une notification arrive toujours instantanément par
le Realtime — le minuteur n'est qu'un filet pour le cas où le WebSocket décroche.

**Le jour du passage en Pro, ces deux cadences peuvent être remises comme avant** : elles
n'existent que pour le quota du plan gratuit, et le dire ici évite qu'on les prenne un
jour pour des choix de conception.

# Une borne posée sur les chemins d'ÉCRITURE ne couvre pas les chemins de LECTURE

Le 2026-09-02, le quota YouTube Reporting (**60 requêtes/minute, PAR PROJET Google** —
donc partagé par tous les élèves, et le seul quota tendu de la pile) a été borné à
6 rapports par passage et 2 téléchargements simultanés. La borne a été posée dans
`supabase/functions/poll-leads/index.ts` **et** dans sa jumelle `lib/yt-fetch.ts` : les
deux chemins d'écriture. Le sujet semblait clos.

**Le 2026-09-04 à 18:42 UTC, l'alerte Google Cloud est partie quand même** — observée à
1,0667, soit **64 requêtes/minute**. La cause était `fetchCtrByVideo` dans
`app/api/youtube/stats/route.ts`, c'est-à-dire **l'affichage de l'écran de statistiques** :
1 appel `jobs` + 1 appel `reports` + **30 téléchargements en parallèle** = 32 requêtes par
chargement de page. Deux chargements dans la même minute donnent 64.

**Personne n'avait pensé à ce chemin parce qu'il ne « collecte » rien.** Onze routes
appellent cette API ; seules celles qui portent le mot « sync » avaient été regardées.

⚠️ **Avant de déclarer un quota borné, chercher TOUS les appelants de l'API, pas les
crons.** `grep -rn "<domaine de l'api>" --include=*.ts .` — et lire ce que fait chaque
résultat, y compris les routes d'affichage et les routes de test.

⚠️ **Un cache mémoire ne borne pas un quota par minute.** La route portait déjà un cache
de 5 minutes, dont le commentaire disait lui-même « le cache est PAR INSTANCE serverless,
il ne garantit rien, il écrête ». Deux chargements servis par deux instances Vercel
paient chacun leur addition, un démarrage à froid aussi. Pour un quota **par projet**, il
faut un cache **partagé** — d'où `youtube_ctr_cache`.

⚠️ **Ne jamais corriger un quota en réduisant une fenêtre d'agrégation.** Appliquer ici la
borne des chemins d'écriture (6 rapports au lieu de 30) aurait divisé les appels par cinq
— et faussé le CTR affiché, puisque les impressions sont **sommées** sur la fenêtre. On
corrige le nombre d'appels, jamais le résultat. Le calcul est resté strictement identique.

⚠️ **Un cache ne mémorise jamais une ignorance.** Sur échec, on rend l'entrée périmée
(bornée à 7 jours), pas `{}` : rendre `{}` afficherait « aucun CTR », une affirmation,
alors qu'un appel raté ne dit rien du CTR. Et on n'écrit au cache qu'un résultat non vide,
sans quoi un rapport illisible figerait « rien » pendant tout le TTL.

**Ce qui n'est PAS la solution** : demander une augmentation de quota à Google. Ce plafond
ne se sature que sur un défaut — l'augmenter rendrait le défaut invisible. Et la hausse
exige un audit de conformité YouTube, soit des semaines.

## ⚠️ Les rapports YouTube n'arrivent PAS dans l'ordre de leurs données

Corollaire trouvé en creusant l'alerte ci-dessus, et il coûtait bien plus cher qu'elle.

`syncYtCtr` retenait un identifiant, `last_report_id`, et reprenait « tout ce qui suit »
dans une liste triée par `endTime`. **Ça suppose que les rapports apparaissent dans
l'ordre de leurs données. YouTube ne le garantit pas et ne le fait pas** — mesuré sur
l'API réelle le 2026-09-04 :

```
données jusqu'au 30/08 → rapport créé le 02/09 13:18
données jusqu'au 31/08 → rapport créé le 01/09 22:16   ← créé AVANT
```

Le 31/08 est traité d'abord, le filigrane se pose dessus, puis le 30/08 apparaît et se
range **avant** lui dans le tri. `slice(lastIdx + 1)` ne le voit jamais.

⚠️ **Une garde écrite contre un mode de panne n'en couvre pas un autre.** Le code
prévoyait déjà qu'un filigrane ne doit pas enjamber un rapport **en échec** — ce cas-ci
n'est pas un échec, c'est un retard, et il passait à travers.

**Mesuré, pas déduit** : l'algorithme est déterministe dès qu'on connaît l'ordre
d'apparition, que `createTime` donne. Rejoué sur les 63 rapports réels, le rejeu
reconstruit **exactement** le filigrane observé en base — ce qui valide le modèle — et
révèle **7 rapports jamais comptés** entre juin et septembre 2026, soit ~11 % du CTR.
Les deux chemins divergeaient : `/api/youtube/stats` relit les 30 derniers rapports chez
Google, donc il les incluait.

`youtube_ctr_sync_state.rapports_traites` porte désormais l'**ensemble** des identifiants
comptés. « Ce rapport a-t-il déjà été compté ? » se répond exactement, sans dépendre d'un
ordre que le fournisseur ne garantit pas.

⚠️ **`upsert_yt_ctr` ADDITIONNE.** Toute décision douteuse doit donc pencher du côté
« déjà traité » : une donnée manquante se voit et se rattrape, un double comptage est
silencieux et définitif. C'est pourquoi on ne retire **jamais** un identifiant du
registre, même expiré — purger supposerait de distinguer « expiré » de « absent d'une
réponse partielle », ce que l'API ne permet pas.

⚠️ **Ne jamais raisonner sur un filigrane positionnel avec une source qui publie dans le
désordre.** Le même piège guette toute API à rapports différés.

# Les crons vivent à DEUX endroits

pg_cron (dans la base) et cron-job.org (hors du dépôt). **Quelle URL chaque job vise ne se
lit PAS dans le dépôt** : plusieurs traitements existent en deux exemplaires (une Edge
Function et une route Vercel du même nom), et seul cron-job.org dit lequel tourne.

⚠️ **Avant d'ajouter un cron, vérifier qu'il n'existe pas déjà dans l'autre
planificateur** — un doublon fait partir la notification en double.

```sql
select jobname, schedule, active from cron.job order by jobid;   -- côté Supabase
select nom, etat, passages_du_jour from crons_sante;             -- aucun 'SILENCIEUX'
```

⚠️ **Un cron est « zéro maintenance » quand son SILENCE ET son EXCÈS sont détectables.**
Ne jamais inscrire un cron sans avoir lu sa fréquence dans cron-job.org : une
`cadence_attendue` posée au jugé produit une alerte qui crie ou une alerte qui dort.

📖 **Tout le reste dans `docs/crons.md`** — le tableau des neuf jobs avec leur cible
confirmée une par une, les dix jobs pg_cron et pourquoi ils restent là, `degrossir_historiques_analytics`
et sa garantie de non-perte, les doublons Vercel↔Edge supprimés, le webhook Calendly écrit
mais jamais appelé, et pourquoi `cron-refresh-tokens` ne rafraîchit rien.
**À lire avant de toucher un cron ou un planificateur.**

# ⚠️ Un incident CORRIGÉ rendait l'alerte muette pendant 30 jours

Le garde anti-répétition n'envoie chaque alerte qu'une fois et ne se réarme **que
lorsque la vue redevient propre**. Pour les vues calculées, c'est parfait : elles se
vident dès que la cause disparaît.

**`cron_runs` est une table de journal, pas une vue.** Ses lignes vivent 30 jours. Donc
une ligne dont la cause était déjà corrigée gardait l'alerte « déjà envoyée » pendant un
mois entier :

> un NOUVEL échec de cron, différent, dans cette fenêtre → **aucun e-mail**.

Une alerte qui ne peut plus partir est pire que celle qu'on vient de recevoir. Le cas
était actif le 2026-09-05 : sans correctif, plus aucune alerte de cron jusqu'au 4 octobre.

**Après avoir corrigé la cause d'un incident, le marquer résolu fait partie du geste** :

```sql
update cron_runs
set resolu_le = now(), resolu_note = '<le commit ou la migration qui corrige>'
where id = '<id>';
```

La surveillance lit `cron_runs_actifs` (les non-résolus). `cron_runs` garde l'historique
complet.

⚠️ **Ne JAMAIS supprimer la ligne.** Effacer la preuve d'un incident pour faire taire une
alerte est le geste que ce projet interdit partout ailleurs. On l'annote.

⚠️ **Ne jamais marquer résolu « pour nettoyer ».** Tant que `resolu_le` est nulle, la
ligne PROTÈGE — c'est elle qui dit qu'il reste quelque chose à faire.

⚠️ **Pas de résolution automatique**, et c'est délibéré : la tentation serait de
considérer un incident réglé dès que le cron repasse. Mais `marquer_passage_cron` est
appelé au **début** d'un run — un passage prouve l'invocation, jamais le succès. Une
résolution automatique fondée là-dessus effacerait des incidents encore vivants.

**La leçon générale** : une surveillance dont la source est un JOURNAL (lignes qui
persistent) et non un ÉTAT (calculé à la lecture) a besoin d'une notion de résolution,
sinon le premier incident la condamne au silence jusqu'à la purge.

# Santé de la plateforme

**Aucune de ces vues n'a besoin d'être regardée.** `/api/sante/alerte-vues` les parcourt
une fois par jour et envoie un e-mail dès qu'une se met à alerter, une fois par sujet,
réarmée d'elle-même. **Toute nouvelle vue de santé doit être ajoutée au tableau
`SURVEILLANCES` de cette route** — sinon elle est muette.

```sql
select * from cron_runs_actifs;        -- vide = aucun incident à traiter
select * from acces_sante_lecture;     -- vide = rien de lisible sans RLS
select * from edge_sante_version;      -- aucune ligne 'ALERTE%'
select * from migrations_sante;        -- vide = dépôt et base concordent
```

⚠️ **`etat <> 'ok'` n'est PAS un filtre d'anomalie** : `non_connectee`, `integration
deconnectee` et `lien non redirige` disent seulement qu'une intégration n'est pas branchée.
Les chercher comme des pannes fait remonter 23 faux positifs.

⚠️ **Après avoir corrigé la cause d'un incident, le marquer résolu fait partie du geste**
(`update cron_runs set resolu_le = now(), resolu_note = '<le commit>'`) — sinon le garde
anti-répétition rend l'alerte muette 30 jours. **Ne jamais supprimer la ligne.**

⚠️ **Un `revoke` ne se maintient pas, l'invariant si** : toute relation de `public` que
`anon` ou `authenticated` peut lire doit appliquer la RLS. Après tout `drop + create` de
fonction, le `revoke … from anon` explicite est obligatoire.

📖 **Tout le reste dans `docs/sante-plateforme.md`** — les seize vues une par une et ce que
chacune ne voit pas, la reconstitution d'une migration appliquée sans fichier
(`schema_migrations.statements`), le piège de la colonne qu'on cesse d'écrire, ce que l'API
Insights d'Instagram accepte vraiment (mesuré), la règle du cash et les neuf écrans qui ont
confondu « versé » et « resté en caisse ». **À lire avant de créer une vue de santé,
d'interpréter une alerte, ou de toucher une règle de comptage.**

