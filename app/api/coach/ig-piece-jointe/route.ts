import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

/**
 * Le contenu d'une pièce jointe, redemandé à Meta au moment où quelqu'un regarde.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ POURQUOI ON NE STOCKE RIEN                                                │
 * │                                                                           │
 * │ 14 % des messages portent une pièce jointe. Les ré-héberger remplirait le │
 * │ gigaoctet gratuit de stockage en neuf jours — et les URL de Meta expirent  │
 * │ de toute façon, donc une copie vieillirait sans qu'on le sache.            │
 * │                                                                           │
 * │ On garde donc le `mid` brut — et UNIQUEMENT pour ces messages-là, parce    │
 * │ qu'il fait 164 caractères — et on redemande le contenu ici. Coût : un      │
 * │ appel quand quelqu'un clique, zéro le reste du temps.                      │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ MESURE DU 2026-09-04 : la majorité des « pièces jointes » d'un fil de lead
 * ne sont pas des médias, ce sont les DM à bouton que la plateforme envoie
 * elle-même (`generic_template`). Les afficher comme « Pièce jointe » était donc
 * faux dans le cas le plus fréquent. Meta rend leur titre et le libellé du
 * bouton, on les rend tels quels.
 */

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type Contenu =
  | { forme: 'template'; titre: string; bouton: string | null; url: string | null }
  | { forme: 'media'; type: 'image' | 'video' | 'audio' | 'fichier'; url: string }
  | { forme: 'story'; url: string | null }
  | { forme: 'indisponible'; motif: string };

export async function GET(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const id = new URL(request.url).searchParams.get('message_id');
  if (!id) return NextResponse.json({ error: 'message_id requis' }, { status: 400 });

  const { data: msg } = await supa
    .from('ig_messages').select('mid, profile_id').eq('id', id).maybeSingle();
  if (!msg?.mid) return NextResponse.json({ error: 'Introuvable' }, { status: 404 });

  // Deux personnes ont le droit de regarder : l'élève, et son coach s'il a
  // l'accord. Le filtre porte sur l'identité authentifiée, jamais sur un
  // identifiant reçu — un `profile_id` est public depuis le 2026-08-31.
  let autorise = msg.profile_id === user.id;
  if (!autorise) {
    const { data: lien } = await supa
      .from('clients').select('id')
      .eq('profile_id', msg.profile_id).eq('coach_id', user.id)
      .not('ig_dm_lecture_accordee_le', 'is', null).is('archived_at', null).maybeSingle();
    autorise = !!lien;
  }
  if (!autorise) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

  const { data: integ } = await supa
    .from('integrations').select('access_token')
    .eq('profile_id', msg.profile_id).eq('provider', 'instagram').maybeSingle();
  if (!integ?.access_token) {
    return NextResponse.json({ forme: 'indisponible', motif: 'Instagram n’est plus connecté' } as Contenu);
  }

  let brut: any;
  try {
    brut = await (await fetch(
      `https://graph.instagram.com/v23.0/${encodeURIComponent(msg.mid)}` +
      `?fields=attachments,story&access_token=${integ.access_token}`
    )).json();
  } catch {
    return NextResponse.json({ forme: 'indisponible', motif: 'Instagram n’a pas répondu' } as Contenu);
  }

  // ⚠️ On DIT que le média a expiré plutôt que d'afficher un cadre cassé. Meta
  // finit par ne plus rendre les médias anciens, et c'est un cas normal, pas une
  // panne de la plateforme.
  if (brut?.error) {
    return NextResponse.json({
      forme: 'indisponible',
      motif: 'Instagram ne rend plus ce contenu',
    } as Contenu);
  }

  const att = brut?.attachments?.data?.[0];

  const gabarit = att?.generic_template;
  if (gabarit) {
    const cta = gabarit.cta?.[0] ?? gabarit.buttons?.[0];
    return NextResponse.json({
      forme: 'template',
      titre: gabarit.title ?? '',
      bouton: cta?.title ?? null,
      url: cta?.url ?? null,
    } as Contenu);
  }

  const media =
    (att?.image_data?.url && { type: 'image' as const, url: att.image_data.url }) ||
    (att?.video_data?.url && { type: 'video' as const, url: att.video_data.url }) ||
    (att?.audio_data?.url && { type: 'audio' as const, url: att.audio_data.url }) ||
    (att?.file_url && { type: 'fichier' as const, url: att.file_url });

  if (media) return NextResponse.json({ forme: 'media', ...media } as Contenu);
  if (brut?.story) return NextResponse.json({ forme: 'story', url: brut.story?.link ?? null } as Contenu);

  return NextResponse.json({ forme: 'indisponible', motif: 'Contenu non lisible' } as Contenu);
}
