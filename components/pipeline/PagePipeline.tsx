'use client';

import { useState, useEffect, useRef } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

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

// ── Colonnes IG & YT ─────────────────────────────────────────────────────────

const IG_STAGES = [
  { key: 'lm_sent',        label: 'LM reçu',           color: '#6366F1', bg: '#EEF2FF' },
  { key: 'in_convo',       label: 'En conversation',    color: '#8B5CF6', bg: '#F5F3FF' },
  { key: 'calendly_sent',  label: 'Calendly envoyé',    color: '#F59E0B', bg: '#FFFBEB' },
  { key: 'link_clicked',   label: 'Lien cliqué',        color: '#F97316', bg: '#FFF7ED' },
  { key: 'call_booked',    label: 'Call booké',          color: '#3B82F6', bg: '#EFF6FF' },
  { key: 'showed_up',      label: 'Show up',             color: '#10B981', bg: '#ECFDF5' },
  { key: 'closed',         label: 'Closé',               color: '#059669', bg: '#D1FAE5' },
];

const YT_STAGES = [
  { key: 'call_booked', label: 'Call booké', color: '#3B82F6', bg: '#EFF6FF' },
  { key: 'showed_up',   label: 'Show up',    color: '#10B981', bg: '#ECFDF5' },
  { key: 'closed',      label: 'Closé',      color: '#059669', bg: '#D1FAE5' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400000);
  if (d === 0) return 'Aujourd\'hui';
  if (d === 1) return 'Hier';
  if (d < 7) return `Il y a ${d}j`;
  if (d < 30) return `Il y a ${Math.floor(d / 7)}sem`;
  return `Il y a ${Math.floor(d / 30)}mois`;
}

function initials(name: string): string {
  return name.split(/[\s._]/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

// ── Card avatar colors déterministes ─────────────────────────────────────────
const AVATAR_COLORS = ['#6366F1','#8B5CF6','#F59E0B','#F97316','#3B82F6','#10B981','#EC4899','#14B8A6'];
function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

// ── ProspectCard ──────────────────────────────────────────────────────────────

interface CardProps {
  name: string;
  sub?: string;
  date: string;
  stageIdx: number;
  totalStages: number;
  stages: typeof IG_STAGES;
  onMove: (dir: -1 | 1) => void;
  saving: boolean;
  extra?: React.ReactNode;
}

function ProspectCard({ name, sub, date, stageIdx, totalStages, stages, onMove, saving, extra }: CardProps) {
  const stage = stages[stageIdx];
  const ac = avatarColor(name);

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: '12px 14px',
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      transition: 'box-shadow .15s',
      cursor: 'default',
      position: 'relative',
    }}
      onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,.07)')}
      onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}
    >
      {/* Avatar + nom */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 34, height: 34, borderRadius: 10, background: ac, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 12, fontWeight: 700, color: '#fff', letterSpacing: '.02em',
        }}>{initials(name)}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            @{name}
          </div>
          {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</div>}
        </div>
      </div>

      {/* Date */}
      <div style={{ fontSize: 10, color: 'var(--faint)' }}>{date}</div>

      {/* Barre de progression */}
      <div style={{ display: 'flex', gap: 3 }}>
        {stages.map((s, i) => (
          <div key={s.key} style={{
            flex: 1, height: 3, borderRadius: 2,
            background: i <= stageIdx ? s.color : 'var(--border)',
            transition: 'background .2s',
          }} />
        ))}
      </div>

      {/* Stage badge + nav */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{
          fontSize: 10, fontWeight: 700, color: stage.color,
          background: stage.bg, borderRadius: 6, padding: '3px 8px',
          border: `1px solid ${stage.color}22`,
        }}>{stage.label}</div>

        <div style={{ display: 'flex', gap: 2 }}>
          <button
            onClick={() => onMove(-1)} disabled={stageIdx === 0 || saving}
            aria-label="Reculer"
            style={{
              width: 26, height: 26, borderRadius: 7, border: '1px solid var(--border)',
              background: 'var(--surface-2)', cursor: stageIdx === 0 || saving ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              opacity: stageIdx === 0 || saving ? 0.35 : 1, transition: 'opacity .15s',
            }}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M6 2L3 5L6 8" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <button
            onClick={() => onMove(1)} disabled={stageIdx === totalStages - 1 || saving}
            aria-label="Avancer"
            style={{
              width: 26, height: 26, borderRadius: 7, border: '1px solid var(--border)',
              background: stageIdx === totalStages - 1 ? 'var(--surface-2)' : stage.color,
              cursor: stageIdx === totalStages - 1 || saving ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              opacity: stageIdx === totalStages - 1 || saving ? 0.35 : 1, transition: 'all .15s',
            }}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M4 2L7 5L4 8" stroke={stageIdx === totalStages - 1 ? 'var(--ink)' : '#fff'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </div>
      </div>

      {extra}

      {saving && (
        <div style={{ position: 'absolute', top: 8, right: 8, width: 6, height: 6, borderRadius: '50%', background: 'var(--amber)', animation: 'pulse 1s infinite' }} />
      )}
    </div>
  );
}

// ── KanbanColumn ──────────────────────────────────────────────────────────────

function KanbanColumn({ stage, count, children }: { stage: typeof IG_STAGES[0]; count: number; children: React.ReactNode }) {
  return (
    <div style={{
      minWidth: 240, maxWidth: 260, flex: '0 0 240px',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      {/* Header colonne */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 12px', borderRadius: 10,
        background: stage.bg, border: `1px solid ${stage.color}33`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: stage.color, flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: stage.color }}>{stage.label}</span>
        </div>
        <div style={{
          minWidth: 22, height: 22, borderRadius: 6, background: stage.color,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, fontWeight: 700, color: '#fff', padding: '0 6px',
        }}>{count}</div>
      </div>

      {/* Cartes */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 60 }}>
        {count === 0 ? (
          <div style={{
            border: '1.5px dashed var(--border)', borderRadius: 10, padding: '18px 12px',
            textAlign: 'center', fontSize: 11, color: 'var(--faint)',
          }}>Aucun prospect</div>
        ) : children}
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function PagePipeline() {
  const [tab, setTab] = useState<'ig' | 'yt'>('ig');
  const [data, setData] = useState<{ leads: IgLead[]; prospects: ProspectLink[]; calls: Call[]; overrides: Override[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/client/pipeline')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setData(d); })
      .finally(() => setLoading(false));
  }, []);

  const getOverrideStage = (key: string, platform: 'ig' | 'yt'): string | null => {
    return data?.overrides.find(o => o.prospect_key === key && o.platform === platform)?.stage ?? null;
  };

  const saveOverride = async (key: string, platform: 'ig' | 'yt', stage: string) => {
    setSavingKey(key);
    try {
      await fetch('/api/client/pipeline', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prospect_key: key, platform, stage }),
      });
      setData(prev => {
        if (!prev) return prev;
        const existing = prev.overrides.findIndex(o => o.prospect_key === key && o.platform === platform);
        const updated = { prospect_key: key, platform, stage, updated_at: new Date().toISOString() };
        const overrides = existing >= 0
          ? prev.overrides.map((o, i) => i === existing ? updated : o)
          : [...prev.overrides, updated];
        return { ...prev, overrides };
      });
    } finally { setSavingKey(null); }
  };

  // ── Calcul des étapes IG ──────────────────────────────────────────────────

  interface IgCard {
    key: string;
    username: string;
    sub: string;
    date: string;
    stageIdx: number;
  }

  const igCards: IgCard[] = [];
  if (data) {
    // Dédupliquer par ig_username (garder le plus récent)
    const seen = new Set<string>();
    for (const lead of data.leads) {
      if (seen.has(lead.ig_username)) continue;
      seen.add(lead.ig_username);

      const override = getOverrideStage(lead.ig_username, 'ig');
      let naturalStage = 'lm_sent';

      if (lead.hook_replied) naturalStage = 'in_convo';

      const prospectLink = data.prospects.find(p => p.ig_username.toLowerCase() === lead.ig_username.toLowerCase());
      if (prospectLink) naturalStage = 'calendly_sent';

      // Call lié à ce lead
      const relatedCall = data.calls.find(c =>
        c.ig_lead_id === lead.id ||
        c.invitee_name?.toLowerCase().includes(lead.ig_username.toLowerCase()) ||
        c.source?.includes('ig')
      );

      if (relatedCall) {
        naturalStage = 'call_booked';
        const callPast = new Date(relatedCall.scheduled_at) < new Date();
        if (callPast && relatedCall.status === 'active' && !relatedCall.no_show) naturalStage = 'showed_up';
        if (relatedCall.deal_closed) naturalStage = 'closed';
      }

      const stageKey = override ?? naturalStage;
      const stageIdx = IG_STAGES.findIndex(s => s.key === stageKey);

      igCards.push({
        key: lead.ig_username,
        username: lead.ig_username,
        sub: lead.keyword_matched ? `#${lead.keyword_matched}` : '',
        date: timeAgo(lead.detected_at),
        stageIdx: stageIdx >= 0 ? stageIdx : 0,
      });
    }
  }

  // ── Calcul des étapes YT ──────────────────────────────────────────────────

  interface YtCard {
    key: string;
    name: string;
    sub: string;
    date: string;
    stageIdx: number;
  }

  const ytCards: YtCard[] = [];
  if (data) {
    const ytCalls = data.calls.filter(c => c.source?.includes('yt') || c.source?.includes('youtube') || c.utm_content);
    for (const call of ytCalls) {
      const override = getOverrideStage(call.id, 'yt');
      let naturalStage = 'call_booked';
      const callPast = new Date(call.scheduled_at) < new Date();
      if (callPast && call.status === 'active' && !call.no_show) naturalStage = 'showed_up';
      if (call.deal_closed) naturalStage = 'closed';

      const stageKey = override ?? naturalStage;
      const stageIdx = YT_STAGES.findIndex(s => s.key === stageKey);

      ytCards.push({
        key: call.id,
        name: call.invitee_name || 'Prospect',
        sub: call.utm_content ? `Vidéo ${call.utm_content.slice(0, 8)}…` : 'YouTube',
        date: timeAgo(call.scheduled_at),
        stageIdx: stageIdx >= 0 ? stageIdx : 0,
      });
    }
  }

  const moveIg = (card: IgCard, dir: -1 | 1) => {
    const newIdx = Math.max(0, Math.min(IG_STAGES.length - 1, card.stageIdx + dir));
    saveOverride(card.key, 'ig', IG_STAGES[newIdx].key);
  };

  const moveYt = (card: YtCard, dir: -1 | 1) => {
    const newIdx = Math.max(0, Math.min(YT_STAGES.length - 1, card.stageIdx + dir));
    saveOverride(card.key, 'yt', YT_STAGES[newIdx].key);
  };

  const stages = tab === 'ig' ? IG_STAGES : YT_STAGES;
  const cards = tab === 'ig' ? igCards : ytCards;
  const totalProspects = cards.length;

  return (
    <div className="page-content" style={{ display: 'flex', flexDirection: 'column', gap: 20, height: '100%' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <h1 className="page-title" style={{ marginBottom: 4 }}>Pipeline prospects</h1>
          <p className="page-sub">
            {loading ? 'Chargement…' : `${totalProspects} prospect${totalProspects !== 1 ? 's' : ''} — du LM au closing`}
          </p>
        </div>

        {/* Onglets IG / YT */}
        <div style={{ display: 'flex', gap: 2, background: 'var(--surface-2)', borderRadius: 10, padding: 4, flexShrink: 0 }}>
          {(['ig', 'yt'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '7px 18px', fontSize: 12, fontWeight: 700, borderRadius: 7,
              cursor: 'pointer', border: 'none', transition: 'all .15s',
              background: tab === t ? 'var(--surface)' : 'transparent',
              color: tab === t ? 'var(--ink)' : 'var(--muted)',
              boxShadow: tab === t ? '0 1px 4px rgba(0,0,0,.08)' : 'none',
            }}>
              {t === 'ig' ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>
                  Instagram
                </span>
              ) : (
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.95-1.96C18.88 4 12 4 12 4s-6.88 0-8.59.46a2.78 2.78 0 0 0-1.95 1.96A29 29 0 0 0 1 12a29 29 0 0 0 .46 5.58A2.78 2.78 0 0 0 3.41 19.54C5.12 20 12 20 12 20s6.88 0 8.59-.46a2.78 2.78 0 0 0 1.95-1.96A29 29 0 0 0 23 12a29 29 0 0 0-.46-5.58z"/><polygon points="9.75 15.02 15.5 12 9.75 8.98 9.75 15.02"/></svg>
                  YouTube
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Kanban scrollable */}
      {loading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>Chargement du pipeline…</div>
        </div>
      ) : (
        <div
          ref={scrollRef}
          style={{
            flex: 1,
            overflowX: 'auto',
            overflowY: 'visible',
            paddingBottom: 24,
            scrollbarWidth: 'thin',
          }}
        >
          <div style={{
            display: 'flex',
            gap: 12,
            alignItems: 'flex-start',
            minWidth: 'max-content',
            paddingBottom: 8,
          }}>
            {stages.map((stage, si) => {
              const stageCards = tab === 'ig'
                ? (igCards as IgCard[]).filter(c => c.stageIdx === si)
                : (ytCards as YtCard[]).filter(c => c.stageIdx === si);

              return (
                <KanbanColumn key={stage.key} stage={stage} count={stageCards.length}>
                  {tab === 'ig'
                    ? (stageCards as IgCard[]).map(card => (
                        <ProspectCard
                          key={card.key}
                          name={card.username}
                          sub={card.sub}
                          date={card.date}
                          stageIdx={card.stageIdx}
                          totalStages={IG_STAGES.length}
                          stages={IG_STAGES}
                          onMove={dir => moveIg(card, dir)}
                          saving={savingKey === card.key}
                        />
                      ))
                    : (stageCards as YtCard[]).map(card => (
                        <ProspectCard
                          key={card.key}
                          name={card.name}
                          sub={card.sub}
                          date={card.date}
                          stageIdx={card.stageIdx}
                          totalStages={YT_STAGES.length}
                          stages={YT_STAGES}
                          onMove={dir => moveYt(card, dir)}
                          saving={savingKey === card.key}
                        />
                      ))
                  }
                </KanbanColumn>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && totalProspects === 0 && (
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, paddingBottom: 60,
        }}>
          <div style={{
            width: 52, height: 52, borderRadius: 14, background: 'var(--surface-2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>
              {tab === 'ig' ? 'Aucun lead Instagram' : 'Aucun call YouTube'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, maxWidth: 280 }}>
              {tab === 'ig'
                ? 'Les prospects apparaissent ici dès qu\'ils reçoivent ton lead magnet en DM automatique.'
                : 'Les calls bookés depuis tes liens YouTube description apparaissent ici.'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
