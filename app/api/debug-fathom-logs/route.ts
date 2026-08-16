import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Route de debug temporaire — lit webhook_debug_log (logs FathomRecordingSection)
// ET sw_logs (logs Service Worker, install/activate/claim) pour corréler les deux
// pistes du bug mobile "flash/reload". À supprimer une fois résolu.
export async function GET() {
  const [appLogs, swLogs] = await Promise.all([
    serviceSupabase
      .from('webhook_debug_log')
      .select('created_at, message, data')
      .ilike('message', '%FathomRecordingSection%')
      .order('created_at', { ascending: false })
      .limit(50),
    serviceSupabase
      .from('sw_logs')
      .select('created_at, event, data')
      .order('created_at', { ascending: false })
      .limit(30),
  ]);

  if (appLogs.error) return NextResponse.json({ error: appLogs.error.message }, { status: 500 });

  return NextResponse.json({
    items: appLogs.data,
    sw_items: swLogs.error ? { error: swLogs.error.message } : swLogs.data,
  });
}
