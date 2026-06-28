import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { updateGoogleCall, deleteGoogleCall } from '@/lib/googleCalendarService';

async function getUser(request: NextRequest) {
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
  return user;
}

// PATCH /api/calls/[id] — Modifier la date/heure ou le sujet d'un call
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser(request);
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { id } = await params;
  const { startTime, endTime, topic } = await request.json();

  if (!startTime || !endTime) {
    return NextResponse.json({ error: 'startTime et endTime sont requis' }, { status: 400 });
  }

  try {
    const call = await updateGoogleCall({
      coachId: user.id,
      callId: id,
      startTime,
      endTime,
      topic,
    });
    return NextResponse.json({ ok: true, call });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur inconnue';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/calls/[id] — Supprimer un call (Google Calendar + Supabase)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser(request);
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { id } = await params;

  try {
    await deleteGoogleCall({ coachId: user.id, callId: id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur inconnue';
    console.error('[DELETE /api/calls]', message, err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
