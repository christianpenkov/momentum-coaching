import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { serviceSupabase } from '@/lib/callAccess';
import { getFathomToken } from '@/lib/fathom-auth';
import { resoudreAccesReplay } from '@/lib/replayAccess';

/**
 * Lien de lecture directe d'un enregistrement Fathom (fichier MP4).
 *
 * POURQUOI cette route existe : le lecteur Fathom embarqué en iframe fait
 * planter WebKit sur iOS — toute la page se recharge au premier affichage après
 * démarrage à froid (bug reproduit et isolé, cf. FathomRecordingSection.tsx).
 * Aucun paramètre d'URL ne l'évite. Un MP4 lu dans une balise <video> native
 * n'utilise pas ce lecteur du tout : le problème disparaît par construction.
 *
 * Mesuré sur une captation réelle de 30 min (2026-09-02) :
 *   • première demande  : 10 s de génération, 16,3 Mo, video/mp4
 *   • demandes suivantes : 0,4 s — Fathom garde le fichier ~24 h et le renvoie
 *     tel quel. On ne paie donc l'attente qu'une fois par enregistrement et par
 *     jour, et il est inutile de mettre le lien en cache de notre côté.
 *   • requêtes de plage acceptées (HTTP 206) : la lecture démarre sans
 *     télécharger tout le fichier.
 *
 * Le lien expire ~24 h après génération : il ne doit JAMAIS être stocké en base,
 * seulement demandé à l'ouverture.
 *
 * QUI PEUT REGARDER QUOI : voir lib/replayAccess.ts. En résumé, les participants
 * d'un call peuvent voir son enregistrement, et on le demande au premier de leurs
 * comptes Fathom qui l'a — sur un call de coaching, un seul des deux a enregistré
 * la réunion.
 */

const FATHOM_API_BASE = 'https://api.fathom.ai/external/v1';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { data: call } = await serviceSupabase
    .from('calls')
    .select('fathom_recording_id, coach_id, client_id')
    .eq('id', id)
    .single();

  if (!call) return NextResponse.json({ error: 'Call introuvable' }, { status: 404 });

  // ⚠️ `calls.client_id` référence `clients.id`, pas un profil — il faut la
  // jointure pour obtenir quelque chose de comparable à un id d'utilisateur
  // (cf. docs/calls-coach-id-piege.md). C'est aussi pour ça que cette route
  // n'utilise pas `requireCallAccess`, qui compare les deux directement : sans
  // effet côté rapport (seul le coach le remplit), mais bloquant ici où l'élève
  // consulte la modale.
  let profilEleve: string | null = null;
  if (call.client_id) {
    const { data: client } = await serviceSupabase
      .from('clients')
      .select('profile_id')
      .eq('id', call.client_id)
      .maybeSingle();
    profilEleve = client?.profile_id ?? null;
  }

  const acces = resoudreAccesReplay(user.id, call.coach_id, profilEleve);
  if (!acces.autorise) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
  }

  if (!call.fathom_recording_id) {
    return NextResponse.json({ error: 'Aucun enregistrement pour ce call' }, { status: 404 });
  }

  // On essaie les comptes Fathom des participants, le lecteur d'abord.
  //
  // Sur un call de coaching, un seul des deux a enregistré la réunion : sans ce
  // repli, l'autre n'aurait jamais la vidéo dans la page alors qu'il a participé
  // au même appel. La règle et sa justification sont dans lib/replayAccess.ts.
  //
  // On s'arrête au premier compte qui rend un fichier. Un 403/404 de Fathom veut
  // dire « ce compte-là n'a pas cet enregistrement » : on passe au suivant plutôt
  // que d'abandonner.
  let data: any = null;
  let dernierStatut = 0;

  for (const profileId of acces.ordreDEssai) {
    const accessToken = await getFathomToken(profileId);
    if (!accessToken) continue;

    const res = await fetch(`${FATHOM_API_BASE}/recordings/${call.fathom_recording_id}/download`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    if (res.ok) { data = await res.json().catch(() => null); break; }

    dernierStatut = res.status;
    // 429 = quota atteint : réessayer avec un autre compte ne ferait qu'aggraver.
    if (res.status === 429) break;
  }

  if (!data) {
    // Aucun compte n'a le fichier — ou aucun n'a Fathom connecté. L'appelant
    // retombe sur le lien de partage, qui reste affiché comme avant.
    return NextResponse.json(
      { error: dernierStatut ? 'Enregistrement indisponible' : 'Fathom non connecté' },
      { status: dernierStatut === 429 ? 429 : 404 }
    );
  }

  // On ne renvoie que ce dont le lecteur a besoin — jamais le jeton, jamais le
  // payload brut de Fathom.
  return NextResponse.json({
    status: data?.status ?? 'processing',
    url: data?.video?.url ?? null,
    expiresAt: data?.video?.expires_at ?? null,
    failureReason: data?.failure_reason ?? null,
  });
}
