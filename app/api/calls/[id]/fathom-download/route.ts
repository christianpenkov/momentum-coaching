import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { serviceSupabase } from '@/lib/callAccess';
import { getFathomToken } from '@/lib/fathom-auth';

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

  // ⚠️ Contrôle d'accès volontairement DIFFÉRENT de requireCallAccess.
  //
  // Celui-ci compare `calls.client_id` à l'id de l'utilisateur, or les deux ne
  // désignent pas la même chose : `client_id` référence `clients.id`, pas un
  // profil (incohérence connue, documentée dans callAccess.ts). Côté rapport ça
  // reste sans effet — seul le coach le remplit. Ici ça ne l'est pas : l'élève
  // consulte cette modale, et c'est souvent LUI qui a connecté Fathom. Sans la
  // jointure ci-dessous, la vidéo lui serait refusée sur ses propres appels.
  const estLeCoach = call.coach_id === user.id;
  let estLEleve = false;
  if (!estLeCoach && call.client_id) {
    const { data: client } = await serviceSupabase
      .from('clients')
      .select('profile_id')
      .eq('id', call.client_id)
      .maybeSingle();
    estLEleve = client?.profile_id === user.id;
  }

  if (!estLeCoach && !estLEleve) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
  }

  if (!call.fathom_recording_id) {
    return NextResponse.json({ error: 'Aucun enregistrement pour ce call' }, { status: 404 });
  }

  // Le jeton du LECTEUR, jamais celui d'un autre : chacun connecte son propre
  // compte Fathom, coach comme élève. Fathom applique ensuite ses propres règles
  // d'accès à l'enregistrement — on ne contourne rien.
  //
  // Sans compte Fathom connecté, pas de lecture intégrée : l'appelant retombe sur
  // le lien de partage, qui reste affiché comme avant.
  const accessToken = await getFathomToken(user.id);
  if (!accessToken) {
    return NextResponse.json({ error: 'Fathom non connecté' }, { status: 404 });
  }

  const res = await fetch(`${FATHOM_API_BASE}/recordings/${call.fathom_recording_id}/download`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  if (!res.ok) {
    // 403 = partage à accès restreint, 422 = pas de média téléchargeable.
    // L'appelant retombe sur le lien Fathom, il n'y a rien à réparer côté client.
    return NextResponse.json(
      { error: 'Enregistrement indisponible', status: res.status },
      { status: res.status === 429 ? 429 : 502 }
    );
  }

  const data = await res.json().catch(() => null);

  // On ne renvoie que ce dont le lecteur a besoin — jamais le jeton, jamais le
  // payload brut de Fathom.
  return NextResponse.json({
    status: data?.status ?? 'processing',
    url: data?.video?.url ?? null,
    expiresAt: data?.video?.expires_at ?? null,
    failureReason: data?.failure_reason ?? null,
  });
}
