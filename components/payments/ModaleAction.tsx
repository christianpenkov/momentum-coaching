'use client';

import { useEffect, useRef, useState } from 'react';
import Icon from '@/components/ui/Icon';
import Portal from './Portal';
import { useIsMobile } from '@/lib/useIsMobile';
import { useHauteurClavier } from '@/lib/useHauteurClavier';
import DebugClavier from './DebugClavier'; // ⚠️ TEMPORAIRE — diagnostic clavier iOS

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
  const { hauteur: clavier, dessus, visible, ouvert } = useHauteurClavier();

  // ── Remonter le champ, sur le FOCUS et non sur le clavier ─────────────────
  // Pourquoi le champ montant remontait tout seul et pas la raison de clôture :
  // le premier porte `autoFocus`, donc le navigateur le place lui-même à
  // l'ouverture. Le second est focalisé par un TAP, dans une feuille déjà ouverte
  // et longue — et rien ne le remontait.
  //
  // Une première version écoutait le changement de hauteur du clavier. Elle
  // ratait deux cas : toucher un champ alors que le clavier est DÉJÀ ouvert
  // (passer d'un champ à l'autre ne change aucune hauteur), et le champ placé
  // bas dans un contenu long, où le seul rétrécissement ne suffit pas.
  //
  // Écouter `focusin` répond exactement à la question posée — « quel champ
  // l'utilisateur vient-il de toucher ? » — au lieu de la déduire d'un effet de
  // bord. Et `clavier` reste dans les dépendances : la feuille change de taille
  // juste après le focus, il faut refaire le geste une fois la nouvelle hauteur
  // posée, sinon on aurait fait défiler dans l'ancienne.
  const feuilleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const feuille = feuilleRef.current;
    if (!feuille) return;

    function remonter() {
      const actif = document.activeElement;
      if (!(actif instanceof HTMLElement)) return;
      if (actif.tagName !== 'INPUT' && actif.tagName !== 'TEXTAREA') return;
      // Deux passages : tout de suite pour le cas où la hauteur ne bouge plus,
      // et après l'animation du clavier, qui déplace le sol sous nos pieds.
      actif.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setTimeout(() => actif.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300);
    }

    feuille.addEventListener('focusin', remonter);
    if (ouvert) remonter();
    return () => feuille.removeEventListener('focusin', remonter);
    // `clavier` reste dans les dépendances alors que la décision vient de
    // `ouvert` : la feuille se redimensionne APRÈS le focus, quand le clavier
    // finit de monter. Sans cette seconde passe, on aurait fait défiler dans
    // l'ancienne hauteur.
  }, [ouvert, clavier]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !bloque) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, bloque]);

  return (
    <Portal>
      {isMobile && <DebugClavier cible={feuilleRef} />}{/* ⚠️ TEMPORAIRE */}
      <div onClick={() => !bloque && onClose()}
        style={{ position: 'fixed', inset: 0, background: 'rgba(26,24,21,.42)', zIndex: 10008 }} />
      {/* ── La feuille se décolle du clavier ──────────────────────────────
          Ancrée à `bottom: 0`, elle se colle au bas du viewport de mise en page,
          que le clavier recouvre : le champ qu'on vient de toucher et les
          boutons de validation passaient dessous. Elle se pose donc sur le
          clavier, et se contente de la hauteur qui reste. */}
      <div ref={feuilleRef} style={isMobile ? {
        position: 'fixed', left: 0, right: 0, zIndex: 10009,
        // Clavier fermé : ancrée en bas. Ouvert : la position vient du bloc
        // conditionnel plus bas, qui pose `top` et `height` sur la zone visible.
        ...(ouvert ? null : { bottom: 0 }),
        // ── Clavier ouvert : PLEIN ÉCRAN, comme le rapport de vente ──────────
        // Une hauteur MAXIMALE ne suffisait pas. La feuille restait ancrée en bas
        // et se contentait de la hauteur de son contenu : sur un écran long, le
        // champ de saisie restait sous la ligne de flottaison, et le défilement
        // n'avait pas assez de course pour l'en sortir.
        //
        // `top: 0` + `bottom: clavier` donne EXACTEMENT la zone visible, sans
        // dépendre d'une unité de viewport — ni `vh`, ni `dvh`, dont iOS ne
        // s'accorde pas sur le sens quand le clavier est là. La feuille occupe
        // tout, le contenu défile dedans, et remonter le champ devient possible.
        //
        // C'est ce que fait `ModalShell` en `fullScreen` sur le rapport de vente,
        // et c'est le seul montage éprouvé sur ce projet.
        background: 'var(--surface)', boxShadow: 'var(--shadow-modal)',
        // Plein écran : plus de coins arrondis, il n'y a plus rien derrière.
        borderTopLeftRadius: ouvert ? 0 : 18,
        borderTopRightRadius: ouvert ? 0 : 18,
        // ⚠️ `top: dessus`, pas `top: 0`. iOS DÉCALE la zone visible quand le
        // clavier s'ouvre, en plus de la rétrécir : à `top: 0` la feuille se
        // posait au haut du viewport de mise en page, donc au-dessus de
        // l'écran — son titre était coupé. `height: visible` la borne
        // exactement à ce qui reste, sans passer par `vh` ni `dvh`.
        ...(ouvert
          ? { top: dessus, height: visible }
          : { maxHeight: '90vh' }),
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

        {/* ── Le pied s'efface pendant la saisie ───────────────────────────
            iOS pose sa propre barre au-dessus du clavier (« Préremplir le
            contact », les suggestions), et `visualViewport.height` ne la compte
            pas : elle recouvrait donc les deux boutons, qui se retrouvaient à
            moitié lisibles au moment le plus mauvais.

            Les cacher pendant la frappe est aussi le bon geste en soi : on
            n'appuie pas sur « Clôturer la vente » en même temps qu'on écrit la
            raison. Ils reviennent dès que le clavier se ferme, et la place gagnée
            va au champ. */}
        {pied && !ouvert && (
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
 * La rondelle qui tourne — le seul signe qu'un bouton travaille.
 *
 * `@keyframes spin` vit déjà dans globals.css, on ne le redéfinit pas.
 */
export function Rondelle({ couleur = '#fff' }: { couleur?: string }) {
  return (
    <span aria-hidden style={{
      width: 12, height: 12, borderRadius: '50%', flexShrink: 0,
      border: `2px solid ${couleur === '#fff' ? 'rgba(255,255,255,.35)' : 'var(--border)'}`,
      borderTopColor: couleur,
      animation: 'spin .6s linear infinite',
    }} />
  );
}

/**
 * Le bouton qui ferme un écran de résultat.
 *
 * ── Pourquoi un composant et pas dix boutons ───────────────────────────────
 * Fermer déclenche le rechargement de la fiche : environ une seconde pendant
 * laquelle, sans repère, l'écran semble ne rien faire — et on reclique. Dix
 * boutons appelaient `onDone` sans le moindre retour ; les corriger un par un
 * aurait garanti que le onzième l'oublie.
 *
 * L'état vit ICI et nulle part ailleurs : un écran de résultat n'a rien d'autre
 * à savoir que « c'est fini », et lui faire porter un drapeau de fermeture
 * mélangerait deux responsabilités.
 */
export function BoutonFin({ onDone, children = 'Terminé', discret = false }: {
  onDone: () => void;
  children?: React.ReactNode;
  discret?: boolean;
}) {
  const [ferme, setFerme] = useState(false);
  return (
    <button
      className={discret ? 'btn-ghost' : 'btn-primary-brand'}
      style={{ fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 8 }}
      disabled={ferme}
      onClick={() => { setFerme(true); onDone(); }}>
      {ferme && <Rondelle couleur={discret ? 'var(--ink-2)' : '#fff'} />}
      {ferme ? 'Un instant…' : children}
    </button>
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

/**
 * Le champ de saisie d'un montant.
 *
 * ── Pourquoi c'est un composant et pas trois lignes de style ───────────────
 * Le `€` vit à l'intérieur de l'encadré mais en dehors de l'`<input>`. Le focus
 * du navigateur, lui, ne connaît que l'input : le liseré s'arrêtait donc avant
 * le symbole, et l'encadré paraissait coupé en deux au moment précis où on tape
 * de l'argent. `:focus-within` sur l'enveloppe règle ça — mais il n'existe pas
 * en style en ligne, d'où l'état local.
 */
export function ChampMontant({ valeur, onChange, autoFocus, largeur = 200 }: {
  valeur: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  largeur?: number;
}) {
  const [actif, setActif] = useState(false);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', width: largeur, background: 'var(--surface)',
      border: `1px solid ${actif ? 'var(--accent-brand)' : 'var(--border)'}`,
      boxShadow: actif ? '0 0 0 3px color-mix(in srgb, var(--accent-brand) 22%, transparent)' : undefined,
      borderRadius: 8, padding: '9px 14px',
      transition: 'border-color .12s, box-shadow .12s',
    }}>
      <input
        value={valeur}
        onChange={e => onChange(e.target.value.replace(/[^\d.,]/g, ''))}
        onFocus={() => setActif(true)}
        onBlur={() => setActif(false)}
        inputMode="decimal"
        autoFocus={autoFocus}
        // `champ-nu` : l'anneau de focus est dessiné par le conteneur ci-dessus,
        // qui englobe le « € ». Sans elle, la règle globale en trace un second
        // autour du seul input — plus petit, et s'arrêtant avant le symbole.
        className="tabular champ-nu"
        aria-label="Montant en euros"
        style={{
          border: 'none', outline: 'none', background: 'transparent',
          fontSize: 21, fontWeight: 700, letterSpacing: '-0.4px',
          width: '100%', minWidth: 0, fontFamily: 'inherit', color: 'var(--ink)',
        }} />
      <span style={{ fontSize: 15, color: 'var(--faint)', flexShrink: 0 }}>€</span>
    </div>
  );
}

/**
 * L'échéancier avant / après, ligne par ligne.
 *
 * ── Ce que « les échéances seront recalculées » ne disait pas ──────────────
 * Lesquelles, pour combien, et à quelles dates. Un écran qui annonce un
 * recalcul sans le montrer demande de faire confiance sur le seul point où
 * personne ne veut faire confiance — et rend impossible de repérer une faute de
 * frappe avant de valider.
 *
 * Trois cas de ligne, et ils se distinguent à l'œil :
 *  · une échéance qui change      → ancien montant barré, nouveau à droite
 *  · une échéance qui apparaît    → « nouvelle », sans montant barré
 *  · une échéance qui disparaît   → tout en gris barré, « supprimée »
 */
export function ApercuEcheances({ avant, apres, total, rythmeChange }: {
  avant: Array<{ rang: number; date: string | null; montant: number }>;
  apres: Array<{ rang: number; date: string | null; montant: number }>;
  /** Nombre total d'échéances de la vente après modification, pour le « x/N ». */
  total: number;
  /** Le rythme change : les dates d'après ne sont pas encore connues. */
  rythmeChange?: boolean;
}) {
  const rangs = [...new Set([...avant.map(e => e.rang), ...apres.map(e => e.rang)])].sort((a, b) => a - b);
  if (rangs.length === 0) return null;

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
      {rangs.map((rang, i) => {
        const a = avant.find(e => e.rang === rang);
        const b = apres.find(e => e.rang === rang);
        const supprimee = !b;
        const nouvelle = !a;
        const identique = a && b && Math.abs(a.montant - b.montant) < 0.005;

        return (
          <div key={rang} style={{
            display: 'flex', alignItems: 'baseline', gap: 10, padding: '9px 13px',
            borderTop: i === 0 ? 'none' : '1px solid var(--border-soft)',
            background: nouvelle ? 'var(--green-soft)' : supprimee ? 'var(--surface-2)' : undefined,
          }}>
            <span className="tabular" style={{
              fontSize: 11.5, color: 'var(--muted)', flexShrink: 0, width: 34,
            }}>{rang}/{total}</span>

            <span style={{
              flex: 1, minWidth: 0, fontSize: 12.5,
              color: supprimee ? 'var(--faint)' : 'var(--ink-2)',
            }}>
              {supprimee
                ? <span style={{ textDecoration: 'line-through' }}>{jourDe(a!.date)}</span>
                : rythmeChange && !nouvelle
                  ? <>{jourDe(a!.date)} <span style={{ color: 'var(--faint)' }}>→ date recalculée</span></>
                  : jourDe(b!.date)}
              {nouvelle && <span style={{ color: 'var(--green)', marginLeft: 7, fontSize: 11.5 }}>nouvelle</span>}
              {supprimee && <span style={{ marginLeft: 7, fontSize: 11.5 }}>supprimée</span>}
            </span>

            <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexShrink: 0 }}>
              {a && !identique && (
                <span className="tabular" style={{ fontSize: 12, color: 'var(--faint)', textDecoration: 'line-through' }}>
                  {eur(a.montant)}
                </span>
              )}
              {b && (
                <span className="tabular" style={{
                  fontSize: 13.5, fontWeight: identique ? 500 : 700,
                  color: identique ? 'var(--muted)' : 'var(--ink)',
                }}>{eur(b.montant)}</span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const eur = (n: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 }).format(n);

const jourDe = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
      // « date à définir » sonnait comme un oubli à réparer. En prélèvement
      // automatique non démarré, la date n'est pas oubliée : elle dépend du jour
      // où le client règle le lien, et personne ne peut la fixer d'avance.
      : 'au rythme du premier paiement';

export const champStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 8,
  fontSize: 13, background: 'var(--surface)', color: 'var(--ink)', fontFamily: 'inherit', outline: 'none',
};
