// GENERE — ne pas modifier a la main.
//
// Reecrit par `npm run empreintes-edge`, et automatiquement par `npm run prebuild`
// (donc a chaque construction Vercel) et par `npm run deployer-edge <nom>` juste avant
// l'envoi. Aucun test ne garde ce fichier : il n'a pas a etre a jour dans le depot, il
// a a etre a jour AU MOMENT DU DEPLOIEMENT — c'est la valeur qu'il portait alors que le
// bundle fige, et c'est elle qu'on compare.
//
// Le motif complet est dans l'en-tete de `scripts/empreintes-edge.mjs` : une Edge
// Function ne part pas avec `git push`, et rien ne savait dire qu'une fonction en ligne
// etait plus vieille que le code. L'empreinte couvre `index.ts` ET la cloture de ses
// imports locaux, parce qu'un deploiement fige sa propre copie des modules partages.
//
// ⚠️ Chaque valeur ne change que si le code de CETTE fonction change. Ce n'est pas un
// identifiant de commit : un identifiant de commit bougerait a chaque commit et
// l'alerte crierait en permanence.

export const EMPREINTES_EDGE: Record<string, string> = {
  'backfill-shortio': 'a91eceb0fdf89af7', // 3 fichiers
  'call-reminders': '040653d2bff3c376', // 2 fichiers
  'fathom-cron-sync': 'a297c9d3ed787bc0', // 2 fichiers
  'installment-reminders': '7f085fee077de117', // 1 fichier
  'notify-rapport': 'e4a81ea7cd76e171', // 2 fichiers
  'poll-leads': 'f9bd6ac39d8b2ebb', // 7 fichiers
  'poll-stories': '8dec82c5f2fe74e6', // 2 fichiers
  'refresh-ig-posts': '2c8ad1014828b970', // 2 fichiers
  'send-pending-dm3': 'c1991512bba58e3e', // 2 fichiers
  'sync-calendly': '88ea7a5772a022d4', // 2 fichiers
  'sync-stripe-payments': '0f6c66420309f9f2', // 3 fichiers
};

/** L'empreinte d'une fonction, ou `null` si elle n'est pas dans le depot. */
export function empreinteDe(nom: string): string | null {
  return EMPREINTES_EDGE[nom] ?? null;
}
