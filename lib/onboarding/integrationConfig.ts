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
//
// Source unique des libellés : les pages Réglages (coach et élève) ET le wizard
// d'onboarding lisent tous ce fichier. Un même provider doit afficher le même
// texte partout — avant, chaque page Réglages avait sa propre copie et l'élève
// lisait un texte à l'onboarding, un autre dans ses Réglages.
//
// Registre des `desc` : bénéfice sec, pas d'impératif. Éviter « Connecte X
// pour… » : le bouton juste à côté dit déjà « Connecter », le verbe est redondant
// et la phrase mange deux lignes sur mobile là où le bénéfice tient en une.
//
// Masqué : assistant IA non utilisé dans la plateforme pour l'instant. Ne pas
// supprimer — à réactiver dans COACH_WIZARD_INTEGRATIONS le jour où l'assistant sert.
// {
//   provider: 'anthropic',
//   name: 'Claude IA',
//   icon: 'sparkle',
//   desc: "Clé API Anthropic pour l'assistant IA intégré",
//   mode: 'apikey',
//   placeholder: 'sk-ant-...',
//   wizardCopy: '…',
//   instructions: [
//     { text: 'Ouvre →', href: 'https://console.anthropic.com/settings/keys', hrefLabel: 'console.anthropic.com/settings/keys' },
//     { text: 'Clique Create Key → copie la clé (sk-ant-...)' },
//     { text: 'Colle-la ci-dessous' },
//   ],
// },
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
      // Un compte Stripe non finalisé se connecte SANS ERREUR mais refuse tout
      // paiement : le lien serait créé et le client se heurterait au refus.
      // L'avertissement doit venir avant, pas au premier deal perdu.
      { text: 'Ton compte Stripe doit être activé pour encaisser : identité, description de ton activité et IBAN renseignés chez Stripe. Sans ça la connexion fonctionne, mais aucun paiement ne pourra aboutir.' },
      { text: 'Vérifier l\'activation de mon compte →', href: 'https://dashboard.stripe.com/account/onboarding', hrefLabel: 'dashboard.stripe.com' },
      { text: 'Si Stripe refuse la connexion (compte déjà relié à une autre plateforme type Kajabi ou Systeme.io), utilise une clé restreinte à la place.' },
      { text: 'Créer une clé restreinte →', href: 'https://dashboard.stripe.com/apikeys/create', hrefLabel: 'dashboard.stripe.com/apikeys/create' },
      { text: 'Donne-lui les droits Lecture sur Clients, Paiements, Abonnements et Factures, puis colle-la ci-dessous.' },
    ],
  },
  {
    provider: 'instagram',
    name: 'Instagram',
    icon: 'instagram',
    desc: 'Followers, engagement, métriques IG — connexion sécurisée',
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
    desc: 'Abonnés, vues, watch time — connexion sécurisée via Google',
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
    desc: 'Créer des calls Google Meet depuis Momentum',
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
    desc: 'Tracking des clics de tous tes liens courts : bio, DMs, stories, description, lead magnet',
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
      { text: 'Ouvre ensuite tes réglages Fathom →', href: 'https://fathom.video/customize', hrefLabel: 'fathom.video/customize' },
      { text: 'Dans « Auto-Record Settings », choisis « All Meetings » dans le premier menu déroulant : Fathom rejoint alors tous tes calls sans que tu aies à lancer l\'enregistrement.' },
      { text: 'Vérifie que ton agenda Google ou Microsoft est bien connecté à Fathom — sans lui, Fathom ne voit pas tes calls planifiés et ne peut pas les rejoindre.' },
    ],
  },
];

function findBase(provider: Provider): IntegrationDef {
  const def = BASE_INTEGRATIONS.find(i => i.provider === provider);
  if (!def) throw new Error(`Provider non trouvé dans BASE_INTEGRATIONS: ${provider}`);
  return def;
}

// Ordre et sélection par rôle — priorité à la valeur perçue immédiate. Sert au
// wizard d'onboarding ET à la page Réglages : l'ordre ci-dessous est celui qui
// s'affiche dans les deux.
export const COACH_WIZARD_INTEGRATIONS: IntegrationDef[] = [
  findBase('stripe'),
  findBase('calendly'),
  findBase('instagram'),
  findBase('youtube'),
  findBase('google'),
  findBase('fathom'),
  findBase('shortio'),
];

// Seuls `google` et `stripe` gardent un override : la valeur diffère réellement
// pour l'élève (il *reçoit* les invitations là où le coach les *crée* ; ses
// paiements sont les siens, pas ceux qu'il encaisse de tiers). Les 5 autres
// providers lisent le texte commun — même libellé pour le coach et pour l'élève.
export const CLIENT_WIZARD_INTEGRATIONS: IntegrationDef[] = [
  { ...findBase('google'), desc: 'Les calls de ton coach dans ton agenda, avec rappels' },
  { ...findBase('stripe'), desc: 'Tes paiements rattachés à leurs deals, MRR et abonnements' },
  findBase('calendly'),
  findBase('instagram'),
  findBase('youtube'),
  findBase('fathom'),
  findBase('shortio'),
];
