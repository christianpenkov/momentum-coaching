'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useEscapeKey } from '@/lib/useEscapeKey';

/**
 * Le menu « retirer un lead », partagé par toutes les surfaces du pipeline.
 *
 * ── POURQUOI IL EXISTE ───────────────────────────────────────────────────────
 *
 * Ces deux gestes — « Ce n'est pas un lead » et « Supprimer » — vivaient dans
 * `PipelineCard`, donc sur les seules cartes des colonnes d'étapes. Un lead
 * affiché dans le panneau d'une issue ou dans la vue liste n'avait AUCUN moyen
 * d'être retiré : le clic droit n'y déclenchait rien, et la ligne n'offrait
 * qu'« ouvrir la fiche ».
 *
 * ⚠️ Et le code faisait croire l'inverse. Les tuiles d'issues recevaient une
 * fonction `rendreCarte` qui, elle, construisait bien une `PipelineCard` avec son
 * menu — mais `ouverte={null}` était écrit en dur, donc elle n'était jamais
 * appelée. Du code mort qui ressemblait à la fonctionnalité manquante.
 *
 * ── POURQUOI UN SEUL MENU POUR L'ÉCRAN, ET NON UN PAR CARTE ──────────────────
 *
 * `PipelineCard` montait quatre `useState` et un écouteur clavier PAR CARTE. Une
 * étape peut contenir 412 fiches : c'étaient 412 écouteurs d'échappement montés
 * pour un menu dont une seule instance peut être ouverte à la fois.
 *
 * Ici, l'état vit une fois. La cible est portée par l'ouverture du menu, pas par
 * le composant qui l'ouvre — c'est ce qui permet à trois surfaces très
 * différentes (une carte, une ligne de panneau, une ligne de tableau) de
 * partager exactement le même geste et la même confirmation.
 *
 * ── CE QUI N'EST PAS ICI ─────────────────────────────────────────────────────
 *
 * Le mobile. Le clic droit n'existe pas au doigt ; l'équivalent serait un appui
 * long ou un bouton sur la ligne, c'est-à-dire un autre geste à concevoir, pas
 * ce correctif. Décision de Chris, 2026-09-07.
 */

/** Ce qu'il faut savoir d'un lead pour proposer de le retirer. */
export interface CibleRetrait {
  key: string;
  name: string;
  callId?: string | null;
  /** Un call venu d'un lien bio/description n'a pas de pseudo Instagram : pas de `@`. */
  isIgLink?: boolean;
}

export function useMenuRetirerLead({ platform, onDeleteLead, onNotALead }: {
  platform: 'ig' | 'yt' | 'other';
  onDeleteLead?: (key: string, callId?: string | null) => void;
  onNotALead?: (key: string, callId?: string | null) => void;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number; cible: CibleRetrait } | null>(null);
  const [suppr, setSuppr] = useState<CibleRetrait | null>(null);
  const [supprCoche, setSupprCoche] = useState(false);
  const [pasLead, setPasLead] = useState<CibleRetrait | null>(null);
  const [pasLeadCoche, setPasLeadCoche] = useState(false);

  // Trois couches peuvent être ouvertes en même temps (le menu, puis une
  // confirmation par-dessus). Échap ne ferme que celle du dessus, sinon on perd
  // tout le contexte d'un coup — d'où cet ordre de priorité, repris tel quel de
  // `PipelineCard`.
  useEscapeKey(() => {
    if (suppr)   { setSuppr(null); setSupprCoche(false); return; }
    if (pasLead) { setPasLead(null); setPasLeadCoche(false); return; }
    if (menu) setMenu(null);
  }, !!menu || !!suppr || !!pasLead);

  const nomAffiche = (c: CibleRetrait) =>
    platform === 'ig' && !c.isIgLink ? `@${c.name}` : c.name;

  /** À brancher sur `onContextMenu` de n'importe quelle surface. */
  const ouvrirMenu = (e: React.MouseEvent, cible: CibleRetrait) => {
    e.preventDefault();
    // `stopPropagation` : sans lui, une ligne de tableau imbriquée dans un
    // conteneur qui écoute aussi le clic droit ouvrirait deux menus.
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, cible });
  };

  const entree = (fond: string) => ({
    display: 'block' as const, width: '100%', textAlign: 'left' as const,
    padding: '8px 14px', fontSize: 12, fontWeight: 500,
    background: 'none', border: 'none', cursor: 'pointer', color: fond,
  });

  const menuRetrait = (
    <>
      {menu && createPortal(
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 9999 }} onMouseDown={() => setMenu(null)} />
          <div style={{
            position: 'fixed', left: menu.x, top: menu.y, zIndex: 10000,
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,.12)',
            padding: '4px 0', minWidth: 160,
          }}>
            <button
              onMouseDown={e => { e.stopPropagation(); setPasLead(menu.cible); setPasLeadCoche(false); setMenu(null); }}
              style={entree('var(--ink)')}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-2)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
            >
              Ce n&apos;est pas un lead
            </button>
            <button
              onMouseDown={e => { e.stopPropagation(); setSuppr(menu.cible); setSupprCoche(false); setMenu(null); }}
              style={entree('#dc2626')}
              onMouseEnter={e => { e.currentTarget.style.background = '#fef2f2'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
            >
              Supprimer {nomAffiche(menu.cible)}
            </button>
          </div>
        </>,
        document.body,
      )}

      {suppr && createPortal(
        <>
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 10001 }} onMouseDown={() => { setSuppr(null); setSupprCoche(false); }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            zIndex: 10002, background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 12, padding: '24px 28px', minWidth: 320, boxShadow: '0 8px 32px rgba(0,0,0,.18)',
          }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Supprimer {nomAffiche(suppr)} ?</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
              Cette action supprime définitivement le lead et son historique.
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--ink)', marginBottom: 20, cursor: 'pointer' }}>
              <input type="checkbox" checked={supprCoche} onChange={e => setSupprCoche(e.target.checked)} style={{ width: 14, height: 14, cursor: 'pointer' }} />
              Je comprends que cette action est irréversible
            </label>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onMouseDown={() => { setSuppr(null); setSupprCoche(false); }}
                style={{ padding: '7px 16px', fontSize: 12, fontWeight: 600, borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer' }}
              >
                Annuler
              </button>
              <button
                onMouseDown={() => { if (!supprCoche) return; const c = suppr; setSuppr(null); setSupprCoche(false); onDeleteLead?.(c.key, c.callId); }}
                style={{ padding: '7px 16px', fontSize: 12, fontWeight: 600, borderRadius: 7, border: 'none', background: '#dc2626', color: '#fff', cursor: supprCoche ? 'pointer' : 'not-allowed', opacity: supprCoche ? 1 : 0.4 }}
              >
                Supprimer
              </button>
            </div>
          </div>
        </>,
        document.body,
      )}

      {pasLead && createPortal(
        <>
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 10001 }} onMouseDown={() => { setPasLead(null); setPasLeadCoche(false); }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            zIndex: 10002, background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 12, padding: '24px 28px', minWidth: 320, maxWidth: 380, boxShadow: '0 8px 32px rgba(0,0,0,.18)',
          }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
              {/* `{' '}` explicite : sans lui le titre s'affiche « Test JSP 2n'est
                  pas un lead ? ». Defaut present dans la version d'origine et
                  reproduit ici avant d'etre vu au navigateur — un espace entre une
                  expression et du texte ne survit pas toujours a JSX. */}
              {nomAffiche(pasLead)}{' '}n&apos;est pas un lead ?
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16, lineHeight: 1.5 }}>
              Cette fiche ne sera plus comptée dans les stats et ne sera pas recréée si la
              personne vous réécrit en DM. Si elle clique un jour sur un lien tracké
              (commentaire avec mot-clé, lien bio), un nouveau lead sera créé normalement.
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--ink)', marginBottom: 20, cursor: 'pointer' }}>
              <input type="checkbox" checked={pasLeadCoche} onChange={e => setPasLeadCoche(e.target.checked)} style={{ width: 14, height: 14, cursor: 'pointer' }} />
              Je comprends que cette fiche ne sera plus jamais comptée, quoi qu&apos;elle fasse en DM
            </label>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onMouseDown={() => { setPasLead(null); setPasLeadCoche(false); }}
                style={{ padding: '7px 16px', fontSize: 12, fontWeight: 600, borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer' }}
              >
                Annuler
              </button>
              <button
                onMouseDown={() => { if (!pasLeadCoche) return; const c = pasLead; setPasLead(null); setPasLeadCoche(false); onNotALead?.(c.key, c.callId); }}
                style={{ padding: '7px 16px', fontSize: 12, fontWeight: 600, borderRadius: 7, border: 'none', background: '#2563EB', color: '#fff', cursor: pasLeadCoche ? 'pointer' : 'not-allowed', opacity: pasLeadCoche ? 1 : 0.4 }}
              >
                Confirmer
              </button>
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  );

  return { ouvrirMenu, menuRetrait };
}
