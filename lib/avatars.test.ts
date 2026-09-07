import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identiteDe, initialesDe } from './avatars.ts';

// Lancé par `npm test`. Fonction pure : ni React, ni réseau, ni base.

// ── L'ordre des sources : le bug qui se voyait ─────────────────────────────

test('la photo Instagram passe avant celle du compte', () => {
  // Un élève venu d'Instagram a les deux. C'est sous son visage IG qu'on le
  // connaît dans le pipeline et les conversations : prendre l'autre le ferait
  // changer de tête d'un écran à l'autre.
  const i = identiteDe({ nom: 'Leroy', photoCompte: 'https://x/compte.jpg', photoInstagram: 'https://x/ig.jpg' });
  assert.equal(i.photo, 'https://x/ig.jpg');
});

test('un prospect de call de vente montre sa photo Instagram', () => {
  // LE cas qui manquait. Un prospect n'a pas de compte Momentum : la page Calls
  // ne lisait que `profiles`, donc n'affichait jamais rien pour lui.
  const i = identiteDe({ nom: 'Leroy', photoCompte: null, photoInstagram: 'https://x/ig.jpg' });
  assert.equal(i.photo, 'https://x/ig.jpg');
});

test('un élève sans Instagram garde la photo de son compte', () => {
  const i = identiteDe({ nom: 'Marie', photoCompte: 'https://x/compte.jpg' });
  assert.equal(i.photo, 'https://x/compte.jpg');
});

test('aucune photo connue : null, jamais une chaîne vide', () => {
  // Une chaîne vide en base passerait le `??` et casserait la balise <img>.
  assert.equal(identiteDe({ nom: 'X' }).photo, null);
  assert.equal(identiteDe({ nom: 'X', photoCompte: '', photoInstagram: '' }).photo, null);
  assert.equal(identiteDe({ nom: 'X', photoCompte: '   ' }).photo, null);
});

test('une photo IG vide laisse la main à celle du compte', () => {
  const i = identiteDe({ nom: 'X', photoCompte: 'https://x/compte.jpg', photoInstagram: '' });
  assert.equal(i.photo, 'https://x/compte.jpg');
});

// ── La graine : la couleur suit la personne ────────────────────────────────

test('la même personne garde sa couleur, quel que soit l’écran', () => {
  // La page Calls passait `call.id` : la MÊME personne changeait de couleur à
  // chaque appel de sa liste.
  const a = identiteDe({ nom: 'Leroy Martin', photoCompte: null });
  const b = identiteDe({ nom: 'Leroy Martin', photoInstagram: null });
  assert.equal(a.graine, b.graine);
});

test('la graine ignore la casse et les espaces de bord', () => {
  assert.equal(identiteDe({ nom: '  Leroy  ' }).graine, identiteDe({ nom: 'leroy' }).graine);
});

test('deux personnes différentes ont deux graines différentes', () => {
  assert.notEqual(identiteDe({ nom: 'Marie' }).graine, identiteDe({ nom: 'Marc' }).graine);
});

// ── Les initiales ──────────────────────────────────────────────────────────

test('un handle Instagram donne des initiales lisibles', () => {
  // `slice(0,2)` brut donnait « ma » pour @marc_dupont.
  assert.equal(initialesDe('@marc_dupont'), 'MD');
  assert.equal(initialesDe('@leroy'), 'L');
  assert.equal(initialesDe('marie.durand'), 'MD');
  assert.equal(initialesDe('jean-pierre'), 'JP');
});

test('un nom composé ne rend que deux lettres', () => {
  assert.equal(initialesDe('Jean Baptiste De La Tour'), 'JB');
});

test('sans nom, un point d’interrogation plutôt qu’un vide', () => {
  assert.equal(initialesDe(null), '?');
  assert.equal(initialesDe(''), '?');
  assert.equal(initialesDe('   '), '?');
});

test('un nom absent ne produit pas un libellé vide', () => {
  // La carte afficherait une ligne sans rien, impossible à distinguer d'un bug.
  assert.equal(identiteDe({ nom: null }).nom, '—');
  assert.equal(identiteDe({ nom: '  ' }).nom, '—');
});
