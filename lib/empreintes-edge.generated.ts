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
  'backfill-shortio': '743e18acbe2fac1a', // 6 fichiers
  'call-reminders': 'dc3af4d46473993a', // 5 fichiers
  'fathom-cron-sync': '1cd05d8688d4311d', // 5 fichiers
  'installment-reminders': '1a97e0c70a5269a3', // 4 fichiers
  'notify-rapport': 'f00f8ccd335dabe5', // 6 fichiers
  'poll-leads': '54b3dc7080e14cd2', // 14 fichiers
  'poll-stories': 'c8a09d3300a61342', // 6 fichiers
  'refresh-ig-posts': 'ff549bf709d42113', // 6 fichiers
  'send-pending-dm3': '6118c21c43e3cb78', // 5 fichiers
  'sync-calendly': '53f0348035f228fa', // 5 fichiers
  'sync-stripe-payments': 'a86998e85859d5a0', // 6 fichiers
};

/** L'empreinte d'une fonction, ou `null` si elle n'est pas dans le depot. */
export function empreinteDe(nom: string): string | null {
  return EMPREINTES_EDGE[nom] ?? null;
}
