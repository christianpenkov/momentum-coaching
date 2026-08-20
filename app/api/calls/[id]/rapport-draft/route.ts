import { NextRequest, NextResponse } from 'next/server';
import { requireCallAccess, serviceSupabase } from '@/lib/callAccess';

/**
 * Brouillon de rapport — GET / PUT / DELETE sur un call.
 *
 * POURQUOI UNE ROUTE SÉPARÉE de /api/calls/[id]/rapport, et pas un champ de plus
 * dans celle-ci : les deux sémantiques d'échec sont opposées.
 *
 *   • Le rapport DOIT échouer bruyamment. `patchRapport` lève, et l'appelant a
 *     interdiction d'avancer d'étape en cas d'échec — sans quoi l'UI célèbre un
 *     deal jamais persisté.
 *   • Le brouillon DOIT échouer en silence. Il ne bloque rien, n'affiche rien, ne
 *     fait jamais échouer une action de l'utilisateur.
 *
 * Les mélanger obligerait chaque appelant à distinguer « échec critique » et
 * « échec ignorable » sur la foi d'un champ de réponse — exactement le genre de
 * subtilité qui casse silencieusement six mois plus tard.
 *
 * La table call_rapport_drafts a la RLS activée SANS policy : elle n'est
 * accessible que par ici, en service_role, après le contrôle d'appartenance de
 * lib/callAccess.ts.
 */

// Garde-fou de taille. Un brouillon normal pèse quelques centaines d'octets ; les
// notes libres sont les seuls champs vraiment extensibles. 64 Ko laisse une marge
// confortable tout en bornant ce qu'un client peut stocker, et reste sous la limite
// de corps d'un fetch keepalive (utilisé à la fermeture de page).
const MAX_ANSWERS_BYTES = 64 * 1024;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const access = await requireCallAccess(id);
  if (!access.ok) return access.response;

  const { data } = await serviceSupabase
    .from('call_rapport_drafts')
    .select('id, kind, step, step_index, step_total, answers, updated_at')
    .eq('call_id', id)
    .eq('user_id', access.userId)
    .maybeSingle();

  // L'état actuel du call part avec le brouillon : le client compare les deux pour
  // détecter un brouillon périmé — une saisie initiale abandonnée sur mobile alors
  // que le rapport a été soumis depuis un autre appareil. Sans cette comparaison,
  // rouvrir le brouillon réécrirait le rapport avec de vieilles réponses.
  return NextResponse.json({
    draft: data ?? null,
    call: {
      outcome: access.call.outcome,
      session_completed: access.call.session_completed,
      session_no_show: access.call.session_no_show,
      status: access.call.status,
    },
  });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const access = await requireCallAccess(id);
  if (!access.ok) return access.response;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Corps invalide' }, { status: 400 });
  }

  const kind = body.kind;
  if (kind !== 'sales' && kind !== 'session') {
    return NextResponse.json({ error: 'kind invalide' }, { status: 400 });
  }
  if (typeof body.step !== 'string' || !body.step) {
    return NextResponse.json({ error: 'step manquant' }, { status: 400 });
  }

  const answers = body.answers ?? {};
  if (JSON.stringify(answers).length > MAX_ANSWERS_BYTES) {
    return NextResponse.json({ error: 'Brouillon trop volumineux' }, { status: 413 });
  }

  // Bornes défensives : step_index/step_total viennent du client et alimentent le
  // libellé « étape N/M » des cartes. La base a déjà un CHECK >= 1 ; on évite ici de
  // lui envoyer une valeur qui la ferait échouer, puisque cet échec serait avalé.
  const stepIndex = Math.max(1, Math.min(99, Number(body.step_index) || 1));
  const stepTotal = Math.max(stepIndex, Math.min(99, Number(body.step_total) || 1));

  const { error } = await serviceSupabase
    .from('call_rapport_drafts')
    .upsert({
      call_id: id,
      user_id: access.userId,
      kind,
      step: body.step,
      step_index: stepIndex,
      step_total: stepTotal,
      answers,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'call_id,user_id' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const access = await requireCallAccess(id);
  if (!access.ok) return access.response;

  const { error } = await serviceSupabase
    .from('call_rapport_drafts')
    .delete()
    .eq('call_id', id)
    .eq('user_id', access.userId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
