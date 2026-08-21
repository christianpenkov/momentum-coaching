// Rappels d'échéance — deals payés en plusieurs fois, mode manuel (un lien par
// échéance) ou encaissement hors Stripe.
//
// POURQUOI : au-delà de quelques clients, personne ne retient de tête quelle
// échéance tombe quand. Les prélèvements automatiques n'ont pas ce problème
// (Stripe s'en charge) — ce cron ne concerne QUE les échéanciers portés par
// Momentum, c'est-à-dire ceux où l'élève doit agir.
//
// DEUX rappels par échéance, pas trois :
//   J-2  → prépare l'envoi du lien, ou attends le virement
//   J+2  → toujours impayé, relance
// Le « jour même » a été écarté : entre J-2 et J+2 il n'ajoute qu'une
// répétition, et sur 20 élèves × plusieurs deals la fatigue de notification
// ferait ignorer les alertes qui comptent (prélèvement refusé, lead chaud).
//
// Déploiement séparé du reste du code (git push ne suffit pas) :
//   npx supabase functions deploy installment-reminders --no-verify-jwt

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push';

const sb = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

async function sendPushToProfile(profileId: string, title: string, body: string, url: string) {
  const { data: subs } = await sb
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('profile_id', profileId);

  if (!subs || subs.length === 0) return;

  webpush.setVapidDetails(
    Deno.env.get('VAPID_SUBJECT')!.trim(),
    Deno.env.get('NEXT_PUBLIC_VAPID_PUBLIC_KEY')!.trim(),
    Deno.env.get('VAPID_PRIVATE_KEY')!.trim()
  );

  const payload = JSON.stringify({ title, body, url });

  const results = await Promise.all(
    subs.map(sub =>
      webpush
        .sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload)
        .catch((err: { statusCode?: number }) => err)
    )
  );

  // 410 Gone = abonnement révoqué côté navigateur : le purger évite de
  // réessayer indéfiniment à chaque passage du cron.
  const dead = results
    .map((r: any, i: number) => (r?.statusCode === 410 ? subs[i].endpoint : null))
    .filter(Boolean) as string[];
  if (dead.length) {
    await sb.from('push_subscriptions').delete().in('endpoint', dead);
  }
}

function fmtEur(n: number): string {
  return `${Math.round(n).toLocaleString('fr-FR')} €`;
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET');
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const inTwoDays = new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10);
  const twoDaysAgo = new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 10);

  let before = 0, late = 0;
  const errors: string[] = [];

  // Une seule requête pour les deux fenêtres : le volume est faible (quelques
  // échéances par jour tout au plus), inutile de multiplier les allers-retours.
  const { data: rows, error } = await sb
    .from('deal_installments')
    .select('id, rank, amount, due_on, status, short_url, reminder_before_sent_at, reminder_late_sent_at, deals!inner(id, profile_id, buyer_name, installments_count, payment_plan, status)')
    // deal_installments ne contient aujourd'hui que du manuel — en automatique
    // c'est Stripe qui porte l'échéancier. Le filtre est explicite pour qu'un
    // futur usage de la table ne déclenche pas des rappels sur des
    // prélèvements dont l'élève n'a rien à faire.
    .eq('deals.payment_plan', 'installments_manual')
    .neq('deals.status', 'canceled')
    .neq('status', 'paid')
    .lte('due_on', inTwoDays)
    .gte('due_on', new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10));

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  for (const r of (rows ?? []) as any[]) {
    const d = r.deals;
    if (!d?.profile_id) continue;

    const total = d.installments_count ?? '?';
    const qui = d.buyer_name ?? 'ton client';
    const montant = fmtEur(Number(r.amount));
    // Sans lien Stripe, l'échéance est encaissée hors plateforme : il n'y a
    // rien à envoyer, seulement un virement à constater.
    const horsStripe = !r.short_url;

    try {
      // ── J-2 : l'échéance approche ────────────────────────────────────────
      if (!r.reminder_before_sent_at && r.due_on > today && r.due_on <= inTwoDays) {
        await sendPushToProfile(
          d.profile_id,
          `Échéance ${r.rank}/${total} dans 2 jours`,
          horsStripe
            ? `${qui} · ${montant} à encaisser`
            : `${qui} · ${montant} — pense à envoyer le lien`,
          '/paiements',
        );
        await sb.from('deal_installments')
          .update({ reminder_before_sent_at: new Date().toISOString() })
          .eq('id', r.id);
        before++;
      }

      // ── J+2 : toujours impayée ───────────────────────────────────────────
      if (!r.reminder_late_sent_at && r.due_on <= twoDaysAgo) {
        await sendPushToProfile(
          d.profile_id,
          `Échéance ${r.rank}/${total} en retard`,
          horsStripe
            ? `${qui} · ${montant} — le virement est-il arrivé ?`
            : `${qui} · ${montant} toujours impayé`,
          '/paiements',
        );
        await sb.from('deal_installments')
          .update({ reminder_late_sent_at: new Date().toISOString() })
          .eq('id', r.id);
        late++;
      }
    } catch (e: any) {
      // Une échéance en échec ne doit pas empêcher les suivantes de partir.
      errors.push(`${r.id}: ${e?.message ?? 'erreur'}`);
    }
  }

  return new Response(
    JSON.stringify({ ok: true, before, late, scanned: rows?.length ?? 0, errors }),
    { headers: { 'content-type': 'application/json' } },
  );
});
