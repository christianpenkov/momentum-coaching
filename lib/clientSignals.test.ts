import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isTaskOverdue,
  getClientSignals,
  getAggregatedSignals,
  getTaskBucket,
  getDeadlineStatus,
  watchList,
  phraseSignaux,
  SEUIL_JOURS_SANS_PUBLIER,
} from './clientSignals.ts';
import type { Task, SessionReport } from './supabase/types.ts';

// Lancé par `npm test` (node --test, sans aucune dépendance à installer).
// Fonctions pures : ni React, ni réseau, ni base.
//
// ⚠️ Ce fichier a été écrit AVANT d'ajouter le 3e signal (arrêt de publication) au
// chantier « Stats Clients ». Il décrit donc le comportement EXISTANT, celui dont
// dépendent DEUX écrans en production — l'accueil coach (PageToday, carte « Clients à
// surveiller ») et la liste des clients (PageClients, filtres et pastilles).
//
// L'ordre est délibéré : tester d'abord ce qui existe, puis modifier. Écrire les tests
// en même temps que la modification aurait testé ce qu'on venait d'écrire, pas ce qui
// tournait — et une régression sur l'accueil serait passée inaperçue.

const JOUR = 86_400_000;
const passe = () => new Date(Date.now() - 3 * JOUR).toISOString();
const futur = () => new Date(Date.now() + 3 * JOUR).toISOString();

function tache(p: Partial<Task> = {}): Task {
  return {
    id: 'tache-1',
    client_id: 'client-1',
    label: 'Écrire 3 reels',
    done: false,
    meta: null,
    deadline: null,
    priority: null,
    added_by: 'coach',
    resolved_by_coach: false,
    resolved_at: null,
    created_at: new Date().toISOString(),
    ...p,
  } as Task;
}

function rapport(p: Partial<SessionReport> = {}): SessionReport {
  return {
    id: 'rapport-1',
    call_id: 'call-1',
    client_id: 'client-1',
    coach_id: 'coach-1',
    attended: null,
    topic: null,
    topic_custom: null,
    notes: null,
    student_notes: null,
    student_notes_dismissed: false,
    structured_answers: {},
    acknowledged_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...p,
  } as SessionReport;
}

/* ─── isTaskOverdue : quatre portes, toutes fermantes ────────────────────── */

test('en retard : une deadline dépassée, tâche ouverte', () => {
  assert.equal(isTaskOverdue(tache({ deadline: passe() })), true);
});

test('pas en retard : deadline à venir', () => {
  assert.equal(isTaskOverdue(tache({ deadline: futur() })), false);
});

test('pas en retard : aucune deadline — une tâche sans échéance ne peut pas être en retard', () => {
  assert.equal(isTaskOverdue(tache({ deadline: null })), false);
});

test('pas en retard : tâche terminée, même avec une deadline dépassée', () => {
  assert.equal(isTaskOverdue(tache({ deadline: passe(), done: true })), false);
});

test('pas en retard : tâche résolue par le coach, même avec une deadline dépassée', () => {
  // Le coach peut clore une tâche sans que l'élève l'ait cochée. Elle sort alors des
  // signaux : c'est lui qui a décidé qu'elle n'était plus due.
  assert.equal(isTaskOverdue(tache({ deadline: passe(), resolved_by_coach: true })), false);
});

/* ─── getClientSignals : tâches du coach seulement ───────────────────────── */

test('compte une tâche du coach en retard', () => {
  const s = getClientSignals([tache({ deadline: passe() })], []);
  assert.deepEqual(s, { overdueTasksCount: 1, activeNoShowsCount: 0,
    joursSansPublier: null, publicationArretee: false, total: 1 });
});

test("ne compte JAMAIS une tâche de l'élève, même en retard", () => {
  // Règle métier : les tâches personnelles de l'élève restent son affaire privée. Le
  // coach n'a de comptes à rendre que sur ce qu'il a lui-même assigné.
  const s = getClientSignals([tache({ deadline: passe(), added_by: 'client' })], []);
  assert.equal(s.overdueTasksCount, 0);
  assert.equal(s.total, 0);
});

test('ne compte pas une tâche dont added_by est null', () => {
  const s = getClientSignals([tache({ deadline: passe(), added_by: null })], []);
  assert.equal(s.overdueTasksCount, 0);
});

test('compte plusieurs tâches en retard', () => {
  const s = getClientSignals(
    [
      tache({ id: 'a', deadline: passe() }),
      tache({ id: 'b', deadline: passe() }),
      tache({ id: 'c', deadline: futur() }),
    ],
    [],
  );
  assert.equal(s.overdueTasksCount, 2);
});

/* ─── getClientSignals : no-shows non acquittés ──────────────────────────── */

test('compte un no-show non acquitté', () => {
  const s = getClientSignals([], [rapport({ attended: false })]);
  assert.deepEqual(s, { overdueTasksCount: 0, activeNoShowsCount: 1,
    joursSansPublier: null, publicationArretee: false, total: 1 });
});

test('ne compte pas un no-show acquitté par le coach', () => {
  const s = getClientSignals([], [rapport({ attended: false, acknowledged_at: passe() })]);
  assert.equal(s.activeNoShowsCount, 0);
});

test('ne compte pas un élève venu au call', () => {
  const s = getClientSignals([], [rapport({ attended: true })]);
  assert.equal(s.activeNoShowsCount, 0);
});

test('ne compte pas un rapport non rempli — attended null n\'est pas une absence', () => {
  // `attended` vaut null tant que le coach n'a pas rapporté. Le lire comme une absence
  // ferait remonter chaque call non encore rapporté comme un signal.
  const s = getClientSignals([], [rapport({ attended: null })]);
  assert.equal(s.activeNoShowsCount, 0);
});

/* ─── total et agrégation ────────────────────────────────────────────────── */

test('total = tâches en retard + no-shows', () => {
  const s = getClientSignals(
    [tache({ id: 'a', deadline: passe() }), tache({ id: 'b', deadline: passe() })],
    [rapport({ attended: false })],
  );
  assert.deepEqual(s, { overdueTasksCount: 2, activeNoShowsCount: 1,
    joursSansPublier: null, publicationArretee: false, total: 3 });
});

test('aucun signal : tout à zéro', () => {
  assert.deepEqual(getClientSignals([], []), {
    overdueTasksCount: 0,
    activeNoShowsCount: 0,
    joursSansPublier: null,
    publicationArretee: false,
    total: 0,
  });
});

test('getAggregatedSignals additionne champ par champ', () => {
  const a = getClientSignals([tache({ deadline: passe() })], []);
  const b = getClientSignals([], [rapport({ attended: false })]);
  const c = getClientSignals([], []);
  assert.deepEqual(getAggregatedSignals([a, b, c]), {
    overdueTasksCount: 1,
    activeNoShowsCount: 1,
    publicationArreteeCount: 0,
    total: 2,
  });
});

test('getAggregatedSignals sur une liste vide rend des zéros', () => {
  assert.deepEqual(getAggregatedSignals([]), {
    overdueTasksCount: 0,
    activeNoShowsCount: 0,
    publicationArreteeCount: 0,
    total: 0,
  });
});

/* ─── getTaskBucket : les cinq niveaux des pages Tâches ──────────────────── */

test('bucket done l\'emporte sur tout le reste', () => {
  assert.equal(getTaskBucket(tache({ done: true, deadline: passe() })), 'done');
});

test('bucket over suit exactement isTaskOverdue', () => {
  assert.equal(getTaskBucket(tache({ deadline: passe() })), 'over');
  // Résolue par le coach : plus « en retard », donc jamais dans `over`.
  //
  // ⚠️ Elle retombe alors dans `today`, pas dans `later` : `getTaskBucket` teste
  // `done`, puis `isTaskOverdue`, puis l'absence de deadline — et une échéance passée
  // donne `diffDays <= 0`, donc `today`. Comportement constaté, pas voulu : une tâche
  // que le coach a close réapparaît sous « Aujourd'hui » sur les pages Tâches.
  // Hors périmètre du chantier Stats Clients ; ce test le fige pour qu'une correction
  // future soit un choix explicite et non un effet de bord.
  assert.equal(getTaskBucket(tache({ deadline: passe(), resolved_by_coach: true })), 'today');
});

test('bucket later quand il n\'y a pas de deadline', () => {
  assert.equal(getTaskBucket(tache({ deadline: null })), 'later');
});

test('bucket week pour une échéance dans les sept jours', () => {
  const dans3j = new Date(Date.now() + 3 * JOUR).toISOString();
  assert.equal(getTaskBucket(tache({ deadline: dans3j })), 'week');
});

test('bucket later au-delà de sept jours', () => {
  const dans30j = new Date(Date.now() + 30 * JOUR).toISOString();
  assert.equal(getTaskBucket(tache({ deadline: dans30j })), 'later');
});

/* ─── getDeadlineStatus : le badge affiché ───────────────────────────────── */

test('aucun badge sans deadline, ni sur une tâche terminée', () => {
  assert.equal(getDeadlineStatus(null, false), null);
  assert.equal(getDeadlineStatus(passe(), true), null);
});

test('badge en retard, avec le délai écoulé', () => {
  const s = getDeadlineStatus(passe(), false);
  assert.equal(s?.overdue, true);
  assert.equal(s?.urgent, false);
  assert.match(s!.label, /^En retard/);
});

test('badge urgent dans les deux jours, mais pas au-delà', () => {
  const dans1j = new Date(Date.now() + 1 * JOUR).toISOString();
  const dans10j = new Date(Date.now() + 10 * JOUR).toISOString();
  assert.equal(getDeadlineStatus(dans1j, false)?.urgent, true);
  assert.equal(getDeadlineStatus(dans10j, false)?.urgent, false);
});

/* ─── 3e signal : arrêt de publication ───────────────────────────────────── */

test('sans la donnée, le signal est ABSENT — pas à zéro', () => {
  // Les sept sites d'appel existants passent deux arguments. Ils doivent garder
  // exactement le comportement d'avant : ne rien affirmer sur la publication.
  const s = getClientSignals([], []);
  assert.equal(s.joursSansPublier, null);
  assert.equal(s.publicationArretee, false);
  assert.equal(s.total, 0);
});

test('au seuil exact, le signal se déclenche', () => {
  const s = getClientSignals([], [], SEUIL_JOURS_SANS_PUBLIER);
  assert.equal(s.publicationArretee, true);
  assert.equal(s.total, 1);
});

test('un jour sous le seuil, rien ne se déclenche', () => {
  const s = getClientSignals([], [], SEUIL_JOURS_SANS_PUBLIER - 1);
  assert.equal(s.publicationArretee, false);
  assert.equal(s.total, 0);
});

test('zéro jour sans publier est une donnée, pas une absence', () => {
  // Publié aujourd'hui : on SAIT, et la réponse est « pas de signal ». À distinguer
  // de null, qui veut dire « on ne sait pas ».
  const s = getClientSignals([], [], 0);
  assert.equal(s.joursSansPublier, 0);
  assert.equal(s.publicationArretee, false);
});

test('le 3e signal s\'ajoute aux deux autres dans le total', () => {
  const s = getClientSignals(
    [tache({ deadline: passe() })],
    [rapport({ attended: false })],
    30,
  );
  assert.deepEqual(s, {
    overdueTasksCount: 1,
    activeNoShowsCount: 1,
    joursSansPublier: 30,
    publicationArretee: true,
    total: 3,
  });
});

test('getAggregatedSignals compte les élèves qui ont arrêté de publier', () => {
  const a = getClientSignals([], [], 30);
  const b = getClientSignals([], [], 2);
  const c = getClientSignals([], [], null);
  assert.deepEqual(getAggregatedSignals([a, b, c]), {
    overdueTasksCount: 0,
    activeNoShowsCount: 0,
    publicationArreteeCount: 1,
    total: 1,
  });
});

/* ─── watchList : la règle partagée par DEUX écrans ──────────────────────── */

const avec = (nom: string, s: ReturnType<typeof getClientSignals>) => ({ client: nom, signals: s });

test('watchList écarte les élèves sans aucun signal', () => {
  const L = watchList([
    avec('Sans souci', getClientSignals([], [])),
    avec('Une tâche', getClientSignals([tache({ deadline: passe() })], [])),
  ]);
  assert.equal(L.length, 1);
  assert.equal(L[0].client, 'Une tâche');
});

test('watchList trie par NOMBRE de signaux, décroissant', () => {
  const L = watchList([
    avec('Un', getClientSignals([], [rapport({ attended: false })])),
    avec('Trois', getClientSignals(
      [tache({ id: 'a', deadline: passe() }), tache({ id: 'b', deadline: passe() })],
      [rapport({ attended: false })],
    )),
    avec('Deux', getClientSignals([tache({ deadline: passe() })], [rapport({ attended: false })])),
  ]);
  assert.deepEqual(L.map(x => x.client), ['Trois', 'Deux', 'Un']);
});

test('sans plafond, watchList les rend TOUS — c\'est le carrousel de Stats Clients', () => {
  const entries = Array.from({ length: 9 }, (_, i) =>
    avec('e' + i, getClientSignals([tache({ id: 'x' + i, deadline: passe() })], [])));
  assert.equal(watchList(entries).length, 9);
});

test('avec un plafond de 4, watchList en rend 4 — c\'est la carte de l\'accueil', () => {
  const entries = Array.from({ length: 9 }, (_, i) =>
    avec('e' + i, getClientSignals([tache({ id: 'x' + i, deadline: passe() })], [])));
  assert.equal(watchList(entries, 4).length, 4);
});

test('un plafond plus grand que la liste ne fabrique pas de lignes vides', () => {
  const entries = [avec('seul', getClientSignals([tache({ deadline: passe() })], []))];
  assert.equal(watchList(entries, 4).length, 1);
});

test('watchList ne modifie pas le tableau reçu', () => {
  // `sort` mute en place : sans copie, l'ordre de la liste d'élèves de l'appelant
  // changerait sous ses pieds à chaque rendu.
  const entries = [
    avec('Un', getClientSignals([], [rapport({ attended: false })])),
    avec('Deux', getClientSignals([tache({ deadline: passe() })], [rapport({ attended: false })])),
  ];
  const avant = entries.map(x => x.client);
  watchList(entries);
  assert.deepEqual(entries.map(x => x.client), avant);
});

/* ─── phraseSignaux : ce que l'élève voit écrit sous son nom ─────────────── */

test('phrase : le singulier et le pluriel de chaque signal', () => {
  assert.equal(
    phraseSignaux(getClientSignals([tache({ deadline: passe() })], [])),
    '1 tâche en retard',
  );
  assert.equal(
    phraseSignaux(getClientSignals(
      [tache({ id: 'a', deadline: passe() }), tache({ id: 'b', deadline: passe() })], [])),
    '2 tâches en retard',
  );
  assert.equal(
    phraseSignaux(getClientSignals([], [rapport({ attended: false })])),
    '1 no-show',
  );
});

test('phrase : les signaux se joignent par un point médian, dans un ordre stable', () => {
  const s = getClientSignals(
    [tache({ deadline: passe() })],
    [rapport({ attended: false })],
    12,
  );
  assert.equal(phraseSignaux(s), '1 tâche en retard · 1 no-show · aucune publication depuis 12 jours');
});

test('phrase : rien à dire donne une chaîne vide, jamais un séparateur orphelin', () => {
  assert.equal(phraseSignaux(getClientSignals([], [])), '');
});

test('phrase : sous le seuil, la publication ne s\'écrit pas', () => {
  const s = getClientSignals([tache({ deadline: passe() })], [], 3);
  assert.equal(phraseSignaux(s), '1 tâche en retard');
});
