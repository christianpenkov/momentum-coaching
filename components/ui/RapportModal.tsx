'use client';

import { useRef, useState, useEffect } from 'react';
import { useEscapeKey } from '@/lib/useEscapeKey';
import { createPortal } from 'react-dom';
import Lottie from 'lottie-react';
import Icon from '@/components/ui/Icon';
import ModalShell from '@/components/ui/ModalShell';
import RapportChoiceStep from '@/components/ui/RapportChoiceStep';
import ConfirmCheckboxDialog from '@/components/ui/ConfirmCheckboxDialog';
import celebrationAnimation from '@/public/animations/celebration.json';
import { useRapportDraftWriter, type RapportDraft } from '@/lib/useRapportDraft';
import { buildRapportPatch, estimateTotal, countAnswered, EMPTY_ANSWERS, type RapportAnswers } from '@/lib/rapportPatch';
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
  // Plan de paiement + génération du lien Stripe, juste après le montant : c'est
  // le moment où l'élève a le prospect au téléphone et peut lui envoyer le lien.
  | 'payment'
  // Encaissement hors Stripe : l'argent est-il déjà là, ou attendu ? Sans cette
  // question, un virement simplement convenu était compté comme encaissé.
  | 'offline'
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
  /**
   * Rapport déjà enregistré — passé uniquement en mode CORRECTION, quand l'utilisateur
   * rouvre un rapport pour le modifier (montant mal saisi, deal enregistré sur la
   * mauvaise personne). Absent en saisie initiale, où la modale démarre vierge.
   *
   * Le parcours reste identique : on repart de l'étape show_up et le nouveau rapport
   * écrase l'ancien (pas d'historique des corrections, décision assumée). Les valeurs
   * existantes servent à pré-remplir les champs pour que l'utilisateur voie ce qu'il
   * corrige au lieu de tout ressaisir de mémoire.
   */
  existing?: {
    revenue?: number | null;
    comment?: string | null;
  } | null;
  /**
   * Brouillon déjà résolu par RapportModalLoader — jamais chargé ici. Le charger
   * dans ce composant afficherait l'étape 1 vide avant de sauter à la bonne étape,
   * et un clic pendant cette fenêtre serait perdu.
   */
  initialDraft?: RapportDraft | null;
  onClose: () => void;
}

/**
 * Étapes où le bouton Retour n'a pas de sens :
 *  - `show_up` : c'est l'entrée, rien derrière ;
 *  - `*_check` : écran d'attente transitoire, y revenir relancerait une recherche
 *    déjà faite ;
 *  - `*_done`, `celebration` : le rapport est DÉJÀ soumis, revenir en arrière
 *    laisserait croire qu'on peut encore le modifier alors qu'il faut passer par
 *    le mode correction.
 *
 * `payment` et `offline` N'y sont PAS : ce sont les dernières questions du
 * rapport, pas des écrans d'après-coup. On peut y revenir, et fermer dessus garde
 * tout en brouillon.
 */
const NO_BACK: readonly string[] = [
  'show_up', 'rescheduled_check', 'second_call_check',
  'rescheduled_done', 'second_call_done', 'celebration',
];

/** Idem pour « Recommencer » : après soumission il n'y a plus de brouillon à effacer. */
const NO_RESTART: readonly string[] = [
  'rescheduled_done', 'second_call_done', 'celebration',
];

/** Format monétaire FR — arrondi à l'euro, les centimes n'aident pas ici. */
function fmtMontant(n: number): string {
  return `${Math.round(n).toLocaleString('fr-FR')} €`;
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

export default function RapportModal({ callId, inviteeName, scheduledAt, isFollowUp, existing, initialDraft, onClose }: Props) {
  useEscapeKey(onClose);
  const viewerTz = useViewerTimeZone();
  const isCorrection = !!existing;

  // Priorité : brouillon > rapport existant (correction) > vide.
  const draftAnswers = (initialDraft?.answers ?? null) as RapportAnswers | null;

  const [step, setStep] = useState<RapportStep>((initialDraft?.step as RapportStep) ?? 'show_up');
  // Chemin réellement emprunté, pour le bouton Retour. Sérialisé avec le
  // brouillon : sans lui, rouvrir à l'étape 4 donnerait un Retour mort.
  const [history, setHistory] = useState<RapportStep[]>(
    ((initialDraft?.answers as any)?.history as RapportStep[] | undefined) ?? []
  );

  /**
   * TOUTES les réponses dans un seul objet. Remplace 10 useState épars : c'est lui
   * qu'on sérialise, on ne peut donc plus oublier un champ au prochain ajout de
   * question.
   */
  const [answers, setAnswers] = useState<RapportAnswers>(() => draftAnswers ?? {
    ...EMPTY_ANSWERS,
    revenue: existing?.revenue != null ? String(existing.revenue) : '',
    comment: existing?.comment ?? '',
    isCorrection: !!existing,
  });

  // État transitoire d'interface — jamais sérialisé.
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [restartChecked, setRestartChecked] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Plan de paiement — hors `answers` : l'étape paiement vient APRÈS la soumission
  // du rapport, donc après la suppression du brouillon. Rien à reprendre.
  const [plan, setPlan] = useState<1 | 2 | 3 | 4>(1);
  const [autoDebit, setAutoDebit] = useState(true);
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  // Hors Stripe : l'argent est-il déjà encaissé, et sinon pour quand ?
  // `offlineReceived` vit dans `answers` et non en state local : c'est une question
  // du rapport, elle doit compter dans la progression et survivre à une fermeture.
  // `offlineDue` reste local — c'est un détail du deal, pas une question.
  const [offlineDue, setOfflineDue] = useState(() => new Date().toISOString().slice(0, 10));
  const [afterComment, setAfterComment] = useState<'close' | 'celebration' | 'second_call_done'>('close');

  const draft = useRapportDraftWriter(callId);

  // Accesseurs : le reste du composant continue de lire `revenue`, `comment`…
  // comme avant, sans avoir à connaître la forme de `answers`.
  const { revenue, comment, foundCall, manualDate, manualTimeStart, manualTimeEnd } = answers;
  const offlineReceived = answers.offlineReceived ?? null;
  const setOfflineReceived = (v: boolean | null) => patch({ offlineReceived: v });
  const manualValid = manualDate && manualTimeStart && manualTimeEnd;
  const setRevenue = (v: string) => patch({ revenue: v });
  const setComment = (v: string) => patch({ comment: v });
  const setFoundCall = (v: RapportAnswers['foundCall']) => patch({ foundCall: v });
  const setManualDate = (v: string) => patch({ manualDate: v });
  const setManualTimeStart = (v: string) => patch({ manualTimeStart: v });
  const setManualTimeEnd = (v: string) => patch({ manualTimeEnd: v });

  function patch(p: Partial<RapportAnswers>) {
    setAnswers(a => ({ ...a, ...p }));
  }

  /** Y a-t-il quoi que ce soit à conserver ? Sert au brouillon et à « Recommencer ». */
  const hasAnything =
    answers.showedUp !== null || answers.qualified !== null || answers.outcomeChoice !== null ||
    answers.revenue !== '' || answers.comment !== '' || answers.reschedHow !== null ||
    answers.manualDate !== '';

  /** Avance d'une étape en empilant le chemin, et sauvegarde le brouillon. */
  function goTo(next: RapportStep, p?: Partial<RapportAnswers>) {
    const a = { ...answers, ...p };
    const h = [...history, step];
    setHistory(h);
    if (p) setAnswers(a);
    setStep(next);
    saveDraft(next, a, h);
  }

  function goBack() {
    const prev = history[history.length - 1];
    if (!prev) return;
    const h = history.slice(0, -1);
    setHistory(h);
    setStep(prev);
    saveDraft(prev, answers, h);
  }

  function saveDraft(s: RapportStep, a: RapportAnswers, h: RapportStep[]) {
    // Rien de saisi = pas de brouillon : sinon ouvrir puis fermer afficherait
    // « Commencé · étape 1/… » sur la carte pour un rapport où l'on n'a rien fait.
    const rempli = a.showedUp !== null || a.qualified !== null || a.outcomeChoice !== null
      || a.revenue !== '' || a.comment !== '' || a.reschedHow !== null || a.manualDate !== '';
    if (!rempli) return;
    // Compté sur les RÉPONSES et non sur les étapes franchies : revenir en arrière
    // n'efface pas une réponse, elle reste enregistrée — faire reculer le compteur
    // laisserait croire le contraire.
    const repondues = countAnswered(a);
    draft.save({
      kind: 'sales',
      step: s,
      stepIndex: repondues,
      stepTotal: estimateTotal(a, repondues),
      answers: { ...a, history: h },
    });
  }

  // Frappe dans un champ libre (montant, commentaire, date manuelle) : sauvegarde
  // différée, sinon une requête par caractère.
  useEffect(() => {
    if (!hasAnything || step === 'celebration') return;
    draft.saveDebounced({
      kind: 'sales',
      step,
      stepIndex: countAnswered(answers),
      stepTotal: estimateTotal(answers),
      answers: { ...answers, history },
    });
    // `offlineReceived` en dépendance : elle est répondue par un bouton, pas par
    // une frappe, mais elle ne passe pas par `goTo` (on reste sur le même écran).
    // Sans elle, la progression n'était pas mise à jour.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers.revenue, answers.comment, answers.manualDate, answers.manualTimeStart, answers.manualTimeEnd, answers.offlineReceived]);

  // Plus d'avertissement « le rapport n'a pas été enregistré » : c'est devenu faux,
  // les réponses sont gardées. La sauvegarde en attente part au démontage du hook.
  function requestClose() {
    onClose();
  }

  function handleRestart() {
    setAnswers({ ...EMPTY_ANSWERS, isCorrection });
    setHistory([]);
    setStep('show_up');
    setError(null);
    setConfirmRestart(false);
    draft.clear();
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

  /** `how` : comment le prospect va reprendre rendez-vous. */
  async function confirmRescheduled(how: RapportAnswers['reschedHow'] = 'calendly') {
    const a: RapportAnswers = { ...answers, outcomeChoice: 'rescheduled', reschedHow: how };
    setAnswers(a);
    if (await submitRapport(a)) setStep('rescheduled_done');
  }

  async function confirmRescheduledManual() {
    if (!manualValid) return;
    await confirmRescheduled('manual');
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

  // Ces trois-là ne SOUMETTENT plus : elles enregistrent le choix et vont à
  // l'étape commentaire. Le rapport — et la création ou liaison du call de suivi —
  // part d'un bloc à la fin, dans submitRapport. Le commentaire est ainsi inclus
  // dans la même écriture au lieu d'en demander une seconde.

  function confirmSecondCallFound() {
    if (!foundCall) return;
    setAfterComment('second_call_done');
    goTo('comment', { outcomeChoice: 'second_call', reschedHow: 'calendly' });
  }

  function confirmSecondCallViaCalendly() {
    setAfterComment('second_call_done');
    goTo('comment', { outcomeChoice: 'second_call', reschedHow: 'calendly', foundCall: null });
  }

  function confirmSecondCallManual() {
    if (!manualValid) return;
    setAfterComment('second_call_done');
    goTo('comment', { outcomeChoice: 'second_call', reschedHow: 'manual', foundCall: null });
  }

  // ── Étapes existantes ────────────────────────────────────────────────────────

  /**
   * Soumission unique du rapport. Remplace les onze fonctions qui écrivaient au fil
   * de l'eau — c'est le SEUL endroit du composant qui touche la base.
   *
   * Ordre voulu : effets de bord sur d'AUTRES calls d'abord, rapport ensuite. Si un
   * effet de bord échoue, le rapport n'est pas soumis, `outcome` reste null, et la
   * carte du pipeline ne bouge pas — on peut recommencer proprement.
   *
   * Renvoie false en cas d'échec : l'appelant ne doit alors PAS avancer d'étape,
   * sinon l'interface célèbre un enregistrement qui n'a pas eu lieu.
   */
  async function submitRapport(a: RapportAnswers): Promise<boolean> {
    setSaving(true);
    setError(null);
    try {
      await applySideEffects(a);

      const scheduledAtNew = (a.outcomeChoice === 'rescheduled' && a.reschedHow === 'manual' && a.manualDate && a.manualTimeStart)
        ? formInputsToUtc(a.manualDate, a.manualTimeStart, viewerTz).toISOString()
        : null;

      const { rapport, callFields } = buildRapportPatch(a, scheduledAtNew);
      await patchRapport({ ...rapport, ...callFields });

      // Le rapport est en base : le brouillon n'a plus lieu d'être, et le garder
      // risquerait de le voir réappliqué par-dessus plus tard.
      draft.clear();
      return true;
    } catch (e: any) {
      setError(e.message || 'Erreur lors de l\'enregistrement');
      return false;
    } finally {
      setSaving(false);
    }
  }

  /**
   * Écritures qui touchent d'AUTRES calls que celui rapporté. Différées jusqu'ici
   * comme le reste : elles ne dépendent que des réponses déjà saisies, donc elles
   * se rejouent à l'identique au moment de la soumission.
   */
  async function applySideEffects(a: RapportAnswers) {
    if (a.outcomeChoice !== 'second_call') return;

    // Créneau détecté par Calendly : on le marque comme call de suivi.
    if (a.foundCall && a.reschedHow !== 'manual') {
      const res = await fetch(`/api/client/calls/${a.foundCall.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_follow_up: true }),
      });
      // Le créneau a été détecté au moment du parcours ; sur un brouillon repris
      // des jours plus tard il a pu être annulé entre-temps. Un 404/403 ne doit pas
      // empêcher d'enregistrer le rapport : la seule conséquence est un call non
      // marqué « suivi », un écart de comptage sans commune mesure avec un rapport
      // perdu.
      if (!res.ok && res.status !== 404 && res.status !== 403) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Erreur lors de la liaison du 2ème call");
      }
      return;
    }

    // Date saisie à la main : on crée le call de suivi.
    if (a.reschedHow === 'manual' && a.manualDate && a.manualTimeStart && a.manualTimeEnd) {
      const startMs = formInputsToUtc(a.manualDate, a.manualTimeStart, viewerTz).getTime();
      const endMs = formInputsToUtc(a.manualDate, a.manualTimeEnd, viewerTz).getTime();
      const res = await fetch('/api/client/calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ig_username: null,
          scheduled_at: new Date(startMs).toISOString(),
          duration: `${Math.round((endMs - startMs) / 60000)} min`,
          invitee_name: inviteeName,
          is_follow_up: true,
          source: 'manual',
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Erreur lors de la création du 2ème call");
      }
    }
  }

  // ── Navigation pure : plus aucune écriture ici ───────────────────────────────

  async function handleShowUp(showedUp: boolean) {
    if (!showedUp) {
      // No-show : c'est déjà la réponse finale, on soumet directement.
      const a = { ...answers, showedUp: false };
      setAnswers(a);
      if (await submitRapport(a)) onClose();
    } else {
      goTo('qualified', { showedUp: true });
    }
  }

  function handleQualified(qualified: boolean) {
    goTo('closed', { qualified });
  }

  /**
   * Le montant n'écrit plus rien : on passe au commentaire, et c'est à sa sortie
   * que le rapport part d'un bloc. L'étape paiement vient APRÈS — fermer avant
   * laisse la base intacte et permet une reprise exacte.
   */
  function handleRevenue() {
    setAfterComment('celebration');
    goTo('comment', { outcomeChoice: 'closed' });
  }

  /**
   * Crée le deal, avec ou sans lien Stripe.
   *
   * Le deal est enregistré dans les DEUX cas : c'est lui qui porte le cash et
   * l'attribution au contenu. Un encaissement hors Momentum (virement, espèces,
   * argent déjà reçu) reste une vente, elle doit compter.
   */
  async function createDeal(skipLink: boolean) {
    const amount = parseFloat(revenue.replace(',', '.')) || 0;

    // Le rapport part MAINTENANT, pas à l'étape commentaire : les modalités de
    // paiement sont la dernière question, et tant qu'elles ne sont pas choisies le
    // rapport n'est pas terminé. Avant lui pour que le deal créé juste après
    // trouve un call déjà rapporté (outcome + montant), comme quand le rapport
    // était soumis plus tôt.
    //
    // En correction le rapport est déjà en base : `submitRapport` le réécrit à
    // l'identique, sans effet de bord.
    if (!(await submitRapport(answers))) return; // erreur affichée, on reste ici

    setSaving(true);
    setError(null);
    try {
      const r = await fetch('/api/payments/links', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          buyerName: inviteeName || 'Client',
          amount,
          callId,
          // `offline` : hors Stripe. Le plan reste transmis tel quel — un
          // encaissement en 3 virements est bien un échéancier, il a juste
          // besoin d'être coché à la main plutôt que payé par lien.
          offline: skipLink,
          // Hors Stripe seulement : l'argent est-il déjà arrivé, et sinon pour
          // quelle date l'attendre. Sans ça un virement convenu comptait comme
          // encaissé, et le cash affichait de l'argent pas encore reçu.
          ...(skipLink ? { alreadyReceived: offlineReceived === true, dueOn: offlineDue } : {}),
          paymentPlan: plan === 1
            ? 'one_shot'
            : (skipLink || !autoDebit) ? 'installments_manual' : 'installments_auto',
          installmentsCount: plan === 1 ? null : plan,
          installmentInterval: 'month',
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Création impossible');

      // La dernière question du rapport vient d'être répondue.
      setAnswers(prev => ({ ...prev, paymentDone: true }));

      // ⚠️ Ne jamais revenir à `comment` ici : cette étape mène à `payment`, ce qui
      // bouclait à l'infini et empêchait d'enregistrer.
      if (skipLink || !d.url) {
        setStep('celebration');
      } else {
        setPaymentUrl(d.url);
      }
    } catch (e: any) {
      setError(e.message || 'Erreur lors de la création du lien');
    } finally {
      setSaving(false);
    }
  }

  function handleToRecontact() {
    setAfterComment('close');
    goTo('comment', { outcomeChoice: 'to_recontact' });
  }

  /**
   * Sortie de l'étape commentaire : C'EST ICI que le rapport part en base, d'un
   * seul bloc — outcome, qualified, montant et commentaire dans la même écriture.
   *
   * Les deux boutons (« Enregistrer » et « Passer ») aboutissent au même endroit :
   * passer le commentaire ne veut pas dire renoncer au rapport.
   */
  async function handleSaveComment(override?: RapportAnswers) {
    // `override` : le bouton « Passer » vide le commentaire. On passe la valeur
    // directement plutôt que par setState, dont la mise à jour n'est pas visible
    // dans le même gestionnaire d'événement.
    const a = override ?? answers;
    if (override) setAnswers(override);

    // Deal closé en saisie initiale : les modalités de paiement sont la DERNIÈRE
    // question du rapport, pas une action d'après-coup. On n'enregistre donc rien
    // ici — c'est `createDeal` qui soumettra le rapport et le deal ensemble.
    //
    // Fermer sur l'écran paiement ne perd rien : le brouillon garde tout et
    // rouvrir ramène exactement là, pour finir de choisir les modalités.
    if (a.outcomeChoice === 'closed' && !isCorrection) {
      goTo('payment');
      return;
    }

    const ok = await submitRapport(a);
    if (!ok) return; // erreur affichée, on reste sur l'étape

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

      {/* Plus de « Fermer sans terminer ? » : les réponses sont gardées, l'alerte
          serait devenue un mensonge. La case à cocher est réservée à
          « Recommencer », qui efface réellement quelque chose. */}
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

      {step !== 'celebration' && (
        <ModalShell
          onClose={onClose}
          onOverlayClick={requestClose}
          variant="sheet"
          fullScreen={step === 'revenue' || step === 'payment' || step === 'offline' || step === 'comment'}
          width={520}
        >
        <div style={{ padding: '48px 24px 32px', overflowY: 'auto' }}>
          {/* En-tête */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <div>
              <div className="eyebrow-lg" style={{ color: 'var(--muted)', marginBottom: 4 }}>
                {/* « de vente » explicite : « Rapport de call » ne disait pas de quel
                    type de call il s'agissait, face au « Rapport de session » du
                    coaching. Le libellé de correction reste court — il est déjà clair,
                    et l'allonger n'apporterait rien. */}
                {isCorrection ? 'Corriger le rapport' : 'Rapport de call de vente'}
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)' }}>
                {inviteeName ? `Appel avec ${inviteeName}` : 'Appel découverte'}
              </div>
              {scheduledAt && (
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                  {formatDate(scheduledAt, viewerTz)} · {formatTime(scheduledAt, viewerTz)}
                </div>
              )}
            </div>
            <button type="button" onClick={requestClose} aria-label="Fermer" className="icon-btn" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--muted)', flexShrink: 0 }}>
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
            /* Le nom de la personne plutôt que « Le lead » : on rapporte un appel
               avec quelqu'un de précis, pas une entrée de pipeline. Nom complet tel
               que Calendly l'a enregistré — le découper au premier mot supposerait
               un « prénom nom » que les données ne garantissent pas (beaucoup de
               noms en un seul mot). Repli sur « Le lead » si invitee_name est absent. */
            <RapportChoiceStep
              question={inviteeName?.trim() ? `${inviteeName.trim()} s'est présenté ?` : "Le lead s'est présenté ?"}
              hint="Était-il au rendez-vous ?"
              disabled={saving}
              // `value` : au retour arrière, la réponse déjà donnée est surlignée.
              // Sans elle on retomberait sur une question qui semble vierge alors
              // qu'on y a répondu — c'est ce que la navigation arrière rendait
              // nécessaire, et la raison d'être de ce composant.
              value={answers.showedUp === true ? 'yes' : answers.showedUp === false ? 'no' : answers.outcomeChoice === 'rescheduled' ? 'rescheduled' : null}
              choices={[
                { value: 'yes', label: 'Oui, il était là', tone: 'primary' },
                { value: 'no', label: 'No-show' },
                { value: 'rescheduled', label: 'Appel reporté — nouvelle date à planifier', tone: 'warning' },
              ]}
              onChoose={v => {
                if (v === 'yes') handleShowUp(true);
                else if (v === 'no') handleShowUp(false);
                else handleRescheduled();
              }}
            />
          )}

          {/* ── Étape 1.5 — qualifié ? ──────────────────────────────────────── */}
          {step === 'qualified' && (
            <RapportChoiceStep
              question="Le prospect était-il qualifié ?"
              hint="Correspond-il au profil recherché (besoin, budget, timing) ?"
              disabled={saving}
              value={answers.qualified === true ? 'yes' : answers.qualified === false ? 'no' : null}
              choices={[
                { value: 'yes', label: 'Oui, qualifié', tone: 'primary' },
                { value: 'no', label: 'Non, pas qualifié', tone: 'neutral' },
              ]}
              onChoose={v => handleQualified(v === 'yes')}
            />
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
            <RapportChoiceStep
              question="Comment va-t-il reréserver ?"
              hint="Aucun nouveau créneau n'a été détecté sur Calendly."
              disabled={saving}
              value={answers.reschedHow}
              choices={[
                { value: 'calendly', label: 'Via Calendly — il va reréserver lui-même' },
                { value: 'manual', label: 'Manuellement — je vais saisir la date' },
                { value: 'unknown', label: 'Date pas encore connue', tone: 'muted' },
              ]}
              onChoose={v => {
                // `goTo` pour empiler l'historique : sans lui le Retour depuis
                // l'écran de saisie manuelle serait mort.
                if (v === 'manual') goTo('rescheduled_manual_date', { reschedHow: 'manual' });
                else confirmRescheduled(v === 'unknown' ? 'unknown' : 'calendly');
              }}
            />
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
            <RapportChoiceStep
              question="Résultat du call ?"
              hint="Qu'est-ce qui s'est passé ?"
              disabled={saving}
              value={answers.outcomeChoice === 'rescheduled' ? null : answers.outcomeChoice}
              choices={[
                { value: 'closed', label: 'Oui, lead closé !', tone: 'primary' },
                { value: 'second_call', label: isFollowUp ? 'Prochain call prévu' : '2ème call prévu' },
                { value: 'to_recontact', label: 'Pas closé — à recontacter' },
              ]}
              onChoose={v => {
                // `goTo` et non `setStep` : sans lui l'étape n'est pas empilée dans
                // l'historique, et le Retour depuis l'écran du montant serait mort.
                if (v === 'closed') goTo('revenue', { outcomeChoice: 'closed' });
                else if (v === 'second_call') handleSecondCall();
                else handleToRecontact();
              }}
            />
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
            <RapportChoiceStep
              question="Comment va-t-il reréserver ?"
              hint="Aucun prochain call n'a été détecté sur Calendly."
              disabled={saving}
              value={answers.reschedHow}
              choices={[
                { value: 'calendly', label: 'Via Calendly — il va reréserver lui-même' },
                { value: 'manual', label: 'Manuellement — je connais la date' },
                { value: 'unknown', label: 'Date pas encore connue', tone: 'muted' },
              ]}
              onChoose={v => {
                if (v === 'manual') goTo('second_call_manual_date', { outcomeChoice: 'second_call', reschedHow: 'manual' });
                else confirmSecondCallViaCalendly();
              }}
            />
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
                <input ref={inputRef} className="input" type="text" placeholder="0" value={revenue} onChange={e => setRevenue(e.target.value)}
                  style={{ flex: 1, fontSize: 20, fontWeight: 700, textAlign: 'right' }} autoFocus inputMode="decimal" />
                <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent)' }}>€</span>
              </div>
              <button className="btn-primary-brand" type="button" style={{ width: '100%', padding: '16px', fontSize: 15, fontWeight: 700 }} disabled={saving} onClick={handleRevenue}>
                {saving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          )}

          {/* ── Plan de paiement + lien Stripe ──────────────────────────────── */}
          {step === 'payment' && (
            <div>
              {paymentUrl ? (
                <>
                  <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent)', marginBottom: 8 }}>Lien prêt à envoyer</div>
                  <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20, lineHeight: 1.6 }}>
                    Copie-le et envoie-le à {inviteeName || 'ton client'} depuis ton canal habituel.
                  </div>
                  <div style={{ padding: '12px 14px', background: 'var(--surface-2)', borderRadius: 10, fontSize: 12, wordBreak: 'break-all', marginBottom: 14, fontFamily: 'monospace' }}>
                    {paymentUrl}
                  </div>
                  <button className="btn-primary-brand" type="button" style={{ width: '100%', padding: '16px', fontSize: 15, fontWeight: 700, marginBottom: 10 }}
                    onClick={async () => {
                      await navigator.clipboard.writeText(paymentUrl);
                      setLinkCopied(true);
                      setTimeout(() => setLinkCopied(false), 2000);
                    }}>
                    {linkCopied ? 'Copié ✓' : 'Copier le lien'}
                  </button>
                  {/* Où retrouver ce lien plus tard : sans cette phrase, fermer la
                      modale donne l'impression d'avoir perdu le lien, alors qu'il
                      vit dans la page Paiements — avec un lien par échéance quand le
                      paiement est en plusieurs fois. */}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '11px 13px', background: 'var(--accent-brand-soft)', borderRadius: 10, fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.55, marginBottom: 14 }}>
                    <Icon name="info" size={14} style={{ flexShrink: 0, marginTop: 1, color: 'var(--accent-brand)' }} />
                    <span>
                      Tu retrouveras ce lien dans <strong>Paiements</strong>, sur la fiche de {inviteeName || 'ce client'}
                      {plan > 1 ? <> — avec un lien par échéance, et le suivi de celles déjà payées.</> : <>.</>}
                    </span>
                  </div>
                  <button className="btn-ghost" type="button" style={{ width: '100%', padding: '14px', fontSize: 14, border: '1px solid var(--border)' }}
                    onClick={() => setStep('celebration')}>
                    Continuer
                  </button>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent)', marginBottom: 8 }}>En combien de fois ?</div>
                  <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20, lineHeight: 1.6 }}>
                    Momentum génère le lien de paiement Stripe.
                  </div>

                  {/* Sélection en --accent-brand (le bleu de la marque) et non en
                      --accent (le noir d'encre) : un choix retenu se lit comme une
                      action de l'utilisateur, pas comme du texte. C'est aussi la
                      couleur du bouton principal juste en dessous, donc le même
                      langage visuel sur tout l'écran. */}
                  <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
                    {([[1, 'Comptant'], [2, '2×'], [3, '3×'], [4, '4×']] as const).map(([n, label]) => (
                      <button key={n} type="button" onClick={() => setPlan(n)}
                        style={{
                          border: `1px solid ${plan === n ? 'var(--accent-brand)' : 'var(--border)'}`,
                          background: plan === n ? 'var(--accent-brand)' : 'var(--surface)',
                          color: plan === n ? '#fff' : 'var(--ink-2)',
                          fontWeight: plan === n ? 600 : 400,
                          borderRadius: 999, padding: '9px 17px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
                        }}>{label}</button>
                    ))}
                  </div>

                  {plan > 1 && (
                    <>
                      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                        <button type="button" onClick={() => setAutoDebit(true)}
                          style={{
                            border: `1px solid ${autoDebit ? 'var(--accent-brand)' : 'var(--border)'}`,
                            background: autoDebit ? 'var(--accent-brand)' : 'var(--surface)',
                            color: autoDebit ? '#fff' : 'var(--ink-2)',
                            fontWeight: autoDebit ? 600 : 400,
                            borderRadius: 999, padding: '9px 17px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
                          }}>Prélèvement auto</button>
                        <button type="button" onClick={() => setAutoDebit(false)}
                          style={{
                            border: `1px solid ${!autoDebit ? 'var(--accent-brand)' : 'var(--border)'}`,
                            background: !autoDebit ? 'var(--accent-brand)' : 'var(--surface)',
                            color: !autoDebit ? '#fff' : 'var(--ink-2)',
                            fontWeight: !autoDebit ? 600 : 400,
                            borderRadius: 999, padding: '9px 17px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
                          }}>Un lien par échéance</button>
                      </div>
                      {/* C'est ici que se joue le compromis : ce que l'élève aura
                          à faire ensuite, mois après mois. */}
                      <div style={{ padding: '12px 14px', background: 'var(--surface-2)', borderRadius: 10, fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.55, marginBottom: 18 }}>
                        {plan} × {Math.round(((parseFloat(revenue.replace(',', '.')) || 0) / plan) * 100) / 100} € par mois.{' '}
                        {autoDebit
                          ? 'Le client saisit sa carte une fois, Stripe prélève ensuite tout seul.'
                          : `Tu enverras ${plan} liens, un par échéance. Momentum te rappellera lesquels.`}
                      </div>
                    </>
                  )}

                  <button className="btn-primary-brand" type="button" style={{ width: '100%', padding: '16px', fontSize: 15, fontWeight: 700, marginBottom: 10 }}
                    disabled={saving} onClick={() => createDeal(false)}>
                    {saving ? 'Création…' : 'Générer le lien de paiement'}
                  </button>
                  {/* Le deal est enregistré dans tous les cas — c'est lui qui
                      porte le cash et l'attribution, pas le lien Stripe. */}
                  <button className="btn-ghost" type="button" style={{ width: '100%', padding: '14px', fontSize: 14, border: '1px solid var(--border)' }}
                    disabled={saving} onClick={() => setStep('offline')}>
                    Paiement hors Stripe (virement, espèces)
                  </button>
                  {plan > 1 && (
                    <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 8, lineHeight: 1.5, textAlign: 'center' }}>
                      Momentum créera les {plan} échéances et te rappellera chacune
                      à sa date dans l&apos;onglet Relances.
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── Commentaire facultatif et privé — visible uniquement par l'auteur ── */}
          {/* ── Encaissement hors Stripe : déjà reçu, ou attendu ? ─────────── */}
          {step === 'offline' && (
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent)', marginBottom: 8 }}>
                {plan === 1 ? 'L’argent est-il déjà arrivé ?' : 'Le 1er versement est-il déjà arrivé ?'}
              </div>
              {/* Le montant concerné lève l'ambiguïté : en plusieurs fois, la
                  question porte sur le PREMIER versement, pas sur le total. */}
              <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20, lineHeight: 1.6 }}>
                {plan === 1
                  ? `${fmtMontant(parseFloat(revenue.replace(',', '.')) || 0)} — Momentum ne peut pas le savoir, aucun paiement hors Stripe ne remonte automatiquement.`
                  : `${fmtMontant(Math.round(((parseFloat(revenue.replace(',', '.')) || 0) / plan) * 100) / 100)} sur ${plan} versements. Momentum créera l’échéancier et te rappellera chaque versement à sa date.`}
              </div>

              <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
                {([
                  [true, plan === 1 ? 'Oui, déjà encaissé' : 'Oui, déjà reçu'],
                  [false, plan === 1 ? 'Non, à venir' : 'Non, pas encore'],
                ] as const).map(([v, label]) => (
                  <button key={String(v)} type="button" onClick={() => setOfflineReceived(v)}
                    style={{
                      border: `1px solid ${offlineReceived === v ? 'var(--accent)' : 'var(--border)'}`,
                      background: offlineReceived === v ? 'var(--accent)' : 'var(--surface)',
                      color: offlineReceived === v ? '#fff' : 'var(--ink-2)',
                      fontWeight: offlineReceived === v ? 600 : 400,
                      borderRadius: 999, padding: '10px 18px', fontSize: 13.5, cursor: 'pointer', fontFamily: 'inherit',
                    }}>{label}</button>
                ))}
              </div>

              {/* La date n'a de sens qu'en comptant : en plusieurs fois,
                  l'échéancier est calculé à partir d'aujourd'hui. */}
              {offlineReceived === false && plan === 1 && (
                <div style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 7 }}>Paiement attendu le</div>
                  <input className="input" type="date" value={offlineDue}
                    onChange={e => setOfflineDue(e.target.value)}
                    style={{ width: '100%', fontSize: 15 }} />
                  <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 7, lineHeight: 1.5 }}>
                    Tu recevras un rappel 2 jours avant, puis 2 jours après si
                    le paiement n&apos;est toujours pas arrivé.
                  </div>
                </div>
              )}

              <button className="btn-primary-brand" type="button"
                style={{ width: '100%', padding: '16px', fontSize: 15, fontWeight: 700, opacity: offlineReceived === null ? .5 : 1 }}
                disabled={saving || offlineReceived === null} onClick={() => createDeal(true)}>
                {saving ? 'Enregistrement…' : 'Enregistrer le deal'}
              </button>
            </div>
          )}

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
              {/* « Passer » soumet le rapport comme « Enregistrer » : le
                  commentaire est facultatif, le rapport ne l'est pas. Le sauter
                  sans enregistrer perdrait tout le parcours. */}
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn-ghost" type="button" style={{ flex: 1, padding: '14px', fontSize: 14, border: '1px solid var(--border)' }} disabled={saving}
                  onClick={() => handleSaveComment({ ...answers, comment: '' })}>
                  Passer
                </button>
                <button className="btn-primary-brand" type="button" style={{ flex: 1, padding: '14px', fontSize: 14, fontWeight: 700 }} disabled={saving} onClick={() => handleSaveComment()}>
                  {saving ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </div>
            </div>
          )}

          {/* Retour et Recommencer côte à côte, en bas. Pas dans l'en-tête : la
              croix y est déjà, et trois sorties alignées prêtent à confusion sur
              mobile. Même police et même encadré pour les deux — ce sont deux
              actions de navigation de même rang, seule leur portée diffère. */}
          {((!NO_BACK.includes(step) && history.length > 0) || (hasAnything && !NO_RESTART.includes(step))) && (
            <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
              {!NO_BACK.includes(step) && history.length > 0 && (
                <button type="button" onClick={goBack} disabled={saving}
                  className="btn-ghost" style={{ flex: 1, fontSize: 13, padding: '12px', color: 'var(--muted)', border: '1px solid var(--border)' }}>
                  ‹ Retour
                </button>
              )}
              {hasAnything && !NO_RESTART.includes(step) && (
                <button type="button" onClick={() => { setRestartChecked(false); setConfirmRestart(true); }} disabled={saving}
                  className="btn-ghost" style={{ flex: 1, fontSize: 13, padding: '12px', color: 'var(--muted)', border: '1px solid var(--border)' }}>
                  Recommencer
                </button>
              )}
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
