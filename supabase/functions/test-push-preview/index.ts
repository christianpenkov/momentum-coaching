// TEMPORAIRE — prévisualisation des notifications d'échéance.
// Envoie une seule notification, sur le dernier abonnement enregistré du
// profil, pour voir le rendu réel sur le téléphone. À supprimer une fois la
// validation faite : cette fonction n'a aucune utilité en production.
//
//   npx supabase functions deploy test-push-preview --no-verify-jwt

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push';

const sb = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET');
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { profileId, title, body } = await req.json();

  // Le DERNIER abonnement seulement : le profil en compte une douzaine
  // (réinstallations successives de la PWA), et arroser les 13 ferait vibrer
  // le téléphone autant de fois pour une seule notification à prévisualiser.
  const { data: subs } = await sb
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (!subs?.length) {
    return new Response(JSON.stringify({ error: 'aucun abonnement' }), { status: 404 });
  }

  webpush.setVapidDetails(
    Deno.env.get('VAPID_SUBJECT')!.trim(),
    Deno.env.get('NEXT_PUBLIC_VAPID_PUBLIC_KEY')!.trim(),
    Deno.env.get('VAPID_PRIVATE_KEY')!.trim()
  );

  const s = subs[0];
  try {
    await webpush.sendNotification(
      { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
      JSON.stringify({ title, body, url: '/paiements' })
    );
    return new Response(JSON.stringify({ ok: true, endpoint: s.endpoint.slice(0, 40) }));
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message, statusCode: e?.statusCode }), { status: 500 });
  }
});
