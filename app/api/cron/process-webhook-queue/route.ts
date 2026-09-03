import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { processWebhookEntry } from '@/lib/instagram-webhook-processor';

/**
 * Worker de la file d'attente des webhooks Instagram.
 *
 * Le webhook Meta ne fait plus que mettre en file et répondre 200 en < 100 ms
 * (Meta exige < 30 s et DÉSABONNE l'application après 1 h d'échecs). C'est ici
 * que le traitement réel a lieu, à cadence maîtrisée.
 *
 * Route Next.js et non Edge Function Deno : le traitement (`processWebhookEntry`)
 * vit dans le code Next et ne peut pas être importé côté Deno. Appelée par
 * pg_cron via pg_net, comme les autres crons du projet.
 *
 * Cadence : chaque minute. Un lot de 20 événements, traités 5 par 5.
 */

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Budget d'exécution volontairement conservateur.
 *
 * Vercel coupe la fonction à `maxDuration` sans laisser le temps de marquer les
 * lignes : celles restées en 'processing' seraient bloquées. On arrête donc de
 * prendre de nouveaux événements bien avant la limite, quitte à laisser le reste
 * au passage suivant (une minute plus tard).
 */
export const maxDuration = 60;
const TIME_BUDGET_MS = 45_000;

/** Lot réservé par passage. 20 × ~2 s ≈ 40 s dans le pire cas séquentiel. */
const BATCH_SIZE = 20;

/**
 * Traitements simultanés. Ces événements partagent le quota Meta et Short.io :
 * au-delà de 5, on reproduit exactement la rafale que la file sert à éviter.
 */
const CONCURRENCY = 5;

/**
 * Abandon après 5 tentatives.
 *
 * Un événement qui échoue 5 fois d'affilée ne réussira pas à la 6e : c'est un
 * commentaire dont le compte a été déconnecté, un token révoqué, ou un cas non
 * prévu. Le réessayer indéfiniment ferait tourner le worker à vide et retarderait
 * les événements sains derrière lui.
 */
const MAX_ATTEMPTS = 5;

export async function GET(request: Request) {
  const auth = request.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  // Filigrane de passage : la preuve que ce cron est encore INVOQUE.
  //
  // Pose AU PLUS TOT, juste apres l'authentification, et non a la fin — meme raison
  // que dans notify-rapport, dont ce bloc est la copie : `crons_sante` repond a « le
  // planificateur appelle-t-il encore cette URL ? », et un echec pendant l'execution
  // est deja couvert par `cron_runs`.
  //
  // ⚠️ POURQUOI CE CRON-CI AVAIT ETE OUBLIE. Il est declenche par pg_cron via
  // `net.http_post`, qui est ASYNCHRONE : il met la requete en file et rend son
  // identifiant immediatement. `cron.job_run_details` enregistre donc le succes de
  // l'INSTRUCTION SQL, jamais celui de l'appel HTTP. Mesure du 2026-09-03 : 10 858
  // passages, 100 % « succeeded », message uniforme « 1 row » — la valeur de retour de
  // net.http_post. Si cette fonction etait supprimee, repondait 500, ou si son secret
  // ne correspondait plus, ces lignes diraient EXACTEMENT la meme chose.
  //
  // `net._http_response` porte bien les vrais codes HTTP, mais pg_net la purge : 5 h 58
  // d'historique au moment de la mesure. Utilisable pour corroborer une enquete a
  // chaud, inutilisable pour une alerte quotidienne.
  //
  // Le seuil de silence vit sur la LIGNE (`crons_passages.silence_max`), pas ici.
  // Strictement non bloquant : un filigrane muet vaut mieux qu'un cron qui tombe.
  try {
    const { error: filigraneErr } = await serviceSupabase.rpc('marquer_passage_cron', { p_nom: 'process-webhook-queue' });
    if (filigraneErr) console.error('[process-webhook-queue] filigrane de passage:', filigraneErr.message);
  } catch (e) { console.error('[process-webhook-queue] filigrane de passage:', e); }

  const startedAt = Date.now();

  // Réservation ATOMIQUE (FOR UPDATE SKIP LOCKED côté SQL) : deux workers qui se
  // chevauchent ne peuvent pas réserver la même ligne. Sans ça, un commentaire
  // déclencherait deux DM1 — et Meta n'autorise qu'un private reply par
  // commentaire, définitivement.
  const { data: claimed, error: claimErr } = await serviceSupabase
    .rpc('claim_webhook_queue', { p_limit: BATCH_SIZE });

  if (claimErr) {
    return NextResponse.json({ error: claimErr.message }, { status: 500 });
  }
  if (!claimed?.length) {
    return NextResponse.json({ ok: true, processed: 0, failed: 0 });
  }

  let processed = 0;
  let failed = 0;
  let abandoned = 0;
  const errors: string[] = [];

  // Traitement par vagues de CONCURRENCY, en respectant le budget de temps.
  for (let i = 0; i < claimed.length; i += CONCURRENCY) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      // Budget épuisé : on rend les lignes non traitées à la file plutôt que de
      // les laisser bloquées en 'processing'. Elles repartiront au passage suivant.
      const remaining = claimed.slice(i).map((r: { id: number }) => r.id);
      await serviceSupabase.from('webhook_queue')
        .update({ status: 'pending' })
        .in('id', remaining);
      break;
    }

    const slice = claimed.slice(i, i + CONCURRENCY);
    await Promise.all(slice.map(async (row: {
      id: number; payload: unknown; attempts: number;
    }) => {
      try {
        await processWebhookEntry(row.payload);
        await serviceSupabase.from('webhook_queue')
          .update({ status: 'done', processed_at: new Date().toISOString(), last_error: null })
          .eq('id', row.id);
        processed++;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`#${row.id}: ${msg}`);

        if (row.attempts >= MAX_ATTEMPTS) {
          await serviceSupabase.from('webhook_queue')
            .update({ status: 'failed', processed_at: new Date().toISOString(), last_error: msg })
            .eq('id', row.id);
          abandoned++;
        } else {
          // Backoff exponentiel avec jitter : 1, 2, 4, 8, 16 min (± 30 s). Le
          // jitter évite que plusieurs échecs simultanés (panne Meta, token
          // expiré sur un compte) ne repartent tous à la même seconde.
          const delayMs = Math.min(2 ** row.attempts, 16) * 60_000
            + Math.random() * 30_000;
          await serviceSupabase.from('webhook_queue')
            .update({
              status: 'pending',
              last_error: msg,
              next_retry_at: new Date(Date.now() + delayMs).toISOString(),
            })
            .eq('id', row.id);
          failed++;
        }
      }
    }));
  }

  return NextResponse.json({
    ok: true,
    claimed: claimed.length,
    processed,
    retried: failed,
    abandoned,
    elapsed_ms: Date.now() - startedAt,
    errors: errors.slice(0, 5),
  });
}
