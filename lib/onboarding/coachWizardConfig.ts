import { COACH_WIZARD_INTEGRATIONS } from './integrationConfig';

export interface TourStepDef {
  route: string;
  selector: string;
  title: string;
  content: string;
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'auto';
}

export interface WizardConfig {
  role: 'coach' | 'client';
  welcomeTitle: string;
  welcomeSubtitle: string;
  integrations: typeof COACH_WIZARD_INTEGRATIONS;
  tourSteps: TourStepDef[];
}

export const COACH_WIZARD_CONFIG: WizardConfig = {
  role: 'coach',
  welcomeTitle: 'Bienvenue sur Momentum',
  welcomeSubtitle: 'Connecte tes outils pour activer le suivi de tes élèves, puis découvre la plateforme en quelques minutes.',
  integrations: COACH_WIZARD_INTEGRATIONS,
  tourSteps: [
    { route: '/dashboard', selector: '[data-tour="page-dashboard"]', title: 'Aujourd\'hui', content: 'Ta vue d\'ensemble quotidienne : calls du jour, alertes, clients à surveiller.' },
    { route: '/analytics', selector: '[data-tour="page-analytics"]', title: 'Analytics', content: 'Les métriques agrégées de tous tes élèves : audience, posts, DM, calls, MRR.' },
    { route: '/clients', selector: '[data-tour="page-clients"]', title: 'Clients', content: 'Suis l\'avancement de chaque élève individuellement — son statut, ses stats, ses relances — tout au même endroit.' },
    { route: '/messages', selector: '[data-tour="page-messages"]', title: 'Messages', content: 'Échange directement avec chaque élève.' },
    { route: '/calls', selector: '[data-tour="page-calls"]', title: 'Calls', content: 'Tous tes calls, coaching et prospects confondus — passés et à venir.' },
    { route: '/calendar', selector: '[data-tour="page-calendar"]', title: 'Calendrier', content: 'Ta vue calendrier de toutes tes sessions.' },
    { route: '/tasks', selector: '[data-tour="page-tasks"]', title: 'Tâches', content: 'Assigne des tâches à chacun de tes élèves et suis leur avancement.' },
    { route: '/ressources', selector: '[data-tour="page-ressources"]', title: 'Ressources', content: 'Dépose guides, templates et fichiers pour tes élèves, avec un accès personnalisable par élève.' },
    { route: '/settings', selector: '[data-tour="page-settings"]', title: 'Réglages', content: 'Gère toutes tes connexions facilement au même endroit.' },
  ],
};
