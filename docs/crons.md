# Les crons

Extrait d'`AGENTS.md` le 2026-09-12, mot pour mot. Il y occupait 318 lignes que
chaque session chargeait, alors qu'on n'en a besoin qu'en touchant un cron.

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

