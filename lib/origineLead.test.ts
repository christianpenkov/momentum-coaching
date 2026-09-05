import { test } from 'node:test';
import assert from 'node:assert/strict';
// Import relatif AVEC extension : `npm test` exécute node --test sur les sources,
// sans résolution de l'alias `@/`. Même contrainte que lib/callSeries.ts.
import {
  ORIGINE_COLD_DM, ORIGINE_DM_ENTRANT,
  estOrigineDm, estDmEntrant, sensDuDm, flecheDuDm, LIBELLE_ORIGINE,
} from './origineLead.ts';

// ── Les deux sens sont bien des DM ───────────────────────────────────────────
// C'est la question que posent les quatre lecteurs du pipeline. Si elle répondait
// faux sur le DM entrant, la fiche irait dans « Lead magnet envoyé » — la colonne
// par défaut de `resolveNaturalStage` — sans qu'aucune erreur ne le signale.

test('un cold DM sortant est un DM', () => {
  assert.equal(estOrigineDm(ORIGINE_COLD_DM), true);
});

test('un DM entrant est un DM', () => {
  assert.equal(estOrigineDm(ORIGINE_DM_ENTRANT), true);
});

test('un commentaire n\'est pas un DM', () => {
  assert.equal(estOrigineDm('comment'), false);
});

test('une réponse à une story n\'est pas un DM au sens du pipeline', () => {
  // Elle arrive bien par la messagerie, mais elle a sa propre origine et son
  // propre parcours (séquence story). La ranger avec les DM la ferait compter
  // comme du démarchage.
  assert.equal(estOrigineDm('story_reply'), false);
});

test('une origine inconnue ou absente n\'est jamais un DM', () => {
  assert.equal(estOrigineDm(null), false);
  assert.equal(estOrigineDm(undefined), false);
  assert.equal(estOrigineDm(''), false);
  assert.equal(estOrigineDm('valeur_qui_n_existe_pas'), false);
});

// ── Le sens ──────────────────────────────────────────────────────────────────

test('seul le DM entrant est entrant', () => {
  assert.equal(estDmEntrant(ORIGINE_DM_ENTRANT), true);
  assert.equal(estDmEntrant(ORIGINE_COLD_DM), false);
  assert.equal(estDmEntrant('comment'), false);
});

test('le sens est nul quand la question ne se pose pas', () => {
  // `null` veut dire « il n'y a rien à dire », pas « on ne sait pas » : l'écran
  // n'affiche alors AUCUNE flèche. En afficher une sur un commentaire
  // affirmerait un sens d'envoi qui n'existe pas.
  assert.equal(sensDuDm('comment'), null);
  assert.equal(sensDuDm('story_reply'), null);
  assert.equal(sensDuDm(null), null);
});

test('le sens distingue les deux directions', () => {
  assert.equal(sensDuDm(ORIGINE_COLD_DM), 'sortant');
  assert.equal(sensDuDm(ORIGINE_DM_ENTRANT), 'entrant');
});

// ── La flèche ────────────────────────────────────────────────────────────────

test('la flèche part vers le haut quand le message part de nous', () => {
  assert.equal(flecheDuDm(ORIGINE_COLD_DM), '↗');
});

test('la flèche vient vers le bas quand le message vient vers nous', () => {
  assert.equal(flecheDuDm(ORIGINE_DM_ENTRANT), '↙');
});

test('aucune flèche là où le sens ne veut rien dire', () => {
  assert.equal(flecheDuDm('comment'), '');
  assert.equal(flecheDuDm(null), '');
});

// ── Les libellés ─────────────────────────────────────────────────────────────

test('chaque origine connue a un nom en toutes lettres', () => {
  // Une origine sans libellé s'affiche vide ou sous son nom technique — c'est
  // exactement ce qui donnait « Cold dm sent » dans la chronologie.
  for (const origine of [ORIGINE_COLD_DM, ORIGINE_DM_ENTRANT, 'comment', 'story_reply']) {
    assert.ok(LIBELLE_ORIGINE[origine], `origine sans libellé : ${origine}`);
  }
});

test('les deux sens ne portent pas le même nom', () => {
  assert.notEqual(LIBELLE_ORIGINE[ORIGINE_COLD_DM], LIBELLE_ORIGINE[ORIGINE_DM_ENTRANT]);
});
