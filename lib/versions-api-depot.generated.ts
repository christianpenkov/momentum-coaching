// GENERE — ne pas modifier a la main.
//
// Reecrit par `node scripts/manifeste-versions-api.mjs`, et automatiquement par
// `npm run prebuild` (donc a chaque construction Vercel). Le motif est dans l'en-tete du
// script : la base ne lit pas le depot, cette liste est le pont qui permet a
// `versions_api_sante` de prevenir avant qu'une version d'API expire.

export const VERSIONS_API_DEPOT: { fournisseur: string; version: string; occurrences: number; fichiers: string[] }[] = [
  {
    "fournisseur": "meta-graph",
    "version": "v21.0",
    "occurrences": 43,
    "fichiers": [
      "app/api/instagram/check-subscriptions/route.ts",
      "app/api/instagram/debug/route.ts",
      "app/api/instagram/messages/route.ts",
      "app/api/instagram/register-webhook/route.ts",
      "app/api/instagram/test-full-workflow/route.ts",
      "app/api/instagram/test-private-reply/route.ts",
      "app/api/oauth/instagram/callback/route.ts",
      "lib/ig-fetch.ts",
      "lib/instagram-webhook-processor.ts",
      "supabase/functions/poll-leads/index.ts",
      "supabase/functions/send-pending-dm3/index.ts"
    ]
  },
  {
    "fournisseur": "meta-graph",
    "version": "v22.0",
    "occurrences": 68,
    "fichiers": [
      "app/api/client/stories/live-refresh/route.ts",
      "app/api/instagram/debug/route.ts",
      "app/api/instagram/online-followers-test/route.ts",
      "app/api/instagram/stats/route.ts",
      "app/api/instagram/test-commenter-info/route.ts",
      "app/api/instagram/test-interactions/route.ts",
      "app/api/instagram/test-profile-views/route.ts",
      "app/api/instagram/test-reach-breakdown/route.ts",
      "app/api/instagram/test-stories/route.ts",
      "app/api/instagram/test-virality/route.ts",
      "app/api/oauth/instagram/callback/route.ts",
      "lib/ig-fetch.ts",
      "lib/igPostMeta.ts",
      "lib/instagram-avatar.ts",
      "lib/instagram-webhook-processor.ts",
      "supabase/functions/_shared/ig-posts.ts",
      "supabase/functions/poll-leads/index.ts",
      "supabase/functions/poll-stories/index.ts"
    ]
  },
  {
    "fournisseur": "meta-graph",
    "version": "v23.0",
    "occurrences": 3,
    "fichiers": [
      "app/api/coach/ig-piece-jointe/route.ts",
      "app/api/instagram/backfill-conversations/route.ts"
    ]
  }
];
