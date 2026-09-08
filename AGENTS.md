<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Docs à lire avant de toucher certaines zones

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
  `docs/transfert-de-compte.md`. La décision y est déjà prise et argumentée : **on
  transfère les projets, on ne les reconstruit pas** — Supabase et Vercel savent tous
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

`npm test` (node --test, aucune dépendance installée). Couvre les fonctions pures
de `lib/*.test.ts`.

Les fonctions pures des Edge Functions ont leurs propres tests, que `npm test` ne
voit pas :

```bash
npx deno test supabase/functions/_shared/ig-posts.test.ts   # cadence + clôture de journée
```

⚠️ **`tsc` et `npm run build` ne couvrent PAS `supabase/functions/`.** Avant tout
déploiement d'une Edge Function :

```bash
npx deno check supabase/functions/poll-leads/index.ts
npx supabase functions deploy poll-leads --project-ref nvjgwtetyuatnkjihmtw --no-verify-jwt
```

Une Edge Function ne part **pas** avec `git push` — déploiement séparé obligatoire.

### Déployer : une seule commande

```bash
npm run deployer-edge poll-leads
```

Elle fait les trois gestes **dans le bon ordre** : `deno check`, régénération de
l'empreinte du code source, puis envoi. Trois gestes à tenir, c'est un geste oublié.

Elle déduit aussi `--no-verify-jwt` du code (présence de `CRON_SECRET`) au lieu de le
supposer : l'ajouter « au cas où » ouvrirait un endpoint public, l'oublier ferait
recevoir un 401 au planificateur et le cron mourrait en silence.

⚠️ **Commiter aussi `lib/empreintes-edge.generated.ts`**, que la commande vient de
réécrire — **avec `--depuis-head`** :

```bash
npm run empreintes-edge -- --depuis-head
git add lib/empreintes-edge.generated.ts
```

Sans `--depuis-head`, la régénération inscrit les empreintes de la **copie de travail**,
donc du travail non commité des autres sessions : le dépôt publierait des valeurs qui ne
correspondent à aucune version de lui-même. C'est arrivé le 2026-09-03 sur trois
fonctions. `npm test` porte la garde en filet et dit quoi rejouer.

⚠️ Les deux modes répondent à deux questions, et les confondre produit un fichier faux :
le défaut (copie de travail) répond « qu'est-ce que je **déploie** ? », `--depuis-head`
répond « qu'est-ce que le **dépôt** contient ? ». Le déploiement a besoin du premier, le
commit du second.

⚠️ **Elle envoie la COPIE DE TRAVAIL.** Si une autre session a du travail en cours dans
le fichier, ce travail part en production — la commande le dit avant d'envoyer. Pour ne
déployer que le code commité :

```bash
git worktree add --detach /tmp/wt HEAD
cd /tmp/wt && npm run deployer-edge poll-leads
git worktree remove --force /tmp/wt
```

⚠️ **Les onze fonctions passent `deno check`, et il n'existe aucune échappatoire** — à
garder tel quel. Deux d'entre elles échouaient jusqu'au 2026-09-03 : `installment-reminders`
et `call-reminders` importaient `jsr:@supabase/supabase-js@2` et
`jsr:@supabase/functions-js/edge-runtime.d.ts`, qui tirent des paquets npm introuvables
sans `node_modules` côté Deno. Les neuf autres importaient déjà
`https://esm.sh/@supabase/supabase-js@2`, qui embarque ses dépendances.

**La vraie anomalie n'était pas l'échec, c'était la divergence** : deux sources
différentes pour onze fonctions. Alignées, la vérification passe partout, et
`call-reminders` portait le même défaut latent sans que personne l'ait encore lancé.

⚠️ Une note de session a affirmé pendant cinq jours que « `deno check` échoue sur ce
projet », généralisant un échec observé sur une seule fonction. Conséquence : la
vérification que ce document rend obligatoire a été considérée comme indisponible alors
qu'elle fonctionnait sur dix fonctions sur onze. **Un constat négatif se généralise tout
seul, parce qu'il autorise à ne pas faire.** Mesurer sur deux autres cibles avant
d'écrire « cet outil échoue ici ».

### Lire cette vue juste après un déploiement

⚠️ Deux latences normales, à connaître pour ne pas conclure à un échec (remarque de la
session Paiements, 2026-09-03) :

- **`empreinte_du_depot` ne lit pas le fichier**, mais une copie en base
  (`edge_empreintes_attendues`) écrite par `/api/sante/alerte-vues`, elle-même
  reconstruite par Vercel. Après une régénération locale, la colonne montre encore
  l'ancienne valeur jusqu'au prochain passage de la route.
- **`empreinte_en_ligne` reste nulle jusqu'au prochain passage du cron**, puisque c'est
  la fonction qui la déclare **en tournant**. Une fonction quotidienne ne se confirme
  donc que le lendemain.

Juste après un déploiement, l'état attendu est `'non instrumentee'`, pas `'ok'`. Ce n'est
pas un échec. La preuve immédiate est ailleurs : `npm run deployer-edge` affiche
l'empreinte qu'il envoie, et `get_edge_function` permet de la retrouver dans le bundle.

### ✅ La vue sait maintenant attendre (2026-09-05)

Ce faux positif **n'envoie plus d'e-mail**. `edge_sante_version` porte un état
`'en attente du prochain passage'` : quand les deux empreintes diffèrent **et** que la
fonction n'a pas tourné depuis le dernier changement d'empreinte du dépôt, elle n'a
simplement pas encore eu l'occasion de se déclarer — il n'y a rien à juger.

C'est le principe déjà appliqué partout ailleurs ici : **on ne juge pas un état tant
qu'on n'a pas la preuve de l'avoir observé après coup.**

⚠️ **La correction évidente aurait éteint la surveillance, et c'est le piège à retenir.**
Comparer `dernier_passage > mis_a_jour_le` ne marche que si cette colonne dit *quand
l'empreinte a changé*. Or `/api/sante/alerte-vues` réécrivait `mis_a_jour_le = now()` à
**chaque passage quotidien**, changement ou pas : elle disait « quand la ligne a été
touchée ». Un cron quotidien de 07:00 aurait donc eu `dernier_passage` (hier) toujours
antérieur à `mis_a_jour_le` (ce matin 06:00) — « en attente » pour toujours, **plus jamais
d'alerte**. Un déclencheur sur la table pose et préserve désormais la date de façon
autonome, quel que soit l'écrivain.

⚠️ **Ça ne cache rien durablement**, et deux garde-fous se couvrent : dès que la fonction
tourne, un écart réel redevient `ALERTE` ; et si elle ne tourne plus du tout, c'est
`crons_sante` qui le dit (`SILENCIEUX`).

Témoin positif joué avant de conclure — c'est lui qui a trouvé que le déclencheur ne
posait pas la date : écriture sans changement (date préservée), changement sans date
fournie (posée par la base, état « en attente »), et fonction ayant tourné après le
changement en remontant l'ancienne empreinte (**ALERTE**).

⚠️ **CETTE PHRASE ÉTAIT FAUSSE, corrigée le 2026-09-04.** Elle disait qu'une ALERTE juste
après un déploiement est significative. Non : c'est au contraire le cas bénin le plus
fréquent.

`empreinte_du_depot` n'est pas le dépôt, c'est un **instantané** du dépôt, réécrit par la
route. Une fonction déployée après la dernière prise remonte donc une valeur que
l'instantané ne connaît pas encore — et la vue crie alors que tout est juste. Mesuré ce
jour-là : `poll-leads` en ALERTE, alors que la fonction en ligne et le dépôt portaient la
même valeur au caractère près.

`poll-leads` rafraîchit désormais l'instantané **toutes les heures**
(`/api/sante/alerte-vues?manifeste=1` : aucune lecture de vue, aucun e-mail). La fenêtre
d'erreur passe de 24 heures à une heure — mais elle ne disparaît pas.

**La seule vérification qui tranche, à toute heure :**

```bash
git show HEAD:lib/empreintes-edge.generated.ts | grep '<nom>'
```

Si cette valeur égale `empreinte_en_ligne`, la fonction exécute le code du dépôt, quoi
qu'affiche `empreinte_du_depot`. Comparer à la colonne, c'est comparer à une photo datée.

⚠️ Une ALERTE n'est significative que si `empreinte_en_ligne` diffère AUSSI du fichier au
HEAD — alors seulement on a déployé sans régénérer, ou depuis une copie de travail non
poussée.

### Le retard d'un déploiement est désormais DÉTECTÉ

```sql
select * from edge_sante_version;   -- aucune ligne 'ALERTE%'
```

Chaque Edge Function remonte, à chaque passage, l'**empreinte de son code source**
(`index.ts` + la clôture de ses imports locaux). `/api/sante/alerte-vues` inscrit
l'empreinte du dépôt, et la vue compare. L'alerte part par le même e-mail quotidien que
les autres.

⚠️ **`crons_sante` ne pouvait pas voir ça** : elle prouve qu'un cron TOURNE, jamais qu'il
tourne le BON code. Le 2026-09-03, `poll-leads` a tourné deux jours avec du code vieux de
huit commits — dont le correctif qui empêche l'origine d'un lead d'être écrasée toutes
les cinq minutes — avec `crons_sante` à `'ok'` tout du long.

⚠️ **L'empreinte couvre les imports locaux, et c'est le point essentiel** : le mode de
panne dominant du projet (voir plus bas) est qu'un déploiement fige sa propre copie des
modules partagés, donc une fonction périme sans que son dossier bouge. Une empreinte du
seul `index.ts` aurait laissé passer exactement ce cas.

⚠️ **Ce n'est pas un identifiant de commit**, délibérément : un identifiant de commit
changerait à chaque commit, même sans rapport, et l'alerte crierait en permanence.
L'empreinte ne bouge que si le code de cette fonction bouge.

⚠️ **Le sens du mode de panne est choisi** : déployer sans régénérer l'empreinte fait
**crier** l'alerte alors que tout va bien. Jamais l'inverse. `'hors crons inscrits'`
(`call-reminders` et `send-pending-dm3` tournent en pg_cron, `refresh-ig-posts` et
`backfill-shortio` se déclenchent à la main) et `'non instrumentee'` ne sont pas des
anomalies.

✅ **Les onze fonctions remontent leur empreinte** — y compris `poll-leads`,
`sync-calendly` et `sync-stripe-payments`, que ce document a déclarées non instrumentées
jusqu'au 2026-09-07. Elles l'étaient déjà : `edge_sante_version` porte leur
`empreinte_en_ligne`. La note décrivait un état du 2026-09-03 (leurs fichiers portaient
alors le travail en cours d'une autre session) qui n'a jamais été relu.

⚠️ **C'est le même défaut que celui qu'on corrige ailleurs dans ce document, appliqué à
lui-même** : une note qui dit « pas encore fait » ne se périme pas toute seule et
personne ne la rejoue. Avant de croire un « à faire » daté, vérifier l'état réel — ici,
une seule requête suffisait :

```sql
select nom, empreinte_en_ligne is not null as instrumentee from edge_sante_version;
```

## Vérifier à la main (enquête, ou fonction non instrumentée)

Trois étapes, dans cet ordre. Aucune ne suffit seule (établi le 2026-08-29, après deux
diagnostics faux dans les deux sens).

1. **Dépister par les dates — des CANDIDATS, jamais une conclusion.** Comparer en epoch
   UTC des deux côtés (`git log --format=%ct`), et **dater aussi les fichiers `_shared/`
   et `lib/` importés** : chaque déploiement fige sa propre copie des modules partagés,
   donc une fonction périme sans que son dossier bouge. C'est cette étape, et elle seule,
   qui a désigné le seul vrai retard (`sync-stripe-payments`, `dealCash.ts` d'avant les
   statuts `ended` / `disputed`).
2. **Filtrer : la fonction utilise-t-elle la partie qui a changé ?** Une copie périmée
   sur du code jamais exécuté n'est pas une dette. `poll-stories` et `send-pending-dm3`
   n'importent que `mapWithConcurrency`, inchangé — zéro action.
3. **Prouver par le contenu du bundle** (`get_edge_function`, chercher un marqueur du
   commit). Seule étape qui démontre quelque chose.

⚠️ **`updated_at` ment.** Prouvé sur `refresh-ig-posts` : `updated_at` au 02/08, contenu
déployé contenant les filtres du 20/08. `version` et `entrypoint_path` se contredisent
même entre eux (version 16, chemin `_14`). Et un écart de quelques minutes entre commit
et déploiement n'est jamais concluant — le schéma normal est « je déploie, puis je
commite ».

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

⚠️ **Avant d'ajouter un cron, vérifier qu'il n'existe pas déjà dans l'autre
planificateur.** Un doublon ne se contente pas de doubler la charge : deux passages
simultanés lisent le même drapeau d'idempotence avant que l'un ne l'écrive, et la
notification part en double.

```sql
select jobname, schedule, active from cron.job order by jobid;   -- côté Supabase
```

## pg_cron — dans la base (relevé le 2026-08-31)

| Job | Fréquence | Pourquoi ici et pas ailleurs |
|-----|-----------|------------------------------|
| `call-reminders-15min` | `*/15 * * * *` | Edge Function, pas de dépendance externe |
| `send-pending-dm3-1min` | `* * * * *` | Chemin critique à la minute |
| `process-webhook-queue-1min` | `* * * * *` | Chemin critique à la minute |
| `purge-debug-logs` | 3h30 | **SQL pur** — 14 j de `sw_logs`, `webhook_debug_log`, `cron_invocation_logs` |
| `purge-webhook-queue-daily` | 3h35 | **SQL pur, aucune URL** |
| `purge-link-clicks-daily` | 3h40 | **SQL pur** — 400 j de `link_clicks` (`docs/click-id.md`) |
| `purge-call-rapport-drafts-daily` | 3h45 | **SQL pur, aucune URL** |
| `purge-journaux-machine-daily` | 3h50 | **SQL pur** — 7 j de `cron.job_run_details`, **30 j de `cron_runs`** |
| `vacuum-pg-net-daily` | 3h55 | **SQL pur** — empêche les tables pg_net de regonfler |
| `degrossir-historiques-analytics-daily` | 4h05 | **SQL pur** — rétention sans perte des historiques par contenu |

⚠️ **`degrossir_historiques_analytics()` n'est pas une purge ordinaire : elle ne perd
RIEN.** `analytics_ig_posts_history` et `analytics_yt_videos_history` écrivaient une
ligne par contenu et par jour, pour toujours — 3,6 Go/an à 40 élèves, sans aucune
borne. Or leurs seuls lecteurs font tous `distinct on (contenu) … snapshot_date desc`
sur une fenêtre, et `lib/period.ts` garantit que les fenêtres sont des semaines ou des
mois **calendaires**. Garder le dernier instantané de chaque semaine et de chaque mois
reproduit donc à l'identique toute requête que l'interface peut émettre : les lignes
supprimées sont celles qu'aucune fenêtre ne peut atteindre. Vérifié par comparaison
exhaustive avant/après (0 divergence sur 253 puis 725 combinaisons, puis 216 lignes du
RPC réel colonne par colonne).

**Avant de toucher à `get_ig_posts_history`, `get_yt_videos_history` ou `lib/period.ts` :
cette garantie repose sur eux.** Un lecteur qui agrégerait jour par jour, ou une fenêtre
glissante au lieu de calendaire, invaliderait la règle — et la perte serait silencieuse.

`shortio_link_daily_snapshots` est **volontairement exclue** : elle alimente
`get_shortio_clicks_by_day`, une vraie série quotidienne affichée en courbe.

Les quatre purges sont des `SELECT public.purge_*()`. Les déplacer sur un planificateur
externe imposerait de **créer une route HTTP pour chacune** et d'exposer sur Internet
des opérations de purge — plus de code, plus de surface d'attaque, pour un ménage qui
aujourd'hui ne dépend de rien. Les deux jobs à la minute restent ici pour la même
raison de robustesse : pas de saut réseau, pas de compte tiers dans le chemin critique.

## cron-job.org — hors de la base

⚠️ **Quelle URL chaque job vise ne se lit PAS dans le dépôt.** Plusieurs traitements
existent en DEUX exemplaires — une Edge Function Supabase et une route Vercel du même nom
— et rien dans le code ne dit lequel tourne. Une session du 2026-09-01 a perdu du temps
là-dessus : elle a cherché un discriminant dans les données, et celui qu'elle a trouvé
était inutilisable (les deux chemins écrivaient les mêmes colonnes). **La réponse est
dans cron-job.org, nulle part ailleurs.**

| Job | Cible | URL |
|---|---|---|
| `poll-leads` (5 min) | Edge | `supabase.co/functions/v1/poll-leads` |
| `poll-stories` (30 min) | Edge | `supabase.co/functions/v1/poll-stories` |
| `sync-calendly` (30 min) | Edge | `supabase.co/functions/v1/sync-calendly` |
| `sync-stripe-payments` (30 min) | Edge | `supabase.co/functions/v1/sync-stripe-payments` |
| `notify-rapport` (30 min) | Edge | `supabase.co/functions/v1/notify-rapport` |
| `fathom-cron-sync` (15 min) | Edge | `supabase.co/functions/v1/fathom-cron-sync` |
| `installment-reminders` (1×/j) | Edge | `supabase.co/functions/v1/installment-reminders` |
| `cron-health` (1×/j) | **Vercel** | `momentum-plateforme.vercel.app/api/stripe/cron-health` |
| `cron-refresh-tokens` (**lundi 07h00**) | **Vercel** | `momentum-plateforme.vercel.app/api/instagram/cron-refresh-tokens` |

**Neuf jobs, confirmés un par un le 2026-09-01 dans cron-job.org.** Sept en Edge, deux
en Vercel.

⚠️ `cron-refresh-tokens` **ne rafraîchit rien** — son nom ment. Elle alerte par e-mail
quand un jeton Instagram meurt. Le rafraîchissement, lui, est dans `poll-leads`.

### Pourquoi les deux dernières restent sur Vercel

Question posée le 2026-09-01 : faut-il tout uniformiser en Edge ? **Non**, et pas par
inertie. Chacune importe du code partagé — `getIgCreds` pour l'une, `getStripeAccess` et
`appelStripe` pour l'autre. Une Edge Function ne peut pas les importer : il faudrait en
figer une COPIE en Deno.

Or c'est le mode de panne dominant de ce projet, documenté plus haut : « chaque
déploiement fige sa propre copie des modules partagés, donc une fonction périme sans que
son dossier bouge ». Deux copies de plus, c'est deux angles morts de plus, pour un gain
d'uniformité que ce tableau apporte déjà.

⚠️ Une des raisons historiques a EXPIRÉ : le commentaire de `cron-health` dit qu'une Edge
Function « n'a pas `STRIPE_SECRET_KEY` dans ses secrets ». C'était vrai à l'écriture, ça
ne l'est plus — la clé y est posée depuis le 2026-08-31. L'argument des copies figées, lui,
tient toujours. Corrigé dans le fichier pour ne pas laisser une justification fausse.

**Comment confirmer** : ouvrir le job dans cron-job.org et lire son URL. Une URL en
`supabase.co/functions/v1/<nom>` désigne l'Edge Function ; une en
`momentum-plateforme.vercel.app/api/<chemin>` désigne la route Next.js. **Reporter la
réponse dans ce tableau** — c'est la seule trace que la session suivante pourra lire.

### Un cron est « zéro maintenance » quand son SILENCE **et son EXCÈS** sont détectables

Pas quand il tourne au bon endroit. `cron_runs` ne journalise que les **échecs**,
volontairement — mais un cron qui ne tourne plus n'échoue pas, il se tait, et un silence
ne se distingue pas d'un succès.

```sql
select nom, etat, passages_du_jour, cadence_attendue from crons_sante;
-- aucune ligne 'SILENCIEUX' ni 'ALERTE cadence trop rapide'
```

⚠️ **Le sens inverse était tout aussi invisible, et il a coûté cher.** Le 2026-09-04,
`sync-calendly` et `notify-rapport` tournaient **toutes les minutes au lieu de toutes les
30 minutes** — 30× la cadence prévue, depuis une date inconnue. Découvert par hasard, en
cherchant d'où venaient 5 Go d'egress consommés en une semaine sur un quota **mensuel**
de 5 Go : 23 requêtes par minute mesurées dans les logs de la passerelle, ~33 000 par
jour, pour un travail que 48 passages faisaient.

**Aucun contrôle ne pouvait le voir, et c'est structurel** : un cron trop rapide laisse
une trace fraîche, ses données sont à jour, `cron_runs` reste vide puisqu'il ne rate
rien. **Il a l'air plus sain que la normale.** `cron.job` ne le montrait pas davantage —
ces deux jobs vivent chez cron-job.org, dont ni l'URL ni la cadence ne se lisent dans le
dépôt.

`crons_passages` porte donc `cadence_attendue` (la cadence **nominale**, saisie à la main
depuis cron-job.org — jamais déduite de l'observation) et `passages_du_jour`, un compteur
remis à zéro à minuit UTC par `marquer_passage_cron`.

⚠️ **On compte les passages du jour, on ne mesure pas le dernier intervalle.** Mesurer
l'écart entre deux passages serait plus simple et donnerait un faux positif garanti : les
boutons « Rafraîchir » appellent les mêmes traitements que les crons, donc un clic juste
après un passage automatique produirait un intervalle d'une seconde. Un compteur
journalier encaisse quelques clics sans broncher, là où un cron déréglé multiplie le
total par trente.

⚠️ **Le seuil est de quatre fois la cadence prévue, avec un plancher de 4 passages.** Le
plancher n'est pas décoratif : sans lui, `cron-refresh-tokens` (hebdomadaire) aurait un
seuil de 1 et alerterait dès sa deuxième exécution du jour — une simple reprise. Même
piège que le `silence_max` de 2 jours posé au jugé sur ce même cron, qui garantissait une
fausse alerte chaque jeudi soir.

⚠️ **Une `cadence_attendue` nulle n'alerte JAMAIS** : « on ne sait pas » ne doit pas se
transformer en seuil au jugé. Corollaire de la règle déjà posée pour `silence_max` —
lire la fréquence dans cron-job.org **avant** d'inscrire un cron, c'est la seule source.

**Si un job change légitimement de fréquence, c'est `cadence_attendue` qu'il faut mettre
à jour**, sinon l'alerte crie en permanence.

`crons_passages` porte une ligne par cron, écrasée à chaque passage, **succès ou échec** :
la table ne grossit jamais, aucune purge à prévoir. Le seuil de silence est porté par la
ligne (`silence_max`), pas par la vue — un cron quotidien et un cron aux 5 minutes n'ont
pas le même. Un cron s'inscrit en un appel : `rpc('marquer_passage_cron', { p_nom, p_contexte })`.

État au 2026-09-01 :

| Cron | Son silence est-il détecté ? |
|---|---|
| `cron-health` | ✅ par `integrations.last_synced_at` + `integrations_sante` (`ping_absent`) |
| les huit autres | ✅ par `crons_passages` — **tous inscrits le 2026-09-01** |

**Relevé du 2026-09-02** (lendemain de l'inscription, le seul jour où la table pouvait
encore mentir) : sept des huit portent un passage réel du 2 septembre, `etat = 'ok'`.
`installment-reminders` a bien tourné à 07h00 UTC. La surveillance fonctionne.

**`cron-refresh-tokens` n'avait pas tourné, et c'est NORMAL** : il est **hebdomadaire,
le lundi 07h00** (confirmé par Chris le 2026-09-02 ; le relevé tombait un mercredi).

Son `silence_max` valait 2 jours, ce qui l'aurait fait passer `SILENCIEUX` chaque jeudi
soir pour le rester jusqu'au lundi — **une fausse alerte hebdomadaire garantie**,
c'est-à-dire le début d'une alerte qu'on n'ouvre plus. Porté à **28 jours**, soit les
quatre cadences de la règle ci-dessus.

⚠️ **Un `silence_max` par défaut est un piège quand la cadence est inconnue.** Celui-ci
a été inscrit avec le défaut de 2 jours sans que personne ne sache qu'il tournait une
fois par semaine — et la fausse alerte n'était pas visible à l'inscription, seulement
trois jours plus tard. **Ne jamais inscrire un cron sans avoir lu sa fréquence dans
cron-job.org d'abord** : c'est la seule source, elle n'est pas dans le dépôt, et la
poser au jugé produit une alerte qui crie ou une alerte qui dort.

**La vraie question n'est pas sa cadence, c'est son existence.** Son rafraîchissement
de jetons ne sert à rien depuis le 2026-08-27 : `poll-leads` le fait toutes les heures
(prouvé en conditions réelles, jeton reculé à +3 jours et renouvelé en moins de
5 minutes) et déclenche l'e-mail d'alerte en 2 secondes au lieu d'attendre la semaine.
Le commentaire de `poll-leads` le dit lui-même : « déclenche l'alerte tout de suite, au
lieu d'attendre le passage hebdomadaire ». **Sa mort est sans conséquence** — d'où le
choix de ne pas le surveiller de près. À supprimer de cron-job.org quand Chris tranche ;
la route, elle, reste (elle porte la rédaction du mail et le garde anti-répétition).

### ⚠️ Les logs Vercel ne peuvent PAS répondre à « cette URL a-t-elle été appelée ? »

Le projet est sur le plan **Hobby**, dont la rétention de logs d'exécution est d'**une
heure**. Pro donne 1 jour, Enterprise 3. Toute enquête portant sur un appel d'hier, ou
sur un cron quotidien, est donc impossible par ce chemin — et l'outil répond « No logs
found », une phrase qu'on lit spontanément comme « ça n'a pas tourné » alors qu'elle
veut dire « je ne sais pas ».

C'est la forme la plus dangereuse d'un instrument : **il rend une absence indiscernable
d'une ignorance.** Corollaire de la règle générale du projet — ne jamais investiguer
par les logs, écrire en base. Une chose qui doit pouvoir être constatée le lendemain
doit laisser une ligne (`crons_passages`, `cron_runs`), jamais un log.

⚠️ **Une ligne ABSENTE de `crons_passages` est invisible pour `crons_sante`** : la vue ne
peut signaler que le silence d'un cron qu'elle connaît. `cron-refresh-tokens` était
instrumenté depuis le matin du 2026-09-01 mais n'avait encore jamais tourné — donc
aucune ligne, donc aucune surveillance, exactement le trou qu'on croyait fermé. **Insérer
la ligne à l'inscription, sans attendre le premier passage.**

⚠️ **Poser aussi `silence_max` à l'insertion.** Le défaut est de 2 jours, ce qui est
absurde pour un cron aux 5 minutes. Règle : environ quatre cadences, jamais moins de deux
heures — un planificateur externe saute un passage de temps en temps, et une alerte qui
crie pour un passage manqué est une alerte qu'on apprend à ignorer.

**Où poser l'appel : au plus tôt, juste après l'authentification.** La question posée est
« le planificateur appelle-t-il encore cette URL ? ». Un échec survenu *pendant*
l'exécution est déjà couvert par `cron_runs`, et les deux ne doivent pas se recouvrir.
Marquer à la fin ferait en plus passer un simple dépassement de temps pour une mort du
cron — une fausse alerte, c'est-à-dire le début d'une alerte qu'on n'ouvre plus.
(`cron-refresh-tokens` marque à la fin et porte en prime un contexte de résultat ; c'est
l'exception, pas le modèle.)

⚠️ Ne PAS réutiliser `integrations.last_synced_at` pour un cron qui touche Instagram :
`poll-leads` l'écrit déjà toutes les 5 minutes, et le battement de l'un masquerait la mort
de l'autre. C'est le défaut qui a motivé cette table.

### Les doublons Vercel ↔ Edge Function

Trois routes Vercel dupliquaient une Edge Function sans jamais être appelées. Elles ne
sont pas inoffensives : quelqu'un finit par les corriger en croyant réparer quelque
chose, et le vrai chemin ne bouge pas.

| Route Vercel | Edge Function | État |
|---|---|---|
| ~~`app/api/instagram/poll-leads`~~ | `poll-leads` | **supprimée le 2026-09-01** |
| ~~`app/api/calendly/cron-sync`~~ | `sync-calendly` | **supprimée le 2026-09-01** — zéro appel en 24 h dans les logs Vercel le 2026-08-31 |

**`notify-rapport` n'est plus un doublon** : sa route Vercel a disparu lors d'une session
antérieure, seule l'Edge Function subsiste. Ce document l'a listée comme doublon plus
longtemps qu'elle n'a existé.

⚠️ **« Route morte » ne veut jamais dire « fonctionnalité morte ».** Le rappel de rapport
d'appel et la synchro Calendly tournent tous les deux — par l'Edge Function. Ce qui était
mort, c'est le fichier Vercel que personne n'appelait.

**Avant d'ajouter une route qui porte le nom d'une Edge Function existante**, se demander
laquelle sera réellement appelée. La réponse par défaut, sur ce projet, est l'Edge
Function.

`sync-stripe-payments` **existe et tourne toutes les 30 minutes** (créé le
2026-08-31). ⚠️ **Ne pas en recréer un** : c'est le filet du cash, un doublon ferait
passer deux exécutions simultanées sur les mêmes fenêtres.

## Webhook Calendly — écrit, correct, et jamais appelé (vérifié le 2026-09-02)

`app/api/webhooks/calendly/route.ts` est complet et sain (signature HMAC, fail-closed,
résolution du profil par `event_memberships[0].user`). Il ne reçoit **rien**, et ce
n'est pas corrigeable par du code :

```
POST https://api.calendly.com/webhook_subscriptions
→ 403 {"title":"Permission Denied",
       "message":"Please upgrade your Calendly account to Standard"}
```

**Les webhooks Calendly sont payants.** Aucun abonnement n'existe, ni en scope `user`
ni en scope `organization`.

⚠️ **Donc `sync-calendly` (30 min) n'est pas une redondance : c'est le SEUL chemin
d'écriture des rendez-vous.** Ne pas l'alléger en croyant qu'un webhook prend le relais.

À la migration Quennel, si son plan est Standard ou plus : un abonnement **par élève**
en scope `user`, avec `signing_key` = `CALENDLY_WEBHOOK_SIGNING_KEY` (déjà sur Vercel).
Une clé qui ne correspond pas fait rejeter tout en 401 — panne silencieuse.

Et deux branches de la route testent des noms d'événements **qui n'existent pas chez
Calendly** (`invitee.rescheduled`, `invitee.no_show`) : détail et correctifs à faire
dans l'en-tête du fichier.

## Webhook `story_insights` Instagram — étudié, écarté (2026-09-02)

Meta pousse les métriques d'une story à son expiration. Écarté après comparaison :
le webhook livre `impressions, reach, taps_forward, taps_back, exits, replies`, soit
l'ancien jeu de métriques. `poll-stories` collecte `reach, shares, views, follows,
profile_visits, total_interactions, replies` — **2 sur 7 seulement seraient couvertes**.
Il faudrait continuer à poller pour les cinq autres, tout en ajoutant un endpoint, une
signature, un abonnement et une déduplication. Ne pas y revenir sans vérifier d'abord
que Meta a modernisé la charge utile.

Il relit les paiements chez Stripe pour rattraper ce qu'un webhook non délivré a
manqué. Sans lui, le webhook est l'unique chemin d'écriture et un événement perdu
l'est pour toujours, sans aucun signal — trois encaissements du compte de test étaient
dans ce cas, et le premier passage l'a prouvé en les ramenant.

La cadence de 30 min n'est pas arbitraire : `OVERLAP_MINUTES = 30` dans le code, donc
chaque fenêtre couvre l'intervalle **plus** son recouvrement. Un passage manqué est
rattrapé par le suivant sans aucun trou. À une passe par jour, ce recouvrement de
30 minutes n'aurait servi à rien.

⚠️ **Ne pas la déclencher à la main pendant une fenêtre d'observation** : chaque
lancement avance `integrations.metadata.stripe_synced_at`, le filigrane qui sert
justement à prouver qu'un passage autonome a eu lieu.

Le secret `STRIPE_SECRET_KEY` est **posé** côté Edge Functions (clé de TEST au
2026-08-31 — à reposer avec la clé live lors de la migration chez Quennel). La clé de
Vercel ne parvient pas aux Edge Functions, ce sont deux environnements distincts :

```bash
npx supabase secrets set STRIPE_SECRET_KEY=sk_… --project-ref nvjgwtetyuatnkjihmtw
```

Sans lui, la fonction échoue sur les comptes OAuth en le disant explicitement dans
`cron_runs`, plutôt que de renvoyer le « Invalid API Key provided: undefined » de Stripe.

⚠️ Ne rien mettre dans `vercel.json` — il est volontairement vide.

Le ping de santé Stripe ne déclare une panne qu'en cas d'échec d'appel — un silence
ne prouverait donc pas qu'il tourne. Il **horodate chaque passage**, succès ou échec,
dans `integrations.last_synced_at`, et `integrations_sante` signale son absence
au-delà de 2 jours (`etat_collecte = 'ping_absent'`). Rien à aller lire à la main.

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

**Aucune de ces vues n'a besoin d'être regardée.** Depuis le 2026-09-01,
`/api/sante/alerte-vues` les parcourt toutes une fois par jour et envoie un e-mail dès
qu'une se met à alerter — une fois par sujet, réarmée d'elle-même quand la vue redevient
propre (table `alertes_plateforme`). Auparavant, seul le plafond de stockage prévenait :
les dix autres attendaient qu'on pense à les consulter, ce qui n'est pas une
surveillance mais une documentation.

L'e-mail est écrit pour être lu **dans un an, par quelqu'un sans contexte** : ce que la
vue surveille, ce que l'alerte veut dire, ce que ça coûte, les vérifications dans
l'ordre, et un **prompt prêt à coller dans Claude Code** qui nomme le dossier du projet
et la référence Supabase. Toute nouvelle vue de santé doit être ajoutée au tableau
`SURVEILLANCES` de cette route — sinon elle est muette, exactement comme les dix
précédentes.

Déclenchée par `poll-leads` dans la tranche 8 h Paris, comme `alerte-stockage` : aucun
planificateur à créer, et la clé Resend ne quitte pas les variables Vercel.

```sql
select * from cron_runs_actifs;                 -- vide = aucun incident à traiter
select * from yt_sante_donnees;                 -- 'ok' partout
select * from integrations_sante;               -- 'ok' ou 'non_connectee'
select * from ventes_sante_montants;            -- vide = rapport et deal concordent
select * from stripe_sante_rattachement;        -- vide = chaque encaissement a sa vente
select * from ventes_sante_sur_encaissement;    -- vide = aucun deal n'a encaisse 2x
select * from ventes_sante_contenu;             -- 'ok' partout
select * from ventes_sante_date;                -- aucune ligne 'ALERTE%'
select * from ig_sante_insights_posts;          -- 'ok' partout
select * from ig_sante_periodes;                -- aucune ligne 'ALERTE%'
select * from base_sante_taille;                -- 'ok' = plafond de stockage loin
select * from clics_sante_redirection;          -- 'ok' partout
select * from crons_sante;                      -- aucun 'SILENCIEUX' = les crons inscrits tournent
select * from acces_sante_lecture;              -- vide = aucune donnée lisible du navigateur sans RLS
select * from edge_sante_version;               -- aucune ligne 'ALERTE%' = les fonctions en ligne sont celles du dépôt
select * from migrations_sante;                 -- vide = dépôt et base racontent la même histoire récente
```

## ⚠️ Une migration vit à DEUX endroits, et rien ne les rapprochait

Appliquer un changement de schéma sans écrire le fichier **ne produit aucun symptôme** :
la base fonctionne, les écrans fonctionnent, les tests passent. Mesuré le 2026-09-03 :
**sept migrations des 1ᵉʳ au 3 septembre n'existaient que dans la base**, venues de quatre
sessions différentes — dont celle qui crée `crons_passages`, `crons_sante` et
`marquer_passage_cron`, c'est-à-dire toute la surveillance des crons. Deux migrations
ultérieures agissaient sur une table qu'aucun fichier ne créait.

**La règle, et c'est la seule clé qui reste** : le nom passé à `apply_migration` doit être
**exactement** celui du fichier, horodatage retiré.

```
supabase/migrations/20260903200000_migrations_sante.sql   →   apply_migration(name: 'migrations_sante')
```

### ✅ Le SQL exact d'une migration appliquée est RÉCUPÉRABLE (trouvé le 2026-09-05)

`supabase_migrations.schema_migrations` porte une colonne **`statements`** : les
instructions exactes de chaque migration appliquée, commentaires d'origine compris.

```sql
select name, version, array_to_string(statements, E'\n')
from supabase_migrations.schema_migrations
where name in ('…');
```

⚠️ **C'est très supérieur à la méthode que ce document recommandait** — reconstruire
depuis `pg_get_viewdef`, `pg_get_functiondef` et `information_schema`. Celle-ci ne rend
que l'état FINAL : elle ne peut pas distinguer « la colonne n'a jamais existé » de « elle
a été ajoutée puis retirée », et elle perd tous les commentaires, donc le *pourquoi*.

Utiliser `statements` en premier pour toute migration « appliquée sans fichier » :
la reconstitution devient une **copie**, pas une déduction. Ne garder l'inspection de
l'état que pour les migrations trop anciennes (les 185 d'avant la surveillance, dont
`statements` peut être vide).

Cas réel : `avatar_maj_le` et `retrait_avatar_maj_le` (05/09, colonne posée puis retirée
en quatre minutes, effet net nul). L'état de la base seul aurait fait conclure « rien à
reconstituer » — et aurait laissé deux trous permanents dans `migrations_sante`.

⚠️ **Le numéro de version ne peut PAS servir de clé** : celui de la base est généré par
l'outil d'application, celui du fichier est choisi à la main, et les deux ne coïncident
jamais (appliquée `20260903165006 inscrire_les_trois_crons_pg_cron`, fichier
`20260903190000_inscrire_les_trois_crons_pg_cron.sql`). **Cinq horodatages de fichiers
sont même en double** dans le dépôt.

⚠️ **Le dépôt n'a JAMAIS permis de reconstruire la base, et ce n'est pas nouveau.**
`supabase/migrations/` commence au 2026-07-18 et ne contient aucun schéma initial : les
tables `profiles`, `deals`, `calls` ne sont créées par aucun fichier. Relevé du
2026-09-03 : **282 migrations enregistrées en base, 114 fichiers, 185 sans fichier** — et
16 fichiers sans ligne à leur nom, dont la moitié sont des divergences de nommage
(`webhook_queue` contre `create_webhook_queue`, `purge_journaux_machine` contre
`purge_journaux_machine_pg_cron`). Ne pas énoncer « une reconstruction échouerait » comme
une conséquence des sept dernières : c'était déjà vrai.

⚠️ **CE PLANCHER DE DATE A ÉTÉ SUPPRIMÉ le 2026-09-04, et la vérification manuelle
ci-dessous n'est plus nécessaire.** Il portait sur `f.version`, l'horodatage du NOM DE
FICHIER — une valeur saisie à la main. `20260902100000_dernier_snapshot_par_profil.sql`,
écrit le 4 mais daté du 2, passait donc dessous : la vue ne pouvait pas le voir alors
qu'il faisait partie du même travail. Trouvé par la session Stats Clients, à la main.

**On ne borne pas une surveillance avec une valeur que son auteur choisit librement.**
Deux mécanismes le remplacent, aucun n'étant une date tapée par quelqu'un :

- **`migrations_du_depot.vu_le`** — le jour où le dépôt a montré le fichier pour la
  première fois. Posée à l'insertion, jamais mise à jour (la route ne l'envoie pas dans
  son `upsert`). Elle donne **4 heures de grâce** côté fichiers : écrire le fichier puis appliquer la
  migration est un ordre légitime, et sans grâce la vue crierait dans l'intervalle.
- **`migrations_ecarts_historiques`** — les quinze exceptions antérieures, **nommées une
  par une avec leur preuve**. Une liste fermée qui ne grandit jamais toute seule vaut
  mieux qu'une date qui laisse passer tout ce qui se présente avec le bon costume.

⚠️ **Les quinze ont été vérifiées présentes en base avant d'être gelées** : six sont
appliquées sous un nom voisin, six par la présence de la colonne qu'elles créent, trois —
des migrations de DONNÉES, sans empreinte de schéma — par leur **conséquence** (0
remboursement sans `paid_at`, 0 séquence portant encore un gabarit `{{…}}`, 0 call dont
l'`utm_medium` contredit sa source). Geler sans vérifier aurait transformé un angle mort
en angle mort *documenté*, ce qui est pire : on cesse de chercher.

⚠️ **Cette liste ne doit jamais grandir.** Une ligne de plus signifie qu'on a renoncé à
comprendre un écart, pas qu'on l'a résolu.

⚠️ **Et une marge d'UNE HEURE côté migrations appliquées**, ajoutée le 2026-09-04 après
que la vue se soit signalée elle-même. L'instantané peut être frais de trente secondes et
porter un contenu périmé : le trajet complet est `git push` → construction Vercel (1 à
5 min) → rafraîchissement horaire. Un rafraîchissement qui tombe entre le `push` et la
fin de la construction écrit un inventaire **daté de maintenant, bâti sur le dépôt
d'avant** — et la migration, plus ancienne que cette heure d'écriture, était jugée contre
lui. Une migration doit donc être plus vieille d'une heure que l'instantané pour être
jugée. Un vrai orphelin est signalé une heure plus tard ; l'alerte part par un e-mail
quotidien, ça ne change rien.

**Les deux branches ont maintenant chacune leur marge, et aucune ne repose sur une date
saisie à la main** — c'est le même principe des deux côtés : on ne juge pas un état tant
qu'on n'a pas la preuve de l'avoir observé après le fait.

⚠️ Leçon de méthode payée en route : trois de ces quinze avaient d'abord été déclarées
« absentes » parce que le nom de leur colonne avait été **deviné** au lieu d'être lu dans
le fichier. Une sonde inventée produit un faux négatif indiscernable d'un vrai.

`migrations_sante` ne surveille donc que le récent, et **chaque borne est posée là où la
mesure dit qu'elle ne produit aucun faux positif** — le détail et le motif sont dans
`20260903200000_migrations_sante.sql`. Surveiller tout l'historique donnerait ~200 lignes
permanentes, c'est-à-dire une alerte qu'on n'ouvre plus.

## ⚠️ « Personne ne lit cette colonne » a une date de péremption

Le 2026-08-28, quatre colonnes de `analytics_daily_snapshots` ont cessé d'être
alimentées — `shortio_clicks`, `shortio_human_clicks`, `shortio_top_countries`,
`shortio_top_referrers` — pour économiser deux appels Short.io par élève et par passage.
La justification écrite dans le code était : « Vérifié : AUCUN code et AUCUNE vue SQL ne
lit ces quatre colonnes. » **Elle était exacte.**

Le 2026-09-01, soit quatre jours plus tard, `stats_clients_series` a été créée et s'est
branchée sur `shortio_human_clicks`. Rien ne pouvait le signaler : la colonne existait
toujours, elle portait un nom parlant, et elle contenait des valeurs — figées au 28 août.

Constaté le 2026-09-06 : la carte « Clics » du portefeuille coach affichait **550 clics
pour un élève qui en avait 27**, et « aucune donnée » pour un élève qui en avait 20. Neuf
jours sans que rien n'alerte, pendant que la table vivante (`shortio_link_daily_snapshots`)
recevait 2 943 lignes.

**Une colonne qu'on cesse d'écrire mais qu'on laisse en place est un piège armé.** Elle
survit à la vérification qui l'a déclarée morte, et le prochain écran s'y branchera
d'autant plus volontiers que son nom est le bon. Trois gestes, par ordre de solidité :

1. **La supprimer** dans la même migration que l'arrêt de son écriture. Une colonne
   absente produit une erreur au premier `select` — le seul signal qui ne se périme pas.
2. Si elle doit rester (rattrapage possible, coût de migration), **la renommer**
   `<nom>_abandonnee_AAAAMMJJ`. Le nom porte alors la date, et un futur lecteur ne peut
   plus s'y brancher par mégarde.
3. À défaut, **`comment on column`** disant depuis quand elle n'est plus écrite. Le plus
   faible des trois : rien n'oblige à lire un commentaire.

⚠️ **Le corollaire pour toute nouvelle lecture.** Avant de brancher un écran sur une
colonne de snapshot, vérifier qu'elle est encore ÉCRITE — pas seulement qu'elle contient
des valeurs. La requête tient en une ligne, et elle aurait évité ces neuf jours :

```sql
select max(date) from analytics_daily_snapshots where <colonne> is not null;
```

Si la date n'est pas d'hier ou d'aujourd'hui, la colonne est morte, quoi qu'en dise son
contenu.

## ⚠️ Un `revoke` ne se maintient pas — l'invariant, si

Supabase pose des **privilèges par défaut** sur le schéma `public`
(`select * from pg_default_acl`) : `anon` et `authenticated` reçoivent `ALL` sur toute
table et toute vue **nouvellement créée**. Donc `create view` suffit à exposer une
donnée, sans qu'aucun `grant` n'apparaisse dans le diff.

Constaté le 2026-09-03 : la migration `20260902200000` avait fermé les 15 vues de santé
la veille ; **deux migrations du lendemain les ont rouvertes** — l'une par un `drop` +
`create` (privilèges par défaut), l'autre par un `grant … to authenticated` recopié.
`ventes_sante_sur_encaissement` est redevenue lisible **sans aucune session**, et comme
`security_invoker` vaut `false` par défaut, la RLS était contournée : les ventes, les
montants et les identifiants Stripe de tous les coachs.

**Ne jamais lire un `grant` comme une restriction.** Un `grant` ajoute, il n'enlève rien.
La seule façon de savoir ce qu'une relation autorise est de le demander à la base :

```sql
select has_table_privilege('anon', 'public.ma_vue', 'SELECT');
```

L'invariant qui remplace la vigilance, porté par `acces_sante_lecture` et alerté par
e-mail comme les autres vues :

> Toute relation de `public` que `anon` ou `authenticated` peut lire **doit appliquer la
> RLS** — `security_invoker = true` pour une vue, RLS activée pour une table.

Il n'énumère rien et ne dépend d'aucune convention de nommage : les défauts de Postgres
(ACL ouverte, `security_invoker` à false, RLS désactivée) font tomber toute relation
nouvelle **du mauvais côté**, donc dans la vue. Témoin positif joué : une vue créée sans
aucun `grant` y apparaît d'elle-même.

⚠️ **Ne PAS retirer les privilèges par défaut du schéma** (`alter default privileges …
revoke`) : les tables applicatives en dépendent — le navigateur les lit avec
`authenticated`, protégé par la RLS.

### Le même défaut existe pour les FONCTIONS, et il est plus discret

`create or replace function` préserve l'ACL — vérifié le 2026-09-06 sur
`stats_clients_series`, recréée deux fois sans que `anon` réapparaisse. **Mais ajouter
une colonne à un `returns table` change le type de retour, et Postgres refuse alors le
`replace` : il faut `drop` puis `create`.** À la recréation, les privilèges par défaut
du schéma re-accordent `execute` à `anon`, en silence.

⚠️ **`revoke … from public` ne couvre PAS ce cas.** `anon` est un rôle, `PUBLIC` en est
un autre — constaté à l'exécution : l'ACL portait `{postgres, anon, authenticated,
service_role}` après le `create`, alors que l'état d'avant n'avait pas `anon`. Après
tout `drop + create` de fonction, le `revoke … from anon` explicite est **obligatoire**.

La requête de contrôle :

```sql
select p.proname, p.prosecdef as definer, p.proacl::text
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proacl::text like '%anon=X%';
```

**Trier le résultat, ne pas le corriger en bloc.** Elle rend 6 lignes au 2026-09-06, et
aucune n'est une fuite — trois catégories, une seule à examiner :

- **Fonctions de trigger** (`set_updated_at`, `figer_detected_at`,
  `edge_empreinte_horodater_si_changee`) : sans argument et de type `trigger`, Postgres
  refuse de les appeler directement. `anon=X` y est inerte.
- **Sans argument et `invoker`** (`integrations_obligatoires`) : la RLS s'applique, il
  n'y a rien à faire fuir.
- **`SECURITY DEFINER` avec un argument** (`client_can_read_section`,
  `client_has_resource_access`) : **la seule catégorie à examiner**, parce qu'elle
  contourne la RLS et répond à une question sur une ressource précise — un oracle
  potentiel pour qui connaît un uuid.

Ces deux-là sont sûres, et c'est prouvé plutôt que déduit : elles filtrent sur
`ra.client_id = auth.uid()`, qui vaut NULL pour `anon`. Test joué le 2026-09-06 sur le
MÊME uuid, avec témoin positif — le propriétaire légitime obtient `true`, `anon` obtient
`false`. Sans le témoin positif, deux `false` n'auraient rien prouvé.

**Le critère à retenir** : ce qui rend `anon=X` dangereux n'est pas le droit d'exécuter,
c'est `SECURITY DEFINER` **combiné** à un paramètre qui désigne une ressource. Une
fonction `invoker` reste tenue par la RLS ; une fonction `definer` bornée par
`auth.uid()` ne peut rien dire à qui n'a pas de session.

⚠️ **`cron_runs` couvre désormais aussi `sync-calendly`** (ajouté le 2026-08-31 : ses
erreurs partaient dans une réponse HTTP que cron-job.org jette). Filtrer par
`fonction` pour savoir qui a échoué.

⚠️ **`/api/calendly/cron-sync` a été SUPPRIMÉE** le 2026-09-01. Elle portait un
commentaire « Cron Vercel 6h » qui n'a jamais été vrai — zéro appel en 24 h dans les logs
Vercel le 2026-08-31. Le vrai chemin est, et a toujours été, l'Edge Function
`sync-calendly`.



`base_sante_taille` surveille le **plan Supabase**, qui est aujourd'hui le **gratuit**
(500 Mo, base à 97 Mo le 2026-08-30). C'est le seul risque de la plateforme qui ne
prévient pas : rien ne casse à l'avance, les écritures échouent d'un coup. La vue
mesure la croissance réelle des trois tables « une ligne par contenu et par jour »
**et de `link_clicks`** (ajoutée le 2026-08-31 : une table qui grossit sans être
comptée fait partir l'alerte trop tard) et affiche les jours restants pour les deux
plans — passer en Pro ne demande donc aucune
modification. À 40 élèves × 300 posts, le gratuit tient ~6 semaines ; le Pro, ~2,5 ans.

**Et cette vue n'a pas besoin d'être regardée** : `/api/sante/alerte-stockage` envoie
un e-mail à 90 puis à 30 jours du plafond, chacun **une seule fois** (table
`alertes_plateforme`, réarmée d'elle-même si la situation redevient saine). Le mail
rappelle tout le contexte — il arrivera dans plusieurs mois. Déclenché par
`poll-leads` dans la tranche 8 h Paris : **aucun planificateur à créer**, et la clé
Resend ne quitte pas les variables Vercel.

```sql
select * from alertes_plateforme;   -- vide = aucun seuil encore franchi
```

⚠️ **La taille de la base n'est pas que de la donnée.** Alerte Disk IO reçue le
2026-08-30 : sur 112 Mo, **la moitié était du journal de machine** —
`net._http_response` 34 Mo pour 24 lignes vivantes (autovacuum passé une seule fois
en 25 jours, pages jamais réutilisées) et `cron.job_run_details` 19 Mo que pg_cron
ne purge jamais. Après nettoyage : **54 Mo**, et deux jobs quotidiens l'entretiennent.
Avant de conclure que « la base grossit », regarder QUI grossit :

```sql
select schemaname||'.'||relname, pg_size_pretty(pg_total_relation_size(relid)),
       n_live_tup, n_dead_tup, last_autovacuum
from pg_stat_all_tables order by pg_total_relation_size(relid) desc limit 10;
```

`ig_sante_insights_posts` surveille la collecte des contenus Instagram.
`depreciation_metrique_probable` = une métrique Meta vient de disparaître ; la
plateforme a déjà encaissé la perte toute seule, c'est une information, pas une
panne. `posts_muets_definitif` n'est **pas** une anomalie : Meta ne rend aucune
statistique sur les publications antérieures au passage en compte pro.

## ⚠️ Ce que l'API Insights d'Instagram accepte vraiment (mesuré, pas déduit)

La doc officielle ne suffit pas : elle annonce « User Metrics data is stored for up to
90 days » alors que l'API en sert **729**, et elle ne dit rien du cas d'une période en
cours. Tout ce qui suit a été mesuré contre l'API réelle le 2026-09-07, sur trois
comptes. La règle vit dans **`lib/meta-fenetre.ts`**, avec ses tests.

### La seule borne dure : 729 jours, sur `since`

```
J-726 … J-729 → ACCEPTÉ
J-730 …       → HTTP 400, code 100
                « since param is not valid. Metrics data is available for the last 2 years »
```

Testé jour par jour de J-726 à J-732. C'est la **seule** condition qui fasse échouer
l'appel, donc la seule à éviter avant d'appeler : un HTTP 400 est rejoué indéfiniment
par un appelant qui réessaie. Le code s'arrête à J-728, un jour de marge, parce que la
borne se déplace à minuit.

Deux non-limites, également mesurées : **pas de longueur maximale de fenêtre** (testé à
500 jours, valeur dédupliquée, aucune troncature silencieuse), et **le seuil des
100 abonnés ne s'applique pas** à `reach` + `breakdown=follow_type` — deux comptes à
0 abonné rendent leur mesure. Il ne concerne que `follower_count`, `online_followers` et
la démographie.

⚠️ Au-delà d'environ un an, `total_value.value` reste servi mais **la ventilation
`follow_type` revient VIDE** (0 ligne à J-500, J-700, J-729 ; 1 ou 2 lignes en deçà).
C'est ce qui justifie le plafond de 12 mois du rattrapage. Le parsing laisse alors
`abonnes` / `nonAbonnes` à `null` — un trou, jamais un zéro.

### ⚠️ Une réponse VIDE n'est pas une panne, et n'est pas définitive

C'est le piège qui a coûté le plus cher, et il s'est doublé d'une **erreur de
raisonnement qu'il faut connaître pour ne pas la refaire**.

Première mesure, un lundi matin, sur les trois comptes :

```
[hier        → hier]        → total_value PRÉSENT
[aujourd'hui → aujourd'hui] → total_value ABSENT
[hier        → aujourd'hui] → total_value PRÉSENT
```

Conclusion tirée : « une fenêtre sans journée TERMINÉE ne rend rien ». Trois lignes
cohérentes, trois comptes concordants, et deux hypothèses concurrentes réfutées au
passage. **C'était faux.** Quelques heures plus tard, le même appel sur le même compte
rend `valeur = 0`. Un balayage de `until` seconde par seconde (de 00:00:00 à J+2) donne
la même réponse partout : ce n'est ni `until`, ni la taille de la fenêtre, ni la
journée terminée.

**C'est l'HEURE.** Meta ne sert le seau d'une période qu'une fois qu'il a traité quelque
chose pour elle ; avant, il rend un jeu de données vide. Sa doc le dit, pour une raison
qu'on croyait sans rapport : « If insights data you are requesting does not exist or is
currently unavailable the API will return an empty data set instead of `0` ».

⚠️ **La leçon de méthode, plus utile que le fait lui-même** : trois observations
concordantes au même instant ne distinguent pas une règle d'un état transitoire. Il
manquait la seule variable qu'on n'avait pas fait varier — **le temps**. Devant un
comportement d'API, rejouer la même sonde plus tard avant d'en tirer une loi.

**Conséquence pour le code** : une réponse vide ne doit ni être traitée comme une
erreur, ni faire renoncer à appeler. Elle doit se **stocker** comme « pas encore
mesuré ».

### Le mode de panne : une ligne ABSENTE ne freine rien

Le 2026-09-07, la mesure de la semaine en cours levait tous les lundis. Aucune ligne
n'étant écrite, la règle de fraîcheur des 6 h n'avait rien à comparer et l'appel
repartait **à chaque synchro Instagram du profil** — une par heure, donc ~24 appels
Meta perdus par profil chaque lundi, et autant chaque 1er du mois.

⚠️ **Chiffre corrigé après coup, et l'erreur vaut d'être retenue.** La première version
de cette section annonçait « 288 appels par jour » : c'était le nombre de passages de
`poll-leads` (toutes les 5 min), pas le nombre d'appels Meta. Le bloc Instagram entier
est gaté par `igDoitSync` / `IG_INTERVALLE_MS`, une fois par heure et par profil.
**Un compteur de passages du cron n'est pas un compteur d'appels d'API** — vérifier
quelle garde enferme le code avant de multiplier.

Trois gardes ferment la boucle, et il faut les trois :

| Cas | Conduite |
|---|---|
| À la clôture (`figee`) | **lever** — ne jamais figer un vide, il deviendrait indiscernable d'une portée nulle |
| En cours, ligne déjà présente | **ne toucher à rien**, et noter l'essai |
| En cours, aucune ligne | **écrire la ligne à valeurs nulles** |

⚠️ Le deuxième cas est le moins évident et le plus dangereux : l'écriture est un
`delete` + `insert`. Sans ce retour anticipé, un simple hoquet de Meta **efface une
mesure réelle** pour la remplacer par du vide, toutes les 6 heures.

⚠️ Et `dernier_essai_le` est une colonne SÉPARÉE de `mesure_le`, délibérément. Une ligne
périmée que Meta ne sert pas relancerait l'appel à chaque passage ; rafraîchir
`mesure_le` à la place aurait éteint **pour toujours** la branche « période courante
figée » de `ig_sante_periodes` — exactement le piège déjà documenté plus haut sur
`edge_sante_version`. Deux questions, deux colonnes :

```
mesure_le         quand la portée a été RÉELLEMENT obtenue  → sert la surveillance
dernier_essai_le  quand on a appelé Meta, succès ou non     → sert la cadence
```

### Une surveillance ne doit pas juger un état plus jeune que son premier instant observable

`ig_sante_periodes` avait deux branches et une seule portait l'intention de son auteur :
« figée » attendait 24 h, « jamais mesurée » déclenchait à l'instant du basculement de
`date_trunc('week', now())`. D'où un e-mail d'alerte **garanti chaque lundi et chaque
1er du mois** (~64 jours/an, par élève) sur un état normal et inévitable.

Corrigé : soit `D = greatest(debut_attendu, depart_integration)`, l'alerte ne part qu'à
`D+2` — les mêmes 24 h que la branche voisine, comptées depuis le premier moment
observable. `greatest` ignore les NULL, ce qui rend `all_time` (sans `debut_attendu`)
uniforme avec les deux autres. Si les deux ancres sont NULL, l'alerte part comme avant :
**une ignorance ne doit pas fabriquer du silence.**

⚠️ **La contrepartie est obligatoire** : puisque le cron écrit désormais une ligne à
valeurs nulles, la vue devait apprendre à voir `reach_total is null` — sinon on
remplaçait une fausse alerte par un **angle mort**, strictement pire, la fausse alerte
ayant au moins le mérite de se voir.

⚠️ **Cette grâce ne cache aucune panne durable** : les lignes `mois` et `all_time` du
même profil sont rafraîchies toutes les 6 h ; si Meta tombe, leur branche « figée »
alerte à 24 h. La branche corrigée n'était pas le seul détecteur, seulement le seul à
crier sur du normal.

C'est le même principe que `edge_sante_version` (« en attente du prochain passage ») et
que les deux marges de `migrations_sante` : **on ne juge pas un état tant qu'on n'a pas
la preuve de l'avoir observé après coup.** Trois surveillances ont eu ce défaut ; devant
une nouvelle vue, se demander d'emblée quel est son premier instant observable.

⚠️ **Le corollaire piégeux** : faire taire la vue sans corriger le cron aurait rendu ces
appels perdus **invisibles** au lieu de les arrêter. Une fausse alerte est parfois le
seul symptôme visible d'un vrai gaspillage — corriger les deux côtés, ou aucun.

### Une lecture tronquée doit être triée

`majPeriodesIg` lisait les périodes non figées avec `.limit(20)` **sans `order`**. La
troncature était donc arbitraire, et cette lecture sert deux questions : trouver les
périodes à clôturer, ET savoir si la période EN COURS doit être rafraîchie. Si la
période courante tombait hors du lot, elle était réécrite **à chaque passage** au lieu
de toutes les 6 h.

Triée par `fin` décroissant : les périodes en cours ont la `fin` la plus lointaine, donc
elles sont toujours en tête et ne peuvent pas être évincées. Le tri inverse serait le
piège. Règle générale : **un `limit` sans `order` est un bug qui attend son volume.**

`stripe_sante_rattachement` liste les encaissements que Stripe connaît et qu'aucune
vente ne revendique. ⚠️ Elle ne voit QUE ce qu'un chemin d'écriture a déjà enregistré :
un webhook jamais délivré ne laisse aucune trace et reste invisible ici. Seule la passe
quotidienne de `sync-stripe-payments` ferme ce trou-là, en rapportant chez nous ce que
Stripe sait. Les deux sont complémentaires, ni l'un ni l'autre ne suffit.

⚠️ **Stripe a retiré le lien charge ↔ facture.** Mesuré contre l'API réelle le
2026-08-31 sur `2026-04-22.dahlia` : `charge.invoice`, `invoice.charge`,
`invoice.payment_intent` et `payment_intent.invoice` sont **tous absents**. Le seul lien
restant est `invoice.payments` sous `expand`, au prix d'un appel par facture. Ne pas
réessayer de rattacher une charge à sa facture — et ne pas s'en inquiéter : une charge
d'abonnement porte `metadata: {}`, donc elle ne se rattache à aucun deal et n'écrit rien.
C'est `ventes_sante_sur_encaissement` qui garde le cash, pas une garde à l'écriture.

⚠️ **Le cash a UNE seule règle : `lib/dealCash.ts`.** Ne jamais sommer des paiements à
la main. Sept lectures le faisaient encore le 2026-08-30 (`.eq('status','succeeded')`
puis une somme) et n'ont donc JAMAIS déduit un remboursement : 2 800 € affichés pour
2 600 € en caisse. `calculerCash().net` pour « ce qui reste dans la caisse »,
`encaisseRetenu()` pour « quelle part d'une vente est rentrée » — la seconde plafonne
au montant contracté, sinon un trop-perçu fait dépasser 100 % et vient effacer la dette
d'un autre client dans les totaux.

## ⚠️ « VERSÉ PAR LE CLIENT » N'EST PAS « RESTÉ DANS LA CAISSE »

**Neuf écrans ont confondu les deux les 6 et 7 septembre 2026**, et la conséquence était
toujours la même : réclamer une seconde fois un argent déjà payé.

```
net              = encaissé − remboursé − contesté − perdu en litige
verseParLeClient = encaissé − remboursé
```

Un **remboursement** fait baisser les deux : l'argent sort de la caisse ET retourne chez
le client, qui peut donc redevoir. Un **litige** ne fait baisser que le premier — la
banque retient, mais le client a bien versé. **Il ne doit rien.**

| La question posée | La grandeur |
|---|---|
| combien me reste-t-il ? | `cash.net` |
| combien me doit-il **encore** ? | `verseParLeClient()` |
| combien puis-je lui **rendre** ? | `cash.net` — on ne rend que ce qu'on tient |

⚠️ `resteAEncaisser()` prend donc le **versé** et `aRembourser()` le **net** : cette
asymétrie est délibérée, ne pas « harmoniser » les deux.

Le détail des neuf endroits, et le modèle `dispute_lost` qui en découle, sont dans
`docs/stripe-paiements.md` §1.

## ⚠️ Une règle ne doit vivre qu'à UN endroit — `npm test` le vérifie

Les 6 et 7 septembre 2026, **onze défauts** ont été trouvés sur les paiements. Tous, sans
exception, avaient la même forme : *une règle posée d'un côté d'une partition, oubliée de
l'autre* — `modeDe` corrigé dans l'écran mais pas dans la route, `refreshDealStatus`
recopié dans deux routes, la règle du cash absente du SQL, le garde « vente signée »
lisant `deals` d'un côté et `calls.deal_closed` de l'autre…

**Aucun n'était visible en relisant le fichier qu'on modifiait.** Ils vivaient dans
l'autre fichier, celui qu'on n'ouvrait pas.

```bash
npm run verifier-regles-uniques    # tourne dans `npm test`
```

Trois motifs, chacun mesuré sur le dépôt avant d'être retenu : une somme de paiements à
la main, un ternaire qui décide `'paid'`, un `refreshDealStatus` local. Il a trouvé une
dixième occurrence à son premier passage.

⚠️ **Ne JAMAIS allonger sa liste d'exceptions pour le faire passer.** La correction est
de supprimer la copie, pas de la déclarer légitime.

⚠️ **Il ne couvre ni le SQL, ni les gardes métier, ni deux écrans qui posent la même
question autrement.** Le seul filet général reste le réflexe : **devant un défaut trouvé
DEUX fois, chercher immédiatement tous les endroits où il peut se produire**, au lieu
d'en corriger un troisième. C'est ce réflexe qui a sorti les six derniers d'un coup.

⚠️ **Une règle de cash vit potentiellement à TROIS endroits** — `lib/dealCash.ts` (Node),
sa copie Deno, et le SQL (`ventes_cash_net`, `cash_regles_statut`). Le troisième est
invisible depuis TypeScript : l'ajout de `dispute_lost` l'a oublié. **Avant d'ajouter une
valeur à une colonne de statut, `grep` sur le NOM DE LA COLONNE, pas sur le nom du
module.**

⚠️ **La règle vaut aussi pour les requêtes de VÉRIFICATION**, et c'est là qu'on l'oublie.

Le 2026-09-06, deux sessions ont contrôlé les mêmes chiffres de l'onglet Revenus avec
deux requêtes SQL écrites à la main. L'une déduisait `refunded` mais pas `disputed`,
l'autre les deux — d'où deux « vérités » et une heure passée à chercher laquelle des
deux avait raison. Personne n'avait touché au code : les cinq écrans passaient déjà
par `calculerCash`.

C'est exactement l'erreur que ce paragraphe documente depuis le 2026-08-30, reproduite
dans **l'outil censé la détecter**. Une requête de contrôle qui somme les paiements à
la main n'est pas une vérification : c'est une sixième implémentation de la règle, non
testée, et qui contredira les cinq autres au premier statut ajouté par Stripe.

En SQL, les trois statuts qui sortent de la caisse sont `refunded`, `disputed` et — le
jour où il apparaîtra — celui que Stripe n'a pas encore inventé. Un contrôle honnête
les énumère explicitement et se relit à côté de `lib/dealCash.ts`, ou n'existe pas.

⚠️ **Corollaire sur le DIAGNOSTIC.** Devant deux mesures qui divergent, la première
hypothèse tentante est « les données ont bougé depuis ». Elle est confortable et
invérifiable. Le 2026-09-06, elle a été avancée à tort : les contestations dataient de
la veille 19h24, donc antérieures aux deux mesures. La divergence venait de la requête,
pas du temps. **Avant d'accuser l'horloge, comparer les deux requêtes.**

`ventes_sante_montants` compare les DEUX écritures du cash : le montant saisi dans le
rapport de call et le deal qui en découle. Les écrans lisent `deals` ; une ligne ici
signifie qu'un élève a saisi un montant que ses stats n'affichent pas.

`ventes_sante_contenu` compare les DEUX lectures de l'attribution d'une vente :
`deals.first_touch_content_id`, que lisent les **quatre routes de paiement**
(`payments/by-origin`, `payments/chain`, `payments/deals/[id]/amount` et `/terms`), et
le contenu que porte le **call**, que Business micro recalcule via `contenuConversion()`
— `utm_content`, puis repli sur `prospect_links.content_id`. La colonne est une copie
figée à la création du deal ; tant qu'elle concorde personne ne voit rien, et le jour où
elle diverge le même euro est crédité à deux contenus différents selon l'écran. C'est le
mécanisme d'`instagram_leads` : une copie que personne ne confronte à sa source finit par
mentir. ⚠️ `vente sans rendez-vous` n'est **pas** une anomalie — un upsell n'a aucun call,
donc aucun contenu à créditer, et il est exclu de Business micro pour cette raison.

`ventes_sante_date` vérifie que `deals.signed_at` porte la **tenue d'un rendez-vous**
du prospect, et non l'instant de saisie du rapport — le défaut corrigé le 2026-09-01,
où quatre ventes portaient 20/08 21h47 pour un rendez-vous du 19/08 13h30.

⚠️ Elle ne réimplémente **pas** la règle. Celle-ci vit dans `dateDeVente`
(`lib/callSeries.ts`) et suppose de reconstruire les chaînes d'opportunité ; la réécrire
en SQL créerait une troisième version qui dériverait des deux autres en silence. La vue
teste une **conséquence** : quel que soit le rendez-vous que la règle choisit,
`signed_at` doit tomber pile sur la tenue de l'un d'eux. Un instant de saisie ne tombe
jamais pile sur un créneau. `vente sans rendez-vous` et `rapportée avant le rendez-vous`
ne sont **pas** des anomalies.

**Dette à lever, pas maintenant.** Business micro et Funnel & Calls recalculent la date
au lieu de lire la colonne, parce qu'elle était fausse. Elle ne l'est plus. Quand cette
vue aura tourné un moment sans alerte, les deux recalculs deviendront supprimables au
profit d'une simple lecture de `signed_at`. Tant que ce délai n'est pas écoulé, garder
les deux versions est une sécurité, pas une redondance.

⚠️ **`analytics_daily_snapshots` mélange TROIS natures, et deux noms de colonnes
mentent.** Relevé le 2026-09-01 en préparant Stats Clients :

| Colonnes | Nature réelle | Agrégation correcte |
|---|---|---|
| `ig_followers`, `yt_subscribers` | niveau (photo du jour) | **dernière** valeur non nulle de la fenêtre |
| `ig_views`, `shortio_human_clicks`… | flux quotidien | **somme** |
| `calls_booked`, `calls_honored`, `deals_closed`, `revenue` | **cumul depuis le début** | **dernière** valeur, ou `last − first` pour l'écart |
| `ig_reach` | dédupliqué par Meta | **aucune** — la somme compte deux fois la même personne |

`poll-leads` écrit les quatre colonnes business avec `calls.filter(...).length` sur tout
l'historique, réécrit à chaque passage. Preuve en base sur `a02e5927` : `revenue` vaut
`12000.00` **tous les jours** du 20 au 31 août. Les sommer sur 30 jours donnerait
360 000 € au lieu de 12 000. Leur nom suggère un flux, leur contenu est un cumul.

Deuxième raison de ne pas les lire : elles dérivent de `calls.revenue`, alors que depuis
le 2026-08-20 tous les écrans lisent `deals`. Pour les calls, les ventes et le cash, aller
aux tables sources avec les règles de `docs/perimetre-stats-referentiel.md`.

`mrr` n'est **jamais** écrite (0 ligne renseignée sur 265) — ne pas la lire non plus.

`clics_sante_redirection` compare, par lien, les clics comptés par Short.io à ceux
comptés par la route `/r/` qui pose le Click ID sur les liens Calendly **partagés**
(`docs/click-id.md`). ⚠️ Elle détecte une **panne**, pas une parité exacte : les deux
filtres à robots ne classeront jamais identiquement, et prétendre à l'égalité
produirait une alerte permanente. `lien non redirige` n'est **pas** une anomalie — la
réécriture n'a pas encore atteint ce lien. C'est aussi cette vue qui rend un échec
d'écriture non silencieux : on ne peut pas journaliser une panne de base dans la base.

⚠️ Sur les vues de santé, `etat <> 'ok'` n'est **pas** un filtre d'anomalie :
`non_connectee` et `integration deconnectee` disent seulement que l'intégration n'est
pas branchée. Les chercher comme des pannes fait remonter 23 faux positifs.
