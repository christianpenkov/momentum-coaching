'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';

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
}

interface ProspectLink {
  id: string;
  ig_username: string;
  short_url: string;
  content_id: string | null;
  created_at: string;
  humanClicks30d?: number;
  calendly_link_sent: boolean;
  calendly_link_sent_at: string | null;
  first_click_at: string | null;
}

interface Call {
  id: string;
  invitee_name: string;
  invitee_email: string;
  scheduled_at: string;
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
  cancellation_reason: string | null;
  lead_deleted: boolean;
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

interface PipelineData {
  leads: IgLead[];
  prospects: ProspectLink[];
  nonIgProspects: NonIgProspect[];
  calls: Call[];
  overrides: Override[];
  events: ProspectEvent[];
}

// ── Colonnes ──────────────────────────────────────────────────────────────────

const IG_STAGES = [
  { key: 'lm_sent',       label: 'Lead Commentaire / LM reçu', color: '#7C3AED', lightBg: '#F5F3FF', dot: '#7C3AED' },
  { key: 'in_convo',      label: 'En conversation',   color: '#9333EA', lightBg: '#FDF4FF', dot: '#9333EA' },
  { key: 'calendly_sent', label: 'Calendly envoyé',   color: '#D97706', lightBg: '#FFFBEB', dot: '#D97706' },
  { key: 'link_clicked',  label: 'Lien Calendly cliqué', color: '#EA580C', lightBg: '#FFF7ED', dot: '#EA580C' },
  { key: 'call_booked',   label: 'Call booké',         color: '#2563EB', lightBg: '#EFF6FF', dot: '#2563EB' },
  { key: 'showed_up',     label: 'Show up',            color: '#059669', lightBg: '#ECFDF5', dot: '#059669' },
  { key: 'closed',        label: 'Closé',              color: '#047857', lightBg: '#D1FAE5', dot: '#047857' },
] as const;

const YT_STAGES = [
  { key: 'call_booked', label: 'Call booké', color: '#2563EB', lightBg: '#EFF6FF', dot: '#2563EB' },
  { key: 'showed_up',   label: 'Show up',    color: '#059669', lightBg: '#ECFDF5', dot: '#059669' },
  { key: 'closed',      label: 'Closé',      color: '#047857', lightBg: '#D1FAE5', dot: '#047857' },
] as const;

type IgStageKey = typeof IG_STAGES[number]['key'];
type YtStageKey = typeof YT_STAGES[number]['key'];

// Ensembles pour la règle pré-call / post-call
const POST_CALL_STAGES = new Set(['call_booked', 'showed_up', 'closed']);
const PRE_CALL_STAGES  = new Set(['lm_sent', 'in_convo', 'calendly_sent', 'link_clicked']);

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400000);
  if (d === 0) return "Aujourd'hui";
  if (d === 1) return 'Hier';
  if (d < 7) return `${d}j`;
  if (d < 30) return `${Math.floor(d / 7)}sem`;
  return `${Math.floor(d / 30)}mois`;
}

const AVATAR_COLORS = ['#7C3AED','#2563EB','#059669','#D97706','#EA580C','#DB2777','#0891B2','#65A30D'];
function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function avatarInitials(name: string): string {
  return name.replace(/^@/, '').split(/[\s._-]/).map(w => w[0] || '').join('').toUpperCase().slice(0, 2) || '??';
}

// ── resolveStage ──────────────────────────────────────────────────────────────

function resolveStage(
  naturalKey: string,
  overrideKey: string | null | undefined,
  stages: readonly { key: string }[],
  overrideReason?: string | null,
): string {
  if (!overrideKey) return naturalKey;

  const naturalIdx  = stages.findIndex(s => s.key === naturalKey);
  const overrideIdx = stages.findIndex(s => s.key === overrideKey);

  // Override manuel :
  // - Backward (override < natural) : recul conscient du coach → tient toujours,
  //   le pipeline naturel ne peut pas l'annuler.
  // - Forward (override > natural) : avance manuelle → tient jusqu'à ce que le
  //   naturel rattrape ou dépasse (naturalIdx >= overrideIdx).
  if (overrideReason === 'manual') {
    const isBackward = overrideIdx < naturalIdx;
    if (isBackward) return overrideKey;
    if (naturalIdx >= overrideIdx) return naturalKey;
    return overrideKey;
  }

  // Override automatique : naturel >= override → on suit le naturel
  if (naturalIdx >= overrideIdx) return naturalKey;
  return overrideKey;
}

// ── getBestKnownStage ─────────────────────────────────────────────────────────
// Meilleure étape connue d'un lead avant call_booked, basée sur prospect_events

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
  if (leadEvents.some(e => e.event_type === 'calendly_link_sent')) return 'calendly_sent';
  if (lead?.hook_replied) return 'in_convo';
  return 'lm_sent';
}

// ── Card ──────────────────────────────────────────────────────────────────────

interface CardData {
  key: string;
  name: string;
  sub: string;
  date: string;
  stageKey: string;
  stageIdx: number;
  extra?: string;
  noSource?: boolean;
  // Badges post-call
  badge?: 'no_show' | 'rescheduled' | null;
  lmClickedAt?: string | null;
  // Pour afficher le bouton compte-rendu
  callId?: string;
  callScheduledAt?: string;
  callStatus?: string;
}

function PipelineCard({
  card, stages, isDragging, onDragStart, platform, onConfirmLead, onDismissLead, onDeleteLead,
}: {
  card: CardData;
  stages: typeof IG_STAGES | typeof YT_STAGES;
  isDragging: boolean;
  onDragStart: (e: React.DragEvent, cardKey: string) => void;
  platform: 'ig' | 'yt' | 'other';
  onConfirmLead?: (key: string) => void;
  onDismissLead?: (key: string) => void;
  onDeleteLead?: (key: string) => void;
}) {
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const stage = stages[card.stageIdx] ?? stages[0];
  const ac = avatarColor(card.name);

  // Bouton "Remplir compte-rendu" visible dès le début du call
  const now = Date.now();
  const showCompteRendu = card.callId && card.callScheduledAt && card.callStatus === 'active'
    && new Date(card.callScheduledAt).getTime() <= now;

  return (
    <>
    <div
      draggable
      data-pipeline-card
      onDragStart={e => onDragStart(e, card.key)}
      onContextMenu={e => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY }); }}
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
        <div style={{
          width: 26, height: 26, borderRadius: 7, background: ac, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10, fontWeight: 700, color: '#fff', letterSpacing: '.03em',
        }}>
          {avatarInitials(card.name)}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 5 }}>
            @{card.name}
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
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2, flexWrap: 'wrap' }}>
            {card.sub && (
              <span style={{ fontSize: 10, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {card.sub}
              </span>
            )}
            {card.lmClickedAt && (
              <span
                title={`Lead magnet ouvert le ${new Date(card.lmClickedAt).toLocaleDateString('fr-FR')}`}
                style={{ fontSize: 9, fontWeight: 700, background: '#f0fdf4', color: '#16a34a', border: '1px solid #86efac', borderRadius: 4, padding: '1px 5px', flexShrink: 0 }}
              >
                ✓ LM
              </span>
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

      {/* Bouton compte-rendu dès le début du call */}
      {showCompteRendu && (
        <a
          href={`/client/calls?rapport=${card.callId}`}
          draggable={false}
          onMouseDown={e => e.stopPropagation()}
          style={{
            display: 'block', textAlign: 'center', fontSize: 10, fontWeight: 600,
            padding: '5px 8px', borderRadius: 6,
            background: '#EFF6FF', color: '#2563EB',
            border: '1px solid #BFDBFE',
            textDecoration: 'none', transition: 'all .12s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#2563EB'; (e.currentTarget as HTMLElement).style.color = '#fff'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#EFF6FF'; (e.currentTarget as HTMLElement).style.color = '#2563EB'; }}
        >
          Remplir compte-rendu
        </a>
      )}

      {platform === 'yt' && card.noSource && (
        <div draggable={false} style={{ marginTop: 4, borderRadius: 8, background: 'var(--surface-2)', border: '1px solid var(--border)', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 500 }}>
            Source inconnue — est-ce bien un lead ?
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onMouseDown={e => { e.stopPropagation(); onConfirmLead?.(card.key); }}
              style={{ flex: 1, padding: '5px 0', fontSize: 10, fontWeight: 600, cursor: 'pointer', borderRadius: 6, border: '1px solid #2563EB', background: '#EFF6FF', color: '#2563EB', transition: 'all .12s' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#2563EB'; e.currentTarget.style.color = '#fff'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#EFF6FF'; e.currentTarget.style.color = '#2563EB'; }}
            >
              Oui, c'est un lead
            </button>
            <button
              onMouseDown={e => { e.stopPropagation(); onDismissLead?.(card.key); }}
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
            Supprimer @{card.name}
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
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Supprimer @{card.name} ?</div>
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
              onMouseDown={() => { if (!deleteConfirmed) return; setConfirmDelete(false); setDeleteConfirmed(false); onDeleteLead?.(card.key); }}
              style={{ padding: '7px 16px', fontSize: 12, fontWeight: 600, borderRadius: 7, border: 'none', background: '#dc2626', color: '#fff', cursor: deleteConfirmed ? 'pointer' : 'not-allowed', opacity: deleteConfirmed ? 1 : 0.4 }}
            >
              Supprimer
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
  isDropTarget, platform, onConfirmLead, onDismissLead, onDeleteLead,
}: {
  stage: typeof IG_STAGES[number] | typeof YT_STAGES[number];
  cards: CardData[];
  stages: typeof IG_STAGES | typeof YT_STAGES;
  draggingKey: string | null;
  onDragStart: (e: React.DragEvent, key: string) => void;
  onDrop: (e: React.DragEvent, stageKey: string) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  isDropTarget: boolean;
  platform: 'ig' | 'yt' | 'other';
  onConfirmLead?: (key: string) => void;
  onDismissLead?: (key: string) => void;
  onDeleteLead?: (key: string) => void;
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
            onDismissLead={onDismissLead}
            onDeleteLead={onDeleteLead}
          />
        ))}
      </div>
    </div>
  );
}

// ── ConfirmMoveModal ──────────────────────────────────────────────────────────

type ConfirmCase =
  | 'backward_from_post_call'   // recul depuis call_booked / showed_up / closed
  | 'forward_to_call_booked'    // avancée manuelle vers call_booked
  | 'forward_to_showed_up'      // avancée manuelle vers showed_up
  | 'forward_to_closed'         // avancée manuelle vers closed
  | 'simple_move';              // tout autre déplacement

interface ConfirmMoveModalProps {
  case: ConfirmCase;
  cardName: string;
  targetStageLabel: string;
  callId: string | null;
  onConfirm: (reason: string, extraData?: Record<string, any>) => void;
  onCancel: () => void;
}

function ConfirmMoveModal({ case: modalCase, cardName, targetStageLabel, callId, onConfirm, onCancel }: ConfirmMoveModalProps) {
  const [reason, setReason] = useState('');

  const backwardReasons = [
    { value: 'canceled',    label: 'Call annulé' },
    { value: 'rescheduled', label: 'Call reporté (nouvelle date à fixer)' },
    { value: 'error',       label: "Erreur d'attribution (jamais réservé)" },
    { value: 'cold',        label: 'Lead refroidi / plus intéressé' },
  ];

  return createPortal(
    <>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 10001 }} onMouseDown={onCancel} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        zIndex: 10002, background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 12, padding: '24px 28px', minWidth: 340, maxWidth: 420,
        boxShadow: '0 8px 32px rgba(0,0,0,.18)',
      }}>
        {modalCase === 'backward_from_post_call' && (
          <>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Déplacer @{cardName} en arrière</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>Quelle est la raison de ce déplacement ?</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
              {backwardReasons.map(r => (
                <label key={r.value} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '8px 12px', borderRadius: 8, border: `1px solid ${reason === r.value ? '#2563EB' : 'var(--border)'}`, background: reason === r.value ? '#EFF6FF' : 'transparent', transition: 'all .12s' }}>
                  <input
                    type="radio"
                    name="reason"
                    value={r.value}
                    checked={reason === r.value}
                    onChange={() => setReason(r.value)}
                    style={{ accentColor: '#2563EB' }}
                  />
                  <span style={{ fontSize: 12, fontWeight: 500, color: reason === r.value ? '#2563EB' : 'var(--ink)' }}>{r.label}</span>
                </label>
              ))}
            </div>
          </>
        )}

        {modalCase === 'forward_to_call_booked' && (
          <>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Confirmer un call manuel ?</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 20 }}>
              Un appel a bien été réservé manuellement ? Cela ne crée pas d&apos;entrée Calendly.
            </div>
          </>
        )}

        {modalCase === 'forward_to_showed_up' && (
          <>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Marquer comme présent ?</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 20 }}>
              Confirmer que @{cardName} s&apos;est présenté à l&apos;appel ?
            </div>
          </>
        )}

        {modalCase === 'forward_to_closed' && (
          <>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Marquer comme deal fermé ?</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 20 }}>
              Cette action compte dans les statistiques de conversion.
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

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onMouseDown={onCancel}
            style={{ padding: '7px 16px', fontSize: 12, fontWeight: 600, borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer' }}
          >
            Annuler
          </button>
          <button
            onMouseDown={() => {
              if (modalCase === 'backward_from_post_call' && !reason) return;
              onConfirm(reason || 'manual');
            }}
            disabled={modalCase === 'backward_from_post_call' && !reason}
            style={{
              padding: '7px 16px', fontSize: 12, fontWeight: 600, borderRadius: 7, border: 'none',
              background: modalCase === 'backward_from_post_call' && !reason ? 'var(--border)' : '#2563EB',
              color: modalCase === 'backward_from_post_call' && !reason ? 'var(--muted)' : '#fff',
              cursor: modalCase === 'backward_from_post_call' && !reason ? 'not-allowed' : 'pointer',
            }}
          >
            Confirmer
          </button>
        </div>
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
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(new Set());
  const [confirmedKeys, setConfirmedKeys] = useState<Set<string>>(new Set());
  const dropCounters = useRef<Record<string, number>>({});

  const [refreshing, setRefreshing] = useState(false);

  // Filtres
  const [filterNoShow, setFilterNoShow] = useState(false);
  const [filterArchived, setFilterArchived] = useState(false);
  const [filterCanceled, setFilterCanceled] = useState(false);
  const [filterRescheduled, setFilterRescheduled] = useState(false);

  // Modale de confirmation drag-and-drop
  const [confirmModal, setConfirmModal] = useState<{
    case: ConfirmCase;
    cardKey: string;
    cardName: string;
    targetStageKey: string;
    targetStageLabel: string;
    callId: string | null;
  } | null>(null);

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
      setDismissedKeys(new Set(data.overrides.filter((o: Override) => o.stage === 'dismissed').map((o: Override) => o.prospect_key)));
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

  const saveOverride = useCallback(async (key: string, platform: 'ig' | 'yt' | 'other', stage: string, reason?: string) => {
    setOverrides(prev => {
      const idx = prev.findIndex(o => o.prospect_key === key && o.platform === platform);
      const entry: Override = { prospect_key: key, platform, stage, updated_at: new Date().toISOString(), reason };
      return idx >= 0 ? prev.map((o, i) => i === idx ? entry : o) : [...prev, entry];
    });
    await fetch('/api/client/pipeline', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prospect_key: key, platform, stage, reason }),
    });
  }, []);

  const patchCall = useCallback(async (callId: string, fields: Record<string, any>) => {
    await fetch(`/api/client/calls/${callId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(fields),
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
      const linkClickedValid = prospect?.first_click_at &&
        prospect?.calendly_link_sent &&
        prospect?.calendly_link_sent_at &&
        new Date(prospect.first_click_at) > new Date(prospect.calendly_link_sent_at);

      let natural: IgStageKey = lead ? 'lm_sent' : 'calendly_sent';
      if (lead?.hook_replied) natural = 'in_convo';
      if (calendlySentValid) natural = 'calendly_sent';
      if (linkClickedValid) natural = 'link_clicked';

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

      let badge: CardData['badge'] = null;

      if (call) {
        if (call.status === 'canceled') {
          // Call annulé → meilleure étape connue (events chargés = pas de flash)
          natural = getBestKnownStage(prospect, lead, events);
        } else if (call.no_show === true) {
          // No-show → meilleure étape connue + badge rouge
          natural = getBestKnownStage(prospect, lead, events);
          badge = 'no_show';
        } else if (call.rescheduled) {
          // Reporté : reste en call_booked mais badge orange si après l'heure prévue
          natural = 'call_booked';
          if (new Date(call.scheduled_at).getTime() < Date.now()) badge = 'rescheduled';
        } else {
          natural = 'call_booked';
          // C1 fix : showed_up uniquement via formulaire (deal_closed) — plus d'auto
          if (call.deal_closed) natural = 'closed';
        }
      }

      const override = effectiveOverrides.find(o => o.prospect_key.toLowerCase() === username && o.platform === 'ig');
      const stageKey = resolveStage(natural, override?.stage, IG_STAGES, override?.reason);
      const stageIdx = IG_STAGES.findIndex(s => s.key === stageKey);
      const detectedAt = lead?.detected_at ?? prospect?.created_at ?? new Date().toISOString();
      const sub = lead?.keyword_matched ? `#${lead.keyword_matched}` : prospect ? 'Cold DM' : '';

      const lmClickedEvent = lead ? events.find(e => e.ig_lead_id === lead.id && e.event_type === 'lm_clicked') : null;

      igCards.push({
        key: username,
        name: username,
        sub,
        date: timeAgo(detectedAt),
        stageKey,
        stageIdx: stageIdx >= 0 ? stageIdx : 0,
        badge,
        lmClickedAt: lmClickedEvent?.occurred_at ?? null,
        callId: call?.id ?? undefined,
        callScheduledAt: call?.scheduled_at ?? undefined,
        callStatus: call?.status ?? undefined,
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

    // Grouper par prospect_id quand disponible, sinon par call.id
    const prospectGroups = new Map<string, typeof nonIgCalls>();
    for (const call of nonIgCalls) {
      const groupKey = call.prospect_id ?? call.id;
      if (!prospectGroups.has(groupKey)) prospectGroups.set(groupKey, []);
      prospectGroups.get(groupKey)!.push(call);
    }

    for (const [prospectKey, calls] of prospectGroups) {
      // Call le plus récent pour les infos affichées
      const latestCall = calls.sort((a, b) =>
        new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime()
      )[0];

      // Étape naturelle : la plus avancée parmi tous les calls du prospect
      let natural: YtStageKey = 'call_booked';
      if (calls.some(c => c.deal_closed)) natural = 'closed';
      else if (calls.some(c => c.outcome === 'showed_up' || c.outcome === 'second_call')) natural = 'showed_up';

      const effectiveSrc = latestCall.source?.toLowerCase() ?? '';
      const platform: 'yt' | 'other' = effectiveSrc.startsWith('yt') ? 'yt' : 'other';

      const override = effectiveOverrides.find(o => o.prospect_key === prospectKey && o.platform === platform);
      const stageKey = resolveStage(natural, override?.stage, YT_STAGES, override?.reason);
      const stageIdx = YT_STAGES.findIndex(s => s.key === stageKey);

      // Badge : priorité au call le plus récent
      let badge: CardData['badge'] = null;
      if (latestCall.no_show === true) badge = 'no_show';
      else if (latestCall.rescheduled && new Date(latestCall.scheduled_at).getTime() < Date.now()) badge = 'rescheduled';

      const noSource = !latestCall.source && !latestCall.utm_medium && !latestCall.utm_content;

      const card: CardData = {
        key: prospectKey,
        name: latestCall.invitee_name || 'Prospect',
        sub: latestCall.utm_medium
          ? `${latestCall.utm_medium}${latestCall.utm_content ? ` · ${latestCall.utm_content.slice(0, 12)}` : ''}`
          : (latestCall.source ?? ''),
        date: timeAgo(latestCall.scheduled_at),
        stageKey,
        stageIdx: stageIdx >= 0 ? stageIdx : 0,
        extra: latestCall.revenue ? `${latestCall.revenue.toLocaleString('fr-FR')} €` : undefined,
        noSource,
        badge,
        callId: latestCall.id,
        callScheduledAt: latestCall.scheduled_at,
        callStatus: latestCall.status,
      };

      if (noSource) {
        otherCards.push({ ...card, noSource: false });
      } else {
        ytCards.push(card);
      }
    }
  }

  // Filtre dismissed + retire noSource des confirmés
  const filteredYtCards = ytCards
    .filter(c => !dismissedKeys.has(c.key))
    .map(c => confirmedKeys.has(c.key) ? { ...c, noSource: false } : c);

  const filteredOtherCards = otherCards.filter(c => !dismissedKeys.has(c.key));

  const stages = tab === 'ig' ? IG_STAGES : YT_STAGES;
  const platform = tab;

  // Application des filtres IG
  const filteredIgCards = igCards.filter(c => {
    // Par défaut, les dismissed sont cachés sauf si filtre Archivés actif
    if (!filterArchived && dismissedKeys.has(c.key)) return false;
    if (filterNoShow && c.badge !== 'no_show') return false;
    if (filterArchived && c.stageKey !== 'dismissed') return false;
    if (filterCanceled) {
      const call = data?.calls.find(ca => ca.id === c.callId);
      if (!call || call.status !== 'canceled') return false;
    }
    if (filterRescheduled && c.badge !== 'rescheduled') return false;
    return true;
  });

  const cards = tab === 'ig' ? filteredIgCards : tab === 'yt' ? filteredYtCards : filteredOtherCards;

  // ── Suppression lead ────────────────────────────────────────────────────────

  const handleDeleteLead = useCallback(async (cardKey: string) => {
    await fetch('/api/client/pipeline', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ig_username: cardKey }),
    });
    await refetch();
  }, [refetch]);

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

    // Déterminer si on a besoin d'une modale de confirmation
    const isBackwardFromPostCall =
      POST_CALL_STAGES.has(card.stageKey) && targetStageIdx < currentStageIdx;
    const isForwardToCallBooked = targetStageKey === 'call_booked' && !card.callId;
    const isForwardToShowedUp   = targetStageKey === 'showed_up';
    const isForwardToClosed     = targetStageKey === 'closed';

    // Ne rien faire si on drop sur la même colonne
    if (card.stageKey === targetStageKey) return;

    const targetStageLabel = activeStages.find(s => s.key === targetStageKey)?.label ?? targetStageKey;

    if (isBackwardFromPostCall) {
      setConfirmModal({ case: 'backward_from_post_call', cardKey, cardName: card.name, targetStageKey, targetStageLabel, callId: card.callId ?? null });
      return;
    }
    if (isForwardToCallBooked) {
      setConfirmModal({ case: 'forward_to_call_booked', cardKey, cardName: card.name, targetStageKey, targetStageLabel, callId: card.callId ?? null });
      return;
    }
    if (isForwardToShowedUp) {
      setConfirmModal({ case: 'forward_to_showed_up', cardKey, cardName: card.name, targetStageKey, targetStageLabel, callId: card.callId ?? null });
      return;
    }
    if (isForwardToClosed) {
      setConfirmModal({ case: 'forward_to_closed', cardKey, cardName: card.name, targetStageKey, targetStageLabel, callId: card.callId ?? null });
      return;
    }

    // Tous les autres mouvements → modale simple
    setConfirmModal({ case: 'simple_move', cardKey, cardName: card.name, targetStageKey, targetStageLabel, callId: card.callId ?? null });
  };

  const handleConfirmMove = async (reason: string) => {
    if (!confirmModal) return;
    const { case: modalCase, cardKey, targetStageKey, callId } = confirmModal;
    setConfirmModal(null);

    if (modalCase === 'backward_from_post_call') {
      if (callId) {
        if (reason === 'canceled') {
          await patchCall(callId, { status: 'canceled', cancellation_reason: 'canceled' });
        } else if (reason === 'rescheduled') {
          await patchCall(callId, { rescheduled: true, rescheduled_at: new Date().toISOString(), cancellation_reason: 'rescheduled' });
        } else if (reason === 'error') {
          await patchCall(callId, { ig_lead_id: null, cancellation_reason: 'error' });
        } else if (reason === 'cold') {
          await patchCall(callId, { cancellation_reason: 'cold' });
        }
      }
      // Meilleure étape connue : IG → via prospect_events, YT/Autres → call_booked (le seul signal connu)
      let bestStage: string;
      if (tab === 'ig') {
        const lead = data?.leads.find(l => l.ig_username.toLowerCase() === cardKey);
        const prospect = data?.prospects.find(p => p.ig_username.toLowerCase() === cardKey);
        bestStage = getBestKnownStage(prospect, lead, events);
      } else {
        bestStage = 'call_booked';
      }
      await saveOverride(cardKey, platform, bestStage, reason);
    } else if (modalCase === 'forward_to_call_booked') {
      await saveOverride(cardKey, platform, 'call_booked', 'manual');
    } else if (modalCase === 'forward_to_showed_up') {
      await saveOverride(cardKey, platform, 'showed_up', 'manual');
    } else if (modalCase === 'forward_to_closed') {
      if (callId) await patchCall(callId, { deal_closed: true });
      await saveOverride(cardKey, platform, 'closed', 'manual');
    } else if (modalCase === 'simple_move') {
      await saveOverride(cardKey, platform, targetStageKey, 'manual');
    }

    await refetch();
  };

  const totalProspects = cards.length;
  const anyFilter = filterNoShow || filterArchived || filterCanceled || filterRescheduled;

  return (
    <div
      className="page-content"
      style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%', overflow: 'hidden' }}
      onDragEnd={handleDragEnd}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <h1 className="page-title" style={{ marginBottom: 2 }}>Pipeline Leads</h1>
          <p className="page-sub" style={{ fontSize: 12 }}>
            {loading ? 'Chargement…' : `${totalProspects} prospect${totalProspects !== 1 ? 's' : ''}`}
          </p>
          {!loading && (
            <p className="page-sub" style={{ fontSize: 11, marginTop: 2 }}>
              Le pipeline se met à jour tout seul · glisse une carte pour la déplacer, le système reprendra sa position dès qu&apos;un nouvel événement sera détecté
            </p>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
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
          <div style={{ display: 'flex', background: 'var(--surface-2)', borderRadius: 8, padding: 3, gap: 2 }}>
            {([
              { key: 'ig', label: 'Instagram', count: igCards.length },
              { key: 'yt', label: 'YouTube', count: filteredYtCards.length },
              { key: 'other', label: 'Autres', count: filteredOtherCards.length },
            ] as const).map(t => (
              <button key={t.key} onClick={() => setTab(t.key)} style={{
                padding: '5px 14px', fontSize: 12, fontWeight: 600, borderRadius: 6,
                cursor: 'pointer', border: 'none', transition: 'all .12s',
                background: tab === t.key ? 'var(--surface)' : 'transparent',
                color: tab === t.key ? 'var(--ink)' : 'var(--muted)',
                boxShadow: tab === t.key ? '0 1px 3px rgba(0,0,0,.08)' : 'none',
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                {t.label}
                <span style={{
                  fontSize: 10, fontWeight: 700, minWidth: 16, height: 16,
                  borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px',
                  background: tab === t.key ? 'var(--surface-2)' : 'transparent',
                  color: tab === t.key ? 'var(--ink)' : 'var(--faint)',
                }}>{t.count}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Filtres IG */}
      {tab === 'ig' && (
        <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap' }}>
          {[
            { key: 'no_show', label: 'No-shows', value: filterNoShow, set: setFilterNoShow, color: '#dc2626', bg: '#fef2f2' },
            { key: 'archived', label: 'Archivés', value: filterArchived, set: setFilterArchived, color: '#6b7280', bg: '#f3f4f6' },
            { key: 'canceled', label: 'Annulés', value: filterCanceled, set: setFilterCanceled, color: '#7C3AED', bg: '#F5F3FF' },
            { key: 'rescheduled', label: 'Reportés', value: filterRescheduled, set: setFilterRescheduled, color: '#d97706', bg: '#fffbeb' },
          ].map(f => (
            <button
              key={f.key}
              onClick={() => f.set(!f.value)}
              style={{
                padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 6, cursor: 'pointer',
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
              onClick={() => { setFilterNoShow(false); setFilterArchived(false); setFilterCanceled(false); setFilterRescheduled(false); }}
              style={{ padding: '4px 10px', fontSize: 11, fontWeight: 500, borderRadius: 6, cursor: 'pointer', border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)' }}
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
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Chargement…</div>
        </div>
      ) : (
        <div style={{ flex: 1, overflowX: 'auto', overflowY: 'auto', paddingBottom: 16 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'stretch', minWidth: 'max-content', height: '100%' }}>
            {stages.map(stage => {
              const stageCards = cards.filter(c => c.stageIdx === stages.findIndex(s => s.key === stage.key));
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
                  onDismissLead={key => { setDismissedKeys(prev => new Set([...prev, key])); saveOverride(key, platform, 'dismissed'); }}
                  onDeleteLead={handleDeleteLead}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && totalProspects === 0 && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, paddingBottom: 60 }}>
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
          targetStageLabel={confirmModal.targetStageLabel}
          callId={confirmModal.callId}
          onConfirm={handleConfirmMove}
          onCancel={() => setConfirmModal(null)}
        />
      )}
    </div>
  );
}
