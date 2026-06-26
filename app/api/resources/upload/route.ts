import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

// Force Node.js runtime (pdf-to-img uses pdfjs-dist, incompatible with Edge)
export const runtime = 'nodejs';

const MAX_SIZE = 50 * 1024 * 1024; // 50 MB

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

async function generatePdfThumbnail(
  bytes: ArrayBuffer
): Promise<{ thumbnail: Uint8Array; pageCount: number } | null> {
  try {
    const { pdf } = await import('pdf-to-img');
    const doc = await pdf(new Uint8Array(bytes), { scale: 1.5 });
    const pageCount = doc.length;
    // Only need the first page
    const firstPage = await doc.getPage(1);
    return { thumbnail: firstPage, pageCount };
  } catch (err) {
    console.error('[upload] PDF thumbnail error:', err);
    return null;
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profile?.role !== 'coach') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const form = await req.formData();
  const file = form.get('file') as File | null;
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  if (file.size > MAX_SIZE) return NextResponse.json({ error: 'File too large (max 50MB)' }, { status: 400 });

  const ext = file.name.split('.').pop() || 'bin';
  const baseName = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const path = `${user.id}/${baseName}.${ext}`;

  const bytes = await file.arrayBuffer();
  const { error } = await supabase.storage
    .from('resources')
    .upload(path, bytes, { contentType: file.type, upsert: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: { publicUrl } } = supabase.storage.from('resources').getPublicUrl(path);

  // Generate PDF thumbnail if applicable
  let thumbnailUrl: string | null = null;
  let pageCount: number | null = null;

  if (isPdf(file)) {
    const result = await generatePdfThumbnail(bytes);
    if (result) {
      pageCount = result.pageCount;
      const thumbPath = `${user.id}/thumbs/${baseName}.jpg`;
      const { error: thumbErr } = await supabase.storage
        .from('resources')
        .upload(thumbPath, result.thumbnail, { contentType: 'image/jpeg', upsert: false });

      if (!thumbErr) {
        thumbnailUrl = supabase.storage.from('resources').getPublicUrl(thumbPath).data.publicUrl;
      }
    }
  }

  return NextResponse.json({
    url: publicUrl,
    path,
    name: file.name,
    size: file.size,
    type: file.type,
    thumbnail_url: thumbnailUrl,
    page_count: pageCount,
  });
}
