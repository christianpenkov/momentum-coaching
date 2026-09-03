import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
// Meme source que le front (lib/callTypes.ts), importable depuis Deno.
import { CALL_TYPES_VENTE } from '../../../lib/callTypes.ts';
// ⚠️ L'empreinte du code SOURCE de cette fonction, pour que `edge_sante_version` puisse
// dire si la version en ligne est celle du depot. Une Edge Function ne part pas avec
// `git push` : le 2026-09-03, `poll-leads` a tourne deux jours avec du code vieux de huit
// commits, et rien ne pouvait le voir — `crons_passages` prouve qu'un cron TOURNE, jamais
// qu'il tourne le BON code.
//
// Le fichier est genere par `scripts/empreintes-edge.mjs`, rejoue par
// `npm run deployer-edge <nom>` juste avant l'envoi : la valeur figee dans le bundle est
// donc celle du code reellement deploye.
import { EMPREINTES_EDGE } from '../../../lib/empreintes-edge.generated.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET')!;
const PLATFORM_URL = Deno.env.get('NEXT_PUBLIC_PLATFORM_URL') || 'https://momentum-plateforme.vercel.app';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function parseDurationMinutes(duration: string | null): number | null {
  if (!duration) return null;
  const match = duration.match(/(\d+)/);
  if (!match) return null;
  return parseInt(match[1], 10);
}

Deno.serve(async (req: Request) => {
  const auth = req.headers.get('authorization');
  if (!auth || auth !== `Bearer ${CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: 'Non autorisé' }), { status: 401 });
  }

  // Filigrane de passage : la preuve que ce cron est encore INVOQUE.
  //
  // Pose AU PLUS TOT, juste apres l'authentification, et non a la fin. La question que
  // pose `crons_sante` est « le planificateur appelle-t-il encore cette URL ? » — c'est
  // la panne invisible de la plateforme : un cron qui ne tourne plus n'echoue pas, il
  // se tait, et un silence ne se distingue pas d'un succes.
  //
  // Un echec SURVENU PENDANT l'execution est deja couvert par `cron_runs`, et les deux
  // ne doivent pas se recouvrir. Marquer a la fin ferait en plus passer un simple
  // depassement de temps pour une mort du cron — une fausse alerte, c'est-a-dire le
  // debut d'une alerte qu'on n'ouvre plus.
  //
  // Le seuil de silence vit sur la LIGNE (`crons_passages.silence_max`), pas ici : la
  // RPC ne met a jour que l'horodatage, donc changer la cadence de ce cron se repercute
  // en base sans toucher au code.
  //
  // Strictement non bloquant : un filigrane muet vaut mieux qu'un cron qui tombe.
  try {
    const { error: filigraneErr } = await supabase.rpc('marquer_passage_cron', { p_nom: 'notify-rapport', p_empreinte: EMPREINTES_EDGE['notify-rapport'] });
    if (filigraneErr) console.error('[notify-rapport] filigrane de passage:', filigraneErr.message);
  } catch (e) { console.error('[notify-rapport] filigrane de passage:', e); }

  // Map profileId → integrations_ready_at (toutes les intégrations obligatoires
  // connectées pour la 1ère fois, trigger DB, jamais réécrit ensuite) pour filtrer
  // les calls pré-Momentum. Voir docs/integrations-ready-at-vs-onboarding-completed-at.md.
  const { data: clients } = await supabase
    .from('clients')
    .select('profile_id, integrations_ready_at')
    .not('integrations_ready_at', 'is', null);

  const firstConnectedAtByProfile = new Map<string, string>();
  for (const row of clients ?? []) {
    if (row.profile_id && row.integrations_ready_at) {
      firstConnectedAtByProfile.set(row.profile_id, row.integrations_ready_at);
    }
  }

  const { data: calls, error } = await supabase
    .from('calls')
    .select('id, coach_id, invitee_name, scheduled_at, booked_at, duration')
    .eq('status', 'active')
    .is('no_show', null)
    .eq('rapport_notif_sent', false)
    .eq('rescheduled', false)
    .neq('ignored', true)
    .in('call_type', CALL_TYPES_VENTE)
    .not('scheduled_at', 'is', null)
    .not('duration', 'is', null);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  if (!calls?.length) {
    return new Response(JSON.stringify({ ok: true, notified: 0 }), { status: 200 });
  }

  const now = Date.now();

  const eligibleCalls = calls.filter((call: any) => {
    const firstConnectedAt = firstConnectedAtByProfile.get(call.coach_id);
    if (firstConnectedAt) {
      const refDate = call.booked_at || call.scheduled_at;
      if (new Date(refDate) < new Date(firstConnectedAt)) return false;
    }
    const durationMin = parseDurationMinutes(call.duration);
    if (durationMin === null) return false;
    const triggerTime = new Date(call.scheduled_at).getTime() + durationMin * 60 * 1000;
    return now >= triggerTime;
  });

  let notified = 0;
  const errors: string[] = [];

  await Promise.all(eligibleCalls.map(async (call: any) => {
    try {
      const res = await fetch(`${PLATFORM_URL}/api/push/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${CRON_SECRET}`,
        },
        body: JSON.stringify({
          profileId: call.coach_id,
          title: 'Rapport de call',
          body: `Comment s'est passé ton appel${call.invitee_name ? ` avec ${call.invitee_name}` : ''} ? Remplis ton rapport.`,
          url: `/client/calls?rapport=${call.id}`,
        }),
      });

      if (res.ok) {
        const { sent } = await res.json();
        if (sent > 0) {
          const { error: updateError } = await supabase
            .from('calls')
            .update({ rapport_notif_sent: true })
            .eq('id', call.id);

          if (updateError) errors.push(`update_${call.id}: ${updateError.message}`);
          else {
            notified++;
            const { error: notifError } = await supabase.from('client_notifications').insert({
              profile_id: call.coach_id,
              type: 'rapport_ready',
              call_id: call.id,
              payload: {
                invitee_name: call.invitee_name,
                scheduled_at: call.scheduled_at,
              },
            });
            if (notifError) errors.push(`notif_insert_${call.id}: ${notifError.message}`);
          }
        } else {
          errors.push(`no_delivery_${call.id}: aucune subscription active`);
        }
      } else {
        errors.push(`push_${call.id}: HTTP ${res.status}`);
      }
    } catch (e: any) {
      errors.push(`call_${call.id}: ${e?.message || 'unknown'}`);
    }
  }));

  return new Response(JSON.stringify({ ok: true, notified, errors }), { status: 200 });
});
