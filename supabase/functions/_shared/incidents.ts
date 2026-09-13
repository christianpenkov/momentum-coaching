// Incidents des Edge Functions — le même filet que Vercel, dans le runtime Deno.
//
// ── Pourquoi ─────────────────────────────────────────────────────────────────────────
//
// L'audit du 2026-09-13 a relevé, dans les Edge Functions :
//   · trois fonctions qui n'écrivent JAMAIS dans `cron_runs` (poll-stories,
//     fathom-cron-sync, call-reminders) — leurs erreurs finissaient dans un journal de
//     debug purgé à 14 jours, ou nulle part ;
//   · des plantages de fond (`runMain_fatal`) qui ne laissaient qu'un `console.error`,
//     gardé UN jour par Supabase sur le plan gratuit ;
//   · des écritures qui ignorent leur `{ error }` : l'enregistrement d'un rendez-vous
//     Calendly, du registre CTR YouTube (double comptage au passage suivant), des leads
//     Instagram, des enregistrements Fathom.
//
// ── Ce que ce module pose ───────────────────────────────────────────────────────────
//
//   `servirAvecFilet(nom, handler)` — à passer à `Deno.serve`. Il installe le filet
//      `fetch` (toute réponse Supabase en échec devient un incident CRITIQUE), écoute
//      les rejets de promesse non gérés, et transforme une exception du gestionnaire en
//      incident + réponse 500 au lieu d'une trace perdue.
//   `signalerExceptionEdge(nom, erreur, contexte)` — pour les `catch` qui avalent une
//      panne qui compte (ex. `runMain().catch(...)`).
//
// ⚠️ La logique du filet n'est PAS recopiée ici : elle est importée de `lib/incidents.ts`
// et `lib/incidentsClassement.ts`, lus tels quels par Vercel et par Deno. Une copie par
// runtime aurait été le mode de panne dominant de ce projet (docs/deploiement-et-
// verifications.md, « copies figées »). Corollaire : modifier l'un de ces deux fichiers
// change l'empreinte de TOUTES les fonctions, qui devront être redéployées — c'est
// `edge_sante_version` qui le rappellera.

import { creerFiletFetch, decrireErreur, ENTETE_SIGNALEMENT, type IncidentASignaler } from '../../../lib/incidents.ts';
import { empreinte, estBruitServeur, normaliserMessage, tronquer } from '../../../lib/incidentsClassement.ts';
import { EMPREINTES_EDGE } from '../../../lib/empreintes-edge.generated.ts';

const CLE_FILET = Symbol.for('momentum.incidents.filet-edge');
type Globale = typeof globalThis & { [CLE_FILET]?: boolean };

let fetchOrigine: typeof fetch = globalThis.fetch;
const recents = new Map<string, { a: number; enAttente: number }>();

/** Écrit une occurrence dans `incidents`. Ne lève jamais. */
export async function signalerIncidentEdge(nom: string, i: IncidentASignaler): Promise<void> {
  try {
    const url = Deno.env.get('SUPABASE_URL');
    const cle = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !cle) return;

    const emp = empreinte([i.source, ...i.empreinte]);
    const maintenant = Date.now();
    const precedent = recents.get(emp);
    if (precedent && maintenant - precedent.a < 60_000) { precedent.enAttente++; return; }
    const occurrences = 1 + (precedent?.enAttente ?? 0);
    if (recents.size > 500) recents.clear();
    recents.set(emp, { a: maintenant, enAttente: 0 });

    // La « version » d'une Edge Function est l'empreinte de son code : c'est ce qui
    // change à un redéploiement, et ce qui réarme un incident critique qui y survit.
    const version = (EMPREINTES_EDGE as Record<string, string>)[nom] ?? null;
    const controleur = new AbortController();
    const minuterie = setTimeout(() => controleur.abort(), 3_000);
    try {
      await fetchOrigine(`${url}/rest/v1/rpc/signaler_incident`, {
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
          p_detail: { ...i.detail, fonction: nom, empreinte_du_code: version, horodatage: new Date(maintenant).toISOString() },
          p_occurrences: occurrences,
          p_version: version,
        }),
        signal: controleur.signal,
      });
    } finally {
      clearTimeout(minuterie);
    }
  } catch {
    // Pas de signalement du signalement : si la base est injoignable, le battement
    // externe du répartiteur cesse, et c'est lui qui prévient.
  }
}

/** Une exception qu'un traitement de fond a attrapée et qu'il aurait sinon seulement journalisée. */
export async function signalerExceptionEdge(nom: string, erreur: unknown, contexte: string): Promise<void> {
  const e = decrireErreur(erreur);
  if (estBruitServeur({ name: e.nom, message: e.message })) return;
  await signalerIncidentEdge(nom, {
    source: `edge:${nom}`,
    gravite: 'critique',
    titre: `Edge Function ${nom} — ${contexte} : ${e.message.slice(0, 140)}`,
    empreinte: ['edge-exception', nom, contexte, e.nom, normaliserMessage(e.message)],
    detail: { type: 'edge_exception', contexte, erreur: e },
  });
}

function installerFilet(nom: string) {
  const g = globalThis as Globale;
  if (g[CLE_FILET]) return;
  fetchOrigine = globalThis.fetch;
  const enveloppe = creerFiletFetch(fetchOrigine, {
    supabaseUrl: Deno.env.get('SUPABASE_URL') ?? null,
    source: `edge:${nom}`,
    signaler: (i) => signalerIncidentEdge(nom, i),
    toujoursCritique: true,
  });
  globalThis.fetch = enveloppe as typeof fetch;
  g[CLE_FILET] = true;

  // Un rejet de promesse que personne n'attend (tâche de fond lancée sans `await`).
  addEventListener('unhandledrejection', (ev: PromiseRejectionEvent) => {
    const tache = signalerExceptionEdge(nom, ev.reason, 'promesse rejetée non gérée');
    try { (globalThis as unknown as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime?.waitUntil(tache); } catch { /* hors Supabase */ }
  });
}

/**
 * Enveloppe le gestionnaire passé à `Deno.serve`.
 *
 * ⚠️ Garanties : la requête est traitée par le gestionnaire d'origine, sans rien
 * changer à sa réponse. Seule une exception qui s'en échappe est interceptée — elle
 * aurait produit un 500 de toute façon ; elle produit maintenant le même 500 ET un
 * incident avec sa pile.
 */
export function servirAvecFilet(
  nom: string,
  gestionnaire: (req: Request) => Response | Promise<Response>,
): (req: Request) => Promise<Response> {
  try { installerFilet(nom); } catch { /* un filet absent laisse la fonction exactement comme avant */ }
  return async (req: Request) => {
    try {
      return await gestionnaire(req);
    } catch (erreur) {
      await signalerExceptionEdge(nom, erreur, 'exception non attrapée du gestionnaire');
      return new Response(JSON.stringify({ error: 'erreur interne', detail: decrireErreur(erreur).message }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }
  };
}
