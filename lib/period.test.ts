import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPeriodWindow, periodesEnArriere } from './period.ts';

/* Lancé par `npm test`.
 *
 * Ces tests portent sur UNE règle : jusqu'où la flèche « ‹ » peut reculer. Elle a été
 * corrigée trois fois (deux le 2026-08-31, une le 2026-09-01), toujours pour la même
 * raison de fond — quelqu'un lui passe une date qui n'est pas la date de démarrage, ou
 * compte des tranches glissantes là où les périodes sont calendaires. D'où le
 * verrouillage.
 */

/** Le début du mois calendaire courant, décalé de `n` mois vers le passé. */
function moisDecale(n: number): Date {
  return getPeriodWindow(n, 'month').periodStart;
}

test('sans date de démarrage, la navigation reste possible plutôt que bloquée', () => {
  assert.equal(periodesEnArriere(null, 'month'), 12);
  assert.equal(periodesEnArriere(undefined, 'week'), 12);
  assert.equal(periodesEnArriere('', 'month'), 12);
});

test("une date illisible ne verrouille pas la navigation en silence", () => {
  // Le piège : `NaN >= NaN` est faux, donc la boucle ne tourne pas et le calcul rend 0.
  // Zéro, c'est « ‹ » grise pour toujours, sans le moindre message.
  assert.equal(periodesEnArriere('pas une date', 'month'), 12);
  assert.equal(periodesEnArriere(new Date('nawak'), 'month'), 12);
});

test('un démarrage au début du mois courant ne permet de reculer sur AUCUN mois', () => {
  // C'est exactement le cas qui a produit le bug : on passait le début de la PÉRIODE
  // AFFICHÉE au lieu du début du portefeuille. En septembre, le plancher devenait le
  // 1er septembre, et août — dont on a pourtant toutes les données — devenait
  // inatteignable. Le calcul n'a jamais eu tort ; c'est son entrée qui l'était.
  assert.equal(periodesEnArriere(moisDecale(0), 'month'), 0);
});

test('un démarrage il y a trois mois laisse remonter exactement trois mois', () => {
  assert.equal(periodesEnArriere(moisDecale(3), 'month'), 3);
  assert.equal(periodesEnArriere(moisDecale(1), 'month'), 1);
});

test('un démarrage en MILIEU de mois rend ce mois-là atteignable en entier', () => {
  // Une période reste atteignable tant qu'elle se TERMINE après le démarrage : le mois
  // où l'élève a démarré compte, même s'il a démarré le 20. L'écarter ferait disparaître
  // ses premières semaines de l'historique.
  const debutM3 = moisDecale(3);
  const milieuM3 = new Date(debutM3.getTime());
  milieuM3.setDate(20);
  assert.equal(periodesEnArriere(milieuM3, 'month'), 3);
});

test('une période entièrement antérieure au démarrage reste inatteignable', () => {
  // Le corollaire : on ne doit jamais pouvoir afficher un mois complet où rien n'était
  // encore mesuré. Le bandeau y annoncerait une couverture calculée sur du vide.
  const finDeM2 = getPeriodWindow(2, 'month').periodEnd;
  const justeApres = new Date(finDeM2.getTime() + 1000);
  assert.equal(periodesEnArriere(justeApres, 'month'), 1, 'M−2 est révolu, on s\'arrête à M−1');
});

test('le grain semaine se compte en semaines, pas en tranches de sept jours', () => {
  assert.equal(periodesEnArriere(getPeriodWindow(0, 'week').periodStart, 'week'), 0);
  assert.equal(periodesEnArriere(getPeriodWindow(5, 'week').periodStart, 'week'), 5);
});

test('le plafond borne la boucle sans la faire tourner indéfiniment', () => {
  // Une date aberrante (1970) ne doit produire ni boucle sans fin, ni liste de mille mois.
  assert.equal(periodesEnArriere(new Date(0), 'month', 24), 24);
});

test('les fenêtres sont calendaires : lundi–dimanche, et mois entier', () => {
  const w = getPeriodWindow(1, 'week');
  // getUTCDay sur un instant qui représente minuit heure de Paris : on lit le jour
  // parisien, qui est ce que la fenêtre borne réellement.
  const lundi = new Date(w.periodStart.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  assert.equal(lundi.getDay(), 1, 'une semaine commence un lundi');
  const m = getPeriodWindow(1, 'month');
  const premier = new Date(m.periodStart.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  assert.equal(premier.getDate(), 1, 'un mois commence le 1er');
});
