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

/** Issue d'un envoi : `webpush` etant sans types, l'annoter est le seul moyen de
 *  distinguer succes et echec — un 201 comme un 410 portent un `statusCode`. */
type EnvoiPush = { livre: boolean; statusCode: number | undefined };

/**
 * Rend le NOMBRE de notifications reellement acceptees par le service de push.
 *
 * L'appelant ne doit poser `reminder_*_sent_at` que si quelque chose est parti.
 * Avant, le drapeau se posait meme quand l'eleve n'avait aucun abonnement : le
 * rappel d'echeance etait perdu pour toujours, avec un drapeau qui affirmait le
 * contraire. Le cas se produit pendant une reinstallation de la PWA, ou la table
 * est vide entre l'ancien endpoint et le nouveau.
 *
 * Ici la reparation est reelle, pas seulement honnete : la fenetre J-2 est large
 * de deux jours et le J+2 court sur trente, donc le passage du lendemain rattrape
 * un rappel non delivre. `notify-rapport` appliquait deja cette regle.
 */
async function sendPushToProfile(profileId: string, title: string, body: string, url: string, tag?: string): Promise<number> {
  const { data: subs } = await sb
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('profile_id', profileId);

  if (!subs || subs.length === 0) return 0;

  webpush.setVapidDetails(
    Deno.env.get('VAPID_SUBJECT')!.trim(),
    Deno.env.get('NEXT_PUBLIC_VAPID_PUBLIC_KEY')!.trim(),
    Deno.env.get('VAPID_PRIVATE_KEY')!.trim()
  );

  const payload = JSON.stringify({ title, body, url, tag });

  const results: EnvoiPush[] = await Promise.all(
    subs.map((sub): Promise<EnvoiPush> =>
      webpush
        .sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload)
        .then(() => ({ livre: true, statusCode: undefined }))
        .catch((err: { statusCode?: number }) => ({ livre: false, statusCode: err?.statusCode }))
    )
  );

  // 404 et 410 = abonnement mort (RFC 8030) : le purger évite de réessayer
  // indéfiniment à chaque passage du cron. Le 404 manquait, donc ces
  // endpoints-là restaient en base pour toujours.
  const dead = results
    .map((r, i: number) => (!r.livre && [404, 410].includes(r.statusCode as number) ? subs[i].endpoint : null))
    .filter(Boolean) as string[];
  if (dead.length) {
    await sb.from('push_subscriptions').delete().in('endpoint', dead);
  }

  return results.filter(r => r.livre).length;
}

function fmtEur(n: number): string {
  return `${Math.round(n).toLocaleString('fr-FR')} €`;
}

/** « 19 septembre » — sans l'année, inutile sur un rappel à quelques jours. */
function fmtJour(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'long', timeZone: 'UTC',
  });
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET');
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Filigrane de passage : la preuve que ce cron est encore INVOQUE.
  //
  // Pose AU PLUS TOT, juste apres l'authentification, et non a la fin. La question que
  // pose `crons_sante` est « le planificateur appelle-t-il encore cette URL ? » — c'est
  // la panne invisible de la plateforme : un cron qui ne tourne plus n'echoue pas, il
  // se tait, et un silence ne se distingue pas d'un succes.
  //
  // Un echec SURVENU PENDANT l'execution est deja couvert par `cron_runs`, et les deux
  // ne doivent pas se recouvrir. Marquer a la fin ferait en plus passer un simple
  // depassement de temps pour une mort du cron — une fausse alerte, c'est-a-dire le
  // debut d'une alerte qu'on n'ouvre plus.
  //
  // Le seuil de silence vit sur la LIGNE (`crons_passages.silence_max`), pas ici : la
  // RPC ne met a jour que l'horodatage, donc changer la cadence de ce cron se repercute
  // en base sans toucher au code.
  //
  // Strictement non bloquant : un filigrane muet vaut mieux qu'un cron qui tombe.
  try {
    const { error: filigraneErr } = await sb.rpc('marquer_passage_cron', { p_nom: 'installment-reminders' });
    if (filigraneErr) console.error('[installment-reminders] filigrane de passage:', filigraneErr.message);
  } catch (e) { console.error('[installment-reminders] filigrane de passage:', e); }

  const today = new Date().toISOString().slice(0, 10);
  const inTwoDays = new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10);
  const twoDaysAgo = new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 10);

  let before = 0, late = 0;
  const errors: string[] = [];

  // Une seule requête pour les deux fenêtres : le volume est faible (quelques
  // échéances par jour tout au plus), inutile de multiplier les allers-retours.
  const { data: rows, error } = await sb
    .from('deal_installments')
    .select('id, rank, amount, due_on, status, short_url, sent_at, reminder_before_sent_at, reminder_late_sent_at, deals!inner(id, profile_id, buyer_name, installments_count, payment_plan, status)')
    // L'EXISTENCE d'une échéance suffit : c'est elle qui dit qu'un versement
    // est attendu et que l'élève devra agir. Filtrer sur
    // payment_plan = 'installments_manual' excluait un cas réel — un paiement
    // comptant hors Stripe convenu pour plus tard, qui reste `one_shot` (la
    // contrainte deals_installments_count_check impose > 1) mais porte bien une
    // échéance à surveiller.
    //
    // Aucun risque de notifier un prélèvement automatique : en mode auto c'est
    // Stripe qui porte l'échéancier, deal_installments reste vide.
    .neq('deals.payment_plan', 'installments_auto')
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
      // Le lien déjà envoyé change le message, pas son déclenchement : ce
      // n'est plus « pense à l'envoyer » mais « le paiement est attendu ».
      // Réclamer une action déjà faite est le meilleur moyen de faire ignorer
      // les notifications suivantes.
      if (!r.reminder_before_sent_at && r.due_on > today && r.due_on <= inTwoDays) {
        const dejaEnvoye = !!r.sent_at;
        const livres = await sendPushToProfile(
          d.profile_id,
          `Échéance ${r.rank}/${total} dans 2 jours`,
          horsStripe
            ? `${qui} · ${montant} à encaisser hors Stripe le ${fmtJour(r.due_on)}`
            : dejaEnvoye
              ? `${qui} · ${montant} — lien envoyé, paiement attendu le ${fmtJour(r.due_on)}`
              : `${qui} · ${montant} — pense à lui envoyer le lien de paiement`,
          `/paiements?deal=${d.id}`,
          `echeance-${r.id}-before`,
        );
        // Rien n'est parti : pas de drapeau, le passage de demain reessaiera —
        // la fenetre J-2 est large de deux jours, le rappel n'est pas perdu.
        if (livres > 0) {
          await sb.from('deal_installments')
            .update({ reminder_before_sent_at: new Date().toISOString() })
            .eq('id', r.id);
          before++;
        }
      }

      // ── J+2 : toujours impayée ───────────────────────────────────────────
      if (!r.reminder_late_sent_at && r.due_on <= twoDaysAgo) {
        // Midi UTC des deux côtés : `due_on` est une date nue, et comparer des
        // instants décalés donnerait un jour de retard en trop ou en moins.
        const joursDeRetard = Math.max(1, Math.round(
          (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${r.due_on}T12:00:00Z`)) / 86400_000
        ));
        // Deux situations très différentes derrière un même retard : le lien
        // n'est jamais parti (l'élève doit l'envoyer), ou il est parti et le
        // client n'a pas payé (un message personnel vaut mieux qu'un rappel).
        // `sent_at` est fiable ici : il n'est renseigné que si l'élève a
        // explicitement coché la case.
        const livres = await sendPushToProfile(
          d.profile_id,
          // L'ancienneté du retard se saisit d'un coup d'œil, là où une date
          // seule demande de la comparer mentalement à aujourd'hui. Recalculé
          // à chaque passage du cron, donc jamais figé.
          `Échéance ${r.rank}/${total} due il y a ${joursDeRetard} jour${joursDeRetard > 1 ? 's' : ''}`,
          // La date vient AVANT le motif : le service worker tronque le corps à
          // 100 caractères, et un nom long la ferait sauter en fin de phrase.
          // « le virement » présumait un moyen que Momentum ignore : hors
          // Stripe, ce peut être des espèces, PayPal, Revolut, un chèque. On
          // sait seulement qu'aucun lien n'a été créé.
          //
          // Forme interrogative pour les deux cas où l'information dépend d'une
          // case cochée à la main : une question ne peut pas être fausse, une
          // affirmation si — et elle invite à corriger la case au passage.
          // Le seul des six messages qui nomme une action DANS Momentum : les
          // autres se règlent ailleurs (envoyer un lien, relancer quelqu'un).
          // Ici, cocher « Marquer reçu » est indispensable — sans ce clic le
          // cash reste faux même quand l'argent est arrivé. Le clic sur la
          // notification ouvre le panneau du deal, où le bouton existe.
          horsStripe
            ? `${qui} · ${montant} hors Stripe — vérifie si tu l'as reçu, puis marque-le`
            : r.sent_at
              ? `${qui} · ${montant} du ${fmtJour(r.due_on)} — lien envoyé, toujours pas payé`
              : `${qui} · ${montant} du ${fmtJour(r.due_on)} — le lien de paiement a-t-il été envoyé ?`,
          `/paiements?deal=${d.id}`,
          // Tag propre à cette échéance : sans lui, deux rappels du même jour
          // se remplaceraient l'un l'autre dans le centre de notifications.
          `echeance-${r.id}-late`,
        );
        // Idem : le J+2 est reexamine chaque jour pendant trente jours.
        if (livres > 0) {
          await sb.from('deal_installments')
            .update({ reminder_late_sent_at: new Date().toISOString() })
            .eq('id', r.id);
          late++;
        }
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
