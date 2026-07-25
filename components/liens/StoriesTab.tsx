'use client';

import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

const INK = 'var(--ink)';
const MUTED = 'var(--muted)';
const FAINT = 'var(--faint)';
const SURFACE = 'var(--surface)';
const SURFACE2 = 'var(--surface-2)';
const BORDER = 'var(--border)';
const BG = 'var(--bg)';
const GREEN = 'var(--green)';
const GREEN_SOFT = 'var(--green-soft)';
const BLUE = '#6b7cde';
const BLUE_SOFT = '#6b7cde12';

interface StoryRow {
  id: string;
  ig_story_id: string;
  storage_url: string | null;
  permalink: string | null;
  posted_at: string;
  expired_at: string | null;
  sequence_id: string | null;
  sequence_name: string | null;
  reach: number | null;
  views: number | null;
}

interface SequenceRow {
  id: string;
  name: string;
  cta_type: 'lead_magnet' | 'calendly';
  cta_story_id: string | null;
  lm_keyword: string | null;
  lm_url: string | null;
  calendly_short_url: string | null;
  created_at: string;
  story_count: number;
}

interface LeadMagnet { id: string; name: string; url: string; keyword: string; }

function ContentGridSkeleton() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px,1fr))', gap: 10 }}>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} style={{ aspectRatio: '9/16', borderRadius: 8, background: SURFACE2, animation: 'pulse 1.4s ease-in-out infinite', animationDelay: `${(i % 4) * 0.1}s` }} />
      ))}
    </div>
  );
}

function formatDefaultSequenceName(isoDate: string): string {
  const d = new Date(isoDate);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `Séquence du ${dd}/${mm} - ${hh}h${min}`;
}

export default function StoriesTab({ profileId, leadMagnets }: { profileId: string; leadMagnets: LeadMagnet[] }) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [detailSequence, setDetailSequence] = useState<SequenceRow | null>(null);

  const { data: storiesData, isLoading: storiesLoading } = useQuery({
    queryKey: ['stories', profileId],
    queryFn: () => fetch(`/api/client/stories?profileId=${profileId}`).then(r => r.json()),
    enabled: !!profileId,
    staleTime: 60 * 1000,
  });

  const hasInstagram = !!storiesData && storiesData.connected !== false;

  const { data: sequencesData, isLoading: sequencesLoading } = useQuery({
    queryKey: ['story-sequences', profileId],
    queryFn: () => fetch(`/api/client/story-sequences?profileId=${profileId}`).then(r => r.json()),
    enabled: !!profileId && hasInstagram,
    staleTime: 60 * 1000,
  });

  const stories: StoryRow[] = storiesData?.stories ?? [];
  const sequences: SequenceRow[] = sequencesData?.sequences ?? [];

  if (storiesData && storiesData.connected === false) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 10, padding: 40, textAlign: 'center' }}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={FAINT} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>
        <div style={{ fontSize: 14, fontWeight: 600, color: INK, marginTop: 2 }}>Connecte ton compte Instagram</div>
        <div style={{ fontSize: 12, color: MUTED, maxWidth: 300, lineHeight: 1.6 }}>
          Pour créer des séquences de stories et suivre leurs stats, connecte d'abord ton compte Instagram Business dans les Réglages.
        </div>
      </div>
    );
  }

  const toggleSelect = (id: string, alreadyInSequence: boolean) => {
    if (alreadyInSequence) return;
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const refreshLive = async () => {
    setRefreshing(true);
    try {
      await fetch('/api/client/stories/live-refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profileId }) });
      await queryClient.invalidateQueries({ queryKey: ['stories', profileId] });
    } finally { setRefreshing(false); }
  };

  const selectedStories = useMemo(() => stories.filter(s => selected.has(s.id)).sort((a, b) => new Date(a.posted_at).getTime() - new Date(b.posted_at).getTime()), [stories, selected]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ padding: '10px 20px', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ fontSize: 12, color: MUTED }}>
          {selected.size > 0
            ? `${selected.size} story${selected.size > 1 ? 'ies' : ''} sélectionnée${selected.size > 1 ? 's' : ''}`
            : 'Coche des stories pour créer une séquence'}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={refreshLive} disabled={refreshing} style={{
            padding: '6px 12px', fontSize: 12, fontWeight: 600, borderRadius: 7, border: `1px solid ${BORDER}`, background: 'transparent', color: MUTED, cursor: refreshing ? 'default' : 'pointer', opacity: refreshing ? 0.6 : 1,
          }}>
            {refreshing ? 'Actualisation...' : '↻ Actualiser'}
          </button>
          <button onClick={() => setCreating(true)} disabled={selected.size === 0} style={{
            padding: '6px 14px', fontSize: 12, fontWeight: 700, borderRadius: 7, border: 'none',
            background: selected.size === 0 ? SURFACE2 : BLUE, color: selected.size === 0 ? MUTED : '#fff',
            cursor: selected.size === 0 ? 'default' : 'pointer',
          }}>
            Créer une séquence
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
          Stories ({stories.length})
        </div>
        {storiesLoading ? (
          <ContentGridSkeleton />
        ) : stories.length === 0 ? (
          <div style={{ fontSize: 12, color: FAINT, padding: '20px 0' }}>Aucune story détectée pour l'instant. Publie une story et clique sur "Actualiser".</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px,1fr))', gap: 10, marginBottom: 28 }}>
            {stories.map(story => {
              const isSelected = selected.has(story.id);
              const inSequence = !!story.sequence_id;
              return (
                <div key={story.id} onClick={() => toggleSelect(story.id, inSequence)} style={{
                  position: 'relative', aspectRatio: '9/16', borderRadius: 8, overflow: 'hidden', cursor: inSequence ? 'default' : 'pointer',
                  border: `2px solid ${isSelected ? BLUE : 'transparent'}`, opacity: inSequence ? 0.55 : 1, background: SURFACE2,
                }}>
                  {story.storage_url
                    ? <img src={story.storage_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: FAINT, fontSize: 11 }}>Story</div>
                  }
                  <div style={{ position: 'absolute', top: 6, left: 6, width: 18, height: 18, borderRadius: 5, border: `1.5px solid ${isSelected ? BLUE : 'rgba(255,255,255,.8)'}`, background: isSelected ? BLUE : 'rgba(0,0,0,.35)', display: inSequence ? 'none' : 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {isSelected && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                  </div>
                  {inSequence && (
                    <div style={{ position: 'absolute', top: 6, left: 6, right: 6, fontSize: 9, fontWeight: 700, color: '#fff', background: 'rgba(0,0,0,.55)', borderRadius: 4, padding: '2px 5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {story.sequence_name}
                    </div>
                  )}
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '16px 6px 6px', background: 'linear-gradient(transparent, rgba(0,0,0,.7))', fontSize: 10, color: '#fff', display: 'flex', justifyContent: 'space-between' }}>
                    <span>👁 {story.reach ?? '–'}</span>
                    <span>{new Date(story.posted_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ fontSize: 12, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
          Séquences ({sequences.length})
        </div>
        {sequencesLoading ? (
          <div style={{ fontSize: 12, color: FAINT }}>Chargement...</div>
        ) : sequences.length === 0 ? (
          <div style={{ fontSize: 12, color: FAINT }}>Aucune séquence créée pour l'instant.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sequences.map(seq => (
              <div key={seq.id} onClick={() => setDetailSequence(seq)} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderRadius: 8, border: `1px solid ${BORDER}`, cursor: 'pointer', background: SURFACE,
              }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: INK }}>{seq.name}</div>
                  <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{seq.story_count} story{seq.story_count > 1 ? 'ies' : ''}</div>
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, color: seq.cta_type === 'lead_magnet' ? GREEN : BLUE, background: seq.cta_type === 'lead_magnet' ? GREEN_SOFT : BLUE_SOFT, borderRadius: 4, padding: '2px 8px' }}>
                  {seq.cta_type === 'lead_magnet' ? `#${seq.lm_keyword}` : 'Calendly'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {creating && (
        <CreateSequenceModal
          profileId={profileId}
          stories={selectedStories}
          leadMagnets={leadMagnets}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            setSelected(new Set());
            queryClient.invalidateQueries({ queryKey: ['stories', profileId] });
            queryClient.invalidateQueries({ queryKey: ['story-sequences', profileId] });
          }}
        />
      )}

      {detailSequence && (
        <SequenceDetailModal sequence={detailSequence} profileId={profileId} onClose={() => setDetailSequence(null)} />
      )}
    </div>
  );
}

function CreateSequenceModal({ profileId, stories, leadMagnets, onClose, onCreated }: {
  profileId: string; stories: StoryRow[]; leadMagnets: LeadMagnet[]; onClose: () => void; onCreated: () => void;
}) {
  const [name, setName] = useState(() => formatDefaultSequenceName(stories[0]?.posted_at || new Date().toISOString()));
  const [ctaType, setCtaType] = useState<'lead_magnet' | 'calendly'>('lead_magnet');
  const [ctaStoryId, setCtaStoryId] = useState(stories[stories.length - 1]?.id || '');
  const [lmId, setLmId] = useState(leadMagnets[0]?.id || '');
  const [lmKeyword, setLmKeyword] = useState(leadMagnets[0]?.keyword || '');
  const [lmUrl, setLmUrl] = useState(leadMagnets[0]?.url || '');
  const [dm1Message, setDm1Message] = useState('👋 {{username}} voici ton lien : {{lien_lm}}');
  const [dm2StoryMessage, setDm2StoryMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [calendlyShortUrl, setCalendlyShortUrl] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true); setError(null);
    try {
      const res = await fetch('/api/client/story-sequences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profileId, name, ctaType, ctaStoryId, storyIds: stories.map(s => s.id),
          lmId: ctaType === 'lead_magnet' ? lmId : null,
          lmKeyword: ctaType === 'lead_magnet' ? lmKeyword : null,
          lmUrl: ctaType === 'lead_magnet' ? lmUrl : null,
          dm1Message: ctaType === 'lead_magnet' ? dm1Message : null,
          dm2StoryMessage: ctaType === 'lead_magnet' ? dm2StoryMessage : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Erreur'); return; }
      if (ctaType === 'calendly') setCalendlyShortUrl(data.calendlyShortUrl || null);
      else onCreated();
    } catch (e: any) {
      setError(e.message || 'Erreur réseau');
    } finally { setSaving(false); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: SURFACE, borderRadius: 12, padding: 24, maxWidth: 440, width: '90%', maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 10px 40px rgba(0,0,0,.2)' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: INK, marginBottom: 16 }}>Créer une séquence</div>

        {calendlyShortUrl ? (
          <div>
            <div style={{ fontSize: 13, color: MUTED, marginBottom: 10, lineHeight: 1.5 }}>
              Copie ce lien et ajoute-le en sticker "Lien" sur ta story CTA :
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <input readOnly value={calendlyShortUrl} style={{ flex: 1, padding: '8px 10px', fontSize: 12, borderRadius: 8, border: `1px solid ${BORDER}`, background: SURFACE2, color: INK }} />
              <button onClick={() => navigator.clipboard.writeText(calendlyShortUrl)} style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600, borderRadius: 8, border: 'none', background: BLUE, color: '#fff', cursor: 'pointer' }}>Copier</button>
            </div>
            <button onClick={onCreated} style={{ width: '100%', padding: '10px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none', background: GREEN, color: '#fff', cursor: 'pointer' }}>Terminé</button>
          </div>
        ) : (
          <>
            <label style={{ fontSize: 12, fontWeight: 600, color: MUTED, display: 'block', marginBottom: 4 }}>Nom de la séquence</label>
            <input value={name} onChange={e => setName(e.target.value)} style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 8, border: `1px solid ${BORDER}`, background: SURFACE, color: INK, marginBottom: 14, boxSizing: 'border-box' }} />

            <label style={{ fontSize: 12, fontWeight: 600, color: MUTED, display: 'block', marginBottom: 4 }}>Story avec le CTA</label>
            <select value={ctaStoryId} onChange={e => setCtaStoryId(e.target.value)} style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 8, border: `1px solid ${BORDER}`, background: SURFACE, color: INK, marginBottom: 14 }}>
              {stories.map((s, i) => <option key={s.id} value={s.id}>Story {i + 1} — {new Date(s.posted_at).toLocaleString('fr-FR')}</option>)}
            </select>

            <label style={{ fontSize: 12, fontWeight: 600, color: MUTED, display: 'block', marginBottom: 4 }}>Type de CTA</label>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              {(['lead_magnet', 'calendly'] as const).map(t => (
                <button key={t} onClick={() => setCtaType(t)} style={{
                  flex: 1, padding: '8px', fontSize: 12, fontWeight: 700, borderRadius: 8, cursor: 'pointer',
                  border: `1.5px solid ${ctaType === t ? BLUE : BORDER}`, background: ctaType === t ? BLUE_SOFT : 'transparent', color: ctaType === t ? BLUE : MUTED,
                }}>{t === 'lead_magnet' ? 'Lead Magnet' : 'Calendly'}</button>
              ))}
            </div>

            {ctaType === 'lead_magnet' ? (
              <>
                <label style={{ fontSize: 12, fontWeight: 600, color: MUTED, display: 'block', marginBottom: 4 }}>Lead magnet</label>
                <select value={lmId} onChange={e => {
                  const lm = leadMagnets.find(l => l.id === e.target.value);
                  setLmId(e.target.value);
                  if (lm) { setLmKeyword(lm.keyword); setLmUrl(lm.url); }
                }} style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 8, border: `1px solid ${BORDER}`, background: SURFACE, color: INK, marginBottom: 14 }}>
                  {leadMagnets.map(lm => <option key={lm.id} value={lm.id}>{lm.name}</option>)}
                </select>

                <label style={{ fontSize: 12, fontWeight: 600, color: MUTED, display: 'block', marginBottom: 4 }}>Mot-clé (reply à la story)</label>
                <input value={lmKeyword} onChange={e => setLmKeyword(e.target.value)} style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 8, border: `1px solid ${BORDER}`, background: SURFACE, color: INK, marginBottom: 14, boxSizing: 'border-box' }} />

                <label style={{ fontSize: 12, fontWeight: 600, color: MUTED, display: 'block', marginBottom: 4 }}>DM 1 — lien + message ({'{{username}}'}, {'{{lien_lm}}'})</label>
                <textarea value={dm1Message} onChange={e => setDm1Message(e.target.value)} rows={2} style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 8, border: `1px solid ${BORDER}`, background: SURFACE, color: INK, marginBottom: 14, boxSizing: 'border-box', resize: 'vertical' }} />

                <label style={{ fontSize: 12, fontWeight: 600, color: MUTED, display: 'block', marginBottom: 4 }}>DM 2 — message libre (envoyé juste après)</label>
                <textarea value={dm2StoryMessage} onChange={e => setDm2StoryMessage(e.target.value)} rows={2} style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 8, border: `1px solid ${BORDER}`, background: SURFACE, color: INK, marginBottom: 14, boxSizing: 'border-box', resize: 'vertical' }} />
              </>
            ) : (
              <div style={{ fontSize: 12, color: MUTED, marginBottom: 14, lineHeight: 1.5 }}>
                Un lien Calendly trackable sera généré. Tu devras l'ajouter toi-même via le sticker "Lien" natif d'Instagram sur ta story CTA.
              </div>
            )}

            {error && <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 10 }}>{error}</div>}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={onClose} disabled={saving} style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: `1px solid ${BORDER}`, background: 'none', color: INK, cursor: 'pointer' }}>Annuler</button>
              <button onClick={submit} disabled={saving || !name || !ctaStoryId} style={{ padding: '8px 16px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none', background: BLUE, color: '#fff', cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.7 : 1 }}>
                {saving ? 'Création...' : 'Créer la séquence'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SequenceDetailModal({ sequence, profileId, onClose }: { sequence: SequenceRow; profileId: string; onClose: () => void }) {
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
