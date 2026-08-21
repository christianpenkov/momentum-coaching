'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Icon from '@/components/ui/Icon';
import ModalShell from '@/components/ui/ModalShell';
import ConfirmCheckboxDialog from '@/components/ui/ConfirmCheckboxDialog';
import { SESSION_TOPICS, type SessionTopic } from '@/lib/sessionRapport';
import { useRapportDraftWriter, type RapportDraft } from '@/lib/useRapportDraft';

type SessionRapportStep = 'attended' | 'topic_notes' | 'done';

/** Ce qu'on sérialise dans le brouillon. `step` vit à côté, en colonne dédiée. */
interface SessionAnswers {
  attended: boolean | null;
  topic: SessionTopic | null;
  topicCustom: string;
  notes: string;
  /** Distingue un brouillon de correction d'une saisie initiale (voir isDraftStale). */
  isCorrection: boolean;
}

interface Props {
  callId: string;
  studentName: string | null;
  scheduledAt: string | null;
  topic?: string | null;
  onClose: () => void;
  // Mode édition d'un rapport déjà soumis — pré-remplit et saute directement à
  // l'étape topic_notes (le "présent/no-show" initial n'est pas remis en cause ici,
  // seuls sujet/notes sont modifiables après coup).
  editInitial?: { topic: SessionTopic | null; topicCustom: string; notes: string; attended?: boolean | null };
  /**
   * Brouillon déjà résolu par SessionRapportModalLoader — jamais chargé ici.
   * Le charger dans ce composant afficherait l'étape 1 vide avant de sauter à la
   * bonne étape, et un clic pendant cette fenêtre serait perdu.
   */
  initialDraft?: RapportDraft | null;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

export default function SessionRapportModal({ callId, studentName, scheduledAt, topic: callTopic, onClose, editInitial, initialDraft }: Props) {
  const isEdit = !!editInitial;

  // Priorité : brouillon > rapport existant (mode correction) > vide. Le brouillon
  // décrit la dernière saisie réelle, il gagne sur ce qui est en base.
  const draftAnswers = (initialDraft?.answers ?? null) as SessionAnswers | null;

  const [step, setStep] = useState<SessionRapportStep>(
    (initialDraft?.step as SessionRapportStep) ?? (isEdit ? 'topic_notes' : 'attended')
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [attended, setAttended] = useState<boolean | null>(
    draftAnswers ? draftAnswers.attended : (isEdit ? (editInitial?.attended ?? true) : null)
  );
  const [topic, setTopic] = useState<SessionTopic | null>(draftAnswers?.topic ?? editInitial?.topic ?? null);
  const [topicCustom, setTopicCustom] = useState(draftAnswers?.topicCustom ?? editInitial?.topicCustom ?? '');
  const [notes, setNotes] = useState(draftAnswers?.notes ?? editInitial?.notes ?? '');
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [restartChecked, setRestartChecked] = useState(false);

  const draft = useRapportDraftWriter(callId);

  // Y a-t-il quelque chose à perdre ? On compare l'état courant à son point de
  // départ RÉEL : le brouillon s'il existe (c'est là qu'on a repris), sinon le
  // rapport en base en correction, sinon rien. Sans cette baseline, rouvrir un
  // brouillon et fermer aussitôt redéclencherait une confirmation pour zéro
  // modification.
  const baseline = draftAnswers ?? {
    attended: isEdit ? (editInitial?.attended ?? true) : null,
    topic: editInitial?.topic ?? null,
    topicCustom: editInitial?.topicCustom ?? '',
    notes: editInitial?.notes ?? '',
  };
  const hasChanges =
    attended !== baseline.attended ||
    topic !== baseline.topic ||
    topicCustom !== baseline.topicCustom ||
    notes !== baseline.notes;

  /** Y a-t-il quoi que ce soit de saisi ? Sert au bouton « Recommencer ». */
  const hasAnything = attended !== null || topic !== null || topicCustom !== '' || notes !== '';

  const answers = (): SessionAnswers => ({ attended, topic, topicCustom, notes, isCorrection: isEdit });
  const stepIndex = step === 'attended' ? 1 : 2;
  const stepTotal = isEdit ? 1 : 2;

  /** Sauvegarde immédiate, puis changement d'étape. */
  function goTo(next: SessionRapportStep, patch?: Partial<SessionAnswers>) {
    const a = { ...answers(), ...patch };
    // Même garde que le debounce : revenir à l'étape 1 sans avoir rien saisi ne doit
    // pas créer de brouillon, sinon la carte annonce « Commencé » pour rien.
    const rempli = a.attended !== null || a.topic !== null || a.topicCustom !== '' || a.notes !== '';
    if (rempli) {
      draft.save({ kind: 'session', step: next, stepIndex: next === 'attended' ? 1 : 2, stepTotal, answers: a });
    }
    setStep(next);
  }

  // Frappe dans un champ libre : sauvegarde différée. `notes` est un textarea qui
  // peut recevoir plusieurs paragraphes — c'est la saisie qu'on perdait le plus.
  //
  // `hasAnything` : on n'écrit RIEN tant que rien n'est saisi. Sans ce garde, ouvrir
  // une modale et la refermer aussitôt créait un brouillon vide, et la carte
  // affichait « Commencé · étape 1/2 » pour un rapport où l'on n'a rien fait. Même
  // effet juste après « Recommencer », qui remet l'état à zéro.
  useEffect(() => {
    if (step === 'done' || !hasAnything) return;
    draft.saveDebounced({ kind: 'session', step, stepIndex, stepTotal, answers: answers() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic, topicCustom, notes, attended]);

  // Plus de « Ce que tu as saisi ne sera pas enregistré » : c'est devenu faux, tout
  // est gardé. On ferme directement, la sauvegarde en attente est envoyée par le
  // flush de démontage du hook.
  function requestClose() {
    onClose();
  }

  function handleRestart() {
    setAttended(isEdit ? (editInitial?.attended ?? true) : null);
    setTopic(null);
    setTopicCustom('');
    setNotes('');
    setError('');
    setStep(isEdit ? 'topic_notes' : 'attended');
    setConfirmRestart(false);
    draft.clear();
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') requestClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [step]);

  async function submitRapport(body: { attended: boolean; topic?: string; topic_custom?: string; notes?: string; edit?: boolean }) {
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
      // Le rapport est en base : le brouillon n'a plus de raison d'être, et le
      // laisser vivre risquerait de le voir réappliqué par-dessus plus tard.
      // Supprimé APRÈS le succès uniquement — en cas d'échec on garde la saisie.
      draft.clear();
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
    goTo('topic_notes', { attended: true });
  }

  function handleSubmitTopicNotes() {
    if (!topic) { setError('Choisis un sujet principal.'); return; }
    if (topic === 'autre' && !topicCustom.trim()) { setError('Précise le sujet en 2-3 mots.'); return; }
    submitRapport({
      // `attended` et non `true` en dur : en édition, la bascule ci-dessus peut
      // l'avoir passé à false. À la première saisie il vaut déjà true, puisqu'un
      // no-show est enregistré directement depuis l'étape précédente.
      attended: attended !== false,
      topic,
      topic_custom: topic === 'autre' ? topicCustom.trim() : undefined,
      notes: notes.trim() || undefined,
      ...(isEdit ? { edit: true } : {}),
    });
  }

  const modal = (
    <ModalShell onClose={onClose} onOverlayClick={requestClose} width={520}>
        {/* Header */}
        <div style={{ padding: '26px 30px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <Icon name="phone-call" size={20} />
            <div style={{ minWidth: 0 }}>
              {/* Titre et nom sur DEUX lignes, comme RapportModal.tsx:510-515.
                  Sur une seule ligne, « Modifier le rapport — Christian Penkov »
                  occupait déjà 2 lignes à 375 px (mesuré : 216 px de large pour
                  52 px de haut) ; « Rapport de session de coaching — … » serait
                  passé à trois. Le nom porte une ellipsis : un nom composé long
                  ne peut plus repousser le sujet du call hors de vue.
                  `text-wrap: balance` équilibre la coupure quand le titre tient
                  quand même sur deux lignes — sans lui elle tombait après « de »,
                  laissant « coaching » seul sur la seconde. */}
              <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--accent)', textWrap: 'balance' }}>
                {isEdit ? 'Modifier le rapport' : 'Rapport de session de coaching'}
              </div>
              {studentName && (
                <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {studentName}
                </div>
              )}
              {callTopic && (
                <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>{callTopic}</div>
              )}
            </div>
          </div>
          <button onClick={requestClose} type="button" className="icon-btn" aria-label="Fermer" style={{ flexShrink: 0 }}><Icon name="x" size={18} /></button>
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
                  <Icon name="x" size={17} /> Pas présent
                </button>
              </div>
            </div>
          )}

          {step === 'topic_notes' && (
            <div>
              {/* En édition seulement : la présence redevient modifiable. À la
                  première saisie elle a déjà été choisie à l'étape précédente, la
                  redemander ici ferait doublon. Sans cette bascule, une absence
                  saisie par erreur était définitive. */}
              {isEdit && (
                <div style={{ marginBottom: 24 }}>
                  <label className="eyebrow-sm" style={{ color: 'var(--muted)', display: 'block', marginBottom: 10 }}>
                    L'élève était-il présent ?
                  </label>
                  {/* Les DEUX boutons portent toujours une bordure : sans elle,
                      l'option non retenue perdait son cadre et ne se lisait plus
                      comme un bouton — impossible de voir qu'elle était cliquable,
                      ni laquelle des deux était sélectionnée. Le choix actif se
                      distingue par son fond plein, pas par la présence d'un cadre. */}
                  {/* Styles en classes et non en ligne : le survol doit teinter
                      légèrement l'option NON retenue de sa propre couleur, ce qu'un
                      style inline ne permet pas d'exprimer. */}
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button
                      type="button"
                      onClick={() => { setAttended(true); setError(''); }}
                      className={`btn-ghost presence-toggle presence-present${attended === true ? ' is-selected' : ''}`}
                    >
                      <Icon name="check" size={15} /> Présent
                    </button>
                    <button
                      type="button"
                      onClick={() => { setAttended(false); setError(''); }}
                      className={`btn-ghost presence-toggle presence-absent${attended === false ? ' is-selected' : ''}`}
                    >
                      <Icon name="x" size={15} /> Pas présent
                    </button>
                  </div>
                </div>
              )}
              {/* Mention de visibilité obligatoire : les notes juste en dessous
                  portent déjà "Privé, visible coach uniquement", donc sans contrepartie
                  ici le coach pouvait croire que TOUT le rapport était privé. */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
                <label className="eyebrow-sm" style={{ color: 'var(--muted)' }}>
                  Sujet principal du call
                </label>
                <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--muted)' }}>
                  <Icon name="eye" size={10} /> Visible par l'élève
                </span>
              </div>
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
                <label className="eyebrow-sm" style={{ color: 'var(--muted)' }}>
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
                {attended === false ? 'Absence enregistrée' : 'Rapport enregistré'}
              </div>
            </div>
          )}

          {step === 'attended' && error && (
            <div role="alert" style={{ fontSize: 12, color: 'var(--red)', marginTop: 14 }}>{error}</div>
          )}
        </div>

        {step === 'topic_notes' && (
          <div style={{ padding: '0 30px 26px' }}>
            <button
              onClick={handleSubmitTopicNotes}
              className="btn-primary-brand"
              type="button"
              disabled={saving}
              style={{ width: '100%', fontSize: 14, padding: '14px' }}
            >
              {saving ? 'Enregistrement…' : isEdit ? 'Enregistrer les modifications' : 'Enregistrer le rapport'}
            </button>
            {/* Retour et Recommencer côte à côte sous l'action principale, même
                police et même encadré : deux actions de navigation de même rang,
                seule leur portée diffère. */}
            {(!isEdit || hasAnything) && (
              <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                {!isEdit && (
                  <button onClick={() => goTo('attended')} className="btn-ghost" type="button" disabled={saving}
                    style={{ flex: 1, fontSize: 13, padding: '12px', color: 'var(--muted)', border: '1px solid var(--border)' }}>
                    ‹ Retour
                  </button>
                )}
                {hasAnything && (
                  <button onClick={() => { setRestartChecked(false); setConfirmRestart(true); }} className="btn-ghost" type="button" disabled={saving}
                    style={{ flex: 1, fontSize: 13, padding: '12px', color: 'var(--muted)', border: '1px solid var(--border)' }}>
                    Recommencer
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {step === 'done' && (
          <div style={{ padding: '0 30px 26px', display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={onClose} className="btn-primary-brand" type="button" style={{ fontSize: 14 }}>Fermer</button>
          </div>
        )}
    </ModalShell>
  );

  return (
    <>
      {modal}
      {/* Plus de dialogue « quitter sans enregistrer » : les réponses sont gardées,
          l'avertissement serait devenu un mensonge. La case à cocher est désormais
          réservée à « Recommencer », qui efface réellement quelque chose. */}
      {confirmRestart && (
        <ConfirmCheckboxDialog
          title="Recommencer le rapport ?"
          message="Toutes tes réponses seront effacées et tu repartiras de la première question."
          checkboxLabel="Je confirme vouloir effacer mes réponses"
          confirmLabel="Recommencer"
          cancelLabel="Annuler"
          checked={restartChecked}
          onCheckedChange={setRestartChecked}
          onConfirm={handleRestart}
          onCancel={() => setConfirmRestart(false)}
        />
      )}
    </>
  );
}
