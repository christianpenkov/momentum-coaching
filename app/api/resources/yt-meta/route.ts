import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

const ALLOWED_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'youtu.be', 'm.youtube.com']);

function parseISO8601Duration(s: string): number | null {
  const m = s.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return null;
  return (parseInt(m[1] || '0') * 3600) + (parseInt(m[2] || '0') * 60) + parseInt(m[3] || '0');
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const url = new URL(req.url).searchParams.get('url');
  if (!url) return Response.json({ title: null, duration: null });

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ error: 'URL invalide' }, { status: 400 });
  }
  if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname)) {
    return NextResponse.json({ error: 'Domaine non autorisé' }, { status: 400 });
  }

  const [oembedRes, pageRes] = await Promise.all([
    fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`),
    fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' } }),
  ]);

  const title = oembedRes.ok ? ((await oembedRes.json()).title ?? null) : null;
  const html = pageRes.ok ? await pageRes.text() : '';
  const m = html.match(/<meta itemprop="duration" content="([^"]+)">/);
  const duration = m ? parseISO8601Duration(m[1]) : null;

  return Response.json({ title, duration });
}
