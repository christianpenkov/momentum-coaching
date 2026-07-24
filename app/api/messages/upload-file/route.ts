import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { isPdfFile, generatePdfThumbnail } from '@/lib/pdfThumbnail';
import sharp from 'sharp';

// Force Node.js runtime (pdf-to-img → pdfjs-dist, incompatible avec Edge).
export const runtime = 'nodejs';

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const MAX_DOC_SIZE = 20 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const form = await req.formData();
  const file = form.get('file') as File | null;
  const clientId = form.get('client_id') as string | null;
  const caption = (form.get('caption') as string | null) || null;
  const replyToId = (form.get('reply_to_id') as string | null) || null;
  if (!file || !clientId) return NextResponse.json({ error: 'Champs manquants' }, { status: 400 });

  // Vérifie que l'utilisateur (coach OU élève) est bien lié à cette conversation —
  // même garde que les policies RLS existantes sur messages.
  const { data: clientRow } = await supabase
    .from('clients')
    .select('id, coach_id, profile_id')
    .eq('id', clientId)
    .maybeSingle();
  if (!clientRow || (clientRow.coach_id !== user.id && clientRow.profile_id !== user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const isImage = file.type.startsWith('image/');
  const type: 'image' | 'document' = isImage ? 'image' : 'document';
  const maxSize = isImage ? MAX_IMAGE_SIZE : MAX_DOC_SIZE;
  if (file.size > maxSize) return NextResponse.json({ error: 'Fichier trop volumineux' }, { status: 400 });

  const ext = file.name.split('.').pop() || 'bin';
  const baseName = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const path = `${clientId}/${baseName}.${ext}`;

  const bytes = await file.arrayBuffer();
  const { error: uploadErr } = await supabase.storage
    .from('chat-medias')
    .upload(path, bytes, { contentType: file.type });
  if (uploadErr) return NextResponse.json({ error: uploadErr.message }, { status: 500 });

  const { data: { publicUrl } } = supabase.storage.from('chat-medias').getPublicUrl(path);

  let thumbnailUrl: string | null = null;
  let thumbnailPath: string | null = null;
  let pageCount: number | null = null;
  if (!isImage && isPdfFile(file)) {
    const result = await generatePdfThumbnail(bytes);
    if (result) {
      pageCount = result.pageCount;
      const thumbPath = `${clientId}/thumbs/${baseName}.jpg`;
      const { error: thumbErr } = await supabase.storage
        .from('chat-medias')
        .upload(thumbPath, result.thumbnail, { contentType: 'image/jpeg' });
      if (!thumbErr) {
        thumbnailUrl = supabase.storage.from('chat-medias').getPublicUrl(thumbPath).data.publicUrl;
        thumbnailPath = thumbPath;
      }
    }
  } else if (isImage) {
    // Miniature basse résolution pour un chargement rapide du feed — l'original (uploadé
    // ci-dessus) reste utilisé pour le lightbox plein écran (voir onOpenLightbox côté client).
    try {
      const thumbBuffer = await sharp(Buffer.from(bytes))
        .resize({ width: 800, withoutEnlargement: true })
        .webp({ quality: 70 })
        .toBuffer();
      const thumbPath = `${clientId}/thumbs/${baseName}.webp`;
      const { error: thumbErr } = await supabase.storage
        .from('chat-medias')
        .upload(thumbPath, thumbBuffer, { contentType: 'image/webp' });
      if (!thumbErr) {
        thumbnailUrl = supabase.storage.from('chat-medias').getPublicUrl(thumbPath).data.publicUrl;
        thumbnailPath = thumbPath;
      }
    } catch {
      // Format d'image non supporté par sharp (rare) — thumbnailUrl reste null, le feed
      // retombe sur l'original (msg.thumbnail_url || msg.audio_url), pas de crash.
    }
  }

  const { data: message, error: insertErr } = await supabase
    .from('messages')
    .insert({
      client_id: clientId, sender_id: user.id, text: file.name, type,
      audio_url: publicUrl, caption: caption?.trim() || null, reply_to_id: replyToId,
      file_size_bytes: file.size, page_count: pageCount, thumbnail_url: thumbnailUrl,
      storage_bucket: 'chat-medias', storage_path: path, thumbnail_storage_path: thumbnailPath,
      read: false,
    })
    .select('id, text, sender_id, created_at, type, audio_url, duration_s, read_at, read, listened_at, edited_at, caption, reply_to_id, reaction_emoji, reaction_by, file_size_bytes, page_count, thumbnail_url')
    .single();

  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

  return NextResponse.json({ message });
}
