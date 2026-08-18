'use client';

import { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Lottie from 'lottie-react';
import Icon from '@/components/ui/Icon';
import ModalShell from '@/components/ui/ModalShell';
import celebrationAnimation from '@/public/animations/celebration.json';
import { wallClockToUtc, cityLabelOf, formatDateIn, formatTimeIn } from '@/lib/timezone';
import { useViewerTimeZone } from '@/lib/UserContext';

// Convertit les valeurs brutes des champs <input type="date"> et <input type="time">
// en instant UTC, dans le fuseau de celui qui saisit.
//
// AVANT ce chantier : `new Date("2026-06-14T14:00")` — une chaîne sans offset ni Z
// est interprétée dans le fuseau de l'appareil. Un coach en déplacement créait donc
// un call décalé sans le savoir, alors que la règle d'alors imposait l'heure de
// Paris. Le bug était réel et silencieux ; il devient correct ici parce qu'on le
// rend explicite, pas parce que la règle a changé.
function formInputsToUtc(dateStr: string, timeStr: string, tz: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  return wallClockToUtc(y, m, d, hh, mm, tz);
}

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
  | 'second_call_done'        // confirmation finale
  // Commentaire facultatif — proposé uniquement quand le call a réellement eu lieu
  // (pas closé, closé, 2ème call prévu) ; jamais sur no-show/reporté.
  | 'comment';

interface Props {
  callId: string;
  inviteeName: string | null;
  scheduledAt: string | null;
  isFollowUp?: boolean;
  onClose: () => void;
}

function formatDate(dateStr: string, tz: string) {
  return formatDateIn(new Date(dateStr), tz);
}

function formatTime(dateStr: string, tz: string) {
  return formatTimeIn(new Date(dateStr), tz);
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
  const viewerTz = useViewerTimeZone();
  const [step, setStep] = useState<RapportStep>('show_up');
  const [revenue, setRevenue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Commentaire facultatif — étape intermédiaire commune avant la fermeture définitive
  // (pas closé, closé, 2ème call). afterComment indique où aller une fois cette étape
  // passée : 'close' ferme la modale, 'celebration' joue l'animation puis ferme,
  // 'second_call_done' affiche l'écran de confirmation existant (fermeture manuelle).
  const [comment, setComment] = useState('');
  const [afterComment, setAfterComment] = useState<'close' | 'celebration' | 'second_call_done'>('close');

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

  // Lève une erreur si l'un des PATCH échoue — les appelants doivent catcher et ne PAS
  // avancer d'étape (setStep) en cas d'échec, sinon l'UI célèbre un succès inexistant
  // (deal/no-show/revenu jamais persisté en base sans que le coach s'en rende compte).
  async function patchRapport(patch: Record<string, any>) {
    const rapportFields: Record<string, any> = {};
    const callFields: Record<string, any> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (['rescheduled', 'rescheduled_at', 'scheduled_at'].includes(k)) callFields[k] = v;
      else rapportFields[k] = v;
    }
    const calls: Promise<Response>[] = [];
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
    const results = await Promise.all(calls);
    const failed = results.find(r => !r.ok);
    if (failed) {
      const data = await failed.json().catch(() => ({}));
      throw new Error(data.error || "Erreur lors de l'enregistrement du rapport");
    }
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
    setError(null);
    try {
      await patchRapport({
        outcome: 'rescheduled',
        rescheduled: true,
        rescheduled_at: new Date().toISOString(),
        ...fields,
      });
      setStep('rescheduled_done');
    } catch (e: any) {
      setError(e.message || 'Erreur lors de l\'enregistrement');
    } finally {
      setSaving(false);
    }
  }

  async function confirmRescheduledManual() {
    if (!manualValid) return;
    setSaving(true);
    setError(null);
    const scheduledAtNew = formInputsToUtc(manualDate, manualTimeStart, viewerTz).toISOString();
    try {
      await patchRapport({
        outcome: 'rescheduled',
        rescheduled: true,
        rescheduled_at: new Date().toISOString(),
        scheduled_at: scheduledAtNew,
      });
      setStep('rescheduled_done');
    } catch (e: any) {
      setError(e.message || 'Erreur lors de l\'enregistrement');
    } finally {
      setSaving(false);
    }
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
    setError(null);
    try {
      // Marquer le 2ème call comme is_follow_up=true
      const res = await fetch(`/api/client/calls/${foundCall.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_follow_up: true }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Erreur lors de la liaison du 2ème call");
      }
      await patchRapport({ outcome: 'second_call', no_show: false, deal_closed: false, revenue: 0 });
      setAfterComment('second_call_done');
      setStep('comment');
    } catch (e: any) {
      setError(e.message || 'Erreur lors de l\'enregistrement');
    } finally {
      setSaving(false);
    }
  }

  async function confirmSecondCallViaCalendly() {
    setSaving(true);
    setError(null);
    try {
      await patchRapport({ outcome: 'second_call', no_show: false, deal_closed: false, revenue: 0 });
      setAfterComment('second_call_done');
      setStep('comment');
    } catch (e: any) {
      setError(e.message || 'Erreur lors de l\'enregistrement');
    } finally {
      setSaving(false);
    }
  }

  async function confirmSecondCallManual() {
    if (!manualValid) return;
    setSaving(true);
    setError(null);
    const scheduledAtNew = formInputsToUtc(manualDate, manualTimeStart, viewerTz).toISOString();
    // Calculer la durée depuis heure de fin
    const startMs = formInputsToUtc(manualDate, manualTimeStart, viewerTz).getTime();
    const endMs   = formInputsToUtc(manualDate, manualTimeEnd, viewerTz).getTime();
    const durationMin = Math.round((endMs - startMs) / 60000);
    try {
      // Créer le 2ème call manuellement
      const res = await fetch('/api/client/calls', {
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
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Erreur lors de la création du 2ème call");
      }
      await patchRapport({ outcome: 'second_call', no_show: false, deal_closed: false, revenue: 0 });
      setAfterComment('second_call_done');
      setStep('comment');
    } catch (e: any) {
      setError(e.message || 'Erreur lors de l\'enregistrement');
    } finally {
      setSaving(false);
    }
  }

  // ── Étapes existantes ────────────────────────────────────────────────────────

  async function handleShowUp(showedUp: boolean) {
    if (!showedUp) {
      setSaving(true);
      setError(null);
      try {
        await patchRapport({ no_show: true, deal_closed: false, revenue: 0, outcome: 'no_show' });
        onClose();
      } catch (e: any) {
        setError(e.message || 'Erreur lors de l\'enregistrement');
      } finally {
        setSaving(false);
      }
    } else {
      setStep('qualified');
    }
  }

  async function handleQualified(qualified: boolean) {
    setSaving(true);
    setError(null);
    try {
      await patchRapport({ qualified });
      setStep('closed');
    } catch (e: any) {
      setError(e.message || 'Erreur lors de l\'enregistrement');
    } finally {
      setSaving(false);
    }
  }

  async function handleRevenue() {
    const amount = parseFloat(revenue.replace(',', '.')) || 0;
    setSaving(true);
    setError(null);
    try {
      await patchRapport({ no_show: false, deal_closed: true, revenue: amount, outcome: 'closed' });
      setAfterComment('celebration');
      setStep('comment');
    } catch (e: any) {
      setError(e.message || 'Erreur lors de l\'enregistrement');
    } finally {
      setSaving(false);
    }
  }

  async function handleToRecontact() {
    setSaving(true);
    setError(null);
    try {
      await patchRapport({ no_show: false, deal_closed: false, revenue: 0, outcome: 'to_recontact' });
      setAfterComment('close');
      setStep('comment');
    } catch (e: any) {
      setError(e.message || 'Erreur lors de l\'enregistrement');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveComment() {
    if (!comment.trim()) { finishAfterComment(); return; }
    setSaving(true);
    setError(null);
    try {
      await patchRapport({ lead_rapport_comment: comment.trim() });
      finishAfterComment();
    } catch (e: any) {
      setError(e.message || 'Erreur lors de l\'enregistrement');
    } finally {
      setSaving(false);
    }
  }

  function finishAfterComment() {
    if (afterComment === 'celebration') setStep('celebration');
    else if (afterComment === 'second_call_done') setStep('second_call_done');
    else onClose();
  }

  // ── Loading spinner ──────────────────────────────────────────────────────────

  const isChecking = step === 'rescheduled_check' || step === 'second_call_check';
  const isDone = step === 'rescheduled_done' || step === 'second_call_done';

  return (
    <>
      {step === 'celebration' && <CelebrationOverlay onDone={onClose} />}

      {confirmClose && createPortal(
        <>
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 4000 }} />
          <div style={{ position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', zIndex: 4001, background: 'var(--surface)', borderRadius: 16, padding: '28px 24px', width: '100%', maxWidth: 340, textAlign: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--accent)', marginBottom: 8 }}>Fermer sans terminer ?</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 24, lineHeight: 1.6 }}>
              Le rapport n'a pas été enregistré. Il restera en attente.
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" className="btn-ghost" style={{ flex: 1 }} onClick={() => setConfirmClose(false)}>Continuer</button>
              <button type="button" className="btn-primary-brand" style={{ flex: 1, background: 'var(--red, #ef4444)' }} onClick={onClose}>Fermer quand même</button>
            </div>
          </div>
        </>,
        document.body
      )}

      {step !== 'celebration' && (
        <ModalShell
          onClose={onClose}
          onOverlayClick={requestClose}
          variant="sheet"
          fullScreen={step === 'revenue' || step === 'comment'}
          width={520}
        >
        <div style={{ padding: '48px 24px 32px', overflowY: 'auto' }}>
          {/* En-tête */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <div>
              <div className="eyebrow-lg" style={{ color: 'var(--muted)', marginBottom: 4 }}>Rapport de call</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)' }}>
                {inviteeName ? `Appel avec ${inviteeName}` : 'Appel découverte'}
              </div>
              {scheduledAt && (
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                  {formatDate(scheduledAt, viewerTz)} · {formatTime(scheduledAt, viewerTz)}
                </div>
              )}
            </div>
            <button type="button" onClick={requestClose} aria-label="Fermer" className="icon-btn" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--muted)' }}>
              <Icon name="x" size={18} />
            </button>
          </div>

          {error && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'var(--red-soft, rgba(205,91,63,0.14))', color: 'var(--red)', borderRadius: 10, fontSize: 13, marginBottom: 20 }}>
              <Icon name="alert" size={14} style={{ flexShrink: 0 }} />
              {error}
            </div>
          )}

          {/* ── Étape 1 — présent ? ─────────────────────────────────────────── */}
          {step === 'show_up' && (
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent)', marginBottom: 8 }}>Le lead s'est présenté ?</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 24, lineHeight: 1.6 }}>Était-il au rendez-vous ?</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button className="btn-primary-brand" type="button" style={{ width: '100%', padding: '16px', fontSize: 15, fontWeight: 700 }} disabled={saving} onClick={() => handleShowUp(true)}>
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
                <button className="btn-primary-brand" type="button" style={{ width: '100%', padding: '16px', fontSize: 15, fontWeight: 700 }} disabled={saving} onClick={() => handleQualified(true)}>
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
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)' }}>{formatDate(foundCall.scheduledAt, viewerTz)}</div>
                <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>{formatTime(foundCall.scheduledAt, viewerTz)}</div>
              </div>
              <button className="btn-primary-brand" type="button" style={{ width: '100%', padding: '16px', fontSize: 15, fontWeight: 700 }} disabled={saving} onClick={() => confirmRescheduled()}>
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
              <button className="btn-primary-brand" type="button" style={{ width: '100%', padding: '16px', fontSize: 15, fontWeight: 700, marginTop: 20 }} disabled={saving || !manualValid}
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
              <button className="btn-primary-brand" type="button" style={{ width: '100%', padding: '14px', fontSize: 14, fontWeight: 700 }} onClick={onClose}>Fermer</button>
            </div>
          )}

          {/* ── Étape 2 — outcome ───────────────────────────────────────────── */}
          {step === 'closed' && (
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent)', marginBottom: 8 }}>Résultat du call ?</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 24, lineHeight: 1.6 }}>Qu'est-ce qui s'est passé ?</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button className="btn-primary-brand" type="button" style={{ width: '100%', padding: '16px', fontSize: 15, fontWeight: 700 }} disabled={saving} onClick={() => setStep('revenue')}>
                  Oui, lead closé !
                </button>
                <button className="btn-ghost" type="button" style={{ width: '100%', padding: '14px', fontSize: 14, color: 'var(--accent)', border: '1px solid var(--border)' }} disabled={saving}
                  onClick={handleSecondCall}>
                  {isFollowUp ? 'Prochain call prévu' : '2ème call prévu'}
                </button>
                <button className="btn-ghost" type="button" style={{ width: '100%', padding: '14px', fontSize: 14, color: 'var(--accent)', border: '1px solid var(--border)' }} disabled={saving}
                  onClick={handleToRecontact}>
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
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)' }}>{formatDate(foundCall.scheduledAt, viewerTz)}</div>
                <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>{formatTime(foundCall.scheduledAt, viewerTz)}</div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16, lineHeight: 1.5 }}>
                Ce call sera marqué comme suivi (non comptabilisé dans les statistiques).
              </div>
              <button className="btn-primary-brand" type="button" style={{ width: '100%', padding: '16px', fontSize: 15, fontWeight: 700 }} disabled={saving} onClick={confirmSecondCallFound}>
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
              <button className="btn-primary-brand" type="button" style={{ width: '100%', padding: '16px', fontSize: 15, fontWeight: 700, marginTop: 20 }} disabled={saving || !manualValid}
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
              <button className="btn-primary-brand" type="button" style={{ width: '100%', padding: '14px', fontSize: 14, fontWeight: 700 }} onClick={onClose}>Fermer</button>
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
              <button className="btn-primary-brand" type="button" style={{ width: '100%', padding: '16px', fontSize: 15, fontWeight: 700 }} disabled={saving} onClick={handleRevenue}>
                {saving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          )}

          {/* ── Commentaire facultatif et privé — visible uniquement par l'auteur ── */}
          {step === 'comment' && (
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent)', marginBottom: 8 }}>Un commentaire à ajouter ?</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20, lineHeight: 1.6 }}>
                Facultatif et privé — ce que tu penses avoir réussi ou raté, ton ressenti… Visible seulement par toi dans l'historique.
              </div>
              <textarea
                className="input"
                value={comment}
                onChange={e => setComment(e.target.value)}
                placeholder="Ton commentaire personnel sur ce call…"
                rows={5}
                style={{ width: '100%', resize: 'vertical', marginBottom: 20, fontFamily: 'inherit' }}
              />
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn-ghost" type="button" style={{ flex: 1, padding: '14px', fontSize: 14, border: '1px solid var(--border)' }} disabled={saving} onClick={finishAfterComment}>
                  Passer
                </button>
                <button className="btn-primary-brand" type="button" style={{ flex: 1, padding: '14px', fontSize: 14, fontWeight: 700 }} disabled={saving} onClick={handleSaveComment}>
                  {saving ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </div>
            </div>
          )}
        </div>
        </ModalShell>
      )}
    </>
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
