import type { IconName } from '@/components/ui/Icon';
import { COACH_WIZARD_INTEGRATIONS } from './integrationConfig';

// Un point simple (string) ou un point "punchline" qui barre un mot terne pour
// mettre en avant l'argument qui vend vraiment (ex: "~~Vues~~ Cash !").
export type WalkthroughPoint = string | { before?: string; strike: string; highlight: string; rest?: string };

export interface WalkthroughStepDef {
  icon: IconName;
  title: string;
  points: WalkthroughPoint[];
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
    {
      icon: 'activity',
      title: 'Aujourd\'hui',
      points: [
        'Ta vue d\'ensemble quotidienne : calls du jour, alertes, clients à surveiller.',
        'Vois en un coup d\'œil qui a une tâche en retard ou un call sans rapport.',
        'Crée un call directement depuis cette page.',
      ],
    },
    {
      icon: 'bar-chart',
      title: 'Stats Clients',
      points: [
        'Les métriques agrégées de tous tes élèves : audience, posts, DM, calls, revenus.',
        'Compare la croissance Instagram et YouTube élève par élève.',
        'Repère en un coup d\'œil quel élève stagne ou a besoin d\'attention.',
      ],
    },
    {
      icon: 'users',
      title: 'Clients',
      points: [
        'Suis l\'avancement de chaque élève individuellement — son statut, ses stats, ses relances.',
        'Ouvre la fiche complète d\'un élève pour voir son historique de calls et tâches.',
      ],
    },
    {
      icon: 'message-circle',
      title: 'Messages',
      points: [
        'Échange directement avec chaque élève, en texte ou en vocal.',
        'Reçois une notification à chaque nouveau message.',
      ],
    },
    {
      icon: 'phone-call',
      title: 'Calls',
      points: [
        'Crée et gère tes sessions de coaching avec chacun de tes élèves.',
        'Tous tes calls, coaching et prospects confondus — passés et à venir.',
      ],
    },
    {
      icon: 'calendar',
      title: 'Calendrier',
      points: [
        'Ta vue calendrier de toutes tes sessions, jour par jour.',
        'Repère en un clin d\'œil les journées chargées.',
      ],
    },
    {
      icon: 'task-check',
      title: 'Tâches',
      points: [
        'Assigne des tâches à chacun de tes élèves et suis leur avancement.',
        'Vois en un coup d\'œil qui a des tâches en retard.',
        'Exige un document en pièce jointe si besoin (ex: script de vente à valider).',
      ],
    },
    {
      icon: 'folder',
      title: 'Ressources',
      points: [
        'Dépose guides, templates et fichiers pour tes élèves, organisés en dossiers.',
        'Choisis précisément quel élève a accès à quelle ressource.',
      ],
    },
    {
      icon: 'settings',
      title: 'Réglages',
      points: [
        'Gère toutes tes connexions facilement au même endroit.',
        'Modifie ton profil et ta photo, visible par tes élèves dans la messagerie.',
      ],
    },
  ],
};
