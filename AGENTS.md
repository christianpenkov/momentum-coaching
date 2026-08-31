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
- **Auditer des chiffres affichés** → skill `audit-metrique-bout-en-bout`
  (`~/.claude/skills/`). La méthode API → base → écran, et les six pièges
  récurrents.

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

## Vérifier qu'une Edge Function tourne bien le code du dépôt

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

## pg_cron — dans la base (relevé le 2026-08-30)

| Job | Fréquence | Pourquoi ici et pas ailleurs |
|-----|-----------|------------------------------|
| `call-reminders-15min` | `*/15 * * * *` | Edge Function, pas de dépendance externe |
| `send-pending-dm3-1min` | `* * * * *` | Chemin critique à la minute |
| `process-webhook-queue-1min` | `* * * * *` | Chemin critique à la minute |
| `purge-debug-logs` | 3h30 | **SQL pur, aucune URL** |
| `purge-webhook-queue-daily` | 3h35 | **SQL pur, aucune URL** |
| `purge-call-rapport-drafts-daily` | 3h45 | **SQL pur, aucune URL** |
| `purge-journaux-machine-daily` | 3h50 | **SQL pur** — retient 7 j de `cron.job_run_details` |
| `vacuum-pg-net-daily` | 3h55 | **SQL pur** — empêche les tables pg_net de regonfler |

Les trois purges sont des `SELECT public.purge_*()`. Les déplacer sur un planificateur
externe imposerait de **créer une route HTTP pour chacune** et d'exposer sur Internet
des opérations de purge — plus de code, plus de surface d'attaque, pour un ménage qui
aujourd'hui ne dépend de rien. Les deux jobs à la minute restent ici pour la même
raison de robustesse : pas de saut réseau, pas de compte tiers dans le chemin critique.

## cron-job.org — hors de la base

Sync Calendly (30 min) · Notify rapport call (30 min) · `poll-leads` (5 min) ·
`poll-stories` (30 min) · `installment-reminders` (1×/jour) ·
`/api/stripe/cron-health` (1×/jour).

⚠️ **`sync-stripe-payments` est À CRÉER — 4 h 00 UTC.** C'est le filet du cash : il
relit les paiements chez Stripe pour rattraper ce qu'un webhook non délivré a manqué.
Sans lui, le webhook est l'unique chemin d'écriture et un événement perdu l'est pour
toujours, sans aucun signal — trois encaissements du compte de test étaient dans ce
cas, et le premier passage réel les a ramenés.

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

```sql
select * from cron_runs order by ran_at desc;   -- vide = aucun incident (30j)
select * from yt_sante_donnees;                 -- 'ok' partout
select * from integrations_sante;               -- 'ok' ou 'non_connectee'
select * from ventes_sante_montants;            -- vide = rapport et deal concordent
select * from stripe_sante_rattachement;        -- vide = chaque encaissement a sa vente
select * from ventes_sante_sur_encaissement;    -- vide = aucun deal n'a encaisse 2x
select * from ig_sante_insights_posts;          -- 'ok' partout
select * from base_sante_taille;                -- 'ok' = plafond de stockage loin
```

⚠️ **`cron_runs` couvre désormais aussi `sync-calendly`** (ajouté le 2026-08-31 : ses
erreurs partaient dans une réponse HTTP que cron-job.org jette). Filtrer par
`fonction` pour savoir qui a échoué.

⚠️ **`/api/calendly/cron-sync` est du CODE MORT** malgré son commentaire « Cron
Vercel 6h » — zéro appel en 24 h dans les logs Vercel le 2026-08-31. Le vrai chemin
est l'Edge Function `sync-calendly`. Même piège que `notify-rapport`.



`base_sante_taille` surveille le **plan Supabase**, qui est aujourd'hui le **gratuit**
(500 Mo, base à 97 Mo le 2026-08-30). C'est le seul risque de la plateforme qui ne
prévient pas : rien ne casse à l'avance, les écritures échouent d'un coup. La vue
mesure la croissance réelle des trois tables « une ligne par contenu et par jour » et
affiche les jours restants pour les deux plans — passer en Pro ne demande donc aucune
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

⚠️ Sur les vues de santé, `etat <> 'ok'` n'est **pas** un filtre d'anomalie :
`non_connectee` et `integration deconnectee` disent seulement que l'intégration n'est
pas branchée. Les chercher comme des pannes fait remonter 23 faux positifs.
