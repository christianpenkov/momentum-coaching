'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import InlineLoader from '@/components/ui/InlineLoader';
import RapportModal from '@/components/ui/RapportModal';

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
  is_follow_up: boolean | null;
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
): string {
  if (!overrideKey) return naturalKey;
  const naturalIdx  = stages.findIndex(s => s.key === naturalKey);
  const overrideIdx = stages.findIndex(s => s.key === overrideKey);
  // Le naturel gagne s'il est au moins aussi avancé que l'override
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
  badge?: 'no_show' | 'rescheduled' | 'not_qualified' | 'to_recontact' | null;
  lmClickedAt?: string | null;
  // Pour afficher le bouton rapport
  callId?: string;
  callScheduledAt?: string;
  callStatus?: string;
  callOutcome?: string | null;
  callIsFollowUp?: boolean;
  naturalKey: string; // stage naturel avant override — pour natural_at_override
  hasProspectLink: boolean; // true si prospect_links.short_url est renseigné
  avatarUrl: string | null;
}

function PipelineCard({
  card, stages, isDragging, onDragStart, platform, onConfirmLead, onDismissLead, onDeleteLead, onRapportClick,
}: {
  card: CardData;
  stages: typeof IG_STAGES | typeof YT_STAGES;
  isDragging: boolean;
  onDragStart: (e: React.DragEvent, cardKey: string) => void;
  platform: 'ig' | 'yt' | 'other';
  onConfirmLead?: (key: string) => void;
  onDismissLead?: (key: string) => void;
  onDeleteLead?: (key: string, callId?: string | null) => void;
  onRapportClick?: (callId: string, inviteeName: string, scheduledAt: string, isFollowUp: boolean) => void;
}) {
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const stage = stages[card.stageIdx] ?? stages[0];
  const ac = avatarColor(card.name);

  // Bouton "Remplir le rapport d'appel" : visible dès le début du call, caché si rapport déjà rempli
  // Accepte aussi status=cancelled sans outcome — fenêtre de transition Calendly entre reschedule et nouveau call
  const now = Date.now();
  const showRapport = card.callId && card.callScheduledAt
    && (card.callStatus === 'active' || (['cancelled', 'canceled'].includes(card.callStatus ?? '') && !card.callOutcome))
    && new Date(card.callScheduledAt).getTime() <= now
    && !card.callOutcome
    && POST_CALL_STAGES.has(card.stageKey);

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
        {card.avatarUrl ? (
          <img
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
            {platform === 'ig' ? `@${card.name}` : card.name}
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

      {/* Bouton rapport — ouvre le modal directement dans le pipeline */}
      {showRapport && (
        <button
          type="button"
          draggable={false}
          onMouseDown={e => e.stopPropagation()}
          onClick={e => {
            e.stopPropagation();
            onRapportClick?.(card.callId!, card.name, card.callScheduledAt!, card.callIsFollowUp ?? false);
          }}
          style={{
            display: 'block', width: '100%', textAlign: 'center', fontSize: 10, fontWeight: 600,
            padding: '5px 8px', borderRadius: 6,
            background: '#EFF6FF', color: '#2563EB',
            border: '1px solid #BFDBFE',
            cursor: 'pointer', transition: 'all .12s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#2563EB'; (e.currentTarget as HTMLElement).style.color = '#fff'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#EFF6FF'; (e.currentTarget as HTMLElement).style.color = '#2563EB'; }}
        >
          Remplir le rapport d'appel
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
            Supprimer {platform === 'ig' ? `@${card.name}` : card.name}
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
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Supprimer {platform === 'ig' ? `@${card.name}` : card.name} ?</div>
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
    </>
  );
}

// ── KanbanColumn ──────────────────────────────────────────────────────────────

function KanbanColumn({
  stage, cards, stages, draggingKey, onDragStart, onDrop, onDragOver, onDragLeave,
  isDropTarget, platform, onConfirmLead, onDismissLead, onDeleteLead, onRapportClick,
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
  onDeleteLead?: (key: string, callId?: string | null) => void;
  onRapportClick?: (callId: string, inviteeName: string, scheduledAt: string, isFollowUp: boolean) => void;
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
            onRapportClick={onRapportClick}
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
  | 'backward_from_post_call'   // recul depuis call_booked / showed_up / closed
  | 'forward_to_call_booked'    // avancée manuelle vers call_booked
  | 'forward_to_showed_up'      // avancée manuelle vers showed_up
  | 'forward_to_closed'         // avancée manuelle vers closed
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

const PRE_CALL_STAGE_LABELS: Record<string, string> = {
  lm_sent:       'LM reçu',
  in_convo:      'En conversation',
  calendly_sent: 'Calendly envoyé',
  link_clicked:  'Lien cliqué',
};

function getResetDescription(targetStage: string, currentStage: string, hasCall: boolean): string[] {
  const items: string[] = [];
  const stages = ['lm_sent', 'in_convo', 'calendly_sent', 'link_clicked'];
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
  const closedValid = revenue !== '' && !isNaN(Number(revenue)) && Number(revenue) >= 0;

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

        {modalCase === 'forward_to_showed_up' && (
          <>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>@{cardName} s&apos;est présenté au call ?</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 20 }}>
              Confirme que le lead était bien présent. Cela sera compté dans ton taux de show-up.
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
              <input type="number" min="0" step="1" value={revenue} onChange={e => setRevenue(e.target.value)} placeholder="ex : 1500"
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
                extraData.scheduledAt = `${callDate}T${callTime}:00`;
                extraData.duration = callDuration;
                extraData.inviteeName = callName.trim();
                extraData.inviteeEmail = callEmail.trim() || null;
              }
              if (modalCase === 'forward_to_closed') {
                extraData.revenue = Number(revenue);
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
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(new Set());
  const [confirmedKeys, setConfirmedKeys] = useState<Set<string>>(new Set());
  const dropCounters = useRef<Record<string, number>>({});

  const [refreshing, setRefreshing] = useState(false);

  // Filtres
  const [filterNoShow, setFilterNoShow] = useState(false);
  const [filterArchived, setFilterArchived] = useState(false);
  const [filterCanceled, setFilterCanceled] = useState(false);
  const [filterRescheduled, setFilterRescheduled] = useState(false);
  const [filterNotQualified, setFilterNotQualified] = useState(false);
  const [filterToRecontact, setFilterToRecontact] = useState(false);

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

  const saveOverride = useCallback(async (key: string, platform: 'ig' | 'yt' | 'other', stage: string, reason?: string, naturalAtOverride?: string) => {
    setOverrides(prev => {
      const idx = prev.findIndex(o => o.prospect_key === key && o.platform === platform);
      const entry: Override = { prospect_key: key, platform, stage, updated_at: new Date().toISOString(), reason, natural_at_override: naturalAtOverride ?? null };
      return idx >= 0 ? prev.map((o, i) => i === idx ? entry : o) : [...prev, entry];
    });
    await fetch('/api/client/pipeline', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prospect_key: key, platform, stage, reason, natural_at_override: naturalAtOverride ?? null }),
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
      // Comparer avec last_calendly_link_sent_at (dernier envoi) et non calendly_link_sent_at (premier)
      // pour éviter qu'un clic antérieur au dernier envoi du lien soit comptabilisé
      const linkSentRef = prospect?.last_calendly_link_sent_at ?? prospect?.calendly_link_sent_at;
      const linkClickedValid = prospect?.first_click_at &&
        prospect?.calendly_link_sent &&
        linkSentRef &&
        new Date(prospect.first_click_at) > new Date(linkSentRef);

      let natural: IgStageKey = lead ? 'lm_sent' : 'calendly_sent';
      if (lead?.hook_replied) { natural = 'in_convo'; }
      if (calendlySentValid) { natural = 'calendly_sent'; }
      if (linkClickedValid)  { natural = 'link_clicked'; }

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
        if (['canceled', 'cancelled'].includes(call.status ?? '')) {
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
        } else if (call.outcome === 'not_qualified') {
          natural = 'showed_up';
          badge = 'not_qualified';
        } else if (call.outcome === 'to_recontact') {
          natural = 'showed_up';
          badge = 'to_recontact';
        } else {
          natural = 'call_booked';
          if (call.deal_closed) natural = 'closed';
        }
      }

      const override = effectiveOverrides.find(o => o.prospect_key.toLowerCase() === username && o.platform === 'ig');
      const stageKey = resolveStage(natural, override?.stage, IG_STAGES);
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
        callOutcome: call?.outcome ?? null,
        callIsFollowUp: call?.is_follow_up ?? false,
        naturalKey: natural,
        hasProspectLink: !!(prospect?.short_url),
        avatarUrl: lead?.avatar_url ?? null,
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
      const stageKey = resolveStage(natural, override?.stage, YT_STAGES);
      const stageIdx = YT_STAGES.findIndex(s => s.key === stageKey);

      // Badge : priorité au call le plus récent
      let badge: CardData['badge'] = null;
      if (latestCall.no_show === true) badge = 'no_show';
      else if (latestCall.rescheduled && new Date(latestCall.scheduled_at).getTime() < Date.now()) badge = 'rescheduled';
      else if (latestCall.outcome === 'not_qualified') badge = 'not_qualified';
      else if (latestCall.outcome === 'to_recontact') badge = 'to_recontact';

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
        callOutcome: latestCall.outcome ?? null,
        naturalKey: natural,
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
      if (!call || !['canceled', 'cancelled'].includes(call.status ?? '')) return false;
    }
    if (filterRescheduled && c.badge !== 'rescheduled') return false;
    if (filterNotQualified && c.badge !== 'not_qualified') return false;
    if (filterToRecontact && c.badge !== 'to_recontact') return false;
    return true;
  });

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
    await fetch('/api/client/pipeline', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    await refetch();
  }, [refetch, tab]);

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
    const isForwardToShowedUp   = targetStageKey === 'showed_up';
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
    if (isForwardToShowedUp) {
      setConfirmModal({ case: 'forward_to_showed_up', cardKey, cardName: card.name, targetStageKey, targetStageLabel, currentStageKey, callId: card.callId ?? null, naturalKey });
      return;
    }
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
      await fetch('/api/client/pipeline/reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ig_username: cardKey, target_stage: targetStageKey }),
      });
      setOverrides(prev => prev.filter(o => !(o.prospect_key === cardKey && o.platform === 'ig')));
      await refetch();
      return;
    }

    if (modalCase === 'forward_pre_call') {
      // Injection des signaux réels correspondant au stage cible
      await fetch('/api/client/pipeline/advance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ig_username: cardKey, target_stage: targetStageKey, current_stage: confirmModal.currentStageKey }),
      });
      setOverrides(prev => prev.filter(o => !(o.prospect_key === cardKey && o.platform === 'ig')));
      await refetch();
      return;
    }

    if (modalCase === 'backward_from_post_call') {
      if (callId) {
        await fetch(`/api/client/calls/${callId}`, { method: 'DELETE' });
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
      await fetch('/api/client/calls', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
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
    } else if (modalCase === 'forward_to_showed_up') {
      await saveOverride(cardKey, platform, 'showed_up', 'manual', naturalKey);
    } else if (modalCase === 'forward_to_closed') {
      if (callId) await patchCall(callId, { deal_closed: true, revenue: extraData?.revenue ?? null });
      await saveOverride(cardKey, platform, 'closed', 'manual', naturalKey);
    } else if (modalCase === 'simple_move') {
      await saveOverride(cardKey, platform, targetStageKey, 'manual', naturalKey);
    }

    await refetch();
  };

  const totalProspects = cards.length;
  const anyFilter = filterNoShow || filterArchived || filterCanceled || filterRescheduled || filterNotQualified || filterToRecontact;

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
            { key: 'not_qualified', label: 'Pas qualifiés', value: filterNotQualified, set: setFilterNotQualified, color: '#6b7280', bg: '#f3f4f6' },
            { key: 'to_recontact', label: 'À recontacter', value: filterToRecontact, set: setFilterToRecontact, color: '#c2410c', bg: '#fff7ed' },
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
              onClick={() => { setFilterNoShow(false); setFilterArchived(false); setFilterCanceled(false); setFilterRescheduled(false); setFilterNotQualified(false); setFilterToRecontact(false); }}
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
          <InlineLoader />
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
                  onRapportClick={(callId, inviteeName, scheduledAt, isFollowUp) => setRapportModal({ callId, inviteeName, scheduledAt, isFollowUp })}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && totalProspects === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, paddingTop: 60, paddingBottom: 60 }}>
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

      {/* Rapport modal ouvert directement depuis le pipeline */}
      {rapportModal && (
        <RapportModal
          callId={rapportModal.callId}
          inviteeName={rapportModal.inviteeName}
          scheduledAt={rapportModal.scheduledAt}
          isFollowUp={rapportModal.isFollowUp}
          onClose={() => { setRapportModal(null); refetch(); }}
        />
      )}
    </div>
  );
}
