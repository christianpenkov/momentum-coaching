'use client';

import { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Lottie from 'lottie-react';
import Icon from '@/components/ui/Icon';
import celebrationAnimation from '@/public/animations/celebration.json';

type RapportStep =
  | 'show_up'
  | 'qualified'
  | 'closed'
  | 'revenue'
  | 'celebration'
  // Appel reporté
  | 'rescheduled_check'       // vérification en cours (refresh Calendly)
  | 'rescheduled_found'       // nouveau call trouvé automatiquement
  | 'rescheduled_how'         // comment va-t-il reréserver ?
  | 'rescheduled_manual_date' // saisie manuelle date/heure
  | 'rescheduled_done'        // confirmation finale
  // 2ème call
  | 'second_call_check'       // vérification en cours
  | 'second_call_found'       // 2ème call trouvé automatiquement
  | 'second_call_how'         // comment va-t-il reréserver ?
  | 'second_call_manual_date' // saisie manuelle date/heure
  | 'second_call_done';       // confirmation finale

interface Props {
  callId: string;
  inviteeName: string | null;
  scheduledAt: string | null;
  isFollowUp?: boolean;
  onClose: () => void;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function CelebrationOverlay({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, 2600);
    return () => clearTimeout(timer);
  }, [onDone]);

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 5000,
      background: 'rgba(0,0,0,0.75)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    }}>
      <Lottie animationData={celebrationAnimation} loop={false} style={{ width: 320, height: 320 }} />
      <div style={{ fontSize: 26, fontWeight: 900, color: '#fff', letterSpacing: '-0.5px', marginTop: -20, marginBottom: 6, textAlign: 'center' }}>Lead closé !</div>
      <div style={{ fontSize: 15, color: 'rgba(255,255,255,0.75)', fontWeight: 500, textAlign: 'center' }}>Félicitations, continue comme ça 🔥</div>
    </div>,
    document.body
  );
}

export default function RapportModal({ callId, inviteeName, scheduledAt, isFollowUp, onClose }: Props) {
  const [step, setStep] = useState<RapportStep>('show_up');
  const [revenue, setRevenue] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Données trouvées automatiquement (refresh Calendly)
  const [foundCall, setFoundCall] = useState<{ id: string; scheduledAt: string; inviteeName: string | null } | null>(null);

  // Saisie manuelle date/heure
  const [manualDate, setManualDate] = useState('');
  const [manualTimeStart, setManualTimeStart] = useState('');
  const [manualTimeEnd, setManualTimeEnd] = useState('');
  const manualValid = manualDate && manualTimeStart && manualTimeEnd;

  function requestClose() {
    if (step === 'show_up') { onClose(); return; }
    setConfirmClose(true);
  }

  async function patchRapport(patch: Record<string, any>) {
    const rapportFields: Record<string, any> = {};
    const callFields: Record<string, any> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (['rescheduled', 'rescheduled_at', 'scheduled_at'].includes(k)) callFields[k] = v;
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
    window.dispatchEvent(new Event('notifs-refresh'));
  }

  // ── Appel reporté ────────────────────────────────────────────────────────────

  async function handleRescheduled() {
    setStep('rescheduled_check');
    await Promise.race([
      fetch('/api/calendly/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }).catch(() => {}),
      new Promise(r => setTimeout(r, 8000)),
    ]);
    // 2 tentatives : le nouveau call peut mettre quelques secondes à apparaître
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 2000));
      const res = await fetch(`/api/calls/${callId}/next-rescheduled`);
      if (res.ok) {
        const data = await res.json();
        if (data.call) {
          setFoundCall(data.call);
          setStep('rescheduled_found');
          return;
        }
      }
    }
    setStep('rescheduled_how');
  }

  async function confirmRescheduled(fields: Record<string, any> = {}) {
    setSaving(true);
    await patchRapport({
      outcome: 'rescheduled',
      rescheduled: true,
      rescheduled_at: new Date().toISOString(),
      ...fields,
    });
    setSaving(false);
    setStep('rescheduled_done');
  }

  async function confirmRescheduledManual() {
    if (!manualValid) return;
    setSaving(true);
    const scheduledAtNew = new Date(`${manualDate}T${manualTimeStart}`).toISOString();
    await patchRapport({
      outcome: 'rescheduled',
      rescheduled: true,
      rescheduled_at: new Date().toISOString(),
      scheduled_at: scheduledAtNew,
    });
    setSaving(false);
    setStep('rescheduled_done');
  }

  // ── 2ème call ────────────────────────────────────────────────────────────────

  async function handleSecondCall() {
    setStep('second_call_check');
    await Promise.race([
      fetch('/api/calendly/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }).catch(() => {}),
      new Promise(r => setTimeout(r, 8000)),
    ]);
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 2000));
      const res = await fetch(`/api/calls/${callId}/next-rescheduled`);
      if (res.ok) {
        const data = await res.json();
        if (data.call) {
          setFoundCall(data.call);
          setStep('second_call_found');
          return;
        }
      }
    }
    setStep('second_call_how');
  }

  async function confirmSecondCallFound() {
    if (!foundCall) return;
    setSaving(true);
    // Marquer le 2ème call comme is_follow_up=true
    await fetch(`/api/client/calls/${foundCall.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_follow_up: true }),
    });
    await patchRapport({ outcome: 'second_call', no_show: false, deal_closed: false, revenue: 0 });
    setSaving(false);
    setStep('second_call_done');
  }

  async function confirmSecondCallViaCalendly() {
    setSaving(true);
    await patchRapport({ outcome: 'second_call', no_show: false, deal_closed: false, revenue: 0 });
    setSaving(false);
    setStep('second_call_done');
  }

  async function confirmSecondCallManual() {
    if (!manualValid) return;
    setSaving(true);
    const scheduledAtNew = new Date(`${manualDate}T${manualTimeStart}`).toISOString();
    // Calculer la durée depuis heure de fin
    const startMs = new Date(`${manualDate}T${manualTimeStart}`).getTime();
    const endMs   = new Date(`${manualDate}T${manualTimeEnd}`).getTime();
    const durationMin = Math.round((endMs - startMs) / 60000);
    // Créer le 2ème call manuellement
    await fetch('/api/client/calls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ig_username: null,
        scheduled_at: scheduledAtNew,
        duration: `${durationMin} min`,
        invitee_name: inviteeName,
        is_follow_up: true,
        source: 'manual',
      }),
    });
    await patchRapport({ outcome: 'second_call', no_show: false, deal_closed: false, revenue: 0 });
    setSaving(false);
    setStep('second_call_done');
  }

  // ── Étapes existantes ────────────────────────────────────────────────────────

  async function handleShowUp(showedUp: boolean) {
    if (!showedUp) {
      setSaving(true);
      await patchRapport({ no_show: true, deal_closed: false, revenue: 0, outcome: 'no_show' });
      setSaving(false);
      onClose();
    } else {
      setStep('qualified');
    }
  }

  async function handleQualified(qualified: boolean) {
    setSaving(true);
    await patchRapport({ qualified });
    setSaving(false);
    setStep('closed');
  }

  async function handleRevenue() {
    const amount = parseFloat(revenue.replace(',', '.')) || 0;
    setSaving(true);
    await patchRapport({ no_show: false, deal_closed: true, revenue: amount, outcome: 'closed' });
    setSaving(false);
    setStep('celebration');
  }

  // ── Loading spinner ──────────────────────────────────────────────────────────

  const isChecking = step === 'rescheduled_check' || step === 'second_call_check';
  const isDone = step === 'rescheduled_done' || step === 'second_call_done';

  return createPortal(
    <>
      {step === 'celebration' && <CelebrationOverlay onDone={onClose} />}

      {confirmClose && (
        <>
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 4000 }} />
          <div style={{ position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', zIndex: 4001, background: 'var(--surface)', borderRadius: 16, padding: '28px 24px', width: '100%', maxWidth: 340, textAlign: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--accent)', marginBottom: 8 }}>Fermer sans terminer ?</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 24, lineHeight: 1.6 }}>
              Le rapport n'a pas été enregistré. Il restera en attente.
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" className="btn-ghost" style={{ flex: 1 }} onClick={() => setConfirmClose(false)}>Continuer</button>
              <button type="button" className="btn-primary" style={{ flex: 1, background: 'var(--red, #ef4444)' }} onClick={onClose}>Fermer quand même</button>
            </div>
          </div>
        </>
      )}

      {step !== 'celebration' && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 3000 }} onClick={requestClose} />
      )}

      {step !== 'celebration' && (
        <div style={{
          position: 'fixed', left: 0, right: 0,
          ...(step === 'revenue' ? { top: 0, bottom: 0, borderRadius: 0 } : { top: 'auto', bottom: 0, borderRadius: '20px 20px 0 0', maxHeight: '90vh' }),
          margin: '0 auto', width: '100%', maxWidth: 520,
          background: 'var(--surface)', padding: '48px 24px 32px', overflowY: 'auto', zIndex: 3001,
        }}>
          {/* En-tête */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Rapport de call</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)' }}>
                {inviteeName ? `Appel avec ${inviteeName}` : 'Appel découverte'}
              </div>
              {scheduledAt && (
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                  {formatDate(scheduledAt)} · {formatTime(scheduledAt)}
                </div>
              )}
            </div>
            <button type="button" onClick={requestClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--muted)' }}>
              <Icon name="x" size={18} />
            </button>
          </div>

          {/* ── Étape 1 — présent ? ─────────────────────────────────────────── */}
          {step === 'show_up' && (
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent)', marginBottom: 8 }}>Le lead s'est présenté ?</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 24, lineHeight: 1.6 }}>Était-il au rendez-vous ?</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button className="btn-primary" type="button" style={{ width: '100%', padding: '16px', fontSize: 15, fontWeight: 700 }} disabled={saving} onClick={() => handleShowUp(true)}>
                  Oui, il était là
                </button>
                <button className="btn-ghost" type="button" style={{ width: '100%', padding: '14px', fontSize: 14, color: 'var(--accent)' }} disabled={saving} onClick={() => handleShowUp(false)}>
                  No-show
                </button>
                <button className="btn-ghost" type="button" style={{ width: '100%', padding: '14px', fontSize: 14, color: '#d97706', border: '1px solid #fcd34d' }} disabled={saving} onClick={handleRescheduled}>
                  Appel reporté — nouvelle date à planifier
                </button>
              </div>
            </div>
          )}

          {/* ── Étape 1.5 — qualifié ? ──────────────────────────────────────── */}
          {step === 'qualified' && (
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent)', marginBottom: 8 }}>Le prospect était-il qualifié ?</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 24, lineHeight: 1.6 }}>Correspond-il au profil recherché (besoin, budget, timing) ?</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button className="btn-primary" type="button" style={{ width: '100%', padding: '16px', fontSize: 15, fontWeight: 700 }} disabled={saving} onClick={() => handleQualified(true)}>
                  Oui, qualifié
                </button>
                <button className="btn-ghost" type="button" style={{ width: '100%', padding: '14px', fontSize: 14, color: 'var(--accent)', border: '1px solid var(--border)' }} disabled={saving} onClick={() => handleQualified(false)}>
                  Non, pas qualifié
                </button>
              </div>
            </div>
          )}

          {/* ── Vérification Calendly en cours ──────────────────────────────── */}
          {isChecking && (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              <div style={{ fontSize: 28, marginBottom: 12 }}>🔄</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)', marginBottom: 8 }}>
                {step === 'rescheduled_check' ? 'Recherche d\'une nouvelle date…' : 'Recherche d\'un 2ème call…'}
              </div>
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>Synchronisation Calendly en cours</div>
            </div>
          )}

          {/* ── Appel reporté : nouveau call trouvé ────────────────────────── */}
          {step === 'rescheduled_found' && foundCall && (
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent)', marginBottom: 8 }}>Nouveau call détecté ✓</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8, lineHeight: 1.6 }}>Calendly a détecté un nouveau rendez-vous :</div>
              <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px', marginBottom: 24 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)' }}>{formatDate(foundCall.scheduledAt)}</div>
                <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>{formatTime(foundCall.scheduledAt)}</div>
              </div>
              <button className="btn-primary" type="button" style={{ width: '100%', padding: '16px', fontSize: 15, fontWeight: 700 }} disabled={saving} onClick={() => confirmRescheduled()}>
                {saving ? 'Enregistrement…' : 'Confirmer le report'}
              </button>
            </div>
          )}

          {/* ── Appel reporté : comment va-t-il reréserver ? ────────────────── */}
          {step === 'rescheduled_how' && (
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent)', marginBottom: 8 }}>Comment va-t-il reréserver ?</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 24, lineHeight: 1.6 }}>Aucun nouveau créneau n'a été détecté sur Calendly.</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button className="btn-ghost" type="button" style={{ width: '100%', padding: '14px', fontSize: 14, color: 'var(--accent)', border: '1px solid var(--border)' }} disabled={saving}
                  onClick={() => confirmRescheduled()}>
                  Via Calendly — il va reréserver lui-même
                </button>
                <button className="btn-ghost" type="button" style={{ width: '100%', padding: '14px', fontSize: 14, color: 'var(--accent)', border: '1px solid var(--border)' }} disabled={saving}
                  onClick={() => setStep('rescheduled_manual_date')}>
                  Manuellement — je vais saisir la date
                </button>
                <button className="btn-ghost" type="button" style={{ width: '100%', padding: '14px', fontSize: 14, color: 'var(--muted)', border: '1px solid var(--border)' }} disabled={saving}
                  onClick={() => confirmRescheduled()}>
                  Date pas encore connue
                </button>
              </div>
            </div>
          )}

          {/* ── Appel reporté : saisie manuelle ─────────────────────────────── */}
          {step === 'rescheduled_manual_date' && (
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent)', marginBottom: 8 }}>Nouvelle date du call</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20, lineHeight: 1.6 }}>Renseigne les horaires du call reporté.</div>
              <ManualDateForm date={manualDate} setDate={setManualDate} timeStart={manualTimeStart} setTimeStart={setManualTimeStart} timeEnd={manualTimeEnd} setTimeEnd={setManualTimeEnd} />
              <button className="btn-primary" type="button" style={{ width: '100%', padding: '16px', fontSize: 15, fontWeight: 700, marginTop: 20 }} disabled={saving || !manualValid}
                onClick={confirmRescheduledManual}>
                {saving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          )}

          {/* ── Appel reporté : confirmation finale ─────────────────────────── */}
          {step === 'rescheduled_done' && (
            <div style={{ textAlign: 'center', padding: '16px 0 8px' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>✅</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--accent)', marginBottom: 8 }}>Report enregistré</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 28, lineHeight: 1.6 }}>
                Le call est marqué comme reporté. Ton pipeline sera mis à jour automatiquement dès que le nouveau créneau sera confirmé.
              </div>
              <button className="btn-primary" type="button" style={{ width: '100%', padding: '14px', fontSize: 14, fontWeight: 700 }} onClick={onClose}>Fermer</button>
            </div>
          )}

          {/* ── Étape 2 — outcome ───────────────────────────────────────────── */}
          {step === 'closed' && (
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent)', marginBottom: 8 }}>Résultat du call ?</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 24, lineHeight: 1.6 }}>Qu'est-ce qui s'est passé ?</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button className="btn-primary" type="button" style={{ width: '100%', padding: '16px', fontSize: 15, fontWeight: 700 }} disabled={saving} onClick={() => setStep('revenue')}>
                  Oui, lead closé !
                </button>
                <button className="btn-ghost" type="button" style={{ width: '100%', padding: '14px', fontSize: 14, color: 'var(--accent)', border: '1px solid var(--border)' }} disabled={saving}
                  onClick={handleSecondCall}>
                  {isFollowUp ? 'Prochain call prévu' : '2ème call prévu'}
                </button>
                <button className="btn-ghost" type="button" style={{ width: '100%', padding: '14px', fontSize: 14, color: 'var(--accent)', border: '1px solid var(--border)' }} disabled={saving}
                  onClick={async () => { setSaving(true); await patchRapport({ no_show: false, deal_closed: false, revenue: 0, outcome: 'to_recontact' }); setSaving(false); onClose(); }}>
                  Pas closé — à recontacter
                </button>
              </div>
            </div>
          )}

          {/* ── Prochain call : trouvé auto ─────────────────────────────────── */}
          {step === 'second_call_found' && foundCall && (
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent)', marginBottom: 8 }}>
                {isFollowUp ? 'Prochain call détecté ✓' : '2ème call détecté ✓'}
              </div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8, lineHeight: 1.6 }}>Calendly a détecté un prochain rendez-vous :</div>
              <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px', marginBottom: 24 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)' }}>{formatDate(foundCall.scheduledAt)}</div>
                <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>{formatTime(foundCall.scheduledAt)}</div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16, lineHeight: 1.5 }}>
                Ce call sera marqué comme suivi (non comptabilisé dans les statistiques).
              </div>
              <button className="btn-primary" type="button" style={{ width: '100%', padding: '16px', fontSize: 15, fontWeight: 700 }} disabled={saving} onClick={confirmSecondCallFound}>
                {saving ? 'Enregistrement…' : 'Confirmer'}
              </button>
            </div>
          )}

          {/* ── Prochain call : comment va-t-il reréserver ? ────────────────── */}
          {step === 'second_call_how' && (
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent)', marginBottom: 8 }}>Comment va-t-il reréserver ?</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 24, lineHeight: 1.6 }}>Aucun prochain call n'a été détecté sur Calendly.</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button className="btn-ghost" type="button" style={{ width: '100%', padding: '14px', fontSize: 14, color: 'var(--accent)', border: '1px solid var(--border)' }} disabled={saving}
                  onClick={confirmSecondCallViaCalendly}>
                  Via Calendly — il va reréserver lui-même
                </button>
                <button className="btn-ghost" type="button" style={{ width: '100%', padding: '14px', fontSize: 14, color: 'var(--accent)', border: '1px solid var(--border)' }} disabled={saving}
                  onClick={() => setStep('second_call_manual_date')}>
                  Manuellement — je connais la date
                </button>
                <button className="btn-ghost" type="button" style={{ width: '100%', padding: '14px', fontSize: 14, color: 'var(--muted)', border: '1px solid var(--border)' }} disabled={saving}
                  onClick={confirmSecondCallViaCalendly}>
                  Date pas encore connue
                </button>
              </div>
            </div>
          )}

          {/* ── Prochain call : saisie manuelle ─────────────────────────────── */}
          {step === 'second_call_manual_date' && (
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent)', marginBottom: 8 }}>
                {isFollowUp ? 'Date du prochain call' : 'Date du 2ème call'}
              </div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20, lineHeight: 1.6 }}>Renseigne les horaires du prochain appel.</div>
              <ManualDateForm date={manualDate} setDate={setManualDate} timeStart={manualTimeStart} setTimeStart={setManualTimeStart} timeEnd={manualTimeEnd} setTimeEnd={setManualTimeEnd} />
              <button className="btn-primary" type="button" style={{ width: '100%', padding: '16px', fontSize: 15, fontWeight: 700, marginTop: 20 }} disabled={saving || !manualValid}
                onClick={confirmSecondCallManual}>
                {saving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          )}

          {/* ── Prochain call : confirmation finale ──────────────────────────── */}
          {step === 'second_call_done' && (
            <div style={{ textAlign: 'center', padding: '16px 0 8px' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>✅</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--accent)', marginBottom: 8 }}>
                {isFollowUp ? 'Prochain call enregistré' : '2ème call enregistré'}
              </div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 28, lineHeight: 1.6 }}>
                Ce call est enregistré et ne comptera pas dans les statistiques de calls bookés.
              </div>
              <button className="btn-primary" type="button" style={{ width: '100%', padding: '14px', fontSize: 14, fontWeight: 700 }} onClick={onClose}>Fermer</button>
            </div>
          )}

          {/* ── Étape 3 — montant ───────────────────────────────────────────── */}
          {step === 'revenue' && (
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent)', marginBottom: 8 }}>Montant du deal ?</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 24, lineHeight: 1.6 }}>Quel montant a été signé ?</div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 20 }}>
                <input ref={inputRef} className="input" type="number" min="0" step="any" placeholder="0" value={revenue} onChange={e => setRevenue(e.target.value)}
                  style={{ flex: 1, fontSize: 20, fontWeight: 700, textAlign: 'right' }} autoFocus inputMode="decimal" />
                <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent)' }}>€</span>
              </div>
              <button className="btn-primary" type="button" style={{ width: '100%', padding: '16px', fontSize: 15, fontWeight: 700 }} disabled={saving} onClick={handleRevenue}>
                {saving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          )}
        </div>
      )}
    </>,
    document.body
  );
}

function ManualDateForm({ date, setDate, timeStart, setTimeStart, timeEnd, setTimeEnd }: {
  date: string; setDate: (v: string) => void;
  timeStart: string; setTimeStart: (v: string) => void;
  timeEnd: string; setTimeEnd: (v: string) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Date</label>
        <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)}
          style={{ width: '100%' }} min={new Date().toISOString().slice(0, 10)} />
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Début</label>
          <input className="input" type="time" value={timeStart} onChange={e => setTimeStart(e.target.value)} style={{ width: '100%' }} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Fin</label>
          <input className="input" type="time" value={timeEnd} onChange={e => setTimeEnd(e.target.value)} style={{ width: '100%' }} />
        </div>
      </div>
    </div>
  );
}
