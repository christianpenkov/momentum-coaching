// S'exécute dans le navigateur AVANT l'hydratation de React (node_modules/next/dist/docs,
// « instrumentation-client.js »). C'est le seul endroit qui voit les erreurs du tout
// premier rendu, avant que le moindre composant ne soit monté.
//
// Rôle unique : faire remonter en base les pannes que seul le navigateur voit — une
// requête Supabase refusée (l'écran vide qui ment), une exception JavaScript. Le détail
// et les garanties sont dans lib/incidentsNavigateur.ts.
//
// ⚠️ `AppBootstrap` continue d'écrire ses journaux de cycle de vie dans
// `webhook_debug_log` : ce sont des outils d'ENQUÊTE, purgés à 14 jours. Ici, ce sont
// des INCIDENTS, regroupés et notifiés. Les deux ne font pas double emploi.

import { installerFiletNavigateur, signalerDepuisNavigateur } from './lib/incidentsNavigateur.ts';

try {
  installerFiletNavigateur();

  window.addEventListener('error', (e) => {
    signalerDepuisNavigateur({
      type: 'fenetre',
      message: String(e.message || ''),
      nom: e.error?.name,
      pile: e.error?.stack ? String(e.error.stack).slice(0, 4_000) : null,
      fichier: e.filename || null,
      ligne: e.lineno || null,
      colonne: e.colno || null,
      chemin: location.pathname,
    });
  });

  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    signalerDepuisNavigateur({
      type: 'promesse',
      message: r instanceof Error ? r.message : String(r),
      nom: r instanceof Error ? r.name : undefined,
      pile: r instanceof Error && r.stack ? r.stack.slice(0, 4_000) : null,
      chemin: location.pathname,
    });
  });
} catch {
  // L'instrumentation ne doit jamais empêcher l'application de démarrer.
}
