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

// Dernier resultat connu, conserve ENTRE les montages et indexe par ensemble
// d'ids.
//
// Sans lui, revenir sur l'accueil repartait d'un objet vide : la mention
// « Commence il y a X jours - etape N/M » n'existait pas au premier rendu, puis
// s'ajoutait une fois la requete revenue. Elle occupe une ligne, donc la carte
// grandissait et poussait le contenu en dessous — le meme micro-deplacement que
// celui deja corrige sur le carrousel lui-meme et sur le bandeau du prochain
// call.
//
// L'ancienne valeur est reaffichee immediatement puis remplacee sur place par la
// version fraiche : la requete a toujours lieu, elle n'est simplement plus
// precedee d'un trou.
const cachedDrafts = new Map<string, Record<string, DraftProgress>>();
// Borne basse volontaire : quelques ecrans affichent des listes differentes
// (accueil coach, accueil eleve, page Calls eleve). Au-dela, on oublie le plus
// ancien plutot que de laisser la table croitre indefiniment.
const CACHE_MAX = 8;

function rememberDrafts(key: string, value: Record<string, DraftProgress>) {
  if (cachedDrafts.has(key)) cachedDrafts.delete(key);
  cachedDrafts.set(key, value);
  if (cachedDrafts.size > CACHE_MAX) {
    const oldest = cachedDrafts.keys().next().value;
    if (oldest !== undefined) cachedDrafts.delete(oldest);
  }
}

export function usePendingDrafts(callIds: string[]): Record<string, DraftProgress> {
  // Clé stable : un tableau change de référence à chaque rendu et relancerait la
  // requête en boucle. Trié pour que le même ensemble donne toujours la même clé.
  // Calculée avant l'état : elle sert dès le premier rendu à retrouver l'entrée
  // en cache, ce qui évite le trou d'un rendu que corrigerait un effet.
  const key = [...callIds].sort().join(',');

  const [drafts, setDrafts] = useState<Record<string, DraftProgress>>(
    () => cachedDrafts.get(key) ?? {}
  );
  // Incrémenté à chaque `notifs-refresh` pour relancer la requête sans changer la
  // liste d'ids — une modale qui vient d'être fermée a pu créer ou supprimer un
  // brouillon, et la clé des ids, elle, n'a pas bougé.
  const [tick, setTick] = useState(0);

  // Reamorcage depuis le cache : sur changement de LISTE uniquement, jamais sur
  // `tick`. Un tick suit une soumission de rapport — le brouillon vient d'etre
  // supprime, et reafficher l'entree en cache le ferait reapparaitre le temps de
  // la requete. Le cache sert a eviter un trou, pas a ressusciter une donnee
  // qu'on sait fausse.
  useEffect(() => {
    setDrafts(cachedDrafts.get(key) ?? {});
  }, [key]);

  useEffect(() => {
    if (!key) { setDrafts({}); return; }
    let alive = true;
    fetch(`/api/calls/rapport-drafts?ids=${encodeURIComponent(key)}`, { credentials: 'same-origin' })
      .then(r => (r.ok ? r.json() : { drafts: {} }))
      .then(data => {
        const out: Record<string, DraftProgress> = {};
        for (const [id, d] of Object.entries((data.drafts ?? {}) as Record<string, any>)) {
          out[id] = { stepIndex: d.step_index, stepTotal: d.step_total, updatedAt: d.updated_at };
        }
        // Le cache est mis a jour meme si ce montage-ci a ete demonte entre-temps :
        // la reponse reste valable pour le prochain passage, et c'est precisement
        // le cas d'une navigation rapide aller-retour.
        rememberDrafts(key, out);
        if (!alive) return;
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
