/* MOMENTUM — Mock data typées */

export interface WeeklyMetrics {
  week: number;
  followersIG: number;
  followersYT: number;
  postsCount: number;
  avgViews: number;
  videoRetention: number;
  engagementRate: number;
  ctrBioLink: number;
  dmsSent: number;
  dmsReplyRate: number;
  calendlyCalls: number;
  noShowRate: number;
  iClosedDeals: number;
  closingRate: number;
  stripeMRR: number;
}

export interface Task {
  label: string;
  done: boolean;
  meta: string;
  deadline?: string;        // ISO date string "2025-05-20"
  priority?: 'high' | 'medium' | 'low';
  addedBy?: 'coach' | 'client';
}

export interface Message {
  who: string;
  day?: string;
  text: string;
  time?: string;
  side?: 'me' | 'them';
}

export interface Call {
  time: string;
  clientId: string;
  topic: string;
  ready: 'ready' | 'partial' | 'pending';
  date?: string;
  duration?: string;
  notes?: string;
}

export interface ActivityItem {
  clientId: string;
  desc: string;
  when: string;
  status: 'green' | 'red' | 'amber';
}

export interface Conversation {
  clientId: string;
  last: string;
  when: string;
  unread: boolean;
  dot: 'green' | 'red' | 'amber';
}

export interface Resource {
  id: string;
  title: string;
  type: 'Vidéo' | 'PDF' | 'Notion' | 'Template' | 'Checklist';
  desc: string;
  duration?: string;
  week?: number;
  locked?: boolean;
  tags?: string[];
}

export type Status = 'green' | 'amber' | 'red';

export interface Client {
  id: string;
  initials: string;
  name: string;
  niche: string;
  week: number;
  followers: string;
  fdelta: string;
  fdir: 'up' | 'down';
  posts: number;
  dms: string;
  mrr: string;
  status: Status;
  statusText: string;
  monthly?: string;
  weeklyHistory: WeeklyMetrics[];
  plan?: Task[];
  messages?: Message[];
  privateNotes?: string;
  momentumScore?: number;
  clientSince?: number;
  nextCall?: string;
  iClosedRate?: number;
  calendlyMonthly?: number;
  suspens?: { label: string; status: string }[];
}

/* ─── Génération déterministe de l'historique 12 semaines ─── */
function seed(n: number): number {
  let x = n;
  x = ((x >> 16) ^ x) * 0x45d9f3b;
  x = ((x >> 16) ^ x) * 0x45d9f3b;
  x = (x >> 16) ^ x;
  return Math.abs(x);
}

function genHistory(baseIG: number, baseYT: number, baseMRR: number, salt: number): WeeklyMetrics[] {
  const history: WeeklyMetrics[] = [];
  let ig = baseIG, yt = baseYT, mrr = baseMRR;
  for (let w = 1; w <= 12; w++) {
    const s = seed(salt * 100 + w);
    const growthIG = 1 + ((s % 1200) - 400) / 10000;
    const growthYT = 1 + ((seed(s + 2) % 800) - 200) / 10000;
    ig = Math.max(800, Math.round(ig * growthIG));
    yt = Math.max(0, Math.round(yt * growthYT));
    const posts = 2 + (s % 5);
    const avgViews = Math.round(800 + (seed(s + 4) % 3000));
    const videoRetention = parseFloat((28 + (seed(s + 8) % 40)).toFixed(1));
    const eng = parseFloat((2.5 + (seed(s + 5) % 40) / 10).toFixed(1));
    const ctrBioLink = parseFloat((1.2 + (seed(s + 9) % 60) / 10).toFixed(1));
    const dms = 30 + (s % 120);
    const replyRate = parseFloat((8 + (seed(s + 6) % 22)).toFixed(1));
    const calls = 1 + (s % 3);
    const noShowRate = parseFloat((5 + (seed(s + 10) % 30)).toFixed(1));
    const deals = (s % 3) === 0 ? 1 : 0;
    const closingRate = parseFloat((10 + (seed(s + 11) % 50)).toFixed(1));
    const mrrGrowth = 1 + ((seed(s + 7) % 600) - 100) / 10000;
    mrr = Math.max(0, Math.round(mrr * mrrGrowth));
    history.push({ week: w, followersIG: ig, followersYT: yt, postsCount: posts, avgViews, videoRetention, engagementRate: eng, ctrBioLink, dmsSent: dms, dmsReplyRate: replyRate, calendlyCalls: calls, noShowRate, iClosedDeals: deals, closingRate, stripeMRR: mrr });
  }
  return history;
}

/* ─── Clients ─── */
export const clients: Client[] = [
  {
    id: 'thomas', initials: 'TB', name: 'Thomas Bénard', niche: 'SaaS B2B',
    week: 8, followers: '12.4k', fdelta: '+1.2%', fdir: 'up', posts: 1, dms: '42dm', mrr: '€2 100',
    status: 'red', statusText: 'Pas ouvert le chat depuis 4j · DM ↓35%',
    clientSince: 56, nextCall: '10:00', momentumScore: 28, iClosedRate: 8, calendlyMonthly: 3,
    weeklyHistory: genHistory(11000, 1800, 2100, 1),
    plan: [
      { label: 'Publier 4 Reels', done: false, meta: '2/4', deadline: '2025-05-16', priority: 'high', addedBy: 'coach' },
      { label: 'Carrousel « erreurs »', done: true, meta: 'fait', priority: 'medium', addedBy: 'coach' },
      { label: 'Envoyer 150 DM', done: false, meta: '42/150', deadline: '2025-05-18', priority: 'high', addedBy: 'coach' },
      { label: 'Brief tournage S9', done: false, meta: 'draft', deadline: '2025-05-21', priority: 'medium', addedBy: 'coach' },
      { label: 'Audit profil IG', done: true, meta: 'fait', priority: 'low', addedBy: 'client' },
    ],
    messages: [
      { who: 'Thomas', day: 'lun', text: '« Hey [prénom], je vois que tu fais du SaaS… »' },
      { who: 'Marc', day: 'lun', text: 'Le hook est trop générique. On retravaille jeudi.' },
      { who: 'Thomas', day: 'jeu', text: 'OK je m\'y mets ce soir' },
    ],
    privateNotes: 'Manque de confiance dans son avatar. Vient probablement d\'un ciblage trop large. À retravailler pendant le call de jeudi.',
    suspens: [
      { label: 'Avatar CTO SaaS', status: 'amber' },
      { label: 'Bio Instagram', status: 'amber' },
      { label: '3 hooks Reels', status: 'amber' },
    ],
  },
  {
    id: 'lea', initials: 'LM', name: 'Léa Moreau', niche: 'Coach pilates',
    week: 12, followers: '48.1k', fdelta: '+8.4%', fdir: 'up', posts: 5, dms: '156dm', mrr: '€11 400',
    status: 'green', statusText: 'Objectifs semaine atteints',
    clientSince: 84, nextCall: '11:30', momentumScore: 92, iClosedRate: 34, calendlyMonthly: 9,
    weeklyHistory: genHistory(44000, 6200, 11000, 2),
    plan: [
      { label: 'Publier 5 Reels', done: false, meta: '2 / 5' },
      { label: 'Carrousel « métriques »', done: true, meta: 'fait' },
      { label: 'Envoyer 200 DM', done: false, meta: '156 / 200' },
      { label: 'Brief tournage validé', done: true, meta: 'fait' },
      { label: 'Tester 3 nouveaux hooks', done: false, meta: '1 / 3' },
      { label: 'Préparer call · objectifs S13', done: false, meta: 'brouillon' },
      { label: 'Reel viral · analyse', done: false, meta: 'à faire' },
    ],
    privateNotes: 'Prête pour upsell offre premium. Préparer proposition pendant S12.',
  },
  {
    id: 'hugo', initials: 'HM', name: 'Hugo Mercier', niche: 'Finance perso',
    week: 3, followers: '3.1k', fdelta: '+2.1%', fdir: 'up', posts: 2, dms: '22dm', mrr: '—',
    status: 'amber', statusText: 'Lent sur module 2 · 1 tâche en retard',
    clientSince: 21, nextCall: 'ven 15h', momentumScore: 45, iClosedRate: 0, calendlyMonthly: 2,
    weeklyHistory: genHistory(2800, 0, 0, 3),
    plan: [
      { label: 'Finir module 2', done: false, meta: 'en retard' },
      { label: 'Publier 3 posts IG', done: false, meta: '1/3' },
      { label: 'Écrire bio optimisée', done: false, meta: 'draft' },
      { label: 'Audit concurrents', done: true, meta: 'fait' },
    ],
    privateNotes: 'Profil très sérieux mais lent à démarrer. Besoin de quick wins pour la motivation.',
  },
  {
    id: 'sofia', initials: 'SR', name: 'Sofia Reyes', niche: 'Nutrition',
    week: 6, followers: '21.7k', fdelta: '+5.6%', fdir: 'up', posts: 4, dms: '98dm', mrr: '€4 800',
    status: 'green', statusText: 'Sur la trajectoire',
    clientSince: 42, nextCall: 'lun 10h', momentumScore: 74, iClosedRate: 18, calendlyMonthly: 5,
    weeklyHistory: genHistory(19500, 2100, 4600, 4),
    plan: [
      { label: 'Publier 4 Reels nutrition', done: true, meta: 'fait' },
      { label: 'Envoyer 100 DM', done: false, meta: '98/100' },
      { label: 'Créer carrousel recette', done: false, meta: 'à faire' },
      { label: 'Story Q&A', done: true, meta: 'fait' },
    ],
    privateNotes: 'Excellent engagement sur les recettes. Pousser sur le format carrousel.',
  },
  {
    id: 'karim', initials: 'KB', name: 'Karim Belhadj', niche: 'Real estate',
    week: 9, followers: '8.9k', fdelta: '+0.4%', fdir: 'up', posts: 2, dms: '51dm', mrr: '€3 200',
    status: 'amber', statusText: 'Reels en pause depuis 6j',
    clientSince: 63, nextCall: 'jeu 14h', momentumScore: 41, iClosedRate: 12, calendlyMonthly: 4,
    weeklyHistory: genHistory(8300, 0, 3100, 5),
    plan: [
      { label: 'Reprendre les Reels (×3)', done: false, meta: '0/3' },
      { label: 'Envoyer 50 DM prospects', done: false, meta: '51/50' },
      { label: 'Vidéo visite virtuelle', done: false, meta: 'à tourner' },
      { label: 'Analyse métriques S8', done: true, meta: 'fait' },
    ],
    privateNotes: 'Bloqué par manque de temps pour tourner. Proposer batch content en une demi-journée.',
  },
  {
    id: 'camille', initials: 'CV', name: 'Camille Vidal', niche: 'Mindset',
    week: 11, followers: '67.3k', fdelta: '+11.2%', fdir: 'up', posts: 6, dms: '210dm', mrr: '€18 900',
    status: 'green', statusText: 'Top performer · à étudier',
    clientSince: 77, nextCall: '14:00', momentumScore: 97, iClosedRate: 41, calendlyMonthly: 12,
    weeklyHistory: genHistory(60000, 8800, 18400, 6),
    plan: [
      { label: 'Scale équipe 2 personnes', done: false, meta: 'en cours' },
      { label: 'Publier 6 posts/semaine', done: true, meta: 'fait' },
      { label: 'Lancement offre groupe', done: false, meta: 'S12' },
      { label: 'Audit pack 100 hooks', done: true, meta: 'fait' },
    ],
    privateNotes: 'Candidat idéal pour étude de cas. Demander témoignage vidéo.',
  },
  {
    id: 'antoine', initials: 'AG', name: 'Antoine Garel', niche: 'AI tools',
    week: 4, followers: '5.4k', fdelta: '-1.8%', fdir: 'down', posts: 0, dms: '8dm', mrr: '—',
    status: 'red', statusText: 'Aucune publication 9j · risque churn',
    clientSince: 28, nextCall: '15:30', momentumScore: 12, iClosedRate: 0, calendlyMonthly: 1,
    weeklyHistory: genHistory(5500, 0, 0, 7),
    plan: [
      { label: 'Publier 3 posts minimum', done: false, meta: '0/3' },
      { label: 'Reprendre contact chat', done: false, meta: 'urgent' },
      { label: 'Hook IA outils revu', done: false, meta: 'à faire' },
    ],
    privateNotes: 'Décrochage progressif depuis 9 jours. Call de réactivation urgent. Comprendre le blocage réel.',
  },
  {
    id: 'ines', initials: 'ID', name: 'Inès Dubois', niche: 'Branding visuel',
    week: 7, followers: '19.2k', fdelta: '+4.3%', fdir: 'up', posts: 3, dms: '88dm', mrr: '€3 600',
    status: 'green', statusText: 'Onboarding terminé · à pousser',
    clientSince: 49, nextCall: 'mer 11h', momentumScore: 68, iClosedRate: 16, calendlyMonthly: 5,
    weeklyHistory: genHistory(17800, 2400, 3400, 8),
    plan: [
      { label: 'Brief identité visuelle client', done: true, meta: 'fait' },
      { label: 'Publier 4 posts IG', done: false, meta: '3/4' },
      { label: 'Envoyer 90 DM', done: false, meta: '88/90' },
      { label: 'Cas client vidéo', done: false, meta: 'à tourner' },
    ],
    privateNotes: 'Onboarding terminé avec succès. Momentum fort. Pousser sur les DM et les cas clients.',
  },
  {
    id: 'yann', initials: 'YP', name: 'Yann Petit', niche: 'Fitness homme',
    week: 2, followers: '1.8k', fdelta: '+12%', fdir: 'up', posts: 3, dms: '34dm', mrr: '—',
    status: 'amber', statusText: 'Démarrage moyen · script DM à revoir',
    clientSince: 14, nextCall: 'ven 16h', momentumScore: 48, iClosedRate: 0, calendlyMonthly: 2,
    weeklyHistory: genHistory(1600, 0, 0, 9),
    plan: [
      { label: 'Reécrire script DM', done: false, meta: 'urgent' },
      { label: 'Publier 3 Reels workout', done: false, meta: '3/3' },
      { label: 'Définir avatar précis', done: false, meta: 'en cours' },
    ],
    privateNotes: 'Script DM trop générique. Croissance followers bonne mais taux de réponse DM faible (4%).',
  },
  {
    id: 'margot', initials: 'ML', name: 'Margot Lefèvre', niche: 'Productivité',
    week: 10, followers: '34.5k', fdelta: '+6.1%', fdir: 'up', posts: 4, dms: '124dm', mrr: '€7 400',
    status: 'green', statusText: 'Cohérente, prête pour scale',
    clientSince: 70, nextCall: '17:00', momentumScore: 83, iClosedRate: 22, calendlyMonthly: 7,
    weeklyHistory: genHistory(31000, 4400, 7000, 10),
    plan: [
      { label: 'Lancement offre accompagnement', done: false, meta: 'S11' },
      { label: 'Publier 4 posts prod', done: true, meta: 'fait' },
      { label: 'Envoyer 120 DM', done: false, meta: '124/120' },
      { label: 'Template notion offert', done: true, meta: 'fait' },
    ],
    privateNotes: 'Prête à lancer une offre propre. A déjà 3 prospects chauds identifiés.',
  },
  {
    id: 'driss', initials: 'DE', name: 'Driss El Amrani', niche: 'Crypto education',
    week: 5, followers: '9.2k', fdelta: '-0.3%', fdir: 'down', posts: 1, dms: '18dm', mrr: '€900',
    status: 'amber', statusText: 'Engagement ↓ · contenu trop niché',
    clientSince: 35, nextCall: 'lun 14h', momentumScore: 38, iClosedRate: 6, calendlyMonthly: 3,
    weeklyHistory: genHistory(9300, 2100, 900, 11),
    plan: [
      { label: 'Élargir sujet (finance perso)', done: false, meta: 'à tester' },
      { label: 'Publier 3 posts', done: false, meta: '1/3' },
      { label: 'Reformater les hooks', done: false, meta: 'brouillon' },
    ],
    privateNotes: 'Trop orienté crypto technique. Audience trop petite et baisse engagement. Pivoter vers finance perso.',
  },
  {
    id: 'pauline', initials: 'PA', name: 'Pauline Aubry', niche: 'Carrière femmes',
    week: 13, followers: '82.4k', fdelta: '+9.7%', fdir: 'up', posts: 5, dms: '198dm', mrr: '€22 100',
    status: 'green', statusText: 'Plafond proche · upsell ?',
    clientSince: 91, nextCall: 'jeu 10h', momentumScore: 94, iClosedRate: 38, calendlyMonthly: 14,
    weeklyHistory: genHistory(74000, 7800, 21000, 12),
    plan: [
      { label: 'Proposition offre mastermind', done: false, meta: 'à préparer' },
      { label: 'Publier 5 posts inspirants', done: true, meta: 'fait' },
      { label: 'Podcast invité ×2', done: false, meta: '1/2' },
      { label: 'Landing page offre premium', done: false, meta: 'en cours' },
    ],
    privateNotes: 'Résultats exceptionnels. Prête pour offre mastermind à 3-5k€. Préparer proposition S14.',
  },
  {
    id: 'lucas', initials: 'LM2', name: 'Lucas Martin', niche: 'Voyage solo',
    week: 1, followers: '0.8k', fdelta: '+340%', fdir: 'up', posts: 7, dms: '12dm', mrr: '—',
    status: 'green', statusText: 'Onboarding J+5 · momentum fort',
    clientSince: 5, nextCall: 'mer 15h', momentumScore: 71, iClosedRate: 0, calendlyMonthly: 1,
    weeklyHistory: genHistory(600, 0, 0, 13),
    plan: [
      { label: 'Définir niche voyage précise', done: true, meta: 'fait' },
      { label: 'Publier 7 posts cette semaine', done: true, meta: 'fait' },
      { label: 'Premier DM test ×12', done: false, meta: '12/12' },
      { label: 'Identité visuelle compte', done: false, meta: 'en cours' },
    ],
    privateNotes: 'Démarrage très fort. 7 posts en 5 jours. Maintenir le rythme et orienter vers la monétisation.',
  },
  {
    id: 'naima', initials: 'NC', name: 'Naïma Cherif', niche: 'Coaching parental',
    week: 8, followers: '11.6k', fdelta: '-2.4%', fdir: 'down', posts: 0, dms: '14dm', mrr: '€2 400',
    status: 'red', statusText: '3 deadlines manquées · intervention',
    clientSince: 56, nextCall: 'appel urgent', momentumScore: 15, iClosedRate: 5, calendlyMonthly: 2,
    weeklyHistory: genHistory(12000, 0, 2500, 14),
    plan: [
      { label: 'Call d\'urgence avec Marc', done: false, meta: 'urgent' },
      { label: 'Publier 2 posts minimum', done: false, meta: '0/2' },
      { label: 'Revoir objectifs S9', done: false, meta: 'à faire' },
    ],
    privateNotes: 'Situation préoccupante. 3 deadlines manquées consécutives. Identifier le blocage réel (vie perso?).',
  },
  {
    id: 'anais', initials: 'AR', name: 'Anaïs Robin', niche: 'Coach RH',
    week: 12, followers: '14.8k', fdelta: '-0.5%', fdir: 'down', posts: 1, dms: '24dm', mrr: '€3 100',
    status: 'amber', statusText: 'Décrochage progressif · call urgent',
    clientSince: 84, nextCall: 'S12', momentumScore: 32, iClosedRate: 9, calendlyMonthly: 3,
    weeklyHistory: genHistory(15000, 1100, 3200, 15),
    plan: [
      { label: 'Analyser le décrochage', done: false, meta: 'S12' },
      { label: 'Reformater l\'offre RH', done: false, meta: 'à discuter' },
      { label: 'Publier 3 posts RH', done: false, meta: '1/3' },
    ],
    privateNotes: 'Perte de motivation progressive. Peut-être repositionner la niche vers manager/leadership.',
  },
  {
    id: 'adrien', initials: 'AF', name: 'Adrien Faure', niche: 'Comédie créateur',
    week: 6, followers: '28.4k', fdelta: '+14%', fdir: 'up', posts: 4, dms: '76dm', mrr: '€5 200',
    status: 'green', statusText: 'Engagement record · pic semaine',
    clientSince: 42, nextCall: 'lun 14h', momentumScore: 89, iClosedRate: 24, calendlyMonthly: 6,
    weeklyHistory: genHistory(24000, 5200, 4900, 16),
    plan: [
      { label: 'Capitaliser sur viral (3 reels)', done: false, meta: '1/3' },
      { label: 'Contacter médias', done: false, meta: 'en cours' },
      { label: 'Envoyer 80 DM chauds', done: false, meta: '76/80' },
    ],
    privateNotes: 'Reel viral à 180k vues. Moment idéal pour accélérer la monétisation.',
  },
  {
    id: 'maxime', initials: 'MB', name: 'Maxime Bouvier', niche: 'Tech YouTube',
    week: 9, followers: '92k', fdelta: '+7.0%', fdir: 'up', posts: 8, dms: '287dm', mrr: '€15 600',
    status: 'green', statusText: 'Trajectoire haute · à packager',
    clientSince: 63, nextCall: 'mer 10h', momentumScore: 91, iClosedRate: 31, calendlyMonthly: 11,
    weeklyHistory: genHistory(85000, 78000, 14800, 17),
    plan: [
      { label: 'Lancer programme YouTube premium', done: false, meta: 'S10' },
      { label: 'Publier 2 vidéos YouTube', done: true, meta: 'fait' },
      { label: 'Newsletter tech ×2', done: false, meta: '1/2' },
      { label: 'Partenariat outil', done: false, meta: 'en négociation' },
    ],
    privateNotes: 'Profil premium. Envisager deal rev-share sur ses formations.',
  },
  {
    id: 'elodie', initials: 'EV', name: 'Élodie Vasseur', niche: 'Maman entrepreneure',
    week: 5, followers: '15.1k', fdelta: '+2.4%', fdir: 'up', posts: 3, dms: '67dm', mrr: '€3 100',
    status: 'green', statusText: 'Sur le rythme',
    clientSince: 35, nextCall: 'jeu 11h', momentumScore: 62, iClosedRate: 14, calendlyMonthly: 4,
    weeklyHistory: genHistory(14200, 0, 2900, 18),
    plan: [
      { label: 'Publier 3 posts maman/biz', done: true, meta: 'fait' },
      { label: 'Envoyer 70 DM', done: false, meta: '67/70' },
      { label: 'Story Q&A maman', done: false, meta: 'planifié' },
    ],
    privateNotes: 'Équilibre vie perso/biz est sa force différenciante. Capitaliser dessus.',
  },
  {
    id: 'nicolas', initials: 'NT', name: 'Nicolas Tessier', niche: 'Photo immo',
    week: 3, followers: '2.4k', fdelta: '+8.7%', fdir: 'up', posts: 4, dms: '28dm', mrr: '€700',
    status: 'green', statusText: 'Onboarding actif · structuré',
    clientSince: 21, nextCall: 'lun 16h', momentumScore: 55, iClosedRate: 3, calendlyMonthly: 2,
    weeklyHistory: genHistory(2100, 0, 600, 19),
    plan: [
      { label: 'Portfolio 10 meilleures photos', done: false, meta: '7/10' },
      { label: 'Publier 4 posts immo', done: true, meta: 'fait' },
      { label: 'Premiers DM agents immo', done: false, meta: '28/30' },
    ],
    privateNotes: 'Travail de qualité. Trop timide sur les DM. Encourager à être plus agressif.',
  },
  {
    id: 'clara', initials: 'CM', name: 'Clara Mercier', niche: 'Naturopathe',
    week: 10, followers: '24.8k', fdelta: '+6.8%', fdir: 'up', posts: 5, dms: '142dm', mrr: '€6 800',
    status: 'green', statusText: 'Bonne dynamique',
    clientSince: 70, nextCall: 'mar 14h', momentumScore: 79, iClosedRate: 20, calendlyMonthly: 7,
    weeklyHistory: genHistory(22400, 1800, 6400, 20),
    plan: [
      { label: 'Pack bien-être S10', done: false, meta: 'en cours' },
      { label: 'Publier 5 posts', done: true, meta: 'fait' },
      { label: 'Envoyer 140 DM', done: false, meta: '142/140' },
    ],
    privateNotes: 'Très bonne rétention client. À pousser sur la création d\'une formation courte.',
  },
  {
    id: 'theo', initials: 'TD', name: 'Théo Dussault', niche: 'Dropshipping',
    week: 11, followers: '41.2k', fdelta: '+5.1%', fdir: 'up', posts: 3, dms: '88dm', mrr: '€9 400',
    status: 'green', statusText: 'Stable, à pousser sur upsell',
    clientSince: 77, nextCall: 'ven 14h', momentumScore: 74, iClosedRate: 28, calendlyMonthly: 8,
    weeklyHistory: genHistory(38000, 4200, 8900, 21),
    plan: [
      { label: 'Préparer upsell formation', done: false, meta: 'S12' },
      { label: 'Publier 3 posts résultats', done: true, meta: 'fait' },
      { label: 'DM fournisseurs', done: false, meta: '88/80' },
    ],
    privateNotes: 'Revenue stable. Opportunité upsell vers mentorat dropshipping avancé.',
  },
  {
    id: 'mehdi', initials: 'MZ', name: 'Mehdi Ziani', niche: 'Dev créateur',
    week: 2, followers: '1.1k', fdelta: '+21%', fdir: 'up', posts: 6, dms: '24dm', mrr: '—',
    status: 'green', statusText: 'Démarrage fort',
    clientSince: 14, nextCall: 'mer 17h', momentumScore: 66, iClosedRate: 0, calendlyMonthly: 1,
    weeklyHistory: genHistory(900, 0, 0, 22),
    plan: [
      { label: 'Définir niche dev précise', done: true, meta: 'fait' },
      { label: 'Publier 6 posts code', done: true, meta: 'fait' },
      { label: 'Lancer newsletter dev', done: false, meta: 'S3' },
    ],
    privateNotes: 'Profil atypique dev/créateur. Fort potentiel sur Instagram et YouTube.',
  },
  {
    id: 'sarah', initials: 'SL', name: 'Sarah Lambert', niche: 'Wellness',
    week: 4, followers: '4.8k', fdelta: '+5.2%', fdir: 'up', posts: 3, dms: '56dm', mrr: '€1 200',
    status: 'green', statusText: 'Onboarding solide',
    clientSince: 28, nextCall: 'mar 11h', momentumScore: 58, iClosedRate: 8, calendlyMonthly: 3,
    weeklyHistory: genHistory(4300, 0, 1100, 23),
    plan: [
      { label: 'Publier 3 posts wellness', done: true, meta: 'fait' },
      { label: 'Envoyer 60 DM', done: false, meta: '56/60' },
      { label: 'Créer lead magnet', done: false, meta: 'en cours' },
    ],
    privateNotes: 'Progression régulière. Lead magnet bien-être pourrait accélérer la liste email.',
  },
  {
    id: 'julien', initials: 'JR', name: 'Julien Roche', niche: 'E-commerce',
    week: 7, followers: '6.5k', fdelta: '+3.1%', fdir: 'up', posts: 2, dms: '42dm', mrr: '€2 400',
    status: 'amber', statusText: 'À recadrer sur format',
    clientSince: 49, nextCall: 'jeu 16h', momentumScore: 44, iClosedRate: 11, calendlyMonthly: 4,
    weeklyHistory: genHistory(6000, 0, 2200, 24),
    plan: [
      { label: 'Tester format Reel résultats', done: false, meta: 'à tester' },
      { label: 'Envoyer 45 DM', done: false, meta: '42/45' },
      { label: 'Publier 3 posts', done: false, meta: '2/3' },
    ],
    privateNotes: 'Format actuel (posts texte) peu engageant. Switcher vers Reels avant/après e-commerce.',
  },
];

/* ─── Calls ─── */
export const callsToday: Call[] = [
  { time: '10:00', clientId: 'thomas',  topic: 'Script DM',        ready: 'ready',   date: 'Mercredi 12 nov', duration: '45 min' },
  { time: '11:30', clientId: 'lea',     topic: 'Stratégie offre',  ready: 'ready',   date: 'Mercredi 12 nov', duration: '45 min' },
  { time: '14:00', clientId: 'camille', topic: 'Scale équipe',     ready: 'partial', date: 'Mercredi 12 nov', duration: '60 min' },
  { time: '15:30', clientId: 'antoine', topic: 'Réactivation',     ready: 'ready',   date: 'Mercredi 12 nov', duration: '30 min' },
  { time: '17:00', clientId: 'margot',  topic: 'Lancement offre',  ready: 'ready',   date: 'Mercredi 12 nov', duration: '45 min' },
];

export const callsHistory: Call[] = [
  { time: '10:00', clientId: 'thomas',  topic: 'Audit DM S7',        ready: 'ready', date: 'Mer 5 nov', duration: '45 min', notes: 'Taux de réponse en chute. Hook à retravailler.' },
  { time: '11:30', clientId: 'sofia',   topic: 'Review contenu S6',  ready: 'ready', date: 'Mer 5 nov', duration: '40 min', notes: 'Format carrousel très performant.' },
  { time: '14:00', clientId: 'hugo',    topic: 'Module 2 déblocage', ready: 'ready', date: 'Mar 4 nov', duration: '30 min', notes: 'Besoin de quick wins pour la motivation.' },
  { time: '15:00', clientId: 'ines',    topic: 'Onboarding final',   ready: 'ready', date: 'Lun 3 nov', duration: '60 min', notes: 'Onboarding terminé. Très bon profil.' },
  { time: '10:00', clientId: 'lea',     topic: 'Objectifs S11',      ready: 'ready', date: 'Mer 29 oct', duration: '45 min', notes: 'Progression exceptionnelle. Prête pour upsell.' },
];

/* ─── Activity feed ─── */
export const activity24h: ActivityItem[] = [
  { clientId: 'camille', desc: 'Reel à 18k vues · pic d\'engagement', when: 'il y a 1h', status: 'green' },
  { clientId: 'adrien',  desc: '+2 400 followers en 24h', when: 'il y a 2h', status: 'green' },
  { clientId: 'thomas',  desc: 'Aucun post · DM ↓35% sur 7j', when: 'il y a 3h', status: 'red' },
  { clientId: 'antoine', desc: '9 jours sans publication', when: 'il y a 4h', status: 'red' },
  { clientId: 'lea',     desc: 'Objectif DM atteint (156/150)', when: 'il y a 5h', status: 'green' },
  { clientId: 'pauline', desc: 'Story partagée 3 200 fois', when: 'il y a 7h', status: 'green' },
  { clientId: 'naima',   desc: 'Aucune activité chat depuis 6j', when: 'il y a 9h', status: 'red' },
  { clientId: 'maxime',  desc: 'Vidéo YouTube : 14k vues en 24h', when: 'il y a 11h', status: 'green' },
  { clientId: 'margot',  desc: 'DM envoyés : 124/120 · objectif dépassé', when: 'il y a 13h', status: 'green' },
];

/* ─── Conversations ─── */
export const conversations: Conversation[] = [
  { clientId: 'thomas',  last: 'OK je m\'y mets ce soir',       when: '4j', unread: false, dot: 'red' },
  { clientId: 'lea',     last: 'Merci ! On en parle mercredi',   when: '1h', unread: true,  dot: 'green' },
  { clientId: 'hugo',    last: 'Tu peux me débloquer le module ?', when: '2h', unread: true, dot: 'amber' },
  { clientId: 'sofia',   last: 'Le nouveau format marche très bien', when: '3h', unread: false, dot: 'green' },
  { clientId: 'karim',   last: 'Je relance les Reels demain',    when: '4h', unread: false, dot: 'amber' },
  { clientId: 'camille', last: 'On scale ! 6 nouveaux clients',  when: '5h', unread: true,  dot: 'green' },
  { clientId: 'antoine', last: '...',                            when: '6h', unread: false, dot: 'red' },
  { clientId: 'ines',    last: 'Brief envoyé, tu valides ?',     when: '7h', unread: true,  dot: 'green' },
  { clientId: 'yann',    last: '...',                            when: '8h', unread: false, dot: 'amber' },
  { clientId: 'margot',  last: 'Objectif DM dépassé !',          when: '8h', unread: false, dot: 'green' },
];

/* ─── Chat thomas (full) ─── */
export const thomasChat: Message[] = [
  { who: 'Thomas', side: 'them', day: 'lundi 4 nov', text: 'Salut Marc, je galère un peu sur les DM cette semaine', time: '09:14' },
  { who: 'Marc',   side: 'me',   text: 'OK, montre-moi 2-3 DM que tu as envoyés et leur réponse', time: '09:20' },
  { who: 'Thomas', side: 'them', text: 'Voilà : « Hey [prénom], je vois que tu fais du SaaS, ça t\'intéresse de discuter ? » → souvent zéro réponse', time: '09:23' },
  { who: 'Marc',   side: 'me',   text: 'Le hook est trop générique. On retravaille jeudi. En attendant: teste « problème + chiffre » — ex « 80% des SaaS B2B ratent leur onboarding ».', time: '09:28' },
  { who: 'Thomas', side: 'them', day: 'jeudi 7 nov', text: 'OK je m\'y mets ce soir', time: '18:42' },
];

/* ─── Resources ─── */
export const resources: Resource[] = [
  { id: 'r1', title: 'Module 1 · Fondamentaux personal branding', type: 'Vidéo', desc: 'Les 5 piliers pour construire une audience organique solide en 90 jours.', duration: '24 min', week: 1 },
  { id: 'r2', title: 'Pack 50 hooks IG testés', type: 'Notion', desc: 'Hooks classés par type : émotion, chiffre, question, controverse, storytelling.', week: 1 },
  { id: 'r3', title: 'Script DM haute conversion', type: 'Template', desc: 'Framework problème + chiffre + invitation. Taux de réponse moyen : 22%.', week: 2 },
  { id: 'r4', title: 'Module 2 · Algorithme et formats', type: 'Vidéo', desc: 'Décryptage de l\'algorithme Instagram et YouTube 2024 — les formats qui percent vraiment.', duration: '18 min', week: 2 },
  { id: 'r5', title: 'Audit profil IG · Checklist 40 points', type: 'Checklist', desc: 'Vérifier bio, highlights, grille, stories permanentes, et lien en bio.', week: 3 },
  { id: 'r6', title: 'Module 3 · Contenu qui convertit', type: 'Vidéo', desc: 'Comment passer de la croissance followers à la génération de leads qualifiés.', duration: '31 min', week: 3 },
  { id: 'r7', title: 'Brief tournage premium', type: 'Template', desc: 'Préparer un tournage batch en 4h : script, angle, CTA, montage.', week: 4 },
  { id: 'r8', title: 'Module 4 · Monétisation organique', type: 'Vidéo', desc: 'Les 3 offres qui se vendent en DM + structure d\'un appel de closing.', duration: '27 min', week: 4 },
  { id: 'r9', title: 'Calendrier éditorial 12 semaines', type: 'Notion', desc: 'Planning complet avec thèmes, formats et objectifs par semaine.', week: 5 },
  { id: 'r10', title: 'Module 5 · Personal branding avancé', type: 'Vidéo', desc: 'Comment créer un univers de marque cohérent sur tous les canaux.', duration: '22 min', week: 5 },
  { id: 'r11', title: 'Kit copywriting Stories', type: 'PDF', desc: '30 structures de stories qui génèrent des DM entrants.', week: 6 },
  { id: 'r12', title: 'Module 6 · Scale et délégation', type: 'Vidéo', desc: 'Quand et comment déléguer sa création de contenu sans perdre l\'authenticité.', duration: '19 min', week: 6 },
  { id: 'r13', title: 'Module 7 · Scale offre', type: 'Vidéo', desc: 'Construire une offre premium et la vendre à 2-5k€ en 30 jours.', duration: '12 min', week: 7 },
  { id: 'r14', title: 'Template tournage premium', type: 'PDF', desc: 'Structure complète pour tourner des Reels qui convertissent.', week: 7 },
  { id: 'r15', title: 'Analyse concurrentielle', type: 'Template', desc: 'Framework pour analyser 5 concurrents et identifier les angles non occupés.', week: 8 },
];

/* ─── Helpers ─── */
export function getClient(id: string): Client | undefined {
  return clients.find(c => c.id === id);
}

export function getWatchList(): Client[] {
  return clients.filter(c => c.status === 'red');
}

export function getTotalMRR(): number {
  return clients.reduce((sum, c) => {
    const val = parseInt(c.mrr.replace(/[^0-9]/g, '')) || 0;
    return sum + val;
  }, 0);
}

export function getActiveClients(): number {
  return clients.filter(c => c.status !== 'red').length;
}
