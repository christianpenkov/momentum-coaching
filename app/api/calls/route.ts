import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createGoogleCall } from '@/lib/googleCalendarService';

// POST /api/calls — Créer un call Google Meet
export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { clientId, clientName, topic, startTime, endTime } = await request.json();

  if (!clientId || !startTime || !endTime) {
    return NextResponse.json({ error: 'clientId, startTime et endTime sont requis' }, { status: 400 });
  }

  const { data: clientRow } = await supabase
    .from('clients')
    .select('id')
    .eq('id', clientId)
    .eq('coach_id', user.id)
    .maybeSingle();
  if (!clientRow) {
    return NextResponse.json({ error: 'Client introuvable ou non autorisé' }, { status: 403 });
  }

  try {
    const call = await createGoogleCall({
      coachId: user.id,
      clientId,
      clientName: clientName || 'Client',
      topic: topic || 'Call coaching',
      startTime,
      endTime,
    });
    return NextResponse.json({ ok: true, call });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur inconnue';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
