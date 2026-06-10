import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  const { subscription, userId } = await req.json();
  if (!subscription?.endpoint || !userId) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }

  // Nettoyer les vieilles subscriptions du même profil (> 7 jours sans activité)
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  await supabase.from('push_subscriptions')
    .delete()
    .eq('profile_id', userId)
    .neq('endpoint', subscription.endpoint)
    .lt('created_at', cutoff);

  const { error } = await supabase.from('push_subscriptions').upsert({
    profile_id: userId,
    endpoint: subscription.endpoint,
    p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth,
  }, { onConflict: 'profile_id,endpoint' });

  if (error) {
    console.error('[PUSH-SUBSCRIBE] Erreur upsert:', error.message, error.code);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  console.log('[PUSH-SUBSCRIBE] ✅ Subscription enregistrée pour', userId);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { endpoint, userId } = await req.json();
  if (!endpoint || !userId) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  await supabase.from('push_subscriptions')
    .delete()
    .eq('profile_id', userId)
    .eq('endpoint', endpoint);

  return NextResponse.json({ ok: true });
}
