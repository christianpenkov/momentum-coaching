import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Route de debug temporaire — lit webhook_debug_log pour investiguer le bug
// mobile "flash/reload" sur FathomRecordingSection. À supprimer une fois résolu.
export async function GET() {
  const { data, error } = await serviceSupabase
    .from('webhook_debug_log')
    .select('created_at, message, data')
    .ilike('message', '%FathomRecordingSection%')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data });
}
