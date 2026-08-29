import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }); }

  const { ig_username, scheduled_at, duration, invitee_name, invitee_email, call_type, manual_override, source, is_follow_up, parent_call_id, join_url } = body;
  if (!scheduled_at) return NextResponse.json({ error: 'scheduled_at requis' }, { status: 400 });

  // Un 2e call herite de l'IDENTITE ET DE L'ORIGINE de son parent.
  //
  // RapportModal ne transmet que `invitee_name` : il ne recoit pas l'e-mail en
  // props, et le lui faire traverser imposerait de modifier les sept ecrans qui
  // ouvrent le modal. Il connait en revanche le `callId` du call rapporte, d'ou
  // ce `parent_call_id` : la route va chercher l'identite a la source.
  //
  // Sans cela le 2e call n'avait qu'un nom quand le premier avait un e-mail, et
  // rien ne les reliait en base. lib/callSeries.ts sait desormais les rapprocher
  // par le nom, mais rattraper a la lecture ne remplace pas une donnee juste :
  // l'e-mail sert aussi aux liens de paiement et a la fiche prospect.
  //
  // `.eq('coach_id', user.id)` : sans ce filtre, un id devine permettrait de lire
  // l'e-mail d'un prospect appartenant a un autre coach.
  //
  // ── L'origine s'herite, elle ne se recree pas ───────────────────────────────
  // La tentation est de generer un nouveau lien tracke pour le 2e rendez-vous.
  // Ce serait attribuer DEUX FOIS la meme personne : une fois a sa vraie origine,
  // une fois au nouveau lien. Une acquisition, deux entrees dans les entonnoirs,
  // et un revenu coupe en deux sources.
  //
  // La plateforme applique deja exactement cette regle aux reprogrammations
  // (`inheritedUtmContent`, `inheritedSource`... dans le webhook Calendly) : « la
  // valeur heritee prime, pour qu'ils decrivent tous le premier contact et jamais
  // un melange de deux moments ». Un 2e call est la meme situation : la meme
  // opportunite qui continue.
  //
  // L'heritee PRIME sur celle du corps de requete — RapportModal envoie
  // `source: 'manual'`, qui ne sert plus que de repli si le parent n'a pas d'origine.
  //
  // Cote entonnoir, ce call n'ajoute rien au haut du tunnel : il n'est produit par
  // aucun nouveau clic, et PageClientStats compte des opportunites, continuations
  // exclues. Il porte en revanche son revenu vers la bonne plateforme.
  //
  // `.eq('coach_id', user.id)` : sans ce filtre, un id devine permettrait de lire
  // l'attribution d'un prospect appartenant a un autre coach.
  let parent: {
    invitee_email: string | null; source: string | null;
    utm_medium: string | null; utm_campaign: string | null;
    utm_content: string | null; utm_term: string | null;
    short_link_path: string | null; prospect_link_id: string | null;
    ig_lead_id: string | null; prospect_id: string | null;
  } | null = null;
  if (parent_call_id) {
    const { data } = await supa
      .from('calls')
      .select('invitee_email, source, utm_medium, utm_campaign, utm_content, utm_term, short_link_path, prospect_link_id, ig_lead_id, prospect_id')
      .eq('id', parent_call_id)
      .eq('coach_id', user.id)
      .maybeSingle();
    parent = data ?? null;
  }

  // Récupérer le lead et le prospect_link pour lier le call
  const [{ data: lead }, { data: pl }] = await Promise.all([
    ig_username
      ? supa.from('instagram_leads').select('id').eq('profile_id', user.id).eq('ig_username', ig_username.toLowerCase()).maybeSingle()
      : Promise.resolve({ data: null }),
    ig_username
      ? supa.from('prospect_links').select('id, short_url').eq('profile_id', user.id).eq('ig_username', ig_username.toLowerCase()).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const shortLinkPath = pl?.short_url
    ? (() => { try { return new URL(pl.short_url).pathname.slice(1); } catch { return null; } })()
    : null;

  const { data: newCall, error } = await supa.from('calls').insert({
    coach_id: user.id,
    ig_lead_id: lead?.id ?? parent?.ig_lead_id ?? null,
    prospect_link_id: pl?.id ?? parent?.prospect_link_id ?? null,
    prospect_id: parent?.prospect_id ?? null,
    short_link_path: shortLinkPath ?? parent?.short_link_path ?? null,
    invitee_name: invitee_name ?? ig_username ?? null,
    invitee_email: invitee_email ?? parent?.invitee_email ?? null,
    utm_medium: parent?.utm_medium ?? null,
    utm_campaign: parent?.utm_campaign ?? null,
    utm_content: parent?.utm_content ?? null,
    utm_term: parent?.utm_term ?? null,
    scheduled_at,
    // Sans lien de visio, le prospect n'a rien a rejoindre, aucun ecran n'affiche
    // de bouton « Rejoindre », et Fathom perd son rattachement le plus sur (URL
    // exacte) — il ne lui reste que « e-mail + creneau a 30 min pres ».
    join_url: typeof join_url === 'string' && join_url.trim() ? join_url.trim() : null,
    duration: duration ?? '60 min',
    status: 'active',
    call_type: call_type ?? 'manual',
    manual_override: manual_override ?? true,
    source: parent?.source ?? source ?? 'ig',
    is_follow_up: is_follow_up ?? false,
    booked_at: new Date().toISOString(),
  }).select('id').single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, callId: newCall.id });
}
