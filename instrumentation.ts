import type { Instrumentation } from 'next';

// Point d'entrée officiel de Next.js pour l'observabilité (node_modules/next/dist/docs,
// « instrumentation.js »). Deux rôles, et seulement deux :
//
//   `register`       — pose le filet sur `fetch` une fois par instance serveur : toute
//                      réponse Supabase en échec devient un incident, que la route lise
//                      son `{ error }` ou non. Voir lib/incidents.ts.
//
//   `onRequestError` — toute exception non attrapée d'un Server Component, d'une Route
//                      Handler ou d'une Server Action devient un incident, avec la pile,
//                      la requête (sans ses secrets) et le commit déployé.
//
// ⚠️ Avant ce fichier (2026-09-13), une exception serveur ne laissait qu'un log Vercel,
// effacé au bout d'UNE heure sur le plan Hobby. Personne ne pouvait la constater le
// lendemain.
//
// ⚠️ `onRequestError` n'est PAS appelé pour une erreur qu'une route attrape elle-même et
// transforme en 500 : c'est le filet `fetch` qui couvre les écritures refusées, et
// `signalerIncident` s'appelle explicitement là où une route avale une panne qui compte.

export async function register() {
  // Node seulement : c'est le runtime de toutes les routes de ce projet. Le runtime edge
  // (middleware) garde son `fetch` intact — ne rien envelopper qu'on n'a pas mesuré.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { installerFiletFetch } = await import('./lib/incidents.ts');
    installerFiletFetch('vercel-serveur');
  }
}

export const onRequestError: Instrumentation.onRequestError = async (erreur, requete, contexte) => {
  // Attendu, jamais lancé en tâche de fond : la doc Next l'exige, et sur Vercel une
  // promesse non attendue est perdue quand la fonction se fige.
  const { signalerErreurServeur } = await import('./lib/incidents.ts');
  await signalerErreurServeur(erreur, requete, contexte);
};
