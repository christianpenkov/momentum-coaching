'use client';
import { useCallback } from 'react';
import { useSignedMediaUrls } from '@/lib/useSignedMediaUrls';

// Cache local des OCTETS d'image (pas juste l'URL signée) via la Cache Storage API du
// navigateur — une fois une image affichée sur cet appareil, elle n'est plus jamais
// re-téléchargée, même après expiration du TTL de l'URL signée (1h) ou des semaines plus
// tard. Complète useSignedMediaUrls.ts (gardé intact) qui reste le chemin de repli réseau
// pour le tout premier affichage et pour les documents/audio (non mis en cache ici — voir
// plan ok-nous-ici-on-proud-rocket.md).
//
// Anciennement implémenté via IndexedDB (stockage de Blob) — abandonné après un bug
// confirmé en prod sur iOS ("WebkitBlobRessource error 1", image cassée en plein écran) :
// le stockage de Blob dans IndexedDB est un point faible documenté de longue date de
// WebKit (webkit.org/b/198278, github.com/dfahlander/Dexie.js/issues/1227) — un Blob
// écrit avec succès peut ressortir illisible à la lecture, de façon non déterministe.
// La Cache Storage API est l'outil natif du navigateur pour ce cas précis (stocker des
// réponses réseau comme des images), le même mécanisme qu'utilisent les service workers —
// fiable sur Safari iOS là où IndexedDB+Blob ne l'était pas.
const CACHE_NAME = 'orbit-media-cache-v2';
const MAX_ENTRIES = 400;

type Kind = 'full' | 'thumb';

export interface BlobResolvedUpdate {
  url: string;
  thumbnailUrl: string | null;
}

function cacheKeyFor(messageId: string, kind: Kind): string {
  // URL synthétique (jamais fetchée réellement) servant de clé dans le Cache Storage —
  // la Cache API indexe par Request, une chaîne same-origin est la façon la plus simple
  // d'obtenir une clé stable et lisible pour le debug (voir cache.keys() en DevTools).
  return `https://orbit-media-cache.local/${messageId}/${kind}`;
}

function cacheSupported(): boolean {
  return typeof window !== 'undefined' && 'caches' in window;
}

let cachePromise: Promise<Cache | null> | null = null;
function openCache(): Promise<Cache | null> {
  if (!cacheSupported()) return Promise.resolve(null);
  if (cachePromise) return cachePromise;
  cachePromise = caches.open(CACHE_NAME).catch(() => null);
  return cachePromise;
}

// Registre des object URLs actuellement affichées, avec comptage de références — évite de
// recréer un object URL pour une image déjà montée ailleurs (ex. miniature + lightbox), et
// permet de savoir quand il est sûr de révoquer (voir release() plus bas).
const objectUrlRegistry = new Map<string, { url: string; refCount: number }>();

function acquireObjectUrl(key: string, blob: Blob): string {
  const existing = objectUrlRegistry.get(key);
  if (existing) {
    existing.refCount++;
    return existing.url;
  }
  const url = URL.createObjectURL(blob);
  objectUrlRegistry.set(key, { url, refCount: 1 });
  return url;
}

async function getCachedBlob(cache: Cache, messageId: string, kind: Kind): Promise<Blob | null> {
  try {
    const res = await cache.match(cacheKeyFor(messageId, kind));
    if (!res) return null;
    const blob = await res.blob();
    // Une réponse en cache avec un corps vide/tronqué ne doit jamais être servie —
    // mêmes conséquences qu'un fichier corrompu, on la traite comme absente.
    if (blob.size === 0) { await cache.delete(cacheKeyFor(messageId, kind)); return null; }
    return blob;
  } catch {
    return null;
  }
}

async function putCachedBlob(cache: Cache, messageId: string, kind: Kind, blob: Blob) {
  if (blob.size === 0) return;
  try {
    await cache.put(cacheKeyFor(messageId, kind), new Response(blob));
    await evictIfNeeded(cache);
  } catch {
    // Quota dépassé ou autre échec d'écriture — l'image reste affichable via l'URL
    // signée brute, juste pas mise en cache pour la prochaine fois.
  }
}

// La Cache API n'expose pas de "dernier accès" natif (pas d'équivalent LRU intégré) —
// éviction simple par ordre d'insertion une fois MAX_ENTRIES dépassé, suffisant pour
// borner la taille sans la complexité d'un index séparé.
async function evictIfNeeded(cache: Cache) {
  try {
    const keys = await cache.keys();
    if (keys.length <= MAX_ENTRIES) return;
    const excess = keys.length - MAX_ENTRIES;
    await Promise.all(keys.slice(0, excess).map(req => cache.delete(req)));
  } catch {
    // Non bloquant — le quota du navigateur reste le filet de sécurité ultime.
  }
}

async function deleteByMessageId(cache: Cache, messageId: string) {
  try {
    await Promise.all(
      (['full', 'thumb'] as Kind[]).map(kind => cache.delete(cacheKeyFor(messageId, kind)))
    );
  } catch {
    // Non bloquant.
  }
}

export function useBlobMediaCache() {
  const signedResolve = useSignedMediaUrls();

  const resolve = useCallback(async (
    messages: Array<{ id: string; type?: string }>,
    apply: (updates: Record<string, BlobResolvedUpdate>) => void,
  ) => {
    const imageMsgs = messages.filter(m => m.type === 'image');
    const otherMsgs = messages.filter(m => m.type !== 'image');

    if (otherMsgs.length > 0) signedResolve(otherMsgs, apply);
    if (imageMsgs.length === 0) return;

    const cache = await openCache();
    if (!cache) { await signedResolve(imageMsgs, apply); return; }

    const fromCache: Record<string, BlobResolvedUpdate> = {};
    const toFetch: Array<{ id: string; type?: string }> = [];
    await Promise.all(imageMsgs.map(async (m) => {
      const full = await getCachedBlob(cache, m.id, 'full');
      if (!full) { toFetch.push(m); return; }
      const thumb = await getCachedBlob(cache, m.id, 'thumb');
      fromCache[m.id] = {
        url: acquireObjectUrl(cacheKeyFor(m.id, 'full'), full),
        thumbnailUrl: thumb ? acquireObjectUrl(cacheKeyFor(m.id, 'thumb'), thumb) : null,
      };
    }));
    if (Object.keys(fromCache).length > 0) apply(fromCache);
    if (toFetch.length === 0) return;

    // Premier affichage sur cet appareil : passe par le cache d'URL signée existant, puis
    // télécharge les octets nous-mêmes (fetch(signedUrl)) pour les mettre en cache — un seul
    // GET réseau par image/thumb, jamais deux (le <img> affiche l'object URL, pas l'URL signée).
    //
    // La MINIATURE est prioritaire et appliquée dès qu'elle est prête (apply() séparé,
    // pas attendu par le grand format) : c'est elle qui s'affiche dans le fil de la
    // conversation. Le grand format (potentiellement plusieurs Mo, contre quelques
    // dizaines de Ko pour la miniature webp) se télécharge en arrière-plan sans bloquer
    // l'affichage du fil — avant ce fix, les deux étaient attendus en série (grand format
    // D'ABORD, alors qu'il n'est utile qu'au clic sur le lightbox), ce qui retardait
    // l'apparition de la miniature de plusieurs secondes sans raison.
    await signedResolve(toFetch, async (signedUpdates) => {
      const thumbUpdates: Record<string, BlobResolvedUpdate> = {};
      await Promise.all(Object.entries(signedUpdates).map(async ([id, u]) => {
        let finalThumbUrl = u.thumbnailUrl;
        if (u.thumbnailUrl) {
          try {
            const resThumb = await fetch(u.thumbnailUrl);
            if (resThumb.ok) {
              const blobThumb = await resThumb.blob();
              if (blobThumb.size > 0) {
                await putCachedBlob(cache, id, 'thumb', blobThumb);
                finalThumbUrl = acquireObjectUrl(cacheKeyFor(id, 'thumb'), blobThumb);
              }
            }
          } catch {
            // Échec — on garde l'URL signée brute du thumbnail, l'image reste affichable.
          }
        }
        // url reste l'URL signée brute pour l'instant (résolue en arrière-plan ci-dessous) —
        // suffisant pour le bouton "Ouvrir" du lightbox si l'utilisateur clique avant la
        // fin du téléchargement du grand format.
        thumbUpdates[id] = { url: u.url, thumbnailUrl: finalThumbUrl };
      }));
      apply(thumbUpdates);

      // Grand format : téléchargé après coup, en arrière-plan, sans bloquer l'affichage
      // du fil. Se met à jour dans les messages dès qu'il est prêt (utile pour un clic
      // quasi-immédiat sur le lightbox, qui bénéficie alors déjà du cache).
      Object.entries(signedUpdates).forEach(([id, u]) => {
        (async () => {
          try {
            const res = await fetch(u.url);
            if (res.ok) {
              const blob = await res.blob();
              if (blob.size > 0) {
                await putCachedBlob(cache, id, 'full', blob);
                apply({ [id]: { url: acquireObjectUrl(cacheKeyFor(id, 'full'), blob), thumbnailUrl: thumbUpdates[id]?.thumbnailUrl ?? null } });
              }
            }
          } catch {
            // Échec silencieux — le lightbox retombera sur l'URL signée brute au clic.
          }
        })();
      });
    });
  }, [signedResolve]);

  const release = useCallback((messageIds: string[]) => {
    for (const id of messageIds) {
      for (const kind of ['full', 'thumb'] as Kind[]) {
        const key = cacheKeyFor(id, kind);
        const entry = objectUrlRegistry.get(key);
        if (!entry) continue;
        entry.refCount--;
        if (entry.refCount <= 0) {
          URL.revokeObjectURL(entry.url);
          objectUrlRegistry.delete(key);
        }
      }
    }
  }, []);

  const evictMessage = useCallback((messageId: string) => {
    for (const kind of ['full', 'thumb'] as Kind[]) {
      const key = cacheKeyFor(messageId, kind);
      const entry = objectUrlRegistry.get(key);
      if (entry) {
        URL.revokeObjectURL(entry.url);
        objectUrlRegistry.delete(key);
      }
    }
    openCache().then(cache => { if (cache) deleteByMessageId(cache, messageId); });
  }, []);

  return { resolve, release, evictMessage };
}
