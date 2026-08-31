import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculerCash, statutDeal, resteAEncaisser, aRembourser, encaisseRetenu } from './dealCash.ts';
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
  assert.deepEqual(c, { encaisse: 0, rembourse: 0, conteste: 0, net: 0, aEchoue: false });
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

// ── Le statut de la vente ───────────────────────────────────────────────────

test('rien encaissé sur une vente neuve — elle reste en attente', () => {
  assert.equal(statutDeal(calculerCash([]), 1500, 'open'), 'open');
});

test('tout encaissé — la vente est soldée', () => {
  assert.equal(statutDeal(calculerCash([p(1500, 'succeeded')]), 1500, 'open'), 'paid');
});

test('un centime manquant ne fait pas passer pour impayé', () => {
  // 1000 € en 3 fois : 333,33 × 3 = 999,99. Sans tolérance, jamais soldé.
  const c = calculerCash([p(333.33, 'succeeded'), p(333.33, 'succeeded'), p(333.33, 'succeeded')]);
  assert.equal(statutDeal(c, 1000, 'open'), 'paid');
});

test('un paiement en échec distingue past_due de open', () => {
  const c = calculerCash([p(500, 'succeeded'), p(500, 'failed')]);
  assert.equal(statutDeal(c, 1500, 'open'), 'past_due');
});

test('tout remboursé après avoir encaissé — la vente passe en annulée', () => {
  // Sans cette règle, la vente retomberait en « open » et relancerait un
  // client qu'on vient de rembourser.
  const c = calculerCash([p(1500, 'succeeded'), p(1500, 'refunded')]);
  assert.equal(statutDeal(c, 1500, 'paid'), 'canceled');
});

test('une vente jamais soldée, dont l’acompte est remboursé, passe aussi en annulée', () => {
  const c = calculerCash([p(500, 'succeeded'), p(500, 'refunded')]);
  assert.equal(statutDeal(c, 1500, 'open'), 'canceled');
});

test('une vente soldée reste soldée après un remboursement partiel', () => {
  // Geste commercial : rendre 300 € sur 1 500 €. La vente ne repart pas en
  // attente — ce serait relancer sur l’argent qu’on vient de rendre.
  const c = calculerCash([p(1500, 'succeeded'), p(300, 'refunded')]);
  assert.equal(statutDeal(c, 1500, 'paid'), 'paid');
});

test('une vente annulée ne se recalcule JAMAIS, même si de l’argent arrive', () => {
  // Lien retrouvé dans une conversation, dernier prélèvement en vol : le
  // paiement est enregistré, mais l’annulation est une décision humaine.
  const c = calculerCash([p(1500, 'succeeded')]);
  assert.equal(statutDeal(c, 1500, 'canceled'), null);
});

test('une vente vide et jamais payée ne bascule pas en annulée', () => {
  // Le garde `encaisse > 0` : sans lui, toute vente fraîche serait annulée.
  assert.equal(statutDeal(calculerCash([]), 1500, 'open'), 'open');
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
  assert.equal(statutDeal(c, 1500, 'paid'), 'disputed');
});

test('litige gagné : la ligne disparaît et la vente redevient soldée', () => {
  // `charge.dispute.funds_reinstated` retire la ligne contestée.
  const c = calculerCash([p(1500, 'succeeded')]);
  assert.equal(statutDeal(c, 1500, 'disputed'), 'paid');
});

test('un litige prime sur un remboursement partiel', () => {
  const c = calculerCash([p(1500, 'succeeded'), p(200, 'refunded'), p(1300, 'disputed')]);
  assert.equal(c.net, 0);
  assert.equal(statutDeal(c, 1500, 'paid'), 'disputed');
});

// ── Les ventes terminées avant leur terme ───────────────────────────────────

test('une vente terminée ne se recalcule JAMAIS, même si de l’argent arrive', () => {
  // Arrêtée ou clôturée : c'est une décision humaine. Un paiement retardataire
  // est signalé par `unexpected_payment_at`, sans défaire la façon dont elle
  // s'était terminée.
  const c = calculerCash([p(1500, 'succeeded')]);
  assert.equal(statutDeal(c, 1500, 'ended'), null);
});

test('une vente terminée puis intégralement remboursée reste terminée', () => {
  const c = calculerCash([p(600, 'succeeded'), p(600, 'refunded')]);
  assert.equal(statutDeal(c, 900, 'ended'), null);
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

    assert.equal(
      copieDeno.statutDeal(laBas, j.total, j.statut),
      statutDeal(ici, j.total, j.statut),
      `statutDeal diverge sur ${JSON.stringify(j)}`,
    );
    assert.equal(copieDeno.resteAEncaisser(laBas, j.total), resteAEncaisser(ici, j.total));
    assert.equal(copieDeno.aRembourser(laBas, j.total), aRembourser(ici, j.total));
    assert.equal(copieDeno.encaisseRetenu(laBas, j.total), encaisseRetenu(ici, j.total));
  }
});
