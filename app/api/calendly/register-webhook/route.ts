import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

/**
 * Abonne le compte Calendly de l'utilisateur au webhook de la plateforme.
 * Appelé en fire-and-forget par le callback OAuth, avec le cookie de session.
 *
 * ── LE DÉFAUT CORRIGÉ LE 2026-09-02 ──────────────────────────────────────────
 * Cette route créait l'abonnement SANS `signing_key`. Or `/api/webhooks/calendly`
 * vérifie chaque charge utile contre `CALENDLY_WEBHOOK_SIGNING_KEY` et refuse tout
 * le reste, fail-closed. Les deux ne pouvaient donc JAMAIS s'accorder : même sur un
 * compte payant, chaque événement serait tombé en 401.
 *
 * Et la panne aurait été invisible — les rendez-vous continuent d'arriver par le cron
 * `sync-calendly`, donc personne n'aurait rien remarqué. On aurait payé un plan
 * Calendly pour un webhook silencieusement inopérant.
 *
 * ── ÉTAT CONSIGNÉ, PAS SEULEMENT RENVOYÉ ─────────────────────────────────────
 * L'appelant est en fire-and-forget : sa réponse ne va nulle part. Le résultat est
 * donc écrit dans `integrations.metadata.webhook` — c'est le seul endroit où on
 * pourra constater, plus tard, pourquoi un compte n'a pas de webhook.
 *
 * `plan_insuffisant` est le cas NORMAL sur un compte Calendly gratuit : les webhooks
 * y sont une fonctionnalité payante (403 « Please upgrade your Calendly account to
 * Standard », constaté le 2026-09-02). Ce n'est pas une erreur à corriger, c'est une
 * information à afficher.
 */
export async function POST() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const serviceSupabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  /** Consigne l'issue dans l'intégration — fusion, pour ne pas écraser le reste. */
  const consigner = async (webhook: Record<string, unknown>) => {
    const { data: row } = await serviceSupabase
      .from('integrations').select('metadata')
      .eq('profile_id', user.id).eq('provider', 'calendly').maybeSingle();
    await serviceSupabase.from('integrations')
      .update({ metadata: { ...(row?.metadata ?? {}), webhook: { ...webhook, le: new Date().toISOString() } } })
      .eq('profile_id', user.id).eq('provider', 'calendly');
  };

  const signingKey = process.env.CALENDLY_WEBHOOK_SIGNING_KEY;
  if (!signingKey) {
    // Sans elle, créer l'abonnement produirait un webhook que notre propre route
    // rejetterait à 100 %. Mieux vaut ne rien créer et le dire.
    await consigner({ etat: 'cle_de_signature_absente' });
    return NextResponse.json({ error: 'CALENDLY_WEBHOOK_SIGNING_KEY manquante' }, { status: 500 });
  }

  const { data: integration } = await serviceSupabase
    .from('integrations')
    .select('access_token')
    .eq('profile_id', user.id)
    .eq('provider', 'calendly')
    .single();

  if (!integration?.access_token) {
    return NextResponse.json({ error: 'Calendly non connecté' }, { status: 404 });
  }
  const auth = { Authorization: `Bearer ${integration.access_token}` };

  const meRes = await fetch('https://api.calendly.com/users/me', { headers: auth });
  const meData = await meRes.json().catch(() => ({}));
  const orgUri = meData?.resource?.current_organization;
  const userUri = meData?.resource?.uri;

  if (!orgUri || !userUri) {
    await consigner({ etat: 'organisation_introuvable' });
    return NextResponse.json({ error: 'Impossible de récupérer l\'organisation Calendly' }, { status: 400 });
  }

  const base = process.env.NEXT_PUBLIC_PLATFORM_URL;
  if (!base) {
    await consigner({ etat: 'url_plateforme_absente' });
    return NextResponse.json({ error: 'NEXT_PUBLIC_PLATFORM_URL manquante' }, { status: 500 });
  }
  const webhookUrl = `${base}/api/webhooks/calendly`;

  // ── Un abonnement existant est SUPPRIMÉ puis recréé ────────────────────────
  // L'API ne renvoie jamais le `signing_key` d'un abonnement : impossible de savoir
  // si celui qui existe a été créé avec la bonne clé — ou sans clé du tout, ce qui
  // était le cas de tous ceux créés par la version précédente de ce fichier.
  // Le conserver au motif qu'il « existe » perpétuerait exactement la panne qu'on
  // corrige. On garantit l'état au lieu de le supposer ; l'opération est rare
  // (connexion OAuth) et idempotente.
  const existingRes = await fetch(
    `https://api.calendly.com/webhook_subscriptions?organization=${encodeURIComponent(orgUri)}&user=${encodeURIComponent(userUri)}&scope=user`,
    { headers: auth }
  );
  const existingData = await existingRes.json().catch(() => ({}));
  for (const w of (existingData?.collection ?? [])) {
    if (w?.callback_url === webhookUrl && w?.uri) {
      await fetch(w.uri, { method: 'DELETE', headers: auth }).catch(() => {});
    }
  }

  const createRes = await fetch('https://api.calendly.com/webhook_subscriptions', {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      // Les SEULS noms d'événements que Calendly émet et que la route traite.
      // `invitee.rescheduled` et `invitee.no_show` n'existent pas chez Calendly —
      // voir l'en-tête de app/api/webhooks/calendly/route.ts.
      events: ['invitee.created', 'invitee.canceled'],
      organization: orgUri,
      user: userUri,
      scope: 'user',
      signing_key: signingKey,
    }),
  });

  if (!createRes.ok) {
    const err = await createRes.json().catch(() => ({} as Record<string, unknown>));
    const message = String((err as Record<string, unknown>)?.message ?? '');
    // 403 + « upgrade » = plan Calendly gratuit. Cas normal, pas une panne : le cron
    // sync-calendly reste le chemin d'écriture, et il suffit.
    const etat = createRes.status === 403 && /upgrade/i.test(message)
      ? 'plan_insuffisant'
      : 'echec_creation';
    await consigner({ etat, http: createRes.status, message });
    return NextResponse.json({ error: message || 'Erreur création webhook', etat }, { status: 400 });
  }

  await consigner({ etat: 'actif', url: webhookUrl });
  return NextResponse.json({ ok: true, message: 'Webhook Calendly enregistré' });
}
