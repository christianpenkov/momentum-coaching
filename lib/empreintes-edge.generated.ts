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
  'backfill-shortio': 'b3f9d7918e7a77ab', // 2 fichiers
  'call-reminders': '47afa99fe15efa29', // 2 fichiers
  'fathom-cron-sync': '7d8ac493e72f64ce', // 1 fichier
  'installment-reminders': 'be99ea92fdb0aab4', // 1 fichier
  'notify-rapport': '1f2f6a0dce0f433b', // 2 fichiers
  'poll-leads': '1eba5a6a6b7fc91a', // 7 fichiers
  'poll-stories': '8dec82c5f2fe74e6', // 2 fichiers
  'refresh-ig-posts': 'e3689052b0aff79d', // 2 fichiers
  'send-pending-dm3': '7c0268bf583fc300', // 2 fichiers
  'sync-calendly': '6ef2dcbaf1d83b83', // 2 fichiers
  'sync-stripe-payments': '0821e114269740f4', // 3 fichiers
};

/** L'empreinte d'une fonction, ou `null` si elle n'est pas dans le depot. */
export function empreinteDe(nom: string): string | null {
  return EMPREINTES_EDGE[nom] ?? null;
}
