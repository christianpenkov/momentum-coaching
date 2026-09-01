import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compterLeads, type LignesLeads } from './salesCallStats.ts';

// Lancé par `npm test`. `compterLeads` est la règle PURE du comptage de leads, extraite
// le 2026-09-01 pour que la version « un élève » (fetchAllLeadsCount) et la version
// « quarante élèves » (fetchLeadsCountsBatch) appellent exactement le même code.
//
// Ce fichier décrit ce que la règle fait, et surtout les deux pièges qu'elle contourne :
// le filtre de date appliqué APRÈS la déduplication, et la déduplication par PERSONNE
// et non par call. Les deux ont causé de vrais écarts, datés dans les commentaires.

function lignes(p: Partial<LignesLeads> = {}): LignesLeads {
  return { leads: [], liens: [], callsIgDirects: [], callsYoutube: [], ...p };
}
const appel = (id: string, email: string | null = null, nom: string | null = null) =>
  ({ id, invitee_email: email, invitee_name: nom });

test('aucune ligne : zéro', () => {
  assert.equal(compterLeads(lignes(), null), 0);
});

/* ─── Déduplication par username, entre les deux sources ─────────────────── */

test('le même username dans les deux sources compte une seule fois', () => {
  const n = compterLeads(lignes({
    leads: [{ ig_username: 'alice', detected_at: '2026-07-01T00:00:00Z' }],
    liens: [{ ig_username: 'alice', created_at: '2026-08-01T00:00:00Z' }],
  }), null);
  assert.equal(n, 1);
});

test('la casse du username ne crée pas deux personnes', () => {
  const n = compterLeads(lignes({
    leads: [{ ig_username: 'Alice', detected_at: '2026-07-01T00:00:00Z' }],
    liens: [{ ig_username: 'alice', created_at: '2026-07-02T00:00:00Z' }],
  }), null);
  assert.equal(n, 1);
});

test('une ligne sans username ou sans date est ignorée', () => {
  const n = compterLeads(lignes({
    leads: [
      { ig_username: null, detected_at: '2026-07-01T00:00:00Z' },
      { ig_username: 'bob', detected_at: null },
      { ig_username: 'carole', detected_at: '2026-07-01T00:00:00Z' },
    ],
  }), null);
  assert.equal(n, 1);
});

/* ─── Le piège du filtre de date ─────────────────────────────────────────── */

test('le filtre `since` s\'applique sur la date la plus ANCIENNE, après dédup', () => {
  // Le cas réel : un prospect détecté en juillet, dont un lien est recréé en août
  // (prospect_links est recréé à chaque envoi). Filtrer chaque source séparément AVANT
  // de dédupliquer le recomptait comme « nouveau ce mois ». Il ne l'est pas.
  const alice = lignes({
    leads: [{ ig_username: 'alice', detected_at: '2026-07-01T00:00:00Z' }],
    liens: [{ ig_username: 'alice', created_at: '2026-08-15T00:00:00Z' }],
  });
  assert.equal(compterLeads(alice, '2026-08-01T00:00:00Z'), 0);
  assert.equal(compterLeads(alice, null), 1);
});

test('un prospect vraiment nouveau passe bien le filtre', () => {
  const n = compterLeads(lignes({
    leads: [{ ig_username: 'nouveau', detected_at: '2026-08-10T00:00:00Z' }],
  }), '2026-08-01T00:00:00Z');
  assert.equal(n, 1);
});

test('le filtre est inclusif à la borne', () => {
  const n = compterLeads(lignes({
    leads: [{ ig_username: 'pile', detected_at: '2026-08-01T00:00:00Z' }],
  }), '2026-08-01T00:00:00Z');
  assert.equal(n, 1);
});

/* ─── Déduplication des calls par PERSONNE, pas par call ─────────────────── */

test('deux calls du même e-mail sont une seule personne', () => {
  // Calendly crée un NOUVEL événement à chaque reprogrammation : un prospect qui
  // déplace son rendez-vous a deux lignes dans `calls`. Les compter séparément
  // affichait 18 leads là où le pipeline en montrait 17 (2026-08-19).
  const n = compterLeads(lignes({
    callsIgDirects: [appel('c1', 'bob@x.fr'), appel('c2', 'bob@x.fr')],
  }), null);
  assert.equal(n, 1);
});

test('sans e-mail, le nom sert de clé ; sans nom, l\'identifiant du call', () => {
  const n = compterLeads(lignes({
    callsIgDirects: [
      appel('c1', null, 'Bob Durand'),
      appel('c2', null, 'bob durand'), // même personne, casse différente
      appel('c3', null, null),          // aucune identité : compte pour lui-même
    ],
  }), null);
  assert.equal(n, 2);
});

test('un call YouTube et un call Instagram de la même personne comptent deux fois', () => {
  // Comportement constaté, pas corrigé ici : les deux volets ont leur propre ensemble.
  // Le figer permet qu'une future unification soit un choix explicite.
  const n = compterLeads(lignes({
    callsIgDirects: [appel('c1', 'bob@x.fr')],
    callsYoutube: [appel('c2', 'bob@x.fr')],
  }), null);
  assert.equal(n, 2);
});

/* ─── Composition des trois volets ───────────────────────────────────────── */

test('les trois volets s\'additionnent', () => {
  const n = compterLeads(lignes({
    leads: [{ ig_username: 'alice', detected_at: '2026-07-01T00:00:00Z' }],
    liens: [{ ig_username: 'zoe', created_at: '2026-07-02T00:00:00Z' }],
    callsIgDirects: [appel('c1', 'bob@x.fr')],
    callsYoutube: [appel('c2', 'carl@x.fr')],
  }), null);
  assert.equal(n, 4);
});

test('sans volet YouTube, on obtient le compte Instagram seul', () => {
  // C'est exactement ce que fait fetchIgLeadsCount : les mêmes lignes, callsYoutube vide.
  const base = {
    leads: [{ ig_username: 'alice', detected_at: '2026-07-01T00:00:00Z' }],
    callsIgDirects: [appel('c1', 'bob@x.fr')],
  };
  assert.equal(compterLeads(lignes({ ...base, callsYoutube: [] }), null), 2);
  assert.equal(compterLeads(lignes({ ...base, callsYoutube: [appel('c9', 'zoe@x.fr')] }), null), 3);
});

test('un username ne dédoublonne PAS avec un call de la même personne', () => {
  // Les deux ensembles ont des clés différentes par nature — username Instagram d'un
  // côté, e-mail Calendly de l'autre — et rien ne permet de les rapprocher. Figé pour
  // que la limite soit connue plutôt que découverte.
  const n = compterLeads(lignes({
    leads: [{ ig_username: 'bob', detected_at: '2026-07-01T00:00:00Z' }],
    callsIgDirects: [appel('c1', null, 'bob')],
  }), null);
  assert.equal(n, 2);
});
