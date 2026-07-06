// Retour haptique (vibration légère) au toucher — navigator.vibrate() n'est pas
// supporté sur iOS Safari/PWA (aucune version). Contournement iOS 18+ : un
// <input type="checkbox" switch"> invisible, dont le toggle via clic sur son
// <label> associé déclenche le même micro-retour haptique natif que les
// interrupteurs iOS (comportement non documenté officiellement par Apple,
// découvert par la communauté — silencieux/no-op si non supporté).
let hapticLabel: HTMLLabelElement | null = null;

function ensureHapticSwitch(): HTMLLabelElement | null {
  if (typeof document === 'undefined') return null;
  if (hapticLabel && document.body.contains(hapticLabel)) return hapticLabel;

  const input = document.createElement('input');
  input.type = 'checkbox';
  // setAttribute (pas input.switch = true) — 'switch' n'est pas une propriété IDL
  // reconnue par le DOM, seul le vrai attribut HTML est lu par WebKit.
  input.setAttribute('switch', '');
  input.id = 'haptic-trigger';
  input.style.cssText = 'position:fixed;opacity:0;pointer-events:none;width:1px;height:1px;';
  input.tabIndex = -1;
  input.setAttribute('aria-hidden', 'true');

  const label = document.createElement('label');
  label.htmlFor = input.id;
  label.style.cssText = 'position:fixed;opacity:0;pointer-events:none;width:1px;height:1px;';
  label.setAttribute('aria-hidden', 'true');

  document.body.appendChild(input);
  document.body.appendChild(label);
  hapticLabel = label;
  return label;
}

export function hapticFeedback() {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    navigator.vibrate(30);
    return;
  }
  try {
    ensureHapticSwitch()?.click();
  } catch {
    // Silencieux — comportement non garanti hors iOS 18+, pas d'impact fonctionnel
  }
}
