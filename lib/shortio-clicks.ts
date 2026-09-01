/**
 * Lecture du flux de clics Short.io — source unique, partagée par le cron (Deno) et
 * par le bouton « Rafraîchir » (Node).
 *
 * Trois choses mesurées le 2026-08-28 sur des domaines réels justifient ce module :
 *
 * 1. **Le flux est saturé de bruit.** Sur 7 jours, 368 entrées renvoyées pour un
 *    domaine, dont 349 sont des scans automatisés sur `/*` répondus en 404 — et
 *    Short.io les marque `human: true`. Filtrer sur `human` ne suffit donc pas : il
 *    faut filtrer sur le statut HTTP et sur un path exploitable.
 *
 * 2. **Le plafond `limit` est mangé par ce bruit.** Une requête sur 30 jours saturait
 *    pile à 500 entrées, rendant les clics de plus de 13 jours inatteignables. D'où la
 *    pagination.
 *
 * 3. **`beforeDate` est inclusif** : la page suivante renvoie le dernier clic de la
 *    précédente. D'où la déduplication par (dt, path, ip).
 *
 * Et surtout, la règle de date : **un clic appartient au jour PARIS de son propre
 * horodatage**. C'est la seule définition qui coïncide avec `getPeriodWindow`, donc
 * avec ce qu'affiche l'écran. Se fier au découpage de Short.io (`period=yesterday`,
 * calendrier UTC) faisait atterrir les clics de J-2 sur la ligne de J-1 à chaque
 * passage tombant entre minuit Paris et minuit UTC : 13 liens sur 18 portaient leurs
 * clics sur deux jours consécutifs, soit ~39 % de clics fantômes.
 */

export interface ClicShortio {
  path?: string;
  dt?: string;
  human?: boolean;
  st?: number | string;
  ip?: string;
}

export const CLICS_PAR_PAGE = 500;
/** 8 pages = 4000 entrées par domaine et par passage, bruit compris. */
export const PAGES_MAX = 8;

/** Un vrai clic sur un lien existant : statut HTTP < 400 et path exploitable. */
export function estVraiClic(c: ClicShortio): boolean {
  const st = Number(c.st);
  if (!Number.isFinite(st) || st >= 400) return false;
  const p = (c.path || '').replace(/^\//, '');
  return !!p && p !== '*';
}

export interface ResultatFlux {
  clics: ClicShortio[];
  /** `true` = on n'a PAS la certitude d'avoir tout vu. Ne jamais réécrire une journée close dans ce cas. */
  tronque: boolean;
}

/**
 * Récupère tous les clics d'un domaine depuis `afterIso`, en paginant.
 * `executer` permet à l'appelant d'injecter son limiteur de débit.
 */
export async function fetchClicsShortio(
  domainId: string | number,
  apiKey: string,
  afterIso: string,
  executer: (fn: () => Promise<Response>) => Promise<Response> = fn => fn(),
): Promise<ResultatFlux> {
  const vus = new Set<string>();
  const out: ClicShortio[] = [];
  let beforeIso: string | null = null;

  for (let page = 0; page < PAGES_MAX; page++) {
    const body: Record<string, unknown> = { limit: CLICS_PAR_PAGE, afterDate: afterIso };
    if (beforeIso) body.beforeDate = beforeIso;
    const res = await executer(() => fetch(
      `https://api-v2.short.io/statistics/domain/${domainId}/last_clicks`,
      {
        method: 'POST',
        headers: { authorization: apiKey, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
      },
    ));
    if (!res.ok) throw new Error(`last_clicks HTTP ${res.status}`);
    let data: unknown;
    try { data = await res.json(); } catch { throw new Error('last_clicks reponse illisible'); }
    const lot: ClicShortio[] = Array.isArray(data) ? data : ((data as { clicks?: ClicShortio[] })?.clicks ?? []);

    let nouveaux = 0;
    for (const c of lot) {
      const cle = `${c.dt}|${c.path}|${c.ip ?? ''}`;
      if (vus.has(cle)) continue;
      vus.add(cle); out.push(c); nouveaux++;
    }
    // Page incomplète : on a atteint le bord de la fenêtre, rien ne manque.
    if (lot.length < CLICS_PAR_PAGE) return { clics: out, tronque: false };
    // Page pleine mais aucune nouveauté : `beforeDate` ne progresse plus (trop de clics
    // au même horodatage). On s'arrête en le signalant plutôt que de boucler.
    if (nouveaux === 0) return { clics: out, tronque: true };
    beforeIso = lot[lot.length - 1].dt ?? null;
    if (!beforeIso) return { clics: out, tronque: true };
  }
  return { clics: out, tronque: true };
}

/**
 * Agrège un flux de clics en compteurs par (domaine, path, jour).
 *
 * ⚠️ **Le domaine fait partie de la clé, et ce n'est pas cosmétique.** Un élève qui a
 * changé de domaine Short.io garde le MÊME chemin sur les deux — `bio-calendly-ig`
 * existe sur `link.ubizenai.com` et sur `ubizenai.s.gy`. Ce sont deux liens
 * différents, avec deux `link_id` différents et deux comptes de clics différents.
 *
 * La clé était `path|jour`. Le flux est pourtant récupéré DOMAINE PAR DOMAINE :
 * l'information était disponible dans la boucle et perdue à la ligne suivante. Les
 * totaux des domaines se retrouvaient donc additionnés sous une seule clé, puis ce
 * total unique était réécrit sur CHAQUE lien partageant le chemin.
 *
 * Mesuré le 2026-09-01 : `bio-calendly-ig` portait 15 clics sur les deux domaines,
 * soit 30 en base pour 15 requêtes réellement reçues. Le lien dormant de l'ancien
 * domaine se voyait attribuer le trafic du lien publié.
 *
 * `jourDe` convertit un horodatage ISO en date calendaire Paris — fourni par
 * l'appelant, chaque runtime ayant déjà sa propre implémentation éprouvée.
 */
export function agregerClics(
  clics: ClicShortio[],
  jourDe: (iso: string) => string,
  domaine: string,
): { parPathEtJour: Map<string, { human: number; total: number }>; jourLePlusAncienVu: string | null } {
  const parPathEtJour = new Map<string, { human: number; total: number }>();
  let jourLePlusAncienVu: string | null = null;
  for (const c of clics) {
    if (!c.dt) continue;
    const jour = jourDe(c.dt);
    // Calculé sur TOUTES les entrées, bruit compris : il borne les journées qu'on
    // s'autorise à réécrire, et le bruit prouve tout autant que le flux couvrait ce
    // jour-là.
    if (!jourLePlusAncienVu || jour < jourLePlusAncienVu) jourLePlusAncienVu = jour;
    if (!estVraiClic(c)) continue;
    const path = (c.path || '').replace(/^\//, '');
    const k = cleClic(domaine, path, jour);
    const cur = parPathEtJour.get(k) ?? { human: 0, total: 0 };
    cur.total += 1;
    if (c.human) cur.human += 1;
    parPathEtJour.set(k, cur);
  }
  return { parPathEtJour, jourLePlusAncienVu };
}

export function cleClic(domaine: string, path: string, jour: string): string {
  return `${domaine}|${path}|${jour}`;
}

/**
 * Hôte d'un lien, pour composer la clé du côté LECTURE.
 *
 * Le côté écriture connaît son domaine (il boucle dessus) ; le côté lecture ne
 * dispose que du lien, dont l'URL courte porte l'hôte. Les deux doivent produire la
 * même chaîne, d'où cette fonction unique plutôt que deux extractions parallèles.
 */
export function hoteDuLien(shortUrl: string | null | undefined, defaut: string): string {
  try {
    return new URL(shortUrl || '').hostname || defaut;
  } catch {
    return defaut;
  }
}
