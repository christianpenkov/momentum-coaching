import test from 'node:test';
import assert from 'node:assert/strict';
import { parcoursDesLeads, ligneDuCall, type PriseParcours, type RefsParcours } from './parcoursLeads.ts';

// ─── Fixtures RÉELLES, relevées en base le 2026-09-01 ────────────────────────
//
// Écrites à la main, elles auraient été plus propres et auraient caché le cas qui
// compte : `rdjdkzjd` prend LM le 28/06, GUIDE quatre fois le 05/07, puis LM de nouveau
// le 06/07 — et réserve le 08/07. Une fixture inventée aurait mis une entrée par lead
// magnet et n'aurait jamais posé la question de savoir à laquelle son rendez-vous
// appartient. Même leçon que `attribution-roles.test.ts`.

const RDJDKZJD = '994032013431986';
const INCOGNITON = '26455181597493816';
const GALIA = '1877333462897616';
const PENKOV = '1429176868676619';

const POST_LM = '18056185901693457';
const POST_GUIDE = '18034119419716572';
const POST_BEAU = '18060960410312678';
const STORY = '18070859744433801';

const JOURNAL: PriseParcours[] = [
  { ig_user_id: INCOGNITON, media_id: POST_GUIDE, keyword_matched: 'GUIDE', detected_at: '2026-06-07T08:13:06Z', lead_magnet_sent: true },
  { ig_user_id: PENKOV, media_id: POST_BEAU, keyword_matched: 'BEAU', detected_at: '2026-06-15T14:15:11Z', lead_magnet_sent: true },
  // La demande vue mais jamais livrée : personne n'est entré.
  { ig_user_id: RDJDKZJD, media_id: POST_LM, keyword_matched: 'LM', detected_at: '2026-06-28T21:39:53Z', lead_magnet_sent: false },
  { ig_user_id: RDJDKZJD, media_id: POST_LM, keyword_matched: 'LM', detected_at: '2026-06-28T21:42:12Z', lead_magnet_sent: true },
  // Quatre fois le même mot-clé en une heure — un seul prospect.
  { ig_user_id: RDJDKZJD, media_id: POST_GUIDE, keyword_matched: 'GUIDE', detected_at: '2026-07-05T13:51:52Z', lead_magnet_sent: true },
  { ig_user_id: RDJDKZJD, media_id: POST_GUIDE, keyword_matched: 'GUIDE', detected_at: '2026-07-05T14:02:51Z', lead_magnet_sent: true },
  { ig_user_id: RDJDKZJD, media_id: POST_GUIDE, keyword_matched: 'GUIDE', detected_at: '2026-07-05T14:14:54Z', lead_magnet_sent: true },
  { ig_user_id: RDJDKZJD, media_id: POST_GUIDE, keyword_matched: 'GUIDE', detected_at: '2026-07-05T14:40:06Z', lead_magnet_sent: true },
  { ig_user_id: RDJDKZJD, media_id: POST_LM, keyword_matched: 'LM', detected_at: '2026-07-06T11:42:34Z', lead_magnet_sent: true },
  { ig_user_id: INCOGNITON, media_id: STORY, keyword_matched: 'STORYTEST', detected_at: '2026-07-25T12:21:50Z', lead_magnet_sent: true },
  { ig_user_id: INCOGNITON, media_id: POST_LM, keyword_matched: 'LM', detected_at: '2026-07-29T23:37:23Z', lead_magnet_sent: true },
  { ig_user_id: INCOGNITON, media_id: POST_LM, keyword_matched: 'LM', detected_at: '2026-08-14T09:32:22Z', lead_magnet_sent: true },
  { ig_user_id: GALIA, media_id: POST_LM, keyword_matched: 'LM', detected_at: '2026-08-19T12:55:35Z', lead_magnet_sent: true },
];

const FICHE = { [RDJDKZJD]: 'a945e91d', [INCOGNITON]: 'a778fc33', [PENKOV]: '602a4e5a', [GALIA]: '99c3662d' };

const REFS: RefsParcours = {
  ficheParPersonne: new Map(Object.entries(FICHE)),
  // Deux seulement ont appuyé sur le bouton du DM1 : l'écart avec les clics et avec
  // les conversations mesure l'efficacité du message automatique, pas une marche.
  lmReclame: new Set(['a945e91d', 'a778fc33']),
  lmClique: new Set(['a945e91d', 'a778fc33', '602a4e5a', '99c3662d']),
  // `galiamerdjanova` n'a jamais répondu — c'est le goulot que le tableau doit montrer.
  ontRepondu: new Set(['a945e91d', 'a778fc33', '602a4e5a']),
  calendlyEnvoye: new Set(['a945e91d', 'a778fc33', '602a4e5a']),
  calendlyClique: new Set(['a945e91d', 'a778fc33', '602a4e5a']),
  callsParFiche: new Map([
    ['602a4e5a', [{ id: '59a1e236', ig_lead_id: '602a4e5a', status: 'active', dateDeRattachement: '2026-06-15T16:10:00Z', honore: true, closed: true, qualified: null }]],
    ['a778fc33', [
      { id: '9c7ae4d0', ig_lead_id: 'a778fc33', status: 'active', dateDeRattachement: '2026-06-15T12:50:00Z', honore: true, closed: false, qualified: null },
      { id: 'af9d5898', ig_lead_id: 'a778fc33', status: 'active', dateDeRattachement: '2026-08-15T21:10:00Z', honore: true, closed: false, qualified: false },
    ]],
    ['a945e91d', [{ id: '7d9a65f7', ig_lead_id: 'a945e91d', status: 'active', dateDeRattachement: '2026-07-08T16:40:00Z', honore: true, closed: true, qualified: true }]],
  ]),
  montantParCall: new Map([['59a1e236', 1000], ['7d9a65f7', 500]]),
  continuations: new Set<string>(),
};

const parContenu = () => parcoursDesLeads(JOURNAL, p => p.media_id, REFS);
const parLeadMagnet = () => parcoursDesLeads(JOURNAL, p => p.keyword_matched, REFS);

// ─── La déduplication, qui est la raison d'être du tableau ────────────────────

test('quatre prises du même mot-clé en une heure font UNE personne', () => {
  assert.equal(parContenu().get(POST_GUIDE)!.commentairesLm, 2); // incogniton + rdjdkzjd
  assert.equal(parLeadMagnet().get('GUIDE')!.commentairesLm, 2);
});

test('une demande dont le lead magnet n a jamais ete livre ne fait entrer personne', () => {
  // rdjdkzjd a une ligne `false` le 28/06 et une `true` deux minutes apres : une entree.
  const lm = parContenu().get(POST_LM)!;
  assert.equal(lm.personnes.filter(p => p === RDJDKZJD).length, 1);
});

// ─── L'INVARIANT : la chaîne ne remonte jamais ────────────────────────────────

test('chaque colonne est un sous-ensemble de la precedente', () => {
  for (const lignes of [parContenu(), parLeadMagnet()]) {
    for (const [cle, l] of lignes) {
      // `lmReclames` et `clicsLm` sont HORS CHAINE : ils ne bornent rien.
      assert.ok(l.ontRepondu <= l.commentairesLm, `${cle} : conversations > commentaires`);
      assert.ok(l.calendlyEnvoyes <= l.ontRepondu, `${cle} : Calendly envoyes > conversations`);
      assert.ok(l.clicsCalendly <= l.calendlyEnvoyes, `${cle} : clics Calendly > envoyes`);
      assert.ok(l.callsBookes <= l.clicsCalendly, `${cle} : bookes > clics Calendly`);
      assert.ok(l.callsHonores <= l.callsBookes, `${cle} : honores > bookes`);
      assert.ok(l.closes <= l.callsHonores, `${cle} : closes > honores`);
    }
  }
});

test('le goulot se voit : galiamerdjanova entre et s arrete la', () => {
  const lm = parContenu().get(POST_LM)!;
  assert.equal(lm.commentairesLm, 3);   // rdjdkzjd, incogniton, galia
  assert.equal(lm.ontRepondu, 2);       // galia n a jamais repondu
});

// ─── LA COHORTE EST DATÉE — le cas que les fixtures réelles ont révélé ───────

test('un rendez-vous se range dans la cohorte ouverte au moment ou il a eu lieu', () => {
  // rdjdkzjd : LM le 28/06, GUIDE le 05/07, LM de nouveau le 06/07, rendez-vous le 08/07.
  // La derniere entree avant le rendez-vous est LM — c'est donc LM qui l'a produit,
  // pas GUIDE, meme si GUIDE l'a fait entrer entre les deux.
  const contenus = parContenu();
  assert.equal(contenus.get(POST_LM)!.revenue, 500, 'les 500 EUR appartiennent a LM');
  assert.equal(contenus.get(POST_GUIDE)!.revenue, 0, 'GUIDE ne recolte pas la vente de LM');
});

test('les deux rendez-vous d une meme personne se rangent dans deux cohortes differentes', () => {
  // incogniton : GUIDE le 07/06 puis rendez-vous le 15/06 → cohorte GUIDE.
  // Puis LM le 14/08 et rendez-vous le 15/08 → cohorte LM. Une personne, deux lignes,
  // un rendez-vous chacune — jamais deux fois le meme des deux cotes.
  const contenus = parContenu();
  assert.equal(contenus.get(POST_GUIDE)!.callsBookes, 1);
  assert.equal(contenus.get(POST_LM)!.callsBookes, 2); // incogniton + rdjdkzjd
});

const t = (iso: string) => Date.parse(iso);

test('un rendez-vous ANTERIEUR a toute entree n appartient a aucune ligne', () => {
  const chrono = [{ t: t('2026-06-01T00:00:00Z'), cle: 'A' }];
  assert.equal(ligneDuCall(chrono, t('2026-01-01T10:00:00Z')), null);
});

test('la ligne change des que la personne rentre par une autre porte', () => {
  const chrono = [
    { t: t('2026-06-01T00:00:00Z'), cle: 'A' },
    { t: t('2026-08-01T00:00:00Z'), cle: 'B' },
  ];
  assert.equal(ligneDuCall(chrono, t('2026-07-15T10:00:00Z')), 'A');
  assert.equal(ligneDuCall(chrono, t('2026-09-15T10:00:00Z')), 'B');
});

test('une porte que cet angle ne sait pas nommer ne credite pas la precedente', () => {
  // Une story sans contenu, vue depuis l'angle Contenu : la personne est bien rentree,
  // mais cet angle n'a pas de ligne pour ca. Crediter A serait inventer.
  const chrono = [
    { t: t('2026-06-01T00:00:00Z'), cle: 'A' },
    { t: t('2026-08-01T00:00:00Z'), cle: null },
  ];
  assert.equal(ligneDuCall(chrono, t('2026-09-15T10:00:00Z')), null);
});

test('un rendez-vous a la seconde pres de l entree lui appartient', () => {
  // `penkov` prend BEAU a 14:15 et reserve a 16:10 le meme jour. Une comparaison
  // stricte l'aurait exclu.
  const chrono = [{ t: t('2026-06-15T14:15:11Z'), cle: 'BEAU' }];
  assert.equal(ligneDuCall(chrono, t('2026-06-15T16:10:00Z')), 'BEAU');
  assert.equal(ligneDuCall(chrono, t('2026-06-15T14:15:11Z')), 'BEAU');
});

// ─── L'argent est une somme, pas un compte de personnes ──────────────────────

test('revenue somme des montants, jamais des personnes', () => {
  assert.equal(parContenu().get(POST_BEAU)!.revenue, 1000);
  assert.equal(parLeadMagnet().get('BEAU')!.revenue, 1000);
});

test('le montant vient de deals : un rendez-vous sans deal rapporte zero', () => {
  // Les deux rendez-vous d incogniton n ont aucun deal : ses lignes sont a 0 EUR
  // meme si `calls.revenue` en porterait un.
  const contenus = parContenu();
  assert.equal(contenus.get(STORY)!.revenue, 0);
  assert.equal(contenus.get(STORY)!.callsBookes, 0); // le rdv du 15/08 appartient a LM
});

// ─── % qualifiés : pas un sous-ensemble, et il le dit ─────────────────────────

test('le denominateur des qualifies ne compte que les rapports renseignes', () => {
  const lm = parContenu().get(POST_LM)!;
  // incogniton : rendez-vous du 15/08, `qualified = false` → renseigne, pas qualifie.
  // rdjdkzjd : rendez-vous du 08/07, `qualified = true`.
  assert.deepEqual(lm.qualifies, { oui: 1, renseignes: 2 });
  // penkov : `qualified = null` → aucun rapport, denominateur vide, pas un zero.
  assert.deepEqual(parContenu().get(POST_BEAU)!.qualifies, { oui: 0, renseignes: 0 });
});

// ─── Les deux angles ne peuvent pas diverger ─────────────────────────────────

test('les deux angles donnent les memes totaux quand la partition est la meme', () => {
  // BEAU n est declenche que depuis un seul contenu : les deux angles doivent coincider
  // sur toute la ligne. Si un jour ils divergent, c est qu un calcul a ete duplique.
  const parC = parContenu().get(POST_BEAU)!;
  const parL = parLeadMagnet().get('BEAU')!;
  const sansPersonnes = ({ personnes, ...reste }: typeof parC) => reste;
  assert.deepEqual(sansPersonnes(parL), sansPersonnes(parC));
});

// ─── La période s'applique aux ENTRÉES, et seulement là ──────────────────────

test('une entree hors periode BORNE la chronologie sans ouvrir de ligne', () => {
  // On affiche juin. `rdjdkzjd` est entre en juin (LM) puis en juillet (LM de nouveau),
  // et a reserve le 08/07. Sa ligne de juin ne doit PAS recolter ce rendez-vous : il est
  // posterieur a une entree de juillet, qui n'est pas affichee mais a bien eu lieu.
  const juin = (p: PriseParcours) => p.detected_at < '2026-07-01';
  const lignes = parcoursDesLeads(JOURNAL, p => p.media_id, REFS, juin);

  const lm = lignes.get(POST_LM)!;
  assert.equal(lm.commentairesLm, 1, 'seul rdjdkzjd est entre par LM en juin');
  assert.equal(lm.callsBookes, 0, 'son rendez-vous du 08/07 suit une entree de juillet');
  assert.equal(lm.revenue, 0);

  // GUIDE en juin : incogniton seul, dont le rendez-vous du 15/06 suit bien son entree.
  const guide = lignes.get(POST_GUIDE)!;
  assert.equal(guide.commentairesLm, 1);
  assert.equal(guide.callsBookes, 1);
});

test('filtrer le journal en amont produirait le defaut que la borne evite', () => {
  // La preuve par l'absurde : si on ne passait que les prises de juin, la chronologie de
  // `rdjdkzjd` s'arreterait au 28/06 et son rendez-vous du 08/07 remonterait crediter
  // juin. Le meme appel, journal tronque, donne un chiffre different — et faux.
  const journalTronque = JOURNAL.filter(p => p.detected_at < '2026-07-01');
  const tronque = parcoursDesLeads(journalTronque, p => p.media_id, REFS);
  const correct = parcoursDesLeads(JOURNAL, p => p.media_id, REFS, p => p.detected_at < '2026-07-01');

  assert.equal(tronque.get(POST_LM)!.callsBookes, 1, 'le journal tronque credite a tort');
  assert.equal(correct.get(POST_LM)!.callsBookes, 0, 'la borne, elle, ne credite pas');
});

// ─── Les deux colonnes hors chaîne ne sont pas des marches ───────────────────

test('on peut converser sans avoir jamais appuye ni clique', () => {
  // BEAU : personne n'a appuye sur le bouton du DM1, et pourtant la conversation a eu
  // lieu et la vente s'est faite. Une chaine qui passerait par la s'arreterait a zero.
  const beau = parContenu().get(POST_BEAU)!;
  assert.equal(beau.lmReclames, 0);
  assert.equal(beau.ontRepondu, 1);
  assert.equal(beau.closes, 1);
});

// ─── Une relance manuelle n'ouvre PAS de cohorte ─────────────────────────────

test('seule une nouvelle prise de lead magnet ouvre une cohorte', () => {
  // Une personne entre par A, ne repond pas, se fait relancer a la main un mois plus
  // tard, puis reserve. La relance ne laisse AUCUNE trace au journal des lead magnets :
  // elle ne borne donc rien, et le rendez-vous reste credite a A. C'est voulu — une
  // relance est une etape du parcours, pas une nouvelle entree.
  const journal: PriseParcours[] = [
    { ig_user_id: 'p1', media_id: 'A', keyword_matched: 'A', detected_at: '2026-03-01T10:00:00Z', lead_magnet_sent: true },
  ];
  const refs: RefsParcours = {
    ficheParPersonne: new Map([['p1', 'f1']]),
    lmReclame: new Set(), lmClique: new Set(['f1']), ontRepondu: new Set(['f1']),
    calendlyEnvoye: new Set(['f1']), calendlyClique: new Set(['f1']),
    callsParFiche: new Map([['f1', [
      { id: 'apres-relance', ig_lead_id: 'f1', status: 'active', dateDeRattachement: '2026-04-15T10:00:00Z', honore: true, closed: true, qualified: null },
    ]]]),
    montantParCall: new Map([['apres-relance', 2000]]),
    continuations: new Set(),
  };
  const a = parcoursDesLeads(journal, p => p.media_id, refs).get('A')!;
  assert.equal(a.callsBookes, 1, 'le rendez-vous reste dans la cohorte de mars');
  assert.equal(a.revenue, 2000);
});

test('un lead magnet pris APRES la reservation ne vole pas le rendez-vous', () => {
  // Le cas que le rattachement sur la TENUE se trompait a traiter. Une personne entre
  // par A, reserve le 10, puis prend le lead magnet B le 12, et le rendez-vous a lieu
  // le 15. B n'a pas pu produire une reservation qui existait deja deux jours avant
  // qu'il soit pris : le rendez-vous appartient a A.
  //
  // C'est aussi la regle 2 du referentiel — la date de reference d'un rendez-vous est
  // sa reservation. Ne pas confondre avec `dateDeVente`, qui date l'ARGENT a la tenue :
  // deux questions, deux dates, et les confondre etait le defaut corrige ici.
  const journal: PriseParcours[] = [
    { ig_user_id: 'p1', media_id: 'A', keyword_matched: 'A', detected_at: '2026-05-01T10:00:00Z', lead_magnet_sent: true },
    { ig_user_id: 'p1', media_id: 'B', keyword_matched: 'B', detected_at: '2026-05-12T10:00:00Z', lead_magnet_sent: true },
  ];
  const refs: RefsParcours = {
    ficheParPersonne: new Map([['p1', 'f1']]),
    lmReclame: new Set(), lmClique: new Set(), ontRepondu: new Set(['f1']),
    calendlyEnvoye: new Set(['f1']), calendlyClique: new Set(['f1']),
    callsParFiche: new Map([['f1', [
      { id: 'rdv', ig_lead_id: 'f1', status: 'active', dateDeRattachement: '2026-05-10T09:00:00Z', honore: true, closed: true, qualified: null },
    ]]]),
    montantParCall: new Map([['rdv', 1500]]),
    continuations: new Set(),
  };
  const lignes = parcoursDesLeads(journal, p => p.media_id, refs);
  assert.equal(lignes.get('A')!.callsBookes, 1, 'la porte d entree garde son rendez-vous');
  assert.equal(lignes.get('A')!.revenue, 1500, 'et l argent qui va avec');
  assert.equal(lignes.get('B')!.callsBookes, 0, 'un lead magnet pris apres coup ne cree aucun rendez-vous');
  assert.equal(lignes.get('B')!.revenue, 0);
});

// ─── Liens partagés : la chaîne commence à la réservation ────────────────────

import { parcoursDesLiensPartages, type CallPartage } from './parcoursLeads.ts';

const YT = 'EMvwzHVjNJg';
const CALLS_YT: CallPartage[] = [
  { id: 'f23976bd', contenu: YT, status: 'active', personne: 'christianpenkov@ubizenai.com', honore: true, closed: false, qualified: null },
  { id: '37aca0a6', contenu: YT, status: 'active', personne: 'eazeaz@gmail.com', honore: false, closed: false, qualified: null },
  { id: '39514db8', contenu: YT, status: 'active', personne: 'testyt@mail.com', honore: true, closed: true, qualified: true },
];

test('trois invites distincts font trois personnes', () => {
  const l = parcoursDesLiensPartages(CALLS_YT, new Map([['39514db8', 1000]]), new Set()).get(YT)!;
  assert.equal(l.callsBookes, 3);
  assert.equal(l.callsHonores, 2, 'le no-show n a pas honore');
  assert.equal(l.closes, 1);
  assert.equal(l.revenue, 1000);
  assert.deepEqual(l.qualifies, { oui: 1, renseignes: 1 });
});

test('un meme invite qui reserve deux fois compte pour une personne', () => {
  const calls: CallPartage[] = [
    { id: 'a', contenu: YT, status: 'active', personne: 'Meme@Mail.com', honore: true, closed: false, qualified: null },
    { id: 'b', contenu: YT, status: 'active', personne: 'meme@mail.com ', honore: true, closed: true, qualified: null },
  ];
  const l = parcoursDesLiensPartages(calls, new Map([['b', 700]]), new Set()).get(YT)!;
  assert.equal(l.callsBookes, 1, 'casse et espaces ne font pas deux personnes');
  assert.equal(l.revenue, 700, 'mais l argent se somme sur les deux rendez-vous');
});

test('deux rendez-vous sans identite ne fusionnent jamais', () => {
  const calls: CallPartage[] = [
    { id: 'a', contenu: YT, status: 'active', personne: null, honore: true, closed: false, qualified: null },
    { id: 'b', contenu: YT, status: 'active', personne: null, honore: true, closed: false, qualified: null },
  ];
  assert.equal(parcoursDesLiensPartages(calls, new Map(), new Set()).get(YT)!.callsBookes, 2);
});

test('une continuation ne rouvre pas d opportunite', () => {
  const calls: CallPartage[] = [
    { id: 'premier', contenu: YT, status: 'active', personne: 'x@y.fr', honore: true, closed: false, qualified: null },
    { id: 'second', contenu: YT, status: 'active', personne: 'z@y.fr', honore: true, closed: false, qualified: null },
  ];
  const l = parcoursDesLiensPartages(calls, new Map(), new Set(['second'])).get(YT)!;
  assert.equal(l.callsBookes, 1, 'la continuation ne compte pas comme une opportunite');
  assert.equal(l.personnes.length, 2, 'mais la personne existe bien');
});
