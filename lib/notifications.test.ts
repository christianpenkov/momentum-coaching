import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CORPS_MAX,
  nouvellesPublications,
  nouvellesStories,
  PARAM_STORIES_A_GROUPER,
  typePublication,
  typeDuLot,
  rapportDeCall,
  invitationCall,
  envoiInstagramRefuse,
  TAG_MESSAGERIE,
  type NotifPush,
} from './notifications.ts';

// Lancé par `npm test`. Aucun import, ni React, ni réseau : c'est la condition
// pour que ce catalogue soit lisible à la fois par Next.js et par Deno.

// ── La règle qui vaut pour TOUTES les notifications ─────────────────────────
//
// Le service worker tronque le corps à 100 caractères, et c'est la FIN qui porte
// l'action à faire. Une troncature ne se voit pas en développement, seulement
// sur le téléphone — donc elle se teste ici, avec les valeurs les plus longues
// qu'on puisse rencontrer et non avec des exemples confortables.

const CAS_LES_PLUS_LONGS: [string, NotifPush][] = [
  ['publications — 3 chiffres', nouvellesPublications({ nombre: 999, type: 'mixte', premierId: 'p1' })],
  ['publications — une seule', nouvellesPublications({ nombre: 1, type: 'reel', premierId: 'p1' })],
  ['stories — 2', nouvellesStories({ storyIds: ['s1', 's2'] })],
  ['stories — 12', nouvellesStories({ storyIds: Array.from({ length: 12 }, (_, i) => `story${i}`) })],
  ['rapport — nom à rallonge', rapportDeCall({ callId: 'c1', inviteeName: 'Jean-Baptiste de La Rochefoucauld-Montmorency' })],
  ['invitation — coach au nom long', invitationCall({ callId: 'c1', coachPrenom: 'Maximilien-Alexandre', heure: '14:30', echeance: '24h' })],
];

for (const [nom, notif] of CAS_LES_PLUS_LONGS) {
  test(`corps sous la limite du service worker — ${nom}`, () => {
    assert.ok(
      notif.body.length <= CORPS_MAX,
      `${notif.body.length} caractères : la phrase sera coupée sur le téléphone.\n${notif.body}`
    );
  });
}

test('toute notification porte un titre, un corps et une destination', () => {
  for (const [nom, n] of CAS_LES_PLUS_LONGS) {
    assert.ok(n.title.trim(), `${nom} : titre vide`);
    assert.ok(n.body.trim(), `${nom} : corps vide`);
    assert.ok(n.url.startsWith('/'), `${nom} : url non relative (${n.url})`);
  }
});

// ── Le tag : ce qui a causé le bug d'origine ────────────────────────────────

test('deux calls différents produisent deux tags différents', () => {
  // C'EST le bug : sans tag propre, deux rapports en attente ne laissaient
  // qu'un seul rappel visible et le coach en oubliait un.
  assert.notEqual(rapportDeCall({ callId: 'a' }).tag, rapportDeCall({ callId: 'b' }).tag);
});

test("le rappel à 2 h n'efface pas celui à 24 h", () => {
  const a = invitationCall({ callId: 'c1', heure: '14:00', echeance: '2h' });
  const b = invitationCall({ callId: 'c1', heure: '14:00', echeance: '24h' });
  assert.notEqual(a.tag, b.tag);
});

test('rejouer le même lot de publications remplace, un lot suivant ajoute', () => {
  const rejoue = nouvellesPublications({ nombre: 2, type: 'post', premierId: 'p1' });
  const memeLot = nouvellesPublications({ nombre: 2, type: 'post', premierId: 'p1' });
  const lotSuivant = nouvellesPublications({ nombre: 1, type: 'post', premierId: 'p9' });
  assert.equal(rejoue.tag, memeLot.tag, 'un réessai ne doit pas empiler une seconde notification');
  assert.notEqual(rejoue.tag, lotSuivant.tag, 'un nouveau lot doit bien se voir');
});

test('deux pannes différentes restent deux alertes', () => {
  const a = envoiInstagramRefuse({ etape: 'dm1_commentaire', sousCode: 2534014, benin: false, repetitions: 5 });
  const b = envoiInstagramRefuse({ etape: 'dm2_lien', sousCode: 2534014, benin: false, repetitions: 5 });
  assert.notEqual(a.tag, b.tag);
});

test('la même panne répétée remplace son alerte', () => {
  const a = envoiInstagramRefuse({ etape: 'dm1_commentaire', sousCode: 2534014, benin: false, repetitions: 1 });
  const b = envoiInstagramRefuse({ etape: 'dm1_commentaire', sousCode: 2534014, benin: false, repetitions: 7 });
  assert.equal(a.tag, b.tag);
});

test('la messagerie est le SEUL tag partagé', () => {
  // Si un jour une autre notification reprend ce tag, elle effacera les messages
  // non lus — c'est exactement ce qui arrivait quand il servait de défaut.
  const tags = CAS_LES_PLUS_LONGS.map(([, n]) => n.tag);
  for (const t of tags) assert.notEqual(t, TAG_MESSAGERIE);
});

// ── L'accord du français, la raison de ne pas concaténer ────────────────────

test('les titres sont accordés en genre et en nombre', () => {
  assert.equal(nouvellesPublications({ nombre: 1, type: 'reel', premierId: 'x' }).title, 'Nouveau reel publié');
  assert.equal(nouvellesPublications({ nombre: 3, type: 'reel', premierId: 'x' }).title, '3 nouveaux reels publiés');
  assert.equal(nouvellesPublications({ nombre: 1, type: 'post', premierId: 'x' }).title, 'Nouveau post publié');
  assert.equal(nouvellesPublications({ nombre: 4, type: 'post', premierId: 'x' }).title, '4 nouveaux posts publiés');
  // Le piège : « publication » est FÉMININ. Une composition par concaténation
  // écrivait « nouveaux publications ».
  assert.equal(nouvellesPublications({ nombre: 1, type: 'mixte', premierId: 'x' }).title, 'Nouvelle publication');
  assert.equal(nouvellesPublications({ nombre: 2, type: 'mixte', premierId: 'x' }).title, '2 nouvelles publications');
});

test('aucun titre ne contient de forme mal accordée', () => {
  for (const type of ['reel', 'post', 'mixte'] as const) {
    for (const nombre of [1, 2, 12]) {
      const t = nouvellesPublications({ nombre, type, premierId: 'x' }).title;
      assert.ok(!/nouveaux? publications?/.test(t), `accord masculin sur un mot féminin : ${t}`);
      assert.ok(!/nouvelles? (posts?|reels?)/.test(t), `accord féminin sur un mot masculin : ${t}`);
    }
  }
});

// ── Stories ─────────────────────────────────────────────────────────────────

test('la notification stories emmène sur la création de séquence, pré-remplie', () => {
  // Tout l'intérêt est là : le clic remplace sept gestes. Si le paramètre
  // disparaît de l'URL, la notification tombe sur un écran vide et personne ne
  // s'en aperçoit — la notification part quand même.
  const n = nouvellesStories({ storyIds: ['aaa', 'bbb', 'ccc'] });
  assert.ok(n.url.startsWith('/client/liens?'), n.url);
  assert.ok(n.url.includes(`${PARAM_STORIES_A_GROUPER}=aaa,bbb,ccc`), n.url);
});

test('le titre porte le nombre réel de stories', () => {
  assert.equal(nouvellesStories({ storyIds: ['a', 'b'] }).title, '2 stories publiées');
  assert.equal(nouvellesStories({ storyIds: ['a', 'b', 'c', 'd'] }).title, '4 stories publiées');
});

test('deux lots de stories différents ne s’effacent pas', () => {
  const matin = nouvellesStories({ storyIds: ['a', 'b'] });
  const soir = nouvellesStories({ storyIds: ['x', 'y'] });
  assert.notEqual(matin.tag, soir.tag);
});

test('rejouer le même lot de stories remplace au lieu d’empiler', () => {
  assert.equal(
    nouvellesStories({ storyIds: ['a', 'b'] }).tag,
    nouvellesStories({ storyIds: ['a', 'b', 'c'] }).tag,
    'le tag suit la première story : un lot qui s’agrandit met à jour la même notification'
  );
});

// ── Le type d'une publication ───────────────────────────────────────────────

test('un Reel est reconnu par media_product_type comme par media_type', () => {
  assert.equal(typePublication({ media_product_type: 'REELS' }), 'reel');
  assert.equal(typePublication({ media_type: 'VIDEO' }), 'reel');
});

test('une image et un carrousel sont des posts', () => {
  assert.equal(typePublication({ media_product_type: 'FEED', media_type: 'IMAGE' }), 'post');
  assert.equal(typePublication({ media_product_type: 'FEED', media_type: 'CAROUSEL_ALBUM' }), 'post');
});

test('un média sans type connu ne fait pas planter, il compte comme post', () => {
  assert.equal(typePublication({}), 'post');
  assert.equal(typePublication({ media_product_type: null, media_type: null }), 'post');
});

test('un lot homogène garde son type, un lot mélangé devient « mixte »', () => {
  assert.equal(typeDuLot(['reel', 'reel']), 'reel');
  assert.equal(typeDuLot(['post']), 'post');
  assert.equal(typeDuLot(['reel', 'post']), 'mixte');
  assert.equal(typeDuLot([]), 'mixte', 'un lot vide ne doit pas produire un type invalide');
});

// ── Cas limites de contenu ──────────────────────────────────────────────────

test('un rapport sans nom d’invité reste une phrase correcte', () => {
  const n = rapportDeCall({ callId: 'c1', inviteeName: null });
  assert.equal(n.body, "Comment s'est passé ton appel ? Remplis ton rapport.");
  assert.ok(!n.body.includes('avec  '), 'espace en trop là où le nom manquait');
});

test('un nom trop long est abrégé, pas laissé tronquer la phrase', () => {
  const n = rapportDeCall({ callId: 'c1', inviteeName: 'Jean-Baptiste de La Rochefoucauld-Montmorency' });
  assert.ok(n.body.includes('…'), 'le nom devait être abrégé');
  assert.ok(n.body.endsWith('Remplis ton rapport.'), "l'action doit survivre à l'abrègement");
});

test('un coach sans prénom devient « Ton coach »', () => {
  assert.ok(invitationCall({ callId: 'c', coachPrenom: '  ', heure: '9:00', echeance: '2h' }).body.startsWith('Ton coach'));
});

// ── L'alerte Instagram : ce qu'elle dit, et où elle emmène ─────────────────

test("aucune alerte ne montre de jargon : ni code Meta, ni nom d'étape", () => {
  // LE defaut d'origine : « dm1_commentaire · code 2534014 — a surveiller ».
  // Le code est deja dans `cron_runs`, ou l'on diagnostique ; une banniere de
  // 100 caracteres doit dire quoi faire.
  for (const benin of [true, false]) {
    for (const repetitions of [1, 5, 20]) {
      for (const etape of ['dm1_commentaire', 'dm1_accroche_story', 'dm2_lien']) {
        const n = envoiInstagramRefuse({ etape, sousCode: 2534014, benin, repetitions });
        const texte = `${n.title} ${n.body}`;
        assert.ok(!texte.includes('2534014'), texte);
        assert.ok(!/code/i.test(texte), texte);
        assert.ok(!texte.includes('dm1') && !texte.includes('dm2'), texte);
        assert.ok(!texte.includes('null') && !texte.includes('undefined'), texte);
        assert.ok(n.body.length <= CORPS_MAX, `${n.body.length} car. : ${n.body}`);
      }
    }
  }
});

test("l'action et la destination changent entre une fois et la répétition", () => {
  // C'est le coeur de la correction : « a surveiller » ne dit rien. Une fois, un
  // prospect est reste sans reponse et on va le repecher ; repete, ce n'est plus
  // un accident mais la connexion.
  const uneFois = envoiInstagramRefuse({ etape: 'dm2_lien', benin: false, repetitions: 1 });
  const repete = envoiInstagramRefuse({ etape: 'dm2_lien', benin: false, repetitions: 7 });

  assert.match(uneFois.body, /Pipeline Leads/);
  assert.equal(uneFois.url, '/client/pipeline');

  assert.match(repete.body, /^7 fois en 24 h/);
  assert.match(repete.body, /Réglages/);
  assert.equal(repete.url, '/client/settings', 'la répétition emmène là où on répare');
});

test('un incident bénin isolé dit franchement qu’il n’y a rien à faire', () => {
  // Meta refuse une seconde reponse privee sur le meme commentaire : le premier
  // envoi est bien parti. Envoyer chercher une panne inexistante est pire que
  // se taire.
  const n = envoiInstagramRefuse({ etape: 'dm1_commentaire', benin: true, repetitions: 1 });
  assert.match(n.body, /Rien à faire/);
  assert.ok(!/Retrouve-le/.test(n.body), n.body);
});

test('le titre nomme ce que le prospect n’a pas reçu', () => {
  assert.equal(envoiInstagramRefuse({ etape: 'dm2_lien', benin: false, repetitions: 1 }).title,
    "Un lead magnet n'est pas parti");
  assert.equal(envoiInstagramRefuse({ etape: 'dm1_commentaire', benin: false, repetitions: 1 }).title,
    "Un message automatique n'est pas parti");
});

test('le titre ne contredit jamais le corps', () => {
  // Une premiere version titrait « n'est pas parti » au-dessus de « le prospect
  // a bien recu son message » : une fausse alerte fabriquee par le texte.
  for (const etape of ['dm1_commentaire', 'dm1_accroche_story', 'dm2_lien']) {
    const n = envoiInstagramRefuse({ etape, benin: true, repetitions: 1 });
    const annonceUnEchec = /n'est pas parti|n’est pas parti/.test(n.title);
    const ditQueCaMarche = /a bien reçu/.test(n.body);
    assert.ok(!(annonceUnEchec && ditQueCaMarche), `${n.title} / ${n.body}`);
  }
});
