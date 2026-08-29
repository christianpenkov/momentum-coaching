import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acquisitionParContenu,
  contenuActivation,
  activationParContenu,
  contenuConversion,
  contenusOuActivationDepasseAcquisition,
  SANS_CONTENU,
} from './attribution-roles.ts';

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
  assert.equal(contenuConversion({ utm_content: GUIDE }), GUIDE);
});

test('conversion : un lien de bio n a aucun contenu, et c est normal', () => {
  // 5 calls sur 19 au 2026-08-29. Un trou, jamais un zero, jamais un repli.
  assert.equal(contenuConversion({ utm_content: null }), null);
  assert.equal(contenuConversion({}), null);
  assert.equal(contenuConversion({ utm_content: '   ' }), null);
});

test('le parcours reel credite DEUX contenus differents, un par role', () => {
  // La vente de 500 EUR du 08/07 : A a fait parler, GUIDE a fait reserver.
  const acq = acquisitionParContenu(HISTORIQUE_REEL);
  const act = activationParContenu(HISTORIQUE_REEL, [{ occurred_at: '2026-07-08 16:34:22.151+00' }]);
  const conv = contenuConversion({ utm_content: GUIDE });

  assert.equal(acq.get(A), 1);
  assert.equal(acq.get(GUIDE), 1);   // plus personne ne sort de nulle part
  assert.equal(act.get(A), 1);
  assert.equal(act.get(GUIDE), undefined);
  assert.equal(conv, GUIDE);
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
