'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Instrument de diagnostic du clavier mobile. NON monté par défaut : une ligne à
 * ajouter dans la feuille suspecte, puis à retirer.
 *
 *     {isMobile && <DebugClavier cible={feuilleRef} />}
 *
 * Gardé dans le dépôt à dessein. Six corrections déduites ont échoué sur le
 * clavier iOS de `ModaleAction` (2026-09-03 → 09-04) ; la septième, fondée sur ce
 * qu'il a relevé, a réglé la chose en un tour. Le rebâtir sous la pression, c'est
 * le rebâtir mal. Mode d'emploi et pièges : `docs/clavier-mobile-modales.md`.
 *
 * Il n'affiche pas l'état courant mais un JOURNAL des dernières mesures : le
 * symptôme est une transition (« ça flashe en plein écran et revient »), pas un
 * état. Un instrument qui n'afficherait que l'instant présent montrerait
 * seulement l'état final, c'est-à-dire tout sauf ce qu'on cherche. Une seule
 * capture d'écran suffit donc à voir toute la séquence.
 *
 * Échantillonné à chaque image (rAF) et non sur `resize`/`scroll` : si le défaut
 * venait d'un événement qui n'arrive pas, écouter les événements ne le verrait
 * jamais. On ne peut pas se servir du suspect comme témoin.
 */
export default function DebugClavier({ cible }: { cible: React.RefObject<HTMLDivElement | null> }) {
  const [lignes, setLignes] = useState<string[]>([]);
  const derniere = useRef('');
  const debut = useRef(Date.now());

  useEffect(() => {
    let vivant = true;

    function echantillon() {
      if (!vivant) return;
      const vv = window.visualViewport;
      const r = cible.current?.getBoundingClientRect();
      const ligne = [
        `iH${window.innerHeight}`,
        `vvH${vv ? Math.round(vv.height) : -1}`,
        `oT${vv ? Math.round(vv.offsetTop) : -1}`,
        `k${vv ? (window.innerHeight - vv.height > 100 ? Math.round(window.innerHeight - vv.height) : 0) : -1}`,
        `| top${r ? Math.round(r.top) : -1}`,
        `h${r ? Math.round(r.height) : -1}`,
        `| sc${Math.round(document.scrollingElement?.scrollTop ?? -1)}`,
        `w${window.innerWidth}`,
      ].join(' ');

      if (ligne !== derniere.current) {
        derniere.current = ligne;
        const t = Date.now() - debut.current;
        setLignes(prev => [...prev, `${String(t).padStart(5)} ${ligne}`].slice(-11));
      }
      requestAnimationFrame(echantillon);
    }

    requestAnimationFrame(echantillon);
    return () => { vivant = false; };
  }, [cible]);

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 99999,
      background: 'rgba(0,0,0,.88)', color: '#7CFC9B',
      font: '9px/1.35 ui-monospace, Menlo, monospace',
      padding: '3px 4px', pointerEvents: 'none', whiteSpace: 'pre',
      overflow: 'hidden',
    }}>
      {lignes.length === 0 ? 'mesure…' : lignes.join('\n')}
    </div>
  );
}
