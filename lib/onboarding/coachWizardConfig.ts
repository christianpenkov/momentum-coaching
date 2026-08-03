import type { IconName } from '@/components/ui/Icon';
import { COACH_WIZARD_INTEGRATIONS } from './integrationConfig';

export interface WalkthroughStepDef {
  icon: IconName;
  text: string;
  link?: string;
}

export interface WizardConfig {
  role: 'coach' | 'client';
  welcomeTitle: string;
  welcomeSubtitle: string;
  integrations: typeof COACH_WIZARD_INTEGRATIONS;
  walkthroughSteps: WalkthroughStepDef[];
}

export const COACH_WIZARD_CONFIG: WizardConfig = {
  role: 'coach',
  welcomeTitle: 'Bienvenue sur Momentum',
  welcomeSubtitle: 'Connecte tes outils pour activer le suivi de tes élèves, puis découvre la plateforme en quelques minutes.',
  integrations: COACH_WIZARD_INTEGRATIONS,
  walkthroughSteps: [
    { icon: 'activity', text: 'Aujourd\'hui — ta vue d\'ensemble quotidienne', link: '/dashboard' },
    { icon: 'users', text: 'Clients — liste et fiches de tes élèves, avec un badge qui montre leur avancement dans leur propre wizard', link: '/clients' },
    { icon: 'bar-chart', text: 'Analytics — les métriques agrégées de tous tes élèves', link: '/analytics' },
    { icon: 'message-circle', text: 'Messages — échange directement avec chaque élève', link: '/messages' },
    { icon: 'phone-call', text: 'Calls & Calendrier — tes sessions passées et à venir', link: '/calls' },
    { icon: 'task-check', text: 'Tâches — organise ton suivi coaching', link: '/tasks' },
    { icon: 'folder', text: 'Ressources — dépose guides, templates et replays pour tes élèves', link: '/ressources' },
    { icon: 'settings', text: 'Réglages — reconnecte ou déconnecte un outil à tout moment', link: '/settings' },
  ],
};
