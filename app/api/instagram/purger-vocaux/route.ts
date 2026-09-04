import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * Purge des messages vocaux Instagram de plus de 30 jours.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ POURQUOI UNE ROUTE ET PAS UN JOB SQL                                      │
 * │                                                                           │
 * │ Les sept autres purges du projet sont du SQL pur dans pg_cron, et c'est   │
 * │ le bon motif — aucune URL, aucun secret, rien à exposer. Celle-ci ne peut  │
 * │ pas l'être : supprimer une ligne de `storage.objects` ne supprime PAS le   │
 * │ fichier sous-jacent. Seule l'API de stockage le fait. Un job SQL viderait  │
 * │ donc l'index en laissant les octets, et le quota continuerait de monter    │
 * │ pendant que la table dirait le contraire.                                  │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Déclenchée par `poll-leads` dans la tranche de 8 h, comme les alertes :
 * aucun planificateur à créer, et rien de plus à recréer le jour du transfert.
 *
 * ⚠️ 30 jours, décision de Chris (2026-09-04), et c'est le paramètre qui décide
 * si le plan gratuit tient : à 88 Ko par vocal, le gigaoctet supporte environ
 * 9 vocaux par élève et par jour à 40 élèves. `stockage_fichiers_sante` alerte
 * à 70 %, soit trois semaines avant la saturation.
 */

export const maxDuration = 60;

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const RETENTION_JOURS = 30;
/** Borne par passage : la suppression se fait par lots, le reste attend demain. */
const LOT_MAX = 500;

export async function POST(request: Request) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limite = new Date(Date.now() - RETENTION_JOURS * 86400_000).toISOString();

  // `storage.objects` sert d'index : on y lit QUI supprimer, et l'API de
  // stockage fait la suppression réelle.
  const { data: vieux, error } = await supa
    .schema('storage')
    .from('objects')
    .select('name')
    .eq('bucket_id', 'ig-vocaux')
    .lt('created_at', limite)
    .limit(LOT_MAX);

  if (error) {
    await supa.from('cron_runs').insert({
      fonction: 'purger-vocaux',
      erreurs: [{ message: `lecture: ${error.message}` }],
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const chemins = (vieux ?? []).map(o => o.name as string);
  if (!chemins.length) return NextResponse.json({ ok: true, supprimes: 0 });

  const { error: errSup } = await supa.storage.from('ig-vocaux').remove(chemins);
  if (errSup) {
    await supa.from('cron_runs').insert({
      fonction: 'purger-vocaux',
      erreurs: [{ message: `suppression: ${errSup.message}`, fichiers: chemins.length }],
    });
    return NextResponse.json({ error: errSup.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, supprimes: chemins.length, reste_peut_etre: chemins.length === LOT_MAX });
}
