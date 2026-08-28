/**
 * Contrôle de débit pour les API externes (Short.io en premier lieu).
 *
 * Problème constaté EN PROD À 4 ÉLÈVES (voir poll-leads/index.ts, commentaire
 * « x-ratelimit-remaining=0 … 2 autres profils ont ubizenai.s.gy ») : le cron
 * traitait tous les profils en `Promise.all` non borné, et chaque profil émettait
 * un appel Short.io par lien. Short.io plafonne à ~60 requêtes par fenêtre, par
 * clé/domaine — et plusieurs profils partagent le même domaine, donc se
 * cannibalisent. À 30 élèves × ~20 liens, on émet 600+ requêtes en rafale : dix
 * fois le quota.
 *
 * Trois mécanismes SUPERPOSÉS, parce qu'aucun ne suffit seul :
 *
 *  1. Sémaphore — borne le nombre d'appels SIMULTANÉS. Ne borne pas le débit :
 *     5 appels très rapides en boucle respectent « 5 à la fois » tout en
 *     dépassant « 60 par minute ».
 *  2. Token bucket — borne le DÉBIT (jetons régénérés à taux fixe). Ne borne pas
 *     la simultanéité : 60 jetons disponibles d'un coup partiraient ensemble.
 *  3. Backoff exponentiel + jitter sur 429 — filet de sécurité. Indispensable
 *     même avec 1 et 2 : on ne connaît pas les autres consommateurs de la clé
 *     API, et le serveur peut changer ses limites. Le jitter (délai aléatoire)
 *     évite que tous les retries repartent au même instant.
 *
 * Le budget d'une Edge Function est de 150 s sur le plan gratuit : toutes les
 * attentes sont plafonnées pour ne jamais le consommer entièrement.
 */

export interface RateLimiterOptions {
  /** Appels simultanés maximum. */
  concurrency: number;
  /** Jetons par fenêtre (le quota de l'API). */
  tokensPerInterval: number;
  /** Durée de la fenêtre, en ms. */
  intervalMs: number;
  /** Attente maximale sur un 429, en ms. */
  maxRetryWaitMs?: number;
  /** Tentatives supplémentaires après un 429. */
  maxRetries?: number;
}

export class RateLimiter {
  private available: number;
  private lastRefill: number;
  private active = 0;
  private queue: (() => void)[] = [];
  private readonly opts: Required<RateLimiterOptions>;

  constructor(opts: RateLimiterOptions) {
    this.opts = {
      maxRetryWaitMs: 30_000,
      maxRetries: 2,
      ...opts,
    };
    this.available = opts.tokensPerInterval;
    this.lastRefill = Date.now();
  }

  private refill() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed <= 0) return;
    // Régénération continue plutôt que par paliers : évite les rafales au moment
    // exact où la fenêtre bascule.
    const regenerated = (elapsed / this.opts.intervalMs) * this.opts.tokensPerInterval;
    if (regenerated >= 0.001) {
      this.available = Math.min(this.opts.tokensPerInterval, this.available + regenerated);
      this.lastRefill = now;
    }
  }

  /** Attend qu'un jeton soit disponible (token bucket). */
  private async takeToken(): Promise<void> {
    for (;;) {
      this.refill();
      if (this.available >= 1) { this.available -= 1; return; }
      // Délai jusqu'au prochain jeton, borné pour rester réactif.
      const msPerToken = this.opts.intervalMs / this.opts.tokensPerInterval;
      const wait = Math.min(Math.ceil(msPerToken), 2_000);
      await sleep(wait);
    }
  }

  /** Réserve une place de concurrence (sémaphore). */
  private acquireSlot(): Promise<void> {
    if (this.active < this.opts.concurrency) { this.active += 1; return Promise.resolve(); }
    return new Promise<void>(resolve => this.queue.push(() => { this.active += 1; resolve(); }));
  }

  private releaseSlot() {
    this.active -= 1;
    const next = this.queue.shift();
    if (next) next();
  }

  /**
   * Exécute `fn` sous sémaphore + token bucket, avec retry sur 429.
   *
   * `fn` doit RE-créer sa requête à chaque appel (une Response ne se rejoue pas).
   * Le délai d'attente privilégie l'en-tête `x-ratelimit-reset` renvoyé par
   * Short.io — c'est le vrai temps de reset, bien plus fiable qu'un délai deviné.
   */
  async run(fn: () => Promise<Response>): Promise<Response> {
    await this.acquireSlot();
    try {
      let attempt = 0;
      for (;;) {
        await this.takeToken();
        const res = await fn();
        if (res.status !== 429 || attempt >= this.opts.maxRetries) return res;

        const resetSeconds = Number(res.headers.get('x-ratelimit-reset'));
        const base = Number.isFinite(resetSeconds) && resetSeconds > 0
          ? resetSeconds * 1000 + 1_000
          : 1_000 * 2 ** attempt; // backoff exponentiel si l'en-tête manque
        // Jitter : sans lui, tous les appels bloqués repartent au même instant et
        // re-saturent immédiatement le quota.
        const jitter = Math.random() * 500;
        await sleep(Math.min(base + jitter, this.opts.maxRetryWaitMs));
        // Un 429 signifie que le bucket local était trop optimiste : on le vide
        // pour se resynchroniser sur la réalité du serveur.
        this.available = 0;
        this.lastRefill = Date.now();
        attempt += 1;
      }
    } finally {
      this.releaseSlot();
    }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Limiteur Short.io — UN PAR COMPTE Short.io, pas un seul pour tout le run.
 *
 * Le quota Short.io se partage entre les profils qui interrogent le MÊME compte
 * (constaté en prod le 2026-08-14 : deux profils sur `ubizenai.s.gy` se
 * cannibalisaient). D'où un limiteur partagé au départ.
 *
 * Mais un limiteur UNIQUE pour tout le run transforme ce garde-fou en goulot : en
 * production chaque élève connecte SON propre compte Short.io, donc dispose de SON
 * propre quota. Faire passer 40 élèves dans un seul seau de 50 jetons/minute impose
 * un plafond global de 50 appels/minute à toute la plateforme, alors que la limite
 * réelle est de 50/minute × 40 comptes.
 *
 * On indexe donc le limiteur sur le DOMAINE interrogé, qui identifie le compte : deux
 * profils sur le même domaine partagent leur seau (comportement d'origine, correct),
 * deux profils sur des comptes distincts ne se gênent plus.
 *
 * Mesure du 2026-08-28 : 70 appels légers (`limit: 1`) d'affilée sur un même domaine
 * ne déclenchent AUCUN 429 et ne renvoient aucun en-tête `x-ratelimit-*`, alors qu'un
 * seul appel `limit: 500` en a déclenché un. Le débit toléré dépend donc du COÛT des
 * requêtes, pas seulement de leur nombre — raison de plus pour garder le backoff sur
 * 429 comme filet réel, et le seau comme simple garde-fou.
 */
const limiteursParDomaine = new Map<string, RateLimiter>();

export function limiteurShortio(cleCompte: string | number): RateLimiter {
  const k = String(cleCompte);
  let l = limiteursParDomaine.get(k);
  if (!l) { l = createShortioLimiter(); limiteursParDomaine.set(k, l); }
  return l;
}

export function createShortioLimiter(): RateLimiter {
  return new RateLimiter({
    concurrency: 5,
    tokensPerInterval: 50,
    intervalMs: 60_000,
    maxRetryWaitMs: 30_000,
    maxRetries: 2,
  });
}

/**
 * Exécute des tâches avec une concurrence bornée, en préservant l'ordre des
 * résultats. Remplace `Promise.all(items.map(...))` quand le nombre d'éléments
 * croît avec le nombre d'élèves.
 *
 * Ne rejette jamais : chaque tâche est encapsulée comme `Promise.allSettled`,
 * pour qu'un profil en échec n'annule pas les autres.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let cursor = 0;

  async function worker() {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        results[i] = { status: 'fulfilled', value: await fn(items[i], i) };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}
