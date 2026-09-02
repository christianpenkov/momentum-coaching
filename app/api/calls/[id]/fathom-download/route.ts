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
    .select('fathom_recording_id, fathom_share_url, coach_id, client_id')
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

  // Autorisation AVANT toute autre réponse, et notamment avant le 404 « aucun
  // enregistrement » : sinon un inconnu distinguerait « ce call n'a pas de
  // replay » de « ce call en a un que je ne peux pas voir ». La liste des
  // enregistrements n'entre pas dans cette décision — d'où l'appel sans elle
  // ici, et le second plus bas qui, lui, sert à ordonner les tentatives.
  if (!resoudreAccesReplay(user.id, call.coach_id, profilEleve).autorise) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
  }

  if (!call.fathom_recording_id) {
    return NextResponse.json({ error: 'Aucun enregistrement pour ce call' }, { status: 404 });
  }

  // On essaie les enregistrements du call, celui du lecteur d'abord.
  //
  // Quand coach et élève ont tous les deux Fathom, les deux bots rejoignent et il
  // y a DEUX enregistrements de la même réunion : chacun lit le sien, avec son
  // propre jeton. Quand un seul a enregistré, l'autre passe par ce compte-là —
  // sans quoi il n'aurait jamais la vidéo alors qu'il était au même appel.
  // La règle et le choix des jetons sont dans lib/replayAccess.ts.
  //
  // `calls.fathom_recording_id` est ajouté en dernier recours s'il ne figure pas
  // déjà dans la table : une ligne manquante (reprise incomplète, écriture ratée)
  // ne doit pas priver de replay un call qui en affiche pourtant un.
  const { data: lignes } = await serviceSupabase
    .from('call_recordings')
    .select('fathom_recording_id, fathom_share_url, profile_id')
    .eq('call_id', id);

  const enregistrements = (lignes || []).map(l => ({
    recordingId: l.fathom_recording_id,
    profileId: l.profile_id,
    shareUrl: l.fathom_share_url,
  }));

  if (!enregistrements.some(e => e.recordingId === call.fathom_recording_id)) {
    enregistrements.push({
      recordingId: call.fathom_recording_id,
      profileId: null,
      shareUrl: call.fathom_share_url ?? null,
    });
  }

  const acces = resoudreAccesReplay(user.id, call.coach_id, profilEleve, enregistrements);
  if (!acces.autorise) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
  }

  // On s'arrête à la première tentative qui rend un fichier. Un 403/404 de Fathom
  // veut dire « ce compte-là n'a pas cet enregistrement » : on passe à la suivante
  // plutôt que d'abandonner.
  //
  // Les jetons sont mis en cache le temps de la requête : sur un call à deux
  // enregistrements dont on ignore le propriétaire, le même compte revient
  // plusieurs fois et chaque résolution peut déclencher un rafraîchissement OAuth.
  let data: any = null;
  let dernierStatut = 0;
  let shareUrlServi: string | null = null;
  const jetons = new Map<string, string | null>();

  for (const essai of acces.essais) {
    if (!jetons.has(essai.profileId)) {
      jetons.set(essai.profileId, await getFathomToken(essai.profileId));
    }
    const accessToken = jetons.get(essai.profileId);
    if (!accessToken) continue;

    const res = await fetch(`${FATHOM_API_BASE}/recordings/${essai.recordingId}/download`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    if (res.ok) {
      data = await res.json().catch(() => null);
      shareUrlServi = essai.shareUrl ?? null;
      break;
    }

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
  //
  // `shareUrl` est celui de l'enregistrement effectivement servi, donc le sien
  // quand le lecteur en a un : « Voir sur Fathom » l'emmène alors sur SA page,
  // où il peut chercher dans le transcript et interroger l'IA sur son compte.
  // Null quand on ne connaît pas le lien de cette ligne précise : l'appelant
  // garde celui du call, qui reste valable pour tout le monde.
  return NextResponse.json({
    status: data?.status ?? 'processing',
    url: data?.video?.url ?? null,
    expiresAt: data?.video?.expires_at ?? null,
    failureReason: data?.failure_reason ?? null,
    shareUrl: shareUrlServi,
  });
}
