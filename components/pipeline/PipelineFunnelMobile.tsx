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
 * ── DEUX AXES, COMME LE DESKTOP ───────────────────────────────────────────────
 *
 * L'entonnoir montre la PROGRESSION (les étapes). Les issues sont en dessous,
 * dans une grille : ce ne sont pas des étapes plus avancées, ce sont des
 * résultats. Les empiler dans le même entonnoir donnait « 3 show up » au-dessus
 * de « 4 closés », ce qui n'a aucun sens dans un tunnel.
 *
 * Avant la refonte du 2026-08-27, ce fichier construisait sa propre liste de
 * no-shows en filtrant sur un badge. Ce badge n'existe plus — no-show est une
 * issue à part entière — et la section était devenue vide.
 */

export interface FunnelCard {
  key: string;
  name: string;
  sub: string;
  date: string;
  /** La case où la carte se range : l'issue si le lead est classé, l'étape sinon. */
  stageKey: string;
  stageIdx: number;
  /** L'étape réellement atteinte, conservée même quand le lead est classé. */
  stage?: string;
  issue?: string | null;
  badge?: 'no_show' | 'rescheduled' | 'not_qualified' | 'to_recontact' | null;
  rapportEnRetard?: boolean;
  avatarUrl?: string | null;
}

export interface FunnelStage {
  readonly key: string;
  readonly label: string;
  readonly color: string;
  readonly lightBg: string;
}

// Libelles raccourcis pour l'affichage mobile. Les intitules complets
// ("Lead Commentaire / LM recu", "Lien Calendly clique") ne tiennent pas sur une
// ligne a 375px et forcaient soit la troncature a mi-mot, soit un passage a deux
// lignes qui rallongeait tout l'entonnoir. Le sens est conserve, le desktop
// garde les intitules longs.
// `lm_sent` portait « LM reçu », ce qui est devenu faux avec la refonte : cette
// étape veut dire « il a commenté », et « reçu » est l'étape SUIVANTE, celle du
// clic sur le bouton du DM1. Garder l'ancien libellé aurait fait lire deux fois
// « reçu » dans l'entonnoir, sur deux étapes différentes.
const SHORT_LABELS: Record<string, string> = {
  lm_sent: 'Commentaire',
  lm_received: 'LM reçu',
  calendly_sent: 'Calendly',
};
function shortLabel(key: string, label: string): string {
  return SHORT_LABELS[key] ?? label;
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
        padding: '12px 13px', minHeight: 56, marginBottom: 8, textAlign: 'left',
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--r-xl)', boxShadow: 'var(--shadow-card)',
        cursor: 'pointer', font: 'inherit', color: 'inherit',
      }}
    >
      {card.avatarUrl ? (
        <img loading="lazy" decoding="async" src={card.avatarUrl} alt="" style={{ width: 32, height: 32, borderRadius: 9, objectFit: 'cover', flexShrink: 0 }} />
      ) : (
        <span style={{
          width: 32, height: 32, borderRadius: 9, flexShrink: 0,
          // `card.name` et non `card.key` : le desktop dérive la couleur du nom.
          // Avec la clé, un lead venu d'un lien (dont la clé est un identifiant
          // technique) changeait de couleur entre le mobile et l'ordinateur —
          // la même personne, deux pastilles différentes.
          background: colorFor(card.name), color: '#fff',
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
      {/* Les badges existaient dans le type sans être affichés nulle part : sur
          mobile, rien ne distinguait un rendez-vous reporté d'un rendez-vous
          normal, ni un rapport en retard. */}
      {(card.rapportEnRetard || card.badge === 'rescheduled') && (
        <span style={{
          fontSize: 9.5, fontWeight: 700, borderRadius: 5, padding: '2px 6px',
          flexShrink: 0, whiteSpace: 'nowrap',
          background: card.rapportEnRetard ? 'var(--red-soft)' : '#fffbeb',
          color: card.rapportEnRetard ? '#cd5b3f' : '#b58025',
          border: `1px solid ${card.rapportEnRetard ? '#e2b3a5' : '#f0dcb0'}`,
        }}>
          {card.rapportEnRetard ? 'À remplir' : 'Reporté'}
        </span>
      )}
      <span style={{ fontSize: 11, color: 'var(--faint)', flexShrink: 0 }}>{card.date}</span>
    </button>
  );
}

export default function PipelineFunnelMobile({
  cards, stages, issues = [], onCardClick,
}: {
  cards: FunnelCard[];
  stages: readonly FunnelStage[];
  /** Les issues. Vide = comportement d'avant la refonte, entonnoir seul. */
  issues?: readonly FunnelStage[];
  onCardClick?: (key: string) => void;
}) {
  const [openStage, setOpenStage] = useState<string | null>(null);

  // L'entonnoir ne montre que la progression. Un lead classé n'y figure plus :
  // il est descendu dans les issues, où il attend une décision et non une étape
  // de plus.
  const issueKeys = new Set(issues.map(i => i.key));
  const inFunnel = cards.filter(c => !issueKeys.has(c.stageKey));

  const byStage = stages.map(s => ({
    stage: s,
    list: inFunnel.filter(c => c.stageKey === s.key),
  }));
  const max = Math.max(1, ...byStage.map(b => b.list.length));

  const byIssue = issues.map(i => ({
    stage: i,
    list: cards.filter(c => c.stageKey === i.key),
  }));

  const selected = openStage
    ? [...byStage, ...byIssue].find(b => b.stage.key === openStage)
    : null;

  // ── Niveau 2 : les leads d'une étape ou d'une issue ──
  if (selected) {
    const label = selected.stage.label;
    const color = selected.stage.color;
    const bg = selected.stage.lightBg;
    const list = selected.list;

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
  const StageRow = ({ b }: { b: { stage: FunnelStage; list: FunnelCard[] } }) => (
    <button
      type="button"
      onClick={() => setOpenStage(b.stage.key)}
      className="funnel-row"
      style={{
        display: 'flex', alignItems: 'center', gap: 11, width: '100%',
        // Hauteur et padding vivent dans .funnel-row (globals.css) : sur les
        // ecrans courts une media query les compacte, ce qu'un style inline
        // ne permettrait pas.
        borderRadius: 'var(--r-lg)',
        background: 'var(--surface)', border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-card)', cursor: 'pointer',
        font: 'inherit', color: 'inherit', textAlign: 'left',
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: b.stage.color, flexShrink: 0 }} />
      {/* Tout sur une ligne : libellé court, barre, compteur. Empiler la barre
          sous le texte rallongeait chaque ligne et forçait à faire défiler pour
          voir la fin du tunnel. */}
      <span style={{ fontSize: 14.5, fontWeight: 500, flexShrink: 0, whiteSpace: 'nowrap' }}>
        {shortLabel(b.stage.key, b.stage.label)}
      </span>
      <span style={{ flex: 1, minWidth: 20, height: 9, borderRadius: 20, background: 'var(--surface-2)', overflow: 'hidden' }}>
        <span style={{ display: 'block', height: '100%', borderRadius: 20, background: b.stage.color, width: `${(b.list.length / max) * 100}%` }} />
      </span>
      <span style={{ fontSize: 16, fontWeight: 700, fontVariantNumeric: 'tabular-nums', flexShrink: 0, minWidth: 18, textAlign: 'right' }}>
        {b.list.length}
      </span>
      <Icon name="chevR" size={14} color="var(--faint)" />
    </button>
  );

  // Les deux issues du call, cote a cote. MEME format que les lignes d'etape
  // (hauteur, pastille, libelle, compteur) : des cartes plus hautes poussaient
  // "Close" hors ecran et cassaient le rythme vertical de l'entonnoir.
  const OutcomeRow = ({
    label, count, color, bg, onOpen,
  }: { label: string; count: number; color: string; bg: string; onOpen?: () => void }) => (
    <button
      type="button"
      onClick={onOpen}
      disabled={!onOpen || count === 0}
      className="funnel-row"
      style={{
        flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 9,
        borderRadius: 'var(--r-lg)',
        background: count > 0 ? bg : 'var(--surface)',
        border: `1px solid ${count > 0 ? color + '4d' : 'var(--border)'}`,
        boxShadow: 'var(--shadow-card)',
        cursor: count > 0 && onOpen ? 'pointer' : 'default',
        font: 'inherit', textAlign: 'left',
        color: count > 0 ? color : 'var(--muted)',
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: count > 0 ? color : 'var(--border)', flexShrink: 0 }} />
      <span style={{ fontSize: 14.5, fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ fontSize: 16, fontWeight: 700, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{count}</span>
    </button>
  );

  return (
    <div className="funnel-list" style={{ display: 'flex', flexDirection: 'column' }}>
      {byStage.map(b => <StageRow key={b.stage.key} b={b} />)}

      {/* Les issues sous l'entonnoir, en grille de deux. Elles n'ont ni barre de
          progression ni ordre entre elles : aucune n'est « après » une autre, et
          leur donner une barre proportionnelle laisserait croire le contraire.
          Une issue vide garde sa place — elle se remplira, et la voir bouger
          d'un jour à l'autre ferait perdre le repère. */}
      {byIssue.length > 0 && (
        <>
          <div style={{
            fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em',
            textTransform: 'uppercase', color: 'var(--muted)',
            marginTop: 14, marginBottom: 7,
          }}>
            Issues
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
            {byIssue.map(b => (
              <OutcomeRow
                key={b.stage.key}
                label={b.stage.label}
                count={b.list.length}
                color={b.stage.color}
                bg={b.stage.lightBg}
                onOpen={() => setOpenStage(b.stage.key)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
