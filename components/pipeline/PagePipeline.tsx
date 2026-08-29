'use client';

import { type RapportExistant } from '@/lib/rapportPatch';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useEscapeKey } from '@/lib/useEscapeKey';
import PipelineFunnelMobile from './PipelineFunnelMobile';
import PipelineListView from './PipelineListView';
import PipelineFilters, { FILTRES_VIDES, FILTRES_SANS_LM, type EtatsFiltres, type EtatFiltre, type FiltreKey } from './PipelineFilters';
import Icon from '@/components/ui/Icon';
import { mutate } from '@/lib/mutate';
import Image from 'next/image';
import { useQuery } from '@tanstack/react-query';
import InlineLoader from '@/components/ui/InlineLoader';
import RapportModal from '@/components/ui/RapportModalLoader';
import ProspectDetailModal from './ProspectDetailModal';
import IconeIssue from './IconeIssue';
import { detecterDoublons, type DoublonSoupconne } from '@/lib/fusionFiches';
import { isYtVideoId } from '@/lib/ytId';
import { isCallHonored } from '@/lib/callHonored';
import { objectionsPour, type OutcomeChoice } from '@/lib/rapportPatch';
import { resolveLeadState, ISSUE_KEYS, ISSUE_TO_OUTCOME, MAX_RELANCES, RELANCE_EXPIRY_DAYS, type StageKey, type IssueKey } from '@/lib/pipelineStage';
import { useViewerTimeZone } from '@/lib/UserContext';
import { wallClockToUtc, cityLabelOf, formatDayPartsIn } from '@/lib/timezone';

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
  /**
   * À QUI ce lien appartient. `ig_username` ne le dit pas : la colonne porte
   * désormais des noms d'invités de calls YouTube depuis que la liste de
   * prospects a été élargie aux trois sources — elle ment sur son contenu.
   */
  ig_lead_id: string | null;    // lead Instagram ⇒ onglet Instagram
  prospect_id: string | null;   // personne déjà connue ailleurs ⇒ SON onglet d'origine
  source_at_creation: string | null;
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
  /** Lien du replay Fathom. Nul tant que Fathom n'a reçu aucun enregistrement —
   *  ce qui est le cas depuis le début : la chronologie l'affiche en pointillé. */
  fathom_share_url: string | null;
  /** Ce qui a bloqué, saisi au rapport. Affiché sur la ligne « Résultat ». */
  objection: string | null;
  objection_autre: string | null;
  relance_at: string | null;
}

/** Une décision déjà prise sur un doublon soupçonné. Voir lib/fusionFiches.ts. */
interface DecisionFusionLue {
  ig_lead_id: string;
  prospect_id: string;
  statut: 'fusionnee' | 'refusee';
  call_ids: string[];
  decided_at: string;
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
  fusions: DecisionFusionLue[];
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

// ⚠️ C'est l'ordre d'AFFICHAGE, pas l'ordre de progression. Celui-ci vit dans
// `STAGE_ORDER` (lib/pipelineStage.ts) et décide de ce qui peut avancer vers
// quoi : le déplacer casserait la résolution d'étape. Les deux sont volontairement
// séparés, et `stageIdx` n'est qu'un index dans CE tableau-ci — il sert à
// retrouver un libellé et une couleur, jamais à comparer deux étapes.
//
// Cold DM ouvre la rangée : c'est une PORTE D'ENTRÉE, au même titre que le
// commentaire sous un post, pas une case qui viendrait après le lead magnet.
// Le mettre en troisième position le faisait lire comme une suite.
const IG_STAGES = [
  { key: 'cold_dm',       label: 'Cold DM',             color: '#0891B2', lightBg: '#ECFEFF', dot: '#0891B2' },
  { key: 'lm_sent',       label: 'Commentaire LM',      color: '#7C3AED', lightBg: '#F5F3FF', dot: '#7C3AED' },
  { key: 'lm_received',   label: 'Lead magnet reçu',    color: '#A855F7', lightBg: '#FAF5FF', dot: '#A855F7' },
  { key: 'in_convo',      label: 'En conversation',     color: '#9333EA', lightBg: '#FDF4FF', dot: '#9333EA' },
  { key: 'calendly_sent', label: 'Calendly envoyé',     color: '#D97706', lightBg: '#FFFBEB', dot: '#D97706' },
  { key: 'link_clicked',  label: 'Lien cliqué',         color: '#EA580C', lightBg: '#FFF7ED', dot: '#EA580C' },
  { key: 'call_booked',   label: 'RDV pris',            color: '#2563EB', lightBg: '#EFF6FF', dot: '#2563EB' },
] as const;

// YouTube et « Autres » n'avaient qu'UNE étape : un lead y arrive par un lien
// Calendly en description, donc directement au rendez-vous.
//
// Depuis qu'on peut générer un LIEN DE SUIVI pour n'importe qui (« Gérer mes
// liens »), ce n'est plus vrai : une personne venue de YouTube peut recevoir un
// lien et le cliquer avant d'avoir réservé. Sans ces deux étapes, elle n'aurait
// aucune colonne où exister — elle serait invisible entre le clic et la
// réservation, c'est-à-dire exactement au moment où il faut la relancer.
//
/**
 * Le canal d'origine d'un prospect, en clair. Mêmes mots que ceux déjà affichés
 * sur les cartes construites depuis un call (`srcLabel`) — deux libellés
 * différents pour la même source se liraient comme deux choses différentes.
 */
const SOURCE_LABELS: Record<string, string> = {
  ig_description: 'Lien description',
  ig_story:       'Story',
  ig_dm:          'DM',
  ig_bio:         'Lien bio',
  yt_description: 'Description YouTube',
};

// PAS de « Calendly envoyé » ici, contrairement à Instagram : une carte
// YouTube naît au CLIC (décision de Chris, 2026-08-29). La colonne « lien
// envoyé, pas encore cliqué » serait donc vide pour toujours. Côté Instagram
// elle reste peuplée, mais par les leads — leur carte vient de `instagram_leads`,
// pas du lien.
const YT_STAGES = [
  { key: 'link_clicked',  label: 'Lien cliqué', color: '#EA580C', lightBg: '#FFF7ED', dot: '#EA580C' },
  { key: 'call_booked',   label: 'RDV pris',    color: '#2563EB', lightBg: '#EFF6FF', dot: '#2563EB' },
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

// Les tris de la vue liste. Par défaut « le plus immobile » : la liste sert à
// rattraper ce qui dort, pas à relire ce qu'on vient de traiter.
/**
 * Les trois ordres possibles dans la vue liste.
 *
 * Il y en avait quatre, dont deux STRICTEMENT identiques : « le plus immobile »
 * et « le plus ancien » exécutaient le même tri. Un menu qui propose deux fois
 * la même chose sous deux noms fait douter des deux autres.
 *
 * Les trois trient sur le dernier signe de vie (`lastMoveAt`) — commentaire,
 * réponse en DM, clic, rendez-vous ou relance, indifféremment. Le défaut est
 * `immobile` : cette liste sert à rattraper les leads oubliés, ils doivent être
 * en haut.
 */
export type TriKey = 'immobile' | 'recent' | 'nom';
const TRIS: readonly { key: TriKey; label: string }[] = [
  { key: 'immobile', label: 'Sans nouvelles depuis le plus longtemps' },
  { key: 'recent',   label: 'Bougé le plus récemment' },
  { key: 'nom',      label: 'Par nom (A→Z)' },
] as const;

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

/**
 * Ce que les filtres réglables ont besoin de savoir sur les rendez-vous d'un
 * lead. Calculé une fois par carte, jamais dans le filtre lui-même : refaire ces
 * boucles à chaque frappe sur 600 cartes ferait ramer la page.
 */
function statsRdv(calls: readonly Call[], now: Date): {
  rdvCount: number; rdvAnyMissed: boolean; rdvAllHonored: boolean; lastPastRdvAt: string | null;
} {
  const utiles = calls.filter(c => !c.lead_deleted && c.status === 'active');
  const passes = utiles.filter(c => new Date(c.scheduled_at).getTime() < now.getTime());
  const honores = passes.filter(c => isCallHonored(c, now));
  return {
    rdvCount: utiles.length,
    rdvAnyMissed: passes.some(c => c.no_show === true),
    // « Tous honorés » exige qu'il y en ait au moins un : sur zéro rendez-vous,
    // la réponse n'est pas « oui », c'est « la question ne se pose pas ».
    rdvAllHonored: passes.length > 0 && honores.length === passes.length,
    lastPastRdvAt: passes.length
      ? passes.reduce((a, b) => new Date(b.scheduled_at) > new Date(a.scheduled_at) ? b : a).scheduled_at
      : null,
  };
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
  /** La dernière relance du cycle : c'est d'elle que se déduit la prochaine. */
  derniereRelanceAt?: string | null;
  /** Quand le lead est entré dans son issue. `null` tant qu'il est actif. */
  classedAt?: string | null;
  /**
   * Dernier signe de vie, quelle qu'en soit la nature : commentaire, réponse en
   * DM, clic, rendez-vous, relance. C'est ce qui permet de trier par « ça dort
   * depuis longtemps » — la colonne la plus utile pour rattraper un lead oublié.
   */
  lastMoveAt?: string | null;
  /** Ce qui est attendu ensuite, en clair. Vide quand il n'y a rien à attendre. */
  nextDue?: { label: string; at: string | null; urgent: boolean } | null;
  // ── Ce que les filtres réglables interrogent ────────────────────────────────
  /** Nombre de rendez-vous pris, toutes reprogrammations confondues. */
  rdvCount?: number;
  /** Au moins un rendez-vous manqué / tous honorés. Deux questions distinctes. */
  rdvAnyMissed?: boolean;
  rdvAllHonored?: boolean;
  /** Date du dernier rendez-vous PASSÉ. Les RDV à venir sont dans l'étape. */
  lastPastRdvAt?: string | null;
  /** Lead magnets RÉCLAMÉS : il a commenté le mot-clé. */
  lmClaimed?: number;
  /** Lead magnets REÇUS : il a en plus cliqué le bouton du DM1. L'écart mesure
   *  la qualité du DM1 — c'est tout l'intérêt de distinguer les deux. */
  lmReceived?: number;
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
  /** Le rapport déjà soumis, pour rouvrir la modale sur ce qui a été répondu. */
  callQualified?: boolean | null;
  callObjection?: string | null;
  callObjectionAutre?: string | null;
  callRelanceAt?: string | null;
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
  onRapportClick?: (callId: string, inviteeName: string, scheduledAt: string, isFollowUp: boolean, existing?: RapportExistant | null) => void;
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
        // La fiche qui attend un rapport porte un fond ambré : c'est la seule du
        // board dont l'inaction bloque une statistique. Toutes les autres peuvent
        // attendre, celle-ci non — et un point de couleur ne se voit pas de loin.
        background: card.rapportEnRetard ? 'var(--amber-soft, #b5802514)' : 'var(--surface)',
        border: `1px solid ${isDragging ? stage.color : card.rapportEnRetard ? '#e8cf9a' : 'var(--border)'}`,
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

      {/* La LIGNE DE CONTEXTE remplace la barre de progression multicolore.
          Sept segments de 2 px ne disaient rien de lisible — on voyait des
          couleurs, jamais où en était la personne. Une phrase le dit :
          « sans mouvement depuis 24 j », « RDV du 18 août · rapport à remplir ».
          C'est la seule ligne qui apprend quelque chose au survol d'une colonne. */}
      <div style={{
        fontSize: 10.5, lineHeight: 1.35,
        color: card.nextDue?.urgent ? '#cd5b3f' : 'var(--muted)',
        fontWeight: card.nextDue?.urgent ? 600 : 400,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {contexteCarte(card)}
      </div>

      {card.extra && (
        <div style={{ fontSize: 10, fontWeight: 700, color: '#3f8a52', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
          // Rapport à remplir = AMBRE, la couleur de l'attente dans ce produit —
          // celle du fond de la carte juste derrière ce bouton. Il était bleu, la
          // couleur d'une action neutre : le seul élément de la carte qui réclame
          // quelque chose ne partageait sa couleur avec rien d'autre du signal.
          //
          // `--amber-ink` et non `--amber` : sur fond clair, --amber ne donne que
          // 3,4:1, sous le seuil pour du texte de 10 px. Celui-ci monte à 7,1:1,
          // et 7,1:1 aussi en blanc sur fond plein au survol.
          //
          // Rapport déjà rempli = simple correction possible, en gris discret pour
          // ne pas réclamer l'attention.
          style={{
            display: 'block', width: '100%', textAlign: 'center', fontSize: 10, fontWeight: 600,
            padding: '5px 8px', borderRadius: 6,
            background: hasRapport ? 'var(--surface-2)' : 'var(--amber-soft, #b5802518)',
            color: hasRapport ? 'var(--muted)' : 'var(--amber-ink, #92400e)',
            border: `1px solid ${hasRapport ? 'var(--border)' : '#e8cf9a'}`,
            cursor: 'pointer', transition: 'all .12s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = hasRapport ? 'var(--border)' : 'var(--amber-ink, #92400e)'; (e.currentTarget as HTMLElement).style.color = hasRapport ? 'var(--ink)' : '#fff'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = hasRapport ? 'var(--surface-2)' : 'var(--amber-soft, #b5802518)'; (e.currentTarget as HTMLElement).style.color = hasRapport ? 'var(--muted)' : 'var(--amber-ink, #92400e)'; }}
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

// Ce qu'une fiche raconte en une ligne. L'ordre suit l'urgence : ce qui bloque
// d'abord, ce qui est prévu ensuite, l'ancienneté en dernier — et « aucun signal »
// quand il n'y a vraiment rien, ce qui est une information et non un vide.
function contexteCarte(card: CardData): string {
  if (card.nextDue?.label) {
    if (card.nextDue.at && card.nextDue.label === 'RDV') {
      return `RDV ${new Date(card.nextDue.at).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' })}`;
    }
    if (card.rapportEnRetard && card.callScheduledAt) {
      return `RDV du ${new Date(card.callScheduledAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} · rapport à remplir`;
    }
    return card.nextDue.label;
  }
  if (card.lastMoveAt) {
    const j = Math.floor((Date.now() - new Date(card.lastMoveAt).getTime()) / 86400000);
    // « vu il y a 1 sem » se lisait comme « je l'ai vu » ou « il a vu mon
    // message ». Ce que la ligne dit vraiment, c'est la date du dernier SIGNE
    // DE VIE, quelle qu'en soit la nature — et c'est aussi ce que trie la vue
    // liste, d'où le même verbe des deux côtés.
    if (j >= 21) return `sans mouvement depuis ${j} j`;
    if (j <= 0)  return 'a bougé aujourd’hui';
    if (j === 1) return 'a bougé hier';
    if (j < 7)   return `a bougé il y a ${j} j`;
    return `a bougé il y a ${Math.floor(j / 7)} sem`;
  }
  return 'aucun signal';
}

// ── BandeauDoublon ────────────────────────────────────────────────────────────
//
// Une même personne peut occuper deux fiches : une Instagram (elle a commenté)
// et une e-mail (elle a réservé depuis une bio ou une description). Rien ne les
// relie en base — `instagram_leads` n'a aucune colonne e-mail.
//
// Le doublon se signale TOUT SEUL, en haut de la page, là où les deux fiches
// sont côte à côte. Pas de marqueur discret sur une carte : il faudrait survoler
// la bonne carte au bon moment, ce qui est une corvée déguisée. Pas de requête à
// lancer non plus : personne ne la lancerait, et l'objectif du projet est zéro
// maintenance après livraison.
//
// Rien à afficher = rien du tout. Le bandeau n'existe que quand il a quelque
// chose à dire, donc il ne coûte aucune place le reste du temps.

function BandeauDoublon({
  doublon, restants, onFusionner, onRefuser,
}: {
  doublon: DoublonSoupconne;
  /** Combien d'autres paires attendent derrière celle-ci. */
  restants: number;
  onFusionner: () => void;
  onRefuser: () => void;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0, flexWrap: 'wrap',
      padding: '10px 14px', borderRadius: 10,
      background: 'var(--amber-soft, #b5802518)', border: '1px solid #e8cf9a',
    }}>
      <span style={{ color: 'var(--amber-ink, #92400e)', display: 'flex', flexShrink: 0 }}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden
          stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 3a4 4 0 0 1 0 8" /><path d="M8 3a4 4 0 0 0 0 8" />
          <path d="M12 13c-4 0-7 2-7 4v3h14v-3c0-2-3-4-7-4z" />
        </svg>
      </span>

      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>
          @{doublon.igUsername} et {doublon.prospectNom} partagent {doublon.email}
        </div>
        {/* Ce que la fusion ferait, en clair et chiffré. « Fusionner » sans dire
            ce qui bouge demande de faire confiance à un bouton. */}
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>
          Même personne ? Fusionner rattachera {doublon.callIds.length} rendez-vous à @{doublon.igUsername}.
          {restants > 0 && ` · ${restants} autre${restants > 1 ? 's' : ''} à vérifier`}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <button
          type="button"
          onClick={onRefuser}
          title="La question ne sera plus reposée pour ces deux fiches"
          style={{
            fontSize: 11.5, fontWeight: 600, minHeight: 32, padding: '0 11px',
            borderRadius: 8, cursor: 'pointer', whiteSpace: 'nowrap',
            background: 'var(--surface)', color: 'var(--ink-2)',
            border: '1px solid var(--border)',
          }}
        >Ce n&rsquo;est pas la même</button>
        <button
          type="button"
          onClick={onFusionner}
          style={{
            fontSize: 11.5, fontWeight: 600, minHeight: 32, padding: '0 13px',
            borderRadius: 8, cursor: 'pointer', whiteSpace: 'nowrap',
            background: 'var(--amber-ink, #92400e)', color: '#fff',
            border: '1px solid var(--amber-ink, #92400e)',
          }}
        >Fusionner</button>
      </div>
    </div>
  );
}

// ── BoutonCase ────────────────────────────────────────────────────────────────
// Un bouton par étape et par issue, au-dessus de la vue liste. La forme dit la
// nature : pastille ronde pour une étape (une position dans un parcours),
// symbole pour une issue (un résultat, sans position).

function BoutonCase({
  label, n, actif, couleur, forme, issueKey, onClick,
}: {
  label: string; n: number; actif: boolean;
  couleur?: string; forme?: 'rond' | 'carre';
  /** La clé de l'issue, quand c'en est une : elle choisit le symbole. */
  issueKey?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={actif}
      style={{
        // EXACTEMENT la typographie des filtres qui les suivent : 11,5 px en 600,
        // 32 px de haut, coins à 8. Ils vivaient à 10 px sur 20 px de haut, et
        // deux rangées de commandes empilées avec deux échelles différentes se
        // lisaient comme deux systèmes qui n'ont rien à voir. Ils en sont un
        // seul : « ce que je regarde », puis « ce que je garde dedans ».
        display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
        //
        // Pas de `font: 'inherit'` : cette propriété raccourcie remet à zéro
        // font-size ET font-weight. Posée après les deux lignes ci-dessous, elle
        // les effaçait — les boutons rendaient à 14 px en 400, la taille du
        // corps de texte, jamais celle qu'on croyait avoir écrite. La famille
        // est déjà héritée par la règle globale `button { font-family: inherit }`.
        fontSize: 11.5, fontWeight: 600, padding: '0 11px', borderRadius: 8,
        cursor: 'pointer', minHeight: 32,
        background: actif ? 'var(--accent-brand, #3a6a86)' : 'var(--surface)',
        border: `1px solid ${actif ? 'var(--accent-brand, #3a6a86)' : 'var(--border)'}`,
        color: actif ? '#fff' : 'var(--ink)',
      }}
    >
      {forme === 'carre' && issueKey ? (
        <span style={{ color: actif ? '#fff' : couleur, display: 'flex', flexShrink: 0 }}>
          <IconeIssue issueKey={issueKey} taille={13} />
        </span>
      ) : couleur ? (
        <span style={{
          width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
          background: actif ? '#fff' : couleur,
        }} />
      ) : null}
      {label}
      <span style={{
        fontSize: 10.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
        color: actif ? 'rgba(255,255,255,.78)' : 'var(--muted)',
      }}>{n}</span>
    </button>
  );
}

// Ce qu'une tuile d'issue annonce sous son compteur : ce qu'il reste À FAIRE, et
// rien d'autre. « 3 à recontacter » n'appelle aucune action ; « 2 à relancer
// aujourd'hui » si.
function contexteIssue(key: string, liste: CardData[]): string {
  if (liste.length === 0) return 'aucun lead';
  switch (key) {
    case 'to_recontact': {
      const dus = liste.filter(c => c.relanceDue).length;
      return dus > 0 ? `${dus} à relancer maintenant` : 'aucune relance due';
    }
    case 'no_show': {
      const rebookes = liste.filter(c => (c.rdvCount ?? 0) > 1).length;
      if (rebookes === 0) return 'aucun rebooking';
      return rebookes === 1 ? '1 a rebooké' : `${rebookes} ont rebooké`;
    }
    case 'closed': {
      const total = liste.reduce((n, c) => n + (c.callRevenue ?? 0), 0);
      return total > 0 ? `${total.toLocaleString('fr-FR')} € encaissés` : 'aucun montant saisi';
    }
    case 'lost': {
      const sansReponse = liste.filter(c => c.issueReason === 'sans_reponse').length;
      return sansReponse > 0 ? `${sansReponse} sans réponse` : 'aucune action';
    }
    default:
      return 'aucune action';
  }
}

/**
 * L'échéance d'un lead « à recontacter » : la seule question que pose cette
 * liste, c'est QUAND. Rend `null` pour les autres issues — un lead perdu ou closé
 * n'attend plus rien, et lui inventer une échéance serait un mensonge.
 *
 * Trois échéances possibles, dans cet ordre :
 *   la relance est due  → aujourd'hui, en rouge ;
 *   les trois sont faites → la SORTIE automatique en Perdu, en rouge ;
 *   sinon               → la prochaine relance, en gris.
 */
function echeanceRelance(issueKey: string, c: CardData): { label: string; urgent: boolean } | null {
  if (issueKey !== 'to_recontact') return null;
  if (c.relanceDue) return { label: "aujourd'hui", urgent: true };

  const derniere = c.derniereRelanceAt ? new Date(c.derniereRelanceAt).getTime() : null;
  const faites = c.relancesFaites ?? 0;

  // Cycle plein : la prochaine date n'est plus une relance, c'est la sortie.
  if (faites >= MAX_RELANCES && derniere !== null) {
    return { label: `sort ${dansCombien(derniere + RELANCE_EXPIRY_DAYS * 86400000)}`, urgent: true };
  }

  // Même règle que la résolution : la date convenue vaut pour la PREMIÈRE relance,
  // ensuite c'est le rythme des 21 jours. Deux règles divergentes afficheraient
  // une échéance que le bouton ne respecterait pas.
  const choisie = c.callRelanceAt ? new Date(c.callRelanceAt).getTime() : null;
  const prochaine = derniere === null
    ? choisie
    : derniere + RELANCE_EXPIRY_DAYS * 86400000;

  if (prochaine === null || prochaine <= Date.now()) return null;
  return { label: dansCombien(prochaine), urgent: false };
}

/** « demain », « dans 9 jours », « dans 3 semaines ». Jamais « dans 0 jour ». */
function dansCombien(at: number): string {
  const jours = Math.round((at - Date.now()) / 86400000);
  if (jours <= 0) return "aujourd'hui";
  if (jours === 1) return 'demain';
  if (jours < 14) return `dans ${jours} jours`;
  const semaines = Math.round(jours / 7);
  if (semaines < 9) return `dans ${semaines} semaines`;
  return `dans ${Math.round(jours / 30)} mois`;
}

/**
 * La deuxième ligne d'une fiche dans le panneau d'une issue : d'où vient le lead,
 * puis où il en est DANS cette issue.
 *
 * Le compte de relances est l'information de « À recontacter » — sans lui la
 * liste dit qui est à recontacter mais pas lesquels ont déjà été relancés deux
 * fois. Un lead jamais relancé se décrit au contraire par son immobilité.
 */
function sousTitreIssue(issueKey: string, c: CardData): string {
  const bouts = [c.sub].filter(Boolean) as string[];

  if (issueKey === 'to_recontact') {
    const n = c.relancesFaites ?? 0;
    if (n > 0) {
      bouts.push(`relancé ${n} fois sur ${MAX_RELANCES}`);
    } else if (c.lastMoveAt) {
      bouts.push(`${timeAgo(c.lastMoveAt)} sans mouvement`);
    }
  } else {
    const motif = motifLisible(c.issueReason);
    if (motif) bouts.push(motif);
  }

  return bouts.join(' · ');
}

/**
 * Le motif d'une issue, en français, ou rien.
 *
 * `issueReason` porte des valeurs internes : `'manual'` ne dit rien à personne, et
 * de vieilles lignes de `pipeline_overrides` gardent des motifs de la forme
 * `rapport:to_recontact`, écrits par la route de rapport avant qu'elle cesse de
 * doubler l'écriture. Les afficher tels quels donnait « #LM · rapport:to_recontact »
 * dans le panneau. Ce qui n'est pas un motif lisible n'est pas un motif.
 */
function motifLisible(reason: string | null | undefined): string | null {
  if (!reason || reason === 'manual' || reason.includes(':')) return null;
  if (reason === 'sans_reponse') return 'sorti sans réponse';
  return reason;
}

// ── PanneauIssue ──────────────────────────────────────────────────────────────
//
// Cliquer une tuile ouvre ce panneau, à la place du dépliage sous la tuile. La
// colonne des issues ne fait que 188 px : y empiler les fiches les serrait, et
// une issue à 200 fiches écrasait les quatre autres tuiles.
//
// Même dessin que la fiche prospect — 500 px, à droite, voile qui s'arrête au
// board — parce que c'est le même geste : regarder quelque chose sans quitter le
// board.

function PanneauIssue({
  issue, cards, onFermer, onOuvrirFiche, onRelancer, avatarColor, avatarInitials,
}: {
  issue: ColumnDef;
  cards: CardData[];
  onFermer: () => void;
  onOuvrirFiche: (key: string) => void;
  /** Marque une relance faite. Absent = le bouton d'action ne s'affiche pas. */
  onRelancer?: (key: string) => void;
  avatarColor: (n: string) => string;
  avatarInitials: (n: string) => string;
}) {
  useEffect(() => {
    const echap = (e: KeyboardEvent) => { if (e.key === 'Escape') onFermer(); };
    document.addEventListener('keydown', echap);
    return () => document.removeEventListener('keydown', echap);
  }, [onFermer]);

  const viewerTz = useViewerTimeZone();
  const dateCourte = (iso: string) => {
    const p = formatDayPartsIn(new Date(iso), viewerTz);
    return `${Number(p.day)} ${p.monthShort}`;
  };

  // Les relances ne concernent qu'« À recontacter » : une colonne vide sur les
  // quatre autres issues aurait dit qu'il s'y passe quelque chose.
  const avecRelances = issue.key === 'to_recontact';
  // ── POURQUOI DES LARGEURS EN DUR ET NON `auto` ──────────────────────────────
  // L'en-tête et chaque ligne sont des grilles CSS SÉPARÉES. Deux grilles
  // distinctes calculent leurs colonnes `auto` chacune de leur côté, à partir de
  // leur propre contenu : « CLASSÉ LE » (58 px de texte) ne pouvait pas tomber
  // en face de « 15 août » (44 px). Les en-têtes se serraient donc à droite,
  // décalés de tout ce qu'ils étaient censés nommer.
  //
  // Des largeurs fixes sont la seule façon d'aligner deux grilles frères. Une
  // grille unique avec `display: contents` sur les lignes marcherait aussi, mais
  // une ligne cesse alors d'être une boîte : plus de fond au survol, plus de
  // bordure basse, plus de zone cliquable d'un bloc.
  const grille = avecRelances ? '1fr 66px 74px 116px' : '1fr 66px 116px';

  return (
    <>
      {/* Le voile n'est PAS dessiné ici : il est monté une seule fois par la
          page, pour tous les panneaux. Voir « UN SEUL VOILE » plus bas. */}
      <div
        className="pipeline-panneau"
        role="dialog"
        aria-modal="true"
        aria-label={`Leads en « ${issue.label} »`}
      >
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '18px 20px',
          borderBottom: '1px solid var(--border)', flexShrink: 0,
        }}>
          <span style={{
            width: 32, height: 32, borderRadius: 9, flexShrink: 0,
            background: issue.lightBg, border: `1px solid ${issue.color}33`,
            color: issue.color,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <IconeIssue issueKey={issue.key} taille={17} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-.2px' }}>{issue.label}</div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 1 }}>
              {cards.length} lead{cards.length > 1 ? 's' : ''}
              {issue.key === 'to_recontact' && ` · ${cards.filter(c => c.relanceDue).length} à relancer`}
            </div>
          </div>
          <button
            type="button" onClick={onFermer} aria-label="Fermer"
            style={{
              marginLeft: 'auto', width: 30, height: 30, borderRadius: 8, cursor: 'pointer',
              border: '1px solid var(--border)', background: 'var(--surface)',
              color: 'var(--muted)', fontSize: 14, lineHeight: 1, flexShrink: 0,
            }}
          >×</button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {cards.length === 0 ? (
            <div style={{ padding: '28px 20px', textAlign: 'center', fontSize: 12, color: 'var(--faint)' }}>
              Aucun lead dans cette issue.
            </div>
          ) : (
            <>
              {/* En-tête de colonnes : trois faits par lead, et le geste au bout.
                  Sans lui, « 1/3 » et « 18 juin » sont deux nombres sans nom. */}
              <div style={{
                display: 'grid', gridTemplateColumns: grille, gap: 10,
                alignItems: 'center', padding: '7px 20px',
                position: 'sticky', top: 0, zIndex: 1,
                background: 'var(--surface-2)', borderBottom: '1px solid var(--border)',
                fontSize: 9.5, fontWeight: 700, letterSpacing: '.07em',
                textTransform: 'uppercase', color: 'var(--muted)',
              }}>
                <span>Lead</span>
                <span>{avecRelances ? 'Classé le' : 'Date'}</span>
                {avecRelances && <span>Relances</span>}
                <span />
              </div>

              {cards.map(c => {
                const echeance = echeanceRelance(issue.key, c);
                const faites = c.relancesFaites ?? 0;
                return (
                  <div key={c.key} style={{
                    display: 'grid', gridTemplateColumns: grille, gap: 10,
                    alignItems: 'center', padding: '9px 20px', minHeight: 56,
                    borderBottom: '1px solid var(--border-soft, #f5f1e7)',
                  }}>
                    {/* Le lead : cliquer ouvre sa fiche. Le bouton du bout est une
                        action distincte, il ne doit pas hériter de ce clic — d'où
                        deux zones, et non une ligne entièrement cliquable. */}
                    <button
                      type="button"
                      onClick={() => onOuvrirFiche(c.key)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10, minWidth: 0,
                        textAlign: 'left', cursor: 'pointer', padding: 0,
                        background: 'transparent', border: 'none', font: 'inherit', color: 'inherit',
                      }}
                    >
                      {c.avatarUrl ? (
                        <Image src={c.avatarUrl} alt="" width={30} height={30} unoptimized
                          style={{ borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
                      ) : (
                        <span style={{
                          width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                          background: avatarColor(c.name), color: '#fff',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 10, fontWeight: 700,
                        }}>{avatarInitials(c.name)}</span>
                      )}
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {c.isIgLink ? c.name : `@${c.name}`}
                        </span>
                        {/* L'échéance, pas la source : dans une liste de leads à
                            recontacter, savoir QUAND est la seule question. */}
                        <span style={{
                          display: 'block', fontSize: 11, marginTop: 1,
                          color: echeance?.urgent ? 'var(--red)' : 'var(--muted)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {echeance?.label ?? sousTitreIssue(issue.key, c)}
                        </span>
                      </span>
                    </button>

                    <span style={{ fontSize: 12, color: 'var(--ink-2)', fontVariantNumeric: 'tabular-nums' }}>
                      {c.classedAt ? dateCourte(c.classedAt) : '—'}
                    </span>

                    {avecRelances && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {/* Trois pastilles : le cycle est borné, et sa fin se voit
                            AVANT d'arriver. « 2/3 » seul demande de se rappeler
                            que la borne est à trois.
                            Les pastilles restantes sont PLEINES, en gris : en
                            anneau de 1 px sur fond blanc, elles mesuraient 1,09:1
                            de contraste — à 0/3, l'indicateur n'affichait rien. */}
                        <span style={{ display: 'flex', gap: 3 }}>
                          {Array.from({ length: MAX_RELANCES }, (_, i) => (
                            <span key={i} style={{
                              width: 7, height: 7, borderRadius: '50%',
                              background: i < faites ? issue.color : '#cdc7b8',
                            }} />
                          ))}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
                          {faites}/{MAX_RELANCES}
                        </span>
                      </span>
                    )}

                    {/* Le geste attendu, sur la ligne qui l'attend — mais EN
                        CONTOUR. Rempli, il donnait une colonne de rectangles
                        bleus saturés qui criait plus fort que les noms des
                        leads : le panneau ne se lisait plus, il se subissait.
                        Le contour se remplit au survol, au moment où il sert. */}
                    {c.relanceDue && onRelancer ? (
                      <button
                        type="button"
                        onClick={() => onRelancer(c.key)}
                        style={{
                          fontSize: 11, fontWeight: 600, padding: '6px 10px',
                          borderRadius: 7, cursor: 'pointer', whiteSpace: 'nowrap',
                          background: 'var(--surface)', color: 'var(--accent-brand)',
                          border: '1px solid var(--accent-brand)', transition: 'all .12s',
                        }}
                        onMouseEnter={e => {
                          e.currentTarget.style.background = 'var(--accent-brand)';
                          e.currentTarget.style.color = '#fff';
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.background = 'var(--surface)';
                          e.currentTarget.style.color = 'var(--accent-brand)';
                        }}
                      >Je l&rsquo;ai relancé</button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onOuvrirFiche(c.key)}
                        style={{
                          fontSize: 11, fontWeight: 600, padding: '6px 10px',
                          borderRadius: 7, cursor: 'pointer', whiteSpace: 'nowrap',
                          background: 'transparent', color: 'var(--muted)',
                          border: '1px solid transparent', transition: 'all .12s',
                        }}
                        onMouseEnter={e => {
                          e.currentTarget.style.background = 'var(--surface-2)';
                          e.currentTarget.style.color = 'var(--ink)';
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.background = 'transparent';
                          e.currentTarget.style.color = 'var(--muted)';
                        }}
                      >Historique</button>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ── TuilesIssues ──────────────────────────────────────────────────────────────
//
// Les issues ne sont pas des colonnes. Une colonne, c'est une étape d'un
// parcours : elle a une position, une largeur, et on la lit de gauche à droite.
// Une issue est un RÉSULTAT — aucune n'est « après » une autre, et leur donner
// la même forme qu'une étape recrée exactement le mélange qui a déclenché la
// refonte : « 3 no show » lu comme une étape plus avancée que « RDV pris ».
//
// D'où des TUILES : compactes, empilées, dans un bloc à part en fin de board.
// Elles DÉFILENT avec le reste — les ancrer à droite les aurait posées comme un
// panneau permanent, alors que ce sont les cinq dernières cases d'un même
// tableau.
//
// Une tuile s'ouvre au clic pour montrer ses fiches. Fermée, elle ne construit
// rien : les issues accumulent tout l'historique et « Closé » finira par en
// contenir plus que n'importe quelle étape.

function TuilesIssues({
  issues, cardsParIssue, ouverte, onOuvrir, onDrop, onDragOver, onDragLeave, dropTarget, rendreCarte,
}: {
  issues: readonly ColumnDef[];
  cardsParIssue: Record<string, CardData[]>;
  ouverte: string | null;
  onOuvrir: (key: string | null) => void;
  onDrop: (e: React.DragEvent, key: string) => void;
  onDragOver: (e: React.DragEvent, key: string) => void;
  onDragLeave: (key: string) => void;
  dropTarget: string | null;
  rendreCarte: (card: CardData) => React.ReactNode;
}) {
  const total = issues.reduce((n, i) => n + (cardsParIssue[i.key]?.length ?? 0), 0);

  return (
    <div style={{ display: 'flex', gap: 8, alignSelf: 'stretch', flexShrink: 0 }}>
      {/* Séparateur : les issues ne sont pas la suite de l'entonnoir, et un
          simple espace ne suffit pas à le dire. */}
      <div style={{ width: 1, background: 'var(--border)', flexShrink: 0, margin: '0 4px' }} />

      {/* Toute la hauteur, comme une colonne : le bloc Issues est le pendant de
          l'entonnoir, pas une annexe posée en haut à droite. */}
      <div style={{ width: 188, flexShrink: 0, alignSelf: 'stretch', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '7px 10px', flexShrink: 0,
        }}>
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '.07em',
            textTransform: 'uppercase', color: 'var(--muted)',
          }}>Issues</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
            {total}
          </span>
        </div>

        {/* `flex: 1` sur CHAQUE tuile, pas seulement sur la pile : sans ça les
            tuiles gardaient leur hauteur naturelle et se serraient en haut, avec
            un grand vide dessous. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: 1, minHeight: 0 }}>
          {issues.map(issue => {
            const liste = cardsParIssue[issue.key] ?? [];
            const estOuverte = ouverte === issue.key;
            const cible = dropTarget === issue.key;
            return (
              <div key={issue.key} style={{ flex: estOuverte ? '2 1 0' : '1 1 0', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onOuvrir(estOuverte ? null : issue.key)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOuvrir(estOuverte ? null : issue.key); } }}
                  onDrop={e => onDrop(e, issue.key)}
                  onDragOver={e => onDragOver(e, issue.key)}
                  onDragLeave={() => onDragLeave(issue.key)}
                  style={{
                    display: 'flex', flexDirection: 'column', cursor: 'pointer',
                    padding: '10px 12px', borderRadius: 10, userSelect: 'none',
                    flex: 1, minHeight: 0,
                    background: cible ? issue.lightBg : 'var(--surface)',
                    border: `1px ${cible ? 'dashed' : 'solid'} ${cible ? issue.color + '55' : 'var(--border)'}`,
                    boxShadow: 'var(--shadow-card)',
                    transition: 'all .12s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {/* Un symbole, pas un carré : la couleur seule demandait
                        d'avoir appris la légende, et « Perdu » (brun) et « Pas
                        qualifié » (gris) étaient le même carré pour qui
                        distingue mal les couleurs. */}
                    <span style={{ color: issue.color, display: 'flex', flexShrink: 0 }}>
                      <IconeIssue issueKey={issue.key} taille={15} />
                    </span>
                    <span style={{
                      fontSize: 12, fontWeight: 600, flex: 1, minWidth: 0,
                      color: liste.length > 0 ? 'var(--ink)' : 'var(--muted)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{issue.label}</span>
                    <span style={{
                      fontSize: 16, fontWeight: 700, flexShrink: 0,
                      fontVariantNumeric: 'tabular-nums',
                      color: liste.length > 0 ? 'var(--ink)' : 'var(--faint)',
                    }}>{liste.length}</span>
                  </div>

                  {/* La ligne de contexte, en bas de la tuile. Un compteur seul ne
                      dit pas s'il y a quelque chose à FAIRE : « 3 à recontacter »
                      et « 2 à relancer aujourd'hui » ne demandent pas la même
                      chose. C'est ce qui distingue une tuile d'une étiquette. */}
                  <div style={{
                    marginTop: 'auto', paddingTop: 8, fontSize: 10,
                    color: 'var(--faint)', overflow: 'hidden',
                    textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {contexteIssue(issue.key, liste)}
                  </div>
                </div>


              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── KanbanColumn ──────────────────────────────────────────────────────────────

/**
 * La largeur d'une colonne dépliée, en pixels. FIGÉE, jamais partagée.
 *
 * Avec des colonnes élastiques, déplier « Commentaire LM » resserrait les cinq
 * autres d'un coup : on visait une fiche, tout glissait de côté. À largeur figée,
 * déplier ne fait que rallonger le board vers la droite — le défilement
 * horizontal absorbe la place manquante et rien de déjà visible ne bouge.
 */
const LARGEUR_COLONNE = 252;

function KanbanColumn({
  stage, cards, stages, draggingKey, onDragStart, onDrop, onDragOver, onDragLeave,
  isDropTarget, platform, onConfirmLead, onDeleteLead, onRapportClick, onCardClick, onNotALead,
  estIssue, replie, onToggleRepli,
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
  onRapportClick?: (callId: string, inviteeName: string, scheduledAt: string, isFollowUp: boolean, existing?: RapportExistant | null) => void;
  onCardClick?: (cardKey: string) => void;
  onNotALead?: (key: string, callId?: string | null) => void;
  /** Une issue se dessine en carré plein, une étape en pastille ronde. */
  estIssue?: boolean;
  replie?: boolean;
  onToggleRepli?: () => void;
}) {
  // ── LARGEUR FIGÉE, JAMAIS ÉLASTIQUE ─────────────────────────────────────────
  // `LARGEUR_COLONNE` quoi qu'il arrive. Des colonnes élastiques se resserrent
  // quand une autre s'ouvre : tout le board bouge sous les yeux au moment précis
  // où on vise une carte. Déplier passe directement en défilement horizontal.
  if (replie) {
    return (
      <button
        type="button"
        onClick={onToggleRepli}
        onDrop={e => onDrop(e, stage.key)}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        title={`Déplier « ${stage.label} »`}
        style={{
          // 34 px : une colonne pliée n'a que trois choses à montrer — sa couleur,
          // son compte, son nom. Le chevron était la quatrième, et c'est celle
          // dont on se passe : toute la bande est cliquable.
          width: 34, flexShrink: 0, alignSelf: 'stretch', cursor: 'pointer',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9,
          padding: '11px 0', font: 'inherit', color: 'inherit',
          // Même cadre que les colonnes dépliées : c'est le même objet, replié.
          background: isDropTarget ? stage.lightBg : 'var(--surface)',
          border: `1px ${isDropTarget ? 'dashed' : 'solid'} ${isDropTarget ? stage.color + '66' : 'var(--border)'}`,
          borderRadius: 10,
        }}
      >
        {estIssue ? (
          <span style={{ color: stage.color, display: 'flex', flexShrink: 0 }}>
            <IconeIssue issueKey={stage.key} taille={13} />
          </span>
        ) : (
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: stage.color, flexShrink: 0 }} />
        )}
        {/* Le nombre EST l'information d'une colonne pliée. En petit, il fallait
            s'approcher pour lire « 412 ». */}
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
          {cards.length}
        </span>
        {/* Le libellé à la verticale : sans lui, une colonne repliée n'est plus
            qu'un chiffre, et retrouver la bonne demande de toutes les rouvrir. */}
        <span style={{
          writingMode: 'vertical-rl', transform: 'rotate(180deg)',
          fontSize: 10, fontWeight: 500, color: 'var(--muted)',
          letterSpacing: '.02em', whiteSpace: 'nowrap', overflow: 'hidden',
          textOverflow: 'ellipsis', maxHeight: 150, marginTop: 2,
        }}>{stage.label}</span>
      </button>
    );
  }

  return (
    // La colonne est un CADRE : l'en-tête est dedans, pas posé au-dessus. Un
    // trait de séparation seul ne suffisait pas — les fiches de deux colonnes
    // voisines se lisaient comme une seule grille et on ne voyait plus où une
    // étape finissait.
    <div style={{
      flex: `0 0 ${LARGEUR_COLONNE}px`, alignSelf: 'stretch',
      display: 'flex', flexDirection: 'column',
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 10, overflow: 'hidden',
    }}>
      {/* Bandeau beige mat : l'en-tête se détache du blanc de la colonne et des
          fiches, et la rangée d'en-têtes se lit d'un trait en haut du board. */}
      <div
        role="button"
        tabIndex={0}
        onClick={onToggleRepli}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleRepli?.(); } }}
        title={`Plier « ${stage.label} »`}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 11px', cursor: 'pointer', userSelect: 'none',
          background: isDropTarget ? stage.lightBg : 'var(--surface-2, #f7f4ec)',
          borderBottom: '1px solid var(--border)',
          transition: 'background .12s', flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
          {estIssue ? (
            <span style={{ color: stage.color, display: 'flex', flexShrink: 0 }}>
              <IconeIssue issueKey={stage.key} taille={13} />
            </span>
          ) : (
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: stage.color, flexShrink: 0 }} />
          )}
          <span style={{
            fontSize: 11.5, fontWeight: 600, color: isDropTarget ? stage.color : 'var(--ink)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {stage.label}
          </span>
        </div>
        {/* Compteur nu : la pastille colorée répétait la couleur déjà portée par
            la pastille de gauche, et transformait un nombre en badge. */}
        <span style={{
          fontSize: 12, fontWeight: 700, flexShrink: 0,
          fontVariantNumeric: 'tabular-nums',
          color: cards.length > 0 ? 'var(--ink)' : 'var(--faint)',
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
          padding: 7, overflowY: 'auto',
          background: isDropTarget ? stage.lightBg + 'BB' : 'transparent',
          transition: 'background .12s',
        }}>
        {/* Une colonne vide reste vide. « Glisser ici » répété sur six colonnes
            occupait plus de place que les fiches elles-mêmes, pour une consigne
            qu'on lit une fois. La zone de dépôt s'éclaire pendant le glissé,
            c'est là qu'elle sert. */}
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
    // Le plancher n'est pas un détail technique : sans cette ligne, on ne
    // comprend pas pourquoi une carte avancée à la main accepte enfin de
    // reculer — ni qu'un signal automatique pourra désormais la faire bouger.
    items.push('L’étape confirmée à la main sera abaissée : un signal automatique pourra de nouveau faire avancer cette carte');
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

  // Le parcours de classement à la main : les mêmes questions que le rapport de
  // vente, dans le même ordre. Aucune n'est obligatoire.
  const [classQualified, setClassQualified] = useState<boolean | null>(null);
  const [classObjection, setClassObjection] = useState<string | null>(null);
  const [classObjectionAutre, setClassObjectionAutre] = useState('');
  const [classRelanceAt, setClassRelanceAt] = useState('');
  const classeEnIssue = ISSUE_KEYS.some(k => k === targetStageKey);
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

        {modalCase === 'simple_move' && !classeEnIssue && (
          <>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Déplacer vers &laquo;&nbsp;{targetStageLabel}&nbsp;&raquo; ?</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 20 }}>
              @{cardName} sera déplacé manuellement. Le pipeline automatique continuera de s&apos;appliquer si un signal plus avancé est détecté.
            </div>
          </>
        )}

        {/* ── CLASSER À LA MAIN : LE MÊME PARCOURS QUE LE RAPPORT ─────────────
            Déposer une carte sur une issue pose les mêmes questions que le
            rapport de vente, dans le même ordre. Sans elles, un lead classé à la
            main serait un trou dans les statistiques : on saurait qu'il est
            perdu, jamais pourquoi.

            « No show » ne pose aucune question — le fait suffit. */}
        {modalCase === 'simple_move' && classeEnIssue && (
          <>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
              Classer @{cardName} en &laquo;&nbsp;{targetStageLabel}&nbsp;&raquo;
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
              {targetStageKey === 'no_show'
                ? "Le rendez-vous n'a pas été honoré. Rien d'autre à renseigner."
                : 'Deux précisions, pour que le chiffre garde un sens.'}
            </div>

            {/* Qualifié : la question ne se pose pas sur « Pas qualifié », dont
                l'intitulé y répond déjà. */}
            {targetStageKey !== 'no_show' && targetStageKey !== 'not_qualified' && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 6 }}>
                  Était-il la cible ?
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[[true, 'Oui'], [false, 'Non']].map(([v, label]) => (
                    <button
                      key={String(v)}
                      type="button"
                      onMouseDown={() => setClassQualified(v as boolean)}
                      style={{
                        padding: '7px 14px', fontSize: 12, fontWeight: 600, borderRadius: 8, cursor: 'pointer',
                        border: `1px solid ${classQualified === v ? '#2563EB' : 'var(--border)'}`,
                        background: classQualified === v ? '#2563EB' : 'transparent',
                        color: classQualified === v ? '#fff' : 'var(--ink)',
                      }}
                    >{label as string}</button>
                  ))}
                </div>
              </div>
            )}

            {targetStageKey !== 'no_show' && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 6 }}>
                  Qu&apos;est-ce qui a bloqué ?
                </div>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {objectionsPour(targetStageKey as OutcomeChoice).map(o => (
                    <button
                      key={o.key}
                      type="button"
                      onMouseDown={() => setClassObjection(o.key)}
                      style={{
                        padding: '7px 11px', fontSize: 11.5, fontWeight: 600, borderRadius: 8, cursor: 'pointer',
                        border: `1px solid ${classObjection === o.key ? '#2563EB' : 'var(--border)'}`,
                        background: classObjection === o.key ? '#2563EB' : 'transparent',
                        color: classObjection === o.key ? '#fff' : 'var(--ink)',
                      }}
                    >{o.label}</button>
                  ))}
                </div>
                {classObjection === 'autre' && (
                  <input
                    type="text"
                    value={classObjectionAutre}
                    onChange={e => setClassObjectionAutre(e.target.value.slice(0, 500))}
                    placeholder="Par exemple : il déménage à l'étranger"
                    style={{
                      width: '100%', marginTop: 8, padding: '9px 11px', fontSize: 13,
                      borderRadius: 8, border: '1px solid var(--border)',
                      background: 'var(--surface)', color: 'var(--ink)',
                    }}
                  />
                )}
              </div>
            )}

            {/* Quand recontacter — sur la seule issue qui ouvre un cycle. */}
            {targetStageKey === 'to_recontact' && (
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 6 }}>
                  Quand le recontacter ?
                </div>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 8 }}>
                  {[[14, 'Dans 2 sem'], [21, 'Dans 3 sem'], [30, 'Dans 1 mois'], [90, 'Dans 3 mois']].map(([j, label]) => {
                    const d = new Date(Date.now() + (j as number) * 86400000).toISOString().slice(0, 10);
                    return (
                      <button
                        key={j as number}
                        type="button"
                        onMouseDown={() => setClassRelanceAt(d)}
                        style={{
                          padding: '7px 11px', fontSize: 11.5, fontWeight: 600, borderRadius: 8, cursor: 'pointer',
                          border: `1px solid ${classRelanceAt === d ? '#2563EB' : 'var(--border)'}`,
                          background: classRelanceAt === d ? '#2563EB' : 'transparent',
                          color: classRelanceAt === d ? '#fff' : 'var(--ink)',
                        }}
                      >{label as string}</button>
                    );
                  })}
                </div>
                <input
                  type="date"
                  value={classRelanceAt}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={e => setClassRelanceAt(e.target.value)}
                  style={{
                    width: '100%', padding: '9px 11px', fontSize: 13, borderRadius: 8,
                    border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--ink)',
                  }}
                />
              </div>
            )}

            {/* Rien n'est obligatoire : forcer une réponse pousserait à en
                inventer une, et une objection inventée vaut moins qu'un trou. */}
            <div style={{ fontSize: 11, color: 'var(--faint)', marginBottom: 16 }}>
              Tu peux valider sans répondre — mieux vaut un trou qu&apos;une réponse au hasard.
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
              if (modalCase === 'simple_move' && classeEnIssue) {
                extraData.qualified = classQualified;
                extraData.objection = classObjection;
                extraData.objectionAutre = classObjectionAutre.trim();
                extraData.relanceAt = classRelanceAt;
              }
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

  // Les colonnes repliées du board. Conservées d'une visite à l'autre : replier
  // « Commentaire LM » et ses 412 fiches pour dégager la vue n'aurait aucun
  // intérêt s'il fallait recommencer à chaque chargement.
  // Les trois premières étapes arrivent PLIÉES : « Commentaire LM » à lui seul
  // peut contenir des centaines de fiches sur lesquelles il n'y a rien à faire —
  // elles n'ont pas encore répondu. Dépliées, elles poussaient hors écran les
  // étapes où le travail se trouve vraiment.
  const REPLI_PAR_DEFAUT = ['lm_sent', 'lm_received', 'cold_dm'];
  const [colonnesRepliees, setColonnesRepliees] = useState<Set<string>>(new Set(REPLI_PAR_DEFAUT));

  // La case isolée par les boutons d'étapes, en vue liste. `null` = tout.
  const [caseIsolee, setCaseIsolee] = useState<string | null>(null);

  // La tuile d'issue dépliée dans le board. Une seule à la fois : les issues
  // accumulent tout l'historique, les ouvrir toutes noierait l'entonnoir.
  // L'issue dont le panneau latéral est ouvert. Les issues accumulent tout
  // l'historique — « Closé » finira à des centaines de fiches — et un panneau qui
  // défile les tient sans déformer le board.
  const [panneauIssue, setPanneauIssue] = useState<string | null>(null);

  const [tri, setTri] = useState<TriKey>('immobile');
  const [filtreRapport, setFiltreRapport] = useState(false);

  useEffect(() => {
    try {
      const v = window.localStorage.getItem('pipeline-vue');
      if (v === 'liste' || v === 'board') setVue(v);
      const r = window.localStorage.getItem('pipeline-colonnes-repliees');
      if (r) setColonnesRepliees(new Set(JSON.parse(r) as string[]));
    } catch { /* navigation privée, cookies bloqués : le board par défaut suffit */ }
  }, []);
  const changerVue = (v: 'board' | 'liste') => {
    setVue(v);
    try { window.localStorage.setItem('pipeline-vue', v); } catch { /* sans effet */ }
  };
  const [filterCanceled, setFilterCanceled] = useState(false);
  const [filterRescheduled, setFilterRescheduled] = useState(false);

  // Les quatre filtres réglables. Leur réglage vit dans le bouton lui-même —
  // voir components/pipeline/PipelineFilters.tsx pour le geste, qui diffère
  // entre l'ordinateur et le téléphone.
  const [filtresReglables, setFiltresReglables] = useState<EtatsFiltres>(FILTRES_VIDES);
  const changerFiltre = useCallback((key: FiltreKey, e: EtatFiltre) => {
    setFiltresReglables(prev => ({ ...prev, [key]: e }));
  }, []);

  // Le geste des filtres change sous 767px, là où la bascule CSS
  // .pipeline-desktop / .pipeline-mobile opère déjà.
  const [tactile, setTactile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const suivre = () => setTactile(mq.matches);
    suivre();
    mq.addEventListener('change', suivre);
    return () => mq.removeEventListener('change', suivre);
  }, []);

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
    existing?: RapportExistant | null;
  } | null>(null);

  // Message renvoyé par le serveur quand une suppression est refusée (deal signé).
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Modal détail prospect (timeline) ouvert au clic sur une card
  const [detailModal, setDetailModal] = useState<{ cardKey: string; platform: 'ig' | 'yt' | 'other' } | null>(null);

  // ── LE VOILE ET LE PANNEAU, SANS UNE LIGNE DE MESURE ───────────────────────
  //
  // Les deux sont placés en CSS pur, par `.pipeline-voile` et `.pipeline-panneau`
  // dans globals.css. Le voile couvre tout l'écran SAUF la barre du logo ; le
  // panneau commence au même endroit, sous elle. Le décalage — la hauteur de la
  // barre — est écrit une seule fois, dans `--h-topbar`.
  //
  // Le voile est monté par la PAGE, pas par chaque panneau : voir « UN SEUL
  // VOILE » au moment du rendu.
  //
  // Une version intermédiaire mesurait la page à l'ouverture
  // (`getBoundingClientRect`) pour n'assombrir que le kanban, en réécoutant
  // `resize` et `scroll`. Trois défauts, tous visibles :
  //
  //   1. À la première image, rien n'est encore mesuré : le voile couvrait tout
  //      l'écran puis sautait à sa place. C'était le flash.
  //   2. Entre deux mesures, il flottait à côté de la zone qu'il prétendait
  //      couvrir — pendant un défilement, un changement de largeur.
  //   3. Il fallait le maintenir : toute modification de la mise en page pouvait
  //      le décaler sans qu'aucun test ne s'en aperçoive.
  //
  // Rien à mesurer, donc rien à décaler et rien à entretenir.
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

    // ── QUELS LIENS DE SUIVI DONNENT UNE CARTE INSTAGRAM ─────────────────────
    //
    // Avant : tous. Chaque `prospect_link` devenait une carte Instagram, sans
    // qu'on regarde d'où venait la personne. Deux conséquences :
    //
    //   1. Un lien généré pour quelqu'un venu de YouTube le faisait apparaître
    //      dans l'onglet Instagram — et en DOUBLE, puisque son call YouTube lui
    //      donnait déjà une carte dans le bon onglet. Une personne, deux cartes,
    //      comptée deux fois dans le total de l'en-tête.
    //   2. La carte naissait à la GÉNÉRATION du lien, avant tout envoi. Un nom
    //      tapé par erreur créait un lead immédiatement, en « Calendly envoyé »
    //      alors que rien n'avait été envoyé.
    //
    // Deux règles désormais :
    //
    //   • Un lien qui porte un `prospect_id` appartient à quelqu'un venu
    //     d'ailleurs. Il n'entre pas ici : c'est le bloc YouTube/Autres qui le
    //     traite, dans l'onglet que sa source commande.
    //   • Sinon, il faut un SIGNAL RÉEL — la personne a cliqué, ou elle a un
    //     rendez-vous. Un lien seulement généré n'existe pas encore dans le
    //     pipeline.
    //
    // Un lead Instagram, lui, garde toujours sa carte : elle vient de
    // `data.leads`, pas du lien.
    const cheminDe = (url: string | null) => {
      if (!url) return null;
      try { return new URL(url).pathname.slice(1); } catch { return null; }
    };
    const lienDonneUneCarteIg = (p: ProspectLink) => {
      if (p.prospect_id) return false;
      if (p.ig_lead_id) return true;
      if (p.first_click_at) return true;
      const chemin = cheminDe(p.short_url);
      return !!chemin && data.calls.some(c => c.short_link_path === chemin && !c.ig_lead_id);
    };

    const allUsernames = new Set<string>([
      ...data.leads.map(l => l.ig_username.toLowerCase()),
      ...data.prospects.filter(lienDonneUneCarteIg).map(p => p.ig_username.toLowerCase()),
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
        classedAt:    override?.updated_at ?? null,
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
      const rdv = statsRdv(matchingCalls, new Date());
      // Réclamés : une ligne d'historique LM par commentaire du mot-clé.
      // Reçus : le clic sur le bouton du DM1, qui n'existe que depuis le
      // 2026-08-27 — l'écart reste donc à 0 sur tout l'historique antérieur.
      const lmClaimed = lead
        ? data.lmHistory.filter(h => h.ig_user_id === lead.ig_user_id).length
        : 0;
      const lmReceived = lead
        ? events.filter(e => e.ig_lead_id === lead.id && e.event_type === 'lm_link_requested').length
        : 0;
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
        derniereRelanceAt: state.flags.derniereRelanceAt,
        classedAt: state.classedAt,
        lastMoveAt,
        nextDue,
        ...rdv,
        lmClaimed,
        lmReceived,
        badge,
        lmNotReceived: lead && lead.source !== 'cold_dm' ? !lead.lead_magnet_sent : false,
        lmClickedAt: lmClickedEvent?.occurred_at ?? null,
        callId: call?.id ?? undefined,
        callScheduledAt: call?.scheduled_at ?? undefined,
        callStatus: call?.status ?? undefined,
        callOutcome: call?.outcome ?? null,
        callRevenue: call?.revenue ?? null,
        callComment: call?.lead_rapport_comment ?? null,
        callQualified: (call as { qualified?: boolean | null } | undefined)?.qualified ?? null,
        callObjection: call?.objection ?? null,
        callObjectionAutre: call?.objection_autre ?? null,
        callRelanceAt: call?.relance_at ?? null,
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
        derniereRelanceAt: state.flags.derniereRelanceAt,
        classedAt: state.classedAt,
        lastMoveAt,
        nextDue,
        ...statsRdv(groupCalls, new Date()),
        lmClaimed: 0,
        lmReceived: 0,
        badge,
        lmClickedAt: null,
        callId: call.id,
        callScheduledAt: call.scheduled_at,
        callStatus: call.status,
        callOutcome: call.outcome ?? null,
        callRevenue: call.revenue ?? null,
        callComment: call.lead_rapport_comment ?? null,
        callQualified: (call as { qualified?: boolean | null }).qualified ?? null,
        callObjection: call.objection ?? null,
        callObjectionAutre: call.objection_autre ?? null,
        callRelanceAt: call.relance_at ?? null,
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

    // ── LES LIENS DE SUIVI DE CES GENS-LÀ ───────────────────────────────────
    // Un lien généré pour quelqu'un venu d'ailleurs porte son `prospect_id`. Il
    // appartient donc à SON onglet, et c'est ici qu'il est lu — plus dans le bloc
    // Instagram, qui le rangeait au mauvais endroit.
    const liensParProspect = new Map<string, ProspectLink[]>();
    for (const pl of data.prospects) {
      if (!pl.prospect_id) continue;
      const l = liensParProspect.get(pl.prospect_id) ?? [];
      l.push(pl);
      liensParProspect.set(pl.prospect_id, l);
    }
    /** Le lien le plus récent d'un prospect, celui qui décrit son état actuel. */
    const dernierLien = (prospectId: string | null | undefined): ProspectLink | null => {
      if (!prospectId) return null;
      const l = liensParProspect.get(prospectId);
      if (!l || l.length === 0) return null;
      return l.slice().sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
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
      // Le lien de suivi n'ajoute rien à quelqu'un qui a déjà réservé : le
      // plancher reste « RDV pris ». Il sert seulement à faire exister la carte
      // AVANT le rendez-vous, plus bas.
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
        derniereRelanceAt: state.flags.derniereRelanceAt,
        classedAt: state.classedAt,
        ...statsRdv(calls, new Date()),
        lmClaimed: 0,
        lmReceived: 0,
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
        callQualified: (latestCall as { qualified?: boolean | null }).qualified ?? null,
        callObjection: latestCall.objection ?? null,
        callObjectionAutre: latestCall.objection_autre ?? null,
        callRelanceAt: latestCall.relance_at ?? null,
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

    // ── LES GENS QUI ONT CLIQUÉ UN LIEN DE SUIVI SANS ENCORE RÉSERVER ────────
    //
    // Ils n'ont aucun call, donc aucun des groupes ci-dessus ne les contient, et
    // le bloc Instagram ne les prend plus. Sans ce passage, quelqu'un qui vient
    // de cliquer le lien qu'on lui a envoyé disparaîtrait du pipeline jusqu'à ce
    // qu'il réserve — c'est-à-dire pile au moment où il faut le relancer.
    //
    // Leur onglet vient de la SOURCE du prospect, jamais du lien : une personne
    // reste là d'où elle vient, pour toujours. Un lien de suivi n'est pas un
    // signal d'appartenance, il ajoute un événement à un parcours existant.
    for (const prospect of data.nonIgProspects) {
      if (prospectGroups.has(prospect.id)) continue;   // il a déjà une carte
      const lien = dernierLien(prospect.id);
      if (!lien || !lien.first_click_at) continue;      // la carte naît au clic

      const override = effectiveOverrides.find(o => o.prospect_key === prospect.id);
      const state = resolveLeadState({
        signals: {
          linkClickedValid: true,
          minStageReached: (lien.min_stage_reached as StageKey | null) ?? null,
        },
        manualIssue:  override?.stage ?? null,
        manualReason: override?.reason ?? null,
      }, new Date());

      const src = prospect.source?.toLowerCase() ?? '';
      const carte: CardData = {
        key: prospect.id,
        name: prospect.name || 'Prospect',
        sub: SOURCE_LABELS[src] ?? 'Lien de suivi',
        date: timeAgo(lien.first_click_at),
        stageKey: state.issue ?? state.stage,
        stageIdx: 0,
        stage: state.stage,
        issue: state.issue,
        issueReason: state.issueReason,
        rapportEnRetard: false,
        relancesFaites: state.flags.relancesFaites,
        relanceDue: state.flags.relanceDue,
        derniereRelanceAt: state.flags.derniereRelanceAt,
        classedAt: state.classedAt,
        rdvCount: 0,
        rdvAnyMissed: false,
        rdvAllHonored: false,
        lastPastRdvAt: null,
        lmClaimed: 0,
        lmReceived: 0,
        lastMoveAt: lien.first_click_at,
        nextDue: computeNextDue(state, null, lien.first_click_at, new Date()),
        noSource: false,
        badge: null,
        naturalKey: state.stage,
        hasProspectLink: true,
        avatarUrl: null,
      };

      // L'onglet d'origine, et lui seul. `prospects.platform` vaut « other »
      // pour ig_bio / ig_description / ig_story alors que le pipeline range ces
      // gens dans Instagram : c'est la SOURCE qui commande, comme partout
      // ailleurs dans cet écran.
      if (src.startsWith('ig')) igCards.push(carte);
      else if (src.startsWith('yt')) ytCards.push(carte);
      else otherCards.push(carte);
    }
  }

  // Retire noSource des confirmés. Le filtre `dismissed` a disparu avec le
  // mécanisme lui-même : zéro ligne en base en un an d'usage, et « Ce n'est pas
  // un lead » (not_a_lead) couvrait déjà le besoin.
  const filteredYtCards = ytCards
    .map(c => confirmedKeys.has(c.key) ? { ...c, noSource: false } : c);

  const filteredOtherCards = otherCards;

  /**
   * Les cartes de l'onglet AFFICHÉ, avant les filtres réglables.
   *
   * Tout ce qui décrit « la page » se calcule là-dessus : le compteur de chaque
   * filtre, le nombre de rapports à remplir, et la liste finale. Ces trois-là
   * partaient de `igCards` en dur — Instagram, quel que soit l'onglet ouvert.
   * Le défaut était invisible tant que les filtres ne s'affichaient que sur
   * Instagram ; dès qu'ils apparaissent sur YouTube, ils y annoncent les
   * chiffres d'Instagram, et les filtres de YouTube ne filtraient rien du tout.
   */
  const cartesOnglet = tab === 'ig' ? igCards : tab === 'yt' ? filteredYtCards : filteredOtherCards;

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

  // Les quatre filtres réglables. Chacun est une question posée à une carte ;
  // aucun ne dépend d'un autre, ce qui permet de les cumuler en union sans
  // qu'ils se contredisent.
  const JOUR = 86400000;
  const anciennete = (iso: string | null | undefined) =>
    iso ? (Date.now() - new Date(iso).getTime()) / JOUR : null;

  const testeFiltre = (key: FiltreKey, e: EtatFiltre) => (c: CardData): boolean => {
    switch (key) {
      case 'sans_mouvement': {
        const j = anciennete(c.lastMoveAt);
        if (j === null) return false;
        return e.sens === 'moins' ? j < (e.seuil ?? 21) : j >= (e.seuil ?? 21);
      }
      case 'nb_rdv': {
        const n = c.rdvCount ?? 0;
        if (e.seuil === 0) return n === 0;
        if (n < (e.seuil ?? 1)) return false;
        if (e.variante === 'manque')  return !!c.rdvAnyMissed;
        if (e.variante === 'honores') return !!c.rdvAllHonored;
        return true;
      }
      case 'rendez_vous': {
        // Uniquement les rendez-vous PASSÉS : ceux à venir sont déjà lisibles
        // dans l'étape « RDV pris ».
        const j = anciennete(c.lastPastRdvAt);
        if (j === null) return false;
        return e.sens === 'moins' ? j < (e.seuil ?? 7) : j >= (e.seuil ?? 7);
      }
      case 'lead_magnets': {
        const n = e.variante === 'recus' ? (c.lmReceived ?? 0) : (c.lmClaimed ?? 0);
        return n >= (e.seuil ?? 1);
      }
    }
  };

  const rapportsARemplir = cartesOnglet.filter(c => c.rapportEnRetard).length;

  const filtresActifs: ((c: CardData) => boolean)[] = [];
  if (vue === 'liste' && filtreRapport) filtresActifs.push(c => !!c.rapportEnRetard);
  if (filterCanceled)    filtresActifs.push(isCanceled);
  if (filterRescheduled) filtresActifs.push(c => c.badge === 'rescheduled');
  // Les quatre filtres réglables n'existent qu'en vue liste : les appliquer au
  // board fausserait ses compteurs de colonne sans que rien ne l'indique.
  if (vue === 'liste') {
    for (const key of Object.keys(filtresReglables) as FiltreKey[]) {
      if (filtresReglables[key].actif) filtresActifs.push(testeFiltre(key, filtresReglables[key]));
    }
  }

  // Les filtres s'appliquent à l'onglet ouvert. Ils ne touchaient que les cartes
  // Instagram : sur YouTube, cliquer un filtre ne changeait rien — pire qu'un
  // filtre absent, puisque le bouton s'allumait quand même.
  const cartesFiltrees = filtresActifs.length === 0
    ? cartesOnglet
    : cartesOnglet.filter(c => filtresActifs.some(f => f(c)));

  // Ce que chaque filtre garderait, SEUL. Le compte doit rester lisible quand
  // plusieurs filtres sont actifs : afficher le résultat cumulé sur chaque
  // bouton ferait varier tous les chiffres à chaque clic, sans qu'on sache
  // lequel a bougé pourquoi.
  const comptesFiltres = Object.fromEntries(
    (Object.keys(filtresReglables) as FiltreKey[]).map(key =>
      [key, cartesOnglet.filter(testeFiltre(key, filtresReglables[key])).length],
    ),
  ) as Record<FiltreKey, number>;

  const cards = cartesFiltrees;

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

  // ── LES DOUBLONS SOUPÇONNÉS ────────────────────────────────────────────────
  // Calculé à chaque affichage, à partir des données déjà chargées : aucune
  // colonne d'état à tenir à jour, rien à recalculer, rien à purger. Seules les
  // DÉCISIONS sont stockées, et seulement pour ne jamais reposer une question
  // déjà répondue.
  const doublons = useMemo(() => {
    if (!data) return [];
    return detecterDoublons({
      leads:     data.leads,
      calls:     data.calls,
      prospects: data.nonIgProspects,
      decisions: data.fusions,
    });
  }, [data]);

  const trancherDoublon = useCallback(async (
    d: DoublonSoupconne,
    action: 'fusionner' | 'refuser',
  ) => {
    await mutate('/api/client/pipeline/fusion', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action, ig_lead_id: d.igLeadId, prospect_id: d.prospectId, call_ids: d.callIds,
      }),
      erreur: action === 'fusionner'
        ? "Les deux fiches n'ont pas pu être fusionnées."
        : "Le refus n'a pas pu être enregistré.",
    });
    // On relit tout : la fusion change l'appartenance de rendez-vous, donc les
    // cartes, les colonnes et les compteurs. Recalculer à la main ce que le
    // serveur vient de déplacer, c'est se préparer à diverger de lui.
    refetch();
  }, [refetch]);

  const separerFusion = useCallback(async (igLeadId: string, prospectId: string) => {
    await mutate('/api/client/pipeline/fusion', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'separer', ig_lead_id: igLeadId, prospect_id: prospectId }),
      erreur: "Les deux fiches n'ont pas pu être séparées.",
    });
    refetch();
  }, [refetch]);

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
        // Les réponses du parcours partent AVEC le résultat, jamais séparément :
        // c'est la même règle que le rapport de vente, et c'est ce qui empêche
        // qu'une objection se retrouve en base sur un call sans résultat.
        const patch: Record<string, any> = { ...ISSUE_TO_OUTCOME[issue] };
        // « Pas qualifié » répond déjà à la question : son intitulé EST la
        // réponse, et il ne faut pas qu'une réponse antérieure la contredise.
        if (issue === 'not_qualified') patch.qualified = false;
        else if (typeof extraData?.qualified === 'boolean') patch.qualified = extraData.qualified;
        if (extraData?.objection) {
          patch.objection = extraData.objection;
          patch.objection_autre = extraData.objection === 'autre' && extraData.objectionAutre
            ? extraData.objectionAutre : null;
        }
        if (extraData?.relanceAt) patch.relance_at = extraData.relanceAt;
        await patchCall(callId, patch);
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
  // Les trois onglets AVANT filtrage. Il partait de la liste Instagram déjà
  // filtrée : le total annoncé baissait dès qu'un filtre était actif, ce qui le
  // faisait lire comme un résultat de recherche alors que c'est un inventaire.
  const totalProspects = igCards.length + filteredYtCards.length + filteredOtherCards.length;
  // Le compteur du bouton mobile porte TOUS les filtres actifs, réglables
  // compris : n'en compter qu'une partie ferait replier la barre en annonçant
  // « 0 » alors que la liste est bel et bien filtrée.
  const activeFilterCount =
    [filterCanceled, filterRescheduled].filter(Boolean).length +
    (Object.keys(filtresReglables) as FiltreKey[]).filter(k => filtresReglables[k].actif).length;
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
          {/* Une seule ligne. La phrase sur deux lignes qui expliquait le
              fonctionnement mangeait 20 px de hauteur à chaque chargement, pour
              une consigne qu'on lit une fois. Elle passe en infobulle du titre. */}
          <p className="page-sub" style={{ fontSize: 12 }}
             title="Le pipeline se met à jour tout seul · glisse une carte pour la déplacer, le système reprendra sa position dès qu'un nouvel événement sera détecté">
            {loading ? 'Chargement…' : `${totalProspects} lead${totalProspects !== 1 ? 's' : ''} · ${tab === 'ig' ? 'Instagram' : tab === 'yt' ? 'YouTube' : 'Autres'}`}
          </p>
        </div>

        {/* pipeline-actions : sur mobile, "Rafraichir" et les 3 onglets ne
            tiennent pas cote a cote (mesure a 375px : 388px de contenu).
            Plutot que de compresser les onglets, le bouton remonte a cote du
            titre (order: -1 + position absolue) et les onglets prennent toute
            la largeur en pilules. */}
        {/* `marginLeft: auto` : le bandeau du haut passe à la ligne quand titre et
            actions ne tiennent pas côte à côte (flexWrap). Sans cette marge, le
            groupe retombait COLLÉ À GAUCHE sous le titre — d'où le « flash » à
            droite puis le saut à gauche, au moment où les polices chargées
            changent les largeurs et déclenchent le retour à la ligne. La marge
            automatique le garde à droite dans les deux cas. */}
        {/* RANGÉE 1, à droite — ce qui pilote l'AFFICHAGE : rafraîchir, et board
            ou liste. Les onglets de plateforme sont sur la rangée du dessous :
            ils changent le PÉRIMÈTRE, pas la vue. */}
        <div className="pipeline-actions" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
          gap: 8, flex: 1, minWidth: 0,
        }}>

          {/* Le périmètre — quelle plateforme la page raconte — puis un trait,
              puis ce qui pilote l'affichage. Deux natures distinctes, mais sur
              UNE seule ligne.

              Empilés sous Board/Liste, ils doublaient la hauteur de la colonne
              de droite : d'où le vide au-dessus du titre, le vide sous les
              onglets, et une rangée de filtres repoussée d'autant. Pire en vue
              liste, où ils volaient 320 px à la barre de filtres et la
              faisaient passer de une à cinq rangées. */}
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
          <div style={{ width: 1, height: 22, background: 'var(--border)', flexShrink: 0, margin: '0 2px' }} className="pipeline-desktop" />
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
        </div>
      </div>

      {/* Un seul bandeau à la fois, même quand plusieurs paires attendent : deux
          questions côte à côte se répondent au hasard. La suivante apparaît dès
          que celle-ci est tranchée. */}
      {doublons.length > 0 && (
        <BandeauDoublon
          doublon={doublons[0]}
          restants={doublons.length - 1}
          onFusionner={() => trancherDoublon(doublons[0], 'fusionner')}
          onRefuser={() => trancherDoublon(doublons[0], 'refuser')}
        />
      )}

      {/* ── RANGÉE 2 : le périmètre à droite, les filtres à gauche ──────────
          Les onglets étaient empilés sous Rafraîchir/Board/Liste, dans une
          colonne de droite deux fois plus haute que le titre. D'où les deux
          vides que ça creusait — un au-dessus du titre, un sous les onglets —
          et une rangée de filtres poussée encore plus bas.

          Les deux blocs de commandes partagent maintenant cette rangée : les
          onglets gardent leur place sous Board/Liste, les filtres viennent
          occuper le vide à leur gauche, et la rangée qui leur était réservée
          disparaît. Le kanban remonte d'autant. */}
      <div className="pipeline-rang2" style={{
        // `flex-start` et non `center` : les onglets restent collés en haut de la
        // rangée. Sinon ils descendaient dès que la colonne de gauche gagnait une
        // ligne — les boutons d'étapes en vue liste — et il fallait les
        // rechercher à chaque bascule Board/Liste.
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: 10, flexShrink: 0, flexWrap: 'wrap', rowGap: 8,
      }}>
        {/* En COLONNE, étirée : les filtres sont eux-mêmes une rangée qui se
            replie, et posés en ligne ils gardaient leur largeur de contenu
            (1310 px mesurés dans une colonne de 824) au lieu de passer à la
            ligne. Un enfant de flex ne descend pas sous sa largeur minimale de
            contenu ; empilé et étiré, il prend la largeur de la colonne. */}
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'stretch',
          gap: 6, minWidth: 0, flex: 1,
        }}>
      {/* Filtres IG */}
      {/* Sur mobile les 6 filtres occupent deux rangees pleines, soit ~80px pris
          sur un budget vertical de ~620px — assez pour pousser la fin de
          l'entonnoir hors ecran. Ils sont secondaires : on vient lire
          l'entonnoir, pas filtrer. D'ou le repli, avec le nombre de filtres
          actifs sur le bouton pour qu'un filtrage en cours reste visible meme
          replie. Le desktop les affiche toujours (.pipeline-desktop). */}
      {/* Sur TOUTES les plateformes. Les etapes et les filtres etaient reserves a
          Instagram : YouTube et « Autres » avaient une liste sans aucun moyen
          d'isoler une issue ni de retrouver un rapport a remplir. Ils ont moins
          d'etapes — une seule, « RDV pris » — mais les cinq issues et les etats
          du rendez-vous sont les memes partout. Seul « Lead magnets » disparait :
          un lead YouTube arrive par un lien en description, il n'en reclame
          jamais. */}
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
      {/* L'ORDRE COMPTE : les étapes d'abord, les filtres ensuite. Les étapes
          disent OÙ on regarde, les filtres QUOI on garde dedans — l'inverse
          obligeait à filtrer avant de savoir sur quoi. */}
      {vue === 'liste' && (
        <div className="pipeline-desktop" style={{ flexShrink: 0, marginBottom: 4 }}>
          {/* Les boutons d'étapes et d'issues PASSENT À LA LIGNE : tout est
              visible d'un coup, sans défilement horizontal. Une barre qui
              défile cache la moitié des étapes, et il faut alors se souvenir
              de ce qu'on ne voit pas pour choisir.

              Les étapes portent une pastille ronde, les issues un carré plein :
              deux natures, deux formes. Cliquer isole une case ; recliquer
              revient à tout. */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 0, flexShrink: 0 }}>
            <BoutonCase
              label="Tous" n={cards.length} actif={caseIsolee === null}
              onClick={() => setCaseIsolee(null)}
            />
            {stages.map(s => (
              <BoutonCase
                key={s.key} label={s.label} couleur={s.color} forme="rond"
                n={cards.filter(c => c.stageKey === s.key).length}
                actif={caseIsolee === s.key}
                onClick={() => setCaseIsolee(k => k === s.key ? null : s.key)}
              />
            ))}
            {/* Les issues ne sont pas la suite des étapes : les aligner à la
                queue leur donnerait l'air d'en être. Deux façons de le dire,
                selon la place.

                Instagram a sept étapes : elles remplissent la rangée, et le
                retour à la ligne sépare naturellement les deux natures.

                YouTube et « Autres » n'en ont qu'une. Forcer le retour laissait
                une rangée presque vide au-dessus d'une rangée d'issues — une
                rangée entière de page pour deux boutons. Un trait vertical dit
                la même chose sur la même ligne. */}
            {stages.length >= 4 ? (
              <div style={{ flexBasis: '100%', height: 0 }} />
            ) : (
              <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--border)', margin: '0 5px', flexShrink: 0 }} />
            )}
            {ISSUES.map(i => (
              <BoutonCase
                key={i.key} label={i.label} couleur={i.color} forme="carre" issueKey={i.key}
                n={cards.filter(c => c.stageKey === i.key).length}
                actif={caseIsolee === i.key}
                onClick={() => setCaseIsolee(k => k === i.key ? null : i.key)}
              />
            ))}
          </div>
        </div>
      )}
      <div
          className={`pipeline-filters${filtersOpen ? ' is-open' : ''}`}
          style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap' }}
        >
          {/* Vue LISTE seulement. Dans le board, un filtre CACHE des fiches sans
              dire lesquelles : les colonnes gardent leur nom mais leur compteur
              change, et « RDV pris 2 » ne dit plus si c'est deux leads ou deux
              leads qui passent le filtre. Le board répond à « où en est tout le
              monde » — il doit tout montrer. */}
          {/* En TÊTE, et en rouge : c'est la seule chose qui bloque une
              statistique tant qu'elle n'est pas faite. Les autres filtres
              cherchent, celui-ci rappelle. */}
          {vue === 'liste' && rapportsARemplir > 0 && (
            <button
              type="button"
              onClick={() => setFiltreRapport(v => !v)}
              aria-pressed={filtreRapport}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7, minHeight: 32,
                padding: '0 11px', borderRadius: 8, cursor: 'pointer', font: 'inherit',
                fontSize: 11.5, fontWeight: 600,
                background: filtreRapport ? '#cd5b3f' : '#cd5b3f18',
                border: `1px solid ${filtreRapport ? '#cd5b3f' : '#e2b3a5'}`,
                color: filtreRapport ? '#fff' : '#cd5b3f',
              }}
            >
              Rapport à remplir
              <span style={{
                fontSize: 10.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                color: filtreRapport ? 'rgba(255,255,255,.8)' : '#cd5b3f',
              }}>{rapportsARemplir}</span>
            </button>
          )}
          {vue === 'liste' && (
            <PipelineFilters
              etats={filtresReglables}
              cles={tab === 'ig' ? undefined : FILTRES_SANS_LM}
              onChange={changerFiltre}
              comptes={comptesFiltres}
              tactile={tactile}
            />
          )}
          {[
            // No-shows / Pas qualifiés / À recontacter sont devenus des colonnes,
            // et Archivés reposait sur un mécanisme jamais utilisé (0 ligne en
            // base). Restent les deux états du RENDEZ-VOUS, qui n'ont pas de
            // colonne parce qu'ils ne disent rien du résultat du lead : la carte
            // reste en « RDV pris » et seul ce bouton permet de la retrouver.
            // « Annulés » et « Reportés » ne disaient pas de QUOI : ce sont des
            // états du RENDEZ-VOUS, pas du lead. Et en gris sur fond transparent,
            // ils ne ressemblaient pas à des boutons — d'où le même dessin que
            // les autres filtres, avec leur couleur.
            { key: 'canceled', label: 'Appels annulés', value: filterCanceled, set: setFilterCanceled, color: '#7C3AED', bg: '#F5F3FF' },
            { key: 'rescheduled', label: 'Appels reportés', value: filterRescheduled, set: setFilterRescheduled, color: '#d97706', bg: '#fffbeb' },
          ].map(f => (
            <button
              key={f.key}
              onClick={() => f.set(!f.value)}
              className="pipeline-filter"
              style={{
                minHeight: 32, padding: '0 11px', fontSize: 11.5,
                display: 'inline-flex', alignItems: 'center',
                fontWeight: 600, borderRadius: 8, cursor: 'pointer',
                border: `1px solid ${f.value ? f.color : 'var(--border)'}`,
                background: f.value ? f.bg : 'var(--surface)',
                color: f.value ? f.color : 'var(--ink-2)',
                transition: 'all .12s',
              }}
            >
              {f.label}
            </button>
          ))}
          {anyFilter && (
            <button
              onClick={() => { setFilterCanceled(false); setFilterRescheduled(false); setFiltresReglables(FILTRES_VIDES); }}
              className="pipeline-filter"
              style={{ fontWeight: 500, borderRadius: 6, cursor: 'pointer', border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)' }}
            >
              Effacer filtres
            </button>
          )}

        </div>
        </div>

      </div>

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
        <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
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
              cards={caseIsolee ? cards.filter(c => c.stageKey === caseIsolee) : cards}
              columns={caseIsolee ? columns.filter(c => c.key === caseIsolee) : columns}
              stageKeys={stages.map(s => s.key)}
              tri={tri}
              avatarColor={avatarColor}
              avatarInitials={avatarInitials}
              onCardClick={cardKey => setDetailModal({ cardKey, platform: tab })}
              onRapportClick={c => c.callId && setRapportModal({
                callId: c.callId,
                inviteeName: c.name,
                scheduledAt: c.callScheduledAt ?? '',
                isFollowUp: c.callIsFollowUp ?? false,
                existing: {
                  revenue: c.callRevenue ?? null, comment: c.callComment ?? null,
                  outcome: c.callOutcome ?? null, qualified: c.callQualified ?? null,
                  objection: c.callObjection ?? null, objectionAutre: c.callObjectionAutre ?? null,
                  relanceAt: c.callRelanceAt ?? null,
                },
              })}
              onBulkDelete={handleBulkDelete}
              onBulkNotALead={handleBulkNotALead}
              onBulkRelance={handleBulkRelance}
              tris={TRIS}
              onTri={setTri}
            />
          </div>
        ) : (
        // Fond crème continu, aucune surface intermédiaire : le board n'est pas
        // une carte, les colonnes non plus. Seules les fiches en sont.
        <div className="pipeline-desktop" style={{ flex: 1, overflowX: 'auto', overflowY: 'auto', paddingBottom: 16, scrollbarWidth: 'thin', scrollbarColor: 'var(--border) transparent' }}>
          {/* `minHeight` et non `height` : à 100 % de hauteur, la rangée se calait sur la
              partie VISIBLE du board. Dès qu'une colonne dépassait, les colonnes
              s'arrêtaient net au milieu du défilement — la limite du bas se
              retrouvait plus haut que le contenu. En minimum, elles remplissent
              l'écran quand il y a peu de fiches ET s'étirent quand il y en a
              beaucoup. */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'stretch', minWidth: '100%', minHeight: '100%' }}>
            {stages.map(stage => {
              const estIssue = false;
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
                  estIssue={estIssue}
                  replie={colonnesRepliees.has(stage.key)}
                  onToggleRepli={() => setColonnesRepliees(prev => {
                    const n = new Set(prev);
                    if (n.has(stage.key)) n.delete(stage.key); else n.add(stage.key);
                    try { window.localStorage.setItem('pipeline-colonnes-repliees', JSON.stringify([...n])); } catch { /* sans effet */ }
                    return n;
                  })}
                />
              );
            })}

            <TuilesIssues
              issues={ISSUES}
              cardsParIssue={Object.fromEntries(
                ISSUES.map(i => [i.key, cards.filter(c => c.stageKey === i.key)]),
              )}
              ouverte={null}
              onOuvrir={key => setPanneauIssue(key)}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              dropTarget={dropTarget}
              rendreCarte={card => (
                <PipelineCard
                  key={card.key}
                  card={card}
                  stages={stages}
                  isDragging={draggingKey === card.key}
                  onDragStart={handleDragStart}
                  platform={platform}
                  onConfirmLead={key => { setConfirmedKeys(prev => new Set([...prev, key])); saveOverride(key, platform, 'confirmed_lead'); }}
                  onDeleteLead={handleDeleteLead}
                  onNotALead={handleNotALead}
                  onRapportClick={(callId, inviteeName, scheduledAt, isFollowUp, existing) => setRapportModal({ callId, inviteeName, scheduledAt, isFollowUp, existing })}
                  onCardClick={cardKey => setDetailModal({ cardKey, platform })}
                />
              )}
            />
          </div>
        </div>
        )}
        {/* ── UN SEUL VOILE, POUR TOUS LES PANNEAUX ─────────────────────────
            Chaque panneau dessinait le sien. Cliquer un lead depuis une issue
            ferme le panneau d'issue et ouvre la fiche dans le même rendu : le
            voile du premier était démonté, celui du second monté, et il
            rejouait son fondu depuis l'opacité zéro. L'écran s'éclaircissait
            puis s'assombrissait en 140 ms — le flash.

            Monté ici, c'est le MÊME élément qui reste en place pendant que le
            panneau change dessous. Il n'a rien à rejouer. */}
        {(panneauIssue || detailModal) && (
          <div
            className="pipeline-voile"
            aria-hidden
            onClick={() => { setPanneauIssue(null); setDetailModal(null); }}
          />
        )}

        {panneauIssue && (() => {
          const issue = ISSUES.find(i => i.key === panneauIssue);
          if (!issue) return null;
          return (
            <PanneauIssue
              issue={issue}
              cards={cards.filter(c => c.stageKey === panneauIssue)}
              onFermer={() => setPanneauIssue(null)}
              onOuvrirFiche={key => { setPanneauIssue(null); setDetailModal({ cardKey: key, platform: tab }); }}
              onRelancer={key => handleBulkRelance([key])}
              avatarColor={avatarColor}
              avatarInitials={avatarInitials}
            />
          );
        })()}

        {detailModal && data && (() => {
          const ctx = resolveProspectContext(detailModal.cardKey, detailModal.platform, data);
          if (!ctx) return null;
          const detailStages = detailModal.platform === 'ig' ? IG_STAGES : YT_STAGES;
          const sourceCards = detailModal.platform === 'ig' ? igCards : detailModal.platform === 'yt' ? filteredYtCards : filteredOtherCards;
          const matchedCard = sourceCards.find(c => c.key === detailModal.cardKey);
          // Le badge affiche la CASE où la fiche se range — l'issue quand le lead
          // est classé, l'étape sinon. Passer par `stageIdx` ne donnait que
          // l'étape : un lead perdu s'annonçait « En conversation ».
          const stageIdx = matchedCard ? matchedCard.stageIdx : 0;
          const stage =
            (matchedCard && [...detailStages, ...ISSUES].find(s => s.key === matchedCard.stageKey))
            ?? detailStages[stageIdx] ?? detailStages[0];
          const displayName = matchedCard
            ? (detailModal.platform === 'ig' && !matchedCard.isIgLink ? `@${matchedCard.name}` : matchedCard.name)
            : (ctx.lead?.ig_username ? `@${ctx.lead.ig_username}` : ctx.calls[0]?.invitee_name || 'Prospect');
          // La fusion de CE lead, s'il en a une. On cherche par `ig_lead_id` :
          // c'est la seule clé stable, le pseudo peut changer.
          const fusionDuLead = ctx.lead
            ? data.fusions.find(f => f.ig_lead_id === ctx.lead!.id && f.statut === 'fusionnee')
            : undefined;
          const prospectFusionne = fusionDuLead
            ? data.nonIgProspects.find(p => p.id === fusionDuLead.prospect_id)
            : undefined;
          return (
            <ProspectDetailModal
              context={ctx}
              displayName={displayName}
              stageLabel={stage.label}
              stageColor={stage.color}
              onClose={() => setDetailModal(null)}
              commePanneau={!tactile}
              fusion={fusionDuLead ? {
                nom: prospectFusionne?.name || 'une fiche e-mail',
                date: new Date(fusionDuLead.decided_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }),
                onSeparer: () => { setDetailModal(null); separerFusion(fusionDuLead.ig_lead_id, fusionDuLead.prospect_id); },
              } : null}
            />
          );
        })()}
        </div>
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
    </div>
  );
}
