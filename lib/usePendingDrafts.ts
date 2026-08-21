'use client';

import { useEffect, useState } from 'react';

/**
 * Quels calls parmi ceux affichés ont un brouillon À MOI ?
 *
 * Une seule requête pour toute la liste, jamais un appel par carte. Ne rapatrie
 * que la progression et l'ancienneté — le contenu des réponses reste côté serveur,
 * il peut contenir des notes privées.
 *
 * Tolérant à l'échec : en cas d'erreur on renvoie un objet vide, donc des cartes
 * sans mention « Commencé ». Un repère décoratif ne doit jamais faire tomber la
 * liste des rapports en attente.
 */

export interface DraftProgress {
  stepIndex: number;
  stepTotal: number;
  updatedAt: string;
}

export function usePendingDrafts(callIds: string[]): Record<string, DraftProgress> {
  const [drafts, setDrafts] = useState<Record<string, DraftProgress>>({});
  // Incrémenté à chaque `notifs-refresh` pour relancer la requête sans changer la
  // liste d'ids — une modale qui vient d'être fermée a pu créer ou supprimer un
  // brouillon, et la clé des ids, elle, n'a pas bougé.
  const [tick, setTick] = useState(0);

  // Clé stable : un tableau change de référence à chaque rendu et relancerait la
  // requête en boucle. Trié pour que le même ensemble donne toujours la même clé.
  const key = [...callIds].sort().join(',');

  useEffect(() => {
    if (!key) { setDrafts({}); return; }
    let alive = true;
    fetch(`/api/calls/rapport-drafts?ids=${encodeURIComponent(key)}`, { credentials: 'same-origin' })
      .then(r => (r.ok ? r.json() : { drafts: {} }))
      .then(data => {
        if (!alive) return;
        const out: Record<string, DraftProgress> = {};
        for (const [id, d] of Object.entries((data.drafts ?? {}) as Record<string, any>)) {
          out[id] = { stepIndex: d.step_index, stepTotal: d.step_total, updatedAt: d.updated_at };
        }
        setDrafts(out);
      })
      .catch(err => console.warn('[rapport-drafts] listing ignoré', err));
    return () => { alive = false; };
  }, [key, tick]);

  // Les deux modales émettent déjà `notifs-refresh` après une soumission réussie —
  // on se greffe dessus plutôt que d'inventer un second canal. Couvre le cas
  // principal : rapport soumis → brouillon supprimé → la mention doit disparaître.
  useEffect(() => {
    const handler = () => setTick(t => t + 1);
    window.addEventListener('notifs-refresh', handler);
    return () => window.removeEventListener('notifs-refresh', handler);
  }, []);

  return drafts;
}
