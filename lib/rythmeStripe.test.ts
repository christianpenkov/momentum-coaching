import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avancer } from './rythmeStripe.ts';

// Lancé par `npm test` (node --test, sans aucune dépendance à installer).
//
// Ce que ces tests protègent : une date annoncée au client. Le calcul précédent
// ajoutait 30 jours par échéance et annonçait le 7 novembre là où Stripe
// prélevait le 8 — un écart qu'aucun écran ne peut signaler, puisque la date
// affichée a l'air parfaitement normale.

const jour = (iso: string) => new Date(iso);
const enJour = (d: Date) => d.toISOString().slice(0, 10);

test('mensuel : le jour du mois ne bouge pas', () => {
  const depart = jour('2026-10-08T17:13:15.000Z');
  assert.equal(enJour(avancer(depart, 'month', 0)), '2026-10-08');
  assert.equal(enJour(avancer(depart, 'month', 1)), '2026-11-08');
  assert.equal(enJour(avancer(depart, 'month', 2)), '2026-12-08');
  // Le cas réel qui a révélé le défaut : « + 30 jours » donnait le 7 novembre.
  assert.notEqual(enJour(avancer(depart, 'month', 1)), '2026-11-07');
});

test('mensuel : l\'heure de l\'ancre est conservée', () => {
  const depart = jour('2026-10-08T17:13:15.000Z');
  assert.equal(avancer(depart, 'month', 1).toISOString(), '2026-11-08T17:13:15.000Z');
});

test('mensuel : un jour absent se replie sur le dernier du mois', () => {
  // L'exemple donné par la doc Stripe, mot pour mot :
  // « ancre au 31 janvier → 28 février, puis 31 mars, puis 30 avril ».
  const depart = jour('2026-01-31T12:00:00.000Z');
  assert.equal(enJour(avancer(depart, 'month', 1)), '2026-02-28');
  assert.equal(enJour(avancer(depart, 'month', 2)), '2026-03-31');
  assert.equal(enJour(avancer(depart, 'month', 3)), '2026-04-30');
});

test('mensuel : l\'ancre ne dérive JAMAIS après un repli', () => {
  // Le piège que le repli tend : ajouter un mois de proche en proche donnerait
  // 28 février puis 28 mars, et tout l'échéancier glisserait au 28 à vie.
  // On repart donc toujours de l'ancre — c'est ce que cette assertion verrouille.
  const depart = jour('2026-01-31T12:00:00.000Z');
  const deProcheEnProche = enJour(avancer(avancer(depart, 'month', 1), 'month', 1));
  assert.equal(deProcheEnProche, '2026-03-28');            // ce qu'il ne faut pas faire
  assert.equal(enJour(avancer(depart, 'month', 2)), '2026-03-31'); // ce que fait Stripe
});

test('mensuel : le 29 février d\'une année bissextile', () => {
  const depart = jour('2028-01-29T12:00:00.000Z');
  assert.equal(enJour(avancer(depart, 'month', 1)), '2028-02-29');
});

test('mensuel : le passage d\'année', () => {
  const depart = jour('2026-11-30T12:00:00.000Z');
  assert.equal(enJour(avancer(depart, 'month', 1)), '2026-12-30');
  assert.equal(enJour(avancer(depart, 'month', 2)), '2027-01-30');
});

test('hebdomadaire : sept jours pleins, donc le même jour de la semaine', () => {
  const depart = jour('2026-09-08T17:13:15.000Z'); // un mardi
  assert.equal(enJour(avancer(depart, 'week', 1)), '2026-09-15');
  assert.equal(enJour(avancer(depart, 'week', 5)), '2026-10-13');
  assert.equal(avancer(depart, 'week', 1).getUTCDay(), depart.getUTCDay());
});

test('le contrôle contre cancel_at : le cas réel du 2026-09-08', () => {
  // Vente de 1,50 € en 3 fois. Stripe a répondu : prochain prélèvement le
  // 8 octobre, bornage (`cancel_at`) au 8 décembre. Il reste 2 échéances.
  // L'invariant vérifié à l'écran : départ + 2 intervalles == cancel_at.
  const prochain = jour('2026-10-08T17:13:15.000Z');
  const finChezStripe = jour('2026-12-08T17:13:15.000Z');
  assert.equal(avancer(prochain, 'month', 2).getTime(), finChezStripe.getTime());
});
