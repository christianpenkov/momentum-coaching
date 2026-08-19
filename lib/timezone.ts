// RÈGLE PRODUIT (décidée le 2026-08-19, remplace celle du 2026-07-25) :
// chaque personne voit les heures de call dans SON propre fuseau, passé compris.
// Un coach à Paris voit "14:30", son élève à Dubaï voit "16:30 Dubaï" — les deux
// ont raison, le badge de ville lève l'ambiguïté.
//
// L'ancienne règle affichait l'heure de Paris à tout le monde. Elle a été
// abandonnée après vérification des pratiques du marché : Google Calendar
// convertit tout, y compris l'historique, parce que deux règles différentes selon
// le côté de "maintenant" produisent un saut d'heure incompréhensible au moment où
// un call bascule dans le passé. Voir docs/fuseaux-horaires.md.
//
// SOURCE D'AUTORITÉ : le navigateur à l'écran (toujours frais), la colonne
// profiles.timezone côté serveur (seule information dont il dispose).
//
// POURQUOI Intl EST UTILISABLE ICI alors que l'ancien lib/parisTime.ts l'évitait
// (fichier supprimé le 2026-08-19, ce module l'a entièrement remplacé) :
// le calcul manuel d'offset ne vaut que pour Paris (règle UE codée en dur). Pour
// un fuseau arbitraire, aucune formule n'existe — la base IANA change plusieurs
// fois par an. Intl est donc obligatoire. Le bug du 2026-07-24 (Intl retombant
// sur UTC dans Deno) a été revérifié le 2026-08-19 par une sonde déployée sur le
// runtime réel : supabase-edge-runtime-1.74.3 supporte 418 fuseaux et gère
// correctement l'heure d'été. Résultat consigné dans docs/fuseaux-horaires.md.

export const DEFAULT_TIME_ZONE = 'Europe/Paris';

const DAYS_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MONTHS_SHORT_FR = ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'];

// Noms de ville affichés à côté de l'heure. Une table explicite plutôt qu'une
// dérivation depuis l'identifiant IANA, pour les accents ("Asia/Dubai" → "Dubaï")
// et les noms composés. Le repli sur le dernier segment couvre le reste : le nom
// IANA EST un nom de ville dans la grande majorité des cas, un accent manquant
// est un défaut cosmétique acceptable, jamais une information fausse.
const CITY_LABELS: Record<string, string> = {
  'Europe/Paris': 'Paris',
  'Europe/London': 'Londres',
  'Europe/Lisbon': 'Lisbonne',
  'Europe/Madrid': 'Madrid',
  'Europe/Berlin': 'Berlin',
  'Europe/Brussels': 'Bruxelles',
  'Europe/Zurich': 'Zurich',
  'Europe/Rome': 'Rome',
  'Europe/Athens': 'Athènes',
  'Europe/Bucharest': 'Bucarest',
  'Europe/Sofia': 'Sofia',
  'Europe/Warsaw': 'Varsovie',
  'Europe/Moscow': 'Moscou',
  'Europe/Istanbul': 'Istanbul',
  'Africa/Casablanca': 'Casablanca',
  'Africa/Tunis': 'Tunis',
  'Africa/Algiers': 'Alger',
  'Africa/Cairo': 'Le Caire',
  'Africa/Dakar': 'Dakar',
  'Africa/Abidjan': 'Abidjan',
  'Africa/Lagos': 'Lagos',
  'Africa/Johannesburg': 'Johannesburg',
  'Asia/Dubai': 'Dubaï',
  'Asia/Riyadh': 'Riyad',
  'Asia/Jerusalem': 'Jérusalem',
  'Asia/Karachi': 'Karachi',
  'Asia/Kolkata': 'Calcutta',
  'Asia/Bangkok': 'Bangkok',
  'Asia/Singapore': 'Singapour',
  'Asia/Hong_Kong': 'Hong Kong',
  'Asia/Shanghai': 'Shanghai',
  'Asia/Tokyo': 'Tokyo',
  'Asia/Seoul': 'Séoul',
  'Australia/Sydney': 'Sydney',
  'Australia/Melbourne': 'Melbourne',
  'Pacific/Auckland': 'Auckland',
  'America/New_York': 'New York',
  'America/Toronto': 'Toronto',
  'America/Chicago': 'Chicago',
  'America/Denver': 'Denver',
  'America/Los_Angeles': 'Los Angeles',
  'America/Mexico_City': 'Mexico',
  'America/Bogota': 'Bogota',
  'America/Sao_Paulo': 'São Paulo',
  'America/Argentina/Buenos_Aires': 'Buenos Aires',
  'America/Montreal': 'Montréal',
  'Indian/Reunion': 'La Réunion',
  'America/Guadeloupe': 'Guadeloupe',
  'America/Martinique': 'Martinique',
  'Indian/Antananarivo': 'Antananarivo',
};

export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Fuseau du navigateur — source d'autorité à l'écran. Replié sur Paris côté
// serveur (SSR) ou sur un navigateur sans support Intl complet.
export function detectBrowserTimeZone(): string {
  if (typeof Intl === 'undefined') return DEFAULT_TIME_ZONE;
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidTimeZone(tz) ? tz : DEFAULT_TIME_ZONE;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

function safeZone(tz: string | null | undefined): string {
  return isValidTimeZone(tz) ? tz : DEFAULT_TIME_ZONE;
}

// Décompose un instant dans un fuseau donné. Locale 'en-CA' volontairement, pas
// 'fr-FR' : on ne veut que des CHIFFRES, jamais les noms de jours/mois d'ICU.
// Le fuseau et la locale sont deux dépendances ICU distinctes — un runtime peut
// avoir la base des fuseaux sans les données de locale française et renvoyer
// "Monday". Les noms viennent de nos tables DAYS_FR/MONTHS_FR, donc le rendu est
// identique partout. Même pattern que lib/period.ts:parisDateParts.
function partsIn(utcDate: Date, tz: string): { y: number; m: number; d: number; h: number; min: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeZone(tz), hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(utcDate);
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value);
  // hour peut valoir 24 pour minuit selon la version d'ICU — normalisé à 0, sinon
  // "24:30" s'afficherait au lieu de "00:30" (piège déjà rencontré dans period.ts).
  const h = get('hour');
  return { y: get('year'), m: get('month'), d: get('day'), h: h === 24 ? 0 : h, min: get('minute') };
}

// "16:30"
export function formatTimeIn(utcDate: Date, tz: string): string {
  const { h, min } = partsIn(utcDate, tz);
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

// "lundi 14 juin"
export function formatDateIn(utcDate: Date, tz: string): string {
  const { y, m, d } = partsIn(utcDate, tz);
  // Le jour de la semaine se déduit d'un Date UTC construit sur les composantes
  // murales : getUTCDay() sur cette date donne le bon jour sans redemander à ICU.
  const weekday = DAYS_FR[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday} ${d} ${MONTHS_FR[m - 1]}`;
}

// { day: '14', month: 'juin', monthShort: 'juin' } — pour le rail des cartes.
export function formatDayPartsIn(utcDate: Date, tz: string): { day: string; month: string; monthShort: string } {
  const { m, d } = partsIn(utcDate, tz);
  return {
    day: String(d).padStart(2, '0'),
    month: MONTHS_FR[m - 1],
    monthShort: MONTHS_SHORT_FR[m - 1],
  };
}

// "2026-06-14" — clé de jour calendaire dans le fuseau donné. Indispensable aux
// calendriers : placer un call dans une case du mois et afficher son heure
// doivent utiliser LE MÊME fuseau, sinon un call de 23h tombe dans la mauvaise
// case (bug latent des deux PageCalendar avant ce chantier).
export function dateKeyIn(utcDate: Date, tz: string): string {
  const { y, m, d } = partsIn(utcDate, tz);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Formate une clé "YYYY-MM-DD" en "lundi 14 juin" SANS passer par un Date : une
// date civile n'a pas de fuseau, et la reconvertir en instant pour la reformater
// peut décaler d'un jour selon le fuseau du lecteur.
export function formatDateKey(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  if (!y || !m || !d) return key;
  const weekday = DAYS_FR[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday} ${d} ${MONTHS_FR[m - 1]}`;
}

// Convertit une heure murale (ce que l'utilisateur a tapé) en instant UTC, dans
// le fuseau donné. Généralisation de lib/period.ts:parisWallTimeToUTC, qui fait
// la même chose pour Paris uniquement — même technique de tâtonnement d'offset,
// fiable à toute date y compris aux transitions d'heure d'été.
export function wallClockToUtc(year: number, month1: number, day: number, hour: number, minute: number, tz: string): Date {
  const zone = safeZone(tz);
  const guess = new Date(Date.UTC(year, month1 - 1, day, hour, minute, 0, 0));
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(guess);
  const gv = (type: string) => Number(parts.find(p => p.type === type)?.value);
  const asIfUTC = Date.UTC(gv('year'), gv('month') - 1, gv('day'), gv('hour') === 24 ? 0 : gv('hour'), gv('minute'), gv('second'));
  const offsetMs = asIfUTC - guess.getTime();
  return new Date(guess.getTime() - offsetMs);
}

// Nom de ville à afficher à côté d'une heure, ou null s'il n'y a rien à préciser.
//
// La comparaison porte sur l'HEURE PRODUITE, pas sur l'identifiant de fuseau :
// Europe/Berlin et Europe/Paris affichent toujours la même heure murale, écrire
// "Berlin" à un lecteur parisien serait du bruit pur. On ne montre le badge que
// lorsqu'il lève une vraie ambiguïté.
export function timeZoneCityLabel(tz: string | null | undefined, viewerTz: string, at: Date = new Date()): string | null {
  const zone = safeZone(tz);
  const viewer = safeZone(viewerTz);
  if (zone === viewer) return null;
  // Même heure ET même jour → aucun décalage perceptible, rien à afficher.
  if (formatTimeIn(at, zone) === formatTimeIn(at, viewer) && dateKeyIn(at, zone) === dateKeyIn(at, viewer)) {
    return null;
  }
  return cityLabelOf(zone);
}

// Nom de ville sans comparaison — pour les formulaires de saisie, où le fuseau
// doit être affiché même quand il est celui du lecteur (une saisie ambiguë coûte
// bien plus cher qu'un libellé redondant).
export function cityLabelOf(tz: string | null | undefined): string {
  const zone = safeZone(tz);
  const known = CITY_LABELS[zone];
  if (known) return known;
  const last = zone.split('/').pop() ?? zone;
  return last.replace(/_/g, ' ');
}
