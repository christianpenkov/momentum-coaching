import Stripe from 'stripe';
import { noterEtatStripe } from './stripe-panne';
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
  /**
   * À qui appartient cette connexion.
   *
   * Porté ici plutôt que passé en paramètre à chaque fonction : `appelStripe`
   * en a besoin pour savoir sur quelle ligne déclarer une panne, et le faire
   * remonter par les signatures aurait touché une dizaine de fonctions dont
   * certaines n'ont aucune autre raison de connaître le profil.
   */
  profileId: string;
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
      profileId,
    };
  }

  if (integ.api_key) {
    return {
      stripe: new Stripe(integ.api_key, { apiVersion: API_VERSION }),
      opts: {},
      accountId: null,
      mode: 'apikey',
      profileId,
    };
  }

  return null;
}

/**
 * Tout appel Stripe passe par ici, et c'est ce qui rend les pannes visibles.
 *
 * ── Pourquoi un passage obligé plutôt qu'un `catch` par endroit ────────────
 * Déclarer la panne dans chaque `catch` marche le jour où on l'écrit, et se
 * dégrade à chaque nouvel appel ajouté par quelqu'un qui n'y pense pas. Ici la
 * règle est portée par la fonction qu'on appelle de toute façon : l'oublier
 * demande de ne pas s'en servir, ce qui se voit en relecture.
 *
 * ── Ce qu'elle ne change pas ──────────────────────────────────────────────
 * L'erreur est TOUJOURS relancée. Cette fonction observe, elle n'intercepte
 * rien : l'appelant garde exactement le contrôle qu'il avait, avec ses propres
 * messages et ses propres replis.
 *
 *     const lien = await appelStripe(access, () =>
 *       access.stripe.paymentLinks.create({ … }, access.opts));
 */
export async function appelStripe<T>(
  access: StripeAccess,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    const r = await fn();
    // Le succès lève une panne déclarée : sans ça, un élève qui reconnecte
    // Stripe garderait un bandeau rouge jusqu'au prochain passage du cron.
    void noterEtatStripe(access.profileId, { ok: true });
    return r;
  } catch (err) {
    void noterEtatStripe(access.profileId, { ok: false, err });
    throw err;
  }
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
