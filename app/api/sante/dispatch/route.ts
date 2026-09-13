import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { envoyerAlerte, sonderCanalAlerte } from '@/lib/alertesEmail';
import { signalerIncident } from '@/lib/incidents';
import { blocIncident, enveloppeEmail, sujetIncident, type IncidentLu } from '@/lib/incidentsEmail';
import { dateKeyIn } from '@/lib/timezone';
import { VERSIONS_API_DEPOT } from '@/lib/versions-api-depot.generated';

// GET /api/sante/dispatch — le répartiteur de la surveillance.
//
// Appelé toutes les 5 minutes par pg_cron (`declencher_cron('sante-dispatch')`).
//
// ── Pourquoi il existe ────────────────────────────────────────────────────────────
//
// Jusqu'au 2026-09-13, TOUTES les alertes par e-mail partaient d'un seul endroit :
// `poll-leads`, à 8 h, qui appelait `alerte-vues` et `alerte-stockage` sans lire leurs
// réponses. Trois conséquences mesurées par l'audit ce jour-là :
//
//   1. Si `poll-leads` mourait — la panne la plus grave de la plateforme, plus aucun
//      lead ni DM — la vue qui le détecte (`crons_sante`) n'était lue par… personne,
//      puisque c'est `poll-leads` qui déclenchait sa lecture. Personne ne peut signaler
//      sa propre mort.
//   2. Un cron silencieux, une file de webhooks bloquée ou une fonction qui plante
//      n'étaient signalés qu'à 8 h le lendemain : jusqu'à 24 h de DM perdus.
//   3. Si Resend refusait (clé, domaine, quota), rien ne le disait nulle part.
//
// ── Ce qu'il fait, par cadence ────────────────────────────────────────────────────
//
//   À chaque passage (5 min)  → les incidents CRITIQUES nouveaux partent par e-mail.
//   Une fois par heure        → les vues critiques (crons muets, file bloquée, pg_cron,
//                               pg_net, accès sans RLS) + le pont dépôt → base.
//   Une fois par jour (8 h)   → toutes les vues, le stockage, le récapitulatif des
//                               incidents non urgents, l'expiration des domaines, la
//                               sonde du canal d'alerte.
//   À la fin                  → le battement externe (healthchecks.io).
//
// ── Qui surveille le répartiteur ──────────────────────────────────────────────────
//
// Pas lui-même. Le battement externe : ce passage envoie un « tout va bien » à
// healthchecks.io (`HEALTHCHECK_PING_URL`) SEULEMENT si la chaîne d'alerte a fonctionné
// de bout en bout. S'il se tait — Vercel en panne, base injoignable, pg_cron arrêté,
// secret désaccordé, Resend refusé — healthchecks.io prévient par SA propre messagerie,
// qui ne dépend d'aucune pièce de cette plateforme.
//
// ⚠️ Les cadences horaire et quotidienne ne reposent PAS sur l'heure exacte du passage
// (un passage raté ferait sauter la journée) : chacune porte sa ligne dans
// `crons_passages`, et s'exécute dès que la précédente est assez ancienne. Ces lignes
// sont elles-mêmes surveillées par `crons_sante`, lue toutes les heures.

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/**
 * Au-delà, un seul e-mail groupé. Une rafale de 40 incidents critiques ne doit pas
 * épuiser le quota Resend (100/jour), que partagent les e-mails de connexion des élèves.
 */
const PLAFOND_EMAILS_PAR_PASSAGE = 6;
const HEURE_QUOTIDIENNE_PARIS = 8;
const JOURS_AVANT_EXPIRATION_DOMAINE = 30;

function heureParis(d: Date): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hour12: false }).format(d)) % 24;
}

async function dernierPassage(nom: string): Promise<Date | null> {
  const { data, error } = await supabase.from('crons_passages').select('dernier_passage').eq('nom', nom).maybeSingle();
  if (error) throw new Error(`lecture crons_passages(${nom}) : ${error.message}`);
  return data?.dernier_passage ? new Date(data.dernier_passage) : null;
}

async function marquer(nom: string, contexte: string) {
  const { error } = await supabase.rpc('marquer_passage_cron', { p_nom: nom, p_contexte: contexte.slice(0, 500) });
  if (error) throw new Error(`marquer_passage_cron(${nom}) : ${error.message}`);
}

/** Appelle une autre route de santé de cette même plateforme, et dit si elle a réussi. */
async function appelerSante(origine: string, chemin: string, delaiMs: number): Promise<{ ok: boolean; resume: string }> {
  const controleur = new AbortController();
  const minuterie = setTimeout(() => controleur.abort(), delaiMs);
  try {
    const res = await fetch(`${origine}${chemin}`, {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
      signal: controleur.signal,
      cache: 'no-store',
    });
    const texte = await res.text().catch(() => '');
    let problemes: string[] = [];
    try { problemes = (JSON.parse(texte).problemes as string[] | undefined) ?? []; } catch { /* corps non JSON */ }
    if (!res.ok || problemes.length) {
      return { ok: false, resume: `${chemin} → HTTP ${res.status}${problemes.length ? ` : ${problemes.join(' ; ')}` : ` : ${texte.slice(0, 300)}`}` };
    }
    return { ok: true, resume: texte.slice(0, 500) };
  } catch (e) {
    return { ok: false, resume: `${chemin} → ${e instanceof Error ? e.message : String(e)}` };
  } finally {
    clearTimeout(minuterie);
  }
}

/** Le domaine enregistrable d'un nom d'hôte (`link.ubizenai.com` → `ubizenai.com`). */
function domaineEnregistrable(hote: string): string {
  return hote.toLowerCase().split('.').slice(-2).join('.');
}

/**
 * Les domaines dont la plateforme dépend, lus dans sa configuration — jamais une liste
 * écrite ici, qui serait fausse le jour d'un transfert.
 *   · l'expéditeur des alertes et des e-mails d'authentification ;
 *   · l'adresse publique de la plateforme et celle des liens partagés, sauf quand elles
 *     sont sur `vercel.app` (le domaine appartient alors à Vercel).
 */
function domainesSurveilles(): string[] {
  const hotes: string[] = [];
  const exp = process.env.ALERTES_EMAIL_EXPEDITEUR?.match(/@([^>\s]+)/)?.[1];
  if (exp) hotes.push(exp);
  for (const v of [process.env.NEXT_PUBLIC_PLATFORM_URL, process.env.MOMENTUM_REDIRECT_ORIGIN]) {
    try { if (v) hotes.push(new URL(v).hostname); } catch { /* valeur illisible */ }
  }
  return [...new Set(hotes.filter((h) => !h.endsWith('vercel.app') && !h.endsWith('localhost')).map(domaineEnregistrable))];
}

/**
 * Date d'expiration d'un domaine par RDAP (le successeur normalisé de WHOIS, public et
 * gratuit). `rdap.org` redirige vers le registre compétent. Rend null si le registre
 * ne répond pas : une ignorance ne déclenche rien, le passage de demain réessaiera.
 */
async function expirationDomaine(domaine: string): Promise<Date | null> {
  const controleur = new AbortController();
  const minuterie = setTimeout(() => controleur.abort(), 8_000);
  try {
    const res = await fetch(`https://rdap.org/domain/${encodeURIComponent(domaine)}`, {
      headers: { accept: 'application/rdap+json' }, signal: controleur.signal, redirect: 'follow', cache: 'no-store',
    });
    if (!res.ok) return null;
    const json = await res.json() as { events?: { eventAction?: string; eventDate?: string }[] };
    const ev = json.events?.find((e) => e.eventAction === 'expiration');
    return ev?.eventDate ? new Date(ev.eventDate) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(minuterie);
  }
}

/** Réserve un incident AVANT de l'envoyer : deux passages simultanés ne l'envoient jamais deux fois. */
async function reserver(i: IncidentLu): Promise<boolean> {
  const { data, error } = await supabase
    .from('incidents')
    .update({ notifie_le: new Date().toISOString(), version_notifiee: i.version_derniere })
    .eq('empreinte', i.empreinte)
    .is('notifie_le', null)
    .select('empreinte');
  if (error) throw new Error(`réservation d'incident : ${error.message}`);
  return (data ?? []).length === 1;
}

async function liberer(empreintes: string[]) {
  if (!empreintes.length) return;
  await supabase.from('incidents').update({ notifie_le: null }).in('empreinte', empreintes);
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const maintenant = new Date();
  const origine = new URL(request.url).origin;
  const resultats: Record<string, unknown> = {};
  // Tout ce qui empêche la chaîne d'alerte de fonctionner. Non vide → pas de battement.
  const problemes: string[] = [];

  try {
    await marquer('sante-dispatch', 'répartiteur de la surveillance');
  } catch (e) {
    problemes.push(e instanceof Error ? e.message : String(e));
  }

  // ── Une fois par heure ────────────────────────────────────────────────────────────
  try {
    const dernier = await dernierPassage('sante-horaire');
    if (!dernier || maintenant.getTime() - dernier.getTime() > 55 * 60_000) {
      // Marqué AVANT le travail : un passage qui échoue au milieu ne doit pas être
      // rejoué toutes les 5 minutes. L'échec, lui, retient le battement externe.
      await marquer('sante-horaire', 'vues critiques et pont dépôt → base');
      // ⚠️ Le pont dépôt → base (empreintes des Edge Functions, liste des migrations) est
      // fait par `alerte-vues` elle-même AVANT de lire ses vues, y compris en mode
      // `?critiques=1` : pas d'appel `?manifeste=1` séparé, il ferait le travail deux fois.

      // Versions d'API écrites dans le code (même pont, même raison : la base ne lit pas
      // le dépôt). Le `delete` vient après, pour qu'une panne au milieu laisse trop de
      // lignes (fausse alerte visible) plutôt que trop peu (silence).
      if (VERSIONS_API_DEPOT.length) {
        const { error: eUp } = await supabase.from('versions_api_depot').upsert(
          VERSIONS_API_DEPOT.map((v) => ({ ...v, mis_a_jour_le: maintenant.toISOString() })),
          { onConflict: 'fournisseur,version' },
        );
        if (eUp) problemes.push(`versions_api_depot : ${eUp.message}`);
        else {
          const { error: eDel } = await supabase.from('versions_api_depot').delete().lt('mis_a_jour_le', maintenant.toISOString());
          if (eDel) problemes.push(`versions_api_depot (ménage) : ${eDel.message}`);
        }
      }

      const critiques = await appelerSante(origine, '/api/sante/alerte-vues?critiques=1', 45_000);
      if (!critiques.ok) problemes.push(critiques.resume);
      resultats.horaire = critiques.ok ? 'fait' : 'en échec';
    }
  } catch (e) {
    problemes.push(`horaire : ${e instanceof Error ? e.message : String(e)}`);
  }

  // ── Une fois par jour, dès 8 h à Paris ────────────────────────────────────────────
  try {
    const dernier = await dernierPassage('sante-quotidien');
    const aujourdhui = dateKeyIn(maintenant, 'Europe/Paris');
    const dejaFait = dernier && dateKeyIn(dernier, 'Europe/Paris') === aujourdhui;
    if (!dejaFait && heureParis(maintenant) >= HEURE_QUOTIDIENNE_PARIS) {
      // Marqué AVANT le travail, pour la même raison qu'à l'heure — et une de plus : la
      // sonde envoie un vrai e-mail, qu'un passage rejoué toutes les 5 minutes
      // multiplierait par douze dans le quota Resend.
      await marquer('sante-quotidien', `passage du ${aujourdhui}`);
      const quotidien: Record<string, unknown> = {};

      const vues = await appelerSante(origine, '/api/sante/alerte-vues', 90_000);
      quotidien.vues = vues.ok ? 'lues' : vues.resume;
      if (!vues.ok) problemes.push(vues.resume);

      const stockage = await appelerSante(origine, '/api/sante/alerte-stockage', 20_000);
      quotidien.stockage = stockage.ok ? 'lu' : stockage.resume;
      if (!stockage.ok) problemes.push(stockage.resume);

      // Le canal d'alerte fonctionne-t-il encore ? Si non, inutile de l'utiliser pour
      // le dire : c'est le battement externe qui préviendra.
      const canal = await sonderCanalAlerte();
      quotidien.canal = canal ?? 'ok';
      if (canal) problemes.push(`canal d’alerte : ${canal}`);

      // Domaines : un domaine expiré fait tomber d'un coup les e-mails, les pages
      // légales exigées par Meta et Google, et les liens de bio.
      const domaines: Record<string, string> = {};
      for (const d of domainesSurveilles()) {
        const exp = await expirationDomaine(d);
        if (!exp) { domaines[d] = 'non vérifiable aujourd’hui'; continue; }
        const jours = Math.floor((exp.getTime() - maintenant.getTime()) / 86_400_000);
        domaines[d] = `expire dans ${jours} j`;
        if (jours <= JOURS_AVANT_EXPIRATION_DOMAINE) {
          await signalerIncident({
            source: 'sante',
            gravite: 'critique',
            titre: `Le domaine ${d} expire dans ${jours} jour(s)`,
            empreinte: ['domaine-expiration', d],
            detail: {
              type: 'domaine_expiration',
              domaine: d,
              expire_le: exp.toISOString(),
              jours_restants: jours,
              consequence: 'À expiration : les e-mails (alertes, invitations, connexion) ne partent plus, les pages légales exigées par Meta et Google tombent, et les liens courts sur ce domaine cessent de rediriger.',
              a_faire: 'Renouveler le domaine chez son registraire et activer le renouvellement automatique avec un moyen de paiement valide.',
            },
          });
        }
      }
      quotidien.domaines = domaines;

      // Le battement externe est la SEULE protection contre la mort de la chaîne entière.
      // Son absence est dite une fois (incident non urgent), jamais tue.
      if (!process.env.HEALTHCHECK_PING_URL) {
        await signalerIncident({
          source: 'sante',
          gravite: 'normale',
          titre: 'Le battement externe n’est pas configuré : si la surveillance elle-même tombe, personne ne sera prévenu',
          empreinte: ['configuration', 'HEALTHCHECK_PING_URL'],
          detail: {
            type: 'configuration_manquante',
            variable: 'HEALTHCHECK_PING_URL',
            a_faire: 'Créer un check sur healthchecks.io (gratuit), période 5 min, délai de grâce 1 h, puis poser son URL de ping dans les variables Vercel (production) sous HEALTHCHECK_PING_URL. Détail : docs/surveillance-et-incidents.md.',
          },
        });
      }

      // Récapitulatif des incidents non urgents apparus depuis hier.
      quotidien.recapitulatif = await envoyerRecapitulatif(problemes);

      resultats.quotidien = quotidien;
    }
  } catch (e) {
    problemes.push(`quotidien : ${e instanceof Error ? e.message : String(e)}`);
  }

  // ── À chaque passage : les incidents critiques ────────────────────────────────────
  try {
    resultats.critiques = await envoyerCritiques(problemes);
  } catch (e) {
    problemes.push(`incidents critiques : ${e instanceof Error ? e.message : String(e)}`);
  }

  // ── Le battement externe ──────────────────────────────────────────────────────────
  //
  // ⚠️ En cas de problème on n'envoie PAS `/fail` : un hoquet isolé (une route qui met
  // trop longtemps une fois) ferait basculer le check et envoyer deux e-mails pour rien.
  // On se tait, et on écrit le motif dans le journal du check (`/log`, qui ne change pas
  // son état). healthchecks.io ne prévient qu'après le délai de grâce — un problème qui
  // dure, pas un problème qui passe — et le motif est alors lisible dans son journal.
  const ping = process.env.HEALTHCHECK_PING_URL;
  if (ping) {
    try {
      const controleur = new AbortController();
      const minuterie = setTimeout(() => controleur.abort(), 8_000);
      if (problemes.length === 0) {
        await fetch(ping, { method: 'POST', body: JSON.stringify(resultats).slice(0, 10_000), signal: controleur.signal, cache: 'no-store' });
      } else {
        await fetch(`${ping.replace(/\/$/, '')}/log`, { method: 'POST', body: problemes.join('\n').slice(0, 10_000), signal: controleur.signal, cache: 'no-store' });
      }
      clearTimeout(minuterie);
      resultats.battement = problemes.length === 0 ? 'envoyé' : 'retenu (problème journalisé)';
    } catch (e) {
      resultats.battement = `injoignable : ${e instanceof Error ? e.message : String(e)}`;
    }
  } else {
    resultats.battement = 'non configuré';
  }

  return NextResponse.json({ ok: problemes.length === 0, resultats, problemes });
}

async function lireIncidents(gravite: 'critique' | 'normale', limite: number): Promise<IncidentLu[]> {
  const { data, error } = await supabase
    .from('incidents')
    .select('empreinte, source, gravite, titre, premiere_le, derniere_le, occurrences, dernier_detail, echantillons, version_derniere')
    .is('notifie_le', null)
    .is('resolu_le', null)
    .eq('gravite', gravite)
    .order('premiere_le', { ascending: true })
    .limit(limite);
  if (error) throw new Error(`lecture des incidents : ${error.message}`);
  return (data ?? []) as IncidentLu[];
}

async function envoyerCritiques(problemes: string[]): Promise<string> {
  const incidents = await lireIncidents('critique', 50);
  if (!incidents.length) return 'aucun';

  const individuels = incidents.length <= PLAFOND_EMAILS_PAR_PASSAGE ? incidents : incidents.slice(0, PLAFOND_EMAILS_PAR_PASSAGE - 1);
  const groupes = incidents.length <= PLAFOND_EMAILS_PAR_PASSAGE ? [] : incidents.slice(PLAFOND_EMAILS_PAR_PASSAGE - 1);
  let envoyes = 0;

  for (const i of individuels) {
    if (!(await reserver(i))) continue;
    const envoi = await envoyerAlerte(
      sujetIncident(i),
      enveloppeEmail(blocIncident(i), 'Envoyé une seule fois par incident. Il se rouvrira de lui-même s’il revient après 7 jours de calme, après un nouveau déploiement, ou après avoir été marqué résolu.'),
      'technique',
    );
    if (envoi.envoye) envoyes++;
    else {
      await liberer([i.empreinte]);
      problemes.push(`envoi d’un incident critique impossible : ${envoi.raison}`);
      return `${envoyes} envoyé(s), arrêt : ${envoi.raison}`;
    }
  }

  if (groupes.length) {
    const reserves: IncidentLu[] = [];
    for (const i of groupes) if (await reserver(i)) reserves.push(i);
    if (reserves.length) {
      const envoi = await envoyerAlerte(
        `Momentum — 🔴 ${reserves.length} autres incidents critiques en même temps`,
        enveloppeEmail(
          `<p style="font-size:17px;font-weight:600;margin:0 0 12px">${reserves.length} incidents critiques supplémentaires</p>
           <p style="margin:0 0 16px;color:#797569;font-size:13px">Regroupés pour ne pas épuiser le quota d’e-mails. Autant d’incidents à la fois ont souvent UNE cause commune (base injoignable, déploiement cassé) : commencer par le plus ancien.</p>
           ${reserves.map((i) => `<hr style="border:none;border-top:1px solid #eeeae0;margin:20px 0">${blocIncident(i)}`).join('')}`,
          'Chaque incident de cet e-mail ne sera pas renvoyé individuellement.',
        ),
        'technique',
      );
      if (envoi.envoye) envoyes += reserves.length;
      else {
        await liberer(reserves.map((i) => i.empreinte));
        problemes.push(`envoi groupé d’incidents critiques impossible : ${envoi.raison}`);
      }
    }
  }
  return `${envoyes} envoyé(s)`;
}

async function envoyerRecapitulatif(problemes: string[]): Promise<string> {
  const incidents = await lireIncidents('normale', 40);
  if (!incidents.length) return 'rien de nouveau';
  const reserves: IncidentLu[] = [];
  for (const i of incidents) if (await reserver(i)) reserves.push(i);
  if (!reserves.length) return 'rien de nouveau';

  const envoi = await envoyerAlerte(
    `Momentum — ${reserves.length} problème${reserves.length > 1 ? 's' : ''} non urgent${reserves.length > 1 ? 's' : ''} apparu${reserves.length > 1 ? 's' : ''} depuis hier`,
    enveloppeEmail(
      `<p style="font-size:17px;font-weight:600;margin:0 0 6px">Récapitulatif du matin</p>
       <p style="margin:0 0 16px;color:#797569;font-size:13px">Rien ici n’empêche la plateforme de tourner : ce sont des erreurs isolées (un écran, une lecture refusée, une exception navigateur). Elles sont envoyées une fois ; un problème qui s’aggrave jusqu’à devenir critique part immédiatement, sans attendre ce récapitulatif.</p>
       ${reserves.map((i) => `<hr style="border:none;border-top:1px solid #eeeae0;margin:20px 0">${blocIncident(i)}`).join('')}`,
      'Un récapitulatif par jour au plus, et seulement s’il y a du nouveau.',
    ),
    'technique',
  );
  if (!envoi.envoye) {
    await liberer(reserves.map((i) => i.empreinte));
    problemes.push(`récapitulatif impossible à envoyer : ${envoi.raison}`);
    return `échec : ${envoi.raison}`;
  }
  return `${reserves.length} incident(s) envoyés`;
}
