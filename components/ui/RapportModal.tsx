'use client';

import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '@/components/ui/Icon';

type RapportStep = 'show_up' | 'closed' | 'revenue' | 'rescheduled';

interface Props {
  callId: string;
  inviteeName: string | null;
  scheduledAt: string | null;
  onClose: () => void;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export default function RapportModal({ callId, inviteeName, scheduledAt, onClose }: Props) {
  const [step, setStep] = useState<RapportStep>('show_up');
  const [revenue, setRevenue] = useState('');
  const [saving, setSaving] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function save(patch: { no_show?: boolean; deal_closed?: boolean; revenue?: number; outcome?: string; rescheduled?: boolean; rescheduled_at?: string }) {
    setSaving(true);
    // Champs rapport classiques via route dédiée
    const rapportFields: Record<string, any> = {};
    const callFields: Record<string, any> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (['rescheduled', 'rescheduled_at'].includes(k)) callFields[k] = v;
      else rapportFields[k] = v;
    }
    const calls: Promise<any>[] = [];
    if (Object.keys(rapportFields).length > 0) {
      calls.push(fetch(`/api/calls/${callId}/rapport`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rapportFields),
      }));
    }
    if (Object.keys(callFields).length > 0) {
      calls.push(fetch(`/api/client/calls/${callId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(callFields),
      }));
    }
    await Promise.all(calls);
    setSaving(false);
    window.dispatchEvent(new Event('notifs-refresh'));
    onClose();
  }

  async function handleShowUp(showedUp: boolean) {
    if (!showedUp) await save({ no_show: true, deal_closed: false, revenue: 0, outcome: 'no_show' });
    else setStep('closed');
  }

  async function handleRevenue() {
    const amount = parseFloat(revenue.replace(',', '.')) || 0;
    await save({ no_show: false, deal_closed: true, revenue: amount, outcome: 'closed' });
  }

  return createPortal(
    <>
      {/* Overlay */}
      <div
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 3000 }}
        onClick={onClose}
      />
      {/* Panel — bottom-sheet normal, full-screen à l'étape revenue */}
      <div
        ref={panelRef}
        style={{
          position: 'fixed',
          left: 0, right: 0,
          ...(step === 'revenue'
            ? { top: 0, bottom: 0, borderRadius: 0 }
            : { top: 'auto', bottom: 0, borderRadius: '20px 20px 0 0', maxHeight: '90vh' }
          ),
          margin: '0 auto',
          width: '100%', maxWidth: 520,
          background: 'var(--surface)',
          padding: '48px 24px 32px',
          overflowY: 'auto',
          zIndex: 3001,
        }}
      >
        {/* En-tête */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
              Rapport de call
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)' }}>
              {inviteeName ? `Appel avec ${inviteeName}` : 'Appel découverte'}
            </div>
            {scheduledAt && (
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                {formatDate(scheduledAt)} · {formatTime(scheduledAt)}
              </div>
            )}
          </div>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--muted)' }}>
            <Icon name="x" size={18} />
          </button>
        </div>

        {/* Étape 1 — présent ? */}
        {step === 'show_up' && (
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent)', marginBottom: 8 }}>Le lead s'est présenté ?</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 24, lineHeight: 1.6 }}>Était-il au rendez-vous ?</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button className="btn-primary" type="button" style={{ width: '100%', padding: '16px', fontSize: 15, fontWeight: 700 }} disabled={saving} onClick={() => handleShowUp(true)}>
                Oui, il était là
              </button>
              <button className="btn-ghost" type="button" style={{ width: '100%', padding: '14px', fontSize: 14, color: 'var(--muted)' }} disabled={saving} onClick={() => handleShowUp(false)}>
                No-show
              </button>
              <button
                className="btn-ghost"
                type="button"
                style={{ width: '100%', padding: '14px', fontSize: 14, color: '#d97706', border: '1px solid #fcd34d' }}
                disabled={saving}
                onClick={() => save({ rescheduled: true, rescheduled_at: new Date().toISOString() })}
              >
                Appel reporté — nouvelle date à planifier
              </button>
            </div>
          </div>
        )}

        {/* Étape 2 — outcome */}
        {step === 'closed' && (
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent)', marginBottom: 8 }}>Résultat du call ?</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 24, lineHeight: 1.6 }}>Qu'est-ce qui s'est passé ?</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                className="btn-primary"
                type="button"
                style={{ width: '100%', padding: '16px', fontSize: 15, fontWeight: 700 }}
                disabled={saving}
                onClick={() => setStep('revenue')}
              >
                Oui, deal closé !
              </button>
              <button
                className="btn-ghost"
                type="button"
                style={{ width: '100%', padding: '14px', fontSize: 14, color: 'var(--accent)', border: '1px solid var(--border)' }}
                disabled={saving}
                onClick={() => save({ no_show: false, deal_closed: false, revenue: 0, outcome: 'second_call' })}
              >
                2ème call prévu
              </button>
              <button
                className="btn-ghost"
                type="button"
                style={{ width: '100%', padding: '14px', fontSize: 14, color: 'var(--accent)', border: '1px solid var(--border)' }}
                disabled={saving}
                onClick={() => save({ no_show: false, deal_closed: false, revenue: 0, outcome: 'to_recontact' })}
              >
                À recontacter
              </button>
              <button
                className="btn-ghost"
                type="button"
                style={{ width: '100%', padding: '14px', fontSize: 14, color: 'var(--muted)', border: '1px solid var(--border)' }}
                disabled={saving}
                onClick={() => save({ no_show: false, deal_closed: false, revenue: 0, outcome: 'not_closed' })}
              >
                Pas closé
              </button>
            </div>
          </div>
        )}

        {/* Étape 3 — montant */}
        {step === 'revenue' && (
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent)', marginBottom: 8 }}>Montant du deal ?</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 24, lineHeight: 1.6 }}>Quel montant a été signé ?</div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 20 }}>
              <input
                ref={inputRef}
                className="input"
                type="number"
                min="0"
                step="any"
                placeholder="0"
                value={revenue}
                onChange={e => setRevenue(e.target.value)}
                style={{ flex: 1, fontSize: 20, fontWeight: 700, textAlign: 'right' }}
                autoFocus
                inputMode="decimal"
              />
              <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent)' }}>€</span>
            </div>
            <button
              className="btn-primary"
              type="button"
              style={{ width: '100%', padding: '16px', fontSize: 15, fontWeight: 700 }}
              disabled={saving}
              onClick={handleRevenue}
            >
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        )}
      </div>
    </>,
    document.body
  );
}
