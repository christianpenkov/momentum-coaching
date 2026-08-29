import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acquisitionParContenu,
  contenuActivation,
  activationParContenu,
  contenuConversion,
  contenusOuActivationDepasseAcquisition,
  ORIGINE_INCONNUE,
} from './attribution-roles.ts';

// Les identifiants ci-dessous sont ceux du profil de test au 2026-08-29. Les cas
// viennent tous de la base, pas d'une invention : c'est ce qui rend ces tests utiles.
const A = '18056185901693457';      // le post "LM"
const GUIDE = '18034119419716572';  // le post "GUIDE"

/** Parcours réel de rdjdkzjd chez le profil de test, du 28/06 au 08/07. */
const PARCOURS_RDJDKZJD = [
  { media_id: A,     detected_at: '2026-06-28T10:00:00Z', lead_magnet_sent: true },
  { media_id: GUIDE, detected_at: '2026-07-05T09:00:00Z', lead_magnet_sent: true },
  { media_id: A,     detected_at: '2026-07-06T11:42:34Z', lead_magnet_sent: true },
];

test('acquisition : chaque prise credite son contenu, meme personne comprise', () => {
  const acq = acquisitionParContenu(PARCOURS_RDJDKZJD);
  // A l'a fait entrer deux fois, GUIDE une fois. GUIDE ne DISPARAIT pas parce que
  // la personne a recommente A ensuite : c'est exactement le defaut corrige.
  assert.equal(acq.get(A), 2);
  assert.equal(acq.get(GUIDE), 1);
});

test('acquisition : une demande sans lead magnet envoye ne fait entrer personne', () => {
  const acq = acquisitionParContenu([
    { media_id: A, detected_at: '2026-07-01T10:00:00Z', lead_magnet_sent: false },
    { media_id: A, detected_at: '2026-07-02T10:00:00Z', lead_magnet_sent: true },
  ]);
  assert.equal(acq.get(A), 1);
});

test('acquisition : une prise sans contenu tombe en origine inconnue, jamais ailleurs', () => {
  const acq = acquisitionParContenu([
    { media_id: null, detected_at: '2026-07-01T10:00:00Z', lead_magnet_sent: true },
  ]);
  assert.equal(acq.get(ORIGINE_INCONNUE), 1);
  assert.equal(acq.size, 1);
});

test('activation : le contenu qui fait parler est le dernier pris AVANT la reponse', () => {
  // Il repond le 08/07. Le dernier lead magnet pris avant, c'est A le 06/07 —
  // pas GUIDE du 05/07, et pas A du 28/06.
  const contenu = contenuActivation(PARCOURS_RDJDKZJD, '2026-07-08T16:34:22Z');
  assert.equal(contenu, A);
});

test('activation : une prise POSTERIEURE a la reponse ne peut pas l avoir declenchee', () => {
  // Piege reel : incogniton.734 a repondu le 25/07, et sa fiche pointe aujourd'hui
  // vers un contenu du 13/08 — trois semaines APRES. Un contenu ne peut pas avoir
  // declenche une conversation qui a eu lieu avant lui.
  const contenu = contenuActivation(
    [
      { media_id: A,     detected_at: '2026-07-25T08:00:00Z', lead_magnet_sent: true },
      { media_id: GUIDE, detected_at: '2026-08-13T08:00:00Z', lead_magnet_sent: true },
    ],
    '2026-07-25T12:00:00Z',
  );
  assert.equal(contenu, A);
});

test('activation : aucune prise avant la reponse renvoie null, jamais un repli', () => {
  const contenu = contenuActivation(PARCOURS_RDJDKZJD, '2026-06-01T00:00:00Z');
  assert.equal(contenu, null);
});

test('activation : une prise horodatee a la meme milliseconde compte', () => {
  // Sequence automatique : le webhook peut poser la prise et la reponse ensemble.
  const contenu = contenuActivation(
    [{ media_id: A, detected_at: '2026-07-06T11:42:34Z', lead_magnet_sent: true }],
    '2026-07-06T11:42:34Z',
  );
  assert.equal(contenu, A);
});

test('activation : on compte les CONVERSATIONS, pas les personnes', () => {
  // incogniton.734 a repondu trois fois (25/07, 28/07, 30/07). L'ecran n'en montrait
  // qu'une. Chaque reprise est creditee au contenu qui l'a declenchee.
  const historique = [
    { media_id: A,     detected_at: '2026-07-24T10:00:00Z', lead_magnet_sent: true },
    { media_id: GUIDE, detected_at: '2026-07-27T10:00:00Z', lead_magnet_sent: true },
    { media_id: A,     detected_at: '2026-07-29T10:00:00Z', lead_magnet_sent: true },
  ];
  const reponses = [
    { occurred_at: '2026-07-25T10:00:00Z' },
    { occurred_at: '2026-07-28T10:00:00Z' },
    { occurred_at: '2026-07-30T10:00:00Z' },
  ];
  const act = activationParContenu(historique, reponses);
  assert.equal(act.get(A), 2);      // les reprises du 25/07 et du 30/07
  assert.equal(act.get(GUIDE), 1);  // celle du 28/07
  const total = [...act.values()].reduce((s, n) => s + n, 0);
  assert.equal(total, 3, 'les trois conversations doivent exister, pas une seule');
});

test('activation : une reponse sans contenu rattachable va en origine inconnue', () => {
  // Cas reel : adrian.aubdm et clarouchka_p, deux reponses sans aucun contenu.
  const act = activationParContenu([], [{ occurred_at: '2026-07-27T10:00:00Z' }]);
  assert.equal(act.get(ORIGINE_INCONNUE), 1);
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

test('le parcours complet credite DEUX contenus differents, un par role', () => {
  // La vente de 500 EUR du 08/07 : A a fait parler, GUIDE a fait reserver.
  const acq = acquisitionParContenu(PARCOURS_RDJDKZJD);
  const act = activationParContenu(PARCOURS_RDJDKZJD, [{ occurred_at: '2026-07-08T16:34:22Z' }]);
  const conv = contenuConversion({ utm_content: GUIDE });

  assert.equal(acq.get(A), 2);
  assert.equal(acq.get(GUIDE), 1);   // GUIDE garde son lead : plus personne ne sort de nulle part
  assert.equal(act.get(A), 1);
  assert.equal(act.get(GUIDE), undefined);
  assert.equal(conv, GUIDE);
});

test('invariant : l activation PEUT depasser l acquisition, et c est le signal recherche', () => {
  // Un contenu qui reactive beaucoup et acquiert peu est bon en relance. Ce test
  // existe pour qu'on ne "corrige" jamais ce depassement en le plafonnant.
  const acquisition = new Map([[A, 1]]);
  const activation = new Map([[A, 3]]);
  assert.deepEqual(contenusOuActivationDepasseAcquisition(acquisition, activation), [A]);
});

test('invariant : origine inconnue n entre jamais dans la comparaison des roles', () => {
  const acquisition = new Map([[A, 5]]);
  const activation = new Map([[ORIGINE_INCONNUE, 99]]);
  assert.deepEqual(contenusOuActivationDepasseAcquisition(acquisition, activation), []);
});
