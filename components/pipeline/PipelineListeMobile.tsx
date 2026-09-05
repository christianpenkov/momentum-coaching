'use client';

import { useState, useEffect, useCallback, type Dispatch, type SetStateAction } from 'react';
import Icon from '@/components/ui/Icon';
// Les mêmes fonctions que l'ordinateur : une personne doit garder sa pastille
// d'une plateforme à l'autre. Une couleur dérivée deux fois donne deux couleurs.
import { avatarColor, avatarInitials, REPLI_PAR_DEFAUT, CLE_REPLI } from './PagePipeline';

/**
 * Le pipeline sur téléphone : une liste à sections repliables.
 *
 * ── CE QU'ELLE REMPLACE, ET POURQUOI ─────────────────────────────────────────
 *
 * L'ancienne vue était un entonnoir de barres : on tapait une étape, puis on
 * tapait une personne. DEUX taps pour atteindre qui que ce soit, et personne de
 * visible tant qu'on n'avait pas choisi une étape — l'écran montrait des
 * chiffres, pas des gens.
 *
 * Ici tout le monde est dans une seule liste. Un tap ouvre une fiche. Les
 * compteurs de l'entonnoir n'ont pas disparu : ils sont dans les en-têtes, où
 * ils ne coûtent aucune place.
 *
 * ── POURQUOI DES SECTIONS ET PAS UNE LISTE PLATE ─────────────────────────────
 *
 * Un lead magnet a déjà fait 412 réclamations. Une liste plate de 412 lignes se
 * construit d'un coup, fige le téléphone plusieurs secondes, et ne se parcourt
 * pas. Une section repliée ne construit RIEN — c'est ce qui tient l'écran à
 * l'échelle, pas un confort de lecture.
 *
 * C'est aussi le modèle de la vue liste de l'ordinateur : passer de l'un à
 * l'autre ne demande alors rien à réapprendre. Le repli est même partagé
 * (`CLE_REPLI`) — replier « Commentaire LM » sur un écran le replie sur l'autre,
 * parce que c'est la même décision.
 *
 * ── CE QUI N'EST PAS ICI ─────────────────────────────────────────────────────
 *
 * Pas de glisser-déposer : le glisser HTML5 ne se déclenche pas au tactile. On
 * déplace une carte depuis sa fiche, ou depuis l'ordinateur. Le kanban reste
 * strictement inchangé au-dessus de 767px.
 */

export interface CarteMobile {
  key: string;
  name: string;
  sub: string;
  date: string;
  /** La case où la carte se range : l'issue si le lead est classé, l'étape sinon. */
  stageKey: string;
  /** Le rendez-vous est passé et personne n'a rempli le rapport. */
  rapportEnRetard?: boolean;
  /** La prochaine relance est due. */
  relanceDue?: boolean;
  badge?: 'no_show' | 'rescheduled' | 'not_qualified' | 'to_recontact' | null;
  avatarUrl?: string | null;
  /** Présent quand un rapport peut être rempli depuis cette ligne. */
  callId?: string;
}

export interface CaseMobile {
  readonly key: string;
  readonly label: string;
  readonly color: string;
  readonly lightBg: string;
}

/**
 * Combien de lignes on construit d'un coup dans une section dépliée.
 *
 * Ce n'est pas une pagination de confort : à 412 fiches, tout construire d'un
 * coup fige le téléphone. 40 remplit deux écrans et demi, donc on ne voit jamais
 * le bouton avant d'avoir vraiment fait défiler.
 */
const PAS_AFFICHAGE = 40;

function LigneLead({ carte, onOuvrir, onRapport }: {
  carte: CarteMobile;
  onOuvrir: () => void;
  onRapport?: () => void;
}) {
  // Une seule pastille d'état, la plus urgente. Deux pastilles sur une ligne de
  // 56px ne laissent plus la place au pseudo, qui est l'information principale.
  const etat = carte.rapportEnRetard
    ? { texte: 'À remplir', fond: 'var(--red-soft)', encre: '#b04227', bord: '#e6bcae' }
    : carte.relanceDue
      ? { texte: 'Relance', fond: 'var(--amber-soft)', encre: '#8f6415', bord: '#ecd9ad' }
      : carte.badge === 'rescheduled'
        ? { texte: 'Reporté', fond: 'var(--amber-soft)', encre: '#8f6415', bord: '#ecd9ad' }
        : null;

  // Le rapport se remplit surtout depuis le téléphone (voir PRODUCT.md) : la
  // ligne porte donc un vrai bouton, pas seulement une pastille informative.
  // Il est séparé par un trait et fait 44px de large — deux cibles voisines sans
  // séparation visible, c'est là qu'une liste mobile devient imprécise au doigt.
  const avecAction = !!(carte.rapportEnRetard && carte.callId && onRapport);

  return (
    <div style={{ display: 'flex', alignItems: 'stretch', background: 'var(--surface)' }}>
      <button type="button" onClick={onOuvrir} className="plm-ligne" style={{ border: 'none', borderBottom: '1px solid var(--border-soft)' }}>
        {carte.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={carte.avatarUrl} alt="" loading="lazy" decoding="async" className="plm-avatar" />
        ) : (
          <span className="plm-avatar" style={{ background: avatarColor(carte.name) }} aria-hidden="true">
            {avatarInitials(carte.name)}
          </span>
        )}
        <span className="plm-qui">
          <span className="plm-nom">{carte.name}</span>
          <span className="plm-meta">{carte.sub}</span>
        </span>
        <span className="plm-droite">
          {etat && !avecAction && (
            <span className="plm-pastille-etat" style={{ background: etat.fond, color: etat.encre, border: `1px solid ${etat.bord}` }}>
              {etat.texte}
            </span>
          )}
          <span className="plm-age">{carte.date}</span>
          <span className="plm-chev" aria-hidden="true"><Icon name="chevR" size={14} /></span>
        </span>
      </button>

      {avecAction && (
        <button
          type="button"
          onClick={onRapport}
          className="plm-action"
          style={{ borderBottom: '1px solid var(--border-soft)' }}
          aria-label={`Remplir le rapport de ${carte.name}`}
        >
          <span className="plm-pastille-etat" style={{ background: 'var(--amber-soft)', color: '#8f6415', border: '1px solid #ecd9ad' }}>
            Remplir
          </span>
        </button>
      )}
    </div>
  );
}

/**
 * Une section : son en-tete collante, et ses lignes quand elle est ouverte.
 *
 * ⚠️ DECLAREE AU NIVEAU DU MODULE, jamais dans le corps du composant parent.
 * Un composant declare a l'interieur d'un autre est un TYPE neuf a chaque
 * rendu : React ne peut pas le reconcilier, il demonte et remonte tout le
 * sous-arbre. Consequences mesurees ici — l'animation d'ouverture rejouait a
 * chaque changement d'etat sans rapport, et replier une section reconstruisait
 * les lignes de toutes les autres.
 *
 * Le symptome qui l'a revele : apres un clic, le noeud de l'en-tete qu'on tenait
 * en main etait DETACHE du document, et portait encore l'ancien `aria-expanded`.
 */
function Section({ cas, liste, repliees, basculer, limites, setLimites, onCardClick, onRapportClick }: {
  cas: CaseMobile;
  liste: CarteMobile[];
  repliees: Set<string>;
  basculer: (cle: string) => void;
  limites: Record<string, number>;
  setLimites: Dispatch<SetStateAction<Record<string, number>>>;
  onCardClick?: (key: string) => void;
  onRapportClick?: (key: string) => void;
}) {
  const vide = liste.length === 0;
  const ouverte = !vide && !repliees.has(cas.key);
  const limite = limites[cas.key] ?? PAS_AFFICHAGE;
  const visibles = liste.slice(0, limite);
  const reste = liste.length - visibles.length;
  const idCorps = `plm-corps-${cas.key}`;

  // ⚠️ CHAQUE SECTION DANS SON PROPRE BLOC, et ce n'est pas cosmetique.
  // Un element `sticky` colle a l'interieur de SON PARENT. Toutes les
  // en-tetes en freres directs partagent le meme parent : elles se collent
  // donc toutes a 0 en meme temps et s'empilent les unes sur les autres.
  // Mesure a 390px, defilement 260 : les six en-tetes rapportaient `top: 0`.
  // Le defaut ne se voit sur aucune capture prise en haut de page.
  return (
    <div className="plm-section">
      <button
        type="button"
        className="plm-sec"
        onClick={() => !vide && basculer(cas.key)}
        disabled={vide}
        aria-expanded={ouverte}
        aria-controls={idCorps}
      >
        <span className="plm-sec-pastille" style={{ background: vide ? 'var(--border)' : cas.color }} />
        <span className="plm-sec-label" style={{ color: vide ? 'var(--muted)' : 'var(--ink)' }}>{cas.label}</span>
        <span className="plm-sec-compte" style={{ color: vide ? 'var(--faint)' : 'var(--ink-2)' }}>{liste.length}</span>
        {/* Une section vide n'a pas de chevron : il promettrait un contenu. */}
        {!vide && (
          <span className="plm-sec-chev" aria-hidden="true"><Icon name="chevR" size={14} /></span>
        )}
      </button>

      {ouverte && (
        <div id={idCorps} className="plm-corps">
          {visibles.map(c => (
            <LigneLead
              key={c.key}
              carte={c}
              onOuvrir={() => onCardClick?.(c.key)}
              onRapport={onRapportClick ? () => onRapportClick(c.key) : undefined}
            />
          ))}
          {reste > 0 && (
            <button
              type="button"
              className="plm-plus"
              onClick={() => setLimites(p => ({ ...p, [cas.key]: limite + PAS_AFFICHAGE }))}
            >
              Afficher {Math.min(reste, PAS_AFFICHAGE)} de plus · {reste} restants
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function PipelineListeMobile({
  cards, stages, issues = [], onCardClick, onRapportClick,
}: {
  cards: CarteMobile[];
  stages: readonly CaseMobile[];
  issues?: readonly CaseMobile[];
  onCardClick?: (key: string) => void;
  /** Absent = la liste reste en consultation. Présent = « Remplir » agit. */
  onRapportClick?: (key: string) => void;
}) {
  // ── LE REPLI ────────────────────────────────────────────────────────────────
  // Même valeur de départ que l'ordinateur, puis on relit le choix conservé.
  // La lecture ne peut pas se faire dans l'initialiseur : le serveur n'a pas de
  // localStorage et rendrait un écran différent de celui du navigateur.
  const [repliees, setRepliees] = useState<Set<string>>(new Set(REPLI_PAR_DEFAUT));
  useEffect(() => {
    try {
      const brut = window.localStorage.getItem(CLE_REPLI);
      if (brut) {
        const liste = JSON.parse(brut);
        if (Array.isArray(liste)) setRepliees(new Set(liste.filter((v): v is string => typeof v === 'string')));
      }
    } catch { /* stockage indisponible : on garde le défaut, jamais d'écran cassé */ }
  }, []);

  const basculer = useCallback((cle: string) => {
    setRepliees(prev => {
      const n = new Set(prev);
      if (n.has(cle)) n.delete(cle); else n.add(cle);
      try { window.localStorage.setItem(CLE_REPLI, JSON.stringify([...n])); } catch { /* sans effet */ }
      return n;
    });
  }, []);

  // Combien de lignes sont construites, par section.
  const [limites, setLimites] = useState<Record<string, number>>({});

  const parCase = (c: CaseMobile) => cards.filter(x => x.stageKey === c.key);


  return (
    <div className="plm-liste">
      {stages.map(s => <Section key={s.key} cas={s} liste={parCase(s)} repliees={repliees} basculer={basculer} limites={limites} setLimites={setLimites} onCardClick={onCardClick} onRapportClick={onRapportClick} />)}

      {/* Les issues gardent leur place même vides : elles se rempliront, et une
          section qui apparaît un matin décale tout ce qui la suit. Elles sont
          sous un titre séparé parce qu'aucune n'est « après » une étape — ce
          sont des résultats, pas une progression. */}
      {issues.length > 0 && (
        <>
          <div className="plm-titre-issues">Issues</div>
          {issues.map(i => <Section key={i.key} cas={i} liste={parCase(i)} repliees={repliees} basculer={basculer} limites={limites} setLimites={setLimites} onCardClick={onCardClick} onRapportClick={onRapportClick} />)}
        </>
      )}

      {cards.length === 0 && (
        <div className="plm-vide" style={{ textAlign: 'center', padding: '40px 16px' }}>
          Aucun lead pour le moment.
        </div>
      )}
    </div>
  );
}
