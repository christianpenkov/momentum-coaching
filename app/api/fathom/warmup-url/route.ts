import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/fathom/warmup-url — retourne l'URL d'embed d'un enregistrement Fathom
// quelconque, utilisée uniquement pour préchauffer la connexion réseau vers
// fathom.video (voir FathomPreconnect.tsx). Le contenu réel n'a aucune
// importance : l'iframe est invisible, seul compte le fait qu'iOS Safari ait
// déjà établi DNS/TLS/processus tiers vers ce domaine avant le premier clic
// réel de l'utilisateur.
export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { data } = await serviceSupabase
    .from('calls')
    .select('fathom_share_url')
    .eq('fathom_status', 'matched')
    .not('fathom_share_url', 'is', null)
    .limit(1)
    .maybeSingle();

  if (!data?.fathom_share_url) return NextResponse.json({ embedUrl: null });

  const embedUrl = `${data.fathom_share_url.replace('/share/', '/embed/')}?autoplay=0&preload=none`;
  return NextResponse.json({ embedUrl });
}
