import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculerCash, statutDeal, prelevementsAVenir, resteAEncaisser, aRembourser, encaisseRetenu, verseParLeClient } from './dealCash.ts';
import * as copieDeno from '../supabase/functions/_shared/dealCash.ts';

// Lancé par `npm test` (node --test, sans aucune dépendance à installer).
// Fonctions pures : ni React, ni réseau, ni base.
//
// Un calcul d'argent faux ne se voit pas à l'œil — c'est exactement comme ça
// que le défaut d'origine a survécu des mois : les remboursements n'étaient
// déduits nulle part, et personne ne pouvait s'en apercevoir en regardant un
// écran. Ces tests sont le seul endroit où la règle est vérifiable.

const p = (amount: number, status: string) => ({ amount, status });

// ── Le calcul brut ──────────────────────────────────────────────────────────

test('aucun paiement — tout est à zéro', () => {
  const c = calculerCash([]);
  assert.deepEqual(c, { encaisse: 0, rembourse: 0, conteste: 0, perduEnLitige: 0, net: 0, aEchoue: false, nbEncaissements: 0 });
  assert.deepEqual(calculerCash(null), c);
  assert.deepEqual(calculerCash(undefined), c);
});

test('le net déduit les remboursements', () => {
  const c = calculerCash([p(1500, 'succeeded'), p(300, 'refunded')]);
  assert.equal(c.encaisse, 1500);
  assert.equal(c.rembourse, 300);
  assert.equal(c.net, 1200);
});

test('plusieurs remboursements se cumulent', () => {
  const c = calculerCash([p(1500, 'succeeded'), p(200, 'refunded'), p(100, 'refunded')]);
  assert.equal(c.net, 1200);
});

test('les montants arrivent parfois en chaîne — numeric côté Postgres', () => {
  const c = calculerCash([
    { amount: '1500.00', status: 'succeeded' },
    { amount: '300.50', status: 'refunded' },
  ]);
  assert.equal(c.net, 1199.5);
});

test('un montant illisible vaut zéro plutôt que NaN', () => {
  const c = calculerCash([p(1000, 'succeeded'), { amount: 'abc', status: 'succeeded' }]);
  assert.equal(c.net, 1000);
});

test('pending et failed ne comptent pas dans le net', () => {
  const c = calculerCash([p(1000, 'succeeded'), p(500, 'pending'), p(500, 'failed')]);
  assert.equal(c.net, 1000);
  assert.equal(c.aEchoue, true);
});

// Le contexte que `statutDeal` exige en plus du cash. Nommes une fois : ecrire
// `{ annulationDemandee: false, prelevementsAVenir: false }` a chaque appel
// noierait ce que chaque test veut dire.
const SANS = { annulationDemandee: false, prelevementsAVenir: false };
const DEMANDE = { annulationDemandee: true, prelevementsAVenir: false };
/** Un plan en prelevement automatique dont toutes les echeances ne sont pas passees. */
const EN_VOL = { annulationDemandee: false, prelevementsAVenir: true };

// ── Le statut de la vente ───────────────────────────────────────────────────

test('rien encaissé sur une vente neuve — elle reste en attente', () => {
  assert.equal(statutDeal(calculerCash([]), 1500, 'open', SANS), 'open');
});

test('tout encaissé — la vente est soldée', () => {
  assert.equal(statutDeal(calculerCash([p(1500, 'succeeded')]), 1500, 'open', SANS), 'paid');
});

test('un centime manquant ne fait pas passer pour impayé', () => {
  // 1000 € en 3 fois : 333,33 × 3 = 999,99. Sans tolérance, jamais soldé.
  const c = calculerCash([p(333.33, 'succeeded'), p(333.33, 'succeeded'), p(333.33, 'succeeded')]);
  assert.equal(statutDeal(c, 1000, 'open', SANS), 'paid');
});

test('un paiement en échec distingue past_due de open', () => {
  const c = calculerCash([p(500, 'succeeded'), p(500, 'failed')]);
  assert.equal(statutDeal(c, 1500, 'open', SANS), 'past_due');
});

// ── Tout reparti : annulée ou clôturée, selon ce qui a été DEMANDÉ ───────────
//
// Les deux branches partagent la protection qui a motivé cette règle le
// 2026-08-28 — ne pas retomber en « open » et relancer un client qu'on vient de
// rembourser. `ended` la porte autant que `canceled` (dealCash.ts:251, liens
// désactivés, aucun rappel, hors Relances). Ce qui les sépare est ailleurs :
// `canceled` efface EN PLUS la vente du cash contracté et déclasse l'appel.

test('tout remboursé APRÈS avoir demandé l’annulation — la vente est annulée', () => {
  const c = calculerCash([p(1500, 'succeeded'), p(1500, 'refunded')]);
  assert.equal(statutDeal(c, 1500, 'paid', DEMANDE), 'canceled');
});

test('tout remboursé SANS annulation demandée — la vente est clôturée, pas annulée', () => {
  // « un remboursement intégral c'est pas une annulation de la vente » (Chris,
  // 2026-09-09). La vente a bien eu lieu, l'argent est simplement reparti :
  // elle reste dans le cash contracté et son appel reste un closing.
  const c = calculerCash([p(1500, 'succeeded'), p(1500, 'refunded')]);
  assert.equal(statutDeal(c, 1500, 'paid', SANS), 'ended');
});

test('une vente jamais soldée, dont l’acompte est remboursé, suit la même règle', () => {
  const c = calculerCash([p(500, 'succeeded'), p(500, 'refunded')]);
  assert.equal(statutDeal(c, 1500, 'open', DEMANDE), 'canceled');
  assert.equal(statutDeal(c, 1500, 'open', SANS), 'ended');
});

test('ni annulée ni clôturée ne retombent JAMAIS en open — la protection d’origine', () => {
  // Le motif du commit 91f74504 : « et non "en attente", qui aurait relancé un
  // client qu'on vient de rembourser ». Il doit tenir dans les DEUX branches —
  // c'est ce qui autorisait à en scinder une.
  // ⚠️ `EN_VOL` est volontairement ABSENT de cette liste : c'est le seul cas où
  // la vente retombe légitimement en `open`, parce que Stripe va la prélever et
  // que Momentum ne relancera personne. La protection ne vaut que là où il y a
  // quelqu'un à relancer.
  const c = calculerCash([p(1500, 'succeeded'), p(1500, 'refunded')]);
  for (const ctx of [DEMANDE, SANS]) {
    const s = statutDeal(c, 1500, 'paid', ctx);
    assert.notEqual(s, 'open');
    assert.notEqual(s, 'past_due');
  }
});

test('une vente soldée reste soldée après un remboursement partiel', () => {
  // Geste commercial : rendre 300 € sur 1 500 €. La vente ne repart pas en
  // attente — ce serait relancer sur l’argent qu’on vient de rendre.
  const c = calculerCash([p(1500, 'succeeded'), p(300, 'refunded')]);
  assert.equal(statutDeal(c, 1500, 'paid', SANS), 'paid');
});

test('une vente annulée ne se recalcule JAMAIS, même si de l’argent arrive', () => {
  // Lien retrouvé dans une conversation, dernier prélèvement en vol : le
  // paiement est enregistré, mais l’annulation est une décision humaine.
  const c = calculerCash([p(1500, 'succeeded')]);
  assert.equal(statutDeal(c, 1500, 'canceled', SANS), null);
});

test('une vente vide et jamais payée ne bascule ni en annulée ni en clôturée', () => {
  // Le garde `encaisse > 0` : sans lui, toute vente fraîche serait annulée —
  // y compris celle dont on vient de DEMANDER l'annulation sans rien encaisser,
  // que cancel/route.ts traite lui-même sur-le-champ.
  assert.equal(statutDeal(calculerCash([]), 1500, 'open', SANS), 'open');
  assert.equal(statutDeal(calculerCash([]), 1500, 'open', DEMANDE), 'open');
});

// ── Le litige ───────────────────────────────────────────────────────────────

test('un litige retire l’argent de la caisse comme un remboursement', () => {
  const c = calculerCash([p(1500, 'succeeded'), p(1500, 'disputed')]);
  assert.equal(c.encaisse, 1500);
  assert.equal(c.conteste, 1500);
  assert.equal(c.net, 0);
});

test('un litige passe la vente en contestée, jamais en annulée', () => {
  // La distinction est vitale : une vente annulée ne se recalcule plus jamais.
  // Y faire tomber un litige la figerait là, et gagner le litige ne la
  // ramènerait pas.
  const c = calculerCash([p(1500, 'succeeded'), p(1500, 'disputed')]);
  assert.equal(statutDeal(c, 1500, 'paid', SANS), 'disputed');
  // Et même si une annulation a été demandée : le litige réclame une réponse
  // sous quelques jours, il prime sur une fin de vie qui ne réclame plus rien.
  assert.equal(statutDeal(c, 1500, 'paid', DEMANDE), 'disputed');
});

test('litige gagné : la ligne disparaît et la vente redevient soldée', () => {
  // `charge.dispute.funds_reinstated` retire la ligne contestée.
  const c = calculerCash([p(1500, 'succeeded')]);
  assert.equal(statutDeal(c, 1500, 'disputed', SANS), 'paid');
});

test('un litige prime sur un remboursement partiel', () => {
  const c = calculerCash([p(1500, 'succeeded'), p(200, 'refunded'), p(1300, 'disputed')]);
  assert.equal(c.net, 0);
  assert.equal(statutDeal(c, 1500, 'paid', SANS), 'disputed');
});

// ── Les ventes terminées avant leur terme ───────────────────────────────────

test('une vente terminée ne se recalcule JAMAIS, même si de l’argent arrive', () => {
  // Arrêtée ou clôturée : c'est une décision humaine. Un paiement retardataire
  // est signalé par `unexpected_payment_at`, sans défaire la façon dont elle
  // s'était terminée.
  const c = calculerCash([p(1500, 'succeeded')]);
  assert.equal(statutDeal(c, 1500, 'ended', SANS), null);
});

test('une vente terminée puis intégralement remboursée reste terminée', () => {
  const c = calculerCash([p(600, 'succeeded'), p(600, 'refunded')]);
  assert.equal(statutDeal(c, 900, 'ended', SANS), null);
});

// ── Ce qui reste dû, ce qui est en trop ─────────────────────────────────────

test('reste à encaisser sur une vente entamée', () => {
  const c = calculerCash([p(1000, 'succeeded')]);
  assert.equal(resteAEncaisser(c, 3000), 2000);
  assert.equal(aRembourser(c, 3000), 0);
});

test('trop-perçu quand le montant est corrigé à la baisse', () => {
  // 1 000 € encaissés sur une vente ramenée à 800 € : 200 € à rendre.
  const c = calculerCash([p(1000, 'succeeded')]);
  assert.equal(aRembourser(c, 800), 200);
  assert.equal(resteAEncaisser(c, 800), 0);
});

test('trop-perçu quand le client paie deux fois', () => {
  const c = calculerCash([p(1500, 'succeeded'), p(1500, 'succeeded')]);
  assert.equal(aRembourser(c, 1500), 1500);
});

test('une vente soldée ne réclame rien et ne doit rien', () => {
  const c = calculerCash([p(1500, 'succeeded')]);
  assert.equal(resteAEncaisser(c, 1500), 0);
  assert.equal(aRembourser(c, 1500), 0);
});

test('les écarts de centime ne créent ni dette ni trop-perçu fantôme', () => {
  const c = calculerCash([p(999.99, 'succeeded')]);
  assert.equal(resteAEncaisser(c, 1000), 0);
  assert.equal(aRembourser(c, 999.98), 0);
});

test('les sommes flottantes sont arrondies au centime', () => {
  // 0.1 + 0.2 = 0.30000000000000004 : sans arrondi, le montant affiché déraille.
  const c = calculerCash([p(0.1, 'succeeded'), p(0.2, 'succeeded')]);
  assert.equal(aRembourser(c, 0), 0.3);
});

// ── Le recouvrement retenu : le net plafonné au montant de la vente ─────────
//
// Aucun trop-perçu n'existe en base au moment où ces tests sont écrits : ils
// sont donc la SEULE vérification de cette règle, et le resteront jusqu'au jour
// où un client paiera deux fois. Aucune capture d'écran ne peut les remplacer.

test('sans trop-perçu, le retenu vaut le net', () => {
  const c = calculerCash([p(600, 'succeeded')]);
  assert.equal(encaisseRetenu(c, 1000), 600);
  assert.equal(encaisseRetenu(c, 600), 600);
});

test('le trop-perçu est écrêté au montant de la vente', () => {
  const c = calculerCash([p(1200, 'succeeded')]);
  assert.equal(c.net, 1200);
  assert.equal(encaisseRetenu(c, 1000), 1000);
  // Le surplus n'est pas perdu : c'est aRembourser qui le porte.
  assert.equal(aRembourser(c, 1000), 200);
});

test('un remboursement ramène sous le plafond', () => {
  const c = calculerCash([p(1200, 'succeeded'), p(300, 'refunded')]);
  assert.equal(encaisseRetenu(c, 1000), 900);
  assert.equal(aRembourser(c, 1000), 0);
});

test('un net négatif reste négatif — on ne planche pas à zéro', () => {
  // Plus remboursé qu'encaissé : le trou est réel et doit se voir.
  const c = calculerCash([p(500, 'succeeded'), p(700, 'refunded')]);
  assert.equal(c.net, -200);
  assert.equal(encaisseRetenu(c, 1000), -200);
});

test("le plafond s'applique VENTE PAR VENTE, jamais sur un total", () => {
  // Le défaut que cette fonction existe pour empêcher : sans écrêtage par vente,
  // le surplus de la première efface la dette de la seconde.
  const troppercu = calculerCash([p(1200, 'succeeded')]);
  const rienpaye = calculerCash([]);

  const brut = troppercu.net + rienpaye.net;                  // 1200
  const retenu = encaisseRetenu(troppercu, 1000) + encaisseRetenu(rienpaye, 1000); // 1000

  assert.equal(2000 - brut, 800);    // faux : il reste bien 1000 € à encaisser
  assert.equal(2000 - retenu, 1000); // juste
});

test('une vente à montant nul ne fait pas exploser le plafond', () => {
  const c = calculerCash([p(300, 'succeeded')]);
  assert.equal(encaisseRetenu(c, 0), 0);
  assert.equal(encaisseRetenu(c, null), 0);
});

test('les arrondis de numeric ne traversent pas le plafond', () => {
  const c = calculerCash([p(333.33, 'succeeded'), p(333.33, 'succeeded'), p(333.34, 'succeeded')]);
  assert.equal(encaisseRetenu(c, 1000), 1000);
});

// ── La garde qui interdit aux deux copies de diverger ───────────────────────

test('les deux copies du module donnent exactement le même résultat', () => {
  // lib/dealCash.ts (Node) et supabase/functions/_shared/dealCash.ts (Deno)
  // portent la même règle. Les deux mondes ne partageant aucun fichier, seule
  // cette comparaison empêche qu'on en modifie une en oubliant l'autre.
  const jeux: Array<{ paiements: ReturnType<typeof p>[]; total: number; statut: string }> = [
    { paiements: [], total: 1500, statut: 'open' },
    { paiements: [p(1500, 'succeeded')], total: 1500, statut: 'open' },
    { paiements: [p(1500, 'succeeded'), p(300, 'refunded')], total: 1500, statut: 'paid' },
    { paiements: [p(1500, 'succeeded'), p(1500, 'refunded')], total: 1500, statut: 'paid' },
    { paiements: [p(500, 'succeeded'), p(500, 'refunded')], total: 1500, statut: 'open' },
    { paiements: [p(1000, 'succeeded')], total: 800, statut: 'open' },
    { paiements: [p(500, 'succeeded'), p(500, 'failed')], total: 1500, statut: 'open' },
    { paiements: [p(1500, 'succeeded')], total: 1500, statut: 'canceled' },
    { paiements: [p(333.33, 'succeeded'), p(333.33, 'succeeded'), p(333.33, 'succeeded')], total: 1000, statut: 'open' },
    { paiements: [p(1500, 'succeeded'), p(1500, 'disputed')], total: 1500, statut: 'paid' },
    { paiements: [p(1500, 'succeeded'), p(200, 'refunded'), p(1300, 'disputed')], total: 1500, statut: 'paid' },
    { paiements: [p(600, 'succeeded')], total: 900, statut: 'ended' },
  ];

  for (const j of jeux) {
    const ici = calculerCash(j.paiements);
    const laBas = copieDeno.calculerCash(j.paiements);
    assert.deepEqual(laBas, ici, `calculerCash diverge sur ${JSON.stringify(j)}`);

    // ⚠️ Les DEUX valeurs de `annulationDemandee`. N'en jouer qu'une laisserait
    // les copies diverger précisément sur la branche que ce paramètre a créée —
    // c'est-à-dire sur la seule chose que ce chantier a changée.
    for (const annulationDemandee of [true, false]) {
      for (const prelevementsAVenir of [true, false]) {
        const ctx = { annulationDemandee, prelevementsAVenir };
        assert.equal(
          copieDeno.statutDeal(laBas, j.total, j.statut, ctx),
          statutDeal(ici, j.total, j.statut, ctx),
          `statutDeal diverge sur ${JSON.stringify(j)} ${JSON.stringify(ctx)}`,
        );
      }
    }
    assert.equal(copieDeno.resteAEncaisser(laBas, j.total), resteAEncaisser(ici, j.total));
    assert.equal(copieDeno.aRembourser(laBas, j.total), aRembourser(ici, j.total));
    assert.equal(copieDeno.encaisseRetenu(laBas, j.total), encaisseRetenu(ici, j.total));
  }
});

// ── Le litige PERDU : l'argent est parti, mais l'instruction est close ───────
//
// Éprouvé en réel le 2026-09-06 sur TestYT (200 € perdus sur 1 100 €). Sans
// `dispute_lost`, la ligne restait `disputed` et la vente affichait « Contestée »
// pour toujours : le calcul ne pouvait pas distinguer une instruction EN COURS
// d'un verdict rendu.

test('un litige perdu sort de la caisse, comme un remboursement', () => {
  const c = calculerCash([p(1000, 'succeeded'), p(200, 'dispute_lost')]);
  assert.equal(c.encaisse, 1000);
  assert.equal(c.perduEnLitige, 200);
  assert.equal(c.net, 800);
});

test('un litige perdu ne compte PAS comme un remboursement', () => {
  // La fiche affiche « X € remboursés » avec la raison donnée par l'élève. Y
  // verser un litige perdu présenterait comme un geste volontaire de l'argent
  // que la banque a repris de force.
  const c = calculerCash([p(1000, 'succeeded'), p(200, 'dispute_lost')]);
  assert.equal(c.rembourse, 0);
  assert.equal(c.conteste, 0);
});

test('un litige perdu donne son propre état, pas « Contestée »', () => {
  const c = calculerCash([p(1000, 'succeeded'), p(200, 'dispute_lost')]);
  assert.equal(statutDeal(c, 1100, 'disputed', SANS), 'dispute_lost');
});

test('un litige EN COURS prime sur un litige déjà perdu', () => {
  // Deux litiges sur la même vente : le second réclame une réponse sous
  // quelques jours, le premier ne réclame plus rien.
  const c = calculerCash([p(1000, 'succeeded'), p(200, 'dispute_lost'), p(300, 'disputed')]);
  assert.equal(statutDeal(c, 1500, 'open', SANS), 'disputed');
});

test('tout repris par la banque n’est PAS une vente annulée', () => {
  // Sans la règle, `net <= 0` faisait tomber la vente en « annulée » : or
  // l'élève n'a rien annulé et n'a rien rendu.
  const c = calculerCash([p(1000, 'succeeded'), p(1000, 'dispute_lost')]);
  assert.equal(c.net, 0);
  assert.equal(statutDeal(c, 1000, 'open', SANS), 'dispute_lost');
  // Et une annulation demandée ne le transforme pas non plus : la banque a
  // repris l'argent, l'élève ne l'a pas rendu. Deux histoires différentes.
  assert.equal(statutDeal(c, 1000, 'open', DEMANDE), 'dispute_lost');
});

test('les deux copies s’accordent sur le litige perdu', () => {
  const lignes = [p(1000, 'succeeded'), p(200, 'dispute_lost'), p(100, 'refunded')];
  assert.deepEqual(copieDeno.calculerCash(lignes), calculerCash(lignes));
  assert.equal(
    copieDeno.statutDeal(copieDeno.calculerCash(lignes), 1100, 'open', SANS),
    statutDeal(calculerCash(lignes), 1100, 'open', SANS),
  );
});

// ── VERSÉ PAR LE CLIENT ≠ RESTÉ DANS LA CAISSE ──────────────────────────────
//
// La confusion la plus coûteuse du chantier : quatre écrans réclamaient une
// seconde fois un argent déjà payé, parce qu'un litige fait baisser le net sans
// que le client doive quoi que ce soit.

test('un litige ne crée aucune dette du client', () => {
  const c = calculerCash([p(1000, 'succeeded'), p(1000, 'disputed')]);
  assert.equal(c.net, 0, 'la caisse est vide');
  assert.equal(verseParLeClient(c), 1000, 'le client a pourtant tout versé');
  assert.equal(resteAEncaisser(c, 1000), 0, 'il ne doit RIEN — le lien ne doit rien réclamer');
});

test('un litige PERDU ne crée pas de dette non plus', () => {
  // La banque garde l'argent, mais le client l'a bien sorti de sa poche.
  const c = calculerCash([p(1000, 'succeeded'), p(200, 'dispute_lost')]);
  assert.equal(c.net, 800);
  assert.equal(verseParLeClient(c), 1000);
  assert.equal(resteAEncaisser(c, 1000), 0);
});

test('un REMBOURSEMENT, lui, recrée bien une dette', () => {
  // L'argent est retourné chez le client : il peut redevoir. C'est toute la
  // différence avec un litige, et c'est pourquoi `encaisse − rembourse`.
  const c = calculerCash([p(1000, 'succeeded'), p(300, 'refunded')]);
  assert.equal(verseParLeClient(c), 700);
  assert.equal(resteAEncaisser(c, 1000), 300);
});

test('une dette RÉELLE survit à un litige partiel', () => {
  // 1 500 € contractés, 500 versés puis contestés : 1 000 n'ont jamais été payés.
  const c = calculerCash([p(500, 'succeeded'), p(500, 'disputed')]);
  assert.equal(resteAEncaisser(c, 1500), 1000);
});

test('« à rembourser » reste sur le NET — on ne rend que ce qu’on tient', () => {
  // 1 200 versés sur une vente à 1 000, dont 200 retenus par une banque.
  // Le trop-perçu théorique est 200, mais il n'est pas sur le compte.
  const c = calculerCash([p(1200, 'succeeded'), p(200, 'disputed')]);
  assert.equal(verseParLeClient(c), 1200);
  assert.equal(aRembourser(c, 1000), 0, 'rien de disponible à rendre');
});

test('les deux copies s’accordent sur le versé', () => {
  const lignes = [p(1000, 'succeeded'), p(200, 'disputed'), p(100, 'refunded'), p(50, 'dispute_lost')];
  assert.equal(copieDeno.verseParLeClient(copieDeno.calculerCash(lignes)), verseParLeClient(calculerCash(lignes)));
  assert.equal(copieDeno.resteAEncaisser(copieDeno.calculerCash(lignes), 2000), resteAEncaisser(calculerCash(lignes), 2000));
});

// ── Un abonnement encore en vol n'est pas une vente terminée ─────────────────

test('un plan en prélèvement dont les échéances restent à venir ne se termine pas', () => {
  // Incogniton, 2026-09-09 : plan 3× à 1,50 €, une échéance encaissée puis
  // remboursée. La terminer la figerait, et le prélèvement du 8 octobre serait
  // signalé « paiement reçu sur une vente terminée » — alors que c'est une
  // échéance normale. En prélèvement auto, Momentum ne relance jamais : le motif
  // de la règle (« ne pas relancer un client remboursé ») est sans objet ici.
  const c = calculerCash([p(0.5, 'succeeded'), p(0.5, 'refunded')]);
  assert.equal(statutDeal(c, 1.5, 'open', EN_VOL), 'open');
  // Sans prélèvement à venir, la même vente se termine bien.
  assert.equal(statutDeal(c, 1.5, 'open', SANS), 'ended');
});

test('une annulation DEMANDÉE prime sur les prélèvements à venir', () => {
  // L'élève a cliqué « Annuler la vente » puis remboursé : son intention est
  // explicite, et l'écran lui a promis que l'appel sortirait du closing.
  const c = calculerCash([p(0.5, 'succeeded'), p(0.5, 'refunded')]);
  assert.equal(statutDeal(c, 1.5, 'open', { annulationDemandee: true, prelevementsAVenir: true }), 'canceled');
});

test('prelevementsAVenir : ce qui compte est le NOMBRE d’encaissements, pas le net', () => {
  // Une échéance remboursée a bien été prélevée — Stripe ne la reprélèvera pas.
  const c = calculerCash([p(0.5, 'succeeded'), p(0.5, 'refunded')]);
  assert.equal(c.net, 0);
  assert.equal(c.nbEncaissements, 1);
  assert.equal(prelevementsAVenir(c, 'installments_auto', 'sub_x', 3), true);
  // Le plan est allé à son terme : plus rien ne viendra.
  const fini = calculerCash([p(0.5, 'succeeded'), p(0.5, 'succeeded'), p(0.5, 'succeeded')]);
  assert.equal(prelevementsAVenir(fini, 'installments_auto', 'sub_x', 3), false);
});

test('prelevementsAVenir ne concerne QUE le prélèvement automatique', () => {
  const c = calculerCash([p(0.5, 'succeeded')]);
  // Un plan par liens : c'est l'élève qui envoie, donc Momentum relance — la
  // protection d'origine doit s'appliquer pleinement.
  assert.equal(prelevementsAVenir(c, 'installments_manual', 'sub_x', 3), false);
  assert.equal(prelevementsAVenir(c, 'one_shot', null, null), false);
  // Un abonnement absent : rien ne prélèvera, quoi qu'annonce le plan.
  assert.equal(prelevementsAVenir(c, 'installments_auto', null, 3), false);
});

test('les deux copies s’accordent sur prelevementsAVenir', () => {
  const lignes = [p(0.5, 'succeeded'), p(0.5, 'refunded')];
  for (const n of [null, 0, 1, 2, 3]) {
    assert.equal(
      copieDeno.prelevementsAVenir(copieDeno.calculerCash(lignes), 'installments_auto', 'sub_x', n),
      prelevementsAVenir(calculerCash(lignes), 'installments_auto', 'sub_x', n),
      `prelevementsAVenir diverge sur nombreEcheances=${n}`,
    );
  }
});
