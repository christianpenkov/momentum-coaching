/**
 * Signaler un incident depuis le navigateur.
 *
 * Le navigateur ne décide de RIEN : il envoie des faits bruts (message, pile, requête
 * Supabase refusée) à `/api/sante/incident-client`, qui classe, borne et écrit. Un
 * navigateur n'est pas une source de confiance — n'importe qui peut poster n'importe
 * quoi — donc la gravité et l'empreinte se calculent côté serveur.
 *
 * Pourquoi c'est utile quand même : les écrans lisent Supabase EN DIRECT avec la clé
 * anon. Une colonne renommée rend HTTP 400, l'erreur non lue devient une liste vide, et
 * l'écran montre une absence au lieu d'une panne (docs/requetes-qui-echouent-en-silence.md :
 * le journal des ventes a été vide « depuis toujours » pour cette raison). Aucun serveur
 * ne voit passer ces requêtes-là : seul le navigateur peut les rapporter.
 */

import { classerReponseSupabase, estBruitNavigateur } from './incidentsClassement.ts';

export type SignalementNavigateur =
  | { type: 'rendu'; message: string; nom?: string; pile?: string | null; digest?: string | null; chemin: string; globale?: boolean }
  | { type: 'fenetre' | 'promesse'; message: string; nom?: string; pile?: string | null; fichier?: string | null; ligne?: number | null; colonne?: number | null; chemin: string }
  | { type: 'supabase'; methode: string; url: string; statut: number; corps: string | null; chemin: string };

/** Plafond par chargement de page : une boucle d'erreurs ne doit pas marteler la route. */
const PLAFOND_PAR_PAGE = 10;
let envoyes = 0;
const vus = new Map<string, number>();

export function signalerDepuisNavigateur(s: SignalementNavigateur): void {
  try {
    if (typeof window === 'undefined') return;
    if (envoyes >= PLAFOND_PAR_PAGE) return;
    if (s.type !== 'supabase' && s.type !== 'rendu' && estBruitNavigateur(s.message, 'fichier' in s ? s.fichier : null)) return;

    const cle = s.type === 'supabase' ? `${s.methode} ${s.url.split('?')[0]} ${s.statut}` : `${s.type} ${s.message}`;
    const maintenant = Date.now();
    if ((vus.get(cle) ?? 0) > maintenant - 60_000) return;
    vus.set(cle, maintenant);
    envoyes++;

    const corps = JSON.stringify(s).slice(0, 12_000);
    // `keepalive` : l'envoi survit à une navigation ou à la fermeture de l'onglet, et
    // passe par `fetch` d'origine — une URL de la plateforme, jamais regardée par le filet.
    const origine = (window as unknown as { __momentumFetchOrigine?: typeof fetch }).__momentumFetchOrigine ?? window.fetch;
    origine.call(window, '/api/sante/incident-client', {
      method: 'POST',
      keepalive: true,
      headers: { 'content-type': 'application/json' },
      body: corps,
    }).catch(() => {});
  } catch {
    // Le signalement ne doit jamais casser l'écran qu'il décrit.
  }
}

/**
 * Enveloppe `window.fetch` pour rapporter les réponses Supabase en échec.
 * Mêmes garanties que le filet serveur (lib/incidents.ts) : la requête d'origine part
 * une fois, intacte, et la réponse est rendue non consommée.
 */
export function installerFiletNavigateur(): void {
  try {
    if (typeof window === 'undefined') return;
    const w = window as unknown as { __momentumFiletInstalle?: boolean; __momentumFetchOrigine?: typeof fetch };
    if (w.__momentumFiletInstalle) return;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl) return;

    const origine = window.fetch;
    w.__momentumFetchOrigine = origine;

    const enveloppe = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      let url: string;
      let methode: string;
      try {
        url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        methode = String(init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
      } catch {
        return origine.call(window, input, init);
      }
      if (!url.startsWith(supabaseUrl)) return origine.call(window, input, init);

      const reponse = await origine.call(window, input, init);
      try {
        if (reponse.status >= 400) {
          const copie = reponse.clone();
          // Lecture en arrière-plan : l'écran n'attend pas le rapport.
          copie.text().then((corps) => {
            if (!classerReponseSupabase({ methode, url, statut: reponse.status, corps })) return;
            signalerDepuisNavigateur({
              type: 'supabase', methode, url, statut: reponse.status,
              corps: corps.slice(0, 2_000), chemin: location.pathname,
            });
          }).catch(() => {});
        }
      } catch { /* jamais bloquant */ }
      return reponse;
    };
    window.fetch = enveloppe as typeof fetch;
    w.__momentumFiletInstalle = true;
  } catch {
    // Un filet qui ne s'installe pas laisse la plateforme exactement comme avant.
  }
}
