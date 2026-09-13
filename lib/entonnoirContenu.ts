// ─────────────────────────────────────────────────────────────────────────────
// Les deux premières marches de l'entonnoir de « Gérer mes liens ».
//
// Cette règle a été fausse DEUX FOIS le 2026-09-07 : elle comptait les lignes du
// journal (« 21 leads » pour une personne), puis elle comptait deux fois
// quelqu'un présent des deux côtés. Les deux fois, elle vivait en ligne dans un
// `useMemo` de 5 000 lignes, où rien ne pouvait la vérifier.
//
// Elle vit donc ici, avec ses tests.
//
// ── CE QUE L'ENTONNOIR MESURE ────────────────────────────────────────────────
//
// Ce que le CONTENU produit. D'où deux populations, et une exclusion :
//
//   • les personnes qui se sont manifestées d'elles-mêmes — un commentaire, une
//     réponse à une story, ou un DM qu'elles ont envoyé les premières ;
//   • celles qui ont réservé DIRECTEMENT depuis un contenu — bio, description ou
//     sticker de story — sans jamais écrire ;
//   • jamais le cold DM sortant : quelqu'un que le coach est allé chercher n'a
//     été produit par aucun contenu.
// ─────────────────────────────────────────────────────────────────────────────

import { canalDuDm } from './canalDm.ts';
import { idsDeContinuation } from './callSeries.ts';
import { isNotCanceled } from './salesCallStats.ts';
import { conversionParContenu, type CallPourConversion, type PriseDeLeadMagnet } from './attribution-roles.ts';

/**
 * Les sources de `calls` qui désignent un rendez-vous pris depuis un contenu,
 * sans conversation préalable.
 *
 * ⚠️ Deux familles de `source` cohabitent dans la base et ne se ressemblent pas :
 * `calls` porte `ig_bio` / `ig_description` / `ig_story` / `yt_description`,
 * tandis que les leads et les liens portent `comment` / `cold_dm` /
 * `story_reply`. `canalDuDm` ne s'applique QU'À la seconde. C'est le piège
 * principal de ce calcul.
 *
 * `ig_story` en fait partie : un rendez-vous pris depuis le sticker d'une story
 * vient d'un contenu au même titre qu'un lien en description. `yt_bio` n'existe
 * pas encore en données, la catégorie est prévue.
 */
export const SOURCES_CONTENU_DIRECT = new Set([
  'ig_bio', 'ig_description', 'ig_story', 'yt_bio', 'yt_description',
]);

export interface LeadEntonnoir {
  id: string;
  ig_user_id?: string | null;
  ig_username?: string | null;
  source?: string | null;
  hook_replied?: boolean | null;
}

export interface CallEntonnoir {
  id: string;
  source?: string | null;
  ig_lead_id?: string | null;
  invitee_email?: string | null;
  invitee_name?: string | null;
}

/** La clé d'une personne côté calls. Même règle que `clefPersonne` de salesCallStats. */
function clefCall(c: CallEntonnoir): string {
  return (c.invitee_email || c.invitee_name || c.id).toLowerCase();
}

/** Les fiches produites par un contenu — tout sauf le cold DM sortant. */
export function fichesDuContenu(leads: LeadEntonnoir[]): LeadEntonnoir[] {
  return leads.filter(l => canalDuDm(l.source) !== 'sortant');
}

/**
 * La marche « Leads » : des PERSONNES, pas des interactions.
 *
 * ⚠️ Les deux apports ne partagent aucune clé — pseudo Instagram d'un côté,
 * e-mail ou nom d'invité de l'autre — et `instagram_leads` n'a pas de colonne
 * e-mail. Une personne qui a pris un lead magnet puis réservé depuis une bio ne
 * peut donc PAS être rapprochée d'elle-même, sauf si un `ig_lead_id` a été posé
 * sur son rendez-vous. C'est justement ce que fait la fusion automatique par
 * e-mail exact, et c'est pourquoi ce cas est traité ici.
 */
export function compterLeadsDuContenu(leads: LeadEntonnoir[], calls: CallEntonnoir[]): {
  total: number; personnesManifestees: number; callsDirectsPersonnes: number;
} {
  const retenues = fichesDuContenu(leads);
  const personnes = new Set(
    retenues.map(l => l.ig_user_id || l.ig_username).filter(Boolean) as string[],
  );

  // Les fiches DÉJÀ comptées. Un rendez-vous porté par l'une d'elles décrit une
  // personne déjà dans le total : la recompter par son e-mail l'ajouterait une
  // seconde fois, sous une autre clé.
  //
  // On compare aux fiches RETENUES, pas à toutes : un cold DM sortant qui
  // réserve ensuite depuis une bio n'est pas dans `personnes`, et son
  // rendez-vous doit donc bien le faire entrer — il vient d'un contenu.
  const idsComptees = new Set(retenues.map(l => l.id));

  const directs = new Set(
    calls
      .filter(c => SOURCES_CONTENU_DIRECT.has(c.source ?? '')
        && !(c.ig_lead_id && idsComptees.has(c.ig_lead_id)))
      .map(clefCall),
  );

  return {
    total: personnes.size + directs.size,
    personnesManifestees: personnes.size,
    callsDirectsPersonnes: directs.size,
  };
}

/**
 * La marche « Conversations » : les personnes qui ont répondu.
 *
 * Même exclusion que la marche précédente, et ce n'est pas un détail de style :
 * une marche ne peut pas contenir des gens que la précédente ignore. Compter ici
 * un cold DM sortant afficherait plus de conversations que de leads.
 */
export function compterConversationsDuContenu(leads: LeadEntonnoir[]): number {
  return fichesDuContenu(leads).filter(l => l.hook_replied).length;
}

export interface CallBookeEntonnoir extends CallEntonnoir {
  status?: string | null;
  outcome?: string | null;
  booked_at?: string | null;
  scheduled_at?: string | null;
}

/**
 * La marche « Calls bookés » : des OPPORTUNITÉS, pas des rendez-vous.
 *
 * Un 2e call déclaré au rapport (`outcome = 'second_call'` sur le précédent) prolonge
 * la même vente : aucun contenu ne l'a produit, il ne compte pas. C'est la définition
 * de l'accueil et de « Mes stats » (`computeSalesCallStats`) depuis le 2026-09-12 —
 * jusque-là cette marche comptait tous les rendez-vous actifs, et le même libellé
 * affichait un nombre différent de l'accueil pour le même élève.
 *
 * ⚠️ `calls` doit être le jeu COMPLET du coach, jamais un sous-ensemble : le 2e call
 * n'est reconnu que si son précédent est visible. Et l'annulé est retiré AVANT
 * l'appariement, comme dans `computeSalesCallStats` : sinon un rendez-vous annulé
 * servirait de tête de chaîne et écarterait à tort le suivant.
 */
export function compterCallsBookesDuContenu(calls: CallBookeEntonnoir[]): {
  total: number; viaDm: number; viaLien: number; autres: number;
} {
  const continuations = idsDeContinuation(calls.filter(isNotCanceled));
  const opportunites = calls.filter(c => c.status === 'active' && !continuations.has(c.id));
  // Les origines se lisent sur `source`, jamais sur `ig_lead_id` : la fusion de fiches
  // pose `ig_lead_id` sur des rendez-vous venus d'une bio (voir PageLiens).
  const viaDm = opportunites.filter(c => c.source === 'ig_dm').length;
  // Bio, description ET story — la même liste que la marche « Leads ». Ce sous-total
  // valait « tout ce qui n'est pas du DM » jusqu'au 2026-09-13 : un rendez-vous pris
  // depuis une story (1 sur 17 en base ce jour-là) s'affichait « via description ou
  // bio », et un rendez-vous sans origine tracée l'aurait été aussi.
  const viaLien = opportunites.filter(c => SOURCES_CONTENU_DIRECT.has(c.source ?? '')).length;
  // Le reste n'est pas jeté : sans lui, les sous-totaux ne feraient plus le total.
  // C'est l'équivalent de « Autre / non catégorisé » du Breakdown par source.
  return { total: opportunites.length, viaDm, viaLien, autres: opportunites.length - viaDm - viaLien };
}

export interface CallBookeParContenu extends CallBookeEntonnoir {
  utm_content?: string | null;
  utm_medium?: string | null;
  prospect_link_id?: string | null;
}

/**
 * « N calls bookés depuis ce contenu » : les OPPORTUNITÉS créditées à chaque contenu.
 *
 * Même règle que la colonne « Calls » de « Performance par contenu » dans Mes stats :
 * `conversionParContenu`, appelée et jamais recopiée — `utm_content`, repli sur le
 * contenu du lien prospect, et le journal des lead magnets pour le lien personnel du DM.
 *
 * Jusqu'au 2026-09-13 le volet d'un post comptait des PERSONNES ayant un événement
 * `call_booked` parmi ses preneurs de lead magnet : une personne qui rebooke après un
 * call perdu comptait une fois, et un rendez-vous pris depuis la description du post
 * n'y comptait pas du tout.
 *
 * ⚠️ `calls` = le jeu COMPLET du coach, pour l'appariement des continuations.
 *
 * @param journalParFiche  id de fiche `instagram_leads` → prises de lead magnet de la personne
 * @param contenuDuLien    id de `prospect_links` → `content_id`
 */
export function callsBookesParContenu(
  calls: CallBookeParContenu[],
  journalParFiche: ReadonlyMap<string, PriseDeLeadMagnet[]>,
  contenuDuLien: ReadonlyMap<string, string>,
): Map<string, number> {
  const continuations = idsDeContinuation(calls.filter(isNotCanceled));
  const ficheDuCall = new Map<string, string | null>();
  const actifs: CallPourConversion[] = calls
    .filter(c => c.status === 'active')
    .map(c => {
      ficheDuCall.set(c.id, c.ig_lead_id ?? null);
      return {
        id: c.id,
        utm_content: c.utm_content,
        utm_medium: c.utm_medium,
        source: c.source,
        booked_at: c.booked_at,
        scheduled_at: c.scheduled_at,
        prospect_link_content_id: c.prospect_link_id ? contenuDuLien.get(c.prospect_link_id) ?? null : null,
      };
    });
  return conversionParContenu(actifs, continuations, call => {
    const fiche = call.id ? ficheDuCall.get(call.id) : null;
    return (fiche && journalParFiche.get(fiche)) || [];
  });
}
