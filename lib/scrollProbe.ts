'use client';

/**
 * Sonde de diagnostic pour le bug de scroll qui saute — capture ce qu'aucune
 * instrumentation scrollTop ne pouvait voir : les changements de scrollHeight
 * (grossissement du contenu par les polices/images) et les layout shifts natifs.
 * Buffer copiable via le bouton "Logs scroll" du header. À retirer une fois validé.
 */
const buffer: string[] = [];

function push(label: string, data?: unknown) {
  const t = performance.now().toFixed(0);
  buffer.push(`+${t}ms ${label}${data ? ' ' + JSON.stringify(data) : ''}`);
  if (buffer.length > 600) buffer.shift();
}

export function getScrollProbeLogs() {
  return buffer.join('\n');
}

export function clearScrollProbeLogs() {
  buffer.length = 0;
}

/**
 * Installe toutes les sondes sur la zone de scroll. Retourne une fonction de cleanup.
 * Log au montage : dimensions initiales. Puis en continu : tout changement de
 * scrollHeight/scrollTop, les events touch/wheel, les layout shifts, le chargement des
 * polices (document.fonts.ready), et l'état à chaque frame pendant 8 secondes.
 */
export function installScrollProbe(el: HTMLElement, tag: string): () => void {
  push(`${tag} PROBE INSTALLED`, {
    scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
    gap: el.scrollHeight - el.scrollTop - el.clientHeight,
  });

  const cleanups: Array<() => void> = [];

  // 1. Snapshot de l'état à chaque frame pendant 8s — voit TOUT changement de
  //    scrollHeight ou scrollTop, peu importe la cause (JS, natif, reflow police).
  let lastScrollHeight = el.scrollHeight;
  let lastScrollTop = el.scrollTop;
  let lastClientHeight = el.clientHeight;
  const startedAt = performance.now();
  let rafId: number | null = null;
  const frameTick = () => {
    if (performance.now() - startedAt > 8000) { rafId = null; return; }
    const sh = el.scrollHeight, st = el.scrollTop, ch = el.clientHeight;
    if (sh !== lastScrollHeight || Math.abs(st - lastScrollTop) > 1 || ch !== lastClientHeight) {
      push(`${tag} STATE CHANGED`, {
        scrollHeight: sh, deltaSH: sh - lastScrollHeight,
        scrollTop: st, deltaST: st - lastScrollTop,
        clientHeight: ch, deltaCH: ch - lastClientHeight,
        gap: sh - st - ch,
      });
      lastScrollHeight = sh; lastScrollTop = st; lastClientHeight = ch;
    }
    rafId = requestAnimationFrame(frameTick);
  };
  rafId = requestAnimationFrame(frameTick);
  cleanups.push(() => { if (rafId !== null) cancelAnimationFrame(rafId); });

  // 2. Events tactiles / molette bruts — pour corréler le tap avec le saut.
  const onTouchStart = (e: TouchEvent) => push(`${tag} touchstart`, { y: e.touches[0]?.clientY, scrollTop: el.scrollTop, scrollHeight: el.scrollHeight });
  const onTouchMove = (e: TouchEvent) => push(`${tag} touchmove`, { y: e.touches[0]?.clientY, scrollTop: el.scrollTop });
  const onMouseDown = (e: MouseEvent) => push(`${tag} mousedown`, { y: e.clientY, scrollTop: el.scrollTop, scrollHeight: el.scrollHeight });
  const onWheel = () => push(`${tag} wheel`, { scrollTop: el.scrollTop });
  const onScroll = () => push(`${tag} NATIVE scroll`, { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, gap: el.scrollHeight - el.scrollTop - el.clientHeight });
  el.addEventListener('touchstart', onTouchStart, { passive: true, capture: true });
  el.addEventListener('touchmove', onTouchMove, { passive: true, capture: true });
  el.addEventListener('mousedown', onMouseDown, { passive: true, capture: true });
  el.addEventListener('wheel', onWheel, { passive: true, capture: true });
  el.addEventListener('scroll', onScroll, { passive: true });
  cleanups.push(() => {
    el.removeEventListener('touchstart', onTouchStart, { capture: true } as EventListenerOptions);
    el.removeEventListener('touchmove', onTouchMove, { capture: true } as EventListenerOptions);
    el.removeEventListener('mousedown', onMouseDown, { capture: true } as EventListenerOptions);
    el.removeEventListener('wheel', onWheel, { capture: true } as EventListenerOptions);
    el.removeEventListener('scroll', onScroll);
  });

  // 3. Chargement des polices — confirme si le FOUT coïncide avec un changement de hauteur.
  if (typeof document !== 'undefined' && 'fonts' in document) {
    push(`${tag} fonts.status at install`, { status: (document as Document & { fonts: FontFaceSet }).fonts.status });
    (document as Document & { fonts: FontFaceSet }).fonts.ready.then(() => {
      push(`${tag} fonts.ready RESOLVED`, { scrollHeight: el.scrollHeight, scrollTop: el.scrollTop, gap: el.scrollHeight - el.scrollTop - el.clientHeight });
    });
    const onLoadingDone = () => push(`${tag} fonts loadingdone`, { scrollHeight: el.scrollHeight, scrollTop: el.scrollTop });
    (document as Document & { fonts: FontFaceSet }).fonts.addEventListener('loadingdone', onLoadingDone);
    cleanups.push(() => (document as Document & { fonts: FontFaceSet }).fonts.removeEventListener('loadingdone', onLoadingDone));
  }

  // 4. Layout shifts natifs (PerformanceObserver) — le navigateur signale les décalages
  //    de mise en page qu'aucune instrumentation JS ne peut voir autrement.
  if (typeof PerformanceObserver !== 'undefined') {
    try {
      const po = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          // @ts-expect-error layout-shift entry (value/hadRecentInput) hors des types standard
          push(`${tag} LAYOUT SHIFT`, { value: entry.value?.toFixed(4), hadRecentInput: entry.hadRecentInput });
        }
      });
      po.observe({ type: 'layout-shift', buffered: true });
      cleanups.push(() => po.disconnect());
    } catch { /* layout-shift non supporté (Safari) */ }
  }

  return () => cleanups.forEach(fn => fn());
}
