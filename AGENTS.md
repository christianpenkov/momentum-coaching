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
- **Toucher un lien Short.io, la route `/r/`, ou l'attribution d'un rendez-vous
  venu d'un lien PARTAGÉ** (bio, description, story) → `docs/click-id.md`. Les UTM
  reportés sur la destination ne sont pas décoratifs : sans eux, les clics de bio
  disparaissent des stats et ceux de description sont comptés en « Cold DM ».
- **Renommer le projet Vercel, ou changer le domaine de la plateforme** →
  `docs/click-id.md`, section « La procédure complète, le jour où l'origine change ».
  L'adresse du projet est écrite dans la **destination de tous les liens partagés** :
  la changer sans rejouer le script de réécriture casse d'un coup le lien de bio de
  chaque élève, celui qu'aucune édition de publication ne rattrape.
- **Changer une règle de comptage, ou trouver une décision bizarre dans les stats** →
  `docs/pourquoi-ces-choix-stats.md` **avant** `docs/perimetre-stats-referentiel.md`. Le
  second dit ce que fait la plateforme, le premier dit **pourquoi ces choix plutôt que
  d'autres**, et surtout ce qu'on a failli faire à la place. Une règle sans son motif se
  fait supprimer par la première personne qui la trouve gênante. Trois décisions y sont
  volontairement contre-intuitives : le grain du no-show, les deux dates sur le même
  écran, et les deux tableaux qui affichent des nombres différents pour ce qui ressemble
  à la même chose.
- **Auditer des chiffres affichés** → skill `audit-metrique-bout-en-bout`
  (`~/.claude/skills/`). La méthode API → base → écran, et les six pièges
  récurrents.

# ⚠️ Un `profile_id` est PUBLIC

Depuis le 2026-08-31, le `profile_id` de l'élève est inscrit dans la destination de
chaque lien Calendly partagé (bio Instagram, description YouTube) — voir
`docs/click-id.md`. **Un `profile_id` reçu d'un appelant n'est donc jamais une preuve
d'identité** : authentifier d'abord, vérifier l'ownership ensuite, jamais un `.eq()` sur
l'identifiant reçu tel quel. Détail et motif dans `docs/security-notes.md`.

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

⚠️ Une ALERTE juste après un déploiement, elle, est significative : elle veut dire que la
fonction remonte une empreinte que le dépôt ne connaît pas — donc qu'on a déployé sans
régénérer, ou depuis une copie de travail non poussée.

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

⚠️ **`poll-leads`, `sync-calendly` et `sync-stripe-payments` ne remontent pas encore leur
empreinte** : leurs fichiers portaient le travail en cours d'une autre session le
2026-09-03, et on ne modifie pas le fichier d'autrui. À brancher quand ce chantier
atterrit — une ligne, sur le modèle des quatre autres :
`rpc('marquer_passage_cron', { p_nom: '<nom>', p_empreinte: EMPREINTES_EDGE['<nom>'] })`.

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

### Un cron est « zéro maintenance » quand son SILENCE est détectable

Pas quand il tourne au bon endroit. `cron_runs` ne journalise que les **échecs**,
volontairement — mais un cron qui ne tourne plus n'échoue pas, il se tait, et un silence
ne se distingue pas d'un succès.

```sql
select * from crons_sante;   -- aucune ligne 'SILENCIEUX' = les crons inscrits tournent
```

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
select * from cron_runs order by ran_at desc;   -- vide = aucun incident (30j)
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
```

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
2 600 € en caisse. `calculerCash().net` pour « ce qu'une personne a versé »,
`encaisseRetenu()` pour « quelle part d'une vente est rentrée » — la seconde plafonne
au montant contracté, sinon un trop-perçu fait dépasser 100 % et vient effacer la dette
d'un autre client dans les totaux.

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
