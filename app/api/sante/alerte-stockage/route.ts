import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// GET /api/sante/alerte-stockage
//
// Prévient par e-mail quand la base approche du plafond du plan Supabase.
//
// ── Pourquoi une alerte, et pas seulement une vue ────────────────────────────
//
// `base_sante_taille` dit la vérité, mais il faut penser à la regarder. Le plafond
// de stockage est le seul risque de cette plateforme qui ne prévient pas tout seul :
// rien ne casse à l'avance, rien n'apparaît dans `cron_runs`, et le jour où c'est
// plein, les écritures échouent d'un coup. Les statistiques se figent en silence.
//
// ── Pourquoi ici et pas dans pg_cron ─────────────────────────────────────────
//
// `pg_net` est installé, la base pourrait donc appeler Resend elle-même. Mais il
// faudrait y stocker la clé d'API. Elle vit déjà dans les variables Vercel : cette
// route est le seul endroit du système qui l'a légitimement sous la main.
// `poll-leads` (qui porte CRON_SECRET) appelle ici une fois par jour. Aucun secret
// ne se déplace, aucun planificateur externe à créer.
//
// ── Anti-répétition ──────────────────────────────────────────────────────────
//
// Deux seuils, chacun envoyé UNE fois (table `alertes_plateforme`). Une alerte qui
// revient tous les matins est ignorée dès la troisième fois — donc au moment où elle
// compte. Si la situation se résout (passage en Pro, purge), les lignes sont
// effacées ici même, ce qui réarme les alertes pour la prochaine fois.

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const SEUILS = [
  { cle: 'stockage_90j', jours: 90, urgence: 'Il reste environ trois mois' },
  { cle: 'stockage_30j', jours: 30, urgence: 'Il reste moins d’un mois' },
];

function corpsEmail(sante: any, seuil: { jours: number; urgence: string }): string {
  const lien = 'https://supabase.com/dashboard/project/nvjgwtetyuatnkjihmtw/settings/billing/subscription';
  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:15px;line-height:1.55;color:#1a1815;max-width:600px">
  <p style="font-size:17px;font-weight:600;margin:0 0 4px">La base de données approche du plafond du plan gratuit</p>
  <p style="margin:0 0 18px;color:#797569;font-size:13px">${seuil.urgence} avant que les écritures commencent à échouer.</p>

  <p style="margin:0 0 6px"><strong>Où on en est</strong></p>
  <p style="margin:0 0 18px">
    Taille actuelle : <strong>${sante.taille_actuelle}</strong> sur les 500 Mo du plan gratuit.<br>
    Croissance mesurée : <strong>${sante.croissance_par_jour} par jour</strong>.<br>
    Autonomie restante : <strong>${sante.jours_restants_plan_gratuit} jours</strong> sur le plan gratuit,
    <strong>${sante.jours_restants_plan_pro} jours</strong> si tu passes en Pro.
  </p>

  <p style="margin:0 0 6px"><strong>Pourquoi la base grossit</strong></p>
  <p style="margin:0 0 18px">
    Les statistiques de contenu sont stockées en <em>instantanés quotidiens</em> : une ligne
    par post Instagram et par jour, une par vidéo YouTube et par jour. C'est ce qui permet
    d'afficher l'évolution d'un contenu dans le temps et de comparer deux périodes. La
    contrepartie est que la base grandit avec le <strong>temps</strong>, pas seulement avec
    le nombre d'élèves : chaque élève supplémentaire ajoute ses posts, et chaque jour
    ajoute une ligne pour chacun d'eux.
  </p>

  <p style="margin:0 0 6px"><strong>Ce qu'il faut faire</strong></p>
  <p style="margin:0 0 18px">
    Passer le projet Supabase en plan <strong>Pro</strong> (25 $/mois, 8 Go inclus). C'est la
    seule action qui règle vraiment le problème : à ton rythme actuel, le Pro donne
    <strong>${sante.jours_restants_plan_pro} jours</strong> d'autonomie, et le disque s'étend
    ensuite tout seul contre quelques centimes par gigaoctet.
  </p>

  <p style="margin:0 0 6px"><strong>Ce qui a déjà été fait pour retarder l'échéance</strong></p>
  <p style="margin:0 0 18px">
    Le 30 août 2026, un index UNIQUE redondant a été retiré de la table des posts
    Instagram (deux contraintes portaient les mêmes trois colonnes) : environ 13 % de cette
    table. Le levier restant serait de sortir les colonnes qui ne changent jamais pour un
    post donné — légende, permalien, vignette, soit 326 des 457 octets de données par
    ligne — dans une table à part. Il diviserait la croissance par deux environ, mais il
    touche les écrans de statistiques : il n'a volontairement pas été fait, parce que le
    passage en Pro règle le sujet sans risque.
  </p>

  <p style="margin:0 0 6px"><strong>Si rien n'est fait</strong></p>
  <p style="margin:0 0 22px">
    Quand le plafond est atteint, la base passe en lecture seule. Les crons continuent de
    tourner mais leurs écritures échouent : les statistiques de tous les élèves se figent
    au jour du blocage. Rien ne le signale à l'écran, et les journées manquées ne se
    rattrapent pas toutes — Instagram et YouTube ne servent certaines données que quelques
    jours.
  </p>

  <p style="margin:0 0 24px">
    <a href="${lien}" style="background:#1a1815;color:#fff;text-decoration:none;padding:10px 18px;border-radius:7px;font-weight:600;display:inline-block">Ouvrir la facturation Supabase</a>
  </p>

  <p style="margin:0;padding-top:14px;border-top:1px solid #eeeae0;color:#797569;font-size:11px">
    Pour vérifier toi-même à tout moment : <code>select * from base_sante_taille;</code><br>
    Contexte complet : <code>orbit/docs/checklist-scalabilite.md</code> et
    <code>orbit/docs/handoff-appels-instagram-scalabilite.md</code>.<br>
    Cette alerte n'est envoyée qu'une seule fois par seuil.
  </p>
</div>`;
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const { data: sante, error } = await supabase.from('base_sante_taille').select('*').maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!sante) return NextResponse.json({ ok: true, action: 'vue_vide' });

  const jours: number | null = sante.jours_restants_plan_gratuit ?? null;

  // Croissance nulle ou indéterminée : on ne conclut rien. Un projet sans écriture
  // récente n'est pas un projet en danger.
  if (jours == null) return NextResponse.json({ ok: true, action: 'croissance_indeterminee' });

  const { data: dejaEnvoyees } = await supabase.from('alertes_plateforme').select('cle');
  const envoyees = new Set((dejaEnvoyees ?? []).map((a: any) => a.cle));

  // Situation revenue au vert : on efface la mémoire pour que l'alerte puisse
  // resservir un jour. Sans ça, un passage en Pro rendrait ces alertes muettes pour
  // toujours — y compris quand le Pro arrivera lui aussi à saturation.
  const seuilLePlusLarge = Math.max(...SEUILS.map((s) => s.jours));
  if (jours > seuilLePlusLarge && envoyees.size > 0) {
    await supabase.from('alertes_plateforme').delete().in('cle', SEUILS.map((s) => s.cle));
    return NextResponse.json({ ok: true, action: 'rearme', jours });
  }

  // Le seuil le plus urgent d'abord : si on tombe directement sous 30 jours, c'est
  // l'alerte urgente qui part, pas celle des 90 jours.
  const aDeclencher = [...SEUILS].sort((a, b) => a.jours - b.jours)
    .find((s) => jours <= s.jours && !envoyees.has(s.cle));
  if (!aDeclencher) return NextResponse.json({ ok: true, action: 'rien_a_signaler', jours });

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('[alerte-stockage] RESEND_API_KEY manquant — email non envoyé');
    return NextResponse.json({ error: 'RESEND_API_KEY manquant' }, { status: 500 });
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: 'Momentum <noreply@ubizenai.com>',
      to: 'christianpenkov06@gmail.com',
      subject: `Base de données — ${jours} jours avant le plafond du plan gratuit`,
      html: corpsEmail(sante, aDeclencher),
    }),
  });

  // ⚠️ On n'inscrit le seuil comme « envoyé » que si Resend a bien accepté. Sinon un
  // échec réseau condamnerait l'alerte au silence définitif — exactement le contraire
  // du but.
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error(`[alerte-stockage] Resend HTTP ${res.status}: ${detail.slice(0, 300)}`);
    return NextResponse.json({ error: `resend_${res.status}` }, { status: 502 });
  }

  await supabase.from('alertes_plateforme').upsert({
    cle: aDeclencher.cle,
    envoyee_le: new Date().toISOString(),
    contexte: `${sante.taille_actuelle}, ${sante.croissance_par_jour}/jour, ${jours} j restants`,
  }, { onConflict: 'cle' });

  return NextResponse.json({ ok: true, action: 'envoye', seuil: aDeclencher.cle, jours });
}
