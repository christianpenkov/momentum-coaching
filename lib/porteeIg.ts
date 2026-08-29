import { useQuery } from '@tanstack/react-query';

/**
 * Portée Instagram dédupliquée — source unique, pour l'onglet Instagram ET l'entonnoir.
 *
 * ── Pourquoi ce module existe ────────────────────────────────────────────────
 * Deux écrans affichaient deux portées différentes pour la même période. L'onglet
 * Instagram lisait la mesure de période de Meta (« du 1 au 31 août — Reach total =
 * 122 ») pendant que l'entonnoir sommait les valeurs journalières (145). Les deux
 * chiffres se voyaient à trois centimètres l'un de l'autre, et rien n'expliquait
 * l'écart.
 *
 * ── Pourquoi une somme de jours est fausse ───────────────────────────────────
 * La portée compte des PERSONNES, pas des vues. Quelqu'un touché trois jours de
 * suite compte trois fois dans une somme de jours, une seule fois dans une mesure
 * de période. L'écart grandit avec la durée : 18 % sur un mois du profil de test
 * (145 contre 122), et 142 % sur l'historique complet (502 contre 207).
 *
 * Et la déduplication ne se rattrape pas en sommant des mois : juin (120) +
 * juillet (143) + août (122) = 385, contre 207 réellement mesurés sur la fenêtre
 * complète. Il n'existe aucun calcul qui reconstitue une période à partir d'une
 * autre — d'où une mesure stockée par période, écrite par le cron.
 *
 * ── Ce que ce module NE fait pas ─────────────────────────────────────────────
 * Il ne calcule rien et ne remplace jamais une absence par une somme. Une période
 * sans mesure rend `null`, et l'écran doit afficher un trou. Un repli sur la somme
 * des jours réintroduirait exactement l'erreur qu'on corrige, en silence.
 */

export type TypePeriodeIg = 'mois' | 'semaine' | 'all_time';

export type PeriodeIg = {
  debut: string;
  fin: string;
  reachTotal: number | null;
  reachAbonnes: number | null;
  reachNonAbonnes: number | null;
  abonnes: number | null;
  /** false = période encore en cours, le chiffre bougera encore. */
  figee: boolean;
  tauxAbonnes: number | null;
  partNonAbonnes: number | null;
};

/** Granularité de période correspondant au sélecteur de la page (7j / 30j / All-Time). */
export function typePeriodePour(period: number, sinceConnection?: boolean): TypePeriodeIg {
  if (sinceConnection) return 'all_time';
  return period === 7 ? 'semaine' : 'mois';
}

export function usePeriodesIg(type: TypePeriodeIg, profileId?: string) {
  return useQuery<{ type: string; periodes: PeriodeIg[] }>({
    queryKey: ['ig-periodes', profileId, type],
    queryFn: () => fetch(`/api/instagram/periodes?type=${type}${profileId ? `&profileId=${profileId}` : ''}`).then(r => r.json()),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Portée d'une période précise, ou `null` si elle n'a jamais été mesurée.
 *
 * `debut` est la clé : c'est ce qui identifie une période côté base. Pour l'All-Time
 * il n'existe qu'une ligne, dont le début glisse avec le plafond de rétention — on
 * la prend donc sans la chercher par date.
 */
export function porteeDeLaPeriode(
  periodes: PeriodeIg[] | undefined,
  type: TypePeriodeIg,
  debut: string,
): PeriodeIg | null {
  if (!periodes?.length) return null;
  if (type === 'all_time') return periodes[0] ?? null;
  return periodes.find(p => p.debut === debut) ?? null;
}
