import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detecterDoublons,
  type CallPourFusion,
  type LeadIg,
  type ProspectPourFusion,
} from './fusionFiches.ts';

// Lancé par `npm test` (node --test, sans aucune dépendance à installer).
// Fonction pure : ni React, ni réseau, ni base.

const LEAD: LeadIg = { id: 'lead-1', ig_username: 'incogniton.734' };
const PROSPECT: ProspectPourFusion = { id: 'pros-1', name: 'Leroy', email: 'leroy@gmail.com' };

function call(over: Partial<CallPourFusion> = {}): CallPourFusion {
  return {
    id: 'c1', ig_lead_id: null, prospect_id: null,
    invitee_email: null, ignored: false, call_type: 'calendly',
    ...over,
  };
}

// ── Le pont : l'e-mail partagé ────────────────────────────────────────────────

test('un e-mail des deux côtés fait un doublon soupçonné', () => {
  const d = detecterDoublons({
    leads: [LEAD],
    prospects: [PROSPECT],
    calls: [
      call({ id: 'a', ig_lead_id: 'lead-1', invitee_email: 'leroy@gmail.com' }),
      call({ id: 'b', prospect_id: 'pros-1', invitee_email: 'leroy@gmail.com' }),
    ],
  });
  assert.equal(d.length, 1);
  assert.equal(d[0].igUsername, 'incogniton.734');
  assert.equal(d[0].prospectNom, 'Leroy');
  assert.deepEqual(d[0].callIds, ['b'], 'seul le call côté prospect bougerait');
});

test('sans e-mail commun, aucun doublon', () => {
  const d = detecterDoublons({
    leads: [LEAD],
    prospects: [PROSPECT],
    calls: [
      call({ id: 'a', ig_lead_id: 'lead-1', invitee_email: 'autre@gmail.com' }),
      call({ id: 'b', prospect_id: 'pros-1', invitee_email: 'leroy@gmail.com' }),
    ],
  });
  assert.deepEqual(d, []);
});

test('la casse et les espaces ne cachent pas un doublon', () => {
  const d = detecterDoublons({
    leads: [LEAD],
    prospects: [{ ...PROSPECT, email: '  LEROY@Gmail.com ' }],
    calls: [
      call({ id: 'a', ig_lead_id: 'lead-1', invitee_email: 'leroy@gmail.com' }),
      call({ id: 'b', prospect_id: 'pros-1', invitee_email: 'leroy@gmail.com' }),
    ],
  });
  assert.equal(d.length, 1);
  assert.equal(d[0].email, 'leroy@gmail.com', 'l’adresse montrée est normalisée');
});

// ── Un lead a PLUSIEURS adresses ──────────────────────────────────────────────
// Vérifié en base : incogniton.734 a réservé sous deux adresses différentes.
// Ne retenir que la première en raterait la moitié.

test('un lead qui a réservé sous deux adresses : les deux comptent', () => {
  const d = detecterDoublons({
    leads: [LEAD],
    prospects: [{ id: 'pros-2', name: 'Second', email: 'jsjdj@mail.com' }],
    calls: [
      call({ id: 'a', ig_lead_id: 'lead-1', invitee_email: 'drgdrgdrg315@gmail.com' }),
      call({ id: 'b', ig_lead_id: 'lead-1', invitee_email: 'jsjdj@mail.com' }),
      call({ id: 'c', prospect_id: 'pros-2', invitee_email: 'jsjdj@mail.com' }),
    ],
  });
  assert.equal(d.length, 1, 'la 2e adresse du lead fait le pont');
  assert.equal(d[0].email, 'jsjdj@mail.com');
});

// ── Les décisions déjà prises se taisent ──────────────────────────────────────

test('une paire refusée ne revient jamais', () => {
  const base = {
    leads: [LEAD],
    prospects: [PROSPECT],
    calls: [
      call({ id: 'a', ig_lead_id: 'lead-1', invitee_email: 'leroy@gmail.com' }),
      call({ id: 'b', prospect_id: 'pros-1', invitee_email: 'leroy@gmail.com' }),
    ],
  };
  assert.equal(detecterDoublons(base).length, 1);

  const apres = detecterDoublons({
    ...base,
    decisions: [{ ig_lead_id: 'lead-1', prospect_id: 'pros-1', statut: 'refusee' }],
  });
  assert.deepEqual(apres, [], 'reposer une question tranchée est du bruit permanent');
});

test('une paire déjà fusionnée ne se represente pas', () => {
  const d = detecterDoublons({
    leads: [LEAD],
    prospects: [PROSPECT],
    calls: [
      call({ id: 'a', ig_lead_id: 'lead-1', invitee_email: 'leroy@gmail.com' }),
      call({ id: 'b', prospect_id: 'pros-1', invitee_email: 'leroy@gmail.com' }),
    ],
    decisions: [{ ig_lead_id: 'lead-1', prospect_id: 'pros-1', statut: 'fusionnee' }],
  });
  assert.deepEqual(d, []);
});

// ── Les règles projet sur `calls` ─────────────────────────────────────────────

test('un call ignoré ne fait pas le pont', () => {
  const d = detecterDoublons({
    leads: [LEAD],
    prospects: [PROSPECT],
    calls: [
      call({ id: 'a', ig_lead_id: 'lead-1', invitee_email: 'leroy@gmail.com', ignored: true }),
      call({ id: 'b', prospect_id: 'pros-1', invitee_email: 'leroy@gmail.com' }),
    ],
  });
  assert.deepEqual(d, [], 'ignored is not true, règle projet');
});

test('un call de coaching ne fait pas le pont', () => {
  const d = detecterDoublons({
    leads: [LEAD],
    prospects: [PROSPECT],
    calls: [
      call({ id: 'a', ig_lead_id: 'lead-1', invitee_email: 'leroy@gmail.com', call_type: 'google' }),
      call({ id: 'b', prospect_id: 'pros-1', invitee_email: 'leroy@gmail.com' }),
    ],
  });
  assert.deepEqual(d, [], 'call_type explicite : "calendly" = vente');
});

// ── Rien à déplacer = rien à proposer ─────────────────────────────────────────

test('un prospect dont les calls sont déjà rattachés ne se propose plus', () => {
  const d = detecterDoublons({
    leads: [LEAD],
    prospects: [PROSPECT],
    calls: [
      call({ id: 'a', ig_lead_id: 'lead-1', invitee_email: 'leroy@gmail.com' }),
      // Ce call porte les DEUX : il a déjà rejoint le lead. Le proposer à la
      // fusion offrirait un bouton qui ne ferait rien.
      call({ id: 'b', prospect_id: 'pros-1', ig_lead_id: 'lead-1', invitee_email: 'leroy@gmail.com' }),
    ],
  });
  assert.deepEqual(d, []);
});

test('aucun lead n’a jamais réservé : aucun pont possible', () => {
  const d = detecterDoublons({
    leads: [LEAD],
    prospects: [PROSPECT],
    calls: [call({ id: 'b', prospect_id: 'pros-1', invitee_email: 'leroy@gmail.com' })],
  });
  assert.deepEqual(d, [], 'on n’apprend l’adresse d’un lead que par ses calls');
});

test('un prospect sans e-mail est ignoré, pas rapproché au hasard', () => {
  const d = detecterDoublons({
    leads: [LEAD],
    prospects: [{ id: 'pros-3', name: 'Sans adresse', email: null }],
    calls: [
      call({ id: 'a', ig_lead_id: 'lead-1', invitee_email: 'leroy@gmail.com' }),
      call({ id: 'b', prospect_id: 'pros-3', invitee_email: null }),
    ],
  });
  assert.deepEqual(d, []);
});
