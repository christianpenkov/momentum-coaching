import test from 'node:test';
import assert from 'node:assert/strict';
import { planifierAbsorption, messageRefusPartiel, type SequenceExistante } from './absorptionSequences.ts';

const seq = (o: Partial<SequenceExistante> & { id: string; storyIds: string[] }): SequenceExistante =>
  ({ name: `Séquence ${o.id}`, lm_keyword: null, calendly_short_url: null, ...o });

// ── Le cas nominal : rien à absorber ────────────────────────────────────────

test('sans séquence concernée, il n\'y a rien à absorber', () => {
  assert.deepEqual(planifierAbsorption(['a', 'b'], []), { type: 'aucune' });
});

// ── Le blocage que l'absorption existe pour lever ───────────────────────────

test('une séquence à UNE story est reprise avec son mot-clé', () => {
  // LE cas. Tu publies 4 stories, tu poses META sur la #2 (ce qui crée une
  // séquence à une story), puis tu veux grouper les 4. Sans absorption, refusé
  // pour cause de contiguïté — et sans porte de sortie.
  const r = planifierAbsorption(
    ['s1', 's2', 's3', 's4'],
    [seq({ id: 'A', storyIds: ['s2'], lm_keyword: 'META' })],
  );
  assert.equal(r.type, 'absorber');
  assert.deepEqual((r as any).sequenceIds, ['A']);
  assert.equal((r as any).herite.lmKeyword, 'META');
});

test('un lien Calendly déjà publié suit la story dans la nouvelle séquence', () => {
  // Le lien est physiquement DANS la story publiée : le débrancher casserait le
  // tracking d'un lien vivant.
  const r = planifierAbsorption(
    ['s1', 's2'],
    [seq({ id: 'A', storyIds: ['s1'], calendly_short_url: 'https://l.co/rdv-x' })],
  );
  assert.equal((r as any).herite.calendlyShortUrl, 'https://l.co/rdv-x');
});

test('une séquence absorbée sans CTA ne transmet rien', () => {
  const r = planifierAbsorption(['s1', 's2'], [seq({ id: 'A', storyIds: ['s1'] })]);
  assert.equal(r.type, 'absorber');
  assert.equal((r as any).herite, null);
});

test('plusieurs séquences sans CTA sont toutes reprises', () => {
  const r = planifierAbsorption(
    ['s1', 's2', 's3'],
    [seq({ id: 'A', storyIds: ['s1'] }), seq({ id: 'B', storyIds: ['s2'] })],
  );
  assert.deepEqual((r as any).sequenceIds, ['A', 'B']);
});

// ── Ce qu'on refuse de démanteler ───────────────────────────────────────────

test('une séquence à moitié sélectionnée est refusée, pas démantelée', () => {
  // L'absorber laisserait derrière des stories orphelines et des statistiques
  // amputées, sans que le coach l'ait demandé.
  const r = planifierAbsorption(
    ['s1', 's2'],
    [seq({ id: 'A', storyIds: ['s1', 's8', 's9'], lm_keyword: 'META' })],
  );
  assert.equal(r.type, 'refus-partiel');
  assert.deepEqual((r as any).manquantes, ['s8', 's9']);
});

test('le refus dit QUOI cocher en plus, pas seulement que c\'est refusé', () => {
  const message = messageRefusPartiel(seq({ id: 'A', storyIds: ['s1', 's8'], name: 'Lancement mars' }), ['s8']);
  assert.match(message, /Lancement mars/);
  assert.match(message, /1 story/);
});

test('une séquence entièrement sélectionnée n\'est jamais un refus partiel', () => {
  const r = planifierAbsorption(['s1', 's2', 's3'], [seq({ id: 'A', storyIds: ['s1', 's2'] })]);
  assert.equal(r.type, 'absorber');
});

// ── Le conflit de CTA ───────────────────────────────────────────────────────

test('deux mots-clés différents rendent un conflit, jamais un abandon silencieux', () => {
  // Abandonner un mot-clé sans le dire, c'est le genre de perte qui se paie
  // trois semaines plus tard, quand un prospect ne reçoit rien.
  const r = planifierAbsorption(
    ['s1', 's2', 's3'],
    [seq({ id: 'A', storyIds: ['s1'], lm_keyword: 'META' }), seq({ id: 'B', storyIds: ['s2'], lm_keyword: 'GUIDE' })],
  );
  assert.equal(r.type, 'conflit-cta');
  assert.deepEqual((r as any).candidats.map((c: any) => c.lmKeyword), ['META', 'GUIDE']);
});

test('le choix du coach lève le conflit', () => {
  const r = planifierAbsorption(
    ['s1', 's2', 's3'],
    [seq({ id: 'A', storyIds: ['s1'], lm_keyword: 'META' }), seq({ id: 'B', storyIds: ['s2'], lm_keyword: 'GUIDE' })],
    'B',
  );
  assert.equal(r.type, 'absorber');
  assert.equal((r as any).herite.lmKeyword, 'GUIDE');
  // Les DEUX séquences sont bien absorbées : celle dont on ne garde pas le CTA
  // ne doit pas rester en travers du regroupement.
  assert.deepEqual((r as any).sequenceIds, ['A', 'B']);
});

test('un choix qui ne désigne aucune séquence en lice ne passe pas', () => {
  // Sinon on hériterait d'un CTA que personne n'a vu — ou de rien du tout, en
  // silence, ce qui est pire.
  const r = planifierAbsorption(
    ['s1', 's2'],
    [seq({ id: 'A', storyIds: ['s1'], lm_keyword: 'META' }), seq({ id: 'B', storyIds: ['s2'], lm_keyword: 'GUIDE' })],
    'SEQUENCE-INCONNUE',
  );
  assert.equal(r.type, 'conflit-cta');
});

test('une seule séquence porteuse parmi plusieurs ne demande rien', () => {
  // Le conflit n'existe que s'il y a vraiment deux CTA à départager.
  const r = planifierAbsorption(
    ['s1', 's2', 's3'],
    [seq({ id: 'A', storyIds: ['s1'], lm_keyword: 'META' }), seq({ id: 'B', storyIds: ['s2'] })],
  );
  assert.equal(r.type, 'absorber');
  assert.equal((r as any).herite.lmKeyword, 'META');
  assert.deepEqual((r as any).sequenceIds, ['A', 'B']);
});

test('le refus partiel prime sur le conflit de CTA', () => {
  // On ne fait pas choisir un mot-clé pour une opération qu'on va refuser ensuite.
  const r = planifierAbsorption(
    ['s1', 's2'],
    [seq({ id: 'A', storyIds: ['s1'], lm_keyword: 'META' }), seq({ id: 'B', storyIds: ['s2', 's7'], lm_keyword: 'GUIDE' })],
  );
  assert.equal(r.type, 'refus-partiel');
});
