import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Route de logging générique pour le debug côté navigateur (mobile notamment,
// où il n'y a pas de console accessible) — écrit dans webhook_debug_log comme
// tous les autres logs serveur, cf. convention du projet (jamais de logs
// Vercel/console.log pour investiguer, toujours en base).
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { message, data } = body;
  if (!message) return NextResponse.json({ ok: false }, { status: 400 });

  await serviceSupabase.from('webhook_debug_log').insert({ message: String(message), data: data ?? {} });
  return NextResponse.json({ ok: true });
}
