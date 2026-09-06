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
  'fathom-cron-sync': 'f54b27849168c9ea', // 2 fichiers
  'installment-reminders': '582c250539335519', // 1 fichier
  'notify-rapport': '1cbc00fa320a8ca7', // 3 fichiers
  'poll-leads': '63d5f5d60bc2e8ae', // 10 fichiers
  'poll-stories': '27cac0979644c9df', // 3 fichiers
  'refresh-ig-posts': '6a623b254d72daa3', // 3 fichiers
  'send-pending-dm3': '339fd254c0b8a26e', // 2 fichiers
  'sync-calendly': 'e837bd06b56ba4aa', // 2 fichiers
  'sync-stripe-payments': 'eba10632afc18876', // 3 fichiers
};

/** L'empreinte d'une fonction, ou `null` si elle n'est pas dans le depot. */
export function empreinteDe(nom: string): string | null {
  return EMPREINTES_EDGE[nom] ?? null;
}
