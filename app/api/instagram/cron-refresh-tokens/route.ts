import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getIgCreds } from '@/lib/ig-fetch';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function sendAdminAlert(profileId: string, reason: string) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('[cron-refresh-tokens] RESEND_API_KEY manquant — email non envoyé');
    return;
  }
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: 'Momentum <noreply@ubizenai.com>',
      to: 'christianpenkov06@gmail.com',
      subject: '[Momentum] Token Instagram expiré — intervention requise',
      html: `<p>Le token Instagram du profil <strong>${profileId}</strong> est expiré ou révoqué.</p><p>Raison : ${reason}</p><p>Le coach devra se reconnecter à Instagram depuis ses paramètres Momentum.</p>`,
    }),
  }).catch(err => console.error('[cron-refresh-tokens] Resend error:', err));
}

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: integrations, error } = await serviceSupabase
    .from('integrations')
    .select('profile_id, expires_at, account_label')
    .eq('provider', 'instagram');

  if (error) {
    console.error('[cron-refresh-tokens] Erreur lecture integrations:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results = { total: integrations?.length ?? 0, refreshed: 0, failed: 0, emails_sent: 0 };

  for (const integ of integrations ?? []) {
    try {
      const creds = await getIgCreds(integ.profile_id);
      if (!creds) {
        console.warn(`[cron-refresh-tokens] Token invalide pour profil ${integ.profile_id} (${integ.account_label})`);
        results.failed++;
        await sendAdminAlert(integ.profile_id, `account_label: ${integ.account_label || 'inconnu'}, expires_at: ${integ.expires_at || 'null'}`);
        results.emails_sent++;
      } else {
        results.refreshed++;
      }
    } catch (err: any) {
      console.error(`[cron-refresh-tokens] Exception pour profil ${integ.profile_id}:`, err?.message);
      results.failed++;
      await sendAdminAlert(integ.profile_id, `Exception: ${err?.message || 'inconnue'}`);
      results.emails_sent++;
    }
  }

  console.log('[cron-refresh-tokens] Résultat:', results);
  return NextResponse.json(results);
}
