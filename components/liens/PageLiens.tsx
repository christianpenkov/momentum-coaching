'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useUser } from '@/lib/UserContext';

// ─── Design tokens (alignés sur globals.css) ──────────────────────────────────
const INK = 'var(--ink)';
const MUTED = 'var(--muted)';
const FAINT = 'var(--faint)';
const SURFACE = 'var(--surface)';
const SURFACE2 = 'var(--surface-2)';
const BORDER = 'var(--border)';
const BG = 'var(--bg)';
const GREEN = 'var(--green)';
const GREEN_SOFT = 'var(--green-soft)';
const RED = 'var(--red)';
const AMBER = 'var(--amber)';
const AMBER_SOFT = 'var(--amber-soft)';
const BLUE = '#6b7cde';
const BLUE_SOFT = '#6b7cde12';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ShortDomain { id: string | number; hostname: string; }

interface Post {
  id: string;
  caption: string;
  platform: 'IG' | 'YT';
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
  dmOpenerMessage?: string;
  dmLmMessage?: string;
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
  return (
    <button onClick={() => { navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      style={{ padding: '5px 12px', fontSize: 11, fontWeight: 600, borderRadius: 6, border: `1px solid ${copied ? 'transparent' : BORDER}`, background: copied ? 'var(--green)' : SURFACE, color: copied ? '#fff' : INK, cursor: 'pointer', transition: 'all .2s', whiteSpace: 'nowrap' }}>
      {copied ? '✓ Copié' : 'Copier'}
    </button>
  );
}

function GeneratedUrlRow({ url, label }: { url: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: SURFACE2, borderRadius: 8, padding: '8px 12px' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: MUTED, marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
        <div style={{ fontSize: 12, fontWeight: 700, color: BLUE, wordBreak: 'break-all' }}>{url}</div>
      </div>
      <CopyBtn url={url} />
    </div>
  );
}

function Spinner() {
  return <span style={{ display: 'inline-block', width: 14, height: 14, border: `2px solid ${BORDER}`, borderTopColor: BLUE, borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />;
}

// ─── Modal Paramètres ─────────────────────────────────────────────────────────

function ModalParametres({ open, onClose, profileId, domains, domainsLoaded, onCalendlyChange, initialCalendly, leadMagnets, onLmUpdated }: {
  open: boolean; onClose: () => void;
  profileId: string; domains: ShortDomain[]; domainsLoaded: boolean;
  onCalendlyChange: (url: string) => void; initialCalendly: string;
  leadMagnets: LeadMagnet[];
  onLmUpdated: (lm: LeadMagnet) => void;
}) {
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
  const domain = domains[0]?.hostname || '';
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
      const { shortUrl } = await callShortio({ profileId, domainId: domain, originalUrl: calendlyUrl.trim(), title: bioLabel, utmSource: domain, utmMedium: 'bio', utmCampaign: `bio-${platform}`, path: bioPath });
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
        utmSource: domain, utmMedium: 'bio',
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
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(26,24,21,.45)', zIndex: 9999, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: SURFACE, borderRadius: 14, padding: 28, width: 560, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 8px 40px rgba(0,0,0,.18)', border: `1px solid ${BORDER}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: INK }}>Paramètres des liens</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: MUTED, lineHeight: 1, padding: '0 4px' }}>×</button>
        </div>

        {/* Calendly */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Lien Calendly</div>
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
          <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Liens bio Calendly</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              { platform: 'instagram' as const, label: 'Bio Instagram', result: bioIg, setResult: setBioIg, loading: genIg, setLoading: setGenIg, path: 'bio-calendly-ig' },
              { platform: 'youtube' as const, label: 'Bio YouTube', result: bioYt, setResult: setBioYt, loading: genYt, setLoading: setGenYt, path: 'bio-calendly-yt' },
            ].map(({ platform, label, result, setResult, loading, setLoading }) => (
              <div key={platform} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 8, background: SURFACE2, border: `1px solid ${BORDER}` }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>{label}</div>
                  <div style={{ fontSize: 11, color: result ? BLUE : FAINT, fontWeight: result ? 600 : 400, wordBreak: 'break-all' }}>
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
            <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Liens bio Lead Magnet</div>
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
                                <div style={{ fontSize: 11, color: url ? BLUE : FAINT, wordBreak: 'break-all' }}>
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
    </div>
  );
}

// ─── Panneau droit : actions pour un contenu ──────────────────────────────────

function TabDesc({ post, profileId, domain, canGenerate, calendlyUrl, leadMagnets, onPostUpdated }: {
  post: Post; profileId: string; domain: string; canGenerate: boolean;
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

  // Pré-sélectionner le LM associé quand on passe sur l'onglet leadmagnet
  useEffect(() => {
    if (destType === 'leadmagnet' && !selectedLmId) {
      const linked = post.descLmLmId
        ? leadMagnets.find(lm => lm.id === post.descLmLmId)
        : leadMagnets.find(lm => lm.keyword === post.lmKeyword);
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

    const utms = { source: domain, medium: 'description', campaign: destType, content: post.id };
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
        <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Destination</div>
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
        // Trouve le LM associé : d'abord via desc_lm_lm_id, sinon via lm_keyword de l'onglet LM
        const assocLm = leadMagnets.find(lm => lm.id === post.descLmLmId)
          || (post.lmKeyword ? leadMagnets.find(lm => lm.keyword === post.lmKeyword) : undefined)
          || (post.hasLeadMagnet ? leadMagnets[0] : undefined);
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

      {!canGenerate && <div style={{ fontSize: 12, color: AMBER, background: AMBER_SOFT, borderRadius: 6, padding: '8px 10px' }}>⚠ Short.io non connecté — configure ta clé dans Réglages.</div>}
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
          style={{ padding: '10px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none', background: BLUE, color: '#fff', cursor: 'pointer', opacity: loading || !canGenerate || !canGenBtn ? 0.4 : 1, transition: 'opacity .15s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          {loading ? <><Spinner /> Génération...</> : 'Générer le lien description'}
        </button>
      )}
      {destType === 'custom' && (
        <button onClick={() => generate()} disabled={loading || !canGenerate || !canGenBtn}
          style={{ padding: '10px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none', background: BLUE, color: '#fff', cursor: 'pointer', opacity: loading || !canGenerate || !canGenBtn ? 0.4 : 1, transition: 'opacity .15s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          {loading ? <><Spinner /> Génération...</> : currentUrl ? 'Regénérer le lien' : 'Générer le lien description'}
        </button>
      )}
    </div>
  );
}

const TOKEN = '{{lien_lm}}';

// Insère le token avec espaces garantis autour
function insertTokenAt(text: string, pos: number): string {
  const before = text.slice(0, pos);
  const after = text.slice(pos);
  const needSpaceBefore = before.length > 0 && !before.endsWith(' ');
  const needSpaceAfter = after.length > 0 && !after.startsWith(' ');
  return before
    + (needSpaceBefore ? ' ' : '')
    + TOKEN
    + (needSpaceAfter ? ' ' : '')
    + after;
}

// ─── Dm1Editor : contentEditable avec badge inline draggable ─────────────────

// Convertit la valeur string → HTML pour l'affichage ({{lien_lm}} → badge span)
function valueToHtml(text: string, blue: string, blueSoft: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped.replace(
    /\{\{lien_lm\}\}/g,
    `<span class="dm1-token" contenteditable="false" draggable="true" data-token="{{lien_lm}}" style="display:inline-flex;align-items:center;background:${blueSoft};border:1px solid ${blue};border-radius:5px;padding:2px 8px;color:${blue};font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;user-select:none;cursor:grab;vertical-align:middle;line-height:1.4">Lien LM</span>`
  );
}

// Extrait la valeur string depuis le innerHTML du contentEditable
function htmlToValue(el: HTMLDivElement): string {
  let result = '';
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      result += node.textContent ?? '';
    } else if (node instanceof HTMLElement && node.dataset.token) {
      result += node.dataset.token;
    } else if (node instanceof HTMLElement) {
      result += node.textContent ?? '';
    }
  }
  return result;
}

function Dm1Editor({ value, onChange, saved, blue, blueSoft, border, amber, bg, ink }: {
  value: string; onChange: (v: string) => void; saved: boolean;
  blue: string; blueSoft: string; border: string; amber: string; bg: string; ink: string;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  // Pour éviter la boucle onChange → re-render → perte de curseur
  const isComposing = useRef(false);
  const lastValue = useRef(value);

  // Sync HTML quand la valeur change depuis l'extérieur (ex: changement de post)
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (lastValue.current === value) return;
    lastValue.current = value;
    const html = valueToHtml(value, blue, blueSoft);
    el.innerHTML = html || '';
    // Réattacher les listeners dragstart aux badges après re-render
    attachBadgeDragListeners(el);
  }, [value, blue, blueSoft]);

  // Attacher dragstart sur les badges du contentEditable
  function attachBadgeDragListeners(el: HTMLDivElement) {
    el.querySelectorAll('[data-token]').forEach(span => {
      (span as HTMLElement).ondragstart = (e: DragEvent) => {
        e.dataTransfer?.setData('text/plain', TOKEN);
      };
    });
  }

  // Init au montage
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    el.innerHTML = valueToHtml(value, blue, blueSoft);
    attachBadgeDragListeners(el);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleInput = useCallback(() => {
    if (isComposing.current) return;
    const el = editorRef.current;
    if (!el) return;
    let extracted = htmlToValue(el);
    // Le token est obligatoire — si l'utilisateur l'a supprimé, on le remet à la fin
    if (!extracted.includes(TOKEN)) {
      extracted = extracted.trimEnd() + (extracted.trimEnd().length > 0 ? ' ' : '') + TOKEN;
      lastValue.current = extracted;
      el.innerHTML = valueToHtml(extracted, blue, blueSoft);
      attachBadgeDragListeners(el);
      // Placer le curseur avant le badge
      const sel = window.getSelection();
      if (sel) {
        const range = document.createRange();
        const lastTextNode = Array.from(el.childNodes).reverse().find(n => n.nodeType === Node.TEXT_NODE);
        if (lastTextNode) { range.setStartAfter(lastTextNode); } else { range.setStart(el, el.childNodes.length - 1); }
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    } else {
      // Garantir qu'il y a toujours un espace avant le token (évite "mot{{lien_lm}}")
      const fixed = extracted.replace(/([\S])(\{\{lien_lm\}\})/g, '$1 $2');
      if (fixed !== extracted) {
        lastValue.current = fixed;
        el.innerHTML = valueToHtml(fixed, blue, blueSoft);
        attachBadgeDragListeners(el);
        onChange(fixed);
        return;
      }
      lastValue.current = extracted;
    }
    onChange(extracted);
    attachBadgeDragListeners(el);
  }, [onChange, blue, blueSoft]);

  // Drop du badge dans le contentEditable
  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.getData('text/plain') !== TOKEN) return;
    e.preventDefault();
    // Obtenir la position du drop dans le texte
    let dropPos: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const caretData = (document as any).caretRangeFromPoint?.(e.clientX, e.clientY)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ?? (document as any).caretPositionFromPoint?.(e.clientX, e.clientY);
    const withoutToken = value.replace(TOKEN, '').replace(/  +/g, ' ');
    if (caretData) {
      // Calculer l'offset texte brut jusqu'au point de drop
      const el = editorRef.current;
      if (el) {
        const tempRange = document.createRange();
        if ('startContainer' in caretData) {
          tempRange.setStart(caretData.startContainer, caretData.startOffset);
        } else {
          tempRange.setStart(caretData.offsetNode, caretData.offset);
        }
        tempRange.collapse(true);
        const rangeFromStart = document.createRange();
        rangeFromStart.setStart(el, 0);
        rangeFromStart.setEnd(tempRange.startContainer, tempRange.startOffset);
        // Compter les chars texte brut avant le drop (hors badges)
        let count = 0;
        const iter = document.createNodeIterator(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
        let n: Node | null;
        while ((n = iter.nextNode())) {
          if (n === tempRange.startContainer) { count += tempRange.startOffset; break; }
          if (n.nodeType === Node.TEXT_NODE) count += (n.textContent ?? '').length;
          else if (n instanceof HTMLElement && n.dataset.token) count += n.dataset.token.length;
        }
        dropPos = count;
      } else { dropPos = withoutToken.length; }
    } else { dropPos = withoutToken.length; }
    const next = insertTokenAt(withoutToken, dropPos);
    lastValue.current = next;
    onChange(next);
    // Mettre à jour le HTML
    const el = editorRef.current;
    if (el) { el.innerHTML = valueToHtml(next, blue, blueSoft); attachBadgeDragListeners(el); }
  }, [value, onChange, blue, blueSoft]);

  return (
    <div style={{ borderRadius: 8, border: `1px solid ${saved ? border : amber}`, background: bg }}>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onCompositionStart={() => { isComposing.current = true; }}
        onCompositionEnd={() => { isComposing.current = false; handleInput(); }}
        onDrop={handleDrop}
        onDragOver={e => e.preventDefault()}
        data-placeholder="Ex : 👋 Voici le lien comme promis !"
        style={{
          minHeight: 72, padding: '10px 12px',
          fontSize: 12, lineHeight: 1.8, fontFamily: 'inherit',
          color: ink, background: 'transparent',
          outline: 'none', wordBreak: 'break-word', whiteSpace: 'pre-wrap',
        }}
      />
    </div>
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

function TabLm({ post, profileId, domain, canGenerate, leadMagnets, onLmCreated, onPostUpdated }: {
  post: Post; profileId: string; domain: string; canGenerate: boolean;
  leadMagnets: LeadMagnet[]; onLmCreated: (lm: LeadMagnet) => void;
  onPostUpdated: (postId: string, patch: Partial<Post>) => void;
}) {
  const isYT = post.platform === 'YT';
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

  useEffect(() => {
    setKeyword(post.lmKeyword || '');
    setDmMessage(post.dmOpenerMessage || '');
    setResult(post.lmShortUrl || null);
    setDm1Text(post.dmLmMessage || `👋 Voici le lien comme promis ! {{lien_lm}}`);
    setDm1Saved(true);
    setDm2Text(post.dmOpenerMessage || '');
    setDm2Saved(true);
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
      const { shortUrl } = await callShortio({ profileId, domainId: domain, originalUrl: lmUrl, title: lmTitle, utmSource: domain, utmMedium: 'leadmagnet', utmCampaign: slugify(keyword), utmContent: post.id, path });
      // Short.io OK — on peut créer le LM en DB maintenant
      if (lmMode === 'new') {
        const res = await fetch('/api/client/lead-magnets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: lmName, url: lmUrl, keyword }) });
        const saved = await res.json();
        if (res.ok && saved.lead_magnet) { onLmCreated(saved.lead_magnet); resolvedLmId = saved.lead_magnet.id; }
      }
      // Sauvegarder dans content_links
      await fetch('/api/client/content-links', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content_id: post.id, platform: post.platform, lm_id: resolvedLmId || null, lm_short_url: shortUrl, lm_keyword: keyword, dm_opener_message: dmMessage || null, dm_lm_message: dm1Text || null }),
      });
      setResult(shortUrl);
      setDm2Text(dmMessage || '');
      setDm2Saved(true);
      onPostUpdated(post.id, { hasLeadMagnet: true, lmKeyword: keyword, lmShortUrl: shortUrl, dmOpenerMessage: dmMessage || undefined });
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
    // Pré-sélectionner le LM actuellement associé au post
    if (!selectedLmId && post.descLmLmId) {
      setSelectedLmId(post.descLmLmId);
    } else if (!selectedLmId && post.lmKeyword) {
      const linked = leadMagnets.find(lm => lm.keyword === post.lmKeyword);
      if (linked) setSelectedLmId(linked.id);
    }
    setEditing(true);
  };
  const handleCancelEdit = () => {
    if (dmEdited) { setConfirmLeave(true); return; }
    setEditing(false);
    setDmMessage(savedDmMessage);
  };
  const handleConfirmLeave = () => { setEditing(false); setDmMessage(savedDmMessage); setDmEdited(false); setConfirmLeave(false); };

  // États pour l'édition inline des DMs (sans passer par mode édition complet)
  const [dm1Text, setDm1Text] = useState(post.dmLmMessage || `👋 Voici le lien comme promis ! {{lien_lm}}`);
  const [dm1Saved, setDm1Saved] = useState(true);
  const [dm1Saving, setDm1Saving] = useState(false);
  const [dm2Text, setDm2Text] = useState(savedDmMessage);
  const [dm2Saved, setDm2Saved] = useState(true);
  const [dm2Saving, setDm2Saving] = useState(false);

  const [dm1Error, setDm1Error] = useState<string | null>(null);
  const [dm2Error, setDm2Error] = useState<string | null>(null);

  const saveDm1 = async (msg: string) => {
    setDm1Saving(true); setDm1Error(null);
    try {
      const res = await fetch('/api/client/content-links', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content_id: post.id, platform: post.platform, dm_lm_message: msg }),
      });
      if (!res.ok) throw new Error('Erreur sauvegarde');
      onPostUpdated(post.id, { dmLmMessage: msg });
      setDm1Saved(true);
    } catch (e: any) { setDm1Error(e.message || 'Erreur'); } finally { setDm1Saving(false); }
  };

  const saveDm2 = async (msg: string) => {
    setDm2Saving(true); setDm2Error(null);
    try {
      const res = await fetch('/api/client/content-links', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content_id: post.id, platform: post.platform, dm_opener_message: msg }),
      });
      if (!res.ok) throw new Error('Erreur sauvegarde');
      onPostUpdated(post.id, { dmOpenerMessage: msg });
      setDm2Saved(true);
    } catch (e: any) { setDm2Error(e.message || 'Erreur'); } finally { setDm2Saving(false); }
  };

  if ((result || isExisting) && !editing) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Statut LM */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--green-soft)', borderRadius: 8, padding: '10px 14px' }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="20 6 9 17 4 12"/></svg>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--green)' }}>Lead magnet associé</span>
          <span style={{ fontSize: 11, color: MUTED, marginLeft: 8 }}>Mot-clé : <strong style={{ color: INK }}>#{keyword || post.lmKeyword}</strong></span>
        </div>
        <div style={{ fontSize: 10, color: MUTED, textAlign: 'right', lineHeight: 1.4, flexShrink: 0, maxWidth: 200 }}>
          Actif — DM envoyé automatiquement à chaque commentaire
        </div>
      </div>

      {/* DM 1 — avec le LM */}
      {lmUrl && (
        <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', borderBottom: `1px solid ${BORDER}`, background: BG, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span style={{ fontSize: 12, fontWeight: 600, color: INK }}>DM 1</span>
              <span style={{ fontSize: 11, color: MUTED, marginLeft: 6 }}>envoyé avec le lead magnet</span>
            </div>
          </div>
          <div style={{ padding: '12px 14px' }}>
            <Dm1Editor
              value={dm1Text}
              onChange={v => { setDm1Text(v); setDm1Saved(false); }}
              saved={dm1Saved}
              blue={BLUE} blueSoft={BLUE_SOFT} border={BORDER} amber={AMBER} bg={BG} ink={INK}
            />
            {dm1Error && <div style={{ fontSize: 11, color: RED, background: 'var(--red-soft)', borderRadius: 6, padding: '5px 10px', marginTop: 6 }}>{dm1Error}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <button onClick={() => saveDm1(dm1Text)} disabled={dm1Saving || dm1Saved}
                style={{ padding: '4px 12px', fontSize: 11, fontWeight: 600, borderRadius: 6, border: 'none', background: dm1Saved ? 'var(--green)' : BLUE, color: '#fff', cursor: dm1Saved ? 'default' : 'pointer', transition: 'background .2s' }}>
                {dm1Saving ? '...' : dm1Saved ? '✓ Sauvegardé' : 'Sauvegarder'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DM 2 — message d'ouverture */}
      <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', borderBottom: `1px solid ${BORDER}`, background: BG }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: INK }}>DM 2</span>
          <span style={{ fontSize: 11, color: MUTED, marginLeft: 6 }}>message d'ouverture — envoyé juste après</span>
        </div>
        <div style={{ padding: '12px 14px' }}>
          <textarea
            value={dm2Text}
            onChange={e => { setDm2Text(e.target.value); setDm2Saved(false); }}
            placeholder={`Ex : "C'est quoi ton objectif principal en ce moment ?"`}
            rows={3}
            style={{ width: '100%', padding: '9px 11px', fontSize: 12, borderRadius: 7, border: `1px solid ${dm2Saved ? BORDER : AMBER}`, background: BG, color: INK, outline: 'none', resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.5, fontFamily: 'inherit' }}
          />
          {dm2Error && <div style={{ fontSize: 11, color: RED, background: 'var(--red-soft)', borderRadius: 6, padding: '5px 10px', marginTop: 6 }}>{dm2Error}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            <button onClick={() => saveDm2(dm2Text)} disabled={dm2Saving || dm2Saved}
              style={{ padding: '4px 12px', fontSize: 11, fontWeight: 600, borderRadius: 6, border: 'none', background: dm2Saved ? 'var(--green)' : BLUE, color: '#fff', cursor: dm2Saved ? 'default' : 'pointer', transition: 'background .2s' }}>
              {dm2Saving ? '...' : dm2Saved ? '✓ Sauvegardé' : 'Sauvegarder'}
            </button>
          </div>
        </div>
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
          <DissociateButton postId={post.id} platform={post.platform} onPostUpdated={onPostUpdated} onDissociated={() => { setResult(null); setEditing(false); setKeyword(''); setSelectedLmId(''); setDm1Text(`👋 Voici le lien comme promis ! {{lien_lm}}`); setDm1Saved(true); setDm2Text(''); setDm2Saved(true); }} />
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

      {/* DM 1 — éditable dès l'association */}
      <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, padding: '12px 14px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: INK, marginBottom: 6 }}>DM 1 — envoyé avec le Lead Magnet</div>
        <Dm1Editor
          value={dm1Text}
          onChange={v => setDm1Text(v)}
          saved={true}
          blue={BLUE} blueSoft={BLUE_SOFT} border={BORDER} amber={AMBER} bg={BG} ink={INK}
        />
      </div>

      {/* Message d'ouverture */}
      <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, padding: '12px 14px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: INK, marginBottom: 4 }}>Message d'ouverture de discussion</div>
        <div style={{ fontSize: 11, color: MUTED, marginBottom: 8, lineHeight: 1.5 }}>
          Ce message est envoyé automatiquement en DM juste après l'envoi du LM. Il s'envoie sans que tu n'aies rien à faire.
        </div>
        <textarea
          value={dmMessage}
          onChange={e => handleDmChange(e.target.value)}
          placeholder={`Ex : "Salut ! Tu as bien reçu le guide ? Si tu as des questions je suis là 😊"`}
          rows={3}
          style={{ width: '100%', padding: '10px 12px', fontSize: 12, borderRadius: 8, border: `1px solid ${BORDER}`, background: BG, color: INK, outline: 'none', resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.5, fontFamily: 'inherit' }}
        />
      </div>

      {error && <div style={{ fontSize: 12, color: RED, background: 'var(--red-soft)', borderRadius: 6, padding: '8px 10px' }}>{error}</div>}

      <button onClick={generate} disabled={loading || !canGenerate || !keyword.trim() || (lmMode === 'existing' ? !selectedLmId : !isValidUrl(newLmUrl))}
        style={{ padding: '10px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none', background: 'var(--green)', color: '#fff', cursor: 'pointer', opacity: loading || !canGenerate || !keyword.trim() || (lmMode === 'existing' ? !selectedLmId : !isValidUrl(newLmUrl)) ? 0.4 : 1, transition: 'opacity .15s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
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

      {error && <div style={{ fontSize: 12, color: RED, background: 'var(--red-soft)', borderRadius: 6, padding: '8px 10px' }}>{error}</div>}

      <button onClick={generate} disabled={loading || !canGenerate || !keyword.trim() || (lmMode === 'existing' ? !selectedLmId : !isValidUrl(newLmUrl))}
        style={{ padding: '10px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none', background: 'var(--green)', color: '#fff', cursor: 'pointer', opacity: loading || !canGenerate || !keyword.trim() || (lmMode === 'existing' ? !selectedLmId : !isValidUrl(newLmUrl)) ? 0.4 : 1, transition: 'opacity .15s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        {loading ? <><Spinner /> Génération...</> : 'Associer le lead magnet'}
      </button>
    </div>
  );
}

function PanneauActions({ post, profileId, domains, domainsLoaded, calendlyUrl, leadMagnets, onLmCreated, onPostUpdated }: {
  post: Post; profileId: string; domains: ShortDomain[]; domainsLoaded: boolean;
  calendlyUrl: string; leadMagnets: LeadMagnet[]; onLmCreated: (lm: LeadMagnet) => void;
  onPostUpdated: (postId: string, patch: Partial<Post>) => void;
}) {
  const domain = domains[0]?.hostname || '';
  const canGenerate = domainsLoaded && !!domain;
  const [activeTab, setActiveTab] = useState<'desc' | 'lm'>('desc');

  useEffect(() => { setActiveTab('desc'); }, [post.id]);

  const tabs = [
    { key: 'desc', label: `Lien description${post.hasDescLink ? ' ✓' : ''}` },
    { key: 'lm', label: `Lead magnet${post.hasLeadMagnet ? ' ✓' : ''}` },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header post */}
      <div style={{ padding: '14px 20px', borderBottom: `1px solid ${BORDER}` }}>
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
          <button key={tab.key} onClick={() => setActiveTab(tab.key as 'desc' | 'lm')} style={{
            flex: 1, padding: '11px 0', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer',
            background: activeTab === tab.key ? SURFACE : 'transparent',
            color: activeTab === tab.key ? INK : MUTED,
            borderBottom: activeTab === tab.key ? `2px solid ${BLUE}` : '2px solid transparent',
            transition: 'all .15s',
          }}>{tab.label}</button>
        ))}
      </div>

      {/* Contenu */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
        {activeTab === 'desc' && <TabDesc post={post} profileId={profileId} domain={domain} canGenerate={canGenerate} calendlyUrl={calendlyUrl} leadMagnets={leadMagnets} onPostUpdated={onPostUpdated} />}
        {activeTab === 'lm' && <TabLm post={post} profileId={profileId} domain={domain} canGenerate={canGenerate} leadMagnets={leadMagnets} onLmCreated={onLmCreated} onPostUpdated={onPostUpdated} />}
      </div>
    </div>
  );
}

// ─── Panneau droit : Calendly prospect ───────────────────────────────────────

function PanneauCalendlyProspect({ profileId, domains, domainsLoaded, calendlyUrl, posts }: {
  profileId: string; domains: ShortDomain[]; domainsLoaded: boolean;
  calendlyUrl: string; posts: Post[];
}) {
  const domain = domains[0]?.hostname || '';
  const canGenerate = domainsLoaded && !!domain;
  const hasCalendly = calendlyUrl.trim().startsWith('http');

  // Pseudo Instagram
  const [username, setUsername] = useState('');
  const [usernameSearch, setUsernameSearch] = useState('');
  const [showLeads, setShowLeads] = useState(false);
  const [leads, setLeads] = useState<{ ig_username: string; detected_at: string; keyword_matched: string; media_id: string | null }[]>([]);
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

  // Charge l'historique des liens générés
  useEffect(() => {
    fetch('/api/client/prospect-links')
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
        utmSource: domain, utmMedium: 'dm',
        utmCampaign: `prospect-${us}`,
        utmContent: resolvedPostId,
        path: us,
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
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
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
          <button onClick={() => { setResult(null); setUsername(''); setUsernameSearch(''); setPostId(''); setPostMode('auto'); }}
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 0, border: `1px solid ${BORDER}`, borderRadius: 8, background: BG, overflow: 'hidden' }}>
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
                    <div style={{ padding: '10px 12px', fontSize: 12, color: FAINT }}>Aucun lead trouvé</div>
                  ) : filteredLeads.map(l => (
                    <div key={l.ig_username} onMouseDown={() => { setUsername(l.ig_username); setUsernameSearch(''); setShowLeads(false); if (l.media_id) { setPostId(l.media_id); setPostMode('lead'); } }}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', cursor: 'pointer', fontSize: 12, color: INK, borderBottom: `1px solid ${BORDER}` }}
                      onMouseEnter={e => (e.currentTarget.style.background = SURFACE2)}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                      <span style={{ fontWeight: 600 }}>@{l.ig_username}</span>
                      <span style={{ fontSize: 10, color: FAINT }}>{l.keyword_matched}</span>
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
                style={{ padding: '10px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none', background: BLUE, color: '#fff', cursor: 'pointer', opacity: loading || !canGenerate || !hasCalendly || !username.trim() ? 0.4 : 1, transition: 'opacity .15s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
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
            <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Liens Calendly générés <span style={{ fontWeight: 400, color: FAINT }}>({history.length})</span></div>
          </div>
          <input
            value={historySearch}
            onChange={e => setHistorySearch(e.target.value)}
            placeholder="Rechercher un prospect..."
            style={{ width: '100%', padding: '7px 10px', fontSize: 12, borderRadius: 7, border: `1px solid ${BORDER}`, background: BG, color: INK, outline: 'none', boxSizing: 'border-box' }}
          />
          {history.filter(h => !historySearch || h.ig_username.toLowerCase().includes(historySearch.toLowerCase())).map(h => {
            const post = posts.find(p => p.id === h.content_id);
            const copied = historyCopied === h.id;
            const isDeleting = deletingId === h.id;
            return (
              <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, background: SURFACE2, border: `1px solid ${BORDER}`, opacity: isDeleting ? 0.4 : 1, transition: 'opacity .15s' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: INK }}>@{h.ig_username}</span>
                    {post && <span style={{ fontSize: 10, color: FAINT }}>· {post.platform} · {post.caption.slice(0, 25)}...</span>}
                  </div>
                  <div style={{ fontSize: 10, color: FAINT }}>
                    {new Date(h.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })} à {new Date(h.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                <button
                  onClick={() => { navigator.clipboard.writeText(h.short_url); setHistoryCopied(h.id); setTimeout(() => setHistoryCopied(null), 2000); }}
                  style={{ flexShrink: 0, fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 6, border: `1px solid ${copied ? 'var(--green)' : BORDER}`, background: copied ? 'var(--green-soft)' : BG, color: copied ? 'var(--green)' : MUTED, cursor: 'pointer', transition: 'all .15s' }}>
                  {copied ? '✓ Copié' : 'Copier'}
                </button>
                <button
                  onClick={async () => {
                    if (isDeleting) return;
                    setDeletingId(h.id);
                    try {
                      await fetch(`/api/client/prospect-links?id=${h.id}`, { method: 'DELETE' });
                      setHistory(prev => prev.filter(x => x.id !== h.id));
                    } finally { setDeletingId(null); }
                  }}
                  title="Supprimer ce lien"
                  style={{ flexShrink: 0, width: 24, height: 24, borderRadius: 6, border: 'none', background: 'none', color: MUTED, cursor: 'pointer', fontSize: 14, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
                  ×
                </button>
              </div>
            );
          })}
        </div>
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
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color: INK, marginBottom: 2 }}>Mes lead magnets</div>
        <div style={{ fontSize: 12, color: FAINT }}>Crée et gère ta bibliothèque de LM. Tu peux les réutiliser sur n'importe quel contenu.</div>
      </div>

      {/* Formulaire création */}
      <div style={{ borderRadius: 10, border: `1px solid ${BORDER}`, overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', borderBottom: `1px solid ${BORDER}`, background: BG }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Nouveau lead magnet</span>
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
            style={{ padding: '8px', fontSize: 12, fontWeight: 600, borderRadius: 7, border: 'none', background: 'var(--green)', color: '#fff', cursor: !isValidUrl(url) || saving ? 'not-allowed' : 'pointer', opacity: !isValidUrl(url) || saving ? 0.4 : 1, transition: 'opacity .15s' }}>
            {saving ? 'Sauvegarde...' : '+ Ajouter'}
          </button>
        </div>
      </div>

      {/* Liste */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
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
                        style={{ flex: 1, padding: '7px', fontSize: 12, fontWeight: 700, borderRadius: 7, border: 'none', background: BLUE, color: '#fff', cursor: 'pointer', opacity: editSaving || !isValidUrl(editUrl) ? 0.5 : 1 }}>
                        {editSaving ? '...' : 'Sauvegarder'}
                      </button>
                      <button onClick={() => setEditingId(null)}
                        style={{ padding: '7px 12px', fontSize: 12, fontWeight: 600, borderRadius: 7, border: `1px solid ${BORDER}`, background: 'none', color: MUTED, cursor: 'pointer' }}>
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

type RightView = { type: 'post'; post: Post } | { type: 'prospect' } | { type: 'lm-library' } | null;

export default function PageLiens() {
  const { user } = useUser();
  const profileId = user?.id || '';

  const [domains, setDomains] = useState<ShortDomain[]>([]);
  const [domainsLoaded, setDomainsLoaded] = useState(false);
  const [posts, setPosts] = useState<Post[]>([]);
  const [postsLoading, setPostsLoading] = useState(true);
  const [calendlyUrl, setCalendlyUrl] = useState('');
  const [leadMagnets, setLeadMagnets] = useState<LeadMagnet[]>([]);
  const [lmLoading, setLmLoading] = useState(true);
  const [contentLinks, setContentLinks] = useState<ContentLink[]>([]);
  const [rightView, setRightView] = useState<RightView>(null);
  const [paramOpen, setParamOpen] = useState(false);
  const [filterPlatform, setFilterPlatform] = useState<'all' | 'IG' | 'YT'>('all'); // 'all' = pas de filtre
  const [search, setSearch] = useState('');

  // Charger domaines + settings + lead magnets
  useEffect(() => {
    if (!profileId) return;
    fetch(`/api/shortio/domains?profileId=${profileId}`)
      .then(r => r.json())
      .then(data => { setDomains(data.domains?.length ? data.domains : []); })
      .catch(() => setDomains([]))
      .finally(() => setDomainsLoaded(true));

    fetch('/api/client/settings')
      .then(r => r.json())
      .then(data => { if (data.calendly_url) setCalendlyUrl(data.calendly_url); })
      .catch(() => {});

    fetch('/api/client/lead-magnets')
      .then(r => r.json())
      .then(data => { setLeadMagnets(data.lead_magnets ?? []); })
      .catch(() => {})
      .finally(() => setLmLoading(false));

    fetch('/api/client/content-links')
      .then(r => r.json())
      .then(data => { setContentLinks(data.content_links ?? []); })
      .catch(() => {});
  }, [profileId]);

  // Charger posts IG + YT + liens Short.io existants pour croiser hasDescLink / hasLeadMagnet
  useEffect(() => {
    if (!profileId) return;
    let cancelled = false;
    let igDone = false; let ytDone = false; let linksDone = false;
    let igPosts: Post[] = [];
    let ytPosts: Post[] = [];
    let shortioLinks: any[] = [];

    const enrich = () => {
      if (!igDone || !ytDone || !linksDone) return;
      const all = [...igPosts, ...ytPosts].map(post => {
        const descLink = shortioLinks.find(l => l.postId === post.id && l.linkType === 'post');
        const lmLink = shortioLinks.find(l => l.postId === post.id && l.linkType === 'leadmagnet');
        return {
          ...post,
          hasDescLink: !!descLink,
          descLinkUrl: descLink?.shortUrl || undefined,
          hasLeadMagnet: !!lmLink,
          lmKeyword: lmLink?.utmCampaign?.replace('lm-', '') || undefined,
        };
      });
      if (cancelled) return;
      setPosts(all);
      setPostsLoading(false);
    };

    fetch(`/api/instagram/stats?profileId=${profileId}`)
      .then(r => r.json())
      .then(data => {
        igPosts = (data.posts || []).map((p: any) => ({ id: p.id, caption: (p.caption || 'Publication Instagram').slice(0, 60), platform: 'IG' as const, thumbnail: p.thumbnail, permalink: p.permalink || null }));
      }).catch(() => {}).finally(() => { igDone = true; enrich(); });

    fetch(`/api/youtube/stats?profileId=${profileId}`)
      .then(r => r.json())
      .then(data => {
        ytPosts = (data.videos || []).map((v: any) => ({ id: v.id, caption: (v.title || 'Vidéo YouTube').slice(0, 60), platform: 'YT' as const, thumbnail: v.thumbnail }));
      }).catch(() => {}).finally(() => { ytDone = true; enrich(); });

    fetch(`/api/shortio/stats?profileId=${profileId}`)
      .then(r => r.json())
      .then(data => {
        shortioLinks = (data.links || []).map((l: any) => {
          try {
            const u = new URL(l.originalUrl || '');
            return {
              ...l,
              postId: u.searchParams.get('utm_content') || null,
              linkType: u.searchParams.get('utm_medium') || null,
            };
          } catch { return l; }
        });
      })
      .catch(() => {}).finally(() => { linksDone = true; enrich(); });

    return () => { cancelled = true; };
  }, [profileId]);

  // Enrichit les posts avec content_links — se déclenche quand l'un ou l'autre arrive
  useEffect(() => {
    if (!contentLinks.length || !posts.length) return;
    setPosts(prev => prev.map(post => {
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
        dmOpenerMessage: cl.dm_opener_message || undefined,
        dmLmMessage: cl.dm_lm_message || undefined,
      };
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentLinks, postsLoading]);

  const handlePostUpdated = (postId: string, patch: Partial<Post>) => {
    setPosts(prev => prev.map(p => p.id === postId ? { ...p, ...patch } : p));
    // Mettre à jour rightView si c'est le post sélectionné
    setRightView(prev => {
      if (!prev || prev.type !== 'post' || prev.post.id !== postId) return prev;
      return { type: 'post', post: { ...prev.post, ...patch } };
    });
  };

  const filteredPosts = posts.filter(p => {
    if (filterPlatform !== 'all' && p.platform !== filterPlatform) return false;
    if (search.trim() && !p.caption.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // Résout le post depuis l'array live (enrichi) plutôt que rightView (copie figée)
  const selectedPost = rightView?.type === 'post'
    ? (posts.find(p => p.id === rightView.post.id) ?? rightView.post)
    : null;

  return (
    <>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      <ModalParametres
        open={paramOpen} onClose={() => { setParamOpen(false); }}
        profileId={profileId} domains={domains} domainsLoaded={domainsLoaded}
        onCalendlyChange={setCalendlyUrl} initialCalendly={calendlyUrl}
        leadMagnets={leadMagnets}
        onLmUpdated={lm => setLeadMagnets(prev => prev.map(l => l.id === lm.id ? lm : l))}
      />

      <div className="liens-shell">

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderBottom: `1px solid ${BORDER}`, background: SURFACE, flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: INK, letterSpacing: '-0.01em' }}>Gérer mes liens</div>
            <div style={{ fontSize: 11, color: FAINT, marginTop: 1 }}>Liens Short.io trackés pour chaque contenu et chaque prospect.</div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setRightView({ type: 'lm-library' })} style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', fontSize: 12, fontWeight: 600, borderRadius: 7, cursor: 'pointer', transition: 'all .15s',
              border: `1.5px solid ${rightView?.type === 'lm-library' ? 'var(--green)' : BORDER}`,
              background: rightView?.type === 'lm-library' ? 'var(--green-soft)' : 'transparent',
              color: rightView?.type === 'lm-library' ? 'var(--green)' : MUTED,
            }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              Lead Magnets
              {leadMagnets.length > 0 && <span style={{ fontSize: 10, fontWeight: 700, background: rightView?.type === 'lm-library' ? 'var(--green)' : SURFACE2, color: rightView?.type === 'lm-library' ? '#fff' : MUTED, borderRadius: 10, padding: '1px 5px', minWidth: 16, textAlign: 'center' }}>{leadMagnets.length}</span>}
            </button>
            <button onClick={() => setParamOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', fontSize: 12, fontWeight: 600, borderRadius: 7, border: `1px solid ${leadMagnets.some(lm => (lm.bio_ig_url && lm.bio_ig_source_url && lm.bio_ig_source_url !== lm.url) || (lm.bio_yt_url && lm.bio_yt_source_url && lm.bio_yt_source_url !== lm.url)) ? AMBER : BORDER}`, background: 'transparent', color: MUTED, cursor: 'pointer', position: 'relative', transition: 'all .15s' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              Paramètres
              {leadMagnets.some(lm => (lm.bio_ig_url && lm.bio_ig_source_url && lm.bio_ig_source_url !== lm.url) || (lm.bio_yt_url && lm.bio_yt_source_url && lm.bio_yt_source_url !== lm.url)) && (
                <span style={{ position: 'absolute', top: -6, right: -6, width: 14, height: 14, borderRadius: '50%', background: AMBER, border: '2px solid var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, color: '#fff', fontWeight: 700 }}>!</span>
              )}
            </button>
          </div>
        </div>

        {/* Body : 2 colonnes */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>

          {/* Colonne gauche */}
          <div style={{ width: 380, flexShrink: 0, borderRight: `1px solid ${BORDER}`, background: BG, display: 'flex', flexDirection: 'column', minHeight: 0 }}>

            {/* Bouton Calendly prospect */}
            <div style={{ padding: '8px 12px', borderBottom: `1px solid ${BORDER}`, flexShrink: 0 }}>
              <button onClick={() => setRightView({ type: 'prospect' })} style={{
                width: '100%', padding: '8px 12px', fontSize: 12, fontWeight: 600, borderRadius: 7, cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 7,
                border: `1.5px solid ${rightView?.type === 'prospect' ? BLUE : BORDER}`,
                background: rightView?.type === 'prospect' ? BLUE_SOFT : 'transparent',
                color: rightView?.type === 'prospect' ? BLUE : MUTED, transition: 'all .15s',
              }}>
                📅 Lien Calendly prospect
              </button>
            </div>

            {/* Barre recherche + filtres */}
            <div style={{ padding: '10px 14px', borderBottom: `1px solid ${BORDER}`, display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher un contenu…"
                style={{ width: '100%', padding: '7px 10px', fontSize: 12, borderRadius: 8, border: `1px solid ${BORDER}`, background: SURFACE, color: INK, outline: 'none', boxSizing: 'border-box' }} />
              <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                {(['all', 'IG', 'YT'] as const).map(f => {
                  const active = filterPlatform === f;
                  return (
                    <button key={f} onClick={() => setFilterPlatform(f)} style={{
                      display: 'flex', alignItems: 'center', gap: 5, padding: '4px 11px', fontSize: 11, fontWeight: 600, borderRadius: 20, cursor: 'pointer', border: 'none',
                      background: active ? INK : SURFACE2, color: active ? 'var(--bg)' : MUTED, transition: 'all .12s',
                    }}>
                      {f === 'IG' && <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>}
                      {f === 'YT' && <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>}
                      {f === 'all' ? 'Tous' : f === 'IG' ? 'Instagram' : 'YouTube'}
                    </button>
                  );
                })}
                <span style={{ marginLeft: 'auto', fontSize: 10, color: FAINT }}>
                  {filteredPosts.length} contenu{filteredPosts.length !== 1 ? 's' : ''}
                </span>
              </div>
            </div>

            {/* Liste contenus */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {postsLoading ? (
                <div style={{ padding: '20px 16px', fontSize: 12, color: FAINT, textAlign: 'center' }}>Chargement...</div>
              ) : filteredPosts.length === 0 ? (
                <div style={{ padding: '20px 16px', fontSize: 12, color: FAINT, textAlign: 'center' }}>
                  {search ? 'Aucun résultat.' : 'Aucun contenu trouvé.'}
                </div>
              ) : filteredPosts.map(post => {
                const isSelected = selectedPost?.id === post.id;
                const hasDesc = !!post.hasDescLink;
                const hasLm = !!post.hasLeadMagnet;
                return (
                  <div key={post.id} onClick={() => setRightView({ type: 'post', post })}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', cursor: 'pointer', background: isSelected ? BLUE_SOFT : 'transparent', borderLeft: `3px solid ${isSelected ? BLUE : 'transparent'}`, transition: 'all .1s' }}>
                    <div style={{ width: 36, height: 36, borderRadius: 6, background: SURFACE2, flexShrink: 0, overflow: 'hidden' }}>
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
                      <div style={{ fontSize: 12, fontWeight: 500, color: isSelected ? BLUE : INK, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 3 }}>{post.caption}</div>
                      <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: post.platform === 'IG' ? '#c2185b' : '#d32f2f', opacity: 0.8 }}>{post.platform}</span>
                        <span style={{ width: 3, height: 3, borderRadius: '50%', background: hasDesc ? BLUE : FAINT, flexShrink: 0, opacity: hasDesc ? 1 : 0.4 }} title={hasDesc ? 'Lien description généré' : 'Pas de lien description'} />
                        {post.platform === 'IG' && (
                          hasLm
                            ? <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--green)', background: 'var(--green-soft)', borderRadius: 4, padding: '1px 5px' }}>{post.lmKeyword ? `#${post.lmKeyword}` : 'LM'}</span>
                            : <span style={{ width: 3, height: 3, borderRadius: '50%', background: FAINT, flexShrink: 0, opacity: 0.4 }} title="Pas de lead magnet" />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Colonne droite */}
          <div style={{ flex: 1, minWidth: 0, background: SURFACE, overflowY: 'auto' }}>
            {rightView === null ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 10, padding: 40, textAlign: 'center' }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={FAINT} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                <div style={{ fontSize: 14, fontWeight: 600, color: INK, marginTop: 2 }}>Sélectionne un contenu</div>
                <div style={{ fontSize: 12, color: MUTED, maxWidth: 300, lineHeight: 1.6 }}>
                  Clique sur un contenu à gauche pour générer un lien description ou un lien lead magnet.
                  <br /><br />
                  Ou utilise <strong>Calendly prospect</strong> pour un lien DM unique, et <strong>Lead Magnets</strong> pour gérer ta bibliothèque.
                </div>
              </div>
            ) : rightView.type === 'lm-library' ? (
              <PanneauLeadMagnets
                leadMagnets={leadMagnets} lmLoading={lmLoading}
                onCreated={lm => setLeadMagnets(prev => [lm, ...prev])}
                onDeleted={id => setLeadMagnets(prev => prev.filter(l => l.id !== id))}
                onUpdated={lm => setLeadMagnets(prev => prev.map(l => l.id === lm.id ? lm : l))}
              />
            ) : rightView.type === 'prospect' ? (
              <PanneauCalendlyProspect profileId={profileId} domains={domains} domainsLoaded={domainsLoaded} calendlyUrl={calendlyUrl} posts={posts} />
            ) : (
              <PanneauActions
                post={selectedPost || rightView.post} profileId={profileId} domains={domains} domainsLoaded={domainsLoaded}
                calendlyUrl={calendlyUrl} leadMagnets={leadMagnets}
                onLmCreated={lm => setLeadMagnets(prev => [lm, ...prev])}
                onPostUpdated={handlePostUpdated}
              />
            )}
          </div>
        </div>
      </div>
    </>
  );
}
