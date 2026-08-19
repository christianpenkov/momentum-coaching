'use client';

import { useEffect, useState } from 'react';

/**
 * État réseau de l'application, source unique pour toute l'app.
 *
 * Pourquoi pas `navigator.onLine` directement : il rapporte « en ligne » dès
 * qu'une interface réseau existe, y compris sur un wifi qui ne route plus ou
 * derrière un portail captif d'hôtel. C'est le faux positif classique — l'app
 * croit avoir du réseau, les requêtes échouent quand même.
 *
 * On confirme donc par une vraie requête vers l'origine, et on re-sonde
 * régulièrement : un réseau qui meurt en silence ne déclenche aucun événement.
 *
 * Un seul sondage partagé (module-level) quel que soit le nombre de composants
 * qui appellent le hook : sans ça, dix composants montés feraient dix requêtes
 * toutes les quinze secondes.
 */

const PROBE_URL = '/manifest.json';
const PROBE_INTERVAL_MS = 15000;

type Listener = (online: boolean) => void;

let online = true;
let listeners: Listener[] = [];
let timer: ReturnType<typeof setInterval> | null = null;

async function probe(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
  try {
    const res = await fetch(PROBE_URL, { method: 'HEAD', cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}

async function check() {
  const next = await probe();
  if (next === online) return;
  online = next;
  listeners.forEach(l => l(online));
}

function start() {
  if (timer) return;
  check();
  timer = setInterval(check, PROBE_INTERVAL_MS);
  window.addEventListener('online', check);
  window.addEventListener('offline', check);
  // Au retour dans l'app après une veille, l'état a pu changer sans qu'aucun
  // événement n'ait été reçu (le JS ne tournait pas).
  document.addEventListener('visibilitychange', check);
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
  window.removeEventListener('online', check);
  window.removeEventListener('offline', check);
  document.removeEventListener('visibilitychange', check);
}

/** @returns true quand l'app a réellement accès au réseau. */
export function useOnline(): boolean {
  const [value, setValue] = useState(online);

  useEffect(() => {
    listeners.push(setValue);
    start();
    setValue(online);
    return () => {
      listeners = listeners.filter(l => l !== setValue);
      if (listeners.length === 0) stop();
    };
  }, []);

  return value;
}

/**
 * Vérification ponctuelle, pour un gestionnaire d'action qui doit trancher
 * avant de lancer des requêtes. Repose sur le dernier état connu du sondage
 * partagé — pas d'appel réseau supplémentaire au moment du clic.
 */
export function isOnlineNow(): boolean {
  return online;
}
