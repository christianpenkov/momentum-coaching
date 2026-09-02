import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

// La déconnexion doit passer par le serveur (pas un DELETE direct depuis le
// navigateur) car elle doit archiver les données actives AVANT de supprimer
// integrations — sinon la PROCHAINE connexion (même vers un compte différent)
// ne trouve plus de previousAccountId et ne déclenche jamais l'archivage
// attendu (bug découvert le 2026-07-29 : lead/post d'un compte précédent
// restait visible indéfiniment après une déconnexion manuelle).
const IG_TABLES = [
  'analytics_ig_posts_history', 'analytics_ig_stories_history', 'ig_stories',
  'instagram_leads', 'instagram_lead_lm_history', 'content_links',
  'ig_post_meta', 'analytics_daily_snapshots',
  // prospect_links n'a pas d'ig_account_id, mais à la déconnexion tout est archivé
  // sans distinction de compte : elle peut donc rejoindre la liste telle quelle.
  // Le callback, lui, doit la traiter à part (voir l'étape 3 là-bas).
  'prospect_links',
  // Ajoutee le 2026-08-26 avec la table. Sans elle ici, les periodes d'un ancien
  // compte resteraient visibles apres bascule, et l'index unique partiel
  // bloquerait l'ecriture des memes periodes sur le nouveau compte.
  'analytics_ig_periodes',
];

export async function POST() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const serviceSupabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const now = new Date().toISOString();
  try {
    await Promise.all(IG_TABLES.map(t => {
      const base = serviceSupabase.from(t).update({ archived_at: now })
        .eq('profile_id', user.id).is('archived_at', null);

      // ⚠️ Même exception qu'au branchement (voir le callback OAuth) :
      // `analytics_daily_snapshots` n'est PAS propre à Instagram. Une de ses
      // lignes porte les colonnes `ig_*`, `yt_*` et `shortio_*` d'une même
      // journée. L'archiver entière parce qu'on débranche Instagram effaçait de
      // l'affichage tout l'historique YouTube et Short.io — 120 lignes YouTube et
      // 46 Short.io au 2026-09-02.
      //
      // Pire, c'était IRRÉVERSIBLE : au rebranchement, l'étape de désarchivage ne
      // restaure que les lignes portant `ig_account_id = <compte>`, or celles-ci
      // valent NULL. Débrancher puis rebrancher le même compte perdait donc
      // l'historique quotidien pour de bon.
      //
      // On n'archive donc que les lignes qui revendiquent explicitement un compte
      // Instagram. Les autres gardent leurs métriques des autres plateformes ; les
      // métriques Instagram qu'elles contiennent restent visibles pour les jours où
      // le compte ÉTAIT branché — ce sont des faits passés, pas une invention.
      return t === 'analytics_daily_snapshots'
        ? base.not('ig_account_id', 'is', null)
        : base;
    }));
  } catch (e) {
    console.error('[IG disconnect] Erreur archivage:', e);
    return NextResponse.json({ error: 'Erreur archivage' }, { status: 500 });
  }

  const { error } = await serviceSupabase
    .from('integrations')
    .delete()
    .eq('profile_id', user.id)
    .eq('provider', 'instagram');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
