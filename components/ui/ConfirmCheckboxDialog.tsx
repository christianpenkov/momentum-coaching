'use client';

import { createPortal } from 'react-dom';

/**
 * Confirmation d'une action destructive, verrouillée par une case à cocher.
 *
 * Extrait de SessionRapportModal sans changement visuel : même overlay, mêmes
 * couleurs, même bouton grisé tant que la case n'est pas cochée. Réutilisé par les
 * deux modales de rapport pour « Recommencer », qui efface réellement des réponses.
 *
 * À NE PAS utiliser pour une simple fermeture : depuis que les brouillons existent,
 * fermer ne perd plus rien, et demander une confirmation pour rien use l'attention
 * qu'on veut garder pour les vraies destructions.
 */
export default function ConfirmCheckboxDialog({
  title,
  message,
  checkboxLabel,
  confirmLabel,
  cancelLabel = 'Annuler',
  checked,
  onCheckedChange,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  checkboxLabel: string;
  confirmLabel: string;
  cancelLabel?: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return createPortal(
    <div
      onClick={e => e.stopPropagation()}
      style={{
        position: 'fixed', inset: 0, zIndex: 5001,
        background: 'rgba(0,0,0,0.45)',
        backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div style={{ textAlign: 'center', maxWidth: 320, background: 'var(--surface)', borderRadius: 16, padding: '24px 22px', boxShadow: '0 12px 32px rgba(0,0,0,0.25)' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)', marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>{message}</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--ink-2)', marginBottom: 20, cursor: 'pointer', justifyContent: 'center' }}>
          <input
            type="checkbox"
            checked={checked}
            onChange={e => onCheckedChange(e.target.checked)}
            style={{ width: 16, height: 16, cursor: 'pointer' }}
          />
          {checkboxLabel}
        </label>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button type="button" className="btn-ghost" onClick={onCancel}>{cancelLabel}</button>
          <button
            type="button"
            className="btn-primary-brand"
            style={{
              background: checked ? 'var(--red)' : 'var(--border)',
              borderColor: checked ? 'var(--red)' : 'var(--border)',
              cursor: checked ? 'pointer' : 'not-allowed',
              opacity: checked ? 1 : 0.6,
            }}
            disabled={!checked}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
