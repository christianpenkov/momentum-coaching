'use client';

import { useState } from 'react';

/**
 * Rond « ? » en tete de colonne ou de carte KPI : explique une regle de comptage qui ne
 * se devine pas en lisant le chiffre.
 *
 * Survol ET clic, les deux : `title` ne s'affiche jamais sur un ecran tactile, et la
 * plateforme est d'abord consultee en PWA sur telephone. `stopPropagation` parce que
 * certains de ces en-tetes declenchent un tri au clic.
 *
 * Vivait dans PageClientStats. Sorti ici le 2026-09-12 pour que la fiche client puisse
 * porter les memes explications que « Mes stats » sans recopier ni le composant ni les
 * textes — ceux-ci sont dans lib/aidesStats.ts.
 */
export default function AideColonne({ texte }: { texte: string }) {
  const [ouvert, setOuvert] = useState(false);
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <button
        type="button"
        title={texte}
        aria-label={texte}
        aria-expanded={ouvert}
        onClick={(e) => { e.stopPropagation(); setOuvert(o => !o); }}
        onBlur={() => setOuvert(false)}
        style={{
          width: 13, height: 13, borderRadius: '50%', marginLeft: 4, padding: 0,
          border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)',
          fontSize: 9, fontWeight: 700, lineHeight: '11px', cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}
      >?</button>
      {ouvert && (
        <span
          role="tooltip"
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 30,
            width: 250, padding: '8px 10px', borderRadius: 8,
            border: '1px solid var(--border)', background: 'var(--surface)',
            boxShadow: '0 6px 20px rgba(0,0,0,.18)',
            fontSize: 11, fontWeight: 400, lineHeight: 1.45, color: 'var(--ink)',
            textAlign: 'left', whiteSpace: 'normal',
            maxHeight: '60vh', overflowY: 'auto',
          }}
        >
          {/* Un texte d'aide s'ecrit en paragraphes separes par une ligne vide. Sans ce
              decoupage, `whiteSpace: 'normal'` les collerait en un seul pave illisible —
              or c'est justement ce pave qui rendait l'aide du closing incomprehensible. */}
          {texte.split('\n\n').map((para, i) => (
            <span key={i} style={{ display: 'block', marginTop: i === 0 ? 0 : 8 }}>{para}</span>
          ))}
        </span>
      )}
    </span>
  );
}
