'use client';

import { useState } from 'react';
import Icon from '@/components/ui/Icon';
import type { IntegrationDef } from '@/lib/onboarding/integrationConfig';
import type { Integration } from '@/lib/supabase/types';

interface IntegrationConnectCardProps {
  config: IntegrationDef;
  integration: Integration | null;
  onSaved: (updated: Integration) => void;
  onDisconnected: () => void;
  showWizardCopy?: boolean;
}

export default function IntegrationConnectCard({ config, integration, onSaved, onDisconnected, showWizardCopy }: IntegrationConnectCardProps) {
  const [editing, setEditing] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);

  async function saveKey() {
    if (!keyInput.trim()) return;
    setKeyError(null);
    setValidating(true);

    const { createClient } = await import('@/lib/supabase/client');
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setValidating(false); return; }

    const validateRes = await fetch('/api/validate-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: config.provider, key: keyInput.trim() }),
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
    const metadata = validation.meta || null;

    if (integration) {
      await supabase.from('integrations').update({ api_key: key, account_label: label, metadata, connected_at: new Date().toISOString() }).eq('id', integration.id);
    } else {
      await supabase.from('integrations').insert({ profile_id: user.id, provider: config.provider, api_key: key, account_label: label, metadata });
    }

    const { data } = await supabase.from('integrations').select('id, profile_id, provider, account_label, connected_at').eq('profile_id', user.id).eq('provider', config.provider).single();
    setSaving(false);
    setEditing(false);
    setKeyInput('');
    if (data) onSaved({ ...data, access_token: null, refresh_token: null, api_key: null, expires_at: null } as Integration);
  }

  async function disconnect() {
    const { createClient } = await import('@/lib/supabase/client');
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    if (config.provider === 'instagram') {
      await fetch('/api/oauth/instagram/disconnect', { method: 'POST' });
    } else {
      await supabase.from('integrations').delete().eq('profile_id', user.id).eq('provider', config.provider);
    }
    onDisconnected();
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', background: 'var(--surface)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px' }}>
        <Icon name={config.icon} size={20} color={integration ? 'var(--green)' : 'var(--muted)'} />
        <div style={{ flex: 1, minWidth: 140 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>{config.name}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{showWizardCopy ? config.wizardCopy : config.desc}</div>
          {integration?.account_label && (
            <div style={{ fontSize: 11, color: 'var(--green)', marginTop: 2 }}>{integration.account_label}</div>
          )}
        </div>

        {integration ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <span className="pill pill-green" style={{ fontSize: 11, flexShrink: 0 }}>Connecté</span>
            {config.mode === 'oauth' && (
              <a href={config.oauthPath} className="btn-ghost" style={{ fontSize: 12, flexShrink: 0, whiteSpace: 'nowrap' }}>Reconnecter</a>
            )}
            {config.mode === 'apikey' && (
              <button className="btn-ghost" style={{ fontSize: 12, flexShrink: 0, whiteSpace: 'nowrap' }} type="button" onClick={() => { setEditing(true); setKeyInput(''); }}>Modifier</button>
            )}
            <button style={{ fontSize: 12, color: 'var(--red)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0, whiteSpace: 'nowrap', padding: '6px 4px' }} type="button" onClick={disconnect}>
              Déconnecter
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {config.mode === 'oauth' ? (
              <a href={config.oauthPath} className="btn-primary-brand" style={{ fontSize: 12, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Icon name="link" size={13} /> Connecter
              </a>
            ) : (
              <button className="btn-primary-brand" style={{ fontSize: 12 }} type="button" onClick={() => { setEditing(true); setKeyInput(''); }}>
                <Icon name="link" size={13} /> Connecter
              </button>
            )}
          </div>
        )}
      </div>

      {config.provider === 'instagram' && !integration && (
        <div style={{ padding: '0 16px 14px', fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
          {config.instructions.map((step, i) => (
            <div key={i}>{step.text}</div>
          ))}
        </div>
      )}

      {editing && config.mode === 'apikey' && (
        <div style={{ padding: '0 16px 16px', background: 'var(--surface-2)', borderTop: '1px solid var(--border)' }}>
          <div style={{ margin: '12px 0 10px', padding: '10px 14px', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
            {config.instructions.map((step, i) => (
              <div key={i}>
                {step.text}{' '}
                {step.href && (
                  <a href={step.href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-brand)', textDecoration: 'underline' }}>{step.hrefLabel}</a>
                )}
              </div>
            ))}
          </div>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>
            Clé API {config.name}
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="password"
              value={keyInput}
              onChange={e => { setKeyInput(e.target.value); setKeyError(null); }}
              placeholder={config.placeholder}
              autoFocus
              style={{ flex: 1, padding: '8px 12px', border: `1px solid ${keyError ? '#fca5a5' : 'var(--border)'}`, borderRadius: 8, fontSize: 13, background: 'var(--surface)', color: 'var(--ink)', fontFamily: 'inherit', outline: 'none' }}
            />
            <button className="btn-primary-brand" style={{ fontSize: 12, minWidth: 110 }} type="button" disabled={validating || saving || !keyInput.trim()} onClick={saveKey}>
              {validating ? '⏳ Vérification…' : saving ? 'Sauvegarde…' : 'Connecter'}
            </button>
            <button className="btn-ghost" style={{ fontSize: 12 }} type="button" onClick={() => { setEditing(false); setKeyError(null); }}>Annuler</button>
          </div>
          {keyError && (
            <div style={{ fontSize: 12, color: '#dc2626', marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', background: '#fef2f2', borderRadius: 6, border: '1px solid #fca5a5' }}>
              ✗ {keyError}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
