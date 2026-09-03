import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Route de logging générique pour le debug côté navigateur (mobile notamment,
// où il n'y a pas de console accessible) — écrit dans webhook_debug_log comme
// tous les autres logs serveur, cf. convention du projet (jamais de logs
// Vercel/console.log pour investiguer, toujours en base).
//
// ⚠️ AUTHENTIFIÉE depuis le 2026-09-04 (audit PWA). Sans session, cette route
// insérait en service role ce que n'importe qui lui postait : un scan de bots en
// boucle pouvait remplir la base plus vite que la purge quotidienne ne l'efface,
// et sur le plan Supabase gratuit la base bascule en LECTURE SEULE à 500 Mo —
// toute la plateforme gelée par une route de debug. Les seuls appelants
// légitimes (logClient, écrans connectés) ont toujours une session ; les logs
// d'avant-connexion sont perdus, et c'est un prix accepté — un log anonyme
// n'était de toute façon rattachable à personne.
//
// Tailles bornées pour la même raison : le contenu vient du navigateur, donc de
// n'importe qui d'authentifié — un élève compromis ne doit pas pouvoir pousser
// des mégaoctets par ligne.
export async function POST(request: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { message, data } = body;
  if (!message) return NextResponse.json({ ok: false }, { status: 400 });

  const dataSerialise = JSON.stringify(data ?? {});
  const dataBornee = dataSerialise.length > 8_000
    ? { tronque: true, apercu: dataSerialise.slice(0, 8_000) }
    : (data ?? {});

  // `sw: true` → sw_logs, la table qu'utilisent les requêtes de diagnostic de
  // docs/pastille-et-sauts-accueil.md. Le service worker écrivait directement
  // dans sw_logs via l'API REST avec la clé anon EN DUR dans sw.js — porte
  // ouverte (insertion anonyme illimitée) ET pointeur figé vers le projet
  // Supabase actuel qui aurait survécu chez chaque élève après une migration.
  // Passer par cette route règle les deux : session obligatoire, zéro URL en dur.
  if (body.sw === true) {
    await serviceSupabase.from('sw_logs').insert({
      event: String(message).slice(0, 200),
      data: typeof dataBornee === 'string' ? dataBornee : JSON.stringify(dataBornee),
      created_at: new Date().toISOString(),
    });
  } else {
    await serviceSupabase.from('webhook_debug_log').insert({
      message: String(message).slice(0, 500),
      data: dataBornee,
    });
  }
  return NextResponse.json({ ok: true });
}
