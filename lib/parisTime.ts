// @deprecated — utiliser lib/timezone.ts.
//
// Ce fichier n'est plus qu'une FAÇADE conservée le temps de migrer ses appelants.
// Chaque fonction délègue à lib/timezone.ts avec tz = 'Europe/Paris', donc le
// comportement est rigoureusement identique à avant (vérifié sur 3688 cas, dont
// les deux dimanches de bascule DST à la minute près : zéro écart).
//
// POURQUOI CE FICHIER EXISTAIT : la règle produit du 2026-07-25 voulait que toute
// heure de call s'affiche en heure de Paris pour tout le monde. Le calcul d'offset
// y était fait à la main (règle UE codée en dur) parce qu'Intl retombait
// silencieusement sur UTC dans le runtime Deno de Supabase (bug du 2026-07-24).
//
// POURQUOI IL DISPARAÎT : la règle a changé le 2026-08-19 — chacun voit les heures
// dans SON fuseau. Un calcul manuel ne peut pas couvrir un fuseau arbitraire (la
// base IANA change plusieurs fois par an), donc Intl redevient obligatoire. Une
// sonde déployée sur le runtime Deno réel le 2026-08-19 a confirmé qu'il supporte
// désormais 418 fuseaux et gère correctement l'heure d'été.
//
// Voir docs/fuseaux-horaires.md.

import {
  formatTimeIn,
  formatDateIn,
  wallClockToUtc,
  DEFAULT_TIME_ZONE,
} from '@/lib/timezone';

/** @deprecated Utiliser formatTimeIn(date, tz) de lib/timezone.ts. */
export function formatParisTime(utcDate: Date): string {
  return formatTimeIn(utcDate, DEFAULT_TIME_ZONE);
}

/** @deprecated Utiliser formatDateIn(date, tz) de lib/timezone.ts. */
export function formatParisDate(utcDate: Date): string {
  return formatDateIn(utcDate, DEFAULT_TIME_ZONE);
}

/** @deprecated Utiliser wallClockToUtc(..., tz) de lib/timezone.ts. */
export function parisWallClockToUtc(year: number, month1: number, day: number, hour: number, minute: number): Date {
  return wallClockToUtc(year, month1, day, hour, minute, DEFAULT_TIME_ZONE);
}

// parisOffsetHours n'est plus exporté : son seul intérêt était le calcul manuel
// que lib/timezone.ts remplace. Les copies Deno (call-reminders, poll-leads) sont
// migrées séparément — elles ne peuvent pas importer ce module.
