import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { resolveTargetProfile } from '@/lib/stripe-account';
import { resolveYtVideoTitles } from '@/lib/ytVideoTitles';

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
  let query = supa
    .from('deal_payments')
    .select('amount, paid_at, deals!inner(profile_id, first_touch_content_id, attribution_source, id)')
    .eq('deals.profile_id', profileId)
    .eq('status', 'succeeded');

  if (start) query = query.gte('paid_at', start);
  if (end) query = query.lte('paid_at', end);

  const { data: payments, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Regroupement par contenu, ou par nature d'origine quand il n'y en a pas.
  const buckets = new Map<string, { amount: number; deals: Set<string>; isOrigin: boolean }>();

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

    const b = buckets.get(key) ?? { amount: 0, deals: new Set<string>(), isOrigin: !contentId };
    b.amount += Number(p.amount);
    if (d?.id) b.deals.add(d.id);
    buckets.set(key, b);
  }

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

    const ytIds = contentIds.filter(id => !titles.has(id) && /^[A-Za-z0-9_-]{11}$/.test(id));
    if (ytIds.length) {
      const ytTitles = await resolveYtVideoTitles(profileId, ytIds);
      for (const [id, title] of Object.entries(ytTitles)) {
        titles.set(id, { title: String(title).slice(0, 70), thumbnail: null, kind: 'YouTube' });
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
      const n = b.deals.size;
      return {
        key, label: t?.title ?? 'Contenu supprimé',
        meta: `${t?.kind ?? 'Contenu'} · ${n} deal${n > 1 ? 's' : ''}`,
        amount: b.amount, isOrigin: false, thumbnail: t?.thumbnail ?? null, dealsCount: n,
      };
    }
    const o = ORIGIN_LABELS[key] ?? { label: 'Autre', meta: '' };
    const n = b.deals.size;
    return {
      key, label: o.label, meta: `${o.meta} · ${n} deal${n > 1 ? 's' : ''}`,
      amount: b.amount, isOrigin: true, thumbnail: null, dealsCount: n,
    };
  });

  rows.sort((a, b) => b.amount - a.amount);
  const total = rows.reduce((s, r) => s + r.amount, 0);

  return NextResponse.json({ rows, total });
}
