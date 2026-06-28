import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { sendPushToProfile, getAuthClientForProfile } from '@/lib/googleCalendarService';
import { google } from 'googleapis';

// POST /api/calls/[id]/respond — l'élève accepte ou refuse un call
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

  const { id } = await params;
  const { response, proposedAt } = await request.json();

  if (!['accepted', 'declined'].includes(response)) {
    return NextResponse.json({ error: 'response doit être accepted ou declined' }, { status: 400 });
  }

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Vérifie que ce call appartient bien à ce client
  const { data: clientRow } = await sb
    .from('clients')
    .select('id, coach_id')
    .eq('profile_id', user.id)
    .single();

  if (!clientRow) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 });

  const { data: call } = await sb
    .from('calls')
    .select('id, coach_id, topic, scheduled_at, client_id, google_event_id')
    .eq('id', id)
    .eq('client_id', clientRow.id)
    .eq('status', 'pending_acceptance')
    .single();

  if (!call) return NextResponse.json({ error: 'Call introuvable ou déjà traité' }, { status: 404 });

  // Enregistre la réponse
  await sb.from('call_responses').insert({
    call_id: id,
    client_profile_id: user.id,
    response,
    proposed_at: proposedAt || null,
  });

  // Met à jour le statut du call
  const newStatus = response === 'accepted' ? 'active' : 'declined';
  await sb.from('calls').update({ status: newStatus }).eq('id', id);

  // Si refus : supprimer l'événement Google Calendar (non bloquant)
  if (response === 'declined' && call.google_event_id) {
    try {
      const auth = await getAuthClientForProfile(call.coach_id);
      const calendar = google.calendar({ version: 'v3', auth });
      await calendar.events.delete({
        calendarId: 'primary',
        eventId: call.google_event_id,
        sendUpdates: 'all',
      });
    } catch {}
  }

  // Notif push au coach
  const d = new Date(call.scheduled_at);
  const dateStr = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const timeStr = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const topic = call.topic || 'Call coaching';

  const suffix = proposedAt ? ` — propose : ${proposedAt}` : '';
  const notifTitle = response === 'accepted' ? 'Call accepté ✓' : 'Call refusé';
  const notifBody = response === 'accepted'
    ? `${topic} · ${dateStr} à ${timeStr}`
    : `${topic} · ${dateStr} à ${timeStr}${suffix}`;

  // Push immédiate au coach
  await sendPushToProfile(call.coach_id, notifTitle, notifBody, '/calls');

  // Notif persistante pour le coach (reste jusqu'au clic OK)
  await sb.from('client_notifications').insert({
    profile_id: call.coach_id,
    type: response === 'accepted' ? 'call_accepted' : 'call_declined',
    call_id: id,
    payload: {
      topic,
      scheduled_at: call.scheduled_at,
      proposed_at: proposedAt || null,
    },
  });

  return NextResponse.json({ ok: true, status: newStatus });
}
