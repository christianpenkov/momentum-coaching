import type { IconName } from '@/components/ui/Icon';
import type { Provider } from '@/lib/supabase/types';

// 'both' : OAuth proposé en premier, clé API conservée en repli. Nécessaire pour
// Stripe — depuis juin 2021, OAuth read_write ne peut pas se connecter à un compte
// Standard déjà contrôlé par une autre plateforme (Kajabi, Systeme.io…), et les
// Connect Extensions qui contournaient ça sont dépréciées. Un élève dans ce cas
// n'a que la clé restreinte pour connecter son compte existant.
export type IntegrationMode = 'oauth' | 'apikey' | 'both';

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
    desc: 'Paiements encaissés rattachés automatiquement à leurs deals',
    mode: 'both',
    oauthPath: '/api/oauth/stripe',
    placeholder: 'rk_live_... ou sk_live_...',
    wizardCopy: 'Chaque euro encaissé remonte tout seul, rattaché à son deal et au contenu qui l\'a produit.',
    instructions: [
      { text: 'Le bouton « Connecter » ci-dessus suffit dans la plupart des cas : tu choisis ton compte Stripe, c\'est tout.' },
      { text: 'Si Stripe refuse la connexion (compte déjà relié à une autre plateforme type Kajabi ou Systeme.io), utilise une clé restreinte à la place.' },
      { text: 'Créer une clé restreinte →', href: 'https://dashboard.stripe.com/apikeys/create', hrefLabel: 'dashboard.stripe.com/apikeys/create' },
      { text: 'Donne-lui les droits Lecture sur Clients, Paiements, Abonnements et Factures, puis colle-la ci-dessous.' },
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
  {
    provider: 'fathom',
    name: 'Fathom',
    icon: 'video',
    desc: 'Enregistrement, résumé et transcript de tes appels, automatiquement',
    mode: 'oauth',
    oauthPath: '/api/oauth/fathom',
    wizardCopy: 'Chaque appel enregistré par Fathom apparaît automatiquement dans ton historique, avec vidéo, résumé et points clés.',
    instructions: [
      { text: 'La connexion se fait via le bouton OAuth ci-dessus.' },
      { text: 'Vérifie ensuite que l\'auto-join est activé sur ton compte Fathom →', href: 'https://fathom.video/calendar', hrefLabel: 'fathom.video/calendar' },
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
  findBase('fathom'),
  findBase('shortio'),
];

export const CLIENT_WIZARD_INTEGRATIONS: IntegrationDef[] = [
  { ...findBase('google'), desc: 'Reçois les invitations de call de ton coach directement dans Google Calendar + rappels push' },
  findBase('calendly'),
  findBase('instagram'),
  findBase('youtube'),
  { ...findBase('stripe'), desc: 'Tes paiements rattachés à tes deals, ton MRR et tes abonnements', wizardCopy: 'Chaque euro encaissé remonte tout seul, rattaché à son deal et au contenu qui l\'a produit.' },
  findBase('fathom'),
  findBase('shortio'),
];
