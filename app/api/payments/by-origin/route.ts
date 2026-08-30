import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { resolveTargetProfile } from '@/lib/stripe-account';
import { resolveYtVideoTitles } from '@/lib/ytVideoTitles';
import { calculerCash, type LignePaiement } from '@/lib/dealCash';
import { isYtVideoId } from '@/lib/ytId';

/**
 * Cash encaissé par origine — le bloc analytique de l'onglet Revenus.
 *
 * Répond à « qu'est-ce qui me rapporte », par opposition à la page Paiements qui
 * répond à « où est mon argent ».
 *
 * Contenus ET origines sans contenu sont classés ENSEMBLE par montant : un Cold DM
 * qui rapporte 3 000 € passe devant un Reel à 2 000 €. Les reléguer en bas
 * reviendrait à décider d'avance qu'ils comptent moins, alors que le démarchage
 * est une stratégie d'acquisition aussi légitime qu'un contenu.
 *
 * Attribution au PREMIER contact : le contenu qui a généré le lead, pas le lien
 * qui a servi au booking. Sans ça, un Reel qui produit 200 leads se fait voler le
 * crédit par le lien bio.
 */

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface OriginRow {
  key: string;
  label: string;
  meta: string;
  amount: number;
  /** Sans contenu identifié : affiché avec une vignette pointillée. */
  isOrigin: boolean;
  thumbnail: string | null;
  dealsCount: number;
}

export async function GET(request: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const profileId = await resolveTargetProfile(user.id, params.get('profileId'));
  if (!profileId) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

  const start = params.get('start');
  const end = params.get('end');

  // Encaissé réel, pas contracté : le bloc s'appelle « cash encaissé ».
  //
  // Tous les statuts, pas seulement `succeeded` : le net est calculé plus bas par
  // `calculerCash`, la règle partagée de lib/dealCash.ts (encaissé − remboursé −
  // contesté). Ne garder que `succeeded` faisait dire à ce bloc 1 000 € là où la
  // page Paiements disait 800 € sur le même deal — exactement la divergence que
  // dealCash.ts avait été créé pour supprimer.
  let query = supa
    .from('deal_payments')
    .select('amount, status, paid_at, deals!inner(profile_id, first_touch_content_id, attribution_source, id)')
    .eq('deals.profile_id', profileId);

  if (start) query = query.gte('paid_at', start);
  if (end) query = query.lte('paid_at', end);

  const { data: payments, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Regroupement par contenu, ou par nature d'origine quand il n'y en a pas.
  // On accumule les LIGNES et non un total : le net se calcule ensuite par
  // `calculerCash`, pour que ce bloc dise exactement la même chose que la page
  // Paiements et que la carte « Cash collecté ».
  const buckets = new Map<string, { lignes: LignePaiement[]; deals: Set<string>; isOrigin: boolean }>();

  for (const p of (payments ?? []) as any[]) {
    const d = p.deals;
    const contentId: string | null = d?.first_touch_content_id ?? null;
    const source: string = d?.attribution_source ?? 'manual';

    const key = contentId
      ? `content:${contentId}`
      : source === 'cold_dm' ? 'origin:cold_dm'
      : source === 'organic' ? 'origin:organic'
      : source === 'client_existant' ? 'origin:client'
      : 'origin:manual';

    const b = buckets.get(key) ?? { lignes: [] as LignePaiement[], deals: new Set<string>(), isOrigin: !contentId };
    b.lignes.push({ amount: p.amount, status: p.status });
    // Un deal qui n'a QUE des remboursements ne compte pas comme une vente
    // encaissée : il ne rejoint le compte que s'il a au moins un encaissement.
    if (d?.id && p.status === 'succeeded') b.deals.add(d.id);
    buckets.set(key, b);
  }
  const montantDuBucket = (b: { lignes: LignePaiement[] }) => calculerCash(b.lignes).net;

  // Titres et vignettes des contenus : une requête pour tous plutôt qu'une par ligne.
  const contentIds = [...buckets.keys()]
    .filter(k => k.startsWith('content:'))
    .map(k => k.slice('content:'.length));

  // ig_post_meta est le cache des posts (alimenté par resolveIgPostMeta) ; les
  // vidéos YouTube passent par resolveYtVideoTitles, qui gère son propre cache.
  // Aucune table ne stocke les posts eux-mêmes : ils viennent des API.
  const titles = new Map<string, { title: string; thumbnail: string | null; kind: string }>();
  if (contentIds.length) {
    const { data: posts } = await supa
      .from('ig_post_meta')
      .select('media_id, caption, thumbnail, permalink')
      .eq('profile_id', profileId)
      .in('media_id', contentIds);
    for (const p of posts ?? []) {
      // Beaucoup de captions sont vides ou réduites à des hashtags : s'en tenir
      // au fallback « Contenu Instagram » rendrait plusieurs lignes du classement
      // indistinguables. Le shortcode du permalink sert alors de repère unique,
      // et la vignette porte l'identification visuelle.
      const caption = (p.caption ?? '').replace(/#\S+/g, '').trim();
      const shortcode = p.permalink?.match(/\/(?:p|reel)\/([^/]+)/)?.[1];
      titles.set(p.media_id, {
        title: caption.slice(0, 70)
          || (shortcode ? `Post ${shortcode}` : 'Contenu Instagram'),
        thumbnail: p.thumbnail ?? null,
        kind: 'Instagram',
      });
    }

    // ── Séquences de stories ────────────────────────────────────────────────
    // TROISIÈME type de contenu, à côté des posts Instagram et des vidéos YouTube.
    // `first_touch_content_id` y porte un `story_sequences.id`, donc un UUID — ni un
    // media_id Instagram (numérique) ni un id YouTube (11 caractères). Faute de le
    // savoir, la route affichait « Contenu supprimé » sur une séquence bien vivante.
    //
    // Même résolution que « Performance par contenu » de l'onglet Business micro
    // (app/api/instagram/story-sequences-stats) : le nom de la séquence pour titre, et
    // la première story de la séquence pour vignette — première au sens de `posted_at`,
    // et jamais une story archivée.
    const idsSequences = contentIds.filter(id => !titles.has(id) && /^[0-9a-f-]{36}$/i.test(id));
    if (idsSequences.length) {
      const { data: sequences } = await supa
        .from('story_sequences')
        .select('id, name')
        .eq('profile_id', profileId)
        .in('id', idsSequences);
      const trouvees = sequences ?? [];
      const { data: stories } = trouvees.length
        ? await supa
            .from('ig_stories')
            .select('sequence_id, storage_url, posted_at')
            .in('sequence_id', trouvees.map(s => s.id))
            .is('archived_at', null)
            .order('posted_at', { ascending: true })
        : { data: [] as any[] };
      const premiereStory = new Map<string, string | null>();
      for (const s of stories ?? []) {
        if (s.sequence_id && !premiereStory.has(s.sequence_id)) premiereStory.set(s.sequence_id, s.storage_url ?? null);
      }
      for (const seq of trouvees) {
        titles.set(seq.id, {
          title: (seq.name ?? 'Séquence de stories').slice(0, 70),
          thumbnail: premiereStory.get(seq.id) ?? null,
          kind: 'Story',
        });
      }
    }

    const ytIds = contentIds.filter(id => !titles.has(id) && isYtVideoId(id));
    if (ytIds.length) {
      const ytTitles = await resolveYtVideoTitles(profileId, ytIds);
      for (const [id, title] of Object.entries(ytTitles)) {
        // `thumbnail: null` en dur privait TOUTES les vidéos YouTube de vignette, pour
        // toujours — la ligne tombait sur la pastille pointillée réservée aux contenus
        // introuvables, à côté de lignes Instagram illustrées. La vignette YouTube ne
        // demande aucun appel d'API : elle se déduit de l'identifiant, et la route
        // /api/resources/yt-thumb sait déjà servir la meilleure résolution disponible.
        titles.set(id, { title: String(title).slice(0, 70), thumbnail: `/api/resources/yt-thumb?id=${id}`, kind: 'YouTube' });
      }
    }
  }

  const ORIGIN_LABELS: Record<string, { label: string; meta: string }> = {
    'origin:cold_dm': { label: 'Cold DM', meta: 'démarchage sortant' },
    'origin:organic': { label: 'Organique', meta: 'entrant, contenu non identifié' },
    'origin:client': { label: 'Client existant', meta: 'upsell' },
    'origin:manual': { label: 'Sans attribution', meta: 'deals saisis à la main' },
  };

  const rows: OriginRow[] = [...buckets.entries()].map(([key, b]) => {
    if (key.startsWith('content:')) {
      const id = key.slice('content:'.length);
      const t = titles.get(id);
      // Les trois formes d'identifiant sont désormais résolues : post Instagram,
      // vidéo YouTube, séquence de stories. Ce qui ne se résout plus a donc bien été
      // supprimé — le libellé redevient vrai.
      const n = b.deals.size;
      return {
        key, label: t?.title ?? 'Contenu supprimé',
        meta: `${t?.kind ?? 'Contenu'} · ${n} deal${n > 1 ? 's' : ''}`,
        amount: montantDuBucket(b), isOrigin: false, thumbnail: t?.thumbnail ?? null, dealsCount: n,
      };
    }
    const o = ORIGIN_LABELS[key] ?? { label: 'Autre', meta: '' };
    const n = b.deals.size;
    return {
      key, label: o.label, meta: `${o.meta} · ${n} deal${n > 1 ? 's' : ''}`,
      amount: montantDuBucket(b), isOrigin: true, thumbnail: null, dealsCount: n,
    };
  });

  // Une ligne dont le net retombe a zero (tout rembourse) n'a plus rien a dire.
  const visibles = rows.filter(r => Math.abs(r.amount) > 0.005);
  visibles.sort((a, b) => b.amount - a.amount);
  const total = visibles.reduce((s, r) => s + r.amount, 0);

  return NextResponse.json({ rows: visibles, total });
}
