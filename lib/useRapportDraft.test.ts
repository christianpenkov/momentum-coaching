import { test } from 'node:test';
import assert from 'node:assert/strict';
// Import relatif AVEC extension : `npm test` exécute node --test sur les sources,
// sans résolution de l'alias `@/`. Même contrainte que lib/callSeries.ts.
import { isDraftStale, type RapportDraft, type DraftCallState } from './useRapportDraft.ts';

/**
 * `isDraftStale` répond à UNE question : ce brouillon doit-il être restitué à
 * l'ouverture de la modale ?
 *
 * ── POURQUOI CES TESTS EXISTENT ──────────────────────────────────────────────
 *
 * Cette fonction a été écrite avec `if (isCorrection) return false;` — un
 * brouillon de correction n'expirait jamais. L'intention se comprend : ne pas
 * périmer la correction en cours à cause du rapport qu'elle corrige. L'effet
 * était l'inverse du but — une correction ABANDONNÉE devenait la version
 * restituée, à la place du vrai rapport.
 *
 * Le sens de cette ligne s'est donc inversé le 2026-09-08, et rien ne
 * l'empêchait de se ré-inverser : elle se lit aussi bien dans les deux sens, et
 * le mauvais sens ne casse rien de visible — il montre juste autre chose que ce
 * que la base contient.
 */

// La forme EXACTE de `RapportDraft` — lue dans le module, pas devinee. Ma
// premiere version inventait `stepIndex` / `updatedAt` en camelCase : les tests
// passaient (node --test ne verifie pas les types) et c'est `tsc` qui a arrete.
// Une fabrique de test qui ne respecte pas le type teste autre chose que le code.
const brouillonVente = (isCorrection: boolean): RapportDraft => ({
  id: 'brouillon-test',
  kind: 'sales',
  step: 'show_up',
  step_index: 2,
  step_total: 6,
  answers: { isCorrection },
  updated_at: '2026-09-08T10:00:00Z',
});

const call = (p: Partial<DraftCallState>): DraftCallState =>
  ({ outcome: null, session_completed: null, session_no_show: null, status: 'active', ...p });

// ── La règle qui s'est inversée ──────────────────────────────────────────────

test('un brouillon de CORRECTION est toujours périmé, rapport soumis ou non', () => {
  // Les deux cas, parce que c'est l'origine du défaut : il ne doit dépendre
  // d'AUCUNE condition sur le call. Une correction ne laisse plus de brouillon,
  // donc il ne peut plus en exister de légitime.
  assert.equal(isDraftStale(brouillonVente(true), call({ outcome: 'closed' })), true);
  assert.equal(isDraftStale(brouillonVente(true), call({ outcome: null })), true);
});

test('un brouillon de PREMIÈRE SAISIE survit tant que le rapport n’est pas soumis', () => {
  assert.equal(isDraftStale(brouillonVente(false), call({ outcome: null })), false,
    'quitter en cours de première saisie doit garder les réponses');
});

test('un brouillon de première saisie meurt une fois le rapport soumis', () => {
  // Sinon il réapparaîtrait par-dessus un rapport déjà en base.
  assert.equal(isDraftStale(brouillonVente(false), call({ outcome: 'closed' })), true);
});

// ── Les absences ─────────────────────────────────────────────────────────────

test('sans brouillon ou sans call, rien n’est périmé', () => {
  // `false` et non `true` : « je ne sais pas » ne doit pas jeter un brouillon.
  assert.equal(isDraftStale(null, call({ outcome: 'closed' })), false);
  assert.equal(isDraftStale(brouillonVente(false), null), false);
});

// ── Le coaching, dont la règle est différente ────────────────────────────────

test('un brouillon de coaching meurt sur session_completed ou session_no_show', () => {
  // ⚠️ `'session'` et non `'coaching'` : la doc dit « rapport de coaching », le
  // code dit `session`. J'ai repris le mot humain — deuxième valeur inventée dans
  // ce fichier, et `tsc` a arrêté les deux. Le mot d'un document n'est pas la
  // valeur d'un type.
  const coaching: RapportDraft = {
    id: 'brouillon-coaching', kind: 'session', step: 'attended',
    step_index: 1, step_total: 3, answers: {}, updated_at: '2026-09-08T10:00:00Z',
  };
  assert.equal(isDraftStale(coaching, call({ session_completed: true })), true);
  assert.equal(isDraftStale(coaching, call({ session_no_show: true })), true);
  assert.equal(isDraftStale(coaching, call({ session_completed: false })), false,
    'une séance ni tenue ni manquée n’a pas encore de rapport');
});
