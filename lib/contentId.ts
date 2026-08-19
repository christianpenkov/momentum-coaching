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

/**
 * Construit `calls.source` au format `plateforme_medium` (ex. `ig_bio`,
 * `yt_description`).
 *
 * `utm_source` doit contenir la PLATEFORME. Certains vieux liens portent le
 * domaine Short.io à la place (`ubizenai.s.gy`), ce qui produisait des sources
 * du type `ubizenai.s.gy_description` — inexploitables pour l'attribution, qui
 * regroupe par plateforme.
 *
 * Quand utm_source n'est pas une plateforme connue, on la déduit du contenu :
 * un identifiant YouTube (11 caractères) ou de post Instagram (chiffres) suffit
 * à trancher. Sinon on renvoie undefined — mieux vaut pas de source qu'une
 * source fausse, même règle que pour utm_content.
 */
/**
 * Canaux valides pour `utm_medium` — nomenclature fermée (docs/utm-nomenclature.md).
 *
 * Contrairement à utm_campaign, dont les valeurs sont libres par conception
 * (`lm-{keyword}`, `lead-{ig_user_id}`, `prospect-{slug}`…), utm_medium n'a que
 * quatre valeurs possibles. C'est donc le seul des deux qui puisse être validé.
 */
const VALID_UTM_MEDIUMS = ['bio', 'description', 'dm', 'story'] as const;

/**
 * Valide `utm_medium` avant écriture.
 *
 * Même règle que resolveUtmContent et resolveCallSource : une valeur externe non
 * conforme n'est jamais recopiée. Retourne `undefined` quand il ne faut rien
 * écrire — l'appelant omet alors la clé, il ne pose surtout pas null (ce qui
 * écraserait une valeur correcte).
 *
 * Aucune anomalie constatée sur ce champ à ce jour : la garde est préventive.
 * Les données étaient propres par chance, pas par conception — exactement la
 * situation d'utm_content avant que la migration du 2026-08-19 ne la révèle.
 */
export function resolveUtmMedium(
  incoming: string | null | undefined,
): string | undefined {
  if (!incoming) return undefined;
  return (VALID_UTM_MEDIUMS as readonly string[]).includes(incoming) ? incoming : undefined;
}

export function resolveCallSource(
  utmSource: string | null | undefined,
  utmMedium: string | null | undefined,
  utmContent?: string | null,
): string | undefined {
  if (!utmSource) return undefined;

  const platform = ['ig', 'yt'].includes(utmSource)
    ? utmSource
    : isYtVideoId(utmContent) ? 'yt'
    : isIgPostId(utmContent) ? 'ig'
    : null;

  if (!platform) return undefined;
  return [platform, utmMedium].filter(Boolean).join('_');
}
