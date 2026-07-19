'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Icon from '@/components/ui/Icon';
import { SESSION_TOPICS, type SessionTopic } from '@/lib/sessionRapport';

type SessionRapportStep = 'attended' | 'topic_notes' | 'done';

interface Props {
  callId: string;
  studentName: string | null;
  scheduledAt: string | null;
  onClose: () => void;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

export default function SessionRapportModal({ callId, studentName, scheduledAt, onClose }: Props) {
  const [step, setStep] = useState<SessionRapportStep>('attended');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [attended, setAttended] = useState<boolean | null>(null);
  const [topic, setTopic] = useState<SessionTopic | null>(null);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && step !== 'topic_notes') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [step, onClose]);

  async function submitRapport(body: { attended: boolean; topic?: string; notes?: string }) {
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/calls/${callId}/session-rapport`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Erreur lors de l\'enregistrement');
      }
      window.dispatchEvent(new Event('notifs-refresh'));
      setStep('done');
    } catch (e: any) {
      setError(e.message || 'Erreur lors de l\'enregistrement');
    } finally {
      setSaving(false);
    }
  }

  function handleNoShow() {
    setAttended(false);
    submitRapport({ attended: false });
  }

  function handlePresent() {
    setAttended(true);
    setStep('topic_notes');
  }

  function handleSubmitTopicNotes() {
    if (!topic) { setError('Choisis un sujet principal.'); return; }
    submitRapport({ attended: true, topic, notes: notes.trim() || undefined });
  }

  return createPortal(
    <div
      onClick={step === 'done' ? onClose : undefined}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.35)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(2px)',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 460, maxWidth: '92vw', background: 'var(--surface)', borderRadius: 16,
          border: '1px solid var(--border)',
          boxShadow: '0 24px 60px rgba(0,0,0,0.18)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="phone-call" size={16} />
            <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--accent)' }}>
              Rapport de session{studentName ? ` — ${studentName}` : ''}
            </span>
          </div>
          <button onClick={onClose} type="button" className="icon-btn"><Icon name="x" size={15} /></button>
        </div>

        <div style={{ padding: '20px 24px' }}>
          {scheduledAt && step === 'attended' && (
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
              Call du {formatDate(scheduledAt)}
            </div>
          )}

          {step === 'attended' && (
            <div>
              <div style={{ fontSize: 13, color: 'var(--ink-2)', marginBottom: 16 }}>
                L'élève était-il présent à ce call ?
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  onClick={handlePresent}
                  disabled={saving}
                  className="btn-primary-brand"
                  style={{ flex: 1, minHeight: 44, gap: 6 }}
                >
                  <Icon name="check" size={14} /> Présent
                </button>
                <button
                  type="button"
                  onClick={handleNoShow}
                  disabled={saving}
                  className="btn-ghost"
                  style={{ flex: 1, minHeight: 44, gap: 6, borderColor: 'var(--red)', color: 'var(--red)' }}
                >
                  <Icon name="x" size={14} /> No-show
                </button>
              </div>
            </div>
          )}

          {step === 'topic_notes' && (
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Sujet principal du call
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 20 }}>
                {SESSION_TOPICS.map(t => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => { setTopic(t.value); setError(''); }}
                    style={{
                      padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                      cursor: 'pointer', transition: 'all 0.12s', minHeight: 44,
                      border: `1.5px solid ${topic === t.value ? 'var(--accent-brand)' : 'var(--border)'}`,
                      background: topic === t.value ? 'var(--accent-brand-soft)' : 'var(--surface-2)',
                      color: topic === t.value ? 'var(--accent-brand)' : 'var(--muted)',
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Notes (facultatif)
              </label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Ce qu'il faut retenir de cette séance…"
                style={{
                  width: '100%', minHeight: 90, padding: '10px 12px',
                  border: '1px solid var(--border)', borderRadius: 8,
                  background: 'var(--surface-2)', fontSize: 13, color: 'var(--accent)',
                  resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6,
                  outline: 'none', boxSizing: 'border-box',
                }}
              />

              {error && <div role="alert" style={{ fontSize: 11, color: 'var(--red)', marginTop: 8 }}>{error}</div>}
            </div>
          )}

          {step === 'done' && (
            <div style={{ textAlign: 'center', padding: '12px 0' }}>
              <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--green-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
                <Icon name="check" size={20} style={{ color: 'var(--green)' }} />
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)' }}>
                {attended === false ? 'No-show enregistré' : 'Rapport enregistré'}
              </div>
            </div>
          )}

          {step === 'attended' && error && (
            <div role="alert" style={{ fontSize: 11, color: 'var(--red)', marginTop: 12 }}>{error}</div>
          )}
        </div>

        {step === 'topic_notes' && (
          <div style={{ padding: '0 24px 20px', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button onClick={() => setStep('attended')} className="btn-ghost" type="button" disabled={saving}>Retour</button>
            <button
              onClick={handleSubmitTopicNotes}
              className="btn-primary-brand"
              type="button"
              disabled={saving}
            >
              {saving ? 'Enregistrement…' : 'Enregistrer le rapport'}
            </button>
          </div>
        )}

        {step === 'done' && (
          <div style={{ padding: '0 24px 20px', display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={onClose} className="btn-primary-brand" type="button">Fermer</button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
