import { NextResponse, after } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

/**
 * L'élève accorde ou retire à son coach le droit de lire ses conversations
 * Instagram DM.
 *
 * ⚠️ C'est le seul interrupteur du chantier. Il n'existe PAS de second accord
 * pour l'écriture : la plateforme n'envoie aucun message de coach — celui-ci
 * rédige une suggestion que l'élève envoie depuis Instagram. Ne pas rajouter
 * une capacité d'écriture sans rouvrir d'abord cette décision (voir
 * docs/conversations-instagram.md, « Pourquoi la plateforme n'envoie AUCUN
 * message de coach »).
 *
 * ⚠️ Retirer l'accord SUPPRIME les messages, il ne les masque pas. C'est la
 * seule réponse défendable à une demande de retrait, et elle rend la promesse
 * faite à l'élève vérifiable. Un `not null` sur la colonne ne suffirait pas :
 * la donnée resterait, invisible mais présente.
 */

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  // Le prénom du coach est rendu ici pour que l'écran l'affiche à la place de
  // « ton coach ». Une plateforme livrée à quelqu'un d'autre afficherait sinon
  // le mauvais nom, en silence.
  const { data: client } = await supa
    .from('clients')
    .select('id, coach_id, ig_dm_lecture_accordee_le')
    .eq('profile_id', user.id)
    .is('archived_at', null)
    .maybeSingle();

  if (!client) return NextResponse.json({ accorde: false, coachPrenom: null, fils: 0 });

  const { data: coach } = await supa
    .from('profiles').select('full_name').eq('id', client.coach_id).maybeSingle();

  // « ton coach » n'est qu'un dernier recours : un profil sans nom ne doit pas
  // produire une phrase sans sujet.
  const prenom = (coach?.full_name || '').trim().split(/\s+/)[0] || null;

  const { count } = await supa
    .from('ig_conversations')
    .select('id', { count: 'exact', head: true })
    .eq('profile_id', user.id)
    .is('archived_at', null);

  return NextResponse.json({
    accorde: !!client.ig_dm_lecture_accordee_le,
    depuis: client.ig_dm_lecture_accordee_le,
    coachPrenom: prenom,
    fils: count ?? 0,
  });
}

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }); }
  if (typeof body?.accorde !== 'boolean') {
    return NextResponse.json({ error: 'accorde (booléen) requis' }, { status: 400 });
  }

  // ⚠️ Le filtre porte sur `profile_id = user.id`, l'identité authentifiée —
  // jamais sur un identifiant reçu dans le corps. Un `profile_id` est PUBLIC
  // depuis le 2026-08-31 : il est inscrit dans la destination de chaque lien
  // Calendly partagé.
  const { data: client, error } = await supa
    .from('clients')
    .update({ ig_dm_lecture_accordee_le: body.accorde ? new Date().toISOString() : null })
    .eq('profile_id', user.id)
    .is('archived_at', null)
    .select('id')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!client) return NextResponse.json({ error: 'Aucune fiche élève' }, { status: 404 });

  if (!body.accorde) {
    // Purge complète et immédiate. Les messages partent par cascade depuis les
    // conversations ; l'état de backfill part aussi, pour qu'un futur ré-accord
    // reparte proprement au lieu de reprendre un curseur périmé.
    const { error: purgeErr } = await supa.from('ig_conversations').delete().eq('profile_id', user.id);
    if (purgeErr) return NextResponse.json({ error: `purge échouée: ${purgeErr.message}` }, { status: 500 });
    await supa.from('ig_backfill_etat').delete().eq('profile_id', user.id);
    return NextResponse.json({ ok: true, accorde: false, purge: true });
  }

  // Accord donné : on réveille la reprise d'historique sans attendre le filet
  // de poll-leads. Même motif que `reveillerLeWorker()` du webhook — un réveil
  // raté n'empêche rien, il retarde d'un passage.
  reveillerLeBackfill(user.id);
  return NextResponse.json({ ok: true, accorde: true });
}

/**
 * Volontairement silencieux : un réveil raté ne doit jamais faire échouer
 * l'accord lui-même. `ig_dm_sante` signale un backfill jamais démarré au-delà
 * d'une heure, et poll-leads le relance de toute façon.
 */
function reveillerLeBackfill(profileId: string) {
  const base = process.env.NEXT_PUBLIC_PLATFORM_URL;
  if (!base || !process.env.CRON_SECRET) return;
  after(async () => {
    try {
      await fetch(`${base}/api/instagram/backfill-conversations`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${process.env.CRON_SECRET}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ profile_id: profileId }),
      });
    } catch (e: any) {
      console.error('[IG DM] réveil du backfill échoué (poll-leads rattrapera):', e?.message || e);
    }
  });
}
