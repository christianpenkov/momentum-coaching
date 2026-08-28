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
  chargement** → `docs/pastille-et-sauts-accueil.md`. Neuf bugs, un seul
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

# Santé de la plateforme

```sql
select * from cron_runs order by ran_at desc;   -- vide = aucun incident (30j)
select * from yt_sante_donnees;                 -- 'ok' partout
```
