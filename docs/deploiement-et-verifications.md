# Déployer et vérifier

Extrait d'`AGENTS.md` le 2026-09-12, mot pour mot. Il y occupait 222 lignes que
chaque session chargeait, alors qu'on n'en a besoin qu'en déployant.

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

