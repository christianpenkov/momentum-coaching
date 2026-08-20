'use client';

import { useState } from 'react';
import Icon from '@/components/ui/Icon';

/**
 * Vue mobile du pipeline : entonnoir, puis leads de l'étape, puis fiche.
 *
 * Le kanban desktop n'est pas utilisable au doigt — le glisser-déposer HTML5
 * ne se déclenche pas au tactile, et 8 colonnes de 838px demandent de défiler
 * latéralement pour lire quoi que ce soit. Cette vue est en CONSULTATION seule :
 * on regarde où en sont les leads, on ne les déplace pas.
 *
 * Elle ne remplace pas le kanban, elle s'y substitue sous 767px (voir la
 * bascule .pipeline-desktop / .pipeline-mobile dans globals.css). Le desktop
 * reste strictement inchangé.
 *
 * Les no-shows sont sortis de l'entonnoir et regroupés à part : dans le
 * pipeline actuel, un no-show renvoie le lead à sa meilleure étape connue
 * (getBestKnownStage) avec un badge rouge, donc il se fond dans une étape
 * antérieure et devient invisible. Ici il a sa propre section, parce que c'est
 * une liste sur laquelle on agit — relancer — pas une étape de progression.
 */

export interface FunnelCard {
  key: string;
  name: string;
  sub: string;
  date: string;
  stageKey: string;
  stageIdx: number;
  badge?: 'no_show' | 'rescheduled' | 'not_qualified' | 'to_recontact' | null;
  avatarUrl?: string | null;
}

export interface FunnelStage {
  readonly key: string;
  readonly label: string;
  readonly color: string;
  readonly lightBg: string;
}

// Couleur d'avatar stable par personne, dérivée de sa clé — même principe que
// components/ui/Avatar : la même personne garde sa couleur d'un écran à l'autre.
const AVATAR_COLORS = ['#7C3AED', '#2563EB', '#059669', '#D97706', '#EA580C', '#DB2777', '#0891B2', '#65A30D'];
function colorFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) & 0xffffffff;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}
function initialsOf(name: string): string {
  const clean = name.replace(/^@/, '');
  return clean.split(/[\s._-]/).map(w => w[0] || '').join('').toUpperCase().slice(0, 2) || '?';
}

function LeadRow({ card, onClick }: { card: FunnelCard; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%',
        padding: '11px 12px', marginBottom: 8, textAlign: 'left',
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--r-xl)', boxShadow: 'var(--shadow-card)',
        cursor: 'pointer', font: 'inherit', color: 'inherit',
      }}
    >
      {card.avatarUrl ? (
        <img src={card.avatarUrl} alt="" style={{ width: 32, height: 32, borderRadius: 9, objectFit: 'cover', flexShrink: 0 }} />
      ) : (
        <span style={{
          width: 32, height: 32, borderRadius: 9, flexShrink: 0,
          background: colorFor(card.key), color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, fontWeight: 700,
        }}>{initialsOf(card.name)}</span>
      )}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {card.name}
        </span>
        <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {card.sub}
        </span>
      </span>
      <span style={{ fontSize: 11, color: 'var(--faint)', flexShrink: 0 }}>{card.date}</span>
    </button>
  );
}

export default function PipelineFunnelMobile({
  cards, stages, onCardClick,
}: {
  cards: FunnelCard[];
  stages: readonly FunnelStage[];
  onCardClick?: (key: string) => void;
}) {
  const [openStage, setOpenStage] = useState<string | null>(null);

  // Les no-shows sortent de l'entonnoir : ils ne représentent pas une étape
  // franchie mais une action en attente. Les laisser dans leur étape d'origine
  // les rendrait indistinguables des leads qui progressent normalement.
  const noShows = cards.filter(c => c.badge === 'no_show');
  const inFunnel = cards.filter(c => c.badge !== 'no_show');

  const byStage = stages.map(s => ({
    stage: s,
    list: inFunnel.filter(c => c.stageKey === s.key),
  }));
  const max = Math.max(1, ...byStage.map(b => b.list.length));

  const selected = openStage ? byStage.find(b => b.stage.key === openStage) : null;
  const showingNoShows = openStage === '__noshow';

  // ── Niveau 2 : leads d'une étape (ou les no-shows) ──
  if (selected || showingNoShows) {
    const label = showingNoShows ? 'No-show' : selected!.stage.label;
    const color = showingNoShows ? 'var(--red)' : selected!.stage.color;
    const bg = showingNoShows ? 'var(--red-soft)' : selected!.stage.lightBg;
    const list = showingNoShows ? noShows : selected!.list;

    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <button
            type="button"
            onClick={() => setOpenStage(null)}
            aria-label="Retour à l'entonnoir"
            className="icon-btn"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink)', flexShrink: 0 }}
          >
            {/* Pas d'icone "retour" dans le jeu d'icones : on retourne le
                chevron droit plutot que d'en ajouter une. */}
            <Icon name="chevR" size={18} style={{ transform: 'rotate(180deg)' }} />
          </button>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontSize: 12, fontWeight: 600, padding: '4px 11px',
            borderRadius: 20, background: bg, color,
          }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />
            {label}
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--muted)' }}>
            {list.length} lead{list.length > 1 ? 's' : ''}
          </span>
        </div>

        {list.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '44px 16px', color: 'var(--muted)', fontSize: 12.5 }}>
            Aucun lead à cette étape.
          </div>
        ) : (
          list.map(c => <LeadRow key={c.key} card={c} onClick={() => onCardClick?.(c.key)} />)
        )}
      </div>
    );
  }

  // ── Niveau 1 : entonnoir ──
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {byStage.map(({ stage, list }) => (
        <button
          key={stage.key}
          type="button"
          onClick={() => setOpenStage(stage.key)}
          style={{
            display: 'flex', alignItems: 'center', gap: 10, width: '100%',
            padding: '10px 12px', borderRadius: 'var(--r-lg)',
            background: 'var(--surface)', border: '1px solid var(--border)',
            boxShadow: 'var(--shadow-card)', cursor: 'pointer',
            font: 'inherit', color: 'inherit', textAlign: 'left',
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: stage.color, flexShrink: 0 }} />
          <span style={{ fontSize: 12.5, flexShrink: 0, width: 104, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {stage.label}
          </span>
          {/* Barre proportionnelle au plus gros volume : c'est le rapport entre
              étapes qui informe, pas la valeur absolue. */}
          <span style={{ flex: 1, height: 8, borderRadius: 20, background: 'var(--surface-2)', overflow: 'hidden' }}>
            <span style={{ display: 'block', height: '100%', borderRadius: 20, background: stage.color, width: `${(list.length / max) * 100}%` }} />
          </span>
          <span style={{ fontSize: 13, fontWeight: 700, width: 24, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
            {list.length}
          </span>
          <Icon name="chevR" size={13} color="var(--faint)" />
        </button>
      ))}

      {noShows.length > 0 && (
        <button
          type="button"
          onClick={() => setOpenStage('__noshow')}
          style={{
            display: 'flex', alignItems: 'center', gap: 10, width: '100%',
            marginTop: 8, padding: '10px 12px', borderRadius: 'var(--r-lg)',
            background: 'var(--red-soft)', border: '1px solid rgba(205,91,63,0.3)',
            cursor: 'pointer', font: 'inherit', color: 'var(--red)', textAlign: 'left',
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--red)', flexShrink: 0 }} />
          <span style={{ fontSize: 12.5, fontWeight: 600, flex: 1 }}>No-show — à relancer</span>
          <span style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{noShows.length}</span>
          <Icon name="chevR" size={13} color="var(--red)" />
        </button>
      )}
    </div>
  );
}
