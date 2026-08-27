import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveLeadState,
  resolveNaturalStage,
  pickDecidingCall,
  countRelancesCycle,
  OUTCOME_TO_ISSUE,
  ISSUE_TO_OUTCOME,
  ISSUE_KEYS,
  MAX_RELANCES,
  RELANCE_EXPIRY_DAYS,
  type StageCall,
  type StageInput,
} from './pipelineStage.ts';

// Lancé par `npm test` (node --test, sans aucune dépendance à installer).
// Fonction pure : ni React, ni réseau, ni base.

const NOW = new Date('2026-09-01T12:00:00Z');
const jours = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const dans = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

function call(over: Partial<StageCall> = {}): StageCall {
  return {
    id: 'c1', status: 'active', scheduled_at: jours(3),
    outcome: null, no_show: null, ...over,
  };
}
function etat(input: Partial<StageInput> = {}) {
  return resolveLeadState({ signals: {}, ...input }, NOW);
}

// ── La table de correspondance : le cœur du modèle ────────────────────────────
// Les 5 issues ne sont PAS les 5 outcomes. `rescheduled` et `second_call` ne sont
// pas des résultats — les traiter comme des issues créerait deux colonnes
// fantômes, exactement le mélange étape/résultat qui a déclenché la refonte.

test('outcome → issue : les cinq qui donnent une issue', () => {
  const attendu = [
    ['closed', 'closed'],
    ['no_show', 'no_show'],
    ['to_recontact', 'to_recontact'],
    ['lost', 'lost'],
    ['not_qualified', 'not_qualified'],
  ] as const;
  for (const [outcome, issue] of attendu) {
    const s = etat({ calls: [call({ outcome })] });
    assert.equal(s.issue, issue, `${outcome} doit donner l'issue ${issue}`);
    assert.equal(s.status, 'classed');
    assert.equal(s.stage, 'call_booked');
    assert.equal(s.decidedByCallId, 'c1');
  }
});

test('rescheduled et second_call ne sont PAS des issues', () => {
  for (const outcome of ['rescheduled', 'second_call'] as const) {
    assert.equal(OUTCOME_TO_ISSUE[outcome], null, `${outcome} ne doit pas mapper vers une issue`);
    const s = etat({ calls: [call({ outcome, scheduled_at: dans(4) })] });
    assert.equal(s.issue, null, `${outcome} ne doit créer aucune issue`);
    assert.equal(s.status, 'active', 'le lead reste actif');
    assert.equal(s.stage, 'call_booked', 'il retourne en RDV pris');
    assert.equal(s.flags.rapportEnRetard, false, 'RDV à venir : rien à remplir');
  }
});

test('un RDV passé sans rapport rempli le signale', () => {
  const s = etat({ calls: [call({ outcome: null, scheduled_at: jours(2) })] });
  assert.equal(s.status, 'active');
  assert.equal(s.stage, 'call_booked');
  assert.equal(s.issue, null);
  assert.equal(s.flags.rapportEnRetard, true);
});

test('un RDV à venir ne réclame aucun rapport', () => {
  const s = etat({ calls: [call({ outcome: null, scheduled_at: dans(3) })] });
  assert.equal(s.flags.rapportEnRetard, false);
});

// La garde qui empêche un 2e call jamais booké de rester éternellement en « RDV pris ».
test('un second_call dont la date est passée réclame un rapport', () => {
  const s = etat({ calls: [call({ outcome: 'second_call', scheduled_at: jours(5) })] });
  assert.equal(s.status, 'active');
  assert.equal(s.flags.rapportEnRetard, true, 'sinon il resterait bloqué à vie');
});

test('no_show est lu même quand outcome est vide', () => {
  // rapportPatch pose `no_show: true` à part de `outcome` — la fonction doit
  // le lire d'abord, sinon un no-show tomberait dans « pas de rapport ».
  const s = etat({ calls: [call({ no_show: true, outcome: null })] });
  assert.equal(s.issue, 'no_show');
  assert.equal(s.status, 'classed');
});

// `qualified` vaut null sur 8 des 16 calls ayant un outcome — dont 2 closés et
// 3 no-show. Il est inutilisable comme source d'issue (vérifié en base 2026-08-27).
test('qualified absent ne change rien à l’issue', () => {
  const s = etat({ calls: [call({ outcome: 'closed' })] });
  assert.equal(s.issue, 'closed');
});

// ── Priorité entre plusieurs calls ────────────────────────────────────────────

test('deux RDV sans deal : le plus récent décide', () => {
  const s = etat({ calls: [
    call({ id: 'a', scheduled_at: jours(20), outcome: 'to_recontact' }),
    call({ id: 'b', scheduled_at: jours(2),  outcome: 'no_show', no_show: true }),
  ]});
  assert.equal(s.issue, 'no_show');
  assert.equal(s.decidedByCallId, 'b');
});

// La règle vivait déjà dans PagePipeline avant l'unification : « un deal conclu
// sur le 1er rendez-vous ne doit pas être perdu parce que le dernier a été
// annulé ». L'argent est encaissé — un no-show au call de suivi ne l'annule pas.
test('un deal conclu l’emporte sur un RDV plus récent', () => {
  const closePuisNoShow = etat({ calls: [
    call({ id: 'a', scheduled_at: jours(20), outcome: 'closed' }),
    call({ id: 'b', scheduled_at: jours(2),  outcome: 'no_show', no_show: true }),
  ]});
  assert.equal(closePuisNoShow.issue, 'closed', 'le closé gagne malgré sa date plus ancienne');
  assert.equal(closePuisNoShow.decidedByCallId, 'a');

  const noShowPuisClose = etat({ calls: [
    call({ id: 'a', scheduled_at: jours(20), outcome: 'no_show', no_show: true }),
    call({ id: 'b', scheduled_at: jours(2),  outcome: 'closed' }),
  ]});
  assert.equal(noShowPuisClose.issue, 'closed', 'et il gagne aussi quand il est le plus récent');
  assert.equal(noShowPuisClose.decidedByCallId, 'b');
});

test('deux deals conclus : le plus récent des deux décide', () => {
  const s = etat({ calls: [
    call({ id: 'a', scheduled_at: jours(40), outcome: 'closed' }),
    call({ id: 'b', scheduled_at: jours(9),  outcome: 'closed' }),
  ]});
  assert.equal(s.decidedByCallId, 'b');
});

test('un call reprogrammé ne décide pas — son remplaçant le fait', () => {
  const s = etat({ calls: [
    call({ id: 'vieux', scheduled_at: jours(1), outcome: 'rescheduled', rescheduled: true }),
    call({ id: 'neuf',  scheduled_at: jours(9), outcome: 'closed' }),
  ]});
  assert.equal(s.decidedByCallId, 'neuf', 'le reprogrammé est écarté malgré sa date plus récente');
  assert.equal(s.issue, 'closed');
});

test('les calls ignorés, supprimés ou annulés sont écartés', () => {
  for (const over of [
    { ignored: true }, { lead_deleted: true }, { status: 'canceled' },
  ]) {
    const s = etat({
      calls: [call({ outcome: 'closed', ...over })],
      manualIssue: 'lost',
    });
    assert.equal(s.issue, 'lost', 'on retombe sur le classement manuel');
    assert.equal(s.decidedByCallId, null);
  }
});

test('aucun call utile : pickDecidingCall rend null', () => {
  assert.equal(pickDecidingCall([]), null);
  assert.equal(pickDecidingCall([call({ ignored: true })]), null);
});

// ── Le classement à la main, sans aucun RDV ───────────────────────────────────
// C'est le cas que « l'issue se déduit de calls » ne savait pas traiter : un lead
// classé Perdu qui n'a jamais eu de rendez-vous n'a aucune ligne dans calls.

test('classé à la main sans RDV : l’issue vient de l’override', () => {
  const s = etat({
    signals: { hasReplied: true },
    manualIssue: 'lost',
    manualReason: 'trop cher',
  });
  assert.equal(s.issue, 'lost');
  assert.equal(s.status, 'classed');
  assert.equal(s.issueReason, 'trop cher');
  assert.equal(s.stage, 'in_convo', 'l’étape atteinte est conservée');
});

test('le classement manuel garde l’étape, quelle qu’elle soit', () => {
  const s = etat({ signals: { linkClickedValid: true }, manualIssue: 'not_qualified' });
  assert.equal(s.stage, 'link_clicked');
  assert.equal(s.issue, 'not_qualified');
});

test('un call arrivé après le classement l’emporte', () => {
  const s = etat({ manualIssue: 'lost', calls: [call({ outcome: 'closed' })] });
  assert.equal(s.issue, 'closed', 'le call gagne sur l’override');
  assert.equal(s.decidedByCallId, 'c1');
});

test('une valeur d’override inconnue est ignorée, pas propagée', () => {
  const s = etat({ signals: { hasReplied: true }, manualIssue: 'showed_up' });
  assert.equal(s.issue, null, 'showed_up n’est plus une issue');
  assert.equal(s.status, 'active');
});

test('sans call ni override, le lead est actif', () => {
  const s = etat({ signals: { hasReplied: true } });
  assert.equal(s.status, 'active');
  assert.equal(s.issue, null);
  assert.equal(s.stage, 'in_convo');
});

// ── Le cycle de relance, borné ────────────────────────────────────────────────

test('0 à 2 relances : le lead reste À recontacter', () => {
  for (const n of [0, 1, 2]) {
    const s = etat({
      manualIssue: 'to_recontact',
      relances: Array.from({ length: n }, (_, i) => jours(60 - i * 20)),
    });
    assert.equal(s.issue, 'to_recontact', `${n} relance(s)`);
    assert.equal(s.flags.relancesFaites, n);
    assert.equal(s.flags.cycleEpuise, false);
  }
});

test('3 relances mais la dernière est récente : rien ne bouge', () => {
  const s = etat({
    manualIssue: 'to_recontact',
    relances: [jours(50), jours(30), jours(5)],
  });
  assert.equal(s.issue, 'to_recontact');
  assert.equal(s.flags.cycleEpuise, false);
  assert.equal(s.flags.relanceDue, false, 'la dernière date de 5 jours');
});

test('3 relances et la dernière a expiré : sortie en Perdu « sans réponse »', () => {
  const s = etat({
    manualIssue: 'to_recontact',
    relances: [jours(80), jours(55), jours(RELANCE_EXPIRY_DAYS + 1)],
  });
  assert.equal(s.issue, 'lost');
  assert.equal(s.issueReason, 'sans_reponse');
  assert.equal(s.flags.cycleEpuise, true);
  assert.equal(s.flags.relanceDue, false, 'le lead est sorti : plus rien à relancer');
});

test('une réponse du lead remet le compteur à zéro', () => {
  const s = etat({
    manualIssue: 'to_recontact',
    relances: [jours(80), jours(55), jours(40)],
    lastReplyAt: jours(30),
  });
  assert.equal(s.flags.relancesFaites, 0, 'les relances d’avant la réponse sont d’un cycle clos');
  assert.equal(s.issue, 'to_recontact');
  assert.equal(s.flags.cycleEpuise, false);
});

test('countRelancesCycle ne garde que les relances postérieures à la réponse', () => {
  const r = countRelancesCycle([jours(50), jours(30), jours(10)], jours(20));
  assert.equal(r.faites, 1);
  assert.equal(r.derniere, new Date(jours(10)).getTime());
});

test('une relance est due dès le classement, avant toute relance', () => {
  const s = etat({ manualIssue: 'to_recontact', relances: [] });
  assert.equal(s.flags.relanceDue, true);
  assert.equal(s.flags.relancesFaites, 0);
});

test('le cycle de relance ne touche que « À recontacter »', () => {
  // Décision de Chris : un lead Perdu ou Pas qualifié n'est dans aucun cycle.
  for (const issue of ['lost', 'not_qualified'] as const) {
    const s = etat({
      manualIssue: issue,
      relances: [jours(80), jours(55), jours(40)],
    });
    assert.equal(s.issue, issue, 'aucune conversion en sortie automatique');
    assert.equal(s.flags.relancesFaites, 0);
    assert.equal(s.flags.relanceDue, false);
  }
});

test('un call to_recontact entre aussi dans le cycle', () => {
  const s = etat({
    calls: [call({ outcome: 'to_recontact' })],
    relances: [jours(70), jours(45), jours(RELANCE_EXPIRY_DAYS + 3)],
  });
  assert.equal(s.issue, 'lost');
  assert.equal(s.issueReason, 'sans_reponse');
  assert.equal(s.stage, 'call_booked');
});

test('MAX_RELANCES et RELANCE_EXPIRY_DAYS valent bien 3 et 21', () => {
  assert.equal(MAX_RELANCES, 3);
  assert.equal(RELANCE_EXPIRY_DAYS, 21);
});

// ── Issues terminales ─────────────────────────────────────────────────────────

test('un lead closé ne revient jamais, quoi qu’il fasse', () => {
  const s = etat({
    signals: { hasReplied: true, linkClickedValid: true },
    calls: [call({ outcome: 'closed' })],
    relances: [jours(80), jours(55), jours(40)],
  });
  assert.equal(s.issue, 'closed');
  assert.equal(s.status, 'classed');
  assert.equal(s.flags.cycleEpuise, false, 'aucun cycle sur un lead closé');
});

test('« ce n’est pas un lead » l’emporte sur tout', () => {
  const s = etat({
    notALead: true,
    calls: [call({ outcome: 'closed' })],
    manualIssue: 'to_recontact',
  });
  assert.equal(s.status, 'removed');
  assert.equal(s.issue, null);
});

// ── Les étapes ────────────────────────────────────────────────────────────────

test('chaque signal fait avancer d’un cran, jamais reculer', () => {
  assert.equal(resolveNaturalStage({}), 'lm_sent');
  assert.equal(resolveNaturalStage({ lmLinkRequested: true }), 'lm_received');
  assert.equal(resolveNaturalStage({ isColdDm: true }), 'cold_dm');
  assert.equal(resolveNaturalStage({ hasReplied: true }), 'in_convo');
  assert.equal(resolveNaturalStage({ calendlySentValid: true }), 'calendly_sent');
  assert.equal(resolveNaturalStage({ linkClickedValid: true }), 'link_clicked');
});

test('un signal ancien ne fait pas reculer sous le plancher', () => {
  // Le bug d'origine : un nouveau commentaire du même lead ramenait la carte
  // au début alors qu'il avait déjà cliqué le lien.
  const s = resolveNaturalStage({ hasReplied: true, minStageReached: 'link_clicked' });
  assert.equal(s, 'link_clicked');
});

test('le plancher ne fait pas avancer un lead qui n’est pas allé si loin', () => {
  const s = resolveNaturalStage({ linkClickedValid: true, minStageReached: 'in_convo' });
  assert.equal(s, 'link_clicked', 'le signal réel est plus avancé que le plancher');
});

test('un lead Cold DM part de Cold DM, pas de Commentaire LM', () => {
  const s = etat({ signals: { isColdDm: true } });
  assert.equal(s.stage, 'cold_dm');
});

test('un RDV pris place toujours le lead en « RDV pris »', () => {
  const s = etat({ signals: {}, calls: [call({ scheduled_at: dans(2) })] });
  assert.equal(s.stage, 'call_booked', 'même sans aucun signal antérieur');
});

// ── Classer à la main un lead QUI A un rendez-vous ─────────────────────────
// Le piège le plus subtil du modèle : le call a toujours la priorité. Classer
// sans écrire le résultat sur le call laisse l'override invisible, et la carte
// revient aussitôt à sa place. ISSUE_TO_OUTCOME existe pour ça.

test('un override est INVISIBLE tant que le call n’a pas de résultat', () => {
  const s = etat({
    calls: [call({ outcome: null, scheduled_at: dans(2) })],
    manualIssue: 'lost',
  });
  assert.equal(s.issue, null, 'le call sans résultat gagne, et il n’en a aucun');
  assert.equal(s.status, 'active');
  assert.equal(s.stage, 'call_booked');
});

test('avec le résultat écrit sur le call, le classement prend effet', () => {
  const s = etat({
    calls: [call({ outcome: ISSUE_TO_OUTCOME.lost.outcome })],
    manualIssue: 'lost',
  });
  assert.equal(s.issue, 'lost');
  assert.equal(s.status, 'classed');
});

test('ISSUE_TO_OUTCOME couvre les cinq issues, et se relit dans les deux sens', () => {
  for (const issue of ISSUE_KEYS) {
    const patch = ISSUE_TO_OUTCOME[issue];
    assert.ok(patch, `${issue} doit avoir un outcome`);
    assert.equal(
      OUTCOME_TO_ISSUE[patch.outcome], issue,
      `${issue} → ${patch.outcome} doit se retraduire en ${issue}`,
    );
  }
});

test('no_show porte aussi son booléen, posé à part par le rapport', () => {
  assert.equal(ISSUE_TO_OUTCOME.no_show.no_show, true);
  // Et le résultat est bien lu dans les deux sens.
  const s = etat({ calls: [call({ outcome: 'no_show', no_show: true })] });
  assert.equal(s.issue, 'no_show');
});

test('classer en Closé écrit un outcome, pas seulement deal_closed', () => {
  // Le kanban écrivait deal_closed sans outcome : la fonction ne lit QUE
  // l'outcome, donc le lead repassait en « RDV pris » juste après le closing.
  const sansOutcome = etat({ calls: [call({ outcome: null })], manualIssue: 'closed' });
  assert.equal(sansOutcome.issue, null, 'c’était le bug');

  const avecOutcome = etat({ calls: [call({ outcome: 'closed' })], manualIssue: 'closed' });
  assert.equal(avecOutcome.issue, 'closed');
});

test('sans aucun call, l’override suffit — c’est sa raison d’être', () => {
  for (const issue of ISSUE_KEYS) {
    const s = etat({ signals: { hasReplied: true }, manualIssue: issue });
    assert.equal(s.issue, issue, issue);
    assert.equal(s.status, 'classed');
  }
});
