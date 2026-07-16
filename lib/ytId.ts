// ID vidéo YouTube = exactement 11 caractères dans [A-Za-z0-9_-]
export const isYtVideoId = (s: string | null | undefined): s is string =>
  !!s && /^[A-Za-z0-9_-]{11}$/.test(s);
