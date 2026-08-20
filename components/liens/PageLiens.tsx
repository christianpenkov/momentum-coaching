'use client';

import { useState, useEffect, useRef, useCallback, useMemo, createContext, useContext, Fragment, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useUser } from '@/lib/UserContext';
import { createClient } from '@/lib/supabase/client';
import Avatar, { getInitials } from '@/components/ui/Avatar';
import ModalShell from '@/components/ui/ModalShell';
import { useIsMobile } from '@/lib/useIsMobile';

// ─── Garde de navigation — bloque un changement de post/onglet si des DMs ne sont pas sauvegardés ──
interface UnsavedGuardApi {
  setHasUnsaved: (v: boolean) => void;
  guard: (action: () => void) => void;
  registerSaveAll: (fn: (() => Promise<void>) | null) => void;
  saveAll: () => Promise<void>;
}
const UnsavedGuardContext = createContext<UnsavedGuardApi | null>(null);
function useUnsavedGuard() {
  return useContext(UnsavedGuardContext);
}

// ─── Design tokens (alignés sur globals.css) ──────────────────────────────────
const INK = 'var(--ink)';
const MUTED = 'var(--muted)';
const FAINT = 'var(--faint)';
const SURFACE = 'var(--surface)';
const SURFACE2 = 'var(--surface-2)';
const BORDER = 'var(--border)';
const BORDER_SOFT = 'var(--border-soft)';
const BG = 'var(--bg)';
const GREEN = 'var(--green)';
const GREEN_SOFT = 'var(--green-soft)';
const RED = 'var(--red)';
const AMBER = 'var(--amber)';

// Valeurs par défaut du DM2, affichées en placeholder quand le champ est vide.
// DOIVENT rester identiques à DM2_DEFAULT_MESSAGE / DM2_DEFAULT_BUTTON dans
// app/api/webhooks/instagram/route.ts : le placeholder montre ce qui sera
// réellement envoyé si on ne remplit rien — s'ils divergent, il ment.
const DM2_DEFAULT_MESSAGE = 'Voici ton lien 👇';
const DM2_DEFAULT_BUTTON = '📖 Accéder au lien';
const AMBER_SOFT = 'var(--amber-soft)';
// Ardoise du design system (DESIGN.md) — remplace l'ancien bleu-violet #6b7cde qui
// n'appartenait pas à la palette Momentum. BLUE/BLUE_SOFT gardés comme alias pour
// limiter le diff sur les ~60 usages existants (CTA, onglet actif, focus, sélection).
const ACCENT = 'var(--accent-brand)';
const ACCENT_SOFT = 'var(--accent-brand-soft)';
const BLUE = ACCENT;
const BLUE_SOFT = ACCENT_SOFT;
// Les stories n'ont pas de couleur de marque comme IG et YT : ce violet les
// distingue dans les listes et les pastilles de séquence.
const STORY_COLOR = '#8b5cf6';
const STORY_SOFT = '#8b5cf612';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ShortDomain { id: string | number; hostname: string; }

interface Post {
  id: string;
  caption: string;
  platform: 'IG' | 'YT' | 'STORY';
  thumbnail?: string | null;
  permalink?: string | null;
  hasDescLink?: boolean;
  hasLeadMagnet?: boolean;
  // Lien description — 3 liens séparés selon la destination
  descCalendlyUrl?: string;
  descCalendlyShortId?: string;
  descLmUrl?: string;
  descLmShortId?: string;
  descLmLmId?: string;
  descCustomUrl?: string;
  descCustomShortId?: string;
  // Compat ancienne colonne (pour affichage initial)
  descLinkUrl?: string;
  descDestType?: string;
  lmKeyword?: string;
  lmShortUrl?: string;
  lmLmId?: string;
  dmOpenerMessage?: string;
  dmLmMessage?: string;
  dmLinkMessage?: string;
  dmLinkButtonText?: string;
  dmButtonText?: string;
  // Champs spécifiques platform === 'STORY' — le CTA d'une story vit toujours au
  // niveau de sa story_sequences (même une "séquence solo" à 1 story), jamais
  // directement sur ig_stories. Voir plan Stories pour le détail du principe.
  igStoryId?: string;
  sequenceId?: string | null;
  sequenceName?: string | null;
  sequenceStoryCount?: number;
  ctaStoryId?: string | null;
  lmId?: string | null;
  dm1Message?: string | null;
  dm2StoryMessage?: string | null;
  calendlyShortUrl?: string | null;
  reach?: number | null;
  views?: number | null;
  postedAt?: string;
  expiredAt?: string | null;
  // Méta de la ligne : « Reel · 28 juillet · 142 clics ». Le type et la date
  // étaient déjà renvoyés par /api/instagram/stats et /api/youtube/stats, ils
  // n'étaient simplement pas repris au mapping.
  mediaType?: string | null;
  publishedAt?: string | null;
  clics?: number | null;
}

interface ContentLink {
  content_id: string;
  platform: string;
  desc_short_url?: string | null;
  desc_dest_type?: string | null;
  lm_id?: string | null;
  lm_short_url?: string | null;
  lm_keyword?: string | null;
  dm_opener_message?: string | null;
  dm_lm_message?: string | null;
  dm_button_text?: string | null;
  dm_link_message?: string | null;
  dm_link_button_text?: string | null;
}

interface LeadMagnet {
  id: string;
  name: string;
  url: string;
  keyword: string;
  created_at?: string;
  bio_ig_url?: string | null;
  bio_yt_url?: string | null;
  bio_ig_source_url?: string | null;
  bio_yt_source_url?: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function slugify(s: string) {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function normalizeUrl(url: string): string {
  const t = url.trim();
  if (!t) return t;
  if (t.startsWith('http://') || t.startsWith('https://')) return t;
  return `https://${t}`;
}

function isValidUrl(url: string): boolean {
  const normalized = normalizeUrl(url.trim());
  try { new URL(normalized); return true; } catch { return false; }
}

async function callShortio(payload: Record<string, unknown>): Promise<{ shortUrl: string }> {
  const res = await fetch('/api/shortio/links', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    throw new Error(`Erreur serveur (${res.status}) — vérifie que Short.io est connecté dans Réglages`);
  }
  const data = await res.json();
  if (!res.ok) {
    if (data.error === 'no_token') throw new Error('Short.io non connecté — va dans Réglages');
    throw new Error(data.error || 'Erreur Short.io');
  }
  return { shortUrl: data.shortUrl };
}

// ─── Mini-composants ──────────────────────────────────────────────────────────

function Badge({ color, bg, children }: { color: string; bg: string; children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 9, fontWeight: 700, color, background: bg, borderRadius: 4, padding: '2px 5px', letterSpacing: '0.04em' }}>
      {children}
    </span>
  );
}

function CopyBtn({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const isMobile = useIsMobile();
  return (
    <button onClick={() => { navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      style={{ padding: isMobile ? '11px 14px' : '5px 12px', minHeight: isMobile ? 44 : undefined, fontSize: 12, fontWeight: 600, borderRadius: 6, border: `1px solid ${copied ? 'transparent' : BORDER}`, background: copied ? 'var(--green)' : SURFACE, color: copied ? '#fff' : INK, cursor: 'pointer', transition: 'all .2s', whiteSpace: 'nowrap' }}>
      {copied ? '✓ Copié' : 'Copier'}
    </button>
  );
}

function GeneratedUrlRow({ url, label }: { url: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: SURFACE2, borderRadius: 8, padding: '8px 12px' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="eyebrow-sm" style={{ color: MUTED, marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: 12, fontWeight: 700, color: INK, wordBreak: 'break-all' }}>{url}</div>
      </div>
      <CopyBtn url={url} />
    </div>
  );
}

function Spinner() {
  return <span style={{ display: 'inline-block', width: 14, height: 14, border: `2px solid ${BORDER}`, borderTopColor: BLUE, borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />;
}

function ContentGridSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px' }}>
          <div style={{ width: 36, height: 36, borderRadius: 6, background: SURFACE2, flexShrink: 0, animation: 'pulse 1.4s ease-in-out infinite', animationDelay: `${(i % 5) * 0.08}s` }} />
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ height: 10, width: `${55 + (i % 4) * 10}%`, borderRadius: 4, background: SURFACE2, animation: 'pulse 1.4s ease-in-out infinite', animationDelay: `${(i % 5) * 0.08}s` }} />
            <div style={{ height: 8, width: 60, borderRadius: 4, background: SURFACE2, animation: 'pulse 1.4s ease-in-out infinite', animationDelay: `${(i % 5) * 0.08 + 0.05}s` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Modal Paramètres ─────────────────────────────────────────────────────────

function ModalParametres({ open, onClose, profileId, activeDomain, domainsLoaded, onCalendlyChange, initialCalendly, leadMagnets, onLmUpdated }: {
  open: boolean; onClose: () => void;
  profileId: string; activeDomain: ShortDomain | null; domainsLoaded: boolean;
  onCalendlyChange: (url: string) => void; initialCalendly: string;
  leadMagnets: LeadMagnet[];
  onLmUpdated: (lm: LeadMagnet) => void;
}) {
  const isMobile = useIsMobile();
  const [calendlyUrl, setCalendlyUrl] = useState(initialCalendly);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bioIg, setBioIg] = useState<string | null>(null);
  const [bioYt, setBioYt] = useState<string | null>(null);
  const [genIg, setGenIg] = useState(false);
  const [genYt, setGenYt] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Lien LM bio — keyed par lm.id pour éviter le mélange entre LMs
  const [selectedLmId, setSelectedLmId] = useState('');
  const [lmBioUrls, setLmBioUrls] = useState<Record<string, { ig?: string; yt?: string }>>({});
  const [genLmLoading, setGenLmLoading] = useState<Record<string, boolean>>({});
  const [genLmSuccess, setGenLmSuccess] = useState<Record<string, boolean>>({});
  const domain = activeDomain?.hostname || '';
  const canGenerate = domainsLoaded && !!domain;
  const isValid = calendlyUrl.trim().startsWith('http');

  useEffect(() => { setCalendlyUrl(initialCalendly); }, [initialCalendly]);

  // Charge les urls bio LM déjà générés depuis les données en DB
  useEffect(() => {
    const init: Record<string, { ig?: string; yt?: string }> = {};
    leadMagnets.forEach(lm => {
      if (lm.bio_ig_url || lm.bio_yt_url) {
        init[lm.id] = { ig: lm.bio_ig_url ?? undefined, yt: lm.bio_yt_url ?? undefined };
      }
    });
    setLmBioUrls(init);
  }, [leadMagnets]);

  // Génère automatiquement les liens bio au montage si Calendly déjà configuré
  useEffect(() => {
    if (open && initialCalendly.trim().startsWith('http') && canGenerate && !bioIg && !bioYt) {
      genBio('instagram', setBioIg, setGenIg);
      genBio('youtube', setBioYt, setGenYt);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, canGenerate]);

  const save = async () => {
    if (!isValid) return;
    setSaving(true); setError(null);
    try {
      await fetch('/api/client/settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ calendly_url: calendlyUrl.trim() }) });
      setSaved(true); onCalendlyChange(calendlyUrl.trim());
      setTimeout(() => setSaved(false), 2500);
      // Génère automatiquement les liens bio après sauvegarde
      if (canGenerate) {
        genBio('instagram', setBioIg, setGenIg);
        genBio('youtube', setBioYt, setGenYt);
      }
    } catch { setError('Erreur sauvegarde'); } finally { setSaving(false); }
  };

  const genBio = async (platform: 'instagram' | 'youtube', setResult: (v: string) => void, setLoading: (v: boolean) => void) => {
    if (!isValid || !canGenerate) return;
    setLoading(true); setError(null);
    try {
      const bioLabel = 'Prendre RDV';
      const bioPath = platform === 'instagram' ? 'bio-calendly-ig' : 'bio-calendly-yt';
      const { shortUrl } = await callShortio({ profileId, domainId: domain, originalUrl: calendlyUrl.trim(), title: bioLabel, utmSource: platform === 'instagram' ? 'ig' : 'yt', utmMedium: 'bio', utmCampaign: `bio-${platform}`, path: bioPath });
      setResult(shortUrl);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };

  const genLmBio = async (lmId: string, platform: 'ig' | 'yt') => {
    if (!canGenerate) return;
    const lm = leadMagnets.find(l => l.id === lmId);
    if (!lm) return;
    const key = `${lmId}-${platform}`;
    setGenLmLoading(prev => ({ ...prev, [key]: true })); setError(null);
    try {
      const lmBioSlug = slugify(lm.name.split(/\s+/).slice(0, 3).join('-'));
      const { shortUrl } = await callShortio({
        profileId, domainId: domain, originalUrl: lm.url,
        title: lm.name,
        utmSource: platform === 'ig' ? 'ig' : 'yt', utmMedium: 'bio',
        utmCampaign: `lm-bio-${platform}`,
        path: `${lmBioSlug}-${platform === 'ig' ? 'ig' : 'yt'}`,
      });
      // Sauvegarde en DB
      await fetch('/api/client/lead-magnets', {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: lmId, [`bio_${platform}_url`]: shortUrl, [`bio_${platform}_source_url`]: lm.url }),
      });
      setLmBioUrls(prev => ({ ...prev, [lmId]: { ...prev[lmId], [platform]: shortUrl } }));
      onLmUpdated({ ...lm, [`bio_${platform}_url`]: shortUrl, [`bio_${platform}_source_url`]: lm.url });
      setGenLmSuccess(prev => ({ ...prev, [key]: true }));
      setTimeout(() => setGenLmSuccess(prev => ({ ...prev, [key]: false })), 5000);
    } catch (e: any) { setError(e.message); } finally { setGenLmLoading(prev => ({ ...prev, [key]: false })); }
  };

  if (!open) return null;

  return (
    <ModalShell onClose={onClose} width={560} variant={isMobile ? 'sheet' : 'centered'}>
      <div style={{ padding: isMobile ? '20px 16px' : 28, overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: INK }}>Paramètres des liens</div>
          <button onClick={onClose} aria-label="Fermer" className="icon-btn" style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: MUTED, lineHeight: 1, padding: 10, minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>

        {/* Calendly */}
        <div style={{ marginBottom: 20 }}>
          <div className="eyebrow-sm" style={{ color: MUTED, marginBottom: 6 }}>Lien Calendly</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={calendlyUrl} onChange={e => setCalendlyUrl(e.target.value)} placeholder="https://calendly.com/ton-nom/discovery"
              style={{ flex: 1, padding: '8px 10px', fontSize: 12, borderRadius: 8, border: `1px solid ${BORDER}`, background: BG, color: INK, outline: 'none' }} />
            <button onClick={save} disabled={saving || !isValid} style={{ padding: '8px 14px', fontSize: 12, fontWeight: 700, borderRadius: 8, border: 'none', background: saved ? 'var(--green)' : BLUE, color: '#fff', cursor: !isValid || saving ? 'not-allowed' : 'pointer', opacity: !isValid || saving ? 0.5 : 1, whiteSpace: 'nowrap', transition: 'all .2s' }}>
              {saving ? '...' : saved ? '✓' : 'Sauver'}
            </button>
          </div>
          <div style={{ fontSize: 11, color: FAINT, marginTop: 5 }}>Utilisé automatiquement pour tous les liens Calendly générés.</div>
        </div>

        {/* Liens bio */}
        <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 16 }}>
          <div className="eyebrow-sm" style={{ color: MUTED, marginBottom: 10 }}>Liens bio Calendly</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              { platform: 'instagram' as const, label: 'Bio Instagram', result: bioIg, setResult: setBioIg, loading: genIg, setLoading: setGenIg, path: 'bio-calendly-ig' },
              { platform: 'youtube' as const, label: 'Bio YouTube', result: bioYt, setResult: setBioYt, loading: genYt, setLoading: setGenYt, path: 'bio-calendly-yt' },
            ].map(({ platform, label, result, setResult, loading, setLoading }) => (
              <div key={platform} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 8, background: SURFACE2, border: `1px solid ${BORDER}` }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>{label}</div>
                  <div style={{ fontSize: 11, color: result ? INK : FAINT, fontWeight: result ? 600 : 400, wordBreak: 'break-all' }}>
                    {result || (domain ? `${domain}/bio-calendly-${platform === 'instagram' ? 'ig' : 'yt'}` : '—')}
                  </div>
                </div>
                {result
                  ? <CopyBtn url={result} />
                  : loading
                    ? <span style={{ fontSize: 11, color: FAINT }}>...</span>
                    : <span style={{ fontSize: 11, color: FAINT }}>—</span>
                }
              </div>
            ))}
          </div>
          {!isValid && <div style={{ fontSize: 11, color: AMBER, marginTop: 8 }}>⚠ Sauvegarde d'abord ton lien Calendly.</div>}
          {!canGenerate && domainsLoaded && <div style={{ fontSize: 11, color: RED, marginTop: 8 }}>⚠ Short.io non connecté — va dans Réglages.</div>}
          {error && <div style={{ fontSize: 11, color: RED, background: 'var(--red-soft)', borderRadius: 6, padding: '6px 10px', marginTop: 8 }}>{error}</div>}
        </div>

        {/* Liens bio Lead Magnet */}
        {leadMagnets.length > 0 && (
          <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 16, marginTop: 4 }}>
            <div className="eyebrow-sm" style={{ color: MUTED, marginBottom: 10 }}>Liens bio Lead Magnet</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {leadMagnets.map(lm => {
                const urls = lmBioUrls[lm.id] || {};
                const isSelected = selectedLmId === lm.id;
                return (
                  <div key={lm.id} style={{ borderRadius: 10, border: `1.5px solid ${isSelected ? BLUE : BORDER}`, background: SURFACE2, overflow: 'hidden', transition: 'border-color .15s' }}>
                    {/* Header LM cliquable */}
                    <div onClick={() => setSelectedLmId(isSelected ? '' : lm.id)}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', cursor: 'pointer' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: INK }}>{lm.name}</span>
                          {((lm.bio_ig_url && lm.bio_ig_source_url && lm.bio_ig_source_url !== lm.url) ||
                            (lm.bio_yt_url && lm.bio_yt_source_url && lm.bio_yt_source_url !== lm.url)) && (
                            <span style={{ width: 10, height: 10, borderRadius: '50%', background: AMBER, flexShrink: 0, display: 'inline-block', boxShadow: `0 0 0 3px ${AMBER_SOFT}` }} />
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: FAINT }}>{lm.url}</div>
                      </div>
                      <span style={{ fontSize: 10, color: FAINT }}>{isSelected ? '▲' : '▼'}</span>
                    </div>
                    {/* Liens bio si déployé */}
                    {isSelected && (
                      <div style={{ borderTop: `1px solid ${BORDER}`, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {/* Warning si URL du LM a changé depuis la génération */}
                        {((lm.bio_ig_url && lm.bio_ig_source_url && lm.bio_ig_source_url !== lm.url) ||
                          (lm.bio_yt_url && lm.bio_yt_source_url && lm.bio_yt_source_url !== lm.url)) && (
                          <div style={{ display: 'flex', gap: 10, background: AMBER_SOFT, border: `1px solid ${AMBER}`, borderRadius: 8, padding: '10px 12px' }}>
                            <span style={{ fontSize: 18, flexShrink: 0 }}>⚠️</span>
                            <div>
                              <div style={{ fontSize: 12, fontWeight: 700, color: AMBER, marginBottom: 4 }}>URL modifiée — liens bio à mettre à jour</div>
                              <div style={{ fontSize: 11, color: INK, lineHeight: 1.5 }}>
                                Ces liens pointent encore vers l'ancienne URL. Clique <strong>Regénérer</strong> pour chacun :
                              </div>
                              <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
                                {lm.bio_ig_url && lm.bio_ig_source_url && lm.bio_ig_source_url !== lm.url && (
                                  <div style={{ fontSize: 11, color: MUTED }}>📸 <strong>Bio Instagram</strong> — {lm.bio_ig_url}</div>
                                )}
                                {lm.bio_yt_url && lm.bio_yt_source_url && lm.bio_yt_source_url !== lm.url && (
                                  <div style={{ fontSize: 11, color: MUTED }}>▶️ <strong>Bio YouTube</strong> — {lm.bio_yt_url}</div>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                        {(['ig', 'yt'] as const).map(p => {
                          const label = p === 'ig' ? '📸 Bio Instagram' : '▶️ Bio YouTube';
                          const url = urls[p];
                          const loading = genLmLoading[`${lm.id}-${p}`];
                          return (
                            <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, background: SURFACE, border: `1px solid ${BORDER}` }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 2 }}>{label}</div>
                                <div style={{ fontSize: 11, color: url ? INK : FAINT, wordBreak: 'break-all' }}>
                                  {url || '—'}
                                </div>
                              </div>
                              {url ? (
                                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                                  {/* Cas 2 — supprimer le lien bio */}
                                  <button onClick={async () => {
                                    await fetch('/api/client/lead-magnets', {
                                      method: 'PATCH', headers: { 'content-type': 'application/json' },
                                      body: JSON.stringify({ id: lm.id, [`bio_${p}_url`]: null, [`bio_${p}_source_url`]: null }),
                                    });
                                    setLmBioUrls(prev => ({ ...prev, [lm.id]: { ...prev[lm.id], [p]: undefined } }));
                                    onLmUpdated({ ...lm, [`bio_${p}_url`]: null, [`bio_${p}_source_url`]: null });
                                  }} style={{ padding: '4px 8px', fontSize: 11, fontWeight: 600, borderRadius: 6, border: `1px solid ${BORDER}`, background: 'none', color: RED, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                    Supprimer
                                  </button>
                                  {/* Cas 3 — regénérer */}
                                  <button onClick={() => genLmBio(lm.id, p)} disabled={loading || !canGenerate}
                                    style={{ padding: '4px 8px', fontSize: 11, fontWeight: 600, borderRadius: 6, border: `1px solid ${genLmSuccess[`${lm.id}-${p}`] ? 'var(--green)' : BORDER}`, background: genLmSuccess[`${lm.id}-${p}`] ? 'var(--green-soft)' : 'none', color: genLmSuccess[`${lm.id}-${p}`] ? 'var(--green)' : MUTED, cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all .2s' }}>
                                    {loading ? '...' : genLmSuccess[`${lm.id}-${p}`] ? '✓ Regénéré' : 'Regénérer'}
                                  </button>
                                  <CopyBtn url={url} />
                                </div>
                              ) : (
                                <button onClick={() => genLmBio(lm.id, p)} disabled={loading || !canGenerate}
                                  style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 6, border: 'none', background: BLUE, color: '#fff', cursor: !canGenerate || loading ? 'not-allowed' : 'pointer', opacity: !canGenerate || loading ? 0.5 : 1, whiteSpace: 'nowrap' }}>
                                  {loading ? '...' : 'Générer'}
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {error && <div style={{ fontSize: 11, color: RED, background: 'var(--red-soft)', borderRadius: 6, padding: '6px 10px', marginTop: 8 }}>{error}</div>}
          </div>
        )}
      </div>
    </ModalShell>
  );
}

// ─── Panneau droit : actions pour un contenu ──────────────────────────────────

function TabDesc({ post, profileId, domain, canGenerate, showDisconnectedWarning, calendlyUrl, leadMagnets, onPostUpdated }: {
  post: Post; profileId: string; domain: string; canGenerate: boolean; showDisconnectedWarning: boolean;
  calendlyUrl: string; leadMagnets: LeadMagnet[];
  onPostUpdated: (postId: string, patch: Partial<Post>) => void;
}) {
  const hasCalendly = calendlyUrl.trim().startsWith('http');
  const destOptions = post.platform === 'IG'
    ? [{ key: 'calendly', label: 'Calendly' }, { key: 'leadmagnet', label: 'Lead magnet' }, { key: 'custom', label: 'URL custom' }]
    : [{ key: 'calendly', label: 'Calendly' }, { key: 'custom', label: 'URL custom' }];

  const [destType, setDestType] = useState<'calendly' | 'leadmagnet' | 'custom'>('calendly');
  // Pour lead magnet : ID du LM sélectionné (pas l'URL)
  const [selectedLmId, setSelectedLmId] = useState<string>('');
  const [customUrl, setCustomUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Résout l'URL courte affichée selon le type actif — 3 liens indépendants
  const currentUrl = destType === 'calendly'
    ? (post.descCalendlyUrl || null)
    : destType === 'leadmagnet'
      ? (post.descLmUrl || null)
      : (post.descCustomUrl || null);

  // Sync au changement de contenu
  useEffect(() => {
    setDestType('calendly');
    setSelectedLmId('');
    setCustomUrl('');
    setError(null);
  }, [post.id]);

  // Pré-sélectionner le LM associé quand on passe sur l'onglet leadmagnet — lmLmId
  // (content_links.lm_id, le LM du DM) est la source de vérité stable, prioritaire sur
  // descLmLmId (lien Description) et sur le mot-clé (casse si le LM est renommé après coup).
  useEffect(() => {
    if (destType === 'leadmagnet' && !selectedLmId) {
      const linked = (post.lmLmId ? leadMagnets.find(lm => lm.id === post.lmLmId) : undefined)
        ?? (post.descLmLmId ? leadMagnets.find(lm => lm.id === post.descLmLmId) : undefined)
        ?? (post.lmKeyword ? leadMagnets.find(lm => lm.keyword === post.lmKeyword) : undefined);
      if (linked) setSelectedLmId(linked.id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destType, post.id]);

  // Helpers Short.io : crée ou récupère+patch
  const getOrCreateLink = async (path: string, destUrl: string, title: string, utms: Record<string, string>) => {
    const postRes = await fetch('/api/shortio/links', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ profileId, domainId: domain, originalUrl: destUrl, title, utmSource: utms.source, utmMedium: utms.medium, utmCampaign: utms.campaign, utmContent: utms.content, path }),
    });
    const postData = await postRes.json();
    if (!postRes.ok) throw new Error(postData.error || 'Erreur Short.io');
    let { id: shortId, shortUrl } = postData;
    // 409 fallback : lien existant récupéré → on force la bonne destination
    if (postData.existed && shortId) {
      const patchRes = await fetch('/api/shortio/links', {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ profileId, shortId, originalUrl: destUrl, title, utmSource: utms.source, utmMedium: utms.medium, utmCampaign: utms.campaign, utmContent: utms.content }),
      });
      const patchData = await patchRes.json();
      if (patchRes.ok) shortUrl = patchData.shortUrl;
    }
    return { shortId, shortUrl };
  };

  const updateLink = async (shortId: string, destUrl: string, title: string, utms: Record<string, string>) => {
    const patchRes = await fetch('/api/shortio/links', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ profileId, shortId, originalUrl: destUrl, title, utmSource: utms.source, utmMedium: utms.medium, utmCampaign: utms.campaign, utmContent: utms.content }),
    });
    const patchData = await patchRes.json();
    if (!patchRes.ok) throw new Error(patchData.error || 'Erreur Short.io');
    return patchData.shortUrl as string;
  };

  const generate = async (forceLmId?: string) => {
    setError(null);
    if (!canGenerate) { setError('Short.io non connecté — configure ta clé dans Réglages.'); return; }

    const utms = { source: post.platform === 'YT' ? 'yt' : 'ig', medium: 'description', campaign: destType, content: post.id };
    const postSlug = slugify(post.caption.slice(0, 20));
    const suffix = post.id.slice(-4);

    if (destType === 'calendly') {
      if (!hasCalendly) { setError('Configure ton lien Calendly dans ⚙ Paramètres.'); return; }
      setLoading(true);
      try {
        const destUrl = calendlyUrl.trim();
        // Path : prendre-rdv-{4chars} — lisible, unique par contenu, une seule génération
        const path = `prendre-rdv-${suffix}`;
        const title = `Prendre RDV`;
        let shortId = post.descCalendlyShortId || '';
        let shortUrl = '';
        // Calendly : on ne regénère jamais si le lien existe déjà
        if (shortId) { setError(null); setLoading(false); return; }
        ({ shortId, shortUrl } = await getOrCreateLink(path, destUrl, title, utms));
        await fetch('/api/client/content-links', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ content_id: post.id, platform: post.platform, desc_calendly_short_id: shortId, desc_calendly_short_url: shortUrl, desc_utms: utms }),
        });
        onPostUpdated(post.id, { hasDescLink: true, descCalendlyUrl: shortUrl, descCalendlyShortId: shortId });
      } catch (e: any) { setError(e.message); } finally { setLoading(false); }

    } else if (destType === 'leadmagnet') {
      const lm = leadMagnets.find(l => l.id === (forceLmId || selectedLmId));
      if (!lm) { setError('Sélectionne un lead magnet.'); return; }
      setLoading(true);
      try {
        const destUrl = normalizeUrl(lm.url);
        // Path : {nom-lm-slug}-{suffix} — lisible, identifie le LM
        const lmSlug = slugify(lm.name.slice(0, 20));
        const path = `${lmSlug}-${suffix}`;
        const title = `${lm.name} — ${post.caption.slice(0, 35)}`;
        let shortId = post.descLmShortId || '';
        let shortUrl = '';
        if (shortId) {
          shortUrl = await updateLink(shortId, destUrl, title, utms);
        } else {
          ({ shortId, shortUrl } = await getOrCreateLink(path, destUrl, title, utms));
        }
        await fetch('/api/client/content-links', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ content_id: post.id, platform: post.platform, desc_lm_short_id: shortId, desc_lm_short_url: shortUrl, desc_lm_lm_id: lm.id, desc_utms: utms }),
        });
        onPostUpdated(post.id, { hasDescLink: true, descLmUrl: shortUrl, descLmShortId: shortId, descLmLmId: lm.id });
      } catch (e: any) { setError(e.message); } finally { setLoading(false); }

    } else {
      const url = customUrl.trim();
      if (!isValidUrl(url)) { setError("L'URL de destination est requise."); return; }
      setLoading(true);
      try {
        const destUrl = normalizeUrl(url);
        // Path : lien-{slug-caption}-{suffix}
        const path = `lien-${postSlug}-${suffix}`;
        const title = `Lien — ${post.caption.slice(0, 40)}`;
        let shortId = post.descCustomShortId || '';
        let shortUrl = '';
        if (shortId) {
          shortUrl = await updateLink(shortId, destUrl, title, utms);
        } else {
          ({ shortId, shortUrl } = await getOrCreateLink(path, destUrl, title, utms));
        }
        await fetch('/api/client/content-links', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ content_id: post.id, platform: post.platform, desc_custom_short_id: shortId, desc_custom_short_url: shortUrl, desc_utms: utms }),
        });
        onPostUpdated(post.id, { hasDescLink: true, descCustomUrl: shortUrl, descCustomShortId: shortId });
      } catch (e: any) { setError(e.message); } finally { setLoading(false); }
    }
  };

  const canGenBtn = destType === 'calendly' ? hasCalendly
    : destType === 'leadmagnet' ? !!selectedLmId
    : isValidUrl(customUrl);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div className="eyebrow-sm" style={{ color: MUTED, marginBottom: 8 }}>Destination</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {destOptions.map(opt => (
            <button key={opt.key} onClick={() => { setDestType(opt.key as any); setError(null); }} style={{
              padding: '6px 12px', fontSize: 12, fontWeight: 600, borderRadius: 20, cursor: 'pointer',
              border: `1.5px solid ${destType === opt.key ? BLUE : BORDER}`,
              background: destType === opt.key ? BLUE_SOFT : SURFACE,
              color: destType === opt.key ? BLUE : INK, transition: 'all .12s',
            }}>{opt.label}</button>
          ))}
        </div>
      </div>

      {destType === 'calendly' && (
        hasCalendly
          ? <div style={{ fontSize: 11, color: MUTED, background: SURFACE2, borderRadius: 8, padding: '8px 12px' }}>→ <span style={{ fontWeight: 600, color: INK }}>{calendlyUrl}</span></div>
          : <div style={{ fontSize: 12, color: AMBER, background: AMBER_SOFT, borderRadius: 8, padding: '10px 12px' }}>⚠ Configure ton lien Calendly dans ⚙ Paramètres.</div>
      )}
      {/* Lead magnet : uniquement le LM associé à ce contenu */}
      {destType === 'leadmagnet' && (() => {
        // Trouve le LM associé : lm_id (stable) en priorité, puis desc_lm_lm_id, puis
        // mot-clé en dernier recours — jamais leadMagnets[0] au hasard (pouvait afficher
        // un LM totalement incorrect si aucune des références ci-dessus ne matchait).
        const assocLm = (post.lmLmId ? leadMagnets.find(lm => lm.id === post.lmLmId) : undefined)
          ?? leadMagnets.find(lm => lm.id === post.descLmLmId)
          ?? (post.lmKeyword ? leadMagnets.find(lm => lm.keyword === post.lmKeyword) : undefined);
        if (!assocLm) return (
          <div style={{ fontSize: 12, color: FAINT, background: SURFACE2, borderRadius: 8, padding: '10px 12px' }}>
            Associe d'abord un lead magnet à ce contenu via l'onglet <strong>Lead magnet</strong>.
          </div>
        );
        const lmUrl = post.descLmUrl || null;
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, border: `1.5px solid ${BLUE}`, background: BLUE_SOFT }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: BLUE }}>{assocLm.name}</span>
              {assocLm.keyword && <span style={{ fontSize: 10, fontWeight: 700, color: MUTED, marginLeft: 8 }}>#{assocLm.keyword}</span>}
            </div>
            {lmUrl
              ? <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <span style={{ fontSize: 11, color: BLUE, fontWeight: 600, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lmUrl}</span>
                  <CopyBtn url={lmUrl} />
                </div>
              : <button onClick={() => { setSelectedLmId(assocLm.id); generate(assocLm.id); }} disabled={loading || !canGenerate}
                  style={{ fontSize: 11, fontWeight: 600, padding: '4px 12px', borderRadius: 6, border: 'none', background: BLUE, color: '#fff', cursor: loading || !canGenerate ? 'not-allowed' : 'pointer', opacity: loading || !canGenerate ? 0.4 : 1, whiteSpace: 'nowrap', flexShrink: 0 }}>
                  {loading ? <Spinner /> : 'Générer'}
                </button>
            }
          </div>
        );
      })()}

      {destType === 'custom' && (
        <input value={customUrl} onChange={e => setCustomUrl(e.target.value)} placeholder="https://..."
          style={{ width: '100%', padding: '8px 10px', fontSize: 12, borderRadius: 8, border: `1px solid ${BORDER}`, background: BG, color: INK, outline: 'none', boxSizing: 'border-box' }} />
      )}

      {showDisconnectedWarning && <div style={{ fontSize: 12, color: AMBER, background: AMBER_SOFT, borderRadius: 6, padding: '8px 10px' }}>⚠ Short.io non connecté — configure ta clé dans Réglages.</div>}
      {error && <div style={{ fontSize: 12, color: RED, background: 'var(--red-soft)', borderRadius: 6, padding: '8px 10px' }}>{error}</div>}

      {/* Lien Calendly — affiché + vérification post */}
      {destType === 'calendly' && currentUrl && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {post.permalink && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: SURFACE2, borderRadius: 8, padding: '8px 12px' }}>
              <span style={{ fontSize: 11, color: MUTED, flex: 1 }}>Vérifie que le lien est dans la description.</span>
              <a href={post.permalink} target="_blank" rel="noreferrer" style={{ fontSize: 11, fontWeight: 600, color: BLUE, textDecoration: 'none', whiteSpace: 'nowrap', padding: '4px 10px', border: `1px solid ${BLUE}`, borderRadius: 6 }}>Voir ↗</a>
            </div>
          )}
          <GeneratedUrlRow url={currentUrl} label="Lien description" />
        </div>
      )}

      {/* Lien custom — affiché si généré */}
      {destType === 'custom' && currentUrl && (
        <GeneratedUrlRow url={currentUrl} label="Lien description" />
      )}

      {/* Bouton générer — Calendly (une fois) et Custom uniquement */}
      {destType === 'calendly' && !currentUrl && (
        <button onClick={() => generate()} disabled={loading || !canGenerate || !canGenBtn}
          style={{ minHeight: 44, padding: '10px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none', background: BLUE, color: '#fff', cursor: 'pointer', opacity: loading || !canGenerate || !canGenBtn ? 0.4 : 1, transition: 'opacity .15s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          {loading ? <><Spinner /> Génération...</> : 'Générer le lien description'}
        </button>
      )}
      {destType === 'custom' && (
        <button onClick={() => generate()} disabled={loading || !canGenerate || !canGenBtn}
          style={{ minHeight: 44, padding: '10px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none', background: BLUE, color: '#fff', cursor: 'pointer', opacity: loading || !canGenerate || !canGenBtn ? 0.4 : 1, transition: 'opacity .15s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          {loading ? <><Spinner /> Génération...</> : currentUrl ? 'Regénérer le lien' : 'Générer le lien description'}
        </button>
      )}
    </div>
  );
}

// Bulle de message façon Instagram DM — fond gris clair, coins arrondis, tag discret au-dessus
function ChatBubble({ tag, tagLabel, children }: { tag: string; tagLabel: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', maxWidth: '78%' }}>
      <div style={{ fontSize: 9.5, fontWeight: 700, color: FAINT, marginBottom: 3, marginLeft: 4 }}>
        DM {tag} <span style={{ fontWeight: 400, color: FAINT }}>· {tagLabel}</span>
      </div>
      <div style={{
        background: '#efefef', color: '#000', borderRadius: '18px',
        padding: '10px 14px', fontSize: 13, lineHeight: 1.45, width: '100%', boxSizing: 'border-box',
      }}>
        {children}
      </div>
    </div>
  );
}

// DM1 = accroche seule, pas de lien dedans — simple textarea sans token
// ─── Aperçu du fil Instagram ──────────────────────────────────────────────────
//
// Cotes relevées sur la capture réelle fournie par le client (référentiel 390pt).
// Ce sont les couleurs de la MARQUE Instagram, pas celles de Momentum : elles
// restent en dur, les tokens du design system n'ont rien à y faire.
const IG = {
  bulle: '#F0F0F2',      // bulle reçue, gris très légèrement bleuté
  gris: '#8E8E93',       // pseudo, horodatage, « appuyez deux fois »
  violet1: '#C427E8',    // dégradé sortant, extrémité magenta
  violet2: '#7A3FE4',    // dégradé sortant, extrémité violet-bleuté
  appareil: '#5A4BE8',   // rond du bouton appareil photo, barre de saisie
} as const;

/** Avatar avec l'anneau story — dégradé jaune → rose → violet. */
function IgAvatar({ url, taille }: { url: string | null; taille: number }) {
  return (
    <span style={{
      width: taille, height: taille, borderRadius: '50%', flexShrink: 0, boxSizing: 'border-box',
      background: 'conic-gradient(from 200deg,#F9CE34,#EE2A7B,#6228D7,#F9CE34)', padding: 2,
    }}>
      <span style={{
        display: 'block', width: '100%', height: '100%', borderRadius: '50%', overflow: 'hidden',
        background: '#d8cfc4', border: '1.5px solid #fff', boxSizing: 'border-box',
      }}>
        {url && <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
      </span>
    </span>
  );
}

/**
 * Une bulle reçue (message du coach).
 *
 * L'avatar n'apparaît que sur la DERNIÈRE bulle d'un groupe, aligné sur le bas —
 * c'est ce que fait Instagram, et l'oublier trahit immédiatement la maquette.
 */
function IgRecu({ children, avatar, avatarUrl, hint, sc }: {
  children: ReactNode; avatar: boolean; avatarUrl: string | null; hint?: boolean; sc: number;
}) {
  const a = Math.round(34 * sc);
  // flexShrink:0 — sans lui, le conteneur du fil comprime les bulles au lieu de les
  // laisser déborder, et le fil ne défile jamais (mesuré : 515px de contenu écrasés
  // dans 410px, scrollHeight bloqué à la hauteur du conteneur).
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: Math.round(7 * sc), maxWidth: '84%', flexShrink: 0 }}>
      {avatar ? <IgAvatar url={avatarUrl} taille={a} /> : <span style={{ width: a, flexShrink: 0 }} />}
      <div>
        <div style={{
          background: IG.bulle, borderRadius: Math.round(20 * sc),
          padding: `${Math.round(9 * sc)}px ${Math.round(14 * sc)}px`,
          fontSize: +(15 * sc).toFixed(1), lineHeight: 1.34, color: '#000',
        }}>{children}</div>
        {hint && (
          <div style={{ fontSize: +(13 * sc).toFixed(1), color: IG.gris, margin: `${Math.round(4 * sc)}px 0 0 ${Math.round(5 * sc)}px` }}>
            Appuyez deux fois pour ❤️
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Gabarit à bouton : première ligne en gras, puis un rectangle blanc.
 * C'est ce rectangle qui masque l'URL — d'où son rayon plus faible que la bulle,
 * et sa marge intérieure : il ne touche pas les bords.
 */
function IgTemplate({ texte, bouton, avatar, avatarUrl, sc }: {
  texte: string; bouton: string; avatar: boolean; avatarUrl: string | null; sc: number;
}) {
  return (
    <IgRecu avatar={avatar} avatarUrl={avatarUrl} sc={sc}>
      <div style={{ fontWeight: 700, marginBottom: Math.round(7 * sc) }}>{texte}</div>
      <div style={{
        background: '#fff', borderRadius: Math.round(14 * sc),
        padding: `${Math.round(9 * sc)}px ${Math.round(12 * sc)}px`,
        margin: `0 ${Math.round(12 * sc)}px`,
        textAlign: 'center', fontWeight: 700, fontSize: +(15 * sc).toFixed(1),
      }}>{bouton}</div>
    </IgRecu>
  );
}

/**
 * Bulle envoyée par le prospect — dégradé diagonal, pas un aplat.
 *
 * Appuyer sur le bouton envoie LITTÉRALEMENT son libellé : c'est un message
 * sortant, à droite. C'est le point que le handoff souligne le plus, parce qu'il
 * explique pourquoi la séquence fonctionne.
 */
function IgEnvoye({ texte, sc }: { texte: string; sc: number }) {
  return (
    <div style={{
      alignSelf: 'flex-end', maxWidth: '80%', flexShrink: 0,
      background: `linear-gradient(135deg, ${IG.violet1}, ${IG.violet2})`,
      borderRadius: Math.round(20 * sc),
      padding: `${Math.round(9 * sc)}px ${Math.round(14 * sc)}px`,
      fontSize: +(15 * sc).toFixed(1), lineHeight: 1.34, color: '#fff', fontWeight: 600,
    }}>{texte}</div>
  );
}

/**
 * Le fil complet, tel que le prospect le voit.
 *
 * `sc` met tout à l'échelle depuis le référentiel 390pt de la capture : à 1 le
 * rendu est à taille réelle (mobile), en dessous il tient dans la colonne du
 * desktop sans que les proportions bougent.
 */
function IgFil({ seq, pseudo, avatarUrl, nom, sc, sansCadre }: {
  seq: { accroche: string; accrocheBtn: string; lien: string; lienBtn: string; relance: string };
  pseudo: string; avatarUrl: string | null; nom: string; sc: number; sansCadre?: boolean;
}) {
  // On arrive sur le DERNIER message, comme dans une vraie messagerie — et on y
  // revient à chaque modification d'un champ, sinon écrire une longue relance la
  // ferait sortir du champ de vision au moment précis où on veut la relire.
  const filRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = filRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [seq.accroche, seq.accrocheBtn, seq.lien, seq.lienBtn, seq.relance]);

  const cercle = (enfant: ReactNode) => (
    <span style={{
      width: Math.round(30 * sc), height: Math.round(30 * sc), borderRadius: '50%', background: '#fff',
      boxShadow: '0 1px 3px rgba(0,0,0,.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    }}>{enfant}</span>
  );
  const ic = (d: ReactNode) => (
    <svg width={Math.round(15 * sc)} height={Math.round(15 * sc)} viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, background: '#fff', borderRadius: sansCadre ? 0 : undefined }}>
      {/* En-tête : retour, avatar, nom + pseudo, puis combiné · caméra · étiquette */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: Math.round(9 * sc),
        padding: `${Math.round(8 * sc)}px ${Math.round(11 * sc)}px`,
        background: '#fff', borderBottom: '1px solid #f1eee7', flexShrink: 0,
      }}>
        {cercle(<svg width={Math.round(16 * sc)} height={Math.round(16 * sc)} viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>)}
        <IgAvatar url={avatarUrl} taille={Math.round(38 * sc)} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: +(17 * sc).toFixed(1), fontWeight: 700, color: '#000', lineHeight: 1.2 }}>{nom}</div>
          <div style={{ fontSize: +(13 * sc).toFixed(1), color: IG.gris }}>{pseudo}</div>
        </div>
        {cercle(ic(<path d="M15.05 5A5 5 0 0119 8.95M15.05 1A9 9 0 0123 8.94m-1 7.98v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.72 19.79 19.79 0 011 1.1 2 2 0 013 1h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L7.09 8.9a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0121 16.92z"/>))}
        {cercle(ic(<><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></>))}
        {cercle(ic(<><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.3"/></>))}
      </div>

      {/* Le fil DÉFILE — jamais rogné. Dès qu'un texte s'allonge, le contenu
          dépasse et on peut faire défiler, comme dans une vraie messagerie.
          `marginTop:auto` sur le premier enfant plutôt que `justifyContent:flex-end`
          sur le conteneur : flex-end COMPRIME les enfants au lieu de les faire
          déborder (mesuré : 515px de contenu écrasés dans 410px, scrollHeight
          bloqué à 410). La marge automatique pousse le contenu vers le bas quand
          il est court, sans jamais l'empêcher de dépasser quand il est long. */}
      <div ref={filRef} style={{
        flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch',
        display: 'flex', flexDirection: 'column',
        gap: Math.round(5 * sc), padding: `${Math.round(10 * sc)}px ${Math.round(9 * sc)}px`,
      }}>
        {/* Ligne système : Instagram l'insère quand la séquence part d'un commentaire.
            `marginTop:auto` la colle en bas tant que le fil est court. */}
        <div style={{
          marginTop: 'auto', flexShrink: 0,
          alignSelf: 'center', textAlign: 'center', fontSize: +(13 * sc).toFixed(1), lineHeight: 1.4,
          color: IG.gris, padding: `${Math.round(6 * sc)}px ${Math.round(16 * sc)}px`,
        }}>
          {pseudo} vous a envoyé un message concernant votre commentaire sur sa publication.{' '}
          <b style={{ color: '#3a3730' }}>Voir la publication</b>
        </div>

        <IgTemplate texte={seq.accroche} bouton={seq.accrocheBtn} avatar avatarUrl={avatarUrl} sc={sc} />
        <IgEnvoye texte={seq.accrocheBtn} sc={sc} />
        <IgTemplate texte={seq.lien} bouton={seq.lienBtn} avatar avatarUrl={avatarUrl} sc={sc} />

        {/* Horodatage : c'est ici que se lit le délai de 2 minutes */}
        <div style={{ alignSelf: 'center', flexShrink: 0, fontSize: +(12.5 * sc).toFixed(1), color: IG.gris, padding: `${Math.round(5 * sc)}px 0` }}>
          {new Date(Date.now() + 2 * 60_000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
        </div>

        <IgRecu avatar avatarUrl={avatarUrl} hint sc={sc}>{seq.relance}</IgRecu>
      </div>

      {/* Barre de saisie : le rond est le bouton appareil photo, pas un simple dégradé */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: Math.round(9 * sc),
        padding: `${Math.round(9 * sc)}px ${Math.round(11 * sc)}px`,
        background: '#fff', borderTop: '1px solid #f1eee7', flexShrink: 0,
      }}>
        <span style={{
          width: Math.round(32 * sc), height: Math.round(32 * sc), borderRadius: '50%',
          background: IG.appareil, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width={Math.round(17 * sc)} height={Math.round(17 * sc)} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>
          </svg>
        </span>
        <span style={{
          flex: 1, background: IG.bulle, borderRadius: Math.round(19 * sc),
          padding: `${Math.round(8 * sc)}px ${Math.round(13 * sc)}px`,
          fontSize: +(14 * sc).toFixed(1), color: IG.gris,
        }}>Votre message…</span>
        {[
          <><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></>,
          <><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></>,
          <><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></>,
          <><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></>,
        ].map((d, i) => (
          <svg key={i} width={Math.round(20 * sc)} height={Math.round(20 * sc)} viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>{d}</svg>
        ))}
      </div>
    </div>
  );
}

/**
 * Étiquette d'un champ de séquence, avec la mention « modifié » quand il diffère
 * de ce qui est en base. Sans elle, le compteur en pied indiquerait un nombre sans
 * dire lesquels — il faudrait relire tout le formulaire pour retrouver ses ajouts.
 */
function ChampSeqLabel({ libelle, precision, modifie }: { libelle: string; precision?: string; modifie: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4, marginLeft: 4 }}>
      <span style={{
        flex: 1, minWidth: 0,
        font: "600 10px 'IBM Plex Mono', monospace", letterSpacing: '.06em',
        textTransform: 'uppercase', color: MUTED,
      }}>
        {libelle}
        {precision && <span style={{ textTransform: 'none', letterSpacing: 0, color: FAINT, fontWeight: 400 }}> · {precision}</span>}
      </span>
      {modifie && <span style={{ fontSize: 10, fontWeight: 600, color: AMBER, flexShrink: 0 }}>modifié</span>}
    </div>
  );
}

function Dm1Editor({ value, onChange, saved, border, amber, bg, ink }: {
  value: string; onChange: (v: string) => void; saved: boolean;
  blue: string; blueSoft: string; border: string; amber: string; bg: string; ink: string;
}) {
  return (
    <textarea
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder="Ex : 👋 Voici le lien comme promis !"
      rows={3}
      style={{
        width: '100%', padding: '10px 12px', fontSize: 12, lineHeight: 1.8,
        borderRadius: 8, border: `1px solid ${saved ? border : amber}`, background: bg,
        color: ink, outline: 'none', boxShadow: 'none', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit',
        WebkitAppearance: 'none' as any,
      }}
    />
  );
}


// ─── DissociateButton ────────────────────────────────────────────────────────

function DissociateButton({ postId, platform, onPostUpdated, onDissociated }: {
  postId: string; platform: string;
  onPostUpdated: (postId: string, patch: Partial<Post>) => void;
  onDissociated: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  const dissociate = async () => {
    setLoading(true);
    try {
      await fetch('/api/client/content-links', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          content_id: postId, platform,
          lm_id: null, lm_short_url: null, lm_keyword: null,
          dm_opener_message: null, dm_lm_message: null,
        }),
      });
      onPostUpdated(postId, {
        hasLeadMagnet: false, lmKeyword: undefined, lmShortUrl: undefined,
        dmOpenerMessage: undefined, dmLmMessage: undefined,
      });
      onDissociated();
    } catch (e: any) {
      console.error('[dissociate] erreur:', e?.message);
      alert('Erreur lors de la dissociation. Réessaie.');
    } finally { setLoading(false); setConfirm(false); }
  };

  if (confirm) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 11, color: RED }}>Confirmer la dissociation ?</span>
      <button onClick={dissociate} disabled={loading} style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 6, border: 'none', background: RED, color: '#fff', cursor: 'pointer' }}>
        {loading ? '...' : 'Oui, dissocier'}
      </button>
      <button onClick={() => setConfirm(false)} style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 6, border: `1px solid ${BORDER}`, background: 'none', color: INK, cursor: 'pointer' }}>Annuler</button>
    </div>
  );

  return (
    <button onClick={() => setConfirm(true)} style={{ fontSize: 11, fontWeight: 600, color: RED, background: 'none', border: `1.5px solid ${RED}`, borderRadius: 8, cursor: 'pointer', padding: '6px 14px', whiteSpace: 'nowrap' }}>
      🗑 Dissocier le Lead Magnet
    </button>
  );
}

// ─── TabLm ────────────────────────────────────────────────────────────────────

function TabLm({ post, profileId, domain, canGenerate, showDisconnectedWarning, leadMagnets, onLmCreated, onPostUpdated }: {
  post: Post; profileId: string; domain: string; canGenerate: boolean; showDisconnectedWarning: boolean;
  leadMagnets: LeadMagnet[]; onLmCreated: (lm: LeadMagnet) => void;
  onPostUpdated: (postId: string, patch: Partial<Post>) => void;
}) {
  const isYT = post.platform === 'YT';
  const isMobile = useIsMobile();
  const [lmMode, setLmMode] = useState<'existing' | 'new'>('existing');
  const [selectedLmId, setSelectedLmId] = useState('');
  const [newLmName, setNewLmName] = useState('');
  const [newLmUrl, setNewLmUrl] = useState('');
  const [keyword, setKeyword] = useState(post.lmKeyword || '');
  const [dmMessage, setDmMessage] = useState(post.dmOpenerMessage || '');
  const [result, setResult] = useState<string | null>(post.lmShortUrl || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingMsg, setSavingMsg] = useState(false);
  const [msgSaved, setMsgSaved] = useState(false);
  const isExisting = !!post.hasLeadMagnet;

  // Compte Instagram connecté, pour l'en-tête de l'aperçu. Même clé de cache que
  // la page : TanStack sert la valeur déjà chargée, aucune requête de plus.
  // Le coach doit se reconnaître dans l'aperçu — c'est ce qui rend la projection
  // crédible. Repli neutre si aucun compte n'est connecté : la séquence peut se
  // préparer avant la connexion.
  const { data: igCompte } = useQuery({
    queryKey: ['liens-ig', profileId],
    queryFn: () => fetch(`/api/instagram/stats?profileId=${profileId}`).then(r => r.json()),
    enabled: !!profileId,
    staleTime: 5 * 60 * 1000,
  });
  const igNom = igCompte?.name || 'Ton compte';
  const igPseudo = igCompte?.username ? igCompte.username : 'ton_compte';
  const igPhoto: string | null = igCompte?.profilePicture ?? null;

  // ── La séquence DM, en un seul état ─────────────────────────────────────────
  //
  // Vocabulaire à l'écran (celui du handoff), et la colonne correspondante :
  //   accroche      1er message, sans lien             dm_lm_message
  //   accrocheBtn   demande le lien (quick reply)      dm_button_text
  //   lien          porte le lien                      dm_link_message
  //   lienBtn       ouvre le lien, 20 car. max         dm_link_button_text
  //   relance       question d'ouverture, +2 min       dm_opener_message
  //
  // ⚠️ Les noms de colonnes décalent la numérotation : `dm_opener_message` est la
  // RELANCE (l'ancien « DM3 »), pas le DM2. L'ancien code appelait d'ailleurs son
  // state `dm2Text` alors qu'il pilotait la relance — d'où des confusions à chaque
  // évolution. Les colonnes ne sont pas renommées (le webhook Instagram, poll-leads
  // et send-pending-dm3 les lisent), seul l'écran l'est.
  //
  // Les champs du lien sont pré-remplis avec les valeurs par défaut plutôt que
  // laissés vides : un champ vide ne montrerait pas ce qui part réellement. Effacer
  // tout fait réapparaître la même valeur en placeholder gris.
  const [seq, setSeq] = useState({
    accroche: post.dmLmMessage || `👋 Voici le lien comme promis !`,
    accrocheBtn: post.dmButtonText || '🚀 Je veux le lien !',
    lien: post.dmLinkMessage || DM2_DEFAULT_MESSAGE,
    lienBtn: post.dmLinkButtonText || DM2_DEFAULT_BUTTON,
    relance: post.dmOpenerMessage || '',
  });
  // Référence de comparaison : ce qui est actuellement en base. Un champ modifié
  // puis remis à sa valeur d'origine ne compte pas comme une modification.
  const [seqRef, setSeqRef] = useState(seq);
  const [seqSaving, setSeqSaving] = useState(false);
  const [seqError, setSeqError] = useState<string | null>(null);

  const champsModifies = (Object.keys(seq) as (keyof typeof seq)[]).filter(k => seq[k] !== seqRef[k]);
  const nbModifs = champsModifies.length;

  const setChamp = (k: keyof typeof seq, v: string) => setSeq(s => ({ ...s, [k]: v }));

  useEffect(() => {
    setKeyword(post.lmKeyword || '');
    setDmMessage(post.dmOpenerMessage || '');
    setResult(post.lmShortUrl || null);
    // Toute la séquence en une fois : cinq états à réinitialiser séparément
    // finissaient toujours par en laisser un derrière, qui gardait alors la valeur
    // du contenu précédent.
    const depuisPost = {
      accroche: post.dmLmMessage || `👋 Voici le lien comme promis !`,
      accrocheBtn: post.dmButtonText || '🚀 Je veux le lien !',
      lien: post.dmLinkMessage || DM2_DEFAULT_MESSAGE,
      lienBtn: post.dmLinkButtonText || DM2_DEFAULT_BUTTON,
      relance: post.dmOpenerMessage || '',
    };
    setSeq(depuisPost);
    setSeqRef(depuisPost);
    setSeqError(null);
  }, [post.id]);

  if (isYT) return (
    <div style={{ background: SURFACE2, borderRadius: 10, padding: '16px', display: 'flex', gap: 12 }}>
      <span style={{ fontSize: 20, flexShrink: 0 }}>ℹ️</span>
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: INK, marginBottom: 4 }}>Non disponible sur YouTube</div>
        <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.6 }}>
          Les lead magnets par mot-clé nécessitent de pouvoir contacter les viewers en DM automatique, ce qui n'est pas possible sur YouTube.<br /><br />
          Pour tracker ton trafic YouTube, utilise le <strong>Lien description</strong>.
        </div>
      </div>
    </div>
  );

  const saveMessage = async (msg: string) => {
    setSavingMsg(true);
    try {
      await fetch('/api/client/content-links', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content_id: post.id, platform: post.platform, dm_opener_message: msg }),
      });
      onPostUpdated(post.id, { dmOpenerMessage: msg });
      setMsgSaved(true); setTimeout(() => setMsgSaved(false), 2000);
    } catch (e: any) { console.error('[saveMessage]', e?.message); } finally { setSavingMsg(false); }
  };

  const generate = async () => {
    const validationError = validateLmParams({ canGenerate, keyword, lmMode, selectedLmId, newLmUrl });
    if (validationError) { setError(validationError); return; }
    let lmUrl = '', lmName = '', resolvedLmId = selectedLmId;
    if (lmMode === 'existing') {
      const lm = leadMagnets.find(l => l.id === selectedLmId);
      if (!lm) return;
      lmUrl = lm.url; lmName = lm.name;
    } else {
      lmUrl = normalizeUrl(newLmUrl); lmName = newLmName.trim() || keyword;
    }
    setLoading(true); setError(null);
    try {
      // Short.io d'abord — si ça échoue, on ne crée pas de LM orphelin en DB
      // Path : {keyword}-{slug-caption} — lisible, sans "lm-" ni UTMs dans le nom
      const path = `${slugify(keyword)}-${slugify(post.caption.slice(0, 20))}`;
      const lmTitle = `${lmName} — ${post.caption.slice(0, 40)}`;
      const { shortUrl } = await callShortio({ profileId, domainId: domain, originalUrl: lmUrl, title: lmTitle, utmSource: 'ig', utmMedium: 'leadmagnet', utmCampaign: slugify(keyword), utmContent: post.id, path });
      // Short.io OK — on peut créer le LM en DB maintenant
      if (lmMode === 'new') {
        const res = await fetch('/api/client/lead-magnets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: lmName, url: lmUrl, keyword }) });
        const saved = await res.json();
        if (res.ok && saved.lead_magnet) { onLmCreated(saved.lead_magnet); resolvedLmId = saved.lead_magnet.id; }
      }
      // Sauvegarder dans content_links
      await fetch('/api/client/content-links', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content_id: post.id, platform: post.platform, lm_id: resolvedLmId || null, lm_short_url: shortUrl, lm_url: lmUrl || null, lm_keyword: keyword, dm_opener_message: dmMessage || null, dm_lm_message: seq.accroche || null, dm_button_text: seq.accrocheBtn || null }),
      });
      setResult(shortUrl);
      // La relance saisie ici devient la valeur de référence : sinon la barre
      // d'enregistrement annoncerait une modification en attente juste après avoir
      // créé le lien.
      const apresCreation = { ...seq, relance: dmMessage || '' };
      setSeq(apresCreation);
      setSeqRef(apresCreation);
      onPostUpdated(post.id, { hasLeadMagnet: true, lmKeyword: keyword, lmShortUrl: shortUrl, dmOpenerMessage: dmMessage || undefined, dmButtonText: seq.accrocheBtn || undefined });
      setEditing(false);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };

  const lmUrl = result || post.lmShortUrl || '';
  const savedDmMessage = post.dmOpenerMessage || '';
  const [dmEdited, setDmEdited] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const handleDmChange = (v: string) => {
    setDmMessage(v);
    setDmEdited(v !== savedDmMessage);
  };

  const handleEditClick = () => {
    // Pré-sélectionner le LM actuellement associé au post — lmLmId (content_links.lm_id)
    // est la source de vérité stable, pas le mot-clé : si le mot-clé du LM est modifié
    // après coup, le lookup par lmKeyword ne matche plus alors que lm_id reste valide.
    // post.descLmLmId appartient au lien Description (TabDesc), à n'utiliser qu'en tout
    // dernier recours si ni lm_id ni keyword ne donnent de résultat.
    if (!selectedLmId && post.lmLmId) {
      setSelectedLmId(post.lmLmId);
    } else if (!selectedLmId && post.lmKeyword) {
      const linked = leadMagnets.find(lm => lm.keyword === post.lmKeyword);
      if (linked) setSelectedLmId(linked.id);
    } else if (!selectedLmId && post.descLmLmId) {
      setSelectedLmId(post.descLmLmId);
    }
    setEditing(true);
  };
  const handleCancelEdit = () => {
    if (dmEdited) { setConfirmLeave(true); return; }
    setEditing(false);
    setDmMessage(savedDmMessage);
  };
  const handleConfirmLeave = () => { setEditing(false); setDmMessage(savedDmMessage); setDmEdited(false); setConfirmLeave(false); };

  /**
   * Un seul enregistrement pour toute la séquence.
   *
   * Cinq boutons « Sauvegarder » indépendants coexistaient, chacun avec son propre
   * état : on pouvait publier une séquence à moitié enregistrée sans s'en rendre
   * compte. Un bug documenté en atteste — le garde-fou signalait des modifications
   * non enregistrées mais n'en sauvait que trois sur cinq, les deux champs du lien
   * étant perdus sans message d'erreur. Un seul appel supprime la classe de bug.
   *
   * Vide → null sur les champs du lien : le webhook applique alors son défaut,
   * celui-là même que le placeholder affiche.
   */
  const enregistrerSequence = async () => {
    if (!nbModifs || seqSaving) return;
    setSeqSaving(true); setSeqError(null);
    try {
      const res = await fetch('/api/client/content-links', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          content_id: post.id, platform: post.platform,
          dm_lm_message: seq.accroche,
          dm_button_text: seq.accrocheBtn,
          dm_link_message: seq.lien.trim() || null,
          dm_link_button_text: seq.lienBtn.trim() || null,
          dm_opener_message: seq.relance,
        }),
      });
      if (!res.ok) throw new Error('Erreur sauvegarde');
      onPostUpdated(post.id, {
        dmLmMessage: seq.accroche,
        dmButtonText: seq.accrocheBtn,
        dmLinkMessage: seq.lien.trim() || undefined,
        dmLinkButtonText: seq.lienBtn.trim() || undefined,
        dmOpenerMessage: seq.relance,
      });
      setSeqRef(seq);
    } catch (e: any) {
      setSeqError(e.message || 'Erreur');
    } finally {
      setSeqSaving(false);
    }
  };

  // Le garde-fou de navigation reste un filet, pas la règle : avec un bouton
  // unique et la mention des modifications en pied de formulaire, l'oubli devient
  // rare — mais il ne doit pas coûter le texte écrit.
  const unsavedGuard = useUnsavedGuard();
  useEffect(() => {
    unsavedGuard?.setHasUnsaved(nbModifs > 0);
  }, [nbModifs, unsavedGuard]);
  useEffect(() => {
    return () => { unsavedGuard?.setHasUnsaved(false); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post.id]);

  useEffect(() => {
    unsavedGuard?.registerSaveAll(enregistrerSequence);
    return () => { unsavedGuard?.registerSaveAll(null); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq, seqRef, nbModifs]);

  if ((result || isExisting) && !editing) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Statut LM */}
      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'flex-start' : 'center', gap: isMobile ? 6 : 10, background: 'var(--green-soft)', borderRadius: 8, padding: '10px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, width: isMobile ? '100%' : undefined }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="20 6 9 17 4 12"/></svg>
          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--green)' }}>Lead magnet associé</span>
            {(() => { const lmName = (post.lmLmId ? leadMagnets.find(lm => lm.id === post.lmLmId)?.name : null) ?? leadMagnets.find(lm => lm.keyword === (keyword || post.lmKeyword))?.name; return lmName ? <span style={{ fontSize: 12, fontWeight: 700, color: INK, marginLeft: 6 }}>{lmName}</span> : null; })()}
            <span style={{ fontSize: 11, color: MUTED, marginLeft: 6 }}>Mot-clé : <strong style={{ color: INK }}>#{keyword || post.lmKeyword}</strong></span>
          </div>
        </div>
        <div style={{ fontSize: 10, color: MUTED, textAlign: isMobile ? 'left' : 'right', lineHeight: 1.4, flexShrink: 0, maxWidth: isMobile ? '100%' : 200, marginLeft: isMobile ? 24 : undefined }}>
          Actif — DM envoyé automatiquement à chaque commentaire
        </div>
      </div>

      {/* Séquence DM + aperçu, côte à côte en desktop */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
      <div style={{ flex: 1, minWidth: 0, border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', borderBottom: `1px solid ${BORDER}`, background: BG }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: INK }}>Séquence de messages automatique</span>
          <span style={{ fontSize: 11, color: MUTED, marginLeft: 6 }}>envoyés dans cet ordre, sans action de ta part</span>
        </div>

        <div style={{ padding: isMobile ? '14px' : '20px 16px', background: 'var(--surface-2)', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {/* Accroche — 1er message, sans lien */}
          <div>
            <ChampSeqLabel libelle="Accroche" precision="envoyée avec le commentaire" modifie={seq.accroche !== seqRef.accroche} />
            <Dm1Editor
              value={seq.accroche}
              onChange={v => setChamp('accroche', v)}
              saved={seq.accroche === seqRef.accroche}
              blue={BLUE} blueSoft={BLUE_SOFT} border={BORDER} amber={AMBER} bg={BG} ink={INK}
            />
          </div>

          {/* Bouton de l'accroche — rendu comme sur Instagram, sous la bulle */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8, marginBottom: 10 }}>
            <ChampSeqLabel libelle="Bouton de l'accroche" precision="demande le lien · 20 car. max" modifie={seq.accrocheBtn !== seqRef.accrocheBtn} />
            <input
              value={seq.accrocheBtn}
              onChange={e => setChamp('accrocheBtn', e.target.value.slice(0, 20))}
              maxLength={20}
              placeholder="🚀 Je veux le lien !"
              style={{
                padding: '8px 16px', fontSize: 13, fontWeight: 600,
                borderRadius: 18, border: `1.5px solid ${seq.accrocheBtn === seqRef.accrocheBtn ? 'var(--accent-brand-soft)' : AMBER}`,
                background: '#fff', color: BLUE, outline: 'none', textAlign: 'center',
                width: `${Math.max(seq.accrocheBtn.length, 10) + 4}ch`, maxWidth: '100%',
              }}
            />
          </div>

          {/* Message du lien — envoyé après le clic. Le lien lui-même reste dérivé
              du lead magnet (non modifiable), mais le texte et le libellé du bouton
              qui l'entourent sont configurables. */}
          <div style={{ marginTop: 2 }}>
            <ChampSeqLabel libelle="Message du lien" precision="envoyé quand le prospect clique le bouton" modifie={seq.lien !== seqRef.lien} />
            <textarea
              value={seq.lien}
              onChange={e => setChamp('lien', e.target.value)}
              placeholder={DM2_DEFAULT_MESSAGE}
              rows={2}
              style={{ width: '100%', padding: '10px 12px', fontSize: 12, lineHeight: 1.8, borderRadius: 8, border: `1px solid ${seq.lien === seqRef.lien ? BORDER : AMBER}`, background: BG, color: INK, outline: 'none', boxShadow: 'none', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }}
            />
          </div>

          {/* Bouton du lien — celui qui OUVRE le lien (celui de l'accroche le demande) */}
          <div style={{ marginTop: 8 }}>
            <ChampSeqLabel libelle="Bouton du lien" precision="ouvre le lien · 20 car. max" modifie={seq.lienBtn !== seqRef.lienBtn} />
            <div style={{
              border: `1px solid ${seq.lienBtn === seqRef.lienBtn ? BORDER : AMBER}`, borderRadius: 18,
              padding: '7px 14px', background: '#fff', display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={FAINT} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              <input
                value={seq.lienBtn}
                onChange={e => setChamp('lienBtn', e.target.value.slice(0, 20))}
                placeholder={DM2_DEFAULT_BUTTON}
                maxLength={20}
                style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 12.5, fontWeight: 600, color: INK, fontFamily: 'inherit', minWidth: 0 }}
              />
            </div>
            <div style={{ fontSize: 9.5, color: FAINT, marginLeft: 4, marginTop: 3 }}>
              Le lien est caché derrière ce bouton
            </div>
          </div>

          <div style={{ fontSize: 9.5, color: FAINT, marginLeft: 8, marginTop: 6, marginBottom: 4 }}>
            Lien envoyé dans le DM : {lmUrl || '(généré après association du lead magnet)'} — non modifiable
          </div>

          {/* Relance — question d'ouverture, envoyée 2 min après le lien */}
          <div style={{ marginTop: 2 }}>
            <ChampSeqLabel libelle="Relance" precision="2 min après le lien" modifie={seq.relance !== seqRef.relance} />
            <textarea
              value={seq.relance}
              onChange={e => setChamp('relance', e.target.value)}
              placeholder={`Ex : "C'est quoi ton objectif principal en ce moment ?"`}
              rows={3}
              style={{ width: '100%', padding: '10px 12px', fontSize: 12, lineHeight: 1.8, borderRadius: 8, border: `1px solid ${seq.relance === seqRef.relance ? BORDER : AMBER}`, background: BG, color: INK, outline: 'none', boxShadow: 'none', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }}
            />
            <div style={{ fontSize: 9.5, color: FAINT, marginLeft: 4, marginTop: 3, lineHeight: 1.5 }}>
              Le délai de 2 minutes évite que les deux messages arrivent dans la même seconde — la relance paraît écrite après coup, pas automatique.
            </div>
          </div>

          {seqError && <div style={{ fontSize: 11, color: RED, background: 'var(--red-soft)', borderRadius: 6, padding: '5px 10px', marginLeft: 8, marginTop: 8 }}>{seqError}</div>}

          {/* Un seul enregistrement pour toute la séquence, avec le compte des
              modifications en attente — cinq boutons indépendants laissaient
              publier une séquence à moitié enregistrée. */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            marginTop: 10, paddingTop: 10, borderTop: `1px solid ${BORDER}`,
          }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, fontWeight: 600, color: nbModifs ? AMBER : FAINT }}>
              {nbModifs
                ? `${nbModifs} modification${nbModifs > 1 ? 's' : ''} non enregistrée${nbModifs > 1 ? 's' : ''}`
                : 'Séquence à jour'}
            </span>
            <button onClick={enregistrerSequence} disabled={!nbModifs || seqSaving}
              style={{
                padding: isMobile ? '0 18px' : '9px 16px', minHeight: isMobile ? 48 : undefined,
                fontSize: isMobile ? 13 : 12.5, fontWeight: 600, borderRadius: 8, border: 'none',
                background: nbModifs ? BLUE : SURFACE2, color: nbModifs ? '#fff' : MUTED,
                cursor: nbModifs && !seqSaving ? 'pointer' : 'default',
                transition: `all var(--dur-quick) var(--ease-out)`,
              }}>
              {seqSaving ? 'Enregistrement…' : 'Enregistrer la séquence'}
            </button>
          </div>
        </div>
      </div>

      {/* Aperçu — ce que voit le prospect. Masqué en mobile : il y a là-bas une
          bascule Modifier / Aperçu, le fil occupant alors tout l'écran. */}
      {!isMobile && (
        <div style={{ flex: 'none', width: 314, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          <span style={{
            alignSelf: 'flex-start',
            font: "600 10px 'IBM Plex Mono', monospace", letterSpacing: '.07em',
            textTransform: 'uppercase', color: MUTED,
          }}>Ce que voit le prospect</span>
          {/* Cadre de téléphone, comme le hi-fi. Hauteur fixe pour que le fil
              défile à l'intérieur au lieu d'allonger la page. */}
          <div style={{
            width: 314, height: 498, maxHeight: 498, border: '8px solid #2f2c26', borderRadius: 32,
            overflow: 'hidden', background: '#fff', flexShrink: 0,
            display: 'flex', flexDirection: 'column', boxSizing: 'content-box',
          }}>
            <IgFil
              seq={seq} pseudo={igPseudo} avatarUrl={igPhoto} nom={igNom}
              sc={314 / 390}
            />
          </div>
          {!igCompte?.username && (
            <span style={{ fontSize: 10.5, color: FAINT, textAlign: 'center', lineHeight: 1.4 }}>
              Connecte ton compte Instagram pour voir ta photo et ton pseudo ici.
            </span>
          )}
        </div>
      )}
      </div>

      {/* Lien LM */}
      {lmUrl && <GeneratedUrlRow url={lmUrl} label="Lien lead magnet" />}

      {/* Boutons bas */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
        {post.permalink && (
          <a href={post.permalink} target="_blank" rel="noreferrer"
            style={{ fontSize: 12, fontWeight: 600, color: '#c2185b', textDecoration: 'none', whiteSpace: 'nowrap', border: '1.5px solid #c2185b', borderRadius: 8, padding: '6px 14px' }}>
            📸 Voir le post Instagram ↗
          </a>
        )}
        <button onClick={handleEditClick}
          style={{ fontSize: 12, fontWeight: 600, color: INK, background: 'none', border: `1.5px solid ${INK}`, borderRadius: 8, cursor: 'pointer', padding: '6px 14px', whiteSpace: 'nowrap' }}>
          ✏️ Modifier / Régénérer le Lead Magnet
        </button>
        <div style={{ marginLeft: 'auto' }}>
          <DissociateButton postId={post.id} platform={post.platform} onPostUpdated={onPostUpdated} onDissociated={() => {
            setResult(null); setEditing(false); setKeyword(''); setSelectedLmId('');
            // Séquence remise à ses valeurs par défaut, référence comprise : après
            // une dissociation il n'y a plus rien à enregistrer.
            const parDefaut = {
              accroche: `👋 Voici le lien comme promis !`,
              accrocheBtn: '🚀 Je veux le lien !',
              lien: DM2_DEFAULT_MESSAGE,
              lienBtn: DM2_DEFAULT_BUTTON,
              relance: '',
            };
            setSeq(parDefaut); setSeqRef(parDefaut);
          }} />
        </div>
      </div>
    </div>
  );

  // Interface de modification / association — tous les paramètres sur une seule vue
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header édition */}
      {(result || isExisting) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: INK }}>Modifier le lead magnet</div>
          {confirmLeave ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: AMBER }}>Annuler les modifications ?</span>
              <button onClick={handleConfirmLeave} style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 6, border: 'none', background: RED, color: '#fff', cursor: 'pointer' }}>Oui, annuler</button>
              <button onClick={() => setConfirmLeave(false)} style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 6, border: `1px solid ${BORDER}`, background: 'none', color: INK, cursor: 'pointer' }}>Continuer</button>
            </div>
          ) : (
            <button onClick={handleCancelEdit} style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: RED, border: 'none', borderRadius: 6, padding: '5px 12px', cursor: 'pointer' }}>← Annuler</button>
          )}
        </div>
      )}

      {/* Sélection du LM */}
      <div style={{ display: 'flex', background: SURFACE2, borderRadius: 8, padding: 3, gap: 2 }}>
        {[{ key: 'existing', label: 'LM existant' }, { key: 'new', label: 'Nouveau LM' }].map(opt => (
          <button key={opt.key} onClick={() => setLmMode(opt.key as 'existing' | 'new')} style={{
            flex: 1, padding: '7px', fontSize: 12, fontWeight: 600, borderRadius: 6, cursor: 'pointer', border: 'none',
            background: lmMode === opt.key ? SURFACE : 'transparent',
            color: lmMode === opt.key ? INK : MUTED,
            boxShadow: lmMode === opt.key ? '0 1px 3px rgba(0,0,0,.07)' : 'none',
          }}>{opt.label}</button>
        ))}
      </div>

      {lmMode === 'existing' && (
        leadMagnets.length === 0
          ? <div style={{ fontSize: 12, color: FAINT, background: SURFACE2, borderRadius: 8, padding: '12px', textAlign: 'center' }}>
              Aucun lead magnet créé.<br />
              <span style={{ color: BLUE, cursor: 'pointer', textDecoration: 'underline' }} onClick={() => setLmMode('new')}>Créer un nouveau LM</span>
            </div>
          : <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, marginBottom: 2 }}>Choisir un lead magnet</div>
              {leadMagnets.map(lm => (
                <div key={lm.id} onClick={() => { setSelectedLmId(lm.id); if (lm.keyword) setKeyword(lm.keyword); }} style={{
                  padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                  border: `1.5px solid ${selectedLmId === lm.id ? BLUE : BORDER}`,
                  background: selectedLmId === lm.id ? BLUE_SOFT : SURFACE, transition: 'all .12s',
                }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: INK, marginBottom: 2 }}>{lm.name}</div>
                  <div style={{ fontSize: 11, color: FAINT, wordBreak: 'break-all' }}>{lm.url}</div>
                  {lm.keyword && <div style={{ fontSize: 10, fontWeight: 700, color: MUTED, marginTop: 4 }}>Mot-clé : <span style={{ color: BLUE }}>#{lm.keyword}</span></div>}
                </div>
              ))}
            </div>
      )}

      {lmMode === 'new' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, marginBottom: 4 }}>Nom du LM <span style={{ fontWeight: 400, color: FAINT }}>(optionnel)</span></div>
            <input value={newLmName} onChange={e => setNewLmName(e.target.value)} placeholder="Checklist closing, Guide tunnel…"
              style={{ width: '100%', padding: '8px 10px', fontSize: 12, borderRadius: 8, border: `1px solid ${BORDER}`, background: BG, color: INK, outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, marginBottom: 4 }}>URL du lead magnet</div>
            <input value={newLmUrl} onChange={e => setNewLmUrl(e.target.value)} placeholder="notion.so/ton-guide ou https://…"
              style={{ width: '100%', padding: '8px 10px', fontSize: 12, borderRadius: 8, border: `1px solid ${BORDER}`, background: BG, color: INK, outline: 'none', boxSizing: 'border-box' }} />
          </div>
        </div>
      )}

      {/* Mot-clé */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, marginBottom: 4 }}>Mot-clé déclencheur</div>
        <input value={keyword} onChange={e => setKeyword(e.target.value.toUpperCase().replace(/\s+/g, ''))} placeholder="GUIDE, CHECKLIST, TUNNEL…"
          style={{ width: '100%', padding: '8px 10px', fontSize: 12, borderRadius: 8, border: `1px solid ${BORDER}`, background: BG, color: INK, outline: 'none', boxSizing: 'border-box', fontWeight: 600, letterSpacing: '0.04em' }} />
        <div style={{ fontSize: 10, color: FAINT, marginTop: 4 }}>Quand quelqu'un commente ce mot, il reçoit le LM en DM automatiquement.</div>
      </div>

      {/* Séquence DM — maquette conversation Instagram */}
      <div style={{ border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', borderBottom: `1px solid ${BORDER}`, background: BG }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: INK }}>Séquence de messages automatique</span>
          <span style={{ fontSize: 11, color: MUTED, marginLeft: 6 }}>envoyés dans cet ordre, sans action de ta part</span>
        </div>
        <div style={{ padding: isMobile ? '14px' : '20px 16px', background: 'var(--surface-2)', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div>
            <ChampSeqLabel libelle="Accroche" precision="envoyée avec le commentaire" modifie={false} />
            <Dm1Editor
              value={seq.accroche}
              onChange={v => setChamp('accroche', v)}
              saved={true}
              blue={BLUE} blueSoft={BLUE_SOFT} border={BORDER} amber={AMBER} bg={BG} ink={INK}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8, marginBottom: 10 }}>
            <ChampSeqLabel libelle="Bouton de l'accroche" precision="demande le lien · 20 car. max" modifie={false} />
            <input
              value={seq.accrocheBtn}
              onChange={e => setChamp('accrocheBtn', e.target.value.slice(0, 20))}
              maxLength={20}
              placeholder="🚀 Je veux le lien !"
              style={{
                alignSelf: 'flex-start', padding: '8px 16px', fontSize: 13, fontWeight: 600,
                borderRadius: 18, border: `1.5px solid ${BLUE_SOFT}`,
                background: '#fff', color: BLUE, outline: 'none', textAlign: 'center',
                width: `${Math.max(seq.accrocheBtn.length, 10) + 4}ch`, maxWidth: '100%',
              }}
            />
          </div>

          <ChatBubble tag="2" tagLabel="envoyé quand le prospect clique le bouton">
            <div style={{ fontSize: 13, color: MUTED, fontStyle: 'italic' }}>Le lien du lead magnet, généré à l'étape suivante</div>
          </ChatBubble>

          <div style={{ marginTop: 4 }}>
            <div style={{ fontSize: 9.5, fontWeight: 700, color: FAINT, marginBottom: 3, marginLeft: 4 }}>
              DM 3 <span style={{ fontWeight: 400, color: FAINT }}>· envoyé automatiquement 2 min après le DM 2</span>
            </div>
            <textarea
              value={dmMessage}
              onChange={e => handleDmChange(e.target.value)}
              placeholder={`Ex : "Salut ! Tu as bien reçu le guide ? Si tu as des questions je suis là 😊"`}
              rows={3}
              style={{ width: '100%', padding: '10px 12px', fontSize: 12, lineHeight: 1.8, borderRadius: 8, border: `1px solid ${BORDER}`, background: BG, color: INK, outline: 'none', boxShadow: 'none', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }}
            />
          </div>
        </div>
      </div>

      {showDisconnectedWarning && <div style={{ fontSize: 12, color: AMBER, background: AMBER_SOFT, borderRadius: 6, padding: '8px 10px' }}>⚠ Short.io non connecté — configure ta clé dans Réglages.</div>}
      {error && <div style={{ fontSize: 12, color: RED, background: 'var(--red-soft)', borderRadius: 6, padding: '8px 10px' }}>{error}</div>}

      <button onClick={generate} disabled={loading || !canGenerate || !keyword.trim() || (lmMode === 'existing' ? !selectedLmId : !isValidUrl(newLmUrl))}
        style={{ minHeight: 44, padding: '10px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none', background: 'var(--green)', color: '#fff', cursor: 'pointer', opacity: loading || !canGenerate || !keyword.trim() || (lmMode === 'existing' ? !selectedLmId : !isValidUrl(newLmUrl)) ? 0.4 : 1, transition: 'opacity .15s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        {loading ? <><Spinner /> Sauvegarde...</> : editing ? 'Sauvegarder les modifications' : (result || isExisting) ? 'Régénérer le lien LM' : 'Associer le lead magnet'}
      </button>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', background: SURFACE2, borderRadius: 8, padding: 3, gap: 2 }}>
        {[{ key: 'existing', label: 'LM existant' }, { key: 'new', label: 'Nouveau LM' }].map(opt => (
          <button key={opt.key} onClick={() => setLmMode(opt.key as 'existing' | 'new')} style={{
            flex: 1, padding: '7px', fontSize: 12, fontWeight: 600, borderRadius: 6, cursor: 'pointer', border: 'none',
            background: lmMode === opt.key ? SURFACE : 'transparent',
            color: lmMode === opt.key ? INK : MUTED,
            boxShadow: lmMode === opt.key ? '0 1px 3px rgba(0,0,0,.07)' : 'none',
          }}>{opt.label}</button>
        ))}
      </div>

      {lmMode === 'existing' && (
        leadMagnets.length === 0
          ? <div style={{ fontSize: 12, color: FAINT, background: SURFACE2, borderRadius: 8, padding: '12px', textAlign: 'center' }}>
              Aucun lead magnet créé.<br />
              <span style={{ color: BLUE, cursor: 'pointer', textDecoration: 'underline' }} onClick={() => setLmMode('new')}>Créer un nouveau LM</span>
            </div>
          : <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, marginBottom: 2 }}>Choisir un lead magnet</div>
              {leadMagnets.map(lm => (
                <div key={lm.id} onClick={() => { setSelectedLmId(lm.id); if (lm.keyword) setKeyword(lm.keyword); }} style={{
                  padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                  border: `1.5px solid ${selectedLmId === lm.id ? BLUE : BORDER}`,
                  background: selectedLmId === lm.id ? BLUE_SOFT : SURFACE, transition: 'all .12s',
                }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: INK, marginBottom: 2 }}>{lm.name}</div>
                  <div style={{ fontSize: 11, color: FAINT, wordBreak: 'break-all' }}>{lm.url}</div>
                  {lm.keyword && <div style={{ fontSize: 10, fontWeight: 700, color: MUTED, marginTop: 4 }}>Mot-clé par défaut : <span style={{ color: BLUE }}>#{lm.keyword}</span></div>}
                </div>
              ))}
            </div>
      )}

      {lmMode === 'new' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, marginBottom: 4 }}>Nom du LM <span style={{ fontWeight: 400, color: FAINT }}>(optionnel)</span></div>
            <input value={newLmName} onChange={e => setNewLmName(e.target.value)} placeholder="Checklist closing, Guide tunnel…"
              style={{ width: '100%', padding: '8px 10px', fontSize: 12, borderRadius: 8, border: `1px solid ${BORDER}`, background: BG, color: INK, outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, marginBottom: 4 }}>URL du lead magnet</div>
            <input value={newLmUrl} onChange={e => setNewLmUrl(e.target.value)} placeholder="notion.so/ton-guide ou https://…"
              style={{ width: '100%', padding: '8px 10px', fontSize: 12, borderRadius: 8, border: `1px solid ${BORDER}`, background: BG, color: INK, outline: 'none', boxSizing: 'border-box' }} />
          </div>
        </div>
      )}

      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, marginBottom: 4 }}>
          Mot-clé déclencheur <span style={{ fontWeight: 400, color: FAINT }}>(pré-rempli depuis le LM, modifiable)</span>
        </div>
        <input value={keyword} onChange={e => setKeyword(e.target.value.toUpperCase().replace(/\s+/g, ''))} placeholder="GUIDE, CHECKLIST, TUNNEL…"
          style={{ width: '100%', padding: '8px 10px', fontSize: 12, borderRadius: 8, border: `1px solid ${BORDER}`, background: BG, color: INK, outline: 'none', boxSizing: 'border-box', fontWeight: 600, letterSpacing: '0.04em' }} />
        <div style={{ fontSize: 10, color: FAINT, marginTop: 4 }}>Quand quelqu'un commente ce mot sous ce contenu, il reçoit le LM en DM automatiquement.</div>
      </div>

      {showDisconnectedWarning && <div style={{ fontSize: 12, color: AMBER, background: AMBER_SOFT, borderRadius: 6, padding: '8px 10px' }}>⚠ Short.io non connecté — configure ta clé dans Réglages.</div>}
      {error && <div style={{ fontSize: 12, color: RED, background: 'var(--red-soft)', borderRadius: 6, padding: '8px 10px' }}>{error}</div>}

      <button onClick={generate} disabled={loading || !canGenerate || !keyword.trim() || (lmMode === 'existing' ? !selectedLmId : !isValidUrl(newLmUrl))}
        style={{ minHeight: 44, padding: '10px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none', background: 'var(--green)', color: '#fff', cursor: 'pointer', opacity: loading || !canGenerate || !keyword.trim() || (lmMode === 'existing' ? !selectedLmId : !isValidUrl(newLmUrl)) ? 0.4 : 1, transition: 'opacity .15s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        {loading ? <><Spinner /> Génération...</> : 'Associer le lead magnet'}
      </button>
    </div>
  );
}

function PanneauActions({ post, profileId, activeDomain, domainsLoaded, calendlyUrl, leadMagnets, onLmCreated, onPostUpdated }: {
  post: Post; profileId: string; activeDomain: ShortDomain | null; domainsLoaded: boolean;
  calendlyUrl: string; leadMagnets: LeadMagnet[]; onLmCreated: (lm: LeadMagnet) => void;
  onPostUpdated: (postId: string, patch: Partial<Post>) => void;
}) {
  const domain = activeDomain?.hostname || '';
  const canGenerate = domainsLoaded && !!domain;
  // Le bandeau "non connecté" ne doit apparaître qu'une fois le chargement des domaines Short.io
  // terminé — sinon il clignote pendant ~1s à chaque ouverture (canGenerate est faux tant que
  // domainsLoaded ne l'est pas, même si Short.io est bien connecté).
  const showDisconnectedWarning = domainsLoaded && !canGenerate;
  const [activeTab, setActiveTab] = useState<'desc' | 'lm'>('desc');
  const unsavedGuard = useUnsavedGuard();
  const isMobile = useIsMobile();

  useEffect(() => { setActiveTab('desc'); }, [post.id]);

  const tabs = [
    { key: 'desc', label: `Lien description${post.hasDescLink ? ' ✓' : ''}` },
    { key: 'lm', label: `Lead magnet${post.hasLeadMagnet ? ' ✓' : ''}` },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header post */}
      <div style={{ padding: isMobile ? '14px' : '14px 20px', borderBottom: `1px solid ${BORDER}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 38, height: 38, borderRadius: 7, background: SURFACE2, flexShrink: 0, overflow: 'hidden' }}>
            {post.thumbnail
              ? <img src={post.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {post.platform === 'IG'
                    ? <svg width="14" height="14" viewBox="0 0 24 24" fill={MUTED}><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>
                    : <svg width="16" height="12" viewBox="0 0 24 24" fill={MUTED}><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
                  }
                </div>
            }
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: INK, lineHeight: 1.3, marginBottom: 4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{post.caption}</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: post.platform === 'IG' ? '#c2185b' : '#d32f2f', opacity: 0.8 }}>{post.platform}</span>
              {post.hasDescLink && <span style={{ fontSize: 10, color: BLUE, fontWeight: 600, background: BLUE_SOFT, borderRadius: 4, padding: '1px 6px' }}>Lien desc ✓</span>}
              {post.hasLeadMagnet && <span style={{ fontSize: 10, color: 'var(--green)', fontWeight: 600, background: 'var(--green-soft)', borderRadius: 4, padding: '1px 6px' }}>{post.lmKeyword ? `#${post.lmKeyword}` : 'LM ✓'}</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${BORDER}`, background: BG }}>
        {tabs.map(tab => (
          <button key={tab.key} onClick={() => unsavedGuard?.guard(() => setActiveTab(tab.key as 'desc' | 'lm'))} style={{
            flex: 1, minHeight: 44, padding: '0', fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer',
            background: activeTab === tab.key ? SURFACE : 'transparent',
            color: activeTab === tab.key ? INK : MUTED,
            borderBottom: activeTab === tab.key ? `2px solid ${BLUE}` : '2px solid transparent',
            transition: 'all .15s',
          }}>{tab.label}</button>
        ))}
      </div>

      {/* Contenu */}
      <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '14px' : '20px 24px' }}>
        {activeTab === 'desc' && <TabDesc post={post} profileId={profileId} domain={domain} canGenerate={canGenerate} showDisconnectedWarning={showDisconnectedWarning} calendlyUrl={calendlyUrl} leadMagnets={leadMagnets} onPostUpdated={onPostUpdated} />}
        {activeTab === 'lm' && <TabLm post={post} profileId={profileId} domain={domain} canGenerate={canGenerate} showDisconnectedWarning={showDisconnectedWarning} leadMagnets={leadMagnets} onLmCreated={onLmCreated} onPostUpdated={onPostUpdated} />}
      </div>
    </div>
  );
}

// ─── Panneau droit : Story / séquence de stories ─────────────────────────────
// Un seul bloc de formulaire (pas d'onglots comme TabDesc/TabLm) — une story n'a
// que 2 CTA possibles (Lead Magnet ou Calendly), pas de "lien description custom".
// Principe à ne jamais violer : le CTA vit TOUJOURS sur story_sequences, même pour
// une story seule (créée en coulisses comme une "séquence à 1 story" — aucune
// colonne CTA sur ig_stories). Voir plan Stories pour le détail.

function formatDefaultSequenceName(isoDate: string): string {
  const d = new Date(isoDate);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `Séquence du ${dd}/${mm} - ${hh}h${min}`;
}

function PanneauStorySequence({ story, stories, allStories, profileId, leadMagnets, onSequenceSaved, onNavigateStory, onNavigateToSequencesTab }: {
  story?: Post;
  stories?: Post[];
  allStories: Post[];
  profileId: string;
  leadMagnets: LeadMagnet[];
  onSequenceSaved: (affectedPostIds: string[], patch: Partial<Post>) => void;
  onNavigateStory: (post: Post) => void;
  onNavigateToSequencesTab: (sequenceId: string) => void;
}) {
  const isMobile = useIsMobile();
  const isGroup = !story && !!stories?.length;
  const groupStories = stories ?? [];
  const primary = story ?? groupStories[0];
  const isExistingSequence = !isGroup && !!primary?.sequenceId;
  const sequenceMates = !isGroup && primary?.sequenceId
    ? allStories.filter(p => p.sequenceId === primary.sequenceId).sort((a, b) => new Date(a.postedAt || 0).getTime() - new Date(b.postedAt || 0).getTime())
    : [];
  const retentionPct = sequenceMates.length > 1
    ? (() => {
        const first = sequenceMates[0]?.reach;
        const cta = (sequenceMates.find(s => s.id === primary.ctaStoryId) ?? sequenceMates[sequenceMates.length - 1])?.reach;
        return first && cta != null && first > 0 ? Math.round((cta / first) * 1000) / 10 : null;
      })()
    : null;

  const [name, setName] = useState('');
  const [ctaStoryId, setCtaStoryId] = useState('');
  const [activeTab, setActiveTab] = useState<'lm' | 'calendly'>('lm');
  const [addingStories, setAddingStories] = useState(false);
  const [confirmRemoveLast, setConfirmRemoveLast] = useState(false);
  const [blockedRemoveMsg, setBlockedRemoveMsg] = useState<string | null>(null);

  useEffect(() => {
    setActiveTab('lm');
    setAddingStories(false);
    if (isGroup) {
      setName(formatDefaultSequenceName(groupStories[0]?.postedAt || new Date().toISOString()));
      setCtaStoryId(groupStories[groupStories.length - 1]?.id || '');
    } else if (isExistingSequence && primary) {
      setName(primary.sequenceName || '');
      setCtaStoryId(primary.ctaStoryId || primary.id);
    } else if (primary) {
      setName(formatDefaultSequenceName(primary.postedAt || new Date().toISOString()));
      setCtaStoryId(primary.id);
    }
  }, [primary?.id, isGroup]);

  if (!primary) return null;

  const candidateStories = isGroup ? groupStories : [primary];

  // Retrait d'une story de la séquence — bloqué si c'est la story CTA et qu'il en
  // reste d'autres ; confirmation obligatoire si c'est la dernière restante (supprime
  // la séquence entière). Cf. décisions produit du plan.
  const removeStory = async (storyId: string) => {
    const remaining = sequenceMates.filter(s => s.id !== storyId);
    if (remaining.length > 0 && storyId === primary.ctaStoryId) {
      setBlockedRemoveMsg("Déplace d'abord le CTA sur une autre story avant de la retirer.");
      return;
    }
    if (remaining.length === 0 && !confirmRemoveLast) {
      setConfirmRemoveLast(true);
      return;
    }
    const res = await fetch('/api/client/story-sequences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: primary.sequenceId, removeStoryIds: [storyId] }),
    });
    const data = await res.json();
    setConfirmRemoveLast(false);
    if (!res.ok) { setBlockedRemoveMsg(data.error || 'Erreur'); return; }
    if (data.sequenceDeleted) {
      onSequenceSaved([storyId, ...remaining.map(s => s.id)], { sequenceId: null, sequenceName: null, sequenceStoryCount: 0, ctaStoryId: null, lmId: null, lmKeyword: undefined, dm1Message: null, dm2StoryMessage: null, calendlyShortUrl: null, hasLeadMagnet: false });
    } else {
      onSequenceSaved([storyId], { sequenceId: null, sequenceStoryCount: 0 });
    }
  };

  const addStoriesToSequence = async (storyIds: string[]) => {
    const res = await fetch('/api/client/story-sequences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: primary.sequenceId, addStoryIds: storyIds }),
    });
    const data = await res.json();
    if (!res.ok) { setBlockedRemoveMsg(data.error || 'Erreur'); return; }
    onSequenceSaved(storyIds, { sequenceId: primary.sequenceId, sequenceName: primary.sequenceName, sequenceStoryCount: sequenceMates.length + storyIds.length, ctaStoryId: primary.ctaStoryId, lmKeyword: primary.lmKeyword, calendlyShortUrl: primary.calendlyShortUrl, hasLeadMagnet: primary.hasLeadMagnet });
    setAddingStories(false);
  };

  // Stories libres du profil éligibles à l'ajout — exclut celles qui violeraient la
  // contiguïté (prévention plutôt que rejet API après coup, cf. décision produit).
  const freeStoriesForAdd = (() => {
    if (!isExistingSequence || sequenceMates.length === 0) return [] as (Post & { wouldViolateContiguity: boolean })[];
    const free = allStories.filter(s => s.platform === 'STORY' && !s.sequenceId && s.id !== primary.id);
    const postedTimes = sequenceMates.map(s => new Date(s.postedAt || 0).getTime());
    const minPosted = Math.min(...postedTimes);
    const maxPosted = Math.max(...postedTimes);
    return free.map(s => ({
      ...s,
      wouldViolateContiguity: (() => {
        const t = new Date(s.postedAt || 0).getTime();
        return t > minPosted && t < maxPosted;
      })(),
    }));
  })();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: isMobile ? '14px' : '14px 20px', borderBottom: `1px solid ${BORDER}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 38, height: 38, borderRadius: 7, background: SURFACE2, flexShrink: 0, overflow: 'hidden' }}>
            {primary.thumbnail
              ? <img src={primary.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>
                </div>
            }
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: INK }}>
              {isGroup ? `Regrouper ${groupStories.length} stories` : isExistingSequence ? (
                <span onClick={() => onNavigateToSequencesTab(primary.sequenceId!)} style={{ cursor: 'pointer', textDecoration: 'underline', textDecorationColor: FAINT }}>
                  Fait partie de « {primary.sequenceName} »{(primary.sequenceStoryCount ?? 0) > 1 ? ` (${primary.sequenceStoryCount} stories)` : ''}
                </span>
              ) : 'Story'}
            </div>
            {retentionPct != null && (
              <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{retentionPct}% ont vu la séquence jusqu'au bout</div>
            )}
          </div>
        </div>
        {isExistingSequence && (
          <div style={{ display: 'flex', gap: isMobile ? 10 : 6, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            {sequenceMates.map(s => {
              const thumbSize = isMobile ? 40 : 28;
              const closeSize = isMobile ? 20 : 14;
              return (
                <div key={s.id} style={{ position: 'relative' }}>
                  <div onClick={() => onNavigateStory(s)} style={{ width: thumbSize, height: thumbSize, borderRadius: 5, overflow: 'hidden', cursor: 'pointer', border: s.id === primary.id ? `2px solid ${BLUE}` : `1px solid ${BORDER}`, background: SURFACE2, flexShrink: 0 }}>
                    {s.thumbnail && <img src={s.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                  </div>
                  <button onClick={() => removeStory(s.id)} title="Retirer de la séquence" style={{ position: 'absolute', top: -6, right: -6, width: closeSize, height: closeSize, borderRadius: '50%', border: 'none', background: '#d32f2f', color: '#fff', fontSize: isMobile ? 12 : 9, lineHeight: `${closeSize}px`, textAlign: 'center', cursor: 'pointer', padding: 0 }}>×</button>
                </div>
              );
            })}
            <button onClick={() => setAddingStories(v => !v)} style={{ width: isMobile ? 40 : 28, height: isMobile ? 40 : 28, borderRadius: 5, border: `1px dashed ${BORDER}`, background: 'transparent', color: MUTED, fontSize: 14, cursor: 'pointer', flexShrink: 0 }}>+</button>
          </div>
        )}
        {addingStories && (
          <div style={{ marginTop: 10, padding: 10, background: SURFACE2, borderRadius: 8 }}>
            {freeStoriesForAdd.length === 0 ? (
              <div style={{ fontSize: 11, color: MUTED }}>Toutes tes stories récentes sont déjà dans une séquence.</div>
            ) : (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {freeStoriesForAdd.map(s => (
                  <div key={s.id} onClick={() => !s.wouldViolateContiguity && addStoriesToSequence([s.id])} title={s.wouldViolateContiguity ? 'Chevauche une autre séquence' : ''} style={{
                    width: 28, height: 28, borderRadius: 5, overflow: 'hidden', border: `1px solid ${BORDER}`, background: SURFACE2,
                    cursor: s.wouldViolateContiguity ? 'not-allowed' : 'pointer', opacity: s.wouldViolateContiguity ? 0.35 : 1, flexShrink: 0,
                  }}>
                    {s.thumbnail && <img src={s.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {blockedRemoveMsg && (
          <div style={{ marginTop: 10, padding: '8px 10px', background: '#d32f2f18', color: '#d32f2f', borderRadius: 8, fontSize: 11, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span>{blockedRemoveMsg}</span>
            <button onClick={() => setBlockedRemoveMsg(null)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 12 }}>×</button>
          </div>
        )}
        {confirmRemoveLast && (
          <div style={{ marginTop: 10, padding: '10px', background: SURFACE2, borderRadius: 8, fontSize: 11, color: INK, lineHeight: 1.5 }}>
            Retirer cette story supprimera la séquence « {primary.sequenceName} » et son CTA associé. Continuer ?
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button onClick={() => removeStory(sequenceMates[0]?.id)} style={{ padding: '5px 10px', fontSize: 11, fontWeight: 600, borderRadius: 6, border: 'none', background: '#d32f2f', color: '#fff', cursor: 'pointer' }}>Supprimer la séquence</button>
              <button onClick={() => setConfirmRemoveLast(false)} style={{ padding: '5px 10px', fontSize: 11, fontWeight: 600, borderRadius: 6, border: `1px solid ${BORDER}`, background: 'transparent', color: MUTED, cursor: 'pointer' }}>Annuler</button>
            </div>
          </div>
        )}
      </div>

      {/* Nom + story CTA (création uniquement) */}
      {!isExistingSequence && (
        <div style={{ padding: isMobile ? '14px 14px 0' : '16px 24px 0' }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: MUTED, display: 'block', marginBottom: 4 }}>Nom de la séquence</label>
          <input value={name} onChange={e => setName(e.target.value)} style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 8, border: `1px solid ${BORDER}`, background: SURFACE, color: INK, marginBottom: 14, boxSizing: 'border-box' }} />
          {candidateStories.length > 1 && (
            <>
              <label style={{ fontSize: 12, fontWeight: 600, color: MUTED, display: 'block', marginBottom: 4 }}>Story avec le CTA</label>
              <select value={ctaStoryId} onChange={e => setCtaStoryId(e.target.value)} style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 8, border: `1px solid ${BORDER}`, background: SURFACE, color: INK, marginBottom: 14 }}>
                {candidateStories.map((s, i) => <option key={s.id} value={s.id}>Story {i + 1} — {s.caption}</option>)}
              </select>
            </>
          )}
        </div>
      )}

      {/* Onglets internes Lead Magnet / Calendly */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${BORDER}`, margin: isMobile ? '10px 14px 0' : '10px 24px 0' }}>
        {([
          { key: 'calendly' as const, label: `Calendly${primary.calendlyShortUrl ? ' ✓' : ''}` },
          { key: 'lm' as const, label: `Lead Magnet${primary.lmKeyword ? ' ✓' : ''}` },
        ]).map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
            flex: 1, minHeight: 44, padding: '0', fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer',
            background: 'transparent', color: activeTab === tab.key ? INK : MUTED,
            borderBottom: activeTab === tab.key ? `2px solid ${BLUE}` : '2px solid transparent',
          }}>{tab.label}</button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '14px' : '18px 24px' }}>
        {activeTab === 'lm' ? (
          <TabStoryLeadMagnet
            primary={primary} isExistingSequence={isExistingSequence} isGroup={isGroup}
            name={name} ctaStoryId={ctaStoryId} candidateStories={candidateStories}
            profileId={profileId} storyIds={candidateStories.map(s => s.id)} leadMagnets={leadMagnets}
            onSaved={onSequenceSaved}
          />
        ) : (
          <TabStoryCalendly
            primary={primary} isExistingSequence={isExistingSequence}
            onSaved={onSequenceSaved}
          />
        )}
      </div>
    </div>
  );
}

// Onglet Lead Magnet du panneau séquence — formulaire de création si non configuré,
// vue statut (nom LM figé, mot-clé + DM éditables) si déjà configuré. Contrairement
// à TabLm (posts), pas de réédition du LM associé — décision produit confirmée.
function TabStoryLeadMagnet({ primary, isExistingSequence, isGroup, name, ctaStoryId, candidateStories, profileId, storyIds, leadMagnets, onSaved }: {
  primary: Post; isExistingSequence: boolean; isGroup: boolean; name: string; ctaStoryId: string;
  candidateStories: Post[]; profileId: string; storyIds: string[]; leadMagnets: LeadMagnet[];
  onSaved: (affectedPostIds: string[], patch: Partial<Post>) => void;
}) {
  const isConfigured = !!primary.lmKeyword;
  const [lmId, setLmId] = useState(leadMagnets[0]?.id || '');
  const [lmKeyword, setLmKeyword] = useState(primary.lmKeyword || leadMagnets[0]?.keyword || '');
  const [dm1Message, setDm1Message] = useState(primary.dm1Message || '👋 {{username}} voici ton lien : {{lien_lm}}');
  const [dm2StoryMessage, setDm2StoryMessage] = useState(primary.dm2StoryMessage || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const lmName = leadMagnets.find(l => l.id === primary.lmId)?.name;

  const submit = async () => {
    setSaving(true); setError(null);
    try {
      if (isExistingSequence) {
        const res = await fetch('/api/client/story-sequences', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: primary.sequenceId, lmKeyword, dm1Message, dm2StoryMessage }),
        });
        const data = await res.json();
        if (!res.ok) { setError(data.error || 'Erreur'); return; }
        onSaved([primary.id], { lmKeyword, dm1Message, dm2StoryMessage, hasLeadMagnet: true });
        setSaved(true); setTimeout(() => setSaved(false), 2000);
        return;
      }

      const lm = leadMagnets.find(l => l.id === lmId);
      const res = await fetch('/api/client/story-sequences', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId, name, ctaStoryId, storyIds, lmId, lmKeyword, lmUrl: lm?.url, dm1Message, dm2StoryMessage }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Erreur'); return; }
      onSaved(storyIds, { sequenceId: data.id, sequenceName: name, sequenceStoryCount: storyIds.length, ctaStoryId, lmId, lmKeyword, dm1Message, dm2StoryMessage, hasLeadMagnet: true });
    } catch (e: any) {
      setError(e.message || 'Erreur réseau');
    } finally { setSaving(false); }
  };

  return (
    <>
      {!isConfigured && !isExistingSequence && (
        <>
          <label style={{ fontSize: 12, fontWeight: 600, color: MUTED, display: 'block', marginBottom: 4 }}>Lead magnet</label>
          <select value={lmId} onChange={e => {
            const lm = leadMagnets.find(l => l.id === e.target.value);
            setLmId(e.target.value);
            if (lm) setLmKeyword(lm.keyword);
          }} style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 8, border: `1px solid ${BORDER}`, background: SURFACE, color: INK, marginBottom: 14 }}>
            {leadMagnets.map(lm => <option key={lm.id} value={lm.id}>{lm.name}</option>)}
          </select>
        </>
      )}
      {isConfigured && (
        <div style={{ marginBottom: 14, fontSize: 12, color: MUTED }}>
          Lead magnet : <strong style={{ color: INK }}>{lmName || 'inconnu'}</strong> (figé)
        </div>
      )}

      <label style={{ fontSize: 12, fontWeight: 600, color: MUTED, display: 'block', marginBottom: 4 }}>Mot-clé (reply à la story)</label>
      <input value={lmKeyword} onChange={e => setLmKeyword(e.target.value)} style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 8, border: `1px solid ${BORDER}`, background: SURFACE, color: INK, marginBottom: 14, boxSizing: 'border-box' }} />

      <label style={{ fontSize: 12, fontWeight: 600, color: MUTED, display: 'block', marginBottom: 4 }}>DM 1 — lien + message ({'{{username}}'}, {'{{lien_lm}}'})</label>
      <textarea value={dm1Message} onChange={e => setDm1Message(e.target.value)} rows={2} style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 8, border: `1px solid ${BORDER}`, background: SURFACE, color: INK, marginBottom: 14, boxSizing: 'border-box', resize: 'vertical' }} />

      <label style={{ fontSize: 12, fontWeight: 600, color: MUTED, display: 'block', marginBottom: 4 }}>DM 2 — message libre (envoyé juste après)</label>
      <textarea value={dm2StoryMessage} onChange={e => setDm2StoryMessage(e.target.value)} rows={2} style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 8, border: `1px solid ${BORDER}`, background: SURFACE, color: INK, marginBottom: 14, boxSizing: 'border-box', resize: 'vertical' }} />

      {error && <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 10 }}>{error}</div>}

      <button onClick={submit} disabled={saving || !name || !lmKeyword || (!isExistingSequence && !isGroup && !ctaStoryId)} style={{ width: '100%', padding: '10px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none', background: saved ? 'var(--green)' : BLUE, color: '#fff', cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.7 : 1 }}>
        {saving ? 'Enregistrement...' : saved ? 'Enregistré ✓' : isConfigured ? 'Mettre à jour' : isExistingSequence ? 'Configurer le Lead Magnet' : 'Créer le CTA'}
      </button>
    </>
  );
}

// Onglet Calendly du panneau séquence — bouton de génération si non configuré (peut
// être fait à tout moment, même après coup), lien figé en lecture seule sinon.
function TabStoryCalendly({ primary, isExistingSequence, onSaved }: {
  primary: Post; isExistingSequence: boolean;
  onSaved: (affectedPostIds: string[], patch: Partial<Post>) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/client/story-sequences', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: primary.sequenceId, generateCalendly: true }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Erreur'); return; }
      onSaved([primary.id], { calendlyShortUrl: data.calendlyShortUrl });
    } catch (e: any) {
      setError(e.message || 'Erreur réseau');
    } finally { setLoading(false); }
  };

  if (!isExistingSequence) {
    return (
      <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.5 }}>
        Configure d'abord le Lead Magnet pour créer la séquence, ou crée-la avec un mot-clé temporaire — tu pourras générer ce lien Calendly à tout moment ensuite, y compris après coup.
      </div>
    );
  }

  if (primary.calendlyShortUrl) {
    return (
      <div>
        <label style={{ fontSize: 12, fontWeight: 600, color: MUTED, display: 'block', marginBottom: 4 }}>Lien Calendly (généré, figé)</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input readOnly value={primary.calendlyShortUrl} style={{ flex: 1, padding: '8px 10px', fontSize: 12, borderRadius: 8, border: `1px solid ${BORDER}`, background: SURFACE2, color: INK }} />
          <button onClick={() => navigator.clipboard.writeText(primary.calendlyShortUrl!)} style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600, borderRadius: 8, border: 'none', background: BLUE, color: '#fff', cursor: 'pointer' }}>Copier</button>
        </div>
        <div style={{ fontSize: 11, color: MUTED, marginTop: 10, lineHeight: 1.5 }}>
          Ajoute ce lien via le sticker "Lien" natif Instagram sur ta story CTA.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontSize: 12, color: MUTED, marginBottom: 14, lineHeight: 1.5 }}>
        Un lien Calendly trackable sera généré. Tu devras l'ajouter toi-même via le sticker "Lien" natif d'Instagram sur ta story CTA.
      </div>
      {error && <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 10 }}>{error}</div>}
      <button onClick={generate} disabled={loading} style={{ width: '100%', minHeight: 44, padding: '10px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none', background: BLUE, color: '#fff', cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.7 : 1 }}>
        {loading ? 'Génération...' : 'Générer le lien Calendly'}
      </button>
    </div>
  );
}

// ─── Panneau droit : Calendly prospect ───────────────────────────────────────

function PanneauCalendlyProspect({ profileId, activeDomain, domainsLoaded, calendlyUrl, posts }: {
  profileId: string; activeDomain: ShortDomain | null; domainsLoaded: boolean;
  calendlyUrl: string; posts: Post[];
}) {
  const isMobile = useIsMobile();
  const domain = activeDomain?.hostname || '';
  const canGenerate = domainsLoaded && !!domain;
  const hasCalendly = calendlyUrl.trim().startsWith('http');

  // Pseudo Instagram
  const [username, setUsername] = useState('');
  const [igUserId, setIgUserId] = useState<string | null>(null);
  const [usernameSearch, setUsernameSearch] = useState('');
  const [showLeads, setShowLeads] = useState(false);
  const [leads, setLeads] = useState<{ ig_username: string; ig_user_id: string | null; detected_at: string; keyword_matched: string; media_id: string | null; avatar_url?: string | null }[]>([]);
  const [leadsLoading, setLeadsLoading] = useState(false);

  // Contenu source — postMode: 'auto' | 'lead' | 'manual' | 'none'
  const [postMode, setPostMode] = useState<'auto' | 'lead' | 'manual' | 'none'>('auto');
  const [postId, setPostId] = useState('');
  const [postSearch, setPostSearch] = useState('');
  const [showPostPicker, setShowPostPicker] = useState(false);

  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Charge les leads récents au montage
  useEffect(() => {
    setLeadsLoading(true);
    fetch('/api/instagram/leads?page=1')
      .then(r => r.json())
      .then(d => {
        const unique = new Map<string, any>();
        (d.leads || []).forEach((l: any) => {
          if (l.ig_username && !unique.has(l.ig_username)) unique.set(l.ig_username, l);
        });
        setLeads(Array.from(unique.values()));
      })
      .catch(() => {})
      .finally(() => setLeadsLoading(false));
  }, []);

  const filteredLeads = leads.filter(l =>
    !usernameSearch || l.ig_username.toLowerCase().includes(usernameSearch.toLowerCase())
  );

  const selectedPost = posts.find(p => p.id === postId);
  const filteredPosts = posts.filter(p =>
    !postSearch || p.caption.toLowerCase().includes(postSearch.toLowerCase()) || p.platform.toLowerCase().includes(postSearch.toLowerCase())
  );

  const resolvedPostId = postMode === 'auto' ? (posts[0]?.id || undefined)
    : postMode === 'none' ? undefined
    : (postId || undefined); // 'lead' ou 'manual' → postId direct

  const [history, setHistory] = useState<{ id: string; ig_username: string; short_url: string; content_id: string | null; created_at: string }[]>([]);
  const [historyCopied, setHistoryCopied] = useState<string | null>(null);
  const [historySearch, setHistorySearch] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; ig_username: string } | null>(null);
  const [deleteConfirmChecked, setDeleteConfirmChecked] = useState(false);

  // Charge les liens ACTIFS uniquement — activeOnly=1 exclut ceux retirés via le bouton
  // Supprimer. Ces lignes restent en base (suppression non destructive) pour que les
  // stats et le pipeline gardent le parcours du prospect, mais elles n'ont plus à
  // apparaître ici. Voir docs/tracking-prospect.md.
  useEffect(() => {
    fetch('/api/client/prospect-links?activeOnly=1')
      .then(r => r.json())
      .then(d => setHistory(d.links || []))
      .catch(() => {});
  }, []);

  const generate = async () => {
    if (!username.trim() || !hasCalendly || !canGenerate) return;
    setLoading(true); setError(null);
    try {
      const us = slugify(username);
      const { shortUrl } = await callShortio({
        profileId, domainId: domain,
        originalUrl: calendlyUrl.trim(),
        title: `RDV avec @${username}`,
        utmSource: 'ig', utmMedium: 'dm',
        utmCampaign: igUserId ? `lead-${igUserId}` : `prospect-${us}`,
        // Doit toujours être un vrai ID de contenu (post/vidéo), jamais le pseudo — c'est
        // ce que Performance par contenu (PageClientStats.tsx, matchesContent) attend pour
        // rattacher le call à son post d'origine. Le pseudo est déjà disponible ailleurs
        // (utm_term, ig_lead_id → instagram_leads.ig_username) donc rien n'est perdu ici.
        utmContent: resolvedPostId,
        utmTerm: username,
        path: `prendre-rdv-${us}`,
      });
      setResult(shortUrl);
      // Sauvegarde en DB
      const res = await fetch('/api/client/prospect-links', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ig_username: username, short_url: shortUrl, content_id: resolvedPostId || null }),
      });
      const saved = await res.json();
      if (saved.link) setHistory(prev => [saved.link, ...prev]);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };

  return (
    <div style={{ padding: isMobile ? '14px' : '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color: INK, marginBottom: 4 }}>Lien Calendly prospect</div>
        <div style={{ fontSize: 12, color: MUTED }}>Génère un lien unique par prospect à envoyer en DM. Chaque clic est tracké.</div>
      </div>

      {!hasCalendly && (
        <div style={{ fontSize: 12, color: AMBER, background: AMBER_SOFT, borderRadius: 8, padding: '10px 12px' }}>
          ⚠ Configure ton lien Calendly dans Paramètres (⚙ en haut).
        </div>
      )}
      {hasCalendly && (
        <div style={{ fontSize: 11, color: MUTED, background: SURFACE2, borderRadius: 8, padding: '8px 12px' }}>
          → <span style={{ fontWeight: 600, color: INK }}>{calendlyUrl}</span>
        </div>
      )}

      {result ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 12, color: MUTED }}>Envoie ce lien en DM à <strong>@{username}</strong></div>
          <GeneratedUrlRow url={result} label="Lien Calendly" />
          <button onClick={() => { setResult(null); setUsername(''); setIgUserId(null); setUsernameSearch(''); setPostId(''); setPostMode('auto'); }}
            style={{ fontSize: 12, color: MUTED, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0, textDecoration: 'underline' }}>
            Générer pour un autre prospect
          </button>
        </div>
      ) : (
        <>
          {/* Pseudo Instagram */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, marginBottom: 6 }}>Pseudo Instagram du prospect</div>
            <div style={{ position: 'relative' }}>
              <div className="liens-input-wrap" style={{ display: 'flex', alignItems: 'center', gap: 0, border: `1px solid ${BORDER}`, borderRadius: 8, background: BG, overflow: 'hidden', transition: 'border-color .15s, box-shadow .15s' }}>
                <span style={{ padding: '0 8px 0 12px', fontSize: 13, color: FAINT }}>@</span>
                <input
                  value={username}
                  onChange={e => { setUsername(e.target.value.replace(/^@/, '')); setUsernameSearch(e.target.value.replace(/^@/, '')); setShowLeads(true); }}
                  onFocus={() => setShowLeads(true)}
                  onBlur={() => setTimeout(() => setShowLeads(false), 150)}
                  placeholder="thomas.biz"
                  style={{ flex: 1, padding: '9px 12px 9px 0', fontSize: 13, background: 'transparent', border: 'none', outline: 'none', color: INK }}
                />
              </div>
              {/* Dropdown leads récents */}
              {showLeads && (leads.length > 0 || leadsLoading) && (
                <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,.08)', zIndex: 50, maxHeight: 200, overflowY: 'auto' }}>
                  {leadsLoading ? (
                    <div style={{ padding: '10px 12px', fontSize: 12, color: FAINT }}>Chargement...</div>
                  ) : filteredLeads.length === 0 ? (
                    <div style={{ fontSize: 12, color: FAINT, padding: '6px 12px', borderBottom: `1px solid ${BORDER}` }}>Aucun lead existant</div>
                  ) : null}
                  {!leadsLoading && filteredLeads.length === 0 && (
                    <div
                      onMouseDown={() => { setShowLeads(false); setPostMode('none'); setPostId(''); }}
                      style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600, color: 'var(--accent-brand)', cursor: 'pointer', transition: 'background .12s' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--accent-brand-soft)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      + Créer un lead
                    </div>
                  )}
                  {!leadsLoading && filteredLeads.length > 0 && filteredLeads.map(l => (
                    <div key={l.ig_username} onMouseDown={() => { setUsername(l.ig_username); setIgUserId(l.ig_user_id ?? null); setUsernameSearch(''); setShowLeads(false); if (l.media_id) { setPostId(l.media_id); setPostMode('lead'); } }}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', cursor: 'pointer', fontSize: 12, color: INK, borderBottom: `1px solid ${BORDER}` }}
                      onMouseEnter={e => (e.currentTarget.style.background = SURFACE2)}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                      <Avatar initials={getInitials(l.ig_username)} avatarUrl={l.avatar_url} seed={l.ig_user_id || l.ig_username} size={24} />
                      <span style={{ fontWeight: 600, flex: 1 }}>@{l.ig_username}</span>
                      <span style={{ fontSize: 10, color: FAINT, flexShrink: 0 }}>{l.keyword_matched}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Contenu source */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, marginBottom: 6 }}>Contenu source</div>
            <div style={{ position: 'relative' }}>
              <button type="button" onClick={() => setShowPostPicker(v => !v)}
                style={{ width: '100%', padding: '9px 12px', fontSize: 12, borderRadius: 8, border: `1px solid ${BORDER}`, background: BG, color: INK, cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '90%' }}>
                  {(postMode === 'auto' || postMode === 'lead') ? (
                    <span style={{ color: INK }}>Automatique <span style={{ color: FAINT, fontSize: 11 }}>
                      {selectedPost ? `— ${selectedPost.platform} · ${selectedPost.caption.slice(0, 30)}` : posts[0] ? `— ${posts[0].platform} · ${posts[0].caption.slice(0, 30)}` : ''}
                    </span></span>
                  ) : postMode === 'manual' && selectedPost ? (
                    <span>{selectedPost.platform} · {selectedPost.caption.slice(0, 40)}</span>
                  ) : (
                    <span style={{ color: FAINT }}>— Sans attribution —</span>
                  )}
                </span>
                <span style={{ color: FAINT, fontSize: 10, flexShrink: 0 }}>▾</span>
              </button>

              {showPostPicker && (
                <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,.08)', zIndex: 50 }}>
                  {/* Barre de recherche */}
                  <div style={{ padding: '8px', borderBottom: `1px solid ${BORDER}` }}>
                    <input
                      autoFocus
                      value={postSearch}
                      onChange={e => setPostSearch(e.target.value)}
                      placeholder="Rechercher un contenu..."
                      style={{ width: '100%', padding: '6px 10px', fontSize: 12, borderRadius: 6, border: `1px solid ${BORDER}`, background: BG, color: INK, outline: 'none', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                    {/* Option auto */}
                    <div onMouseDown={() => { setPostMode('auto'); setPostId(''); setShowPostPicker(false); setPostSearch(''); }}
                      style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 12, color: INK, borderBottom: `1px solid ${BORDER}`, background: postMode === 'auto' ? BLUE_SOFT : 'transparent', fontWeight: postMode === 'auto' ? 600 : 400 }}
                      onMouseEnter={e => { if (postMode !== 'auto') e.currentTarget.style.background = SURFACE2; }}
                      onMouseLeave={e => { if (postMode !== 'auto') e.currentTarget.style.background = 'transparent'; }}>
                      Automatique <span style={{ color: FAINT, fontWeight: 400 }}>(détecté via le commentaire)</span>
                    </div>
                    {/* Option sans attribution */}
                    <div onMouseDown={() => { setPostMode('none'); setPostId(''); setShowPostPicker(false); setPostSearch(''); }}
                      style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 12, color: MUTED, borderBottom: `1px solid ${BORDER}`, background: postMode === 'none' ? BLUE_SOFT : 'transparent' }}
                      onMouseEnter={e => { if (postMode !== 'none') e.currentTarget.style.background = SURFACE2; }}
                      onMouseLeave={e => { if (postMode !== 'none') e.currentTarget.style.background = 'transparent'; }}>
                      — Sans attribution —
                    </div>
                    {/* Posts filtrés */}
                    {filteredPosts.map(p => (
                      <div key={p.id} onMouseDown={() => { setPostMode('manual'); setPostId(p.id); setShowPostPicker(false); setPostSearch(''); }}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', cursor: 'pointer', fontSize: 12, color: INK, borderBottom: `1px solid ${BORDER}`, background: postMode === 'manual' && postId === p.id ? BLUE_SOFT : 'transparent' }}
                        onMouseEnter={e => { if (!(postMode === 'manual' && postId === p.id)) e.currentTarget.style.background = SURFACE2; }}
                        onMouseLeave={e => { if (!(postMode === 'manual' && postId === p.id)) e.currentTarget.style.background = 'transparent'; }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: p.platform === 'IG' ? '#c2185b' : RED, background: p.platform === 'IG' ? '#fce4ec' : 'var(--red-soft)', borderRadius: 4, padding: '1px 5px', flexShrink: 0 }}>{p.platform}</span>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.caption}</span>
                      </div>
                    ))}
                    {filteredPosts.length === 0 && postSearch && (
                      <div style={{ padding: '10px 12px', fontSize: 12, color: FAINT }}>Aucun résultat</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {error && <div style={{ fontSize: 12, color: RED, background: 'var(--red-soft)', borderRadius: 6, padding: '8px 10px' }}>{error}</div>}
          {(() => {
            const existing = username.trim() ? history.find(h => h.ig_username.toLowerCase() === username.trim().toLowerCase()) : null;
            if (existing) return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 12, color: AMBER, background: AMBER_SOFT, borderRadius: 8, padding: '10px 12px' }}>
                  Un lien existe déjà pour <strong>@{existing.ig_username}</strong> — retrouve-le dans la liste ci-dessous.
                </div>
                <GeneratedUrlRow url={existing.short_url} label="Lien existant" />
              </div>
            );
            return (
              <button onClick={generate} disabled={loading || !canGenerate || !hasCalendly || !username.trim()}
                style={{ minHeight: 44, padding: '10px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none', background: BLUE, color: '#fff', cursor: 'pointer', opacity: loading || !canGenerate || !hasCalendly || !username.trim() ? 0.4 : 1, transition: 'opacity .15s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                {loading ? <><Spinner /> Génération...</> : 'Générer le lien prospect'}
              </button>
            );
          })()}
        </>
      )}

      {/* Historique des liens générés */}
      {history.length > 0 && (
        <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div className="eyebrow-sm" style={{ color: MUTED }}>Liens Calendly générés <span style={{ fontWeight: 400, color: FAINT }}>({history.length})</span></div>
          </div>
          <input
            value={historySearch}
            onChange={e => setHistorySearch(e.target.value)}
            placeholder="Rechercher un prospect..."
            style={{ width: '100%', padding: '7px 10px', fontSize: 12, borderRadius: 7, border: `1px solid ${BORDER}`, background: BG, color: INK, outline: 'none', boxSizing: 'border-box' }}
          />
          {history.filter(h => !historySearch || h.ig_username.toLowerCase().includes(historySearch.toLowerCase())).map(h => {
            const post = posts.find(p => p.id === h.content_id);
            const lead = leads.find(l => l.ig_username.toLowerCase() === h.ig_username.toLowerCase());
            const copied = historyCopied === h.id;
            const isDeleting = deletingId === h.id;
            return (
              <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, background: SURFACE2, border: `1px solid ${BORDER}`, opacity: isDeleting ? 0.4 : 1, transition: 'opacity .15s' }}>
                <Avatar initials={getInitials(h.ig_username)} avatarUrl={lead?.avatar_url} seed={lead?.ig_user_id || h.ig_username} size={28} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 2, minWidth: 0 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: INK, flexShrink: 0 }}>@{h.ig_username}</span>
                    {post && <span style={{ fontSize: 10, color: FAINT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>· {post.platform} · {post.caption.slice(0, 25)}...</span>}
                  </div>
                  <div style={{ fontSize: 10, color: FAINT }}>
                    {new Date(h.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })} à {new Date(h.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                <button
                  onClick={() => { navigator.clipboard.writeText(h.short_url); setHistoryCopied(h.id); setTimeout(() => setHistoryCopied(null), 2000); }}
                  style={{ flexShrink: 0, fontSize: 13, fontWeight: 700, padding: '9px 16px', borderRadius: 7, border: `1.5px solid ${copied ? 'var(--green)' : BORDER}`, background: copied ? 'var(--green-soft)' : BG, color: copied ? 'var(--green)' : MUTED, cursor: 'pointer', transition: 'all .15s' }}>
                  {copied ? '✓ Copié' : 'Copier'}
                </button>
                <button
                  onClick={() => { setDeleteTarget({ id: h.id, ig_username: h.ig_username }); setDeleteConfirmChecked(false); }}
                  title="Supprimer ce lien"
                  style={{ flexShrink: 0, width: 24, height: 24, borderRadius: 6, border: 'none', background: 'none', color: MUTED, cursor: 'pointer', fontSize: 14, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}

      {deleteTarget && (
        <ModalShell onClose={() => setDeleteTarget(null)} width={380}>
          <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: INK, marginBottom: 6 }}>Supprimer ce lien prospect</div>
              <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.5 }}>
                Le lien Calendly généré pour <strong>@{deleteTarget.ig_username}</strong> sera supprimé définitivement. Il ne sera plus trackable.
              </div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: INK }}>
              <input
                type="checkbox"
                checked={deleteConfirmChecked}
                onChange={e => setDeleteConfirmChecked(e.target.checked)}
                style={{ width: 16, height: 16, cursor: 'pointer', accentColor: RED }}
              />
              Je confirme vouloir supprimer ce lien
            </label>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setDeleteTarget(null)}
                style={{ padding: '9px 16px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: `1px solid ${BORDER}`, background: 'none', color: INK, cursor: 'pointer' }}>
                Annuler
              </button>
              <button
                disabled={!deleteConfirmChecked || deletingId === deleteTarget.id}
                onClick={async () => {
                  const target = deleteTarget;
                  if (!target) return;
                  setDeletingId(target.id);
                  try {
                    await fetch(`/api/client/prospect-links?id=${target.id}`, { method: 'DELETE' });
                    setHistory(prev => prev.filter(x => x.id !== target.id));
                    setDeleteTarget(null);
                  } finally { setDeletingId(null); }
                }}
                style={{ padding: '9px 16px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none', background: RED, color: '#fff', cursor: deleteConfirmChecked ? 'pointer' : 'default', opacity: deleteConfirmChecked ? 1 : 0.4, transition: 'opacity .15s' }}>
                {deletingId === deleteTarget.id ? 'Suppression...' : 'Supprimer'}
              </button>
            </div>
          </div>
        </ModalShell>
      )}
    </div>
  );
}

// ─── Panel Lead Magnets ───────────────────────────────────────────────────────

function PanneauLeadMagnets({ leadMagnets, lmLoading, onCreated, onDeleted, onUpdated }: {
  leadMagnets: LeadMagnet[]; lmLoading: boolean;
  onCreated: (lm: LeadMagnet) => void; onDeleted: (id: string) => void;
  onUpdated: (lm: LeadMagnet) => void;
}) {
  const isMobile = useIsMobile();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [keyword, setKeyword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Édition inline
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editUrl, setEditUrl] = useState('');
  const [editKeyword, setEditKeyword] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const startEdit = (lm: LeadMagnet) => {
    setEditingId(lm.id); setEditName(lm.name); setEditUrl(lm.url); setEditKeyword(lm.keyword || ''); setEditError(null);
  };

  const saveEdit = async () => {
    if (!editingId || !isValidUrl(editUrl)) return;
    setEditSaving(true); setEditError(null);
    try {
      const res = await fetch('/api/client/lead-magnets', {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: editingId, name: editName, url: editUrl, keyword: editKeyword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur');
      onUpdated(data.lead_magnet);
      setEditingId(null);
    } catch (e: any) { setEditError(e.message); } finally { setEditSaving(false); }
  };

  // Vérifie si l'URL a changé par rapport au LM original
  const urlChanged = (lm: LeadMagnet) => editingId === lm.id && editUrl.trim() !== lm.url && (lm.bio_ig_url || lm.bio_yt_url);

  const create = async () => {
    if (!isValidUrl(url)) return;
    setSaving(true); setError(null);
    try {
      const res = await fetch('/api/client/lead-magnets', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim() || url, url, keyword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur');
      onCreated(data.lead_magnet);
      setName(''); setUrl(''); setKeyword('');
    } catch (e: any) { setError(e.message); } finally { setSaving(false); }
  };

  const remove = async (id: string) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/client/lead-magnets?id=${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Erreur suppression');
      onDeleted(id);
    } catch (e: any) {
      setError(e.message || 'Erreur lors de la suppression');
    } finally { setDeletingId(null); }
  };

  return (
    <div style={{ padding: isMobile ? '14px' : '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color: INK, marginBottom: 2 }}>Mes lead magnets</div>
        <div style={{ fontSize: 12, color: FAINT }}>Crée et gère ta bibliothèque de LM. Tu peux les réutiliser sur n'importe quel contenu.</div>
      </div>

      {/* Formulaire création */}
      <div style={{ borderRadius: 10, border: `1px solid ${BORDER}`, overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', borderBottom: `1px solid ${BORDER}`, background: BG }}>
          <span className="eyebrow-sm" style={{ color: MUTED }}>Nouveau lead magnet</span>
        </div>
        <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 500, color: MUTED, marginBottom: 4 }}>Nom <span style={{ color: FAINT, fontWeight: 400 }}>(optionnel)</span></div>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Checklist closing, Guide tunnel…"
                style={{ width: '100%', padding: '7px 10px', fontSize: 12, borderRadius: 7, border: `1px solid ${BORDER}`, background: SURFACE, color: INK, outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 500, color: MUTED, marginBottom: 4 }}>Mot-clé <span style={{ color: FAINT, fontWeight: 400 }}>(optionnel)</span></div>
              <input
                value={keyword}
                onChange={e => setKeyword(e.target.value.toUpperCase().replace(/\s+/g, ''))}
                placeholder="GUIDE, CHECKLIST…"
                style={{ width: '100%', padding: '7px 10px', fontSize: 12, fontWeight: 600, letterSpacing: '0.04em', borderRadius: 7, border: `1px solid ${BORDER}`, background: SURFACE, color: INK, outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 500, color: MUTED, marginBottom: 4 }}>URL</div>
            <input value={url} onChange={e => setUrl(e.target.value)} placeholder="notion.so/mon-guide ou https://…"
              style={{ width: '100%', padding: '7px 10px', fontSize: 12, borderRadius: 7, border: `1px solid ${BORDER}`, background: SURFACE, color: INK, outline: 'none', boxSizing: 'border-box' }} />
          </div>
          {error && <div style={{ fontSize: 11, color: RED, background: 'var(--red-soft)', borderRadius: 6, padding: '6px 10px' }}>{error}</div>}
          <button onClick={create} disabled={saving || !isValidUrl(url)}
            style={{ minHeight: 44, padding: '8px', fontSize: 13, fontWeight: 600, borderRadius: 7, border: 'none', background: 'var(--green)', color: '#fff', cursor: !isValidUrl(url) || saving ? 'not-allowed' : 'pointer', opacity: !isValidUrl(url) || saving ? 0.4 : 1, transition: 'opacity .15s' }}>
            {saving ? 'Sauvegarde...' : '+ Ajouter'}
          </button>
        </div>
      </div>

      {/* Liste */}
      <div>
        <div className="eyebrow-lg" style={{ color: MUTED, marginBottom: 10 }}>
          Bibliothèque ({leadMagnets.length})
        </div>
        {lmLoading ? (
          <div style={{ fontSize: 12, color: FAINT }}>Chargement...</div>
        ) : leadMagnets.length === 0 ? (
          <div style={{ fontSize: 12, color: FAINT }}>Aucun lead magnet. Crée ton premier ci-dessus.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {leadMagnets.map(lm => (
              <div key={lm.id} style={{ borderRadius: 10, border: `1px solid ${editingId === lm.id ? BLUE : BORDER}`, background: SURFACE, overflow: 'hidden', transition: 'border-color .15s' }}>
                {editingId === lm.id ? (
                  /* Mode édition */
                  <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <input value={editName} onChange={e => setEditName(e.target.value)} placeholder="Nom"
                      style={{ width: '100%', padding: '7px 10px', fontSize: 12, borderRadius: 7, border: `1px solid ${BORDER}`, background: BG, color: INK, outline: 'none', boxSizing: 'border-box' }} />
                    <input value={editUrl} onChange={e => setEditUrl(e.target.value)} placeholder="URL"
                      style={{ width: '100%', padding: '7px 10px', fontSize: 12, borderRadius: 7, border: `1px solid ${isValidUrl(editUrl) ? BORDER : AMBER}`, background: BG, color: INK, outline: 'none', boxSizing: 'border-box' }} />
                    <input value={editKeyword} onChange={e => setEditKeyword(e.target.value.toUpperCase().replace(/\s+/g, ''))} placeholder="MOT-CLÉ"
                      style={{ width: '100%', padding: '7px 10px', fontSize: 12, fontWeight: 600, letterSpacing: '0.04em', borderRadius: 7, border: `1px solid ${BORDER}`, background: BG, color: INK, outline: 'none', boxSizing: 'border-box' }} />
                    {/* Cas 1 — URL changée sur un LM avec lien bio actif */}
                    {urlChanged(lm) && (
                      <div style={{ fontSize: 11, color: AMBER, background: AMBER_SOFT, borderRadius: 6, padding: '7px 10px' }}>
                        ⚠ Ce LM a un lien bio {lm.bio_ig_url ? 'Instagram' : ''}{lm.bio_ig_url && lm.bio_yt_url ? ' et ' : ''}{lm.bio_yt_url ? 'YouTube' : ''} actif. Après sauvegarde, va dans <strong>Paramètres</strong> pour regénérer le lien bio avec la nouvelle URL.
                      </div>
                    )}
                    {editError && <div style={{ fontSize: 11, color: RED }}>{editError}</div>}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={saveEdit} disabled={editSaving || !isValidUrl(editUrl)}
                        style={{ flex: 1, minHeight: 44, padding: '7px', fontSize: 13, fontWeight: 700, borderRadius: 7, border: 'none', background: BLUE, color: '#fff', cursor: 'pointer', opacity: editSaving || !isValidUrl(editUrl) ? 0.5 : 1 }}>
                        {editSaving ? '...' : 'Sauvegarder'}
                      </button>
                      <button onClick={() => setEditingId(null)}
                        style={{ minHeight: 44, padding: '7px 12px', fontSize: 13, fontWeight: 600, borderRadius: 7, border: `1px solid ${BORDER}`, background: 'none', color: MUTED, cursor: 'pointer' }}>
                        Annuler
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Mode lecture */
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: INK }}>{lm.name}</div>
                        {lm.keyword && (
                          <span style={{ fontSize: 10, fontWeight: 700, color: BLUE, background: BLUE_SOFT, borderRadius: 4, padding: '1px 5px', letterSpacing: '0.04em' }}>#{lm.keyword}</span>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ fontSize: 11, color: FAINT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 240 }}>{lm.url}</div>
                        {(lm.bio_ig_url || lm.bio_yt_url) && (
                          <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                            {lm.bio_ig_url && <span style={{ fontSize: 9, fontWeight: 600, color: MUTED, background: SURFACE2, borderRadius: 3, padding: '1px 5px' }}>Bio IG</span>}
                            {lm.bio_yt_url && <span style={{ fontSize: 9, fontWeight: 600, color: MUTED, background: SURFACE2, borderRadius: 3, padding: '1px 5px' }}>Bio YT</span>}
                          </div>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button onClick={() => startEdit(lm)}
                        style={{ fontSize: 11, fontWeight: 600, color: MUTED, background: 'none', border: `1px solid ${BORDER}`, borderRadius: 6, cursor: 'pointer', padding: '3px 10px', whiteSpace: 'nowrap' }}>
                        Modifier
                      </button>
                      {/* Cas 4 — suppression LM avec bio actif */}
                      {confirmDeleteId === lm.id ? (
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          {(lm.bio_ig_url || lm.bio_yt_url) && (
                            <span style={{ fontSize: 10, color: AMBER, maxWidth: 120, lineHeight: 1.3 }}>Lien bio restera actif</span>
                          )}
                          <button onClick={() => { remove(lm.id); setConfirmDeleteId(null); }}
                            style={{ fontSize: 11, fontWeight: 600, color: '#fff', background: RED, border: 'none', borderRadius: 6, cursor: 'pointer', padding: '3px 8px' }}>Oui</button>
                          <button onClick={() => setConfirmDeleteId(null)}
                            style={{ fontSize: 11, color: MUTED, background: 'none', border: 'none', cursor: 'pointer', padding: '3px 4px' }}>Non</button>
                        </div>
                      ) : (
                        <button onClick={() => (lm.bio_ig_url || lm.bio_yt_url) ? setConfirmDeleteId(lm.id) : remove(lm.id)} disabled={deletingId === lm.id}
                          style={{ fontSize: 11, color: RED, background: 'none', border: 'none', cursor: 'pointer', opacity: deletingId === lm.id ? 0.5 : 1, padding: '2px 4px' }}>
                          {deletingId === lm.id ? '...' : '✕'}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Blocs partagés mobile / desktop ─────────────────────────────────────────
//
// Ces blocs étaient écrits deux fois — une version mobile, une version desktop —
// avec une logique strictement identique et pour seule différence les cotes
// (44px de cible tactile contre des contrôles compacts). Toute évolution devait
// donc être faite deux fois, et l'oubli d'un côté passait inaperçu.
//
// Ils prennent maintenant une prop `compact` : `false` = mobile (cibles ≥ 44px,
// exigence du handoff), `true` = desktop.

/** Filtres de plateforme — les 4 valeurs du modèle : all / IG / YT / STORY. */
function FiltresPlateforme({ value, onChange, compact, contentCount, compteurs, sansSequence, onSansSequence }: {
  value: 'all' | 'IG' | 'YT' | 'STORY';
  onChange: (f: 'all' | 'IG' | 'YT' | 'STORY') => void;
  compact: boolean;
  contentCount?: number;
  compteurs?: { all: number; IG: number; YT: number; STORY: number; sansSequence: number };
  sansSequence?: boolean;
  onSansSequence?: (v: boolean) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: compact ? 'nowrap' : 'wrap' }}>
      {(['all', 'IG', 'YT', 'STORY'] as const).map(f => {
        const active = value === f;
        return (
          <button key={f} onClick={() => onChange(f)} style={{
            display: 'flex', alignItems: 'center', gap: 5, borderRadius: 20, cursor: 'pointer', border: 'none', fontWeight: 600,
            ...(compact
              ? { padding: '4px 11px', fontSize: 11 }
              : { minHeight: 44, padding: '0 14px', fontSize: 13 }),
            background: active ? INK : SURFACE2, color: active ? 'var(--bg)' : MUTED,
            transition: `all var(--dur-instant) var(--ease-out)`,
          }}>
            {/* Les logos de plateforme ne tiennent qu'en desktop : en mobile les
                chips sont déjà à 44px de haut, l'icône ferait déborder la ligne. */}
            {compact && f === 'IG' && <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>}
            {compact && f === 'YT' && <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>}
            {compact && f === 'STORY' && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>}
            {f === 'all' ? 'Tous' : f === 'IG' ? 'Instagram' : f === 'YT' ? 'YouTube' : 'Stories'}
            {compteurs && <span style={{ opacity: 0.55, fontSize: compact ? 10 : 11 }}>{compteurs[f]}</span>}
          </button>
        );
      })}

      {/* « Sans séquence » se combine aux filtres de plateforme au lieu de les
          remplacer : « lesquels de mes Reels ne sont pas configurés ? » est la
          question qui fait ouvrir cette page. D'où le filet de séparation. */}
      {onSansSequence && compteurs && compteurs.sansSequence > 0 && (
        <>
          <span style={{ width: 1, height: compact ? 20 : 26, background: BORDER, margin: '0 3px', flexShrink: 0 }} />
          <button onClick={() => onSansSequence(!sansSequence)} style={{
            display: 'flex', alignItems: 'center', gap: 5, borderRadius: 20, cursor: 'pointer', border: 'none', fontWeight: 600,
            ...(compact
              ? { padding: '4px 11px', fontSize: 11 }
              : { minHeight: 44, padding: '0 14px', fontSize: 13 }),
            background: sansSequence ? 'var(--amber)' : SURFACE2,
            color: sansSequence ? '#fff' : MUTED,
            transition: `all var(--dur-instant) var(--ease-out)`,
          }}>
            Sans séquence
            <span style={{ opacity: 0.55, fontSize: compact ? 10 : 11 }}>{compteurs.sansSequence}</span>
          </button>
        </>
      )}

      {compact && contentCount !== undefined && (
        <span style={{ marginLeft: 'auto', fontSize: 10, color: FAINT }}>
          {contentCount} contenu{contentCount !== 1 ? 's' : ''}
        </span>
      )}
    </div>
  );
}

/** Sous-onglets Stories / Séquences — visibles uniquement sous le filtre Stories. */
function SousOngletsStories({ value, onChange, compact }: {
  value: 'stories' | 'sequences';
  onChange: (t: 'stories' | 'sequences') => void;
  compact: boolean;
}) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {(['stories', 'sequences'] as const).map(t => (
        <button key={t} onClick={() => onChange(t)} style={{
          borderRadius: 20, cursor: 'pointer', border: 'none', fontWeight: 600,
          ...(compact
            ? { padding: '4px 11px', fontSize: 11 }
            : { minHeight: 44, padding: '0 14px', fontSize: 13 }),
          background: value === t ? INK : SURFACE2, color: value === t ? 'var(--bg)' : MUTED,
          transition: `all var(--dur-instant) var(--ease-out)`,
        }}>{t === 'stories' ? 'Stories' : 'Séquences'}</button>
      ))}
    </div>
  );
}

/** Barre d'actions des stories : sélection en cours, ou création / actualisation. */
function ActionsStories({ selectionMode, selectedCount, compact, onStartSelection, onCancelSelection, onContinue, onRefresh }: {
  selectionMode: boolean;
  selectedCount: number;
  compact: boolean;
  onStartSelection: () => void;
  onCancelSelection: () => void;
  onContinue: () => void;
  onRefresh: () => void;
}) {
  const btn = {
    padding: compact ? '4px 10px' : '5px 12px',
    fontSize: compact ? 11 : 12,
    fontWeight: 600, borderRadius: 6, border: `1px solid ${BORDER}`,
    background: 'transparent', color: MUTED, cursor: 'pointer',
  } as const;

  if (selectionMode) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: compact ? 11 : 12, color: MUTED }}>
          {selectedCount} sélectionnée{selectedCount > 1 ? 's' : ''}
        </span>
        <button onClick={onCancelSelection} style={{ ...btn, marginLeft: 'auto' }}>Annuler</button>
        <button onClick={onContinue} disabled={selectedCount < 2} style={{
          padding: compact ? '4px 10px' : '5px 12px', fontSize: compact ? 11 : 12, fontWeight: 700, borderRadius: 6, border: 'none',
          background: selectedCount < 2 ? SURFACE2 : BLUE, color: selectedCount < 2 ? MUTED : '#fff',
          cursor: selectedCount < 2 ? 'default' : 'pointer',
        }}>Continuer</button>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <button onClick={onStartSelection} style={btn}>Créer une séquence stories</button>
      <button onClick={onRefresh} style={btn}>↻ Actualiser</button>
    </div>
  );
}

// Icônes du rail et du menu — l'avion en papier est réservé à « envoyer en DM ».
const IcoRetour = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>;
const IcoMenu = <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>;
const IcoAvion = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>;
const IcoLm = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>;

/**
 * Bouton carré du rail (état ②).
 *
 * Les entrées épinglées — Calendly prospect et Lead magnets — sont des vues de
 * même niveau qu'un contenu, pas des actions : elles vivent donc dans le rail,
 * au-dessus du filet qui les sépare des miniatures.
 */
function RailBouton({ children, title, actif, accent, onClick }: {
  children: ReactNode; title: string; actif?: boolean; accent?: boolean; onClick: () => void;
}) {
  return (
    <button onClick={onClick} title={title} aria-label={title} style={{
      width: 34, height: 34, borderRadius: 9, flexShrink: 0, cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      transition: `all var(--dur-quick) var(--ease-out)`,
      ...(accent
        ? {
            background: actif ? BLUE : BLUE_SOFT,
            border: `1px solid ${actif ? BLUE : '#cfdce4'}`,
            color: actif ? '#fff' : BLUE,
            boxShadow: actif ? `0 0 0 2px ${SURFACE}, 0 0 0 3px ${BLUE}` : undefined,
          }
        : { background: 'transparent', border: '1px solid transparent', color: INK }),
    }}>{children}</button>
  );
}

/**
 * Rail de 56px — l'état ② du parcours, celui par défaut quand on ouvre un
 * contenu : la séquence dispose alors de toute la largeur restante.
 */
function RailContenus({ posts, rightView, onRetour, onDeplier, onProspect, onLmLibrary, onOuvrirPost }: {
  posts: Post[];
  rightView: RightView;
  onRetour: () => void;
  onDeplier: () => void;
  onProspect: () => void;
  onLmLibrary: () => void;
  onOuvrirPost: (post: Post) => void;
}) {
  const idCourant = rightView && (rightView.type === 'post' || rightView.type === 'story') ? rightView.post.id : null;

  return (
    <div style={{
      width: 56, flexShrink: 0, borderRight: `1px solid ${BORDER}`, background: BG,
      padding: '11px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
      boxSizing: 'border-box', overflowY: 'auto',
    }}>
      <RailBouton title="Revenir à tous les contenus" onClick={onRetour}>{IcoRetour}</RailBouton>
      <RailBouton title="Déplier la liste" onClick={onDeplier}>{IcoMenu}</RailBouton>
      <RailBouton title="Lien Calendly prospect" accent actif={rightView?.type === 'prospect'} onClick={onProspect}>{IcoAvion}</RailBouton>
      <RailBouton title="Lead magnets" accent actif={rightView?.type === 'lm-library'} onClick={onLmLibrary}>{IcoLm}</RailBouton>

      <span style={{ width: 26, height: 1, background: BORDER, margin: '2px 0', flexShrink: 0 }} />

      {posts.map(post => {
        const actif = post.id === idCourant;
        return (
          <button key={post.id} onClick={() => onOuvrirPost(post)} title={post.caption} style={{
            padding: 0, border: 'none', background: 'none', cursor: 'pointer', flexShrink: 0,
            borderRadius: 8, outline: actif ? `2px solid ${BLUE}` : 'none', outlineOffset: 1,
          }}>
            {/* Les stories sont en 9/16 : une vignette carrée les déformerait. */}
            <VignetteContenu post={post} size={34} hauteur={post.platform === 'STORY' ? 44 : 34} />
          </button>
        );
      })}
    </div>
  );
}

/**
 * Entonnoir « du contenu au prospect », all-time.
 *
 * Sur une seule ligne, repliable : assez petit pour rester affiché en permanence,
 * donc réellement consulté. Un bandeau plus grand se replie au bout de deux jours
 * et ne sert alors plus à rien.
 *
 * Les taux portent la lecture : vert quand ça passe, rouge quand ça décroche. C'est
 * la réponse à « où ça casse ? », pas un tableau de bord de plus.
 */
function Entonnoir({ data, ouvert, onToggle, compact }: {
  data: { contenus: number; commentaires: number; accroches: number; liensCliques: number;
          tauxAccroches: number | null; tauxClics: number | null; pret: boolean };
  ouvert: boolean;
  onToggle: () => void;
  compact: boolean;
}) {
  // « Prospects » et non « Commentaires » : la source exclut ceux que le coach a
  // marqués « pas un lead » depuis le pipeline. Écrire « Commentaires » ferait
  // croire à un décompte brut, et le chiffre ne collerait pas avec Instagram.
  const etapes = [
    { libelle: 'Contenus', valeur: data.contenus, taux: null as number | null },
    { libelle: 'Prospects', valeur: data.commentaires, taux: null as number | null },
    { libelle: 'Accroches', valeur: data.accroches, taux: data.tauxAccroches },
    { libelle: 'Liens cliqués', valeur: data.liensCliques, taux: data.tauxClics },
  ];

  // Sous 60 %, l'étape décroche — le rouge doit se voir sans lire le chiffre.
  const SEUIL_ALERTE = 60;

  const chevron = (
    <span style={{ alignSelf: 'flex-start', paddingTop: 19, flexShrink: 0, display: 'flex' }}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#c9c3b5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </span>
  );

  return (
    <div style={{
      background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 'var(--r-card)',
      boxShadow: 'var(--shadow-card)', padding: compact ? '11px 15px' : '11px 16px', flexShrink: 0,
    }}>
      {/* Le bandeau entier est cliquable — pas de bouton « déplier / replier » : un
          libellé d'action à côté d'un titre qui fait déjà la même chose est du
          bruit. Le chevron suffit à dire que ça s'ouvre. */}
      <button onClick={onToggle} style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%',
        background: 'none', border: 'none', cursor: 'pointer', padding: 0,
        marginBottom: ouvert ? 8 : 0, textAlign: 'left',
        minHeight: compact ? undefined : 44,
      }}>
        <span style={{
          flex: 1, font: "600 10px 'IBM Plex Mono', monospace", letterSpacing: '.07em',
          textTransform: 'uppercase', color: MUTED,
        }}>Du contenu au prospect</span>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{ flexShrink: 0, transform: ouvert ? 'rotate(180deg)' : 'none', transition: `transform var(--dur-quick) var(--ease-out)` }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {ouvert && (
        !data.pret ? (
          <div style={{ fontSize: 12, color: FAINT, padding: '6px 0' }}>Chargement…</div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
            {etapes.map((e, i) => (
              <Fragment key={e.libelle}>
                {i > 0 && chevron}
                <div style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
                  <div style={{ border: `1px solid ${BORDER}`, borderRadius: 9, background: BG, padding: '7px 6px', boxSizing: 'border-box' }}>
                    <div style={{ fontSize: 10, color: MUTED, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.libelle}</div>
                    <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-.4px', color: INK, marginTop: 1, fontVariantNumeric: 'tabular-nums' }}>{e.valeur}</div>
                  </div>
                  {/* Hauteur réservée même sans taux : sinon les cases ne s'alignent pas. */}
                  <div style={{ height: 19, marginTop: 3, fontSize: 10.5, fontWeight: 700,
                    color: e.taux === null ? 'transparent' : e.taux < SEUIL_ALERTE ? 'var(--red)' : 'var(--green)' }}>
                    {e.taux === null ? '—' : `${e.taux} %`}
                  </div>
                </div>
              </Fragment>
            ))}
          </div>
        )
      )}
    </div>
  );
}

/** Vignette d'un contenu, avec repli sur le logo de la plateforme. */
function VignetteContenu({ post, size, hauteur }: { post: Post; size: number; hauteur?: number }) {
  const icon = post.platform === 'IG'
    ? <svg width="14" height="14" viewBox="0 0 24 24" fill={MUTED}><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>
    : post.platform === 'YT'
    ? <svg width="16" height="12" viewBox="0 0 24 24" fill={MUTED}><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
    : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>;

  const h = hauteur ?? size;
  // Pastille de plateforme posée sur la vignette, comme le hi-fi : le logo en
  // repli n'apparaît que sans miniature, or elles en ont presque toutes une —
  // sans cette pastille, retirer le texte « IG / YT / STORY » de la ligne ferait
  // perdre l'information au lieu de la déplacer.
  const couleurPlateforme = post.platform === 'IG' ? 'var(--ig-color)'
    : post.platform === 'YT' ? 'var(--yt-color)' : STORY_COLOR;
  // Le compteur de stories groupées : sans lui, quatre vignettes identiques
  // dans le rail ne disent pas qu'elles forment une seule séquence.
  const nbStories = post.platform === 'STORY' ? (post.sequenceStoryCount ?? 0) : 0;

  // Pas d'overflow:hidden ici : la pastille de plateforme déborde volontairement du
  // coin bas-droit, comme dans le hi-fi. Le rognage est porté par l'image elle-même.
  return (
    <div style={{ position: 'relative', width: size, height: h, borderRadius: size >= 44 ? 8 : 6, background: SURFACE2, flexShrink: 0 }}>
      {post.thumbnail
        ? <img src={post.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} />
        : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{icon}</div>}
      {nbStories > 1 && (
        <span style={{
          position: 'absolute', top: 2, right: 2, background: 'rgba(0,0,0,.6)', color: '#fff',
          fontSize: 8, fontWeight: 700, borderRadius: 8, padding: '0 4px', lineHeight: 1.5,
        }}>{nbStories}</span>
      )}
      <span
        title={post.platform === 'IG' ? 'Instagram' : post.platform === 'YT' ? 'YouTube' : 'Story'}
        style={{
          position: 'absolute', bottom: -2, right: -2,
          width: 9, height: 9, borderRadius: '50%',
          background: couleurPlateforme, border: '1.5px solid var(--surface)', boxSizing: 'border-box',
        }}
      />
    </div>
  );
}

/** Le petit point gris qui marque l'absence d'un CTA — plus discret qu'un texte. */
function PointAbsence({ title }: { title: string }) {
  return <span style={{ width: 3, height: 3, borderRadius: '50%', background: FAINT, flexShrink: 0, opacity: 0.4 }} title={title} />;
}

/**
 * Méta d'une ligne de contenu : « Reel · 28 juillet · 142 clics ».
 *
 * Chaque morceau n'apparaît que s'il existe. Pas de « 0 clic » ni de tiret de
 * remplacement : afficher zéro sur un contenu qui n'a même pas de lien généré se
 * lit comme un échec, alors qu'il n'y a simplement rien à mesurer.
 *
 * `court` sert au menu déplié de 250px, où seule la plateforme tient.
 */
function metaContenu(post: Post, court = false): string {
  const type = post.platform === 'YT' ? 'YouTube'
    : post.platform === 'STORY' ? 'Story'
    : post.mediaType === 'VIDEO' || post.mediaType === 'REEL' ? 'Reel'
    : post.mediaType === 'CAROUSEL_ALBUM' ? 'Carrousel'
    : 'Post';

  if (court) return post.platform === 'STORY' ? 'Story' : post.platform;

  const morceaux: string[] = [type];

  const date = post.publishedAt || post.postedAt;
  if (date) {
    const d = new Date(date);
    if (!isNaN(d.getTime())) {
      morceaux.push(d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }));
    }
  }

  if (post.clics != null) morceaux.push(`${post.clics} clic${post.clics > 1 ? 's' : ''}`);

  return morceaux.join(' · ');
}

/**
 * Pastille d'état — réservée aux STORIES.
 *
 * Une story périme en 24 h : savoir si elle tourne encore a un sens. Un Reel ou
 * une vidéo YouTube restent en ligne indéfiniment, leur séquence tourne tant
 * qu'un mot-clé est configuré — un badge « Active » n'y dirait rien.
 */
function PastilleEtatStory({ post }: { post: Post }) {
  if (post.platform !== 'STORY') return null;
  const expiree = !!post.expiredAt;
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, borderRadius: 4, padding: '1px 5px',
      display: 'inline-flex', alignItems: 'center', gap: 4,
      color: expiree ? MUTED : 'var(--green)',
      background: expiree ? SURFACE2 : 'var(--green-soft)',
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor' }} />
      {expiree ? 'Expirée' : 'Active'}
    </span>
  );
}

/**
 * Une ligne de la liste de contenus.
 *
 * Le mobile affichait une carte pauvre (plateforme + deux mentions en texte)
 * là où le desktop portait les pastilles de mot-clé, de séquence et les points
 * d'absence de CTA. C'est la version desktop qui est retenue : l'information
 * « cette séquence tourne-t-elle ? » doit se lire sans ouvrir le contenu, et
 * c'est encore plus vrai sur mobile où l'ouverture coûte un écran entier.
 */
function LigneContenu({ post, selected, checked, selectionMode, groupedElsewhere, compact, onClick }: {
  post: Post;
  selected: boolean;
  checked: boolean;
  selectionMode: boolean;
  groupedElsewhere: boolean;
  compact: boolean;
  onClick: () => void;
}) {
  const isStory = post.platform === 'STORY';
  const inert = groupedElsewhere && selectionMode;

  return (
    <div onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 10,
      cursor: inert ? 'default' : 'pointer',
      opacity: inert ? 0.45 : 1,
      transition: `all var(--dur-instant) var(--ease-out)`,
      ...(compact
        ? { padding: '8px 14px', background: selected ? BLUE_SOFT : 'transparent', borderLeft: `3px solid ${selected ? BLUE : 'transparent'}` }
        : { padding: '12px 14px', borderRadius: 10, border: `1px solid ${BORDER}`, background: selected ? BLUE_SOFT : SURFACE }),
    }}>
      {isStory && selectionMode && (
        <div style={{
          width: compact ? 16 : 18, height: compact ? 16 : 18, borderRadius: 4,
          border: `1.5px solid ${checked ? BLUE : BORDER}`, background: checked ? BLUE : 'transparent',
          flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {checked && <svg width={compact ? 10 : 11} height={compact ? 10 : 11} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
        </div>
      )}

      {/* 44px de haut, et 9/16 pour les stories : une vignette carrée déformerait
          un format vertical. Le menu déplié (compact) reste à 34px, sa colonne
          n'ayant que 250px. */}
      <VignetteContenu
        post={post}
        size={compact ? 34 : 44}
        hauteur={isStory ? (compact ? 44 : 58) : (compact ? 34 : 44)}
      />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: compact ? 12 : 13, fontWeight: 600,
          color: selected ? BLUE : INK, lineHeight: 1.3,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{post.caption}</div>

        {/* Méta complète en pleine largeur, sigle seul dans le menu déplié où la
            place manque. La plateforme se lit aussi sur la pastille de vignette. */}
        <div style={{ fontSize: 11, color: MUTED, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {metaContenu(post, compact)}
        </div>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 5 }}>
          {isStory && (post.sequenceStoryCount ?? 0) > 1 && (
            <span style={{ fontSize: 10, fontWeight: 600, color: STORY_COLOR, background: STORY_SOFT, borderRadius: 4, padding: '1px 5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>📎 {post.sequenceName}</span>
          )}

          {/* Mot-clé : ce qui déclenche la séquence. C'est l'information qu'on ne
              peut pas deviner en regardant le contenu. */}
          {post.lmKeyword
            ? <span style={{ fontSize: 10, fontWeight: 600, color: MUTED, background: SURFACE2, borderRadius: 4, padding: '1px 5px' }}>{post.lmKeyword.toUpperCase()}</span>
            : <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--amber)', background: 'var(--amber-soft)', borderRadius: 4, padding: '1px 5px' }}>Pas de séquence</span>}

          {/* L'état ne concerne que les stories, qui périment en 24 h. */}
          <PastilleEtatStory post={post} />

          {post.calendlyShortUrl && (
            <span style={{ fontSize: 10, fontWeight: 600, color: MUTED, background: SURFACE2, borderRadius: 4, padding: '1px 5px' }}>Calendly</span>
          )}
        </div>
      </div>

      {!(isStory && selectionMode) && (
        <svg width={compact ? 14 : 17} height={compact ? 14 : 17} viewBox="0 0 24 24" fill="none" stroke="#c9c3b5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="9 18 15 12 9 6"/></svg>
      )}
    </div>
  );
}

// ─── Validation LM avant génération ──────────────────────────────────────────

function validateLmParams(params: {
  canGenerate: boolean; keyword: string; lmMode: 'existing' | 'new';
  selectedLmId: string; newLmUrl: string; calendlyUrl?: string; destType?: string;
}): string | null {
  if (!params.canGenerate) return 'Short.io non connecté — va dans Réglages pour connecter ton compte.';
  if (params.keyword.trim().length === 0) return 'Le mot-clé déclencheur est requis.';
  if (params.lmMode === 'existing' && !params.selectedLmId) return 'Sélectionne un lead magnet dans la liste.';
  if (params.lmMode === 'new' && !isValidUrl(params.newLmUrl)) return 'L\'URL du lead magnet est requise (ex: notion.so/mon-guide).';
  return null;
}

function validateDescParams(params: {
  canGenerate: boolean; destType: string; calendlyUrl: string; customUrl: string;
}): string | null {
  if (!params.canGenerate) return 'Short.io non connecté — va dans Réglages pour connecter ton compte.';
  if (params.destType === 'calendly' && !params.calendlyUrl.trim().startsWith('http'))
    return 'Lien Calendly non configuré — clique sur ⚙ Paramètres pour le sauvegarder.';
  if ((params.destType === 'leadmagnet' || params.destType === 'custom') && !isValidUrl(params.customUrl))
    return 'L\'URL de destination est requise.';
  return null;
}

// ─── Page principale ──────────────────────────────────────────────────────────

type RightView =
  | { type: 'post'; post: Post }
  | { type: 'story'; post: Post }
  | { type: 'story-multi'; postIds: string[] }
  | { type: 'prospect' }
  | { type: 'lm-library' }
  | null;

export default function PageLiens() {
  const { user } = useUser();
  const profileId = user?.id || '';
  const queryClient = useQueryClient();
  const router = useRouter();
  const [refreshingPosts, setRefreshingPosts] = useState(false);

  const handleRefreshPosts = async () => {
    if (refreshingPosts) return;
    setRefreshingPosts(true);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/refresh-ig-posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ profile_id: profileId }),
      });
      queryClient.invalidateQueries({ queryKey: ['liens-ig', profileId] });
    } catch (e: any) {
      console.error('[refresh-ig-posts]', e?.message);
    } finally {
      setRefreshingPosts(false);
    }
  };

  const [rightView, setRightView] = useState<RightView>(null);
  const [paramOpen, setParamOpen] = useState(false);
  const [filterPlatform, setFilterPlatform] = useState<'all' | 'IG' | 'YT' | 'STORY'>('all'); // 'all' = pas de filtre
  const [search, setSearch] = useState('');

  // Garde de navigation — bloque un changement de post/onglet si des DMs ne sont pas sauvegardés
  const hasUnsavedRef = useRef(false);
  const saveAllRef = useRef<(() => Promise<void>) | null>(null);
  const [pendingLeaveAction, setPendingLeaveAction] = useState<(() => void) | null>(null);
  const [savingAll, setSavingAll] = useState(false);
  const unsavedGuardApi = useMemo<UnsavedGuardApi>(() => ({
    setHasUnsaved: (v: boolean) => { hasUnsavedRef.current = v; },
    guard: (action: () => void) => {
      if (hasUnsavedRef.current) setPendingLeaveAction(() => action);
      else action();
    },
    registerSaveAll: (fn) => { saveAllRef.current = fn; },
    saveAll: async () => { if (saveAllRef.current) await saveAllRef.current(); },
  }), []);

  // Fermeture d'onglet / rechargement / navigation hors-app : popup native du navigateur
  // (impossible d'afficher un modal custom pour ce cas précis — limitation du navigateur)
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (hasUnsavedRef.current) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  // Navigation interne (menu latéral, autres liens Next.js) : intercepte le clic avant que
  // le routeur ne change de page, pour proposer le même modal de confirmation.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!hasUnsavedRef.current) return;
      const target = (e.target as HTMLElement)?.closest('a[href]') as HTMLAnchorElement | null;
      if (!target) return;
      const href = target.getAttribute('href') || '';
      // Ignore les ancres internes à la page, les liens externes/nouvel onglet et le lien courant
      if (!href || href.startsWith('#') || target.target === '_blank') return;
      if (href === window.location.pathname) return;
      e.preventDefault();
      e.stopPropagation();
      // router.push et non window.location.href : ce dernier rechargeait toute
      // l'application (écran blanc, tout se recharge) et annulait au passage les
      // View Transitions entre pages. La confirmation reste identique pour
      // l'utilisateur, seule la navigation qui suit change.
      setPendingLeaveAction(() => () => { router.push(href); });
    };
    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
  }, [router]);

  // ── Mutations locales (optimistic UI sur les lead magnets) ────────────────
  const [lmOverrides, setLmOverrides] = useState<LeadMagnet[] | null>(null);
  const [calendlyOverride, setCalendlyOverride] = useState<string | null>(null);
  const [postsOverrides, setPostsOverrides] = useState<Map<string, Partial<Post>>>(new Map());

  // ── Queries TanStack ──────────────────────────────────────────────────────
  const { data: domainsData, isLoading: domainsLoading } = useQuery({
    queryKey: ['liens-domains', profileId],
    queryFn: () => fetch(`/api/shortio/domains?profileId=${profileId}`).then(r => r.json()),
    enabled: !!profileId,
    staleTime: 5 * 60 * 1000,
  });

  const { data: settingsData } = useQuery({
    queryKey: ['liens-settings'],
    queryFn: () => fetch('/api/client/settings').then(r => r.json()),
    enabled: !!profileId,
    staleTime: 5 * 60 * 1000,
  });

  const { data: lmData, isLoading: lmQueryLoading } = useQuery({
    queryKey: ['liens-lm'],
    queryFn: () => fetch('/api/client/lead-magnets').then(r => r.json()),
    enabled: !!profileId,
    staleTime: 5 * 60 * 1000,
  });

  const { data: contentLinksData } = useQuery({
    queryKey: ['liens-content-links'],
    queryFn: () => fetch('/api/client/content-links').then(r => r.json()),
    enabled: !!profileId,
    staleTime: 5 * 60 * 1000,
  });

  const { data: igData, isLoading: igLoading } = useQuery({
    queryKey: ['liens-ig', profileId],
    queryFn: () => fetch(`/api/instagram/stats?profileId=${profileId}`).then(r => r.json()),
    enabled: !!profileId,
    staleTime: 5 * 60 * 1000,
  });

  const { data: ytData, isLoading: ytLoading } = useQuery({
    queryKey: ['liens-yt', profileId],
    queryFn: () => fetch(`/api/youtube/stats?profileId=${profileId}`).then(r => r.json()),
    enabled: !!profileId,
    staleTime: 5 * 60 * 1000,
  });

  const { data: shortioData, isLoading: shortioLoading } = useQuery({
    queryKey: ['liens-shortio', profileId],
    queryFn: () => fetch(`/api/shortio/stats?profileId=${profileId}`).then(r => r.json()),
    enabled: !!profileId,
    staleTime: 15 * 60 * 1000,
  });

  // L'entonnoir se sert de la route du pipeline plutôt que d'une route dédiée :
  // elle charge déjà instagram_leads (lead_magnet_sent, hook_replied, tracking_link)
  // et prospect_events, soit exactement les quatre premières étapes. Une route de
  // plus ne dirait rien que celle-ci ne sait déjà.
  const { data: pipelineData } = useQuery({
    queryKey: ['liens-funnel', profileId],
    queryFn: () => fetch('/api/client/pipeline').then(r => r.json()),
    enabled: !!profileId,
    staleTime: 5 * 60 * 1000,
  });

  // refetchOnWindowFocus/refetchOnMount: 'always' — un changement fait depuis un autre
  // appareil (ex: lien Calendly généré sur PC) doit être visible dès qu'on revient sur
  // cette page/onglet mobile, sans attendre l'expiration de staleTime (60s) ni action
  // manuelle. Cf. bug rapporté : "Calendly non généré" alors qu'il l'était sur PC.
  const { data: storiesData, isLoading: storiesLoading } = useQuery({
    queryKey: ['stories', profileId],
    queryFn: () => fetch(`/api/client/stories?profileId=${profileId}`).then(r => r.json()),
    enabled: !!profileId,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
    refetchOnMount: 'always',
  });

  const { data: sequencesData } = useQuery({
    queryKey: ['story-sequences', profileId],
    queryFn: () => fetch(`/api/client/story-sequences?profileId=${profileId}`).then(r => r.json()),
    enabled: !!profileId,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
    refetchOnMount: 'always',
  });

  // ── Dérivations depuis les queries ───────────────────────────────────────
  const domains: ShortDomain[] = domainsData?.domains?.length ? domainsData.domains : [];
  // activeDomain = seule source de vérité pour le domaine utilisé à la création de lien —
  // vient de integrations.metadata (choisi à la connexion ou via le sélecteur), jamais
  // recalculé depuis l'ordre de domains (non garanti par l'API Short.io).
  const activeDomain: ShortDomain | null = domainsData?.activeDomain ?? null;
  // !!profileId est requis en plus de !domainsLoading : tant que profileId n'est pas résolu
  // (juste après un rechargement de page, avant que `user` n'arrive), la query est "enabled:
  // false" donc TanStack la rapporte comme idle (isLoading=false) sans jamais l'avoir vraiment
  // lancée — domainsLoaded passait alors à true avec domains=[] pendant ~1s, déclenchant le
  // bandeau "Short.io non connecté" à tort.
  const domainsLoaded = !!profileId && !domainsLoading;

  const calendlyUrl = calendlyOverride ?? (settingsData?.calendly_url || '');

  const leadMagnetsFromQuery: LeadMagnet[] = lmData?.lead_magnets ?? [];
  const leadMagnets: LeadMagnet[] = lmOverrides ?? leadMagnetsFromQuery;
  const lmLoading = lmQueryLoading;

  const contentLinks: ContentLink[] = contentLinksData?.content_links ?? [];

  const postsLoading = igLoading || ytLoading || shortioLoading || storiesLoading;

  const posts: Post[] = useMemo(() => {
    // Un post marqué deleted_at (absent de la dernière réponse Meta /media, voir
    // snapshotIgPosts) reste dans l'historique analytics mais ne doit plus apparaître
    // ici — "Gérer mes liens" ne gère que les posts encore actifs sur Instagram.
    const igPosts: Post[] = (igData?.posts || [])
      .filter((p: any) => !p.deletedAt)
      .map((p: any) => ({
        id: p.id,
        caption: (p.caption || 'Publication Instagram').slice(0, 60),
        platform: 'IG' as const,
        thumbnail: p.thumbnail,
        permalink: p.permalink || null,
        mediaType: p.type ?? null,
        publishedAt: p.timestamp ?? null,
      }));

    const ytPosts: Post[] = (ytData?.videos || []).map((v: any) => ({
      id: v.id,
      caption: (v.title || 'Vidéo YouTube').slice(0, 60),
      platform: 'YT' as const,
      thumbnail: v.thumbnail,
      publishedAt: v.publishedAt ?? v.timestamp ?? null,
    }));

    const shortioLinks = (shortioData?.links || []).map((l: any) => {
      try {
        const u = new URL(l.originalUrl || '');
        return {
          ...l,
          postId: u.searchParams.get('utm_content') || null,
          linkType: u.searchParams.get('utm_medium') || null,
        };
      } catch { return l; }
    });

    // Croise igPosts + ytPosts + shortioLinks (logique enrich() originale)
    const enrichedFromShortio = [...igPosts, ...ytPosts].map(post => {
      const descLink = shortioLinks.find((l: any) => l.postId === post.id && l.linkType === 'post');
      const lmLink = shortioLinks.find((l: any) => l.postId === post.id && l.linkType === 'leadmagnet');
      // Clics cumulés des deux liens du contenu (description + lead magnet) :
      // c'est le trafic que ce contenu a généré, quel que soit le lien cliqué.
      // null plutôt que 0 quand aucun lien n'existe — « 0 clic » sur un contenu
      // sans lien se lirait comme un échec, alors qu'il n'y a rien à mesurer.
      const clicsDesc = descLink?.humanClicks ?? descLink?.clicks ?? null;
      const clicsLm = lmLink?.humanClicks ?? lmLink?.clicks ?? null;
      const clics = clicsDesc === null && clicsLm === null
        ? null
        : (clicsDesc ?? 0) + (clicsLm ?? 0);
      return {
        ...post,
        hasDescLink: !!descLink,
        descLinkUrl: descLink?.shortUrl || undefined,
        hasLeadMagnet: !!lmLink,
        lmKeyword: lmLink?.utmCampaign?.replace('lm-', '') || undefined,
        clics,
      };
    });

    // Enrichit ensuite avec content_links (logique useEffect originale)
    const enrichedWithCl = enrichedFromShortio.map(post => {
      const cl = contentLinks.find(c => c.content_id === post.id);
      if (!cl) return post;
      return {
        ...post,
        hasDescLink: !!(cl as any).desc_calendly_short_url || !!(cl as any).desc_lm_short_url || !!(cl as any).desc_custom_short_url || !!cl.desc_short_url,
        descLinkUrl: cl.desc_short_url || undefined,
        descDestType: cl.desc_dest_type || undefined,
        descCalendlyUrl: (cl as any).desc_calendly_short_url || undefined,
        descCalendlyShortId: (cl as any).desc_calendly_short_id || undefined,
        descLmUrl: (cl as any).desc_lm_short_url || undefined,
        descLmShortId: (cl as any).desc_lm_short_id || undefined,
        descLmLmId: (cl as any).desc_lm_lm_id || undefined,
        descCustomUrl: (cl as any).desc_custom_short_url || undefined,
        descCustomShortId: (cl as any).desc_custom_short_id || undefined,
        hasLeadMagnet: !!cl.lm_short_url,
        lmKeyword: cl.lm_keyword || undefined,
        lmShortUrl: cl.lm_short_url || undefined,
        lmLmId: cl.lm_id || undefined,
        dmOpenerMessage: cl.dm_opener_message || undefined,
        dmLmMessage: cl.dm_lm_message || undefined,
        dmButtonText: cl.dm_button_text || undefined,
        dmLinkMessage: cl.dm_link_message || undefined,
        dmLinkButtonText: cl.dm_link_button_text || undefined,
      };
    });

    // Stories — ne passent pas par l'enrichissement Short.io/content_links (aucun
    // sens pour elles : pas de "lien description", le CTA vit sur story_sequences,
    // déjà résolu côté API /api/client/stories).
    const storyPosts: Post[] = (storiesData?.stories || []).map((s: any) => {
      const posted = new Date(s.posted_at);
      const dateLabel = posted.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
      const timeLabel = posted.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      return {
        id: s.id,
        caption: `Story du ${dateLabel} ${timeLabel}`,
        platform: 'STORY' as const,
        thumbnail: s.storage_url,
        igStoryId: s.ig_story_id,
        sequenceId: s.sequence_id,
        sequenceName: s.sequence_name,
        sequenceStoryCount: s.sequence_story_count ?? 0,
        ctaStoryId: s.cta_story_id ?? null,
        lmId: s.lm_id ?? null,
        lmKeyword: s.lm_keyword ?? undefined,
        dm1Message: s.dm1_message ?? null,
        dm2StoryMessage: s.dm2_story_message ?? null,
        calendlyShortUrl: s.calendly_short_url ?? null,
        hasLeadMagnet: !!s.lm_keyword,
        hasDescLink: false,
        reach: s.reach,
        views: s.views,
        postedAt: s.posted_at,
        expiredAt: s.expired_at,
      };
    });

    const allPosts = [...enrichedWithCl, ...storyPosts];

    // Applique les overrides optimistes locaux
    if (postsOverrides.size === 0) return allPosts;
    return allPosts.map(post => {
      const override = postsOverrides.get(post.id);
      return override ? { ...post, ...override } : post;
    });
  }, [igData, ytData, shortioData, contentLinks, storiesData, postsOverrides]);

  const handlePostUpdated = (postId: string, patch: Partial<Post>) => {
    setPostsOverrides(prev => {
      const next = new Map(prev);
      next.set(postId, { ...(prev.get(postId) ?? {}), ...patch });
      return next;
    });
    // Mettre à jour rightView si c'est le post sélectionné
    setRightView(prev => {
      if (!prev || prev.type !== 'post' || prev.post.id !== postId) return prev;
      return { type: 'post', post: { ...prev.post, ...patch } };
    });
  };


  const handleStorySequenceSaved = (affectedPostIds: string[], patch: Partial<Post>) => {
    setPostsOverrides(prev => {
      const next = new Map(prev);
      for (const id of affectedPostIds) next.set(id, { ...(prev.get(id) ?? {}), ...patch });
      return next;
    });
    setRightView(prev => {
      if (!prev) return prev;
      if (prev.type === 'story' && affectedPostIds.includes(prev.post.id)) return { type: 'story', post: { ...prev.post, ...patch } };
      return prev;
    });
    if (selectionMode) { setSelectionMode(false); setSelectedStoryIds(new Set()); }
    queryClient.invalidateQueries({ queryKey: ['stories', profileId] });
  };

  // ── Entonnoir « du contenu au prospect » ────────────────────────────────────
  //
  // All-time, sans fenêtre glissante : le coach veut savoir où sa mécanique casse,
  // pas ce qu'elle a fait ces 30 derniers jours.
  //
  // Aucun filtre de compte Instagram ici : la route /api/client/pipeline filtre déjà
  // archived_at, donc les leads d'un compte précédent sont exclus en amont. Ajouter
  // un filtre par ig_account_id créerait un second mécanisme concurrent du premier
  // (voir docs/a-deployer-apres-meta-review.md).
  //
  // La 5e étape (réponses à la relance) n'est PAS calculable aujourd'hui : la base
  // sait qu'un prospect a répondu (hook_replied) mais pas à quel message. Il faudra
  // tracer un prospect_event à l'envoi de la relance — d'ici là l'étape est masquée
  // plutôt qu'approximée avec hook_replied, qui donnerait un taux faux.
  const funnel = useMemo(() => {
    const leads: any[] = pipelineData?.leads ?? [];
    const events: any[] = pipelineData?.events ?? [];

    const commentaires = leads.length;
    const accroches = leads.filter(l => l.lead_magnet_sent).length;

    // Un clic compte une fois par prospect, pas une fois par événement : un prospect
    // qui reclique son lien ne fait pas un lead de plus.
    const cliqueurs = new Set(
      events
        .filter(e => e.event_type === 'lm_clicked' || e.event_type === 'link_clicked')
        .map(e => e.ig_lead_id)
        .filter(Boolean)
    );
    const liensCliques = cliqueurs.size;

    const taux = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 100) : null);

    // « Contenus » compte aussi ceux qui ont été SUPPRIMÉS d'Instagram mais qui ont
    // déjà généré des leads. La liste, elle, ne montre que les contenus encore en
    // ligne — on ne configure pas une séquence sur un post disparu.
    //
    // Sans ça, supprimer un Reel performant faisait baisser le dénominateur en
    // laissant ses leads au numérateur : le taux de conversion devenait faux, et
    // d'autant plus faux que le contenu supprimé avait bien marché.
    //
    // C'est le principe des outils du domaine : Buffer garde les publications
    // supprimées dans ses analytics, et conserve la version d'origine d'un post
    // modifié. L'analytics journalise ce qui a eu lieu, il ne reflète pas l'état
    // présent du réseau.
    const idsAffiches = new Set(posts.map(p => p.id));
    const mediasDisparus = new Set(
      leads.map(l => l.media_id).filter(m => m && !idsAffiches.has(m))
    );

    return {
      contenus: posts.length + mediasDisparus.size,
      commentaires,
      accroches,
      liensCliques,
      tauxAccroches: taux(accroches, commentaires),
      tauxClics: taux(liensCliques, accroches),
      pret: !!pipelineData,
    };
  }, [pipelineData, posts]);

  const [funnelOuvert, setFunnelOuvert] = useState(true);

  // « Sans séquence » se combine aux filtres de plateforme plutôt que de les
  // remplacer : la question « lesquels de mes Reels ne sont pas configurés ? »
  // est justement celle qui fait ouvrir cette page.
  const [sansSequence, setSansSequence] = useState(false);

  const filteredPosts = posts.filter(p => {
    if (filterPlatform !== 'all' && p.platform !== filterPlatform) return false;
    if (sansSequence && p.lmKeyword) return false;
    if (search.trim() && !p.caption.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // Compteurs des chips : calculés sur `posts`, pas sur `filteredPosts` — un
  // compteur qui change quand on clique dessus ne compte plus rien.
  const compteurs = useMemo(() => ({
    all: posts.length,
    IG: posts.filter(p => p.platform === 'IG').length,
    YT: posts.filter(p => p.platform === 'YT').length,
    STORY: posts.filter(p => p.platform === 'STORY').length,
    sansSequence: posts.filter(p => !p.lmKeyword).length,
  }), [posts]);

  // Résout le post depuis l'array live (enrichi) plutôt que rightView (copie figée)
  const selectedPost = rightView?.type === 'post'
    ? (posts.find(p => p.id === rightView.post.id) ?? rightView.post)
    : null;
  const selectedStory = rightView?.type === 'story'
    ? (posts.find(p => p.id === rightView.post.id) ?? rightView.post)
    : null;

  // Mode sélection multiple (regroupement de stories en séquence)
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedStoryIds, setSelectedStoryIds] = useState<Set<string>>(new Set());
  const selectedStoriesForGroup = rightView?.type === 'story-multi'
    ? posts.filter(p => rightView.postIds.includes(p.id))
    : [];
  const [storiesSubTab, setStoriesSubTab] = useState<'stories' | 'sequences'>('stories');

  // Parcours desktop en trois états :
  //   ① rightView === null           → la liste occupe toute la largeur
  //   ② rightView + menu replié      → rail d'icônes 56px + détail (état par
  //                                     défaut à l'ouverture d'un contenu : la
  //                                     séquence a besoin de la largeur)
  //   ③ rightView + menu déplié      → liste 250px + détail
  // Déplier est une action volontaire, quand on cherche un autre contenu.
  const [menuDeplie, setMenuDeplie] = useState(false);

  const sequences: any[] = sequencesData?.sequences ?? [];
  const [highlightedSequenceId, setHighlightedSequenceId] = useState<string | null>(null);
  const navigateToSequencesTab = (sequenceId: string) => {
    setFilterPlatform('STORY');
    setStoriesSubTab('sequences');
    setHighlightedSequenceId(sequenceId);
    setTimeout(() => setHighlightedSequenceId(null), 2000);
  };

  // Les stories expirent au bout de 24 h : ce rafraîchissement va rechercher
  // celles publiées depuis le dernier passage du cron. Appelé depuis les deux
  // rendus (mobile et desktop), d'où l'extraction.
  const refreshStories = async () => {
    await fetch('/api/client/stories/live-refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId }),
    });
    queryClient.invalidateQueries({ queryKey: ['stories', profileId] });
  };

  // Mobile : overlay détail (un seul onglet "Mes liens" depuis la fusion avec l'ancien
  // "Générer un lien", qui faisait exactement la même chose)
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [drawerClosing, setDrawerClosing] = useState(false);
  const isMobile = useIsMobile();

  const openMobileDetail = (view: RightView) => {
    unsavedGuardApi.guard(() => {
      setRightView(view);
      setDrawerClosing(false);
      setMobileDetailOpen(true);
    });
  };

  const closeMobileDetail = () => {
    setDrawerClosing(true);
    setTimeout(() => {
      setMobileDetailOpen(false);
      setDrawerClosing(false);
    }, 280);
  };

  const handleHeaderLmLibrary = () => {
    if (isMobile) openMobileDetail({ type: 'lm-library' });
    else unsavedGuardApi.guard(() => setRightView({ type: 'lm-library' }));
  };

  return (
    <UnsavedGuardContext.Provider value={unsavedGuardApi}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } } @keyframes pulse { 0%, 100% { opacity: .5 } 50% { opacity: 1 } }`}</style>
      <style>{`
        @media (max-width: 767px) {
          .liens-shell { flex-direction: column !important; }
          .liens-desktop-only { display: none !important; }
          .liens-mobile-panel { display: block !important; }
          .liens-header { align-items: center !important; gap: 10px !important; }
          .liens-header-actions { gap: 4px !important; flex-shrink: 0; }
          .liens-header-actions button {
            min-width: 44px !important; min-height: 44px !important;
            padding: 0 !important; font-size: 0 !important;
          }
          .liens-header-actions button svg { width: 17px !important; height: 17px !important; }
          .liens-header-actions .liens-btn-label { display: none !important; }
          .liens-header-title-sub { display: none !important; }
        }
        @media (min-width: 768px) {
          .liens-mobile-panel { display: none !important; }
        }
        .liens-root input:focus, .liens-root textarea:focus {
          border-color: var(--accent-brand, #2563eb) !important;
          box-shadow: 0 0 0 3px var(--accent-brand-soft, rgba(37,99,235,0.15));
        }
        .liens-root .liens-input-wrap:focus-within {
          border-color: var(--accent-brand, #2563eb) !important;
          box-shadow: 0 0 0 3px var(--accent-brand-soft, rgba(37,99,235,0.15));
        }
      `}</style>

      <div className="liens-root">
      <ModalParametres
        open={paramOpen} onClose={() => { setParamOpen(false); }}
        profileId={profileId} activeDomain={activeDomain} domainsLoaded={domainsLoaded}
        onCalendlyChange={(url: string) => setCalendlyOverride(url)} initialCalendly={calendlyUrl}
        leadMagnets={leadMagnets}
        onLmUpdated={(lm: LeadMagnet) => setLmOverrides(prev => (prev ?? leadMagnetsFromQuery).map(l => l.id === lm.id ? lm : l))}
      />

      <div className="liens-shell">

        {/* Header */}
        <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <div className="liens-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderBottom: domainsLoaded && domains.length === 0 ? 'none' : `1px solid ${BORDER}`, background: SURFACE }}>
          {/* Ligne de titre du hi-fi : titre 22px, sous-titre chiffré, et les CTA
              À DROITE SUR CETTE LIGNE — jamais dans la rangée de filtres, où ils
              débordent (le README insiste sur ce point). */}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: INK, letterSpacing: '-0.4px' }}>Gérer mes liens</div>
            <div className="liens-header-title-sub" style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>
              {posts.length} contenu{posts.length !== 1 ? 's' : ''}
              {' · '}{leadMagnets.length} lead magnet{leadMagnets.length !== 1 ? 's' : ''}
              {activeDomain?.hostname ? ` · ${activeDomain.hostname}` : ''}
            </div>
          </div>
          <div className="liens-header-actions" style={{ display: 'flex', gap: 9, alignItems: 'center' }}>
            {/* ↻ en icône seule : action fréquente juste après une publication,
                elle doit rester à un clic sans manger la ligne de titre. */}
            <button onClick={handleRefreshPosts} disabled={refreshingPosts} title="Actualiser les posts" aria-label="Actualiser les posts" style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 8,
              cursor: refreshingPosts ? 'default' : 'pointer', transition: `all var(--dur-quick) var(--ease-out)`,
              border: `1px solid ${BORDER}`, background: SURFACE, color: MUTED, opacity: refreshingPosts ? 0.6 : 1, flexShrink: 0,
            }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={refreshingPosts ? { animation: 'spin 1s linear infinite' } : undefined}><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
            </button>

            <button onClick={() => setParamOpen(true)} aria-label="Paramètres des liens" style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px 15px', fontSize: 12.5, fontWeight: 600,
              borderRadius: 8, cursor: 'pointer', position: 'relative', transition: `all var(--dur-quick) var(--ease-out)`, flexShrink: 0,
              border: `1px solid ${leadMagnets.some(lm => (lm.bio_ig_url && lm.bio_ig_source_url && lm.bio_ig_source_url !== lm.url) || (lm.bio_yt_url && lm.bio_yt_source_url && lm.bio_yt_source_url !== lm.url)) ? AMBER : BORDER}`,
              background: SURFACE, color: INK,
            }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              <span className="liens-btn-label">Paramètres</span>
              {leadMagnets.some(lm => (lm.bio_ig_url && lm.bio_ig_source_url && lm.bio_ig_source_url !== lm.url) || (lm.bio_yt_url && lm.bio_yt_source_url && lm.bio_yt_source_url !== lm.url)) && (
                <span style={{ position: 'absolute', top: -6, right: -6, width: 14, height: 14, borderRadius: '50%', background: AMBER, border: '2px solid var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, color: '#fff', fontWeight: 700 }}>!</span>
              )}
            </button>

            {/* Ardoise : c'est une vue de même niveau qu'un contenu, pas une action
                secondaire. Le hi-fi lui réserve l'accent de marque. */}
            <button onClick={() => unsavedGuardApi.guard(() => { setRightView({ type: 'prospect' }); setMenuDeplie(false); })} aria-label="Lien Calendly prospect" style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px 15px', fontSize: 12.5, fontWeight: 600,
              borderRadius: 8, cursor: 'pointer', border: 'none', flexShrink: 0,
              background: BLUE, color: '#fff', transition: `all var(--dur-quick) var(--ease-out)`,
            }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
              <span className="liens-btn-label">Lien Calendly prospect</span>
            </button>

            <button onClick={handleHeaderLmLibrary} aria-label="Lead magnets" style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px 15px', fontSize: 12.5, fontWeight: 600,
              borderRadius: 8, cursor: 'pointer', border: 'none', position: 'relative', flexShrink: 0,
              background: INK, color: '#fff', transition: `all var(--dur-quick) var(--ease-out)`,
            }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              <span className="liens-btn-label">Lead magnet</span>
              {leadMagnets.length > 0 && <span style={{ position: 'absolute', top: -6, right: -6, fontSize: 10, fontWeight: 700, background: SURFACE2, color: MUTED, borderRadius: 10, padding: '1px 5px', minWidth: 16, textAlign: 'center', border: '2px solid var(--surface)' }}>{leadMagnets.length}</span>}
            </button>
          </div>
        </div>

        {domainsLoaded && domains.length === 0 && (
          <div style={{ padding: '8px 20px', background: AMBER_SOFT, borderBottom: `1px solid ${BORDER}` }}>
            <span style={{ fontSize: 12, color: AMBER, fontWeight: 600 }}>⚠ Short.io non connecté — configure ta clé dans Réglages pour pouvoir associer un lead magnet à un contenu.</span>
          </div>
        )}
        </div>

        {/* ── Panneau mobile "Mes liens" (seul onglet — fusion de l'ancien "Générer un
             lien", qui faisait exactement la même chose : lister les contenus et ouvrir
             le même panneau au clic) ── */}
        <div className="liens-mobile-panel" style={{ display: 'none', flex: 1, overflowY: 'auto', padding: '16px 14px' }}>
          {(
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Entonnoir data={funnel} ouvert={funnelOuvert} onToggle={() => setFunnelOuvert(v => !v)} compact={false} />

              <button onClick={() => openMobileDetail({ type: 'prospect' })} style={{
                width: '100%', minHeight: 44, padding: '11px 14px', fontSize: 13, fontWeight: 700, borderRadius: 8, cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8, boxSizing: 'border-box',
                border: `1.5px solid ${BORDER}`, background: 'transparent', color: MUTED,
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
                Envoyer un lien Calendly Prospect en DM
              </button>

              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher un contenu…"
                style={{ width: '100%', minHeight: 44, padding: '10px 14px', fontSize: 14, borderRadius: 10, border: `1px solid ${BORDER}`, background: SURFACE, color: INK, outline: 'none', boxSizing: 'border-box' }} />

              <FiltresPlateforme
                value={filterPlatform} onChange={setFilterPlatform} compact={false}
                compteurs={compteurs} sansSequence={sansSequence} onSansSequence={setSansSequence}
              />

              {filterPlatform === 'STORY' && (
                <SousOngletsStories
                  value={storiesSubTab} compact={false}
                  onChange={t => { setStoriesSubTab(t); if (t === 'sequences') { setSelectionMode(false); setSelectedStoryIds(new Set()); } }}
                />
              )}

              {filterPlatform === 'STORY' && storiesSubTab === 'stories' && (
                <ActionsStories
                  selectionMode={selectionMode} selectedCount={selectedStoryIds.size} compact={false}
                  onStartSelection={() => setSelectionMode(true)}
                  onCancelSelection={() => { setSelectionMode(false); setSelectedStoryIds(new Set()); }}
                  onContinue={() => openMobileDetail({ type: 'story-multi', postIds: Array.from(selectedStoryIds) })}
                  onRefresh={refreshStories}
                />
              )}

              {filterPlatform === 'STORY' && storiesSubTab === 'sequences' && (
                <button onClick={() => { setStoriesSubTab('stories'); setSelectionMode(true); }} style={{ padding: '5px 12px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: `1px solid ${BORDER}`, background: 'transparent', color: MUTED, cursor: 'pointer' }}>
                  Créer une séquence stories
                </button>
              )}

              {filterPlatform === 'STORY' && storiesSubTab === 'sequences' ? (
                sequences.length === 0 ? (
                  <div style={{ padding: '20px 16px', fontSize: 12, color: FAINT, textAlign: 'center' }}>
                    Aucune séquence pour l'instant.
                    <div style={{ marginTop: 10 }}>
                      <button onClick={() => { setStoriesSubTab('stories'); setSelectionMode(true); }} style={{ padding: '6px 14px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: `1px solid ${BORDER}`, background: 'transparent', color: MUTED, cursor: 'pointer' }}>
                        + Créer une séquence stories
                      </button>
                    </div>
                  </div>
                ) : sequences.map(seq => (
                  <div key={seq.id} onClick={() => {
                    const ctaStory = posts.find(p => p.id === seq.cta_story_id) ?? posts.find(p => p.sequenceId === seq.id);
                    if (ctaStory) openMobileDetail({ type: 'story', post: ctaStory });
                  }} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', cursor: 'pointer', borderRadius: 10, border: `1px solid ${BORDER}`,
                    background: highlightedSequenceId === seq.id ? ACCENT_SOFT : SURFACE, transition: 'all .3s',
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: INK, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{seq.name}</div>
                      <div style={{ display: 'flex', gap: 5, alignItems: 'center', marginTop: 3, flexWrap: 'wrap' }}>
                        {seq.lm_keyword && (
                          <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--green)', background: 'var(--green-soft)', borderRadius: 4, padding: '1px 5px' }}>#{seq.lm_keyword}</span>
                        )}
                        {seq.calendly_short_url && (
                          <span style={{ fontSize: 10, fontWeight: 600, color: MUTED, background: SURFACE2, borderRadius: 4, padding: '1px 5px' }}>Calendly</span>
                        )}
                        {!seq.lm_keyword && !seq.calendly_short_url && (
                          <span style={{ fontSize: 10, color: FAINT }}>Aucun CTA</span>
                        )}
                        <span style={{ fontSize: 10, color: FAINT }}>{seq.story_count} story{seq.story_count > 1 ? 'ies' : ''}</span>
                      </div>
                    </div>
                  </div>
                ))
              ) : postsLoading ? (
                <ContentGridSkeleton />
              ) : filteredPosts.length === 0 ? (
                <div style={{ padding: '20px 16px', fontSize: 12, color: FAINT, textAlign: 'center' }}>
                  {search ? 'Aucun résultat.' : 'Aucun contenu trouvé.'}
                </div>
              ) : filteredPosts.map(post => {
                const isStory = post.platform === 'STORY';
                const isGroupedElsewhere = isStory && !!post.sequenceId;
                return (
                  <LigneContenu
                    key={post.id} post={post} compact={false}
                    selected={false}
                    checked={isStory && selectedStoryIds.has(post.id)}
                    selectionMode={selectionMode}
                    groupedElsewhere={isGroupedElsewhere}
                    onClick={() => {
                      if (isStory && selectionMode) {
                        if (isGroupedElsewhere) return; // déjà dans une séquence (même solo), non cochable
                        setSelectedStoryIds(prev => {
                          const next = new Set(prev);
                          if (next.has(post.id)) next.delete(post.id); else next.add(post.id);
                          return next;
                        });
                        return;
                      }
                      openMobileDetail(isStory ? { type: 'story', post } : { type: 'post', post });
                    }}
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* ── Drawer mobile — slide depuis la droite style iOS ── */}
        {mobileDetailOpen && rightView && (
          <div style={{
            position: 'fixed', inset: 0, zIndex: 200,
            background: BG, overflowY: 'auto',
            paddingBottom: 'calc(56px + env(safe-area-inset-bottom) + 6px)',
            transform: drawerClosing ? 'translateX(100%)' : 'translateX(0)',
            transition: 'transform 280ms cubic-bezier(0.4, 0, 0.2, 1)',
          }}>
            {/* Header retour */}
            <div style={{
              position: 'sticky', top: 0, zIndex: 10,
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 16px', background: SURFACE,
              borderBottom: `1px solid ${BORDER}`,
            }}>
              <button onClick={closeMobileDetail} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 14, fontWeight: 600, color: BLUE, padding: '4px 0',
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                Retour
              </button>
            </div>
            {/* Contenu du panneau droit */}
            <div style={{ padding: '16px' }}>
              {rightView.type === 'lm-library' ? (
                <PanneauLeadMagnets
                  leadMagnets={leadMagnets} lmLoading={lmLoading}
                  onCreated={(lm: LeadMagnet) => setLmOverrides(prev => [lm, ...(prev ?? leadMagnetsFromQuery)])}
                  onDeleted={(id: string) => setLmOverrides(prev => (prev ?? leadMagnetsFromQuery).filter(l => l.id !== id))}
                  onUpdated={(lm: LeadMagnet) => setLmOverrides(prev => (prev ?? leadMagnetsFromQuery).map(l => l.id === lm.id ? lm : l))}
                />
              ) : rightView.type === 'prospect' ? (
                <PanneauCalendlyProspect profileId={profileId} activeDomain={activeDomain} domainsLoaded={domainsLoaded} calendlyUrl={calendlyUrl} posts={posts} />
              ) : rightView.type === 'story' ? (
                <PanneauStorySequence
                  story={selectedStory || rightView.post} allStories={posts} profileId={profileId} leadMagnets={leadMagnets}
                  onSequenceSaved={handleStorySequenceSaved} onNavigateStory={post => unsavedGuardApi.guard(() => setRightView({ type: 'story', post }))}
                  onNavigateToSequencesTab={navigateToSequencesTab}
                />
              ) : rightView.type === 'story-multi' ? (
                <PanneauStorySequence
                  stories={selectedStoriesForGroup} allStories={posts} profileId={profileId} leadMagnets={leadMagnets}
                  onSequenceSaved={handleStorySequenceSaved} onNavigateStory={post => unsavedGuardApi.guard(() => setRightView({ type: 'story', post }))}
                  onNavigateToSequencesTab={navigateToSequencesTab}
                />
              ) : (
                <PanneauActions
                  post={selectedPost || rightView.post} profileId={profileId} activeDomain={activeDomain} domainsLoaded={domainsLoaded}
                  calendlyUrl={calendlyUrl} leadMagnets={leadMagnets}
                  onLmCreated={(lm: LeadMagnet) => setLmOverrides(prev => [lm, ...(prev ?? leadMagnetsFromQuery)])}
                  onPostUpdated={handlePostUpdated}
                />
              )}
            </div>
          </div>
        )}

        {/* Body desktop — trois états : ① liste pleine largeur · ② rail + détail
             (défaut à l'ouverture) · ③ menu déplié + détail */}
        <div className="liens-desktop-only" style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>

          {/* ② le rail, quand un contenu est ouvert et le menu replié */}
          {rightView !== null && !menuDeplie && (
            <RailContenus
              posts={filteredPosts} rightView={rightView}
              onRetour={() => unsavedGuardApi.guard(() => setRightView(null))}
              onDeplier={() => setMenuDeplie(true)}
              onProspect={() => unsavedGuardApi.guard(() => setRightView({ type: 'prospect' }))}
              onLmLibrary={() => unsavedGuardApi.guard(() => setRightView({ type: 'lm-library' }))}
              onOuvrirPost={post => unsavedGuardApi.guard(() => setRightView(post.platform === 'STORY' ? { type: 'story', post } : { type: 'post', post }))}
            />
          )}

          {/* Colonne gauche — ① pleine largeur, ③ repliée à 250px */}
          {(rightView === null || menuDeplie) && (
          <div style={{
            width: rightView === null ? '100%' : 250,
            flexShrink: 0,
            borderRight: rightView === null ? 'none' : `1px solid ${BORDER}`,
            background: BG, display: 'flex', flexDirection: 'column', minHeight: 0,
          }}>

            {/* En ③, la tête de menu porte le retour à ① et le repli du menu —
                sans elle, on ne pourrait plus ni revenir ni retrouver la largeur. */}
            {menuDeplie && (
              <div style={{ padding: '12px 13px 9px', display: 'flex', alignItems: 'center', gap: 9, flexShrink: 0, borderBottom: `1px solid ${BORDER_SOFT}` }}>
                <button onClick={() => unsavedGuardApi.guard(() => { setRightView(null); setMenuDeplie(false); })} title="Revenir à tous les contenus" style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: BLUE, fontSize: 12, fontWeight: 700 }}>
                  {IcoRetour}<span>Gérer mes liens</span>
                </button>
                <button onClick={() => setMenuDeplie(false)} title="Replier la liste" aria-label="Replier la liste" style={{
                  marginLeft: 'auto', width: 26, height: 24, borderRadius: 6, flexShrink: 0, cursor: 'pointer',
                  background: SURFACE, border: `1px solid ${BORDER}`, color: INK,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>{IcoMenu}</button>
              </div>
            )}

            {/* Entrées épinglées — seulement dans le MENU DÉPLIÉ (③). En état ①
                elles vivent sur la ligne de titre, comme le hi-fi : deux gros
                boutons pleine largeur au-dessus des filtres poussaient la liste
                vers le bas et doublonnaient les CTA du haut. Le rail (②) a ses
                propres icônes. */}
            {menuDeplie && (
            <div style={{ padding: '8px 12px', borderBottom: `1px solid ${BORDER}`, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button onClick={() => unsavedGuardApi.guard(() => setRightView({ type: 'prospect' }))} style={{
                width: '100%', padding: '8px 11px', fontSize: 11.5, fontWeight: 600, borderRadius: 8, cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8,
                border: `1px solid ${rightView?.type === 'prospect' ? BLUE : '#cfdce4'}`,
                background: BLUE_SOFT, color: BLUE, transition: `all var(--dur-quick) var(--ease-out)`,
              }}>
                {IcoAvion}
                <span>Lien Calendly prospect</span>
              </button>
              <button onClick={() => unsavedGuardApi.guard(() => setRightView({ type: 'lm-library' }))} style={{
                width: '100%', padding: '8px 11px', fontSize: 11.5, fontWeight: 600, borderRadius: 8, cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8,
                border: `1px solid ${rightView?.type === 'lm-library' ? BLUE : BORDER}`,
                background: rightView?.type === 'lm-library' ? BLUE_SOFT : 'transparent',
                color: rightView?.type === 'lm-library' ? BLUE : MUTED, transition: `all var(--dur-quick) var(--ease-out)`,
              }}>
                {IcoLm}
                <span>Lead magnets{leadMagnets.length > 0 ? ` · ${leadMagnets.length}` : ''}</span>
              </button>
            </div>
            )}

            {/* Entonnoir — état ① seulement : une fois dans un contenu, la question
                n'est plus « où ça casse ? » mais « que dit CE contenu ». */}
            {rightView === null && (
              <div style={{ padding: '12px 14px 0', flexShrink: 0 }}>
                <Entonnoir data={funnel} ouvert={funnelOuvert} onToggle={() => setFunnelOuvert(v => !v)} compact />
              </div>
            )}

            {/* Barre recherche + filtres */}
            <div style={{ padding: '10px 14px', borderBottom: `1px solid ${BORDER}`, display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher un contenu…"
                style={{ width: '100%', padding: '7px 10px', fontSize: 12, borderRadius: 8, border: `1px solid ${BORDER}`, background: SURFACE, color: INK, outline: 'none', boxSizing: 'border-box' }} />
              <FiltresPlateforme
                value={filterPlatform} onChange={setFilterPlatform} compact
                contentCount={filteredPosts.length} compteurs={compteurs}
                sansSequence={sansSequence} onSansSequence={setSansSequence}
              />

              {filterPlatform === 'STORY' && (
                <SousOngletsStories
                  value={storiesSubTab} compact
                  onChange={t => { setStoriesSubTab(t); if (t === 'sequences') { setSelectionMode(false); setSelectedStoryIds(new Set()); } }}
                />
              )}

              {filterPlatform === 'STORY' && storiesSubTab === 'stories' && (
                <ActionsStories
                  selectionMode={selectionMode} selectedCount={selectedStoryIds.size} compact
                  onStartSelection={() => setSelectionMode(true)}
                  onCancelSelection={() => { setSelectionMode(false); setSelectedStoryIds(new Set()); }}
                  onContinue={() => unsavedGuardApi.guard(() => setRightView({ type: 'story-multi', postIds: Array.from(selectedStoryIds) }))}
                  onRefresh={refreshStories}
                />
              )}

              {filterPlatform === 'STORY' && storiesSubTab === 'sequences' && (
                <button onClick={() => { setStoriesSubTab('stories'); setSelectionMode(true); }} style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 6, border: `1px solid ${BORDER}`, background: 'transparent', color: MUTED, cursor: 'pointer' }}>
                  Créer une séquence stories
                </button>
              )}
            </div>

            {/* Liste contenus */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {filterPlatform === 'STORY' && storiesSubTab === 'sequences' ? (
                sequences.length === 0 ? (
                  <div style={{ padding: '20px 16px', fontSize: 12, color: FAINT, textAlign: 'center' }}>
                    Aucune séquence pour l'instant.
                    <div style={{ marginTop: 10 }}>
                      <button onClick={() => { setStoriesSubTab('stories'); setSelectionMode(true); }} style={{ padding: '6px 14px', fontSize: 11, fontWeight: 600, borderRadius: 6, border: `1px solid ${BORDER}`, background: 'transparent', color: MUTED, cursor: 'pointer' }}>
                        + Créer une séquence stories
                      </button>
                    </div>
                  </div>
                ) : sequences.map(seq => (
                  <div key={seq.id} onClick={() => {
                    const ctaStory = posts.find(p => p.id === seq.cta_story_id) ?? posts.find(p => p.sequenceId === seq.id);
                    if (ctaStory) unsavedGuardApi.guard(() => setRightView({ type: 'story', post: ctaStory }));
                  }} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', cursor: 'pointer', transition: 'all .3s',
                    background: highlightedSequenceId === seq.id ? BLUE_SOFT : 'transparent',
                    boxShadow: highlightedSequenceId === seq.id ? `inset 2px 0 0 ${BLUE}` : 'none',
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 500, color: INK, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{seq.name}</div>
                      <div style={{ display: 'flex', gap: 5, alignItems: 'center', marginTop: 3, flexWrap: 'wrap' }}>
                        {seq.lm_keyword && (
                          <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--green)', background: 'var(--green-soft)', borderRadius: 4, padding: '1px 5px' }}>#{seq.lm_keyword}</span>
                        )}
                        {seq.calendly_short_url && (
                          <span style={{ fontSize: 10, fontWeight: 600, color: MUTED, background: SURFACE2, borderRadius: 4, padding: '1px 5px' }}>Calendly</span>
                        )}
                        {!seq.lm_keyword && !seq.calendly_short_url && (
                          <span style={{ fontSize: 10, color: FAINT }}>Aucun CTA</span>
                        )}
                        <span style={{ fontSize: 10, color: FAINT }}>{seq.story_count} story{seq.story_count > 1 ? 'ies' : ''}</span>
                      </div>
                    </div>
                  </div>
                ))
              ) : postsLoading ? (
                <ContentGridSkeleton />
              ) : filteredPosts.length === 0 ? (
                <div style={{ padding: '20px 16px', fontSize: 12, color: FAINT, textAlign: 'center' }}>
                  {search ? 'Aucun résultat.' : 'Aucun contenu trouvé.'}
                </div>
              ) : filteredPosts.map(post => {
                const isStory = post.platform === 'STORY';
                const isGroupedElsewhere = isStory && !!post.sequenceId;
                return (
                  <LigneContenu
                    key={post.id} post={post} compact
                    selected={isStory ? (selectionMode ? false : selectedStory?.id === post.id) : selectedPost?.id === post.id}
                    checked={isStory && selectedStoryIds.has(post.id)}
                    selectionMode={selectionMode}
                    groupedElsewhere={isGroupedElsewhere}
                    onClick={() => {
                      if (isStory && selectionMode) {
                        if (isGroupedElsewhere) return; // déjà dans une séquence (même solo), non cochable
                        setSelectedStoryIds(prev => {
                          const next = new Set(prev);
                          if (next.has(post.id)) next.delete(post.id); else next.add(post.id);
                          return next;
                        });
                        return;
                      }
                      unsavedGuardApi.guard(() => setRightView(isStory ? { type: 'story', post } : { type: 'post', post }));
                    }}
                  />
                );
              })}
            </div>
          </div>
          )}

          {/* Colonne droite — seulement en ② et ③ : en ① la liste prend toute la
              largeur, et une carte « sélectionne un contenu » n'aurait rien à dire
              de plus que la liste elle-même. */}
          {rightView !== null && (
          <div style={{ flex: 1, minWidth: 0, background: SURFACE, overflowY: 'auto' }}>
            {rightView.type === 'lm-library' ? (
              <PanneauLeadMagnets
                leadMagnets={leadMagnets} lmLoading={lmLoading}
                onCreated={(lm: LeadMagnet) => setLmOverrides(prev => [lm, ...(prev ?? leadMagnetsFromQuery)])}
                onDeleted={(id: string) => setLmOverrides(prev => (prev ?? leadMagnetsFromQuery).filter(l => l.id !== id))}
                onUpdated={(lm: LeadMagnet) => setLmOverrides(prev => (prev ?? leadMagnetsFromQuery).map(l => l.id === lm.id ? lm : l))}
              />
            ) : rightView.type === 'prospect' ? (
              <PanneauCalendlyProspect profileId={profileId} activeDomain={activeDomain} domainsLoaded={domainsLoaded} calendlyUrl={calendlyUrl} posts={posts} />
            ) : rightView.type === 'story' ? (
              <PanneauStorySequence
                story={selectedStory || rightView.post} allStories={posts} profileId={profileId} leadMagnets={leadMagnets}
                onSequenceSaved={handleStorySequenceSaved} onNavigateStory={post => unsavedGuardApi.guard(() => setRightView({ type: 'story', post }))}
                onNavigateToSequencesTab={navigateToSequencesTab}
              />
            ) : rightView.type === 'story-multi' ? (
              <PanneauStorySequence
                stories={selectedStoriesForGroup} allStories={posts} profileId={profileId} leadMagnets={leadMagnets}
                onSequenceSaved={handleStorySequenceSaved} onNavigateStory={post => unsavedGuardApi.guard(() => setRightView({ type: 'story', post }))}
                onNavigateToSequencesTab={navigateToSequencesTab}
              />
            ) : (
              <PanneauActions
                post={selectedPost || rightView.post} profileId={profileId} activeDomain={activeDomain} domainsLoaded={domainsLoaded}
                calendlyUrl={calendlyUrl} leadMagnets={leadMagnets}
                onLmCreated={(lm: LeadMagnet) => setLmOverrides(prev => [lm, ...(prev ?? leadMagnetsFromQuery)])}
                onPostUpdated={handlePostUpdated}
              />
            )}
          </div>
          )}
        </div>
      </div>

      {pendingLeaveAction && (
        <ModalShell onClose={() => setPendingLeaveAction(null)} width={380} variant={isMobile ? 'sheet' : 'centered'}>
          <div style={{ padding: 24 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: INK, marginBottom: 8 }}>Modifications non sauvegardées</div>
            <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.5, marginBottom: 20 }}>
              Tu as des changements dans la séquence de DM qui n'ont pas été enregistrés. Si tu quittes maintenant, ils seront perdus.
            </div>
            <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 10, justifyContent: isMobile ? undefined : 'flex-end' }}>
              <button onClick={async () => {
                  setSavingAll(true);
                  try { await unsavedGuardApi.saveAll(); } finally { setSavingAll(false); }
                  const action = pendingLeaveAction;
                  hasUnsavedRef.current = false;
                  setPendingLeaveAction(null);
                  action?.();
                }} disabled={savingAll}
                style={{ order: isMobile ? 1 : 3, minHeight: 44, padding: '8px 16px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: 'none', background: 'var(--green)', color: '#fff', cursor: savingAll ? 'default' : 'pointer', opacity: savingAll ? 0.7 : 1 }}>
                {savingAll ? 'Enregistrement...' : 'Enregistrer'}
              </button>
              <button onClick={() => { const action = pendingLeaveAction; hasUnsavedRef.current = false; setPendingLeaveAction(null); action(); }} disabled={savingAll}
                style={{ order: isMobile ? 2 : 2, minHeight: 44, padding: '8px 16px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: 'none', background: RED, color: '#fff', cursor: savingAll ? 'default' : 'pointer', opacity: savingAll ? 0.5 : 1 }}>
                Ne pas enregistrer
              </button>
              <button onClick={() => setPendingLeaveAction(null)} disabled={savingAll}
                style={{ order: isMobile ? 3 : 1, minHeight: 44, padding: '8px 16px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: `1px solid ${BORDER}`, background: 'none', color: INK, cursor: savingAll ? 'default' : 'pointer', opacity: savingAll ? 0.5 : 1 }}>
                Annuler
              </button>
            </div>
          </div>
        </ModalShell>
      )}
      </div>
    </UnsavedGuardContext.Provider>
  );
}
