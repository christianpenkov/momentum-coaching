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
  | { forme: 'partage'; lien: string }
  | { forme: 'story'; url: string }
  | { forme: 'indisponible'; motif: string };

export async function GET(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const id = params.get('message_id');
  // `media=1` renvoie les OCTETS au lieu de la description. Voir plus bas.
  const enOctets = params.get('media') === '1';
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
      `?fields=attachments,shares,story,is_unsupported&access_token=${integ.access_token}`
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

  // ⚠️ META LE DIT LUI-MÊME. Certains types de message ne sont pas exposés par
  // l'API — les messages vocaux en font partie — et Meta le déclare par un champ
  // dédié plutôt que par une réponse vide. Mesuré le 2026-09-04 : sur un vocal,
  // `attachments`, `shares` et `story` reviennent tous vides, et
  // `is_unsupported` vaut `true`.
  //
  // Sans ce champ, l'écran affichait « Contenu non lisible », ce qui laissait
  // croire à une panne de la plateforme. La différence entre « je n'ai pas su
  // lire » et « Instagram refuse de le donner » compte : la première invite à
  // chercher un bug, la seconde clôt la question.
  if (brut?.is_unsupported === true) {
    return NextResponse.json({
      forme: 'indisponible',
      motif: 'Instagram ne rend pas ce type de message par son API',
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

  const source = media?.url ?? brut?.story?.reply_to?.link ?? null;

  if (enOctets && source) {
    const amont = await fetch(source);
    if (!amont.ok || !amont.body) {
      return NextResponse.json({ error: 'Média indisponible' }, { status: 404 });
    }
    return new Response(amont.body, {
      headers: {
        'content-type': amont.headers.get('content-type') || 'application/octet-stream',
        // Privé : le média appartient à une conversation, il ne doit pas
        // atterrir dans un cache partagé. Court, parce que l'URL amont expire.
        'cache-control': 'private, max-age=600',
      },
    });
  }

  if (media) {
    // ┌───────────────────────────────────────────────────────────────────────┐
    // │ POURQUOI LES OCTETS PASSENT PAR ICI, ET PAS L'URL PAR LE NAVIGATEUR   │
    // │                                                                       │
    // │ Meta sert ces médias depuis `lookaside.fbsbx.com`. La CSP du projet   │
    // │ (next.config.ts) autorise `*.cdninstagram.com` et `*.fbcdn.net` —     │
    // │ pas `fbsbx.com`. Le navigateur bloquait donc l'image, et l'écran      │
    // │ affichait un cadre cassé. Mesuré le 2026-09-04 : l'URL répond 200     │
    // │ image/jpeg côté serveur, c'était bien la CSP.                          │
    // │                                                                       │
    // │ Élargir la CSP aurait été une ligne, mais : l'URL SIGNÉE se retrouve  │
    // │ dans le DOM, elle EXPIRE (donc l'écran recasse plus tard, sans que    │
    // │ rien ne le dise), et on ouvre le domaine bac à sable de Meta à toute  │
    // │ la plateforme. Servir les octets nous-mêmes garde la CSP fermée,      │
    // │ n'expose aucune URL signée, et permet de DIRE qu'un média a expiré.   │
    // └───────────────────────────────────────────────────────────────────────┘
    return NextResponse.json({
      forme: 'media', type: media.type,
      url: `/api/coach/ig-piece-jointe?message_id=${encodeURIComponent(id)}&media=1`,
    } as Contenu);
  }

  // Un contenu PARTAGÉ (reel, publication) : Meta rend son lien public, qui
  // n'expire pas. On l'ouvre chez Instagram plutôt que de le rapatrier.
  const partage = brut?.shares?.data?.[0]?.link;
  if (partage) return NextResponse.json({ forme: 'partage', lien: partage } as Contenu);

  // ⚠️ Le lien d'une story est sous `story.reply_to.link`, PAS `story.link` —
  // la première version lisait le mauvais chemin et rendait donc toujours null.
  // Et il pointe sur `lookaside.fbsbx.com`, que la CSP bloque : il passe par
  // notre route comme les autres médias.
  if (brut?.story?.reply_to?.link) {
    return NextResponse.json({
      forme: 'story',
      url: `/api/coach/ig-piece-jointe?message_id=${encodeURIComponent(id)}&media=1`,
    } as Contenu);
  }

  return NextResponse.json({ forme: 'indisponible', motif: 'Contenu non lisible' } as Contenu);
}
