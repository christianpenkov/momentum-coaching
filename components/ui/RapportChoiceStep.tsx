'use client';

import Icon from '@/components/ui/Icon';

/**
 * Une question du rapport de vente : un titre, une aide, une colonne de choix.
 *
 * Les écrans concernés ne sont PAS des copies l'un de l'autre — ce sont des
 * questions différentes. C'est leur habillage qui était rigoureusement identique,
 * recopié quatre fois.
 *
 * Ce qui justifie vraiment l'extraction : l'état SÉLECTIONNÉ. Revenir en arrière
 * dans le rapport doit montrer la réponse déjà donnée, sinon on retombe sur une
 * question qui semble vierge alors qu'on y a répondu. Écrit ici une fois, il vaut
 * pour toutes les questions.
 *
 * ── LA RÈGLE D'AFFICHAGE ────────────────────────────────────────────────────
 *
 * Le CADRE dit la sélection. Le TEXTE dit la catégorie. Deux canaux séparés,
 * donc jamais en concurrence :
 *
 *   • toute réponse choisie prend le MÊME cadre vert et la MÊME coche verte,
 *     quelle que soit sa catégorie ;
 *   • le libellé garde la couleur de sa catégorie, choisi ou non.
 *
 * C'est ce qui permet de garder l'ambre d'« Appel reporté » sans que la
 * sélection change de langage d'une réponse à l'autre.
 *
 * ── CE QUI A ÉTÉ CORRIGÉ, ET POURQUOI ÇA NE PEUT PLUS REVENIR ───────────────
 *
 * 1. DEUX BLEUS À L'ÉCRAN. Un ton `primary` peignait un bouton en bleu plein
 *    AVANT même qu'on réponde — presque toujours le premier de la liste — et la
 *    réponse choisie utilisait la même classe. Choisir autre chose donnait deux
 *    bleus, dont un qui ne voulait rien dire. Le ton `primary` n'existe plus :
 *    il est retiré du type, donc impossible à réintroduire par distraction.
 *    Suggérer la réponse attendue n'avait de toute façon pas d'objet sur un
 *    rapport qu'on remplit sur ses propres appels.
 *
 * 2. LA COCHE PAR-DESSUS LE LIBELLÉ. Le bouton était centré (`justify-content:
 *    center`) et la coche posée en `position:absolute; left:16px`. Sur un
 *    libellé long, le texte centré démarre justement vers 16 px : les deux se
 *    superposaient, d'autant plus que l'écran était étroit.
 *
 *    ⚠️ Deux tentatives ont échoué avant celle-ci, et pour la même raison de
 *    fond : tant que le texte est CENTRÉ, tout indicateur posé sur un côté finit
 *    par le heurter. Le mettre dans le flux décalait le libellé ; le mettre en
 *    absolu le recouvrait. La correction n'est donc pas un réglage de pixels
 *    mais un changement de structure — grille à deux colonnes, libellé aligné à
 *    gauche, colonne de 20 px RÉSERVÉE à droite pour la coche. La place est
 *    tenue même sans coche, donc le libellé ne bouge pas entre les deux états,
 *    et aucun libellé ne peut atteindre la colonne de la coche.
 *
 *    NE PAS repasser le libellé en centré, ni sortir la coche de sa colonne.
 *
 * 3. LES AUTRES RÉPONSES À MOITIÉ EFFACÉES. Les options non retenues étaient
 *    réduites à 45 % d'opacité. Sur cet écran on relit et on CORRIGE : il faut
 *    pouvoir lire les autres réponses pour en choisir une autre. Le cadre vert
 *    suffit à désigner la réponse retenue sans avoir à effacer les voisines.
 */

export interface RapportChoice<T extends string> {
  value: T;
  label: string;
  /**
   * La catégorie de la réponse — jamais sa mise en avant.
   *
   * `neutral` (défaut) : une réponse ordinaire.
   * `muted`   : une échappatoire (« date pas encore connue »). Discrète tant
   *             qu'on n'a pas répondu ; une fois choisie, elle EST la réponse et
   *             reprend une couleur pleine — l'atténuation ne servait qu'à ne
   *             pas attirer l'œil avant le choix.
   * `warning` : une bifurcation qui sort du parcours normal (appel reporté).
   *             Vraie catégorie, elle : l'ambre reste, choisie ou non.
   */
  tone?: 'neutral' | 'muted' | 'warning';
}

export default function RapportChoiceStep<T extends string>({
  question,
  hint,
  choices,
  value,
  onChoose,
  disabled,
  children,
}: {
  question: string;
  hint?: string;
  choices: RapportChoice<T>[];
  /** Réponse déjà donnée — encadrée en vert au retour en arrière. */
  value?: T | null;
  onChoose: (value: T) => void;
  disabled?: boolean;
  /** Inséré entre l'aide et les boutons (encadré de détails, avertissement…). */
  children?: React.ReactNode;
}) {
  return (
    <div>
      <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent)', marginBottom: 8 }}>{question}</div>
      {hint && (
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: children ? 8 : 24, lineHeight: 1.6 }}>{hint}</div>
      )}
      {children}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {choices.map(choice => {
          const selected = value != null && value === choice.value;
          const tone = choice.tone ?? 'neutral';

          // Couleur du libellé = sa catégorie. `muted` fait exception une fois
          // choisi : il ne s'agissait que de ne pas attirer l'œil avant la
          // réponse, et la réponse retenue doit se lire franchement.
          const couleurTexte =
            tone === 'warning' ? 'var(--amber-ink)'
              : tone === 'muted' && !selected ? 'var(--muted)'
                : 'var(--accent)';

          return (
            <button
              key={choice.value}
              type="button"
              // `btn-ghost` uniquement pour le survol, le curseur et l'appui —
              // toute la mise en page est reprise juste en dessous, car `.btn`
              // centre son contenu et interdit le retour à la ligne.
              className="btn-ghost"
              style={{
                width: '100%',
                display: 'grid',
                gridTemplateColumns: '1fr 20px',
                alignItems: 'center',
                gap: 12,
                padding: '15px 16px',
                fontSize: 14.5,
                fontWeight: selected ? 700 : 500,
                textAlign: 'left',
                // `.btn` impose `nowrap` : un libellé long déborderait au lieu
                // de passer à la ligne.
                whiteSpace: 'normal',
                lineHeight: 1.4,
                color: couleurTexte,
                border: selected
                  ? '1px solid var(--green)'
                  : tone === 'warning' ? '1px solid #f5d9a3' : '1px solid var(--border)',
                // Fond posé seulement sur la réponse retenue : laissé libre, il
                // garde le survol de `.btn-ghost` sur les autres (un fond en
                // style inline gagnerait sur le `:hover` de la feuille).
                ...(selected ? { background: 'var(--green-soft)' } : null),
              }}
              disabled={disabled}
              aria-pressed={selected}
              onClick={() => onChoose(choice.value)}
            >
              <span>{choice.label}</span>
              {/* Colonne toujours présente, coche ou pas : c'est elle qui
                  empêche le libellé de bouger entre les deux états. */}
              <span style={{ display: 'flex', justifyContent: 'flex-end', color: 'var(--green)' }}>
                {selected ? <Icon name="check" size={17} /> : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
