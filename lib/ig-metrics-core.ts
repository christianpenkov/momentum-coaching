// Utilitaire de date partagé par les routes Instagram côté Next.js.
//
// ⚠️ Ce fichier portait jusqu'au 2026-09-06 une copie de `fetchIgDayMetrics`,
// présentée comme « source de vérité unique » et « original de référence » de la
// version Deno de supabase/functions/poll-leads/index.ts. C'était vrai à l'écriture
// et faux depuis des semaines : la version Deno — la seule qui tourne — a six appels
// Meta au lieu de quatre, la ventilation du reach par type d'audience, les vues de
// profil, la détection de quota, la séparation `{ jour, compte }` et la levée sur
// échec total. La copie n'avait aucun appelant (knip, peigne fin final) et ne
// pouvait plus servir de référence à rien : elle aurait seulement trompé le prochain
// lecteur, exactement le mode de panne « deux copies, une seule à jour » que ce
// projet a déjà payé plusieurs fois. Supprimée avec l'accord de Chris.
//
// La référence lisible de la collecte Instagram est désormais la fonction Deno
// elle-même, et ses tests : supabase/functions/poll-leads/index.ts (fetchIgDayMetrics).

// "Aujourd'hui"/"hier" en heure de Paris (celle de l'utilisateur), pas en UTC brut —
// sinon, entre 22h et minuit UTC (00h-02h heure d'été Paris), un calcul UTC pur
// assigne encore la veille alors que c'est déjà le jour suivant à Paris.
export function isoDateCore(daysAgo: number): string {
  const now = new Date(Date.now() - daysAgo * 86400000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now); // format en-CA = YYYY-MM-DD
}
