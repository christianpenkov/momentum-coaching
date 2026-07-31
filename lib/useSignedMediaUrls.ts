'use client';
import { useCallback } from 'react';

// Cache module-level (pas dans le hook) : partagé entre TOUS les montages du composant,
// survit à un changement d'onglet / démontage-remontage — évite de régénérer une URL signée
// (donc invalider le cache HTTP navigateur via un nouveau token) pour un média déjà résolu
// il y a quelques secondes. Voir plan ok-nous-ici-on-proud-rocket.md pour le contexte complet.
//
// Persisté aussi dans localStorage : sur mobile PWA, ouvrir l'app depuis l'écran d'accueil
// équivaut à un rechargement complet de page (pas juste un changement d'onglet) — un cache
// mémoire pur serait vidé à chaque ouverture, réintroduisant le délai de 10s dans le cas
// d'usage le plus fréquent. localStorage survit à la fermeture/réouverture de l'app.
const TTL_MS = 3600_000;
const SAFETY_MARGIN_MS = 5 * 60_000;
const STORAGE_KEY = 'signed-media-url-cache-v1';

interface CacheEntry { url: string | null; thumbnailUrl: string | null; expiresAt: number }

function loadFromStorage(): Map<string, CacheEntry> {
  if (typeof window === 'undefined') return new Map();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Record<string, CacheEntry>;
    const now = Date.now();
    // Ne recharge que les entrées encore valides — évite de trimballer indéfiniment des
    // entrées expirées dans localStorage (taille bornée dans le temps).
    return new Map(Object.entries(parsed).filter(([, v]) => v.expiresAt > now));
  } catch {
    return new Map();
  }
}

function persistToStorage(cache: Map<string, CacheEntry>) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(cache)));
  } catch {
    // Quota dépassé ou storage indisponible (navigation privée) — le cache mémoire suffit
    // pour la session en cours, pas grave si la persistance échoue.
  }
}

const mediaUrlCache = loadFromStorage();

function isFresh(entry: CacheEntry | undefined): entry is CacheEntry {
  return !!entry && entry.expiresAt - SAFETY_MARGIN_MS > Date.now();
}

export function useSignedMediaUrls() {
  const resolve = useCallback(async (
    messages: Array<{ id: string; type?: string }>,
    apply: (updates: Record<string, { url: string; thumbnailUrl: string | null }>) => void,
  ) => {
    const mediaMsgs = messages.filter(m => m.type === 'image' || m.type === 'document' || m.type === 'audio');
    if (mediaMsgs.length === 0) return;

    const fromCache: Record<string, { url: string; thumbnailUrl: string | null }> = {};
    const toFetch: string[] = [];
    for (const m of mediaMsgs) {
      const cached = mediaUrlCache.get(m.id);
      if (isFresh(cached) && cached.url) {
        fromCache[m.id] = { url: cached.url, thumbnailUrl: cached.thumbnailUrl };
      } else {
        toFetch.push(m.id);
      }
    }
    if (Object.keys(fromCache).length > 0) apply(fromCache);
    if (toFetch.length === 0) return;

    try {
      const res = await fetch('/api/messages/media-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageIds: toFetch }),
      });
      if (!res.ok) return;
      const { urls } = await res.json() as { urls: Record<string, { url: string | null; thumbnailUrl: string | null }> };
      const expiresAt = Date.now() + TTL_MS;
      const fresh: Record<string, { url: string; thumbnailUrl: string | null }> = {};
      for (const [id, resolved] of Object.entries(urls)) {
        if (!resolved?.url) continue;
        mediaUrlCache.set(id, { url: resolved.url, thumbnailUrl: resolved.thumbnailUrl, expiresAt });
        fresh[id] = { url: resolved.url, thumbnailUrl: resolved.thumbnailUrl };
      }
      if (Object.keys(fresh).length > 0) {
        apply(fresh);
        persistToStorage(mediaUrlCache);
      }
    } catch {
      // Échec silencieux — même comportement que l'ancien resolveMediaUrls local.
    }
  }, []);

  return resolve;
}
