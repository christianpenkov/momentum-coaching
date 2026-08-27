import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getIgCreds } from '@/lib/ig-fetch';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function sendAdminAlert(profileId: string, label: string | null, reason: string) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('[cron-refresh-tokens] RESEND_API_KEY manquant — email non envoyé');
    return false;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: 'Momentum <noreply@ubizenai.com>',
      to: 'christianpenkov06@gmail.com',
      subject: `[Momentum] Instagram déconnecté — ${label || profileId}`,
      html: `<p>La collecte Instagram est <strong>arrêtée</strong> pour <strong>${label || profileId}</strong>.</p>
             <p>Raison renvoyée par Meta : ${reason}</p>
             <p>Rien ne repartira tout seul : un jeton révoqué ou expiré ne peut pas être renouvelé.
             L'élève doit se reconnecter à Instagram depuis ses paramètres Momentum.</p>
             <p>Tant que ce n'est pas fait, ses statistiques Instagram se figent à la date du jour.</p>`,
    }),
  }).catch(err => {
    console.error('[cron-refresh-tokens] Resend error:', err);
    return null;
  });
  return !!res && res.ok;
}

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: integrations, error } = await serviceSupabase
    .from('integrations')
    .select('profile_id, expires_at, account_label, status, last_snapshot_error, token_alerte_envoyee_le')
    .eq('provider', 'instagram');

  if (error) {
    console.error('[cron-refresh-tokens] Erreur lecture integrations:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results = { total: integrations?.length ?? 0, refreshed: 0, failed: 0, emails_sent: 0, deja_alerte: 0 };

  await Promise.all((integrations ?? []).map(async (integ) => {
    let raison: string | null = null;

    try {
      const creds = await getIgCreds(integ.profile_id);
      if (!creds) {
        // Le rafraichissement a ete refuse, ou l'integration n'a pas de jeton.
        raison = integ.last_snapshot_error || `expires_at: ${integ.expires_at || 'inconnu'}`;
      }
    } catch (err: any) {
      raison = `Exception: ${err?.message || 'inconnue'}`;
    }

    // Second signal, indispensable : `getIgCreds` ne tente un rafraichissement que
    // dans les 5 jours precedant l'expiration. Un jeton REVOQUE dont la date
    // d'expiration est encore lointaine — le cas normal d'une revocation, par
    // exemple en retirant un compte des testeurs de l'app Meta — ne declenchait
    // donc aucune tentative, `creds` restait valide, et l'alerte ne partait jamais.
    //
    // poll-leads, lui, appelle vraiment l'API toutes les heures et marque
    // `status = 'failed'` des le premier refus. C'est ce signal-la qui detecte une
    // revocation, pas le calendrier d'expiration.
    if (!raison && integ.status === 'failed') {
      raison = integ.last_snapshot_error || 'statut failed sans detail';
    }

    if (!raison) {
      results.refreshed++;
      // Le jeton est valide : on efface une eventuelle alerte en cours, pour qu'une
      // panne ulterieure realerte au lieu d'etre etouffee par ce garde.
      if (integ.token_alerte_envoyee_le) {
        await serviceSupabase.from('integrations')
          .update({ token_alerte_envoyee_le: null })
          .eq('profile_id', integ.profile_id).eq('provider', 'instagram');
      }
      return;
    }

    results.failed++;

    // Une seule alerte par panne, pas une par passage. En quotidien, sans ce garde,
    // le meme email partirait chaque jour jusqu'a reconnexion — et un destinataire
    // qui recoit sept fois la meme alerte cesse de les lire, ce qui annule
    // exactement ce que l'alerte est censee apporter.
    if (integ.token_alerte_envoyee_le) {
      results.deja_alerte++;
      return;
    }

    const envoye = await sendAdminAlert(integ.profile_id, integ.account_label, raison);
    if (envoye) {
      results.emails_sent++;
      // Horodate seulement si l'envoi a REUSSI : sinon une panne de Resend
      // condamnerait l'alerte au silence definitif pour cette integration.
      await serviceSupabase.from('integrations')
        .update({ token_alerte_envoyee_le: new Date().toISOString() })
        .eq('profile_id', integ.profile_id).eq('provider', 'instagram');
    }
  }));

  console.log('[cron-refresh-tokens] Résultat:', results);
  return NextResponse.json(results);
}
