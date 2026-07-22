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
  topic?: string | null;
  onClose: () => void;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

export default function SessionRapportModal({ callId, studentName, scheduledAt, topic: callTopic, onClose }: Props) {
  const [step, setStep] = useState<SessionRapportStep>('attended');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [attended, setAttended] = useState<boolean | null>(null);
  const [topic, setTopic] = useState<SessionTopic | null>(null);
  const [topicCustom, setTopicCustom] = useState('');
  const [notes, setNotes] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmChecked, setConfirmChecked] = useState(false);

  // En plein milieu du rapport (étape topic_notes) : demander confirmation avant de fermer,
  // pour ne pas perdre la saisie en cours. Sinon (attended, ou terminé) fermeture directe.
  function requestClose() {
    if (step === 'topic_notes') { setConfirmChecked(false); setConfirmClose(true); }
    else onClose();
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') requestClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [step]);

  async function submitRapport(body: { attended: boolean; topic?: string; topic_custom?: string; notes?: string }) {
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
    if (topic === 'autre' && !topicCustom.trim()) { setError('Précise le sujet en 2-3 mots.'); return; }
    submitRapport({
      attended: true,
      topic,
      topic_custom: topic === 'autre' ? topicCustom.trim() : undefined,
      notes: notes.trim() || undefined,
    });
  }

  const modal = createPortal(
    <div
      onClick={requestClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 5000,
        background: 'rgba(0,0,0,0.35)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(2px)',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 520, maxWidth: '92vw', background: 'var(--surface)', borderRadius: 18,
          border: '1px solid var(--border)',
          boxShadow: '0 24px 60px rgba(0,0,0,0.18)',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {/* Header */}
        <div style={{ padding: '26px 30px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <Icon name="phone-call" size={20} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--accent)' }}>
                Rapport de session{studentName ? ` — ${studentName}` : ''}
              </div>
              {callTopic && (
                <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>{callTopic}</div>
              )}
            </div>
          </div>
          <button onClick={requestClose} type="button" className="icon-btn"><Icon name="x" size={18} /></button>
        </div>

        <div style={{ padding: '26px 30px' }}>
          {scheduledAt && step === 'attended' && (
            <div style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 20 }}>
              Call du {formatDate(scheduledAt)}
            </div>
          )}

          {step === 'attended' && (
            <div>
              <div style={{ fontSize: 16, color: 'var(--ink-2)', marginBottom: 22 }}>
                L'élève était-il présent à ce call ?
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <button
                  type="button"
                  onClick={handlePresent}
                  disabled={saving}
                  className="btn-primary-brand"
                  style={{ flex: 1, minHeight: 56, fontSize: 15, gap: 8 }}
                >
                  <Icon name="check" size={17} /> Présent
                </button>
                <button
                  type="button"
                  onClick={handleNoShow}
                  disabled={saving}
                  className="btn-ghost"
                  style={{ flex: 1, minHeight: 56, fontSize: 15, gap: 8, borderColor: 'var(--red)', color: 'var(--red)' }}
                >
                  <Icon name="x" size={17} /> No-show
                </button>
              </div>
            </div>
          )}

          {step === 'topic_notes' && (
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Sujet principal du call
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: topic === 'autre' ? 12 : 24 }}>
                {SESSION_TOPICS.map(t => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => { setTopic(t.value); setError(''); }}
                    style={{
                      padding: '10px 14px', borderRadius: 9, fontSize: 13, fontWeight: 600,
                      cursor: 'pointer', transition: 'all 0.12s', minHeight: 48,
                      border: `1.5px solid ${topic === t.value ? 'var(--accent-brand)' : 'var(--border)'}`,
                      background: topic === t.value ? 'var(--accent-brand-soft)' : 'var(--surface-2)',
                      color: topic === t.value ? 'var(--accent-brand)' : 'var(--muted)',
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {topic === 'autre' && (
                <input
                  autoFocus
                  value={topicCustom}
                  onChange={e => { setTopicCustom(e.target.value); setError(''); }}
                  placeholder="En 2-3 mots : ex. gestion du temps"
                  maxLength={60}
                  style={{
                    width: '100%', padding: '10px 14px', marginBottom: 24,
                    border: '1px solid var(--border)', borderRadius: 10,
                    background: 'var(--surface-2)', fontSize: 14, color: 'var(--accent)',
                    outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
                  }}
                />
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Notes — impressions / à suivre / tâches <span style={{ textTransform: 'none', fontWeight: 400 }}>(facultatif)</span>
                </label>
                <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--muted)' }}>
                  <Icon name="lock" size={10} /> Privé, visible coach uniquement
                </span>
              </div>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Ressenti sur la séance, points à retravailler, idées de tâches à donner…"
                style={{
                  width: '100%', minHeight: 130, padding: '12px 14px',
                  border: '1px solid var(--border)', borderRadius: 10,
                  background: 'var(--surface-2)', fontSize: 14, color: 'var(--accent)',
                  resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6,
                  outline: 'none', boxSizing: 'border-box',
                }}
              />

              {error && <div role="alert" style={{ fontSize: 12, color: 'var(--red)', marginTop: 10 }}>{error}</div>}
            </div>
          )}

          {step === 'done' && (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--green-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                <Icon name="check" size={26} style={{ color: 'var(--green)' }} />
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--accent)' }}>
                {attended === false ? 'No-show enregistré' : 'Rapport enregistré'}
              </div>
            </div>
          )}

          {step === 'attended' && error && (
            <div role="alert" style={{ fontSize: 12, color: 'var(--red)', marginTop: 14 }}>{error}</div>
          )}
        </div>

        {step === 'topic_notes' && (
          <div style={{ padding: '0 30px 26px', display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <button onClick={() => setStep('attended')} className="btn-ghost" type="button" disabled={saving} style={{ fontSize: 14 }}>Retour</button>
            <button
              onClick={handleSubmitTopicNotes}
              className="btn-primary-brand"
              type="button"
              disabled={saving}
              style={{ fontSize: 14 }}
            >
              {saving ? 'Enregistrement…' : 'Enregistrer le rapport'}
            </button>
          </div>
        )}

        {step === 'done' && (
          <div style={{ padding: '0 30px 26px', display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={onClose} className="btn-primary-brand" type="button" style={{ fontSize: 14 }}>Fermer</button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );

  return (
    <>
      {modal}
      {confirmClose && createPortal(
        <div
          onClick={e => e.stopPropagation()}
          style={{
            position: 'fixed', inset: 0, zIndex: 5001,
            background: 'rgba(0,0,0,0.45)',
            backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 24,
          }}
        >
          <div style={{ textAlign: 'center', maxWidth: 320, background: 'var(--surface)', borderRadius: 16, padding: '24px 22px', boxShadow: '0 12px 32px rgba(0,0,0,0.25)' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)', marginBottom: 8 }}>
              Quitter le rapport en cours ?
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
              Ce que tu as déjà saisi ne sera pas enregistré.
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--ink-2)', marginBottom: 20, cursor: 'pointer', justifyContent: 'center' }}>
              <input
                type="checkbox"
                checked={confirmChecked}
                onChange={e => setConfirmChecked(e.target.checked)}
                style={{ width: 16, height: 16, cursor: 'pointer' }}
              />
              Je confirme vouloir quitter sans enregistrer
            </label>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button type="button" className="btn-ghost" onClick={() => setConfirmClose(false)}>
                Continuer le rapport
              </button>
              <button
                type="button"
                className="btn-primary-brand"
                style={{ background: confirmChecked ? 'var(--red)' : 'var(--border)', borderColor: confirmChecked ? 'var(--red)' : 'var(--border)', cursor: confirmChecked ? 'pointer' : 'not-allowed', opacity: confirmChecked ? 1 : 0.6 }}
                disabled={!confirmChecked}
                onClick={onClose}
              >
                Quitter
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
