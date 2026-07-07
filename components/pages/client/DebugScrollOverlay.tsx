'use client';

import { useEffect, useState, useRef } from 'react';

/**
 * Overlay de debug temporaire — affiche les logs [chat-scroll] directement à l'écran.
 * Nécessaire en PWA standalone sur mobile : pas d'inspecteur distant facile.
 * À retirer une fois le bug de scroll résolu.
 */
export default function DebugScrollOverlay() {
  const [lines, setLines] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const linesRef = useRef<string[]>([]);

  useEffect(() => {
    const original = console.log;
    console.log = (...args: unknown[]) => {
      original(...args);
      if (typeof args[0] === 'string' && args[0].startsWith('[chat-scroll]')) {
        const text = args.map(a => {
          try { return typeof a === 'string' ? a : JSON.stringify(a); } catch { return String(a); }
        }).join(' ');
        const stamped = `${new Date().toISOString().split('T')[1].slice(0, 12)} ${text}`;
        linesRef.current = [...linesRef.current.slice(-29), stamped];
        setLines([...linesRef.current]);
      }
    };
    return () => { console.log = original; };
  }, []);

  if (lines.length === 0) return null;

  return (
    <div style={{
      position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 99999,
      maxHeight: '40vh', overflowY: 'auto',
      background: 'rgba(0,0,0,0.92)', color: '#0f0',
      fontFamily: 'monospace', fontSize: 10, lineHeight: 1.4,
      padding: '8px 8px 20px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, position: 'sticky', top: 0 }}>
        <span style={{ color: '#fff', fontWeight: 700 }}>chat-scroll debug ({lines.length})</span>
        <button
          onClick={() => {
            navigator.clipboard.writeText(lines.join('\n'));
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          style={{ background: '#333', color: '#fff', border: 'none', borderRadius: 4, padding: '2px 8px', fontSize: 10 }}
        >
          {copied ? 'Copié !' : 'Copier'}
        </button>
      </div>
      {lines.map((l, i) => (
        <div key={i} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', borderTop: '1px solid #333', padding: '2px 0' }}>{l}</div>
      ))}
    </div>
  );
}
