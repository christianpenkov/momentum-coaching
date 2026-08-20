'use client';

import { useCallback, useEffect, useRef } from 'react';

/**
 * Sauvegarde du brouillon de rapport — best-effort, jamais bloquante.
 *
 * RÈGLE CENTRALE : ce hook n'échoue jamais visiblement. Il n'affiche pas d'erreur,
 * ne bloque aucune action, ne fait échouer aucune fermeture. Une sauvegarde ratée
 * n'a qu'une conséquence : la reprise sera moins précise. C'est l'inverse exact de
 * `patchRapport`, qui doit lever pour empêcher l'UI de célébrer un deal non
 * persisté.
 *
 * CONTREPARTIE À CONNAÎTRE : si la route casse en production (variable d'env
 * manquante, migration non appliquée), personne ne s'en aperçoit — l'app se
 * comporte exactement comme avant ce chantier, les brouillons ne sont juste jamais
 * gardés. D'où le console.warn ci-dessous, et la vérification manuelle après
 * déploiement : ouvrir un rapport, saisir, fermer, rouvrir.
 */

export type DraftKind = 'sales' | 'session';

export interface RapportDraft {
  id: string;
  kind: DraftKind;
  step: string;
  step_index: number;
  step_total: number;
  answers: Record<string, unknown>;
  updated_at: string;
}

export interface DraftCallState {
  outcome: string | null;
  session_completed: boolean | null;
  session_no_show: boolean | null;
  status: string | null;
}

/**
 * Charge le brouillon d'un call. À appeler depuis un composant CHARGEUR, jamais
 * depuis la modale elle-même : le brouillon doit être résolu AVANT le premier
 * rendu du formulaire, sinon les initialiseurs `useState` sont lus trop tôt et
 * l'écran affiche l'étape 1 vide avant de sauter à la bonne étape.
 */
export async function fetchRapportDraft(callId: string): Promise<{ draft: RapportDraft | null; call: DraftCallState | null }> {
  try {
    const res = await fetch(`/api/calls/${callId}/rapport-draft`, { credentials: 'same-origin' });
    if (!res.ok) return { draft: null, call: null };
    const data = await res.json();
    return { draft: data.draft ?? null, call: data.call ?? null };
  } catch (err) {
    console.warn('[rapport-draft] chargement ignoré', err);
    return { draft: null, call: null };
  }
}

/**
 * Un brouillon est PÉRIMÉ quand il décrit une saisie initiale alors que le rapport
 * a été soumis depuis (autre onglet, autre appareil, correction depuis le
 * pipeline). Le rejouer réécrirait le rapport avec de vieilles réponses — et
 * déplacerait la carte du pipeline au passage.
 */
export function isDraftStale(draft: RapportDraft | null, call: DraftCallState | null): boolean {
  if (!draft || !call) return false;
  const isCorrection = draft.answers?.isCorrection === true;
  if (isCorrection) return false;
  return draft.kind === 'sales'
    ? call.outcome != null
    : call.session_completed === true || call.session_no_show === true;
}

interface SaveArgs {
  kind: DraftKind;
  step: string;
  stepIndex: number;
  stepTotal: number;
  // `object` et non `Record<string, unknown>` : une interface déclarée (SessionAnswers,
  // RapportAnswers) n'a pas d'index signature et n'est donc pas assignable à un
  // Record. Les modales passent leur propre type ; ce hook n'a pas à le connaître,
  // il ne fait que le sérialiser.
  answers: object;
}

/**
 * Écriture du brouillon : sauvegarde immédiate, sauvegarde différée (frappe), et
 * purge après soumission.
 */
export function useRapportDraftWriter(callId: string) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Dernier état connu, relu par le flush de fermeture de page — un state React
  // serait figé à la valeur capturée au moment où l'écouteur a été posé.
  const latest = useRef<SaveArgs | null>(null);

  const send = useCallback((args: SaveArgs, keepalive = false) => {
    latest.current = args;
    fetch(`/api/calls/${callId}/rapport-draft`, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: args.kind,
        step: args.step,
        step_index: args.stepIndex,
        step_total: args.stepTotal,
        answers: args.answers,
      }),
      // `keepalive` demande au navigateur de terminer la requête même après la
      // destruction du document. C'est le seul mécanisme qui survit à un
      // swipe-away de PWA sur iOS. Limite du standard : 64 Ko de corps, très
      // au-dessus de nos brouillons (bornés côté route).
      keepalive,
    }).catch(err => console.warn('[rapport-draft] sauvegarde ignorée', err));
  }, [callId]);

  /** Sauvegarde tout de suite — à chaque changement d'étape. */
  const save = useCallback((args: SaveArgs) => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    send(args);
  }, [send]);

  /** Sauvegarde différée — pour la frappe dans un champ libre. */
  const saveDebounced = useCallback((args: SaveArgs) => {
    latest.current = args;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; send(args); }, 800);
  }, [send]);

  /** Supprime le brouillon — après une soumission réussie ou un « Recommencer ». */
  const clear = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    latest.current = null;
    fetch(`/api/calls/${callId}/rapport-draft`, { method: 'DELETE', credentials: 'same-origin' })
      .catch(err => console.warn('[rapport-draft] suppression ignorée', err));
  }, [callId]);

  // Filet de sécurité : onglet fermé, PWA balayée, app tuée par le système. Sans
  // lui, un debounce en cours au moment de la fermeture serait perdu — précisément
  // le cas où la reprise a le plus de valeur.
  //
  // `pagehide` ET `visibilitychange` : sur iOS `beforeunload` n'est pas fiable, et
  // `pagehide` peut être sauté quand l'app passe en arrière-plan avant d'être tuée.
  // `visibilitychange` → 'hidden' se déclenche dans les deux cas.
  useEffect(() => {
    const flush = () => {
      if (timer.current && latest.current) {
        clearTimeout(timer.current);
        timer.current = null;
        send(latest.current, true);
      }
    };
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
      // Démontage volontaire (fermeture de la modale) : on envoie ce qui reste en
      // attente plutôt que de l'abandonner.
      flush();
    };
  }, [send]);

  return { save, saveDebounced, clear };
}
