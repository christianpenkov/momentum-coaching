'use client';

/**
 * Les trois réglages à vérifier dans Fathom une fois le compte connecté.
 *
 * POURQUOI un composant et pas du texte dans les pages : coach et élève
 * affichent exactement la même chose, et la version précédente était recopiée
 * dans PageSettings.tsx et PageClientSettings.tsx. Deux copies d'un texte que
 * personne ne relit, c'est deux textes qui finissent par diverger — le fichier
 * lib/onboarding/integrationConfig.ts pose déjà cette règle pour les libellés
 * d'intégration ; on la suit ici.
 *
 * POURQUOI ces trois points précisément : chacun couvre une panne SILENCIEUSE.
 * Aucun ne remonte d'erreur chez nous, parce qu'un call sans replay est
 * indistinguable d'un call qui n'a pas eu lieu :
 *
 *   1. Auto-Record ≠ « All Meetings »   → le bot ne rejoint jamais.
 *   2. Logiciel visio non branché       → le bot ne peut pas entrer dans l'appel.
 *   3. Partage restreint                → le replay existe, mais l'AUTRE
 *      participant tombe sur un mur de connexion en ouvrant « Voir sur Fathom ».
 *
 * Le point 3 est le moins intuitif et le plus coûteux : il ne se voit pas depuis
 * le compte qui a enregistré (qui, lui, a toujours accès), seulement depuis
 * l'autre. Sans lui, le partage automatique entre coach et élève ne marche pas.
 *
 * Les trois vivent sur la MÊME page (fathom.video/customize) et sont listés dans
 * l'ordre où on les croise en descendant, pour qu'on puisse suivre sans remonter.
 */

const ETAPES = [
  {
    section: 'Auto-Record Settings',
    ou: 'tout en haut',
    quoi: <>choisis <strong>« All Meetings »</strong> dans le premier menu déroulant.</>,
    pourquoi: 'Fathom rejoint alors tous tes calls sans que tu aies à lancer l\'enregistrement.',
  },
  {
    section: 'Video Conferencing',
    ou: 'plus bas',
    quoi: <>ton logiciel d&apos;appel (Zoom, Google Meet ou Microsoft Teams) doit afficher <strong>« Fully Enabled »</strong> en vert, avec tous ses interrupteurs activés.</>,
    pourquoi: 'S\'il n\'est pas branché, Fathom ne peut pas entrer dans l\'appel.',
  },
  {
    section: 'Options → Default Share Link Access',
    ou: 'tout en bas',
    quoi: <>choisis <strong>« Anyone with the link can view »</strong>.</>,
    pourquoi: 'C\'est ce qui permet à l\'autre participant du call d\'ouvrir le replay. Avec « Only people added can view », il tombe sur un mur de connexion.',
  },
];

export default function FathomSetupHint() {
  return (
    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, lineHeight: 1.5 }}>
      Pour que Fathom rejoigne tes calls et que le replay soit partagé, ouvre{' '}
      <a
        href="https://fathom.video/customize"
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: 'var(--accent)', textDecoration: 'underline' }}
      >
        fathom.video/customize
      </a>
      {' '}et vérifie ces trois points :

      <ol style={{ margin: '6px 0 0', paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 5 }}>
        {ETAPES.map(e => (
          <li key={e.section}>
            <span style={{ color: 'var(--ink-2)', fontWeight: 600 }}>{e.section}</span>
            <span style={{ opacity: 0.7 }}> ({e.ou})</span> — {e.quoi}
            {' '}
            <span style={{ opacity: 0.8 }}>{e.pourquoi}</span>
          </li>
        ))}
      </ol>

      <div style={{ marginTop: 6 }}>
        Ton agenda Google ou Microsoft doit aussi être connecté à Fathom, sinon il ne voit pas
        tes calls planifiés et ne peut pas les rejoindre.
      </div>
    </div>
  );
}
