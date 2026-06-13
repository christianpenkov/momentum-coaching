import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }); }

  const { ig_username, scheduled_at, duration, invitee_name, invitee_email, call_type, manual_override, source } = body;
  if (!scheduled_at) return NextResponse.json({ error: 'scheduled_at requis' }, { status: 400 });

  // Récupérer le lead et le prospect_link pour lier le call
  const [{ data: lead }, { data: pl }] = await Promise.all([
    ig_username
      ? supa.from('instagram_leads').select('id').eq('profile_id', user.id).eq('ig_username', ig_username.toLowerCase()).maybeSingle()
      : Promise.resolve({ data: null }),
    ig_username
      ? supa.from('prospect_links').select('id, short_url').eq('profile_id', user.id).eq('ig_username', ig_username.toLowerCase()).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const shortLinkPath = pl?.short_url
    ? (() => { try { return new URL(pl.short_url).pathname.slice(1); } catch { return null; } })()
    : null;

  const { data: newCall, error } = await supa.from('calls').insert({
    coach_id: user.id,
    ig_lead_id: lead?.id ?? null,
    prospect_link_id: pl?.id ?? null,
    short_link_path: shortLinkPath,
    invitee_name: invitee_name ?? ig_username ?? null,
    invitee_email: invitee_email ?? null,
    scheduled_at,
    duration: duration ?? '60 min',
    status: 'active',
    call_type: call_type ?? 'manual',
    manual_override: manual_override ?? true,
    source: source ?? 'ig',
    booked_at: new Date().toISOString(),
  }).select('id').single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, callId: newCall.id });
}
