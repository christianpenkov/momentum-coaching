/**
 * Signaler un incident, et le filet qui les attrape sans qu'on ait à y penser.
 *
 * ── Ce que ce module fait ─────────────────────────────────────────────────────────
 *
 *   `signalerIncident()`   — écrit une occurrence dans `incidents` (RPC
 *                            `signaler_incident`), regroupée par empreinte. Ne lève
 *                            JAMAIS : un signalement qui plante la route qui signale
 *                            ajouterait une panne à la panne.
 *
 *   `installerFiletFetch()` — enveloppe `fetch` UNE fois par instance serveur
 *                            (`instrumentation.ts`). Toute réponse de Supabase en échec
 *                            devient un incident, que l'appelant lise son `{ error }` ou
 *                            non. C'est ce qui couvre les ~150 écritures non vérifiées
 *                            relevées par l'audit du 2026-09-13 sans les réécrire une
 *                            par une.
 *
 * ── Pourquoi la base, et pas un e-mail direct ───────────────────────────────────────
 *
 * L'écriture en base est rapide (une requête) et ne dépend que de ce qui est déjà en
 * panne ou pas. L'e-mail, lui, part d'un traitement SÉPARÉ (`/api/sante/dispatch`) :
 * une rafale de 500 erreurs dans une route fait 500 occurrences d'UN incident, et un
 * seul e-mail, au lieu d'épuiser le quota Resend (100/jour) avec les e-mails
 * d'authentification des élèves dedans.
 *
 * ── Pourquoi on ATTEND le signalement ──────────────────────────────────────────────
 *
 * Sur Vercel, une fonction peut être gelée dès que sa réponse part : une promesse non
 * attendue est perdue (doc Next, `onRequestError` : « make sure they're awaited »). Le
 * filet attend donc l'écriture avant de rendre la réponse en échec. Coût : quelques
 * centaines de millisecondes, UNIQUEMENT sur une requête déjà en échec, plafonnées à 3 s.
 */

import {
  classerReponseSupabase, empreinte, estBruitServeur, nettoyerCorps, nettoyerEntetes, nettoyerUrl, normaliserMessage,
  routeDepuisPile, routeEstCritique, tronquer, versionGraphSurclassee, type Gravite,
} from './incidentsClassement.ts';

const CLE_FETCH_ORIGINE = Symbol.for('momentum.incidents.fetch-origine');
const CLE_FILET = Symbol.for('momentum.incidents.filet-installe');
/** En-tête posé sur nos propres appels de signalement : le filet ne doit pas se regarder lui-même. */
export const ENTETE_SIGNALEMENT = 'x-momentum-incident';

export interface IncidentASignaler {
  /** 'vercel-serveur', 'vercel-navigateur', 'sante'… */
  source: string;
  gravite: Gravite;
  /** Lisible sans contexte : il devient l'objet de l'e-mail. */
  titre: string;
  /** Ce qui identifie « la même panne ». Jamais un identifiant de ligne, jamais une date. */
  empreinte: (string | null | undefined)[];
  /** Tout ce qui aide à corriger : message, pile, requête, réponse, route. */
  detail: Record<string, unknown>;
}

type Globale = typeof globalThis & { [CLE_FETCH_ORIGINE]?: typeof fetch; [CLE_FILET]?: boolean };

function fetchOrigine(): typeof fetch {
  return (globalThis as Globale)[CLE_FETCH_ORIGINE] ?? fetch;
}

/**
 * Anti-rafale par instance : une même empreinte n'est écrite qu'une fois par minute,
 * les occurrences suivantes sont comptées et reportées sur l'écriture d'après. Une
 * boucle d'erreurs dans une route ne doit pas se transformer en milliers de requêtes
 * vers la base — l'egress se paie au NOMBRE de requêtes (AGENTS.md).
 */
const recents = new Map<string, { a: number; enAttente: number }>();

export function versionDeployee(): string | null {
  return process.env.VERCEL_GIT_COMMIT_SHA ? process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 12) : null;
}

export async function signalerIncident(i: IncidentASignaler): Promise<void> {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const cle = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !cle) return;

    const emp = empreinte([i.source, ...i.empreinte]);
    const maintenant = Date.now();
    const precedent = recents.get(emp);
    if (precedent && maintenant - precedent.a < 60_000) {
      precedent.enAttente++;
      return;
    }
    const occurrences = 1 + (precedent?.enAttente ?? 0);
    if (recents.size > 500) recents.clear();
    recents.set(emp, { a: maintenant, enAttente: 0 });

    const version = versionDeployee();
    const detail = {
      ...i.detail,
      commit: version,
      deploiement: process.env.VERCEL_DEPLOYMENT_ID ?? null,
      environnement: process.env.VERCEL_ENV ?? (process.env.NODE_ENV === 'production' ? 'production' : 'local'),
      region: process.env.VERCEL_REGION ?? null,
      horodatage: new Date(maintenant).toISOString(),
    };

    const controleur = new AbortController();
    const minuterie = setTimeout(() => controleur.abort(), 3_000);
    try {
      await fetchOrigine()(`${url}/rest/v1/rpc/signaler_incident`, {
        method: 'POST',
        headers: {
          apikey: cle,
          authorization: `Bearer ${cle}`,
          'content-type': 'application/json',
          [ENTETE_SIGNALEMENT]: '1',
        },
        body: JSON.stringify({
          p_empreinte: emp,
          p_source: i.source,
          p_gravite: i.gravite,
          p_titre: tronquer(i.titre, 280),
          p_detail: detail,
          p_occurrences: occurrences,
          p_version: version,
        }),
        signal: controleur.signal,
        cache: 'no-store',
      });
    } finally {
      clearTimeout(minuterie);
    }
  } catch {
    // Silence délibéré, et c'est le seul du module : on ne peut pas signaler l'échec du
    // signalement par le même chemin. Si la base est injoignable, le battement externe
    // (`/api/sante/dispatch` → healthchecks.io) cesse, et c'est LUI qui prévient.
  }
}

/** Une exception quelconque, décrite pour un humain qui n'a pas le code sous les yeux. */
export function decrireErreur(e: unknown): { nom: string; message: string; pile: string | null; digest?: string } {
  if (e instanceof Error) {
    return {
      nom: e.name,
      message: tronquer(e.message, 2_000),
      pile: e.stack ? tronquer(e.stack, 6_000) : null,
      ...((e as { digest?: string }).digest ? { digest: (e as { digest?: string }).digest } : {}),
    };
  }
  return { nom: typeof e, message: tronquer(String(e), 2_000), pile: null };
}

/**
 * Une erreur non attrapée côté serveur (Server Component, Route Handler, Server Action).
 * Appelée par `onRequestError` d'`instrumentation.ts`.
 */
export async function signalerErreurServeur(
  erreur: unknown,
  requete: { path: string; method: string; headers: Record<string, string | string[] | undefined> },
  contexte: { routePath?: string; routeType?: string; renderSource?: string; routerKind?: string },
): Promise<void> {
  const e = decrireErreur(erreur);
  if (estBruitServeur({ name: e.nom, message: e.message })) return;
  const route = contexte.routePath ?? requete.path.split('?')[0];
  await signalerIncident({
    source: 'vercel-serveur',
    // Une exception non attrapée casse un écran ou une action pour de bon. Critique
    // partout : ce projet attrape ses erreurs attendues, une exception qui remonte
    // jusqu'ici est un défaut par définition.
    gravite: 'critique',
    titre: `Exception non attrapée — ${requete.method} ${route} : ${e.message.slice(0, 140)}`,
    empreinte: ['exception', route, e.nom, normaliserMessage(e.message)],
    detail: {
      type: 'exception_serveur',
      erreur: e,
      requete: {
        methode: requete.method,
        chemin: nettoyerUrl(requete.path),
        entetes: nettoyerEntetes(requete.headers),
      },
      contexte,
    },
  });
}

/**
 * Enveloppe `fetch` pour attraper toute réponse de Supabase en échec, et toute version
 * Graph API servie à la place d'une version expirée.
 *
 * ⚠️ Règles de construction, chacune est une garantie de ne RIEN casser :
 *   · une URL qui n'est ni Supabase ni Graph → `fetch` d'origine, sans rien toucher ;
 *   · la requête d'origine part TOUJOURS, une seule fois, avec ses arguments intacts ;
 *   · toute exception du filet lui-même est avalée, la réponse d'origine est rendue ;
 *   · une exception réseau de la requête d'origine est relancée telle quelle ;
 *   · la réponse est rendue non consommée (on lit une copie, `clone()`).
 *
 * Idempotent : un second appel ne ré-enveloppe pas. Les propriétés posées par Next sur
 * son propre `fetch` (`__nextPatched`…) sont recopiées sur l'enveloppe.
 */
export function installerFiletFetch(source = 'vercel-serveur'): void {
  const g = globalThis as Globale;
  if (g[CLE_FILET]) return;
  const origine = g.fetch;
  if (typeof origine !== 'function') return;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  g[CLE_FETCH_ORIGINE] = origine;
  const enveloppe = creerFiletFetch(origine, { supabaseUrl: supabaseUrl ?? null, source, signaler: signalerIncident });
  Object.assign(enveloppe, origine);
  g.fetch = enveloppe as typeof fetch;
  g[CLE_FILET] = true;
}

function aEntete(init: RequestInit | undefined, input: unknown, nom: string): boolean {
  try {
    const h = init?.headers ?? (input instanceof Request ? input.headers : undefined);
    if (!h) return false;
    if (h instanceof Headers) return h.has(nom);
    if (Array.isArray(h)) return h.some(([k]) => k.toLowerCase() === nom);
    return Object.keys(h).some((k) => k.toLowerCase() === nom);
  } catch {
    return false;
  }
}

/**
 * Le cœur du filet, séparé de l'installation pour être testé avec un faux `fetch`
 * (`lib/incidents.test.ts`) — on ne touche pas au `fetch` global dans un test.
 */
export function creerFiletFetch(
  origine: typeof fetch,
  options: {
    supabaseUrl: string | null;
    source: string;
    signaler: (i: IncidentASignaler) => Promise<void>;
    /**
     * Toute requête refusée est critique, lecture comprise. Pour les Edge Functions : ce
     * sont des traitements de fond, sans écran pour montrer un vide, et une lecture
     * refusée y a déjà coûté cher (send-pending-dm3 effaçait les DM3 en attente quand la
     * lecture des jetons échouait).
     */
    toujoursCritique?: boolean;
  },
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  return async function fetchSurveille(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    let url: string;
    let methode: string;
    try {
      url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      methode = String(init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    } catch {
      return origine(input, init);
    }

    const supabase = !!options.supabaseUrl && url.startsWith(options.supabaseUrl) && !aEntete(init, input, ENTETE_SIGNALEMENT);
    const graph = url.startsWith('https://graph.facebook.com/') || url.startsWith('https://graph.instagram.com/');
    if (!supabase && !graph) return origine(input, init);

    // La pile se capture AVANT l'attente : après, la chaîne d'appel qui mène à la route
    // est perdue. C'est elle qui dit QUELLE route a écrit.
    // La limite par défaut de V8 est de 10 cadres : sous Next, les couches internes
    // (supabase-js, postgrest, patch fetch de Next) les consomment tous, et la route ne
    // figurait plus dans la pile (relecture adversariale du 2026-09-13). On la relève le
    // temps de la capture seulement.
    let pile: string | null = null;
    if (supabase) {
      const limite = Error.stackTraceLimit;
      try { Error.stackTraceLimit = 40; pile = new Error().stack ?? null; } finally { Error.stackTraceLimit = limite; }
    }

    let reponse: Response;
    try {
      reponse = await origine(input, init);
    } catch (e) {
      try {
        const err = decrireErreur(e);
        if (supabase && !estBruitServeur({ name: err.nom, message: err.message })) {
          const route = routeDepuisPile(pile);
          await options.signaler({
            source: options.source,
            // Même raisonnement que les hoquets de passerelle (lib/incidentsClassement.ts,
            // `passerelle`) : une coupure réseau isolée ne s'actionne pas, et une coupure
            // qui dure est vue par le silence des crons et du battement externe. Normale,
            // et UNE empreinte pour toutes les tables.
            gravite: 'normale',
            titre: `Supabase injoignable (${err.nom}) — hoquet réseau vers la base`,
            empreinte: ['supabase-reseau', err.nom],
            detail: { type: 'supabase_injoignable', methode, url: nettoyerUrl(url), route, erreur: err, pile_appel: pile ? tronquer(pile, 4_000) : null },
          });
        }
      } catch { /* le filet ne casse jamais la requête */ }
      throw e;
    }

    try {
      if (supabase && reponse.status >= 400) {
        const corps = await reponse.clone().text().catch(() => null);
        const c = classerReponseSupabase({ methode, url, statut: reponse.status, corps });
        if (c) {
          const route = routeDepuisPile(pile);
          const gravite: Gravite = c.passerelle ? 'normale'
            : options.toujoursCritique || c.gravite === 'critique' || routeEstCritique(route) ? 'critique' : 'normale';
          const action = c.service === 'rpc' ? `rpc ${c.cible}()` : `${methode} ${c.cible}`;
          await options.signaler({
            source: options.source,
            gravite,
            titre: c.passerelle
              ? `Passerelle Supabase en HTTP ${reponse.status} (${c.message.slice(0, 60)}) — hoquet d’infrastructure, dernier cas sur ${action}`
              : `${c.service === 'storage' ? 'Stockage' : 'Base'} refusée — ${action}${route ? ` depuis ${route}` : ''} : ${c.message.slice(0, 120)}`,
            empreinte: c.passerelle
              ? ['supabase-passerelle', String(reponse.status)]
              : ['supabase', c.service, c.cible, methode, c.code, route, normaliserMessage(c.message)],
            detail: {
              type: 'supabase_refus',
              methode,
              url: nettoyerUrl(url),
              statut: reponse.status,
              code: c.code,
              message: c.message,
              details: c.details,
              hint: c.hint,
              route,
              corps_requete: typeof init?.body === 'string' ? nettoyerCorps(init.body) : null,
              corps_reponse: nettoyerCorps(corps),
              pile_appel: pile ? tronquer(pile, 4_000) : null,
            },
          });
        }
      }
      if (graph) {
        const v = versionGraphSurclassee(url, reponse.headers.get('facebook-api-version'));
        if (v) {
          await options.signaler({
            source: options.source,
            gravite: 'normale',
            titre: `Graph API ${v.demandee} expirée : Meta sert ${v.servie} à la place, sans erreur`,
            empreinte: ['graph-version', v.demandee, v.servie],
            detail: {
              type: 'graph_version_surclassee',
              demandee: v.demandee,
              servie: v.servie,
              url: nettoyerUrl(url).split('?')[0],
              a_faire: 'Remplacer la version dans le code (voir versions_api_sante) et refaire l’audit des métriques Instagram concernées : le comportement a pu changer.',
            },
          });
        }
      }
    } catch { /* le filet ne casse jamais la requête */ }

    return reponse;
  };
}
