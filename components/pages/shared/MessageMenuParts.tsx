'use client';

import Icon from '@/components/ui/Icon';
import Avatar from '@/components/ui/Avatar';

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

export function ReactionBar({ top, left, isMe, onReact }: { top: number; left: number; isMe: boolean; onReact: (emoji: string) => void }) {
  return (
    <div style={{
      position: 'fixed', top, left, zIndex: 10000,
      display: 'flex', alignItems: 'center', gap: 2,
      background: 'var(--surface)', borderRadius: 28, padding: '6px 8px',
      boxShadow: '0 4px 16px rgba(0,0,0,.15)', border: '1px solid var(--border)',
    }}>
      {QUICK_REACTIONS.map((emoji, i) => {
        // Cascade dans le sens de lecture naturel côté message : de droite à gauche
        // pour ses propres messages (bulle alignée à droite), de gauche à droite
        // pour les messages reçus — l'animation "part" du côté proche de la bulle.
        const order = isMe ? (QUICK_REACTIONS.length - 1 - i) : i;
        return (
          <button key={emoji} onMouseDown={() => onReact(emoji)} className="tap-scale msg-reaction-emoji" style={{
            width: 32, height: 32, border: 'none', background: 'none', cursor: 'pointer',
            fontSize: 19, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%',
            animationDelay: `${order * 18}ms`,
          }}>{emoji}</button>
        );
      })}
    </div>
  );
}

// ─── Détail d'une réaction existante — WhatsApp affiche toujours qui a réagi
// (avatar + nom) au clic sur un badge, plutôt que de rouvrir la barre d'emojis.
// "Cliquez pour supprimer" et le retrait au clic n'apparaissent que si c'est SA
// PROPRE réaction (onRemove absent = simple aperçu en lecture seule sinon).
export function ReactionDetail({ top, left, avatarUrl, initials, name, emoji, onRemove }: {
  top: number; left: number; avatarUrl?: string | null; initials: string; name: string;
  emoji: string; onRemove?: () => void;
}) {
  return (
    <div
      onMouseDown={onRemove}
      className="msg-reaction-detail-pop"
      style={{
        position: 'fixed', top, left, zIndex: 10000,
        display: 'flex', alignItems: 'center', gap: 10,
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12,
        padding: '8px 14px', boxShadow: '0 4px 16px rgba(0,0,0,.15)',
        cursor: onRemove ? 'pointer' : 'default', minWidth: 200,
      }}
    >
      <Avatar initials={initials} avatarUrl={avatarUrl} size={32} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{name}</div>
        {onRemove && <div style={{ fontSize: 11, color: 'var(--muted)' }}>Cliquez pour supprimer</div>}
      </div>
      <div style={{ fontSize: 22, flexShrink: 0 }}>{emoji}</div>
    </div>
  );
}

export const MENU_ITEM_HEIGHT = 44;
export const REACTION_BAR_HEIGHT = 46;
export const REACTION_DETAIL_HEIGHT = 48;
export const REACTION_DETAIL_WIDTH = 220;
// 8 emojis (32px) + gaps (2px × 7) + padding (8px × 2)
export const REACTION_BAR_WIDTH = 8 * 32 + 7 * 2 + 8 * 2;
export const MENU_GAP = 8;
export const MENU_SCREEN_MARGIN = 16;
export const CTX_MENU_WIDTH = 180;
