// Edge Function Supabase — send-pending-dm3
//
// Envoie les DM3 (question d'ouverture) dont l'heure est venue.
//
// Pourquoi une file plutôt qu'une attente dans le webhook : le webhook Instagram
// doit répondre à Meta en MOINS DE 30 SECONDES, et Meta DÉSABONNE l'application
// du webhook après 1 h d'échecs (les DM1 s'arrêtent, réabonnement manuel requis).
// Attendre 2 minutes dans le handler était donc exclu.
//
// Le webhook pose `dm3_scheduled_at = maintenant + 2 min` au clic du DM1 ; cette
// fonction dépile toutes les minutes.
//
// Appelée par pg_cron (job send-pending-dm3-1min).
// Déploiement : supabase functions deploy send-pending-dm3 --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { mapWithConcurrency } from '../_shared/rate-limit.ts';
import { EMPREINTES_EDGE } from '../../../lib/empreintes-edge.generated.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET')!;

const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Fenêtre de rattrapage : on n'envoie pas un DM3 dont l'heure est passée depuis
 * plus de 2 h. Après une panne prolongée, une question d'ouverture qui débarque
 * des heures après le lien est pire que pas de question du tout — et la fenêtre
 * de 24 h Meta peut s'être refermée entre-temps.
 */
const MAX_LATE_MS = 2 * 60 * 60 * 1000;

Deno.serve(async (req: Request) => {
  const auth = req.headers.get('authorization');
  if (!auth || auth !== `Bearer ${CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: 'Non autorisé' }), { status: 401 });
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
    const { error: filigraneErr } = await supa.rpc('marquer_passage_cron', { p_nom: 'send-pending-dm3', p_empreinte: EMPREINTES_EDGE['send-pending-dm3'] });
    if (filigraneErr) console.error('[send-pending-dm3] filigrane de passage:', filigraneErr.message);
  } catch (e) { console.error('[send-pending-dm3] filigrane de passage:', e); }

  const now = Date.now();
  const staleCutoff = new Date(now - MAX_LATE_MS).toISOString();

  // Index partiel idx_instagram_leads_dm3_due : cette requête ne touche que les
  // lignes réellement en attente, jamais toute la table.
  const { data: due, error } = await supa
    .from('instagram_leads')
    .select('id, profile_id, ig_user_id, ig_username, pending_dm3, dm3_scheduled_at, ig_account_id')
    .not('dm3_scheduled_at', 'is', null)
    .not('pending_dm3', 'is', null)
    .lte('dm3_scheduled_at', new Date(now).toISOString())
    .order('dm3_scheduled_at', { ascending: true })
    .limit(200);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
  if (!due?.length) {
    return new Response(JSON.stringify({ ok: true, sent: 0, skipped: 0 }), { status: 200 });
  }

  // Tokens Instagram groupés : une requête au lieu d'une par lead (N+1).
  const profileIds = [...new Set(due.map(l => l.profile_id))];
  const { data: integs } = await supa
    .from('integrations')
    .select('profile_id, access_token, metadata')
    .eq('provider', 'instagram')
    .in('profile_id', profileIds);

  const tokenByProfile = new Map<string, { token: string; igAccountId: string | null }>();
  for (const i of integs || []) {
    if (i.access_token) {
      tokenByProfile.set(i.profile_id, {
        token: i.access_token,
        igAccountId: i.metadata?.ig_account_id ? String(i.metadata.ig_account_id) : null,
      });
    }
  }

  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];

  // Concurrence bornée : ces envois partagent le quota Meta avec le webhook
  // temps réel, qui reste prioritaire.
  const results = await mapWithConcurrency(due, 5, async (lead) => {
    // Trop en retard (panne prolongée) : on abandonne plutôt que d'envoyer une
    // question d'ouverture des heures après le lien.
    if (lead.dm3_scheduled_at && new Date(lead.dm3_scheduled_at).toISOString() < staleCutoff) {
      await supa.from('instagram_leads')
        .update({ pending_dm3: null, dm3_scheduled_at: null })
        .eq('id', lead.id);
      skipped++;
      return;
    }

    const creds = tokenByProfile.get(lead.profile_id);
    const igAccountId = lead.ig_account_id || creds?.igAccountId;
    if (!creds || !igAccountId || !lead.ig_user_id) {
      // Pas de quoi envoyer : on nettoie pour ne pas repasser indéfiniment dessus.
      await supa.from('instagram_leads')
        .update({ pending_dm3: null, dm3_scheduled_at: null })
        .eq('id', lead.id);
      skipped++;
      return;
    }

    // ── RÉSERVATION ATOMIQUE avant l'envoi (audit du 2026-09-02) ─────────────
    // pg_cron relance toutes les 60 s, et une passe chargée (200 leads x
    // concurrence 5 x 1-2 s par envoi Meta) dure 40 à 80 s : deux passages qui se
    // chevauchent lisaient les MÊMES lignes — `pending_dm3` n'était mis à null
    // qu'APRÈS l'appel Meta — et le prospect recevait deux fois la question
    // d'ouverture, sur le tunnel de vente, précisément quand le volume monte.
    //
    // L'UPDATE conditionnel (`.not('pending_dm3','is',null)`) est atomique au
    // niveau de la ligne : le premier passage la consomme, le second trouve zéro
    // ligne et passe son chemin. Sur panne RÉSEAU (fetch qui lève), la ligne est
    // restaurée : le passage suivant retente, borné par la fenêtre de 2 h. Sur
    // refus MÉTA (data.error), on ne restaure pas — réessayer ne changerait rien.
    const { data: reservee, error: claimErr } = await supa.from('instagram_leads')
      .update({ pending_dm3: null, dm3_scheduled_at: null })
      .eq('id', lead.id)
      .not('pending_dm3', 'is', null)
      .select('id')
      .maybeSingle();
    if (claimErr) { errors.push(`claim ${lead.ig_username || lead.id}: ${claimErr.message}`); return; }
    if (!reservee) { skipped++; return; } // déjà prise par un passage concurrent

    let data: any;
    try {
      const res = await fetch(
        `https://graph.instagram.com/v21.0/${igAccountId}/messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipient: { id: lead.ig_user_id },
            messaging_type: 'RESPONSE',
            message: { text: lead.pending_dm3 },
            access_token: creds.token,
          }),
        }
      );
      data = await res.json().catch(() => ({}));
    } catch (e: any) {
      // Panne réseau : rien n'est parti chez Meta. On restaure la réservation
      // pour que le passage suivant (60 s) retente — la fenêtre de 2 h borne tout.
      await supa.from('instagram_leads')
        .update({ pending_dm3: lead.pending_dm3, dm3_scheduled_at: lead.dm3_scheduled_at })
        .eq('id', lead.id);
      errors.push(`reseau ${lead.ig_username || lead.id}: ${e?.message || 'unknown'}`);
      return;
    }

    if (data.error) {
      // Échec (fenêtre 24 h refermée, blocage, token expiré) : la réservation
      // reste consommée. Réessayer indéfiniment ne changerait rien et ferait
      // boucler le cron.
      errors.push(`${lead.ig_username || lead.id}: ${data.error.message || 'unknown'}`);
      skipped++;
      return;
    }

    sent++;
  });

  results.forEach(r => {
    if (r.status === 'rejected') errors.push(`unexpected: ${r.reason?.message || 'unknown'}`);
  });

  // ── Journal en base, pas seulement dans la réponse HTTP (audit du 2026-09-02).
  // pg_cron jette la réponse : un refus Meta ou un échec de claim n'était visible
  // NULLE PART. Même convention que sync-calendly — n'écrire que les passages en
  // échec, la purge de cron_runs fait le ménage.
  if (errors.length) {
    const { error: journalErr } = await supa.from('cron_runs').insert({
      fonction: 'send-pending-dm3',
      profils_en_erreur: errors.length,
      erreurs: { echecs: errors.slice(0, 50) },
    });
    if (journalErr) console.error('[send-pending-dm3] cron_runs:', journalErr.message);
  }

  return new Response(JSON.stringify({
    ok: true,
    sent,
    skipped,
    due: due.length,
    errors: errors.slice(0, 10),
  }), { status: 200 });
});
