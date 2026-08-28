'use client';

import { useEffect, useState } from 'react';
import Icon from '@/components/ui/Icon';
import Portal from './Portal';
import { useIsMobile } from '@/lib/useIsMobile';

/**
 * La coquille commune à toutes les modales qui corrigent une vente.
 *
 * ── Pourquoi une coquille et pas six modales autonomes ─────────────────────
 * Ce sont des écrans de stress. Six variantes de la même boîte — un rayon
 * différent, un pied qui ne s'aligne pas, un bouton qui bouge de trois pixels —
 * donnent l'impression que la plateforme improvise, au moment précis où l'élève
 * a besoin d'être sûr de ce qu'il fait.
 *
 * Les valeurs reprennent DealPanel et CreateLinkModal au pixel près : ces boîtes
 * s'ouvrent depuis le même écran, un écart se verrait immédiatement.
 */

export default function ModaleAction({
  titre, sousTitre, children, pied, onClose, bloque, largeur = 560,
}: {
  titre: string;
  sousTitre?: string;
  children: React.ReactNode;
  /** Barre du bas. Absente = écran de résultat, qui porte son propre bouton. */
  pied?: React.ReactNode;
  onClose: () => void;
  /** Une écriture est en cours : fermer maintenant laisserait un travail à moitié fait. */
  bloque?: boolean;
  largeur?: number;
}) {
  const isMobile = useIsMobile();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !bloque) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, bloque]);

  return (
    <Portal>
      <div onClick={() => !bloque && onClose()}
        style={{ position: 'fixed', inset: 0, background: 'rgba(26,24,21,.42)', zIndex: 10008 }} />
      <div style={isMobile ? {
        position: 'fixed', left: 0, right: 0, bottom: 0, maxHeight: '90vh', zIndex: 10009,
        background: 'var(--surface)', boxShadow: 'var(--shadow-modal)',
        borderTopLeftRadius: 18, borderTopRightRadius: 18,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      } : {
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 10009,
        width: `min(${largeur}px, calc(100vw - 32px))`, maxHeight: 'calc(100vh - 64px)',
        background: 'var(--surface)', borderRadius: 'var(--r-modal)', boxShadow: 'var(--shadow-modal)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {isMobile && (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 10, flexShrink: 0 }}>
            <span style={{ width: 44, height: 4, borderRadius: 2, background: 'var(--border)' }} />
          </div>
        )}

        <div style={{
          padding: isMobile ? '14px 20px' : '18px 24px', borderBottom: '1px solid var(--border-soft)',
          display: 'flex', alignItems: 'flex-start', gap: 12, flexShrink: 0,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.1px', lineHeight: 1.35 }}>{titre}</div>
            {sousTitre && (
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3, lineHeight: 1.5 }}>{sousTitre}</div>
            )}
          </div>
          <button onClick={onClose} disabled={bloque} aria-label="Fermer"
            style={{ background: 'none', border: 'none', cursor: bloque ? 'default' : 'pointer', padding: 4, display: 'flex', flexShrink: 0, opacity: bloque ? .4 : 1 }}>
            <Icon name="x" size={18} color="var(--muted)" />
          </button>
        </div>

        <div style={{ padding: isMobile ? '16px 20px' : '18px 24px', overflowY: 'auto', flex: 1, minHeight: 0 }}>
          {children}
        </div>

        {pied && (
          <div style={{
            padding: isMobile ? '12px 20px' : '14px 24px', background: 'var(--surface-2)',
            borderTop: '1px solid var(--border)', display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0,
            flexWrap: 'wrap',
          }}>{pied}</div>
        )}
      </div>
    </Portal>
  );
}

/**
 * La case qui engage la responsabilité.
 *
 * Deux niveaux, et la distinction n'est pas décorative : l'orange couvre ce qui
 * se corrige (un montant, des modalités), le rouge ce qui ne revient pas (une
 * annulation, une déclaration d'argent que personne ne peut vérifier).
 *
 * Mettre du rouge partout supprimerait l'information : si tout est grave, plus
 * rien ne l'est, et la case devient une formalité qu'on coche sans lire — soit
 * exactement ce qu'elle est censée empêcher.
 */
export function CaseResponsabilite({ niveau, coche, onChange, texte }: {
  niveau: 'orange' | 'rouge';
  coche: boolean;
  onChange: (v: boolean) => void;
  texte?: string;
}) {
  const rouge = niveau === 'rouge';
  const teinte = rouge ? 'var(--red)' : 'var(--amber-ink)';

  return (
    <button onClick={() => onChange(!coche)} style={{
      display: 'flex', alignItems: 'flex-start', gap: 11, width: '100%', textAlign: 'left',
      background: coche ? (rouge ? 'var(--red-soft)' : 'var(--amber-soft)') : 'var(--surface-2)',
      border: `1px solid ${coche ? teinte : 'var(--border)'}`,
      borderRadius: 10, padding: '12px 14px', cursor: 'pointer', fontFamily: 'inherit',
    }}>
      <span style={{
        width: 17, height: 17, borderRadius: 5, flexShrink: 0, marginTop: 1,
        border: `1.5px solid ${coche ? teinte : 'var(--faint)'}`,
        background: coche ? teinte : 'transparent',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {coche && <Icon name="check" size={11} color="#fff" />}
      </span>
      <span style={{ fontSize: 12.5, lineHeight: 1.55, color: coche ? teinte : 'var(--ink-2)' }}>
        {texte ?? 'J’ai vérifié ce montant et mon client en est informé. Je reste responsable de ce qui sera facturé ou prélevé, et j’en assume les conséquences en cas d’erreur de ma part.'}
        {rouge && (
          <span style={{ display: 'block', marginTop: 5, fontWeight: 600 }}>
            Je comprends que cette action est définitive.
          </span>
        )}
      </span>
    </button>
  );
}

/** Un encart de conséquences — le bloc gris qui dit ce qui va se passer. */
export function Encart({ ton = 'neutre', titre, children }: {
  ton?: 'neutre' | 'attention' | 'bien' | 'grave';
  titre?: string;
  children: React.ReactNode;
}) {
  const c = ton === 'attention' ? { fond: 'var(--amber-soft)', bord: 'rgba(181,128,37,.28)', ink: 'var(--amber-ink)' }
    : ton === 'bien' ? { fond: 'var(--green-soft)', bord: 'rgba(63,138,82,.28)', ink: 'var(--green)' }
    : ton === 'grave' ? { fond: 'var(--red-soft)', bord: 'rgba(205,91,63,.28)', ink: 'var(--red)' }
    : { fond: 'var(--surface-2)', bord: 'var(--border)', ink: 'var(--ink-2)' };

  return (
    <div style={{
      background: c.fond, border: `1px solid ${c.bord}`, borderRadius: 10,
      padding: '12px 14px', fontSize: 12.5, lineHeight: 1.6, color: 'var(--ink-2)',
    }}>
      {titre && (
        <div style={{ fontSize: 12.5, fontWeight: 600, color: c.ink, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 7 }}>
          {ton === 'attention' && <Icon name="alert-triangle" size={13} color={c.ink} />}
          {ton === 'bien' && <Icon name="check" size={13} color={c.ink} />}
          {titre}
        </div>
      )}
      {children}
    </div>
  );
}

/** Une ligne « libellé …… valeur », l'unité de tous les récapitulatifs. */
export function Ligne({ label, valeur, barre, ton }: {
  label: string;
  valeur: string;
  /** Ancienne valeur, affichée barrée avant la nouvelle. */
  barre?: string;
  ton?: 'normal' | 'fort' | 'eteint';
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, padding: '4px 0', alignItems: 'baseline' }}>
      <span style={{ fontSize: 12.5, color: ton === 'eteint' ? 'var(--faint)' : 'var(--muted)', minWidth: 0 }}>{label}</span>
      <span style={{ display: 'flex', alignItems: 'baseline', gap: 7, flexShrink: 0 }}>
        {barre && (
          <span className="tabular" style={{ fontSize: 12, color: 'var(--faint)', textDecoration: 'line-through' }}>{barre}</span>
        )}
        <span className="tabular" style={{
          fontSize: ton === 'fort' ? 14 : 13,
          fontWeight: ton === 'fort' ? 700 : 500,
          color: ton === 'eteint' ? 'var(--faint)' : 'var(--ink)',
        }}>{valeur}</span>
      </span>
    </div>
  );
}

/**
 * Le pavé qui renvoie vers Stripe.
 *
 * Il nomme le bouton TEL QU'IL S'Y APPELLE, même quand le mot contredit notre
 * propre vocabulaire : « Annuler l'abonnement » chez Stripe alors qu'on ne dit
 * jamais « abonnement » ici. Chercher un bouton qui ne porte pas le nom annoncé
 * est ce qui fait renoncer — la cohérence de vocabulaire s'arrête à la frontière
 * de notre interface.
 */
export function VersStripe({ titre, etapes, url }: {
  titre: string;
  etapes: React.ReactNode[];
  url?: string | null;
}) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
      <div style={{
        padding: '10px 14px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)',
        fontSize: 12.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <Icon name="external" size={13} color="var(--accent-brand)" />
        {titre}
      </div>
      <ol style={{ margin: 0, padding: '12px 14px 12px 32px', fontSize: 12.5, lineHeight: 1.7, color: 'var(--ink-2)' }}>
        {etapes.map((e, i) => <li key={i} style={{ marginBottom: i === etapes.length - 1 ? 0 : 5 }}>{e}</li>)}
      </ol>
      {url && (
        <div style={{ padding: '0 14px 12px' }}>
          <a href={url} target="_blank" rel="noopener noreferrer" className="btn-primary-brand"
            style={{ fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 7, textDecoration: 'none' }}>
            <Icon name="external" size={13} /> Ouvrir dans Stripe
          </a>
        </div>
      )}
    </div>
  );
}

/** Bouton pilule — même dessin que celui de CreateLinkModal. */
export function Chip({ on, onClick, children, disabled }: {
  on: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      borderRadius: 999, padding: '6px 13px', fontSize: 12.5, fontFamily: 'inherit',
      cursor: disabled ? 'default' : 'pointer', opacity: disabled ? .45 : 1,
      border: `1px solid ${on ? 'var(--accent-brand)' : 'var(--border)'}`,
      background: on ? 'var(--accent-brand)' : 'var(--surface)',
      color: on ? '#fff' : 'var(--ink-2)', fontWeight: on ? 600 : 400, whiteSpace: 'nowrap',
    }}>{children}</button>
  );
}

/** Titre de section à l'intérieur d'une modale. */
export function Section({ children, marge = 18 }: { children: React.ReactNode; marge?: number }) {
  return <div className="mono" style={{ marginTop: marge, marginBottom: 9 }}>{children}</div>;
}

/**
 * Un lien prêt à envoyer, avec sa copie.
 *
 * Affiché après chaque correction qui régénère un lien : sans lui, l'élève sait
 * que l'ancien est mort mais pas où trouver le nouveau, et l'écran l'a laissé
 * en plan au milieu de la correction.
 */
export function LienACopier({ url, libelle }: { url: string; libelle: string }) {
  const [copie, setCopie] = useState(false);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px',
      border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)', marginTop: 8,
    }}>
      <Icon name="link" size={15} color="var(--accent-brand)" />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span className="mono" style={{ display: 'block' }}>{libelle}</span>
        <span style={{ display: 'block', fontSize: 12.5, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {url.replace(/^https?:\/\//, '')}
        </span>
      </span>
      <button className="btn-primary-brand" onClick={async () => {
        await navigator.clipboard.writeText(url);
        setCopie(true);
        setTimeout(() => setCopie(false), 2000);
      }} style={{ fontSize: 12, flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <Icon name={copie ? 'check' : 'copy'} size={13} /> {copie ? 'Copié' : 'Copier'}
      </button>
    </div>
  );
}

export const champStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 8,
  fontSize: 13, background: 'var(--surface)', color: 'var(--ink)', fontFamily: 'inherit', outline: 'none',
};
