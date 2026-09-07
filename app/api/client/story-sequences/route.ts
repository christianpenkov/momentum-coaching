import { NextResponse } from 'next/server';
import { construireDestinationShortio } from '@/lib/click-redirect';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
import { bornerArbitrage } from '@/lib/rattachementStories';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Le coach n'a jamais de ligne dans `clients` (table réservée aux élèves) — son URL
// Calendly perso vit sur profiles.calendly_url. Voir app/api/client/settings/route.ts.
async function getCalendlyUrl(profileId: string): Promise<string | null> {
  const { data: profile } = await serviceSupabase.from('profiles').select('role').eq('id', profileId).single();
  if (profile?.role === 'coach') {
    const { data } = await serviceSupabase.from('profiles').select('calendly_url').eq('id', profileId).single();
    return data?.calendly_url ?? null;
  }
  const { data } = await serviceSupabase.from('clients').select('calendly_url').eq('profile_id', profileId).single();
  return data?.calendly_url ?? null;
}

// Au-delà de ce délai, une séquence restée à 0 story n'attend plus rien : c'est
// une séquence dont les stories ont été archivées, pas une préparation en cours.
const FENETRE_PREPARATION_MS = 7 * 24 * 60 * 60 * 1000;

export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { data: sequences, error } = await serviceSupabase
    .from('story_sequences')
    // Les trois champs de l'étape du bouton accompagnent désormais les deux
    // messages historiques : `dm1_message` est le message du lien et
    // `dm2_story_message` la relance, malgré leurs noms (voir la migration
    // story_sequences_dm_unification).
    .select('id, name, cta_story_id, lm_id, lm_keyword, lm_url, dm_lm_message, dm_button_text, dm1_message, dm_link_button_text, dm2_story_message, calendly_short_url, created_at, stories_arbitrees_jusqua')
    .eq('profile_id', user.id)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const seqIds = (sequences || []).map(s => s.id);
  // story_sequences n'a pas de colonne archived_at propre (pas dans les 8 tables IG
  // migrées) — une séquence dont toutes les stories ont été archivées (bascule de
  // compte IG) doit disparaître ici aussi, sinon elle reste visible en "fantôme" avec
  // story_count=0. On ne compte donc que les stories actives.
  const { data: counts } = seqIds.length
    ? await serviceSupabase.from('ig_stories').select('sequence_id').in('sequence_id', seqIds).is('archived_at', null)
    : { data: [] };
  const countBySeq = new Map<string, number>();
  for (const row of counts || []) {
    countBySeq.set(row.sequence_id, (countBySeq.get(row.sequence_id) || 0) + 1);
  }

  // ── UNE SÉQUENCE SANS STORY N'EST PLUS UN FANTÔME ─────────────────────────
  //
  // Elle était filtrée parce qu'une séquence à 0 story ne pouvait signifier
  // qu'une chose : toutes ses stories avaient été archivées lors d'une bascule
  // de compte Instagram, et elle traînait vide.
  //
  // Depuis qu'on peut PRÉPARER une séquence avant de publier, 0 story veut aussi
  // dire « elle attend ses stories » — et c'est précisément l'état où le coach a
  // besoin de la voir, puisque c'est là qu'il vient chercher son lien Calendly.
  // Les deux se distinguent par `created_at` : un fantôme est ancien, une
  // séquence en préparation vient d'être créée.
  const fantome = (s: any) =>
    (countBySeq.get(s.id) || 0) === 0
    && Date.now() - new Date(s.created_at).getTime() > FENETRE_PREPARATION_MS;

  const rows = (sequences || [])
    .filter(s => !fantome(s))
    .map(s => ({ ...s, story_count: countBySeq.get(s.id) || 0 }));
  return NextResponse.json({ sequences: rows });
}

// Vérifie la contiguïté d'une séquence : entre sa première et sa dernière story, il
// ne doit y avoir AUCUNE autre story publiée — ni appartenant à une autre séquence,
// ni libre. Une séquence est un bloc continu.
// excludeSequenceId : la séquence en cours d'édition elle-même, à ne pas compter comme
// "autre séquence" (utilisé par l'ajout de stories à une séquence existante).
async function validateContiguity(
  profileId: string,
  finalStoryIds: string[],
  excludeSequenceId: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: selectedStories } = await serviceSupabase
    .from('ig_stories')
    .select('id, posted_at')
    .eq('profile_id', profileId)
    .in('id', finalStoryIds);
  if (!selectedStories || selectedStories.length !== finalStoryIds.length) {
    return { ok: false, error: 'Stories introuvables' };
  }
  const postedDates = selectedStories.map(s => new Date(s.posted_at).getTime());
  const minPosted = new Date(Math.min(...postedDates)).toISOString();
  const maxPosted = new Date(Math.max(...postedDates)).toISOString();

  // ── AUCUN TROU DANS UNE SÉQUENCE ──────────────────────────────────────────
  //
  // On lit TOUTES les stories publiées entre la première et la dernière de la
  // sélection, pas seulement celles qui appartiennent déjà à une séquence.
  //
  // Décision de Chris (2026-09-02) : « on ne publie jamais une story en plein
  // milieu d'une séquence ». Une story qui tombe dans l'intervalle sans être
  // sélectionnée est donc un oubli, pas un choix — et l'accepter en silence
  // ferait mentir toutes les statistiques de rétention de la séquence, qui
  // comparent la première story à la dernière en supposant qu'on les a vues à
  // la suite.
  //
  // `archived_at is null` : une story archivée a été retirée du compte ou
  // appartient à un compte Instagram précédent. Elle n'a jamais fait partie du
  // parcours qu'on mesure, elle ne peut donc pas en être un trou.
  let query = serviceSupabase
    .from('ig_stories')
    .select('id, sequence_id, story_sequences!ig_stories_sequence_id_fkey(name)')
    .eq('profile_id', profileId)
    .is('archived_at', null)
    .gt('posted_at', minPosted)
    .lt('posted_at', maxPosted)
    .not('id', 'in', `(${finalStoryIds.join(',')})`);
  if (excludeSequenceId) query = query.neq('sequence_id', excludeSequenceId);

  const { data: interleaved } = await query;
  if (interleaved && interleaved.length > 0) {
    // Deux messages : chevaucher une AUTRE séquence n'est pas la même erreur que
    // sauter une story libre, et la correction n'est pas la même non plus.
    const dansUneAutre = interleaved.find(s => (s as any).sequence_id);
    if (dansUneAutre) {
      const clashName = (dansUneAutre as any).story_sequences?.name || 'une autre séquence';
      return { ok: false, error: `Cette sélection chevauche la séquence « ${clashName} »` };
    }
    const n = interleaved.length;
    return {
      ok: false,
      error: `Il manque ${n} story${n > 1 ? 's' : ''} publiée${n > 1 ? 's' : ''} au milieu de cette sélection. Une séquence doit être continue — ajoute-la${n > 1 ? 's' : ''} ou resserre la sélection.`,
    };
  }
  return { ok: true };
}

// POST — crée une séquence à partir d'une sélection de stories. Les 2 blocs CTA
// (Lead Magnet / Calendly) sont indépendants, comme content_links pour les posts —
// au moins un des deux doit être fourni. Pour le CTA Calendly, génère un lien Short.io
// trackable classique (réutilise POST /api/shortio/links) que l'élève devra ajouter
// lui-même via le sticker "Lien" natif Instagram — impossible d'insérer un lien
// directement dans une story déjà publiée.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }); }

  const { name, ctaStoryId, storyIds, lmId, lmKeyword, lmUrl, dmLmMessage, dmButtonText, dm1Message, dmLinkButtonText, dm2StoryMessage, wantsCalendly } = body;
  const wantsLm = !!lmKeyword;

  // ── UNE SÉQUENCE PEUT NAÎTRE AVANT SES STORIES ────────────────────────────
  //
  // `ctaStoryId` et `storyIds` étaient obligatoires, ce qui interdisait le seul
  // ordre qui fonctionne dans la vraie vie : préparer le lien, publier avec le
  // sticker, rattacher ensuite. Une story publiée ne peut pas recevoir de lien
  // après coup.
  //
  // Le nom reste obligatoire — c'est lui qui nomme le lien Short.io et qui
  // permet de retrouver la séquence pour lui donner ses stories.
  const ids: string[] = Array.isArray(storyIds) ? storyIds : [];
  if (!name?.trim()) {
    return NextResponse.json({ error: 'Donne un nom à la séquence' }, { status: 400 });
  }
  // Le CTA ne peut désigner qu'une story qu'on rattache maintenant : le poser
  // sur une story absente laisserait une séquence qui se croit prête.
  if (ctaStoryId && !ids.includes(ctaStoryId)) {
    return NextResponse.json({ error: 'La story du CTA doit faire partie de la sélection' }, { status: 400 });
  }
  if (!wantsLm && !wantsCalendly) {
    return NextResponse.json({ error: 'Configure au moins un Lead Magnet ou un lien Calendly' }, { status: 400 });
  }

  // Les deux vérifications n'ont de sens que s'il y a des stories : une séquence
  // préparée n'en a aucune, elle ne peut ni voler ni trouer quoi que ce soit.
  if (ids.length > 0) {
    // Une story ne peut appartenir qu'à une seule séquence à la fois.
    const { data: alreadyAssigned } = await serviceSupabase
      .from('ig_stories')
      .select('id')
      .eq('profile_id', user.id)
      .in('id', ids)
      .not('sequence_id', 'is', null);
    if (alreadyAssigned && alreadyAssigned.length > 0) {
      return NextResponse.json({ error: 'Une des stories sélectionnées appartient déjà à une séquence' }, { status: 409 });
    }

    const contiguity = await validateContiguity(user.id, ids, null);
    if (!contiguity.ok) return NextResponse.json({ error: contiguity.error }, { status: 409 });
  }

  if (wantsCalendly) {
    const calendlyUrl = await getCalendlyUrl(user.id);
    if (!calendlyUrl) return NextResponse.json({ error: 'Aucun lien Calendly configuré dans les Réglages' }, { status: 400 });
    const { data: shortioInteg } = await serviceSupabase.from('integrations').select('api_key, metadata').eq('profile_id', user.id).eq('provider', 'shortio').single();
    if (!shortioInteg?.api_key || !(shortioInteg?.metadata as any)?.domain) return NextResponse.json({ error: 'Short.io non configuré' }, { status: 400 });
  }

  // Crée la séquence D'ABORD (avant le lien Calendly) pour disposer de son id — le
  // lien Short.io porte utm_content=seq.id, pivot d'attribution business daté au clic,
  // indépendant de l'état mutable de instagram_leads (voir matchesContent, TabFunnel).
  const { data: seq, error: seqErr } = await serviceSupabase
    .from('story_sequences')
    .insert({
      profile_id: user.id,
      name: name.trim(),
      cta_story_id: ctaStoryId || null,
      lm_keyword: wantsLm ? (lmKeyword || '').toUpperCase().trim() : null,
      lm_id: wantsLm ? (lmId || null) : null,
      lm_url: wantsLm ? (lmUrl || null) : null,
      dm_lm_message: wantsLm ? (dmLmMessage || null) : null,
      dm_button_text: wantsLm ? (dmButtonText || null) : null,
      dm1_message: wantsLm ? (dm1Message || null) : null,
      dm_link_button_text: wantsLm ? (dmLinkButtonText || null) : null,
      dm2_story_message: wantsLm ? (dm2StoryMessage || null) : null,
    })
    .select('id')
    .single();

  if (seqErr) return NextResponse.json({ error: seqErr.message }, { status: 500 });

  // `.in('id', [])` rattacherait zéro ligne, mais autant ne pas écrire du tout :
  // une séquence préparée n'a rien à rattacher, et l'appel dirait le contraire.
  if (ids.length > 0) {
    const { error: updateErr } = await serviceSupabase
      .from('ig_stories')
      .update({ sequence_id: seq.id })
      .in('id', ids)
      .eq('profile_id', user.id);
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  let calendlyShortUrl: string | null = null;

  if (wantsCalendly) {
    calendlyShortUrl = await generateCalendlyLink(user.id, seq.id, name);
  }

  return NextResponse.json({ id: seq.id, calendlyShortUrl });
}

async function generateCalendlyLink(profileId: string, sequenceId: string, name: string): Promise<string | null> {
  const calendlyUrl = await getCalendlyUrl(profileId);
  const { data: shortioInteg } = await serviceSupabase.from('integrations').select('api_key, metadata').eq('profile_id', profileId).eq('provider', 'shortio').single();
  if (!calendlyUrl || !shortioInteg?.api_key || !(shortioInteg?.metadata as any)?.domain) return null;
  const apiKey = shortioInteg.api_key;
  const domain = (shortioInteg.metadata as any).domain;

  // ── LE LIEN NE DIT PAS CE QU'IL Y A DERRIÈRE ────────────────────────────
  //
  // Il portait le nom de la séquence : « story-calendly-s-quence-test-lien ».
  // Ce lien est collé dans un sticker Instagram, donc lu par des inconnus — il
  // exposait le vocabulaire interne du coach, et ressemblait moins à une prise
  // de rendez-vous qu'à un lien qu'on n'ouvre pas.
  //
  // Même forme que les liens des posts : « prendre-rdv-XXXX ». Court, discret,
  // et il dit ce qu'on obtient en cliquant.
  //
  // Le suffixe vient de l'identifiant de la séquence : stable — régénérer ne
  // fabrique pas un second lien — et sans rapport avec le nom, qui peut changer.
  const suffixe = sequenceId.replace(/[^a-z0-9]/gi, '').slice(0, 4).toLowerCase();
  const path = `prendre-rdv-${suffixe}`;
  // La campagne UTM, elle, garde le nom : elle n'est jamais montrée à personne
  // et c'est ce qui rend la séquence reconnaissable dans les statistiques.
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

  const destUrl = new URL(calendlyUrl);
  destUrl.searchParams.set('utm_source', 'ig');
  destUrl.searchParams.set('utm_medium', 'story');
  destUrl.searchParams.set('utm_campaign', slug);
  destUrl.searchParams.set('utm_content', sequenceId);

  // Le lien de séquence est un lien PARTAGÉ : il passe par la route qui pose le
  // Click ID, sans quoi les rendez-vous venus d'une story resteraient anonymes.
  // Repli sur la destination directe si le domaine de redirection n'est pas
  // configuré — même comportement qu'avant ce chantier.
  const destFinale = construireDestinationShortio(
    process.env.MOMENTUM_REDIRECT_ORIGIN, path, destUrl.toString(), profileId,
  ) ?? destUrl.toString();

  const linkRes = await fetch('https://api.short.io/links', {
    method: 'POST',
    headers: { authorization: apiKey, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ domain, originalURL: destFinale, title: `Prendre RDV — ${name}`, path }),
  });
  const linkData = await linkRes.json().catch(() => ({}));
  if (linkRes.ok || linkRes.status === 409) {
    const shortUrl = linkData.secureShortURL || linkData.shortURL || null;
    if (shortUrl) {
      await serviceSupabase.from('story_sequences').update({ calendly_short_url: shortUrl, calendly_dest_url: calendlyUrl }).eq('id', sequenceId);
    }
    return shortUrl;
  }
  return null;
}

// PATCH — édite une séquence existante : nom/mot-clé LM/messages DM (déjà supporté),
// génération du lien Calendly après coup (generateCalendly: true), et composition
// (addStoryIds/removeStoryIds).
export async function PATCH(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }); }
  const { id, name, ctaStoryId, dmLmMessage, dmButtonText, dm1Message, dmLinkButtonText, dm2StoryMessage, lmKeyword, generateCalendly, addStoryIds, removeStoryIds, ecarteesIds } = body;
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 });

  const { data: seq, error: seqFetchErr } = await serviceSupabase
    .from('story_sequences')
    .select('id, name, cta_story_id, calendly_short_url, stories_arbitrees_jusqua')
    .eq('id', id)
    .eq('profile_id', user.id)
    .maybeSingle();
  if (seqFetchErr) return NextResponse.json({ error: seqFetchErr.message }, { status: 500 });
  if (!seq) return NextResponse.json({ error: 'Séquence introuvable' }, { status: 404 });

  // Rempli par le bloc d'ajout quand la séquence n'avait pas encore de CTA.
  let patchCta: string | null = null;
  // Rempli par le bloc d'ajout : la parution la plus récente arbitrée.
  let patchArbitrage: string | null = null;

  // ── Retrait de stories ──────────────────────────────────────────────────
  if (Array.isArray(removeStoryIds) && removeStoryIds.length > 0) {
    const { data: currentStories } = await serviceSupabase
      .from('ig_stories')
      .select('id')
      .eq('profile_id', user.id)
      .eq('sequence_id', id);
    const currentIds = (currentStories || []).map(s => s.id);
    const remainingIds = currentIds.filter(sid => !removeStoryIds.includes(sid));

    if (remainingIds.length > 0 && removeStoryIds.includes(seq.cta_story_id)) {
      return NextResponse.json({ error: 'Déplace d\'abord le CTA sur une autre story avant de la retirer' }, { status: 409 });
    }

    if (remainingIds.length === 0) {
      // Dernière story retirée — supprime la séquence entière, les stories redeviennent libres.
      const { error: delErr } = await serviceSupabase.from('story_sequences').delete().eq('id', id).eq('profile_id', user.id);
      if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
      return NextResponse.json({ ok: true, sequenceDeleted: true });
    }

    // Une story retirée redevient libre, mais sa parution précède la borne
    // `stories_arbitrees_jusqua` : elle ne se reproposera donc pas au bandeau de
    // cette séquence. C'est voulu — on vient de la retirer exprès. Elle reste
    // regroupable ailleurs depuis l'onglet Stories, il n'y a pas de cul-de-sac.
    const { error: removeErr } = await serviceSupabase
      .from('ig_stories')
      .update({ sequence_id: null })
      .in('id', removeStoryIds)
      .eq('profile_id', user.id);
    if (removeErr) return NextResponse.json({ error: removeErr.message }, { status: 500 });
  }

  // ── Ajout de stories ────────────────────────────────────────────────────
  if (Array.isArray(addStoryIds) && addStoryIds.length > 0) {
    const { data: alreadyAssigned } = await serviceSupabase
      .from('ig_stories')
      .select('id')
      .eq('profile_id', user.id)
      .in('id', addStoryIds)
      .not('sequence_id', 'is', null);
    if (alreadyAssigned && alreadyAssigned.length > 0) {
      return NextResponse.json({ error: 'Une des stories sélectionnées appartient déjà à une séquence' }, { status: 409 });
    }

    const { data: currentStories } = await serviceSupabase
      .from('ig_stories')
      .select('id')
      .eq('profile_id', user.id)
      .eq('sequence_id', id);
    const finalStoryIds = [...new Set([...(currentStories || []).map(s => s.id), ...addStoryIds])];

    const contiguity = await validateContiguity(user.id, finalStoryIds, id);
    if (!contiguity.ok) return NextResponse.json({ error: contiguity.error }, { status: 409 });

    const { error: addErr } = await serviceSupabase
      .from('ig_stories')
      .update({ sequence_id: id })
      .in('id', addStoryIds)
      .eq('profile_id', user.id);
    if (addErr) return NextResponse.json({ error: addErr.message }, { status: 500 });

    // ── LE RATTACHEMENT DIT AUSSI CE QU'ON A ÉCARTÉ ─────────────────────────
    //
    // Au moment où le coach clique « Les rattacher », les stories qui lui étaient
    // proposées et qu'il n'a pas cochées sont celles dont il ne veut pas. Une
    // borne suffit donc à ne plus les proposer : il n'y a rien à mémoriser du
    // refus lui-même, l'acceptation le dit déjà.
    //
    // Elle remplace un `localStorage` par appareil — un refus cliqué sur
    // l'ordinateur réapparaissait sur le téléphone.
    //
    // ⚠️ CETTE BORNE EST UNE PARUTION, PAS L'HEURE DU CLIC. Le raisonnement est
    // dans `lib/rattachementStories.ts` ; en un mot : la parution est datée par
    // Instagram, le clic par notre serveur, et le cron a du retard entre les deux.
    // Une story publiée pendant que l'écran est ouvert n'est donc pas affichée au
    // moment du clic tout en le précédant — `now()` l'écarterait à vie sans
    // l'avoir jamais montrée.
    //
    // Les ÉCARTÉES comptent autant que les rattachées : sans elles, écarter la
    // story la plus récente la ferait revenir aussitôt, la borne s'arrêtant à la
    // dernière rattachée. Le client n'envoie que des identifiants — les `posted_at`
    // sont relus ici, dans le périmètre du profil.
    const idsArbitres = [...new Set([
      ...addStoryIds,
      ...(Array.isArray(ecarteesIds) ? ecarteesIds : []),
    ])].filter((v): v is string => typeof v === 'string');

    const { data: parutions } = await serviceSupabase
      .from('ig_stories')
      .select('posted_at')
      .eq('profile_id', user.id)
      .in('id', idsArbitres);

    patchArbitrage = bornerArbitrage(
      (parutions || []).map(p => p.posted_at),
      seq.stories_arbitrees_jusqua,
    );

    // ── UNE SÉQUENCE PRÉPARÉE REÇOIT SON CTA À SON PREMIER RATTACHEMENT ──────
    //
    // Elle naît sans `cta_story_id` — elle n'a pas encore de stories. Sans ce
    // passage, elle en resterait dépourvue : le sélecteur de CTA ne s'affiche
    // qu'à partir de deux stories, donc une séquence d'UNE seule story n'aurait
    // jamais eu l'occasion d'en désigner une.
    //
    // La DERNIÈRE publiée, parce que c'est là qu'on pose le CTA : on raconte
    // d'abord, on demande à la fin. C'est aussi le défaut proposé lors d'un
    // groupement manuel — les deux chemins doivent donner le même résultat.
    if (!seq.cta_story_id) {
      const { data: apres } = await serviceSupabase
        .from('ig_stories')
        .select('id, posted_at')
        .eq('profile_id', user.id)
        .eq('sequence_id', id)
        .order('posted_at', { ascending: false })
        .limit(1);
      const derniere = apres?.[0]?.id;
      if (derniere) patchCta = derniere;
    }
  }

  // ── Champs simples + génération Calendly après coup ────────────────────
  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  // Posé plus haut quand un rattachement dote enfin la séquence d'un CTA.
  if (patchCta) patch.cta_story_id = patchCta;
  if (name !== undefined) patch.name = name.trim();
  if (dmLmMessage !== undefined) patch.dm_lm_message = dmLmMessage;
  if (dmButtonText !== undefined) patch.dm_button_text = dmButtonText;
  if (dm1Message !== undefined) patch.dm1_message = dm1Message;
  if (dmLinkButtonText !== undefined) patch.dm_link_button_text = dmLinkButtonText;
  if (dm2StoryMessage !== undefined) patch.dm2_story_message = dm2StoryMessage;
  if (lmKeyword !== undefined) patch.lm_keyword = (lmKeyword || '').toUpperCase().trim();

  // La clôture manuelle a été retirée : deux boutons, dont l'un ne servait qu'à
  // annuler l'autre, pour une proposition qui s'éteint déjà seule au bout de
  // 24 h sans mouvement. La colonne `closed_at` reste en base, inutilisée — la
  // supprimer demanderait une migration pour rien, et elle documente l'option.

  if (Object.keys(patch).length > 1) {
    const { error } = await serviceSupabase.from('story_sequences').update(patch).eq('id', id).eq('profile_id', user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // ── LA BORNE S'ÉCRIT À PART, ET NE RECULE PAS ─────────────────────────────
  //
  // Écriture SÉPARÉE et CONDITIONNELLE, parce que `patchArbitrage` a été calculé
  // à partir d'une valeur lue en début de requête. Entre cette lecture et
  // l'écriture, un autre appareil peut avoir arbitré plus loin — le glisser dans
  // le patch général le ferait reculer, et des refus déjà prononcés là-bas
  // seraient reproposés ici.
  //
  // Le `.or(...)` déplace la comparaison dans le UPDATE lui-même : Postgres
  // l'évalue sur la ligne au moment où il la modifie, donc la borne ne peut plus
  // que monter, quel que soit l'entrelacement. Zéro ligne touchée n'est pas une
  // erreur — cela veut dire qu'une borne plus récente tient déjà.
  //
  // La garde en mémoire de `bornerArbitrage` reste utile : elle évite d'émettre
  // cette requête quand rien n'a progressé.
  if (patchArbitrage) {
    const { error } = await serviceSupabase
      .from('story_sequences')
      .update({ stories_arbitrees_jusqua: patchArbitrage })
      .eq('id', id)
      .eq('profile_id', user.id)
      .or(`stories_arbitrees_jusqua.is.null,stories_arbitrees_jusqua.lt.${patchArbitrage}`);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let calendlyShortUrl: string | null = seq.calendly_short_url;
  if (generateCalendly && !seq.calendly_short_url) {
    calendlyShortUrl = await generateCalendlyLink(user.id, id, patch.name ?? seq.name);
    if (!calendlyShortUrl) return NextResponse.json({ error: 'Impossible de générer le lien Calendly — vérifie ta configuration Calendly/Short.io dans les Réglages' }, { status: 400 });
  }

  return NextResponse.json({ ok: true, calendlyShortUrl });
}
