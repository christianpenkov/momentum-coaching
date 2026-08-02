import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Appelé depuis /invite/callback juste après l'établissement de session. Lie
// clients.profile_id à l'utilisateur connecté — impossible à faire côté client
// (anon key) car la policy RLS sur clients (coach_id = auth.uid() OR profile_id =
// auth.uid()) ne peut jamais être vraie tant que profile_id n'est pas encore posé :
// l'élève ne peut ni se voir comme coach, ni comme profile_id (justement ce qu'on
// cherche à établir). Utilise la clé service-role pour bypass cette RLS.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  // Le client_id demandé doit correspondre à celui posé dans les métadonnées de
  // l'invitation (inviteUserByEmail data: { client_id }) — empêche un élève de
  // réclamer la fiche d'un autre en devinant/modifiant un client_id arbitraire.
  const metadataClientId = user.user_metadata?.client_id as string | undefined;
  if (!metadataClientId) return NextResponse.json({ error: 'Aucune invitation associée' }, { status: 400 });

  // Pré-remplit profiles.full_name avec le nom saisi par le coach à l'invitation
  // (clients.name) — sans ça l'élève arrive sur un profil "sans nom" alors que le
  // coach en a déjà renseigné un. profiles.full_name devient ensuite la seule source
  // de vérité : l'élève peut le modifier dans ses réglages, et ce changement se
  // répercute partout côté coach (plus jamais lu depuis clients.name une fois lié).
  const { data: inviteClient } = await serviceSupabase
    .from('clients')
    .select('name')
    .eq('id', metadataClientId)
    .single();

  await serviceSupabase.from('profiles').upsert({
    id: user.id,
    role: 'client',
    full_name: user.user_metadata?.full_name || inviteClient?.name || null,
  });

  const { data: clientRow, error: updateErr } = await serviceSupabase
    .from('clients')
    .update({ profile_id: user.id })
    .eq('id', metadataClientId)
    .is('profile_id', null)
    .select('coach_id')
    .single();

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  return NextResponse.json({ coach_id: clientRow?.coach_id ?? null });
}
