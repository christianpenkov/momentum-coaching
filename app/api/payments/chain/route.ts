import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { resolveTargetProfile } from '@/lib/stripe-account';

/**
 * Chaîne d'acquisition d'un deal : comment le prospect est arrivé jusqu'au paiement.
 *
 * Rien à calculer — `prospect_events` journalise déjà tout le funnel (lm_sent,
 * hook_replied, link_clicked, call_booked). On la relie simplement au deal, ce qui
 * manquait pour répondre à « quel contenu a produit cet argent ».
 */

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const EVENT_LABELS: Record<string, string> = {
  lm_sent: 'Lead magnet envoyé en DM',
  lm_clicked: 'Lead magnet ouvert',
  hook_replied: 'A répondu à l\'accroche',
  calendly_link_sent: 'Lien Calendly envoyé',
  link_clicked: 'Lien Calendly cliqué',
  call_booked: 'Call booké',
};

export async function GET(request: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const dealId = new URL(request.url).searchParams.get('dealId');
  if (!dealId) return NextResponse.json({ error: 'dealId requis' }, { status: 400 });

  const { data: deal } = await supa
    .from('deals')
    .select('profile_id, ig_lead_id, call_id, signed_at, first_touch_content_id, attribution_source, short_url, stripe_payment_link_id, status')
    .eq('id', dealId)
    .maybeSingle();

  if (!deal) return NextResponse.json({ error: 'Deal introuvable' }, { status: 404 });

  // Le coach peut consulter un deal de ses élèves, personne d'autre.
  const allowed = await resolveTargetProfile(user.id, deal.profile_id);
  if (!allowed) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

  const steps: { label: string; date: string }[] = [];

  // Premier contact : le contenu commenté, s'il est connu.
  if (deal.ig_lead_id) {
    const { data: lead } = await supa
      .from('instagram_leads')
      .select('ig_username, media_id, keyword_matched, detected_at, source')
      .eq('id', deal.ig_lead_id)
      .maybeSingle();

    if (lead) {
      const origin = lead.source === 'cold_dm'
        ? 'Démarchage direct (cold DM)'
        : lead.media_id
          ? `Commentaire${lead.keyword_matched ? ` « ${lead.keyword_matched} »` : ''} sous un contenu`
          : 'Message reçu en DM';
      steps.push({ label: origin, date: fmtDate(lead.detected_at) });
    }

    const { data: events } = await supa
      .from('prospect_events')
      .select('event_type, occurred_at')
      .eq('ig_lead_id', deal.ig_lead_id)
      .order('occurred_at', { ascending: true });

    // Un même type peut se répéter (relances) : on ne garde que la première
    // occurrence, sinon la chaîne devient illisible.
    const seen = new Set<string>();
    for (const e of events ?? []) {
      if (seen.has(e.event_type)) continue;
      seen.add(e.event_type);
      const label = EVENT_LABELS[e.event_type];
      if (label) steps.push({ label, date: fmtDate(e.occurred_at) });
    }
  }

  // Le call, s'il a eu lieu.
  if (deal.call_id) {
    const { data: call } = await supa
      .from('calls')
      .select('scheduled_at, deal_closed, no_show')
      .eq('id', deal.call_id)
      .maybeSingle();
    if (call?.scheduled_at && !steps.some(s => s.label.startsWith('Call'))) {
      steps.push({
        label: call.no_show ? 'Call booké (absent)' : 'Call honoré',
        date: fmtDate(call.scheduled_at),
      });
    }
  }

  // Dernière étape : dire ce qui s'est RÉELLEMENT passé, pas ce que le parcours
  // nominal supposerait. Les deals issus du backfill (anciens calls closés) n'ont
  // jamais eu de lien de paiement — affirmer le contraire décrit une action qui
  // n'a pas eu lieu.
  const hasLink = !!deal.stripe_payment_link_id || !!deal.short_url;

  const { count: paidCount } = await supa
    .from('deal_payments')
    .select('id', { count: 'exact', head: true })
    .eq('deal_id', dealId)
    .eq('status', 'succeeded');

  steps.push({
    label: !hasLink
      ? 'Deal signé (aucun lien de paiement)'
      : (paidCount ?? 0) > 0
        ? 'Deal signé, lien de paiement payé'
        : 'Deal signé, lien de paiement créé',
    date: fmtDate(deal.signed_at),
  });

  return NextResponse.json({ steps });
}

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}
