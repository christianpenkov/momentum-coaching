'use client';

import { useQuery } from '@tanstack/react-query';

const INK = 'var(--ink)';
const MUTED = 'var(--muted)';
const FAINT = 'var(--faint)';
const SURFACE = 'var(--surface)';
const SURFACE2 = 'var(--surface-2)';
const BORDER = 'var(--border)';

interface SequenceRow {
  id: string;
  name: string;
  cta_type: 'lead_magnet' | 'calendly';
  cta_story_id: string | null;
  lm_keyword: string | null;
  lm_url: string | null;
  dm1_message: string | null;
  dm2_story_message: string | null;
  calendly_short_url: string | null;
  created_at: string;
  story_count: number;
}

// Popup de stats détaillées pour une séquence (rétention + funnel business + détail
// par story) — l'UI de création/édition de séquence, elle, est inline dans
// PanneauStorySequence (components/liens/PageLiens.tsx), pas ici.
export function SequenceDetailModal({ sequence, profileId, onClose }: { sequence: SequenceRow; profileId: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['story-sequence-detail', sequence.id],
    queryFn: () => fetch(`/api/instagram/story-sequences-stats?profileId=${profileId}&sequenceId=${sequence.id}`).then(r => r.json()),
    staleTime: 60 * 1000,
  });

  const stats = data?.stats;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: SURFACE, borderRadius: 12, padding: 24, maxWidth: 560, width: '92%', maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 10px 40px rgba(0,0,0,.2)' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: INK, marginBottom: 4 }}>{sequence.name}</div>
        <div style={{ fontSize: 11, color: MUTED, marginBottom: 16 }}>{sequence.cta_type === 'lead_magnet' ? `Lead Magnet — mot-clé #${sequence.lm_keyword}` : 'Calendly'}</div>

        {isLoading ? (
          <div style={{ fontSize: 12, color: FAINT }}>Chargement des stats...</div>
        ) : !stats ? (
          <div style={{ fontSize: 12, color: FAINT }}>Pas encore de données pour cette séquence.</div>
        ) : (
          <>
            <div style={{ fontSize: 12, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>Vue d'ensemble</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 20 }}>
              {[
                { label: 'Rétention', value: stats.retentionPct != null ? `${stats.retentionPct}%` : '–' },
                { label: 'Leads', value: stats.leadsCount ?? 0 },
                { label: 'Calls bookés', value: stats.callsBooked ?? 0 },
                { label: 'Calls honorés', value: stats.callsHonored ?? 0 },
                { label: 'Closés', value: stats.dealsClosed ?? 0 },
                { label: 'Revenue', value: stats.revenue != null ? `${stats.revenue}€` : '0€' },
              ].map(kpi => (
                <div key={kpi.label} style={{ padding: '10px 8px', borderRadius: 8, background: SURFACE2, textAlign: 'center' }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: INK }}>{kpi.value}</div>
                  <div style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>{kpi.label}</div>
                </div>
              ))}
            </div>

            <div style={{ fontSize: 12, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>Détail par story</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(stats.storiesDetail || []).map((s: any, i: number) => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, border: `1px solid ${BORDER}` }}>
                  <div style={{ width: 32, height: 32, borderRadius: 6, overflow: 'hidden', flexShrink: 0, background: SURFACE2 }}>
                    {s.storage_url && <img src={s.storage_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                  </div>
                  <div style={{ flex: 1, fontSize: 11, color: MUTED }}>
                    Story {i + 1} — reach {s.reach ?? '–'} · vues {s.views ?? '–'} · partages {s.shares ?? '–'}
                    <br />
                    tap→ {s.navigation_taps_forward ?? '–'} · tap← {s.navigation_taps_back ?? '–'} · sorties {s.navigation_exits ?? '–'} · visites profil {s.profile_visits ?? '–'} · abonnements {s.follows ?? '–'} · interactions {s.total_interactions ?? '–'}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
          <button onClick={onClose} style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: `1px solid ${BORDER}`, background: 'none', color: INK, cursor: 'pointer' }}>Fermer</button>
        </div>
      </div>
    </div>
  );
}
