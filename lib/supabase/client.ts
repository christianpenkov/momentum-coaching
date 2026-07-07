import { createBrowserClient } from '@supabase/ssr';
import type { RealtimeClientOptions } from '@supabase/realtime-js';

export function createClient(realtimeOptions?: RealtimeClientOptions) {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    realtimeOptions ? { realtime: realtimeOptions } : undefined
  );
}
