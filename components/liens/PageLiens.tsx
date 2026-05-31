'use client';

import { useState, useEffect, useRef } from 'react';
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
  hasDescLink?: boolean;
  hasLeadMagnet?: boolean;
  descLinkUrl?: string;
  lmKeyword?: string;
}

interface LeadMagnet {
  id: string;
  name: string;
  url: string;
  usedOn: string[];
  created_at?: string;
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
  return url.trim().length > 3;
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

function ModalParametres({ open, onClose, profileId, domains, domainsLoaded, onCalendlyChange, initialCalendly }: {
  open: boolean; onClose: () => void;
  profileId: string; domains: ShortDomain[]; domainsLoaded: boolean;
  onCalendlyChange: (url: string) => void; initialCalendly: string;
}) {
  const [calendlyUrl, setCalendlyUrl] = useState(initialCalendly);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bioIg, setBioIg] = useState<string | null>(null);
  const [bioYt, setBioYt] = useState<string | null>(null);
  const [genIg, setGenIg] = useState(false);
  const [genYt, setGenYt] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const domain = domains[0]?.hostname || '';
  const canGenerate = domainsLoaded && !!domain;
  const isValid = calendlyUrl.trim().startsWith('http');

  useEffect(() => { setCalendlyUrl(initialCalendly); }, [initialCalendly]);

  const save = async () => {
    if (!isValid) return;
    setSaving(true); setError(null);
    try {
      await fetch('/api/client/settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ calendly_url: calendlyUrl.trim() }) });
      setSaved(true); onCalendlyChange(calendlyUrl.trim());
      setTimeout(() => setSaved(false), 2500);
    } catch { setError('Erreur sauvegarde'); } finally { setSaving(false); }
  };

  const genBio = async (platform: 'instagram' | 'youtube', setResult: (v: string) => void, setLoading: (v: boolean) => void) => {
    if (!isValid || !canGenerate) return;
    setLoading(true); setError(null);
    try {
      const { shortUrl } = await callShortio({ profileId, domainId: domain, originalUrl: calendlyUrl.trim(), title: `Bio ${platform === 'instagram' ? 'Instagram' : 'YouTube'}`, utmSource: domain, utmMedium: 'bio', utmCampaign: `bio-${platform}`, path: `bio-${platform === 'instagram' ? 'ig' : 'yt'}` });
      setResult(shortUrl);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };

  if (!open) return null;

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(26,24,21,.45)', zIndex: 9999, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: SURFACE, borderRadius: 14, padding: 24, width: 420, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 8px 40px rgba(0,0,0,.18)', border: `1px solid ${BORDER}` }}>
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
          <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Liens bio permanents</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              { platform: 'instagram' as const, label: '📸 Bio Instagram', result: bioIg, setResult: setBioIg, loading: genIg, setLoading: setGenIg, path: 'bio-ig' },
              { platform: 'youtube' as const, label: '▶️ Bio YouTube', result: bioYt, setResult: setBioYt, loading: genYt, setLoading: setGenYt, path: 'bio-yt' },
            ].map(({ platform, label, result, setResult, loading, setLoading }) => (
              <div key={platform} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 8, background: SURFACE2, border: `1px solid ${BORDER}` }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>{label}</div>
                  <div style={{ fontSize: 11, color: result ? BLUE : FAINT, fontWeight: result ? 600 : 400, wordBreak: 'break-all' }}>
                    {result || (domain ? `${domain}/bio-${platform === 'instagram' ? 'ig' : 'yt'}` : '—')}
                  </div>
                </div>
                {result ? <CopyBtn url={result} /> :
                  <button onClick={() => genBio(platform, setResult, setLoading)} disabled={loading || !isValid || !canGenerate}
                    style={{ padding: '5px 12px', fontSize: 11, fontWeight: 600, borderRadius: 6, border: 'none', background: BLUE, color: '#fff', cursor: !isValid || !canGenerate || loading ? 'not-allowed' : 'pointer', opacity: !isValid || !canGenerate || loading ? 0.5 : 1, whiteSpace: 'nowrap' }}>
                    {loading ? '...' : 'Générer'}
                  </button>}
              </div>
            ))}
          </div>
          {!isValid && <div style={{ fontSize: 11, color: AMBER, marginTop: 8 }}>⚠ Sauvegarde d'abord ton lien Calendly.</div>}
          {!canGenerate && domainsLoaded && <div style={{ fontSize: 11, color: RED, marginTop: 8 }}>⚠ Short.io non connecté — va dans Réglages.</div>}
          {error && <div style={{ fontSize: 11, color: RED, background: 'var(--red-soft)', borderRadius: 6, padding: '6px 10px', marginTop: 8 }}>{error}</div>}
        </div>
      </div>
    </div>
  );
}

// ─── Panneau droit : actions pour un contenu ──────────────────────────────────

function PanneauActions({ post, profileId, domains, domainsLoaded, calendlyUrl, leadMagnets, onLmCreated }: {
  post: Post; profileId: string; domains: ShortDomain[]; domainsLoaded: boolean;
  calendlyUrl: string; leadMagnets: LeadMagnet[]; onLmCreated: (lm: LeadMagnet) => void;
}) {
  const domain = domains[0]?.hostname || '';
  const canGenerate = domainsLoaded && !!domain;
  const [activeTab, setActiveTab] = useState<'desc' | 'lm'>('desc');

  // --- Lien description ---
  const [destType, setDestType] = useState<'calendly' | 'leadmagnet' | 'custom'>('calendly');
  const [customUrl, setCustomUrl] = useState('');
  const [descResult, setDescResult] = useState<string | null>(null);
  const [descLoading, setDescLoading] = useState(false);
  const [descError, setDescError] = useState<string | null>(null);

  // --- Lead magnet ---
  const [lmMode, setLmMode] = useState<'existing' | 'new'>('existing');
  const [selectedLmId, setSelectedLmId] = useState('');
  const [newLmName, setNewLmName] = useState('');
  const [newLmUrl, setNewLmUrl] = useState('');
  const [keyword, setKeyword] = useState('');
  const [lmResult, setLmResult] = useState<string | null>(null);
  const [lmLoading, setLmLoading] = useState(false);
  const [lmError, setLmError] = useState<string | null>(null);

  // Reset quand le post change
  useEffect(() => {
    setDescResult(null); setDescError(null);
    setLmResult(null); setLmError(null);
    setKeyword(''); setSelectedLmId(''); setNewLmName(''); setNewLmUrl('');
    setActiveTab('desc');
  }, [post.id]);

  const generateDesc = async () => {
    const validationError = validateDescParams({ canGenerate, destType, calendlyUrl, customUrl });
    if (validationError) { setDescError(validationError); return; }
    const destUrl = destType === 'calendly' ? calendlyUrl.trim() : normalizeUrl(customUrl);
    setDescLoading(true); setDescError(null);
    try {
      const path = `desc-${slugify(post.caption.slice(0, 20))}-${post.id.slice(-4)}`;
      const { shortUrl } = await callShortio({ profileId, domainId: domain, originalUrl: destUrl, title: `Description — ${post.caption.slice(0, 40)}`, utmSource: domain, utmMedium: 'description', utmCampaign: destType, utmContent: post.id, path });
      setDescResult(shortUrl);
    } catch (e: any) { setDescError(e.message); } finally { setDescLoading(false); }
  };

  const generateLm = async () => {
    const validationError = validateLmParams({ canGenerate, keyword, lmMode, selectedLmId, newLmUrl });
    if (validationError) { setLmError(validationError); return; }
    let lmUrl = '';
    let lmName = '';
    if (lmMode === 'existing') {
      const lm = leadMagnets.find(l => l.id === selectedLmId);
      if (!lm) return;
      lmUrl = lm.url; lmName = lm.name;
    } else {
      if (!isValidUrl(newLmUrl)) return;
      lmUrl = normalizeUrl(newLmUrl); lmName = newLmName.trim() || keyword;
    }
    setLmLoading(true); setLmError(null);
    try {
      // Sauvegarder le LM en DB si nouveau
      if (lmMode === 'new') {
        const res = await fetch('/api/client/lead-magnets', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: lmName, url: lmUrl }),
        });
        const saved = await res.json();
        if (res.ok && saved.lead_magnet) {
          onLmCreated(saved.lead_magnet);
        }
      }
      const path = `lm-${slugify(keyword)}-${post.id.slice(-4)}`;
      const { shortUrl } = await callShortio({ profileId, domainId: domain, originalUrl: lmUrl, title: `LM — ${lmName} · ${post.caption.slice(0, 30)}`, utmSource: domain, utmMedium: 'leadmagnet', utmCampaign: `lm-${slugify(keyword)}`, utmContent: post.id, path });
      setLmResult(shortUrl);
    } catch (e: any) { setLmError(e.message); } finally { setLmLoading(false); }
  };

  const hasCalendly = calendlyUrl.trim().startsWith('http');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header post */}
      <div style={{ padding: '20px 24px 16px', borderBottom: `1px solid ${BORDER}` }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ width: 40, height: 40, borderRadius: 8, background: SURFACE2, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>
            {post.platform === 'IG' ? '📸' : '▶️'}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: INK, lineHeight: 1.3, marginBottom: 4 }}>{post.caption}</div>
            <div style={{ display: 'flex', gap: 5 }}>
              <Badge color={post.platform === 'IG' ? '#c2185b' : '#d32f2f'} bg={post.platform === 'IG' ? '#c2185b18' : '#d32f2f18'}>{post.platform}</Badge>
              {post.hasDescLink && <Badge color={BLUE} bg={BLUE_SOFT}>📝 Desc</Badge>}
              {post.hasLeadMagnet && <Badge color='var(--green)' bg='var(--green-soft)'>📄 LM</Badge>}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${BORDER}`, background: BG }}>
        {[{ key: 'desc', label: '📝 Lien description' }, { key: 'lm', label: '📄 Lead magnet' }].map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key as 'desc' | 'lm')} style={{
            flex: 1, padding: '12px 0', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer',
            background: activeTab === tab.key ? SURFACE : 'transparent',
            color: activeTab === tab.key ? INK : MUTED,
            borderBottom: activeTab === tab.key ? `2px solid ${BLUE}` : '2px solid transparent',
            transition: 'all .15s',
          }}>{tab.label}</button>
        ))}
      </div>

      {/* Contenu tab */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>

        {/* ── Tab description ── */}
        {activeTab === 'desc' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {descResult ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 12, color: MUTED }}>Lien créé — colle-le dans la description de ta publication.</div>
                <GeneratedUrlRow url={descResult} label="Lien description" />
                <button onClick={() => setDescResult(null)} style={{ fontSize: 12, color: MUTED, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0, textDecoration: 'underline' }}>
                  Générer un autre lien
                </button>
              </div>
            ) : (
              <>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Destination</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {[
                      { key: 'calendly', label: '📅 Calendly' },
                      { key: 'leadmagnet', label: '📄 Lead magnet' },
                      { key: 'custom', label: '🔗 URL custom' },
                    ].map(opt => (
                      <button key={opt.key} onClick={() => { setDestType(opt.key as any); setCustomUrl(''); }} style={{
                        padding: '6px 12px', fontSize: 12, fontWeight: 600, borderRadius: 20, cursor: 'pointer',
                        border: `1.5px solid ${destType === opt.key ? BLUE : BORDER}`,
                        background: destType === opt.key ? BLUE_SOFT : SURFACE,
                        color: destType === opt.key ? BLUE : INK,
                        transition: 'all .12s',
                      }}>{opt.label}</button>
                    ))}
                  </div>
                </div>

                {destType === 'calendly' && (
                  hasCalendly
                    ? <div style={{ fontSize: 11, color: MUTED, background: SURFACE2, borderRadius: 8, padding: '8px 12px' }}>→ <span style={{ fontWeight: 600, color: INK }}>{calendlyUrl}</span></div>
                    : <div style={{ fontSize: 12, color: AMBER, background: AMBER_SOFT, borderRadius: 8, padding: '10px 12px' }}>⚠ Configure ton lien Calendly dans Paramètres (⚙ en haut).</div>
                )}
                {destType === 'leadmagnet' && (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, marginBottom: 6 }}>Choisir un lead magnet</div>
                    {leadMagnets.length === 0
                      ? <div style={{ fontSize: 12, color: FAINT }}>Aucun LM créé — génères-en un via l'onglet Lead magnet.</div>
                      : <select value={customUrl} onChange={e => setCustomUrl(e.target.value)} style={{ width: '100%', padding: '8px 10px', fontSize: 12, borderRadius: 8, border: `1px solid ${BORDER}`, background: BG, color: INK }}>
                          <option value="">— Sélectionner —</option>
                          {leadMagnets.map(lm => <option key={lm.id} value={lm.url}>{lm.name}</option>)}
                        </select>}
                  </div>
                )}
                {destType === 'custom' && (
                  <input value={customUrl} onChange={e => setCustomUrl(e.target.value)} placeholder="https://..." style={{ width: '100%', padding: '8px 10px', fontSize: 12, borderRadius: 8, border: `1px solid ${BORDER}`, background: BG, color: INK, outline: 'none', boxSizing: 'border-box' }} />
                )}

                {descError && <div style={{ fontSize: 12, color: RED, background: 'var(--red-soft)', borderRadius: 6, padding: '8px 10px' }}>{descError}</div>}

                <button onClick={generateDesc} disabled={descLoading || !canGenerate || (destType === 'calendly' ? !hasCalendly : !customUrl.trim())}
                  style={{ padding: '10px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none', background: BLUE, color: '#fff', cursor: 'pointer', opacity: descLoading || !canGenerate || (destType === 'calendly' ? !hasCalendly : !customUrl.trim()) ? 0.4 : 1, transition: 'opacity .15s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  {descLoading ? <><Spinner /> Génération...</> : 'Générer le lien description'}
                </button>
              </>
            )}
          </div>
        )}

        {/* ── Tab lead magnet ── */}
        {activeTab === 'lm' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {lmResult ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 12, color: MUTED }}>
                  Lead magnet lié à ce contenu. Mot-clé déclencheur : <strong style={{ color: INK }}>#{keyword}</strong>
                </div>
                <GeneratedUrlRow url={lmResult} label="Lien lead magnet" />
                <button onClick={() => setLmResult(null)} style={{ fontSize: 12, color: MUTED, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0, textDecoration: 'underline' }}>
                  Générer un autre
                </button>
              </div>
            ) : (
              <>
                {/* Toggle existing / nouveau */}
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
                  <div>
                    {leadMagnets.length === 0 ? (
                      <div style={{ fontSize: 12, color: FAINT, background: SURFACE2, borderRadius: 8, padding: '12px', textAlign: 'center' }}>
                        Aucun lead magnet créé.<br />
                        <span style={{ color: BLUE, cursor: 'pointer', textDecoration: 'underline' }} onClick={() => setLmMode('new')}>Créer un nouveau LM</span>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, marginBottom: 2 }}>Choisir un lead magnet</div>
                        {leadMagnets.map(lm => (
                          <div key={lm.id} onClick={() => setSelectedLmId(lm.id)} style={{
                            padding: '10px 12px', borderRadius: 8, cursor: 'pointer', border: `1.5px solid ${selectedLmId === lm.id ? BLUE : BORDER}`,
                            background: selectedLmId === lm.id ? BLUE_SOFT : SURFACE, transition: 'all .12s',
                          }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: INK }}>{lm.name}</div>
                            <div style={{ fontSize: 11, color: FAINT, wordBreak: 'break-all' }}>{lm.url}</div>
                            {lm.usedOn.length > 0 && (
                              <div style={{ fontSize: 10, color: MUTED, marginTop: 3 }}>Utilisé sur {lm.usedOn.length} contenu{lm.usedOn.length > 1 ? 's' : ''}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {lmMode === 'new' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, marginBottom: 5 }}>Nom du LM <span style={{ fontWeight: 400, color: FAINT }}>(optionnel)</span></div>
                      <input value={newLmName} onChange={e => setNewLmName(e.target.value)} placeholder="Checklist closing, Guide tunnel…"
                        style={{ width: '100%', padding: '8px 10px', fontSize: 12, borderRadius: 8, border: `1px solid ${BORDER}`, background: BG, color: INK, outline: 'none', boxSizing: 'border-box' }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, marginBottom: 5 }}>URL du lead magnet</div>
                      <input value={newLmUrl} onChange={e => setNewLmUrl(e.target.value)} placeholder="https://notion.so/ton-guide"
                        style={{ width: '100%', padding: '8px 10px', fontSize: 12, borderRadius: 8, border: `1px solid ${BORDER}`, background: BG, color: INK, outline: 'none', boxSizing: 'border-box' }} />
                    </div>
                  </div>
                )}

                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, marginBottom: 5 }}>Mot-clé déclencheur</div>
                  <input value={keyword} onChange={e => setKeyword(e.target.value.toUpperCase().replace(/\s+/g, ''))} placeholder="GUIDE, CHECKLIST, TUNNEL…"
                    style={{ width: '100%', padding: '8px 10px', fontSize: 12, borderRadius: 8, border: `1px solid ${BORDER}`, background: BG, color: INK, outline: 'none', boxSizing: 'border-box', fontWeight: 600, letterSpacing: '0.04em' }} />
                  <div style={{ fontSize: 10, color: FAINT, marginTop: 4 }}>Quand quelqu'un commente ce mot, il reçoit le LM en DM automatiquement.</div>
                </div>

                {lmError && <div style={{ fontSize: 12, color: RED, background: 'var(--red-soft)', borderRadius: 6, padding: '8px 10px' }}>{lmError}</div>}

                <button onClick={generateLm} disabled={lmLoading || !canGenerate || !keyword.trim() || (lmMode === 'existing' ? !selectedLmId : !isValidUrl(newLmUrl))}
                  style={{ padding: '10px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none', background: 'var(--green)', color: '#fff', cursor: 'pointer', opacity: lmLoading || !canGenerate || !keyword.trim() || (lmMode === 'existing' ? !selectedLmId : !isValidUrl(newLmUrl)) ? 0.4 : 1, transition: 'opacity .15s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  {lmLoading ? <><Spinner /> Génération...</> : 'Générer le lien LM'}
                </button>
              </>
            )}
          </div>
        )}
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
  const [username, setUsername] = useState('');
  const [postId, setPostId] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    if (!username.trim() || !hasCalendly || !canGenerate) return;
    setLoading(true); setError(null);
    try {
      const us = slugify(username);
      const { shortUrl } = await callShortio({ profileId, domainId: domain, originalUrl: calendlyUrl.trim(), title: `Calendly — @${username}`, utmSource: domain, utmMedium: 'dm', utmCampaign: `prospect-${us}`, utmContent: postId || undefined, path: us });
      setResult(shortUrl);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color: INK, marginBottom: 4 }}>Lien Calendly prospect</div>
        <div style={{ fontSize: 12, color: MUTED }}>Génère un lien unique par prospect à envoyer en DM. Chaque clic est tracké.</div>
      </div>

      {!hasCalendly && (
        <div style={{ fontSize: 12, color: AMBER, background: AMBER_SOFT, borderRadius: 8, padding: '10px 12px' }}>⚠ Configure ton lien Calendly dans Paramètres (⚙ en haut).</div>
      )}
      {hasCalendly && (
        <div style={{ fontSize: 11, color: MUTED, background: SURFACE2, borderRadius: 8, padding: '8px 12px' }}>→ <span style={{ fontWeight: 600, color: INK }}>{calendlyUrl}</span></div>
      )}

      {result ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 12, color: MUTED }}>Envoie ce lien en DM à <strong>@{username}</strong></div>
          <GeneratedUrlRow url={result} label="Lien Calendly" />
          <button onClick={() => { setResult(null); setUsername(''); setPostId(''); }} style={{ fontSize: 12, color: MUTED, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0, textDecoration: 'underline' }}>Générer pour un autre prospect</button>
        </div>
      ) : (
        <>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, marginBottom: 5 }}>Pseudo Instagram du prospect</div>
            <input value={username} onChange={e => setUsername(e.target.value.replace(/^@/, ''))} placeholder="thomas.biz"
              style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 8, border: `1px solid ${BORDER}`, background: BG, color: INK, outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, marginBottom: 5 }}>Contenu source <span style={{ fontWeight: 400, color: FAINT }}>(optionnel)</span></div>
            <select value={postId} onChange={e => setPostId(e.target.value)} style={{ width: '100%', padding: '8px 10px', fontSize: 12, borderRadius: 8, border: `1px solid ${BORDER}`, background: BG, color: INK, boxSizing: 'border-box' }}>
              <option value="">— Sans attribution —</option>
              {posts.map(p => <option key={p.id} value={p.id}>{p.platform} · {p.caption}</option>)}
            </select>
          </div>
          {error && <div style={{ fontSize: 12, color: RED, background: 'var(--red-soft)', borderRadius: 6, padding: '8px 10px' }}>{error}</div>}
          <button onClick={generate} disabled={loading || !canGenerate || !hasCalendly || !username.trim()}
            style={{ padding: '10px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none', background: BLUE, color: '#fff', cursor: 'pointer', opacity: loading || !canGenerate || !hasCalendly || !username.trim() ? 0.4 : 1, transition: 'opacity .15s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            {loading ? <><Spinner /> Génération...</> : 'Générer le lien prospect'}
          </button>
        </>
      )}
    </div>
  );
}

// ─── Panel Lead Magnets ───────────────────────────────────────────────────────

function PanneauLeadMagnets({ leadMagnets, lmLoading, onCreated, onDeleted }: {
  leadMagnets: LeadMagnet[]; lmLoading: boolean;
  onCreated: (lm: LeadMagnet) => void; onDeleted: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const create = async () => {
    if (!isValidUrl(url)) return;
    setSaving(true); setError(null);
    try {
      const res = await fetch('/api/client/lead-magnets', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim() || url, url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur');
      onCreated(data.lead_magnet);
      setName(''); setUrl('');
    } catch (e: any) { setError(e.message); } finally { setSaving(false); }
  };

  const remove = async (id: string) => {
    setDeletingId(id);
    try {
      await fetch(`/api/client/lead-magnets?id=${id}`, { method: 'DELETE' });
      onDeleted(id);
    } catch {} finally { setDeletingId(null); }
  };

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color: INK, marginBottom: 4 }}>Mes lead magnets</div>
        <div style={{ fontSize: 12, color: MUTED }}>Crée et gère ta bibliothèque de LM. Tu peux les réutiliser sur n'importe quel contenu.</div>
      </div>

      {/* Formulaire création */}
      <div style={{ background: SURFACE2, borderRadius: 12, padding: '16px', display: 'flex', flexDirection: 'column', gap: 10, border: `1px solid ${BORDER}` }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Nouveau lead magnet</div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, marginBottom: 4 }}>Nom <span style={{ fontWeight: 400, color: FAINT }}>(optionnel)</span></div>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Checklist closing, Guide tunnel…"
            style={{ width: '100%', padding: '8px 10px', fontSize: 12, borderRadius: 8, border: `1px solid ${BORDER}`, background: SURFACE, color: INK, outline: 'none', boxSizing: 'border-box' }} />
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, marginBottom: 4 }}>URL</div>
          <input value={url} onChange={e => setUrl(e.target.value)} placeholder="notion.so/mon-guide ou https://…"
            style={{ width: '100%', padding: '8px 10px', fontSize: 12, borderRadius: 8, border: `1px solid ${BORDER}`, background: SURFACE, color: INK, outline: 'none', boxSizing: 'border-box' }} />
        </div>
        {error && <div style={{ fontSize: 11, color: RED, background: 'var(--red-soft)', borderRadius: 6, padding: '6px 10px' }}>{error}</div>}
        <button onClick={create} disabled={saving || !isValidUrl(url)}
          style={{ padding: '9px', fontSize: 12, fontWeight: 700, borderRadius: 8, border: 'none', background: 'var(--green)', color: '#fff', cursor: !isValidUrl(url) || saving ? 'not-allowed' : 'pointer', opacity: !isValidUrl(url) || saving ? 0.4 : 1, transition: 'opacity .15s' }}>
          {saving ? 'Sauvegarde...' : '+ Ajouter le lead magnet'}
        </button>
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
              <div key={lm.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px', borderRadius: 10, border: `1px solid ${BORDER}`, background: SURFACE }}>
                <div style={{ fontSize: 18, flexShrink: 0 }}>📄</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: INK, marginBottom: 2 }}>{lm.name}</div>
                  <div style={{ fontSize: 11, color: FAINT, wordBreak: 'break-all' }}>{lm.url}</div>
                </div>
                <button onClick={() => remove(lm.id)} disabled={deletingId === lm.id}
                  style={{ fontSize: 11, color: RED, background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0, opacity: deletingId === lm.id ? 0.5 : 1, padding: '2px 4px' }}>
                  {deletingId === lm.id ? '...' : '✕'}
                </button>
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
  const [rightView, setRightView] = useState<RightView>(null);
  const [paramOpen, setParamOpen] = useState(false);

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
  }, [profileId]);

  // Charger posts IG + YT
  useEffect(() => {
    if (!profileId) return;
    let igDone = false; let ytDone = false;
    const checkDone = () => { if (igDone && ytDone) setPostsLoading(false); };

    fetch(`/api/instagram/stats?profileId=${profileId}`)
      .then(r => r.json())
      .then(data => {
        const ig = (data.posts || []).map((p: any) => ({ id: p.id, caption: (p.caption || 'Publication Instagram').slice(0, 60), platform: 'IG' as const, thumbnail: p.thumbnail }));
        setPosts(prev => [...ig, ...prev.filter(p => p.platform === 'YT')]);
      }).catch(() => {}).finally(() => { igDone = true; checkDone(); });

    fetch(`/api/youtube/stats?profileId=${profileId}`)
      .then(r => r.json())
      .then(data => {
        const yt = (data.videos || []).map((v: any) => ({ id: v.id, caption: (v.title || 'Vidéo YouTube').slice(0, 60), platform: 'YT' as const, thumbnail: v.thumbnail }));
        setPosts(prev => [...prev.filter(p => p.platform === 'IG'), ...yt]);
      }).catch(() => {}).finally(() => { ytDone = true; checkDone(); });
  }, [profileId]);

  const selectedPost = rightView?.type === 'post' ? rightView.post : null;

  return (
    <>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      <ModalParametres
        open={paramOpen} onClose={() => setParamOpen(false)}
        profileId={profileId} domains={domains} domainsLoaded={domainsLoaded}
        onCalendlyChange={setCalendlyUrl} initialCalendly={calendlyUrl}
      />

      <div className="liens-shell">

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 24px', borderBottom: `1px solid ${BORDER}`, background: SURFACE, flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, color: INK, letterSpacing: '-0.02em' }}>Gérer mes liens</div>
            <div style={{ fontSize: 11, color: MUTED, marginTop: 1 }}>Liens Short.io trackés pour chaque contenu et chaque prospect.</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setRightView({ type: 'lm-library' })} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', fontSize: 12, fontWeight: 600, borderRadius: 8, cursor: 'pointer', transition: 'all .15s',
              border: `1.5px solid ${rightView?.type === 'lm-library' ? 'var(--green)' : BORDER}`,
              background: rightView?.type === 'lm-library' ? 'var(--green-soft)' : SURFACE,
              color: rightView?.type === 'lm-library' ? 'var(--green)' : MUTED,
            }}>
              📄 Lead Magnets
              {leadMagnets.length > 0 && <span style={{ fontSize: 10, fontWeight: 700, background: rightView?.type === 'lm-library' ? 'var(--green)' : BORDER, color: rightView?.type === 'lm-library' ? '#fff' : MUTED, borderRadius: 10, padding: '1px 6px' }}>{leadMagnets.length}</span>}
            </button>
            <button onClick={() => setParamOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', fontSize: 12, fontWeight: 600, borderRadius: 8, border: `1px solid ${BORDER}`, background: SURFACE, color: MUTED, cursor: 'pointer' }}>
              ⚙ Paramètres
            </button>
          </div>
        </div>

        {/* Body : 2 colonnes */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>

          {/* Colonne gauche : liste contenus + bouton prospect */}
          <div style={{ width: 280, flexShrink: 0, borderRight: `1px solid ${BORDER}`, overflowY: 'auto', background: BG, display: 'flex', flexDirection: 'column' }}>

            {/* Bouton Calendly prospect */}
            <div style={{ padding: '12px 16px', borderBottom: `1px solid ${BORDER}` }}>
              <button onClick={() => setRightView({ type: 'prospect' })} style={{
                width: '100%', padding: '10px 12px', fontSize: 12, fontWeight: 600, borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                border: `1.5px solid ${rightView?.type === 'prospect' ? BLUE : BORDER}`,
                background: rightView?.type === 'prospect' ? BLUE_SOFT : SURFACE,
                color: rightView?.type === 'prospect' ? BLUE : INK,
                transition: 'all .15s',
              }}>
                📅 Lien Calendly prospect
              </button>
            </div>

            {/* Liste contenus */}
            <div style={{ flex: 1, padding: '8px 0' }}>
              <div style={{ padding: '8px 16px 4px', fontSize: 10, fontWeight: 700, color: FAINT, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Contenus
              </div>
              {postsLoading ? (
                <div style={{ padding: '20px 16px', fontSize: 12, color: FAINT, textAlign: 'center' }}>Chargement...</div>
              ) : posts.length === 0 ? (
                <div style={{ padding: '20px 16px', fontSize: 12, color: FAINT, textAlign: 'center' }}>Aucun contenu trouvé.<br />Connecte Instagram ou YouTube.</div>
              ) : (
                posts.map(post => {
                  const isSelected = selectedPost?.id === post.id;
                  return (
                    <div key={post.id} onClick={() => setRightView({ type: 'post', post })}
                      style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 16px', cursor: 'pointer', background: isSelected ? BLUE_SOFT : 'transparent', borderLeft: `3px solid ${isSelected ? BLUE : 'transparent'}`, transition: 'all .1s' }}>
                      <div style={{ width: 32, height: 32, borderRadius: 6, background: SURFACE2, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0, overflow: 'hidden' }}>
                        {post.thumbnail
                          ? <img src={post.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          : post.platform === 'IG' ? '📸' : '▶️'}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: isSelected ? BLUE : INK, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{post.caption}</div>
                        <div style={{ display: 'flex', gap: 4, marginTop: 3 }}>
                          <Badge color={post.platform === 'IG' ? '#c2185b' : '#d32f2f'} bg={post.platform === 'IG' ? '#c2185b12' : '#d32f2f12'}>{post.platform}</Badge>
                          {post.hasDescLink && <Badge color={BLUE} bg={BLUE_SOFT}>📝</Badge>}
                          {post.hasLeadMagnet && <Badge color='var(--green)' bg='var(--green-soft)'>📄</Badge>}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Colonne droite */}
          <div style={{ flex: 1, minWidth: 0, background: SURFACE, overflowY: 'auto' }}>
            {rightView === null ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12, padding: 40, textAlign: 'center' }}>
                <div style={{ fontSize: 36 }}>🔗</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: INK }}>Sélectionne un contenu</div>
                <div style={{ fontSize: 13, color: MUTED, maxWidth: 320, lineHeight: 1.6 }}>
                  Clique sur un contenu à gauche pour générer un lien description ou un lien lead magnet.
                  <br /><br />
                  Ou utilise <strong>Calendly prospect</strong> pour un lien DM unique, et <strong>📄 Lead Magnets</strong> pour gérer ta bibliothèque.
                </div>
              </div>
            ) : rightView.type === 'lm-library' ? (
              <PanneauLeadMagnets
                leadMagnets={leadMagnets} lmLoading={lmLoading}
                onCreated={lm => setLeadMagnets(prev => [lm, ...prev])}
                onDeleted={id => setLeadMagnets(prev => prev.filter(l => l.id !== id))}
              />
            ) : rightView.type === 'prospect' ? (
              <PanneauCalendlyProspect profileId={profileId} domains={domains} domainsLoaded={domainsLoaded} calendlyUrl={calendlyUrl} posts={posts} />
            ) : (
              <PanneauActions
                post={rightView.post} profileId={profileId} domains={domains} domainsLoaded={domainsLoaded}
                calendlyUrl={calendlyUrl} leadMagnets={leadMagnets}
                onLmCreated={lm => setLeadMagnets(prev => [lm, ...prev])}
              />
            )}
          </div>
        </div>
      </div>
    </>
  );
}
