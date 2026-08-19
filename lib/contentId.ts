import { isYtVideoId } from '@/lib/ytId';

// ID de post Instagram = uniquement des chiffres, 10+ caractères (même règle que
// isValidIgPostId dans components/analytics/PageClientStats.tsx).
const isIgPostId = (s: string | null | undefined): s is string =>
  !!s && /^\d{10,}$/.test(s);

// UUID = format story_sequences.id (8-4-4-4-12).
const isUuid = (s: string | null | undefined): s is string =>
  !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

// Un utm_content valide est un vrai identifiant de contenu (post IG, vidéo YT, ou
// séquence story) — jamais un pseudo Instagram slugifié ou une autre valeur libre.
export const isValidContentId = (s: string | null | undefined): boolean =>
  isIgPostId(s) || isYtVideoId(s) || isUuid(s);

/**
 * Que faut-il écrire dans `utm_content` ?
 *
 * Calendly fige les UTM au moment du clic et les renvoie éternellement à
 * l'identique. À cause d'un ancien bug de PageLiens, beaucoup de liens portaient
 * le PSEUDO du prospect dans utm_content — Calendly a donc figé ces pseudos, et
 * les resynchronise indéfiniment.
 *
 * Règle : ne JAMAIS écrire une valeur invalide. Ni l'entrante, ni pour « remplir »
 * un champ vide. Un champ vide est honnête ; un champ faux ment, et pollue
 * l'attribution par contenu.
 *
 * Historique du bug (2026-08-19) : la logique existait déjà, mais avec une branche
 * « sinon j'écris quand même la valeur invalide ». Tant que la base contenait le
 * pseudo, le pseudo remplaçait le pseudo — invisible. La migration UTM a vidé
 * utm_content (déplacé vers utm_term, son vrai champ), ce qui a désactivé la seule
 * chose qui masquait le défaut : au passage suivant, le cron a réécrit 40 pseudos.
 *
 * Retourne `undefined` quand il ne faut RIEN écrire — l'appelant doit alors omettre
 * la clé de son upsert, et non poser null (ce qui écraserait une valeur correcte).
 */
export function resolveUtmContent(
  incoming: string | null | undefined,
  existing: string | null | undefined,
): string | undefined {
  if (isValidContentId(incoming)) return incoming as string;
  if (isValidContentId(existing)) return existing as string;
  return undefined;
}
