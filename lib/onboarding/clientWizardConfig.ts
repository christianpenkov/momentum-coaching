import { CLIENT_WIZARD_INTEGRATIONS } from './integrationConfig';
import type { WizardConfig } from './coachWizardConfig';

export function buildClientWizardConfig(coachName?: string | null): WizardConfig {
  const coach = coachName || 'ton coach';
  return {
    role: 'client',
    welcomeTitle: 'Bienvenue sur Momentum',
    welcomeSubtitle: `Connecte tes outils pour que ${coach} puisse suivre tes progrès, puis découvre la plateforme en quelques minutes.`,
    integrations: CLIENT_WIZARD_INTEGRATIONS,
    tourSteps: [
      { route: '/client', selector: '[data-tour="page-client-home"]', title: 'Mon espace', content: 'Ta vue d\'ensemble.' },
      { route: '/client/stats', selector: '[data-tour="page-client-stats"]', title: 'Mes stats', content: 'Toutes tes métriques business, semaine ou mois : MRR, revenus, abonnements, calls conclus, stats Instagram et YouTube.' },
      { route: '/client/pipeline', selector: '[data-tour="page-client-pipeline"]', title: 'Pipeline Leads', content: 'Suis tes prospects du premier contact jusqu\'au closing.' },
      { route: '/client/messages', selector: '[data-tour="page-client-messages"]', title: 'Messages', content: `Échange directement avec ${coach}.` },
      { route: '/client/taches', selector: '[data-tour="page-client-taches"]', title: 'Tâches', content: 'Vois toutes tes tâches à réaliser et ton avancement.' },
      { route: '/client/calls', selector: '[data-tour="page-client-calls"]', title: 'Prochain call', content: 'Tous tes calls, coaching et prospects confondus — passés et à venir.' },
      { route: '/client/calendar', selector: '[data-tour="page-client-calendar"]', title: 'Calendrier', content: 'Ta vue calendrier de toutes tes sessions.' },
      { route: '/client/ressources', selector: '[data-tour="page-client-ressources"]', title: 'Ressources', content: 'Guides, templates et fichiers mis à ta disposition par ton coach.' },
      { route: '/client/liens', selector: '[data-tour="page-client-liens"]', title: 'Gérer mes liens', content: 'Génère tes liens courts trackés et associe un lead magnet à chacun de tes contenus.' },
      { route: '/client/settings', selector: '[data-tour="page-client-settings"]', title: 'Mes connexions', content: 'Gère toutes tes connexions facilement au même endroit.' },
    ],
  };
}
