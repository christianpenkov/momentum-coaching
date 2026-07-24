import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

const SIGNED_URL_TTL_SECONDS = 3600; // 1h

// POST /api/messages/media-url — résout des URLs signées pour un lot de messages media,
// après vérification que l'appelant fait bien partie de la conversation.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { messageIds } = await req.json().catch(() => ({}));
  if (!Array.isArray(messageIds) || messageIds.length === 0) {
    return NextResponse.json({ error: 'messageIds requis' }, { status: 400 });
  }

  const { data: messages, error: fetchErr } = await supabase
    .from('messages')
    .select('id, client_id, storage_bucket, storage_path, thumbnail_storage_path')
    .in('id', messageIds);
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!messages || messages.length === 0) return NextResponse.json({ urls: {} });

  // Même garde que upload-file/route.ts : l'appelant doit être coach OU élève de CHAQUE
  // conversation référencée par les messages demandés.
  const clientIds = [...new Set(messages.map(m => m.client_id))];
  const { data: clientRows } = await supabase
    .from('clients')
    .select('id, coach_id, profile_id')
    .in('id', clientIds);
  const allowedClientIds = new Set(
    (clientRows || [])
      .filter(c => c.coach_id === user.id || c.profile_id === user.id)
      .map(c => c.id)
  );

  const urls: Record<string, { url: string | null; thumbnailUrl: string | null }> = {};

  for (const m of messages) {
    if (!allowedClientIds.has(m.client_id) || !m.storage_bucket || !m.storage_path) continue;

    const { data: signed } = await supabase.storage
      .from(m.storage_bucket)
      .createSignedUrl(m.storage_path, SIGNED_URL_TTL_SECONDS);

    let thumbnailUrl: string | null = null;
    if (m.thumbnail_storage_path) {
      const { data: signedThumb } = await supabase.storage
        .from(m.storage_bucket)
        .createSignedUrl(m.thumbnail_storage_path, SIGNED_URL_TTL_SECONDS);
      thumbnailUrl = signedThumb?.signedUrl || null;
    }

    urls[m.id] = { url: signed?.signedUrl || null, thumbnailUrl };
  }

  return NextResponse.json({ urls });
}
