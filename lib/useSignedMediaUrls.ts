'use client';
import { useCallback } from 'react';

// Cache module-level (pas dans le hook) : partagé entre TOUS les montages du composant,
// survit à un changement d'onglet / démontage-remontage — évite de régénérer une URL signée
// (donc invalider le cache HTTP navigateur via un nouveau token) pour un média déjà résolu
// il y a quelques secondes. Voir plan ok-nous-ici-on-proud-rocket.md pour le contexte complet.
const TTL_MS = 3600_000;
const SAFETY_MARGIN_MS = 5 * 60_000;

interface CacheEntry { url: string | null; thumbnailUrl: string | null; expiresAt: number }

const mediaUrlCache = new Map<string, CacheEntry>();

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
      if (Object.keys(fresh).length > 0) apply(fresh);
    } catch {
      // Échec silencieux — même comportement que l'ancien resolveMediaUrls local.
    }
  }, []);

  return resolve;
}
