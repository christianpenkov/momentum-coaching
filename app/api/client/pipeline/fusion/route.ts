import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

// ─────────────────────────────────────────────────────────────────────────────
// Trancher un doublon : fusionner deux fiches, refuser, ou séparer à nouveau.
//
// Le sens de la fusion est TOUJOURS le même : les rendez-vous de la fiche e-mail
// rejoignent le lead Instagram. C'est la fiche la plus riche des deux — pseudo,
// photo, historique de DM — et c'est celle que l'élève reconnaît.
//
// Concrètement, fusionner = poser `ig_lead_id` sur les calls du prospect. Le
// pipeline les range alors avec le lead, sans autre changement : c'est déjà la
// clé qu'il utilise pour rattacher un call à un lead.
//
// ⚠️ ON N'EFFACE RIEN. La fiche prospect reste en base ; elle cesse simplement
// d'avoir des calls, donc de produire une carte. C'est ce qui rend la séparation
// possible plus tard, et c'est aussi ce qui évite qu'une fusion faite à tort
// détruise quoi que ce soit.
// ─────────────────────────────────────────────────────────────────────────────

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  let body: any;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 });
  }

  const { action, ig_lead_id, prospect_id, call_ids } = body as {
    action?: 'fusionner' | 'refuser' | 'separer';
    ig_lead_id?: string;
    prospect_id?: string;
    call_ids?: string[];
  };

  if (!action || !ig_lead_id || !prospect_id) {
    return NextResponse.json({ error: 'Champs requis manquants' }, { status: 400 });
  }

  // ── Le lead et le prospect appartiennent-ils bien à cette personne ? ────────
  // La route écrit avec la clé de service, qui contourne RLS. Sans ce contrôle,
  // n'importe qui pourrait rattacher les rendez-vous d'un autre élève à un lead
  // à lui. On revérifie donc l'appartenance des DEUX côtés, à chaque appel.
  const [{ data: lead }, { data: prospect }] = await Promise.all([
    supa.from('instagram_leads').select('id, profile_id').eq('id', ig_lead_id).maybeSingle(),
    supa.from('prospects').select('id, profile_id').eq('id', prospect_id).maybeSingle(),
  ]);
  if (!lead || lead.profile_id !== user.id || !prospect || prospect.profile_id !== user.id) {
    return NextResponse.json({ error: 'Fiche introuvable' }, { status: 404 });
  }

  // ── Refuser : on retient, et on ne repose plus la question ─────────────────
  if (action === 'refuser') {
    const { error } = await supa.from('fusions_fiches').upsert({
      profile_id: user.id, ig_lead_id, prospect_id,
      statut: 'refusee', call_ids: [], decided_at: new Date().toISOString(),
    }, { onConflict: 'profile_id,ig_lead_id,prospect_id' });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // ── Séparer : défaire exactement ce que la fusion avait déplacé ────────────
  if (action === 'separer') {
    const { data: decision } = await supa.from('fusions_fiches')
      .select('id, call_ids, statut')
      .eq('profile_id', user.id).eq('ig_lead_id', ig_lead_id).eq('prospect_id', prospect_id)
      .maybeSingle();

    if (!decision || decision.statut !== 'fusionnee') {
      return NextResponse.json({ error: 'Aucune fusion à défaire' }, { status: 409 });
    }

    // La liste EXACTE des calls déplacés, et elle seule. Un lead Instagram a en
    // général ses propres rendez-vous ; remettre tous ses calls à `null`
    // détruirait sa fiche.
    const aRendre = (decision.call_ids ?? []) as string[];
    if (aRendre.length > 0) {
      const { error } = await supa.from('calls')
        .update({ ig_lead_id: null })
        .in('id', aRendre)
        .eq('ig_lead_id', ig_lead_id);   // ceinture : on ne touche pas un call parti ailleurs
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // La décision disparaît complètement : la paire redevient un doublon
    // soupçonné, et le bandeau la reproposera. C'est voulu — séparer, c'est dire
    // « je m'étais trompé », pas « ce n'est pas la même personne ». Pour taire
    // définitivement la paire, il y a « Ce n'est pas la même ».
    await supa.from('fusions_fiches').delete().eq('id', decision.id);
    return NextResponse.json({ ok: true, calls_rendus: aRendre.length });
  }

  // ── Fusionner ──────────────────────────────────────────────────────────────
  if (!Array.isArray(call_ids) || call_ids.length === 0) {
    return NextResponse.json({ error: 'Aucun rendez-vous à rattacher' }, { status: 400 });
  }

  // On ne déplace QUE des calls de cet élève, rattachés à ce prospect et à aucun
  // lead. Le client propose la liste, le serveur la restreint : c'est lui qui
  // décide de ce qui bouge, pas la page.
  const { data: aDeplacer, error: erreurLecture } = await supa.from('calls')
    .select('id')
    .in('id', call_ids)
    .eq('prospect_id', prospect_id)
    .is('ig_lead_id', null);
  if (erreurLecture) return NextResponse.json({ error: erreurLecture.message }, { status: 500 });

  const ids = (aDeplacer ?? []).map(c => c.id as string);
  if (ids.length === 0) {
    return NextResponse.json({ error: 'Ces rendez-vous ont déjà changé de fiche' }, { status: 409 });
  }

  const { error: erreurEcriture } = await supa.from('calls')
    .update({ ig_lead_id })
    .in('id', ids);
  if (erreurEcriture) return NextResponse.json({ error: erreurEcriture.message }, { status: 500 });

  // La trace est écrite APRÈS le déplacement : si l'update échoue, aucune
  // décision n'est enregistrée et le bandeau repropose la paire. L'inverse
  // laisserait croire à une fusion qui n'a pas eu lieu.
  const { error: erreurTrace } = await supa.from('fusions_fiches').upsert({
    profile_id: user.id, ig_lead_id, prospect_id,
    statut: 'fusionnee', call_ids: ids, decided_at: new Date().toISOString(),
  }, { onConflict: 'profile_id,ig_lead_id,prospect_id' });
  if (erreurTrace) return NextResponse.json({ error: erreurTrace.message }, { status: 500 });

  return NextResponse.json({ ok: true, calls_rattaches: ids.length });
}
