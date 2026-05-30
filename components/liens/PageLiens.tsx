'use client';

import { useState, useEffect } from 'react';
import { useUser } from '@/lib/UserContext';

const BLUE = '#6b7cde';
const GREEN = '#3f8a52';
const RED = '#cd5b3f';
const AMBER = '#b58025';
const PURPLE = '#7c5cbf';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ShortDomain { id: string | number; hostname: string; }
type LinkType = 'calendly_prospect' | 'bio' | 'description' | 'leadmagnet';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function slugify(s: string) {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function callShortio(payload: Record<string, any>): Promise<{ shortUrl: string }> {
  const res = await fetch('/api/shortio/links', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    throw new Error(`Erreur serveur (${res.status}) — vérifie que la clé Short.io est configurée dans Réglages`);
  }
  const data = await res.json();
  if (!res.ok) {
    if (data.error === 'no_token') throw new Error('Clé Short.io non configurée — va dans Réglages pour la connecter');
    throw new Error(data.error || 'Erreur Short.io');
  }
  return { shortUrl: data.shortUrl };
}

function typeBadgeColor(t: LinkType) {
  if (t === 'calendly_prospect') return BLUE;
  if (t === 'bio') return PURPLE;
  if (t === 'description') return AMBER;
  return GREEN;
}

// ─── Sous-composants communs ──────────────────────────────────────────────────

function SectionCard({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '22px 24px' }}>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{title}</div>
        {sub && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>{sub}</div>}
      </div>
      {children}
    </div>
  );
}

function InputField({ label, hint, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 5 }}>
        {label}{hint && <span style={{ fontWeight: 400, marginLeft: 6, color: 'var(--faint)' }}>{hint}</span>}
      </div>
      <input {...props} style={{ width: '100%', padding: '9px 12px', fontSize: 13, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--ink)', boxSizing: 'border-box', outline: 'none', ...props.style }} />
    </div>
  );
}

function PathInput({ domain, value, onChange, placeholder }: { domain: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
      <span style={{ padding: '9px 10px', fontSize: 12, color: 'var(--muted)', background: 'var(--surface-2)', borderRight: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{domain}/</span>
      <input value={value} onChange={e => onChange(slugify(e.target.value))} placeholder={placeholder}
        style={{ flex: 1, padding: '9px 12px', fontSize: 13, border: 'none', background: 'var(--surface)', color: 'var(--ink)', outline: 'none' }} />
    </div>
  );
}

function Btn({ children, disabled, loading, variant = 'primary', onClick, style }: {
  children: React.ReactNode; disabled?: boolean; loading?: boolean;
  variant?: 'primary' | 'ghost'; onClick?: () => void; style?: React.CSSProperties;
}) {
  return (
    <button onClick={onClick} disabled={disabled || loading} style={{
      padding: '10px 18px', fontSize: 13, fontWeight: 700, borderRadius: 8,
      cursor: disabled || loading ? 'not-allowed' : 'pointer',
      border: variant === 'ghost' ? '1px solid var(--border)' : 'none',
      background: variant === 'ghost' ? 'transparent' : BLUE,
      color: variant === 'ghost' ? 'var(--ink)' : '#fff',
      opacity: disabled || loading ? 0.5 : 1, transition: 'opacity .15s', ...style,
    }}>{loading ? 'Génération...' : children}</button>
  );
}

function CopiedLink({ url, onReset }: { url: string; onReset: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface-2)', borderRadius: 8, padding: '10px 14px' }}>
        <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: BLUE, wordBreak: 'break-all' }}>{url}</span>
        <button onClick={copy} style={{ padding: '6px 14px', fontSize: 12, fontWeight: 600, borderRadius: 6, cursor: 'pointer', border: 'none', background: copied ? GREEN : BLUE, color: '#fff', transition: 'background .2s', flexShrink: 0 }}>
          {copied ? 'Copié !' : 'Copier'}
        </button>
      </div>
      <Btn variant="ghost" onClick={onReset} style={{ width: '100%', textAlign: 'center' }}>Générer un autre lien</Btn>
    </div>
  );
}

// ─── Section Paramètres (Calendly + liens bio auto) ───────────────────────────

function SectionParametres({ profileId, domains, domainsLoaded, onCalendlyChange }: {
  profileId: string;
  domains: ShortDomain[];
  domainsLoaded: boolean;
  onCalendlyChange: (url: string) => void;
}) {
  const [calendlyUrl, setCalendlyUrl] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bioIgResult, setBioIgResult] = useState<string | null>(null);
  const [bioYtResult, setBioYtResult] = useState<string | null>(null);
  const [generatingIg, setGeneratingIg] = useState(false);
  const [generatingYt, setGeneratingYt] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const domain = domains[0]?.hostname || '';
  const canGenerate = domainsLoaded && !!domain;

  // Charger le lien Calendly sauvegardé
  useEffect(() => {
    fetch('/api/client/settings')
      .then(r => r.json())
      .then(data => {
        if (data.calendly_url) {
          setCalendlyUrl(data.calendly_url);
          onCalendlyChange(data.calendly_url);
        }
      })
      .catch(() => {});
  }, []);

  const saveCalendly = async () => {
    if (!calendlyUrl.trim()) return;
    setSaving(true); setError(null);
    try {
      await fetch('/api/client/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ calendly_url: calendlyUrl.trim() }),
      });
      setSaved(true);
      onCalendlyChange(calendlyUrl.trim());
      setTimeout(() => setSaved(false), 2500);
    } catch { setError('Erreur lors de la sauvegarde'); }
    finally { setSaving(false); }
  };

  const generateBio = async (platform: 'instagram' | 'youtube', setResult: (v: string) => void, setLoading: (v: boolean) => void) => {
    if (!calendlyUrl.trim()) return;
    setLoading(true); setError(null);
    try {
      const path = `bio-${platform === 'instagram' ? 'ig' : 'yt'}`;
      const { shortUrl } = await callShortio({
        profileId, domainId: domain,
        originalUrl: calendlyUrl.trim(),
        title: `Bio ${platform === 'instagram' ? 'Instagram' : 'YouTube'}`,
        utmSource: domain, utmMedium: 'bio',
        utmCampaign: `bio-${platform}`,
        path,
      });
      setResult(shortUrl);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const isCalendlyValid = calendlyUrl.trim().startsWith('http');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Lien Calendly */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)' }}>Ton lien Calendly</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={calendlyUrl}
            onChange={e => setCalendlyUrl(e.target.value)}
            placeholder="https://calendly.com/ton-nom/discovery"
            style={{ flex: 1, padding: '9px 12px', fontSize: 13, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--ink)', outline: 'none' }}
          />
          <button onClick={saveCalendly} disabled={saving || !isCalendlyValid} style={{
            padding: '9px 16px', fontSize: 12, fontWeight: 700, borderRadius: 8, border: 'none',
            background: saved ? GREEN : BLUE, color: '#fff', cursor: saving || !isCalendlyValid ? 'not-allowed' : 'pointer',
            opacity: saving || !isCalendlyValid ? 0.5 : 1, transition: 'all .2s', whiteSpace: 'nowrap',
          }}>
            {saving ? 'Sauvegarde...' : saved ? '✓ Sauvegardé' : 'Sauvegarder'}
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
          Ce lien est utilisé pour tous les liens Calendly générés sur cette page. Change-le ici, tous les prochains liens en bénéficieront.
        </div>
      </div>

      {/* Liens bio générés automatiquement */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 18 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 12 }}>
          Liens bio — à générer une fois et mettre dans ta bio
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

          {/* Bio Instagram */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface-2)' }}>
            <span style={{ fontSize: 18, flexShrink: 0 }}>📸</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 2 }}>Bio Instagram</div>
              {bioIgResult
                ? <div style={{ fontSize: 12, color: BLUE, fontWeight: 600, wordBreak: 'break-all' }}>{bioIgResult}</div>
                : <div style={{ fontSize: 11, color: 'var(--faint)' }}>{domain}/bio-ig</div>}
            </div>
            {bioIgResult
              ? <CopyBtn url={bioIgResult} />
              : <button onClick={() => generateBio('instagram', setBioIgResult, setGeneratingIg)} disabled={generatingIg || !isCalendlyValid || !canGenerate}
                  style={{ padding: '6px 14px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: 'none', background: PURPLE, color: '#fff', cursor: !isCalendlyValid || !canGenerate || generatingIg ? 'not-allowed' : 'pointer', opacity: !isCalendlyValid || !canGenerate || generatingIg ? 0.5 : 1, whiteSpace: 'nowrap' }}>
                  {!canGenerate ? '...' : generatingIg ? '...' : 'Générer'}
                </button>}
          </div>

          {/* Bio YouTube */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface-2)' }}>
            <span style={{ fontSize: 18, flexShrink: 0 }}>▶️</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 2 }}>Bio YouTube</div>
              {bioYtResult
                ? <div style={{ fontSize: 12, color: BLUE, fontWeight: 600, wordBreak: 'break-all' }}>{bioYtResult}</div>
                : <div style={{ fontSize: 11, color: 'var(--faint)' }}>{domain}/bio-yt</div>}
            </div>
            {bioYtResult
              ? <CopyBtn url={bioYtResult} />
              : <button onClick={() => generateBio('youtube', setBioYtResult, setGeneratingYt)} disabled={generatingYt || !isCalendlyValid || !canGenerate}
                  style={{ padding: '6px 14px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: 'none', background: PURPLE, color: '#fff', cursor: !isCalendlyValid || !canGenerate || generatingYt ? 'not-allowed' : 'pointer', opacity: !isCalendlyValid || !canGenerate || generatingYt ? 0.5 : 1, whiteSpace: 'nowrap' }}>
                  {generatingYt ? '...' : 'Générer'}
                </button>}
          </div>

        </div>
        {!canGenerate && domainsLoaded && (
          <div style={{ fontSize: 11, color: RED, marginTop: 8 }}>⚠ Domaine Short.io introuvable — vérifie ta connexion Short.io dans Réglages.</div>
        )}
        {!isCalendlyValid && canGenerate && (
          <div style={{ fontSize: 11, color: AMBER, marginTop: 8 }}>⚠ Sauvegarde ton lien Calendly pour activer la génération des liens bio.</div>
        )}
        {error && <div style={{ fontSize: 12, color: RED, background: RED + '12', borderRadius: 6, padding: '8px 12px', marginTop: 8 }}>{error}</div>}
      </div>
    </div>
  );
}

function CopyBtn({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  return (
    <button onClick={copy} style={{ padding: '6px 14px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: `1px solid ${copied ? 'transparent' : 'var(--border)'}`, background: copied ? GREEN : 'var(--surface)', color: copied ? '#fff' : 'var(--ink)', cursor: 'pointer', transition: 'all .2s', whiteSpace: 'nowrap' } as React.CSSProperties}>
      {copied ? 'Copié !' : 'Copier'}
    </button>
  );
}

// ─── Section Calendly Prospect ────────────────────────────────────────────────

function SectionCalendlyProspect({ domains, profileId, posts, calendlyUrl }: {
  domains: ShortDomain[]; profileId: string;
  posts: { id: string; caption: string; platform: 'IG' | 'YT' }[];
  calendlyUrl: string;
}) {
  const [username, setUsername] = useState('');
  const [postId, setPostId] = useState('');
  const [customPath, setCustomPath] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const domain = domains[0]?.hostname || 'qnl.link';

  const generate = async () => {
    if (!calendlyUrl.trim() || !username.trim()) return;
    setLoading(true); setError(null);
    try {
      const usernameSlug = slugify(username);
      const path = customPath || usernameSlug;
      const { shortUrl } = await callShortio({
        profileId, domainId: domain,
        originalUrl: calendlyUrl.trim(),
        title: `Calendly — @${username}`,
        utmSource: domain, utmMedium: 'dm',
        utmCampaign: `prospect-${usernameSlug}`,
        utmContent: postId || undefined,
        path,
      });
      setResult(shortUrl);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const hasCalendly = calendlyUrl.trim().startsWith('http');

  if (result) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>Envoie ce lien en DM à <strong>@{username}</strong> — les clics et réservations seront trackés.</div>
      <CopiedLink url={result} onReset={() => { setResult(null); setUsername(''); setPostId(''); setCustomPath(''); }} />
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {!hasCalendly && (
        <div style={{ fontSize: 12, color: AMBER, background: AMBER + '15', borderRadius: 8, padding: '10px 12px' }}>
          ⚠ Configure ton lien Calendly dans la section "Paramètres" en haut de page.
        </div>
      )}
      {hasCalendly && (
        <div style={{ fontSize: 11, color: 'var(--muted)', background: 'var(--surface-2)', borderRadius: 8, padding: '8px 12px' }}>
          Destination : <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{calendlyUrl}</span>
        </div>
      )}
      <InputField label="Pseudo Instagram du prospect" placeholder="thomas.biz" value={username}
        onChange={e => setUsername(e.target.value.replace(/^@/, ''))} />
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 5 }}>
          Contenu source <span style={{ fontWeight: 400, color: 'var(--faint)' }}>(optionnel)</span>
        </div>
        <select value={postId} onChange={e => setPostId(e.target.value)}
          style={{ width: '100%', padding: '9px 12px', fontSize: 13, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--ink)', boxSizing: 'border-box' }}>
          <option value="">— Sans attribution —</option>
          {posts.map(p => <option key={p.id} value={p.id}>{p.platform} · {p.caption}</option>)}
        </select>
      </div>
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 5 }}>
          Chemin <span style={{ fontWeight: 400, color: 'var(--faint)' }}>(optionnel)</span>
        </div>
        <PathInput domain={domain} value={customPath} onChange={setCustomPath}
          placeholder={username ? slugify(username) : 'pseudo-prospect'} />
      </div>
      {error && <div style={{ fontSize: 12, color: RED, background: RED + '12', borderRadius: 6, padding: '8px 12px' }}>{error}</div>}
      <Btn onClick={generate} loading={loading} disabled={!hasCalendly || !username.trim()}>Générer le lien prospect</Btn>
    </div>
  );
}

// ─── Section Description publication ─────────────────────────────────────────

function SectionDescription({ domains, profileId, posts, calendlyUrl }: {
  domains: ShortDomain[]; profileId: string;
  posts: { id: string; caption: string; platform: 'IG' | 'YT' }[];
  calendlyUrl: string;
}) {
  const [destType, setDestType] = useState<'calendly' | 'leadmagnet'>('calendly');
  const [manualUrl, setManualUrl] = useState('');
  const [postId, setPostId] = useState('');
  const [customPath, setCustomPath] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const domain = domains[0]?.hostname || 'qnl.link';
  const selectedPost = posts.find(p => p.id === postId);
  const destUrl = destType === 'calendly' ? calendlyUrl.trim() : manualUrl.trim();

  const generate = async () => {
    if (!destUrl || !postId) return;
    setLoading(true); setError(null);
    try {
      const path = customPath || `desc-${slugify(selectedPost?.caption.slice(0, 20) || postId)}`;
      const { shortUrl } = await callShortio({
        profileId, domainId: domain,
        originalUrl: destUrl,
        title: `Description — ${selectedPost?.caption.slice(0, 40) || postId}`,
        utmSource: domain, utmMedium: 'description',
        utmCampaign: destType, utmContent: postId, path,
      });
      setResult(shortUrl);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  if (result) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>Mets ce lien dans la description de ta publication.</div>
      <CopiedLink url={result} onReset={() => { setResult(null); setManualUrl(''); setPostId(''); setCustomPath(''); }} />
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 5 }}>Publication</div>
        <select value={postId} onChange={e => setPostId(e.target.value)}
          style={{ width: '100%', padding: '9px 12px', fontSize: 13, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--ink)', boxSizing: 'border-box' }}>
          <option value="">— Sélectionne une publication —</option>
          {posts.map(p => <option key={p.id} value={p.id}>{p.platform} · {p.caption}</option>)}
        </select>
      </div>
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 8 }}>Destination</div>
        <div style={{ display: 'flex', background: 'var(--surface-2)', borderRadius: 8, padding: 3, gap: 2, marginBottom: 10 }}>
          {(['calendly', 'leadmagnet'] as const).map(d => (
            <button key={d} onClick={() => { setDestType(d); setManualUrl(''); }} style={{
              flex: 1, padding: '7px', fontSize: 12, fontWeight: 600, borderRadius: 6, cursor: 'pointer', border: 'none',
              background: destType === d ? 'var(--surface)' : 'transparent',
              color: destType === d ? 'var(--ink)' : 'var(--muted)',
              boxShadow: destType === d ? '0 1px 3px rgba(0,0,0,.07)' : 'none',
            }}>
              {d === 'calendly' ? '📅 Calendly' : '📄 Lead magnet'}
            </button>
          ))}
        </div>
        {destType === 'calendly'
          ? calendlyUrl.trim()
            ? <div style={{ fontSize: 11, color: 'var(--muted)', background: 'var(--surface-2)', borderRadius: 8, padding: '8px 12px' }}>
                <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{calendlyUrl}</span>
              </div>
            : <div style={{ fontSize: 12, color: AMBER, background: AMBER + '15', borderRadius: 8, padding: '10px 12px' }}>
                ⚠ Configure ton lien Calendly dans Paramètres.
              </div>
          : <InputField label="URL du lead magnet" placeholder="https://notion.so/ton-guide-pdf" value={manualUrl}
              onChange={e => setManualUrl(e.target.value)} />}
      </div>
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 5 }}>
          Chemin <span style={{ fontWeight: 400, color: 'var(--faint)' }}>(optionnel)</span>
        </div>
        <PathInput domain={domain} value={customPath} onChange={setCustomPath}
          placeholder={selectedPost ? `desc-${slugify(selectedPost.caption.slice(0, 15))}` : 'desc-contenu'} />
      </div>
      {error && <div style={{ fontSize: 12, color: RED, background: RED + '12', borderRadius: 6, padding: '8px 12px' }}>{error}</div>}
      <Btn onClick={generate} loading={loading} disabled={!destUrl || !postId}>Générer le lien</Btn>
    </div>
  );
}

// ─── Section Lead Magnet ──────────────────────────────────────────────────────

function SectionLeadMagnet({ domains, profileId, posts }: {
  domains: ShortDomain[]; profileId: string;
  posts: { id: string; caption: string; platform: 'IG' | 'YT' }[];
}) {
  const [lmUrl, setLmUrl] = useState('');
  const [lmName, setLmName] = useState('');
  const [keyword, setKeyword] = useState('');
  const [postId, setPostId] = useState('');
  const [customPath, setCustomPath] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const domain = domains[0]?.hostname || 'qnl.link';
  const selectedPost = posts.find(p => p.id === postId);

  const generate = async () => {
    if (!lmUrl.trim() || !keyword.trim()) return;
    setLoading(true); setError(null);
    try {
      const path = customPath || `lm-${slugify(lmName || keyword)}`;
      const { shortUrl } = await callShortio({
        profileId, domainId: domain,
        originalUrl: lmUrl.trim(),
        title: `Lead magnet — ${lmName || keyword}`,
        utmSource: domain, utmMedium: 'leadmagnet',
        utmCampaign: `lm-${slugify(keyword)}`,
        utmContent: postId || undefined, path,
      });
      setResult(shortUrl);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  if (result) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: 'var(--muted)' }}>
        <span style={{ fontWeight: 600, color: 'var(--ink)' }}>Mot-clé :</span> <span style={{ fontWeight: 700, color: BLUE }}>#{keyword}</span>
        {selectedPost && <> · attribué à <span style={{ fontWeight: 600 }}>{selectedPost.caption.slice(0, 40)}…</span></>}
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>Quand quelqu'un commente <strong>#{keyword}</strong>, il reçoit ce lien en DM automatiquement.</div>
      <CopiedLink url={result} onReset={() => { setResult(null); setLmUrl(''); setLmName(''); setKeyword(''); setPostId(''); setCustomPath(''); }} />
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <InputField label="Nom du lead magnet" hint="(optionnel)" placeholder="Checklist closing, Guide tunnel de vente…" value={lmName} onChange={e => setLmName(e.target.value)} />
      <InputField label="URL du lead magnet" placeholder="https://notion.so/ton-guide-pdf" value={lmUrl} onChange={e => setLmUrl(e.target.value)} />
      <InputField label="Mot-clé déclencheur" placeholder="GUIDE, CHECKLIST, TUNNEL…" value={keyword}
        onChange={e => setKeyword(e.target.value.toUpperCase().replace(/\s+/g, ''))} />
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 5 }}>
          Attribuer à une publication <span style={{ fontWeight: 400, color: 'var(--faint)' }}>(optionnel)</span>
        </div>
        <select value={postId} onChange={e => setPostId(e.target.value)}
          style={{ width: '100%', padding: '9px 12px', fontSize: 13, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--ink)', boxSizing: 'border-box' }}>
          <option value="">— Sans attribution —</option>
          {posts.map(p => <option key={p.id} value={p.id}>{p.platform} · {p.caption}</option>)}
        </select>
      </div>
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 5 }}>
          Chemin <span style={{ fontWeight: 400, color: 'var(--faint)' }}>(optionnel)</span>
        </div>
        <PathInput domain={domain} value={customPath} onChange={setCustomPath}
          placeholder={keyword ? `lm-${slugify(keyword)}` : 'lm-guide'} />
      </div>
      {error && <div style={{ fontSize: 12, color: RED, background: RED + '12', borderRadius: 6, padding: '8px 12px' }}>{error}</div>}
      <Btn onClick={generate} loading={loading} disabled={!lmUrl.trim() || !keyword.trim()}>Générer le lien lead magnet</Btn>
    </div>
  );
}

// ─── Page principale ──────────────────────────────────────────────────────────

export default function PageLiens() {
  const { user } = useUser();
  const [activeType, setActiveType] = useState<LinkType>('calendly_prospect');
  const [domains, setDomains] = useState<ShortDomain[]>([]);
  const [posts, setPosts] = useState<{ id: string; caption: string; platform: 'IG' | 'YT' }[]>([]);
  const [domainsLoaded, setDomainsLoaded] = useState(false);
  const [calendlyUrl, setCalendlyUrl] = useState('');

  const profileId = user?.id || '';

  useEffect(() => {
    if (!profileId) return;
    fetch(`/api/shortio/domains?profileId=${profileId}`)
      .then(r => r.json())
      .then(data => {
        const list: ShortDomain[] = data.domains?.length ? data.domains : [{ id: 'mock', hostname: 'qnl.link' }];
        setDomains(list);
      })
      .catch(() => setDomains([{ id: 'mock', hostname: 'qnl.link' }]))
      .finally(() => setDomainsLoaded(true));
  }, [profileId]);

  useEffect(() => {
    if (!profileId) return;
    fetch(`/api/instagram/stats?profileId=${profileId}`)
      .then(r => r.json())
      .then(data => {
        const igPosts = (data.posts || []).map((p: any) => ({
          id: p.id, caption: (p.caption || 'Publication Instagram').slice(0, 55), platform: 'IG' as const,
        }));
        setPosts(prev => [...igPosts, ...prev.filter(p => p.platform === 'YT')]);
      }).catch(() => {});
    fetch(`/api/youtube/stats?profileId=${profileId}`)
      .then(r => r.json())
      .then(data => {
        const ytVideos = (data.videos || []).map((v: any) => ({
          id: v.id, caption: (v.title || 'Vidéo YouTube').slice(0, 55), platform: 'YT' as const,
        }));
        setPosts(prev => [...prev.filter(p => p.platform === 'IG'), ...ytVideos]);
      }).catch(() => {});
  }, [profileId]);

  const TABS: { type: LinkType; label: string; icon: string; desc: string }[] = [
    { type: 'calendly_prospect', icon: '📅', label: 'Calendly prospect', desc: 'Lien unique par prospect envoyé en DM' },
    { type: 'description', icon: '📝', label: 'Description publication', desc: 'Lien dans la description d\'un contenu' },
    { type: 'leadmagnet', icon: '📄', label: 'Lead magnet', desc: 'Lien avec mot-clé déclencheur de DM auto' },
  ];

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '32px 20px', display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* Header */}
      <div>
        <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink)', marginBottom: 4 }}>Mes liens</div>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>Génère des liens Short.io trackés avec UTM pour chaque étape de ton funnel.</div>
      </div>

      {/* Paramètres : Calendly + liens bio */}
      <SectionCard title="Paramètres" sub="Configure ton lien Calendly une fois — il sera utilisé automatiquement partout.">
        <SectionParametres profileId={profileId} domains={domains} domainsLoaded={domainsLoaded} onCalendlyChange={setCalendlyUrl} />
      </SectionCard>

      {/* Tabs type de lien */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        {TABS.map(tab => (
          <button key={tab.type} onClick={() => setActiveType(tab.type)} style={{
            padding: '14px 12px', borderRadius: 12, cursor: 'pointer', textAlign: 'left',
            border: `1.5px solid ${activeType === tab.type ? typeBadgeColor(tab.type) : 'var(--border)'}`,
            background: activeType === tab.type ? typeBadgeColor(tab.type) + '10' : 'var(--surface)',
            transition: 'all .15s',
          }}>
            <div style={{ fontSize: 18, marginBottom: 5 }}>{tab.icon}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: activeType === tab.type ? typeBadgeColor(tab.type) : 'var(--ink)', marginBottom: 2 }}>{tab.label}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.4 }}>{tab.desc}</div>
          </button>
        ))}
      </div>

      {/* Formulaire actif */}
      {!domainsLoaded
        ? <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 32, textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>Chargement…</div>
        : <>
          {activeType === 'calendly_prospect' && (
            <SectionCard title="Lien Calendly pour un prospect" sub="Lien unique par prospect à envoyer en DM — chaque clic et réservation sera attribué à cette personne et au contenu source.">
              <SectionCalendlyProspect domains={domains} profileId={profileId} posts={posts} calendlyUrl={calendlyUrl} />
            </SectionCard>
          )}
          {activeType === 'description' && (
            <SectionCard title="Lien description de publication" sub="Crée un lien tracké à mettre dans la description d'un contenu. Les clics seront attribués à cette publication.">
              <SectionDescription domains={domains} profileId={profileId} posts={posts} calendlyUrl={calendlyUrl} />
            </SectionCard>
          )}
          {activeType === 'leadmagnet' && (
            <SectionCard title="Lien lead magnet" sub="Quand quelqu'un commente le mot-clé, il reçoit ce lien en DM automatiquement.">
              <SectionLeadMagnet domains={domains} profileId={profileId} posts={posts} />
            </SectionCard>
          )}
        </>}

      {/* Info UTM */}
      <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>ℹ️</span>
        <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.6 }}>
          Chaque lien contient des UTM automatiques (<code>utm_source</code>, <code>utm_medium</code>, <code>utm_campaign</code>, <code>utm_content</code>) pour tracker la source exacte de chaque clic dans l'onglet Business.
        </div>
      </div>
    </div>
  );
}
