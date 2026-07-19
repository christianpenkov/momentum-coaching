import { createClient as createServerClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isPdfFile, generatePdfThumbnail } from '@/lib/pdfThumbnail';
import sharp from 'sharp';

// Force Node.js runtime (pdf-to-img → pdfjs-dist, incompatible avec Edge).
export const runtime = 'nodejs';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const MAX_DOC_SIZE = 20 * 1024 * 1024;

async function assertAccess(userId: string, taskId: string) {
  const { data: task } = await serviceSupabase
    .from('tasks')
    .select('id, client_id, clients(coach_id, profile_id)')
    .eq('id', taskId)
    .single();
  if (!task) return { allowed: false };
  const client = Array.isArray(task.clients) ? task.clients[0] : task.clients;
  return { allowed: client?.coach_id === userId || client?.profile_id === userId };
}

// POST /api/tasks/[id]/attachments — dépôt d'un document sur une tâche.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: taskId } = await params;
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { allowed } = await assertAccess(user.id, taskId);
  if (!allowed) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

  const form = await req.formData();
  const file = form.get('file') as File | null;
  if (!file) return NextResponse.json({ error: 'Fichier manquant' }, { status: 400 });

  const isImage = file.type.startsWith('image/');
  const maxSize = isImage ? MAX_IMAGE_SIZE : MAX_DOC_SIZE;
  if (file.size > maxSize) return NextResponse.json({ error: 'Fichier trop volumineux' }, { status: 400 });

  const ext = file.name.split('.').pop() || 'bin';
  const baseName = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const path = `${taskId}/${baseName}.${ext}`;

  const bytes = await file.arrayBuffer();
  const { error: uploadErr } = await serviceSupabase.storage
    .from('task-attachments')
    .upload(path, bytes, { contentType: file.type });
  if (uploadErr) return NextResponse.json({ error: uploadErr.message }, { status: 500 });

  const { data: { publicUrl } } = serviceSupabase.storage.from('task-attachments').getPublicUrl(path);

  let thumbnailUrl: string | null = null;
  if (!isImage && isPdfFile(file)) {
    const result = await generatePdfThumbnail(bytes);
    if (result) {
      const thumbPath = `${taskId}/thumbs/${baseName}.jpg`;
      const { error: thumbErr } = await serviceSupabase.storage
        .from('task-attachments')
        .upload(thumbPath, result.thumbnail, { contentType: 'image/jpeg' });
      if (!thumbErr) {
        thumbnailUrl = serviceSupabase.storage.from('task-attachments').getPublicUrl(thumbPath).data.publicUrl;
      }
    }
  } else if (isImage) {
    try {
      const thumbBuffer = await sharp(Buffer.from(bytes))
        .resize({ width: 800, withoutEnlargement: true })
        .webp({ quality: 70 })
        .toBuffer();
      const thumbPath = `${taskId}/thumbs/${baseName}.webp`;
      const { error: thumbErr } = await serviceSupabase.storage
        .from('task-attachments')
        .upload(thumbPath, thumbBuffer, { contentType: 'image/webp' });
      if (!thumbErr) {
        thumbnailUrl = serviceSupabase.storage.from('task-attachments').getPublicUrl(thumbPath).data.publicUrl;
      }
    } catch {
      // Format d'image non supporté par sharp (rare) — thumbnailUrl reste null.
    }
  }

  const { data: attachment, error: insertErr } = await serviceSupabase
    .from('task_attachments')
    .insert({
      task_id: taskId,
      uploaded_by: user.id,
      file_url: publicUrl,
      thumbnail_url: thumbnailUrl,
      file_name: file.name,
      file_size_bytes: file.size,
      file_type: file.type,
    })
    .select()
    .single();

  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });
  return NextResponse.json({ attachment });
}

// GET /api/tasks/[id]/attachments — liste des pièces jointes d'une tâche.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: taskId } = await params;
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { allowed } = await assertAccess(user.id, taskId);
  if (!allowed) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

  const { data, error } = await serviceSupabase
    .from('task_attachments')
    .select('*')
    .eq('task_id', taskId)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ attachments: data });
}
