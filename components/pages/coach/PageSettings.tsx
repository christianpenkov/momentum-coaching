'use client';

import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import Icon from '@/components/ui/Icon';
import Avatar from '@/components/ui/Avatar';
import { createClient } from '@/lib/supabase/client';
import { cropImageToSquare } from '@/lib/cropImageToSquare';
import { useUser } from '@/lib/UserContext';
import type { Integration, Provider } from '@/lib/supabase/types';

type IntegrationMode = 'oauth' | 'apikey';

const INTEGRATION_CONFIG: {
  provider: Provider;
  name: string;
  icon: string;
  desc: string;
  mode: IntegrationMode;
  placeholder?: string;
  oauthPath?: string;
}[] = [
  {
    provider: 'anthropic',
    name: 'Claude IA',
    icon: 'sparkle',
    desc: "Clé API Anthropic pour l'assistant IA intégré",
    mode: 'apikey',
    placeholder: 'sk-ant-api03-...',
  },
  {
    provider: 'stripe',
    name: 'Stripe — Clé secrète',
    icon: 'stripe',
    desc: 'Clé secrète pour lire les données clients et paiements',
    mode: 'apikey',
    placeholder: 'sk_live_... ou sk_test_...',
  },
  {
    provider: 'stripe_webhook',
    name: 'Stripe — Webhook secret',
    icon: 'shield',
    desc: 'Secret webhook pour déclencher l\'onboarding automatique après chaque paiement',
    mode: 'apikey',
    placeholder: 'whsec_...',
  },
  {
    provider: 'calendly',
    name: 'Calendly',
    icon: 'calendar',
    desc: 'Calls synchronisés, rappels automatiques',
    mode: 'oauth',
    oauthPath: '/api/oauth/calendly',
  },
  {
    provider: 'instagram',
    name: 'Instagram',
    icon: 'instagram',
    desc: 'Followers, engagement, métriques IG',
    mode: 'apikey',
    placeholder: 'Token API Instagram',
  },
  {
    provider: 'youtube',
    name: 'YouTube',
    icon: 'youtube',
    desc: 'Abonnés, vues, analytics — connexion sécurisée via Google',
    mode: 'oauth',
    oauthPath: '/api/oauth/youtube',
  },
  {
    provider: 'google',
    name: 'Google Calendar',
    icon: 'calendar',
    desc: 'Créer des calls Google Meet directement depuis Momentum',
    mode: 'oauth',
    oauthPath: '/api/oauth/google',
  },
  {
    provider: 'shortio',
    name: 'Short.io',
    icon: 'link',
    desc: 'CTR lien en bio',
    mode: 'apikey',
    placeholder: 'Clé API Short.io',
  },
];

export default function PageSettings() {
  const supabase = createClient();
  const searchParams = useSearchParams();
  const { user, refreshUser } = useUser();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const [integrations, setIntegrations] = useState<Record<Provider, Integration | null>>({
    anthropic: null, stripe: null, stripe_webhook: null, calendly: null, instagram: null, youtube: null, shortio: null, google: null,
  });
  const [editing, setEditing] = useState<Provider | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [coachName, setCoachName] = useState('');
  const [email, setEmail] = useState('');
  const [profileId, setProfileId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; error?: boolean } | null>(null);
  const [justSaved, setJustSaved] = useState<Provider | null>(null);

  useEffect(() => {
    const connected = searchParams.get('connected');
    if (connected) {
      const name = INTEGRATION_CONFIG.find(c => c.provider === connected)?.name || connected;
      showToast(`${name} connecté avec succès ✓`);
    }
    const error = searchParams.get('error');
    if (error) showToast(`Erreur de connexion (${error})`, true);
  }, [searchParams]);

  function showToast(msg: string, isError = false) {
    setToast({ msg, error: isError });
    setTimeout(() => setToast(null), 3500);
  }

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setProfileId(user.id);
      setEmail(user.email || '');

      const { data: profile } = await supabase.from('profiles').select('full_name, avatar_url').eq('id', user.id).single();
      if (profile) { setCoachName(profile.full_name || ''); setAvatarUrl(profile.avatar_url || null); }

      const { data: integs } = await supabase.from('integrations').select('*').eq('profile_id', user.id);
      if (integs) {
        const map = { anthropic: null, stripe: null, stripe_webhook: null, calendly: null, instagram: null, youtube: null, shortio: null, google: null } as Record<Provider, Integration | null>;
        integs.forEach((i: Integration) => { map[i.provider] = i; });
        setIntegrations(map);
      }
    }
    load();
  }, []);

  async function saveKey(provider: Provider) {
    if (!profileId || !keyInput.trim()) return;
    setKeyError(null);
    setValidating(true);

    // Validation de la clé avant sauvegarde
    const validateRes = await fetch('/api/validate-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, key: keyInput.trim() }),
    });
    const validation = await validateRes.json();
    setValidating(false);

    if (!validation.valid) {
      setKeyError(validation.error || 'Clé invalide');
      return;
    }

    setSaving(true);
    const key = keyInput.trim();
    const label = validation.label || null;

    const existing = integrations[provider];
    if (existing) {
      await supabase.from('integrations').update({ api_key: key, account_label: label, connected_at: new Date().toISOString() }).eq('id', existing.id);
    } else {
      await supabase.from('integrations').insert({ profile_id: profileId, provider, api_key: key, account_label: label });
    }

    const { data, error: fetchErr } = await supabase.from('integrations').select('*').eq('profile_id', profileId).eq('provider', provider).single();
    if (fetchErr) {
      setSaving(false);
      showToast('Erreur de sauvegarde : ' + fetchErr.message, true);
      return;
    }
    setIntegrations(prev => ({ ...prev, [provider]: data }));
    setEditing(null);
    setKeyInput('');
    setKeyError(null);
    setSaving(false);
    setJustSaved(provider);
    setTimeout(() => setJustSaved(null), 2500);
    showToast(`${INTEGRATION_CONFIG.find(c => c.provider === provider)?.name} connecté ✓`);
  }

  async function disconnect(provider: Provider) {
    if (!profileId) return;
    await supabase.from('integrations').delete().eq('profile_id', profileId).eq('provider', provider);
    setIntegrations(prev => ({ ...prev, [provider]: null }));
  }

  async function saveProfile() {
    if (!profileId) return;
    const { error } = await supabase.from('profiles')
      .upsert({ id: profileId, full_name: coachName, role: 'coach' }, { onConflict: 'id' });
    if (error) showToast('Erreur : ' + error.message, true);
    else showToast('Profil sauvegardé ✓');
  }

  async function onAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !profileId) return;
    setUploadingAvatar(true);
    try {
      const blob = await cropImageToSquare(file);
      const path = `${profileId}/avatar.jpg`;
      const { error: uploadErr } = await supabase.storage.from('avatars')
        .upload(path, blob, { contentType: 'image/jpeg', upsert: true });
      if (uploadErr) throw uploadErr;
      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
      const freshUrl = `${urlData.publicUrl}?t=${Date.now()}`;
      const { error: updateErr } = await supabase.from('profiles').update({ avatar_url: freshUrl }).eq('id', profileId);
      if (updateErr) throw updateErr;
      setAvatarUrl(freshUrl);
      refreshUser();
      showToast('Photo de profil mise à jour ✓');
    } catch (err) {
      showToast('Erreur upload photo : ' + (err instanceof Error ? err.message : 'inconnue'), true);
    } finally {
      setUploadingAvatar(false);
    }
  }

  return (
    <div className="page-content">
      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: 24, right: 24, zIndex: 9999,
          background: toast.error ? '#fef2f2' : '#f0fdf4',
          border: `1px solid ${toast.error ? '#fca5a5' : '#86efac'}`,
          borderRadius: 12, padding: '14px 20px', fontSize: 13,
          color: toast.error ? '#dc2626' : '#16a34a',
          boxShadow: '0 4px 24px rgba(0,0,0,0.10)',
          display: 'flex', alignItems: 'center', gap: 10,
          fontWeight: 600,
          animation: 'slideIn 0.25s ease',
        }}>
          <span style={{ fontSize: 16 }}>{toast.error ? '✗' : '✓'}</span> {toast.msg}
        </div>
      )}

      <div className="page-header">
        <h1 className="page-title">Réglages</h1>
      </div>

      {/* Profil */}
      <div className="settings-section" style={{ padding: 20 }}>
        <div className="settings-section-title">Profil coach</div>
        <div className="card" style={{ border: 'none', boxShadow: 'none', padding: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
            <div
              onClick={() => !uploadingAvatar && avatarInputRef.current?.click()}
              className="tap-scale"
              style={{ position: 'relative', width: 72, height: 72, borderRadius: '50%', cursor: uploadingAvatar ? 'default' : 'pointer', flexShrink: 0 }}
            >
              <Avatar initials={coachName.slice(0, 2).toUpperCase() || '?'} avatarUrl={avatarUrl} size={72} />
              <div style={{
                position: 'absolute', inset: 0, borderRadius: '50%',
                background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                opacity: uploadingAvatar ? 1 : 0, transition: 'opacity 150ms',
              }}
                onMouseEnter={e => { if (!uploadingAvatar) e.currentTarget.style.opacity = '1'; }}
                onMouseLeave={e => { if (!uploadingAvatar) e.currentTarget.style.opacity = '0'; }}
              >
                <Icon name={uploadingAvatar ? 'loader' : 'camera'} size={18} color="#fff" style={uploadingAvatar ? { animation: 'spin 1s linear infinite' } : undefined} />
              </div>
            </div>
            <input ref={avatarInputRef} type="file" accept="image/*" onChange={onAvatarChange} style={{ display: 'none' }} />
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              Photo de profil<br />
              <span style={{ fontSize: 11 }}>Visible par ton élève dans la messagerie</span>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>Nom</label>
              <input value={coachName} onChange={e => setCoachName(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, background: 'var(--surface)', color: 'var(--accent)', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>Email</label>
              <input value={email} readOnly
                style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, background: 'var(--surface-2)', color: 'var(--muted)', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
            </div>
          </div>
          <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn-primary-brand" type="button" onClick={saveProfile}>Sauvegarder</button>
          </div>
        </div>
      </div>

      {/* Intégrations */}
      <div className="settings-section" style={{ marginTop: 28, padding: '20px 20px 0' }}>
        <div className="settings-section-title">Intégrations</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
          Colle tes clés API — stockées chiffrées, jamais exposées.
        </div>
        <div className="card" style={{ margin: '0 -20px', padding: 0, overflow: 'hidden', border: 'none', borderRadius: '0 0 var(--r-xl) var(--r-xl)', borderTop: '1px solid var(--border-soft)', boxShadow: 'none' }}>
          {INTEGRATION_CONFIG.map((cfg, i) => {
            const integ = integrations[cfg.provider];
            const isEditing = editing === cfg.provider;
            const isSaved = justSaved === cfg.provider;
            return (
              <div key={cfg.provider} style={{
                borderBottom: i < INTEGRATION_CONFIG.length - 1 ? '1px solid var(--border)' : 'none',
                transition: 'background 0.4s ease',
                background: isSaved ? '#f0fdf4' : 'transparent',
              }}>
                <div className="settings-row" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 20px' }}>
                  <Icon name={cfg.icon as any} size={20} color={integ ? 'var(--green)' : 'var(--muted)'} />
                  <div style={{ flex: 1, minWidth: 140 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>{cfg.name}</span>
                      {cfg.mode === 'oauth' && (
                        <span style={{ fontSize: 10, padding: '2px 7px', background: 'var(--accent-soft)', color: 'var(--accent)', borderRadius: 20, fontWeight: 600 }}>OAuth</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{cfg.desc}</div>
                    {integ?.account_label && (
                      <div style={{ fontSize: 11, color: 'var(--green)', marginTop: 2 }}>{integ.account_label}</div>
                    )}
                  </div>

                  {integ ? (
                    <div className="settings-row-actions" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <span className="pill pill-green" style={{ fontSize: 11, flexShrink: 0 }}>Connecté</span>
                      {cfg.mode === 'oauth' && (
                        <a href={cfg.oauthPath} className="btn-ghost" style={{ fontSize: 12, flexShrink: 0, whiteSpace: 'nowrap' }}>
                          Reconnecter
                        </a>
                      )}
                      {cfg.mode === 'apikey' && (
                        <button className="btn-ghost" style={{ fontSize: 12, flexShrink: 0, whiteSpace: 'nowrap' }} type="button" onClick={() => { setEditing(cfg.provider); setKeyInput(''); }}>
                          Modifier
                        </button>
                      )}
                      <button style={{ fontSize: 12, color: 'var(--red)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0, whiteSpace: 'nowrap', padding: '6px 4px' }} type="button" onClick={() => disconnect(cfg.provider)}>
                        Déconnecter
                      </button>
                    </div>
                  ) : cfg.mode === 'oauth' ? (
                    <a href={cfg.oauthPath} className="btn-primary-brand" style={{ fontSize: 12, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <Icon name="link" size={13} /> Connecter
                    </a>
                  ) : (
                    <button className="btn-primary-brand" style={{ fontSize: 12 }} type="button" onClick={() => { setEditing(cfg.provider); setKeyInput(''); }}>
                      <Icon name="link" size={13} /> Connecter
                    </button>
                  )}
                </div>

                {/* Formulaire clé API inline */}
                {isEditing && cfg.mode === 'apikey' && (
                  <div style={{ padding: '0 20px 16px', background: 'var(--surface-2)', borderTop: '1px solid var(--border)' }}>
                    {cfg.provider === 'stripe' && (
                      <div style={{ margin: '12px 0 10px', padding: '10px 14px', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
                        <div style={{ fontWeight: 600, color: 'var(--accent)', marginBottom: 4 }}>Comment récupérer ta clé Stripe :</div>
                        <div>1. Ouvre ton dashboard Stripe →{' '}
                          <a href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>dashboard.stripe.com/apikeys</a>
                        </div>
                        <div>2. Copie la <strong>Clé secrète</strong> (<code>sk_live_...</code> en prod, <code>sk_test_...</code> en test)</div>
                        <div>3. Colle-la ci-dessous</div>
                      </div>
                    )}
                    {cfg.provider === 'anthropic' && (
                      <div style={{ margin: '12px 0 10px', padding: '10px 14px', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
                        <div style={{ fontWeight: 600, color: 'var(--accent)', marginBottom: 4 }}>Comment récupérer ta clé Anthropic :</div>
                        <div>1. Ouvre →{' '}
                          <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>console.anthropic.com/settings/keys</a>
                        </div>
                        <div>2. Clique <strong>Create Key</strong> → copie la clé (<code>sk-ant-...</code>)</div>
                        <div>3. Colle-la ci-dessous</div>
                      </div>
                    )}
                    {cfg.provider === 'stripe_webhook' && (
                      <div style={{ margin: '12px 0 10px', padding: '10px 14px', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
                        <div style={{ fontWeight: 600, color: 'var(--accent)', marginBottom: 4 }}>Comment récupérer ton webhook secret :</div>
                        <div>1. Ouvre →{' '}
                          <a href="https://dashboard.stripe.com/webhooks" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>dashboard.stripe.com/webhooks</a>
                        </div>
                        <div>2. Clique sur ton endpoint <code>momentum-plateforme.vercel.app/api/webhooks/stripe</code></div>
                        <div>3. Clique <strong>"Révéler"</strong> à côté de "Secret de signature"</div>
                        <div>4. Copie le secret (<code>whsec_...</code>) et colle-le ci-dessous</div>
                      </div>
                    )}
                    {cfg.provider === 'calendly' && (
                      <div style={{ margin: '12px 0 10px', padding: '10px 14px', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
                        <div style={{ fontWeight: 600, color: 'var(--accent)', marginBottom: 4 }}>Connexion Calendly :</div>
                        <div>La connexion Calendly se fait via le bouton OAuth ci-dessus.</div>
                      </div>
                    )}
                    {cfg.provider === 'youtube' && (
                      <div style={{ margin: '12px 0 10px', padding: '10px 14px', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
                        <div style={{ fontWeight: 600, color: 'var(--accent)', marginBottom: 4 }}>Comment récupérer ta clé API YouTube :</div>
                        <div>1. Ouvre →{' '}
                          <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>console.cloud.google.com/apis/credentials</a>
                        </div>
                        <div>2. Crée un projet si tu n'en as pas, puis active <strong>YouTube Data API v3</strong></div>
                        <div>3. Clique <strong>"Créer des identifiants"</strong> → <strong>"Clé API"</strong></div>
                        <div>4. Copie la clé (<code>AIza...</code>) et colle-la ci-dessous</div>
                        <div style={{ marginTop: 6, padding: '6px 10px', background: 'var(--surface-2)', borderRadius: 6, color: 'var(--muted)', fontSize: 11 }}>
                          ⚠️ La clé API donne accès aux stats publiques (vues, abonnés). Pour les analytics avancées (rétention, sources de trafic), la connexion OAuth est nécessaire — contacte le support.
                        </div>
                      </div>
                    )}
                    {cfg.provider === 'shortio' && (
                      <div style={{ margin: '12px 0 10px', padding: '10px 14px', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
                        <div style={{ fontWeight: 600, color: 'var(--accent)', marginBottom: 4 }}>Comment récupérer ta clé API Short.io :</div>
                        <div>1. Ouvre →{' '}
                          <a href="https://app.short.io/settings/integrations/api-key" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>app.short.io/settings/integrations/api-key</a>
                        </div>
                        <div>2. Clique <strong>"+ Créer la clé API"</strong> en haut à droite</div>
                        <div>3. Choisis <strong>Clé privée</strong>, laisse la description vide, clique <strong>"Créer"</strong></div>
                        <div>4. Copie la clé (commence par <code style={{ background: 'var(--surface-2)', padding: '1px 4px', borderRadius: 3 }}>sk_</code>) et colle-la ci-dessous — elle ne sera plus visible après</div>
                      </div>
                    )}
                    {cfg.provider === 'instagram' && (
                      <div style={{ margin: '12px 0 10px', padding: '10px 14px', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
                        <div style={{ fontWeight: 600, color: 'var(--accent)', marginBottom: 4 }}>Connexion Instagram :</div>
                        <div>Le token Instagram est généré automatiquement via la connexion OAuth dans les réglages de compte. Si tu ne l'as pas encore, utilise le bouton <strong>"Connecter Instagram"</strong> depuis la page Analytics.</div>
                      </div>
                    )}
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>
                      Clé API {cfg.name}
                    </label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        type="password"
                        value={keyInput}
                        onChange={e => { setKeyInput(e.target.value); setKeyError(null); }}
                        placeholder={cfg.placeholder}
                        autoFocus
                        style={{ flex: 1, padding: '8px 12px', border: `1px solid ${keyError ? '#fca5a5' : 'var(--border)'}`, borderRadius: 8, fontSize: 13, background: 'var(--surface)', color: 'var(--ink)', fontFamily: 'inherit', outline: 'none' }}
                      />
                      <button className="btn-primary-brand" style={{ fontSize: 12, minWidth: 110 }} type="button" disabled={validating || saving || !keyInput.trim()} onClick={() => saveKey(cfg.provider)}>
                        {validating ? '⏳ Vérification…' : saving ? 'Sauvegarde…' : 'Connecter'}
                      </button>
                      <button className="btn-ghost" style={{ fontSize: 12 }} type="button" onClick={() => { setEditing(null); setKeyError(null); }}>
                        Annuler
                      </button>
                    </div>
                    {keyError && (
                      <div style={{ fontSize: 12, color: '#dc2626', marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', background: '#fef2f2', borderRadius: 6, border: '1px solid #fca5a5' }}>
                        ✗ {keyError}
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
                      <Icon name="shield" size={12} /> Clé vérifiée puis stockée chiffrée — jamais exposée
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Déconnexion */}
      <div className="settings-section" style={{ marginTop: 28 }}>
        <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>Se déconnecter</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Fermer la session sur cet appareil</div>
          </div>
          <button className="logout-button" type="button" onClick={async () => {
            // scope: 'local' — le scope par défaut de signOut() est 'global' et
            // déconnecterait TOUS les appareils de ce compte, pas seulement celui-ci
            // (contrairement à ce que le texte du bouton promet).
            await createClient().auth.signOut({ scope: 'local' });
            window.location.href = '/login';
          }}>
            Se déconnecter
            <div className="icon">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
