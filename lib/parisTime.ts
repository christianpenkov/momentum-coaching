// RÈGLE PRODUIT (décidée le 2026-07-25, ne pas re-changer sans en reparler) :
// toute heure de call — saisie par le coach, affichée dans les invits, les rappels
// push, et l'app — est TOUJOURS en heure de Paris, quel que soit le fuseau physique
// réel du coach ou de l'élève au moment de la saisie ou de la lecture. Pas d'heure
// locale par utilisateur : un coach en déplacement (ex: Bulgarie, UTC+3) qui saisit
// "14h" saisit "14h à Paris", et l'élève qui reçoit l'invit voit aussi "14h" — même
// si physiquement ça tombe à une heure d'horloge murale différente pour chacun.
// Décision volontaire pour éviter toute ambiguïté/confusion entre coach et élève sur
// "quelle heure ça veut dire" — le coût d'expliquer un décalage à chaque déplacement
// dépasse le bénéfice d'un affichage par-fuseau. Toute la plateforme suppose que tout
// le monde raisonne en heure française.
//
// Calcul d'heure de Paris robuste, indépendant du support ICU/Intl de
// l'environnement d'exécution (contrairement à toLocaleTimeString(...,
// {timeZone:'Europe/Paris'}), qui peut silencieusement retomber sur UTC sur
// certains runtimes serverless sans données de fuseaux complètes — cause réelle
// du bug corrigé le 2026-07-24/25, voir docs/heure-paris.md).
//
// Règle UE de bascule heure d'été/hiver : dernier dimanche de mars 1h UTC
// (passage à +2h) → dernier dimanche d'octobre 1h UTC (retour à +1h).

function lastSundayOfMonth(year: number, month: number): number {
  // month: 0-indexé (2 = mars, 9 = octobre). Renvoie le jour du mois (1-31).
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const lastDate = new Date(Date.UTC(year, month, lastDay));
  const dayOfWeek = lastDate.getUTCDay(); // 0 = dimanche
  return lastDay - dayOfWeek;
}

export function parisOffsetHours(utcDate: Date): number {
  const year = utcDate.getUTCFullYear();
  const dstStart = Date.UTC(year, 2, lastSundayOfMonth(year, 2), 1, 0, 0); // dernier dim. mars, 1h UTC
  const dstEnd = Date.UTC(year, 9, lastSundayOfMonth(year, 9), 1, 0, 0); // dernier dim. octobre, 1h UTC
  const t = utcDate.getTime();
  return t >= dstStart && t < dstEnd ? 2 : 1;
}

function toParisWallClock(utcDate: Date): Date {
  const offset = parisOffsetHours(utcDate);
  return new Date(utcDate.getTime() + offset * 3600_000);
}

const DAYS_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

export function formatParisTime(utcDate: Date): string {
  const wall = toParisWallClock(utcDate);
  const h = String(wall.getUTCHours()).padStart(2, '0');
  const m = String(wall.getUTCMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

export function formatParisDate(utcDate: Date): string {
  const wall = toParisWallClock(utcDate);
  const day = DAYS_FR[wall.getUTCDay()];
  const date = wall.getUTCDate();
  const month = MONTHS_FR[wall.getUTCMonth()];
  return `${day} ${date} ${month}`;
}

// Convertit une heure murale (année/mois/jour/heure/minute) supposée être en heure de
// Paris — quel que soit le fuseau réel de l'appareil qui l'a saisie — en instant UTC.
// Utilisé côté saisie (formulaires) pour garantir que "14:00" saisi signifie toujours
// "14:00 à Paris", indépendamment d'où se trouve physiquement l'utilisateur.
export function parisWallClockToUtc(year: number, month1: number, day: number, hour: number, minute: number): Date {
  // month1 : 1-indexé (1 = janvier), cohérent avec un input <select> humain.
  // Première approximation avec l'offset d'hiver, puis correction si nécessaire —
  // l'offset ne dépend que de la date (pas de l'heure), donc une seule itération suffit.
  const approxUtc = new Date(Date.UTC(year, month1 - 1, day, hour, minute) - 1 * 3600_000);
  const offset = parisOffsetHours(approxUtc);
  return new Date(Date.UTC(year, month1 - 1, day, hour, minute) - offset * 3600_000);
}
