import test from 'node:test';
import assert from 'node:assert/strict';
import { etatStory, etatSequence, LIBELLE_ETAT, DUREE_VIE_STORY_MS, type StoryDatee } from './etatStory.ts';

const MAINTENANT = new Date('2026-09-08T14:00:00.000Z').getTime();
const ilYA = (ms: number) => new Date(MAINTENANT - ms).toISOString();
const HEURE = 60 * 60 * 1000;

const story = (o: StoryDatee): StoryDatee => o;

// ── Le défaut qui a motivé ce fichier ───────────────────────────────────────

test("une story de plus de 24 h est expirée, même sans expired_at", () => {
  // LE bug. Mesuré en base le 2026-09-08 : 5 stories sur 8 affichaient « Active »
  // alors qu'elles étaient publiées depuis plus de 24 h. `expired_at` n'est posé
  // qu'au passage du cron, qui tourne une fois par SEMAINE.
  const capture = story({ postedAt: ilYA(40 * HEURE), expiredAt: null });
  assert.equal(etatStory(capture, MAINTENANT), 'expiree');
});

test('une story publiée il y a moins de 24 h est active', () => {
  assert.equal(etatStory(story({ postedAt: ilYA(3 * HEURE) }), MAINTENANT), 'active');
});

test('la bascule se fait exactement à 24 h', () => {
  assert.equal(etatStory(story({ postedAt: ilYA(DUREE_VIE_STORY_MS - 1000) }), MAINTENANT), 'active');
  assert.equal(etatStory(story({ postedAt: ilYA(DUREE_VIE_STORY_MS) }), MAINTENANT), 'expiree');
});

test('expired_at fait foi pour une story retirée AVANT ses 24 h', () => {
  // Le cas que `postedAt + 24 h` seul ne couvre pas : le coach supprime sa story
  // au bout de deux heures. Le cron finit par le voir, tardivement — mais
  // tardivement vaut mieux que jamais, et il ne peut que confirmer une mort.
  const retiree = story({ postedAt: ilYA(2 * HEURE), expiredAt: ilYA(1 * HEURE) });
  assert.equal(etatStory(retiree, MAINTENANT), 'expiree');
});

test('une parution illisible ne prononce pas une mort qu\'on ne sait pas dater', () => {
  // Proposer « Active » à tort se corrige au passage suivant du cron ; afficher
  // « Expirée » sur une story bien en ligne enverrait chercher un problème qui
  // n'existe pas.
  for (const parution of [null, undefined, '', 'pas une date']) {
    assert.equal(etatStory(story({ postedAt: parution as any }), MAINTENANT), 'active', `${parution}`);
  }
});

// ── L'état d'une séquence ───────────────────────────────────────────────────

test('une séquence sans story est en préparation', () => {
  // Le lien Calendly existe, les stories ne sont pas encore publiées.
  assert.equal(etatSequence([], MAINTENANT), 'preparation');
});

test('une séquence est active tant qu\'UNE de ses stories est en ligne', () => {
  const seq = [
    story({ postedAt: ilYA(30 * HEURE) }),
    story({ postedAt: ilYA(2 * HEURE) }),
  ];
  assert.equal(etatSequence(seq, MAINTENANT), 'active');
});

test('une séquence dont toutes les stories ont expiré est expirée', () => {
  // Elle est RÉELLEMENT morte : le webhook exige un `reply_to.story.id` pour
  // reconnaître un mot-clé, et on ne peut plus répondre à une story disparue.
  const seq = [
    story({ postedAt: ilYA(50 * HEURE) }),
    story({ postedAt: ilYA(30 * HEURE) }),
  ];
  assert.equal(etatSequence(seq, MAINTENANT), 'expiree');
});

test('une séquence à UNE story suit l\'état de cette story', () => {
  // Le nouveau cas normal : un mot-clé sur une story unique crée une séquence
  // à une story.
  assert.equal(etatSequence([story({ postedAt: ilYA(2 * HEURE) })], MAINTENANT), 'active');
  assert.equal(etatSequence([story({ postedAt: ilYA(40 * HEURE) })], MAINTENANT), 'expiree');
});

// ── Le vocabulaire ──────────────────────────────────────────────────────────

test('stories et séquences partagent le mot « Expirée »', () => {
  // Décision de Chris le 2026-09-08 : « Terminée » sur les séquences aurait
  // ajouté un vocabulaire de plus pour la même idée.
  assert.equal(LIBELLE_ETAT.expiree, 'Expirée');
  assert.equal(LIBELLE_ETAT.active, 'Active');
  assert.equal(LIBELLE_ETAT.preparation, 'En préparation');
});
