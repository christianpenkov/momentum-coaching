import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  const serverSupabase = await createServerClient();
  const { data: { user } } = await serverSupabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { subscription } = await req.json();
  if (!subscription?.endpoint) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }

  const userId = user.id;

  // ⚠️ NE PAS purger ici les autres subscriptions du profil sur un critère d'âge.
  //
  // L'ancienne version supprimait toute subscription du même profil de plus de
  // 7 jours dès qu'une AUTRE s'enregistrait. Deux effets, tous deux invisibles :
  //   - `upsert` ne rafraîchit pas `created_at`, donc une subscription parfaitement
  //     valide vieillissait indéfiniment et devenait éligible à la purge ;
  //   - ouvrir l'app sur un second appareil (ou après réinstallation) détruisait
  //     donc la subscription du téléphone principal. Plus aucun push n'y arrivait,
  //     donc plus aucun `setAppBadge` : la pastille disparaissait pour de bon.
  //
  // Une subscription morte se signale toute seule : APNs/FCM répondent 404/410 au
  // premier envoi et /api/push/send la supprime. C'est le SEUL critère fiable —
  // l'âge n'en est pas un, un abonnement peut rester valide des mois.

  // Un endpoint (= un appareil/navigateur donné) ne doit être associé qu'à un seul
  // profil actif à la fois — sans ça, se connecter avec un autre compte sur le même
  // téléphone laisse l'ancien profil recevoir les pushs adressés au nouveau (et
  // vice-versa), l'endpoint FCM/APNs restant identique d'une session à l'autre.
  await supabase.from('push_subscriptions')
    .delete()
    .eq('endpoint', subscription.endpoint)
    .neq('profile_id', userId);

  const { error } = await supabase.from('push_subscriptions').upsert({
    profile_id: userId,
    endpoint: subscription.endpoint,
    p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth,
    // Trace de fraîcheur : `created_at` n'est jamais réécrit par un upsert, donc
    // sans cette colonne rien ne distingue un abonnement revalidé ce matin d'un
    // abonnement fossile jamais reconfirmé. Diagnostic uniquement — ne JAMAIS
    // s'en servir pour supprimer une ligne (voir le commentaire en tête).
    last_seen_at: new Date().toISOString(),
  }, { onConflict: 'profile_id,endpoint' });

  if (error) {
    console.error('[PUSH-SUBSCRIBE] Erreur upsert:', error.message, error.code);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  console.log('[PUSH-SUBSCRIBE] ✅ Subscription enregistrée pour', userId);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const serverSupabase = await createServerClient();
  const { data: { user } } = await serverSupabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { endpoint } = await req.json();
  if (!endpoint) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  await supabase.from('push_subscriptions')
    .delete()
    .eq('profile_id', user.id)
    .eq('endpoint', endpoint);

  return NextResponse.json({ ok: true });
}
