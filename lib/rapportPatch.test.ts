import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRapportPatch, isSubmittable, estimateTotal, parseAmount, EMPTY_ANSWERS, type RapportAnswers } from './rapportPatch.ts';

// Lancé par `npm test`. Couvre les 5 chemins terminaux du rapport de vente sans
// React, sans réseau, sans base — c'est ce qui protège le prochain changement.

function reponses(patch: Partial<RapportAnswers> = {}): RapportAnswers {
  return { ...EMPTY_ANSWERS, ...patch };
}

// ── Les 5 chemins terminaux ────────────────────────────────────────────────

test('no-show : outcome no_show, revenue à 0, deal fermé', () => {
  const { rapport, callFields } = buildRapportPatch(reponses({ showedUp: false }));
  assert.equal(rapport.outcome, 'no_show');
  assert.equal(rapport.no_show, true);
  assert.equal(rapport.revenue, 0);
  assert.equal(rapport.deal_closed, false);
  assert.deepEqual(callFields, {});
});

test('closé : outcome closed avec le montant saisi', () => {
  const { rapport } = buildRapportPatch(reponses({
    showedUp: true, qualified: true, outcomeChoice: 'closed', revenue: '2500',
  }));
  assert.equal(rapport.outcome, 'closed');
  assert.equal(rapport.deal_closed, true);
  assert.equal(rapport.revenue, 2500);
  assert.equal(rapport.no_show, false);
});

test('2ème call : outcome second_call, aucun revenu', () => {
  const { rapport } = buildRapportPatch(reponses({
    showedUp: true, qualified: true, outcomeChoice: 'second_call',
  }));
  assert.equal(rapport.outcome, 'second_call');
  assert.equal(rapport.revenue, 0);
  assert.equal(rapport.deal_closed, false);
});

test('à recontacter : outcome to_recontact', () => {
  const { rapport } = buildRapportPatch(reponses({
    showedUp: true, qualified: false, outcomeChoice: 'to_recontact',
  }));
  assert.equal(rapport.outcome, 'to_recontact');
  assert.equal(rapport.revenue, 0);
});

test('reporté : rescheduled va dans callFields, pas dans rapport', () => {
  const { rapport, callFields } = buildRapportPatch(reponses({
    showedUp: true, outcomeChoice: 'rescheduled', reschedHow: 'calendly',
  }));
  assert.equal(rapport.outcome, 'rescheduled');
  assert.equal(callFields.rescheduled, true);
  assert.ok(typeof callFields.rescheduled_at === 'string');
  // Pas de saisie manuelle : le call garde sa date.
  assert.equal(callFields.scheduled_at, undefined);
});

test('reporté avec date manuelle : le call est déplacé', () => {
  const nouvelle = '2026-09-15T12:00:00.000Z';
  const { callFields } = buildRapportPatch(reponses({
    showedUp: true, outcomeChoice: 'rescheduled', reschedHow: 'manual',
  }), nouvelle);
  assert.equal(callFields.scheduled_at, nouvelle);
});

// ── Le bug d'origine, verrouillé ───────────────────────────────────────────

test("qualified part TOUJOURS avec outcome, jamais seul", () => {
  // C'est le cœur du chantier : avant, une étape intermédiaire écrivait
  // `qualified` seul, sur un rapport jamais terminé.
  for (const choix of ['closed', 'second_call', 'to_recontact'] as const) {
    const { rapport } = buildRapportPatch(reponses({
      showedUp: true, qualified: true, outcomeChoice: choix, revenue: '100',
    }));
    assert.ok('outcome' in rapport, `${choix} doit poser un outcome`);
    assert.equal(rapport.qualified, true, `${choix} doit porter qualified`);
  }
});

test('qualified non répondu : le champ est absent, la colonne intacte', () => {
  const { rapport } = buildRapportPatch(reponses({
    showedUp: true, qualified: null, outcomeChoice: 'to_recontact',
  }));
  assert.ok(!('qualified' in rapport));
});

test('un no-show ne porte jamais qualified', () => {
  const { rapport } = buildRapportPatch(reponses({ showedUp: false, qualified: true }));
  assert.ok(!('qualified' in rapport));
});

// ── Commentaire : le piège de la correction ────────────────────────────────

test('saisie initiale : commentaire vide = champ omis', () => {
  const { rapport } = buildRapportPatch(reponses({
    showedUp: true, outcomeChoice: 'to_recontact', comment: '   ',
  }));
  assert.ok(!('lead_rapport_comment' in rapport));
});

test('correction : commentaire vidé = chaîne vide envoyée, donc effacé', () => {
  // La route fait `slice(0, 2000) || null` : une chaîne vide écrit null.
  // Omettre le champ laisserait l'ancien commentaire en place.
  const { rapport } = buildRapportPatch(reponses({
    showedUp: true, outcomeChoice: 'closed', revenue: '10', comment: '', isCorrection: true,
  }));
  assert.equal(rapport.lead_rapport_comment, '');
});

test('commentaire renseigné : rogné et transmis', () => {
  const { rapport } = buildRapportPatch(reponses({
    showedUp: true, outcomeChoice: 'closed', revenue: '10', comment: '  bon feeling  ',
  }));
  assert.equal(rapport.lead_rapport_comment, 'bon feeling');
});

// ── Montants ───────────────────────────────────────────────────────────────

test('parseAmount accepte la virgule décimale', () => {
  assert.equal(parseAmount('1500,50'), 1500.5);
  assert.equal(parseAmount('1500.50'), 1500.5);
  assert.equal(parseAmount(''), 0);
  assert.equal(parseAmount('abc'), 0);
});

// ── Soumettable ────────────────────────────────────────────────────────────

test('isSubmittable', () => {
  assert.equal(isSubmittable(reponses()), false, 'rien répondu');
  assert.equal(isSubmittable(reponses({ showedUp: true })), false, 'présent mais pas de résultat');
  assert.equal(isSubmittable(reponses({ showedUp: false })), true, 'no-show suffit');
  assert.equal(isSubmittable(reponses({ showedUp: true, outcomeChoice: 'closed' })), true);
});

// ── Progression ────────────────────────────────────────────────────────────

test('estimateTotal garde index <= total après un retour arrière', () => {
  // Descendre en closed (total 5), remonter, repartir sur no-show : sans le
  // Math.max on afficherait « étape 6/3 ».
  assert.ok(estimateTotal(reponses({ showedUp: false }), 5) >= 6);
  assert.equal(estimateTotal(reponses({ showedUp: true, outcomeChoice: 'closed' }), 1), 5);
  assert.equal(estimateTotal(reponses({ showedUp: true, outcomeChoice: 'rescheduled' }), 1), 3);
});
