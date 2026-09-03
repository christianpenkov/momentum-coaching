import test from 'node:test';
import assert from 'node:assert/strict';
import { canalDuDm, sourceDeclareeValide, SOURCE_DM_ENTRANT, SOURCE_DM_SORTANT } from './canalDm.ts';

// Les valeurs relevées en base le 2026-09-01 sur `instagram_leads.source` :
// 'comment' (4 lignes) et 'cold_dm' (2). 'story_reply' existe dans le webhook.
test('les sources réelles de la base tombent dans le bon bac', () => {
  assert.equal(canalDuDm('comment'), 'entrant');
  assert.equal(canalDuDm('cold_dm'), 'sortant');
  assert.equal(canalDuDm('story_reply'), 'story');
});

test('les deux réponses du coach tombent dans le bon bac', () => {
  assert.equal(canalDuDm(SOURCE_DM_ENTRANT), 'entrant');
  assert.equal(canalDuDm(SOURCE_DM_SORTANT), 'sortant');
});

test('un DM entrant rejoint le commentaire, pas le Cold DM', () => {
  // Décision de Chris, et définition que le code portait déjà : « DM organique »
  // = tout DM que le prospect a initié. Le classer en Cold DM dirait « le coach
  // est allé le chercher », ce qui est exactement le contraire.
  assert.equal(canalDuDm(SOURCE_DM_ENTRANT), canalDuDm('comment'));
  assert.notEqual(canalDuDm(SOURCE_DM_ENTRANT), canalDuDm('cold_dm'));
});

test("une source absente reste 'sortant', mais par décision et non par oubli", () => {
  // C'est le comportement d'avant, conserve pour les 2 liens crees avant que la
  // colonne existe. La difference est qu'il est ecrit ici, une fois.
  assert.equal(canalDuDm(null), 'sortant');
  assert.equal(canalDuDm(undefined), 'sortant');
  assert.equal(canalDuDm(''), 'sortant');
});

test('une source inventée ne peut pas se faire passer pour un commentaire', () => {
  // La route n'accepte du client que les deux réponses de la question. Sans
  // liste blanche, un appel pourrait écrire 'comment' et s'inventer un
  // commentaire qui n'a jamais eu lieu.
  assert.equal(sourceDeclareeValide('comment'), false);
  assert.equal(sourceDeclareeValide('story_reply'), false);
  assert.equal(sourceDeclareeValide('cold_dm'), false);
  assert.equal(sourceDeclareeValide(null), false);
  assert.equal(sourceDeclareeValide(''), false);
  assert.equal(sourceDeclareeValide(SOURCE_DM_ENTRANT), true);
  assert.equal(sourceDeclareeValide(SOURCE_DM_SORTANT), true);
});

test('les trois bacs sont exhaustifs et exclusifs', () => {
  // Un lien tombe dans exactement un bac : la partition du Breakdown en dépend,
  // et n'en corriger qu'un côté ferait compter deux fois.
  for (const s of ['comment', 'cold_dm', 'story_reply', SOURCE_DM_ENTRANT, SOURCE_DM_SORTANT, null, 'inconnu']) {
    const canal = canalDuDm(s);
    assert.equal(['sortant', 'entrant', 'story'].filter(c => c === canal).length, 1, `bac unique pour ${s}`);
  }
});
