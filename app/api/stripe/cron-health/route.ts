import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getStripeAccess, appelStripe } from '@/lib/stripe-account';

/**
 * Le battement de cœur des connexions Stripe.
 *
 * ── Pourquoi une route dédiée et pas le cron Stripe existant ───────────────
 * `sync-stripe-payments` semblait le lieu évident : c'est le cron Stripe, il
 * tourne déjà, et l'y greffer évitait un job de plus sur cron-job.org. Deux
 * faits l'ont écarté.
 *
 * D'abord il ne traite QUE les comptes en clé restreinte (`access_token IS
 * NULL`) — précisément l'inverse de ceux qu'on cherche à surveiller. Ensuite et
 * surtout, il tourne en Deno et n'a pas `STRIPE_SECRET_KEY` dans ses secrets :
 * sans la clé plateforme, il ne PEUT pas appeler Stripe au nom d'un compte
 * OAuth. L'y ajouter aurait donc coûté une manipulation dans la console
 * Supabase — la même nature d'étape manuelle qu'un job de plus — et, en prime,
 * une seconde copie en Deno de la règle « quelles erreurs valent une panne ».
 *
 * ── Pourquoi ce ping existe ────────────────────────────────────────────────
 * Les appels Stripe des écrans de paiement déclarent déjà les pannes, mais ils
 * ne s'exécutent que lorsque l'élève agit sur une vente. Si sa connexion meurt
 * un lundi et qu'il ne corrige rien pendant trois semaines, le bandeau de santé
 * reste vert trois semaines.
 *
 * Et rien d'autre ne parle à Stripe pour lui : `account.application.deauthorized`
 * ne couvre que la déconnexion volontaire. Un compte restreint par Stripe, ou
 * une clé révoquée, n'émet aucun événement.
 *
 * ── Ce qu'il ne fait pas ───────────────────────────────────────────────────
 * Il n'écrit rien lui-même : `appelStripe` s'en charge, avec exactement la même
 * règle que les écrans. Une seule définition de « panne », deux déclencheurs.
 *
 * Appel : cron-job.org, `Authorization: Bearer ${CRON_SECRET}`, une fois par jour.
 */

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/**
 * L'appel le plus léger qui prouve que la connexion vit.
 *
 * `balance.retrieve` plutôt qu'une liste : il ne lit aucune donnée métier, ne
 * paginate pas, et échoue exactement de la même façon qu'un vrai appel quand la
 * clé est morte ou la permission retirée.
 */
async function pinger(profileId: string): Promise<'ok' | 'panne' | 'sans_connexion'> {
  const access = await getStripeAccess(profileId);
  if (!access) return 'sans_connexion';
  try {
    await appelStripe(access, () => access.stripe.balance.retrieve({}, access.opts));
    return 'ok';
  } catch {
    // `appelStripe` a déjà tranché entre panne de connexion et simple hoquet, et
    // écrit — ou non — sur la ligne d'intégration. Ici on ne fait que compter.
    return 'panne';
  }
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const { data: integrations, error } = await supa
    .from('integrations')
    .select('profile_id')
    .eq('provider', 'stripe');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!integrations?.length) return NextResponse.json({ ok: true, testes: 0 });

  // Séquentiel, et c'est volontaire : un appel par élève et par jour ne justifie
  // aucune parallélisation, et rien ne presse. À 40 élèves, 40 appels étalés
  // restent invisibles pour Stripe — là où une rafale entrerait en concurrence
  // avec les vrais paiements du moment.
  let vivantes = 0, pannes = 0, sansConnexion = 0;
  for (const { profile_id } of integrations) {
    const r = await pinger(profile_id);
    if (r === 'ok') vivantes++;
    else if (r === 'panne') pannes++;
    else sansConnexion++;
  }

  return NextResponse.json({
    ok: true,
    testes: integrations.length,
    vivantes,
    pannes,
    sansConnexion,
  });
}
