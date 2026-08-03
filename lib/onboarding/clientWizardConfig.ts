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
      {
        icon: 'activity',
        title: 'Mon espace',
        points: [
          'Ta vue d\'ensemble : tâches de la semaine, prochain call, stats clés.',
          'Un anneau de progression montre ton avancement sur tes tâches en cours.',
        ],
      },
      {
        icon: 'bar-chart',
        title: 'Mes stats',
        points: [
          { before: 'Vois tes contenus qui font le plus de', strike: 'vues', highlight: 'Cash !' },
          'Navigue période par période (semaine ou mois) pour comparer ta progression.',
          'Vois le détail de chaque étape de ton funnel, du premier contact jusqu\'au closing.',
        ],
      },
      {
        icon: 'trending-up',
        title: 'Pipeline Leads',
        points: [
          'Suis tes prospects du premier contact jusqu\'au closing.',
          'Tout est tracké automatiquement, sans rien faire — tu vois l\'état de tous tes leads en direct.',
          'Marque un deal comme closé avec son montant dès qu\'il est signé.',
        ],
      },
      {
        icon: 'message-circle',
        title: 'Messages',
        points: [
          `Échange directement avec ${coach}, en texte ou en vocal.`,
        ],
      },
      {
        icon: 'task-check',
        title: 'Tâches',
        points: [
          'Vois toutes tes tâches à réaliser et ton avancement.',
          `Coche une tâche dès qu'elle est faite — ${coach} le voit en temps réel.`,
        ],
      },
      {
        icon: 'phone-call',
        title: 'Prochain call',
        points: [
          'Tous tes calls, coaching et prospects confondus — passés et à venir.',
        ],
      },
      {
        icon: 'calendar',
        title: 'Calendrier',
        points: [
          'Une vue d\'ensemble jour par jour de tous tes prochains rendez-vous et échéances importantes.',
        ],
      },
      {
        icon: 'folder',
        title: 'Ressources',
        points: [
          `Guides, templates et fichiers mis à ta disposition par ${coach}.`,
          'Un badge "Nouveau" indique les ressources que tu n\'as pas encore ouvertes.',
        ],
      },
      {
        icon: 'link',
        title: 'Gérer mes liens',
        points: [
          'Génère tes liens courts trackés pour ta bio et tes messages.',
          'Associe un lead magnet à chacun de tes contenus.',
        ],
      },
      {
        icon: 'settings',
        title: 'Réglages',
        points: [
          'Gère toutes tes connexions facilement au même endroit.',
          'Modifie ton profil, ton nom et ta photo, visible par ton coach dans la messagerie.',
        ],
      },
    ],
  };
}
