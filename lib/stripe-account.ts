import Stripe from 'stripe';
import { createClient as createServiceClient } from '@supabase/supabase-js';

const serviceSupabase = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Deux chemins de connexion Stripe coexistent (cf. mode 'both' de
 * lib/onboarding/integrationConfig.ts), et ils s'appellent différemment :
 *
 *   OAuth Connect  → on utilise NOTRE clé plateforme + l'en-tête Stripe-Account
 *                    portant l'acct_xxx du compte connecté. C'est le chemin par
 *                    défaut : révocable côté utilisateur, et seul à débloquer le
 *                    webhook Connect (event.account → account_label → profile_id).
 *
 *   Clé restreinte → la clé EST celle du compte, pas d'en-tête à poser. Repli
 *                    nécessaire pour les comptes Standard déjà contrôlés par une
 *                    autre plateforme (Kajabi, Systeme.io…) que l'OAuth read_write
 *                    ne peut pas atteindre depuis juin 2021.
 *
 * Toute la suite du code appelle Stripe via `stripe` + `opts` sans avoir à savoir
 * lequel des deux est en place.
 */
export interface StripeAccess {
  stripe: Stripe;
  /** À passer en 2e argument de chaque appel Stripe. Vide en mode clé. */
  opts: Stripe.RequestOptions;
  /** acct_xxx si OAuth, null si clé restreinte. */
  accountId: string | null;
  mode: 'oauth' | 'apikey';
}

// Même version que le reste du code (app/api/stripe/client-data, validate-key).
const API_VERSION = '2026-04-22.dahlia';

export async function getStripeAccess(profileId: string): Promise<StripeAccess | null> {
  const { data: integ } = await serviceSupabase
    .from('integrations')
    .select('access_token, api_key, account_label')
    .eq('profile_id', profileId)
    .eq('provider', 'stripe')
    .maybeSingle();

  if (!integ) return null;

  // OAuth prime : le callback efface api_key en s'installant, et inversement.
  // Les deux ne peuvent donc pas coexister — mais on ordonne quand même par
  // sûreté, pour qu'une donnée héritée ne rende pas le comportement ambigu.
  if (integ.access_token && integ.account_label?.startsWith('acct_')) {
    return {
      stripe: new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: API_VERSION }),
      opts: { stripeAccount: integ.account_label },
      accountId: integ.account_label,
      mode: 'oauth',
    };
  }

  if (integ.api_key) {
    return {
      stripe: new Stripe(integ.api_key, { apiVersion: API_VERSION }),
      opts: {},
      accountId: null,
      mode: 'apikey',
    };
  }

  return null;
}

/**
 * Le coach peut agir pour un de ses élèves. Renvoie le profile_id à utiliser, ou
 * null si l'appelant n'a pas le droit — même contrôle que resolveProfileId dans
 * app/api/shortio/links/route.ts.
 */
export async function resolveTargetProfile(
  userId: string,
  requestedProfileId: string | null | undefined,
): Promise<string | null> {
  if (!requestedProfileId || requestedProfileId === userId) return userId;

  const { data: clientRow } = await serviceSupabase
    .from('clients')
    .select('id')
    .eq('profile_id', requestedProfileId)
    .eq('coach_id', userId)
    .maybeSingle();

  return clientRow ? requestedProfileId : null;
}
