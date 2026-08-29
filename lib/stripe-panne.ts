import { createClient as createServiceClient } from '@supabase/supabase-js';

/**
 * Déclarer — ou lever — une panne d'intégration Stripe.
 *
 * ── Pourquoi ce fichier existe ─────────────────────────────────────────────
 * Le bandeau de santé en haut de « Mes Stats » sait afficher Stripe en rouge,
 * mais rien n'écrivait jamais `integrations.status = 'failed'` pour ce
 * fournisseur. Instagram le faisait déjà, parce que `ig-fetch.ts` appelle
 * lui-même le rafraîchissement de jeton et voit donc le refus. Côté Stripe,
 * `getStripeAccess` ne fait que lire des identifiants et construire un client :
 * il n'appelle jamais Stripe, il ne peut rien constater. Le refus n'apparaît
 * qu'aux points d'appel.
 *
 * ── La distinction qui fait tout ───────────────────────────────────────────
 * Un bandeau qui s'allume à tort est pire qu'un bandeau absent : on apprend à
 * l'ignorer, et le jour où il a raison, plus personne ne le lit. Seul un refus
 * qui persistera à la prochaine tentative mérite d'y figurer.
 *
 * D'où la règle : **la connexion est-elle morte, ou l'appel a-t-il seulement
 * échoué ?** Un jeton révoqué est mort — réessayer ne changera rien. Un 429, un
 * 500 ou une carte refusée n'ont rien à voir avec la connexion : le même appel
 * réussira dans dix secondes.
 */

const serviceSupabase = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/**
 * Cette erreur signifie-t-elle que la CONNEXION est morte ?
 *
 * Les trois types retenus, et pourquoi eux seuls :
 *
 *  · `StripeAuthenticationError` — la clé est invalide ou révoquée. Définitif.
 *  · `StripePermissionError` — la clé est valide mais n'a plus le droit d'agir
 *    sur ce compte. C'est le cas d'une clé restreinte dont on a retiré une
 *    permission, ou d'un OAuth révoqué côté élève.
 *  · `account_invalid` — le compte connecté n'existe plus, ou Stripe l'a
 *    désactivé. Stripe le renvoie en `StripeInvalidRequestError`, dont les
 *    autres codes ne veulent rien dire sur la connexion (un id inconnu, un
 *    paramètre mal formé), d'où le filtrage sur le code exact.
 *
 * Tout le reste est explicitement écarté : `StripeRateLimitError`,
 * `StripeConnectionError`, `StripeAPIError` (les 5xx), `StripeCardError`. Aucun
 * ne dit quoi que ce soit de la connexion — et une carte refusée est même une
 * information sur le CLIENT, jamais sur l'élève.
 */
export function estUnePanneDeConnexion(err: unknown): boolean {
  const e = err as { type?: string; code?: string } | null;
  if (!e?.type) return false;

  if (e.type === 'StripeAuthenticationError') return true;
  if (e.type === 'StripePermissionError') return true;
  if (e.type === 'StripeInvalidRequestError' && e.code === 'account_invalid') return true;

  return false;
}

/** Un message court, lisible, et qui tient dans la colonne. */
function messageCourt(err: unknown): string {
  const e = err as { message?: string; code?: string } | null;
  const brut = e?.message || e?.code || 'connexion refusée';
  return `stripe: ${String(brut).slice(0, 180)}`;
}

/**
 * Enregistre le résultat d'un appel Stripe sur la ligne d'intégration.
 *
 * ⚠️ N'ÉCRIT QUE SUR CHANGEMENT D'ÉTAT.
 *
 * Un appel réussi ne remet `ok` que si la ligne était `failed` : sans cette
 * garde, chaque création de lien de paiement produirait une écriture dans
 * `integrations`, pour reposer la valeur qui s'y trouve déjà. À 30 élèves qui
 * corrigent des ventes, c'est du bruit permanent dans une table lue par le
 * bandeau — et un verrou de ligne pris pour rien.
 *
 * Ne lève jamais : la surveillance ne doit pas faire échouer l'action
 * surveillée. Un élève ne doit pas perdre sa modification de montant parce que
 * l'écriture de santé a eu un hoquet.
 */
export async function noterEtatStripe(
  profileId: string,
  resultat: { ok: true } | { ok: false; err: unknown },
): Promise<void> {
  try {
    // Une erreur qui n'est pas une panne de connexion ne dit rien : on ne
    // touche à rien, ni pour l'allumer, ni pour l'éteindre. Éteindre serait même
    // faux — un 500 pendant une panne réelle ne prouve pas qu'elle est finie.
    if (!resultat.ok && !estUnePanneDeConnexion(resultat.err)) return;

    const { data: ligne } = await serviceSupabase
      .from('integrations')
      .select('status')
      .eq('profile_id', profileId)
      .eq('provider', 'stripe')
      .maybeSingle();

    if (!ligne) return;

    if (resultat.ok) {
      if (ligne.status !== 'failed') return;
      await serviceSupabase.from('integrations')
        .update({ status: 'ok', last_snapshot_status: 'ok', last_snapshot_error: null })
        .eq('profile_id', profileId).eq('provider', 'stripe');
      return;
    }

    if (ligne.status === 'failed') return;
    await serviceSupabase.from('integrations')
      .update({
        // ⚠️ 'ok' ou 'failed' uniquement — contrainte `integrations_status_check`.
        // Écrire autre chose fait rejeter l'UPDATE en silence : c'est ce qui a
        // rendu muet le webhook `account.application.deauthorized` pendant des
        // semaines, avec un `status: 'disconnected'` que Postgres refusait.
        status: 'failed',
        last_snapshot_status: 'error',
        last_snapshot_error: messageCourt(resultat.err),
      })
      .eq('profile_id', profileId).eq('provider', 'stripe');
  } catch {
    // Silence volontaire : voir la note ci-dessus.
  }
}
