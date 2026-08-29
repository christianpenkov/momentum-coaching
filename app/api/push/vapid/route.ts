import { NextResponse } from 'next/server';

/**
 * Clé publique VAPID, pour le service worker.
 *
 * Elle est publique par construction : le navigateur la reçoit déjà à chaque
 * abonnement, et elle ne permet que de VÉRIFIER une signature, jamais d'en
 * produire une (la clé privée, elle, ne quitte jamais le serveur).
 *
 * Pourquoi une route plutôt qu'une constante dans `sw.js` : le worker en a
 * besoin pour se réabonner lors d'un `pushsubscriptionchange`, et une clé
 * recopiée dans un fichier statique devrait être mise à jour à la main le jour
 * d'une rotation. Ici, elle suit la variable d'environnement.
 */
export async function GET() {
  const cle = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  if (!cle) return NextResponse.json({ error: 'vapid_absente' }, { status: 500 });
  return NextResponse.json({ cle }, {
    // Courte mise en cache : la clé ne change quasiment jamais, mais une
    // rotation ne doit pas rester invisible une journée entière.
    headers: { 'Cache-Control': 'public, max-age=3600' },
  });
}
