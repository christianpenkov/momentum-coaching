'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '@/components/ui/Icon';
import type { ProspectContext } from './PagePipeline';
import { avatarColor, avatarInitials } from './PagePipeline';
import { isYtVideoId } from '@/lib/ytId';

// ── TimelineEvent ────────────────────────────────────────────────────────────

interface TimelineEvent {
  id: string;
  type: string;
  occurredAt: string;
  source: 'event' | 'derived';
  label: string;
  detail?: string;
  linkLabel?: string; // partie cliquable du label (ex: titre de la vidéo YouTube, légende du post IG)
  linkUrl?: string;
  thumbnail?: string | null; // miniature du post/vidéo source, affichée à côté du lien
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

// ── resolveIgPostLink ────────────────────────────────────────────────────────
// Construit le lien cliquable vers un post/reel Instagram à partir de ses
// métadonnées résolues (légende, permalink, thumbnail). Certains posts n'ont
// aucune légende sur Instagram (caption null) — dans ce cas on garde quand même
// le lien cliquable (avec un libellé générique) et la miniature, plutôt que de
// tout masquer faute de texte.
function resolveIgPostLink(meta: { caption: string | null; permalink: string | null; thumbnail: string | null } | null | undefined) {
  if (!meta?.permalink) return {};
  const caption = meta.caption
    ? (meta.caption.length > 60 ? `${meta.caption.slice(0, 60)}…` : meta.caption)
    : 'Voir le post';
  return { linkLabel: caption, linkUrl: meta.permalink, thumbnail: meta.thumbnail };
}

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
    else if (e.event_type === 'call_booked') label = 'Call booké';
    else if (e.event_type === 'no_show') label = 'No-show';
    else if (e.event_type === 'rescheduled') label = 'Call reporté';
    else if (e.event_type === 'showed_up') label = 'Call honoré';
    else if (e.event_type === 'closed') label = 'Deal closé';
    events.push({ id: e.id, type: e.event_type, occurredAt: e.occurred_at, source: 'event', label });
  }

  // Chaque lead magnet réclamé, à sa propre date (detected_at) — un lead peut en
  // réclamer plusieurs sur des posts différents ; chacun apparaît séparément dans la
  // chronologie avec le post/reel source (miniature + lien cliquable), jamais un bloc
  // à part. Ne fait jamais bouger la card (voir instagram_leads upsert : detected_at
  // du LEAD reste figé à la 1ère détection, indépendamment de cet historique).
  // Le tout premier LM réclamé correspond à la détection initiale du lead
  // (ctx.lead.detected_at = min(lmHistory.detected_at)) — on ne le pousse qu'une fois
  // via cette boucle pour éviter un doublon visuel avec "Commentaire détecté".
  const firstLmId = ctx.lmHistory[0]?.id ?? null; // lmHistory trié croissant par resolveProspectContext
  for (const lm of ctx.lmHistory) {
    const meta = lm.media_id ? ctx.igPostMeta[lm.media_id] : null;
    const link = resolveIgPostLink(meta);
    const isFirst = lm.id === firstLmId;
    events.push({
      id: `lm-${lm.id}`,
      type: 'hook_replied',
      occurredAt: lm.detected_at,
      source: 'event',
      label: isFirst
        ? (lm.keyword_matched ? `Commentaire détecté (#${lm.keyword_matched})` : 'Commentaire détecté')
        : (lm.keyword_matched ? `Lead magnet réclamé (#${lm.keyword_matched})` : 'Lead magnet réclamé'),
      ...link,
    });
  }

  // Fallback : si aucun historique LM n'est disponible (lead ancien, avant l'ajout de
  // instagram_lead_lm_history, ou hors Instagram), garder l'ancien affichage basé sur
  // detected_at du lead.
  if (ctx.lmHistory.length === 0 && ctx.lead?.detected_at) {
    events.push({
      id: `lead-detected-${ctx.lead.id}`,
      type: 'hook_replied',
      occurredAt: ctx.lead.detected_at,
      source: 'event',
      label: ctx.lead.keyword_matched ? `Commentaire détecté (#${ctx.lead.keyword_matched})` : 'Commentaire détecté',
    });
  }

  for (const call of ctx.calls) {
    // Moment réel de la réservation (booked_at, rempli par le webhook/sync Calendly via
    // invitee.created_at) — distinct de scheduled_at (heure du call, dans le futur au
    // moment de la réservation). Fallback sur l'ancien comportement si absent (calls
    // anciens créés avant l'ajout de cette colonne, ou calls manuels sans Calendly).
    const bookedAt = call.booked_at ?? call.scheduled_at ?? call.created_at;
    // "Call booké" n'est ajouté que s'il n'existe pas déjà en tant que prospect_event réel
    // pour ce call précis (event_type call_booked + call_id) — évite le doublon visuel.
    const hasRealBookedEvent = ctx.events.some(e => e.event_type === 'call_booked' && e.call_id === call.id);
    if (!hasRealBookedEvent) {
      // Source vidéo YouTube : lien Calendly placé en description d'une vidéo
      const ytVideoId = call.utm_medium === 'description' && call.utm_content && isYtVideoId(call.utm_content)
        ? call.utm_content
        : null;
      const ytTitle = ytVideoId ? ctx.ytVideoTitles[ytVideoId] : null;

      // Source post Instagram : lien Calendly placé en description d'un post/reel.
      // resolveIgPostLink garde le lien cliquable même si le post n'a aucune légende
      // sur Instagram (caption null) — le permalink/miniature restent affichables.
      const igMediaId = call.source === 'ig_description' && call.utm_content ? call.utm_content : null;
      const igMeta = igMediaId ? ctx.igPostMeta[igMediaId] : null;
      const igLink = resolveIgPostLink(igMeta);

      const sourceLink = ytTitle && ytVideoId
        ? { linkLabel: ytTitle, linkUrl: `https://www.youtube.com/watch?v=${ytVideoId}` }
        : igLink;
      const sourceLabel = 'linkUrl' in sourceLink ? 'Call booké depuis ' : 'Call booké';

      events.push({
        id: `${call.id}-booked`,
        type: 'call_booked',
        occurredAt: bookedAt,
        source: 'derived',
        label: sourceLabel,
        // Toujours afficher l'heure du call prévue — distincte du moment de réservation
        // (occurredAt ci-dessus) affiché en bas de la carte timeline.
        detail: call.scheduled_at ? `Prévu le ${new Date(call.scheduled_at).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}` : undefined,
        ...sourceLink,
      });
    }

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
      const hasRealShowedUpEvent = ctx.events.some(e => e.event_type === 'showed_up' && e.call_id === call.id);
      if (!hasRealShowedUpEvent) {
        events.push({
          id: `${call.id}-showed-up`,
          type: 'showed_up',
          occurredAt: call.scheduled_at ?? call.created_at,
          source: 'derived',
          label: 'Call honoré',
        });
      }
    }

    if (call.deal_closed) {
      const hasRealClosedEvent = ctx.events.some(e => e.event_type === 'closed' && e.call_id === call.id);
      if (!hasRealClosedEvent) {
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
  }

  return events.sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
}

// ── TimelineList ─────────────────────────────────────────────────────────────

function TimelineList({ timeline }: { timeline: TimelineEvent[] }) {
  if (timeline.length === 0) {
    return <div style={{ fontSize: 12, color: 'var(--muted)', padding: '16px 0' }}>Aucun événement enregistré pour ce prospect.</div>;
  }

  // column-reverse + items rendus en ordre inversé : le scroll ancre nativement en bas
  // au premier paint (dernier événement visible directement), sans scrollIntoView ni
  // rAF de rattrapage — même technique que la messagerie (PageClientMessages.tsx),
  // robuste aux reflows tardifs (miniatures IG/YT qui chargent après coup).
  return (
    <div style={{ display: 'flex', flexDirection: 'column-reverse' }}>
      {timeline.slice().reverse().map((ev, revIdx, revArr) => {
        const i = revArr.length - 1 - revIdx; // index chronologique d'origine
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {ev.thumbnail && (
                  <img
                    src={ev.thumbnail}
                    alt=""
                    style={{ width: 32, height: 32, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }}
                  />
                )}
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                  {ev.label}
                  {ev.linkUrl && (
                    <a
                      href={ev.linkUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: '#2563EB', textDecoration: 'underline' }}
                    >
                      {ev.linkLabel}
                    </a>
                  )}
                </span>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {context.lead?.avatar_url ? (
              <img
                src={context.lead.avatar_url}
                alt={displayName}
                width={36}
                height={36}
                style={{ borderRadius: 10, flexShrink: 0, objectFit: 'cover', display: 'block' }}
                onError={e => { e.currentTarget.style.display = 'none'; }}
              />
            ) : (
              <div style={{
                width: 36, height: 36, borderRadius: 10, background: avatarColor(displayName), flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 700, color: '#fff', letterSpacing: '.03em',
              }}>
                {avatarInitials(displayName)}
              </div>
            )}
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{displayName}</div>
          </div>
          {context.lead?.keyword_matched && (
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Mot-clé : #{context.lead.keyword_matched}</div>
          )}
          {latestCall?.invitee_email && (
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{latestCall.invitee_email}</div>
          )}
        </div>

        {/* Timeline — inclut les lead magnets réclamés (buildProspectTimeline), chacun
            à sa vraie date, avec le post/reel source. Ne fait jamais bouger la card
            (detected_at du LEAD reste figé à la 1ère détection, voir instagram_leads
            upsert) — c'est un historique en lecture seule. */}
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
