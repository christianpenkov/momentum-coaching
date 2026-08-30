import test from 'node:test';
import assert from 'node:assert/strict';
import {
  granulariteFenetre, cleBucket, bucketsDe,
  regrouperComptage, regrouperTaux, libelleBucket,
} from './chart-buckets.ts';

function jours(debut: string, n: number): string[] {
  const out: string[] = [];
  const d = new Date(debut + 'T00:00:00Z');
  for (let i = 0; i < n; i++) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}

test('granularité choisie selon la largeur de la fenêtre', () => {
  assert.equal(granulariteFenetre(7), 'jour');
  assert.equal(granulariteFenetre(31), 'jour');
  assert.equal(granulariteFenetre(70), 'jour');
  assert.equal(granulariteFenetre(71), 'semaine');
  assert.equal(granulariteFenetre(400), 'semaine');
  assert.equal(granulariteFenetre(401), 'mois');
  assert.equal(granulariteFenetre(1200), 'mois');
});

test('la clé de semaine est le lundi', () => {
  // 2026-08-28 est un vendredi → lundi 2026-08-24
  assert.equal(cleBucket('2026-08-28', 'semaine'), '2026-08-24');
  assert.equal(cleBucket('2026-08-24', 'semaine'), '2026-08-24');
  // dimanche 2026-08-30 appartient encore à la semaine du 24
  assert.equal(cleBucket('2026-08-30', 'semaine'), '2026-08-24');
  // lundi 2026-08-31 ouvre la semaine suivante
  assert.equal(cleBucket('2026-08-31', 'semaine'), '2026-08-31');
});

test('la clé de mois est le 1er, la clé de jour est la date', () => {
  assert.equal(cleBucket('2026-08-28', 'mois'), '2026-08-01');
  assert.equal(cleBucket('2026-08-28', 'jour'), '2026-08-28');
});

test('les buckets couvrent la fenêtre sans trou ni doublon', () => {
  const b = bucketsDe(jours('2026-06-09', 81), 'semaine');
  assert.equal(b[0], '2026-06-08');
  assert.equal(new Set(b).size, b.length);
  for (let i = 1; i < b.length; i++) {
    const prev = new Date(b[i - 1] + 'T00:00:00Z');
    prev.setUTCDate(prev.getUTCDate() + 7);
    assert.equal(b[i], prev.toISOString().slice(0, 10), 'semaines consécutives');
  }
});

test('comptage : la somme du regroupement égale la somme des jours', () => {
  const js = jours('2026-06-09', 81);
  const v = (j: string) => (j.endsWith('1') ? 3 : 1);
  const attendu = js.reduce((s, j) => s + v(j), 0);
  for (const g of ['jour', 'semaine', 'mois'] as const) {
    const total = regrouperComptage(js, g, v).reduce((s, p) => s + (p.v ?? 0), 0);
    assert.equal(total, attendu, `granularité ${g}`);
  }
});

test('comptage : un bucket entièrement hors couverture reste un trou', () => {
  const js = jours('2026-06-01', 21);
  // Rien de connu avant le 15 : les deux premières semaines sont des trous.
  const r = regrouperComptage(js, 'semaine', j => (j >= '2026-06-15' ? 2 : null));
  assert.equal(r[0].v, null);
  assert.equal(r[1].v, null);
  assert.ok((r[2].v ?? 0) > 0);
});

test('comptage : un bucket à cheval sur la date d’arrivée somme les jours connus', () => {
  // Arrivée le mercredi 2026-06-10 : la semaine du lundi 08 est partiellement connue.
  const js = jours('2026-06-08', 7);
  const r = regrouperComptage(js, 'semaine', j => (j >= '2026-06-10' ? 1 : null));
  assert.equal(r.length, 1);
  assert.equal(r[0].v, 5, 'du 10 au 14 inclus');
});

test('taux : on somme numérateur et dénominateur, jamais la moyenne des pourcentages', () => {
  const js = ['2026-06-08', '2026-06-09'];
  // Jour 1 : 1/1 = 100 %. Jour 2 : 0/99 = 0 %. La moyenne des taux donnerait 50 %.
  const r = regrouperTaux(js, 'semaine', j => (j === '2026-06-08' ? { num: 1, den: 1 } : { num: 0, den: 99 }));
  assert.equal(r.length, 1);
  assert.equal(r[0].v, 1, '1 clic sur 100 envois = 1 %, pas 50 %');
});

test('taux : un denominateur nul est un TROU, pas 0 %', () => {
  // Ce test assertait l'inverse jusqu'au 2026-08-30. « 0 % d'activation » affirmait que
  // personne n'avait clique, alors que rien n'avait ete envoye ce jour-la : il n'y avait
  // rien a activer. La courbe plongeait a chaque jour creux et se lisait comme un
  // effondrement de performance.
  const js = ['2026-06-08', '2026-06-15'];
  const r = regrouperTaux(js, 'semaine', j => (j === '2026-06-08' ? { num: 0, den: 0 } : null));
  assert.equal(r[0].v, null, 'rien envoye ce jour-la : on ne sait pas, on n affirme pas 0 %');
  assert.equal(r[1].v, null, 'hors couverture : trou aussi');
});

test('taux : un vrai zero (des envois, aucun clic) vaut bien 0 %', () => {
  // La contrepartie : quand il Y A eu des envois et zero clic, 0 % est un fait mesure
  // et doit s'afficher. Le trou ne doit pas avaler cette information.
  const js = ['2026-06-08'];
  const r = regrouperTaux(js, 'semaine', () => ({ num: 0, den: 5 }));
  assert.equal(r[0].v, 0);
});

test('libellés d’axe', () => {
  assert.equal(libelleBucket('2026-08-24', 'jour'), '24 août');
  assert.equal(libelleBucket('2026-08-24', 'semaine'), 'sem. 24 août');
  assert.equal(libelleBucket('2026-08-01', 'mois'), 'août 26');
});
