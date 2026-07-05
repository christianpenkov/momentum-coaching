'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '@/components/ui/Icon';
import type { ProspectContext } from './PagePipeline';

// ── TimelineEvent ────────────────────────────────────────────────────────────

interface TimelineEvent {
  id: string;
  type: string;
  occurredAt: string;
  source: 'event' | 'derived';
  label: string;
  detail?: string;
}

const EVENT_STYLE: Record<string, { icon: Parameters<typeof Icon>[0]['name']; color: string }> = {
  hook_replied:        { icon: 'message-circle',        color: '#1a1815' },
  lm_clicked:          { icon: 'mouse-pointer-click',    color: '#1a1815' },
  calendly_link_sent:  { icon: 'calendar-plus',          color: '#1a1815' },
  link_clicked:        { icon: 'mouse-pointer-click',    color: '#1a1815' },
  call_booked:         { icon: 'phone-call',             color: '#b58025' },
  showed_up:           { icon: 'check-circle-2',         color: '#3f8a52' },
  no_show:             { icon: 'calendar-x',             color: '#cd5b3f' },
  rescheduled:         { icon: 'calendar-clock',         color: '#b58025' },
  call_canceled:       { icon: 'calendar-x',              color: '#cd5b3f' },
  closed:              { icon: 'circle-dollar-sign',     color: '#3f8a52' },
};

const DEFAULT_STYLE = { icon: 'message-circle' as const, color: '#6b6a66' };

// ── buildProspectTimeline ────────────────────────────────────────────────────
// Assemble la timeline d'un prospect : d'abord les prospect_events réels (source
// fiable), puis injecte les événements dérivés absents de prospect_events, déduits
// des booléens des calls (no_show, rescheduled, showed_up, closed). Trié croissant
// (le plus ancien en haut) — décision produit : lecture comme une histoire qui progresse.

function buildProspectTimeline(ctx: ProspectContext): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const e of ctx.events) {
    let label = e.event_type;
    if (e.event_type === 'hook_replied') label = "Réponse à l'accroche";
    else if (e.event_type === 'lm_clicked') label = 'Lead magnet ouvert';
    else if (e.event_type === 'calendly_link_sent') label = 'Lien Calendly envoyé';
    else if (e.event_type === 'link_clicked') label = 'Lien Calendly cliqué';
    events.push({ id: e.id, type: e.event_type, occurredAt: e.occurred_at, source: 'event', label });
  }

  // Commentaire / détection initiale du lead (pas un prospect_event à part, dérivé de detected_at)
  if (ctx.lead?.detected_at) {
    events.push({
      id: `lead-detected-${ctx.lead.id}`,
      type: 'hook_replied',
      occurredAt: ctx.lead.detected_at,
      source: 'event',
      label: ctx.lead.keyword_matched ? `Commentaire détecté (#${ctx.lead.keyword_matched})` : 'Commentaire détecté',
    });
  }

  for (const call of ctx.calls) {
    const bookedAt = call.scheduled_at ?? call.created_at;
    events.push({
      id: `${call.id}-booked`,
      type: 'call_booked',
      occurredAt: call.created_at ?? bookedAt,
      source: 'event',
      label: 'Call booké',
      detail: call.scheduled_at ? `Prévu le ${new Date(call.scheduled_at).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}` : undefined,
    });

    if (call.no_show === true) {
      events.push({
        id: `${call.id}-no-show`,
        type: 'no_show',
        occurredAt: call.no_show_at ?? call.scheduled_at ?? call.created_at,
        source: 'derived',
        label: 'No-show',
      });
    } else if (call.rescheduled) {
      events.push({
        id: `${call.id}-rescheduled`,
        type: 'rescheduled',
        occurredAt: call.rescheduled_at ?? call.scheduled_at ?? call.created_at,
        source: 'derived',
        label: 'Call reporté',
      });
    } else if (['canceled', 'cancelled'].includes(call.status ?? '')) {
      events.push({
        id: `${call.id}-canceled`,
        type: 'call_canceled',
        occurredAt: call.rescheduled_at ?? call.scheduled_at ?? call.created_at,
        source: 'derived',
        label: 'Call annulé',
        detail: call.cancellation_reason ?? undefined,
      });
    } else if (call.outcome === 'showed_up' || call.outcome === 'second_call' || call.deal_closed) {
      events.push({
        id: `${call.id}-showed-up`,
        type: 'showed_up',
        occurredAt: call.scheduled_at ?? call.created_at,
        source: 'derived',
        label: 'Call honoré',
      });
    }

    if (call.deal_closed) {
      events.push({
        id: `${call.id}-closed`,
        type: 'closed',
        occurredAt: call.scheduled_at ?? call.created_at,
        source: 'derived',
        label: 'Deal closé',
        detail: call.revenue ? `${call.revenue.toLocaleString('fr-FR')} €` : undefined,
      });
    }
  }

  return events.sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
}

// ── TimelineList ─────────────────────────────────────────────────────────────

function TimelineList({ timeline }: { timeline: TimelineEvent[] }) {
  if (timeline.length === 0) {
    return <div style={{ fontSize: 12, color: 'var(--muted)', padding: '16px 0' }}>Aucun événement enregistré pour ce prospect.</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {timeline.map((ev, i) => {
        const style = EVENT_STYLE[ev.type] ?? DEFAULT_STYLE;
        const isLast = i === timeline.length - 1;
        const isClosedHighlight = ev.type === 'closed' && isLast;
        return (
          <div key={ev.id} style={{ display: 'flex', gap: 10 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                background: style.color + '18', border: `1.5px solid ${style.color}55`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Icon name={style.icon} size={14} color={style.color} />
              </div>
              {!isLast && <div style={{ width: 1.5, flex: 1, minHeight: 24, background: 'var(--border)' }} />}
            </div>
            <div style={{ paddingBottom: 20, minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{ev.label}</span>
                {ev.source === 'derived' && (
                  <span title="Date déduite du call, pas enregistrée exactement" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--muted)' }}>
                    <Icon name="info" size={11} color="var(--muted)" />
                    estimé
                  </span>
                )}
              </div>
              {isClosedHighlight && ev.detail ? (
                <div style={{ fontSize: 20, fontWeight: 800, color: '#3f8a52', marginTop: 4 }}>{ev.detail}</div>
              ) : ev.detail ? (
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{ev.detail}</div>
              ) : null}
              <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 3 }}>
                {new Date(ev.occurredAt).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── ProspectDetailModal ──────────────────────────────────────────────────────

interface Props {
  context: ProspectContext;
  displayName: string;
  stageLabel: string;
  stageColor: string;
  onClose: () => void;
}

export default function ProspectDetailModal({ context, displayName, stageLabel, stageColor, onClose }: Props) {
  const [error, setError] = useState(false);
  if (typeof document === 'undefined') return null;

  let timeline: TimelineEvent[] = [];
  try {
    timeline = buildProspectTimeline(context);
  } catch {
    if (!error) setError(true);
  }

  const latestCall = context.calls[0];

  return createPortal(
    <>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 10001 }} onMouseDown={onClose} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        zIndex: 10002, background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 14, width: 420, maxWidth: 'calc(100vw - 32px)',
        boxShadow: '0 8px 32px rgba(0,0,0,.18)', overflow: 'hidden',
      }}>
        {/* Header — badge d'étape dominant */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px',
            borderRadius: 20, background: stageColor + '18', border: `1px solid ${stageColor}55`,
            fontSize: 12, fontWeight: 700, color: stageColor, marginBottom: 10,
          }}>
            {stageLabel}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{displayName}</div>
          </div>
          {context.lead?.keyword_matched && (
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Mot-clé : #{context.lead.keyword_matched}</div>
          )}
          {latestCall?.invitee_email && (
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{latestCall.invitee_email}</div>
          )}
        </div>

        {/* Timeline */}
        <div style={{ padding: '20px 24px', maxHeight: '50vh', overflowY: 'auto' }}>
          {error ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '20px 0' }}>
              <div style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>
                Impossible de charger l'historique de ce prospect.
              </div>
              <button
                onClick={() => setError(false)}
                style={{ padding: '6px 16px', fontSize: 12, fontWeight: 600, borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer' }}
              >
                Réessayer
              </button>
            </div>
          ) : (
            <TimelineList timeline={timeline} />
          )}
        </div>

        <div style={{ padding: '12px 24px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{ padding: '7px 16px', fontSize: 12, fontWeight: 600, borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer' }}
          >
            Fermer
          </button>
        </div>
      </div>
    </>,
    document.body
  );
}
