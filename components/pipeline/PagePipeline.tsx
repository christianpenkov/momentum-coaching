'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';

// ── Types ─────────────────────────────────────────────────────────────────────

interface IgLead {
  id: string;
  ig_username: string;
  ig_user_id: string;
  keyword_matched: string;
  lead_magnet_sent: boolean;
  hook_replied: boolean;
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
}

interface Call {
  id: string;
  invitee_name: string;
  invitee_email: string;
  scheduled_at: string;
  status: string;
  no_show: boolean | null;
  deal_closed: boolean | null;
  revenue: number | null;
  source: string | null;
  ig_lead_id: string | null;
  utm_content: string | null;
  created_at: string;
}

interface Override {
  prospect_key: string;
  platform: 'ig' | 'yt';
  stage: string;
  updated_at: string;
}

interface PipelineData {
  leads: IgLead[];
  prospects: ProspectLink[];
  calls: Call[];
  overrides: Override[];
}

// ── Colonnes ──────────────────────────────────────────────────────────────────

const IG_STAGES = [
  { key: 'lm_sent',       label: 'LM reçu',          color: '#7C3AED', lightBg: '#F5F3FF', dot: '#7C3AED' },
  { key: 'in_convo',      label: 'En conversation',   color: '#9333EA', lightBg: '#FDF4FF', dot: '#9333EA' },
  { key: 'calendly_sent', label: 'Calendly envoyé',   color: '#D97706', lightBg: '#FFFBEB', dot: '#D97706' },
  { key: 'link_clicked',  label: 'Lien cliqué',       color: '#EA580C', lightBg: '#FFF7ED', dot: '#EA580C' },
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

// ── Card ──────────────────────────────────────────────────────────────────────

interface CardData {
  key: string;
  name: string;
  sub: string;
  date: string;
  stageKey: string;
  stageIdx: number;
  extra?: string;
}

function PipelineCard({
  card, stages, isDragging, onDragStart,
}: {
  card: CardData;
  stages: typeof IG_STAGES | typeof YT_STAGES;
  isDragging: boolean;
  onDragStart: (e: React.DragEvent, cardKey: string) => void;
}) {
  const stage = stages[card.stageIdx] ?? stages[0];
  const ac = avatarColor(card.name);

  return (
    <div
      draggable
      onDragStart={e => onDragStart(e, card.key)}
      style={{
        background: 'var(--surface)',
        border: `1px solid ${isDragging ? stage.color : 'var(--border)'}`,
        borderRadius: 8,
        padding: '9px 11px',
        cursor: 'grab',
        opacity: isDragging ? 0.45 : 1,
        transition: 'opacity .15s, box-shadow .12s, border-color .12s',
        userSelect: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
      onMouseEnter={e => { if (!isDragging) e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,.09)'; }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; }}
    >
      {/* Row 1 : avatar + nom */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          width: 26, height: 26, borderRadius: 7, background: ac, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10, fontWeight: 700, color: '#fff', letterSpacing: '.03em',
        }}>
          {avatarInitials(card.name)}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            @{card.name}
          </div>
          {card.sub && (
            <div style={{ fontSize: 10, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>
              {card.sub}
            </div>
          )}
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
    </div>
  );
}

// ── KanbanColumn ──────────────────────────────────────────────────────────────

function KanbanColumn({
  stage, cards, stages, draggingKey, onDragStart, onDrop, onDragOver, onDragLeave,
  isDropTarget,
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
}) {
  return (
    <div
      onDrop={e => onDrop(e, stage.key)}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      style={{
        width: 220,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        transition: 'background .1s',
        alignSelf: 'stretch',
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '7px 10px',
        borderRadius: 7,
        background: isDropTarget ? stage.lightBg : 'var(--surface-2)',
        border: `1px solid ${isDropTarget ? stage.color + '55' : 'var(--border)'}`,
        transition: 'all .12s',
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

      {/* Drop zone */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 5,
        flex: 1,
        minHeight: 80,
        padding: isDropTarget ? '4px' : '0',
        borderRadius: 8,
        background: isDropTarget ? stage.lightBg + 'BB' : 'transparent',
        border: isDropTarget ? `1.5px dashed ${stage.color}66` : '1.5px dashed transparent',
        transition: 'all .12s',
      }}>
        {cards.length === 0 && !isDropTarget && (
          <div style={{
            border: '1px dashed var(--border)', borderRadius: 7,
            padding: '14px 10px', textAlign: 'center',
            fontSize: 10, color: 'var(--faint)',
          }}>
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
          />
        ))}
      </div>
    </div>
  );
}

// ── Logique override intelligente ─────────────────────────────────────────────
// Si la position naturelle est >= à la position manuelle, on suit la position naturelle.
// Si la position naturelle est < à la position manuelle, on garde le manuel.

function resolveStage(
  naturalKey: string,
  overrideKey: string | null | undefined,
): string {
  // L'override manuel est toujours prioritaire — drag en arrière ou en avant.
  // Le naturel reprend uniquement s'il n'y a pas d'override.
  if (overrideKey) return overrideKey;
  return naturalKey;
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function PagePipeline() {
  const [tab, setTab] = useState<'ig' | 'yt'>('ig');
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const dropCounters = useRef<Record<string, number>>({});

  const { data, isLoading: loading } = useQuery<PipelineData | null>({
    queryKey: ['pipeline'],
    queryFn: () => fetch('/api/client/pipeline').then(r => r.ok ? r.json() : null),
    staleTime: 2 * 60 * 1000,
  });

  useEffect(() => {
    if (data?.overrides) {
      setOverrides(data.overrides);
    }
  }, [data?.overrides]);

  const getOverride = useCallback((key: string, platform: 'ig' | 'yt') =>
    overrides.find(o => o.prospect_key === key && o.platform === platform)?.stage ?? null,
  [overrides]);

  const saveOverride = useCallback(async (key: string, platform: 'ig' | 'yt', stage: string) => {
    setOverrides(prev => {
      const idx = prev.findIndex(o => o.prospect_key === key && o.platform === platform);
      const entry: Override = { prospect_key: key, platform, stage, updated_at: new Date().toISOString() };
      return idx >= 0 ? prev.map((o, i) => i === idx ? entry : o) : [...prev, entry];
    });
    await fetch('/api/client/pipeline', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prospect_key: key, platform, stage }),
    });
  }, []);

  // ── Build IG cards ──────────────────────────────────────────────────────────

  const igCards: CardData[] = [];
  if (data) {
    const seen = new Set<string>();
    for (const lead of data.leads) {
      if (seen.has(lead.ig_username)) continue;
      seen.add(lead.ig_username);

      // Étape naturelle
      let natural: IgStageKey = 'lm_sent';
      if (lead.hook_replied) natural = 'in_convo';

      const prospect = data.prospects.find(p =>
        p.ig_username.toLowerCase() === lead.ig_username.toLowerCase()
      );
      if (prospect) natural = 'calendly_sent';

      // Vérifier si le lien Calendly a été cliqué (via shortio — pas dispo directement ici, on check prospect humanClicks)
      if (prospect && (prospect as any).humanClicks30d > 0) natural = 'link_clicked';

      const call = data.calls.find(c =>
        c.ig_lead_id === lead.id ||
        c.invitee_email?.toLowerCase().includes(lead.ig_username.toLowerCase()) ||
        (c.source?.startsWith('ig'))
      );
      if (call) {
        natural = 'call_booked';
        if (new Date(call.scheduled_at) < new Date() && call.status === 'active' && !call.no_show) natural = 'showed_up';
        if (call.deal_closed) natural = 'closed';
      }

      const overrideKey = getOverride(lead.ig_username, 'ig');
      const stageKey = resolveStage(natural, overrideKey);
      const stageIdx = IG_STAGES.findIndex(s => s.key === stageKey);

      igCards.push({
        key: lead.ig_username,
        name: lead.ig_username,
        sub: lead.keyword_matched ? `#${lead.keyword_matched}` : '',
        date: timeAgo(lead.detected_at),
        stageKey,
        stageIdx: stageIdx >= 0 ? stageIdx : 0,
      });
    }
  }

  // ── Build YT cards ──────────────────────────────────────────────────────────

  const ytCards: CardData[] = [];
  if (data) {
    const ytCalls = data.calls.filter(c =>
      c.source?.startsWith('yt') || c.source?.startsWith('youtube') ||
      (!c.source?.startsWith('ig') && c.utm_content)
    );
    for (const call of ytCalls) {
      let natural: YtStageKey = 'call_booked';
      if (new Date(call.scheduled_at) < new Date() && call.status === 'active' && !call.no_show) natural = 'showed_up';
      if (call.deal_closed) natural = 'closed';

      const overrideKey = getOverride(call.id, 'yt');
      const stageKey = resolveStage(natural, overrideKey);
      const stageIdx = YT_STAGES.findIndex(s => s.key === stageKey);

      ytCards.push({
        key: call.id,
        name: call.invitee_name || 'Prospect',
        sub: call.utm_content ? `Vidéo ·${call.utm_content.slice(0, 10)}` : 'YouTube',
        date: timeAgo(call.scheduled_at),
        stageKey,
        stageIdx: stageIdx >= 0 ? stageIdx : 0,
        extra: call.revenue ? `${call.revenue.toLocaleString('fr-FR')} €` : undefined,
      });
    }
  }

  const stages = tab === 'ig' ? IG_STAGES : YT_STAGES;
  const cards = tab === 'ig' ? igCards : ytCards;
  const platform = tab;

  // ── Drag & drop ─────────────────────────────────────────────────────────────

  const handleDragStart = (e: React.DragEvent, cardKey: string) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', cardKey);
    setDraggingKey(cardKey);
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
    saveOverride(cardKey, platform, targetStageKey);
  };

  const totalProspects = cards.length;

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
        </div>

        {/* Onglets */}
        <div style={{ display: 'flex', background: 'var(--surface-2)', borderRadius: 8, padding: 3, gap: 2 }}>
          {([
            { key: 'ig', label: 'Instagram', count: igCards.length },
            { key: 'yt', label: 'YouTube', count: ytCards.length },
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

      {/* Kanban board */}
      {loading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Chargement…</div>
        </div>
      ) : (
        <div style={{
          flex: 1, overflowX: 'auto', overflowY: 'auto',
          paddingBottom: 16,
        }}>
          <div style={{
            display: 'flex', gap: 8, alignItems: 'stretch',
            minWidth: 'max-content', height: '100%',
          }}>
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
              {tab === 'ig' ? 'Aucun lead Instagram' : 'Aucun call YouTube'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, maxWidth: 260 }}>
              {tab === 'ig'
                ? 'Les prospects apparaissent ici dès qu\'ils reçoivent ton lead magnet en DM.'
                : 'Les calls bookés depuis tes liens YouTube description apparaissent ici.'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
