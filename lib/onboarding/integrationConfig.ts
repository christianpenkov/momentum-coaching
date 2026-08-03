import type { IconName } from '@/components/ui/Icon';
import type { Provider } from '@/lib/supabase/types';

export type IntegrationMode = 'oauth' | 'apikey';

export interface IntegrationInstructionStep {
  text: string;
  href?: string;
  hrefLabel?: string;
}

export interface IntegrationDef {
  provider: Provider;
  name: string;
  icon: IconName;
  desc: string;
  mode: IntegrationMode;
  placeholder?: string;
  oauthPath?: string;
  wizardCopy: string;
  instructions: IntegrationInstructionStep[];
}

// Base commune — champs partagés entre coach et élève. Les deux exports dérivés
// ci-dessous filtrent/adaptent cette liste plutôt que de dupliquer chaque provider.
const BASE_INTEGRATIONS: IntegrationDef[] = [
  {
    provider: 'calendly',
    name: 'Calendly',
    icon: 'calendar',
    desc: 'Calls synchronisés, rappels automatiques',
    mode: 'oauth',
    oauthPath: '/api/oauth/calendly',
    wizardCopy: 'Synchronise tes calls automatiquement et reçois les rappels avant chaque session.',
    instructions: [
      { text: 'La connexion se fait via le bouton OAuth ci-dessus.' },
    ],
  },
  {
    provider: 'stripe',
    name: 'Stripe',
    icon: 'stripe',
    desc: 'Clé secrète pour lire les données clients et paiements',
    mode: 'apikey',
    placeholder: 'sk_live_... ou sk_test_...',
    wizardCopy: 'Vois tes revenus et l\'historique de paiement en un coup d\'œil.',
    instructions: [
      { text: 'Ouvre ton dashboard Stripe →', href: 'https://dashboard.stripe.com/apikeys', hrefLabel: 'dashboard.stripe.com/apikeys' },
      { text: 'Copie la Clé secrète (sk_live_... en prod, sk_test_... en test)' },
      { text: 'Colle-la ci-dessous' },
    ],
  },
  {
    provider: 'instagram',
    name: 'Instagram',
    icon: 'instagram',
    desc: 'Followers, engagement, métriques IG — connexion sécurisée via Facebook',
    mode: 'oauth',
    oauthPath: '/api/oauth/instagram',
    wizardCopy: 'Suis tes followers et ton engagement directement depuis Momentum.',
    instructions: [
      { text: 'Connecte ton compte Instagram Business.' },
    ],
  },
  {
    provider: 'youtube',
    name: 'YouTube',
    icon: 'youtube',
    desc: 'Abonnés, vues, analytics — connexion sécurisée via Google',
    mode: 'oauth',
    oauthPath: '/api/oauth/youtube',
    wizardCopy: 'Suis tes vues et abonnés directement depuis Momentum.',
    instructions: [
      { text: 'La connexion se fait via le bouton OAuth ci-dessus.' },
    ],
  },
  {
    provider: 'google',
    name: 'Google Calendar',
    icon: 'calendar',
    desc: 'Créer des calls Google Meet directement depuis Momentum',
    mode: 'oauth',
    oauthPath: '/api/oauth/google',
    wizardCopy: 'Crée des calls Google Meet et reçois tes invitations directement dans ton calendrier.',
    instructions: [
      { text: 'La connexion se fait via le bouton OAuth ci-dessus.' },
    ],
  },
  {
    provider: 'shortio',
    name: 'Short.io',
    icon: 'link',
    desc: 'CTR lien en bio',
    mode: 'apikey',
    placeholder: 'Clé API Short.io',
    wizardCopy: 'Suis le CTR de ton lien en bio et de tous tes liens courts en temps réel.',
    instructions: [
      { text: 'Ouvre →', href: 'https://app.short.io/settings/integrations/api-key', hrefLabel: 'app.short.io/settings/integrations/api-key' },
      { text: 'Clique "+ Créer la clé API" en haut à droite' },
      { text: 'Choisis Clé privée, laisse la description vide, clique "Créer"' },
      { text: 'Copie la clé (commence par sk_) et colle-la ci-dessous — elle ne sera plus visible après' },
    ],
  },
];

function findBase(provider: Provider): IntegrationDef {
  const def = BASE_INTEGRATIONS.find(i => i.provider === provider);
  if (!def) throw new Error(`Provider non trouvé dans BASE_INTEGRATIONS: ${provider}`);
  return def;
}

// Ordre et sélection par rôle pour le wizard — priorité à la valeur perçue immédiate.
export const COACH_WIZARD_INTEGRATIONS: IntegrationDef[] = [
  findBase('calendly'),
  findBase('stripe'),
  findBase('instagram'),
  findBase('youtube'),
  findBase('google'),
  findBase('shortio'),
];

export const CLIENT_WIZARD_INTEGRATIONS: IntegrationDef[] = [
  { ...findBase('google'), desc: 'Reçois les invitations de call de ton coach directement dans Google Calendar + rappels push' },
  findBase('calendly'),
  findBase('instagram'),
  findBase('youtube'),
  { ...findBase('stripe'), desc: 'Clé secrète Stripe pour afficher ton MRR, paiements et abonnements', wizardCopy: 'Ton coach voit ton MRR et tes paiements sans que tu aies à les lui envoyer.' },
  findBase('shortio'),
];
