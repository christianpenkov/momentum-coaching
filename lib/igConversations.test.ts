import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  estLeCompte, estSortant, interlocuteur, typePieceJointe, lienDiscussion,
} from './igConversations.ts';

// Lancé par `npm test` (node --test, sans aucune dépendance à installer).
//
// Ces quatre fonctions ont un point commun : quand elles se trompent, RIEN ne
// casse. Le fil s'affiche, les bulles sont là, et il raconte l'inverse de la
// vérité. C'est le seul endroit où ça se vérifie.
//
// Deux d'entre elles encodent le même piège Meta — `entry.id` ≠ `ig_account_id`
// — déjà payé deux fois dans ce projet. Les tests le figent.

// Valeurs RÉELLES, relevées le 2026-09-04 sur le compte de test.
const COMPTE = { igAccountId: '26886602587671296', entryId: '17841410050226823' };
const PROSPECT = '994032013431986';

// ── Les deux formes du compte ───────────────────────────────────────────────

test('le compte est reconnu sous ses DEUX formes', () => {
  assert.equal(estLeCompte('26886602587671296', COMPTE), true, 'forme ig_account_id');
  assert.equal(estLeCompte('17841410050226823', COMPTE), true, 'forme entry.id');
  assert.equal(estLeCompte(PROSPECT, COMPTE), false, 'le prospect n’est pas le compte');
});

test('sans entry.id connu, seule la forme ig_account_id compte', () => {
  const sansEntry = { igAccountId: '26886602587671296' };
  assert.equal(estLeCompte('26886602587671296', sansEntry), true);
  assert.equal(estLeCompte('17841410050226823', sansEntry), false);
});

test('un identifiant vide ou absent n’est jamais le compte', () => {
  assert.equal(estLeCompte(null, COMPTE), false);
  assert.equal(estLeCompte(undefined, COMPTE), false);
  assert.equal(estLeCompte('', COMPTE), false);
});

// ── Direction du message ────────────────────────────────────────────────────

test('is_echo suffit à dire « envoyé par l’élève »', () => {
  const ev = { sender: { id: COMPTE.entryId }, message: { is_echo: true } };
  assert.equal(estSortant(ev, COMPTE), true);
});

test('expéditeur = compte sous forme ig_account_id → sortant', () => {
  assert.equal(estSortant({ sender: { id: COMPTE.igAccountId } }, COMPTE), true);
});

// ⚠️ LE test qui compte. Sans lui, la seule protection contre le piège
// `entry.id` est le souvenir de la personne qui relit — et ce piège a déjà
// coûté deux fois. Une charge utile sans `is_echo` dont l'expéditeur est le
// compte sous sa forme `entry.id` serait classée « reçue » : le fil montrerait
// les messages de l'élève comme venant du prospect.
test('expéditeur = compte sous forme entry.id → sortant AUSSI', () => {
  assert.equal(estSortant({ sender: { id: COMPTE.entryId } }, COMPTE), true);
});

test('expéditeur = le prospect → message reçu', () => {
  assert.equal(estSortant({ sender: { id: PROSPECT } }, COMPTE), false);
});

test('is_echo à false n’impose rien — c’est l’expéditeur qui tranche', () => {
  assert.equal(estSortant({ sender: { id: PROSPECT }, message: { is_echo: false } }, COMPTE), false);
  assert.equal(estSortant({ sender: { id: COMPTE.entryId }, message: { is_echo: false } }, COMPTE), true);
});

// ── L'interlocuteur ─────────────────────────────────────────────────────────

// Mesuré : l'API rend le compte de l'élève sous sa forme `entry.id` dans
// `participants`. Comparer au seul `ig_account_id` créerait un fil « avec
// soi-même » pour CHAQUE conversation.
test('le compte sous forme entry.id est exclu des interlocuteurs', () => {
  const p = [
    { id: COMPTE.entryId, username: 'chris.pkv' },
    { id: PROSPECT, username: 'rdjdkzjd' },
  ];
  assert.deepEqual(interlocuteur(p, COMPTE), { id: PROSPECT, username: 'rdjdkzjd' });
});

test('le compte sous forme ig_account_id est exclu lui aussi', () => {
  const p = [
    { id: COMPTE.igAccountId, username: 'chris.pkv' },
    { id: PROSPECT, username: 'rdjdkzjd' },
  ];
  assert.equal(interlocuteur(p, COMPTE)?.username, 'rdjdkzjd');
});

test('aucun autre participant → null, pas une exception', () => {
  assert.equal(interlocuteur([{ id: COMPTE.entryId }], COMPTE), null);
  assert.equal(interlocuteur([], COMPTE), null);
  assert.equal(interlocuteur(null, COMPTE), null);
  assert.equal(interlocuteur(undefined, COMPTE), null);
});

test('plusieurs autres participants → null : un fil de groupe n’est pas géré', () => {
  const p = [{ id: COMPTE.entryId }, { id: PROSPECT }, { id: '777' }];
  assert.equal(interlocuteur(p, COMPTE), null);
});

// ── Pièces jointes ──────────────────────────────────────────────────────────

test('un message texte n’a aucune pièce jointe', () => {
  assert.equal(typePieceJointe({ text: 'salut' }), null);
  assert.equal(typePieceJointe({ text: 'salut', attachments: [] }), null);
  assert.equal(typePieceJointe(null), null);
  assert.equal(typePieceJointe(undefined), null);
});

test('les types connus passent tels quels', () => {
  for (const t of ['image', 'video', 'audio', 'file', 'share']) {
    assert.equal(typePieceJointe({ attachments: [{ type: t }] }), t, t);
  }
});

test('un reel partagé est rangé avec les partages', () => {
  assert.equal(typePieceJointe({ attachments: [{ type: 'ig_reel' }] }), 'share');
  assert.equal(typePieceJointe({ attachments: [{ type: 'reel' }] }), 'share');
});

// Sans marqueur, le fil afficherait la phrase sans son contexte : le coach
// lirait « trop cher » sans savoir à quelle story ça répond.
test('une réponse à une story est marquée, même quand elle porte du texte', () => {
  assert.equal(typePieceJointe({ text: 'trop cher', reply_to: { story: { id: '42' } } }), 'story_reply');
});

// Meta ajoute des types sans prévenir. Un message qui ferait lever le worker
// arrêterait aussi les DM1 automatiques — la panne dépasserait de loin l'écran.
test('un type inconnu rend « autre », jamais une exception', () => {
  assert.equal(typePieceJointe({ attachments: [{ type: 'hologramme_2031' }] }), 'autre');
});

// ── Le lien vers la discussion ──────────────────────────────────────────────

// Identifiants RÉELS, et leur décodage vérifié en session Instagram connectée.
const CONV_REELLE = 'aWdfZAG06MzQwMjgyMzY2ODQxNzEwMzAxMjQ0MjU5MDcyODQwODUzNzU5NDMw';
const NUMERO_ATTENDU = '340282366841710301244259072840853759430';

test('sur ordinateur, le lien tombe sur LE bon fil', () => {
  assert.equal(
    lienDiscussion(CONV_REELLE, 'rdjdkzjd'),
    `https://www.instagram.com/direct/t/${NUMERO_ATTENDU}/`,
  );
});

test('sur téléphone, on vise ig.me — le lien profond y ouvre l’application', () => {
  assert.equal(lienDiscussion(CONV_REELLE, 'rdjdkzjd', true), 'https://ig.me/m/rdjdkzjd');
});

// ⚠️ Ces trois tests portent sur un repli qui ne se déclenchera JAMAIS tant que
// Meta ne change rien. C'est précisément pour ça qu'ils existent : sans eux,
// personne ne saura jamais si le repli fonctionne, et la première relecture le
// supprimera comme du code mort.
test('préfixe inattendu → repli sur ig.me, jamais un lien fabriqué', () => {
  assert.equal(lienDiscussion('AUTRE_PREFIXE_xyz', 'rdjdkzjd'), 'https://ig.me/m/rdjdkzjd');
});

test('décodage non numérique → repli sur ig.me', () => {
  // Préfixe attendu, mais la suite décode en texte au lieu d'un nombre.
  const bidon = 'aWdfZAG06' + Buffer.from('pas-un-nombre').toString('base64');
  assert.equal(lienDiscussion(bidon, 'rdjdkzjd'), 'https://ig.me/m/rdjdkzjd');
});

test('base64 invalide → repli, sans lever', () => {
  assert.equal(lienDiscussion('aWdfZAG06!!!***', 'rdjdkzjd'), 'https://ig.me/m/rdjdkzjd');
});

// Un bouton qui ne mène nulle part est pire que pas de bouton : l'élève clique,
// atterrit sur une erreur Instagram, et conclut que la plateforme est cassée.
test('ni numéro décodable ni pseudo → aucun lien du tout', () => {
  assert.equal(lienDiscussion('AUTRE', null), null);
  assert.equal(lienDiscussion(null, null), null);
  assert.equal(lienDiscussion(null, undefined, true), null);
});
