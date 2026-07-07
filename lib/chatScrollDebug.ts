'use client';

/**
 * Buffer de debug temporaire pour le scroll de la messagerie — pas de console.log direct
 * (gênant sur mobile), juste un buffer en mémoire consultable via un bouton "Logs" dans l'UI.
 * À retirer une fois le bug de scroll résolu.
 */
const buffer: string[] = [];

export function logChatScroll(label: string, data?: unknown) {
  const stamped = `${new Date().toISOString().split('T')[1].slice(0, 12)} [chat-scroll] ${label}${data ? ' ' + JSON.stringify(data) : ''}`;
  buffer.push(stamped);
  if (buffer.length > 200) buffer.shift();
}

export function getChatScrollLogs() {
  return buffer.join('\n');
}

export function clearChatScrollLogs() {
  buffer.length = 0;
}
