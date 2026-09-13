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
  'backfill-shortio': '061f1920761d74bf', // 6 fichiers
  'call-reminders': '65cbf3d373ebca88', // 5 fichiers
  'fathom-cron-sync': '4c0aa99dbc44d43e', // 5 fichiers
  'installment-reminders': '3e7d76b71e85ce74', // 4 fichiers
  'notify-rapport': '907ca2bfb3a5fece', // 6 fichiers
  'poll-leads': '89ec60dbd89dc608', // 14 fichiers
  'poll-stories': '5768ab3bcc6d8a96', // 6 fichiers
  'refresh-ig-posts': 'e1f27e139e903b54', // 6 fichiers
  'send-pending-dm3': 'eab7c0ffeef828a7', // 5 fichiers
  'sync-calendly': '834ebd6fafe60065', // 5 fichiers
  'sync-stripe-payments': '7907fe68b584d8ab', // 6 fichiers
};

/** L'empreinte d'une fonction, ou `null` si elle n'est pas dans le depot. */
export function empreinteDe(nom: string): string | null {
  return EMPREINTES_EDGE[nom] ?? null;
}
