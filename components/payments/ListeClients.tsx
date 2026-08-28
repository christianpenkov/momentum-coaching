'use client';

import Icon from '@/components/ui/Icon';
import Avatar, { getInitials } from '@/components/ui/Avatar';
import { useIsMobile } from '@/lib/useIsMobile';
import { ETATS, type EtatVente } from './etats';
import { Barre } from './FicheClient';
import { fmtEurExact, fmtDateLong, type PersonRow, type DealRow } from './types';

/**
 * Une ligne par PERSONNE, et non par vente.
 *
 * Un client qui achète deux fois apparaissait deux fois : on croyait à deux
 * clients, et rien ne disait ce qu'il devait au total. La ligne porte donc les
 * totaux de toutes ses ventes, et l'état le plus urgent d'entre elles — une
 * vente contestée ne doit pas disparaître derrière une vente soldée plus
 * récente.
 */

export default function ListeClients({ people, deals, onOuvrir, isCoach }: {
  people: PersonRow[];
  deals: DealRow[];
  onOuvrir: (cle: string) => void;
  isCoach?: boolean;
}) {
  const isMobile = useIsMobile();

  if (people.length === 0) {
    return (
      <div style={{ padding: '32px 0', textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>
        Aucun client ne correspond à ce filtre.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? 8 : 0 }}>
      {people.map(p => (
        <LigneClient key={p.key} person={p} deals={deals} isMobile={isMobile}
          isCoach={isCoach} onOuvrir={() => onOuvrir(p.key)} />
      ))}
    </div>
  );
}

function LigneClient({ person, deals, isMobile, isCoach, onOuvrir }: {
  person: PersonRow;
  deals: DealRow[];
  isMobile: boolean;
  isCoach?: boolean;
  onOuvrir: () => void;
}) {
  const e = ETATS[(person.status as EtatVente)] ?? ETATS.open;
  const pct = person.contracted > 0
    ? Math.min(100, Math.round((person.collected / person.contracted) * 100))
    : 0;

  // « @marc · 2 ventes · 1 en cours, 1 soldée » — d'où vient la personne, puis
  // le détail que le total masque. Le coach distingue ses élèves Momentum de ses
  // clients directs ; l'élève n'a que des clients directs, le libellé n'y aurait
  // aucun sens.
  const siennes = deals.filter(d => person.dealIds.includes(d.id));
  const origine = isCoach ? person.subtitleCoach : person.subtitle;
  const soustitre = [origine, resume(siennes, person)].filter(Boolean).join(' · ');

  return (
    /* ── Une grille, et non trois blocs en flex ──────────────────────────────
       En flex, la colonne du nom prenait tout l'espace restant et poussait la
       barre contre les montants : elle finissait collée à droite alors qu'elle
       relie les deux extrémités de la ligne.
       `1fr auto 1fr` place la colonne du milieu au centre EXACT de la ligne,
       quelle que soit la longueur du nom — ce qu'aucun réglage de flex ne
       garantit. */
    /* ⚠️ Le `<button>` reste un bloc simple, et la grille vit à l'INTÉRIEUR.
       En faisant du bouton lui-même le conteneur de grille, sa boîte cliquable
       s'arrêtait après les montants : tout ce qui suivait le symbole € — l'écart
       et la flèche — ne déclenchait rien, alors que le reste de la ligne
       fonctionnait. Un `<button>` enveloppe ses enfants dans une boîte anonyme
       dont la largeur ne suit pas toujours `width: 100%` quand on lui impose une
       disposition. Le bouton porte donc le clic, un span intérieur porte la
       mise en page : chacun son métier, et plus de zone morte. */
    <button onClick={onOuvrir} style={{
      display: 'block', width: '100%', textAlign: 'left',
      fontFamily: 'inherit', cursor: 'pointer', background: 'var(--surface)',
      border: isMobile ? '1px solid var(--border)' : 'none',
      borderBottom: isMobile ? '1px solid var(--border)' : '1px solid var(--border-soft)',
      borderRadius: isMobile ? 10 : 0,
      padding: isMobile ? '13px 14px' : '14px 4px',
    }}>
      <span style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr auto' : '1fr auto 1fr',
        alignItems: 'center',
        columnGap: isMobile ? 12 : 18,
        width: '100%',
      }}>
      <span style={{
        display: 'flex', alignItems: 'center', gap: 13, minWidth: 0,
        ...(isMobile ? { gridColumn: 1, gridRow: 1 } : null),
      }}>
        <Avatar initials={getInitials(person.name)} avatarUrl={person.avatarUrl} size={34} seed={person.key} />
        <span style={{ minWidth: 0 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span style={{ fontSize: 13.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {person.name}
            </span>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: e.color, flexShrink: 0 }} />
          </span>
          <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {soustitre}
          </span>
        </span>
      </span>

      {/* Sur téléphone, trois zones côte à côte écraseraient la barre à 40 px :
          elle passe sous les deux autres, sur toute la largeur. */}
      <span style={{
        width: isMobile ? 'auto' : 230,
        ...(isMobile ? { gridColumn: '1 / -1', gridRow: 2, marginTop: 8 } : null),
      }}>
        <Barre pct={pct} etat={person.status} legende={`${pct} % encaissé`} />
      </span>

      <span style={{
        display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'flex-end', minWidth: 0,
        ...(isMobile ? { gridColumn: 2, gridRow: 1 } : null),
      }}>
        <span style={{ textAlign: 'right' }}>
          <span className="tabular" style={{ display: 'block', fontSize: 13.5, fontWeight: 700, letterSpacing: '-0.2px' }}>
            {fmtEurExact(person.collected)}
          </span>
          <span className="tabular" style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
            sur {fmtEurExact(person.contracted)}
          </span>
          {/* La date limite d'un litige n'a de sens que si elle se voit sans
              ouvrir la fiche : passée, l'argent est perdu automatiquement. */}
          {person.status === 'disputed' && (
            <span style={{ display: 'block', fontSize: 10.5, color: 'var(--red)', marginTop: 3 }}>
              {dateLitige(siennes)}
            </span>
          )}
        </span>
        {/* La flèche est décorative : elle dit « ça s'ouvre », elle n'est pas la
            cible. Son SVG n'est peint que sur le trait — le reste de sa boîte ne
            reçoit rien, et le trait lui-même devenait une cible à part au bord
            de la ligne. `pointerEvents: none` renvoie tous ces clics à la ligne,
            qui est le vrai bouton. */}
        {!isMobile && (
          <Icon name="chevR" size={15} color="var(--faint)" style={{ pointerEvents: 'none', flexShrink: 0 }} />
        )}
      </span>
      </span>
    </button>
  );
}

/** « 2 ventes · 1 en cours, 1 soldée » — jamais un total seul, qui ne dit rien. */
function resume(siennes: DealRow[], person: PersonRow): string {
  const n = person.dealIds.length;
  if (n === 0) return '';
  if (n === 1) {
    const d = siennes[0];
    return d ? `une vente du ${fmtDateLong(d.signedAt)}` : 'une vente';
  }
  const compte = new Map<string, number>();
  for (const d of siennes) {
    const label = ETATS[(etatSimple(d) as EtatVente)]?.label ?? 'En cours';
    compte.set(label, (compte.get(label) ?? 0) + 1);
  }
  const detail = [...compte.entries()]
    .map(([label, c]) => `${c} ${label.toLowerCase()}`)
    .join(', ');
  return `${n} ventes · ${detail}`;
}

function etatSimple(d: DealRow): string {
  if (d.status === 'disputed') return 'disputed';
  if (d.unexpectedPaymentAt) return 'unexpected';
  if (d.status === 'canceled') return 'canceled';
  if (d.status === 'ended') return 'ended';
  if (d.status === 'paid') return 'paid';
  if (d.overdue > 0 || d.hasFailure) return 'past_due';
  return 'open';
}

function dateLitige(siennes: DealRow[]): string {
  const d = siennes.find(x => x.disputeDueBy);
  return d?.disputeDueBy ? `réponse avant le ${fmtDateLong(d.disputeDueBy)}` : 'réponse à donner';
}
