// Port Deno de lib/timezone.ts — formatage uniquement.
//
// POURQUOI CETTE DUPLICATION : une Edge Function Deno ne peut pas importer depuis
// le lib/ du projet Next.js (pas de résolution de '@/lib/*', pas de build partagé).
// Ce fichier est le point de partage entre les DEUX Edge Functions qui affichent
// une heure de call — call-reminders et poll-leads — qui avaient auparavant chacune
// leur copie du calcul d'offset. On passe donc de 3 copies à 2.
//
// TOUTE MODIFICATION ICI DOIT ÊTRE RÉPERCUTÉE DANS lib/timezone.ts, et
// inversement. Les deux fichiers doivent produire des chaînes identiques.
//
// Intl est utilisable : vérifié le 2026-08-19 par une sonde déployée sur le
// runtime réel (supabase-edge-runtime-1.74.3) — 418 fuseaux supportés, heure d'été
// correcte. Le bug du 2026-07-24 qui avait imposé un calcul manuel d'offset Paris
// est résolu côté Supabase. Voir docs/fuseaux-horaires.md.

export const DEFAULT_TIME_ZONE = 'Europe/Paris';

const DAYS_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

export function isValidTimeZone(tz: string | null | undefined): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Fuseau du destinataire, replié sur Paris — à appeler sur toute valeur lue en base. */
export function safeZone(tz: string | null | undefined): string {
  return isValidTimeZone(tz) ? (tz as string) : DEFAULT_TIME_ZONE;
}

// Locale 'en-CA' volontaire : on n'extrait que des CHIFFRES. Les noms de jours et de
// mois viennent des tables FR ci-dessus, jamais d'ICU — le fuseau et la locale sont
// deux dépendances distinctes, et un runtime peut avoir l'un sans l'autre.
function partsIn(utcDate: Date, tz: string): { y: number; m: number; d: number; h: number; min: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeZone(tz), hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(utcDate);
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value);
  const h = get('hour');
  return { y: get('year'), m: get('month'), d: get('day'), h: h === 24 ? 0 : h, min: get('minute') };
}

/** "16:30" */
export function formatTimeIn(utcDate: Date, tz: string): string {
  const { h, min } = partsIn(utcDate, tz);
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** "lundi 14 juin" */
export function formatDateIn(utcDate: Date, tz: string): string {
  const { y, m, d } = partsIn(utcDate, tz);
  const weekday = DAYS_FR[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday} ${d} ${MONTHS_FR[m - 1]}`;
}
