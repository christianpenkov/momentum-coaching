'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient as createSupabase } from '@/lib/supabase/client';
import Icon from '@/components/ui/Icon';
import {
  IG, IgAvatarSimple, IgRecu, IgEnvoye, MarqueurPieceJointe, libellePieceJointe,
} from '@/components/ig/primitivesInstagram';
import { lienDiscussion, sourceDuLead } from '@/lib/igConversations';

/**
 * Les conversations Instagram d'un élève — maître-détail.
 *
 * ⚠️ Ce composant ne connaît PAS son enveloppe. Côté coach il est posé dans une
 * modale, côté élève c'est une PAGE à part entière. Une version antérieure
 * embarquait `ModalShell` ici : la page de l'élève affichait donc une modale sur
 * fond vide, avec une croix de fermeture qui ne menait nulle part. Un composant
 * qui décide de sa propre enveloppe ne peut pas servir deux contextes.
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
  profile_id: string;
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

type Suggestion = {
  id: string;
  texte: string;
  cree_le: string;
  copie_le: string | null;
  traite_le: string | null;
};

type Message = {
  id: string;
  sortant: boolean;
  texte: string | null;
  type_piece_jointe: string | null;
  envoye_a: string;
  note: string | null;
  /**
   * Le fichier du vocal est-il encore la ? `null` quand la question ne se pose
   * pas (message texte, photo...). Derive a la lecture par
   * `ig_messages_visibles`, jamais stocke : une colonne ecrite a la capture
   * deviendrait fausse le jour de la purge a 30 jours.
   */
  vocal_conserve: boolean | null;
};

const PAGE = 50;

/**
 * Le bandeau d'en-tête du panneau de droite.
 *
 * ⚠️ Partagé par le fil ET par l'état vide, et c'est tout l'intérêt : la croix
 * de fermeture y vit dans le FLUX, donc `alignItems: center` l'aligne sur
 * « Ouvrir la discussion » par construction. La première version la posait en
 * absolu avec un `top` choisi à la main — les deux boutons tombaient à 2,4 px
 * l'un de l'autre, mesuré au navigateur. Un alignement obtenu en faisant
 * coïncider deux nombres se défait au premier changement de police ou de
 * remplissage ; celui-ci ne peut pas se défaire.
 */
const BANDEAU: React.CSSProperties = {
  display: 'flex', alignItems: 'center', padding: '11px 16px',
  borderBottom: '1px solid var(--border)', flexShrink: 0,
};

/**
 * ⚠️ 34 px de côté : au-dessus des 24 px du plus petit bouton du projet, en
 * dessous des 44 px imposés au tactile — cet écran est réservé à l'ordinateur,
 * il n'y a pas de doigt à viser ici.
 */
function CroixFermer({ onFermer }: { onFermer: () => void }) {
  return (
    <button
      type="button" onClick={onFermer} aria-label="Fermer" className="icon-btn"
      style={{
        width: 34, height: 34, borderRadius: 8, flexShrink: 0, padding: 0,
        border: '1px solid var(--border)', background: 'var(--surface)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', color: 'var(--muted)', fontSize: 19, lineHeight: 1,
      }}>×</button>
  );
}

export default function ConversationsIg({
  profileId, prenomEleve, annotable, titre, hauteur = 'min(78vh, 700px)', onFermer,
  retirable = false,
}: {
  profileId: string;
  prenomEleve: string;
  /** Le coach annote et suggère ; l'élève lit seulement. */
  annotable: boolean;
  /** Le titre de la colonne de gauche. L'appelant le formule pour son contexte. */
  titre: string;
  /** Laissé à l'appelant : une modale et une page n'ont pas la même contrainte. */
  hauteur?: string;
  /**
   * Fournie uniquement par l'enveloppe MODALE. Absente sur la page de l'élève,
   * où il n'y a rien à fermer — une croix y renverrait vers du vide, ce qui
   * était déjà le défaut d'une version antérieure de cet écran.
   */
  onFermer?: () => void;
  /**
   * L'élève peut retirer une conversation ; le coach non. Ces messages sont
   * ceux de l'élève, et le partage se révoque par celui qui l'a accordé — pas
   * par celui qui en bénéficie.
   */
  retirable?: boolean;
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
      <div style={{
        display: 'grid', gridTemplateColumns: 'minmax(240px, 300px) 1fr',
        height: hauteur, overflow: 'hidden', borderRadius: 'inherit',
      }}>
        {/* ── Colonne des fils ─────────────────────────────────────────────── */}
        <div style={{
          borderRight: '1px solid var(--border)', background: 'var(--surface-2)',
          display: 'flex', flexDirection: 'column', minHeight: 0,
        }}>
          <div style={{ padding: 12, borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontWeight: 650, fontSize: 14, marginBottom: 9 }}>
              {titre}
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
                    {f.dernier_texte || libellePieceJointe(f.dernier_type) || '—'}
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
                 onFermer={onFermer} retirable={retirable}
                 onRetire={() => {
                   // Retiré côté serveur : on l'ôte de la liste et on bascule sur
                   // le fil suivant. Pas de rechargement — la réponse fait foi, et
                   // une requête de plus par retrait se paierait à chaque geste.
                   setFils(l => (l ?? []).filter(f => f.id !== actif.id));
                   setActif(a => {
                     const reste = (fils ?? []).filter(f => f.id !== a?.id);
                     return reste[0] ?? null;
                   });
                 }}
                 onNoteFil={n => setActif(a => (a ? { ...a, note: n } : a))} />
          : (
            // ⚠️ Le panneau vide porte le MÊME bandeau d'en-tête que le fil, alors
            // qu'il n'a rien à y mettre. C'est ce qui permet à la croix d'occuper
            // toujours la même place : sans lui, elle sauterait d'une position à
            // l'autre selon qu'un fil est choisi ou non.
            <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--surface)' }}>
              <div style={{ ...BANDEAU, justifyContent: 'flex-end' }}>
                {onFermer && <CroixFermer onFermer={onFermer} />}
              </div>
              <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--muted)', fontSize: 13 }}>
                Sélectionne une conversation.
              </div>
            </div>
          )}
      </div>
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

function Fil({ fil, annotable, prenomEleve, onFermer, retirable, onRetire, onNoteFil }: {
  fil: Fil; annotable: boolean; prenomEleve: string;
  /** Fournie par l'enveloppe modale seulement — la page de l'élève n'a rien à fermer. */
  onFermer?: () => void;
  /** Vrai côté élève uniquement. */
  retirable: boolean;
  onRetire: () => void;
  onNoteFil: (n: string | null) => void;
}) {
  const supabase = createSupabase();
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [reste, setReste] = useState(false);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [edite, setEdite] = useState<{ id: string; valeur: string } | null>(null);
  const [editeNoteFil, setEditeNoteFil] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [brouillon, setBrouillon] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [erreurNote, setErreurNote] = useState<string | null>(null);
  const [confirmeRetrait, setConfirmeRetrait] = useState(false);
  const [retraitEnCours, setRetraitEnCours] = useState(false);
  const [erreurRetrait, setErreurRetrait] = useState<string | null>(null);
  const zoneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let vivant = true;
    supabase.from('ig_suggestions')
      .select('id, texte, cree_le, copie_le, traite_le')
      .eq('conversation_id', fil.id)
      .order('cree_le', { ascending: false })
      .then(({ data }) => { if (vivant) setSuggestions((data ?? []) as Suggestion[]); });
    return () => { vivant = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fil.id]);

  async function envoyerSuggestion() {
    const texte = brouillon.trim();
    if (!texte) return;
    setEnvoi(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase.from('ig_suggestions').insert({
      conversation_id: fil.id, profile_id: fil.profile_id,
      auteur_id: user?.id, texte,
    }).select('id, texte, cree_le, copie_le, traite_le').single();
    setEnvoi(false);
    // Sans lire `error`, une suggestion perdue passerait pour envoyée.
    if (error) { alert(`Suggestion non envoyée : ${error.message}`); return; }
    setSuggestions(s => [data as Suggestion, ...s]);
    setBrouillon('');
  }

  /** ⚠️ L'élève n'écrit PAS en direct : la RLS ne sait pas borner les colonnes
   *  qu'un update peut toucher, et une écriture directe le laisserait réécrire
   *  le texte de la suggestion. La route n'accepte que `copie_le`/`traite_le`. */
  async function marquer(s: Suggestion, champ: 'copie_le' | 'traite_le') {
    const r = await fetch('/api/client/ig-suggestion', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: s.id, champ }),
    });
    if (!r.ok) return;
    setSuggestions(list => list.map(x =>
      x.id === s.id ? { ...x, [champ]: new Date().toISOString() } : x));
  }

  async function copier(s: Suggestion) {
    try { await navigator.clipboard.writeText(s.texte); } catch { /* presse-papier refusé */ }
    marquer(s, 'copie_le');
  }

  const charger = useCallback(async (avant?: string) => {
    // ⚠️ La lecture passe par la VUE, pas par la table : c'est elle qui porte
    // `vocal_conserve`. Elle n'elargit rien — `security_invoker = true`, donc la
    // RLS d'`ig_messages` decide toujours quelles lignes sortent.
    let q = supabase.from('ig_messages_visibles')
      .select('id, sortant, texte, type_piece_jointe, envoye_a, note, vocal_conserve')
      .eq('conversation_id', fil.id)
      .order('envoye_a', { ascending: false })
      .limit(PAGE);
    if (avant) q = q.lt('envoye_a', avant);
    const { data } = await q;
    const page = ((data ?? []) as Message[]).reverse();
    setReste((data ?? []).length === PAGE);

    // ⚠️ Aucun défilement programmé, ni à l'ouverture ni au chargement des
    // messages plus anciens : la zone est en `column-reverse` (voir plus bas).
    // Le navigateur ancre en bas tout seul, et le contenu ajouté en tête part
    // hors-champ vers le haut sans déplacer la vue.
    setMessages(m => (avant ? [...page, ...(m ?? [])] : page));
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

  /**
   * ⚠️ Passe par une ROUTE, jamais par un `update` direct.
   *
   * Postgres ne sait pas borner les colonnes qu'un `update` peut toucher : une
   * politique qui ouvrirait `note` au coach ouvrirait aussi `texte`, donc le
   * pouvoir de réécrire ce qu'un prospect a dit. L'audit du 2026-09-04 a trouvé
   * les deux faces du défaut en production — l'élève réécrivait les notes de son
   * coach, et le coach n'en écrivait aucune. Plus personne n'écrit en direct.
   */
  async function ecrireNote(cible: 'message' | 'fil', id: string, valeur: string) {
    const r = await fetch('/api/coach/ig-note', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cible, id, note: valeur }),
    });
    // fetch ne lève pas sur un 4xx : sans ce test, une note perdue passerait
    // pour une note enregistrée.
    if (!r.ok) {
      setErreurNote((await r.json().catch(() => ({})))?.error || 'Note non enregistrée');
      return null;
    }
    setErreurNote(null);
    return ((await r.json()) as { note: string | null }).note;
  }

  async function enregistrerNote(messageId: string, valeur: string) {
    const note = await ecrireNote('message', messageId, valeur);
    if (note === null && erreurNote) return;
    setMessages(ms => (ms ?? []).map(m => (m.id === messageId ? { ...m, note } : m)));
    setEdite(null);
  }

  async function enregistrerNoteFil(valeur: string) {
    const note = await ecrireNote('fil', fil.id, valeur);
    if (note === null && erreurNote) return;
    onNoteFil(note);
    setEditeNoteFil(null);
  }

  async function retirer() {
    setRetraitEnCours(true);
    setErreurRetrait(null);
    try {
      const r = await fetch('/api/client/ig-conversation-retirer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversation_id: fil.id }),
      });
      // ⚠️ `fetch` ne lève pas sur un 4xx/5xx : sans ce test, un refus du serveur
      // passerait pour un succès et le fil disparaîtrait de l'écran en restant
      // bien présent en base. C'est le piège documenté de `lib/mutate.ts`.
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error || `Erreur ${r.status}`);
      }
      onRetire();
    } catch (e: any) {
      setErreurRetrait(e?.message || 'Retrait impossible');
      setRetraitEnCours(false);
    }
  }

  const lien = lienDiscussion(fil.id, fil.peer_username);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--surface)' }}>
      {/* En-tête */}
      <div style={{ ...BANDEAU, gap: 10 }}>
        <IgAvatarSimple url={fil.peer_avatar_url} pseudo={fil.peer_username} taille={32} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 650, fontSize: 13.5 }}>@{fil.peer_username ?? fil.peer_id}</div>
          <div style={{
            fontSize: 10.5, color: 'var(--muted)',
            display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap',
          }}>
            <span>
              {fil.nb_messages} message{fil.nb_messages > 1 ? 's' : ''}
              {fil.lead_depuis && ` · lead depuis le ${new Date(fil.lead_depuis).toLocaleDateString('fr-FR')}`}
            </span>
            {/* ⚠️ On affichait ici la valeur BRUTE de `source` — « comment »,
                « cold_dm ». Une clé de base de données n'est pas un libellé : elle
                ne veut rien dire pour un coach, et « comment » se lit même comme un
                mot français tronqué. La pastille reprend celle de Pipeline Leads,
                où le coach voit déjà la même origine — un test confronte les deux
                palettes pour qu'elles ne divergent pas en silence. */}
            {(() => {
              const src = sourceDuLead(fil.lead_source);
              if (!src) return null;
              return (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span aria-hidden="true" style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: src.couleur, flexShrink: 0,
                  }} />
                  {src.libelle}
                </span>
              );
            })()}
          </div>
        </div>
        {lien && (
          // Encadre plein : c'est une sortie hors de la plateforme, elle doit se
          // lire comme un bouton et non comme un mot souligne dans un en-tete.
          <a href={lien} target="_blank" rel="noopener noreferrer"
             style={{
               display: 'inline-flex', alignItems: 'center', gap: 7, flexShrink: 0,
               border: '1px solid var(--border)', borderRadius: 7,
               padding: '7px 13px', fontSize: 12.5, fontWeight: 600,
               color: 'var(--ink-2)', background: 'var(--surface)',
               textDecoration: 'none', whiteSpace: 'nowrap',
             }}>
            Ouvrir la discussion
            <Icon name="external" size={13} color="var(--muted)" />
          </a>
        )}
        {retirable && (
          <button
            type="button" onClick={() => setConfirmeRetrait(true)} disabled={retraitEnCours}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0,
              border: '1px solid var(--border)', borderRadius: 7,
              padding: '7px 12px', fontSize: 12.5, fontWeight: 600,
              color: 'var(--muted)', background: 'var(--surface)',
              cursor: retraitEnCours ? 'wait' : 'pointer', fontFamily: 'inherit',
              whiteSpace: 'nowrap',
            }}>
            Retirer
          </button>
        )}
        {onFermer && <CroixFermer onFermer={onFermer} />}
      </div>

      {/* ⚠️ Une confirmation en toutes lettres, et non un « Êtes-vous sûr ? ».
          Ce geste efface des messages pour de bon ET écarte la personne du
          pipeline : les deux effets sont réels, les cacher derrière un mot
          rassurant en ferait un piège. C'est le même geste que « ce n'est pas un
          lead » dans Pipeline Leads, dit avec les mots de cet écran-ci. */}
      {confirmeRetrait && (
        <div style={{
          margin: '10px 16px 0', padding: '12px 14px', borderRadius: 10,
          border: '1px solid var(--border)', background: 'var(--surface-2)',
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--ink)' }}>
            Retirer la conversation avec <strong>@{fil.peer_username ?? fil.peer_id}</strong> ?
            <br />
            Les messages conservés ici seront <strong>supprimés définitivement</strong>, ton coach
            n'y aura plus accès, et cette personne sortira de ton Pipeline Leads. Ta conversation
            reste intacte dans Instagram.
          </div>
          {erreurRetrait && (
            <div style={{ fontSize: 12, color: 'var(--danger, #b3261e)' }}>{erreurRetrait}</div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={retirer} disabled={retraitEnCours}
              style={{
                border: 'none', borderRadius: 7, padding: '8px 14px', fontSize: 12.5,
                fontWeight: 600, color: '#fff', background: 'var(--danger, #b3261e)',
                cursor: retraitEnCours ? 'wait' : 'pointer', fontFamily: 'inherit',
              }}>
              {retraitEnCours ? 'Retrait…' : 'Retirer définitivement'}
            </button>
            <button type="button" onClick={() => { setConfirmeRetrait(false); setErreurRetrait(null); }}
              disabled={retraitEnCours}
              style={{
                border: '1px solid var(--border)', borderRadius: 7, padding: '8px 14px',
                fontSize: 12.5, fontWeight: 600, color: 'var(--ink-2)',
                background: 'var(--surface)', cursor: 'pointer', fontFamily: 'inherit',
              }}>
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* Note d'en-tête du fil */}
      {(fil.note || annotable) && (
        <div style={{ padding: '10px 16px 0' }}>
          {editeNoteFil !== null ? (
            <SaisieNote
              valeur={editeNoteFil}
              placeholder={`Note sur ce fil, visible par ${prenomEleve}…`}
              aide={`${prenomEleve} verra cette note dans son onglet Conversations DM.`}
              onChange={setEditeNoteFil}
              onAnnuler={() => setEditeNoteFil(null)}
              onValider={() => enregistrerNoteFil(editeNoteFil)}
            />
          ) : fil.note ? (
            <BlocNote texte={fil.note} entete
              auteur={annotable ? undefined : `Note de ${prenomEleve}`}
              onEditer={annotable ? () => setEditeNoteFil(fil.note ?? '') : undefined} />
          ) : (
            <button type="button" onClick={() => setEditeNoteFil('')}
              style={{
                background: 'none', border: 'none', padding: '2px 0', cursor: 'pointer',
                fontSize: 11.5, color: 'var(--accent-brand)', fontFamily: 'inherit',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}>
              <span aria-hidden="true" style={{ fontSize: 12, lineHeight: '16px' }}>📌</span>
              Ajouter une note sur ce fil
            </button>
          )}
        </div>
      )}

      {/* ── Le fil, en `column-reverse` ──────────────────────────────────────
          Ce n'est pas un détail de style, c'est le correctif du projet.
          `app/layout.tsx` charge les polices en `display: 'swap'` : le texte
          s'affiche d'abord en police système puis grandit quand Inter arrive,
          APRÈS le premier rendu. Avec un défilement classique, ce grossissement
          décale la vue — c'est le « saut de scroll au premier tap après un
          démarrage à froid », invisible à toute instrumentation, qui a coûté
          plusieurs sessions dans la messagerie.
          `column-reverse` l'annule : le navigateur ancre en bas nativement, donc
          le contenu qui grandit pousse vers le haut, hors-champ.
          Conséquences ici : aucun scrollTop à écrire à l'ouverture, et charger
          les messages plus anciens ne déplace pas la vue.
          ⚠️ Le DOM va donc du PLUS RÉCENT au plus ancien : d'où le `.reverse()`
          ci-dessous, et le bouton « plus anciens » placé APRÈS, qui apparaît
          visuellement en HAUT. */}
      <div ref={zoneRef} style={{
        flex: 1, minHeight: 0, overflowY: 'auto', padding: 16,
        display: 'flex', flexDirection: 'column-reverse', gap: 10,
      }}>
        {messages === null && (
          <div style={{ margin: 'auto', fontSize: 12, color: 'var(--muted)' }}>Chargement du fil…</div>
        )}

        {[...(messages ?? [])].map((m, i, tous) => {
          const suivant = tous[i + 1];
          const dernierDuGroupe = !suivant || suivant.sortant !== m.sortant;
          const jour = i === 0 || new Date(m.envoye_a).toDateString() !== new Date(tous[i - 1].envoye_a).toDateString();
          const contenu = m.texte
            ? m.texte
            : (m.type_piece_jointe
                ? <PieceJointe messageId={m.id} type={m.type_piece_jointe}
                               vocalConserve={m.vocal_conserve} />
                : '');

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
                  ? <IgEnvoye sc={1} largeurMax="100%">{contenu}</IgEnvoye>
                  : <IgRecu sc={1} avatar={dernierDuGroupe} largeurMax="100%"
                      avatarNode={<IgAvatarSimple url={fil.peer_avatar_url} pseudo={fil.peer_username} taille={30} />}>
                      {contenu}
                    </IgRecu>}

                {annotable && (
                  // Cible de 28 px, au-dessus du minimum confortable a la souris,
                  // et toujours atteignable au clavier : `opacity` ne retire pas
                  // du flux, et `:focus-visible` la revele.
                  <button type="button"
                    aria-label={m.note ? 'Modifier la note sur ce message' : 'Ajouter une note sur ce message'}
                    onClick={(e) => { e.stopPropagation(); setEdite({ id: m.id, valeur: m.note ?? '' }); }}
                    className="ig-pastille-note"
                    style={{
                      position: 'absolute', top: -8, [m.sortant ? 'left' : 'right']: -8,
                      width: 28, height: 28, borderRadius: '50%', cursor: 'pointer',
                      background: 'var(--surface)', border: '1px solid var(--border)',
                      color: 'var(--ink-2)',
                      display: 'grid', placeItems: 'center', padding: 0,
                      boxShadow: '0 1px 4px rgba(26,24,21,.10)',
                    } as React.CSSProperties}>
                    {/* Le même glyphe que la note qu'il produit : une affordance
                        doit annoncer ce qu'elle fabrique. */}
                    <span aria-hidden="true" style={{ fontSize: 12, lineHeight: 1 }}>📝</span>
                  </button>
                )}
              </div>

              {edite?.id === m.id ? (
                <div style={{ maxWidth: '78%', alignSelf: m.sortant ? 'flex-end' : 'flex-start' }}>
                  <SaisieNote
                    valeur={edite.valeur}
                    placeholder={`Note sur ce message, visible par ${prenomEleve}…`}
                    aide={`${prenomEleve} verra cette note à côté du message.`}
                    onChange={v => setEdite({ id: m.id, valeur: v })}
                    onAnnuler={() => setEdite(null)}
                    onValider={() => enregistrerNote(m.id, edite.valeur)}
                  />
                </div>
              ) : m.note ? (
                <div style={{ maxWidth: '78%', alignSelf: m.sortant ? 'flex-end' : 'flex-start' }}>
                  <BlocNote texte={m.note}
                    auteur={annotable ? undefined : `Note de ${prenomEleve}`}
                    onEditer={annotable ? () => setEdite({ id: m.id, valeur: m.note ?? '' }) : undefined} />
                </div>
              ) : null}
            </div>
          );
        }).reverse()}

        {/* Placé APRÈS les messages dans le DOM, donc visuellement au-dessus
            d'eux : c'est l'effet de `column-reverse`. */}
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
            ['note', 'Ajouter une note', () => {
              const m = (messages ?? []).find(x => x.id === menu.id);
              setEdite({ id: menu.id, valeur: m?.note ?? '' });
              setMenu(null);
            }],
            ['copy', 'Copier le message', () => {
              const m = (messages ?? []).find(x => x.id === menu.id);
              navigator.clipboard?.writeText(m?.texte ?? '').catch(() => {});
              setMenu(null);
            }],
          ].map(([icone, libelle, action]) => (
            <button key={libelle as string} type="button" onClick={action as () => void}
              style={{
                padding: '8px 10px', borderRadius: 6, border: 'none', background: 'none',
                textAlign: 'left', fontSize: 12.5, color: 'var(--ink-2)', cursor: 'pointer',
                fontFamily: 'inherit', whiteSpace: 'nowrap',
                display: 'flex', alignItems: 'center', gap: 9,
              }}>
              {icone === 'note'
                ? <span aria-hidden="true" style={{ fontSize: 12, width: 14, textAlign: 'center' }}>📝</span>
                : <Icon name={icone as any} size={14} color="var(--muted)" />}
              {libelle as string}
            </button>
          ))}
        </div>
      )}

      {/* ── Suggestions ──────────────────────────────────────────────────────
          La plateforme n'envoie AUCUN message de coach : il rédige, l'élève
          envoie depuis Instagram. Ce n'est pas une limite technique — un coach
          qui répond à la place engage l'élève sans avoir tout le contexte, et
          plus personne ne peut dire qui a dit quoi.
          Effet de bord bienvenu : aucune fenêtre de 24 h à gérer, aucune
          permission `human_agent` à demander à Meta. */}
      <div style={{
        borderTop: '1px solid var(--border)', padding: '12px 16px',
        display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0,
      }}>
        {suggestions.filter(s => !s.traite_le).map(s => (
          <div key={s.id} style={{
            // Pointillé NEUTRE : c'est la forme, pas la couleur, qui dit
            // « pas encore envoyé ». Le bleu de marque reste réservé au bouton
            // d'action, seul endroit où il guide une décision.
            border: '1px dashed var(--border)',
            background: 'var(--surface-2)', borderRadius: 10,
            padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10,
          }}>
            <div style={{
              fontSize: 11, fontWeight: 600, color: 'var(--muted)',
              display: 'flex', alignItems: 'center', gap: 7,
            }}>
              <Icon name="send" size={13} color="currentColor" />
              Message de suggestion, pas encore envoyé
            </div>
            <div style={{ fontSize: 13.5, lineHeight: 1.5, whiteSpace: 'pre-wrap', color: 'var(--ink)' }}>{s.texte}</div>
            {!annotable && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button type="button" className="btn-primary" style={{ fontSize: 12 }}
                  onClick={() => copier(s)}>
                  {s.copie_le ? 'Texte copié' : 'Copier le texte'}
                </button>
                {lien && (
                  <a href={lien} target="_blank" rel="noopener noreferrer"
                     onClick={() => marquer(s, 'traite_le')}
                     style={{
                       display: 'inline-flex', alignItems: 'center', gap: 7,
                       border: '1px solid var(--border)', borderRadius: 7,
                       padding: '8px 14px', fontSize: 12.5, fontWeight: 600,
                       color: 'var(--ink-2)', background: 'var(--surface)',
                       textDecoration: 'none', whiteSpace: 'nowrap',
                     }}>
                    Ouvrir la discussion
                    <Icon name="external" size={13} color="var(--muted)" />
                  </a>
                )}
                <button type="button" onClick={() => marquer(s, 'traite_le')}
                  style={{
                    background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                    fontSize: 11, color: 'var(--muted)', fontFamily: 'inherit',
                  }}>Je l’ai envoyé</button>
              </div>
            )}
            {/* ⚠️ Ce marqueur ne prouve PAS qu'un message est parti : l'envoi a
                lieu dans Instagram, hors de notre portée. La seule preuve arrive
                toute seule — si le texte part, Instagram nous le renvoie en
                `is_echo` et il apparaît dans le fil. */}
            {annotable && s.copie_le && (
              <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>
                {prenomEleve} a copié ce message le {new Date(s.copie_le).toLocaleDateString('fr-FR')}
              </div>
            )}
          </div>
        ))}

        {annotable && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <textarea
              value={brouillon}
              onChange={e => setBrouillon(e.target.value)}
              placeholder={`Écrire un message de suggestion pour ${prenomEleve}…`}
              rows={2}
              style={{
                flex: 1, resize: 'vertical', padding: '9px 12px', borderRadius: 10,
                border: '1px solid var(--border)', background: 'var(--bg)', fontSize: 12.5,
                fontFamily: 'inherit', color: 'var(--ink)', lineHeight: 1.45,
              }}
            />
            <button type="button" className="btn-primary" disabled={!brouillon.trim() || envoi}
              onClick={envoyerSuggestion} style={{ fontSize: 12.5, flexShrink: 0 }}>
              {envoi ? 'Envoi…' : 'Envoyer le message'}
            </button>
          </div>
        )}
      </div>

      <style jsx global>{`
        .ig-pastille-note { opacity: 0; transition: opacity 120ms ease; }
        .ig-bulle-annotable:hover .ig-pastille-note { opacity: 1; }
        .ig-pastille-note:focus-visible { opacity: 1; }
      `}</style>
    </div>
  );
}

/**
 * Une note du coach, attachée à un fil ou à un message.
 *
 * ⚠️ Deux règles du design system que la première version violait :
 *
 *  1. « La Règle de la Rareté Ardoise » — le bleu de marque ne colore jamais un
 *     bloc entier. Il était ici en fond ET en liseré : deux mésusages sur le
 *     même composant, ce qui aspirait le regard sur la note plutôt que sur la
 *     conversation qu'elle commente.
 *  2. Un liseré latéral coloré de plus d'1 px comme accent est un motif banni
 *     — jamais intentionnel, toujours un réflexe.
 *
 * À la place : la surface crème du système, une bordure pleine d'1 px, et le
 * texte en encre secondaire. La note se lit comme une annotation en marge, pas
 * comme une alerte.
 */
function BlocNote({ texte, entete, auteur, onEditer }: {
  texte: string; entete?: boolean; auteur?: string; onEditer?: () => void;
}) {
  return (
    <div style={{
      display: 'flex', gap: 9, alignItems: 'flex-start',
      background: 'var(--surface-2)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      padding: entete ? '10px 12px' : '8px 11px',
      fontSize: entete ? 12.5 : 12,
      color: 'var(--ink-2)', lineHeight: 1.5,
    }}>
      <span aria-hidden="true" style={{
        flexShrink: 0,
        fontSize: entete ? 13 : 11.5,
        // Cale le glyphe sur la premiere ligne de texte plutot que sur le haut
        // de la boite : sans ca il flotte, et c'est ce qui fait « pose la ».
        lineHeight: entete ? '19px' : '18px',
        filter: 'saturate(.92)',
      }}>{entete ? '📌' : '📝'}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        {auteur && (
          <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{auteur} — </span>
        )}
        <span style={{ whiteSpace: 'pre-wrap' }}>{texte}</span>
      </span>
      {onEditer && (
        <button type="button" onClick={onEditer} aria-label="Modifier la note"
          style={{
            background: 'none', border: 'none', padding: 2, cursor: 'pointer', flexShrink: 0,
            color: 'var(--muted)', display: 'grid', placeItems: 'center', borderRadius: 4,
          }}>
          <Icon name="edit" size={13} color="currentColor" />
        </button>
      )}
    </div>
  );
}

function SaisieNote({ valeur, placeholder, aide, onChange, onValider, onAnnuler }: {
  valeur: string; placeholder: string; aide: string;
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
      <div style={{ fontSize: 11, color: 'var(--muted)' }}>
        {aide}
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

/**
 * Une pièce jointe : un marqueur, et son contenu à la demande.
 *
 * ⚠️ RIEN N'EST STOCKÉ. 14 % des messages en portent une ; les ré-héberger
 * remplirait le gigaoctet gratuit de stockage en neuf jours, et les URL de Meta
 * expirent de toute façon — une copie vieillirait sans qu'on le sache. On garde
 * le `mid` (et lui seul, pour ces messages-là) et on redemande au clic.
 *
 * ⚠️ Mesuré le 2026-09-04 : la plupart des « pièces jointes » d'un fil de lead
 * ne sont pas des médias, ce sont les DM à bouton que la plateforme envoie
 * elle-même. D'où le rendu en gabarit — titre puis bouton — plutôt qu'une
 * vignette qui n'existerait pas.
 */
/**
 * Le lecteur d'un message vocal.
 *
 * Le lecteur natif du navigateur fonctionne, mais il arrive avec sa propre
 * barre grise, son menu à trois points et son curseur de volume : dans une
 * bulle Instagram, il a l'air d'un corps étranger. Celui-ci reprend la forme
 * du vrai — bouton rond, barre de progression, durée — et surtout il hérite de
 * la couleur de sa bulle, donc il tient aussi bien sur le gris d'un message
 * reçu que sur le violet d'un message envoyé.
 *
 * ⚠️ La barre est un `input[type=range]`, pas un `div` cliquable. C'est ce qui
 * la rend déplaçable au clavier et annoncée par un lecteur d'écran ; un `div`
 * avec un `onClick` aurait la même apparence et ne serait utilisable qu'à la
 * souris.
 *
 * ⚠️ Une durée non finie n'est pas une anomalie : elle arrive tant que les
 * métadonnées ne sont pas chargées, et sur un flux sans longueur déclarée. On
 * affiche alors le temps écoulé seul, au lieu d'un « 0:00 / NaN ».
 */
function LecteurVocal({ src }: { src: string }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [joue, setJoue] = useState(false);
  const [pos, setPos] = useState(0);
  const [duree, setDuree] = useState(0);
  const connue = Number.isFinite(duree) && duree > 0;

  const mmss = (s: number) => {
    if (!Number.isFinite(s) || s < 0) return '0:00';
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  };

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, minWidth: 200 }}>
      <audio
        ref={audio} src={src} preload="metadata"
        onLoadedMetadata={e => setDuree(e.currentTarget.duration)}
        onTimeUpdate={e => setPos(e.currentTarget.currentTime)}
        onPlay={() => setJoue(true)}
        onPause={() => setJoue(false)}
        onEnded={() => { setJoue(false); setPos(0); }}
      />

      <button
        type="button"
        aria-label={joue ? 'Mettre le message vocal en pause' : 'Écouter le message vocal'}
        onClick={() => { const a = audio.current; if (!a) return; joue ? a.pause() : a.play(); }}
        style={{
          width: 30, height: 30, borderRadius: '50%', flexShrink: 0, cursor: 'pointer',
          // La pastille est en couleur courante à faible opacité : sur une bulle
          // grise elle est sombre, sur une bulle violette elle est claire. Une
          // couleur fixe aurait disparu sur l'une des deux.
          background: 'currentColor', opacity: .92, border: 'none',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}>
        {joue ? (
          // Deux barres, comme une vraie pause : un carré plein se lirait comme
          // un bouton « stop », qui ne veut pas dire la même chose.
          <span style={{ display: 'inline-flex', gap: 2.5 }}>
            <span style={{ display: 'block', width: 2.5, height: 10, background: 'var(--surface, #fff)' }} />
            <span style={{ display: 'block', width: 2.5, height: 10, background: 'var(--surface, #fff)' }} />
          </span>
        ) : (
          <span style={{
            display: 'block', width: 0, height: 0, marginLeft: 2,
            borderTop: '5px solid transparent', borderBottom: '5px solid transparent',
            borderLeft: '8px solid var(--surface, #fff)',
          }} />
        )}
      </button>

      <input
        type="range" min={0} max={connue ? duree : 0} step={0.01}
        value={Math.min(pos, connue ? duree : 0)}
        disabled={!connue}
        aria-label="Position dans le message vocal"
        onChange={e => {
          const a = audio.current; if (!a) return;
          a.currentTime = Number(e.target.value); setPos(a.currentTime);
        }}
        style={{
          flex: 1, minWidth: 80, height: 3, accentColor: 'currentColor',
          cursor: connue ? 'pointer' : 'default',
        }} />

      <span style={{ fontSize: 11.5, opacity: .7, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
        {connue ? `${mmss(pos)} / ${mmss(duree)}` : mmss(pos)}
      </span>
    </span>
  );
}

function PieceJointe(
  { messageId, type, vocalConserve }:
  { messageId: string; type: string; vocalConserve: boolean | null }
) {
  const [contenu, setContenu] = useState<any>(null);
  const [charge, setCharge] = useState(false);

  async function afficher() {
    if (charge) return;
    setCharge(true);
    try {
      const r = await fetch(`/api/coach/ig-piece-jointe?message_id=${messageId}`);
      setContenu(r.ok ? await r.json() : { forme: 'indisponible', motif: 'Chargement impossible' });
    } catch {
      setContenu({ forme: 'indisponible', motif: 'Chargement impossible' });
    }
  }

  if (contenu?.forme === 'template') {
    // Le gabarit tel qu'Instagram le montre : titre en gras, puis le bouton dans
    // un rectangle clair. C'est ce que le prospect a vu.
    return (
      <span style={{ display: 'block' }}>
        <span style={{ display: 'block', fontWeight: 700, marginBottom: 7 }}>{contenu.titre}</span>
        {contenu.bouton && (
          <span style={{
            display: 'block', background: '#fff', color: '#000', borderRadius: 14,
            padding: '9px 12px', margin: '0 12px', textAlign: 'center', fontWeight: 700,
          }}>{contenu.bouton}</span>
        )}
      </span>
    );
  }

  if (contenu?.forme === 'media' && contenu.type === 'image') {
    // ⚠️ `onError` n'est pas une precaution de style. Une URL qui repond 200 au
    // moment ou on la demande peut echouer au chargement — expiration, reseau,
    // politique de securite. Sans ce repli, l'ecran affiche l'icone de fichier
    // casse du navigateur, qui ressemble a un bug de la plateforme.
    return <img src={contenu.url} alt="Photo envoyée dans la conversation"
                loading="lazy" decoding="async"
                onError={() => setContenu({ forme: 'indisponible', motif: 'Cette photo n’est plus disponible' })}
                style={{ display: 'block', maxWidth: 260, maxHeight: 320, objectFit: 'cover', borderRadius: 12 }} />;
  }

  // L'image d'une story, servie par notre route comme les autres médias.
  if (contenu?.forme === 'story') {
    return <img src={contenu.url} alt="Story à laquelle ce message répond"
                loading="lazy" decoding="async"
                onError={() => setContenu({ forme: 'indisponible', motif: 'Cette story n’est plus disponible' })}
                style={{ display: 'block', maxWidth: 200, maxHeight: 300, objectFit: 'cover', borderRadius: 12 }} />;
  }

  // Un reel ou une publication partagée : Meta rend un lien PUBLIC, qui n'expire
  // pas. On l'ouvre chez Instagram au lieu de rapatrier une vidéo.
  if (contenu?.forme === 'partage') {
    return (
      <a href={contenu.lien} target="_blank" rel="noopener noreferrer"
         style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color: 'inherit' }}>
        <Icon name="external" size={14} color="currentColor" />
        <span style={{ textDecoration: 'underline' }}>Voir la publication partagée</span>
      </a>
    );
  }

  if (contenu?.forme === 'media') {
    // Les octets passent par notre route, donc la CSP reste fermée.
    //
    // Le vocal a son propre lecteur : c'est le seul média que la plateforme
    // stocke, donc le seul qui se lit toujours, et le lecteur natif détonnait
    // dans une bulle. La vidéo garde les commandes natives — elle est rare, et
    // elle apporte son plein écran, son volume et ses sous-titres.
    if (contenu.type === 'audio') return <LecteurVocal src={contenu.url} />;
    if (contenu.type === 'video') {
      return <video src={contenu.url} controls preload="none"
                    style={{ display: 'block', maxWidth: 260, borderRadius: 10 }} />;
    }
    return (
      <a href={contenu.url} target="_blank" rel="noopener noreferrer"
         style={{ color: 'inherit', textDecoration: 'underline' }}>Ouvrir le fichier</a>
    );
  }

  if (contenu?.forme === 'indisponible') {
    // On DIT que le contenu n'est plus rendu, plutot qu'un cadre casse : Meta
    // finit par ne plus servir les medias anciens, et c'est un cas normal.
    return (
      <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 3 }}>
        <MarqueurPieceJointe type={type} />
        <span style={{ fontSize: 12, opacity: .75 }}>{contenu.motif}</span>
      </span>
    );
  }

  // ── Un vocal dont le fichier n'est plus là ────────────────────────────────
  //
  // On ne propose PAS « Afficher ». Vérifié le 2026-09-04 par deux chemins
  // d'API indépendants, sur un vocal vieux d'une heure comme sur un vocal vieux
  // d'un jour : `is_unsupported: true`, `attachments: null`. Meta ne le
  // resservira pas, le clic ne peut donc mener qu'à une déception — et un
  // aller-retour pour rien.
  //
  // ⚠️ « Non récupérable » et pas « Erreur » : ce n'est pas une panne de la
  // plateforme. Le vocal est soit antérieur à la capture, soit sorti des
  // 30 jours de conservation. La distinction compte — la première formulation
  // clôt la question, la seconde envoie chercher un bug qui n'existe pas.
  if (vocalConserve === false) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, opacity: .7 }}
            title="Instagram ne ressert pas les messages vocaux. Celui-ci est antérieur à leur conservation, ou a dépassé 30 jours.">
        <MarqueurPieceJointe type={type} />
        <span style={{ fontSize: 12 }}>Non récupérable</span>
      </span>
    );
  }

  return (
    <button type="button" onClick={afficher} disabled={charge}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8, background: 'none',
        border: 'none', padding: 0, cursor: charge ? 'wait' : 'pointer',
        color: 'inherit', font: 'inherit', textAlign: 'left',
      }}>
      <MarqueurPieceJointe type={type} />
      <span style={{ fontSize: 12, opacity: .7, textDecoration: 'underline' }}>
        {charge ? 'Chargement…' : 'Afficher'}
      </span>
    </button>
  );
}
