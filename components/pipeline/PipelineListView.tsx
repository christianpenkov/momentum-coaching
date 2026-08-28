'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import Image from 'next/image';
import Icon from '@/components/ui/Icon';
import IconeIssue from './IconeIssue';

// ── La vue liste ──────────────────────────────────────────────────────────────
//
// Le kanban répond à « où en est chaque lead ». La liste répond à « lequel dois-je
// traiter maintenant, et qui est en train de dormir ». C'est la demande d'origine :
// que la liste des rendez-vous ne devienne pas ingérable en grandissant.
//
// Trois choix de structure, tous issus d'un vrai problème :
//
//   1. UNE SECTION PAR COLONNE, repliable. Un lead magnet à 412 réclamés ferait
//      412 lignes dans une seule section. Une section repliée ne construit AUCUNE
//      ligne — c'est ce qui tient la page, pas seulement ce qui la range. Les
//      sections au-delà de SEUIL_REPLI arrivent repliées.
//
//   2. EN-TÊTE COLLANT pendant qu'on défile DANS une section. Tout en haut de la
//      liste, rien n'est collé : on voit toutes les sections d'un coup, repliées
//      ou non.
//
//   3. BARRE D'ACTIONS ADAPTATIVE. Une action qui ne s'applique à aucun lead
//      sélectionné n'apparaît pas ; une action partielle affiche sur combien elle
//      porte. Un bouton grisé pose une question sans y répondre.

const SEUIL_REPLI = 25;

// Une section dépliée ne construit jamais plus de lignes que ça. À 412 leads dans
// « Commentaire LM », le navigateur peinerait sur une seule section — et personne
// ne lit 412 lignes. Le compte réel reste affiché à côté, et « Voir les N
// suivants » en bas de section allonge à la demande.
const PLAFOND_LIGNES = 50;

export interface ListCard {
  key: string;
  name: string;
  sub: string;
  stageKey: string;
  stage: string;
  issue: string | null;
  avatarUrl: string | null;
  lastMoveAt?: string | null;
  nextDue?: { label: string; at: string | null; urgent: boolean } | null;
  callId?: string;
  callScheduledAt?: string;
  callIsFollowUp?: boolean;
  callRevenue?: number | null;
  callComment?: string | null;
  callOutcome?: string | null;
  callQualified?: boolean | null;
  callObjection?: string | null;
  callObjectionAutre?: string | null;
  callRelanceAt?: string | null;
  rapportEnRetard?: boolean;
  relancesFaites?: number;
  isIgLink?: boolean;
}

export interface ListColumn {
  key: string;
  label: string;
  color: string;
  lightBg: string;
  dot: string;
}

interface Props {
  cards: ListCard[];
  columns: readonly ListColumn[];
  /** Les étapes seules — sert à savoir si une colonne est une étape ou une issue. */
  stageKeys: readonly string[];
  /** Ordre des lignes dans chaque section. */
  tri?: 'immobile' | 'recent' | 'ancien' | 'nom';
  /** Les ordres proposés. Le bouton vit dans l'en-tête de la liste, à droite —
   *  la place y est libre, et une rangée entière de la page est rendue. */
  tris?: readonly { key: string; label: string }[];
  onTri?: (k: never) => void;
  avatarColor: (name: string) => string;
  avatarInitials: (name: string) => string;
  onCardClick: (key: string) => void;
  onRapportClick: (card: ListCard) => void;
  onBulkDelete: (keys: string[]) => Promise<void> | void;
  onBulkNotALead: (keys: string[]) => Promise<void> | void;
  onBulkRelance: (keys: string[]) => Promise<void> | void;
}

function joursDepuis(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((now - t) / 86400000);
}

function libelleAnciennete(j: number | null): string {
  if (j === null) return '—';
  if (j <= 0) return "aujourd'hui";
  if (j === 1) return 'hier';
  if (j < 7) return `${j} j`;
  if (j < 30) return `${Math.floor(j / 7)} sem`;
  return `${Math.floor(j / 30)} mois`;
}

export default function PipelineListView({
  cards, columns, stageKeys, tri = 'immobile', tris = [], onTri, avatarColor, avatarInitials,
  onCardClick, onRapportClick, onBulkDelete, onBulkNotALead, onBulkRelance,
}: Props) {
  const now = Date.now();
  const [triOuvert, setTriOuvert] = useState(false);

  const parColonne = useMemo(() => {
    const m = new Map<string, ListCard[]>();
    for (const col of columns) m.set(col.key, []);
    for (const c of cards) m.get(c.stageKey)?.push(c);
    // Un rapport à remplir passe TOUJOURS devant, quel que soit le tri : c'est
    // la seule ligne qui bloque une statistique tant qu'elle n'est pas traitée.
    const bouge = (c: ListCard) => new Date(c.lastMoveAt ?? 0).getTime();
    for (const arr of m.values()) {
      arr.sort((a, b) => {
        if (!!b.rapportEnRetard !== !!a.rapportEnRetard) return b.rapportEnRetard ? 1 : -1;
        if (tri === 'recent') return bouge(b) - bouge(a);
        if (tri === 'nom')    return a.name.localeCompare(b.name, 'fr');
        return bouge(a) - bouge(b);   // immobile (défaut) : le plus vieux mouvement d'abord
      });
    }
    return m;
  }, [cards, columns, tri]);

  // Repli : les grosses sections arrivent fermées. L'état n'est calculé qu'une
  // fois — rouvrir puis recharger ne doit pas refermer sous les doigts.
  const [replies, setReplies] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const col of columns) {
      if ((cards.filter(c => c.stageKey === col.key).length) > SEUIL_REPLI) s.add(col.key);
    }
    return s;
  });
  const toggle = (k: string) => setReplies(prev => {
    const n = new Set(prev);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });

  const [selection, setSelection] = useState<Set<string>>(new Set());
  const toggleSel = (k: string) => setSelection(prev => {
    const n = new Set(prev);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });
  // Une carte qui disparaît (suppression, changement d'étape) ne doit pas rester
  // sélectionnée : la barre compterait des leads qui ne sont plus là.
  useEffect(() => {
    setSelection(prev => {
      if (prev.size === 0) return prev;
      const vivants = new Set(cards.map(c => c.key));
      const n = new Set([...prev].filter(k => vivants.has(k)));
      return n.size === prev.size ? prev : n;
    });
  }, [cards]);

  // Combien de lignes chaque section construit. Allongé à la demande.
  const [plafonds, setPlafonds] = useState<Record<string, number>>({});

  const [confirmSuppr, setConfirmSuppr] = useState(false);
  const [caseCochee, setCaseCochee] = useState(false);
  const [enCours, setEnCours] = useState(false);

  const selectionnes = useMemo(
    () => cards.filter(c => selection.has(c.key)),
    [cards, selection],
  );
  const relancables = selectionnes.filter(c => c.issue === 'to_recontact');

  async function lancer(action: () => Promise<void> | void) {
    if (enCours) return;
    setEnCours(true);
    try { await action(); setSelection(new Set()); }
    finally { setEnCours(false); }
  }

  if (cards.length === 0) return null;

  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{
        flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden',
        border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)',
      }}>
        {/* En-tête de colonnes. Sans lui, « 2 mois » et « — » sont deux nombres
            sans nom : on ne sait pas si c'est l'ancienneté du lead, celle de son
            dernier rendez-vous, ou autre chose. */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '30px 26px minmax(0,1.35fr) minmax(0,.95fr) minmax(0,.85fr) minmax(0,1fr) 92px',
          gap: 10, alignItems: 'center', padding: '0 14px',
          // Hauteur FIXE : le collage des sections se cale dessus au pixel près.
          // Sans elle, `top` était une estimation et les lignes défilaient dans
          // les quelques pixels d'écart — la bande blanche visible en haut.
          height: 30, boxSizing: 'border-box',
          borderBottom: '1px solid var(--border)', background: 'var(--surface-2, #f7f4ec)',
          fontSize: 9.5, fontWeight: 700, letterSpacing: '.06em',
          textTransform: 'uppercase', color: 'var(--muted)',
          position: 'sticky', top: 0, zIndex: 3,
        }}>
          <span /><span />
          <span>Lead</span>
          <span>Étape actuelle</span>
          <span>Sans mouvement</span>
          <span>Prochaine échéance</span>
          {/* Le tri, dans la dernière colonne de l'en-tête. Il occupait une rangée
              entière de la page pour un bouton ; ici la place est déjà là. */}
          <span style={{ display: 'flex', justifyContent: 'flex-end', position: 'relative' }}>
            {tris.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); setTriOuvert(o => !o); }}
                  aria-expanded={triOuvert}
                  title={`Trier : ${tris.find(t => t.key === tri)?.label ?? ''}`}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '3px 8px', borderRadius: 6, cursor: 'pointer', font: 'inherit',
                    fontSize: 9.5, fontWeight: 700, letterSpacing: '.04em',
                    textTransform: 'uppercase', whiteSpace: 'nowrap',
                    border: '1px solid var(--border)', background: 'var(--surface)',
                    color: 'var(--ink-2)',
                  }}
                >
                  Trier
                  <span style={{ fontSize: 8, opacity: .6 }}>▾</span>
                </button>
                {triOuvert && (
                  <>
                    <span
                      onClick={() => setTriOuvert(false)}
                      style={{ position: 'fixed', inset: 0, zIndex: 40 }}
                    />
                    <span style={{
                      position: 'absolute', top: 'calc(100% + 5px)', right: 0, zIndex: 41,
                      minWidth: 190, padding: 6, borderRadius: 10, display: 'block',
                      background: 'var(--surface)', border: '1px solid var(--border)',
                      boxShadow: '0 8px 28px rgba(0,0,0,.16)', textTransform: 'none',
                      letterSpacing: 0,
                    }}>
                      {tris.map(t => (
                        <button
                          key={t.key}
                          type="button"
                          onClick={() => { onTri?.(t.key as never); setTriOuvert(false); }}
                          style={{
                            display: 'block', width: '100%', textAlign: 'left',
                            padding: '8px 10px', borderRadius: 7, cursor: 'pointer',
                            fontSize: 12, fontWeight: tri === t.key ? 700 : 500,
                            font: 'inherit', border: 'none', textTransform: 'none',
                            background: tri === t.key ? 'var(--surface-2)' : 'transparent',
                            color: 'var(--ink)',
                          }}
                        >{t.label}</button>
                      ))}
                    </span>
                  </>
                )}
              </>
            )}
          </span>
        </div>
        {columns.map(col => {
          const liste = parColonne.get(col.key) ?? [];
          const replie = replies.has(col.key);
          const enRetard = liste.filter(c => c.rapportEnRetard).length;
          const dorment = liste.filter(c => (joursDepuis(c.lastMoveAt, now) ?? 0) >= 21).length;
          const estIssue = !stageKeys.includes(col.key);

          return (
            <div key={col.key}>
              {/* En-tête de section. `position: sticky` ne colle que pendant qu'on
                  défile DANS la section : tout en haut de la liste, chaque en-tête
                  est à sa place et toutes les sections sont visibles d'un coup. */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => toggle(col.key)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(col.key); } }}
                className="pipeline-list-header"
                style={{
                  // 30 px exactement : la hauteur de l'en-tête de colonnes, qui
                  // colle déjà en haut. À zéro les deux se superposaient ; à une
                  // valeur approchée, une bande blanche laissait voir les lignes
                  // défiler entre les deux.
                  position: 'sticky', top: 30, zIndex: 2,
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 14px', background: 'var(--surface-2, #f7f4ec)',
                  borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
                  cursor: liste.length === 0 ? 'default' : 'pointer',
                  opacity: liste.length === 0 ? 0.55 : 1,
                  userSelect: 'none',
                }}
                aria-expanded={!replie}
                aria-label={`${col.label}, ${liste.length} lead${liste.length > 1 ? 's' : ''}`}
              >
                <span style={{
                  width: 22, height: 22, flexShrink: 0, display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 6, fontSize: 11, fontWeight: 700, lineHeight: 1,
                  color: 'var(--ink, #1a1815)',
                }}>{replie ? '▸' : '▾'}</span>
                {/* Une issue porte son SYMBOLE, une étape un simple trait de
                    couleur. Le carré plein qui servait aux deux demandait
                    d'avoir appris la légende, et rendait « Perdu » et « Pas
                    qualifié » indiscernables. */}
                {estIssue ? (
                  <span style={{ color: col.color, display: 'flex', flexShrink: 0 }}>
                    <IconeIssue issueKey={col.key} taille={14} />
                  </span>
                ) : (
                  <span style={{
                    width: 3, height: 14, borderRadius: 2,
                    background: col.color, flexShrink: 0,
                  }} />
                )}
                <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase' }}>
                  {col.label}
                </span>
                <span style={{
                  fontSize: 10, fontWeight: 700, color: 'var(--muted)',
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 4, padding: '1px 6px',
                }}>{liste.length}</span>
                <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
                  {(enRetard > 0 || dorment > 0) && (
                    <span style={{ fontSize: 10, color: 'var(--muted)' }}>
                      {enRetard > 0 && <b style={{ color: '#cd5b3f' }}>{enRetard} rapport{enRetard > 1 ? 's' : ''} à remplir</b>}
                      {enRetard > 0 && dorment > 0 && ' · '}
                      {dorment > 0 && `${dorment} sans mouvement depuis plus de 3 sem`}
                    </span>
                  )}
                  {/* « 47 sur 412 » : au-delà de PLAFOND_LIGNES, la section n'en
                      construit qu'une partie. Le dire est obligatoire — une liste
                      tronquée en silence se lit comme une liste complète. */}
                  {!replie && liste.length > PLAFOND_LIGNES && (
                    <span style={{ fontSize: 10, color: 'var(--faint)', fontVariantNumeric: 'tabular-nums' }}>
                      {Math.min(PLAFOND_LIGNES, liste.length)} sur {liste.length}
                    </span>
                  )}
                  {!replie && (
                    <span style={{
                      fontSize: 10, fontWeight: 600, color: 'var(--muted)',
                      border: '1px solid var(--border)', background: 'var(--surface)',
                      borderRadius: 6, padding: '3px 8px',
                    }}>Replier ▴</span>
                  )}
                </span>
              </div>

              {/* Une section repliée ne construit AUCUNE ligne. C'est ce qui rend
                  la page tenable à 400 leads dans une seule étape. */}
              {!replie && liste.slice(0, plafonds[col.key] ?? PLAFOND_LIGNES).map(c => {
                const j = joursDepuis(c.lastMoveAt, now);
                const dort = (j ?? 0) >= 21;
                const sel = selection.has(c.key);
                return (
                  <div
                    key={c.key}
                    onClick={() => onCardClick(c.key)}
                    className="pipeline-list-row"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '30px 26px minmax(0,1.35fr) minmax(0,.95fr) minmax(0,.85fr) minmax(0,1fr) 92px',
                      gap: 10, alignItems: 'center', padding: '8px 14px',
                      borderTop: '1px solid var(--border-soft, #f5f1e7)',
                      fontSize: 11.5, cursor: 'pointer',
                      background: sel ? 'var(--accent-brand-soft, #eef2f4)' : 'transparent',
                    }}
                  >
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); toggleSel(c.key); }}
                      aria-label={sel ? `Désélectionner ${c.name}` : `Sélectionner ${c.name}`}
                      aria-pressed={sel}
                      style={{
                        width: 22, height: 22, padding: 0, display: 'flex',
                        alignItems: 'center', justifyContent: 'center',
                        background: 'transparent', border: 'none', cursor: 'pointer',
                      }}
                    >
                      <span style={{
                        width: 15, height: 15, borderRadius: 4,
                        border: `1.5px solid ${sel ? 'var(--accent-brand, #3a6a86)' : 'var(--border)'}`,
                        background: sel ? 'var(--accent-brand, #3a6a86)' : 'var(--surface)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: '#fff', fontSize: 9, fontWeight: 700, lineHeight: 1,
                      }}>{sel ? '✓' : ''}</span>
                    </button>

                    {c.avatarUrl ? (
                      <Image src={c.avatarUrl} alt="" width={21} height={21} style={{ borderRadius: 6, objectFit: 'cover' }} unoptimized />
                    ) : (
                      <span style={{
                        width: 21, height: 21, borderRadius: 6, background: avatarColor(c.name),
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: '#fff', fontWeight: 700, fontSize: 8,
                      }}>{avatarInitials(c.name)}</span>
                    )}

                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.isIgLink ? c.name : `@${c.name}`}
                      </span>
                      {c.sub && (
                        <span style={{
                          fontSize: 8.5, fontWeight: 600, borderRadius: 4, padding: '1px 5px',
                          whiteSpace: 'nowrap', border: '1px solid var(--border)',
                          background: 'var(--surface-2, #f7f4ec)', color: 'var(--muted)',
                        }}>{c.sub}</span>
                      )}
                    </span>

                    <span style={{ color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {columns.find(x => x.key === c.stage)?.label ?? c.stage}
                    </span>

                    <span style={{ color: dort ? '#cd5b3f' : 'var(--muted)', fontWeight: dort ? 600 : 400 }}>
                      {libelleAnciennete(j)}
                    </span>

                    <span style={{
                      color: c.nextDue?.urgent ? '#cd5b3f' : 'var(--muted)',
                      fontWeight: c.nextDue?.urgent ? 600 : 400,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {c.nextDue?.label ?? '—'}
                    </span>

                    <span style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation();
                          if (c.rapportEnRetard && c.callId) onRapportClick(c);
                          else onCardClick(c.key);
                        }}
                        style={{
                          fontSize: 9.5, fontWeight: 600, padding: '5px 9px', borderRadius: 6,
                          border: `1px solid ${c.rapportEnRetard ? 'var(--accent-brand, #3a6a86)' : 'var(--border)'}`,
                          background: c.rapportEnRetard ? 'var(--accent-brand, #3a6a86)' : 'var(--surface)',
                          color: c.rapportEnRetard ? '#fff' : 'var(--ink-2, #3d3a33)',
                          cursor: 'pointer', whiteSpace: 'nowrap',
                        }}
                      >
                        {c.rapportEnRetard ? 'Remplir' : 'Historique'}
                      </button>
                    </span>
                  </div>
                );
              })}

              {/* Tronquer en silence est interdit : une liste coupée se lit comme
                  une liste complète. Le bouton dit combien restent, et les
                  ajoute par paquets. */}
              {!replie && liste.length > (plafonds[col.key] ?? PLAFOND_LIGNES) && (
                <button
                  type="button"
                  onClick={() => setPlafonds(p => ({
                    ...p,
                    [col.key]: (p[col.key] ?? PLAFOND_LIGNES) + PLAFOND_LIGNES,
                  }))}
                  style={{
                    display: 'block', width: '100%', padding: '10px 14px',
                    borderTop: '1px solid var(--border-soft, #f5f1e7)', border: 'none',
                    background: 'transparent', cursor: 'pointer', font: 'inherit',
                    fontSize: 11.5, fontWeight: 600, color: 'var(--accent-brand, #3a6a86)',
                  }}
                >
                  Voir {Math.min(PLAFOND_LIGNES, liste.length - (plafonds[col.key] ?? PLAFOND_LIGNES))} de plus
                  {' '}
                  <span style={{ color: 'var(--faint)', fontWeight: 400 }}>
                    ({liste.length - (plafonds[col.key] ?? PLAFOND_LIGNES)} restants)
                  </span>
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Barre d'actions. Elle s'adapte à la sélection : « Marquer relancés » n'a
          de sens que sur des leads en cours de relance, et affiche sur combien de
          la sélection elle porte quand ce n'est pas tous. */}
      {selection.size > 0 && !confirmSuppr && (
        <div style={{
          position: 'absolute', left: '50%', bottom: 14, transform: 'translateX(-50%)',
          zIndex: 4, display: 'flex', alignItems: 'center', gap: 5,
          padding: '8px 10px', borderRadius: 12, whiteSpace: 'nowrap',
          background: '#efe9dc', border: '1px solid #ded5c2',
          boxShadow: '0 8px 24px rgba(0,0,0,.13)',
        }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, padding: '0 8px 0 6px' }}>
            {selection.size} sélectionné{selection.size > 1 ? 's' : ''}
          </span>

          {relancables.length > 0 && (
            <button type="button" disabled={enCours}
              onClick={() => lancer(() => onBulkRelance(relancables.map(c => c.key)))}
              style={btnBarre}>
              <Icon name="send" size={11} />
              Marquer relancés
              {relancables.length !== selection.size && (
                <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 500 }}>
                  · {relancables.length} sur {selection.size}
                </span>
              )}
            </button>
          )}

          <button type="button" disabled={enCours}
            onClick={() => lancer(() => onBulkNotALead([...selection]))}
            style={btnBarre}>
            Ce n’est pas un lead
          </button>

          <span style={{ width: 1, height: 22, background: '#ded5c2', margin: '0 4px' }} />

          <button type="button" disabled={enCours}
            onClick={() => { setCaseCochee(false); setConfirmSuppr(true); }}
            style={{ ...btnBarre, color: '#cd5b3f', borderColor: '#e2b3a5' }}>
            <Icon name="trash" size={11} />
            Supprimer
          </button>

          <span style={{ width: 1, height: 22, background: '#ded5c2', margin: '0 4px' }} />
          <button type="button" onClick={() => setSelection(new Set())}
            aria-label="Annuler la sélection"
            style={{ ...btnBarre, minHeight: 28, padding: '0 8px', border: 'none', background: 'transparent', color: 'var(--muted)' }}>
            ✕
          </button>
        </div>
      )}

      {confirmSuppr && (
        <ConfirmSuppressionLot
          nb={selection.size}
          noms={selectionnes.slice(0, 6).map(c => (c.isIgLink ? c.name : `@${c.name}`))}
          avecDeal={selectionnes.filter(c => (c.callRevenue ?? 0) > 0).length}
          cochee={caseCochee}
          setCochee={setCaseCochee}
          enCours={enCours}
          onCancel={() => { setConfirmSuppr(false); setCaseCochee(false); }}
          onConfirm={() => lancer(async () => {
            await onBulkDelete([...selection]);
            setConfirmSuppr(false);
            setCaseCochee(false);
          })}
        />
      )}
    </div>
  );
}

const btnBarre: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 32,
  padding: '0 11px', borderRadius: 8, fontSize: 11.5, fontWeight: 600,
  background: 'var(--surface)', border: '1px solid #ded5c2',
  color: 'var(--ink-2, #3d3a33)', cursor: 'pointer',
};

// La case à cocher obligatoire reprend le motif déjà en place dans
// ConfirmMoveModal : le bouton reste inerte tant qu'elle n'est pas cochée. Le
// texte porte le NOMBRE — à vingt leads, « cette action » laisse croire qu'on
// n'en supprime qu'un.
function ConfirmSuppressionLot({
  nb, noms, avecDeal, cochee, setCochee, enCours, onCancel, onConfirm,
}: {
  nb: number; noms: string[]; avecDeal: number;
  cochee: boolean; setCochee: (v: boolean) => void; enCours: boolean;
  onCancel: () => void; onConfirm: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <>
      <div onClick={onCancel} style={{ position: 'fixed', inset: 0, background: 'rgba(12,16,28,.34)', zIndex: 60 }} />
      <div
        ref={ref} tabIndex={-1} role="dialog" aria-modal="true"
        onKeyDown={e => { if (e.key === 'Escape') onCancel(); }}
        style={{
          position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
          width: 'min(452px, calc(100vw - 32px))', zIndex: 61, outline: 'none',
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 18, boxShadow: '0 32px 80px rgba(0,0,0,.22)', overflow: 'hidden',
        }}
      >
        <div style={{ padding: '15px 17px 12px' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#cd5b3f' }}>
            Supprimer {nb} lead{nb > 1 ? 's' : ''} définitivement ?
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-2)', marginTop: 6, lineHeight: 1.55 }}>
            {nb > 1 ? 'Leurs historiques complets seront effacés' : 'Son historique complet sera effacé'} :
            commentaires, conversations, clics et rendez-vous.
          </div>
        </div>

        <div style={{
          margin: '0 17px 12px', border: '1px solid var(--border)', borderRadius: 8,
          background: 'var(--surface-2, #f7f4ec)', padding: '9px 11px', fontSize: 11.5,
        }}>
          {noms.map(n => <div key={n} style={{ padding: '2.5px 0', color: 'var(--ink-2)' }}>{n}</div>)}
          {nb > noms.length && (
            <div style={{ padding: '2.5px 0', color: 'var(--muted)' }}>et {nb - noms.length} autre{nb - noms.length > 1 ? 's' : ''}…</div>
          )}
        </div>

        {avecDeal > 0 && (
          <div style={{
            margin: '0 17px 12px', padding: '9px 11px', fontSize: 11.5,
            background: '#cd5b3f18', border: '1px solid #e2b3a5', borderRadius: 8, color: 'var(--ink-2)',
          }}>
            <b>{avecDeal}</b> {avecDeal > 1 ? 'portent un montant encaissé' : 'porte un montant encaissé'}.
            Ce chiffre d’affaires quittera tes statistiques.
          </div>
        )}

        <label style={{
          display: 'flex', gap: 10, alignItems: 'flex-start', margin: '0 17px 14px',
          padding: '11px 12px', background: '#cd5b3f18', border: '1px solid #e2b3a5',
          borderRadius: 8, cursor: 'pointer',
        }}>
          <input
            type="checkbox" checked={cochee} onChange={e => setCochee(e.target.checked)}
            style={{ width: 17, height: 17, flexShrink: 0, marginTop: 1, accentColor: '#cd5b3f', cursor: 'pointer' }}
          />
          <span style={{ fontSize: 11.5, color: 'var(--ink-2)', lineHeight: 1.45 }}>
            Je comprends que {nb > 1 ? `les ${nb} historiques seront effacés` : 'cet historique sera effacé'} et
            que cette action est irréversible
          </span>
        </label>

        <div style={{
          padding: '12px 17px', borderTop: '1px solid var(--border)',
          background: 'var(--surface-2, #f7f4ec)', display: 'flex', gap: 8, justifyContent: 'flex-end',
        }}>
          <button type="button" onClick={onCancel} style={{
            minHeight: 36, padding: '0 14px', fontSize: 12, fontWeight: 600, borderRadius: 8,
            border: '1px solid var(--border)', background: 'var(--surface)',
            color: 'var(--ink-2)', cursor: 'pointer',
          }}>Annuler</button>
          <button
            type="button"
            onClick={() => { if (cochee && !enCours) onConfirm(); }}
            disabled={!cochee || enCours}
            style={{
              minHeight: 36, padding: '0 14px', fontSize: 12, fontWeight: 600, borderRadius: 8,
              border: '1px solid #cd5b3f', background: '#cd5b3f', color: '#fff',
              opacity: cochee && !enCours ? 1 : 0.45,
              cursor: cochee && !enCours ? 'pointer' : 'not-allowed',
            }}
          >
            {enCours ? 'Suppression…' : `Supprimer ${nb > 1 ? `les ${nb}` : ''}`.trim()}
          </button>
        </div>
      </div>
    </>
  );
}
