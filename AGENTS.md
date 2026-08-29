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

# Santé de la plateforme

```sql
select * from cron_runs order by ran_at desc;   -- vide = aucun incident (30j)
select * from yt_sante_donnees;                 -- 'ok' partout
```
