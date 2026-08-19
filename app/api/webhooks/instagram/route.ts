import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { processWebhookEntry } from '@/lib/instagram-webhook-processor';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const VERIFY_TOKEN = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN!;
const APP_SECRET = process.env.INSTAGRAM_CLIENT_SECRET!;

function verifySignature(body: string, signature: string | null): boolean {
  if (!signature || !APP_SECRET) return false;
  const expected = 'sha256=' + crypto
    .createHmac('sha256', APP_SECRET)
    .update(body)
    .digest('hex');
  try {
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, expBuf);
  } catch { return false; }
}

// GET — handshake de vérification Meta
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[IG Webhook] Vérification réussie');
    return new Response(challenge, { status: 200 });
  }

  return new Response('Verification failed', { status: 403 });
}

// POST — events entrants Meta
/**
 * Point d'entrée du webhook Meta.
 *
 * Rôle réduit à l'essentiel : vérifier la signature, METTRE EN FILE, répondre
 * 200. Objectif < 100 ms.
 *
 * Meta exige une réponse en moins de 30 s et DÉSABONNE l'application si les
 * échecs durent 1 h — les DM1 s'arrêtent alors complètement, avec réabonnement
 * manuel. Le traitement synchrone mesurait 2,15 s de moyenne mais 15,55 s au
 * pic, avec UN SEUL compte actif : à 30 élèves, Meta envoyant une requête HTTP
 * par commentaire en parallèle, un post viral suffisait à franchir les 30 s.
 *
 * Le traitement réel vit dans `lib/instagram-webhook-processor.ts`, appelé par
 * le worker `app/api/cron/process-webhook-queue`.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get('x-hub-signature-256');

  // Signature obligatoire en prod — si APP_SECRET manque, on rejette pour éviter des DMs forgés
  if (!APP_SECRET) {
    console.error('[IG Webhook] APP_SECRET manquant — rejet');
    return NextResponse.json({ error: 'Configuration manquante' }, { status: 500 });
  }
  if (!verifySignature(rawBody, signature)) {
    console.error('[IG Webhook] Signature invalide');
    return NextResponse.json({ error: 'Signature invalide' }, { status: 401 });
  }

  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 });
  }

  const entries: unknown[] = body?.entry || [];

  // Une ligne PAR ENTRY plutôt qu'une pour le body entier : un entry lent
  // (compte à résoudre, média à télécharger) ne retarde pas les autres, et un
  // échec ne fait pas rejouer ceux qui ont réussi.
  if (entries.length) {
    const { error } = await serviceSupabase
      .from('webhook_queue')
      .insert(entries.map(entry => ({ source: 'instagram', payload: entry })));

    if (error) {
      // Mise en file impossible : on traite en direct plutôt que de perdre
      // l'événement. Meta n'autorise qu'UN private reply par commentaire — un
      // événement perdu l'est définitivement. Le risque de dépasser 30 s est
      // préférable à la perte certaine.
      console.error('[IG Webhook] Mise en file échouée, traitement direct:', error.message);
      try {
        for (const entry of entries) await processWebhookEntry(entry);
      } catch (e: any) {
        console.error('[IG Webhook] Traitement direct échoué:', e?.message || e);
      }
    }
  }

  // 200 immédiat : Meta est satisfait quoi qu'il advienne du traitement.
  return NextResponse.json({ received: true, queued: entries.length });
}
