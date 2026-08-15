import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getFathomToken } from '@/lib/fathom-auth';

const FATHOM_API_BASE = 'https://api.fathom.ai/external/v1';

export async function POST() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const accessToken = await getFathomToken(user.id);
  if (!accessToken) {
    return NextResponse.json({ error: 'Fathom non connecté' }, { status: 404 });
  }

  const webhookUrl = `${process.env.NEXT_PUBLIC_PLATFORM_URL}/api/webhooks/fathom`;

  // Vérifie si un webhook existe déjà pour éviter les doublons — même précaution
  // que register-webhook Calendly.
  const existingRes = await fetch(`${FATHOM_API_BASE}/webhooks`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const existingData = await existingRes.json().catch(() => ({}));
  const alreadyExists = Array.isArray(existingData?.items)
    && existingData.items.some((w: any) => w.destination_url === webhookUrl);

  if (alreadyExists) {
    return NextResponse.json({ ok: true, message: 'Webhook déjà enregistré' });
  }

  // Champs wire-format et valeurs triggered_for vérifiés dans le code source du
  // SDK officiel fathom-typescript (package npm, pas installé ici) — la doc
  // publique liste des valeurs triggered_for différentes/obsolètes (ex.
  // "all_recordings" qui n'existe pas côté API réelle).
  const createRes = await fetch(`${FATHOM_API_BASE}/webhooks`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      destination_url: webhookUrl,
      include_summary: true,
      include_action_items: true,
      include_transcript: true,
      include_crm_matches: false,
      triggered_for: ['my_recordings'],
    }),
  });

  if (!createRes.ok) {
    const err = await createRes.json().catch(() => ({}));
    return NextResponse.json({ error: err.message || 'Erreur création webhook Fathom' }, { status: 400 });
  }

  const created = await createRes.json();

  // Le secret de vérification (format whsec_...) n'est retourné qu'à la création —
  // Fathom ne le réexpose jamais après coup. On le stocke dans integrations.metadata
  // pour ne pas dépendre d'un ordre de déploiement parfait avec FATHOM_WEBHOOK_SECRET ;
  // le webhook entrant doit lire ce secret en priorité (à défaut, la variable d'env).
  if (created?.secret) {
    const serviceSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    await serviceSupabase
      .from('integrations')
      .update({ metadata: { webhook_secret: created.secret } })
      .eq('profile_id', user.id)
      .eq('provider', 'fathom');
  }

  return NextResponse.json({ ok: true, message: 'Webhook Fathom enregistré' });
}
