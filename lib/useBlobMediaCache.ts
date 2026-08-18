'use client';
import { useCallback } from 'react';
import { useSignedMediaUrls } from '@/lib/useSignedMediaUrls';

// Cache local des OCTETS d'image (pas juste l'URL signée) via IndexedDB — une fois une image
// affichée sur cet appareil, elle n'est plus jamais re-téléchargée, même après expiration du
// TTL de l'URL signée (1h) ou des semaines plus tard. Complète useSignedMediaUrls.ts (gardé
// intact) qui reste le chemin de repli réseau pour le tout premier affichage et pour les
// documents/audio (non mis en cache ici — voir plan ok-nous-ici-on-proud-rocket.md).
//
// Peut être désactivé instantanément sans revert de code via cette constante, si un souci
// Safari/iOS apparaît en prod (coupe-circuit).
const USE_BLOB_CACHE = true;

const DB_NAME = 'orbit-media-cache-v1';
const DB_VERSION = 1;
const STORE_BLOBS = 'blobs';
const STORE_META = 'meta';
const MAX_BYTES = 150 * 1024 * 1024;
const MAX_ENTRIES = 400;

type Kind = 'full' | 'thumb';

interface BlobRecord {
  key: string;
  messageId: string;
  kind: Kind;
  blob: Blob;
  sizeBytes: number;
  storedAt: number;
  lastAccessedAt: number;
}

interface MetaRecord {
  key: 'stats';
  totalBytes: number;
  count: number;
}

export interface BlobResolvedUpdate {
  url: string;
  thumbnailUrl: string | null;
}

function keyFor(messageId: string, kind: Kind) {
  return `${messageId}:${kind}`;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !window.indexedDB) return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = window.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_BLOBS)) {
          const store = db.createObjectStore(STORE_BLOBS, { keyPath: 'key' });
          store.createIndex('by_lastAccessedAt', 'lastAccessedAt');
          store.createIndex('by_messageId', 'messageId');
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function getMeta(db: IDBDatabase): Promise<MetaRecord> {
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_META, 'readonly');
    const req = tx.objectStore(STORE_META).get('stats');
    req.onsuccess = () => resolve(req.result || { key: 'stats', totalBytes: 0, count: 0 });
    req.onerror = () => resolve({ key: 'stats', totalBytes: 0, count: 0 });
  });
}

function putMeta(db: IDBDatabase, meta: MetaRecord) {
  try {
    const tx = db.transaction(STORE_META, 'readwrite');
    tx.objectStore(STORE_META).put(meta);
  } catch {
    // Échec silencieux — les stats redeviendront cohérentes à la prochaine éviction complète.
  }
}

async function getRecords(db: IDBDatabase, keys: string[]): Promise<Map<string, BlobRecord>> {
  return new Promise((resolve) => {
    const result = new Map<string, BlobRecord>();
    if (keys.length === 0) return resolve(result);
    const tx = db.transaction(STORE_BLOBS, 'readonly');
    const store = tx.objectStore(STORE_BLOBS);
    let remaining = keys.length;
    for (const key of keys) {
      const req = store.get(key);
      req.onsuccess = () => {
        if (req.result) result.set(key, req.result as BlobRecord);
        remaining--;
        if (remaining === 0) resolve(result);
      };
      req.onerror = () => {
        remaining--;
        if (remaining === 0) resolve(result);
      };
    }
  });
}

async function touchRecord(db: IDBDatabase, record: BlobRecord) {
  try {
    const tx = db.transaction(STORE_BLOBS, 'readwrite');
    tx.objectStore(STORE_BLOBS).put({ ...record, lastAccessedAt: Date.now() });
  } catch {
    // Non bloquant — juste un rafraîchissement LRU manqué.
  }
}

async function putBlob(db: IDBDatabase, messageId: string, kind: Kind, blob: Blob): Promise<boolean> {
  const record: BlobRecord = {
    key: keyFor(messageId, kind), messageId, kind, blob,
    sizeBytes: blob.size, storedAt: Date.now(), lastAccessedAt: Date.now(),
  };
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_BLOBS, 'readwrite');
      tx.objectStore(STORE_BLOBS).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    const meta = await getMeta(db);
    putMeta(db, { key: 'stats', totalBytes: meta.totalBytes + blob.size, count: meta.count + 1 });
    await evictIfNeeded(db);
    return true;
  } catch {
    // Quota dépassé ou autre échec d'écriture — une passe d'éviction puis un seul retry.
    try {
      await evictOldest(db, Math.max(20, Math.floor((await getMeta(db)).count * 0.2)));
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_BLOBS, 'readwrite');
        tx.objectStore(STORE_BLOBS).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      const meta = await getMeta(db);
      putMeta(db, { key: 'stats', totalBytes: meta.totalBytes + blob.size, count: meta.count + 1 });
      return true;
    } catch {
      return false;
    }
  }
}

async function evictIfNeeded(db: IDBDatabase) {
  const meta = await getMeta(db);
  if (meta.totalBytes <= MAX_BYTES && meta.count <= MAX_ENTRIES) return;
  await evictOldest(db, Math.max(10, meta.count - MAX_ENTRIES > 0 ? meta.count - MAX_ENTRIES : Math.ceil(meta.count * 0.1)));
}

async function evictOldest(db: IDBDatabase, atLeastN: number) {
  return new Promise<void>((resolve) => {
    let freed = 0;
    let deleted = 0;
    const tx = db.transaction([STORE_BLOBS, STORE_META], 'readwrite');
    const store = tx.objectStore(STORE_BLOBS);
    const idx = store.index('by_lastAccessedAt');
    const cursorReq = idx.openCursor();
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor || deleted >= atLeastN) {
        const metaReq = tx.objectStore(STORE_META).get('stats');
        metaReq.onsuccess = () => {
          const meta: MetaRecord = metaReq.result || { key: 'stats', totalBytes: 0, count: 0 };
          tx.objectStore(STORE_META).put({
            key: 'stats',
            totalBytes: Math.max(0, meta.totalBytes - freed),
            count: Math.max(0, meta.count - deleted),
          });
        };
        return;
      }
      const rec = cursor.value as BlobRecord;
      freed += rec.sizeBytes;
      deleted++;
      cursor.delete();
      cursor.continue();
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

async function deleteByMessageId(db: IDBDatabase, messageId: string) {
  return new Promise<void>((resolve) => {
    let freed = 0;
    let deleted = 0;
    const tx = db.transaction([STORE_BLOBS, STORE_META], 'readwrite');
    const store = tx.objectStore(STORE_BLOBS);
    const idx = store.index('by_messageId');
    const cursorReq = idx.openCursor(IDBKeyRange.only(messageId));
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) {
        const metaReq = tx.objectStore(STORE_META).get('stats');
        metaReq.onsuccess = () => {
          const meta: MetaRecord = metaReq.result || { key: 'stats', totalBytes: 0, count: 0 };
          tx.objectStore(STORE_META).put({
            key: 'stats',
            totalBytes: Math.max(0, meta.totalBytes - freed),
            count: Math.max(0, meta.count - deleted),
          });
        };
        return;
      }
      const rec = cursor.value as BlobRecord;
      freed += rec.sizeBytes;
      deleted++;
      cursor.delete();
      cursor.continue();
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
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

export function useBlobMediaCache() {
  const signedResolve = useSignedMediaUrls();

  const resolve = useCallback(async (
    messages: Array<{ id: string; type?: string }>,
    apply: (updates: Record<string, BlobResolvedUpdate>) => void,
  ) => {
    if (!USE_BLOB_CACHE) return signedResolve(messages, apply);

    const imageMsgs = messages.filter(m => m.type === 'image');
    const otherMsgs = messages.filter(m => m.type !== 'image');

    if (otherMsgs.length > 0) signedResolve(otherMsgs, apply);
    if (imageMsgs.length === 0) return;

    const db = await openDb();
    if (!db) { await signedResolve(imageMsgs, apply); return; }

    const keys = imageMsgs.flatMap(m => [keyFor(m.id, 'full'), keyFor(m.id, 'thumb')]);
    const records = await getRecords(db, keys);

    const fromCache: Record<string, BlobResolvedUpdate> = {};
    const toFetch: Array<{ id: string; type?: string }> = [];
    for (const m of imageMsgs) {
      const full = records.get(keyFor(m.id, 'full'));
      const thumb = records.get(keyFor(m.id, 'thumb'));
      // Un blob de taille 0 déjà en cache (téléchargement tronqué avant ce fix) ne doit
      // jamais être servi — on le traite comme absent pour forcer un nouveau téléchargement
      // au lieu de figer l'image cassée indéfiniment.
      if (full && full.blob.size > 0) {
        fromCache[m.id] = {
          url: acquireObjectUrl(keyFor(m.id, 'full'), full.blob),
          thumbnailUrl: (thumb && thumb.blob.size > 0) ? acquireObjectUrl(keyFor(m.id, 'thumb'), thumb.blob) : null,
        };
        touchRecord(db, full);
        if (thumb && thumb.blob.size > 0) touchRecord(db, thumb);
      } else {
        if (full) deleteByMessageId(db, m.id);
        toFetch.push(m);
      }
    }
    if (Object.keys(fromCache).length > 0) apply(fromCache);
    if (toFetch.length === 0) return;

    // Premier affichage sur cet appareil : passe par le cache d'URL signée existant, puis
    // télécharge les octets nous-mêmes (fetch(signedUrl)) pour les mettre en cache — un seul
    // GET réseau par image/thumb, jamais deux (le <img> affiche l'object URL, pas l'URL signée).
    await signedResolve(toFetch, async (signedUpdates) => {
      const finalUpdates: Record<string, BlobResolvedUpdate> = {};
      await Promise.all(Object.entries(signedUpdates).map(async ([id, u]) => {
        let finalUrl = u.url;
        let finalThumbUrl = u.thumbnailUrl;
        try {
          const res = await fetch(u.url);
          // res.ok=200 ne garantit pas un blob valide : sur mobile (réseau instable,
          // requête interrompue en arrière-plan) le body peut arriver tronqué/vide.
          // Un blob de taille 0 mis en cache IndexedDB restait cassé pour toujours
          // (jamais re-téléchargé ensuite) — d'où l'icône image cassée qui persistait
          // même après un refresh, uniquement sur les appareils où le 1er téléchargement
          // avait échoué de cette façon silencieuse.
          if (res.ok) {
            const blob = await res.blob();
            if (blob.size > 0) {
              const ok = await putBlob(db, id, 'full', blob);
              if (ok) finalUrl = acquireObjectUrl(keyFor(id, 'full'), blob);
            }
          }
        } catch {
          // Échec du fetch/cache — on garde l'URL signée brute, l'image reste affichable.
        }
        if (u.thumbnailUrl) {
          try {
            const resThumb = await fetch(u.thumbnailUrl);
            if (resThumb.ok) {
              const blobThumb = await resThumb.blob();
              if (blobThumb.size > 0) {
                const ok = await putBlob(db, id, 'thumb', blobThumb);
                if (ok) finalThumbUrl = acquireObjectUrl(keyFor(id, 'thumb'), blobThumb);
              }
            }
          } catch {
            // idem — repli sur l'URL signée du thumbnail.
          }
        }
        finalUpdates[id] = { url: finalUrl, thumbnailUrl: finalThumbUrl };
      }));
      apply(finalUpdates);
    });
  }, [signedResolve]);

  const release = useCallback((messageIds: string[]) => {
    for (const id of messageIds) {
      for (const kind of ['full', 'thumb'] as Kind[]) {
        const key = keyFor(id, kind);
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
      const key = keyFor(messageId, kind);
      const entry = objectUrlRegistry.get(key);
      if (entry) {
        URL.revokeObjectURL(entry.url);
        objectUrlRegistry.delete(key);
      }
    }
    openDb().then(db => { if (db) deleteByMessageId(db, messageId); });
  }, []);

  return { resolve, release, evictMessage };
}
