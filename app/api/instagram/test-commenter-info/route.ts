import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/instagram/test-commenter-info?commenter_id=XXX&media_id=YYY
// Teste toutes les infos récupérables sur un profil IG qui a commenté
// commenter_id = ig_user_id récupéré via webhook (ex: dans instagram_leads.ig_user_id)
export async function GET(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const commenterId = searchParams.get('commenter_id');
  const mediaId = searchParams.get('media_id');

  const { data: integ } = await serviceSupabase
    .from('integrations')
    .select('access_token, metadata')
    .eq('profile_id', user.id)
    .eq('provider', 'instagram')
    .single();

  if (!integ?.access_token) return NextResponse.json({ error: 'no_token' }, { status: 404 });

  const token = integ.access_token;
  const igAccountId = (integ.metadata as any)?.ig_account_id;

  const results: Record<string, any> = { commenter_id: commenterId, media_id: mediaId };

  // Test 1 : infos disponibles via le champ from d'un commentaire sur un média
  if (mediaId) {
    const commentsRes = await fetch(
      `https://graph.instagram.com/v22.0/${mediaId}/comments?fields=id,text,from,timestamp&limit=5&access_token=${token}`
    );
    const commentsData = await commentsRes.json();
    results.media_comments = commentsData;

    // Cherche le commentaire du commenter_id si fourni
    if (commenterId && commentsData?.data) {
      const match = commentsData.data.find((c: any) => c.from?.id === commenterId);
      results.matched_comment = match || null;
      results.commenter_from_field = match?.from || null;
      results.note_from_field = "Le champ 'from' retourne : id (ig_user_id) et username uniquement. Pas de nom complet ni de prénom.";
    }
  }

  // Test 2 : si on a un commenter_id, essaie de récupérer son profil directement
  if (commenterId) {
    // Tentative GET /{commenter_id}?fields=name,username,profile_pic
    // Note : accès limité selon les permissions de l'app
    const profileRes = await fetch(
      `https://graph.instagram.com/v22.0/${commenterId}?fields=id,name,username,profile_picture_url,biography&access_token=${token}`
    );
    const profileData = await profileRes.json();
    results.commenter_profile_direct = profileData;
    results.note_profile = "Accès direct au profil du commenter — souvent bloqué si pas de permissions avancées (instagram_manage_messages requis).";
  }

  // Test 3 : via les conversations — si une conv existe avec ce user
  if (commenterId && igAccountId) {
    const convRes = await fetch(
      `https://graph.instagram.com/v22.0/${igAccountId}/conversations?user_id=${commenterId}&fields=id,participants&access_token=${token}`
    );
    const convData = await convRes.json();
    results.conversations = convData;

    // Si une conv existe, récupère les participants avec leurs infos
    if (convData?.data?.[0]?.id) {
      const convId = convData.data[0].id;
      const participantsRes = await fetch(
        `https://graph.instagram.com/v22.0/${convId}?fields=participants{id,name,username,profile_pic}&access_token=${token}`
      );
      const participantsData = await participantsRes.json();
      results.conversation_participants = participantsData;
      results.note_participants = "Via les participants d'une conversation — peut retourner name si la permission instagram_manage_messages est accordée.";
    }
  }

  results.summary = {
    available_from_webhook: ["ig_user_id (commenter_id)", "ig_username"],
    available_via_from_field: ["id", "username"],
    potentially_via_conversations: ["id", "username", "name (si permission)"],
    not_available: ["prénom seul", "email", "nom complet sans permissions avancées"],
    recommendation: "Le 'username' IG est la donnée la plus fiable. Le 'name' est disponible via les conversations si l'app a la permission instagram_manage_messages.",
  };

  return NextResponse.json(results);
}
