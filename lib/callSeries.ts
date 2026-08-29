// Import relatif AVEC extension : `npm test` exécute node --test directement sur les
// sources, sans résolution de l'alias `@/`. C'est la contrainte qui rend ce module
// testable — voir les autres lib/*.test.ts.
import { parisDateStr, parisAddDays } from './period.ts';

// Découpage jour par jour des séries de calls — règle unique pour l'onglet
// « Funnel & Calls ».
//
// Elle existe parce qu'elle avait divergé en trois endroits du même écran
// (audit du 2026-08-29) :
//   • les modales du hero comparaient `new Date('YYYY-MM-DD')` — interprété en
//     UTC — à des jours produits par parisDateStr, donc décalés d'une à deux
//     heures selon la saison ;
//   • les modales du tableau d'efficacité découpaient sur le préfixe UTC de
//     `scheduled_at`, la date du RENDEZ-VOUS, alors que le total qu'elles
//     détaillent est filtré sur `booked_at`, la date de RÉSERVATION ;
//   • les deux bouclaient sur le mois en cours même en mode All-Time, si bien
//     qu'une carte à 17 ouvrait une courbe qui n'en totalisait que 9.
//
// Voir docs/perimetre-stats-referentiel.md, règle 2, pour le choix de booked_at.

type DatedCall = { booked_at?: string | null; scheduled_at?: string | null };

/** Date de rattachement d'un call à une journée : la réservation, repli sur la
 *  tenue du rendez-vous pour les calls anciens importés sans `booked_at`. */
export function callDayKey(c: DatedCall): string | null {
  const d = c.booked_at ?? c.scheduled_at;
  if (!d) return null;
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return null;
  return parisDateStr(t);
}

/** Index « jour de Paris → calls réservés ce jour-là ». */
export function bucketCallsByBookedDay<T extends DatedCall>(calls: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const c of calls) {
    const key = callDayKey(c);
    if (!key) continue;
    const arr = m.get(key);
    if (arr) arr.push(c); else m.set(key, [c]);
  }
  return m;
}

/** Tous les jours de Paris compris entre deux instants, bornes incluses. */
export function parisDayRange(start: Date, end: Date): string[] {
  const days: string[] = [];
  const finStr = parisDateStr(end);
  let d = start;
  while (parisDateStr(d) <= finStr) {
    days.push(parisDateStr(d));
    d = parisAddDays(d, 1);
  }
  return days;
}

/** Un taux n'existe pas sans dénominateur : `null` (un trou), jamais `0` — qui
 *  affirmerait « ce jour-là la performance était nulle » pour un jour sans
 *  aucune mesure. */
export function tauxOuTrou(numerateur: number, denominateur: number): number | null {
  if (denominateur <= 0) return null;
  return (numerateur / denominateur) * 100;
}
