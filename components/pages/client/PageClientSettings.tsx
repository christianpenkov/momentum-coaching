'use client';

import { useState } from 'react';
import Icon from '@/components/ui/Icon';

const NETWORKS = [
  { name: 'Instagram', icon: 'instagram', connected: true, account: '@thomas.mrk' },
  { name: 'YouTube', icon: 'youtube', connected: false, account: null },
  { name: 'Stripe', icon: 'dollar-sign', connected: true, account: 'thomas@email.fr' },
  { name: 'Calendly', icon: 'calendar', connected: true, account: 'thomasmrk.com/rdv' },
];

export default function PageClientSettings() {
  const [name, setName] = useState('Thomas Martin');
  const [email, setEmail] = useState('thomas@marketing.fr');

  return (
    <div className="page-content">
      <div className="page-header">
        <h1 className="page-title">Réglages</h1>
      </div>

      {/* Profil */}
      <div className="settings-section">
        <div className="settings-section-title">Mon profil</div>
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
            <div className="avatar" style={{ width: 60, height: 60, fontSize: 20 }}>TM</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)' }}>{name}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{email} · Semaine 8</div>
              <button className="btn-ghost" style={{ marginTop: 8, fontSize: 12 }} type="button">Changer la photo</button>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 6, fontWeight: 500 }}>Prénom & Nom</label>
              <input style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, background: 'var(--surface)', color: 'var(--accent)', outline: 'none', fontFamily: 'inherit' }} value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 6, fontWeight: 500 }}>Email</label>
              <input style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, background: 'var(--surface)', color: 'var(--accent)', outline: 'none', fontFamily: 'inherit' }} value={email} onChange={e => setEmail(e.target.value)} />
            </div>
          </div>
          <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn-primary" type="button">Sauvegarder</button>
          </div>
        </div>
      </div>

      {/* Connexions réseaux */}
      <div className="settings-section" style={{ marginTop: 28 }}>
        <div className="settings-section-title">Mes connexions</div>
        <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
          Connectez vos comptes pour permettre à votre coach de suivre vos progrès en temps réel.
        </p>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {NETWORKS.map((n, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 20px', borderBottom: i < NETWORKS.length - 1 ? '1px solid var(--border)' : 'none' }}>
              <Icon name={n.icon as any} size={20} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>{n.name}</div>
                {n.connected && n.account && (
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{n.account}</div>
                )}
              </div>
              {n.connected ? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span className="pill pill-green" style={{ fontSize: 11 }}>Connecté</span>
                  <button className="btn-ghost" style={{ fontSize: 12 }} type="button">Déconnecter</button>
                </div>
              ) : (
                <button className="btn-primary" style={{ fontSize: 12 }} type="button">
                  <Icon name="link" size={13} /> Connecter
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Notifications */}
      <div className="settings-section" style={{ marginTop: 28 }}>
        <div className="settings-section-title">Notifications</div>
        <div className="card">
          {[
            { label: 'Rappel avant call', desc: 'Recevoir un rappel 1h avant chaque call', enabled: true },
            { label: 'Nouveau message du coach', desc: 'Notification immédiate par email', enabled: true },
            { label: 'Nouvelle ressource débloquée', desc: 'Être notifié lors d\'un nouveau déblocage', enabled: false },
          ].map(({ label, desc, enabled }, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 0', borderBottom: i < 2 ? '1px solid var(--border)' : 'none' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>{label}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{desc}</div>
              </div>
              <div style={{ width: 40, height: 22, borderRadius: 11, background: enabled ? 'var(--accent)' : 'var(--border)', position: 'relative', cursor: 'pointer', flexShrink: 0 }}>
                <div style={{ width: 16, height: 16, borderRadius: '50%', background: 'white', position: 'absolute', top: 3, left: enabled ? 20 : 3, transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
