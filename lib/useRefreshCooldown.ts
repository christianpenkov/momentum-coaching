'use client';

import { useState } from 'react';

/**
 * Bride les boutons « Rafraîchir » : 4 clics au maximum sur 2 minutes.
 *
 * ── Pourquoi une bride du tout ────────────────────────────────────────────────
 *
 * Un clic ne rafraîchit pas un écran : il déclenche QUATRE routes qui appellent des
 * API externes (Instagram, YouTube, Short.io, Calendly), exactement comme le cron.
 * Deux de ces quotas sont serrés et **partagés entre tous les élèves** :
 *
 *   • Short.io : 50 requêtes / 60 s **par DOMAINE** — et tous les élèves partagent
 *     le même domaine. Trois élèves qui rafraîchissent en même temps se disputent
 *     donc le même budget.
 *   • Calendly : 60 requêtes / minute par jeton.
 *
 * Sans bride, maintenir le clic sur ce bouton suffit à faire tomber la collecte de
 * tout le monde en 429 — y compris pour les élèves qui n'avaient rien demandé.
 *
 * ── Pourquoi 4 sur 2 minutes ──────────────────────────────────────────────────
 *
 * Assez pour l'usage réel : on clique, on regarde, on reclique si un chiffre semble
 * en retard. Assez serré pour qu'un clic nerveux ne parte pas en rafale. La valeur
 * vient de l'écran Stats, où elle tourne depuis plusieurs semaines sans qu'aucun
 * utilisateur ne l'ait signalée comme gênante.
 *
 * ⚠️ C'est une bride de CONFORT, pas une garantie : l'état vit en mémoire, donc un
 * rechargement de page le remet à zéro. La vraie protection contre le 429 est
 * ailleurs — `lib/shortio-fetch.ts` lit l'en-tête `x-ratelimit-reset` et attend le
 * délai exact avant un unique retry. Les deux se complètent : celle-ci évite la
 * rafale, celle-là encaisse ce qui passe quand même.
 *
 * ── Pourquoi ce fichier existe ────────────────────────────────────────────────
 *
 * La règle était écrite dans `PageClientStats`, et `PagePipeline` — qui déclenche
 * EXACTEMENT les quatre mêmes routes — ne l'avait pas. La recopier aurait créé deux
 * versions d'une même règle, qui finissent toujours par diverger sur ce projet.
 *
 * ⚠️ DETTE ASSUMÉE, à lever : `PageClientStats` porte encore SA PROPRE copie de cette
 * règle (`function useRefreshCooldown(_key)`, juste avant `fetchIntegrationStatus`).
 * Elle n'a pas été migrée parce que ce fichier portait, le 2026-09-06, le travail NON
 * COMMITÉ d'une autre session — on ne mélange pas deux chantiers dans un même fichier.
 *
 * Les deux implémentations sont identiques au mot près aujourd'hui. Dès que
 * `PageClientStats` est libre : supprimer la copie locale, importer celle-ci, et
 * remplacer `useRefreshCooldown(refreshKey)` par `useRefreshCooldown()` — l'argument
 * n'a jamais été lu.
 */
export function useRefreshCooldown() {
  const [clics, setClics] = useState<number[]>([]);
  const MAX_CLICS = 4;
  const FENETRE_MS = 2 * 60 * 1000;

  const recents = () => clics.filter(t => Date.now() - t < FENETRE_MS);

  return {
    /** Vrai quand le bouton doit être grisé. */
    inCooldown: recents().length >= MAX_CLICS,
    /**
     * À appeler APRÈS un rafraîchissement qui a effectivement abouti.
     *
     * ⚠️ Jamais avant, et jamais sur un échec total : sinon un utilisateur hors ligne
     * se retrouverait bloqué sans avoir rien obtenu — le défaut corrigé sur l'écran
     * Stats, dont le commentaire dit « le bouton reprenait son état normal ET un
     * cooldown se déclenchait, bloquant l'utilisateur alors que rien n'avait été
     * rafraîchi ».
     */
    startCooldown: () => {
      const maintenant = Date.now();
      setClics(prev => [...prev.filter(t => maintenant - t < FENETRE_MS), maintenant]);
    },
  };
}
