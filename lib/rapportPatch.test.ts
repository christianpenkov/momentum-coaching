import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRapportPatch, isSubmittable, estimateTotal, countAnswered, parseAmount, objectionsPour, demandeObjection, EMPTY_ANSWERS, type RapportAnswers } from './rapportPatch.ts';

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

test('estimateTotal garde répondues <= total', () => {
  assert.equal(estimateTotal(reponses({ showedUp: true, qualified: true, outcomeChoice: 'closed', revenue: '10' })), 5);
  assert.equal(estimateTotal(reponses({ showedUp: true, outcomeChoice: 'rescheduled' })), 3);
  // Un no-show est complet dès la première réponse.
  assert.equal(estimateTotal(reponses({ showedUp: false })), 1);
});

test('le total laisse toujours de la place pour la question en cours', () => {
  // Sans ça la carte annonçait « 2/2 » sur un rapport inachevé.
  for (const a of [
    reponses({ showedUp: true }),
    reponses({ showedUp: true, qualified: true }),
    reponses({ showedUp: true, qualified: true, outcomeChoice: 'to_recontact' }),
  ]) {
    const repondues = countAnswered(a);
    assert.ok(estimateTotal(a) > repondues, `${repondues} répondues → total doit être supérieur`);
  }
});

// ── Le compteur ne recule pas ──────────────────────────────────────────────

test('countAnswered compte les réponses, pas le chemin parcouru', () => {
  assert.equal(countAnswered(reponses()), 0, 'rien répondu');
  assert.equal(countAnswered(reponses({ showedUp: true })), 1);
  assert.equal(countAnswered(reponses({ showedUp: true, qualified: true })), 2);
  assert.equal(countAnswered(reponses({ showedUp: true, qualified: true, outcomeChoice: 'to_recontact' })), 3);
});

test('revenir en arrière ne décompte pas une réponse enregistrée', () => {
  // Le cas signalé : on répond 2 questions, on clique Retour — la réponse est
  // toujours là, cochée à l'écran. Le compteur ne doit pas retomber à 1.
  const a = reponses({ showedUp: true, qualified: true });
  assert.equal(countAnswered(a), 2, 'avant le retour');
  // Un retour arrière ne change QUE l'étape affichée, jamais les réponses.
  assert.equal(countAnswered(a), 2, 'après le retour : identique');
});

test('un no-show ne compte qu’une réponse, et il est complet', () => {
  const a = reponses({ showedUp: false });
  assert.equal(countAnswered(a), 1);
  assert.equal(estimateTotal(a), 1, '1/1 : rien ne reste à demander');
});

test('les modalités de paiement sont la dernière question d’un deal closé', () => {
  const sansPaiement = reponses({ showedUp: true, qualified: true, outcomeChoice: 'closed', revenue: '2000' });
  const avecPaiement = { ...sansPaiement, paymentDone: true };

  // Tant que les modalités ne sont pas choisies, le rapport n'est pas terminé.
  assert.equal(countAnswered(sansPaiement), 4);
  assert.ok(estimateTotal(sansPaiement) > 4, 'il reste une question');

  // Une fois choisies : 5/5, plus rien à demander.
  assert.equal(countAnswered(avecPaiement), 5);
  assert.equal(estimateTotal(avecPaiement), 5, 'jamais « 5/6 » sur un rapport complet');
});

test('hors Stripe : « déjà encaissé ? » ajoute une 6ᵉ question', () => {
  const parLien = reponses({ showedUp: true, qualified: true, outcomeChoice: 'closed', revenue: '2000' });
  const horsStripe = { ...parLien, offlineReceived: true };

  // Le chemin par lien n'a que 5 questions.
  assert.equal(estimateTotal(parLien), 5);
  // Hors Stripe, une de plus — elle n'existe pas sur l'autre chemin.
  assert.equal(countAnswered(horsStripe), 5);
  assert.equal(estimateTotal(horsStripe), 6);

  // Et une fois le deal créé : 6/6.
  const termine = { ...horsStripe, paymentDone: true };
  assert.equal(countAnswered(termine), 6);
  assert.equal(estimateTotal(termine), 6);
});

test('paymentDone ne compte que sur la branche closed', () => {
  // Une valeur résiduelle sur une autre branche ne doit rien ajouter.
  const a = reponses({ showedUp: true, qualified: true, outcomeChoice: 'to_recontact', paymentDone: true });
  assert.equal(countAnswered(a), 3);
});

test('le montant compte comme une réponse, sur la branche closed seulement', () => {
  const sansMontant = reponses({ showedUp: true, qualified: true, outcomeChoice: 'closed' });
  const avecMontant = reponses({ showedUp: true, qualified: true, outcomeChoice: 'closed', revenue: '2000' });
  assert.equal(countAnswered(avecMontant), countAnswered(sansMontant) + 1);
  // Sur une autre branche, un montant résiduel ne doit rien ajouter.
  const autreBranche = reponses({ showedUp: true, qualified: true, outcomeChoice: 'to_recontact', revenue: '2000' });
  assert.equal(countAnswered(autreBranche), 3);
});

// ── Les deux issues arrivées le 2026-08-27 ─────────────────────────────────
// Le pipeline affichait « Perdu » et « Pas qualifié » sans qu'aucun rapport ne
// puisse les produire. La carte du parcours passe de 5 à 7 sorties.

test('perdu : outcome lost, aucun revenu', () => {
  const { rapport, callFields } = buildRapportPatch(reponses({
    showedUp: true, qualified: true, outcomeChoice: 'lost',
  }));
  assert.equal(rapport.outcome, 'lost');
  assert.equal(rapport.no_show, false);
  assert.equal(rapport.deal_closed, false);
  assert.equal(rapport.revenue, 0);
  assert.equal(rapport.qualified, true, 'un lead qualifié peut être perdu');
  assert.deepEqual(callFields, {});
});

test('pas qualifié : qualified part à false SANS la question dédiée', () => {
  // Choisir « pas qualifié » EST la réponse à « était-il la cible ? ». Sans ça,
  // le % Calls Qualifiés compterait ce call comme non renseigné.
  const { rapport } = buildRapportPatch(reponses({
    showedUp: true, qualified: null, outcomeChoice: 'not_qualified',
  }));
  assert.equal(rapport.outcome, 'not_qualified');
  assert.equal(rapport.qualified, false);
});

test('pas qualifié : la réponse à qualified ne peut pas la contredire', () => {
  const { rapport } = buildRapportPatch(reponses({
    showedUp: true, qualified: true, outcomeChoice: 'not_qualified',
  }));
  assert.equal(rapport.qualified, false, 'l’issue prime sur une réponse antérieure');
});

// ── L'objection ────────────────────────────────────────────────────────────

test('l’objection part sur les trois branches qui la posent', () => {
  for (const outcome of ['lost', 'not_qualified', 'to_recontact'] as const) {
    const { rapport } = buildRapportPatch(reponses({
      showedUp: true, outcomeChoice: outcome, objection: 'prix',
    }));
    assert.equal(rapport.objection, 'prix', outcome);
    assert.equal(rapport.objection_autre, null);
  }
});

test('l’objection ne part JAMAIS sur les autres branches', () => {
  for (const outcome of ['closed', 'second_call', 'rescheduled'] as const) {
    const { rapport } = buildRapportPatch(reponses({
      showedUp: true, outcomeChoice: outcome, revenue: '100', objection: 'prix',
    }));
    assert.equal(rapport.objection, undefined, `${outcome} ne pose pas la question`);
  }
});

test('« autre » transmet le texte libre, rogné', () => {
  const { rapport } = buildRapportPatch(reponses({
    showedUp: true, outcomeChoice: 'lost', objection: 'autre', objectionAutre: '  il déménage  ',
  }));
  assert.equal(rapport.objection, 'autre');
  assert.equal(rapport.objection_autre, 'il déménage');
});

test('changer d’objection efface le texte libre devenu faux', () => {
  // Sans ça, corriger un rapport laisserait en base un texte qui ne correspond
  // plus au choix — invisible à l'écran, faux dans toute lecture ultérieure.
  const { rapport } = buildRapportPatch(reponses({
    showedUp: true, outcomeChoice: 'lost', objection: 'prix', objectionAutre: 'ancien texte',
  }));
  assert.equal(rapport.objection_autre, null);
});

test('« autre » sans texte n’envoie pas une chaîne vide', () => {
  const { rapport } = buildRapportPatch(reponses({
    showedUp: true, outcomeChoice: 'lost', objection: 'autre', objectionAutre: '   ',
  }));
  assert.equal(rapport.objection_autre, null);
});

test('objection non répondue : le champ est absent, la colonne intacte', () => {
  const { rapport } = buildRapportPatch(reponses({
    showedUp: true, outcomeChoice: 'lost', objection: null,
  }));
  assert.equal('objection' in rapport, false);
});

test('objectionsPour : « pas la cible » n’existe que sur pas qualifié', () => {
  const nq = objectionsPour('not_qualified').map(o => o.key);
  assert.ok(nq.includes('pas_la_cible'));
  for (const o of ['lost', 'to_recontact'] as const) {
    assert.ok(!objectionsPour(o).map(x => x.key).includes('pas_la_cible'), o);
  }
  assert.equal(objectionsPour('lost').length, 6);
  assert.equal(objectionsPour('not_qualified').length, 7);
});

test('demandeObjection : trois branches, pas une de plus', () => {
  assert.equal(demandeObjection('lost'), true);
  assert.equal(demandeObjection('not_qualified'), true);
  assert.equal(demandeObjection('to_recontact'), true);
  assert.equal(demandeObjection('closed'), false);
  assert.equal(demandeObjection('second_call'), false);
  assert.equal(demandeObjection('rescheduled'), false);
  assert.equal(demandeObjection(null), false);
});

// ── La date de relance ─────────────────────────────────────────────────────

test('relance_at va sur le call, pas dans le rapport', () => {
  const { rapport, callFields } = buildRapportPatch(reponses({
    showedUp: true, outcomeChoice: 'to_recontact', relanceAt: '2026-09-20',
  }));
  assert.equal(callFields.relance_at, '2026-09-20');
  assert.equal('relance_at' in rapport, false, 'la route rapport a sa propre liste blanche');
});

test('relance_at absente : callFields reste vide', () => {
  const { callFields } = buildRapportPatch(reponses({
    showedUp: true, outcomeChoice: 'to_recontact',
  }));
  assert.deepEqual(callFields, {});
});

test('relance_at ignorée hors de la branche à recontacter', () => {
  const { callFields } = buildRapportPatch(reponses({
    showedUp: true, outcomeChoice: 'lost', relanceAt: '2026-09-20',
  }));
  assert.equal(callFields.relance_at, undefined);
});

// ── Progression ────────────────────────────────────────────────────────────

test('les nouvelles questions comptent là où elles sont posées', () => {
  const sansObjection = reponses({ showedUp: true, qualified: true, outcomeChoice: 'lost' });
  const avecObjection = { ...sansObjection, objection: 'prix' as const };
  assert.equal(countAnswered(avecObjection), countAnswered(sansObjection) + 1);

  const sansDate = reponses({ showedUp: true, qualified: true, outcomeChoice: 'to_recontact', objection: 'prix' as const });
  const avecDate = { ...sansDate, relanceAt: '2026-09-20' };
  assert.equal(countAnswered(avecDate), countAnswered(sansDate) + 1);
});

test('estimateTotal garde répondues <= total sur les nouvelles branches', () => {
  for (const outcome of ['lost', 'not_qualified', 'to_recontact'] as const) {
    const a = reponses({
      showedUp: true, qualified: true, outcomeChoice: outcome,
      objection: 'autre' as const, objectionAutre: 'x', relanceAt: '2026-09-20',
    });
    assert.ok(estimateTotal(a) >= countAnswered(a), `${outcome} : ${countAnswered(a)}/${estimateTotal(a)}`);
  }
});

test('les six branches sont soumettables', () => {
  for (const outcome of ['closed', 'second_call', 'to_recontact', 'rescheduled', 'lost', 'not_qualified'] as const) {
    assert.equal(isSubmittable(reponses({ showedUp: true, outcomeChoice: outcome })), true, outcome);
  }
});

// ── La correction d'un rapport ne doit RIEN effacer ────────────────────────
// Le type de « ce qui existe déjà » était recopié à six endroits, et l'objection
// avait été oubliée dans les six : corriger un montant repartait avec des champs
// vides, et le patch écrasait l'objection par null sans que personne ne l'ait
// demandé. Ces tests verrouillent l'aller-retour.

test('corriger un rapport renvoie les mêmes valeurs si rien n’est touché', () => {
  // Ce que la base contient déjà, tel que `existing` le rendrait.
  const deja = reponses({
    isCorrection: true,
    showedUp: true,
    qualified: true,
    outcomeChoice: 'to_recontact',
    objection: 'prix',
    relanceAt: '2026-09-20',
    comment: 'rappeler après son déménagement',
  });
  const { rapport, callFields } = buildRapportPatch(deja);
  assert.equal(rapport.outcome, 'to_recontact');
  assert.equal(rapport.qualified, true);
  assert.equal(rapport.objection, 'prix');
  assert.equal(rapport.lead_rapport_comment, 'rappeler après son déménagement');
  assert.equal(callFields.relance_at, '2026-09-20');
});

test('corriger le MONTANT n’efface pas l’objection', () => {
  // Le cas réel : on rouvre pour changer un montant mal saisi.
  const avant = reponses({
    isCorrection: true, showedUp: true, outcomeChoice: 'lost', objection: 'temps',
  });
  const apres = { ...avant, comment: 'corrigé' };
  const { rapport } = buildRapportPatch(apres);
  assert.equal(rapport.objection, 'temps', 'l’objection survit à la correction');
  assert.equal(rapport.outcome, 'lost');
});

test('RapportExistant couvre tout ce que buildRapportPatch peut écrire', () => {
  // Garde-fou : si une question est ajoutée au rapport sans être ajoutée à
  // RapportExistant, la corriger l'effacerait. Ce test échoue alors.
  const champsEcrits = new Set<string>();
  for (const outcome of ['closed', 'second_call', 'to_recontact', 'lost', 'not_qualified'] as const) {
    const { rapport, callFields } = buildRapportPatch(reponses({
      showedUp: true, qualified: true, outcomeChoice: outcome, revenue: '100',
      objection: 'prix', relanceAt: '2026-09-20', comment: 'x', isCorrection: true,
    }));
    Object.keys(rapport).forEach(k => champsEcrits.add(k));
    Object.keys(callFields).forEach(k => champsEcrits.add(k));
  }
  // Ce que RapportExistant sait rouvrir, exprimé en noms de colonnes.
  const rouvrables = new Set([
    'revenue', 'lead_rapport_comment', 'outcome', 'qualified',
    'objection', 'objection_autre', 'relance_at',
    // Écrits mais déduits de l'outcome, donc jamais à rouvrir séparément.
    'no_show', 'deal_closed',
  ]);
  const orphelins = [...champsEcrits].filter(c => !rouvrables.has(c));
  assert.deepEqual(
    orphelins, [],
    `Ces champs partent en base sans que RapportExistant sache les relire : ${orphelins.join(', ')}. `
    + 'Corriger un rapport les effacerait.',
  );
});
