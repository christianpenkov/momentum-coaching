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
