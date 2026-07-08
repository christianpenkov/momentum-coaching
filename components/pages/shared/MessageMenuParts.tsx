'use client';

import Icon from '@/components/ui/Icon';

// ─── Règles du menu contextuel — source unique de vérité ──────────────────────
// Réutilisée à la fois pour précalculer le nombre d'items (position du menu,
// lift du message) et pour le rendu réel — évite toute désynchronisation entre
// les deux (cf. docs/architecture-messagerie.md).
export function buildMenuItems(isMe: boolean, isTextMessage: boolean, canEdit: boolean, canDelete: boolean): Array<{ key: string }> {
  const items: Array<{ key: string }> = [];
  if (!isMe) {
    items.push({ key: 'reply' });
    if (isTextMessage) items.push({ key: 'copy' });
  } else {
    if (canEdit) items.push({ key: 'edit' });
    if (canDelete) items.push({ key: 'delete' });
    if (isTextMessage) items.push({ key: 'copy' });
  }
  return items;
}

export function MenuItem({ icon, label, danger, onClick }: {
  icon: React.ReactNode; label: string; danger?: boolean; onClick: () => void;
}) {
  return (
    <button className="msg-ctx-btn" onMouseDown={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
      padding: '11px 16px', border: 'none', background: 'none', cursor: 'pointer',
      color: danger ? 'var(--red)' : 'var(--ink)', fontSize: 14,
    }}>
      <span style={{ display: 'flex', flexShrink: 0, width: 18 }}>{icon}</span>
      {label}
    </button>
  );
}

// Mappe une clé d'item (buildMenuItems) vers son rendu réel — un seul endroit
// pour ajouter/retirer une action du menu.
export function renderMenuItem(key: string, handlers: { onReply: () => void; onCopy: () => void; onEdit: () => void; onDelete: () => void }) {
  switch (key) {
    case 'reply': return <MenuItem key={key} icon={<Icon name="reply" size={16} />} label="Répondre" onClick={handlers.onReply} />;
    case 'copy': return <MenuItem key={key} icon={<Icon name="copy" size={16} />} label="Copier" onClick={handlers.onCopy} />;
    case 'edit': return <MenuItem key={key} icon={<Icon name="edit" size={16} />} label="Modifier" onClick={handlers.onEdit} />;
    case 'delete': return <MenuItem key={key} icon={<Icon name="trash" size={16} />} label="Supprimer" danger onClick={handlers.onDelete} />;
    default: return null;
  }
}

// ─── Barre de réactions rapides ────────────────────────────────────────────────
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '💪'];

export function ReactionBar({ top, left, onReact }: { top: number; left: number; onReact: (emoji: string) => void }) {
  return (
    <div style={{
      position: 'fixed', top, left, zIndex: 10000,
      display: 'flex', alignItems: 'center', gap: 2,
      background: 'var(--surface)', borderRadius: 28, padding: '6px 8px',
      boxShadow: '0 4px 16px rgba(0,0,0,.15)', border: '1px solid var(--border)',
    }}>
      {QUICK_REACTIONS.map(emoji => (
        <button key={emoji} onMouseDown={() => onReact(emoji)} className="tap-scale" style={{
          width: 32, height: 32, border: 'none', background: 'none', cursor: 'pointer',
          fontSize: 19, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%',
        }}>{emoji}</button>
      ))}
      <div style={{
        width: 28, height: 28, borderRadius: '50%', background: 'var(--surface-2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 15, color: 'var(--muted)', flexShrink: 0, marginLeft: 2, cursor: 'default',
      }}>+</div>
    </div>
  );
}

export const MENU_ITEM_HEIGHT = 44;
export const REACTION_BAR_HEIGHT = 46;
// 8 emojis (32px) + bouton "+" (28px) + gaps (2px × 8) + marginLeft (2px) + padding (8px × 2)
export const REACTION_BAR_WIDTH = 8 * 32 + 28 + 8 * 2 + 2 + 8 * 2;
export const MENU_GAP = 8;
export const MENU_SCREEN_MARGIN = 16;
export const CTX_MENU_WIDTH = 180;
