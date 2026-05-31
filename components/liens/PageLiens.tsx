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
  descLinkUrl?: string;
  lmKeyword?: string;
  lmShortUrl?: string;
  dmOpenerMessage?: string;
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
}

interface LeadMagnet {
  id: string;
  name: string;
  url: string;
  keyword: string;
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

function TabDesc({ post, profileId, domain, canGenerate, calendlyUrl, leadMagnets, onPostUpdated }: {
  post: Post; profileId: string; domain: string; canGenerate: boolean;
  calendlyUrl: string; leadMagnets: LeadMagnet[];
  onPostUpdated: (postId: string, patch: Partial<Post>) => void;
}) {
  const hasCalendly = calendlyUrl.trim().startsWith('http');
  // IG: Calendly / LM / custom — YT: Calendly / custom seulement
  const destOptions = post.platform === 'IG'
    ? [{ key: 'calendly', label: '📅 Calendly' }, { key: 'leadmagnet', label: '📄 Lead magnet' }, { key: 'custom', label: '🔗 URL custom' }]
    : [{ key: 'calendly', label: '📅 Calendly' }, { key: 'custom', label: '🔗 URL custom' }];

  const [destType, setDestType] = useState<'calendly' | 'leadmagnet' | 'custom'>('calendly');
  const [customUrl, setCustomUrl] = useState('');
  const [result, setResult] = useState<string | null>(post.descLinkUrl || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isExisting = !!post.descLinkUrl;

  const generate = async () => {
    const validationError = validateDescParams({ canGenerate, destType, calendlyUrl, customUrl });
    if (validationError) { setError(validationError); return; }
    const destUrl = destType === 'calendly' ? calendlyUrl.trim() : normalizeUrl(customUrl);
    setLoading(true); setError(null);
    try {
      const path = `desc-${slugify(post.caption.slice(0, 20))}-${post.id.slice(-4)}`;
      const { shortUrl } = await callShortio({ profileId, domainId: domain, originalUrl: destUrl, title: `Description — ${post.caption.slice(0, 40)}`, utmSource: domain, utmMedium: 'description', utmCampaign: destType, utmContent: post.id, path });
      await fetch('/api/client/content-links', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content_id: post.id, platform: post.platform, desc_short_url: shortUrl, desc_dest_type: destType }),
      });
      setResult(shortUrl);
      onPostUpdated(post.id, { hasDescLink: true, descLinkUrl: shortUrl });
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };

  if (result) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {isExisting && !loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--green-soft)', borderRadius: 8, padding: '8px 12px' }}>
          <span style={{ fontSize: 13 }}>✅</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--green)' }}>Lien déjà généré pour ce contenu</span>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: BLUE_SOFT, borderRadius: 8, padding: '8px 12px' }}>
          <span style={{ fontSize: 13 }}>📋</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: BLUE }}>Colle ce lien dans la description de ta publication</span>
        </div>
      )}
      {/* Vérification lien en description */}
      {post.permalink ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: SURFACE2, borderRadius: 8, padding: '8px 12px' }}>
          <span style={{ fontSize: 12 }}>🔍</span>
          <span style={{ fontSize: 11, color: MUTED, flex: 1 }}>Vérifie que le lien est bien dans la description de ton post.</span>
          <a href={post.permalink} target="_blank" rel="noreferrer" style={{ fontSize: 11, fontWeight: 600, color: BLUE, textDecoration: 'none', whiteSpace: 'nowrap', padding: '4px 10px', border: `1px solid ${BLUE}`, borderRadius: 6 }}>
            Voir le post ↗
          </a>
        </div>
      ) : null}
      <GeneratedUrlRow url={result} label="Lien description" />
      <button onClick={() => setResult(null)} style={{ fontSize: 11, color: MUTED, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0, textDecoration: 'underline' }}>
        {isExisting ? 'Regénérer un nouveau lien' : 'Générer un autre lien'}
      </button>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Destination</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {destOptions.map(opt => (
            <button key={opt.key} onClick={() => { setDestType(opt.key as any); setCustomUrl(''); }} style={{
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
      {destType === 'leadmagnet' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, marginBottom: 2 }}>Choisir un lead magnet</div>
          {leadMagnets.length === 0
            ? <div style={{ fontSize: 12, color: FAINT, background: SURFACE2, borderRadius: 8, padding: '10px 12px' }}>Aucun LM — crée-en un via le bouton 📄 Lead Magnets en haut.</div>
            : leadMagnets.map(lm => (
                <div key={lm.id} onClick={() => setCustomUrl(lm.url === customUrl ? '' : lm.url)} style={{
                  padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                  border: `1.5px solid ${customUrl === lm.url ? BLUE : BORDER}`,
                  background: customUrl === lm.url ? BLUE_SOFT : SURFACE, transition: 'all .12s',
                }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: customUrl === lm.url ? BLUE : INK, marginBottom: 2 }}>{lm.name}</div>
                  {lm.keyword && <span style={{ fontSize: 10, fontWeight: 700, color: MUTED }}>#{lm.keyword}</span>}
                </div>
              ))}
        </div>
      )}
      {destType === 'custom' && (
        <input value={customUrl} onChange={e => setCustomUrl(e.target.value)} placeholder="https://..."
          style={{ width: '100%', padding: '8px 10px', fontSize: 12, borderRadius: 8, border: `1px solid ${BORDER}`, background: BG, color: INK, outline: 'none', boxSizing: 'border-box' }} />
      )}

      {!canGenerate && <div style={{ fontSize: 12, color: AMBER, background: AMBER_SOFT, borderRadius: 6, padding: '8px 10px' }}>⚠ Short.io non connecté — configure ta clé dans Réglages.</div>}
      {error && <div style={{ fontSize: 12, color: RED, background: 'var(--red-soft)', borderRadius: 6, padding: '8px 10px' }}>{error}</div>}

      <button onClick={generate} disabled={loading || !canGenerate || (destType === 'calendly' ? !hasCalendly : !customUrl.trim())}
        style={{ padding: '10px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none', background: BLUE, color: '#fff', cursor: 'pointer', opacity: loading || !canGenerate || (destType === 'calendly' ? !hasCalendly : !customUrl.trim()) ? 0.4 : 1, transition: 'opacity .15s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        {loading ? <><Spinner /> Génération...</> : 'Générer le lien description'}
      </button>
    </div>
  );
}

// ─── Dm1Editor : contentEditable avec badge {{lien_lm}} inline ────────────────

const TOKEN = '{{lien_lm}}';

function serializeEditor(el: HTMLDivElement): string {
  let result = '';
  el.childNodes.forEach(node => {
    if (node.nodeType === Node.TEXT_NODE) {
      result += node.textContent ?? '';
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (el.dataset.token === 'lien_lm') result += TOKEN;
      else result += el.textContent ?? '';
    }
  });
  return result;
}

function buildNodes(value: string): (string | 'TOKEN')[] {
  const parts = value.split(TOKEN);
  const out: (string | 'TOKEN')[] = [];
  parts.forEach((p, i) => {
    if (p) out.push(p);
    if (i < parts.length - 1) out.push('TOKEN');
  });
  return out;
}

function makeBadge(blue: string, blueSoft: string): HTMLSpanElement {
  const badge = document.createElement('span');
  badge.dataset.token = 'lien_lm';
  badge.contentEditable = 'false';
  badge.draggable = true;
  badge.textContent = 'Lien LM';
  Object.assign(badge.style, {
    display: 'inline-flex', alignItems: 'center',
    background: blueSoft, border: `1px solid ${blue}`, borderRadius: '5px',
    padding: '1px 8px', margin: '0 1px', color: blue,
    fontSize: '10px', fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: '0.04em', verticalAlign: 'middle', userSelect: 'none',
    cursor: 'grab',
  });
  return badge;
}

function Dm1Editor({ value, onChange, saved, blue, blueSoft, border, amber, bg, ink, faint }: {
  value: string; onChange: (v: string) => void; saved: boolean;
  blue: string; blueSoft: string; border: string; amber: string; bg: string; ink: string; faint: string;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const isComposing = useRef(false);
  const lastValue = useRef(value);
  const draggingBadge = useRef<HTMLSpanElement | null>(null);
  const caretRef = useRef<HTMLSpanElement | null>(null);

  const removeCaret = useCallback(() => {
    caretRef.current?.parentNode?.removeChild(caretRef.current);
  }, []);

  const commitChange = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const serialized = serializeEditor(el);
    lastValue.current = serialized;
    onChange(serialized);
  }, [onChange]);

  const syncDom = useCallback((val: string, preserveCursor = false) => {
    const el = editorRef.current;
    if (!el) return;

    let anchorNode: Node | null = null;
    let anchorOffset = 0;
    if (preserveCursor) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        anchorNode = sel.getRangeAt(0).startContainer;
        anchorOffset = sel.getRangeAt(0).startOffset;
      }
    }

    el.innerHTML = '';
    buildNodes(val).forEach(part => {
      if (part === 'TOKEN') {
        el.appendChild(makeBadge(blue, blueSoft));
      } else {
        el.appendChild(document.createTextNode(part));
      }
    });

    // Restaure curseur
    const sel = window.getSelection();
    if (!sel) return;
    if (preserveCursor && anchorNode && el.contains(anchorNode)) {
      try {
        const r = document.createRange();
        r.setStart(anchorNode, Math.min(anchorOffset, anchorNode.textContent?.length ?? 0));
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
        return;
      } catch {}
    }
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);
  }, [blue, blueSoft]);

  useEffect(() => {
    if (value !== lastValue.current) {
      lastValue.current = value;
      syncDom(value);
    }
  }, [value, syncDom]);

  useEffect(() => {
    syncDom(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleInput = useCallback(() => {
    if (isComposing.current || !editorRef.current) return;
    const serialized = serializeEditor(editorRef.current);
    if (serialized === lastValue.current) return;

    // Si le badge a été retiré (couper, coller sans lui, etc.) → on le force dans la valeur
    const prevHadToken = lastValue.current.includes(TOKEN);
    const nowHasToken = serialized.includes(TOKEN);
    if (prevHadToken && !nowHasToken) {
      // Restaure le DOM avec le token à la fin du texte actuel
      const restored = serialized + TOKEN;
      lastValue.current = restored;
      syncDom(restored, true);
      onChange(restored);
      return;
    }

    // Convertit {{lien_lm}} tapé manuellement en badge
    if (serialized.includes(TOKEN)) {
      lastValue.current = serialized;
      syncDom(serialized, true);
      onChange(serialized);
      return;
    }

    lastValue.current = serialized;
    onChange(serialized);
  }, [onChange, syncDom]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);

    // Bloque toute suppression qui toucherait le badge
    if (e.key === 'Backspace' || e.key === 'Delete') {
      const el = editorRef.current;
      if (!el) return;

      // Si sélection non-collapsed, vérifier qu'aucun badge n'est dans la sélection
      if (!range.collapsed) {
        const frag = range.cloneContents();
        const hasBadge = Array.from(frag.querySelectorAll('[data-token="lien_lm"]')).length > 0;
        if (hasBadge) { e.preventDefault(); return; }
      }

      if (e.key === 'Backspace' && range.collapsed) {
        const prev = range.startContainer.previousSibling;
        if (range.startOffset === 0 && prev && (prev as HTMLElement).dataset?.token === 'lien_lm') {
          e.preventDefault(); return;
        }
      }
      if (e.key === 'Delete' && range.collapsed) {
        const textLen = range.startContainer.textContent?.length ?? 0;
        const next = range.startContainer.nextSibling;
        if (range.startOffset === textLen && next && (next as HTMLElement).dataset?.token === 'lien_lm') {
          e.preventDefault(); return;
        }
      }
    }
  }, []);

  // Drag & drop du badge dans l'éditeur
  const handleDragStart = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.dataset?.token === 'lien_lm') {
      draggingBadge.current = target as HTMLSpanElement;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', TOKEN);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    // Affiche un caret custom à la position de drop
    const el = editorRef.current;
    if (!el) return;
    let range: Range | null = null;
    if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(e.clientX, e.clientY);
    } else if ((document as any).caretPositionFromPoint) {
      const pos = (document as any).caretPositionFromPoint(e.clientX, e.clientY);
      if (pos) { range = document.createRange(); range.setStart(pos.offsetNode, pos.offset); range.collapse(true); }
    }
    if (!range || !el.contains(range.startContainer)) { removeCaret(); return; }

    // Crée ou déplace le caret
    if (!caretRef.current) {
      const c = document.createElement('span');
      c.id = '__drag-caret__';
      Object.assign(c.style, {
        display: 'inline-block', width: '2px', height: '1.2em',
        background: blue, verticalAlign: 'text-bottom', pointerEvents: 'none',
        animation: 'none', borderRadius: '1px', marginLeft: '-1px',
      });
      caretRef.current = c;
    }
    const caret = caretRef.current;
    // Retire le caret de son ancienne position avant de le réinsérer
    caret.parentNode?.removeChild(caret);
    range.insertNode(caret);
  }, [blue]);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    removeCaret();
    const el = editorRef.current;
    if (!el || !draggingBadge.current) return;

    // Retire le badge de sa position actuelle
    const badge = draggingBadge.current;
    badge.parentNode?.removeChild(badge);
    draggingBadge.current = null;

    // Insère à la position du drop
    let range: Range | null = null;
    if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(e.clientX, e.clientY);
    } else if ((document as any).caretPositionFromPoint) {
      const pos = (document as any).caretPositionFromPoint(e.clientX, e.clientY);
      if (pos) { range = document.createRange(); range.setStart(pos.offsetNode, pos.offset); range.collapse(true); }
    }

    if (range && el.contains(range.startContainer)) {
      range.insertNode(makeBadge(blue, blueSoft));
    } else {
      el.appendChild(makeBadge(blue, blueSoft));
    }

    commitChange();
  }, [blue, blueSoft, commitChange, removeCaret]);

  return (
    <div style={{ borderRadius: 8, border: `1px solid ${saved ? border : amber}`, background: bg }}>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onCompositionStart={() => { isComposing.current = true; }}
        onCompositionEnd={() => { isComposing.current = false; handleInput(); }}
        onKeyDown={handleKeyDown}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={removeCaret}
        onDragEnd={removeCaret}
        onDrop={handleDrop}
        data-placeholder="Ex : 👋 Voici le lien comme promis !"
        style={{
          minHeight: 72, padding: '10px 12px', fontSize: 12, lineHeight: 1.6,
          fontFamily: 'inherit', color: ink, outline: 'none',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          borderRadius: 8,
        }}
      />
      <style>{`[contenteditable]:empty:before{content:attr(data-placeholder);color:${faint};}`}</style>
    </div>
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
    } catch {} finally { setSavingMsg(false); }
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
      if (lmMode === 'new') {
        const res = await fetch('/api/client/lead-magnets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: lmName, url: lmUrl, keyword }) });
        const saved = await res.json();
        if (res.ok && saved.lead_magnet) { onLmCreated(saved.lead_magnet); resolvedLmId = saved.lead_magnet.id; }
      }
      const path = `lm-${slugify(keyword)}-${post.id.slice(-4)}`;
      const { shortUrl } = await callShortio({ profileId, domainId: domain, originalUrl: lmUrl, title: `LM — ${lmName} · ${post.caption.slice(0, 30)}`, utmSource: domain, utmMedium: 'leadmagnet', utmCampaign: `lm-${slugify(keyword)}`, utmContent: post.id, path });
      // Sauvegarder dans content_links
      await fetch('/api/client/content-links', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content_id: post.id, platform: post.platform, lm_id: resolvedLmId || null, lm_short_url: shortUrl, lm_keyword: keyword, dm_opener_message: dmMessage || null }),
      });
      setResult(shortUrl);
      onPostUpdated(post.id, { hasLeadMagnet: true, lmKeyword: keyword, lmShortUrl: shortUrl });
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

  const handleEditClick = () => setEditing(true);
  const handleCancelEdit = () => {
    if (dmEdited) { setConfirmLeave(true); return; }
    setEditing(false);
    setDmMessage(savedDmMessage);
  };
  const handleConfirmLeave = () => { setEditing(false); setDmMessage(savedDmMessage); setDmEdited(false); setConfirmLeave(false); };

  // États pour l'édition inline des DMs (sans passer par mode édition complet)
  const [dm1Text, setDm1Text] = useState(`👋 Voici le lien comme promis ! {{lien_lm}}`);
  const [dm1Saved, setDm1Saved] = useState(true);
  const [dm1Saving, setDm1Saving] = useState(false);
  const [dm2Text, setDm2Text] = useState(savedDmMessage);
  const [dm2Saved, setDm2Saved] = useState(true);
  const [dm2Saving, setDm2Saving] = useState(false);

  const saveDm2 = async (msg: string) => {
    setDm2Saving(true);
    try {
      await fetch('/api/client/content-links', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content_id: post.id, platform: post.platform, dm_opener_message: msg }),
      });
      onPostUpdated(post.id, { dmOpenerMessage: msg });
      setDm2Saved(true);
    } catch {} finally { setDm2Saving(false); }
  };

  if ((result || isExisting) && !editing) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Statut LM */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, background: 'var(--green-soft)', borderRadius: 10, padding: '12px 14px' }}>
        <span style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>✅</span>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--green)', marginBottom: 3 }}>Lead magnet associé</div>
          <div style={{ fontSize: 11, color: MUTED }}>Mot-clé : <strong style={{ color: INK }}>#{keyword || post.lmKeyword}</strong></div>
          <div style={{ fontSize: 11, color: MUTED, marginTop: 2, lineHeight: 1.5 }}>
            Quand quelqu'un commente ce mot, il reçoit le LM + le message d'ouverture en DM automatiquement. <strong>Rien à faire de plus sur Instagram.</strong>
          </div>
        </div>
      </div>

      {/* DM 1 — avec le LM (texte éditable + token {{lien_lm}} draggable) */}
      {lmUrl && (
        <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: INK }}>DM 1 — envoyé avec le LM</div>
          </div>
          {/* Éditeur contentEditable avec badge {{lien_lm}} inline */}
          <Dm1Editor
            value={dm1Text}
            onChange={v => { setDm1Text(v); setDm1Saved(false); }}
            saved={dm1Saved}
            blue={BLUE} blueSoft={BLUE_SOFT} border={BORDER} amber={AMBER} bg={BG} ink={INK} faint={FAINT}
          />
          <div style={{ fontSize: 10, color: FAINT, marginTop: 6 }}>
            Tu peux glisser le badge <strong style={{ color: BLUE }}>Lien LM</strong> n'importe où dans le message pour le repositionner.
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            <button onClick={async () => {
              setDm1Saving(true);
              try {
                await fetch('/api/client/content-links', {
                  method: 'POST', headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ content_id: post.id, platform: post.platform, dm_lm_message: dm1Text }),
                });
                setDm1Saved(true);
              } catch {} finally { setDm1Saving(false); }
            }} disabled={dm1Saving || dm1Saved}
              style={{ padding: '5px 14px', fontSize: 11, fontWeight: 600, borderRadius: 6, border: 'none', background: dm1Saved ? 'var(--green)' : BLUE, color: '#fff', cursor: dm1Saved ? 'default' : 'pointer', transition: 'background .2s' }}>
              {dm1Saving ? '...' : dm1Saved ? '✓ Sauvegardé' : 'Sauvegarder'}
            </button>
          </div>
        </div>
      )}

      {/* DM 2 — message d'ouverture (éditable inline) */}
      <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, padding: '14px 16px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: INK, marginBottom: 4 }}>DM 2 — Message d'ouverture de discussion</div>
        <div style={{ fontSize: 11, color: MUTED, marginBottom: 8, lineHeight: 1.5 }}>
          Envoyé automatiquement juste après le DM avec le LM.
        </div>
        <textarea
          value={dm2Text}
          onChange={e => { setDm2Text(e.target.value); setDm2Saved(false); }}
          placeholder={`Ex : "C'est quoi ton objectif principal en ce moment ? 🎯"`}
          rows={3}
          style={{ width: '100%', padding: '10px 12px', fontSize: 12, borderRadius: 8, border: `1px solid ${dm2Saved ? BORDER : AMBER}`, background: BG, color: INK, outline: 'none', resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.5, fontFamily: 'inherit' }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
          <button onClick={() => saveDm2(dm2Text)} disabled={dm2Saving || dm2Saved}
            style={{ padding: '5px 14px', fontSize: 11, fontWeight: 600, borderRadius: 6, border: 'none', background: dm2Saved ? 'var(--green)' : BLUE, color: '#fff', cursor: dm2Saved ? 'default' : 'pointer', transition: 'background .2s' }}>
            {dm2Saving ? '...' : dm2Saved ? '✓ Sauvegardé' : 'Sauvegarder les modifications'}
          </button>
        </div>
      </div>

      {/* Lien LM */}
      {lmUrl && <GeneratedUrlRow url={lmUrl} label="Lien lead magnet" />}

      {/* Boutons bas */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
        {post.permalink && (
          <a href={post.permalink} target="_blank" rel="noreferrer"
            style={{ fontSize: 12, fontWeight: 600, color: '#c2185b', textDecoration: 'none', whiteSpace: 'nowrap', border: '1.5px solid #c2185b', borderRadius: 8, padding: '6px 14px' }}>
            📸 Voir le post Instagram ↗
          </a>
        )}
        <button onClick={handleEditClick}
          style={{ fontSize: 12, fontWeight: 600, color: INK, background: 'none', border: `1.5px solid ${INK}`, borderRadius: 8, cursor: 'pointer', padding: '6px 14px', whiteSpace: 'nowrap' }}>
          ✏️ Modifier / régénérer le LM
        </button>
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
                <div key={lm.id} onClick={() => { setSelectedLmId(lm.id); if (lm.keyword && !keyword) setKeyword(lm.keyword); }} style={{
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

      {/* DM avec le LM — aperçu */}
      <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, padding: '12px 14px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: INK, marginBottom: 6 }}>DM envoyé avec le LM</div>
        <div style={{ background: SURFACE2, borderRadius: 10, padding: '10px 14px', fontSize: 12, color: MUTED, lineHeight: 1.6, fontStyle: 'italic' }}>
          👋 Voici le lien comme promis ! <span style={{ color: BLUE }}>[lien Short.io généré automatiquement]</span>
        </div>
        <div style={{ fontSize: 10, color: FAINT, marginTop: 6 }}>Ce message est fixe et généré automatiquement avec le lien tracké.</div>
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
        {loading ? <><Spinner /> Génération...</> : (result || isExisting) ? 'Régénérer le lien LM' : 'Associer le lead magnet'}
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
                <div key={lm.id} onClick={() => { setSelectedLmId(lm.id); if (lm.keyword && !keyword) setKeyword(lm.keyword); }} style={{
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
    { key: 'desc', label: `📝 Lien description${post.hasDescLink ? ' ✓' : ''}` },
    { key: 'lm', label: `📄 Lead magnet${post.hasLeadMagnet ? ' ✓' : ''}` },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header post */}
      <div style={{ padding: '16px 24px', borderBottom: `1px solid ${BORDER}` }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ width: 40, height: 40, borderRadius: 8, background: SURFACE2, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0, overflow: 'hidden' }}>
            {post.thumbnail ? <img src={post.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : post.platform === 'IG' ? '📸' : '▶️'}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: INK, lineHeight: 1.3, marginBottom: 5 }}>{post.caption}</div>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              <Badge color={post.platform === 'IG' ? '#c2185b' : '#d32f2f'} bg={post.platform === 'IG' ? '#c2185b18' : '#d32f2f18'}>{post.platform}</Badge>
              {post.hasDescLink
                ? <Badge color={BLUE} bg={BLUE_SOFT}>📝 Lien desc</Badge>
                : <Badge color={FAINT} bg={SURFACE2}>📝 Sans lien</Badge>}
              {post.hasLeadMagnet
                ? <Badge color='var(--green)' bg='var(--green-soft)'>📄 LM {post.lmKeyword ? `#${post.lmKeyword}` : ''}</Badge>
                : post.platform === 'IG' ? <Badge color={FAINT} bg={SURFACE2}>📄 Sans LM</Badge> : null}
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
  const [keyword, setKeyword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, marginBottom: 4 }}>
            Mot-clé déclencheur <span style={{ fontWeight: 400, color: FAINT }}>(optionnel — peut être changé par contenu)</span>
          </div>
          <input
            value={keyword}
            onChange={e => setKeyword(e.target.value.toUpperCase().replace(/\s+/g, ''))}
            placeholder="GUIDE, CHECKLIST, TUNNEL…"
            style={{ width: '100%', padding: '8px 10px', fontSize: 12, fontWeight: 600, letterSpacing: '0.04em', borderRadius: 8, border: `1px solid ${BORDER}`, background: SURFACE, color: INK, outline: 'none', boxSizing: 'border-box' }}
          />
          <div style={{ fontSize: 10, color: FAINT, marginTop: 4 }}>Quand quelqu'un commente ce mot, il reçoit ce LM en DM. Tu pourras le modifier pour chaque contenu.</div>
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
                  <div style={{ fontSize: 11, color: FAINT, wordBreak: 'break-all', marginBottom: lm.keyword ? 4 : 0 }}>{lm.url}</div>
                  {lm.keyword && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: BLUE, background: BLUE_SOFT, borderRadius: 4, padding: '1px 6px', letterSpacing: '0.04em' }}>#{lm.keyword}</span>
                  )}
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
  }, [profileId]);

  // Enrichir les posts avec les content_links — source de vérité principale
  // Se déclenche dès que l'un des deux change
  useEffect(() => {
    if (!posts.length) return;
    setPosts(prev => prev.map(post => {
      const cl = contentLinks.find(c => c.content_id === post.id);
      if (!cl) return post;
      return {
        ...post,
        hasDescLink: !!cl.desc_short_url,
        descLinkUrl: cl.desc_short_url || undefined,
        hasLeadMagnet: !!cl.lm_short_url,
        lmKeyword: cl.lm_keyword || undefined,
        lmShortUrl: cl.lm_short_url || undefined,
        dmOpenerMessage: cl.dm_opener_message || undefined,
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

          {/* Colonne gauche */}
          <div style={{ width: 380, flexShrink: 0, borderRight: `1px solid ${BORDER}`, background: BG, display: 'flex', flexDirection: 'column', minHeight: 0 }}>

            {/* Bouton Calendly prospect */}
            <div style={{ padding: '10px 14px', borderBottom: `1px solid ${BORDER}`, flexShrink: 0 }}>
              <button onClick={() => setRightView({ type: 'prospect' })} style={{
                width: '100%', padding: '9px 12px', fontSize: 12, fontWeight: 600, borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                border: `1.5px solid ${rightView?.type === 'prospect' ? BLUE : BORDER}`,
                background: rightView?.type === 'prospect' ? BLUE_SOFT : SURFACE,
                color: rightView?.type === 'prospect' ? BLUE : INK, transition: 'all .15s',
              }}>📅 Lien Calendly prospect</button>
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
                    style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 14px', cursor: 'pointer', background: isSelected ? BLUE_SOFT : 'transparent', borderLeft: `3px solid ${isSelected ? BLUE : 'transparent'}`, transition: 'all .1s' }}>
                    <div style={{ width: 38, height: 38, borderRadius: 7, background: SURFACE2, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0, overflow: 'hidden' }}>
                      {post.thumbnail ? <img src={post.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : post.platform === 'IG' ? '📸' : '▶️'}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: isSelected ? BLUE : INK, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 4 }}>{post.caption}</div>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        <Badge color={post.platform === 'IG' ? '#c2185b' : '#d32f2f'} bg={post.platform === 'IG' ? '#c2185b12' : '#d32f2f12'}>{post.platform}</Badge>
                        {hasDesc
                          ? <Badge color={BLUE} bg={BLUE_SOFT}>📝 Desc</Badge>
                          : <Badge color={FAINT} bg={SURFACE2}>📝 —</Badge>}
                        {post.platform === 'IG' && (hasLm
                          ? <Badge color='var(--green)' bg='var(--green-soft)'>📄 {post.lmKeyword ? `#${post.lmKeyword}` : 'LM'}</Badge>
                          : <Badge color={FAINT} bg={SURFACE2}>📄 —</Badge>)}
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
                onPostUpdated={handlePostUpdated}
              />
            )}
          </div>
        </div>
      </div>
    </>
  );
}
