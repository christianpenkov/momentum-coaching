// Import relatif AVEC extension : `npm test` exécute node --test directement sur les
// sources, sans résolution de l'alias `@/`. C'est la contrainte qui rend ce module
// testable — voir les autres lib/*.test.ts.
import { parisDateStr, parisAddDays } from './period.ts';

// Découpage jour par jour des séries de calls — règle unique pour l'onglet
// « Funnel & Calls ».
//
// Elle existe parce qu'elle avait divergé en trois endroits du même écran
// (audit du 2026-08-29) :
//   • les modales du hero comparaient `new Date('YYYY-MM-DD')` — interprété en
//     UTC — à des jours produits par parisDateStr, donc décalés d'une à deux
//     heures selon la saison ;
//   • les modales du tableau d'efficacité découpaient sur le préfixe UTC de
//     `scheduled_at`, la date du RENDEZ-VOUS, alors que le total qu'elles
//     détaillent est filtré sur `booked_at`, la date de RÉSERVATION ;
//   • les deux bouclaient sur le mois en cours même en mode All-Time, si bien
//     qu'une carte à 17 ouvrait une courbe qui n'en totalisait que 9.
//
// Voir docs/perimetre-stats-referentiel.md, règle 2, pour le choix de booked_at.

type DatedCall = { booked_at?: string | null; scheduled_at?: string | null };

/** Date de rattachement d'un call à une journée : la réservation, repli sur la
 *  tenue du rendez-vous pour les calls anciens importés sans `booked_at`. */
export function callDayKey(c: DatedCall): string | null {
  const d = c.booked_at ?? c.scheduled_at;
  if (!d) return null;
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return null;
  return parisDateStr(t);
}

/** Index « jour de Paris → calls réservés ce jour-là ». */
export function bucketCallsByBookedDay<T extends DatedCall>(calls: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const c of calls) {
    const key = callDayKey(c);
    if (!key) continue;
    const arr = m.get(key);
    if (arr) arr.push(c); else m.set(key, [c]);
  }
  return m;
}

/** Tous les jours de Paris compris entre deux instants, bornes incluses. */
export function parisDayRange(start: Date, end: Date): string[] {
  const days: string[] = [];
  const finStr = parisDateStr(end);
  let d = start;
  while (parisDateStr(d) <= finStr) {
    days.push(parisDateStr(d));
    d = parisAddDays(d, 1);
  }
  return days;
}

/** Un taux n'existe pas sans dénominateur : `null` (un trou), jamais `0` — qui
 *  affirmerait « ce jour-là la performance était nulle » pour un jour sans
 *  aucune mesure. */
export function tauxOuTrou(numerateur: number, denominateur: number): number | null {
  if (denominateur <= 0) return null;
  return (numerateur / denominateur) * 100;
}

// ─── Continuation : le 2e rendez-vous d'un MEME prospect ─────────────────────
//
// Le close rate se calcule par OPPORTUNITE, pas par rendez-vous. C'est la reponse
// unanime du marche (Guideflow, Trellus) : une opportunite compte UNE fois au
// denominateur, quel que soit le nombre de rendez-vous qu'elle contient. Le
// no-show, lui, reste par REUNION — chez HubSpot c'est une propriete de l'objet
// meeting (`outcome no show count`, 1 ou 0 par reunion), jamais du contact. Les
// deux metriques n'ont deliberement pas le meme grain : l'une mesure la capacite a
// closer une personne, l'autre la fiabilite d'un creneau.
//
// ── Pourquoi la declaration, et pas un delai ─────────────────────────────────
// Un seuil de temps (« moins d'un mois = meme opportunite ») couperait en deux un
// 2e call cale a cinq semaines, fusionnerait a tort deux vraies opportunites
// rapprochees, et imposerait un nombre magique indefendable. La continuation est
// DECLAREE : le vendeur repond « 2eme call » dans son rapport, ce qui pose
// `outcome = 'second_call'` sur le call precedent. Un prospect qui rebooke
// spontanement trois mois plus tard ne passe jamais par la — son call precedent
// porte `to_recontact` ou `lost`.
//
// ── Pourquoi on ne lit PAS le drapeau is_follow_up ───────────────────────────
// Il est pose par un PATCH dont le code TOLERE l'echec (« la seule consequence est
// un call non marque suivi, un ecart de comptage »). S'y fier heriterait de ce
// trou. On relit donc l'outcome du call precedent, qui est ecrit dans le meme
// patch que le rapport lui-meme et ne peut pas manquer. Meme principe que la
// refonte du pipeline du 2026-08-27 : l'issue se calcule a l'affichage, jamais
// stockee deux fois.
//
// ── Quel call est exclu ──────────────────────────────────────────────────────
// Le SECOND, pas le premier. L'opportunite est representee par son premier
// rendez-vous ; le deal, lui, est compte la ou il a ete signe. Un prospect qui fait
// deux calls et signe au second donne donc 1 deal / 1 opportunite = 100 %, la ou le
// comptage par rendez-vous disait 50 %.

type CallPourContinuation = DatedCall & {
  id: string;
  outcome?: string | null;
  invitee_email?: string | null;
  invitee_name?: string | null;
};

/** Les identites que porte un call : jusqu'a deux, l'e-mail et le nom. */
function identites(c: CallPourContinuation): string[] {
  const ids: string[] = [];
  const e = (c.invitee_email || '').trim().toLowerCase();
  if (e) ids.push(`e:${e}`);
  const n = (c.invitee_name || '').trim().toLowerCase();
  if (n) ids.push(`n:${n}`);
  return ids;
}

/**
 * Regroupe les calls par PERSONNE — deux calls appartiennent au meme prospect
 * s'ils partagent l'e-mail OU le nom.
 *
 * Une cle unique « l'e-mail, repli sur le nom » ne suffit pas, et ce n'est pas
 * theorique : le 2e call saisi a la main par RapportModal ne portait QUE le nom,
 * quand le premier portait un e-mail. Les deux tombaient donc dans deux groupes
 * distincts — `e:...` d'un cote, `n:...` de l'autre — et la continuation ne se
 * declenchait jamais. Le repli doit se faire au niveau de la PAIRE, pas de chaque
 * call pris isolement.
 *
 * Union-find sur les deux espaces de cles : un call sans e-mail rejoint par son
 * nom le groupe d'un call qui en a un.
 */
function groupesDeProspects(calls: CallPourContinuation[]): CallPourContinuation[][] {
  const parent = new Map<string, string>();
  const racine = (k: string): string => {
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r)!;
    // Compression de chemin : sans elle, une longue chaine de fusions degenere.
    let cur = k;
    while (parent.get(cur) !== r) { const suiv = parent.get(cur)!; parent.set(cur, r); cur = suiv; }
    return r;
  };
  const ajoute = (k: string) => { if (!parent.has(k)) parent.set(k, k); };

  for (const c of calls) {
    const ids = identites(c);
    ids.forEach(ajoute);
    // Les identites d'un MEME call designent la meme personne : on les fusionne.
    for (let i = 1; i < ids.length; i++) parent.set(racine(ids[i]), racine(ids[0]));
  }

  const groupes = new Map<string, CallPourContinuation[]>();
  for (const c of calls) {
    const ids = identites(c);
    if (!ids.length) continue;   // sans identite, aucun regroupement possible
    const r = racine(ids[0]);
    const arr = groupes.get(r);
    if (arr) arr.push(c); else groupes.set(r, [c]);
  }
  return [...groupes.values()];
}

/** Identifiants des calls qui CONTINUENT une opportunite deja ouverte. */
export function idsDeContinuation(calls: CallPourContinuation[]): Set<string> {
  const parProspect = groupesDeProspects(calls);
  const ids = new Set<string>();
  for (const groupe of parProspect) {
    if (groupe.length < 2) continue;
    const ordonne = [...groupe].sort((a, b) => (callDayKey(a) ?? '').localeCompare(callDayKey(b) ?? ''));
    for (let i = 1; i < ordonne.length; i++) {
      if (ordonne[i - 1].outcome === 'second_call') ids.add(ordonne[i].id);
    }
  }
  return ids;
}
