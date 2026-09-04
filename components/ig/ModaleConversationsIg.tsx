'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient as createSupabase } from '@/lib/supabase/client';
import ModalShell from '@/components/ui/ModalShell';
import {
  IG, IgAvatarSimple, IgRecu, IgEnvoye, LIBELLE_PIECE_JOINTE,
} from '@/components/ig/primitivesInstagram';
import { lienDiscussion } from '@/lib/igConversations';

/**
 * Les conversations Instagram d'un élève — maître-détail.
 *
 * ⚠️ Le SENS des bulles est inversé par rapport à PageLiens : ici on rend depuis
 * le compte de l'ÉLÈVE, donc bulle grise = le prospect, dégradé = l'élève. Ce
 * sont des primitives gauche/droite ; s'y tromper produit un fil qui a l'air
 * juste et raconte l'inverse.
 *
 * ⚠️ La liste ne charge PAS les messages : la vue `ig_conversations_visibles`
 * porte déjà l'extrait, le compteur et le drapeau « attend une réponse ». Un fil
 * n'est chargé qu'à son ouverture, par pages de 50.
 *
 * ⚠️ Aucun Realtime, aucun minuteur. Le Realtime pesait 45 % de l'egress
 * Supabase récemment, et l'egress se paie au NOMBRE de requêtes. Ici : une
 * requête à l'ouverture de la modale, une par fil ouvert, zéro en régime
 * permanent.
 */

export type Fil = {
  id: string;
  peer_id: string;
  peer_username: string | null;
  peer_avatar_url: string | null;
  last_message_at: string;
  attend_reponse: boolean;
  note: string | null;
  nb_notes: number;
  nb_messages: number;
  dernier_texte: string | null;
  dernier_type: string | null;
  lead_depuis: string | null;
  lead_source: string | null;
};

type Message = {
  id: string;
  sortant: boolean;
  texte: string | null;
  type_piece_jointe: string | null;
  envoye_a: string;
  note: string | null;
};

const PAGE = 50;

export default function ModaleConversationsIg({
  profileId, prenomEleve, annotable, onClose,
}: {
  profileId: string;
  prenomEleve: string;
  /** Le coach annote et suggère ; l'élève lit seulement. */
  annotable: boolean;
  onClose: () => void;
}) {
  const supabase = createSupabase();
  const [fils, setFils] = useState<Fil[] | null>(null);
  const [actif, setActif] = useState<Fil | null>(null);
  const [recherche, setRecherche] = useState('');

  useEffect(() => {
    let vivant = true;
    supabase
      .from('ig_conversations_visibles')
      .select('*')
      .eq('profile_id', profileId)
      .order('last_message_at', { ascending: false })
      .limit(200)
      .then(({ data }) => {
        if (!vivant) return;
        const l = (data ?? []) as Fil[];
        setFils(l);
        setActif(a => a ?? l[0] ?? null);
      });
    return () => { vivant = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

  const filtres = (fils ?? []).filter(f =>
    !recherche.trim() ||
    (f.peer_username ?? '').toLowerCase().includes(recherche.trim().toLowerCase())
  );

  return (
    <ModalShell onClose={onClose} width={1040}>
      <div style={{
        display: 'grid', gridTemplateColumns: '270px 1fr',
        height: 'min(78vh, 700px)', overflow: 'hidden', borderRadius: 'inherit',
      }}>
        {/* ── Colonne des fils ─────────────────────────────────────────────── */}
        <div style={{
          borderRight: '1px solid var(--border)', background: 'var(--surface-2)',
          display: 'flex', flexDirection: 'column', minHeight: 0,
        }}>
          <div style={{ padding: 12, borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontWeight: 650, fontSize: 14, marginBottom: 9 }}>
              Conversations de {prenomEleve}
            </div>
            <input
              value={recherche}
              onChange={e => setRecherche(e.target.value)}
              placeholder="Rechercher un prospect…"
              style={{
                width: '100%', padding: '7px 11px', borderRadius: 8, fontSize: 12,
                background: 'var(--surface)', border: '1px solid var(--border)',
                color: 'var(--ink)', fontFamily: 'inherit',
              }}
            />
          </div>

          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            {fils === null && (
              <div style={{ padding: 16, fontSize: 12, color: 'var(--muted)' }}>Chargement…</div>
            )}
            {fils !== null && filtres.length === 0 && (
              <div style={{ padding: '18px 16px', fontSize: 12, color: 'var(--muted)', lineHeight: 1.55 }}>
                {recherche.trim()
                  ? 'Aucun prospect à ce nom.'
                  : `Aucune conversation partagée pour l’instant. Les échanges avec des prospects identifiés apparaîtront ici.`}
              </div>
            )}
            {filtres.map(f => (
              <button
                key={f.id}
                type="button"
                onClick={() => setActif(f)}
                style={{
                  display: 'flex', gap: 10, alignItems: 'flex-start', width: '100%',
                  padding: '10px 12px', border: 'none', textAlign: 'left', cursor: 'pointer',
                  borderTop: '1px solid var(--border-soft)', fontFamily: 'inherit',
                  background: actif?.id === f.id ? 'var(--surface)' : 'transparent',
                  boxShadow: actif?.id === f.id ? 'inset 3px 0 0 var(--accent-brand)' : undefined,
                }}
              >
                <IgAvatarSimple url={f.peer_avatar_url} pseudo={f.peer_username} taille={30} />
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                    <span style={{
                      fontWeight: 600, fontSize: 12.5, color: 'var(--ink)',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>@{f.peer_username ?? f.peer_id}</span>
                    <span style={{ fontSize: 10.5, color: 'var(--muted)', flexShrink: 0 }}>
                      {ilYA(f.last_message_at)}
                    </span>
                  </span>
                  <span style={{
                    fontSize: 11.5, color: 'var(--muted)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {f.dernier_texte || (f.dernier_type ? LIBELLE_PIECE_JOINTE[f.dernier_type] ?? '📎 Pièce jointe' : '—')}
                  </span>
                  {(f.attend_reponse || f.nb_notes > 0) && (
                    <span style={{ display: 'flex', gap: 5, marginTop: 3 }}>
                      {f.attend_reponse && <Etiquette ton="amber">Attend une réponse</Etiquette>}
                      {f.nb_notes > 0 && <Etiquette ton="brand">{f.nb_notes} note{f.nb_notes > 1 ? 's' : ''}</Etiquette>}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* ── Le fil ───────────────────────────────────────────────────────── */}
        {actif
          ? <Fil key={actif.id} fil={actif} annotable={annotable} prenomEleve={prenomEleve}
                 onNoteFil={n => setActif(a => (a ? { ...a, note: n } : a))} />
          : <div style={{ display: 'grid', placeItems: 'center', color: 'var(--muted)', fontSize: 13 }}>
              Sélectionne une conversation.
            </div>}
      </div>
    </ModalShell>
  );
}

function Etiquette({ children, ton }: { children: React.ReactNode; ton: 'amber' | 'brand' }) {
  const couleurs = ton === 'amber'
    ? { bg: 'var(--amber-soft, #b5802518)', fg: 'var(--amber, #b58025)' }
    : { bg: 'var(--accent-brand-soft, #eef2f4)', fg: 'var(--accent-brand, #3a6a86)' };
  return (
    <span style={{
      fontSize: 9.5, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase',
      padding: '1.5px 6px', borderRadius: 4, background: couleurs.bg, color: couleurs.fg,
    }}>{children}</span>
  );
}

function Fil({ fil, annotable, prenomEleve, onNoteFil }: {
  fil: Fil; annotable: boolean; prenomEleve: string; onNoteFil: (n: string | null) => void;
}) {
  const supabase = createSupabase();
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [reste, setReste] = useState(false);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [edite, setEdite] = useState<{ id: string; valeur: string } | null>(null);
  const [editeNoteFil, setEditeNoteFil] = useState<string | null>(null);
  const zoneRef = useRef<HTMLDivElement>(null);

  const charger = useCallback(async (avant?: string) => {
    let q = supabase.from('ig_messages')
      .select('id, sortant, texte, type_piece_jointe, envoye_a, note')
      .eq('conversation_id', fil.id)
      .order('envoye_a', { ascending: false })
      .limit(PAGE);
    if (avant) q = q.lt('envoye_a', avant);
    const { data } = await q;
    const page = ((data ?? []) as Message[]).reverse();
    setReste((data ?? []).length === PAGE);

    if (avant) {
      // ⚠️ Charger PLUS ANCIEN doit garder le regard où il est. Sans mémoriser
      // la hauteur avant l'ajout, le contenu inséré en tête pousse la vue vers
      // le bas et l'utilisateur perd sa place — le défaut classique d'un
      // « charger plus » en haut d'une liste.
      const z = zoneRef.current;
      const avantH = z?.scrollHeight ?? 0;
      const avantY = z?.scrollTop ?? 0;
      setMessages(m => [...page, ...(m ?? [])]);
      requestAnimationFrame(() => {
        if (z) z.scrollTop = avantY + (z.scrollHeight - avantH);
      });
    } else {
      setMessages(page);
      // Une messagerie s'ouvre sur le DERNIER message, pas sur le premier.
      // requestAnimationFrame : avant la peinture, scrollHeight vaut encore la
      // hauteur du conteneur vide et l'appel serait sans effet.
      requestAnimationFrame(() => {
        const z = zoneRef.current;
        if (z) z.scrollTop = z.scrollHeight;
      });
    }
  }, [fil.id, supabase]);

  useEffect(() => { charger(); }, [charger]);

  // Le menu contextuel doit mourir au moindre geste ailleurs — sinon il survit
  // au défilement du fil et flotte au-dessus d'un autre message.
  useEffect(() => {
    if (!menu) return;
    const fermer = () => setMenu(null);
    const echap = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    window.addEventListener('click', fermer);
    window.addEventListener('scroll', fermer, true);
    window.addEventListener('keydown', echap);
    return () => {
      window.removeEventListener('click', fermer);
      window.removeEventListener('scroll', fermer, true);
      window.removeEventListener('keydown', echap);
    };
  }, [menu]);

  async function enregistrerNote(messageId: string, valeur: string) {
    const note = valeur.trim() || null;
    // ⚠️ fetch/postgrest ne lèvent pas sur un refus : sans lire `error`, une
    // note perdue passerait pour une note enregistrée.
    const { error } = await supabase.from('ig_messages').update({
      note, note_le: note ? new Date().toISOString() : null,
    }).eq('id', messageId);
    if (error) { alert(`Note non enregistrée : ${error.message}`); return; }
    setMessages(ms => (ms ?? []).map(m => (m.id === messageId ? { ...m, note } : m)));
    setEdite(null);
  }

  async function enregistrerNoteFil(valeur: string) {
    const note = valeur.trim() || null;
    const { error } = await supabase.from('ig_conversations').update({
      note, note_le: note ? new Date().toISOString() : null,
    }).eq('id', fil.id);
    if (error) { alert(`Note non enregistrée : ${error.message}`); return; }
    onNoteFil(note);
    setEditeNoteFil(null);
  }

  const lien = lienDiscussion(fil.id, fil.peer_username);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--surface)' }}>
      {/* En-tête */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px',
        borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        <IgAvatarSimple url={fil.peer_avatar_url} pseudo={fil.peer_username} taille={32} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 650, fontSize: 13.5 }}>@{fil.peer_username ?? fil.peer_id}</div>
          <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>
            {fil.nb_messages} message{fil.nb_messages > 1 ? 's' : ''}
            {fil.lead_depuis && ` · lead depuis le ${new Date(fil.lead_depuis).toLocaleDateString('fr-FR')}`}
            {fil.lead_source && ` · ${fil.lead_source}`}
          </div>
        </div>
        {lien && (
          <a href={lien} target="_blank" rel="noopener noreferrer"
             className="btn-ghost" style={{ fontSize: 12, textDecoration: 'none', whiteSpace: 'nowrap' }}>
            Ouvrir la discussion
          </a>
        )}
      </div>

      {/* Note d'en-tête du fil */}
      {(fil.note || annotable) && (
        <div style={{ padding: '10px 16px 0' }}>
          {editeNoteFil !== null ? (
            <SaisieNote
              valeur={editeNoteFil}
              placeholder={`Note sur ce fil, visible par ${prenomEleve}…`}
              onChange={setEditeNoteFil}
              onAnnuler={() => setEditeNoteFil(null)}
              onValider={() => enregistrerNoteFil(editeNoteFil)}
            />
          ) : fil.note ? (
            <BlocNote texte={fil.note} entete onEditer={annotable ? () => setEditeNoteFil(fil.note ?? '') : undefined} />
          ) : (
            <button type="button" onClick={() => setEditeNoteFil('')}
              style={{
                background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                fontSize: 11.5, color: 'var(--accent-brand)', fontFamily: 'inherit',
              }}>
              ✎ Ajouter une note sur ce fil
            </button>
          )}
        </div>
      )}

      {/* Le fil */}
      <div ref={zoneRef} style={{
        flex: 1, minHeight: 0, overflowY: 'auto', padding: 16,
        display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        {messages === null && (
          <div style={{ margin: 'auto', fontSize: 12, color: 'var(--muted)' }}>Chargement du fil…</div>
        )}
        {reste && (
          <button type="button" onClick={() => charger(messages?.[0]?.envoye_a)}
            style={{
              alignSelf: 'center', background: 'var(--surface-2)', border: '1px solid var(--border)',
              borderRadius: 999, padding: '5px 14px', fontSize: 11.5, cursor: 'pointer',
              color: 'var(--ink-2)', fontFamily: 'inherit', flexShrink: 0,
            }}>
            Charger les messages plus anciens
          </button>
        )}

        {(messages ?? []).map((m, i, tous) => {
          const suivant = tous[i + 1];
          const dernierDuGroupe = !suivant || suivant.sortant !== m.sortant;
          const jour = i === 0 || new Date(m.envoye_a).toDateString() !== new Date(tous[i - 1].envoye_a).toDateString();
          const contenu = m.texte
            ? m.texte
            : (m.type_piece_jointe ? LIBELLE_PIECE_JOINTE[m.type_piece_jointe] ?? '📎 Pièce jointe' : '');

          return (
            <div key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {jour && (
                <div style={{ alignSelf: 'center', fontSize: 10.5, color: IG.gris }}>
                  {new Date(m.envoye_a).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
                </div>
              )}

              {/* ⚠️ `alignSelf` + `maxWidth` plutôt qu'un conteneur pleine
                  largeur : la pastille est positionnée par rapport à CE bloc, et
                  un bloc pleine largeur la collait au bord de la modale au lieu
                  de la poser sur la bulle. */}
              <div
                onContextMenu={annotable ? (e) => {
                  // Sans preventDefault, le menu du navigateur se superpose au nôtre.
                  e.preventDefault();
                  e.stopPropagation();
                  setMenu({ id: m.id, x: e.clientX, y: e.clientY });
                } : undefined}
                style={{
                  display: 'flex', flexDirection: 'column',
                  alignItems: m.sortant ? 'flex-end' : 'flex-start',
                  alignSelf: m.sortant ? 'flex-end' : 'flex-start',
                  maxWidth: '88%', position: 'relative',
                }}
                className={annotable ? 'ig-bulle-annotable' : undefined}
              >
                {/* grise = LE PROSPECT, dégradé = L'ÉLÈVE. Inverse de PageLiens. */}
                {m.sortant
                  ? <IgEnvoye sc={1} texte={contenu} />
                  : <IgRecu sc={1} avatar={dernierDuGroupe}
                      avatarNode={<IgAvatarSimple url={fil.peer_avatar_url} pseudo={fil.peer_username} taille={30} />}>
                      {contenu}
                    </IgRecu>}

                {annotable && (
                  <button type="button" title="Ajouter une note"
                    onClick={(e) => { e.stopPropagation(); setEdite({ id: m.id, valeur: m.note ?? '' }); }}
                    className="ig-pastille-note"
                    style={{
                      position: 'absolute', top: -6, [m.sortant ? 'left' : 'right']: -6,
                      width: 21, height: 21, borderRadius: '50%', cursor: 'pointer',
                      background: 'var(--surface)', border: '1px solid var(--border)',
                      color: 'var(--accent-brand)', fontSize: 10, lineHeight: 1,
                      display: 'grid', placeItems: 'center', padding: 0,
                      boxShadow: '0 2px 6px rgba(26,24,21,.14)',
                    } as React.CSSProperties}>✎</button>
                )}
              </div>

              {edite?.id === m.id ? (
                <div style={{ maxWidth: '78%', alignSelf: m.sortant ? 'flex-end' : 'flex-start' }}>
                  <SaisieNote
                    valeur={edite.valeur}
                    placeholder={`Note sur ce message, visible par ${prenomEleve}…`}
                    onChange={v => setEdite({ id: m.id, valeur: v })}
                    onAnnuler={() => setEdite(null)}
                    onValider={() => enregistrerNote(m.id, edite.valeur)}
                  />
                </div>
              ) : m.note ? (
                <div style={{ maxWidth: '78%', alignSelf: m.sortant ? 'flex-end' : 'flex-start' }}>
                  <BlocNote texte={m.note}
                    onEditer={annotable ? () => setEdite({ id: m.id, valeur: m.note ?? '' }) : undefined} />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Menu contextuel — clic droit. Deux entrées : une suggestion répond à la
          conversation telle qu'elle est MAINTENANT, l'accrocher à un message
          d'il y a trois semaines ne veut rien dire. */}
      {menu && (
        <div
          onClick={e => e.stopPropagation()}
          style={{
            position: 'fixed', top: menu.y, left: menu.x, zIndex: 60,
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
            boxShadow: '0 10px 26px rgba(26,24,21,.16)', padding: 5, minWidth: 180,
            display: 'flex', flexDirection: 'column',
          }}>
          {[
            ['✎  Ajouter une note', () => {
              const m = (messages ?? []).find(x => x.id === menu.id);
              setEdite({ id: menu.id, valeur: m?.note ?? '' });
              setMenu(null);
            }],
            ['⧉  Copier le message', () => {
              const m = (messages ?? []).find(x => x.id === menu.id);
              navigator.clipboard?.writeText(m?.texte ?? '').catch(() => {});
              setMenu(null);
            }],
          ].map(([libelle, action]) => (
            <button key={libelle as string} type="button" onClick={action as () => void}
              style={{
                padding: '7px 10px', borderRadius: 6, border: 'none', background: 'none',
                textAlign: 'left', fontSize: 12.5, color: 'var(--ink-2)', cursor: 'pointer',
                fontFamily: 'inherit', whiteSpace: 'nowrap',
              }}>{libelle as string}</button>
          ))}
        </div>
      )}

      <style jsx global>{`
        .ig-pastille-note { opacity: 0; transition: opacity 120ms ease; }
        .ig-bulle-annotable:hover .ig-pastille-note { opacity: 1; }
        .ig-pastille-note:focus-visible { opacity: 1; }
      `}</style>
    </div>
  );
}

function BlocNote({ texte, entete, onEditer }: { texte: string; entete?: boolean; onEditer?: () => void }) {
  return (
    <div style={{
      display: 'flex', gap: 8, alignItems: 'flex-start',
      background: 'var(--accent-brand-soft, #eef2f4)',
      border: entete ? '1px solid color-mix(in srgb, var(--accent-brand) 18%, transparent)' : undefined,
      borderLeft: entete ? undefined : '2px solid var(--accent-brand)',
      borderRadius: entete ? 9 : '0 8px 8px 0',
      padding: entete ? '9px 12px' : '7px 10px',
      fontSize: entete ? 12 : 11.5, color: 'var(--ink-2)', lineHeight: 1.45,
    }}>
      <span style={{ flexShrink: 0 }}>{entete ? '📌' : '✎'}</span>
      <span style={{ flex: 1, whiteSpace: 'pre-wrap' }}>{texte}</span>
      {onEditer && (
        <button type="button" onClick={onEditer}
          style={{
            background: 'none', border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0,
            fontSize: 11, color: 'var(--accent-brand)', fontFamily: 'inherit',
          }}>modifier</button>
      )}
    </div>
  );
}

function SaisieNote({ valeur, placeholder, onChange, onValider, onAnnuler }: {
  valeur: string; placeholder: string;
  onChange: (v: string) => void; onValider: () => void; onAnnuler: () => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <textarea
        autoFocus
        value={valeur}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        rows={2}
        style={{
          width: '100%', resize: 'vertical', padding: '8px 10px', borderRadius: 8,
          border: '1px solid var(--border)', background: 'var(--bg)', fontSize: 12,
          fontFamily: 'inherit', color: 'var(--ink)', lineHeight: 1.45,
        }}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn-primary" onClick={onValider} style={{ fontSize: 12 }}>
          Enregistrer
        </button>
        <button type="button" className="btn-ghost" onClick={onAnnuler} style={{ fontSize: 12 }}>
          Annuler
        </button>
      </div>
      <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>
        Cette note est visible par l’élève.
      </div>
    </div>
  );
}

/** « il y a 2 h », sans dépendance : la même règle que le reste des listes. */
function ilYA(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  const j = Math.round(s / 86400);
  return j < 30 ? `${j} j` : new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}
