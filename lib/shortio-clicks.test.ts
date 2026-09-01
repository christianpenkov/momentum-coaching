import test from 'node:test';
import assert from 'node:assert/strict';
import { agregerClics, cleClic, hoteDuLien } from './shortio-clicks.ts';

const jourDe = (iso: string) => iso.slice(0, 10);
// `st` est obligatoire : estVraiClic écarte tout ce qui n'a pas un statut < 400,
// donc une fixture sans statut n'est pas un clic « incomplet » mais un clic REJETÉ.
const clic = (path: string, dt: string, human = true) => ({ path, dt, human, st: 200 });

// ── Le domaine fait partie de l'identité d'un lien ──────────────────────────
//
// Un élève qui change de domaine Short.io garde le MÊME chemin sur les deux. Ce sont
// deux liens distincts, avec deux link_id et deux comptes de clics distincts.
// Mesuré le 2026-09-01 : sans le domaine dans la clé, `bio-calendly-ig` portait 15
// clics sur CHACUN des deux domaines, soit 30 en base pour 15 requêtes reçues.

test('deux domaines partageant un chemin ne se mélangent pas', () => {
  const a = agregerClics(
    [clic('bio-calendly-ig', '2026-09-01T10:00:00Z'), clic('bio-calendly-ig', '2026-09-01T11:00:00Z')],
    jourDe, 'link.ubizenai.com',
  );
  const b = agregerClics([], jourDe, 'ubizenai.s.gy');

  const fusion = new Map(a.parPathEtJour);
  for (const [k, v] of b.parPathEtJour) fusion.set(k, v);

  assert.equal(fusion.get(cleClic('link.ubizenai.com', 'bio-calendly-ig', '2026-09-01'))?.total, 2);
  // Le lien dormant de l'ancien domaine ne doit RIEN recevoir. C'est tout le défaut :
  // il héritait du trafic du lien publié.
  assert.equal(fusion.get(cleClic('ubizenai.s.gy', 'bio-calendly-ig', '2026-09-01')), undefined);
});

test('un même chemin sur deux domaines produit deux clés distinctes', () => {
  assert.notEqual(
    cleClic('link.ubizenai.com', 'bio-calendly-ig', '2026-09-01'),
    cleClic('ubizenai.s.gy', 'bio-calendly-ig', '2026-09-01'),
  );
});

test('les compteurs humains et totaux restent séparés', () => {
  const { parPathEtJour } = agregerClics(
    [
      clic('p', '2026-09-01T10:00:00Z', true),
      clic('p', '2026-09-01T10:01:00Z', false),
      clic('p', '2026-09-01T10:02:00Z', false),
    ],
    jourDe, 'd.test',
  );
  assert.deepEqual(parPathEtJour.get(cleClic('d.test', 'p', '2026-09-01')), { human: 1, total: 3 });
});

test('hoteDuLien lit l’hôte de l’URL courte, et retombe sur le défaut', () => {
  // Les deux côtés de la clé doivent produire la même chaîne : le côté écriture
  // connaît son domaine, le côté lecture ne dispose que du lien.
  assert.equal(hoteDuLien('https://link.ubizenai.com/bio-calendly-ig', 'x'), 'link.ubizenai.com');
  assert.equal(hoteDuLien('https://ubizenai.s.gy/bio-calendly-ig', 'x'), 'ubizenai.s.gy');
  assert.equal(hoteDuLien(null, 'defaut.test'), 'defaut.test');
  assert.equal(hoteDuLien('pas une url', 'defaut.test'), 'defaut.test');
});

test('un clic en erreur ne compte pas', () => {
  // Une redirection qui a échoué n'est pas un clic : Short.io la renvoie quand même
  // dans le flux, avec son statut.
  const { parPathEtJour } = agregerClics(
    [{ path: 'p', dt: '2026-09-01T10:00:00Z', human: true, st: 404 }],
    jourDe, 'd.test',
  );
  assert.equal(parPathEtJour.get(cleClic('d.test', 'p', '2026-09-01')), undefined);
});

test('le jour le plus ancien vu compte le bruit, pas seulement les vrais clics', () => {
  // Il borne les journées qu'on s'autorise à réécrire : du bruit prouve tout autant
  // que le flux couvrait ce jour-là.
  const { jourLePlusAncienVu } = agregerClics(
    [{ path: '*', dt: '2026-08-28T10:00:00Z', human: false, st: 404 }, clic('p', '2026-09-01T10:00:00Z')],
    jourDe, 'd.test',
  );
  assert.equal(jourLePlusAncienVu, '2026-08-28');
});
