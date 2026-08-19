// Retour haptique — deux plateformes, deux contraintes opposées.
//
// ANDROID : navigator.vibrate() marche depuis n'importe quel code, à n'importe
// quel moment (y compris après une réponse serveur).
//
// iOS : la Vibration API n'est pas supportée, et Apple a fermé en iOS 26.5 le
// déclenchement programmatique du tick système. Le SEUL vecteur restant est un
// tap physique direct sur un <input type="checkbox" switch> natif (WebKit,
// Safari 17.4+). D'où le composant HapticTap (components/ui/HapticTap.tsx) qui
// superpose un switch invisible au-dessus d'un bouton : l'utilisateur croit
// taper le bouton, il tape le switch, iOS joue le tick.
//
// Conséquence à connaître : sur iOS on ne peut PAS vibrer en réaction à un
// événement différé ("paiement confirmé par le serveur"). Seul l'instant du tap
// est haptisable. Une tentative précédente sur l'appui long a été abandonnée
// pour cette raison exacte (voir lib/useLongPress.ts).
//
// Tout est concentré ici et dans HapticTap : si Apple referme la porte, il n'y
// a que ces deux fichiers et leurs quelques usages à retirer.

/** Intensités. Court et net = premium ; long et répété = cheap (guidance Apple). */
export type HapticIntensity = 'light' | 'medium' | 'success' | 'error';

// Durées volontairement courtes. 'error' est le seul motif à deux temps : une
// double pulsation se lit comme "quelque chose ne va pas" sans avoir à lire.
const PATTERNS: Record<HapticIntensity, number | number[]> = {
  light: 10,
  medium: 20,
  success: 25,
  error: [30, 60, 30],
};

/**
 * Vibration Android. No-op silencieux sur iOS (API absente) et sur desktop.
 *
 * À utiliser pour les moments qui comptent — tâche cochée, message envoyé,
 * erreur — jamais sur la navigation ordinaire : une app polie en met moins
 * qu'on ne le croit.
 */
export function haptic(intensity: HapticIntensity = 'light'): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  // Respecte le réglage système : qui demande moins d'animation ne veut pas
  // non plus être secoué par son téléphone.
  if (typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  try {
    navigator.vibrate(PATTERNS[intensity]);
  } catch {
    // Certains navigateurs lèvent si l'onglet n'a pas eu d'interaction
    // utilisateur. Un retour haptique raté ne doit jamais casser une action.
  }
}

/** true si l'appareil peut vibrer depuis JS (Android, pas iOS). */
export function canVibrate(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

/**
 * true sur iOS/iPadOS, où le retour haptique passe obligatoirement par
 * HapticTap plutôt que par haptic().
 *
 * Détection par pointeur + plateforme : iPadOS 13+ se déclare "MacIntel", d'où
 * le test sur maxTouchPoints.
 */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua)
    || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}
