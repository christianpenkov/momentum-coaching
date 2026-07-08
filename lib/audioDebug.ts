'use client';

/**
 * Buffer de debug temporaire pour les vocaux (bug lecture bloquée sur mobile) —
 * pas de console.log direct (inaccessible sur mobile), juste un buffer en
 * mémoire consultable via le bouton "Logs vocaux" dans le header de la
 * messagerie. À retirer une fois le bug de lecture mobile résolu.
 */
const buffer: string[] = [];

export function logAudio(label: string, data?: unknown) {
  const stamped = `${new Date().toISOString().split('T')[1].slice(0, 12)} [audio] ${label}${data ? ' ' + JSON.stringify(data) : ''}`;
  buffer.push(stamped);
  if (buffer.length > 500) buffer.shift();
}

export function getAudioLogs() {
  return buffer.join('\n');
}

export function clearAudioLogs() {
  buffer.length = 0;
}
