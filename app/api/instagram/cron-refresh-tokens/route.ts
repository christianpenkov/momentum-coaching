import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getIgCreds } from '@/lib/ig-fetch';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Traduit le message technique de Meta en une phrase comprehensible, et dit quoi
 * faire. Le message brut restait affiche tel quel : « Error validating access
 * token: Session has expired on Thursday, 27-Aug-26 05:00:00 PDT » n'apprend rien
 * a qui doit agir (retour de Chris, 2026-08-27).
 */
function expliquerRaison(brut: string): { cause: string; action: string } {
  const t = brut.toLowerCase();
  if (t.includes('session has expired') || t.includes('session expired')) {
    return {
      cause: "Le lien avec Instagram a expiré. Un accès Instagram dure 60 jours et se renouvelle tout seul, sauf s'il est resté trop longtemps sans être utilisé.",
      action: "L'élève doit se reconnecter à Instagram depuis ses paramètres Momentum.",
    };
  }
  if (t.includes('not authorized') || t.includes('revoked') || t.includes('has not authorized')) {
    return {
      cause: "L'accès à Instagram a été retiré. Cela arrive si le compte a été retiré des testeurs de l'application Meta, ou si l'élève a révoqué l'autorisation depuis Instagram.",
      action: "Vérifie que le compte figure bien dans les testeurs de l'application Meta, puis demande à l'élève de se reconnecter depuis ses paramètres Momentum.",
    };
  }
  if (t.includes('changed their password') || t.includes('password')) {
    return {
      cause: "L'élève a changé son mot de passe Instagram, ce qui coupe automatiquement l'accès.",
      action: "L'élève doit se reconnecter à Instagram depuis ses paramètres Momentum.",
    };
  }
  return {
    cause: "Instagram refuse l'accès au compte.",
    action: "Demande à l'élève de se reconnecter à Instagram depuis ses paramètres Momentum. Si le problème persiste, vérifie que le compte est toujours dans les testeurs de l'application Meta.",
  };
}

async function sendAdminAlert(nomEleve: string, compteIg: string | null, brut: string) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('[cron-refresh-tokens] RESEND_API_KEY manquant — email non envoyé');
    return false;
  }
  const { cause, action } = expliquerRaison(brut);
  const lien = `${process.env.NEXT_PUBLIC_PLATFORM_URL || 'https://momentum-plateforme.vercel.app'}/client/settings`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: 'Momentum <noreply@ubizenai.com>',
      to: 'christianpenkov06@gmail.com',
      // Le nom de l'eleve dans l'objet : c'est la seule chose a savoir avant
      // d'ouvrir. L'identifiant technique n'y a jamais sa place.
      subject: `Instagram déconnecté — ${nomEleve}`,
      html: `
<div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:15px;line-height:1.55;color:#1a1815;max-width:560px">
  <p style="font-size:17px;font-weight:600;margin:0 0 4px">Instagram ne collecte plus pour ${nomEleve}</p>
  ${compteIg ? `<p style="margin:0 0 18px;color:#797569;font-size:13px">Compte concerné : ${compteIg}</p>` : '<p style="margin:0 0 18px"></p>'}

  <p style="margin:0 0 6px"><strong>Ce qui s'est passé</strong></p>
  <p style="margin:0 0 18px">${cause}</p>

  <p style="margin:0 0 6px"><strong>Ce qu'il faut faire</strong></p>
  <p style="margin:0 0 18px">${action}</p>

  <p style="margin:0 0 6px"><strong>Si rien n'est fait</strong></p>
  <p style="margin:0 0 22px">Les statistiques Instagram de ${nomEleve} restent figées à aujourd'hui.
  Elles ne se rattraperont pas toutes seules : Instagram ne fournit certaines données que
  pendant quelques jours, et ce qui est manqué au-delà est perdu.</p>

  <p style="margin:0 0 24px">
    <a href="${lien}" style="background:#1a1815;color:#fff;text-decoration:none;padding:10px 18px;border-radius:7px;font-weight:600;display:inline-block">Ouvrir les paramètres</a>
  </p>

  <p style="margin:0;padding-top:14px;border-top:1px solid #eeeae0;color:#797569;font-size:11px">
    Un seul email est envoyé par panne, pas un par jour. Le prochain n'arrivera qu'après une reconnexion suivie d'une nouvelle coupure.<br>
    Message renvoyé par Meta : ${brut}
  </p>
</div>`,
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

  // Le nom de l'eleve vient de `profiles`, pas de `account_label` : ce dernier est
  // souvent vide (1 integration sur 2 au 2026-08-27), et l'email retombait alors
  // sur l'identifiant technique du profil — illisible pour qui doit agir.
  const { data: integrations, error } = await serviceSupabase
    .from('integrations')
    .select('profile_id, expires_at, account_label, status, last_snapshot_error, token_alerte_envoyee_le, profiles!inner(full_name)')
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

    const nomEleve = (integ as any).profiles?.full_name || integ.account_label || 'un élève';
    const envoye = await sendAdminAlert(nomEleve, integ.account_label, raison);
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
