'use client';

import { useState, useEffect, useCallback } from 'react';
import { useUser } from '@/lib/UserContext';
import Icon from '@/components/ui/Icon';

const BLUE = '#6b7cde';
const GREEN = '#3f8a52';
const RED = '#cd5b3f';
const AMBER = '#b58025';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ShortDomain { id: string | number; hostname: string; }

type LinkType = 'calendly_prospect' | 'bio' | 'description' | 'leadmagnet';

interface GeneratedLink {
  id: string;
  type: LinkType;
  label: string;
  shortUrl: string;
  originalUrl: string;
  createdAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function slug(s: string) {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function typeLabel(t: LinkType) {
  if (t === 'calendly_prospect') return 'Calendly prospect';
  if (t === 'bio') return 'Lien bio';
  if (t === 'description') return 'Description publication';
  return 'Lead magnet';
}

function typeIcon(t: LinkType) {
  if (t === 'calendly_prospect') return '📅';
  if (t === 'bio') return '🔗';
  if (t === 'description') return '📝';
  return '📄';
}

function typeBadgeColor(t: LinkType) {
  if (t === 'calendly_prospect') return BLUE;
  if (t === 'bio') return '#7c5cbf';
  if (t === 'description') return AMBER;
  return GREEN;
}

// ─── Sous-composants ──────────────────────────────────────────────────────────

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

function Input({ label, hint, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 5 }}>
        {label}{hint && <span style={{ fontWeight: 400, marginLeft: 6, color: 'var(--faint)' }}>{hint}</span>}
      </div>
      <input
        {...props}
        style={{ width: '100%', padding: '9px 12px', fontSize: 13, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--ink)', boxSizing: 'border-box', outline: 'none', ...props.style }}
      />
    </div>
  );
}

function Btn({ children, disabled, loading, variant = 'primary', onClick, style }: {
  children: React.ReactNode; disabled?: boolean; loading?: boolean;
  variant?: 'primary' | 'ghost'; onClick?: () => void; style?: React.CSSProperties;
}) {
  const base: React.CSSProperties = {
    padding: '10px 18px', fontSize: 13, fontWeight: 700, borderRadius: 8, cursor: disabled || loading ? 'not-allowed' : 'pointer',
    border: variant === 'ghost' ? '1px solid var(--border)' : 'none',
    background: variant === 'ghost' ? 'transparent' : BLUE,
    color: variant === 'ghost' ? 'var(--ink)' : '#fff',
    opacity: disabled || loading ? 0.5 : 1, transition: 'opacity .15s', ...style,
  };
  return <button onClick={onClick} disabled={disabled || loading} style={base}>{loading ? 'Génération...' : children}</button>;
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

// ─── Section Bio ──────────────────────────────────────────────────────────────

function SectionBio({ domains, profileId }: { domains: ShortDomain[]; profileId: string }) {
  const [calendlyUrl, setCalendlyUrl] = useState('');
  const [platform, setPlatform] = useState<'instagram' | 'youtube'>('instagram');
  const [customPath, setCustomPath] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const domain = domains[0]?.hostname || 'qnl.link';

  const generate = async () => {
    if (!calendlyUrl.trim()) return;
    setLoading(true); setError(null);
    try {
      const path = customPath || `bio-${platform === 'instagram' ? 'ig' : 'yt'}`;
      const res = await fetch('/api/shortio/links', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          profileId,
          domainId: domain,
          originalUrl: calendlyUrl.trim(),
          title: `Bio ${platform === 'instagram' ? 'Instagram' : 'YouTube'}`,
          utmSource: domain,
          utmMedium: 'bio',
          utmCampaign: `bio-${platform}`,
          path,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur');
      setResult(data.shortUrl);
    } catch (e: any) {
      setError(e.message);
    } finally { setLoading(false); }
  };

  if (result) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>Mets ce lien dans ta bio {platform === 'instagram' ? 'Instagram' : 'YouTube'} — il ne changera jamais, Short.io tracke les clics automatiquement.</div>
      <CopiedLink url={result} onReset={() => { setResult(null); setCalendlyUrl(''); setCustomPath(''); }} />
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', background: 'var(--surface-2)', borderRadius: 8, padding: 3, gap: 2 }}>
        {(['instagram', 'youtube'] as const).map(p => (
          <button key={p} onClick={() => setPlatform(p)} style={{
            flex: 1, padding: '7px', fontSize: 12, fontWeight: 600, borderRadius: 6, cursor: 'pointer', border: 'none',
            background: platform === p ? 'var(--surface)' : 'transparent',
            color: platform === p ? 'var(--ink)' : 'var(--muted)',
            boxShadow: platform === p ? '0 1px 3px rgba(0,0,0,.07)' : 'none',
          }}>
            {p === 'instagram' ? '📸 Instagram' : '▶️ YouTube'}
          </button>
        ))}
      </div>
      <Input
        label="Destination (ton lien Calendly)"
        placeholder="https://calendly.com/ton-nom/discovery"
        value={calendlyUrl}
        onChange={e => setCalendlyUrl(e.target.value)}
      />
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 5 }}>
          Chemin <span style={{ fontWeight: 400, color: 'var(--faint)' }}>(optionnel — auto-généré)</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          <span style={{ padding: '9px 10px', fontSize: 12, color: 'var(--muted)', background: 'var(--surface-2)', borderRight: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{domain}/</span>
          <input
            value={customPath}
            onChange={e => setCustomPath(slug(e.target.value))}
            placeholder={`bio-${platform === 'instagram' ? 'ig' : 'yt'}`}
            style={{ flex: 1, padding: '9px 12px', fontSize: 13, border: 'none', background: 'var(--surface)', color: 'var(--ink)', outline: 'none' }}
          />
        </div>
      </div>
      {error && <div style={{ fontSize: 12, color: RED, background: RED + '12', borderRadius: 6, padding: '8px 12px' }}>{error}</div>}
      <Btn onClick={generate} loading={loading} disabled={!calendlyUrl.trim()}>Générer le lien bio</Btn>
    </div>
  );
}

// ─── Section Calendly Prospect ────────────────────────────────────────────────

function SectionCalendlyProspect({ domains, profileId, posts }: {
  domains: ShortDomain[]; profileId: string;
  posts: { id: string; caption: string; platform: 'IG' | 'YT' }[];
}) {
  const [calendlyUrl, setCalendlyUrl] = useState('');
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
      const usernameSlug = slug(username);
      const path = customPath || usernameSlug;
      const selectedPost = posts.find(p => p.id === postId);
      const res = await fetch('/api/shortio/links', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          profileId,
          domainId: domain,
          originalUrl: calendlyUrl.trim(),
          title: `Calendly — @${username}`,
          utmSource: domain,
          utmMedium: 'dm',
          utmCampaign: `prospect-${usernameSlug}`,
          utmContent: postId || undefined,
          path,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur');
      setResult(data.shortUrl);
    } catch (e: any) {
      setError(e.message);
    } finally { setLoading(false); }
  };

  if (result) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>Envoie ce lien en DM à <strong>@{username}</strong> — les clics et réservations seront trackés.</div>
      <CopiedLink url={result} onReset={() => { setResult(null); setUsername(''); setPostId(''); setCustomPath(''); }} />
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Input
        label="Ton lien Calendly"
        placeholder="https://calendly.com/ton-nom/discovery"
        value={calendlyUrl}
        onChange={e => setCalendlyUrl(e.target.value)}
      />
      <Input
        label="Pseudo Instagram du prospect"
        placeholder="thomas.biz"
        value={username}
        onChange={e => setUsername(e.target.value.replace(/^@/, ''))}
      />
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 5 }}>
          Contenu source <span style={{ fontWeight: 400, color: 'var(--faint)' }}>(optionnel)</span>
        </div>
        <select
          value={postId}
          onChange={e => setPostId(e.target.value)}
          style={{ width: '100%', padding: '9px 12px', fontSize: 13, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--ink)', boxSizing: 'border-box' }}
        >
          <option value="">— Sans attribution —</option>
          {posts.map(p => (
            <option key={p.id} value={p.id}>{p.platform} · {p.caption}</option>
          ))}
        </select>
      </div>
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 5 }}>
          Chemin <span style={{ fontWeight: 400, color: 'var(--faint)' }}>(optionnel — auto-généré depuis le pseudo)</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          <span style={{ padding: '9px 10px', fontSize: 12, color: 'var(--muted)', background: 'var(--surface-2)', borderRight: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{domain}/</span>
          <input
            value={customPath}
            onChange={e => setCustomPath(slug(e.target.value))}
            placeholder={username ? slug(username) : 'pseudo-prospect'}
            style={{ flex: 1, padding: '9px 12px', fontSize: 13, border: 'none', background: 'var(--surface)', color: 'var(--ink)', outline: 'none' }}
          />
        </div>
      </div>
      {error && <div style={{ fontSize: 12, color: RED, background: RED + '12', borderRadius: 6, padding: '8px 12px' }}>{error}</div>}
      <Btn onClick={generate} loading={loading} disabled={!calendlyUrl.trim() || !username.trim()}>Générer le lien prospect</Btn>
    </div>
  );
}

// ─── Section Description publication ─────────────────────────────────────────

function SectionDescription({ domains, profileId, posts }: {
  domains: ShortDomain[]; profileId: string;
  posts: { id: string; caption: string; platform: 'IG' | 'YT' }[];
}) {
  const [destType, setDestType] = useState<'calendly' | 'leadmagnet'>('calendly');
  const [destUrl, setDestUrl] = useState('');
  const [postId, setPostId] = useState('');
  const [customPath, setCustomPath] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const domain = domains[0]?.hostname || 'qnl.link';
  const selectedPost = posts.find(p => p.id === postId);

  const generate = async () => {
    if (!destUrl.trim() || !postId) return;
    setLoading(true); setError(null);
    try {
      const path = customPath || `desc-${slug(selectedPost?.caption.slice(0, 20) || postId)}`;
      const res = await fetch('/api/shortio/links', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          profileId,
          domainId: domain,
          originalUrl: destUrl.trim(),
          title: `Description — ${selectedPost?.caption.slice(0, 40) || postId}`,
          utmSource: domain,
          utmMedium: 'description',
          utmCampaign: destType,
          utmContent: postId,
          path,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur');
      setResult(data.shortUrl);
    } catch (e: any) {
      setError(e.message);
    } finally { setLoading(false); }
  };

  if (result) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>Mets ce lien dans la description de ta publication — les clics seront attribués à ce contenu.</div>
      <CopiedLink url={result} onReset={() => { setResult(null); setDestUrl(''); setPostId(''); setCustomPath(''); }} />
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 5 }}>Publication</div>
        <select
          value={postId}
          onChange={e => setPostId(e.target.value)}
          style={{ width: '100%', padding: '9px 12px', fontSize: 13, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--ink)', boxSizing: 'border-box' }}
        >
          <option value="">— Sélectionne une publication —</option>
          {posts.map(p => (
            <option key={p.id} value={p.id}>{p.platform} · {p.caption}</option>
          ))}
        </select>
      </div>

      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 8 }}>Destination</div>
        <div style={{ display: 'flex', background: 'var(--surface-2)', borderRadius: 8, padding: 3, gap: 2, marginBottom: 12 }}>
          {(['calendly', 'leadmagnet'] as const).map(d => (
            <button key={d} onClick={() => { setDestType(d); setDestUrl(''); }} style={{
              flex: 1, padding: '7px', fontSize: 12, fontWeight: 600, borderRadius: 6, cursor: 'pointer', border: 'none',
              background: destType === d ? 'var(--surface)' : 'transparent',
              color: destType === d ? 'var(--ink)' : 'var(--muted)',
              boxShadow: destType === d ? '0 1px 3px rgba(0,0,0,.07)' : 'none',
            }}>
              {d === 'calendly' ? '📅 Calendly' : '📄 Lead magnet'}
            </button>
          ))}
        </div>
        <Input
          label={destType === 'calendly' ? 'URL Calendly' : 'URL du lead magnet'}
          placeholder={destType === 'calendly' ? 'https://calendly.com/ton-nom/discovery' : 'https://notion.so/ton-guide-pdf'}
          value={destUrl}
          onChange={e => setDestUrl(e.target.value)}
        />
      </div>

      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 5 }}>
          Chemin <span style={{ fontWeight: 400, color: 'var(--faint)' }}>(optionnel — auto-généré)</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          <span style={{ padding: '9px 10px', fontSize: 12, color: 'var(--muted)', background: 'var(--surface-2)', borderRight: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{domain}/</span>
          <input
            value={customPath}
            onChange={e => setCustomPath(slug(e.target.value))}
            placeholder={selectedPost ? `desc-${slug(selectedPost.caption.slice(0, 15))}` : 'desc-contenu'}
            style={{ flex: 1, padding: '9px 12px', fontSize: 13, border: 'none', background: 'var(--surface)', color: 'var(--ink)', outline: 'none' }}
          />
        </div>
      </div>

      {error && <div style={{ fontSize: 12, color: RED, background: RED + '12', borderRadius: 6, padding: '8px 12px' }}>{error}</div>}
      <Btn onClick={generate} loading={loading} disabled={!destUrl.trim() || !postId}>Générer le lien</Btn>
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
      const path = customPath || `lm-${slug(lmName || keyword)}`;
      const res = await fetch('/api/shortio/links', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          profileId,
          domainId: domain,
          originalUrl: lmUrl.trim(),
          title: `Lead magnet — ${lmName || keyword}`,
          utmSource: domain,
          utmMedium: 'leadmagnet',
          utmCampaign: `lm-${slug(keyword)}`,
          utmContent: postId || undefined,
          path,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur');
      setResult(data.shortUrl);
    } catch (e: any) {
      setError(e.message);
    } finally { setLoading(false); }
  };

  if (result) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: 'var(--muted)' }}>
        <span style={{ fontWeight: 600, color: 'var(--ink)' }}>Mot-clé déclencheur :</span> <span style={{ fontWeight: 700, color: BLUE }}>#{keyword}</span>
        {selectedPost && <> · attribué à <span style={{ fontWeight: 600 }}>{selectedPost.caption.slice(0, 40)}…</span></>}
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>Ce lien est envoyé automatiquement en DM lorsqu'un follower commente <strong>#{keyword}</strong>.</div>
      <CopiedLink url={result} onReset={() => { setResult(null); setLmUrl(''); setLmName(''); setKeyword(''); setPostId(''); setCustomPath(''); }} />
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Input
        label="Nom du lead magnet"
        hint="(optionnel)"
        placeholder="Checklist closing, Guide tunnel de vente…"
        value={lmName}
        onChange={e => setLmName(e.target.value)}
      />
      <Input
        label="URL du lead magnet"
        placeholder="https://notion.so/ton-guide-pdf"
        value={lmUrl}
        onChange={e => setLmUrl(e.target.value)}
      />
      <Input
        label="Mot-clé déclencheur"
        placeholder="GUIDE, CHECKLIST, TUNNEL…"
        value={keyword}
        onChange={e => setKeyword(e.target.value.toUpperCase().replace(/\s+/g, ''))}
      />
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 5 }}>
          Attribuer à une publication <span style={{ fontWeight: 400, color: 'var(--faint)' }}>(optionnel)</span>
        </div>
        <select
          value={postId}
          onChange={e => setPostId(e.target.value)}
          style={{ width: '100%', padding: '9px 12px', fontSize: 13, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--ink)', boxSizing: 'border-box' }}
        >
          <option value="">— Sans attribution —</option>
          {posts.map(p => (
            <option key={p.id} value={p.id}>{p.platform} · {p.caption}</option>
          ))}
        </select>
      </div>
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 5 }}>
          Chemin <span style={{ fontWeight: 400, color: 'var(--faint)' }}>(optionnel — auto-généré)</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          <span style={{ padding: '9px 10px', fontSize: 12, color: 'var(--muted)', background: 'var(--surface-2)', borderRight: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{domain}/</span>
          <input
            value={customPath}
            onChange={e => setCustomPath(slug(e.target.value))}
            placeholder={keyword ? `lm-${slug(keyword)}` : 'lm-guide'}
            style={{ flex: 1, padding: '9px 12px', fontSize: 13, border: 'none', background: 'var(--surface)', color: 'var(--ink)', outline: 'none' }}
          />
        </div>
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
          id: p.id,
          caption: (p.caption || 'Publication Instagram').slice(0, 55),
          platform: 'IG' as const,
        }));
        setPosts(prev => [...igPosts, ...prev.filter(p => p.platform === 'YT')]);
      })
      .catch(() => {});

    fetch(`/api/youtube/stats?profileId=${profileId}`)
      .then(r => r.json())
      .then(data => {
        const ytVideos = (data.videos || []).map((v: any) => ({
          id: v.id,
          caption: (v.title || 'Vidéo YouTube').slice(0, 55),
          platform: 'YT' as const,
        }));
        setPosts(prev => [...prev.filter(p => p.platform === 'IG'), ...ytVideos]);
      })
      .catch(() => {});
  }, [profileId]);

  const TABS: { type: LinkType; label: string; icon: string; desc: string }[] = [
    { type: 'calendly_prospect', icon: '📅', label: 'Calendly prospect', desc: 'Lien unique par prospect envoyé en DM' },
    { type: 'bio', icon: '🔗', label: 'Lien bio', desc: 'Bio Instagram ou YouTube — tracké à vie' },
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

      {/* Tabs type de lien */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {TABS.map(tab => (
          <button
            key={tab.type}
            onClick={() => setActiveType(tab.type)}
            style={{
              padding: '14px 16px', borderRadius: 12, cursor: 'pointer', textAlign: 'left',
              border: `1.5px solid ${activeType === tab.type ? typeBadgeColor(tab.type) : 'var(--border)'}`,
              background: activeType === tab.type ? typeBadgeColor(tab.type) + '10' : 'var(--surface)',
              transition: 'all .15s',
            }}
          >
            <div style={{ fontSize: 18, marginBottom: 5 }}>{tab.icon}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: activeType === tab.type ? typeBadgeColor(tab.type) : 'var(--ink)', marginBottom: 2 }}>{tab.label}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.4 }}>{tab.desc}</div>
          </button>
        ))}
      </div>

      {/* Formulaire actif */}
      {!domainsLoaded ? (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 32, textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>
          Chargement…
        </div>
      ) : (
        <>
          {activeType === 'calendly_prospect' && (
            <SectionCard title="Lien Calendly pour un prospect" sub="Génère un lien unique par prospect à envoyer en DM — chaque clic et réservation sera attribué à cette personne et au contenu source.">
              <SectionCalendlyProspect domains={domains} profileId={profileId} posts={posts} />
            </SectionCard>
          )}
          {activeType === 'bio' && (
            <SectionCard title="Lien bio" sub="Un seul lien à créer par plateforme. Mets-le dans ta bio une fois, il tracke les clics et calls bookés à vie.">
              <SectionBio domains={domains} profileId={profileId} />
            </SectionCard>
          )}
          {activeType === 'description' && (
            <SectionCard title="Lien description de publication" sub="Crée un lien tracké à mettre dans la description d'un contenu spécifique. Les clics seront attribués à cette publication.">
              <SectionDescription domains={domains} profileId={profileId} posts={posts} />
            </SectionCard>
          )}
          {activeType === 'leadmagnet' && (
            <SectionCard title="Lien lead magnet" sub="Crée le lien Short.io de ton lead magnet avec le mot-clé déclencheur. Quand quelqu'un commente ce mot sous ton contenu, il reçoit automatiquement ce lien en DM.">
              <SectionLeadMagnet domains={domains} profileId={profileId} posts={posts} />
            </SectionCard>
          )}
        </>
      )}

      {/* Info UTM */}
      <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>ℹ️</span>
        <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.6 }}>
          Chaque lien généré contient des paramètres UTM automatiques (<code>utm_source</code>, <code>utm_medium</code>, <code>utm_campaign</code>, <code>utm_content</code>) pour tracker la source exacte de chaque clic, réservation et deal dans l'onglet Business.
        </div>
      </div>
    </div>
  );
}
