import { CLIENT_WIZARD_INTEGRATIONS } from './integrationConfig';
import type { WizardConfig } from './coachWizardConfig';

export function buildClientWizardConfig(coachName?: string | null): WizardConfig {
  const coach = coachName || 'ton coach';
  return {
    role: 'client',
    welcomeTitle: 'Bienvenue sur Momentum',
    welcomeSubtitle: `Connecte tes outils pour que ${coach} puisse suivre tes progrès, puis découvre la plateforme en quelques minutes.`,
    integrations: CLIENT_WIZARD_INTEGRATIONS,
    walkthroughSteps: [
      { icon: 'activity', text: 'Mon espace — ta vue d\'ensemble', link: '/client' },
      { icon: 'bar-chart', text: 'Mes stats — tes métriques clés semaine par semaine', link: '/client/stats' },
      { icon: 'trending-up', text: 'Pipeline Leads — suis tes prospects du premier contact au call booké', link: '/client/pipeline' },
      { icon: 'message-circle', text: `Messages — échange directement avec ${coach}`, link: '/client/messages' },
      { icon: 'task-check', text: 'Tâches — ton plan de la semaine', link: '/client/taches' },
      { icon: 'phone-call', text: 'Prochain call & Calendrier — tes sessions passées et à venir', link: '/client/calls' },
      { icon: 'folder', text: 'Ressources — guides, templates et replays débloqués progressivement', link: '/client/ressources' },
      { icon: 'link', text: 'Gérer mes liens — tes liens courts trackés', link: '/client/liens' },
      { icon: 'settings', text: 'Réglages — reconnecte ou déconnecte un outil à tout moment', link: '/client/settings' },
    ],
  };
}
