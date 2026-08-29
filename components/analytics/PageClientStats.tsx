'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
import { granulariteFenetre, regrouperComptage, regrouperTaux, libelleBucket, type Granularite } from '@/lib/chart-buckets';
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
import { isCallCanceled } from '@/lib/sessionRapport';
import { bucketCallsByBookedDay, parisDayRange, tauxOuTrou } from '@/lib/callSeries';
// Icones des en-tetes de colonne — source unique pour les trois tableaux de Business
// micro. Quatorze colonnes portent le meme nom d'un tableau a l'autre et doivent donc
// porter le meme symbole.
import { EnteteColonne, type NomIcone } from './IconesColonnes';
import { dureeDepuisSecondes, dureeDepuisMinutes, positionLecteur, formaterDureeVideo } from '@/lib/duree';

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
  reach30d: number; reach28dDedupFollowers?: number | null; reach28dDedupNonFollowers?: number | null; accountsEngaged30d: number; totalInteractions30d: number;
  /** Fenetre reellement interrogee pour les deux cartes de portee, en jours (30 ou 365). */
  fenetreJours?: number;
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
  qualified?: boolean | null; booked_at?: string | null;
  lead_deleted?: boolean | null; ignored?: boolean | null;
}

interface StripeStats {
  mrr: number; monthlyRevenue: number; activeSubscriptions: number;
  availableBalance: number;
  recentPayments: { id: string; amount: number; currency: string; description: string; date: string; status: string }[];
}
interface IGMessages {
  totalThreads30d: number; repliedThreads: number; responseRate: number; leadCount: number;
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
        {' '}: les <strong style={{ color: 'var(--ink-2)' }}>{joursManquants} premiers jours</strong> de cette période
        sont antérieurs et n&apos;ont aucune donnée.
        Les totaux ci-dessous sont donc à lire sur une période plus courte — ils ne se comparent pas
        à un mois complet. Rien à faire, cet historique n&apos;existe pas.
      </span>
    </div>
  );
}

/** Un deal, tel que le cash contracté en a besoin. `call_id` est null pour un deal
 *  créé hors pipeline (upsell, vente directe) — c'est précisément le cas que la somme
 *  des `calls.revenue` ne voyait pas. */
type DealRecord = {
  amount_total: number | string;
  status?: string | null;
  signed_at?: string | null;
  call_id?: string | null;
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

function Card({ title, sub, children, style }: { title?: string; sub?: string; children: React.ReactNode; style?: React.CSSProperties }) {
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
      <div className="chart-tooltip-label">{label}</div>
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
type Period = 7 | 30;
// TODO (chantier futur, voir plan) : passer Period en granularité calendaire
// (semaine lundi-dimanche / mois calendaire) via lib/period.ts. Reporté après
// découverte que 15+ sites font de l'arithmétique littérale avec 7/30 (pas
// seulement des libellés) — refactor plus large que prévu, à faire dans une
// session dédiée avec le vrai périmètre connu dès le départ.

// ─── TAB "Vue générale (B)" — version épurée ─────────────────────────────────

function TabOverviewV2({ ig, yt, stripe, msgs, calls, callsAllTime, shortio, period, periodIndex, leadIdToMediaId, prospectLinksData, linkClickedByLeadId, clicksByUrl, calendlyStaticClicsFromDb, igLive, ytLive, sinceConnection, leads, lmHistory, integrationsReadyAt }: { ig: IGStats | null; yt: YTStats | null; stripe: StripeStats | null; msgs: IGMessages | null; calls: CallRecord[]; callsAllTime?: CallRecord[]; shortio: ShortioStats | null; period: Period; periodIndex?: number; leadIdToMediaId: Map<string, string>; prospectLinksData?: any[]; linkClickedByLeadId?: Map<string, string>; clicksByUrl?: Map<string, number>; calendlyStaticClicsFromDb?: number; igLive?: IGStats | null; ytLive?: YTStats | null; sinceConnection?: boolean; leads?: MockLead[]; lmHistory?: { ig_user_id: string; keyword_matched: string; media_id: string | null; lead_magnet_sent: boolean; detected_at: string }[]; integrationsReadyAt?: string | null }) {
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
  const { periodStart: ovPeriodStart, periodEnd: ovPeriodEnd } = getPeriodWindow(_ovPIdx, period === 7 ? 'week' : 'month');
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
  const callsBookes  = callsInPeriod.filter(c => c.status === 'active').length;
  const callsHonores = callsInPeriod.filter(c => isCallHonored(c, now)).length;
  const noShows      = callsInPeriod.filter(c => c.status === 'active' && c.no_show).length;
  const dealsCloses  = callsInPeriod.filter(c => c.deal_closed).length;
  const totalRev     = callsInPeriod.reduce((s, c) => s + (c.revenue || 0), 0);
  const noShowRate   = callsBookes > 0 ? pct(noShows, callsBookes) : 0;
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
      days.push(existing ? { ...existing, pending: false } : { date: iso, views: 0, pending: true } as any);
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

  const igReach = period === 7
    ? igChartSlice.reduce((s, d) => s + d.reach, 0)
    : (ig?.reach30d || 0);
  const ytViews = period === 7
    ? ytChartSlice.reduce((s, d) => s + d.views, 0)
    : (yt?.views30d || 0);
  // ── Prochain call ─────────────────────────────────────────────────────────
  const nextCall = calls.filter(c => new Date(c.scheduled_at) > new Date()).sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())[0];

  // ── Signaux ────────────────────────────────────────────────────────────────
  const signalData: { type: SignalType; text: string }[] = [];
  if (nextCall) signalData.push({ type: 'green', text: `Prochain call : ${nextCall.invitee_name} — ${new Date(nextCall.scheduled_at).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` });
  if (dealsCloses > 0) signalData.push({ type: 'green', text: `${dealsCloses} deal${dealsCloses > 1 ? 's' : ''} closé${dealsCloses > 1 ? 's' : ''} sur ${sinceConnection ? 'toute la période' : period + ' jours'} — ${fmtEur(totalRev)} générés` });
  if (noShowRate > 20) signalData.push({ type: 'red', text: `Taux no-show élevé : ${fmt(noShowRate, 1)} % des calls bookés` });
  if (msgs && msgs.responseRate < 70) signalData.push({ type: 'amber', text: `Taux de réponse DM bas : ${fmt(msgs.responseRate, 1)} % — ${msgs.totalThreads30d - msgs.repliedThreads} conversations sans réponse` });
  if (closingRate > 0 && closingRate < 20) signalData.push({ type: 'amber', text: `Taux de closing à ${fmt(closingRate, 1)} % — sous le seuil cible de 25 %` });

  // ── Top contenus ──────────────────────────────────────────────────────────
  // Ce bloc est all-time — callsAllTime (jamais filtré par période), PAS calls (= callsEff, qui EST
  // coupé sur la fenêtre de la période affichée dès que periodIndex > 0).
  const callsForTopContent = callsAllTime ?? calls;
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
  // Vues lifetime pour Cash/Vue — UNIQUEMENT igLive/ytLive (jamais l'historique, qui varie avec
  // periodIndex). Si le post n'est plus dans la fenêtre live (30j), vue lifetime inconnue : null.
  const igLiveViewsByIdOv = new Map<string, number>((igLive?.posts ?? []).map((p: any) => [p.id, p.views || p.reach || 0]));
  const ytLiveViewsByIdOv = new Map<string, number>((ytLive?.videos ?? []).map((v: any) => [v.id, v.views || 0]));

  // Attribution calls IG → post : priorité à utm_content (daté au clic, lié au bon
  // contenu au moment du booking) plutôt qu'à ig_lead_id → leadIdToMediaId (état
  // COURANT mutable de instagram_leads, écrasé à chaque nouvelle interaction de la
  // même personne — voir même correctif dans matchesContent/TabFunnel plus haut).
  // 1. utm_content === postId (calls depuis lien description/bio, ou séquence story)
  // 2. sans utm_content → ig_lead_id → media_id via leadIdToMediaId (fallback legacy)
  type ContentItem = { id: string; title: string; thumbnail: string | null; platform: 'IG' | 'YT'; type: string; views: number; totalViews: number; watchTime: number; avgWatchTimeMin: number | null; noShowCount: number; noShowPct: number | null; closedCount: number; closedPct: number | null; callsBooked: number; revenueTotal: number; revenuePerCall: number; cashPerView: number | null };
  const allContent: ContentItem[] = [
    ...igPosts.map(p => {
      const postCalls = igCallsAll.filter(c => {
        if (c.utm_content) return c.utm_content === p.id;
        // Le repli par lead ne vaut que pour un call venu d'un DM. Fusionner deux
        // fiches pose `ig_lead_id` sur les rendez-vous d'une fiche e-mail — une
        // bio, une description YouTube — qui n'ont pas d'`utm_content` : ils
        // seraient crédités au post dont le lead vient, sans l'avoir jamais vu.
        // `source` dit d'où la réservation arrive, `ig_lead_id` seulement chez
        // qui elle est rangée, et la fusion change le second sans toucher au premier.
        return c.source === 'ig_dm' && c.ig_lead_id ? leadIdToMediaId.get(c.ig_lead_id) === p.id : false;
      });
      const callsBooked = postCalls.filter(c => c.status === 'active').length;
      const noShowCount = postCalls.filter(c => c.no_show).length;
      const closedCount = postCalls.filter(c => c.deal_closed).length;
      const revTotal = postCalls.reduce((s, c) => s + (c.revenue || 0), 0);
      const honored = callsBooked - noShowCount;
      const noShowPct = callsBooked > 0 ? Math.round((noShowCount / callsBooked) * 100) : null;
      const closedPct = honored > 0 ? Math.round((closedCount / honored) * 100) : null;
      const avgWatchTimeMin = p.avgWatchTimeMs ? Math.round(p.avgWatchTimeMs / 1000 / 60 * 10) / 10 : null;
      const totalViewsIG = p.views || p.reach || 0;
      const viewsLifetimeIG = igLiveViewsByIdOv.get(p.id) ?? null;
      return { id: p.id, title: p.caption?.slice(0, 60) || '(sans titre)', thumbnail: p.thumbnail || null, platform: 'IG' as const, type: p.type === 'VIDEO' || p.type === 'REEL' || p.type === 'REELS' ? 'Reel' : p.type === 'CAROUSEL_ALBUM' ? 'Carousel' : 'Image', views: totalViewsIG, totalViews: totalViewsIG, watchTime: p.totalWatchTimeMs ? Math.round(p.totalWatchTimeMs / 1000 / 60) : 0, avgWatchTimeMin, noShowCount, noShowPct, closedCount, closedPct, callsBooked, revenueTotal: revTotal, revenuePerCall: callsBooked > 0 ? Math.round(revTotal / callsBooked) : 0, cashPerView: viewsLifetimeIG && viewsLifetimeIG > 0 ? revTotal / viewsLifetimeIG : null };
    }),
    ...ytVideos.map(v => {
      const postCalls = ytCallsAll.filter(c => c.utm_content === v.id);
      const callsBooked = postCalls.filter(c => c.status === 'active').length;
      const noShowCount = postCalls.filter(c => c.no_show).length;
      const closedCount = postCalls.filter(c => c.deal_closed).length;
      const revTotal = postCalls.reduce((s, c) => s + (c.revenue || 0), 0);
      const honored = callsBooked - noShowCount;
      const noShowPct = callsBooked > 0 ? Math.round((noShowCount / callsBooked) * 100) : null;
      const closedPct = honored > 0 ? Math.round((closedCount / honored) * 100) : null;
      // v.watchTime30d est déjà en minutes (row.watch_time_min) — pas de /60 ici, contrairement
      // à la branche IG ci-dessus (avgWatchTimeMs en ms) : diviser aussi par 60 donnait un résultat
      // 60x trop petit (ex: 0.0 min affiché au lieu de 2.5 min).
      // Denominateur all-time : watchTime30d est lui aussi all-time cote API live.
      const vViews = v.viewsAllTime ?? v.views30d;
      const avgWatchTimeMin = v.watchTime30d && vViews > 0 ? Math.round(v.watchTime30d / vViews * 10) / 10 : null;
      const viewsLifetimeYT = ytLiveViewsByIdOv.get(v.id) ?? null;
      return { id: v.id, title: v.title, thumbnail: v.thumbnail || null, platform: 'YT' as const, type: v.isShort ? 'Short' : 'Vidéo', views: v.views30d, totalViews: v.views, watchTime: v.watchTime30d, avgWatchTimeMin, noShowCount, noShowPct, closedCount, closedPct, callsBooked, revenueTotal: revTotal, revenuePerCall: callsBooked > 0 ? Math.round(revTotal / callsBooked) : 0, cashPerView: viewsLifetimeYT && viewsLifetimeYT > 0 ? revTotal / viewsLifetimeYT : null };
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
      const aHonored = a.callsBooked - a.noShowCount;
      const bHonored = b.callsBooked - b.noShowCount;
      if (bHonored !== aHonored) return bHonored - aHonored;
      return b.callsBooked - a.callsBooked;
    }
    if (b.revenueTotal !== a.revenueTotal) return b.revenueTotal - a.revenueTotal;
    if (b.closedCount !== a.closedCount) return b.closedCount - a.closedCount;
    return b.callsBooked - a.callsBooked;
  });
  const visibleContent = showAllContent ? sortedContent : sortedContent.slice(0, 5);

  const igPostsInPeriod = ig?.posts.filter(p => { const t = new Date(p.timestamp).getTime(); return t >= ovPeriodStart.getTime() && (_ovPIdx === 0 || t <= ovPeriodEnd.getTime()); }).length || 0;
  const ytVideosInPeriodOv = yt?.videos.filter(v => { const t = new Date(v.publishedAt).getTime(); return t >= ovPeriodStart.getTime() && (_ovPIdx === 0 || t <= ovPeriodEnd.getTime()); }).length || 0;
  const totalPosts = igPostsInPeriod + ytVideosInPeriodOv;

  return (
    <div className="stack">

      {/* ── BLOC 1 : KPIs — 2 lignes de 5 ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
        {([
          { label: 'Abonnés IG', value: fmt(ig?.followers || 0), sub: 'total', color: IG_COLOR },
          { label: 'Abonnés YT', value: fmt(yt?.subscribers || 0), sub: 'total', color: YT_COLOR },
          null, // carte Publications custom
          'leads', // carte Leads custom (badge nouveaux à droite du chiffre)
          { label: 'Calls bookés', value: fmt(callsBookes), sub: ovEtiquettePeriode, color: 'var(--ink)' as string },
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
              </div>
            </div>
          );
          return (
            <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px' }}>
              <div className="eyebrow-sm" style={{ color: 'var(--muted)', marginBottom: 8 }}>{item.label}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: item.color, lineHeight: 1, marginBottom: 4 }}>{item.value}</div>
              <div style={{ fontSize: 10, color: 'var(--faint)' }}>{item.sub}</div>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
        {[
          { label: 'Calls honorés', value: fmt(callsHonores), sub: ovEtiquettePeriode, color: AMBER },
          { label: 'No-show', value: `${fmt(noShowRate, 0)} %`, sub: `${noShows} calls`, color: noShowRate > 20 ? RED : noShowRate > 10 ? AMBER : GREEN },
          { label: 'Closing', value: `${fmt(closingRate, 0)} %`, sub: `${dealsCloses} deals closés`, color: closingRate >= 25 ? GREEN : closingRate >= 15 ? AMBER : RED },
          { label: 'Rev / call', value: fmtEur(revPerCall), sub: 'par call booké', color: GREEN },
          { label: 'Revenue', value: fmtEur(totalRev), sub: ovEtiquettePeriode, color: GREEN },
        ].map((item, i) => (
          <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px' }}>
            <div className="eyebrow-sm" style={{ color: 'var(--muted)', marginBottom: 8 }}>{item.label}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: item.color, lineHeight: 1, marginBottom: 4 }}>{item.value}</div>
            <div style={{ fontSize: 10, color: 'var(--faint)' }}>{item.sub}</div>
          </div>
        ))}
      </div>

      {/* ── BLOC 2 : Santé contenu — 2 sparklines côte à côte ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {[
          { label: 'Reach Instagram', value: fmt(igReach), unit: 'personnes', color: IG_COLOR, data: igChartSlice.map(d => ({ date: d.date, v: d.pending ? null : d.reach })) },
          { label: 'Vues YouTube', value: fmt(ytViews), unit: 'vues', color: YT_COLOR, data: ytChartSlice.map(d => ({ date: d.date, v: d.pending ? null : d.views })) },
        ].map((item, i) => {
          const allPending = item.data.every(d => d.v === null);
          return (
          <div key={i} className="stats-hover-card" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 20px 12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <div>
                <div className="eyebrow-sm" style={{ color: 'var(--muted)', marginBottom: 4 }}>{item.label}</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ fontSize: 26, fontWeight: 800, color: 'var(--ink)', lineHeight: 1 }}>{item.value}</span>
                  <span style={{ fontSize: 10, color: 'var(--muted)' }}>{item.unit}</span>
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
              <ResponsiveContainer width="100%" height="100%">
                <ReAreaChart data={item.data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id={`grad-v2-${i}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={item.color} stopOpacity={0.18} />
                      <stop offset="95%" stopColor={item.color} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={period === 7 ? fmtAxisDateWithDay : fmtAxisDate} interval={graduationsDates(item.data.length, period)} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} allowDecimals={false} width={30} domain={([dataMin, dataMax]: readonly [number, number]) => { const range = dataMax - dataMin; const margin = range > 0 ? range * 0.15 : Math.max(1, Math.abs(dataMax) * 0.1 || 1); return [Math.max(0, dataMin - margin), dataMax + margin]; }} />
                  <Tooltip content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    return <div className="chart-tooltip"><div className="chart-tooltip-label">{label}</div><div className="chart-tooltip-row"><strong>{fmt(payload[0].value as number)}</strong></div></div>;
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
            <div style={{ fontSize: 13, fontWeight: 700 }}>Top contenus</div>
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
              {((): string[] => {
                if (contentSort === 'views') return ['', 'Contenu', 'Plateforme', 'Vues totales'];
                if (contentSort === 'watchTime') return ['', 'Contenu', 'Plateforme', 'Watch time total', 'Watch time moyen'];
                if (contentSort === 'calls') return ['', 'Contenu', 'Plateforme', 'Calls bookés', 'Calls honorés', 'No-show', 'Closé'];
                return ['', 'Contenu', 'Plateforme', 'Calls bookés', 'Revenue / call', 'Cash / vue', 'Revenue total'];
              })().map((h, i) => (
                <th key={i} className="eyebrow-sm" style={{ textAlign: i <= 1 ? 'left' : 'right', color: 'var(--muted)', padding: '0 8px 8px', borderBottom: '1px solid var(--border)' }}>{h}</th>
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
                      {c.callsBooked > 0 ? fmt(c.callsBooked - c.noShowCount) : '—'}
                    </td>
                    <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: 12, fontWeight: 600, color: c.noShowPct === null ? 'var(--faint)' : c.noShowPct > 20 ? RED : c.noShowPct > 10 ? AMBER : GREEN }}>
                      {c.noShowCount > 0 ? `${c.noShowCount} (${c.noShowPct}%)` : c.noShowPct !== null ? `0 (0%)` : '—'}
                    </td>
                    <td style={{ padding: '8px 8px', textAlign: 'right', fontSize: 12, fontWeight: 600, color: c.closedPct === null ? 'var(--faint)' : c.closedPct >= 25 ? GREEN : c.closedPct >= 15 ? AMBER : RED }}>
                      {c.closedCount > 0 ? `${c.closedCount} (${c.closedPct}%)` : c.closedPct !== null ? `0 (0%)` : '—'}
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

function TabInstagram({ ig, period, periodIndex, profileId, sinceConnection, connexionCassee }: { ig: IGStats | null; period: Period; periodIndex?: number; profileId?: string; sinceConnection?: boolean; connexionCassee?: boolean }) {
  const [selectedPost, setSelectedPost] = useState<IGPost | null>(null);
  const [statModal, setStatModal] = useState<{ label: string; value: string; color: string; data: { date: string; v: number }[]; unit?: string } | null>(null);
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
  const libelleFenetrePortee = fenetrePorteeJours >= 360
    ? 'les 12 derniers mois'
    : `les ${fenetrePorteeJours} derniers jours`;
  const igDaysSlice = sinceConnection ? ig.chartData : ig.chartData.filter(d => {
    const t = new Date(d.date + 'T12:00:00Z').getTime();
    return t >= igPeriodStart.getTime() && t <= igPeriodEnd.getTime();
  });
  const igReachP = igDaysSlice.reduce((s, d) => s + d.reach, 0);
  const igFollowerDeltaP = (igDaysSlice[igDaysSlice.length - 1]?.followerCount ?? 0) - (igDaysSlice[0]?.followerCount ?? 0);
  // Vraie somme des interactions (likes+comments+saves+shares) — distincte des comptes
  // ENGAGÉS (accountsEngaged, un nombre de personnes), qui était utilisée par erreur
  // pour le KPI "Interactions posts" ET pour engRate, alors que ces deux métriques
  // Meta sont différentes par définition (cf. bug ig_accounts_engaged/
  // ig_total_interactions identiques corrigé le 2026-07-06 — même confusion ici,
  // côté lecture cette fois plutôt que côté collecte).
  const igInteractionsP = igDaysSlice.reduce((s, d) => s + (d.totalInteractions ?? 0), 0);
  // Vues du profil sur la periode. Collectee depuis le 2026-08-22 : les journees
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
  const reachRate = ig.reach28dDedupFollowers != null ? pct(ig.reach28dDedupFollowers, ig.followers) : null;
  // % de non-abonnés parmi le reach dédupliqué (comptes uniques), pas parmi les vues
  // (viewsFollowerBreakdown compte les revisionnages, incohérent avec le graphique
  // "Reach Non-Followers" juste en dessous qui utilise reach, pas views) — confirmé
  // via test direct API : les deux métriques divergent fortement sur ce compte.
  const viralPct = (ig.reach28dDedupFollowers != null && ig.reach28dDedupNonFollowers != null)
    ? pct(ig.reach28dDedupNonFollowers, ig.reach28dDedupFollowers + ig.reach28dDedupNonFollowers)
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
  const igDays: typeof igDaysSlice = (() => {
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
  const postsInPeriod = ig.posts.filter(p => new Date(p.timestamp) >= cutoffIg).length;
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

  const igStatSeries: Record<string, { data: { date: string; v: number }[]; color: string; unit?: string }> = {
    'Publications': { data: pubsByDay, color: IG_COLOR },
    'Reach': { data: igDays.map(d => ({ date: d.date, v: igDaysNoDataSet.has(d.date) ? (null as any) : d.reach })), color: 'var(--accent-brand)' },
    'Abonnés': { data: igDays.map(d => ({ date: d.date, v: igDaysNoDataSet.has(d.date) ? (null as any) : (d.followerCount ?? 0) })), color: IG_COLOR },
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
    'Vues du profil': { data: igDays.map(d => ({
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

  const openStatModal = (label: string, value: string) => {
    const s = igStatSeries[label];
    if (!s) return;
    setStatModal({ label, value, color: s.color, data: s.data, unit: s.unit });
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
          { label: 'Abonnés', value: fmt(ig.followers), sub: 'total', color: 'var(--ink)', key: 'Abonnés', badge: igFollowerDeltaP },
          { label: 'Publications', value: fmt(postsInPeriod), sub: igEtiquettePeriode, color: IG_COLOR, key: 'Publications' },
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
          { label: 'Vues du profil', value: fmt(igProfileViewsP), sub: igEtiquettePeriode, color: 'var(--ink)', key: 'Vues du profil' },
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
          { label: 'Abonnés touchés', key: 'Abonnés touchés', value: reachRate !== null ? fmtPct(reachRate) : 'N/D', sub: reachRate !== null ? `sur tes ${fmt(ig.followers)} abonnés` : 'seuil Meta non atteint', color: reachRate !== null ? 'var(--ink)' : 'var(--faint)', tooltip: `Sur ${libelleFenetrePortee}, ${reachRate !== null ? fmtPct(reachRate) : '—'} de tes abonnés ont vu au moins un de tes contenus.\n\nChaque abonné est compté UNE SEULE FOIS, même s'il a vu dix posts : c'est un nombre de personnes, pas de vues. Le total ne peut donc jamais dépasser 100 %.\n\nÀ retenir en changeant de période : ce taux monte mécaniquement avec la durée (9 % sur 7 jours, 43 % sur 30, 65 % sur un an), parce qu'on accumule des personnes différentes. Une semaine et un mois ne se comparent donc pas directement.${sinceConnection ? '\n\nEn « Depuis la connexion », la fenêtre est plafonnée à 12 mois : Instagram ne fournit pas cette répartition au-delà.' : ''}` },
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

      <HistoriquePortee profileId={profileId} granularite={period === 7 ? 'semaine' : 'mois'} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <Card title="Reach par jour" sub={`${sinceConnection ? 'Depuis la connexion' : period + ' jours'}`}>
          <AreaChart data={igDaysForChart} areas={[{ key: 'reach', label: 'Reach', color: 'var(--accent-brand)' }]} xKey="date" height={220} showWeekday={period === 7} pendingKey="pending" />
        </Card>
        <Card title="Abonnés / jour" sub={`${sinceConnection ? 'Depuis la connexion' : period + ' jours'}`}>
          <ResponsiveContainer width="100%" height={220}>
            <ReAreaChart data={igDays} margin={{ top: 4, right: 8, left: 0, bottom: 24 }}>
              <defs>
                <linearGradient id="grad-ig-subs" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--accent-brand)" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="var(--accent-brand)" stopOpacity={0} />
                </linearGradient>
              </defs>
              {/* Intervalle calculé explicitement (pas 'preserveStartEnd') pour un espacement
                  régulier des labels de dates — même logique que le wrapper AreaChart. */}
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={period === 7 ? fmtAxisDateWithDay : fmtAxisDate} interval={graduationsDates(igDays.length, period)} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} allowDecimals={false} domain={['auto', 'auto']} tickFormatter={(v: number) => v >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v))} width={40} />
              <Tooltip content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                return (
                  <div className="chart-tooltip">
                    <div className="chart-tooltip-label">{label}</div>
                    <div className="chart-tooltip-row"><strong>{fmt(payload[0].value as number)}</strong><span style={{ color: 'var(--muted)', marginLeft: 4 }}>abonnés</span></div>
                  </div>
                );
              }} />
              <Area type="monotone" dataKey="followerCount" name="Abonnés" stroke="var(--accent-brand)" strokeWidth={2} fill="url(#grad-ig-subs)" dot={todayDotFactory('var(--accent-brand)', 'date', lastRealPointKey(igDays, 'date', 'followerCount'))} activeDot={{ r: 4, strokeWidth: 0, fill: 'var(--accent-brand)' }} isAnimationActive={false} />
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
            const er = post.totalInteractions && post.reach ? fmtPct(pct(post.totalInteractions, post.reach)) : '—';
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
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Jour par jour · {period} derniers jours</div>
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
            <ResponsiveContainer width="100%" height={220}>
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
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={period === 7 ? fmtAxisDateWithDay : fmtAxisDate} interval={statModalTickInterval} />
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
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={period === 7 ? fmtAxisDateWithDay : fmtAxisDate} interval={statModalTickInterval} />
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
                    return <div className="chart-tooltip"><div className="chart-tooltip-label">{label}</div><div className="chart-tooltip-row"><strong>{fmt(payload[0].value as number)}{statModal.unit ?? ''}</strong></div></div>;
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
                ['👤 Abonnements', selectedPost.follows],
                ['🔍 Visites du profil', selectedPost.profileVisits],
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
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {[
                  ['ER', selectedPost.totalInteractions && selectedPost.reach ? fmtPct(pct(selectedPost.totalInteractions, selectedPost.reach)) : '—', 'Engagement rate'],
                  ['Save rate', selectedPost.saved && selectedPost.reach ? fmtPct(pct(selectedPost.saved, selectedPost.reach)) : '—', 'Saves / Reach'],
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
function HistoriquePortee({ profileId, granularite }: { profileId?: string; granularite: 'mois' | 'semaine' }) {
  const { data, isLoading } = useQuery({
    queryKey: ['ig-periodes', profileId, granularite],
    queryFn: () => fetch(`/api/instagram/periodes?type=${granularite}${profileId ? `&profileId=${profileId}` : ''}`).then(r => r.json()),
    staleTime: 5 * 60 * 1000,
  });
  const periodes: any[] = data?.periodes ?? [];

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
      title="Composition de ton reach"
      sub="Qui a vu tes contenus — chaque période est comptée séparément, les valeurs ne s'additionnent pas"
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
            const pctAbo = total ? (abo / total) * 100 : 0;
            const pctNon = total ? (non / total) * 100 : 0;
            // Un segment trop etroit ne peut pas porter son texte sans deborder sur
            // le voisin. Pratique des outils pro : la valeur reste a l'exterieur, et
            // l'etiquette interieure disparait plutot que de se chevaucher. Le cas
            // « 99 % / 1 % » se lit donc toujours, le 1 % restant lisible dehors.
            const SEUIL_TEXTE = 14;
            return (
              <div key={p.debut} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border-soft)' }}>
                <div style={{ width: 168, flexShrink: 0, fontSize: 12.5, color: 'var(--ink-2)', whiteSpace: 'nowrap' }}>
                  {libelle(p)}
                  {!p.figee && (
                    <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--muted)', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 5px', marginLeft: 6, whiteSpace: 'nowrap' }}>
                      en cours
                    </span>
                  )}
                </div>

                <div style={{ width: 46, flexShrink: 0, textAlign: 'right', fontSize: 12.5, fontWeight: 600, color: COUL_ABO, fontVariantNumeric: 'tabular-nums' }}
                  title="Abonnés touchés">
                  {p.reachAbonnes == null ? '—' : fmt(abo)}
                </div>

                {/* Le total passe SOUS la barre, centre : a droite il se lisait comme
                    une quatrieme colonne de meme rang que les deux effectifs, alors
                    qu'il est leur somme. Dessous, il se lit comme le total qu'il est
                    (demande de Chris, 2026-08-26). */}
                <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', height: 22, borderRadius: 5, overflow: 'hidden', background: 'var(--surface-2)' }}>
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
                <div style={{ textAlign: 'center', marginTop: 5, fontSize: 11, color: 'var(--muted)' }}>
                  Reach total = <strong style={{ color: 'var(--ink)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{p.reachTotal == null ? '—' : fmt(total)}</strong>
                </div>
                </div>

                <div style={{ width: 46, flexShrink: 0, fontSize: 12.5, fontWeight: 600, color: COUL_NON, fontVariantNumeric: 'tabular-nums' }}
                  title="Non-abonnés touchés">
                  {p.reachNonAbonnes == null ? '—' : fmt(non)}
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
              les deux parts font 100 % du reach total
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
    'Visites du profil': 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
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
    ['Visites du profil', story.profile_visits ?? null],
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

function TabYouTube({ yt, period, profileId, periodIndex, ytIsFallback, sinceConnection, connexionCassee }: { yt: YTStats | null; period: Period; profileId?: string; periodIndex?: number; ytIsFallback?: boolean; sinceConnection?: boolean; connexionCassee?: boolean }) {
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
  const [statModal, setStatModal] = useState<{ label: string; value: string; color: string; data: { date: string; v: number }[]; unit?: string; data2?: { date: string; v: number }[]; label2?: string; color2?: string } | null>(null);
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
  if (sinceConnection) {
    for (const d of ytDaysRaw) {
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

  const videosInPeriod = yt.videos.filter(v => {
    const t = new Date(v.publishedAt).getTime();
    return t >= ytPeriodStart.getTime() && t <= ytPeriodEnd.getTime();
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

  const ytStatSeries: Record<string, { data: { date: string; v: number }[]; color: string; unit?: string }> = {
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
    'Abonnés YT':         { data: ytDays.map(d => ({ date: d.date, v: ytDaysNoDataSet.has(d.date) ? (null as any) : ((d as any).subscribers ?? null) })), color: RED },
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
        data: ytDays.map(d => ({
          date: d.date,
          v: ytDaysNoDataSet.has(d.date) ? (null as any) : ((d as any).watchTimeShorts ?? 0),
        })),
        label2: 'Vidéos longues',
        data2: ytDays.map(d => ({
          date: d.date,
          v: ytDaysNoDataSet.has(d.date) ? (null as any) : ((d as any).watchTimeLong ?? 0),
        })),
        color2: '#64748b',
        unit: 'min',
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
        data: ytDays.map(d => ({
          date: d.date,
          v: ytDaysNoDataSet.has(d.date) ? (null as any) : ((d as any).avgDurationShorts ?? 0),
        })),
        label2: 'Vidéos longues',
        data2: ytDays.map(d => ({
          date: d.date,
          v: ytDaysNoDataSet.has(d.date) ? (null as any) : ((d as any).avgDurationLong ?? 0),
        })),
        color2: '#64748b',
        unit: 's',
      });
      return;
    }
    if (label === 'Vidéos publiées') {
      setStatModal({
        label, value, color: '#e8a838', data: ytPubsByDay.map(d => ({ date: d.date, v: isFutureDayYT(d.date) ? (null as any) : d.shorts })),
        label2: 'Vidéos longues', data2: ytPubsByDay.map(d => ({ date: d.date, v: isFutureDayYT(d.date) ? (null as any) : d.longues })), color2: '#64748b',
      });
    } else {
      setStatModal({ label, value, color: s.color, data: s.data, unit: s.unit });
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
          { label: 'Abonnés', value: fmt(yt.subscribers), color: 'var(--ink)', key: 'Abonnés YT' },
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
        <Card title="Vues / jour" sub={`${sinceConnection ? 'Depuis la connexion' : period + ' jours'}${ytLagSuffix}`}>
          {(() => {
            // null (pas 0) sur les jours sans vraie donnée — même traitement que
            // "Abonnés nets / jour" juste en dessous : sinon une barre à 0 est
            // indiscernable d'un vrai jour sans vue.
            const viewsForChart = ytDays.map(d => ({
              date: d.date,
              views: ytDaysNoDataSet.has(d.date) ? (null as any) : d.views,
            }));
            const allPending = viewsForChart.every(d => d.views === null);
            // Meme hauteur que le graphique : la carte gardait 220 px avec la courbe et
            // retombait a ~77 px avec le message, ce qui faisait remonter tout le bas de
            // la page selon la periode consultee.
            if (allPending) return <ZoneGraphique height={220}><Empty msg="Pas encore de données" /></ZoneGraphique>;
            // Même formule que le composant partagé AreaChart (components/charts/AreaChart.tsx) :
            // ~9 labels max en vue mois, tous les jours affichés en vue semaine.
            return (
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={viewsForChart} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={period === 7 ? fmtAxisDateWithDay : fmtAxisDate} ticks={datesAxe(viewsForChart.map(d => d.date), period, largeurGraphiques * 0.62)} />
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
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={deviceData} cx="50%" cy="50%" outerRadius={80} dataKey="views" nameKey="name" label={({ name, percent }: { name?: string; percent?: number }) => `${name ?? ''} ${((percent ?? 0) * 100).toFixed(0)}%`} labelLine={false}>
                {deviceData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i]} />)}
              </Pie>
              <Tooltip formatter={(v: any) => fmt(v)} />
            </PieChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card title="Abonnés nets / jour" sub={`${sinceConnection ? 'Depuis la connexion' : period + ' jours'}${ytLagSuffix}`}>
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
            <ResponsiveContainer width="100%" height={160}>
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
                const av = videosSortKey === 'publishedAt' ? new Date(a.publishedAt).getTime() : (a[videosSortKey] ?? 0);
                const bv = videosSortKey === 'publishedAt' ? new Date(b.publishedAt).getTime() : (b[videosSortKey] ?? 0);
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
                  {!v.avgViewPct ? '—' : v.avgViewPct > 100 ? (
                    <span
                      title={`${fmtPct(v.avgViewPct)} sur les 30 derniers jours : au-delà de 100 %, cela signifie que les spectateurs ont revu des passages. Fréquent sur les Shorts, qui tournent en boucle. Sur toute la vie de la vidéo, la rétention est plus basse.`}
                      style={{ cursor: 'help', borderBottom: '1px dotted var(--muted)' }}
                    >
                      &gt;100&nbsp;%
                    </span>
                  ) : fmtPct(v.avgViewPct)}
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
                  Jour par jour · {period} derniers jours
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
                  <ResponsiveContainer width="100%" height={220}>
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
              <ResponsiveContainer width="100%" height={220}>
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
                    return <div className="chart-tooltip"><div className="chart-tooltip-label">{label}</div><div className="chart-tooltip-row"><strong>{fmt(payload[0].value as number)}{statModal.unit ?? ''}</strong></div></div>;
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
                <ResponsiveContainer width="100%" height={160}>
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
  steps: { label: string; value: string; sub?: string; rate?: number; rawValue: number }[];
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
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.3 }}>{step.label}</div>
              {step.sub && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>{step.sub}</div>}
              {step.rate !== undefined && (
                <div style={{
                  marginTop: 5,
                  fontSize: 11, fontWeight: 700,
                  color: step.rate < 1 ? RED : step.rate < 5 ? AMBER : GREEN,
                }}>
                  {fmt(step.rate, 1)}%
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


function periodLabel(period: number, index: number): string {
  // Bornes calendaires réelles (semaine lundi-dimanche si period=7, mois calendaire
  // sinon) via lib/period.ts — même source que tous les autres calculateurs de bornes
  // du fichier, élimine la classe de bug "décalage d'un jour entre deux endroits".
  const { periodStart, periodEnd } = getPeriodWindow(index, period === 7 ? 'week' : 'month');
  // timeZone Europe/Paris (pas UTC) : periodStart/periodEnd (getPeriodWindow) sont des
  // instants UTC correspondant à minuit/23:59:59.999 heure de Paris, pas minuit UTC —
  // les lire en UTC affichait un jour "trop tôt" (ex: "30 juin" au lieu de "1 juil").
  // Pas d'annee ici : ce libelle borne la periode SELECTIONNEE (« 1 août – 31 août »),
  // toujours proche du present. L'annee n'apporte rien et alourdit le bandeau.
  // Elle n'a de sens que sur les dates de publication, qui peuvent remonter a plusieurs
  // annees.
  const fmt2 = (d: Date) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'Europe/Paris' });
  return `${fmt2(periodStart)} – ${fmt2(periodEnd)}`;
}


function TabFunnel({ msgs, calls, stripe, ig, yt, shortio, period, periodIndex, onModalChange, leads: leadsFromProp, prospectLinksData, linkClickedByLeadId, clicksByUrl, sinceConnection, allTimeStart }: { msgs: IGMessages | null; calls: CallRecord[]; stripe: StripeStats | null; ig: IGStats | null; yt: YTStats | null; shortio: ShortioStats | null; period: Period; periodIndex: number; onModalChange?: (open: boolean) => void; leads?: MockLead[]; prospectLinksData?: any[]; linkClickedByLeadId?: Map<string, string>; clicksByUrl?: Map<string, number>; sinceConnection?: boolean; allTimeStart?: string | null }) {
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
  const [expandedEff, setExpandedEff] = useState<{ label: string; value: string; color: string; estPct: boolean; estClosing: boolean; data: { date: string; v: number }[] } | null>(null);
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
    ? `All-Time${allTimeStart ? ` · depuis le ${new Date(allTimeStart).toLocaleDateString('fr-FR')}` : ''}`
    : periodLabel(period, periodIndex);
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
  const calcCalls = (subset: CallRecord[]) => {
    const actifs = subset.filter(c => c.status === 'active');
    const bookes = actifs.length;
    const honores = actifs.filter(c => isCallHonored(c, now)).length;
    const closes = actifs.filter(c => c.deal_closed).length;
    const rev = actifs.reduce((acc, c) => acc + (c.revenue || 0), 0);
    const noShows = actifs.filter(c => c.no_show).length;
    return { bookes, honores, closes, rev, noShows };
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
  const igReachD  = noData ? 0 : (ig ? ig.chartData.filter(d => inFunnelDateWindow(d.date)).reduce((s, d) => s + d.reach, 0) : 0);
  const igBookes  = igCallsLive.bookes;
  const igHonores = igCallsLive.honores;
  const igCloses  = igCallsLive.closes;
  const igRev     = igCallsLive.rev;
  const igNoShows = igCallsLive.noShows;

  const ytViewsD  = noData ? 0 : (yt ? yt.chartData.filter(d => inFunnelDateWindow(d.date)).reduce((s, d) => s + d.views, 0) : 0);
  const ytBookes  = ytCallsLive.bookes;
  const ytHonores = ytCallsLive.honores;
  const ytCloses  = ytCallsLive.closes;
  const ytRev     = ytCallsLive.rev;
  const ytNoShows = ytCallsLive.noShows;
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

  const dash = '—';
  // Libellé sans durée : « Reach 30j » mentait sur les trois modes — un mois calendaire
  // n'a pas 30 jours, un mois passé n'est pas « les 30 derniers », et l'All-Time
  // couvre tout l'historique. La fenêtre est déjà écrite en toutes lettres dans
  // l'en-tête juste au-dessus (« Funnels & Efficacité — … »), une seule fois.
  const igFunnelSteps = [
    { label: 'Reach', value: noData ? dash : (igReachD >= 1000 ? `${fmt(igReachD / 1000, 1)}k` : fmt(igReachD)), rawValue: igReachD },
    { label: 'Clics liens Calendly', value: noData ? dash : fmt(igTotalClicsD), sub: 'bio + descr. + DM', rawValue: igTotalClicsD, rate: noData ? 0 : (igReachD > 0 ? (igTotalClicsD / igReachD) * 100 : 0) },
    { label: 'Calls bookés', value: fmt(igBookes), rawValue: igBookes, rate: igTotalClicsD > 0 ? (igBookes / igTotalClicsD) * 100 : 0 },
    { label: 'Calls honorés', value: fmt(igHonores), rawValue: igHonores, rate: igBookes > 0 ? (igHonores / igBookes) * 100 : 0 },
    { label: 'Deals closés', value: fmt(igCloses), rawValue: igCloses, rate: igHonores > 0 ? (igCloses / igHonores) * 100 : 0 },
    { label: 'Revenue', value: fmtEur(igRev), rawValue: igRev },
  ];

  const ytFunnelSteps = [
    { label: 'Vues', value: noData ? dash : (ytViewsD >= 1000 ? `${fmt(ytViewsD / 1000, 1)}k` : fmt(ytViewsD)), rawValue: ytViewsD },
    { label: 'Clics Calendly', value: noData ? dash : fmt(ytClicsD), sub: 'Bio + Descr.', rawValue: ytClicsD, rate: noData ? 0 : (ytViewsD > 0 ? (ytClicsD / ytViewsD) * 100 : 0) },
    { label: 'Calls bookés', value: fmt(ytBookes), rawValue: ytBookes, rate: ytClicsD > 0 ? (ytBookes / ytClicsD) * 100 : 0 },
    { label: 'Calls honorés', value: fmt(ytHonores), rawValue: ytHonores, rate: ytBookes > 0 ? (ytHonores / ytBookes) * 100 : 0 },
    { label: 'Deals closés', value: fmt(ytCloses), rawValue: ytCloses, rate: ytHonores > 0 ? (ytCloses / ytHonores) * 100 : 0 },
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
      const booked = cs.filter(c => c.status === 'active').length;
      const honored = cs.filter(c => isCallHonored(c, now)).length;
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
      if (metricIdx === 3) return taux(closed, honored);
      if (metricIdx === 4) return booked > 0 ? { date: iso, v: Math.round(rev / booked) } : trou;
      if (metricIdx === 5) return reachDay ? { date: iso, v: rev / reachDay } : trou;
      return { date: iso, v: rev };
    });
  }

  // Même rendu qu'un taux d'entonnoir (FunnelHorizontal) : « Close rate » figure aux
  // deux endroits, et affichait 66,7 % dans l'entonnoir contre 67 % dans le tableau,
  // pour la même mesure sur le même écran.
  const fmtRate = (a: number, b: number) => `${fmt((a / b) * 100, 1)}%`;
  type EffMetric = { label: string; value: string; prevValue: string | null; delta: { value: number; label: string; color: string } | null; lowerIsBetter: boolean };
  type EffRow = { platform: string; color: string; metrics: EffMetric[]; platformCalls: CallRecord[]; reachByDate: Map<string, number> };
  const igReachByDate = new Map<string, number>((ig?.chartData ?? []).filter(dd => inFunnelDateWindow(dd.date)).map(dd => [dd.date, dd.reach]));
  const ytReachByDate = new Map<string, number>((yt?.chartData ?? []).filter(dd => inFunnelDateWindow(dd.date)).map(dd => [dd.date, dd.views]));
  // ── Efficacité par plateforme (données réelles, pas de comparaison historique) ──
  const effRows: EffRow[] = [
    {
      platform: 'Instagram', color: IG_COLOR, platformCalls: callsIG, reachByDate: igReachByDate,
      metrics: [
        { label: 'Reach pour 1 call', value: igBookes > 0 ? fmt(Math.round(igReachD / igBookes)) : '—', prevValue: null, delta: null, lowerIsBetter: true },
        { label: 'Calls bookés', value: fmt(igBookes), prevValue: null, delta: null, lowerIsBetter: false },
        { label: 'No-show', value: igBookes > 0 ? fmtRate(igNoShows, igBookes) : '—', prevValue: null, delta: null, lowerIsBetter: true },
        { label: 'Close rate', value: igHonores > 0 ? fmtRate(igCloses, igHonores) : '—', prevValue: null, delta: null, lowerIsBetter: false },
        { label: 'Rev / call booké', value: igBookes > 0 ? fmtEur(Math.round(igRev / igBookes)) : '—', prevValue: null, delta: null, lowerIsBetter: false },
        // « Cash / vue » : Instagram mesure une portée, pas des vues — la colonne
        // voisine dit déjà « Reach pour 1 call ».
        { label: 'Cash / reach', value: igReachD > 0 ? fmtEur(igRev / igReachD) : '—', prevValue: null, delta: null, lowerIsBetter: false },
        { label: 'Revenue total', value: fmtEur(igRev), prevValue: null, delta: null, lowerIsBetter: false },
      ],
    },
    {
      platform: 'YouTube', color: YT_COLOR, platformCalls: callsYT, reachByDate: ytReachByDate,
      metrics: [
        { label: 'Vues pour 1 call', value: ytBookes > 0 ? fmt(Math.round(ytViewsD / ytBookes)) : '—', prevValue: null, delta: null, lowerIsBetter: true },
        { label: 'Calls bookés', value: fmt(ytBookes), prevValue: null, delta: null, lowerIsBetter: false },
        { label: 'No-show', value: ytBookes > 0 ? fmtRate(ytNoShows, ytBookes) : '—', prevValue: null, delta: null, lowerIsBetter: true },
        { label: 'Close rate', value: ytHonores > 0 ? fmtRate(ytCloses, ytHonores) : '—', prevValue: null, delta: null, lowerIsBetter: false },
        { label: 'Rev / call booké', value: ytBookes > 0 ? fmtEur(Math.round(ytRev / ytBookes)) : '—', prevValue: null, delta: null, lowerIsBetter: false },
        { label: 'Cash / vue', value: ytViewsD > 0 ? fmtEur(ytRev / ytViewsD) : '—', prevValue: null, delta: null, lowerIsBetter: false },
        { label: 'Revenue total', value: fmtEur(ytRev), prevValue: null, delta: null, lowerIsBetter: false },
      ],
    },
  ];

  // ── Calls filtrés pour la table (toujours live) ──
  const filteredCalls = callsFilter === 'ig' ? callsIG : callsFilter === 'yt' ? callsYT : callsInWindow;
  const filteredActifs = filteredCalls.filter(c => c.status === 'active');

  // Les totaux du hero portent sur TOUTES les sources — c'est ce que dit leur
  // sous-titre. Ils valaient `igBookes + ytBookes`, donc un call dont la source ne
  // commence ni par `ig` ni par `yt` en était absent, alors qu'il figurait bien dans
  // la table en dessous (filtre « Tous ») et au numérateur du taux de no-show. Le
  // dénominateur excluait ce que le numérateur comptait : le taux pouvait dépasser
  // 100 % (aucun cas en base au 2026-08-29, les 19 calls de vente ont tous une source
  // ig_* ou yt_*, mais rien ne l'interdit).
  const callsActifs  = callsInWindow.filter(c => c.status === 'active');
  const totalBookes  = callsActifs.length;
  const totalHonores = callsActifs.filter(c => isCallHonored(c, now)).length;
  const totalCloses  = callsActifs.filter(c => c.deal_closed).length;
  const totalRev     = callsActifs.reduce((acc, c) => acc + (c.revenue || 0), 0);
  const noShowCount  = callsActifs.filter(c => c.no_show).length;
  const closingRate  = totalHonores > 0 ? pct(totalCloses, totalHonores) : 0;
  const noShowRate   = totalBookes > 0 ? pct(noShowCount, totalBookes) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 48 }}>

      {/* ── HERO — STATS GLOBALES ── */}
      {(() => {
        const revPerCall = totalBookes > 0 ? Math.round(totalRev / totalBookes) : 0;

        const heroItems = [
          { label: 'Calls bookés',  value: fmt(totalBookes),   sub: 'toutes sources' },
          { label: 'Calls IG',      value: fmt(igBookes),      sub: `${igCloses} closés` },
          { label: 'Calls YT',      value: fmt(ytBookes),      sub: `${ytCloses} closés` },
          { label: 'Calls honorés', value: fmt(totalHonores),  sub: `${noShowRate}% no-show` },
          { label: 'No-show',       value: fmt(noShowCount),   sub: `${noShowRate}% des bookés` },
          { label: 'Deals closés',  value: fmt(totalCloses),   sub: `${closingRate}% closing` },
          { label: 'Revenue total', value: fmtEur(totalRev),   sub: 'cumulé' },
          { label: 'Rev / call',    value: fmtEur(revPerCall), sub: 'par call booké' },
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
                    <div className="eyebrow-sm" style={{ color: 'var(--muted)', marginBottom: 8 }}>{h.label}</div>
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
                        if (key === 'booked') return { date, v: daySubset.length };
                        if (key === 'honored') return { date, v: daySubset.filter(c => isCallHonored(c, now)).length };
                        if (key === 'closed') return { date, v: daySubset.filter(c => c.deal_closed).length };
                        if (key === 'rev') return { date, v: daySubset.reduce((s, c) => s + (c.revenue || 0), 0) };
                        // revPerCall : un ratio n'existe pas sans dénominateur — un jour
                        // sans call booké est un trou, pas un « 0 € par call ».
                        if (daySubset.length === 0) return { date, v: null as any };
                        return { date, v: Math.round(daySubset.reduce((s, c) => s + (c.revenue || 0), 0) / daySubset.length) };
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
                        <ReAreaChart data={chart.data} margin={{ top: 4, right: 8, left: 0, bottom: 24 }}>
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
                          <Tooltip content={({ active, payload, label }) => {
                            if (!active || !payload?.length) return null;
                            return <div className="chart-tooltip"><div className="chart-tooltip-label">{label}</div><div className="chart-tooltip-row"><strong>{chart.fmtV(payload[0].value as number)}</strong></div></div>;
                          }} />
                          <Area type="monotone" dataKey="v" stroke={chart.color} strokeWidth={2} fill="url(#grad-hero-modal)" dot={todayDotFactory(chart.color, 'date', lastRealPointKey(chart.data, 'date', 'v'))} activeDot={{ r: 4, strokeWidth: 0, fill: chart.color }} isAnimationActive={false} />
                        </ReAreaChart>
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
                      onClick={() => { setExpandedEff({ label: `${row.platform} — ${m.label}`, value: m.value, color: row.color, estPct: mi === 2 || mi === 3, estClosing: mi === 3, data: effData }); onModalChange?.(true); }}
                      style={{ padding: '14px 10px', borderLeft: mi > 0 ? '1px solid var(--border-soft)' : 'none', cursor: 'pointer', transition: 'background .15s' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                      onMouseLeave={e => e.currentTarget.style.background = ''}
                    >
                      <div className="eyebrow-sm" style={{ color: 'var(--muted)', marginBottom: 6 }}>{m.label}</div>
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
                <Tooltip cursor={expandedEff.estClosing ? { fill: 'var(--surface-2)' } : undefined} content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  return <div className="chart-tooltip"><div className="chart-tooltip-label">{label}</div><div className="chart-tooltip-row"><strong>{Math.round(payload[0].value as number)}{expandedEff.estPct ? ' %' : ''}</strong></div></div>;
                }} />
                {/* Le closing est la SEULE serie assez creuse pour qu'une courbe mente.
                    Sur aout : 3 journees mesurees sur 31 — les 28 autres n'ont aucun
                    appel honore, donc aucun taux. La courbe n'y laissait que trois points
                    orphelins, qu'on lit comme un graphique casse ; la barre absente, elle,
                    EST le trou. Partout ailleurs la serie a une valeur chaque jour, et la
                    courbe montre la tendance mieux que des barres. */}
                {expandedEff.estClosing ? (
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
            { label: 'Bookés', value: fmt(filteredActifs.length), color: 'var(--ink)' },
            { label: 'Honorés', value: fmt(filteredActifs.filter(c => isCallHonored(c, now)).length), color: GREEN },
            { label: 'No-show', value: fmt(filteredActifs.filter(c => c.no_show).length), color: RED },
            { label: 'Closés', value: fmt(filteredActifs.filter(c => c.deal_closed).length), color: 'var(--accent)' },
            { label: 'Revenue', value: fmtEur(filteredActifs.reduce((acc, c) => acc + (c.revenue || 0), 0)), color: GREEN },
          ].map((s, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div className="eyebrow-sm" style={{ color: 'var(--muted)' }}>{s.label}</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>

        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Date', 'Client', 'Source', 'Statut', 'No-show', 'Closé', 'Revenue'].map((h, i) => (
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
                const statusLabel = isCanceled
                  ? (c.rescheduled ? 'Rebooké' : 'Annulé')
                  : c.no_show ? 'No-show'
                  : honored ? 'Honoré'
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
function CashByOrigin({ profileId, periodStart, periodEnd, sinceConnection }: {
  profileId?: string;
  periodStart: Date;
  periodEnd: Date;
  sinceConnection?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);

  // En mode "depuis connexion" le fetch est déjà borné en amont : ne pas
  // re-clipper sur la fenêtre calendaire, qui écraserait ce bornage.
  const start = sinceConnection ? undefined : periodStart.toISOString();
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
  const visible = showAll ? rows : rows.slice(0, 5);

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

          {rows.length > 5 && (
            <button
              onClick={() => setShowAll(v => !v)}
              style={{
                marginTop: 10, width: '100%', padding: '8px 0',
                fontSize: 12, fontWeight: 600, color: 'var(--muted)',
                background: 'none', border: 'none', cursor: 'pointer',
              }}
            >
              {showAll ? 'Voir moins' : `Voir plus (${rows.length - 5})`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function TabRevenues({ stripe, calls, deals, period, periodIndex, onRefresh, refreshing, sinceConnection, profileId }: { stripe: StripeStats | null; calls: CallRecord[]; deals?: DealRecord[]; period: Period; periodIndex: number; onRefresh?: () => void; refreshing?: boolean; sinceConnection?: boolean; profileId?: string }) {
  if (!stripe) return (
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

  // En mode "depuis connexion", stripe/calls sont déjà bornés [connectedAt, aujourd'hui]
  // par le fetch — ne pas re-clipper avec la fenêtre calendaire du mois/semaine en cours.
  const allInPeriod = sinceConnection ? stripe.recentPayments : stripe.recentPayments.filter(p => {
    const d = new Date(p.date);
    return d >= periodStart && d <= periodEnd;
  });
  const succeeded = allInPeriod.filter(p => p.status === 'succeeded');

  const callsInPeriod = sinceConnection ? calls : calls.filter(c => {
    const d = new Date(callPeriodDate(c));
    return d >= periodStart && d <= periodEnd;
  });
  // Cash contracté de cet écran : somme des `calls.revenue` des calls closés de la
  // période, donc rattaché au mois de RÉSERVATION du call depuis le passage de
  // callsInPeriod sur booked_at.
  //
  // ⚠️ L'accueil (useCoachData) rattache lui son cash contracté au mois de SIGNATURE
  // du deal (`deals.signed_at`) — un deal signé en relance appartient au mois où
  // l'argent a été engagé. Les deux écrans peuvent donc diverger dès qu'une signature
  // ne tombe pas dans le mois de son call. Aucun cas à ce jour : le cycle réservation
  // → signature est de quelques heures (mesuré le 2026-08-19, max 1 jour).
  //
  // La convergence passe par le chantier « cash sur la table deals » (les deals sans
  // call, upsells, sont aussi invisibles ici) — voir docs/perimetre-stats-referentiel.md,
  // section « Ce qui reste ouvert ».
  // Cash contracté : somme des DEALS signés dans la période, plus des `calls.revenue`.
  //
  // Un deal peut exister SANS call — upsell, vente hors pipeline. Le sommer depuis les
  // calls le rendait invisible : c'était le dernier écart à impact financier réel
  // (identifié le 2026-08-19 ; 0 cas en base à cette date, 6 600 € des deux côtés,
  // donc aucun chiffre ne bouge aujourd'hui).
  //
  // Découpé sur `signed_at`, volontairement une AUTRE date que les calls : un deal
  // signé ce mois sur un call du mois dernier appartient au cash de ce mois — c'est le
  // mois où l'argent a été engagé. Même règle que useCoachData : les deux écrans
  // convergent désormais sur la même source ET la même date.
  //
  // Deals annulés exclus (une vente annulée n'a pas été signée), même filtre que
  // computeDealTotals dans lib/salesCallStats.ts.
  const dealsInPeriod = (deals ?? []).filter(d => {
    if (d.status === 'canceled') return false;
    if (sinceConnection) return true;
    if (!d.signed_at) return false;
    const ds = new Date(d.signed_at);
    return ds >= periodStart && ds <= periodEnd;
  });
  const cashContracte = dealsInPeriod.reduce((s, d) => s + Number(d.amount_total || 0), 0);
  // Conservé : le panier moyen et le compte de ventes raisonnent en calls closés.
  const dealsClosed = callsInPeriod.filter(c => c.deal_closed);

  // Number() explicite : les numeric Postgres arrivent en chaîne, et une
  // concaténation silencieuse ("10" + "20" = "1020") passerait le typage.
  const cashCollecte = succeeded.reduce((s, p) => s + Number(p.amount || 0), 0);
  // Panier moyen = ce que vaut une VENTE, donc sur le contracté et le nombre de
  // deals — pas sur le collecté divisé par le nombre de paiements, qui ferait
  // chuter la moyenne dès qu'un deal est payé en 3× (3 paiements pour 1 vente).
  const avgBasket = dealsClosed.length > 0 ? cashContracte / dealsClosed.length : 0;
  const cashCollectePct = cashContracte > 0 ? Math.round((cashCollecte / cashContracte) * 100) : 0;

  // Nombre réel de jours dans la période (7 pour une semaine, 28-31 pour un mois
  // calendaire variable) — pas une longueur fixe supposée depuis `period`. Plafonné à
  // aujourd'hui : en milieu de semaine/mois, periodEnd peut être dans le futur, ce qui
  // afficherait sinon des jours à 0€ qui n'ont pas encore eu lieu.
  const revenueByDay: { date: string; ca: number; contracte: number }[] = (() => {
    const todayStr = parisDateStr(new Date());
    const rows: { date: string; ca: number; contracte: number }[] = [];
    let d = periodStart;
    while (d.getTime() <= periodEnd.getTime()) {
      const iso = parisDateStr(d);
      if (iso > todayStr) break; // plafonne à aujourd'hui, comme avant (pas de jours futurs à 0€)
      const ca = succeeded.filter(p => p.date.startsWith(iso)).reduce((s, p) => s + p.amount, 0);
      // Même date que callsInPeriod, qui alimente dealsClosed (callPeriodDate, donc
      // booked_at) : sans ça, la somme des barres du graphique ne vaudrait plus le
      // total « Cash contracté » affiché au-dessus.
      // Même source ET même date que le total affiché au-dessus : les deals, découpés
      // sur signed_at. Garder les calls ici ferait diverger la somme des barres du
      // total dès qu'un deal existe sans call.
      const contracte = dealsInPeriod
        .filter(d => (d.signed_at ?? '').startsWith(iso))
        .reduce((s, d) => s + Number(d.amount_total || 0), 0);
      rows.push({ date: iso, ca, contracte });
      d = parisAddDays(d, 1);
    }
    return rows;
  })();

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
          <div style={{ fontSize: 10, color: 'var(--faint)', marginTop: 4 }}>deals closés ({dealsClosed.length})</div>
        </div>
        <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '12px 14px' }}>
          <div className="eyebrow-sm" style={{ color: 'var(--muted)', marginBottom: 6 }}>Cash collecté</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: GREEN, lineHeight: 1 }}>{fmtEur(cashCollecte)}</div>
          <div style={{ fontSize: 10, color: 'var(--faint)', marginTop: 4 }}>paiements reçus ({succeeded.length})</div>
        </div>
        <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '12px 14px' }}>
          <div className="eyebrow-sm" style={{ color: 'var(--muted)', marginBottom: 6 }}>Panier moyen</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink)', lineHeight: 1 }}>{fmtEur(Math.round(avgBasket))}</div>
          <div style={{ fontSize: 10, color: 'var(--faint)', marginTop: 4 }}>{dealsClosed.length > 0 ? `sur ${dealsClosed.length} deal${dealsClosed.length > 1 ? 's' : ''}` : 'aucun deal'}</div>
        </div>
        <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '12px 14px' }}>
          <div className="eyebrow-sm" style={{ color: 'var(--muted)', marginBottom: 6 }}>Taux de cash collecté</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: cashCollectePct >= 80 ? GREEN : cashCollectePct >= 50 ? AMBER : RED, lineHeight: 1 }}>{cashCollectePct}%</div>
          <div style={{ fontSize: 10, color: 'var(--faint)', marginTop: 4 }}>collecté / contracté</div>
        </div>
      </div>

      <Card title="Revenus / jour" sub={periodIndex === 0 ? `${period} derniers jours · deals closés & paiements Stripe` : `${periodLabel(period, periodIndex)} · deals closés & paiements Stripe`}>
        <BarChart data={revenueByDay} bars={[{ key: 'contracte', label: 'Cash contracté', color: 'var(--accent-brand)' }, { key: 'ca', label: 'Cash collecté', color: GREEN }]} xKey="date" height={200} formatter={fmtEur} xInterval={period === 7 ? 0 : Math.floor(revenueByDay.length / 7) - 1} />
      </Card>

      {/* Empilé pleine largeur sous le graphique, jamais en colonne à côté. */}
      <CashByOrigin profileId={profileId} periodStart={periodStart} periodEnd={periodEnd} sinceConnection={sinceConnection} />

      <div className="card">
        <div className="card-head">
          <div className="card-title">Derniers paiements</div>
        </div>
        <table className="table" style={{ width: '100%' }}>
          <thead>
            <tr>
              {['Date', 'Description', 'Montant', 'Statut'].map((h, i) => (
                <th key={i} className="eyebrow-sm" style={{ textAlign: 'left', color: 'var(--muted)', padding: '8px 10px' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stripe.recentPayments.map((p, i) => (
              <tr key={i} style={{ borderTop: '1px solid var(--border-soft)' }}>
                <td style={{ padding: '10px', fontSize: 12, color: 'var(--muted)' }}>{new Date(p.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: '2-digit' })}</td>
                <td style={{ padding: '10px', fontSize: 12 }}>{p.description || '—'}</td>
                <td style={{ padding: '10px', fontSize: 13, fontWeight: 700 }}>{fmtEur(p.amount)}</td>
                <td style={{ padding: '10px' }}>
                  <span style={{ fontSize: 11, color: p.status === 'succeeded' ? GREEN : RED, fontWeight: 600 }}>
                    {p.status === 'succeeded' ? 'Réussi' : 'Échoué'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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

function TabShortioB({ shortio, shortioLoading, ig, yt, leads, leadMagnets, destinations, lmHistory, period: globalPeriod, periodIndex, profileId, prospectLinksData, clicksByPath, clicksByUrl, urlToCategoryFromDb, businessClicsFromDb, totalClicsChangePct, altKwToLmId, lmClickedByLeadId, linkClickedByLeadId, calls, callsAllTime, leadIdToMediaId, igLive, ytLive, shortioChartHistory, shortioChartHistoryBio, shortioChartHistoryContent, shortioChartHistoryDm, shortioChartHistoryStory, joursCollectesShortio, selectedMetric, setSelectedMetric, chartFilter, setChartFilter, sinceConnection, integrationsReadyAt, allTimeStart }: {
  shortio: ShortioStats | null;
  shortioLoading?: boolean;
  ig: IGStats | null;
  yt: YTStats | null;
  leads: MockLead[];
  leadMagnets: LeadMagnet[];
  lmHistory?: { ig_user_id: string; keyword_matched: string; media_id: string | null; lead_magnet_sent: boolean; detected_at: string }[];
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
  const [showAllTable, setShowAllTable] = useState(false);
  // Modale "Voir tout" (performance par contenu) : Echap la ferme. Les autres
  // couches de cette page (post, video, story selectionnes) vivent dans des
  // sous-composants distincts et sont a traiter separement.
  useEscapeKey(() => setShowAllTable(false), showAllTable);
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
  const isInPeriod = (ts: string | null | undefined) => {
    if (sinceConnection) return !!ts;
    if (!ts) return false;
    const t = new Date(ts).getTime();
    return t >= periodCutoff && (_pIdx === 0 || t <= periodEndMs);
  };
  const leadsInPeriod = leads.filter(l => isInPeriod(l.commentedAt));
  // Historique complet des interactions LM datées (une ligne par vraie interaction,
  // jamais écrasée) — utilisé pour "Leads commentaires" (graphique par jour) à la place
  // de leadsInPeriod, qui ne compte qu'une ligne par personne (état courant écrasé à
  // chaque nouvelle interaction). Cf. fix Performance LM (même session) pour le détail.
  const lmHistoryInPeriod = (lmHistory ?? []).filter(h => isInPeriod(h.detected_at));

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
  const lmEnvoyes = leadsInPeriod.filter(l => l.leadMagnetSent).length;
  // Numérateur strictement inclus dans le dénominateur : cette carte mesure la
  // performance du lead magnet ("parmi ceux à qui j'ai envoyé un LM, combien ont
  // répondu ?"), donc seule une réponse d'un lead AYANT reçu un LM la concerne.
  // Sans le `&& l.leadMagnetSent`, un cold DM (démarché à la main, jamais de LM
  // envoyé) comptait au numérateur sans jamais pouvoir compter au dénominateur —
  // observé à 133 % (4 réponses / 3 LM envoyés). Les cold DM restent comptés dans
  // la carte Leads et dans le Pipeline, ils sortent seulement de CE ratio.
  const hookReplies = leadsInPeriod.filter(l => l.hookReplied && l.leadMagnetSent).length;
  const tauxHookReply = lmEnvoyes > 0 ? Math.round((hookReplies / lmEnvoyes) * 100) : 0;
  // Liens Calendly envoyés DM — source de vérité : DB uniquement
  const calendlyLinksSent = prospectLinksDb.filter(l => {
    if (!wasCalendlyLinkSent(l, linkClickedByLeadId)) return false;
    return isInPeriod(calendlySentAt(l, linkClickedByLeadId));
  });
  const lmCalendlyLinks = calendlyLinksSent.length;
  const calendlyActivatedDb = calendlyLinksSent.filter(l => l.first_click_at != null).length;
  // calls filtrés par la fenêtre de période (en S-0, callsEff n'a pas de borne haute)
  const callsInWindow = (calls ?? []).filter(c => isInPeriod(callPeriodDate(c)));
  const callsBooked = callsInWindow.filter(c => c.status === 'active').length;
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
  const leadsPerDay = new Map<string, number>();
  for (const h of lmHistoryInPeriod) {
    const day = utcDateStr(new Date(h.detected_at));
    leadsPerDay.set(day, (leadsPerDay.get(day) ?? 0) + 1);
  }
  const leadsSeries = regrouperComptage(dayRange, granularite, date => isOutsideCoverage(date) ? null : (leadsPerDay.get(date) ?? 0));

  // 3. Réponses accroche LM DM — vrai timestamp hook_replied_at (ajouté au select ci-dessus)
  const hookRepliesPerDay = new Map<string, number>();
  for (const l of leadsInPeriod) {
    if (!l.hookReplied || !l.hookRepliedAt) continue;
    if (!isInPeriod(l.hookRepliedAt)) continue;
    const day = utcDateStr(new Date(l.hookRepliedAt));
    hookRepliesPerDay.set(day, (hookRepliesPerDay.get(day) ?? 0) + 1);
  }
  const hookReplySeries = regrouperComptage(dayRange, granularite, date => isOutsideCoverage(date) ? null : (hookRepliesPerDay.get(date) ?? 0));

  // 4. Liens Calendly envoyés DM — calendly_link_sent_at ?? created_at, sur calendlyLinksSent (déjà filtré période)
  const calendlyLinksPerDay = new Map<string, number>();
  for (const l of calendlyLinksSent) {
    const ts = l.calendly_link_sent_at ?? l.created_at;
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
    const day = utcDateStr(new Date(l.calendly_link_sent_at ?? l.created_at));
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
  for (const c of callsInWindow) {
    const day = utcDateStr(new Date(callPeriodDate(c)));
    const cur = callsPerDay.get(day) ?? { booked: 0, honored: 0, closed: 0, revenue: 0 };
    if (c.status === 'active') {
      cur.booked += 1;
      if (isCallHonored(c, now)) cur.honored += 1;
    }
    if (c.deal_closed) cur.closed += 1;
    cur.revenue += c.revenue || 0;
    callsPerDay.set(day, cur);
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
      .filter((l: any) => isValidPostId(l.postId) && !['bio-ig', 'bio-yt'].includes(l.postId))
      .map((l: any) => l.postId + '|' + (l.postPlatform || (isValidYtVideoId(l.postId) ? 'YT' : 'IG'))),
    // Basé sur lmHistory (media_id figé par interaction), pas leads.postId (état courant du
    // lead, écrasé par sa DERNIÈRE interaction) — sinon un post/story ancien qui n'a plus
    // que des leads "périmés" par une interaction plus récente ailleurs disparaît du tableau.
    ...(lmHistory ?? []).filter(h => {
      if (!h.lead_magnet_sent || !isValidPostId(h.media_id, isValidYtVideoId(h.media_id) ? 'YT' : 'IG')) return false;
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
    const lmKeyword = postLeads[0]?.keyword || null;
    const lmName = lmKeyword ? (lmNameByKeyword.get(lmKeyword.toLowerCase()) ?? lmKeyword) : null;

    const clicsDesc = linkClics(descLink) || 0;
    const postLeadsInPeriod = postLeads.filter(l => isInPeriod(l.commentedAt));
    const lmDetectes = postLeadsInPeriod.length;
    const lmSent = postLeadsInPeriod.filter((l: MockLead) => l.leadMagnetSent).length;
    const lmClics = postLeadsInPeriod.filter((l: MockLead) => l.id && lmClickedByLeadId?.has(l.id)).length;
    // `postLeadsInPeriod` et non `postLeads` : cette colonne était la SEULE de la
    // ligne à ignorer la période. Un vieux contenu la gonflait quelle que soit la
    // fenêtre affichée, et elle pouvait donc dépasser « Commentaires LM » juste
    // au-dessus — plus de conversations que de commentaires, ce qui est
    // impossible et donnait un taux de réponse supérieur à 100 %.
    const lmReponses = postLeadsInPeriod.filter((l: MockLead) => l.hookReplied).length;
    const dmCount = dmProspects.length;
    // Calls bookés/closés/revenue depuis la table calls (source de vérité)
    // postCalls = calls rattachés à ce contenu (DM + description), filtrés sur la période sélectionnée (scheduled_at)
    // postCallsDesc = uniquement via lien description (utm_medium = 'description') — pour breakdown par source
    // Priorité à utm_content (rempli au clic du lien Calendly précis, daté et lié au
    // bon contenu au moment du booking) plutôt qu'à ig_lead_id → leadIdToMediaId (état
    // COURANT mutable de instagram_leads, qui s'écrase à chaque nouvelle interaction
    // de la même personne — un call booké en janvier depuis un post se retrouverait
    // attribué à tort à une story réclamée par la même personne en juillet). Fallback
    // sur ig_lead_id seulement si utm_content est absent (ex: cold DM sans lien traqué).
    // `source === 'ig_dm'` : même garde que la vue des posts. Sans elle, un call
    // fusionné venu d'une bio serait attribué au contenu dont le lead vient.
    const matchesContent = (c: CallRecord) => c.utm_content ? c.utm_content === postId : (c.source === 'ig_dm' && c.ig_lead_id ? leadIdToMediaId?.get(c.ig_lead_id) === postId : false);
    const postCalls = (calls && leadIdToMediaId)
      ? calls.filter(c => matchesContent(c) && isInPeriod(callPeriodDate(c)))
      : [];
    // Calls lifetime (depuis publication du contenu) — pour Cash/Vue et % qualifié, indépendant du filtre
    // de période. Source = callsAllTime (jamais coupé par periodIndex), PAS calls (= callsEff, qui EST
    // filtré sur la fenêtre de la période affichée dès que periodIndex > 0 — cf. callsHist/fetchSnapshot).
    const postCallsLifetime = (callsAllTime && leadIdToMediaId) ? callsAllTime.filter(matchesContent) : [];
    const postCallsDesc = postCalls.filter(c => c.utm_medium === 'description' || (!c.ig_lead_id && c.utm_content === postId));
    const callsBooked = postCalls.filter(c => c.status === 'active').length;
    const callsHonored = postCalls.filter(c => isCallHonored(c, now)).length;
    const closed = postCalls.filter(c => c.deal_closed).length;
    const revenue = postCalls.reduce((s: number, c: any) => s + (c.revenue || 0), 0);
    const callsBookedDesc = postCallsDesc.filter(c => c.status === 'active').length;
    const callsHonoredDesc = postCallsDesc.filter(c => isCallHonored(c, now)).length;
    const closedDesc = postCallsDesc.filter(c => c.deal_closed).length;
    const revenueDesc = postCallsDesc.reduce((s: number, c: any) => s + (c.revenue || 0), 0);
    // « via lead magnet » se lit sur la source, pas sur le rattachement — même
    // correction que le tunnel de l'accueil (commit 4a7a792).
    const postCallsLm = postCalls.filter(c => c.source === 'ig_dm');
    const callsBookedLm = postCallsLm.filter(c => c.status === 'active').length;
    const callsHonoredLm = postCallsLm.filter(c => isCallHonored(c, now)).length;
    const closedLm = postCallsLm.filter(c => c.deal_closed).length;
    const revenueLm = postCallsLm.reduce((s: number, c: any) => s + (c.revenue || 0), 0);
    const vuesParCall = callsBooked > 0 && views > 0 ? Math.round(views / callsBooked) : null;

    // Cash/Vue lifetime : revenue cumulé depuis publication / vues cumulées depuis publication
    const revenueLifetime = postCallsLifetime.reduce((s, c) => s + (c.revenue || 0), 0);
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

    return { postId, platform, title, thumbnail, type, views, descLink, dmProspects, lmDetectes, lmSent, lmClics, lmReponses, dmCount, clicsDesc, callsBooked, callsHonored, closed, revenue, callsBookedDesc, callsHonoredDesc, closedDesc, revenueDesc, callsBookedLm, callsHonoredLm, closedLm, revenueLm, vuesParCall, cashParVue, qualifiedPct, qualifiedCount, qualifiedAnswered, lmName, postCallsDesc };
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
    vuesParCall: seq.callsBooked > 0 && seq.views > 0 ? Math.round(seq.views / seq.callsBooked) : null,
    cashParVue: null,
    qualifiedPct: null, qualifiedCount: 0, qualifiedAnswered: 0,
    lmName: seq.lmKeyword ? `#${seq.lmKeyword}` : null,
    postCallsDesc: [],
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

  const SectionHead = ({ title, sub, action }: { title: string; sub?: string; action?: React.ReactNode }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{title}</div>
        {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>}
      </div>
      {action}
    </div>
  );

  return (
    <div className="stack">

      {/* ── Section 0 : Stats globales ── */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px 22px' }}>
        <SectionHead title="Vue d'ensemble" sub="Tracking complet — tous liens confondus" />
        {(() => {
          // Clics LM réels : même logique que le pipeline — prospect_events.lm_clicked postérieur à detected_at
          // `&& l.leadMagnetSent` : le dénominateur est lmEnvoyes, donc le numérateur ne
          // doit contenir que des leads ayant effectivement reçu un LM (un clic sur un
          // lien LM sans envoi enregistré sortirait le ratio au-dessus de 100 %).
          const lmClics = leadsInPeriod.filter((l: MockLead) => l.id && l.leadMagnetSent && lmClickedByLeadId?.has(l.id)).length;
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
          const toggleMetric = (metric: typeof selectedMetric) => setSelectedMetric(metric);

          return (
            <div style={{ display: 'flex', gap: 8, marginBottom: 20, alignItems: 'stretch' }}>

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

              <div style={{ width: 1, background: 'var(--border)', alignSelf: 'stretch' }} />

              {/* 5 — Calls bookés depuis liens */}
              <div onClick={() => toggleMetric('calls')} style={cardStyle('calls')}>
                <div className="eyebrow-sm" style={libelleCarte}>Calls bookés</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: callsTotal > 0 ? GREEN : 'var(--faint)', lineHeight: 1 }}>{callsTotal}</div>
                <div style={legendeCarte}>résultat final du tracking</div>
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
            <ResponsiveContainer width="100%" height={160}>
              <ReAreaChart data={activationSeries} margin={{ top: 4, right: 8, left: 0, bottom: 24 }}>
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={!parJour ? fmtAxisBucket : (sPeriod === 7 ? fmtAxisDateWithDay : fmtAxisDate)} interval={graduationsDates(activationSeries.length, sPeriod)} padding={{ left: 0, right: 0 }} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={36} unit="%" domain={[-4, 100]} />
                <Tooltip content={({ active, payload, label }) => !active || !payload?.length ? null : (
                  <div className="chart-tooltip"><div className="chart-tooltip-label">{label}</div>
                    {payload.map((p: any, i: number) => (
                      <div key={i} className="chart-tooltip-row" style={{ color: p.color }}><span>{p.name}</span><strong style={{ marginLeft: 8 }}>{p.value}%</strong></div>
                    ))}
                  </div>
                )} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area type="monotone" dataKey="lm" name="LM" stroke={AMBER} strokeWidth={2} fill="none" dot={todayDotFactory(AMBER, 'date', lastRealPointKey(activationSeries, 'date', 'lm'))} isAnimationActive={false} />
                <Area type="monotone" dataKey="calendly" name="Calendly" stroke={BLUE} strokeWidth={2} fill="none" dot={todayDotFactory(BLUE, 'date', lastRealPointKey(activationSeries, 'date', 'calendly'))} isAnimationActive={false} />
              </ReAreaChart>
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
          const bioIGBooked = bioIGCalls.filter(c => c.status === 'active').length;
          const bioIGHonored = bioIGCalls.filter(c => isCallHonored(c, now)).length;
          const bioIGClosed = bioIGCalls.filter(c => c.deal_closed === true).length;
          const bioIGRevenue = bioIGCalls.reduce((s: number, c: any) => s + (c.revenue || 0), 0);
          const bioYTBooked = bioYTCalls.filter(c => c.status === 'active').length;
          const bioYTHonored = bioYTCalls.filter(c => isCallHonored(c, now)).length;
          const bioYTClosed = bioYTCalls.filter(c => c.deal_closed === true).length;
          const bioYTRevenue = bioYTCalls.reduce((s: number, c: any) => s + (c.revenue || 0), 0);

          const isLMProspect = (l: any) => {
            if (l.ig_lead_id) {
              const lead = leads.find((ml: any) => ml.id === l.ig_lead_id);
              return !!lead?.leadMagnetSent;
            }
            if (l.ig_username) {
              const lead = leads.find((ml: any) => ml.igUsername === l.ig_username);
              return !!lead?.leadMagnetSent;
            }
            return false;
          };
          const dmDirectLinks = prospectLinks.filter((l: any) => !isLMProspect(l));

          // Cold DM = coach a initié la conversation (instagram_leads.source === 'cold_dm',
          // posé par le vrai webhook Instagram — app/api/webhooks/instagram/route.ts). Le
          // webhook ne pose jamais 'organic' littéralement : DM organique = tout DM direct
          // dont le lead existe mais dont source n'est PAS 'cold_dm' (donc initié par le
          // prospect). Sans lead correspondant (lien créé hors flux Instagram), on classe
          // par défaut en Cold DM faute de mieux — même choix par défaut que l'ancien champ
          // dmType, jamais peuplé.
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
          const coldDMLinks = dmDirectLinks.filter((l: any) => sourceForLink(l) !== 'story_reply' && sourceForLink(l) !== 'comment' && dmLinkSentInPeriod(l));
          const organicDMLinks = dmDirectLinks.filter((l: any) => sourceForLink(l) === 'comment' && dmLinkSentInPeriod(l));
          const storyReplyDMLinks = dmDirectLinks.filter((l: any) => sourceForLink(l) === 'story_reply' && dmLinkSentInPeriod(l));

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
          const callsByLeadInWindow = new Map<string, typeof callsInWindow>();
          for (const c of callsInWindow) {
            if (!c.ig_lead_id) continue;
            const list = callsByLeadInWindow.get(c.ig_lead_id);
            if (list) list.push(c);
            else callsByLeadInWindow.set(c.ig_lead_id, [c]);
          }
          // Renvoie les calls d'une liste de liens, dédupliqués par call.id.
          const callsForLinks = (links: any[]) => {
            const seen = new Set<string>();
            const out: typeof callsInWindow = [];
            for (const l of links) {
              if (!l.ig_lead_id) continue;
              for (const c of callsByLeadInWindow.get(l.ig_lead_id) ?? []) {
                if (seen.has(c.id)) continue;
                seen.add(c.id);
                out.push(c);
              }
            }
            return out;
          };

          // Même séparation que pour les leads LM plus bas : les listes *DMLinks
          // restent bornées à la période (colonnes « liens envoyés » et « clics »),
          // mais le rattachement des CALLS part de tous les liens du prospect. Sans
          // ça, un prospect ayant reçu son lien avant la période mais réservé pendant
          // voyait son call tomber en « Autre / non catégorisé ».
          // callsForLinks ne remonte que des calls de callsByLeadInWindow, déjà borné
          // à la période : élargir les liens n'élargit donc pas les calls.
          const allDmLinksBySource = (pred: (l: any) => boolean) =>
            dmDirectLinks.filter((l: any) => pred(l) && wasCalendlyLinkSent(l, linkClickedByLeadId));
          const coldDMLinksAll    = allDmLinksBySource(l => sourceForLink(l) !== 'story_reply' && sourceForLink(l) !== 'comment');
          const organicDMLinksAll = allDmLinksBySource(l => sourceForLink(l) === 'comment');
          const storyReplyLinksAll = allDmLinksBySource(l => sourceForLink(l) === 'story_reply');

          const coldCalls = callsForLinks(coldDMLinksAll);
          const coldBooked = coldCalls.filter(c => c.status === 'active').length;
          const coldHonored = coldCalls.filter(c => isCallHonored(c, now)).length;
          const coldClosed = coldCalls.filter(c => c.deal_closed === true).length;
          const coldRevenue = coldCalls.reduce((s: number, c: any) => s + (c.revenue || 0), 0);
          const coldClics = coldDMLinks.filter((l: any) => l.ig_lead_id && linkClickedByLeadId?.has(l.ig_lead_id)).length;

          const organicCalls = callsForLinks(organicDMLinksAll);
          const organicBooked = organicCalls.filter(c => c.status === 'active').length;
          const organicHonored = organicCalls.filter(c => isCallHonored(c, now)).length;
          const organicClosed = organicCalls.filter(c => c.deal_closed === true).length;
          const organicRevenue = organicCalls.reduce((s: number, c: any) => s + (c.revenue || 0), 0);
          const organicClics = organicDMLinks.filter((l: any) => l.ig_lead_id && linkClickedByLeadId?.has(l.ig_lead_id)).length;

          // "Story - Lead Magnet" : calls dont le lead vient d'un reply à une story
          // (source='story_reply') — pivot toujours story_sequence_id en amont, jamais
          // ig_story_id seul (cf. principe d'attribution du chantier Stories).
          const storyLmCalls = callsForLinks(storyReplyLinksAll);
          const storyLmBooked = storyLmCalls.filter(c => c.status === 'active').length;
          const storyLmHonored = storyLmCalls.filter(c => isCallHonored(c, now)).length;
          const storyLmClosed = storyLmCalls.filter(c => c.deal_closed === true).length;
          const storyLmRevenue = storyLmCalls.reduce((s: number, c: any) => s + (c.revenue || 0), 0);
          const storyLmClics = storyReplyDMLinks.filter((l: any) => l.ig_lead_id && linkClickedByLeadId?.has(l.ig_lead_id)).length;

          // "Story - Calendly" : calls dont utm_content matche une séquence story dont
          // le bloc Calendly est configuré (utm_content=sequenceId, généré au moment de
          // la création ou de la génération après coup — voir POST/PATCH story-sequences).
          const calendlySequenceIds = new Set(storySequenceRows.filter(s => !!s.calendlyShortUrl).map(s => s.sequenceId));
          const storyCalendlyCalls = callsInWindow.filter(c => c.utm_content && calendlySequenceIds.has(c.utm_content));
          const storyCalendlyBooked = storyCalendlyCalls.filter(c => c.status === 'active').length;
          const storyCalendlyHonored = storyCalendlyCalls.filter(c => isCallHonored(c, now)).length;
          const storyCalendlyClosed = storyCalendlyCalls.filter(c => c.deal_closed === true).length;
          const storyCalendlyRevenue = storyCalendlyCalls.reduce((s: number, c: any) => s + (c.revenue || 0), 0);

          // LM : liens envoyés = filtrés sur calendly_link_sent_at (comme avant) pour le
          // KPI "liens Calendly envoyés", mais calls booked/honored/closed = tout lead LM
          // dont un call tombe dans la période, même si le lien avait été envoyé avant.
          const lmProspectLinksDb = (prospectLinksData ?? []).filter((pl: any) => {
            const lead = leads.find((ml: any) => ml.id === pl.ig_lead_id);
            if (!lead?.leadMagnetSent) return false;
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
            const lead = leads.find((ml: any) => ml.id === pl.ig_lead_id);
            if (!lead?.leadMagnetSent) return false;
            return wasCalendlyLinkSent(pl, linkClickedByLeadId);
          });
          const lmLeadIds = new Set(lmAllLinks.map((pl: any) => pl.ig_lead_id));
          const lmCalls = [...callsByLeadInWindow.entries()]
            .filter(([leadId]) => lmLeadIds.has(leadId))
            .flatMap(([, cs]) => cs);
          const lmBooked = lmCalls.filter(c => c.status === 'active').length;
          const lmHonored = lmCalls.filter(c => isCallHonored(c, now)).length;
          const lmClosed = lmCalls.filter(c => c.deal_closed === true).length;
          const lmRevenue = lmCalls.reduce((s: number, c: any) => s + (c.revenue || 0), 0);

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
          const otherBooked = otherCalls.filter(c => c.status === 'active').length;
          const otherHonored = otherCalls.filter(c => isCallHonored(c, now)).length;
          const otherClosed = otherCalls.filter(c => c.deal_closed === true).length;
          const otherRevenue = otherCalls.reduce((s: number, c: any) => s + (c.revenue || 0), 0);

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
                    <TH right><EnteteColonne nom="clicLien">Clics / Liens</EnteteColonne></TH>
                    <TH right><EnteteColonne nom="callBooke">Calls bookés</EnteteColonne></TH>
                    <TH right><EnteteColonne nom="callHonore">Calls honorés</EnteteColonne></TH>
                    <TH right><EnteteColonne nom="close">Closés</EnteteColonne></TH>
                    <TH right><EnteteColonne nom="revenue">Revenue</EnteteColonne></TH>
                    {/* « Rev / call » porte le meme billet que « Revenue » : le libelle
                        porte la division, pas l'icone. */}
                    <TH right><EnteteColonne nom="revenue">Rev / call</EnteteColonne></TH>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((row, i) => {
                    const bkTaux = row.clics !== null ? tauxBadge(row.booked, row.clics, row.isContentType) : null;
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
                            ? <><span style={{ fontWeight: 700 }}>{row.booked}</span>{bkTaux && <RateBadge pct={bkTaux.pct} color={bkTaux.color} titre={bkTaux.titre} />}</>
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
                          {row.honored > 0 && row.revenue > 0
                            ? <span style={{ fontWeight: 700, color: 'var(--ink)' }}>{fmtEur(Math.round(row.revenue / row.honored))}</span>
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
                    <TD right>{totHonored > 0 && totRevenue > 0 ? <span style={{ fontWeight: 800, color: 'var(--ink)' }}>{fmtEur(Math.round(totRevenue / totHonored))}</span> : <span style={{ color: 'var(--faint)' }}>—</span>}</TD>
                  </tr>
                </tbody>
              </table>
            </div>
          );
        })()}
      </div>

      {/* ── Section 2 : Performance par contenu ── */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px 22px' }}>
        {/* Le sous-titre annonçait « N contenus avec activité business » alors que
            consolidatedRows contient TOUS les posts et vidéos du compte, y compris ceux
            dont chaque colonne vaut « — ». Deux chiffres désormais, tous deux vrais. */}
        <SectionHead title="Performance par contenu" sub={`${consolidatedRows.filter(aDeLActivite).length} contenus avec activité business sur ${consolidatedRows.length}`} />

        {/* Barre de filtres */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14, paddingBottom: 14, borderBottom: '1px solid var(--border)' }}>
          {/* Zone 1 : plateforme */}
          <div style={{ display: 'flex', gap: 3, background: 'var(--surface-2)', borderRadius: 7, padding: 3 }}>
            {(['all', 'IG', 'YT'] as const).map(p => (
              <button key={p} onClick={() => setFilterPlatform(p)} style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 5, cursor: 'pointer', border: 'none', background: filterPlatform === p ? 'var(--surface)' : 'transparent', color: filterPlatform === p ? 'var(--ink)' : 'var(--faint)', transition: 'all .15s' }}>
                {p === 'all' ? 'Tous' : p}
              </button>
            ))}
          </div>
          {/* Zone 2 : "au moins 1" — 2 lignes */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {([
              ['clicsDesc', 'min. 1 clic desc.'],
              ['lmDetectes', 'min. 1 commentaire LM'],
              ['lmClics', 'min. 1 clic LM'],
              ['lmReponses', 'min. 1 réponse LM'],
              ['dmCount', 'min. 1 lien DM'],
            ] as [SortKey, string][]).map(([key, label]) => {
              const active = filterHas.has(key);
              return (
                <button key={key} onClick={() => {
                  const next = new Set(filterHas);
                  active ? next.delete(key) : next.add(key);
                  setFilterHas(next);
                }} style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 6, cursor: 'pointer', border: `1px solid ${active ? BLUE : 'var(--border)'}`, background: active ? BLUE + '12' : 'transparent', color: active ? BLUE : 'var(--muted)', transition: 'all .12s' }}>
                  {label}
                </button>
              );
            })}
            </div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {([
              ['callsBooked', 'min. 1 call booké'],
              ['callsHonored', 'min. 1 call honoré'],
              ['closed', 'min. 1 closé'],
              ['revenue', 'min. 1 € revenue'],
            ] as [SortKey, string][]).map(([key, label]) => {
              const active = filterHas.has(key);
              return (
                <button key={key} onClick={() => {
                  const next = new Set(filterHas);
                  active ? next.delete(key) : next.add(key);
                  setFilterHas(next);
                }} style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 6, cursor: 'pointer', border: `1px solid ${active ? BLUE : 'var(--border)'}`, background: active ? BLUE + '12' : 'transparent', color: active ? BLUE : 'var(--muted)', transition: 'all .12s' }}>
                  {label}
                </button>
              );
            })}
            </div>
          </div>
          {/* Zone 3 : recherche */}
          <input
            type="text" value={filterSearch} onChange={e => setFilterSearch(e.target.value)}
            placeholder="Recherche par titre…"
            style={{ flex: 1, minWidth: 160, padding: '6px 10px', fontSize: 12, borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--ink)' }}
          />
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 780 }}>
            <thead>
              <tr>
                {/* Thumbnail — fixe au scroll horizontal */}
                <th style={{ position: 'sticky', left: 0, zIndex: 2, background: 'var(--surface)', width: 44, borderBottom: '1px solid var(--border)', padding: '6px 10px 10px' }} />
                {/* Contenu — pas de tri, fixe au scroll horizontal */}
                <th className="eyebrow-sm" style={{ position: 'sticky', left: 44, zIndex: 2, background: 'var(--surface)', textAlign: 'left', color: 'var(--muted)', padding: '6px 10px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>Contenu</th>
                {([
                  ['clicsDesc',    'Clics desc.',            'clicLien'],
                  ['lmDetectes',   'Commentaires LM',        'commentaireLm'],
                  ['lmClics',      'Clics LM',               'clicLeadMagnet'],
                  ['lmReponses',   'Conversations DM',       'conversationDm'],
                  ['dmCount',      'Calendly envoyés DM',    'calendlyEnvoye'],
                  ['callsBooked',  'Calls bookés',           'callBooke'],
                  ['callsHonored', 'Calls honorés',          'callHonore'],
                  ['qualifiedPct', '% Calls Qualifiés',      'callQualifie'],
                  ['closed',       'Closés',                 'close'],
                  ['revenue',      'Revenue',                'revenue'],
                  ['vuesParCall',  'Vues / Call',            'vuesParCall'],
                  ['cashParVue',   'Cash / Vue (all-time)',  'cashParVue'],
                ] as [SortKey, string, NomIcone][]).map(([key, label, icone]) => {
                  const active = sortKey === key;
                  return (
                    <th key={key} onClick={() => { if (active) setSortDir(d => d === 'desc' ? 'asc' : 'desc'); else { setSortKey(key); setSortDir('desc'); } }}
                      className="eyebrow-sm" style={{ textAlign: 'right', color: active ? BLUE : 'var(--muted)', padding: '6px 10px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' }}>
                      <EnteteColonne nom={icone}>{label} {active ? (sortDir === 'desc' ? '↓' : '↑') : ''}</EnteteColonne>
                    </th>
                  );
                })}
              </tr>
            </thead>
            {(() => {
                const filteredRows = consolidatedRows
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
                  });
                const displayRows = filteredRows.slice(0, 7);

                const ContentRow = ({ row, i }: { row: typeof filteredRows[0]; i: number }) => {
                  const platformColor = row.platform === 'IG' ? ACCENT : row.platform === 'STORY_SEQUENCE' ? '#8B5CF6' : RED;
                  const isSelected = selectedContentId === row.postId;
                  return (
                    <tr key={i}
                      onClick={() => { setSelectedContentId(isSelected ? null : row.postId); setDetailModal(isSelected ? null : row); }}
                      style={{ borderBottom: '1px solid var(--border-soft)', cursor: 'pointer', background: isSelected ? BLUE + '07' : '' }}
                      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'var(--surface-2)'; }}
                      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = ''; }}>
                      <td style={{ position: 'sticky', left: 0, zIndex: 1, background: isSelected ? BLUE + '15' : 'var(--surface)', padding: '8px 10px', width: 40 }}>
                        {row.thumbnail
                          ? <img loading="lazy" decoding="async" src={row.thumbnail} alt="" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 6, display: 'block' }} />
                          : <div style={{ width: 36, height: 36, borderRadius: 6, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>{row.platform === 'IG' ? '📷' : row.platform === 'STORY_SEQUENCE' ? '📸' : '▶️'}</div>}
                      </td>
                      <td style={{ position: 'sticky', left: 44, zIndex: 1, background: isSelected ? BLUE + '15' : 'var(--surface)', padding: '8px 10px', maxWidth: 200 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 3 }}>{row.title.slice(0, 45)}{row.title.length > 45 ? '…' : ''}</div>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
                          <span style={{ fontSize: 9, fontWeight: 700, color: platformColor, background: platformColor + '18', borderRadius: 4, padding: '2px 5px' }}>{row.platform === 'STORY_SEQUENCE' ? 'STORY' : row.platform} · {row.type}</span>
                          {row.lmName && <span style={{ fontSize: 9, fontWeight: 700, color: '#8B5CF6', background: '#8B5CF618', borderRadius: 4, padding: '2px 5px' }}>{row.lmName}</span>}
                        </div>
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 13, fontWeight: row.clicsDesc > 0 ? 700 : 400, color: row.clicsDesc > 0 ? 'var(--ink)' : 'var(--faint)' }}>{row.clicsDesc > 0 ? fmt(row.clicsDesc) : '—'}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 13, fontWeight: row.lmDetectes > 0 ? 700 : 400, color: row.lmDetectes > 0 ? 'var(--ink)' : 'var(--faint)' }}>{row.lmDetectes > 0 ? row.lmDetectes : '—'}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 13, fontWeight: row.lmClics > 0 ? 700 : 400, color: row.lmClics > 0 ? 'var(--ink)' : 'var(--faint)' }}>{row.lmDetectes > 0 ? (row.lmClics > 0 ? row.lmClics : '0') : '—'}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 13, fontWeight: row.lmReponses > 0 ? 700 : 400, color: row.lmReponses > 0 ? 'var(--ink)' : 'var(--faint)' }}>{row.lmDetectes > 0 ? (row.lmReponses > 0 ? row.lmReponses : '0') : '—'}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 13, fontWeight: row.dmCount > 0 ? 700 : 400, color: row.dmCount > 0 ? 'var(--ink)' : 'var(--faint)' }}>{row.dmCount > 0 ? row.dmCount : '—'}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 13, fontWeight: row.callsBooked > 0 ? 700 : 400, color: row.callsBooked > 0 ? GREEN : 'var(--faint)' }}>{row.callsBooked > 0 ? row.callsBooked : '—'}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 13, fontWeight: row.callsHonored > 0 ? 700 : 400, color: row.callsHonored > 0 ? GREEN : 'var(--faint)' }}>{row.callsHonored > 0 ? row.callsHonored : '—'}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 12, color: row.qualifiedPct !== null ? 'var(--ink)' : 'var(--faint)', fontWeight: row.qualifiedPct !== null ? 600 : 400, whiteSpace: 'nowrap' }}>
                        {row.qualifiedPct !== null ? `${row.qualifiedPct}% (${row.qualifiedCount}/${row.qualifiedAnswered})` : '—'}
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 13, fontWeight: row.closed > 0 ? 700 : 400, color: row.closed > 0 ? GREEN : 'var(--faint)' }}>{row.closed > 0 ? row.closed : '—'}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 13, fontWeight: 700, color: row.revenue > 0 ? GREEN : 'var(--faint)', whiteSpace: 'nowrap' }}>{row.revenue > 0 ? fmtEur(row.revenue) : '—'}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 12, color: row.vuesParCall ? 'var(--muted)' : 'var(--faint)', fontWeight: row.vuesParCall ? 600 : 400 }}>{row.vuesParCall ? fmt(row.vuesParCall) : '—'}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 12, color: row.cashParVue !== null ? 'var(--ink)' : 'var(--faint)', fontWeight: row.cashParVue !== null ? 600 : 400, whiteSpace: 'nowrap' }}>{row.cashParVue !== null ? fmtEur(row.cashParVue) : '—'}</td>
                    </tr>
                  );
                };

                return <tbody>{displayRows.map((row, i) => <ContentRow key={i} row={row} i={i} />)}</tbody>;
              })()}
          </table>
        </div>

        {/* Bouton Voir tout */}
        {consolidatedRows.length > 7 && (
          <div style={{ marginTop: 12, textAlign: 'center' }}>
            <button onClick={() => setShowAllTable(true)} style={{ padding: '7px 20px', fontSize: 12, fontWeight: 600, borderRadius: 8, cursor: 'pointer', border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', transition: 'all .15s' }}>
              Voir tout ({consolidatedRows.length} contenus)
            </button>
          </div>
        )}
      </div>

      {/* ── Modal "Voir tout" Performance par contenu ── */}
      {showAllTable && createPortal(
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', zIndex: 9998, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '32px 16px', overflowY: 'auto' }}
          onClick={() => setShowAllTable(false)}>
          <div style={{ width: '100%', maxWidth: 1200, background: 'var(--surface)', borderRadius: 14, padding: '24px 28px', boxShadow: '0 20px 60px rgba(0,0,0,.25)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>Performance par contenu</div>
                {/* Même formulation que le sous-titre de la section : « N contenus »
                    seul laissait croire que tous ont une activité business, alors que la
                    liste contient chaque post et chaque vidéo du compte. */}
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>{consolidatedRows.filter(aDeLActivite).length} avec activité business sur {consolidatedRows.length} contenus</div>
              </div>
              <button onClick={() => setShowAllTable(false)} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--muted)', lineHeight: 1 }}>×</button>
            </div>
            {/* Barre de défilement horizontale rendue VISIBLE (classe .table-scroll-x).
                Le tableau dépasse de ~400 px la largeur de la modale : « % Calls
                qualifiés », « Closés », « Revenue », « Vues / call » et « Cash / vue »
                étaient hors champ, et sur un système à barres flottantes (macOS,
                Windows 11) rien ne signalait qu'elles existaient. Une barre toujours
                affichée est l'indice le plus honnête : elle ne masque aucun contenu,
                contrairement à un dégradé de bord. */}
            <div className="table-scroll-x" style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 180px)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 780 }}>
                <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
                  <tr>
                    <th style={{ position: 'sticky', left: 0, zIndex: 3, background: 'var(--surface)', width: 44, borderBottom: '1px solid var(--border)', padding: '6px 10px 10px' }} />
                    <th className="eyebrow-sm" style={{ position: 'sticky', left: 44, zIndex: 3, background: 'var(--surface)', textAlign: 'left', color: 'var(--muted)', padding: '6px 10px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>Contenu</th>
                    {(['clicsDesc', 'lmDetectes', 'lmClics', 'lmReponses', 'dmCount', 'callsBooked', 'callsHonored', 'qualifiedPct', 'closed', 'revenue', 'vuesParCall', 'cashParVue'] as SortKey[]).map(key => {
                      const labels: Record<string, string> = { clicsDesc: 'Clics desc.', lmDetectes: 'Commentaires LM', lmClics: 'Clics LM', lmReponses: 'Conversations DM', dmCount: 'Calendly envoyés DM', callsBooked: 'Calls bookés', callsHonored: 'Calls honorés', qualifiedPct: '% Calls Qualifiés', closed: 'Closés', revenue: 'Revenue', vuesParCall: 'Vues / Call', cashParVue: 'Cash / Vue (all-time)' };
                      const active = sortKey === key;
                      return (
                        <th key={key} onClick={() => { if (active) setSortDir(d => d === 'desc' ? 'asc' : 'desc'); else { setSortKey(key); setSortDir('desc'); } }}
                          className="eyebrow-sm" style={{ textAlign: 'right', color: active ? BLUE : 'var(--muted)', padding: '6px 10px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' }}>
                          {labels[key]} {active ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {consolidatedRows
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
                    .map((row, i) => {
                      const platformColor = row.platform === 'IG' ? ACCENT : row.platform === 'STORY_SEQUENCE' ? '#8B5CF6' : RED;
                      const isSelected = selectedContentId === row.postId;
                      return (
                        <tr key={i}
                          onClick={() => { setSelectedContentId(isSelected ? null : row.postId); setDetailModal(isSelected ? null : row); setShowAllTable(false); }}
                          style={{ borderBottom: '1px solid var(--border-soft)', cursor: 'pointer', background: isSelected ? BLUE + '07' : '' }}
                          onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'var(--surface-2)'; }}
                          onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = ''; }}>
                          <td style={{ position: 'sticky', left: 0, zIndex: 1, background: isSelected ? BLUE + '15' : 'var(--surface)', padding: '8px 10px', width: 40 }}>
                            {row.thumbnail
                              ? <img loading="lazy" decoding="async" src={row.thumbnail} alt="" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 6, display: 'block' }} />
                              : <div style={{ width: 36, height: 36, borderRadius: 6, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>{row.platform === 'IG' ? '📷' : row.platform === 'STORY_SEQUENCE' ? '📸' : '▶️'}</div>}
                          </td>
                          <td style={{ position: 'sticky', left: 44, zIndex: 1, background: isSelected ? BLUE + '15' : 'var(--surface)', padding: '8px 10px', maxWidth: 200 }}>
                            <div style={{ fontSize: 11, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 3 }}>{row.title.slice(0, 45)}{row.title.length > 45 ? '…' : ''}</div>
                            <span style={{ fontSize: 9, fontWeight: 700, color: platformColor, background: platformColor + '18', borderRadius: 4, padding: '2px 5px' }}>{row.platform === 'STORY_SEQUENCE' ? 'STORY' : row.platform} · {row.type}</span>
                          </td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 13, fontWeight: row.clicsDesc > 0 ? 700 : 400, color: row.clicsDesc > 0 ? 'var(--ink)' : 'var(--faint)' }}>{row.clicsDesc > 0 ? fmt(row.clicsDesc) : '—'}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 13, fontWeight: row.lmDetectes > 0 ? 700 : 400, color: row.lmDetectes > 0 ? 'var(--ink)' : 'var(--faint)' }}>{row.lmDetectes > 0 ? row.lmDetectes : '—'}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 13, fontWeight: row.lmClics > 0 ? 700 : 400, color: row.lmClics > 0 ? 'var(--ink)' : 'var(--faint)' }}>{row.lmDetectes > 0 ? (row.lmClics > 0 ? row.lmClics : '0') : '—'}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 13, fontWeight: row.lmReponses > 0 ? 700 : 400, color: row.lmReponses > 0 ? 'var(--ink)' : 'var(--faint)' }}>{row.lmDetectes > 0 ? (row.lmReponses > 0 ? row.lmReponses : '0') : '—'}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 13, fontWeight: row.dmCount > 0 ? 700 : 400, color: row.dmCount > 0 ? 'var(--ink)' : 'var(--faint)' }}>{row.dmCount > 0 ? row.dmCount : '—'}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 13, fontWeight: row.callsBooked > 0 ? 700 : 400, color: row.callsBooked > 0 ? GREEN : 'var(--faint)' }}>{row.callsBooked > 0 ? row.callsBooked : '—'}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 13, fontWeight: row.callsHonored > 0 ? 700 : 400, color: row.callsHonored > 0 ? GREEN : 'var(--faint)' }}>{row.callsHonored > 0 ? row.callsHonored : '—'}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 12, color: row.qualifiedPct !== null ? 'var(--ink)' : 'var(--faint)', fontWeight: row.qualifiedPct !== null ? 600 : 400, whiteSpace: 'nowrap' }}>
                            {row.qualifiedPct !== null ? `${row.qualifiedPct}% (${row.qualifiedCount}/${row.qualifiedAnswered})` : '—'}
                          </td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 13, fontWeight: row.closed > 0 ? 700 : 400, color: row.closed > 0 ? GREEN : 'var(--faint)' }}>{row.closed > 0 ? row.closed : '—'}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 13, fontWeight: 700, color: row.revenue > 0 ? GREEN : 'var(--faint)', whiteSpace: 'nowrap' }}>{row.revenue > 0 ? fmtEur(row.revenue) : '—'}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 12, color: row.vuesParCall ? 'var(--muted)' : 'var(--faint)', fontWeight: row.vuesParCall ? 600 : 400 }}>{row.vuesParCall ? fmt(row.vuesParCall) : '—'}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 12, color: row.cashParVue !== null ? 'var(--ink)' : 'var(--faint)', fontWeight: row.cashParVue !== null ? 600 : 400, whiteSpace: 'nowrap' }}>{row.cashParVue !== null ? fmtEur(row.cashParVue) : '—'}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </div>,
        document.body
      )}

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
                            const isOrganic = linkSource === 'story_reply' || linkSource === 'comment';
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


      {/* ── Section 2b : Performance LM ── */}
      {(() => {

        const ratePct = (v: number, of: number) => of > 0 ? Math.round((v / of) * 100) : 0;
        const rateColor = (pct: number, high = 50, mid = 30) =>
          pct >= high ? GREEN : pct >= mid ? AMBER : RED;
        const closeColor = (pct: number) => pct >= 70 ? GREEN : pct >= 50 ? AMBER : RED;

        const thS: React.CSSProperties = {
          textAlign: 'right', fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
          color: 'var(--muted)', padding: '6px 12px 10px', borderBottom: '1px solid var(--border)',
          whiteSpace: 'nowrap',
        };
        const tdS: React.CSSProperties = {
          padding: '10px 12px', textAlign: 'right', fontSize: 13, verticalAlign: 'top',
          borderBottom: '1px solid var(--border-soft)',
        };

        const Sub = ({ pct, isClose }: { pct: number; isClose?: boolean }) => (
          <div style={{ fontSize: 10, fontWeight: 600, color: isClose ? closeColor(pct) : rateColor(pct), marginTop: 2 }}>{pct}%</div>
        );

        return (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px 22px' }}>
            <SectionHead title="Performance LM" sub={leadMagnets.length > 0 ? `${leadMagnets.length} lead magnet${leadMagnets.length > 1 ? 's' : ''} — agrégat tous contenus` : 'Aucun lead magnet configuré'} />
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 960 }}>
                <thead>
                  <tr>
                    <th style={{ ...thS, textAlign: 'left', width: 140 }}>Lead magnet</th>
                    <th style={thS}><EnteteColonne nom="clicLien">Clics desc.</EnteteColonne></th>
                    <th style={thS}><EnteteColonne nom="leadsGeneres">Leads générés</EnteteColonne></th>
                    <th style={thS}><EnteteColonne nom="clicLeadMagnet">Clics LM DM</EnteteColonne></th>
                    <th style={thS}><EnteteColonne nom="conversationDm">Conversations DM</EnteteColonne></th>
                    <th style={thS}><EnteteColonne nom="calendlyEnvoye">Calendly envoyés DM</EnteteColonne></th>
                    <th style={thS}><EnteteColonne nom="clicLien">Clics Calendly DM</EnteteColonne></th>
                    <th style={thS}><EnteteColonne nom="callBooke">Calls bookés</EnteteColonne></th>
                    <th style={thS}><EnteteColonne nom="callHonore">Calls honorés</EnteteColonne></th>
                    <th style={thS}><EnteteColonne nom="callQualifie">% Calls Qualifiés</EnteteColonne></th>
                    <th style={thS}><EnteteColonne nom="close">Closés</EnteteColonne></th>
                    <th style={thS}><EnteteColonne nom="revenue">Revenue</EnteteColonne></th>
                  </tr>
                </thead>
                <tbody>
                  {leadMagnets.length === 0 && (
                    <tr><td colSpan={12} style={{ padding: '20px', textAlign: 'center', fontSize: 12, color: 'var(--faint)' }}>Aucun lead magnet configuré — ajoutez-en via les paramètres</td></tr>
                  )}
                  {leadMagnets.map((lm, i) => {
                    // Pivot unique : keyword_matched — même clé sur lmHistory, prospect_links, et shortio path
                    const kw = (lm.keyword || '').toLowerCase();
                    // En mode "depuis connexion", lmHistory/prospectLinksData sont déjà bornés
                    // [connectedAt, aujourd'hui] par le fetch — pas de re-filtre calendaire ici.
                    const periodStartDate = sinceConnection ? '' : periodStart.toISOString();
                    const periodEndDate = sinceConnection ? null : (_pIdx === 0 ? null : periodEnd.toISOString());

                    // Tous les mots-clés alternatifs pour ce LM (définis dans content_links par contenu)
                    // Ex: LM Ubizen AI (keyword: LM) peut aussi être déclenché par BEAU via un contenu
                    const altKws = new Set<string>([kw]);
                    if (altKwToLmId) {
                      for (const [altKw, lmId] of altKwToLmId) {
                        if (lmId === lm.id) altKws.add(altKw);
                      }
                    }

                    // Leads : depuis instagram_lead_lm_history — une ligne par VRAIE interaction
                    // (detected_at figé à cet événement précis), pas depuis instagram_leads qui
                    // n'a qu'une ligne par personne et écrase keyword_matched à chaque nouvelle
                    // interaction (ex: un lead qui prend #GUIDE en juin puis #PROMO en août
                    // disparaissait silencieusement des stats de #GUIDE — bug découvert en test
                    // réel sur le flux stories, cf. session 2026-07-26).
                    const lmHistoryMatches = (lmHistory ?? []).filter(h =>
                      altKws.has((h.keyword_matched || '').toLowerCase()) &&
                      h.detected_at >= periodStartDate && (!periodEndDate || h.detected_at <= periodEndDate)
                    );
                    // Dédupliqué par ig_user_id — "Leads générés" compte des PROSPECTS, pas des
                    // interactions : une personne qui redétecte le même mot-clé plusieurs fois
                    // (commentaires répétés) ne doit pas gonfler artificiellement ce chiffre (cas
                    // réel observé : 1 prospect détecté 5 fois en 24h comptait à tort pour 5).
                    const uniqueSentUserIds = new Set(lmHistoryMatches.filter(h => h.lead_magnet_sent).map(h => h.ig_user_id));
                    const leadsCount = uniqueSentUserIds.size;
                    // reponses/clicsLM restent basés sur l'état ACTUEL du lead (instagram_leads) —
                    // pas d'historique par-interaction disponible pour hookReplied/clics aujourd'hui ;
                    // matché par ig_user_id présent dans lmHistoryMatches pour rester scopé au LM.
                    const lmHistoryUserIds = new Set(lmHistoryMatches.map(h => h.ig_user_id));
                    const lmLeads = leads.filter(l => l.igUserId && lmHistoryUserIds.has(l.igUserId));
                    const reponses = lmLeads.filter(l => l.hookReplied).length;

                    // Clics LM : même logique que le pipeline — prospect_events.lm_clicked par lead
                    // (un lead = 0 ou 1 clic, ignore les clics de test antérieurs à la création du lead)
                    const clicsLM = lmLeads.filter((l: MockLead) => l.id && lmClickedByLeadId?.has(l.id)).length;

                    // Clics description (lm_desc_ig + lm_desc_yt) — clics bruts Short.io depuis clicksByUrl
                    const clicsDesc = (() => {
                      if (!lm.url) return 0;
                      let total = 0;
                      for (const l of allShortioLinks) {
                        if ((l.linkCategory === 'lm_desc_ig' || l.linkCategory === 'lm_desc_yt') &&
                            (l.originalUrl || '').includes(lm.url.split('?')[0])) {
                          total += linkClics(l);
                        }
                      }
                      return total;
                    })();

                    // Liens Calendly + tout le reste : pivot direct sur keyword_matched dans prospect_links
                    // Inclut les keywords alternatifs (ex: BEAU pour LM Ubizen AI)
                    // Même logique que Business Micro : calendly_link_sent + filtre période [periodStart, periodEnd]
                    const supaProspects = (prospectLinksData ?? []).filter((pl: any) => {
                      if (!altKws.has((pl.keyword_matched || '').toLowerCase())) return false;
                      if (!wasCalendlyLinkSent(pl, linkClickedByLeadId)) return false;
                      const ts = calendlySentAt(pl, linkClickedByLeadId);
                      if (!ts) return false;
                      const iso = new Date(ts).toISOString();
                      return iso >= periodStartDate && (!periodEndDate || iso <= periodEndDate);
                    });
                    const liensCalendly = supaProspects.length;

                    // Clics Calendly : même logique que le pipeline — prospect_events.link_clicked par lead
                    const clicsCalendly = supaProspects.filter((pl: any) => pl.ig_lead_id && linkClickedByLeadId?.has(pl.ig_lead_id)).length;

                    const booked  = supaProspects.filter((pl: any) => pl.callBooked).length;
                    const honored = supaProspects.filter((pl: any) => pl.callHonored).length;
                    const closed  = supaProspects.filter((pl: any) => pl.dealClosed === true).length;
                    const revenue = supaProspects.reduce((s: number, pl: any) => s + (pl.revenue || 0), 0);

                    // % qualifié : parmi les calls honorés avec qualified renseigné (exclut non-renseignés)
                    const qualifiableProspects = supaProspects.filter((pl: any) => pl.callHonored && pl.qualified !== null);
                    const qualifiedCount = qualifiableProspects.filter((pl: any) => pl.qualified === true).length;
                    const qualifiedAnswered = qualifiableProspects.length;
                    const qualifiedPct = qualifiedAnswered > 0 ? Math.round((qualifiedCount / qualifiedAnswered) * 100) : null;

                    // `clicsDesc` est affiché indépendamment de hasActivity (colonne
                    // « Clics desc. » ci-dessous) : le laisser hors de cette condition
                    // faisait cohabiter la mention « Aucune activité » et « 2 clics » sur
                    // la même ligne (observé sur le LM « Tunnel Closing », août 2026).
                    const hasActivity = leadsCount > 0 || clicsDesc > 0;

                    return (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border-soft)' }}>
                        <td style={{ ...tdS, textAlign: 'left', fontWeight: 600, fontSize: 12, color: 'var(--ink)' }}>
                          {lm.name}
                          <div style={{ fontSize: 10, color: 'var(--faint)', fontWeight: 400, marginTop: 2 }}>mot-clé : {lm.keyword}</div>
                          {!hasActivity && <div style={{ fontSize: 10, color: 'var(--faint)', fontWeight: 400 }}>Aucune activité</div>}
                        </td>
                        <td style={{ ...tdS, fontWeight: clicsDesc > 0 ? 700 : 400, color: clicsDesc > 0 ? 'var(--ink)' : 'var(--faint)' }}>{clicsDesc > 0 ? clicsDesc : '—'}</td>
                        <td style={{ ...tdS, fontWeight: leadsCount > 0 ? 700 : 400, color: leadsCount > 0 ? 'var(--ink)' : 'var(--faint)' }}>{hasActivity ? leadsCount : '—'}</td>
                        <td style={tdS}>
                          <div style={{ fontWeight: hasActivity && clicsLM > 0 ? 700 : 400, color: hasActivity && clicsLM > 0 ? 'var(--ink)' : 'var(--faint)' }}>{hasActivity ? clicsLM : '—'}</div>
                          {hasActivity && leadsCount > 0 && <Sub pct={ratePct(clicsLM, leadsCount)} />}
                        </td>
                        <td style={tdS}>
                          <div style={{ fontWeight: hasActivity && reponses > 0 ? 700 : 400, color: hasActivity && reponses > 0 ? 'var(--ink)' : 'var(--faint)' }}>{hasActivity ? reponses : '—'}</div>
                          {hasActivity && clicsLM > 0 && <Sub pct={ratePct(reponses, clicsLM)} />}
                        </td>
                        <td style={{ ...tdS, fontWeight: hasActivity && liensCalendly > 0 ? 700 : 400, color: hasActivity && liensCalendly > 0 ? 'var(--ink)' : 'var(--faint)' }}>{hasActivity ? liensCalendly : '—'}</td>
                        <td style={tdS}>
                          <div style={{ fontWeight: hasActivity && clicsCalendly > 0 ? 700 : 400, color: hasActivity && clicsCalendly > 0 ? 'var(--ink)' : 'var(--faint)' }}>{hasActivity ? clicsCalendly : '—'}</div>
                          {hasActivity && liensCalendly > 0 && <Sub pct={ratePct(clicsCalendly, liensCalendly)} />}
                        </td>
                        <td style={tdS}>
                          <div style={{ fontWeight: hasActivity && booked > 0 ? 700 : 400, color: hasActivity && booked > 0 ? GREEN : 'var(--faint)' }}>{hasActivity ? booked : '—'}</div>
                          {hasActivity && clicsCalendly > 0 && <Sub pct={ratePct(booked, clicsCalendly)} />}
                        </td>
                        <td style={tdS}>
                          <div style={{ fontWeight: hasActivity && honored > 0 ? 700 : 400, color: hasActivity && honored > 0 ? GREEN : 'var(--faint)' }}>{hasActivity ? honored : '—'}</div>
                          {hasActivity && booked > 0 && <Sub pct={ratePct(honored, booked)} isClose />}
                        </td>
                        <td style={{ ...tdS, fontSize: 11, whiteSpace: 'nowrap', fontWeight: qualifiedPct !== null ? 600 : 400, color: qualifiedPct !== null ? 'var(--ink)' : 'var(--faint)' }}>
                          {qualifiedPct !== null ? `${qualifiedPct}% (${qualifiedCount}/${qualifiedAnswered})` : '—'}
                        </td>
                        <td style={tdS}>
                          <div style={{ fontWeight: hasActivity && closed > 0 ? 700 : 400, color: hasActivity && closed > 0 ? GREEN : 'var(--faint)' }}>{hasActivity ? closed : '—'}</div>
                          {hasActivity && honored > 0 && <Sub pct={ratePct(closed, honored)} isClose />}
                        </td>
                        <td style={{ ...tdS, fontWeight: 700, color: hasActivity && revenue > 0 ? GREEN : 'var(--faint)', whiteSpace: 'nowrap' }}>
                          {hasActivity && revenue > 0 ? fmtEur(revenue) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}



    </div>
  );
}

// ── Pill période flottante (onglet Funnel & Calls) ────────────────────────────
function PeriodPill({ period, setPeriod, periodIndex, setPeriodIndex, connectedAt, allTimeStart, sinceConnection, setSinceConnection }: {
  period: Period; setPeriod: (p: Period) => void;
  periodIndex: number; setPeriodIndex: (fn: (i: number) => number) => void;
  connectedAt?: string | null;
  /** Début RÉEL de la fenêtre All-Time (integrations_ready_at), à ne pas confondre
   *  avec connectedAt, qui borne seulement la navigation arrière. Les deux divergent :
   *  29/05 contre 09/06 sur le profil de test, soit 11 jours annoncés à tort. */
  allTimeStart?: string | null;
  sinceConnection?: boolean; setSinceConnection?: (v: boolean) => void;
}) {
  const maxIndex = connectedAt
    ? Math.max(0, Math.floor((Date.now() - new Date(connectedAt).getTime()) / (period * 86400000)))
    : 12;
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 12, padding: '5px 10px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
        userSelect: 'none', WebkitUserSelect: 'none',
      } as React.CSSProperties}
    >
      <button onClick={() => setPeriodIndex(i => Math.min(i + 1, maxIndex))} disabled={sinceConnection || periodIndex >= maxIndex}
        style={{ background: 'none', border: 'none', cursor: (sinceConnection || periodIndex >= maxIndex) ? 'default' : 'pointer', fontSize: 20, color: (sinceConnection || periodIndex >= maxIndex) ? 'var(--faint)' : 'var(--ink)', padding: '0 4px', lineHeight: 1 }}>‹</button>
      <div style={{ textAlign: 'center', minWidth: 120 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)', whiteSpace: 'nowrap' }}>
          {/* « All-Time » plutôt que « Depuis connexion » : le nom du mode côté
              utilisateur. La fenêtre est [integrations_ready_at, aujourd'hui] —
              le jour où le pipeline Momentum de l'élève est devenu opérationnel. */}
          {sinceConnection ? 'All-Time' : (periodIndex === 0 ? 'Période actuelle' : `${period === 7 ? 'S' : 'M'}−${periodIndex}`)}
        </div>
        <div style={{ fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{sinceConnection ? ((allTimeStart ?? connectedAt) ? `depuis le ${new Date((allTimeStart ?? connectedAt)!).toLocaleDateString('fr-FR')}` : '') : periodLabel(period, periodIndex)}</div>
      </div>
      <button onClick={() => setPeriodIndex(i => Math.max(i - 1, 0))} disabled={sinceConnection || periodIndex === 0}
        style={{ background: 'none', border: 'none', cursor: (sinceConnection || periodIndex === 0) ? 'default' : 'pointer', fontSize: 20, color: (sinceConnection || periodIndex === 0) ? 'var(--faint)' : 'var(--ink)', padding: '0 4px', lineHeight: 1 }}>›</button>
      <div style={{ width: 1, height: 24, background: 'var(--border)', margin: '0 4px' }} />
      <div style={{ display: 'flex', gap: 2, background: 'var(--surface-chat-field)', borderRadius: 8, padding: 3 }}>
        {([7, 30] as Period[]).map(p => (
          <button key={p} onClick={() => { setSinceConnection?.(false); setPeriod(p); setPeriodIndex(() => 0); }} style={{
            padding: '4px 12px', fontSize: 12, fontWeight: 600, borderRadius: 6, cursor: 'pointer', border: 'none',
            background: !sinceConnection && period === p ? 'var(--ink)' : 'transparent',
            color: !sinceConnection && period === p ? 'var(--surface)' : 'var(--muted)',
            transition: 'all .15s',
          }}>{p}j</button>
        ))}
        {setSinceConnection && (
          <button
            key="since-connection"
            onClick={() => connectedAt && setSinceConnection(true)}
            disabled={!connectedAt}
            title={!connectedAt ? "Date de connexion inconnue" : undefined}
            style={{
              padding: '4px 12px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: 'none',
              cursor: connectedAt ? 'pointer' : 'not-allowed',
              background: sinceConnection ? 'var(--ink)' : 'transparent',
              color: !connectedAt ? 'var(--faint)' : (sinceConnection ? 'var(--surface)' : 'var(--muted)'),
              transition: 'all .15s', whiteSpace: 'nowrap',
            }}>All-Time</button>
        )}
      </div>
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
    stripeRes,
    shortioResult,
    shortioClicksRes,
    dealsRes,
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
    supabase.from('calls').select('*')
      .eq('coach_id', targetId)
      .or(`and(booked_at.gte.${periodStart.toISOString()},booked_at.lte.${periodEnd.toISOString()}),and(booked_at.is.null,scheduled_at.gte.${periodStart.toISOString()},scheduled_at.lte.${periodEnd.toISOString()})`)
      .eq('call_type', 'calendly')
      .neq('ignored', true)
      .order('scheduled_at', { ascending: false }),
    // Cash collecté = paiements rattachés à un deal, pas l'encaissé Stripe brut :
    // un élève peut encaisser hors Momentum, et compter ces paiements rendrait le
    // taux collecté/contracté supérieur à 100 % (décision du 19/08/2026).
    // `date` est conservé en alias de paid_at pour ne pas toucher aux consommateurs.
    supabase
      .from('deal_payments')
      .select('amount, status, date:paid_at, deals!inner(profile_id)')
      .eq('deals.profile_id', targetId)
      .gte('paid_at', periodStart.toISOString())
      .lte('paid_at', periodEnd.toISOString())
      .order('paid_at', { ascending: false }),
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
      .select('amount_total, status, signed_at, call_id')
      .eq('profile_id', targetId)
      .gte('signed_at', periodStart.toISOString())
      .lte('signed_at', periodEnd.toISOString()),
  ]);

  const snaps = snapsRes.status === 'fulfilled' ? (snapsRes.value.data ?? []) : [];
  if (igPostsRes.status === 'fulfilled' && igPostsRes.value.error) console.error('[PageClientStats] get_ig_posts_history a échoué:', igPostsRes.value.error.message);
  const igPostsRows = igPostsRes.status === 'fulfilled' ? (igPostsRes.value.data ?? []) : [];
  if (ytVideosRes.status === 'fulfilled' && ytVideosRes.value.error) console.error('[PageClientStats] get_yt_videos_history a échoué:', ytVideosRes.value.error.message);
  const ytVideosRows = ytVideosRes.status === 'fulfilled' ? (ytVideosRes.value.data ?? []) : [];
  const stripeRows = stripeRes.status === 'fulfilled' ? (stripeRes.value.data ?? []) : [];
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

  // Dernier snapshot connu pour les valeurs cumulatives (followers, abonnés, etc.)
  // snaps est trié 'date' descendant (requête ligne ~5044) donc le plus récent est
  // le premier élément, pas le dernier — snaps[snaps.length-1] serait le plus ancien.
  // yt_subscribers peut être null les derniers jours (backfill/collecte pas encore
  // passés) : on cherche le snapshot le plus récent qui a réellement une valeur.
  const lastSnap = snaps[0] ?? null;
  const lastSnapWithYtSubs = snaps.find(r => r.yt_subscribers != null) ?? null;
  // Repartitions (trafic / appareils / demographie) : portees par UNE seule ligne de la
  // periode, celle du dernier jour traite par le cron. Prendre lastSnap tout court
  // renvoyait un tableau vide des que ce n'etait pas la premiere ligne — meme motif que
  // lastSnapWithYtSubs juste au-dessus.
  const lastSnapWithTraffic = snaps.find(r => r.yt_traffic_sources != null) ?? null;
  const lastSnapWithDevices = snaps.find(r => r.yt_devices != null) ?? null;
  const lastSnapWithDemo    = snaps.find(r => r.yt_demographics != null) ?? null;
  const lastSnapWithKeywords = snaps.find(r => r.yt_search_keywords != null) ?? null;

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

  const igHist = snaps.length > 0 ? {
    reach30d:             igReachTotal,
    views30d:             igViewsTotal,
    followers:            lastSnap?.ig_followers ?? 0,
    following:            lastSnap?.ig_following ?? 0,
    accountsEngaged30d:   igEngTotal,
    totalInteractions30d: igInterTotal,
    profileLinksTaps30d:  igTapsTotal,
    websiteClicks30d:     igWCTotal,
    followsUnfollows30d:  igFUTotal,
    chartData: snaps.map(r => ({
      date:              r.date,
      reach:             r.ig_reach ?? 0,
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

  // ── Stripe ──────────────────────────────────────────────────────────────────
  const stripeHist = snaps.length > 0 ? {
    mrr:                 lastSnap?.mrr ?? 0,
    monthlyRevenue:      stripeRows.reduce((s: number, r: any) => s + (r.amount ?? 0), 0),
    activeSubscriptions: lastSnap?.stripe_active_subs ?? 0,
    availableBalance:    0,
    recentPayments:      stripeRows.map((r: any) => ({
      id: r.payment_id, amount: r.amount, currency: r.currency ?? 'eur',
      description: r.description ?? null, date: r.date, status: r.status,
    })),
  } : null;

  // ── Messages IG (scalaires depuis snapshots) ─────────────────────────────────
  const msgsHist = snaps.length > 0 ? {
    totalThreads30d: igLeadTotal,
    responseRate:    lastSnap?.ig_response_rate ?? 0,
    repliedThreads:  Math.round((lastSnap?.ig_response_rate ?? 0) * igLeadTotal / 100),
    leadCount:       igLeadTotal,
    keywordCounts:   {},
    threads:         [],
  } : null;

  return {
    igHist,
    ytHist,
    shortioHist,
    callsHist: callsRes.status === 'fulfilled' ? (callsRes.value.data ?? []) : [],
    dealsHist: dealsRes.status === 'fulfilled' ? (dealsRes.value.data ?? []) : [],
    stripeHist,
    msgsHist,
    snapshotDate: endDateStr,
    clicksByUrl: snapClicksByUrl,
    clicksByPath: snapClicksByPath,
    businessClicsFromDb: snapBusinessClicsFromDb,
    totalClicsChangePct: snapTotalClicsChangePct,
    shortioChartHistory: snapShortioChartHistory,
    joursCollectesShortio: snapJoursCollectes,
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

  const [leadsRows, lmRes, calendlyRes, lmHistoryRows, prospectLinksRows, contentLinksRes, lmClickedEvents, linkClickedEvents] = await Promise.all([
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
        .select('id, ig_lead_id, ig_username, short_url, calendly_link_sent, calendly_link_sent_at, first_click_at, created_at, keyword_matched, source_at_creation')
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
    const q = supabase.from('calls').select('*')
      .eq('coach_id', callsOwnerId)
      .neq('ignored', true)
      .eq('call_type', 'calendly')
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
      .select('amount_total, status, signed_at, call_id')
      .eq('profile_id', targetId)
      .order('signed_at', { ascending: false });
    return integrationsReadyAt ? q.gte('signed_at', integrationsReadyAt) : q;
  });

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

  const lmHistory: { ig_user_id: string; keyword_matched: string; media_id: string | null; lead_magnet_sent: boolean; detected_at: string }[] =
    lmHistoryRows.filter((h: any) => h.ig_user_id && h.keyword_matched);

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
  const callByLeadId = new Map<string, { callBooked: boolean; callHonored: boolean; dealClosed: boolean; revenue: number; qualified: boolean | null }>();
  for (const c of callsData) {
    if (c.ig_lead_id) {
      callByLeadId.set(c.ig_lead_id, {
        callBooked:  c.status === 'active',
        callHonored: isCallHonored(c, now),
        dealClosed:  !!c.deal_closed,
        revenue:     montantParCall.get(c.id) ?? 0,
        qualified:   c.qualified ?? null,
      });
    }
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

  return { igLeads, leadMagnets: lmData, destinations, calls: callsData, deals: dealsRows, lmHistory, leadIdToMediaId, prospectLinksData, clicksByPath, clicksByUrl, urlToCategoryFromDb, calendlyStaticClicsFromDb, businessClicsFromDb, totalClicsChangePct, altKwToLmId, lmClickedByLeadId, linkClickedByLeadId, shortioChartHistory, shortioChartHistoryBio, shortioChartHistoryContent, shortioChartHistoryDm, shortioChartHistoryStory, joursCollectesShortio, integrationsReadyAt };
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
    .select('provider, backfill_done, backfill_started_at, last_snapshot_status, last_snapshot_error, connected_at')
    .eq('profile_id', targetId)
    .in('provider', ['instagram', 'youtube']);

  if (!data?.length) return null;

  const ig = data.find(r => r.provider === 'instagram');
  const yt = data.find(r => r.provider === 'youtube');

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
      connectedAt: ig.connected_at,
    } : null,
    yt: yt ? {
      backfillDone: yt.backfill_done,
      backfillStarted: yt.backfill_started_at,
      snapshotStatus: yt.last_snapshot_status,
      snapshotError: yt.last_snapshot_error,
      connectedAt: yt.connected_at,
    } : null,
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
  const integrationsReadyAt: string | null = supaData?.integrationsReadyAt ?? null;
  const leadIdToMediaId: Map<string, string> = supaData?.leadIdToMediaId ?? new Map();
  const prospectLinksData: any[] = supaData?.prospectLinksData ?? [];
  const altKwToLmId: Map<string, string> = supaData?.altKwToLmId ?? new Map();
  const lmClickedByLeadId: Map<string, string> = supaData?.lmClickedByLeadId ?? new Map();
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

  // Stripe — onglets 0, 5
  const { data: stripeRaw, refetch: refetchStripe } = useQuery<StripeStats | null>({
    queryKey: ['stats-stripe', profileId],
    queryFn: () => fetchApi(`/api/stripe/client-data${q}`),
    enabled: [0, 5].includes(tab),
    staleTime: 5 * 60 * 1000,
  });
  const stripe: StripeStats | null = stripeRaw ?? null;

  async function handleStripeRefresh() {
    setStripeRefreshing(true);
    await refetchStripe();
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
  const igEff      = (sinceConnection ? (sinceConnSnap?.igHist      ?? null) : (periodIndex > 0 ? (snapData?.igHist      ?? null) : ig))      as IGStats | null;
  const ytEff      = (sinceConnection ? (sinceConnSnap?.ytHist      ?? null) : (periodIndex > 0 ? (snapData?.ytHist      ?? null) : yt))      as YTStats | null;
  // true quand yt est retombé sur ytRaw brut (pas de snapshot pour la période) — ytRaw agrège toujours sur 30j côté API
  const ytIsFallback = !sinceConnection && periodIndex === 0 && !ytCurrentPeriodTotals;
  const shortioEff = (sinceConnection ? (sinceConnSnap?.shortioHist ?? null) : (periodIndex > 0 ? (snapData?.shortioHist ?? null) : shortio)) as ShortioStats | null;
  const stripeEff  = (sinceConnection ? (sinceConnSnap?.stripeHist  ?? null) : (periodIndex > 0 ? (snapData?.stripeHist  ?? null) : stripe))  as StripeStats | null;
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
          {tab === 0 && <TabOverviewV2 ig={igEff} yt={ytEff} stripe={stripeEff} msgs={msgsEff} calls={callsEff} callsAllTime={callsAllTimeEff} shortio={shortioEff} period={period} periodIndex={periodIndex} leadIdToMediaId={leadIdToMediaId} prospectLinksData={prospectLinksData} linkClickedByLeadId={linkClickedByLeadId} clicksByUrl={clicksByUrl} calendlyStaticClicsFromDb={calendlyStaticClicsFromDb} igLive={ig} ytLive={yt} sinceConnection={sinceConnection} leads={igLeads} lmHistory={lmHistory} integrationsReadyAt={integrationsReadyAt} />}
          {tab === 1 && <TabInstagram ig={igEff} period={period} periodIndex={periodIndex} profileId={profileId} sinceConnection={sinceConnection} connexionCassee={!!integStatus?.ig?.snapshotError} />}
          {tab === 2 && <TabYouTube yt={ytEff} period={period} profileId={profileId} periodIndex={periodIndex} ytIsFallback={ytIsFallback} sinceConnection={sinceConnection} connexionCassee={!!integStatus?.yt?.snapshotError} />}
          {tab === 3 && <TabFunnel msgs={msgs} calls={funnelCalls} stripe={stripe} ig={funnelIg} yt={funnelYt} shortio={funnelShortio} period={period} periodIndex={periodIndex} onModalChange={setModalOpen} leads={igLeads} prospectLinksData={prospectLinksData} linkClickedByLeadId={linkClickedByLeadId} clicksByUrl={clicksByUrl} sinceConnection={sinceConnection} allTimeStart={allTimeStart} />}
          {tab === 4 && <TabShortioB shortio={shortioEff} shortioLoading={shortioLoading} ig={igEff} yt={ytEff} leads={igLeads} leadMagnets={leadMagnets} destinations={destinations} lmHistory={lmHistory} period={period} periodIndex={periodIndex} profileId={profileId} prospectLinksData={prospectLinksData} clicksByPath={clicksByPath} clicksByUrl={clicksByUrl} urlToCategoryFromDb={urlToCategoryFromDb} businessClicsFromDb={businessClicsFromDb} totalClicsChangePct={totalClicsChangePct} altKwToLmId={altKwToLmId} lmClickedByLeadId={lmClickedByLeadId} linkClickedByLeadId={linkClickedByLeadId} calls={callsEff} callsAllTime={callsAllTimeEff} leadIdToMediaId={leadIdToMediaId} igLive={ig} ytLive={yt} shortioChartHistory={shortioChartHistory} shortioChartHistoryBio={shortioChartHistoryBio} shortioChartHistoryContent={shortioChartHistoryContent} shortioChartHistoryDm={shortioChartHistoryDm} shortioChartHistoryStory={shortioChartHistoryStory} joursCollectesShortio={joursCollectesShortio} selectedMetric={shortioBMetric} setSelectedMetric={setShortioBMetric} chartFilter={shortioBChartFilter} setChartFilter={setShortioBChartFilter} sinceConnection={sinceConnection} integrationsReadyAt={integrationsReadyAt} allTimeStart={allTimeStart} />}
          {tab === 5 && <TabRevenues stripe={stripeEff} calls={callsEff} deals={dealsEff} period={period} periodIndex={periodIndex} onRefresh={handleStripeRefresh} refreshing={stripeRefreshing} sinceConnection={sinceConnection} profileId={profileId} />}
        </>
      )}
    </div>
  );
}
