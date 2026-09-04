'use client';

import { useMemo, useRef, useState, useEffect } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { createClient as createSupabase } from '@/lib/supabase/client';
import { resolveUser } from '@/lib/waitForSession';
import { getPeriodWindow, parisDateStr } from '@/lib/period';
import {
  etatDesSources, sourcesManquantes, sansAudience, enumerer, type SourcePage,
} from '@/lib/sourcesStatsClients';
import { CALL_TYPES_VENTE } from '@/lib/callTypes';
import { calculerCash, type LignePaiement } from '@/lib/dealCash';
import { fetchLignesLeadsBatch, compterLeads, type LignesLeads, type LigneCallLead } from '@/lib/salesCallStats';
import { getClientSignals, watchList, phraseSignaux, type ClientSignals } from '@/lib/clientSignals';
import { useSupabaseClients } from '@/lib/SupabaseClientsContext';
import Avatar, { getInitials, seedForPerson, colorFromSeed } from '@/components/ui/Avatar';
import ZonesDefilement from '@/components/ui/ZonesDefilement';
import PeriodPill, { type Period } from '@/components/ui/PeriodPill';
import GrapheSeries from '@/components/analytics/GrapheSeries';
import { Skeleton } from '@/components/ui/Skeleton';
import Icon from '@/components/ui/Icon';
import type { SerieGraphe } from '@/lib/grapheSvg';
import {
  METRIQUES, LIBELLES_TRI, agreger, granulariteDe, intituleColonneCourbe,
  libelleComparaison, semaineAccompagnement, ancienneteEnJours, sequenceFenetres,
  trierLignes, filtrerLignes, formaterValeur, formaterVariation, tauxCollecte,
  JOURS_MINIMUM_TRAJECTOIRE, repartirParFenetre,
  type Metrique, type CritereTri, type LigneEleve, type EtatEleve,
  versCsv, nomFichierCsv, libelleFraicheur,
} from '@/lib/statsClients';

/* Stats Clients — la vue portefeuille du coach.
 *
 * Elle se situe ENTRE la page Clients (opérationnel : qui a une tâche en retard) et la
 * page de stats d'un élève (le détail d'une personne). Ici on regarde les quarante d'un
 * coup. Le plan complet, les 60 décisions et leurs raisons : docs/plan-stats-clients.md.
 *
 * Trois règles qui expliquent la plupart des choix de ce fichier :
 *
 * 1. AUCUN APPEL D'API. Quarante élèves × quatre intégrations, ce serait 160 appels et
 *    les quotas Meta et YouTube sauteraient. La page lit la base, point — d'où l'absence
 *    de bouton « Rafraîchir » que portent toutes les autres pages de stats.
 *
 * 2. AUCUNE ÉCRITURE. On lit, on filtre, on clique vers une fiche. Pas d'état optimiste,
 *    pas de rollback, pas de lib/mutate.
 *
 * 3. UN 0 AFFIRME, UN TROU DIT « ON NE SAIT PAS ». Chaque valeur inconnue reste `null`
 *    jusqu'à l'affichage, où elle devient un tiret cadratin.
 */

/** ⚠️ Doit rester égal au `gap` de `.veille-fil` dans globals.css. */
const VEILLE_GAP = 11;
const VEILLE_PAR_VUE = 4;

/* ═══ Lecture ════════════════════════════════════════════════════════════════ */

interface LigneSerie {
  profile_id: string;
  fenetre: string;
  ig_followers: number | null;
  yt_subscribers: number | null;
  ig_views: number | null;
  ig_profile_views: number | null;
  clics: number | null;
  publications: number | null;
}

interface ClientBrut {
  id: string;
  profile_id: string | null;
  name: string;
  niche: string | null;
  onboarding_completed_at: string | null;
  integrations_ready_at: string | null;
  archived_at: string | null;
}

/** Un élève nommé dans le bandeau. `id` et `photo` servent uniquement à le dessiner :
 *  on le reconnaît à son visage avant de lire son nom. */
interface EleveSignale { profileId: string; nom: string; id: string; photo: string | null }

interface DonneesStats {
  clients: ClientBrut[];
  series: LigneSerie[];
  seriesPrecedentes: LigneSerie[];
  calls: { coach_id: string; status: string | null; booked_at: string | null; scheduled_at: string | null }[];
  deals: { profile_id: string; amount_total: number | string | null; signed_at: string | null; status: string | null }[];
  paiements: { amount: number | string | null; status: string | null; paid_at: string | null; deals: { profile_id: string } | null }[];
  /** Lignes BRUTES par élève. La page compte elle-même, fenêtre par fenêtre, en
   *  appelant `compterLeads` — la règle reste unique, seul le découpage change. */
  lignesLeads: Map<string, LignesLeads>;
  /** Séries HEBDOMADAIRES sur toute l'ancienneté, pour l'axe des semaines
   *  d'accompagnement. Hors période : ce graphe ne suit pas le sélecteur, par nature. */
  accompagnement: LigneSerie[];
  /** Dernier jour collecté par élève. Un élève ABSENT de cette table n'a jamais rien
   *  eu de collecté — ce n'est pas la même chose qu'un retard.
   *
   *  Sert à dater la page sur l'élève le PLUS EN RETARD : un seul élève à jour ne doit
   *  pas afficher « il y a 5 min » quand la moitié du portefeuille date d'hier. */
  dernierJourParProfil: Map<string, string>;
  /** Déclarés prêts, mais AUCUN compte Instagram ni YouTube branché. Cette page ne peut
   *  rien dire d'eux : ni abonnés, ni vues, ni publications. */
  sansAudience: EleveSignale[];
  /** Une source d'audience EST branchée et pourtant rien n'a jamais été collecté.
   *  Distinct du précédent : rien à connecter, une collecte à faire repartir. */
  sourceMuette: EleveSignale[];
  /** L'audience est là, mais il manque d'autres sources de CETTE page : leurs colonnes
   *  sont vides sans que rien ne dise pourquoi. */
  partiels: (EleveSignale & { manquantes: SourcePage[] })[];
  /** Élèves dont une intégration est tombée APRÈS le gate. Leur `integrations_ready_at`
   *  reste posé, donc ils comptent dans les totaux — avec des chiffres figés au jour de
   *  la panne, et rien à l'écran ne le dirait sans ce bandeau. */
  integrationsCassees: EleveSignale[];
  debut: Date;
  /** Photo de profil par identifiant de CLIENT. Sur `profiles`, jamais sur `clients` :
   *  c'est pour ça qu'elle manquait partout sur cette page. */
  photoParClient: Map<string, string | null>;
  /** Le jour où le portefeuille a commencé à mesurer. ⚠️ À NE PAS confondre avec
   *  `debut`, qui est le début de la période affichée : c'est cette confusion qui
   *  bloquait la navigation arrière. */
  debutPortefeuille: Date;
  fin: Date;
  debutPrecedent: Date | null;
  finPrecedente: Date | null;
}

async function charger(period: Period, periodIndex: number, allTime: boolean): Promise<DonneesStats> {
  const supabase = createSupabase();
  const user = await resolveUser(supabase);
  if (!user) throw new Error('Non authentifié');

  // ⚠️ Les élèves ARCHIVÉS sont chargés eux aussi, contrairement à tous les autres
  // écrans du coach qui filtrent `archived_at is null`. C'est délibéré : ailleurs on
  // affiche un état courant, ici un historique — et un historique qui se réécrit quand
  // on archive quelqu'un n'est pas un historique. Le cash de juillet doit rester le
  // cash de juillet. Ils sont écartés plus bas des périodes POSTÉRIEURES à leur départ.
  const { data: clientsData, error: eClients } = await supabase
    .from('clients')
    .select('id, profile_id, name, niche, onboarding_completed_at, integrations_ready_at, archived_at')
    .eq('coach_id', user.id)
    .order('created_at', { ascending: true });
  if (eClients) throw eClients;

  const clients = (clientsData || []) as ClientBrut[];
  const profileIds = clients.map(c => c.profile_id).filter((x): x is string => !!x);

  const granularite = granulariteDe(period, allTime);

  // Fenêtre courante et fenêtre précédente. En All-Time il n'y a pas de « précédent » :
  // la comparaison n'a pas de sens et les cartes n'en afficheront aucune.
  let debut: Date;
  let fin: Date;
  let debutPrecedent: Date | null = null;
  let finPrecedente: Date | null = null;

  /* Le jour où le portefeuille a commencé à mesurer : le plus ancien démarrage parmi
   * les élèves. `integrations_ready_at` d'abord — c'est la date de mise en route du
   * pipeline, la seule qui fasse foi ; `onboarding_completed_at` seulement en secours.
   *
   * ⚠️ Il se calcule TOUJOURS, pas seulement en All-Time, parce qu'il sert à DEUX
   * choses : la borne basse de la fenêtre All-Time, et le plancher de la navigation
   * arrière. Le confondre avec `debut` — le début de la période AFFICHÉE — verrouille
   * la navigation sur place : en septembre, le plancher devenait le 1er septembre,
   * donc reculer vers août était interdit par construction. */
  const departs = clients
    .map(c => c.integrations_ready_at || c.onboarding_completed_at)
    .filter((d): d is string => !!d)
    .map(d => new Date(d).getTime())
    .filter(t => !Number.isNaN(t));
  const debutPortefeuille = departs.length > 0
    ? new Date(Math.min(...departs))
    : new Date(Date.now() - 365 * 86_400_000);

  if (allTime) {
    // D9 : l'union des All-Time individuels. Il n'existe pas de date de départ commune
    // au portefeuille, et il ne faut pas en inventer une.
    debut = debutPortefeuille;
    fin = new Date();
  } else {
    const w = getPeriodWindow(periodIndex, period === 7 ? 'week' : 'month');
    debut = w.periodStart;
    fin = w.periodEnd;
    const p = getPeriodWindow(periodIndex + 1, period === 7 ? 'week' : 'month');
    debutPrecedent = p.periodStart;
    finPrecedente = p.periodEnd;
  }

  const jour = (d: Date) => d.toISOString().slice(0, 10);

  const rien = { data: [] as any[], error: null };
  // L'axe d'accompagnement remonte à l'arrivée du plus ancien, quelle que soit la
  // période choisie : il compare des élèves au même STADE, pas à la même date.
  const arrivees = clients
    .map(c => c.onboarding_completed_at)
    .filter((d): d is string => !!d)
    .map(d => new Date(d).getTime())
    .filter(t => !Number.isNaN(t));
  const debutAccompagnement = arrivees.length > 0
    ? new Date(Math.min(...arrivees))
    : new Date(Date.now() - 365 * 86_400_000);

  const [seriesRes, precRes, callsRes, dealsRes, paiementsRes, lignesLeads, accompRes, fraicheurRes, integRes, profilsRes] = await Promise.all([
    profileIds.length
      ? supabase.rpc('stats_clients_series', {
          p_profile_ids: profileIds, p_debut: jour(debut), p_fin: jour(fin), p_granularite: granularite,
        })
      : rien,
    profileIds.length && debutPrecedent && finPrecedente
      ? supabase.rpc('stats_clients_series', {
          p_profile_ids: profileIds, p_debut: jour(debutPrecedent), p_fin: jour(finPrecedente), p_granularite: granularite,
        })
      : rien,
    // ⚠️ `calls.coach_id` est le profile_id de l'ÉLÈVE, pas le coach humain
    // (docs/calls-coach-id-piege.md). Vente = calendly ET manual, jamais calendly seul :
    // le filtre trop strict faisait disparaître les calls créés à la main.
    profileIds.length
      ? supabase.from('calls').select('coach_id, status, booked_at, scheduled_at')
          .in('coach_id', profileIds).in('call_type', CALL_TYPES_VENTE).neq('ignored', true)
      : rien,
    // `deals` est la source du cash depuis le 2026-08-20 ; `calls.revenue` n'est plus
    // qu'une trace du rapport de call.
    profileIds.length
      ? supabase.from('deals').select('profile_id, amount_total, signed_at, status').in('profile_id', profileIds)
      : rien,
    profileIds.length
      ? supabase.from('deal_payments').select('amount, status, paid_at, deals!inner(profile_id)')
          .in('deals.profile_id', profileIds).not('paid_at', 'is', null)
      : rien,
    // Lues depuis la borne la PLUS ANCIENNE des deux fenêtres : les mêmes lignes
    // servent à la période courante et à la précédente, en une seule lecture.
    fetchLignesLeadsBatch(supabase, profileIds, (debutPrecedent ?? debut).toISOString()),
    profileIds.length
      ? supabase.rpc('stats_clients_series', {
          p_profile_ids: profileIds, p_debut: jour(debutAccompagnement), p_fin: jour(new Date()),
          p_granularite: 'semaine',
        })
      : rien,
    /* Fraîcheur : une ligne par élève, agrégée en base.
     *
     * ⚠️ Surtout PAS une fenêtre de dix jours, comme c'était le cas avant. Un élève
     * collecté il y a quinze jours en était absent, donc indiscernable d'un élève dont
     * rien n'a JAMAIS été collecté — et les deux recevaient le même message. Ce sont
     * deux situations très différentes : l'une dit « les chiffres sont vieux », l'autre
     * dit « il n'y a jamais rien eu ». */
    profileIds.length
      ? supabase.from('dernier_snapshot_par_profil').select('profile_id, dernier_jour')
          .in('profile_id', profileIds)
      : rien,
    profileIds.length
      ? supabase.from('integrations').select('profile_id, provider, status').in('profile_id', profileIds)
      : rien,
    /* La photo de profil vit sur `profiles`, pas sur `clients` — c'est pour ça que
     * cette page n'en affichait aucune : elle ne lisait que `clients`, et passait donc
     * à `Avatar` des initiales sans jamais lui donner d'URL. Le composant sait afficher
     * une photo depuis toujours (`avatarUrl`), personne ne la lui fournissait. */
    profileIds.length
      ? supabase.from('profiles').select('id, avatar_url').in('id', profileIds)
      : rien,
  ]);

  if (seriesRes.error) throw seriesRes.error;
  if (callsRes.error) throw callsRes.error;
  if (dealsRes.error) throw dealsRes.error;
  if (paiementsRes.error) throw paiementsRes.error;

  // La vue rend déjà une ligne par élève : plus de dédoublonnage à faire ici.
  const dernierJourParProfil = new Map<string, string>();
  for (const r of (fraicheurRes.data || []) as { profile_id: string; dernier_jour: string }[]) {
    if (r.dernier_jour) dernierJourParProfil.set(r.profile_id, r.dernier_jour);
  }

  /* ⚠️ La liste des providers vient de `lib/sourcesStatsClients.ts`, jamais d'ici.
   * Elle était écrite en dur dans ce fichier jusqu'au 2026-09-03, ce que
   * `app/api/integrations/health/route.ts` interdit explicitement : « un écran qui les
   * redéciderait serait la copie suivante d'une règle qui doit valoir partout pareil ». */
  const etatSources = etatDesSources(
    (integRes.data || []) as { profile_id: string; provider: string | null; status: string | null }[],
  );

  const photoParProfil = new Map<string, string | null>();
  for (const r of (profilsRes.data || []) as { id: string; avatar_url: string | null }[]) {
    photoParProfil.set(r.id, r.avatar_url);
  }
  const photoDe = (c: ClientBrut) => (c.profile_id ? photoParProfil.get(c.profile_id) ?? null : null);

  const declares = clients.filter(c => c.profile_id && c.integrations_ready_at && !c.archived_at);
  const etatDe = (c: ClientBrut) => etatSources.get(c.profile_id!);

  /* Une intégration TOMBÉE. Ses chiffres sont figés au jour de la panne et continuent
   * d'être comptés : c'est le seul cas qui FAUSSE les totaux. */
  const integrationsCassees = declares
    .filter(c => (etatDe(c)?.cassees.size ?? 0) > 0)
    .map(c => ({ profileId: c.profile_id!, nom: c.name, id: c.id, photo: photoDe(c) }));

  /* Ni Instagram ni YouTube : l'élève ne figure sur AUCUN graphe. Conséquence d'une
   * autre nature qu'une colonne vide, d'où sa propre phrase. */
  const sansAudienceListe = declares
    .filter(c => sansAudience(etatDe(c)))
    .map(c => ({ profileId: c.profile_id!, nom: c.name, id: c.id, photo: photoDe(c) }));

  /* Une source d'audience est branchée et pourtant rien n'est jamais arrivé. Rien à
   * connecter ici : une collecte à faire repartir. Transitoire dans les heures qui
   * suivent une connexion, anormal au-delà. */
  const sourceMuette = declares
    .filter(c => !sansAudience(etatDe(c)) && !dernierJourParProfil.has(c.profile_id!))
    .map(c => ({ profileId: c.profile_id!, nom: c.name, id: c.id, photo: photoDe(c) }));

  /* Il manque une ou plusieurs sources, mais l'audience est là : l'élève apparaît, avec
   * des colonnes vides. Tranché avec Chris le 2026-09-03 — il veut être prévenu, mais
   * ceux qui n'ont AUCUNE audience reçoivent déjà un message plus fort, alors on ne les
   * nomme pas deux fois. */
  const sansAudienceIds = new Set(sansAudienceListe.map(x => x.profileId));
  const partiels = declares
    .filter(c => !sansAudienceIds.has(c.profile_id!))
    .map(c => ({ profileId: c.profile_id!, nom: c.name, id: c.id, photo: photoDe(c), manquantes: sourcesManquantes(etatDe(c)) }))
    .filter(x => x.manquantes.length > 0);

  return {
    clients,
    dernierJourParProfil,
    sansAudience: sansAudienceListe,
    sourceMuette,
    partiels,
    integrationsCassees,
    series: (seriesRes.data || []) as LigneSerie[],
    seriesPrecedentes: (precRes.data || []) as LigneSerie[],
    calls: (callsRes.data || []) as any[],
    deals: (dealsRes.data || []) as any[],
    paiements: (paiementsRes.data || []) as any[],
    lignesLeads,
    accompagnement: (accompRes.data || []) as LigneSerie[],
    photoParClient: new Map(clients.map(c => [c.id, photoDe(c)])),
    debut, fin, debutPrecedent, finPrecedente, debutPortefeuille,
  };
}

/* ═══ Dérivations ════════════════════════════════════════════════════════════ */

/** Un call compte dans la fenêtre s'il a été RÉSERVÉ dedans. Repli sur la date du
 *  rendez-vous pour les anciens calls importés sans `booked_at`. Un call réservé le
 *  29 août pour un rendez-vous le 2 septembre compte en août : c'est la réservation qui
 *  crédite la génération du rendez-vous (docs/perimetre-stats-referentiel.md règle 2). */
function dansFenetre(booked: string | null, scheduled: string | null, debut: Date, fin: Date): boolean {
  const ref = booked || scheduled;
  if (!ref) return false;
  const t = new Date(ref).getTime();
  return !Number.isNaN(t) && t >= debut.getTime() && t <= fin.getTime();
}

const EST_ANNULE = (s: string | null) => s === 'canceled' || s === 'cancelled';

interface Agregats {
  cashCollecte: number;
  cashContracte: number;
  abonnesGagnes: number | null;
  abonnesGagnesIg: number | null;
  abonnesGagnesYt: number | null;
  leads: number;
  callsBookes: number;
  ventes: number;
}

export default function PageStatsClients() {
  const { clients: clientsContexte } = useSupabaseClients();

  // Le mois en cours par défaut : c'est la maille à laquelle un coach juge un
  // portefeuille. Une semaine est trop courte pour qu'un call ou une vente s'y voie.
  const [period, setPeriod] = useState<Period>(30);
  const [periodIndex, setPeriodIndex] = useState(0);
  const [allTime, setAllTime] = useState(false);
  const [metrique, setMetrique] = useState<Metrique>('abonnesIg');
  const [metriqueAccompagnement, setMetriqueAccompagnement] = useState<Metrique>('abonnesIg');
  const [plageAccompagnement, setPlageAccompagnement] = useState<number>(12);
  const [critere, setCritere] = useState<CritereTri>('varIg');
  const [sens, setSens] = useState<'asc' | 'desc'>('desc');
  const [recherche, setRecherche] = useState('');
  const [epingle, setEpingle] = useState<string | null>(null);
  const [survole, setSurvole] = useState<string | null>(null);
  const filVeille = useRef<HTMLDivElement>(null);
  const [pageVeille, setPageVeille] = useState(0);

  const { data, isLoading, error } = useQuery({
    queryKey: ['stats-clients', period, periodIndex, allTime],
    queryFn: () => charger(period, periodIndex, allTime),
    staleTime: 60_000,
  });

  const granularite = granulariteDe(period, allTime);
  const vedette = survole || epingle;

  /* ── Les lignes du tableau, et les séries des graphes ─────────────────── */
  const { lignes, agregats, agregatsPrecedents, fenetres } = useMemo(() => {
    const vide = {
      lignes: [] as LigneEleve[],
      agregats: null as Agregats | null,
      agregatsPrecedents: null as Agregats | null,
      fenetres: [] as string[],
    };
    if (!data) return vide;

    const photoParLigne = data.photoParClient;
    const fenetres = sequenceFenetres(data.debut, data.fin, granularite);

    const parProfil = new Map<string, Map<string, LigneSerie>>();
    for (const r of data.series) {
      if (!parProfil.has(r.profile_id)) parProfil.set(r.profile_id, new Map());
      parProfil.get(r.profile_id)!.set(r.fenetre, r);
    }
    const parProfilPrec = new Map<string, LigneSerie[]>();
    for (const r of data.seriesPrecedentes) {
      const l = parProfilPrec.get(r.profile_id);
      if (l) l.push(r); else parProfilPrec.set(r.profile_id, [r]);
    }

    const maintenant = new Date();
    // Capturée hors des fermetures : TypeScript ne conserve pas le rétrécissement de
    // `data` à l'intérieur d'une fonction imbriquée, même après le garde-fou plus haut.
    const finPeriode = data.fin;
    const lignes: LigneEleve[] = [];
    let cumul: Agregats = { cashCollecte: 0, cashContracte: 0, abonnesGagnes: null, abonnesGagnesIg: null, abonnesGagnesYt: null, leads: 0, callsBookes: 0, ventes: 0 };
    let cumulPrec: Agregats = { ...cumul };

    for (const c of data.clients) {
      // Un élève archivé AVANT le début de la fenêtre n'appartient pas à cette période.
      // Archivé pendant ou après : il y a bien vécu, il reste dans les totaux.
      if (c.archived_at && new Date(c.archived_at).getTime() < data.debut.getTime()) continue;

      const pid = c.profile_id;
      const parFenetre = pid ? parProfil.get(pid) : undefined;
      const valeurs = (champ: keyof LigneSerie) =>
        fenetres.map(f => {
          const r = parFenetre?.get(f);
          const v = r ? (r[champ] as number | null) : null;
          return v === null || v === undefined ? null : Number(v);
        });

      const serieIg = valeurs('ig_followers');
      const serieYt = valeurs('yt_subscribers');
      const abonnesIg = agreger(serieIg, 'niveau');
      const abonnesYt = agreger(serieYt, 'niveau');

      // La variation, c'est le dernier moins le PREMIER de la fenêtre — pas une somme.
      const premier = (s: (number | null)[]) => s.find(v => v !== null) ?? null;
      const dernier = (s: (number | null)[]) => [...s].reverse().find(v => v !== null) ?? null;
      const variation = (s: (number | null)[]) => {
        const a = premier(s); const b = dernier(s);
        return a === null || b === null ? null : b - a;
      };

      const publications = agreger(valeurs('publications'), 'flux');

      const callsEleve = pid ? data.calls.filter(k => k.coach_id === pid) : [];
      const callsBookes = pid
        ? callsEleve.filter(k => !EST_ANNULE(k.status) && dansFenetre(k.booked_at, k.scheduled_at, data.debut, data.fin)).length
        : null;

      // Leads : la déduplication se fait sur TOUTES les lignes, puis la date la plus
      // ancienne est bornée à la fenêtre. Pré-filtrer les lignes ferait passer pour
      // « nouveau ce mois » un prospect de juillet dont un lien a été recréé en août.
      const brutLeads: LignesLeads = pid
        ? data.lignesLeads.get(pid) ?? { leads: [], liens: [], callsIgDirects: [], callsYoutube: [] }
        : { leads: [], liens: [], callsIgDirects: [], callsYoutube: [] };
      const dansLaFenetre = (c: LigneCallLead) =>
        dansFenetre(c.booked_at ?? null, c.scheduled_at ?? null, data.debut, data.fin);
      const leads = pid
        ? compterLeads({
            ...brutLeads,
            callsIgDirects: brutLeads.callsIgDirects.filter(dansLaFenetre),
            callsYoutube: brutLeads.callsYoutube.filter(dansLaFenetre),
          }, data.debut.toISOString(), data.fin.toISOString())
        : null;

      const dealsEleve = pid ? data.deals.filter(d => d.profile_id === pid) : [];
      const dealsFenetre = dealsEleve.filter(d =>
        d.status !== 'canceled' && d.signed_at &&
        new Date(d.signed_at).getTime() >= data.debut.getTime() &&
        new Date(d.signed_at).getTime() <= data.fin.getTime());
      const cashContracte = dealsFenetre.reduce((s, d) => s + Number(d.amount_total || 0), 0);

      // ⚠️ `calculerCash` et jamais une somme à la main : sept lectures sommaient les
      // paiements `succeeded` sans jamais déduire un remboursement (2 800 € affichés
      // pour 2 600 € en caisse, corrigé le 2026-08-30).
      const paiementsEleve = pid ? data.paiements.filter(p => p.deals?.profile_id === pid) : [];
      const paiementsFenetre: LignePaiement[] = paiementsEleve
        .filter(p => p.paid_at &&
          new Date(p.paid_at).getTime() >= data.debut.getTime() &&
          new Date(p.paid_at).getTime() <= data.fin.getTime())
        .map(p => ({ amount: p.amount, status: p.status }));
      const cashCollecte = calculerCash(paiementsFenetre).net;

      /* La série tracée par le graphe. Les cinq premières métriques viennent de la
       * fonction SQL ; les quatre dernières sont découpées ici, depuis les tables
       * sources déjà chargées — le cash obéit à `calculerCash`, jamais à une somme. */
      function serieDeLaMetrique(): (number | null)[] {
        switch (metrique) {
          case 'abonnesIg': return serieIg;
          case 'abonnesYt': return serieYt;
          case 'vues': return valeurs('ig_views');
          case 'clics': return valeurs('clics');
          case 'publications': return valeurs('publications');
          case 'callsBookes':
            return repartirParFenetre(
              callsEleve.filter(k => !EST_ANNULE(k.status)),
              k => k.booked_at || k.scheduled_at, fenetres, granularite,
            ).map(p => p.length);
          case 'ventes':
            return repartirParFenetre(
              dealsEleve.filter(d => d.status !== 'canceled'),
              d => d.signed_at, fenetres, granularite,
            ).map(p => p.length);
          case 'cashCollecte':
            return repartirParFenetre(
              paiementsEleve, p => p.paid_at, fenetres, granularite,
            ).map(p => calculerCash(p.map(x => ({ amount: x.amount, status: x.status }))).net);
          case 'leads':
            // Un point par fenêtre = les leads dont la date la plus ancienne y tombe.
            return fenetres.map((f, i) => {
              const finF = i + 1 < fenetres.length
                ? new Date(new Date(fenetres[i + 1] + 'T00:00:00Z').getTime() - 1)
                : finPeriode;
              const debF = new Date(f + 'T00:00:00Z');
              return compterLeads({
                ...brutLeads,
                callsIgDirects: brutLeads.callsIgDirects.filter(c =>
                  dansFenetre(c.booked_at ?? null, c.scheduled_at ?? null, debF, finF)),
                callsYoutube: brutLeads.callsYoutube.filter(c =>
                  dansFenetre(c.booked_at ?? null, c.scheduled_at ?? null, debF, finF)),
              }, debF.toISOString(), finF.toISOString());
            });
        }
      }

      const jours = ancienneteEnJours(c.onboarding_completed_at, maintenant);
      let etat: EtatEleve | null = null;
      if (!c.integrations_ready_at) etat = 'installation';
      else if (jours !== null && jours < JOURS_MINIMUM_TRAJECTOIRE) etat = 'trop_recent';

      lignes.push({
        id: c.id, profileId: pid, nom: c.name, niche: c.niche,
        semaine: semaineAccompagnement(c.onboarding_completed_at, maintenant),
        abonnesIg, abonnesYt,
        variationIg: variation(serieIg), variationYt: variation(serieYt),
        publications, leads, callsBookes,
        cashContracte, cashCollecte,
        photo: photoParLigne.get(c.id) ?? null,
        serie: serieDeLaMetrique(),
        etat,
      });

      cumul.cashCollecte += cashCollecte;
      cumul.cashContracte += cashContracte;
      cumul.leads += leads ?? 0;
      cumul.callsBookes += callsBookes ?? 0;
      cumul.ventes += dealsFenetre.length;
      const vIg = variation(serieIg);
      const vYt = variation(serieYt);
      if (vIg !== null) cumul.abonnesGagnesIg = (cumul.abonnesGagnesIg ?? 0) + vIg;
      if (vYt !== null) cumul.abonnesGagnesYt = (cumul.abonnesGagnesYt ?? 0) + vYt;

      // Période précédente : seulement ce que les cartes comparent.
      if (data.debutPrecedent && data.finPrecedente) {
        const prec = pid ? parProfilPrec.get(pid) ?? [] : [];
        const sIg = prec.map(r => (r.ig_followers === null ? null : Number(r.ig_followers)));
        const sYt = prec.map(r => (r.yt_subscribers === null ? null : Number(r.yt_subscribers)));
        const vIgP = variation(sIg);
        const vYtP = variation(sYt);
        if (vIgP !== null) cumulPrec.abonnesGagnesIg = (cumulPrec.abonnesGagnesIg ?? 0) + vIgP;
        if (vYtP !== null) cumulPrec.abonnesGagnesYt = (cumulPrec.abonnesGagnesYt ?? 0) + vYtP;
        cumulPrec.leads += pid ? compterLeads({
          ...brutLeads,
          callsIgDirects: brutLeads.callsIgDirects.filter(c =>
            dansFenetre(c.booked_at ?? null, c.scheduled_at ?? null, data.debutPrecedent!, data.finPrecedente!)),
          callsYoutube: brutLeads.callsYoutube.filter(c =>
            dansFenetre(c.booked_at ?? null, c.scheduled_at ?? null, data.debutPrecedent!, data.finPrecedente!)),
        }, data.debutPrecedent.toISOString(), data.finPrecedente.toISOString()) : 0;
        cumulPrec.callsBookes += callsEleve.filter(k =>
          !EST_ANNULE(k.status) && dansFenetre(k.booked_at, k.scheduled_at, data.debutPrecedent!, data.finPrecedente!)).length;
        const dealsPrec = dealsEleve.filter(d =>
          d.status !== 'canceled' && d.signed_at &&
          new Date(d.signed_at).getTime() >= data.debutPrecedent!.getTime() &&
          new Date(d.signed_at).getTime() <= data.finPrecedente!.getTime());
        cumulPrec.ventes += dealsPrec.length;
        cumulPrec.cashContracte += dealsPrec.reduce((s, d) => s + Number(d.amount_total || 0), 0);
        cumulPrec.cashCollecte += calculerCash(
          pid ? data.paiements
            .filter(p => p.deals?.profile_id === pid && p.paid_at &&
              new Date(p.paid_at).getTime() >= data.debutPrecedent!.getTime() &&
              new Date(p.paid_at).getTime() <= data.finPrecedente!.getTime())
            .map(p => ({ amount: p.amount, status: p.status })) : [],
        ).net;
      }
    }

    const somme = (a: number | null, b: number | null) =>
      a === null && b === null ? null : (a ?? 0) + (b ?? 0);
    cumul.abonnesGagnes = somme(cumul.abonnesGagnesIg, cumul.abonnesGagnesYt);
    cumulPrec.abonnesGagnes = somme(cumulPrec.abonnesGagnesIg, cumulPrec.abonnesGagnesYt);

    return {
      lignes,
      agregats: cumul,
      agregatsPrecedents: data.debutPrecedent ? cumulPrec : null,
      fenetres,
    };
  }, [data, granularite, metrique]);

  /* ── La bande « à regarder » : miroir exact de l'accueil ──────────────── */
  const aSurveiller = useMemo(() => {
    const avec = clientsContexte.map(c => ({
      client: c,
      signals: getClientSignals(c.tasks, c.sessionReports, c.joursSansPublier),
    }));
    // Aucun plafond ici, contrairement à l'accueil : le carrousel les montre tous.
    return watchList(avec);
  }, [clientsContexte]);

  /* ── Séries des graphes ──────────────────────────────────────────────── */
  const seriesGraphe: SerieGraphe[] = useMemo(() =>
    lignes
      .filter(l => l.serie.some(v => v !== null))
      .map(l => ({
        nom: l.id,
        court: l.nom.split(' ')[0],
        couleur: colorFromSeed(seedForPerson(l.nom)),
        valeurs: l.serie,
      })), [lignes]);

  const etiquettes = useMemo(() => {
    // Sur une semaine il n'y a que sept points : chacun porte son jour en toutes
    // lettres (« lun. 31 août »), comme le fait Mes Stats. Au-delà, on éclaircit,
    // sinon les libellés se chevauchent.
    const avecJour = !allTime && period === 7;
    const pas = avecJour ? 1
      : fenetres.length > 30 ? Math.ceil(fenetres.length / 8)
      : fenetres.length > 12 ? 4 : 1;
    return fenetres
      .map((f, i) => ({ i, t: f }))
      .filter((_, i) => i % pas === 0)
      .map(e => ({ i: e.i, t: formaterEtiquette(e.t, granularite, avecJour) }));
  }, [fenetres, granularite, allTime, period]);

  /* ── §5 : l'axe des semaines d'accompagnement ─────────────────────────
   *
   * L'abscisse n'est plus le calendrier mais la semaine d'accompagnement : chaque
   * courbe démarre à SON S1. C'est ce qui rend visible le motif « les courbes se
   * redressent toutes vers la même semaine », que l'axe calendaire noie sous les dates
   * de démarrage.
   *
   * L'ordonnée est en POURCENTAGE du niveau à S1 pour un niveau, et en cumul pour un
   * flux. En valeur absolue, les 146 000 abonnés d'un gros compte écraseraient les
   * 6 000 d'un autre et le graphe ne montrerait plus qu'une courbe utile.
   *
   * ⚠️ Contrepartie assumée : un élève qui démarre à 400 abonnés fait +180 % sans
   * effort là où un compte à 140 000 plafonne à +12 %. Ce graphe sert à lire la FORME
   * des trajectoires, pas à classer les élèves — le classement, c'est le tableau.
   */
  /* ⚠️ Un élève non tracé doit être COMPTÉ et sa raison retenue.
   *
   * La version précédente sortait de la boucle par un `continue` nu quand la date
   * d'arrivée manquait : l'élève disparaissait du graphe ET du compte. Sur le compte de
   * test, DRG n'a pas de `onboarding_completed_at` — la note annonçait donc « 1 élève »
   * là où deux ne figuraient nulle part. Un écran qui compte mal ce qu'il cache est
   * pire qu'un écran qui ne compte rien : on le croit. */
  const { seriesAccompagnement, semainesMax, nonTraces, depuisSemaine } = useMemo(() => {
    const vide = {
      seriesAccompagnement: [] as SerieGraphe[], semainesMax: 1,
      nonTraces: new Map<string, RaisonNonTrace>(),
      depuisSemaine: new Map<string, number>(),
    };
    if (!data) return vide;
    const nonTraces = new Map<string, RaisonNonTrace>();
    /* La semaine où la collecte a commencé, par élève.
     *
     * ⚠️ Elle répond à la seule question que ce graphe posait sans y répondre :
     * « pourquoi cette courbe commence-t-elle au milieu ? ». On croit qu'une courbe
     * devrait partir de S1 parce que l'axe part de S1 ; en réalité elle part de la
     * semaine où l'on a commencé à mesurer CET élève. Sur le compte de test, RDJ est
     * arrivé le 30 juillet mais son Instagram n'a été connecté que le 29 août : quatre
     * semaines sans rien à mesurer, donc une courbe qui démarre à S5.
     *
     * En production ce cas est presque impossible : l'accès élève est verrouillé tant
     * que les sept intégrations ne sont pas connectées (`app/(client)/layout.tsx`), donc
     * la collecte démarre avec l'accompagnement. La mention ne s'affichera donc
     * quasiment jamais — c'est voulu : elle explique l'anomalie quand elle survient, et
     * se tait le reste du temps. */
    const depuisSemaine = new Map<string, number>();
    const maintenant = new Date();
    const parProfil = new Map<string, LigneSerie[]>();
    for (const r of data.accompagnement) {
      const l = parProfil.get(r.profile_id);
      if (l) l.push(r); else parProfil.set(r.profile_id, [r]);
    }

    const nature = METRIQUES[metriqueAccompagnement].nature;
    const champ: keyof LigneSerie =
      metriqueAccompagnement === 'abonnesYt' ? 'yt_subscribers'
      : metriqueAccompagnement === 'vues' ? 'ig_views'
      : metriqueAccompagnement === 'clics' ? 'clics'
      : metriqueAccompagnement === 'publications' ? 'publications'
      : 'ig_followers';

    let maxSemaines = 1;
    const series: SerieGraphe[] = [];

    for (const c of data.clients) {
      if (c.archived_at) continue;
      if (!c.profile_id || !c.onboarding_completed_at) { nonTraces.set(c.id, 'sans-arrivee'); continue; }
      const jours = ancienneteEnJours(c.onboarding_completed_at, maintenant);
      // D21 : un élève de moins de cinq jours n'a pas une trajectoire, il a deux points.
      if (jours === null || jours < JOURS_MINIMUM_TRAJECTOIRE) { nonTraces.set(c.id, 'trop-recent'); continue; }

      // Le lundi de la semaine d'arrivée, calculé par la même règle que la base
      // (date_trunc('week'), norme ISO) — sinon les index se décalent d'une semaine.
      const lundiArrivee = sequenceFenetres(
        new Date(c.onboarding_completed_at), new Date(c.onboarding_completed_at), 'semaine',
      )[0];
      if (!lundiArrivee) { nonTraces.set(c.id, 'sans-arrivee'); continue; }
      const t0 = new Date(lundiArrivee + 'T00:00:00Z').getTime();

      const brutes: (number | null)[] = [];
      for (const r of parProfil.get(c.profile_id) ?? []) {
        const idx = Math.round((new Date(r.fenetre + 'T00:00:00Z').getTime() - t0) / (7 * 86_400_000));
        if (idx < 0) continue;
        const v = r[champ] as number | null;
        brutes[idx] = v === null || v === undefined ? null : Number(v);
      }
      for (let i = 0; i < brutes.length; i++) if (brutes[i] === undefined) brutes[i] = null;
      if (brutes.filter(v => v !== null).length < 2) { nonTraces.set(c.id, 'sans-donnees'); continue; }

      let valeurs: (number | null)[];
      if (nature === 'niveau') {
        const base = brutes.find(v => v !== null) ?? null;
        valeurs = base && base !== 0
          ? brutes.map(v => (v === null ? null : ((v / base) - 1) * 100))
          : brutes;
      } else {
        let c2 = 0;
        valeurs = brutes.map(v => { if (v === null) return null; c2 += v; return c2; });
      }

      const borne = plageAccompagnement > 0 ? valeurs.slice(0, plageAccompagnement) : valeurs;
      // Assez de données, mais pas dans la PLAGE affichée (S1-S12 par exemple).
      if (borne.filter(v => v !== null).length < 2) { nonTraces.set(c.id, 'hors-plage'); continue; }
      maxSemaines = Math.max(maxSemaines, borne.length);
      // Index 0 = S1, donc la première valeur connue est en S(index + 1).
      const premiere = borne.findIndex(v => v !== null);
      if (premiere > 0) depuisSemaine.set(c.id, premiere + 1);
      series.push({
        nom: c.id,
        court: c.name.split(' ')[0],
        couleur: colorFromSeed(seedForPerson(c.name)),
        valeurs: borne,
      });
    }
    return { seriesAccompagnement: series, semainesMax: maxSemaines, nonTraces, depuisSemaine };
  }, [data, metriqueAccompagnement, plageAccompagnement]);

  const etiquettesAccompagnement = useMemo(() => {
    const pas = semainesMax > 30 ? 8 : semainesMax > 16 ? 4 : 2;
    const out: { i: number; t: string }[] = [];
    for (let i = 0; i < semainesMax; i += pas) out.push({ i, t: `S${i + 1}` });
    return out;
  }, [semainesMax]);

  const lignesAffichees = useMemo(
    () => trierLignes(filtrerLignes(lignes, recherche), critere, sens),
    [lignes, recherche, critere, sens],
  );

  /* D36 : la page est datée par l'élève le PLUS EN RETARD, jamais par le plus récent.
   * La page ne peut pas rafraîchir elle-même (160 appels d'API), donc elle doit au
   * moins dire honnêtement de quand datent ses chiffres. */
  const fraicheur = useMemo(() => {
    if (!data || data.dernierJourParProfil.size === 0) return null;
    /* ⚠️ On date la page sur les élèves QUI SONT MESURÉS — c'est-à-dire ceux qui ont au
     * moins une donnée — et non sur ceux dont `integrations_ready_at` est posé.
     *
     * Les deux ne coïncident pas, et l'écart allait dans les deux sens en base le
     * 2026-09-02 : un élève avec le drapeau posé mais aucune intégration ni aucune
     * donnée était compté (et faisait afficher « plus de 10 j » à toute la page), tandis
     * qu'un élève sans drapeau mais avec deux intégrations en marche et 36 jours
     * collectés était ignoré. Le drapeau décrit une intention ; la donnée décrit ce qui
     * se passe vraiment. C'est la donnée qui date la page.
     *
     * Un élève dont rien n'a jamais été collecté n'est pas « en retard » : il n'a pas
     * commencé. Cette alerte-là est portée par le bandeau, avec ses propres mots. */
    let pire: string | null = null;
    for (const c of data.clients) {
      if (!c.profile_id || c.archived_at) continue;
      const d = data.dernierJourParProfil.get(c.profile_id);
      if (!d) continue;
      if (pire === null || d < pire) pire = d;
    }
    if (!pire) return null;
    /* ⚠️ La date du jour est la date PARISIENNE, et l'écart se compte en jours
     * calendaires. La version précédente divisait un écart en millisecondes par
     * 86 400 000 depuis midi UTC : le résultat dépendait donc de l'HEURE à laquelle on
     * ouvrait la page, et la même donnée s'affichait « aujourd'hui » le matin puis
     * « hier » l'après-midi. Constaté le 2026-09-02 — la page annonçait « hier » pour
     * une donnée du 31 août, soit deux jours. */
    return libelleFraicheur(pire, parisDateStr(new Date()));
  }, [data]);

  /* Le bandeau propose d'aller voir un élève dans le tableau. Sans cette ancre, le clic
   * remplissait bien la recherche mais ne déplaçait rien : le tableau est tout en bas de
   * la page, donc à l'écran il ne se passait rien du tout. Un bouton qui ne fait rien de
   * visible est pire qu'une absence de bouton. */
  const ancreTableau = useRef<HTMLDivElement>(null);
  function montrerDansLeTableau(nom: string) {
    setRecherche(nom);
    const reduit = typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    ancreTableau.current?.scrollIntoView({ behavior: reduit ? 'auto' : 'smooth', block: 'start' });
  }

  const enInstallation = lignes.filter(l => l.etat === 'installation').length;
  const actifs = lignes.length - enInstallation;

  if (isLoading) return <SquelettePage />;
  if (error) {
    return (
      <div className="page-content">
        <div className="card" style={{ padding: 24, color: 'var(--red)' }}>
          Impossible de charger les statistiques. {(error as Error).message}
        </div>
      </div>
    );
  }

  const aucuneDonnee = lignes.length > 0 && lignes.every(l => l.etat === 'installation');

  return (
    <div className="page-content">
      {/* Q2 du 2026-09-01 : la page se consulte sur ordinateur — un tableau de treize
          colonnes et un graphe de quarante courbes n'ont pas de version téléphone
          honnête. Mais l'app s'installe en PWA sur le téléphone, donc /analytics EST
          atteignable depuis un iPhone, et n'y afficher aucun avertissement donnait à
          voir une page cassée plutôt qu'une page hors de son écran.

          ⚠️ Le basculement est en CSS, pas en JavaScript. Une bascule sur la largeur
          lue dans window rendrait au premier passage une largeur que le serveur ne
          connaît pas : décalage d'hydratation, et l'avertissement clignoterait sur le
          bureau au chargement. */}
      <div className="stats-hors-format">
        <p><b>Cette page se consulte sur ordinateur.</b></p>
        <p>Le tableau du portefeuille et le graphe comparent jusqu'à quarante élèves côte
          à côte : sur un écran de téléphone, il n'en reste rien de lisible. Tes chiffres
          ne sont pas perdus, ils t'attendent sur grand écran.</p>
      </div>

      <div className="stats-bureau">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
        <div>
          <h1 className="page-title">Stats Clients</h1>
          <p className="page-sub">
            {lignes.length} élève{lignes.length !== 1 ? 's' : ''}
            {enInstallation > 0 && ` · ${actifs} actif${actifs !== 1 ? 's' : ''}, ${enInstallation} en installation`}
            {fraicheur && (
              <span title="Fraîcheur du portefeuille entier : c'est l'élève le plus en retard qui donne la date">
                {' · màj '}{fraicheur}
              </span>
            )}
          </p>
        </div>
        {/* Pas de bouton « Rafraîchir » : à 40 élèves il déclencherait 160 appels d'API
            et ferait sauter les quotas Meta et YouTube. */}
        <PeriodPill
          period={period} setPeriod={setPeriod}
          periodIndex={periodIndex} setPeriodIndex={fn => setPeriodIndex(fn)}
          /* ⚠️ `debutPortefeuille`, JAMAIS `debut`. Ces deux propriétés bornent la
             navigation arrière et l'étiquette All-Time : leur passer le début de la
             période affichée fait que le plancher avance avec la période, et la flèche
             « ‹ » reste grise pour toujours. */
          connectedAt={data?.debutPortefeuille ? data.debutPortefeuille.toISOString() : null}
          allTimeStart={data?.debutPortefeuille ? data.debutPortefeuille.toISOString() : null}
          sinceConnection={allTime} setSinceConnection={setAllTime}
        />
      </div>

      {aucuneDonnee ? (
        <EcranVide lignes={lignes} />
      ) : (
        <>
          {data && (data.integrationsCassees.length > 0 || data.sansAudience.length > 0
            || data.sourceMuette.length > 0 || data.partiels.length > 0) && (
            <BandeauIntegrations
              casses={data.integrationsCassees}
              sansAudience={data.sansAudience}
              muets={data.sourceMuette}
              partiels={data.partiels}
              onVoir={montrerDansLeTableau}
            />
          )}

          {agregats && (
            <BandeauAgrege
              a={agregats} precedent={agregatsPrecedents}
              comparaison={libelleComparaison(period, allTime)}
            />
          )}

          <BandeVeille
            entrees={aSurveiller}
            fil={filVeille}
            page={pageVeille}
            setPage={setPageVeille}
          />

          <CarteGraphe
            titre={METRIQUES[metrique].titre}
            sousTitre={`${fenetres.length} ${granularite === 'mois' ? 'mois' : 'jours'} · survole pour lire tout le monde, clique un élève pour l'isoler`}
            metrique={metrique} setMetrique={setMetrique}
          >
            <GrapheSeries
              series={seriesGraphe}
              n={Math.max(1, fenetres.length)}
              etiquettes={etiquettes}
              unite={METRIQUES[metrique].unite}
              vedette={vedette}
              depuisZero
              libelleAbscisse={i => formaterEtiquette(fenetres[i] ?? '', granularite, !allTime && period === 7)}
              formater={v => formaterValeur(v, METRIQUES[metrique].unite)}
            />
            <Legende lignes={lignes} epingle={epingle} setEpingle={setEpingle} />
          </CarteGraphe>

          <div className="card" style={{ padding: 18, marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
            {/* ⚠️ `flex: 1 1 …` + `minWidth: 0` sur le bloc de texte, `flexShrink: 0`
                sur les contrôles.
                Sans ça, le bloc de texte prend la largeur de son contenu : le
                2026-09-03, un sous-titre rallongé a suffi à pousser le sélecteur et les
                onglets à la ligne suivante, donc à GAUCHE, et Chris a demandé pourquoi
                on les avait déplacés. Personne ne les avait déplacés — c'est le retour
                à la ligne d'un `flexWrap` qui les avait fait tomber.
                Avec ces trois règles, le texte se replie DANS sa colonne et les
                contrôles restent à droite quelle que soit la longueur du libellé. */}
              <div style={{ flex: '1 1 300px', minWidth: 0 }}>
                <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {METRIQUES[metriqueAccompagnement].titreCumule} depuis l'arrivée
                  <AideTitre titre="Comment lire ce graphe">{AIDE_ACCOMPAGNEMENT}</AideTitre>
                </div>
                <div className="card-sub">
                  {/* « hors période » ne disait pas de quelle période il s'agissait :
                      celle du sélecteur en haut de page, que ce graphe ignore
                      volontairement puisqu'il remonte toujours à l'arrivée de l'élève.
                      Le détail du reste est dans l'aide du titre, pas ici — un
                      sous-titre qui explique tout n'est plus un sous-titre. */}
                  Axe en semaines d'accompagnement, hors période sélectionnée
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', flexShrink: 0, marginLeft: 'auto' }}>
                <div className="seg-plage" style={{ display: 'flex', gap: 2, background: 'var(--surface-chat-field)', borderRadius: 8, padding: 3 }}>
                  {[12, 26, 0].map(p => (
                    <button key={p} onClick={() => setPlageAccompagnement(p)} aria-pressed={plageAccompagnement === p}
                      style={{
                        border: 'none', padding: '4px 12px', fontSize: 11.5, fontWeight: 600, borderRadius: 6,
                        cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
                        background: plageAccompagnement === p ? 'var(--ink)' : 'transparent',
                        color: plageAccompagnement === p ? 'var(--surface)' : 'var(--muted)',
                      }}>{p === 0 ? 'Tout' : `S1–S${p}`}</button>
                  ))}
                </div>
                <select className="stats-select" value={metriqueAccompagnement}
                  onChange={e => setMetriqueAccompagnement(e.target.value as Metrique)}>
                  {(Object.keys(METRIQUES) as Metrique[])
                    .filter(m => ['abonnesIg', 'abonnesYt', 'vues', 'publications', 'clics'].includes(m))
                    .map(m => <option key={m} value={m}>{METRIQUES[m].titreCumule}</option>)}
                </select>
              </div>
            </div>
            <GrapheSeries
              series={seriesAccompagnement}
              n={Math.max(1, semainesMax)}
              etiquettes={etiquettesAccompagnement}
              unite={METRIQUES[metriqueAccompagnement].nature === 'niveau' ? '%' : METRIQUES[metriqueAccompagnement].unite}
              vedette={vedette}
              depuisZero
              pointsCourts
              libelleAbscisse={i => `Semaine ${i + 1}`}
              formater={v => METRIQUES[metriqueAccompagnement].nature === 'niveau'
                ? `${v >= 0 ? '+' : ''}${Math.round(v)} %`
                : formaterValeur(v, METRIQUES[metriqueAccompagnement].unite)}
            />
            {nonTraces.size > 0 && (
              <div style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 9, fontFamily: 'var(--font-mono)' }}>
                {phraseNonTraces(nonTraces)}
              </div>
            )}
            <Legende lignes={lignes} epingle={epingle} setEpingle={setEpingle} nonTraces={nonTraces} depuisSemaine={depuisSemaine} />
          </div>

          <div ref={ancreTableau} style={{ scrollMarginTop: 16 }} />
          <CarteTableau
            lignes={lignesAffichees}
            total={lignes.length}
            intituleCourbe={intituleColonneCourbe(period, allTime)}
            critere={critere} setCritere={setCritere}
            sens={sens} setSens={setSens}
            recherche={recherche} setRecherche={setRecherche}
            metrique={metrique}
            onSurvol={setSurvole}
            debut={data?.debut ?? null} fin={data?.fin ?? null}
          />
        </>
      )}
      </div>
    </div>
  );
}

/** Pourquoi un élève ne figure pas sur le graphe d'accompagnement. Quatre raisons, et
 *  elles ne se valent pas : deux se résorberont seules, deux demandent une action. */
type RaisonNonTrace = 'trop-recent' | 'sans-donnees' | 'sans-arrivee' | 'hors-plage';

const LIBELLES_NON_TRACE: Record<RaisonNonTrace, string> = {
  'trop-recent':  'trop récent',
  'sans-donnees': 'aucune donnée',
  'sans-arrivee': "sans date d'arrivée",
  'hors-plage':   'hors de la plage',
};

/** La note sous le graphe. Elle groupe par raison plutôt que d'annoncer un total :
 *  « 3 élèves ne sont pas tracés » n'apprend rien, alors que « 2 sans donnée, 1 trop
 *  récent » dit lequel se réglera tout seul. */
function phraseNonTraces(nonTraces: Map<string, RaisonNonTrace>): string {
  const parRaison = new Map<RaisonNonTrace, number>();
  for (const r of nonTraces.values()) parRaison.set(r, (parRaison.get(r) ?? 0) + 1);
  const morceaux = (Object.keys(LIBELLES_NON_TRACE) as RaisonNonTrace[])
    .filter(r => parRaison.has(r))
    .map(r => `${parRaison.get(r)} ${LIBELLES_NON_TRACE[r]}`);
  const total = nonTraces.size;
  return `${total} élève${total > 1 ? 's' : ''} non tracé${total > 1 ? 's' : ''} — ${morceaux.join(', ')}`;
}

/* ═══ Sous-composants ════════════════════════════════════════════════════════ */

function formaterEtiquette(iso: string, g: 'jour' | 'semaine' | 'mois', avecJour = false): string {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00Z');
  if (Number.isNaN(d.getTime())) return iso;
  if (g === 'mois') return d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit', timeZone: 'UTC' });
  if (avecJour) return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function Delta({ valeur, comparaison, unite }: { valeur: number | null; comparaison: string; unite: '' | '€' }) {
  if (valeur === null) return <div style={{ fontSize: 11, marginTop: 6, color: 'var(--faint)' }}>—</div>;
  const couleur = valeur > 0 ? 'var(--green)' : valeur < 0 ? 'var(--red)' : 'var(--muted)';
  return (
    <div style={{ fontSize: 11, marginTop: 6, fontWeight: 600, color: couleur, whiteSpace: 'nowrap' }}>
      {formaterVariation(valeur)}{unite === '€' ? ' €' : ''} {comparaison}
    </div>
  );
}

/* D45 : il ne s'affiche que quand il a quelque chose à dire, et il énonce la
 * CONSÉQUENCE (« faussent les totaux »), pas seulement l'état. Sans lui, un élève dont
 * le jeton est tombé reste compté avec des chiffres figés au jour de la panne, et rien
 * ne le signale — le gate `integrations_ready_at` ne protège que de la PREMIÈRE
 * connexion, jamais d'une déconnexion ultérieure.
 *
 * « Voir lesquels » filtre le tableau du bas : le mécanisme de la recherche, déclenché
 * par le lien. Aucune modale, aucune écriture — on n'agit jamais depuis cette page. */
/* Quatre lignes possibles, parce qu'il y a quatre ACTIONS différentes derrière — les
 * fondre en un seul avertissement obligerait le coach à deviner laquelle le concerne :
 *
 *   1. reconnecter un compte tombé   (ses chiffres sont figés et faussent les totaux)
 *   2. connecter Instagram ou YouTube (sinon l'élève n'apparaît nulle part)
 *   3. relancer une collecte muette   (le compte est branché, rien n'arrive)
 *   4. connecter le reste             (l'élève apparaît, des colonnes sont vides)
 *
 * ⚠️ Aucune de ces lignes n'annonce une PANNE. AGENTS.md prévient qu'une intégration
 * non connectée n'en est pas une, et que les traiter comme telles fait remonter
 * 23 faux positifs. Le bandeau dit ce qui MANQUERA À L'ÉCRAN — vérifiable en regardant
 * la colonne concernée. */
function BandeauIntegrations({ casses, sansAudience, muets, partiels, onVoir }: {
  casses: EleveSignale[];
  /** Aucun compte Instagram ni YouTube branché. Alerte DISTINCTE d'une intégration
   *  tombée : là, il n'y a jamais rien eu, donc rien n'est « figé ». */
  sansAudience: EleveSignale[];
  /** Source branchée, collecte muette. Encore une autre action. */
  muets: EleveSignale[];
  /** L'audience est là, d'autres sources manquent : colonnes vides. */
  partiels: (EleveSignale & { manquantes: SourcePage[] })[];
  onVoir: (nom: string) => void;
}) {
  /* ⚠️ Le bandeau NOMME les élèves. La première version disait « 1 élève est déclaré
   * prêt mais n'a jamais rien remonté » : du vocabulaire interne (« déclaré prêt » ne
   * veut rien dire pour un coach), aucun nom, et donc rien à faire de l'information.
   * Un avertissement qu'on ne peut pas relier à quelqu'un est un avertissement qu'on
   * apprend à ignorer. */
  /** Chaque élève nommé porte sa photo : on le reconnaît avant d'avoir lu son nom, et
   *  ça évite au coach de traduire un nom en visage pour savoir de qui on parle.
   *  Plafonné à trois pour qu'un portefeuille de quarante ne fasse pas un pavé. */
  const nommer = (l: EleveSignale[]) => {
    const montres = l.slice(0, 3);
    const reste = l.length - montres.length;
    return (
      <>
        {montres.map((x, i) => (
          <span key={x.profileId} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, verticalAlign: 'middle' }}>
            {i > 0 && <span style={{ marginRight: 2 }}>, </span>}
            <Avatar avatarUrl={x.photo ?? undefined} initials={getInitials(x.nom)} size={16} seed={x.nom} />
            <b>{x.nom}</b>
          </span>
        ))}
        {reste > 0 && <span>{' et '}{reste} autre{reste > 1 ? 's' : ''}</span>}
      </>
    );
  };

  const lignes: { cle: string; texte: React.ReactNode; premier: string }[] = [];
  /* Les phrases sont écrites EN ENTIER dans chaque nombre, plutôt qu'assemblées mot à
   * mot avec des ternaires. Une phrase française cousue de `{n > 1 ? 'sont' : 'est'}`
   * finit toujours par produire un accord bancal que personne ne relit. */
  if (casses.length > 0) {
    lignes.push({
      cle: 'casses', premier: casses[0].nom,
      texte: <>
        {nommer(casses)}{' : '}
        {casses.length > 1
          ? 'leurs comptes se sont déconnectés. Leurs chiffres n’ont plus bougé depuis, et sont comptés tels quels dans les totaux ci-dessous.'
          : 'son compte s’est déconnecté. Ses chiffres n’ont plus bougé depuis, et sont comptés tels quels dans les totaux ci-dessous.'}
      </>,
    });
  }
  if (sansAudience.length > 0) {
    lignes.push({
      cle: 'sans-audience', premier: sansAudience[0].nom,
      texte: <>
        {nommer(sansAudience)}{' : '}
        {sansAudience.length > 1
          ? 'aucun compte Instagram ni YouTube n’est connecté. Ils comptent déjà parmi les élèves actifs, mais cette page ne peut rien dire d’eux : ni abonnés, ni vues, ni publications.'
          : 'aucun compte Instagram ni YouTube n’est connecté. Il compte déjà parmi les élèves actifs, mais cette page ne peut rien dire de lui : ni abonnés, ni vues, ni publications.'}
      </>,
    });
  }
  if (muets.length > 0) {
    lignes.push({
      cle: 'muets', premier: muets[0].nom,
      texte: <>
        {nommer(muets)}{' : '}
        {muets.length > 1
          ? 'leurs comptes sont bien connectés, mais aucune donnée n’est jamais arrivée. Si la connexion date de plus d’une journée, la collecte est à relancer.'
          : 'son compte est bien connecté, mais aucune donnée n’est jamais arrivée. Si la connexion date de plus d’une journée, la collecte est à relancer.'}
      </>,
    });
  }
  if (partiels.length > 0) {
    /* On nomme chaque élève AVEC ce qui lui manque. « 3 élèves ont des intégrations
     * incomplètes » n'aide personne : il faut savoir qui, et quoi connecter. La liste
     * est plafonnée à trois pour ne pas transformer le bandeau en pavé à 40 élèves. */
    const montres = partiels.slice(0, 3);
    const reste = partiels.length - montres.length;
    lignes.push({
      cle: 'partiels', premier: partiels[0].nom,
      texte: <>
        {montres.map((x, i) => (
          <span key={x.profileId} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, verticalAlign: 'middle' }}>
            {i > 0 && <span style={{ margin: '0 3px' }}>·</span>}
            <Avatar avatarUrl={x.photo ?? undefined} initials={getInitials(x.nom)} size={16} seed={x.nom} />
            <b>{x.nom}</b>{' : il manque '}{enumerer(x.manquantes.map(m => m.libelle))}
          </span>
        ))}
        {reste > 0 && <span>{' · et '}{reste} autre{reste > 1 ? 's' : ''}</span>}
        {'. Leurs colonnes correspondantes resteront vides.'}
      </>,
    });
  }

  return (
    <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {lignes.map(l => (
        <div key={l.cle} style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 15px',
          borderRadius: 'var(--r-lg)', background: 'var(--amber-soft)',
          border: '1px solid var(--amber)', color: 'var(--amber)', fontSize: 12.5,
        }}>
          <span aria-hidden="true">⚠</span>
          <span>{l.texte}</span>
          <button onClick={() => onVoir(l.premier)} style={{
            marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: 'inherit',
            textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer',
            fontFamily: 'inherit', whiteSpace: 'nowrap',
          }}>
            Voir dans le tableau
          </button>
        </div>
      ))}
    </div>
  );
}

function BandeauAgrege({ a, precedent, comparaison }: { a: Agregats; precedent: Agregats | null; comparaison: string }) {
  const taux = tauxCollecte(a.cashCollecte, a.cashContracte);
  const d = (cle: keyof Agregats) => {
    if (!precedent) return null;
    const actuel = a[cle] as number | null;
    const avant = precedent[cle] as number | null;
    if (actuel === null || avant === null) return null;
    return actuel - avant;
  };
  return (
    <div className="kpis-stats-clients" style={{
      display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', background: 'var(--surface)',
      border: '1px solid var(--border)', borderRadius: 'var(--r-card)', overflow: 'hidden', marginBottom: 20,
    }}>
      {[
        // Le titre nomme ce que porte le grand chiffre : « Cash collecté », pas « Cash ».
        // Le contracté passe dessous, avec le taux — c'est le repère, pas le résultat.
        { l: 'Cash collecté', v: formaterValeur(a.cashCollecte, '€'),
          sec: <>Contracté <b style={{ color: 'var(--ink-2)' }}>{formaterValeur(a.cashContracte, '€')}</b>{taux !== null && <> · {taux} %</>}</>,
          delta: d('cashCollecte'), unite: '€' as const },
        { l: 'Abonnés', v: formaterVariation(a.abonnesGagnes),
          sec: <>IG <b style={{ color: 'var(--ink-2)' }}>{formaterVariation(a.abonnesGagnesIg)}</b> · YT <b style={{ color: 'var(--ink-2)' }}>{formaterVariation(a.abonnesGagnesYt)}</b></>,
          delta: d('abonnesGagnes'), unite: '' as const },
        { l: 'Leads', v: formaterValeur(a.leads, ''), sec: null, delta: d('leads'), unite: '' as const },
        { l: 'Calls bookés', v: formaterValeur(a.callsBookes, ''), sec: null, delta: d('callsBookes'), unite: '' as const },
        { l: 'Ventes', v: formaterValeur(a.ventes, ''), sec: null, delta: d('ventes'), unite: '' as const },
      ].map((c, i, t) => (
        <div key={c.l} style={{ padding: '16px 18px', borderRight: i < t.length - 1 ? '1px solid var(--border)' : undefined, minWidth: 0 }}>
          {/* Mêmes classes que les KPI de l'accueil (`.kpi-label` / `.kpi-value`), pour
              que les deux écrans se lisent comme le même produit. `tabular-nums` reste
              posé : sans lui, la largeur des chiffres bouge d'une période à l'autre et
              les cartes tressautent à chaque clic sur la flèche. */}
          <div className="kpi-label" style={{ marginBottom: 8, whiteSpace: 'nowrap' }}>{c.l}</div>
          <div className="kpi-value" style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{c.v}</div>
          {c.sec && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, whiteSpace: 'nowrap' }}>{c.sec}</div>}
          <Delta valeur={c.delta} comparaison={comparaison} unite={c.unite} />
        </div>
      ))}
    </div>
  );
}

function BandeVeille({ entrees, fil, page, setPage }: {
  entrees: { client: { id: string; name: string; avatar_url: string | null; initials: string | null }; signals: ClientSignals }[];
  fil: React.RefObject<HTMLDivElement | null>;
  page: number;
  setPage: (n: number) => void;
}) {
  if (entrees.length === 0) {
    return (
      <div className="card" style={{ padding: '14px 18px', marginBottom: 20 }}>
        <div style={{ fontSize: 13, color: 'var(--green)' }}>Aucun signal actif ✓</div>
      </div>
    );
  }
  const complet = entrees.length <= VEILLE_PAR_VUE;
  const pages = Math.max(1, entrees.length - (VEILLE_PAR_VUE - 1));

  // L'index se déduit du défilement RÉEL, jamais d'un état qu'on tiendrait à jour à la
  // main : le doigt peut s'arrêter n'importe où, c'est l'accroche CSS qui tranche.
  function surDefilement() {
    const el = fil.current;
    const premier = el?.firstElementChild as HTMLElement | null;
    if (!el || !premier) return;
    setPage(Math.round(el.scrollLeft / (premier.offsetWidth + VEILLE_GAP)));
  }
  function allerA(i: number) {
    const el = fil.current;
    const premier = el?.firstElementChild as HTMLElement | null;
    if (!el || !premier) return;
    const reduit = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ left: i * (premier.offsetWidth + VEILLE_GAP), behavior: reduit ? 'auto' : 'smooth' });
  }

  return (
    <div style={{ marginBottom: 20 }}>
      {/* Enveloppe qui ancre les zones cliquables des deux bords (desktop). */}
      <div className="fil-avec-zones">
      {!complet && <ZonesDefilement cible={fil} gap={VEILLE_GAP}
        libelleAvant="Clients suivants" libelleArriere="Clients precedents" />}
      <div ref={fil} onScroll={surDefilement} className={`veille-fil${complet ? ' veille-fil-complet' : ''}`}>
        {entrees.map(({ client, signals }) => (
          <div className="veille-slide" key={client.id}>
            <Link href={`/clients/${client.id}`} className="card" style={{
              display: 'flex', gap: 11, padding: '13px 15px', textDecoration: 'none',
              alignItems: 'flex-start', height: '100%',
            }}>
              <Avatar initials={client.initials || getInitials(client.name)} avatarUrl={client.avatar_url} size={30} seed={client.id} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 650, color: 'var(--ink)' }}>{client.name}</div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 3, lineHeight: 1.4 }}>
                  {phraseSignaux(signals)}
                </div>
              </div>
            </Link>
          </div>
        ))}
      </div>
      </div>
      {!complet && (
        <div className="veille-points" role="tablist" aria-label="Position dans la liste">
          {Array.from({ length: pages }, (_, i) => (
            <button key={i} className="veille-point" role="tab" aria-selected={i === page}
              aria-label={`Position ${i + 1}`} onClick={() => allerA(i)} />
          ))}
        </div>
      )}
    </div>
  );
}

function CarteGraphe({ titre, sousTitre, metrique, setMetrique, children }: {
  titre: string; sousTitre: string;
  metrique: Metrique; setMetrique: (m: Metrique) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="card" style={{ padding: 18, marginBottom: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
        {/* Même règle que le graphe d'accompagnement, et pour la même raison : un
            sous-titre un peu long ferait passer le sélecteur à la ligne, donc à gauche.
            Ici le sous-titre est CALCULÉ, donc sa longueur change toute seule. */}
        <div style={{ flex: '1 1 300px', minWidth: 0 }}>
          {/* Titre CALCULÉ depuis la métrique : un titre écrit en dur au-dessus d'un
              sélecteur devient faux au premier changement. */}
          <div className="card-title">{titre}</div>
          <div className="card-sub">{sousTitre}</div>
        </div>
        <select className="stats-select" style={{ flexShrink: 0, marginLeft: 'auto' }}
          value={metrique} onChange={e => setMetrique(e.target.value as Metrique)}>
          {(Object.keys(METRIQUES) as Metrique[])
            .map(m => <option key={m} value={m}>{METRIQUES[m].titre}</option>)}
        </select>
      </div>
      {children}
    </div>
  );
}

/* ⚠️ Une pastille d'élève NON TRACÉ ne doit pas ressembler aux autres. Avant le
 * 2026-09-03 elle était identique et cliquable : le clic mettait en avant une courbe
 * qui n'existe pas, donc il ne se passait rien. Même famille de défaut que le bouton
 * « Voir » qui ne menait nulle part — un contrôle qui a l'air actif et ne fait rien
 * apprend au coach à se méfier de l'écran entier. */
function Legende({ lignes, epingle, setEpingle, nonTraces, depuisSemaine }: {
  lignes: LigneEleve[]; epingle: string | null; setEpingle: (n: string | null) => void;
  /** Absent pour le graphe principal, qui n'écarte personne. */
  nonTraces?: Map<string, RaisonNonTrace>;
  /** Première semaine mesurée, quand elle n'est pas S1. Absente pour le graphe
   *  principal, dont l'axe est en dates et non en semaines de programme. */
  depuisSemaine?: Map<string, number>;
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 12 }}>
      {lignes.map(l => {
        const actif = epingle === l.id;
        const raison = nonTraces?.get(l.id);
        if (raison) {
          return (
            <span key={l.id} title={LIBELLES_NON_TRACE[raison]}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5,
                border: '1px dashed var(--border)', borderRadius: 999,
                padding: '2px 8px', fontFamily: 'inherit',
                background: 'transparent', color: 'var(--faint)',
              }}>
              <span style={{ opacity: .45, display: 'inline-flex', flexShrink: 0 }}>
                <Avatar avatarUrl={l.photo ?? undefined} initials={getInitials(l.nom)} size={14} seed={l.nom} />
              </span>
              {l.nom.split(' ')[0]}
              <span style={{ fontSize: 9.5 }}>· {LIBELLES_NON_TRACE[raison]}</span>
            </span>
          );
        }
        return (
          <button key={l.id} onClick={() => setEpingle(actif ? null : l.id)} aria-pressed={actif}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5,
              border: `1px solid ${actif ? 'var(--ink)' : 'var(--border)'}`, borderRadius: 999,
              padding: '2px 8px', cursor: 'pointer', fontFamily: 'inherit',
              background: actif ? 'var(--ink)' : 'var(--surface-2)',
              color: actif ? '#fff' : 'var(--muted)',
            }}>
            {/* On reconnaît quelqu'un à son visage avant de lire son prénom. La
                pastille de couleur reste le repli, et c'est la MÊME couleur que sa
                courbe — `colorFromSeed(seedForPerson(nom))` partout. */}
            <Avatar avatarUrl={l.photo ?? undefined} initials={getInitials(l.nom)} size={14} seed={l.nom} />
            {l.nom.split(' ')[0]}
            {/* Uniquement quand la courbe ne part PAS de S1. La mention n'apparaît donc
                que là où elle explique quelque chose — ailleurs elle ne ferait que du
                bruit sur quarante pastilles. */}
            {depuisSemaine?.get(l.id) && (
              <span style={{ fontSize: 9.5, opacity: .8 }}>· depuis S{depuisSemaine.get(l.id)}</span>
            )}
          </button>
        );
      })}
      {epingle && (
        <button onClick={() => setEpingle(null)} style={{
          fontSize: 10.5, border: '1px solid var(--border)', borderRadius: 999, padding: '2px 8px',
          cursor: 'pointer', fontFamily: 'inherit', background: 'var(--surface-2)', color: 'var(--muted)',
        }}>Tout afficher</button>
      )}
    </div>
  );
}

/* ═══ L'aide du graphe d'accompagnement ══════════════════════════════════════
 *
 * Ce graphe a posé quatre questions à Chris en deux jours : pourquoi une courbe commence
 * au milieu, pourquoi un élève manque à une semaine donnée, pourquoi « hors période », et
 * à quoi sert l'axe. Les réponses tenaient dans le sous-titre, qui gonflait à chaque
 * fois — jusqu'à faire passer les contrôles à la ligne (cf. l'incident du 2026-09-03).
 *
 * ⚠️ Un sous-titre qui explique tout n'est plus un sous-titre. Le sous-titre dit ce que
 * l'axe EST ; l'aide dit comment le lire, et ne s'ouvre que si on la demande. */
const AIDE_ACCOMPAGNEMENT = (
  <>
    <p><b>À quoi il sert.</b> Comparer les élèves au même <i>stade</i> de leur
      accompagnement, et non à la même date. Un élève arrivé en juin et un autre arrivé en
      août se superposent : on voit qui progresse le plus vite à nombre de semaines égal.</p>

    <p><b>L'axe n'est pas un calendrier.</b> S1 est la première semaine <i>de chaque
      élève</i>, pas une date. Chaque courbe est donc décalée sur sa propre arrivée. C'est
      aussi pourquoi ce graphe ignore la période choisie en haut de la page : il remonte
      toujours jusqu'à l'arrivée.</p>

    <p><b>Ce que trace la courbe.</b> Pour un volume — publications, vues, clics — chaque
      point additionne tout ce qui précède depuis l'arrivée : la courbe ne peut donc que
      monter ou rester plate. Pour les abonnés, elle montre l'écart en pourcentage par
      rapport au premier jour mesuré, ce qui rend comparables un élève parti de 300
      abonnés et un autre parti de 30 000.</p>

    <p><b>Ce qui compte comme une publication.</b> Un post ou un reel Instagram, une vidéo
      YouTube, une story. C'est la même définition que le KPI « Publications » de la page
      Mes&nbsp;Stats de l'élève, pour que le même mot donne le même nombre des deux
      côtés. <i>Réserve</i> : une story expire en 24&nbsp;h et ne se rattrape pas, donc les
      semaines antérieures au démarrage de sa collecte n'en comptent aucune.</p>

    <p><b>Si une courbe démarre après S1</b>, c'est que la collecte a commencé plus tard
      que l'arrivée. Un élève arrivé en juillet dont le compte n'a été branché qu'en août
      n'a rien à tracer avant. Sa pastille de légende le dit — « depuis S5 ».</p>

    <p><b>Si un élève manque à une semaine donnée</b>, c'est qu'il n'y est pas encore
      arrivé. En S9 on ne voit que ceux qui ont neuf semaines d'accompagnement derrière
      eux ; les autres apparaîtront quand ils y seront.</p>

    <p><b>Un trait coupé</b> signale un jour sans mesure. Le pointillé qui l'enjambe dit
      la seule chose vraie : on sait où on était avant, où on est après, pas ce qui s'est
      passé entre les deux.</p>
  </>
);

/** Le « ? » posé à côté d'un titre. Ouvre une explication au clic, se ferme à la touche
 *  Échap ou au clic à côté.
 *
 *  ⚠️ Au CLIC et non au survol : le contenu fait plusieurs paragraphes, donc il faut
 *  pouvoir le lire sans garder la souris immobile — et un survol n'existe pas au clavier.
 *  L'attribut `title` du navigateur ne convenait pas non plus : il tronque, il ne met
 *  rien en forme, et il disparaît au bout de quelques secondes. */
function AideTitre({ titre, children }: { titre: string; children: React.ReactNode }) {
  const [ouvert, setOuvert] = useState(false);
  const boite = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!ouvert) return;
    const surTouche = (e: KeyboardEvent) => { if (e.key === 'Escape') setOuvert(false); };
    const surClic = (e: MouseEvent) => {
      if (boite.current && !boite.current.contains(e.target as Node)) setOuvert(false);
    };
    document.addEventListener('keydown', surTouche);
    document.addEventListener('mousedown', surClic);
    return () => {
      document.removeEventListener('keydown', surTouche);
      document.removeEventListener('mousedown', surClic);
    };
  }, [ouvert]);

  return (
    <span ref={boite} style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setOuvert(o => !o)}
        aria-expanded={ouvert}
        aria-label={ouvert ? "Fermer l'aide" : titre}
        style={{
          width: 16, height: 16, borderRadius: '50%', cursor: 'pointer',
          border: `1px solid ${ouvert ? 'var(--ink)' : 'var(--border)'}`,
          background: ouvert ? 'var(--ink)' : 'transparent',
          color: ouvert ? 'var(--surface)' : 'var(--muted)',
          fontSize: 10.5, fontWeight: 700, lineHeight: 1, fontFamily: 'inherit',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          padding: 0, transition: 'all .15s',
        }}
      >?</button>

      {ouvert && (
        <span
          role="dialog"
          aria-label={titre}
          style={{
            position: 'absolute', top: 24, left: 0, zIndex: 20,
            width: 'min(420px, calc(100vw - 48px))',
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 'var(--r-lg)', boxShadow: 'var(--shadow-menu)',
            padding: '14px 16px', textAlign: 'left',
            fontSize: 12.5, fontWeight: 400, lineHeight: 1.6, color: 'var(--muted)',
            display: 'block', whiteSpace: 'normal',
          }}
        >
          <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: 'var(--ink)', marginBottom: 8 }}>
            {titre}
          </span>
          <span className="aide-corps" style={{ display: 'block' }}>{children}</span>
        </span>
      )}
    </span>
  );
}

const LIBELLE_ETAT: Record<EtatEleve, string> = {
  installation: 'Installation en cours',
  connexion_cassee: 'Connexion cassée',
  trop_recent: 'Trop récent pour comparer',
};

function CarteTableau({ lignes, total, intituleCourbe, critere, setCritere, sens, setSens, recherche, setRecherche, metrique, onSurvol, debut, fin }: {
  lignes: LigneEleve[]; total: number; intituleCourbe: string;
  critere: CritereTri; setCritere: (c: CritereTri) => void;
  sens: 'asc' | 'desc'; setSens: (s: 'asc' | 'desc') => void;
  recherche: string; setRecherche: (r: string) => void;
  metrique: Metrique;
  onSurvol: (id: string | null) => void;
  /** Bornes de la période affichée. Elles ne servent QU'au nom du fichier exporté :
   *  deux exports téléchargés le même jour sur deux périodes différentes ne doivent pas
   *  se confondre dans le dossier Téléchargements. */
  debut: Date | null; fin: Date | null;
}) {
  /* D48 : l'export reprend `lignes`, c'est-à-dire le tableau DÉJÀ trié et filtré.
   * Exporter les données brutes donnerait un fichier qui ne correspond pas à ce qu'on a
   * sous les yeux, ce qui est pire que pas d'export du tout.
   *
   * ⚠️ Ce n'est pas une entorse à « on n'agit jamais depuis cette page » : rien n'est
   * écrit, ni en base ni ailleurs. On emporte ce qu'on voit. */
  function exporter() {
    const blob = new Blob([versCsv(lignes)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = debut && fin ? nomFichierCsv(debut, fin) : 'momentum-eleves.csv';
    document.body.appendChild(a);
    a.click();
    // Sans ces deux lignes, l'ancre reste dans le document et l'URL objet garde le blob
    // en mémoire jusqu'au rechargement de la page.
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="card" style={{ overflow: 'hidden', padding: 0 }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ flex: '0 1 auto', minWidth: 0 }}>
          <div className="card-title">Tous les élèves</div>
          <div className="card-sub">
            {lignes.length} {recherche ? `résultat${lignes.length !== 1 ? 's' : ''} sur ${total}` : `ligne${lignes.length !== 1 ? 's' : ''}`}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', flexShrink: 0, marginLeft: 'auto' }}>
          <input className="stats-search" type="search" value={recherche} onChange={e => setRecherche(e.target.value)}
            placeholder="Chercher un élève ou une niche" aria-label="Chercher un élève" />
          <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>Trier par</span>
          <select className="stats-select" value={critere} onChange={e => setCritere(e.target.value as CritereTri)}>
            {(Object.keys(LIBELLES_TRI) as CritereTri[]).map(c => (
              <option key={c} value={c}>{LIBELLES_TRI[c]}</option>
            ))}
          </select>
          <button className="btn-ghost" style={{ fontSize: 12, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}
            onClick={() => setSens(sens === 'desc' ? 'asc' : 'desc')}>
            {sens === 'desc' ? '↓ décroissant' : '↑ croissant'}
          </button>
          <button className="btn-ghost" style={{ fontSize: 12, whiteSpace: 'nowrap' }}
            onClick={exporter} disabled={lignes.length === 0}
            title={lignes.length === 0 ? 'Rien à exporter' : `Exporter ${lignes.length} ligne${lignes.length !== 1 ? 's' : ''} au format CSV`}>
            Exporter en CSV
          </button>
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="data-table tableau-portefeuille" style={{ minWidth: 980 }}>
          <thead>
            <tr>
              <th>Élève</th><th>Sem.</th>
              <th style={{ textAlign: 'right' }}>Abonnés IG</th>
              <th style={{ textAlign: 'right' }}>Abonnés YT</th>
              <th>{intituleCourbe}</th>
              <th style={{ textAlign: 'right' }}>Δ</th>
              <th style={{ textAlign: 'right' }}>Publications</th>
              <th style={{ textAlign: 'right' }}>Leads</th>
              <th style={{ textAlign: 'right' }}>Calls bookés</th>
              <th style={{ textAlign: 'right' }}>Cash</th>
            </tr>
          </thead>
          <tbody>
            {lignes.length === 0 && (
              <tr><td colSpan={10} style={{ textAlign: 'center', padding: '18px 12px', color: 'var(--muted)', fontSize: 12.5 }}>
                Aucun élève ne correspond à « {recherche} »
              </td></tr>
            )}
            {lignes.map(l => (
              <LigneTableau key={l.id} l={l} metrique={metrique} onSurvol={onSurvol} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LigneTableau({ l, metrique, onSurvol }: { l: LigneEleve; metrique: Metrique; onSurvol: (id: string | null) => void }) {
  const couleur = colorFromSeed(seedForPerson(l.nom));
  const taux = tauxCollecte(l.cashCollecte, l.cashContracte);
  const identite = (
    <td>
      <Link href={`/clients/${l.id}`} style={{ display: 'flex', alignItems: 'center', gap: 9, textDecoration: 'none' }}>
        <Avatar avatarUrl={l.photo ?? undefined} initials={getInitials(l.nom)} size={30} seed={l.id} />
        <div>
          <div style={{ fontWeight: 600, fontSize: 12.5, color: 'var(--ink)', whiteSpace: 'nowrap' }}>{l.nom}</div>
          <div style={{ fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{l.niche || 'Infopreneur'}</div>
        </div>
      </Link>
    </td>
  );

  // Un élève sans données ne montre pas des zéros : il montre son état. Un 0 affirmerait
  // qu'il ne s'est rien passé, alors qu'on ne sait pas encore.
  if (l.etat) {
    return (
      <tr onMouseEnter={() => onSurvol(null)}>
        {identite}
        <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>{l.semaine ? `S${l.semaine}` : '—'}</td>
        <td colSpan={8} style={{ paddingLeft: 12 }}>
          <span className={l.etat === 'installation' ? 'pill' : 'pill'} style={{
            fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 999,
            background: l.etat === 'installation' ? 'var(--accent-brand-soft)' : 'var(--surface-2)',
            color: l.etat === 'installation' ? 'var(--accent-brand)' : 'var(--faint)',
          }}>{LIBELLE_ETAT[l.etat]}</span>
        </td>
      </tr>
    );
  }

  const variation = metrique === 'abonnesYt' ? l.variationYt : l.variationIg;
  return (
    <tr
      onMouseEnter={() => onSurvol(l.id)}
      onMouseLeave={() => onSurvol(null)}
      title={`Ouvre la fiche de ${l.nom}`}
    >
      {identite}
      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>{l.semaine ? `S${l.semaine}` : '—'}</td>
      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{formaterValeur(l.abonnesIg, '')}</td>
      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--ink-2)', fontVariantNumeric: 'tabular-nums' }}>{formaterValeur(l.abonnesYt, '')}</td>
      <td><Sparkline valeurs={l.serie} couleur={couleur} /></td>
      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, fontVariantNumeric: 'tabular-nums',
        color: variation === null ? 'var(--muted)' : variation > 0 ? 'var(--green)' : variation < 0 ? 'var(--red)' : 'var(--muted)' }}>
        {formaterVariation(variation)}
      </td>
      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--ink-2)' }}>{formaterValeur(l.publications, '')}</td>
      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--ink-2)' }}>{formaterValeur(l.leads, '')}</td>
      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--ink-2)' }}>{formaterValeur(l.callsBookes, '')}</td>
      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, color: l.cashCollecte > 0 ? 'var(--green)' : 'var(--muted)' }}>
        {l.cashCollecte > 0 ? formaterValeur(l.cashCollecte, '€') : '—'}
        {taux !== null && <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 500 }}>{taux} % de {formaterValeur(l.cashContracte, '€')}</div>}
      </td>
    </tr>
  );
}

function Sparkline({ valeurs, couleur }: { valeurs: (number | null)[]; couleur: string }) {
  const connues = valeurs.filter((v): v is number => v !== null);
  if (connues.length < 2) return <span style={{ color: 'var(--faint)', fontFamily: 'var(--font-mono)' }}>—</span>;
  const l = 96, h = 24;
  const mn = Math.min(...connues), mx = Math.max(...connues), amp = mx - mn || 1;
  const x = (i: number) => (i / Math.max(1, valeurs.length - 1)) * (l - 2) + 1;
  const y = (v: number) => h - 2 - ((v - mn) / amp) * (h - 6);
  let d = '';
  let enCours = false;
  valeurs.forEach((v, i) => {
    if (v === null) { enCours = false; return; }
    d += `${enCours ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
    enCours = true;
  });
  const dernierIndex = valeurs.map((v, i) => (v === null ? -1 : i)).filter(i => i >= 0).pop() ?? 0;
  return (
    <svg width={l} height={h} viewBox={`0 0 ${l} ${h}`} aria-hidden="true">
      <path d={d.trim()} fill="none" stroke={couleur} strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx={x(dernierIndex)} cy={y(valeurs[dernierIndex] as number)} r="2" fill={couleur} />
    </svg>
  );
}

function EcranVide({ lignes }: { lignes: LigneEleve[] }) {
  return (
    <div className="card" style={{ padding: '46px 20px', textAlign: 'center' }}>
      <div style={{ fontSize: 16, fontWeight: 650, marginBottom: 8 }}>Aucun élève n'a encore de données</div>
      <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 auto', maxWidth: '52ch', lineHeight: 1.5 }}>
        Les chiffres apparaîtront dès qu'un élève aura connecté ses 7 intégrations.
        {lignes.length > 0 && ` ${lignes.length} ${lignes.length > 1 ? 'sont' : 'est'} en cours d'installation :`}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9, maxWidth: 340, margin: '22px auto 0', textAlign: 'left' }}>
        {lignes.map(l => (
          <Link key={l.id} href={`/clients/${l.id}`} style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
            <Avatar avatarUrl={l.photo ?? undefined} initials={getInitials(l.nom)} size={30} seed={l.id} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 12.5, color: 'var(--ink)' }}>{l.nom}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{l.etat ? LIBELLE_ETAT[l.etat] : ''}</div>
            </div>
            <Icon name="chevR" size={12} />
          </Link>
        ))}
      </div>
    </div>
  );
}

/** Squelette plutôt qu'un loader centré : la page montre sa structure, donc elle paraît
 *  déjà là, et le contenu remplace des formes de mêmes dimensions au lieu de surgir dans
 *  le vide. Même motif que PageClients. */
function SquelettePage() {
  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <Skeleton width={150} height={22} />
          <Skeleton width={220} height={12} style={{ marginTop: 8 }} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-card)', overflow: 'hidden', marginBottom: 20 }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} style={{ padding: '16px 18px', borderRight: i < 4 ? '1px solid var(--border)' : undefined }}>
            <Skeleton width="62%" height={9} />
            <Skeleton width="75%" height={22} style={{ marginTop: 11 }} />
            <Skeleton width="88%" height={9} style={{ marginTop: 9 }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 11, marginBottom: 20 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card" style={{ flex: 1, padding: '13px 15px', display: 'flex', gap: 11 }}>
            <Skeleton width={30} height={30} radius={15} />
            <div style={{ flex: 1 }}>
              <Skeleton width="70%" height={10} />
              <Skeleton width="95%" height={9} style={{ marginTop: 7 }} />
            </div>
          </div>
        ))}
      </div>
      <div className="card" style={{ padding: 18, marginBottom: 20 }}>
        <Skeleton width={220} height={13} />
        <Skeleton width={320} height={9} style={{ marginTop: 8 }} />
        <Skeleton height={248} style={{ marginTop: 16 }} />
      </div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <Skeleton width={160} height={13} />
          <Skeleton width={240} height={9} style={{ marginTop: 8 }} />
        </div>
        <div style={{ padding: '0 12px' }}>
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border-soft)' }}>
              <Skeleton width={30} height={30} radius={15} />
              <Skeleton width={130} height={10} />
              <div style={{ flex: 1 }} />
              <Skeleton width={62} height={10} />
              <Skeleton width={96} height={22} />
              <Skeleton width={52} height={10} />
              <Skeleton width={72} height={10} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
