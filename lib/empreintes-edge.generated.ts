// GENERE — ne pas modifier a la main.
//
// `node scripts/empreintes-edge.mjs` le reecrit ; `npm test` echoue s'il est perime.
// Le motif complet est dans l'en-tete de ce script : une Edge Function ne part pas avec
// `git push`, et rien ne savait dire qu'une fonction en ligne etait plus vieille que le
// code. L'empreinte couvre `index.ts` ET la cloture de ses imports locaux, parce qu'un
// deploiement fige sa propre copie des modules partages.
//
// ⚠️ Chaque valeur ne change que si le code de CETTE fonction change. Ce n'est pas un
// identifiant de commit : un identifiant de commit bougerait a chaque commit et
// l'alerte crierait en permanence.

export const EMPREINTES_EDGE: Record<string, string> = {
  'backfill-shortio': 'b3f9d7918e7a77ab', // 2 fichiers
  'call-reminders': '310c7c0ed88d4af1', // 2 fichiers
  'fathom-cron-sync': '7d8ac493e72f64ce', // 1 fichier
  'installment-reminders': '4a321a5e996cb16a', // 1 fichier
  'notify-rapport': '1f2f6a0dce0f433b', // 2 fichiers
  'poll-leads': 'f869886b261d8230', // 7 fichiers
  'poll-stories': '8dec82c5f2fe74e6', // 2 fichiers
  'refresh-ig-posts': 'e3689052b0aff79d', // 2 fichiers
  'send-pending-dm3': '9d91732bac121536', // 2 fichiers
  'sync-calendly': '08efa71ef6e7069a', // 2 fichiers
  'sync-stripe-payments': '250550acf58cb82e', // 3 fichiers
};

/** L'empreinte d'une fonction, ou `null` si elle n'est pas dans le depot. */
export function empreinteDe(nom: string): string | null {
  return EMPREINTES_EDGE[nom] ?? null;
}
