'use client';

import { useState } from 'react';
import { useViewerTimeZone } from '@/lib/UserContext';
import { formatDateIn, formatTimeIn } from '@/lib/timezone';

/**
 * Carrousel « N rapports en attente », partagé par les trois écrans qui l'affichent :
 * accueil coach (PageToday), accueil élève (PageClientView) et page Calls élève
 * (PageClientCalls). Les trois en avaient chacun leur copie — mêmes styles inline
 * recopiés à l'identique, flèches comprises — ce qui obligeait à porter la moindre
 * évolution trois fois.
 *
 * Les écarts qui EXISTAIENT entre les trois copies sont conservés, en props :
 *  - `arrowSize` : 44 px sur la page Calls élève (cible tactile mobile), 32 px ailleurs.
 *  - `marginBottom` : 24 px sur la page Calls élève, 20 px sur les deux accueils.
 *  - `badge` : seul l'accueil coach l'affiche — c'est le seul écran où coaching et
 *    vente se mélangent. Chez l'élève il n'y a que de la vente, un badge y serait
 *    toujours le même mot.
 *  - `subtitle` : seul l'accueil coach montre le sujet du call sous le nom.
 *
 * Ce composant ne connaît ni AppNotif ni Call : les appelants lui passent des
 * `PendingRapportItem` déjà normalisés. C'est ce qui permet à la page Calls élève
 * (qui travaille sur des `Call` bruts) et aux deux accueils (qui travaillent sur
 * des notifications) d'utiliser le même carrousel sans conversion tordue.
 */

export interface PendingRapportItem {
  /** Clé de rendu et identité de l'élément — l'id du call suffit partout. */
  id: string;
  /** Ligne principale : « Session avec Marie », « Appel avec Julien »… */
  title: string;
  /** Ligne grise sous le titre. Aujourd'hui : le sujet du call, côté coach seulement. */
  subtitle?: string | null;
  scheduledAt?: string | null;
  duration?: string | null;
  /** Absent chez l'élève, qui n'a que des rapports de vente. */
  badge?: { label: string; tone: 'coaching' | 'sales' } | null;
}

interface Props {
  items: PendingRapportItem[];
  onOpen: (item: PendingRapportItem, index: number) => void;
  arrowSize?: number;
  marginBottom?: number;
}

export default function PendingRapportCard({ items, onOpen, arrowSize = 32, marginBottom = 20 }: Props) {
  const [idx, setIdx] = useState(0);
  const viewerTz = useViewerTimeZone();

  if (items.length === 0) return null;

  // `idx` peut dépasser après qu'un rapport a été rempli (la liste raccourcit sans
  // que l'index bouge). On borne au rendu plutôt que de synchroniser dans un effet :
  // pas de rendu intermédiaire sur une carte vide.
  const safeIdx = Math.min(idx, items.length - 1);
  const item = items[safeIdx];
  const atStart = safeIdx === 0;
  const atEnd = safeIdx === items.length - 1;
  const single = items.length <= 1;

  const arrowStyle = (disabled: boolean) => ({
    flexShrink: 0,
    background: 'var(--surface-2)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    width: arrowSize,
    height: arrowSize,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 18,
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled || single ? 0.2 : 1,
  });

  return (
    <div style={{ marginBottom }}>
      <div className="eyebrow-lg" style={{ color: 'var(--accent-brand)', marginBottom: 10 }}>
        {items.length} rapport{items.length > 1 ? 's' : ''} en attente
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          onClick={() => setIdx(i => Math.max(0, i - 1))}
          disabled={atStart || single}
          style={arrowStyle(atStart)}
          aria-label="Rapport précédent"
        >‹</button>

        <div className="card" style={{ flex: 1, borderLeft: '3px solid var(--accent-brand)', padding: '18px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent-brand)' }}>
                  RAPPORT DE CALL
                  {items.length > 1 && (
                    <span style={{ fontWeight: 400, color: 'var(--muted)', marginLeft: 8 }}>
                      {safeIdx + 1} / {items.length}
                    </span>
                  )}
                </span>
                {item.badge && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, flexShrink: 0,
                    background: item.badge.tone === 'coaching' ? 'var(--surface-2)' : 'var(--accent-brand-soft)',
                    color: item.badge.tone === 'coaching' ? 'var(--accent)' : 'var(--accent-brand)',
                  }}>
                    {item.badge.label}
                  </span>
                )}
              </div>

              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)' }}>{item.title}</div>

              {item.subtitle && (
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 1 }}>{item.subtitle}</div>
              )}

              {item.scheduledAt && (
                // Formaté dans le fuseau du lecteur. L'accueil coach utilisait
                // `toLocaleDateString` sans fuseau, donc l'heure de l'appareil : un
                // coach hors de France y voyait une heure fausse, alors que les deux
                // écrans élève étaient déjà corrects. L'extraction aligne les trois.
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
                  {formatDateIn(new Date(item.scheduledAt), viewerTz)}
                  {' · '}
                  {formatTimeIn(new Date(item.scheduledAt), viewerTz)}
                  {item.duration && <span style={{ marginLeft: 8 }}>· {item.duration}</span>}
                </div>
              )}
            </div>

            <button
              className="btn-primary-brand"
              type="button"
              style={{ fontSize: 13, background: 'var(--accent-brand)', flexShrink: 0 }}
              onClick={() => onOpen(item, safeIdx)}
            >
              Remplir le rapport
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIdx(i => Math.min(items.length - 1, i + 1))}
          disabled={atEnd || single}
          style={arrowStyle(atEnd)}
          aria-label="Rapport suivant"
        >›</button>
      </div>
    </div>
  );
}
