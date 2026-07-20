'use client';

import { useState } from 'react';
import Icon from './Icon';

interface Props {
  items: string[];
  onChange: (items: string[]) => void;
}

// Éditeur de la liste de documents attendus sur une tâche (coach uniquement).
// Chaque ligne devient un item distinct côté élève, avec sa propre zone de dépôt.
export default function AttachmentItemsEditor({ items, onChange }: Props) {
  const [draft, setDraft] = useState('');

  function addItem() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onChange([...items, trimmed]);
    setDraft('');
  }

  function removeItem(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }

  function moveItem(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  return (
    <div>
      {items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
          {items.map((item, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', background: 'var(--surface-2)', borderRadius: 8, border: '1px solid var(--border)' }}>
              <span style={{ flex: 1, fontSize: 13, color: 'var(--accent)' }}>{item}</span>
              <button type="button" onClick={() => moveItem(i, -1)} disabled={i === 0} className="icon-btn" style={{ opacity: i === 0 ? 0.3 : 1 }}>
                <Icon name="chevron-up" size={12} />
              </button>
              <button type="button" onClick={() => moveItem(i, 1)} disabled={i === items.length - 1} className="icon-btn" style={{ opacity: i === items.length - 1 ? 0.3 : 1 }}>
                <Icon name="chevron-down" size={12} />
              </button>
              <button type="button" onClick={() => removeItem(i)} className="icon-btn">
                <Icon name="trash" size={12} style={{ color: 'var(--red)' }} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } }}
          placeholder="Ex: 2 scripts de vente"
          style={{
            flex: 1, padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8,
            fontSize: 13, background: 'var(--surface-2)', color: 'var(--accent)',
            outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
          }}
        />
        <button type="button" onClick={addItem} className="btn-ghost" style={{ fontSize: 12, flexShrink: 0 }}>
          <Icon name="plus" size={12} /> Ajouter
        </button>
      </div>
    </div>
  );
}
