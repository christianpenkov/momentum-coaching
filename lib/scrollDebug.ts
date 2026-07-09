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
      const delta = v - before;
      logScroll(`${tag} scrollTop SET`, { from: before, to: v, delta, stack: shortStack() });
      // Affiche aussi en direct dans la console DevTools (pas juste le buffer interne) —
      // console.trace donne la VRAIE stack native cliquable de Chrome, bien plus lisible
      // que l'extrait manuel de shortStack() pour repérer le site d'appel exact en un clic.
      if (Math.abs(delta) > 5) {
        // eslint-disable-next-line no-console
        console.trace(`[SCROLL-DEBUG] ${tag} scrollTop: ${before} → ${v} (delta ${delta})`);
      }
      originalSet.call(this, v);
    },
  });
  return () => {
    Object.defineProperty(el, 'scrollTop', desc);
  };
}

// Instrumente aussi scrollIntoView/scrollTo au niveau global — certains scrolls natifs
// (focus, scrollIntoView du navigateur) ne passent jamais par le setter scrollTop d'un
// élément précis mais par ces méthodes, invisibles à watchScrollTop seul.
export function watchGlobalScrollMethods() {
  const originalScrollIntoView = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function (this: Element, ...args: unknown[]) {
    const el = this as HTMLElement;
    console.trace(`[SCROLL-DEBUG] scrollIntoView() called on`, el.tagName, el.className?.toString().slice(0, 60), el.id);
    return originalScrollIntoView.apply(this, args as never);
  };
  return () => {
    Element.prototype.scrollIntoView = originalScrollIntoView;
  };
}
