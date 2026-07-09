'use client';

/**
 * Buffer de debug temporaire pour traquer le bug de scroll qui saute au cold start
 * mobile — logge tout changement de scrollTop de .chat-messages-zone avec la source
 * (quel code l'a déclenché) et un extrait de stack trace. Consultable via le bouton
 * "Copier logs" dans le header de la messagerie. À retirer une fois le bug résolu.
 */
const buffer: string[] = [];

export function logScroll(label: string, data?: unknown) {
  const stamped = `${new Date().toISOString().split('T')[1].slice(0, 12)} [scroll] ${label}${data ? ' ' + JSON.stringify(data) : ''}`;
  buffer.push(stamped);
  if (buffer.length > 400) buffer.shift();
}

// Capture un extrait de stack (3-4 frames utiles, sans le bruit du haut) pour savoir
// QUI a appelé ce point de log — utile pour distinguer plusieurs sites d'appel qui
// loggent le même label.
export function shortStack(): string {
  const s = new Error().stack || '';
  return s.split('\n').slice(2, 6).map(l => l.trim()).join(' | ');
}

export function getScrollLogs() {
  return buffer.join('\n');
}

export function clearScrollLogs() {
  buffer.length = 0;
}

// Instrumente scrollTop sur un élément donné pour logger CHAQUE écriture, peu importe
// le code qui la déclenche — filet de sécurité si un site d'appel non instrumenté
// manuellement existe encore (ex: code tiers, navigateur lui-même via scrollIntoView).
export function watchScrollTop(el: HTMLElement, tag: string) {
  const proto = Object.getPrototypeOf(el);
  const desc = Object.getOwnPropertyDescriptor(proto, 'scrollTop') || Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
  if (!desc || !desc.set || !desc.get) return () => {};
  const originalSet = desc.set;
  const originalGet = desc.get;
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get() { return originalGet.call(this); },
    set(v: number) {
      const before = originalGet.call(this);
      logScroll(`${tag} scrollTop SET`, { from: before, to: v, delta: v - before, stack: shortStack() });
      originalSet.call(this, v);
    },
  });
  return () => {
    Object.defineProperty(el, 'scrollTop', desc);
  };
}
