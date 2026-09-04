'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { CALL_TYPES_VENTE } from '@/lib/callTypes';
import { CALL_COLUMNS } from '@/lib/supabase/types';
import { parcoursDesLeads, parcoursDesLiensPartages, type RefsParcours, type CallParcours, type PriseParcours, type CallPartage } from '@/lib/parcoursLeads';
import InlineLoader from '@/components/ui/InlineLoader';
import BandeauIntegrations from '@/components/analytics/BandeauIntegrations';
import { useQuery } from '@tanstack/react-query';
import { createPortal } from 'react-dom';
import { useEscapeKey } from '@/lib/useEscapeKey';
import { createClient } from '@/lib/supabase/client';
import { isOnlineNow } from '@/lib/useOnline';
import AreaChart, { todayDotFactory, lastRealPointKey } from '@/components/charts/AreaChart';
import BarChart from '@/components/charts/BarChart';
import Heatmap from '@/components/charts/Heatmap';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, PieChart, Pie, Cell,
  AreaChart as ReAreaChart, Area,
} from 'recharts';
import { getPeriodWindow, parisDateStr, parisAddDays } from '@/lib/period';
import PeriodPill, { periodLabel, type Period } from '@/components/ui/PeriodPill';
// La regle unique de « l'argent reellement encaisse » : encaisse - rembourse -
// conteste. Cet ecran la recopiait implicitement en ne gardant que `succeeded`,
// donc sans jamais deduire un remboursement.
import { calculerCash, encaisseRetenu, aRembourser, type LignePaiement } from '@/lib/dealCash';
import { granulariteFenetre, regrouperComptage, regrouperTaux, regrouperParPas, libelleBucket, type Granularite, type NatureSerie } from '@/lib/chart-buckets';
// Listes de catégories : UNE seule définition (lib/shortio-link-category.ts). Elles
// étaient recopiées trois fois dans ce fichier (TOTAL_CLICS_CATS, SNAP_BUSINESS_CATS,
// CHART_BUSINESS_CATS) plus trois fois pour bio/contenu — six occasions de diverger à
// la prochaine catégorie ajoutée. Un test vérifie que les groupes du graphique
// couvrent exactement les catégories comptées dans « Clics totaux ».
import { BUSINESS_CATEGORIES, CATEGORY_GROUPS } from '@/lib/shortio-link-category';

const CATS_BUSINESS = new Set<string>(BUSINESS_CATEGORIES);
const CATS_BIO_IG = new Set<string>(CATEGORY_GROUPS.bioIg);
const CATS_BIO_YT = new Set<string>(CATEGORY_GROUPS.bioYt);
const CATS_CONTENT_IG = new Set<string>(CATEGORY_GROUPS.contentIg);
const CATS_CONTENT_YT = new Set<string>(CATEGORY_GROUPS.contentYt);
const CATS_DM_CALENDLY = new Set<string>(CATEGORY_GROUPS.dmCalendly);
const CATS_DM_LM = new Set<string>(CATEGORY_GROUPS.dmLm);
const CATS_STORY = new Set<string>(CATEGORY_GROUPS.story);
import { isCallHonored } from '@/lib/callHonored';
import { contenuConversion, acquisitionParContenu, contenuActivation, SANS_CONTENU } from '@/lib/attribution-roles';
import { isCallCanceled } from '@/lib/sessionRapport';
import { usePeriodesIg, porteeDeLaPeriode, typePeriodePour, type TypePeriodeIg } from '@/lib/porteeIg';
import { bucketCallsByBookedDay, parisDayRange, tauxOuTrou, idsDeContinuation, representantDOpportunite } from '@/lib/callSeries';
// Icones des en-tetes de colonne — source unique pour les trois tableaux de Business
// micro. Quatorze colonnes portent le meme nom d'un tableau a l'autre et doivent donc
// porter le meme symbole.
import { EnteteColonne, type NomIcone } from './IconesColonnes';
import { dureeDepuisSecondes, dureeDepuisMinutes, positionLecteur, formaterDureeVideo } from '@/lib/duree';
import { canalDuDm } from '@/lib/canalDm';

// ─── Portal Modal ─────────────────────────────────────────────────────────────
function usePortalMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  return mounted;
}

function ModalOverlay({ children, onClose, maxWidth = 760 }: { children: React.ReactNode; onClose: () => void; maxWidth?: number }) {
  const mounted = usePortalMounted();
  if (!mounted) return null;
  return createPortal(
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={onClose}>
      <div style={{ width: '100%', maxWidth }} onClick={e => e.stopPropagation()}>{children}</div>
    </div>,
    document.body
  );
}

// Wrapper portal pour les modals inline — contourne le stacking context de PageTransition (transform)
function Portal({ children }: { children: React.ReactNode }) {
  const mounted = usePortalMounted();
  if (!mounted) return null;
  return createPortal(<>{children}</>, document.body);
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface IGStats {
  username: string; name: string; profilePicture: string | null;
  followers: number; following: number; mediaCount: number; biography: string;
  reach30d: number; reach28dDedupFollowers?: number | null; reach28dDedupNonFollowers?: number | null;
  /** Portee dedupliquee TOTALE de la periode, mesuree par Meta. Ce n'est PAS la somme
   *  des deux seaux : un compte peut basculer d'un seau a l'autre dans la fenetre et y
   *  etre compte deux fois. Denominateur de « Non-abonnes touches ». */
  reachTotalPeriode?: number | null;
  /** Nombre d'abonnes MOYEN sur la periode, fige par le cron. Absent = periode courante. */
  abonnesPeriode?: number | null; accountsEngaged30d: number; totalInteractions30d: number;
  /** Fenetre reellement interrogee pour les deux cartes de portee, en jours (30 ou 365). */
  fenetreJours?: number;
  /** Bornes de la ligne `analytics_ig_periodes` d'ou viennent REELLEMENT les deux
   *  cartes de portee. Le libelle doit venir d'ici et non de `fenetreJours`, qui est
   *  calcule par une autre requete : deux sources pour une meme fenetre finissent par
   *  decrire deux fenetres differentes. */
  porteeDebut?: string | null; porteeFin?: string | null;
  followsUnfollows30d: number; profileLinksTaps30d: number; websiteClicks30d: number;
  views30d: number;
  viewsFollowerBreakdown: { follower: number; nonFollower: number } | null;
  chartData: { date: string; reach: number; followerCount?: number | null; views?: number; accountsEngaged?: number; totalInteractions?: number; websiteClicks?: number; reachFollower?: number | null; reachNonFollower?: number | null }[];
  posts: IGPost[]; demographics: Record<string, { label: string; value: number }[]>;
  onlineFollowers: any;
}
interface IGPost {
  id: string; caption: string; type: string; thumbnail: string | null;
  timestamp: string; permalink: string;
  likes: number | null; comments: number | null; reach: number | null;
  saved: number | null; shares: number | null; views: number | null;
  totalInteractions: number | null; follows: number | null; profileVisits: number | null;
  avgWatchTimeMs: number | null;
  totalWatchTimeMs: number | null; skipRate: number | null;
  /** Duree du fichier video, en secondes. `null` quand elle n'a pas encore ete
   *  mesuree, ou quand Meta ne sert pas le fichier (musique protegee) — un trou,
   *  jamais un zero. Elle ne vient d'aucun champ d'API : voir mesurerDureePost. */
  dureeSec: number | null;
}
interface YTStats {
  channelName: string; channelThumbnail: string; subscribers: number;
  totalViews: number; videoCount: number;
  views30d: number; watchTime30d: number; avgViewDurationSec?: number; likes30d: number; comments30d: number;
  shares30d: number; subsGained30d: number; subsLost30d: number; netSubs30d: number;
  // avgDurationShorts/Long : durée moyenne de visionnage du jour, par format
  // (colonnes yt_avg_duration_shorts_sec / _long_sec, alimentées depuis la dimension
  // creatorContentType de l'API). null quand le format n'a eu aucune vue ce jour-là —
  // jamais 0, qui se lirait « personne n'a regardé ».
  chartData: { date: string; views: number; watchTime: number; subsGained?: number; subsLost?: number; netSubs?: number; likes?: number; comments?: number; shares?: number; subscribers?: number | null; avgViewDurationSec?: number | null; avgDurationShorts?: number | null; avgDurationLong?: number | null; viewsShorts?: number | null; viewsLong?: number | null; watchTimeShorts?: number | null; watchTimeLong?: number | null }[];
  videos: YTVideo[]; trafficSources: { source: string; views: number; watchMinutes: number }[];
  devices: { device: string; views: number; watchMinutes: number }[];
  demographics: { ageGroup: string; gender: string; viewerPct: number }[];
  searchKeywords: { term: string; views: number }[];
}
interface YTVideo {
  id: string; title: string; thumbnail: string; publishedAt: string;
  duration: string; isShort: boolean;
  views: number; likes: number; comments: number;
  views30d: number; watchTime30d: number; avgViewPct: number;
  likes30d: number; comments30d: number; shares30d: number; url: string;
  /** Total de vues depuis la publication — denominateur des ratios watch time / vues,
   *  qui doivent diviser deux valeurs de la MEME fenetre. `views30d` porte lui les vues
   *  des 30 derniers jours, une notion differente. */
  viewsAllTime?: number;
  /** CTR de la miniature, en RATIO (0-1) tel que stocké dans
   *  analytics_yt_videos_history.ctr — multiplier par 100 pour l'affichage.
   *  null quand YouTube n'a pas encore produit de rapport pour cette vidéo. */
  ctr?: number | null;
}
interface CallRecord {
  id: string; scheduled_at: string; status: 'active' | 'canceled';
  invitee_name: string; invitee_email: string; duration: number;
  no_show?: boolean; deal_closed?: boolean; revenue?: number;
  rescheduled?: boolean; source?: string; notes?: string;
  ig_lead_id?: string | null; outcome?: string | null;
  utm_content?: string | null; utm_medium?: string | null;
  /** Repli d'attribution LEGITIME : le lien prospect par lequel ce call est arrive. */
  prospect_link_id?: string | null;
  qualified?: boolean | null; booked_at?: string | null;
  lead_deleted?: boolean | null; ignored?: boolean | null;
}

/**
 * Les paiements de la periode, lus dans `deal_payments`.
 *
 * `mrr`, `monthlyRevenue`, `activeSubscriptions` et `availableBalance` ont ete retires :
 * ils etaient renseignes des deux cotes et lus nulle part, et `monthlyRevenue` sommait
 * tous les statuts, remboursements compris. Un champ mort qui porte de l'argent finit
 * par etre branche ailleurs tel quel.
 */
interface IGMessages {
  // null = inconnu, et non zero. Le chemin HISTORIQUE ne sait rien de ces deux champs :
  // il les lisait dans `ig_response_rate`, colonne supprimee le 2026-09-01 apres avoir
  // ete mesuree vide sur 100 % de ses lignes depuis l'origine. Seul le chemin instantane
  // (/api/instagram/messages) calcule un vrai taux, a partir des conversations reelles.
  totalThreads30d: number; repliedThreads: number | null; responseRate: number | null; leadCount: number;
  keywordCounts: Record<string, number>;
  threads: { threadId: string; updatedAt: string; messageCount: number; hasReply: boolean; participant: string; preview: string; isLead: boolean }[];
}
interface ShortioStats {
  domain: string; totalLinks: number; clicsAvecBots: number; clicsHumains: number;
  clicksChange: number | null; clicsHumainsParLien: number;
  chartData: { date: string; clicks: number }[];
  topCountries: { label: string; value: number }[];
  topReferrers: { label: string; value: number }[];
  topBrowsers: { label: string; value: number }[];
  topOs: { label: string; value: number }[];
  topSocial: { label: string; value: number }[];
  topCities: { label: string; value: number }[];
  links: ShortioLink[];
}
interface ShortioLink {
  id: number; path: string; shortUrl: string; originalUrl: string; title: string;
  createdAt: string; clicsAvecBots: number; clicsHumains: number; clicksChange: number | null;
  chartData: { date: string; clicks: number }[];
  countries: { label: string; value: number }[];
  referrers: { label: string; value: number }[];
  browsers: { label: string; value: number }[];
  os: { label: string; value: number }[];
  social: { label: string; value: number }[];
  cities: { label: string; value: number }[];
  utmMedium: { label: string; value: number }[];
  utmSource: { label: string; value: number }[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number, decimals = 0) => n.toLocaleString('fr-FR', { maximumFractionDigits: decimals });
const fmtEur = (n: number) => `${fmt(n)} €`;
const fmtPct = (n: number) => `${fmt(n, 1)} %`;
const fmtMs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

const isIGCall = (c: { source?: string | null }) => {
  const s = (c.source || '').toLowerCase();
  return s.startsWith('ig') || s.startsWith('instagram') || s.startsWith('ubizenai');
};
const isYTCall = (c: { source?: string | null }) => {
  const s = (c.source || '').toLowerCase();
  return s.startsWith('yt') || s.startsWith('youtube');
};

/**
 * LES ABONNES SONT UN ETAT, PAS UNE ACTIVITE — et c'est vrai sur les trois onglets.
 *
 * Arbitrage de Chris, 2026-09-01. Ces ecrans ont porte trois versions de la meme
 * carte : « total » (le mot n'apprenait rien et laissait croire a un cumul),
 * « au 30 juin » (le compte a la fin de la fenetre consultee), et « aujourd'hui ».
 * Un lecteur qui passait de Vue generale a l'onglet Instagram sur un mois passe voyait
 * donc DEUX nombres differents — 255 et 253 — pour ce qu'il lit comme la meme carte.
 *
 * La regle retenue est celle qui existait deja ailleurs sur ces ecrans : « publications »
 * est une ACTIVITE, elle suit la periode ; « abonnes » est un ETAT, il ne se cumule pas
 * et n'a pas de sens historique dans une vue de periode. Les trois onglets affichent
 * donc le compte du JOUR, lu sur l'appel live, qui ne depend d'aucune fenetre.
 *
 * Ce que la periode continue de dire reste dit — par le BADGE de variation a cote du
 * chiffre (« +1 sur 30j »), qui lui est bien une activite.
 */

/**
 * Bandeau « données disponibles depuis le … ».
 *
 * Les graphiques s'arrêtent à la date de démarrage de l'élève (un trou, pas un zéro),
 * mais un graphique tronqué ne dit pas POURQUOI il est tronqué. Les élèves arrivent en
 * milieu de mois — le 9, 28, 13 et 16 pour les quatre en base au 2026-08-20 — donc un
 * mois où l'élève n'était là que quatre jours se lit comme un mois faible.
 *
 * Posé UNE FOIS au niveau du conteneur d'onglets plutôt que recopié dans chacun : c'est
 * la même règle pour tous, et une règle recopiée finit toujours par diverger.
 * Ne s'affiche que si la période commence réellement avant l'arrivée.
 */
function CoverageNotice({ periodStartStr, integrationsReadyAt }: {
  periodStartStr: string | null;
  integrationsReadyAt?: string | null;
}) {
  if (!integrationsReadyAt || !periodStartStr) return null;
  const arrival = new Date(integrationsReadyAt).toISOString().slice(0, 10);
  if (periodStartStr >= arrival) return null;

  // « le debut de la periode affichee n'est pas couvert » etait exact mais ne
  // disait ni ce que ca change, ni quoi en faire (retour de Chris, 2026-08-27).
  //
  // Puis « et n'ont aucune donnee / cet historique n'existe pas » s'est revele FAUX
  // (2026-08-31) : la recuperation d'historique Instagram remonte avant la mise en route
  // — les 8 premiers jours de juin pesent 11 de reach et 13 vues dans les totaux affiches
  // juste en dessous du bandeau. Ce qui s'arrete vraiment a la mise en route, c'est le
  // pipeline : leads, calls, revenus. Le texte distingue donc les deux.
  //
  // Ce qui compte pour qui lit les chiffres : les totaux de cette periode portent
  // sur MOINS de jours qu'une periode complete. Les comparer a un autre mois
  // conduirait a voir une baisse la ou il n'y a qu'un historique plus court. On
  // donne donc le nombre de jours manquants et la conclusion a en tirer.
  const joursManquants = Math.max(
    1,
    Math.round((new Date(arrival).getTime() - new Date(periodStartStr).getTime()) / 86400000),
  );
  const dateLisible = new Date(arrival).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'flex-start', gap: 6, padding: '0 2px 10px', lineHeight: 1.5 }}>
      <span aria-hidden style={{ opacity: .6, marginTop: 1 }}>◷</span>
      <span>
        Les comptes de cet élève ont été connectés le{' '}
        <strong style={{ color: 'var(--ink-2)' }}>{dateLisible}</strong>
        {' '}: les <strong style={{ color: 'var(--ink-2)' }}>{joursManquants} premiers jours</strong>{' '}de cette période
        précèdent la mise en route. Momentum n&apos;y a produit ni lead, ni call, ni revenu — ces
        totaux portent donc sur une période plus courte et ne se comparent pas à un mois complet.
        Le reach et les vues, eux, peuvent remonter plus tôt : ils viennent de la récupération
        d&apos;historique.
      </span>
    </div>
  );
}

/** Un deal, tel que le cash contracté en a besoin. `call_id` est null pour un deal
 *  créé hors pipeline (upsell, vente directe) — c'est précisément le cas que la somme
 *  des `calls.revenue` ne voyait pas. */
/** Une journee ou de l'argent a bouge — sortie de get_encaissements_par_jour. */
type JourEncaisse = { jour: string; encaisse: number | string; rembourse: number | string; conteste: number | string; nb_recus: number };
/** Une vente de la periode et les sommes de TOUS ses paiements — get_ventes_de_la_periode. */
type VenteCash = { deal_id: string; encaisse: number | string; rembourse: number | string; conteste: number | string };

/**
 * Les RPC renvoient des SOMMES par statut ; `calculerCash` attend des LIGNES.
 * On lui en fabrique une par statut plutot que de recopier ici
 * `encaisse - rembourse - conteste` : la regle du net reste ecrite une seule fois,
 * dans lib/dealCash.ts, dont la copie Deno est tenue identique par un test de parite.
 */
const lignesDepuisSommes = (r: { encaisse: number | string; rembourse: number | string; conteste: number | string }): LignePaiement[] => [
  { amount: r.encaisse, status: 'succeeded' },
  { amount: r.rembourse, status: 'refunded' },
  { amount: r.conteste, status: 'disputed' },
];

type DealRecord = {
  /** Sert à rapporter les paiements d'un deal à ce deal — taux de collecte par cohorte. */
  id?: string;
  amount_total: number | string;
  status?: string | null;
  signed_at?: string | null;
  call_id?: string | null;
  /** Qui a achete — colonne « Client » du tableau des ventes. */
  buyer_name?: string | null;
};

// Date de rattachement d'un call à une période : la RÉSERVATION, pas la tenue du
// rendez-vous. « Booké » désigne l'acte de réserver — c'est la production commerciale
// du mois, et c'est la date que le périmètre global utilise déjà (le fetch borne sur
// booked_at). Découper sur scheduled_at faisait entrer un call dans le périmètre en
// juin et le comptait en juillet. Repli sur scheduled_at pour les calls anciens
// importés sans booked_at. Voir docs/perimetre-stats-referentiel.md, règle 2.
const callPeriodDate = (c: { booked_at?: string | null; scheduled_at?: string | null }) =>
  c.booked_at ?? c.scheduled_at ?? '';

function pct(a: number, b: number) { return b > 0 ? Math.round((a / b) * 100) : 0; }

/**
 * LES VENTES D'UNE PERIODE — la seule definition, pour tout « Mes stats ».
 *
 * Trois choses, et chacune a corrige un ecart reel :
 *
 * 1. **La source est `deals`, jamais les calls.** Un deal peut exister SANS rendez-vous —
 *    un upsell, une vente hors pipeline. Le sommer depuis les calls le rend invisible.
 * 2. **La decoupe est `signed_at`**, volontairement une AUTRE date que celle des calls :
 *    un deal signe ce mois sur un rendez-vous du mois dernier appartient au cash de ce
 *    mois — c'est le mois ou l'argent a ete engage. Meme regle que `useCoachData`, donc
 *    l'accueil et Mes stats convergent sur la meme source ET la meme date.
 * 3. **Les ventes annulees sont exclues** : une vente annulee n'a pas ete signee. Meme
 *    filtre que `computeDealTotals` dans lib/salesCallStats.ts.
 *
 * En « depuis la connexion », les deals arrivent deja bornes par le fetch : on ne
 * refiltre pas sur une fenetre calendaire qui n'a pas de sens dans ce mode.
 *
 * Extraite le 2026-09-01 : l'onglet Revenus portait cette regle, Vue generale sommait
 * encore `calls.revenue` sur `booked_at`. Une regle qui vaut partout ne doit exister
 * qu'a un endroit — c'est la recopie qui les fait diverger.
 */
function dealsDeLaPeriode(
  deals: DealRecord[] | undefined,
  debut: Date,
  fin: Date,
  sinceConnection?: boolean,
): DealRecord[] {
  return (deals ?? []).filter(d => {
    if (d.status === 'canceled') return false;
    if (sinceConnection) return true;
    if (!d.signed_at) return false;
    const ds = new Date(d.signed_at);
    return ds >= debut && ds <= fin;
  });
}

/**
 * Regroupe une serie jour-par-jour avant affichage, selon la NATURE de la mesure.
 *
 * Existe pour l'All-Time. Un point par jour convient a une semaine ou a un mois ;
 * sur toute l'histoire d'un eleve, c'est 400 points la premiere annee — une nuee de
 * points illisible, et Recharts en souffre. Au-dela des seuils de
 * lib/chart-buckets.ts, on regroupe par semaine puis par mois.
 *
 * ⚠️ LA NATURE N'EST PAS UN DETAIL — c'est ce qui rend le regroupement juste ou
 * absurde. Trois cas, qu'aucun nom de serie ne permet de deviner :
 *
 *   - COMPTAGE (reach, vues, clics, abonnes GAGNES) → on SOMME.
 *   - NIVEAU (nombre d'abonnes, un stock) → on prend la DERNIERE valeur. Le sommer
 *     afficherait trente fois l'audience reelle sur un bucket mensuel.
 *   - MOYENNE (duree moyenne par vue) → on fait la moyenne des jours mesures. La
 *     sommer donnerait trente fois la duree.
 *
 * C'est la meme distinction que le tableau des trois natures
 * d'`analytics_daily_snapshots` dans AGENTS.md. Toute nouvelle serie doit declarer
 * la sienne : le defaut est « comptage », donc une serie de niveau oubliee ici
 * s'affiche multipliee par la taille du bucket, sans erreur ni avertissement.
 *
 * Renvoie aussi la granularite retenue, dont l'axe a besoin pour ses libelles :
 * « 24 aout » n'a plus de sens quand le point couvre une semaine entiere.
 */
/**
 * Le libelle de la fenetre reellement affichee.
 *
 * ⚠️ En All-Time, `period` vaut toujours 7 ou 30 — c'est la valeur du selecteur, pas
 * la fenetre. Ecrire « {period} derniers jours » y affiche donc « 30 derniers jours »
 * sous un graphique qui montre tout l'historique. Le libelle n'est pas approximatif,
 * il est FAUX, et il l'est d'autant plus silencieusement que le chiffre 30 a l'air
 * plausible.
 *
 * Cette regle existait deja en deux exemplaires (TabFunnel et TabRevenus), avec deux
 * formulations differentes. Elle est ici pour qu'il n'y en ait qu'une.
 */
function libelleFenetre(
  period: Period,
  periodIndex: number,
  sinceConnection?: boolean,
  allTimeStart?: string | null,
): string {
  if (!sinceConnection) return periodLabel(period, periodIndex);
  // « depuis la connexion » est le repli quand la date de mise en route est inconnue :
  // il reste vrai, il est juste moins precis.
  return allTimeStart
    ? `depuis le ${new Date(allTimeStart).toLocaleDateString('fr-FR')}`
    : 'depuis la connexion';
}

function regrouperSerieAffichee(
  data: { date: string; v: number | null }[],
  nature: NatureSerie = 'comptage',
): { data: { date: string; v: number | null; libelle: string }[]; pas: number } {
  const { points, pas } = regrouperParPas(data, nature);
  // ⚠️ Repartition volontaire entre l'axe et l'infobulle.
  //
  // L'AXE ne porte qu'UNE date — celle du debut du point. Y mettre la plage
  // (« 9 juin – 11 juin ») triplait la largeur de chaque graduation : les etiquettes
  // se chevauchaient et plus aucune date n'etait lisible.
  //
  // L'INFOBULLE porte la plage complete, la ou il y a la place de la lire. C'est elle
  // qui evite le seul vrai malentendu : un point qui vaut trois jours ne doit pas
  // laisser croire qu'il ne vaut que son premier jour.
  return { data: points, pas };
}
/**
 * Meme chose pour une modale qui superpose DEUX series (Shorts / videos longues).
 * Les deux sont regroupees avec la meme nature et la meme granularite : les
 * decouper differemment ferait comparer des points qui ne couvrent pas la meme
 * duree, ce qui ne se voit pas a l'ecran.
 */
function regrouperDeuxSeries(
  a: { date: string; v: number | null }[],
  b: { date: string; v: number | null }[],
  nature: NatureSerie,
): { data: { date: string; v: number | null; libelle: string }[]; data2: { date: string; v: number | null }[]; pas: number } {
  const p = regrouperSerieAffichee(a, nature);
  return { data: p.data, data2: regrouperSerieAffichee(b, nature).data, pas: p.pas };
}

// « Ce lien Calendly a-t-il été envoyé au prospect ? » — source unique pour toutes les
// cartes qui comptent des liens envoyés (voir docs/tracking-prospect.md).
//
// prospect_links.calendly_link_sent est posé par le webhook Instagram, mais SEULEMENT
// s'il reçoit l'echo Meta du DM contenant l'URL Short.io. Quand cet echo n'arrive pas
// (cas observé sur rdjdkzjd, 2026-08-18), le lien reste marqué non envoyé alors que le
// prospect l'a bel et bien reçu — il a clique dessus et booké un call.
//
// D'où la déduction : un clic prouve l'envoi. Personne ne peut cliquer un lien qu'il n'a
// jamais reçu. first_click_at (ou un call rattaché au lien) vaut donc preuve d'envoi,
// même sans marquage explicite. Sans cette règle, ces prospects sortent du dénominateur
// des taux d'activation et leurs calls tombent en « Autre / non catégorisé ».
//
// Ne JAMAIS remplacer par un simple `pl.calendly_link_sent` : le test doit rester
// identique partout, sinon deux cartes comptent des populations différentes — la classe
// de bug qui a produit les taux à 133 % et 150 %.
//
// linkClickedByLeadId (optionnel) : map ig_lead_id → date du clic, construite depuis
// prospect_events. À passer dès qu'elle est disponible, car les événements SURVIVENT à
// la suppression d'un lien (clé étrangère en SET NULL) alors que first_click_at part
// avec la ligne. Cas réel : le lien de rdjdkzjd a été supprimé puis régénéré, la
// nouvelle ligne est vierge, mais l'événement link_clicked du 8 juillet existe toujours.
const wasCalendlyLinkSent = (
  pl: { calendly_link_sent?: boolean | null; first_click_at?: string | null; ig_lead_id?: string | null },
  linkClickedByLeadId?: Map<string, string>,
) =>
  !!pl.calendly_link_sent
  || pl.first_click_at != null
  || (!!pl.ig_lead_id && !!linkClickedByLeadId?.has(pl.ig_lead_id));

// Date à laquelle le lien est considéré envoyé. calendly_link_sent_at quand le webhook
// l'a posé ; sinon la date du clic (le clic prouve que l'envoi lui est antérieur), via
// first_click_at ou l'événement survivant ; sinon created_at pour les liens anciens.
const calendlySentAt = (
  pl: { calendly_link_sent_at?: string | null; first_click_at?: string | null; created_at: string; ig_lead_id?: string | null },
  linkClickedByLeadId?: Map<string, string>,
) =>
  pl.calendly_link_sent_at
  ?? pl.first_click_at
  ?? (pl.ig_lead_id ? linkClickedByLeadId?.get(pl.ig_lead_id) : null)
  ?? pl.created_at;

/**
 * Rond « ? » en tete de colonne : explique une regle de comptage qui ne se devine pas
 * en lisant le chiffre.
 *
 * Survol ET clic, les deux : `title` ne s'affiche jamais sur un ecran tactile, et la
 * plateforme est d'abord consultee en PWA sur telephone. `stopPropagation` parce que
 * certains de ces en-tetes declenchent un tri au clic.
 */
function AideColonne({ texte }: { texte: string }) {
  const [ouvert, setOuvert] = useState(false);
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <button
        type="button"
        title={texte}
        aria-label={texte}
        aria-expanded={ouvert}
        onClick={(e) => { e.stopPropagation(); setOuvert(o => !o); }}
        onBlur={() => setOuvert(false)}
        style={{
          width: 13, height: 13, borderRadius: '50%', marginLeft: 4, padding: 0,
          border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)',
          fontSize: 9, fontWeight: 700, lineHeight: '11px', cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}
      >?</button>
      {ouvert && (
        <span
          role="tooltip"
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 30,
            width: 250, padding: '8px 10px', borderRadius: 8,
            border: '1px solid var(--border)', background: 'var(--surface)',
            boxShadow: '0 6px 20px rgba(0,0,0,.18)',
            fontSize: 11, fontWeight: 400, lineHeight: 1.45, color: 'var(--ink)',
            textAlign: 'left', whiteSpace: 'normal',
            maxHeight: '60vh', overflowY: 'auto',
          }}
        >
          {/* Un texte d'aide s'ecrit en paragraphes separes par une ligne vide. Sans ce
              decoupage, `whiteSpace: 'normal'` les collerait en un seul pave illisible —
              or c'est justement ce pave qui rendait l'aide du closing incomprehensible. */}
          {texte.split('\n\n').map((para, i) => (
            <span key={i} style={{ display: 'block', marginTop: i === 0 ? 0 : 8 }}>{para}</span>
          ))}
        </span>
      )}
    </span>
  );
}

// Les cinq regles de comptage de « Mes stats », definies UNE fois. Elles decrivent des
// grains, pas des emplacements : le meme texte doit apparaitre partout ou le meme
// nombre est compte de la meme facon, sinon les libelles se remettent a diverger.
const AIDE_CALLS_BOOKES =
  "Un deuxième rendez-vous qui prolonge la même vente ne compte pas deux fois. "
  + "« Mes stats » mesure ce que votre contenu produit, pas le nombre de créneaux tenus — "
  + "la page Calls, elle, les affiche tous. Si la même personne reprend rendez-vous plus "
  + "tard pour une nouvelle demande, elle compte à nouveau. C'est votre rapport de call "
  + "qui fait la différence : le second rendez-vous n'est écarté que si vous avez déclaré "
  + "qu'il suivrait.";

const AIDE_TOP_CONTENUS =
  "Comment un rendez-vous est rattaché à un contenu.\n\n"
  + "• Lien en description, en bio ou dans une story : c'est le contenu qui PORTE le "
  + "lien. Il n'en existe qu'un par publication, donc cliquer dessus prouve qu'on "
  + "regardait celle-là.\n\n"
  + "• Lien envoyé en DM : c'est le dernier lead magnet que la personne avait pris AVANT "
  + "de réserver. Pas le premier, et pas celui inscrit dans le lien.\n\n"
  + "Pourquoi cette exception : il n'existe qu'UN lien Calendly par personne. Il est "
  + "fabriqué une fois, avec le contenu du moment, et il ne change plus — alors que la "
  + "personne continue de prendre d'autres lead magnets. Quelqu'un qui reçoit son lien "
  + "en mai, prend un autre lead magnet en juillet et réserve en août aurait vu son "
  + "rendez-vous crédité au contenu de mai.\n\n"
  + "La date de la prise décide, pas celle du lien. Un lead magnet pris APRÈS la "
  + "réservation ne peut pas l'avoir déclenchée, il ne compte donc jamais.\n\n"
  + "Ce tableau compte des ÉVÉNEMENTS depuis toujours, pas des personnes sur une "
  + "période : un contenu peut y apparaître pour des gens entrés par ailleurs.";

// ⚠️ Cette colonne ne se compte PAS comme ses voisines, et c'est voulu. Le texte le dit
// explicitement plutot que de laisser croire a un tunnel : « liens envoyes » et « clics »
// forment une COHORTE (les liens partis pendant la periode, suivis sans limite de date),
// alors que calls bookes / honores / closes / revenue sont bucketes sur LEUR propre date
// — convention assumee et commentee au calcul du breakdown. Chris a tranche le 2026-09-03
// entre borner le clic et garder la cohorte : garder, et l'ecrire ici.
const AIDE_CLICS_LIENS =
  "Ces deux nombres suivent une COHORTE, pas la période.\n\n"
  + "« liens envoyés » : les liens Calendly partis pendant la période affichée.\n\n"
  + "Le nombre de clics : parmi CES liens-là, combien ont été cliqués au moins une fois — "
  + "à n'importe quelle date, même des mois plus tard.\n\n"
  + "La question posée est donc « parmi les liens que j'ai envoyés ce mois-là, combien "
  + "ont fini par être cliqués ». C'est ce qui mesure la qualité de l'envoi : un lien "
  + "part, il est cliqué ou il ne l'est jamais, et attendre trois semaines pour le savoir "
  + "n'y change rien.\n\n"
  + "⚠️ Conséquence à connaître : le nombre de clics d'un mois PASSÉ peut encore "
  + "augmenter. Un lien envoyé en juin et cliqué en octobre s'ajoutera aux clics de juin, "
  + "pas à ceux d'octobre. Ce n'est pas une erreur, c'est la contrepartie de la cohorte.\n\n"
  + "⚠️ Les colonnes calls bookés, honorés, closés et revenue de ce même tableau, elles, "
  + "sont comptées à LEUR propre date. Elles ne répondent donc pas à la même question, et "
  + "l'enchaînement clics → calls → closés n'est pas un tunnel : un lien envoyé avant la "
  + "période mais dont le call tombe dedans compte dans les calls sans compter dans les "
  + "clics.";

const AIDE_CALLS_HONORES =
  "Parmi les calls bookés, ceux qui ont eu lieu. Même règle : un deuxième rendez-vous qui "
  + "prolonge la même vente n'est pas recompté. Ce nombre ne peut donc jamais dépasser les "
  + "calls bookés.";

const AIDE_NO_SHOW =
  "Le seul compteur de Mes stats qui parle en RENDEZ-VOUS et non en opportunités. Son "
  + "dénominateur n'est donc pas le même que celui de « Calls bookés » — c'est pourquoi "
  + "il est écrit sur la carte elle-même, « 6 sur 11 rendez-vous », et pas seulement ici : "
  + "vous n'avez jamais à le deviner.\n\n"
  + "Un créneau posé puis non honoré est un créneau perdu, même s'il prolongeait une "
  + "vente déjà en cours. On mesure ici la fiabilité d'un créneau, pas ce que le contenu "
  + "a produit — d'où ce grain différent, assumé.";

const AIDE_CLOSING =
  "Vos ventes rapportées à vos calls honorés.\n\n"
  + "Le dénominateur compte des PERSONNES, pas des rendez-vous. Quelqu'un que vous voyez "
  + "deux fois pour la même vente compte pour UN seul call honoré, pas deux.\n\n"
  + "Exemple : vous voyez Paul le 12, il veut réfléchir, vous le revoyez le 19 et il "
  + "signe. Cela fait 1 call honoré et 1 vente, donc 100 %. Si les deux rendez-vous "
  + "comptaient, vous liriez 50 % — et bien mener une vente en deux temps ferait BAISSER "
  + "votre taux.\n\n"
  + "Deux rendez-vous ne sont regroupés que si vous l'avez déclaré : c'est votre réponse "
  + "« 2ème call » dans le rapport qui les relie. Un prospect qui revient de lui-même des "
  + "mois plus tard compte bien pour une nouvelle opportunité.\n\n"
  + "La vente est comptée dans la période du PREMIER rendez-vous, celui qui a créé "
  + "l'opportunité — pas dans celle où vous avez signé.";

const AIDE_CASH_COLLECTE =
  "Ce qui est réellement rentré en caisse sur les ventes signées pendant cette "
  + "période — encaissé moins remboursé, moins les litiges en cours.\n\n"
  + "Le pourcentage rapporte ces deux nombres : « 84 % de 10 200 € contractés » veut "
  + "dire que sur les 10 200 € vendus, 8 600 € sont arrivés. Un paiement en 3 fois "
  + "n'affiche donc pas 100 % dès la signature.\n\n"
  + "Le collecté et le contracté portent sur les MÊMES ventes, celles signées dans "
  + "la période — et on compte leurs versements même s'ils tombent plus tard. C'est "
  + "ce qui garantit que le taux ne dépasse jamais 100 %.\n\n"
  + "Conséquence normale : une période passée peut voir son taux MONTER avec le "
  + "temps, à mesure que les échéances de ses ventes sont prélevées. La question "
  + "posée est « sur ce que j'ai vendu ce mois-là, combien est rentré à ce jour ».";

const AIDE_CASH_CONTRACTE =
  "Le montant des ventes signées grâce à ce contenu — ce qui a été VENDU, pas ce "
  + "qui est déjà rentré en caisse.\n\n"
  + "Une vente est créditée au contenu qui a amené le rendez-vous d'où elle est "
  + "sortie. Un upsell vendu six mois plus tard à ce même client ne vient donc pas "
  + "gonfler la performance de la publication.";

const AIDE_ECART_DEDUP = (abo: number, non: number, total: number) =>
  `Les deux parts (${abo} + ${non} = ${abo + non}) dépassent de ${abo + non - total} le reach `
  + `total de ${total}. Ce n'est pas une erreur.\n\n`
  + "Une personne qui vous découvre SANS vous suivre, puis s'abonne et revoit un "
  + "contenu ensuite, est comptée une fois dans chaque part — mais une seule fois "
  + "dans le total, qui ne compte que des personnes distinctes.\n\n"
  + "L'écart grandit donc avec la durée de la période, et il est nul sur une semaine. "
  + "C'est le signe que vous convertissez des visiteurs en abonnés.\n\n"
  + "Les pourcentages se rapportent aux parts, pour qu'ils fassent exactement 100 %. "
  + "Le reach total, lui, reste le nombre réel de personnes touchées.";

const AIDE_REACH_STORY =
  "Le nombre de PERSONNES qui ont vu cette story, chacune comptée une seule fois "
  + "même si elle l'a rouverte.\n\n"
  + "À ne pas confondre avec les « vues » du détail plus bas : une même personne qui "
  + "regarde deux fois fait 1 de reach et 2 de vues. C'est le reach qui sert ici, "
  + "parce que la question posée est « combien de personnes sont restées jusqu'au "
  + "bout », et qu'une personne qui revient ne prolonge pas une audience.";

const AIDE_REV_PAR_CALL =
  "Le revenu de la période divisé par les calls bookés. Un deuxième rendez-vous qui "
  + "prolonge la même vente n'entre pas au dénominateur, comme dans la colonne « Calls "
  + "bookés ». Un deal signé lors d'un second rendez-vous reste au numérateur : il compte "
  + "là où il a été signé.";

// Format axe X : "13 févr." — pas d'année, espacé uniformément
const fmtAxisDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }).replace('.', '');
};

// Format axe X avec jour de semaine : "lun. 7" — réservé aux vues 7 jours (semaine
// calendaire), où il n'y a que 7 points à afficher donc la place ne manque pas.
// Sur les vues mois (jusqu'à 31 points), ce format ferait chevaucher les ticks.
const fmtAxisDateWithDay = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });
};

const ACCENT = 'var(--accent)';
const GREEN = '#3f8a52';
const AMBER = '#b58025';
const RED = '#cd5b3f';
const BLUE = '#6b7cde';
const PIE_COLORS = [ACCENT, GREEN, AMBER, RED, BLUE, '#a78bfa', '#f59e0b', '#10b981'];

// ─── Sub-components ───────────────────────────────────────────────────────────

function Card({ title, sub, children, style }: { title?: React.ReactNode; sub?: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="card" style={style}>
      {title && (
        <div className="card-head">
          <div>
            <div className="card-title">{title}</div>
            {sub && <div className="card-sub">{sub}</div>}
          </div>
        </div>
      )}
      {children}
    </div>
  );
}

function Tabs({ tabs, active, onChange }: { tabs: string[]; active: number; onChange: (i: number) => void }) {
  const [hovered, setHovered] = useState<number | null>(null);
  return (
    <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 28 }}>
      {tabs.map((t, i) => (
        <button
          key={i}
          onClick={() => onChange(i)}
          onMouseEnter={() => setHovered(i)}
          onMouseLeave={() => setHovered(null)}
          style={{
            padding: '10px 16px', fontSize: 13, fontWeight: active === i ? 600 : 400,
            color: active === i || hovered === i ? 'var(--ink)' : 'var(--muted)',
            background: 'none', border: 'none', cursor: 'pointer',
            borderBottom: active === i ? '2px solid var(--accent-brand)' : '2px solid transparent',
            marginBottom: -1,
            transition: `color var(--dur-quick) var(--ease-out), border-color var(--dur-quick) var(--ease-out)`,
          }}>{t}</button>
      ))}
    </div>
  );
}

function Loading() { return <InlineLoader />; }

function MiniLoadingDots() {
  return (
    <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center', height: 18 }}>
      {[0, 1, 2].map(i => (
        <span
          key={i}
          style={{
            width: 5, height: 5, borderRadius: '50%',
            background: 'var(--muted)',
            animation: `mini-dot-pulse 1s ease-in-out ${i * 0.15}s infinite`,
          }}
        />
      ))}
      <style>{`@keyframes mini-dot-pulse { 0%, 80%, 100% { opacity: .25; } 40% { opacity: 1; } }`}</style>
    </span>
  );
}

function Empty({ msg = 'Aucune donnée disponible' }: { msg?: string }) {
  return <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--faint)', fontSize: 13 }}>{msg}</div>;
}

/**
 * Nom lisible d'une source de trafic YouTube.
 *
 * Les codes de l'API etaient affiches tels quels, juste passes en minuscules :
 * « Search », « Ext Url », « No Link_other », « End Screen ». Le `.replace('_', ' ')`
 * ne remplacait que le PREMIER underscore, d'ou le « No Link_other » a l'ecran, et
 * rien n'etait traduit alors que la plateforme est en francais.
 *
 * Les 7 valeurs vues en base sont couvertes ; les autres codes documentes par
 * l'API le sont aussi, pour ne pas ressortir de l'anglais brut chez un autre
 * utilisateur. Un code inconnu est nettoye correctement plutot qu'affiche brut.
 */
const NOMS_SOURCES_TRAFIC: Record<string, string> = {
  YT_SEARCH:        'Recherche YouTube',
  YT_CHANNEL:       'Page de la chaîne',
  YT_OTHER_PAGE:    'Autre page YouTube',
  RELATED_VIDEO:    'Vidéos suggérées',
  SUBSCRIBER:       'Abonnés (fil d’accueil)',
  END_SCREEN:       'Écran de fin',
  ANNOTATION:       'Carte ou annotation',
  PLAYLIST:         'Playlist',
  EXT_URL:          'Site externe',
  NOTIFICATION:     'Notification',
  SHORTS:           'Fil Shorts',
  ADVERTISING:      'Publicité',
  CAMPAIGN_CARD:    'Carte de campagne',
  HASHTAGS:         'Hashtags',
  SOUND_PAGE:       'Page du son',
  VIDEO_REMIXES:    'Remix de la vidéo',
  LIVE_REDIRECT:    'Redirection live',
  PRODUCT_PAGE:     'Page produit',
  NO_LINK_OTHER:    'Source inconnue',
  NO_LINK_EMBEDDED: 'Lecteur intégré',
};

function nomSourceTrafic(code: string): string {
  const connu = NOMS_SOURCES_TRAFIC[code];
  if (connu) return connu;
  // Repli : tous les underscores (pas seulement le premier), premiere lettre en
  // majuscule. Mieux qu'un code brut si YouTube ajoute une source.
  const nettoye = code.replace(/^YT_/, '').replace(/_/g, ' ').toLowerCase();
  return nettoye.charAt(0).toUpperCase() + nettoye.slice(1);
}

/** Nom lisible d'un type d'appareil. Meme motif que les sources de trafic. */
const NOMS_APPAREILS: Record<string, string> = {
  MOBILE: 'Mobile',
  DESKTOP: 'Ordinateur',
  TABLET: 'Tablette',
  TV: 'Télévision',
  GAME_CONSOLE: 'Console de jeu',
  UNKNOWN_PLATFORM: 'Appareil inconnu',
};

function nomAppareil(code: string): string {
  const connu = NOMS_APPAREILS[code];
  if (connu) return connu;
  const nettoye = code.replace(/_/g, ' ').toLowerCase();
  return nettoye.charAt(0).toUpperCase() + nettoye.slice(1);
}

/**
 * Espacement des dates sur l'axe horizontal d'un graphique journalier.
 *
 * `preserveStartEnd` de Recharts n'espace RIEN : il garde toutes les graduations qui
 * tiennent, d'ou un axe qui affichait « 1 juil, 2 juil, 3 juil... » sur trente jours
 * pendant que le graphique voisin en montrait neuf. Deux graphiques cote a cote, deux
 * densites differentes (constate par Chris a l'ecran le 2026-08-21).
 *
 * Tous les jours en vue semaine ; en vue mois, autant de dates que la LARGEUR le
 * permet, sans jamais les faire se toucher.
 *
 * `largeurPx` optionnel : quand l'appelant connait la largeur reelle du graphique
 * (via ResponsiveContainer), on calcule combien de dates y tiennent au lieu de figer
 * un nombre.
 *
 * 80 px par date alors qu'une date (« 13 août ») en occupe environ 50 : la marge est
 * VOLONTAIRE. « Mieux vaut pas assez de dates que trop et mal equilibre » (Chris) —
 * un axe trop dense se lit mal, un axe aere reste lisible. On sous-estime donc
 * toujours ce qui tient.
 *
 * Sans largeur fournie, repli sur ~12 labels : la valeur qui convient aux graphiques
 * pleine largeur de cette page. C'etait 9 auparavant, ce qui laissait de grands vides
 * (demande de Chris, 2026-08-21).
 *
 * Meme regle que le composant partage components/charts/AreaChart.tsx, posee ici une
 * seule fois : elle etait recopiee dans treize graphiques, dont huit avaient derive.
 */
const LARGEUR_LABEL_DATE_PX = 80;

/**
 * Mesure la largeur d'un conteneur et la suit au redimensionnement.
 *
 * Sert a decider combien de dates tiennent sur l'axe d'un graphique : sur un ecran
 * large il y a la place d'en afficher plus que sur un mobile, et figer un nombre
 * revient a choisir le pire des deux cas.
 *
 * Renvoie 0 avant la premiere mesure — graduationsDates retombe alors sur son repli,
 * donc l'axe est correct des le premier rendu, pas seulement apres mesure.
 */
function useLargeur<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [largeur, setLargeur] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect?.width ?? 0;
      // Arrondi au pas de 20 px : evite de recalculer l'axe a chaque pixel pendant
      // un redimensionnement, donc pas de scintillement des dates.
      setLargeur(prev => (Math.abs(w - prev) > 20 ? w : prev));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, largeur];
}

function graduationsDates(nbPoints: number, periode: number, largeurPx?: number): number | 'preserveStartEnd' {
  if (periode === 7) return 0;
  const maxLabels = largeurPx && largeurPx > 0
    ? Math.max(2, Math.floor(largeurPx / LARGEUR_LABEL_DATE_PX))
    : 12;
  if (nbPoints <= maxLabels) return 0;
  return Math.max(1, Math.ceil(nbPoints / maxLabels) - 1);
}

/**
 * Graduations EXPLICITES d'un axe de dates : premiere et derniere toujours incluses,
 * le reste reparti uniformement entre les deux.
 *
 * Pourquoi pas un simple `interval` : Recharts place alors ses graduations tous les
 * N points a partir du premier, et la derniere ne tombe juste que si (nbPoints - 1)
 * est un multiple de N. Quand ce nombre est premier — 29 jours, 52, 83 — aucun pas
 * ne fonctionne. `preserveStartEnd` force bien la derniere mais en L'AJOUTANT aux
 * graduations regulieres, d'ou le « 29 juil, grand vide, 31 juil » signale par Chris.
 *
 * En fournissant la liste, on garantit les deux extremites ET un espacement regulier
 * (au plus un jour d'ecart entre deux intervalles), quelle que soit la longueur de la
 * periode. Demande de Chris : « globalement tout le temps la premiere et derniere ».
 */
function datesAxe(dates: string[], periode: number, largeurPx?: number): string[] | undefined {
  const n = dates.length;
  // undefined = on laisse Recharts decider (vue semaine : toutes les dates tiennent).
  if (periode === 7 || n <= 2) return undefined;
  const maxLabels = largeurPx && largeurPx > 0
    ? Math.max(2, Math.floor(largeurPx / LARGEUR_LABEL_DATE_PX))
    : 12;
  if (n <= maxLabels) return undefined;
  return Array.from({ length: maxLabels }, (_, i) => dates[Math.round((i * (n - 1)) / (maxLabels - 1))]);
}

/**
 * Formate une VARIATION sur une periode : « +12 », « -1 », « 0 ».
 *
 * Likes, commentaires et partages sont des soldes, pas des compteurs : YouTube
 * renvoie le mouvement du jour, et un like retire vaut -1. Sans signe, la carte
 * affichait « LIKES : -1 », qui se lit comme un bug alors que la valeur est juste.
 *
 * Le zero ne prend pas de signe : « +0 » annoncerait un gain nul comme un gain.
 */
function signeVariation(v: number): string {
  if (!Number.isFinite(v)) return '—';
  return v > 0 ? `+${fmt(v)}` : fmt(v);
}

/**
 * Une story publiee il y a moins de 24 h a des chiffres encore en cours de
 * consolidation cote Meta : les vues montent avant le reach (constate en direct
 * le 2026-08-22 — API a `views: 5, reach: 0` dix minutes apres publication), et
 * le detail de navigation n'est pas servi du tout au debut.
 *
 * Sert a afficher une mention sous la grille, pour que ces zeros ne se lisent pas
 * comme une story qui n'a interesse personne.
 */
function estStoryRecente(postedAt: string | null | undefined): boolean {
  if (!postedAt) return false;
  const t = new Date(postedAt).getTime();
  if (!Number.isFinite(t)) return false;
  return Date.now() - t < 24 * 60 * 60 * 1000;
}

/**
 * Reserve la hauteur d'un graphique quel que soit son etat.
 *
 * Un bloc qui affiche tour a tour un loader (~40 px), un message vide (~77 px)
 * puis un graphique (160 px) fait grandir la page sous les yeux : le contenu
 * dessous saute, et sur une modale on voit la fenetre s'agrandir apres
 * l'ouverture. Le lecteur perd le fil de ce qu'il regardait.
 *
 * La hauteur est donc celle du graphique dans les trois cas, le loader et le
 * message vide etant centres dedans. Regle posee ici une seule fois : l'ecrire
 * dans chaque bloc garantissait qu'un nouveau bloc l'oublie (demande de Chris,
 * 2026-08-21 — « quelle que soit la donnee, c'est la meme taille »).
 */
function ZoneGraphique({ height, children }: { height: number; children: React.ReactNode }) {
  // minHeight plutot que height : un graphique en hauteur fixe a l'interieur reste
  // exactement a sa taille, mais un message ou un loader plus haut que prevu ne se
  // retrouve pas rogne.
  //
  // minWidth: 0 sur l'enfant flex — sans lui, un ResponsiveContainer imbrique peut
  // mesurer une largeur negative au premier rendu, ce que Recharts signale par
  // « width(-1) and height(-1) » dans la console.
  //
  // Pas de centrage horizontal ici : Empty porte son propre textAlign, et InlineLoader
  // son propre justifyContent. L'enfant occupe toute la largeur, ce dont un graphique
  // a besoin.
  return (
    <div style={{ minHeight: height, width: '100%', minWidth: 0, display: 'flex', alignItems: 'center' }}>
      <div style={{ width: '100%', minWidth: 0 }}>{children}</div>
    </div>
  );
}

// ─── TAB 1 : Vue Générale — helpers ──────────────────────────────────────────

// Carte affichant une stat AVEC sa formule de calcul en dessous
// (ex: label "Closing", value "33 %", formula "deals closés / calls honorés").
// CONSERVÉ VOLONTAIREMENT bien que non branché aujourd'hui : afficher d'où vient
// chaque chiffre directement dans l'interface est une amélioration prévue (rendre
// les stats auditables sans lire le code). Ne pas supprimer lors d'un passage de
// nettoyage du code mort — décision Chris, 2026-08-18.
function LeverCard({ label, value, formula }: { label: string; value: string; formula: string }) {
  return (
    <div style={{ padding: '16px 18px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
      <div className="eyebrow-sm" style={{ color: 'var(--muted)', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--ink)', lineHeight: 1, marginBottom: 4 }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--faint)', fontFamily: 'monospace' }}>{formula}</div>
    </div>
  );
}

type SignalType = 'green' | 'amber' | 'red';
function Signal({ type, text, isLast }: { type: SignalType; text: string; isLast?: boolean }) {
  const dot = type === 'green' ? GREEN : type === 'amber' ? AMBER : RED;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 0', borderBottom: isLast ? 'none' : '1px solid var(--border-soft)' }}>
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: dot, marginTop: 3, flexShrink: 0 }} />
      <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.4 }}>{text}</div>
    </div>
  );
}


// ─── Domaine d'axe pour les abonnes nets ──────────────────────────────────────

/**
 * Axe centre sur zero, pour une valeur qui peut etre negative (abonnes gagnes
 * moins abonnes perdus).
 *
 * Regle : le zero reste au milieu, et l'amplitude s'adapte aux donnees. Quand
 * rien ne bouge — le cas normal sur une chaine stable — on montre -1 et +1 de
 * part et d'autre, ce qui donne une ligne plate centree plutot qu'une ligne
 * collee en bas. Des qu'une variation apparait, l'axe s'ouvre a la plus grande
 * amplitude observee, plus une marge.
 *
 * C'est le pendant du graphique des abonnes (total), ou 49 constant s'affiche
 * centre avec 48 et 50 autour. Ici la valeur de reference est zero au lieu du
 * total, mais le comportement voulu est le meme.
 *
 * Symetrique volontairement : perdre 3 abonnes doit se lire aussi bas qu'en
 * gagner 3 se lit haut. Un axe ajuste separement en haut et en bas ferait
 * paraitre une petite perte aussi grave qu'un gros gain.
 */
/** Borne haute de l'axe : l'amplitude observee, plus un cran de respiration. */
function borneAbonnesNets(valeurs: (number | null)[]): number {
  const amplitude = valeurs.reduce<number>(
    (max, v) => (v == null ? max : Math.max(max, Math.abs(v))),
    0,
  );
  // Rien n'a bouge sur la periode : -1 / 0 / +1, la ligne plate se lit au milieu.
  if (amplitude === 0) return 1;
  // Un cran de marge seulement. Une marge proportionnelle (20 %) gonflait l'axe a
  // -24/+24 pour une pointe a 20 abonnes, ecrasant la courbe sur une bande etroite.
  return amplitude + 1;
}

const domaineAbonnesNets = (borne: number): [number, number] => [-borne, borne];

/**
 * Graduations explicites, sans quoi Recharts ignore le domaine.
 *
 * Le `domain` seul ne suffit pas : Recharts recalcule ses propres bornes « jolies »
 * par-dessus, et avec toutes les valeurs a zero il graduait « 0, 1 » en collant la
 * ligne en bas — exactement ce que le domaine symetrique devait empecher
 * (constate le 2026-08-21). Lui passer `ticks` fige l'echelle.
 *
 * Au plus 7 graduations, toujours en nombre impair pour que zero tombe pile au
 * milieu, et jamais de decimale (on compte des abonnes).
 */
function graduationsAbonnesNets(borne: number): number[] {
  // Construit depuis ZERO vers l'exterieur, et non depuis -borne : en partant du bas,
  // le pas ne retombait pas sur zero (borne 101 graduait ...-2, 31... sans le zero),
  // alors que c'est le repere central de ce graphique.
  const pas = Math.max(1, Math.floor(borne / 3));
  const ticks = [0];
  for (let v = pas; v <= borne; v += pas) ticks.unshift(-v), ticks.push(v);
  // La borne exacte ferme l'axe meme quand le pas ne tombe pas juste dessus.
  if (ticks[ticks.length - 1] !== borne) ticks.unshift(-borne), ticks.push(borne);
  return ticks;
}

// ─── Custom Tooltip ───────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label, fmtFn, pendingKey }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      {/* Voir CustomTooltip dans components/charts/AreaChart.tsx : la plage du point
          quand il regroupe plusieurs jours, la date d'axe sinon. */}
      <div className="chart-tooltip-label">{payload[0]?.payload?.libelle ?? label}</div>
      {payload.map((p: any, i: number) => {
        const isPending = pendingKey && p.payload?.[pendingKey];
        return (
          <div key={i} className="chart-tooltip-row">
            <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color, display: 'inline-block', marginRight: 6 }} />
            <span>{p.name}: </span>
            {isPending
              ? <strong style={{ color: 'var(--faint)', fontWeight: 500 }}>Pas encore de données</strong>
              : <strong>{fmtFn ? fmtFn(p.value) : fmt(p.value)}</strong>}
          </div>
        );
      })}
    </div>
  );
}

// ─── TAB 1 : Vue Générale ─────────────────────────────────────────────────────

type ContentSortKey = 'views' | 'watchTime' | 'calls' | 'revenue';

// ─── TAB "Vue générale (B)" — version épurée ─────────────────────────────────

function TabOverviewV2({ ig, yt, msgs, calls, callsAllTime, shortio, period, periodIndex, leadIdToMediaId, prospectLinksData, linkClickedByLeadId, clicksByUrl, calendlyStaticClicsFromDb, igLive, ytLive, sinceConnection, leads, lmHistory, integrationsReadyAt, allTimeStart, deals, cashParVente, stories }: { ig: IGStats | null; yt: YTStats | null; msgs: IGMessages | null; calls: CallRecord[]; callsAllTime?: CallRecord[]; shortio: ShortioStats | null; period: Period; periodIndex?: number; leadIdToMediaId: Map<string, string>; prospectLinksData?: any[]; linkClickedByLeadId?: Map<string, string>; clicksByUrl?: Map<string, number>; calendlyStaticClicsFromDb?: number; igLive?: IGStats | null; ytLive?: YTStats | null; sinceConnection?: boolean; leads?: MockLead[]; lmHistory?: { ig_user_id: string; keyword_matched: string; media_id: string | null; lead_magnet_sent: boolean; detected_at: string }[]; integrationsReadyAt?: string | null; allTimeStart?: string | null; deals?: DealRecord[]; cashParVente?: VenteCash[]; stories?: any[] }) {
  // Etiquette de fenetre. En All-Time les cartes affichaient « 30j » alors que le
  // bandeau annonce « All-Time » — meme defaut que celui corrige dans les onglets
  // Instagram et YouTube (2026-08-22).
  const ovEtiquettePeriode = sinceConnection ? 'total' : `${period}j`;
  const [contentSort, setContentSort] = useState<ContentSortKey>('views');
  const [showAllContent, setShowAllContent] = useState(false);
  const _ovPIdx = periodIndex ?? 0;
  const now = new Date();
  // Bornes calendaires réelles (semaine lundi-dimanche / mois calendaire) via
  // lib/period.ts — remplace l'ancien calcul en heure locale du navigateur (pas UTC
  // strict), source potentielle de décalage d'un jour vs les autres composants.
  const { periodStart: ovSelStart, periodEnd: ovSelEnd } = getPeriodWindow(_ovPIdx, period === 7 ? 'week' : 'month');
  // « Depuis la connexion » n'est PAS une periode du selecteur : sa fenetre va de la mise
  // en route a aujourd'hui. Sans cette branche, les bornes restaient celles du selecteur
  // et les deux courbes tracaient le mois (ou la semaine) en cours sous l'etiquette
  // « total » : 503 personnes annoncees par la carte, 146 dans la courbe (2026-08-31).
  // Pire depuis le mode 7j, ou c'est la CARTE qui devenait fausse (voir igReach plus bas).
  // Meme branche que `igDaysSlice` dans TabInstagram, qui ne l'avait pas oubliee.
  //
  // Les bornes sont calees sur la JOURNEE, jamais sur l'heure. `inOvWindow` situe chaque
  // point a midi UTC ; une borne prise a l'heure exacte de `integrations_ready_at`
  // excluait le premier jour de la courbe alors que le total de la carte le compte —
  // la somme cessait d'egaler le total, c'est-a-dire le defaut meme qu'on corrige ici.
  // Mesure au 2026-08-31 : trois eleves sur quatre ont une heure de demarrage posterieure
  // a midi UTC (17h36, 12h56, 19h05). Seul le profil de test passait, a 08h13. Meme
  // fenetre en DATES que le `customWindow` de fetchSnapshot, qui sert ces donnees.
  //
  // `allTimeStart` et non `integrationsReadyAt` : c'est lui qui porte le repli sur
  // `connectedAt`, et un eleve sans `integrations_ready_at` existe en base. Sans ce repli,
  // il retombait sur la fenetre du selecteur, c'est-a-dire sur le defaut d'origine.
  const ovDebutAllTime = allTimeStart ?? integrationsReadyAt;
  const ovPeriodStart = sinceConnection && ovDebutAllTime
    ? new Date(parisDateStr(new Date(ovDebutAllTime)) + 'T00:00:00Z')
    : ovSelStart;
  const ovPeriodEnd = sinceConnection
    ? new Date(parisDateStr(new Date()) + 'T23:59:59.999Z')
    : ovSelEnd;
  const cutoff = ovPeriodStart;

  // Leads sur la période — remplace l'ancienne carte "Clics lien".
  //
  // RÈGLE UNIQUE pour le gros chiffre, dans TOUS les modes (semaine/mois/depuis
  // connexion) : nombre de PERSONNES DISTINCTES ayant donné signe de vie dans la
  // fenêtre (via lmHistory, dédupliqué par ig_user_id). Un même prospect actif
  // plusieurs fois DANS LA MÊME fenêtre ne compte qu'une fois — mais un prospect
  // inactif depuis longtemps qui redevient actif compte bien +1 dans la fenêtre où
  // ça se passe (garde le signal business de réactivation). Conséquence assumée :
  // la somme des fenêtres courtes (ex: 4 semaines) peut dépasser le total "depuis
  // connexion" si une même personne est active sur plusieurs d'entre elles — chaque
  // fenêtre est une vraie photo indépendante de l'activité, pas un sous-total d'un
  // grand tout.
  //
  // Le badge, lui, change de RÔLE selon le mode (pas juste de fenêtre) :
  // - Mode période : "+N nouveaux" = parmi les actifs de CETTE fenêtre, combien
  //   n'avaient jamais donné signe de vie avant (signal "je génère du neuf cette
  //   semaine/ce mois", complémentaire du gros chiffre qui inclut aussi les
  //   réactivations).
  // - Mode "Depuis connexion" : le gros chiffre est déjà le total de leads uniques
  //   depuis toujours, donc "nouveaux depuis toujours" y serait quasi identique au
  //   gros chiffre (inutile). Le badge répond ici à une question différente et plus
  //   utile : "est-ce que je génère encore du neuf, là maintenant ?" — d'où "+N
  //   nouveaux ce mois" calculé en nouveaux STRICTS (jamais vus nulle part avant),
  //   PAS en actifs du mois (sinon il se rapprocherait du gros chiffre dès que la
  //   plupart des leads interagissent régulièrement, perdant tout pouvoir
  //   informatif).
  // "Depuis connexion" pour les leads = depuis integrations_ready_at (référence stable,
  // toutes intégrations obligatoires connectées pour la 1ère fois), pas depuis la
  // connexion d'une intégration spécifique — un lead détecté sur Instagram avant que
  // Calendly soit connecté reste un vrai lead, il ne doit pas dépendre de quelle
  // intégration a été branchée en dernier. Fallback sur "tout accepter" si
  // integrations_ready_at n'est pas encore disponible (élève pas encore débloqué).
  const isLeadInPeriod = (ts: string | null | undefined) => {
    if (sinceConnection) {
      if (!ts) return false;
      return integrationsReadyAt ? ts >= integrationsReadyAt : true;
    }
    if (!ts) return false;
    const t = new Date(ts).getTime();
    return t >= ovPeriodStart.getTime() && (_ovPIdx === 0 || t <= ovPeriodEnd.getTime());
  };
  const { periodStart: currentMonthStart, periodEnd: currentMonthEnd } = getPeriodWindow(0, 'month');
  const isNewThisMonth = (ts: string | null | undefined) => {
    if (!ts) return false;
    const t = new Date(ts).getTime();
    return t >= currentMonthStart.getTime() && t <= currentMonthEnd.getTime();
  };
  // Calls directs (clic sur un lien Calendly en bio/description IG, sans jamais avoir
  // commenté) — n'apparaissent jamais dans lmHistory puisqu'aucun mot-clé/lead magnet
  // n'a été déclenché. Même 3e source que le Pipeline (docs/pipeline-leads-ig-sources.md)
  // et fetchIgLeadsCount (lib/salesCallStats.ts) — sans eux, "Mes stats" sous-comptait de
  // vrais prospects (dont certains déjà closés) par rapport au Pipeline.
  const directIgCallsInPeriod = (callsAllTime ?? []).filter(c => {
    if (c.ig_lead_id) return false;
    if (c.lead_deleted) return false;
    if (c.ignored) return false;
    const src = c.source?.toLowerCase() ?? '';
    // Préfixe plutôt qu'une liste fermée : `ig_story` manquait, donc un rendez-vous
    // venu d'une story n'était compté ni ici ni dans le pipeline (même défaut corrigé
    // dans PagePipeline.tsx le 2026-08-19). Doit rester aligné avec la requête
    // équivalente de lib/salesCallStats.ts.
    if (!src.startsWith('ig_')) return false;
    return isLeadInPeriod(c.booked_at || c.scheduled_at);
  });
  // Calls YouTube bookés (source commençant par "yt") — même formule que
  // useCoachData.ts (écran accueil) et PageClientDetail.tsx (fiche coach), pour un
  // total "Leads" identique quel que soit l'écran. Sans eux, cette carte sous-comptait
  // par rapport à l'accueil (7 au lieu de 9).
  const ytBookedCallsInPeriod = (callsAllTime ?? []).filter(c => {
    if (c.ignored) return false;
    // Les annulés sont GARDÉS : un prospect qui annule reste un prospect. Ce qu'une
    // annulation retire, c'est un call booké — pas un lead ; ce filtre-là vit dans
    // computeSalesCallStats. Le volet Instagram juste au-dessus les gardait déjà,
    // ce filtre créait donc deux règles selon la plateforme (aligné le 2026-08-19,
    // même correction dans fetchAllLeadsCount).
    const src = c.source?.toLowerCase() ?? '';
    if (!src.startsWith('yt')) return false;
    return isLeadInPeriod(c.booked_at || c.scheduled_at);
  });
  // Un prospect = UNE personne, jamais un call. Sans dédoublonnage, quelqu'un qui
  // reprogramme son rendez-vous compte double : Calendly crée un nouvel événement à
  // chaque report, donc deux lignes dans `calls` pour la même personne. C'est ce qui
  // faisait afficher 18 leads ici contre 17 dans le pipeline, lequel regroupe bien par
  // prospect (constaté le 2026-08-19 sur « Test JSP 2 », reporté du 18 au 19 août).
  //
  // Clé de regroupement : l'email de l'invité, avec repli sur son nom — même critère
  // que le pipeline quand il n'a ni prospect_id ni chaîne de reprogrammation.
  const prospectKeyOf = (c: CallRecord) =>
    ((c as any).invitee_email || (c as any).invitee_name || (c as any).id || '').toLowerCase();
  const directIgProspects = new Set(directIgCallsInPeriod.map(prospectKeyOf));
  const ytBookedProspects = new Set(ytBookedCallsInPeriod.map(prospectKeyOf));
  const leadsCount = new Set(
    (lmHistory ?? []).filter(h => isLeadInPeriod(h.detected_at)).map(h => h.ig_user_id)
  ).size + directIgProspects.size + ytBookedProspects.size;
  // Les calls directs comptent aussi comme "nouveaux" dans le badge : par construction
  // (ig_lead_id null), ils n'ont jamais été vus ailleurs avant ce call. Idem pour les
  // calls YouTube bookés — pas de notion de "lead" préalable pour cette source.
  const directIgCallsNew = sinceConnection
    ? directIgCallsInPeriod.filter(c => isNewThisMonth(c.booked_at || c.scheduled_at))
    : directIgCallsInPeriod;
  const ytBookedCallsNew = sinceConnection
    ? ytBookedCallsInPeriod.filter(c => isNewThisMonth(c.booked_at || c.scheduled_at))
    : ytBookedCallsInPeriod;
  // Même dédoublonnage par personne que pour leadsCount ci-dessus : un report de
  // rendez-vous ne crée pas un second prospect.
  const newLeadsCount = (sinceConnection
    ? (leads ?? []).filter(l => isNewThisMonth(l.commentedAt)).length
    : (leads ?? []).filter(l => isLeadInPeriod(l.commentedAt)).length
  ) + new Set(directIgCallsNew.map(prospectKeyOf)).size
    + new Set(ytBookedCallsNew.map(prospectKeyOf)).size;
  const newLeadsBadgeLabel = sinceConnection ? 'ce mois' : 'nouveaux';
  const newLeadsBadgeTitle = sinceConnection
    ? 'Prospects jamais vus avant, détectés ce mois-ci (différent des leads actifs ce mois, qui incluraient aussi les anciens prospects réactivés)'
    : 'Prospects jamais vus avant cette période';

  // ── Métriques business ─────────────────────────────────────────────────────
  // callsEff est déjà filtré par la DB en S-1+ → on filtre juste par status ici.
  // En mode "depuis connexion", calls est déjà borné [connectedAt, aujourd'hui] par le
  // fetch — ne pas re-filtrer avec la fenêtre calendaire du mois en cours (cutoff).
  const callsInPeriod = sinceConnection ? calls : calls.filter(c => {
    const t = new Date(callPeriodDate(c)).getTime();
    return t >= cutoff.getTime() && (_ovPIdx === 0 || t <= ovPeriodEnd.getTime());
  });
  // Continuations : un 2e rendez-vous qui PROLONGE la meme vente ne recompte pas.
  // Apparie sur `callsAllTime` quand il est la (jeu complet, jamais coupe par la
  // periode) : une paire a cheval sur deux fenetres serait invisible depuis la fenetre,
  // et le 2e call recompterait comme une opportunite neuve. Meme raison qu'en
  // TabFunnel et dans Business micro.
  const continuationsOv = idsDeContinuation(callsAllTime ?? calls);
  const estOpportunite = (c: CallRecord) => !continuationsOv.has(c.id);

  // « Calls bookes » et « Calls honores » comptent des OPPORTUNITES : Mes stats mesure
  // ce que le contenu produit, pas le nombre de creneaux tenus.
  const callsBookes  = callsInPeriod.filter(c => c.status === 'active' && estOpportunite(c)).length;
  const callsHonores = callsInPeriod.filter(c => isCallHonored(c, now) && estOpportunite(c)).length;

  // Le NO-SHOW garde l'autre grain, deliberement. Il mesure la fiabilite d'un CRENEAU,
  // pas la capacite a closer une personne : un 2e rendez-vous pose et non honore est un
  // creneau perdu, quelle que soit sa place dans le parcours. C'est aussi la pratique du
  // secteur — le show rate se calcule sur les creneaux poses, jamais sur les
  // opportunites. Son denominateur est donc ECRIT a l'ecran (« N sur M rendez-vous »),
  // pour qu'aucun lecteur ne tente de le retrouver a partir de « Calls bookes ».
  const rendezVous   = callsInPeriod.filter(c => c.status === 'active').length;
  const noShows      = callsInPeriod.filter(c => c.status === 'active' && c.no_show).length;
  // Un deal se compte dans la periode de SON OPPORTUNITE, pas dans celle du rendez-vous
  // ou il a ete signe. Sans ca, un deal signe au 2e rendez-vous atterrit dans une periode
  // dont le denominateur — les opportunites honorees — ne le contient pas, puisque
  // l'opportunite est comptee dans la periode du PREMIER rendez-vous. Le taux de closing
  // de la seconde periode a alors un numerateur sans denominateur, et peut depasser 100 %.
  //
  // La configuration existe deja en base : « Testrapportpasse », 1er call reserve le 21/08
  // (semaine du 17 au 23), continuation reservee le 29/08 (semaine du 24 au 30). Elle n'a
  // rien close a ce jour, donc aucun chiffre faux n'a ete affiche — c'est un defaut qui
  // attendait son premier rapport de vente.
  //
  // Regle de cohorte, docs/perimetre-stats-referentiel.md regle 2 : numerateur et
  // denominateur portent sur la meme population.
  const representantOv = representantDOpportunite(callsAllTime ?? calls);
  const idsDansLaPeriode = new Set(callsInPeriod.map(c => c.id));
  const dealsCloses = (callsAllTime ?? calls).filter(c =>
    c.deal_closed && idsDansLaPeriode.has(representantOv.get(c.id) ?? c.id)
  ).length;
  // Le cash contracte vient des VENTES, pas des rendez-vous. Vue generale etait le
  // dernier ecran a le sommer depuis les calls, donc a le decouper sur `booked_at` —
  // la date qui credite le CONTENU d'avoir genere un rendez-vous, pas celle ou l'argent
  // a ete engage. Deux consequences que cette ligne fait disparaitre :
  //
  //   - une vente SANS rendez-vous (upsell, vente hors pipeline) etait invisible ici,
  //     alors que l'onglet Revenus et l'accueil la comptaient ;
  //   - une vente signee le mois suivant son rendez-vous tombait dans le mois du
  //     rendez-vous, la ou les deux autres ecrans la mettaient dans son mois de signature.
  //
  // Aucun des deux cas n'existe en base au 2026-09-01 (0 vente sans rendez-vous, 0
  // signature hors du mois de sa reservation, ecart maximal 1,39 jour) — c'est justement
  // pour ca qu'il fallait le corriger avant qu'il ne se voie.
  //
  // Les cartes PAR CONTENU gardent, elles, le montant rattache au rendez-vous : un upsell
  // vendu six mois plus tard ne doit pas gonfler la performance du post qui a amene le
  // client. Voir docs/perimetre-stats-referentiel.md.
  const ventesDeLaPeriode = dealsDeLaPeriode(deals, ovPeriodStart, ovPeriodEnd, sinceConnection);
  // Cash CONTRACTE : ce qui a ete vendu sur la periode, `deals.amount_total` decoupe sur
  // `signed_at`. Regle 7 du referentiel.
  const totalRev = ventesDeLaPeriode.reduce((s, d) => s + Number(d.amount_total || 0), 0);

  // ── Cash COLLECTE, et pourquoi il est calcule par COHORTE ───────────────────
  //
  // La carte affiche trois nombres qu'un lecteur doit pouvoir recomposer de tete : le
  // collecte, le contracte, et leur pourcentage. Ils portent donc TOUS sur les memes
  // ventes — celles signees dans la periode — et on somme TOUS leurs paiements, sans
  // les borner sur la fenetre.
  //
  // L'autre formule possible — « l'argent rentre pendant la periode » rapporte a
  // « l'argent vendu pendant la periode » — divise deux ensembles de ventes DIFFERENTS.
  // Une echeance encaissee ce mois-ci sur une vente signee le mois dernier compte au
  // numerateur sans compter au denominateur : le taux peut alors depasser 100 %, et le
  // lecteur qui refait la division a partir des deux nombres affiches ne retombe pas
  // dessus. Meme raisonnement et meme decision que l'onglet Revenus (2026-08-30).
  //
  // Contrepartie assumee, identique a celle de l'onglet Revenus : une periode passee
  // peut voir son taux MONTER plus tard, a mesure que les echeances de ses ventes
  // tombent. C'est le sens de la question posee — « sur ce que j'ai vendu ce mois-la,
  // combien est rentre a ce jour ».
  const paiementsParDealOv = new Map<string, LignePaiement[]>();
  for (const v of cashParVente ?? []) {
    if (v.deal_id) paiementsParDealOv.set(v.deal_id, lignesDepuisSommes(v));
  }
  // `encaisseRetenu` et non `calculerCash().net` : un client peut verser PLUS que sa
  // vente (double prelevement, montant baisse apres paiement). Sans ecretage vente par
  // vente, le taux depasse 100 % et le surplus d'une vente vient masquer l'impaye d'une
  // autre dans le total. Voir lib/dealCash.ts, la regle unique du cash.
  const cashCollecteOv = ventesDeLaPeriode.reduce(
    (s, d) => s + (d.id ? encaisseRetenu(calculerCash(paiementsParDealOv.get(d.id) ?? []), d.amount_total) : 0),
    0,
  );
  const tauxCollecteOv = totalRev > 0 ? Math.round((cashCollecteOv / totalRev) * 100) : null;
  const noShowRate   = rendezVous > 0 ? pct(noShows, rendezVous) : 0;
  // Meme phrase qu'au hero de Funnel & Calls, et pour la meme raison : sans elle,
  // « Calls bookés » et « No-show » se lisent comme deux vues du meme total alors
  // qu'ils comptent deux choses. Affichee seulement quand les deux different.
  const aideBookesAvecNombres = callsBookes !== rendezVous
    ? `${callsBookes} calls bookés, mais ${rendezVous} rendez-vous. ${AIDE_CALLS_BOOKES}`
    : AIDE_CALLS_BOOKES;
  const closingRate  = callsHonores > 0 ? pct(dealsCloses, callsHonores) : 0;
  const revPerCall   = callsBookes > 0 ? Math.round(totalRev / callsBookes) : 0;

  // ── Tendance reach (sparkline) ────────────────────────────────────────────
  // Filtre par vraie date calendaire (ovPeriodStart/ovPeriodEnd), pas par position
  // dans le tableau (.slice(-N) suppose que chartData s'arrête pile aujourd'hui —
  // faux si les dernières données connues datent d'avant, donne une fenêtre décalée).
  const inOvWindow = (dateStr: string) => {
    const t = new Date(dateStr + 'T12:00:00Z').getTime();
    return t >= ovPeriodStart.getTime() && t <= ovPeriodEnd.getTime();
  };
  const igChartSliceRaw  = ig?.chartData.filter(d => inOvWindow(d.date)) || [];
  const ytChartSliceRaw  = yt?.chartData.filter(d => inOvWindow(d.date)) || [];
  // Même complétion que igChartSlice — côté YT, "pas de ligne" signifie déjà "pas encore
  // disponible" (l'API YouTube Analytics a un délai de traitement propre, ~J-3), donc
  // pending = jour manquant du tout, pas un flag séparé comme reachPending côté IG.
  const ytChartByDate = new Map(ytChartSliceRaw.map(d => [d.date, d]));
  const ytChartSlice: (typeof ytChartSliceRaw[number] & { pending?: boolean })[] = (() => {
    const days: (typeof ytChartSliceRaw[number] & { pending?: boolean })[] = [];
    let d = ovPeriodStart;
    while (d.getTime() <= ovPeriodEnd.getTime()) {
      const iso = parisDateStr(d);
      const existing = ytChartByDate.get(iso);
      // `pending: false` en dur ratait le cas « ligne presente, vues nulles ».
      days.push(existing
        ? { ...existing, pending: !!(existing as any).viewsPending }
        : { date: iso, views: 0, pending: true } as any);
      d = parisAddDays(d, 1);
    }
    return days;
  })();
  // Complète avec tous les jours calendaires de la période (comme igDays dans
  // TabInstagram) — sinon un jour sans ligne en base (ex: pas encore de commentaire IG,
  // premier jour du mois) disparaît totalement du graphique plutôt que d'apparaître
  // comme un point "pas encore de données". reachPending distingue une vraie valeur 0
  // (ligne existe, reach mesuré à 0) d'une absence de collecte (voir stats/route.ts).
  const igChartByDate = new Map(igChartSliceRaw.map(d => [d.date, d]));
  const igChartSlice: (typeof igChartSliceRaw[number] & { pending?: boolean })[] = (() => {
    const days: (typeof igChartSliceRaw[number] & { pending?: boolean })[] = [];
    let d = ovPeriodStart;
    while (d.getTime() <= ovPeriodEnd.getTime()) {
      const iso = parisDateStr(d);
      const existing = igChartByDate.get(iso);
      days.push(existing
        ? { ...existing, pending: (existing as any).reachPending }
        : { date: iso, reach: 0, pending: true } as any);
      d = parisAddDays(d, 1);
    }
    return days;
  })();

  // En All-Time, `reach30d` porte deja le total de toute la fenetre (503 sur le profil
  // de test) : le sommer depuis la courbe redonnerait la seule periode du selecteur.
  // C'est ce que faisait la branche `period === 7`, qui affichait « 4 personnes · total »
  // quand on entrait en All-Time depuis le mode 7 jours.
  const igReach = (!sinceConnection && period === 7)
    ? igChartSlice.reduce((s, d) => s + d.reach, 0)
    : (ig?.reach30d || 0);
  const ytViews = (!sinceConnection && period === 7)
    ? ytChartSlice.reduce((s, d) => s + d.views, 0)
    : (yt?.views30d || 0);
  // ── Abonnes : un ETAT, pas une mesure de periode ──────────────────────────
  // Un nombre d'abonnes ne se cumule pas ; le sous-titre « total » laissait pourtant
  // croire a une somme, et la carte changeait de valeur en naviguant (255 en aout,
  // 253 en juin). On affiche le compte du jour, lu sur l'appel live, qui ne depend
  // d'aucune fenetre.
  //
  // Ce que ca corrige aussi : l'ancienne lecture prenait le dernier jour de la periode
  // consultee, en passant par `?? 0` cote base. Mai 2026 n'a aucune mesure d'abonnes
  // YouTube sur ses 25 jours, et la carte affichait « 0 » — ce qui affirme que la chaine
  // etait vide. Un tiret dit « on ne sait pas ».
  const abonnesIg = igLive?.followers ?? null;
  const abonnesYt = ytLive?.subscribers ?? null;

  // ── Prochain call ─────────────────────────────────────────────────────────
  const nextCall = calls.filter(c => new Date(c.scheduled_at) > new Date()).sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())[0];

  // ── Signaux ────────────────────────────────────────────────────────────────
  const signalData: { type: SignalType; text: string }[] = [];
  if (nextCall) signalData.push({ type: 'green', text: `Prochain call : ${nextCall.invitee_name} — ${new Date(nextCall.scheduled_at).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` });
  // Le compte ET le montant viennent tous deux de `ventesDeLaPeriode`. Avant, la phrase
  // melangeait deux bases : un nombre de deals rattaches aux opportunites de la periode
  // (regle de cohorte, celle de la carte « Closing ») et un montant decoupe autrement.
  // « ventes signées » plutot que « deals closés » pour que le lecteur ne confonde pas ce
  // compte avec celui, different et voisin, du sous-titre de la carte Closing.
  if (ventesDeLaPeriode.length > 0) signalData.push({ type: 'green', text: `${ventesDeLaPeriode.length} vente${ventesDeLaPeriode.length > 1 ? 's' : ''} signée${ventesDeLaPeriode.length > 1 ? 's' : ''} sur ${libelleFenetre(period, periodIndex ?? 0, sinceConnection, allTimeStart)} — ${fmtEur(totalRev)} contractés` });
  // « des calls bookés » etait faux : le no-show est le seul compteur de Mes stats qui
  // parle en RENDEZ-VOUS, et son aide insiste precisement sur cette distinction. Le
  // signal disait donc l'inverse de la carte qu'il commente. On nomme le denominateur.
  if (rendezVous > 0 && noShowRate > 20) signalData.push({ type: 'red', text: `Taux no-show élevé : ${fmt(noShowRate, 1)} % — ${noShows} sur ${rendezVous} rendez-vous` });
  // `msgs.responseRate != null` : sans cette garde, le zero fabrique par le chemin
  // instantane declenchait « Taux de reponse DM bas : 0 % » sur TOUTE periode passee,
  // alors que la donnee n'a jamais ete collectee. Une alerte qui se declenche toujours
  // cesse d'etre lue.
  if (msgs && msgs.responseRate != null && msgs.repliedThreads != null && msgs.responseRate < 70) signalData.push({ type: 'amber', text: `Taux de réponse DM bas : ${fmt(msgs.responseRate, 1)} % — ${msgs.totalThreads30d - msgs.repliedThreads} conversations sans réponse` });
  // Signal de closing retire avec le seuil de couleur de la carte : il annoncait un
  // « seuil cible de 25 % » qui n'etait calibre sur rien. Un objectif invente, repete en
  // alerte, apprend surtout a ne plus lire les alertes.

  // ── Top contenus ──────────────────────────────────────────────────────────
  // Ce bloc est all-time — callsAllTime (jamais filtré par période), PAS calls (= callsEff, qui EST
  // coupé sur la fenêtre de la période affichée dès que periodIndex > 0).
  const callsForTopContent = callsAllTime ?? calls;
  // Le journal indexe par fiche, pour que Top contenus attribue avec LA regle et non
  // avec une regle a lui. Meme construction que dans Business micro.
  const journalParFicheOv = new Map<string, NonNullable<typeof lmHistory>>();
  {
    const ficheParPersonne = new Map<string, string>();
    // `id` est optionnel sur MockLead : une fiche sans identifiant ne peut relier
    // aucun rendez-vous, donc elle n'entre pas dans la table de correspondance.
    for (const l of (leads ?? [])) if (l.igUserId && l.id) ficheParPersonne.set(l.igUserId, l.id);
    for (const h of (lmHistory ?? [])) {
      const fiche = h.ig_user_id ? ficheParPersonne.get(h.ig_user_id) : undefined;
      if (!fiche) continue;
      const liste = journalParFicheOv.get(fiche);
      if (liste) liste.push(h); else journalParFicheOv.set(fiche, [h]);
    }
  }
  /** LA règle d'attribution, la même partout. Voir lib/attribution-roles.ts. */
  const contenuDuCallOv = (c: CallRecord): string | null =>
    contenuConversion(
      {
        utm_content: c.utm_content,
        utm_medium: c.utm_medium,
        source: c.source,
        booked_at: c.booked_at,
        scheduled_at: c.scheduled_at,
      },
      (c.ig_lead_id && journalParFicheOv.get(c.ig_lead_id)) || [],
    );

  const igCallsAll = callsForTopContent.filter(isIGCall);
  const ytCallsAll = callsForTopContent.filter(isYTCall);
  // Fusion live + historique pour la LISTE de contenus (identité, titre, thumbnail) — ce bloc est un
  // classement all-time, mais igLive/ytLive ne couvrent que les 30 derniers jours : un post plus ancien
  // disparaîtrait s'il fallait choisir l'un ou l'autre.
  const igPostsById = new Map<string, any>();
  for (const p of (ig?.posts ?? [])) igPostsById.set(p.id, p);
  for (const p of (igLive?.posts ?? [])) igPostsById.set(p.id, { ...igPostsById.get(p.id), ...p });
  const igPosts = [...igPostsById.values()];
  const ytVideosById = new Map<string, any>();
  for (const v of (yt?.videos ?? [])) ytVideosById.set(v.id, v);
  for (const v of (ytLive?.videos ?? [])) ytVideosById.set(v.id, { ...ytVideosById.get(v.id), ...v });
  const ytVideos = [...ytVideosById.values()];
  // Quelles videos ont recu les valeurs VIVANTES par la fusion ci-dessus. Determinant
  // pour « Watch time moyen » : cote live, `watchTime30d` contient de l'ALL-TIME (la
  // requete par video part de 2020-01-01) ; cote snapshot, il contient 30 jours
  // (`watch_time_min`, ecrit par le cron). Le meme champ, deux fenetres.
  const ytVideosVivantes = new Set((ytLive?.videos ?? []).map((v: any) => v.id));
  // Vues lifetime pour Cash/Vue — UNIQUEMENT igLive/ytLive (jamais l'historique, qui varie avec
  // periodIndex). Si le post n'est plus dans la fenêtre live (30j), vue lifetime inconnue : null.
  const igLiveViewsByIdOv = new Map<string, number>((igLive?.posts ?? []).map((p: any) => [p.id, p.views || p.reach || 0]));
  const ytLiveViewsByIdOv = new Map<string, number>((ytLive?.videos ?? []).map((v: any) => [v.id, v.views || 0]));

  // Attribution calls → contenu : `contenuConversion`, LA règle, celle de Business
  // micro et celle qui a écrit `deals.first_touch_content_id`.
  //
  // Ce bloc avait sa PROPRE logique, et elle divergeait sur deux points :
  //
  //   1. elle se repliait sur `leadIdToMediaId`, c'est-à-dire `instagram_leads.media_id`,
  //      l'état COURANT écrasé à chaque interaction. Ce repli est explicitement interdit
  //      par `attribution-roles.ts` ; il avait été retiré de Business micro le
  //      2026-08-29, jamais d'ici ;
  //   2. elle faisait confiance à `utm_content` même pour un lien DM, alors qu'il n'y a
  //      qu'UN lien Calendly par personne, gravé une fois et jamais regravé.
  //
  // Trois écrans répondaient donc à « quel contenu a rapporté cet argent » avec trois
  // règles différentes. Il n'y en a plus qu'une.
  //
  // ⚠️ Le montant d'un contenu vient de `deals`, PAS de `calls.revenue`.
  //
  // `calls.revenue` est le montant SAISI dans le rapport de call ; `deals.amount_total`
  // est la vente reellement contractee, que la page Paiements peut corriger ensuite.
  // Les deux divergent : mesure du 2026-09-02 sur la base entiere, 12 000 EUR cote
  // rapport contre 10 200 EUR cote ventes, 1 800 EUR d'ecart sur une ligne. Tous les
  // ecrans lisent `deals` depuis le 2026-08-20 ; ce tableau etait le dernier a ne pas le
  // faire, et il l'affichait sous le mot « Revenue », assez vague pour que l'ecart ne se
  // voie pas.
  //
  // Le rattachement reste celui du RENDEZ-VOUS, conformement au commentaire de
  // `ventesDeLaPeriode` ci-dessus : un upsell vendu six mois plus tard ne doit pas
  // gonfler la performance du post qui a amene le client. On somme donc les deals PAR
  // CALL, et non par date de signature.
  const montantParCallOv = new Map<string, number>();
  for (const d of deals ?? []) {
    if (!d.call_id || d.status === 'canceled') continue;
    montantParCallOv.set(d.call_id, (montantParCallOv.get(d.call_id) ?? 0) + Number(d.amount_total || 0));
  }
  const cashContracteDesCalls = (liste: CallRecord[]) =>
    liste.reduce((s, c) => s + (montantParCallOv.get(c.id) ?? 0), 0);

  type ContentItem = { id: string; title: string; thumbnail: string | null; platform: 'IG' | 'YT'; type: string; views: number; totalViews: number; watchTime: number; avgWatchTimeMin: number | null; rendezVous: number; noShowCount: number; noShowPct: number | null; closedCount: number; closedPct: number | null; callsBooked: number; callsHonores: number; revenueTotal: number; revenuePerCall: number; cashPerView: number | null };
  const allContent: ContentItem[] = [
    ...igPosts.map(p => {
      const postCalls = igCallsAll.filter(c => contenuDuCallOv(c) === p.id);
      const callsBooked = postCalls.filter(c => c.status === 'active' && estOpportunite(c)).length;
      const noShowCount = postCalls.filter(c => c.no_show).length;
      const closedCount = postCalls.filter(c => c.deal_closed).length;
      const revTotal = cashContracteDesCalls(postCalls);
      // « Calls honores » etait DEDUIT : bookes moins no-show. Les deux termes ne
      // comptaient pas la meme population — « bookes » retire les 2es rendez-vous et les
      // annules, « no-show » les gardait — si bien qu'un 2e rendez-vous manque etait
      // retire d'un cote de la soustraction et pas de l'autre. Un contenu ayant produit
      // une opportunite honoree puis un 2e rendez-vous manque affichait « 0 honore », et
      // la colonne pouvait passer SOUS ZERO avec deux cas pareils. On le calcule donc
      // directement, avec la definition unique de lib/callHonored.ts — la meme que les
      // cartes du haut de cet ecran.
      const honored = postCalls.filter(c => isCallHonored(c, now) && estOpportunite(c)).length;
      // Le no-show garde le grain RENDEZ-VOUS, ici comme partout ailleurs dans Mes stats :
      // un creneau pose et non honore est un creneau perdu, meme s'il prolongeait une
      // vente en cours. Le compter en opportunites ferait disparaitre du tableau des
      // no-shows bien reels, et surtout creerait une SECONDE definition du mot sous le
      // meme nom. Son denominateur est donc different de « Calls bookes » — il est ecrit
      // dans la cellule (« 1/7 rdv »), comme il l'est sous la carte du haut.
      const rendezVous = postCalls.filter(c => c.status === 'active').length;
      const noShowPct = rendezVous > 0 ? Math.round((noShowCount / rendezVous) * 100) : null;
      const closedPct = honored > 0 ? Math.round((closedCount / honored) * 100) : null;
      const avgWatchTimeMin = p.avgWatchTimeMs ? Math.round(p.avgWatchTimeMs / 1000 / 60 * 10) / 10 : null;
      const totalViewsIG = p.views || p.reach || 0;
      const viewsLifetimeIG = igLiveViewsByIdOv.get(p.id) ?? null;
      return { id: p.id, title: p.caption?.slice(0, 60) || '(sans titre)', thumbnail: p.thumbnail || null, platform: 'IG' as const, type: p.type === 'VIDEO' || p.type === 'REEL' || p.type === 'REELS' ? 'Reel' : p.type === 'CAROUSEL_ALBUM' ? 'Carousel' : 'Image', views: totalViewsIG, totalViews: totalViewsIG, watchTime: p.totalWatchTimeMs ? Math.round(p.totalWatchTimeMs / 1000 / 60) : 0, avgWatchTimeMin, rendezVous, noShowCount, noShowPct, closedCount, closedPct, callsBooked, callsHonores: honored, revenueTotal: revTotal, revenuePerCall: callsBooked > 0 ? Math.round(revTotal / callsBooked) : 0, cashPerView: viewsLifetimeIG && viewsLifetimeIG > 0 ? revTotal / viewsLifetimeIG : null };
    }),
    ...ytVideos.map(v => {
      // Même fonction que pour Instagram. Le résultat est identique — un lien en
      // description de vidéo est PORTÉ par cette vidéo, donc son UTM dit vrai — mais une
      // seule fonction d'attribution est ce qui empêche les deux de diverger un jour.
      const postCalls = ytCallsAll.filter(c => contenuDuCallOv(c) === v.id);
      const callsBooked = postCalls.filter(c => c.status === 'active' && estOpportunite(c)).length;
      const noShowCount = postCalls.filter(c => c.no_show).length;
      const closedCount = postCalls.filter(c => c.deal_closed).length;
      const revTotal = cashContracteDesCalls(postCalls);
      // « Calls honores » etait DEDUIT : bookes moins no-show. Les deux termes ne
      // comptaient pas la meme population — « bookes » retire les 2es rendez-vous et les
      // annules, « no-show » les gardait — si bien qu'un 2e rendez-vous manque etait
      // retire d'un cote de la soustraction et pas de l'autre. Un contenu ayant produit
      // une opportunite honoree puis un 2e rendez-vous manque affichait « 0 honore », et
      // la colonne pouvait passer SOUS ZERO avec deux cas pareils. On le calcule donc
      // directement, avec la definition unique de lib/callHonored.ts — la meme que les
      // cartes du haut de cet ecran.
      const honored = postCalls.filter(c => isCallHonored(c, now) && estOpportunite(c)).length;
      // Le no-show garde le grain RENDEZ-VOUS, ici comme partout ailleurs dans Mes stats :
      // un creneau pose et non honore est un creneau perdu, meme s'il prolongeait une
      // vente en cours. Le compter en opportunites ferait disparaitre du tableau des
      // no-shows bien reels, et surtout creerait une SECONDE definition du mot sous le
      // meme nom. Son denominateur est donc different de « Calls bookes » — il est ecrit
      // dans la cellule (« 1/7 rdv »), comme il l'est sous la carte du haut.
      const rendezVous = postCalls.filter(c => c.status === 'active').length;
      const noShowPct = rendezVous > 0 ? Math.round((noShowCount / rendezVous) * 100) : null;
      const closedPct = honored > 0 ? Math.round((closedCount / honored) * 100) : null;
      // v.watchTime30d est déjà en minutes (row.watch_time_min) — pas de /60 ici, contrairement
      // à la branche IG ci-dessus (avgWatchTimeMs en ms) : diviser aussi par 60 donnait un résultat
      // 60x trop petit (ex: 0.0 min affiché au lieu de 2.5 min).
      // ⚠️ Numerateur et denominateur doivent venir de la MEME fenetre.
      //
      // `watchTime30d` porte un nom qui ment differemment selon le chemin : all-time
      // cote API live (requete depuis 2020-01-01), 30 jours cote snapshot (le cron
      // ecrit `watch_time_min` sur 30 jours). Diviser le second par des vues lifetime
      // donne une moyenne tres inferieure a la verite, sans rien de visiblement absurde
      // a l'ecran.
      //
      // Le defaut est LATENT aujourd'hui : la route live renvoie 50 videos et les
      // chaines en ont 29, donc la fusion ci-dessus les couvre toutes. Il apparaitrait
      // au-dela de 50 videos, sur les plus anciennes seulement — le genre de bascule
      // qu'on ne relie jamais a sa cause des mois plus tard.
      const vientDuLive = ytVideosVivantes.has(v.id);
      const vViews = vientDuLive ? (v.viewsAllTime ?? v.views30d) : v.views30d;
      const avgWatchTimeMin = v.watchTime30d && vViews > 0 ? Math.round(v.watchTime30d / vViews * 10) / 10 : null;
      const viewsLifetimeYT = ytLiveViewsByIdOv.get(v.id) ?? null;
      return { id: v.id, title: v.title, thumbnail: v.thumbnail || null, platform: 'YT' as const, type: v.isShort ? 'Short' : 'Vidéo', views: v.views30d, totalViews: v.views, watchTime: v.watchTime30d, avgWatchTimeMin, rendezVous, noShowCount, noShowPct, closedCount, closedPct, callsBooked, callsHonores: honored, revenueTotal: revTotal, revenuePerCall: callsBooked > 0 ? Math.round(revTotal / callsBooked) : 0, cashPerView: viewsLifetimeYT && viewsLifetimeYT > 0 ? revTotal / viewsLifetimeYT : null };
    }),
  ];

  const SORT_LABELS_V2: { key: ContentSortKey; label: string }[] = [
    { key: 'views', label: 'Vues' },
    { key: 'watchTime', label: 'Watch Time' },
    { key: 'calls', label: 'Calls' },
    { key: 'revenue', label: 'Revenue' },
  ];
  const sortedContent = [...allContent].sort((a, b) => {
    if (contentSort === 'views') return b.totalViews - a.totalViews;
    if (contentSort === 'watchTime') return b.watchTime - a.watchTime;
    if (contentSort === 'calls') {
      if (b.closedCount !== a.closedCount) return b.closedCount - a.closedCount;
      // Meme correction que la colonne affichee : l'honore se lit, il ne se deduit plus.
      // Un tri sur une valeur qui n'est pas celle de la colonne classe le tableau dans un
      // ordre que le lecteur ne peut pas retrouver avec ses yeux.
      const aHonored = a.callsHonores;
      const bHonored = b.callsHonores;
      if (bHonored !== aHonored) return bHonored - aHonored;
      return b.callsBooked - a.callsBooked;
    }
    if (b.revenueTotal !== a.revenueTotal) return b.revenueTotal - a.revenueTotal;
    if (b.closedCount !== a.closedCount) return b.closedCount - a.closedCount;
    return b.callsBooked - a.callsBooked;
  });
  const visibleContent = showAllContent ? sortedContent : sortedContent.slice(0, 5);

  // ⚠️ En All-Time, la borne est la MISE EN ROUTE, pas l'origine du compte.
  //
  // Le detour vaut d'etre raconte : la carte a d'abord affiche « 0 » sur un compte
  // dont la grille montre 14 contenus — parce qu'il n'a rien publie depuis son
  // inscription (derniere publication le 23 fevrier, inscription le 9 juin). Le
  // chiffre etait exact, il se lisait comme une panne, et on a d'abord bascule la
  // carte en inventaire du compte.
  //
  // Retour en arriere, decide par Chris le 2026-09-04 : un inventaire se serait
  // compare, ligne a ligne, avec un reach et des calls qui comptent l'activite
  // DEPUIS L'INSCRIPTION. Deux natures cote a cote sous le meme selecteur, c'est la
  // classe de defaut que ce fichier passe son temps a corriger. Un « 0 » surprenant
  // mais coherent vaut mieux qu'un chiffre plein qui ne se compare a rien.
  const dansLaFenetrePub = (t: number) =>
    t >= ovPeriodStart.getTime() && (_ovPIdx === 0 || t <= ovPeriodEnd.getTime());
  const igPostsInPeriod = ig?.posts.filter(p => dansLaFenetrePub(new Date(p.timestamp).getTime())).length || 0;
  const ytVideosInPeriodOv = yt?.videos.filter(v => dansLaFenetrePub(new Date(v.publishedAt).getTime())).length || 0;
  // Les stories ne sont connues QUE depuis le premier passage du cron qui les a vues
  // (25 juillet 2026 sur le compte de test) : elles expirent en 24 h et ne se
  // rattrapent pas. Une periode anterieure en comptera donc zero, legitimement.
  const storiesInPeriodOv = (stories ?? []).filter((s: any) =>
    dansLaFenetrePub(new Date(s.posted_at).getTime())).length;
  const totalPosts = igPostsInPeriod + ytVideosInPeriodOv + storiesInPeriodOv;

  return (
    <div className="stack">

      {/* ── BLOC 1 : KPIs — 2 lignes de 5 ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
        {([
          { label: 'Abonnés IG', value: abonnesIg !== null ? fmt(abonnesIg) : '—', sub: "aujourd'hui", color: (abonnesIg !== null ? IG_COLOR : 'var(--faint)') as string },
          { label: 'Abonnés YT', value: abonnesYt !== null ? fmt(abonnesYt) : '—', sub: "aujourd'hui", color: (abonnesYt !== null ? YT_COLOR : 'var(--faint)') as string },
          null, // carte Publications custom
          'leads', // carte Leads custom (badge nouveaux à droite du chiffre)
          { label: 'Calls bookés', value: fmt(callsBookes), sub: ovEtiquettePeriode, color: 'var(--ink)' as string, aide: aideBookesAvecNombres },
        ] as const).map((item, i) => {
          if (item === 'leads') return (
            <div key="leads" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px' }}>
              <div className="eyebrow-sm" style={{ color: 'var(--muted)', marginBottom: 8 }}>Leads</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: BLUE, lineHeight: 1 }}>{fmt(leadsCount)}</div>
                {newLeadsCount > 0 && (
                  <span title={newLeadsBadgeTitle} style={{
                    fontSize: 10, fontWeight: 700, color: GREEN, background: 'color-mix(in srgb, var(--green) 14%, transparent)',
                    borderRadius: 20, padding: '2px 7px', lineHeight: 1.4, whiteSpace: 'nowrap',
                  }}>
                    +{fmt(newLeadsCount)} {newLeadsBadgeLabel}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 10, color: 'var(--faint)' }}>{sinceConnection ? 'total' : `${period}j`}</div>
            </div>
          );
          if (item === null) return (
            <div key="publications" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px' }}>
              <div className="eyebrow-sm" style={{ color: 'var(--muted)', marginBottom: 8 }}>
                <span>Publications</span>
                <span style={{ fontWeight: 500, color: 'var(--faint)', marginLeft: 5 }}>{ovEtiquettePeriode}</span>
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--ink)', lineHeight: 1, marginBottom: 8 }}>{fmt(totalPosts)}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'nowrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: IG_COLOR, flexShrink: 0 }} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink)', whiteSpace: 'nowrap' }}>{fmt(igPostsInPeriod)}</span>
                  <span style={{ fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap' }}>IG</span>
                </div>
                <div style={{ width: 1, height: 12, background: 'var(--border)', flexShrink: 0 }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: YT_COLOR, flexShrink: 0 }} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink)', whiteSpace: 'nowrap' }}>{fmt(ytVideosInPeriodOv)}</span>
                  <span style={{ fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap' }}>YT</span>
                </div>
                <div style={{ width: 1, height: 12, background: 'var(--border)', flexShrink: 0 }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#8B5CF6', flexShrink: 0 }} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink)', whiteSpace: 'nowrap' }}>{fmt(storiesInPeriodOv)}</span>
                  <span style={{ fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap' }}>Stories</span>
                </div>
              </div>
            </div>
          );
          return (
            <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px' }}>
              <div className="eyebrow-sm" style={{ color: 'var(--muted)', marginBottom: 8, display: 'flex', alignItems: 'center' }}>{item.label}{'aide' in item && item.aide ? <AideColonne texte={item.aide} /> : null}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: item.color, lineHeight: 1, marginBottom: 4 }}>{item.value}</div>
              <div style={{ fontSize: 10, color: 'var(--faint)' }}>{item.sub}</div>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
        {[
          { label: 'Calls honorés', value: fmt(callsHonores), sub: ovEtiquettePeriode, color: AMBER, aide: AIDE_CALLS_HONORES },
          // Un mois sans le moindre rendez-vous affichait « 0 % » partout : vert sur le
          // no-show (fiabilite parfaite) et ROUGE sur le closing (contre-performance).
          // Un mois ou il ne s'est rien passe n'est ni bon ni mauvais — il est vide, et
          // c'est un tiret qui le dit. Mesure : mai 2026 sur le profil de test.
          { label: 'No-show', value: rendezVous > 0 ? `${fmt(noShowRate, 0)} %` : '—', sub: rendezVous > 0 ? `${noShows} sur ${rendezVous} rendez-vous` : 'aucun rendez-vous', color: (rendezVous === 0 ? 'var(--faint)' : noShowRate > 20 ? RED : noShowRate > 10 ? AMBER : GREEN) as string, aide: AIDE_NO_SHOW },
          // Plus de seuil de couleur sur le closing : le 25 % / 15 % n'etait calibre sur
          // rien de tracable, et un seuil invente colore en rouge une performance normale.
          // Le chiffre se lit maintenant comme « Calls bookes » et « Calls honores ».
          { label: 'Closing', value: callsHonores > 0 ? `${fmt(closingRate, 0)} %` : '—', sub: callsHonores > 0 ? `${dealsCloses} deal${dealsCloses > 1 ? 's' : ''} closé${dealsCloses > 1 ? 's' : ''}` : dealsCloses > 0 ? `${dealsCloses} deal${dealsCloses > 1 ? 's' : ''} closé${dealsCloses > 1 ? 's' : ''}, aucun call honoré` : 'aucun call honoré', color: (callsHonores > 0 ? 'var(--ink)' : 'var(--faint)') as string, aide: AIDE_CLOSING },
          { label: 'Rev / call', value: callsBookes > 0 ? fmtEur(revPerCall) : '—', sub: callsBookes > 0 ? 'par call booké' : 'aucun call booké', color: (callsBookes > 0 ? GREEN : 'var(--faint)') as string, aide: AIDE_REV_PAR_CALL },
          // Le sous-titre porte le denominateur ET le taux, pour que la division reste
          // refaisable de tete depuis les deux nombres affiches. Sans le mot
          // « contractes », « 84 % » se lirait comme un taux de closing.
          { label: 'Cash collecté',
            value: fmtEur(cashCollecteOv),
            sub: totalRev > 0
              ? `${tauxCollecteOv} % de ${fmtEur(totalRev)} contractés`
              : 'aucune vente signée',
            color: (cashCollecteOv > 0 ? GREEN : 'var(--faint)') as string,
            aide: AIDE_CASH_COLLECTE },
        ].map((item, i) => (
          <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px' }}>
            <div className="eyebrow-sm" style={{ color: 'var(--muted)', marginBottom: 8, display: 'flex', alignItems: 'center' }}>{item.label}{'aide' in item && item.aide ? <AideColonne texte={item.aide} /> : null}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: item.color, lineHeight: 1, marginBottom: 4 }}>{item.value}</div>
            <div style={{ fontSize: 10, color: 'var(--faint)' }}>{item.sub}</div>
          </div>
        ))}
      </div>

      {/* ── BLOC 2 : Santé contenu — 2 sparklines côte à côte ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {[
          { label: 'Reach Instagram', value: fmt(igReach), unit: 'personnes', color: IG_COLOR, ...regrouperSerieAffichee(igChartSlice.map(d => ({ date: d.date, v: d.pending ? null : d.reach })), 'comptage') },
          { label: 'Vues YouTube', value: fmt(ytViews), unit: 'vues', color: YT_COLOR, ...regrouperSerieAffichee(ytChartSlice.map(d => ({ date: d.date, v: d.pending ? null : d.views })), 'comptage') },
        ].map((item, i) => {
          // Quand AUCUN jour n'est mesure, le grand chiffre valait « 0 » — il affirmait
          // « zero personne touchee » la ou la courbe disait deja « pas encore de donnees ».
          // Vu en production le 2026-09-01 : la ligne du jour existe en base avec ig_reach
          // a NULL, et la carte annoncait « 0 personnes » pour le mois qui commence. Le
          // cas se represente le 1er de chaque mois.
          const allPending = item.data.every(d => d.v === null);
          return (
          <div key={i} className="stats-hover-card" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 20px 12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <div>
                <div className="eyebrow-sm" style={{ color: 'var(--muted)', marginBottom: 4 }}>{item.label}</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ fontSize: 26, fontWeight: 800, color: allPending ? 'var(--faint)' : 'var(--ink)', lineHeight: 1 }}>{allPending ? '—' : item.value}</span>
                  {!allPending && <span style={{ fontSize: 10, color: 'var(--muted)' }}>{item.unit}</span>}
                </div>
                <div style={{ fontSize: 10, color: 'var(--faint)', marginTop: 2 }}>{ovEtiquettePeriode}</div>
              </div>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: item.color, marginTop: 4 }} />
            </div>
            {/* minWidth: 0 — sans lui, le ResponsiveContainer en height="100%" a
                l'interieur mesure une largeur negative au premier rendu et Recharts
                avertit « width(-1) and height(-1) » dans la console. */}
            <div style={{ position: 'relative', height: 140, width: '100%', minWidth: 0 }}>
              {allPending && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1, pointerEvents: 'none' }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--faint)', background: 'var(--surface)', padding: '4px 10px', borderRadius: 6 }}>
                    Pas encore de données
                  </span>
                </div>
              )}
              <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height: 140 }}>
                <ReAreaChart data={item.data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id={`grad-v2-${i}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={item.color} stopOpacity={0.18} />
                      <stop offset="95%" stopColor={item.color} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={item.pas === 1 && !sinceConnection && period === 7 ? fmtAxisDateWithDay : fmtAxisDate} interval={graduationsDates(item.data.length, sinceConnection ? 30 : period)} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} allowDecimals={false} width={30} domain={([dataMin, dataMax]: readonly [number, number]) => { const range = dataMax - dataMin; const margin = range > 0 ? range * 0.15 : Math.max(1, Math.abs(dataMax) * 0.1 || 1); return [Math.max(0, dataMin - margin), dataMax + margin]; }} />
                  <Tooltip content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    // `libelle` porte la plage reelle du point (« 9 juin – 11 juin ») des que
                    // les jours sont regroupes. Sans lui l'infobulle n'annoncerait que le
                    // premier jour du groupe pour une valeur qui en couvre trois.
                    const plage = (payload[0].payload as any)?.libelle;
                    return <div className="chart-tooltip"><div className="chart-tooltip-label">{plage ?? label}</div><div className="chart-tooltip-row"><strong>{fmt(payload[0].value as number)}</strong></div></div>;
                  }} />
                  <Area type="monotone" dataKey="v" stroke={item.color} strokeWidth={2} fill={`url(#grad-v2-${i})`} dot={todayDotFactory(item.color, 'date', lastRealPointKey(item.data, 'date', 'v'))} activeDot={{ r: 4, strokeWidth: 0, fill: item.color }} isAnimationActive={false} />
                </ReAreaChart>
              </ResponsiveContainer>
            </div>
          </div>
          );
        })}
      </div>

      {/* ── BLOC 3 : Top contenus ── */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px 22px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center' }}>
              Top contenus
              <AideColonne texte={AIDE_TOP_CONTENUS} />
            </div>
            <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>Toutes publications · {sortedContent.length} contenus · depuis toujours (all time)</div>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {SORT_LABELS_V2.map(s => (
              <button key={s.key} onClick={() => setContentSort(s.key)} style={{
                padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 6, cursor: 'pointer', border: '1px solid var(--border)',
                background: contentSort === s.key ? 'var(--accent-brand)' : 'transparent',
                color: contentSort === s.key ? '#fff' : 'var(--muted)',
                transition: 'all .15s',
              }}>{s.label}</button>
            ))}
          </div>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {/* Les colonnes qui comptent des calls portent la MEME aide que les cartes du
                  haut de l'ecran : « Calls bookes » et « No-show » y designent exactement la
                  meme chose, et un lecteur qui descend de trente centimetres ne doit pas avoir
                  a le redecouvrir. Elles reutilisent donc les constantes AIDE_*, jamais un
                  texte recopie — c'est cette recopie qui fait diverger les libelles.

                  Sur ce tableau, l'aide du no-show gagne meme en utilite : sa cellule affiche
                  « 1/3 rdv », un denominateur different de la colonne « Calls bookes » juste a
                  cote, et l'aide dit pourquoi. */}
              {((): { label: string; aide?: string }[] => {
                const c = (label: string, aide?: string) => ({ label, aide });
                if (contentSort === 'views') return [c(''), c('Contenu'), c('Plateforme'), c('Vues totales')];
                if (contentSort === 'watchTime') return [c(''), c('Contenu'), c('Plateforme'), c('Watch time total'), c('Watch time moyen')];
                if (contentSort === 'calls') return [c(''), c('Contenu'), c('Plateforme'), c('Calls bookés', AIDE_CALLS_BOOKES), c('Calls honorés', AIDE_CALLS_HONORES), c('No-show', AIDE_NO_SHOW), c('Closé', AIDE_CLOSING)];
                return [c(''), c('Contenu'), c('Plateforme'), c('Calls bookés', AIDE_CALLS_BOOKES), c('Revenue / call', AIDE_REV_PAR_CALL), c('Cash / vue'), c('Cash contracté total', AIDE_CASH_CONTRACTE)];
              })().map((h, i) => (
                <th key={i} className="eyebrow-sm" style={{ textAlign: i <= 1 ? 'left' : 'right', color: 'var(--muted)', padding: '0 8px 8px', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: i <= 1 ? 'flex-start' : 'flex-end' }}>
                    {h.label}{h.aide ? <AideColonne texte={h.aide} /> : null}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleContent.map((c) => {
              const contentUrl = c.platform === 'YT'
                ? yt?.videos.find(v => v.id === c.id)?.url
                : ig?.posts.find(p => p.id === c.id)?.permalink;
              const hasLink = contentUrl && contentUrl !== '#';
              return (
                <tr key={c.id}
                  onClick={() => hasLink && window.open(contentUrl, '_blank')}
                  style={{ borderBottom: '1px solid var(--border-soft)', cursor: hasLink ? 'pointer' : 'default' }}
                  onMouseEnter={e => { if (hasLink) e.currentTarget.style.background = 'var(--surface-2)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = ''; }}>
                  <td style={{ padding: '8px 8px', width: 52 }}>
                    {c.thumbnail ? (
                      <img loading="lazy" decoding="async" src={c.thumbnail} alt="" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 6, display: 'block' }} />
                    ) : (
                      <div style={{ width: 44, height: 44, borderRadius: 6, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>
                        {c.platform === 'YT' ? '▶' : '📷'}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '8px 8px', maxWidth: 200 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: hasLink ? 'var(--accent)' : 'var(--ink)' }}>{c.title}</div>
                  </td>
                  <td style={{ padding: '8px 8px', textAlign: 'right' }}>
                    <span style={{ fontSize: 10, fontWeight: 600, color: c.platform === 'IG' ? IG_COLOR : YT_COLOR, background: c.platform === 'IG' ? IG_COLOR + '15' : YT_COLOR + '15', borderRadius: 4, padding: '2px 6px' }}>{c.platform} · {c.type}</span>
                  </td>
                  {contentSort === 'views' && (
                    <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: 13, fontWeight: 700 }}>{fmt(c.totalViews)}</td>
                  )}
                  {contentSort === 'watchTime' && (<>
                    <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: 13, fontWeight: 700 }}>{c.watchTime >= 60 ? `${Math.round(c.watchTime / 60)}h` : `${c.watchTime} min`}</td>
                    <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: 12, color: 'var(--muted)' }}>{c.avgWatchTimeMin !== null ? `${c.avgWatchTimeMin} min` : '—'}</td>
                  </>)}
                  {contentSort === 'calls' && (<>
                    <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: 13, fontWeight: 700 }}>{fmt(c.callsBooked)}</td>
                    <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
                      {c.callsBooked > 0 ? fmt(c.callsHonores) : '—'}
                    </td>
                    <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: 12, fontWeight: 600, color: c.noShowPct === null ? 'var(--faint)' : c.noShowPct > 20 ? RED : c.noShowPct > 10 ? AMBER : GREEN }}>
                      {c.noShowPct !== null ? `${c.noShowCount}/${c.rendezVous} rdv (${c.noShowPct} %)` : '—'}
                    </td>
                    <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: 12, fontWeight: 600, color: c.closedPct === null ? 'var(--faint)' : c.closedPct >= 25 ? GREEN : c.closedPct >= 15 ? AMBER : RED }}>
                      {/* `closedPct` vaut null quand aucune opportunite n'a ete honoree. Sans cette
                          garde, une vente signee sur un contenu dont le 1er rendez-vous fut un
                          no-show affichait « 1 (null%) ». */}
                      {c.closedPct !== null ? `${c.closedCount} (${c.closedPct} %)` : c.closedCount > 0 ? `${c.closedCount} · aucun call honoré` : '—'}
                    </td>
                  </>)}
                  {contentSort === 'revenue' && (<>
                    <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: 13, fontWeight: 700 }}>{fmt(c.callsBooked)}</td>
                    <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: 12, color: 'var(--muted)' }}>{c.revenuePerCall > 0 ? fmtEur(c.revenuePerCall) : '—'}</td>
                    <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: 12, color: 'var(--muted)' }}>{c.cashPerView !== null ? fmtEur(c.cashPerView) : '—'}</td>
                    <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: 13, fontWeight: 700 }}>{fmtEur(c.revenueTotal)}</td>
                  </>)}
                </tr>
              );
            })}
          </tbody>
        </table>
        {sortedContent.length > 5 && (
          <div style={{ marginTop: 12, textAlign: 'center' }}>
            <button onClick={() => setShowAllContent(v => !v)} style={{
              padding: '7px 20px', fontSize: 12, fontWeight: 600, borderRadius: 8, cursor: 'pointer',
              border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)',
              transition: 'all .15s',
            }}>
              {showAllContent ? 'Voir moins ↑' : `Voir tout (${sortedContent.length}) ↓`}
            </button>
          </div>
        )}
      </div>

      {/* ── BLOC 4 : Signaux ── */}
      {signalData.length > 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px 22px' }}>
          <div className="eyebrow-lg" style={{ color: 'var(--muted)', marginBottom: 12 }}>Signaux récents</div>
          {signalData.map((s, i) => <Signal key={i} type={s.type} text={s.text} isLast={i === signalData.length - 1} />)}
        </div>
      )}

    </div>
  );
}

// ─── TAB 2 : Instagram ────────────────────────────────────────────────────────

function TabInstagram({ ig, period, periodIndex, profileId, sinceConnection, connexionCassee, abonnesAujourdHui, allTimeStart, stories }: { ig: IGStats | null; period: Period; periodIndex?: number; profileId?: string; sinceConnection?: boolean; connexionCassee?: boolean; abonnesAujourdHui?: number | null; allTimeStart?: string | null; stories?: any[] }) {
  const [selectedPost, setSelectedPost] = useState<IGPost | null>(null);
  const [statModal, setStatModal] = useState<{ label: string; value: string; color: string; data: { date: string; v: number | null; libelle?: string }[]; unit?: string; pas?: number } | null>(null);
  const [contentSubTab, setContentSubTab] = useState<'posts' | 'stories'>('posts');
  const [storiesInnerTab, setStoriesInnerTab] = useState<'story' | 'sequences'>('story');
  const [selectedSequence, setSelectedSequence] = useState<any | null>(null);
  const [selectedStory, setSelectedStory] = useState<any | null>(null);

  // Trois modales dans ce meme composant (post, sequence, story). Elles ne
  // s'ouvrent pas ensemble en pratique, mais l'ordre ci-dessous garantit un
  // comportement previsible si un chemin les superposait : on ne ferme que la
  // couche affichee, jamais les trois d'un coup.
  useEscapeKey(() => {
    if (selectedStory) { setSelectedStory(null); return; }
    if (selectedSequence) { setSelectedSequence(null); return; }
    if (selectedPost) setSelectedPost(null);
  }, !!selectedPost || !!selectedSequence || !!selectedStory);

  const { data: sequencesData } = useQuery({
    queryKey: ['story-sequences-stats-all', profileId],
    // Sans profileId (élève consultant sa propre page), ne pas envoyer "?profileId=undefined"
    // — resolveProfileId (story-sequences-stats/route.ts) ne retombe sur user.id que si le
    // param est absent, pas s'il vaut littéralement la string "undefined".
    queryFn: () => fetch(profileId ? `/api/instagram/story-sequences-stats?profileId=${profileId}` : '/api/instagram/story-sequences-stats').then(r => r.json()),
    staleTime: 60 * 1000,
  });
  const storySequences: any[] = sequencesData?.sequences ?? [];

  // Toutes les stories du profil, avec ou sans CTA — réutilise GET /api/client/stories
  // (déjà utilisée dans Gérer mes liens, pas de nouvelle route).
  const { data: allStoriesData, isLoading: storiesLoading } = useQuery({
    queryKey: ['stories', profileId],
    // Sans profileId (élève consultant sa propre page), ne pas envoyer "?profileId=undefined"
    // — l'API resolveProfileId retombe sur user.id uniquement si le param est absent, pas
    // s'il vaut littéralement la string "undefined".
    queryFn: () => fetch(profileId ? `/api/client/stories?profileId=${profileId}` : '/api/client/stories').then(r => r.json()),
    enabled: contentSubTab === 'stories',
    staleTime: 60 * 1000,
  });
  const allStories: any[] = allStoriesData?.stories ?? [];

  // « Connecte ton compte » etait faux quand le compte EST connecte mais que son
  // jeton est mort : on renvoyait l'eleve faire une action deja faite, sans jamais
  // lui dire que la connexion etait rompue (constate sur un compte revoque le
  // 2026-08-27). Les deux situations demandent la meme action — se reconnecter —
  // mais pas le meme message : l'une est un demarrage, l'autre une panne.
  if (!ig) return <Empty msg={
    connexionCassee
      ? "La connexion à Instagram s'est interrompue : la collecte est arrêtée. Reconnecte le compte depuis les paramètres pour la relancer."
      : periodIndex && periodIndex > 0
        ? "Pas de données Instagram pour cette période."
        : "Connecte ton compte Instagram pour voir les stats."
  } />;

  // Valeurs sur la période sélectionnée — filtre par vraie date calendaire (pas
  // .slice(-N), qui suppose que chartData s'arrête pile aujourd'hui) et somme réelle
  // (pas une estimation proportionnelle valeur30j × période/30, incohérente dès que
  // "période" n'est plus un compte de jours fixe — un mois calendaire fait 28 à 31
  // jours, pas "30" exactement).
  const { periodStart: igPeriodStart, periodEnd: igPeriodEnd } = getPeriodWindow(periodIndex ?? 0, period === 7 ? 'week' : 'month');
  // En mode "depuis connexion", ig.chartData est déjà borné [connectedAt, aujourd'hui]
  // par le fetch — ne pas re-clipper avec la fenêtre calendaire du mois/semaine en cours.
  // Etiquette de fenetre des cartes. En mode All-Time elles affichaient « 30j » alors
  // que le bandeau annonce « All-Time » et que les graphiques couvrent toute la periode
  // depuis la connexion — meme defaut que celui corrige cote YouTube le 2026-08-21.
  const igEtiquettePeriode = sinceConnection ? 'total' : `${period}j`;

  // Fenetre des deux cartes de portee (abonnes touches / part de non-abonnes).
  // Elle est FIXE et ne suit pas la navigation par periodes : 30 jours en temps
  // normal, 12 mois en All-Time. Lue depuis la reponse de l'API et non deduite
  // cote ecran, pour que le badge affiche ce qui a ete mesure et non ce qui a ete
  // demande (la route plafonne a 366 jours).
  const fenetrePorteeJours = ig.fenetreJours ?? 30;
  // ⚠️ Le libelle decrit la ligne `analytics_ig_periodes` d'ou viennent REELLEMENT les
  // deux chiffres, pas `fenetreJours`, qui est calcule par une autre requete. En
  // All-Time les deux divergent, et l'infobulle annoncait « les 30 derniers jours »
  // au-dessus d'un taux mesure sur toute la periode depuis la connexion (signale par
  // Chris le 2026-09-02). Un libelle qui decrit une autre fenetre que le chiffre
  // qu'il accompagne est faux, pas imprecis.
  const libelleFenetrePortee = (() => {
    if (ig.porteeDebut && ig.porteeFin) {
      const f = (iso: string) => new Date(iso + 'T12:00:00Z')
        .toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' });
      return `la période du ${f(ig.porteeDebut)} au ${f(ig.porteeFin)}`;
    }
    // Repli quand la ligne de periode manque : on decrit alors ce que la route a
    // interroge, ce qui reste vrai.
    return fenetrePorteeJours >= 360 ? 'les 12 derniers mois' : `les ${fenetrePorteeJours} derniers jours`;
  })();
  const igDaysSlice = sinceConnection ? ig.chartData : ig.chartData.filter(d => {
    const t = new Date(d.date + 'T12:00:00Z').getTime();
    return t >= igPeriodStart.getTime() && t <= igPeriodEnd.getTime();
  });
  const igReachP = igDaysSlice.reduce((s, d) => s + d.reach, 0);
  // Bornes qui portent RÉELLEMENT un nombre d'abonnés, pas les bornes de la période.
  // `ig_followers` n'est plus écrit que sur la ligne du jour depuis le 2026-08-30 : une
  // journée comblée par le seul rattrapage n'en porte pas. Avec `?? 0` sur les bornes,
  // un tel jour en début ou en fin de période donnait un delta absurde (tout le compte
  // gagné, ou tout le compte perdu, en une journée). Même garde que le calcul
  // équivalent dans app/api/instagram/stats/route.ts.
  const igAbonnesConnusP = igDaysSlice.filter(d => d.followerCount != null);
  // ⚠️ La carte et son badge lisaient DEUX SOURCES qui ne s'arretent pas au meme jour.
  //
  // Le grand chiffre affiche `abonnesAujourdHui`, le compteur live de l'API. Le badge,
  // lui, prenait la derniere valeur de la SERIE STOCKEE, qui s'arrete a la derniere
  // journee ecrite par le cron — hier, tant que la journee du jour n'est pas close.
  //
  // Constate le 2026-09-02 : serie 253 (9 juin) -> 255 (1er sept), badge « +2 », a cote
  // d'un compte affiche a 254. Les deux nombres etaient exacts SUR LEUR PROPRE SOURCE,
  // et se contredisaient a trois centimetres l'un de l'autre. La courbe qui culmine a
  // 255 est juste, elle aussi : le compte y est reellement passe avant de redescendre.
  //
  // Le delta se termine donc sur la valeur AFFICHEE des que la periode inclut
  // aujourd'hui. Sur une periode PASSEE, le compteur live n'a rien a y faire : on
  // garde la derniere valeur de la serie, qui est la bonne fin de cette periode-la.
  const periodeInclutAujourdHui = sinceConnection || (periodIndex ?? 0) === 0;
  const igDebutAbonnesP = igAbonnesConnusP[0]?.followerCount ?? null;
  const igFinAbonnesP = periodeInclutAujourdHui && abonnesAujourdHui != null
    ? abonnesAujourdHui
    : (igAbonnesConnusP.length >= 2 ? igAbonnesConnusP[igAbonnesConnusP.length - 1]!.followerCount! : null);
  const igFollowerDeltaP = igDebutAbonnesP != null && igFinAbonnesP != null
    ? igFinAbonnesP - igDebutAbonnesP
    : 0;
  // Vraie somme des interactions (likes+comments+saves+shares) — distincte des comptes
  // ENGAGÉS (accountsEngaged, un nombre de personnes), qui était utilisée par erreur
  // pour le KPI "Interactions posts" ET pour engRate, alors que ces deux métriques
  // Meta sont différentes par définition (cf. bug ig_accounts_engaged/
  // ig_total_interactions identiques corrigé le 2026-07-06 — même confusion ici,
  // côté lecture cette fois plutôt que côté collecte).
  const igInteractionsP = igDaysSlice.reduce((s, d) => s + (d.totalInteractions ?? 0), 0);
  // Visites de profil sur la periode. Collectee depuis le 2026-08-22 : les journees
  // anterieures valent null, d'ou le `?? 0` qui les traite comme sans consultation
  // plutot que de casser la somme. Le rattrapage les comble progressivement.
  const igProfileViewsP = igDaysSlice.reduce((s, d) => s + ((d as any).profileViews ?? 0), 0);


  const engRate = igReachP > 0 ? pct(igInteractionsP, igReachP) : 0;
  // Nombre RÉEL de comptes abonnés uniques touchés (pas un ratio recalculé depuis un
  // total de reach mêlé abonnés+non-abonnés) — confirmé via test direct API Meta :
  // period=days_28 + metric_type=total_value + breakdown=follow_type renvoie le vrai
  // décompte de comptes abonnés distincts touchés sur toute la fenêtre. Pas de
  // fallback approximatif (somme quotidienne du reach / abonnés) : cette approximation
  // double-compte les abonnés vus plusieurs jours et affichait des valeurs trompeuses
  // en period historique (ex: 79% en juin alors que la vraie donnée dédupliquée
  // n'existe que pour la fenêtre glissante actuelle) — null (N/D) explicite plutôt
  // qu'un chiffre qui a l'air fiable mais ne l'est pas.
  // Denominateur : la moyenne d'abonnes de la periode quand elle est connue (periode
  // close, lue dans analytics_ig_periodes), le compte actuel sinon. Diviser un reach
  // de juin par les abonnes d'aujourd'hui ferait bouger un taux passe tout seul.
  const reachRate = ig.reach28dDedupFollowers != null
    ? pct(ig.reach28dDedupFollowers, ig.abonnesPeriode ?? ig.followers)
    : null;
  // % de non-abonnés parmi le reach dédupliqué (comptes uniques), pas parmi les vues
  // (viewsFollowerBreakdown compte les revisionnages, incohérent avec le graphique
  // "Reach Non-Followers" juste en dessous qui utilise reach, pas views) — confirmé
  // via test direct API : les deux métriques divergent fortement sur ce compte.
  // Denominateur : la portee TOTALE de la periode, telle que Meta la mesure — pas la
  // somme des deux seaux. Les deux different : un compte qui etait non-abonne puis
  // s'abonne dans la fenetre est compte dans les DEUX seaux, alors que la portee totale
  // le dedoublonne. Mesure du 2026-09-01, periode All-Time du profil de test : 207 de
  // portee totale contre 209 en sommant les seaux.
  //
  // C'est ce que l'infobulle de la carte annonce depuis toujours (« celle-ci se rapporte
  // a ta portee totale »), et ce que calcule deja l'autre lecteur de la meme donnee,
  // /api/instagram/periodes — deux formules pour une seule metrique, alignees ici.
  //
  // Repli sur la somme quand la portee totale manque : mieux vaut un denominateur
  // approche qu'aucun taux.
  const viralPct = (ig.reach28dDedupFollowers != null && ig.reach28dDedupNonFollowers != null)
    ? pct(ig.reach28dDedupNonFollowers, ig.reachTotalPeriode ?? (ig.reach28dDedupFollowers + ig.reach28dDedupNonFollowers))
    : (ig.viewsFollowerBreakdown
      ? pct(ig.viewsFollowerBreakdown.nonFollower, ig.viewsFollowerBreakdown.follower + ig.viewsFollowerBreakdown.nonFollower)
      : null);

  // Filtre par vraie date calendaire (igPeriodStart/igPeriodEnd déjà calculés
  // ci-dessus), pas .slice(-N) qui suppose chartData aligné sur aujourd'hui, ni un
  // cutoff en ms qui suppose un compte de jours fixe (incohérent avec un mois
  // calendaire de longueur variable).
  const cutoffIg = igPeriodStart;

  // igDays : TOUS les jours calendaires de la période (lundi→dimanche / 1er→dernier
  // jour du mois), pas seulement ceux ayant déjà une ligne en base — sinon en début de
  // semaine (ex: lundi seul collecté), le graphique n'affiche qu'un point isolé au
  // milieu au lieu de tous les jours de l'axe avec juste ce point rempli (même défaut
  // déjà corrigé sur Business micro). igDaysSlice reste utilisé pour les totaux/sommes
  // (igReachP, igEngagedP...), qui ne doivent pas compter de faux zéros sur les jours
  // sans donnée.
  const igDayByDate = new Map(igDaysSlice.map(d => [d.date, d]));
  const igDaysNoDataSet = new Set<string>();
  // ⚠️ `sinceConnection ? igDaysSlice : ...` — la meme garde que `ytDays` cote YouTube,
  // qui l'avait deja et pas nous.
  //
  // `igDaysSlice` est bien debride en All-Time (branche plus haut), mais cette boucle de
  // completion, elle, rebornait tout sur `igPeriodStart/igPeriodEnd`, c'est-a-dire sur la
  // periode du SELECTEUR. La courbe « Reach par jour » ne tracait donc qu'un mois sous
  // l'etiquette « Depuis la connexion », et lequel dependait d'ou l'on venait : septembre
  // en arrivant depuis le mois en cours (1 seul jour de donnees), juin en arrivant depuis
  // M-3. La carte a cote annoncait 503 personnes.
  //
  // Corriger la donnee sans corriger les BORNES ne suffit pas : c'est exactement ce que
  // dit deja le commentaire de `ytDays` (« sinon ytDays reste clippe malgre le fix de
  // ytDaysRaw plus haut »), et c'est le meme defaut qui vivait dans TabOverviewV2.
  // Mesure a l'ecran le 2026-09-01, avant correction.
  //
  // En All-Time on ne complete pas : `ig.chartData` porte deja tous les jours de la
  // fenetre, servie par le fetch sur [integrations_ready_at, aujourd'hui].
  const igDays: typeof igDaysSlice = sinceConnection ? igDaysSlice : (() => {
    const days: typeof igDaysSlice = [];
    let d = igPeriodStart;
    while (d.getTime() <= igPeriodEnd.getTime()) {
      // parisDateStr (pas toISOString) : igPeriodStart/End sont des instants UTC
      // correspondant à minuit/23:59:59.999 HEURE DE PARIS (getPeriodWindow), pas
      // minuit UTC — toISOString().split('T')[0] donnait le jour UTC, décalé d'un
      // jour civil Paris autour de 22h-minuit UTC (ex: 30 juin fantôme en tête du
      // mois de juillet).
      const iso = parisDateStr(d);
      const existing = igDayByDate.get(iso);
      if (!existing) igDaysNoDataSet.add(iso);
      days.push(existing ?? { date: iso, reach: 0, followerCount: null, accountsEngaged: 0, totalInteractions: 0, websiteClicks: 0, reachFollower: null, reachNonFollower: null } as any);
      d = parisAddDays(d, 1);
    }
    return days;
  })();

  // Série "reach" nettoyée pour le graphique carte "Reach par jour" — igDays pose
  // reach:0 (vrai zéro numérique) sur les jours sans ligne en base, pas null. Passée
  // brute à Recharts, ça trace une fausse portion plate à 0 (écrasée visuellement par
  // l'échelle du vrai reach) ET fait poser le point pulsant sur un jour sans vraie
  // donnée (lastRealPointKey traite tout nombre, même 0, comme "réel"). Même pattern
  // que pubsByDay/interactionsByDay/igStatSeries['Reach'] plus bas dans ce fichier.
  const igDaysForChart = igDays.map(d => ({
    ...d,
    reach: igDaysNoDataSet.has(d.date) ? (null as any) : d.reach,
    // Ligne existe (pas dans igDaysNoDataSet) mais reach pas encore collecté par le
    // cron pour ce jour précis (voir reachPending, stats/route.ts) — point creux/gris
    // plutôt qu'un 0 muet, distinct d'un jour vraiment sans ligne (coupé ci-dessus).
    pending: !igDaysNoDataSet.has(d.date) && (d as any).reachPending,
  }));

  // Publications par jour depuis les vrais timestamps des posts
  // ⚠️ En All-Time, `cutoffIg` vaut le MOIS EN COURS : `getPeriodWindow` ignore
  // `sinceConnection`. Cette carte comptait donc les publications du mois courant sous
  // l'étiquette « total ». Même défaut que celui corrigé dans Vue générale et sur la
  // courbe de reach — la donnée était débridée, la BORNE ne l'était pas.
  //
  // On ne peut pas se contenter de compter tout `ig.posts` en All-Time : cette liste
  // contient les posts qui ont un INSTANTANÉ dans la fenêtre, pas ceux qui y ont été
  // PUBLIÉS. Un post de février est encore photographié chaque jour, il y figure donc.
  // La borne reste donc une date de publication, celle de la mise en route.
  // Meme regle qu'en Vue generale : en All-Time la borne est la MISE EN ROUTE, pour
  // rester alignee sur les cartes voisines (reach, interactions) qui comptent toutes
  // l'activite depuis l'inscription.
  //
  // La borne est une date de PUBLICATION, jamais la simple presence dans `ig.posts` :
  // cette liste contient les posts qui ont un INSTANTANE dans la fenetre, pas ceux
  // qui y ont ete publies. Un post de fevrier est encore photographie chaque jour, il
  // y figure donc — sans avoir ete publie sur la periode.
  const debutPublicationsIg = sinceConnection && allTimeStart ? new Date(allTimeStart) : cutoffIg;
  const dansLaFenetrePubIg = (t: number) => t >= debutPublicationsIg.getTime();
  const estReel = (p: any) => p.type === 'REEL' || p.type === 'REELS' || p.type === 'VIDEO';
  const publicationsIg = ig.posts.filter(p => dansLaFenetrePubIg(new Date(p.timestamp).getTime()));
  const nbReels = publicationsIg.filter(estReel).length;
  const nbPosts = publicationsIg.length - nbReels;
  // Stories connues seulement depuis le premier passage du cron : elles expirent en
  // 24 h et ne se rattrapent pas.
  const nbStoriesIg = (stories ?? []).filter((s: any) =>
    dansLaFenetrePubIg(new Date(s.posted_at).getTime())).length;
  const postsInPeriod = nbPosts + nbReels + nbStoriesIg;
  const pubsByDay = igDays.map(d => ({
    date: d.date,
    v: igDaysNoDataSet.has(d.date) ? (null as any) : ig.posts.filter(p => parisDateStr(new Date(p.timestamp)) === d.date).length,
  }));

  // Interactions par jour = vraie donnée quotidienne (ig_total_interactions en DB,
  // même source que le total igEngTotal du haut). Auparavant reconstruit depuis les
  // posts PUBLIÉS ce jour-là × leur totalInteractions lifetime — faux sur deux plans :
  // ça ne capture que les jours de publication (graphique vide la plupart du temps)
  // et confond "interactions cumulées du post depuis toujours" avec "interactions
  // survenues ce jour précis".
  const interactionsByDay = igDays.map(d => ({
    date: d.date,
    v: igDaysNoDataSet.has(d.date) ? (null as any) : (d.totalInteractions ?? 0),
  }));

  const igStatSeries: Record<string, { data: { date: string; v: number }[]; color: string; unit?: string; nature?: NatureSerie }> = {
    'Publications': { data: pubsByDay, color: IG_COLOR },
    'Reach': { data: igDays.map(d => ({ date: d.date, v: igDaysNoDataSet.has(d.date) ? (null as any) : d.reach })), color: 'var(--accent-brand)' },
    // `?? null` et non `?? 0` : `igDaysNoDataSet` ne contient que les jours SANS LIGNE.
    // Une ligne qui existe mais dont `ig_followers` est absent (journée comblée par le
    // seul rattrapage, qui n'écrit plus l'état du compte depuis le 2026-08-30) passait
    // donc par ce `??` et dessinait une chute à zéro au milieu de la courbe. Un trou dit
    // « on ne sait pas », un zéro affirme que le compte n'a plus aucun abonné.
    // NIVEAU, pas comptage : c'est l'effectif du compte, pas un gain quotidien.
    // Regroupe par somme, un point mensuel afficherait trente fois l'audience.
    'Abonnés': { data: igDays.map(d => ({ date: d.date, v: igDaysNoDataSet.has(d.date) ? (null as any) : (d.followerCount ?? (null as any)) })), color: IG_COLOR, nature: 'niveau' },
    'Interactions posts': { data: interactionsByDay, color: GREEN },
    // Detail jour par jour des deux cartes de portee.
    //
    // ⚠️ Ces courbes ne se somment PAS au chiffre de la carte, et c'est normal : la
    // carte est dediupliquee sur toute sa fenetre (une personne comptee une fois),
    // la courbe montre chaque journee separement (la meme personne compte a nouveau
    // si elle revient le lendemain). Sur 28 jours, 121 comptes uniques contre 143
    // en cumul journalier — mesure du 2026-08-26.
    //
    // On montre donc des effectifs, jamais un pourcentage journalier : un taux
    // quotidien serait en contradiction visible avec l'en-tete de la carte.
    //
    // null et non 0 avant le 2026-08-22 : la ventilation n'etait pas collectee, la
    // courbe doit faire un trou plutot qu'affirmer « personne ».
    'Abonnés touchés': { data: igDays.map(d => ({
      date: d.date,
      v: igDaysNoDataSet.has(d.date) ? (null as any) : ((d as any).reachFollower ?? null),
    })), color: 'var(--accent-brand)' },
    'Non-abonnés touchés': { data: igDays.map(d => ({
      date: d.date,
      v: igDaysNoDataSet.has(d.date) ? (null as any) : ((d as any).reachNonFollower ?? null),
    })), color: GREEN },
    // Serie de la nouvelle carte. « Abonnés nets » garde la sienne : elle alimente
    // desormais la modale ouverte depuis le BADGE de la carte Abonnés.
    'Visites de profil': { data: igDays.map(d => ({
      date: d.date,
      // null (pas 0) avant le 2026-08-22 : la metrique n'etait pas collectee, la
      // courbe doit faire un trou plutot que d'affirmer « aucune consultation ».
      v: igDaysNoDataSet.has(d.date) ? (null as any) : ((d as any).profileViews ?? null),
    })), color: IG_COLOR },
    'Abonnés nets': { data: (() => {
      // Delta brut jour J vs J-1 (nombre entier réel, pas de lissage) — très bruyant
      // sur un petit compte (±1-2/jour), affiché en barres plutôt qu'une ligne pour
      // rester honnête sur le fait que chaque jour est une valeur indépendante.
      // Jours futurs (igDaysNoDataSet) : v=null explicite — sans cette garde, le ?? prev
      // du calcul de delta reconduit la dernière valeur connue et retombe sur 0 (curr-prev)
      // au lieu de couper la ligne, la faisant continuer plate jusqu'à fin de période.
      return igDays.map((d, i, arr) => {
        if (igDaysNoDataSet.has(d.date)) return { date: d.date, v: null as any };
        // Ligne présente mais sans nombre d'abonnés (journée comblée par le seul
        // rattrapage) : on ne peut pas calculer de variation, et « 0 » affirmerait à
        // tort que le compte n'a ni gagné ni perdu personne ce jour-là.
        if (d.followerCount == null) return { date: d.date, v: null as any };
        const prev = arr[i - 1]?.followerCount ?? d.followerCount ?? 0;
        const curr = d.followerCount ?? prev;
        return { date: d.date, v: i === 0 ? 0 : (curr - (prev ?? curr)) };
      });
    // Couleur decidee sur le solde REELLEMENT affiche, pas sur followsUnfollows30d :
    // cette derniere vient de ig_follows_unfollows, une colonne vide sur les 107 jours
    // du profil de test (Meta ne renvoie plus cette metrique). Elle valait donc
    // toujours 0, la condition `>= 0` etait toujours vraie, et la courbe restait VERTE
    // meme sur une periode ou le compte perdait des abonnes (constate le 2026-08-22).
    })(), color: igFollowerDeltaP >= 0 ? GREEN : RED },
    "Taux d'engagement": { data: igDays.map(d => ({ date: d.date, v: igDaysNoDataSet.has(d.date) ? (null as any) : (d.reach > 0 ? Math.round((d.totalInteractions ?? 0) / d.reach * 100 * 10) / 10 : 0) })), color: engRate > 5 ? GREEN : engRate > 2 ? AMBER : RED, unit: '%' },
    // Pas d'entrée "Followers reach rate" ici : Meta n'expose aucun équivalent
    // dédupliqué PAR JOUR (seulement sur la fenêtre glissante totale de 28 jours) —
    // un calcul reach_du_jour/abonnés_totaux serait une approximation non fiable,
    // ce qu'on ne veut afficher nulle part sur ce KPI (cf. reachRate ci-dessus).
    // Pas d'entrée "Reach Non-Followers" ici sur demande explicite : juste le chiffre
    // du mois/semaine dans la carte KPI, pas de graphique jour par jour.
    // Viralité et Clics lien bio : pas de série jour par jour disponible via Meta
  };

  // NIVEAU et non comptage : c'est l'effectif du compte. Le sommer afficherait
  // trente fois l'audience sur un point mensuel.
  const abonnesCourbe = regrouperSerieAffichee(
    igDays.map(d => ({ date: d.date, v: igDaysNoDataSet.has(d.date) ? null : ((d.followerCount ?? null) as number | null) })),
    'niveau',
  );

  const openStatModal = (label: string, value: string) => {
    const s = igStatSeries[label];
    if (!s) return;
    const { data, pas } = regrouperSerieAffichee(s.data, s.nature);
    setStatModal({ label, value, color: s.color, data, unit: s.unit, pas });
  };

  // Online followers heatmap — matrix[dayIndex][hourIndex], dayIndex 0=Dim (format API)
  let heatmapRows: { name: string; cells: { label: string; value: number }[] }[] = [];
  const days = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  const hours = Array.from({ length: 24 }, (_, i) => `${i}h`);
  const ofMatrix = ig.onlineFollowers?.heatmap;
  if (ofMatrix && Array.isArray(ofMatrix) && ofMatrix.length === 7) {
    const apiOrder = [1, 2, 3, 4, 5, 6, 0];
    heatmapRows = days.map((day, di) => ({
      name: day,
      cells: hours.map((h, hi) => ({
        label: `${day} ${h}`,
        value: ofMatrix[apiOrder[di]]?.[hi] ?? 0,
      })),
    }));
  }


  return (
    <div className="stack">
      {/* Ligne 1 — 4 stats audience */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        {[
          // « total » plutot que « all time » : c'est un compteur actuel, pas un cumul
          // sur une periode, et le reste de la plateforme dit « total » (cf. la carte
          // « Abonnés IG » de la vue generale).
          // Le solde net est affiche en BADGE sur cette carte plutot que sur une carte
          // dediee : les deux parlent d'abonnes, et la case liberee accueille les vues
          // du profil — l'etape charniere du tunnel, qui n'etait affichee nulle part
          // (demande de Chris, 2026-08-22). Meme principe que la carte YouTube, qui
          // porte deja « +0 (+0 -0) » a cote de son chiffre.
          { label: 'Abonnés', value: abonnesAujourdHui != null ? fmt(abonnesAujourdHui) : '—', sub: "aujourd'hui", color: 'var(--ink)', key: 'Abonnés', badge: igFollowerDeltaP },
          { label: 'Publications', value: fmt(postsInPeriod),
            sub: `Posts ${fmt(nbPosts)} · Reels ${fmt(nbReels)} · Stories ${fmt(nbStoriesIg)}`,
            color: IG_COLOR, key: 'Publications' },
          { label: 'Reach · personnes', value: fmt(igReachP), sub: igEtiquettePeriode, color: 'var(--ink)', key: 'Reach' },
          { label: 'Interactions posts', value: fmt(igInteractionsP), sub: igEtiquettePeriode, color: 'var(--ink)', key: 'Interactions posts' },
        ].map(s => (
          <div key={s.key} onClick={s.key ? () => openStatModal(s.key!, s.value) : undefined} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px', cursor: s.key ? 'pointer' : 'default', transition: 'background .15s' }}
            onMouseEnter={e => { if (s.key) e.currentTarget.style.background = 'var(--surface-2)'; }}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--surface)'}>
            <div style={{ marginBottom: 8 }}>
              <span className="eyebrow-sm" style={{ color: 'var(--muted)' }}>{s.label}</span>
              {s.sub && <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--faint)', marginLeft: 5 }}>{s.sub}</span>}
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.color, lineHeight: 1, display: 'flex', alignItems: 'baseline', gap: 7 }}>
              {s.value}
              {/* Solde de la periode, en petit a cote du total. Zero n'a pas de signe :
                  « +0 » annoncerait un gain nul comme un gain. */}
              {/* Cliquable : ouvre la courbe des abonnes nets, qui avait sa propre carte
                  avant. Le stopPropagation evite d'ouvrir en meme temps la modale de la
                  carte Abonnés, qui est cliquable elle aussi. */}
              {(s as any).badge != null && (
                <span
                  onClick={(e) => { e.stopPropagation(); openStatModal('Abonnés nets', `${igFollowerDeltaP >= 0 ? '+' : ''}${fmt(igFollowerDeltaP)}`); }}
                  title="Voir l'évolution jour par jour"
                  style={{ fontSize: 13, fontWeight: 700, cursor: 'pointer', color: (s as any).badge > 0 ? GREEN : (s as any).badge < 0 ? RED : 'var(--faint)' }}>
                  {(s as any).badge > 0 ? '+' : ''}{fmt((s as any).badge)}
                  <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--faint)', marginLeft: 3 }}>{igEtiquettePeriode}</span>
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
      {/* Ligne 2 — 4 stats performance */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        {[
          // Remplace « Abonnés nets », desormais en badge sur la carte Abonnés.
          { label: 'Visites de profil', value: fmt(igProfileViewsP), sub: igEtiquettePeriode, color: 'var(--ink)', key: 'Visites de profil' },
          { label: "Taux d'engagement", value: fmtPct(engRate), sub: 'interactions / reach', color: engRate > 5 ? GREEN : engRate > 2 ? AMBER : RED, key: "Taux d'engagement" },
          // « / total » etait ambigu : on ne savait pas si le denominateur etait le
          // reach ou le nombre d'abonnes. C'est le nombre d'ABONNES, la ou la carte
          // voisine divise par le REACH — d'ou l'impression que les deux
          // pourcentages devraient sommer a 100 % (question de Chris, 2026-08-26).
          // « 30j » explicite : ces deux cartes interrogent une fenetre FIXE de
          // 30 jours (stats/route.ts) et ne suivent pas la navigation par periodes.
          // Sans la mention, elles semblaient repondre a la periode selectionnee.
          //
          // Elles ne sont d'ailleurs pas comparables d'une periode a l'autre : la
          // deduplication fait monter le taux avec la longueur de la fenetre
          // (9 % sur 7j, 43 % sur 28j, 65 % sur 365j sur le compte de test), car on
          // accumule des personnes distinctes. Une fenetre fixe est donc le choix le
          // plus lisible ici.
          { label: 'Abonnés touchés', key: 'Abonnés touchés', value: reachRate !== null ? fmtPct(reachRate) : 'N/D', sub: reachRate !== null ? `sur tes ${fmt(ig.abonnesPeriode ?? ig.followers)} abonnés` : 'seuil Meta non atteint', color: reachRate !== null ? 'var(--ink)' : 'var(--faint)', tooltip: `Sur ${libelleFenetrePortee}, ${reachRate !== null ? fmtPct(reachRate) : '—'} de tes abonnés ont vu au moins un de tes contenus.\n\nChaque abonné est compté UNE SEULE FOIS, même s'il a vu dix posts : c'est un nombre de personnes, pas de vues. Le total ne peut donc jamais dépasser 100 %.\n\nÀ retenir en changeant de période : ce taux monte mécaniquement avec la durée (9 % sur 7 jours, 43 % sur 30, 65 % sur un an), parce qu'on accumule des personnes différentes. Une semaine et un mois ne se comparent donc pas directement.${sinceConnection ? '\n\nEn « Depuis la connexion », la fenêtre est plafonnée à 12 mois : Instagram ne fournit pas cette répartition au-delà.' : ''}` },
          // Libelle et tooltip disaient « vues » alors que le calcul porte sur le
          // REACH (comptes uniques), choix delibere documente ligne ~1315. L'ecart
          // n'est pas cosmetique : mesure le 2026-08-26 sur le compte de test,
          // 53 % sur les vues contre 9,9 % sur le reach. Un utilisateur qui
          // recoupait avec Instagram trouvait 53 % et croyait la plateforme fausse.
          { label: 'Non-abonnés touchés', key: 'Non-abonnés touchés', value: viralPct !== null ? fmtPct(viralPct) : 'N/D', sub: viralPct !== null ? 'sur ton reach total' : 'seuil Meta non atteint', color: viralPct !== null ? (viralPct > 50 ? GREEN : AMBER) : 'var(--faint)', tooltip: `Sur ${libelleFenetrePortee}, ${viralPct !== null ? fmtPct(viralPct) : '—'} des comptes qui t'ont vu ne te suivaient pas encore.\n\nComme pour la carte voisine, chaque compte est compté UNE SEULE FOIS. Plus ce chiffre est élevé, plus tes contenus sortent de ton audience actuelle et touchent de nouvelles personnes.\n\nAttention, les deux cartes n'ont pas le même dénominateur : celle-ci se rapporte à ta portée totale, la voisine à ton nombre d'abonnés. Elles ne s'additionnent donc pas à 100 %.${sinceConnection ? '\n\nEn « Depuis la connexion », la fenêtre est plafonnée à 12 mois : Instagram ne fournit pas cette répartition au-delà.' : ''}` },
        ].map(s => (
          <div key={s.label}
            onClick={s.key ? () => openStatModal(s.key!, s.value) : undefined}
            title={(s as any).tooltip ?? undefined}
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px', cursor: (s.key || (s as any).tooltip) ? 'help' : 'default', transition: 'background .15s' }}
            onMouseEnter={e => { if (s.key) e.currentTarget.style.background = 'var(--surface-2)'; }}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--surface)'}>
            <div style={{ marginBottom: 8 }}>
              <span className="eyebrow-sm" style={{ color: 'var(--muted)' }}>{s.label}</span>
              {/* Badge de fenetre — porte par les seules cartes dont la fenetre est
                  FIXE et ne suit pas la navigation par periodes. Sans lui, elles
                  semblaient repondre a la periode choisie, et en All-Time elles
                  semblaient couvrir tout l'historique (retour de Chris, 2026-08-26). */}
              {(s as any).badge && (
                <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--muted)', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 5px', marginLeft: 6, whiteSpace: 'nowrap' }}>
                  {(s as any).badge}
                </span>
              )}
              {s.sub && <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--faint)', marginLeft: 5 }}>{s.sub}</span>}
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</div>
          </div>
        ))}
      </div>

      <HistoriquePortee
        profileId={profileId}
        granularite={typePeriodePour(period, sinceConnection)}
        debut={parisDateStr(igPeriodStart)}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <Card title="Reach par jour" sub={libelleFenetre(period, periodIndex ?? 0, sinceConnection, allTimeStart)}>
          {(() => {
            // Regroupe par semaine puis par mois au-dela des seuils : en All-Time, un
            // point par jour donnait 400 points sur une carte de 220 px. Le `pending`
            // devient un trou (null) avant regroupement, donc un point n'est vide que
            // si aucun de ses jours n'a ete collecte.
            const c = regrouperSerieAffichee(
              igDaysForChart.map(d => ({ date: d.date, v: (d as any).pending ? null : ((d.reach ?? null) as number | null) })),
              'comptage',
            );
            return (
              <AreaChart
                data={c.data.map(p => ({ date: p.date, reach: p.v, libelle: p.libelle }))}
                areas={[{ key: 'reach', label: 'Reach', color: 'var(--accent-brand)' }]}
                xKey="date" height={220} showWeekday={c.pas === 1 && period === 7}
              />
            );
          })()}
        </Card>
        <Card title="Abonnés / jour" sub={libelleFenetre(period, periodIndex ?? 0, sinceConnection, allTimeStart)}>
          <ResponsiveContainer width="100%" height={220} initialDimension={{ width: 600, height: 220 }}>
            <ReAreaChart data={abonnesCourbe.data.map(p => ({ date: p.date, followerCount: p.v, libelle: p.libelle }))} margin={{ top: 4, right: 8, left: 0, bottom: 24 }}>
              <defs>
                <linearGradient id="grad-ig-subs" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--accent-brand)" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="var(--accent-brand)" stopOpacity={0} />
                </linearGradient>
              </defs>
              {/* Intervalle calculé explicitement (pas 'preserveStartEnd') pour un espacement
                  régulier des labels de dates — même logique que le wrapper AreaChart. */}
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={abonnesCourbe.pas === 1 && period === 7 ? fmtAxisDateWithDay : fmtAxisDate} interval={graduationsDates(abonnesCourbe.data.length, period)} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} allowDecimals={false} domain={['auto', 'auto']} tickFormatter={(v: number) => v >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v))} width={40} />
              <Tooltip content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                return (
                  <div className="chart-tooltip">
                    {/* La PLAGE du point, pas sa seule date de debut : l'axe ne
                        porte qu'une date pour rester lisible, l'infobulle dit donc
                        ce que le point couvre vraiment. */}
                    <div className="chart-tooltip-label">{(payload[0].payload as any)?.libelle ?? label}</div>
                    <div className="chart-tooltip-row"><strong>{fmt(payload[0].value as number)}</strong><span style={{ color: 'var(--muted)', marginLeft: 4 }}>abonnés</span></div>
                  </div>
                );
              }} />
              <Area type="monotone" dataKey="followerCount" name="Abonnés" stroke="var(--accent-brand)" strokeWidth={2} fill="url(#grad-ig-subs)" dot={todayDotFactory('var(--accent-brand)', 'date', lastRealPointKey(abonnesCourbe.data.map(p => ({ date: p.date, followerCount: p.v })), 'date', 'followerCount'))} activeDot={{ r: 4, strokeWidth: 0, fill: 'var(--accent-brand)' }} isAnimationActive={false} />
            </ReAreaChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {heatmapRows.length > 0 && (
        <Card title="Abonnés en ligne" sub="Heure × Jour de la semaine">
          <Heatmap rows={heatmapRows} colLabels={hours} />
        </Card>
      )}

      <Card title={contentSubTab === 'posts' ? `Posts (${ig.posts.length})` : storiesInnerTab === 'story' ? `Stories (${allStories.length})` : `Séquences (${storySequences.length})`} sub="Cliquer pour le détail">
        {/* Onglets principaux — agrandis et passes a l'ardoise (demande de Chris,
            2026-08-25). L'ardoise marque l'onglet actif, usage deja prevu par la
            Regle de la Rarete Ardoise du systeme.
            Radius 7px : celui des boutons du systeme, pas d'angles droits. */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {(['posts', 'stories'] as const).map(t => (
            <button key={t} onClick={() => setContentSubTab(t)} style={{
              padding: '9px 20px', fontSize: 13, fontWeight: 600, borderRadius: 7, cursor: 'pointer',
              border: `1px solid ${contentSubTab === t ? 'var(--accent-brand)' : 'var(--border)'}`,
              background: contentSubTab === t ? 'var(--accent-brand)' : 'transparent',
              color: contentSubTab === t ? '#fff' : 'var(--ink-2)',
              transition: 'background .12s, border-color .12s, color .12s',
            }}>{t === 'posts' ? 'Posts' : 'Stories'}</button>
          ))}
        </div>

        {/* Sous-onglets — agrandis, arrondi conserve (demande de Chris,
            2026-08-25). Ils restent volontairement plus discrets que les onglets
            principaux : fond creme plutot qu'ardoise, pour que la hierarchie des
            deux niveaux se lise sans les confondre. */}
        {contentSubTab === 'stories' && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            {(['story', 'sequences'] as const).map(t => (
              <button key={t} onClick={() => setStoriesInnerTab(t)} style={{
                padding: '7px 16px', fontSize: 12, fontWeight: 600, borderRadius: 20, cursor: 'pointer',
                border: `1px solid ${storiesInnerTab === t ? 'var(--border)' : 'transparent'}`,
                background: storiesInnerTab === t ? 'var(--surface-2)' : 'transparent',
                color: storiesInnerTab === t ? 'var(--ink)' : 'var(--muted)',
                transition: 'background .12s, border-color .12s, color .12s',
              }}>{t === 'story' ? 'Story' : 'Séquences'}</button>
            ))}
          </div>
        )}

        {contentSubTab === 'posts' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
          {ig.posts.map(post => {
            const er = post.totalInteractions != null && post.reach ? fmtPct(pct(post.totalInteractions, post.reach)) : '—';
            const isReel = post.type === 'VIDEO' || post.type === 'REEL' || post.type === 'REELS';
            return (
              <div key={post.id} onClick={() => setSelectedPost(post)} style={{ cursor: 'pointer', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', transition: 'box-shadow .15s' }}
                onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,.08)')}
                onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}>
                <div style={{ position: 'relative', aspectRatio: '1', background: 'var(--surface-2)' }}>
                  {post.thumbnail
                    ? <img loading="lazy" decoding="async" src={post.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--faint)', fontSize: 24 }}>🎬</div>}
                  <div style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,.6)', color: '#fff', fontSize: 9, padding: '2px 5px', borderRadius: 4, fontWeight: 600 }}>
                    {isReel ? 'REEL' : post.type === 'CAROUSEL_ALBUM' ? 'CAROUSEL' : 'IMAGE'}
                  </div>
                </div>
                <div style={{ padding: '8px 10px' }}>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>{new Date(post.timestamp).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'Europe/Paris' })}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                    <span>❤️ {post.likes ?? '—'}</span>
                    <span>👁 {post.reach ?? '—'}</span>
                    <span>⚡ {er}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        ) : storiesInnerTab === 'story' ? (
          storiesLoading ? (
            // Squelette pendant le chargement. Avant, « Aucune story pour l'instant »
            // s'affichait des l'ouverture de l'onglet : on lisait une absence definitive
            // la ou la requete etait simplement en cours (demande de Chris, 2026-08-22).
            //
            // Meme grille et meme rapport de forme que les vraies vignettes : rien ne
            // bouge quand les donnees arrivent.
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                  <div style={{ aspectRatio: '1', background: 'var(--surface-2)', animation: 'squelette-pulse 1.4s ease-in-out infinite', animationDelay: `${i * 0.08}s` }} />
                  <div style={{ padding: '8px 10px' }}>
                    <div style={{ height: 9, width: '55%', borderRadius: 4, background: 'var(--surface-2)', animation: 'squelette-pulse 1.4s ease-in-out infinite', animationDelay: `${i * 0.08}s` }} />
                    <div style={{ height: 9, width: '80%', borderRadius: 4, background: 'var(--surface-2)', marginTop: 6, animation: 'squelette-pulse 1.4s ease-in-out infinite', animationDelay: `${i * 0.08}s` }} />
                  </div>
                </div>
              ))}
              <style>{`@keyframes squelette-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .45; } }`}</style>
            </div>
          ) : allStories.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--faint)', padding: '12px 0' }}>Aucune story pour l'instant.</div>
          ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
            {allStories.map(s => (
              <div key={s.id} onClick={() => setSelectedStory(s)} style={{ cursor: 'pointer', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', transition: 'box-shadow .15s' }}
                onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,.08)')}
                onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}>
                <div style={{ position: 'relative', aspectRatio: '1', background: 'var(--surface-2)' }}>
                  {s.storage_url
                    ? <img loading="lazy" decoding="async" src={s.storage_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--faint)', fontSize: 24 }}>📸</div>}
                  {(s.lm_keyword || s.calendly_short_url) && (
                    <div style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,.6)', color: '#fff', fontSize: 9, padding: '2px 5px', borderRadius: 4, fontWeight: 600 }}>CTA</div>
                  )}
                </div>
                <div style={{ padding: '8px 10px' }}>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>{new Date(s.posted_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'Europe/Paris' })}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                    <span>👁 {s.reach ?? '—'}</span>
                    <span>▶ {s.views ?? '—'}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          )
        ) : storySequences.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--faint)', padding: '12px 0' }}>Aucune séquence pour l'instant.</div>
        ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
          {storySequences.map(seq => (
            <div key={seq.id} onClick={() => setSelectedSequence(seq)} style={{ cursor: 'pointer', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', transition: 'box-shadow .15s' }}
              onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,.08)')}
              onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}>
              <div style={{ position: 'relative', aspectRatio: '1', background: 'var(--surface-2)' }}>
                {seq.thumbnail
                  ? <img loading="lazy" decoding="async" src={seq.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--faint)', fontSize: 24 }}>📸</div>}
                <div style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,.6)', color: '#fff', fontSize: 9, padding: '2px 5px', borderRadius: 4, fontWeight: 600 }}>
                  {seq.story_count} story{seq.story_count > 1 ? 'ies' : ''}
                </div>
              </div>
              <div style={{ padding: '8px 10px' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink)', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{seq.name}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                  <span>👁 {seq.first_reach ?? '—'} → {seq.cta_reach ?? '—'}</span>
                  <span>{seq.retention_pct != null ? `${seq.retention_pct}%` : '—'}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
        )}
      </Card>

      {/* Modal stat IG */}
      {statModal && (
        <ModalOverlay onClose={() => setStatModal(null)}>
          <div style={{ background: 'var(--surface)', borderRadius: 20, padding: '32px 32px 28px', width: '100%', maxWidth: 720, boxShadow: '0 24px 60px rgba(0,0,0,.18)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>{statModal.label}</div>
                {/* « {period} derniers jours » n'avait aucune garde All-Time : la
                    modale annoncait « 30 derniers jours » au-dessus d'une courbe qui
                    couvrait tout l'historique. Signale par Chris le 2026-09-02. */}
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Jour par jour · {libelleFenetre(period, periodIndex ?? 0, sinceConnection, allTimeStart)}</div>
              </div>
              <button onClick={() => setStatModal(null)} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--muted)', lineHeight: 1 }}>×</button>
            </div>
            <div style={{ fontSize: 36, fontWeight: 800, color: statModal.color, marginBottom: 20 }}>{statModal.value}</div>
            {/* Intervalle calculé explicitement (pas 'preserveStartEnd'/interval=0, qui
                laissent Recharts choisir selon la largeur de texte — espacement visuel
                irrégulier) — même formule que le composant partagé AreaChart
                (components/charts/AreaChart.tsx) : ~9 labels max en vue mois, tous les
                jours affichés en vue semaine. */}
            {(() => {
              const statModalTickInterval = period === 7 ? 0 : Math.max(1, Math.ceil(statModal.data.length / 9) - 1);
              return (
            <ResponsiveContainer width="100%" height={220} initialDimension={{ width: 600, height: 220 }}>
              {/* Rendu « abonnés nets » : axe pouvant descendre sous zéro, signe + explicite
                  dans l'infobulle, courbe linéaire sans lissage. Les DEUX cartes y ont
                  droit — Instagram et YouTube mesurent la même chose, il n'y a aucune
                  raison que l'une soit rendue différemment de l'autre. */}
              {(statModal.label === 'Abonnés nets' || statModal.label === 'Abonnés nets YT') ? (
                <ReAreaChart data={statModal.data} margin={{ top: 4, right: 8, left: 0, bottom: 24 }}>
                  <defs>
                    <linearGradient id="grad-ig-stat-modal-net" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={statModal.color} stopOpacity={0.2} />
                      <stop offset="95%" stopColor={statModal.color} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  {/* Meme rendu que le graphique « Abonnes nets / jour » de la section :
                      une grille en pointilles qui marque chaque graduation, zero compris,
                      et pas de ReferenceLine par-dessus (elle dessinait une barre blanche
                      en travers). Les deux montrent la meme metrique, ils doivent se
                      ressembler. */}
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={(statModal.pas ?? 1) === 1 && period === 7 ? fmtAxisDateWithDay : fmtAxisDate} interval={statModalTickInterval} />
                  {(() => {
                    const borne = borneAbonnesNets(statModal.data.map(d => d.v));
                    return (
                      <YAxis
                        tick={{ fontSize: 10, fill: 'var(--muted)' }}
                        axisLine={false}
                        tickLine={false}
                        width={30}
                        allowDecimals={false}
                        domain={domaineAbonnesNets(borne)}
                        ticks={graduationsAbonnesNets(borne)}
                      />
                    );
                  })()}
                  <Tooltip content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const v = payload[0].value as number;
                    return <div className="chart-tooltip"><div className="chart-tooltip-label">{label}</div><div className="chart-tooltip-row"><strong>{v >= 0 ? '+' : ''}{v}</strong></div></div>;
                  }} />
                  {/* type="linear" (pas "monotone") : relie les vrais points entiers sans
                      interpolation lissante — "monotone" créait le zigzag décimal trompeur
                      qu'on a retiré (moyenne mobile 3 jours arrondie). */}
                  <Area type="linear" dataKey="v" stroke={statModal.color} strokeWidth={2} fill="url(#grad-ig-stat-modal-net)" dot={todayDotFactory(statModal.color, 'date', lastRealPointKey(statModal.data, 'date', 'v'))} activeDot={{ r: 4, strokeWidth: 0, fill: statModal.color }} isAnimationActive={false} />
                </ReAreaChart>
              ) : (
                <ReAreaChart data={statModal.data} margin={{ top: 4, right: 8, left: 0, bottom: 24 }}>
                  <defs>
                    <linearGradient id="grad-ig-stat-modal" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={statModal.color} stopOpacity={0.2} />
                      <stop offset="95%" stopColor={statModal.color} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={(statModal.pas ?? 1) === 1 && period === 7 ? fmtAxisDateWithDay : fmtAxisDate} interval={statModalTickInterval} />
                  {/* Marge relative (pas domain auto strict) : sur "Abonnés", qui varie de
                      seulement 1-2 sur un petit compte, coller pile min/max fait remplir
                      toute la hauteur du graphique pour une variation de quelques unités —
                      une marge de 5% du range (ou 1 unité mini si le range est nul) évite
                      cet effet de "marche" trompeur. */}
                  {/* Borne basse jamais sous 0 si toutes les valeurs réelles sont positives
                      (compteur type Abonnés) — descend sous 0 seulement si de vraies valeurs
                      négatives existent dans la série. Rend le graphique responsive à la
                      forme réelle des données plutôt qu'une marge symétrique fixe. */}
                  {/* allowDecimals={false} sur les compteurs (Publications, Reach, Abonnés —
                      statModal.unit absent) : sans ça, Recharts génère des ticks "nice"
                      fractionnaires (0.5, 1.5...) sur les petites plages, absurdes pour des
                      quantités entières. Les métriques avec unit (%, s...) gardent les décimales. */}
                  <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={44} allowDecimals={statModal.unit != null} domain={([dataMin, dataMax]: readonly [number, number]) => { const range = dataMax - dataMin; const margin = range > 0 ? range * 0.15 : Math.max(1, Math.abs(dataMax) * 0.05); const lo = Math.floor(dataMin - margin); return [dataMin >= 0 ? Math.max(0, lo) : lo, Math.ceil(dataMax + margin)] as [number, number]; }} tickFormatter={(v: number) => v >= 1000 ? `${Math.round(v / 1000)}k` : (statModal.unit == null ? String(Math.round(v)) : String(v))} />
                  <Tooltip content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    return <div className="chart-tooltip"><div className="chart-tooltip-label">{(payload[0].payload as any)?.libelle ?? label}</div><div className="chart-tooltip-row"><strong>{fmt(payload[0].value as number)}{statModal.unit ?? ''}</strong></div></div>;
                  }} />
                  <Area type="monotone" dataKey="v" stroke={statModal.color} strokeWidth={2} fill="url(#grad-ig-stat-modal)" dot={todayDotFactory(statModal.color, 'date', lastRealPointKey(statModal.data, 'date', 'v'))} activeDot={{ r: 4, strokeWidth: 0, fill: statModal.color }} isAnimationActive={false} />
                </ReAreaChart>
              )}
            </ResponsiveContainer>
              );
            })()}
          </div>
        </ModalOverlay>
      )}

      {selectedPost && (
        <ModalOverlay onClose={() => setSelectedPost(null)} maxWidth={520}>
          <div style={{ background: 'var(--surface)', borderRadius: 14, padding: 24, width: '100%', maxHeight: '80vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{new Date(selectedPost.timestamp).toLocaleDateString('fr-FR', { dateStyle: 'long', timeZone: 'Europe/Paris' })}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                  {selectedPost.type === 'VIDEO' || selectedPost.type === 'REEL' || selectedPost.type === 'REELS' ? 'Reel' : selectedPost.type === 'CAROUSEL_ALBUM' ? 'Carousel' : 'Image'}
                </div>
              </div>
              <button onClick={() => setSelectedPost(null)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--muted)' }}>×</button>
            </div>
            {/* Meta ne conserve les insights média que 2 ans (doc officielle, voir
                docs/instagram-api-limitations.md) — un post plus vieux avec reach/views
                encore null n'est pas un bug de collecte, la donnée n'existe simplement
                plus côté Meta. Évite de laisser croire à un problème corrigeable. */}
            {(() => {
              const publishedMsAgo = Date.now() - new Date(selectedPost.timestamp).getTime();
              const overTwoYears = publishedMsAgo > 2 * 365 * 24 * 60 * 60 * 1000;
              const noMetrics = selectedPost.reach === null && selectedPost.views === null;
              return overTwoYears && noMetrics ? (
                <div style={{ fontSize: 11, color: 'var(--muted)', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', marginBottom: 16 }}>
                  ℹ️ Post publié il y a plus de 2 ans — Instagram ne conserve plus les statistiques détaillées au-delà de cette durée.
                </div>
              ) : null;
            })()}
            {selectedPost.caption && <div style={{ fontSize: 12, color: 'var(--ink-2)', marginBottom: 16, lineHeight: 1.5, borderLeft: '2px solid var(--border)', paddingLeft: 10 }}>{selectedPost.caption}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {[
                ['❤️ Likes', selectedPost.likes],
                ['💬 Commentaires', selectedPost.comments],
                ['👁 Reach · personnes', selectedPost.reach],
                ['🔖 Saves', selectedPost.saved],
                ['↗️ Partages', selectedPost.shares],
                ['▶️ Vues', selectedPost.views],
                ['⚡ Interactions', selectedPost.totalInteractions],
                // Presentes en base et deja remontees par la route, mais jamais
                // affichees : la modale en montrait sept sur les dix disponibles.
                // Meta ne les fournit que pour les posts NON-Reels, d'ou le filtre
                // ci-dessous qui masque celles qui sont absentes plutot que d'afficher
                // des tirets (2026-08-22).
                ['👤 Abonnés gagnés', selectedPost.follows],
                ['🔍 Visites de profil', selectedPost.profileVisits],
              ].filter(([, v]) => v !== null && v !== undefined)
               .map(([label, value], i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{value !== null && value !== undefined ? fmt(value as number) : '—'}</div>
                </div>
              ))}
              {(selectedPost.type === 'VIDEO' || selectedPost.type === 'REEL' || selectedPost.type === 'REELS') && <>
                {[
                  ['⏱ Watch time moyen', selectedPost.avgWatchTimeMs !== null ? fmtMs(selectedPost.avgWatchTimeMs!) : null],
                  // `!= null` (lache) et non `!== null` : une source qui ne transporte
                  // pas le champ rend `undefined`, que `!== null` laisse passer — et
                  // `undefined * 1000` vaut NaN, affiche « NaNs » a l'ecran.
                  ['⏳ Durée', selectedPost.dureeSec != null ? fmtMs(selectedPost.dureeSec * 1000) : null],
                  // Le temps de visionnage seul ne dit rien : « 17 s regardées » est
                  // excellent sur un Reel de 20 s et médiocre sur un de 60 s. C'est ce
                  // rapport-là qui compare deux contenus de longueurs différentes.
                  // Mesuré sur le compte de test : le Reel le PLUS regardé en secondes
                  // brutes (17,0 s) tombe à 48 % de rétention parce qu'il dure 35 s,
                  // derrière un Reel de 9 s retenu à 80 %.
                  ['📊 Rétention', selectedPost.dureeSec != null && selectedPost.dureeSec > 0 && selectedPost.avgWatchTimeMs != null
                    ? fmtPct(Math.round((selectedPost.avgWatchTimeMs / 1000) / selectedPost.dureeSec * 100))
                    : null],
                  ['⏩ Skip rate', selectedPost.skipRate !== null ? fmtPct(selectedPost.skipRate!) : null],
                ].map(([label, value], i) => (
                  <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
                    <div style={{ fontSize: 18, fontWeight: 700 }}>{value ?? '—'}</div>
                  </div>
                ))}
              </>}
            </div>
            <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border-soft)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                {[
                  ['ER', selectedPost.totalInteractions != null && selectedPost.reach ? fmtPct(pct(selectedPost.totalInteractions, selectedPost.reach)) : '—', 'Engagement rate'],
                  ['Save rate', selectedPost.saved != null && selectedPost.reach ? fmtPct(pct(selectedPost.saved, selectedPost.reach)) : '—', 'Saves / Reach'],
                  // Combien de vues il a fallu pour convertir UNE personne en abonné.
                  //
                  // ⚠️ Sera vide la plupart du temps, et ce n'est pas un defaut de
                  // collecte. `follows` est bien rendu par media par l'API Meta —
                  // verifie contre l'API reelle le 2026-09-03 sur le compte de test —
                  // mais Meta le RAMENE A ZERO au bout de quelques semaines. Mesure du
                  // meme jour : sur 32 posts, un seul portait encore un `follows` non
                  // nul, neuf etaient a zero, vingt-deux n'avaient rien de collecte.
                  //
                  // Le tiret est donc le bon affichage : a `follows` nul la division
                  // est indefinie, et repondre « 0 vue par abonne » serait faux. Un
                  // trou dit « on ne sait pas », un zero affirmerait quelque chose.
                  ['Vues / abonné',
                    selectedPost.follows ? fmt(Math.round((selectedPost.views ?? 0) / selectedPost.follows)) : '—',
                    'Vues par abonné gagné'],
                ].map(([label, value, desc], i) => (
                  <div key={i} style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
                    <div style={{ fontSize: 10, color: 'var(--muted)' }}>{label}</div>
                    <div style={{ fontSize: 20, fontWeight: 700 }}>{value}</div>
                    <div style={{ fontSize: 9, color: 'var(--faint)' }}>{desc}</div>
                  </div>
                ))}
              </div>
            </div>
            <a href={selectedPost.permalink} target="_blank" rel="noreferrer" style={{ display: 'block', marginTop: 14, textAlign: 'center', fontSize: 12, color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>
              Voir sur Instagram →
            </a>
          </div>
        </ModalOverlay>
      )}

      {selectedSequence && (
        <StorySequenceDetailModal profileId={profileId} sequence={selectedSequence} onClose={() => setSelectedSequence(null)} />
      )}

      {/* maxWidth porte par l'overlay et non par la carte : l'overlay centre son
          conteneur, or celui-ci faisait 760 px par defaut. Une carte de 480 px
          calee a gauche dans une boite de 760 px apparaissait decalee, pas
          centree (retour de Chris, 2026-08-25). */}
      {selectedStory && (
        <ModalOverlay onClose={() => setSelectedStory(null)} maxWidth={480}>
          <div style={{ background: 'var(--surface)', borderRadius: 14, padding: 24, width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>{new Date(selectedStory.posted_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' })}</div>
              <button onClick={() => setSelectedStory(null)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--muted)' }}>×</button>
            </div>
            {/* Toutes les metriques collectees, pas seulement reach et vues : la base en
                stocke douze et la route des SEQUENCES en exposait deja neuf, alors que
                celle des stories n'en remontait que deux (demande de Chris, 2026-08-22).

                Toutes sont affichees, y compris absentes — un « — » dit « on ne sait
                pas », un « 0 » affirme « personne ». Masquer les absentes ferait
                disparaitre des cartes au fil des heures, ce qui se lit comme un bug.

                Meta consolide ces chiffres pendant les 24 h de vie de la story : le
                reach reste a 0 plusieurs heures alors que les vues montent deja, et le
                detail de navigation n'arrive qu'apres coup. D'ou la mention. */}
            <StoryStats story={selectedStory} />
            {estStoryRecente(selectedStory.posted_at) && (
              <div style={{ marginTop: 14, fontSize: 11, color: 'var(--muted)', lineHeight: 1.45, paddingTop: 12, borderTop: '1px solid var(--border-soft)' }}>
                Story publiée il y a moins de 24 h : Instagram consolide ces chiffres
                progressivement. Le reach et le détail de navigation arrivent après les vues.
              </div>
            )}
            {/* Aucune metrique : Meta ne fournit les insights d'une story que 24 h, et
                seulement au-dela d'un seuil de spectateurs. Le dire vaut mieux qu'une
                grille vide. */}
            {[selectedStory.reach, selectedStory.views, selectedStory.total_interactions,
              selectedStory.replies, selectedStory.shares,
              selectedStory.follows, selectedStory.profile_visits,
              selectedStory.navigation_taps_forward, selectedStory.navigation_taps_back,
              selectedStory.navigation_exits].every(v => v == null) && (
              <div style={{ fontSize: 12, color: 'var(--faint)', textAlign: 'center', padding: '18px 0', lineHeight: 1.5 }}>
                Pas de statistiques pour cette story.<br />
                Instagram ne les fournit que pendant 24 h après la publication.
              </div>
            )}
            {selectedStory.permalink && (
              <a href={selectedStory.permalink} target="_blank" rel="noreferrer" style={{ display: 'block', marginTop: 14, textAlign: 'center', fontSize: 12, color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>
                Voir sur Instagram →
              </a>
            )}
          </div>
        </ModalOverlay>
      )}
    </div>
  );
}

/**
 * Composition de la portee, une ligne par periode calendaire.
 *
 * Repond au probleme de l'All-Time : un « depuis toujours » dedupliqué est hors
 * d'atteinte (la deduplication ne s'additionne pas d'une periode a l'autre, et
 * Meta cesse de servir la ventilation au-dela de ~12 mois). On montre donc chaque
 * periode avec SA valeur, exacte en elle-meme, plutot qu'un agregat impossible.
 *
 * La granularite suit le selecteur de periode de la page (7j -> semaines,
 * 30j -> mois) : deux commandes de periode a l'ecran se contrediraient.
 *
 * Lit `analytics_ig_periodes`, alimentee par le cron. Aucun calcul ici : les taux
 * viennent de l'API, l'ecran ne fait que les mettre en forme.
 */
function HistoriquePortee({ profileId, granularite, debut }: { profileId?: string; granularite: TypePeriodeIg; debut: string }) {
  // Lecture partagee avec l'entonnoir (lib/porteeIg.ts) : les deux ecrans affichaient
  // deux portees differentes pour la meme periode, a trois centimetres l'une de
  // l'autre.
  const { data, isLoading } = usePeriodesIg(granularite, profileId);
  // UNE periode : celle que le selecteur de la page a choisie. La carte listait tout
  // l'historique et ignorait donc le selecteur — le reste de l'onglet montrait aout,
  // elle montrait aussi juillet et juin. Le defaut ne se voyait pas tant que les mois
  // anterieurs n'avaient jamais ete mesures ; le rattrapage du cron les a remplis.
  const laPeriode = porteeDeLaPeriode(data?.periodes, granularite, debut);
  const periodes: any[] = laPeriode ? [laPeriode] : [];

  // Abonnes = audience deja acquise, en ardoise (la couleur de marque).
  // Non-abonnes = personnes atteintes hors de cette audience, en vert : c'est le
  // seul statut positif de la palette, et decouvrir de nouvelles personnes EST le
  // signal positif. Terracotta et ambre portent un sens d'alerte, ils sont exclus.
  const COUL_ABO = 'var(--accent-brand)';
  const COUL_NON = 'var(--green)';

  // « du 1 au 31 août » — meme forme pour les mois et les semaines, pour que deux
  // granularites ne se lisent pas differemment. Le mois n'est repete que si la
  // periode enjambe deux mois, et l'annee n'apparait que hors annee courante :
  // elle alourdirait chaque ligne sans rien apprendre.
  const libelle = (p: any) => {
    const d = new Date(p.debut + 'T12:00:00Z');
    const f = new Date(p.fin + 'T12:00:00Z');
    const jour = (x: Date) => x.getUTCDate();
    const mois = (x: Date) => x.toLocaleDateString('fr-FR', { month: 'long', timeZone: 'UTC' });
    // Une semaine a cheval sur le nouvel an (« du 29 decembre au 4 janvier ») ne
    // dirait pas de quel decembre il s'agit : dans ce seul cas, les deux annees
    // sont explicitees. Arrive une fois par an, mais l'ambiguite serait reelle.
    if (d.getUTCFullYear() !== f.getUTCFullYear()) {
      return `du ${jour(d)} ${mois(d)} ${d.getUTCFullYear()} au ${jour(f)} ${mois(f)} ${f.getUTCFullYear()}`;
    }
    const annee = f.getUTCFullYear() !== new Date().getUTCFullYear() ? ` ${f.getUTCFullYear()}` : '';
    return d.getUTCMonth() === f.getUTCMonth()
      ? `du ${jour(d)} au ${jour(f)} ${mois(f)}${annee}`
      : `du ${jour(d)} ${mois(d)} au ${jour(f)} ${mois(f)}${annee}`;
  };

  return (
    <Card
      title={
        // La periode monte dans le titre parce qu'il n'y en a qu'UNE : `periodes`
        // vaut [laPeriode] ou [] (voir plus haut). Elle occupait jusqu'ici une
        // colonne de 168 px sur la ligne, qui repetait la meme information a
        // chaque rendu tout en amputant la barre d'un tiers de sa largeur.
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          Composition de ton reach
          {laPeriode && (
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
              {libelle(laPeriode)}
            </span>
          )}
          {laPeriode && !laPeriode.figee && (
            <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--muted)', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 5px', whiteSpace: 'nowrap' }}>
              en cours
            </span>
          )}
        </span>
      }
      sub="Qui a vu tes contenus sur la période — des personnes, comptées une seule fois même vues plusieurs jours"
    >
      {isLoading ? (
        <div>
          {[0, 1, 2].map(i => (
            <div key={i} style={{ height: 44, background: 'var(--surface-2)', borderRadius: 8, marginBottom: 6, opacity: 1 - i * 0.25 }} />
          ))}
        </div>
      ) : periodes.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--faint)', textAlign: 'center', padding: '22px 0', lineHeight: 1.5 }}>
          L&apos;historique se construit à partir d&apos;aujourd&apos;hui.<br />
          Chaque période close est enregistrée définitivement.
        </div>
      ) : (
        <div>
          {periodes.map(p => {
            const total = p.reachTotal ?? 0;
            const abo = p.reachAbonnes ?? 0;
            const non = p.reachNonAbonnes ?? 0;
            // Part DANS la portee, donc les deux font 100 % — a ne pas confondre
            // avec la carte « Abonnes touches », qui divise par le nombre d'abonnes.
            // ⚠️ La base de la COMPOSITION est la somme des deux parts, PAS le reach
            // total — et les deux different pour de vrai.
            //
            // Mesure du 2026-09-02 : all-time 137 + 72 = 209 pour un total de 207 ;
            // juillet 144 pour 143 ; juin 121 pour 120. L'ecart est systematique et
            // croit avec la duree de la fenetre, nul sur les periodes courtes.
            //
            // C'est la signature d'une personne qui CHANGE DE STATUT pendant la
            // periode : vue une premiere fois alors qu'elle ne suivait pas le compte,
            // puis une seconde apres s'etre abonnee. Meta la compte dans les DEUX
            // parts, mais une seule fois dans le total dedupliqué. Rien a corriger
            // cote collecte : les trois nombres sont exacts, ils ne repondent
            // simplement pas a la meme question.
            //
            // Diviser les parts par le total faisait donc afficher 66 % + 35 % = 101 %,
            // juste sous une phrase promettant que « les deux parts font 100 % ».
            const base = abo + non;
            // Le second pourcentage est le COMPLEMENT du premier, jamais un second
            // arrondi : deux arrondis independants donnent 101 % des que les deux
            // parts tombent pres de x,5 — c'est une seconde source de 101 %,
            // independante de celle ci-dessus, et elle serait revenue plus tard.
            const pctAbo = base ? Math.round((abo / base) * 100) : 0;
            const pctNon = base ? 100 - pctAbo : 0;
            const ecartDedup = base - total;
            // Un segment trop etroit ne peut pas porter son texte sans deborder sur
            // le voisin. Pratique des outils pro : la valeur reste a l'exterieur, et
            // l'etiquette interieure disparait plutot que de se chevaucher. Le cas
            // « 99 % / 1 % » se lit donc toujours, le 1 % restant lisible dehors.
            const SEUIL_TEXTE = 14;
            return (
              <div key={p.debut} style={{ padding: '10px 0', borderBottom: '1px solid var(--border-soft)' }}>
                {/* Les deux effectifs et la barre sur UNE ligne, centres entre eux.
                    Le total est SORTI de ce flex et passe dessous — c'est ce qui
                    corrige l'alignement : tant qu'il vivait dans la colonne du
                    milieu, cette colonne etait plus haute que la barre (22 px de
                    barre + 5 px + une ligne de texte), et `alignItems: center`
                    centrait les deux chiffres sur le BLOC entier. Ils tombaient donc
                    quelques pixels sous la barre, sans qu'aucune de leurs proprietes
                    ne soit en cause (signale par Chris le 2026-09-02). */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 46, flexShrink: 0, textAlign: 'right', fontSize: 12.5, fontWeight: 600, color: COUL_ABO, fontVariantNumeric: 'tabular-nums' }}
                  title="Abonnés touchés">
                  {p.reachAbonnes == null ? '—' : fmt(abo)}
                </div>

                <div style={{ flex: 1, minWidth: 0, display: 'flex', height: 22, borderRadius: 5, overflow: 'hidden', background: 'var(--surface-2)' }}>
                  <div style={{ width: `${pctAbo}%`, background: COUL_ABO, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}
                    title={`${fmt(abo)} abonnés — ${Math.round(pctAbo)} % de la portée`}>
                    {pctAbo >= SEUIL_TEXTE && (
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap' }}>{Math.round(pctAbo)} %</span>
                    )}
                  </div>
                  <div style={{ width: `${pctNon}%`, background: COUL_NON, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}
                    title={`${fmt(non)} non-abonnés — ${Math.round(pctNon)} % de la portée`}>
                    {pctNon >= SEUIL_TEXTE && (
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap' }}>{Math.round(pctNon)} %</span>
                    )}
                  </div>
                </div>

                <div style={{ width: 46, flexShrink: 0, fontSize: 12.5, fontWeight: 600, color: COUL_NON, fontVariantNumeric: 'tabular-nums' }}
                  title="Non-abonnés touchés">
                  {p.reachNonAbonnes == null ? '—' : fmt(non)}
                </div>
                </div>

                {/* Le total reste SOUS la barre et centre : a droite il se lisait
                    comme une quatrieme colonne de meme rang que les deux effectifs,
                    alors qu'il est leur somme (demande de Chris, 2026-08-26). */}
                <div style={{ textAlign: 'center', marginTop: 5, fontSize: 11, color: 'var(--muted)' }}>
                  Reach total = <strong style={{ color: 'var(--ink)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{p.reachTotal == null ? '—' : fmt(total)}</strong>
                  {ecartDedup > 0 && (
                    <AideColonne texte={AIDE_ECART_DEDUP(abo, non, total)} />
                  )}
                </div>
              </div>
            );
          })}

          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 11, fontSize: 10.5, color: 'var(--muted)', flexWrap: 'wrap' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: COUL_ABO }} />abonnés
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: COUL_NON }} />non-abonnés
            </span>
            <span style={{ marginLeft: 'auto' }}>
              les deux parts font 100 % des personnes touchées
            </span>
          </div>
        </div>
      )}
    </Card>
  );
}

/**
 * Statistiques d'une story, groupees par question posee.
 *
 * Les dix metriques etaient auparavant une grille 3x4 uniforme : meme taille, meme
 * poids, aucune hierarchie. On ne savait pas par ou commencer (retour de Chris,
 * 2026-08-25). Elles repondent en fait a trois questions distinctes :
 *
 *   Portee      combien de personnes, et combien de fois
 *   Engagement  ce que la story a provoque
 *   Navigation  comment les gens l'ont traversee
 *
 * La navigation est exprimee en part du reach : « 14 » ne dit rien, « 88 % ont
 * enchaine » dit tout. La valeur brute reste visible en second.
 */
function StoryStats({ story }: { story: any }) {
  const reach: number | null = story.reach ?? null;
  const vues: number | null = story.views ?? null;

  // Icones au trait plutot qu'emojis : le systeme de design exige un outil de
  // travail credible en capture d'ecran commerciale, et proscrit explicitement
  // l'illustration ludique. Chaque glyphe doit nommer sa metrique, pas decorer.
  // Tracees a currentColor, elles heritent donc de la couleur du label.
  // `d` peut porter plusieurs tracés séparés par « | » (l'oeil a besoin d'une
  // pupille, qui ne peut pas etre un simple sous-chemin sans etre remplie).
  const Icone = ({ d }: { d: string }) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, opacity: .75 }} aria-hidden="true">
      {d.split('|').map((p, i) => <path key={i} d={p} />)}
    </svg>
  );
  const ICONES: Record<string, string> = {
    // Coeur — interactions cumulees
    'Interactions': 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l8.8 8.8 8.8-8.8a5.5 5.5 0 0 0 0-7.8z',
    // Bulle de message — reponses en DM
    'Réponses': 'M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 8.4-9h.6a8.5 8.5 0 0 1 8 8z',
    // Fleche qui rebondit vers l'exterieur — partage (l'icone Instagram)
    'Partages': 'M22 2 11 13|M22 2l-7 20-4-9-9-4 20-7z',
    // Silhouette avec plus — nouveaux abonnes
    'Abonnements': 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M19 8v6M22 11h-6',
    // Silhouette simple — visites de profil
    'Visites de profil': 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
    // Chevron droit — passage a la story suivante
    'Story suivante': 'M9 18l6-6-6-6',
    // Chevron gauche — retour arriere
    'Story précédente': 'M15 18l-6-6 6-6',
    // Porte de sortie — abandon de la sequence
    'Sorties': 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  };

  // Part du reach — seulement si le reach est un denominateur credible. Sur une
  // story fraiche, Meta sert les vues avant le reach : diviser par 0 ou par un
  // reach non encore consolide fabriquerait un pourcentage faux.
  const part = (v: number | null | undefined): string | null =>
    v == null || reach == null || reach <= 0 ? null : `${Math.round((v / reach) * 100)} %`;

  const engagement: [string, number | null][] = [
    ['Interactions', story.total_interactions ?? null],
    ['Réponses', story.replies ?? null],
    ['Partages', story.shares ?? null],
    ['Abonnements', story.follows ?? null],
    ['Visites de profil', story.profile_visits ?? null],
  ];
  const navigation: [string, number | null][] = [
    ['Story suivante', story.navigation_taps_forward ?? null],
    ['Story précédente', story.navigation_taps_back ?? null],
    ['Sorties', story.navigation_exits ?? null],
  ];

  const Section = ({ titre, children }: { titre: string; children: React.ReactNode }) => (
    <div style={{ marginTop: 18 }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, marginBottom: 8 }}>{titre}</div>
      {children}
    </div>
  );

  // Une ligne par metrique plutot qu'une tuile : sur des compteurs souvent a 0,
  // une liste alignee se parcourt d'un coup d'oeil la ou douze tuiles obligent a
  // lire chaque case. Le chiffre est aligne a droite, colonne unique pour l'oeil.
  const Ligne = ({ label, valeur, suffixe }: { label: string; valeur: number | null; suffixe?: string | null }) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--border-soft)' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 12.5, color: 'var(--ink-2)' }}>
        {ICONES[label] && <Icone d={ICONES[label]} />}
        {label}
      </span>
      <span style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
        {suffixe && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{suffixe}</span>}
        <span style={{ fontSize: 14, fontWeight: 600, color: valeur == null ? 'var(--muted)' : 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
          {valeur == null ? '—' : fmt(valeur)}
        </span>
      </span>
    </div>
  );

  return (
    <div>
      {/* Portee : les deux chiffres qui portent tout le reste, donc seuls a avoir
          la taille display. Les huit autres se lisent par rapport a ceux-ci. */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {([
          // Silhouettes multiples = comptes uniques ; oeil = vues, repetitions comprises.
          ['Comptes touchés', reach, 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8'],
          ['Vues', vues, 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z|M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
        ] as [string, number | null, string][]).map(([label, v, d]) => (
          <div key={label} style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, color: 'var(--muted)', marginBottom: 3 }}>
              <Icone d={d} />
              {label}
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.5px', color: v == null ? 'var(--muted)' : 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
              {v == null ? '—' : fmt(v)}
            </div>
          </div>
        ))}
      </div>

      <Section titre="Engagement">
        <div>{engagement.map(([label, v]) => <Ligne key={label} label={label} valeur={v} />)}</div>
      </Section>

      <Section titre="Navigation">
        <div>{navigation.map(([label, v]) => <Ligne key={label} label={label} valeur={v} suffixe={part(v)} />)}</div>
      </Section>
    </div>
  );
}

// Modal mini-funnel — barres de reach décroissantes story par story, pour repérer
// où la plus grosse chute d'audience survient dans une séquence. Aucune donnée
// business ici (calls/revenue) — volontairement exclu de cet onglet Instagram.
function StorySequenceDetailModal({ profileId, sequence, onClose }: { profileId?: string; sequence: any; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['story-sequence-detail', sequence.id],
    queryFn: () => fetch(`/api/instagram/story-sequences-stats?sequenceId=${sequence.id}${profileId ? `&profileId=${profileId}` : ''}`).then(r => r.json()),
    staleTime: 60 * 1000,
  });
  const stats = data?.stats;
  const storiesDetail: any[] = stats?.storiesDetail ?? [];
  const maxReach = Math.max(1, ...storiesDetail.map(s => s.reach ?? 0));

  return (
    <ModalOverlay onClose={onClose} maxWidth={560}>
      <div style={{ background: 'var(--surface)', borderRadius: 14, padding: 24, width: '100%', maxHeight: '80vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{sequence.name}</div>
          <button onClick={onClose} aria-label="Fermer" className="icon-btn" style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--muted)' }}>×</button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 20 }}>
          {[
            sequence.lm_keyword ? `Lead Magnet — mot-clé #${sequence.lm_keyword}` : null,
            sequence.calendly_short_url ? 'Calendly' : null,
          ].filter(Boolean).join(' · ') || 'Aucun CTA configuré'}
        </div>

        {isLoading ? (
          <div style={{ fontSize: 12, color: 'var(--faint)' }}>Chargement...</div>
        ) : storiesDetail.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--faint)' }}>Pas encore de données pour cette séquence.</div>
        ) : (
          <>
            <div className="eyebrow-lg" style={{ color: 'var(--muted)', marginBottom: 10 }}>Rétention story par story</div>
            {/* Les deux nombres de droite n'etaient nommes nulle part : on lisait « 254 »
                puis « -12 % » sans savoir de quelle mesure il s'agissait, alors que le
                bloc « Détail par story » juste en dessous parle de VUES, qui sont autre
                chose. Signale par Chris le 2026-09-02. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, fontSize: 9.5, color: 'var(--faint)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
              <div style={{ width: 32, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>Portée de chaque story</div>
              <div style={{ width: 50, textAlign: 'right', display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                Reach<AideColonne texte={AIDE_REACH_STORY} />
              </div>
              <div style={{ width: 44, textAlign: 'right' }} title="Part du reach perdue par rapport à la story précédente">Perte</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
              {storiesDetail.map((s, i) => {
                const prevReach = i > 0 ? storiesDetail[i - 1].reach : null;
                const dropPct = prevReach && s.reach != null && prevReach > 0 ? Math.round(((prevReach - s.reach) / prevReach) * 1000) / 10 : null;
                const barWidth = maxReach > 0 ? Math.max(4, ((s.reach ?? 0) / maxReach) * 100) : 4;
                return (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 6, overflow: 'hidden', flexShrink: 0, background: 'var(--surface-2)' }}>
                      {s.storage_url && <img loading="lazy" decoding="async" src={s.storage_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ height: 16, borderRadius: 4, background: 'var(--accent)', width: `${barWidth}%`, minWidth: 4 }} />
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--ink)', fontWeight: 600, width: 50, textAlign: 'right' }}>{s.reach ?? '—'}</div>
                    <div style={{ fontSize: 10, color: dropPct != null && dropPct > 0 ? 'var(--red)' : 'var(--faint)', width: 44, textAlign: 'right' }}>{dropPct != null ? `-${dropPct}%` : ''}</div>
                  </div>
                );
              })}
            </div>
            {stats?.retentionPct != null && (
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 20 }}>
                <strong style={{ color: 'var(--ink)' }}>{stats.retentionPct}%</strong> ont vu la séquence jusqu'au bout (reach dernière story / reach 1ère story)
              </div>
            )}

            <div className="eyebrow-lg" style={{ color: 'var(--muted)', marginBottom: 10 }}>Détail par story</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {storiesDetail.map((s, i) => (
                <div key={s.id} style={{ fontSize: 11, color: 'var(--muted)', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)' }}>
                  Story {i + 1} — vues {s.views ?? '–'} · partages {s.shares ?? '–'} · visites profil {s.profile_visits ?? '–'} · abonnements {s.follows ?? '–'} · interactions {s.total_interactions ?? '–'}
                  <br />
                  tap→ {s.navigation_taps_forward ?? '–'} · tap← {s.navigation_taps_back ?? '–'} · sorties {s.navigation_exits ?? '–'}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </ModalOverlay>
  );
}

// ─── TAB 3 : YouTube ──────────────────────────────────────────────────────────

function TabYouTube({ yt, period, profileId, periodIndex, ytIsFallback, sinceConnection, connexionCassee, abonnesAujourdHui, allTimeStart, retentionVivante }: { yt: YTStats | null; period: Period; profileId?: string; periodIndex?: number; ytIsFallback?: boolean; sinceConnection?: boolean; connexionCassee?: boolean; abonnesAujourdHui?: number | null; allTimeStart?: string | null; retentionVivante?: Map<string, number> }) {
  const [selectedVideo, setSelectedVideo] = useState<YTVideo | null>(null);
  useEscapeKey(() => setSelectedVideo(null), !!selectedVideo);
  const [videosTypeFilter, setVideosTypeFilter] = useState<'all' | 'short' | 'long'>('all');
  const [videosSortKey, setVideosSortKey] = useState<'views' | 'views30d' | 'avgViewPct' | 'likes' | 'publishedAt'>('publishedAt');
  // Liste repliee par defaut : les 32 videos affichees d'un coup repoussaient « Sources
  // de trafic », « Mots-cles » et « Demographie » si bas que Chris ignorait leur
  // existence. 5 lignes laissent voir le haut des blocs suivants.
  const [showAllVideos, setShowAllVideos] = useState(false);
  const VIDEOS_PREVIEW = 5;
  const [videosSortDir, setVideosSortDir] = useState<'desc' | 'asc'>('desc');
  const [retention, setRetention] = useState<{ ratio: number; watchRatio: number }[] | null>(null);
  const [retentionSummary, setRetentionSummary] = useState<{ avgViewDurationSec: number | null; avgViewPercentage: number | null; watchTimeMin: number | null; likes: number | null; comments: number | null; shares: number | null; viewsPeriod: number | null; engagedViews: number | null } | null>(null);
  const [loadingRetention, setLoadingRetention] = useState(false);
  const [videoCtr, setVideoCtr] = useState<number | null>(null);
  const [jobCreatedAt, setJobCreatedAt] = useState<string | null>(null);
  const [ctrPending, setCtrPending] = useState(false);
  const [statModal, setStatModal] = useState<{ label: string; value: string; color: string; data: { date: string; v: number | null }[]; unit?: string; data2?: { date: string; v: number | null }[]; label2?: string; color2?: string; pas?: number } | null>(null);
  // Largeur reelle des deux grands graphiques (Vues / jour et Abonnes nets / jour) :
  // ils partagent la meme colonne de la grille, une seule mesure suffit. Elle sert a
  // decider combien de dates tiennent sur l'axe — sur un ecran large il y a la place
  // d'en afficher plus que sur un mobile.
  //
  // DECLARE ICI, avec les autres hooks, et surtout AVANT le `if (!yt) return` plus
  // bas : place apres, il n'etait pas execute quand yt valait null (le temps du
  // chargement d'une nouvelle periode), le nombre de hooks changeait d'un rendu a
  // l'autre et React levait l'erreur #300. C'est ce qui faisait « this page couldn't
  // load » au clic sur All-Time (signale par Chris, trace retrouvee dans
  // webhook_debug_log le 2026-08-21 a 22:51 et 22:52).
  const [refGraphiques, largeurGraphiques] = useLargeur<HTMLDivElement>();

  const loadRetention = useCallback(async (videoId: string, publishedAt?: string) => {
    setLoadingRetention(true);
    setVideoCtr(null);
    setCtrPending(false);
    try {
      const [retRes, ctrRes] = await Promise.all([
        fetch(`/api/youtube/video-retention?videoId=${videoId}${profileId ? `&profileId=${profileId}` : ''}${publishedAt ? `&publishedAt=${encodeURIComponent(publishedAt)}` : ''}`),
        fetch(`/api/youtube/video-ctr?videoId=${videoId}${profileId ? `&profileId=${profileId}` : ''}`),
      ]);
      const retData = await retRes.json();
      setRetention(retData.retentionCurve || []);
      setRetentionSummary({
        avgViewDurationSec: retData.avgViewDurationSec ?? null,
        avgViewPercentage: retData.avgViewPercentage ?? null,
        watchTimeMin: retData.watchTimeMin ?? null,
        likes: retData.likes ?? null,
        comments: retData.comments ?? null,
        shares: retData.shares ?? null,
        viewsPeriod: retData.viewsPeriod ?? null,
        engagedViews: retData.engagedViews ?? null,
      });
      if (ctrRes.ok) {
        const ctrData = await ctrRes.json();
        const jca: string | null = ctrData.jobCreatedAt ?? null;
        setJobCreatedAt(jca);
        const videoOlderThanJob = jca && publishedAt && new Date(publishedAt) < new Date(jca);
        if (!videoOlderThanJob) {
          // Job récent (<72h) et aucun rapport encore reçu → "Bientôt dispo"
          const jobAgentH = jca ? (Date.now() - new Date(jca).getTime()) / 3600000 : 999;
          const noReports = (ctrData.reportsProcessed ?? 0) === 0;
          if (noReports && jobAgentH < 72) {
            setCtrPending(true);
          } else {
            setVideoCtr(ctrData.ctrPct ?? null);
          }
        }
      }
    } catch { setRetention([]); setRetentionSummary(null); }
    finally { setLoadingRetention(false); }
  }, [profileId]);

  if (!yt) return <Empty msg={
    connexionCassee
      ? "La connexion à YouTube s'est interrompue : la collecte est arrêtée. Reconnecte le compte depuis les paramètres pour la relancer."
      : periodIndex && periodIndex > 0
        ? "Pas de données YouTube pour cette période."
        : "Connecte ton compte YouTube pour voir les stats."
  } />;

  // Filtre par vraie date calendaire (pas .slice(-N), qui suppose chartData aligné
  // sur aujourd'hui).
  const { periodStart: ytPeriodStart, periodEnd: ytPeriodEnd } = getPeriodWindow(periodIndex ?? 0, period === 7 ? 'week' : 'month');
  const todayUTCStrYT = parisDateStr(new Date());
  const isFutureDayYT = (date: string) => date > todayUTCStrYT;
  // En mode "depuis connexion", yt.chartData est déjà borné [connectedAt, aujourd'hui]
  // par le fetch — ne pas re-clipper avec la fenêtre calendaire du mois/semaine en cours.
  const ytDaysRaw = sinceConnection ? yt.chartData : yt.chartData.filter(d => {
    const t = new Date(d.date + 'T12:00:00Z').getTime();
    return t >= ytPeriodStart.getTime() && t <= ytPeriodEnd.getTime();
  });
  // ytDays : TOUS les jours calendaires de la période (comme igDays) — sinon l'axe X du
  // graphique s'arrête à la dernière ligne connue en base (souvent en retard de 2-3
  // jours côté API YouTube Analytics) au lieu de couvrir tout le mois/semaine avec les
  // jours sans donnée simplement vides.
  // En mode "depuis connexion", ytDaysRaw n'est plus borné [ytPeriodStart, ytPeriodEnd]
  // (mois/semaine en cours) — ne pas reconstruire une plage calendaire sur cette même
  // fenêtre ici, sinon ytDays (et ytViewsP qui en dérive) reste clippé malgré le fix
  // de ytDaysRaw plus haut. On complète juste les jours manquants à l'intérieur de la
  // vraie fenêtre déjà présente dans ytDaysRaw (pas de recalcul de bornes calendaires).
  const ytDayByDate = new Map(ytDaysRaw.map(d => [d.date, d]));
  const ytDaysNoDataSet = new Set<string>();
  // Jours que YouTube n'a pas encore traites — marques pour que les courbes y fassent un
  // TROU plutot que de descendre a zero, qui se lirait « aucune vue ce jour-la ».
  //
  // Les deux modes signalent l'absence differemment :
  //   - API live : le jour est ABSENT de chartData (l'API n'emet pas de ligne) ;
  //   - snapshot : la ligne EXISTE avec yt_views a null — le cron la cree pour Instagram
  //                meme quand YouTube n'a rien renvoye — et le `?? 0` du mapping la
  //                transforme en 0.
  //
  // C'est ce second cas qui manquait : en All-Time le filet restait vide, et les 3
  // derniers jours s'affichaient a 0 au lieu d'un trou (constate le 2026-08-21).
  //
  // Critere : aucune activite d'aucune sorte. Une vraie journee a zero vue serait
  // marquee a tort, mais elle produirait le meme rendu qu'un point a zero — un creux
  // dans la courbe — sans jamais affirmer une valeur fausse.
  // `viewsPending` dit EXACTEMENT ce que l'heuristique ci-dessous devinait : la ligne
  // existe mais `yt_views` est null. Le drapeau n'existait pas quand ce filet a ete
  // ecrit ; il est desormais produit par ytHist (2026-08-31). Une vraie journee a zero
  // vue n'est donc plus marquee a tort.
  //
  // L'heuristique reste en repli pour le chemin API live, qui ne porte pas le drapeau —
  // la un jour non traite est simplement ABSENT, et c'est la boucle plus bas qui le voit.
  //
  // Et surtout : ce filet ne tournait QUE en All-Time. Sur une periode passee, une ligne
  // a `yt_views` null redevenait un zero trace. 31 journees dans ce cas sur le profil de
  // test au 2026-08-31.
  for (const d of ytDaysRaw) {
    const pending = (d as any).viewsPending;
    if (pending === true) { ytDaysNoDataSet.add(d.date); continue; }
    if (pending === undefined && sinceConnection) {
      const vide = (d.views ?? 0) === 0 && (d.watchTime ?? 0) === 0
        && (d.likes ?? 0) === 0 && (d.subsGained ?? 0) === 0 && (d.subsLost ?? 0) === 0;
      if (vide) ytDaysNoDataSet.add(d.date);
    }
  }
  const ytDays: typeof ytDaysRaw = sinceConnection ? ytDaysRaw : (() => {
    const days: typeof ytDaysRaw = [];
    let d = ytPeriodStart;
    while (d.getTime() <= ytPeriodEnd.getTime()) {
      const iso = parisDateStr(d);
      const existing = ytDayByDate.get(iso);
      if (!existing) ytDaysNoDataSet.add(iso);
      days.push(existing ?? { date: iso, views: 0, watchTime: 0, subsGained: 0, subsLost: 0, netSubs: 0 });
      d = parisAddDays(d, 1);
    }
    return days;
  })();

  // Derniere date reellement disponible cote YouTube Analytics.
  //
  // ⚠️ Le delai de traitement touche TOUTES les metriques, pas seulement l'engagement :
  // verifie le 2026-08-21, vues, watch time, abonnes, duree moyenne, likes, commentaires
  // et partages s'arretent tous au meme jour (J-3). Le cron demande pourtant jusqu'a
  // hier — c'est l'API qui ne renvoie rien pour les jours recents.
  //
  // Le commentaire precedent affirmait que « vues » n'avait pas ce delai : c'etait faux,
  // et le badge n'etait affiche que sur trois cartes. Il l'est desormais sur toutes
  // celles qui lisent des donnees journalieres.
  //
  // Derniere date PRESENTE dans les donnees, sans filtre sur une valeur.
  //
  // Le filtre `d.views != null` qui etait ici ne se declenchait jamais : les deux
  // constructions de chartData appliquent `?? 0` / `|| 0`, donc `views` n'est jamais
  // null. Tous les jours passaient le filtre, la derniere date valait aujourd'hui, le
  // retard tombait a 0 — et AUCUN badge ne s'affichait nulle part (constate le
  // 2026-08-21 : la carte « Vues » n'avait pas son badge alors qu'elle n'est pas exclue).
  //
  // Les deux modes signalent l'absence differemment, il faut donc couvrir les deux :
  //   - API live  : le jour non traite est ABSENT de chartData (l'API n'emet pas de ligne) ;
  //   - snapshot  : la ligne EXISTE avec yt_views a null (le cron la cree pour Instagram),
  //                 et le `?? 0` du mapping la transforme en 0.
  //
  // Un jour a 0 vue ET 0 watch time ET 0 like est donc traite comme non renseigne. Une
  // vraie journee sans aucune activite serait ecartee a tort, mais elle ne fausse rien :
  // le retard affiche serait alors legerement surestime, jamais sous-estime — et sur une
  // chaine active le cas ne se presente pas.
  const ytLastEngagementDate = [...yt.chartData]
    .filter(d => (d.views ?? 0) > 0 || (d.watchTime ?? 0) > 0 || (d.likes ?? 0) > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
    .at(-1)?.date;
  // Retard reel en jours — sert a n'afficher le badge que s'il y en a un.
  // Suffixe de fraicheur commun a tous les blocs lisant l'Analytics API. Defini une
  // fois : ces blocs partagent la meme source, donc le meme retard — l'ecrire dans
  // chacun garantissait qu'un nouveau bloc l'oublie (c'est ce qui est arrive a
  // Appareils, Sources de trafic, Mots-cles et Demographie).
  const ytDataLagDays = ytLastEngagementDate
    ? Math.round((Date.now() - new Date(ytLastEngagementDate + 'T12:00:00Z').getTime()) / 86400000)
    : 0;
  // Pose sur les blocs dont on suit l'evolution jour apres jour (vues, abonnes nets,
  // tableau des videos) — pas sur les repartitions (Appareils, Sources de trafic,
  // Mots-cles, Demographie), ou le retard n'a pas d'importance : on y lit une structure
  // cumulee, pas un chiffre du jour. Choix de Chris, 2026-08-21.
  const ytLagSuffix = ytDataLagDays >= 2 ? ` · données J-${ytDataLagDays}` : '';
  // Etiquette de fenetre des cartes. En mode All-Time, les cartes affichaient « 30j »
  // alors que le bandeau annonçait « All-Time, depuis le 30/05/2026 » et que les
  // graphiques couvraient juin a aout : l'etiquette contredisait la periode reellement
  // affichee (constate par Chris a l'ecran le 2026-08-21).
  const ytEtiquettePeriode = sinceConnection ? 'total' : `${period}j`;
  const ytLastEngagementDateFmt = ytLastEngagementDate
    ? new Date(ytLastEngagementDate + 'T12:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
    : null;

  // Valeurs sur la période sélectionnée depuis chartData
  const ytViewsP = ytDays.reduce((s, d) => s + d.views, 0);
  const ytWatchTimeP = ytDays.reduce((s, d) => s + d.watchTime, 0);
  const ytSubsGainedP = ytDays.reduce((s, d) => s + (d.subsGained ?? 0), 0);
  const ytSubsLostP = ytDays.reduce((s, d) => s + (d.subsLost ?? 0), 0);
  const ytNetSubsP = ytSubsGainedP - ytSubsLostP;
  // Likes / commentaires / partages sur la PERIODE affichee. Les cartes utilisaient
  // yt.likes30d & co — des valeurs figees sur 30 jours — tout en affichant l'etiquette
  // « ${period}j » : sur une vue a 7 jours, elles montraient 30 jours de donnees sous un
  // libelle « 7j ». Les quatre autres cartes de la meme rangee utilisent bien des
  // valeurs de periode (ytViewsP, ytNetSubsP...), d'ou l'incoherence.
  const ytLikesP = ytDays.reduce((s, d) => s + (d.likes ?? 0), 0);
  const ytCommentsP = ytDays.reduce((s, d) => s + (d.comments ?? 0), 0);
  const ytSharesP = ytDays.reduce((s, d) => s + (d.shares ?? 0), 0);

  // (conversionRate supprimé : plus aucun appelant depuis que la courbe « Conv.
  //  vue→abonné » calcule le taux jour par jour au lieu d'étaler un total global.)
  // Affichage adaptatif : « 20 min » et non « 0h ». Math.round(minutes / 60) ecrasait
  // a 0 tout watch time sous 30 minutes — exactement le motif du bug de collecte
  // corrige le 2026-08-20, reproduit ici a l'affichage. Meme regle que le tableau des
  // videos, qui bascule en heures a partir de 60 minutes.
  // Watch time de la periode, ventile par format — sert la carte « Watch time », qui
  // affiche desormais les deux comme « Watch time moyen / vue » juste a cote.
  // Somme et non moyenne : un jour sans vue vaut reellement 0 minute, il n'y a donc
  // rien a exclure du calcul.
  const ytWatchShortsP = ytDays.reduce((s, d) => s + ((d as any).watchTimeShorts ?? 0), 0);
  const ytWatchLongP = ytDays.reduce((s, d) => s + ((d as any).watchTimeLong ?? 0), 0);
  // Toutes les durees de la plateforme passent par lib/duree.ts — voir l'en-tete de
  // ce fichier pour la regle et le bug qui l'a motivee.
  const fmtWatchMin = dureeDepuisMinutes;
  const watchTimeLabel = dureeDepuisMinutes(ytWatchTimeP);

  // Vues/sub par type de contenu (depuis les vidéos de la période)
  // Vues par format sur la PERIODE AFFICHEE (colonnes yt_views_shorts / _long, ajoutees
  // le 2026-08-20 depuis la dimension creatorContentType).
  //
  // Auparavant : somme de v.views30d, un cumul FIGE sur 30 jours glissants cote cron —
  // independant de la periode choisie. Sur une vue a 7 jours, « vues pour 1 abonne »
  // divisait donc 30 jours de vues par 7 jours d'abonnes gagnes : deux fenetres
  // melangees, ratio surevalue d'un facteur ~4.
  //
  // Repli sur l'ancien calcul si la ventilation manque (jours anterieurs a la collecte).
  const shortsViewsFromDays = ytDays.reduce((s, d) => s + ((d as any).viewsShorts ?? 0), 0);
  const longViewsFromDays   = ytDays.reduce((s, d) => s + ((d as any).viewsLong ?? 0), 0);
  const hasFormatBreakdown  = shortsViewsFromDays > 0 || longViewsFromDays > 0;
  const shortsViewsP = hasFormatBreakdown
    ? shortsViewsFromDays
    : yt.videos.filter(v => v.isShort).reduce((s, v) => s + v.views30d, 0);
  const longViewsP = hasFormatBreakdown
    ? longViewsFromDays
    : yt.videos.filter(v => !v.isShort).reduce((s, v) => s + v.views30d, 0);
  // Abonnes gagnes SUR LA PERIODE AFFICHEE, sans repli sur les 30 jours.
  //
  // Le repli `ytSubsGainedP > 0 ? ... : yt.subsGained30d` divisait les vues de la
  // periode par les abonnes de 30 JOURS des que la periode n'avait aucun gain : sur une
  // vue a 7 jours, un ratio construit sur deux fenetres differentes, donc sous-evalue.
  // C'est exactement le defaut que shortsViewsP corrige juste au-dessus.
  //
  // Sans gain sur la periode, le ratio n'existe pas : « X vues pour 1 abonne » n'a
  // aucun sens quand personne ne s'est abonne. La carte affiche « — », ce qui est vrai,
  // plutot qu'un chiffre emprunte a une autre fenetre (constate le 2026-08-21).
  const subsRef = ytSubsGainedP;
  // Denominateur et numerateur doivent venir de la meme fenetre : si la ventilation par
  // format manque (jours anterieurs a sa collecte), shortsViewsP se replie sur des
  // cumuls 30j et le ratio redeviendrait bancal. On ne l'affiche alors pas.
  const ratioFenetreCoherente = hasFormatBreakdown;
  const viewsPerSubShorts = ratioFenetreCoherente && subsRef > 0 && shortsViewsP > 0 ? Math.round(shortsViewsP / subsRef) : null;
  const viewsPerSubLong = ratioFenetreCoherente && subsRef > 0 && longViewsP > 0 ? Math.round(longViewsP / subsRef) : null;

  // Même correction qu'`postsInPeriod` côté Instagram : en All-Time, `ytPeriodStart` et
  // `ytPeriodEnd` valent le mois en cours. « Vidéos publiées · total » ne comptait donc
  // que les vidéos du mois courant, et la répartition Shorts / Vidéos qui en dérive
  // aussi. La borne haute devient « maintenant », la basse la mise en route.
  const debutVideosYt = sinceConnection && allTimeStart ? new Date(allTimeStart) : ytPeriodStart;
  const finVideosYt = sinceConnection ? new Date() : ytPeriodEnd;
  const videosInPeriod = yt.videos.filter(v => {
    const t = new Date(v.publishedAt).getTime();
    return t >= debutVideosYt.getTime() && t <= finVideosYt.getTime();
  });
  const ytShortsCount = videosInPeriod.filter(v => v.isShort).length;
  const ytLongCount = videosInPeriod.filter(v => !v.isShort).length;
  const ytVideosInPeriodCount = videosInPeriod.length;

  // Publications par jour depuis les vrais timestamps des vidéos
  const ytPubsByDay = ytDays.map(d => ({
    date: d.date,
    shorts: yt.videos.filter(v => v.isShort && parisDateStr(new Date(v.publishedAt)) === d.date).length,
    longues: yt.videos.filter(v => !v.isShort && parisDateStr(new Date(v.publishedAt)) === d.date).length,
  }));

  const fmtSec = dureeDepuisSecondes;

  // (shortsVideos / longVideos supprimes : ils ne servaient qu'au watch time moyen
  //  all-time, remplace par un calcul sur la periode juste en dessous.)
  // v.watchTime30d vient de row.watch_time_min (des minutes, cf. ligne ~4903) — *60 pour
  // repasser en secondes avant division, sinon fmtSec() (qui attend des secondes) affiche
  // toujours "0m00s" (ex: 500min de watch time / 10000 vues = 0.05 arrondi à 0).
  // Watch time moyen par vue, SUR LA PERIODE AFFICHEE — comme les quatre cartes
  // voisines, et comme le graphique de sa propre modale.
  //
  // Le calcul precedent partait de yt.videos, c'est-a-dire TOUTES les videos de la
  // chaine sans filtre de date, et divisait leur watch time all-time par leurs vues
  // all-time. La carte affichait donc une moyenne depuis-toujours au milieu d'une
  // rangee de cartes de periode : changer de periode ne la faisait pas bouger, et sa
  // valeur ne correspondait pas au graphique qui s'ouvrait au clic (choix de Chris,
  // 2026-08-21).
  //
  // Calcul PONDERE a partir de la duree moyenne quotidienne, pas du watch time.
  //
  // Le chemin evident — somme(watch time) / somme(vues) — est inutilisable ici :
  // yt_watch_time_*_min vient de estimatedMinutesWatched, que l'API arrondit a la
  // MINUTE entiere. Sur des Shorts de 20 secondes chaque journee tombe a 0, et la
  // moyenne affichait 0s sur toutes les periodes testees (verifie en base le
  // 2026-08-21 : aout, juillet, 7 derniers jours, tout — 0s partout).
  //
  // yt_avg_duration_*_sec porte la meme information en SECONDES, donc sans cette
  // perte. Pondere par les vues du jour, il reconstitue la vraie moyenne sur
  // n'importe quel decoupage : un jour a 10 vues pese dix fois un jour a 1 vue.
  // Meme mesure, les valeurs deviennent 21s (Shorts) et 44s (longues) en aout.
  //
  // Condition verifiee : chaque jour ayant des vues a bien sa duree moyenne
  // renseignee (15/15 Shorts, 8/8 longues), aucun jour n'est donc exclu du calcul.
  // Precision restante : ±0,5 s par jour (arrondi seconde de l'API), contre jusqu'a
  // 59 s par jour pour le calcul via watch time.
  const moyennePonderee = (cle: string, cleVues: string): number | null => {
    let sommeDurees = 0;
    let sommeVues = 0;
    for (const d of ytDays) {
      const vues = (d as any)[cleVues] ?? 0;
      const duree = (d as any)[cle];
      if (vues > 0 && duree != null) { sommeDurees += duree * vues; sommeVues += vues; }
    }
    // null (pas 0) sans aucune vue : la division est indefinie, pas nulle. Afficher 0
    // dirait « ils ont ouvert et sont partis aussitot » alors que personne n'a ouvert.
    return sommeVues > 0 ? Math.round(sommeDurees / sommeVues) : null;
  };
  const avgWatchShorts = moyennePonderee('avgDurationShorts', 'viewsShorts');
  const avgWatchLong = moyennePonderee('avgDurationLong', 'viewsLong');

  const ytStatSeries: Record<string, { data: { date: string; v: number }[]; color: string; unit?: string; nature?: NatureSerie }> = {
    'Vidéos publiées':    { data: ytPubsByDay.map(d => ({ date: d.date, v: isFutureDayYT(d.date) ? (null as any) : d.shorts + d.longues })), color: YT_COLOR },
    'Vues 30j':           { data: ytDays.map(d => ({ date: d.date, v: ytDaysNoDataSet.has(d.date) ? (null as any) : d.views })), color: RED },
    // En MINUTES, pas en heures : le watch time quotidien de cette chaine va de 1 a
    // 16 minutes, donc Math.round(x / 60) ecrasait toute la courbe a zero. Meme motif
    // que la carte « Watch time » juste au-dessus et que le bug de collecte du
    // 2026-08-20 — une conversion en heures detruit les petites valeurs.
    'Watch time':         { data: ytDays.map(d => ({ date: d.date, v: ytDaysNoDataSet.has(d.date) ? (null as any) : Math.round(d.watchTime) })), color: AMBER, unit: 'min' },
    // Vignette : durée moyenne réelle du jour, tous formats confondus
    // (yt_avg_view_duration_sec). La ventilation Shorts / longues est dans la modale,
    // au clic. Remplace mockFromTotalYT, qui étalait le total avec un sinus.
    'Watch time moyen':   {
      data: ytDays.map(d => ({
        date: d.date,
        v: ytDaysNoDataSet.has(d.date) ? (null as any) : ((d as any).avgViewDurationSec ?? null),
      })),
      color: '#f43f5e', unit: 's',
    },
    'Abonnés gagnés':        { data: ytDays.map(d => ({ date: d.date, v: ytDaysNoDataSet.has(d.date) ? (null as any) : (d.subsGained ?? 0) })), color: GREEN },
    'Abonnés perdus':        { data: ytDays.map(d => ({ date: d.date, v: ytDaysNoDataSet.has(d.date) ? (null as any) : (d.subsLost ?? 0) })), color: RED },
    'Abonnés nets YT':          { data: ytDays.map(d => ({ date: d.date, v: ytDaysNoDataSet.has(d.date) ? (null as any) : (d.netSubs ?? 0) })), color: yt.netSubs30d >= 0 ? GREEN : RED },
    'Likes':              { data: ytDays.map(d => ({ date: d.date, v: ytDaysNoDataSet.has(d.date) ? (null as any) : (d.likes ?? 0) })), color: 'var(--accent-brand)' },
    'Commentaires':       { data: ytDays.map(d => ({ date: d.date, v: ytDaysNoDataSet.has(d.date) ? (null as any) : (d.comments ?? 0) })), color: BLUE },
    'Partages':           { data: ytDays.map(d => ({ date: d.date, v: ytDaysNoDataSet.has(d.date) ? (null as any) : (d.shares ?? 0) })), color: GREEN },
    // Vraie conversion par jour (subs gagnés / vues), plus une courbe générée à partir
    // du total. mockFromTotalYT répartissait le taux global avec un sinus : la courbe
    // dessinait des variations là où la réalité peut être parfaitement plate (0 abonné
    // gagné sur les 62 jours du profil de test). Corrigé le 2026-08-20.
    'Conv. vue→abonné': {
      data: ytDays.map(d => ({
        date: d.date,
        // 0 sur les jours sans vue, comme le watch time moyen : une courbe continue se
        // lit mieux qu'une nuee de points. Le KPI, lui, divise les totaux de la periode
        // (abonnes gagnes / vues) et n'est donc pas dilue par ces jours.
        v: ytDaysNoDataSet.has(d.date)
          ? (null as any)
          : (d.views > 0 ? Math.round(((d.subsGained ?? 0) / d.views) * 100 * 1000) / 1000 : 0),
      })),
      color: 'var(--accent-brand)', unit: '%',
    },
    // La carte affiche le TOTAL d'abonnés (49), sa courbe doit donc suivre ce total —
    // exactement comme la carte « Abonnés » d'Instagram, qui trace followerCount.
    // Elle traçait subsGained (les abonnés GAGNÉS par jour, à 0 sur cette chaîne) : on
    // cliquait sur « 49 abonnés » et on voyait une courbe plate à zéro. Deux métriques
    // différentes sous le même nom. Corrigé le 2026-08-21.
    // NIVEAU, pour la meme raison que « Abonnés » cote Instagram.
    'Abonnés YT':         { data: ytDays.map(d => ({ date: d.date, v: ytDaysNoDataSet.has(d.date) ? (null as any) : ((d as any).subscribers ?? null) })), color: RED, nature: 'niveau' },
  };

  const openStatModal = (label: string, value: string) => {
    const s = ytStatSeries[label];
    if (!s) return;
    if (label === 'Watch time') {
      // Watch time separe Shorts / videos longues — demande de Chris.
      //
      // Les valeurs viennent de l'API (colonnes yt_watch_time_*_min, dimension
      // creatorContentType). Ne PAS les reconstituer par « vues x duree moyenne » :
      // averageViewDuration est arrondi a la seconde, et sur petits volumes l'erreur
      // s'amplifie — 1,25 min calculee contre 0,00 reelle sur une journee testee.
      // ?? 0 et non ?? null, contrairement au « watch time MOYEN » juste en dessous :
      // c'est une SOMME, pas une division. Un jour sans vue vaut donc reellement
      // 0 minute de visionnage — l'affirmer est exact.
      //
      // La moyenne, elle, se calcule watch time / vues : sans vue, la division est
      // indefinie, pas nulle. Afficher 0 y dirait « ils ont ouvert et sont partis
      // instantanement » alors que personne n'a ouvert. D'ou les deux traitements.
      //
      // Seuls les jours que YouTube n'a pas encore traites restent en trou (null), dans
      // les deux cas : la donnee n'existe pas encore.
      setStatModal({
        label: 'Watch time — Shorts',
        value: watchTimeLabel,
        color: AMBER,
        label2: 'Vidéos longues',
        color2: '#64748b',
        unit: 'min',
        ...regrouperDeuxSeries(
          ytDays.map(d => ({ date: d.date, v: ytDaysNoDataSet.has(d.date) ? (null as any) : ((d as any).watchTimeShorts ?? 0) })),
          ytDays.map(d => ({ date: d.date, v: ytDaysNoDataSet.has(d.date) ? (null as any) : ((d as any).watchTimeLong ?? 0) })),
          // Des MINUTES cumulees : une somme est exacte.
          'comptage',
        ),
      });
      return;
    }
    if (label === 'Watch time moyen') {
      // Vraies durées moyennes par jour et par format (colonnes yt_avg_duration_*_sec,
      // alimentées depuis la dimension creatorContentType de l'API — vérifiée sur une
      // vraie chaîne le 2026-08-20).
      //
      // Remplace mockAroundAvgYT, qui dessinait un sinus autour de la moyenne globale et
      // se rabattait sur des valeurs INVENTÉES quand la donnée manquait (45 s pour les
      // Shorts, 480 s pour les longues — des chiffres sans source).
      //
      // GRAPHIQUE : 0 sur les jours sans vue — une courbe continue se lit bien mieux
      // qu'une nuee de points isoles sur une petite chaine (choix de Chris, 2026-08-21).
      //
      // KPI : ces jours n'y entrent PAS. avgWatchShorts fait somme(watch time) /
      // somme(vues) par video — un jour sans vue contribue 0 au numerateur ET au
      // denominateur, il ne dilue donc pas la moyenne. Le graphique montre le rythme,
      // le KPI mesure la performance reelle : les deux repondent a des questions
      // differentes, d'ou deux traitements.
      //
      // Seuls les jours que YouTube n'a pas encore traites restent en trou : la donnee
      // n'existe pas encore, contrairement a un jour mesure sans vue.
      setStatModal({
        label: 'Watch time moyen / vue — Shorts',
        value: avgWatchShorts !== null ? fmtSec(avgWatchShorts) : '—',
        color: '#e8a838',
        label2: 'Vidéos longues',
        color2: '#64748b',
        unit: 's',
        ...regrouperDeuxSeries(
          ytDays.map(d => ({ date: d.date, v: ytDaysNoDataSet.has(d.date) ? (null as any) : ((d as any).avgDurationShorts ?? 0) })),
          ytDays.map(d => ({ date: d.date, v: ytDaysNoDataSet.has(d.date) ? (null as any) : ((d as any).avgDurationLong ?? 0) })),
          // Une DUREE MOYENNE par vue : la sommer donnerait trente fois la duree.
          'moyenne',
        ),
      });
      return;
    }
    if (label === 'Vidéos publiées') {
      setStatModal({
        label, value, color: '#e8a838',
        label2: 'Vidéos longues', color2: '#64748b',
        ...regrouperDeuxSeries(
          ytPubsByDay.map(d => ({ date: d.date, v: isFutureDayYT(d.date) ? (null as any) : d.shorts })),
          ytPubsByDay.map(d => ({ date: d.date, v: isFutureDayYT(d.date) ? (null as any) : d.longues })),
          'comptage',
        ),
      });
    } else {
      const { data, pas } = regrouperSerieAffichee(s.data, s.nature);
      setStatModal({ label, value, color: s.color, data, unit: s.unit, pas });
    }
  };

  const trafficData = yt.trafficSources.slice(0, 8).map(s => ({
    name: nomSourceTrafic(s.source),
    views: s.views,
  }));

  const deviceData = yt.devices.map(d => ({ name: nomAppareil(d.device), views: d.views }));

  return (
    <div className="stack">
      {/* Ligne 1 — audience & portée */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
        {[
          // Pas de sous-titre de periode : c'est le total actuel de la chaine, lu en
          // direct via la Data API v3. « all time » induisait en erreur — la carte ne
          // cumule rien sur une periode, elle affiche un compteur.
          { label: 'Abonnés', value: abonnesAujourdHui != null ? fmt(abonnesAujourdHui) : '—', sub: "aujourd'hui", color: 'var(--ink)', key: 'Abonnés YT' },
          { label: 'Vidéos publiées', value: fmt(ytVideosInPeriodCount), sub: ytEtiquettePeriode, color: YT_COLOR, key: 'Vidéos publiées' },
          // Libelle « Abonnés nets » sans suffixe : on est dans l'onglet YouTube, a cote
          // d'une carte « Abonnés ». Le « YT » etait un reste de la cle technique, qui
          // reste 'Abonnés nets YT' pour ne pas entrer en collision avec la serie
          // Instagram du meme nom.
          { label: 'Abonnés nets', value: `${ytNetSubsP >= 0 ? '+' : ''}${fmt(ytNetSubsP)}`, sub: ytEtiquettePeriode, color: ytNetSubsP >= 0 ? GREEN : RED, key: 'Abonnés nets YT' },
          { label: 'Vues', value: fmt(ytViewsP), sub: ytEtiquettePeriode, color: 'var(--ink)', key: 'Vues 30j' },
          null, // carte Vues/sub custom Shorts vs Vidéos
        ].map((s, i) => {
          if (s === null) return (
            <div key="vues-sub" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px' }}>
              <div style={{ marginBottom: 10 }}>
                <span className="eyebrow-sm" style={{ color: 'var(--muted)' }}>Vues pour 1 abonné gagné</span>
                <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--faint)', marginLeft: 5 }}>{ytEtiquettePeriode}</span>
                {/* Cette carte a son propre rendu (valeurs Shorts/Vidéos côte à côte),
                    elle n'héritait donc pas du badge de la boucle. Ses deux termes
                    viennent de l'Analytics API : même retard que les cartes voisines. */}
                {ytDataLagDays >= 2 && (
                  <span
                    title={`Délai de traitement de YouTube Analytics.${ytLastEngagementDateFmt ? ` Dernière donnée disponible : ${ytLastEngagementDateFmt}.` : ''}`}
                    style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 4px', marginLeft: 5, cursor: 'help', whiteSpace: 'nowrap', display: 'inline-block' }}
                  >
                    J-{ytDataLagDays}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--faint)', marginBottom: 3 }}>Shorts</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink)', lineHeight: 1 }}>{viewsPerSubShorts !== null ? fmt(viewsPerSubShorts) : '—'}</div>
                </div>
                <div style={{ width: 1, height: 32, background: 'var(--border)', flexShrink: 0, marginTop: 14 }} />
                <div>
                  <div style={{ fontSize: 10, color: 'var(--faint)', marginBottom: 3 }}>Vidéos</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink)', lineHeight: 1 }}>{viewsPerSubLong !== null ? fmt(viewsPerSubLong) : '—'}</div>
                </div>
              </div>
            </div>
          );
          return (
          <div key={s.label} onClick={s.key ? () => openStatModal(s.key!, s.value) : undefined} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px', cursor: s.key ? 'pointer' : 'default', transition: 'background .15s' }}
            onMouseEnter={e => { if (s.key) e.currentTarget.style.background = 'var(--surface-2)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--surface)'; }}>
            <div style={{ marginBottom: 8 }}>
              <span className="eyebrow-sm" style={{ color: 'var(--muted)' }}>{s.label}</span>
              {s.sub && <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--faint)', marginLeft: 5 }}>{s.sub}</span>}
              {/* Meme badge que la seconde rangee : « Vues » et « Abonnes nets » lisent
                  l'Analytics API, donc subissent le meme retard que Watch time ou Likes.
                  Il manquait ici parce que les deux rangees ont leur propre rendu — le
                  badge n'avait ete pose que sur la seconde (constate par Chris a l'ecran
                  le 2026-08-21). Exclusions : « Abonnes » (Data API v3, temps reel) et
                  « Videos publiees » (date de publication, connue immediatement). */}
              {ytDataLagDays >= 2 && !['Abonnés', 'Vidéos publiées'].includes(s.label) && (
                <span
                  title={`Délai de traitement de YouTube Analytics.${ytLastEngagementDateFmt ? ` Dernière donnée disponible : ${ytLastEngagementDateFmt}.` : ''}`}
                  style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 4px', marginLeft: 5, cursor: 'help', whiteSpace: 'nowrap', display: 'inline-block' }}
                >
                  J-{ytDataLagDays}
                </span>
              )}
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: s.color, lineHeight: 1, marginBottom: s.label === 'Vidéos publiées' ? 8 : 0 }}>
              {s.value}
              {/* Teste la CLE, pas le libelle : le libelle est du texte d'affichage, le
                  renommer ne doit pas faire disparaitre le detail « (+X -Y) ». */}
              {s.key === 'Abonnés nets YT' && (
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
                  {' ('}
                  <span style={{ color: GREEN }}>+{fmt(ytSubsGainedP)}</span>
                  {' '}
                  <span style={{ color: RED }}>-{fmt(ytSubsLostP)}</span>
                  {')'}
                </span>
              )}
            </div>
            {s.label === 'Vidéos publiées' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'nowrap', marginTop: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink)', whiteSpace: 'nowrap' }}>{fmt(ytShortsCount)}</span>
                  <span style={{ fontSize: 10, color: 'var(--ink)', whiteSpace: 'nowrap' }}>Shorts</span>
                </div>
                <div style={{ width: 1, height: 12, background: 'var(--border)', flexShrink: 0 }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink)', whiteSpace: 'nowrap' }}>{fmt(ytLongCount)}</span>
                  <span style={{ fontSize: 10, color: 'var(--ink)', whiteSpace: 'nowrap' }}>Vidéos</span>
                </div>
              </div>
            )}
          </div>
          );
        })}
      </div>
      {/* Ligne 2 — engagement & watch time */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
        {[
          // Deux cartes custom dans cette rangée : elles affichent chacune un total plus
          // sa ventilation Shorts / vidéos longues, ce que le rendu générique ne sait pas
          // faire. Marquées par un `custom` explicite et non par leur position — deux
          // `null` indistinguables auraient rendu la même carte deux fois.
          { custom: 'watch-total' as const },
          { custom: 'watch-moyen' as const },
          // Likes / commentaires / partages sont des VARIATIONS sur la periode, pas des
          // compteurs : YouTube renvoie le solde du jour, et retirer un like donne -1.
          // Le profil de test affichait « LIKES 30j : -1 » (verifie en base le
          // 2026-08-21 : un like retire le 14 aout, aucun ajoute) — un compteur negatif
          // se lit comme un bug alors que la donnee est juste.
          //
          // Le signe rend la nature de la valeur evidente, comme sur « Abonnés nets ».
          // Le zero n'en prend pas : « +0 » annoncerait un gain nul comme un gain.
          { label: 'Likes', value: signeVariation(ytIsFallback ? yt.likes30d : ytLikesP), sub: ytIsFallback ? '30j' : ytEtiquettePeriode, color: (ytIsFallback ? yt.likes30d : ytLikesP) < 0 ? RED : 'var(--ink)', key: 'Likes' },
          { label: 'Commentaires', value: signeVariation(ytIsFallback ? yt.comments30d : ytCommentsP), sub: ytIsFallback ? '30j' : ytEtiquettePeriode, color: (ytIsFallback ? yt.comments30d : ytCommentsP) < 0 ? RED : 'var(--ink)', key: 'Commentaires' },
          { label: 'Partages', value: signeVariation(ytIsFallback ? yt.shares30d : ytSharesP), sub: ytIsFallback ? '30j' : ytEtiquettePeriode, color: (ytIsFallback ? yt.shares30d : ytSharesP) < 0 ? RED : 'var(--ink)', key: 'Partages' },
        ].map((s: any, i) => {
          if (s.custom === 'watch-total') return (
            <div key="wt-total" onClick={() => openStatModal('Watch time', '')} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px', cursor: 'pointer', transition: 'background .15s' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'} onMouseLeave={e => e.currentTarget.style.background = 'var(--surface)'}>
              <div style={{ marginBottom: 10 }}>
                <span className="eyebrow-sm" style={{ color: 'var(--muted)' }}>Watch time</span>
                <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--faint)', marginLeft: 5 }}>{ytEtiquettePeriode}</span>
                {ytDataLagDays >= 2 && (
                  <span
                    title={`Délai de traitement de YouTube Analytics.${ytLastEngagementDateFmt ? ` Dernière donnée disponible : ${ytLastEngagementDateFmt}.` : ''}`}
                    style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 4px', marginLeft: 5, cursor: 'help', whiteSpace: 'nowrap', display: 'inline-block' }}
                  >
                    J-{ytDataLagDays}
                  </span>
                )}
              </div>
              {/* Pas de total en gros chiffre : la carte affiche uniquement la
                  ventilation Shorts / videos longues, comme « Watch time moyen / vue »
                  juste a cote. Le total restait de toute facon lisible en additionnant
                  les deux, et sa presence rompait l'alignement des deux cartes. */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: AMBER, flexShrink: 0 }} />
                    <span style={{ fontSize: 10, color: 'var(--muted)' }}>Shorts</span>
                  </div>
                  <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)' }}>{fmtWatchMin(ytWatchShortsP)}</span>
                </div>
                <div style={{ width: 1, height: 32, background: 'var(--border)', flexShrink: 0 }} />
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#64748b', flexShrink: 0 }} />
                    <span style={{ fontSize: 10, color: 'var(--muted)' }}>Vidéos longues</span>
                  </div>
                  <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)' }}>{fmtWatchMin(ytWatchLongP)}</span>
                </div>
              </div>
            </div>
          );
          if (s.custom === 'watch-moyen') return (
            <div key="wt-moyen" onClick={() => openStatModal('Watch time moyen', '')} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px', cursor: 'pointer', transition: 'background .15s' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'} onMouseLeave={e => e.currentTarget.style.background = 'var(--surface)'}>
              {/* Seule carte de la rangee sans mention de fenetre : elle n'est PAS sur
                  la periode. avgWatchShorts / avgWatchLong somment le watch time et les
                  vues de toutes les videos de la chaine, donc du depuis-toujours. Ses
                  quatre voisines affichent « 30j » ou « 7j ». L'ecart etait invisible
                  (constate a l'ecran le 2026-08-21).

                  Pas de badge J-3 non plus : sur du cumul depuis la publication, trois
                  jours de retard ne changent rien de lisible — contrairement a un
                  chiffre du jour. */}
              {/* Titre raccourci en « Watch time moyen » : avec « / vue » plus la mention
                  de periode, l'en-tete passait sur deux lignes et decalait cette carte
                  par rapport a ses quatre voisines. « / vue » etait de toute facon
                  redondant avec « moyen ».
                  La carte est desormais sur la periode, comme ses voisines : elle porte
                  donc la meme etiquette qu'elles, et le badge de fraicheur qui lui
                  manquait. */}
              <div style={{ marginBottom: 10, whiteSpace: 'nowrap' }}>
                <span className="eyebrow-sm" style={{ color: 'var(--muted)' }}>Watch time moyen</span>
                <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--faint)', marginLeft: 5 }}>{ytEtiquettePeriode}</span>
                {ytDataLagDays >= 2 && (
                  <span
                    title={`Délai de traitement de YouTube Analytics.${ytLastEngagementDateFmt ? ` Dernière donnée disponible : ${ytLastEngagementDateFmt}.` : ''}`}
                    style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 4px', marginLeft: 5, cursor: 'help', whiteSpace: 'nowrap', display: 'inline-block' }}
                  >
                    J-{ytDataLagDays}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#f43f5e', flexShrink: 0 }} />
                    <span style={{ fontSize: 10, color: 'var(--muted)' }}>Shorts</span>
                  </div>
                  <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)' }}>{avgWatchShorts !== null ? fmtSec(avgWatchShorts) : '—'}</span>
                </div>
                <div style={{ width: 1, height: 32, background: 'var(--border)', flexShrink: 0 }} />
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: YT_COLOR, flexShrink: 0 }} />
                    <span style={{ fontSize: 10, color: 'var(--muted)' }}>Vidéos longues</span>
                  </div>
                  <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)' }}>{avgWatchLong !== null ? fmtSec(avgWatchLong) : '—'}</span>
                </div>
              </div>
            </div>
          );
          return (
            <div key={s.label} onClick={s.key ? () => openStatModal(s.key!, s.value) : undefined} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px', cursor: s.key ? 'pointer' : 'default', transition: 'background .15s' }}
              onMouseEnter={e => { if (s.key) e.currentTarget.style.background = 'var(--surface-2)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'var(--surface)'; }}>
              <div style={{ marginBottom: 8 }}>
                <span className="eyebrow-sm" style={{ color: 'var(--muted)' }}>{s.label}</span>
                {s.sub && <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--faint)', marginLeft: 5 }}>{s.sub}</span>}
                {/* Badge de fraicheur — pose selon la SOURCE de la carte, pas son nom.
                    YouTube expose trois APIs aux delais differents :
                      - Data API v3 (youtube/v3)        : totaux, TEMPS REEL ;
                      - Analytics API (youtubeanalytics) : donnees par jour, J-3 ;
                      - Reporting API (youtubereporting) : CTR, ~J-2.
                    Le badge ne concerne que les cartes lisant l'Analytics API. Deux
                    exceptions : « Abonnes » (total de chaine, Data API v3) et « Videos
                    publiees » (compte par date de publication, connue immediatement).
                    Le nombre de jours est calcule : si Google rattrape, le badge
                    disparait tout seul. */}
                {ytDataLagDays >= 2 && !['Abonnés', 'Vidéos publiées'].includes(s.label) && (
                  <span
                    title={`Délai de traitement de YouTube Analytics.${ytLastEngagementDateFmt ? ` Dernière donnée disponible : ${ytLastEngagementDateFmt}.` : ''}`}
                    style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 4px', marginLeft: 5, cursor: 'help', whiteSpace: 'nowrap', display: 'inline-block' }}
                  >
                    J-{ytDataLagDays}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</div>
            </div>
          );
        })}
      </div>

      <div ref={refGraphiques} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 18 }}>
        <Card title="Vues / jour" sub={`${libelleFenetre(period, periodIndex ?? 0, sinceConnection, allTimeStart)}${ytLagSuffix}`}>
          {(() => {
            // null (pas 0) sur les jours sans vraie donnée — même traitement que
            // "Abonnés nets / jour" juste en dessous : sinon une barre à 0 est
            // indiscernable d'un vrai jour sans vue.
            const vuesCourbe = regrouperSerieAffichee(
              ytDays.map(d => ({ date: d.date, v: ytDaysNoDataSet.has(d.date) ? null : ((d.views ?? null) as number | null) })),
              'comptage',
            );
            const viewsForChart = vuesCourbe.data.map(p => ({ date: p.date, views: p.v, libelle: p.libelle }));
            const allPending = viewsForChart.every(d => d.views === null);
            // Meme hauteur que le graphique : la carte gardait 220 px avec la courbe et
            // retombait a ~77 px avec le message, ce qui faisait remonter tout le bas de
            // la page selon la periode consultee.
            if (allPending) return <ZoneGraphique height={220}><Empty msg="Pas encore de données" /></ZoneGraphique>;
            // Même formule que le composant partagé AreaChart (components/charts/AreaChart.tsx) :
            // ~9 labels max en vue mois, tous les jours affichés en vue semaine.
            return (
              <ResponsiveContainer width="100%" height={220} initialDimension={{ width: 600, height: 220 }}>
                <ComposedChart data={viewsForChart} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={vuesCourbe.pas === 1 && period === 7 ? fmtAxisDateWithDay : fmtAxisDate} ticks={vuesCourbe.pas > 1 ? undefined : datesAxe(viewsForChart.map(d => d.date), period, largeurGraphiques * 0.62)} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="views" name="Vues" fill="var(--accent-brand)" radius={[2, 2, 0, 0]} opacity={0.8} />
                </ComposedChart>
              </ResponsiveContainer>
            );
          })()}
        </Card>
        {/* Les quatre repartitions (ici, plus Sources de trafic / Mots-cles /
            Demographie) sont collectees sur une fenetre FIXE de 30 jours glissants
            (repartitionStart dans poll-leads), independamment de la periode choisie en
            haut de page. Naviguer vers « Mars 2026 » ou « 7 derniers jours » ne les
            change pas.
            Rien ne le disait a l'ecran : tout le reste de la page suit la periode, ces
            blocs non — l'ecart etait invisible (constate le 2026-08-21). */}
        <Card title="Appareils" sub="30 derniers jours">
          <ResponsiveContainer width="100%" height={220} initialDimension={{ width: 600, height: 220 }}>
            <PieChart>
              <Pie data={deviceData} cx="50%" cy="50%" outerRadius={80} dataKey="views" nameKey="name" label={({ name, percent }: { name?: string; percent?: number }) => `${name ?? ''} ${((percent ?? 0) * 100).toFixed(0)}%`} labelLine={false}>
                {deviceData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i]} />)}
              </Pie>
              <Tooltip formatter={(v: any) => fmt(v)} />
            </PieChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card title="Abonnés nets / jour" sub={`${libelleFenetre(period, periodIndex ?? 0, sinceConnection, allTimeStart)}${ytLagSuffix}`}>
        {(() => {
          // null (pas 0) sur les jours sans vraie donnée — sinon la ligne continue à plat
          // jusqu'à la fin de la période au lieu de s'arrêter au dernier point réel, même
          // bug que sur les autres graphiques YT de cette page. netSubs:null (pas 0) sur
          // les jours sans ligne — même traitement qu'un jour futur, aucun point affiché.
          const netSubsForChart = ytDays.map(d => ({
            date: d.date,
            netSubs: ytDaysNoDataSet.has(d.date) ? (null as any) : (d.netSubs ?? 0),
          }));
          const allPending = netSubsForChart.every(d => d.netSubs === null);
          // Meme hauteur que le graphique (160 px), comme la carte « Vues » au-dessus.
          if (allPending) return <ZoneGraphique height={160}><Empty msg="Pas encore de données" /></ZoneGraphique>;
          // PAS de court-circuit « aucun mouvement » : une ligne plate a zero dit
          // « aucun abonne perdu sur la periode », ce qui est une information reelle
          // et rassurante. Le message vide qui s'affichait a la place laissait croire
          // a une donnee manquante — c'est ce que Chris voyait le 2026-08-21 en
          // signalant « je vois absolument rien, aucun graphique ». L'axe symetrique
          // ci-dessous rend justement cette ligne plate lisible, centree sur zero.
          return (
            <ResponsiveContainer width="100%" height={160} initialDimension={{ width: 600, height: 160 }}>
              <ReAreaChart data={netSubsForChart} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="grad-yt-netsubs" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={GREEN} stopOpacity={0.18} />
                    <stop offset="95%" stopColor={GREEN} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={period === 7 ? fmtAxisDateWithDay : fmtAxisDate} ticks={datesAxe(netSubsForChart.map(d => d.date), period, largeurGraphiques)} />
                {(() => {
                  const borne = borneAbonnesNets(netSubsForChart.map(d => d.netSubs));
                  return (
                    <YAxis
                      tick={{ fontSize: 10, fill: 'var(--muted)' }}
                      axisLine={false}
                      tickLine={false}
                      allowDecimals={false}
                      domain={domaineAbonnesNets(borne)}
                      ticks={graduationsAbonnesNets(borne)}
                    />
                  );
                })()}
                {/* Pas de ReferenceLine sur zero : la CartesianGrid trace deja une ligne
                    a chaque graduation, dont zero, en pointilles discrets. La superposer
                    d'un trait plein var(--border) dessinait une barre blanche en travers
                    du graphique (signale le 2026-08-21). */}
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="netSubs" name="Abonnés nets" stroke={GREEN} strokeWidth={2} fill="url(#grad-yt-netsubs)" dot={todayDotFactory(GREEN, 'date', lastRealPointKey(netSubsForChart, 'date', 'netSubs'))} activeDot={{ r: 4, strokeWidth: 0, fill: GREEN }} isAnimationActive={false} />
              </ReAreaChart>
            </ResponsiveContainer>
          );
        })()}
      </Card>

      {/* Ce tableau melange les deux sources : « Vues totales », « Likes » et « Durée »
          viennent de la Data API v3 (temps reel), « Vues 30j » et « Retention » de
          l'Analytics API (J-3). D'ou une mention qui precise QUELLES colonnes sont en
          retard, plutot qu'un badge global qui laisserait croire que tout l'est. */}
      <Card title={`Vidéos (${yt.videos.length})`} sub={`Clic → courbe de rétention${ytLagSuffix ? ` · vues 30j et rétention en J-${ytDataLagDays}` : ''}`}>
        {/* Filtre Short / Vidéo / Tous */}
        <div style={{ display: 'flex', gap: 3, background: 'var(--surface-2)', borderRadius: 7, padding: 3, marginBottom: 12, width: 'fit-content' }}>
          {([['all', 'Tous'], ['short', 'Short'], ['long', 'Vidéo']] as const).map(([key, label]) => (
            <button key={key} onClick={() => setVideosTypeFilter(key)} style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 5, cursor: 'pointer', border: 'none', background: videosTypeFilter === key ? 'var(--surface)' : 'transparent', color: videosTypeFilter === key ? 'var(--ink)' : 'var(--faint)', transition: 'all .15s' }}>
              {label}
            </button>
          ))}
        </div>
        <table className="table" style={{ width: '100%' }}>
          <thead>
            <tr>
              {([
                ['', null],
                ['Titre', null],
                ['Type', null],
                ['Vues totales', 'views'],
                ['Vues 30j', 'views30d'],
                ['Rétention', 'avgViewPct'],
                ['Durée', null],
                ['Likes', 'likes'],
                ['Date', 'publishedAt'],
              ] as [string, typeof videosSortKey | null][]).map(([h, key]) => {
                const active = key !== null && videosSortKey === key;
                return (
                  <th key={h} onClick={key ? () => { if (active) setVideosSortDir(d => d === 'desc' ? 'asc' : 'desc'); else { setVideosSortKey(key); setVideosSortDir('desc'); } } : undefined}
                    className="eyebrow-sm" style={{ textAlign: 'left', color: active ? BLUE : 'var(--muted)', padding: '8px 10px', cursor: key ? 'pointer' : 'default', userSelect: 'none', whiteSpace: 'nowrap' }}>
                    {h} {active ? (videosSortDir === 'desc' ? '↓' : '↑') : ''}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {yt.videos
              .filter(v => videosTypeFilter === 'all' ? true : videosTypeFilter === 'short' ? v.isShort : !v.isShort)
              .sort((a, b) => {
                // La retention se trie sur la valeur AFFICHEE, pas sur celle du
                // snapshot : sans ca, l'ordre des lignes ne correspondrait plus aux
                // chiffres de la colonne — une incoherence d'autant plus penible
                // qu'elle n'apparait qu'apres un clic sur l'en-tete.
                const val = (v: typeof a): number => videosSortKey === 'avgViewPct'
                  ? (retentionVivante?.get(v.id) ?? v.avgViewPct ?? 0)
                  : Number((v as any)[videosSortKey] ?? 0);
                const av = videosSortKey === 'publishedAt' ? new Date(a.publishedAt).getTime() : val(a);
                const bv = videosSortKey === 'publishedAt' ? new Date(b.publishedAt).getTime() : val(b);
                return videosSortDir === 'desc' ? bv - av : av - bv;
              })
              .slice(0, showAllVideos ? undefined : VIDEOS_PREVIEW)
              .map(v => (
              <tr key={v.id} onClick={() => { setSelectedVideo(v); setJobCreatedAt(null); setVideoCtr(null); setCtrPending(false); setRetention(null); setRetentionSummary(null); loadRetention(v.id, v.publishedAt); }}
                style={{ cursor: 'pointer' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                onMouseLeave={e => (e.currentTarget.style.background = '')}>
                <td style={{ padding: '10px' }}>
                  {v.thumbnail ? <img loading="lazy" decoding="async" src={v.thumbnail} alt="" style={{ width: 56, height: 32, objectFit: 'cover', borderRadius: 4 }} /> : <div style={{ width: 56, height: 32, borderRadius: 4, background: 'var(--surface-2)' }} />}
                </td>
                <td style={{ padding: '10px', maxWidth: 200 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.title}</div>
                </td>
                <td style={{ padding: '10px' }}>
                  <span style={{ fontSize: 10, background: v.isShort ? RED + '20' : '#3a6a8620', color: v.isShort ? RED : 'var(--accent-brand)', borderRadius: 4, padding: '2px 6px', fontWeight: 600 }}>
                    {v.isShort ? 'Short' : 'Vidéo'}
                  </span>
                </td>
                <td style={{ padding: '10px', fontSize: 13, fontWeight: 600 }}>{fmt(v.views)}</td>
                {/* Le « + » etait ecrit en dur : une video sans vue sur la periode
                    affichait « +0 », ce qui se lit comme un gain nul annonce comme un
                    gain. Zero n'a pas de signe. */}
                <td style={{ padding: '10px', fontSize: 13, color: v.views30d > 0 ? GREEN : 'var(--muted)', fontWeight: 600 }}>{v.views30d > 0 ? `+${fmt(v.views30d)}` : fmt(v.views30d)}</td>
                {/* Au-dela de 100 %, la valeur est JUSTE mais illisible sous un libelle
                    « Retention » : elle se lit comme « 111 % de la video vue », ce qui
                    n'a pas de sens. C'est en realite du re-visionnage — sur un Short de
                    22 secondes, les spectateurs le regardent en boucle, et l'API compte
                    chaque passage.
                    Verifie contre l'API le 2026-08-21 : sur toute la vie de la chaine
                    ces videos sont a 41,9 % et 75,9 %. C'est la fenetre de 30 JOURS du
                    cron qui produit ces valeurs superieures a 100 %, sur un petit nombre
                    de spectateurs recents.
                    On affiche « >100 % » avec l'explication au survol : annoncer un
                    chiffre precis donnerait une fausse impression d'exactitude. */}
                <td style={{ padding: '10px', fontSize: 13 }}>
                  {(() => {
                    // Repli sur la valeur du snapshot quand la video n'est pas dans la
                    // liste vivante : l'API n'en renvoie que 50. Un chiffre approche
                    // vaut mieux qu'un trou, et le cas est rare.
                    const retention = retentionVivante?.get(v.id) ?? v.avgViewPct;
                    return !retention ? '—' : retention > 100 ? (
                      <span
                        title={`${fmtPct(retention)} en moyenne sur toute la vie de la vidéo : au-delà de 100 %, cela signifie que les spectateurs ont revu des passages. Fréquent sur les Shorts, qui tournent en boucle.`}
                        style={{ cursor: 'help', borderBottom: '1px dotted var(--muted)' }}
                      >
                        &gt;100&nbsp;%
                      </span>
                    ) : fmtPct(retention);
                  })()}
                </td>
                <td style={{ padding: '10px', fontSize: 12, color: 'var(--muted)' }}>{v.duration}</td>
                <td style={{ padding: '10px', fontSize: 13 }}>{fmt(v.likes)}</td>
                <td style={{ padding: '10px', fontSize: 11, color: 'var(--muted)' }}>{new Date(v.publishedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: '2-digit' })}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {yt.videos.length > VIDEOS_PREVIEW && (
          <button
            type="button"
            onClick={() => setShowAllVideos(v => !v)}
            style={{
              display: 'block', width: '100%', marginTop: 10, padding: '8px 0',
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 12, fontWeight: 600, color: 'var(--accent-brand)', fontFamily: 'inherit',
            }}
          >
            {showAllVideos ? 'Replier' : `Voir toutes les vidéos (${yt.videos.length})`}
          </button>
        )}
      </Card>

      {/* Trois colonnes : ces blocs etaient sous la liste complete des videos, donc
          invisibles sans un long scroll. La demographie les rejoint plutot que d'ouvrir
          une quatrieme ligne. */}
      {/* Les trois cartes partagent une hauteur minimale : cote a cote dans une grille,
          elles s'alignaient sur la plus haute et laissaient un vide sous les autres des
          qu'une seule avait moins de lignes (ou son message « pas encore de donnees »).
          180 px = 10 lignes de liste, le cas plein. */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 18, alignItems: 'stretch' }}>
        <Card title="Sources de trafic" sub="Vues par source · 30 derniers jours">
          <div style={{ minHeight: 180 }}>
          {trafficData.map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              {/* Plus de textTransform : les noms sont deja rediges (nomSourceTrafic).
                  « capitalize » mettrait une majuscule a chaque mot — « Recherche
                  Youtube » au lieu de « Recherche YouTube ». */}
              <div style={{ fontSize: 11, color: 'var(--muted)', width: 110 }}>{s.name}</div>
              <div style={{ flex: 1, height: 6, background: 'var(--border)', borderRadius: 3 }}>
                <div style={{ height: 6, width: `${pct(s.views, trafficData[0]?.views || 1)}%`, background: 'var(--accent-brand)', borderRadius: 3 }} />
              </div>
              <div style={{ fontSize: 11, fontWeight: 600, width: 40, textAlign: 'right' }}>{fmt(s.views)}</div>
            </div>
          ))}
          {/* Cette carte etait la seule des trois sans etat vide : quand l'API ne
              renvoie aucune source, elle affichait un bloc muet. */}
          {trafficData.length === 0 && <Empty msg="Pas encore de données de trafic" />}
          </div>
        </Card>
        <Card title="Mots-clés de recherche" sub="Top 10 termes · 30 derniers jours">
          <div style={{ minHeight: 180 }}>
          {yt.searchKeywords.slice(0, 10).map((k, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k.term}</div>
              <div style={{ fontSize: 11, fontWeight: 600 }}>{fmt(k.views)}</div>
            </div>
          ))}
          {yt.searchKeywords.length === 0 && <Empty msg="Pas encore de données de recherche" />}
          </div>
        </Card>

        {/* Repartition de l'audience par age et sexe. La donnee etait chargee depuis
            l'API mais n'etait affichee NULLE PART. YouTube ne la divulgue qu'au-dela
            d'un seuil de spectateurs (confidentialite) : d'ou le message explicite
            plutot qu'un bloc vide, tant que la chaine n'y est pas. */}
        <Card title="Démographie" sub="Âge et sexe · 30 derniers jours">
          <div style={{ minHeight: 180 }}>
          {[...yt.demographics]
            .sort((a, b) => b.viewerPct - a.viewerPct)
            .slice(0, 10)
            .map((d, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', width: 96 }}>
                  {d.ageGroup.replace('age', '')} {d.gender === 'male' ? 'H' : d.gender === 'female' ? 'F' : ''}
                </div>
                <div style={{ flex: 1, height: 6, background: 'var(--border)', borderRadius: 3 }}>
                  <div style={{ height: 6, width: `${Math.min(100, d.viewerPct)}%`, background: 'var(--accent-brand)', borderRadius: 3 }} />
                </div>
                <div style={{ fontSize: 11, fontWeight: 600, width: 40, textAlign: 'right' }}>{d.viewerPct.toFixed(1)}%</div>
              </div>
            ))}
          {yt.demographics.length === 0 && <Empty msg="Pas encore assez de spectateurs — YouTube ne fournit cette donnée qu'au-delà d'un seuil" />}
          </div>
        </Card>
      </div>

      {/* Modal stat YT */}
      {statModal && (
        <ModalOverlay onClose={() => setStatModal(null)}>
          <div style={{ background: 'var(--surface)', borderRadius: 20, padding: '32px 32px 28px', width: '100%', maxWidth: 720, boxShadow: '0 24px 60px rgba(0,0,0,.18)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>{statModal.label}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                  Jour par jour · {libelleFenetre(period, periodIndex ?? 0, sinceConnection, allTimeStart)}
                  {['Likes', 'Commentaires', 'Partages'].includes(statModal.label) && ytLastEngagementDateFmt && (
                    <> · délai Google 2-3j, dernière donnée : {ytLastEngagementDateFmt}</>
                  )}
                </div>
                {/* L'API YouTube renvoie estimatedMinutesWatched en minutes ENTIERES.
                    Sur une chaine peu active, la plupart des journees tombent donc a 0
                    alors qu'il y a eu du visionnage : verifie en base le 2026-08-21, 30
                    des 35 jours mesures affichaient 0, dont 15 ou l'on sait qu'il y a eu
                    des vues — environ 10 minutes effacees par l'arrondi.
                    On garde la valeur de l'API (jamais de chiffre reconstitue, choix de
                    Chris) et on explique le zero plutot que de le laisser passer pour une
                    absence de visionnage. */}
                {statModal.label.includes('Watch time') && !statModal.label.includes('moyen') && (
                  <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 3, maxWidth: 460, lineHeight: 1.4 }}>
                    YouTube arrondit à la minute entière : une journée avec moins de 30 secondes
                    de visionnage apparaît à 0.
                  </div>
                )}
              </div>
              <button onClick={() => setStatModal(null)} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--muted)', lineHeight: 1 }}>×</button>
            </div>
            {statModal.data2 ? (() => {
              const color1 = statModal.color;
              const color2 = statModal.color2 || '#64748b';
              // Deux modales portent « Watch time » dans leur titre, avec des unites
              // DIFFERENTES : « Watch time moyen / vue » est en secondes, « Watch time »
              // (le total, separe par format) est en minutes.
              //
              // Le test includes('Watch time') attrapait les deux : les minutes du total
              // etaient formatees comme des secondes, d'ou un axe gradue « 0m01s » pour
              // des valeurs en minutes, et un total affiche « 0m06s » alors que c'etait
              // la moyenne (constate par Chris le 2026-08-21).
              const isWatchTimeMoyen = statModal.label.includes('Watch time moyen');
              const isWatchTimeTotal = !isWatchTimeMoyen && statModal.label.includes('Watch time');
              // Pas de "?? 0" sur longues : ça écrasait le null posé en amont (isFutureDayYT)
              // sur les jours futurs, retransformant un vrai "pas de donnée" en faux zéro —
              // la ligne "Vidéos longues" continuait alors à plat jusqu'à fin de période au
              // lieu de s'arrêter au point pulsant, contrairement à "shorts" (déjà correct).
              const merged = statModal.data.map((d, i) => ({
                date: d.date,
                shorts: d.v,
                longues: statModal.data2![i]?.v ?? null,
              }));
              // Trois formats de valeur selon la modale : secondes (watch time moyen),
              // minutes/heures (watch time total), entier brut (videos publiees).
              const formatVal = (v: number) =>
                isWatchTimeMoyen ? fmtSec(v) : isWatchTimeTotal ? fmtWatchMin(v) : fmt(v);
              const val1 = isWatchTimeMoyen
                ? (avgWatchShorts !== null ? fmtSec(avgWatchShorts) : '—')
                : isWatchTimeTotal ? fmtWatchMin(ytWatchShortsP) : `${fmt(ytShortsCount)}`;
              const val2 = isWatchTimeMoyen
                ? (avgWatchLong !== null ? fmtSec(avgWatchLong) : '—')
                : isWatchTimeTotal ? fmtWatchMin(ytWatchLongP) : `${fmt(ytLongCount)}`;
              // Même formule que le composant partagé AreaChart (components/charts/AreaChart.tsx) :
              // ~9 labels max en vue mois, tous les jours affichés en vue semaine.
              const shortsLongTickInterval = period === 7 ? 0 : Math.max(1, Math.ceil(merged.length / 9) - 1);
              return (
                <>
                  <div style={{ display: 'flex', gap: 32, marginBottom: 20 }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: color1 }} />
                        <span className="eyebrow-sm" style={{ color: 'var(--muted)' }}>Shorts</span>
                      </div>
                      <span style={{ fontSize: 28, fontWeight: 800, color: 'var(--ink)' }}>{val1}</span>
                    </div>
                    <div style={{ width: 1, background: 'var(--border)', alignSelf: 'stretch' }} />
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: color2 }} />
                        <span className="eyebrow-sm" style={{ color: 'var(--muted)' }}>{statModal.label2 || 'Vidéos longues'}</span>
                      </div>
                      <span style={{ fontSize: 28, fontWeight: 800, color: 'var(--ink)' }}>{val2}</span>
                    </div>
                  </div>
                  <ResponsiveContainer width="100%" height={220} initialDimension={{ width: 600, height: 220 }}>
                    <ReAreaChart data={merged} margin={{ top: 4, right: 8, left: 0, bottom: 24 }}>
                      <defs>
                        <linearGradient id="grad-yt-shorts" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={color1} stopOpacity={0.15} />
                          <stop offset="95%" stopColor={color1} stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="grad-yt-longues" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={color2} stopOpacity={0.15} />
                          <stop offset="95%" stopColor={color2} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={period === 7 ? fmtAxisDateWithDay : fmtAxisDate} interval={shortsLongTickInterval} />
                      <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={isWatchTimeMoyen || isWatchTimeTotal ? 50 : 36} tickFormatter={formatVal} />
                      <Tooltip content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        return (
                          <div className="chart-tooltip">
                            <div className="chart-tooltip-label">{label}</div>
                            {payload.map((p: any, i: number) => (
                              <div key={i} className="chart-tooltip-row" style={{ color: p.color }}>
                                <span>{p.name}</span><strong style={{ marginLeft: 8 }}>{formatVal(p.value)}</strong>
                              </div>
                            ))}
                          </div>
                        );
                      }} />
                      <Area type="monotone" dataKey="shorts" name="Shorts" stroke={color1} strokeWidth={2} fill="url(#grad-yt-shorts)" dot={todayDotFactory(color1, 'date', lastRealPointKey(merged, 'date', 'shorts'))} activeDot={{ r: 4, strokeWidth: 0, fill: color1 }} isAnimationActive={false} />
                      <Area type="monotone" dataKey="longues" name="Vidéos longues" stroke={color2} strokeWidth={2} fill="url(#grad-yt-longues)" dot={todayDotFactory(color2, 'date', lastRealPointKey(merged, 'date', 'longues'))} activeDot={{ r: 4, strokeWidth: 0, fill: color2 }} isAnimationActive={false} />
                    </ReAreaChart>
                  </ResponsiveContainer>
                </>
              );
            })() : (() => {
              // Ticks calculés explicitement (au lieu d'un domain en callback) pour les
              // métriques sans unité (compteurs entiers) — Recharts génère par défaut des
              // graduations "nice" qui peuvent déborder du domaine fourni même avec
              // (ex: un tick "-1" affiché alors qu'aucune valeur réelle
              // n'est négative). Fournir la liste exacte des ticks élimine cet arrondi
              // automatique hors de contrôle.
              const vals = statModal.data.map(d => d.v).filter((v): v is number => v !== null && v !== undefined);
              const dataMin = vals.length > 0 ? Math.min(...vals) : 0;
              const dataMax = vals.length > 0 ? Math.max(...vals) : 0;
              const isCounter = statModal.unit == null;
              // Les abonnes nets sont une metrique signee : zero doit tomber au milieu,
              // pas en bas. La regle generique ci-dessous ecrase le domaine vers [0, n]
              // des que dataMin >= 0 (Math.max(0, lo)) — donc sur une chaine sans
              // mouvement, toutes les valeurs a 0, la ligne se collait en bas.
              //
              // Meme axe que la section « Abonnes nets / jour » et que l'autre modale :
              // une seule regle, borneAbonnesNets, appliquee partout (constate le
              // 2026-08-21 sur la vignette du KPI).
              const estAbonnesNets = statModal.label === 'Abonnés nets' || statModal.label === 'Abonnés nets YT';
              const range = dataMax - dataMin;
              const margin = isCounter ? Math.max(1, Math.ceil(range * 0.1)) : (range > 0 ? range * 0.1 : 1);
              const lo = dataMin - margin;
              const borneNets = estAbonnesNets ? borneAbonnesNets(statModal.data.map(d => d.v)) : 0;
              const yDomain: [number, number] = estAbonnesNets
                ? domaineAbonnesNets(borneNets)
                : [dataMin >= 0 ? Math.max(0, lo) : lo, dataMax + margin];
              const yTicks = estAbonnesNets
                ? graduationsAbonnesNets(borneNets)
                : isCounter
                ? Array.from({ length: Math.floor(yDomain[1]) - Math.ceil(yDomain[0]) + 1 }, (_, i) => Math.ceil(yDomain[0]) + i)
                    .filter((_, i, arr) => arr.length <= 6 || i % Math.ceil(arr.length / 6) === 0)
                : undefined;
              // Même formule que le composant partagé AreaChart (components/charts/AreaChart.tsx).
              const generalTickInterval = period === 7 ? 0 : Math.max(1, Math.ceil(statModal.data.length / 9) - 1);
              return (
              <ResponsiveContainer width="100%" height={220} initialDimension={{ width: 600, height: 220 }}>
                <ReAreaChart data={statModal.data} margin={{ top: 4, right: 8, left: 0, bottom: 24 }}>
                  <defs>
                    <linearGradient id="grad-yt-stat-modal" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={statModal.color} stopOpacity={0.2} />
                      <stop offset="95%" stopColor={statModal.color} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  {/* Grille sur les metriques signees seulement : elle marque chaque
                      graduation, zero compris, ce qui rend le milieu de l'axe lisible.
                      Meme rendu que la section et que l'autre modale. */}
                  {estAbonnesNets && <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />}
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={period === 7 ? fmtAxisDateWithDay : fmtAxisDate} interval={generalTickInterval} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={44} allowDecimals={!isCounter} domain={yDomain} ticks={yTicks} tickFormatter={(v: number) => v >= 1000 ? `${Math.round(v / 1000)}k` : (isCounter ? String(Math.round(v)) : String(v))} />
                  <Tooltip content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    return <div className="chart-tooltip"><div className="chart-tooltip-label">{(payload[0].payload as any)?.libelle ?? label}</div><div className="chart-tooltip-row"><strong>{fmt(payload[0].value as number)}{statModal.unit ?? ''}</strong></div></div>;
                  }} />
                  <Area type="monotone" dataKey="v" stroke={statModal.color} strokeWidth={2} fill="url(#grad-yt-stat-modal)" dot={todayDotFactory(statModal.color, 'date', lastRealPointKey(statModal.data, 'date', 'v'))} activeDot={{ r: 4, strokeWidth: 0, fill: statModal.color }} isAnimationActive={false} />
                </ReAreaChart>
              </ResponsiveContainer>
              );
            })()}
          </div>
        </ModalOverlay>
      )}

      {selectedVideo && (
        <ModalOverlay onClose={() => { setSelectedVideo(null); setRetention(null); setRetentionSummary(null); }} maxWidth={640}>
          <div style={{ background: 'var(--surface)', borderRadius: 14, padding: 24, width: '100%', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', gap: 14, marginBottom: 16 }}>
              {selectedVideo.thumbnail ? <img loading="lazy" decoding="async" src={selectedVideo.thumbnail} alt="" style={{ width: 120, height: 68, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }} /> : <div style={{ width: 120, height: 68, borderRadius: 8, background: 'var(--surface-2)', flexShrink: 0 }} />}
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.3, marginBottom: 4 }}>{selectedVideo.title}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{new Date(selectedVideo.publishedAt).toLocaleDateString('fr-FR', { dateStyle: 'long' })} · {selectedVideo.duration} · {selectedVideo.isShort ? 'Short' : 'Vidéo'}</div>
              </div>
              <button onClick={() => { setSelectedVideo(null); setRetention(null); setRetentionSummary(null); }} style={{ marginLeft: 'auto', background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--muted)' }}>×</button>
            </div>
            {/* Toutes les stats de cette grille sont "depuis publication" (lifetime),
                pas les 30 derniers jours — demande explicite de Chris. Vient de
                retentionSummary (appel live YT Analytics, même fenêtre startDate=
                publishedAt que la courbe de rétention) une fois chargé. Pendant le
                chargement on affiche un indicateur visuel plutôt qu'une valeur DB
                (30j, cron poll-leads) : c'est une métrique différente (lifetime vs
                30j glissants) et l'afficher comme si c'était la même donnée en cours
                d'arrivée créait un "saut" trompeur pire que l'attente courte. Likes/
                Commentaires restent affichés immédiatement : même source des deux
                côtés (Data API v3), donc pas de saut possible. */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
              {[
                ['Vues totales', fmt(selectedVideo.views)],
                // Vues engagees : spectateurs qui ont vraiment regarde, par opposition a
                // une vue comptee des les premieres secondes. Le ratio dit combien de
                // curieux sont devenus de vrais spectateurs.
                ['Vues engagées', loadingRetention ? <MiniLoadingDots /> : (() => {
                  const ev = retentionSummary?.engagedViews;
                  const vp = retentionSummary?.viewsPeriod;
                  if (ev == null) return '—';
                  if (!vp) return fmt(ev);
                  return `${fmt(ev)} (${Math.round((ev / vp) * 100)}%)`;
                })()],
                ['Watch time total', loadingRetention ? <MiniLoadingDots /> : (() => {
                  const min = retentionSummary?.watchTimeMin ?? null;
                  if (min === null) return '—';
                  return dureeDepuisMinutes(min);
                })()],
                // La case existe des le depart, comme ses voisines : elle etait absente
                // pendant le chargement puis surgissait, ce qui decalait toute la grille.
                ...(!selectedVideo.isShort ? [['CTR miniature', (() => {
                  if (loadingRetention) return <MiniLoadingDots />;
                  // Le CTR n'existe QUE pour les videos publiees apres le demarrage du
                  // suivi. YouTube ne fournit les impressions de miniature que via
                  // l'API Reporting, dont le job ne collecte qu'a partir de sa creation :
                  // une video anterieure n'a donc que ses impressions residuelles.
                  //
                  // Sur cette chaine, une video de juin 2025 cumule 2012 vues mais
                  // seulement 113 impressions enregistrees — 0,1 % du reel. Le « CTR »
                  // calcule dessus (1,77 %) ne mesure pas la miniature, il mesure un
                  // fond de traine sur un echantillon minuscule. L'afficher serait un
                  // chiffre faux (verifie en base le 2026-08-21).
                  //
                  // On l'annonce plutot que de faire disparaitre la ligne : une case
                  // absente laisse croire a un oubli, une case qui s'explique informe.
                  const isOlderThanJob = jobCreatedAt && selectedVideo.publishedAt && new Date(selectedVideo.publishedAt) < new Date(jobCreatedAt);
                  if (isOlderThanJob) {
                    const depuis = new Date(jobCreatedAt!).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
                    return (
                      <span
                        title={`YouTube ne fournit les impressions de miniature qu'à partir du démarrage du suivi, le ${depuis}. Cette vidéo est antérieure : les rares impressions enregistrées depuis ne représentent qu'une fraction de son audience réelle, et le CTR calculé dessus serait trompeur. Les vidéos publiées après cette date ont un CTR fiable.`}
                        style={{ cursor: 'help', color: 'var(--muted)', borderBottom: '1px dotted var(--muted)' }}
                      >
                        N/D
                      </span>
                    );
                  }
                  if (ctrPending) return <span style={{ color: 'var(--muted)' }}>Bientôt</span>;
                  return videoCtr !== null ? `${videoCtr}%` : '—';
                })()] as [string, React.ReactNode]] : []),
                ['Likes', fmt(retentionSummary?.likes ?? (loadingRetention ? selectedVideo.likes : 0))],
                ['Commentaires', fmt(retentionSummary?.comments ?? (loadingRetention ? selectedVideo.comments : 0))],
                ['Partages', loadingRetention ? <MiniLoadingDots /> : fmt(retentionSummary?.shares ?? 0)],
              ].map(([label, value], i) => (
                <div key={i} style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
                  <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>{value}</div>
                </div>
              ))}
            </div>
            {/* Bandeau séparé pour Rétention moy. + Durée moyenne d'une vue, comme avant
                la fusion dans la grille du dessus.

                Le bandeau existe des l'ouverture, comme la grille du dessus : il etait
                absent pendant le chargement puis surgissait, ce qui faisait grandir la
                modale sous les yeux. Meme correction que la case CTR plus haut. */}
            <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', padding: '12px 0' }}>
              {[
                ['Rétention moy.', loadingRetention ? <MiniLoadingDots /> : (retentionSummary && retentionSummary.avgViewPercentage !== null ? fmtPct(retentionSummary.avgViewPercentage) : '—')],
                ['Durée moyenne d\'une vue', loadingRetention ? <MiniLoadingDots /> : (retentionSummary && retentionSummary.avgViewDurationSec !== null ? `${Math.floor(retentionSummary.avgViewDurationSec / 60)}:${String(Math.round(retentionSummary.avgViewDurationSec % 60)).padStart(2, '0')}` : '—')],
              ].map(([label, value], i) => (
                <div key={i} style={{ flex: 1, textAlign: 'center', borderLeft: i > 0 ? '1px solid var(--border)' : 'none' }}>
                  <div style={{ fontSize: 18, fontWeight: 800 }}>{value}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{label}</div>
                </div>
              ))}
            </div>
            <div style={{ marginBottom: 8, fontSize: 12, fontWeight: 600 }}>Courbe de rétention</div>
            {/* Hauteur reservee : le loader, le message vide et le graphique occupent
                tous 160 px, sinon la modale grandissait a l'arrivee de la donnee. */}
            <ZoneGraphique height={160}>
            {loadingRetention ? <Loading /> : retention && retention.length > 0
              ? (() => {
                // Parse durée "H:MM:SS" ou "M:SS" en secondes totales
                const parseDurSec = (dur: string) => {
                  const parts = dur.split(':').map(Number);
                  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
                  if (parts.length === 2) return parts[0] * 60 + parts[1];
                  return parts[0] || 0;
                };
                const totalSec = parseDurSec(selectedVideo.duration);
                // Position dans la video (« 3:45 »), pas une duree ecoulee : cette
                // fonction s'appelait `fmtSec` comme celle du watch time, deux notions
                // differentes sous le meme nom dans le meme fichier.
                const fmtSec = positionLecteur;
                const retData = retention.map(p => ({
                  x: totalSec > 0 ? p.ratio * totalSec : p.ratio * 100,
                  pct: Math.round(p.watchRatio * 100),
                }));
                const xTickFormatter = (v: number) => totalSec > 0 ? fmtSec(v) : `${Math.round(v)}%`;
                const xAxisMax = totalSec > 0 ? totalSec : 100;
                return (
                // Hauteur en PIXELS, pas en pourcentage : ZoneGraphique est un conteneur
                // flex dont la hauteur n'est pas encore mesuree au premier rendu, et
                // Recharts avertissait alors « width(-1) and height(-1) » (constate dans
                // la console du navigateur le 2026-08-21). La valeur reste celle de la
                // zone, les deux doivent donc rester alignees.
                <ResponsiveContainer width="100%" height={160} initialDimension={{ width: 600, height: 160 }}>
                  <ReAreaChart data={retData} margin={{ top: 4, right: 8, left: 0, bottom: 24 }}>
                    <defs>
                      <linearGradient id="grad-retention" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={GREEN} stopOpacity={0.18} />
                        <stop offset="95%" stopColor={GREEN} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="x" type="number" domain={[0, xAxisMax]} tickCount={7} tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={xTickFormatter} />
                    <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={36} tickFormatter={(v: number) => `${v}%`} />
                    <Tooltip content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      return (
                        <div className="chart-tooltip">
                          <div className="chart-tooltip-label">{xTickFormatter(label as number)}</div>
                          {payload.map((p: any, i: number) => p.value !== null && (
                            <div key={i} className="chart-tooltip-row">{p.name}: <strong>{p.value}%</strong></div>
                          ))}
                        </div>
                      );
                    }} />
                    <Area type="monotone" dataKey="pct" name="Cette vidéo" stroke={GREEN} strokeWidth={2} fill="url(#grad-retention)" dot={false} activeDot={{ r: 4, strokeWidth: 0, fill: GREEN }} isAnimationActive={false} />
                  </ReAreaChart>
                </ResponsiveContainer>
                );
              })()
              : <Empty msg="Rétention non disponible pour cette vidéo" />}
            </ZoneGraphique>
            <a href={selectedVideo.url} target="_blank" rel="noreferrer" style={{ display: 'block', marginTop: 14, textAlign: 'center', fontSize: 12, color: RED, textDecoration: 'none', fontWeight: 600 }}>
              Voir sur YouTube →
            </a>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
}

// ─── TAB 4 : Funnel & Calls ───────────────────────────────────────────────────

const IG_COLOR = '#c1355e';
const YT_COLOR = '#dc2626';

function FunnelHorizontal({ platform, color, steps }: {
  platform: string;
  color: string;
  steps: { label: string; value: string; sub?: string; rate?: number; rawValue: number; noteTaux?: string; aide?: string }[];
}) {
  const DOT = 64;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 28 }}>
        <div style={{ width: 9, height: 9, borderRadius: '50%', background: color, flexShrink: 0 }} />
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{platform}</div>
      </div>

      {/* Timeline horizontale */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        {/* Ligne de fond qui relie tous les points */}
        <div style={{
          position: 'absolute',
          top: DOT / 2,
          left: DOT / 2,
          right: DOT / 2,
          height: 2,
          background: 'var(--border)',
          zIndex: 0,
        }} />

        {steps.map((step, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, position: 'relative', zIndex: 1 }}>
            {/* Point */}
            <div style={{
              width: DOT,
              height: DOT,
              borderRadius: '50%',
              background: 'var(--ink)',
              border: '4px solid var(--surface)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 0 0 2px var(--ink)',
              flexShrink: 0,
              gap: 1,
            }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#fff', textAlign: 'center', lineHeight: 1 }}>{step.value}</div>
            </div>

            {/* Label + sous-titre + taux sous le point */}
            <div style={{ marginTop: 12, textAlign: 'center', maxWidth: 100 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.3, display: 'flex', alignItems: 'center' }}>{step.label}{step.aide ? <AideColonne texte={step.aide} /> : null}</div>
              {step.sub && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>{step.sub}</div>}
              {step.rate !== undefined && (
                /* Au-dela de 100 %, AMBRE et jamais vert. Le bareme de couleur est
                   cale sur un taux de clic (<1 % rouge, <5 % ambre, sinon vert) : un
                   « 140 % » s'affichait donc en vert vif et se lisait « excellente
                   conversion », alors qu'il dit l'inverse — il y a plus de rendez-vous
                   que de clics traces, donc des reservations qui echappent au suivi. */
                <div
                  title={step.rate > 100
                    ? 'Plus de rendez-vous que de clics tracés sur cette période : des réservations arrivent sans passer par un lien suivi (lien collé à la main, adresse Calendly directe).'
                    : undefined}
                  style={{
                    marginTop: 5,
                    fontSize: 11, fontWeight: 700,
                    cursor: step.rate > 100 ? 'help' : undefined,
                    color: step.rate > 100 ? AMBER : step.rate < 1 ? RED : step.rate < 5 ? AMBER : GREEN,
                  }}
                >
                  {fmt(step.rate, 1)}%
                </div>
              )}
              {/* Au-dela de 100 %, l'explication doit etre LUE, pas survolee : Momentum
                  s'utilise en PWA sur telephone, ou un attribut `title` n'existe pas.
                  L'infobulle ci-dessus reste pour la souris ; cette ligne est la seule
                  version atteignable au doigt.
                  Elle prime sur `noteTaux` : les deux ne peuvent pas coexister, un
                  taux au-dela de 100 % est une information plus urgente que la borne
                  de couverture. */}
              {step.rate !== undefined && step.rate > 100 ? (
                <div style={{ fontSize: 9, color: AMBER, marginTop: 2, lineHeight: 1.3 }}>
                  plus de rendez-vous que de clics tracés — des réservations échappent au suivi
                </div>
              ) : step.noteTaux ? (
                <div style={{ fontSize: 9, color: 'var(--faint)', marginTop: 2, lineHeight: 1.3 }}>{step.noteTaux}</div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}




function TabFunnel({ msgs, calls, callsAllTime, deals, ig, yt, shortio, period, periodIndex, onModalChange, leads: leadsFromProp, prospectLinksData, linkClickedByLeadId, clicksByUrl, sinceConnection, allTimeStart, profileId, joursCollectesShortio, premierJourCollecteShortio, premierClicLienProspect }: { msgs: IGMessages | null; calls: CallRecord[]; callsAllTime?: CallRecord[]; deals?: DealRecord[]; ig: IGStats | null; yt: YTStats | null; shortio: ShortioStats | null; period: Period; periodIndex: number; onModalChange?: (open: boolean) => void; leads?: MockLead[]; prospectLinksData?: any[]; linkClickedByLeadId?: Map<string, string>; clicksByUrl?: Map<string, number>; sinceConnection?: boolean; allTimeStart?: string | null; profileId?: string; joursCollectesShortio?: Set<string>; premierJourCollecteShortio?: string | null; premierClicLienProspect?: string | null }) {
  const leads = leadsFromProp && leadsFromProp.length > 0 ? leadsFromProp : [];
  const [callsFilter, setCallsFilter] = useState<'all' | 'ig' | 'yt'>('all');
  // La table coupait à 20 lignes sans le dire : en All-Time sur un élève actif, la
  // moitié des calls disparaissait sous un résumé qui, lui, les comptait tous.
  const CALLS_PAGE = 20;
  const [callsShown, setCallsShown] = useState(CALLS_PAGE);
  const [expandedHero, setExpandedHero] = useState<number | null>(null);
  const [heroSnapshot, setHeroSnapshot] = useState<{ label: string; value: string; sub: string } | null>(null);
  // Valeurs jamais relues : la modale hérite période et index au moment de l'ouverture
  // (setters appelés plus bas), mais son rendu utilise `period`/`periodIndex` du parent.
  const [, setModalPeriod] = useState<Period>(30);
  const [, setModalPeriodIndex] = useState(0);
  // `estPct` : les colonnes No-show et Close rate sont des pourcentages. Sans cette
  // information, l'axe calculait sa borne haute en ajoutant 12 % de marge au maximum
  // et affichait une graduation à « 112 » sur un taux qui ne peut pas dépasser 100.
  // `enBarres` remplace l'ancien `estClosing` : le critere n'est pas « c'est le
  // closing », c'est la DENSITE de la serie. Un taux de no-show, un close rate ou un
  // revenu par call n'existent que les jours ou il y a eu des calls — quelques points
  // isoles sur un mois. Une courbe reliant ces points dessine des valeurs qui
  // n'existent pas entre eux, et une courbe absente se lit comme un graphique casse ;
  // une barre absente se lit naturellement « rien ce jour-la ».
  // Le reach, les vues et le revenu cumule, eux, ont un point par jour : ils restent
  // en courbe.
  const [expandedEff, setExpandedEff] = useState<{ label: string; value: string; color: string; estPct: boolean; enBarres: boolean; data: { date: string; v: number }[] } | null>(null);
  const now = new Date();

  // ── Fenêtre temporelle de la période sélectionnée (bornes calendaires réelles) ──
  const { periodStart, periodEnd } = getPeriodWindow(periodIndex, period === 7 ? 'week' : 'month');
  // ⚠️ En All-Time, periodStart/periodEnd valent le MOIS EN COURS : getPeriodWindow
  // ignore sinceConnection. Sept endroits de cet onglet s'en servaient encore — les
  // deux boucles jour par jour des modales, les filtres de reach/vues/clics et les
  // libellés — d'où une carte « Calls bookés 17 » ouvrant une courbe qui n'en
  // totalisait que 9, et un taux de passage affiché à 300 % (numérateur all-time,
  // dénominateur borné au mois). Constaté à l'écran le 2026-08-29 ; même défaut que
  // celui corrigé dans TabShortioB le 2026-08-28. La fenêtre d'affichage doit être
  // celle du FETCH, pas celle du mois.
  const winStart = sinceConnection && allTimeStart ? new Date(allTimeStart) : periodStart;
  const winEnd = sinceConnection ? new Date() : periodEnd;
  const windowLabel = sinceConnection
    ? `All-Time · ${libelleFenetre(period, periodIndex, true, allTimeStart)}`
    : libelleFenetre(period, periodIndex);
  const todayUTCStrFunnel = parisDateStr(new Date());
  const isFutureDayFunnel = (date: string) => date > todayUTCStrFunnel;
  // En mode "depuis connexion", calls est déjà borné [connectedAt, aujourd'hui] par le
  // fetch — ne pas re-clipper avec la fenêtre calendaire du mois/semaine en cours.
  const callsInWindow = sinceConnection ? calls : calls.filter(c => {
    const t = new Date(callPeriodDate(c)).getTime();
    return t >= periodStart.getTime() && t <= periodEnd.getTime();
  });

  // ── Calls par plateforme (données réelles uniquement) ──
  const callsIG = callsInWindow.filter(isIGCall);
  const callsYT = callsInWindow.filter(isYTCall);

  // Jours de la fenêtre et index « jour de Paris → calls réservés ce jour-là » :
  // règle unique, dans lib/callSeries.ts, testée par lib/callSeries.test.ts. Les deux
  // découpages qu'elle remplace divergeaient — `new Date('YYYY-MM-DD')` (lu en UTC)
  // dans les modales du hero, `scheduled_at.startsWith(iso)` dans celles du tableau
  // d'efficacité — et aucun des deux ne suivait booked_at, la date sur laquelle le
  // périmètre global filtre (docs/perimetre-stats-referentiel.md, règle 2).
  const windowDays = parisDayRange(winStart, winEnd);
  const callsByBookedDay = (subset: CallRecord[]) => bucketCallsByBookedDay(subset);

  // Toutes les mesures portent sur la MÊME population : les calls actifs. `closes`,
  // `rev` et `noShows` la prenaient sur le sous-ensemble entier, annulés compris,
  // alors que `bookes` et `honores` (isCallHonored) excluent les annulés — un taux
  // de no-show pouvait donc avoir plus de no-shows au numérateur que de calls au
  // dénominateur (docs/perimetre-stats-referentiel.md, règle 4).
  // Continuations : les 2e rendez-vous d'un meme prospect, calcules sur TOUS les
  // calls de la fenetre (pas plateforme par plateforme — un prospect ne change pas
  // de plateforme entre deux rendez-vous). Voir lib/callSeries.ts.
  // Apparie sur `calls` (le jeu complet recu) et NON sur `callsInWindow` : une paire
  // a cheval sur deux periodes serait invisible depuis la fenetre, et le 2e call
  // recompterait comme une opportunite neuve — precisement ce que la regle evite.
  // Le resultat n'est qu'un ensemble d'identifiants ; le filtrage par periode reste
  // fait par les appelants.
  // ⚠️ Apparie sur le jeu COMPLET, jamais sur `calls` — qui est deja coupe sur la
  // periode des que `periodIndex > 0`. Une paire a cheval sur deux periodes devenait
  // sinon invisible depuis la seconde, et le 2e rendez-vous y recomptait comme une
  // opportunite neuve. C'est la regle du referentiel (« apparier sur le jeu le plus
  // large disponible, le filtrage par periode venant ensuite ») et elle etait
  // enfreinte ici.
  //
  // Atteignable au 2026-09-01 sur les donnees reelles : « Testrapportpasse », 1er
  // rendez-vous reserve le 21/08 (semaine 17-23), continuation le 29/08 (semaine
  // 24-30). Sur la semaine 24-30, l'onglet ne voyait que la continuation et la
  // comptait comme une opportunite.
  const tousLesCallsFunnel = callsAllTime ?? calls;
  const continuations = idsDeContinuation(tousLesCallsFunnel);

  // ── QUAND une vente a-t-elle ete faite ? ────────────────────────────────────
  // Le jour du rendez-vous qui a produit l'opportunite — meme regle que `dateDeVente`
  // cote ecriture. Un call booke se produit a la RESERVATION, une vente au RENDEZ-VOUS :
  // deux faits, deux moments, deux dates, sur le meme ecran et c'est voulu.
  //
  // Aligner l'argent sur `booked_at` daterait la vente AVANT le rendez-vous qui l'a
  // produite — faux en permanence, la ou le cas inverse (reserve le 29/08, tenu le
  // 02/09) est rare.
  const representantFunnel = representantDOpportunite(tousLesCallsFunnel);
  const parIdFunnel = new Map(tousLesCallsFunnel.map(c => [c.id, c]));
  const dateVenteDuCall = (c: CallRecord): string | null => {
    const rep = parIdFunnel.get(representantFunnel.get(c.id) ?? c.id) ?? c;
    return (rep as any).scheduled_at ?? (rep as any).booked_at ?? null;
  };

  const calcCalls = (subset: CallRecord[]) => {
    const actifs = subset.filter(c => c.status === 'active');
    // DEUX grains, et un seul mot pour chacun dans toute la page.
    //
    // « Rendez-vous » = tous les creneaux poses. Ne sert QUE de denominateur au
    // no-show, qui mesure la fiabilite d'un creneau : un 2e rendez-vous pose et non
    // honore est un creneau perdu, quelle que soit sa place dans le parcours. C'est
    // la pratique du secteur, le show rate se calcule sur les creneaux poses. Ce
    // denominateur est ECRIT a cote du taux, il ne se deduit pas des bookes.
    const rendezVous = actifs.length;
    const noShows = actifs.filter(c => c.no_show).length;
    // « Calls bookes » et « Calls honores » = des OPPORTUNITES. Mes stats mesure ce
    // que le contenu produit ; un 2e rendez-vous qui prolonge la meme vente n'est
    // produit par aucun nouveau clic, et le compter ferait passer le taux
    // clics -> calls au-dessus de 100 % structurellement et pour toujours.
    const opportunites = actifs.filter(c => !continuations.has(c.id)).length;
    const opportunitesHonorees = actifs.filter(c => isCallHonored(c, now) && !continuations.has(c.id)).length;
    const bookes = opportunites;
    const honores = opportunitesHonorees;
    // `closes` et `rev` gardent le sous-ensemble entier : un deal se compte la ou il a
    // ete signe, meme au 2e rendez-vous. Meme regle partout dans la page.
    const closes = actifs.filter(c => c.deal_closed).length;
    const rev = actifs.reduce((acc, c) => acc + (c.revenue || 0), 0);
    return { bookes, honores, closes, rev, noShows, rendezVous, opportunites, opportunitesHonorees };
  };

  const igCallsLive = calcCalls(callsIG);
  const ytCallsLive = calcCalls(callsYT);

  // noData seulement si période historique sans snapshot IG/YT disponible
  // Ne s'applique PAS aux calls (indépendants des stats IG/YT)
  const noData = periodIndex > 0 && !ig && !yt;

  const inFunnelDateWindow = (dateStr: string) => {
    const t = new Date(dateStr + 'T12:00:00Z').getTime();
    return t >= winStart.getTime() && t <= winEnd.getTime();
  };
  // Portee dedupliquee de Meta, la MEME que l'onglet Instagram (lib/porteeIg.ts).
  //
  // C'etait une somme de valeurs journalieres. La portee compte des PERSONNES : une
  // personne touchee trois jours de suite y comptait trois fois. Ecart mesure sur ce
  // profil — 145 contre 122 sur un mois (18 %), et 502 contre 207 sur l'historique
  // complet (142 %). Les deux chiffres s'affichaient a trois centimetres l'un de
  // l'autre, l'entonnoir montrant 145 pendant que l'onglet Instagram montrait 122.
  //
  // `null` quand la periode n'a jamais ete mesuree : l'ecran affiche un trou. Pas de
  // repli sur la somme des jours — ce serait reintroduire l'erreur en silence.
  const typePortee = typePeriodePour(period, sinceConnection);
  const { data: periodesIgData } = usePeriodesIg(typePortee, profileId);
  const porteeIg = porteeDeLaPeriode(periodesIgData?.periodes, typePortee, parisDateStr(winStart));
  const igReachD: number | null = noData ? null : (porteeIg?.reachTotal ?? null);
  const igBookes  = igCallsLive.bookes;
  const igHonores = igCallsLive.honores;
  const igOpportunites = igCallsLive.opportunitesHonorees;
  const igOpportunitesBookees = igCallsLive.opportunites;
  // Une vente se compte dans la periode de SON OPPORTUNITE, pas dans celle du rendez-vous
  // ou elle a ete signee. Le numerateur comptait les ventes des calls de la fenetre —
  // continuations comprises — pendant que le denominateur comptait des opportunites
  // honorees, qui les excluent. Une vente conclue sur un 2e rendez-vous dont le premier
  // tombe dans une AUTRE periode donnait donc un numerateur sans denominateur, et le taux
  // pouvait depasser 100 %.
  //
  // On part du jeu d'opportunites HONOREES de la fenetre : le numerateur est inclus dans
  // le denominateur par construction, le taux ne peut plus le depasser. Meme regle que
  // `dealsCloses` dans Vue generale (representantDOpportunite).
  const idsOpportunitesHonorees = new Set(
    callsInWindow.filter(c => c.status === 'active' && isCallHonored(c, now) && !continuations.has(c.id))
      .map(c => c.id),
  );
  const closesDeLaPeriode = (filtre: (c: CallRecord) => boolean) =>
    tousLesCallsFunnel.filter(filtre).filter(c =>
      c.deal_closed && idsOpportunitesHonorees.has(representantFunnel.get(c.id) ?? c.id),
    ).length;
  const igCloses  = closesDeLaPeriode(isIGCall);
  // L'argent est date du RENDEZ-VOUS qui l'a produit, pas de la reservation. `calcCalls`
  // le sommait sur `callsInWindow`, filtre sur `booked_at` : un rendez-vous reserve le
  // 29 aout pour le 2 septembre voyait sa vente comptee en aout, avant meme qu'elle
  // n'existe. On repart donc du jeu complet et on filtre sur la date de vente.
  //
  // La SOURCE reste `calls.revenue` (ou `callsEff` a deja injecte le montant du deal) :
  // cet onglet attribue par plateforme, et une vente sans rendez-vous n'a ni plateforme
  // ni contenu a crediter. Elle reste comptee dans Vue generale et l'onglet Revenus.
  // Consequence assumee : le total de cet onglet peut etre inferieur a celui des autres.
  const venteDansLaPeriodeFunnel = (c: CallRecord) => {
    if (sinceConnection) return true;
    const d = dateVenteDuCall(c);
    if (!d) return false;
    const t = new Date(d).getTime();
    return t >= periodStart.getTime() && t <= periodEnd.getTime();
  };
  // Le montant vient de `deals`, jamais de `calls.revenue`. Les deux champs portent deux
  // faits differents : `calls.revenue` est ce que l'eleve a DECLARE dans son rapport,
  // `deals.amount_total` est ce qui est CONTRACTE. Corriger une vente depuis la page
  // Paiements ne reecrit pas le rapport — cas reel en base : le rendez-vous TestBIO porte
  // 3 000 EUR dans `calls.revenue` et 1 200 EUR dans `deals`. L'ecart entre les deux est
  // lui-meme une information, c'est ce que surveille `ventes_sante_montants` : on ne
  // supprime rien, on lit le bon champ.
  //
  // `call_id` non nul : cet onglet attribue par plateforme, et une vente sans rendez-vous
  // n'a ni plateforme ni contenu a crediter. Elle reste comptee dans Vue generale et
  // l'onglet Revenus. Consequence assumee : le total de cet onglet peut etre inferieur a
  // celui des autres — c'est la SOURCE qui differe, pas la date.
  //
  // Somme et non premier deal trouve : un rendez-vous peut en porter plusieurs (avenant
  // signe le meme jour). Aucun cas en base, rien ne l'interdit.
  const montantParCall = new Map<string, number>();
  for (const d of (deals ?? [])) {
    if (!d.call_id || d.status === 'canceled') continue;
    montantParCall.set(d.call_id, (montantParCall.get(d.call_id) ?? 0) + Number(d.amount_total || 0));
  }
  const revDeLaPeriode = (filtre: (c: CallRecord) => boolean) =>
    tousLesCallsFunnel.filter(filtre).filter(venteDansLaPeriodeFunnel)
      .reduce((s, c) => s + (montantParCall.get(c.id) ?? 0), 0);
  const igRev     = revDeLaPeriode(isIGCall);
  const igNoShows = igCallsLive.noShows;
  const igRendezVous = igCallsLive.rendezVous;

  const ytViewsD  = noData ? 0 : (yt ? yt.chartData.filter(d => inFunnelDateWindow(d.date)).reduce((s, d) => s + d.views, 0) : 0);
  const ytBookes  = ytCallsLive.bookes;
  const ytHonores = ytCallsLive.honores;
  const ytOpportunites = ytCallsLive.opportunitesHonorees;
  const ytOpportunitesBookees = ytCallsLive.opportunites;
  const ytCloses  = closesDeLaPeriode(isYTCall);
  const ytRev     = revDeLaPeriode(isYTCall);
  const ytNoShows = ytCallsLive.noShows;
  const ytRendezVous = ytCallsLive.rendezVous;
  const isCalendlyUrl = (l: any) => (l.originalUrl || '').toLowerCase().includes('calendly');
  // Clics Short.io filtrés par période : clicksByUrl (DB) prioritaire, repli sur le
  // chiffre d'API seulement quand les deux fenêtres coïncident.
  const resolveClics = (l: any): number => {
    const urlKey = (l.shortUrl || '').toLowerCase();
    const dbClics = clicksByUrl?.get(urlKey);
    if (dbClics !== undefined) return dbClics;
    // `clicsHumains` porte la fenêtre par défaut de l'API Short.io (30 jours). Le repli
    // n'est donc légitime que sur la période courante de 30 jours. `!sinceConnection`
    // manquait : en All-Time (qui laisse period=30 et periodIndex=0) un lien sans
    // aucun instantané en base rendait un chiffre de 30 jours sous un en-tête
    // « depuis le 09/06 ».
    if (!sinceConnection && periodIndex === 0 && period === 30) return l.clicsHumains || 0;
    return 0;
  };
  // link_category est la source de vérité non-ambiguë pour IG vs YT bio/description
  const ytClicsD = noData ? 0 : (shortio ? shortio.links.filter((l: any) =>
    l.linkCategory === 'calendly_bio_yt' || l.linkCategory === 'calendly_desc_yt'
    || (!l.linkCategory && ((l.linkType === 'bio' && l.bioType === 'youtube') || (l.linkType === 'description' && l.postPlatform === 'YT' && isCalendlyUrl(l))))
  ).reduce((s: number, l: any) => s + resolveClics(l), 0) : 0);

  const igBioClics = noData ? 0 : (shortio ? shortio.links.filter((l: any) =>
    l.linkCategory === 'calendly_bio_ig'
    || (!l.linkCategory && l.linkType === 'bio' && l.bioType === 'instagram' && isCalendlyUrl(l))
  ).reduce((s: number, l: any) => s + resolveClics(l), 0) : 0);
  const igPostClics = noData ? 0 : (shortio ? shortio.links.filter((l: any) =>
    l.linkCategory === 'calendly_desc_ig'
    || (!l.linkCategory && l.linkType === 'description' && l.postPlatform === 'IG' && isCalendlyUrl(l))
  ).reduce((s: number, l: any) => s + resolveClics(l), 0) : 0);
  const isTsInFunnelWindow = (ts: string) => {
    const t = new Date(ts).getTime();
    return t >= winStart.getTime() && t <= winEnd.getTime();
  };
  const igProspectClics = noData ? 0 : (() => {
    if (!prospectLinksData || !linkClickedByLeadId) return 0;
    const isLMPl = (pl: any) => {
      const lead = leads.find((ml: any) => ml.id === pl.ig_lead_id);
      return !!lead?.leadMagnetSent;
    };
    // DM clics (non-LM)
    const dmClics = prospectLinksData.filter((pl: any) => {
      if (!wasCalendlyLinkSent(pl, linkClickedByLeadId)) return false;
      const ts = calendlySentAt(pl, linkClickedByLeadId);
      if (!ts || !isTsInFunnelWindow(ts)) return false;
      if (isLMPl(pl)) return false;
      return pl.ig_lead_id && linkClickedByLeadId.has(pl.ig_lead_id);
    }).length;
    // LM clics
    const lmClics = prospectLinksData.filter((pl: any) => {
      if (!wasCalendlyLinkSent(pl, linkClickedByLeadId)) return false;
      const ts = calendlySentAt(pl, linkClickedByLeadId);
      if (!ts || !isTsInFunnelWindow(ts)) return false;
      if (!isLMPl(pl)) return false;
      return pl.ig_lead_id && linkClickedByLeadId.has(pl.ig_lead_id);
    }).length;
    return dmClics + lmClics;
  })();
  const igTotalClicsD = igBioClics + igPostClics + igProspectClics;

  // ── Couverture reelle de la collecte de clics ───────────────────────────────
  //
  // Un taux « calls / clics » n'a de sens que si les deux termes couvrent la MEME
  // periode. Sur le profil de test, la collecte Short.io demarre le 19/07 alors que
  // les stats partent du 09/06 : six calls Instagram et deux YouTube sont bookes
  // avant qu'un seul clic ait pu etre enregistre. Ils se retrouvaient au numerateur
  // avec un denominateur structurellement vide — d'ou 140 % et 300 % affiches.
  //
  // Le verrou d'acces (integrations_ready_at) empeche desormais ce decalage a
  // l'inscription d'un vrai eleve. Mais il revient apres coup des qu'une panne de
  // collecte dure quelques jours : c'est de cela que cette borne protege.
  //
  // Le GRAND CHIFFRE de l'etage ne bouge pas — il reste le nombre vrai de rendez-vous.
  // Seul le TAUX se calcule sur la partie comparable, et la note dit depuis quand.
  // Le premier jour de collecte est GLOBAL : `joursCollectesShortio` ne porte que les
  // journees de la fenetre affichee, et sur une periode entierement anterieure au
  // debut de la collecte il est VIDE. Le code en concluait « couverture complete » —
  // l'exact inverse de la verite — et juin 2026 affichait « 5 opportunites pour
  // 2 clics : 250 % ». Un ensemble vide dit « on ne sait rien », pas « tout va bien ».
  const debutCouvertureClics: string | null = premierJourCollecteShortio ?? (() => {
    if (!joursCollectesShortio?.size) return null;
    let mini: string | null = null;
    for (const j of joursCollectesShortio) if (!mini || j < mini) mini = j;
    return mini;
  })();
  const debutFenetreStr = parisDateStr(winStart);

  // ── Le chiffre s'affiche, la note dit ce qu'il ne compte pas ────────────────
  //
  // Le nombre montre ce qui A ETE MESURE — c'est une vraie information, et la cacher
  // derriere un tiret en perdait plus qu'elle n'en protegeait. Ce qui le rendait
  // trompeur, ce n'etait pas sa valeur mais son AIR de total. « Clics liens Calendly »
  // d'Instagram additionne deux journaux — Short.io pour la bio et les descriptions,
  // les evenements `link_clicked` pour les liens envoyes en DM — qui n'ont pas la
  // meme date de depart. Sur juin il affichait « 2 », c'est-a-dire les seuls clics de
  // DM, presentes comme le total des trois canaux.
  //
  // La regle porte sur la SOURCE, pas sur une date figee : les tirets disparaissent
  // d'eux-memes a mesure que l'historique se remplit. Et les dates sont lues
  // GLOBALEMENT — une borne calculee depuis la fenetre affichee se desarme hors
  // fenetre, ce qui avait produit un taux a 250 %.
  //
  // ⚠️ A ne pas confondre avec `noData`, juste au-dessus, qui dit « aucun instantane
  // pour cette periode passee ». Deux questions differentes, deux mecanismes separes.
  const jourDeLaSource = (iso: string | null | undefined) => (iso ? parisDateStr(new Date(iso)) : null);
  const couvertureClics = (sources: { nom: string; depuis: string | null }[]) => {
    const manquantes = sources.filter(s => !s.depuis || s.depuis > debutFenetreStr);
    if (!manquantes.length) return { couvert: true as const, note: undefined, aide: undefined };
    // La source la plus tardive commande : c'est a partir d'elle que le total serait
    // complet. Une source qui n'a JAMAIS rien mesure (depuis === null) ne donne
    // aucune date — on le dit plutot que d'en inventer une.
    // On nomme la source QUI BLOQUE — celle dont la date est la plus tardive — et
    // elle seule. Les lister toutes sous une date unique laisserait croire qu'elles
    // ont toutes demarre ce jour-la : sur juin, le journal des DM commence le 7 alors
    // que Short.io commence le 19 juillet, et c'est la seconde qui commande.
    const bloquante = manquantes.reduce((pire, s) => {
      if (!s.depuis) return pire.depuis === null ? pire : s;   // jamais mesure : le pire cas
      return pire.depuis && pire.depuis >= s.depuis ? pire : s;
    }, manquantes[0]);
    const jour = bloquante.depuis
      ? new Date(bloquante.depuis + 'T12:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
      : null;
    const autres = manquantes.length > 1 ? ` (et ${manquantes.length - 1} autre source)` : '';
    return {
      couvert: false as const,
      note: jour
        ? `chiffre partiel — ${bloquante.nom} ne sont mesurés que depuis le ${jour}`
        : `chiffre partiel — ${bloquante.nom} n'ont jamais été mesurés`,
      aide: jour
        ? `Ce chiffre ne compte pas tous les canaux sur toute la période${autres} : ${bloquante.nom} ne sont mesurés que depuis le ${jour}. Ce qui a été mesuré avant cette date est bien compté ; ce qui l'a précédé n'existe nulle part. Le taux n'est pas affiché, parce qu'il diviserait une partie des clics par la totalité de la portée.`
        : `Ce chiffre ne compte pas tous les canaux${autres} : ${bloquante.nom} n'ont jamais été mesurés. Le taux n'est pas affiché, parce qu'il diviserait une partie des clics par la totalité de la portée.`,
    };
  };
  const couvClicsIg = couvertureClics([
    { nom: 'les clics de bio et de description', depuis: premierJourCollecteShortio ?? null },
    { nom: 'les clics des liens envoyés en DM', depuis: jourDeLaSource(premierClicLienProspect) },
  ]);
  const couvClicsYt = couvertureClics([
    { nom: 'les clics', depuis: premierJourCollecteShortio ?? null },
  ]);
  const finFenetreStr = parisDateStr(winEnd);
  const couvertureIncomplete = !!debutCouvertureClics && debutCouvertureClics > debutFenetreStr;
  // Fenetre ENTIEREMENT anterieure a la collecte : il n'y a aucune partie comparable,
  // donc aucun taux. Un 0 % affirmerait « personne n'a converti » ; c'est un trou.
  const couvertureNulle = !!debutCouvertureClics && debutCouvertureClics > finFenetreStr;
  const bookesDansCouverture = (subset: CallRecord[]) => {
    if (!couvertureIncomplete) return subset.filter(c => c.status === 'active').length;
    return subset.filter(c => {
      if (c.status !== 'active') return false;
      const d = callPeriodDate(c);
      return !!d && parisDateStr(new Date(d)) >= debutCouvertureClics!;
    }).length;
  };
  // Le taux de cet etage subit DEUX exclusions qui n'ont rien a voir l'une avec
  // l'autre : la fenetre de couverture des clics, et les continuations. La note n'en
  // nommait qu'une, si bien que le numerateur restait irreconstituable — 15 affiches,
  // 8 au numerateur, et un seul des deux ecarts explique. On les compose.
  // « hors 2e rendez-vous » a ete RETIRE de cette note le 2026-08-30 : elle disait que
  // le TAUX excluait quelque chose que le grand chiffre, lui, comptait. Depuis que
  // « Calls bookes » compte des opportunites dans tout Mes stats, l'exclusion n'est plus
  // une particularite du taux mais la regle de la page — l'ecrire ici affirmerait une
  // difference qui n'existe plus. La regle est expliquee par le « ? » de l'en-tete.
  const noteBookes = (_sousEnsemble: CallRecord[]) => {
    if (debutCouvertureClics && couvertureIncomplete) {
      return `taux depuis le ${new Date(debutCouvertureClics + 'T12:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}, début du suivi des clics`;
    }
    return undefined;
  };

  const noteCouverture = couvertureNulle && debutCouvertureClics
    ? `aucun taux : le suivi des clics n'a commencé que le ${new Date(debutCouvertureClics + 'T12:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`
    : couvertureIncomplete && debutCouvertureClics
      ? `taux depuis le ${new Date(debutCouvertureClics + 'T12:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}, début du suivi des clics`
      : undefined;

  const dash = '—';
  // Libellé sans durée : « Reach 30j » mentait sur les trois modes — un mois calendaire
  // n'a pas 30 jours, un mois passé n'est pas « les 30 derniers », et l'All-Time
  // couvre tout l'historique. La fenêtre est déjà écrite en toutes lettres dans
  // l'en-tête juste au-dessus (« Funnels & Efficacité — … »), une seule fois.
  const igFunnelSteps = [
    { label: 'Reach', value: igReachD == null ? dash : (igReachD >= 1000 ? `${fmt(igReachD / 1000, 1)}k` : fmt(igReachD)), rawValue: igReachD ?? 0 },
    // Le chiffre reste affiche meme quand une source ne couvre pas la periode : il
    // dit ce qui a ete mesure. Seul le TAUX disparait — il diviserait une partie des
    // clics par la totalite de la portee, ce qui ne serait pas un chiffre partiel
    // mais un chiffre FAUX. Meme regle que partout ailleurs sur cette page : le
    // grand chiffre ne bouge pas, seul le taux se calcule sur la partie comparable.
    { label: 'Clics liens Calendly', value: noData ? dash : fmt(igTotalClicsD), sub: 'bio + descr. + DM', rawValue: igTotalClicsD,
      // Le chiffre reste, le taux part : il diviserait une partie des clics par la
      // totalite de la portee — pas un chiffre partiel, un chiffre faux.
      rate: !couvClicsIg.couvert ? undefined : (igReachD && igReachD > 0 ? (igTotalClicsD / igReachD) * 100 : undefined),
      noteTaux: couvClicsIg.note, aide: couvClicsIg.aide },
    // Le GRAND CHIFFRE reste le nombre VRAI de rendez-vous — c'est ce que « Calls
    // bookes » veut dire, et le renommer en « Opportunites » aurait fait payer au
    // libelle le prix d'un probleme qui ne concerne que le TAUX.
    //
    // Seul le taux se calcule sur les opportunites : un 2e rendez-vous n'est produit
    // par AUCUN nouveau clic, donc l'inclure au numerateur ferait monter le ratio
    // sans qu'un clic ne l'ait cause. Meme principe que le bornage sur la couverture
    // Short.io, quelques lignes plus haut.
    { label: 'Calls bookés', value: fmt(igBookes), rawValue: igBookes, rate: couvertureNulle || igTotalClicsD <= 0 ? undefined : (bookesDansCouverture(callsIG.filter(c => !continuations.has(c.id))) / igTotalClicsD) * 100, noteTaux: couvertureNulle ? noteCouverture : noteBookes(callsIG), aide: AIDE_CALLS_BOOKES },
    // Ce taux-ci n'a pas besoin des opportunites : ses DEUX termes comptent des
    // rendez-vous, donc une continuation les fait monter tous les deux ensemble.
    { label: 'Calls honorés', value: fmt(igHonores), rawValue: igHonores, rate: igBookes > 0 ? (igHonores / igBookes) * 100 : 0, aide: AIDE_CALLS_HONORES },
    // Le denominateur du close rate n'est PAS l'etage precedent : c'est le nombre
    // d'OPPORTUNITES honorees (regle 6 du referentiel). Des qu'un 2e rendez-vous
    // existe, les deux nombres different — 13 honores pour 12 opportunites — et un
    // lecteur qui refait le calcul tombe sur un ecart inexplique. On l'ecrit, et
    // seulement quand il y a quelque chose a expliquer.
    { label: 'Deals closés', value: fmt(igCloses), rawValue: igCloses, rate: igOpportunites > 0 ? (igCloses / igOpportunites) * 100 : undefined,
      noteTaux: igOpportunites !== igHonores ? `sur ${igOpportunites} opportunités — un 2ᵉ rendez-vous ne recompte pas` : undefined, aide: AIDE_CLOSING },
    { label: 'Revenue', value: fmtEur(igRev), rawValue: igRev },
  ];

  const ytFunnelSteps = [
    { label: 'Vues', value: noData ? dash : (ytViewsD >= 1000 ? `${fmt(ytViewsD / 1000, 1)}k` : fmt(ytViewsD)), rawValue: ytViewsD },
    { label: 'Clics Calendly', value: noData ? dash : fmt(ytClicsD), sub: 'Bio + Descr.', rawValue: ytClicsD,
      rate: !couvClicsYt.couvert ? undefined : (noData ? 0 : (ytViewsD > 0 ? (ytClicsD / ytViewsD) * 100 : 0)),
      noteTaux: couvClicsYt.note, aide: couvClicsYt.aide },
    // Le GRAND CHIFFRE reste le nombre VRAI de rendez-vous — c'est ce que « Calls
    // bookes » veut dire, et le renommer en « Opportunites » aurait fait payer au
    // libelle le prix d'un probleme qui ne concerne que le TAUX.
    //
    // Seul le taux se calcule sur les opportunites : un 2e rendez-vous n'est produit
    // par AUCUN nouveau clic, donc l'inclure au numerateur ferait monter le ratio
    // sans qu'un clic ne l'ait cause. Meme principe que le bornage sur la couverture
    // Short.io, quelques lignes plus haut.
    { label: 'Calls bookés', value: fmt(ytBookes), rawValue: ytBookes, rate: couvertureNulle || ytClicsD <= 0 ? undefined : (bookesDansCouverture(callsYT.filter(c => !continuations.has(c.id))) / ytClicsD) * 100, noteTaux: couvertureNulle ? noteCouverture : noteBookes(callsYT), aide: AIDE_CALLS_BOOKES },
    // Ce taux-ci n'a pas besoin des opportunites : ses DEUX termes comptent des
    // rendez-vous, donc une continuation les fait monter tous les deux ensemble.
    { label: 'Calls honorés', value: fmt(ytHonores), rawValue: ytHonores, rate: ytBookes > 0 ? (ytHonores / ytBookes) * 100 : 0, aide: AIDE_CALLS_HONORES },
    // Le denominateur du close rate n'est PAS l'etage precedent : c'est le nombre
    // d'OPPORTUNITES honorees (regle 6 du referentiel). Des qu'un 2e rendez-vous
    // existe, les deux nombres different — 13 honores pour 12 opportunites — et un
    // lecteur qui refait le calcul tombe sur un ecart inexplique. On l'ecrit, et
    // seulement quand il y a quelque chose a expliquer.
    { label: 'Deals closés', value: fmt(ytCloses), rawValue: ytCloses, rate: ytOpportunites > 0 ? (ytCloses / ytOpportunites) * 100 : undefined,
      noteTaux: ytOpportunites !== ytHonores ? `sur ${ytOpportunites} opportunités — un 2ᵉ rendez-vous ne recompte pas` : undefined, aide: AIDE_CLOSING },
    { label: 'Revenue', value: fmtEur(ytRev), rawValue: ytRev },
  ];


  // Données jour par jour pour les modals d'efficacité par plateforme.
  //
  // Deux règles, toutes deux issues de l'audit du 2026-08-29 :
  //  1. La journée se découpe sur la date de RÉSERVATION (callsByBookedDay), comme le
  //     total qu'elle détaille. Elle se découpait sur le préfixe UTC de scheduled_at,
  //     ce qui rattachait à un autre jour tout rendez-vous réservé un jour et tenu le
  //     lendemain — et faisait diverger cette modale de celles du hero.
  //  2. Un TAUX dont le dénominateur est nul vaut `null`, jamais `0`. Écrire 0 %
  //     affirmait « ce jour-là, aucun deal n'a été closé » pour un jour où aucun
  //     appel n'avait eu lieu : sur un mois à cinq jours d'activité, la courbe
  //     « Close rate » montrait 26 jours plats à 0 %.
  function buildEffDayData(platformCalls: CallRecord[], metricIdx: number, reachByDate?: Map<string, number>): { date: string; v: number }[] {
    const byDay = callsByBookedDay(platformCalls);
    return windowDays.map(iso => {
      const trou = { date: iso, v: null as any };
      if (isFutureDayFunnel(iso)) return trou;
      const cs = byDay.get(iso) ?? [];
      const opportunitesDuJour = cs.filter(c => c.status === 'active' && !continuations.has(c.id));
      const booked = opportunitesDuJour.length;
      const honored = opportunitesDuJour.filter(c => isCallHonored(c, now)).length;
      const closed = cs.filter(c => c.deal_closed).length;
      const rev = cs.reduce((s, c) => s + (c.revenue || 0), 0);
      const noShows = cs.filter(c => c.status === 'active' && c.no_show).length;
      // metricIdx correspond à l'index dans row.metrics : 0=reach/vues pour 1 call, 1=bookés,
      // 2=no-show, 3=close rate, 4=rev/call booké, 5=cash/vue, 6=revenue total.
      const reachDay = reachByDate?.get(iso);
      const taux = (num: number, den: number) => {
        const t = tauxOuTrou(num, den);
        return t === null ? trou : { date: iso, v: Math.round(t) };
      };
      if (metricIdx === 0) return booked > 0 && reachDay != null ? { date: iso, v: Math.round(reachDay / booked) } : trou;
      if (metricIdx === 1) return { date: iso, v: booked };
      if (metricIdx === 2) return taux(noShows, booked);
      // Meme grain que la carte : des opportunites au denominateur.
      const opportunites = cs.filter(c => isCallHonored(c, now) && !continuations.has(c.id)).length;
      if (metricIdx === 3) return taux(closed, opportunites);
      if (metricIdx === 4) return booked > 0 ? { date: iso, v: Math.round(rev / booked) } : trou;
      if (metricIdx === 5) return reachDay ? { date: iso, v: rev / reachDay } : trou;
      return { date: iso, v: rev };
    });
  }

  // Même rendu qu'un taux d'entonnoir (FunnelHorizontal) : « Close rate » figure aux
  // deux endroits, et affichait 66,7 % dans l'entonnoir contre 67 % dans le tableau,
  // pour la même mesure sur le même écran.
  const fmtRate = (a: number, b: number) => `${fmt((a / b) * 100, 1)}%`;
  type EffMetric = { label: string; value: string; prevValue: string | null; delta: { value: number; label: string; color: string } | null; lowerIsBetter: boolean; aide?: string };
  type EffRow = { platform: string; color: string; metrics: EffMetric[]; platformCalls: CallRecord[]; reachByDate: Map<string, number> };
  const igReachByDate = new Map<string, number>((ig?.chartData ?? []).filter(dd => inFunnelDateWindow(dd.date)).map(dd => [dd.date, dd.reach]));
  const ytReachByDate = new Map<string, number>((yt?.chartData ?? []).filter(dd => inFunnelDateWindow(dd.date)).map(dd => [dd.date, dd.views]));
  // ── Efficacité par plateforme (données réelles, pas de comparaison historique) ──
  const effRows: EffRow[] = [
    {
      platform: 'Instagram', color: IG_COLOR, platformCalls: callsIG, reachByDate: igReachByDate,
      metrics: [
        { label: 'Reach pour 1 call', value: igReachD != null && igBookes > 0 ? fmt(Math.round(igReachD / igBookes)) : '—', prevValue: null, delta: null, lowerIsBetter: true },
        { label: 'Calls bookés', value: fmt(igBookes), prevValue: null, delta: null, lowerIsBetter: false, aide: AIDE_CALLS_BOOKES },
        { label: 'No-show', value: igRendezVous > 0 ? `${fmtRate(igNoShows, igRendezVous)} · ${igNoShows}/${igRendezVous} rdv` : '—', prevValue: null, delta: null, lowerIsBetter: true, aide: AIDE_NO_SHOW },
        { label: 'Close rate', value: igOpportunites > 0 ? fmtRate(igCloses, igOpportunites) : '—', prevValue: null, delta: null, lowerIsBetter: false, aide: AIDE_CLOSING },
        { label: 'Rev / call booké', value: igBookes > 0 ? fmtEur(Math.round(igRev / igBookes)) : '—', prevValue: null, delta: null, lowerIsBetter: false, aide: AIDE_REV_PAR_CALL },
        // « Cash / vue » : Instagram mesure une portée, pas des vues — la colonne
        // voisine dit déjà « Reach pour 1 call ».
        { label: 'Cash / reach', value: igReachD != null && igReachD > 0 ? fmtEur(igRev / igReachD) : '—', prevValue: null, delta: null, lowerIsBetter: false },
        { label: 'Revenue total', value: fmtEur(igRev), prevValue: null, delta: null, lowerIsBetter: false },
      ],
    },
    {
      platform: 'YouTube', color: YT_COLOR, platformCalls: callsYT, reachByDate: ytReachByDate,
      metrics: [
        { label: 'Vues pour 1 call', value: ytBookes > 0 ? fmt(Math.round(ytViewsD / ytBookes)) : '—', prevValue: null, delta: null, lowerIsBetter: true },
        { label: 'Calls bookés', value: fmt(ytBookes), prevValue: null, delta: null, lowerIsBetter: false, aide: AIDE_CALLS_BOOKES },
        { label: 'No-show', value: ytRendezVous > 0 ? `${fmtRate(ytNoShows, ytRendezVous)} · ${ytNoShows}/${ytRendezVous} rdv` : '—', prevValue: null, delta: null, lowerIsBetter: true, aide: AIDE_NO_SHOW },
        { label: 'Close rate', value: ytOpportunites > 0 ? fmtRate(ytCloses, ytOpportunites) : '—', prevValue: null, delta: null, lowerIsBetter: false, aide: AIDE_CLOSING },
        { label: 'Rev / call booké', value: ytBookes > 0 ? fmtEur(Math.round(ytRev / ytBookes)) : '—', prevValue: null, delta: null, lowerIsBetter: false, aide: AIDE_REV_PAR_CALL },
        { label: 'Cash / vue', value: ytViewsD > 0 ? fmtEur(ytRev / ytViewsD) : '—', prevValue: null, delta: null, lowerIsBetter: false },
        { label: 'Revenue total', value: fmtEur(ytRev), prevValue: null, delta: null, lowerIsBetter: false },
      ],
    },
  ];

  // ── Calls filtrés pour la table (toujours live) ──
  const filteredCalls = callsFilter === 'ig' ? callsIG : callsFilter === 'yt' ? callsYT : callsInWindow;
  // `filteredActifs` = les RENDEZ-VOUS (denominateur du no-show et de la liste elle-meme,
  // qui affiche bien chaque creneau). `filteredOpportunites` = ce que le contenu a
  // produit, pour les compteurs « Bookes » et « Honores ».
  const filteredActifs = filteredCalls.filter(c => c.status === 'active');
  const filteredOpportunites = filteredActifs.filter(c => !continuations.has(c.id));

  // Les totaux du hero portent sur TOUTES les sources — c'est ce que dit leur
  // sous-titre. Ils valaient `igBookes + ytBookes`, donc un call dont la source ne
  // commence ni par `ig` ni par `yt` en était absent, alors qu'il figurait bien dans
  // la table en dessous (filtre « Tous ») et au numérateur du taux de no-show. Le
  // dénominateur excluait ce que le numérateur comptait : le taux pouvait dépasser
  // 100 % (aucun cas en base au 2026-08-29, les 19 calls de vente ont tous une source
  // ig_* ou yt_*, mais rien ne l'interdit).
  const callsActifs  = callsInWindow.filter(c => c.status === 'active');
  const totalBookes  = callsActifs.filter(c => !continuations.has(c.id)).length;
  // `!continuations.has(...)` : « Calls bookes » juste au-dessus compte des OPPORTUNITES,
  // « Calls honores » comptait des RENDEZ-VOUS. Un 2e rendez-vous honore faisait donc
  // passer les honores AU-DESSUS des bookes — impossible par definition, et c'est ce
  // que le texte d'aide de Vue generale affirme (« ce nombre ne peut jamais depasser
  // les calls bookes »). Vu a l'ecran le 2026-09-01 sur la semaine du 24 au 30 aout :
  // « Calls bookes 0 » a cote de « Calls honores 1 ».
  //
  // Effet de bord voulu : `totalOpportunites` vaut desormais toujours `totalHonores`,
  // donc le denominateur du closing EST le nombre affiche a cote — il se recalcule
  // depuis l'ecran sans note explicative.
  const totalHonores = callsActifs.filter(c => isCallHonored(c, now) && !continuations.has(c.id)).length;
  const totalOpportunites = callsActifs.filter(c => isCallHonored(c, now) && !continuations.has(c.id)).length;
  const totalCloses  = closesDeLaPeriode(() => true);
  // Meme source et meme date que les deux totaux par plateforme juste au-dessus :
  // le montant vient de `deals`, et il est date du rendez-vous qui l'a produit.
  // Il lisait `calls.revenue` sur `callsActifs`, donc le montant DECLARE au rapport,
  // decoupe sur `booked_at`. Il affichait le bon chiffre par effet de l'injection de
  // `callsEff` — pas par la bonne source, ce qui n'est pas la meme chose : une vente
  // corrigee depuis la page Paiements apres coup, ou un deal annule, l'aurait fait
  // diverger sans que rien ne le signale.
  const totalRev     = revDeLaPeriode(() => true);
  const noShowCount  = callsActifs.filter(c => c.no_show).length;
  // ── Verification faite le 2026-09-01 sur TOUS les taux de la page ──────────
  // Celui-ci etait le seul melange de grains non documente. Les autres divisions qui
  // melangent le font a dessein et le disent : `closingRate` et `revPerCall` gardent
  // au numerateur des deals comptes la ou ils ont ete signes, y compris au 2e
  // rendez-vous, pour un denominateur en opportunites — c'est la regle, pas un
  // oubli. Vue generale tenait deja la bonne regle sur les trois siens.
  //
  // Le denominateur du no-show, c'est les RENDEZ-VOUS — tous les creneaux poses,
  // prolongations comprises. Il divisait par `totalBookes`, qui EXCLUT les
  // prolongations : un numerateur en rendez-vous sur un denominateur en calls bookes.
  // Le hero affichait 17,6 % la ou la regle donne 16,7 %, et son sous-titre « % des
  // bookes » decrivait fidelement ce que faisait le code — donc rien ne le
  // contredisait. Meme famille que le piege de la partition : deux endroits qui
  // doivent s'accorder, dont un seul est visible depuis l'autre. `calcCalls` et Vue
  // generale tenaient deja la bonne regle ; le hero etait le seul a diverger.
  const totalRendezVous = callsActifs.length;
  const closingRate  = totalOpportunites > 0 ? pct(totalCloses, totalOpportunites) : 0;
  const noShowRate   = totalRendezVous > 0 ? pct(noShowCount, totalRendezVous) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 48 }}>

      {/* ── HERO — STATS GLOBALES ── */}
      {(() => {
        const revPerCall = totalBookes > 0 ? Math.round(totalRev / totalBookes) : 0;

        // La phrase dynamique n'apparait QUE si les deux nombres different — sinon
        // « 17 calls bookés, mais 17 rendez-vous » n'apprend rien. Elle prefixe le
        // texte partage sans le reecrire : AIDE_CALLS_BOOKES reste la regle, une
        // seule fois, pour tous ses emplacements.
        const aideBookesAvecNombres = totalBookes !== totalRendezVous
          ? `${totalBookes} calls bookés, mais ${totalRendezVous} rendez-vous. ${AIDE_CALLS_BOOKES}`
          : AIDE_CALLS_BOOKES;

        const heroItems: { label: string; value: string; sub: string; aide?: string }[] = [
          { label: 'Calls bookés',  value: fmt(totalBookes),   sub: 'toutes sources', aide: aideBookesAvecNombres },
          { label: 'Calls IG',      value: fmt(igBookes),      sub: `${igCloses} closés` },
          { label: 'Calls YT',      value: fmt(ytBookes),      sub: `${ytCloses} closés` },
          { label: 'Calls honorés', value: fmt(totalHonores),  sub: `${noShowRate}% no-show`, aide: AIDE_CALLS_HONORES },
          // Le denominateur est ECRIT a cote, parce qu'il n'est pas celui de la carte
          // voisine : sans lui, on additionne honores et no-show, on ne retombe pas
          // sur les bookes, et on conclut a un bug.
          { label: 'No-show',       value: fmt(noShowCount),
            sub: totalRendezVous > 0 ? `${noShowCount} sur ${totalRendezVous} rendez-vous` : 'aucun rendez-vous',
            aide: AIDE_NO_SHOW },
          // Le sous-titre nomme le denominateur des qu'il s'ecarte du nombre d'honores
          // affiche juste a cote : « 57% closing » a cote de « 15 honores » se
          // recalcule en 8/15 = 53 %, et l'ecart reste inexplique.
          { label: 'Deals closés',  value: fmt(totalCloses),
            sub: totalOpportunites !== totalHonores
              ? `${closingRate}% sur ${totalOpportunites} opportunités`
              : `${closingRate}% closing`,
            aide: AIDE_CLOSING },
          { label: 'Revenue total', value: fmtEur(totalRev),   sub: 'cumulé' },
          { label: 'Rev / call',    value: fmtEur(revPerCall), sub: 'par call booké', aide: AIDE_REV_PAR_CALL },
        ];

        return (
          <div style={{ borderRadius: 16, overflow: 'hidden', border: '1px solid var(--border)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)' }}>
              {heroItems.map((h, i) => {
                const isActive = expandedHero === i;
                return (
                  <div key={i}
                    onClick={() => { if (isActive) { setExpandedHero(null); setHeroSnapshot(null); onModalChange?.(false); } else { setExpandedHero(i); setHeroSnapshot({ label: h.label, value: h.value, sub: h.sub }); setModalPeriod(period); setModalPeriodIndex(periodIndex); onModalChange?.(true); } }}
                    style={{
                      padding: '22px 22px 18px',
                      background: isActive ? 'var(--surface-2)' : 'var(--surface)',
                      borderLeft: i % 4 > 0 ? '1px solid var(--border)' : 'none',
                      borderTop: i >= 4 ? '1px solid var(--border)' : 'none',
                      cursor: 'pointer',
                      transition: 'background .15s',
                      userSelect: 'none',
                    }}
                    onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--surface-2)'; }}
                    onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'var(--surface)'; }}
                  >
                    {/* AideColonne fait deja stopPropagation : le « ? » n'ouvre pas
                        la modale du graphe. */}
                    <div className="eyebrow-sm" style={{ color: 'var(--muted)', marginBottom: 8, display: 'flex', alignItems: 'center' }}>{h.label}{h.aide ? <AideColonne texte={h.aide} /> : null}</div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--ink)', lineHeight: 1, marginBottom: 4 }}>{h.value}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{h.sub}</div>
                  </div>
                );
              })}
            </div>

            {/* Modale graphe au clic */}
            {expandedHero !== null && (
              <Portal>
              <div
                style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
                onClick={() => setExpandedHero(null)}
              >
                <div
                  style={{ background: 'var(--surface)', borderRadius: 16, padding: '32px 36px 28px', width: '100%', maxWidth: 780, boxShadow: '0 24px 60px rgba(0,0,0,.18)' }}
                  onClick={e => e.stopPropagation()}
                >
                  {(() => {
                    // Série jour par jour d'un sous-ensemble de calls, découpée sur la
                    // date de RÉSERVATION (callsByBookedDay) et sur la fenêtre du FETCH
                    // (windowDays) — les deux mêmes règles que le total qu'elle détaille.
                    // Elle bouclait sur periodStart/periodEnd, donc sur le mois en cours
                    // même en All-Time, et comparait des instants UTC à des jours de
                    // Paris.
                    const toCallsData = (subset: CallRecord[], key: 'booked' | 'honored' | 'closed' | 'rev' | 'revPerCall') => {
                      const byDay = callsByBookedDay(subset);
                      return windowDays.map(date => {
                        if (isFutureDayFunnel(date)) return { date, v: null as any };
                        const daySubset = (byDay.get(date) ?? []).filter(c => c.status === 'active');
                        // Bookes et honores comptent des OPPORTUNITES. `closed` et `rev`
                        // gardent le sous-ensemble entier : un deal se compte la ou il a
                        // ete signe, meme au 2e rendez-vous — meme regle que partout.
                        const dayOpportunites = daySubset.filter(c => !continuations.has(c.id));
                        if (key === 'booked') return { date, v: dayOpportunites.length };
                        if (key === 'honored') return { date, v: dayOpportunites.filter(c => isCallHonored(c, now)).length };
                        if (key === 'closed') return { date, v: daySubset.filter(c => c.deal_closed).length };
                        if (key === 'rev') return { date, v: daySubset.reduce((s, c) => s + (c.revenue || 0), 0) };
                        // revPerCall : un ratio n'existe pas sans dénominateur — un jour
                        // sans call booké est un trou, pas un « 0 € par call ». Le
                        // denominateur est celui de la carte « Rev / call » : les bookes.
                        if (dayOpportunites.length === 0) return { date, v: null as any };
                        return { date, v: Math.round(daySubset.reduce((s, c) => s + (c.revenue || 0), 0) / dayOpportunites.length) };
                      });
                    };

                    // L'ordre DOIT correspondre exactement à heroItems (même index cliqué
                    // via expandedHero) : 0=bookés, 1=calls IG, 2=calls YT, 3=honorés,
                    // 4=no-show, 5=closés, 6=revenue total, 7=rev/call.
                    // Les cartes « toutes sources » lisent callsInWindow, pas
                    // [...callsIG, ...callsYT] : la modale doit détailler exactement le
                    // chiffre sur lequel on a cliqué.
                    const modalCharts: { data: { date: string; v: number }[]; color: string; fmtV: (v: number) => string }[] = [
                      // 0 Calls bookés
                      { color: 'var(--ink)', fmtV: String, data: toCallsData(callsInWindow, 'booked') },
                      // 1 Calls IG
                      { color: IG_COLOR, fmtV: String, data: toCallsData(callsIG, 'booked') },
                      // 2 Calls YT
                      { color: YT_COLOR, fmtV: String, data: toCallsData(callsYT, 'booked') },
                      // 3 Calls honorés
                      { color: AMBER, fmtV: String, data: toCallsData(callsInWindow, 'honored') },
                      // 4 No-show
                      { color: RED, fmtV: String, data: toCallsData(callsInWindow.filter(c => c.no_show), 'booked') },
                      // 5 Deals closés
                      { color: GREEN, fmtV: String, data: toCallsData(callsInWindow, 'closed') },
                      // 6 Revenue total
                      { color: GREEN, fmtV: (v) => `${v} €`, data: toCallsData(callsInWindow, 'rev') },
                      // 7 Rev / call — valeur RÉELLE du jour (revenu du jour ÷ calls
                      // bookés du jour). La courbe posait auparavant la moyenne de toute
                      // la période sur les jours à honoré et 0 partout ailleurs : une
                      // série entièrement fabriquée, qui n'apprenait rien du jour affiché.
                      { color: GREEN, fmtV: (v) => `${Math.round(v)} €`, data: toCallsData(callsInWindow, 'revPerCall') },
                    ];
                    const chart = modalCharts[expandedHero!];
                    // Meme critere que le tableau d'efficacite : la DENSITE de la serie,
                    // pas la nature de la metrique. No-show (4) et Rev/call (7) n'ont un
                    // point que les jours ou il s'est passe quelque chose — quelques
                    // points isoles sur un mois, qu'une courbe relie par des valeurs
                    // inventees et dont l'absence se lit comme un bug. Les compteurs de
                    // calls et le revenu cumule gardent la courbe : ils ont un point par
                    // jour.
                    const heroEnBarres = expandedHero === 4 || expandedHero === 7;
                    return (<>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                        <div>
                          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{heroSnapshot?.label}</div>
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>{windowLabel}</div>
                        </div>
                        <button onClick={() => { setExpandedHero(null); setHeroSnapshot(null); onModalChange?.(false); }} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--muted)', lineHeight: 1 }}>×</button>
                      </div>
                      <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--ink)', marginBottom: 16 }}>{heroSnapshot?.value}</div>
                      {/* initialDimension : au premier rendu la modale n'a pas encore
                          de largeur mesurée, et Recharts émet « width(-1) and
                          height(-1) » dans la console. Même correctif que sur les trois
                          graphiques de Business micro. */}
                      <ResponsiveContainer width="100%" height={220} initialDimension={{ width: 700, height: 220 }}>
                        <ComposedChart data={chart.data} margin={{ top: 4, right: 8, left: 0, bottom: 24 }}>
                          <defs>
                            <linearGradient id="grad-hero-modal" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor={chart.color} stopOpacity={0.2} />
                              <stop offset="95%" stopColor={chart.color} stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={period === 7 ? fmtAxisDateWithDay : fmtAxisDate} interval={graduationsDates(chart.data.length, period)} />
                          {/* Borne basse jamais négative : un compteur de calls ne peut pas
                              valoir −1, et l'axe en affichait pourtant la graduation.
                              Même garde que les six autres axes de ce fichier — c'étaient
                              les deux seuls à ne pas l'avoir. */}
                          <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={28} allowDecimals={false} domain={([dataMin, dataMax]: readonly [number, number]) => { const range = dataMax - dataMin; const margin = Math.max(1, Math.ceil(range * 0.12)); const lo = dataMin - margin; return [dataMin >= 0 ? Math.max(0, lo) : lo, dataMax + margin]; }} />
                          <Tooltip cursor={heroEnBarres ? { fill: 'var(--surface-2)' } : undefined} content={({ active, payload, label }) => {
                            if (!active || !payload?.length) return null;
                            return <div className="chart-tooltip"><div className="chart-tooltip-label">{label}</div><div className="chart-tooltip-row"><strong>{chart.fmtV(payload[0].value as number)}</strong></div></div>;
                          }} />
                          {heroEnBarres ? (
                            /* minPointSize : un vrai 0 doit rester VISIBLE, sinon il est
                               indiscernable d'un trou — un jour sans no-show et un jour
                               sans call ne disent pas la meme chose. */
                            <Bar dataKey="v" fill={chart.color} radius={[2, 2, 0, 0]} minPointSize={(v: number | null | undefined) => (v === 0 ? 3 : 0)} isAnimationActive={false} />
                          ) : (
                            <Area type="monotone" dataKey="v" stroke={chart.color} strokeWidth={2} fill="url(#grad-hero-modal)" dot={todayDotFactory(chart.color, 'date', lastRealPointKey(chart.data, 'date', 'v'))} activeDot={{ r: 4, strokeWidth: 0, fill: chart.color }} isAnimationActive={false} />
                          )}
                        </ComposedChart>
                      </ResponsiveContainer>
                    </>);
                  })()}
                </div>
              </div>
              </Portal>
            )}
          </div>
        );
      })()}

      {/* ── FUNNELS & EFFICACITÉ ── */}
      <div>
        <div className="eyebrow-lg" style={{ color: 'var(--muted)', marginBottom: 28 }}>Funnels & Efficacité — {windowLabel}</div>

        {/* Funnels */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 40, marginBottom: 32 }}>
          <FunnelHorizontal platform="Instagram" color={IG_COLOR} steps={igFunnelSteps} />
          <div style={{ height: 1, background: 'var(--border)' }} />
          <FunnelHorizontal platform="YouTube" color={YT_COLOR} steps={ytFunnelSteps} />
        </div>

        {/* Efficacité par plateforme */}
        <div className="eyebrow-lg" style={{ color: 'var(--muted)', marginBottom: 16 }}>Efficacité par plateforme</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {effRows.map((row, ri) => (
            <div key={ri} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 20px', borderBottom: '1px solid var(--border-soft)' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: row.color }} />
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink)' }}>{row.platform}</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
                {row.metrics.map((m, mi) => {
                  const d = m.delta;
                  const isGood = d ? (m.lowerIsBetter ? d.value < 0 : d.value > 0) : false;
                  const isBad  = d ? (m.lowerIsBetter ? d.value > 0 : d.value < 0) : false;
                  const absPct = d ? Math.abs(d.value) : 0;
                  const greenIntensity = Math.min(absPct / 30, 1);
                  const greenColor = isGood
                    ? `hsl(142, ${Math.round(50 + greenIntensity * 50)}%, ${Math.round(38 - greenIntensity * 8)}%)`
                    : undefined;
                  const deltaColor = d ? (isGood ? greenColor! : isBad ? RED : 'var(--muted)') : 'var(--muted)';
                  const effData = buildEffDayData(row.platformCalls, mi, row.reachByDate);
                  return (
                    <div key={mi}
                      onClick={() => { setExpandedEff({ label: `${row.platform} — ${m.label}`, value: m.value, color: row.color, estPct: mi === 2 || mi === 3, enBarres: mi === 2 || mi === 3 || mi === 4, data: effData }); onModalChange?.(true); }}
                      style={{ padding: '14px 10px', borderLeft: mi > 0 ? '1px solid var(--border-soft)' : 'none', cursor: 'pointer', transition: 'background .15s' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                      onMouseLeave={e => e.currentTarget.style.background = ''}
                    >
                      <div className="eyebrow-sm" style={{ color: 'var(--muted)', marginBottom: 6, display: 'flex', alignItems: 'center' }}>{m.label}{m.aide ? <AideColonne texte={m.aide} /> : null}</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink)', lineHeight: 1 }}>{m.value}</div>
                      {d && d.label !== '—' && (
                        <div style={{ marginTop: 6, display: 'flex', alignItems: 'baseline', gap: 6 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)' }}>{m.prevValue ?? '—'}</span>
                          <span style={{ fontSize: 11, fontWeight: 700, color: deltaColor }}>{d.label}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Modal efficacité */}
      {expandedEff && (
        <Portal>
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={() => { setExpandedEff(null); onModalChange?.(false); }}>
          <div style={{ background: 'var(--surface)', borderRadius: 20, padding: '32px 32px 28px', width: '100%', maxWidth: 720, boxShadow: '0 24px 60px rgba(0,0,0,.18)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>{expandedEff.label}</div>
                {/* « {period} derniers jours » était faux dans les trois modes : la
                    fenêtre est un mois (ou une semaine) CALENDAIRE, un mois PASSÉ quand
                    on recule, et tout l'historique en All-Time. */}
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Jour par jour · {windowLabel}</div>
              </div>
              <button onClick={() => { setExpandedEff(null); onModalChange?.(false); }} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--muted)', lineHeight: 1 }}>×</button>
            </div>
            <div style={{ fontSize: 36, fontWeight: 800, color: 'var(--ink)', marginBottom: 20 }}>{expandedEff.value}</div>
            <ResponsiveContainer width="100%" height={220} initialDimension={{ width: 660, height: 220 }}>
              <ComposedChart data={expandedEff.data} margin={{ top: 4, right: 8, left: 0, bottom: 24 }}>
                <defs>
                  <linearGradient id="grad-eff-modal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={expandedEff.color} stopOpacity={0.2} />
                    <stop offset="95%" stopColor={expandedEff.color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={period === 7 ? fmtAxisDateWithDay : fmtAxisDate} interval={graduationsDates(expandedEff.data.length, period)} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={40} allowDecimals={false} domain={([dataMin, dataMax]: readonly [number, number]) => { const range = dataMax - dataMin; const margin = Math.max(1, Math.ceil(range * 0.12)); const lo = dataMin - margin; const hi = dataMax + margin; return [dataMin >= 0 ? Math.max(0, lo) : lo, expandedEff.estPct ? Math.min(100, hi) : hi]; }} />
                <Tooltip cursor={expandedEff.enBarres ? { fill: 'var(--surface-2)' } : undefined} content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  return <div className="chart-tooltip"><div className="chart-tooltip-label">{label}</div><div className="chart-tooltip-row"><strong>{Math.round(payload[0].value as number)}{expandedEff.estPct ? ' %' : ''}</strong></div></div>;
                }} />
                {/* Le closing est la SEULE serie assez creuse pour qu'une courbe mente.
                    Sur aout : 3 journees mesurees sur 31 — les 28 autres n'ont aucun
                    appel honore, donc aucun taux. La courbe n'y laissait que trois points
                    orphelins, qu'on lit comme un graphique casse ; la barre absente, elle,
                    EST le trou. Partout ailleurs la serie a une valeur chaque jour, et la
                    courbe montre la tendance mieux que des barres. */}
                {expandedEff.enBarres ? (
                  /* Talon de 3 px sur un zero MESURE : sans lui, une barre de hauteur nulle
                     ne dessine rien, et « ce jour-la je n'ai rien close » devient
                     indistinguable de « ce jour-la je n'avais aucun appel ». */
                  <Bar dataKey="v" fill={expandedEff.color} radius={[2, 2, 0, 0]} minPointSize={(v: number | null | undefined) => (v === 0 ? 3 : 0)} isAnimationActive={false} />
                ) : (
                <Area type="monotone" dataKey="v" stroke={expandedEff.color} strokeWidth={2} fill="url(#grad-eff-modal)" dot={todayDotFactory(expandedEff.color, 'date', lastRealPointKey(expandedEff.data, 'date', 'v'))} activeDot={{ r: 4, strokeWidth: 0, fill: expandedEff.color }} isAnimationActive={false} />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
        </Portal>
      )}

      {/* ── SECTION CALLS TABLE ── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div className="eyebrow-lg" style={{ color: 'var(--muted)' }}>Calls</div>
          {/* Filtre plateforme */}
          <div style={{ display: 'flex', gap: 4, background: 'var(--surface-2)', borderRadius: 8, padding: 3 }}>
            {[
              { key: 'all', label: 'Tous' },
              { key: 'ig', label: 'Instagram' },
              { key: 'yt', label: 'YouTube' },
            ].map(opt => (
              <button key={opt.key} onClick={() => setCallsFilter(opt.key as 'all' | 'ig' | 'yt')} style={{
                fontSize: 11, fontWeight: 600, padding: '5px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
                background: callsFilter === opt.key ? 'var(--surface)' : 'transparent',
                color: callsFilter === opt.key ? 'var(--ink)' : 'var(--muted)',
                boxShadow: callsFilter === opt.key ? '0 1px 3px rgba(0,0,0,.08)' : 'none',
                transition: 'all .15s',
              }}>{opt.label}</button>
            ))}
          </div>
        </div>

        {/* Résumé stats — même population que les cartes du hero : les calls actifs. */}
        <div style={{ display: 'flex', gap: 20, marginBottom: 12 }}>
          {[
            { label: 'Bookés', value: fmt(filteredOpportunites.length), color: 'var(--ink)', aide: AIDE_CALLS_BOOKES },
            { label: 'Honorés', value: fmt(filteredOpportunites.filter(c => isCallHonored(c, now)).length), color: GREEN, aide: AIDE_CALLS_HONORES },
            // Grain « rendez-vous », comme partout : un creneau perdu reste perdu. Le
            // denominateur est donc DIFFERENT de celui des deux cartes voisines, et il
            // est ecrit en toutes lettres sous le chiffre : « 6 / 11 » seul laissait le
            // lecteur deviner ce qu'etait ce 11.
            { label: 'No-show', value: fmt(filteredActifs.filter(c => c.no_show).length), color: RED,
              sub: filteredActifs.length > 0
                ? `sur ${fmt(filteredActifs.length)} rendez-vous`
                : 'aucun rendez-vous',
              aide: AIDE_NO_SHOW },
            { label: 'Closés', value: fmt(filteredActifs.filter(c => c.deal_closed).length), color: 'var(--accent)' },
            { label: 'Revenue', value: fmtEur(filteredActifs.reduce((acc, c) => acc + (c.revenue || 0), 0)), color: GREEN },
          ].map((s, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div className="eyebrow-sm" style={{ color: 'var(--muted)', display: 'flex', alignItems: 'center' }}>{s.label}{'aide' in s && s.aide ? <AideColonne texte={s.aide} /> : null}</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: s.color }}>{s.value}</div>
              {'sub' in s && s.sub ? <div style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.2 }}>{s.sub}</div> : null}
            </div>
          ))}
        </div>

        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {/* « Show-up » et non « No-show » : la cellule porte un ✓ quand le
                    prospect est VENU. Sous un en-tete « No-show », ce ✓ affirmait
                    exactement l'inverse de son titre. */}
                {['Date', 'Client', 'Source', 'Statut', 'Show-up', 'Closé', 'Revenue'].map((h, i) => (
                  <th key={i} className="eyebrow-sm" style={{ textAlign: 'left', color: 'var(--muted)', padding: '12px 14px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredCalls.slice(0, callsShown).map((c, i) => {
                const isPast = new Date(c.scheduled_at) < now;
                // isCallCanceled couvre les trois orthographes présentes en base
                // ('canceled', 'cancelled', 'declined') — le test `=== 'canceled'`
                // affichait « Honoré » sur un call annulé écrit à l'anglaise.
                const isCanceled = isCallCanceled(c);
                // « Honoré » suit la définition officielle unique (lib/callHonored.ts) :
                // un call passé dont le rapport n'est pas rempli n'est PAS honoré. La
                // table le libellait pourtant « Honoré » avec un ✓ en colonne No-show,
                // pendant que le compteur juste au-dessus l'excluait — 8 lignes
                // « Honoré » pour un compteur à 7, constaté le 2026-08-29.
                const honored = isCallHonored(c, now);
                // « Closé » passe AVANT « Honoré » : les deux sont vrais d'un call
                // qui a signe, et c'est l'issue qui interesse. Sans ce cas, la colonne
                // Statut s'arretait a « Honoré » pour un deal signe — l'information la
                // plus importante de la ligne n'etait lisible que dans la colonne
                // voisine, en ✓.
                const statusLabel = isCanceled
                  ? (c.rescheduled ? 'Rebooké' : 'Annulé')
                  : c.no_show ? 'No-show'
                  : honored ? (c.deal_closed ? 'Closé' : 'Honoré')
                  : isPast ? 'Rapport à remplir' : 'À venir';
                const statusColor = isCanceled
                  ? (c.rescheduled ? AMBER : RED)
                  : c.no_show ? RED
                  : honored ? GREEN
                  : isPast ? AMBER : 'var(--muted)';
                const srcParts = (c.source || '').split('_');
                // Le filtre juste au-dessus dit « Instagram » / « YouTube » ; la colonne
                // affichait « Ig » / « Yt », la casse machine du champ `source`.
                const PLATFORM_LABELS: Record<string, string> = { ig: 'Instagram', instagram: 'Instagram', yt: 'YouTube', youtube: 'YouTube', ubizenai: 'Instagram' };
                const srcPlatform = PLATFORM_LABELS[srcParts[0]?.toLowerCase()] ?? srcParts[0];
                const srcMedium = srcParts.slice(1).join(' ');
                const platformColor = isIGCall(c) ? IG_COLOR : isYTCall(c) ? YT_COLOR : 'var(--muted)';
                return (
                  <tr key={i} style={{ borderTop: '1px solid var(--border-soft)' }}>
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>{new Date(c.scheduled_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</div>
                      <div style={{ fontSize: 10, color: 'var(--muted)' }}>{new Date(c.scheduled_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</div>
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: 13, fontWeight: 500 }}>{c.invitee_name || c.invitee_email || '—'}</td>
                    <td style={{ padding: '12px 14px' }}>
                      {c.source ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: platformColor }}>{srcPlatform}</span>
                          {srcMedium && <span style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'capitalize' }}>{srcMedium}</span>}
                        </div>
                      ) : <span style={{ fontSize: 11, color: 'var(--faint)' }}>—</span>}
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: statusColor }}>{statusLabel}</span>
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                      {/* Le ✓ dit « le prospect est venu ». C'est le rapport qui
                          l'établit, pas l'heure qui passe : sans rapport rempli, on ne
                          sait pas, donc un tiret. */}
                      {c.no_show
                        ? <span style={{ fontSize: 13, color: RED }}>✕</span>
                        : honored
                          ? <span style={{ fontSize: 13, color: GREEN }}>✓</span>
                          : <span style={{ fontSize: 11, color: 'var(--faint)' }}>—</span>}
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                      {c.deal_closed === true && <span style={{ fontSize: 13, color: GREEN }}>✓</span>}
                      {c.deal_closed === false && <span style={{ fontSize: 13, color: RED }}>✕</span>}
                      {(c.deal_closed === undefined || c.deal_closed === null) && <span style={{ fontSize: 11, color: 'var(--faint)' }}>—</span>}
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: 13, fontWeight: 600, color: c.revenue ? GREEN : 'var(--faint)' }}>
                      {c.revenue ? fmtEur(c.revenue) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filteredCalls.length > callsShown && (
            <button
              type="button"
              onClick={() => setCallsShown(n => n + CALLS_PAGE)}
              style={{
                width: '100%', padding: '12px 0', fontSize: 12, fontWeight: 600,
                color: 'var(--muted)', background: 'none', border: 'none',
                borderTop: '1px solid var(--border-soft)', cursor: 'pointer',
              }}
            >
              Voir plus ({filteredCalls.length - callsShown} call{filteredCalls.length - callsShown > 1 ? 's' : ''} de plus)
            </button>
          )}
        </div>
      </div>

    </div>
  );
}

// ─── TAB 5 : Revenus ──────────────────────────────────────────────────────────

// ─── Helpers validation post IDs (utilisés par TabShortioB) ─────────────────
const isValidIgPostId = (id: any) => id && typeof id === 'string' && /^\d{10,}$/.test(id);
const isValidYtVideoId = (id: any) => id && typeof id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(id);
const isValidPostId = (id: any, platform?: string) => {
  if (!id || typeof id !== 'string' || id === 'null' || id === 'undefined') return false;
  if (platform === 'YT') return isValidYtVideoId(id);
  if (platform === 'IG') return isValidIgPostId(id);
  return isValidIgPostId(id) || isValidYtVideoId(id);
};

interface OriginRow {
  key: string;
  label: string;
  meta: string;
  amount: number;
  isOrigin: boolean;
  thumbnail: string | null;
  dealsCount: number;
}

/**
 * Cash encaissé par origine.
 *
 * Contenus et origines sans contenu (Cold DM, organique) sont classés ENSEMBLE
 * par montant : le bloc répond à « qu'est-ce qui me rapporte », et le démarchage
 * est une réponse aussi légitime qu'un contenu. Les lignes sans contenu se
 * distinguent par une vignette pointillée, jamais par une mise en retrait.
 */
function CashByOrigin({ profileId, periodStart, periodEnd, sinceConnection, allTimeStart }: {
  profileId?: string;
  periodStart: Date;
  periodEnd: Date;
  sinceConnection?: boolean;
  allTimeStart?: string | null;
}) {
  const [showAll, setShowAll] = useState(false);

  // Ce bloc a son PROPRE appel réseau : contrairement à ce que disait le commentaire
  // précédent, rien ne le bornait en amont. En « depuis connexion » il lisait donc TOUT
  // l'historique, y compris les paiements antérieurs à la mise en route des
  // intégrations, alors que la carte « Cash collecté » juste au-dessus s'arrête, elle, à
  // cette date. Deux totaux pour la même chose sur le même écran. On borne au même
  // point de départ ; sans borne haute, puisque le mode va jusqu'à aujourd'hui.
  const start = sinceConnection ? (allTimeStart ?? undefined) : periodStart.toISOString();
  const end = sinceConnection ? undefined : periodEnd.toISOString();

  const { data, isLoading } = useQuery<{ rows: OriginRow[]; total: number }>({
    queryKey: ['cash-by-origin', profileId, start, end],
    queryFn: () => {
      const p = new URLSearchParams();
      if (profileId) p.set('profileId', profileId);
      if (start) p.set('start', start);
      if (end) p.set('end', end);
      return fetch(`/api/payments/by-origin?${p}`).then(r => r.json());
    },
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const VISIBLES = 4;
  const visible = showAll ? rows : rows.slice(0, VISIBLES);

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">Cash encaissé par origine</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
            Attribution au premier contact, pas au dernier clic
          </div>
        </div>
      </div>

      {isLoading ? (
        <div style={{ padding: '24px 0' }}><InlineLoader /></div>
      ) : rows.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '32px 24px' }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--surface-2)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" /><path d="M12 6v2m0 8v2" />
            </svg>
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>Aucun revenu sur la période</div>
        </div>
      ) : (
        <>
          <div>
            {visible.map((r, i) => {
              const pct = total > 0 ? (r.amount / total) * 100 : 0;
              // « Sans attribution » signale une absence d'information : texte en
              // muted. Cold DM et organique sont des origines à part entière et
              // gardent la couleur normale.
              const dim = r.key === 'origin:manual';
              return (
                <div
                  key={r.key}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '10px 0',
                    borderTop: i === 0 ? 'none' : '1px solid var(--border-soft)',
                  }}
                >
                  {r.thumbnail ? (
                    <img
                      src={r.thumbnail}
                      alt=""
                      style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }}
                    />
                  ) : (
                    <div style={{
                      width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                      background: 'var(--bg)',
                      border: '1px dashed var(--border)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {r.isOrigin ? (
                        // Origine sans contenu : flèche d'envoi (démarchage, entrant direct)
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" />
                        </svg>
                      ) : (
                        // Contenu dont la vignette n'a pas pu être récupérée
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-4.5-4.5L6 21" />
                        </svg>
                      )}
                    </div>
                  )}

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 13, fontWeight: 600,
                      color: dim ? 'var(--muted)' : 'var(--ink)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {r.label}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{r.meta}</div>
                    <div style={{ height: 4, borderRadius: 2, background: 'var(--surface-2)', marginTop: 6, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', width: `${pct}%`, borderRadius: 2,
                        background: dim ? 'var(--border)' : GREEN,
                        transition: 'width var(--dur-base) var(--ease-out)',
                      }} />
                    </div>
                  </div>

                  <div style={{
                    fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
                    color: dim ? 'var(--muted)' : 'var(--ink)',
                    width: 74, textAlign: 'right', flexShrink: 0,
                  }}>
                    {fmtEur(r.amount)}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Note de rapprochement. Sans elle, deux blocs voisins affichent 10 200 €
              et 2 600 € sans que rien ne dise pourquoi : celui-ci ventile l'argent
              REÇU, la carte du haut compte l'argent VENDU. Une vente signée dont
              aucune échéance n'est encore tombée n'a aucune ligne ici — c'est
              exactement ce qui fait l'écart, et c'est invisible autrement. */}
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border-soft)', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
              Total de l&apos;argent <strong>reçu</strong>. Les ventes signées et pas encore
              encaissées n&apos;apparaissent pas ici.
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmtEur(total)}</div>
          </div>

          {rows.length > VISIBLES && (
            <button
              onClick={() => setShowAll(v => !v)}
              style={{
                marginTop: 10, width: '100%', padding: '8px 0',
                fontSize: 12, fontWeight: 600, color: 'var(--muted)',
                background: 'none', border: 'none', cursor: 'pointer',
              }}
            >
              {showAll ? 'Voir moins' : `Voir plus (${rows.length - VISIBLES})`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Au-delà de ce nombre de points, le graphique des revenus regroupe par tranches de
 * 7 jours. Seuil mesuré : à 82 barres, une barre fait 0,02 px de large sur la largeur
 * disponible — le graphique paraît vide alors que ses valeurs sont justes.
 */
const JOURS_AVANT_REGROUPEMENT = 62;

/**
 * Les statuts qu'une VENTE peut porter, avec leur libellé et leur couleur.
 * Mêmes valeurs que la contrainte `deals_status_check` et que lib/dealCash.ts.
 */
const STATUT_VENTE: Record<string, { label: string; color: string }> = {
  paid:     { label: 'Soldée', color: GREEN },
  open:     { label: 'En cours', color: 'var(--muted)' },
  past_due: { label: 'Impayé', color: RED },
  disputed: { label: 'Contestée', color: RED },
  ended:    { label: 'Terminée', color: 'var(--muted)' },
  canceled: { label: 'Annulée', color: 'var(--muted)' },
};

function TabRevenues({ encaissementsParJour, cashParVente, deals, period, periodIndex, onRefresh, refreshing, sinceConnection, profileId, allTimeStart, stripeConnected }: { encaissementsParJour?: JourEncaisse[]; cashParVente?: VenteCash[]; deals?: DealRecord[]; period: Period; periodIndex: number; onRefresh?: () => void; refreshing?: boolean; sinceConnection?: boolean; profileId?: string; allTimeStart?: string | null; stripeConnected?: boolean }) {
  // Le test portait sur `stripe` — donc sur le succès d'un appel à l'API Stripe. Une
  // panne de cet appel affichait « Connecte ton compte Stripe » sur un compte pourtant
  // connecté, et emportait avec elle les montants des ventes, qui vivent en base et ne
  // dépendent pas de Stripe. La question se lit désormais dans `integrations`, la table
  // qui porte la réponse.
  if (stripeConnected === false) return (
    <div style={{ textAlign: 'center', padding: '48px 24px' }}>
      <div style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 16 }}>Connecte ton compte Stripe pour voir les revenus.</div>
      {/* La connexion se fait en un clic via Stripe Connect. La clé secrète
          n'est plus le chemin nominal — elle ne sert que de repli aux comptes
          Standard pilotés par une autre plateforme, qu'OAuth ne peut pas
          atteindre. Détailler `sk_live_...` ici envoyait tout le monde vers
          la procédure la plus laborieuse. */}
      <div style={{ fontSize: 12, color: 'var(--faint)', lineHeight: 1.8 }}>
        Va dans <strong>Réglages → Stripe</strong> et clique sur <strong>Connecter</strong>.
      </div>
    </div>
  );

  const { periodStart, periodEnd } = getPeriodWindow(periodIndex, period === 7 ? 'week' : 'month');

  // Trésorerie de la période — « combien est rentré ». Les journées arrivent déjà
  // bornées ET groupées en heure de Paris par get_encaissements_par_jour : plus de
  // filtrage ni de re-groupement ici, donc plus de risque que la fenêtre du composant
  // et celle du fetch divergent (la classe de bug qui faisait afficher au tableau des
  // paiements de mois que les cartes ne comptaient pas).
  const jours: JourEncaisse[] = encaissementsParJour ?? [];
  const cashParJour = new Map<string, number>();
  for (const j of jours) cashParJour.set(j.jour, calculerCash(lignesDepuisSommes(j)).net);
  const nbPaiementsRecus = jours.reduce((s, j) => s + (j.nb_recus ?? 0), 0);
  // (le tableau du bas liste les VENTES de la période — voir `ventesAffichees` plus bas)

  // Cash contracté : somme des DEALS signés dans la période.
  //
  // Cet onglet ne lit plus les calls du tout. Ils ne servaient qu'à compter les « deals
  // closés » du panier moyen et du sous-titre — sur une AUTRE date (`booked_at`) et une
  // AUTRE population que le montant affiché juste à côté.
  //
  // Un deal peut exister SANS call — upsell, vente hors pipeline. Le sommer depuis les
  // calls le rendait invisible : c'était le dernier écart à impact financier réel
  // (identifié le 2026-08-19).
  //
  // Découpé sur `signed_at` : un deal signé ce mois sur un call du mois dernier
  // appartient au cash de ce mois — c'est le mois où l'argent a été engagé. Même règle
  // que useCoachData : les deux écrans convergent sur la même source ET la même date.
  //
  // Deals annulés exclus (une vente annulée n'a pas été signée), même filtre que
  // computeDealTotals dans lib/salesCallStats.ts.
  const dealsInPeriod = dealsDeLaPeriode(deals, periodStart, periodEnd, sinceConnection);
  const cashContracte = dealsInPeriod.reduce((s, d) => s + Number(d.amount_total || 0), 0);

  // NET, pas brut : encaissé − remboursé − contesté, via `calculerCash`, la règle
  // partagée de lib/dealCash.ts. La somme des seuls `succeeded` affichait 1 000 € là
  // où la page Paiements affichait 800 € sur le même deal. Number() est fait à
  // l'intérieur : les numeric Postgres arrivent en chaîne, et une concaténation
  // silencieuse ("10" + "20" = "1020") passerait le typage.
  const cashCollecte = [...cashParJour.values()].reduce((s, n) => s + n, 0);

  // ── Taux de collecte, par COHORTE de deals signés ────────────────────────────
  //
  // Numérateur et dénominateur portent sur les MÊMES deals : ceux signés dans la
  // période. On somme TOUS leurs paiements, sans les borner sur la fenêtre.
  //
  // L'ancienne formule rapportait « l'argent rentré pendant la période » à « l'argent
  // vendu pendant la période » — deux ensembles de deals différents. Une échéance
  // encaissée ce mois-ci sur un deal signé le mois dernier comptait au numérateur sans
  // compter au dénominateur : le taux pouvait dépasser 100 %, et s'affichait alors en
  // vert vif, ce qui se lisait comme une performance.
  //
  // Contrepartie assumée : un mois passé peut voir son taux MONTER plus tard, au fur et
  // à mesure que les échéances de ses ventes tombent. C'est le sens même de la
  // question posée (« sur ce que j'ai vendu ce mois-là, combien est rentré à ce
  // jour »). Décision de Chris, 2026-08-30.
  const parDeal = new Map<string, LignePaiement[]>();
  for (const v of cashParVente ?? []) {
    if (v.deal_id) parDeal.set(v.deal_id, lignesDepuisSommes(v));
  }
  // `encaisseRetenu` et non `.net` : un client peut verser PLUS que sa vente (double
  // prélèvement, montant baissé après paiement). Sans écrêtage vente par vente, le taux
  // dépasse 100 % — affiché en vert, donc lu comme une performance alors que c'est de
  // l'argent dû au client — et le surplus d'une vente vient masquer l'impayé d'une
  // autre dans le total. Le surplus n'est pas perdu : `aRendre` ci-dessous l'affiche
  // sur la ligne concernée. Voir lib/dealCash.ts pour la règle et ses deux usages.
  const cashDeLaVente = (d: DealRecord) =>
    d.id ? encaisseRetenu(calculerCash(parDeal.get(d.id) ?? []), d.amount_total) : 0;
  const cashCollecteCohorte = dealsInPeriod.reduce((s, d) => s + cashDeLaVente(d), 0);
  // Panier moyen = ce que vaut une VENTE, donc sur le contracté et le nombre de deals —
  // pas sur le collecté divisé par le nombre de paiements, qui ferait chuter la moyenne
  // dès qu'un deal est payé en 3× (3 paiements pour 1 vente).
  //
  // Le dénominateur compte les DEALS de la période, plus les calls closés : le
  // numérateur venait des deals découpés sur `signed_at`, le dénominateur des calls
  // découpés sur `booked_at` — deux populations et deux dates pour une seule division.
  // Un deal sans call gonflait le seul numérateur, un call closé sans deal le seul
  // dénominateur. Le sous-titre « deals closés (N) » annonçait d'ailleurs des deals en
  // comptant des calls.
  const avgBasket = dealsInPeriod.length > 0 ? cashContracte / dealsInPeriod.length : 0;
  // null et non 0 quand il n'y a rien à collecter : « 0 % » en rouge sur une période
  // sans aucune vente affirme un échec là où il n'y a rien à mesurer. Constaté à
  // l'écran sur mai 2026 et sur la semaine en cours.
  const cashCollectePct = cashContracte > 0 ? Math.round((cashCollecteCohorte / cashContracte) * 100) : null;

  // ── Ventilation par jour ────────────────────────────────────────────────────
  //
  // Deux corrections, toutes deux vérifiées à l'écran le 2026-08-30 :
  //
  // 1. LE JOUR EST CELUI DE PARIS, PAS CELUI D'UTC. Le code comparait
  //    `p.date.startsWith(iso)` où `iso` est un jour de Paris et `p.date` un instant
  //    UTC. Le paiement de 300 € horodaté 2026-08-20T22:00:52Z (soit le 21 août à
  //    00h00 à Paris) s'affichait « 21 août » dans le tableau et tombait dans la barre
  //    du 20 août sur le même écran. Même défaut sur `signed_at`, avec en prime une
  //    fuite de montant : un deal signé le 1er à 00h30 Paris entre dans `dealsInPeriod`
  //    (comparaison d'instants) mais son jour UTC appartient au mois précédent, donc
  //    aucune barre ne le porte et la somme des barres cesse de valoir le total.
  //
  // 2. LA FENÊTRE SUIT LES CARTES. La boucle partait toujours de `periodStart`, soit le
  //    mois ou la semaine EN COURS. En All-Time les cartes lisent tout l'historique
  //    (`sinceConnection` court-circuite le filtre de période) : l'écran affichait
  //    10 200 € en carte pour 5 700 € de barres, sur un axe borné au 1er–29 août alors
  //    que la période annoncée était « depuis le 09/06 ». La boucle se borne désormais
  //    sur l'étendue réelle des données quand la période n'en fournit pas.
  const graphe: { rows: { date: string; ca: number; contracte: number }[]; parSemaine: boolean } = (() => {
    const todayStr = parisDateStr(new Date());
    // Regroupement en un passage, sur le jour de Paris de chaque montant.
    // Net, comme la carte : un remboursement porte désormais la date du paiement
    // qu'il annule, il retombe donc dans la même barre et la creuse d'autant.
    const caParJour = cashParJour;
    const contracteParJour = new Map<string, number>();
    for (const d of dealsInPeriod) {
      if (!d.signed_at) continue;
      const j = parisDateStr(new Date(d.signed_at));
      contracteParJour.set(j, (contracteParJour.get(j) ?? 0) + Number(d.amount_total || 0));
    }

    // En mode « depuis connexion » la fenêtre calendaire ne veut rien dire : on part de
    // la date de connexion, ou du premier jour qui porte de l'argent, jamais du 1er du
    // mois en cours.
    let debut = periodStart;
    if (sinceConnection) {
      const joursAvecDonnee = [...caParJour.keys(), ...contracteParJour.keys()].sort();
      const bornes = [
        ...(allTimeStart ? [parisDateStr(new Date(allTimeStart))] : []),
        ...(joursAvecDonnee.length ? [joursAvecDonnee[0]] : []),
      ].sort();
      // Aucune donnée ET aucune date de connexion : on retombe sur la période courante
      // plutôt que d'inventer une borne.
      if (bornes.length) {
        const [y, m, dd] = bornes[0].split('-').map(Number);
        debut = new Date(Date.UTC(y, m - 1, dd, 12, 0, 0));
      }
    }

    const rows: { date: string; ca: number; contracte: number }[] = [];
    let d = debut;
    const fin = sinceConnection ? new Date() : periodEnd;
    // Garde-fou : une borne aberrante ne doit produire ni boucle sans fin, ni graphique
    // de plusieurs milliers de barres.
    const MAX_JOURS = 800;
    while (d.getTime() <= fin.getTime() && rows.length < MAX_JOURS) {
      const iso = parisDateStr(d);
      if (iso > todayStr) break; // plafonne à aujourd'hui (pas de jours futurs à 0 €)
      rows.push({ date: iso, ca: caParJour.get(iso) ?? 0, contracte: contracteParJour.get(iso) ?? 0 });
      d = parisAddDays(d, 1);
    }

    // Au-delà d'environ deux mois, une barre par jour devient plus fine qu'un pixel et
    // le graphique paraît VIDE — mesuré : sur la fenêtre All-Time de 82 jours, les
    // barres faisaient 0,02 px de large alors que leurs valeurs étaient justes. On
    // regroupe donc par tranches de 7 jours au-delà du seuil. La somme est préservée :
    // c'est l'invariant qui lie ce graphique aux cartes du dessus.
    if (rows.length <= JOURS_AVANT_REGROUPEMENT) return { rows, parSemaine: false };
    const paquets: { date: string; ca: number; contracte: number }[] = [];
    for (let i = 0; i < rows.length; i += 7) {
      const tranche = rows.slice(i, i + 7);
      paquets.push({
        date: tranche[0].date,
        ca: tranche.reduce((s, r) => s + r.ca, 0),
        contracte: tranche.reduce((s, r) => s + r.contracte, 0),
      });
    }
    return { rows: paquets, parSemaine: true };
  })();
  const revenueByDay = graphe.rows;

  // Une ligne par vente de la période, de la plus récente à la plus ancienne, avec ce
  // qui en a été encaissé À CE JOUR — donc la même valeur, deal par deal, que celle qui
  // compose le numérateur du taux de collecte.
  const ventesAffichees = [...dealsInPeriod]
    .sort((a, b) => ((a.signed_at ?? '') < (b.signed_at ?? '') ? 1 : (a.signed_at ?? '') > (b.signed_at ?? '') ? -1 : 0))
    .map(d => ({
      id: d.id,
      signedAt: d.signed_at ?? null,
      client: d.buyer_name ?? '',
      contracte: Number(d.amount_total || 0),
      encaisse: cashDeLaVente(d),
      // Ce qui a été versé AU-DELÀ du montant de la vente. Nul dans l'immense
      // majorité des cas ; quand il ne l'est pas, il explique à lui seul pourquoi la
      // carte « Cash collecté » du haut annonce plus que le total de cette colonne.
      aRendre: d.id ? aRembourser(calculerCash(parDeal.get(d.id) ?? []), d.amount_total) : 0,
      statut: d.status ?? 'open',
    }));

  const libellePeriode = libelleFenetre(period, periodIndex, sinceConnection, allTimeStart);

  return (
    <div className="stack">
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={onRefresh} disabled={refreshing} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', fontSize: 12, fontWeight: 600, borderRadius: 8, cursor: refreshing ? 'default' : 'pointer', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--muted)', opacity: refreshing ? 0.6 : 1, transition: 'all .15s' }}>
          <span style={{ display: 'inline-block', animation: refreshing ? 'spin 1s linear infinite' : 'none', fontSize: 14 }}>↻</span>
          {refreshing ? 'Actualisation…' : 'Actualiser'}
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '12px 14px' }}>
          <div className="eyebrow-sm" style={{ color: 'var(--muted)', marginBottom: 6 }}>Cash contracté</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink)', lineHeight: 1 }}>{fmtEur(cashContracte)}</div>
          <div style={{ fontSize: 10, color: 'var(--faint)', marginTop: 4 }}>deals signés ({dealsInPeriod.length})</div>
        </div>
        <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '12px 14px' }}>
          <div className="eyebrow-sm" style={{ color: 'var(--muted)', marginBottom: 6 }}>Cash collecté</div>
          {/* La couleur suit le SIGNE, pas le libellé de la carte. Depuis qu'un
              remboursement porte la date du paiement qu'il annule, une période peut
              sortir plus d'argent qu'elle n'en fait entrer — typiquement un mois
              ancien dont l'unique vente a été remboursée depuis. Peindre « − 200 € »
              en vert le ferait lire comme une bonne nouvelle. On n'y met pas non plus
              de plancher à 0 : le trou est réel et doit se voir. */}
          <div style={{ fontSize: 22, fontWeight: 800, color: cashCollecte < 0 ? AMBER : GREEN, lineHeight: 1 }}>{fmtEur(cashCollecte)}</div>
          <div style={{ fontSize: 10, color: 'var(--faint)', marginTop: 4 }}>paiements reçus ({nbPaiementsRecus})</div>
        </div>
        <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '12px 14px' }}>
          <div className="eyebrow-sm" style={{ color: 'var(--muted)', marginBottom: 6 }}>Panier moyen</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink)', lineHeight: 1 }}>{fmtEur(Math.round(avgBasket))}</div>
          <div style={{ fontSize: 10, color: 'var(--faint)', marginTop: 4 }}>{dealsInPeriod.length > 0 ? `sur ${dealsInPeriod.length} deal${dealsInPeriod.length > 1 ? 's' : ''}` : 'aucun deal'}</div>
        </div>
        <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '12px 14px' }}>
          <div className="eyebrow-sm" style={{ color: 'var(--muted)', marginBottom: 6 }}>Taux de cash collecté</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: cashCollectePct === null ? 'var(--muted)' : cashCollectePct >= 80 ? GREEN : cashCollectePct >= 50 ? AMBER : RED, lineHeight: 1 }}>{cashCollectePct === null ? '—' : `${cashCollectePct}%`}</div>
          {/* Le sous-titre dit quels deals sont comptés : sans ça, deux nombres
              « collectés » différents cohabitent sur la même rangée de cartes — celui
              de la carte voisine (rentré pendant la période) et celui du taux (rentré
              sur les ventes de la période). */}
          <div style={{ fontSize: 10, color: 'var(--faint)', marginTop: 4 }}>{cashCollectePct === null ? 'aucune vente à collecter' : `${fmtEur(cashCollecteCohorte)} sur les deals signés`}</div>
        </div>
      </div>

      {/* Le sous-titre disait « 30 derniers jours » sur une fenêtre qui est un MOIS
          CALENDAIRE (« 1 août – 31 août »), et le disait aussi en All-Time — faux deux
          fois, puisque `periodIndex` vaut 0 dans les deux cas. On reprend le libellé de
          la période réellement affichée, celui du bandeau du haut.
          xInterval : `Math.floor(n / 7) - 1` vaut −1 dès que la série compte moins de 7
          points, soit les 6 premiers jours de chaque mois. Recharts 3.8.1 traduit −1 en
          « un point sur 0 », et sa fonction getEveryNth renvoie alors un tableau VIDE :
          l'axe des dates disparaît complètement. Plancher à 0. */}
      <Card title={graphe.parSemaine ? 'Revenus / semaine' : 'Revenus / jour'} sub={`${libellePeriode} · deals signés & paiements encaissés${graphe.parSemaine ? ' · une barre = 7 jours' : ''}`}>
        <BarChart data={revenueByDay} bars={[{ key: 'contracte', label: 'Cash contracté', color: 'var(--accent-brand)' }, { key: 'ca', label: 'Cash collecté', color: GREEN }]} xKey="date" height={200} formatter={fmtEur} xInterval={period === 7 && !sinceConnection ? 0 : Math.max(0, Math.floor(revenueByDay.length / 7) - 1)} />
      </Card>

      {/* Empilé pleine largeur sous le graphique, jamais en colonne à côté. */}
      <CashByOrigin profileId={profileId} periodStart={periodStart} periodEnd={periodEnd} sinceConnection={sinceConnection} allTimeStart={allTimeStart} />

      {/* ── Dernières ventes ────────────────────────────────────────────────────
          Remplace « Derniers paiements », qui redisait en moins bien ce que la page
          Paiements dit déjà (par client, avec « À rattacher » et « Relances »), et
          laissait cet onglet sans jamais montrer une seule VENTE : on y lisait
          « 5 700 € · 5 deals signés » sans pouvoir savoir lesquels.

          Surtout, ce tableau rend les deux chiffres du haut VÉRIFIABLES ligne à
          ligne : la colonne « Contracté » totalise la carte « Cash contracté », et
          la colonne « Encaissé » totalise le numérateur du taux de collecte. Deux
          invariants qu'on ne pouvait contrôler qu'en requêtant la base.

          Un remboursement reste visible : il se lit dans l'écart entre les deux
          colonnes (800 € encaissés sur une vente de 1 000 €), et le détail
          paiement par paiement vit sur la page Paiements, à sa place. */}
      <div className="card">
        <div className="card-head">
          <div className="card-title">Dernières ventes</div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{libellePeriode}</div>
        </div>
        {ventesAffichees.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '28px 24px', fontSize: 13, color: 'var(--muted)' }}>
            Aucune vente signée sur la période
          </div>
        ) : (
        <table className="table" style={{ width: '100%' }}>
          <thead>
            <tr>
              {['Date', 'Client', 'Contracté', 'Encaissé', 'Statut'].map((h, i) => (
                <th key={i} className="eyebrow-sm" style={{ textAlign: i >= 2 && i <= 3 ? 'right' : 'left', color: 'var(--muted)', padding: '8px 10px' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ventesAffichees.map((v, i) => {
              const st = STATUT_VENTE[v.statut] ?? { label: v.statut, color: 'var(--muted)' };
              return (
              <tr key={v.id || i} style={{ borderTop: '1px solid var(--border-soft)' }}>
                {/* timeZone Europe/Paris explicite : la même date sert au graphique, qui
                    la calcule en heure de Paris. Sans ça les deux se contredisent sur une
                    signature de fin de journée. */}
                <td style={{ padding: '10px', fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                  {v.signedAt ? new Date(v.signedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'Europe/Paris' }) : '—'}
                </td>
                <td style={{ padding: '10px', fontSize: 12, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.client || '—'}</td>
                <td style={{ padding: '10px', fontSize: 13, fontWeight: 700, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtEur(v.contracte)}</td>
                {/* Soldé en vert, rien d'encaissé en muted : un 0 € noir au milieu de
                    montants noirs ne se distingue pas de ce qui est payé. */}
                <td style={{ padding: '10px', fontSize: 13, fontWeight: 700, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: v.encaisse <= 0 ? 'var(--muted)' : v.encaisse >= v.contracte - 0.01 ? GREEN : 'var(--ink)' }}>
                  {fmtEur(v.encaisse)}
                  {/* Le montant affiché est plafonné au contrat : sans cette mention,
                      un client qui a versé 1 200 € sur une vente de 1 000 € verrait
                      « 1 000 € » ici et « 1 200 € » sur la carte du haut, sans que rien
                      n'explique l'écart. Et 200 € qu'il faut lui rendre disparaîtraient
                      de l'écran. */}
                  {v.aRendre > 0 && (
                    <div style={{ fontSize: 10, fontWeight: 600, color: AMBER, marginTop: 2, whiteSpace: 'nowrap' }}>
                      +{fmtEur(v.aRendre)} à rendre
                    </div>
                  )}
                </td>
                <td style={{ padding: '10px' }}>
                  <span style={{ fontSize: 11, color: st.color, fontWeight: 600 }}>{st.label}</span>
                </td>
              </tr>
              );
            })}
          </tbody>
          <tfoot>
            {/* Le total est là pour être confronté aux cartes du haut, pas pour
                décorer : c'est lui qui fait de ce tableau une vérification. */}
            <tr style={{ borderTop: '1px solid var(--border)' }}>
              <td style={{ padding: '10px', fontSize: 11, color: 'var(--muted)', fontWeight: 600 }} colSpan={2}>
                {ventesAffichees.length} vente{ventesAffichees.length > 1 ? 's' : ''}
              </td>
              <td style={{ padding: '10px', fontSize: 13, fontWeight: 800, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtEur(cashContracte)}</td>
              <td style={{ padding: '10px', fontSize: 13, fontWeight: 800, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: GREEN }}>{fmtEur(cashCollecteCohorte)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
        )}
      </div>
    </div>
  );
}

// ─── TAB 6 : Short.io ─────────────────────────────────────────────────────────

interface MockLead {
  id?: string;
  igUserId: string;
  igUsername: string;
  igAvatar?: string;
  postId: string;
  postTitle: string;
  postType: 'IG' | 'YT';
  commentedAt: string;
  keyword: string;
  leadMagnetSent: boolean;
  hookReplied?: boolean;
  hookRepliedAt?: string | null;
  trackingLink?: string | null;
  lmClicked?: boolean;
  source?: string | null;
}

interface DestinationLink {
  id: string;
  label: string;
  url: string;
  type: 'calendly' | 'leadmagnet' | 'other';
}

// ── TabShortioB ──────────────────────────────────────────────────────────────

type ShortPeriod = 7 | 30;
type ProspectStatus = 'all' | 'pending' | 'booked' | 'closed' | 'noshow';

interface LeadMagnet { id: string; name: string; keyword: string; url?: string; }

function TabShortioB({ shortio, shortioLoading, ig, yt, leads, leadMagnets, destinations, lmHistory, hookRepliedEvents, lmReclameParLeadId, premierLmReclame, period: globalPeriod, periodIndex, profileId, prospectLinksData, clicksByPath, clicksByUrl, urlToCategoryFromDb, businessClicsFromDb, totalClicsChangePct, altKwToLmId, lmClickedByLeadId, linkClickedByLeadId, calls, callsAllTime, deals, leadIdToMediaId, igLive, ytLive, shortioChartHistory, shortioChartHistoryBio, shortioChartHistoryContent, shortioChartHistoryDm, shortioChartHistoryStory, joursCollectesShortio, premierJourCollecteShortio, selectedMetric, setSelectedMetric, chartFilter, setChartFilter, sinceConnection, integrationsReadyAt, allTimeStart }: {
  shortio: ShortioStats | null;
  shortioLoading?: boolean;
  ig: IGStats | null;
  yt: YTStats | null;
  leads: MockLead[];
  leadMagnets: LeadMagnet[];
  lmHistory?: { ig_user_id: string; keyword_matched: string; media_id: string | null; lead_magnet_sent: boolean; detected_at: string }[];
  hookRepliedEvents?: { prospect_key: string | null; occurred_at: string; metadata?: any }[];
  /** Fiches ayant appuye sur le bouton du DM1 — hors chaine, cf. docs. */
  lmReclameParLeadId?: Set<string>;
  /** Date du tout premier appui enregistre. `null` = mesure jamais alimentee ici. */
  premierLmReclame?: string | null;
  destinations: DestinationLink[];
  period: Period;
  periodIndex?: number;
  profileId?: string;
  prospectLinksData?: any[];
  clicksByPath?: Map<string, number>;
  clicksByUrl?: Map<string, number>;
  urlToCategoryFromDb?: Map<string, string>;
  businessClicsFromDb?: number;
  totalClicsChangePct?: number | null;
  altKwToLmId?: Map<string, string>;
  lmClickedByLeadId?: Map<string, string>;
  linkClickedByLeadId?: Map<string, string>;
  calls?: CallRecord[];
  callsAllTime?: CallRecord[];
  /**
   * Le cash CONTRACTE. `calls.revenue` est ce que l'eleve a DECLARE — voir docs.
   *
   * ⚠️ Cet onglet recoit le jeu COMPLET (`deals`), jamais `dealsEff` decoupe sur la
   * periode, et c'est la difference qui compte. Le Parcours des leads borne la seule
   * ENTREE : une personne entree en juin appartient a la ligne de juin meme si elle
   * close en juillet. Avec un jeu deja decoupe sur `signed_at`, sa ligne afficherait
   * « 1 close, 0 EUR » — le COMPTE vient d'un jeu non borne, le MONTANT d'un jeu borne.
   *
   * ⚠️ Aucun cas ne l'exhibe en base au 2026-09-01 : les deux ventes rattachables a une
   * cohorte tombent dans le mois de leur entree, et la conversion la plus longue fait
   * 8 jours sans traverser de mois. Le defaut n'attend qu'une conversion a cheval sur
   * deux periodes — ne pas le croire absent parce que l'ecran est juste.
   *
   * En contrepartie, TOUT bornage du cash se fait ici, par `venteDansLaPeriodeB` : la
   * date de vente, jamais celle de reservation ni `signed_at`.
   */
  deals?: DealRecord[];
  leadIdToMediaId?: Map<string, string>;
  igLive?: IGStats | null;
  ytLive?: YTStats | null;
  shortioChartHistory?: { date: string; clicks: number }[];
  shortioChartHistoryBio?: { date: string; ig: number; yt: number }[];
  shortioChartHistoryContent?: { date: string; ig: number; yt: number }[];
  shortioChartHistoryDm?: { date: string; calendly: number; lm: number }[];
  shortioChartHistoryStory?: { date: string; story: number }[];
  /** Jours où la collecte Short.io a tourné. Une date absente = panne, pas zéro clic. */
  joursCollectesShortio?: Set<string>;
  premierJourCollecteShortio?: string | null;
  // Remontés au composant parent (PageClientStats) : ce composant est démonté/remonté
  // à chaque changement de période (loading passe par true le temps du refetch), donc
  // un state local ici serait reset à 'clics' à chaque clic précédent/suivant.
  selectedMetric: 'clics' | 'leads' | 'hookReply' | 'calendlyLinks' | 'activation' | 'calls';
  setSelectedMetric: (m: 'clics' | 'leads' | 'hookReply' | 'calendlyLinks' | 'activation' | 'calls') => void;
  chartFilter: 'all' | 'dm' | 'content' | 'bio' | 'story';
  setChartFilter: (f: 'all' | 'dm' | 'content' | 'bio' | 'story') => void;
  sinceConnection?: boolean;
  integrationsReadyAt?: string | null;
  /** Début réel de la fenêtre All-Time (identique à celui utilisé par le fetch). */
  allTimeStart?: string | null;
}) {
  const now = new Date();
  // Stories individuelles avec CTA (LM ou Calendly) — pour afficher titre/miniature des
  // stories orphelines (hors séquence) dans "Performance par contenu". Même queryKey que
  // TabInstagram (['stories', profileId]) : React Query déduplique l'appel réseau.
  const { data: allStoriesDataForContent } = useQuery({
    queryKey: ['stories', profileId],
    queryFn: () => fetch(profileId ? `/api/client/stories?profileId=${profileId}` : '/api/client/stories').then(r => r.json()),
    staleTime: 60 * 1000,
  });
  const allStoriesForContent: any[] = allStoriesDataForContent?.stories ?? [];

  const { data: storySequenceFunnelData } = useQuery({
    queryKey: ['story-sequences-funnel', profileId],
    // Sans profileId (élève consultant sa propre page), ne pas envoyer "?profileId=undefined"
    // ni bloquer la query via enabled — resolveProfileId retombe sur user.id si le param
    // est absent (cf. même bug corrigé pour allStoriesData/sequencesData plus haut).
    queryFn: () => fetch(profileId ? `/api/instagram/story-sequences-stats?profileId=${profileId}&mode=funnel` : '/api/instagram/story-sequences-stats?mode=funnel').then(r => r.json()),
    staleTime: 60 * 1000,
  });
  const storySequenceRows: any[] = storySequenceFunnelData?.rows ?? [];

  const sPeriod: ShortPeriod = globalPeriod === 7 ? 7 : 30;
  const _pIdx = periodIndex ?? 0;
  // Malgré le nom historique "utc", produit la date calendaire vue depuis Paris —
  // cohérent avec periodStart/periodEnd (getPeriodWindow) qui ne tombent plus sur
  // minuit UTC. Gardé sous ce nom pour ne pas re-toucher tous les appels ci-dessous.
  const utcDateStr = (d: Date) => parisDateStr(d);
  // Bornes calendaires réelles (semaine lundi-dimanche / mois calendaire) via
  // lib/period.ts, cohérent avec fetchSnapshot et tous les autres calculateurs de
  // bornes du fichier.
  const { periodStart, periodEnd } = getPeriodWindow(_pIdx, sPeriod === 7 ? 'week' : 'month');

  // Rechargé à chaque montage de l'onglet — source de vérité pour les stats Calendly DM
  // ig_lead_id est nécessaire à wasCalendlyLinkSent/calendlySentAt pour retrouver
  // l'événement link_clicked survivant quand la ligne du lien a été supprimée puis
  // régénérée (la route renvoie déjà toutes les colonnes, seul le type l'omettait).
  const [prospectLinksDb, setProspectLinksDb] = useState<{ id: string; created_at: string; calendly_link_sent: boolean | null; calendly_link_sent_at: string | null; first_click_at: string | null; ig_lead_id: string | null }[]>([]);
  useEffect(() => {
    const url = profileId ? `/api/client/prospect-links?profileId=${profileId}` : '/api/client/prospect-links';
    fetch(url).then(r => r.ok ? r.json() : null).then(d => { if (d?.links) setProspectLinksDb(d.links); }).catch(() => {});
  }, [profileId]);
  const [selectedContentId, setSelectedContentId] = useState<string | null>(null);
  // Tableau contenu : tri
  type SortKey = 'clicsDesc' | 'lmDetectes' | 'lmClics' | 'lmReponses' | 'dmCount' | 'callsBooked' | 'callsHonored' | 'qualifiedPct' | 'closed' | 'revenue' | 'vuesParCall' | 'cashParVue' | 'views';
  const [sortKey, setSortKey] = useState<SortKey>('callsBooked');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  // Tableau breakdown par source : tri
  type BdSortKey = 'default' | 'clics' | 'booked' | 'honored' | 'closed' | 'revenue';
  const [bdSortKey, setBdSortKey] = useState<BdSortKey>('default');
  const [bdSortDir, setBdSortDir] = useState<'desc' | 'asc'>('desc');
  // Tableau : filtres
  const [filterPlatform, setFilterPlatform] = useState<'all' | 'IG' | 'YT'>('all');
  const [filterHas, setFilterHas] = useState<Set<SortKey>>(new Set());
  const [filterSearch, setFilterSearch] = useState('');
  // Le depliage de la grille de cartes. Il remplace la modale « Voir tout », qui
  // rouvrait les memes contenus SOUS FORME DE LIGNES : deux mises en page pour une
  // meme donnee, et la forme en lignes est justement celle que les cartes remplacent
  // — en colonnes adjacentes, l'oeil lit un enchainement entre trois roles qui n'en
  // forment pas un. La modale portait d'ailleurs encore l'ancien titre de la section.
  const [toutAfficher, setToutAfficher] = useState(false);
  const [parcoursAngle, setParcoursAngle] = useState<'contenu' | 'lm'>('contenu');
  const [aideOuverte, setAideOuverte] = useState<string | null>(null);
  const [parcoursPlateforme, setParcoursPlateforme] = useState<'IG' | 'YT'>('IG');
  // Recherche, filtres et tri du Parcours. Volontairement SEPARES de ceux de « Ce que
  // fait chaque contenu » : les deux tableaux ne montrent pas les memes colonnes, donc
  // ils ne peuvent pas partager des filtres — un filtre ne porte que sur un nombre
  // affiche, et ce qui est affiche differe.
  const [parcoursRecherche, setParcoursRecherche] = useState('');
  const [parcoursFiltres, setParcoursFiltres] = useState<Set<string>>(new Set());
  const [parcoursTri, setParcoursTri] = useState('callsBookes');
  const [parcoursTriDir, setParcoursTriDir] = useState<'desc' | 'asc'>('desc');
  // Le groupe « Engagement du DM1 » est REPLIE par defaut.
  //
  // Ce sont deux colonnes hors chaine, utiles quand on regle le message automatique,
  // inutiles le reste du temps — et elles s'inseraient au milieu d'une lecture de gauche
  // a droite. Les replier rend la chaine lisible d'un trait par defaut ; les deplier
  // reste a un clic, au meme endroit que les filtres.
  const [dm1Ouvert, setDm1Ouvert] = useState(false);
  // Modale "Voir tout" (performance par contenu) : Echap la ferme. Les autres
  // couches de cette page (post, video, story selectionnes) vivent dans des
  // sous-composants distincts et sont a traiter separement.
  // Modal détail contenu
  const [detailModal, setDetailModal] = useState<any | null>(null);

  if (!shortio) return shortioLoading ? <InlineLoader /> : <Empty msg={(periodIndex ?? 0) > 0 ? "Pas de données Short.io pour cette période." : "Connecte ton compte Short.io pour voir les stats."} />;

  // En S-1+ les posts DB peuvent être vides (snapshot hors fenêtre) — fallback live pour les métadonnées
  // Thumbnails = métadonnées fixes du contenu, toujours depuis igLive (les URLs CDN IG expirent ~24h)
  const igLiveThumbnails = new Map<string, string | null>((igLive?.posts ?? []).map((p: any) => [p.id, p.thumbnail ?? null]));
  const igPostsRaw = (ig?.posts?.length ? ig.posts : igLive?.posts) || [];
  const igPosts = igPostsRaw.map((p: any) => ({ ...p, thumbnail: igLiveThumbnails.get(p.id) ?? p.thumbnail ?? null }));
  const ytVideos = (yt?.videos?.length ? yt.videos : ytLive?.videos) || [];
  // Vues lifetime "à jour" pour Cash/Vue — toujours depuis igLive/ytLive (jamais l'historique figé
  // d'une période passée, qui capture un instantané des vues à cette date-là, pas le total actuel)
  // Apparie sur le jeu le PLUS LARGE disponible : une paire dont le 1er call sort de
  // la periode affichee doit rester reconnue, sinon le 2e recompte comme une
  // opportunite neuve sur le contenu.
  const continuationsContenu = idsDeContinuation(callsAllTime ?? calls ?? []);

  // Repli d'attribution LEGITIME : le contenu d'ou vient un lien prospect.
  //
  // Pose a la creation du lien et jamais reecrit, contrairement a
  // `instagram_leads.media_id` qu'un commentaire posterieur ecrase. Sert uniquement
  // quand `utm_content` manque — cas des liens crees avant le correctif du 19/08.
  const contenuDuLienProspect = new Map<string, string>(
    (prospectLinksData ?? [])
      .filter((pl: any) => pl?.id && pl?.content_id)
      .map((pl: any) => [String(pl.id), String(pl.content_id)]),
  );

  const igLiveViewsById = new Map<string, number>((igLive?.posts ?? []).map((p: any) => [p.id, p.views || p.reach || 0]));
  const ytLiveViewsById = new Map<string, number>((ytLive?.videos ?? []).map((v: any) => [v.id, v.views || 0]));

  // Index prospect_links DB par short_url
  const plDbByUrl2 = new Map<string, any>();
  for (const pl of (prospectLinksData ?? [])) {
    if (pl.short_url) plDbByUrl2.set(pl.short_url.toLowerCase(), pl);
  }

  const allShortioLinks: any[] = (shortio.links ?? []).map((l: any) => {
    let linkType = l.linkType;
    let utmContent: string | null = null;
    try {
      const u = new URL(l.originalUrl || '');
      if (!linkType) linkType = u.searchParams.get('utm_medium') || null;
      utmContent = u.searchParams.get('utm_content') || null;
    } catch { /* ignore */ }
    const plDb = plDbByUrl2.get((l.shortUrl || '').toLowerCase());
    // bioType dérivé depuis linkCategory (source de vérité non-ambiguë)
    const lc: string | null = l.linkCategory ?? null;
    const bioType: string | null = lc === 'calendly_bio_ig' || lc === 'lm_bio_ig' ? 'instagram'
      : lc === 'calendly_bio_yt' || lc === 'lm_bio_yt' ? 'youtube'
      : null;
    return {
      ...l,
      linkType,
      linkCategory: lc,
      bioType,
      callBooked:  plDb ? (plDb.callBooked  ?? false) : (l.callBooked  ?? false),
      dealClosed:  plDb ? (plDb.dealClosed  ?? null)  : (l.dealClosed  ?? null),
      revenue:     plDb ? (plDb.revenue     ?? 0)     : (l.revenue     ?? 0),
      ig_username:           plDb?.ig_username           ?? l.ig_username           ?? null,
      ig_lead_id:            plDb?.ig_lead_id             ?? l.ig_lead_id             ?? null,
      calendly_link_sent:    plDb?.calendly_link_sent     ?? l.calendly_link_sent     ?? null,
      calendly_link_sent_at: plDb?.calendly_link_sent_at  ?? l.calendly_link_sent_at  ?? null,
      postId:                plDb?.post_id               ?? l.postId                 ?? utmContent ?? null,
    };
  });
  const postLinks     = allShortioLinks.filter((l: any) => l.linkType === 'post' || l.linkType === 'description');
  const prospectLinks = allShortioLinks.filter((l: any) => l.linkType === 'dm' || l.linkType === 'prospect');

  // Helper : clics sur un lien Short.io pour la période courante.
  // DB (clicksByUrl) prioritaire. Fallback API seulement si aucun snapshot en DB (undefined).
  // En S-1+, DB fait autorité (pas de fallback API — les données live ne correspondent pas à la période).
  const linkClics = (l: any): number => {
    if (!l) return 0;
    const urlKey = (l.shortUrl || '').toLowerCase();
    const dbClics = clicksByUrl?.get(urlKey);
    if (_pIdx > 0) return dbClics ?? 0;
    // S-0 : DB prioritaire ; fallback API seulement si aucun snapshot en DB (undefined)
    if (dbClics !== undefined) return dbClics;
    if (sPeriod === 30) return l.clicsHumains || 0;
    const pts: { date?: string; clicks: number }[] = l.chartData || [];
    if (sinceConnection) return pts.reduce((s, p) => s + (p.clicks || 0), 0);
    return pts.filter(p => p.date && new Date(p.date).getTime() >= periodStart.getTime() && new Date(p.date).getTime() <= periodEnd.getTime())
      .reduce((s, p) => s + (p.clicks || 0), 0);
  };

  // Helper : clics agrégés domaine pour la période
  // Filtre par période (fenêtre [periodStart, periodEnd]) — fonction unique réutilisée
  // partout dans ce composant, pour ne pas dupliquer la logique de bornage _pIdx.
  // En mode "depuis connexion", les données reçues sont déjà bornées [connectedAt,
  // aujourd'hui] par le fetch — ne rien re-clipper avec la fenêtre du mois/semaine en cours.
  const periodCutoff = periodStart.getTime();
  const periodEndMs = periodEnd.getTime();
  // All-Time : MEME borne basse que les graphiques (`allTimeStart`).
  //
  // `if (sinceConnection) return !!ts` acceptait TOUT, sans limite dans le passe, alors
  // que les courbes demarrent a `allTimeStart`. Un evenement anterieur etait donc
  // compte dans la carte et jamais trace : constate le 2026-08-30 sur « Liens Calendly
  // envoyes DM » — carte 3, courbe 2, le troisieme etant un lien du 7 juin quand
  // l'All-Time de ce profil commence le 9. Deux fenetres pour une meme metrique, meme
  // famille que « filtrer sur une date et decouper sur une autre ».
  //
  // EN PRODUCTION, RIEN NE PEUT EXISTER AVANT CETTE DATE — et c'est voulu.
  // `app/(client)/layout.tsx` verrouille l'acces tant que les 7 integrations ne sont
  // pas connectees : l'eleve ne voit que l'ecran de connexion, donc aucun lead magnet
  // ne part et aucun lien n'est cree. Le commentaire de ce verrou le dit en toutes
  // lettres — « le verrou fait coincider les deux dates par construction » — et
  // precise pourquoi : sans lui, un eleve accumulait des calls avant le demarrage de
  // la collecte de clics, et l'entonnoir divisait des calls par des clics inexistants.
  //
  // Cette borne n'est donc pas une parade defensive : elle FAIT RESPECTER un invariant
  // que le verrou promet deja. Un evenement anterieur ne peut etre qu'une trace de
  // developpement — comme le lien du 7 juin sur le profil de test — et le compter
  // reviendrait a mesurer une periode ou la plateforme n'etait pas en service.
  const allTimeCutoff = allTimeStart ? new Date(allTimeStart).getTime() : null;
  const isInPeriod = (ts: string | null | undefined) => {
    if (!ts) return false;
    if (sinceConnection) return allTimeCutoff === null || new Date(ts).getTime() >= allTimeCutoff;
    const t = new Date(ts).getTime();
    return t >= periodCutoff && (_pIdx === 0 || t <= periodEndMs);
  };
  const leadsInPeriod = leads.filter(l => isInPeriod(l.commentedAt));
  // Historique complet des interactions LM datées (une ligne par vraie interaction,
  // jamais écrasée) — utilisé pour "Leads commentaires" (graphique par jour) à la place
  // de leadsInPeriod, qui ne compte qu'une ligne par personne (état courant écrasé à
  // chaque nouvelle interaction). Cf. fix Performance LM (même session) pour le détail.
  const lmHistoryInPeriod = (lmHistory ?? []).filter(h => isInPeriod(h.detected_at));

  // ── ACQUISITION et ACTIVATION : depuis les JOURNAUX, jamais depuis la fiche ────
  //
  // `instagram_leads` porte une seule ligne par personne et par eleve
  // (`unique (profile_id, ig_user_id)`), et son `media_id` est ECRASE a chaque nouveau
  // commentaire. Mesure du 2026-08-29 : le post GUIDE affichait 1 call et 500 EUR avec
  // 0 commentaire et 0 conversation, parce qu'un commentaire posterieur sur un autre
  // post l'avait efface. Un contenu se faisait voler ses leads.
  //
  // Les deux colonnes se calculent donc depuis `instagram_lead_lm_history` (une ligne
  // par interaction, rien n'est jamais ecrase) et `prospect_events` (le journal des
  // reponses). Regles dans `lib/attribution-roles.ts`, testees sur fixtures reelles.
  //
  // Precalcule ICI, une seule passe sur le journal, et non dans la boucle par contenu :
  // sinon le cout croit avec le nombre de contenus multiplie par le nombre de leads.
  const lmHistoryPourRoles = lmHistory ?? [];
  const historiqueParPersonne = new Map<string, typeof lmHistoryPourRoles>();
  for (const h of lmHistoryPourRoles) {
    if (!h.ig_user_id) continue;
    const arr = historiqueParPersonne.get(h.ig_user_id);
    if (arr) arr.push(h); else historiqueParPersonne.set(h.ig_user_id, [h]);
  }
  // Pseudo (minuscules) vers ig_user_id : `prospect_events.prospect_key` porte le
  // pseudo, le journal LM porte l'identifiant. Les fiches font le pont.
  const igUserIdParPseudo = new Map<string, string>(
    (leads ?? []).filter(l => l.igUsername && l.igUserId).map(l => [l.igUsername.toLowerCase(), l.igUserId]),
  );

  // ig_user_id vers id de fiche : `lmClickedByLeadId` est indexe par id de fiche, alors
  // que le journal ne connait que la personne. Les fiches font le pont.
  const idFicheParPersonne = new Map<string, string>(
    (leads ?? []).filter(l => l.igUserId && l.id).map(l => [l.igUserId, l.id as string]),
  );
  // « Cette personne a-t-elle recu un lead magnet ? » — depuis le JOURNAL, jamais depuis
  // `instagram_leads.lead_magnet_sent`. La fiche decrit l'etat COURANT d'une personne :
  // ce drapeau retombe a false des qu'une interaction sans envoi le remplace. Mesure du
  // 2026-08-30 : incogniton.734 porte 8 lead magnets au journal et `lead_magnet_sent =
  // false` sur sa fiche. Lue sur la fiche, la ligne « Lead magnet » du breakdown par
  // source perdait ses calls sans que rien ne le signale.
  //
  // Sixieme et dernier usage de champ mutable de cette page corrige par ce chantier.
  // Le journal est la seule source qui compte, parce qu'il n'efface rien.
  //
  // ⚠️ Cet ensemble doit alimenter TOUS les lecteurs de « a recu un lead magnet », pas
  // seulement la ligne « Lead magnet ». Les lignes Cold DM / DM organique / Story sont
  // batles sur le COMPLEMENT (`dmDirectLinks = prospectLinks.filter(l => !isLMProspect(l))`) :
  // si les deux cotes ne lisent pas la meme source, la partition cesse d'etre exclusive
  // et une personne est comptee DEUX fois dans le total du breakdown. C'est exactement
  // ce qui est arrive en corrigeant la ligne « Lead magnet » seule (2026-08-30).
  const personnesAvecLmJournal = new Set<string>();
  for (const h of lmHistoryPourRoles) {
    if (h.lead_magnet_sent === false || !h.ig_user_id) continue;
    personnesAvecLmJournal.add(h.ig_user_id);
  }
  const fichesAvecLm = new Set<string>();
  for (const igUserId of personnesAvecLmJournal) {
    const idFiche = idFicheParPersonne.get(igUserId);
    if (idFiche) fichesAvecLm.add(idFiche);
  }
  // Certains liens prospect n'ont que le pseudo (crees hors flux Instagram).
  const pseudosAvecLm = new Set<string>();
  for (const l of leads ?? []) {
    if (l.igUsername && l.igUserId && personnesAvecLmJournal.has(l.igUserId)) {
      pseudosAvecLm.add(l.igUsername.toLowerCase());
    }
  }
  // Personnes ayant pris le lead magnet de CHAQUE contenu, depuis le journal.
  const personnesParContenuLm = new Map<string, Set<string>>();
  for (const h of lmHistoryPourRoles) {
    if (h.lead_magnet_sent === false || !h.ig_user_id || !h.media_id) continue;
    if (!isInPeriod(h.detected_at)) continue;
    let set = personnesParContenuLm.get(h.media_id);
    if (!set) { set = new Set<string>(); personnesParContenuLm.set(h.media_id, set); }
    set.add(h.ig_user_id);
  }

  const acquisitionParContenuGlobal = acquisitionParContenu(
    lmHistoryPourRoles.filter(h => isInPeriod(h.detected_at)),
  );

  // ── PARCOURS DES LEADS — ce que la chaîne sait des personnes ────────────────
  //
  // Assemblé ici une seule fois, puis passé tel quel aux DEUX angles. La logique vit
  // dans `lib/parcoursLeads.ts` : cet écran ne fait que lui présenter ses données.
  //
  // ⚠️ Les rendez-vous ne sont PAS bornés à la période. Le Parcours filtre sur la date
  // d'ENTRÉE et suit ensuite les gens indéfiniment : une personne entrée en juin qui
  // réserve en septembre appartient à la ligne de juin. Le seul cas réel de conversion
  // longue fait déjà 69 jours (entrée le 7 juin, rendez-vous le 15 août) — borner les
  // rendez-vous le ferait disparaître de sa propre cohorte.
  const callsPourParcours = callsAllTime ?? calls ?? [];
  const callsParFicheParcours = new Map<string, CallParcours[]>();
  for (const c of callsPourParcours) {
    if (!c.ig_lead_id) continue;
    const ligne: CallParcours = {
      id: c.id,
      ig_lead_id: c.ig_lead_id,
      status: c.status,
      // La RÉSERVATION, pas la tenue. C'est la réservation que le contenu a produite :
      // un lead magnet pris APRÈS que la personne a déjà réservé ne peut pas avoir
      // produit ce rendez-vous, et ranger sur la tenue le lui créditerait quand même,
      // en volant la ligne de la porte qui l'avait réellement fait venir.
      //
      // ⚠️ Ce n'est PAS le même choix que `dateDeVente`, contrairement à ce que disait
      // ce commentaire. Deux questions distinctes : « quelle porte a produit ce
      // rendez-vous » se répond à la réservation, « à quelle période l'argent
      // appartient » se répond à la tenue. Les confondre était le défaut corrigé ici.
      dateDeRattachement: c.booked_at ?? c.scheduled_at ?? null,
      honore: isCallHonored(c, now),
      closed: c.deal_closed === true,
      qualified: c.qualified ?? null,
    };
    const liste = callsParFicheParcours.get(c.ig_lead_id);
    if (liste) liste.push(ligne); else callsParFicheParcours.set(c.ig_lead_id, [ligne]);
  }

  // Le cash CONTRACTÉ, jamais `calls.revenue` — l'un est ce que l'élève a déclaré dans
  // son rapport, l'autre ce qui est engagé, et les deux ont divergé en base. `call_id`
  // non nul : une vente sans rendez-vous n'a aucun contenu à créditer, donc elle
  // n'apparaît pas dans cet onglet, et son total peut être inférieur à Vue générale.
  const montantParCallB = new Map<string, number>();
  for (const d of (deals ?? [])) {
    if (!d.call_id || d.status === 'canceled') continue;
    montantParCallB.set(d.call_id, (montantParCallB.get(d.call_id) ?? 0) + Number(d.amount_total || 0));
  }

  // ── La DATE du cash, qui n'est pas celle des calls bookés ────────────────────
  //
  // Règle 7 de `docs/perimetre-stats-referentiel.md` : un rendez-vous BOOKÉ se date au
  // moment où il est RÉSERVÉ, une VENTE à la TENUE du premier rendez-vous de sa chaîne.
  // Un rendez-vous réservé le 29 août pour le 2 septembre compte donc dans les calls
  // bookés d'août ET dans le cash de septembre, sur le même écran. Ce n'est pas une
  // incohérence : les aligner daterait la vente AVANT le rendez-vous qui l'a produite —
  // faux en permanence, là où le cas inverse est rare.
  //
  // On RECALCULE au lieu de lire `deals.signed_at`, que la règle est pourtant censée
  // remplir : la règle a été posée le 2026-09-01 et quatre des huit ventes en base
  // portent encore l'heure de SAISIE du rapport (20/08 21h47 pour un rendez-vous du
  // 19/08 13h30). Surtout, Funnel & Calls recalcule de la même façon : deux écrans qui
  // recalculent à l'identique ne peuvent pas diverger, deux écrans dont l'un lit une
  // copie figée le peuvent — c'est le mécanisme d'`instagram_leads`.
  const tousLesCallsB = callsAllTime ?? calls ?? [];
  const representantB = representantDOpportunite(tousLesCallsB);
  const parIdB = new Map(tousLesCallsB.map(c => [c.id, c]));
  const dateVenteDuCallB = (c: CallRecord): string | null => {
    const rep = parIdB.get(representantB.get(c.id) ?? c.id) ?? c;
    return rep.scheduled_at ?? rep.booked_at ?? null;
  };
  /** La RÉSERVATION est-elle dans la période ? Fenêtre des rendez-vous. */
  const dansFenetreResa = (c: CallRecord) => isInPeriod(callPeriodDate(c));
  /** La VENTE est-elle dans la période ? Fenêtre de l'argent. */
  const venteDansLaPeriodeB = (c: CallRecord) => isInPeriod(dateVenteDuCallB(c));
  /**
   * Le cash d'un lot de rendez-vous, borné sur la date de VENTE.
   *
   * Le lot doit avoir été constitué sur la population élargie (`callsInWindow`), jamais
   * sur un sous-ensemble déjà borné à la réservation : un rendez-vous réservé en août
   * pour septembre n'y serait pas, et filtrer dedans ne pourrait jamais le ramener.
   */
  const cashDeLot = (lot: { id: string }[]) =>
    lot.reduce((somme, c) => somme + (venteDansLaPeriodeB(c as CallRecord) ? (montantParCallB.get(c.id) ?? 0) : 0), 0);

  // « Ont répondu » se lit au JOURNAL, pas au drapeau `hook_replied` de la fiche : ce
  // drapeau retombe à false dès qu'une réponse de story ou un Cold DM le remplace, donc
  // une conversation déjà eue disparaissait.
  const ficheAReponduParcours = new Set<string>();
  for (const ev of (hookRepliedEvents ?? [])) {
    const personne = ev.prospect_key ? igUserIdParPseudo.get(ev.prospect_key.toLowerCase()) : undefined;
    const fiche = personne ? idFicheParPersonne.get(personne) : undefined;
    if (fiche) ficheAReponduParcours.add(fiche);
  }

  const ficheCalendlyEnvoyeParcours = new Set<string>();
  for (const pl of (prospectLinksData ?? [])) {
    if (!pl.ig_lead_id) continue;
    if (wasCalendlyLinkSent(pl, linkClickedByLeadId)) ficheCalendlyEnvoyeParcours.add(pl.ig_lead_id);
  }

  // Le journal indexe par fiche, pour `contenuConversion`.
  //
  // Un call porte `ig_lead_id` (la fiche), le journal porte `ig_user_id` (la personne).
  // `idFicheParPersonne` fait le pont, et il est deja construit plus haut pour le
  // Parcours — on ne redérive rien.
  const journalParFiche = new Map<string, typeof lmHistoryPourRoles>();
  for (const h of lmHistoryPourRoles) {
    const fiche = h.ig_user_id ? idFicheParPersonne.get(h.ig_user_id) : undefined;
    if (!fiche) continue;
    const liste = journalParFiche.get(fiche);
    if (liste) liste.push(h); else journalParFiche.set(fiche, [h]);
  }

  const refsParcours: RefsParcours = {
    ficheParPersonne: idFicheParPersonne,
    lmReclame: lmReclameParLeadId ?? new Set<string>(),
    lmClique: new Set(lmClickedByLeadId ? [...lmClickedByLeadId.keys()] : []),
    ontRepondu: ficheAReponduParcours,
    calendlyEnvoye: ficheCalendlyEnvoyeParcours,
    calendlyClique: new Set(linkClickedByLeadId ? [...linkClickedByLeadId.keys()] : []),
    callsParFiche: callsParFicheParcours,
    montantParCall: montantParCallB,
    continuations: continuationsContenu,
  };

  // Le journal reste ENTIER — la période s'applique au prédicat, jamais en amont. Le
  // tronquer ferait remonter un rendez-vous vers une cohorte antérieure sans qu'aucun
  // chiffre ne paraisse faux ; un test de `parcoursLeads.test.ts` le démontre.
  const entreeDansLaPeriodeParcours = (p: PriseParcours) => isInPeriod(p.detected_at);

  const parcoursParContenu = parcoursDesLeads(
    lmHistoryPourRoles, p => p.media_id, refsParcours, entreeDansLaPeriodeParcours,
  );
  // Les mots-clés alternatifs comptent pour le lead magnet qu'ils déclenchent : « BEAU »
  // peut pointer sur « Ubizen AI ». Sans ce repli, un contenu à mot-clé custom ouvrirait
  // une ligne fantôme portant le mot-clé au lieu du nom du lead magnet.
  const lmIdDuMotCle = (kw: string | null): string | null => {
    if (!kw) return null;
    const bas = kw.toLowerCase();
    return altKwToLmId?.get(bas) ?? leadMagnets.find(lm => (lm.keyword || '').toLowerCase() === bas)?.id ?? null;
  };
  const parcoursParLeadMagnet = parcoursDesLeads(
    lmHistoryPourRoles, p => lmIdDuMotCle(p.keyword_matched), refsParcours, entreeDansLaPeriodeParcours,
  );

  // ── Liens partagés (YouTube) ────────────────────────────────────────────────
  //
  // Autre source, autre clé de personne : ici l'identité n'apparaît qu'à la RÉSERVATION,
  // via l'e-mail de l'invité Calendly. Aucun tunnel DM en amont, donc aucune des six
  // premières colonnes du parcours Instagram — et c'est la forme réelle de ce canal, pas
  // un trou de mesure.
  //
  // Les rendez-vous sont bornés à la période par `calls`, qui l'est déjà : contrairement
  // au tunnel DM, il n'y a pas de date d'entrée à laquelle rattacher une cohorte.
  const callsPartages: CallPartage[] = (calls ?? []).map(c => ({
    id: c.id,
    contenu: c.utm_content ?? null,
    status: c.status,
    // L'e-mail identifie, le nom ne fait que rapprocher — même ordre que
    // `groupesDeProspects` dans lib/callSeries.ts.
    personne: c.invitee_email || c.invitee_name || null,
    honore: isCallHonored(c, now),
    closed: c.deal_closed === true,
    qualified: c.qualified ?? null,
  }));
  const parcoursPartage = parcoursDesLiensPartages(callsPartages, montantParCallB, continuationsContenu);

  // Une reponse = une CONVERSATION, creditee au contenu du dernier lead magnet pris
  // AVANT elle. Decision du 2026-08-29 : on compte les conversations, pas les
  // personnes — une discussion qui s'eteint puis redemarre grace a un autre contenu
  // compte deux fois, et c'etait tout l'objet du chantier.
  const activationParContenuGlobal = new Map<string, number>();
  for (const ev of (hookRepliedEvents ?? [])) {
    if (!ev.occurred_at || !isInPeriod(ev.occurred_at)) continue;
    // Le contenu FIGE par le webhook fait autorite : c'est une mesure, pas une deduction.
    // La reconstruction par horodatage — « le dernier lead magnet pris avant la reponse »
    // — ne sert que pour les evenements anterieurs au 2026-08-30, ou ce champ n'existait
    // pas encore. Elle s'eteindra donc d'elle-meme.
    const contenuFige: string | null = ev.metadata?.media_id ?? null;
    const igUserId = ev.prospect_key ? igUserIdParPseudo.get(ev.prospect_key.toLowerCase()) : undefined;
    const historique = igUserId ? historiqueParPersonne.get(igUserId) ?? [] : [];
    const cle = contenuFige ?? contenuActivation(historique, ev.occurred_at) ?? SANS_CONTENU;
    activationParContenuGlobal.set(cle, (activationParContenuGlobal.get(cle) ?? 0) + 1);
  }

  // Grain PERSONNES, par opposition a `activationParContenuGlobal` qui compte des
  // EVENEMENTS. Les deux repondent a deux questions et portent desormais deux noms :
  // « Conversations declenchees » pour les evenements, « Ont repondu » pour les
  // personnes. Une etape de parcours se franchit ou ne se franchit pas ; elle ne se
  // franchit pas deux fois.
  //
  // Source : le JOURNAL, jamais `instagram_leads.hook_replied`, qui retombe a false des
  // qu'un nouveau lead magnet part et ne peut donc pas servir de compteur.
  const personnesAyantRepondu = new Set<string>();
  for (const ev of (hookRepliedEvents ?? [])) {
    if (!ev.occurred_at || !isInPeriod(ev.occurred_at)) continue;
    const igUserId = ev.prospect_key ? igUserIdParPseudo.get(ev.prospect_key.toLowerCase()) : undefined;
    if (igUserId) personnesAyantRepondu.add(igUserId);
  }


  // ── Section 0 : KPIs ──
  // Clics totaux : bio Calendly + description (Calendly + LM) + clics DM/LM (prospect_links cliqués)
  // Clics totaux : toutes catégories business connues (bio + desc + lm_dm_auto + calendly_dm_prospect)
  // En S-0 : businessClicsFromDb couvre déjà toutes les BUSINESS_CATEGORIES
  // En S-1+ : sommer tous les clics de clicksByUrl (snapshots DB filtrés sur la fenêtre)
  const totalClics = (() => {
    if (shortioChartHistory && shortioChartHistory.length > 0) {
      // shortioChartHistory est déjà borné à la bonne fenêtre en amont (branchement 3
      // voies incluant "depuis connexion") — ne pas re-filtrer avec periodStart/periodEnd
      // (mois/semaine en cours) qui n'a de sens qu'en mode 7j/30j.
      if (sinceConnection) return shortioChartHistory.reduce((s, d) => s + d.clicks, 0);
      const startStr = utcDateStr(periodStart);
      const endStr   = utcDateStr(periodEnd);
      return shortioChartHistory
        .filter(d => d.date >= startStr && d.date <= endStr)
        .reduce((s, d) => s + d.clicks, 0);
    }
    if (_pIdx === 0 && businessClicsFromDb !== undefined) return businessClicsFromDb;
    // S-1+ : sommer depuis clicksByUrl tous les liens dont la link_category est business
    if (clicksByUrl && clicksByUrl.size > 0) {
      // On a besoin de la link_category par url — on la lit depuis shortio.links enrichis
      const catByUrl = new Map<string, string | null>();
      for (const l of (shortio?.links || []) as any[]) {
        if (l.shortUrl) catByUrl.set(l.shortUrl.toLowerCase(), l.linkCategory ?? null);
      }
      // Aussi depuis allShortioLinks qui est enrichi depuis DB
      for (const l of allShortioLinks) {
        if (l.shortUrl && !catByUrl.has(l.shortUrl.toLowerCase())) catByUrl.set(l.shortUrl.toLowerCase(), l.linkCategory ?? null);
      }
      let total = 0;
      for (const [url, clics] of clicksByUrl) {
        const cat = catByUrl.get(url);
        if (cat && CATS_BUSINESS.has(cat)) total += clics;
      }
      return total;
    }
    return 0;
  })();
  // Population « a recu un lead magnet » : depuis le JOURNAL, pas depuis la fiche.
  //
  // `instagram_leads.lead_magnet_sent` est le QUATRIEME champ mutable de cette table a
  // fausser une statistique, apres media_id, keyword_matched et hook_replied : le
  // chemin story le remet a la valeur de la nouvelle sequence. Mesure du 2026-08-30 sur
  // le profil de test : incogniton.734 a recu HUIT lead magnets d'apres le journal, et
  // sa fiche porte `lead_magnet_sent = false`. Il sortait donc du denominateur, qui
  // affichait 3 au lieu de 4 — et gonflait le taux de reponse a 67 % au lieu de 75 %.
  //
  // Un denominateur sous-evalue gonfle un taux : c'est exactement le defaut inverse de
  // celui que la garde `&& l.leadMagnetSent` corrigeait a l'origine (un cold DM au
  // numerateur sans etre au denominateur, 133 % observe). Les deux se soignent par la
  // meme regle : definir la population UNE fois, depuis le journal, et s'y tenir.
  const personnesAvecLm = new Set(
    lmHistoryInPeriod.filter(h => h.lead_magnet_sent !== false && h.ig_user_id).map(h => h.ig_user_id),
  );
  const lmEnvoyes = personnesAvecLm.size;
  // Numérateur strictement inclus dans le dénominateur : cette carte mesure la
  // performance du lead magnet ("parmi ceux à qui j'ai envoyé un LM, combien ont
  // répondu ?"), donc seule une réponse d'un lead AYANT reçu un LM la concerne.
  // Sans le `&& l.leadMagnetSent`, un cold DM (démarché à la main, jamais de LM
  // envoyé) comptait au numérateur sans jamais pouvoir compter au dénominateur —
  // observé à 133 % (4 réponses / 3 LM envoyés). Les cold DM restent comptés dans
  // la carte Leads et dans le Pipeline, ils sortent seulement de CE ratio.
  // MEME population que le denominateur juste au-dessus — un numerateur strictement
  // inclus dans son denominateur, ce qui etait deja l'intention de la garde d'origine.
  const hookReplies = leadsInPeriod.filter(l => l.hookReplied && l.igUserId && personnesAvecLm.has(l.igUserId)).length;
  const tauxHookReply = lmEnvoyes > 0 ? Math.round((hookReplies / lmEnvoyes) * 100) : 0;
  // Liens Calendly envoyés DM — source de vérité : DB uniquement
  const calendlyLinksSent = prospectLinksDb.filter(l => {
    if (!wasCalendlyLinkSent(l, linkClickedByLeadId)) return false;
    return isInPeriod(calendlySentAt(l, linkClickedByLeadId));
  });
  const lmCalendlyLinks = calendlyLinksSent.length;
  const calendlyActivatedDb = calendlyLinksSent.filter(l => l.first_click_at != null).length;
  // calls filtrés par la fenêtre de période (en S-0, callsEff n'a pas de borne haute)
  const callsInWindow = (calls ?? []).filter(c => dansFenetreResa(c));
  // Le JUMEAU de `callsInWindow` pour l'argent : mêmes rendez-vous, autre fenêtre.
  // `callsInWindow` retient ceux RÉSERVÉS dans la période, celui-ci ceux dont la VENTE
  // y tombe. Les deux se recouvrent presque toujours ; ils divergent pour un rendez-vous
  // réservé en fin de période et tenu dans la suivante.
  //
  // ⚠️ Les catégories du breakdown par source forment une PARTITION : chaque ligne, et
  // « Autre » qui est leur complément, doivent se calculer sur la MÊME population. Un
  // euro compté sur une population et retranché d'une autre serait compté deux fois, ou
  // perdu. Chaque catégorie a donc ici son jumeau, jusqu'à « Autre ».
  const callsVenteInWindow = tousLesCallsB.filter(venteDansLaPeriodeB);
  // OPPORTUNITES, comme le breakdown juste en dessous. Cette carte affichait 18 face a
  // un tableau qui affichait 17, dans le meme onglet et a trois centimetres d'ecart.
  const callsBooked = callsInWindow.filter(c => c.status === 'active' && !continuationsContenu.has(c.id)).length;
  const callsTotal = callsBooked;

  // ── Séries jour-par-jour pour les KPI cliquables ──
  // Génère chaque date UTC de periodStart à periodEnd inclus, pour combler les jours
  // sans donnée à 0 (sinon Recharts trace un point isolé au lieu d'une ligne continue).
  // Tous les jours de la période restent sur l'axe (même les jours futurs d'une
  // semaine/mois en cours) — c'est chaque SÉRIE (v: null au lieu de 0) qui décide où
  // la ligne s'arrête visuellement, pas l'axe lui-même.
  //
  // ⚠️ En All-Time, periodStart/periodEnd valent le MOIS EN COURS : ils viennent de
  // getPeriodWindow(_pIdx, 'month'), qui ignore sinceConnection. L'axe affichait donc
  // « 1 août → 29 août » sous un en-tête « All-Time depuis le 09/06 » et sous un KPI
  // « 150 clics », alors que la courbe n'en totalisait que 23. Constaté à l'écran le
  // 2026-08-28. La fenêtre du graphique doit être celle du FETCH, pas celle du mois.
  const chartStart = sinceConnection && allTimeStart ? new Date(allTimeStart) : periodStart;
  const chartEnd = sinceConnection ? new Date() : periodEnd;
  const dayRange: string[] = (() => {
    const days: string[] = [];
    let d = chartStart;
    const finStr = utcDateStr(chartEnd);
    while (utcDateStr(d) <= finStr) {
      days.push(utcDateStr(d));
      d = parisAddDays(d, 1);
    }
    return days;
  })();
  // Un point par jour est lisible sur une semaine ou un mois. Sur toute l'histoire
  // d'un élève, c'est 400 points la première année : on regroupe par semaine puis par
  // mois au-delà des seuils de lib/chart-buckets.ts. Les séries de TAUX passent par
  // regrouperTaux (somme des numérateurs / somme des dénominateurs) — faire la moyenne
  // des pourcentages journaliers donnerait un chiffre faux.
  const granularite: Granularite = granulariteFenetre(dayRange.length);
  const parJour = granularite === 'jour';
  const fmtAxisBucket = (v: string) => libelleBucket(v, granularite);
  const todayUTCStr = utcDateStr(new Date());
  const isFutureDay = (date: string) => date > todayUTCStr;
  // Jour antérieur à l'arrivée de l'élève : même traitement qu'un jour futur — un trou,
  // pas un zéro. Un zéro affirme « il ne s'est rien passé » alors que la vérité est
  // « l'élève n'était pas encore là ». Les 4 élèves en base sont arrivés en milieu de
  // mois (le 9, 28, 13, 16) : pour celui du 28 juillet, le graphique de juillet
  // montrait 13 jours plats qui se lisaient comme une mauvaise performance.
  const arrivalDayStr = integrationsReadyAt ? utcDateStr(new Date(integrationsReadyAt)) : null;
  const isBeforeArrival = (date: string) => arrivalDayStr != null && date < arrivalDayStr;
  const isOutsideCoverage = (date: string) => isFutureDay(date) || isBeforeArrival(date);
  // Couverture propre aux séries de CLICS : en plus des deux règles ci-dessus, une
  // journée où la collecte Short.io n'a pas tourné est un trou, pas un zéro.
  //
  // Cas réel mesuré le 2026-08-28 sur le profil dc6f6aec : les 18 et 20 août n'ont
  // AUCUNE ligne en base (panne de collecte), et la courbe affichait pourtant un point
  // à 0 — indiscernable du 16 août, où la collecte a bien tourné et où personne n'a
  // cliqué. « Un 0 affirme quelque chose, un trou dit on ne sait pas. »
  //
  // Ne s'applique qu'aux clics : les leads, les réponses et les calls viennent
  // d'Instagram et de Calendly, et ne dépendent pas de la collecte Short.io.
  //
  // Repli : si la liste des jours collectés n'est pas connue (donnée pas encore
  // chargée), on ne transforme rien en trou — mieux vaut l'ancien comportement qu'un
  // graphique entièrement vide.
  const collecteConnue = (joursCollectesShortio?.size ?? 0) > 0;
  const isClicHorsCouverture = (date: string) =>
    isOutsideCoverage(date) || (collecteConnue && !joursCollectesShortio!.has(date));

  // 1. Clics totaux — déjà par jour dans shortioChartHistory, filtrer sur la fenêtre
  // Index par date : `.find()` dans un `.map()` était quadratique — inoffensif sur 31
  // points, mais l'All-Time en produit 400 la première année et 800 la deuxième.
  const clicsParJour = new Map<string, number>();
  for (const d of shortioChartHistory ?? []) clicsParJour.set(d.date, (clicsParJour.get(d.date) ?? 0) + d.clicks);
  const clicsSeries = regrouperComptage(dayRange, granularite,
    date => isClicHorsCouverture(date) ? null : (clicsParJour.get(date) ?? 0));
  const clicsSeriesHasData = (shortioChartHistory ?? []).length > 0;

  // 2. Leads commentaires — group by detected_at (jour) sur lmHistoryInPeriod (une ligne
  // par vraie interaction datée, jamais écrasée — pas leadsInPeriod qui ne compte qu'une
  // fois par personne avec la date de sa DERNIÈRE interaction).
  // La carte compte des PERSONNES (`lmEnvoyes`), la courbe comptait des INTERACTIONS :
  // un prospect qui recommente quatre fois le meme mot-cle en une heure ajoutait quatre
  // points. Deux unites sous le meme titre, et une courbe qui ne pouvait pas totaliser
  // la carte. Chaque personne compte desormais UNE fois, le jour de sa premiere
  // interaction de la periode.
  const leadsPerDay = new Map<string, number>();
  const premierJourParPersonne = new Map<string, string>();
  for (const h of lmHistoryInPeriod) {
    if (h.lead_magnet_sent === false || !h.ig_user_id) continue;
    const day = utcDateStr(new Date(h.detected_at));
    const deja = premierJourParPersonne.get(h.ig_user_id);
    if (!deja || day < deja) premierJourParPersonne.set(h.ig_user_id, day);
  }
  for (const day of premierJourParPersonne.values()) {
    leadsPerDay.set(day, (leadsPerDay.get(day) ?? 0) + 1);
  }
  const leadsSeries = regrouperComptage(dayRange, granularite, date => isOutsideCoverage(date) ? null : (leadsPerDay.get(date) ?? 0));

  // 3. Réponses accroche LM DM — vrai timestamp hook_replied_at (ajouté au select ci-dessus)
  const hookRepliesPerDay = new Map<string, number>();
  for (const l of leadsInPeriod) {
    // `leadMagnetSent` : MEME population que la carte. Sans lui la courbe tracait aussi
    // les reponses de cold DM — des gens a qui aucun lead magnet n'a ete envoye — et
    // affichait 3 la ou la carte affichait 2. Le titre dit « LM DM ».
    // MEME population que la carte : `personnesAvecLm`, defini depuis le journal.
    if (!l.hookReplied || !l.hookRepliedAt || !l.igUserId || !personnesAvecLm.has(l.igUserId)) continue;
    if (!isInPeriod(l.hookRepliedAt)) continue;
    const day = utcDateStr(new Date(l.hookRepliedAt));
    hookRepliesPerDay.set(day, (hookRepliesPerDay.get(day) ?? 0) + 1);
  }
  const hookReplySeries = regrouperComptage(dayRange, granularite, date => isOutsideCoverage(date) ? null : (hookRepliesPerDay.get(date) ?? 0));

  // 4. Liens Calendly envoyés DM — calendly_link_sent_at ?? created_at, sur calendlyLinksSent (déjà filtré période)
  const calendlyLinksPerDay = new Map<string, number>();
  for (const l of calendlyLinksSent) {
    // MEME date que le filtre qui alimente `calendlyLinksSent`. Les deux divergent des
    // que l'echo Meta manque, et un lien compte dans la carte tombait hors du graphique.
    const ts = calendlySentAt(l, linkClickedByLeadId);
    if (!ts) continue;
    const day = utcDateStr(new Date(ts));
    calendlyLinksPerDay.set(day, (calendlyLinksPerDay.get(day) ?? 0) + 1);
  }
  const calendlyLinksSeries = regrouperComptage(dayRange, granularite, date => isOutsideCoverage(date) ? null : (calendlyLinksPerDay.get(date) ?? 0));

  // 5. Taux d'activation DM — deux ratios par jour, comme la KPI card (LM et Calendly) :
  // LM = clics lead magnet / LM envoyés (jour = commentedAt), Calendly = clics lien
  // Calendly / liens Calendly envoyés (jour = calendly_link_sent_at ?? created_at).
  // 0% (pas de trou) pour les jours sans envoi — priorité à la lisibilité d'une ligne
  // continue plutôt qu'à des points isolés difficiles à lire sur 30 jours.
  const lmEnvoyesPerDay = new Map<string, number>();
  const lmClicsPerDay = new Map<string, number>();
  for (const l of leadsInPeriod) {
    if (!l.leadMagnetSent) continue;
    const day = utcDateStr(new Date(l.commentedAt));
    lmEnvoyesPerDay.set(day, (lmEnvoyesPerDay.get(day) ?? 0) + 1);
    if (l.id && lmClickedByLeadId?.has(l.id)) lmClicsPerDay.set(day, (lmClicsPerDay.get(day) ?? 0) + 1);
  }
  const activationLmSeries = regrouperTaux(dayRange, granularite, date => isOutsideCoverage(date)
    ? null
    : { num: lmClicsPerDay.get(date) ?? 0, den: lmEnvoyesPerDay.get(date) ?? 0 });

  const calendlyClicsPerDay = new Map<string, number>();
  for (const l of calendlyLinksSent) {
    if (!l.first_click_at) continue;
    // MEME date que le denominateur : sinon un clic et son envoi tombent dans deux
    // colonnes differentes, et le taux est faux des deux cotes.
    const tsClic = calendlySentAt(l, linkClickedByLeadId);
    if (!tsClic) continue;
    const day = utcDateStr(new Date(tsClic));
    calendlyClicsPerDay.set(day, (calendlyClicsPerDay.get(day) ?? 0) + 1);
  }
  const activationCalendlySeries = regrouperTaux(dayRange, granularite, date => isOutsideCoverage(date)
    ? null
    : { num: calendlyClicsPerDay.get(date) ?? 0, den: calendlyLinksPerDay.get(date) ?? 0 });
  // Les deux séries partagent la même liste de buckets (même dayRange, même
  // granularité) : l'index est donc aligné par construction.
  const activationSeries = activationLmSeries.map((p, i) => ({
    date: p.date,
    lm: p.v,
    calendly: activationCalendlySeries[i]?.v ?? null,
  }));

  // 6. Calls bookés — groupés par jour sur la date de RÉSERVATION, la même que
  // celle qui délimite callsInWindow. Grouper sur scheduled_at alors que la fenêtre
  // filtre sur booked_at ferait sortir du graphique un call pourtant compté.
  const callsPerDay = new Map<string, { booked: number; honored: number; closed: number; revenue: number }>();
  const jourDeLaCourbe = (jour: string) => {
    const cur = callsPerDay.get(jour) ?? { booked: 0, honored: 0, closed: 0, revenue: 0 };
    callsPerDay.set(jour, cur);
    return cur;
  };
  for (const c of callsInWindow) {
    const cur = jourDeLaCourbe(utcDateStr(new Date(callPeriodDate(c))));
    // Meme grain que la carte : des opportunites. `closed` garde tous les calls — un
    // deal se compte la ou il a ete signe, meme au 2e rendez-vous.
    if (c.status === 'active' && !continuationsContenu.has(c.id)) {
      cur.booked += 1;
      if (isCallHonored(c, now)) cur.honored += 1;
    }
    if (c.deal_closed) cur.closed += 1;
  }
  // L'argent se pose sur le jour de la VENTE, pas de la reservation — et il part donc
  // de son propre jeu. Le poser sur `callPeriodDate` placait un revenu AVANT le
  // rendez-vous qui l'a produit, et un rendez-vous reserve en fin de periode pour la
  // suivante n'avait aucun jour ou tomber.
  for (const c of callsVenteInWindow) {
    const d = dateVenteDuCallB(c);
    if (!d) continue;
    jourDeLaCourbe(utcDateStr(new Date(d))).revenue += montantParCallB.get(c.id) ?? 0;
  }
  // null (trou) hors couverture, comme les autres séries : avant l'arrivée de l'élève
  // ou après aujourd'hui, un 0 se lirait comme « aucun call » au lieu de « pas de
  // donnée ».
  const callsChamp = (champ: 'booked' | 'honored' | 'closed' | 'revenue') =>
    regrouperComptage(dayRange, granularite, date => isOutsideCoverage(date) ? null : (callsPerDay.get(date)?.[champ] ?? 0));
  const callsBookedB = callsChamp('booked');
  const callsHonoredB = callsChamp('honored');
  const callsClosedB = callsChamp('closed');
  const callsRevenueB = callsChamp('revenue');
  const callsSeries = callsBookedB.map((p, i) => ({
    date: p.date,
    booked: p.v,
    honored: callsHonoredB[i]?.v ?? null,
    closed: callsClosedB[i]?.v ?? null,
    revenue: callsRevenueB[i]?.v ?? null,
  }));

  // ── Graphique filtré — sur la vraie période sélectionnée (dayRange), pas une fenêtre
  // glissante fixe de 30 jours indépendante de periodStart/periodEnd. Avant ce fix,
  // ces 3 filtres lisaient shortio.chartData (30 points figés sur "maintenant"),
  // affichant toujours les 30 derniers jours quelle que soit la période sélectionnée,
  // et "Historique non disponible" dès periodIndex > 0 (shortioChartHistoryBio/
  // Content/Dm — voir fetchSupabaseStats/fetchSnapshot — couvrent maintenant aussi
  // l'historique). Source : mêmes tables shortio_link_daily_snapshots par catégorie
  // que shortioChartHistory (total), déjà filtrées sur periodStart/periodEnd.
  // Index par date puis regroupement, comme clicsSeries : `.find()` dans un `.map()`
  // coûtait O(jours x lignes), invisible sur un mois, sensible sur l'All-Time.
  const indexerParDate = <T extends { date: string }>(rows: T[] | undefined) => {
    const m = new Map<string, T>();
    for (const r of rows ?? []) m.set(r.date, r);
    return m;
  };
  const bioParJour = indexerParDate(shortioChartHistoryBio);
  const contentParJour = indexerParDate(shortioChartHistoryContent);
  const dmParJour = indexerParDate(shortioChartHistoryDm);
  const serieDouble = <A extends string, B extends string>(
    index: Map<string, any>, cleA: A, cleB: B,
  ): ({ date: string } & Record<A | B, number | null>)[] => {
    const a = regrouperComptage(dayRange, granularite, date => isClicHorsCouverture(date) ? null : (index.get(date)?.[cleA] ?? 0));
    const b = regrouperComptage(dayRange, granularite, date => isClicHorsCouverture(date) ? null : (index.get(date)?.[cleB] ?? 0));
    return a.map((p, i) => ({ date: p.date, [cleA]: p.v, [cleB]: b[i]?.v ?? null } as any));
  };
  const chartDataBio = serieDouble(bioParJour, 'ig', 'yt');
  const chartDataContent = serieDouble(contentParJour, 'ig', 'yt');
  const chartDataDm = serieDouble(dmParJour, 'calendly', 'lm');
  const storyParJour = indexerParDate(shortioChartHistoryStory);
  const chartDataStory = regrouperComptage(dayRange, granularite,
    date => isClicHorsCouverture(date) ? null : (storyParJour.get(date)?.story ?? 0));
  const chartDataHasHistory = chartFilter === 'bio' ? (shortioChartHistoryBio?.length ?? 0) > 0
    : chartFilter === 'content' ? (shortioChartHistoryContent?.length ?? 0) > 0
    : chartFilter === 'dm' ? (shortioChartHistoryDm?.length ?? 0) > 0
    : chartFilter === 'story' ? (shortioChartHistoryStory?.length ?? 0) > 0
    : false;

  // ── Section 2 : tableau consolidé par contenu — tous les posts, pas seulement ceux avec business ──
  const knownIgIds = new Set(igPosts.map(p => p.id));
  const knownYtIds = new Set(ytVideos.map(v => v.id));
  // Identifiants de stories APPARTENANT a une sequence : elles ont deja leur ligne
  // dediee, il ne faut pas qu'elles en creent une seconde en tant que faux post.
  const storiesDeSequence = new Set(
    allStoriesForContent.filter(st => st.sequence_id && st.ig_story_id).map(st => String(st.ig_story_id)),
  );

  const allPostIds = Array.from(new Set([
    ...igPosts.map(p => p.id + '|IG'),
    ...ytVideos.map(v => v.id + '|YT'),
    ...postLinks
      .filter((l: any) => {
        if (!l.postPlatform || !isValidPostId(l.postId, l.postPlatform)) return false;
        // Exclure les liens d'anciens comptes : le post doit être connu dans le compte actif
        return l.postPlatform === 'IG' ? knownIgIds.has(l.postId) : knownYtIds.has(l.postId);
      })
      .map((l: any) => l.postId + '|' + l.postPlatform),
    ...prospectLinks
      .filter((l: any) => {
        if (!isValidPostId(l.postId) || ['bio-ig', 'bio-yt'].includes(l.postId)) return false;
        // MEME garde que la branche `postLinks` juste au-dessus : le contenu doit etre
        // connu dans le compte actif. Elle manquait ici, et l'asymetrie se voyait a
        // l'ecran.
        //
        // `prospectLinks` vient de Short.io, et un domaine Short.io peut etre PARTAGE
        // entre plusieurs eleves — trois sur ubizenai.s.gy au 2026-08-30. Les liens des
        // autres entraient donc dans cette liste avec des identifiants de posts qui
        // n'existent pas ici : deux lignes « (sans titre) », IG · Reel, sans vignette,
        // sans permalien et sans un seul chiffre, en bas de « Voir tout ».
        //
        // Ce n'est pas une donnee manquante : c'est le contenu de quelqu'un d'autre.
        return isValidYtVideoId(l.postId) ? knownYtIds.has(l.postId) : knownIgIds.has(l.postId);
      })
      .map((l: any) => l.postId + '|' + (l.postPlatform || (isValidYtVideoId(l.postId) ? 'YT' : 'IG'))),
    // Basé sur lmHistory (media_id figé par interaction), pas leads.postId (état courant du
    // lead, écrasé par sa DERNIÈRE interaction) — sinon un post/story ancien qui n'a plus
    // que des leads "périmés" par une interaction plus récente ailleurs disparaît du tableau.
    ...(lmHistory ?? []).filter(h => {
      if (!h.lead_magnet_sent || !isValidPostId(h.media_id, isValidYtVideoId(h.media_id) ? 'YT' : 'IG')) return false;
      // Une STORY de sequence n'est pas un post, et elle a deja sa propre ligne
      // (storySequenceContentRows). Sans cette exclusion elle apparaissait EN PLUS
      // comme un Reel fantome : « (sans titre) », aucune vignette, aucune vue, tous
      // les chiffres a un tiret — parce qu'aucun snapshot de POST n'existe pour un
      // identifiant de story. Constate le 2026-08-30 sur le profil de test, deux
      // lignes vides en bas de « Voir tout », dont 18070859744433801 (mot-cle
      // STORYTEST), story de sequence confirmee en base.
      //
      // Les stories ORPHELINES, elles, restent : la ligne plus bas les reconnait et
      // leur donne leur vignette et le type « Story ».
      if (h.media_id && storiesDeSequence.has(h.media_id)) return false;
      return isInPeriod(h.detected_at);
    }).map(h => h.media_id + '|' + (isValidYtVideoId(h.media_id) ? 'YT' : 'IG')),
  ]));

  // Map keyword (lowercase) → nom du LM pour affichage dans Performance par contenu
  const lmNameByKeyword = new Map<string, string>();
  const lmById = new Map<string, string>(); // lm.id → lm.name
  for (const lm of leadMagnets) {
    if (lm.keyword) lmNameByKeyword.set(lm.keyword.toLowerCase(), lm.name);
    lmById.set(lm.id, lm.name);
  }
  // Enrichir avec les keywords alternatifs (définis par contenu dans content_links)
  for (const [altKw, lmId] of (altKwToLmId ?? new Map())) {
    const lmName = lmById.get(lmId);
    if (lmName && !lmNameByKeyword.has(altKw)) lmNameByKeyword.set(altKw, lmName);
  }

  const rawConsolidatedRows = allPostIds.map(key => {
    const [postId, platform] = key.split('|');
    const descLink = postLinks.find((l: any) => l.postId === postId);
    // dmProspects : source fiable prospectLinksData (jamais tronqué côté serveur par période, contrairement
    // à shortio.links/prospectLinks qui vient de /api/shortio/snapshots — tronqué sur startDate/endDate en
    // S-1+ et peut louper des liens). Même pattern déjà validé pour Performance LM (supaProspects, ligne 4273).
    const dmProspects = (prospectLinksData ?? []).filter((pl: any) => {
      if (pl.post_id !== postId) return false;
      if (!wasCalendlyLinkSent(pl, linkClickedByLeadId)) return false;
      const ts = calendlySentAt(pl, linkClickedByLeadId);
      return ts ? isInPeriod(ts) : false;
    });
    const postLeads = leads.filter(lead => lead.postId === postId);
    const igPost = platform === 'IG' ? igPosts.find(p => p.id === postId) : null;
    const ytVideo = platform === 'YT' ? ytVideos.find(v => v.id === postId) : null;
    // Story orpheline avec CTA (LM ou Calendly) mais SANS séquence — les stories en
    // séquence sont déjà gérées séparément (storySequenceContentRows, thumbnail=1ère
    // story du groupe) ; ne matcher ici que le cas story isolée pour éviter le doublon.
    const storyMatch = platform === 'IG' && !igPost
      ? allStoriesForContent.find(s => s.ig_story_id === postId && !s.sequence_id && (s.lm_keyword || s.calendly_short_url))
      : null;
    const title = igPost?.caption || ytVideo?.title || (storyMatch ? 'Story' : '(sans titre)');
    const thumbnail = igPost?.thumbnail || ytVideo?.thumbnail || storyMatch?.storage_url || null;
    const type = igPost ? (igPost.type === 'VIDEO' || igPost.type === 'REEL' || igPost.type === 'REELS' ? 'Reel' : igPost.type === 'CAROUSEL_ALBUM' ? 'Carousel' : 'Image') : (ytVideo ? (ytVideo.isShort ? 'Short' : 'Vidéo') : storyMatch ? 'Story' : platform === 'IG' ? 'Reel' : 'Vidéo');
    const views = igPost?.views || ytVideo?.views30d || storyMatch?.views || 0;
    // Vues lifetime pour Cash/Vue — UNIQUEMENT igLive/ytLive, jamais ig/yt ou igPost/ytVideo (qui
    // varient avec periodIndex). Si le post n'est plus dans la fenêtre de fetch live, on ne connaît
    // pas sa valeur actuelle : null (affiché "—"), jamais une valeur bancale qui changerait selon
    // la période sélectionnée.
    const viewsLifetimeRaw = platform === 'IG' ? igLiveViewsById.get(postId) : ytLiveViewsById.get(postId);
    const viewsLifetime = viewsLifetimeRaw ?? null;
    // Nom du LM associé aux leads de ce contenu (premier keyword trouvé)
    // Mot-cle du contenu : depuis le JOURNAL, pas depuis la fiche.
    // `postLeads[0]?.keyword` lisait `instagram_leads.keyword_matched`, ecrase a chaque
    // nouvelle interaction de la meme personne comme media_id et lead_magnet_sent avant
    // lui. Un contenu pouvait donc afficher le mot-cle d'un AUTRE contenu.
    // Le journal garde une ligne par interaction : on prend la plus recente de ce
    // contenu, avec repli sur la fiche pour les contenus anterieurs au journal.
    const lmKeyword = (() => {
      let meilleur: { ms: number; kw: string } | null = null;
      for (const h of lmHistoryInPeriod) {
        if (h.media_id !== postId || !h.keyword_matched) continue;
        const ms = Date.parse(h.detected_at);
        if (!Number.isFinite(ms)) continue;
        if (!meilleur || ms > meilleur.ms) meilleur = { ms, kw: h.keyword_matched };
      }
      return meilleur?.kw ?? postLeads[0]?.keyword ?? null;
    })();
    const lmName = lmKeyword ? (lmNameByKeyword.get(lmKeyword.toLowerCase()) ?? lmKeyword) : null;

    const clicsDesc = linkClics(descLink) || 0;
    const postLeadsInPeriod = postLeads.filter(l => isInPeriod(l.commentedAt));
    // ACQUISITION : depuis le journal, dedupliquee par personne. Un prospect qui
    // recommente quatre fois le meme mot-cle en une heure — cas reel de rdjdkzjd sur
    // GUIDE le 05/07 — ne compte qu'une entree.
    const lmDetectes = acquisitionParContenuGlobal.get(postId) ?? 0;
    const lmSent = postLeadsInPeriod.filter((l: MockLead) => l.leadMagnetSent).length;
    // Clics LM : depuis le JOURNAL, comme les deux colonnes voisines.
    //
    // Cette ligne lisait `postLeads`, filtre sur `lead.postId` — c'est-a-dire
    // `instagram_leads.media_id`, ecrase par le dernier post commente. Pour un contenu
    // dont les leads ont ensuite commente ailleurs, cette liste est VIDE : le post
    // GUIDE du profil de test affichait donc 0 clic alors que rdjdkzjd avait bien pris
    // son lead magnet. Dernier des cinq usages de champs mutables de cette fiche.
    const lmClics = [...(personnesParContenuLm.get(postId) ?? [])]
      .filter(igUserId => {
        const idFiche = idFicheParPersonne.get(igUserId);
        return !!idFiche && !!lmClickedByLeadId?.has(idFiche);
      }).length;
    // `postLeadsInPeriod` et non `postLeads` : cette colonne était la SEULE de la
    // ligne à ignorer la période. Un vieux contenu la gonflait quelle que soit la
    // fenêtre affichée, et elle pouvait donc dépasser « Commentaires LM » juste
    // au-dessus — plus de conversations que de commentaires, ce qui est
    // impossible et donnait un taux de réponse supérieur à 100 %.
    // ACTIVATION : depuis le journal des reponses, pas depuis le drapeau de la fiche.
    // Ce drapeau est remis a `false` par une reponse de story ou un Cold DM, donc une
    // conversation deja eue disparaissait. Mesure du 2026-08-29 : 6 reponses
    // journalisees contre 4 au maximum a l'ecran, et incogniton.734 en avait 3 a lui
    // seul. Ce nombre PEUT depasser « Commentaires LM » : un contenu qui reactive
    // beaucoup et acquiert peu est bon en relance, c'est le signal recherche.
    const lmReponses = activationParContenuGlobal.get(postId) ?? 0;
    const dmCount = dmProspects.length;
    // Calls bookés/closés/revenue depuis la table calls (source de vérité)
    // postCalls = calls rattachés à ce contenu (DM + description), filtrés sur la période sélectionnée (scheduled_at)
    // postCallsDesc = uniquement via lien description (utm_medium = 'description') — pour breakdown par source
    // Attribution de CONVERSION : `utm_content`, sinon le contenu du LIEN PROSPECT.
    //
    // Le repli precedent lisait `leadIdToMediaId`, c'est-a-dire `instagram_leads.media_id`.
    // Ce champ est ECRASE a chaque nouveau commentaire de la meme personne : la table
    // porte une seule ligne par personne et par eleve (`unique (profile_id, ig_user_id)`)
    // et l'upsert de `lib/ig-fetch.ts` y remet le dernier post commente. Mesure du
    // 2026-08-29 : le post GUIDE affichait 1 call et 500 EUR avec 0 commentaire et
    // 0 conversation, parce qu'un commentaire posterieur sur un autre post l'avait
    // efface de la fiche. Un contenu se faisait donc voler ses calls.
    //
    // `prospect_links.content_id` remplace ce repli : il est pose a la creation du lien
    // et jamais reecrit, et il decrit le contenu d'ou vient CE lien-la. Verifie sur
    // l'unique call concerne (`af9d5898`, 15/08) : son lien datait du 7 juin, avant le
    // correctif qui a impose `utm_content`, et son contenu etait toujours la.
    //
    // Apres ce repli, l'absence de contenu ne concerne plus que les liens de BIO, qui
    // n'en ont aucun par nature — un trou legitime, jamais un zero.
    //
    // La regle vit dans `lib/attribution-roles.ts`, testee sur fixtures reelles.
    const matchesContent = (c: CallRecord) =>
      contenuConversion({
        utm_content: c.utm_content,
        prospect_link_content_id: c.prospect_link_id ? contenuDuLienProspect.get(c.prospect_link_id) ?? null : null,
        utm_medium: c.utm_medium,
        source: c.source,
        booked_at: c.booked_at,
        scheduled_at: c.scheduled_at,
      }, (c.ig_lead_id && journalParFiche.get(c.ig_lead_id)) || []) === postId;
    const postCalls = (calls && leadIdToMediaId)
      ? calls.filter(c => matchesContent(c) && isInPeriod(callPeriodDate(c)))
      : [];
    // Calls lifetime (depuis publication du contenu) — pour Cash/Vue et % qualifié, indépendant du filtre
    // de période. Source = callsAllTime (jamais coupé par periodIndex), PAS calls (= callsEff, qui EST
    // filtré sur la fenêtre de la période affichée dès que periodIndex > 0 — cf. callsHist/fetchSnapshot).
    const postCallsLifetime = (callsAllTime && leadIdToMediaId) ? callsAllTime.filter(matchesContent) : [];
    const viaDescription = (c: CallRecord) => c.utm_medium === 'description' || (!c.ig_lead_id && c.utm_content === postId);
    const postCallsDesc = postCalls.filter(viaDescription);
    // Le jumeau pour l'ARGENT : memes contenus, fenetre de la vente et non de la
    // reservation. `postCalls` est borne sur la reservation, donc filtrer DEDANS ne
    // pourrait jamais ramener une vente de septembre reservee en aout.
    const postCallsVente = (calls && leadIdToMediaId) ? callsVenteInWindow.filter(matchesContent) : [];
    const postCallsDescVente = postCallsVente.filter(viaDescription);
    // Un 2e rendez-vous herite du utm_content de son parent (commit 7da4b53) : sans
    // cette exclusion, un contenu se verrait crediter DEUX calls pour un seul
    // prospect — le double comptage que l'heritage devait justement eviter.
    // `closed` et `revenue` gardent l'autre grain : un deal se compte la ou il a
    // ete signe, meme si c'est au 2e rendez-vous.
    const postOpportunites = postCalls.filter(c => !continuationsContenu.has(c.id));
    const callsBooked = postOpportunites.filter(c => c.status === 'active').length;
    const callsHonored = postOpportunites.filter(c => isCallHonored(c, now)).length;
    const closed = postCalls.filter(c => c.deal_closed).length;
    const revenue = cashDeLot(postCallsVente);
    // Meme exclusion que `postOpportunites` juste au-dessus. Sans elle, le post 9699
    // affichait 2 dans le breakdown par source et 1 dans Performance par contenu, sous
    // le meme libelle « calls bookes » : `postCallsDesc` etait le seul compteur de la
    // page a ne pas retirer les continuations.
    const postOpportunitesDesc = postCallsDesc.filter(c => !continuationsContenu.has(c.id));
    const callsBookedDesc = postOpportunitesDesc.filter(c => c.status === 'active').length;
    const callsHonoredDesc = postOpportunitesDesc.filter(c => isCallHonored(c, now)).length;
    const closedDesc = postCallsDesc.filter(c => c.deal_closed).length;
    const revenueDesc = cashDeLot(postCallsDescVente);
    // « via lead magnet » se lit sur la source, pas sur le rattachement — même
    // correction que le tunnel de l'accueil (commit 4a7a792).
    const postCallsLm = postCalls.filter(c => c.source === 'ig_dm');
    const postOpportunitesLm = postCallsLm.filter(c => !continuationsContenu.has(c.id));
    const callsBookedLm = postOpportunitesLm.filter(c => c.status === 'active').length;
    const callsHonoredLm = postOpportunitesLm.filter(c => isCallHonored(c, now)).length;
    const closedLm = postCallsLm.filter(c => c.deal_closed).length;
    const revenueLm = cashDeLot(postCallsVente.filter(c => c.source === 'ig_dm'));
    // ── Les deux ratios sont en ALL-TIME, des deux côtés ────────────────────────
    //
    // Les vues d'un contenu sont CUMULATIVES : un post de juin en gagne encore en
    // septembre. Les diviser par les rendez-vous d'une fenêtre compare un cumul à un
    // flux — le résultat change quand on change de période sans qu'aucune des deux
    // grandeurs n'appartienne vraiment à cette période.
    //
    // C'était pire que ça, et différemment selon la plateforme : `views` valait le
    // cumul du post à la fin de la période côté Instagram, mais les 30 DERNIERS JOURS
    // côté YouTube (`views30d`), fixes quelle que soit la période affichée. Sur une
    // semaine, YouTube divisait donc 30 jours de vues par 7 jours de rendez-vous. Deux
    // incohérences différentes sous un même libellé — le genre d'écart qui ne produit
    // jamais de nombre absurde, seulement un nombre plausible et faux.
    //
    // Les deux colonnes répondent désormais à la même question : ce que ce contenu a
    // produit depuis sa publication. Elles ne bougent donc PAS avec le sélecteur de
    // période, et leur en-tête le dit — une colonne qui ignore le sélecteur doit
    // l'annoncer, sinon elle se lit comme les autres.
    //
    // Même grain d'OPPORTUNITÉS que le reste du tableau : un 2ᵉ rendez-vous n'est
    // produit par aucune nouvelle vue.
    const postOpportunitesLifetime = postCallsLifetime.filter(c => !continuationsContenu.has(c.id));
    const callsBookedLifetime = postOpportunitesLifetime.filter(c => c.status === 'active').length;
    const revenueLifetime = postCallsLifetime.reduce((s, c) => s + (montantParCallB.get(c.id) ?? 0), 0);
    const vuesParCall = viewsLifetime !== null && viewsLifetime > 0 && callsBookedLifetime > 0
      ? Math.round(viewsLifetime / callsBookedLifetime) : null;
    const cashParVue = viewsLifetime !== null && viewsLifetime > 0 ? revenueLifetime / viewsLifetime : null;

    // % Calls Qualifiés : parmi les calls honorés dont `qualified` est renseigné
    // (exclut les no-shows et les rapports où la question n'a pas été posée).
    //
    // ⚠️ `postCalls` et non `postCallsLifetime` : ce chiffre était calculé sur
    // TOUT l'historique alors que son jumeau du tableau Performance LM, portant
    // le même libellé juste en dessous, suivait la période affichée. Deux
    // tableaux voisins, deux sémantiques, aucun moyen de le deviner à l'écran.
    // Aligné sur la période — c'est ce que le reste de la ligne fait déjà.
    //
    // Cash/Vue reste all-time, lui, et son libellé le dit.
    const qualifiableCalls = postCalls.filter(c => isCallHonored(c, now) && c.qualified !== null && c.qualified !== undefined);
    const qualifiedCount = qualifiableCalls.filter(c => c.qualified === true).length;
    const qualifiedAnswered = qualifiableCalls.length;
    const qualifiedPct = qualifiedAnswered > 0 ? Math.round((qualifiedCount / qualifiedAnswered) * 100) : null;

    return { postId, platform, title, thumbnail, type, views, descLink, dmProspects, lmDetectes, lmSent, lmClics, lmReponses, dmCount, clicsDesc, callsBooked, callsHonored, closed, revenue, callsBookedDesc, callsHonoredDesc, closedDesc, revenueDesc, callsBookedLm, callsHonoredLm, closedLm, revenueLm, vuesParCall, cashParVue, qualifiedPct, qualifiedCount, qualifiedAnswered, lmName, lmKeyword, postCallsDesc, postCallsDescVente };
  });

  // Séquences stories — une ligne par séquence (pas par story individuelle), pivot
  // toujours story_sequence_id. Même format de ligne que les posts pour cohabiter
  // dans "Performance par contenu" ; les champs sans équivalent story (clics desc.,
  // qualifiedPct lifetime, cash/vue lifetime) restent à 0/null — non calculés côté
  // route funnel pour l'instant, non prioritaires (pas de "lien description" pour
  // une story, cf. décision produit).
  const storySequenceContentRows = storySequenceRows.map(seq => ({
    postId: seq.sequenceId,
    platform: 'STORY_SEQUENCE' as const,
    title: seq.name,
    thumbnail: seq.thumbnail,
    type: 'Séquence',
    views: seq.views,
    descLink: undefined,
    dmProspects: [],
    lmDetectes: seq.lmDetectes,
    lmSent: seq.lmSent,
    lmClics: 0,
    lmReponses: seq.lmReponses,
    dmCount: 0,
    clicsDesc: 0,
    callsBooked: seq.callsBooked,
    callsHonored: seq.callsHonored,
    closed: seq.closed,
    revenue: seq.revenue,
    callsBookedDesc: 0, callsHonoredDesc: 0, closedDesc: 0, revenueDesc: 0,
    callsBookedLm: seq.callsBookedLm ?? 0,
    callsHonoredLm: seq.callsHonoredLm ?? 0,
    closedLm: seq.closedLm ?? 0,
    revenueLm: seq.revenueLm ?? 0,
    // All-time des deux côtés, comme les posts et les vidéos — donc la colonne
    // « depuis publication » dit vrai aussi pour cette ligne.
    //
    // `story-sequences-stats` n'est PAS bornée à la période : elle ne filtre que sur
    // `integrations_ready_at`, exactement comme le reste de la plateforme. Ses vues sont
    // le cumul des instantanés de chaque story de la séquence, ses rendez-vous sont tous
    // ceux qu'elle a produits. J'avais affirmé le contraire sans avoir lu la route, et
    // retiré ce ratio à tort le 2026-09-02 ; il est rétabli.
    vuesParCall: seq.callsBooked > 0 && seq.views > 0 ? Math.round(seq.views / seq.callsBooked) : null,
    cashParVue: null,
    qualifiedPct: null, qualifiedCount: 0, qualifiedAnswered: 0,
    lmName: seq.lmKeyword ? `#${seq.lmKeyword}` : null,
    lmKeyword: seq.lmKeyword ?? null,
    postCallsDesc: [], postCallsDescVente: [],
  }));

  const consolidatedRows = [...rawConsolidatedRows, ...storySequenceContentRows]
    .sort((a, b) => b.views - a.views || b.revenue - a.revenue);

  // « Activité business » = au moins une colonne business non nulle. Sert au sous-titre
  // de la section, qui annonçait le nombre TOTAL de contenus sous le libellé « avec
  // activité business » — un post publié sans aucun lien ni lead y était compté.
  const aDeLActivite = (r: typeof consolidatedRows[number]) =>
    r.clicsDesc > 0 || r.lmDetectes > 0 || r.lmClics > 0 || r.lmReponses > 0 ||
    r.dmCount > 0 || r.callsBooked > 0 || r.callsHonored > 0 || r.closed > 0 || r.revenue > 0;

  // ── Section 3 : pipeline prospects ──
  const getProspectStatus = (l: any): ProspectStatus => {
    if (l.dealClosed === true) return 'closed';
    if (l.no_show) return 'noshow';
    if (l.callBooked) return 'booked';
    if ((l.clicsHumains || 0) > 0) return 'pending';
    return 'pending';
  };

  const statusColor: Record<string, string> = {
    closed: GREEN, booked: BLUE, pending: AMBER, noshow: RED,
  };

  // L'aide vit derrière un « ? » dépliable, pas en pied de tableau : une explication
  // permanente sous chaque section finit par ne plus être lue, et elle allonge un écran
  // déjà dense. Repliée par défaut, elle reste à un clic de l'endroit où la question se
  // pose.
  const SectionHead = ({ title, sub, action, aide, cleAide }: { title: string; sub?: string; action?: React.ReactNode; aide?: React.ReactNode; cleAide?: string }) => {
    const ouverte = !!cleAide && aideOuverte === cleAide;
    return (
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ fontSize: 14, fontWeight: 700 }}>{title}</span>
              {aide && cleAide && (
                <button
                  onClick={() => setAideOuverte(ouverte ? null : cleAide)}
                  aria-expanded={ouverte}
                  // L'infobulle annonce ce qu'il y a DERRIÈRE, pas la question qu'on se
                  // pose. « À quoi sert ce tableau ? » se lisait comme le contenu entier
                  // du panneau, alors que c'en était le titre : on croyait avoir tout lu
                  // en survolant, et on ne cliquait pas.
                  // L'infobulle dit d'abord QUOI FAIRE, ensuite ce qu'on y gagne.
                  //
                  // Elle annonçait seulement le contenu du panneau, et rien ne disait
                  // qu'il fallait cliquer : un « ? » qui se contente de décrire se lit
                  // comme une infobulle qui a déjà tout dit, et on ne clique jamais.
                  // Contrairement aux « ? » des colonnes, dont le survol montre déjà le
                  // texte entier, celui-ci ne révèle rien tant qu'on ne l'ouvre pas.
                  title={ouverte
                    ? 'Cliquez pour masquer les explications'
                    : 'Cliquez pour lire les explications en détail : ce que ce tableau compte, ce qu’il ne compte pas, et les pièges'}
                  style={{ width: 16, height: 16, borderRadius: '50%', flex: 'none', cursor: 'pointer', fontSize: 10, fontWeight: 700, lineHeight: 1, display: 'grid', placeItems: 'center', border: `1px solid ${ouverte ? BLUE : 'var(--muted)'}`, color: ouverte ? BLUE : 'var(--muted)', background: ouverte ? BLUE + '12' : 'transparent' }}>
                  ?
                </button>
              )}
            </div>
            {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>}
          </div>
          {action}
        </div>
        {ouverte && aide && (
          <div style={{ marginTop: 12, padding: '13px 15px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 9, fontSize: 11.5, color: 'var(--ink-2)', lineHeight: 1.6, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {aide}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="stack">

      {/* ── Section 0 : Stats globales ── */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px 22px' }}>
        <SectionHead title="Vue d'ensemble" sub="Tracking complet — tous liens confondus" />
        {(() => {
          // MEME population que le denominateur : `personnesAvecLm`, issue du JOURNAL.
          //
          // Ce numerateur partait de `leadsInPeriod` et du drapeau `l.leadMagnetSent`,
          // c'est-a-dire de la FICHE, pendant que son denominateur lisait le journal.
          // Deux sources pour un meme ratio, et la fiche perd des deux cotes :
          //
          //  • sa date `detected_at` ne suit pas les interactions suivantes — `rdjdkzjd`
          //    porte le 06/07 sur sa fiche alors que le journal l'a vu reprendre un lead
          //    magnet le 01/09. En septembre, le denominateur le comptait (1) et le
          //    numerateur ne le voyait meme pas : la carte affichait 0 %, c'est-a-dire
          //    « personne n'a clique », alors qu'il avait clique.
          //  • son drapeau `lead_magnet_sent` est ecrase — `incogniton.734` le porte a
          //    `false` alors que le journal montre ses envois. Il sortait du numerateur
          //    tout en restant au denominateur, ce qui sous-evaluait le taux.
          //
          // C'est exactement la correction deja faite sur `hookReplies` quelques lignes
          // plus haut (« MEME population que le denominateur »), qui n'avait pas ete
          // reportee ici. Le numerateur reste strictement inclus dans le denominateur,
          // donc le ratio ne peut pas depasser 100 % — la garde d'origine est preservee,
          // par construction cette fois plutot que par un filtre.
          // La regle, decidee par Chris le 2026-09-02 : parmi les personnes ayant recu un
          // lead magnet DANS LA PERIODE, combien ont clique AU MOINS UNE FOIS. Le « au
          // moins une fois » porte sur la personne, pas sur l'envoi : quelqu'un qui prend
          // trois lead magnets et en clique un compte pour une personne activee, pas pour
          // un tiers.
          //
          // ⚠️ Consequence assumee : le clic n'a pas a SUIVRE l'envoi de la periode.
          // `rdjdkzjd` a clique le 08/07 puis repris un lead magnet le 01/09 — il compte
          // comme active en septembre. La carte mesure donc « ces gens-la sont-ils du
          // genre a cliquer », pas « ce lead magnet-ci a-t-il ete clique ». Le second se
          // lit dans le Parcours des leads, colonne « Clics LM », par cohorte d'entree.
          //
          // Le commentaire d'origine annoncait « lm_clicked posterieur a detected_at ».
          // Cette regle n'a jamais ete implementee, et elle n'est pas celle qu'on veut :
          // c'est bien la version sans contrainte d'ordre qui est retenue.
          const lmClics = [...personnesAvecLm].filter(personne => {
            const fiche = idFicheParPersonne.get(personne);
            return !!fiche && !!lmClickedByLeadId?.has(fiche);
          }).length;
          const tauxLmClic = lmEnvoyes > 0 ? Math.round((lmClics / lmEnvoyes) * 100) : null;
          // calendlyActivatedDb (et non un recomptage par lead) : compte les first_click_at
          // PARMI calendlyLinksSent, donc exactement la population du dénominateur
          // lmCalendlyLinks. L'ancien calcul comptait les leads porteurs d'un événement
          // link_clicked, une population différente : un lead ayant cliqué alors que sa
          // ligne prospect_links n'était pas marquée calendly_link_sent comptait au
          // numérateur sans être au dénominateur — observé à 150 % (3 clics / 2 liens).
          const tauxCalendlyClic = lmCalendlyLinks > 0 ? Math.round((calendlyActivatedDb / lmCalendlyLinks) * 100) : null;
          // `null` et non `0` quand aucun lien n'a été envoyé : un « 0 % » en rouge
          // affirme « personne n'a cliqué », alors que la vérité est « il n'y avait
          // rien à cliquer ». Observé en août 2026 : 0 lien Calendly envoyé, et la
          // carte affichait quand même 0 % en rouge.
          const couleurTaux = (t: number | null) => t === null ? 'var(--faint)' : t >= 50 ? GREEN : t >= 25 ? AMBER : RED;
          const tauxActColor = couleurTaux(tauxCalendlyClic);
          const tauxLmColor = couleurTaux(tauxLmClic);

          // Hauteur réservée à DEUX lignes de libellé.
          //
          // Sans elle, « Clics totaux » (1 ligne) et « Liens Calendly envoyés DM »
          // (2 lignes) ne réservent pas la même place, et les six grands chiffres de la
          // rangée s'alignent sur deux hauteurs différentes — 15 px d'écart mesurés au
          // navigateur. La rangée se lit alors comme une ligne brisée.
          const libelleCarte: React.CSSProperties = {
            color: 'var(--muted)', marginBottom: 6,
            minHeight: 29, display: 'flex', alignItems: 'flex-start',
          };
          const cardStyle = (metric: NonNullable<typeof selectedMetric>) => ({
            background: selectedMetric === metric ? '#3a6a8610' : 'var(--surface-2)',
            border: selectedMetric === metric ? '1px solid var(--accent-brand)' : '1px solid transparent',
            borderRadius: 10, padding: '12px 14px', flex: 1, cursor: 'pointer', transition: 'all .12s',
            // Colonne flex : la légende de bas de carte est poussée en bas (marginTop
            // auto ci-dessous), donc les six légendes s'alignent même quand le bloc
            // central a une hauteur différente — la carte « Taux d'activation DM »
            // mesure 35 px là où les autres en font 24.
            display: 'flex', flexDirection: 'column',
          } as React.CSSProperties);
          const legendeCarte: React.CSSProperties = { fontSize: 10, color: 'var(--faint)', marginTop: 'auto', paddingTop: 4 };
          const blocKpi: React.CSSProperties = {
            display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 auto', minWidth: 0,
            border: '1px solid var(--border)', borderRadius: 12, padding: '10px 12px 12px',
            background: 'var(--surface)',
          };
          const titreBlocKpi: React.CSSProperties = { color: 'var(--muted)', letterSpacing: '.04em' };
          // `stretch` pour que les cartes du bloc gardent l'alignement de leurs legendes.
          const rangeeKpi: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'stretch', flex: 1 };
          const toggleMetric = (metric: typeof selectedMetric) => setSelectedMetric(metric);

          return (
            <div style={{ display: 'flex', gap: 14, marginBottom: 20, alignItems: 'stretch', flexWrap: 'wrap' }}>
              {/* DEUX BLOCS, pas une rangee de six.
                  A gauche ce que produit le compte, a droite comment le tunnel DM y
                  arrive. Alignes cote a cote, « Clics totaux » et « Leads
                  commentaires » se lisaient comme deux etapes qui s'enchainent alors
                  qu'ils ne sont pas sur le meme chemin : la majorite des clics ne
                  passe pas par un DM. Aucun chiffre ne change ici, seul le
                  regroupement. */}
              <div style={blocKpi}>
                <div className="eyebrow-sm" style={titreBlocKpi}>Global</div>
                <div style={rangeeKpi}>
                  {/* 1 — Clics totaux */}
                  <div onClick={() => toggleMetric('clics')} style={cardStyle('clics')}>
                  <div className="eyebrow-sm" style={libelleCarte}>Clics totaux</div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--ink)', lineHeight: 1 }}>{fmt(totalClics)}</div>
                  <div style={legendeCarte}>volume global, tous liens</div>
                  {/* totalClicsChangePct (pas shortio.clicksChange) : celui-ci venait de
                  l'API Short.io elle-même (period=last30, TOUS les liens du domaine),
                  jamais aligné sur la période calendaire sélectionnée ici — affichait
                  des variations trompeuses type "-95,6%" à côté d'un "3" qui n'avait
                  pas bougé. Remplacé par une vraie comparaison periodStart/periodEnd
                  vs la période équivalente précédente, même agrégation RPC que
                  totalClics. Confirmé par Chris 2026-07-21. */}
                  {/* 0% en gris neutre (pas de changement, ni hausse ni baisse) — vert
                  seulement si strictement positif, rouge seulement si strictement
                  négatif. Demande explicite de Chris 2026-07-21. */}
                  {totalClicsChangePct != null && <div style={{ fontSize: 10, fontWeight: 600, color: totalClicsChangePct > 0 ? GREEN : totalClicsChangePct < 0 ? RED : 'var(--muted)', marginTop: 3 }}>{totalClicsChangePct > 0 ? '+' : ''}{fmtPct(totalClicsChangePct)}</div>}
                  </div>
                  <div style={{ width: 1, background: 'var(--border)', alignSelf: 'stretch' }} />
                  {/* 5 — Calls bookés depuis liens */}
                  <div onClick={() => toggleMetric('calls')} style={cardStyle('calls')}>
                  <div className="eyebrow-sm" style={{ ...libelleCarte, display: 'flex', alignItems: 'center' }}>Calls bookés<AideColonne texte={AIDE_CALLS_BOOKES} /></div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: callsTotal > 0 ? GREEN : 'var(--faint)', lineHeight: 1 }}>{callsTotal}</div>
                  <div style={legendeCarte}>résultat final du tracking</div>
                  </div>
                </div>
              </div>

              <div style={blocKpi}>
                <div className="eyebrow-sm" style={titreBlocKpi}>Tunnel DM</div>
                <div style={rangeeKpi}>
                  {/* 2 — Leads commentaires/DM (compte aussi les réponses story avec mot-clé LM, cf. lmHistory) */}
                  <div onClick={() => toggleMetric('leads')} style={cardStyle('leads')}>
                  <div className="eyebrow-sm" style={libelleCarte}>Leads commentaires/DM</div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: lmEnvoyes > 0 ? 'var(--ink)' : 'var(--faint)', lineHeight: 1 }}>{fmt(lmEnvoyes)}</div>
                  <div style={legendeCarte}>mots-clés détectés</div>
                  </div>
                  <div style={{ width: 1, background: 'var(--border)', alignSelf: 'stretch' }} />
                  {/* 3 — Réponses message d'accroche */}
                  <div onClick={() => toggleMetric('hookReply')} style={cardStyle('hookReply')}>
                  <div className="eyebrow-sm" style={libelleCarte}>Réponses accroche LM DM</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, lineHeight: 1 }}>
                  <div style={{ fontSize: 24, fontWeight: 800, color: hookReplies > 0 ? GREEN : 'var(--faint)' }}>{fmt(hookReplies)}</div>
                  {lmEnvoyes > 0 && <div style={{ fontSize: 13, fontWeight: 700, color: tauxHookReply >= 30 ? GREEN : tauxHookReply >= 15 ? AMBER : RED }}>{tauxHookReply}%</div>}
                  </div>
                  <div style={legendeCarte}>réponses au message d'accroche</div>
                  </div>
                  <div style={{ width: 1, background: 'var(--border)', alignSelf: 'stretch' }} />
                  {/* 4 — Liens Calendly envoyés DM */}
                  <div onClick={() => toggleMetric('calendlyLinks')} style={cardStyle('calendlyLinks')}>
                  <div className="eyebrow-sm" style={libelleCarte}>Liens Calendly envoyés DM</div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--ink)', lineHeight: 1 }}>{fmt(lmCalendlyLinks)}</div>
                  <div style={legendeCarte}>activité commerciale brute</div>
                  </div>
                  <div style={{ width: 1, background: 'var(--border)', alignSelf: 'stretch' }} />
                  {/* 5 — Taux d'activation DM */}
                  <div onClick={() => toggleMetric('activation')} style={cardStyle('activation')}>
                  <div className="eyebrow-sm" style={libelleCarte}>Taux d'activation DM</div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
                  <div>
                  <div style={{ fontSize: 10, color: 'var(--faint)', marginBottom: 2 }}>LM</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: tauxLmColor, lineHeight: 1 }}>{tauxLmClic === null ? '—' : `${tauxLmClic}%`}</div>
                  </div>
                  <div style={{ width: 1, height: 28, background: 'var(--border)' }} />
                  <div>
                  <div style={{ fontSize: 10, color: 'var(--faint)', marginBottom: 2 }}>Calendly</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: tauxActColor, lineHeight: 1 }}>{tauxCalendlyClic === null ? '—' : `${tauxCalendlyClic}%`}</div>
                  </div>
                  </div>
                  <div style={legendeCarte}>clics / liens envoyés</div>
                  </div>
                </div>
              </div>
            
            </div>
          );
        })()}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>
            {{
              clics: 'Clics totaux / jour',
              leads: 'Leads commentaires/DM / jour',
              hookReply: 'Réponses accroche LM DM / jour',
              calendlyLinks: 'Liens Calendly envoyés DM / jour',
              activation: "Taux d'activation DM / jour",
              calls: 'Calls bookés / honorés / closés / revenu — par jour',
            }[selectedMetric]}
          </div>
        </div>

        {selectedMetric === 'clics' && (
          <>
          <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
            {/* « Story » manquait : les clics calendly_story comptaient dans « Tous les clics »
                sans appartenir à aucun filtre, rendant la somme des filtres inférieure au
                total sans explication. */}
            {([['all', 'Tous les clics'], ['dm', 'DM uniquement'], ['content', 'Contenu uniquement'], ['bio', 'Bio uniquement'], ['story', 'Story uniquement']] as const).map(([k, label]) => (
              <button key={k} onClick={() => setChartFilter(k)} style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 6, cursor: 'pointer', border: `1px solid ${chartFilter === k ? 'var(--accent-brand)' : 'var(--border)'}`, background: chartFilter === k ? '#3a6a8612' : 'transparent', color: chartFilter === k ? 'var(--accent-brand)' : 'var(--muted)', transition: 'all .12s' }}>
                {label}
              </button>
            ))}
          </div>
          {chartFilter === 'all' ? (
            clicsSeriesHasData || clicsSeries.some(d => (d.v ?? 0) > 0) ? (
              <div style={{ marginBottom: 10, animation: 'fadeIn 150ms ease-out' }}>
                <AreaChart data={clicsSeries} tickFormatter={parJour ? undefined : fmtAxisBucket} areas={[{ key: 'v', label: 'Clics', color: 'var(--accent-brand)' }]} xKey="date" height={200} showWeekday={parJour && sPeriod === 7} />
              </div>
            ) : (
              <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-2)', borderRadius: 10, color: 'var(--muted)', fontSize: 12, marginBottom: 10 }}>
                Aucun événement
              </div>
            )
          ) : !chartDataHasHistory ? (
            <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-2)', borderRadius: 10, color: 'var(--muted)', fontSize: 12, marginBottom: 10 }}>
              Aucun événement
            </div>
          ) : (chartFilter === 'content' || chartFilter === 'bio') ? (
            <ResponsiveContainer width="100%" height={200} initialDimension={{ width: 600, height: 200 }}>
              <ReAreaChart data={chartFilter === 'bio' ? chartDataBio : chartDataContent} margin={{ top: 4, right: 8, left: 0, bottom: 24 }}>
                <defs>
                  <linearGradient id="grad-chart-ig" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={IG_COLOR} stopOpacity={0.15} />
                    <stop offset="95%" stopColor={IG_COLOR} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="grad-chart-yt" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={YT_COLOR} stopOpacity={0.15} />
                    <stop offset="95%" stopColor={YT_COLOR} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={!parJour ? fmtAxisBucket : (sPeriod === 7 ? fmtAxisDateWithDay : fmtAxisDate)} interval={graduationsDates((chartFilter === 'bio' ? chartDataBio : chartDataContent).length, sPeriod)} />
                {/* Domain avec marge explicite — pas de Math.max(0, ...) inconditionnel sur
                    la borne basse (confirmé par inspection DOM réelle : ce clamp écrasait la
                    marge à 0 dès que dataMin valait déjà 0, laissant le point collé pile au
                    tick "0"), MAIS clampé à 0 quand dataMin est déjà >= 0 (compteur de clics,
                    jamais négatif) — sinon Recharts génère des ticks négatifs absurdes
                    ("-0.5") quand toutes les valeurs sont à 0, comme sur "Tous les clics". */}
                <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={28} allowDecimals={false} domain={([dataMin, dataMax]: readonly [number, number]) => { const range = dataMax - dataMin; const margin = range > 0 ? range * 0.12 : 1; const lo = dataMin - margin; return [dataMin >= 0 ? Math.max(0, lo) : lo, dataMax + margin]; }} />
                <Tooltip content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  return (
                    <div className="chart-tooltip">
                      <div className="chart-tooltip-label">{label}</div>
                      {payload.map((p: any, i: number) => (
                        <div key={i} className="chart-tooltip-row" style={{ color: p.color }}>
                          <span>{p.name}</span><strong style={{ marginLeft: 8 }}>{fmt(p.value)}</strong>
                        </div>
                      ))}
                    </div>
                  );
                }} />
                <Area type="monotone" dataKey="ig" name="Instagram" stroke={IG_COLOR} strokeWidth={2} fill="url(#grad-chart-ig)" dot={todayDotFactory(IG_COLOR, 'date', lastRealPointKey(chartFilter === 'bio' ? chartDataBio : chartDataContent, 'date', 'ig'))} activeDot={{ r: 3, strokeWidth: 0, fill: IG_COLOR }} isAnimationActive={false} />
                <Area type="monotone" dataKey="yt" name="YouTube" stroke={YT_COLOR} strokeWidth={2} fill="url(#grad-chart-yt)" dot={todayDotFactory(YT_COLOR, 'date', lastRealPointKey(chartFilter === 'bio' ? chartDataBio : chartDataContent, 'date', 'yt'))} activeDot={{ r: 3, strokeWidth: 0, fill: YT_COLOR }} isAnimationActive={false} />
              </ReAreaChart>
            </ResponsiveContainer>
          ) : chartFilter === 'story' ? (
            <div style={{ marginBottom: 10, animation: 'fadeIn 150ms ease-out' }}>
              <AreaChart data={chartDataStory} tickFormatter={parJour ? undefined : fmtAxisBucket} areas={[{ key: 'v', label: 'Story', color: '#8B5CF6' }]} xKey="date" height={200} showWeekday={parJour && sPeriod === 7} />
            </div>
          ) : chartFilter === 'dm' ? (
            <ResponsiveContainer width="100%" height={200} initialDimension={{ width: 600, height: 200 }}>
              <ReAreaChart data={chartDataDm} margin={{ top: 4, right: 8, left: 0, bottom: 24 }}>
                <defs>
                  <linearGradient id="grad-dm-calendly" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={BLUE} stopOpacity={0.15} />
                    <stop offset="95%" stopColor={BLUE} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="grad-dm-lm" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={AMBER} stopOpacity={0.15} />
                    <stop offset="95%" stopColor={AMBER} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={!parJour ? fmtAxisBucket : (sPeriod === 7 ? fmtAxisDateWithDay : fmtAxisDate)} interval={graduationsDates(chartDataDm.length, sPeriod)} />
                {/* Clampé à 0 si dataMin >= 0 (compteur de clics jamais négatif) — mêmes
                    raisons que le bloc content/bio ci-dessus, évite un tick "-1" absurde
                    quand tous les jours sont à 0. */}
                <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={28} allowDecimals={false} domain={([dataMin, dataMax]: readonly [number, number]) => { const range = dataMax - dataMin; const margin = Math.max(1, Math.ceil(range * 0.12)); const lo = dataMin - margin; return [dataMin >= 0 ? Math.max(0, lo) : lo, dataMax + margin]; }} />
                <Tooltip content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  return (
                    <div className="chart-tooltip">
                      <div className="chart-tooltip-label">{label}</div>
                      {payload.map((p: any, i: number) => (
                        <div key={i} className="chart-tooltip-row" style={{ color: p.color }}>
                          <span>{p.name}</span><strong style={{ marginLeft: 8 }}>{p.value}</strong>
                        </div>
                      ))}
                    </div>
                  );
                }} />
                <Area type="monotone" dataKey="calendly" name="Calendly" stroke={BLUE} strokeWidth={2} fill="url(#grad-dm-calendly)" dot={todayDotFactory(BLUE, 'date', lastRealPointKey(chartDataDm, 'date', 'calendly'))} activeDot={{ r: 3, strokeWidth: 0, fill: BLUE }} isAnimationActive={false} />
                <Area type="monotone" dataKey="lm" name="Lead Magnet" stroke={AMBER} strokeWidth={2} fill="url(#grad-dm-lm)" dot={todayDotFactory(AMBER, 'date', lastRealPointKey(chartDataDm, 'date', 'lm'))} activeDot={{ r: 3, strokeWidth: 0, fill: AMBER }} isAnimationActive={false} />
              </ReAreaChart>
            </ResponsiveContainer>
          ) : null}
          </>
        )}
        {selectedMetric === 'leads' && (
          <div style={{ marginBottom: 10, animation: 'fadeIn 150ms ease-out' }}>
            <AreaChart data={leadsSeries} tickFormatter={parJour ? undefined : fmtAxisBucket} areas={[{ key: 'v', label: 'Leads', color: AMBER }]} xKey="date" height={160} showWeekday={parJour && sPeriod === 7} />
          </div>
        )}
        {selectedMetric === 'hookReply' && (
          <div style={{ marginBottom: 10, animation: 'fadeIn 150ms ease-out' }}>
            <AreaChart data={hookReplySeries} tickFormatter={parJour ? undefined : fmtAxisBucket} areas={[{ key: 'v', label: 'Réponses', color: GREEN }]} xKey="date" height={160} showWeekday={parJour && sPeriod === 7} />
          </div>
        )}
        {selectedMetric === 'calendlyLinks' && (
          <div style={{ marginBottom: 10, animation: 'fadeIn 150ms ease-out' }}>
            <AreaChart data={calendlyLinksSeries} tickFormatter={parJour ? undefined : fmtAxisBucket} areas={[{ key: 'v', label: 'Liens envoyés', color: BLUE }]} xKey="date" height={160} showWeekday={parJour && sPeriod === 7} />
          </div>
        )}
        {selectedMetric === 'activation' && (
          <div style={{ marginBottom: 10, animation: 'fadeIn 150ms ease-out' }}>
            <ResponsiveContainer width="100%" height={160} initialDimension={{ width: 600, height: 160 }}>
              {/* BARRES et non courbes. Un taux d'activation n'existe que les jours ou
                  quelque chose a ete envoye — quelques colonnes isolees sur un mois.
                  Depuis que regrouperTaux rend un TROU (et non 0 %) sur denominateur nul,
                  la courbe n'avait plus de segments a relier : il ne restait que des
                  points flottants, ce qui se lit comme un graphique casse. Une barre
                  absente, elle, se lit naturellement « rien ce jour-la ». */}
              <ComposedChart data={activationSeries} margin={{ top: 4, right: 8, left: 0, bottom: 24 }}>
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={!parJour ? fmtAxisBucket : (sPeriod === 7 ? fmtAxisDateWithDay : fmtAxisDate)} interval={graduationsDates(activationSeries.length, sPeriod)} padding={{ left: 0, right: 0 }} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={36} unit="%" domain={[0, 100]} />
                <Tooltip content={({ active, payload, label }) => !active || !payload?.length ? null : (
                  <div className="chart-tooltip"><div className="chart-tooltip-label">{label}</div>
                    {payload.map((p: any, i: number) => (
                      <div key={i} className="chart-tooltip-row" style={{ color: p.color }}><span>{p.name}</span><strong style={{ marginLeft: 8 }}>{p.value}%</strong></div>
                    ))}
                  </div>
                )} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="lm" name="LM" fill={AMBER} radius={[2, 2, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="calendly" name="Calendly" fill={BLUE} radius={[2, 2, 0, 0]} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
        {selectedMetric === 'calls' && (
          <div style={{ marginBottom: 10, animation: 'fadeIn 150ms ease-out' }}>
            <ResponsiveContainer width="100%" height={180} initialDimension={{ width: 600, height: 180 }}>
              <ComposedChart data={callsSeries} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barCategoryGap="0%">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={!parJour ? fmtAxisBucket : (sPeriod === 7 ? fmtAxisDateWithDay : fmtAxisDate)} interval={graduationsDates(callsSeries.length, sPeriod)} />
                <YAxis yAxisId="left" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v}€`} />
                <Tooltip content={({ active, payload, label }) => !active || !payload?.length ? null : (
                  <div className="chart-tooltip"><div className="chart-tooltip-label">{label}</div>
                    {payload.map((p: any, i: number) => <div key={i} className="chart-tooltip-row" style={{ color: p.color }}><span>{p.name}</span><strong style={{ marginLeft: 8 }}>{p.dataKey === 'revenue' ? `${p.value}€` : p.value}</strong></div>)}
                  </div>
                )} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="left" dataKey="booked" name="Bookés" fill={BLUE} barSize={3} />
                <Bar yAxisId="left" dataKey="honored" name="Honorés" fill={GREEN} barSize={3} />
                <Bar yAxisId="left" dataKey="closed" name="Closés" fill={AMBER} barSize={3} />
                <Line yAxisId="right" type="monotone" dataKey="revenue" name="Revenu" stroke={RED} strokeWidth={2} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* ── Tableau breakdown par source ── */}
        {(() => {
          // Clics bio depuis DB uniquement (urlToCategoryFromDb = source de vérité, pas limité au top 20 API)
          const bioIGClics = clicksByUrl ? [...clicksByUrl.entries()]
            .filter(([url]) => CATS_BIO_IG.has(urlToCategoryFromDb?.get(url) ?? ''))
            .reduce((s, [, v]) => s + v, 0) : null;
          const bioYTClics = clicksByUrl ? [...clicksByUrl.entries()]
            .filter(([url]) => CATS_BIO_YT.has(urlToCategoryFromDb?.get(url) ?? ''))
            .reduce((s, [, v]) => s + v, 0) : null;
          const isCalendlyLink = (l: any) => (l.originalUrl || '').toLowerCase().includes('calendly');
          const igContentLinks = postLinks.filter((l: any) => l.postPlatform === 'IG' && isCalendlyLink(l));
          const ytContentLinks = postLinks.filter((l: any) => l.postPlatform === 'YT' && isCalendlyLink(l));
          const igRows = consolidatedRows.filter(r => r.platform === 'IG');
          const ytRows = consolidatedRows.filter(r => r.platform === 'YT');

          // Calls depuis lien bio — source de vérité : table calls filtrée par source
          // Les calls bio n'ont pas de ig_lead_id, ils sont trackés via utm_medium=bio
          // isInPeriod(scheduled_at) manquait ici — tous les autres calculs du fichier
          // (callsInWindow, postCalls...) filtrent par période, mais bioIGCalls/bioYTCalls
          // prenaient TOUS les calls source=ig_bio/yt_bio sans borner à la période affichée.
          // Un call bio hors du mois sélectionné gonflait le breakdown par source sans
          // apparaître dans le KPI "Calls bookés" du haut de page (lui bien filtré).
          const bioIGCalls = (calls ?? []).filter(c => c.source === 'ig_bio' && isInPeriod(callPeriodDate(c)));
          const bioYTCalls = (calls ?? []).filter(c => c.source === 'yt_bio' && isInPeriod(callPeriodDate(c)));
          // OPPORTUNITES, pas rendez-vous. Un 2e rendez-vous qui PROLONGE la meme vente
          // ne recompte pas : la source ne l'a pas produit une seconde fois.
          //
          // La distinction ne vient PAS de `is_follow_up`, qui n'est qu'un marqueur de
          // saisie. Elle vient de `idsDeContinuation` (lib/callSeries.ts) : un call est
          // une continuation si le call PRECEDENT du meme prospect a ete cloture avec
          // `outcome = 'second_call'`, c'est-a-dire si le coach a declare dans son
          // rapport qu'un second rendez-vous suivrait. Une personne qui reprend
          // rendez-vous plus tard pour une NOUVELLE demande compte donc a nouveau —
          // verifie sur incogniton.734 (15/06 puis 15/08, `outcome = 'to_recontact'`
          // sur le premier) : il compte bien pour 2.
          //
          // `closed` et `revenue` gardent l'autre grain : un deal se compte la ou il a
          // ete signe, meme au 2e rendez-vous. Meme regle que Performance par contenu.
          //
          // C'est ce qui fait diverger ce tableau (17) de Funnel & Calls (18), qui
          // compte des RENDEZ-VOUS. L'ecart est exactement le nombre de continuations,
          // et il est explique a l'ecran par l'infobulle de la colonne.
          const nbBooked = (cs: any[]) => cs.filter(c => !continuationsContenu.has(c.id) && c.status === 'active').length;
          const nbHonored = (cs: any[]) => cs.filter(c => !continuationsContenu.has(c.id) && isCallHonored(c, now)).length;

          const bioIGBooked = nbBooked(bioIGCalls);
          const bioIGHonored = nbHonored(bioIGCalls);
          const bioIGClosed = bioIGCalls.filter(c => c.deal_closed === true).length;
          const bioIGRevenue = cashDeLot(callsVenteInWindow.filter(c => c.source === 'ig_bio'));
          const bioYTBooked = nbBooked(bioYTCalls);
          const bioYTHonored = nbHonored(bioYTCalls);
          const bioYTClosed = bioYTCalls.filter(c => c.deal_closed === true).length;
          const bioYTRevenue = cashDeLot(callsVenteInWindow.filter(c => c.source === 'yt_bio'));

          // Meme source que la ligne « Lead magnet » (le JOURNAL, cf. `fichesAvecLm`), et
          // pas `instagram_leads.lead_magnet_sent`. Ces deux lectures forment une
          // PARTITION : ce qui n'est pas LM ici devient Cold DM / DM organique / Story
          // juste en dessous. Les faire diverger compte une personne deux fois.
          const isLMProspect = (l: any) => {
            if (l.ig_lead_id) return fichesAvecLm.has(l.ig_lead_id);
            if (l.ig_username) return pseudosAvecLm.has(String(l.ig_username).toLowerCase());
            return false;
          };
          const dmDirectLinks = prospectLinks.filter((l: any) => !isLMProspect(l));

          // Le classement des trois bacs vit dans `canalDuDm` (lib/canalDm.ts), pas ici :
          // la règle était recopiée à sept endroits, écrite en négatif
          // (« ni story_reply ni comment »), ce qui rangeait en Cold DM tout ce qu'elle
          // ne connaissait pas — `null` compris. Un lien créé pour un inconnu atterrissait
          // donc en « le coach est allé le chercher » sans que personne l'ait décidé.
          //
          // Depuis le 2026-09-02, ce cas est tranché à la création du lien : le coach
          // répond entrant ou sortant, et sa réponse est figée dans `source_at_creation`.
          // Un DM entrant rejoint « DM organique », qui a toujours voulu dire « tout DM
          // que le prospect a initié ».
          const dmLinkSentInPeriod = (l: any) => {
            if (!wasCalendlyLinkSent(l, linkClickedByLeadId)) return false;
            return isInPeriod(calendlySentAt(l, linkClickedByLeadId));
          };
          // Priorité à source_at_creation (figée au moment de la création du lien, cf.
          // migration 20260726010000) — fallback sur l'état courant du lead pour les liens
          // créés avant cette migration (source_at_creation sera null pour ces cas-là).
          // Sans ce pivot figé, un lien créé depuis un commentaire mais dont le lead a
          // depuis réinteragi ailleurs (ex: une story) basculait à tort de catégorie
          // business (cas réel découvert en test, cf. session 2026-07-26).
          const sourceForLink = (l: any) => l.source_at_creation ?? (l.ig_lead_id ? leads.find((ml: any) => ml.id === l.ig_lead_id)?.source : null);
          // "story_reply" a sa propre catégorie dédiée ("Story - Lead Magnet", cf. rows
          // plus bas) — fix d'un bug latent où ces leads tombaient silencieusement dans
          // "DM organique" (même condition que "comment"), sans distinction possible.
          const coldDMLinks = dmDirectLinks.filter((l: any) => canalDuDm(sourceForLink(l)) === 'sortant' && dmLinkSentInPeriod(l));
          const organicDMLinks = dmDirectLinks.filter((l: any) => canalDuDm(sourceForLink(l)) === 'entrant' && dmLinkSentInPeriod(l));
          const storyReplyDMLinks = dmDirectLinks.filter((l: any) => canalDuDm(sourceForLink(l)) === 'story' && dmLinkSentInPeriod(l));

          // Calls bookés/honorés/closés comptés selon LEUR PROPRE date (scheduled_at dans
          // la période), indépendamment de la date d'envoi du lien Calendly — convention
          // standard des outils d'attribution (GA4, HubSpot, Mixpanel) : chaque métrique
          // d'un rapport par période est bucketée sur sa propre date, pas sur celle d'un
          // événement amont. Un lien envoyé avant le début de la période mais dont le call
          // est bookés/closé dans la période doit compter ici, même si "liens envoyés"
          // (basé sur calendly_link_sent_at) ne le compte pas dans cette même période.
          // TOUS les calls de chaque prospect, pas seulement le premier. Un prospect qui
          // reprend rendez-vous (relance, 2ᵉ call après un premier sans suite) a
          // plusieurs calls : n'en garder qu'un faisait disparaître les autres de toutes
          // les catégories, et ils retombaient en « Autre / non catégorisé ». Observé sur
          // incogniton.734, qui a booké le 15/06 puis le 15/08.
          //
          // Le dédoublonnage reste nécessaire mais porte sur le bon axe : on part des
          // LIENS (coldDMLinks.flatMap ci-dessous), et un même prospect peut avoir
          // plusieurs liens (régénération). Sans dédup, ses calls seraient comptés une
          // fois par lien. On déduplique donc par call.id au moment de l'agrégation,
          // jamais en amont par prospect.
          const grouperParLead = (cs: typeof callsInWindow) => {
            const m = new Map<string, typeof callsInWindow>();
            for (const c of cs) {
              if (!c.ig_lead_id) continue;
              const list = m.get(c.ig_lead_id);
              if (list) list.push(c);
              else m.set(c.ig_lead_id, [c]);
            }
            return m;
          };
          const callsByLeadInWindow = grouperParLead(callsInWindow);
          // Le jumeau pour l'argent. Meme fonction, autre fenetre : c'est ce qui garantit
          // que les deux ne peuvent pas diverger par negligence.
          const callsByLeadVente = grouperParLead(callsVenteInWindow);
          // Renvoie les calls d'une liste de liens, dédupliqués par call.id.
          const callsDesLiens = (links: any[], parLead: Map<string, typeof callsInWindow>) => {
            const seen = new Set<string>();
            const out: typeof callsInWindow = [];
            for (const l of links) {
              if (!l.ig_lead_id) continue;
              for (const c of parLead.get(l.ig_lead_id) ?? []) {
                if (seen.has(c.id)) continue;
                seen.add(c.id);
                out.push(c);
              }
            }
            return out;
          };
          const callsForLinks = (links: any[]) => callsDesLiens(links, callsByLeadInWindow);
          const callsVenteForLinks = (links: any[]) => callsDesLiens(links, callsByLeadVente);

          // Même séparation que pour les leads LM plus bas : les listes *DMLinks
          // restent bornées à la période (colonnes « liens envoyés » et « clics »),
          // mais le rattachement des CALLS part de tous les liens du prospect. Sans
          // ça, un prospect ayant reçu son lien avant la période mais réservé pendant
          // voyait son call tomber en « Autre / non catégorisé ».
          // callsForLinks ne remonte que des calls de callsByLeadInWindow, déjà borné
          // à la période : élargir les liens n'élargit donc pas les calls.
          const allDmLinksBySource = (pred: (l: any) => boolean) =>
            dmDirectLinks.filter((l: any) => pred(l) && wasCalendlyLinkSent(l, linkClickedByLeadId));
          const coldDMLinksAll    = allDmLinksBySource(l => canalDuDm(sourceForLink(l)) === 'sortant');
          const organicDMLinksAll = allDmLinksBySource(l => canalDuDm(sourceForLink(l)) === 'entrant');
          const storyReplyLinksAll = allDmLinksBySource(l => canalDuDm(sourceForLink(l)) === 'story');

          const coldCalls = callsForLinks(coldDMLinksAll);
          const coldBooked = nbBooked(coldCalls);
          const coldHonored = nbHonored(coldCalls);
          const coldClosed = coldCalls.filter(c => c.deal_closed === true).length;
          const coldCallsVente = callsVenteForLinks(coldDMLinksAll);
          const coldRevenue = cashDeLot(coldCallsVente);
          const coldClics = coldDMLinks.filter((l: any) => l.ig_lead_id && linkClickedByLeadId?.has(l.ig_lead_id)).length;

          const organicCalls = callsForLinks(organicDMLinksAll);
          const organicBooked = nbBooked(organicCalls);
          const organicHonored = nbHonored(organicCalls);
          const organicClosed = organicCalls.filter(c => c.deal_closed === true).length;
          const organicCallsVente = callsVenteForLinks(organicDMLinksAll);
          const organicRevenue = cashDeLot(organicCallsVente);
          const organicClics = organicDMLinks.filter((l: any) => l.ig_lead_id && linkClickedByLeadId?.has(l.ig_lead_id)).length;

          // "Story - Lead Magnet" : calls dont le lead vient d'un reply à une story
          // (source='story_reply') — pivot toujours story_sequence_id en amont, jamais
          // ig_story_id seul (cf. principe d'attribution du chantier Stories).
          const storyLmCalls = callsForLinks(storyReplyLinksAll);
          const storyLmBooked = nbBooked(storyLmCalls);
          const storyLmHonored = nbHonored(storyLmCalls);
          const storyLmClosed = storyLmCalls.filter(c => c.deal_closed === true).length;
          const storyLmCallsVente = callsVenteForLinks(storyReplyLinksAll);
          const storyLmRevenue = cashDeLot(storyLmCallsVente);
          const storyLmClics = storyReplyDMLinks.filter((l: any) => l.ig_lead_id && linkClickedByLeadId?.has(l.ig_lead_id)).length;

          // "Story - Calendly" : calls dont utm_content matche une séquence story dont
          // le bloc Calendly est configuré (utm_content=sequenceId, généré au moment de
          // la création ou de la génération après coup — voir POST/PATCH story-sequences).
          const calendlySequenceIds = new Set(storySequenceRows.filter(s => !!s.calendlyShortUrl).map(s => s.sequenceId));
          const storyCalendlyCalls = callsInWindow.filter(c => c.utm_content && calendlySequenceIds.has(c.utm_content));
          const storyCalendlyBooked = nbBooked(storyCalendlyCalls);
          const storyCalendlyHonored = nbHonored(storyCalendlyCalls);
          const storyCalendlyClosed = storyCalendlyCalls.filter(c => c.deal_closed === true).length;
          const storyCalendlyCallsVente = callsVenteInWindow.filter(c => c.utm_content && calendlySequenceIds.has(c.utm_content));
          const storyCalendlyRevenue = cashDeLot(storyCalendlyCallsVente);

          // LM : liens envoyés = filtrés sur calendly_link_sent_at (comme avant) pour le
          // KPI "liens Calendly envoyés", mais calls booked/honored/closed = tout lead LM
          // dont un call tombe dans la période, même si le lien avait été envoyé avant.
          const lmProspectLinksDb = (prospectLinksData ?? []).filter((pl: any) => {
            if (!pl.ig_lead_id || !fichesAvecLm.has(pl.ig_lead_id)) return false;
            if (!wasCalendlyLinkSent(pl, linkClickedByLeadId)) return false;
            return isInPeriod(calendlySentAt(pl, linkClickedByLeadId));
          });
          // Scopé sur lmProspectLinksDb (déjà filtré par période), pas tout
          // prospectLinksData — sinon un lead ayant reçu un LM à n'importe quel moment
          // (même hors période) faisait fuiter ses calls dans le compte de cette période,
          // créant des incohérences du type "1 lien Calendly mais 2 calls bookés".
          // Deux populations distinctes, à ne pas confondre :
          //
          // - lmProspectLinksDb : les liens ENVOYÉS dans la période (colonne "liens
          //   Calendly" de la carte). Borné par période, c'est ce qu'on veut mesurer.
          //
          // - lmLeadIds : les leads dont on rattache les CALLS. Ne doit PAS être borné
          //   par la date d'envoi du lien : un prospect peut recevoir son lien en juin
          //   et ne réserver qu'en août. Le lien sortait alors de la fenêtre, le lead
          //   avec, et son call tombait en « Autre / non catégorisé » — constaté sur
          //   incogniton.734 (lien envoyé le 07/06, call le 15/08) pour la semaine du
          //   10 au 16 août.
          //
          // Le risque d'incohérence que ce bornage évitait (« 1 lien Calendly mais 2
          // calls bookés ») ne revient pas : callsByLeadInWindow ne contient déjà que
          // les calls DE LA PÉRIODE, donc élargir les leads n'élargit pas les calls.
          const lmAllLinks = (prospectLinksData ?? []).filter((pl: any) => {
            if (!pl.ig_lead_id || !fichesAvecLm.has(pl.ig_lead_id)) return false;
            return wasCalendlyLinkSent(pl, linkClickedByLeadId);
          });
          const lmLeadIds = new Set(lmAllLinks.map((pl: any) => pl.ig_lead_id));
          const lmCalls = [...callsByLeadInWindow.entries()]
            .filter(([leadId]) => lmLeadIds.has(leadId))
            .flatMap(([, cs]) => cs);
          const lmBooked = nbBooked(lmCalls);
          const lmHonored = nbHonored(lmCalls);
          const lmClosed = lmCalls.filter(c => c.deal_closed === true).length;
          const lmCallsVente = [...callsByLeadVente.entries()]
            .filter(([leadId]) => lmLeadIds.has(leadId))
            .flatMap(([, cs]) => cs);
          const lmRevenue = cashDeLot(lmCallsVente);

          const igContentClics = igContentLinks.reduce((s: number, l: any) => s + linkClics(l), 0);
          const igContentBooked = igRows.reduce((s, r) => s + (r.callsBookedDesc ?? 0), 0);
          const igContentHonored = igRows.reduce((s, r) => s + (r.callsHonoredDesc ?? 0), 0);
          const igContentClosed = igRows.reduce((s, r) => s + (r.closedDesc ?? 0), 0);
          const igContentRevenue = igRows.reduce((s, r) => s + (r.revenueDesc ?? 0), 0);

          const ytContentClics = ytContentLinks.reduce((s: number, l: any) => s + linkClics(l), 0);
          const ytContentBooked = ytRows.reduce((s, r) => s + (r.callsBookedDesc ?? 0), 0);
          const ytContentHonored = ytRows.reduce((s, r) => s + (r.callsHonoredDesc ?? 0), 0);
          const ytContentClosed = ytRows.reduce((s, r) => s + (r.closedDesc ?? 0), 0);
          const ytContentRevenue = ytRows.reduce((s, r) => s + (r.revenueDesc ?? 0), 0);

          // "Autre / non catégorisé" — filet de sécurité : un call peut ne matcher
          // aucune catégorie ci-dessus si son post source n'est plus dans la liste des
          // posts connus (contenu ancien, hors des ~100 derniers posts récupérés via
          // l'API, ou supprimé) — sinon il reste compté dans le total global (KPI
          // "activité commerciale brute") mais disparaît silencieusement du détail.
          const categorizedCallIds = new Set<string>([
            ...bioIGCalls.map(c => c.id), ...bioYTCalls.map(c => c.id),
            ...igRows.flatMap(r => r.postCallsDesc?.map((c: any) => c.id) ?? []),
            ...ytRows.flatMap(r => r.postCallsDesc?.map((c: any) => c.id) ?? []),
            ...lmCalls.map(c => c.id),
            ...coldCalls.map(c => c.id),
            ...organicCalls.map(c => c.id),
            ...storyLmCalls.map(c => c.id),
            ...storyCalendlyCalls.map(c => c.id),
          ]);
          const otherCalls = callsInWindow.filter(c => !categorizedCallIds.has(c.id));
          // Le complément pour l'argent se prend sur les JUMEAUX, jamais sur
          // `categorizedCallIds` : les deux jeux ne contiennent pas les mêmes
          // rendez-vous, et mélanger les deux ferait compter un euro deux fois — ici,
          // et dans sa vraie catégorie.
          const categorizedCashIds = new Set<string>([
            ...callsVenteInWindow.filter(c => c.source === 'ig_bio' || c.source === 'yt_bio').map(c => c.id),
            ...igRows.flatMap(r => r.postCallsDescVente?.map((c: any) => c.id) ?? []),
            ...ytRows.flatMap(r => r.postCallsDescVente?.map((c: any) => c.id) ?? []),
            ...lmCallsVente.map(c => c.id),
            ...coldCallsVente.map(c => c.id),
            ...organicCallsVente.map(c => c.id),
            ...storyLmCallsVente.map(c => c.id),
            ...storyCalendlyCallsVente.map(c => c.id),
          ]);
          const otherBooked = nbBooked(otherCalls);
          const otherHonored = nbHonored(otherCalls);
          const otherClosed = otherCalls.filter(c => c.deal_closed === true).length;
          const otherRevenue = cashDeLot(callsVenteInWindow.filter(c => !categorizedCashIds.has(c.id)));

          type SourceRow = {
            label: string; labelSuffix?: React.ReactNode; badge: string; badgeColor: string;
            liens: number | null;     // nb de liens envoyés (LM/DM uniquement)
            liensLabel: string | null; // ex: "LM envoyés", "liens DM"
            clics: number | null;
            isContentType: boolean;
            booked: number; honored: number; closed: number; revenue: number;
          };
          // Icônes directionnelles style WhatsApp
          const ArrowOut = () => (
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" style={{ display: 'inline', marginLeft: 3, verticalAlign: 'middle' }}>
              <path d="M2 9L9 2M9 2H4.5M9 2V6.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          );
          const ArrowIn = () => (
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" style={{ display: 'inline', marginLeft: 3, verticalAlign: 'middle' }}>
              <path d="M9 2L2 9M2 9H6.5M2 9V4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          );
          const rows: SourceRow[] = [
            { label: 'Bio IG', badge: 'IG', badgeColor: '#F06292', liens: null, liensLabel: null, clics: bioIGClics, booked: bioIGBooked, honored: bioIGHonored, closed: bioIGClosed, revenue: bioIGRevenue, isContentType: true },
            { label: 'Bio YT', badge: 'YT', badgeColor: '#FF0000', liens: null, liensLabel: null, clics: bioYTClics, booked: bioYTBooked, honored: bioYTHonored, closed: bioYTClosed, revenue: bioYTRevenue, isContentType: true },
            { label: 'Lien contenu IG', badge: 'IG', badgeColor: '#F06292', liens: null, liensLabel: null, clics: igContentClics, booked: igContentBooked, honored: igContentHonored, closed: igContentClosed, revenue: igContentRevenue, isContentType: true },
            { label: 'Lien contenu YT', badge: 'YT', badgeColor: '#FF0000', liens: null, liensLabel: null, clics: ytContentClics, booked: ytContentBooked, honored: ytContentHonored, closed: ytContentClosed, revenue: ytContentRevenue, isContentType: true },
            { label: 'Lead magnet', badge: 'LM', badgeColor: '#8B5CF6', liens: lmCalendlyLinks, liensLabel: 'liens Calendly', clics: lmProspectLinksDb.filter((l: any) => l.ig_lead_id && linkClickedByLeadId?.has(l.ig_lead_id)).length, booked: lmBooked, honored: lmHonored, closed: lmClosed, revenue: lmRevenue, isContentType: false },
            { label: 'Story - Lead Magnet', badge: 'STORY', badgeColor: '#8B5CF6', liens: storyReplyDMLinks.length, liensLabel: 'liens envoyés', clics: storyReplyDMLinks.length > 0 ? storyLmClics : null, booked: storyLmBooked, honored: storyLmHonored, closed: storyLmClosed, revenue: storyLmRevenue, isContentType: false },
            { label: 'Story - Calendly', badge: 'STORY', badgeColor: BLUE, liens: null, liensLabel: null, clics: null, booked: storyCalendlyBooked, honored: storyCalendlyHonored, closed: storyCalendlyClosed, revenue: storyCalendlyRevenue, isContentType: false },
            { label: 'Cold DM', labelSuffix: <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 500 }}> (sortant <ArrowOut />)</span>, badge: 'DM', badgeColor: BLUE, liens: coldDMLinks.length, liensLabel: 'liens envoyés', clics: coldDMLinks.length > 0 ? coldClics : null, booked: coldBooked, honored: coldHonored, closed: coldClosed, revenue: coldRevenue, isContentType: false },
            { label: 'DM organique', labelSuffix: <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 500 }}> (entrant <ArrowIn />)</span>, badge: 'DM', badgeColor: '#10B981', liens: organicDMLinks.length, liensLabel: 'conversations', clics: organicDMLinks.length > 0 ? organicClics : null, booked: organicBooked, honored: organicHonored, closed: organicClosed, revenue: organicRevenue, isContentType: false },
            ...(otherCalls.length > 0 ? [{ label: 'Autre / non catégorisé', badge: '?', badgeColor: 'var(--muted)', liens: null, liensLabel: null, clics: null, booked: otherBooked, honored: otherHonored, closed: otherClosed, revenue: otherRevenue, isContentType: false }] : []),
          ];

          // Les deux colonnes de ce taux ne couvrent pas la meme periode : les CALLS
          // remontent a `integrations_ready_at`, les CLICS ne commencent qu'au premier
          // jour de collecte Short.io. Le rapport des deux affichait 140 % et 300 % —
          // arithmetiquement exact, et faux comme mesure de conversion.
          //
          // Un trou, pas un taux sur la fenetre commune : un pourcentage calcule sur une
          // sous-periode, affiche a cote de colonnes qui couvrent toute la fenetre, a
          // l'air comparable et ne l'est pas. Rien a l'ecran ne le dirait.
          //
          // `premierJourCollecteShortio` est GLOBAL et non derive de
          // `joursCollectesShortio`, qui ne porte que les journees DE LA FENETRE : sur une
          // periode entierement anterieure a la collecte cet ensemble est VIDE, et en
          // conclure « couverture complete » est l'exact inverse de la verite (meme piege
          // deja corrige dans Funnel & Calls).
          const debutFenetreClics = parisDateStr(chartStart);
          const couvertureClicsIncomplete =
            !premierJourCollecteShortio || premierJourCollecteShortio > debutFenetreClics;
          const aideCouvertureClics = premierJourCollecteShortio
            ? `Les clics ne sont collectés que depuis le ${new Date(premierJourCollecteShortio).toLocaleDateString('fr-FR')}, alors que les rendez-vous remontent au début de la période. Le taux serait faux, il n'est donc pas affiché.`
            : "Aucun clic n'a encore été collecté sur cette période. Sans dénominateur mesuré, aucun taux n'est affiché.";

          const totBooked = rows.reduce((s, r) => s + r.booked, 0);
          const totHonored = rows.reduce((s, r) => s + r.honored, 0);
          const totClosed = rows.reduce((s, r) => s + r.closed, 0);
          const totRevenue = rows.reduce((s, r) => s + r.revenue, 0);

          const tauxBadge = (num: number, den: number, isContent: boolean) => {
            if (den === 0) return null;
            const pct = Math.round((num / den) * 100);
            // Au-dessus de 100 %, le chiffre est exact mais il ne mesure plus une
            // conversion : il dit qu'il y a eu PLUS de calls que de clics enregistres.
            //
            // Pourquoi c'est possible alors que le lien EST un lien Short.io : la source
            // d'un call ne vient pas du clic, elle vient des UTM que porte l'adresse de
            // DESTINATION. Le lien court redirige vers
            // calendly.com/...?utm_source=ig&utm_medium=bio, et le webhook Calendly lit
            // ces UTM (resource.tracking). Une fois la redirection faite, cette adresse
            // complete est dans la barre du navigateur : la rouvrir depuis l'historique,
            // ou la transmettre a quelqu'un, produit une reservation attribuee a la
            // source SANS repasser par Short.io.
            //
            // Seconde cause, sans aucune defaillance de suivi : le clic et la
            // reservation peuvent tomber de part et d'autre d'une frontiere de periode.
            //
            // Sans explication, « 150 % » se lit comme un bug de la plateforme. On le
            // sort donc de l'echelle de couleur (vert = bien, rouge = mal n'a plus de
            // sens ici), et on dit pourquoi au survol. On ne plafonne pas et on
            // n'invente rien : le chiffre reste celui qu'il est.
            const horsEchelle = pct > 100;
            if (horsEchelle) {
              return {
                pct, color: 'var(--muted)',
                titre: "Plus de rendez-vous que de clics sur cette période. C'est normal : le lien court redirige vers une adresse Calendly qui porte déjà la source. La rouvrir depuis l'historique du navigateur, ou la transmettre à quelqu'un, réserve un rendez-vous attribué à cette source sans repasser par le lien court. Un clic de fin de période peut aussi donner un rendez-vous pris la période suivante.",
              };
            }
            const color = isContent
              ? (pct >= 2 ? GREEN : pct >= 1 ? AMBER : RED)
              : (pct >= 50 ? GREEN : pct >= 25 ? AMBER : RED);
            return { pct, color, titre: undefined as string | undefined };
          };
          const tauxHonoréBadge = (honored: number, booked: number) => {
            if (booked === 0) return null;
            const pct = Math.round((honored / booked) * 100);
            const color = pct >= 75 ? GREEN : pct >= 50 ? AMBER : RED;
            return { pct, color };
          };
          const tauxClosedBadge = (closed: number, honored: number) => {
            if (honored === 0) return null;
            const pct = Math.round((closed / honored) * 100);
            const color = pct >= 50 ? GREEN : pct >= 25 ? AMBER : RED;
            return { pct, color };
          };

          const TH = ({ children, right }: { children: React.ReactNode; right?: boolean }) => (
            <th className="eyebrow-sm" style={{ padding: '7px 10px', textAlign: right ? 'right' : 'left', color: 'var(--muted)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{children}</th>
          );
          const TD = ({ children, right, faint }: { children: React.ReactNode; right?: boolean; faint?: boolean }) => (
            <td style={{ padding: '8px 10px', textAlign: right ? 'right' : 'left', fontSize: 12, color: faint ? 'var(--faint)' : 'var(--ink)', verticalAlign: 'middle' }}>{children}</td>
          );
          const RateBadge = ({ pct, color, titre }: { pct: number; color: string; titre?: string }) => (
            // `color + '18'` produit un fond translucide a partir d'un hexa. Sur une
            // variable CSS (--muted), la concatenation ne veut rien dire : on retombe
            // alors sur un fond neutre explicite.
            <span
              title={titre}
              style={{
                fontSize: 10, fontWeight: 700, color,
                background: color.startsWith('#') ? color + '18' : 'var(--surface-2)',
                borderRadius: 4, padding: '1px 5px', marginLeft: 4, whiteSpace: 'nowrap',
                cursor: titre ? 'help' : undefined,
              }}
            >{pct}%</span>
          );

          // Tri des rows (la ligne Total est toujours en bas)
          const sortedRows = bdSortKey === 'default' ? rows : [...rows].sort((a, b) => {
            let va = 0, vb = 0;
            if (bdSortKey === 'clics')   { va = a.clics ?? -1; vb = b.clics ?? -1; }
            if (bdSortKey === 'booked')  { va = a.booked;  vb = b.booked; }
            if (bdSortKey === 'honored') { va = a.honored; vb = b.honored; }
            if (bdSortKey === 'closed')  { va = a.closed;  vb = b.closed; }
            if (bdSortKey === 'revenue') { va = a.revenue; vb = b.revenue; }
            return bdSortDir === 'desc' ? vb - va : va - vb;
          });

          const sortLabels: Record<BdSortKey, string> = {
            default: 'Ordre par défaut', clics: 'Clics / Liens', booked: 'Calls bookés',
            honored: 'Calls honorés', closed: 'Closés', revenue: 'Revenue',
          };

          return (
            <div style={{ marginTop: 20, border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ padding: '10px 14px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <span className="eyebrow-lg" style={{ color: 'var(--ink)' }}>Breakdown par source — vers Calendly</span>
                </div>
                {/* Sélecteur de tri */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 10, color: 'var(--faint)' }}>Trier par</span>
                  <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <select
                      value={bdSortKey}
                      onChange={e => { setBdSortKey(e.target.value as BdSortKey); setBdSortDir('desc'); }}
                      style={{ fontSize: 11, fontWeight: 600, color: bdSortKey !== 'default' ? BLUE : 'var(--muted)', background: 'var(--surface)', border: `1px solid ${bdSortKey !== 'default' ? BLUE + '40' : 'var(--border)'}`, borderRadius: 6, padding: '3px 8px', cursor: 'pointer', appearance: 'none', paddingRight: 20 }}
                    >
                      {(Object.keys(sortLabels) as BdSortKey[]).map(k => (
                        <option key={k} value={k}>{sortLabels[k]}</option>
                      ))}
                    </select>
                    <span style={{ position: 'absolute', right: 6, fontSize: 9, color: 'var(--faint)', pointerEvents: 'none' }}>▾</span>
                  </div>
                  {bdSortKey !== 'default' && (
                    <button
                      onClick={() => setBdSortDir(d => d === 'desc' ? 'asc' : 'desc')}
                      style={{ fontSize: 11, fontWeight: 700, color: BLUE, background: BLUE + '12', border: 'none', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', minWidth: 28, textAlign: 'center' }}
                    >
                      {bdSortDir === 'desc' ? '↓' : '↑'}
                    </button>
                  )}
                </div>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--surface-2)' }}>
                    <TH>Source</TH>
                    <TH right><EnteteColonne nom="clicLien">Clics / Liens</EnteteColonne><AideColonne texte={AIDE_CLICS_LIENS} /></TH>
                    <TH right><EnteteColonne nom="callBooke">Calls bookés</EnteteColonne><AideColonne texte={AIDE_CALLS_BOOKES} /></TH>
                    <TH right><EnteteColonne nom="callHonore">Calls honorés</EnteteColonne><AideColonne texte={AIDE_CALLS_HONORES} /></TH>
                    <TH right><EnteteColonne nom="close">Closés</EnteteColonne></TH>
                    <TH right><EnteteColonne nom="revenue">Revenue</EnteteColonne></TH>
                    {/* « Rev / call » porte le meme billet que « Revenue » : le libelle
                        porte la division, pas l'icone.
                        Le DENOMINATEUR est le call BOOKE, et c'est le meme mot que dans
                        Funnel & Calls : « combien me rapporte un rendez-vous obtenu »,
                        le no-show faisant partie du cout d'obtention. Divise par les
                        honores, ce tableau affichait 680 EUR face aux 567 EUR de l'onglet
                        voisin, sous un libelle identique.
                        Les deux chiffres restent legerement differents (600 contre 567)
                        parce que ce tableau compte des opportunites et l'autre des
                        rendez-vous. C'est voulu : le denominateur doit rester le nombre
                        de la cellule voisine, sinon on recree le defaut retire du taux.
                        L'ecart est explique par le « ? » plutot que par le libelle, qui
                        reste court et identique des deux cotes. */}
                    <TH right><EnteteColonne nom="revenue">Rev / call</EnteteColonne><AideColonne texte={AIDE_REV_PAR_CALL} /></TH>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((row, i) => {
                    const bkTaux = (row.clics !== null && !couvertureClicsIncomplete)
                      ? tauxBadge(row.booked, row.clics, row.isContentType) : null;
                    const honTaux = tauxHonoréBadge(row.honored, row.booked);
                    const clsTaux = tauxClosedBadge(row.closed, row.honored);
                    return (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'transparent' : 'var(--surface-2)' }}>
                        <TD>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: '#fff', background: row.badgeColor, borderRadius: 4, padding: '2px 6px', flexShrink: 0 }}>{row.badge}</span>
                            <span style={{ fontSize: 12, fontWeight: 600 }}>{row.label}{row.labelSuffix}</span>
                          </div>
                        </TD>
                        <TD right>
                          {row.liens !== null ? (
                            // LM / Cold DM / DM organique : 2 lignes + taux
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                <span style={{ fontWeight: 700 }}>{fmt(row.liens)}</span>
                                <span style={{ fontSize: 10, color: 'var(--muted)' }}>{row.liensLabel}</span>
                              </div>
                              {row.clics !== null ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                  <span style={{ fontWeight: 600, color: 'var(--muted)' }}>{fmt(row.clics)}</span>
                                  <span style={{ fontSize: 10, color: 'var(--muted)' }}>leads uniques</span>
                                  {row.liens > 0 && (() => {
                                    const pct = Math.round((row.clics / row.liens) * 100);
                                    const color = pct >= 50 ? GREEN : pct >= 25 ? AMBER : RED;
                                    return <span style={{ fontSize: 10, fontWeight: 700, color, background: color + '18', borderRadius: 4, padding: '1px 5px' }}>{pct}%</span>;
                                  })()}
                                </div>
                              ) : <span style={{ fontSize: 10, color: 'var(--faint)' }}>— leads uniques</span>}
                            </div>
                          ) : row.clics !== null ? (
                            // Bio / contenu : des clics bruts.
                            //
                            // L'unite est ECRITE, comme sur les lignes DM juste au-dessus
                            // (« liens envoyes », « leads uniques »). La colonne porte deux
                            // grandeurs differentes selon la ligne, et seules les lignes DM
                            // le disaient : un nombre nu se lisait comme comparable a celui
                            // du dessus, alors qu'il ne l'est pas. C'est aussi pour ca que la
                            // somme de cette colonne ne tombe jamais sur « Clics totaux ».
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                              <span style={{ fontWeight: 700 }}>{fmt(row.clics)}</span>
                              {/* En francais, 0 et 1 prennent le singulier. */}
                              <span style={{ fontSize: 10, color: 'var(--muted)' }}>{row.clics > 1 ? 'clics' : 'clic'}</span>
                            </span>
                          ) : (
                            <span style={{ color: 'var(--faint)' }}>—</span>
                          )}
                        </TD>
                        <TD right>
                          {row.booked > 0
                            ? <><span style={{ fontWeight: 700 }}>{row.booked}</span>{bkTaux
                                ? <RateBadge pct={bkTaux.pct} color={bkTaux.color} titre={bkTaux.titre} />
                                : couvertureClicsIncomplete && row.clics !== null
                                  ? <span title={aideCouvertureClics} style={{ fontSize: 10, fontWeight: 700, color: 'var(--faint)', background: 'var(--surface-2)', borderRadius: 4, padding: '1px 5px', marginLeft: 4, cursor: 'help' }}>—</span>
                                  : null}</>
                            : <span style={{ color: 'var(--faint)' }}>—</span>}
                        </TD>
                        <TD right>
                          {row.booked > 0
                            ? row.honored > 0
                              ? <><span style={{ fontWeight: 700 }}>{row.honored}</span>{honTaux && <RateBadge pct={honTaux.pct} color={honTaux.color} />}</>
                              : <span style={{ fontWeight: 700, color: 'var(--muted)' }}>0</span>
                            : <span style={{ color: 'var(--faint)' }}>—</span>}
                        </TD>
                        <TD right>
                          {row.booked > 0
                            ? row.closed > 0
                              ? <><span style={{ fontWeight: 700 }}>{row.closed}</span>{clsTaux && <RateBadge pct={clsTaux.pct} color={clsTaux.color} />}</>
                              : <span style={{ fontWeight: 700, color: 'var(--muted)' }}>0</span>
                            : <span style={{ color: 'var(--faint)' }}>—</span>}
                        </TD>
                        <TD right>
                          {row.booked > 0
                            ? row.revenue > 0
                              ? <span style={{ fontWeight: 800, color: GREEN }}>{fmtEur(row.revenue)}</span>
                              : <span style={{ fontWeight: 700, color: 'var(--muted)' }}>0 €</span>
                            : <span style={{ color: 'var(--faint)' }}>—</span>}
                        </TD>
                        <TD right>
                          {row.booked > 0 && row.revenue > 0
                            ? <span style={{ fontWeight: 700, color: 'var(--ink)' }}>{fmtEur(Math.round(row.revenue / row.booked))}</span>
                            : <span style={{ color: 'var(--faint)' }}>—</span>}
                        </TD>
                      </tr>
                    );
                  })}
                  {/* Total row */}
                  <tr style={{ background: 'var(--surface-2)', borderTop: '2px solid var(--border)' }}>
                    <td className="eyebrow-lg" style={{ padding: '9px 10px', color: 'var(--muted)' }}>Total</td>
                    <TD right><span style={{ color: 'var(--muted)' }}>—</span></TD>
                    <TD right><span style={{ fontWeight: 800 }}>{totBooked > 0 ? totBooked : <span style={{ color: 'var(--faint)' }}>—</span>}</span></TD>
                    <TD right><span style={{ fontWeight: 800 }}>{totHonored > 0 ? totHonored : <span style={{ color: 'var(--faint)' }}>—</span>}</span></TD>
                    <TD right><span style={{ fontWeight: 800 }}>{totClosed > 0 ? totClosed : <span style={{ color: 'var(--faint)' }}>—</span>}</span></TD>
                    <TD right>{totRevenue > 0 ? <span style={{ fontWeight: 800, color: GREEN }}>{fmtEur(totRevenue)}</span> : <span style={{ color: 'var(--faint)' }}>—</span>}</TD>
                    <TD right>{totBooked > 0 && totRevenue > 0 ? <span style={{ fontWeight: 800, color: 'var(--ink)' }}>{fmtEur(Math.round(totRevenue / totBooked))}</span> : <span style={{ color: 'var(--faint)' }}>—</span>}</TD>
                  </tr>
                </tbody>
              </table>
            </div>
          );
        })()}
      </div>

      {/* ── Section 1b : Parcours des leads ── */}
      {(() => {
        const parContenu = parcoursAngle === 'contenu';
        // Le canal YouTube n'a pas de tunnel DM : sa chaîne commence à la réservation et
        // sa source est autre. Deux tableaux, parce que ce sont deux parcours — pas une
        // version amputée du premier.
        const estYT = parContenu && parcoursPlateforme === 'YT';
        const idsYT = new Set(consolidatedRows.filter(r => r.platform === 'YT').map(r => r.postId));
        const lignesParcours = estYT
          ? new Map([...parcoursPartage.entries()].filter(([cle]) => idsYT.has(cle)))
          : parContenu ? parcoursParContenu : parcoursParLeadMagnet;

        // Le libellé d'une ligne : un contenu a un titre, une vignette et des vues ; un
        // lead magnet a un nom et un mot-clé. Tout le reste est rigoureusement identique
        // — c'est tout l'intérêt d'une seule fonction pour les deux angles.
        const infoLigne = (cle: string) => {
          if (parContenu) {
            const r = consolidatedRows.find(x => x.postId === cle);
            const sansTitre = !r || !r.title || r.title === '(sans titre)';
            return {
              titre: sansTitre ? '(sans titre)' : r!.title,
              sousTitre: r ? `${r.type} · ${fmt(r.views)} vues` : 'contenu inconnu',
              vignette: r?.thumbnail ?? null,
              story: r?.platform === 'STORY_SEQUENCE',
              vuesParCall: r?.vuesParCall ?? null,
              cashParVue: r?.cashParVue ?? null,
              clicsDesc: r?.clicsDesc ?? 0,
              sansTitre,
            };
          }
          const lm = leadMagnets.find(l => l.id === cle);
          return {
            titre: lm ? lm.name : cle,
            sousTitre: lm && lm.keyword ? `mot-clé : ${lm.keyword}` : '',
            vignette: null, story: false, vuesParCall: null, cashParVue: null, clicsDesc: 0,
            sansTitre: !lm,
          };
        };

        // Les lignes qui EXISTENT, avant tout choix de l'utilisateur. Le sous-titre de la
        // barre s'y refere pour dire « 3 sur 7 » : sans ce jeu de reference, une grille
        // vide apres filtrage se lit comme une absence de donnees.
        const rowsParcoursToutes = [...lignesParcours.entries()]
          .map(([cle, l]) => ({ cle, l, info: infoLigne(cle) }))
          .filter(r => (estYT ? (r.l.callsBookes > 0 || r.info.clicsDesc > 0) : r.l.commentairesLm > 0));

        // Un filtre et un tri ne portent QUE sur une colonne affichee, et sous le nom
        // qu'elle porte a l'ecran. Les listes different donc entre Instagram et YouTube :
        // sur YouTube il n'y a ni commentaire ni conversation, proposer de trier dessus
        // offrirait de classer une colonne de zeros.
        const valeurParcours = (r: typeof rowsParcoursToutes[number], cle: string): number =>
          cle === 'clicsDesc' ? r.info.clicsDesc : Number((r.l as unknown as Record<string, unknown>)[cle] ?? 0);

        const CLICS_DESC: [string, string, string] = ['clicsDesc', 'Clics desc.', 'min. 1 clic desc.'];
        const FIN_DE_CHAINE: [string, string, string][] = [
          ['callsBookes', 'Calls bookés', 'min. 1 call booké'],
          ['callsHonores', 'Calls honorés', 'min. 1 call honoré'],
          ['closes', 'Closés', 'min. 1 closé'],
          ['revenue', 'Revenue', 'min. 1 € de revenue'],
        ];
        const COLONNES_PARCOURS: [string, string, string][] = estYT
          ? [CLICS_DESC, ...FIN_DE_CHAINE]
          : [['commentairesLm', 'Commentaires LM', 'min. 1 commentaire LM'],
             ['ontRepondu', 'Conversations', 'min. 1 conversation'],
             ['calendlyEnvoyes', 'Calendly envoyés', 'min. 1 Calendly envoyé'],
             ...FIN_DE_CHAINE];

        // Le tri par defaut peut ne pas exister sur l'angle courant : `callsBookes` existe
        // partout, mais un tri choisi sur Instagram puis un passage sur YouTube pourrait
        // pointer une colonne absente. On retombe alors sur la premiere colonne offerte,
        // plutot que de trier sur une valeur toujours nulle sans que rien ne le dise.
        const triParcoursValide = COLONNES_PARCOURS.some(([k]) => k === parcoursTri)
          ? parcoursTri : COLONNES_PARCOURS[0][0];

        const rowsParcours = rowsParcoursToutes
          .filter(r => {
            if (parcoursRecherche && !r.info.titre.toLowerCase().includes(parcoursRecherche.toLowerCase())) return false;
            for (const k of parcoursFiltres) if (valeurParcours(r, k) <= 0) return false;
            return true;
          })
          .sort((a, b) => {
            const av = valeurParcours(a, triParcoursValide);
            const bv = valeurParcours(b, triParcoursValide);
            // Departage stable par les commentaires : sans lui, deux lignes a egalite
            // changeaient d'ordre d'un rendu a l'autre.
            return (parcoursTriDir === 'desc' ? bv - av : av - bv)
              || (b.l.commentairesLm - a.l.commentairesLm);
          });

        const thP: React.CSSProperties = { textAlign: 'right', fontSize: 9.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)', padding: '6px 9px 9px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', verticalAlign: 'bottom' };
        const tdP: React.CSSProperties = { padding: '9px', textAlign: 'right', borderBottom: '1px solid var(--border-soft)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };
        // Le filet qui sépare un groupe HORS CHAÎNE de la chaîne. Il n'est pas décoratif :
        // c'est lui qui empêche de lire « 1 clic → 2 conversations » comme une remontée.
        const filet: React.CSSProperties = { borderLeft: '1px solid var(--border)' };

        const CelluleP = ({ n, sur }: { n: number; sur?: number }) => (
          <>
            <span style={{ fontWeight: 700, fontSize: 14, color: n > 0 ? 'var(--ink)' : 'var(--faint)' }}>{n}</span>
            {sur !== undefined && sur > 0 && n > 0 && (
              // Au-dela de 100 %, le taux n'est pas une performance : c'est le signe que
              // le DENOMINATEUR est sous-compte. Sur YouTube, un clic classe robot par
              // Short.io disparait du compte alors que le rendez-vous qu'il a produit
              // reste. Le vert felicitait alors une mesure cassee — et c'est ce
              // « 5 clics / 7 calls » qui a ouvert tout ce chantier. On l'affiche quand
              // meme, mais en ambre et en le disant : le masquer le rendrait invisible.
              <span
                title={n > sur ? `${n} pour ${sur} : il y a plus de rendez-vous que de clics comptés. Ce ne sont pas les rendez-vous qui sont en trop, ce sont les clics qui manquent — un clic classé robot par Short.io disparaît du compte alors que le rendez-vous qu'il a produit reste.` : undefined}
                style={{ display: 'block', fontSize: 9.5, fontWeight: 600, marginTop: 1, cursor: n > sur ? 'help' : 'default', color: n > sur ? AMBER : n >= sur ? GREEN : n * 2 >= sur ? AMBER : RED }}>
                {Math.round((n / sur) * 100)} %{n > sur ? ' ⚠' : ''}
              </span>
            )}
          </>
        );

        // « LM réclamés » n'existe que depuis que l'événement est écrit. Avant, un zéro
        // affirmerait que personne n'a appuyé sur le bouton, alors qu'on ne regardait pas.
        const lmReclameCouvre = !!premierLmReclame && new Date(premierLmReclame) <= periodStart;
        const lmReclameNote = premierLmReclame
          ? `Mesuré depuis le ${new Date(premierLmReclame).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} — avant cette date, l'appui sur le bouton du DM1 n'était pas enregistré.`
          : "L'appui sur le bouton du DM1 n'a encore jamais été enregistré sur ce compte. Un zéro affirmerait que personne n'appuie ; la vérité est qu'on ne le mesure pas encore.";

        // Les colonnes de fin reprennent MOT POUR MOT les textes de Vue générale et de
        // Funnel & Calls quand le grain est le même — c'est la règle posée au-dessus de
        // `AIDE_CALLS_BOOKES` : « le même texte doit apparaître partout où le même nombre
        // est compté de la même façon, sinon les libellés se remettent à diverger ».
        //
        // Deux exceptions, vérifiées une par une : « Closés » et « Revenue » portent ici
        // une règle de PÉRIODE différente. Ailleurs, une vente appartient à la période de
        // son rendez-vous ; ici elle appartient à la ligne de la porte d'entrée, quelle
        // que soit la date de la vente. Reprendre le texte d'ailleurs tel quel aurait
        // affirmé le contraire de ce que ce tableau fait.
        // Le meme texte pour la tete de bande ET pour chacune de ses cellules. Deux
        // copies auraient diverge a la premiere retouche — c'est la regle qui vaut deja
        // pour `AIDE_CALLS_BOOKES` et ses voisins, appliquee ici.
        const AIDE_DM1_REPLIE = "Déplier « LM réclamés » et « Clics LM ».\n\nCes deux colonnes ne sont pas des étapes du parcours : on peut répondre au message d'accroche sans avoir appuyé sur le bouton du DM1, et sans avoir cliqué sur le lead magnet. Elles mesurent l'efficacité du message automatique, pas la progression du prospect — d'où leur mise à l'écart.";

        const SUITE_COHORTE =
          "\n\nATTENTION, la période ne se lit pas comme ailleurs. Cette ligne suit les "
          + "personnes entrées par cette porte, et tout ce qu'elles ont fait ENSUITE y "
          + "reste rattaché. Une personne entrée en mars qui signe en juin apparaît sur la "
          + "ligne de mars, pas sur celle de juin.";
        const AIDE_CLOSES_PARCOURS = AIDE_CLOSING + SUITE_COHORTE;
        const AIDE_REVENUE_PARCOURS =
          "Le montant CONTRACTÉ des ventes de cette ligne — ce qui a été vendu, pas ce qui "
          + "est déjà encaissé. La source est la page Paiements, jamais le montant saisi "
          + "dans le rapport de call : corriger une vente depuis Paiements ne réécrit pas "
          + "le rapport, et les deux ont divergé."
          + SUITE_COHORTE;

        const AIDE_PARCOURS = <>
          <div><b>À quoi sert ce tableau.</b> Sur les personnes entrées par ce contenu, combien sont allées jusqu&apos;au bout, et à quelle étape les autres se sont arrêtées. C&apos;est l&apos;écran des goulots d&apos;étranglement.</div>
          <div><b>Il compte des personnes, pas des rendez-vous.</b> Une personne qui réserve deux fois compte une seule fois. C&apos;est ce qui fait que les nombres ne remontent jamais de gauche à droite, et pourquoi ils diffèrent de ceux de « Ce que fait chaque contenu », juste en dessous, qui compte des événements.</div>
          <div><b>Seuls les gens entrés par le tunnel DM figurent ici.</b> Une réservation venue d&apos;un lien de bio, d&apos;une description ou d&apos;une story n&apos;a aucune personne identifiable en amont : elle est comptée dans Vue générale et dans le Breakdown par source, pas ici. Le total de la colonne Revenue est donc normalement inférieur à celui de Vue générale, et ce n&apos;est pas un écart à corriger.</div>
          <div><b>Le groupe « Engagement du DM1 » est hors de la chaîne</b>, et <b>replié par défaut</b> : c'est la bande verticale marquée <b>DM1</b>, juste après « Commentaires LM ». Un clic dessus l'ouvre, un clic sur son titre la referme. Replié, la chaîne se lit d'un trait ; ouvert, le groupe s'isole entre filets, parce qu'il dérive des commentaires sans en être la suite. Appuyer sur le bouton du DM1 puis cliquer sur le lead magnet ne sont pas obligatoires pour répondre ensuite : les mettre dans la chaîne la ferait remonter le jour où quelqu&apos;un répond sans avoir cliqué. Ces deux colonnes mesurent l&apos;efficacité du message automatique, pas la progression du prospect.</div>
          <div><b>La période porte sur la date d&apos;entrée.</b> En regardant mars, vous voyez les personnes entrées en mars et tout ce qu&apos;elles ont fait ensuite, même en juin. Un rendez-vous se range dans la ligne par laquelle la personne était entrée juste avant lui. <b>Une relance manuelle n&apos;ouvre pas de nouvelle cohorte</b> : seule une nouvelle prise de lead magnet le fait.</div>
          <div><b>Les périodes récentes paraissent toujours faibles</b>, parce que les gens viennent d&apos;entrer et n&apos;ont pas encore eu le temps d&apos;aller au bout.</div>
          <div><b>Pas de ligne Total.</b> Une même personne peut être entrée par plusieurs contenus : additionner les lignes la compterait plusieurs fois.</div>
          {!lmReclameCouvre && !estYT && <div><b>« LM réclamés » affiche un tiret, pas un zéro.</b> {lmReclameNote}</div>}
          {estYT && <div><b>Sur YouTube la chaîne est plus courte, parce qu&apos;elle l&apos;est réellement.</b> Pas de commentaire mot-clé, pas de lead magnet, pas de conversation : le lien est en description et on réserve directement. <b>Les clics comptent des clics, pas des personnes</b> — Short.io ne sait pas qui clique. L&apos;identité n&apos;apparaît qu&apos;à la réservation, par l&apos;e-mail de l&apos;invité Calendly. Le taux entre les deux est quand même affiché : les sept intégrations doivent être connectées avant que vous entriez, donc les clics et les rendez-vous couvrent la même fenêtre. <b>S&apos;il dépasse 100 %</b>, ce ne sont pas les rendez-vous qui sont en trop, ce sont les clics qui manquent — un clic classé robot par Short.io disparaît du compte alors que le rendez-vous qu&apos;il a produit reste.</div>}
          {parContenu && <div><b>Les deux dernières colonnes sont à part, sur deux points.</b> D&apos;abord elles portent sur <b>tous</b> les rendez-vous du contenu, y compris ceux venus d&apos;un lien en description — pas seulement sur la chaîne à leur gauche. Ensuite elles sont en <b>all-time, depuis la publication du contenu</b>, et ne changent donc pas quand vous changez de période. C&apos;est volontaire : les vues d&apos;un contenu sont cumulatives, un post de juin en gagne encore aujourd&apos;hui. Les diviser par les rendez-vous d&apos;une seule semaine comparerait un total à un extrait, et le chiffre bougerait sans que le contenu ait rien fait de différent.</div>}
        </>;

        return (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px 22px' }}>
            <SectionHead
              title="Parcours des leads"
              sub={`Sur les personnes entrées par ce ${parContenu ? 'contenu' : 'lead magnet'}, combien vont jusqu'au bout.`}
              cleAide="parcours"
              aide={AIDE_PARCOURS}
              action={
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {/* La plateforme d'abord : c'est le filtre le plus large. L'angle
                      (Contenu / Lead magnet) precise ensuite ce qu'on regarde DEDANS, donc
                      il se lit apres — du general au particulier, dans le sens de lecture.

                      Pas de plateforme sur l'angle Lead magnet : un meme lead magnet peut
                      servir sur les deux a la fois. */}
                  {parContenu && (
                    <div style={{ display: 'inline-flex', gap: 3, background: 'var(--surface-2)', borderRadius: 7, padding: 3 }}>
                      {([['IG', 'Instagram'], ['YT', 'YouTube']] as const).map(([v, label]) => (
                        <button key={v} onClick={() => setParcoursPlateforme(v)}
                          style={{ fontSize: 11.5, fontWeight: 600, border: 'none', cursor: 'pointer', borderRadius: 5, padding: '5px 13px', background: parcoursPlateforme === v ? 'var(--surface)' : 'transparent', color: parcoursPlateforme === v ? 'var(--ink)' : 'var(--faint)' }}>
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                  <div style={{ display: 'inline-flex', gap: 3, background: 'var(--surface-2)', borderRadius: 7, padding: 3 }}>
                    {([['contenu', 'Contenu'], ['lm', 'Lead magnet']] as const).map(([v, label]) => (
                      <button key={v} onClick={() => setParcoursAngle(v)}
                        style={{ fontSize: 11.5, fontWeight: 600, border: 'none', cursor: 'pointer', borderRadius: 5, padding: '5px 13px', background: parcoursAngle === v ? 'var(--surface)' : 'transparent', color: parcoursAngle === v ? 'var(--ink)' : 'var(--faint)' }}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              }
            />

            {/* La barre sert aussi de SEPARATION entre l'en-tete et le tableau : sa
                bordure basse marque ou finit le titre et ou commencent les contenus. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14, paddingBottom: 14, borderBottom: '1px solid var(--border)' }}>
              <input
                type="text" value={parcoursRecherche} onChange={e => setParcoursRecherche(e.target.value)}
                placeholder={parContenu ? 'Recherche par titre…' : 'Recherche par lead magnet…'}
                style={{ width: 260, maxWidth: '100%', padding: '6px 10px', fontSize: 12, borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--ink)' }}
              />
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {COLONNES_PARCOURS.map(([key, , libelleFiltre]) => {
                    const actif = parcoursFiltres.has(key);
                    return (
                      <button key={key} onClick={() => {
                        const suivant = new Set(parcoursFiltres);
                        actif ? suivant.delete(key) : suivant.add(key);
                        setParcoursFiltres(suivant);
                      }} style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 6, cursor: 'pointer', border: `1px solid ${actif ? BLUE : 'var(--border)'}`, background: actif ? BLUE + '14' : 'transparent', color: actif ? BLUE : 'var(--muted)', transition: 'all .15s' }}>
                        {libelleFiltre}
                      </button>
                    );
                  })}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
                  <span style={{ fontSize: 10, color: 'var(--faint)' }}>Trier par</span>
                  <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                    <select value={triParcoursValide} onChange={e => { setParcoursTri(e.target.value); setParcoursTriDir('desc'); }}
                      style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 20px 5px 8px', cursor: 'pointer', appearance: 'none' }}>
                      {COLONNES_PARCOURS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                    </select>
                    <span style={{ position: 'absolute', right: 6, fontSize: 9, color: 'var(--faint)', pointerEvents: 'none' }}>▾</span>
                  </div>
                  <button onClick={() => setParcoursTriDir(d => (d === 'desc' ? 'asc' : 'desc'))}
                    title={parcoursTriDir === 'desc' ? 'Du plus grand au plus petit' : 'Du plus petit au plus grand'}
                    style={{ fontSize: 11, fontWeight: 700, color: BLUE, background: BLUE + '12', border: 'none', borderRadius: 6, padding: '5px 9px', cursor: 'pointer', minWidth: 28 }}>
                    {parcoursTriDir === 'desc' ? '↓' : '↑'}
                  </button>
                </div>
              </div>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: estYT ? 700 : (parContenu ? 1000 : 880) - (dm1Ouvert ? 0 : 100) }}>
                <thead>
                  {/* Intertitre du groupe hors chaîne : sans lui, deux colonnes de plus
                      dans la rangée se lisent comme deux marches de plus. */}
                  {/* La rangee reste tant qu'elle porte quelque chose : l'intertitre du
                      groupe s'il est deplie, celui de l'all-time sur l'angle Contenu. */}
                  {/* La rangee est TOUJOURS presente hors YouTube : repliee elle porte la
                      bande verticale, depliee le titre du groupe, et sur l'angle Contenu
                      l'intertitre all-time par-dessus. */}
                  {!estYT && (
                    <tr>
                      <th style={{ ...thP, borderBottom: 'none' }} />
                      {/* Deux cellules de tete : « Contenu » et « Commentaires LM ». Le
                          groupe se replie ENTRE la base de la mesure et la suite de la
                          chaine, la ou il se lit. */}
                      <th style={{ ...thP, borderBottom: 'none' }} />
                      {dm1Ouvert ? (
                        <th colSpan={2} style={{ ...thP, ...filet, textAlign: 'center', color: BLUE, borderBottom: 'none', paddingBottom: 2 }}>
                          <button
                            type="button"
                            onClick={() => setDm1Ouvert(false)}
                            aria-expanded
                            aria-label="Replier l'engagement du DM1"
                            title="Replier « LM réclamés » et « Clics LM »."
                            style={{ border: 'none', background: 'transparent', padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            {/* Meme taille que le triangle de la bande repliee : c'est le
                                MEME controle dans son autre etat, et une paire qui change
                                de taille en s'ouvrant se lit comme deux objets differents. */}
                            <span aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>▾</span>
                            Engagement du DM1
                          </button>
                          <span
                            title={"Ces deux colonnes ne sont PAS des étapes du parcours, et c'est pour ça qu'elles sont entre deux filets.\n\nOn peut répondre au message d'accroche sans avoir appuyé sur le bouton du DM1, et sans avoir cliqué sur le lead magnet. Si elles étaient dans la chaîne, celle-ci remonterait le jour où quelqu'un fait ça — par exemple 1 clic puis 2 réponses.\n\nElles mesurent l'efficacité du message automatique, pas la progression du prospect."}
                            style={{ display: 'inline-grid', placeItems: 'center', width: 13, height: 13, marginLeft: 5, borderRadius: '50%', border: `1px solid ${BLUE}`, color: BLUE, fontSize: 8.5, fontWeight: 700, cursor: 'help', verticalAlign: 'middle' }}>
                            ?
                          </span>
                        </th>
                      ) : (
                        // La bande repliee. `rowSpan` la fait descendre sur les deux rangees
                        // d'en-tete : c'est ce qui lui donne assez de hauteur pour que le
                        // libelle vertical se lise. Le fond la relie visuellement aux
                        // cellules du corps, qui portent le meme, si bien que la colonne se
                        // lit comme UNE bande continue et non comme des cases vides.
                        <th
                          rowSpan={2}
                          style={{ ...thP, ...filet, width: 30, minWidth: 30, padding: 0, background: 'var(--surface-2)', borderRight: '1px solid var(--border)' }}>
                          <button
                            type="button"
                            onClick={() => setDm1Ouvert(true)}
                            aria-expanded={false}
                            aria-label="Déplier l'engagement du DM1"
                            title={AIDE_DM1_REPLIE}
                            style={{ width: '100%', height: '100%', minHeight: 54, border: 'none', background: 'transparent', padding: '6px 0', cursor: 'pointer', color: 'var(--muted)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                            {/* Le triangle porte a lui seul le « il y a quelque chose a
                                ouvrir ». A 8 px il se lisait comme une poussiere ; a 14 il
                                se voit sans qu'on le cherche, et reste plus discret que le
                                libelle qu'il annonce. */}
                            <span aria-hidden style={{ fontSize: 14, lineHeight: 1, color: 'var(--ink-2)' }}>▸</span>
                            {/* `vertical-rl` + rotation : le texte se lit de bas en haut,
                                sens attendu pour un libelle de colonne pivote. */}
                            <span style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
                              DM1
                            </span>
                          </button>
                        </th>
                      )}
                      {/* Remplissage de « Conversations » a « Revenue » : colonnes 5 a 12
                          depliees, 3 a 10 repliees — HUIT dans les deux cas, et dans les deux
                          angles. Ce compte ne se devine pas : une rangee d'intertitre plus
                          courte que le corps ne provoque aucune erreur, le navigateur
                          complete en silence, et l'intertitre glisse d'une colonne sans que
                          rien ne le signale. */}
                      <th colSpan={8} style={{ ...thP, ...filet, borderBottom: 'none' }} />
                      {/* L'all-time chapeaute les DEUX colonnes d'un coup, plutot qu'une
                          mention repetee sous chaque en-tete : c'est la meme information
                          pour les deux, et le motif existe deja au-dessus. */}
                      {parContenu && (
                        <th colSpan={2} style={{ ...thP, ...filet, textAlign: 'center', color: 'var(--muted)', borderBottom: 'none', paddingBottom: 2 }}>
                          <span title={"Ces deux colonnes sont en ALL-TIME : elles portent sur toute la vie du contenu depuis sa publication, et ne changent donc pas quand vous changez de période.\n\nC'est voulu : les vues d'un contenu sont cumulatives, un post de juin en gagne encore aujourd'hui. Les diviser par les rendez-vous d'une seule semaine comparerait un total à un extrait, et le chiffre bougerait sans que le contenu ait rien fait de différent."} style={{ cursor: 'help' }}>
                            All-time &mdash; toute la vie du contenu
                          </span>
                        </th>
                      )}
                    </tr>
                  )}
                  <tr>
                    <th style={{ ...thP, textAlign: 'left', width: 240 }}>{parContenu ? 'Contenu' : 'Lead magnet'}</th>
                    {estYT
                      ? <th style={{ ...thP, ...filet }}><EnteteColonne nom="clicLien">Clics desc.</EnteteColonne></th>
                      : <>
                          {/* Le groupe se replie en BANDE VERTICALE, pas derriere un
                              chevron : un glyphe de 16 px dans un en-tete dense ne se voit
                              pas, et une commande qu'on ne voit pas n'existe pas. La bande
                              occupe une colonne etroite sur toute la hauteur du tableau,
                              libellee a la verticale — le motif des tableurs, ou replier un
                              groupe de colonnes laisse toujours une trace cliquable.

                              Elle est rendue plus haut, dans la rangee d'intertitre, avec
                              `rowSpan` : c'est ce qui lui donne la hauteur necessaire pour
                              que « DM1 » se lise. */}
                          <th style={thP}><EnteteColonne nom="leadsGeneres">Commentaires LM</EnteteColonne></th>
                          {dm1Ouvert && <th style={{ ...thP, ...filet }}><EnteteColonne nom="clicLeadMagnet">LM réclamés</EnteteColonne></th>}
                          {dm1Ouvert && <th style={thP}><EnteteColonne nom="clicLeadMagnet">Clics LM</EnteteColonne></th>}
                          {/* Le filet FERME le groupe. Replie, il ne doit pas rester : un
                              trait flotterait entre deux colonnes de la chaine. */}
                          <th style={dm1Ouvert ? { ...thP, ...filet } : thP}><EnteteColonne nom="conversationDm">Conversations</EnteteColonne></th>
                          <th style={thP}><EnteteColonne nom="calendlyEnvoye">Calendly envoyés</EnteteColonne></th>
                          <th style={thP}><EnteteColonne nom="clicLien">Clics Calendly</EnteteColonne></th>
                        </>}
                    <th style={thP}><EnteteColonne nom="callBooke">Calls bookés</EnteteColonne><AideColonne texte={AIDE_CALLS_BOOKES} /></th>
                    <th style={thP}><EnteteColonne nom="callHonore">Calls honorés</EnteteColonne><AideColonne texte={AIDE_CALLS_HONORES} /></th>
                    <th style={thP}><EnteteColonne nom="callQualifie">% qualifiés</EnteteColonne></th>
                    <th style={thP}><EnteteColonne nom="close">Closés</EnteteColonne><AideColonne texte={AIDE_CLOSES_PARCOURS} /></th>
                    <th style={thP}><EnteteColonne nom="revenue">Revenue</EnteteColonne><AideColonne texte={AIDE_REVENUE_PARCOURS} /></th>
                    {parContenu && <th style={{ ...thP, ...filet }}>Vues / call</th>}
                    {parContenu && <th style={thP}>Cash / vue</th>}
                  </tr>
                </thead>
                <tbody>
                  {rowsParcours.length === 0 && (
                    <tr><td colSpan={estYT ? 9 : (parContenu ? 14 : 12) - (dm1Ouvert ? 0 : 1)} style={{ padding: 20, textAlign: 'center', fontSize: 12, color: 'var(--faint)' }}>
                      {/* Une grille vide APRES filtrage n'est pas une absence de donnees.
                          Les confondre ferait conclure « ce canal ne produit rien » alors
                          qu'un bouton est simplement reste actif. */}
                      {rowsParcoursToutes.length > 0
                        ? 'Aucun contenu ne correspond à cette recherche ou à ces filtres.'
                        : estYT
                          ? 'Aucun clic ni rendez-vous depuis une description YouTube sur cette période.'
                          : 'Personne n\'est encore entré par ce canal sur la période.'}
                    </td></tr>
                  )}
                  {rowsParcours.map(({ cle, l, info }) => (
                    <tr key={cle}>
                      <td style={{ ...tdP, textAlign: 'left' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                          {parContenu && (info.vignette
                            ? <img src={info.vignette} alt="" style={{ width: 30, height: 38, borderRadius: 4, objectFit: 'cover', flex: 'none', border: '1px solid var(--border)' }} />
                            : <span style={{ width: 30, height: 38, borderRadius: 4, flex: 'none', border: '1px solid var(--border)', background: info.story ? '#8B5CF618' : 'var(--surface-2)' }} />)}
                          <span style={{ minWidth: 0 }}>
                            <span style={{ display: 'block', fontWeight: 600, fontSize: 12.5, color: info.sansTitre ? 'var(--faint)' : 'var(--ink)', fontStyle: info.sansTitre ? 'italic' : undefined, maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{info.titre}</span>
                            {info.sousTitre && <span style={{ display: 'block', fontSize: 10, color: 'var(--muted)', marginTop: 1 }}>{info.sousTitre}</span>}
                          </span>
                        </div>
                      </td>
                      {estYT
                        ? <td style={{ ...tdP, ...filet }}><CelluleP n={info.clicsDesc} /></td>
                        : <>
                           <td style={tdP}><CelluleP n={l.commentairesLm} /></td>
                           {/* Le prolongement de la bande. Vide par nature — elle ne cache
                               pas une valeur, elle marque une place — mais teintee et
                               bordee comme sa tete, sinon la colonne se lirait comme une
                               suite de cases oubliees.

                               TOUTE la bande deplie, pas seulement sa tete : c'est la cible
                               que la souris rencontre en premier, et viser un en-tete de
                               quelques pixels quand la colonne en fait des centaines est un
                               cout sans raison. Meme infobulle partout, pour que survoler
                               n'importe ou reponde a la meme question.

                               L'accessibilite reste portee par le BOUTON de la tete : lui
                               seul est focusable et annonce `aria-expanded`. Ces cellules
                               sont un raccourci a la souris qui double une commande deja
                               atteignable au clavier, jamais le seul chemin. */}
                           {!dm1Ouvert && (
                             <td
                               onClick={() => setDm1Ouvert(true)}
                               title={AIDE_DM1_REPLIE}
                               aria-hidden
                               style={{ ...tdP, ...filet, padding: 0, background: 'var(--surface-2)', borderRight: '1px solid var(--border)', cursor: 'pointer' }}
                             />
                           )}
                           {dm1Ouvert && (
                             <td style={{ ...tdP, ...filet }}>
                               {lmReclameCouvre
                                 ? <CelluleP n={l.lmReclames} sur={l.commentairesLm} />
                                 : <>
                                     <span style={{ color: 'var(--faint)' }} title={lmReclameNote}>&mdash;</span>
                                     <span style={{ display: 'block', fontSize: 9, color: 'var(--faint)', marginTop: 1 }}>non mesuré</span>
                                   </>}
                             </td>
                           )}
                           {dm1Ouvert && <td style={tdP}><CelluleP n={l.clicsLm} sur={l.commentairesLm} /></td>}
                           <td style={dm1Ouvert ? { ...tdP, ...filet } : tdP}><CelluleP n={l.ontRepondu} sur={l.commentairesLm} /></td>
                            <td style={tdP}><CelluleP n={l.calendlyEnvoyes} sur={l.ontRepondu} /></td>
                            <td style={tdP}><CelluleP n={l.clicsCalendly} sur={l.calendlyEnvoyes} /></td>
                          </>}
                      {/* Sur YouTube le taux clics -> réservations EST affiché, et la barre
                          qui séparait les deux colonnes a disparu.

                          L'objection d'origine — Short.io compte des clics anonymes, la
                          chaîne compte des personnes — reste vraie mais ne justifie pas de
                          cacher le rapport : le verrou d'accès impose que les sept
                          intégrations soient connectées avant que l'élève entre, donc les
                          clics et les rendez-vous couvrent la MÊME fenêtre par
                          construction (`integrations_ready_at`).

                          Ce qui peut encore faire dépasser 100 % n'est pas un décalage de
                          fenêtre mais le filtre à robots de Short.io, qui retire un clic
                          sans retirer le rendez-vous qu'il a produit. `CelluleP` le signale
                          au lieu de le féliciter en vert. */}
                      <td style={tdP}><CelluleP n={l.callsBookes} sur={estYT ? info.clicsDesc : l.clicsCalendly} /></td>
                      <td style={tdP}><CelluleP n={l.callsHonores} sur={l.callsBookes} /></td>
                      <td style={{ ...tdP, fontSize: 11 }}>
                        {l.qualifies.renseignes > 0 ? (
                          <>
                            <span style={{ fontWeight: 700, fontSize: 14 }}>{Math.round((l.qualifies.oui / l.qualifies.renseignes) * 100)} %</span>
                            <span style={{ display: 'block', fontSize: 9.5, color: 'var(--muted)', marginTop: 1 }}>{l.qualifies.oui} / {l.qualifies.renseignes}</span>
                          </>
                        ) : (
                          // Deux causes derriere une case vide, une seule merite un mot.
                          // Aucun call honore : il n'y avait rien a juger, le tiret suffit
                          // et ajouter du texte ferait croire a un manquement. Des calls
                          // honores mais aucun jugement : la question du rapport est restee
                          // sans reponse, et la le dire sert — c'est une action a faire.
                          //
                          // « aucun rapport » disait faux dans les deux cas : un rapport
                          // peut exister sans que cette question ait ete remplie.
                          <>
                            <span style={{ color: 'var(--faint)' }}>&mdash;</span>
                            {l.callsHonores > 0 && (
                              <span style={{ display: 'block', fontSize: 9.5, color: 'var(--faint)', marginTop: 1 }}>non renseigné</span>
                            )}
                          </>
                        )}
                      </td>
                      <td style={tdP}><CelluleP n={l.closes} sur={l.callsHonores} /></td>
                      <td style={tdP}>
                        {l.revenue > 0
                          ? <span style={{ fontWeight: 800, color: GREEN }}>{fmtEur(l.revenue)}</span>
                          : <span style={{ color: 'var(--faint)' }}>&mdash;</span>}
                      </td>
                      {parContenu && (
                        <td style={{ ...tdP, ...filet }}>
                          {info.vuesParCall ? <span style={{ fontWeight: 700 }}>{fmt(info.vuesParCall)}</span> : <span style={{ color: 'var(--faint)' }}>&mdash;</span>}
                        </td>
                      )}
                      {parContenu && (
                        <td style={tdP}>
                          {info.cashParVue ? <span style={{ fontWeight: 700 }}>{fmtEur(info.cashParVue)}</span> : <span style={{ color: 'var(--faint)' }}>&mdash;</span>}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {/* ── Section 2 : Ce que fait chaque contenu ── */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px 22px' }}>
        {/* Le sous-titre annonçait « N contenus avec activité business » alors que
            consolidatedRows contient TOUS les posts et vidéos du compte, y compris ceux
            dont chaque colonne vaut « — ». Deux chiffres désormais, tous deux vrais. */}
        <SectionHead
          title="Ce que fait chaque contenu"
          sub={`${consolidatedRows.filter(aDeLActivite).length} contenus avec activité sur ${consolidatedRows.length}`}
          action={
            <div style={{ display: 'inline-flex', gap: 3, background: 'var(--surface-2)', borderRadius: 7, padding: 3 }}>
              {([['all', 'Tous'], ['IG', 'Instagram'], ['YT', 'YouTube']] as const).map(([v, label]) => (
                <button key={v} onClick={() => setFilterPlatform(v)}
                  style={{ fontSize: 11.5, fontWeight: 600, border: 'none', cursor: 'pointer', borderRadius: 5, padding: '5px 13px', background: filterPlatform === v ? 'var(--surface)' : 'transparent', color: filterPlatform === v ? 'var(--ink)' : 'var(--faint)' }}>
                  {label}
                </button>
              ))}
            </div>
          }
          cleAide="roles"
          aide={<>
            <div><b>À quoi sert ce tableau.</b> Il répond à la question : qu&apos;est-ce que ce contenu a <b>déclenché</b> ? Pas seulement chez les gens qu&apos;il a fait entrer, mais au total — y compris chez des personnes arrivées par ailleurs.</div>
            <div><b>Il compte des événements, pas des personnes.</b> Une personne qui réserve deux fois compte deux fois. C&apos;est pourquoi ses nombres diffèrent de ceux du Parcours des leads, juste au-dessus, qui suit des personnes.</div>
            <div><b>Les trois chiffres ne se suivent pas, et on ne les additionne jamais.</b> Combien de personnes ce contenu a fait entrer, combien de conversations il a déclenchées, combien de rendez-vous il a produits : trois questions séparées. Un contenu peut ne faire entrer personne et produire des rendez-vous, quand des gens déjà présents réservent par son lien.</div>
            <div><b>Les rendez-vous d&apos;un contenu viennent de plusieurs origines</b> : le lien Calendly de sa description, celui envoyé en DM après son lead magnet, et d&apos;autres. Ils sont tous comptés ici.</div>
            <div><b>La période porte sur la date de chaque événement.</b> Un rendez-vous de juin apparaît en juin, même si la personne était entrée en mars.</div>
            <div><b>Un rendez-vous et son argent ne tombent pas toujours dans le même mois.</b> Quelqu&apos;un réserve le <b>29 août</b> pour un appel le <b>2 septembre</b>, et il achète pendant l&apos;appel. Vous verrez ce rendez-vous dans les <b>calls bookés d&apos;août</b>, et son argent dans le <b>revenue de septembre</b>.<br /><br />Ce n&apos;est pas une erreur : ce sont deux faits qui n&apos;ont pas eu lieu le même jour. Le rendez-vous a été décroché en août, la vente s&apos;est faite en septembre. Si on les forçait dans le même mois, on daterait la vente <b>avant</b> l&apos;appel qui l&apos;a produite — et une bonne semaine de prospection en fin de mois vous paraîtrait mauvaise, parce que son argent n&apos;arrive que le mois suivant.</div>
          </>}
        />

        {/* Barre de filtres */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14, paddingBottom: 14, borderBottom: '1px solid var(--border)' }}>
          {/* Deux rangees, et l'ordre compte : on cherche ou l'on trie d'abord, on
              restreint ensuite. Sur une seule ligne, les six filtres poussaient la
              recherche en bout de barre, la ou personne ne la cherche. */}
          {/* Recherche par titre. Largeur FIXE : etiree sur toute la barre, elle occupait
              une place sans rapport avec ce qu'on y tape. */}
          <input
            type="text" value={filterSearch} onChange={e => setFilterSearch(e.target.value)}
            placeholder="Recherche par titre…"
            style={{ width: 260, maxWidth: '100%', padding: '6px 10px', fontSize: 12, borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--ink)' }}
          />
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Un filtre ne porte que sur un nombre AFFICHE, et sous le nom que la carte
              lui donne.

              Trois filtres portaient sur des chiffres absents des cartes — clics
              description, clics lead magnet, liens DM envoyes. Filtrer sur un nombre
              qu'on ne voit pas rend le resultat inexplicable : la grille se vide, et rien
              a l'ecran ne dit pourquoi.

              Les six restants reprennent le vocabulaire des cartes, mot pour mot :
              « min. 1 commentaire LM » filtrait ce que la carte appelle « Leads entres ».
              Deux noms pour un meme nombre, c'est deja une divergence. */}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {([
              ['lmDetectes', 'min. 1 lead entré'],
              ['lmReponses', 'min. 1 conversation'],
              ['callsBooked', 'min. 1 call déclenché'],
              ['callsHonored', 'min. 1 call honoré'],
              ['closed', 'min. 1 closé'],
              ['revenue', 'min. 1 € de revenue'],
            ] as [SortKey, string][]).map(([key, label]) => {
              const active = filterHas.has(key);
              return (
                <button key={key} onClick={() => {
                  const next = new Set(filterHas);
                  active ? next.delete(key) : next.add(key);
                  setFilterHas(next);
                }} style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 6, cursor: 'pointer', border: `1px solid ${active ? BLUE : 'var(--border)'}`, background: active ? BLUE + '14' : 'transparent', color: active ? BLUE : 'var(--muted)', transition: 'all .15s' }}>
                  {label}
                </button>
              );
            })}
          </div>

          {/* Tri. Il vivait dans les en-têtes de colonnes ; les cartes n'en ont
              plus, et sans lui un élève à quarante contenus ne peut plus trouver ses
              meilleurs. Même mécanique que le tri du Breakdown par source. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
            <span style={{ fontSize: 10, color: 'var(--faint)' }}>Trier par</span>
            <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
              <select
                value={sortKey}
                onChange={e => { setSortKey(e.target.value as SortKey); setSortDir('desc'); }}
                style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 20px 5px 8px', cursor: 'pointer', appearance: 'none' }}
              >
                <option value="callsBooked">Calls déclenchés</option>
                <option value="lmDetectes">Leads entrés</option>
                <option value="lmReponses">Conversations déclenchées</option>
                <option value="revenue">Revenue</option>
                <option value="closed">Closés</option>
                <option value="callsHonored">Calls honorés</option>
                <option value="views">Vues</option>
                <option value="clicsDesc">Clics description</option>
              </select>
              <span style={{ position: 'absolute', right: 6, fontSize: 9, color: 'var(--faint)', pointerEvents: 'none' }}>▾</span>
            </div>
            <button
              onClick={() => setSortDir(d => (d === 'desc' ? 'asc' : 'desc'))}
              title={sortDir === 'desc' ? 'Du plus grand au plus petit' : 'Du plus petit au plus grand'}
              style={{ fontSize: 11, fontWeight: 700, color: BLUE, background: BLUE + '12', border: 'none', borderRadius: 6, padding: '5px 9px', cursor: 'pointer', minWidth: 28 }}
            >
              {sortDir === 'desc' ? '↓' : '↑'}
            </button>
          </div>
          </div>
        </div>

        {(() => {
          const rowsAvecActivite = consolidatedRows
            .filter(aDeLActivite)
            .filter(row => {
              if (filterPlatform !== 'all' && row.platform !== filterPlatform) return false;
              if (filterSearch && !row.title.toLowerCase().includes(filterSearch.toLowerCase())) return false;
              for (const k of filterHas) {
                const val = row[k as keyof typeof row];
                if (!val || val === 0) return false;
              }
              return true;
            })
            .sort((a, b) => {
              const av = (a[sortKey as keyof typeof a] as number) || 0;
              const bv = (b[sortKey as keyof typeof b] as number) || 0;
              return sortDir === 'desc' ? bv - av : av - bv;
            })
            ;
          // Six cartes suffisent a l'usage courant ; les autres se deplient sur demande,
          // dans la MEME forme. Un contenu sans aucune activite n'apparait jamais, ni
          // replie ni deplie : il n'a rien produit, et l'afficher noierait ceux qui ont
          // produit quelque chose.
          const rowsFiltrees = toutAfficher ? rowsAvecActivite : rowsAvecActivite.slice(0, 6);

          // Un rôle : son libellé complet, et son chiffre. JAMAIS de flèche ni de
          // pourcentage entre deux d'entre eux — c'est toute la raison de passer en
          // cartes. En colonnes adjacentes, l'œil lit un enchaînement et conclut que les
          // conversations sont celles des leads de la même ligne. Elles ne le sont pas :
          // ce sont trois questions séparées, sur trois populations différentes.
          const Role = ({ libelle, valeur }: { libelle: string; valeur: number }) => (
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, padding: '7px 0' }}>
              <span style={{ fontSize: 10.5, color: 'var(--muted)', lineHeight: 1.3 }}>{libelle}</span>
              <span style={{ fontSize: 19, fontWeight: 700, lineHeight: 1, color: valeur > 0 ? 'var(--ink)' : 'var(--faint)' }}>{valeur}</span>
            </div>
          );

          if (rowsFiltrees.length === 0) {
            return (
              <div style={{ padding: '28px 0', textAlign: 'center', fontSize: 12, color: 'var(--faint)' }}>
                Aucun contenu ne correspond à ces filtres.
              </div>
            );
          }

          return (
            <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 13 }}>
              {rowsFiltrees.map(row => {
                const selectionne = selectedContentId === row.postId;
                const couleur = row.platform === 'IG' ? ACCENT : row.platform === 'STORY_SEQUENCE' ? '#8B5CF6' : RED;
                const sansTitre = !row.title || row.title === '(sans titre)';
                return (
                  <div key={row.postId}
                    onClick={() => { setSelectedContentId(selectionne ? null : row.postId); setDetailModal(selectionne ? null : row); }}
                    style={{ background: 'var(--surface)', border: `1px solid ${selectionne ? BLUE : 'var(--border)'}`, borderRadius: 12, padding: '13px 14px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 11 }}>

                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      {row.thumbnail
                        ? <img src={row.thumbnail} alt="" style={{ width: 38, height: 48, borderRadius: 5, objectFit: 'cover', flex: 'none', border: '1px solid var(--border)' }} />
                        : <span style={{ width: 38, height: 48, borderRadius: 5, flex: 'none', background: 'var(--surface-2)', border: '1px solid var(--border)' }} />}
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: 'block', fontWeight: 600, fontSize: 12.5, color: sansTitre ? 'var(--faint)' : 'var(--ink)', fontStyle: sansTitre ? 'italic' : undefined, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {sansTitre ? '(sans titre)' : row.title}
                        </span>
                        <span style={{ display: 'block', fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                          <span style={{ color: couleur, fontWeight: 700 }}>{row.platform === 'STORY_SEQUENCE' ? 'STORY' : row.platform}</span>
                          {' · '}{row.type}{row.views > 0 ? ` · ${fmt(row.views)} vues` : ''}
                        </span>
                      </span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <Role libelle="Leads entrés par ce contenu" valeur={row.lmDetectes} />
                      <div style={{ borderTop: '1px solid var(--border-soft)' }} />
                      <Role libelle="Conversations déclenchées par ce contenu" valeur={row.lmReponses} />
                      <div style={{ borderTop: '1px solid var(--border-soft)' }} />
                      <Role libelle="Calls déclenchés par ce contenu" valeur={row.callsBooked} />
                    </div>

                    {/* Les résultats n'appartiennent qu'au TROISIÈME rôle : les mettre dans
                        la pile au-dessus suggérerait une suite qui n'existe pas. */}
                    <div style={{ display: 'flex', gap: 14, paddingTop: 9, borderTop: '1px solid var(--border)', fontSize: 10.5, color: 'var(--muted)' }}>
                      <span>Honorés<b style={{ display: 'block', fontSize: 13, fontWeight: 700, color: row.callsHonored > 0 ? 'var(--ink)' : 'var(--faint)' }}>{row.callsHonored}</b></span>
                      <span>Closés<b style={{ display: 'block', fontSize: 13, fontWeight: 700, color: row.closed > 0 ? 'var(--ink)' : 'var(--faint)' }}>{row.closed}</b></span>
                      <span>Revenue<b style={{ display: 'block', fontSize: 13, fontWeight: 700, color: row.revenue > 0 ? GREEN : 'var(--faint)' }}>{row.revenue > 0 ? fmtEur(row.revenue) : '—'}</b></span>
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Le compte porte sur les contenus qui ont RÉELLEMENT une activité, pas sur
                tous les contenus du compte. L'ancien bouton annonçait « Voir tout (N
                contenus) » avec N = tous les posts et vidéos, dont la plupart n'ont rien
                produit : il promettait une liste que la grille n'aurait jamais montrée. */}
            {rowsAvecActivite.length > 6 && (
              <div style={{ marginTop: 14, textAlign: 'center' }}>
                <button onClick={() => setToutAfficher(v => !v)}
                  style={{ padding: '7px 20px', fontSize: 12, fontWeight: 600, borderRadius: 8, cursor: 'pointer', border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)' }}>
                  {toutAfficher
                    ? 'Voir moins'
                    : `Voir les ${rowsAvecActivite.length - 6} autres contenus qui ont une activité`}
                </button>
              </div>
            )}
            </>
          );
        })()}
      </div>


      {/* ── Modal détail contenu ── */}
      {detailModal && (() => {
        const row = detailModal;
        const igPost = igPosts.find(p => p.id === row.postId);
        const ytVideo = ytVideos.find(v => v.id === row.postId);
        const platformColor = row.platform === 'IG' ? ACCENT : row.platform === 'STORY_SEQUENCE' ? '#8B5CF6' : RED;
        const pubDate = igPost?.timestamp || ytVideo?.publishedAt;
        const pubDateStr = pubDate ? new Date(pubDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : null;

        // Seuils couleurs funnel
        const convColor = (rate: number, threshold: number) => rate >= threshold ? GREEN : rate >= threshold * 0.6 ? AMBER : RED;

        // Funnel lien contenu
        const f1_clics = row.clicsDesc;
        const f1_calls = row.callsBookedDesc;
        const f1_honored = row.callsHonoredDesc;
        const f1_closed = row.closedDesc;
        const f1_revenue = row.revenueDesc;
        const r1_clicCall = f1_clics > 0 ? Math.round((f1_calls / f1_clics) * 100) : null;
        const r1_callHon = f1_calls > 0 ? Math.round((f1_honored / f1_calls) * 100) : null;
        const r1_honClosed = f1_honored > 0 ? Math.round((f1_closed / f1_honored) * 100) : null;

        // Funnel lead magnet
        const f2_comments = row.lmDetectes;
        const f2_sent = row.lmSent;
        const f2_calls = row.callsBookedLm;
        const f2_honored = row.callsHonoredLm;
        const f2_closed = row.closedLm;
        const f2_revenue = row.revenueLm;
        const r2_sentComm = f2_comments > 0 ? Math.round((f2_sent / f2_comments) * 100) : null;
        const r2_callSent = f2_sent > 0 ? Math.round((f2_calls / f2_sent) * 100) : null;
        const r2_callHon = f2_calls > 0 ? Math.round((f2_honored / f2_calls) * 100) : null;
        const r2_honClosed = f2_honored > 0 ? Math.round((f2_closed / f2_honored) * 100) : null;

        // La courbe de rétention était CODÉE EN DUR : onze points identiques pour
        // toutes les vidéos, quelles qu'elles soient. Elle donnait donc à lire
        // « 22 % restent après 11 % de la vidéo » sur des contenus dont personne
        // n'a jamais mesuré la rétention — une affirmation inventée, exactement ce
        // que la règle « aucune donnée simulée » du projet interdit.
        //
        // La vraie donnée (audienceWatchRatio) demande l'API YouTube Analytics
        // avec l'autorisation du propriétaire de la chaîne, qui n'est pas branchée.
        // Tant qu'elle ne l'est pas, l'écran dit qu'on ne sait pas — un trou est
        // une information, une fausse courbe n'en est pas une.
        const retentionIndisponible = row.platform === 'YT';

        // Prospects DM liés — source fiable prospectLinksData (même raison que dmProspects plus haut :
        // prospectLinks/shortio.links est tronqué côté serveur par période dès periodIndex > 0), filtré
        // sur la période sélectionnée comme le reste du modal (calendly_link_sent_at ?? created_at).
        const linkedProspects = (prospectLinksData ?? []).filter((l: any) => {
          if (l.post_id !== row.postId) return false;
          if (!wasCalendlyLinkSent(l, linkClickedByLeadId)) return false;
          const ts = calendlySentAt(l, linkClickedByLeadId);
          return ts ? isInPeriod(ts) : false;
        });
        const statusMap2: Record<string, string> = { closed: 'Closé', booked: 'Call booké', pending: 'En attente', noshow: 'No-show' };

        const FunnelStep = ({ label, value, rate, rateThreshold, isFirst }: { label: string; value: number | null; rate: number | null; rateThreshold?: number; isFirst?: boolean }) => (
          <div>
            {!isFirst && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0' }}>
                <div style={{ fontSize: 14, color: 'var(--faint)' }}>↓</div>
                {rate !== null && rateThreshold !== undefined && (
                  <span style={{ fontSize: 10, fontWeight: 700, color: convColor(rate, rateThreshold), background: convColor(rate, rateThreshold) + '18', borderRadius: 4, padding: '1px 6px' }}>{rate}%</span>
                )}
              </div>
            )}
            <div style={{ background: 'var(--surface-2)', borderRadius: 7, padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{label}</span>
              <span style={{ fontSize: 14, fontWeight: 800, color: value ? 'var(--ink)' : 'var(--faint)' }}>{value != null && value > 0 ? (label === 'Revenue' ? fmtEur(value) : value) : '—'}</span>
            </div>
          </div>
        );

        return (
          <Portal>
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
            onClick={() => { setDetailModal(null); setSelectedContentId(null); }}>
            <div style={{ background: 'var(--surface)', borderRadius: 16, maxWidth: 780, width: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 32px 80px rgba(0,0,0,.25)' }}
              onClick={e => e.stopPropagation()}>

              {/* Header modal */}
              <div style={{ padding: '22px 26px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                <div style={{ width: 56, height: 56, borderRadius: 10, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, flexShrink: 0 }}>
                  {row.thumbnail ? <img loading="lazy" decoding="async" src={row.thumbnail} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 10 }} /> : (row.platform === 'IG' ? '📷' : row.platform === 'STORY_SEQUENCE' ? '📸' : '▶️')}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4, lineHeight: 1.3 }}>{row.title}</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: platformColor, background: platformColor + '18', borderRadius: 4, padding: '2px 7px' }}>{row.platform === 'STORY_SEQUENCE' ? 'STORY' : row.platform} · {row.type}</span>
                    {pubDateStr && <span style={{ fontSize: 11, color: 'var(--faint)' }}>Publié le {pubDateStr}</span>}
                  </div>
                </div>
                <button onClick={() => { setDetailModal(null); setSelectedContentId(null); }} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--muted)', flexShrink: 0, lineHeight: 1, padding: 4 }}>×</button>
              </div>

              <div style={{ padding: '20px 26px', display: 'flex', flexDirection: 'column', gap: 24 }}>

                {/* Bloc 1 : Performances réseau */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 12 }}>Performances réseau</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 10 }}>
                    {row.platform === 'IG' && igPost && (() => {
                      const isImage = igPost.type === 'IMAGE';
                      const metrics = [
                        [isImage ? 'Impressions' : 'Vues', isImage ? igPost.reach : igPost.views],
                        ['Likes', igPost.likes], ['Commentaires', igPost.comments],
                        ['Partages', igPost.shares], ['Reach', igPost.reach],
                        ...(!isImage ? [['Sauvegardes', igPost.saved]] as [string, number | null][] : [['Sauvegardes', igPost.saved]] as [string, number | null][]),
                        ...(!isImage && igPost.avgWatchTimeMs ? [['Watch time moy.', `${(igPost.avgWatchTimeMs / 1000).toFixed(1)}s`]] as [string, any][] : []),
                        // `reels_skip_rate` arrive de Meta DÉJÀ en pourcentage (mesuré en
                        // base : de 9,20 à 76,60 sur 253 posts). Le multiplier par 100
                        // affichait « SKIP RATE 7500 % » à l'écran, pendant que l'onglet
                        // Instagram, qui rend le MÊME champ via fmtPct, affichait « 75,0 % ».
                        // Deux rendus d'une même donnée, un seul juste. Aligné sur fmtPct.
                        ...(!isImage && igPost.skipRate != null ? [['Skip rate', fmtPct(igPost.skipRate)]] as [string, any][] : []),
                      ];
                      return metrics.map(([label, val], i) => (
                        <div key={i} style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '10px 12px' }}>
                          <div className="eyebrow-sm" style={{ color: 'var(--muted)', marginBottom: 4 }}>{label}</div>
                          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink)' }}>{val != null ? (typeof val === 'number' ? fmt(val) : val) : '—'}</div>
                        </div>
                      ));
                    })()}
                    {row.platform === 'YT' && ytVideo && (() => {
                      const metrics: [string, any][] = [
                        ['Vues', ytVideo.views], ['Likes', ytVideo.likes], ['Commentaires', ytVideo.comments],
                        ['Partages', ytVideo.shares30d],
                        // Passe par lib/duree.ts comme le reste de la plateforme : cette
                        // ligne refaisait son propre arrondi et pouvait afficher une autre
                        // valeur que la meme donnee ailleurs.
                        //
                        // Denominateur all-time, comme le numerateur. `watchTime30d` porte
                        // un nom trompeur : cote API live il contient de l'ALL-TIME (la
                        // requete par video part de 2020-01-01). Il etait divise par
                        // views30d, les vraies vues sur 30 jours — deux fenetres melangees,
                        // moyenne surevaluee d'autant que la video est ancienne.
                        //
                        // Le `|| 1` etait pire : une video sans vue sur 30 jours affichait
                        // tout son watch time all-time comme s'il venait d'UNE vue. Une
                        // division impossible se dit « — », elle ne s'invente pas
                        // (constate le 2026-08-21). Meme calcul qu'a la ligne ~752.
                        ['Watch time moy.', (() => {
                          const vues = ytVideo.viewsAllTime ?? ytVideo.views30d;
                          return vues > 0 ? dureeDepuisSecondes(ytVideo.watchTime30d * 60 / vues) : null;
                        })()],
                        ['% vu moy.', `${ytVideo.avgViewPct}%`],
                        // Vrai CTR de cette vidéo, plus une valeur codée en dur : cette
                        // case affichait '4,2%' pour TOUTES les vidéos, quelle que soit
                        // leur performance réelle (constaté le 2026-08-20 — les CTR réels
                        // en base vont de 1,7 % à 3,1 %).
                        // La colonne est un ratio (0-1), d'où le ×100.
                        //
                        // ctr null = vidéo publiée avant le démarrage du suivi YouTube :
                        // la RPC get_yt_videos_history l'annule à la lecture, parce que
                        // les impressions d'avant le job ne représentent qu'une fraction
                        // de l'audience réelle. On l'annonce plutôt que d'afficher un
                        // tiret muet, qui se lirait comme un bug.
                        ['CTR miniature', ytVideo.ctr != null ? `${(ytVideo.ctr * 100).toFixed(1).replace('.', ',')}%` : (
                          <span
                            title="YouTube ne fournit les impressions de miniature qu'à partir du démarrage du suivi sur la plateforme. Cette vidéo est antérieure : le CTR calculé sur les rares impressions enregistrées depuis serait trompeur. Les vidéos publiées après le démarrage ont un CTR fiable."
                            style={{ cursor: 'help', color: 'var(--muted)', borderBottom: '1px dotted var(--muted)' }}
                          >
                            N/D
                          </span>
                        )],
                      ];
                      return metrics.map(([label, val], i) => (
                        <div key={i} style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '10px 12px' }}>
                          <div className="eyebrow-sm" style={{ color: 'var(--muted)', marginBottom: 4 }}>{label}</div>
                          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink)' }}>{val != null ? val : '—'}</div>
                        </div>
                      ));
                    })()}
                  </div>

                  {/* Rétention YouTube — non mesurée, donc pas affichée. Le dire
                      explicitement vaut mieux que de laisser un vide : sans ce
                      message, l'absence de courbe se lirait comme un bug. */}
                  {retentionIndisponible && (
                    <div style={{
                      marginTop: 14, padding: '10px 12px', borderRadius: 8,
                      background: 'var(--surface-2)', border: '1px dashed var(--border)',
                      fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.5,
                    }}>
                      <b style={{ color: 'var(--ink-2)' }}>Rétention non disponible.</b>{' '}
                      Elle demande l’API YouTube Analytics, qui n’est pas connectée.
                      Retrouve-la dans YouTube Studio en attendant.
                    </div>
                  )}

                </div>

                {/* Bloc 2 : Performance business */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 12 }}>Performance business</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1px 1fr', gap: 0 }}>
                    {/* Colonne gauche : lien description */}
                    <div style={{ paddingRight: 20 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: BLUE, marginBottom: 12 }}>📎 Via lien description</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                        <FunnelStep label="Clics" value={f1_clics} rate={null} isFirst />
                        <FunnelStep label="Calls bookés" value={f1_calls} rate={r1_clicCall} rateThreshold={25} />
                        <FunnelStep label="Calls honorés" value={f1_honored} rate={r1_callHon} rateThreshold={75} />
                        <FunnelStep label="Closés" value={f1_closed} rate={r1_honClosed} rateThreshold={50} />
                        <FunnelStep label="Revenue" value={f1_revenue} rate={null} />
                      </div>
                    </div>
                    {/* Divider */}
                    <div style={{ background: 'var(--border)', margin: '0 0' }} />
                    {/* Colonne droite : lead magnet */}
                    <div style={{ paddingLeft: 20 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: AMBER, marginBottom: 12 }}>📄 Via lead magnet</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                        <FunnelStep label="Commentaires détectés" value={f2_comments} rate={null} isFirst />
                        <FunnelStep label="LM envoyés" value={f2_sent} rate={r2_sentComm} rateThreshold={80} />
                        <FunnelStep label="Calls bookés" value={f2_calls} rate={r2_callSent} rateThreshold={20} />
                        <FunnelStep label="Calls honorés" value={f2_honored} rate={r2_callHon} rateThreshold={75} />
                        <FunnelStep label="Closés" value={f2_closed} rate={r2_honClosed} rateThreshold={50} />
                        <FunnelStep label="Revenue" value={f2_revenue} rate={null} />
                      </div>
                    </div>
                  </div>
                  {/* Total combiné */}
                  <div style={{ marginTop: 14, padding: '12px 16px', background: 'var(--surface-2)', borderRadius: 9, display: 'flex', justifyContent: 'center', gap: 40, alignItems: 'center' }}>
                    <div style={{ textAlign: 'center' }}>
                      <div className="eyebrow-sm" style={{ color: 'var(--muted)', marginBottom: 3 }}>Calls totaux</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: row.callsBooked > 0 ? GREEN : 'var(--faint)' }}>{row.callsBooked || '—'}</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div className="eyebrow-sm" style={{ color: 'var(--muted)', marginBottom: 3 }}>Closés</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: row.closed > 0 ? GREEN : 'var(--faint)' }}>{row.closed || '—'}</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div className="eyebrow-sm" style={{ color: 'var(--muted)', marginBottom: 3 }}>Revenue total</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: row.revenue > 0 ? GREEN : 'var(--faint)' }}>{row.revenue > 0 ? fmtEur(row.revenue) : '—'}</div>
                    </div>
                  </div>
                </div>

                {/* Bloc 3 : Prospects DM liés */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 12 }}>Prospects DM liés à ce contenu</div>
                  {linkedProspects.length === 0
                    ? <div style={{ fontSize: 12, color: 'var(--faint)', padding: '12px 0' }}>Aucun lien DM généré depuis ce contenu.</div>
                    : (
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr>
                            {['Prospect', 'Canal', 'Lien créé', 'Statut', 'Revenue'].map((h, i) => (
                              <th key={i} className="eyebrow-sm" style={{ textAlign: i >= 3 ? 'right' : 'left', color: 'var(--muted)', padding: '6px 10px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {linkedProspects.map((l: any, i: number) => {
                            const lead = leads.find((ml: any) => ml.id === l.ig_lead_id);
                            // source figée au moment de la création du lien (source_at_creation)
                            // en priorité — fallback sur l'état courant pour les liens créés
                            // avant la migration. Évite qu'un lien historique bascule de canal
                            // à tort si le lead a réinteragi via un autre canal depuis.
                            const linkSource = l.source_at_creation ?? lead?.source;
                            const isOrganic = canalDuDm(linkSource) !== 'sortant';
                            const canal = lead?.leadMagnetSent ? 'LM' : (isOrganic ? 'DM organique' : 'Cold DM');
                            const canalColor2 = lead?.leadMagnetSent ? AMBER : (isOrganic ? '#10B981' : BLUE);
                            const st = getProspectStatus(l);
                            const daysAgo2 = Math.floor((Date.now() - new Date(l.created_at).getTime()) / 86400000);
                            return (
                              <tr key={i} style={{ borderBottom: '1px solid var(--border-soft)' }}
                                onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                                onMouseLeave={e => (e.currentTarget.style.background = '')}>
                                <td style={{ padding: '9px 10px', fontSize: 12, fontWeight: 700 }}>@{l.ig_username}</td>
                                <td style={{ padding: '9px 10px' }}>
                                  <span style={{ fontSize: 10, fontWeight: 700, color: canalColor2, background: canalColor2 + '18', borderRadius: 4, padding: '2px 6px' }}>{canal}</span>
                                </td>
                                <td style={{ padding: '9px 10px', fontSize: 11, color: 'var(--muted)' }}>il y a {daysAgo2}j</td>
                                <td style={{ padding: '9px 10px', textAlign: 'right' }}>
                                  <span style={{ fontSize: 10, fontWeight: 700, color: statusColor[st] || 'var(--muted)', background: (statusColor[st] || 'var(--muted)') + '18', borderRadius: 4, padding: '2px 7px' }}>{statusMap2[st]}</span>
                                </td>
                                <td style={{ padding: '9px 10px', textAlign: 'right', fontSize: 13, fontWeight: 700, color: l.revenue ? GREEN : 'var(--faint)' }}>{l.revenue ? fmtEur(l.revenue) : '—'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                </div>
              </div>
            </div>
          </div>
          </Portal>
        );
      })()}





    </div>
  );
}


// ── Contrôles inline par section (onglet B) ───────────────────────────────────

// ── Fetchers ────────────────────────────────────────────────────────────────

async function fetchApi(url: string) {
  const r = await fetch(url);
  if (!r.ok) return null;
  const d = await r.json();
  return d?.error ? null : d;
}


async function fetchSnapshot(profileId: string | undefined, periodIndex: number, period: number, customWindow?: { start: string; end: string }) {
  if (periodIndex === 0 && !customWindow) return null;
  try {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const targetId = profileId || user.id;

  // Bornes calendaires réelles (semaine lundi-dimanche / mois calendaire) via
  // lib/period.ts — même source que TabShortioB et tous les autres calculateurs de
  // bornes du fichier, élimine la classe de bug de décalage entre deux endroits déjà
  // rencontrée par le passé (cf. bug remonté 2026-07-06).
  // Si customWindow est fourni (mode "Depuis connexion"), il prime — comportement
  // strictement identique à avant sinon (getPeriodWindow).
  // customWindow porte des dates SANS heure ('2026-08-19'), que `new Date` interprète
  // à MINUIT. La borne haute excluait donc toute la journée en cours : un rendez-vous
  // du jour restait invisible dans Mes Stats jusqu'au lendemain, alors que le pipeline
  // et la fiche client le comptaient — c'est ce qui produisait 12 calls ici contre 16
  // ailleurs (constaté le 2026-08-19). On étend la borne à la fin de la journée.
  const { periodStart, periodEnd } = customWindow
    ? {
        periodStart: new Date(customWindow.start),
        periodEnd: new Date(`${customWindow.end}T23:59:59.999`),
      }
    : getPeriodWindow(periodIndex, period === 7 ? 'week' : 'month');

  // parisDateStr (pas toISOString) : les colonnes date/snapshot_date filtrées ci-dessous
  // sont écrites en heure de Paris par le cron (isoDate(), voir docs/cron-poll-leads-
  // dates.md) — periodStart/periodEnd (getPeriodWindow) sont aussi calées sur Paris,
  // toISOString().split('T')[0] donnerait le jour UTC, décalé d'un jour civil autour
  // de 22h-minuit UTC.
  const startDateStr = customWindow ? customWindow.start : parisDateStr(periodStart);
  const endDateStr   = customWindow ? customWindow.end : parisDateStr(periodEnd);

  // Toutes les requêtes en parallèle pour ne pas dépasser 2s
  const [
    snapsRes,
    igPostsRes,
    ytVideosRes,
    callsRes,
    shortioResult,
    shortioClicksRes,
    dealsRes,
    igPeriodeRes,
  ] = await Promise.allSettled([
    // archived_at : les lignes d'un compte Instagram précédent sont archivées à la
    // bascule (app/api/oauth/instagram/callback/route.ts). Sans ce filtre, tout cet
    // écran affiche les courbes de followers/reach/vues d'un compte auquel l'élève
    // n'a plus accès — constaté en base sur deux profils (45 et 31 jours de stats
    // d'un ancien compte). app/api/instagram/stats/route.ts lit la même table pour
    // le même besoin et filtre déjà : c'est ici que l'écart se créait.
    supabase
      .from('analytics_daily_snapshots')
      .select('*')
      .eq('profile_id', targetId)
      .is('archived_at', null)
      .gte('date', startDateStr)
      .lte('date', endDateStr)
      .order('date', { ascending: true }),
    // Agrégé côté DB via get_ig_posts_history (DISTINCT ON post_id, garde le snapshot
    // le plus récent par post sur la fenêtre) — reproduit exactement la dédup faite
    // plus bas côté client, mais ne peut plus jamais être tronqué à 1000 lignes même
    // pour un profil avec beaucoup de posts, contrairement au SELECT * brut (une
    // ligne par post PAR JOUR).
    supabase.rpc('get_ig_posts_history', {
      p_profile_id: targetId,
      p_start_date: startDateStr,
      p_end_date: endDateStr,
    }),
    // Agrégé côté DB via get_yt_videos_history, même raison — analytics_yt_videos_history
    // dépasse déjà 1000 lignes/30j sur le profil de test avant ce fix (troncature
    // silencieuse probable), ne peut plus dépasser 1000 lignes en sortie tant qu'un
    // profil a moins de 1000 vidéos distinctes.
    supabase.rpc('get_yt_videos_history', {
      p_profile_id: targetId,
      p_start_date: startDateStr,
      p_end_date: endDateStr,
    }),
    // Borné sur booked_at (date de RÉSERVATION) comme le reste de la page : cette
    // requête filtrait encore sur scheduled_at, donc un call réservé le 29/08 pour le
    // 02/09 sortait du snapshot d'août alors que le mode live l'y comptait.
    // Repli sur scheduled_at pour les calls importés sans booked_at.
    // CALL_COLUMNS et non '*' : exclut fathom_transcript — cf. lib/supabase/types.ts.
    supabase.from('calls').select(CALL_COLUMNS)
      .eq('coach_id', targetId)
      .or(`and(booked_at.gte.${periodStart.toISOString()},booked_at.lte.${periodEnd.toISOString()}),and(booked_at.is.null,scheduled_at.gte.${periodStart.toISOString()},scheduled_at.lte.${periodEnd.toISOString()})`)
      .in('call_type', CALL_TYPES_VENTE)
      .neq('ignored', true)
      .order('scheduled_at', { ascending: false }),
    fetch(`/api/shortio/snapshots?profileId=${encodeURIComponent(targetId)}&startDate=${startDateStr}&endDate=${endDateStr}`)
      .then(r => r.ok ? r.json() : null)
      .catch(() => null),
    // Agrégé côté DB via get_shortio_clicks_by_url (voir commentaire détaillé sur
    // clicksByUrl plus bas) — jamais de risque de troncature à 1000 lignes, contrairement
    // au rapatriement brut d'une ligne par lien par jour.
    supabase.rpc('get_shortio_clicks_by_url', {
      p_profile_id: targetId,
      p_start_date: startDateStr,
      p_end_date: endDateStr,
    }),
    // Deals signés dans la période — source du CASH CONTRACTÉ, en remplacement de la
    // somme des `calls.revenue`. Un deal peut exister SANS call (upsell, vente hors
    // pipeline) : le sommer depuis les calls le rendait invisible.
    //
    // Découpé sur `signed_at`, volontairement une autre date que les calls : un deal
    // signé ce mois sur un call du mois dernier appartient au cash de ce mois — c'est
    // le mois où l'argent a été engagé. Même règle que useCoachData.
    supabase
      .from('deals')
      // `id` : necessaire au taux de collecte par cohorte, qui rapporte les
      // paiements d'un deal a ce deal precis.
      .select('id, amount_total, status, signed_at, call_id, buyer_name')
      .eq('profile_id', targetId)
      .gte('signed_at', periodStart.toISOString())
      .lte('signed_at', periodEnd.toISOString()),
    // Portee dedupliquee de la periode, lue dans analytics_ig_periodes.
    //
    // Les deux cartes « Abonnes touches » et « Non-abonnes touches » affichaient N/D
    // des qu'on quittait la periode courante : `igHist` ne construisait pas les deux
    // champs, et il est la source de igEff en All-Time comme sur toute periode passee
    // (constate par Chris le 2026-08-31, alors que juin et juillet existaient bien en
    // base).
    //
    // Cette valeur ne se recalcule pas depuis les journalieres : la deduplication de
    // Meta ne s'additionne pas. Elle ne peut venir que de la ligne ecrite par le cron
    // sur cette periode exacte.
    supabase
      .from('analytics_ig_periodes')
      .select('reach_total, reach_abonnes, reach_non_abonnes, abonnes, debut, fin')
      .eq('profile_id', targetId)
      .is('archived_at', null)
      .eq('type', customWindow ? 'all_time' : (period === 7 ? 'semaine' : 'mois'))
      // all_time : une seule ligne vivante par profil, dont le `debut` glisse — on ne
      // le vise donc pas. Les autres types sont identifies par leur date de debut.
      .match(customWindow ? {} : { debut: startDateStr })
      .maybeSingle(),
  ]);

  const snaps = snapsRes.status === 'fulfilled' ? (snapsRes.value.data ?? []) : [];
  if (igPostsRes.status === 'fulfilled' && igPostsRes.value.error) console.error('[PageClientStats] get_ig_posts_history a échoué:', igPostsRes.value.error.message);
  const igPostsRows = igPostsRes.status === 'fulfilled' ? (igPostsRes.value.data ?? []) : [];
  if (ytVideosRes.status === 'fulfilled' && ytVideosRes.value.error) console.error('[PageClientStats] get_yt_videos_history a échoué:', ytVideosRes.value.error.message);
  const ytVideosRows = ytVideosRes.status === 'fulfilled' ? (ytVideosRes.value.data ?? []) : [];
  const shortioData = shortioResult.status === 'fulfilled' ? shortioResult.value : null;
  if (shortioClicksRes.status === 'fulfilled' && shortioClicksRes.value.error) console.error('[PageClientStats] get_shortio_clicks_by_url (fetchSnapshot) a échoué:', shortioClicksRes.value.error.message);
  const shortioClickRows = shortioClicksRes.status === 'fulfilled' ? (shortioClicksRes.value.data ?? []) : [];

  // clicksByUrl / clicksByPath — agrégés côté DB via get_shortio_clicks_by_url (SUM
  // group by short_url/path directement en SQL, une ligne par lien distinct en
  // retour, jamais de risque de troncature à 1000 même avec des centaines de liens).
  const snapClicksByUrl = new Map<string, number>();
  const snapClicksByPath = new Map<string, number>();
  let snapBusinessClicsFromDb = 0;
  for (const row of shortioClickRows as { short_url: string | null; path: string | null; link_category: string | null; clics_humains: number }[]) {
    const clicks = row.clics_humains ?? 0;
    if (row.short_url) {
      const u = row.short_url.toLowerCase();
      snapClicksByUrl.set(u, (snapClicksByUrl.get(u) ?? 0) + clicks);
    }
    if (row.path) {
      const p = row.path.toLowerCase();
      snapClicksByPath.set(p, (snapClicksByPath.get(p) ?? 0) + clicks);
    }
    if (row.link_category && CATS_BUSINESS.has(row.link_category)) {
      snapBusinessClicsFromDb += clicks;
    }
  }

  // Graphique historique / sous-catégories bio-contenu-dm : agrégés côté DB via la
  // même RPC get_shortio_clicks_by_day que fetchSupabaseStats (voir le commentaire
  // détaillé là-bas sur la root cause de troncature à 1000 lignes) — jamais de
  // risque de dépassement, même pour un mois avec beaucoup de liens actifs.
  const snapChartByDate = new Map<string, number>();
  const snapBioIgByDate = new Map<string, number>();
  const snapBioYtByDate = new Map<string, number>();
  const snapContentIgByDate = new Map<string, number>();
  const snapContentYtByDate = new Map<string, number>();
  const snapDmCalendlyByDate = new Map<string, number>();
  const snapDmLmByDate = new Map<string, number>();
  // Story : cette série manquait. `calendly_story` était compté dans « Clics totaux »
  // mais n'appartenait à AUCUN des trois filtres du graphique — « Tous les clics »
  // valait donc strictement plus que Bio + Contenu + DM, sans explication possible
  // (1 clic sur 23 en août 2026, mesuré le 2026-08-28).
  const snapStoryByDate = new Map<string, number>();
  // Jours pour lesquels la collecte Short.io a effectivement tourné.
  //
  // La RPC ne renvoie de lignes que pour les journées présentes dans
  // shortio_link_daily_snapshots. Une journée où le cron n'a pas tourné n'y figure donc
  // pas du tout — et jusqu'ici le graphique affichait quand même un point à 0, rendant
  // une panne de collecte indiscernable d'une journée sans clic. Cas réel mesuré le
  // 2026-08-28 : profil dc6f6aec, 18 et 20 août, aucune ligne en base, courbe à 0.
  // Premier jour de collecte de clics — GLOBAL, jamais borne a la fenetre affichee.
  //
  // `joursCollectesShortio` ne contient que les journees DE LA FENETRE. Sur une
  // periode entierement anterieure au debut de la collecte, cet ensemble est donc
  // VIDE — et le code en concluait « couverture complete », l'exact inverse de la
  // verite. Juin 2026 affichait ainsi « 5 opportunites pour 2 clics : 250 % ».
  // Un ensemble vide dit « on ne sait rien », pas « tout est couvert ».
  const { data: premierJourRows } = await supabase
    .from('shortio_link_daily_snapshots')
    .select('date')
    .eq('profile_id', targetId)
    .order('date', { ascending: true })
    .limit(1);
  const premierJourCollecteShortio: string | null = premierJourRows?.[0]?.date ?? null;

  // Premier clic sur un lien PROSPECT — l'autre journal du compteur « Clics liens
  // Calendly » d'Instagram. Global lui aussi, jamais borne a la fenetre : c'est ce
  // qui permet de savoir qu'une periode n'est PAS couverte, y compris quand elle est
  // entierement anterieure au journal.
  //
  // Instagram additionne deux journaux la ou YouTube n'en a qu'un : un lien Calendly
  // envoye en DM est PERSONNEL (un lien par prospect), donc son clic est attribuable
  // et suivi ici ; un lien de bio ou de description est PARTAGE et anonyme, donc
  // mesure en agregat par Short.io. D'ou « bio + descr. + DM » contre « Bio + Descr. ».
  const { data: premierClicRows } = await supabase
    .from('prospect_events')
    .select('occurred_at')
    .eq('profile_id', targetId)
    .eq('event_type', 'link_clicked')
    .order('occurred_at', { ascending: true })
    .limit(1);
  const premierClicLienProspect: string | null = premierClicRows?.[0]?.occurred_at ?? null;


  const snapJoursCollectes = new Set<string>();
  const { data: snapChartRpcData, error: snapChartRpcError } = await supabase.rpc('get_shortio_clicks_by_day', {
    p_profile_id: targetId,
    p_start_date: startDateStr,
    p_end_date: endDateStr,
  });
  if (snapChartRpcError) console.error('[PageClientStats] get_shortio_clicks_by_day (fetchSnapshot, période courante) a échoué:', snapChartRpcError.message);
  for (const row of (snapChartRpcData ?? []) as { date: string; link_category: string; clics_humains: number }[]) {
    if (row.date) snapJoursCollectes.add(row.date);
    if (!row.date || !row.link_category) continue;
    const clicks = row.clics_humains ?? 0;
    if (CATS_BUSINESS.has(row.link_category)) {
      snapChartByDate.set(row.date, (snapChartByDate.get(row.date) ?? 0) + clicks);
    }
    if (CATS_BIO_IG.has(row.link_category)) snapBioIgByDate.set(row.date, (snapBioIgByDate.get(row.date) ?? 0) + clicks);
    else if (CATS_BIO_YT.has(row.link_category)) snapBioYtByDate.set(row.date, (snapBioYtByDate.get(row.date) ?? 0) + clicks);
    else if (CATS_CONTENT_IG.has(row.link_category)) snapContentIgByDate.set(row.date, (snapContentIgByDate.get(row.date) ?? 0) + clicks);
    else if (CATS_CONTENT_YT.has(row.link_category)) snapContentYtByDate.set(row.date, (snapContentYtByDate.get(row.date) ?? 0) + clicks);
    else if (CATS_DM_CALENDLY.has(row.link_category)) snapDmCalendlyByDate.set(row.date, (snapDmCalendlyByDate.get(row.date) ?? 0) + clicks);
    else if (CATS_DM_LM.has(row.link_category)) snapDmLmByDate.set(row.date, (snapDmLmByDate.get(row.date) ?? 0) + clicks);
    else if (CATS_STORY.has(row.link_category)) snapStoryByDate.set(row.date, (snapStoryByDate.get(row.date) ?? 0) + clicks);
  }
  // Variation "Clics totaux" vs la période équivalente précédente — même principe
  // que fetchSupabaseStats (voir le commentaire détaillé là-bas). Ici periodIndex
  // n'est jamais 0 (cette fonction ne sert que l'historique), donc la précédente
  // est toujours periodIndex + 1, pas un +1 fixe sur periodIndex=0.
  const { periodStart: snapPrevPeriodStart, periodEnd: snapPrevPeriodEnd } = getPeriodWindow(periodIndex + 1, period === 7 ? 'week' : 'month');
  const { data: snapPrevChartRpcData, error: snapPrevChartRpcError } = await supabase.rpc('get_shortio_clicks_by_day', {
    p_profile_id: targetId,
    p_start_date: parisDateStr(snapPrevPeriodStart),
    p_end_date: parisDateStr(snapPrevPeriodEnd),
  });
  if (snapPrevChartRpcError) console.error('[PageClientStats] get_shortio_clicks_by_day (fetchSnapshot, période précédente) a échoué:', snapPrevChartRpcError.message);
  let snapPrevBusinessClics = 0;
  for (const row of (snapPrevChartRpcData ?? []) as { date: string; link_category: string; clics_humains: number }[]) {
    if (row.link_category && CATS_BUSINESS.has(row.link_category)) snapPrevBusinessClics += (row.clics_humains ?? 0);
  }
  // Même convention que fetchSupabaseStats (voir commentaire là-bas) : 0/0 → 0%,
  // 0 → X → +100%, sinon vraie variation. Jamais null.
  const snapTotalClicsChangePct = snapPrevBusinessClics > 0
    ? Math.round(((snapBusinessClicsFromDb - snapPrevBusinessClics) / snapPrevBusinessClics) * 1000) / 10
    : snapBusinessClicsFromDb > 0 ? 100 : 0;

  const snapShortioChartHistory = Array.from(snapChartByDate.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, clicks]) => ({ date, clicks }));
  // Comble tous les jours calendaires de la période (comme fetchSupabaseStats) — sinon
  // un seul jour avec clic isole un point au lieu d'une ligne continue sur le graphique.
  const snapShortioChartHistoryBio: { date: string; ig: number; yt: number }[] = [];
  const snapShortioChartHistoryContent: { date: string; ig: number; yt: number }[] = [];
  const snapShortioChartHistoryDm: { date: string; calendly: number; lm: number }[] = [];
  const snapShortioChartHistoryStory: { date: string; story: number }[] = [];
  {
    let d = periodStart;
    while (d.getTime() <= periodEnd.getTime()) {
      const dateStr = parisDateStr(d);
      snapShortioChartHistoryBio.push({ date: dateStr, ig: snapBioIgByDate.get(dateStr) ?? 0, yt: snapBioYtByDate.get(dateStr) ?? 0 });
      snapShortioChartHistoryContent.push({ date: dateStr, ig: snapContentIgByDate.get(dateStr) ?? 0, yt: snapContentYtByDate.get(dateStr) ?? 0 });
      snapShortioChartHistoryDm.push({ date: dateStr, calendly: snapDmCalendlyByDate.get(dateStr) ?? 0, lm: snapDmLmByDate.get(dateStr) ?? 0 });
      snapShortioChartHistoryStory.push({ date: dateStr, story: snapStoryByDate.get(dateStr) ?? 0 });
      d = parisAddDays(d, 1);
    }
  }

  // Dernier snapshot connu pour les valeurs cumulatives (abonnés Instagram et YouTube,
  // répartitions).
  //
  // ⚠️ `snaps` est trié 'date' ASCENDANT — voir la clause `.order('date', { ascending:
  // true })` de la requête plus haut. Le plus récent est donc le DERNIER élément.
  //
  // Le commentaire qui vivait ici affirmait exactement l'inverse (« trié descendant,
  // donc le plus récent est le premier »), et le code le suivait : `snaps[0]`, c'est-à-
  // dire le plus ANCIEN. Conséquence constatée à l'écran le 2026-08-30 en période
  // All-Time : la carte « Abonnés · total » affichait 253, la valeur du 7 mai, pour un
  // compte qui en a 255. Sur une période courte le défaut est invisible, les deux
  // bornes portant la même valeur — c'est pour ça qu'il a survécu si longtemps.
  //
  // La preuve de la sémantique voulue est dans ce fichier : `fetchYtCurrentPeriodTotals`
  // fait `snaps[snaps.length - 1]` sur une requête triée pareil. Deux copies de la même
  // idée, une seule juste.
  //
  // Un accès positionnel n'a de sens que relativement à un ordre, et cet ordre vit dans
  // la requête, jamais dans le commentaire qui l'accompagne.
  const lastSnap = snaps[snaps.length - 1] ?? null;

  // Le plus récent qui porte RÉELLEMENT une valeur, en remontant depuis la fin.
  // Nécessaire parce que ces colonnes sont creuses : yt_subscribers peut être null les
  // derniers jours (collecte pas encore passée), ig_followers n'est écrit que sur la
  // ligne du jour depuis le 2026-08-30, et les répartitions YouTube ne sont portées que
  // par une ligne sur douze.
  const dernierAvec = (cle: string) => {
    for (let i = snaps.length - 1; i >= 0; i--) {
      if ((snaps[i] as Record<string, unknown>)?.[cle] != null) return snaps[i];
    }
    return null;
  };
  const lastSnapWithYtSubs   = dernierAvec('yt_subscribers');
  const lastSnapAvecAbonnes  = dernierAvec('ig_followers');
  const lastSnapWithTraffic  = dernierAvec('yt_traffic_sources');
  const lastSnapWithDevices  = dernierAvec('yt_devices');
  const lastSnapWithDemo     = dernierAvec('yt_demographics');
  const lastSnapWithKeywords = dernierAvec('yt_search_keywords');

  // ── IG ──────────────────────────────────────────────────────────────────────
  const igReachTotal  = snaps.reduce((s, r) => s + (r.ig_reach ?? 0), 0);
  const igViewsTotal  = snaps.reduce((s, r) => s + (r.ig_views ?? 0), 0);
  const igEngTotal    = snaps.reduce((s, r) => s + (r.ig_accounts_engaged ?? 0), 0);
  const igInterTotal  = snaps.reduce((s, r) => s + (r.ig_total_interactions ?? 0), 0);
  const igTapsTotal   = snaps.reduce((s, r) => s + (r.ig_profile_taps ?? 0), 0);
  const igWCTotal     = snaps.reduce((s, r) => s + (r.ig_website_clicks ?? 0), 0);
  const igFUTotal     = snaps.reduce((s, r) => s + (r.ig_follows_unfollows ?? 0), 0);
  // La colonne ig_lead_count a ete supprimee le 2026-08-22 : elle etait ecrite `null`
  // a quatre endroits du code, jamais alimentee, et faisait doublon avec la table
  // instagram_leads — la seule source reelle, et la plus riche puisqu'elle se filtre
  // par periode, par source et par statut.
  //
  // La documentation Meta confirme qu'aucune metrique Instagram ne fournit un compteur
  // de leads ou de conversations : il n'existait donc aucune source possible pour
  // cette colonne.
  //
  // 0 ici plutot qu'un comptage : ce chemin construit un objet de messagerie a partir
  // des SNAPSHOTS, qui n'ont jamais porte cette information. Le vrai comptage se fait
  // ailleurs, sur instagram_leads.
  const igLeadTotal = 0;

  // Posts IG : dédupliquer par post_id (garder le snapshot le plus récent de la période)
  const latestIgPost = new Map<string, any>();
  for (const row of igPostsRows) {
    if (!latestIgPost.has(row.post_id)) latestIgPost.set(row.post_id, row);
  }
  const igPosts = [...latestIgPost.values()].map((row: any) => ({
    id: row.post_id,
    caption: row.caption ?? '',
    type: row.post_type ?? 'IMAGE',
    thumbnail: row.thumbnail ?? null,
    timestamp: row.published_at ?? row.snapshot_date,
    permalink: row.permalink ?? null,
    likes: row.likes ?? null,
    comments: row.comments ?? null,
    reach: row.reach ?? null,
    saved: row.saves ?? null,
    shares: row.shares ?? null,
    views: row.views ?? null,
    totalInteractions: row.total_interactions ?? null,
    follows: row.follows ?? null,
    profileVisits: row.profile_visits ?? null,
    avgWatchTimeMs: row.avg_watch_time_ms ?? null,
    totalWatchTimeMs: row.total_watch_time_ms ?? null,
    skipRate: row.skip_rate ?? null,
    dureeSec: row.duree_sec != null ? Number(row.duree_sec) : null,
  // Trié explicitement par date de publication décroissante — l'ordre du Map
  // (insertion = ordre de igPostsRows, trié par snapshot_date pas published_at)
  // ne coïncide avec l'ordre de publication qu'en période actuelle (tous les
  // posts partagent le même dernier snapshot_date, et l'API media renvoie déjà
  // les posts triés par date de publication) — en historique cette coïncidence
  // disparaît et l'ordre affiché devient arbitraire.
  })).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // Portee dedupliquee de la periode. Elle ne se calcule PAS a partir des lignes
  // journalieres : la deduplication de Meta ne s'additionne pas d'un jour a l'autre
  // (sur le profil de test, la somme des jours donne 502 la ou la fenetre complete
  // en mesure 207). Elle vient donc de la ligne ecrite par le cron pour cette periode
  // exacte, ou de rien.
  const igPeriode = igPeriodeRes.status === 'fulfilled' ? (igPeriodeRes.value.data as any) : null;

  const igHist = snaps.length > 0 ? {
    reach30d:             igReachTotal,
    views30d:             igViewsTotal,
    // Sans ces deux lignes, les cartes « Abonnes touches » et « Non-abonnes touches »
    // affichaient N/D des qu'on quittait la periode courante — y compris en All-Time,
    // alors que la donnee etait bien en base (constate par Chris le 2026-08-31).
    reachTotalPeriode:         igPeriode?.reach_total ?? null,
    porteeDebut:               igPeriode?.debut ?? null,
    porteeFin:                 igPeriode?.fin ?? null,
    reach28dDedupFollowers:    igPeriode?.reach_abonnes ?? null,
    reach28dDedupNonFollowers: igPeriode?.reach_non_abonnes ?? null,
    // Denominateur de « Abonnes touches », fige avec la periode par le cron : c'est
    // la MOYENNE d'abonnes sur la fenetre, pas le compte d'aujourd'hui. Sur un compte
    // en croissance l'ecart n'est pas neutre — 300 abonnes touches sur un mois passant
    // de 1000 a 1500 donnent 30 % au debut, 24 % en moyenne, 20 % a la fin. Sans lui,
    // un taux ancien serait recalcule sur l'audience actuelle et changerait tout seul.
    abonnesPeriode:            igPeriode?.abonnes ?? null,
    // Le snapshot le plus récent qui porte RÉELLEMENT un nombre d'abonnés, pas
    // simplement le plus récent — même garde que `lastSnapWithYtSubs` plus haut, dont
    // Instagram n'avait jamais hérité.
    //
    // Elle est devenue nécessaire le 2026-08-30 : `ig_followers` est l'état actuel du
    // compte, il n'est donc plus écrit que sur la ligne du JOUR. Une journée comblée
    // par le seul rattrapage (cron arrêté 24 h) n'en porte pas. Avec `lastSnap` brut,
    // une telle journée en tête de période donnait `followers = 0`, donc « Abonnés »
    // à 0 et « Abonnés touchés » à 0 % « sur tes 0 abonnés » — un écran faux, sans
    // aucune erreur nulle part.
    followers:            lastSnapAvecAbonnes?.ig_followers ?? 0,
    following:            lastSnapAvecAbonnes?.ig_following ?? 0,
    accountsEngaged30d:   igEngTotal,
    totalInteractions30d: igInterTotal,
    profileLinksTaps30d:  igTapsTotal,
    websiteClicks30d:     igWCTotal,
    followsUnfollows30d:  igFUTotal,
    chartData: snaps.map(r => ({
      date:              r.date,
      reach:             r.ig_reach ?? 0,
      // Sans ce drapeau, un jour NON COLLECTE etait trace comme un vrai zero sur tout
      // le chemin instantane — periodes passees et All-Time. La route API le produit
      // depuis toujours (stats/route.ts), pas cette reconstruction depuis la base.
      // Un 0 affirme « personne ne t'a vu », un trou dit « on ne sait pas ».
      reachPending:      r.ig_reach == null,
      views:             r.ig_views ?? 0,
      followerCount:     r.ig_followers ?? null,
      accountsEngaged:   r.ig_accounts_engaged ?? 0,
      totalInteractions: r.ig_total_interactions ?? 0,
      websiteClicks:     r.ig_website_clicks ?? 0,
      reachFollower:     r.ig_reach_follower ?? null,
      reachNonFollower:  r.ig_reach_non_follower ?? null,
      // null (pas 0) : collectee seulement depuis le 2026-08-22, les journees
      // anterieures n'ont jamais eu cette mesure. Un 0 affirmerait « personne n'a
      // consulte le profil ce jour-la », ce qui serait faux.
      profileViews:      r.ig_profile_views ?? null,
    })),
    posts: igPosts,
    demographics: lastSnap?.ig_demographics ?? {},
    onlineFollowers: null,
    username: null,
    name: null,
    profilePicture: null,
    mediaCount: igPosts.length,
    biography: '',
    viewsFollowerBreakdown: null,
  } as any as IGStats : null;

  // ── YT ──────────────────────────────────────────────────────────────────────
  const ytViewsTotal   = snaps.reduce((s, r) => s + (r.yt_views ?? 0), 0);
  const ytWatchTotal   = snaps.reduce((s, r) => s + (r.yt_watch_time_min ?? 0), 0);
  const ytSubsGTotal   = snaps.reduce((s, r) => s + (r.yt_subs_gained ?? 0), 0);
  const ytSubsLTotal   = snaps.reduce((s, r) => s + (r.yt_subs_lost ?? 0), 0);
  const ytNetSubsTotal = snaps.reduce((s, r) => s + (r.yt_net_subs ?? 0), 0);
  const ytLikesTotal   = snaps.reduce((s, r) => s + (r.yt_likes ?? 0), 0);
  const ytCommentsTotal= snaps.reduce((s, r) => s + (r.yt_comments ?? 0), 0);
  const ytSharesTotal  = snaps.reduce((s, r) => s + (r.yt_shares ?? 0), 0);

  // Vidéos YT : dédupliquer par video_id (garder le snapshot le plus récent)
  const latestYtVideo = new Map<string, any>();
  for (const row of ytVideosRows) {
    if (!latestYtVideo.has(row.video_id)) latestYtVideo.set(row.video_id, row);
  }
  const ytVideos = [...latestYtVideo.values()].map((row: any) => ({
    id: row.video_id,
    title: row.title ?? '',
    thumbnail: row.thumbnail ?? null,
    publishedAt: row.published_at ?? row.snapshot_date,
    // Duree formatee depuis les secondes stockees. Elle valait '' en dur : la colonne
    // « Duree » du tableau restait vide, et l'axe de la courbe de retention basculait en
    // pourcentage faute de duree totale — la meme courbe changeait donc d'unite entre la
    // periode courante et une periode passee. Reste '' tant que la colonne est vide
    // (lignes collectees avant le 2026-08-21), ce qui redonne l'ancien comportement
    // plutot qu'une duree fausse.
    duration: row.duration_sec != null ? formaterDureeVideo(row.duration_sec) : '',
    isShort: row.is_short ?? false,
    views: row.views ?? 0,
    likes: row.likes ?? 0,
    comments: row.comments ?? 0,
    views30d: row.views_period ?? 0,
    watchTime30d: row.watch_time_min ?? 0,
    avgViewPct: row.avg_view_pct ?? 0,
    likes30d: row.likes ?? 0,
    comments30d: row.comments ?? 0,
    shares30d: row.shares ?? 0,
    subsGained30d: row.subs_gained ?? 0,
    subsGainedTotal: row.subs_gained ?? 0,
    subsLostTotal: 0,
    ctr: row.ctr ?? null,
    url: row.url ?? `https://youtube.com/watch?v=${row.video_id}`,
  }));

  const ytHist = snaps.length > 0 ? {
    views30d:           ytViewsTotal,
    watchTime30d:       ytWatchTotal,
    subsGained30d:      ytSubsGTotal,
    subsLost30d:        ytSubsLTotal,
    netSubs30d:         ytNetSubsTotal,
    subscribers:        lastSnapWithYtSubs?.yt_subscribers ?? 0,
    likes30d:           ytLikesTotal,
    comments30d:        ytCommentsTotal,
    shares30d:          ytSharesTotal,
    avgViewDurationSec: (snaps.find(r => r.yt_avg_view_duration_sec != null))?.yt_avg_view_duration_sec ?? 0,
    chartData: snaps.map(r => ({
      date:       r.date,
      views:      r.yt_views ?? 0,
      // Meme defaut cote YouTube, et il n'existait AUCUN drapeau equivalent : la Vue
      // generale deduisait « en attente » de l'absence totale de ligne. Or une ligne
      // peut exister avec des vues nulles — 31 journees dans ce cas sur le profil de
      // test au 2026-08-31, toutes tracees a zero.
      viewsPending: r.yt_views == null,
      watchTime:  r.yt_watch_time_min ?? 0,
      subsGained: r.yt_subs_gained ?? 0,
      subsLost:   r.yt_subs_lost ?? 0,
      netSubs:    r.yt_net_subs ?? 0,
      likes:      r.yt_likes ?? 0,
      comments:   r.yt_comments ?? 0,
      shares:     r.yt_shares ?? 0,
      // ?? null et non ?? 0 : un format sans vue ce jour-là n'a pas de durée moyenne,
      // et un 0 se lirait « regardé 0 seconde » au lieu de « pas de vue sur ce format ».
      // Total d'abonnés du jour — équivalent YouTube de followerCount côté Instagram.
      // Sert la courbe de la carte « Abonnés », qui doit suivre le TOTAL et non les
      // abonnés gagnés (voir le commentaire sur la série plus bas).
      subscribers: r.yt_subscribers ?? null,
      avgViewDurationSec: r.yt_avg_view_duration_sec ?? null,
      watchTimeShorts: r.yt_watch_time_shorts_min ?? null,
      watchTimeLong:   r.yt_watch_time_long_min ?? null,
      avgDurationShorts: r.yt_avg_duration_shorts_sec ?? null,
      avgDurationLong:   r.yt_avg_duration_long_sec ?? null,
      viewsShorts:       r.yt_views_shorts ?? null,
      viewsLong:         r.yt_views_long ?? null,
    })),
    videos: ytVideos,
    trafficSources: lastSnapWithTraffic?.yt_traffic_sources ?? [],
    devices:         lastSnapWithDevices?.yt_devices ?? [],
    demographics:    lastSnapWithDemo?.yt_demographics ?? [],
    searchKeywords:  lastSnapWithKeywords?.yt_search_keywords ?? [],
    channelName: null,
    channelThumbnail: null,
    totalViews: 0,
    videoCount: ytVideos.length,
  } as any as YTStats : null;

  // ── Shortio ─────────────────────────────────────────────────────────────────
  const shortioHist: ShortioStats | null = shortioData?.clicsHumains != null
    ? (shortioData as ShortioStats)
    : null;

  // ── Cash ────────────────────────────────────────────────────────────────────
  // Rien ici n'est conditionne a `snaps.length > 0` : l'argent vient de `deal_payments`,
  // pas de `analytics_daily_snapshots`. Un mois sans snapshot Instagram/YouTube — donc
  // sans collecte de contenu — rendait tout l'onglet Revenus muet (« Connecte ton compte
  // Stripe ») alors que des ventes y avaient bien ete encaissees. Le cash ne depend pas
  // de la collecte des reseaux sociaux.
  //
  // Deux RPC bornées remplacent la lecture ligne à ligne des paiements — voir la
  // migration 20260830190000 et le commentaire du chemin live (fetchSupabaseStats).
  const fenetreRpc = { p_profile_id: targetId, p_start: periodStart.toISOString(), p_end: periodEnd.toISOString() };
  const [joursRpc, ventesRpc] = await Promise.all([
    supabase.rpc('get_encaissements_par_jour', fenetreRpc),
    supabase.rpc('get_ventes_de_la_periode', fenetreRpc),
  ]);
  if (joursRpc.error) console.error('[PageClientStats] get_encaissements_par_jour (snapshot) a échoué:', joursRpc.error.message);
  if (ventesRpc.error) console.error('[PageClientStats] get_ventes_de_la_periode (snapshot) a échoué:', ventesRpc.error.message);
  const encaissementsParJour = joursRpc.data ?? [];
  const cashParVente = ventesRpc.data ?? [];

  const dealsHistRows: any[] = dealsRes.status === 'fulfilled' ? (dealsRes.value.data ?? []) : [];

  // ── Messages IG (scalaires depuis snapshots) ─────────────────────────────────
  const msgsHist = snaps.length > 0 ? {
    totalThreads30d: igLeadTotal,
    // Le taux de reponse aux DM n'existe PAS en historique, et c'est desormais explicite
    // plutot qu'accidentel : il se lisait dans `ig_response_rate`, supprimee le
    // 2026-09-01 — vide sur 100 % de ses lignes depuis l'origine, ecrite `null` en dur
    // par les trois chemins de collecte. Le signal « Taux de reponse DM bas » ne se
    // declenche donc que sur la periode courante, servie par /api/instagram/messages,
    // qui compte de vraies conversations. `null` et non `0` : un trou dit « on ne sait
    // pas », un zero affirmerait « personne n'a repondu ».
    responseRate:    null,
    repliedThreads:  null,
    leadCount:       igLeadTotal,
    keywordCounts:   {},
    threads:         [],
  } : null;

  return {
    igHist,
    ytHist,
    shortioHist,
    callsHist: callsRes.status === 'fulfilled' ? (callsRes.value.data ?? []) : [],
    dealsHist: dealsHistRows,
    encaissementsParJour,
    cashParVente,
    msgsHist,
    snapshotDate: endDateStr,
    clicksByUrl: snapClicksByUrl,
    clicksByPath: snapClicksByPath,
    businessClicsFromDb: snapBusinessClicsFromDb,
    totalClicsChangePct: snapTotalClicsChangePct,
    shortioChartHistory: snapShortioChartHistory,
    joursCollectesShortio: snapJoursCollectes,
    premierJourCollecteShortio,
    premierClicLienProspect,
    shortioChartHistoryBio: snapShortioChartHistoryBio,
    shortioChartHistoryContent: snapShortioChartHistoryContent,
    shortioChartHistoryDm: snapShortioChartHistoryDm,
    shortioChartHistoryStory: snapShortioChartHistoryStory,
  };
  } catch (e) {
    return null;
  }
}

// Totaux YouTube (Likes/Comments/Vues/Watch time/Subs) de la PÉRIODE COURANTE, depuis
// analytics_daily_snapshots borné par getPeriodWindow(0, ...) — même logique que
// fetchSnapshot pour les périodes passées, pour que la navigation semaine/mois reste
// cohérente même sur la période en cours (au lieu du rolling 30j UTC de l'appel API
// direct /api/youtube/stats, qui ignorait le calendrier de période affiché).
async function fetchYtCurrentPeriodTotals(profileId: string | undefined, period: number) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const targetId = profileId || user.id;

    const { periodStart, periodEnd } = getPeriodWindow(0, period === 7 ? 'week' : 'month');
    const startDateStr = parisDateStr(periodStart);
    const endDateStr = parisDateStr(periodEnd);

    const { data: snaps } = await supabase
      .from('analytics_daily_snapshots')
      .select('date, yt_views, yt_watch_time_min, yt_subs_gained, yt_subs_lost, yt_net_subs, yt_likes, yt_comments, yt_shares, yt_subscribers, yt_avg_view_duration_sec')
      .eq('profile_id', targetId)
      .gte('date', startDateStr)
      .lte('date', endDateStr)
      .order('date', { ascending: true });

    if (!snaps || snaps.length === 0) return null;

    const lastSnap = snaps[snaps.length - 1];
    return {
      views30d: snaps.reduce((s, r) => s + (r.yt_views ?? 0), 0),
      watchTime30d: snaps.reduce((s, r) => s + (r.yt_watch_time_min ?? 0), 0),
      subsGained30d: snaps.reduce((s, r) => s + (r.yt_subs_gained ?? 0), 0),
      subsLost30d: snaps.reduce((s, r) => s + (r.yt_subs_lost ?? 0), 0),
      netSubs30d: snaps.reduce((s, r) => s + (r.yt_net_subs ?? 0), 0),
      likes30d: snaps.reduce((s, r) => s + (r.yt_likes ?? 0), 0),
      comments30d: snaps.reduce((s, r) => s + (r.yt_comments ?? 0), 0),
      shares30d: snaps.reduce((s, r) => s + (r.yt_shares ?? 0), 0),
      subscribers: lastSnap?.yt_subscribers ?? 0,
      avgViewDurationSec: lastSnap?.yt_avg_view_duration_sec ?? 0,
    };
  } catch {
    return null;
  }
}

async function fetchIgCurrentPeriodTotals(profileId: string | undefined, period: number) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const targetId = profileId || user.id;

    const { periodStart, periodEnd } = getPeriodWindow(0, period === 7 ? 'week' : 'month');
    const startDateStr = parisDateStr(periodStart);
    const endDateStr = parisDateStr(periodEnd);

    const { data: snaps } = await supabase
      .from('analytics_daily_snapshots')
      .select('date, ig_reach, ig_views')
      .eq('profile_id', targetId)
      // Même filtre que fetchSnapshot et que app/api/instagram/stats/route.ts :
      // sans lui, reach30d/views30d agrègent les chiffres d'un compte précédent.
      .is('archived_at', null)
      .gte('date', startDateStr)
      .lte('date', endDateStr)
      .order('date', { ascending: true });

    if (!snaps || snaps.length === 0) return null;

    return {
      reach30d: snaps.reduce((s, r) => s + (r.ig_reach ?? 0), 0),
      views30d: snaps.reduce((s, r) => s + (r.ig_views ?? 0), 0),
    };
  } catch {
    return null;
  }
}

// Pagine une query Supabase par tranches de pageSize lignes (défaut 1000, le plafond
// PostgREST) — évite qu'une requête sans .limit()/.range() se fasse tronquer
// silencieusement dès que le volume dépasse ce plafond. Pattern dupliqué depuis
// app/api/shortio/stats/route.ts (aucun module partagé entre API routes et
// composants client dans ce repo), avec log d'erreur ajouté.
async function fetchAllPages<T>(
  queryBuilder: () => any,
  pageSize = 1000
): Promise<T[]> {
  const allRows: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await queryBuilder().range(from, from + pageSize - 1);
    if (error) {
      console.error('[PageClientStats] fetchAllPages a échoué:', error.message);
      break;
    }
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return allRows;
}

async function fetchSupabaseStats(profileId?: string, period: number = 30, customWindow?: { start: string; end: string }) {
  try {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const targetId = profileId || user.id;

  // integrations_ready_at : référence unique « depuis quand le pipeline Momentum de cet
  // élève est opérationnel », posée par trigger quand les 7 intégrations obligatoires
  // sont connectées pour la première fois. Sert ici aux CALLS, aux LEADS et à la fenêtre
  // All-Time — les trois, pour que cette page compte le même périmètre que la fiche
  // client coach et le pipeline.
  //
  // onboarding_completed_at (date du choix de mot de passe) n'est PLUS lu : la doc
  // dédiée dit explicitement de ne jamais s'en servir comme filtre de date pour des
  // calls ou des leads. Il servait pourtant de borne aux calls de cette page, ce qui
  // produisait un périmètre différent de la fiche client coach.
  //
  // Voir docs/integrations-ready-at-vs-onboarding-completed-at.md — ce document décrit
  // déjà le bug « deux écrans, deux chiffres » que cette page reproduisait encore.
  const { data: clientRow } = await supabase.from('clients').select('integrations_ready_at').eq('profile_id', targetId).maybeSingle();
  const integrationsReadyAt: string | null = clientRow?.integrations_ready_at ?? null;

  // ── shortioChartHistory* (BUG RÉSOLU 2026-07-21, à relire avant de toucher à ce
  // bloc ou à re-signaler "des clics manquent") ──
  //
  // SYMPTÔME OBSERVÉ : dans Business micro, "Tous les clics" ET les 3 filtres
  // Bio/Contenu/DM affichaient 0 pour un clic pourtant confirmé en base (table
  // shortio_link_daily_snapshots, détecté par Short.io, ex. 2026-07-08). Un clic
  // plus ancien (2026-06-20) restait lui visible, puis a disparu à son tour le
  // lendemain sans aucune modification de code ni de donnée — signe d'une fenêtre
  // qui bouge dans le temps, pas d'un bug de logique de filtrage.
  //
  // ROOT CAUSE : la requête shortio_link_daily_snapshots (rapatriement des lignes
  // BRUTES côté client, une ligne par lien par jour) n'avait ni .limit() ni filtre
  // de date suffisant. Supabase/PostgREST applique une limite PAR DÉFAUT de 1000
  // lignes par requête, silencieusement (pas d'erreur, pas de warning). Avec
  // .order('date', ascending: true), les 1000 lignes renvoyées sont les plus
  // ANCIENNES ; tout ce qui dépasse (donc les clics les plus RÉCENTS, ceux qu'on
  // regarde le plus) est tronqué. Piège découvert en 2 temps :
  //   1er correctif (insuffisant) : borner à une fenêtre de 14 mois. Semblait
  //   logique mais n'a rien résolu — CE CLIENT A ~51 LIGNES PAR JOUR (1 par lien
  //   actif tracké), donc 1000 lignes ≈ 20 JOURS seulement. Aucune fenêtre de dates
  //   assez large pour couvrir un mois de navigation ne peut rester sous 1000
  //   lignes brutes — le problème n'était pas "trop de mois", mais "trop de lignes
  //   par jour". Ce volume par jour ne fera que croître avec le nombre de liens
  //   trackés (LM, contenus, DM) et le nombre de clients sur la plateforme.
  //
  // FIX RÉEL : agrégation côté BASE DE DONNÉES via la fonction Postgres RPC
  // get_shortio_clicks_by_day(p_profile_id, p_start_date, p_end_date) — fait le
  // SUM(human_clicks) GROUP BY date, link_category directement en SQL, renvoie au
  // maximum quelques dizaines de lignes (1 par jour × par catégorie, jamais 1 par
  // lien), donc ne peut structurellement plus jamais dépasser 1000 lignes, quel que
  // soit le nombre de liens créés. Migration : add_get_shortio_clicks_by_day_rpc
  // (Supabase project nvjgwtetyuatnkjihmtw), SECURITY DEFINER + filtre explicite
  // sur p_profile_id dans la fonction (obligatoire : SECURITY DEFINER bypass la RLS
  // de la table sous-jacente, donc pas de filtre = fuite cross-tenant).
  //
  // SI CE BUG REVIENT (clics présents en base mais absents du graphique) : vérifier
  // d'abord que get_shortio_clicks_by_day existe toujours et est appelée (pas la
  // requête brute .from('shortio_link_daily_snapshots') réintroduite par erreur).

  // Bornes calendaires réelles (semaine lundi-dimanche / mois calendaire) — même
  // source que fetchSnapshot/TabShortioB, pour que "Bio IG" et le reste du
  // breakdown Business micro suivent la même semaine/mois que tous les autres
  // graphiques plutôt qu'une fenêtre glissante indépendante (cf. bug remonté
  // "bio calendly ig" 2026-07-06).
  // Si customWindow est fourni (mode "Depuis connexion"), il prime — comportement
  // strictement identique à avant sinon (getPeriodWindow(0, ...)).
  const { periodStart: _periodStart, periodEnd: _periodEnd } = getPeriodWindow(0, period === 7 ? 'week' : 'month');
  const since30d = customWindow ? customWindow.start : parisDateStr(_periodStart);
  const until30d = customWindow ? customWindow.end : parisDateStr(_periodEnd);

  const [leadsRows, lmRes, calendlyRes, lmHistoryRows, prospectLinksRows, contentLinksRes, lmClickedEvents, linkClickedEvents, hookRepliedEvents, lmRequestedEvents] = await Promise.all([
    // Paginé (fetchAllPages) — plafond fixe .limit(500) auparavant, trop facile à
    // atteindre sur le mode "Depuis connexion" (jusqu'à ~1 an) pour un profil actif.
    // not_a_lead / archived_at : mêmes filtres que lib/salesCallStats.ts (fetchIgLeadsCount)
    // et app/api/client/pipeline/route.ts. Sans eux, un prospect que le coach a
    // explicitement marqué "Non, pas un lead" depuis le Pipeline continuait d'être compté
    // dans toutes les cartes de Mes Stats — observé sur un cold DM marqué "pas un lead"
    // qui gonflait "Réponses accroche LM DM" à 133 % (4 réponses / 3 LM envoyés).
    fetchAllPages<any>(() =>
      supabase.from('instagram_leads')
        .select('id, ig_user_id, ig_username, media_id, media_permalink, keyword_matched, lead_magnet_sent, hook_replied, hook_replied_at, tracking_link, detected_at, source')
        .eq('profile_id', targetId)
        .is('archived_at', null)
        .eq('not_a_lead', false)
        .order('detected_at', { ascending: false })
    ),
    supabase.from('lead_magnets')
      .select('id, name, keyword, url').eq('profile_id', targetId).order('created_at', { ascending: true }),
    supabase.from('integrations')
      .select('metadata').eq('profile_id', targetId).eq('provider', 'calendly').maybeSingle(),
    // Historique complet LM — pour les stats par keyword (1 ligne par interaction, pas par prospect).
    // Paginé (fetchAllPages) — plafond fixe .limit(2000) auparavant, même raison.
    fetchAllPages<any>(() =>
      supabase.from('instagram_lead_lm_history')
        .select('ig_user_id, keyword_matched, media_id, lead_magnet_sent, detected_at')
        .eq('profile_id', targetId)
        // Cette table est archivée à la bascule de compte, comme instagram_leads
        // juste au-dessus — et app/api/client/pipeline/route.ts la filtre déjà. Sans
        // ce filtre, les réclamations LM d'un ancien compte sont comptées face à des
        // leads qui, eux, sont filtrés : c'est le ratio > 100 % décrit plus haut.
        .is('archived_at', null)
    ),
    // Liens Calendly envoyés par prospect — source de vérité pour la table Performance LM.
    // Paginé (fetchAllPages) — plafond fixe .limit(500) auparavant, même raison.
    fetchAllPages<any>(() =>
      supabase.from('prospect_links')
        // `content_id` : le repli d'attribution LEGITIME quand un call n'a pas
        // d'`utm_content` (liens crees avant le correctif du 19/08). Pose a la creation
        // du lien et jamais reecrit — contrairement a `instagram_leads.media_id`.
        .select('id, ig_lead_id, ig_username, short_url, content_id, calendly_link_sent, calendly_link_sent_at, first_click_at, created_at, keyword_matched, source_at_creation')
        // archived_at : même filtre que instagram_leads plus haut, sinon la table
        // Performance LM et l'attribution comptent des prospects d'un ancien compte.
        .eq('profile_id', targetId).is('archived_at', null)
        .order('created_at', { ascending: false })
    ),
    // content_links : contient lm_id + lm_keyword (mot-clé custom par contenu, peut différer du keyword principal du LM)
    supabase.from('content_links')
      .select('lm_id, lm_keyword')
      .eq('profile_id', targetId)
      // Sans archived_at, les mots-clés configurés sur les posts d'un ancien compte
      // apparaissent dans les stats du compte courant (app/api/client/content-links
      // filtre déjà pour le même besoin).
      .is('archived_at', null)
      .not('lm_id', 'is', null)
      .not('lm_keyword', 'is', null),
    // Clics LM réels (postérieurs à detected_at du lead) — même source que le pipeline.
    // Paginé (fetchAllPages) : ni .limit() ni borne de date ici, le volume croît avec
    // le temps et le nombre de leads, pas de plafond fixe sûr à poser.
    fetchAllPages<{ ig_lead_id: string | null; occurred_at: string }>(() =>
      supabase.from('prospect_events')
        .select('ig_lead_id, occurred_at')
        .eq('profile_id', targetId)
        .eq('event_type', 'lm_clicked')
        .not('ig_lead_id', 'is', null)
    ),
    // Clics Calendly réels — même source que le pipeline (link_clicked), même raison de pagination.
    fetchAllPages<{ ig_lead_id: string | null; occurred_at: string }>(() =>
      supabase.from('prospect_events')
        .select('ig_lead_id, occurred_at')
        .eq('profile_id', targetId)
        .eq('event_type', 'link_clicked')
        .not('ig_lead_id', 'is', null)
    ),
    // Réponses au message d'accroche — le JOURNAL, pas le drapeau de la fiche.
    //
    // `instagram_leads.hook_replied` est un booléen sur une ligne unique par personne,
    // et il est remis à `false` par une réponse de story ou un Cold DM. Il décrit donc
    // un ÉTAT COURANT, ce dont le pipeline a besoin, et il est faux pour un compteur
    // cumulé. Mesure du 2026-08-29 : ce journal porte 6 réponses là où les fiches n'en
    // montraient que 4, et incogniton.734 en a 3 à lui seul (25/07, 28/07, 30/07).
    //
    // PAS de filtre `ig_lead_id is not null`, contrairement aux deux requêtes
    // au-dessus : 2 de ces 6 réponses ont un `ig_lead_id` nul. Le rattachement se fait
    // sur `prospect_key` (le pseudo en minuscules).
    fetchAllPages<{ prospect_key: string | null; occurred_at: string; metadata: any }>(() =>
      supabase.from('prospect_events')
        // `metadata.media_id` : le contenu FIGE au moment de la reponse par le webhook.
        // Quand il est la, l'attribution est une MESURE et non une reconstruction.
        .select('prospect_key, occurred_at, metadata')
        .eq('profile_id', targetId)
        .eq('event_type', 'hook_replied')
    ),
    // « LM reclames » — l'appui sur le BOUTON du DM1, ecrit par
    // `instagram-webhook-processor.ts`. Ce n'est PAS l'envoi du lead magnet : seuls 30 a
    // 50 % des gens appuient, et l'ecart entre les deux mesure la qualite du DM1. Hors
    // chaine a l'ecran pour cette raison — repondre au message d'accroche n'exige pas
    // d'avoir appuye.
    fetchAllPages<{ ig_lead_id: string | null; occurred_at: string }>(() =>
      supabase.from('prospect_events')
        .select('ig_lead_id, occurred_at')
        .eq('profile_id', targetId)
        .eq('event_type', 'lm_link_requested')
    ),
  ]);

  // instagram_leads/instagram_lead_lm_history/prospect_links sont désormais paginées
  // (fetchAllPages) — ne peuvent structurellement plus être tronquées, les warnings
  // de plafond fixe (500/2000 lignes) précédemment ici sont donc devenus obsolètes
  // et retirés (2026-07-27, chantier "Depuis connexion").

  // Graphique historique clics Short.io — agrégé côté DB via get_shortio_clicks_by_day.
  // FENÊTRE VOLONTAIREMENT COURTE (3 mois, pas 24) — à relire avant d'agrandir cette
  // valeur : l'agrégation par jour×catégorie n'est PAS bornée à "quelques dizaines de
  // lignes" comme on pourrait le supposer — dans le pire cas (toutes les ~9 catégories
  // actives chaque jour, déjà observé en prod), elle renvoie jusqu'à nb_jours × 9
  // lignes. Une fenêtre de 24 mois (730 jours) donnerait jusqu'à 6570 lignes — 6,5×
  // la limite de 1000 Supabase/PostgREST — et retomberait dans EXACTEMENT le même bug
  // de troncature que celui corrigé ce jour-là, juste après ~3-4 mois d'activité
  // soutenue au lieu de ~20 jours. Vérifié en SQL direct (2026-07-21) avant correction.
  // 3 mois reste très largement sous la limite même si le volume de catégories double
  // (jusqu'à ~90 jours × 9 = 810 lignes, contre 1000). Cette fenêtre ne limite QUE le
  // graphique de la période courante — la navigation vers une période plus ancienne
  // (periodIndex > 0) passe par fetchSnapshot, qui appelle toujours la même RPC bornée
  // précisément sur le mois/semaine consulté, jamais concerné par cette fenêtre : un
  // client inscrit depuis 5 mois retrouve normalement ses données en naviguant en
  // arrière, quelle que soit la valeur choisie ici.
  const shortioHistoryFloor = parisDateStr(new Date(Date.now() - 3 * 30 * 86400000));
  const shortioChartHistoryRpc = await supabase.rpc('get_shortio_clicks_by_day', {
    p_profile_id: targetId,
    p_start_date: shortioHistoryFloor,
    p_end_date: parisDateStr(new Date()),
  });
  if (shortioChartHistoryRpc.error) console.error('[PageClientStats] get_shortio_clicks_by_day (fetchSupabaseStats) a échoué:', shortioChartHistoryRpc.error.message);

  // Dans la table calls, coach_id = profile_id de l'élève (leadsProfileId dans le sync Calendly)
  const callsOwnerId = profileId ?? user.id;
  // Paginé (fetchAllPages) — plafond fixe .limit(500) auparavant, silencieusement
  // tronqué au-delà (11 calls Calendly aujourd'hui, mais le mode "Depuis connexion"
  // cumule tout l'historique d'un élève sur plusieurs années — même raison que les
  // autres .limit() fixes déjà migrés ci-dessus).
  const callsRawRows = await fetchAllPages<any>(() => {
    // CALL_COLUMNS et non '*' : exclut fathom_transcript — cf. lib/supabase/types.ts.
    const q = supabase.from('calls').select(CALL_COLUMNS)
      .eq('coach_id', callsOwnerId)
      .neq('ignored', true)
      .in('call_type', CALL_TYPES_VENTE)
      .order('scheduled_at', { ascending: false });
    // Même borne que la fiche client coach (app/api/coach/clients/[id]/sales-calls)
    // et le pipeline : integrations_ready_at, filtré sur booked_at (date de RÉSERVATION)
    // avec repli sur scheduled_at quand booked_at manque.
    //
    // Deux corrections d'un coup, toutes deux sources d'écarts entre écrans :
    // - la référence était onboarding_completed_at (08/06 contre 09/06 sur le profil
    //   de test) au lieu de integrations_ready_at ;
    // - le filtre portait sur scheduled_at, donc un call RÉSERVÉ avant la mise en
    //   route mais PLANIFIÉ après entrait ici et pas dans la fiche client.
    // Constaté le 2026-08-19 en comparant les trois écrans.
    return integrationsReadyAt
      ? q.or(`booked_at.gte.${integrationsReadyAt},and(booked_at.is.null,scheduled_at.gte.${integrationsReadyAt})`)
      : q;
  });
  const callsRes = { data: callsRawRows };

  // Deals — source du CASH CONTRACTÉ, en remplacement de la somme des `calls.revenue`.
  // Un deal peut exister SANS call (upsell, vente hors pipeline) : le sommer depuis les
  // calls le rendait invisible. Même périmètre que les calls (integrations_ready_at),
  // mais découpé sur `signed_at` : un deal signé ce mois sur un call du mois dernier
  // appartient au cash de ce mois. Voir docs/perimetre-stats-referentiel.md.
  const dealsRows = await fetchAllPages<any>(() => {
    const q = supabase.from('deals')
      .select('id, amount_total, status, signed_at, call_id, buyer_name')
      .eq('profile_id', targetId)
      .order('signed_at', { ascending: false });
    return integrationsReadyAt ? q.gte('signed_at', integrationsReadyAt) : q;
  });

  // Cash collecte de la periode COURANTE — meme source et meme regle que les periodes
  // passees (fetchSnapshot, qui lit deja `deal_payments`).
  //
  // ── Pourquoi ce changement ────────────────────────────────────────────────────
  // La periode courante lisait `/api/stripe/client-data`, c'est-a-dire l'API Stripe en
  // direct : `charges.list({ limit: 50 })` puis `.slice(0, 10)`, sans aucune borne de
  // date. Trois consequences mesurees le 2026-08-30 sur le profil de test :
  //
  //   • le total ne comptait que les DIX derniers encaissements, tous mois confondus —
  //     au-dela, le cash collecte sous-comptait en silence, et le taux de collecte avec ;
  //   • il comptait des encaissements Stripe rattaches a AUCUNE vente (60 EUR de
  //     paiements de test) et ignorait un reglement hors Stripe enregistre a la main
  //     (500 EUR), alors que le bloc « Cash encaisse par origine » de la meme page, lui,
  //     lit la base : 2 360 EUR affiches en carte contre 2 800 EUR juste en dessous ;
  //   • tout l'onglet disparaissait derriere « Connecte ton compte Stripe » des que
  //     l'appel echouait, alors que le compte etait connecte.
  //
  // La regle « on ne compte que les paiements rattaches a une vente » etait deja ecrite
  // et datee (19/08/2026) dans le chemin des periodes passees. Elle n'avait simplement
  // jamais ete portee ici. Les deux chemins lisent desormais la meme table.
  //
  // `paid_at` non nul : c'est la date qui borne la periode, et les lignes de
  // remboursement/litige la portent a NULL par conception (webhook Stripe,
  // recordPayment). Les exclure explicitement vaut mieux que de les perdre au detour
  // d'un `gte`.
  // ⚠️ Ce bloc rapatriait TOUS les `deal_payments` depuis integrations_ready_at, sans
  // borne haute, a CHAQUE ouverture de Mes Stats et quel que soit l'onglet regarde.
  // Aujourd'hui 5 lignes. A 20 eleves vendant 20 fois par mois en 3x, ~1 500 lignes par
  // eleve apres deux ans, telechargees a chaque chargement : rien ne plante, la page
  // ralentit un peu plus chaque mois sans jamais rien signaler.
  //
  // Deux RPC bornees le remplacent (migration 20260830190000). Elles ne renvoient que
  // des SOMMES par statut, jamais un net : la regle du cash reste ecrite une seule fois,
  // dans lib/dealCash.ts, dont la copie Deno est tenue identique par un test de parite.
  //
  //   par jour  -> une ligne par journee ou de l'argent a bouge, groupee en heure de
  //                Paris cote base. Sert la carte « Cash collecte », son compteur et les
  //                barres. La reponse ne grossit plus avec le nombre d'echeances.
  //   par vente -> une ligne par vente signee dans la fenetre, portant les sommes de
  //                TOUS ses paiements quelle que soit leur date — la cohorte. Remplace
  //                le decoupage en paquets de 100 identifiants, qui faisait autant
  //                d'allers-retours SEQUENTIELS en All-Time.
  //
  // `deals` reste lu separement et plus largement : `callsEff` a besoin du montant des
  // ventes de TOUS les calls affiches, pas seulement de celles de la periode courante.
  // Le borner ici ferait disparaitre le revenu des calls des mois precedents sur les
  // onglets Funnel et Business micro.
  const fenetreRpc = {
    p_profile_id: targetId,
    p_start: (customWindow ? new Date(customWindow.start) : _periodStart).toISOString(),
    p_end: (customWindow ? new Date(`${customWindow.end}T23:59:59.999`) : _periodEnd).toISOString(),
  };
  const [joursRpc, ventesRpc] = await Promise.all([
    supabase.rpc('get_encaissements_par_jour', fenetreRpc),
    supabase.rpc('get_ventes_de_la_periode', fenetreRpc),
  ]);
  if (joursRpc.error) console.error('[PageClientStats] get_encaissements_par_jour a échoué:', joursRpc.error.message);
  if (ventesRpc.error) console.error('[PageClientStats] get_ventes_de_la_periode a échoué:', ventesRpc.error.message);
  const encaissementsParJour = joursRpc.data ?? [];
  const cashParVente = ventesRpc.data ?? [];

  // Déduplique leads par ig_user_id — dernière interaction
  const seen = new Set<string>();
  const igLeads: MockLead[] = leadsRows
    .filter((l: any) => { if (!l.ig_user_id || seen.has(l.ig_user_id)) return false; seen.add(l.ig_user_id); return true; })
    .map((l: any) => ({
      id: l.id, igUserId: l.ig_user_id, igUsername: l.ig_username || 'Anonyme',
      postId: l.media_id || '', postTitle: l.media_permalink || l.media_id || '',
      postType: 'IG' as const, commentedAt: l.detected_at,
      keyword: l.keyword_matched || '', leadMagnetSent: l.lead_magnet_sent || false,
      hookReplied: l.hook_replied || false, hookRepliedAt: l.hook_replied_at ?? null,
      trackingLink: l.tracking_link || null, source: l.source ?? null,
    }));

  const lmData = lmRes.data ?? [];
  const calendlyUrl = (calendlyRes.data?.metadata as any)?.scheduling_url || null;
  const destinations: DestinationLink[] = [
    ...(calendlyUrl ? [{ id: 'calendly-main', label: 'Appel découverte', url: calendlyUrl, type: 'calendly' as const }] : []),
    ...lmData.filter((lm: any) => lm.url).map((lm: any) => ({ id: `lm-${lm.id}`, label: lm.name, url: lm.url, type: 'leadmagnet' as const })),
  ];

  // Les calls rejetés dans le pipeline (« Non, pas un lead ») sont désormais
  // exclus à la source par `ignored`, comme toute autre exclusion de call. Le
  // filtre qui vivait ici s'appuyait sur `pipeline_overrides.stage = 'dismissed'`,
  // un mécanisme resté à zéro ligne en un an et retiré le 2026-08-27.
  const callsData = callsRes.data ?? [];

  // Un prospect ecarte depuis le Pipeline (« Non, pas un lead ») doit disparaitre de
  // TOUTES les cartes de Mes stats. `instagram_leads` porte la colonne et la filtre
  // deja, juste au-dessus ; `instagram_lead_lm_history` ne l'a pas — elle journalise
  // les reclamations de lead magnet, une ligne par interaction, et rien ne la reliait
  // a la decision prise sur la fiche.
  //
  // Or c'est ELLE que lit le grand chiffre « Leads » de Vue generale. Un prospect
  // ecarte y serait donc reste compte, alors que le Pipeline ne l'affiche plus et que
  // le badge « nouveaux » de la meme carte, qui lit l'autre table, l'excluait deja :
  // le badge aurait pu depasser le chiffre qu'il est cense detailler.
  //
  // Zero cas au 2026-09-01 — les deux prospects ecartes viennent de cold DM et n'ont
  // aucune ligne d'historique LM. Le trou n'attendait qu'un prospect venu d'un
  // COMMENTAIRE, seul chemin qui ecrit dans cette table, pour s'ouvrir.
  const { data: ecartesRows, error: ecartesErr } = await supabase
    .from('instagram_leads')
    .select('ig_user_id')
    .eq('profile_id', targetId)
    .eq('not_a_lead', true);
  // Sans ce log, une requete refusee laisserait un ensemble vide, qui se lit
  // « personne n'est ecarte » au lieu de « je ne sais pas qui l'est ».
  if (ecartesErr) console.error('[PageClientStats] lecture des prospects ecartes (not_a_lead) a echoue:', ecartesErr.message);
  const igUsersEcartes = new Set((ecartesRows ?? []).map((l: any) => l.ig_user_id).filter(Boolean));

  const lmHistory: { ig_user_id: string; keyword_matched: string; media_id: string | null; lead_magnet_sent: boolean; detected_at: string }[] =
    lmHistoryRows.filter((h: any) => h.ig_user_id && h.keyword_matched && !igUsersEcartes.has(h.ig_user_id));

  // Map ig_lead_id (UUID) → media_id pour attribution réelle calls/contenu
  const leadIdToMediaId = new Map<string, string>();
  for (const l of leadsRows) {
    if (l.id && l.media_id) leadIdToMediaId.set(l.id, l.media_id);
  }

  // Clics par short_url et par path — agrégés côté DB via get_shortio_clicks_by_url
  // (même principe que get_shortio_clicks_by_day : SUM group by short_url/path
  // directement en SQL, jamais plus d'une ligne par lien distinct en retour, donc
  // jamais de risque de troncature à 1000 même avec des centaines de liens ou de
  // clics). Remplace le rapatriement brut de shortioClicksRes qui, sur ce client,
  // pouvait déjà approcher ~1600 lignes sur un mois chargé (51 liens/jour × 31j) —
  // pas encore confirmé en bug observé, corrigé préventivement.
  const clicksByUrl = new Map<string, number>();
  const clicksByPath = new Map<string, number>();
  const urlToCategoryFromDb = new Map<string, string>();
  const { data: clicksByUrlRpcData, error: clicksByUrlRpcError } = await supabase.rpc('get_shortio_clicks_by_url', {
    p_profile_id: targetId,
    p_start_date: since30d,
    p_end_date: until30d,
  });
  if (clicksByUrlRpcError) console.error('[PageClientStats] get_shortio_clicks_by_url (fetchSupabaseStats) a échoué:', clicksByUrlRpcError.message);
  for (const row of (clicksByUrlRpcData ?? []) as { short_url: string | null; path: string | null; link_category: string | null; clics_humains: number }[]) {
    const clicks = row.clics_humains ?? 0;
    if (row.short_url) {
      const url = row.short_url.toLowerCase();
      clicksByUrl.set(url, (clicksByUrl.get(url) ?? 0) + clicks);
      if (row.link_category && !urlToCategoryFromDb.has(url)) {
        urlToCategoryFromDb.set(url, row.link_category);
      }
    }
    if (row.path) {
      const p = row.path.toLowerCase();
      clicksByPath.set(p, (clicksByPath.get(p) ?? 0) + clicks);
    }
  }
  // Clics Calendly bruts (bio + description uniquement, pas LM) — calculés plus bas
  // depuis chartByDate/bioIgByDate etc. (agrégat RPC, jamais tronqué), pas depuis
  // shortioClicksRes qui peut l'être sur un mois chargé (voir commentaire ci-dessus).
  const CALENDLY_CATEGORIES = new Set(['calendly_bio_ig','calendly_bio_yt','calendly_desc_ig','calendly_desc_yt']);

  // Map ig_lead_id → {callBooked, dealClosed, revenue} pour la table Performance LM
  const now = new Date();
  // Le montant vient de `deals`, source du cash depuis le 2026-08-20, et non de
  // `calls.revenue` qui n'est plus qu'une trace du rapport de call. Les deux ONT
  // divergé en base : le deal 4a8dde35 vaut 1 200 € après modification des modalités
  // de vente, alors que calls.revenue en dit toujours 3 000. Sans ce recalcul, la
  // table Performance LM affichait 3 000 € pendant que le reste de la page affichait
  // 1 200 €. Somme et non premier deal : un call peut en porter plusieurs (upsell).
  const montantParCall = new Map<string, number>();
  for (const d of dealsRows) {
    if (!d.call_id || d.status === 'canceled') continue;
    montantParCall.set(d.call_id, (montantParCall.get(d.call_id) ?? 0) + Number(d.amount_total || 0));
  }
  // UNE entree par PERSONNE, pliee sur TOUS ses calls — et non le dernier ecrit.
  //
  // `set` dans une boucle ecrasait : la liste etant triee `scheduled_at DESC`, la
  // derniere iteration est le call le plus ANCIEN, donc c'est lui qui restait.
  // incogniton.734 a deux calls (15/06 et 15/08) : le revenu et le `deal_closed` du
  // second etaient perdus. Les deux valent 0 aujourd'hui, donc rien ne se voyait —
  // le defaut est dans le mecanisme, pas dans le chiffre du jour.
  //
  // Deux grains differents, volontairement :
  // - booked / honored / closed : « au moins un », parce que la table compte des
  //   PERSONNES. Une personne qui a reserve deux fois a reserve, une fois.
  // - revenue : une SOMME, parce qu'un deal se compte la ou il a ete signe, meme au
  //   2e rendez-vous. Meme regle que `closed`/`revenue` dans Performance par contenu.
  // - qualified : le plus recent renseigne (la liste vient en `scheduled_at DESC`),
  //   un tri-etat ne se plie ni en « au moins un » ni en somme.
  const callByLeadId = new Map<string, { callBooked: boolean; callHonored: boolean; dealClosed: boolean; revenue: number; qualified: boolean | null }>();
  for (const c of callsData) {
    if (!c.ig_lead_id) continue;
    const prev = callByLeadId.get(c.ig_lead_id);
    callByLeadId.set(c.ig_lead_id, {
      callBooked:  (prev?.callBooked  ?? false) || c.status === 'active',
      callHonored: (prev?.callHonored ?? false) || isCallHonored(c, now),
      dealClosed:  (prev?.dealClosed  ?? false) || !!c.deal_closed,
      revenue:     (prev?.revenue ?? 0) + (montantParCall.get(c.id) ?? 0),
      qualified:   prev?.qualified ?? c.qualified ?? null,
    });
  }

  // prospect_links enrichis avec callBooked/callHonored/dealClosed/revenue/qualified/clicsHumains/post_id via DB
  const prospectLinksData = prospectLinksRows.map((pl: any) => {
    const callData = pl.ig_lead_id ? callByLeadId.get(pl.ig_lead_id) : undefined;
    const urlKey = (pl.short_url || '').toLowerCase();
    return {
      ...pl,
      callBooked:      callData?.callBooked  ?? false,
      callHonored:     callData?.callHonored ?? false,
      dealClosed:      callData?.dealClosed  ?? false,
      revenue:         callData?.revenue     ?? 0,
      qualified:       callData?.qualified   ?? null,
      clicsHumains:  clicksByUrl.get(urlKey) ?? 0,
      post_id:         pl.ig_lead_id ? (leadIdToMediaId.get(pl.ig_lead_id) ?? null) : null,
    };
  });

  // Map ig_lead_id → occurred_at pour les clics LM réels (postérieurs à detected_at, posés par poll-leads)
  const lmReclameParLeadId = new Set<string>();
  // Le premier appui JAMAIS enregistre pour ce profil. `null` = cette mesure n'a jamais
  // rien produit ici, et la colonne doit alors afficher un trou, pas un zero : un zero
  // affirmerait « personne n'a appuye sur le bouton » la ou la verite est « on ne
  // mesurait pas ». L'evenement `lm_link_requested` n'est ecrit que depuis le 2026-08-28.
  let premierLmReclame: string | null = null;
  for (const ev of lmRequestedEvents) {
    if (ev.ig_lead_id) lmReclameParLeadId.add(ev.ig_lead_id);
    if (ev.occurred_at && (!premierLmReclame || ev.occurred_at < premierLmReclame)) premierLmReclame = ev.occurred_at;
  }

  const lmClickedByLeadId = new Map<string, string>();
  for (const ev of lmClickedEvents) {
    if (ev.ig_lead_id) lmClickedByLeadId.set(ev.ig_lead_id, ev.occurred_at);
  }

  // Map ig_lead_id → occurred_at pour les clics Calendly réels — même source que le pipeline
  const linkClickedByLeadId = new Map<string, string>();
  for (const ev of linkClickedEvents) {
    if (ev.ig_lead_id) linkClickedByLeadId.set(ev.ig_lead_id, ev.occurred_at);
  }

  // Map keyword alternatif (lowercase) → lm_id pour les contenus avec un mot-clé custom
  // Ex : content_links { lm_id: "uuid-ubizen", lm_keyword: "BEAU" } → altKwToLmId.get("beau") = "uuid-ubizen"
  const altKwToLmId = new Map<string, string>();
  for (const cl of (contentLinksRes.data ?? [])) {
    if (cl.lm_id && cl.lm_keyword) {
      altKwToLmId.set((cl.lm_keyword as string).toLowerCase(), cl.lm_id as string);
    }
  }

  // Graphique historique : déjà agrégé côté DB par get_shortio_clicks_by_day
  // (1 ligne par jour × catégorie, plus jamais 1 ligne par lien — voir le
  // commentaire détaillé plus haut sur la root cause de troncature à 1000 lignes).
  const chartByDate = new Map<string, number>();
  // Sous-totaux par catégorie de source (bio/contenu/dm) — alimente les graphiques
  // filtrés "DM/Contenu/Bio uniquement" sur la vraie période sélectionnée.
  const bioIgByDate = new Map<string, number>();
  const bioYtByDate = new Map<string, number>();
  const contentIgByDate = new Map<string, number>();
  const contentYtByDate = new Map<string, number>();
  const dmCalendlyByDate = new Map<string, number>();
  const dmLmByDate = new Map<string, number>();
  const storyByDate = new Map<string, number>();
  // Voir le commentaire jumeau dans fetchSnapshot : une journée absente de la RPC est
  // une journée SANS collecte, pas une journée sans clic.
  // Premier jour de collecte de clics — GLOBAL, jamais borne a la fenetre affichee.
  //
  // `joursCollectesShortio` ne contient que les journees DE LA FENETRE. Sur une
  // periode entierement anterieure au debut de la collecte, cet ensemble est donc
  // VIDE — et le code en concluait « couverture complete », l'exact inverse de la
  // verite. Juin 2026 affichait ainsi « 5 opportunites pour 2 clics : 250 % ».
  // Un ensemble vide dit « on ne sait rien », pas « tout est couvert ».
  const { data: premierJourRows } = await supabase
    .from('shortio_link_daily_snapshots')
    .select('date')
    .eq('profile_id', targetId)
    .order('date', { ascending: true })
    .limit(1);
  const premierJourCollecteShortio: string | null = premierJourRows?.[0]?.date ?? null;

  // Premier clic sur un lien PROSPECT — l'autre journal du compteur « Clics liens
  // Calendly » d'Instagram. Global lui aussi, jamais borne a la fenetre : c'est ce
  // qui permet de savoir qu'une periode n'est PAS couverte, y compris quand elle est
  // entierement anterieure au journal.
  //
  // Instagram additionne deux journaux la ou YouTube n'en a qu'un : un lien Calendly
  // envoye en DM est PERSONNEL (un lien par prospect), donc son clic est attribuable
  // et suivi ici ; un lien de bio ou de description est PARTAGE et anonyme, donc
  // mesure en agregat par Short.io. D'ou « bio + descr. + DM » contre « Bio + Descr. ».
  const { data: premierClicRows } = await supabase
    .from('prospect_events')
    .select('occurred_at')
    .eq('profile_id', targetId)
    .eq('event_type', 'link_clicked')
    .order('occurred_at', { ascending: true })
    .limit(1);
  const premierClicLienProspect: string | null = premierClicRows?.[0]?.occurred_at ?? null;


  const joursCollectesShortio = new Set<string>();
  // calendlyStaticClicsFromDb/businessClicsFromDb : calculés ici (depuis l'agrégat
  // RPC, jamais tronqué) plutôt que depuis shortioClicksRes plus haut, qui peut
  // dépasser 1000 lignes sur un mois chargé — voir commentaire sur clicksByUrl.
  let calendlyStaticClicsFromDb = 0;
  let businessClicsFromDb = 0;
  for (const row of (shortioChartHistoryRpc.data ?? []) as { date: string; link_category: string; clics_humains: number }[]) {
    if (row.date) joursCollectesShortio.add(row.date);
    if (!row.date || !row.link_category) continue;
    const clicks = row.clics_humains ?? 0;
    if (CATS_BUSINESS.has(row.link_category)) {
      chartByDate.set(row.date, (chartByDate.get(row.date) ?? 0) + clicks);
      // businessClicsFromDb/calendlyStaticClicsFromDb représentent uniquement la
      // période courante (KPI "Clics totaux" du haut de page) — shortioChartHistoryRpc
      // couvre 24 mois glissants pour le graphique historique, donc on ne compte ici
      // que les lignes qui tombent dans since30d/until30d.
      if (row.date >= since30d && row.date <= until30d) businessClicsFromDb += clicks;
    }
    if (CALENDLY_CATEGORIES.has(row.link_category) && row.date >= since30d && row.date <= until30d) calendlyStaticClicsFromDb += clicks;
    if (CATS_BIO_IG.has(row.link_category)) bioIgByDate.set(row.date, (bioIgByDate.get(row.date) ?? 0) + clicks);
    else if (CATS_BIO_YT.has(row.link_category)) bioYtByDate.set(row.date, (bioYtByDate.get(row.date) ?? 0) + clicks);
    else if (CATS_CONTENT_IG.has(row.link_category)) contentIgByDate.set(row.date, (contentIgByDate.get(row.date) ?? 0) + clicks);
    else if (CATS_CONTENT_YT.has(row.link_category)) contentYtByDate.set(row.date, (contentYtByDate.get(row.date) ?? 0) + clicks);
    else if (CATS_DM_CALENDLY.has(row.link_category)) dmCalendlyByDate.set(row.date, (dmCalendlyByDate.get(row.date) ?? 0) + clicks);
    else if (CATS_DM_LM.has(row.link_category)) dmLmByDate.set(row.date, (dmLmByDate.get(row.date) ?? 0) + clicks);
    else if (CATS_STORY.has(row.link_category)) storyByDate.set(row.date, (storyByDate.get(row.date) ?? 0) + clicks);
  }

  // Variation "Clics totaux" vs la période équivalente précédente (semaine d'avant si
  // period=7, mois d'avant sinon) — même agrégation RPC/mêmes catégories business que
  // businessClicsFromDb, contrairement à l'ancien shortio.clicksChange (calculé par
  // l'API Short.io elle-même sur ses 30 derniers jours glissants tous liens confondus,
  // sans aucun rapport avec le calendrier affiché ici — cf. bug "-95,6%" à côté d'un
  // total de 3 clics inchangé, remonté par Chris 2026-07-21). shortioChartHistoryRpc
  // couvre la fenêtre shortioHistoryFloor (3 mois) donc la période précédente y est
  // déjà incluse pour period=7/month, pas besoin d'un 2e appel réseau.
  const { periodStart: prevPeriodStart, periodEnd: prevPeriodEnd } = getPeriodWindow(1, period === 7 ? 'week' : 'month');
  const prevSince = parisDateStr(prevPeriodStart);
  const prevUntil = parisDateStr(prevPeriodEnd);
  let prevBusinessClics = 0;
  for (const [date, clicks] of chartByDate) {
    if (date >= prevSince && date <= prevUntil) prevBusinessClics += clicks;
  }
  // 3 cas : les deux périodes à 0 → 0% (aucun changement) ; précédente à 0 mais
  // actuelle > 0 → +100% (convention "nouveau", pas de division par 0) ; sinon vraie
  // variation. Toujours un nombre (jamais null) pour que le badge s'affiche toujours,
  // y compris à "0%" — demande explicite de Chris.
  const totalClicsChangePct = prevBusinessClics > 0
    ? Math.round(((businessClicsFromDb - prevBusinessClics) / prevBusinessClics) * 1000) / 10
    : businessClicsFromDb > 0 ? 100 : 0;
  // Comble les jours sans clic à 0 — sinon le graphique n'affiche qu'un point isolé par jour avec clics.
  // Bornes calendaires réelles (mêmes _periodStart/_periodEnd que le reste de la fonction),
  // pas une fenêtre glissante indépendante (cf. bug remonté "clics totaux à 0" 2026-07-06).
  const shortioChartHistory: { date: string; clicks: number }[] = [];
  const shortioChartHistoryBio: { date: string; ig: number; yt: number }[] = [];
  const shortioChartHistoryContent: { date: string; ig: number; yt: number }[] = [];
  const shortioChartHistoryDm: { date: string; calendly: number; lm: number }[] = [];
  const shortioChartHistoryStory: { date: string; story: number }[] = [];
  {
    let d = _periodStart;
    while (d.getTime() <= _periodEnd.getTime()) {
      const dateStr = parisDateStr(d);
      shortioChartHistory.push({ date: dateStr, clicks: chartByDate.get(dateStr) ?? 0 });
      shortioChartHistoryBio.push({
        date: dateStr,
        ig: bioIgByDate.get(dateStr) ?? 0,
        yt: bioYtByDate.get(dateStr) ?? 0,
      });
      shortioChartHistoryContent.push({
        date: dateStr,
        ig: contentIgByDate.get(dateStr) ?? 0,
        yt: contentYtByDate.get(dateStr) ?? 0,
      });
      shortioChartHistoryDm.push({
        date: dateStr,
        calendly: dmCalendlyByDate.get(dateStr) ?? 0,
        lm: dmLmByDate.get(dateStr) ?? 0,
      });
      d = parisAddDays(d, 1);
    }
  }

  return { igLeads, leadMagnets: lmData, destinations, calls: callsData, deals: dealsRows, encaissementsParJour, cashParVente, lmHistory, leadIdToMediaId, prospectLinksData, clicksByPath, clicksByUrl, urlToCategoryFromDb, calendlyStaticClicsFromDb, businessClicsFromDb, totalClicsChangePct, altKwToLmId, lmClickedByLeadId, linkClickedByLeadId, hookRepliedEvents, lmReclameParLeadId, premierLmReclame, shortioChartHistory, shortioChartHistoryBio, shortioChartHistoryContent, shortioChartHistoryDm, shortioChartHistoryStory, joursCollectesShortio, premierJourCollecteShortio, premierClicLienProspect, integrationsReadyAt };
  } catch { return null; }
}

// 4 clics max sur 2 minutes — après ça grise le bouton silencieusement
function useRefreshCooldown(_key: string) {
  const [clicks, setClicks] = useState<number[]>([]);
  const MAX_CLICKS = 4;
  const WINDOW_MS = 2 * 60 * 1000;

  const isThrottled = clicks.filter(t => Date.now() - t < WINDOW_MS).length >= MAX_CLICKS;

  const startCooldown = () => {
    const now = Date.now();
    setClicks(prev => [...prev.filter(t => now - t < WINDOW_MS), now]);
  };

  return { secondsLeft: 0, inCooldown: isThrottled, startCooldown };
}

async function fetchIntegrationStatus(profileId?: string) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const targetId = profileId || user.id;

  const { data } = await supabase
    .from('integrations')
    .select('provider, backfill_done, backfill_started_at, last_snapshot_status, last_snapshot_error, connected_at, first_connected_at')
    .eq('profile_id', targetId)
    .in('provider', ['instagram', 'youtube', 'stripe']);

  if (!data?.length) return null;

  const ig = data.find(r => r.provider === 'instagram');
  const yt = data.find(r => r.provider === 'youtube');
  // Sert a l'onglet Revenus. La question « Stripe est-il branche ? » se lit ici, dans la
  // table qui porte la reponse — pas au succes d'un appel a l'API Stripe. L'onglet
  // affichait « Connecte ton compte Stripe » des que cet appel echouait (panne, quota,
  // jeton revoque), donc un message faux sur un compte connecte, et il emportait avec
  // lui les montants des ventes, qui ne dependent pas de Stripe.
  const stripeConnected = data.some(r => r.provider === 'stripe');

  const latestSnap = await supabase
    .from('analytics_daily_snapshots')
    .select('date, updated_at')
    .eq('profile_id', targetId)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    ig: ig ? {
      backfillDone: ig.backfill_done,
      backfillStarted: ig.backfill_started_at,
      snapshotStatus: ig.last_snapshot_status,
      snapshotError: ig.last_snapshot_error,
      // first_connected_at, PAS connected_at : ce dernier est reecrit a CHAQUE
      // reconnexion OAuth. Or il borne la navigation arriere (maxIndex dans
      // PeriodPill) : s'y fier ferait qu'un eleve reconnectant LE MEME compte
      // perdrait d'un coup tout son historique de periodes. La donnee resterait
      // intacte en base, mais plus aucun bouton ne permettrait d'y revenir --
      // une perte qui ressemble a une perte de donnees sans en etre une.
      // Repli sur connected_at pour les lignes anterieures a la colonne.
      connectedAt: ig.first_connected_at ?? ig.connected_at,
    } : null,
    yt: yt ? {
      backfillDone: yt.backfill_done,
      backfillStarted: yt.backfill_started_at,
      snapshotStatus: yt.last_snapshot_status,
      snapshotError: yt.last_snapshot_error,
      connectedAt: yt.first_connected_at ?? yt.connected_at,
    } : null,
    stripeConnected,
    latestSnapshotDate: latestSnap.data?.date ?? null,
    latestSnapshotUpdatedAt: latestSnap.data?.updated_at ?? null,
  };
}

export default function PageClientStats({ profileId, clientName, title }: { profileId?: string; clientName?: string; title?: string } = {}) {
  const [tab, setTab] = useState(0);
  const [period, setPeriod] = useState<Period>(30);
  const [periodIndex, setPeriodIndex] = useState(0);
  // Mode "Depuis connexion" — coexiste avec period/periodIndex, ne les remplace
  // jamais. Volontairement séparé du système 7j/30j existant (voir commentaire
  // ligne ~295 sur Period : étendre ce type a déjà été exploré et reporté, 15+
  // sites font de l'arithmétique littérale sur 7/30).
  const [sinceConnection, setSinceConnection] = useState(false);
  // Valeur jamais relue : le setter est passé à TabFunnel (onModalChange) pour bloquer
  // le scroll du parent, mais l'état lui-même n'est lu nulle part.
  const [, setModalOpen] = useState(false);
  const [stripeRefreshing, setStripeRefreshing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Message affiché quand le rafraîchissement ne peut pas aboutir faute de
  // réseau — sans lui l'échec était totalement silencieux.
  const [refreshError, setRefreshError] = useState<string | null>(null);
  // Remonté ici (au lieu d'un state local à TabShortioB) car ce composant est
  // démonté/remonté à chaque changement de période (loading passe par true le
  // temps du refetch) — un state local y serait reset à 'clics' à chaque fois.
  const [shortioBMetric, setShortioBMetric] = useState<'clics' | 'leads' | 'hookReply' | 'calendlyLinks' | 'activation' | 'calls'>('clics');
  const [shortioBChartFilter, setShortioBChartFilter] = useState<'all' | 'dm' | 'content' | 'bio' | 'story'>('all');

  const refreshKey = `analytics_${profileId || 'me'}`;
  const { inCooldown, startCooldown } = useRefreshCooldown(refreshKey);

  const q = profileId ? `?profileId=${profileId}` : '';

  // ── TanStack Query — lazy par onglet ─────────────────────────────────────
  // Onglets : 0=Vue générale, 1=Instagram, 2=YouTube, 3=Funnel & Calls, 4=Business micro, 5=Revenus

  // Données Supabase — toujours chargées (rapides, multi-onglets)
  const { data: supaData, refetch: refetchSupa } = useQuery({
    queryKey: ['stats-supa', profileId, period],
    queryFn: () => fetchSupabaseStats(profileId, period),
    staleTime: 0,
  });

  const igLeads: MockLead[] = supaData?.igLeads ?? [];
  const leadMagnets: LeadMagnet[] = supaData?.leadMagnets ?? [];
  const destinations: DestinationLink[] = supaData?.destinations ?? [];
  const calls: CallRecord[] = supaData?.calls ?? [];
  // Deals du mode courant. En All-Time et sur les périodes passées, dealsEff bascule
  // sur le snapshot (voir plus bas) — même mécanique que callsEff.
  const deals: DealRecord[] = supaData?.deals ?? [];
  const lmHistory: { ig_user_id: string; keyword_matched: string; media_id: string | null; lead_magnet_sent: boolean; detected_at: string }[] = supaData?.lmHistory ?? [];
  // Journal des reponses au message d'accroche — voir la requete dans fetchSupabaseStats.
  const hookRepliedEvents: { prospect_key: string | null; occurred_at: string; metadata?: any }[] = supaData?.hookRepliedEvents ?? [];
  const integrationsReadyAt: string | null = supaData?.integrationsReadyAt ?? null;
  const leadIdToMediaId: Map<string, string> = supaData?.leadIdToMediaId ?? new Map();
  const prospectLinksData: any[] = supaData?.prospectLinksData ?? [];
  const altKwToLmId: Map<string, string> = supaData?.altKwToLmId ?? new Map();
  const lmClickedByLeadId: Map<string, string> = supaData?.lmClickedByLeadId ?? new Map();
  const lmReclameParLeadId: Set<string> = supaData?.lmReclameParLeadId ?? new Set();
  const premierLmReclame: string | null = supaData?.premierLmReclame ?? null;
  const linkClickedByLeadId: Map<string, string> = supaData?.linkClickedByLeadId ?? new Map();

  // Instagram — onglets 0, 1, 3
  // En All-Time, les deux cartes de portee (abonnes touches / part de non-abonnes)
  // passent a 12 mois au lieu de 30 jours. C'est le maximum exploitable : la
  // ventilation abonnes/non-abonnes n'existe que sur ~12 mois glissants, alors que
  // le reach total remonte a 2 ans. Au-dela, Meta totalise toute la fenetre mais ne
  // ventile que la partie recente, sans erreur (docs/instagram-reach-follow-type.md).
  //
  // Un vrai « depuis toujours » est hors d'atteinte : la deduplication ne
  // s'additionne pas d'une periode a l'autre (3 mois cumules donnaient 272 abonnes
  // contre 124 en realite), donc on ne peut ni assembler l'historique stocke ni
  // interroger au-dela d'un an. 12 mois est la reponse honnete.
  // Les cartes de portee suivent desormais la periode choisie a l'ecran, y compris
  // une periode passee — d'ou des bornes explicites plutot qu'une fenetre glissante.
  // En All-Time on retombe sur 365 jours, plafond au-dela duquel Meta ne ventile
  // plus (docs/instagram-reach-follow-type.md).
  const fenetrePortee = sinceConnection
    ? { fenetre: 365 }
    : (() => {
        const w = getPeriodWindow(periodIndex, period === 7 ? 'week' : 'month');
        return { debut: parisDateStr(w.periodStart), fin: parisDateStr(w.periodEnd) };
      })();
  const paramsPortee = new URLSearchParams(fenetrePortee as Record<string, string>).toString();
  const { data: igRaw, isLoading: igLoading, refetch: refetchIg } = useQuery<IGStats | null>({
    // Les bornes entrent dans la cle : sans elles, React Query resservirait le cache
    // de la periode precedente sous l'etiquette de la nouvelle.
    queryKey: ['stats-ig', profileId, paramsPortee],
    queryFn: () => fetchApi(`/api/instagram/stats${q}${q ? '&' : '?'}${paramsPortee}`),
    enabled: [0, 1, 3].includes(tab),
    staleTime: 5 * 60 * 1000,
  });
  // Totaux Instagram de la période courante depuis la DB (cohérent avec le calendrier
  // de période affiché) — même mécanisme que ytCurrentPeriodTotals ci-dessous, corrige
  // reach30d/views30d qui sinon restent une fenêtre glissante de 30j se terminant
  // "maintenant" (peut englober des données antérieures à la période calendaire choisie).
  const { data: igCurrentPeriodTotals } = useQuery({
    queryKey: ['stats-ig-current-period', profileId, period],
    queryFn: () => fetchIgCurrentPeriodTotals(profileId, period),
    enabled: [0, 1, 3].includes(tab),
  });

  const ig: IGStats | null = igRaw ? (
    igCurrentPeriodTotals ? {
      ...igRaw,
      reach30d: igCurrentPeriodTotals.reach30d,
      views30d: igCurrentPeriodTotals.views30d,
    } : igRaw
  ) : null;

  // YouTube — onglets 0, 2, 3
  const { data: ytRaw, isLoading: ytLoading } = useQuery<YTStats | null>({
    queryKey: ['stats-yt', profileId],
    queryFn: () => fetchApi(`/api/youtube/stats${q}`),
    enabled: [0, 2, 3].includes(tab),
    staleTime: 5 * 60 * 1000,
  });

  // Totaux YouTube de la période courante depuis la DB (cohérent avec le calendrier de
  // période affiché) — remplace uniquement les agrégats *30d de l'appel API direct
  // ci-dessus, qui lui reste la source de la liste de vidéos individuelles (temps réel).
  const { data: ytCurrentPeriodTotals } = useQuery({
    queryKey: ['stats-yt-current-period', profileId, period],
    queryFn: () => fetchYtCurrentPeriodTotals(profileId, period),
    enabled: [0, 2, 3].includes(tab),
  });

  const yt: YTStats | null = ytRaw ? (
    ytCurrentPeriodTotals ? {
      ...ytRaw,
      views30d: ytCurrentPeriodTotals.views30d,
      watchTime30d: ytCurrentPeriodTotals.watchTime30d,
      subsGained30d: ytCurrentPeriodTotals.subsGained30d,
      subsLost30d: ytCurrentPeriodTotals.subsLost30d,
      netSubs30d: ytCurrentPeriodTotals.netSubs30d,
      likes30d: ytCurrentPeriodTotals.likes30d,
      comments30d: ytCurrentPeriodTotals.comments30d,
      shares30d: ytCurrentPeriodTotals.shares30d,
    } : ytRaw
  ) : null;

  // Revenus de la periode courante — lus en base, plus par un appel a l'API Stripe.
  //
  // L'appel `/api/stripe/client-data` a disparu d'ici : il ne renvoyait que les DIX
  // derniers encaissements du compte, sans borne de date, et cette liste alimentait a la
  // fois le total « Cash collecte », le graphique et le tableau de l'onglet Revenus. Elle
  // en faisait trois affichages faux des qu'un mois portait plus de dix paiements, et
  // elle mettait un appel reseau externe sur le chemin d'affichage de chaque visite.
  // Les periodes passees lisaient deja `deal_payments` ; la periode courante le fait
  // desormais aussi (voir fetchSupabaseStats). Le reste de la reponse de la route —
  // `mrr`, `activeSubscriptions`, `availableBalance` — n'etait lu nulle part.

  async function handleStripeRefresh() {
    setStripeRefreshing(true);
    await refetchSupa();
    setStripeRefreshing(false);
  }

  // Messages IG — onglets 0, 3, 4
  const { data: msgsRaw } = useQuery<IGMessages | null>({
    queryKey: ['stats-msgs', profileId],
    queryFn: () => fetchApi(`/api/instagram/messages${q}`),
    enabled: [0, 3, 4].includes(tab),
    staleTime: 5 * 60 * 1000,
  });
  const msgs: IGMessages | null = msgsRaw ?? null;

  // Short.io — onglets 0 (Vue générale) et 4 (Business micro) — cache 15min
  const { data: shortioRaw, isFetching: shortioLoading, refetch: refetchShortio } = useQuery<ShortioStats | null>({
    queryKey: ['stats-shortio', profileId],
    queryFn: () => fetchApi(`/api/shortio/stats${q}`),
    enabled: tab === 0 || tab === 3 || tab === 4,
    staleTime: 15 * 60 * 1000,
    placeholderData: (prev) => prev ?? undefined,
  });
  const shortio: ShortioStats | null = shortioRaw ?? null;

  // État intégrations — backfill + fraîcheur + connectedAt (déplacé plus haut car
  // nécessaire au calcul de connectedAt/sinceConnSnap/sinceConnSupa ci-dessous,
  // eux-mêmes utilisés par les branchements clicksByPath/etc. qui suivent).
  const { data: integStatus, refetch: refetchIntegStatus } = useQuery({
    queryKey: ['integ-status', profileId],
    queryFn: () => fetchIntegrationStatus(profileId),
    staleTime: 2 * 60 * 1000,
    refetchInterval: (query) => {
      // Polling toutes les 10s si un backfill est en cours
      const d = query.state.data as Awaited<ReturnType<typeof fetchIntegrationStatus>>;
      const igInProgress = d?.ig && !d.ig.backfillDone && d.ig.backfillStarted;
      const ytInProgress = d?.yt && !d.yt.backfillDone && d.yt.backfillStarted;
      return (igInProgress || ytInProgress) ? 10_000 : false;
    },
  });

  // Mode "Depuis connexion" — connectedAt = la plus ancienne des deux plateformes
  // (même pattern déjà utilisé par PeriodPill pour maxIndex, réutilisé ici pour la
  // fenêtre de fetch réelle). Calculé une seule fois, partagé entre PeriodPill/
  // SectionControls et les fetchs sinceConnection ci-dessous.
  const igConnectedAt = integStatus?.ig?.connectedAt ?? null;
  const ytConnectedAt = integStatus?.yt?.connectedAt ?? null;
  const connectedAt = [igConnectedAt, ytConnectedAt].filter(Boolean).sort()[0] ?? null;
  // Divergence significative entre les deux dates de connexion (>30j) — sans ça, le
  // mode "Depuis connexion" afficherait un graphique à plat sur la plateforme
  // connectée plus tard, sans qu'aucune UI n'explique pourquoi (trouvé en revue croisée).
  const connectionDatesDiverge = !!(igConnectedAt && ytConnectedAt &&
    Math.abs(new Date(igConnectedAt).getTime() - new Date(ytConnectedAt).getTime()) > 30 * 86400000);
  const laterConnectedPlatform = connectionDatesDiverge
    ? (new Date(igConnectedAt!).getTime() > new Date(ytConnectedAt!).getTime() ? { name: 'Instagram', date: igConnectedAt } : { name: 'YouTube', date: ytConnectedAt })
    : null;

  // Départ de l'All-Time : integrations_ready_at, la même référence que le pipeline
  // (app/api/client/pipeline/route.ts) et les routes sales-calls. C'est le moment où
  // les intégrations de l'élève sont opérationnelles, donc où Momentum commence à
  // pouvoir générer et mesurer quoi que ce soit.
  //
  // Avant, cette fenêtre partait de la plus ancienne connexion IG/YT — une date
  // ANTÉRIEURE (29/05 contre 09/06 sur le profil de test, 11 jours d'écart), qui
  // faisait entrer dans l'All-Time des jours de reach et de vues précédant la mise en
  // route. Les calls n'étaient pas touchés sur ces données-là (aucun dans l'intervalle),
  // mais 11 jours de snapshots IG/YT l'étaient. Constaté le 2026-08-19.
  //
  // Repli sur connectedAt quand integrations_ready_at est absent (clients antérieurs
  // à cette colonne) : mieux vaut la fenêtre large d'avant que pas d'All-Time du tout.
  const allTimeStart = integrationsReadyAt ?? connectedAt;
  const sinceConnWindow = allTimeStart ? { start: parisDateStr(new Date(allTimeStart)), end: parisDateStr(new Date()) } : undefined;
  const { data: sinceConnSnap, isLoading: sinceConnSnapLoading } = useQuery({
    queryKey: ['stats-since-connection-snap', profileId, allTimeStart],
    queryFn: () => fetchSnapshot(profileId, 1 /* ignoré, customWindow fourni */, 30, sinceConnWindow),
    enabled: sinceConnection && !!allTimeStart,
    staleTime: 30 * 60 * 1000,
  });
  const { data: sinceConnSupa, isLoading: sinceConnSupaLoading } = useQuery({
    queryKey: ['stats-since-connection-supa', profileId, allTimeStart],
    queryFn: () => fetchSupabaseStats(profileId, 30, sinceConnWindow),
    enabled: sinceConnection && !!allTimeStart,
    staleTime: 30 * 60 * 1000,
  });
  const sinceConnLoading = sinceConnSnapLoading || sinceConnSupaLoading;

  // Snapshot historique — chargé dès que periodIndex > 0, quel que soit l'onglet actif
  const { data: snapData, isLoading: snapLoading } = useQuery({
    queryKey: ['stats-snapshot', profileId, periodIndex, period],
    queryFn: () => fetchSnapshot(profileId, periodIndex, period),
    enabled: periodIndex > 0,
    staleTime: 30 * 60 * 1000,
  });

  // En S-1+ : clics filtrés sur la fenêtre exacte de la période (depuis fetchSnapshot)
  // En S-0 : clics filtrés sur le period actif (7j ou 30j) depuis supaData
  // "Depuis connexion" : prioritaire, utilise sinceConnSnap/sinceConnSupa (mêmes
  // formes de données que snapData/supaData respectivement, RPC déjà génériques
  // sur des dates arbitraires).
  const clicksByPath: Map<string, number> = sinceConnection
    ? (sinceConnSnap?.clicksByPath ?? new Map())
    : (periodIndex > 0 ? snapData?.clicksByPath : null) ?? supaData?.clicksByPath ?? new Map();
  const clicksByUrl: Map<string, number> = sinceConnection
    ? (sinceConnSnap?.clicksByUrl ?? new Map())
    : (periodIndex > 0 ? snapData?.clicksByUrl : null) ?? supaData?.clicksByUrl ?? new Map();
  const urlToCategoryFromDb: Map<string, string> = (sinceConnection ? sinceConnSupa?.urlToCategoryFromDb : supaData?.urlToCategoryFromDb) ?? new Map();
  const businessClicsFromDb: number | undefined = sinceConnection
    ? sinceConnSnap?.businessClicsFromDb
    : (periodIndex === 0 ? supaData?.businessClicsFromDb : snapData?.businessClicsFromDb);
  // Pas de "période précédente" avant la connexion — le delta n'a pas de sens en
  // mode "depuis connexion", volontairement undefined (masque le badge, voir
  // consommateurs de ce champ vérifiés en point 9 du plan).
  const totalClicsChangePct: number | null | undefined = sinceConnection
    ? undefined
    : (periodIndex === 0 ? supaData?.totalClicsChangePct : snapData?.totalClicsChangePct);
  const shortioChartHistory: { date: string; clicks: number }[] | undefined = sinceConnection
    ? sinceConnSnap?.shortioChartHistory
    : (periodIndex === 0 ? supaData?.shortioChartHistory : snapData?.shortioChartHistory);
  const shortioChartHistoryBio: { date: string; ig: number; yt: number }[] | undefined = sinceConnection
    ? sinceConnSnap?.shortioChartHistoryBio
    : (periodIndex === 0 ? supaData?.shortioChartHistoryBio : snapData?.shortioChartHistoryBio);
  const shortioChartHistoryContent: { date: string; ig: number; yt: number }[] | undefined = sinceConnection
    ? sinceConnSnap?.shortioChartHistoryContent
    : (periodIndex === 0 ? supaData?.shortioChartHistoryContent : snapData?.shortioChartHistoryContent);
  const shortioChartHistoryDm: { date: string; calendly: number; lm: number }[] | undefined = sinceConnection
    ? sinceConnSnap?.shortioChartHistoryDm
    : (periodIndex === 0 ? supaData?.shortioChartHistoryDm : snapData?.shortioChartHistoryDm);
  const joursCollectesShortio: Set<string> | undefined = sinceConnection
    ? sinceConnSnap?.joursCollectesShortio
    : (periodIndex === 0 ? supaData?.joursCollectesShortio : snapData?.joursCollectesShortio);
  // Global, donc valable quelle que soit la periode affichee — c'est tout l'interet :
  // il reste connu meme quand la fenetre courante ne contient aucune journee collectee.
  const premierJourCollecteShortio: string | null | undefined = sinceConnection
    ? sinceConnSnap?.premierJourCollecteShortio
    : (periodIndex === 0 ? supaData?.premierJourCollecteShortio : snapData?.premierJourCollecteShortio);
  const premierClicLienProspect: string | null | undefined = sinceConnection
    ? sinceConnSnap?.premierClicLienProspect
    : (periodIndex === 0 ? supaData?.premierClicLienProspect : snapData?.premierClicLienProspect);
  const shortioChartHistoryStory: { date: string; story: number }[] | undefined = sinceConnection
    ? sinceConnSnap?.shortioChartHistoryStory
    : (periodIndex === 0 ? supaData?.shortioChartHistoryStory : snapData?.shortioChartHistoryStory);
  // Clics Calendly statiques (bio + desc) depuis DB — pour Vue générale uniquement.
  // Jamais calculé pour periodIndex>0 aujourd'hui (undefined) — même chose en mode
  // "depuis connexion", cohérent avec ce comportement existant.
  const calendlyStaticClicsFromDb: number | undefined = (!sinceConnection && periodIndex === 0) ? supaData?.calendlyStaticClicsFromDb : undefined;

  // État intégrations — backfill + fraîcheur
  const backfillInProgress = !!(
    (integStatus?.ig && !integStatus.ig.backfillDone && integStatus.ig.backfillStarted) ||
    (integStatus?.yt && !integStatus.yt.backfillDone && integStatus.yt.backfillStarted)
  );
  const snapshotError = integStatus?.ig?.snapshotError || integStatus?.yt?.snapshotError || null;
  const latestSnapshotDate = integStatus?.latestSnapshotDate ?? null;
  const latestSnapshotUpdatedAt = integStatus?.latestSnapshotUpdatedAt ?? null;
  const snapshotAgeHours = latestSnapshotUpdatedAt
    ? (Date.now() - new Date(latestSnapshotUpdatedAt).getTime()) / 3600000
    : null;
  const snapshotStale = snapshotAgeHours !== null && snapshotAgeHours > 26;

  async function handleRefresh() {
    if (inCooldown || refreshing) return;

    // Hors connexion, les fetch ci-dessous échouent — mais Promise.allSettled
    // ne rejette jamais, donc le code continuait comme si tout s'était bien
    // passé : le bouton reprenait son état normal ET un cooldown se déclenchait,
    // bloquant l'utilisateur alors que rien n'avait été rafraîchi.
    if (!isOnlineNow()) {
      setRefreshError('Pas de connexion — réessaie une fois le réseau revenu.');
      setTimeout(() => setRefreshError(null), 4000);
      return;
    }

    setRefreshing(true);
    const body = profileId ? JSON.stringify({ profile_id: profileId }) : JSON.stringify({});
    // Refresh snapshots DB (instagram, youtube, shortio, calendly)
    const results = await Promise.allSettled([
      fetch('/api/instagram/refresh-today', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }),
      fetch('/api/youtube/refresh-today', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }),
      fetch('/api/shortio/refresh-today', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }),
      fetch('/api/calendly/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }),
      // Force le re-fetch du cache shortio_stats_cache en bypassant le SWR
      fetch(`/api/shortio/stats${q}${q ? '&' : '?'}force=1`),
    ]);
    // Le réseau a pu tomber PENDANT le rafraîchissement : si tout a échoué, on
    // ne déclenche pas le cooldown, sinon l'utilisateur serait bloqué sans avoir
    // rien obtenu. Un échec partiel reste un succès (les autres sources ont
    // répondu), donc on ne teste que le cas où rien n'est passé.
    const allFailed = results.every(r => r.status === 'rejected');
    setRefreshing(false);
    if (allFailed) {
      setRefreshError('Rafraîchissement impossible — vérifie ta connexion.');
      setTimeout(() => setRefreshError(null), 4000);
      return;
    }

    startCooldown();
    refetchIntegStatus();
    await Promise.all([refetchSupa(), refetchIg(), refetchShortio()]);
  }

  // Données effectives : "depuis connexion" en priorité si actif, sinon historiques
  // si periodIndex > 0, live sinon (tous onglets). sinceConnection est un mode
  // séparé et prioritaire — jamais mélangé avec la logique periodIndex existante.
  // Stories, pour le KPI « Publications » des deux onglets. MEME queryKey que la
  // requete de TabInstagram : React Query partage alors le cache et ne declenche pas
  // un second appel. Sans ca, la carte aurait eu besoin de sa propre route.
  const { data: storiesKpiData } = useQuery({
    queryKey: ['stories', profileId],
    queryFn: () => fetch(profileId ? `/api/client/stories?profileId=${profileId}` : '/api/client/stories').then(r => r.json()),
    staleTime: 60 * 1000,
  });
  const storiesKpi: any[] = storiesKpiData?.stories ?? [];

  const igEff      = (sinceConnection ? (sinceConnSnap?.igHist      ?? null) : (periodIndex > 0 ? (snapData?.igHist      ?? null) : ig))      as IGStats | null;
  const ytEff      = (sinceConnection ? (sinceConnSnap?.ytHist      ?? null) : (periodIndex > 0 ? (snapData?.ytHist      ?? null) : yt))      as YTStats | null;
  // true quand yt est retombé sur ytRaw brut (pas de snapshot pour la période) — ytRaw agrège toujours sur 30j côté API
  const ytIsFallback = !sinceConnection && periodIndex === 0 && !ytCurrentPeriodTotals;
  const shortioEff = (sinceConnection ? (sinceConnSnap?.shortioHist ?? null) : (periodIndex > 0 ? (snapData?.shortioHist ?? null) : shortio)) as ShortioStats | null;
  // Les deux lectures d'argent de l'onglet Revenus, chacune servie par sa RPC. Elles
  // repondent a DEUX questions differentes, et les confondre etait ce qui rendait le
  // taux capable de depasser 100 % :
  //   par jour  -> « combien est rentre PENDANT la periode » (tresorerie)
  //   par vente -> « combien est rentre sur les ventes DE la periode » (cohorte)
  const encaissementsParJour = (sinceConnection
    ? (sinceConnSnap?.encaissementsParJour ?? [])
    : (periodIndex > 0 ? (snapData?.encaissementsParJour ?? []) : (supaData?.encaissementsParJour ?? []))) as JourEncaisse[];
  // Cle : id de video. Source : l'objet YouTube VIVANT, jamais `ytEff` — ce dernier
  // vaut le snapshot de la periode des qu'on navigue en arriere, et c'est justement
  // la valeur figee qu'on veut cesser de lire pour cette colonne.
  const retentionVivanteYt = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of (yt?.videos ?? []) as any[]) {
      if (typeof v?.avgViewPct === 'number' && v.avgViewPct > 0) m.set(v.id, v.avgViewPct);
    }
    return m;
  }, [yt]);

  const cashParVente = (sinceConnection
    ? (sinceConnSnap?.cashParVente ?? [])
    : (periodIndex > 0 ? (snapData?.cashParVente ?? []) : (supaData?.cashParVente ?? []))) as VenteCash[];
  const msgsEff    = (sinceConnection ? (sinceConnSnap?.msgsHist    ?? null) : (periodIndex > 0 ? (snapData?.msgsHist    ?? null) : msgs))    as IGMessages | null;
  const callsRaw   = sinceConnection ? (sinceConnSnap?.callsHist ?? []) : (periodIndex > 0 ? (snapData?.callsHist ?? []) : calls);
  const dealsEff   = (sinceConnection ? (sinceConnSnap?.dealsHist ?? []) : (periodIndex > 0 ? (snapData?.dealsHist ?? []) : deals)) as DealRecord[];

  // `deals` est la source du cash depuis la migration ; `calls.revenue` n'est
  // plus qu'une écriture miroir en attendant de disparaître. Plutôt que de
  // réécrire la vingtaine d'agrégations de cet écran (revenu par post, par
  // séquence, par jour, par source…), on injecte le montant du deal DANS le
  // call : leur logique de filtrage — souvent subtile, croisée avec utm_content
  // et media_id — reste intacte, seule la valeur sommée change de source.
  //
  // Somme et non premier deal trouvé : un call peut en porter plusieurs (upsell
  // signé sur le même rendez-vous). Aucun cas en base aujourd'hui, mais rien ne
  // l'interdit.
  //
  // Un deal SANS call (upsell, vente directe) reste absent de ces agrégations,
  // et c'est voulu : « revenu par post » ou « cash par call honoré » n'ont pas
  // de sens pour une vente qui n'a ni contenu d'origine ni rendez-vous. Ce cash
  // est compté dans l'onglet Revenus et la page Paiements, qui lisent `deals`
  // directement — voir le bloc « Cash encaissé par origine ».
  const callsEff = useMemo(() => {
    const byCall = new Map<string, number>();
    for (const d of dealsEff) {
      if (!d.call_id || d.status === 'canceled') continue;
      byCall.set(d.call_id, (byCall.get(d.call_id) ?? 0) + Number(d.amount_total || 0));
    }
    if (byCall.size === 0) return callsRaw;
    return callsRaw.map((c: CallRecord) =>
      byCall.has(c.id) ? { ...c, revenue: byCall.get(c.id)! } : c
    );
  }, [callsRaw, dealsEff]);
  // Même correction que callsEff, mais sur l'historique COMPLET : `callsAllTime`
  // alimente Cash/Vue (revenu cumulé depuis publication), qui lisait donc encore
  // calls.revenue — 3 000 € au lieu des 1 200 € du deal, sur le profil de test.
  const callsAllTimeEff = useMemo(() => {
    const byCall = new Map<string, number>();
    for (const d of deals) {
      if (!d.call_id || d.status === 'canceled') continue;
      byCall.set(d.call_id, (byCall.get(d.call_id) ?? 0) + Number(d.amount_total || 0));
    }
    if (byCall.size === 0) return calls;
    return calls.map((c: CallRecord) => byCall.has(c.id) ? { ...c, revenue: byCall.get(c.id)! } : c);
  }, [calls, deals]);

  // Alias pour compat. TabFunnel (déjà existant)
  const funnelIg      = igEff;
  const funnelYt      = ytEff;
  const funnelShortio = shortioEff;
  const funnelCalls   = callsEff;

  // Loading : vrai seulement si les données du tab actuel manquent encore
  const loading = (() => {
    if (!supaData) return true;
    if (periodIndex > 0 && snapLoading) return true;
    // Mode All-Time : ses deux requetes dediees etaient absentes de cette liste. Le
    // temps qu'elles repondent, les onglets s'affichaient avec des donnees vides et
    // annoncaient « Connecte ton compte Instagram » ou « Pas de donnees » — on lisait
    // une absence definitive la ou le chargement etait simplement en cours
    // (signale par Chris, 2026-08-22).
    if (sinceConnection && sinceConnLoading) return true;
    if (tab === 1 && igLoading) return true;
    if (tab === 2 && ytLoading) return true;
    if ((tab === 3 || tab === 4) && shortioLoading) return true;
    return false;
  })();

  const TABS = ['Vue générale', 'Instagram', 'YouTube', 'Funnel & Calls', 'Business micro', 'Revenus'];


  return (
    <div className="page-content page-client-stats">

      {/* Banner backfill en cours */}
      {backfillInProgress && (
        <div style={{ marginBottom: 16, padding: '10px 16px', background: 'var(--accent)10', border: '1px solid var(--accent)40', borderRadius: 8, fontSize: 13, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ animation: 'spin 1.5s linear infinite', display: 'inline-block' }}>⏳</span>
          Historique en cours de chargement — disponible dans 1-2 min…
        </div>
      )}

      {/* Santé des 7 intégrations obligatoires — remplace le bandeau `snapshotError`,
          qui ne regardait qu'Instagram et YouTube. Une panne de Calendly, Short.io ou
          Stripe figeait les chiffres sans qu'aucun écran ne le dise. */}
      {!backfillInProgress && <BandeauIntegrations profileId={profileId} />}

      {/* Banner données obsolètes */}
      {!backfillInProgress && snapshotStale && !snapshotError && (
        <div style={{ marginBottom: 16, padding: '10px 16px', background: '#b5802510', border: '1px solid #b5802540', borderRadius: 8, fontSize: 13, color: '#b58025', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>⚠️ Données de plus de 26h — cliquez sur Rafraîchir pour mettre à jour</span>
        </div>
      )}

      <div className="page-header" style={{ marginBottom: 20, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        {/* Titre à gauche */}
        <div>
          <h1 className="page-title">{title ?? (clientName ? `Stats de ${clientName}` : 'Stats Clients')}</h1>
          <p className="page-sub">
            Tableau de bord complet — toutes les plateformes
            {latestSnapshotDate && !backfillInProgress && (
              <span style={{ color: 'var(--faint)', fontSize: 11, marginLeft: 8 }}>
                · màj {latestSnapshotDate}
              </span>
            )}
          </p>
        </div>

        {/* Droite : bouton Rafraîchir + sélecteur période sur une ligne, même hauteur */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'stretch', flexShrink: 0, position: 'relative' }}>
          {/* Explique pourquoi le rafraîchissement n'a pas eu lieu. Sans ce
              message, l'échec réseau était totalement silencieux : le bouton
              reprenait son état normal comme si tout avait fonctionné. */}
          {refreshError && (
            <div style={{
              position: 'absolute', top: '100%', right: 0, marginTop: 6, zIndex: 20,
              padding: '7px 12px', borderRadius: 8, whiteSpace: 'nowrap',
              background: 'var(--amber-soft)', border: '1px solid var(--amber)',
              color: 'var(--amber)', fontSize: 11.5, fontWeight: 600,
            }}>
              {refreshError}
            </div>
          )}
          <button
            onClick={handleRefresh}
            disabled={inCooldown || refreshing || backfillInProgress}
            style={{
              padding: '6px 16px', fontSize: 12, fontWeight: 600, borderRadius: 8,
              cursor: inCooldown || refreshing || backfillInProgress ? 'not-allowed' : 'pointer',
              border: '1px solid var(--border)', background: 'var(--surface)',
              color: inCooldown || refreshing || backfillInProgress ? 'var(--muted)' : 'var(--ink)',
              transition: 'all .15s', whiteSpace: 'nowrap',
            }}
          >
            {refreshing ? 'Rafraîchissement…' : '↻ Rafraîchir'}
          </button>
          <PeriodPill period={period} setPeriod={setPeriod} periodIndex={periodIndex} setPeriodIndex={setPeriodIndex} connectedAt={connectedAt} allTimeStart={allTimeStart} sinceConnection={sinceConnection} setSinceConnection={setSinceConnection} />
        </div>
      </div>

      {sinceConnection && connectionDatesDiverge && laterConnectedPlatform && (
        <div style={{ marginBottom: 16, padding: '10px 16px', background: '#b5802510', border: '1px solid #b5802540', borderRadius: 8, fontSize: 13, color: '#b58025' }}>
          ⚠️ {laterConnectedPlatform.name} connecté plus récemment (le {new Date(laterConnectedPlatform.date!).toLocaleDateString('fr-FR')}) — données limitées avant cette date pour cette plateforme.
        </div>
      )}

      {sinceConnection && sinceConnLoading && (
        <div style={{ marginBottom: 16, padding: '10px 16px', background: 'var(--surface-chat-field)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, color: 'var(--muted)' }}>
          Chargement des données depuis la connexion… (peut prendre quelques secondes sur un historique long)
        </div>
      )}

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {/* Bandeau commun à tous les onglets : posé ici plutôt que recopié dans chacun.
          En All-Time la fenêtre part déjà de integrations_ready_at, donc jamais avant
          l'arrivée — le bandeau ne s'affiche que sur une période calendaire (mois ou
          semaine) qui commence avant. */}
      {!loading && (
        <CoverageNotice
          periodStartStr={sinceConnection ? null : parisDateStr(getPeriodWindow(periodIndex, period === 7 ? 'week' : 'month').periodStart)}
          integrationsReadyAt={integrationsReadyAt}
        />
      )}

      {loading ? <InlineLoader /> : (
        <>
          {tab === 0 && <TabOverviewV2 ig={igEff} yt={ytEff} msgs={msgsEff} calls={callsEff} callsAllTime={callsAllTimeEff} shortio={shortioEff} period={period} periodIndex={periodIndex} leadIdToMediaId={leadIdToMediaId} prospectLinksData={prospectLinksData} linkClickedByLeadId={linkClickedByLeadId} clicksByUrl={clicksByUrl} calendlyStaticClicsFromDb={calendlyStaticClicsFromDb} igLive={ig} ytLive={yt} sinceConnection={sinceConnection} leads={igLeads} lmHistory={lmHistory} integrationsReadyAt={integrationsReadyAt} allTimeStart={allTimeStart} deals={dealsEff} cashParVente={cashParVente} stories={storiesKpi} />}
          {tab === 1 && <TabInstagram ig={igEff} period={period} periodIndex={periodIndex} profileId={profileId} sinceConnection={sinceConnection} connexionCassee={!!integStatus?.ig?.snapshotError} abonnesAujourdHui={ig?.followers ?? null} allTimeStart={allTimeStart} stories={storiesKpi} />}
          {/* La retention est une PROPRIETE DE LA VIDEO, pas une metrique de periode :
              « 45 % de ma video est regardee » ne depend pas de la fenetre consultee.
              La stocker jour par jour etait l'erreur de modelisation — chaque ligne
              d'historique figeait une valeur qui, elle, ne cesse d'evoluer, et les
              lignes anciennes gardaient a jamais l'ancienne definition.
              On lit donc la valeur VIVANTE, la meme que celle du modal video, et le
              tableau affiche le meme chiffre quelle que soit la periode consultee. */}
          {tab === 2 && <TabYouTube yt={ytEff} period={period} profileId={profileId} periodIndex={periodIndex} ytIsFallback={ytIsFallback} sinceConnection={sinceConnection} connexionCassee={!!integStatus?.yt?.snapshotError} abonnesAujourdHui={yt?.subscribers ?? null} allTimeStart={allTimeStart} retentionVivante={retentionVivanteYt} />}
          {tab === 3 && <TabFunnel msgs={msgs} calls={funnelCalls} callsAllTime={callsAllTimeEff} deals={deals} ig={funnelIg} yt={funnelYt} shortio={funnelShortio} period={period} periodIndex={periodIndex} onModalChange={setModalOpen} leads={igLeads} prospectLinksData={prospectLinksData} linkClickedByLeadId={linkClickedByLeadId} clicksByUrl={clicksByUrl} sinceConnection={sinceConnection} allTimeStart={allTimeStart} profileId={profileId} joursCollectesShortio={joursCollectesShortio} premierJourCollecteShortio={premierJourCollecteShortio} premierClicLienProspect={premierClicLienProspect} />}
          {tab === 4 && <TabShortioB shortio={shortioEff} shortioLoading={shortioLoading} ig={igEff} yt={ytEff} leads={igLeads} leadMagnets={leadMagnets} destinations={destinations} lmHistory={lmHistory} hookRepliedEvents={hookRepliedEvents} lmReclameParLeadId={lmReclameParLeadId} premierLmReclame={premierLmReclame} period={period} periodIndex={periodIndex} profileId={profileId} prospectLinksData={prospectLinksData} clicksByPath={clicksByPath} clicksByUrl={clicksByUrl} urlToCategoryFromDb={urlToCategoryFromDb} businessClicsFromDb={businessClicsFromDb} totalClicsChangePct={totalClicsChangePct} altKwToLmId={altKwToLmId} lmClickedByLeadId={lmClickedByLeadId} linkClickedByLeadId={linkClickedByLeadId} calls={callsEff} callsAllTime={callsAllTimeEff} deals={deals} leadIdToMediaId={leadIdToMediaId} igLive={ig} ytLive={yt} shortioChartHistory={shortioChartHistory} shortioChartHistoryBio={shortioChartHistoryBio} shortioChartHistoryContent={shortioChartHistoryContent} shortioChartHistoryDm={shortioChartHistoryDm} shortioChartHistoryStory={shortioChartHistoryStory} joursCollectesShortio={joursCollectesShortio} premierJourCollecteShortio={premierJourCollecteShortio} selectedMetric={shortioBMetric} setSelectedMetric={setShortioBMetric} chartFilter={shortioBChartFilter} setChartFilter={setShortioBChartFilter} sinceConnection={sinceConnection} integrationsReadyAt={integrationsReadyAt} allTimeStart={allTimeStart} />}
          {tab === 5 && <TabRevenues encaissementsParJour={encaissementsParJour} cashParVente={cashParVente} deals={dealsEff} period={period} periodIndex={periodIndex} onRefresh={handleStripeRefresh} refreshing={stripeRefreshing} sinceConnection={sinceConnection} profileId={profileId} allTimeStart={allTimeStart} stripeConnected={integStatus?.stripeConnected} />}
        </>
      )}
    </div>
  );
}
