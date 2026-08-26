import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * GET /api/instagram/periodes?type=mois|semaine&profileId=...
 *
 * Historique de la portee dedupliquee, une ligne par periode calendaire.
 *
 * Ces valeurs ne sont PAS recalculables : Meta cesse de servir la ventilation
 * abonnes/non-abonnes au-dela de ~12 mois, et elle ne s'additionne pas depuis les
 * valeurs journalieres (mai+juin+juillet 2026 cumulaient 272 abonnes contre 124 en
 * realite). Elles sont donc lues telles qu'ecrites par le cron, jamais derivees.
 *
 * Pas de filtre `ig_account_id` a la lecture : c'est `archived_at` qui fait le
 * travail lors d'une bascule de compte Instagram.
 */
export async function GET(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const profileId = searchParams.get('profileId');
  const type = searchParams.get('type') === 'semaine' ? 'semaine' : 'mois';

  let targetProfileId = user.id;
  if (profileId && profileId !== user.id) {
    const { data: clientRow } = await serviceSupabase
      .from('clients')
      .select('id')
      .eq('profile_id', profileId)
      .eq('coach_id', user.id)
      .single();
    if (!clientRow) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    targetProfileId = profileId;
  }

  // 14 periodes : un peu plus d'un trimestre en semaines, un peu plus d'un an en
  // mois. Au-dela, la donnee n'existe de toute facon pas (retention Meta).
  const { data, error } = await serviceSupabase
    .from('analytics_ig_periodes')
    .select('type, debut, fin, reach_total, reach_abonnes, reach_non_abonnes, abonnes, figee')
    .eq('profile_id', targetProfileId)
    .eq('type', type)
    .is('archived_at', null)
    .order('debut', { ascending: false })
    .limit(14);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const periodes = (data || []).map((p) => ({
    debut: p.debut,
    fin: p.fin,
    reachTotal: p.reach_total,
    reachAbonnes: p.reach_abonnes,
    reachNonAbonnes: p.reach_non_abonnes,
    abonnes: p.abonnes,
    // false = periode encore en cours, le chiffre bougera encore.
    figee: p.figee,
    // Calcules ici pour que l'ecran n'ait aucune regle metier a reimplementer.
    // null et non 0 quand le denominateur manque : un taux invente serait pire
    // qu'une absence.
    tauxAbonnes: p.reach_abonnes != null && p.abonnes
      ? Math.round((p.reach_abonnes / p.abonnes) * 1000) / 10
      : null,
    partNonAbonnes: p.reach_non_abonnes != null && p.reach_total
      ? Math.round((p.reach_non_abonnes / p.reach_total) * 1000) / 10
      : null,
  }));

  return NextResponse.json({ type, periodes });
}
