'use client';

import type { ReactNode } from 'react';
import Icon, { type IconName } from '@/components/ui/Icon';

/**
 * Les primitives de rendu d'un fil Instagram, partagées.
 *
 * Extrait de `components/liens/PageLiens.tsx` le 2026-09-04, sans changer un
 * pixel : mêmes valeurs, mêmes commentaires, mêmes pièges consignés. PageLiens
 * les importe désormais au lieu de les définir, et l'écran des conversations du
 * coach s'en sert aussi.
 *
 * ⚠️ Le SENS est inversé entre les deux écrans, et s'y tromper produit une
 * maquette qui a l'air juste et raconte l'inverse :
 *
 *   PageLiens (aperçu de la séquence)  — bulle grise = LE COACH, dégradé = le prospect
 *   Conversations (fil réel de l'élève) — bulle grise = LE PROSPECT, dégradé = l'élève
 *
 * Ce ne sont que des primitives gauche/droite : `IgRecu` dessine à gauche en
 * gris, `IgEnvoye` à droite en dégradé. C'est l'appelant qui décide qui est qui.
 */

/**
 * Cotes relevées sur la capture réelle fournie par le client (référentiel 390pt).
 * Ce sont les couleurs de la MARQUE Instagram, pas celles de Momentum : elles
 * restent en dur, les tokens du design system n'ont rien à y faire.
 */
export const IG = {
  bulle: '#F0F0F2',      // bulle reçue, gris très légèrement bleuté
  gris: '#8E8E93',       // pseudo, horodatage, « appuyez deux fois »
  violet1: '#C427E8',    // dégradé sortant, extrémité magenta
  violet2: '#7A3FE4',    // dégradé sortant, extrémité violet-bleuté
  appareil: '#5A4BE8',   // rond du bouton appareil photo, barre de saisie
} as const;

/** Avatar avec l'anneau story — dégradé jaune → rose → violet. */
export function IgAvatar({ url, taille }: { url: string | null; taille: number }) {
  return (
    <span style={{
      width: taille, height: taille, borderRadius: '50%', flexShrink: 0, boxSizing: 'border-box',
      background: 'conic-gradient(from 200deg,#F9CE34,#EE2A7B,#6228D7,#F9CE34)', padding: 2,
    }}>
      <span style={{
        display: 'block', width: '100%', height: '100%', borderRadius: '50%', overflow: 'hidden',
        background: '#d8cfc4', border: '1.5px solid #fff', boxSizing: 'border-box',
      }}>
        {url && <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
      </span>
    </span>
  );
}

/**
 * Avatar SANS anneau de story, pour un fil réel.
 *
 * ⚠️ Instagram ne dessine l'anneau que si la personne a une story active, et
 * nous ne le savons pas. Le dessiner sur tout le monde serait une donnée
 * inventée — l'interdit premier du projet. `IgAvatar` garde l'anneau parce qu'il
 * sert à une MAQUETTE de séquence, pas à un fil réel.
 *
 * Repli quand il n'y a pas de photo : initiales sur une couleur stable, dérivée
 * du nom et non de la position dans la liste — cohérent avec `components/ui/Avatar.tsx`.
 */
export function IgAvatarSimple({ url, pseudo, taille }: {
  url: string | null; pseudo: string | null; taille: number;
}) {
  const initiales = (pseudo || '?').replace(/^@/, '').slice(0, 2).toUpperCase();
  return (
    <span style={{
      width: taille, height: taille, borderRadius: '50%', flexShrink: 0, overflow: 'hidden',
      background: url ? '#d8cfc4' : couleurStable(pseudo || ''),
      display: 'grid', placeItems: 'center',
      color: '#fff', fontWeight: 600, fontSize: Math.max(9, Math.round(taille * 0.36)),
    }}>
      {url
        ? <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : initiales}
    </span>
  );
}

// Même palette et même hachage que components/ui/Avatar.tsx : la couleur d'une
// personne doit être la MÊME partout, sinon la pastille cesse d'aider à la
// reconnaître.
const COULEURS = ['#7C3AED', '#2563EB', '#059669', '#D97706', '#EA580C', '#DB2777', '#0891B2', '#65A30D'];
function couleurStable(graine: string): string {
  const g = graine.trim().toLowerCase();
  let h = 0;
  for (let i = 0; i < g.length; i++) h = (h * 31 + g.charCodeAt(i)) & 0xffffffff;
  return COULEURS[Math.abs(h) % COULEURS.length];
}

/**
 * Une bulle À GAUCHE, grise.
 *
 * L'avatar n'apparaît que sur la DERNIÈRE bulle d'un groupe, aligné sur le bas —
 * c'est ce que fait Instagram, et l'oublier trahit immédiatement la maquette.
 */
export function IgRecu({ children, avatar, avatarUrl, hint, sc, avatarNode }: {
  children: ReactNode; avatar: boolean; avatarUrl?: string | null; hint?: boolean; sc: number;
  /** Remplace l'avatar par défaut — utilisé par le fil réel, qui n'a pas d'anneau. */
  avatarNode?: ReactNode;
}) {
  const a = Math.round(34 * sc);
  // flexShrink:0 — sans lui, le conteneur du fil comprime les bulles au lieu de les
  // laisser déborder, et le fil ne défile jamais (mesuré : 515px de contenu écrasés
  // dans 410px, scrollHeight bloqué à la hauteur du conteneur).
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: Math.round(7 * sc), maxWidth: '84%', flexShrink: 0 }}>
      {avatar
        ? (avatarNode ?? <IgAvatar url={avatarUrl ?? null} taille={a} />)
        : <span style={{ width: a, flexShrink: 0 }} />}
      <div>
        <div style={{
          background: IG.bulle, borderRadius: Math.round(20 * sc),
          padding: `${Math.round(9 * sc)}px ${Math.round(14 * sc)}px`,
          fontSize: +(15 * sc).toFixed(1), lineHeight: 1.34, color: '#000',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>{children}</div>
        {hint && (
          <div style={{ fontSize: +(13 * sc).toFixed(1), color: IG.gris, margin: `${Math.round(4 * sc)}px 0 0 ${Math.round(5 * sc)}px` }}>
            Appuyez deux fois pour ❤️
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Gabarit à bouton : première ligne en gras, puis un rectangle blanc.
 * C'est ce rectangle qui masque l'URL — d'où son rayon plus faible que la bulle,
 * et sa marge intérieure : il ne touche pas les bords.
 */
export function IgTemplate({ texte, bouton, avatar, avatarUrl, sc, hint }: {
  texte: string; bouton: string; avatar: boolean; avatarUrl: string | null; sc: number; hint?: boolean;
}) {
  return (
    <IgRecu avatar={avatar} avatarUrl={avatarUrl} sc={sc} hint={hint}>
      <div style={{ fontWeight: 700, marginBottom: Math.round(7 * sc) }}>{texte}</div>
      <div style={{
        background: '#fff', borderRadius: Math.round(14 * sc),
        padding: `${Math.round(9 * sc)}px ${Math.round(12 * sc)}px`,
        margin: `0 ${Math.round(12 * sc)}px`,
        textAlign: 'center', fontWeight: 700, fontSize: +(15 * sc).toFixed(1),
      }}>{bouton}</div>
    </IgRecu>
  );
}

/** Une bulle À DROITE — dégradé diagonal, pas un aplat. */
export function IgEnvoye({ texte, sc, children }: { texte?: string; sc: number; children?: ReactNode }) {
  return (
    <div style={{
      alignSelf: 'flex-end', maxWidth: '80%', flexShrink: 0,
      background: `linear-gradient(135deg, ${IG.violet1}, ${IG.violet2})`,
      borderRadius: Math.round(20 * sc),
      padding: `${Math.round(9 * sc)}px ${Math.round(14 * sc)}px`,
      fontSize: +(15 * sc).toFixed(1), lineHeight: 1.34, color: '#fff', fontWeight: 600,
      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
    }}>{children ?? texte}</div>
  );
}

/**
 * Le marqueur d'une pièce jointe, à la place du média.
 *
 * ⚠️ On ne stocke JAMAIS le média : 14 % des messages en portent un, et
 * ré-héberger remplirait le gigaoctet gratuit de stockage en neuf jours. L'URL
 * fraîche est redemandée à Meta au moment où quelqu'un clique.
 *
 * ⚠️ Une ICÔNE, jamais un emoji. Un emoji est rendu par la police emoji du
 * système : sa forme change d'un appareil à l'autre, il ne suit ni la couleur ni
 * l'épaisseur de trait du reste de l'interface, et certains glyphes de la table
 * dingbat (✎, ✻, ⧉) s'affichent comme des symboles méconnaissables. Le projet a
 * déjà son jeu d'icônes vectorielles — on s'en sert.
 */
export const PIECE_JOINTE: Record<string, { icone: IconName; libelle: string }> = {
  image:       { icone: 'camera',   libelle: 'Photo' },
  video:       { icone: 'video',    libelle: 'Vidéo' },
  audio:       { icone: 'mic',      libelle: 'Message vocal' },
  file:        { icone: 'file',     libelle: 'Fichier' },
  share:       { icone: 'external', libelle: 'Publication partagée' },
  story_reply: { icone: 'reply',    libelle: 'Réponse à une story' },
  autre:       { icone: 'file',     libelle: 'Pièce jointe' },
};

/** Le marqueur rendu, aligné sur la ligne de base du texte de la bulle. */
export function MarqueurPieceJointe({ type, sortant }: { type: string; sortant?: boolean }) {
  const pj = PIECE_JOINTE[type] ?? PIECE_JOINTE.autre;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
      <Icon name={pj.icone} size={15} color="currentColor" />
      {pj.libelle}
    </span>
  );
}

/** Le libellé seul, pour les extraits de liste où une icône serait du bruit. */
export function libellePieceJointe(type: string | null | undefined): string {
  if (!type) return '';
  return (PIECE_JOINTE[type] ?? PIECE_JOINTE.autre).libelle;
}
