import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliser, correspond, filtrerCalls } from './rechercheCalls.ts';

// Lancé par `npm test`. Fonction pure : ni React, ni réseau, ni base.

test('une recherche vide accepte tout', () => {
  // C'est ce qui permet d'appeler le filtre sans condition, plutôt que de le
  // sauter quand le champ est vide — deux chemins qui finiraient par diverger.
  assert.equal(correspond('Leroy', ''), true);
  assert.equal(correspond('Leroy', '   '), true);
  assert.equal(correspond(null, ''), true);
});

test('la recherche ignore les accents', () => {
  // Les noms viennent de Calendly et d'Instagram : personne ne les tape avec
  // leurs diacritiques.
  assert.equal(correspond('Léroy', 'leroy'), true);
  assert.equal(correspond('Joël Müller', 'joel'), true);
  assert.equal(correspond('Renée', 'renee'), true);
  assert.equal(correspond('Leroy', 'léroy'), true);
});

test('la recherche ignore la casse', () => {
  assert.equal(correspond('LEROY', 'leroy'), true);
  assert.equal(correspond('leroy', 'LEROY'), true);
});

test('la recherche trouve au milieu du nom', () => {
  // Chercher un nom de famille sans taper le prénom.
  assert.equal(correspond('Jean Dupont', 'dupont'), true);
  assert.equal(correspond('Jean Dupont', 'up'), true);
});

test('un nom qui ne correspond pas est écarté', () => {
  assert.equal(correspond('Marie', 'leroy'), false);
});

test('un call sans nom ne correspond à rien de tapé', () => {
  assert.equal(correspond(null, 'leroy'), false);
  assert.equal(correspond('', 'leroy'), false);
});

test('les espaces autour de la recherche sont ignorés', () => {
  assert.equal(correspond('Leroy', '  leroy  '), true);
});

test('normaliser rend une chaîne vide sur une absence', () => {
  assert.equal(normaliser(null), '');
  assert.equal(normaliser(undefined), '');
  assert.equal(normaliser('  '), '');
});

// ── Le filtre de liste ─────────────────────────────────────────────────────

const CALLS = [
  { id: '1', qui: 'Léroy Martin' },
  { id: '2', qui: 'Marie Dupont' },
  { id: '3', qui: null },
  { id: '4', qui: 'leroy bis' },
];

test('le filtre garde les calls de la personne cherchée', () => {
  const r = filtrerCalls(CALLS, 'leroy', c => c.qui);
  assert.deepEqual(r.map(c => c.id), ['1', '4']);
});

test('une recherche vide rend la liste entière', () => {
  assert.equal(filtrerCalls(CALLS, '', c => c.qui).length, CALLS.length);
});

test('le filtre ne modifie pas la liste d’origine', () => {
  const avant = CALLS.length;
  filtrerCalls(CALLS, 'leroy', c => c.qui);
  assert.equal(CALLS.length, avant);
});

test('le nom vient de l’appelant, pas d’une colonne devinée', () => {
  // Le nom affiché se résout différemment côté coach et côté élève. Le déduire
  // ici ferait diverger la recherche de ce qui est écrit à l'écran.
  const r = filtrerCalls(CALLS, 'coach', () => 'Coach');
  assert.equal(r.length, CALLS.length);
});
