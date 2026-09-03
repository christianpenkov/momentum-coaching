import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SOURCES_PAGE, HORS_PAGE, etatDesSources, sourcesManquantes, sansAudience, enumerer,
} from './sourcesStatsClients.ts';

// Lancé par `npm test`. Fonctions pures : ni React, ni réseau, ni base.

const ligne = (profile_id: string, provider: string, status = 'ok') => ({ profile_id, provider, status });

/* ═══ La liste elle-même ══════════════════════════════════════════════════ */

test('cinq sources, et Fathom / Google Calendar en sont volontairement absents', () => {
  // Ils sont obligatoires pour la plateforme, mais Stats Clients n'affiche rien qui en
  // dépende : les signaler enverrait le coach reconnecter un outil qui ne changerait
  // pas un chiffre de la page.
  assert.equal(SOURCES_PAGE.length, 5);
  const noms = SOURCES_PAGE.map(s => s.provider);
  assert.deepEqual(noms, ['instagram', 'youtube', 'shortio', 'calendly', 'stripe']);
  for (const exclu of HORS_PAGE) {
    assert.ok(!noms.includes(exclu), `${exclu} ne doit pas figurer dans les sources de la page`);
  }
});

test("seules Instagram et YouTube portent l'audience", () => {
  assert.deepEqual(SOURCES_PAGE.filter(s => s.audience).map(s => s.provider), ['instagram', 'youtube']);
});

/* ═══ Regroupement par élève ══════════════════════════════════════════════ */

test('une intégration hors page est ignorée, pas comptée comme branchée', () => {
  // Le cas réel : un élève avec Fathom connecté n'en tire aucun chiffre sur cette page.
  const e = etatDesSources([ligne('p1', 'fathom'), ligne('p1', 'google'), ligne('p1', 'shortio')]);
  assert.deepEqual([...e.get('p1')!.branchees], ['shortio']);
});

test('un élève sans aucune ligne est absent de la table, pas branché à vide', () => {
  const e = etatDesSources([ligne('p1', 'instagram')]);
  assert.equal(e.get('p2'), undefined);
  assert.deepEqual(sourcesManquantes(e.get('p2')).map(s => s.provider),
    ['instagram', 'youtube', 'shortio', 'calendly', 'stripe'],
    'tout manque à un élève inconnu');
});

test('un statut en panne marque la source SANS la retirer des branchées', () => {
  // Les deux situations n'appellent pas la même action : une intégration tombée a des
  // chiffres figés à réparer, une jamais branchée n'a rien eu du tout.
  const e = etatDesSources([ligne('p1', 'instagram', 'expired')]).get('p1')!;
  assert.deepEqual([...e.branchees], ['instagram']);
  assert.deepEqual([...e.cassees], ['instagram']);
  assert.equal(sansAudience(e), false, 'une source tombée reste une source');
});

test('les trois statuts de panne sont reconnus, et eux seuls', () => {
  for (const s of ['error', 'expired', 'revoked']) {
    assert.equal(etatDesSources([ligne('p', 'stripe', s)]).get('p')!.cassees.size, 1, s);
  }
  for (const s of ['ok', 'non_connectee', 'pending']) {
    assert.equal(etatDesSources([ligne('p', 'stripe', s)]).get('p')!.cassees.size, 0, s);
  }
});

/* ═══ Ce qui manque ═══════════════════════════════════════════════════════ */

test('le cas réel de Meta Review : Short.io seul', () => {
  // Relevé en base le 2026-09-03. Il produisait 18 lignes de snapshots aux colonnes
  // d'audience toutes nulles, donc un critère fondé sur « a-t-il des lignes » le
  // laissait passer.
  const e = etatDesSources([ligne('p', 'shortio')]).get('p');
  assert.equal(sansAudience(e), true);
  assert.deepEqual(sourcesManquantes(e).map(s => s.provider), ['instagram', 'youtube', 'calendly', 'stripe']);
});

test('le cas réel de Dolphin : Instagram et Short.io', () => {
  const e = etatDesSources([ligne('p', 'instagram'), ligne('p', 'shortio')]).get('p');
  assert.equal(sansAudience(e), false, 'Instagram suffit à le faire apparaître sur les graphes');
  assert.deepEqual(sourcesManquantes(e).map(s => s.provider), ['youtube', 'calendly', 'stripe']);
});

test("YouTube seul suffit à avoir de l'audience — la règle est OU, pas ET", () => {
  const e = etatDesSources([ligne('p', 'youtube')]).get('p');
  assert.equal(sansAudience(e), false);
});

test('un élève complet ne manque de rien', () => {
  const toutes = SOURCES_PAGE.map(s => ligne('p', s.provider));
  const e = etatDesSources(toutes).get('p');
  assert.deepEqual(sourcesManquantes(e), []);
  assert.equal(sansAudience(e), false);
});

test("les manquantes gardent l'ordre de la liste, l'audience en tête", () => {
  // L'ordre décide de ce que le coach lit en premier : l'audience commande si l'élève
  // apparaît sur les graphes, le reste ne vide qu'une colonne.
  const e = etatDesSources([ligne('p', 'calendly')]).get('p');
  assert.deepEqual(sourcesManquantes(e).map(s => s.provider), ['instagram', 'youtube', 'shortio', 'stripe']);
});

/* ═══ Énumération française ═══════════════════════════════════════════════ */

test('l’énumération se termine par « et », jamais par une virgule', () => {
  assert.equal(enumerer([]), '');
  assert.equal(enumerer(['Instagram']), 'Instagram');
  assert.equal(enumerer(['Instagram', 'YouTube']), 'Instagram et YouTube');
  assert.equal(enumerer(['Short.io', 'Calendly', 'Stripe']), 'Short.io, Calendly et Stripe');
});
