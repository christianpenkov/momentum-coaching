'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useEscapeKey } from '@/lib/useEscapeKey';
import PipelineFunnelMobile from './PipelineFunnelMobile';
import PipelineListView from './PipelineListView';
import Icon from '@/components/ui/Icon';
import { mutate } from '@/lib/mutate';
import Image from 'next/image';
import { useQuery } from '@tanstack/react-query';
import InlineLoader from '@/components/ui/InlineLoader';
import RapportModal from '@/components/ui/RapportModalLoader';
import ProspectDetailModal from './ProspectDetailModal';
import { isYtVideoId } from '@/lib/ytId';
import { resolveLeadState, ISSUE_KEYS, ISSUE_TO_OUTCOME, type StageKey, type IssueKey } from '@/lib/pipelineStage';
import { useViewerTimeZone } from '@/lib/UserContext';
import { wallClockToUtc, cityLabelOf } from '@/lib/timezone';

// ── Types ─────────────────────────────────────────────────────────────────────

interface IgLead {
  id: string;
  ig_username: string;
  ig_user_id: string;
  keyword_matched: string;
  lead_magnet_sent: boolean;
  hook_replied: boolean;
  hook_replied_at: string | null;
  tracking_link: string | null;
  detected_at: string;
  media_id: string | null;
  source: string | null;
  avatar_url: string | null;
}

interface ProspectLink {
  id: string;
  ig_username: string;
  short_url: string;
  content_id: string | null;
  created_at: string;
  humanClicks30d?: number;
  calendly_link_sent: boolean;
  calendly_link_sent_at: string | null;       // premier envoi (figé — guard linkClickedValid)
  last_calendly_link_sent_at: string | null;  // dernier envoi (mis à jour à chaque renvoi)
  first_click_at: string | null;
  min_stage_reached: string | null;  // plancher IG_STAGES — jamais reculer en dessous, même si un signal auto plus faible se re-déclenche
}

interface Call {
  id: string;
  invitee_name: string;
  invitee_email: string;
  scheduled_at: string;
  booked_at: string | null; // moment réel de la réservation, distinct de scheduled_at (heure du call)
  status: string;
  no_show: boolean | null;
  no_show_at: string | null;
  deal_closed: boolean | null;
  outcome: string | null;
  revenue: number | null;
  source: string | null;
  ig_lead_id: string | null;
  prospect_id: string | null;
  utm_content: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  short_link_path: string | null;
  created_at: string;
  rescheduled: boolean | null;
  rescheduled_at: string | null;
  /** UUID Calendly de CE call — cible du next_rescheduled_uri du call précédent. */
  calendly_event_uuid: string | null;
  /**
   * Renseigné quand ce call a été reprogrammé : contient l'URL de l'invitee du
   * NOUVEAU call. Sert à chaîner les reprogrammations d'un même prospect pour
   * n'afficher qu'une carte.
   */
  next_rescheduled_uri: string | null;
  /** Moment réel de l'annulation (Calendly), distinct de l'heure du rendez-vous. */
  canceled_at: string | null;
  /** Qui a annulé — le prospect ou l'hôte. */
  canceled_by: string | null;
  cancellation_reason: string | null;
  lead_deleted: boolean;
  is_follow_up: boolean | null;
  // Commentaire libre saisi dans le rapport de vente — sert à pré-remplir la modale
  // quand on rouvre le rapport pour le corriger.
  lead_rapport_comment: string | null;
}

interface NonIgProspect {
  id: string;
  platform: 'yt' | 'other';
  email: string | null;
  name: string | null;
  source: string | null;
  created_at: string;
}

interface Override {
  prospect_key: string;
  platform: 'ig' | 'yt' | 'other';
  stage: string;
  updated_at: string;
  reason?: string | null;
  natural_at_override?: string | null; // stage naturel au moment du recul
}

interface ProspectEvent {
  id: string;
  prospect_key: string;
  platform: string;
  event_type: string;
  occurred_at: string;
  ig_lead_id: string | null;
  prospect_link_id: string | null;
  call_id: string | null;
}

interface LmHistoryEntry {
  id: string;
  ig_username: string;
  ig_user_id: string;
  keyword_matched: string | null;
  media_id: string | null;
  detected_at: string;
}

export interface IgPostMeta {
  caption: string | null;
  permalink: string | null;
  thumbnail: string | null;
}

interface StorySequenceRef { sequenceId: string; sequenceName: string; }

interface PipelineData {
  leads: IgLead[];
  prospects: ProspectLink[];
  nonIgProspects: NonIgProspect[];
  calls: Call[];
  overrides: Override[];
  events: ProspectEvent[];
  lmHistory: LmHistoryEntry[];
  ytVideoTitles: Record<string, string>; // video_id → titre, résolu côté API (cache DB + oEmbed)
  igPostMeta: Record<string, IgPostMeta>; // media_id → légende/permalink/thumbnail, résolu côté API (cache DB + Graph API)
  storySequenceByMediaId: Record<string, StorySequenceRef>; // ig_story_id → séquence — distingue un media_id "story" (éphémère, sans permalink exploitable) d'un vrai post
}

export type { IgLead, ProspectLink, Call, ProspectEvent, LmHistoryEntry, PipelineData, StorySequenceRef };

// ── Colonnes ──────────────────────────────────────────────────────────────────
// Les couleurs ci-dessous (IG_STAGES, YT_STAGES, et #2563EB en particulier pour le
// stage "call_booked") forment une palette de statuts kanban délibérément distincte
// de --accent-brand (jour 7 design structurel, 2026-07-28) — laissées en dur pour
// préserver la cohérence visuelle de la palette (cyan/violet/orange/bleu/vert), pas
// une dérive de la couleur de marque à corriger.

// ⚠️ DEUX AXES, JAMAIS UN SEUL. Un lead porte une ÉTAPE (où il en est) ET une
// ISSUE (ce qui a été décidé). Les mélanger produisait « 3 show up » affiché
// au-dessus de « 4 closés » — impossible dans un entonnoir, et c'est ce qui a
// déclenché la refonte du 2026-08-27. `showed_up` et `closed` étaient des
// étapes ; ce sont des résultats. Voir lib/pipelineStage.ts pour le modèle.

const IG_STAGES = [
  { key: 'lm_sent',       label: 'Commentaire LM',      color: '#7C3AED', lightBg: '#F5F3FF', dot: '#7C3AED' },
  { key: 'lm_received',   label: 'Lead magnet reçu',    color: '#A855F7', lightBg: '#FAF5FF', dot: '#A855F7' },
  { key: 'cold_dm',       label: 'Cold DM',             color: '#0891B2', lightBg: '#ECFEFF', dot: '#0891B2' },
  { key: 'in_convo',      label: 'En conversation',     color: '#9333EA', lightBg: '#FDF4FF', dot: '#9333EA' },
  { key: 'calendly_sent', label: 'Calendly envoyé',     color: '#D97706', lightBg: '#FFFBEB', dot: '#D97706' },
  { key: 'link_clicked',  label: 'Lien cliqué',         color: '#EA580C', lightBg: '#FFF7ED', dot: '#EA580C' },
  { key: 'call_booked',   label: 'RDV pris',            color: '#2563EB', lightBg: '#EFF6FF', dot: '#2563EB' },
] as const;

// YouTube n'a qu'une étape : un lead YouTube arrive directement par un lien
// Calendly en description, sans DM ni lead magnet. Tout le reste de son parcours
// se joue dans les issues.
const YT_STAGES = [
  { key: 'call_booked', label: 'RDV pris', color: '#2563EB', lightBg: '#EFF6FF', dot: '#2563EB' },
] as const;

// Les issues ne sont PAS ordonnées : aucune n'est « après » une autre. Elles ne
// portent donc pas d'index de progression, contrairement aux étapes.
const ISSUES = [
  { key: 'to_recontact',  label: 'À recontacter', color: '#C2410C', lightBg: '#FFF7ED', dot: '#C2410C' },
  { key: 'no_show',       label: 'No show',       color: '#DC2626', lightBg: '#FEF2F2', dot: '#DC2626' },
  { key: 'not_qualified', label: 'Pas qualifié',  color: '#6B7280', lightBg: '#F9FAFB', dot: '#6B7280' },
  { key: 'lost',          label: 'Perdu',         color: '#7A7361', lightBg: '#F7F4EC', dot: '#7A7361' },
  { key: 'closed',        label: 'Closé',         color: '#047857', lightBg: '#D1FAE5', dot: '#047857' },
] as const;

type IgStageKey = typeof IG_STAGES[number]['key'];
type YtStageKey = typeof YT_STAGES[number]['key'];

/** Une colonne du kanban : une étape ou une issue. Même forme, deux natures. */
type ColumnDef = { key: string; label: string; color: string; lightBg: string; dot: string };

const ISSUE_LABELS: Record<string, string> = Object.fromEntries(ISSUES.map(i => [i.key, i.label]));

// Ensembles pour la règle pré-call / post-call. `showed_up` et `closed` n'en
// font plus partie : ce ne sont plus des étapes.
const POST_CALL_STAGES = new Set(['call_booked']);
const PRE_CALL_STAGES  = new Set(['lm_sent', 'lm_received', 'cold_dm', 'in_convo', 'calendly_sent', 'link_clicked']);

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400000);
  if (d < 0) {
    const future = Math.abs(d);
    if (future === 1) return 'Demain';
    if (future < 7) return `Dans ${future}j`;
    if (future < 30) return `Dans ${Math.floor(future / 7)}sem`;
    return `Dans ${Math.floor(future / 30)}mois`;
  }
  if (d === 0) return "Aujourd'hui";
  if (d === 1) return 'Hier';
  if (d < 7) return `${d}j`;
  if (d < 30) return `${Math.floor(d / 7)}sem`;
  return `${Math.floor(d / 30)}mois`;
}

/** La plus récente de plusieurs dates, en ignorant les vides et les invalides. */
function latestOf(...dates: (string | null | undefined)[]): string | null {
  let best: number | null = null;
  let bestIso: string | null = null;
  for (const d of dates) {
    if (!d) continue;
    const t = new Date(d).getTime();
    if (Number.isNaN(t)) continue;
    if (best === null || t > best) { best = t; bestIso = d; }
  }
  return bestIso;
}

/**
 * Ce qu'on attend du lead, en clair. Une seule chose à la fois : la plus
 * urgente. Rendre `null` est un cas normal — un lead closé n'attend rien.
 */
function computeNextDue(
  state: { stage: string; issue: string | null; flags: { rapportEnRetard: boolean; relanceDue: boolean; relancesFaites: number } },
  callScheduledAt: string | null,
  lastMoveAt: string | null,
  now: Date,
): { label: string; at: string | null; urgent: boolean } | null {
  if (state.flags.rapportEnRetard) {
    return { label: 'rapport à remplir', at: callScheduledAt, urgent: true };
  }
  if (state.issue === 'to_recontact') {
    const n = state.flags.relancesFaites;
    const reste = Math.max(0, 3 - n);
    if (state.flags.relanceDue) {
      return { label: reste === 1 ? 'dernière relance' : 'à relancer', at: null, urgent: true };
    }
    return { label: `relancé ${n}/3`, at: null, urgent: false };
  }
  if (state.issue) return null;              // classé : plus rien à attendre
  if (callScheduledAt && new Date(callScheduledAt).getTime() > now.getTime()) {
    return { label: 'RDV', at: callScheduledAt, urgent: false };
  }
  // Actif sans rendez-vous : ce qui compte, c'est depuis quand ça dort.
  if (lastMoveAt) {
    const jours = Math.floor((now.getTime() - new Date(lastMoveAt).getTime()) / 86400000);
    if (jours >= 21) return { label: `sans mouvement ${jours} j`, at: null, urgent: true };
  }
  return null;
}

const AVATAR_COLORS = ['#7C3AED','#2563EB','#059669','#D97706','#EA580C','#DB2777','#0891B2','#65A30D'];
export function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

export function avatarInitials(name: string): string {
  return name.replace(/^@/, '').split(/[\s._-]/).map(w => w[0] || '').join('').toUpperCase().slice(0, 2) || '??';
}

// ── resolveYtSource ───────────────────────────────────────────────────────────
// Résout le titre de la vidéo YouTube (via ytVideoTitles) quand le call vient d'un
// lien Calendly en description YouTube (utm_medium === 'description' + utm_content
// = ID vidéo valide). Fallback sur l'ancien affichage (utm_medium/source brut) sinon.

function resolveYtSource(
  call: Pick<Call, 'utm_medium' | 'utm_content' | 'source'>,
  ytVideoTitles: Record<string, string>,
): { label: string; videoId: string | null; title: string | null } {
  if (call.utm_medium === 'description' && call.utm_content && isYtVideoId(call.utm_content)) {
    const title = ytVideoTitles[call.utm_content] ?? null;
    if (title) return { label: title, videoId: call.utm_content, title };
  }
  const label = call.utm_medium
    ? `${call.utm_medium}${call.utm_content ? ` · ${call.utm_content.slice(0, 12)}` : ''}`
    : (call.source ?? '');
  return { label, videoId: null, title: null };
}

// ── getBestKnownStage ─────────────────────────────────────────────────────────
// Meilleure étape connue d'un lead avant call_booked, basée sur prospect_events.
// Sert au recul manuel depuis « RDV pris » : où remettre la carte.
//
// `resolveStage` vivait ici. Elle est morte avec l'unification : elle arbitrait
// entre étape naturelle et override sur un axe unique et ordonné, alors que
// l'override porte désormais une ISSUE, qui n'est pas une position sur cet axe.
// C'était aussi la cause structurelle du bug 3 — un override ne pouvait jamais
// faire reculer une carte, puisque « le naturel gagne s'il est au moins aussi
// avancé ».

function getBestKnownStage(
  prospect: ProspectLink | undefined,
  lead: IgLead | undefined,
  events: ProspectEvent[],
): IgStageKey {
  const username = (prospect?.ig_username ?? lead?.ig_username ?? '').toLowerCase();
  // Si le lead a un id connu, on n'accepte que les events liés à CE lead précis
  // (ou sans ig_lead_id pour les events legacy). Évite qu'un event d'un ancien lead
  // contaminate un nouveau lead du même username.
  const leadEvents = events.filter(e => {
    if (e.prospect_key.toLowerCase() !== username || e.platform !== 'ig') return false;
    if (lead?.id && e.ig_lead_id && e.ig_lead_id !== lead.id) return false;
    return true;
  });
  if (leadEvents.some(e => e.event_type === 'link_clicked')) return 'link_clicked';
  // `calendly_link_sent` n'a jamais existé en base avant le 2026-08-27 : son
  // écriture échouait en silence (voir migration 20260827000000). Cette branche
  // ne se déclenchera donc que pour les liens envoyés à partir de cette date.
  if (leadEvents.some(e => e.event_type === 'calendly_link_sent')) return 'calendly_sent';
  if (lead?.hook_replied) return 'in_convo';
  if (leadEvents.some(e => e.event_type === 'lm_link_requested')) return 'lm_received';
  if (lead?.source === 'cold_dm') return 'cold_dm';
  return 'lm_sent';
}

// ── resolveProspectContext ──────────────────────────────────────────────────────
// Retrouve le contexte brut (lead/prospect IG ou calls YT/Autre) d'une card à partir
// de sa clé — même logique de matching que celle utilisée pour construire les cards
// (IG : username ; YT/Autre : prospect_id ou call.id fallback), extraite ici pour être
// réutilisée par ProspectDetailModal sans dupliquer une 3ème fois cette recherche.

export interface ProspectContext {
  platform: 'ig' | 'yt' | 'other';
  cardKey: string;
  lead: IgLead | null;
  prospect: ProspectLink | null;
  calls: Call[]; // tous les calls rattachés à ce prospect, triés scheduled_at desc
  events: ProspectEvent[]; // tous les prospect_events rattachés à ce prospect
  lmHistory: LmHistoryEntry[]; // tous les lead magnets réclamés par ce lead (1 ligne par contenu)
  ytVideoTitles: Record<string, string>; // video_id → titre, pour résoudre la source d'un call
  igPostMeta: Record<string, IgPostMeta>; // media_id → légende/permalink/thumbnail
  storySequenceByMediaId: Record<string, StorySequenceRef>; // ig_story_id → séquence
}

export function resolveProspectContext(
  cardKey: string,
  platform: 'ig' | 'yt' | 'other',
  data: PipelineData,
): ProspectContext | null {
  if (platform === 'ig') {
    // cardKey peut être soit un username IG, soit `ig_link_${call.id}` (calls description/bio)
    if (cardKey.startsWith('ig_link_')) {
      const callId = cardKey.slice('ig_link_'.length);
      const call = data.calls.find(c => c.id === callId);
      if (!call) return null;

      // TOUTE la chaîne de reprogrammations, pas seulement le call de la carte :
      // sinon la timeline n'affiche que le dernier rendez-vous et l'historique
      // des reports disparaît (« Call booké » puis « Call annulé », sans les
      // étapes intermédiaires).
      //
      // On remonte d'abord vers l'amont (qui pointe sur moi ?) puis on redescend
      // vers l'aval (sur qui je pointe ?), pour reconstituer la chaîne complète
      // quel que soit le maillon d'entrée.
      // Types explicites (et non `typeof call`) : TypeScript inférait sinon une
      // référence circulaire sur `cur`, qui se déduit de ces Map alors que les
      // Map se déduisaient de `call`.
      type PipelineCall = (typeof data.calls)[number];
      const uuidToCall = new Map<string, PipelineCall>();
      const predecessorOf = new Map<string, PipelineCall>();
      for (const c of data.calls) {
        if (c.calendly_event_uuid) uuidToCall.set(c.calendly_event_uuid, c);
      }
      for (const c of data.calls) {
        if (!c.next_rescheduled_uri) continue;
        const nextUuid = c.next_rescheduled_uri.split('/scheduled_events/')[1]?.split('/')[0];
        if (nextUuid) {
          const target = uuidToCall.get(nextUuid);
          if (target) predecessorOf.set(target.id, c);
        }
      }

      const chain: PipelineCall[] = [call];
      const seen = new Set<string>([call.id]);
      // Amont
      let cur: PipelineCall | undefined = predecessorOf.get(call.id);
      while (cur && !seen.has(cur.id)) { chain.unshift(cur); seen.add(cur.id); cur = predecessorOf.get(cur.id); }
      // Aval
      cur = call;
      for (;;) {
        const nextUuid: string | undefined = cur?.next_rescheduled_uri?.split('/scheduled_events/')[1]?.split('/')[0];
        const next: PipelineCall | undefined = nextUuid ? uuidToCall.get(nextUuid) : undefined;
        if (!next || seen.has(next.id)) break;
        chain.push(next); seen.add(next.id); cur = next;
      }

      return { platform, cardKey, lead: null, prospect: null, calls: chain, events: [], lmHistory: [], ytVideoTitles: data.ytVideoTitles, igPostMeta: data.igPostMeta, storySequenceByMediaId: data.storySequenceByMediaId };
    }

    const username = cardKey.toLowerCase();
    const lead = data.leads.find(l => l.ig_username.toLowerCase() === username) ?? null;
    const prospect = data.prospects.find(p => p.ig_username.toLowerCase() === username) ?? null;
    const prospectPath = prospect?.short_url
      ? (() => { try { return new URL(prospect.short_url).pathname.slice(1); } catch { return null; } })()
      : null;

    const matchingCalls = data.calls.filter(c => {
      if (lead && c.ig_lead_id === lead.id) return true;
      if (!lead && prospect && c.short_link_path && prospectPath && c.short_link_path === prospectPath && !c.ig_lead_id) return true;
      return false;
    }).sort((a, b) => new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime());

    const matchingEvents = data.events.filter(e => {
      if (e.platform !== 'ig') return false;
      if (e.prospect_key.toLowerCase() !== username) return false;
      if (lead?.id && e.ig_lead_id && e.ig_lead_id !== lead.id) return false;
      return true;
    });

    const matchingLmHistory = data.lmHistory
      .filter(l => l.ig_username.toLowerCase() === username)
      .sort((a, b) => new Date(a.detected_at).getTime() - new Date(b.detected_at).getTime());

    if (!lead && !prospect && matchingCalls.length === 0) return null;
    return { platform, cardKey, lead, prospect, calls: matchingCalls, events: matchingEvents, lmHistory: matchingLmHistory, ytVideoTitles: data.ytVideoTitles, igPostMeta: data.igPostMeta, storySequenceByMediaId: data.storySequenceByMediaId };
  }

  // YT / Autre : cardKey = prospect_id, ou call.id en fallback (prospect_id absent)
  const calls = data.calls
    .filter(c => (c.prospect_id ?? c.id) === cardKey)
    .sort((a, b) => new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime());
  if (calls.length === 0) return null;

  const events = data.events.filter(e => e.platform === platform && e.prospect_key === cardKey);
  return { platform, cardKey, lead: null, prospect: null, calls, events, lmHistory: [], ytVideoTitles: data.ytVideoTitles, igPostMeta: data.igPostMeta, storySequenceByMediaId: data.storySequenceByMediaId };
}

// ── Card ──────────────────────────────────────────────────────────────────────

interface CardData {
  key: string;
  name: string;
  sub: string;
  date: string;
  /** La colonne où la carte s'affiche : l'issue si le lead est classé, l'étape sinon. */
  stageKey: string;
  /** Index dans IG_STAGES de l'ÉTAPE — jamais de l'issue, qui n'est pas ordonnée. */
  stageIdx: number;
  /** L'étape réellement atteinte, conservée même quand le lead est classé. */
  stage: StageKey;
  /** Le résultat, quand il y en a un. `null` = le lead est encore actif. */
  issue: IssueKey | null;
  /** Pourquoi cette issue : motif saisi, ou 'sans_reponse' pour une sortie de cycle. */
  issueReason?: string | null;
  /** Le RDV est passé et personne n'a rempli le rapport. */
  rapportEnRetard?: boolean;
  /** Relances faites dans le cycle en cours, et si la prochaine est due. */
  relancesFaites?: number;
  relanceDue?: boolean;
  /**
   * Dernier signe de vie, quelle qu'en soit la nature : commentaire, réponse en
   * DM, clic, rendez-vous, relance. C'est ce qui permet de trier par « ça dort
   * depuis longtemps » — la colonne la plus utile pour rattraper un lead oublié.
   */
  lastMoveAt?: string | null;
  /** Ce qui est attendu ensuite, en clair. Vide quand il n'y a rien à attendre. */
  nextDue?: { label: string; at: string | null; urgent: boolean } | null;
  extra?: string;
  noSource?: boolean;
  // Badges post-call
  badge?: 'no_show' | 'rescheduled' | 'not_qualified' | 'to_recontact' | null;
  lmNotReceived?: boolean;
  lmClickedAt?: string | null;
  // Pour afficher le bouton rapport
  callId?: string;
  callScheduledAt?: string;
  callStatus?: string;
  callOutcome?: string | null;
  // Valeurs du rapport déjà enregistré — servent à pré-remplir la modale quand on
  // rouvre le rapport pour le corriger (voir prop `existing` de RapportModal).
  callRevenue?: number | null;
  callComment?: string | null;
  callIsFollowUp?: boolean;
  naturalKey: string; // stage naturel avant override — pour natural_at_override
  hasProspectLink: boolean; // true si prospect_links.short_url est renseigné
  avatarUrl: string | null;
  isIgLink?: boolean; // true pour les calls ig_description/ig_bio — pas de username IG, pas de @
}

function PipelineCard({
  card, stages, isDragging, onDragStart, platform, onConfirmLead, onDeleteLead, onRapportClick, onCardClick, onNotALead,
}: {
  card: CardData;
  stages: readonly ColumnDef[];
  isDragging: boolean;
  onDragStart: (e: React.DragEvent, cardKey: string) => void;
  platform: 'ig' | 'yt' | 'other';
  onConfirmLead?: (key: string) => void;
  onDeleteLead?: (key: string, callId?: string | null) => void;
  onRapportClick?: (callId: string, inviteeName: string, scheduledAt: string, isFollowUp: boolean, existing?: { revenue?: number | null; comment?: string | null } | null) => void;
  onCardClick?: (cardKey: string) => void;
  onNotALead?: (key: string, callId?: string | null) => void;
}) {
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  // Trois couches peuvent etre ouvertes en meme temps (menu contextuel, puis une
  // confirmation par-dessus). Echap ne doit fermer que celle du dessus, sinon on
  // perd tout le contexte d'un coup — d'ou l'ordre de priorite ci-dessous.
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const [confirmNotALead, setConfirmNotALead] = useState(false);
  const [notALeadConfirmed, setNotALeadConfirmed] = useState(false);

  useEscapeKey(() => {
    if (confirmDelete) { setConfirmDelete(false); return; }
    if (confirmNotALead) { setConfirmNotALead(false); return; }
    if (ctxMenu) setCtxMenu(null);
  }, !!ctxMenu || confirmDelete || confirmNotALead);
  const stage = stages[card.stageIdx] ?? stages[0];
  const ac = avatarColor(card.name);
  const dragStartedRef = useRef(false);

  // Bouton "Remplir le rapport d'appel" : visible dès le début du call, caché si rapport déjà rempli
  //
  // Les calls annulés étaient acceptés, au motif d'une fenêtre de transition Calendly
  // pendant un report. Or un report ne crée PAS un nouveau call : le webhook
  // `invitee.rescheduled` déplace le `scheduled_at` du call existant, qui reste
  // `active` (app/api/webhooks/calendly/route.ts:428-432). Il n'y avait donc pas de
  // fenêtre à couvrir — juste un bouton affiché sur des calls annulés pour de bon,
  // qui n'ont pas eu lieu et n'auront jamais lieu.
  const now = Date.now();
  // Le bouton reste affiché APRÈS qu'un rapport a été rempli : il devient « Modifier le
  // rapport ». Avant, la condition `!card.callOutcome` le faisait disparaître dès la
  // première saisie, et il n'existait alors AUCUN moyen de corriger un montant mal saisi
  // ou un deal enregistré sur la mauvaise personne (même verrou côté page Calls, via
  // rapportPending). Voir docs/tracking-prospect.md.
  const hasRapport = !!card.callOutcome;
  const showRapport = card.callId && card.callScheduledAt
    && card.callStatus === 'active'
    && new Date(card.callScheduledAt).getTime() <= now
    && POST_CALL_STAGES.has(card.stageKey);

  return (
    <>
    <div
      draggable
      data-pipeline-card
      onDragStart={e => { dragStartedRef.current = true; onDragStart(e, card.key); }}
      onContextMenu={e => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY }); }}
      onClick={() => {
        if (dragStartedRef.current) { dragStartedRef.current = false; return; }
        onCardClick?.(card.key);
      }}
      style={{
        background: 'var(--surface)',
        border: `1px solid ${isDragging ? stage.color : 'var(--border)'}`,
        borderRadius: 8,
        padding: '9px 11px',
        cursor: 'grab',
        opacity: isDragging ? 0.45 : 1,
        transition: 'opacity .15s, box-shadow .12s, border-color .12s',
        userSelect: 'none',
        pointerEvents: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
      onMouseEnter={e => { if (!isDragging) e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,.09)'; }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; }}
    >
      {/* Row 1 : avatar + nom + badges */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {card.avatarUrl ? (
          <Image
            src={card.avatarUrl}
            alt={card.name}
            width={26}
            height={26}
            style={{ borderRadius: 7, flexShrink: 0, objectFit: 'cover', display: 'block' }}
            onError={e => { e.currentTarget.style.display = 'none'; }}
          />
        ) : (
          <div style={{
            width: 26, height: 26, borderRadius: 7, background: ac, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 10, fontWeight: 700, color: '#fff', letterSpacing: '.03em',
          }}>
            {avatarInitials(card.name)}
          </div>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 5 }}>
            {platform === 'ig' && !card.isIgLink ? `@${card.name}` : card.name}
            {card.badge === 'no_show' && (
              <span style={{ fontSize: 9, fontWeight: 700, background: '#fef2f2', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: 4, padding: '1px 5px', flexShrink: 0 }}>
                No-show
              </span>
            )}
            {card.badge === 'rescheduled' && (
              <span style={{ fontSize: 9, fontWeight: 700, background: '#fffbeb', color: '#d97706', border: '1px solid #fcd34d', borderRadius: 4, padding: '1px 5px', flexShrink: 0 }}>
                Reporté
              </span>
            )}
            {card.badge === 'not_qualified' && (
              <span style={{ fontSize: 9, fontWeight: 700, background: '#f3f4f6', color: '#6b7280', border: '1px solid #d1d5db', borderRadius: 4, padding: '1px 5px', flexShrink: 0 }}>
                NQ
              </span>
            )}
            {card.badge === 'to_recontact' && (
              <span style={{ fontSize: 9, fontWeight: 700, background: '#fff7ed', color: '#c2410c', border: '1px solid #fed7aa', borderRadius: 4, padding: '1px 5px', flexShrink: 0 }}>
                ↩ Recontacter
              </span>
            )}
            {card.lmNotReceived && (
              <span title="DM auto non envoyé (app en review)" style={{ fontSize: 9, fontWeight: 700, background: '#fefce8', color: '#a16207', border: '1px solid #fde047', borderRadius: 4, padding: '1px 5px', flexShrink: 0 }}>
                LM non reçu
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2, flexWrap: 'wrap' }}>
            {card.sub && (
              card.lmClickedAt ? (
                <span
                  title={`Lead magnet ouvert le ${new Date(card.lmClickedAt).toLocaleDateString('fr-FR')}`}
                  style={{ fontSize: 9, fontWeight: 700, background: '#f0fdf4', color: '#16a34a', border: '1px solid #86efac', borderRadius: 4, padding: '1px 5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}
                >
                  {card.sub}
                </span>
              ) : (
                <span style={{ fontSize: 9, fontWeight: 700, background: 'var(--surface-2)', color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>
                  {card.sub}
                </span>
              )
            )}
          </div>
        </div>
        <div style={{ fontSize: 10, color: 'var(--faint)', flexShrink: 0 }}>{card.date}</div>
      </div>

      {/* Row 2 : barre de progression miniature */}
      <div style={{ display: 'flex', gap: 2 }}>
        {stages.map((s, i) => (
          <div key={s.key} style={{
            flex: 1, height: 2, borderRadius: 1,
            background: i <= card.stageIdx ? s.color : 'var(--border)',
          }} />
        ))}
      </div>

      {card.extra && (
        <div style={{ fontSize: 10, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {card.extra}
        </div>
      )}

      {/* Bouton rapport — ouvre le modal directement dans le pipeline */}
      {showRapport && (
        <button
          type="button"
          draggable={false}
          onMouseDown={e => e.stopPropagation()}
          onClick={e => {
            e.stopPropagation();
            onRapportClick?.(card.callId!, card.name, card.callScheduledAt!, card.callIsFollowUp ?? false, hasRapport ? { revenue: card.callRevenue, comment: card.callComment } : null);
          }}
          // Rapport à remplir = action attendue, en bleu. Rapport déjà rempli = simple
          // correction possible, en gris discret pour ne pas réclamer l'attention.
          style={{
            display: 'block', width: '100%', textAlign: 'center', fontSize: 10, fontWeight: 600,
            padding: '5px 8px', borderRadius: 6,
            background: hasRapport ? 'var(--surface-2)' : '#EFF6FF',
            color: hasRapport ? 'var(--muted)' : '#2563EB',
            border: `1px solid ${hasRapport ? 'var(--border)' : '#BFDBFE'}`,
            cursor: 'pointer', transition: 'all .12s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = hasRapport ? 'var(--border)' : '#2563EB'; (e.currentTarget as HTMLElement).style.color = hasRapport ? 'var(--ink)' : '#fff'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = hasRapport ? 'var(--surface-2)' : '#EFF6FF'; (e.currentTarget as HTMLElement).style.color = hasRapport ? 'var(--muted)' : '#2563EB'; }}
        >
          {hasRapport ? 'Modifier le rapport' : "Remplir le rapport d'appel"}
        </button>
      )}

      {platform === 'yt' && card.noSource && (
        <div draggable={false} style={{ marginTop: 4, borderRadius: 8, background: 'var(--surface-2)', border: '1px solid var(--border)', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 500 }}>
            Source inconnue — est-ce bien un lead ?
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onMouseDown={e => { e.stopPropagation(); onConfirmLead?.(card.key); }}
              onClick={e => e.stopPropagation()}
              style={{ flex: 1, padding: '5px 0', fontSize: 10, fontWeight: 600, cursor: 'pointer', borderRadius: 6, border: '1px solid #2563EB', background: '#EFF6FF', color: '#2563EB', transition: 'all .12s' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#2563EB'; e.currentTarget.style.color = '#fff'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#EFF6FF'; e.currentTarget.style.color = '#2563EB'; }}
            >
              Oui, c'est un lead
            </button>
            {/* Répondre « Non » à « est-ce bien un lead ? » EST la confirmation :
                le bandeau pose la question, le bouton y répond. Il écrivait
                `dismissed`, qui masquait la carte sans l'exclure des statistiques
                — deux gestes voisins pour une seule intention. Il n'en reste
                qu'un : « ce n'est pas un lead ». */}
            <button
              onMouseDown={e => { e.stopPropagation(); onNotALead?.(card.key, card.callId); }}
              onClick={e => e.stopPropagation()}
              style={{ padding: '5px 10px', fontSize: 10, fontWeight: 600, cursor: 'pointer', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', transition: 'all .12s' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--border)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            >
              Non
            </button>
          </div>
        </div>
      )}
    </div>

    {/* Menu clic droit */}
    {ctxMenu && createPortal(
      <>
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 9999 }}
          onMouseDown={() => setCtxMenu(null)}
        />
        <div style={{
          position: 'fixed', left: ctxMenu.x, top: ctxMenu.y, zIndex: 10000,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,.12)',
          padding: '4px 0', minWidth: 160,
        }}>
          <button
            onMouseDown={e => { e.stopPropagation(); setCtxMenu(null); setConfirmNotALead(true); setNotALeadConfirmed(false); }}
            style={{
              display: 'block', width: '100%', textAlign: 'left',
              padding: '8px 14px', fontSize: 12, fontWeight: 500,
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--ink)',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-2)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
          >
            Ce n'est pas un lead
          </button>
          <button
            onMouseDown={e => { e.stopPropagation(); setCtxMenu(null); setConfirmDelete(true); setDeleteConfirmed(false); }}
            style={{
              display: 'block', width: '100%', textAlign: 'left',
              padding: '8px 14px', fontSize: 12, fontWeight: 500,
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#dc2626',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#fef2f2'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
          >
            Supprimer {platform === 'ig' && !card.isIgLink ? `@${card.name}` : card.name}
          </button>
        </div>
      </>,
      document.body
    )}

    {/* Modale confirmation suppression */}
    {confirmDelete && createPortal(
      <>
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 10001 }} onMouseDown={() => setConfirmDelete(false)} />
        <div style={{
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
          zIndex: 10002, background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 12, padding: '24px 28px', minWidth: 320, boxShadow: '0 8px 32px rgba(0,0,0,.18)',
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Supprimer {platform === 'ig' && !card.isIgLink ? `@${card.name}` : card.name} ?</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
            Cette action supprime définitivement le lead et son historique.
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--ink)', marginBottom: 20, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={deleteConfirmed}
              onChange={e => setDeleteConfirmed(e.target.checked)}
              style={{ width: 14, height: 14, cursor: 'pointer' }}
            />
            Je comprends que cette action est irréversible
          </label>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              onMouseDown={() => { setConfirmDelete(false); setDeleteConfirmed(false); }}
              style={{ padding: '7px 16px', fontSize: 12, fontWeight: 600, borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer' }}
            >
              Annuler
            </button>
            <button
              onMouseDown={() => { if (!deleteConfirmed) return; setConfirmDelete(false); setDeleteConfirmed(false); onDeleteLead?.(card.key, card.callId); }}
              style={{ padding: '7px 16px', fontSize: 12, fontWeight: 600, borderRadius: 7, border: 'none', background: '#dc2626', color: '#fff', cursor: deleteConfirmed ? 'pointer' : 'not-allowed', opacity: deleteConfirmed ? 1 : 0.4 }}
            >
              Supprimer
            </button>
          </div>
        </div>
      </>,
      document.body
    )}

    {/* Modale confirmation "pas un lead" */}
    {confirmNotALead && createPortal(
      <>
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 10001 }} onMouseDown={() => setConfirmNotALead(false)} />
        <div style={{
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
          zIndex: 10002, background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 12, padding: '24px 28px', minWidth: 320, maxWidth: 380, boxShadow: '0 8px 32px rgba(0,0,0,.18)',
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
            {platform === 'ig' && !card.isIgLink ? `@${card.name}` : card.name} n'est pas un lead ?
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16, lineHeight: 1.5 }}>
            Cette fiche ne sera plus comptée dans les stats et ne sera pas recréée si la
            personne vous réécrit en DM. Si elle clique un jour sur un lien tracké
            (commentaire avec mot-clé, lien bio), un nouveau lead sera créé normalement.
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--ink)', marginBottom: 20, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={notALeadConfirmed}
              onChange={e => setNotALeadConfirmed(e.target.checked)}
              style={{ width: 14, height: 14, cursor: 'pointer' }}
            />
            Je comprends que cette fiche ne sera plus jamais comptée, quoi qu'elle fasse en DM
          </label>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              onMouseDown={() => { setConfirmNotALead(false); setNotALeadConfirmed(false); }}
              style={{ padding: '7px 16px', fontSize: 12, fontWeight: 600, borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer' }}
            >
              Annuler
            </button>
            <button
              onMouseDown={() => { if (!notALeadConfirmed) return; setConfirmNotALead(false); setNotALeadConfirmed(false); onNotALead?.(card.key, card.callId); }}
              style={{ padding: '7px 16px', fontSize: 12, fontWeight: 600, borderRadius: 7, border: 'none', background: '#2563EB', color: '#fff', cursor: notALeadConfirmed ? 'pointer' : 'not-allowed', opacity: notALeadConfirmed ? 1 : 0.4 }}
            >
              Confirmer
            </button>
          </div>
        </div>
      </>,
      document.body
    )}
    </>
  );
}

// ── KanbanColumn ──────────────────────────────────────────────────────────────

function KanbanColumn({
  stage, cards, stages, draggingKey, onDragStart, onDrop, onDragOver, onDragLeave,
  isDropTarget, platform, onConfirmLead, onDeleteLead, onRapportClick, onCardClick, onNotALead,
}: {
  stage: ColumnDef;
  cards: CardData[];
  stages: readonly ColumnDef[];
  draggingKey: string | null;
  onDragStart: (e: React.DragEvent, key: string) => void;
  onDrop: (e: React.DragEvent, stageKey: string) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  isDropTarget: boolean;
  platform: 'ig' | 'yt' | 'other';
  onConfirmLead?: (key: string) => void;
  onDeleteLead?: (key: string, callId?: string | null) => void;
  onRapportClick?: (callId: string, inviteeName: string, scheduledAt: string, isFollowUp: boolean, existing?: { revenue?: number | null; comment?: string | null } | null) => void;
  onCardClick?: (cardKey: string) => void;
  onNotALead?: (key: string, callId?: string | null) => void;
}) {
  return (
    <div style={{ width: 220, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6, transition: 'background .1s', alignSelf: 'stretch' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '7px 10px', borderRadius: 7,
        background: isDropTarget ? stage.lightBg : 'var(--surface-2)',
        border: `1px solid ${isDropTarget ? stage.color + '55' : 'var(--border)'}`,
        transition: 'all .12s', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: stage.color, flexShrink: 0 }} />
          <span style={{ fontSize: 11, fontWeight: 600, color: isDropTarget ? stage.color : 'var(--ink)' }}>
            {stage.label}
          </span>
        </div>
        <span style={{
          fontSize: 10, fontWeight: 700,
          color: cards.length > 0 ? stage.color : 'var(--faint)',
          background: cards.length > 0 ? stage.lightBg : 'transparent',
          border: cards.length > 0 ? `1px solid ${stage.color}33` : '1px solid transparent',
          borderRadius: 5, padding: '1px 6px', minWidth: 18, textAlign: 'center',
        }}>
          {cards.length}
        </span>
      </div>

      <div
        onDrop={e => onDrop(e, stage.key)}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        style={{
          display: 'flex', flexDirection: 'column', gap: 5, flex: 1, minHeight: 80,
          padding: isDropTarget ? '4px' : '0', borderRadius: 8,
          background: isDropTarget ? stage.lightBg + 'BB' : 'transparent',
          border: isDropTarget ? `1.5px dashed ${stage.color}66` : '1.5px dashed transparent',
          transition: 'all .12s',
        }}>
        {cards.length === 0 && !isDropTarget && (
          <div style={{ border: '1px dashed var(--border)', borderRadius: 7, padding: '14px 10px', textAlign: 'center', fontSize: 10, color: 'var(--faint)' }}>
            Glisser ici
          </div>
        )}
        {cards.map(card => (
          <PipelineCard
            key={card.key}
            card={card}
            stages={stages}
            isDragging={draggingKey === card.key}
            onDragStart={onDragStart}
            platform={platform}
            onConfirmLead={onConfirmLead}
            onDeleteLead={onDeleteLead}
            onRapportClick={onRapportClick}
            onCardClick={onCardClick}
            onNotALead={onNotALead}
          />
        ))}
      </div>
    </div>
  );
}

// ── ConfirmMoveModal ──────────────────────────────────────────────────────────

type ConfirmCase =
  | 'backward_pre_call'         // recul vers un stage pré-call (reset complet des signaux)
  | 'forward_pre_call'          // avancée manuelle vers un stage pré-call (injection signaux)
  | 'backward_from_post_call'   // recul depuis call_booked vers une étape pré-call
  | 'forward_to_call_booked'    // avancée manuelle vers call_booked
  | 'forward_to_closed'         // classement manuel en Closé
  | 'no_prospect_link'          // lien Calendly prospect non généré — blocage
  | 'simple_move';              // tout autre déplacement

interface ConfirmMoveModalProps {
  case: ConfirmCase;
  cardName: string;
  targetStageKey: string;
  targetStageLabel: string;
  currentStageKey: string;
  callId: string | null;
  onConfirm: (reason: string, extraData?: Record<string, any>) => void;
  onCancel: () => void;
}

function getResetDescription(targetStage: string, currentStage: string, hasCall: boolean): string[] {
  const items: string[] = [];
  // Même ordre que IG_PRE_CALL côté serveur (reset/route.ts) — cold_dm inclus,
  // sinon indexOf renvoie -1 et la liste ne tient que par accident (-1 est
  // inférieur à tout). Un recul vers Cold DM efface les mêmes signaux qu'un
  // recul vers LM reçu : tout ce qui est devant lui.
  const stages = ['cold_dm', 'lm_sent', 'in_convo', 'calendly_sent', 'link_clicked'];
  const targetIdx = stages.indexOf(targetStage);

  if (targetIdx < stages.indexOf('in_convo')) {
    items.push('La réponse au message de bienvenue sera effacée');
  }
  if (targetIdx < stages.indexOf('calendly_sent')) {
    items.push("L'envoi du lien Calendly sera effacé");
  }
  if (targetIdx < stages.indexOf('link_clicked')) {
    items.push('Le clic sur le lien Calendly sera effacé');
  }
  if (hasCall) {
    items.push('Le call Calendly réservé sera détaché (il reste dans ton historique mais ne sera plus lié à ce lead)');
  }
  return items;
}

// Cases à cocher pour confirmer uniquement les signaux entre currentStage et targetStage
function getAdvanceConfirmations(currentStage: string, targetStage: string): { id: string; label: string }[] {
  const stages = ['lm_sent', 'in_convo', 'calendly_sent', 'link_clicked'];
  const currentIdx = stages.indexOf(currentStage);
  const targetIdx  = stages.indexOf(targetStage);
  const items: { id: string; label: string }[] = [];
  // On ne demande que les signaux strictement au-dessus du stage de départ
  if (currentIdx < stages.indexOf('in_convo') && targetIdx >= stages.indexOf('in_convo')) {
    items.push({ id: 'hook_replied', label: 'Le lead a bien répondu à mon message de bienvenue' });
  }
  if (currentIdx < stages.indexOf('calendly_sent') && targetIdx >= stages.indexOf('calendly_sent')) {
    items.push({ id: 'calendly_sent', label: "J'ai bien envoyé le lien Calendly à ce lead" });
  }
  if (currentIdx < stages.indexOf('link_clicked') && targetIdx >= stages.indexOf('link_clicked')) {
    items.push({ id: 'link_clicked', label: 'Le lead a bien cliqué sur le lien Calendly' });
  }
  return items;
}

function ConfirmMoveModal({ case: modalCase, cardName, targetStageKey, targetStageLabel, currentStageKey, callId, onConfirm, onCancel }: ConfirmMoveModalProps) {
  const viewerTz = useViewerTimeZone();
  useEscapeKey(onCancel);
  const [reason, setReason] = useState('');
  const [irreversibleChecked, setIrreversibleChecked] = useState(false);
  const [advanceChecked, setAdvanceChecked] = useState<Set<string>>(new Set());

  // call_booked manuel
  const [callDate, setCallDate] = useState('');
  const [callTime, setCallTime] = useState('');
  const [callDuration, setCallDuration] = useState('60');
  const [callName, setCallName] = useState(cardName);
  const [callEmail, setCallEmail] = useState('');

  // closed manuel
  const [revenue, setRevenue] = useState('');

  const advanceConfirmations = modalCase === 'forward_pre_call' ? getAdvanceConfirmations(currentStageKey, targetStageKey) : [];
  const allAdvanceChecked = advanceConfirmations.length > 0 && advanceConfirmations.every(c => advanceChecked.has(c.id));

  const callBookedValid = callDate && callTime && callName.trim();
  // La virgule est le separateur decimal francais, et le pave `inputMode`
  // decimal la propose en premier sur mobile : `Number('1,5')` vaut NaN, donc
  // sans cette normalisation la saisie naturelle etait refusee en silence.
  // RapportModal fait deja ce `replace` sur le meme champ.
  const revenueNum = Number(String(revenue).replace(',', '.'));
  const closedValid = revenue !== '' && !isNaN(revenueNum) && revenueNum >= 0;

  function toggleAdvance(id: string) {
    setAdvanceChecked(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return createPortal(
    <>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 10001 }} onMouseDown={onCancel} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        zIndex: 10002, background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 12, padding: '24px 28px', minWidth: 400, maxWidth: 480,
        boxShadow: '0 8px 32px rgba(0,0,0,.18)',
      }}>
        {modalCase === 'backward_pre_call' && (() => {
          const resetItems = getResetDescription(targetStageKey, currentStageKey, !!callId);
          return (
            <>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
                Reculer @{cardName} vers &laquo;&nbsp;{targetStageLabel}&nbsp;&raquo;
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
                Pour repartir proprement depuis cette étape, voici ce qui sera effacé :
              </div>
              <ul style={{ margin: '0 0 16px 0', padding: '0 0 0 18px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {resetItems.map((item, i) => (
                  <li key={i} style={{ fontSize: 12, color: 'var(--ink)', lineHeight: 1.4 }}>{item}</li>
                ))}
              </ul>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 16, padding: '8px 12px', background: 'var(--surface-alt, #f8f8f8)', borderRadius: 8, border: '1px solid var(--border)' }}>
                Après ça, le pipeline reprendra automatiquement dès qu&apos;un nouveau signal arrive (message, lien envoyé, clic...).
              </div>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', marginBottom: 20 }}>
                <input
                  type="checkbox"
                  checked={irreversibleChecked}
                  onChange={e => setIrreversibleChecked(e.target.checked)}
                  style={{ marginTop: 2, accentColor: '#DC2626', flexShrink: 0 }}
                />
                <span style={{ fontSize: 12, color: 'var(--ink)', lineHeight: 1.4 }}>
                  Je comprends que cette action est irréversible
                </span>
              </label>
            </>
          );
        })()}

        {modalCase === 'forward_pre_call' && (
          <>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
              Avancer @{cardName} vers &laquo;&nbsp;{targetStageLabel}&nbsp;&raquo;
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
              Pour que le pipeline reste cohérent, confirme ce qui s&apos;est passé avec ce lead :
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
              {advanceConfirmations.map(c => (
                <label key={c.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={advanceChecked.has(c.id)}
                    onChange={() => toggleAdvance(c.id)}
                    style={{ marginTop: 2, accentColor: '#2563EB', flexShrink: 0 }}
                  />
                  <span style={{ fontSize: 12, color: 'var(--ink)', lineHeight: 1.4 }}>{c.label}</span>
                </label>
              ))}
            </div>
          </>
        )}

        {modalCase === 'backward_from_post_call' && (
          <>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Déplacer @{cardName} en arrière</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 20 }}>
              Le call associé sera supprimé définitivement ainsi que son historique.
            </div>
          </>
        )}

        {modalCase === 'forward_to_call_booked' && (
          <>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Enregistrer le call de @{cardName}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
              Renseigne les infos du call pour que le rapport soit envoyé au bon moment.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Date du call</div>
                  <input type="date" value={callDate} onChange={e => setCallDate(e.target.value)}
                    style={{ width: '100%', padding: '6px 10px', fontSize: 12, borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--ink)' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Heure de début</div>
                  <input type="time" value={callTime} onChange={e => setCallTime(e.target.value)}
                    style={{ width: '100%', padding: '6px 10px', fontSize: 12, borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--ink)' }} />
                  {/* Toujours affiché, comme dans CreateCallModal : dans un
                      formulaire, l'ambiguïté sur le fuseau coûte plus cher qu'un
                      libellé de plus. */}
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>Heure de {cityLabelOf(viewerTz)}</div>
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Durée du call</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {['30', '45', '60', '90'].map(d => (
                    <button key={d} onMouseDown={() => setCallDuration(d)}
                      style={{ flex: 1, padding: '6px 0', fontSize: 12, borderRadius: 7, border: `1px solid ${callDuration === d ? '#2563EB' : 'var(--border)'}`, background: callDuration === d ? '#EFF6FF' : 'transparent', color: callDuration === d ? '#2563EB' : 'var(--ink)', cursor: 'pointer', fontWeight: 600 }}>
                      {d} min
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Nom du lead</div>
                <input type="text" value={callName} onChange={e => setCallName(e.target.value)} placeholder="Prénom Nom"
                  style={{ width: '100%', padding: '6px 10px', fontSize: 12, borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--ink)', boxSizing: 'border-box' }} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Email (optionnel)</div>
                <input type="email" value={callEmail} onChange={e => setCallEmail(e.target.value)} placeholder="lead@email.com"
                  style={{ width: '100%', padding: '6px 10px', fontSize: 12, borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--ink)', boxSizing: 'border-box' }} />
              </div>
            </div>
          </>
        )}

        {modalCase === 'forward_to_closed' && (
          <>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Deal fermé avec @{cardName} ?</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
              Indique le montant pour que le chiffre d&apos;affaires soit comptabilisé dans les stats.
            </div>
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Montant du deal (€)</div>
              <input type="text" inputMode="decimal" value={revenue} onChange={e => setRevenue(e.target.value)} placeholder="ex : 1500"
                style={{ width: '100%', padding: '6px 10px', fontSize: 13, fontWeight: 600, borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--ink)', boxSizing: 'border-box' }} />
            </div>
          </>
        )}

        {modalCase === 'simple_move' && (
          <>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Déplacer vers &laquo;&nbsp;{targetStageLabel}&nbsp;&raquo; ?</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 20 }}>
              @{cardName} sera déplacé manuellement. Le pipeline automatique continuera de s&apos;appliquer si un signal plus avancé est détecté.
            </div>
          </>
        )}

        {modalCase === 'no_prospect_link' && (
          <>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
              Lien Calendly non généré
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink)', marginBottom: 16, lineHeight: 1.6 }}>
              Pour déplacer <strong>@{cardName}</strong> vers <strong>{targetStageLabel}</strong>, tu dois d&apos;abord générer son lien Calendly personnalisé — c&apos;est ce lien qui permet de traquer le clic et le call booké.
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink)', marginBottom: 20, padding: '10px 14px', background: 'var(--surface-alt, #f8f8f8)', borderRadius: 8, border: '1px solid var(--border)', lineHeight: 1.6 }}>
              Rends-toi dans <strong>Gérer mes liens</strong> et clique sur le bouton{' '}
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600, color: '#2563EB' }}>
                📅 Lien Calendly prospect DM
              </span>
              {' '}pour générer son lien personnalisé à lui envoyer.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onMouseDown={onCancel} style={{ padding: '7px 16px', fontSize: 12, fontWeight: 600, borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer' }}>
                Fermer
              </button>
              <button
                onMouseDown={() => { onCancel(); window.location.href = '/client/liens'; }}
                style={{ padding: '7px 16px', fontSize: 12, fontWeight: 600, borderRadius: 7, border: 'none', background: '#2563EB', color: '#fff', cursor: 'pointer' }}
              >
                Aller dans Gérer mes liens →
              </button>
            </div>
          </>
        )}

        {modalCase !== 'no_prospect_link' && <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onMouseDown={onCancel}
            style={{ padding: '7px 16px', fontSize: 12, fontWeight: 600, borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer' }}
          >
            Annuler
          </button>
          <button
            onMouseDown={() => {
              if (modalCase === 'backward_pre_call' && !irreversibleChecked) return;
              if (modalCase === 'forward_pre_call' && !allAdvanceChecked) return;
              if (modalCase === 'forward_to_call_booked' && !callBookedValid) return;
              if (modalCase === 'forward_to_closed' && !closedValid) return;
              const extraData: Record<string, any> = {};
              if (modalCase === 'forward_to_call_booked') {
                // .toISOString() produit un Z explicite. Avant ce fix, la chaîne
                // `${callDate}T${callTime}:00` partait SANS offset : Postgres
                // l'interprétait alors dans le fuseau de sa session (UTC chez
                // Supabase), donc "14:00" était stocké comme 14:00 UTC = 16:00
                // Paris. Tous les calls créés depuis le pipeline étaient décalés
                // de 2h en été, silencieusement.
                const [cy, cm, cd] = callDate.split('-').map(Number);
                const [ch, cmin] = callTime.split(':').map(Number);
                extraData.scheduledAt = wallClockToUtc(cy, cm, cd, ch, cmin, viewerTz).toISOString();
                extraData.duration = callDuration;
                extraData.inviteeName = callName.trim();
                extraData.inviteeEmail = callEmail.trim() || null;
              }
              if (modalCase === 'forward_to_closed') {
                extraData.revenue = revenueNum;
              }
              onConfirm(reason || 'manual', extraData);
            }}
            disabled={
              (modalCase === 'backward_pre_call' && !irreversibleChecked) ||
              (modalCase === 'forward_pre_call' && !allAdvanceChecked) ||
              (modalCase === 'forward_to_call_booked' && !callBookedValid) ||
              (modalCase === 'forward_to_closed' && !closedValid)
            }
            style={{
              padding: '7px 16px', fontSize: 12, fontWeight: 600, borderRadius: 7, border: 'none',
              background:
                (modalCase === 'backward_pre_call' && !irreversibleChecked) ? 'var(--border)' :
                (modalCase === 'forward_pre_call' && !allAdvanceChecked) ? 'var(--border)' :
                (modalCase === 'forward_to_call_booked' && !callBookedValid) ? 'var(--border)' :
                (modalCase === 'forward_to_closed' && !closedValid) ? 'var(--border)' :
                modalCase === 'backward_pre_call' ? '#DC2626' : '#2563EB',
              color:
                (modalCase === 'backward_pre_call' && !irreversibleChecked) ? 'var(--muted)' :
                (modalCase === 'forward_pre_call' && !allAdvanceChecked) ? 'var(--muted)' :
                (modalCase === 'forward_to_call_booked' && !callBookedValid) ? 'var(--muted)' :
                (modalCase === 'forward_to_closed' && !closedValid) ? 'var(--muted)' : '#fff',
              cursor:
                (modalCase === 'backward_pre_call' && !irreversibleChecked) ? 'not-allowed' :
                (modalCase === 'forward_pre_call' && !allAdvanceChecked) ? 'not-allowed' :
                (modalCase === 'forward_to_call_booked' && !callBookedValid) ? 'not-allowed' :
                (modalCase === 'forward_to_closed' && !closedValid) ? 'not-allowed' : 'pointer',
            }}
          >
            {modalCase === 'backward_pre_call' ? 'Effacer et reculer' : 'Confirmer'}
          </button>
        </div>}
      </div>
    </>,
    document.body
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function PagePipeline() {
  const [tab, setTab] = useState<'ig' | 'yt' | 'other'>('ig');
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [confirmedKeys, setConfirmedKeys] = useState<Set<string>>(new Set());
  const dropCounters = useRef<Record<string, number>>({});

  const [refreshing, setRefreshing] = useState(false);

  // Filtres. No-shows, Pas qualifiés et À recontacter sont devenus des colonnes
  // du kanban ; Archivés reposait sur `dismissed`, un mécanisme resté à zéro
  // ligne en un an. Ne restent que les deux états du rendez-vous.
  // Repli des filtres sur mobile uniquement (le desktop les affiche toujours).
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Board ou Liste. Le board répond à « où en est chaque lead », la liste à
  // « lequel dois-je traiter maintenant ». Le choix est conservé d'une visite à
  // l'autre : y revenir à chaque fois serait un pas de plus à refaire sans cesse.
  const [vue, setVue] = useState<'board' | 'liste'>('board');
  useEffect(() => {
    try {
      const v = window.localStorage.getItem('pipeline-vue');
      if (v === 'liste' || v === 'board') setVue(v);
    } catch { /* navigation privée, cookies bloqués : le board par défaut suffit */ }
  }, []);
  const changerVue = (v: 'board' | 'liste') => {
    setVue(v);
    try { window.localStorage.setItem('pipeline-vue', v); } catch { /* sans effet */ }
  };
  const [filterCanceled, setFilterCanceled] = useState(false);
  const [filterRescheduled, setFilterRescheduled] = useState(false);

  // Modale de confirmation drag-and-drop
  const [confirmModal, setConfirmModal] = useState<{
    case: ConfirmCase;
    cardKey: string;
    cardName: string;
    targetStageKey: string;
    targetStageLabel: string;
    currentStageKey: string;
    callId: string | null;
    naturalKey: string;
  } | null>(null);

  // Rapport modal ouvert directement depuis le pipeline
  const [rapportModal, setRapportModal] = useState<{
    callId: string;
    inviteeName: string;
    scheduledAt: string;
    isFollowUp?: boolean;
    // Renseigné uniquement quand on rouvre un rapport déjà rempli, pour pré-remplir la
    // modale au lieu de faire ressaisir les valeurs de mémoire.
    existing?: { revenue?: number | null; comment?: string | null } | null;
  } | null>(null);

  // Message renvoyé par le serveur quand une suppression est refusée (deal signé).
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Modal détail prospect (timeline) ouvert au clic sur une card
  const [detailModal, setDetailModal] = useState<{ cardKey: string; platform: 'ig' | 'yt' | 'other' } | null>(null);

  const { data, isLoading: loading, refetch } = useQuery<PipelineData | null>({
    queryKey: ['pipeline'],
    queryFn: () => fetch('/api/client/pipeline').then(r => r.ok ? r.json() : null),
    staleTime: 0,
  });

  async function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    await Promise.allSettled([
      fetch('/api/instagram/refresh-today', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }),
      fetch('/api/youtube/refresh-today',   { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }),
      fetch('/api/shortio/refresh-today',   { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }),
      fetch('/api/calendly/refresh',         { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }),
    ]);
    await refetch();
    setRefreshing(false);
  }

  useEffect(() => {
    if (data?.overrides) {
      setConfirmedKeys(new Set(data.overrides.filter((o: Override) => o.stage === 'confirmed_lead').map((o: Override) => o.prospect_key)));
    }
  }, [data?.overrides]);

  // Overrides effectifs = DB + drops optimistes locaux (local gagne si plus récent)
  const effectiveOverrides: Override[] = (() => {
    const base: Override[] = data?.overrides ?? [];
    if (overrides.length === 0) return base;
    const merged = [...base];
    for (const local of overrides) {
      const idx = merged.findIndex(o => o.prospect_key === local.prospect_key && o.platform === local.platform);
      if (idx >= 0) {
        if (new Date(local.updated_at) > new Date(merged[idx].updated_at)) merged[idx] = local;
      } else {
        merged.push(local);
      }
    }
    return merged;
  })();

  const saveOverride = useCallback(async (key: string, platform: 'ig' | 'yt' | 'other', stage: string, reason?: string, naturalAtOverride?: string) => {
    // La carte se deplace a l'ecran AVANT la requete, pour que le geste
    // paraisse instantane. L'etat precedent est capture pour la remettre a sa
    // place si le serveur refuse : sinon le lead paraissait deplace alors
    // qu'il etait reste a son etape en base, et le prochain rafraichissement
    // le faisait "sauter" en arriere sans explication.
    let avant: Override[] = [];
    setOverrides(prev => {
      avant = prev;
      const idx = prev.findIndex(o => o.prospect_key === key && o.platform === platform);
      const entry: Override = { prospect_key: key, platform, stage, updated_at: new Date().toISOString(), reason, natural_at_override: naturalAtOverride ?? null };
      return idx >= 0 ? prev.map((o, i) => i === idx ? entry : o) : [...prev, entry];
    });
    await mutate('/api/client/pipeline', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prospect_key: key, platform, stage, reason, natural_at_override: naturalAtOverride ?? null }),
      rollback: () => setOverrides(avant),
      erreur: "Le déplacement n'a pas pu être enregistré.",
    });
  }, []);

  const patchCall = useCallback(async (callId: string, fields: Record<string, any>) => {
    await mutate(`/api/client/calls/${callId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(fields),
      erreur: "Le call n'a pas pu être mis à jour.",
    });
  }, []);

  // ── Build IG cards ──────────────────────────────────────────────────────────

  const events = data?.events ?? [];

  const igCards: CardData[] = [];
  if (data) {
    const seen = new Set<string>();
    const allUsernames = new Set<string>([
      ...data.leads.map(l => l.ig_username.toLowerCase()),
      ...data.prospects.map(p => p.ig_username.toLowerCase()),
    ]);

    for (const username of allUsernames) {
      if (seen.has(username)) continue;
      seen.add(username);

      const lead = data.leads.find(l => l.ig_username.toLowerCase() === username);
      const prospect = data.prospects.find(p => p.ig_username.toLowerCase() === username);

      // Étape naturelle
      // Pour calendly_sent et link_clicked : le signal doit être postérieur à detected_at du lead
      // (même logique que syncLmClickStream pour les clics LM) — évite les clics/envois anciens
      // d'un lien réutilisé avec le même path Short.io de polluer un nouveau lead
      const leadDetectedAt = lead?.detected_at ? new Date(lead.detected_at) : null;
      const calendlySentValid = prospect?.calendly_link_sent &&
        (!leadDetectedAt || !prospect.calendly_link_sent_at || new Date(prospect.calendly_link_sent_at) > leadDetectedAt);
      // Comparer avec last_calendly_link_sent_at (dernier envoi) et non calendly_link_sent_at (premier)
      // pour éviter qu'un clic antérieur au dernier envoi du lien soit comptabilisé
      const linkSentRef = prospect?.last_calendly_link_sent_at ?? prospect?.calendly_link_sent_at;
      const linkClickedValid = prospect?.first_click_at &&
        prospect?.calendly_link_sent &&
        linkSentRef &&
        new Date(prospect.first_click_at) > new Date(linkSentRef);

      const prospectPath = prospect?.short_url
        ? (() => { try { return new URL(prospect.short_url).pathname.slice(1); } catch { return null; } })()
        : null;

      // Parmi tous les calls du lead, prendre le plus pertinent :
      // 1) actif sans no_show en priorité (le vrai call booké)
      // 2) sinon le premier par scheduled_at DESC (déjà trié par la query)
      const matchingCalls = data.calls.filter(c => {
        // Seul critère fiable : ig_lead_id correspond exactement au lead courant
        // short_link_path seul ne suffit pas — un call détaché (ig_lead_id=null) ou
        // appartenant à un ancien lead ne doit jamais être rattaché au lead courant
        if (lead && c.ig_lead_id === lead.id) return true;
        // Pour les prospects sans lead (cold DM pur) : short_link_path OK seulement si pas d'ig_lead_id
        if (!lead && prospect && c.short_link_path && prospectPath && c.short_link_path === prospectPath && !c.ig_lead_id) return true;
        return false;
      });
      const call = matchingCalls.find(c => c.status === 'active' && !c.no_show) ?? matchingCalls[0];

      const override = effectiveOverrides.find(o => o.prospect_key.toLowerCase() === username && o.platform === 'ig');

      // Source unique de l'état — remplace la cascade qui vivait ici et ses deux
      // jumelles divergentes plus bas. Le call annulé ou reporté ne décide pas :
      // pickDecidingCall les écarte, et le lead retombe sur ses signaux réels.
      const lmRequested = lead
        ? events.some(e => e.ig_lead_id === lead.id && e.event_type === 'lm_link_requested')
        : false;
      const state = resolveLeadState({
        signals: {
          isColdDm:         lead?.source === 'cold_dm',
          lmLinkRequested:  lmRequested,
          hasReplied:       !!lead?.hook_replied,
          calendlySentValid: !!calendlySentValid,
          linkClickedValid:  !!linkClickedValid,
          minStageReached:  (prospect?.min_stage_reached as StageKey | null) ?? null,
        },
        calls:        matchingCalls,
        manualIssue:  override?.stage ?? null,
        manualReason: override?.reason ?? null,
        relances:     events
          .filter(e => e.prospect_key.toLowerCase() === username && e.platform === 'ig' && e.event_type === 'relance')
          .map(e => e.occurred_at)
          .sort(),
        lastReplyAt:  lead?.hook_replied_at ?? null,
      }, new Date());

      // Le badge dit ce que la colonne ne dit pas. Un lead classé porte déjà son
      // issue en colonne — inutile de la répéter dessus.
      let badge: CardData['badge'] = null;
      if (state.status === 'active' && call?.rescheduled
          && new Date(call.scheduled_at).getTime() < Date.now()) {
        badge = 'rescheduled';
      }

      const stageKey = state.issue ?? state.stage;
      const stageIdx = IG_STAGES.findIndex(s => s.key === state.stage);
      const natural = state.stage;
      const detectedAt = lead?.detected_at ?? prospect?.created_at ?? new Date().toISOString();

      // Dernier signe de vie, toutes sources confondues. Les événements sont
      // inclus : ce sont eux qui portent le clic sur le lead magnet et, bientôt,
      // les relances.
      const leadEventDates = lead
        ? events.filter(e => e.ig_lead_id === lead.id).map(e => e.occurred_at)
        : [];
      const lastMoveAt = latestOf(
        detectedAt,
        lead?.hook_replied_at,
        prospect?.last_calendly_link_sent_at ?? prospect?.calendly_link_sent_at,
        prospect?.first_click_at,
        call?.scheduled_at,
        ...leadEventDates,
      );
      const nextDue = computeNextDue(state, call?.scheduled_at ?? null, lastMoveAt, new Date());
      const sub = lead?.keyword_matched && lead.keyword_matched !== 'cold_dm'
        ? `#${lead.keyword_matched}`
        : (lead?.source === 'cold_dm' || prospect) ? 'Cold DM' : '';

      const lmClickedEvent = lead ? events.find(e => e.ig_lead_id === lead.id && e.event_type === 'lm_clicked') : null;

      igCards.push({
        key: username,
        name: username,
        sub,
        date: timeAgo(detectedAt),
        stageKey,
        stageIdx: stageIdx >= 0 ? stageIdx : 0,
        stage: state.stage,
        issue: state.issue,
        issueReason: state.issueReason,
        rapportEnRetard: state.flags.rapportEnRetard,
        relancesFaites: state.flags.relancesFaites,
        relanceDue: state.flags.relanceDue,
        lastMoveAt,
        nextDue,
        badge,
        lmNotReceived: lead && lead.source !== 'cold_dm' ? !lead.lead_magnet_sent : false,
        lmClickedAt: lmClickedEvent?.occurred_at ?? null,
        callId: call?.id ?? undefined,
        callScheduledAt: call?.scheduled_at ?? undefined,
        callStatus: call?.status ?? undefined,
        callOutcome: call?.outcome ?? null,
        callRevenue: call?.revenue ?? null,
        callComment: call?.lead_rapport_comment ?? null,
        callIsFollowUp: call?.is_follow_up ?? false,
        naturalKey: natural,
        hasProspectLink: !!(prospect?.short_url),
        avatarUrl: lead?.avatar_url ?? null,
      });
    }
  }

  // ── Calls depuis un lien Instagram, sans lead DM (sans ig_lead_id) ──────────
  // Ces calls viennent d'un clic sur un lien Short.io posé en description de post,
  // en bio ou dans une story. Ils n'ont pas de lead DM mais apparaissent dans
  // l'onglet IG directement en call_booked.
  if (data) {
    const igLinkCalls = data.calls.filter(c => {
      if (c.ig_lead_id) return false;
      if (c.lead_deleted) return false;
      const src = c.source?.toLowerCase() ?? '';
      // Toute source Instagram, pas une liste figée : `ig_story` manquait ici
      // (le canal story est postérieur à ce code), donc un rendez-vous venu
      // d'une story tombait dans l'onglet « Autres » — constaté le 2026-08-19.
      // Le préfixe couvre aussi ig_dm, dans le cas d'un call sans lead rattaché.
      return src.startsWith('ig_');
    });

    // Regroupement des reprogrammations — même principe que pour les cartes
    // YT/Autres plus bas, mais ce chemin-ci n'avait AUCUN regroupement : il
    // faisait une carte par call. Un prospect qui déplaçait son rendez-vous
    // apparaissait donc deux fois (constaté sur un lien bio, même email).
    //
    // Calendly crée un nouvel événement à chaque report et annule l'ancien ;
    // next_rescheduled_uri porte l'URL de l'invitee du remplaçant, dont on
    // extrait l'UUID pour relier les maillons.
    const igLinkUuidToId = new Map<string, string>();
    for (const c of igLinkCalls) {
      if (c.calendly_event_uuid) igLinkUuidToId.set(c.calendly_event_uuid, c.id);
    }
    const igLinkSuccessor = new Map<string, string>();
    for (const c of igLinkCalls) {
      if (!c.next_rescheduled_uri) continue;
      const nextUuid = c.next_rescheduled_uri.split('/scheduled_events/')[1]?.split('/')[0];
      const nextId = nextUuid ? igLinkUuidToId.get(nextUuid) : undefined;
      if (nextId && nextId !== c.id) igLinkSuccessor.set(c.id, nextId);
    }
    const igLinkChainRoot = (callId: string): string => {
      const seen = new Set<string>([callId]);
      let cur = callId;
      for (;;) {
        const next = igLinkSuccessor.get(cur);
        if (!next || seen.has(next)) return cur;
        seen.add(next);
        cur = next;
      }
    };

    const igLinkGroups = new Map<string, typeof igLinkCalls>();
    for (const c of igLinkCalls) {
      const k = igLinkChainRoot(c.id);
      if (!igLinkGroups.has(k)) igLinkGroups.set(k, []);
      igLinkGroups.get(k)!.push(c);
    }

    for (const groupCalls of igLinkGroups.values()) {
      // Call affiché : le dernier RÉSERVÉ, pas celui dont la date est la plus
      // tardive — un report vers une date antérieure inverse les deux.
      const call = groupCalls.slice().sort((a, b) =>
        new Date(b.booked_at ?? b.scheduled_at).getTime()
        - new Date(a.booked_at ?? a.scheduled_at).getTime()
      )[0];

      const cardKey = `ig_link_${call.id}`;
      const override = effectiveOverrides.find(o => o.prospect_key === cardKey && o.platform === 'ig');

      // Toute la chaîne est passée à la fonction, pas seulement le call affiché :
      // c'est elle qui écarte les reprogrammés et fait gagner un deal conclu sur
      // un rendez-vous plus récent. Un lead venu d'un lien n'a ni DM ni lead
      // magnet — son étape est « RDV pris » dès le départ.
      const state = resolveLeadState({
        signals:      { minStageReached: 'call_booked' },
        calls:        groupCalls,
        manualIssue:  override?.stage ?? null,
        manualReason: override?.reason ?? null,
      }, new Date());

      let badge: CardData['badge'] = null;
      if (state.status === 'active' && call.rescheduled
          && new Date(call.scheduled_at).getTime() < Date.now()) {
        badge = 'rescheduled';
      }

      const stageKey = state.issue ?? state.stage;
      const stageIdx = IG_STAGES.findIndex(s => s.key === state.stage);
      const lastMoveAt = latestOf(...groupCalls.map(c => c.booked_at ?? c.scheduled_at), call.scheduled_at);
      const nextDue = computeNextDue(state, call.scheduled_at, lastMoveAt, new Date());

      // Libellé par canal. Le repli sur « Lien bio » ne vaut que pour ig_bio :
      // avant, tout ce qui n'était pas ig_description héritait de ce libellé,
      // donc une story se serait affichée « Lien bio ».
      const srcLabel = call.source === 'ig_description' ? 'Lien description'
        : call.source === 'ig_story' ? 'Story'
        : call.source === 'ig_dm' ? 'DM'
        : 'Lien bio';

      igCards.push({
        key: cardKey,
        name: call.invitee_name || 'Prospect',
        sub: srcLabel,
        date: timeAgo(call.scheduled_at),
        stageKey,
        stageIdx: stageIdx >= 0 ? stageIdx : 0,
        stage: state.stage,
        issue: state.issue,
        issueReason: state.issueReason,
        rapportEnRetard: state.flags.rapportEnRetard,
        relancesFaites: state.flags.relancesFaites,
        relanceDue: state.flags.relanceDue,
        lastMoveAt,
        nextDue,
        badge,
        lmClickedAt: null,
        callId: call.id,
        callScheduledAt: call.scheduled_at,
        callStatus: call.status,
        callOutcome: call.outcome ?? null,
        callRevenue: call.revenue ?? null,
        callComment: call.lead_rapport_comment ?? null,
        callIsFollowUp: call.is_follow_up ?? false,
        naturalKey: state.stage,
        hasProspectLink: false,
        avatarUrl: null,
        isIgLink: true,
      });
    }
  }

  // ── Build YT / Autres cards ──────────────────────────────────────────────────
  // On groupe les calls par prospect_id (fiche persistante) ou par call.id (fallback ancien call)
  // pour que les rebooks d'un même lead ne créent pas deux cartes distinctes.

  const ytCards: CardData[] = [];
  const otherCards: CardData[] = [];
  if (data) {
    // Map prospect_id → calls (trié par scheduled_at desc pour prendre le plus récent)
    const nonIgCalls = data.calls.filter(c => {
      if (c.ig_lead_id) return false;
      if (c.lead_deleted) return false;
      const src = c.source?.toLowerCase() ?? '';
      if (src.startsWith('ig')) return false;
      return true;
    });

    // Chaîne des reprogrammations : quand un prospect déplace son rendez-vous,
    // Calendly crée un NOUVEL événement (nouvel UUID) et annule l'ancien. Sans
    // rattachement, les deux formaient deux cartes distinctes pour la même
    // personne — constaté avec un prospect apparaissant deux fois dans le
    // pipeline après un simple report.
    //
    // `next_rescheduled_uri` porte l'URL de l'invitee du call suivant, dont on
    // extrait son UUID. On remonte ensuite chaque chaîne jusqu'à sa racine pour
    // que tous les maillons partagent la même clé de groupe.
    //
    // prospect_id reste prioritaire quand il existe : c'est la fiche persistante,
    // elle regroupe aussi les rebooks sans lien de reprogrammation.
    const uuidToCallId = new Map<string, string>();
    for (const call of nonIgCalls) {
      if (call.calendly_event_uuid) uuidToCallId.set(call.calendly_event_uuid, call.id);
    }
    // callId -> callId du call qui le REMPLACE
    const successorOf = new Map<string, string>();
    for (const call of nonIgCalls) {
      if (!call.next_rescheduled_uri) continue;
      // .../scheduled_events/<uuid>/invitees/<uuid-invitee>
      const nextUuid = call.next_rescheduled_uri.split('/scheduled_events/')[1]?.split('/')[0];
      const nextCallId = nextUuid ? uuidToCallId.get(nextUuid) : undefined;
      if (nextCallId && nextCallId !== call.id) successorOf.set(call.id, nextCallId);
    }
    // Racine de la chaîne : on suit les successeurs jusqu'au dernier call.
    // `seen` protège d'une boucle si les données étaient incohérentes.
    const chainRoot = (callId: string): string => {
      const seen = new Set<string>([callId]);
      let cur = callId;
      for (;;) {
        const next = successorOf.get(cur);
        if (!next || seen.has(next)) return cur;
        seen.add(next);
        cur = next;
      }
    };

    // Grouper par prospect_id quand disponible, sinon par racine de chaîne de
    // reprogrammation (qui vaut call.id pour un call jamais reprogrammé).
    const prospectGroups = new Map<string, typeof nonIgCalls>();
    for (const call of nonIgCalls) {
      const groupKey = call.prospect_id ?? chainRoot(call.id);
      if (!prospectGroups.has(groupKey)) prospectGroups.set(groupKey, []);
      prospectGroups.get(groupKey)!.push(call);
    }

    for (const [prospectKey, calls] of prospectGroups) {
      // Call à afficher : le dernier RÉSERVÉ (booked_at), pas celui dont la date
      // est la plus tardive.
      //
      // Un report vers une date ANTÉRIEURE inverse les deux : le nouveau call a
      // le booked_at le plus récent mais un scheduled_at plus ancien que celui
      // qu'il remplace. Trier sur scheduled_at affichait alors l'ancien rendez-vous
      // (annulé) à la place du nouveau — cas reproduit avec un report du 19/08
      // 21:00 vers le 18/08 21:45.
      //
      // Repli sur scheduled_at quand booked_at manque (calls antérieurs au champ).
      const latestCall = calls.slice().sort((a, b) =>
        new Date(b.booked_at ?? b.scheduled_at).getTime()
        - new Date(a.booked_at ?? a.scheduled_at).getTime()
      )[0];

      const effectiveSrc = latestCall.source?.toLowerCase() ?? '';
      const platform: 'yt' | 'other' = effectiveSrc.startsWith('yt') ? 'yt' : 'other';

      const override = effectiveOverrides.find(o => o.prospect_key === prospectKey && o.platform === platform);

      // Troisième et dernière cascade unifiée. YouTube n'a qu'une étape : le lead
      // arrive par un lien Calendly en description, sans DM ni lead magnet. Tout
      // son parcours se joue donc dans les issues.
      const state = resolveLeadState({
        signals:      { minStageReached: 'call_booked' },
        calls,
        manualIssue:  override?.stage ?? null,
        manualReason: override?.reason ?? null,
      }, new Date());

      const stageKey = state.issue ?? state.stage;
      const stageIdx = YT_STAGES.findIndex(s => s.key === state.stage);

      let badge: CardData['badge'] = null;
      if (state.status === 'active' && latestCall.rescheduled
          && new Date(latestCall.scheduled_at).getTime() < Date.now()) {
        badge = 'rescheduled';
      }

      const noSource = !latestCall.source && !latestCall.utm_medium && !latestCall.utm_content;

      const ytSource = resolveYtSource(latestCall, data.ytVideoTitles);
      const sub = ytSource.title
        ? (ytSource.title.length > 35 ? `${ytSource.title.slice(0, 35)}…` : ytSource.title)
        : ytSource.label;

      const card: CardData = {
        key: prospectKey,
        name: latestCall.invitee_name || 'Prospect',
        sub,
        date: timeAgo(latestCall.scheduled_at),
        stageKey,
        stageIdx: stageIdx >= 0 ? stageIdx : 0,
        stage: state.stage,
        issue: state.issue,
        issueReason: state.issueReason,
        rapportEnRetard: state.flags.rapportEnRetard,
        relancesFaites: state.flags.relancesFaites,
        relanceDue: state.flags.relanceDue,
        lastMoveAt: latestOf(...calls.map(c => c.booked_at ?? c.scheduled_at)),
        nextDue: computeNextDue(state, latestCall.scheduled_at,
                  latestOf(...calls.map(c => c.booked_at ?? c.scheduled_at)), new Date()),
        extra: latestCall.revenue ? `${latestCall.revenue.toLocaleString('fr-FR')} €` : undefined,
        noSource,
        badge,
        callId: latestCall.id,
        callScheduledAt: latestCall.scheduled_at,
        callStatus: latestCall.status,
        callOutcome: latestCall.outcome ?? null,
        callRevenue: latestCall.revenue ?? null,
        callComment: latestCall.lead_rapport_comment ?? null,
        naturalKey: state.stage,
        hasProspectLink: false,
        avatarUrl: null,
      };

      if (noSource) {
        otherCards.push({ ...card, noSource: false });
      } else {
        ytCards.push(card);
      }
    }
  }

  // Retire noSource des confirmés. Le filtre `dismissed` a disparu avec le
  // mécanisme lui-même : zéro ligne en base en un an d'usage, et « Ce n'est pas
  // un lead » (not_a_lead) couvrait déjà le besoin.
  const filteredYtCards = ytCards
    .map(c => confirmedKeys.has(c.key) ? { ...c, noSource: false } : c);

  const filteredOtherCards = otherCards;

  const stages = tab === 'ig' ? IG_STAGES : YT_STAGES;
  // Les colonnes affichées = les étapes, puis les issues. Deux natures sur une
  // seule rangée, mais deux axes distincts : `stages` reste la progression
  // ordonnée (c'est elle que la carte affiche en jauge), `columns` n'est que
  // l'ordre de lecture à l'écran.
  const columns: readonly ColumnDef[] =
    [...stages, ...ISSUES];
  const platform = tab;

  // Filtres IG, cumulés en UNION et non en intersection.
  //
  // L'ancienne version enchaînait des `if (filtre && carte ne correspond pas)
  // return false`. Deux filtres actifs donnaient donc toujours une liste vide :
  // une carte ne porte qu'un badge à la fois, elle ne pouvait pas satisfaire les
  // deux conditions. Aucun filtre actif = tout passe.
  //
  // No-shows, Pas qualifiés et À recontacter ont été retirés : ce sont des
  // colonnes du kanban depuis la refonte, et un bouton qui filtre le contenu
  // d'une colonne déjà visible est le même geste en deux endroits.
  const isCanceled = (c: CardData) => {
    const call = data?.calls.find(ca => ca.id === c.callId);
    return !!call && ['canceled', 'cancelled'].includes(call.status ?? '');
  };
  const filtresActifs: ((c: CardData) => boolean)[] = [];
  if (filterCanceled)    filtresActifs.push(isCanceled);
  if (filterRescheduled) filtresActifs.push(c => c.badge === 'rescheduled');

  const filteredIgCards = filtresActifs.length === 0
    ? igCards
    : igCards.filter(c => filtresActifs.some(f => f(c)));

  const cards = tab === 'ig' ? filteredIgCards : tab === 'yt' ? filteredYtCards : filteredOtherCards;

  // ── Suppression lead ────────────────────────────────────────────────────────

  const handleDeleteLead = useCallback(async (cardKey: string, callId?: string | null) => {
    const isUUID = /^[0-9a-f-]{36}$/.test(cardKey);
    let body: Record<string, any>;
    if (!isUUID) {
      // IG : cardKey = ig_username
      body = { ig_username: cardKey, platform: tab };
    } else if (cardKey === callId) {
      // YT/Autre fallback : pas de prospect, cardKey IS le call.id
      body = { call_id: cardKey, platform: tab };
    } else {
      // YT/Autre normal : cardKey = prospect_id, callId = call.id
      body = { prospect_id: cardKey, call_id: callId ?? null, platform: tab };
    }
    // La réponse était ignorée : un refus du serveur (ex: prospect avec un deal signé,
    // renvoyé en 409) passait inaperçu et la carte semblait simplement ne pas partir.
    const res = await fetch('/api/client/pipeline', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => null);
      setDeleteError(payload?.error ?? "La suppression a échoué. Réessaie dans un instant.");
      return;
    }
    await refetch();
  }, [refetch, tab]);

  // ── Marquage "pas un lead" (faux positif) ───────────────────────────────────

  const handleNotALead = useCallback(async (cardKey: string, callId?: string | null) => {
    const isUUID = /^[0-9a-f-]{36}$/.test(cardKey);
    let body: Record<string, any>;
    if (!isUUID) {
      // IG : cardKey = ig_username
      body = { ig_username: cardKey, not_a_lead: true };
    } else if (cardKey === callId) {
      // Le rendez-vous n'a aucune fiche prospect derrière lui. Ce chemin ne
      // faisait RIEN auparavant — le geste échouait en silence sur les cartes
      // « Source inconnue », qui sont justement celles qui le proposent. Le
      // serveur exclut le call par `ignored`.
      body = { call_id: callId, not_a_lead: true };
    } else {
      // YT/Autre normal : cardKey = prospect_id
      body = { prospect_id: cardKey, not_a_lead: true };
    }
    await mutate('/api/client/pipeline', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      erreur: "La modification n'a pas pu être enregistrée.",
    });
    await refetch();
  }, [refetch]);

  // ── Actions en lot (vue liste) ──────────────────────────────────────────────
  //
  // Chaque lead est traité séparément côté serveur : il n'existe pas d'API de
  // lot, et en inventer une pour ce seul écran serait une pièce de plus à
  // maintenir. Le prix, c'est N requêtes — acceptable sur une sélection faite à
  // la main, où l'ordre de grandeur est la dizaine.
  //
  // ⚠️ Un échec partiel ne doit JAMAIS passer pour un succès. On compte les
  // échecs et on le dit : sans ça, supprimer 5 leads dont 2 refusés par le
  // serveur afficherait le même écran qu'une réussite complète.

  const executerEnLot = useCallback(async (
    keys: string[],
    action: (key: string) => Promise<boolean>,
    verbe: string,
  ) => {
    const resultats = await Promise.all(keys.map(async k => {
      try { return await action(k); } catch { return false; }
    }));
    const echecs = resultats.filter(r => !r).length;
    if (echecs > 0) {
      setDeleteError(
        echecs === keys.length
          ? `Aucun lead n'a pu être ${verbe}. Réessaie dans un instant.`
          : `${echecs} lead${echecs > 1 ? 's' : ''} sur ${keys.length} n'${echecs > 1 ? 'ont' : 'a'} pas pu être ${verbe}. Les autres sont bien traités.`,
      );
    }
    await refetch();
  }, [refetch]);

  const cardsByKey = useCallback((key: string) => cards.find(c => c.key === key), [cards]);

  const handleBulkDelete = useCallback(async (keys: string[]) => {
    await executerEnLot(keys, async key => {
      const card = cardsByKey(key);
      const isUUID = /^[0-9a-f-]{36}$/.test(key);
      const callId = card?.callId ?? null;
      const body = !isUUID
        ? { ig_username: key, platform: tab }
        : key === callId
          ? { call_id: key, platform: tab }
          : { prospect_id: key, call_id: callId, platform: tab };
      const res = await fetch('/api/client/pipeline', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return res.ok;
    }, 'supprimé');
  }, [executerEnLot, cardsByKey, tab]);

  const handleBulkNotALead = useCallback(async (keys: string[]) => {
    await executerEnLot(keys, async key => {
      const card = cardsByKey(key);
      const isUUID = /^[0-9a-f-]{36}$/.test(key);
      const callId = card?.callId ?? null;
      const body = !isUUID
        ? { ig_username: key, not_a_lead: true }
        : key === callId
          ? { call_id: key, not_a_lead: true }
          : { prospect_id: key, not_a_lead: true };
      const res = await fetch('/api/client/pipeline', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return res.ok;
    }, 'retiré');
  }, [executerEnLot, cardsByKey, tab]);

  const handleBulkRelance = useCallback(async (keys: string[]) => {
    await executerEnLot(keys, async key => {
      const res = await fetch('/api/client/pipeline/relance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prospect_key: key, platform: tab }),
      });
      return res.ok;
    }, 'marqué relancé');
  }, [executerEnLot, tab]);

  // ── Drag & drop + modale de confirmation ────────────────────────────────────

  const handleDragStart = (e: React.DragEvent, cardKey: string) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', cardKey);
    setTimeout(() => setDraggingKey(cardKey), 0);
  };

  const handleDragEnd = () => { setDraggingKey(null); setDropTarget(null); dropCounters.current = {}; };

  const handleDragOver = (e: React.DragEvent, stageKey: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget(stageKey);
  };

  const handleDragEnter = (stageKey: string) => {
    dropCounters.current[stageKey] = (dropCounters.current[stageKey] || 0) + 1;
    setDropTarget(stageKey);
  };

  const handleDragLeave = (stageKey: string) => {
    dropCounters.current[stageKey] = (dropCounters.current[stageKey] || 1) - 1;
    if ((dropCounters.current[stageKey] || 0) <= 0) {
      setDropTarget(prev => prev === stageKey ? null : prev);
    }
  };

  const handleDrop = (e: React.DragEvent, targetStageKey: string) => {
    e.preventDefault();
    const cardKey = e.dataTransfer.getData('text/plain');
    if (!cardKey) return;
    setDraggingKey(null);
    setDropTarget(null);
    dropCounters.current = {};

    const card = cards.find(c => c.key === cardKey);
    if (!card) return;

    const activeStages = tab === 'ig' ? IG_STAGES : YT_STAGES;
    const currentStageIdx = activeStages.findIndex(s => s.key === card.stageKey);
    const targetStageIdx  = activeStages.findIndex(s => s.key === targetStageKey);

    // Ne rien faire si on drop sur la même colonne
    if (card.stageKey === targetStageKey) return;

    const targetStageLabel = activeStages.find(s => s.key === targetStageKey)?.label ?? targetStageKey;
    const naturalKey = card.naturalKey;
    const currentStageKey = card.stageKey;

    // Déterminer le type de mouvement
    const isBackwardPreCall =
      tab === 'ig' &&
      PRE_CALL_STAGES.has(targetStageKey as any) &&
      targetStageIdx < currentStageIdx;
    const isForwardPreCall =
      tab === 'ig' &&
      PRE_CALL_STAGES.has(targetStageKey as any) &&
      targetStageKey !== 'lm_sent' &&
      targetStageIdx > currentStageIdx;
    const isBackwardFromPostCall =
      POST_CALL_STAGES.has(card.stageKey) && targetStageIdx < currentStageIdx;
    const isForwardToCallBooked = targetStageKey === 'call_booked' && !card.callId;
    const isForwardToClosed     = targetStageKey === 'closed';

    // Bloquer si le lead n'a pas de lien Calendly généré et qu'on tente de l'avancer vers calendly_sent / link_clicked / call_booked
    const NEEDS_PROSPECT_LINK = new Set(['calendly_sent', 'link_clicked', 'call_booked']);
    if (NEEDS_PROSPECT_LINK.has(targetStageKey) && !card.hasProspectLink && targetStageIdx > currentStageIdx) {
      setConfirmModal({ case: 'no_prospect_link', cardKey, cardName: card.name, targetStageKey, targetStageLabel, currentStageKey, callId: card.callId ?? null, naturalKey });
      return;
    }

    if (isBackwardPreCall) {
      setConfirmModal({ case: 'backward_pre_call', cardKey, cardName: card.name, targetStageKey, targetStageLabel, currentStageKey, callId: card.callId ?? null, naturalKey });
      return;
    }
    if (isForwardPreCall) {
      setConfirmModal({ case: 'forward_pre_call', cardKey, cardName: card.name, targetStageKey, targetStageLabel, currentStageKey, callId: card.callId ?? null, naturalKey });
      return;
    }
    if (isBackwardFromPostCall) {
      setConfirmModal({ case: 'backward_from_post_call', cardKey, cardName: card.name, targetStageKey, targetStageLabel, currentStageKey, callId: card.callId ?? null, naturalKey });
      return;
    }
    if (isForwardToCallBooked) {
      setConfirmModal({ case: 'forward_to_call_booked', cardKey, cardName: card.name, targetStageKey, targetStageLabel, currentStageKey, callId: card.callId ?? null, naturalKey });
      return;
    }
    // Le cas « avancée manuelle vers Show up » a disparu avec sa colonne : dire
    // « il est venu » n'est pas un résultat, et cette modale promettait d'écrire
    // sur le rendez-vous sans rien écrire (bug 5). Un RDV passé sans rapport se
    // signale désormais tout seul, par le drapeau rapportEnRetard.
    if (isForwardToClosed) {
      setConfirmModal({ case: 'forward_to_closed', cardKey, cardName: card.name, targetStageKey, targetStageLabel, currentStageKey, callId: card.callId ?? null, naturalKey });
      return;
    }

    // Tous les autres mouvements → modale simple
    setConfirmModal({ case: 'simple_move', cardKey, cardName: card.name, targetStageKey, targetStageLabel, currentStageKey, callId: card.callId ?? null, naturalKey });
  };

  const handleConfirmMove = async (reason: string, extraData?: Record<string, any>) => {
    if (!confirmModal) return;
    const { case: modalCase, cardKey, targetStageKey, callId, naturalKey } = confirmModal;
    setConfirmModal(null);

    if (modalCase === 'backward_pre_call') {
      // Pas de rollback ici : rien n'a ete modifie a l'ecran avant l'appel,
       // c'est le refetch qui rafraichira. Le risque n'est donc pas un
       // affichage divergent mais un echec TOTALEMENT invisible — le lead ne
       // bouge pas et l'utilisateur ignore pourquoi. `mutate` le signale.
      await mutate('/api/client/pipeline/reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ig_username: cardKey, target_stage: targetStageKey }),
        erreur: "Le lead n'a pas pu être ramené à cette étape.",
      });
      setOverrides(prev => prev.filter(o => !(o.prospect_key === cardKey && o.platform === 'ig')));
      await refetch();
      return;
    }

    if (modalCase === 'forward_pre_call') {
      // Injection des signaux réels correspondant au stage cible
      await mutate('/api/client/pipeline/advance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ig_username: cardKey, target_stage: targetStageKey, current_stage: confirmModal.currentStageKey }),
        erreur: "Le lead n'a pas pu être avancé à cette étape.",
      });
      setOverrides(prev => prev.filter(o => !(o.prospect_key === cardKey && o.platform === 'ig')));
      await refetch();
      return;
    }

    if (modalCase === 'backward_from_post_call') {
      if (callId) {
        // Le serveur refuse ce recul quand l'appel porte un deal signé : reculer la
        // carte supprimerait le call (ignored=true) et ferait disparaître le chiffre
        // d'affaires des stats. On montre alors la même modale explicite que la
        // suppression d'un prospect, et on n'avance pas — sinon la carte reculerait
        // à l'écran alors que le call est toujours là en base.
        const res = await fetch(`/api/client/calls/${callId}`, { method: 'DELETE' });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          setDeleteError(data?.error ?? "Le call n'a pas pu être supprimé.");
          return;
        }
      }
      let bestStage: string;
      if (tab === 'ig') {
        const lead = data?.leads.find(l => l.ig_username.toLowerCase() === cardKey);
        const prospect = data?.prospects.find(p => p.ig_username.toLowerCase() === cardKey);
        bestStage = getBestKnownStage(prospect, lead, events);
      } else {
        bestStage = 'call_booked';
      }
      await saveOverride(cardKey, platform, bestStage, reason, naturalKey);
    } else if (modalCase === 'forward_to_call_booked') {
      // Créer un vrai call en DB avec les infos saisies dans la modale
      await mutate('/api/client/calls', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        erreur: "Le call n'a pas pu être créé.",
        body: JSON.stringify({
          ig_username: cardKey,
          scheduled_at: extraData?.scheduledAt,
          duration: extraData?.duration ? `${extraData.duration} min` : '60 min',
          invitee_name: extraData?.inviteeName ?? cardKey,
          invitee_email: extraData?.inviteeEmail ?? null,
          call_type: 'manual',
          manual_override: true,
          source: 'ig',
        }),
      });
    } else if (modalCase === 'forward_to_closed') {
      // `outcome: 'closed'` en plus de `deal_closed` : c'est l'outcome que lit
      // resolveLeadState pour choisir la colonne. Sans lui, le call restait sans
      // résultat, l'issue calculée était nulle, et le lead repassait en « RDV
      // pris » juste après avoir été marqué closé — l'override étant masqué par
      // le call, qui a toujours la priorité.
      if (callId) await patchCall(callId, { deal_closed: true, outcome: 'closed', revenue: extraData?.revenue ?? null });
      await saveOverride(cardKey, platform, 'closed', 'manual', naturalKey);
    } else if (modalCase === 'simple_move') {
      // Classer à la main un lead QUI A UN RENDEZ-VOUS demande d'écrire aussi le
      // résultat sur le call. Le call a toujours la priorité sur l'override
      // (règle 1 de resolveLeadState) : sans cette écriture, le classement
      // resterait invisible et la carte reviendrait aussitôt en « RDV pris ».
      const issue = ISSUE_KEYS.find(k => k === targetStageKey);
      if (issue && callId) {
        await patchCall(callId, ISSUE_TO_OUTCOME[issue]);
      }
      await saveOverride(cardKey, platform, targetStageKey, 'manual', naturalKey);
    }

    await refetch();
  };

  // Prospects de l'onglet affiché — sert à l'état vide ("aucun prospect ici").
  const tabProspects = cards.length;
  // Total toutes plateformes confondues, affiché en sous-titre : le chiffre ne doit pas
  // changer quand on passe d'un onglet à l'autre, sinon il se lit comme un total alors
  // qu'il ne compte que l'onglet courant (demande Chris, 2026-08-19).
  const totalProspects = filteredIgCards.length + filteredYtCards.length + filteredOtherCards.length;
  const activeFilterCount = [filterCanceled, filterRescheduled].filter(Boolean).length;
  const anyFilter = activeFilterCount > 0;

  return (
    <div
      className="page-content pipeline-page"
      // gap en CSS et non en inline : sur mobile il descend a 10px pour rendre
      // ~18px a l'entonnoir. Un style inline ne serait jamais atteint par la
      // media query.
      style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}
      onDragEnd={handleDragEnd}
    >
      {/* Header */}
      {/* flexWrap : sur 375px, le titre et le groupe d'actions ne tiennent pas
          cote a cote — sans repli le titre se coupait en deux lignes et le
          sous-titre s'etirait en colonne d'un mot. */}
      {/* position relative : ancre le bouton "Rafraichir" que la vue mobile
          sort du flux pour le remonter en haut a droite. */}
      <div className="pipeline-header" style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, flexWrap: 'wrap', rowGap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <h1 className="page-title" style={{ marginBottom: 2 }}>Pipeline Leads</h1>
          <p className="page-sub" style={{ fontSize: 12 }}>
            {loading ? 'Chargement…' : `${totalProspects} prospect${totalProspects !== 1 ? 's' : ''}`}
          </p>
          {!loading && (
            <p className="page-sub pipeline-desktop" style={{ fontSize: 11, marginTop: 2 }}>
              Le pipeline se met à jour tout seul · glisse une carte pour la déplacer, le système reprendra sa position dès qu&apos;un nouvel événement sera détecté
            </p>
          )}
        </div>

        {/* pipeline-actions : sur mobile, "Rafraichir" et les 3 onglets ne
            tiennent pas cote a cote (mesure a 375px : 388px de contenu).
            Plutot que de compresser les onglets, le bouton remonte a cote du
            titre (order: -1 + position absolue) et les onglets prennent toute
            la largeur en pilules. */}
        <div className="pipeline-actions" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Board ou Liste — desktop seulement : sur mobile l'entonnoir tient
              déjà ce rôle, et un kanban ne se manipule pas au doigt (le
              glisser-déposer HTML5 ne se déclenche pas au tactile). */}
          <div className="pipeline-desktop" style={{
            display: 'flex', background: 'var(--surface-2, #f7f4ec)',
            border: '1px solid var(--border)', borderRadius: 10, padding: 3, gap: 3,
          }}>
            {([['board', 'Board'], ['liste', 'Liste']] as const).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => changerVue(k)}
                aria-pressed={vue === k}
                style={{
                  fontSize: 11.5, fontWeight: 600, borderRadius: 6, padding: '5px 12px',
                  border: 'none', cursor: 'pointer',
                  background: vue === k ? 'var(--surface)' : 'transparent',
                  color: vue === k ? 'var(--ink)' : 'var(--muted)',
                  boxShadow: vue === k ? '0 1px 2px rgba(0,0,0,.04)' : 'none',
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="pipeline-refresh"
            style={{
              padding: '6px 14px', fontSize: 12, fontWeight: 600, borderRadius: 8,
              border: '1px solid var(--border)', background: 'var(--surface)',
              color: refreshing ? 'var(--muted)' : 'var(--ink)', cursor: refreshing ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 6, transition: 'all .12s',
            }}
          >
            <span style={{ display: 'inline-block', animation: refreshing ? 'spin 1s linear infinite' : 'none' }}>↻</span>
            {refreshing ? 'Maj…' : 'Rafraîchir'}
          </button>
          {/* pipeline-tabs : sur mobile ce groupe passe en grille 3 colonnes
              egales. En flex simple, les trois libelles cumulaient plus de
              375px et "Autres" sortait de l'ecran (constate au navigateur). */}
          <div className="pipeline-tabs" style={{ display: 'flex', borderRadius: 8, padding: 3, gap: 2 }}>
            {([
              { key: 'ig', label: 'Instagram', count: igCards.length },
              { key: 'yt', label: 'YouTube', count: filteredYtCards.length },
              { key: 'other', label: 'Autres', count: filteredOtherCards.length },
            ] as const).map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                // is-active plutot qu'un style inline conditionnel : sur mobile
                // l'onglet actif devient une pilule pleine en accent, ce qu'une
                // media query ne pourrait pas surcharger depuis l'inline.
                className={`pipeline-tab${tab === t.key ? ' is-active' : ''}`}
                style={{
                  fontSize: 12, fontWeight: 600, borderRadius: 6,
                  cursor: 'pointer', border: 'none', transition: 'all .12s',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                {/* Enveloppe pour que la troncature mobile puisse s'y appliquer :
                    un noeud texte nu n'est pas atteignable en CSS. */}
                <span className="pipeline-tab-label">{t.label}</span>
                <span className="pipeline-tab-count" style={{
                  fontSize: 10, fontWeight: 700, minWidth: 16, height: 16,
                  borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px',
                }}>{t.count}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Filtres IG */}
      {/* Sur mobile les 6 filtres occupent deux rangees pleines, soit ~80px pris
          sur un budget vertical de ~620px — assez pour pousser la fin de
          l'entonnoir hors ecran. Ils sont secondaires : on vient lire
          l'entonnoir, pas filtrer. D'ou le repli, avec le nombre de filtres
          actifs sur le bouton pour qu'un filtrage en cours reste visible meme
          replie. Le desktop les affiche toujours (.pipeline-desktop). */}
      {tab === 'ig' && (
        <button
          type="button"
          className="pipeline-filters-toggle"
          onClick={() => setFiltersOpen(o => !o)}
          aria-expanded={filtersOpen}
        >
          <span>Filtres</span>
          {activeFilterCount > 0 && (
            <span className="pipeline-filters-count">{activeFilterCount}</span>
          )}
          <Icon name="chevR" size={13} style={{ transform: filtersOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s', marginLeft: 'auto' }} />
        </button>
      )}
      {tab === 'ig' && (
        <div
          className={`pipeline-filters${filtersOpen ? ' is-open' : ''}`}
          style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap' }}
        >
          {[
            // No-shows / Pas qualifiés / À recontacter sont devenus des colonnes,
            // et Archivés reposait sur un mécanisme jamais utilisé (0 ligne en
            // base). Restent les deux états du RENDEZ-VOUS, qui n'ont pas de
            // colonne parce qu'ils ne disent rien du résultat du lead : la carte
            // reste en « RDV pris » et seul ce bouton permet de la retrouver.
            { key: 'canceled', label: 'Annulés', value: filterCanceled, set: setFilterCanceled, color: '#7C3AED', bg: '#F5F3FF' },
            { key: 'rescheduled', label: 'Reportés', value: filterRescheduled, set: setFilterRescheduled, color: '#d97706', bg: '#fffbeb' },
          ].map(f => (
            <button
              key={f.key}
              onClick={() => f.set(!f.value)}
              className="pipeline-filter"
              style={{
                fontWeight: 600, borderRadius: 6, cursor: 'pointer',
                border: `1px solid ${f.value ? f.color : 'var(--border)'}`,
                background: f.value ? f.bg : 'transparent',
                color: f.value ? f.color : 'var(--muted)',
                transition: 'all .12s',
              }}
            >
              {f.label}
            </button>
          ))}
          {anyFilter && (
            <button
              onClick={() => { setFilterCanceled(false); setFilterRescheduled(false); }}
              className="pipeline-filter"
              style={{ fontWeight: 500, borderRadius: 6, cursor: 'pointer', border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)' }}
            >
              Effacer filtres
            </button>
          )}
        </div>
      )}

      {/* Bloque pointer events sur les cartes non-draggées pendant un drag */}
      {draggingKey && (
        <style>{`[data-pipeline-card] { pointer-events: none !important; }`}</style>
      )}

      {/* Kanban board */}
      {loading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <InlineLoader />
        </div>
      ) : (
        <>
        {/* Vue mobile : entonnoir en consultation. Le kanban ci-dessous n'est pas
            utilisable au doigt (le glisser-deposer HTML5 ne se declenche pas au
            tactile) et ses 8 colonnes demandent de defiler lateralement.
            Bascule purement CSS a 767px : le desktop reste inchange. */}
        <div className="pipeline-mobile" style={{ flex: 1, overflowY: 'auto', paddingBottom: 16 }}>
          <PipelineFunnelMobile
            cards={cards}
            stages={stages}
            issues={ISSUES}
            onCardClick={cardKey => setDetailModal({ cardKey, platform: tab })}
          />
        </div>

        {vue === 'liste' ? (
          <div className="pipeline-desktop" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', paddingBottom: 16 }}>
            <PipelineListView
              cards={cards}
              columns={columns}
              stageKeys={stages.map(s => s.key)}
              avatarColor={avatarColor}
              avatarInitials={avatarInitials}
              onCardClick={cardKey => setDetailModal({ cardKey, platform: tab })}
              onRapportClick={c => c.callId && setRapportModal({
                callId: c.callId,
                inviteeName: c.name,
                scheduledAt: c.callScheduledAt ?? '',
                isFollowUp: c.callIsFollowUp ?? false,
                existing: { revenue: c.callRevenue ?? null, comment: c.callComment ?? null },
              })}
              onBulkDelete={handleBulkDelete}
              onBulkNotALead={handleBulkNotALead}
              onBulkRelance={handleBulkRelance}
            />
          </div>
        ) : (
        <div className="pipeline-desktop" style={{ flex: 1, overflowX: 'auto', overflowY: 'auto', paddingBottom: 16, scrollbarWidth: 'thin', scrollbarColor: 'var(--border) transparent' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'stretch', minWidth: 'max-content', height: '100%' }}>
            {columns.map(stage => {
              // On range par `stageKey`, qui vaut l'ISSUE quand le lead est classé
              // et l'ÉTAPE sinon. L'ancien filtrage passait par `stageIdx`, un
              // index dans le tableau des étapes — il ne pouvait donc pas
              // désigner une issue, qui n'a pas de position sur cet axe.
              const stageCards = cards.filter(c => c.stageKey === stage.key);
              return (
                <KanbanColumn
                  key={stage.key}
                  stage={stage}
                  cards={stageCards}
                  stages={stages}
                  draggingKey={draggingKey}
                  isDropTarget={dropTarget === stage.key}
                  onDragStart={handleDragStart}
                  onDrop={handleDrop}
                  onDragOver={e => handleDragOver(e, stage.key)}
                  onDragLeave={e => handleDragLeave(stage.key)}
                  platform={platform}
                  onConfirmLead={key => { setConfirmedKeys(prev => new Set([...prev, key])); saveOverride(key, platform, 'confirmed_lead'); }}
                  onDeleteLead={handleDeleteLead}
                  onNotALead={handleNotALead}
                  onRapportClick={(callId, inviteeName, scheduledAt, isFollowUp, existing) => setRapportModal({ callId, inviteeName, scheduledAt, isFollowUp, existing })}
                  onCardClick={cardKey => setDetailModal({ cardKey, platform })}
                />
              );
            })}
          </div>
        </div>
        )}
        </>
      )}

      {/* Empty state — sur l'onglet affiché (son message le nomme : "Aucun lead
          Instagram", "Aucun call YouTube"…), pas sur le total toutes plateformes. */}
      {/* pipeline-desktop : sur mobile l'entonnoir affiche deja "0" sur chaque
          etape, donc l'etat vide fait doublon — et surtout il occupait la
          hauteur, ecrasant l'entonnoir a 226px pour 535px de contenu. */}
      {!loading && tabProspects === 0 && (
        <div className="pipeline-desktop" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, paddingTop: 60, paddingBottom: 60 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>
              {tab === 'ig' ? 'Aucun lead Instagram' : tab === 'yt' ? 'Aucun call YouTube' : 'Aucun call sans source'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, maxWidth: 260 }}>
              {tab === 'ig'
                ? 'Les prospects apparaissent ici dès qu\'ils reçoivent ton lead magnet en DM.'
                : tab === 'yt'
                ? 'Les calls bookés depuis tes liens YouTube description apparaissent ici.'
                : 'Les calls sans source tracée (bio directe, bouche à oreille, etc.) apparaissent ici.'}
            </div>
          </div>
        </div>
      )}

      {/* Modale de confirmation drag-and-drop */}
      {confirmModal && (
        <ConfirmMoveModal
          case={confirmModal.case}
          cardName={confirmModal.cardName}
          targetStageKey={confirmModal.targetStageKey}
          targetStageLabel={confirmModal.targetStageLabel}
          currentStageKey={confirmModal.currentStageKey}
          callId={confirmModal.callId}
          onConfirm={handleConfirmMove}
          onCancel={() => setConfirmModal(null)}
        />
      )}

      {/* Suppression refusée par le serveur (prospect avec un deal signé) */}
      {deleteError && createPortal(
        <>
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 10001 }} onMouseDown={() => setDeleteError(null)} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            zIndex: 10002, background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 12, padding: '24px 28px', maxWidth: 420, boxShadow: '0 8px 32px rgba(0,0,0,.18)',
          }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Suppression impossible</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 20, lineHeight: 1.55 }}>{deleteError}</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onMouseDown={() => setDeleteError(null)}
                style={{ padding: '7px 16px', fontSize: 12, fontWeight: 600, borderRadius: 7, border: 'none', background: '#2563EB', color: '#fff', cursor: 'pointer' }}
              >
                J&apos;ai compris
              </button>
            </div>
          </div>
        </>,
        document.body
      )}

      {/* Rapport modal ouvert directement depuis le pipeline */}
      {rapportModal && (
        <RapportModal
          callId={rapportModal.callId}
          inviteeName={rapportModal.inviteeName}
          scheduledAt={rapportModal.scheduledAt}
          isFollowUp={rapportModal.isFollowUp}
          existing={rapportModal.existing}
          onClose={() => { setRapportModal(null); refetch(); }}
        />
      )}

      {/* Modal détail prospect — timeline chronologique */}
      {detailModal && data && (() => {
        const ctx = resolveProspectContext(detailModal.cardKey, detailModal.platform, data);
        if (!ctx) return null;
        const detailStages = detailModal.platform === 'ig' ? IG_STAGES : YT_STAGES;
        const sourceCards = detailModal.platform === 'ig' ? igCards : detailModal.platform === 'yt' ? filteredYtCards : filteredOtherCards;
        const matchedCard = sourceCards.find(c => c.key === detailModal.cardKey);
        const stageIdx = matchedCard ? matchedCard.stageIdx : 0;
        const stage = detailStages[stageIdx] ?? detailStages[0];
        const displayName = matchedCard
          ? (detailModal.platform === 'ig' && !matchedCard.isIgLink ? `@${matchedCard.name}` : matchedCard.name)
          : (ctx.lead?.ig_username ? `@${ctx.lead.ig_username}` : ctx.calls[0]?.invitee_name || 'Prospect');
        return (
          <ProspectDetailModal
            context={ctx}
            displayName={displayName}
            stageLabel={stage.label}
            stageColor={stage.color}
            onClose={() => setDetailModal(null)}
          />
        );
      })()}
    </div>
  );
}
