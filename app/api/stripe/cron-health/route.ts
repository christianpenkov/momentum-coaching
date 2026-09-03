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
 * La raison qui tient : l'y porter aurait coûté une seconde copie en Deno de
 * `getStripeAccess`, d'`appelStripe` et de la règle « quelles erreurs valent une
 * panne » — le mode de panne dominant de ce projet, une copie figée qui périme
 * sans que rien ne bouge.
 *
 * ⚠️ Une autre raison figurait ici et a EXPIRÉ (corrigée le 2026-09-04) : « il ne
 * traite que les comptes en clé restreinte ». Faux depuis le 2026-08-30 —
 * sync-stripe-payments couvre AUSSI l'OAuth, son propre en-tête le crie. Retirée
 * plutôt que laissée : une justification fausse coûte plus cher qu'une absente.
 *
 * ⚠️ Une troisième raison figurait ici et a EXPIRÉ : « il n'a pas `STRIPE_SECRET_KEY`
 * dans ses secrets ». C'était vrai à l'écriture ; la clé est posée côté Edge Functions
 * depuis le 2026-08-31. Retirée le 2026-09-01 plutôt que laissée : une justification
 * fausse coûte plus cher qu'une justification absente.
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

  // ── Le detecteur doit se surveiller lui-meme ──────────────────────────────
  //
  // Cette route n'ecrit RIEN quand tout va bien : c'est `appelStripe` qui declare
  // une panne, et seulement en cas d'echec. Un silence en base ne distingue donc pas
  // « tout va bien » de « le cron ne tourne plus » — job supprime, secret change,
  // route en 500. La seule preuve de vie etait le corps de la reponse dans
  // cron-job.org, qu'il aurait fallu aller lire a la main. C'est de la maintenance,
  // l'inverse de l'objectif.
  //
  // On horodate donc chaque passage, SUCCES OU ECHEC — un compte en panne doit
  // continuer a prouver que le ping tourne, sinon une vraie panne masquerait
  // l'absence de surveillance. La vue `integrations_sante` signale ensuite un ping
  // trop vieux, au meme endroit que les autres integrations.
  //
  // `last_synced_at` et non `metadata.stripe_synced_at` : cette derniere est la borne
  // de synchronisation de `sync-stripe-payments` (tous les comptes, cle restreinte
  // ET OAuth depuis le 2026-08-30). Les deux champs ne doivent jamais se confondre :
  // le battement de l'un masquerait la mort de l'autre.
  const { error: pingErr } = await supa
    .from('integrations')
    .update({ last_synced_at: new Date().toISOString() })
    .eq('provider', 'stripe')
    .in('profile_id', integrations.map(i => i.profile_id));
  if (pingErr) console.error('[stripe/cron-health] horodatage du ping:', pingErr.message);

  return NextResponse.json({
    ok: true,
    testes: integrations.length,
    vivantes,
    pannes,
    sansConnexion,
  });
}
