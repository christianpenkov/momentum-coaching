import test from 'node:test';
import assert from 'node:assert/strict';
import { refusSequence } from './sequenceDm.ts';

// Les valeurs par défaut proposées par les deux formulaires, telles qu'elles
// apparaissent à l'ouverture d'une séquence neuve.
const valide = {
  accroche: "Salut {{username}} ! Je t'envoie ça tout de suite 👇",
  accrocheBtn: '🚀 Je veux le lien !',
  lienBtn: '📖 Accéder au lien',
};

test('une séquence complète passe', () => {
  assert.equal(refusSequence(valide), null);
});

test('les trois champs obligatoires sont refusés vides', () => {
  for (const champ of ['accroche', 'accrocheBtn', 'lienBtn'] as const) {
    const refus = refusSequence({ ...valide, [champ]: '' });
    assert.ok(refus, `${champ} vide aurait dû être refusé`);
  }
});

test('des espaces ne remplacent pas un contenu', () => {
  // Un champ « rempli » d'espaces produit exactement le même DM générique qu'un
  // champ vide : c'est la même panne, écrite autrement.
  assert.ok(refusSequence({ ...valide, accroche: '   ' }));
  assert.ok(refusSequence({ ...valide, accrocheBtn: '\n\t ' }));
  assert.ok(refusSequence({ ...valide, lienBtn: ' ' }));
});

test('le refus nomme le champ en cause, pas un message générique', () => {
  // Le coach doit savoir lequel des cinq champs corriger sans les essayer un par
  // un — trois refus identiques ne valent pas mieux qu'un bouton grisé sans motif.
  const messages = (['accroche', 'accrocheBtn', 'lienBtn'] as const)
    .map(champ => refusSequence({ ...valide, [champ]: '' }));
  assert.equal(new Set(messages).size, 3);
});

test('le premier champ manquant est celui qui est signalé', () => {
  // Ordre du parcours, pas ordre du formulaire : on corrige le début de la
  // conversation d'abord, sinon le coach répare un bouton dans une séquence dont
  // le premier message n'existe pas.
  const refus = refusSequence({ accroche: '', accrocheBtn: '', lienBtn: '' });
  assert.equal(refus, refusSequence({ ...valide, accroche: '' }));
});

test("le texte du lien et la relance ne sont pas demandés", () => {
  // Règle explicite de Chris : le DM qui porte le bouton peut n'être qu'un
  // bouton, et une relance vide est une relance qui n'existe pas. La fonction ne
  // les reçoit donc même pas — ce test fige l'intention, pas l'implémentation.
  assert.equal(refusSequence(valide), null);
  assert.ok(!('lien' in valide));
  assert.ok(!('relance' in valide));
});
