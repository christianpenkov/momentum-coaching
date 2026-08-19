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
    const data = await res.json().catch(() => ({}));

    if (data.error) {
      // Échec (fenêtre 24 h refermée, blocage, token expiré) : on consomme quand
      // même. Réessayer indéfiniment ne changerait rien et ferait boucler le cron.
      errors.push(`${lead.ig_username || lead.id}: ${data.error.message || 'unknown'}`);
      await supa.from('instagram_leads')
        .update({ pending_dm3: null, dm3_scheduled_at: null })
        .eq('id', lead.id);
      skipped++;
      return;
    }

    await supa.from('instagram_leads')
      .update({ pending_dm3: null, dm3_scheduled_at: null })
      .eq('id', lead.id);
    sent++;
  });

  results.forEach(r => {
    if (r.status === 'rejected') errors.push(`unexpected: ${r.reason?.message || 'unknown'}`);
  });

  return new Response(JSON.stringify({
    ok: true,
    sent,
    skipped,
    due: due.length,
    errors: errors.slice(0, 10),
  }), { status: 200 });
});
