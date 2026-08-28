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

  // « 2 ventes · 1 en cours, 1 soldée » — le détail que le total masque.
  const siennes = deals.filter(d => person.dealIds.includes(d.id));
  const soustitre = resume(siennes, person);

  return (
    <button onClick={onOuvrir} style={{
      display: 'flex', alignItems: 'center', gap: 13, width: '100%', textAlign: 'left',
      fontFamily: 'inherit', cursor: 'pointer', background: 'var(--surface)',
      border: isMobile ? '1px solid var(--border)' : 'none',
      borderBottom: isMobile ? '1px solid var(--border)' : '1px solid var(--border-soft)',
      borderRadius: isMobile ? 10 : 0,
      padding: isMobile ? '13px 14px' : '13px 4px',
    }}>
      <Avatar initials={getInitials(person.name)} avatarUrl={person.avatarUrl} size={34} seed={person.key} />

      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 13.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {person.name}
          </span>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: e.color, flexShrink: 0 }} />
        </span>
        <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {soustitre}
        </span>

        {/* Le pourcentage AU-DESSUS de la barre, en chiffres tabulaires : une
            barre seule ne se compare pas d'une ligne à l'autre. */}
        <span style={{ display: 'block', marginTop: 7, maxWidth: isMobile ? '100%' : 260 }}>
          <span className="tabular" style={{ display: 'block', fontSize: 10.5, color: 'var(--faint)', marginBottom: 3 }}>
            {pct}%
          </span>
          <Barre pct={pct} etat={person.status} />
        </span>
      </span>

      <span style={{ flexShrink: 0, textAlign: 'right' }}>
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

      {!isMobile && <Icon name="chevR" size={15} color="var(--faint)" />}
      {isCoach && null}
    </button>
  );
}

/** « 2 ventes · 1 en cours, 1 soldée » — jamais un total seul, qui ne dit rien. */
function resume(siennes: DealRow[], person: PersonRow): string {
  const n = person.dealIds.length;
  if (n === 0) return '';
  if (n === 1) {
    const d = siennes[0];
    return d ? `Une vente · ${fmtDateLong(d.signedAt)}` : 'Une vente';
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
  if (d.hasFailure) return 'past_due';
  return 'open';
}

function dateLitige(siennes: DealRow[]): string {
  const d = siennes.find(x => x.disputeDueBy);
  return d?.disputeDueBy ? `réponse avant le ${fmtDateLong(d.disputeDueBy)}` : 'réponse à donner';
}
