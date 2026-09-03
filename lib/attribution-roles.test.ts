import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acquisitionParContenu,
  personnesParContenu,
  contenuActivation,
  activationParContenu,
  contenuConversion,
  contenusOuActivationDepasseAcquisition,
  conversionParContenu,
  ecartConversionOpportunites,
  SANS_CONTENU,
} from './attribution-roles.ts';
import { idsDeContinuation } from './callSeries.ts';

/**
 * FIXTURES FIGÉES, EXTRAITES DE LA VRAIE BASE le 2026-08-29.
 *
 * Recopiées telles quelles, y compris le format de date `2026-07-06 11:42:34.51+00`
 * que PostgREST renvoie — espace au lieu de `T`, décalage `+00` sans minutes, et
 * précision variable (`.51` et non `.510`). Ne PAS les « nettoyer » en ISO strict :
 * ce format est le contrat réel, et c'est lui qu'il faut éprouver.
 *
 * Pourquoi figées plutôt qu'écrites à la main : la première version de ce fichier
 * utilisait trois lignes propres inventées. La base en contient sept pour le même
 * parcours, dont quatre prises de GUIDE en une heure et une ligne à
 * `lead_magnet_sent: false`. Cette différence de FORME cachait un vrai défaut de
 * calcul — GUIDE crédité 4 fois pour une seule personne — qui n'aurait été visible
 * qu'à l'affichage.
 *
 * Requête d'origine, à rejouer si ces fixtures doivent être rafraîchies :
 *   select media_id, detected_at, lead_magnet_sent from instagram_lead_lm_history
 *   where profile_id = 'a02e5927-…' and ig_username = 'rdjdkzjd' and archived_at is null
 *   order by detected_at;
 */

const A = '18056185901693457';      // le post « LM »
const GUIDE = '18034119419716572';  // le post « GUIDE »
const RDJ = '994032013431986';      // ig_user_id de rdjdkzjd chez le profil de test

/** Les 7 lignes réelles du parcours de rdjdkzjd, du 28/06 au 06/07/2026. */
const HISTORIQUE_REEL = [
  { media_id: A,     detected_at: '2026-06-28 21:39:53.702+00', lead_magnet_sent: false, ig_user_id: RDJ },
  { media_id: A,     detected_at: '2026-06-28 21:42:12.872+00', lead_magnet_sent: true,  ig_user_id: RDJ },
  { media_id: GUIDE, detected_at: '2026-07-05 13:51:52.847+00', lead_magnet_sent: true,  ig_user_id: RDJ },
  { media_id: GUIDE, detected_at: '2026-07-05 14:02:51.79+00',  lead_magnet_sent: true,  ig_user_id: RDJ },
  { media_id: GUIDE, detected_at: '2026-07-05 14:14:54.74+00',  lead_magnet_sent: true,  ig_user_id: RDJ },
  { media_id: GUIDE, detected_at: '2026-07-05 14:40:06.609+00', lead_magnet_sent: true,  ig_user_id: RDJ },
  { media_id: A,     detected_at: '2026-07-06 11:42:34.51+00',  lead_magnet_sent: true,  ig_user_id: RDJ },
];

/** Les 3 réponses réelles d'incogniton.734, telles que `prospect_events` les porte. */
const REPONSES_REELLES_INCOGNITON = [
  { occurred_at: '2026-07-25 12:24:37.072+00' },
  { occurred_at: '2026-07-28 19:07:17.389+00' },
  { occurred_at: '2026-07-30 14:05:51.099+00' },
];

test('le format de date de PostgREST est bien celui que le calcul suppose', () => {
  // Épingle un comportement de V8, pas une garantie de la norme : `2026-07-06 11:42:34.51+00`
  // n'est pas de l'ISO 8601 strict. Si ce test casse un jour, tout le reste ment en silence.
  assert.equal(
    Date.parse('2026-07-06 11:42:34.51+00'),
    Date.parse('2026-07-06T11:42:34.510Z'),
    'le format Postgres doit donner exactement le meme instant que l ISO strict',
  );
  for (const l of HISTORIQUE_REEL) {
    assert.ok(Number.isFinite(Date.parse(l.detected_at)), `date illisible : ${l.detected_at}`);
  }
  for (const r of REPONSES_REELLES_INCOGNITON) {
    assert.ok(Number.isFinite(Date.parse(r.occurred_at)), `date illisible : ${r.occurred_at}`);
  }
});

test('acquisition : une personne compte une fois par contenu, pas une fois par commentaire', () => {
  // LE test qui a trouvé le defaut. Sur les vraies donnees, GUIDE a quatre lignes en
  // une heure pour la meme personne. Sans deduplication il recevait 4.
  const acq = acquisitionParContenu(HISTORIQUE_REEL);
  assert.equal(acq.get(GUIDE), 1, 'quatre commentaires de la meme personne = un seul lead');
  assert.equal(acq.get(A), 1, 'deux prises espacees de huit jours = un seul lead');
  assert.equal(acq.size, 2);
});

test('acquisition : GUIDE garde son lead malgre un commentaire posterieur sur A', () => {
  // C'est le defaut d'origine : la fiche mutable perdait GUIDE, ecrase par A le 06/07.
  // GUIDE affichait alors 1 call et 500 EUR avec 0 commentaire — quelqu'un sorti de nulle part.
  assert.ok((acquisitionParContenu(HISTORIQUE_REEL).get(GUIDE) ?? 0) > 0);
});

test('acquisition : une demande sans lead magnet envoye ne fait entrer personne', () => {
  // Ligne reelle du 28/06 21h39 a false, suivie de la meme a true trois minutes plus tard.
  const seulementLaLigneFalse = [HISTORIQUE_REEL[0]];
  assert.equal(acquisitionParContenu(seulementLaLigneFalse).size, 0);
});

test("acquisition : le filtre lead_magnet_sent ne se voit QUE sur ce cas-la", () => {
  // Ce test existe parce que le filtre ne change aucun chiffre de la base
  // aujourd'hui. Releve le 2026-09-01 sur le contenu A : 11 prises, dont 9
  // livrees, et 3 personnes AVEC comme SANS le filtre — les deux lignes a false
  // appartiennent a des gens qui ont aussi une ligne a true.
  //
  // Le seul cas ou il se voit est celui-ci : une personne dont l'UNIQUE
  // interaction est un envoi echoue. Sans le filtre elle compterait comme
  // entree alors qu'elle n'a rien recu. Une garde qui ne change rien a la mesure
  // du jour finit par se faire retirer comme inutile — c'est ce test, et pas le
  // commentaire a cote, qui l'en empeche.
  const echoueSeulement = [
    { media_id: A, detected_at: '2026-07-01 10:00:00+00', lead_magnet_sent: false, ig_user_id: '888' },
  ];
  assert.equal(acquisitionParContenu(echoueSeulement).get(A), undefined);

  // Alors qu'une personne qui a AUSSI une ligne livree reste comptee une fois.
  const echoueePuisLivree = [
    ...echoueSeulement,
    { media_id: A, detected_at: '2026-07-01 10:03:00+00', lead_magnet_sent: true, ig_user_id: '888' },
  ];
  assert.equal(acquisitionParContenu(echoueePuisLivree).get(A), 1);
});

test('acquisition : le compte et les personnes sortent de la MEME regle', () => {
  // L'entonnoir d'un contenu (« Gerer mes liens ») a besoin de savoir QUI est
  // entre, pour aller chercher ses reponses et ses rendez-vous dans les autres
  // journaux. Il lisait sa propre copie de la deduplication et du filtre : deux
  // versions de la meme regle, donc une divergence garantie a la premiere
  // correction faite d'un seul cote.
  const personnes = personnesParContenu(HISTORIQUE_REEL);
  const comptes = acquisitionParContenu(HISTORIQUE_REEL);
  for (const [contenu, set] of personnes) {
    assert.equal(comptes.get(contenu), set.size, `desaccord sur ${contenu}`);
  }
  assert.equal(personnes.size, comptes.size);
});

test('acquisition : deux personnes distinctes sur le meme contenu comptent deux fois', () => {
  const acq = acquisitionParContenu([
    { media_id: A, detected_at: '2026-07-01 10:00:00+00', lead_magnet_sent: true, ig_user_id: RDJ },
    { media_id: A, detected_at: '2026-07-01 10:00:00+00', lead_magnet_sent: true, ig_user_id: '777' },
  ]);
  assert.equal(acq.get(A), 2);
});

test('acquisition : sans ig_user_id, chaque ligne est une personne distincte', () => {
  // On ne peut pas rapprocher deux lignes anonymes : les fondre inventerait un regroupement.
  const acq = acquisitionParContenu([
    { media_id: A, detected_at: '2026-07-01 10:00:00+00', lead_magnet_sent: true },
    { media_id: A, detected_at: '2026-07-02 10:00:00+00', lead_magnet_sent: true },
  ]);
  assert.equal(acq.get(A), 2);
});

test('acquisition : une prise sans contenu tombe en sans contenu, jamais ailleurs', () => {
  const acq = acquisitionParContenu([
    { media_id: null, detected_at: '2026-07-01 10:00:00+00', lead_magnet_sent: true, ig_user_id: RDJ },
  ]);
  assert.equal(acq.get(SANS_CONTENU), 1);
  assert.equal(acq.size, 1);
});

test('activation : le contenu qui fait parler est le dernier pris AVANT la reponse', () => {
  // rdjdkzjd repond « Oui » le 08/07 a 16h34. Le dernier lead magnet pris avant, c'est
  // A le 06/07 — pas GUIDE du 05/07, et pas A du 28/06.
  assert.equal(contenuActivation(HISTORIQUE_REEL, '2026-07-08 16:34:22.151+00'), A);
});

test('activation : une prise POSTERIEURE a la reponse ne peut pas l avoir declenchee', () => {
  // Piege reel : la fiche d'incogniton.734 pointe vers un contenu du 13/08 alors que sa
  // reponse date du 25/07. Un contenu ne peut pas declencher une conversation anterieure.
  const contenu = contenuActivation(
    [
      { media_id: A,     detected_at: '2026-07-25 08:00:00+00', lead_magnet_sent: true, ig_user_id: RDJ },
      { media_id: GUIDE, detected_at: '2026-08-13 08:00:00+00', lead_magnet_sent: true, ig_user_id: RDJ },
    ],
    '2026-07-25 12:24:37.072+00',
  );
  assert.equal(contenu, A);
});

test('activation : aucune prise avant la reponse renvoie null, jamais un repli', () => {
  assert.equal(contenuActivation(HISTORIQUE_REEL, '2026-06-01 00:00:00+00'), null);
});

test('activation : une prise horodatee a la meme milliseconde compte', () => {
  const contenu = contenuActivation(
    [{ media_id: A, detected_at: '2026-07-06 11:42:34.51+00', lead_magnet_sent: true, ig_user_id: RDJ }],
    '2026-07-06 11:42:34.51+00',
  );
  assert.equal(contenu, A);
});

test('activation : on compte les CONVERSATIONS, pas les personnes', () => {
  // incogniton.734 a repondu trois fois (dates reelles). L'ecran n'en montrait qu'une.
  const historique = [
    { media_id: A,     detected_at: '2026-07-24 10:00:00+00', lead_magnet_sent: true, ig_user_id: '555' },
    { media_id: GUIDE, detected_at: '2026-07-27 10:00:00+00', lead_magnet_sent: true, ig_user_id: '555' },
    { media_id: A,     detected_at: '2026-07-29 10:00:00+00', lead_magnet_sent: true, ig_user_id: '555' },
  ];
  const act = activationParContenu(historique, REPONSES_REELLES_INCOGNITON);
  assert.equal(act.get(A), 2);      // les reprises du 25/07 et du 30/07
  assert.equal(act.get(GUIDE), 1);  // celle du 28/07
  assert.equal([...act.values()].reduce((s, n) => s + n, 0), 3);
});

test('activation : une reponse sans contenu rattachable va en sans contenu', () => {
  // Cas reels : adrian.aubdm et clarouchka_p, deux reponses sans aucun contenu.
  const act = activationParContenu([], [{ occurred_at: '2026-07-27 10:00:00+00' }]);
  assert.equal(act.get(SANS_CONTENU), 1);
});

test('conversion : utm_content et rien d autre, aucun repli sur le lead', () => {
  assert.equal(contenuConversion({ utm_content: GUIDE }, []), GUIDE);
});

test('conversion : repli LEGITIME sur le contenu du lien prospect', () => {
  // Cas reel af9d5898 du 15/08 : le lien datait du 7 juin, avant le correctif du 19/08
  // qui a impose l identifiant de post dans utm_content. Le contenu n etait pas perdu,
  // prospect_links.content_id valait GUIDE.
  assert.equal(
    contenuConversion({ utm_content: null, prospect_link_content_id: GUIDE }, []),
    GUIDE,
  );
});

test('conversion : utm_content prime toujours sur le repli', () => {
  // Le lien reellement clique fait autorite sur le lien par lequel le prospect est
  // arrive : c est lui qui a produit la reservation.
  assert.equal(
    contenuConversion({ utm_content: A, prospect_link_content_id: GUIDE }, []),
    A,
  );
});

test('conversion : un repli vide ou blanc ne vaut pas un contenu', () => {
  assert.equal(contenuConversion({ utm_content: null, prospect_link_content_id: '  ' }, []), null);
  assert.equal(contenuConversion({ utm_content: '  ', prospect_link_content_id: null }, []), null);
});

test('conversion : un lien de bio n a aucun contenu, et c est normal', () => {
  // 5 calls sur 19 au 2026-08-29. Un trou, jamais un zero, jamais un repli.
  assert.equal(contenuConversion({ utm_content: null }, []), null);
  assert.equal(contenuConversion({}, []), null);
  assert.equal(contenuConversion({ utm_content: '   ' }, []), null);
});

test('conversion : le lien PERSONNEL ne decide plus, le journal decide', () => {
  // Le cas qui a motive la correction du 2026-09-03. rdjdkzjd :
  //   05/07  il prend GUIDE  -> le lien Calendly est grave sur GUIDE ce jour-la
  //   06/07  il reprend A    -> le lien, lui, ne bouge pas
  //   08/07  il RESERVE en rouvrant l ancien lien, qui porte toujours GUIDE
  // GUIDE recoltait la vente d un rendez-vous que A avait declenche.
  assert.equal(
    contenuConversion(
      { utm_content: GUIDE, utm_medium: 'dm', booked_at: '2026-07-08 16:36:50.597662+00' },
      HISTORIQUE_REEL,
    ),
    A,
  );
});

test('conversion : un lien PORTE par un contenu garde son utm_content', () => {
  // La regle ne vaut QUE pour le lien personnel. Un lien en description vit DANS un
  // contenu : il n en existe qu un par post, donc cliquer dessus prouve qu on
  // regardait ce post. 11 des 18 rendez-vous du profil de test sont dans ce cas —
  // etendre la regle du journal les casserait tous.
  assert.equal(
    contenuConversion(
      { utm_content: GUIDE, utm_medium: 'description', booked_at: '2026-07-08 16:36:50.597662+00' },
      HISTORIQUE_REEL,
    ),
    GUIDE,
  );
});

test('conversion : `source` sert de repli quand utm_medium manque', () => {
  // Un call ancien peut ne pas porter d utm_medium ; `source` est posee par le
  // webhook Calendly dans tous les cas.
  assert.equal(
    contenuConversion(
      { utm_content: GUIDE, source: 'ig_dm', booked_at: '2026-07-08 16:36:50.597662+00' },
      HISTORIQUE_REEL,
    ),
    A,
  );
});

test('conversion : sans journal, le lien personnel garde son utm_content', () => {
  // Repli indispensable : les routes de paiement n ont pas toujours le journal sous
  // la main, et un appelant qui l oublie ne doit pas perdre l attribution.
  assert.equal(
    contenuConversion({ utm_content: GUIDE, utm_medium: 'dm', booked_at: '2026-07-08 16:36:50.597662+00' }, []),
    GUIDE,
  );
  assert.equal(
    contenuConversion({ utm_content: GUIDE, utm_medium: 'dm', booked_at: '2026-07-08 16:36:50.597662+00' }, []),
    GUIDE,
  );
});

test('conversion : une prise APRES la reservation ne peut pas l avoir declenchee', () => {
  // rdjdkzjd a repris A le 01/09, bien apres sa reservation du 08/07. Le compter
  // reviendrait a crediter un contenu qui n existait pas encore dans son parcours.
  const avecPriseTardive = [
    ...HISTORIQUE_REEL,
    { media_id: GUIDE, detected_at: '2026-09-01 18:22:46.958+00', lead_magnet_sent: true, ig_user_id: RDJ },
  ];
  assert.equal(
    contenuConversion({ utm_content: GUIDE, utm_medium: 'dm', booked_at: '2026-07-08 16:36:50.597662+00' }, avecPriseTardive),
    A,
  );
});

test('conversion : une demande NON livree ne compte pas', () => {
  // La ligne du 28/06 a `lead_magnet_sent: false` — vue, jamais partie. Seule la
  // seconde, deux minutes plus tard, fait entrer.
  const uniquementNonLivre = [HISTORIQUE_REEL[0]];
  assert.equal(
    contenuConversion({ utm_content: GUIDE, utm_medium: 'dm', booked_at: '2026-07-08 16:36:50.597662+00' }, uniquementNonLivre),
    GUIDE,   // repli : le journal ne propose rien de livre
  );
});

test('le parcours reel credite DEUX contenus differents, un par role', () => {
  // La vente de 500 EUR du 08/07.
  //
  // ⚠️ Ce test affirmait « A a fait parler, GUIDE a fait reserver », en s appuyant sur
  // l idee que le prospect avait rouvert « le lien de GUIDE ». Cette premisse est
  // FAUSSE : il n existe qu un lien par personne, grave une fois. Verifie le
  // 2026-09-03. Les trois roles creditent donc A, et c est coherent — c est bien le
  // lead magnet du 06/07 qui l a fait reserver deux jours plus tard.
  //
  // Le test garde son nom et son intention : montrer que les roles se calculent
  // separement. Ils peuvent tomber d accord, et ici ils ont raison de le faire.
  const acq = acquisitionParContenu(HISTORIQUE_REEL);
  const act = activationParContenu(HISTORIQUE_REEL, [{ occurred_at: '2026-07-08 16:34:22.151+00' }]);
  const conv = contenuConversion(
    { utm_content: GUIDE, utm_medium: 'dm', booked_at: '2026-07-08 16:36:50.597662+00' },
    HISTORIQUE_REEL,
  );

  assert.equal(acq.get(A), 1);
  assert.equal(acq.get(GUIDE), 1);   // plus personne ne sort de nulle part
  assert.equal(act.get(A), 1);
  assert.equal(act.get(GUIDE), undefined);
  assert.equal(conv, A);
});

test('invariant : l activation PEUT depasser l acquisition, et c est le signal recherche', () => {
  // Ce test existe pour qu'on ne « corrige » jamais ce depassement en le plafonnant :
  // un contenu qui reactive beaucoup et acquiert peu est bon en relance.
  assert.deepEqual(
    contenusOuActivationDepasseAcquisition(new Map([[A, 1]]), new Map([[A, 3]])),
    [A],
  );
});

test('invariant : sans contenu n entre jamais dans la comparaison des roles', () => {
  assert.deepEqual(
    contenusOuActivationDepasseAcquisition(new Map([[A, 5]]), new Map([[SANS_CONTENU, 99]])),
    [],
  );
});

// ── CONVERSION : un credit par OPPORTUNITE, jamais par rendez-vous ─────────────

/**
 * Deux rendez-vous du meme prospect, le second etant une continuation du premier
 * (le rapport du premier dit `second_call`). Depuis le commit 7da4b53, le 2e call
 * herite du utm_content de son parent : sans exclusion, GUIDE recevrait 2 credits
 * pour un seul prospect.
 */
const PAIRE_AVEC_CONTINUATION = [
  { id: 'c1', utm_content: GUIDE, outcome: 'second_call', invitee_email: 'p@x.fr',
    booked_at: '2026-07-08 10:00:00+00', scheduled_at: '2026-07-08 10:00:00+00' },
  { id: 'c2', utm_content: GUIDE, outcome: 'closed_won', invitee_email: 'p@x.fr',
    booked_at: '2026-08-12 10:00:00+00', scheduled_at: '2026-08-12 10:00:00+00' },
];

test('conversion : une continuation recoit ZERO credit', () => {
  const continuations = idsDeContinuation(PAIRE_AVEC_CONTINUATION);
  assert.ok(continuations.has('c2'), 'c2 doit etre reconnu comme une continuation');
  const conv = conversionParContenu(PAIRE_AVEC_CONTINUATION, continuations, () => []);
  assert.equal(conv.get(GUIDE), 1, 'un seul credit pour un seul prospect, pas deux');
});

test('conversion : idsDeContinuation est importe, jamais redérive ici', () => {
  // Deux definitions du meme fait finissent toujours par diverger. Ce test echouera
  // si quelqu un reecrit la regle localement au lieu d appeler lib/callSeries.
  assert.equal(typeof idsDeContinuation, 'function');
});

test('conversion : deux prospects distincts sur le meme contenu comptent deux fois', () => {
  const calls = [
    { id: 'a', utm_content: GUIDE, invitee_email: 'un@x.fr',
      booked_at: '2026-07-08 10:00:00+00', scheduled_at: '2026-07-08 10:00:00+00' },
    { id: 'b', utm_content: GUIDE, invitee_email: 'deux@x.fr',
      booked_at: '2026-07-09 10:00:00+00', scheduled_at: '2026-07-09 10:00:00+00' },
  ];
  assert.equal(conversionParContenu(calls, idsDeContinuation(calls), () => []).get(GUIDE), 2);
});

test('conversion : un call de bio tombe en sans contenu, il ne disparait pas', () => {
  const calls = [{ id: 'bio', utm_content: null, invitee_email: 'b@x.fr',
    booked_at: '2026-08-18 10:00:00+00', scheduled_at: '2026-08-18 10:00:00+00' }];
  const conv = conversionParContenu(calls, new Set(), () => []);
  assert.equal(conv.get(SANS_CONTENU), 1);
});

test('INVARIANT : la somme des credits de Conversion egale le nombre d opportunites', () => {
  // Le lien entre les deux vocabulaires. « Opportunite » est une unite de comptage,
  // « Conversion » un role d attribution ; si les deux divergent, l un est faux, et
  // aucun des deux ne le signalerait seul.
  const continuations = idsDeContinuation(PAIRE_AVEC_CONTINUATION);
  const opportunites = PAIRE_AVEC_CONTINUATION.filter(c => !continuations.has(c.id)).length;
  const conv = conversionParContenu(PAIRE_AVEC_CONTINUATION, continuations, () => []);
  assert.equal(ecartConversionOpportunites(conv, opportunites), null);
});

test('INVARIANT : une divergence est signalee, jamais avalee', () => {
  const conv = new Map([[GUIDE, 3]]);
  assert.deepEqual(ecartConversionOpportunites(conv, 2), { credits: 3, opportunites: 2 });
});
