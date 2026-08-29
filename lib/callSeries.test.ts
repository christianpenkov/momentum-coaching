import test from 'node:test';
import assert from 'node:assert/strict';
import { callDayKey, bucketCallsByBookedDay, parisDayRange, tauxOuTrou, idsDeContinuation } from './callSeries.ts';

// Cas qui a motivé la fonction : un call réservé entre minuit et 2 h heure de Paris
// tombe la VEILLE en UTC. Le découpage précédent (`new Date('YYYY-MM-DD')`, donc
// minuit UTC) le rattachait au mauvais jour.
test('un call réservé à 00:30 heure de Paris compte le jour de Paris, pas le jour UTC', () => {
  // 2026-08-19 00:30 Paris = 2026-08-18 22:30 UTC (heure d'été, UTC+2)
  const c = { booked_at: '2026-08-18T22:30:00.000Z', scheduled_at: '2026-08-20T10:00:00.000Z' };
  assert.equal(callDayKey(c), '2026-08-19');
});

test('en heure d’hiver la frontière est à 01:00 UTC, pas 00:00', () => {
  // 2026-01-15 00:30 Paris = 2026-01-14 23:30 UTC (UTC+1)
  assert.equal(callDayKey({ booked_at: '2026-01-14T23:30:00.000Z' }), '2026-01-15');
});

// La date de rattachement est la RÉSERVATION. Le tableau d'efficacité découpait sur
// scheduled_at, ce qui sortait de la courbe un call pourtant compté dans le total.
test('un call réservé un jour et tenu le lendemain compte au jour de la réservation', () => {
  const c = { booked_at: '2026-08-29T14:00:00.000Z', scheduled_at: '2026-08-30T09:00:00.000Z' };
  assert.equal(callDayKey(c), '2026-08-29');
});

test('repli sur scheduled_at quand booked_at manque (anciens calls importés)', () => {
  assert.equal(callDayKey({ booked_at: null, scheduled_at: '2026-08-29T14:00:00.000Z' }), '2026-08-29');
  assert.equal(callDayKey({ booked_at: null, scheduled_at: null }), null);
});

// L'INVARIANT du chantier : la courbe d'une carte doit totaliser la carte. Elle ne le
// faisait pas en All-Time — la boucle des jours restait bornée au mois en cours,
// carte à 17 contre courbe à 9. Le test lie les deux : sur la fenêtre RÉELLE des
// données, la somme des seaux vaut le nombre de calls.
test('la somme des seaux jour par jour égale le total sur la fenêtre couvrant les données', () => {
  const calls = [
    { booked_at: '2026-06-15T12:45:00.000Z', scheduled_at: '2026-06-15T12:50:00.000Z' },
    { booked_at: '2026-06-15T16:09:00.000Z', scheduled_at: '2026-06-15T16:10:00.000Z' },
    { booked_at: '2026-07-08T16:36:00.000Z', scheduled_at: '2026-07-08T16:40:00.000Z' },
    { booked_at: '2026-08-19T12:32:00.000Z', scheduled_at: '2026-08-19T13:30:00.000Z' },
    { booked_at: '2026-08-21T04:59:00.000Z', scheduled_at: '2026-08-21T05:00:00.000Z' },
  ];
  const seaux = bucketCallsByBookedDay(calls);
  const fenetreComplete = parisDayRange(new Date('2026-06-09T00:00:00.000Z'), new Date('2026-08-29T12:00:00.000Z'));
  const total = fenetreComplete.reduce((s, j) => s + (seaux.get(j)?.length ?? 0), 0);
  assert.equal(total, calls.length);

  // Et la démonstration du défaut : bornée au seul mois en cours, la même courbe
  // n'en montre que 2 sur 5.
  const fenetreDuMois = parisDayRange(new Date('2026-08-01T00:00:00.000Z'), new Date('2026-08-29T12:00:00.000Z'));
  const totalTronque = fenetreDuMois.reduce((s, j) => s + (seaux.get(j)?.length ?? 0), 0);
  assert.equal(totalTronque, 2);
});

// Les bornes sont des JOURS DE PARIS, y compris quand l'instant fourni tombe la veille
// ou le lendemain en UTC : 2026-08-03 22:00 UTC, c'est déjà le 4 août à Paris.
test('parisDayRange inclut ses deux bornes, lues en jours de Paris', () => {
  assert.deepEqual(
    parisDayRange(new Date('2026-08-01T10:00:00.000Z'), new Date('2026-08-03T10:00:00.000Z')),
    ['2026-08-01', '2026-08-02', '2026-08-03'],
  );
  assert.deepEqual(
    parisDayRange(new Date('2026-08-01T10:00:00.000Z'), new Date('2026-08-03T22:00:00.000Z')),
    ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04'],
  );
});

// « Un 0 affirme quelque chose, un trou dit on ne sait pas. » Un jour sans appel n'a
// pas un taux de closing de 0 % : il n'en a pas.
test('un taux à dénominateur nul est un trou, pas un zéro', () => {
  assert.equal(tauxOuTrou(0, 0), null);
  assert.equal(tauxOuTrou(3, 0), null);
  assert.equal(tauxOuTrou(0, 4), 0);
  assert.equal(tauxOuTrou(1, 2), 50);
});

// ─── Close rate par opportunite ──────────────────────────────────────────────

const c = (id: string, jour: string, extra: { outcome?: string } = {}) => ({
  id,
  booked_at: `2026-08-${jour}T14:00:00.000Z`,
  invitee_email: 'prospect@exemple.fr',
  outcome: undefined as string | undefined,
  ...extra,
});

test('un 2e call declare continue l opportunite : c est le SECOND qui est exclu', () => {
  const ids = idsDeContinuation([
    c('a', '10', { outcome: 'second_call' }),
    c('b', '20', { outcome: 'closed' }),
  ]);
  assert.deepEqual([...ids], ['b']);
});

// C'est le cas que Chris a souleve : deux rendez-vous eloignes ne sont pas une
// continuation, meme pour le meme prospect. Ce n'est pas le DELAI qui les separe,
// c'est l'absence de declaration.
test('un rebooking spontane compte pour deux opportunites, quel que soit le delai', () => {
  const ids = idsDeContinuation([
    { id: 'a', booked_at: '2026-05-01T14:00:00.000Z', outcome: 'to_recontact', invitee_email: 'p@x.fr' },
    { id: 'b', booked_at: '2026-08-20T14:00:00.000Z', outcome: 'closed', invitee_email: 'p@x.fr' },
  ]);
  assert.equal(ids.size, 0);
});

test('trois calls chaines : les deux suivants sont des continuations', () => {
  const ids = idsDeContinuation([
    c('a', '05', { outcome: 'second_call' }),
    c('b', '12', { outcome: 'second_call' }),
    c('c', '19', { outcome: 'closed' }),
  ]);
  assert.deepEqual([...ids].sort(), ['b', 'c']);
});

test('deux prospects distincts ne se melangent jamais', () => {
  const ids = idsDeContinuation([
    { id: 'a', booked_at: '2026-08-10T14:00:00.000Z', outcome: 'second_call', invitee_email: 'un@x.fr' },
    { id: 'b', booked_at: '2026-08-20T14:00:00.000Z', outcome: 'closed', invitee_email: 'deux@x.fr' },
  ]);
  assert.equal(ids.size, 0);
});

// Repli sur le nom quand l'e-mail manque, et jamais de regroupement sans identite :
// sinon tous les calls anonymes formeraient un seul « prospect » geant.
test('repli sur le nom, et aucun regroupement sans identite', () => {
  assert.deepEqual([...idsDeContinuation([
    { id: 'a', booked_at: '2026-08-10T14:00:00.000Z', outcome: 'second_call', invitee_name: 'Jean Dupont' },
    { id: 'b', booked_at: '2026-08-20T14:00:00.000Z', outcome: 'closed', invitee_name: 'jean dupont' },
  ])], ['b']);
  assert.equal(idsDeContinuation([
    { id: 'a', booked_at: '2026-08-10T14:00:00.000Z', outcome: 'second_call' },
    { id: 'b', booked_at: '2026-08-20T14:00:00.000Z', outcome: 'closed' },
  ]).size, 0);
});

// L'INVARIANT metier : un prospect qui fait deux rendez-vous et signe au second
// vaut 1 deal pour 1 opportunite, pas pour 2 rendez-vous.
test('close rate par opportunite : 100 % la ou le comptage par rendez-vous disait 50 %', () => {
  const calls = [c('a', '10', { outcome: 'second_call' }), c('b', '20', { outcome: 'closed' })];
  const continuations = idsDeContinuation(calls);
  const honores = calls.length;
  const closes = calls.filter(x => x.outcome === 'closed').length;
  const opportunites = calls.filter(x => !continuations.has(x.id)).length;
  assert.equal(Math.round((closes / honores) * 100), 50);
  assert.equal(Math.round((closes / opportunites) * 100), 100);
});

// LE CAS REEL, celui qui a failli faire echouer le test end-to-end : RapportModal
// cree le 2e call avec `invitee_name` mais SANS `invitee_email`, alors que le
// premier call vient de Calendly et porte les deux. Avec une cle unique
// « e-mail, repli sur le nom », les deux tombaient dans deux groupes distincts et
// la continuation ne se declenchait jamais.
test('un 2e call sans e-mail rejoint le premier par le nom', () => {
  const ids = idsDeContinuation([
    { id: 'premier', booked_at: '2026-08-21T04:59:00.000Z', outcome: 'second_call',
      invitee_name: 'Testrapportpasse', invitee_email: 'rapporttestpass@gmail.com' },
    { id: 'second', booked_at: '2026-08-29T18:00:00.000Z', outcome: null,
      invitee_name: 'Testrapportpasse', invitee_email: null },
  ]);
  assert.deepEqual([...ids], ['second']);
});

// Symetrique : le call SANS e-mail arrive en premier.
test('le rapprochement par le nom marche dans les deux sens', () => {
  const ids = idsDeContinuation([
    { id: 'a', booked_at: '2026-08-10T10:00:00.000Z', outcome: 'second_call', invitee_name: 'Jean Dupont' },
    { id: 'b', booked_at: '2026-08-20T10:00:00.000Z', outcome: 'closed',
      invitee_name: 'Jean Dupont', invitee_email: 'jean@x.fr' },
  ]);
  assert.deepEqual([...ids], ['b']);
});

// Un call sans e-mail rejoint le groupe de l'e-mail qui porte son nom, et la
// chaine se poursuit normalement a l'interieur de ce groupe.
test('un call sans e-mail rejoint le groupe puis la chaine se poursuit', () => {
  const ids = idsDeContinuation([
    { id: 'a', booked_at: '2026-08-05T10:00:00.000Z', outcome: 'second_call', invitee_name: 'Marie L' },
    { id: 'b', booked_at: '2026-08-12T10:00:00.000Z', outcome: 'second_call',
      invitee_name: 'Marie L', invitee_email: 'marie@x.fr' },
    { id: 'c', booked_at: '2026-08-19T10:00:00.000Z', outcome: 'closed', invitee_email: 'marie@x.fr' },
  ]);
  assert.deepEqual([...ids].sort(), ['b', 'c']);
});

// ── L'E-MAIL IDENTIFIE, LE NOM NE FAIT QUE RAPPROCHER ───────────────────────
// Deux homonymes avec deux adresses sont deux personnes. Les fusionner ferait
// disparaitre une opportunite du denominateur et SURESTIMERAIT le close rate.
test('deux homonymes avec des e-mails differents ne fusionnent jamais', () => {
  const ids = idsDeContinuation([
    { id: 'a', booked_at: '2026-08-10T10:00:00.000Z', outcome: 'second_call',
      invitee_name: 'Jean Dupont', invitee_email: 'jean.dupont@a.fr' },
    { id: 'b', booked_at: '2026-08-20T10:00:00.000Z', outcome: 'closed',
      invitee_name: 'Jean Dupont', invitee_email: 'jean.dupont@b.fr' },
  ]);
  assert.equal(ids.size, 0);
});

// Le nom ne peut pas non plus servir de pont entre deux personnes distinctes via
// un troisieme call sans e-mail : l'ambiguite ne fusionne pas, elle isole.
test('un nom porte par deux e-mails distincts n absorbe pas le call anonyme', () => {
  const ids = idsDeContinuation([
    { id: 'a', booked_at: '2026-08-01T10:00:00.000Z', outcome: 'second_call',
      invitee_name: 'Jean Dupont', invitee_email: 'jean@a.fr' },
    { id: 'b', booked_at: '2026-08-02T10:00:00.000Z', outcome: 'second_call',
      invitee_name: 'Jean Dupont', invitee_email: 'jean@b.fr' },
    { id: 'anonyme', booked_at: '2026-08-20T10:00:00.000Z', outcome: 'closed',
      invitee_name: 'Jean Dupont' },
  ]);
  // 'anonyme' reste seul : il compte pour une opportunite de plus, jamais pour
  // une continuation devinee.
  assert.equal(ids.has('anonyme'), false);
});

// La contrepartie a ne pas franchir : deux personnes differentes restent separees
// des lors qu'elles ne partagent NI e-mail NI nom.
test('deux prospects sans identite commune ne fusionnent jamais', () => {
  const ids = idsDeContinuation([
    { id: 'a', booked_at: '2026-08-10T10:00:00.000Z', outcome: 'second_call', invitee_name: 'Paul', invitee_email: 'paul@x.fr' },
    { id: 'b', booked_at: '2026-08-20T10:00:00.000Z', outcome: 'closed', invitee_name: 'Sophie', invitee_email: 'sophie@x.fr' },
  ]);
  assert.equal(ids.size, 0);
});
